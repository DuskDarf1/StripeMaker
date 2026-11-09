const {test}=require('node:test'),assert=require('node:assert/strict'),C=require('../js/clothoid.js'),A=require('../js/circular-arc.js');
const distance=(p,q)=>Math.hypot(p.x-q.x,p.y-q.y);
test('clothoids fit endpoints and have linearly varying curvature',()=>{
 for(const angle of [-270,-90,0,90,270]){
 const a={x:10,y:20},b={x:500,y:400},g=C.geometry(a,b,{start:0,end:angle*2});assert(distance(g.point(0),a)<1e-8);assert(distance(g.point(1),b)<1e-8);
 for(const f of [.1,.3,.6,.9]){const h=1e-5,p=g.point(f-h).tangent,q=g.point(f+h).tangent,delta=Math.atan2(p.x*q.y-p.y*q.x,p.x*q.x+p.y*q.y);assert(Math.abs(delta/(2*h)-angle*2*Math.PI/180*f)<1e-7);}
 }
});
test('clothoid cuts and reversed partners preserve geometry',()=>{
 const a={x:20,y:30},b={x:450,y:350},profile={start:-30,end:200},g=C.geometry(a,b,profile);
 for(const f of [.15,.5,.8]){const [p,q]=C.split(profile,f),m=g.point(f),first=C.geometry(a,m,p),second=C.geometry(m,b,q);for(const t of [0,.25,.8,1]){assert(distance(first.point(t),g.point(t*f))<1e-6);assert(distance(second.point(t),g.point(f+(1-f)*t))<1e-6);}}
 const reverse=C.geometry(b,a,{start:-profile.end,end:-profile.start});for(const t of [0,.2,.5,.9,1])assert(distance(reverse.point(t),g.point(1-t))<1e-6);
});
test('circle fitting preserves left/right bend and straight roads',()=>{
 for(const angle of [-270,-90,0,90,270]){const points=A.sample({x:0,y:0},{x:500,y:300},angle);assert(Math.abs(A.fit(points)-angle)<.05);}
});
test('full circles close exactly and retain their radius',()=>{
 for(const angle of [-360,360]){const a={x:300,y:400},loop={radius:150,heading:{x:1,y:0}},g=A.geometry(a,a,angle,loop);assert(distance(g.point(1),a)<1e-9);for(const p of A.sample(a,a,angle,loop))assert(Math.abs(distance(p,g.center)-150)<1e-9);}
});
