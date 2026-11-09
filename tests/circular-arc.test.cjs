const {test}=require('node:test'),assert=require('node:assert/strict'),G=require('../js/circular-arc.js');
test('circular arcs keep exact radius, endpoints and tangents for both sweep directions',()=>{
 for(const angle of [-180,-90,-1,-.00001,0,.00001,1,90,180]){
  const a={x:100,y:200},b={x:700,y:650},g=G.geometry(a,b,angle),p=g.point(0),q=g.point(1);
  assert(Math.hypot(p.x-a.x,p.y-a.y)<1e-8);assert(Math.hypot(q.x-b.x,q.y-b.y)<1e-8);
  if(Math.abs(angle)>.001){const sign=Math.sign(angle),c={x:a.x-p.tangent.y*g.radius*sign,y:a.y+p.tangent.x*g.radius*sign};for(const p of G.sample(a,b,angle))assert(Math.abs(Math.hypot(p.x-c.x,p.y-c.y)-g.radius)<1e-7);}
  for(const f of [0,.1,.5,.8,1]){const p=g.point(f),q=G.geometry(b,a,-angle).point(1-f);assert(Math.hypot(p.x-q.x,p.y-q.y)<1e-7);}
 }
});
test('splitting by angular fraction preserves the circle exactly',()=>{
 const a={x:0,y:0},b={x:500,y:300};
 for(const angle of [-180,-90,0,90,180])for(const f of [.1,.5,.9]){
  const g=G.geometry(a,b,angle),m=g.point(f),before=G.geometry(a,m,angle*f),after=G.geometry(m,b,angle*(1-f));
  for(const t of [0,.2,.7,1]){const p=before.point(t),q=g.point(f*t),r=after.point(t),s=g.point(f+(1-f)*t);assert(Math.hypot(p.x-q.x,p.y-q.y)<1e-7);assert(Math.hypot(r.x-s.x,r.y-s.y)<1e-7);}
 }
});
test('fitted circles slide along both meeting lane axes and keep their radius',()=>{
 for(const degrees of [-140,-90,90,140]){
  const a={x:200,y:100},b={x:400,y:300},sign=Math.sign(degrees),d={x:1,y:0},e={x:0,y:sign};
  const fit=G.fitTangents(a,b,d,e,100,degrees);
  assert(fit);const arc=G.geometry(fit.start,fit.end,fit.degrees);
  assert(Math.abs(arc.radius-100)<1e-8);
  for(const [p,axis,anchor] of [[fit.start,d,a],[fit.end,e,b]])assert(Math.abs((p.x-anchor.x)*axis.y-(p.y-anchor.y)*axis.x)<1e-8);
  assert(arc.point(0).tangent.x*d.x+arc.point(0).tangent.y*d.y>1-1e-10);
  assert(arc.point(1).tangent.x*e.x+arc.point(1).tangent.y*e.y>1-1e-10);
 }
 assert.equal(G.fitTangents({x:0,y:0},{x:100,y:0},{x:1,y:0},{x:1,y:0},100,90),null,'parallel axes cannot define this fillet');
});
test('fitting follows both curved host lanes at their true tangency points',()=>{
 for(const sign of [-1,1]){
  const first=G.laneCurve({a:{x:0,y:0},c0:{x:100/3,y:0},c1:{x:200/3,y:sign*20/3},b:{x:100,y:sign*20}});
  const radius=40,t=.75,u=.3,start={x:100*t,y:sign*20*t*t},speed=Math.hypot(100,40*t);
  const d={x:100/speed,y:sign*40*t/speed},e={x:-sign*d.y,y:sign*d.x};
  const center={x:start.x-sign*radius*d.y,y:start.y+sign*radius*d.x};
  const end={x:center.x+sign*radius*e.y,y:center.y-sign*radius*e.x};
  const position=v=>({x:end.x+100*e.x*(v-u)-sign*20*e.y*(v-u)**2,y:end.y+100*e.y*(v-u)+sign*20*e.x*(v-u)**2});
  const derivative=v=>({x:100*e.x-sign*40*e.y*(v-u),y:100*e.y+sign*40*e.x*(v-u)});
  const a=position(0),b=position(1),da=derivative(0),db=derivative(1);
  const second=G.laneCurve({a,b,c0:{x:a.x+da.x/3,y:a.y+da.y/3},c1:{x:b.x-db.x/3,y:b.y-db.y/3}});
  const fit=G.fitCurves(first,second,radius,sign*90);
  assert(fit);assert(Math.abs(fit.parameters[0]-t)<1e-7);assert(Math.abs(fit.parameters[1]-u)<1e-7);
  assert(Math.hypot(fit.center.x-center.x,fit.center.y-center.y)<1e-7);
  const circle=G.geometry(fit.start,fit.end,fit.degrees);
  assert(Math.abs(circle.radius-radius)<1e-7);
  for(const [point,dir] of [[circle.point(0),d],[circle.point(1),e]])assert(point.tangent.x*dir.x+point.tangent.y*dir.y>1-1e-10);
  const at=second(0),extension=second(-.2);
  assert(Math.abs((extension.x-at.x)*at.tangent.y-(extension.y-at.y)*at.tangent.x)<1e-7,'outside the host, use its tangent instead of extrapolating the cubic');
 }
});
