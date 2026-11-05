// Deterministic connected editor load. Default: 36 intersections, 228 paired
// road segments, 264 lateral markings, 36 sign callouts and 36 custom islands.
// Every road belongs to the same connected network. No simulator is running.
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
module.exports=function denseEditor(n=6){
 let serial=0;const context={crypto:{randomUUID:()=>`dense-${++serial}`},module:{exports:{}}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../js/intersection-geometry.js'),'utf8'),context);
 const G=context.module.exports,k=2,roads=[],joints=[],intersections=[],markings=[],signs=[];
 let rid=0,jid=0;
 const grid=Array.from({length:n},(_,row)=>Array.from({length:n},(_,col)=>{
  const item=G.create();Object.assign(item,{name:`Grid ${row+1}-${col+1}`,x:1100+col*1200+(row%2)*120,y:1100+row*1200+(col%2)*80});
  for(const a of item.approaches){a.incoming=a.outgoing=2;a.median=6;a.surface=(row+col)%2?'grass':'concrete';a.x*=1.4;a.y*=1.4;}
  G.normalize(item);G.auto(item);
  item.medians=[{id:`island-${row}-${col}`,type:(row+col)%2?'grass':'concrete',color:'yellow',points:[{x:-3,y:-14},{x:3,y:-14},{x:3,y:14},{x:-3,y:14}]}];
  intersections.push(item);
  signs.push({id:`sign-${row}-${col}`,text:`GRID ${row+1}-${col+1}`,x:item.x+260,y:item.y-270,postX:item.x+100,postY:item.y-75,width:150,size:100,values:{},rotation:0});
  const a=item.approaches[0],left=G.edge(a,true),right=G.edge(a,false);
  markings.push({id:`walk-${row}-${col}`,type:'crosswalk',width:10,a:{x:item.x+left.x*k,y:item.y+left.y*k},b:{x:item.x+right.x*k,y:item.y+right.y*k},forceBars:true,barAngle:0});
  return item;
 }));
 function connect(a,b,angle,split){
  const mouth=(item,angle)=>item?.approaches.find(a=>a.angle===angle),aa=mouth(a,angle),bb=mouth(b,(angle+180)%360),u=G.axes({angle}).u;
  const p=a?G.add(a,G.mul(aa,k)):G.sub(G.add(b,G.mul(bb,k)),G.mul(u,650));
  const q=b?G.add(b,G.mul(bb,k)):G.add(p,G.mul(u,650));
  const points=split?[p,{x:(p.x+q.x)/2-u.y*35,y:(p.y+q.y)/2+u.x*35},q]:[p,q];
  const js=points.map((p,i)=>{const j={id:++jid,...p,dir:u,links:[]};joints.push(j);return j;});
  const pairs=[];
  for(let t=0;t<js.length-1;t++){
   const f={id:++rid,lanes:2,laneWidth:12,ends:[{joint:js[t].id,sign:1},{joint:js[t+1].id,sign:1}]};
   const r={id:++rid,lanes:2,laneWidth:12,ends:[{joint:js[t+1].id,sign:-1},{joint:js[t].id,sign:-1}]};
   roads.push(f,r);pairs.push([f,r]);
   for(const j of [js[t],js[t+1]]){j.root??=f.id;j.links.push({a:f.id,ai:0,b:r.id,bi:0,pair:true,median:6});}
   if(t){const [pf,pr]=pairs[t-1];for(let lane=0;lane<2;lane++){js[t].links.push({a:pf.id,ai:lane,b:f.id,bi:lane},{a:r.id,ai:lane,b:pr.id,bi:lane});}}
   for(const road of [f,r])markings.push({id:`arrow-${road.id}`,type:'through',on:{road:road.id,lane:0},back:65});
  }
  const link=(approach,pair,start)=>{if(!approach)return;const [f,r]=pair;approach.links=[];for(let lane=0;lane<2;lane++)approach.links.push({road:f.id,e:start?0:1,lane,to:(start?approach.outLanes:approach.inLanes)[lane]},{road:r.id,e:start?1:0,lane,to:(start?approach.inLanes:approach.outLanes)[lane]});};
  link(aa,pairs[0],true);link(bb,pairs.at(-1),false);
 }
 for(let row=0;row<n;row++)for(let col=0;col<n;col++){
  const a=grid[row][col];
  if(col<n-1)connect(a,grid[row][col+1],0,(row+col)%2===0);
  if(row<n-1)connect(a,grid[row+1][col],90,(row+col)%2===0);
  if(col===0)connect(null,a,0,false);if(col===n-1)connect(a,null,0,false);
  if(row===0)connect(null,a,90,false);if(row===n-1)connect(a,null,90,false);
 }
 return JSON.parse(JSON.stringify({name:'Dense connected editor stress',inchesPerPixel:6,autoTapers:false,roads,joints,intersections,markings,signs,medians:[],gores:[],lines:[],surfaces:[],bridges:[]}));
};
