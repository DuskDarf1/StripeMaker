/* Saved feedback sheet, actual temperature and continuous traffic; no watchdog. */
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
   const A=StripeMaker,s=A.sheets.selected;StripeMaker.settings.set('simulationTemperature',data.settings.simulationTemperature);Object.assign(s,data.data);Object.assign(A.sheets.selected,{speedZones:A.sheets.selected.roads.map(road=>({id:'test-speed-'+road.id,road:road.id,from:0,to:1,mph:data.settings.simulationSpeed}))});
   s.view={x:120,y:100,scale:.65};A.sheets.zoomBy(1);A.roadEditor.render();A.showEditor('simulatorEditor');
   const advance=A.simulatorVehicles.Engine.prototype.advance;
   A.simulatorVehicles.Engine.prototype.advance=function(seconds){window.testEngine=this;return advance.call(this,seconds);};
  },fixture);
  await page.clock.install();await page.click('#playSimulation');
  const reports=await page.evaluate(seeds=>{
   const A=StripeMaker,e=testEngine;e.recoverStuck=()=>{};const reports=[];
   for(const seed of seeds){e.reset();let state=seed;e.random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};A.simulator.refreshOverlay();
    const report={seed,temperature:e.temperature,completed:0,overlaps:0,phantomHolds:0,outerCrossings:0};const crossed=new Set();
    for(let i=0;i<7200;i++){
     const before=new Set(e.cars.map(c=>c.id));e.advance(.05);const alive=new Set(e.cars.map(c=>c.id));report.completed += [...before].filter(id=>!alive.has(id)).length;
     const C=A.simulatorCollisions,w=C.scene(e.cars,e.pixelsPerFoot);
     for(const c of e.cars){
      report.overlaps+=w.query(C.bounds(c,0,e.pixelsPerFoot)).filter(o=>o.id>c.id&&C.overlap(c,o,e.pixelsPerFoot)).length;
      const other=e.cars.find(o=>o.id===c.situation?.leader);
      if(c.situation?.reason==='yielding-entry'&&other&&other.path.movements.every(m=>m.end+C.width(other,e.pixelsPerFoot)*381/214/2<other.pathDistance)&&Math.hypot(c.x-other.x,c.y-other.y)>100*e.pixelsPerFoot)report.phantomHolds++;
      const m=c.path.movements.find(m=>m.end>=c.pathDistance);
      if(m?.junction&&['1:0','2:0'].includes(c.source)&&!m.control&&A.sheets.selected.intersections.flatMap(item=>item.approaches.map(a=>a.inLanes.at(-1))).includes(m.junction.input)&&Math.abs(((m.junction.exitAngle-m.junction.angle+540)%360)-180)>170&&c.pathDistance>m.entry&& !crossed.has(c.id)){crossed.add(c.id);report.outerCrossings++;}
     }
    }report.time=e.time;reports.push(report);
   }return reports;
  },(process.env.SEEDS||'123,7,42').split(',').map(Number));
  for(const r of reports){assert.equal(r.temperature,fixture.settings.simulationTemperature);assert.equal(r.phantomHolds,0,'no entrance hold for a leader already downstream');assert.equal(r.overlaps,0);assert(r.completed>40);assert(r.outerCrossings>20);}
  assert.deepEqual(errors,[]);console.log(`PASS ${webkit?'WebKit':'Chromium'} continuous traffic at saved temperature: ${JSON.stringify(reports)}`);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
