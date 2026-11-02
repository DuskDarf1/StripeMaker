const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
 try{
  const page=await browser.newPage({viewport:{width:1400,height:1000}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.STRIPEMAKER_URL||pathToFileURL(path.resolve(__dirname,'../index.html')).href);
  const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=1600;c.height=1200;return c.toDataURL().split(',')[1];});
  await page.locator('#sheetFile').setInputFiles({name:'Playback.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
  await page.waitForFunction(()=>StripeMaker.sheets.selected);
  await page.evaluate(()=>{
   const app=StripeMaker,s=app.sheets.selected;
   Object.assign(s,{inchesPerPixel:2,roads:[
    {id:1,lanes:1,laneWidth:12,ends:[{joint:1,sign:1},{joint:2,sign:1}]},
    {id:2,lanes:1,laneWidth:12,ends:[{joint:2,sign:1},{joint:3,sign:1}]},
    {id:3,lanes:1,laneWidth:12,ends:[{joint:2,sign:1},{joint:4,sign:1}]}],
    joints:[{id:1,x:650,y:650,dir:{x:1,y:0},root:1,links:[]},
     {id:2,x:800,y:650,dir:{x:1,y:0},root:1,links:[{a:1,ai:0,b:2,bi:0},{a:1,ai:0,b:3,bi:0}]},
     {id:3,x:1300,y:400,dir:{x:1,y:0},root:2,links:[]},
     {id:4,x:1300,y:1000,dir:{x:1,y:0},root:3,links:[]}],
    vehicleSpawns:[{road:1}]});
   app.roadEditor.render();app.history.rebase();app.showEditor('simulatorEditor');
  });
  const point=async(road,e)=>page.evaluate(({road,e})=>{
   const s=StripeMaker.sheets.selected,p=StripeMaker.roadEditor.lanePoint(s,s.roads.find(r=>r.id===road),e,0,StripeMaker.roadEditor.solve(s));
   const b=document.getElementById('previewStage').getBoundingClientRect(),q=StripeMaker.sheets.toScreen(p);return {x:b.left+q.x,y:b.top+q.y};
  },{road,e});
  const add=async road=>{const a=await point(1,0),b=await point(road,1);await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:6});await page.mouse.up();};
  await add(2);await add(3);assert.equal(await page.locator('.simulatorRoute').count(),2,'second exit adds a route');
  await add(2);assert.equal(await page.locator('.simulatorRoute').count(),2,'repeated route is deduplicated');
  // Remove only one selected route; restore it without removing its sibling.
  await page.locator('.simulatorRouteHit').last().focus();await page.keyboard.press('Enter');await page.click('#removeVehicleExitRoute');
  assert.equal(await page.locator('.simulatorRoute').count(),1);await page.click('#undoButton');assert.equal(await page.locator('.simulatorRoute').count(),2);
  await page.locator('.simulatorSpawn').click();await page.fill('#vehicleSpawnRate','120');await page.locator('#vehicleSpawnRate').blur();
  assert.equal(await page.evaluate(()=>StripeMaker.sheets.selected.vehicleSpawns[0].rate),120);
  assert.equal(await page.locator('.simulatorRouteRow').count(),2,'selecting the spawn shows all route controls');
  await page.locator('.simulatorRouteRow [data-route-field="name"]').first().fill('Downtown');
  await page.locator('.simulatorRouteRow [data-route-field="name"]').last().fill('Airport');
  await page.locator('.simulatorRouteRow [data-route-field="shareValue"]').first().fill('75');
  await page.locator('.simulatorRouteRow [data-route-field="shareValue"]').first().blur();
  assert.equal(await page.locator('.simulatorRouteRow [data-route-field="shareValue"]').last().inputValue(),'25');
  assert.deepEqual(await page.evaluate(()=>StripeMaker.sheets.selected.vehicleSpawns[0].routes.map(r=>r.percent)),[75,25]);
  const speed=page.locator('#simulationSpeedValue');
  await speed.fill('12.3');await speed.blur();assert.equal(await page.locator('#simulationSpeed').inputValue(),'12.3');
  assert.equal(await page.locator('#simulationSpeed').getAttribute('max'),'999');assert.equal(await page.locator('#simulationSpeed').getAttribute('step'),'0.1');
  // Seed only random route/color choices; simulation time is driven by the browser clock.
  await page.evaluate(()=>{let n=123;Math.random=()=>{n=(Math.imul(n,1664525)+1013904223)>>>0;return n/4294967296;};});
  await page.clock.install();
  const state=()=>page.evaluate(()=>StripeMaker.simulator.diagnostics());
  await page.click('#playSimulation');await page.clock.runFor(5000);
  let moving=await state();assert(moving.running);assert(moving.cars.length>=2);assert.equal(new Set(moving.cars.map(c=>c.route)).size,2,'cars use both exits');
  assert(new Set(moving.cars.map(c=>c.hue)).size>1,'cars have random colors');
  assert(await page.locator('.simulatorCar').first().evaluate(img=>img.complete&&img.naturalWidth>0),'supplied car asset loaded');
  await page.screenshot({path:'/tmp/stripemaker-simulator-cars.png'});
  assert.equal(await page.locator('.simulatorRoute').count(),0,'route lines hidden while playing');
  for(const id of ['simulationSpeed','simulationSpeedValue','vehicleSpawnRate','createVehicleSpawnPoint','removeVehicleSpawnPoint','removeVehicleExitRoute'])assert(await page.locator('#'+id).isDisabled(),id+' locked during playback');
  for(const input of await page.locator('.simulatorRouteRow input, .simulatorRouteRow button').all())assert(await input.isDisabled(),'all route controls locked');
  const width=await page.locator('.simulatorCar').first().evaluate(img=>parseFloat(img.style.width));
  const zoom=await page.evaluate(()=>StripeMaker.sheets.selected.view.scale);assert(Math.abs(width-60*zoom)<.01,'car fills 12-foot lane with one-foot clearance each side');
  const car=moving.cars[0];assert(Math.abs(car.distance-moving.time*12.3*5280/3600*6)<1e-6,'mph converts to sheet distance');
  await page.click('#pauseSimulation');const paused=await state();assert.equal(await page.locator('.simulatorRoute').count(),2,'route lines return on pause');assert(await speed.isEnabled());await page.clock.runFor(3000);assert.deepEqual(await state(),paused,'pause freezes positions, colors and emission time');
  await page.click('#playSimulation');await page.clock.runFor(1000);moving=await state();
  assert(moving.cars.find(c=>c.id===car.id).distance>car.distance,'resume continues existing cars');
  await page.click('#pauseSimulation');await speed.fill('0');await speed.blur();await page.click('#playSimulation');const zero=await state();await page.clock.runFor(1000);
  const afterZero=await state();assert.equal(afterZero.cars.find(c=>c.id===car.id).distance,zero.cars.find(c=>c.id===car.id).distance,'zero mph stops movement');
  await page.click('#pauseSimulation');await speed.fill('999.0');await speed.blur();assert.equal(await page.locator('#simulationSpeed').inputValue(),'999');
  await page.click('#playSimulation');await page.clock.runFor(5000);assert(!(await state()).cars.some(c=>c.id===car.id),'cars leave at the exit');
  await page.click('#pauseSimulation');
  await speed.fill('30.5');await speed.blur();
  await page.locator('.simulatorSpawn').click();await page.fill('#vehicleSpawnRate','0');await page.locator('#vehicleSpawnRate').blur();
  const existing=(await state()).cars.length;if(await page.locator('#playSimulation').isEnabled())await page.click('#playSimulation');await page.clock.runFor(3000);if((await state()).running)await page.click('#pauseSimulation');
  assert((await state()).cars.length<=existing,'zero output does not create cars');
  await page.screenshot({path:'/tmp/stripemaker-simulator-controls.png'});
  // Configuration saves; active cars are session-only, never part of history.
  await page.clock.runFor(1000);await page.reload();await page.waitForFunction(()=>StripeMaker.sheets.selected);
  await page.evaluate(()=>StripeMaker.showEditor('simulatorEditor'));
  assert.equal(await page.locator('.simulatorRoute').count(),2);assert.deepEqual(await page.evaluate(()=>StripeMaker.sheets.selected.vehicleSpawns[0].routes.map(r=>r.percent)),[75,25]);assert.equal(await page.locator('#simulationSpeedValue').inputValue(),'30.5');
  await page.locator('.simulatorSpawn').click();assert.equal(await page.locator('#vehicleSpawnRate').inputValue(),'0');assert.deepEqual(await page.locator('.simulatorRouteRow [data-route-field="name"]').evaluateAll(inputs=>inputs.map(i=>i.value)),['Downtown','Airport']);
  assert.equal((await state()).cars.length,0);assert(!(await state()).running);
  await page.locator('.simulatorRouteRow button').first().click();assert.equal(await page.locator('.simulatorRouteRow').count(),1,'remove route directly from the list');assert.equal(await page.locator('.simulatorRouteRow [data-route-field="shareValue"]').inputValue(),'100');await page.click('#undoButton');await page.locator('.simulatorSpawn').click();assert.equal(await page.locator('.simulatorRouteRow').count(),2);
  await page.setViewportSize({width:390,height:844});
  const box=await page.locator('#simulatorEditor').boundingBox();assert(box.x>=0&&box.x+box.width<=391,'panel fits narrow screens');
  await page.setViewportSize({width:1400,height:1000});
  await page.evaluate(()=>{
   const app=StripeMaker,s=app.sheets.selected;
   app.settings.set('simulationSpeed',10);
   Object.assign(s,{roads:[1,2].map(id=>({id,lanes:3,laneWidth:12,ends:[{joint:id,sign:1},{joint:id+1,sign:1}]})),
    joints:[1,2,3].map(id=>({id,x:650+(id-1)*300,y:650,dir:{x:1,y:0},root:Math.min(id,2),links:id===2?[{a:1,ai:0,b:2,bi:0}]:[]})),
    vehicleSpawns:[{road:1,rate:120,laneShares:{0:0,1:100,2:0},routes:[{name:'All lanes exit',percent:100,exit:{road:2,e:1}}]}]});
   app.roadEditor.render();app.history.rebase();
  });
  assert.equal(await page.locator('.simulatorSpawn').count(),1,'multi-lane entrance has exactly one marker');
  await page.locator('.simulatorSpawn').click();assert.equal(await page.locator('#simulatorLanes input[type=number]').count(),3);
  await page.click('#playSimulation');await page.clock.runFor(1000);
  let laneCars=(await state()).cars;assert(laneCars.length>=1&&laneCars.length<=3,'one total output rate for the whole entrance');
  assert(laneCars.every(car=>car.route.startsWith('lane:1:')),'100% share sends all cars into lane 2');
  for(const input of await page.locator('#simulatorLanes input').all())assert(await input.isDisabled(),'lane distributions locked while playing');
  await page.click('#pauseSimulation');
  await page.locator('#simulatorLanes input[type=number]').first().fill('100');await page.locator('#simulatorLanes input[type=number]').first().blur();
  assert.deepEqual(await page.locator('#simulatorLanes input[type=number]').evaluateAll(inputs=>inputs.map(i=>Number(i.value))),[100,0,0]);
  await page.click('#playSimulation');await page.clock.runFor(1000);
  laneCars=(await state()).cars;assert(laneCars.length>0&&laneCars.every(car=>car.route.startsWith('lane:0:')),'updated lane share changes the spawn lane');
  await page.click('#pauseSimulation');
  assert.deepEqual(errors,[]);
  console.log('PASS multiple exits, selective removal, random car colors, frame-based motion, Play/Pause, 0–999.0 mph, output, grouped lane distributions, saved configuration and narrow layout.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
