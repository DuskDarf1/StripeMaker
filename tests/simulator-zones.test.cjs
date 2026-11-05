const {test}=require('node:test'),assert=require('node:assert/strict');
const Z=require('../js/simulator-zones.js'),V=require('../js/simulator-vehicles.js'),C=require('../js/simulator-collisions.js'),B=require('../js/simulator-drivers.js');
const line=[{x:0,y:0},{x:2000,y:0}],geometry=()=>({line,lengths:Z.measure(line)});
const points=line.map(p=>({...p,road:1,lane:0,station:p.x,direction:1,laneWidth:12}));
const sheet={inchesPerPixel:12,speedZones:[{id:'a',road:1,from:.25,to:.75,mph:10}]};
test('zone boundaries are inserted even between sparse road samples; limits release at the exit',()=>{
 const decorated=Z.decorate(points,sheet,geometry),path=V.preparePath(decorated);
 assert.deepEqual(decorated.map(p=>p.x),[0,500,1500,2000]);
 const car={path,pathDistance:1000,speed:20,driver:B.profile(()=>.5,0)};
 assert(Math.abs(C.desiredSpeed(car,44,1.67/.3048,1)-10*5280/3600)<1e-8);
 car.pathDistance=1600;assert.equal(C.desiredSpeed(car,44,1.67/.3048,1),44);
 car.pathDistance=490;const approach=C.desiredSpeed(car,44,1.67/.3048,1);assert(approach>14.66&&approach<44,'brakes before the boundary');
});
test('reverse travel crosses speed boundaries in the correct order',()=>{
 const path=V.preparePath(Z.decorate([...points].reverse().map(p=>({...p,direction:-1})),sheet,geometry));
 assert.deepEqual(path.zoneLimits.map(p=>p.distance),[0,500,1500]);
 assert.equal(path.zoneLimits[1].limit,10*5280/3600);assert.equal(path.zoneLimits[2].limit,30*5280/3600);
});
test('overlapping zones use the latest section and retain surrounding limits',()=>{
 const s=Z.sections([...sheet.speedZones,{road:1,from:.5,to:1,mph:20}],1);
 assert.deepEqual(s.map(p=>[p.from,p.to,p.mph]),[[0,.25,undefined],[.25,.5,10],[.5,.75,20],[.75,1,20]]);
});
test('splitting a road preserves speed-zone extent across both pieces',()=>{
 const s=structuredClone(sheet);Z.split(s,1,2,.5);
 assert.deepEqual(s.speedZones.map(z=>[z.road,z.from,z.to,z.mph]),[[1,.5,1,10],[2,0,.5,10]]);
});
test('a queued candidate enters at its target after the entrance clears, even after its speed reached zero',()=>{
 const e=new V.Engine({behavior:B,speed:44,pixelsPerFoot:1,temperature:0});e.configure([{key:'s',rate:1,routes:[{key:'r',points}]}]);
 const path=V.preparePath(points),front={id:999,path,pathDistance:1,distance:1,speed:0,driver:B.profile(()=>.5,0),route:{},committed:new Set(),decisionAt:0,...V.position(path,1)};
 e.cars=[front];e.advance(0);assert(e.sources.get('s').candidate);assert.equal(e.cars.length,1);
 e.cars=[];e.advance(0);assert.equal(e.cars.length,1);assert.equal(e.cars[0].speed,44);
});
test('playback slows through a zone and accelerates again after leaving it',()=>{
 const decorated=Z.decorate(points,sheet,geometry),e=new V.Engine({behavior:B,speed:44,pixelsPerFoot:1,temperature:0});
 e.configure([{key:'s',rate:.1,routes:[{key:'r',points:decorated}]}]);e.recoverStuck=()=>{};
 const inside=[],after=[];
 for(let i=0;i<2600;i++){e.advance(.05);const c=e.cars.find(c=>c.id===1);if(c?.pathDistance>800&&c.pathDistance<1000)inside.push(c.speed);if(c?.pathDistance>1700)after.push(c.speed);}
 assert(inside.length>20);assert(inside.every(speed=>Math.abs(speed-10*5280/3600)<.5));assert(after.some(speed=>speed>25));
});

test('each road has a local default and a higher zone is not capped by a retired global setting',()=>{
 const defaults=Z.decorate(points,{inchesPerPixel:12},geometry);assert(defaults.every(p=>p.zoneLimit===44));
 const s={inchesPerPixel:12,speedZones:[{road:1,from:0,to:1,mph:60}]},path=V.preparePath(Z.decorate(points,s,geometry));
 const e=new V.Engine({behavior:B,speed:Z.envelope(s)*5280/3600,pixelsPerFoot:1,temperature:0});e.configure([{key:'s',rate:1,routes:[{key:'r',points:path.points}]}]);e.advance(0);assert.equal(e.cars[0].speed,88);
 const connector=Z.decorate([...points,{x:2100,y:0,intersection:'j'}],s,geometry);assert.equal(connector.at(-1).zoneLimit,88,'connector retains its incoming local target');
});
test('route planning uses local section speeds and preserves topology for zero zones',()=>{
 const road={id:1};assert.equal(Z.planningSpeed({roads:[road],speedZones:[]}),30);
 assert.equal(Z.planningSpeed({roads:[road],speedZones:[{road:1,from:0,to:1,mph:60}]}),60);
 assert.equal(Z.planningSpeed({roads:[road],speedZones:[{road:1,from:0,to:1,mph:5}]}),5);
 assert(Z.planningSpeed({roads:[road],speedZones:[{road:1,from:0,to:1,mph:0}]})>0);
 assert(B.acceleration(10,0,Infinity,0,1.6,1,B.profile(()=>.5,0))<0,'moving cars brake toward a zero-speed zone');
});
test('indexed road projections exactly match exhaustive lookup, including folded roads and ties',()=>{
 let seed=7;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 for(const scale of [1,6,10000,1e9]){
  const road=Array.from({length:257},(_,i)=>({x:scale*(100*Math.sin(i/11)+i),y:scale*80*Math.sin(i/7)}));road[32]={...road[31]};
  const lengths=Z.measure(road),lookup=Z.projector(road,lengths);
  for(let i=0;i<500;i++){const p=i<road.length?road[i]:{x:scale*(random()*500-100),y:scale*(random()*400-200)};assert.deepEqual(lookup(p),Z.project(road,lengths,p));}
  const folded=Array.from({length:33},(_,i)=>({x:(i%2)*scale,y:0})),s=Z.measure(folded);assert.deepEqual(Z.projector(folded,s)({x:scale/2,y:scale}),Z.project(folded,s,{x:scale/2,y:scale}));
 }
});
test('indexed partial-zone decoration preserves boundaries, direction and crossing metadata',()=>{
 const road=Array.from({length:129},(_,i)=>({x:i*30,y:Math.sin(i/8)*100})),lengths=Z.measure(road),g={line:road,lengths},lookup=Z.projector(road,lengths);
 const s={inchesPerPixel:2,speedZones:[{road:1,from:.1,to:.7,mph:55},{road:1,from:.4,to:.9,mph:30}]};
 const route=road.map((p,i)=>({...p,road:1,lane:0,station:lengths[i],direction:1,maneuver:{road:1,from:0,to:1,progress:i/128}}));
 for(const path of [route,[...route].reverse()])assert.deepEqual(Z.decorate(path,s,()=>g,(_line,_lengths,p)=>lookup(p)),Z.decorate(path,s,()=>g));
});
test('whole-road zones avoid geometry lookup and retain latest limits through connectors',()=>{
 const s={inchesPerPixel:12,speedZones:[{road:1,from:0,to:1,mph:70},{road:1,from:0,to:1,mph:50}]};
 const decorated=Z.decorate([...points,{x:2100,y:0,intersection:'j'}],s,()=>{throw Error('full-road zone needs no projection');});
 assert.equal(decorated.length,3);assert(decorated.every(p=>p.zoneLimit===50*5280/3600));
 s.speedZones[1].mph=0;assert(Z.decorate(points,s,geometry).every(p=>p.zoneLimit===0),'zone edits are read immediately');
});
