const assert=require('node:assert/strict'),path=require('node:path');const {pathToFileURL}=require('node:url');
const P=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{const webkit=process.env.BROWSER==='webkit',executablePath=webkit?process.env.WEBKIT_PATH:process.env.CHROME_PATH;
 const browser=await P[webkit?'webkit':'chromium'].launch({headless:true,...(executablePath?{executablePath}:{})});
 try{
  const page=await browser.newPage({viewport:{width:1400,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.STRIPEMAKER_URL||pathToFileURL(path.resolve(__dirname,'../index.html')).href);await page.waitForFunction(()=>StripeMaker.sheets.ready);await page.locator('#blankSheet').evaluate(b=>b.click());await page.waitForFunction(()=>StripeMaker.sheets.selected);
  await page.evaluate(()=>{const A=StripeMaker,s=A.sheets.selected;s.inchesPerPixel=12;s.view={x:0,y:0,scale:1,fitted:false};s.roads=[];s.joints=[];s.vehicleSpawns=[];
   for(let i=0;i<2;i++){s.roads.push({id:i+1,lanes:i===0?2:1,laneWidth:12,ends:[{joint:i*2+1,sign:1},{joint:i*2+2,sign:1}]});s.joints.push({id:i*2+1,x:600,y:400+i*200,dir:{x:1,y:0},root:i+1,links:[]},{id:i*2+2,x:1200,y:400+i*200,dir:{x:1,y:0},root:i+1,links:[]});s.vehicleSpawns.push({road:i+1,routes:[{exit:{road:i+1,e:1},percent:100}]});}
   A.settings.set('simulationTemperature',0);Object.assign(A.sheets.selected,{speedZones:A.sheets.selected.roads.map(road=>({id:'test-speed-'+road.id,road:road.id,from:0,to:1,mph:0}))});A.sheets.zoomBy(1);A.roadEditor.render();A.history.rebase();A.showEditor('simulatorEditor');
   const advance=A.simulatorVehicles.Engine.prototype.advance;A.simulatorVehicles.Engine.prototype.advance=function(seconds){window.testEngine=this;return advance.call(this,seconds);};
  });
  const chooseOverlay=async value=>{await page.locator('#simulationDensityOverlay').setChecked(value==='density');};
  const original=await page.evaluate(()=>JSON.stringify([StripeMaker.sheets.selected.roads,StripeMaker.sheets.selected.joints,StripeMaker.sheets.selected.vehicleSpawns]));
  assert.equal(await page.locator('.simulatorRouteHit').count(),2);
  await page.locator('.simulatorSpawn[data-road="1"]').click();assert.equal(await page.locator('.simulatorRouteHit').count(),1);assert.match(await page.locator('.simulatorRouteHit').getAttribute('aria-label'),/road 1 entrance/);
  await page.locator('.simulatorSpawn[data-road="2"]').click();assert.equal(await page.locator('.simulatorRouteHit').count(),1);assert.match(await page.locator('.simulatorRouteHit').getAttribute('aria-label'),/road 2 entrance/);
  await page.keyboard.press('Escape');assert.equal(await page.locator('.simulatorRouteHit').count(),2);
  await chooseOverlay('density');assert(await page.locator('.simulatorDensity').isVisible());assert(await page.locator('#simulationDensityLegend').isVisible());assert.equal(await page.locator('.simulatorDensity g').getAttribute('opacity'),'0.28');
  await page.clock.install();await page.click('#playSimulation');await page.clock.runFor(100);
  await page.evaluate(()=>{const A=StripeMaker,e=testEngine,V=A.simulatorVehicles;for(const s of e.sources.values()){s.rate=0;s.pending=0;s.candidate=null;}const route=e.sources.get('1:0').routes.find(r=>r.key.startsWith('lane:0:'));
   e.cars=[20,44,68,92].map((d,i)=>{const c={id:100+i,source:'1:0',route,path:route.path,pathDistance:d,distance:d,speed:0,driver:{...A.simulatorDrivers.BASELINE},committed:new Set(),decisionAt:0,hue:i*80};e.updateCar(c);return c;});A.simulator.refreshOverlay(false);
  });
  const cell=(lane,start)=>page.locator(`.simulatorDensity path[data-road="1"][data-lane="${lane}"][data-start="${start}"]`);
  const dense=Number(await cell(0,0).getAttribute('data-density'));assert(dense>.8);assert.equal(Number(await cell(1,0).getAttribute('data-density')),0);assert.match(await cell(1,0).getAttribute('fill'),/hsl\(120/);
  await page.screenshot({path:'/tmp/stripemaker-density-active.png'});
  const cars=await page.evaluate(()=>testEngine.cars.map(c=>({id:c.id,x:c.x,y:c.y,driver:c.driver})));await chooseOverlay('none');assert(await page.locator('.simulatorDensity').isHidden());await chooseOverlay('density');assert(!await page.locator('#simulationDensityOverlay').isDisabled());assert.deepEqual(await page.evaluate(()=>testEngine.cars.map(c=>({id:c.id,x:c.x,y:c.y,driver:c.driver}))),cars);
  await page.evaluate(()=>{testEngine.cars[0].pathDistance+=200;testEngine.updateCar(testEngine.cars[0]);});await page.clock.runFor(300);assert(Number(await cell(0,0).getAttribute('data-density'))<dense);assert(Number(await cell(0,200).getAttribute('data-density'))>0);
  await page.click('#clearSimulation');assert((await page.locator('.simulatorDensity path').evaluateAll(nodes=>nodes.map(n=>Number(n.dataset.density)))).every(value=>value===0));
  assert.equal(await page.evaluate(()=>JSON.stringify([StripeMaker.sheets.selected.roads,StripeMaker.sheets.selected.joints,StripeMaker.sheets.selected.vehicleSpawns])),original,'view choices preserve traffic configuration');
  await page.screenshot({path:'/tmp/stripemaker-density-empty.png'});await page.click('#playSimulation');await page.clock.runFor(100);await page.click('#pauseSimulation');
  const portable=await page.evaluate(()=>StripeMaker.projectJSON.snapshot());assert.equal(portable.settings.simulationOverlay,'density');portable.settings.simulationOverlay='none';delete portable.settings.simulationOverlays;
  await page.evaluate(project=>StripeMaker.projectJSON.load(project,{applySettings:false}),portable);assert(await page.locator('#simulationDensityOverlay').isChecked());await page.evaluate(project=>StripeMaker.projectJSON.load(project,{applySettings:true}),portable);assert(!await page.locator('#simulationDensityOverlay').isChecked());
  await chooseOverlay('density');await page.clock.runFor(700);await page.reload();await page.waitForFunction(()=>StripeMaker.sheets.ready);await page.evaluate(()=>StripeMaker.showEditor('simulatorEditor'));assert(await page.locator('#simulationDensityOverlay').isChecked());assert(await page.locator('.simulatorDensity').isVisible());
  await page.setViewportSize({width:390,height:844});await page.locator('#simulationDensityOverlay').scrollIntoViewIfNeeded();const box=await page.locator('#simulatorEditor').boundingBox();assert(box.x>=0&&box.x+box.width<=391);assert.deepEqual(errors,[]);
  console.log(`PASS ${webkit?'WebKit':'Chromium'} selected-spawn route filtering, translucent density colors, live updates, view-only toggles, clear, optional import, reload and narrow layout.`);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
