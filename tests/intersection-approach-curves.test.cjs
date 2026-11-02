const {test}=require('node:test'),assert=require('node:assert/strict');
const G=require('../js/intersection-geometry.js');
const near=(a,b)=>assert(Math.hypot(a.x-b.x,a.y-b.y)<1e-8);
const inPavement=(p,polygon)=>G.contains(p,polygon)||polygon.some((a,i)=>{
 const b=polygon[(i+1)%polygon.length],d=G.sub(b,a),t=G.clamp(G.dot(G.sub(p,a),d)/(G.dot(d,d)||1),0,1);
 // The movement router samples curved boundaries; allow 0.01 ft at an edge.
 return G.length(G.sub(p,G.add(a,G.mul(d,t))))<.01;
});
test('one approach cubic holds mouths and lane widths while curving both directions',()=>{
 const item=G.create();G.normalize(item);const before=structuredClone(item),a=item.approaches[0];
 const untouched=G.corner(item.approaches[1],item.approaches[2]);G.setApproachBezier(item,a,{x:0,y:3});G.normalize(item);
 assert.equal(G.validate(item),'');assert(a.approachCurve);assert.equal(item.movements.length,0);
 near(a,before.approaches[0]);assert.deepEqual(item.approaches.slice(1),before.approaches.slice(1));assert.deepEqual(G.corner(item.approaches[1],item.approaches[2]),untouched);
 assert(a.approachCurve.span>50,'the curve extends through the conflict zone rather than stopping at the throat');
 for(const f of [0,.2,.4,.6,.8,1]) {
  const s=-a.approachCurve.span*f,l=G.local(a,-12,s),r=G.local(a,12,s);
  assert(Math.abs(G.length(G.sub(l,r))-24)<1e-8,'offsets keep their actual widths');
 }
 const middle=G.local(a,0,-a.approachCurve.span/2);assert(Math.abs(middle.y)>1,'the approach is a curve rather than a turned straight line');
 const line=G.approachLine(a,0,0,-a.approachCurve.span);assert(line.length>2);assert(G.dot(line[0].tangent,G.axes(a).u)<-.99999);
 near(line.at(-1),{x:a.x-a.approachCurve.span,y:a.y});
});
test('curved median surfaces and movement routes stay in the intersection pavement',()=>{
 const item=G.create(),a=item.approaches[0];a.median=6;a.nose=25;G.normalize(item);G.auto(item);
 G.setApproachBezier(item,a,{x:0,y:2});G.normalize(item);assert.equal(G.validate(item),'');
 const polygon=G.outline(item,2/3),median=G.medians(a)[0];assert(median.points.length>30);
 for(const p of median.points)assert(inPavement(p,polygon),'median follows the paved approach');
 const routes=G.routes(item,G.routing(item,2/3));
 for(const points of routes.values())for(const p of points.slice(1,-1))assert(inPavement(p,polygon),'movements stay in curved pavement');
});
test('approach curves round-trip through JSON and straighten without changing the opening',()=>{
 const item=G.create();G.normalize(item);const before=G.outline(item),a=item.approaches[0];
 G.setApproachBezier(item,a,{x:2,y:1});G.normalize(item);const saved=JSON.parse(JSON.stringify(item));
 G.normalize(saved);assert.deepEqual(G.outline(saved),G.outline(item));
 const normalized=JSON.stringify(saved);G.normalize(saved);assert.equal(JSON.stringify(saved),normalized);
 G.straightenApproach(saved.approaches[0]);G.normalize(saved);assert.deepEqual(G.outline(saved),before);
});

test('one-way handle pivots at the middle of the opening and reaches the actual merge',()=>{
 const item=structuredClone(require('./fixtures/intersection-pinch-point.json'));G.normalize(item);
 const a=item.approaches[1],mouth=G.approachCenter(a),h=G.approachBezierHandle(item,a);
 near(h.from,G.mul(G.add(G.edge(a,true),G.edge(a,false)),.5));
 const before=structuredClone(item),angle=125*Math.PI/180,target={x:mouth.x-Math.cos(angle)*150,y:mouth.y-Math.sin(angle)*150};
 G.setApproachBezier(before,a,G.sub(target,h.p));G.normalize(item);
 near(G.approachCenter(a),mouth);assert.equal(G.validate(item),'');assert(a.approachCurve.span>300);
 assert(a.approachCurve.end.x>0&&a.approachCurve.end.y>0&&a.approachCurve.end.y<36,'endpoint lies in the receiving carriageway');
 assert.equal(a.approachCurve.endAngle,180,'the approach joins the direction of its receiving lanes');
 const c=(G.side(a,true)+G.side(a,false))/2;near(G.local(a,c,-a.approachCurve.span),a.approachCurve.end);
 const reset=structuredClone(a);G.straightenApproach(reset);near(G.approachCenter(reset),mouth);
});
test('long control drags keep ordered projections through the conflict zone',()=>{
 const item=structuredClone(require('./fixtures/intersection-pinch-point.json'));G.normalize(item);const a=item.approaches[1],before=structuredClone(item),h=G.approachBezierHandle(item,a),angle=125*Math.PI/180;
 const target={x:h.from.x-Math.cos(angle)*1000,y:h.from.y-Math.sin(angle)*1000};G.setApproachBezier(before,a,G.sub(target,h.p));G.normalize(item);
 const center=G.approachCenter(a),direction=G.unit(G.sub(a.approachCurve.end,center)),offset=(G.side(a,true)+G.side(a,false))/2;
 let previous=-Infinity;
 for(let i=0;i<=100;i++){const p=G.local(a,offset,-a.approachCurve.span*i/100),progress=G.dot(G.sub(p,center),direction);assert(progress>=previous-1e-8,'the curve must not fold back before its conflict endpoint');previous=progress;}
 assert(a.approachCurve.pull<1000);assert.equal(G.validate(item),'');
});
test('merge movements follow the curved lane before turning smoothly inside the conflict area',()=>{
 const item=structuredClone(require('./fixtures/intersection-pinch-point.json'));G.normalize(item);
 const a=item.approaches[1],h=G.approachBezierHandle(item,a),angle=125*Math.PI/180;
 G.setApproachBezier(item,a,G.sub({x:h.from.x-Math.cos(angle)*150,y:h.from.y-Math.sin(angle)*150},h.p));G.normalize(item);
 const region=G.routing(item,2/3);
 for(const m of item.movements.filter(m=>m.from===a.id)) {
  const route=G.route(item,m,region);assert(route.length>80,'use a sampled curved route rather than polygon waypoints');
  const j=a.inLanes.indexOf(m.input),offset=G.dot(G.sub(G.ridingLane(a,true,j),a),G.axes(a).n);
  const lane=G.approachLine(a,offset);
  const follows=p=>lane.some((a,i)=>{if(!i)return false;const b=lane[i-1],d=G.sub(a,b),f=G.clamp(G.dot(G.sub(p,b),d)/(G.dot(d,d)||1),0,1);return G.length(G.sub(p,G.add(b,G.mul(d,f))))<.02;});
  for(const p of route.slice(0,10))assert(follows(p),'the beginning follows the actual offset lane');
  assert(route.every(region.inside),'the transition respects the actual conflict pavement');
  m.autoCurve=false;m.pullIn=30;m.pullOut=20;
  const manual=G.route(item,m,region);for(const p of manual.slice(0,10))assert(follows(p));
 }
});
