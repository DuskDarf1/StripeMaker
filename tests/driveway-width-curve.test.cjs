const assert=require('node:assert/strict');
const {laneAt}=require('../js/road-widths.js');
// Geometry from kinkcurve.json: road 12, a 20 ft driveway joining a 12 ft lane.
const scale=12/30.64491410424349,dir={x:.01857705153884792,y:.9998274316881504};
const start={x:3661.641659058301,y:1048.240105364452},end={x:3613.5855293004743,y:1055.6494744633292};
const a={x:start.x-dir.y*6*scale,y:start.y+dir.x*6*scale},b=end;
const chord=Math.hypot(b.x-a.x,b.y-a.y),c={x:a.x+dir.x*chord/3,y:a.y+dir.y*chord/3};
const sheet={inchesPerPixel:12/scale,joints:[{id:1,...start},{id:2,...end}]};
const road={laneWidth:20,keepWidthAtJoins:true,ends:[{joint:1},{joint:2}]};
const line=[],along=[0];
for(let i=0;i<=1000;i++){
 const t=i/1000,u=1-t;
 const p={x:u*u*u*a.x+3*u*u*t*c.x+(3*u*t*t+t*t*t)*b.x,y:u*u*u*a.y+3*u*u*t*c.y+(3*u*t*t+t*t*t)*b.y};
 let dx=3*u*u*(c.x-a.x)+6*u*t*(b.x-c.x),dy=3*u*u*(c.y-a.y)+6*u*t*(b.y-c.y);
 if(!Math.hypot(dx,dy)){dx=b.x-c.x;dy=b.y-c.y;}
 const len=Math.hypot(dx,dy);p.n={x:-dy/len,y:dx/len};
 if(i)along.push(along.at(-1)+Math.hypot(p.x-line.at(-1).x,p.y-line.at(-1).y));line.push(p);
}
for(const side of [-1,1]){
 const edge=line.map((p,i)=>{const w=laneAt(sheet,road,0,along[i]/along.at(-1),[20,20])*scale/2;return {x:p.x+side*p.n.x*w,y:p.y+side*p.n.y*w};});
 for(let i=1;i<edge.length-1;i++){
  const [a,b,c]=edge.slice(i-1,i+2);
  const cross=(b.x-a.x)*(c.y-b.y)-(b.y-a.y)*(c.x-b.x);
  assert(cross>=-1e-9,`edge ${side} reverses curvature at sample ${i}: ${cross}`);
 }
}
assert.equal(laneAt(sheet,road,0,0,[20,20]),20);
assert.equal(laneAt(sheet,road,0,.5,[20,20]),20);
console.log('PASS: both driveway edges turn continuously without an S-kink; 20 ft is retained through the full turn before boundary clipping.');
