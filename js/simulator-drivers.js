/* Driver observations and variability (SI model parameters, converted to pixels).
   NHTSA DOT HS 809 702: Table 3.38 duration mean 6.28 s, SD 2.0 s;
   Table 1.1 / Fancher field data: following headway mean 1.6 s, SD 0.8 s.
   https://www.nhtsa.gov/sites/nhtsa.gov/files/documents/lane_change_final.pdf
   Baseline means are retained; SDs are evidence only, not claimed fits to the
   user-defined bounded temperature mixture (documented in DRIVER-MODEL.md).
   IDM Table I: a=.73 m/s², b=1.67 m/s², s0=2 m, exponent=4:
   https://arxiv.org/abs/cond-mat/0002177
   MOBIL author reference: safe braking=4 m/s², incentive=.2 m/s²;
   politeness=.3 is a selected value within its published typical 0–.5 range:
   https://mtreiber.de/MicroApplet/MOBIL.html
   These highway baselines are not site-calibrated or an occlusion/signal model. */
(() => {
  const collisions=typeof module!=='undefined'?require('./simulator-collisions.js'):globalThis.StripeMaker.simulatorCollisions;
  const METERS_PER_FOOT=.3048;
  const PARAMETERS={acceleration:.73,deceleration:1.67,jamGap:2,exponent:4,safeBraking:4,incentive:.2,politeness:.3};
  const STEP=1/30, DECISION_INTERVAL=.2; // 30 Hz physics; independent driver decision cadence
  const DEFAULT_TEMPERATURE=40;
  const BASELINE={duration:6.28,headway:1.6,...PARAMETERS,speedFactor:1,roundaboutFactor:1};
  // User-defined experimental mixture, not a measured national distribution.
  // At temperature 75: 25% quick-response drivers, a/b centered on 2.2x
  // the cited IDM baseline. Other variables retain the +/-0.5%/degree envelope.
  function temperatureModel(value=DEFAULT_TEMPERATURE) {
    const temperature=Math.max(0,Math.min(100,Number.isFinite(value)?value:DEFAULT_TEMPERATURE));
    return {temperature,amplitude:temperature*.005,quickProbability:temperature/300,
      responseSpread:temperature*.008,quickResponse:1+temperature*.016,quickSpread:temperature/750};
  }
  function profile(random,temperature=DEFAULT_TEMPERATURE) {
    const model=temperatureModel(temperature);temperature=model.temperature;
    const {amplitude}=model,aggressive=amplitude>0&&random()<model.quickProbability;
    const driver={temperature,aggressive};
    for(const [key,base] of Object.entries(BASELINE)) {
      const riskDown=['duration','headway','jamGap','incentive','politeness'].includes(key);
      if(key==='acceleration'||key==='deceleration') {
        driver[key]=base*(!amplitude?1:aggressive?model.quickResponse+(random()*2-1)*model.quickSpread:1+(random()*2-1)*model.responseSpread);
      } else {
        const offset=!amplitude?0:aggressive?(riskDown?-1:1)*(.8+.2*random()):(random()-.5);
        driver[key]=base*(1+amplitude*offset);
      }
    }
    // MOBIL's safe-braking threshold must not fall below comfortable braking;
    // comfortable braking remains the lower bound for the numerical safety check.
    driver.safeBraking=Math.max(driver.safeBraking,driver.deceleration);
    return driver;
  }
  const parameter=(driver,key)=>driver?.[key]??PARAMETERS[key];
  const length=(car,ppf)=>Math.max(ppf,Math.min(car.laneWidth??12*ppf,12*ppf)-2*ppf)*381/214;
  const occupies=(car,lane)=>{
    const m=car.laneChange,p=m?.progress??1;
    if(m&&p>=1-1e-6)return lane===m.to;
    if(m&&p>1e-6&&[m.from,m.to].includes(lane)&&car.path?.movements?.some(m=>m.junction&&!m.circle&&m.start>car.pathDistance)&&['fromX','fromY','toX','toY','fromWidth'].every(k=>Number.isFinite(m[k]))){
      // Queue following sees the actual body, not a future lane reservation.
      // A barely started change must not leave a phantom car in its target
      // lane, nor a nearly completed change in its old lane. Gap admission
      // separately reserves the target until the maneuver finishes. Cruising
      // reservations retain their existing policy. Dimensions match the sprite.
      const dx=m.toX-m.fromX,dy=m.toY-m.fromY,separation=Math.hypot(dx,dy);
      if(separation>1e-6&&Number.isFinite(car.x+car.y)){
        const v={x:dx/separation,y:dy/separation},box=collisions.box(car,car.pixelsPerFoot??1);
        const extent=box.half*Math.abs(box.u.x*v.x+box.u.y*v.y)+box.side*Math.abs(box.v.x*v.x+box.v.y*v.y);
        const offset=(car.x-m.fromX)*v.x+(car.y-m.fromY)*v.y;
        return lane===m.from?offset-extent<=m.fromWidth/2+1e-6:offset+extent>=separation-(m.toWidth??m.fromWidth)/2-1e-6;
      }
    }
    return car.lane===lane||m&&p>1e-6&&(m.from===lane||m.to===lane);
  };
  function acceleration(speed,desired,gap,leaderSpeed,headway,ppf,driver) {
    if(!(desired>0))return speed>0?-parameter(driver,'deceleration')*ppf/METERS_PER_FOOT:0;
    const ppm=ppf/METERS_PER_FOOT,a=parameter(driver,'acceleration')*ppm,b=parameter(driver,'deceleration')*ppm,s0=parameter(driver,'jamGap')*ppm;
    const wanted=s0+Math.max(0,speed*headway+speed*(speed-leaderSpeed)/(2*Math.sqrt(a*b)));
    return a*(1-(speed/desired)**parameter(driver,'exponent')-(Number.isFinite(gap)?(wanted/Math.max(.001*ppm,gap))**2:0));
  }
  const trafficIndexes=new WeakMap();
  const corridorKey=(road,direction,lane)=>`${road}:${direction}:${lane}`;
  // Project an approaching vehicle onto the next legally connected road's
  // lane station (ordinary joins and intersection connectors alike). Negative
  // stations expose rear traffic before it acquires the target road identity.
  function approaching(car) {
    const entry=car.path?.roadEntries?.find(p=>p.distance>car.pathDistance+1e-6&&p.road!==car.road);
    return entry?{car,...entry,station:entry.station-entry.direction*(entry.distance-car.pathDistance)}:null;
  }
  // Numeric tile key per intersection: same tiles and order as "x:y" strings.
  const spatialTile=(x,y)=>x*4194304+y;
  let spatialMemo=null;
  function indexCars(cars) {
    const index=new Map();
    // Exact broad phase for connector projections; detailed stream/gap checks
    // still decide the leader. Share segment candidates within this observation.
    index.cell=2*cars.reduce((maximum,car)=>Math.max(maximum,car.laneWidth??12),1);
    index.approaching=new Map();
    // Lane changes rebuild this index many times per step without moving
    // anyone. Reuse the connector grid (and its segment candidates) while
    // every car inside an intersection keeps the same identity and position.
    const placed=[];
    for(const car of cars)if(car.intersection!=null)placed.push(car,car.intersection,car.x,car.y);
    const reuse=spatialMemo&&spatialMemo.cell===index.cell&&spatialMemo.placed.length===placed.length&&spatialMemo.placed.every((v,i)=>v===placed[i]);
    if(reuse){index.spatial=spatialMemo.spatial;index.segments=spatialMemo.segments;}
    else {index.spatial=new Map();index.segments=new WeakMap();spatialMemo={cell:index.cell,placed,spatial:index.spatial,segments:index.segments};}
    for(const car of cars) {
      const incoming=approaching(car);
      if(incoming){const key=corridorKey(incoming.road,incoming.direction,incoming.lane);if(!index.approaching.has(key))index.approaching.set(key,[]);index.approaching.get(key).push(incoming);}
      if(car.intersection!=null){
        const key=`intersection:${car.intersection}`;
        if(!index.has(key))index.set(key,[]);
        index.get(key).push(car);
        if(!reuse){
          let tiles=index.spatial.get(car.intersection);if(!tiles)index.spatial.set(car.intersection,tiles=new Map());
          const tile=spatialTile(Math.floor(car.x/index.cell),Math.floor(car.y/index.cell));
          let list=tiles.get(tile);if(!list)tiles.set(tile,list=[]);list.push(car);
        }
      }
      const lanes=new Set([car.lane,car.laneChange?.from,car.laneChange?.to,car.laneIntent?.from,car.laneIntent?.to]);
      for(const lane of lanes)if(lane!=null){
        const key=corridorKey(car.road,car.direction,lane);
        if(!index.has(key))index.set(key,[]);
        index.get(key).push(car);
      }
    }
    trafficIndexes.set(cars,index);
  }
  function connectorCars(index,a,b,ppf,cars){
    if(!index)return cars;
    const cached=index.segments.get(b);if(cached?.a===a)return cached.cars;
    const tolerance=(b.laneWidth??12*ppf)/4,nearby=[],tiles=index.spatial.get(a.intersection);
    if(tiles)for(let x=Math.floor((Math.min(a.x,b.x)-tolerance)/index.cell);x<=Math.floor((Math.max(a.x,b.x)+tolerance)/index.cell);x++)
      for(let y=Math.floor((Math.min(a.y,b.y)-tolerance)/index.cell);y<=Math.floor((Math.max(a.y,b.y)+tolerance)/index.cell);y++){
        const list=tiles.get(spatialTile(x,y));if(list)for(const car of list)nearby.push(car);
      }
    index.segments.set(b,{a,cars:nearby});return nearby;
  }
  const corridor=(cars,road,direction,lane)=>trafficIndexes.get(cars)?.get(corridorKey(road,direction,lane))??(trafficIndexes.has(cars)?[]:cars);
  function neighbors(car,cars,lane=car.lane,arrival=0,intents=false) {
    let front=null,rear=null;
    for(const other of corridor(cars,car.road,car.direction,lane)) {
      if(other.id===car.id||other.road!==car.road||other.direction!==car.direction)continue;
      const reserved=intents&&(other.laneChange?.progress>1e-6&&other.laneChange.to===lane||other.laneIntent?.road===car.road&&[other.laneIntent.from,other.laneIntent.to].includes(lane));
      if(!reserved&&!occupies(other,lane))continue;
      const delta=(other.station+other.direction*(other.speed??0)*arrival-car.station)*car.direction;
      if(delta>=0&&(!front||delta<front.delta))front={car:other,delta};
      if(delta<0&&(!rear||-delta<rear.delta))rear={car:other,delta:-delta};
    }
    const index=trafficIndexes.get(cars),incoming=index?index.approaching.get(corridorKey(car.road,car.direction,lane))??[]:cars.map(approaching).filter(Boolean);
    for(const p of incoming){
      const other=p.car;if(other.id===car.id||p.road!==car.road||p.direction!==car.direction||p.lane!==lane||(other.level??1)!==(car.level??1))continue;
      const delta=(p.station+p.direction*(other.speed??0)*arrival-car.station)*car.direction;
      if(delta>=0&&(!front||delta<front.delta))front={car:other,delta};
      if(delta<0&&(!rear||-delta<rear.delta))rear={car:other,delta:-delta};
    }
    return {front,rear};
  }
  function gap(car,neighbor,ppf) { return neighbor?neighbor.delta-(length(car,ppf)+length(neighbor.car,ppf))/2:Infinity; }
  function safe(car,cars,target,desired,ppf,arrival=0) {
    const found=neighbors(car,cars,target,arrival,true),frontGap=gap(car,found.front,ppf),rearGap=gap(car,found.rear,ppf);
    const limit=-parameter(car.driver,'safeBraking')*ppf/METERS_PER_FOOT;
    const own=acceleration(car.speed,desired,frontGap,found.front?.car.speed??desired,car.driver.headway,ppf,car.driver);
    const follower=found.rear?acceleration(found.rear.car.speed,found.rear.car.desiredSpeed??desired,rearGap,car.speed,found.rear.car.driver?.headway??1.6,ppf,found.rear.car.driver):0;
    return {allowed:frontGap>0&&rearGap>0&&own>=limit&&follower>=-parameter(found.rear?.car.driver,'safeBraking')*ppf/METERS_PER_FOOT,frontGap,rearGap,own,follower,neighbors:found};
  }
  // FHWA-RD-01-103, interchange task analysis, uses 1.5 m/s² in its
  // acceleration-lane model. This is a context-specific MODEL baseline, not
  // a measured national mean. Retain the driver's sampled temperature factor.
  // https://www.fhwa.dot.gov/publications/research/safety/humanfac/01103/ch2.cfm
  const MERGE_ACCELERATION=1.5;
  const mergeProfile=driver=>({...driver,acceleration:parameter(driver,'acceleration')*MERGE_ACCELERATION/PARAMETERS.acceleration});
  const acceleratingTravel=(speed,target,a,time)=>{
    const t=a>0?Math.min(time,Math.max(0,target-speed)/a):0;
    return speed*time+a*t*(time-t/2);
  };
  function mergePreparation(car,desired,ppf,cars=[]) {
    const c=car.mergeContext;if(!c||car.laneChange?.progress>1e-6)return null;
    const probe={...car,road:c.road,lane:c.from,station:c.station,direction:c.direction};
    const n=neighbors(probe,cars,c.to),look=Math.max(desired,car.speed)*car.driver.duration;
    const visible=[n.front,n.rear].filter(n=>n&&n.delta<look),flow=visible.length?Math.max(...visible.map(n=>n.car.speed)):Infinity;
    const target=Math.min(c.limit*(car.driver.speedFactor??1),flow,car.road===c.road?desired:Infinity);
    const requested=Number.isFinite(target)?target:desired,a=parameter(car.driver,'acceleration')*ppf/METERS_PER_FOOT;
    // Reserve the complete lateral maneuver, then use the available lane to
    // approach the fastest attainable entry speed. An unreachable full-speed
    // goal must not cause an immediate low-speed merge at the ramp mouth.
    const duration=car.driver.duration*(c.durationFactor??1);
    const attainable=Math.max(car.speed,-a*duration+Math.sqrt((a*duration)**2+car.speed**2+2*a*Math.max(0,c.remaining)));
    const goal=Math.min(requested,attainable);
    // Within one personal response interval of the goal. Do not demand exact
    // equality from an asymptotic car-following model, or consume the lane
    // needed to complete the full maneuver. Both are numerical planning rules.
    const delay=Math.max(0,(goal-car.speed)/a-car.driver.headway);
    // When nearly ready, do not lose a currently safe gap just to gain the
    // last increment of speed. Use the existing constant-speed traffic
    // forecast and personal response window; admission still checks the
    // real gap again before steering. This is a numerical decision policy.
    const closing=delay>0&&delay<=car.driver.headway+DECISION_INTERVAL&&
      safe(probe,cars,c.to,desired,ppf).allowed&&
      !safe({...probe,station:c.station+c.direction*acceleratingTravel(car.speed,goal,a,delay),speed:Math.min(goal,car.speed+a*delay)},cars,c.to,desired,ppf,delay).allowed;
    // Do not pass up a safe gap to chase a speed that cannot be reached
    // before the lane ends. Continue accelerating through that gap instead.
    return {target:goal,requested,delay,buildingSpeed:delay>0&&requested<=attainable+1e-6&&!closing};
  }
  // Human merge interaction: Kang & Rakha (2020), validated with NGSIM.
  // https://doi.org/10.3390/s20061554
  // We model its cooperative principle, not its fitted game coefficients.
  // Forecasting a future following gap with existing personal headway/a/b and
  // scaling courtesy by MOBIL politeness are explicit numerical policies.
  function mergeCooperation(cars,ppf,freeSpeed) {
    const requests=new Map(),ppm=ppf/METERS_PER_FOOT;
    for(const merger of cars){
      const c=merger.mergeContext;
      if(!c||merger.laneChange?.progress>1e-6)continue;
      const maneuver=merger.path?.maneuvers?.find(m=>m.end>merger.pathDistance);
      if(merger.path?.controls?.some(control=>control.type==='stop'&&!merger.stops?.has(control.marking)&&
        control.distance>=merger.pathDistance&&control.distance<=(maneuver?.start??Infinity)))continue;
      const desired=collisions.desiredSpeed(merger,freeSpeed*(merger.driver.speedFactor??1),parameter(merger.driver,'deceleration')*ppm,ppf);
      const prep=mergePreparation(merger,desired,ppf,cars),target=prep?.target??desired;
      if((c.approachDistance??0)>Math.max(merger.speed,target)*merger.driver.duration)continue;
      const probe={...merger,road:c.road,lane:c.from,station:c.station,direction:c.direction},n=neighbors(probe,cars,c.to);
      const alongside=n.front&&n.front.delta<(length(merger,ppf)+length(n.front.car,ppf))/2?n.front:null;
      const neighbor=n.rear??alongside;if(!neighbor)continue;
      const other=neighbor.car;if(other.laneChange?.progress>1e-6||(other.level??1)!==(merger.level??1))continue;
      if(other.mergeContext){
        const o=other.mergeContext;
        // In a weave both drivers can be preparing opposite changes. Let the
        // forward driver open a rear gap first, instead of exempting both from
        // cooperation and allowing them to reach the fork side by side.
        // Longitudinal order / ID ties are a numerical coordination policy.
        const ahead=(c.station-o.station)*c.direction;
        if(o.road!==c.road||o.from!==c.to||o.to!==c.from||ahead<0||ahead===0&&merger.id>other.id)continue;
      }
      const horizon=merger.driver.duration*(c.durationFactor??1),range=Math.max(target,other.speed)*horizon;
      if(neighbor.delta>range||!(parameter(other.driver,'politeness')>0))continue;
      const delta=neighbor===n.rear?neighbor.delta:-neighbor.delta;
      const travel=acceleratingTravel(merger.speed,target,parameter(merger.driver,'acceleration')*ppm,horizon);
      const spacing=parameter(other.driver,'jamGap')*ppm+other.speed*other.driver.headway+(length(merger,ppf)+length(other,ppf))/2;
      const required=2*(delta+travel-spacing-other.speed*horizon)/(horizon*horizon);
      if(required>=0)continue;
      const willingness=Math.min(1,parameter(other.driver,'politeness')/PARAMETERS.politeness);
      const floor=Math.max(0,Math.min(other.speed,target)-parameter(other.driver,'deceleration')*ppm*other.driver.headway);
      const response=Math.max(-parameter(other.driver,'deceleration')*ppm*willingness,required,
        (floor-other.speed)/horizon);
      const previous=requests.get(other.id);
      if(!previous||neighbor.delta<previous.distance)requests.set(other.id,{merger:merger.id,context:c,acceleration:Math.min(0,response),distance:neighbor.delta});
    }
    return requests;
  }
  // FHWA's merge task separates acceleration/speed matching, gap search and
  // merge steering: https://www.fhwa.dot.gov/publications/research/safety/humanfac/01103/ch2.cfm
  // Slot prediction below is a numerical policy using the existing personal
  // headway/duration/a/b, not an empirically fitted critical-gap distribution.
  function mergeApproach(car,cars,change,desired,ppf){
    if(car.laneChange?.progress>1e-6)return null;
    const remaining=change.start-car.pathDistance,window=car.speed*(car.driver.duration+car.driver.headway)+car.speed*car.speed/(2*parameter(car.driver,'deceleration')*ppf/METERS_PER_FOOT);
    if(remaining>window)return null;
    // A ramp can approach a merge immediately after a road joint. Project
    // its remaining approach distance into that corridor's station system
    // instead of treating the joint as a mandatory halt.
    const direction=car.path?.points.find(p=>p.maneuver?.road===change.road)?.direction??car.direction;
    const probe=car.road===change.road?car:{...car,road:change.road,lane:change.from,direction,station:change.station-direction*Math.max(0,remaining)};
    const found=neighbors(probe,cars,change.to),front=found.front,rear=found.rear;
    if(!front&&!rear)return null;
    const look=Math.max(desired,car.speed)*(car.driver.duration+car.driver.headway);
    if((front?.delta??Infinity)>look&&(rear?.delta??Infinity)>look)return null;
    const duration=car.driver.duration,headway=car.driver.headway,s0=parameter(car.driver,'jamGap')*ppf/METERS_PER_FOOT;
    const safeFront=front?s0+Math.max(car.speed,front.car.speed)*headway+(length(car,ppf)+length(front.car,ppf))/2:0;
    const safeRear=rear?s0+rear.car.speed*(rear.car.driver?.headway??headway)+(length(car,ppf)+length(rear.car,ppf))/2:0;
    let target;
    if(front&&rear){
      const upper=front.delta+front.car.speed*duration-safeFront;
      const lower=-rear.delta+rear.car.speed*duration+safeRear;
      // A closed slot is not permission to force in. Match the stream while
      // continuing to search; actual front/rear safety is rechecked before steering.
      target=lower<=upper?(lower+upper)/(2*duration):(front.car.speed+rear.car.speed)/2;
    }else if(front)target=front.car.speed+(front.delta-safeFront)/duration;
    // With clear lane ahead, accelerate to open a gap ahead of rear traffic.
    // Matching only the rear car's speed locks adjacent drivers alongside one
    // another; once both slow, that old rule drives both targets toward zero.
    else target=desired;
    // Acceleration precedes gap positioning in the cited FHWA merge sequence.
    // A slot behind a nearby faster vehicle must not tell an already slower
    // driver to brake. Approach at least the slower observed stream speed,
    // within the local road/curve target, and search farther along the lane.
    // This target bound is a numerical policy, not a calibrated distribution;
    // actual queues, controls, lane-end room and gap admission remain separate.
    const flow=Math.min(front?.car.speed??Infinity,rear?.car.speed??Infinity);
    return {speed:Math.max(0,Math.min(desired,Math.max(flow,target))),delay:headway+car.speed/(2*parameter(car.driver,'deceleration')*ppf/METERS_PER_FOOT),front:front?.car.id,rear:rear?.car.id};
  }
  // Static per-path segment layout for leader(): connector segments, and
  // maximal runs of one lane's samples with a monotonic station chain.
  const segmentPlans=new WeakMap();
  function segmentPlan(path){
    let plan=segmentPlans.get(path);if(plan)return plan;
    plan={connectors:[],runs:[]};
    for(let i=1;i<path.points.length;i++){
      const a=path.points[i-1],b=path.points[i];
      if(a.intersection!=null&&a.intersection===b.intersection)plan.connectors.push(i);
      if(b.road==null||a.road!==b.road)continue;
      const start=a.station,span=b.station-start;
      if(!Number.isFinite(start)||!Number.isFinite(span)||Math.abs(span)<1e-9)continue;
      const run=plan.runs.at(-1),direction=b.direction??1;
      if(run&&run.road===b.road&&run.direction===direction&&run.lane===b.lane&&run.last===i-1&&run.sign===Math.sign(span))run.last=i;
      else plan.runs.push({road:b.road,direction,lane:b.lane,first:i,last:i,sign:Math.sign(span)});
    }
    segmentPlans.set(path,plan);return plan;
  }
  function leader(car,cars,ppf,desired) {
    const lanes=new Set([car.laneChange?.progress>=1-1e-6?car.laneChange.to:car.lane]);
    if(car.laneChange&&(car.laneChange.progress??1)>1e-6){lanes.add(car.laneChange.to);if(car.laneChange.progress<1-1e-6&&occupies(car,car.laneChange.from))lanes.add(car.laneChange.from);else lanes.delete(car.laneChange.from);}
    let best=null;
    // While straddling lanes, a nearer fast car in one lane must not hide a
    // slower leader in the other. Observe the more restrictive IDM response.
    const changing=car.laneChange&&(car.laneChange.progress??0)>1e-6&&car.laneChange.progress<1-1e-6;
    const response=(other,clear)=>acceleration(car.speed,desired,clear,other.speed,car.driver.headway,ppf,car.driver);
    const stronger=(other,clear)=>!best||(changing?response(other,clear)<response(best.car,best.gap):clear<best.gap);
    for(const lane of lanes){const current=neighbors(car,cars,lane).front;if(current){const clear=gap(car,current,ppf);if(stronger(current.car,clear))best={car:current.car,gap:clear};}}
    // Continue looking along the connected path beyond the current road end.
    // Semantic road/lane identities keep unjoined crossings and bridges apart.
    const look=desired*(car.driver.duration+car.driver.headway)+desired*desired/(2*parameter(car.driver,'deceleration')*ppf/METERS_PER_FOOT);
    const path=car.path;
    if(!path)return best;
    // Paths are long (lane-change and curve samples): start at the first
    // segment reaching the car instead of rescanning from the path start.
    let first=1,last=path.lengths.length;
    while(first<last){const mid=(first+last)>>1;if(path.lengths[mid]<car.pathDistance)first=mid+1;else last=mid;}
    // Visit only this path's connector segments and lane runs inside the
    // look-ahead window [from, until): the same segments, in the same order.
    const plan=segmentPlan(path),from=Math.max(1,first),limit=car.pathDistance+look;
    let until=from;{let hi=path.points.length;while(until<hi){const mid=(until+hi)>>1;if(path.lengths[mid-1]>limit)hi=mid;else until=mid+1;}}
    const events=[],groups=[];
    let c=0,hiC=plan.connectors.length;while(c<hiC){const mid=(c+hiC)>>1;if(plan.connectors[mid]<from)c=mid+1;else hiC=mid;}
    for(;c<plan.connectors.length&&plan.connectors[c]<until;c++) {
      const i=plan.connectors[c],a=path.points[i-1],b=path.points[i];
      {
        // Shared connector geometry identifies the same stream through a ring
        // or turn. Cars on a different crossing/bridge cannot become leaders.
        const index=trafficIndexes.get(cars),nearby=connectorCars(index,a,b,ppf,cars);
        const dx=b.x-a.x,dy=b.y-a.y,squared=dx*dx+dy*dy;
        if(squared>1e-12)for(let j=0;j<nearby.length;j++) {const other=nearby[j];
          if(other.id===car.id||other.intersection!==a.intersection)continue;
          // A feeder waiting outside an explicit road merge is governed by
          // conflict admission, not a projected leader in the through lane.
          // Once it enters, the actual body joins normal following.
          if(a.junction?.roadMerge&&other.road!==car.road&&!other.entryCommitted&&
            other.path?.movements?.some(m=>m.intersection===a.intersection&&m.junction?.input!==a.junction.input&&m.end>=other.pathDistance))continue;
          const f=((other.x-a.x)*dx+(other.y-a.y)*dy)/squared;
          if(f<0||f>1)continue;
          // Numerical corridor matching, not calibrated perception parameters:
          // quarter-lane lateral tolerance and matching forward tangents.
          const tolerance=Math.min(other.laneWidth??12*ppf,b.laneWidth??12*ppf)/4;
          if(Math.hypot(other.x-a.x-dx*f,other.y-a.y-dy*f)>tolerance)continue;
          const radians=(other.angle??0)*Math.PI/180;
          if((Math.cos(radians)*dx+Math.sin(radians)*dy)/Math.sqrt(squared)<.9)continue;
          const ahead=path.lengths[i-1]+(path.lengths[i]-path.lengths[i-1])*f-car.pathDistance;
          if(ahead<0||ahead>look)continue;
          // Follow a body occupying this corridor now, even when its route
          // turns away shortly ahead. Requiring matching future body-length
          // paths hid slow turning cars until the hard collision safeguard.
          // Lateral/tangent and symmetric ordering checks still separate lanes.
          const halfLength=(length(car,ppf)+length(other,ppf))/2;
          if(Math.hypot(other.x-car.x,other.y-car.y)<halfLength) {
            // Overlapping merge projections can each put the other car just
            // ahead on its own curve. Use one symmetric forward ordering to
            // prevent mutual-leader deadlock; exact ties keep the older ID.
            // This resolves numerical overlap, not an empirical priority rule.
            const own=(car.angle??0)*Math.PI/180;
            const forward=(other.x-car.x)*(Math.cos(own)+Math.cos(radians))+(other.y-car.y)*(Math.sin(own)+Math.sin(radians));
            if(forward< -1e-6||Math.abs(forward)<=1e-6&&other.id>car.id)continue;
          }
          const clear=ahead-halfLength;
          events.push({i,phase:0,order:j,car:other,clear});
        }
      }
    }
    // Only interpolate stations within one road. A connector-to-mouth
    // sample has no road interval: mapping every downstream car to f=0
    // invents a stopped obstacle at the mouth, regardless of its distance.
    for(const run of plan.runs){
      if(run.last<from||run.first>=until||run.road===car.road)continue;
      groups.push({road:run.road,direction:run.direction,lane:run.lane,first:Math.max(run.first,from),last:Math.min(run.last,until-1),sign:run.sign});
    }
    // Each consecutive run of one lane's samples is a monotonic station chain.
    // Scan its corridor once and locate each car's sample(s) by station; the
    // per-sample formula and filters are unchanged.
    const points=path.points;
    for(const group of groups){
      const ascending=group.sign>0,corridorCars=corridor(cars,group.road,group.direction,group.lane);
      for(let k=0;k<corridorCars.length;k++){
        const other=corridorCars[k];
        if(other.id===car.id||other.road!==group.road||other.direction!==group.direction||!occupies(other,group.lane))continue;
        let lo=group.first,hi=group.last+1;
        while(lo<hi){const mid=(lo+hi)>>1,end=points[mid-1].station+(points[mid].station-points[mid-1].station);if(ascending?end<other.station:end>other.station)lo=mid+1;else hi=mid;}
        for(let i=Math.max(group.first,lo-2);i<=Math.min(group.last,lo+2);i++){
          const start=points[i-1].station,span=points[i].station-start,f=(other.station-start)/span;
          if(f<0||f>1)continue;
          const ahead=path.lengths[i-1]+(path.lengths[i]-path.lengths[i-1])*f-car.pathDistance;
          if(ahead<0||ahead>look)continue;
          events.push({i,phase:1,order:k,car:other,clear:ahead-(length(car,ppf)+length(other,ppf))/2});
        }
      }
    }
    // Apply candidates in the original path/corridor order so equal gaps
    // resolve exactly as a sample-by-sample scan would.
    events.sort((x,y)=>x.i-y.i||x.phase-y.phase||x.order-y.order);
    for(const event of events)if(stronger(event.car,event.clear))best={car:event.car,gap:event.clear};
    return best;
  }
  function assess(context,cars,driver,speed,ppf) {
    const probe={id:-1,road:context.road,lane:context.from,station:context.station,direction:context.direction,
      speed,driver,laneWidth:12*ppf};
    const found=neighbors(probe,cars,context.to,context.arrival);
    const front=gap(probe,found.front,ppf),rear=gap(probe,found.rear,ppf),jam=parameter(driver,'jamGap')*ppf/METERS_PER_FOOT;
    return Math.max(0,jam+speed*driver.headway-front)+Math.max(0,jam+(found.rear?.car.speed??speed)*(found.rear?.car.driver?.headway??driver.headway)-rear);
  }
  function queueGain(car,cars,target,desired,ppf) {
    const signal=car.signalControl;
    if(!signal||signal.aspect!=='red'||signal.allowed||signal.remaining<=0)return 0;
    const here=neighbors(car,cars).front;if(!here)return 0;
    const jam=parameter(car.driver,'jamGap')*ppf/METERS_PER_FOOT;
    // Plan while approaching red, before the leader settles into its queue.
    // Waiting for a near-stationary leader left too little room to finish the
    // maneuver and stranded cars across two lanes. Retain the planning horizon.
    if(here.delta>desired*(car.driver.duration+car.driver.headway)+desired*desired/(2*parameter(car.driver,'deceleration')*ppf/METERS_PER_FOOT))return 0;
    const check=safe(car,cars,target,desired,ppf);if(!check.allowed)return 0;
    const available=Math.max(0,Math.min(check.frontGap-jam,signal.remaining)),current=Math.max(0,gap(car,here,ppf)-jam),space=length(car,ppf)+jam,gain=available-current;
    // Prefer space for at least one complete queued vehicle before braking
    // into the longer queue. This geometric packing policy supplements MOBIL,
    // whose instantaneous acceleration advantage vanishes far from a red queue.
    // Legal route/turn sequence, full maneuver room and body safety still apply.
    // Match the stop-line tolerance: sampled path distance and lane station
    // differ slightly on curves, including a queue exactly one slot longer.
    return gain>=space-.001*ppf?gain/space:0;
  }
  function incentiveScore(car,cars,target,desired,ppf) {
    const current=leader(car,cars,ppf,desired),old=acceleration(car.speed,desired,current?.gap??Infinity,current?.car.speed??desired,car.driver.headway,ppf,car.driver);
    const check=safe(car,cars,target,desired,ppf);
    if(!check.allowed)return -Infinity;
    const rear=check.neighbors.rear;
    let burden=0;
    if(rear) {
      const before=neighbors(rear.car,cars,target).front;
      const oldRear=acceleration(rear.car.speed,rear.car.desiredSpeed??desired,gap(rear.car,before,ppf),before?.car.speed??desired,rear.car.driver?.headway??1.6,ppf,rear.car.driver);
      burden=Math.max(0,oldRear-check.follower);
    }
    return check.own-old-parameter(car.driver,'politeness')*burden-parameter(car.driver,'incentive')*ppf/METERS_PER_FOOT;
  }
  const incentive=(car,cars,target,desired,ppf)=>incentiveScore(car,cars,target,desired,ppf)>0;
  const api={collisions,indexCars,PARAMETERS,BASELINE,DEFAULT_TEMPERATURE,temperatureModel,parameter,STEP,DECISION_INTERVAL,profile,mergeProfile,mergePreparation,mergeCooperation,length,acceleration,neighbors,gap,safe,mergeApproach,leader,assess,incentive,incentiveScore,queueGain};
  (globalThis.StripeMaker??={}).simulatorDrivers=api;
  if(typeof module!=='undefined')module.exports=api;
})();
