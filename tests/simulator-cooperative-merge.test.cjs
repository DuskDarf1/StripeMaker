const {test}=require('node:test'),assert=require('node:assert/strict');
const B=require('../js/simulator-drivers.js'),V=require('../js/simulator-vehicles.js'),C=require('../js/simulator-lane-changes.js');
const random=(state=7)=>()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
const lanes=[0,1,2].map(lane=>({road:1,lane,stations:[0,2000],points:[0,2000].map(station=>({x:station,y:lane*12,lateral:lane*12,station,road:1,lane,direction:1,laneWidth:12}))}));
const actor=(id,lane,station,speed)=>{const path=V.preparePath(C.slice(lanes[lane],0,2000));return {id,path,pathDistance:station,distance:station,speed,driver:B.profile(()=>.5,0),decisionAt:0,committed:new Set(),route:{},...V.position(path,station)};};
test('delayed gap searches retain room for a full accelerating lane change near the fork',()=>{
 for(const direction of [1,-1]){
  const options={station:direction>0?1990:10,direction,speed:.1,target:.1,acceleration:3,duration:6,delay:1,pixelsPerFoot:1,reserveSpeed:70};
  assert.equal(C.rollingTransition(lanes[2],lanes[1],{},options),null,'do not compress steering into a nearly sideways crawl');
  const ready={...options,station:direction>0?1800:200,speed:0,target:70};
  const plan=C.rollingTransition(lanes[2],lanes[1],{},ready);assert(plan,'a stopped driver with room can accelerate into a full maneuver');
  const m=plan.points.filter(p=>p.maneuver);assert(Math.abs(m.at(-1).station-m[0].station)>=.5*3*6*6);
 }
});
function fixture(blocked=false,{target=40,entry=20}={}){
 const ramp=actor(1,2,100,entry),main=actor(2,1,90,target);
 ramp.path=V.preparePath([...C.slice(lanes[2],100,600),...C.transition(lanes[2],lanes[1],600,900,{},2000),...C.slice(lanes[1],900,2000)]);ramp.pathDistance=0;
 const approaches=new WeakMap();
 ramp.route.mergeContext=c=>{if(!c.path.maneuvers.some(m=>m.end>c.pathDistance))return null;let approachPath=approaches.get(c.path);if(!approachPath){approachPath=V.preparePath(C.slice(lanes[2],c.path.points[0].station,2000));approaches.set(c.path,approachPath);}return {road:1,from:2,to:1,direction:1,station:c.station,remaining:2000-c.station,limit:target,approachPath};};
 ramp.route.replan=({car,mergeDelay=0,mergeSpeed,speed})=>{const result=C.rollingTransition(lanes[2],lanes[1],{},{station:car.station,direction:1,speed:car.speed,target:mergeSpeed??speed,acceleration:car.driver.acceleration/.3048,duration:car.driver.duration,delay:mergeDelay,pixelsPerFoot:1});return result?[...result.points,...C.slice(lanes[1],result.station,2000)]:null;};
 main.route.passing=()=>[0,2];main.route.replan=({car,target,cooperative})=>{assert(cooperative);assert.equal(target,0,'move away from the ramp, never into it');const result=C.rollingTransition(lanes[1],lanes[0],{blocked:blocked?[[0,1]]:[]},{station:car.station,direction:1,speed:car.speed,target,acceleration:car.driver.acceleration/.3048,duration:car.driver.duration,delay:0,pixelsPerFoot:1});return result?[...result.points,...C.slice(lanes[0],result.station,2000)]:null;};
 const engine=new V.Engine({behavior:B,speed:target,pixelsPerFoot:1,temperature:0,random:()=>.5});engine.cars=[ramp,main];engine.recoverStuck=()=>{};return {engine,ramp,main};
}
test('ramp acceleration uses the cited model context and preserves each temperature profile',()=>{
 for(const t of [0,20,75,100]){const original=B.profile(random(19),t),merge=B.mergeProfile(original);assert.equal(merge.acceleration,original.acceleration*1.5/.73);assert.equal(merge.headway,original.headway);assert.equal(merge.deceleration,original.deceleration);assert.equal(original.acceleration, B.profile(random(19),t).acceleration);}
 const {engine,ramp,main}=fixture(),cruise=ramp.driver,mainCruise=main.driver;engine.driverStep(1/60);assert.equal(ramp.driver.acceleration,1.5);assert.strictEqual(main.driver,mainCruise);
 ramp.route.mergeContext=()=>null;engine.driverStep(1/60);assert.strictEqual(ramp.driver,cruise,'restore cruise response after the merge');
});
test('mainline cooperation opens a future gap with bounded personal braking and no unrelated-road response',()=>{
 const {ramp,main}=fixture();ramp.mergeContext=ramp.route.mergeContext(ramp);ramp.driver=B.mergeProfile(ramp.driver);let cars=[ramp,main];B.indexCars(cars);
 const request=B.mergeCooperation(cars,1,40).get(main.id);assert(request);assert(request.acceleration<0);assert(request.acceleration>=-main.driver.deceleration/.3048);
 main.driver={...main.driver,politeness:0};assert.equal(B.mergeCooperation(cars,1,40).size,0);
 main.driver=B.profile(()=>.5,0);main.road=9;B.indexCars(cars);assert.equal(B.mergeCooperation(cars,1,40).size,0);
 main.road=1;main.level=2;B.indexCars(cars);assert.equal(B.mergeCooperation(cars,1,40).size,0);
});
test('a receiving driver changes to a safe legal lane or gently opens the gap when that change is forbidden',()=>{
 for(const blocked of [false,true]){const {engine,ramp,main}=fixture(blocked);engine.driverStep(1/60);
  if(blocked){assert(!main.laneChange);assert(main.speed<40);assert(main.speed>=40-main.driver.deceleration/.3048/60);assert(main.cooperativeSeconds>0);}
  else {assert(main.laneChange?.progress>0);assert.equal(main.laneChange.to,0);assert.equal(main.cooperativeChanges,1);}
  assert(ramp.speed>20);assert(!ramp.laneChange||ramp.laneChange.progress===0);
 }
});
test('ramp drivers build speed before using an open merge gap, reserving a complete maneuver',()=>{
 const {engine,ramp}=fixture();engine.cars=[ramp];let entry=null;
 for(let i=0;i<1200;i++){engine.advance(1/60);if(ramp.laneChange?.progress>0){entry=ramp.speed;break;}}
 assert(entry!=null);assert(entry>=40-ramp.driver.acceleration/.3048*ramp.driver.headway-.1,'approaches target before steering');
 const c={...ramp,laneChange:undefined,speed:20,mergeContext:{road:1,from:2,to:1,station:100,direction:1,remaining:300,limit:70}};
 const preparation=B.mergePreparation(c,70,1);assert(preparation.target>20);assert(preparation.target<70);assert(!preparation.buildingSpeed,'an unattainable target must not discard an available safe gap');
});
test('an unserved STOP before merging cannot request courtesy priority from mainline traffic',()=>{
 const {ramp,main}=fixture();ramp.mergeContext=ramp.route.mergeContext(ramp);ramp.driver=B.mergeProfile(ramp.driver);ramp.path.controls=[{type:'stop',marking:'bar',distance:200}];
 B.indexCars([ramp,main]);assert.equal(B.mergeCooperation([ramp,main],1,40).size,0);
 ramp.stops=new Map([['bar',0]]);assert(B.mergeCooperation([ramp,main],1,40).has(main.id));
});
test('temperature changes courtesy response without removing comfortable-braking bounds',()=>{
 const responses=[];
 for(const temperature of [0,75]){const {ramp,main}=fixture();ramp.mergeContext=ramp.route.mergeContext(ramp);ramp.driver=B.mergeProfile(B.profile(random(19),temperature));main.driver=B.profile(random(23),temperature);
  const request=B.mergeCooperation([ramp,main],1,40).get(main.id);assert(request);assert(request.acceleration>=-main.driver.deceleration/.3048);responses.push(request.acceleration);
 }
 assert.notEqual(responses[0],responses[1]);
});
test('opposite weaving requests cooperate in longitudinal order instead of exempting each other',()=>{
 for(const temperature of [0,75,100])for(const direction of [1,-1]){
  const {ramp,main}=fixture();
  ramp.driver=B.mergeProfile(B.profile(random(19),temperature));main.driver=B.mergeProfile(B.profile(random(23),temperature));
  ramp.direction=main.direction=direction;main.station=ramp.station-direction*10;
  ramp.mergeContext={road:1,from:2,to:1,station:ramp.station,direction,remaining:1900,limit:40};
  main.mergeContext={road:1,from:1,to:2,station:main.station,direction,remaining:1900,limit:40};
  const cars=[ramp,main];B.indexCars(cars);
  const requests=B.mergeCooperation(cars,1,40);
  assert(requests.has(main.id),'rear driver opens space for the forward driver');
  assert(!requests.has(ramp.id),'no reciprocal courtesy braking');
  assert(requests.get(main.id).acceleration>=-main.driver.deceleration/.3048);
 }
});
test('a merge with only slow rear traffic targets acceleration while rejecting the occupied gap',()=>{
 for(const direction of [1,-1])for(const ppf of [1,6]){
  const driver=B.profile(()=>.5,0),me={id:1,road:1,lane:0,station:100*ppf,direction,speed:5*ppf,laneWidth:12*ppf,driver,pathDistance:0};
  const rear={...me,id:2,lane:1,station:me.station-direction*2*ppf,speed:4*ppf};
  const change={road:1,from:0,to:1,start:0},cars=[me,rear];B.indexCars(cars);
  assert.equal(B.mergeApproach(me,cars,change,40*ppf,ppf).speed,40*ppf,'do not match the rear car down toward zero');
  assert(!B.safe(me,cars,1,40*ppf,ppf).allowed,'acceleration is not permission to enter an occupied gap');
 }
});
test('two drivers exchanging lanes open a moving gap and complete both maneuvers',()=>{
 const {engine,ramp,main}=fixture();
 for(const c of [ramp,main]){
  const from=c.lane,to=from===2?1:2,start=c.station;
  c.path=V.preparePath([...C.slice(lanes[from],start,600),...C.transition(lanes[from],lanes[to],600,900,{},2000),...C.slice(lanes[to],900,2000)]);c.pathDistance=0;
  const approaches=new WeakMap();
  c.route={passing:()=>[],mergeContext:car=>{
   if(!car.path.maneuvers.some(m=>m.end>car.pathDistance+1e-6))return null;
   let approachPath=approaches.get(car.path);if(!approachPath){approachPath=V.preparePath(C.slice(lanes[from],car.path.points[0].station,2000));approaches.set(car.path,approachPath);}
   return {road:1,from,to,station:car.station,direction:1,remaining:2000-car.station,limit:40,approachPath};
  },replan:({car,mergeDelay=0,mergeSpeed,speed})=>{
   const crossing=C.rollingTransition(lanes[from],lanes[to],{},{station:car.station,direction:1,speed:car.speed,target:mergeSpeed??speed,acceleration:car.driver.acceleration/.3048,duration:car.driver.duration,delay:mergeDelay,pixelsPerFoot:1});
   return crossing?[...crossing.points,...C.slice(lanes[to],crossing.station,2000)]:null;
  }};
 }
 let minimum=Infinity;
 for(let i=0;i<1800&&engine.cars.length;i++){engine.advance(1/30);for(const c of engine.cars)minimum=Math.min(minimum,c.speed);}
 assert.equal(engine.cars.length,0,'both leave through their chosen lanes');
 assert(minimum>5,'the exchange must not create a creeping/stationary queue');
 assert.equal(engine.collisionInterventions,0);
});
test('courtesy never forces a mainline lane change into an occupied adjacent lane',()=>{
 const {engine,main}=fixture();engine.cars.push(actor(3,0,91,40));main.route.replan=()=>{throw Error('unsafe adjacent gap must not be proposed');};
 engine.driverStep(1/60);assert(!main.laneChange);assert(main.speed<40);assert.equal(main.cooperativeChanges??0,0);
});
test('mainline drivers can receive an approaching merge request before the road joint, within a bounded horizon',()=>{
 const {ramp,main}=fixture();ramp.road=9;ramp.mergeContext={road:1,from:2,to:1,station:-100,direction:1,remaining:2100,approachDistance:100,limit:40};ramp.driver=B.mergeProfile(ramp.driver);
 main.path=V.preparePath([{x:-300,y:12,road:8,lane:1,station:0,direction:1,laneWidth:12},{x:0,y:12,road:8,lane:1,station:300,direction:1,laneWidth:12},...C.slice(lanes[1],0,2000)]);main.pathDistance=190;Object.assign(main,V.position(main.path,190));
 assert(B.mergeCooperation([ramp,main],1,40).has(main.id));ramp.mergeContext.approachDistance=10000;assert.equal(B.mergeCooperation([ramp,main],1,40).size,0);
});

test('a 30-mph ramp entrant accelerates toward 70-mph traffic while the receiving driver makes room',()=>{
 const target=70*5280/3600,entry=30*5280/3600;
 for(const blocked of [false,true]){
  const {engine,ramp,main}=fixture(blocked,{target,entry});let steering=null,minimum=entry;
  for(let i=0;i<1800;i++){engine.advance(1/60);minimum=Math.min(minimum,ramp.speed);if(ramp.laneChange?.progress>0){steering=ramp.speed;break;}}
  assert(steering!=null,'merge starts');assert(minimum>=entry-.1,'no artificial slow approach');
  assert(steering>=target*.9,`build close to highway speed before steering: ${steering/1.4666666667} mph, blocked=${blocked}`);
  assert((main.cooperativeChanges??0)>0||(main.cooperativeSeconds??0)>0,'mainline participates');
 }
});
test('a nearly ready driver takes a closing safe gap instead of waiting for the last speed increment',()=>{
 for(const ppf of [1,6])for(const direction of [1,-1]){
  const ramp={id:1,road:1,lane:2,station:1000*ppf,direction,speed:44*ppf,laneWidth:12*ppf,driver:B.mergeProfile(B.profile(()=>.5,0)),mergeContext:{road:1,from:2,to:1,station:1000*ppf,direction,remaining:2000*ppf,limit:60*ppf}};
  const rear={id:2,road:1,lane:1,station:ramp.station-direction*310*ppf,direction,speed:80*ppf,laneWidth:12*ppf,driver:B.profile(()=>.5,0)};
  assert(B.safe(ramp,[ramp,rear],1,60*ppf,ppf).allowed,'current gap is safe');
  const closing=B.mergePreparation(ramp,60*ppf,ppf,[ramp,rear]);assert(closing.delay>0);assert(!closing.buildingSpeed,'do not wait until this gap becomes unsafe');
  rear.station=ramp.station-direction*400*ppf;assert(B.mergePreparation(ramp,60*ppf,ppf,[ramp,rear]).buildingSpeed,'with a stable gap, continue speed preparation');
  rear.station=ramp.station-direction*100*ppf;assert(!B.safe(ramp,[ramp,rear],1,60*ppf,ppf).allowed,'an already unsafe gap is never admitted');
 }
});
