const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const P=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const webkit=process.env.BROWSER==='webkit',executablePath=webkit?process.env.WEBKIT_PATH:process.env.CHROME_PATH;
 const browser=await P[webkit?'webkit':'chromium'].launch({headless:true,...(executablePath?{executablePath}:{})});
 try{
  const page=await browser.newPage({viewport:{width:1400,height:1000}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.STRIPEMAKER_URL||pathToFileURL(path.resolve(__dirname,'../index.html')).href);
  const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=1600;c.height=1200;return c.toDataURL().split(',')[1];});
  await page.locator('#sheetFile').setInputFiles({name:'Playback.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
  await page.waitForFunction(()=>StripeMaker.sheets.selected);
  await page.evaluate(()=>{
   const app=StripeMaker,s=app.sheets.selected;StripeMaker.settings.set('simulationTemperature',0);
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
  await page.evaluate(()=>{
   const A=StripeMaker,s=A.sheets.selected;s.roads=s.roads.slice(0,1);s.joints=s.joints.slice(0,2);s.joints[1].x=100000;s.joints[1].links=[];
   s.vehicleSpawns=[{road:1,rate:12,routes:[{exit:{road:1,e:1},percent:100}]}];A.roadEditor.render();
   const advance=A.simulatorVehicles.Engine.prototype.advance;A.simulatorVehicles.Engine.prototype.advance=function(seconds){window.testEngine=this;return advance.call(this,seconds);};
  });
  assert.equal(await page.locator('#simulationPlaybackRateValue').inputValue(),'1.0');
  assert.equal(await page.locator('#simulationPlaybackRate').getAttribute('max'),'5');
  await page.clock.install();await page.click('#playSimulation');await page.clock.runFor(100);
  const state=()=>page.evaluate(()=>({time:testEngine.time,speed:testEngine.speed,ids:testEngine.cars.map(c=>c.id),drivers:testEngine.cars.map(c=>c.driver)}));
  let before=await state();await page.clock.runFor(1000);let after=await state();
  assert(Math.abs(after.time-before.time-1)<.03,'1x advances one simulated second per wall second');
  await page.fill('#simulationPlaybackRateValue','5');await page.locator('#simulationPlaybackRateValue').blur();
  assert.equal(await page.locator('#simulationPlaybackRate').inputValue(),'5');assert(!await page.locator('#simulationPlaybackRate').isDisabled());
  const changed=await state();assert.deepEqual(changed.ids,after.ids);assert.deepEqual(changed.drivers,after.drivers);assert.equal(changed.speed,after.speed);
  before=await state();await page.clock.runFor(1000);after=await state();
  assert(Math.abs(after.time-before.time-5)<.1,`5x advances five simulated seconds per wall second (observed ${after.time-before.time})`);assert.equal(after.speed,before.speed);
  assert(after.ids.length>before.ids.length,'spawn demand follows simulated time too');
  await page.click('#pauseSimulation');before=await state();await page.clock.runFor(1000);assert.equal((await state()).time,before.time);
  for(const invalid of ['0','6']){await page.fill('#simulationPlaybackRateValue',invalid);await page.locator('#simulationPlaybackRateValue').blur();assert.equal(await page.locator('#simulationPlaybackRateValue').inputValue(),'5.0');}
  await page.fill('#simulationPlaybackRateValue','2.5');await page.locator('#simulationPlaybackRateValue').blur();await page.click('#playSimulation');await page.clock.runFor(100);
  before=await state();await page.clock.runFor(1000);after=await state();assert(Math.abs(after.time-before.time-2.5)<.06);
  await page.click('#pauseSimulation');const project=await page.evaluate(()=>StripeMaker.projectJSON.snapshot());assert.equal(project.settings.simulationPlaybackRate,2.5);
  project.settings.simulationPlaybackRate=4;
  await page.evaluate(project=>StripeMaker.projectJSON.load(project,{applySettings:false}),project);assert.equal(await page.locator('#simulationPlaybackRateValue').inputValue(),'2.5');
  await page.evaluate(project=>StripeMaker.projectJSON.load(project,{applySettings:true}),project);assert.equal(await page.locator('#simulationPlaybackRateValue').inputValue(),'4.0');
  await page.fill('#simulationPlaybackRateValue','2.5');await page.locator('#simulationPlaybackRateValue').blur();
  await page.setViewportSize({width:390,height:844});const box=await page.locator('#simulatorEditor').boundingBox();assert(box.x>=0&&box.x+box.width<=391);
  await page.screenshot({path:'/tmp/stripemaker-playback-rate.png'});
  await page.clock.runFor(700);await page.reload();await page.waitForFunction(()=>StripeMaker.sheets.ready);
  assert.equal(await page.locator('#simulationPlaybackRateValue').inputValue(),'2.5');assert.deepEqual(errors,[]);
  console.log(`PASS ${webkit?'WebKit':'Chromium'} playback 1x/2.5x/5x, live adjustment, fixed mph/profiles, timed spawn demand, pause/resume, bounds, persistence and narrow layout.`);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
