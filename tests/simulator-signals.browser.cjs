const assert=require('node:assert/strict'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const P=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const webkit=process.env.BROWSER==='webkit',executablePath=webkit?process.env.WEBKIT_PATH:process.env.CHROME_PATH;
 const browser=await P[webkit?'webkit':'chromium'].launch({headless:true,...(executablePath?{executablePath}:{})});
 try{
  const page=await browser.newPage({viewport:{width:1400,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.STRIPEMAKER_URL||pathToFileURL(path.resolve(__dirname,'../index.html')).href);
  await page.waitForFunction(()=>StripeMaker.sheets.ready);await page.locator('#blankSheet').evaluate(b=>b.click());await page.waitForFunction(()=>StripeMaker.sheets.selected);
  await page.evaluate(()=>StripeMaker.showEditor('simulatorEditor'));assert(await page.locator('#addTrafficSignal').isDisabled());
  const ids=await page.evaluate(()=>{
   const A=StripeMaker,s=A.sheets.selected,G=A.intersectionGeometry;
   s.inchesPerPixel=12;s.view={x:0,y:0,scale:1,fitted:false};
   s.intersections=[G.create(),G.create(),A.roundaboutGeometry.create()];
   s.intersections.forEach((item,i)=>{G.normalize(item);item.name=`Signal test ${i+1}`;item.x=i===0?650:i===1?1050:900;item.y=i===2?780:500;});
   s.roads=[{id:1,lanes:1,laneWidth:12,ends:[{joint:1,sign:1},{joint:2,sign:1}]}];
   s.joints=[{id:1,x:650,y:220,dir:{x:1,y:0},root:1,links:[]},{id:2,x:1300,y:220,dir:{x:1,y:0},root:1,links:[]}];
   s.vehicleSpawns=[{road:1,routes:[{exit:{road:1,e:1},percent:100}]}];
   A.sheets.zoomBy(1);A.roadEditor.render();A.history.rebase();A.simulator.refreshOverlay();return s.intersections.map(x=>x.id);
  });
  const count=()=>page.evaluate(()=>StripeMaker.sheets.selected.intersections.filter(i=>i.trafficSignal).length);
  const clickPoint=async(point)=>{const p=await page.evaluate(point=>{const p=StripeMaker.sheets.toScreen(point),box=document.getElementById("previewStage").getBoundingClientRect();return {x:p.x+box.left,y:p.y+box.top};},point);await page.mouse.click(p.x,p.y);};
  await page.click('#addTrafficSignal');assert.equal(await page.locator('#addTrafficSignal').getAttribute('aria-pressed'),'true');assert.equal(await page.locator('.simulatorSignalTarget').count(),3);
  await clickPoint({x:900,y:220});await clickPoint({x:1250,y:700});assert.equal(await count(),0,'roads and empty sheet do not accept signals');
  await clickPoint({x:685,y:500});assert.equal(await count(),1);assert.equal(await page.locator('.simulatorSignal:not(.simulatorSignalTarget)').count(),1);assert.equal(await page.locator('#addTrafficSignal').getAttribute('aria-pressed'),'false');
  await page.click('#addTrafficSignal');await clickPoint({x:650,y:500});assert.equal(await count(),1,'one signal per intersection');await page.keyboard.press('Escape');assert.equal(await page.locator('.simulatorSignalTarget').count(),0);
  await page.click('#undoButton');assert.equal(await count(),0);assert.equal(await page.locator('.simulatorSignal:not(.simulatorSignalTarget)').count(),0);await page.click('#redoButton');assert.equal(await count(),1);
  await page.click('#addTrafficSignal');await page.locator(`.simulatorSignalTarget[data-intersection="${ids[1]}"]`).focus();await page.keyboard.press('Enter');assert.equal(await count(),2,'keyboard placement');
  await page.click('#addTrafficSignal');await page.locator(`.simulatorSignalTarget[data-intersection="${ids[2]}"]`).click();assert.equal(await count(),3,'roundabout target');
  const marker=page.locator(`.simulatorSignal[data-intersection="${ids[0]}"]`),before=await marker.getAttribute('style');
  await page.evaluate(()=>{const A=StripeMaker,s=A.sheets.selected;s.view.x+=50;A.sheets.zoomBy(1);});await page.waitForFunction(id=>document.querySelector(`.simulatorSignal[data-intersection="${id}"]`)?.style.left==='700px',ids[0]);assert.notEqual(await marker.getAttribute('style'),before,'markers follow the sheet view');
  assert(await page.evaluate(()=>StripeMaker.intersections.focusAt({x:650,y:500})),'existing intersection editor picking');await page.evaluate(()=>StripeMaker.showEditor('simulatorEditor'));
  const portable=await page.evaluate(()=>StripeMaker.projectJSON.snapshot());assert(portable.sheets[0].data.intersections.every(i=>i.trafficSignal));
  await page.evaluate(project=>StripeMaker.projectJSON.load(project,{applySettings:false}),portable);assert.equal(await count(),3,'project import');
  await page.clock.install();await page.click('#playSimulation');assert(await page.locator('#addTrafficSignal').isDisabled());await page.clock.runFor(1000);
  await page.click('#clearSimulation');assert.equal(await count(),3,'clearing transient traffic retains signals');
  await page.clock.runFor(700);await page.reload();await page.waitForFunction(()=>StripeMaker.sheets.ready);assert.equal(await count(),3,'IndexedDB reload');
  await page.evaluate(()=>StripeMaker.showEditor('simulatorEditor'));assert.equal(await page.locator('.simulatorSignal:not(.simulatorSignalTarget)').count(),3);
  await page.screenshot({path:'/tmp/stripemaker-traffic-signal-placement.png'});await page.setViewportSize({width:390,height:844});await page.locator('#addTrafficSignal').scrollIntoViewIfNeeded();
  const box=await page.locator('#simulatorEditor').boundingBox();assert(box.x>=0&&box.x+box.width<=391);assert.deepEqual(errors,[]);
  console.log(`PASS ${webkit?'WebKit':'Chromium'} signal placement on intersections only, one per intersection, Escape, keyboard, undo/redo, pan, project import, reload, simulation locking and retained signals on Clear Simulation.`);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
