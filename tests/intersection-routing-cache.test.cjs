const {test}=require('node:test'),assert=require('node:assert/strict');
const G=require('../js/intersection-geometry.js');
test('normal intersection geometry and individual routes reuse unchanged constructions',()=>{
 const x=G.create();G.normalize(x);G.auto(x);const r=G.routing(x,2/3),a=x.approaches[0],b=G.ordered(x)[1];
 assert.strictEqual(G.routing(x,2/3),r);assert.strictEqual(G.corner(a,b),G.corner(a,b));
 const m=x.movements[0],p=G.route(x,m,r);assert.strictEqual(G.route(x,m,r),p);
 const other=x.movements[1],q=G.route(x,other,r);m.autoCurve=false;m.pullIn=15;m.pullOut=20;
 assert.notStrictEqual(G.route(x,m,r),p);assert.strictEqual(G.route(x,other,r),q);
 a.radius+=1;assert.notStrictEqual(G.routing(x,2/3),r);
});
test('indexed pavement queries agree with polygon geometry on curved approaches and holes',()=>{
 const x=G.create();x.approaches[0].median=6;G.normalize(x);G.setApproachBezier(x,x.approaches[0],{x:0,y:2});G.normalize(x);
 const r=G.routing(x,2/3);
 for(let x=-70;x<=70;x+=1.73)for(let y=-70;y<=70;y+=1.91){
  const p={x,y},polys=[r.polygon,...r.holes];
  const near=polys.some(poly=>poly.some((a,i)=>{const b=poly[(i+1)%poly.length],d=G.sub(b,a),f=G.clamp(G.dot(G.sub(p,a),d)/(G.dot(d,d)||1),0,1);return G.length(G.sub(p,G.add(a,G.mul(d,f))))<.003;}));
  if(!near)assert.equal(r.inside(p),G.contains(p,r.polygon)&&!r.holes.some(h=>G.contains(p,h)));
 }
});
