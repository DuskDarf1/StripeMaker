/* Any saved sheet fixture at realistic load: deterministic physics fingerprint,
   real frames and optional CPU profile. FIXTURE (default: the minor-road U-turn
   signal sheet), DEMAND (multiplies every entrance; default 4 reaches ~100
   cars), WARM_SECONDS, SEED, PLAYBACK_RATE, OVERLAYS, DURATION_MS, PROFILE=1. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createHash}=require('node:crypto'),{pathToFileURL}=require('node:url');
const P=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const webkit=process.env.BROWSER==='webkit',executablePath=webkit?process.env.WEBKIT_PATH:process.env.CHROME_PATH;
 const browser=await P[webkit?'webkit':'chromium'].launch({headless:true,...(executablePath?{executablePath}:{})});
 const output=process.env.REPORT||'/tmp/stripemaker-sheet-live.json';
 try{
  const page=await browser.newPage({viewport:{width:1400,height:1000}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  const started=performance.now();
  await page.goto(process.env.STRIPEMAKER_URL||pathToFileURL(path.resolve(__dirname,'../../index.html')).href);
  await page.waitForFunction(()=>StripeMaker.sheets.ready);
  await page.click('button[aria-controls="sheetsMenu"]');await page.click('#blankSheet');
  await page.waitForFunction(()=>StripeMaker.sheets.selected);
  const fixture=JSON.parse(fs.readFileSync(path.resolve(process.env.FIXTURE||path.resolve(__dirname,'../../tests/fixtures/simulator-minor-road-uturn.json'))));
  const options={seed:Number(process.env.SEED||7),warm:Number(process.env.WARM_SECONDS||240),demand:Number(process.env.DEMAND||4),temperature:Number(process.env.TEMPERATURE||fixture.settings?.simulationTemperature||40),rate:Number(process.env.PLAYBACK_RATE||1),overlays:(process.env.OVERLAYS||'').split(',').filter(Boolean)};
  await page.evaluate(({fixture,options})=>{
   const A=StripeMaker,s=A.sheets.selected;Object.assign(s,fixture.data);
   s.vehicleSpawns=(s.vehicleSpawns??[]).map(x=>({...x,rate:(x.rate??12)*options.demand}));
   A.settings.set('simulationTemperature',options.temperature);A.settings.set('simulationPlaybackRate',options.rate);A.settings.set('simulationOverlays',options.overlays);
   const pts=s.joints,box=document.getElementById('previewStage').getBoundingClientRect(),x0=Math.min(...pts.map(p=>p.x)),x1=Math.max(...pts.map(p=>p.x)),y0=Math.min(...pts.map(p=>p.y)),y1=Math.max(...pts.map(p=>p.y));
   const scale=Math.min((box.width-80)/Math.max(1,x1-x0),(box.height-80)/Math.max(1,y1-y0));
   s.view={x:box.width/2-(x0+x1)/2*scale,y:box.height/2-(y0+y1)/2*scale,scale};A.sheets.zoomBy(1);A.roadEditor.render();A.showEditor('simulatorEditor');
   window.manual=true;window.physics=[];window.advances=[];
   const E=A.simulatorVehicles.Engine,advance=E.prototype.advance,step=E.prototype.driverStep;
   window.originalAdvance=advance;
   E.prototype.advance=function(seconds){window.testEngine=this;if(manual)return;const t=performance.now();const result=advance.call(this,seconds);advances.push(performance.now()-t);return result;};
   E.prototype.driverStep=function(dt){const t=performance.now();const result=step.call(this,dt);physics.push(performance.now()-t);return result;};
  },{fixture,options});
  await page.click('#playSimulation');await page.waitForFunction(()=>window.testEngine);
  const setupMs=performance.now()-started;
  let session;
  if(process.env.PROFILE==='1'&&!webkit){session=await page.context().newCDPSession(page);await session.send('Profiler.enable');await session.send('Profiler.start');}
  const warm=await page.evaluate(options=>{
   const e=testEngine;let state=options.seed;e.random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};e.reset();e.nextId=1;e.recoverStuck=()=>{};StripeMaker.simulator.refreshOverlay();
   const start=performance.now();originalAdvance.call(e,options.warm);
   return {wallMs:performance.now()-start,physicsMs:physics.reduce((a,b)=>a+b,0),steps:physics.length,
    snapshot:{time:e.time,nextId:e.nextId,interventions:e.collisionInterventions,cars:e.cars.map(c=>({id:c.id,source:c.source,distance:c.distance,speed:c.speed,x:c.x,y:c.y,road:c.road,lane:c.lane,change:c.laneChange})),sources:[...e.sources.values()].map(s=>({key:s.key,nextAt:s.nextAt,pending:s.pending,candidate:s.candidate?.id}))}};
  },options);
  if(session){const {profile}=await session.send('Profiler.stop');fs.writeFileSync(output.replace(/\.json$/,'.cpuprofile'),JSON.stringify(profile));await session.detach();}
  fs.writeFileSync(output.replace(/\.json$/,'.warm.json'),JSON.stringify(warm.snapshot,null,2));
  const fingerprint=createHash('sha256').update(JSON.stringify(warm.snapshot)).digest('hex');
  await page.evaluate(()=>{manual=false;});await page.waitForTimeout(500);
  await page.evaluate(()=>{
   window.frames=[];window.physics=[];window.advances=[];window.longTasks=[];
   window.longTasksSupported=PerformanceObserver.supportedEntryTypes.includes('longtask');
   if(longTasksSupported)new PerformanceObserver(list=>longTasks.push(...list.getEntries().map(e=>e.duration))).observe({type:'longtask'});
   window.liveStart={wall:performance.now(),time:testEngine.time};let previous;
   function frame(now){if(previous)frames.push(now-previous);previous=now;requestAnimationFrame(frame);}requestAnimationFrame(frame);
  });
  // PROFILE=live records the animated phase (rendering, overlays, physics).
  let liveSession;
  if(process.env.PROFILE==='live'&&!webkit){liveSession=await page.context().newCDPSession(page);await liveSession.send('Profiler.enable');await liveSession.send('Profiler.start');}
  await page.waitForTimeout(Number(process.env.DURATION_MS||15000));
  if(liveSession){const {profile}=await liveSession.send('Profiler.stop');fs.writeFileSync(output.replace(/\.json$/,'.live.cpuprofile'),JSON.stringify(profile));await liveSession.detach();}
  const live=await page.evaluate(()=>{
   manual=true;
   const stats=values=>{const v=values.slice().sort((a,b)=>a-b);return {count:v.length,totalMs:v.reduce((a,b)=>a+b,0),p50ms:v[Math.floor(v.length*.5)]??0,p95ms:v[Math.floor(v.length*.95)]??0,maxms:v.at(-1)??0};};
   const box=document.getElementById('previewStage').getBoundingClientRect(),visible=testEngine.cars.filter(c=>{const p=StripeMaker.sheets.toScreen(c);return p.x>=0&&p.y>=0&&p.x<=box.width&&p.y<=box.height;}).length;
   return {frames:stats(frames),physics:stats(physics),advance:stats(advances),longTasks:{supported:longTasksSupported,...stats(longTasks)},simulationSeconds:testEngine.time-liveStart.time,wallSeconds:(performance.now()-liveStart.wall)/1000,cars:testEngine.cars.length,visibleCars:visible};
  });
  const report={scenario:path.basename(process.env.FIXTURE||'simulator-minor-road-uturn.json'),view:'whole-sheet',browser:webkit?'webkit':'chromium',...options,setupMs,warm:{simulationSeconds:warm.snapshot.time,wallMs:warm.wallMs,physicsMs:warm.physicsMs,steps:warm.steps,cars:warm.snapshot.cars.length,fingerprint},live,errors};
  fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');await page.screenshot({path:output.replace(/\.json$/,'.png')});console.log(JSON.stringify(report,null,2));assert.deepEqual(errors,[]);assert(live.visibleCars>0,'benchmark must render visible traffic');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
