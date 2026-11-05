const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {test}=require('node:test');
const source=fs.readFileSync('js/longitudinal.js','utf8');
function api(){
 let calls=0;const math=Object.create(Math);math.hypot=(...args)=>{calls++;return Math.hypot(...args);};
 const context={window:{StripeMaker:{}},document:{addEventListener(){}},Math:math};
 vm.runInNewContext(source.replace('app.longitudinal = { begin,','app.longitudinal = { pointAt, begin,'),context);
 return {...context.window.StripeMaker.longitudinal,reset:()=>{calls=0;},calls:()=>calls};
}
function linearPoint(target,s){
 const {points,along}=target;let i=1;while(i<points.length-1&&along[i]<s)i++;
 const a=points[i-1],b=points[i],f=(s-along[i-1])/((along[i]-along[i-1])||1),len=Math.hypot(b.x-a.x,b.y-a.y)||1;
 return {x:a.x+(b.x-a.x)*f,y:a.y+(b.y-a.y)*f,t:{x:(b.x-a.x)/len,y:(b.y-a.y)/len}};
}
function referencePhases(map,tolerance){
 const phases=new Map();
 function phase(key,visiting=new Set()){
  if(phases.has(key))return phases.get(key);const target=map.get(key);if(!target||visiting.has(key))return 0;
  visiting.add(key);const start=target.points[0],dir=linearPoint(target,0).t;let before=null;
  for(const other of map.values()){
   if(other===target)continue;const end=other.points.at(-1);if(Math.hypot(end.x-start.x,end.y-start.y)>tolerance)continue;
   const t=linearPoint(other,other.length).t;if(t.x*dir.x+t.y*dir.y<.9)continue;
   if(!before||(other.key[0]==='r')>(before.key[0]==='r')||((other.key[0]==='r')===(before.key[0]==='r')&&other.key<before.key))before=other;
  }
  const value=before?phase(before.key,visiting)+before.length:0;phases.set(key,value);return value;
 }
 return phase;
}
const target=(key,points)=>({key,points,on:{road:Number(key.split(':')[1])||0,k:1}});
test('indexed phases exactly preserve chains, split tie-breaks, opposite directions and cyclic query order',()=>{
 const A=api(),sheet={inchesPerPixel:12,lines:[]},targets=[];
 for(let row=0;row<180;row++)for(let col=0;col<4;col++){
  const x=col*100-200,y=row*30-2700;
  targets.push(target(`${col%2?'m':'r'}:${row}:${col}`,Array.from({length:11},(_,j)=>({x:x+j*10,y}))));
 }
 targets.push(target('r:tie:9',[{x:-20,y:1.5},{x:0,y:1.5}]),target('r:tie:2',[{x:-30,y:0},{x:0,y:0}]),
  target('m:tie:1',[{x:-50,y:0},{x:0,y:0}]),target('r:opposite:1',[{x:30,y:0},{x:0,y:0}]),target('r:next:1',[{x:0,y:0},{x:10,y:0}]));
 for(let quarter=0;quarter<4;quarter++)targets.push(target(`m:cycle:${quarter}`,Array.from({length:25},(_,i)=>{
  const angle=(quarter+i/24)*Math.PI/2;return{x:2000+Math.cos(angle)*100,y:Math.sin(angle)*100};
 })));
 for(const reversed of [false,true]){
  const registry=A.begin(sheet,targets),expected=referencePhases(registry.targets,1.5),keys=[...registry.targets.keys()];
  if(reversed)keys.reverse();A.reset();
  for(const key of keys)assert.equal(A.phase(key),expected(key),key);
  assert(A.calls()<targets.length*15,'phase queries avoid scanning every endpoint');
 }
});
test('registry stays lazy, removes stale user lines, and rebuilds endpoint indexes after geometry/scale edits',()=>{
 const A=api(),sheet={inchesPerPixel:12,lines:[]},a=target('r:1:1',[{x:0,y:0},{x:100,y:0}]),b=target('r:2:1',[{x:101,y:0},{x:200,y:0}]);let builds=0;
 A.begin(sheet,()=>{builds++;return[a,b];});assert.equal(builds,0);
 assert.equal(A.phase(b.key),100);assert.equal(builds,1);assert.equal(A.phase(b.key),100);assert.equal(builds,1);
 a.points[1].x=90;A.begin(sheet,[a,b]);assert.equal(A.phase(b.key),0);
 sheet.inchesPerPixel=1;A.begin(sheet,[a,b]);assert.equal(A.phase(b.key),90);
 sheet.lines=[{id:'valid',on:a.on},{id:'stale',on:{road:9,k:1}}];A.begin(sheet,()=>{builds++;return[a,b];});
 assert.equal(builds,2);assert.deepEqual(sheet.lines.map(l=>l.id),['valid']);
});
test('binary station lookup keeps exact endpoint, duplicate-point and extrapolation behavior',()=>{
 const A=api();let seed=41;const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/2**32);
 for(let n=2;n<60;n++){
  const points=Array.from({length:n},(_,i)=>({x:i*10,y:random()*20}));if(n>5)points[4]={...points[3]};
  const t=A.begin({inchesPerPixel:12},[target('r:1:1',points)]).targets.get('r:1:1');
  for(const s of [-100,0,...t.along,t.length+100,...Array.from({length:30},()=>random()*t.length)])assert.deepEqual(structuredClone(A.pointAt(t,s)),linearPoint(t,s));
 }
});
