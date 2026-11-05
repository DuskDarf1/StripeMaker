/* Saved signal.json geometry; isolated seeded playback with recovery disabled. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
const P=require(process.env.PLAYWRIGHT_MODULE||'playwright'),fixture=require('./fixtures/simulator-red-queues.json');
(async()=>{const webkit=process.env.BROWSER==='webkit',browser=await P[webkit?'webkit':'chromium'].launch({headless:true,executablePath:webkit?process.env.WEBKIT_PATH:process.env.CHROME_PATH});try{
 const page=await browser.newPage({viewport:{width:1500,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.text().startsWith('QUEUE '))console.log(m.text());});
 await page.goto(pathToFileURL(path.resolve(__dirname,'../index.html')).href);await page.waitForFunction(()=>StripeMaker.sheets.ready);await page.locator('#blankSheet').evaluate(b=>b.click());await page.waitForFunction(()=>StripeMaker.sheets.selected);
 await page.evaluate(f=>{const A=StripeMaker,s=A.sheets.selected;Object.assign(s,f.data);A.settings.set('simulationTemperature',f.settings.simulationTemperature);const i=s.intersections[0];s.view={x:850-i.x*.12,y:450-i.y*.12,scale:.12,fitted:false};A.sheets.zoomBy(1);A.roadEditor.render();A.showEditor('simulatorEditor');},fixture);
 await page.clock.install();await page.click('#playSimulation');
 const report=await page.evaluate(({seconds,seed})=>{
  const A=StripeMaker,e=A.simulator.signalEngine(),B=A.simulatorDrivers,V=A.simulatorVehicles;e.reset();let state=seed;e.random=()=>((state=(Math.imul(state,1664525)+1013904223)>>>0)/4294967296);e.recoverStuck=()=>{};A.simulator.refreshOverlay();
  const report={seed,seconds,jumps:[],yellowAcceleration:0,staleControls:0,redChanges:0,completed:0,overlaps:0,slowChanges:0,changes:0,largeGaps:[],queueLanes:{},errors:e.signals.snapshot().map(c=>c.errors)},seen=new Set();
  const step=e.driverStep,prior=new Map();
  e.driverStep=function(dt){
   const old=new Map(e.cars.map(c=>[c.id,{speed:c.speed,road:c.road,lane:c.lane,path:c.path,position:c.pathDistance,signal:c.signalControl&&{...c.signalControl},memory:{...c.signalMemory},last:prior.get(c.id)}]));
   step.call(e,dt);
   for(const c of e.cars){const o=old.get(c.id);if(!o)continue;const acceleration=(c.speed-o.speed)/dt/(e.pixelsPerFoot/.3048);
    if(o.signal?.aspect==='yellow'&&o.signal.remaining>0&&acceleration>.01)report.yellowAcceleration++;
    if(o.signal?.aspect==='red'&&o.signal.remaining>0&&Math.abs(acceleration)>c.driver.safeBraking*1.1&&report.jumps.length<80)report.jumps.push({time:e.time,id:c.id,acceleration,oldMph:o.speed/e.pixelsPerFoot/1.466667,mph:c.speed/e.pixelsPerFoot/1.466667,remainingFeet:o.signal.remaining/e.pixelsPerFoot,allowed:o.signal.allowed,last:o.last,yellowPass:o.memory.yellowPass,situation:c.situation,replanned:c.path!==o.path});
    if(c.signalControl&&!c.path.movements.includes(c.signalControl.movement))report.staleControls++;
    if(o.signal?.aspect==='red'&&c.path!==o.path)report.redChanges++;
    prior.set(c.id,{aspect:o.signal?.aspect,allowed:o.signal?.allowed,remaining:o.signal?.remaining,yellowPass:o.memory.yellowPass});
   }
  };
  const route=e.sources.get('1:0').routes.find(r=>r.path.movements.some(m=>Math.abs(((m.junction.exitAngle-m.junction.angle+360)%360)-180)<30)&&!r.path.maneuvers.length);
  report.route=route&&{key:route.key,roads:[...new Set(route.path.points.map(p=>p.road).filter(r=>r!=null))]};
  if(route){const m=route.path.movements[0],at=m.start-100*e.pixelsPerFoot,pose=V.position(route.path,at),car={id:-1,source:'1:0',route,path:route.path,pathDistance:at,distance:at,...pose,driver:B.profile(()=>.5,0),committed:new Set(),speed:1*e.pixelsPerFoot,decisionAt:0};
   report.slowProbe={road:car.road,lane:car.lane,targets:route.passing(car).map(target=>{const points=route.replan({car,target,driver:car.driver,cars:[],random:()=>.5,speed:e.speed});const stopped=route.replan({car:{...car,speed:0},target,driver:car.driver,cars:[],random:()=>.5,speed:e.speed});return {target,allowed:B.safe(car,[],target,e.speed,e.pixelsPerFoot).allowed,plan:!!points,stoppedPlan:!!stopped,changes:points&&V.preparePath(points).maneuvers.length};})};
  }
  for(let tick=0;tick<seconds*10;tick++){
   const before=new Set(e.cars.map(c=>c.id));e.advance(.1);const alive=new Set(e.cars.map(c=>c.id));for(const id of before)if(!alive.has(id))report.completed++;
   for(const c of e.cars){if(c.laneChange?.progress>0&&!seen.has(c.path)){seen.add(c.path);report.changes++;if(c.speed<5*1.466667*e.pixelsPerFoot)report.slowChanges++;}
    if(tick%10||c.speed>1*e.pixelsPerFoot||c.road==null)continue;
    const key=c.road+':'+c.lane;report.queueLanes[key]=(report.queueLanes[key]??0)+1;
    const n=B.neighbors(c,e.cars).front,gap=B.gap(c,n,e.pixelsPerFoot)/e.pixelsPerFoot;
    if(n&&gap>20&&report.largeGaps.length<100)report.largeGaps.push({time:e.time,id:c.id,road:c.road,lane:c.lane,gap,leader:n.car.id,situation:c.situation,change:c.laneChange,pending:c.path.maneuvers.find(m=>m.end>c.pathDistance&&!c.committed.has(m)),distance:c.pathDistance});
   }
   if(tick%5===0){const C=A.simulatorCollisions,w=C.scene(e.cars,e.pixelsPerFoot);for(const c of e.cars)report.overlaps+=w.query(C.bounds(c,0,e.pixelsPerFoot)).filter(o=>o.id>c.id&&C.overlap(c,o,e.pixelsPerFoot)).length;}
   if(tick%300===0)console.log('QUEUE '+JSON.stringify({time:e.time,cars:e.cars.length,completed:report.completed,changes:report.changes,gaps:report.largeGaps.length}));
  }
  report.interventions=e.collisionInterventions;report.watchdog=e.watchdogRemovals;
  // Controlled red: six stopped through drivers, spaced 100 ft apart, start in one lane of
  // the saved three-lane approach. No arrivals or phase changes obscure whether
  // the actual playback engine can use the empty neighboring lanes.
  e.driverStep=step;e.reset();for(const source of e.sources.values()){source.rate=0;source.pending=0;source.candidate=null;}
  for(const r of e.signals.records.values()){for(const ring of r.controller.rings)ring.state='red';r.controller.step=()=>{};}
  const ppf=e.pixelsPerFoot,driver=B.profile(()=>.5,0),half=B.length({laneWidth:12*ppf},ppf)/2;
  const movement=route.path.movements[0],at=(movement.control?.distance??movement.start)-half;
  e.cars=Array.from({length:6},(_,n)=>{const car={id:1000+n,source:'1:0',route,path:route.path,pathDistance:at-100*ppf*n,distance:at-100*ppf*n,speed:0,driver:{...driver},committed:new Set(),decisionAt:0};e.updateCar(car);e.signals.observe(car);return car;});
  const packing={overlaps:0,crossed:0,lanes:[],cars:[]};
  for(let tick=0;tick<600;tick++){e.advance(.1);const C=A.simulatorCollisions,w=C.scene(e.cars,ppf);for(const c of e.cars){packing.overlaps+=w.query(C.bounds(c,0,ppf)).filter(o=>o.id>c.id&&C.overlap(c,o,ppf)).length;if(c.intersection!=null)packing.crossed++;}}
  packing.cars=e.cars.map(c=>{
   const m=c.laneChange;let cleared=!m;
   if(m){const box=A.simulatorCollisions.box(c,ppf),dx=m.toX-m.fromX,dy=m.toY-m.fromY,l=Math.hypot(dx,dy),x=dx/l,y=dy/l,extent=box.half*Math.abs(box.u.x*x+box.u.y*y)+box.side*Math.abs(box.v.x*x+box.v.y*y);cleared=(c.x-m.fromX)*x+(c.y-m.fromY)*y-extent>m.fromWidth/2;}
   return {id:c.id,lane:m&&cleared?m.to:c.lane,cleared,speed:c.speed,remaining:c.signalControl.remaining/ppf,progress:m?.progress,sameTurns:A.simulatorRouting.sameTurns(c.path.points,route.path.movements)};
  });packing.lanes=[...new Set(packing.cars.map(c=>c.lane))].sort();packing.interventions=e.collisionInterventions;report.packing=packing;
  return report;
 },{seconds:Number(process.env.SECONDS||360),seed:Number(process.env.SEED||7)});
 fs.writeFileSync(process.env.REPORT||'/tmp/stripemaker-signal-queues.json',JSON.stringify(report,null,2));console.log(JSON.stringify({...report,largeGaps:report.largeGaps.slice(0,2),jumps:report.jumps.slice(0,4)}));assert.deepEqual(errors,[]);assert.equal(report.overlaps,0);if(!process.env.BASELINE){assert(report.slowProbe.targets.some(t=>t.plan),'slow car can change among legal through lanes near the signal');assert(report.slowProbe.targets.some(t=>t.stoppedPlan),'a stopped car can plan into a clear legal lane');assert.equal(report.slowProbe.targets.find(t=>t.target===0)?.plan,false,'through driver avoids the left-turn-only lane');if(report.seconds>=180){assert(report.slowChanges>0,'actual low-speed changes occur in playback');assert(report.completed>30,'traffic continues completing trips');}assert.equal(report.yellowAcceleration,0,'steady yellow never triggers acceleration to beat red');assert.equal(report.staleControls,0,'replanning immediately refreshes signal observations');assert.equal(report.jumps.filter(j=>j.oldMph>5&&j.last?.aspect==='yellow'&&j.situation.reason==='stopping-control').length,0,'red does not suddenly clamp a driver that should have stopped on yellow');assert.equal(report.packing.overlaps,0);assert.equal(report.packing.interventions,0);assert.equal(report.packing.crossed,0);assert.deepEqual(report.packing.lanes,[1,2,3],'stopped through traffic uses all three legal lanes during red');assert(report.packing.cars.every(c=>c.cleared),'no car remains straddling the packed queues');assert(report.packing.cars.every(c=>c.sameTurns),'queue redistribution preserves the next movement');assert.equal(report.interventions,0);assert.equal(report.watchdog,0);assert(report.errors.every(e=>!e?.length));} 
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
