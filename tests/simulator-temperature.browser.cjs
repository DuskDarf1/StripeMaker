const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const P=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const webkit=process.env.BROWSER==='webkit',executablePath=webkit?process.env.WEBKIT_PATH:process.env.CHROME_PATH;
 const browser=await P[webkit?'webkit':'chromium'].launch({headless:true,...(executablePath?{executablePath}:{})});
 try{
  const page=await browser.newPage({viewport:{width:1400,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{let seed=123;Math.random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};});
  await page.goto(process.env.STRIPEMAKER_URL||pathToFileURL(path.resolve(__dirname,'../index.html')).href);
  await page.waitForFunction(()=>StripeMaker.sheets.ready);await page.click('button[aria-controls="sheetsMenu"]');await page.click('#blankSheet');
  await page.waitForFunction(()=>StripeMaker.sheets.selected);
  const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/simulator-roundabout-exit-stop.json')));
  await page.evaluate(data=>{const A=StripeMaker,s=A.sheets.selected;Object.assign(s,data);Object.assign(A.sheets.selected,{speedZones:A.sheets.selected.roads.map(road=>({id:'test-speed-'+road.id,road:road.id,from:0,to:1,mph:35}))});A.roadEditor.render();A.showEditor('simulatorEditor');const advance=A.simulatorVehicles.Engine.prototype.advance;A.simulatorVehicles.Engine.prototype.advance=function(seconds){window.testEngine=this;return advance.call(this,seconds);};},fixture);
  assert.equal(await page.locator('#simulationTemperatureValue').inputValue(),'40');assert.match(await page.locator('#simulationTemperatureHint').textContent(),/±20%.*13.3%/);
  assert.equal(await page.locator('#simulationTemperature').getAttribute('max'),'100');
  await page.fill('#simulationTemperatureValue','0');await page.locator('#simulationTemperatureValue').blur();
  await page.clock.install();await page.click('#playSimulation');
  const baseline=await page.evaluate(()=>{testEngine.advance(15);return {base:StripeMaker.simulatorDrivers.BASELINE,profiles:testEngine.cars.map(c=>c.driver)};});
  assert(baseline.profiles.length);for(const p of baseline.profiles)for(const [key,value] of Object.entries(baseline.base))assert.equal(p[key],value,key);
  for(const id of ['simulationTemperature','simulationTemperatureValue'])assert(await page.locator('#'+id).isDisabled());
  await page.click('#pauseSimulation');await page.fill('#simulationTemperatureValue','100');await page.locator('#simulationTemperatureValue').blur();
  assert.equal(await page.evaluate(()=>StripeMaker.simulator.diagnostics().cars.length),0,'paused temperature edit resets the old population');
  assert.match(await page.locator('#simulationTemperatureHint').textContent(),/±50%.*33.3%/);
  await page.click('#playSimulation');
  const stress=await page.evaluate(()=>{const A=StripeMaker,e=testEngine,C=A.simulatorCollisions,profiles=new Map();let overlaps=0,faster=false,slower=false;
   for(let i=0;i<2400;i++){e.advance(.05);const world=C.scene(e.cars,e.pixelsPerFoot);for(const c of e.cars){profiles.set(c.id,c.driver);
    overlaps+=world.query(C.bounds(c,0,e.pixelsPerFoot)).filter(other=>other.id>c.id&&C.overlap(c,other,e.pixelsPerFoot)).length;
    if(c.roundaboutPhase==='circulating'){const mph=c.desiredSpeed/e.pixelsPerFoot*3600/5280;faster ||= mph>15;slower ||= mph<15;}
   }}return {profiles:[...profiles.values()],overlaps,faster,slower,watchdog:e.watchdogRemovals??0};});
  assert.equal(stress.overlaps,0);assert(stress.profiles.some(p=>p.aggressive));assert(stress.faster&&stress.slower,'temperature varies actual roundabout speed targets above and below 15 mph');
  for(const p of stress.profiles)for(const [key,base] of Object.entries(baseline.base))assert(p[key]>=base*(['acceleration','deceleration'].includes(key)?.2:.5)-1e-8&&p[key]<=base*(['acceleration','deceleration'].includes(key)?2.734:1.5)+1e-8,key);
  await page.click('#pauseSimulation');
  const portable=await page.evaluate(()=>StripeMaker.projectJSON.snapshot());assert.equal(portable.settings.simulationTemperature,100);
  await page.evaluate(async project=>{StripeMaker.settings.set('simulationTemperature',0);await StripeMaker.projectJSON.load(project,{applySettings:false});},portable);
  assert.equal(await page.evaluate(()=>StripeMaker.settings.get('simulationTemperature')),0);
  await page.evaluate(project=>StripeMaker.projectJSON.load(project,{applySettings:true}),portable);
  assert.equal(await page.locator('#simulationTemperatureValue').inputValue(),'100');
  await page.setViewportSize({width:390,height:844});const box=await page.locator('#simulatorEditor').boundingBox();assert(box.x>=0&&box.x+box.width<=391);
  await page.waitForTimeout(650);await page.reload();await page.waitForFunction(()=>StripeMaker.sheets.ready);
  assert.equal(await page.evaluate(()=>StripeMaker.settings.get('simulationTemperature')),100);
  assert.deepEqual(errors,[]);console.log(`PASS ${webkit?'WebKit':'Chromium'} temperature: defaults, exact zero, broader acceleration/braking, quick-response mixture, variable roundabout targets, locking, persistence/import and zero overlaps (${stress.profiles.length} drivers; ${stress.watchdog} watchdog removals).`);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
