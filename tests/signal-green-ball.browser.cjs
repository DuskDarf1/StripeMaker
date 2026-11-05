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
   i.movements=[G.movement(a,0,left,0),G.movement(opposite,0,a,0),G.movement(a,0,right,0)];
   const c=M.normalize();c.mode='fixed';for(const p of c.phases){p.enabled=[2,6].includes(p.id);p.recall='min';p.split=90;}
   const keys=[`${a.inLanes[0]}>${left.outLanes[0]}`,`${opposite.inLanes[0]}>${a.outLanes[0]}`,`${a.inLanes[0]}>${right.outLanes[0]}`];
   c.assignments=Object.fromEntries(keys.map((k,n)=>[k,{phase:n===1?6:2,greenMode:'auto',permissive:[],overlap:[],flashingRed:[],noTurnOnRed:true}]));
   c.arms=[{id:'arm',x:-25,y:45,angle:0,length:50}];c.heads=[{id:'head',arm:'arm',at:30,type:'fya-left',movement:keys[0],auto:true,angle:0}];i.trafficSignal=c;s.intersections=[i];A.showEditor('simulatorEditor');A.sheets.zoomBy(1);A.roadEditor.render();A.simulator.refreshOverlay();A.signalEditor.select(i);A.history.rebase();return {keys,id:i.id};
  });
  const choose=async(name,row=0)=>{await page.locator(`#signal-cell-${row}-2-button`).click();await page.getByRole('option',{name,exact:true}).click();};
  assert.equal(await page.locator('.signalYieldLabel').count(),2,'left and right green balls visibly say Yield');
  assert.equal(await page.locator('.signalErrors').count(),0,'opposing through and yielding turn coexist');
  await choose('GA · Protected green arrow');assert.match(await page.locator('.signalErrors').textContent(),/Conflicting protected/);
  await choose('G · Green ball — turns yield');assert.equal(await page.locator('.signalErrors').count(),0);
  assert.equal(await page.locator('.signalMovementFlashing').count(),0,'steady greens keep steady movement lines');
  await page.click('#playSimulation');await page.waitForFunction(()=>document.querySelector('[data-signal-part="head"]')?.getAttribute('aria-label').includes('green ball'));
  assert(await page.locator('[data-signal-part="head"]').evaluate(e=>[...e.querySelectorAll('circle')].some(e=>e.getAttribute('fill')===StripeMakerSignalAssets.colors.green)),'ordinary green uses the circular SignalMaker indication');
  await page.click('#pauseSimulation');
  for(const [row,direction] of [[0,'left'],[2,'right']]){
  await page.evaluate(key=>{const i=StripeMaker.sheets.selected.intersections[0];i.trafficSignal.heads[0].movement=key;StripeMaker.signalEditor.select(i);},fixture.keys[row]);
  for(const [name,aspect,color] of [['FY · Flashing yellow — yield','permissive','yellow'],['FRA · Flashing red arrow — stop, then yield','flash-red','red']]){
   await choose(name,row);
   const line=page.locator('.signalMovementPreview').nth(row),opacity=await line.evaluate(e=>getComputedStyle(e).strokeOpacity);
   await page.waitForFunction(([row,opacity])=>getComputedStyle(document.querySelectorAll('.signalMovementPreview')[row]).strokeOpacity!==opacity,[row,opacity]);
   assert.equal(await page.locator('.signalMovementHit').count(),3,'flashing never removes movement selection targets');
   assert(await page.locator(`#signal-cell-${row}-2-button .signalIndicationIcon`).evaluate((e,direction)=>e.querySelector('polygon').parentElement.getAttribute('transform').includes(`rotate(${StripeMakerSignalAssets.arrowAngles[direction]})`),direction),'matrix arrow follows the movement');
   await page.locator(`#signal-cell-${row}-2-button`).click();assert.equal(await page.getByRole('option',{name:/Flashing red ball/}).count(),0);await page.keyboard.press('Escape');
   await page.click('#playSimulation');
   await page.waitForFunction(aspect=>document.querySelector('[data-signal-part="head"]')?.getAttribute('aria-label').includes(aspect),aspect);
   for(const on of [true,false])await page.waitForFunction(([row,color,on])=>{
    const line=document.querySelectorAll('.signalMovementPreview')[row],head=document.querySelector('[data-signal-part="head"]');
    return line&&Number(line.getAttribute('stroke-opacity'))===(on?1:.08)&&[...head.querySelectorAll('[fill]')].some(e=>e.getAttribute('fill')===StripeMakerSignalAssets.colors[color])===on;
   },[row,color,on]);
   assert.equal(await page.locator('.signalMovementHit').count(),0,'live lines do not enable editing during playback');
   const lit=()=>page.locator('[data-signal-part="head"]').evaluate((e,color)=>[...e.querySelectorAll('[fill]')].some(e=>e.getAttribute('fill')===StripeMakerSignalAssets.colors[color]),color);
   const first=await lit();await page.waitForFunction(([color,first])=>[...document.querySelector('[data-signal-part="head"]').querySelectorAll('[fill]')].some(e=>e.getAttribute('fill')===StripeMakerSignalAssets.colors[color])!==first,[color,first]);
   await page.waitForFunction(([color,direction])=>[...document.querySelector('[data-signal-part="head"]').querySelectorAll('g[fill]')].some(g=>g.getAttribute('fill')===StripeMakerSignalAssets.colors[color]&&g.querySelector('polygon')&&g.getAttribute('transform').includes(`rotate(${StripeMakerSignalAssets.arrowAngles[direction]})`)),[color,direction]);
   await page.click('#pauseSimulation');
  }
  }
  await page.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await page.locator('.signalMovementFlashing').first().evaluate(e=>getComputedStyle(e).animationName),'none','preview follows reduced-motion preference');
  await page.emulateMedia({reducedMotion:'no-preference'});
  const project=await page.evaluate(()=>StripeMaker.projectJSON.snapshot());await page.evaluate(p=>StripeMaker.projectJSON.load(p,{applySettings:false}),project);
  const saved=await page.evaluate(()=>StripeMaker.sheets.selected.intersections[0].trafficSignal);assert.deepEqual(saved.assignments[fixture.keys[0]].flashingRedArrows,[2]);assert.deepEqual(saved.assignments[fixture.keys[0]].flashingRed,[]);assert.deepEqual(saved.assignments[fixture.keys[2]].flashingRedArrows,[2]);
  await page.evaluate(()=>{StripeMaker.showEditor('simulatorEditor');StripeMaker.signalEditor.select(StripeMaker.sheets.selected.intersections[0]);});
  await page.screenshot({path:'/tmp/stripemaker-green-ball-and-flash.png'});assert.deepEqual(errors,[]);
  console.log('PASS green-ball/flash UI: left/right Yield labels, protected conflict checking, real circular/arrow artwork, live yellow/red flashing, and project round-trip.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
