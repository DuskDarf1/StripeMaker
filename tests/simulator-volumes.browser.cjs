const assert=require('node:assert/strict'),path=require('node:path'),{pathToFileURL}=require('node:url');
const P=require(process.env.PLAYWRIGHT_MODULE||'playwright'),choose=require('./select-choice.cjs');
(async()=>{
 const webkit=process.env.BROWSER==='webkit',executablePath=webkit?process.env.WEBKIT_PATH:process.env.CHROME_PATH;
 const browser=await P[webkit?'webkit':'chromium'].launch({headless:true,...(executablePath?{executablePath}:{})});
 try{
  const page=await browser.newPage({viewport:{width:1400,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(pathToFileURL(path.resolve(__dirname,'../index.html')).href);await page.waitForFunction(()=>StripeMaker.sheets.ready);
  await page.locator('#blankSheet').evaluate(b=>b.click());await page.waitForFunction(()=>StripeMaker.sheets.selected);
  await page.evaluate(()=>{const A=StripeMaker,s=A.sheets.selected;Object.assign(s,{inchesPerPixel:2,
   roads:[{id:1,lanes:2,laneWidth:12,ends:[{joint:1,sign:1},{joint:2,sign:1}]}],
   joints:[{id:1,x:600,y:500,dir:{x:1,y:0},root:1,links:[]},{id:2,x:3000,y:500,dir:{x:1,y:0},root:1,links:[]}],
   vehicleSpawns:[{road:1,rate:12,routes:[{name:'North',exit:{road:1,lane:0,e:1},percent:75},{name:'South',exit:{road:1,lane:1,e:1},percent:25}]}],view:{x:0,y:0,scale:1}});
   A.sheets.zoomBy(1);A.roadEditor.render();A.history.rebase();A.showEditor('simulatorEditor');
   const configure=A.simulatorVehicles.Engine.prototype.configure;A.simulatorVehicles.Engine.prototype.configure=function(...args){window.volumeEngine=this;return configure.apply(this,args);};A.simulator.refreshOverlay();
  });
  await page.locator('.simulatorSpawn').click();
  const state=()=>page.evaluate(()=>structuredClone(StripeMaker.sheets.selected.vehicleSpawns[0]));
  for(const [unit,amount] of [['seconds','0.2'],['hours','720'],['days','17280'],['AADT','17280'],['minutes','12']]){
   await choose(page.locator('#vehicleSpawnRateUnit'),unit);assert.equal(await page.locator('#vehicleSpawnRate').inputValue(),amount);assert.equal((await state()).rate,12);
  }
  await choose(page.locator('#vehicleSpawnRateUnit'),'hours');await page.fill('#vehicleSpawnRate','7.5');await page.locator('#vehicleSpawnRate').blur();assert.equal((await state()).rate,.125);
  await choose(page.locator('#simulatorRouteVolumeMode'),'total');assert(await page.locator('#vehicleSpawnRate').getAttribute('readonly')!==null);
  const first=page.locator('[data-route-field="volume"]').first(),second=page.locator('[data-route-field="volume"]').last();
  assert.equal(await first.inputValue(),'5.625');await first.fill('60');await first.blur();
  await choose(page.locator('#simulator-route-1-unit'),'AADT');await second.fill('1440');await second.blur();
  assert.equal((await state()).rate,2);assert.equal(await page.locator('#vehicleSpawnRate').inputValue(),'120');
  assert.deepEqual((await state()).routes.map(r=>r.percent),[50,50]);
  await choose(page.locator('#simulatorRouteVolumeMode'),'weights');await page.fill('#vehicleSpawnRate','240');await page.locator('#vehicleSpawnRate').blur();
  await first.fill('180');await first.blur();assert.equal((await state()).rate,4);assert.deepEqual((await state()).routes.map(r=>r.percent),[75,25]);
  const demand=await page.evaluate(()=>{const s=volumeEngine.sources.values().next().value;return {rate:s.rate,weights:s.routes.map(r=>r.weight)};});assert.equal(demand.rate,4);assert(demand.weights.some(w=>w>0));
  await page.click('#undoButton');await page.locator('.simulatorSpawn').click();assert.equal(await first.inputValue(),'60');await page.click('#redoButton');await page.locator('.simulatorSpawn').click();assert.equal(await first.inputValue(),'180');
  await page.click('#playSimulation');for(const id of ['vehicleSpawnRate','vehicleSpawnRateUnit','simulatorRouteVolumeMode'])assert(await page.locator('#'+id).isDisabled());
  for(const control of await page.locator('#simulatorRoutes input,#simulatorRoutes select').all())assert(await control.isDisabled());await page.click('#pauseSimulation');
  const saved=await state();await page.evaluate(async()=>{const p=await StripeMaker.projectJSON.snapshot('selected');StripeMaker.projectJSON.validate(p);StripeMaker.sheets.save(StripeMaker.sheets.selected);});
  await page.waitForTimeout(800);await page.reload();await page.waitForFunction(()=>StripeMaker.sheets.ready&&StripeMaker.sheets.selected);assert.deepEqual(await state(),saved);
  await page.evaluate(()=>StripeMaker.showEditor('simulatorEditor'));await page.locator('.simulatorSpawn').click();assert.equal(await first.inputValue(),'180');
  await page.setViewportSize({width:390,height:844});const bounds=await page.locator('#simulatorEditor').boundingBox();assert(bounds.x>=0&&bounds.x+bounds.width<=391);
  assert(await page.locator('#simulatorEditor').evaluate(el=>el.scrollWidth<=el.clientWidth+1),'amount/unit fields fit the panel');
  await page.locator('#simulatorRouteVolumeMode-button').scrollIntoViewIfNeeded();
  await page.screenshot({path:`/tmp/stripemaker-volumes-${webkit?'webkit':'chromium'}.png`});assert.deepEqual(errors,[]);
  console.log('PASS volume units, modes, engine demand, locks, undo/redo, project validation, reload and narrow panel');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
