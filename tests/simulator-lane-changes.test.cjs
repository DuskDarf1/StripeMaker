const {test}=require('node:test');
const assert=require('node:assert/strict');
const {build}=require('../js/simulator-routing.js');
const C=require('../js/simulator-lane-changes.js');
const V=require('../js/simulator-vehicles.js');
const road=(id,a,b)=>({id,ends:[{joint:a},{joint:b}]});
function fixture({length=500,acrossBike=false,range=[.2,.6],blocked=false}={}) {
 const target=acrossBike?2:1, y=acrossBike?17:12;
 const lane=(id,index,y)=>({road:id,lane:index,open:[true,true],stations:[0,length],points:[{x:0,y,laneWidth:12,lateral:y},{x:length,y,laneWidth:12,lateral:y}]});
 const a=lane(1,0,0),b=lane(1,target,y),out=lane(2,0,y);
 out.points=out.points.map(p=>({...p,x:p.x+length}));
 const crossings=acrossBike?[6,11].map(value=>({points:[{x:0,y:0,lateral:value},{x:length,y:0,lateral:value}],ranges:range?[range]:[]})):[];
 return {sheet:{roads:[road(1,1,2),road(2,2,3)]},roads:{lanes:[a,b,out],connections:[{from:{road:1,lane:target},to:{road:2,lane:0}}],laneChangePairs:[{road:1,from:0,to:target,crossings,blocked:blocked?[[0,1]]:[]}]},target};
}
const graph=(f,reversed=false,speed=10)=>build(f.sheet,f.roads,{ports:[],movements:[]},reversed,()=>null,{speed,pixelsPerFoot:1});
test('plans a smooth lane change before an upcoming lane drop, preserving the spawned lane',()=>{
 const f=fixture(),path=graph(f).search({road:1,lane:0,e:0}).get('r:2:0');
 assert(path);assert.equal(path.points[0].y,0);assert.equal(path.points.at(-1).y,12);
 assert.equal(path.laneChanges.length,1);const change=path.laneChanges[0];
 assert(change.duration>=C.DURATION_SECONDS);assert(change.duration<C.DURATION_SECONDS*1.2);
 const p=V.preparePath(path.points),engine=new V.Engine({speed:10});
 engine.configure([{key:'source',rate:1,routes:[{key:'exit',points:path.points}]}]);
 engine.advance((change.startDistance+change.endDistance)/20);
 const car=engine.cars[0];assert(car.y>0&&car.y<12);assert(car.laneChange);assert(car.angle>0&&car.angle<90);
 assert(Math.abs(car.distance-engine.time*10)<1e-6,'no acceleration/slowing introduced');
 assert(p.length>1000);
});
test('prefers no change when the existing lane already reaches the exit',()=>{
 const f=fixture(),path=graph(f).search({road:1,lane:1,e:0}).get('r:2:0');
 assert(path);assert.equal(path.laneChanges.length,0);
});
test('never compresses a maneuver into an insufficient road, including high-speed routes',()=>{
 const f=fixture({length:50});assert.equal(graph(f).search({road:1,lane:0,e:0}).size,0);
 assert.equal(graph(fixture(),false,100).search({road:1,lane:0,e:0}).size,0);
});
test('crosses a bike lane only at modeled boundary conflicts without using it as a driving lane',()=>{
 const f=fixture({acrossBike:true}),g=graph(f),path=g.search({road:1,lane:0,e:0}).get('r:2:0');
 assert(path);assert(!g.entrances.some(ref=>ref.lane===1));assert(path.laneChanges[0].acrossBike);
 assert(path.laneChanges[0].duration>=C.DURATION_SECONDS*17/12);
 const crossing=path.points.filter(p=>p.maneuver&&p.lateral>=6&&p.lateral<=11);
 assert(crossing.length>0);assert(crossing.every(p=>p.station/500>=.2&&p.station/500<=.6));
 assert(crossing.every(p=>p.laneWidth===12),'the car does not shrink to bike-lane width');
});
test('rejects solid bike sections, raised separations and unrelated road crossings',()=>{
 for(const options of [{acrossBike:true,range:null},{acrossBike:true,blocked:true},{blocked:true}]) {
  const f=fixture(options);assert.equal(graph(f).search({road:1,lane:0,e:0}).size,0);
 }
 const f=fixture();f.roads.laneChangePairs=[];assert.equal(graph(f).search({road:1,lane:0,e:0}).size,0);
});
test('reversed traffic changes lanes forward in its actual travel direction',()=>{
 const g=graph(fixture(),true),path=g.search({road:2,lane:0,e:1}).get('r:1:0');
 assert(path);assert.equal(path.points[0].x,1000);assert.equal(path.points.at(-1).x,0);
 assert.equal(path.laneChanges.length,1);assert.equal(path.laneChanges[0].from,1);assert.equal(path.laneChanges[0].to,0);
 const changes=path.points.filter(p=>p.maneuver);assert(changes[0].maneuver.progress<.001);assert(changes.at(-1).maneuver.progress>.999);
});
test('an upcoming turn must still have an allowed intersection movement after changing lanes',()=>{
 const f=fixture();f.roads.connections=[];
 const ports=[{intersection:'x',lane:'in',ends:[{road:1,lane:1,e:1}]},{intersection:'x',lane:'out',ends:[{road:2,lane:0,e:0}]}];
 const allowed={intersection:'x',input:'in',output:'out',points:[{x:500,y:12},{x:501,y:12}]};
 const make=movements=>build(f.sheet,f.roads,{ports,movements},false,()=>null,{speed:10,pixelsPerFoot:1});
 assert(make([allowed]).search({road:1,lane:0,e:0}).has('r:2:0'));
 assert(!make([]).search({road:1,lane:0,e:0}).has('r:2:0'));
});
test('route colors progress from green through yellow to red with percentage',()=>{
 assert.equal(V.routeColor(0),'hsl(120.0 80% 42%)');assert.equal(V.routeColor(50),'hsl(60.0 80% 42%)');assert.equal(V.routeColor(100),'hsl(0.0 80% 42%)');
 assert.equal(V.routeColor(-10),V.routeColor(0));assert.equal(V.routeColor(110),V.routeColor(100));
});
test('plans multiple adjacent changes one at a time before a distant exit',()=>{
 const f=fixture(),middle=f.roads.lanes[1],outer={...middle,lane:2,points:middle.points.map(p=>({...p,y:24,lateral:24}))};
 f.roads.lanes.push(outer);f.roads.connections[0].from.lane=2;
 f.roads.laneChangePairs.push({road:1,from:1,to:2});
 const path=graph(f).search({road:1,lane:0,e:0}).get('r:2:0');
 assert(path);assert.equal(path.laneChanges.length,2);
 assert.deepEqual(path.laneChanges.map(c=>[c.from,c.to]),[[0,1],[1,2]]);
 assert(path.laneChanges[1].startDistance>=path.laneChanges[0].endDistance-1e-6);
});
test('prepares on an upstream road when the final approach is too short to change lanes',()=>{
 const f=fixture(),oldOut=f.roads.lanes.pop();
 const approach0={...oldOut,road:2,lane:0,stations:[0,20],points:[{x:500,y:0,lateral:0,laneWidth:12},{x:520,y:0,lateral:0,laneWidth:12}]};
 const approach1={...approach0,lane:1,points:approach0.points.map(p=>({...p,y:12,lateral:12}))};
 const out={...oldOut,road:3,points:oldOut.points.map(p=>({...p,x:p.x+20}))};
 f.sheet.roads=[road(1,1,2),road(2,2,3),road(3,3,4)];
 f.roads.lanes.push(approach0,approach1,out);
 f.roads.connections=[{from:{road:1,lane:0},to:{road:2,lane:0}},{from:{road:1,lane:1},to:{road:2,lane:1}},{from:{road:2,lane:1},to:{road:3,lane:0}}];
 f.roads.laneChangePairs.push({road:2,from:0,to:1});
 const path=graph(f).search({road:1,lane:0,e:0}).get('r:3:0');
 assert(path);assert.equal(path.laneChanges.length,1);assert.equal(path.laneChanges[0].road,1);
});

test('optional slow route reaches a nearby exit without shortening personal maneuver time',()=>{
 const f=fixture({length:100}),options={speed:50,pixelsPerFoot:1,allowSlowLaneChanges:true};
 const g=build(f.sheet,f.roads,{ports:[],movements:[]},false,()=>null,options),path=g.search({road:1,lane:0,e:0}).get('r:2:0');
 assert(path?.slowLaneChanges);
 assert(V.preparePath(path.points).maneuverLimits.some(x=>Number.isFinite(x.limit)),'baseline fallback geometry also carries its slower speed target');
 for(const duration of [4,6.28,10]) {
  const points=g.personalize(path,{duration,acceleration:.73},()=>.5,()=>0,50),prepared=V.preparePath(points),change=prepared.maneuvers[0];
  assert(points);assert(prepared.maneuverLimits.some(x=>Number.isFinite(x.limit)));
  const cap=prepared.maneuverLimits.find(x=>Number.isFinite(x.limit)).limit;
  assert((change.end-change.start)/cap>=duration-1e-6,'distance/speed preserves each personal duration');
  const B=require('../js/simulator-collisions.js');
  const car={path:prepared,pathDistance:50,driver:{roundaboutFactor:1.5,speedFactor:1.5}};
  assert(B.desiredSpeed(car,75,2,1)<=cap,'temperature cannot multiply the personal cap again');
  car.pathDistance=prepared.length-1;assert(B.desiredSpeed(car,75,2,1)>cap,'cap releases after the preparation road');
 }
 const fast=fixture(),base=graph(fast).search({road:1,lane:1,e:0}).get('r:2:0');
 const normal=build(fast.sheet,fast.roads,{ports:[],movements:[]},false,()=>null,{speed:10,pixelsPerFoot:1,allowSlowLaneChanges:true}).search({road:1,lane:1,e:0}).get('r:2:0');
 assert.deepEqual(normal,base,'existing normal-speed routes remain preferred');
});
test('slow preparation still rejects solid bike boundaries and raised lane separators',()=>{
 for(const options of [{acrossBike:true,range:null},{blocked:true}]) {
  const f=fixture(options),g=build(f.sheet,f.roads,{ports:[],movements:[]},false,()=>null,{speed:100,pixelsPerFoot:1,allowSlowLaneChanges:true});
  assert.equal(g.search({road:1,lane:0,e:0}).size,0);
 }
});
