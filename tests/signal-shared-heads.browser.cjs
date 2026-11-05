const assert=require('node:assert/strict'),path=require('node:path'),{pathToFileURL}=require('node:url');
const P=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const webkit=process.env.BROWSER==='webkit',browser=await P[webkit?'webkit':'chromium'].launch({headless:true,executablePath:webkit?process.env.WEBKIT_PATH:process.env.CHROME_PATH});
 try{
  const page=await browser.newPage({viewport:{width:1500,height:1100}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  // Equipment is temporarily disabled in the app; exercise its retained code explicitly.
  await page.addInitScript(()=>{(window.StripeMaker??={}).signalFeatures={mastHeads:true};});
  await page.goto(process.env.STRIPEMAKER_URL||pathToFileURL(path.resolve(__dirname,'../index.html')).href);await page.waitForFunction(()=>StripeMaker.sheets.ready);
  await page.locator('#blankSheet').evaluate(b=>b.click());await page.waitForFunction(()=>StripeMaker.sheets.selected);
  const fixture=await page.evaluate(()=>{
   const A=StripeMaker,G=A.intersectionGeometry,M=A.simulatorSignals,s=A.sheets.selected,i=G.create();s.inchesPerPixel=12;s.view={x:-3100,y:-3500,scale:4,fitted:false};i.x=i.y=1000;i.name='Green ball and flashing indications';G.normalize(i);
   const a=i.approaches[0],opposite=i.approaches[2],left=i.approaches.find(b=>M.mod(b.angle-a.angle,360)===90),right=i.approaches.find(b=>M.mod(b.angle-a.angle,360)===270);
   i.movements=[G.movement(a,0,left,0),G.movement(a,0,opposite,0),G.movement(a,0,right,0)];
   const c=M.normalize();c.mode='fixed';for(const p of c.phases){p.enabled=[2,6].includes(p.id);p.recall='min';p.split=90;}
   const keys=[`${a.inLanes[0]}>${left.outLanes[0]}`,`${a.inLanes[0]}>${opposite.outLanes[0]}`,`${a.inLanes[0]}>${right.outLanes[0]}`];
   c.assignments=Object.fromEntries(keys.map((k,n)=>[k,{phase:2,greenMode:'auto',permissive:[],overlap:[],flashingRed:[],noTurnOnRed:true}]));
   c.arms=[{id:'arm',x:-25,y:45,angle:0,length:50}];c.heads=[{id:'head',arm:'arm',at:30,type:'fya-left',movement:keys[0],auto:true,angle:0}];i.trafficSignal=c;s.intersections=[i];A.showEditor('simulatorEditor');A.sheets.zoomBy(1);A.roadEditor.render();A.simulator.refreshOverlay();A.signalEditor.select(i);A.history.rebase();return {keys,id:i.id};
  });
  const choose=async(id,name)=>{await page.locator(`#${id}-button`).click();await page.getByRole('option',{name,exact:true}).click();};
  const row=async(index)=>{await page.locator(`#signal-cell-${index}-2-button`).click();await page.keyboard.press('Escape');};
  await row(0);
  await choose('signal-Head-1-setup','Circular · 3 sections');
  await choose('signal-cell-0-2','GA · Protected green arrow');
  await page.click('#playSimulation');
  await page.waitForFunction(()=>[...document.querySelector('[data-signal-part="head"]').querySelectorAll('g[fill]')].some(e=>e.getAttribute('fill')===StripeMakerSignalAssets.colors.green&&e.getAttribute('transform').includes('rotate(-90)')));
  await page.click('#pauseSimulation');
  await choose('signal-Head-1-setup','Doghouse · arrow / circular · 5 sections');
  await choose('signal-cell-0-2','FY · Flashing yellow — yield');
  const timings=await page.evaluate(()=>JSON.stringify(StripeMaker.sheets.selected.intersections[0].trafficSignal.assignments));
  await row(1);await choose('signal-Head-1-assignment','Circular indications');
  await row(2);await choose('signal-Head-1-assignment','Circular indications');
  assert.equal(await page.evaluate(()=>JSON.stringify(StripeMaker.sheets.selected.intersections[0].trafficSignal.assignments)),timings,'sharing does not alter timings');
  assert.equal(await page.locator('[data-signal-part="head"]').count(),1,'one physical head serves all three movements');
  await page.evaluate(()=>StripeMaker.history.undo());
  assert.deepEqual(await page.evaluate(()=>StripeMaker.simulatorSignals.headMovements(StripeMaker.sheets.selected.intersections[0].trafficSignal.heads[0],'circular')),[fixture.keys[1]]);
  await page.evaluate(()=>StripeMaker.history.redo());
  const checkDoghouse=async(direction)=>{
   await page.click('#playSimulation');
   await page.waitForFunction(direction=>{const head=document.querySelector('[data-signal-part="head"]'),H=StripeMakerSignalAssets;return [...head.querySelectorAll('circle')].some(e=>e.getAttribute('fill')===H.colors.green)&&[...head.querySelectorAll('g[fill]')].some(e=>e.getAttribute('fill')===H.colors.yellow&&e.getAttribute('transform').includes(`rotate(${H.arrowAngles[direction]})`));},direction);
   await page.waitForFunction(()=>{const head=document.querySelector('[data-signal-part="head"]'),H=StripeMakerSignalAssets;return [...head.querySelectorAll('circle')].some(e=>e.getAttribute('fill')===H.colors.green)&&![...head.querySelectorAll('[fill]')].some(e=>e.getAttribute('fill')===H.colors.yellow);});
   await page.click('#pauseSimulation');
  };
  await checkDoghouse('left');
  await row(0);await page.getByRole('button',{name:'Edit head 1',exact:true}).click();
  const rightName=await page.locator('#signal-Head-movement').evaluate((select,key)=>[...select.options].find(o=>o.value===key).text,fixture.keys[2]);
  await choose('signal-Head-movement',rightName);
  await row(2);await choose('signal-cell-2-2','FY · Flashing yellow — yield');
  await checkDoghouse('right');
  const project=await page.evaluate(()=>StripeMaker.projectJSON.snapshot());await page.evaluate(p=>StripeMaker.projectJSON.load(p,{applySettings:false}),project);
  let saved=await page.evaluate(()=>StripeMaker.sheets.selected.intersections[0].trafficSignal);
  assert.equal(saved.heads[0].type,'doghouse');assert.equal(saved.heads[0].movement,fixture.keys[2]);assert.equal(saved.heads[0].secondaryMovement,fixture.keys[1]);
  assert.deepEqual(saved.heads[0].sharedCircularMovements,[fixture.keys[2]]);
  await page.evaluate(()=>{StripeMaker.showEditor('simulatorEditor');StripeMaker.signalEditor.select(StripeMaker.sheets.selected.intersections[0]);});
  await row(0);await choose('signal-New-head-setup','Doghouse · arrow / circular · 5 sections');
  await page.getByRole('button',{name:'Place head for movement',exact:true}).click();
  const arm=page.locator('[data-signal-part="arm"]').first();await arm.click({force:true});await page.keyboard.press('Escape');
  saved=await page.evaluate(()=>StripeMaker.sheets.selected.intersections[0].trafficSignal);
  assert.equal(saved.heads.length,2);assert.equal(saved.heads[1].type,'doghouse');assert.equal(saved.heads[1].movement,fixture.keys[0],'placement keeps the explicitly selected movement');
  await page.screenshot({path:'/tmp/stripemaker-shared-heads.png'});assert.deepEqual(errors,[]);
  console.log('PASS shared heads: movement setup, doghouse independent circular/arrow lamps, left/right flashing, shared membership, undo/redo, project persistence and placement.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
