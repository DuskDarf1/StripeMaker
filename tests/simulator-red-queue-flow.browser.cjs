/* Saved signal.json geometry; isolated seeded playback with recovery disabled. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
const P=require(process.env.PLAYWRIGHT_MODULE||'playwright'),fixture=require('./fixtures/simulator-red-queues.json');
(async()=>{const webkit=process.env.BROWSER==='webkit',browser=await P[webkit?'webkit':'chromium'].launch({headless:true,executablePath:webkit?process.env.WEBKIT_PATH:process.env.CHROME_PATH});try{
 const page=await browser.newPage({viewport:{width:1500,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.text().startsWith('QUEUE '))console.log(m.text());});
 await page.goto(pathToFileURL(path.resolve(__dirname,'../index.html')).href);await page.waitForFunction(()=>StripeMaker.sheets.ready);await page.locator('#blankSheet').evaluate(b=>b.click());await page.waitForFunction(()=>StripeMaker.sheets.selected);
 await page.evaluate(f=>{const A=StripeMaker,s=A.sheets.selected;Object.assign(s,f.data);A.settings.set('simulationTemperature',f.settings.simulationTemperature);const i=s.intersections[0];s.view={x:850-i.x*.12,y:450-i.y*.12,scale:.12,fitted:false};A.sheets.zoomBy(1);A.roadEditor.render();A.showEditor('simulatorEditor');},fixture);
 await page.clock.install();await page.click('#playSimulation');
 const report=await page.evaluate(()=>{
  const A=StripeMaker,e=A.simulator.signalEngine(),B=A.simulatorDrivers,C=A.simulatorCollisions;e.reset();let seed=7;e.random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);e.recoverStuck=()=>{};A.simulator.refreshOverlay();
  for(const source of e.sources.values()){
   if(source.key!=='1:0'){source.rate=0;continue;}
   source.routes=source.routes.filter(r=>r.path.movements.some(m=>A.simulatorSignals.movementType(m)==='through')&&!r.path.maneuvers.length);source.rate=20;
  }
  for(const r of e.signals.records.values()){for(const ring of r.controller.rings)ring.state='red';r.controller.step=()=>{};}
  const route=e.sources.get('1:0').routes[0],ppf=e.pixelsPerFoot,at=route.path.movements[0].start-600*ppf;
  const probe=(id,distance,speed)=>{const c={id,route,path:route.path,pathDistance:distance,distance,speed,driver:B.profile(()=>.5,0),committed:new Set(),decisionAt:0};e.updateCar(c);e.signals.observe(c);return c;};
  const me=probe(-1,at,30*ppf),front=probe(-2,at+200*ppf,0),probeCars=[me,front];B.indexCars(probeCars);
  const plan=()=>route.replan({car:me,target:2,driver:me.driver,cars:probeCars,random:()=>.5,speed:e.speed});
  const blocked=!!plan();front.speed=40*ppf;const moving=!!plan();
  let overlaps=0,crossed=0;
  for(let tick=0;tick<1800;tick++){
   if(tick===1200)for(const source of e.sources.values()){source.rate=0;source.pending=0;source.candidate=null;}
   e.advance(.1);if(tick%5===0){const w=C.scene(e.cars,e.pixelsPerFoot);for(const car of e.cars){overlaps+=w.query(C.bounds(car,0,e.pixelsPerFoot)).filter(o=>o.id>car.id&&C.overlap(car,o,e.pixelsPerFoot)).length;if(car.intersection!=null)crossed++;}}
  }
  const cars=e.cars.map(c=>{const n=B.neighbors(c,e.cars).front,lead=B.leader(c,e.cars,e.pixelsPerFoot,e.speed);return {id:c.id,road:c.road,lane:c.lane,speed:c.speed/e.pixelsPerFoot,remaining:c.signalControl?.remaining/e.pixelsPerFoot,change:c.laneChange,station:c.station/e.pixelsPerFoot,leader:lead?.car.id,gap:lead?.gap/e.pixelsPerFoot,laneLeader:n?.car.id,laneGap:B.gap(c,n,e.pixelsPerFoot)/e.pixelsPerFoot,situation:c.situation};});
  return {probe:{blocked,moving},cars,overlaps,crossed,interventions:e.collisionInterventions,watchdog:e.watchdogRemovals,time:e.time};
 });
 fs.writeFileSync(process.env.REPORT||'/tmp/stripemaker-red-queue-flow.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));assert.deepEqual(errors,[]);assert.equal(report.overlaps,0);assert.equal(report.crossed,0);assert.equal(report.interventions,0);assert.equal(report.watchdog,0);
 assert.equal(report.probe.blocked,false,'do not start a maneuver that will stop across both queues');assert(report.probe.moving,'moving leaders contribute bounded stopping room');
 assert(report.cars.length>=40);assert(report.cars.every(c=>c.road===11&&c.speed<.2),'arrivals settle on the approach');
 assert.deepEqual([...new Set(report.cars.map(c=>c.lane))].sort(),[1,2,3]);
 assert(report.cars.every(c=>!c.change),'no unfinished lane changes obstruct the settled queues');
 assert(report.cars.every(c=>c.laneLeader==null||c.laneGap<10),'no unused interior gaps larger than ten feet');
 for(const lane of [1,2,3])assert(Math.min(...report.cars.filter(c=>c.lane===lane).map(c=>c.remaining))<.1,'each queue reaches the stop line');console.log('PASS arriving red queues: three occupied lanes, no unfinished maneuvers, continuous standstill gaps and zero collision interventions.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
