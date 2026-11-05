const {test}=require('node:test');
const assert=require('node:assert/strict');
const {Engine,preparePath,position}=require('../js/simulator-vehicles.js');
const route=(key='east')=>({key,points:key==='east'?[{x:0,y:0},{x:100000,y:0}]:[{x:0,y:0},{x:0,y:100000}]});
const source=(rate=60,routes=[route()])=>({key:'spawn',rate,routes});
const seeded=()=>{let state=7;return ()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};};
test('moves by arc length at a constant speed through unequal straight and curved samples',()=>{
 const p=preparePath([{x:0,y:0},{x:0,y:0},{x:3,y:0},{x:3,y:4}]);
 assert.equal(p.length,7);assert.deepEqual(position(p,5),{x:3,y:2,angle:90});
 const e=new Engine({speed:2});e.configure([source(0)]);e.configure([source(1,[{key:'turn',points:p.points}])]);
 e.advance(0);e.advance(2.5);assert.equal(e.cars[0].distance,5);assert.equal(e.cars[0].y,2);
 e.advance(1);assert.equal(e.cars.length,0,'car disappears at exit');
});
test('output is per spawn, distributed over multiple routes without multiplying the rate',()=>{
 const e=new Engine({speed:1,random:seeded()});e.configure([source(60,[route(),route('north')])]);
 e.advance(0);assert.equal(e.cars.length,1,'first car at Play');e.advance(9);assert.equal(e.cars.length,10);
 assert.equal(new Set(e.cars.map(c=>c.route.key)).size,2);assert(new Set(e.cars.map(c=>c.hue)).size>1);
});
test('movement and emission counts do not depend on animation frame size',()=>{
 const a=new Engine({speed:44,random:seeded()}),b=new Engine({speed:44,random:seeded()});
 a.configure([source(120,[route(),route('north')])]);b.configure([source(120,[route(),route('north')])]);
 a.advance(10);for(let i=0;i<600;i++)b.advance(1/60);
 assert.equal(a.cars.length,b.cars.length);
 a.cars.forEach((car,i)=>{assert(Math.abs(car.distance-b.cars[i].distance)<1e-7);assert.equal(car.hue,b.cars[i].hue);assert.equal(car.route.key,b.cars[i].route.key);});
});
test('speed edits apply from the current position, including zero, without teleporting',()=>{
 const e=new Engine({speed:10});e.configure([source(1)]);e.advance(2);assert.equal(e.cars[0].distance,20);
 e.speed=0;e.advance(5);assert.equal(e.cars[0].distance,20);
 e.speed=25;e.advance(2);assert.equal(e.cars[0].distance,70);
});
test('zero output stops new cars while existing cars finish; live rates preserve emission phase',()=>{
 const e=new Engine({speed:1});e.configure([source(60)]);e.advance(.5);
 e.configure([source(120)]);e.advance(.25);assert.equal(e.cars.length,2);
 e.configure([source(0)]);e.advance(20);assert.equal(e.cars.length,2);assert(e.cars[0].distance>20);
 e.configure([source(60)]);e.advance(0);assert.equal(e.cars.length,3);
});
test('removed or invalidated routes discard their cars while other routes survive',()=>{
 const e=new Engine({random:seeded()});e.configure([source(120,[route(),route('north')])]);e.advance(5);
 e.configure([source(120,[route('north')])]);assert(e.cars.length>0);assert(e.cars.every(c=>c.route.key==='north'));
 e.configure([]);assert.equal(e.cars.length,0);
 e.reset();assert.equal(e.time,0);assert.equal(e.sources.size,0);
});
test('percentage distributions rebalance in tenths to exactly 100%, preserving other ratios',()=>{
 const {distribution}=require('../js/simulator-vehicles.js');
 let routes=distribution([{key:'a'},{key:'b'},{key:'c'}]);assert.deepEqual(routes.map(r=>r.percent),[33.4,33.3,33.3]);
 routes=distribution(routes,0,70);assert.deepEqual(routes.map(r=>r.percent),[70,15,15]);
 routes=distribution(routes,1,100);assert.deepEqual(routes.map(r=>r.percent),[0,100,0]);
 routes=distribution(routes,1,0);assert.deepEqual(routes.map(r=>r.percent),[50,0,50]);
 assert.deepEqual(distribution([{key:'a',percent:10}]).map(r=>r.percent),[100]);
});
test('car route choices honor percentages and never choose a zero-percent route',()=>{
 const e=new Engine({speed:0,random:seeded()});
 e.configure([source(600,[{...route(),weight:90},{...route('north'),weight:10},{...route('zero'),weight:0}])]);
 e.advance(100);const east=e.cars.filter(c=>c.route.key==='east').length;
 assert(east>850&&east<950);assert(e.cars.every(c=>c.route.key!=='zero'));
});
test('lane width follows the route samples without changing movement speed',()=>{
 const path=preparePath([{x:0,y:0,laneWidth:72},{x:100,y:0,laneWidth:60}]);
 assert.equal(position(path,50).laneWidth,66);
});
test('paused speed replanning may preserve current car paths without preserving invalid destinations',()=>{
 const e=new Engine({speed:1});e.configure([source(1)]);e.advance(2);const car=e.cars[0],old=car.route;
 e.configure([source(1,[{...route(),points:[{x:0,y:0},{x:200000,y:0}]}])],{preservePaths:true});
 assert.equal(e.cars[0].route,old);assert.equal(e.cars[0].distance,2);
 e.configure([source(1,[route('north')])],{preservePaths:true});assert.equal(e.cars.length,0);
});
test('coincident connector and road samples keep exit-lane metadata from its mouth onward',()=>{
 const {preparePath,position}=require('../js/simulator-vehicles.js');
 const path=preparePath([{x:-100,y:0},{x:0,y:0},{x:0,y:0,road:2,lane:1,station:0,direction:1,laneWidth:12},
  {x:300,y:0,road:2,lane:1,station:300,direction:1,laneWidth:12}]);
 const car=position(path,101);
 assert.equal(car.road,2);assert.equal(car.lane,1);assert.equal(car.station,1);
});
test('30-second watchdog removes a blocking cycle participant, preserving its queue',()=>{
 const e=new Engine({speed:10,pixelsPerFoot:1});
 const actor=(id,phase,leader,collision=null)=>({id,distance:0,speed:0,desiredSpeed:10,intersection:'r',roundaboutPhase:phase,situation:{leader,collision}});
 const circulating=actor(1,'circulating',2,2),blocker=actor(2,'entry',1,1),queue=actor(3,'entry',2);
 e.cars=[circulating,blocker,queue];e.recoverStuck(0);e.recoverStuck(29.99);assert.equal(e.cars.length,3);
 e.recoverStuck(30);assert.deepEqual(e.cars.map(c=>c.id),[1,3]);assert.equal(e.watchdogRemovals,1);
 assert.equal(e.watchdogEvents[0].id,2);e.recoverStuck(30.05);assert.equal(e.cars.length,2,'no cascading queue deletion');
});
test('watchdog keeps ordinary yield queues, moving traffic, and intentional zero speed',()=>{
 const e=new Engine({speed:10});e.cars=[{id:1,distance:0,speed:2,situation:{}},{id:2,distance:0,speed:0,intersection:'r',roundaboutPhase:'entry',situation:{leader:1}}];
 e.recoverStuck(0);e.recoverStuck(60);assert.equal(e.cars.length,2);
 e.speed=0;e.cars[0].speed=0;e.cars[0].situation={collision:2};e.cars[1].situation={collision:1};e.recoverStuck(120);assert.equal(e.cars.length,2);
});

test('an in-progress road-join admission cannot be erased by a lane replan',()=>{
 const e=new Engine({speed:10,pixelsPerFoot:1}),path=require('../js/simulator-vehicles.js').preparePath([
  {x:0,y:0,road:1,lane:0,laneWidth:12},
  {x:100,y:0,road:1,lane:0,laneWidth:12,intersection:'road-merge:2',junction:{roadMerge:true}},
  {x:200,y:0,road:2,lane:0,laneWidth:12,intersection:'road-merge:2',junction:{roadMerge:true}},
  {x:300,y:0,road:2,lane:0,laneWidth:12}]);
 const c={path,pathDistance:150,reservation:true,committed:new Set()};
 assert.equal(e.replacePath(c,[{x:150,y:0,road:1,lane:0},{x:300,y:0,road:2,lane:0}]),false);
 assert.equal(c.path,path);assert.equal(c.pathDistance,150);assert.equal(c.reservation,true);
 c.pathDistance=250;assert(e.replacePath(c,[{x:250,y:0,road:2,lane:0},{x:400,y:0,road:2,lane:0}]));
});
