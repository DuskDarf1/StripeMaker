const {test}=require('node:test');
const assert=require('node:assert/strict');
const B=require('../js/simulator-drivers.js');
const V=require('../js/simulator-vehicles.js');
const C=require('../js/simulator-lane-changes.js');
const R=require('../js/simulator-routing.js');
const seeded=(state=7)=>()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
const car=(id,lane,station,speed=10)=>({id,road:1,lane,station,speed,direction:1,laneWidth:12,driver:{duration:6.28,headway:1.6}});
const points=[{x:0,y:0,road:1,lane:0,station:0,direction:1,laneWidth:12},{x:100000,y:0,road:1,lane:0,station:100000,direction:1,laneWidth:12}];
const sources=[{key:'a',rate:120,routes:[{key:'exit',points}]}];
test('temperature zero exactly matches every baseline without sampling driver randomness',()=>{
 const driver=B.profile(()=>{throw Error('no driver randomness at zero');},0);
 for(const [key,value] of Object.entries(B.BASELINE))assert.equal(driver[key],value);
 assert.equal(driver.aggressive,false);
});
test('bounded temperature profiles vary every behavior input and reach a one-third quick-response tail',()=>{
 const random=seeded(),profiles=Array.from({length:20000},()=>B.profile(random,100));
 const aggressive=profiles.filter(p=>p.aggressive);assert(Math.abs(aggressive.length/profiles.length-1/3)<.01);
 for(const [key,base] of Object.entries(B.BASELINE)){
  const response=['acceleration','deceleration'].includes(key);assert(profiles.every(p=>p[key]>=base*(response?.2:.5)-1e-10&&p[key]<=base*(response?2.734:1.5)+1e-10),key+' respects its temperature envelope');
  assert(new Set(profiles.map(p=>p[key].toFixed(5))).size>100,key+' varies');
 }
 assert(aggressive.every(p=>p.speedFactor>=1.4&&p.roundaboutFactor>=1.4&&p.headway<=1.6*.6&&p.politeness<=.3*.6));
 for(const t of [1,40,70]){
  const a=t*.005,drivers=Array.from({length:2000},()=>B.profile(random,t));
  for(const [key,base] of Object.entries(B.BASELINE)){const m=B.temperatureModel(t),response=['acceleration','deceleration'].includes(key);assert(drivers.every(p=>p[key]>=base*(1-(response?m.responseSpread:a))-1e-10&&p[key]<=base*(response?m.quickResponse+m.quickSpread:1+a)+1e-10),key+' at '+t);}
 }
});
test('drivers distinguish an open road, slower lead vehicle and unsafe adjacent rear gap',()=>{
 const me=car(1,0,100),slow=car(2,0,140,1),rear=car(3,1,90,20);
 assert.equal(B.leader(me,[],1,10),null);assert.equal(B.leader(me,[slow],1,10).car.id,2);
 assert(B.acceleration(10,10,20,1,1.6,1)<B.acceleration(10,10,20,10,1.6,1));
 assert(B.incentive(me,[slow],1,10,1));assert(!B.safe(me,[rear],1,10,1).allowed);assert(!B.incentive(me,[slow,rear],1,10,1));
 assert.equal(B.leader(me,[{...slow,road:2}],1,10),null,'unjoined/grade-separated roads do not become leaders');
});
test('crowded arrivals queue rather than overlapping, and a lead car changes following speed',()=>{
 const engine=new V.Engine({speed:10,random:seeded(),behavior:B,pixelsPerFoot:1});engine.configure(sources);engine.advance(20);
 assert(engine.cars.length>=2);assert(engine.sources.get('a').pending>0);
 const ordered=[...engine.cars].sort((a,b)=>b.station-a.station);
 for(let i=1;i<ordered.length;i++)assert(ordered[i-1].station-ordered[i].station>=(B.length(ordered[i-1],1)+B.length(ordered[i],1))/2+2/.3048-1e-5);
 assert(engine.cars.some(c=>c.situation.reason==='following'));
 assert(engine.cars.some(c=>c.speed<engine.speed));
});
test('contextual playback is frame-rate independent when supplied the same random stream',()=>{
 const a=new V.Engine({speed:10,random:seeded(),behavior:B}),b=new V.Engine({speed:10,random:seeded(),behavior:B});a.configure(sources);b.configure(sources);
 a.advance(10);for(let i=0;i<600;i++)b.advance(1/60);
 assert.equal(a.cars.length,b.cars.length);assert.equal(a.sources.get('a').pending,b.sources.get('a').pending);
 a.cars.forEach((car,i)=>{assert(Math.abs(car.distance-b.cars[i].distance)<1e-7);assert.equal(car.driver.duration,b.cars[i].driver.duration);});
});
function laneFixture(){
 const lane=(index,y)=>({road:1,lane:index,open:[true,true],stations:[0,1000],points:[{x:0,y,lateral:y,laneWidth:12,road:1,lane:index,station:0,direction:1},{x:1000,y,lateral:y,laneWidth:12,road:1,lane:index,station:1000,direction:1}]});
 const from=lane(0,0),to=lane(1,12),exit={...to,road:2,lane:0,points:to.points.map(p=>({...p,road:2,lane:0,x:p.x+1000}))};
 const sheet={roads:[{id:1,ends:[{joint:1},{joint:2}]},{id:2,ends:[{joint:2},{joint:3}]}]};
 const graph=R.build(sheet,{lanes:[from,to,exit],connections:[{from:{road:1,lane:1},to:{road:2,lane:0}}],laneChangePairs:[{road:1,from:0,to:1}]},{ports:[],movements:[]},false,()=>null,{speed:10,pixelsPerFoot:1});
 return {graph,path:graph.search({road:1,lane:0,e:0}).get('r:2:0')};
}
test('cars sharing a destination have individual feasible change locations and durations',()=>{
 const {graph,path}=laneFixture(),random=seeded(),maneuvers=[];
 for(let i=0;i<30;i++){
  const driver=B.profile(random),points=graph.personalize(path,driver,random,()=>0);
  assert(points);const prepared=V.preparePath(points),m=prepared.maneuvers[0];assert(m);maneuvers.push({start:m.start,duration:(m.end-m.start)/10});
  assert.equal(points[0].x,0);assert.equal(points.at(-1).x,2000);assert.equal(points.at(-1).y,12);
 }
 assert(new Set(maneuvers.map(m=>m.start.toFixed(1))).size>20);assert(new Set(maneuvers.map(m=>m.duration.toFixed(2))).size>15);
});
test('planning preferences respond to occupied context and continuation still honors the exit',()=>{
 const {graph,path}=laneFixture(),random=seeded();
 const points=graph.personalize(path,{duration:6.28,headway:1.6},random,context=>context.station<800?1:0);
 assert(points);assert(V.preparePath(points).maneuvers[0].station>=800);
 const remaining=graph.continueFrom({road:1,lane:0,station:400,direction:1},{road:2,lane:0,e:1});
 assert(remaining);assert.equal(remaining.points[0].x,400);assert.equal(remaining.points.at(-1).x,2000);
 assert.equal(graph.continueFrom({road:1,lane:0,station:990,direction:1},{road:2,lane:0,e:1}),null,'do not invent a last-second illegal maneuver');
});
test('blocked lane change waits while an open target permits the maneuver',()=>{
 const change=C.transition({road:1,lane:0,stations:[0,100],points:[{x:0,y:0,lateral:0,laneWidth:12},{x:100,y:0,lateral:0,laneWidth:12}]},
  {road:1,lane:1,stations:[0,100],points:[{x:0,y:12,lateral:12,laneWidth:12},{x:100,y:12,lateral:12,laneWidth:12}]},20,90,{blocked:[]},100);
 const routePoints=[{...points[0]},...change,{x:200,y:12,road:1,lane:1,station:200,direction:1,laneWidth:12}];
 const make=()=>{const e=new V.Engine({speed:5,random:()=>0,behavior:B});e.configure([{key:'source',rate:1,routes:[{key:'turn',points:routePoints}]}]);e.advance(0);return e;};
 const blocked=make(),free=make();const blocker={...car(99,1,20,0),path:V.preparePath([{x:20,y:12,road:1,lane:1,station:20,direction:1,laneWidth:12},{x:200,y:12,road:1,lane:1,station:200,direction:1,laneWidth:12}]),pathDistance:0,distance:0,route:{key:'blocker'},driver:{duration:6,headway:1.6},committed:new Set(),decisionAt:1000};
 // Use a stationary contextual actor for a single observation/step.
 blocked.cars.push(blocker);blocked.driverStep(.05);
 assert.equal(blocked.cars[0].situation.reason,'waiting-for-gap');
 free.advance(6);assert(free.cars[0].laneChange||free.cars[0].lane===1);
});
test('corridor index preserves observations and includes both occupied lanes during changes',()=>{
 const me=car(1,0,100),front=car(2,0,150),changing={...car(3,1,90),laneChange:{from:1,to:0}},foreign={...car(4,0,110),road:99};
 const cars=[me,front,changing,foreign];
 const before=B.neighbors(me,cars);B.indexCars(cars);
 assert.deepEqual(B.neighbors(me,cars),before);
 assert.equal(B.neighbors(me,cars).rear.car.id,3);
 assert.equal(B.leader(me,cars,1,10).car.id,2);
 front.station=80;B.indexCars(cars);
 assert.equal(B.neighbors(me,cars).front,null);
 assert.equal(B.neighbors(me,cars).rear.car.id,3);
});
test('a downstream car is observed at its real station, not collapsed onto a connector mouth',()=>{
 const points=[{x:-100,y:0},{x:0,y:0,road:2,lane:0,station:0,direction:1,laneWidth:12},
  {x:300,y:0,road:2,lane:0,station:300,direction:1,laneWidth:12}];
 const me={...car(1,0,0,30),road:undefined,lane:undefined,direction:undefined,path:V.preparePath(points),pathDistance:80};
 const front={...car(2,0,200,30),road:2};
 const observation=B.leader(me,[front],1,30);
 assert.equal(observation.car.id,2);
 assert(Math.abs(observation.gap-(220-B.length(front,1)))<1e-8,'a car 220 ft ahead is not an obstacle 20 ft ahead');
 assert(B.acceleration(me.speed,30,observation.gap,front.speed,me.driver.headway,1)>-1,'no false emergency stop at an open exit');
 const reversed={...front,direction:-1,station:100};
 me.path=V.preparePath([{x:400,y:0},{x:300,y:0,road:2,lane:0,station:300,direction:-1,laneWidth:12},{x:0,y:0,road:2,lane:0,station:0,direction:-1,laneWidth:12}]);
 assert(Math.abs(B.leader(me,[reversed],1,30).gap-(220-B.length(front,1)))<1e-8,'reversed travel uses the same real gap');
});
test('drivers see a leading car on a shared roundabout connector before either car reaches the exit road',()=>{
 const points=[{x:0,y:0,intersection:'ring',laneWidth:12},{x:100,y:0,intersection:'ring',laneWidth:12},
  {x:200,y:0,intersection:'ring',road:2,lane:0,station:0,direction:1,laneWidth:12},
  {x:300,y:0,road:2,lane:0,station:100,direction:1,laneWidth:12}];
 const me={...car(1,0,0,30),road:undefined,lane:undefined,direction:undefined,intersection:'ring',x:20,y:0,angle:0,path:V.preparePath(points),pathDistance:20};
 const front={...me,id:2,x:70,pathDistance:70,speed:5};
 const adjacent={...front,id:3,x:30,y:12},crossing={...front,id:4,x:25,angle:90},bridge={...front,id:5,x:25,intersection:'bridge'};
 const cars=[front,adjacent,crossing,bridge];B.indexCars(cars);
 const seen=B.leader(me,cars,1,30);assert.equal(seen.car.id,2);assert(Math.abs(seen.gap-(50-B.length(front,1)))<1e-8);
 assert(B.acceleration(me.speed,30,seen.gap,front.speed,me.driver.headway,1)<0);
 assert.equal(B.leader(me,[adjacent,crossing,bridge],1,30),null,'adjacent lanes, crossing paths and unrelated intersections do not become leaders');
});
test('overlapping curved connector projections cannot make two cars follow each other forever',()=>{
 const make=(id,y,endY)=>({...car(id,0,0,5),road:undefined,lane:undefined,direction:undefined,intersection:'ring',x:0,y,
  angle:Math.atan2(endY-y,10)*180/Math.PI,pathDistance:0,path:V.preparePath([{x:0,y,intersection:'ring',laneWidth:12},{x:10,y:endY,intersection:'ring',laneWidth:12}])});
 const a=make(1,0,1),b=make(2,1,0),cars=[a,b];B.indexCars(cars);
 assert.equal(B.leader(a,cars,1,10),null,'the leading/tie-priority car can clear the overlap');
 assert.equal(B.leader(b,cars,1,10).car.id,a.id);
});

test('independent acceleration and braking profiles change actual driver responses',()=>{
 const random=seeded(41),drivers=Array.from({length:2000},()=>B.profile(random,100)).filter(d=>!d.aggressive);
 for(const key of ['acceleration','deceleration']){
  const base=B.BASELINE[key];assert(Math.min(...drivers.map(d=>d[key]))<base*.55);
  assert(Math.max(...drivers.map(d=>d[key]))>base*1.45);
 }
 const base=B.profile(()=>0,0),gentle={...base,acceleration:base.acceleration*.5},quick={...base,acceleration:base.acceleration*1.5};
 assert(B.acceleration(0,30,Infinity,30,base.headway,1,quick)>B.acceleration(0,30,Infinity,30,base.headway,1,gentle)*2.9);
 const soft={...base,deceleration:base.deceleration*.5},firm={...base,deceleration:base.deceleration*1.5};
 assert(B.acceleration(20,30,60,5,base.headway,1,soft)<B.acceleration(20,30,60,5,base.headway,1,firm),'comfortable braking changes the approach to a slower leader');
});

test('physics advances thirty fixed steps per second across render frame rates',()=>{
 for(const frames of [15,30,60,120,144]){
  const e=new V.Engine({behavior:B,random:seeded()});let steps=0;
  const advance=e.driverStep.bind(e);e.driverStep=dt=>{steps++;assert.equal(dt,1/30);advance(dt);};
  for(let frame=0;frame<frames;frame++)e.advance(1/frames);
  assert.equal(steps,30);assert(Math.abs(e.time-1)<1e-9);
 }
});

test('spatial connector candidates preserve unindexed curved-stream leader observations',()=>{
 const points=Array.from({length:97},(_,i)=>{const angle=i*Math.PI*2/96;return {x:100*Math.cos(angle),y:100*Math.sin(angle),intersection:'ring',laneWidth:12};});
 const path=V.preparePath(points),population=Array.from({length:40},(_,i)=>({id:i+1,path,pathDistance:i*14,distance:i*14,speed:10,driver:{...B.BASELINE},...V.position(path,i*14)}));
 population.push({...population[0],id:100,x:10000,y:10000});
 for(const me of population.slice(0,30)){
  const cars=population.slice(),plain=B.leader(me,cars,1,30);
  B.indexCars(cars);const indexed=B.leader(me,cars,1,30);
  assert.equal(indexed?.car.id,plain?.car.id);assert.equal(indexed?.gap,plain?.gap);
 }
});
test('temperature 75 produces a quarter quick drivers centered on 2.2x acceleration and braking',()=>{
 const random=seeded(27),drivers=Array.from({length:40000},()=>B.profile(random,75)),quick=drivers.filter(d=>d.aggressive);
 assert(Math.abs(quick.length/drivers.length-.25)<.01);
 for(const key of ['acceleration','deceleration']){
  const ratios=quick.map(d=>d[key]/B.BASELINE[key]);assert(ratios.every(r=>r>=2.1&&r<=2.3));assert(Math.abs(ratios.reduce((a,b)=>a+b,0)/ratios.length-2.2)<.01);
  assert(drivers.filter(d=>!d.aggressive).every(d=>d[key]>=B.BASELINE[key]*.4&&d[key]<=B.BASELINE[key]*1.6));
 }
 assert(drivers.every(d=>d.safeBraking>=d.deceleration));
});
test('continuous stopped time follows simulated seconds, pauses without advancement, and resets on movement',()=>{
 const e=new V.Engine({behavior:B,speed:0,pixelsPerFoot:1,temperature:0});e.configure(sources);e.advance(1);
 const c=e.cars[0];assert(Math.abs(c.stoppedSeconds-1)<1e-8);e.advance(0);assert(Math.abs(c.stoppedSeconds-1)<1e-8);
 e.speed=10;e.advance(.05);assert(c.speed>0);assert.equal(c.stoppedSeconds,0);
 e.speed=0;e.advance(.5);assert(Math.abs(c.stoppedSeconds-.5)<1e-8);
});
test('lane-change gap checks see a faster rear car still inside the intersection connector',()=>{
 const path=V.preparePath([{x:0,y:0,intersection:'j',laneWidth:12},{x:300,y:0,intersection:'j',laneWidth:12},{x:300,y:0,road:5,lane:0,station:0,direction:1,laneWidth:12},{x:2000,y:0,road:5,lane:0,station:1700,direction:1,laneWidth:12}]);
 const rear={id:2,path,pathDistance:295,distance:295,speed:30,driver:B.profile(()=>.5,0),...V.position(path,295)};
 const changer={...car(1,1,20,25),road:5,level:1};
 for(const indexed of [false,true]){const cars=[rear,changer];if(indexed)B.indexCars(cars);const check=B.safe(changer,cars,0,30,1);assert.equal(check.neighbors.rear.car.id,rear.id);assert(!check.allowed,'do not cut off the car approaching through the connector');}
 const raised={...rear,level:2},cars=[raised,changer];B.indexCars(cars);assert(B.safe(changer,cars,0,30,1).allowed,'a grade-separated car cannot block the target lane');
});
test('a slow car remains a leader while occupying the corridor before its route diverges',()=>{
 const line=V.preparePath([{x:0,y:0,intersection:'j',laneWidth:12},{x:200,y:0,intersection:'j',laneWidth:12}]);
 const turning=V.preparePath([{x:0,y:0,intersection:'j',laneWidth:12},{x:70,y:0,intersection:'j',laneWidth:12},{x:75,y:0,intersection:'j',laneWidth:12},{x:90,y:20,intersection:'j',laneWidth:12}]);
 const me={id:1,path:line,pathDistance:20,speed:30,driver:B.profile(()=>.5,0),...V.position(line,20)};
 const front={id:2,path:turning,pathDistance:70,speed:5,driver:B.profile(()=>.5,0),...V.position(turning,70)};
 const cars=[me,front];B.indexCars(cars);assert.equal(B.leader(me,cars,1,30).car.id,2);
});
test('opposite outside lanes cannot simultaneously claim an empty middle lane in the same physics step',()=>{
 const lanes=[0,1,2].map(lane=>({road:1,lane,stations:[0,1000],points:[0,1000].map(station=>({x:station,y:lane*12,road:1,lane,station,direction:1,lateral:lane*12,laneWidth:12}))}));
 const make=(id,lane,station,speed,passing=false)=>{const path=V.preparePath(C.slice(lanes[lane],0,1000));return {id,path,pathDistance:station,distance:station,speed,driver:B.profile(()=>.5,0),decisionAt:0,committed:new Set(),...V.position(path,station),route:passing?{passing:()=>[1],replan:({car})=>[...C.transition(lanes[lane],lanes[1],car.station,car.station+150,{blocked:[]},1000),...C.slice(lanes[1],car.station+150,1000)]}:{}};};
 const e=new V.Engine({behavior:B,speed:20,pixelsPerFoot:1,temperature:0});e.cars=[make(1,0,100,20,true),make(2,2,105,20,true),make(3,0,160,0),make(4,2,165,0)];e.recoverStuck=()=>{};
 e.driverStep(1/60);assert.equal(e.cars.filter(c=>c.laneChange?.to===1).length,1,'the second driver sees the first lane-change decision');
});
test('lane-change safety observes rear traffic approaching through an ordinary joined-road boundary',()=>{
 const path=V.preparePath([{x:0,y:0,road:3,lane:0,station:0,direction:1,laneWidth:12},{x:300,y:0,road:3,lane:0,station:300,direction:1,laneWidth:12},{x:300,y:0,road:5,lane:0,station:0,direction:1,laneWidth:12},{x:1000,y:0,road:5,lane:0,station:700,direction:1,laneWidth:12}]);
 const rear={id:2,path,pathDistance:295,speed:30,driver:B.profile(()=>.5,0),...V.position(path,295)},changer={...car(1,1,20,25),road:5};
 const cars=[rear,changer];B.indexCars(cars);assert(!B.safe(changer,cars,0,30,1).allowed);
});
test('a pending lane change is not an obstacle in the adjacent lane; an active change follows both lanes',()=>{
 const own=car(1,1,100,20),pending={...car(2,0,110,0),laneChange:{from:0,to:1,progress:0}},cars=[own,pending];B.indexCars(cars);assert.equal(B.leader(own,cars,1,20),null);
 pending.laneChange.progress=.2;B.indexCars(cars);assert.equal(B.leader(own,cars,1,20).car.id,2);
 const changing={...car(3,0,50,20),laneChange:{from:0,to:1,progress:.4}},targetFront=car(4,1,90,5),both=[changing,targetFront];B.indexCars(both);assert.equal(B.leader(changing,both,1,20).car.id,4);
});
test('an unsafe immediate replan cannot replace a maneuver that still has braking room',()=>{
 const lanes=[0,1].map(lane=>({road:1,lane,stations:[0,1000],points:[0,1000].map(station=>({x:station,y:lane*12,road:1,lane,station,direction:1,lateral:lane*12,laneWidth:12}))}));
 const path=V.preparePath([...C.slice(lanes[0],0,300),...C.transition(lanes[0],lanes[1],300,450,{blocked:[]},1000),...C.slice(lanes[1],450,1000)]);
 const me={id:1,path,pathDistance:100,distance:100,speed:20,driver:B.profile(()=>.5,0),decisionAt:0,committed:new Set(),...V.position(path,100),route:{replan:({car})=>[...C.transition(lanes[0],lanes[1],car.station,car.station+150,{blocked:[]},1000),...C.slice(lanes[1],car.station+150,1000)]}};
 const obstacle={...car(2,1,110,0),x:110,y:12,path:V.preparePath(C.slice(lanes[1],0,1000)),pathDistance:110,distance:110,route:{},committed:new Set(),decisionAt:0};
 const e=new V.Engine({behavior:B,speed:20,pixelsPerFoot:1,temperature:0});e.cars=[me,obstacle];e.recoverStuck=()=>{};e.driverStep(1/60);
 assert.strictEqual(me.path,path);assert(me.speed>0);assert(me.pathDistance>100,'continues approaching the future safe hold');
});
test('source admission matches a slow queue rather than injecting a highway-speed emergency stop',()=>{
 const e=new V.Engine({behavior:B,speed:88,pixelsPerFoot:1,temperature:0});e.configure([{key:'s',rate:1,routes:[{key:'r',points}]}]);
 const path=V.preparePath(points.map(p=>({...p,speedLimit:0}))),front={id:999,path,pathDistance:180,distance:180,speed:0,driver:B.profile(()=>.5,0),route:{},committed:new Set(),decisionAt:0,...V.position(path,180)};e.cars=[front];e.advance(0);
 const entrant=e.cars.find(c=>c.id!==999);assert(entrant);assert(entrant.speed<44);assert(B.acceleration(entrant.speed,88,180-B.length(entrant,1),0,entrant.driver.headway,1,entrant.driver)>=-B.parameter(entrant.driver,'deceleration')/.3048-.001);
});
test('a nearer fast target-lane leader cannot hide the slower leader while a car straddles lanes',()=>{
 const me=car(1,0,0,40),slow=car(2,0,130,10),fast=car(3,1,90,45);
 me.laneChange={road:1,from:0,to:1,progress:.5};
 const cars=[me,slow,fast];B.indexCars(cars);
 assert.equal(B.leader(me,cars,1,50).car.id,slow.id);
 me.laneChange.progress=1;
 assert.equal(B.leader(me,cars,1,50).car.id,fast.id,'the old lane releases after completing the change');
});
test('merge approach matches slower/faster adjacent traffic within the local speed target',()=>{
 const me={...car(1,0,100,20),pathDistance:100,driver:B.profile(()=>.5,0)},change={road:1,from:0,to:1,start:200};
 const slower=car(2,1,200,10),cars=[me,slower];B.indexCars(cars);
 const slow=B.mergeApproach(me,cars,change,30,1);assert(slow.speed<20);assert.equal(slow.front,2);
 const faster=car(3,1,50,28),rearCars=[me,faster];B.indexCars(rearCars);
 const fast=B.mergeApproach(me,rearCars,change,30,1);assert.equal(fast.speed,30,'clear lane ahead permits accelerating beyond rear traffic to open a gap');assert.equal(fast.rear,3);
 assert.equal(B.mergeApproach(me,rearCars,change,15,1).speed,15,'speed matching cannot override a local zone');
 assert.equal(B.mergeApproach(me,[me],change,30,1),null,'an empty highway is not a virtual queue');
 assert.equal(B.mergeApproach({...me,laneChange:{progress:.5}},cars,change,30,1),null,'active steering remains governed by real following');
});
test('merge gap and response use temperature-dependent personal headway and duration',()=>{
 const change={road:1,from:0,to:1,start:200},front=car(2,1,240,15);
 const profile=headway=>({...B.profile(()=>.5,0),headway});
 const cautious={...car(1,0,100,20),pathDistance:100,driver:profile(2.2)},shorter={...cautious,driver:profile(1.1)};
 assert(B.mergeApproach(cautious,[cautious,front],change,30,1).speed<B.mergeApproach(shorter,[shorter,front],change,30,1).speed);
 const atZero=B.profile(()=>.5,0),warm=B.profile(seeded(19),75);assert.notEqual(warm.acceleration,atZero.acceleration);assert.notEqual(warm.deceleration,atZero.deceleration);
 const warmCar={...cautious,driver:warm};assert.equal(B.mergeApproach(warmCar,[warmCar,front],change,30,1).delay,warm.headway+warmCar.speed/(2*warm.deceleration/.3048));
 const blocked=car(3,1,105,0);assert(!B.safe(warmCar,[warmCar,blocked],1,30,1).allowed,'temperature never bypasses actual merge-gap safety');
});
test('a rolling merge extension handles a gap closing between decisions without crossing it',()=>{
 for(const imminent of [false,true,'distant']){
 const lanes=[0,1].map(lane=>({road:1,lane,stations:[0,1000],points:[0,1000].map(station=>({x:station,y:lane*12,road:1,lane,station,direction:1,laneWidth:12,lateral:lane*12}))}));
 const planned=at=>[...C.slice(lanes[0],100,at),...C.transition(lanes[0],lanes[1],at,at+150,{blocked:[]},1000),...C.slice(lanes[1],at+150,1000)];
 const path=V.preparePath(planned(imminent==='distant'?600:imminent?110:120)),me={id:1,path,pathDistance:0,distance:0,speed:20,driver:B.profile(()=>.5,0),decisionAt:imminent===true?1000:0,committed:new Set(),...V.position(path,0),route:{replan:options=>{assert(options.mergeDelay>me.driver.headway);return planned(300);}}};
 const otherPath=V.preparePath(C.slice(lanes[1],0,1000)),other={id:2,path:otherPath,pathDistance:110,distance:110,speed:0,driver:B.profile(()=>.5,0),route:{},decisionAt:100,committed:new Set(),...V.position(otherPath,110)};
 const e=new V.Engine({behavior:B,speed:30,pixelsPerFoot:1,temperature:0});e.cars=[me,other];e.recoverStuck=()=>{};e.driverStep(1/60);
 assert(me.pathDistance>0);assert(me.rollingMergeUntil>e.time);assert(me.speed>=20-me.driver.deceleration/.3048/60-1e-8,'speed matching uses personal comfortable braking');
 assert(!me.laneChange||me.laneChange.progress===0);assert(me.pathDistance<me.path.maneuvers[0].start,'continues in its own lane, without entering the rejected gap');
 }
});
test('rolling lane-change geometry uses attainable acceleration, personal duration and legal lane room',()=>{
 const lane=index=>({road:1,lane:index,stations:[0,1080],points:[0,1080].map(station=>({x:station,y:index*12,lateral:index*12,station,laneWidth:12,road:1,lane:index,direction:1}))});
 const from=lane(0),to=lane(1),pair={road:1,from:0,to:1},profiles=[B.profile(()=>.5,0),B.profile(seeded(7),75)];
 const ends=[];
 for(const driver of profiles){
  const options={station:410,direction:1,speed:20,target:70*5280/3600,acceleration:driver.acceleration/.3048,duration:driver.duration,delay:driver.headway+20/(2*driver.deceleration/.3048),pixelsPerFoot:1};
  const rolling=C.rollingTransition(from,to,pair,options);assert(rolling,'remaining lane accommodates accelerating maneuver');
  const prepared=V.preparePath(rolling.points),m=prepared.maneuvers[0];assert(m);assert(m.station>410);assert(rolling.station<1080);ends.push(rolling.station);
  assert(m.end-m.start>=20*driver.duration,'do not squeeze the personal maneuver duration');
  assert.equal(C.rollingTransition(from,to,pair,{...options,station:1050}),null,'no room beyond the actual lane end');
  assert.equal(C.rollingTransition(from,to,{...pair,blocked:[[0,1]]},options),null,'lane boundaries remain enforced');
  assert.equal(C.rollingTransition(from,to,{...pair,crossings:[{points:from.points.map(p=>({...p,lateral:6})),ranges:[]}]},options),null,'unpermitted bike crossing remains forbidden');
  const reverse=C.rollingTransition(from,to,pair,{...options,station:670,direction:-1});assert(reverse);assert(reverse.station<670);assert(reverse.points.every(p=>p.direction===-1));
 }
 assert.notEqual(ends[0],ends[1],'temperature affects predicted acceleration and maneuver distance');
});
test('merge speed observation reaches the target corridor across an upcoming road joint',()=>{
 const me={...car(1,0,900,20),road:9,pathDistance:100,driver:B.profile(()=>.5,0)},change={road:1,from:0,to:1,start:120,station:0};
 const traffic=car(2,1,40,15),unrelated={...car(3,1,901,0),road:9};
 const matching=B.mergeApproach(me,[me,traffic,unrelated],change,30,1);
 assert(matching);assert.equal(matching.front,2,'observe the upcoming corridor, not a similarly numbered ramp lane');
 assert.equal(me.road,9);assert.equal(me.station,900,'projection cannot mutate the actual vehicle');
});
test('a slower merge vehicle accelerates toward faster adjacent traffic instead of braking to chase a slot',()=>{
 for(const temperature of [0,20,75,100])for(const ppf of [1,6]){
  const lanes=[0,1].map(lane=>({road:1,lane,stations:[0,2000*ppf],points:[0,2000*ppf].map(station=>({x:station,y:lane*12*ppf,road:1,lane,station,direction:1,laneWidth:12*ppf,lateral:lane*12*ppf}))}));
  const planned=at=>[...C.slice(lanes[0],100*ppf,at*ppf),...C.transition(lanes[0],lanes[1],at*ppf,(at+300)*ppf,{blocked:[]},2000*ppf),...C.slice(lanes[1],(at+300)*ppf,2000*ppf)];
  const path=V.preparePath(planned(120)),driver=B.profile(seeded(19),temperature);
  const me={id:1,path,pathDistance:0,distance:0,speed:20*ppf,driver,decisionAt:0,committed:new Set(),...V.position(path,0),route:{replan:()=>planned(500)}};
  const otherPath=V.preparePath(C.slice(lanes[1],0,2000*ppf)),other={id:2,path:otherPath,pathDistance:101*ppf,distance:101*ppf,speed:30*ppf,driver:B.profile(()=>.5,0),route:{},decisionAt:100,committed:new Set(),...V.position(otherPath,101*ppf)};
  const cars=[me,other];B.indexCars(cars);const match=B.mergeApproach(me,cars,path.maneuvers[0],40*ppf,ppf);
  assert(match.speed>=other.speed,'a nearby faster car must not produce a slower slot-chasing target');
  assert(!B.safe(me,cars,1,40*ppf,ppf).allowed,'accelerating alongside is not permission to steer into the occupied gap');
  const e=new V.Engine({behavior:B,speed:40*ppf,pixelsPerFoot:ppf,temperature});e.cars=cars;e.recoverStuck=()=>{};e.driverStep(1/60);
  assert(me.speed>20*ppf,'accelerates in the available lane with personal response');
  assert(!me.laneChange||me.laneChange.progress===0,'keeps searching before entering the other lane');
 }
});
test('required merging takes a safe present gap instead of driving past it to an arbitrary later station',()=>{
 const lanes=[0,1].map(lane=>({road:1,lane,stations:[0,2000],points:[0,2000].map(station=>({x:station,y:lane*12,road:1,lane,station,direction:1,laneWidth:12,lateral:lane*12}))}));
 const planned=[...C.slice(lanes[0],100,600),...C.transition(lanes[0],lanes[1],600,900,{blocked:[]},2000),...C.slice(lanes[1],900,2000)];
 for(const permitted of [true,false]){
  const driver=B.profile(()=>.5,0),path=V.preparePath(planned);let requested=false;
  const me={id:1,path,pathDistance:0,distance:0,speed:20,driver,decisionAt:0,committed:new Set(),...V.position(path,0),route:{replan:options=>{
   assert(options.required);assert.equal(options.target,1);requested=true;
   const crossing=C.rollingTransition(lanes[0],lanes[1],{blocked:permitted?[]:[[0,1]]},{station:100,direction:1,speed:20,target:30,acceleration:driver.acceleration/.3048,duration:driver.duration,delay:0,pixelsPerFoot:1});
   return crossing?[...crossing.points,...C.slice(lanes[1],crossing.station,2000)]:null;
  }}};
  const e=new V.Engine({behavior:B,speed:30,pixelsPerFoot:1,temperature:0});e.cars=[me];e.recoverStuck=()=>{};e.driverStep(1/60);
  assert(requested);if(permitted)assert(me.laneChange?.progress>0,'starts steering in the available gap');else assert(!me.laneChange||me.laneChange.progress===0,'a forbidden boundary cannot be crossed early');
 }
});

test('a stopped lane changer releases its old lane only after the whole body clears it',()=>{
 const lane=(index,y)=>({road:1,lane:index,stations:[0,200],points:[{x:0,y,lateral:y,laneWidth:12},{x:200,y,lateral:y,laneWidth:12}]});
 const prepared=V.preparePath(C.transition(lane(0,0),lane(1,12),0,200,{},200));prepared.movements=[{start:210,end:250,junction:{entry:'in',exit:'out'}}];
 const changer={...car(2,0,0,0),path:prepared,pixelsPerFoot:1},follower={...car(1,0,80,0),x:80,y:0};
 const pose=f=>{changer.pathDistance=prepared.length*f;Object.assign(changer,V.position(prepared,changer.pathDistance));};
 pose(.5);let cars=[follower,changer];B.indexCars(cars);assert.equal(B.neighbors(follower,cars).front.car.id,2,'straddling body still blocks old lane');
 pose(.97);B.indexCars(cars);assert.equal(B.neighbors(follower,cars).front,null,'no phantom blocker after clearing the edge');assert.equal(B.neighbors({...follower,lane:1,y:12},cars).front.car.id,2,'target queue still sees the car');
 const angle=changer.angle;changer.angle=45;B.indexCars(cars);assert.equal(B.neighbors(follower,cars).front.car.id,2,'an angled body still crossing the edge must remain visible');changer.angle=angle;
 const oldLane={...car(3,0,changer.station+25,0),x:changer.x+25,y:0},newLane={...car(4,1,changer.station+40,0),x:changer.x+40,y:12};cars=[changer,oldLane,newLane];B.indexCars(cars);assert.equal(B.leader(changer,cars,1,30).car.id,4,'the old queue cannot stop a car already in the new lane');
});
test('queue lane choices rank both safe adjacent lanes by the existing MOBIL advantage',()=>{
 const me={...car(1,1,100,0),x:100,y:12},ahead=car(2,1,125,0),left=car(3,0,160,0),right=car(4,2,200,0),cars=[me,ahead,left,right];
 assert(B.incentiveScore(me,cars,2,30,1)>B.incentiveScore(me,cars,0,30,1));
 assert(B.incentiveScore(me,cars,0,30,1)>0);const fastRear=car(5,2,95,30);assert.equal(B.incentiveScore(me,[...cars,fastRear],2,30,1),-Infinity);
});

test('an early queue lane change reserves its target without becoming a phantom leader there',()=>{
 const lane=(index,y)=>({road:1,lane:index,stations:[0,200],points:[{x:0,y,lateral:y,laneWidth:12},{x:200,y,lateral:y,laneWidth:12}]});
 const path=V.preparePath(C.transition(lane(0,0),lane(1,12),0,200,{},200));path.movements=[{start:210,end:250,junction:{entry:'in',exit:'out'}}];
 const changer={...car(2,0,0,0),path,pixelsPerFoot:1,pathDistance:20};Object.assign(changer,V.position(path,20));
 const follower={...car(1,1,0,0),x:0,y:12},cars=[follower,changer];B.indexCars(cars);
 assert.equal(B.neighbors(follower,cars).front,null,'unused target lane is available to its existing queue');
 assert.equal(B.neighbors({...follower,lane:0,y:0},cars).front.car.id,2,'actual origin lane still sees the body');
 assert.equal(B.neighbors(follower,cars,1,0,true).front.car.id,2,'another lane-change admission still reserves the target');
 changer.pathDistance=100;Object.assign(changer,V.position(path,100));B.indexCars(cars);
 assert.equal(B.neighbors(follower,cars).front.car.id,2,'body crossing the lane boundary becomes a physical leader');
});
test('red queue space is considered early and only with a safe full vehicle slot',()=>{
 const me={...car(1,1,0,15),driver:B.profile(()=>.5,0),signalControl:{aspect:'red',allowed:false,remaining:500}},ahead=car(2,1,200,0),cars=[me,ahead];
 assert(B.incentiveScore(me,cars,2,30,1)<0,'instantaneous acceleration alone misses this distant queue');
 assert(B.queueGain(me,cars,2,30,1)>0,'available queue storage gives an early reason to move');
 const adjacent=car(3,2,210,0);assert.equal(B.queueGain(me,[...cars,adjacent],2,30,1),0,'insignificant storage differences do not cause weaving');
 assert.equal(B.queueGain(me,[...cars,car(4,2,-10,30)],2,30,1),0,'space advantage cannot override an unsafe rear gap');
 ahead.speed=10;assert(B.queueGain(me,cars,2,30,1)>0,'approaching red traffic plans before the leader stops');ahead.speed=0;
 me.signalControl.aspect='green';assert.equal(B.queueGain(me,cars,2,30,1),0);
});
test('one stopped car makes an empty red lane worth a complete queue slot, including its standstill gap',()=>{
 for(const ppf of [1,6]){
  const me={...car(1,1,0,0),laneWidth:12*ppf,driver:B.profile(()=>.5,0),signalControl:{aspect:'red',allowed:false,remaining:100*ppf}};
  const ahead={...car(2,1,100.000375*ppf,0),laneWidth:12*ppf};
  assert(B.incentiveScore(me,[me,ahead],2,60*ppf,ppf)<0,'MOBIL alone would wait for the queue tail');
  assert(B.queueGain(me,[me,ahead],2,60*ppf,ppf)>.99,'sampled curved-lane station differences do not suppress the opportunity');
 }
});
