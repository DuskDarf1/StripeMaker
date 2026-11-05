const {test}=require('node:test'),assert=require('node:assert/strict');
const V=require('../js/simulator-vehicles.js'),C=require('../js/simulator-collisions.js'),B=require('../js/simulator-drivers.js');
function make(id,turn=false,x=turn?-130:130,speed=30){
 const junction=turn?{entry:'west',exit:'north',input:'w',output:'north',angle:180,exitAngle:270}:{entry:'east',exit:'west',input:'e',output:'west',angle:0,exitAngle:180};
 const raw=turn?[{x:-1000,y:0},{x:-100,y:0},...Array.from({length:46},(_,i)=>({x:-100+50*Math.sin(i*Math.PI/90),y:-50*(1-Math.cos(i*Math.PI/90)),intersection:'j',junction})),{x:-50,y:-100,intersection:'j',junction},{x:-50,y:-500}]:[{x:1000,y:-12},{x:100,y:-12,intersection:'j',junction},{x:-100,y:-12,intersection:'j',junction},{x:-1000,y:-12}];
 const path=V.preparePath(raw.map(p=>({...p,laneWidth:12,level:1}))),d=turn?x+1000:1000-x;
 return {id,path,pathDistance:d,distance:d,speed,driver:B.profile(()=>.5,0),entryIntersection:'j',...V.position(path,d)};
}
test('an uncommitted permissive left turn cannot take priority from close opposing through traffic',()=>{
 const left=make(1,true,-130),through=make(2,false,40);left.reservation=true;
 const holds=C.reservations([left,through],1,1.67/.3048,1,.73/.3048,30);
 assert(through.reservation);assert(!holds.has(through.id),'priority traffic stays moving');assert(!left.reservation);assert(holds.has(left.id),'turn waits for a gap');
});
test('a turning driver can accept a genuinely clear gap without stopping the far opposing vehicle',()=>{
 const left=make(1,true,-130),through=make(2,false,900);
 const holds=C.reservations([left,through],1,1.67/.3048,1,.73/.3048,30);
 assert(left.reservation);assert(!holds.has(left.id));assert(!holds.has(through.id));
});
test('the turn cannot rely on an exit queue magically clearing',()=>{
 const left=make(1,true,-130),through=make(2,false,900);
 const holds=C.reservations([left,through],1,1.67/.3048,1,.73/.3048,30,new Map([[1,{car:{id:9,speed:0},gap:8}]]));
 assert(!left.reservation);assert(holds.has(left.id));assert(!holds.has(through.id));
});
test('one incoming lane follows its turning leader instead of treating its turn permission as a red light',()=>{
 const front=make(1,true,-95,10),rear=make(2,false);
 rear.path=V.preparePath([{x:-1000,y:0,laneWidth:12},{x:-100,y:0,laneWidth:12,intersection:'j',junction:{entry:'west',input:'w',exit:'east',angle:180,exitAngle:0}},{x:200,y:0,laneWidth:12,intersection:'j',junction:{entry:'west',input:'w',exit:'east',angle:180,exitAngle:0}}]);
 rear.pathDistance=800;Object.assign(rear,V.position(rear.path,800));front.reservation=true;
 const holds=C.reservations([front,rear],1,1.67/.3048,1,.73/.3048,30,new Map([[rear.id,{car:front,gap:85}]]));
 assert(!holds.has(rear.id),'real following distance replaces a mouth stop');
});
test('a slow entry into a shared receiving lane waits for an acceleration gap, not just crossing clearance',()=>{
 const j={entry:'south',exit:'east',input:'s',output:'out',angle:90,exitAngle:0},tj={entry:'west',exit:'east',input:'w',output:'out',angle:180,exitAngle:0};
 const minorPath=V.preparePath([{x:0,y:150},{x:0,y:100,intersection:'j',junction:j},{x:0,y:30,intersection:'j',junction:j},{x:20,y:0,intersection:'j',junction:j},{x:100,y:0,intersection:'j',junction:j},{x:100,y:0,road:5,lane:0,station:0,direction:1},{x:2000,y:0,road:5,lane:0,station:1900,direction:1}].map(p=>({...p,laneWidth:12})));
 const majorPath=V.preparePath([{x:-2000,y:0},{x:-100,y:0,intersection:'j',junction:tj},{x:100,y:0,intersection:'j',junction:tj},{x:100,y:0,road:5,lane:0,station:0,direction:1},{x:2000,y:0,road:5,lane:0,station:1900,direction:1}].map(p=>({...p,laneWidth:12})));
 minorPath.movements[0].control={type:'stop',marking:'bar'};
 const minor=()=>({id:1,path:minorPath,pathDistance:120,speed:15,driver:B.profile(()=>.5,0),stops:new Map([['bar',0]]),entryIntersection:'j',...V.position(minorPath,120)});
 const main=x=>({id:2,path:majorPath,pathDistance:x+2000,speed:60,driver:B.profile(()=>.5,0),entryIntersection:'j',...V.position(majorPath,x+2000)});
 const near=minor(),close=main(-600);let holds=C.reservations([near,close],1,1.67/.3048,1,.73/.3048,60);assert(holds.has(near.id));assert(!holds.has(close.id));
 const far=minor(),distant=main(-1900);holds=C.reservations([far,distant],1,1.67/.3048,1,.73/.3048,60);assert(far.reservation);assert(!holds.has(far.id));
});
test('waiting exactly at a conflict hold cannot acquire commitment from numerical creep',()=>{
 const left=make(1,true,-130),through=make(2,false,40);
 C.reservations([left,through],1,1.67/.3048,1,.73/.3048,30);
 left.pathDistance=left.entryConflictLine-C.width(left,1)*381/214/2;
 Object.assign(left,V.position(left.path,left.pathDistance));left.speed=.001;left.reservation=true;
 const holds=C.reservations([left,through],1,1.67/.3048,2,.73/.3048,30);
 assert(!left.entryCommitted,'a bumper at the waiting boundary is still yielding');
 assert(holds.has(left.id));assert(!holds.has(through.id));
});
test('a turn uses the approaching driver’s larger headway when accepting a gap',()=>{
 const left=make(1,true,-105,0),through=make(2,false,478,60);
 left.driver.headway=1;through.driver.headway=2;
 const holds=C.reservations([left,through],1,1.67/.3048,1,.73/.3048,60);
 assert(holds.has(left.id),'shorter turning-driver headway cannot authorize a gap the other driver rejects');
 assert(!holds.has(through.id));assert(!left.reservation);
});

test('green-ball left turns yield to close opposing green traffic but take a clear gap',()=>{
 const S=require('../js/simulator-signals.js');
 for(const x of [40,900]){
  const left=make(1,true,-130),through=make(2,false,x),config=S.normalize();
  for(const p of config.phases){p.enabled=[2,6].includes(p.id);p.recall='min';}
  config.assignments={'w>north':{phase:2,greenMode:'auto'},'e>west':{phase:6,greenMode:'auto'}};
  const movements=[left,through].map(car=>{const j=car.path.movements[0].junction;return {input:j.input,output:j.output,points:car.path.points.filter(p=>p.intersection==='j')};});
  const system=new S.System([{id:'j',config,movements}],1);system.step(.1,[],.1);
  // Observe the through car before its bumper enters, then advance the fixture
  // to the conflict. Already-admitted traffic retains its entry priority.
  const distance=through.pathDistance;through.pathDistance=800;system.observe(through);through.pathDistance=distance;system.observe(through);system.observe(left);
  assert.deepEqual(system.records.get('j').controller.errors,[]);assert(left.signalControl.allowed);assert.equal(left.signalControl.priority,1);assert.equal(through.signalControl.priority,2);
  const holds=C.reservations([left,through],1,1.67/.3048,1,.73/.3048,30);
  assert(!holds.has(through.id));assert.equal(holds.has(left.id),x===40,'ordinary green uses real approaching-vehicle gap checks');
 }
});
