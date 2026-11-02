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
test('stochastic positive profiles match the cited input moments, without treating the assumed family as measured',()=>{
 const random=seeded(),profiles=Array.from({length:40000},()=>B.profile(random));
 const stats=key=>{const mean=profiles.reduce((sum,p)=>sum+p[key],0)/profiles.length;return {mean,sd:Math.sqrt(profiles.reduce((sum,p)=>sum+(p[key]-mean)**2,0)/profiles.length)};};
 const d=stats('duration'),h=stats('headway');assert(Math.abs(d.mean-6.28)<.06);assert(Math.abs(d.sd-2)<.08);assert(Math.abs(h.mean-1.6)<.03);assert(Math.abs(h.sd-.8)<.04);
 assert(profiles.every(p=>p.duration>0&&p.headway>0));assert(new Set(profiles.map(p=>p.duration.toFixed(2))).size>100);
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
