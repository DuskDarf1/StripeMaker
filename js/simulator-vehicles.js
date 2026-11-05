/* Fixed-step contextual vehicle playback and optional isolated constant-speed
   mode. Distances/speeds are sheet pixels; production uses IDM/MOBIL plus
   swept-body collision prevention and entry conflict reservations. */
(() => {
  const Controls=typeof module !== 'undefined'?require('./simulator-controls.js'):globalThis.StripeMaker.simulatorControls;
  const DEFAULT_RATE = 12; // cars per minute, per entrance (editable demo rate).
  const MAX_RATE = 600;
  const SPEED_FPS = 30 * 5280 / 3600; // Fixed 30 mph playback, not a design speed.
  // Saved percentages use tenths, so rebalancing always totals exactly 100%.
  function allocate(weights, total) {
    let sum = weights.reduce((a, b) => a + b, 0);
    if (!sum) { weights = weights.map(() => 1); sum = weights.length; }
    const exact = weights.map(weight => weight / sum * total), values = exact.map(Math.floor);
    const order = exact.map((value, i) => ({ i, rest: value - values[i] })).sort((a, b) => b.rest - a.rest);
    const remaining = total - values.reduce((a, b) => a + b, 0);
    for (let i = 0; i < remaining; i++) values[order[i].i]++;
    return values;
  }
  function distribution(routes, index = -1, percent = 0) {
    if (!routes.length) return [];
    const weights = routes.map(route => route.percent ?? 1);
    let values;
    if (index < 0 || routes.length === 1) values = allocate(weights, 1000);
    else {
      const share = Math.round(Math.max(0, Math.min(100, percent)) * 10);
      const others = allocate(weights.filter((_, i) => i !== index), 1000 - share);
      let next = 0; values = routes.map((_, i) => i === index ? share : others[next++]);
    }
    return routes.map((route, i) => ({ ...route, percent: values[i] / 10 }));
  }
  const routeColor = percent => `hsl(${(120 * (1 - Math.max(0, Math.min(100, percent)) / 100)).toFixed(1)} 80% 42%)`;
  function preparePath(points, controls = []) {
    const line=[];
    for(const point of points) {
      if(!Number.isFinite(point.x)||!Number.isFinite(point.y))continue;
      const previous=line.at(-1);
      if(previous&&Math.hypot(point.x-previous.x,point.y-previous.y)<=1e-8&&previous.road===point.road&&previous.intersection===point.intersection){
        if(point.maneuver||previous.road==null&&point.road!=null)
          line[line.length-1]={...point,...(previous.intersection!=null&&point.intersection==null?{intersection:previous.intersection}:{})};
        else if(point.intersection!=null&&previous.intersection==null)line[line.length-1]={...previous,intersection:point.intersection};
      }
      else line.push(previous&&Math.hypot(point.x-previous.x,point.y-previous.y)<=1e-8?{...point,x:previous.x,y:previous.y}:point);
    }
    const lengths = [0];
    for (let i = 1; i < line.length; i++) lengths.push(lengths.at(-1) + Math.hypot(line[i].x - line[i - 1].x, line[i].y - line[i - 1].y));
    const maneuvers=[];
    for(let i=0;i<line.length;i++)if(line[i].maneuver) {
      const m=line[i].maneuver,last=maneuvers.at(-1);
      if(!last||last.road!==m.road||last.from!==m.from||last.to!==m.to||m.progress===0&&last.progress>0)
        maneuvers.push({...m,start:lengths[i],end:lengths[i],station:line[i].station});
      else Object.assign(last,{end:lengths[i],progress:m.progress});
    }
    const movements=[],speedLimits=[],zoneLimits=[],maneuverLimits=[];
    for(let i=0;i<line.length;i++){const limit=line[i].maneuverLimit??Infinity;if(!i||maneuverLimits.at(-1).limit!==limit)maneuverLimits.push({distance:lengths[i],limit});}
    for(let i=0;i<line.length;i++){const limit=line[i].zoneLimit??Infinity;if(!i||zoneLimits.at(-1).limit!==limit)zoneLimits.push({distance:lengths[i],limit});}
    for(let i=0;i<line.length;i++)if(line[i].speedLimit!=null)speedLimits.push({distance:lengths[i],limit:line[i].speedLimit});
    for(let i=0;i<line.length;i++)if(line[i].intersection!=null){
      let m=movements.at(-1);
      if(!m||m.intersection!==line[i].intersection||i>m.last+1){m={intersection:line[i].intersection,start:lengths[i],entry:lengths[i],end:lengths[i],last:i,circle:false};movements.push(m);}
      if(line[i].junction)m.junction=line[i].junction;
      if(line[i].roundabout)m.roundabout=line[i].roundabout;
      if(line[i].roundaboutPhase==='circulating'&&!m.circle){m.entry=lengths[i];m.circle=true;}
      m.end=lengths[i];m.last=i;m.speedLimit=Math.min(m.speedLimit??Infinity,line[i].speedLimit??Infinity);
    }
    const roadEntries=[];
    for(let i=1;i<line.length;i++){
      const a=line[i-1],b=line[i];
      if(a.road!=null&&a.road===b.road&&a.lane===b.lane&&Number.isFinite(a.station)&&
        (i===1||line[i-2].road!==a.road||line[i-2].lane!==a.lane))
        roadEntries.push({road:a.road,lane:a.lane,direction:a.direction??1,station:a.station,distance:lengths[i-1],level:a.level??1});
    }
    const path={ points: line, lengths, length: lengths.at(-1) ?? 0, maneuvers, movements, speedLimits, zoneLimits, maneuverLimits, roadEntries, source: points };
    Controls.attach(path,controls);return path;
  }
  function position(path, distance) {
    if (path.points.length < 2) return null;
    const d = Math.max(0, Math.min(path.length, distance));
    let lo = 1, hi = path.lengths.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (path.lengths[mid] < d) lo = mid + 1; else hi = mid; }
    const a = path.points[lo - 1], b = path.points[lo];
    const f = (d - path.lengths[lo - 1]) / (path.lengths[lo] - path.lengths[lo - 1] || 1);
    let heading=lo;
    while(heading<path.points.length-1&&path.lengths[heading]-path.lengths[heading-1]<=1e-8)heading++;
    while(heading>1&&path.lengths[heading]-path.lengths[heading-1]<=1e-8)heading--;
    const h0=path.points[heading-1],h1=path.points[heading];
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, angle: Math.atan2(h1.y - h0.y, h1.x - h0.x) * 180 / Math.PI,
      ...(a.level!=null||b.level!=null?{level:f<.5?(a.level??b.level??1):(b.level??a.level??1)}:{}),
      ...(a.circulating!=null||b.circulating!=null?{circulating:Boolean(a.circulating&&b.circulating)}:{}),
      ...(a.roundaboutPhase!=null||b.roundaboutPhase!=null?{roundaboutPhase:f<.5?a.roundaboutPhase:b.roundaboutPhase}:{}),
      ...(a.speedLimit!=null&&b.speedLimit!=null?{speedLimit:Math.min(a.speedLimit??Infinity,b.speedLimit??Infinity)}:{}),
      ...(a.intersection!=null&&a.intersection===b.intersection?{intersection:a.intersection}:{}),
      ...(a.road!=null&&a.road===b.road ? {road:a.road,lane:a.lane===b.lane?a.lane:(a.maneuver?.from??b.lane),
        station:a.station+(b.station-a.station)*f,direction:a.direction??b.direction??1}:{}),
      ...(b.maneuver && (!a.maneuver || a.maneuver.road === b.maneuver.road && a.maneuver.from === b.maneuver.from && a.maneuver.to === b.maneuver.to)
        ? { laneChange: { ...b.maneuver, progress: (a.maneuver?.progress ?? 0) + (b.maneuver.progress - (a.maneuver?.progress ?? 0)) * f, ...Object.fromEntries(['fromX','fromY','toX','toY','fromWidth','toWidth'].filter(k=>Number.isFinite(b.maneuver[k])).map(k=>[k,(a.maneuver?.[k]??b.maneuver[k])+(b.maneuver[k]-(a.maneuver?.[k]??b.maneuver[k]))*f])) } } : {}),
      ...(a.laneWidth != null || b.laneWidth != null ? { laneWidth: (a.laneWidth ?? b.laneWidth) + ((b.laneWidth ?? a.laneWidth) - (a.laneWidth ?? b.laneWidth)) * f } : {}),
    };
  }
  class Engine {
    constructor({ speed = SPEED_FPS, random = () => Math.random(), behavior = null, pixelsPerFoot = 1, temperature = 40 } = {}) {
      this.speed = speed; this.random = random; this.time = 0; this.nextId = 1;
      this.movementCatalog=[];this.controls=[];this.sources = new Map(); this.cars = []; this.behavior=behavior;this.pixelsPerFoot=pixelsPerFoot;this.temperature=temperature;this.pendingSeconds=0;
    }
    setControls(controls) {
      const signature=JSON.stringify(controls);if(signature===this.controlsSignature)return;
      const previous=new Map(this.controls.map(c=>[c.id,JSON.stringify(c)]));
      this.controls=controls;this.controlsSignature=signature;
      for(const car of this.cars){
        for(const control of controls)if(previous.get(control.id)!==JSON.stringify(control))car.stops?.delete(control.marking);
        Controls.attach(car.path,controls);
      }
      for(const source of this.sources.values()) {
        if(source.candidate)Controls.attach(source.candidate.path,controls);
        for(const route of source.routes)Controls.attach(route.path,controls);
      }
    }
    configure(sources, { preservePaths = false } = {}) {
      const next = new Map();
      for (const source of sources) {
        const previous = this.sources.get(source.key), routes = [];
        for (const route of source.routes) {
          const signature = JSON.stringify(route.points);
          const old = previous?.routes.find(r => r.key === route.key && r.signature === signature);
          const prepared = old ?? { key: route.key, signature, path: preparePath(route.points,this.controls) };
          if (prepared.path.length > 0) routes.push({ ...prepared, weight: route.weight ?? 1, plan:route.plan,replan:route.replan,passing:route.passing,compress:route.compress,mergeContext:route.mergeContext });
        }
        const rate = Math.max(0, Math.min(MAX_RATE, source.rate ?? DEFAULT_RATE));
        const nextAt = !rate ? Infinity : previous?.rate > 0 && previous.routes.length
          ? this.time + Math.max(0, previous.nextAt - this.time) * previous.rate / rate : this.time;
        next.set(source.key, { key: source.key, rate, routes, nextAt, pending:rate?(previous?.pending??0):0, candidate:rate&&previous?.candidate&&routes.some(route=>route.key===previous.candidate.route.key&&(preservePaths||route.signature===previous.candidate.route.signature))?previous.candidate:null });
      }
      this.sources = next;
      const movements=new Map();
      for(const source of next.values())for(const route of source.routes)for(const m of route.path.movements)if(m.junction&&!m.circle){
        const key=`${m.intersection}:${m.junction.input}:${m.junction.output}`;
        if(!movements.has(key))movements.set(key,{id:`planned:${key}`,path:route.path,pathDistance:m.start,entryIntersection:m.intersection,laneWidth:route.path.points[0]?.laneWidth});
      }
      this.movementCatalog=[...movements.values()];
      // A road/turn edit invalidates an in-flight path instead of sending a car
      // over a new forbidden movement. Rate edits leave current cars untouched.
      this.cars = this.cars.filter(car => next.get(car.source)?.routes.some(route => route.key === car.route.key && (preservePaths || route.signature === car.route.signature)));
    }
    advance(seconds) {
      if (!Number.isFinite(seconds) || seconds < 0) return;
      if(this.behavior){this.advanceDrivers(seconds);return;}
      const end = this.time + seconds;
      for (const car of this.cars) car.distance += seconds * this.speed;
      for (const source of this.sources.values()) {
        const totalWeight = source.routes.reduce((sum, route) => sum + route.weight, 0);
        if (!source.rate || !totalWeight) continue;
        const interval = 60 / source.rate;
        for (; source.nextAt <= end + 1e-9; source.nextAt += interval) {
          let choice = this.random() * totalWeight;
          const route = source.routes.find(route => { choice -= route.weight; return choice < 0; }) ?? source.routes.at(-1);
          const bornAt = source.nextAt;
          if ((end - bornAt) * this.speed >= route.path.length) continue;
          this.cars.push({ id: this.nextId++, source: source.key, route, bornAt, distance: (end - bornAt) * this.speed, hue: Math.floor(this.random() * 360) });
        }
      }
      this.time = end;
      this.cars = this.cars.filter(car => car.distance < car.route.path.length);
      for (const car of this.cars) {
        delete car.laneChange;
        Object.assign(car, position(car.route.path, car.distance));
      }
    }
    updateCar(car) {
      car.pixelsPerFoot=this.pixelsPerFoot;
      for(const key of ['road','lane','station','direction','laneChange','intersection','level','circulating','roundaboutPhase','speedLimit'])delete car[key];
      Object.assign(car,position(car.path,car.pathDistance));
    }
    chooseRoute(source) {
      let choice=this.random()*source.routes.reduce((sum,route)=>sum+route.weight,0);
      return source.routes.find(route=>{choice-=route.weight;return choice<0;})??source.routes.at(-1);
    }
    spawnDrivers() {
      const B=this.behavior,ppf=this.pixelsPerFoot;
      for(const source of this.sources.values()) {
        if(!source.rate||!source.routes.some(route=>route.weight>0))continue;
        const interval=60/source.rate;
        while(source.nextAt<=this.time+1e-9){source.pending++;source.nextAt+=interval;}
        if(!source.pending)continue;
        if(!source.candidate) {
          const route=this.chooseRoute(source);let driver,points;
          for(let attempt=0;attempt<8;attempt++) {
            driver=B.profile(this.random,this.temperature);
            points=route.plan?.({driver,random:this.temperature===0?()=>.5:this.random,cars:this.cars,speed:this.speed*(driver.speedFactor??1)})??(!route.plan?route.path.points:null);
            if(points)break;
          }
          // If a sampled duration does not fit this road, the verified legal
          // baseline remains available; this fallback is documented, not a
          // claim that all drivers share that duration.
          if(!points){driver={...driver,duration:6.28};points=route.path.points;}
          const car={id:this.nextId++,source:source.key,route,driver,path:preparePath(points,this.controls),bornAt:this.time,
            pathDistance:0,distance:0,speed:this.speed*(driver.speedFactor??1),hue:Math.floor(this.random()*360),decisionAt:0,committed:new Set()};
          this.updateCar(car);
          source.candidate=car;
        }
        const car=source.candidate,desiredEntry=B.collisions.desiredSpeed(car,this.speed*(car.driver.speedFactor??1),B.parameter(car.driver,'deceleration')*ppf/.3048,ppf);
        // Re-evaluate a waiting candidate: a past queue or blocked maneuver
        // must not permanently latch its initial speed to zero.
        car.speed=desiredEntry;
        const change=car.path.maneuvers[0];
        if(change&&change.road===car.road&&!B.safe(car,this.cars,change.to,car.speed,ppf).allowed){
          const room=Math.max(0,change.start-B.length(car,ppf)/2-B.parameter(car.driver,'jamGap')*ppf/.3048);
          if(room===0&&desiredEntry>0)continue;
          car.speed=Math.min(car.speed,Math.sqrt(2*B.parameter(car.driver,'deceleration')*ppf/.3048*room));
        }
        const lead=B.leader(car,this.cars,ppf,car.speed);
        if(lead){
          // A source at highway speed must not inject a fast vehicle into a
          // standing/slow queue using headway alone. Match an IDM-compatible
          // entry speed before the car becomes an active actor.
          const desired=B.collisions.desiredSpeed(car,this.speed*(car.driver.speedFactor??1),B.parameter(car.driver,'deceleration')*ppf/.3048,ppf);
          const allowed=-B.parameter(car.driver,'deceleration')*ppf/.3048;
          const response=speed=>B.acceleration(speed,desired,lead.gap,lead.car.speed,car.driver.headway,ppf,car.driver);
          if(response(car.speed)<allowed){let lo=0,hi=car.speed;for(let n=0;n<24;n++){const mid=(lo+hi)/2;if(response(mid)>=allowed)lo=mid;else hi=mid;}car.speed=lo;}
        }
        if(desiredEntry>0&&car.speed<Math.min(desiredEntry,ppf))continue;
        const desiredGap=B.parameter(car.driver,'jamGap')*ppf/.3048+car.speed*car.driver.headway;
        if(lead&&lead.gap<desiredGap)continue;
        if(B.collisions.scene(this.cars,ppf).query(B.collisions.bounds(car,0,ppf)).some(other=>B.collisions.overlap(car,other,ppf)))continue;
        this.cars.push(car);B.indexCars(this.cars);source.pending--;source.candidate=null;
      }
    }
    replacePath(car,points,prepared=null) {
      if(!points||points.length<2)return false;
      // A road-join admission belongs to the current crossing geometry. An
      // in-join replan discarded that claim and moved the hold to the car's
      // current position, stranding it across the continuing stream.
      if(car.path.movements.some(m=>m.junction?.roadMerge&&car.pathDistance>=m.start&&car.pathDistance<=m.end))return false;
      const path=prepared??preparePath(points,this.controls);if(!path.length)return false;
      car.path=path;car.pathDistance=0;car.committed=new Set();car.conflict=null;delete car.laneIntent;delete car.reservation;this.updateCar(car);this.signals?.observe(car);return true;
    }
    advanceDrivers(seconds) {
      const B=this.behavior;B.indexCars(this.cars);this.spawnDrivers();this.pendingSeconds+=seconds;
      while(this.pendingSeconds>=B.STEP-1e-9) {
        this.signals?.step(B.STEP,this.cars,this.time);this.driverStep(B.STEP);this.time+=B.STEP;this.pendingSeconds-=B.STEP;this.spawnDrivers();
      }
    }
    driverStep(dt) {
      const B=this.behavior,ppf=this.pixelsPerFoot,ppm=ppf/.3048,updates=[];
      for(const car of this.cars){
        car.mergeContext=car.route.mergeContext?.(car)??null;
        car.cruiseDriver??=car.driver;
        if(car.mergeContext&&!car.mergeDriver)car.mergeDriver=B.mergeProfile(car.cruiseDriver);
        car.driver=car.mergeContext?car.mergeDriver:car.cruiseDriver;
      }
      B.indexCars(this.cars);
      const collisionWorld=B.collisions.scene(this.cars,ppf);
      const gapCheck=(car,change)=>B.safe({...car,road:change.road,lane:change.from,station:car.road===change.road?car.station:change.station,direction:car.path.points.find(p=>p.maneuver?.road===change.road)?.direction??car.direction},this.cars,change.to,this.speed*(car.driver.speedFactor??1),ppf);
      const reroute=(car,points)=>{
        if(!points||points.length<2)return false;
        const proposed=preparePath(points,this.controls),first=proposed.maneuvers[0];
        if(first&&!gapCheck(car,first).allowed){
          const old=car.path.maneuvers.find(m=>m.end>car.pathDistance&&!car.committed.has(m));
          const oldRemaining=old?old.start-car.pathDistance:Infinity;
          const braking=car.speed*car.speed/(2*B.parameter(car.driver,'deceleration')*ppm)+car.speed*car.driver.headway;
          if(first.start<braking&&first.start<=oldRemaining+1e-6)return false;
        }
        if(!this.replacePath(car,points,proposed))return false;
        if(first&&first.start<=1e-6)car.laneIntent={road:first.road,from:first.from,to:first.to};
        // A lane-change decision must be visible to the next driver in this
        // same step; otherwise two outside lanes can both claim an empty
        // middle lane before the next index rebuild.
        B.indexCars(this.cars);delete collisionWorld.forecast;delete collisionWorld.predictions;
        return true;
      };
      const observations=new Map(this.cars.map(car=>[car.id,B.leader(car,this.cars,ppf,this.speed*(car.driver.speedFactor??1))]));
      const cooperation=B.mergeCooperation(this.cars,ppf,this.speed);
      for(const car of this.cars)Controls.observe(car,ppf,this.time);
      const reservations=B.collisions.reservations(this.cars,ppf,B.PARAMETERS.deceleration*ppm,this.time,B.PARAMETERS.acceleration*ppm,this.speed,observations,this.movementCatalog,dt);
      for(const car of this.cars) {
        const freeSpeed=this.speed*(car.driver.speedFactor??1);
        let desired=B.collisions.desiredSpeed(car,freeSpeed,B.parameter(car.driver,'deceleration')*ppm,ppf);const contextual=desired;let mergeTarget=null;car.desiredSpeed=desired;
        const lead=observations.get(car.id);
        let obstacle=lead,reason=lead?'following':'free-road';
        let mergeBlocked=false;
        // Finish an in-progress lane change within its remaining time when the
        // car slows (route callback). The maneuver stays committed.
        if(this.time>=car.decisionAt&&car.laneChange?.progress>1e-6&&car.laneChange.progress<1-1e-6&&car.route.compress){
          const points=car.route.compress({car,driver:car.driver,cars:this.cars});
          if(points&&this.replacePath(car,points)){if(car.path.maneuvers[0])car.committed.add(car.path.maneuvers[0]);B.indexCars(this.cars);delete collisionWorld.forecast;delete collisionWorld.predictions;}
        }
        let change=car.path.maneuvers.find(m=>m.end>car.pathDistance+1e-6&&!car.committed.has(m));
        const deciding=this.time>=car.decisionAt;
        if(deciding)car.decisionAt=this.time+B.DECISION_INTERVAL;
        const help=cooperation.get(car.id);
        if(help&&deciding&&(!car.laneChange||car.laneChange.progress<=1e-6)&&car.road!=null&&car.route.passing){
          for(const target of car.route.passing(car)){
            if(Math.sign(target-car.lane)!==Math.sign(help.context.to-help.context.from)||!B.safe(car,this.cars,target,desired,ppf).allowed)continue;
            const points=car.route.replan?.({car,target,cooperative:true,driver:car.driver,cars:this.cars,random:this.temperature===0?()=>.5:this.random,speed:desired});
            if(reroute(car,points)){reason='making-room';car.cooperativeChanges=(car.cooperativeChanges??0)+1;change=car.path.maneuvers[0];break;}
          }
        }
        const approach=car.path.movements.some(m=>m.junction&&!m.circle&&m.start>car.pathDistance);
        if(deciding&&(!car.laneChange||approach&&car.laneChange.progress<=1e-6)&&car.road!=null) {
          // Discretionary changes require a real advantage and a safe target
          // gap. The route callback must still reach the chosen legal exit.
          const planningSpeed=approach?desired:freeSpeed;
          const choices=lead&&car.route.passing?car.route.passing(car).map(target=>({target,queue:approach?B.queueGain(car,this.cars,target,planningSpeed,ppf):0,score:approach?B.incentiveScore(car,this.cars,target,planningSpeed,ppf):Number(B.incentive(car,this.cars,target,planningSpeed,ppf))})).filter(c=>c.queue>0||c.score>0).sort((a,b)=>b.queue-a.queue||b.score-a.score):[];
          for(const {target} of choices) {
            const points=car.route.replan?.({car,target,driver:car.driver,cars:this.cars,random:this.temperature===0?()=>.5:this.random,speed:planningSpeed});
            if(reroute(car,points)){reason='passing';change=car.path.maneuvers[0];break;}
          }
        }
        if(change) {
          let check=gapCheck(car,change);
          const preparation=B.mergePreparation(car,desired,ppf,this.cars);
          if(preparation){car.mergeGoal=preparation.target;car.requestedMergeSpeed=preparation.requested;}
          // A planned station is a suggestion, not a reason to drive past an
          // available gap. Start a required merge now when the current lane
          // boundary and remaining legal route allow the full maneuver.
          if(check.allowed&&!preparation?.buildingSpeed&&deciding&&car.road===change.road&&(!car.laneChange||car.laneChange.progress<=1e-6)&&
            change.start-car.pathDistance>car.speed*B.DECISION_INTERVAL&&car.route.replan){
            const points=car.route.replan({car,target:change.to,required:true,driver:car.driver,cars:this.cars,random:this.temperature===0?()=>.5:this.random,speed:preparation?.target??desired});
            if(reroute(car,points)){change=car.path.maneuvers.find(m=>!car.committed.has(m));check=change?gapCheck(car,change):null;}
          }
          const merging=change?B.mergeApproach(car,this.cars,change,desired,ppf):null;
          if(merging){mergeTarget=desired=merging.speed;car.desiredSpeed=desired;reason='matching-merge-speed';}
          // Keeping usable lane ahead does not depend on having adjacent
          // traffic inside the speed-matching observation window. Otherwise
          // a temporarily unseen gap reintroduces the arbitrary stop point.
          const mergeDelay=merging?.delay??car.driver.headway+car.speed/(2*B.parameter(car.driver,'deceleration')*ppm);
          // A gap may close between scheduled decisions. Replan before the
          // next step can reach its provisional steering point; waiting for
          // the timer here produces a numerical stop at progress zero.
          const imminent=change&&(car.observedManeuver!==change||car.mergeGapAllowed)&&change.start-car.pathDistance<=car.speed*B.DECISION_INTERVAL+B.length(car,ppf)/2;
          if(check&&(!check.allowed||preparation?.buildingSpeed)&&(deciding||imminent)&&(!car.laneChange||car.laneChange.progress<=1e-6)&&car.route.replan){
            const delay=Math.max(preparation?.buildingSpeed?preparation.delay:0,!check.allowed?mergeDelay:0);
            const points=car.route.replan({car,driver:car.driver,cars:this.cars,random:this.temperature===0?()=>.5:this.random,speed:freeSpeed,mergeDelay:delay,mergeSpeed:Math.min(preparation?.target??Infinity,merging?.speed??desired)});
            if(reroute(car,points)){change=car.path.maneuvers.find(m=>!car.committed.has(m));check=change?gapCheck(car,change):null;car.rollingMergeUntil=this.time+B.DECISION_INTERVAL;}else delete car.rollingMergeUntil;
          }
          if(change){
            if(!check.allowed){
              reason='waiting-for-gap';delete car.laneIntent;B.indexCars(this.cars);
              mergeBlocked=true;
              // A successfully extended approach still has legal lane ahead.
              // Do not turn its provisional steering station into a stop bar.
              // The extension reserves comfortable stopping room if the next
              // search fails; crossing an unaccepted maneuver remains forbidden.
              if(!(this.time<(car.rollingMergeUntil??-Infinity))){
                // A steering start is a center-path station, not a painted
                // stop bar. Actual target-lane gap checks already include
                // both vehicle bodies; do not add a front-bumper stop here.
                const gap=change.start-car.pathDistance+B.parameter(car.driver,'jamGap')*ppm;
                if(!obstacle||gap<obstacle.gap)obstacle={gap,car:{speed:0}};
              }
            }else {
              reason='preparing-for-exit';
              if(car.pathDistance+car.speed*dt+.5*B.parameter(car.driver,'acceleration')*ppm*dt*dt>=change.start-1e-6){
                car.laneIntent={road:change.road,from:change.from,to:change.to};B.indexCars(this.cars);
              }
            }
          }
          car.observedManeuver=change;car.mergeGapAllowed=Boolean(check?.allowed);
        }
        if(deciding){
          const forecast=B.collisions.threat(car,collisionWorld,desired,B.parameter(car.driver,'acceleration')*ppm,ppf,lead?.car.id);
          car.conflict=forecast?{id:forecast.car.id,at:car.distance+forecast.distance}:null;
        }
        const reservation=reservations.get(car.id);
        if(reservation&&(!obstacle||reservation.gap<obstacle.gap)){obstacle=reservation;reason='yielding-entry';}
        if(car.conflict){
          const other=this.cars.find(other=>other.id===car.conflict.id);
          if(other){const gap=Math.max(0,car.conflict.at-car.distance)+B.parameter(car.driver,'jamGap')*ppm;
            if(!obstacle||gap<obstacle.gap){obstacle={gap,car:{id:other.id,speed:0}};reason='yielding';}}
        }
        const control=Controls.obstacle(car,ppf);
        if(control&&(!obstacle||control.gap<obstacle.gap)){obstacle=control;reason='stopping-control';}
        if(!(this.speed>0)){updates.push({car,speed:0,travel:0,reason:'stopped-speed',obstacle});continue;}
        let acceleration=B.acceleration(car.speed,mergeTarget==null?desired:contextual,obstacle?.gap??Infinity,obstacle?.car.speed??this.speed,car.driver.headway,ppf,car.driver);
        if(help&&!(car.laneChange?.progress>1e-6)){
          if(help.acceleration<acceleration){car.cooperativeSeconds=(car.cooperativeSeconds??0)+dt;if(!obstacle)reason='opening-merge-gap';}
          acceleration=Math.min(acceleration,help.acceleration);
        }
        if(mergeTarget!=null){
          // Match a prospective slot with comfortable personal response. Do not
          // clamp real leader/control/collision braking to this preference.
          const matching=Math.max(-B.parameter(car.driver,'deceleration')*ppm,Math.min(B.parameter(car.driver,'acceleration')*ppm,(mergeTarget-car.speed)/car.driver.headway));
          acceleration=Math.min(acceleration,matching);
        }
        // Steady yellow ends green service: do not accelerate to race it.
        // If a stop was selected, begin braking now rather than
        // waiting for red to introduce a hard speed clamp. Existing leader,
        // yield and collision constraints can require stronger braking.
        const signal=car.signalControl;
        if(signal?.aspect==='yellow'&&signal.remaining>0){
          const braking=signal.allowed?0:Math.min((signal.braking??B.parameter(car.driver,'deceleration'))*ppm,car.speed*car.speed/(2*Math.max(signal.remaining,.001*ppm)));
          acceleration=Math.min(acceleration,-braking);
        }
        let speed=Math.max(0,Math.min(freeSpeed,car.speed+acceleration*dt));
        if(obstacle?.control) speed=Math.min(speed,Math.sqrt(Math.max(0,2*(obstacle.control.braking??B.parameter(car.driver,'deceleration'))*ppm*obstacle.remaining)));
        let travel=acceleration<0&&speed===0?Math.max(0,-car.speed*car.speed/(2*acceleration)):(car.speed+speed)*dt/2;
        // Numerical non-overlap bound, not an empirical driver parameter.
        if(obstacle)travel=Math.min(travel,Math.max(0,obstacle.gap-B.parameter(car.driver,'jamGap')*ppm)+(obstacle.car.speed??0)*dt);
        if(mergeBlocked&&change&&travel>=change.start-car.pathDistance){travel=Math.max(0,change.start-car.pathDistance);speed=0;}
        if(obstacle?.control) {
          travel=Math.min(travel,obstacle.remaining);
          // Exact bar stop: snap only the final millimetre, never a queue's stop.
          if(obstacle.remaining-travel<=.001*ppm){travel=obstacle.remaining;speed=0;}
        }
        updates.push({car,speed,travel,reason,obstacle});
      }
      this.collisionInterventions=(this.collisionInterventions??0)+B.collisions.resolve(updates,ppf);
      for(const {car,speed,travel,reason,obstacle,collisionWith} of updates) {
        car.stoppedSeconds=speed<=1e-6*ppf?(car.stoppedSeconds??0)+dt:0;
        car.speed=speed;car.pathDistance+=travel;car.distance+=travel;
        if(travel>0)for(const m of car.path.maneuvers)if(m.start<car.pathDistance+1e-6&&m.end>=car.pathDistance-travel)car.committed.add(m);
        this.updateCar(car);delete car.laneIntent;car.situation={reason,leader:obstacle?.car.id??null,gap:obstacle?.gap??null,collision:collisionWith??null};
      }
      this.cars=this.cars.filter(car=>car.pathDistance<car.path.length);
      this.recoverStuck(this.time+dt);
      B.indexCars(this.cars);
    }
    recoverStuck(now) {
      if(!(this.speed>0))return;
      const byId=new Map(this.cars.map(car=>[car.id,car])),stalled=new Set();
      for(const car of this.cars){
        car.progressAnchor??=car.distance;car.progressAt??=now;
        // One foot of cumulative progress distinguishes numerical creeping
        // from actual flow. The user-requested timeout is 30 simulation seconds.
        if(car.distance-car.progressAnchor>=this.pixelsPerFoot){car.progressAnchor=car.distance;car.progressAt=now;}
        if(!car.signalControl&&!car.path?.movements?.some(m=>this.signals?.records.has(m.intersection)&&m.end>=car.pathDistance)&&now-car.progressAt>=30&&car.speed<.1*this.pixelsPerFoot)stalled.add(car.id);
      }
      for(const start of this.cars){
        if(!stalled.has(start.id))continue;
        const chain=[],seen=new Map();let car=start,culprit=null;
        while(car&&stalled.has(car.id)){
          if(seen.has(car.id)){
            const cycle=chain.slice(seen.get(car.id));
            culprit=cycle.find(c=>c.roundaboutPhase==='entry'&&c.situation?.collision!=null)??cycle.find(c=>c.situation?.collision!=null)??cycle[0];break;
          }
          seen.set(car.id,chain.length);chain.push(car);
          const id=car.situation?.collision??car.situation?.leader;
          if(id==null){if(car.intersection!=null&&car.roundaboutPhase!=='entry'&&car.desiredSpeed>0)culprit=car;break;}
          car=byId.get(id);
        }
        if(!culprit)continue;
        this.cars=this.cars.filter(car=>car!==culprit);
        (this.watchdogEvents??=[]).push({id:culprit.id,time:now,reason:'stuck-blocker'});if(this.watchdogEvents.length>20)this.watchdogEvents.shift();
        this.watchdogRemovals=(this.watchdogRemovals??0)+1;
        const affected=new Set(chain.map(car=>car.id));affected.add(culprit.id);
        let changed=true;while(changed){changed=false;for(const c of this.cars)if(!affected.has(c.id)&&affected.has(c.situation?.collision??c.situation?.leader)){affected.add(c.id);changed=true;}}
        for(const c of this.cars)if(affected.has(c.id)){c.progressAnchor=c.distance;c.progressAt=now;if(c.conflict?.id===culprit.id)c.conflict=null;}
        break; // Clear one blocker, then let the affected traffic respond.
      }
    }
    reset() { this.signals?.reset();this.watchdogRemovals=0;this.watchdogEvents=[];this.collisionInterventions=0;this.time = 0; this.pendingSeconds=0;this.sources.clear(); this.cars = []; }

  }
  const api = { Engine, preparePath, position, DEFAULT_RATE, MAX_RATE, SPEED_FPS, distribution, routeColor };
  (globalThis.StripeMaker ??= {}).simulatorVehicles = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
