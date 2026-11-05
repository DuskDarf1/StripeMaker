/* Intersection motion must use the existing temperature-sampled a/b exactly
   once. No extra hesitation or intersection-only multiplier is introduced. */
const {test}=require('node:test'),assert=require('node:assert/strict');
const B=require('../js/simulator-drivers.js'),V=require('../js/simulator-vehicles.js'),M=require('../js/simulator-signals.js');
const seeded=(state=7)=>()=>((state=(Math.imul(state,1664525)+1013904223)>>>0)/4294967296);
const junction={entry:'west',exit:'east',input:'in',output:'out',angle:180,exitAngle:0,approaches:['west','east'],approachLanes:[{id:'west',incoming:['in'],outgoing:['other']},{id:'east',incoming:['other2'],outgoing:['out']}]};
function fixture(driver,{ppf=1,speed=0,remaining=0}={}){
 const points=[{x:0,y:0,road:1,lane:0,station:0},{x:2000,y:0,road:1,lane:0,station:2000},{x:2000,y:0,intersection:'j',junction},{x:2100,y:0,intersection:'j',junction},{x:2100,y:0,road:2,lane:0,station:0},{x:3200,y:0,road:2,lane:0,station:1100}].map(p=>({...p,x:p.x*ppf,y:p.y*ppf,laneWidth:12*ppf,direction:1,...(p.station==null?{}:{station:p.station*ppf})}));
 const config=M.normalize();for(const p of config.phases){p.enabled=p.id===1;p.pedMode='omit';}config.assignments['in>out']={phase:1,noTurnOnRed:true};
 const e=new V.Engine({behavior:B,pixelsPerFoot:ppf,speed:40*ppf,temperature:driver.temperature,random:()=>.5});e.signals=new M.System([{id:'j',config}],ppf);e.recoverStuck=()=>{};
 const ctl=e.signals.records.get('j').controller;ctl.rings[0].phase=1;ctl.rings[0].state='red';ctl.step=()=>{};
 const path=V.preparePath(points),at=2000*ppf-B.length({laneWidth:12*ppf},ppf)/2-remaining*ppf;
 const car={id:1,source:'test',route:{},path,pathDistance:at,distance:at,speed:speed*ppf,driver:{...driver},committed:new Set(),decisionAt:0};e.updateCar(car);e.cars=[car];e.signals.observe(car);
 return {e,car,ctl,at};
}
function rates(temperature){
 const random=seeded(),samples=Array.from({length:300},()=>B.profile(random,temperature)),baseline=B.profile(()=>.5,0);
 // Isolate the requested rate from headway, desired-speed and gap variation.
 return key=>[Math.min(...samples.map(p=>p[key])),Math.max(...samples.map(p=>p[key]))].map(value=>({...baseline,temperature,[key]:value,safeBraking:Math.max(baseline.safeBraking,key==='deceleration'?value:baseline.deceleration)}));
}
for(const ppf of [1,6])test(`temperature changes actual green-light launch rates without hesitation (${ppf} px/ft)`,()=>{
 for(const temperature of [0,40,75,100]){
  const launches=rates(temperature)('acceleration').map(driver=>{
   const {e,car,ctl,at}=fixture(driver,{ppf});e.advance(1);assert.equal(car.speed,0);assert.equal(car.pathDistance,at,'red holds every driver at the line');
   ctl.rings[0].state='green';e.advance(B.STEP);assert(car.speed>0,'starts on the first permitted physics step');
   assert(Math.abs(car.speed/(ppf/.3048)/B.STEP-driver.acceleration)<1e-8,'uses the sampled acceleration exactly once');
   e.advance(3-B.STEP);assert.equal(e.collisionInterventions,0);return {speed:car.speed/ppf,travel:(car.pathDistance-at)/ppf};
  });
  if(temperature===0)assert.deepEqual(launches[0],launches[1]);else{assert(launches[1].speed>launches[0].speed);assert(launches[1].travel>launches[0].travel);}
 }
});
for(const ppf of [1,6])test(`temperature changes red-approach braking while retaining exact stops (${ppf} px/ft)`,()=>{
 for(const temperature of [0,40,75,100]){
  const approaches=rates(temperature)('deceleration').map(driver=>{
   const {e,car}=fixture(driver,{ppf,speed:40,remaining:1400});let speedAt200=null,maxBraking=0;
   for(let tick=0;tick<120*30;tick++){
    const old=car.speed;e.advance(B.STEP);
    if(speedAt200==null&&car.signalControl.remaining<=200*ppf)speedAt200=car.speed/ppf;
    if(old>5*ppf)maxBraking=Math.max(maxBraking,(old-car.speed)/(ppf/.3048)/B.STEP);
    assert(car.pathDistance+B.length(car,ppf)/2<=2000*ppf+.001*ppf,'never crosses red');
    if(car.speed===0&&car.signalControl.remaining<.001*ppf)break;
   }
   assert.equal(car.speed,0);assert(car.signalControl.remaining<.001*ppf);assert.equal(e.collisionInterventions,0);assert(speedAt200>0);
   return {speedAt200,maxBraking};
  });
  if(temperature===0)assert.deepEqual(approaches[0],approaches[1]);else{
   assert(approaches[0].speedAt200<approaches[1].speedAt200,'gentler driver slows sooner');
   assert(approaches[0].maxBraking<approaches[1].maxBraking,'firmer driver brakes more strongly on an approach with ample stopping distance');
  }
 }
});
