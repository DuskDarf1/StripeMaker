const {test}=require('node:test'),assert=require('node:assert/strict');
const C=require('../js/simulator-collisions.js'),V=require('../js/simulator-vehicles.js'),B=require('../js/simulator-drivers.js');
const car=(id,x,y,angle=0,level=1)=>({id,x,y,angle,level,laneWidth:12,speed:10,driver:{headway:1.6,duration:6.28},pathDistance:0});
const moving=(id,points,speed=10)=>{const p=V.preparePath(points.map(p=>({...p,laneWidth:12,level:p.level??1})));return {...car(id,points[0].x,points[0].y),speed,path:p,...V.position(p,0)};};
test('forecast waits for lane-change admission and invalidates a cached hold when the gap is accepted',()=>{
 const a=moving(2,[{x:0,y:0},{x:300,y:0}],30),b=moving(1,[{x:30,y:20},{x:40,y:20},{x:80,y:0},{x:300,y:0}],20);
 const maneuver={road:1,from:1,to:0,start:10,end:55};b.path.maneuvers=[maneuver];b.committed=new Set();
 const world=C.scene([a,b],1);assert.equal(C.threat(a,world,30,2,1),null,'unaccepted steering cannot force through traffic to stop');
 b.laneIntent={road:1,from:1,to:0};assert(C.threat(a,world,30,2,1),'just-admitted movement is visible in the same physics step');
 b.laneIntent=undefined;b.committed.add(maneuver);assert(C.threat(a,C.scene([a,b],1),30,2,1),'active steering remains visible');
});
test('oriented bodies detect side, rear, and crossing contacts, excluding adjacent lanes and bridges',()=>{
 assert(C.overlap(car(1,0,0),car(2,5,0),1));assert(C.overlap(car(1,0,0),car(2,0,2,90),1));
 assert(!C.overlap(car(1,0,0),car(2,0,12),1));assert(!C.overlap(car(1,0,0),car(2,0,0,0,2),1));
 assert(!C.overlap(car(1,0,0),car(2,30,0),1));
});
test('swept tests detect mid-step collisions even when the final bodies are far apart',()=>{
 const a=moving(1,[{x:-100,y:0},{x:100,y:0}],200),b=moving(2,[{x:0,y:-100},{x:0,y:100}],200);
 assert(!C.overlap(a,b,1));assert(!C.overlap({...a,...C.sample(a,200)},{...b,...C.sample(b,200)},1));
 const t=C.contact(a,200,b,200,1);assert(t>0&&t<1);
 const updates=[{car:a,travel:200,speed:200},{car:b,travel:200,speed:200}];C.resolve(updates,1);
 assert.equal(C.contact(a,updates[0].travel,b,updates[1].travel,1),null,'accepted trajectories are collision-free throughout the step');
});
test('curved-path knots and high speeds cannot tunnel through a stationary car',()=>{
 const a=moving(1,[{x:-100,y:-100},{x:0,y:-100},{x:0,y:100},{x:100,y:100}],999),b=moving(2,[{x:0,y:0},{x:0,y:1}],0);
 const u={car:a,travel:400,speed:999},v={car:b,travel:0,speed:0};
 assert(C.contact(a,400,b,0,1)!=null);C.resolve([u,v],1);assert(u.travel<200);assert.equal(C.contact(a,u.travel,b,0,1),null);
});
test('same coordinates on different levels do not cause braking or blocked movement',()=>{
 const a=moving(1,[{x:-100,y:0,level:1},{x:100,y:0,level:1}]),b=moving(2,[{x:0,y:-100,level:2},{x:0,y:100,level:2}]);
 assert.equal(C.contact(a,200,b,200,1),null);const updates=[{car:a,travel:200,speed:10},{car:b,travel:200,speed:10}];assert.equal(C.resolve(updates,1),0);
});
test('roundabout circulation has priority over entry and safe alternatives remain unblocked',()=>{
 const a=moving(1,[{x:-100,y:0},{x:100,y:0}]),b=moving(2,[{x:0,y:-55},{x:0,y:100}]);b.circulating=true;
 assert(C.priority(b,a)<0);const world=C.scene([a,b],1);
 assert(C.threat(a,world,30,.73/.3048,1));assert.equal(C.threat(b,world,30,.73/.3048,1),null);
});
test('crowded arrivals maintain body separation and resume after a lead vehicle clears',()=>{
 const points=[{x:0,y:0,road:1,lane:0,station:0,direction:1,laneWidth:12},{x:2000,y:0,road:1,lane:0,station:2000,direction:1,laneWidth:12}];
 const e=new V.Engine({speed:30,behavior:B,random:()=>0,pixelsPerFoot:1});e.configure([{key:'a',rate:600,routes:[{key:'out',points}]}]);
 for(let i=0;i<800;i++){e.advance(.05);for(let a=0;a<e.cars.length;a++)for(let b=a+1;b<e.cars.length;b++)assert(!C.overlap(e.cars[a],e.cars[b],1));}
 assert(e.cars[0].distance>1000);assert(e.sources.get('a').pending>0);
});
test('a stopped lead car causes braking and traffic accelerates again when it clears',()=>{
 const points=(start,limit)=>[{x:start,y:0,road:1,lane:0,station:start,direction:1,laneWidth:12,...(limit==null?{}:{speedLimit:limit})},{x:2000,y:0,road:1,lane:0,station:2000,direction:1,laneWidth:12,...(limit==null?{}:{speedLimit:limit})}];
 const make=(id,start,speed,limit)=>({...moving(id,points(start,limit),speed),road:1,lane:0,station:start,direction:1,distance:0,driver:{duration:6.28,headway:1.6},committed:new Set(),decisionAt:0,route:{}});
 const e=new V.Engine({speed:30,behavior:B,pixelsPerFoot:1}),follower=make(2,0,30),obstacle=make(1,180,0,0);e.cars=[follower,obstacle];
 for(let i=0;i<500;i++){e.driverStep(.05);e.time+=.05;assert(!C.overlap(follower,obstacle,1));}
 assert(follower.speed<.1);const stopped=follower.distance;e.cars=[follower];
 for(let i=0;i<160;i++){e.driverStep(.05);e.time+=.05;}
 assert(follower.speed>5);assert(follower.distance>stopped+10);
});
test('an advantageous legal lane change passes a stopped car without touching it',()=>{
 const L=require('../js/simulator-lane-changes.js');
 const lane=index=>({road:1,lane:index,stations:[0,1000],points:[{x:0,y:index*12,road:1,lane:index,station:0,direction:1,lateral:index*12,laneWidth:12},{x:1000,y:index*12,road:1,lane:index,station:1000,direction:1,lateral:index*12,laneWidth:12}]});
 const a=lane(0),b=lane(1),e=new V.Engine({speed:20,behavior:B,pixelsPerFoot:1});
 const route={passing:()=>[1],replan:({car})=>{const end=car.station+20*6.28;return end<1000?[...L.transition(a,b,car.station,end,{blocked:[]},1000),...L.slice(b,end,1000)]:null;}};
 const me={...moving(2,L.slice(a,100,1000),20),road:1,lane:0,station:100,direction:1,distance:0,driver:{duration:6.28,headway:1.6},committed:new Set(),decisionAt:0,route};
 const obstacle={...moving(1,L.slice(a,300,1000).map(p=>({...p,speedLimit:0})),0),road:1,lane:0,station:300,direction:1,distance:0,driver:{duration:6.28,headway:1.6},committed:new Set(),decisionAt:0,route:{}};e.cars=[me,obstacle];
 for(let i=0;i<480;i++){e.driverStep(.05);e.time+=.05;assert(!C.overlap(me,obstacle,1));}
 assert.equal(me.lane,1);assert(me.station>obstacle.station+30);
});
test('roundabout speed targets slow before entry while retaining the global upper cap',()=>{
 const a=moving(1,[{x:0,y:0},{x:300,y:0,speedLimit:22,intersection:'r'},{x:500,y:0,speedLimit:22,intersection:'r'}],50);
 const target=C.desiredSpeed(a,50,1.67/.3048);assert(target<=50&&target>22);
 a.pathDistance=300;a.speedLimit=22;assert.equal(C.desiredSpeed(a,50,1.67/.3048),22);
 assert.equal(C.desiredSpeed(a,10,1.67/.3048),10);
});
test('simultaneously moving traffic is not mistaken for parked obstacles',()=>{
 const a=moving(1,[{x:24,y:0},{x:200,y:0}]),b=moving(2,[{x:0,y:0},{x:200,y:0}]);
 const updates=[{car:a,travel:10,speed:10},{car:b,travel:10,speed:10}];
 assert.equal(C.resolve(updates,1),0);assert.equal(updates[1].travel,10);
});
test('entry permission cannot skip an unadmitted queue leader',()=>{
 const points=[{x:-160,y:0},{x:-100,y:0},{x:-100,y:0,intersection:'r'},{x:100,y:0,intersection:'r'},{x:100,y:0},{x:200,y:0}];
 const rear={...moving(1,points,20),entryRequestedAt:0,entryIntersection:'r'},front={...moving(2,points,20),entryRequestedAt:1,entryIntersection:'r',pathDistance:30};
 Object.assign(front,V.position(front.path,30));
 const observations=new Map([[rear.id,{car:front}]]);
 const holds=C.reservations([rear,front],1,1.67/.3048,2,.73/.3048,20,observations);
 assert(front.reservation);assert(!rear.reservation);assert(holds.has(rear.id));
});
test('upstream permission is revoked when crossing space is still occupied, then regranted after clearance',()=>{
 const points=(vertical=false)=>[
  {x:vertical?0:-160,y:vertical?-160:0},
  {x:vertical?0:-100,y:vertical?-100:0},
  {x:vertical?0:-100,y:vertical?-100:0,intersection:'r'},
  {x:vertical?0:100,y:vertical?100:0,intersection:'r'},
  {x:vertical?0:100,y:vertical?100:0},
  {x:vertical?0:200,y:vertical?200:0}];
 const entrant={...moving(1,points(),10),pathDistance:25,reservation:true};Object.assign(entrant,V.position(entrant.path,25));
 const circulating={...moving(2,points(true),0),pathDistance:160,reservation:true,circulating:true};Object.assign(circulating,V.position(circulating.path,160));
 let holds=C.reservations([entrant,circulating],1,1.67/.3048,0,.73/.3048,30);
 assert(!entrant.reservation,'upstream permission is provisional');assert(holds.has(entrant.id),'a stationary conflicting vehicle cannot be assumed to clear on schedule');
 circulating.pathDistance=260;Object.assign(circulating,V.position(circulating.path,260));
 holds=C.reservations([entrant,circulating],1,1.67/.3048,1,.73/.3048,30);
 assert(entrant.reservation);assert(!holds.has(entrant.id));
});

test('a waiting entrant cannot reserve an empty crossing against another entrance',()=>{
 const points=(vertical=false,y=0)=>[
  {x:vertical?0:-160,y:vertical?-160:y},
  {x:vertical?0:-100,y:vertical?-100:y},
  {x:vertical?0:-100,y:vertical?-100:y,intersection:'r'},
  {x:vertical?0:100,y:vertical?100:y,intersection:'r'},
  {x:vertical?0:100,y:vertical?100:y},
  {x:vertical?0:200,y:vertical?200:y}];
 const actor=(id,path,d,extra={})=>{const c={...moving(id,path,10),pathDistance:d,...extra};Object.assign(c,V.position(c.path,d));return c;};
 const circulating=actor(1,points(),160,{reservation:true,circulating:true});
 const waiting=actor(2,points(true),25,{entryRequestedAt:0});
 const clear=actor(3,points(false,-80),25,{entryRequestedAt:1});
 const holds=C.reservations([circulating,waiting,clear],1,1.67/.3048,2,.73/.3048,30);
 assert(holds.has(waiting.id));assert(!waiting.reservation);
 assert(clear.reservation,'a clear lane may proceed past a denied entrant');assert(!holds.has(clear.id));
});

test('entry permission commits before braking would overrun the hold point',()=>{
 const points=vertical=>[
  {x:vertical?0:-160,y:vertical?-160:0},{x:vertical?0:-100,y:vertical?-100:0},
  {x:vertical?0:-100,y:vertical?-100:0,intersection:'r'},
  {x:vertical?0:100,y:vertical?100:0,intersection:'r'},
  {x:vertical?0:100,y:vertical?100:0},{x:vertical?0:200,y:vertical?200:0}];
 const committed={...moving(2,points(false),10),pathDistance:45,reservation:true,entryRequestedAt:1};
 const arriving={...moving(1,points(true),10),pathDistance:25,entryRequestedAt:0};
 for(const c of [committed,arriving])Object.assign(c,V.position(c.path,c.pathDistance));
 const holds=C.reservations([arriving,committed],1,1.67/.3048,2,.73/.3048,30);
 assert(committed.reservation,'do not cancel when stopping would intrude into circulation');assert(!holds.has(committed.id));
 assert(!arriving.reservation);assert(holds.has(arriving.id),'later arbitration must respect the committed car');
});

test('roundabout entry observes the immediately upstream leg and the driver acceleration gap',()=>{
 const context={x:0,y:0,direction:1,entry:'east',gates:[{id:'east',angle:0},{id:'north',angle:-Math.PI/2},{id:'west',angle:Math.PI},{id:'south',angle:Math.PI/2}]};
 const entrant=acceleration=>{const c=moving(1,[{x:160,y:0,intersection:'r',roundabout:context,roundaboutPhase:'entry'},
  {x:100,y:0,intersection:'r',roundaboutPhase:'circulating'},
  {x:-100,y:0,intersection:'r',roundaboutPhase:'circulating'}],0);
  c.pathDistance=30;Object.assign(c,V.position(c.path,30));c.driver={...B.BASELINE,acceleration};c.entryRequestedAt=0;c.entryIntersection="r";return c;};
 const approaching=(y,speed=5)=>{const c=moving(2,[{x:100,y:-500,intersection:'r',roundaboutPhase:'circulating',circulating:true},{x:100,y:500,intersection:'r',roundaboutPhase:'circulating',circulating:true}],speed);
  c.pathDistance=y+500;Object.assign(c,V.position(c.path,c.pathDistance));c.reservation=true;return c;};
 const check=(a,b)=>C.reservations([a,b],1,1.67/.3048,0,.73/.3048,22);
 const near=entrant(.73);assert(check(near,approaching(-60,20)).has(near.id),'yield to an approaching car in the previous leg');
 const open=entrant(.73);assert(!check(open,approaching(-160)).has(open.id),'accept enough space to accelerate ahead of the approaching car');
 const gentle=entrant(.365);assert(check(gentle,approaching(-160)).has(gentle.id),'a slower accelerating driver needs more clearance');
 const occupied=entrant(.73);assert(check(occupied,approaching(0,0)).has(occupied.id),'never predict an occupied crossing will clear');
 const blockingEntry=approaching(0,0);blockingEntry.path.movements[0].roundabout={...context,entry:'north'};blockingEntry.circulating=false;blockingEntry.roundaboutPhase='exit';
 const blocked=entrant(.73);assert(check(blocked,blockingEntry).has(blocked.id),'an actual body in the merge must still clear even outside the circulating phase');
 const remote=moving(2,[{x:100,y:100,intersection:'r',circulating:true},{x:-100,y:100,intersection:'r',circulating:true},
  {x:-100,y:-100,intersection:'r',circulating:true},{x:100,y:-100,intersection:'r',circulating:true},{x:100,y:100,intersection:'r',circulating:true}],22);
 remote.reservation=true;remote.circulating=true;const clear=entrant(.73);
 assert(!check(clear,remote).has(clear.id),'a car elsewhere cannot reserve the entire ring against this entrance');
});

test('fast upstream permission stays provisional while safe braking can still reach the hold point',()=>{
 const points=vertical=>[{x:vertical?0:-160,y:vertical?-160:0},{x:vertical?0:-100,y:vertical?-100:0},
  {x:vertical?0:-100,y:vertical?-100:0,intersection:'r'},{x:vertical?0:100,y:vertical?100:0,intersection:'r'},
  {x:vertical?0:100,y:vertical?100:0},{x:vertical?0:200,y:vertical?200:0}];
 const waiting={...moving(1,points(false),0),pathDistance:40,entryIntersection:'r',entryRequestedAt:0};
 const upstream={...moving(2,points(true),30),pathDistance:0,entryIntersection:'r',entryRequestedAt:1,reservation:true,driver:{...B.BASELINE}};
 for(const c of [waiting,upstream])Object.assign(c,V.position(c.path,c.pathDistance));
 const holds=C.reservations([waiting,upstream],1,1.67/.3048,2,.73/.3048,30);
 assert(waiting.reservation);assert(!holds.has(waiting.id),'an older waiting entrant can take a clear gap');
 assert(!upstream.reservation);assert(holds.has(upstream.id),'safe upstream cancellation does not retain a premature claim');
});

test('circulating drivers see committed cars in the merge but never yield to their own follower',()=>{
 const entering=moving(2,[{x:-200,y:0,intersection:'r',roundaboutPhase:'entry'},{x:-100,y:0,intersection:'r',roundaboutPhase:'circulating'},{x:100,y:0,intersection:'r',roundaboutPhase:'circulating'}],20);
 entering.pathDistance=100;Object.assign(entering,V.position(entering.path,100));entering.roundaboutPhase='entry';entering.circulating=false;
 const circulating=moving(1,[{x:0,y:-100,intersection:'r'},{x:0,y:100,intersection:'r'}],20);circulating.circulating=true;circulating.roundaboutPhase='circulating';
 for(const c of [entering,circulating]){c.entryIntersection='r';c.reservation=true;}
 assert(C.priority(entering,circulating)<0,'a committed car already merging must be allowed to clear');
 assert(C.threat(circulating,C.scene([entering,circulating],1),20,.73/.3048,1),'entry permission cannot hide a conflicting body');
 assert.equal(C.threat(entering,C.scene([entering,circulating],1),20,.73/.3048,1),null,'the committed merge does not create reciprocal yielding');
 entering.situation={leader:circulating.id};assert.equal(C.threat(circulating,C.scene([entering,circulating],1),20,.73/.3048,1),null,'a leader cannot yield back to its follower');
 entering.reservation=false;assert(C.priority(circulating,entering)<0,'queued entrants still yield to circulation');
});
test('a downstream leader that cleared or replanned past the intersection cannot hold its entrance queue',()=>{
 const points=[{x:-160,y:0},{x:-100,y:0,intersection:'j'},{x:100,y:0,intersection:'j'},{x:1000,y:0}];
 for(const replanned of [false,true]) {
  const entrant=moving(2,points,20),front=moving(1,replanned?[{x:500,y:0},{x:1000,y:0}]:points,20);
  front.entryIntersection='j';front.pathDistance=replanned?0:660;Object.assign(front,V.position(front.path,front.pathDistance));
  const holds=C.reservations([entrant,front],1,1.67/.3048,2,.73/.3048,20,new Map([[entrant.id,{car:front,gap:500}]]));
  assert(entrant.reservation,'clear entrance remains admitted');assert(!holds.has(entrant.id),'use the real downstream IDM gap, not an entrance hold');
 }
});
test('a local contact chain never freezes a remote vehicle elsewhere on the sheet',()=>{
 const length=10*381/214,a=moving(1,[{x:0,y:0},{x:100,y:0}]),b=moving(2,[{x:length+1e-6,y:0},{x:200,y:0}]);
 const remote=moving(3,[{x:1000,y:1000},{x:2000,y:1000}]),updates=[a,b,remote].map(car=>({car,speed:10,travel:1,reason:'free-road'}));
 C.resolve(updates,1);assert.equal(updates[2].travel,1);assert.equal(updates[2].speed,10);assert.equal(updates[2].reason,'free-road');
 assert(!C.overlap(a,b,1));assert.equal(C.contact(a,updates[0].travel,b,updates[1].travel,1),null);
});
