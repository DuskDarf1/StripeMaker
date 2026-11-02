const {test} = require('node:test');
const assert = require('node:assert/strict');
const {build,laneKey} = require('../js/simulator-routing.js');
const lane=(road,index=0)=>({road,lane:index,open:[true,true],points:[{x:road*100,y:index*12},{x:road*100+90,y:index*12}]});
const road=(id,a,b)=>({id,ends:[{joint:a},{joint:b}]});
const link=(a,b,i=0,j=i)=>({from:{road:a,lane:i},to:{road:b,lane:j}});
const empty={ports:[],movements:[]};
const routes=(g,road,lane=0,e=0)=>[...g.search({road,lane,e}).keys()];
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
