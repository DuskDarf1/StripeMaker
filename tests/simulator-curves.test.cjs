const {test}=require('node:test'),assert=require('node:assert/strict');
const Q=require('../js/simulator-curves.js'),V=require('../js/simulator-vehicles.js'),B=require('../js/simulator-drivers.js'),C=require('../js/simulator-collisions.js');
function turn(radius=50,ppf=1,intersection=false){
 const raw=[{x:0,y:0},{x:500,y:0},...Array.from({length:91},(_,i)=>({x:500+radius*Math.sin(i*Math.PI/180/2),y:radius*(1-Math.cos(i*Math.PI/180/2))})),{x:500+radius,y:radius+700}];
 return V.preparePath(raw.map(p=>({...p,x:p.x*ppf,y:p.y*ppf,laneWidth:12*ppf,...(intersection?{intersection:'j'}:{road:1,lane:0})})));
}
const car=(path,distance,speed=88,profile={})=>({id:1,path,pathDistance:distance,speed,driver:{...B.profile(()=>.5,0),...profile},...V.position(path,distance)});
test('curve speeds reproduce the published unbanked side-friction relationship',()=>{
 for(const mph of [10,15,20,25,30,40,50,60,70,80])assert(Math.abs(Q.speedForRadius(mph*mph/(15*Q.friction(mph)))-mph)<.001);
 assert(Q.speedForRadius(25)<Q.speedForRadius(100));assert(Q.speedForRadius(100)<Q.speedForRadius(1000));assert.equal(Q.speedForRadius(Infinity),Infinity);
});
test('straights retain desired speed; tight and broad road/intersection curves set different targets at either scale',()=>{
 for(const ppf of [1,6]){
  const straight=V.preparePath([{x:0,y:0},{x:10000*ppf,y:0}]);assert.equal(C.desiredSpeed(car(straight,100*ppf,88*ppf),88*ppf,5.5*ppf,ppf),88*ppf);
  for(const intersection of [false,true]){const tight=turn(25,ppf,intersection),wide=turn(250,ppf,intersection);
   const at=510*ppf;const a=C.desiredSpeed(car(tight,at,20*ppf),88*ppf,5.5*ppf,ppf),b=C.desiredSpeed(car(wide,at,20*ppf),88*ppf,5.5*ppf,ppf);
   assert(a<20*ppf);assert(b>a);assert(b<88*ppf);
   const ahead=C.desiredSpeed(car(tight,300*ppf,88*ppf),88*ppf,5.5*ppf,ppf);assert(ahead<88*ppf,'braking starts before the turn');
   const after=tight.length-100*ppf;assert.equal(C.desiredSpeed(car(tight,after,20*ppf),88*ppf,5.5*ppf,ppf),88*ppf,'speed recovers on the following straight');
  }
 }
});
test('personal temperature curve preferences vary speed while preserving the global personal cap',()=>{
 const path=turn(50),c=car(path,530,20),base=C.desiredSpeed(c,88,5.5);
 assert(C.desiredSpeed({...c,driver:{...c.driver,roundaboutFactor:1.3}},88,5.5)>base);
 assert(C.desiredSpeed({...c,driver:{...c.driver,roundaboutFactor:.8}},88,5.5)<base);
 assert(C.desiredSpeed(c,5,5.5)<=5);assert.strictEqual(Q.limits(path,1),Q.limits(path,1),'cache numerical geometry');
});
test('actual cars brake before a tight turn, traverse it without stopping, then accelerate',()=>{
 const path=turn(25),e=new V.Engine({speed:60*5280/3600,pixelsPerFoot:1,temperature:0,behavior:B});e.configure([{key:'s',rate:1,routes:[{key:'r',points:path.points}]}]);e.recoverStuck=()=>{};
 let entry=Infinity,minimum=Infinity,recovered=0;
 for(let i=0;i<3600;i++){e.advance(1/60);const c=e.cars[0];if(!c)continue;if(c.pathDistance>490&&c.pathDistance<540){entry=Math.min(entry,c.speed);minimum=Math.min(minimum,c.speed);}if(c.pathDistance>900){recovered=c.speed;break;}}
 assert(entry<25,'turn taken below 17 mph');assert(minimum>0,'no artificial zero-speed curvature stop');assert(recovered>entry+10,'accelerates after the turn');
});
test('empty and single-point routes do not create invalid curvature constraints',()=>{
 for(const points of [[],[{x:0,y:0}]])assert.equal(Q.target({path:V.preparePath(points),pathDistance:0,speed:10},44,5.5,1),44);
});
test('merge preparation observes road curvature while retaining downstream zones and active steering curvature',()=>{
 const path=turn(25),straight=V.preparePath([{x:0,y:0},{x:10000,y:0}]),c={...car(path,510,20),mergeContext:{approachPath:straight}};
 assert.equal(C.desiredSpeed(c,88,5.5),88,'a planned lane-change bend does not suppress acceleration along a straight approach');
 assert(C.desiredSpeed({...c,laneChange:{progress:.1}},88,5.5)<20,'active steering retains its physical curvature');
 assert(C.desiredSpeed({...c,mergeContext:{approachPath:turn(100)}},88,5.5)<88,'real roadway curvature remains visible');
 path.zoneLimits=[{distance:0,limit:15}];assert.equal(C.desiredSpeed(c,88,5.5),15,'actual route speed zones remain in force');
 path.zoneLimits=[{distance:0,limit:88},{distance:520,limit:15}];assert(C.desiredSpeed(c,88,5.5)<20,'anticipate a lower downstream zone even beyond the acceleration lane');
});
