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
  const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/simulator-stop-priority.json')));
  await page.evaluate(data=>{
   const A=StripeMaker,s=A.sheets.selected;StripeMaker.settings.set('simulationTemperature',0);Object.assign(s,data.data);Object.assign(A.sheets.selected,{speedZones:A.sheets.selected.roads.map(road=>({id:'test-speed-'+road.id,road:road.id,from:0,to:1,mph:data.settings.simulationSpeed}))});
   s.view={x:120,y:100,scale:.65};A.sheets.zoomBy(1);A.roadEditor.render();A.showEditor('simulatorEditor');
   const advance=A.simulatorVehicles.Engine.prototype.advance;
   A.simulatorVehicles.Engine.prototype.advance=function(seconds){window.testEngine=this;return advance.call(this,seconds);};
  },fixture);
  await page.clock.install();await page.click('#playSimulation');
  const report=await page.evaluate(()=>{
   const A=StripeMaker,e=testEngine; e.recoverStuck=()=>{};e.reset();let state=123;e.random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};A.simulator.refreshOverlay();
   const report={stops:0,violations:0,completed:{},overlaps:0,joinedLaneStall:0};const stopped=new Set(),stall=new Map(),waiting=new Set(),departed=new Set();
   for(let i=0;i<9600;i++){
    // Clear the major stream after five minutes; waiting minor traffic must
    // then proceed rather than retaining a phantom crossing reservation.
    if(i===6000)for(const c of e.cars)if(['13:0','16:0'].includes(c.source)&&c.speed<.01)waiting.add(c.id);
    if(i===6000)for(const source of e.sources.values())if(['1:0','2:0'].includes(source.key)){source.rate=0;source.nextAt=Infinity;source.pending=0;source.candidate=null;}
    const before=new Map(e.cars.map(c=>[c.id,c]));e.advance(.05);const alive=new Set(e.cars.map(c=>c.id));
    for(const [id,c] of before)if(!alive.has(id)){report.completed[c.source]=(report.completed[c.source]??0)+1;departed.add(id);}
    const C=A.simulatorCollisions,w=C.scene(e.cars,e.pixelsPerFoot);
    for(const c of e.cars){
     const half=C.width(c,e.pixelsPerFoot)*381/214/2;
     for(const bar of c.path.controls){if(c.stops?.has(bar.marking))stopped.add(c.id);if(c.pathDistance+half>bar.distance+.01&&!c.stops?.has(bar.marking))report.violations++;}
     report.overlaps+=w.query(C.bounds(c,0,e.pixelsPerFoot)).filter(o=>o.id>c.id&&C.overlap(c,o,e.pixelsPerFoot)).length;
     if(c.situation?.collision!=null&&c.speed<.01){const since=stall.get(c.id)??e.time;stall.set(c.id,since);report.joinedLaneStall=Math.max(report.joinedLaneStall,e.time-since);}else stall.delete(c.id);
    }
   }
   report.stops=stopped.size;report.time=e.time;report.watchdog=e.watchdogRemovals??0;
   report.waitingBeforeClear=[...waiting];report.waitersStillPresent=[...waiting].filter(id=>!departed.has(id));
   report.remainingMajor=e.cars.filter(c=>['1:0','2:0'].includes(c.source)).length;return report;
  });
  console.log(JSON.stringify(report));assert.equal(report.violations,0);assert.equal(report.overlaps,0);assert.equal(report.watchdog,0);
  assert(report.stops>10,'minor traffic actually stops at controls');assert((report.completed['1:0']??0)>20&&(report.completed['2:0']??0)>20,'both major approaches keep flowing');
  assert((report.completed['13:0']??0)>0&&(report.completed['16:0']??0)>0,'both controlled approaches use clear gaps');assert.equal(report.remainingMajor,0,'major queues drain');assert(report.waitingBeforeClear.length>0);assert.deepEqual(report.waitersStillPresent,[],'vehicles waiting at STOP controls before clearing the major stream all proceed');
  assert(report.joinedLaneStall<2,'adjacent approach lanes never lock at semantic joins');assert.deepEqual(errors,[]);
  console.log(`PASS ${webkit?'WebKit':'Chromium'} saved STOP-priority sheet, eight simulated minutes, exact bar compliance, clear-gap recovery and no body overlaps; watchdog disabled.`);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
