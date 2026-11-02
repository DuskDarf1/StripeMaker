/* Driver observations and variability (SI model parameters, converted to pixels).
   NHTSA DOT HS 809 702: Table 3.38 duration mean 6.28 s, SD 2.0 s;
   Table 1.1 / Fancher field data: following headway mean 1.6 s, SD 0.8 s.
   https://www.nhtsa.gov/sites/nhtsa.gov/files/documents/lane_change_final.pdf
   Positive lognormal distributions match these moments; their family and
   independence are modeling assumptions, NOT fits to the raw observations.
   IDM Table I: a=.73 m/s², b=1.67 m/s², s0=2 m, exponent=4:
   https://arxiv.org/abs/cond-mat/0002177
   MOBIL author reference: safe braking=4 m/s², incentive=.2 m/s²;
   politeness=.3 is a selected value within its published typical 0–.5 range:
   https://mtreiber.de/MicroApplet/MOBIL.html
   These highway baselines are not site-calibrated or an occlusion/signal model. */
(() => {
  const METERS_PER_FOOT=.3048;
  const PARAMETERS={acceleration:.73,deceleration:1.67,jamGap:2,exponent:4,safeBraking:4,incentive:.2,politeness:.3};
  const STEP=.05, DECISION_INTERVAL=.2; // numerical integration and decision cadence
  function lognormal(random,mean,sd) {
    const variance=Math.log(1+(sd/mean)**2);
    const z=Math.sqrt(-2*Math.log(Math.max(Number.EPSILON,1-random())))*Math.cos(2*Math.PI*random());
    return Math.exp(Math.log(mean)-variance/2+Math.sqrt(variance)*z);
  }
  const profile=random=>({duration:lognormal(random,6.28,2),headway:lognormal(random,1.6,.8)});
  const length=(car,ppf)=>Math.max(ppf,(car.laneWidth??12*ppf)-2*ppf)*381/214;
  const occupies=(car,lane)=>car.lane===lane||car.laneChange&&(car.laneChange.from===lane||car.laneChange.to===lane);
  function acceleration(speed,desired,gap,leaderSpeed,headway,ppf) {
    if(!(desired>0))return 0;
    const ppm=ppf/METERS_PER_FOOT,a=PARAMETERS.acceleration*ppm,b=PARAMETERS.deceleration*ppm,s0=PARAMETERS.jamGap*ppm;
    const wanted=s0+Math.max(0,speed*headway+speed*(speed-leaderSpeed)/(2*Math.sqrt(a*b)));
    return a*(1-(speed/desired)**PARAMETERS.exponent-(Number.isFinite(gap)?(wanted/Math.max(.001*ppm,gap))**2:0));
  }
  const trafficIndexes=new WeakMap();
  const corridorKey=(road,direction,lane)=>`${road}:${direction}:${lane}`;
  function indexCars(cars) {
    const index=new Map();
    for(const car of cars) {
      const lanes=new Set([car.lane,car.laneChange?.from,car.laneChange?.to]);
      for(const lane of lanes)if(lane!=null){
        const key=corridorKey(car.road,car.direction,lane);
        if(!index.has(key))index.set(key,[]);
        index.get(key).push(car);
      }
    }
    trafficIndexes.set(cars,index);
  }
  const corridor=(cars,road,direction,lane)=>trafficIndexes.get(cars)?.get(corridorKey(road,direction,lane))??(trafficIndexes.has(cars)?[]:cars);
  function neighbors(car,cars,lane=car.lane,arrival=0) {
    let front=null,rear=null;
    for(const other of corridor(cars,car.road,car.direction,lane)) {
      if(other.id===car.id||other.road!==car.road||other.direction!==car.direction||!occupies(other,lane))continue;
      const delta=(other.station+other.direction*(other.speed??0)*arrival-car.station)*car.direction;
      if(delta>=0&&(!front||delta<front.delta))front={car:other,delta};
      if(delta<0&&(!rear||-delta<rear.delta))rear={car:other,delta:-delta};
    }
    return {front,rear};
  }
  function gap(car,neighbor,ppf) { return neighbor?neighbor.delta-(length(car,ppf)+length(neighbor.car,ppf))/2:Infinity; }
  function safe(car,cars,target,desired,ppf) {
    const found=neighbors(car,cars,target),frontGap=gap(car,found.front,ppf),rearGap=gap(car,found.rear,ppf);
    const limit=-PARAMETERS.safeBraking*ppf/METERS_PER_FOOT;
    const own=acceleration(car.speed,desired,frontGap,found.front?.car.speed??desired,car.driver.headway,ppf);
    const follower=found.rear?acceleration(found.rear.car.speed,desired,rearGap,car.speed,found.rear.car.driver?.headway??1.6,ppf):0;
    return {allowed:frontGap>0&&rearGap>0&&own>=limit&&follower>=limit,frontGap,rearGap,own,follower,neighbors:found};
  }
  function leader(car,cars,ppf,desired) {
    const found=neighbors(car,cars),current=found.front;
    let best=current?{car:current.car,gap:gap(car,current,ppf)}:null;
    // Continue looking along the connected path beyond the current road end.
    // Semantic road/lane identities keep unjoined crossings and bridges apart.
    const look=desired*(car.driver.duration+car.driver.headway)+desired*desired/(2*PARAMETERS.deceleration*ppf/METERS_PER_FOOT);
    const path=car.path;
    if(!path)return best;
    for(let i=1;i<path.points.length;i++) {
      if(path.lengths[i]<car.pathDistance)continue;
      if(path.lengths[i-1]>car.pathDistance+look)break;
      const a=path.points[i-1],b=path.points[i];
      if(b.road==null||b.road===car.road)continue;
      const start=a.road===b.road?a.station:(b.direction===-1?Infinity:0);
      const span=b.station-start;
      for(const other of corridor(cars,b.road,b.direction??1,b.lane)) {
        if(other.id===car.id||other.road!==b.road||other.direction!==(b.direction??1)||!occupies(other,b.lane))continue;
        const f=span&&Number.isFinite(span)?(other.station-start)/span:0;
        if(f<0||f>1)continue;
        const ahead=path.lengths[i-1]+(path.lengths[i]-path.lengths[i-1])*f-car.pathDistance;
        if(ahead<0||ahead>look)continue;
        const clear=ahead-(length(car,ppf)+length(other,ppf))/2;
        if(!best||clear<best.gap)best={car:other,gap:clear};
      }
    }
    return best;
  }
  function assess(context,cars,driver,speed,ppf) {
    const probe={id:-1,road:context.road,lane:context.from,station:context.station,direction:context.direction,
      speed,driver,laneWidth:12*ppf};
    const found=neighbors(probe,cars,context.to,context.arrival);
    const front=gap(probe,found.front,ppf),rear=gap(probe,found.rear,ppf),jam=PARAMETERS.jamGap*ppf/METERS_PER_FOOT;
    return Math.max(0,jam+speed*driver.headway-front)+Math.max(0,jam+(found.rear?.car.speed??speed)*(found.rear?.car.driver?.headway??driver.headway)-rear);
  }
  function incentive(car,cars,target,desired,ppf) {
    const current=leader(car,cars,ppf,desired),old=acceleration(car.speed,desired,current?.gap??Infinity,current?.car.speed??desired,car.driver.headway,ppf);
    const check=safe(car,cars,target,desired,ppf);
    if(!check.allowed)return false;
    const rear=check.neighbors.rear;
    let burden=0;
    if(rear) {
      const before=neighbors(rear.car,cars,target).front;
      const oldRear=acceleration(rear.car.speed,desired,gap(rear.car,before,ppf),before?.car.speed??desired,rear.car.driver?.headway??1.6,ppf);
      burden=Math.max(0,oldRear-check.follower);
    }
    return check.own-old>PARAMETERS.politeness*burden+PARAMETERS.incentive*ppf/METERS_PER_FOOT;
  }
  const api={indexCars,PARAMETERS,STEP,DECISION_INTERVAL,profile,lognormal,length,acceleration,neighbors,gap,safe,leader,assess,incentive};
  (globalThis.StripeMaker??={}).simulatorDrivers=api;
  if(typeof module!=='undefined')module.exports=api;
})();
