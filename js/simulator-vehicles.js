/* Constant-speed vehicle playback, independent of frame rate and zoom.
   Distances and speeds are in sheet pixels. No interaction between vehicles. */
(() => {
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
  function preparePath(points) {
    const line=[];
    for(const point of points) {
      if(!Number.isFinite(point.x)||!Number.isFinite(point.y))continue;
      const previous=line.at(-1);
      if(previous&&Math.hypot(point.x-previous.x,point.y-previous.y)<=1e-8){if(point.maneuver)line[line.length-1]=point;}
      else line.push(point);
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
    return { points: line, lengths, length: lengths.at(-1) ?? 0, maneuvers };
  }
  function position(path, distance) {
    if (path.points.length < 2) return null;
    const d = Math.max(0, Math.min(path.length, distance));
    let lo = 1, hi = path.lengths.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (path.lengths[mid] < d) lo = mid + 1; else hi = mid; }
    const a = path.points[lo - 1], b = path.points[lo];
    const f = (d - path.lengths[lo - 1]) / (path.lengths[lo] - path.lengths[lo - 1] || 1);
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, angle: Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI,
      ...(a.road!=null&&a.road===b.road ? {road:a.road,lane:a.lane===b.lane?a.lane:(a.maneuver?.from??b.lane),
        station:a.station+(b.station-a.station)*f,direction:a.direction??b.direction??1}:{}),
      ...(b.maneuver && (!a.maneuver || a.maneuver.road === b.maneuver.road && a.maneuver.from === b.maneuver.from && a.maneuver.to === b.maneuver.to)
        ? { laneChange: { ...b.maneuver, progress: (a.maneuver?.progress ?? 0) + (b.maneuver.progress - (a.maneuver?.progress ?? 0)) * f } } : {}),
      ...(a.laneWidth != null || b.laneWidth != null ? { laneWidth: (a.laneWidth ?? b.laneWidth) + ((b.laneWidth ?? a.laneWidth) - (a.laneWidth ?? b.laneWidth)) * f } : {}),
    };
  }
  class Engine {
    constructor({ speed = SPEED_FPS, random = () => Math.random(), behavior = null, pixelsPerFoot = 1 } = {}) {
      this.speed = speed; this.random = random; this.time = 0; this.nextId = 1;
      this.sources = new Map(); this.cars = []; this.behavior=behavior;this.pixelsPerFoot=pixelsPerFoot;this.pendingSeconds=0;
    }
    configure(sources, { preservePaths = false } = {}) {
      const next = new Map();
      for (const source of sources) {
        const previous = this.sources.get(source.key), routes = [];
        for (const route of source.routes) {
          const signature = JSON.stringify(route.points);
          const old = previous?.routes.find(r => r.key === route.key && r.signature === signature);
          const prepared = old ?? { key: route.key, signature, path: preparePath(route.points) };
          if (prepared.path.length > 0) routes.push({ ...prepared, weight: route.weight ?? 1, plan:route.plan,replan:route.replan,passing:route.passing });
        }
        const rate = Math.max(0, Math.min(MAX_RATE, source.rate ?? DEFAULT_RATE));
        const nextAt = !rate ? Infinity : previous?.rate > 0 && previous.routes.length
          ? this.time + Math.max(0, previous.nextAt - this.time) * previous.rate / rate : this.time;
        next.set(source.key, { key: source.key, rate, routes, nextAt, pending:rate?(previous?.pending??0):0, candidate:rate&&previous?.candidate&&routes.some(route=>route.key===previous.candidate.route.key&&(preservePaths||route.signature===previous.candidate.route.signature))?previous.candidate:null });
      }
      this.sources = next;
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
      for(const key of ['road','lane','station','direction','laneChange'])delete car[key];
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
            driver=B.profile(this.random);
            points=route.plan?.({driver,random:this.random,cars:this.cars,speed:this.speed})??(!route.plan?route.path.points:null);
            if(points)break;
          }
          // If a sampled duration does not fit this road, the verified legal
          // baseline remains available; this fallback is documented, not a
          // claim that all drivers share that duration.
          if(!points){driver={...driver,duration:6.28};points=route.path.points;}
          const car={id:this.nextId++,source:source.key,route,driver,path:preparePath(points),bornAt:this.time,
            pathDistance:0,distance:0,speed:this.speed,hue:Math.floor(this.random()*360),decisionAt:0,committed:new Set()};
          this.updateCar(car);source.candidate=car;
        }
        const car=source.candidate,lead=B.leader(car,this.cars,ppf,this.speed);
        const desiredGap=B.PARAMETERS.jamGap*ppf/.3048+this.speed*car.driver.headway;
        if(lead&&lead.gap<desiredGap)continue;
        this.cars.push(car);B.indexCars(this.cars);source.pending--;source.candidate=null;
      }
    }
    replacePath(car,points) {
      if(!points||points.length<2)return false;
      const path=preparePath(points);if(!path.length)return false;
      car.path=path;car.pathDistance=0;car.committed=new Set();this.updateCar(car);return true;
    }
    advanceDrivers(seconds) {
      const B=this.behavior;B.indexCars(this.cars);this.spawnDrivers();this.pendingSeconds+=seconds;
      while(this.pendingSeconds>=B.STEP-1e-9) {
        this.driverStep(B.STEP);this.time+=B.STEP;this.pendingSeconds-=B.STEP;this.spawnDrivers();
      }
    }
    driverStep(dt) {
      const B=this.behavior,ppf=this.pixelsPerFoot,ppm=ppf/.3048,updates=[];
      B.indexCars(this.cars);
      for(const car of this.cars) {
        const lead=B.leader(car,this.cars,ppf,this.speed);
        let obstacle=lead,reason=lead?'following':'free-road';
        let change=car.path.maneuvers.find(m=>m.end>car.pathDistance+1e-6&&!car.committed.has(m));
        const deciding=this.time>=car.decisionAt;
        if(deciding&&!car.laneChange&&car.road!=null) {
          car.decisionAt=this.time+B.DECISION_INTERVAL;
          // Discretionary changes require a real advantage and a safe target
          // gap. The route callback must still reach the chosen legal exit.
          if(lead&&car.route.passing)for(const target of car.route.passing(car)) {
            if(!B.incentive(car,this.cars,target,this.speed,ppf))continue;
            const points=car.route.replan?.({car,target,driver:car.driver,cars:this.cars,random:this.random,speed:this.speed});
            if(this.replacePath(car,points)){reason='passing';change=car.path.maneuvers[0];break;}
          }
        }
        if(change) {
          const probe={...car,road:change.road,lane:change.from,station:car.road===change.road?car.station:change.station,direction:car.path.points.find(p=>p.maneuver?.road===change.road)?.direction??car.direction};
          const check=B.safe(probe,this.cars,change.to,this.speed,ppf);
          if(!check.allowed) {
            reason='waiting-for-gap';
            if(deciding&&!car.laneChange&&car.route.replan) {
              const points=car.route.replan({car,driver:car.driver,cars:this.cars,random:this.random,speed:this.speed});
              if(this.replacePath(car,points))change=car.path.maneuvers.find(m=>!car.committed.has(m));
            }
            if(change) {
              const gap=change.start-car.pathDistance-B.length(car,ppf)/2;
              if(!obstacle||gap<obstacle.gap)obstacle={gap,car:{speed:0}};
            }
          } else {
            reason='preparing-for-exit';
            if(car.pathDistance+car.speed*dt>=change.start-1e-6)car.committed.add(change);
          }
        }
        if(!(this.speed>0)){updates.push({car,speed:0,travel:0,reason:'stopped-speed',obstacle});continue;}
        const acceleration=B.acceleration(car.speed,this.speed,obstacle?.gap??Infinity,obstacle?.car.speed??this.speed,car.driver.headway,ppf);
        let speed=Math.max(0,Math.min(this.speed,car.speed+acceleration*dt));
        let travel=acceleration<0&&speed===0?Math.max(0,-car.speed*car.speed/(2*acceleration)):(car.speed+speed)*dt/2;
        // Numerical non-overlap bound, not an empirical driver parameter.
        if(obstacle)travel=Math.min(travel,Math.max(0,obstacle.gap-B.PARAMETERS.jamGap*ppm)+(obstacle.car.speed??0)*dt);
        updates.push({car,speed,travel,reason,obstacle});
      }
      for(const {car,speed,travel,reason,obstacle} of updates) {
        car.speed=speed;car.pathDistance+=travel;car.distance+=travel;
        this.updateCar(car);car.situation={reason,leader:obstacle?.car.id??null,gap:obstacle?.gap??null};
      }
      this.cars=this.cars.filter(car=>car.pathDistance<car.path.length);
      B.indexCars(this.cars);
    }
    reset() { this.time = 0; this.pendingSeconds=0;this.sources.clear(); this.cars = []; }

  }
  const api = { Engine, preparePath, position, DEFAULT_RATE, MAX_RATE, SPEED_FPS, distribution, routeColor };
  (globalThis.StripeMaker ??= {}).simulatorVehicles = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
