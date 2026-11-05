/* Geometry-only repro from the roundabout-exit stopping project. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const P=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const webkit=process.env.BROWSER==='webkit',executablePath=webkit?process.env.WEBKIT_PATH:process.env.CHROME_PATH;
 const browser=await P[webkit?'webkit':'chromium'].launch({headless:true,...(executablePath?{executablePath}:{})});
 try{
  const page=await browser.newPage({viewport:{width:1400,height:1000}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.STRIPEMAKER_URL||pathToFileURL(path.resolve(__dirname,'../index.html')).href);
  await page.waitForFunction(()=>StripeMaker.sheets.ready);
  await page.click('button[aria-controls="sheetsMenu"]');await page.click('#blankSheet');
  await page.waitForFunction(()=>StripeMaker.sheets.selected);
  const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/simulator-roundabout-exit-stop.json')));
  await page.evaluate(data=>{
   const A=StripeMaker,s=A.sheets.selected;StripeMaker.settings.set('simulationTemperature',0);Object.assign(s,data);Object.assign(A.sheets.selected,{speedZones:A.sheets.selected.roads.map(road=>({id:'test-speed-'+road.id,road:road.id,from:0,to:1,mph:35}))});
   s.view={x:120,y:100,scale:.65};A.sheets.zoomBy(1);A.roadEditor.render();A.showEditor('simulatorEditor');
   const advance=A.simulatorVehicles.Engine.prototype.advance;
   A.simulatorVehicles.Engine.prototype.advance=function(seconds){window.testEngine=this;return advance.call(this,seconds);};
  },fixture);
  await page.clock.install();await page.click('#playSimulation');
  const reports=await page.evaluate(()=>{
   const A=StripeMaker,e=testEngine,reports=[];
   for(const seed of [123,42,7]){
    let state=seed;e.reset();e.random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};A.simulator.refreshOverlay();
    const stopped=new Map(),ringStops=new Map();let maxStopped=0,maxRingStopped=0,overlaps=0,exitObservations=0,completed=0;
    for(let i=0;i<3600;i++){
     const before=new Set(e.cars.map(c=>c.id));e.advance(.05);
     const alive=new Set(e.cars.map(c=>c.id));completed += [...before].filter(id=>!alive.has(id)).length;
     const C=A.simulatorCollisions,world=C.scene(e.cars,e.pixelsPerFoot);
     for(const c of e.cars){
      overlaps+=world.query(C.bounds(c,0,e.pixelsPerFoot)).filter(other=>other.id>c.id&&C.overlap(c,other,e.pixelsPerFoot)).length;
      if(c.circulating&&c.speed<.1){const since=ringStops.get(c.id)??e.time;ringStops.set(c.id,since);maxRingStopped=Math.max(maxRingStopped,e.time-since);}else ringStops.delete(c.id);
      if((c.roundaboutPhase==='exit'||c.road===1)&&c.x>170&&c.x<280&&c.y>500&&c.y<590){
       exitObservations++;
       if(c.speed<.1){const since=stopped.get(c.id)??e.time;stopped.set(c.id,since);maxStopped=Math.max(maxStopped,e.time-since);}
       else stopped.delete(c.id);
      }else stopped.delete(c.id);
     }
    }
    reports.push({seed,maxStopped,maxRingStopped,overlaps,interventions:e.collisionInterventions,exitObservations,completed,time:e.time});
   }
   return reports;
  });
  console.log(JSON.stringify(reports));
  for(const report of reports){assert.equal(report.overlaps,0,'vehicle bodies never overlap');assert(report.maxRingStopped<1,'no phantom stops or deadlocks inside the circulating ring');assert(report.exitObservations>100,'cars actually traverse the problematic exit');assert(report.completed>50,'traffic continues leaving the network');assert(report.maxStopped<1,`seed ${report.seed}: no spurious stop at the left exit (${report.maxStopped}s)`);}
  await page.clock.runFor(20);await page.screenshot({path:'/tmp/stripemaker-roundabout-exit-fixed.png'});
  assert.deepEqual(errors,[]);
  console.log(`PASS ${webkit?'WebKit':'Chromium'} roundabout exit, 3 seeds × 180 simulated seconds: ${JSON.stringify(reports)}`);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
