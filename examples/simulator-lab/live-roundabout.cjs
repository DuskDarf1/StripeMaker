/* Real frames and clock lag on the populated saved roundabout; isolated storage. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const P=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const webkit=process.env.BROWSER==='webkit',executablePath=webkit?process.env.WEBKIT_PATH:process.env.CHROME_PATH;
 const browser=await P[webkit?'webkit':'chromium'].launch({headless:true,...(executablePath?{executablePath}:{})});
 try{
  const page=await browser.newPage({viewport:{width:1400,height:1000}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',message=>{if(message.text().startsWith('STUCK-RUN'))console.log(message.text());});
  await page.goto(process.env.STRIPEMAKER_URL||pathToFileURL(path.resolve(__dirname,'../../index.html')).href);
  await page.waitForFunction(()=>StripeMaker.sheets.ready);
  await page.click('button[aria-controls="sheetsMenu"]');await page.click('#blankSheet');
  await page.waitForFunction(()=>StripeMaker.sheets.selected);
  const fixture=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../tests/fixtures/simulator-six-minute-stuck.json')));
  fixture.playbackRate=Number(process.env.PLAYBACK_RATE||1);fixture.overlayMode=process.env.OVERLAY||'none';
  await page.evaluate(data=>{
   const A=StripeMaker,s=A.sheets.selected;StripeMaker.settings.set('simulationTemperature',0);Object.assign(s,data.data);Object.assign(A.sheets.selected,{speedZones:A.sheets.selected.roads.map(road=>({id:'lab-speed-'+road.id,road:road.id,from:0,to:1,mph:data.settings.simulationSpeed}))});A.settings.set('simulationPlaybackRate',data.playbackRate);A.settings.set('simulationOverlay',data.overlayMode);
   s.view={x:120,y:100,scale:.65};A.sheets.zoomBy(1);A.roadEditor.render();A.showEditor('simulatorEditor');
   const advance=A.simulatorVehicles.Engine.prototype.advance;
   A.simulatorVehicles.Engine.prototype.advance=function(seconds){window.testEngine=this;return advance.call(this,seconds);};
  },fixture);
  await page.click('#playSimulation');await page.waitForFunction(()=>window.testEngine);
  await page.evaluate(()=>{let seed=123;testEngine.random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};testEngine.reset();StripeMaker.simulator.refreshOverlay();testEngine.advance(120);});
  await page.waitForTimeout(1000);
  const initial=await page.evaluate(()=>{window.frames=[];let previous;function sample(t){if(previous)frames.push(t-previous);previous=t;requestAnimationFrame(sample);}requestAnimationFrame(sample);return testEngine.time;});
  const started=Date.now();await page.waitForTimeout(Number(process.env.DURATION_MS||15000));
  const report=await page.evaluate(initial=>{const sorted=frames.sort((a,b)=>a-b);return {overlayMode:StripeMaker.settings.get("simulationOverlay"),playbackRate:StripeMaker.settings.get("simulationPlaybackRate"),p50:sorted[Math.floor(sorted.length*.5)],p95:sorted[Math.floor(sorted.length*.95)],simulationSeconds:testEngine.time-initial,cars:testEngine.cars.length};},initial);
  report.wallSeconds=(Date.now()-started)/1000;report.errors=errors;const output=process.env.REPORT||"/tmp/stripemaker-roundabout-live.json";fs.writeFileSync(output,JSON.stringify(report,null,2)+"\n");console.log(JSON.stringify(report));
  assert.deepEqual(errors,[]);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
