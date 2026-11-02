const {test}=require('node:test'),assert=require('node:assert/strict');
const C=require('../js/curve-links.js'),T=require('../js/item-transform.js');
const close=(a,b)=>{assert(Math.abs(a.x-b.x)<1e-8);assert(Math.abs(a.y-b.y)<1e-8);};
test('reflection about an arbitrary axis is reversible and preserves distances',()=>{
 const axis=[{x:20,y:-5},{x:110,y:70}],p={x:61,y:124},q={x:175,y:44};
 close(C.reflectPoint(C.reflectPoint(p,axis),axis),p);
 const a=C.reflectPoint(p,axis),b=C.reflectPoint(q,axis);
 assert(Math.abs(Math.hypot(a.x-b.x,a.y-b.y)-Math.hypot(p.x-q.x,p.y-q.y))<1e-8);
 close(C.reflectVector({x:.6,y:.8},[{x:0,y:0},{x:1,y:0}]),{x:.6,y:-.8});
});
test('deleted and malformed constraint members release without affecting geometry',()=>{
 const link={id:'pair',mode:'parallel',polarity:1},a={joint:1,length:24,curveLink:{...link}},b={joint:2,length:24,curveLink:{...link}};
 const sheet={roads:[{id:1,ends:[a,{}]},{id:2,ends:[b,{}]}]};C.prune(sheet);assert(a.curveLink);sheet.roads.pop();C.prune(sheet);assert(!a.curveLink);assert.equal(a.length,24);
 assert(!C.valid({...link,rotation:'opposite',axis:[{x:0,y:0},{x:0,y:0}]}));
});
test('rigid item transforms compose and follow a rotated parent without doubling rotation',()=>{
 const item={},p={x:120,y:50},pivot={x:40,y:30};T.rotate(item,35,pivot);const placed=T.apply(item,p);
 const base={};T.rotate(base,70,pivot);const moved=T.apply(base,p),expected=T.apply(base,placed);
 T.rotate(item,70,pivot,true);close(T.apply(item,moved),expected);
 const previous=T.apply(item,moved);T.translate(item,100,-30,true);close(T.apply(item,{x:moved.x+100,y:moved.y-30}),{x:previous.x+100,y:previous.y-30});
});
