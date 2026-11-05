const {test}=require('node:test'),assert=require('node:assert/strict');
const T=require('../js/simulator-controls.js'),V=require('../js/simulator-vehicles.js'),B=require('../js/simulator-drivers.js'),C=require('../js/simulator-collisions.js');
const gate=(type='stop',y=0)=>({id:'bar:0',marking:'bar',type,intersection:'j',approach:'west',on:[{road:1,lane:0}],level:1,direction:{x:1,y:0},points:[{x:300,y:y-6},{x:302,y:y+6}]});
const points=[{x:0,y:0,road:1,lane:0,station:0,direction:1,laneWidth:12},{x:400,y:0,road:1,lane:0,station:400,direction:1,laneWidth:12},{x:400,y:0,intersection:'j',junction:{entry:'west',exit:'east',angle:180,exitAngle:0,approaches:['west','north']}},{x:600,y:0,intersection:'j'},{x:800,y:0}];
function engine(type='stop',ppf=1){const e=new V.Engine({behavior:B,speed:30*ppf,pixelsPerFoot:ppf,temperature:0,random:()=>.5});const g=gate(type);g.points=g.points.map(p=>({x:p.x*ppf,y:p.y*ppf}));e.setControls([g]);e.configure([{key:'s',rate:1,routes:[{key:'r',points:points.map(p=>({...p,x:p.x*ppf,y:p.y*ppf,...(p.laneWidth?{laneWidth:p.laneWidth*ppf}:{}),...(p.station!=null?{station:p.station*ppf}:{})}))}]}]);e.recoverStuck=()=>{};return e;}
test('STOP comes to a full halt with the front bumper at the painted bar and proceeds on an empty road',()=>{
 for(const ppf of [1,6]){const e=engine('stop',ppf);let stopped=false,passed=false;
  for(let i=0;i<3600;i++){e.advance(1/60);const c=e.cars[0];if(!c)continue;const front=c.pathDistance+C.width(c,ppf)*381/214/2;
   if(c.speed===0&&Math.abs(front-300*ppf)<.01*ppf)stopped=true;
   if(front>300*ppf+.01){assert(stopped,'never cross without a complete stop');passed=true;break;}}
  assert(stopped);assert(passed);
 }
});
test('YIELD on a clear road does not slow traffic at the line, at any temperature',()=>{
 for(const temperature of [0,20,75,100]){const e=engine('yield');e.temperature=temperature;let crossed=false;
  for(let i=0;i<1200;i++){e.advance(1/60);const c=e.cars[0];if(c&&c.pathDistance<500){assert(Math.abs(c.speed-e.speed*c.driver.speedFactor)<1e-7,'clear yield retains the personal target speed');if(c.pathDistance>310)crossed=true;}}
  assert(crossed);
 }
});
test('an unlinked STOP still requires a complete stop but does not set intersection priority',()=>{
 const e=engine();e.setControls([{...gate(),intersection:undefined,approach:undefined}]);let stopped=false,passed=false;
 for(let i=0;i<1800;i++){e.advance(1/30);const c=e.cars[0];if(!c)continue;
  assert.equal(c.path.movements[0].control,undefined);
  const front=c.pathDistance+C.width(c,1)*381/214/2;
  if(c.speed===0&&Math.abs(front-300)<.01)stopped=true;
  if(front>300.01){assert(stopped);passed=true;break;}
 }
 assert(stopped);assert(passed);
});
test('bar projection respects lane, level, actual direction and paint edge',()=>{
 const path=V.preparePath(points,[gate()]);assert.equal(path.controls[0].distance,300);assert.equal(path.movements[0].entry,300);
 for(const g of [{...gate(),level:2},{...gate(),on:[{road:1,lane:1}]},{...gate(),direction:{x:-1,y:0}}])assert.equal(V.preparePath(points,[g]).controls.length,0);
});
test('Florida controlled approach yields to an uncontrolled approach regardless of request age',()=>{
 const make=(id,control,angle,exitAngle)=>({id,pathDistance:0,entryIntersection:'j',entryETA:1,path:{movements:[{intersection:'j',end:100,control,junction:{entry:angle,angle,exitAngle}}]}});
 const minor=make(1,{type:'stop'},90,0),major=make(2,null,180,0);assert(T.order(minor,major)>0);assert(T.order(major,minor)<0);
 const left=make(1,null,180,270),opposing=make(2,null,0,180);assert(T.order(left,opposing)>0);
 const a=make(1,{type:'stop',marking:'a'},180,0),b=make(2,{type:'stop',marking:'b'},90,270);
 for(const c of [a,b])c.path.movements[0].allWayStop=true;a.stops=new Map([['a',1]]);b.stops=new Map([['b',2]]);assert(T.order(a,b)<0);
 b.stops.set('b',1);assert(T.order(a,b)>0,'simultaneous stop yields to right');
});
function crossing(id,vertical,controlled,x=-60,speed=20) {
 const junction={entry:vertical?'south':'west',exit:vertical?'north':'east',angle:vertical?90:180,exitAngle:vertical?270:0, input:vertical?'s':'w',approaches:['south','west']};
 const xy=t=>vertical?{x:0,y:-t}:{x:t,y:0};
 const ps=[{...xy(-1000),road:id,lane:0},{...xy(-100),road:id,lane:0},{...xy(-100),intersection:'j',junction},{...xy(100),intersection:'j',junction},{...xy(100),road:id+10,lane:0},{...xy(1000),road:id+10,lane:0}].map(p=>({...p,laneWidth:12,level:1}));
 const g={id:'sign',marking:'sign',type:controlled,intersection:'j',approach:junction.entry,on:[{intersection:'j',approach:junction.entry,lane:junction.input}],level:1,direction:vertical?{x:0,y:-1}:{x:1,y:0},points:vertical?[{x:-6,y:30},{x:6,y:28}]:[{x:-30,y:-6},{x:-28,y:6}]};
 const path=V.preparePath(ps,controlled?[g]:[]),d=x+1000;
 return {id,path,pathDistance:d,distance:d,speed,driver:{...B.profile(()=>.5,0)},...V.position(path,d)};
}
test('uncontrolled traffic does not yield to an unstopped STOP entrant; the entrant yields after stopping',()=>{
 const minor=crossing(1,true,'stop',-39,0),major=crossing(2,false,null,-70,20);
 let holds=C.reservations([minor,major],1,1.67/.3048,0,.73/.3048,30);
 assert(major.reservation);assert(!holds.has(major.id));assert(!minor.reservation);
 minor.stops=new Map([['sign',0]]);
 holds=C.reservations([minor,major],1,1.67/.3048,1,.73/.3048,30);
 assert(holds.has(minor.id));assert(!holds.has(major.id));
});
test('STOP and YIELD accept clear gaps but reject approaching hazards even beyond the normal request horizon',()=>{
 for(const type of ['stop','yield']) {
  const minor=crossing(1,true,type,-39,0);minor.stops=new Map([['sign',0]]);
  const main=crossing(2,false,null,-500,70);
  let holds=C.reservations([minor,main],1,1.67/.3048,1,.73/.3048,70);
  assert(holds.has(minor.id),type+' must check the accelerating crossing time');
  main.pathDistance=0;main.speed=5;Object.assign(main,V.position(main.path,0));delete main.reservation;
  holds=C.reservations([minor,main],1,1.67/.3048,2,.73/.3048,5);
  assert(!holds.has(minor.id),type+' can use a genuinely clear gap');
 }
});
test('coincident semantic joins cannot rotate adjacent vehicle bodies or manufacture a collision',()=>{
 const ps=y=>[{x:10000,y,road:1,lane:0,laneWidth:72},{x:10000+2e-12,y:y-2e-12,intersection:'j',laneWidth:72},{x:10200,y,intersection:'j',laneWidth:72}];
 const a={id:1,path:V.preparePath(ps(10000)),pathDistance:0,laneWidth:72},b={id:2,path:V.preparePath(ps(10072)),pathDistance:0,laneWidth:72};
 for(const c of [a,b]){Object.assign(c,V.position(c.path,0));assert(Math.abs(c.angle)<1e-6);assert(Math.abs(C.sample(c).angle)<1e-6);}
 assert.equal(C.contact(a,1,b,1,6),null);
});
test('four simultaneous all-way stops resolve a circular yield-right tie without overriding committed traffic',()=>{
 const cars=[180,90,0,270].map((angle,i)=>({id:i+1,pathDistance:0,entryIntersection:'j',entryETA:0,stops:new Map([[i,0]]),path:{movements:[{intersection:'j',end:100,allWayStop:true,control:{type:'stop',marking:i},junction:{entry:angle,angle,exitAngle:(angle+180)%360}}]}}));
 const courtesy=T.courtesy(cars,()=>true);assert.equal(courtesy.size,1);assert.deepEqual([...courtesy.get(1)],[2,3,4]);
 cars[1].reservation=true;assert.equal(T.courtesy(cars,()=>true).size,0,'an admitted car is never part of an unresolved courtesy tie');
});
test('one STOP lane does not turn a partially controlled multilane approach into an all-way stop',()=>{
 const controls=[{...gate(),controlledLanes:['a']}],path=V.preparePath(points,controls),m=path.movements[0];
 m.junction={...m.junction,approachLanes:[{id:'west',incoming:['a','b']} ]};T.attach(path,controls);assert.equal(m.allWayStop,false);
 controls[0].controlledLanes.push('b');T.attach(path,controls);assert.equal(m.allWayStop,true);
});
test('all-way STOP order spans lanes and divided mouths, independent of vehicle ID and distance to the conflict',()=>{
 const first=crossing(99,false,'stop',-39,0),later=crossing(1,true,'stop',-39,0);
 for(const c of [first,later]){c.path.movements[0].allWayStop=true;c.stops=new Map([['sign',c===first?1:2]]);}
 // A divided/long approach places the first driver's stop much farther back.
 first.pathDistance-=240;Object.assign(first,V.position(first.path,first.pathDistance));
 first.path.movements[0].entry=first.pathDistance+C.width(first,1)*381/214/2;
 let holds=C.reservations([later,first],1,1.67/.3048,3,.73/.3048,30);
 assert(first.reservation,'earliest full stop goes first');assert(holds.has(later.id),'later conflicting arrival waits even if it could reach the crossing sooner');
 // A second lane on the same divided mouth has its own arrival, not a phase
 // shared with all cars waiting on that approach.
 later.path.movements[0].junction={...later.path.movements[0].junction,entry:first.path.movements[0].junction.entry,input:'second-lane'};
 assert(T.order(first,later)<0);assert(T.order(later,first)>0);
});
test('a STOP driver retains the accepted turn after crossing the bar on a wide approach',()=>{
 const first=crossing(2,false,'stop',-39,0),later=crossing(1,true,'stop',-39,0);
 for(const c of [first,later]){c.path.movements[0].allWayStop=true;c.stops=new Map([['sign',c===first?1:2]]);}
 C.reservations([first,later],1,1.67/.3048,3,.73/.3048,30);assert(first.reservation);
 first.pathDistance=first.path.movements[0].entry-C.width(first,1)*381/214/2+1;first.speed=3;Object.assign(first,V.position(first.path,first.pathDistance));
 const holds=C.reservations([later,first],1,1.67/.3048,4,.73/.3048,30);
 assert(first.entryCommitted);assert(first.reservation);assert(!holds.has(first.id));assert(holds.has(later.id));
});
test('a served stop survives replanning, but moving its bar requires a new stop at the new location',()=>{
 const e=engine();let c;
 for(let i=0;i<1800;i++){e.advance(1/60);c=e.cars[0];if(c?.stops?.has('bar'))break;}
 assert(c.stops.has('bar'));const remaining=[{x:c.x,y:0,road:1,lane:0,laneWidth:12},...points.slice(1)];
 assert(e.replacePath(c,remaining));assert(c.stops.has('bar'));e.setControls([gate()]);assert(c.stops.has('bar'),'unchanged controls preserve compliance');
 const moved=gate();moved.points=moved.points.map(p=>({...p,x:p.x+30}));e.setControls([moved]);assert(!c.stops.has('bar'));
});
test('multilane and separately divided all-way STOP queues serve individual full stops without starvation',()=>{
 for(const divided of [false,true]){
  const approaches=[],sources=[],controls=[],ppf=1;
  for(let leg=0;leg<4;leg++)for(let lane=0;lane<2;lane++){
   const angle=leg*90,t={x:-Math.cos(angle*Math.PI/180),y:-Math.sin(angle*Math.PI/180)},n={x:-t.y,y:t.x};
   const entry=divided?`${leg}:${lane}`:`${leg}`,input=`in:${leg}:${lane}`,output=`out:${leg}:${lane}`,key=`${leg}:${lane}`;
   let a=approaches.find(a=>a.id===entry);if(!a)approaches.push(a={id:entry,incoming:[]});a.incoming.push(input);
   const xy=d=>({x:t.x*d+n.x*(6+lane*12),y:t.y*d+n.y*(6+lane*12)});
   const junction={entry,exit:'opposite:'+entry,input,output,angle,exitAngle:(angle+180)%360,approachLanes:approaches};
   const points=[[-400,'in'],[-120,'in'],[-120,'junction'],[120,'junction'],[120,'out'],[400,'out']].map(([d,part])=>({...xy(d),laneWidth:12,level:1,...(part==='junction'?{intersection:'all',junction}:{road:part+key,lane,station:d,direction:1})}));
   sources.push({key,rate:8,routes:[{key,points}]});
   const p=xy(-60);controls.push({id:key,marking:key,type:'stop',intersection:'all',approach:entry,controlledLanes:[input],on:[{intersection:'all',approach:entry,lane:input}],level:1,direction:t,points:[{x:p.x-n.x*6,y:p.y-n.y*6},{x:p.x+n.x*6,y:p.y+n.y*6}]});
  }
  const e=new V.Engine({behavior:B,pixelsPerFoot:ppf,speed:30,temperature:0,random:()=>.5});e.setControls(controls);e.configure(sources);e.recoverStuck=()=>{};
  const departed=new Set(),counts=new Map();
  for(let step=0;step<2700;step++){
   e.advance(1/30);
   if(process.env.DEBUG_STOPS&&e.collisionInterventions)throw new Error(JSON.stringify({time:e.time,cars:e.cars.map(c=>({id:c.id,source:c.source,x:c.x,y:c.y,speed:c.speed,stop:[...(c.stops??[])],committed:c.entryCommitted,reservation:c.reservation,situation:c.situation}))}));
   for(const c of e.cars){const m=c.path.movements[0],stamp=c.stops?.get(m.control.marking);assert(m.allWayStop);
    if(c.pathDistance+C.width(c,ppf)*381/214/2<=m.entry+.02||departed.has(c.id))continue;
    assert(stamp!=null,'every car fully stops at its own bar');
    for(const other of e.cars){if(other===c||departed.has(other.id))continue;const om=other.path.movements[0],ot=other.stops?.get(om.control.marking);
     if(ot==null||ot>=stamp-1/60)continue;
     // Opposite and same-direction parallel lanes have no crossing conflict.
     const angle=Math.abs(((m.junction.angle-om.junction.angle+540)%360)-180);
     if(angle===90)assert(other.pathDistance+C.width(other,ppf)*381/214/2>om.entry+.01,'an earlier stopped conflicting car must proceed first');
    }
    departed.add(c.id);counts.set(c.source,(counts.get(c.source)??0)+1);
   }
  }
  assert.equal(counts.size,8,'all eight lanes get turns');for(const count of counts.values())assert(count>=2,'every lane makes continued progress');
  assert.equal(e.collisionInterventions,0);
 }
});
test('a YIELD line on a road feeding a road-to-road merge yields to the through stream, whatever the bend',()=>{
 const merge=bend=>({intersection:'road-merge:9',junction:{roadMerge:true,entry:23,exit:24,input:'r:23:0',output:'r:24:0',angle:180,exitAngle:0,mergeBend:bend}});
 // Feeder lane 23 with a yield line, then the merge envelope on road 24.
 const feeder=[{x:0,y:0,road:23,lane:0,station:0,direction:1,laneWidth:12},{x:100,y:0,road:23,lane:0,station:100,direction:1,laneWidth:12},
  {x:150,y:0,road:23,lane:0,station:150,direction:1,laneWidth:12,...merge(0)},{x:200,y:0,road:24,lane:0,station:0,direction:1,laneWidth:12,...merge(0)},{x:300,y:0,road:24,lane:0,station:100,direction:1,laneWidth:12}];
 const yieldLine={id:'y:0',marking:'y',type:'yield',on:[{road:23,lane:0}],level:1,direction:{x:1,y:0},points:[{x:120,y:-6},{x:122,y:6}]};
 const path=V.preparePath(feeder,[yieldLine]),m=path.movements[0];
 assert.equal(m.control?.type,'yield','the merge adopts the unlinked yield line on its feeder');assert.equal(m.entry,120,'hold at the painted line');
 // Even if the through road bends more here, the controlled feeder yields.
 const car=(id,movement)=>({id,pathDistance:0,entryIntersection:'road-merge:9',path:{movements:[movement]}});
 const through={...merge(40),start:0,end:100,junction:{...merge(40).junction,entry:1,input:'r:1:0'}};
 assert(T.order(car(1,m),car(2,through))>0);assert(T.order(car(2,through),car(1,m))<0);
 // A signal virtual bar or an intersection-linked line does not attach to the merge.
 assert.equal(V.preparePath(feeder,[{...yieldLine,intersection:'j'}]).movements[0].control,undefined);
});
