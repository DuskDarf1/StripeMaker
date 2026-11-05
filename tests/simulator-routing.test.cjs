const {test} = require('node:test');
const assert = require('node:assert/strict');
const {build,laneKey} = require('../js/simulator-routing.js');
const lane=(road,index=0)=>({road,lane:index,open:[true,true],points:[{x:road*100,y:index*12},{x:road*100+90,y:index*12}]});
const road=(id,a,b)=>({id,ends:[{joint:a},{joint:b}]});
const link=(a,b,i=0,j=i)=>({from:{road:a,lane:i},to:{road:b,lane:j}});
const empty={ports:[],movements:[]};
const routes=(g,road,lane=0,e=0)=>[...g.search({road,lane,e}).keys()];
test('a weaving lane can continue physically while requiring a merge for the chosen exit',()=>{
 const sheet={roads:[road(1,1,2),road(2,2,3),road(3,2,4)]};
 const roads={lanes:[lane(1),lane(1,1),lane(2),lane(3)],connections:[link(1,2),link(1,3,1,0)]};
 const g=build(sheet,roads,empty);
 assert(g.continues(1,0));assert(g.continues(1,1));
 assert(g.continuesTo(1,0,{road:2,lane:0,e:1}));
 assert(!g.continuesTo(1,1,{road:2,lane:0,e:1},{anyLane:true}));
 assert(g.continuesTo(1,1,{road:3,lane:0,e:1}));
 assert(!g.continuesTo(1,0,{road:3,lane:0,e:1},{anyLane:true}));
 assert(!g.continuesTo(1,0,{road:2,lane:1,e:1}));
 assert(g.continuesTo(1,0,{road:2,lane:1,e:1},{anyLane:true}));
 const reverse=build(sheet,roads,empty,true);
 assert(reverse.continuesTo(3,0,{road:1,lane:1,e:0}));
 assert(!reverse.continuesTo(3,0,{road:1,lane:0,e:0}));
});
test('continues only through the specified lanes, never adjacent or disconnected roads',()=>{
 const sheet={roads:[road(1,1,2),road(2,2,3),road(3,2,4),road(4,5,6)]};
 const g=build(sheet,{lanes:[lane(1),lane(1,1),lane(2),lane(2,1),lane(3),lane(4)],connections:[link(1,2),link(1,3,1,0)]},empty);
 assert.deepEqual(routes(g,1),['r:2:0']);assert.deepEqual(routes(g,1,1),['r:3:0']);
 assert.deepEqual(routes(g,2),[]);assert(!routes(g,1).includes('r:4:0'));
});
test('turn-only intersection requires an explicit directed movement and preserves lane restrictions',()=>{
 const sheet={roads:[road(1,1,2),road(2,3,4),road(3,5,6)]};
 const roads={lanes:[lane(1),lane(1,1),lane(2),lane(3)],connections:[]};
 const ports=[{intersection:'x',lane:'in',ends:[{road:1,lane:0,e:1}]},{intersection:'x',lane:'in2',ends:[{road:1,lane:1,e:1}]},{intersection:'x',lane:'right',ends:[{road:2,lane:0,e:0}]},{intersection:'x',lane:'straight',ends:[{road:3,lane:0,e:0}]}];
 const movements=[{intersection:'x',input:'in',output:'right',points:[{x:190,y:0},{x:200,y:0}]}];
 const g=build(sheet,roads,{ports,movements});
 assert.deepEqual(routes(g,1),['r:2:0']);assert.deepEqual(routes(g,1,1),[]);
 assert.deepEqual(routes(build(sheet,roads,{ports,movements:[]}),1),[]);
 const reverse=build(sheet,roads,{ports,movements},true);
 assert.deepEqual(routes(reverse,2,0,1),['r:1:0']);assert.deepEqual(routes(reverse,3,0,1),[]);
});
test('cycles terminate and a disconnected crossing never becomes an exit route',()=>{
 const sheet={roads:[road(1,1,2),road(2,2,3),road(3,3,2),road(4,3,4),road(5,5,6)]};
 const g=build(sheet,{lanes:[1,2,3,4,5].map(id=>lane(id)),connections:[link(1,2),link(2,3),link(3,2),link(2,4)]},empty);
 assert.deepEqual(routes(g,1),['r:4:0']);
});
test('tapered zero-width mouths cannot act as spawns or exits',()=>{
 const record=lane(1);record.open=[false,false];
 const g=build({roads:[road(1,1,2)]},{lanes:[record],connections:[]},empty);
 assert.deepEqual(g.entrances,[]);assert.deepEqual(g.exits,[]);
});
test('two-way partners share a joint without providing a wrong-way shortcut',()=>{
 const a=road(1,1,2),b=road(2,2,1),sheet={roads:[a,b]};
 const g=build(sheet,{lanes:[lane(1),lane(2)],connections:[]},empty,false,(_,r)=>r===a?b:a);
 assert.deepEqual(routes(g,1),[laneKey({road:1,lane:0})]);assert.deepEqual(routes(g,2),['r:2:0']);
});
test('an intersection-attached road end never advertises its unlinked lanes as exits',()=>{
 const sheet={roads:[road(1,1,2),road(2,3,4)]};
 const roads={lanes:[lane(1),lane(1,1),lane(2)],connections:[]};
 const ports=[{intersection:'x',lane:'in',ends:[{road:1,lane:1,e:1}]},{intersection:'x',lane:'out',ends:[{road:2,lane:0,e:0}]}];
 const movements=[{intersection:'x',input:'in',output:'out',points:[{x:190,y:12},{x:200,y:0}]}];
 const graph=build(sheet,roads,{ports,movements});
 assert(!graph.exits.some(e=>e.road===1));assert.deepEqual(routes(graph,1,0),[]);assert.deepEqual(routes(graph,1,1),['r:2:0']);
});
test('route diagrams follow the same road center through curves regardless of driving lane changes',()=>{
 const C=require('../js/simulator-lane-changes.js');
 const stations=[0,100,200],base=[{x:0,y:0},{x:100,y:40},{x:150,y:130}];
 const record=index=>({road:1,lane:index,open:[true,true],stations,points:base.map((p,i)=>({...p,y:p.y+index*12,road:1,lane:index,station:stations[i],lateral:index*12,laneWidth:12}))});
 const a=record(0),b=record(1),graph=build({roads:[road(1,1,2)]},{lanes:[a,b],connections:[]},empty,false,()=>null,{pixelsPerFoot:1});
 const weaving={points:[...C.slice(a,0,30),...C.transition(a,b,30,170,{blocked:[]},200),...C.slice(b,170,200)]};
 const diagram=graph.displayPath(weaving);
 weaving.points.forEach((p,i)=>{const center=C.sample(a,p.station);assert(Math.abs(diagram[i].x-center.x)<1e-8);assert(Math.abs(diagram[i].y-center.y-6)<1e-8);});
 assert(diagram.some(p=>p.y>50));assert.strictEqual(graph.displayPath(weaving),diagram,'immutable display geometry is cached');
});
test('assembled intersection routes preserve the outgoing road mouth station',()=>{
 const roads={lanes:[{...lane(1),points:[{x:-200,y:0,road:1,lane:0,station:0,direction:1,laneWidth:12},{x:-100,y:0,road:1,lane:0,station:100,direction:1,laneWidth:12}]},
  {...lane(2),points:[{x:0,y:0,road:2,lane:0,station:0,direction:1,laneWidth:12},{x:300,y:0,road:2,lane:0,station:300,direction:1,laneWidth:12}]}],connections:[]};
 const intersections={ports:[{intersection:'r',lane:'in',ends:[{road:1,lane:0,e:1}]},{intersection:'r',lane:'out',ends:[{road:2,lane:0,e:0}]}],movements:[{intersection:'r',input:'in',output:'out',points:[{x:-100,y:0},{x:-50,y:30},{x:0,y:0}]}]};
 const graph=build({roads:[road(1,1,2),road(2,3,4)]},roads,intersections);
 const result=graph.search({road:1,lane:0,e:0}).get('r:2:0');
 const mouth=result.points.find(p=>p.x===0&&p.y===0&&p.road===2);
 assert.equal(mouth.road,2);assert.equal(mouth.station,0);
});

test('left-hand routes reverse the roundabout entry leg and upstream gate geometry',()=>{
 const context={x:195,y:0,direction:-1,entry:'a',exit:'b',gates:[{id:'a',angle:0}],reverseGates:[{id:'b',angle:1}]};
 const roads={lanes:[lane(1),lane(2)],connections:[]},ports=[{intersection:'r',lane:'in',ends:[{road:1,lane:0,e:1}]},{intersection:'r',lane:'out',ends:[{road:2,lane:0,e:0}]}];
 const movements=[{intersection:'r',input:'in',output:'out',points:[{x:190,y:0,roundabout:context,roundaboutPhase:'entry'},{x:195,y:2,roundaboutPhase:'circulating'},{x:200,y:0,roundabout:context,roundaboutPhase:'exit'}]}];
 const graph=build({roads:[road(1,1,2),road(2,3,4)]},roads,{ports,movements},true);
 const points=graph.search({road:2,lane:0,e:1}).get('r:1:0').points;
 const reversed=points.find(p=>p.roundabout).roundabout;
 assert.equal(reversed.entry,'b');assert.equal(reversed.exit,'a');assert.equal(reversed.direction,1);
 assert.deepEqual(reversed.gates,context.reverseGates);assert.equal(context.entry,'a');
});
test('road-wide replanning can finish in the current lane without returning to an obsolete exit lane',()=>{
 const records=[0,1].map(index=>({road:1,lane:index,open:[true,true],stations:[0,2000],points:[0,2000].map(station=>({x:station,y:index*12,road:1,lane:index,station,direction:1,laneWidth:12,lateral:index*12}))}));
 const graph=build({roads:[road(1,1,2)]},{lanes:records,connections:[],laneChangePairs:[{road:1,from:0,to:1,blocked:[]}]},empty,false,()=>null,{speed:30,pixelsPerFoot:1});
 const state={road:1,lane:1,station:500},destination={road:1,lane:0,e:1};
 const flexible=graph.continueFrom(state,destination,{anyLane:true});assert(flexible);assert.equal(flexible.exit.lane,1);assert.equal(flexible.laneChanges.length,0);
 const fixed=graph.continueFrom(state,destination);assert(fixed);assert.equal(fixed.exit.lane,0);assert(fixed.laneChanges.length>0);
});

test('queue replans preserve both turns while allowing either lane of double turns',()=>{
 const {sameTurns}=require('../js/simulator-routing.js');
 for(const direction of ['left','right']){
  const first={intersection:'first',junction:{entry:'south',exit:direction,input:'inner',output:'inner-out'}},next={intersection:'second',junction:{entry:direction,exit:'next-turn',input:'next-in',output:'next-out'}};
  const parallel={...first,junction:{...first.junction,input:'outer',output:'outer-out'}};
  assert(sameTurns([parallel,parallel,{},next],[first,next]));
  assert(!sameTurns([parallel,{}, {...next,junction:{...next.junction,exit:'wrong-turn'}}],[first,next]));
  assert(!sameTurns([parallel],[first,next]));
 }
});

test('explicit converging road links receive upstream merge conflicts without changing geometry',()=>{
 const V=require('../js/simulator-vehicles.js'),T=require('../js/simulator-controls.js');
 const record=(id,a,b)=>({road:id,lane:0,open:[true,true],points:Array.from({length:41},(_,i)=>({x:a.x+(b.x-a.x)*i/40,y:a.y+(b.y-a.y)*i/40,road:id,lane:0,laneWidth:12,station:i*10,direction:1}))});
 const sheet={roads:[road(1,1,2),road(2,3,2),road(3,2,4)]},roads={lanes:[record(1,{x:-400,y:0},{x:0,y:0}),record(2,{x:-200,y:-200},{x:0,y:0}),record(3,{x:0,y:0},{x:400,y:0})],connections:[link(1,3),link(2,3)]};
 const g=build(sheet,roads,empty,false,()=>null,{pixelsPerFoot:1});
 const make=id=>{const raw=g.search({road:id,lane:0,e:0}).get('r:3:0').points,points=g.decorateMerges(raw),path=V.preparePath(points),m=path.movements[0];
  assert.deepEqual(points.map(p=>[p.x,p.y,p.road,p.lane]),raw.map(p=>[p.x,p.y,p.road,p.lane]));
  assert(m?.junction.roadMerge);const join=V.preparePath(raw).roadEntries.find(e=>e.road===3).distance;assert(m.start<join&&m.end>join);assert(require('../js/simulator-routing.js').sameTurns(points,[]));
  return {path,pathDistance:0,entryIntersection:m.intersection};};
 const through=make(1),feeder=make(2);assert(T.order(feeder,through)>0);assert(T.order(through,feeder)<0);
 const separate=build(sheet,{...roads,connections:[link(1,3)]},empty,false,()=>null,{pixelsPerFoot:1});
 const raw=separate.search({road:1,lane:0,e:0}).get('r:3:0').points;assert(!separate.decorateMerges(raw).some(p=>p.junction?.roadMerge),'unjoined crossing geometry cannot create a merge');
 const reverse=build(sheet,roads,empty,true,()=>null,{pixelsPerFoot:1});
 for(const p of reverse.search({road:3,lane:0,e:1}).values())assert(!reverse.decorateMerges(p.points).some(p=>p.junction?.roadMerge),'a reversed merge is a divergence');
});
test('a side road at a merge may turn directly into a farther lane only when ordinary lane changes cannot reach the exit',()=>{
 const V=require('../js/simulator-vehicles.js'),T=require('../js/simulator-controls.js');
 const record=(id,k,a,b,n=40)=>({road:id,lane:k,open:[true,true],points:Array.from({length:n+1},(_,i)=>({x:a.x+(b.x-a.x)*i/n,y:a.y+(b.y-a.y)*i/n,road:id,lane:k,laneWidth:12,station:Math.hypot(b.x-a.x,b.y-a.y)*i/n,direction:1}))});
 // Through road 1 and short road 3 (no room for ordinary changes) have three
 // lanes; side road 2 joins road 3's right lane (y = 24) at a merge.
 const lanes=[0,1,2].flatMap(k=>[record(1,k,{x:-400,y:k*12},{x:0,y:k*12}),record(3,k,{x:0,y:k*12},{x:200,y:k*12}),record(4,k,{x:200,y:k*12},{x:300,y:k*12})]);
 lanes.push(record(2,0,{x:-150,y:174},{x:0,y:24}));
 const sheet={roads:[road(1,1,2),road(2,3,2),road(3,2,4),road(4,4,5)]};
 const pairs=(crossing=false)=>[0,1].map(k=>({road:3,from:k,to:k+1,blocked:[],crossings:crossing&&k===0?[{points:[],ranges:[]}]:[]}));
 const roads=c=>({lanes,connections:[...[0,1,2].flatMap(k=>[link(1,3,k),link(3,4,k)]),link(2,3,0,2)],laneChangePairs:pairs(c)});
 const g=build(sheet,roads(),empty,false,()=>null,{pixelsPerFoot:1});
 const plain=build(sheet,roads(),empty,false,()=>null,{pixelsPerFoot:1,directEntries:false});
 assert.deepEqual(routes(plain,2).sort(),['r:4:2']);assert.deepEqual(routes(g,2).sort(),['r:4:0','r:4:1','r:4:2']);
 const direct=g.search({road:2,lane:0,e:0}).get('r:4:0').points,first=direct.find(p=>p.road===3);
 assert.equal(first.lane,0,'turns straight into the far lane');assert(direct.every(p=>p.road!==3||p.lane===0));
 assert.equal(g.search({road:2,lane:0,e:0}).get('r:4:0').laneChanges.length,0);
 // The turn and the through stream in that lane share one admission envelope.
 const tagged=points=>V.preparePath(g.decorateMerges(points)).movements.find(m=>m.junction?.roadMerge);
 const feeder=tagged(direct),through=tagged(g.search({road:1,lane:0,e:0}).get('r:4:0').points);
 assert(feeder&&through);assert.equal(feeder.intersection,through.intersection);assert.equal(feeder.junction.output,'r:3:0');
 const car=(id,m)=>({id,pathDistance:0,entryIntersection:m.intersection,path:{movements:[m]}});
 assert(T.order(car(1,feeder),car(2,through))>0,'the turning side road yields to through traffic');
 // A bicycle facility between the lanes is never crossed by the turn.
 assert(!routes(build(sheet,roads(true),empty,false,()=>null,{pixelsPerFoot:1}),2).includes('r:4:0'));
});
