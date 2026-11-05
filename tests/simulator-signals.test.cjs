const {test}=require('node:test'),assert=require('node:assert/strict');
const M=require('../js/simulator-signals.js'),V=require('../js/simulator-vehicles.js'),B=require('../js/simulator-drivers.js'),C=require('../js/simulator-controls.js');
// Explicitly exercise the retained pedestrian implementation in this suite.
M.features.pedestrians=true;
function config(enabled=[1,2,5,6,3,7]){const c=M.normalize();for(const p of c.phases)Object.assign(p,{enabled:enabled.includes(p.id),minGreen:1,maxGreen:4,passage:1,minGap:1,yellow:1,red:1,walk:2,pedClear:3,pedBuffer:0,split:6,recall:'none'});return c;}
const run=(c,n,occupied=new Set())=>{for(let i=0;i<n*10;i++)c.step(.1,occupied);};
test('legacy preemption is discarded and cannot block ordinary service',()=>{
 const c=config([1]);c.phases[0].recall='min';c.preemption={phases:[2,6],minHold:999};
 const before=JSON.stringify(c),normalized=M.normalize(c),ctl=new M.Controller(c);
 assert(M.validateSaved(c));assert(M.validateSaved(normalized));assert(!Object.hasOwn(normalized,'preemption'));
 assert.deepEqual(ctl.errors,[]);run(ctl,20);assert.equal(ctl.aspect(1),'green');
 assert(!Object.hasOwn(ctl.snapshot(),'preempt'));assert(!Object.hasOwn(ctl.snapshot(),'preemptStage'));
 assert.equal(JSON.stringify(c),before,'loading an older configuration does not mutate its source');
});
test('ring skips uncalled phases; barriers wait for both rings and full clearances',()=>{
 const c=config();c.phases[4].minGreen=4;const ctl=new M.Controller(c);ctl.calls=new Set([1,5,3,7]);ctl.step(.1);assert.equal(ctl.aspect(1),'green');assert.equal(ctl.aspect(5),'green');
 run(ctl,3);assert.equal(ctl.aspect(3),'red');assert.equal(ctl.aspect(5),'green');run(ctl,4);assert.equal(ctl.aspect(3),'green');assert.equal(ctl.aspect(7),'green');assert.equal(ctl.aspect(2),'red');
});
test('gap resets on detector presence, delayed calls lock, and maximum green wins',()=>{
 const c=config([1,3]);c.detectors=[{id:'d',phase:1,delay:.2,memory:true}];const ctl=new M.Controller(c);ctl.calls=new Set([1,3]);ctl.step(.1);run(ctl,1,new Set(['d']));assert(ctl.detectorStates.get('d').call);assert.equal(ctl.aspect(1),'green');run(ctl,4,new Set(['d']));assert.equal(ctl.rings[0].reason,'Max-out');assert.notEqual(ctl.aspect(1),'green');
});
test('an isolated actuated green rests with no conflicting demand',()=>{
 const ctl=new M.Controller(config([1,3]));ctl.calls.add(1);run(ctl,20);assert.equal(ctl.aspect(1),'green');ctl.calls.add(3);run(ctl,1);assert.equal(ctl.rings[0].reason,'Gap-out');
});
test('pedestrian call waits, receives walk and clearance, and prevents early termination',()=>{
 const ctl=new M.Controller(config([1,3]));ctl.requestPed(1);ctl.calls.add(3);ctl.step(.1);assert.equal(ctl.pedestrian(1),'walk');run(ctl,2);assert.equal(ctl.pedestrian(1),'clearance');run(ctl,2);assert.equal(ctl.aspect(1),'green');run(ctl,1.1);assert.equal(ctl.aspect(1),'yellow');assert.equal(ctl.pedestrian(1),'hand');
});

test('invalid coordinated ring splits hold the controller red',()=>{
 const c=M.normalize();c.mode='coordinated';assert.deepEqual(M.validate(c),[]);c.coordination.cycle=80;assert(M.validate(c).some(e=>e.includes('cycle')));const ctl=new M.Controller(c);run(ctl,30);assert(ctl.rings.every(r=>r.state==='red'));assert(ctl.errors.some(e=>e.includes('cycle')));
});
test('protected, overlap and flashing permissive indications derive from actual phases',()=>{
 const ctl=new M.Controller(config([1,3]));ctl.calls.add(1);ctl.step(.1);assert.equal(M.indication(ctl,{phase:1}),'green');assert.equal(M.indication(ctl,{phase:3,overlap:[1]}),'green');assert.equal(M.indication(ctl,{phase:3,permissive:[1]}),'permissive');assert.equal(M.indication(ctl,null),'red');
});
test('detector rectangle respects rotation, scale and elevation',()=>{
 const d={x:100,y:100,angle:90,length:20,width:8,level:1};assert(M.detectorContains(d,{x:100,y:115,laneWidth:12},1));assert(!M.detectorContains(d,{x:110,y:100,laneWidth:12},1));assert(!M.detectorContains(d,{x:100,y:100,laneWidth:12,level:2},1));
});
const junction={entry:'w',exit:'e',input:'in',output:'out',angle:180,exitAngle:0,approaches:['w','e'],approachLanes:[{id:'w',incoming:['in'],outgoing:['other']},{id:'e',incoming:['other2'],outgoing:['out']}]};
const points=[{x:0,y:0,road:1,lane:0,station:0,laneWidth:12,direction:1},{x:200,y:0,road:1,lane:0,station:200,laneWidth:12,direction:1},{x:200,y:0,intersection:'j',junction,laneWidth:12},{x:260,y:0,intersection:'j',junction,laneWidth:12},{x:260,y:0,road:2,lane:0,station:0,laneWidth:12,direction:1},{x:600,y:0,road:2,lane:0,station:340,laneWidth:12,direction:1}];
test('real driver engine stops at red, then releases on green without watchdog removals',()=>{
 const c=config([1,3]);c.phases[0].minGreen=22;c.phases[0].maxGreen=30;c.phases[0].recall='min';c.phases[2].recall='min';c.assignments['in>out']={phase:3,noTurnOnRed:true};
 const engine=new V.Engine({behavior:B,pixelsPerFoot:1,speed:25,temperature:0,random:()=>.5});engine.signals=new M.System([{id:'j',config:c}],1);engine.configure([{key:'a',rate:.01,routes:[{key:'out',points}]}]);
 let stopped=false,crossed=false;for(let i=0;i<1500;i++){engine.advance(1/30);for(const car of engine.cars){if(car.speed===0&&car.pathDistance>180&&car.pathDistance<200)stopped=true;if(car.pathDistance>220)crossed=true;if(engine.time<22)assert(car.pathDistance+10*381/214/2<=200+.001);}}
 assert(stopped,'full stop at signal');assert(crossed,'green serves the waiting car');assert.equal(engine.watchdogRemovals??0,0);
});
test('right-on-red requires a full stop and honors prohibitions and pedestrian service',()=>{
 const c=config([1]);c.assignments['in>out']={phase:3,noTurnOnRed:false};const system=new M.System([{id:'j',config:c}],1),path=V.preparePath(points),m=path.movements[0];m.junction={...junction,exitAngle:90};
 const car={path,pathDistance:200-10*381/214/2,speed:1,laneWidth:12,driver:{jamGap:2}};system.observe(car);assert(!car.signalControl.allowed);car.speed=0;system.observe(car);assert(car.signalControl.allowed);assert(C.ready(car,m));system.records.get('j').controller.config.assignments['in>out'].noTurnOnRed=true;system.observe(car);assert(!car.signalControl.allowed);assert(C.obstacle(car,1));
});
test('pedestrian recall, omit and rest-in-walk have distinct service behavior',()=>{
 const c=config([1,3]);c.phases[0].pedRecall=true;c.phases[0].pedMode='rest';const ctl=new M.Controller(c);run(ctl,20);assert.equal(ctl.pedestrian(1),'walk');ctl.calls.add(3);run(ctl,1);assert.equal(ctl.pedestrian(1),'clearance');assert.equal(ctl.aspect(3),'red');run(ctl,5);assert.equal(ctl.aspect(3),'green');
 const omitted=config([1]);omitted.phases[0].pedMode='omit';omitted.phases[0].pedRecall=true;const x=new M.Controller(omitted);x.requestPed(1);assert.equal(x.pedCalls.size,0);x.calls.add(1);run(x,1);assert.equal(x.pedestrian(1),'hand');
});
test('leading pedestrian interval holds vehicle red; exclusive service holds both rings red',()=>{
 const c=config([1,5]);c.phases[0].pedLead=3;c.phases[0].walk=5;c.phases[0].pedRecall=true;c.phases[4].recall='min';const ctl=new M.Controller(c);ctl.step(.1);assert.equal(ctl.pedestrian(1),'walk');assert.equal(ctl.aspect(1),'red');assert.equal(ctl.aspect(5),'green');run(ctl,3);assert.equal(ctl.aspect(1),'green');
 c.phases[0].pedExclusive=true;c.phases[4].enabled=false;const x=new M.Controller(c);x.step(.1);assert.equal(x.aspect(1),'red');assert.equal(x.aspect(5),'red');
});
test('pedestrian buffer and manual hold/force-off preserve minimum service',()=>{
 const c=config([1,3]);c.phases[0].pedBuffer=3;const ctl=new M.Controller(c);ctl.requestPed(1);ctl.calls.add(3);ctl.holds.add(1);run(ctl,10);assert.equal(ctl.aspect(1),'green');ctl.forceOffs.add(1);run(ctl,.1);assert.equal(ctl.aspect(1),'yellow');assert.equal(ctl.rings[0].reason,'Manual force-off');
 const x=new M.Controller(c);x.requestPed(1);x.calls.add(3);x.step(.1);x.forceOffs.add(1);run(x,6);assert.equal(x.pedestrian(1),'hand');assert.equal(x.aspect(1),'green');assert.equal(x.aspect(3),'red');run(x,2.1);assert.equal(x.aspect(1),'yellow');
});
test('soft recall dwells only in the absence of conflicting demand',()=>{
 const c=config([1,3]);c.phases[0].recall='soft';const ctl=new M.Controller(c);run(ctl,10);assert.equal(ctl.aspect(1),'green');ctl.calls.add(3);run(ctl,2.5);assert.equal(ctl.aspect(3),'green');
});
test('legacy whole-signal flashing mode falls back to actuated service without losing matrix flashes',()=>{
 const c=config([1,3]);c.mode='flash';c.phases[0].flash='yellow';c.phases[0].recall='min';
 M.setPhaseMode(c,'in>out',1,'permissive');M.setPhaseMode(c,'in>out',3,'flash-red-arrow');
 const normalized=M.normalize(c),ctl=new M.Controller(c);
 assert.equal(normalized.mode,'actuated');assert(!Object.hasOwn(normalized.phases[0],'flash'));assert(M.validateSaved(normalized));
 assert.equal(M.phaseMode(normalized,{input:'in',output:'out'},1),'permissive');assert.equal(M.phaseMode(normalized,{input:'in',output:'out'},3),'flash-red-arrow');
 run(ctl,2);assert.equal(ctl.aspect(1),'green');assert.equal(ctl.aspect(3),'red');assert.equal(M.indication(ctl,ctl.config.assignments['in>out']),'permissive');
 ctl.calls.add(3);for(let n=0;n<100&&ctl.aspect(3)!=='green';n++)ctl.step(.1);assert.equal(ctl.aspect(3),'green');assert.equal(M.indication(ctl,ctl.config.assignments['in>out']),'flash-red');
});
test('coordinated controllers repeat the same schedule at their configured offset',()=>{
 const c=config([1,3,5,7]);c.mode='coordinated';c.coordination.cycle=12;for(const p of c.phases){p.recall='max';p.pedMode='omit';}const a=new M.Controller(c),b=new M.Controller({...c,coordination:{...c.coordination,offset:2}});assert.deepEqual(a.errors,[]);
 const history=[];for(let i=0;i<420;i++){a.step(.1);b.step(.1);history.push(a.rings.map(r=>[r.phase,r.state]));if(i>140)assert.deepEqual(b.rings.map(r=>[r.phase,r.state]),history[i-20]);}
});
test('invalid protected crossing assignments are detected; permissive operation is allowed',()=>{
 const c=config([1,5]),a={input:'a',output:'b',points:[{x:-10,y:0},{x:10,y:0}]},b={input:'c',output:'d',points:[{x:0,y:-10},{x:0,y:10}]};c.assignments={'a>b':{phase:1},'c>d':{phase:5}};assert.equal(M.conflictErrors(c,[a,b]).length,1);c.assignments['c>d']={phase:0,permissive:[5]};assert.equal(M.conflictErrors(c,[a,b]).length,0);
});
test('signal configuration rejects corrupt equipment and remaps duplicated lane references',()=>{
 const c=M.normalize();assert(M.validateSaved(c));c.arms.push({id:'a',x:0,y:0,angle:0,length:40});c.heads.push({id:'h',arm:'a',at:20,type:'ball',angle:0,movement:'old>out'});c.assignments['old>out']={phase:2,permissive:[],overlap:[],noTurnOnRed:false};M.remap(c,new Map([['old','new']]));assert(c.assignments['new>out']);assert.equal(c.heads[0].movement,'new>out');assert(M.validateSaved(c));c.heads[0].arm='missing';assert(!M.validateSaved(c));
});
test('dual entry supplies a compatible phase, and simultaneous gap waits for the other ring',()=>{
 const c=config([2,6,3,7]);c.dualEntry=true;c.simultaneousGap=true;c.detectors=[{id:'main',phase:6,delay:0,extend:0}];const ctl=new M.Controller(c);ctl.calls.add(2);ctl.step(.1);assert.equal(ctl.aspect(6),'green');ctl.calls.add(3);run(ctl,2,new Set(['main']));assert.equal(ctl.aspect(2),'green');assert.equal(ctl.aspect(6),'green');run(ctl,1.2);assert.equal(ctl.aspect(2),'yellow');assert.equal(ctl.aspect(6),'yellow');
});
test('pulse detectors honor delay, trigger once per occupancy, and retain extension after exit',()=>{
 const c=config([1,3]);c.detectors=[{id:'pulse',phase:3,mode:'pulse',delay:1,extend:.5,memory:true}];const ctl=new M.Controller(c);ctl.calls.add(1);run(ctl,.5,new Set(['pulse']));assert(!ctl.calls.has(3));run(ctl,.5,new Set(['pulse']));assert(ctl.calls.has(3));assert(ctl.detectorStates.get('pulse').call);run(ctl,.3);assert(ctl.detectorStates.get('pulse').call);run(ctl,.3);assert(!ctl.detectorStates.get('pulse').call);
});
test('four streams obey alternating signals for three minutes without red entries',()=>{
 const cfg=config([1,3,5,7]);for(const p of cfg.phases){p.minGreen=8;p.maxGreen=15;p.recall='min';}
 const routes=[0,90,180,270].map((angle,index)=>{
  const a=angle*Math.PI/180,u={x:Math.cos(a),y:Math.sin(a)},n={x:-u.y,y:u.x};
  const junction={entry:'entry'+index,exit:'exit'+index,input:'in'+index,output:'out'+index,angle:(angle+180)%360,exitAngle:angle,approaches:[0,1,2,3].map(i=>'entry'+i),approachLanes:[0,1,2,3].map(i=>({id:'entry'+i,incoming:['in'+i],outgoing:['other'+i]}))};
  const points=[-400,-40,-40,40,40,400].map((d,i)=>({x:u.x*d+n.x*6,y:u.y*d+n.y*6,laneWidth:12,...(i<2?{road:index*2+1,lane:0,station:d+400,direction:1}:i<4?{intersection:'j',junction}:{road:index*2+2,lane:0,station:d-40,direction:1})}));
  cfg.assignments[`in${index}>out${index}`]={phase:[1,3,5,7][index],noTurnOnRed:true};return {key:String(index),rate:8,routes:[{key:'exit',points}]};
 });
 const e=new V.Engine({behavior:B,pixelsPerFoot:1,speed:25,temperature:0,random:()=>.5});e.signals=new M.System([{id:'j',config:cfg}],1);e.configure(routes);const crossed=new Set();
 for(let i=0;i<180*30;i++){e.advance(1/30);for(const car of e.cars){const s=car.signalControl;if(s&&!s.allowed)assert(car.pathDistance+10*381/214/2<=s.distance+.001);if(car.pathDistance>460)crossed.add(car.source);}}
 assert.equal(crossed.size,4);assert.equal(e.watchdogRemovals??0,0);assert.equal(e.collisionInterventions??0,0);
});
test('a pedestrian request on a resting green is served rather than stranded',()=>{
 const c=config([1]);c.phases[0].recall='min';const ctl=new M.Controller(c);run(ctl,20);ctl.requestPed(1);assert.equal(ctl.pedestrian(1),'walk');run(ctl,2.1);assert.equal(ctl.pedestrian(1),'clearance');
 c.phases[0].pedLead=3;const lead=new M.Controller(c);run(lead,10);lead.requestPed(1);run(lead,2.2);assert.equal(lead.pedestrian(1),'walk');assert.equal(lead.aspect(1),'red');
});
test('signals use the painted stop bar upstream of the mouth without imposing a STOP action',()=>{
 const gate={id:'signal:bar',marking:'bar',type:'signal',intersection:'j',approach:'w',level:1,on:[{road:1,lane:0}],direction:{x:1,y:0},points:[{x:180,y:-6},{x:182,y:-6},{x:182,y:6},{x:180,y:6}]};
 const path=V.preparePath(points,[gate]),cfg=config([1]);cfg.assignments['in>out']={phase:3,noTurnOnRed:true};const sys=new M.System([{id:'j',config:cfg}],1);
 const car={path,pathDistance:160,speed:10,laneWidth:12,driver:{jamGap:2}};sys.observe(car);assert.equal(car.signalControl.distance,180);assert(!car.signalControl.allowed);assert(C.obstacle(car,1));
 const unlit={...car};delete unlit.signalControl;assert.equal(C.obstacle(unlit,1),null,'a virtual signal bar does not require an independent STOP');
});

const move=(input,output,angle,exitAngle,points)=>({input,output,points:points.map(([x,y])=>({x,y,junction:{input,output,entry:input,exit:output,angle,exitAngle}}))});
const leftMove=move('west','north',180,270,[[-100,6],[-10,6],[6,-10],[6,-100]]);
const opposingMove=move('east','westOut',0,180,[[100,-6],[-100,-6]]);
test('ordinary left green accepts opposing through green; an explicit arrow remains protected',()=>{
 const c=config([2,6]);c.assignments={'west>north':{phase:2,greenMode:'auto'},'east>westOut':{phase:6,greenMode:'auto'}};
 assert.deepEqual(M.conflictErrors(c,[leftMove,opposingMove]),[]);
 const ctl=new M.Controller(c);ctl.calls=new Set([2,6]);ctl.step(.1);
 assert.deepEqual(M.movementState(ctl,leftMove),{aspect:'green',greenBall:true,yielding:true});
 assert.deepEqual(M.movementState(ctl,opposingMove),{aspect:'green',greenBall:true,yielding:false});
 ctl.clear(ctl.rings[1],'Test yellow');assert(M.movementState(ctl,leftMove).yielding,'turn still yields while opposing traffic clears yellow');
 c.assignments['west>north'].greenMode='protected';assert.equal(M.conflictErrors(c,[leftMove,opposingMove]).length,1);
});
test('two noncrossing opposing turns remain compatible and cross-street through greens remain invalid',()=>{
 const oppositeLeft=move('east','south',0,90,[[100,-6],[10,-6],[-6,10],[-6,100]]),c=config([2,6]);
 c.assignments={'west>north':{phase:2,greenMode:'auto'},'east>south':{phase:6,greenMode:'auto'}};
 assert.deepEqual(M.conflictErrors(c,[leftMove,oppositeLeft]),[]);
 const a=move('w','e',180,0,[[-100,0],[100,0]]),b=move('s','n',90,270,[[0,100],[0,-100]]);
 c.assignments={'w>e':{phase:2,greenMode:'auto'},'s>n':{phase:6,greenMode:'auto'}};assert.equal(M.conflictErrors(c,[a,b]).length,1);
});
test('crossing opposing ordinary left turns yield; two protected arrows still conflict',()=>{
 const a=move('south','westOut',90,180,[[6,100],[6,-30],[-100,-30]]),b=move('north','eastOut',270,0,[[-6,-100],[-6,30],[100,30]]),c=config([3]);
 assert(M.crosses(a.points,b.points));
 for(const m of [a,b])M.setPhaseMode(c,M.key(m),3,'green');
 assert.deepEqual(M.conflictErrors(c,[a,b]),[]);
 const ctl=new M.Controller(c);ctl.calls.add(3);ctl.step(.1);
 for(const m of [a,b])assert.deepEqual(M.movementState(ctl,m),{aspect:'green',greenBall:true,yielding:true});
 for(const m of [a,b])M.setPhaseMode(c,M.key(m),3,'protected');
 assert.equal(M.conflictErrors(c,[a,b]).length,1);
});
test('ordinary right green yields; protected right arrows keep conflict protection',()=>{
 const right=move('south','east',90,0,[[0,100],[0,0],[100,0]]),through=move('west','east2',180,0,[[-100,10],[100,10]]),c=config([2,6]);
 c.assignments={'south>east':{phase:2,greenMode:'auto'},'west>east2':{phase:6,greenMode:'auto'}};assert.deepEqual(M.conflictErrors(c,[right,through]),[]);
 const ctl=new M.Controller(c);ctl.calls=new Set([2,6]);ctl.step(.1);assert(M.movementState(ctl,right).yielding);
 c.assignments['south>east'].greenMode='protected';assert.equal(M.conflictErrors(c,[right,through]).length,1);
});
test('legacy arrow heads retain protected green and explicit green-ball mode overrides the display choice',()=>{
 const c=config([2]);c.assignments={'west>north':{phase:2}};c.heads=[{movement:'west>north',type:'fya-left'}];
 assert.equal(M.normalize(c).assignments['west>north'].greenMode,'protected');
 c.assignments['west>north'].greenMode='auto';assert.equal(M.normalize(c).assignments['west>north'].greenMode,'auto');
 const copy=M.normalize(JSON.parse(JSON.stringify({...c,heads:[],assignments:{'west>north':{phase:2,greenMode:'auto',flashingRed:[6]}}})));
 assert.equal(copy.assignments['west>north'].greenMode,'auto');assert.deepEqual(copy.assignments['west>north'].flashingRed,[]);assert.deepEqual(copy.assignments['west>north'].flashingRedArrows,[6]);assert.equal(M.phaseMode(copy,{input:'west',output:'north'},6),'flash-red-arrow');assert(M.validateSaved(copy));copy.assignments['west>north'].greenMode='bad';assert(!M.validateSaved(copy));
});
test('phase-specific flashing red stops first, yields, and resets a stale green-phase stop',()=>{
 const c=config([2]);c.phases[1].recall='min';c.assignments['in>out']={phase:0,flashingRed:[2]};
 const sys=new M.System([{id:'j',config:c}],1);sys.step(.1,[],.1);
 const car={path:V.preparePath(points),pathDistance:200-10*381/214/2,speed:1,laneWidth:12,driver:{jamGap:2}};
 sys.observe(car);assert.equal(car.signalControl.aspect,'flash-red');assert(!car.signalControl.allowed);
 car.speed=0;sys.observe(car);assert(car.signalControl.allowed);assert(car.signalControl.priority<1,'flashing red yields even to permissive green traffic');
 car.signalMemory.last='green';car.speed=2;sys.observe(car);assert(!car.signalControl.allowed,'a previous stop does not waive a new flashing-red entry');
});
test('green-ball right turns use yielding priority and still wait for active pedestrian crossings',()=>{
 const c=config([2,6]);c.phases[1].recall=c.phases[5].recall='min';c.phases[5].pedRecall=true;c.assignments['in>out']={phase:2,greenMode:'auto'};
 const rightPoints=points.map(p=>p.junction?{...p,junction:{...p.junction,exitAngle:90}}:p),path=V.preparePath(rightPoints),car={path,pathDistance:170,speed:10,laneWidth:12};
 const sys=new M.System([{id:'j',config:c,pedConflicts:{'in>out':[6]}}],1);sys.step(.1,[car],.1);
 assert.equal(car.signalControl.aspect,'green');assert(car.signalControl.yielding);assert(!car.signalControl.allowed,'active crossing holds the right turn');
 const ctl=sys.records.get('j').controller;ctl.rings.find(r=>r.phase===6).ped=false;sys.observe(car);assert(car.signalControl.allowed);assert.equal(car.signalControl.priority,1);
});

test('signal stop-bar paint does not change priority between equal permissive movements',()=>{
 const j={...junction,exitAngle:90},through={...junction,entry:'e',input:'east',angle:0,exitAngle:180};
 const a={entryIntersection:'j',pathDistance:0,path:{movements:[{intersection:'j',end:100,junction:j,control:{type:'signal'}}]},signalControl:{priority:1}},b={entryIntersection:'j',pathDistance:0,path:{movements:[{intersection:'j',end:100,junction:through}]},signalControl:{priority:1}};
 const withBar=C.order(a,b);delete a.path.movements[0].control;assert.equal(C.order(a,b),withBar);
 a.signalControl={priority:.5,aspect:'flash-red'};b.signalControl={priority:1,aspect:'green'};assert(C.order(a,b)>0,'stopped flashing red yields to moving ordinary green');
});
test('flashing red arrows preserve the full-stop rule and round-trip their distinct matrix indication',()=>{
 const c=config([2]);c.phases[1].recall='min';c.assignments['in>out']={phase:0,flashingRedArrows:[2]};
 const normalized=M.normalize(JSON.parse(JSON.stringify(c)));assert(M.validateSaved(normalized));assert.equal(M.phaseMode(normalized,{input:'in',output:'out'},2),'flash-red-arrow');
 const sys=new M.System([{id:'j',config:normalized}],1);sys.step(.1,[],.1);
 const car={path:V.preparePath(points),pathDistance:200-10*381/214/2,speed:5,laneWidth:12};sys.observe(car);assert.equal(car.signalControl.aspect,'flash-red');assert(!car.signalControl.allowed);
 car.speed=0;sys.observe(car);assert(car.signalControl.allowed);assert(car.signalControl.priority<1);
 normalized.assignments['in>out'].flashingRedArrows=[9];assert(!M.validateSaved(normalized),'invalid arrow phase references are rejected');
});
test('shared head membership preserves timings, separate banks, persistence and duplicated lane references',()=>{
 const c=config([2]),h={id:'head',arm:'arm',at:20,angle:0,type:'doghouse',movement:'in>left'};
 c.arms=[{id:'arm',x:0,y:0,angle:0,length:40}];c.heads=[h];const before=JSON.stringify(c.assignments);
 M.assignHeadMovement(h,'in>through','circular');M.assignHeadMovement(h,'in>right','circular');
 assert.deepEqual(M.headMovements(h),['in>left']);assert.deepEqual(M.headMovements(h,'circular'),['in>through','in>right']);
 assert.equal(JSON.stringify(c.assignments),before,'equipment links do not rewrite the phase matrix');
 const saved=M.normalize(JSON.parse(JSON.stringify(c)));assert(M.validateSaved(saved));
 M.remap(saved,new Map([['in','new']]));assert.deepEqual(M.headMovements(saved.heads[0],'circular'),['new>through','new>right']);
 M.assignHeadMovement(h,'in>through','');assert.equal(h.secondaryMovement,'in>right','removing the display source promotes a remaining shared movement');
 M.assignHeadMovement(h,'in>right','main');assert.deepEqual(M.headMovements(h),['in>left','in>right']);M.assignHeadMovement(h,'in>left','main');assert.deepEqual(M.headMovements(h),['in>left','in>right'],'sharing an existing link keeps the display source');assert.deepEqual(M.headMovements(h,'circular'),[]);
 saved.heads[0].sharedMovements=[42];assert(!M.validateSaved(saved));
});
test('grid green cells are independent, preserve their glyphs and survive normalization',()=>{
 const c=config([1,2,3]),k='in>out';M.setPhaseMode(c,k,1,'green');M.setPhaseMode(c,k,2,'green');M.setPhaseMode(c,k,3,'protected');
 const m={input:'in',output:'out'};assert.deepEqual([1,2,3].map(n=>M.phaseMode(c,m,n)),['green','green','protected']);
 const saved=M.normalize(JSON.parse(JSON.stringify(c)));assert(M.validateSaved(saved));assert.deepEqual(M.greenPhases(saved.assignments[k]),[1,2,3]);
 M.setPhaseMode(c,k,2,'red');assert.deepEqual([1,2,3].map(n=>M.phaseMode(c,m,n)),['green','red','protected']);
 M.setPhaseMode(c,k,1,'permissive');assert.deepEqual([1,2,3].map(n=>M.phaseMode(c,m,n)),['permissive','red','protected']);
 saved.assignments[k].greens[9]='green';assert(!M.validateSaved(saved));
});
for(const mode of ['fixed','actuated','coordinated'])test(`${mode}: continuous green spans consecutive selected phases, then clears fully`,()=>{
 const c=config([1,2,3]);c.mode=mode;for(const p of c.phases)p.recall='min';if(mode==='coordinated'){c.coordination.cycle=18;for(const id of [5,6,7])c.phases[id-1].enabled=true;}
 M.setPhaseMode(c,'in>out',1,'green');M.setPhaseMode(c,'in>out',2,'green');
 const ctl=new M.Controller(c),a=ctl.config.assignments['in>out'],samples=[];assert.deepEqual(ctl.errors,[]);
 for(let t=0;t<250;t++){ctl.step(.1);samples.push({phase:ctl.rings[0].phase,state:ctl.rings[0].state,aspect:M.indication(ctl,a)});if(ctl.rings[0].phase===3)break;}
 assert(samples.some(s=>s.phase===1&&s.state==='yellow'&&s.aspect==='green'),'holds green through first parent yellow');
 assert(samples.some(s=>s.phase===1&&s.state==='red'&&s.aspect==='green'),'holds green through first parent red clearance');
 assert(samples.some(s=>s.phase===2&&s.state==='green'&&s.aspect==='green'),'enters next parent green without interruption');
 const end=samples.findIndex(s=>s.phase===2&&s.state==='yellow');assert(end>0);assert(samples.slice(0,end).every(s=>s.aspect==='green'));
 assert(samples.some(s=>s.phase===2&&s.aspect==='yellow'));assert(samples.some(s=>s.phase===2&&s.aspect==='red'));assert.equal(samples.at(-1).aspect,'red');
});
test('continuous green crosses a barrier and waits for the other ring to clear',()=>{
 const c=config([2,3,6,7]);c.mode='fixed';c.phases[5].split=10;
 M.setPhaseMode(c,'in>out',2,'protected');M.setPhaseMode(c,'in>out',3,'protected');
 const ctl=new M.Controller(c),a=ctl.config.assignments['in>out'];let waited=false,changed=false;
 for(let t=0;t<180;t++){ctl.step(.1);if(ctl.rings[0].phase===3){changed=true;break;}if(ctl.rings[0].done&&ctl.rings[0].continuation)waited=true;assert.equal(M.indication(ctl,a),'green');}
 assert(waited);assert(changed);assert.equal(M.indication(ctl,a),'green');
});
test('unselected intervening phase ends green; skipped uncalled phases do not',()=>{
 for(const recalled of [true,false]){const c=config([1,2,3]);for(const id of [1,3])c.phases[id-1].recall='min';if(recalled)c.phases[1].recall='min';
 M.setPhaseMode(c,'in>out',1,'green');M.setPhaseMode(c,'in>out',3,'green');const ctl=new M.Controller(c);let yellow=false;
 for(let t=0;t<140;t++){ctl.step(.1);yellow ||= M.indication(ctl,ctl.config.assignments['in>out'])==='yellow';if(ctl.rings[0].phase===3)break;}
 assert.equal(yellow,recalled);}
});
test('reserved actuated continuation survives an unlocked detector dropping its call',()=>{
 const c=config([1,2,3]);c.phases[0].recall='min';c.detectors=[{id:'d',phase:2,memory:false}];
 M.setPhaseMode(c,'in>out',1,'green');M.setPhaseMode(c,'in>out',2,'green');const ctl=new M.Controller(c);
 for(let t=0;t<30&&!ctl.rings[0].continuation;t++)ctl.step(.1,new Set(['d']));assert(ctl.rings[0].continuation);
 for(let t=0;t<30&&ctl.rings[0].phase!==2;t++){ctl.step(.1);assert.equal(M.indication(ctl,ctl.config.assignments['in>out']),'green');}assert.equal(ctl.rings[0].phase,2);
});

test('pedestrian leading/exclusive intervals and changes of green type break continuation',()=>{
 for(const kind of ['pedLead','pedExclusive','glyph']){const c=config([1,2,3]);c.mode='fixed';M.setPhaseMode(c,'in>out',1,'green');M.setPhaseMode(c,'in>out',2,kind==='glyph'?'protected':'green');
 if(kind!=='glyph'){c.phases[1][kind]=kind==='pedLead'?2:true;c.phases[1].pedRecall=true;c.phases[1].split=12;}
 const ctl=new M.Controller(c);assert.deepEqual(ctl.errors,[]);let yellow=false;for(let t=0;t<100;t++){ctl.step(.1);yellow ||= M.indication(ctl,ctl.config.assignments['in>out'])==='yellow';if(ctl.rings[0].phase===2)break;}assert(yellow,kind);assert(!ctl.rings[0].continuation);}
});
test('all grid green phases participate in protected conflict checks',()=>{
 const c=config([1,2]),a={input:'a',output:'b',points:[{x:-1,y:0},{x:1,y:0}]},b={input:'c',output:'d',points:[{x:0,y:-1},{x:0,y:1}]};
 M.setPhaseMode(c,'a>b',1,'protected');M.setPhaseMode(c,'a>b',2,'protected');M.setPhaseMode(c,'c>d',2,'protected');assert.equal(M.conflictErrors(c,[a,b]).length,1);
});

test('green across every served phase remains green across the cycle boundary',()=>{
 const c=config([1,2]);c.mode='fixed';M.setPhaseMode(c,'in>out',1,'green');M.setPhaseMode(c,'in>out',2,'green');const ctl=new M.Controller(c);let cycles=0,last=0;
 for(let t=0;t<300;t++){ctl.step(.1);assert.equal(M.indication(ctl,ctl.config.assignments['in>out']),'green');if(last===2&&ctl.rings[0].phase===1)cycles++;last=ctl.rings[0].phase;}assert(cycles>=2);
});
test('vehicle permission and green-ball/arrow display remain consistent through carried green',()=>{
 for(const mode of ['green','protected']){const c=config([1,2,3]);c.mode='fixed';M.setPhaseMode(c,'in>out',1,mode);M.setPhaseMode(c,'in>out',2,mode);c.assignments['in>out'].noTurnOnRed=true;
 const sys=new M.System([{id:'j',config:c}],1),ctl=sys.records.get('j').controller,car={path:V.preparePath(points),pathDistance:170,speed:0,laneWidth:12};let carried=false;
 for(let t=0;t<150;t++){sys.step(.1,[car],(t+1)/10);const r=ctl.rings[0];if(r.phase===2&&r.state==='yellow'){assert.equal(car.signalControl.aspect,'yellow');assert(!car.signalControl.allowed);break;}
 assert.equal(car.signalControl.aspect,'green');assert(car.signalControl.allowed);assert.equal(M.movementState(ctl,{input:'in',output:'out'}).greenBall,mode==='green');carried ||= Boolean(r.continuation);}
 assert(carried);}
});
test('custom head designs persist only indication and layout settings',()=>{
 const c=config([2]);c.arms=[{id:'arm',x:0,y:0,angle:0,length:40}];c.heads=[{id:'h',arm:'arm',at:20,angle:0,type:'ball',movement:'in>out',design:{orientation:'horizontal',cluster:false,fourCluster:null,dad:false,hawk:false,indications:[{id:'red',size:12,color:'red',symbol:'ball'},{id:'yellow',size:8,color:'yellow',symbol:'right',service:'permissive',source:'main'}]}}];
 const restored=M.normalize(JSON.parse(JSON.stringify(c)));assert(M.validateSaved(restored));assert.deepEqual(restored.heads[0].design,c.heads[0].design);
 const invalid=mutate=>{const copy=structuredClone(c);mutate(copy.heads[0].design);assert(!M.validateSaved(copy));};
 invalid(d=>d.housingColor='yellow');invalid(d=>d.backplate='none');invalid(d=>d.indications[0].symbol='<script>');invalid(d=>d.indications[0].size=100);invalid(d=>d.cluster=true);invalid(d=>d.indications[0].service='invalid');invalid(d=>d.indications[0].id='yellow');
});
test('phase reorder changes playback within its ring/barrier without moving phase data',()=>{
 const c=config([1,2,3,4,5,6]);c.mode='fixed';c.phases[0].split=8;c.detectors=[{id:'d',x:0,y:0,angle:0,length:10,width:8,phase:1,delay:0,extend:0}];M.setPhaseMode(c,'in>out',1,'green');M.setPhaseMode(c,'in>out',2,'green');
 const phaseData=()=>c.phases.map(({order,...p})=>p),before=JSON.stringify([phaseData(),c.assignments,c.detectors]);
 assert(M.reorderPhase(c,2,1));assert.deepEqual(c.phases.filter(p=>p.ring===1&&p.barrier===1).sort((a,b)=>a.order-b.order).map(p=>p.id),[2,1]);assert.equal(JSON.stringify([phaseData(),c.assignments,c.detectors]),before);
 const saved=M.normalize(JSON.parse(JSON.stringify(c)));assert(M.validateSaved(saved));const ctl=new M.Controller(saved);ctl.step(.1);assert.equal(ctl.rings[0].phase,2);assert.equal(ctl.rings[1].phase,5);
 for(let n=0;n<80&&ctl.rings[0].phase!==1;n++){ctl.step(.1);assert.equal(M.indication(ctl,ctl.config.assignments['in>out']),'green');}assert.equal(ctl.rings[0].phase,1);
 assert(M.reorderPhase(c,2,1,true));assert.equal(c.phases[0].order,0);assert.equal(c.phases[1].order,1);
 const ordered=JSON.stringify(c);assert(!M.reorderPhase(c,1,3));assert(!M.reorderPhase(c,1,5));assert(!M.reorderPhase(c,1,2));assert.equal(JSON.stringify(c),ordered);
 c.phases[1].enabled=false;assert(!M.reorderPhase(c,1,2,true));
});

test('shared detector extends either mainline phase and requests the other without bypassing maximum green',()=>{
 for(const first of [1,4]){
  const c=config([1,4]);c.detectors=[{id:'main',phases:[1,4],delay:0,extend:0,memory:true}];
  const ctl=new M.Controller(c);if(first===4)ctl.barrier=2;ctl.calls.add(first);ctl.step(.1);assert.equal(ctl.aspect(first),'green');
  run(ctl,2,new Set(['main']));assert.equal(ctl.aspect(first),'green');assert(ctl.calls.has(first===1?4:1));
  run(ctl,3,new Set(['main']));assert.equal(ctl.rings[0].reason,'Max-out');assert.notEqual(ctl.aspect(first),'green');
 }
});
test('shared detector delay, extension and locking apply independently to each assigned phase',()=>{
 const c=config([1,4]);c.detectors=[{id:'main',phases:[1,4],delay:.2,extend:.3,memory:true}];const ctl=new M.Controller(c);
 assert.equal(ctl.detect(.1,new Set(['main'])).size,0);
 assert.deepEqual([...ctl.detect(.1,new Set(['main']))],[1,4]);
 assert.deepEqual([...ctl.detect(.1,new Set())],[1,4]);ctl.detect(.3,new Set());assert.deepEqual([...ctl.calls],[1,4]);
 ctl.start(ctl.rings[0],ctl.config.phases[0]);ctl.detect(.1,new Set());assert(!ctl.calls.has(1));assert(ctl.calls.has(4));
 const unlocked=new M.Controller({...c,detectors:[{...c.detectors[0],memory:false}]});unlocked.detect(.2,new Set(['main']));unlocked.detect(.4,new Set());assert.equal(unlocked.calls.size,0);
});
test('an idle shared detector never erases another detector’s active or locked phase call',()=>{
 for(const reverse of [false,true]){
  const c=config([1,4]);c.detectors=[{id:'shared',phases:[1,4],memory:false},{id:'locked',phase:4,memory:true}];if(reverse)c.detectors.reverse();
  const ctl=new M.Controller(c);ctl.detect(.1,new Set(['locked']));assert(ctl.calls.has(4));ctl.detect(.1,new Set());assert(ctl.calls.has(4));assert(!ctl.calls.has(1));
 }
});
test('multi-phase detector schema accepts legacy assignments and preserves shared assignments',()=>{
 const c=M.normalize(),d={id:'d',x:0,y:0,angle:0,length:10,width:10,phase:1,phases:[1,4],delay:0,extend:0};c.detectors=[d];
 assert(M.validateSaved(c));assert.deepEqual(M.detectorPhases(M.normalize(JSON.parse(JSON.stringify(c))).detectors[0]),[1,4]);
 for(const phases of [[],[0],[9],['1'],'1,4']){d.phases=phases;assert(!M.validateSaved(c));}
 delete d.phases;assert(M.validateSaved(c));assert.deepEqual(M.detectorPhases(d),[1]);
});

function yellowCar({speed=50,remaining=180,left=2}={}){
 const c=config([1]);c.assignments['in>out']={phase:1,noTurnOnRed:true};c.phases[0].yellow=4;
 const sys=new M.System([{id:'j',config:c}],1),ctl=sys.records.get('j').controller;ctl.calls.add(1);ctl.step(.1);ctl.clear(ctl.rings[0],'Test');ctl.rings[0].elapsed=4-left;
 const path=V.preparePath(points),car={id:1,path,pathDistance:200-10*381/214/2-remaining,speed,laneWidth:12,driver:B.profile(()=>.5,0)};sys.observe(car);return {sys,ctl,car};
}
test('yellow chooses a bounded stronger stop when comfortable braking cannot clear before red',()=>{
 const {sys,ctl,car}=yellowCar();assert.equal(car.signalControl.aspect,'yellow');assert(!car.signalControl.allowed);assert(car.signalControl.braking>car.driver.deceleration);assert(car.signalControl.braking<=car.driver.safeBraking);
 const braking=car.signalControl.braking;ctl.rings[0].state='red';sys.observe(car);assert.equal(car.signalControl.braking,braking,'red retains the yellow braking decision');
});
test('yellow can clear the line at current speed or continue when a safe stop is impossible',()=>{
 for(const args of [{speed:50,remaining:180,left:4},{speed:50,remaining:50,left:1}]){const {car}=yellowCar(args);assert(car.signalControl.allowed);}
 const {car}=yellowCar({speed:20,remaining:180,left:4});assert(!car.signalControl.allowed,'comfortable stop is preferred even if line is reachable');
});
test('yellow stop survives route-distance changes and a continuing driver reconsiders after queue braking',()=>{
 const {sys,car}=yellowCar(),memory=car.signalMemory,braking=memory.braking;
 car.path=V.preparePath(points.map(p=>({...p,x:p.x+30})));car.path.movements[0].start+=30;car.pathDistance+=30;sys.observe(car);
 assert.equal(car.signalMemory,memory);assert.equal(memory.braking,braking);assert(!car.signalControl.allowed);
 const next=yellowCar({speed:50,remaining:180,left:4});assert(next.car.signalControl.allowed);next.car.speed=20;next.sys.observe(next.car);assert(!next.car.signalControl.allowed,'a slowed queue follower can now stop');
});
test('a fast approach brakes during yellow without a speed discontinuity when red begins',()=>{
 const c=config([1]);c.phases[0].yellow=4;c.phases[0].red=30;c.assignments['in>out']={phase:1,noTurnOnRed:true};
 const e=new V.Engine({behavior:B,pixelsPerFoot:1,speed:80,temperature:0,random:()=>.5});e.signals=new M.System([{id:'j',config:c}],1);e.recoverStuck=()=>{};
 const path=V.preparePath(points.map(p=>({...p,x:p.x*10,station:p.station==null?undefined:p.station*10}))),driver={...B.profile(()=>.5,0),deceleration:1.5};
 const at=path.movements[0].start-10*381/214/2-600,car={id:1,path,pathDistance:at,distance:at,driver,speed:80,route:{},decisionAt:0,committed:new Set(),...V.position(path,at)};e.cars=[car];
 const ctl=e.signals.records.get('j').controller;ctl.calls.add(1);ctl.step(.1);ctl.clear(ctl.rings[0],'Test yellow');e.signals.observe(car);assert(!car.signalControl.allowed);
 let red=false,yellowBraked=false;
 for(let i=0;i<300;i++){
  const old=car.speed,aspect=car.signalControl.aspect;e.advance(1/30);if(aspect==='yellow'){assert(car.speed<=old+1e-8);yellowBraked ||= car.speed<old;}
  if(car.signalControl.aspect==='red'&&old>5){red=true;assert((old-car.speed)*30*.3048<=driver.safeBraking+.1,'no emergency clamp on the transition to red');}
  assert(car.pathDistance+10*381/214/2<=path.movements[0].start+.001,'front stays behind the stop line');
 }
 assert(red&&yellowBraked);assert.equal(e.collisionInterventions,0);
});

for(const mode of ['fixed','actuated','coordinated'])test(`${mode}: adjacent flashing yellows persist, then receive the full steady-yellow interval`,()=>{
 const c=config([1,2,3]);c.mode=mode;for(const p of c.phases)p.recall='min';if(mode==='coordinated'){c.coordination.cycle=18;for(const id of [5,6,7])c.phases[id-1].enabled=true;}
 M.setPhaseMode(c,'in>out',1,'permissive');M.setPhaseMode(c,'in>out',2,'permissive');
 const ctl=new M.Controller(c),a=ctl.config.assignments['in>out'],samples=[];assert.deepEqual(ctl.errors,[]);
 for(let t=0;t<250;t++){ctl.step(.1);samples.push({phase:ctl.rings[0].phase,state:ctl.rings[0].state,aspect:M.indication(ctl,a)});if(ctl.rings[0].phase===3)break;}
 for(const state of ['green','yellow','red'])assert(samples.some(s=>s.phase===1&&s.state===state&&s.aspect==='permissive'));
 assert(samples.some(s=>s.phase===2&&s.state==='green'&&s.aspect==='permissive'));
 const yellow=samples.filter(s=>s.phase===2&&s.state==='yellow');assert.equal(yellow.length,10,'one full second of yellow');assert(yellow.every(s=>s.aspect==='yellow'));
 assert(samples.some(s=>s.phase===2&&s.state==='red'&&s.aspect==='red'));assert.equal(samples.at(-1).aspect,'red');
});
test('flashing yellow clears after an isolated parent or an intervening red phase',()=>{
 for(const parents of [[1],[1,3]]){const c=config([1,2,3]);c.mode='fixed';for(const n of parents)M.setPhaseMode(c,'in>out',n,'permissive');const ctl=new M.Controller(c),a=ctl.config.assignments['in>out'];let yellow=0,red=0;
 for(let t=0;t<100;t++){ctl.step(.1);if(ctl.rings[0].phase===2)break;if(M.indication(ctl,a)==='yellow')yellow++;if(M.indication(ctl,a)==='red')red++;}
 assert.equal(yellow,10);assert(red>0);}
});
test('flashing-yellow continuity crosses a barrier, survives lost calls and wraps the cycle',()=>{
 for(const parents of [[1,2],[2,3]]){const c=config(parents);c.mode='fixed';for(const n of parents)M.setPhaseMode(c,'in>out',n,'permissive');const ctl=new M.Controller(c);for(let t=0;t<250;t++){ctl.step(.1);assert.equal(M.indication(ctl,ctl.config.assignments['in>out']),'permissive');}}
 const c=config([1,2,3]);c.phases[0].recall='min';c.detectors=[{id:'d',phase:2,memory:false}];for(const n of [1,2])M.setPhaseMode(c,'in>out',n,'permissive');const ctl=new M.Controller(c);
 for(let t=0;t<30&&!ctl.rings[0].continuation;t++)ctl.step(.1,new Set(['d']));assert(ctl.rings[0].continuation);
 for(let t=0;t<30&&ctl.rings[0].phase!==2;t++){ctl.step(.1);assert.equal(M.indication(ctl,ctl.config.assignments['in>out']),'permissive');}assert.equal(ctl.rings[0].phase,2);
});
test('flashing-yellow clearance uses its yellow time, arrow display and yielding vehicle permission',()=>{
 const {sys,ctl,car}=yellowCar({speed:50,remaining:180,left:4});M.setPhaseMode(ctl.config,'in>out',1,'permissive');delete car.signalMemory;sys.observe(car);
 assert.equal(car.signalControl.aspect,'yellow');assert(car.signalControl.allowed,'continuing driver can reach the line during this permissive parent yellow');assert.equal(car.signalControl.priority,1);
 const state=M.movementState(ctl,{input:'in',output:'out',junction});assert(!state.greenBall,'steady clearance keeps the arrow, not a green-ball clearance');assert(state.yielding);
});
test('a parallel-ring protected continuation takes priority over a held flashing yellow',()=>{
 const c=config([1,2,5,6]);c.mode='fixed';for(const n of [1,2])M.setPhaseMode(c,'in>out',n,'permissive');for(const n of [5,6])M.setPhaseMode(c,'in>out',n,'protected');const ctl=new M.Controller(c);let held=false;
 for(let t=0;t<150;t++){ctl.step(.1);assert.equal(M.indication(ctl,ctl.config.assignments['in>out']),'green');if(ctl.rings.every(r=>r.continuation)){held=true;assert.equal(ctl.heldGreen(ctl.config.assignments['in>out']),'protected');}}
 assert(held);
});
