const {test}=require('node:test'),assert=require('node:assert/strict');
const G=require('../js/intersection-geometry.js');
const island=(points)=>({id:G.id(),type:'concrete',points});
test('custom medians preserve automatic, grouped, manual and preview movement paths',()=>{
 const item=G.create();item.approaches.forEach(a=>{a.incoming=2;a.outgoing=2;});G.normalize(item);G.auto(item);
 const manual=item.movements.find(m=>m.from===item.approaches[0].id&&m.to===item.approaches[1].id);
 Object.assign(manual,{autoCurve:false,pullIn:28,pullOut:36});
 const before=G.routing(item),paths=G.routes(item),data=structuredClone(item.movements);
 const preview=G.movement(item.approaches[0],0,item.approaches[2],0),previewPath=G.route(item,preview);
 item.medians=[island([{x:-8,y:-9},{x:8,y:-9},{x:8,y:9},{x:-8,y:9}])];
 assert.equal(G.routing(item),before,'visual edits do not invalidate movement geometry');
 const reloaded=structuredClone(item);
 assert.deepEqual(G.routes(reloaded),paths,'fresh routes match too, not just cached paths');
 assert.deepEqual(G.route(reloaded,preview),previewPath,'drag previews remain unchanged');
 item.medians[0].points[0].x-=1;
 assert.deepEqual(G.routes(structuredClone(item)),paths,'moving a median does not reshape paths');
 assert.deepEqual(item.movements,data,'manual movement controls stay intact');
});
test('even a custom median spanning a movement leaves that movement available',()=>{
 const item=G.create();G.auto(item);const m=item.movements.find(m=>m.from===item.approaches[0].id&&m.to===item.approaches[2].id);
 const before=G.route(item,m);assert.ok(before.length>2);
 item.medians=[island([{x:-2,y:-100},{x:2,y:-100},{x:2,y:100},{x:-2,y:100}])];
 assert.deepEqual(G.route(structuredClone(item),m),before);
});
test('median anchors follow mouth medians and corners, including curved boundary legs',()=>{
 const item=G.create(),a=item.approaches[0];a.median=12;a.nose=30;G.normalize(item);
 const m=island([{x:0,y:0,on:{approach:a.id,side:'median',f:0}},{x:0,y:0,on:{approach:a.id,side:'median',f:1}},{x:0,y:0}]);
 const before=G.islandPoint(item,m.points[0]);a.median=20;const after=G.islandPoint(item,m.points[0]);assert.notDeepEqual(after,before);
 assert.ok(G.islandOutline(item,m).length>3);
 const corner={x:0,y:0,on:{approach:a.id,side:'corner',f:.5}};assert.ok(Number.isFinite(G.islandPoint(item,corner).x));
 assert.ok(G.validIsland(m));assert.equal(G.validIsland({...m,points:[{x:NaN,y:0}]}),false);
});
test('median containment includes edges, curves, mouth boundaries, and concave corners',()=>{
 const item=G.create();G.normalize(item);
 assert.ok(G.islandWithin(item,island([{x:-8,y:-8},{x:8,y:-8},{x:0,y:8}])));
 const outside=island([{x:0,y:0},{x:70,y:0},{x:0,y:8}]);
 assert.equal(G.islandWithin(item,outside),false);item.medians=[outside];assert.match(G.validate(item),/inside/);delete item.medians;
 const chord=[{x:50,y:12},{x:12,y:50}];assert.ok(chord.every(p=>G.islandPathInside(item,[p])));
 assert.equal(G.islandPathInside(item,chord,false),false,'inside vertices cannot bridge the outside of a concave corner');
 const curve=island([{x:-8,y:-8,curve:{in:{x:0,y:0},out:{x:0,y:-180}}},{x:8,y:-8},{x:0,y:8}]);assert.equal(G.islandWithin(item,curve),false);
 const a=item.approaches[0],edge=G.medianEdge(item,{approach:a.id,side:'corner'});
 const anchored=island([{...edge[0],on:{approach:a.id,side:'corner',f:0}},{...edge.at(-1),on:{approach:a.id,side:'corner',f:1}},{x:0,y:0}]);
 assert.ok(G.islandWithin(item,anchored),'anchored outline keeps every sampled corner vertex');
 assert.ok(G.islandPathInside(item,[G.edge(a,true,2/3)]),'mouth boundary is allowed');
});
test('approach lane-line anchors track lane identity, widths and curves',()=>{
 const item=G.create(),a=item.approaches[0];a.incoming=2;a.outgoing=2;G.normalize(item);
 const on={approach:a.id,side:`lane:in:${a.inLanes[1]}:L`,f:.4};
 const p={x:0,y:0,on},before=G.islandPoint(item,p);
 assert.ok(G.islandLaneEdges(item).some(e=>e.on.side===on.side));
 assert.equal(before.y,G.boundary(a,true,1));
 a.width=14;const after=G.islandPoint(item,p);assert.notEqual(after.y,before.y);
 G.setApproachBezier(item,a,{x:0,y:5});G.normalize(item);assert.ok(G.medianEdge(item,on).length>2);
 assert.notDeepEqual(G.islandPoint(item,p),after);
});
