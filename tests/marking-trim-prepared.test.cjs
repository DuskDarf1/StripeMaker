const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {test}=require('node:test');
const source=fs.readFileSync('js/marking-trim.js','utf8');
function optimized(){
 let hypotCalls=0;const math=Object.create(Math);math.hypot=(...args)=>{hypotCalls++;return Math.hypot(...args);};
 const context={module:{exports:{}},Math:math};vm.runInNewContext(source,context);
 return {trim:(...args)=>structuredClone(context.module.exports.trim(...args)),calls:()=>hypotCalls};
}
// Previous unprepared algorithm, retained as an exact geometric oracle. It
// intentionally computes boundary tolerance for each midpoint and polygon edge.
function reference(hypot=Math.hypot){
 const EPS=1e-7,boxes=new WeakMap(),sub=(a,b)=>({x:a.x-b.x,y:a.y-b.y}),cross=(a,b)=>a.x*b.y-a.y*b.x;
 const at=(a,b,t)=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
 function inside(p,polygon){let hit=false;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
  const a=polygon[j],b=polygon[i],d=sub(b,a),v=sub(p,a);
  if(Math.abs(cross(d,v))<=EPS*Math.max(1,hypot(d.x,d.y))&&v.x*d.x+v.y*d.y>=-EPS&&v.x*d.x+v.y*d.y<=d.x*d.x+d.y*d.y+EPS)return false;
  if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)hit=!hit;
 }return hit;}
 function box(polygon){let b=boxes.get(polygon);if(!b){b={x0:Infinity,y0:Infinity,x1:-Infinity,y1:-Infinity};for(const p of polygon){b.x0=Math.min(b.x0,p.x);b.y0=Math.min(b.y0,p.y);b.x1=Math.max(b.x1,p.x);b.y1=Math.max(b.y1,p.y);}boxes.set(polygon,b);}return b;}
 return function trim(points,polygons){const result=[];let walked=0,current=null;for(let i=1;i<points.length;i++){
  const a=points[i-1],b=points[i],d=sub(b,a),length=hypot(d.x,d.y);if(length<EPS)continue;
  const cuts=[0,1],pad=EPS*Math.max(1,length),x0=Math.min(a.x,b.x)-pad,x1=Math.max(a.x,b.x)+pad,y0=Math.min(a.y,b.y)-pad,y1=Math.max(a.y,b.y)+pad;
  const near=polygons.filter(polygon=>{const q=box(polygon);return q.x0<=x1&&q.x1>=x0&&q.y0<=y1&&q.y1>=y0;});
  for(const polygon of near)for(let j=0;j<polygon.length;j++){
   const p=polygon[j],q=polygon[(j+1)%polygon.length],edge=sub(q,p),v=sub(p,a),den=cross(d,edge);
   if(Math.abs(den)<EPS){if(Math.abs(cross(v,d))<EPS)for(const point of[p,q]){const t=((point.x-a.x)*d.x+(point.y-a.y)*d.y)/(length*length);if(t>0&&t<1)cuts.push(t);}continue;}
   const t=cross(v,edge)/den,u=cross(v,d)/den;if(t>0&&t<1&&u>=-EPS&&u<=1+EPS)cuts.push(t);
  }
  cuts.sort((a,b)=>a-b);for(let j=1;j<cuts.length;j++){
   const lo=cuts[j-1],hi=cuts[j];if(hi-lo<EPS)continue;
   if(near.some(p=>inside(at(a,b,(lo+hi)/2),p))){current=null;continue;}
   if(!current){current={points:[at(a,b,lo)],distance:walked+lo*length};result.push(current);}current.points.push(at(a,b,hi));
  }walked+=length;
 }return result;};
}
test('prepared trimming exactly preserves boundaries, overlaps, concavity, tiny segments and dash offsets',()=>{
 const A=optimized(),old=reference();let seed=1234;const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/2**32);
 let count=0;
 for(const scale of [1e-5,1,1e5])for(let trial=0;trial<100;trial++){
  const polygons=Array.from({length:trial%5},(_,p)=>Array.from({length:3+trial%15},(_,i)=>{
   const angle=i*Math.PI*2/(3+trial%15),radius=(i%2?35:50)+random()*15;
   return {x:(Math.cos(angle)*radius+p*40)*scale,y:(Math.sin(angle)*radius+p*15)*scale};
  }));
  if(trial%7===0&&polygons[0])polygons[0].splice(2,0,{...polygons[0][1]});
  const lines=[Array.from({length:2+trial%15},(_,i)=>({x:(i*20-100)*scale,y:(random()*160-80)*scale})),
   ...polygons.map(p=>[...p,{...p[0]}]),
   ...polygons.map(p=>p.map(q=>({x:q.x+1e-8,y:q.y-1e-8})))];
  for(const line of lines){assert.deepEqual(A.trim(line,polygons),old(line,polygons),`scale ${scale}, trial ${trial}`);count++;}
 }
 assert(count>1000);
});
test('edge preparation remains local to each trim call and removes repeated edge lengths',()=>{
 const A=optimized();let referenceCalls=0;const old=reference((...args)=>{referenceCalls++;return Math.hypot(...args);});
 const polygon=Array.from({length:120},(_,i)=>({x:Math.cos(i*Math.PI/60)*100,y:Math.sin(i*Math.PI/60)*100}));
 const line=Array.from({length:301},(_,i)=>({x:i-150,y:Math.sin(i/30)*30}));
 assert.deepEqual(A.trim(line,[polygon]),old(line,[polygon]));
 assert(A.calls()<referenceCalls/10,'each polygon edge length is measured once per trim, not once per midpoint');
 // Keep array identities and mutate points between reads. Prepared vectors
 // must see new values even when the earlier bounding-box cache is retained.
 for(const p of polygon){p.x*=.8;p.y*=1.2;}
 assert.deepEqual(A.trim(line,[polygon]),old(line,[polygon]));
 polygon.reverse();assert.deepEqual(A.trim(line,[polygon]),old(line,[polygon]));
});
