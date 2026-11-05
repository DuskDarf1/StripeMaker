/* Saved stuck.json geometry/settings; watchdog disabled to test prevention. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const P=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const webkit=process.env.BROWSER==='webkit',executablePath=webkit?process.env.WEBKIT_PATH:process.env.CHROME_PATH;
 const browser=await P[webkit?'webkit':'chromium'].launch({headless:true,...(executablePath?{executablePath}:{})});
 try{
  const page=await browser.newPage({viewport:{width:1400,height:1000}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',message=>{if(message.text().startsWith('STUCK-RUN'))console.log(message.text());});
  await page.goto(process.env.STRIPEMAKER_URL||pathToFileURL(path.resolve(__dirname,'../index.html')).href);
  await page.waitForFunction(()=>StripeMaker.sheets.ready);
  await page.click('button[aria-controls="sheetsMenu"]');await page.click('#blankSheet');
  await page.waitForFunction(()=>StripeMaker.sheets.selected);
  const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/simulator-six-minute-stuck.json')));
  await page.evaluate(data=>{
   const A=StripeMaker,s=A.sheets.selected;StripeMaker.settings.set('simulationTemperature',0);Object.assign(s,data.data);Object.assign(A.sheets.selected,{speedZones:A.sheets.selected.roads.map(road=>({id:'test-speed-'+road.id,road:road.id,from:0,to:1,mph:data.settings.simulationSpeed}))});
   s.view={x:120,y:100,scale:.65};A.sheets.zoomBy(1);A.roadEditor.render();A.showEditor('simulatorEditor');
   const advance=A.simulatorVehicles.Engine.prototype.advance;
   A.simulatorVehicles.Engine.prototype.advance=function(seconds){window.testEngine=this;return advance.call(this,seconds);};
  },fixture);
  await page.clock.install();await page.click('#playSimulation');
  const seeds=(process.env.SEEDS||'123,7').split(',').map(Number);
  const reports=await page.evaluate(seeds=>{
   const A=StripeMaker,e=testEngine,reports=[];e.recoverStuck=()=>{};
   for(const seed of seeds){
    let state=seed;e.reset();e.random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};A.simulator.refreshOverlay();
    const stopped=new Map(),ringStops=new Map();let maxStopped=0,maxRingStopped=0,overlaps=0,exitObservations=0,completed=0;
    for(let i=0;i<8400;i++){
     const before=new Set(e.cars.map(c=>c.id));e.advance(.05);
     const alive=new Set(e.cars.map(c=>c.id));completed += [...before].filter(id=>!alive.has(id)).length;
     const C=A.simulatorCollisions,world=C.scene(e.cars,e.pixelsPerFoot);
     if(i%1200===1199)console.log(`STUCK-RUN seed=${seed} seconds=${e.time.toFixed(0)} active=${e.cars.length} completed=${completed} ringStop=${maxRingStopped.toFixed(2)} overlaps=${overlaps}`);
     for(const c of e.cars){
      overlaps+=world.query(C.bounds(c,0,e.pixelsPerFoot)).filter(other=>other.id>c.id&&C.overlap(c,other,e.pixelsPerFoot)).length;
      if(c.circulating&&c.speed<.1){const since=ringStops.get(c.id)??e.time;ringStops.set(c.id,since);maxRingStopped=Math.max(maxRingStopped,e.time-since);}else ringStops.delete(c.id);
      if((c.roundaboutPhase==='exit'||c.road===1)&&c.x>170&&c.x<280&&c.y>500&&c.y<590){
       exitObservations++;
       if(c.speed<.1){const since=stopped.get(c.id)??e.time;stopped.set(c.id,since);maxStopped=Math.max(maxStopped,e.time-since);}
       else stopped.delete(c.id);
      }else stopped.delete(c.id);
     }
     if(maxRingStopped>2)throw Error(JSON.stringify({seed,time:e.time,cars:e.cars.map(c=>({id:c.id,source:c.source,d:c.pathDistance,x:c.x,y:c.y,speed:c.speed,phase:c.roundaboutPhase,reservation:c.reservation,situation:c.situation,movement:c.path.movements}))}));
    }
    reports.push({seed,maxStopped,maxRingStopped,overlaps,interventions:e.collisionInterventions,exitObservations,completed,time:e.time});
   }
   return reports;
  },seeds);
  console.log(JSON.stringify(reports));
  for(const report of reports){assert.equal(report.overlaps,0,'vehicle bodies never overlap');assert(report.maxRingStopped<1,'no phantom stops or deadlocks inside the circulating ring');assert(report.exitObservations>100,'cars actually traverse the problematic exit');assert(report.completed>30,'traffic continues leaving the network');assert(report.maxStopped<1,`seed ${report.seed}: no spurious stop at the left exit (${report.maxStopped}s)`);}
  await page.clock.runFor(20);await page.screenshot({path:'/tmp/stripemaker-six-minute-stuck-fixed.png'});
  assert.deepEqual(errors,[]);
  console.log(`PASS ${webkit?'WebKit':'Chromium'} stuck.json, ${seeds.length} seeds × 420 simulated seconds, watchdog disabled: ${JSON.stringify(reports)}`);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
