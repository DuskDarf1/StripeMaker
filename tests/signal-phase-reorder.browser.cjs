const assert=require('node:assert/strict'),path=require('node:path'),{pathToFileURL}=require('node:url');
const P=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const webkit=process.env.BROWSER==='webkit',browser=await P[webkit?'webkit':'chromium'].launch({headless:true,executablePath:webkit?process.env.WEBKIT_PATH:process.env.CHROME_PATH});
 try{
  const page=await browser.newPage({viewport:{width:1500,height:1100}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.STRIPEMAKER_URL||pathToFileURL(path.resolve(__dirname,'../index.html')).href);await page.waitForFunction(()=>StripeMaker.sheets.ready);
  await page.locator('#blankSheet').evaluate(b=>b.click());await page.waitForFunction(()=>StripeMaker.sheets.selected);
  const fixture=await page.evaluate(()=>{
   const A=StripeMaker,G=A.intersectionGeometry,M=A.simulatorSignals,s=A.sheets.selected,i=G.create();s.inchesPerPixel=12;s.view={x:-3100,y:-3500,scale:4,fitted:false};i.x=i.y=1000;i.name='Green ball and flashing indications';G.normalize(i);
   const a=i.approaches[0],opposite=i.approaches[2],left=i.approaches.find(b=>M.mod(b.angle-a.angle,360)===90),right=i.approaches.find(b=>M.mod(b.angle-a.angle,360)===270);
   i.movements=[G.movement(a,0,left,0),G.movement(opposite,0,a,0),G.movement(a,0,right,0)];
   const c=M.normalize();c.mode='fixed';for(const p of c.phases){p.enabled=true;p.recall='min';p.minGreen=.3;p.yellow=.3;p.red=.2;p.split=1.2+(p.id===1?.2:0);}
   const keys=[`${a.inLanes[0]}>${left.outLanes[0]}`,`${opposite.inLanes[0]}>${a.outLanes[0]}`,`${a.inLanes[0]}>${right.outLanes[0]}`];
   c.assignments=Object.fromEntries(keys.map((k,n)=>[k,{phase:0,greenMode:'auto',permissive:[],overlap:[],flashingRed:[],noTurnOnRed:true}]));
   c.arms=[{id:'arm',x:-25,y:45,angle:0,length:50}];c.heads=[{id:'head',arm:'arm',at:30,type:'fya-left',movement:keys[0],auto:true,angle:0}];i.trafficSignal=c;s.intersections=[i];A.showEditor('simulatorEditor');A.sheets.zoomBy(1);A.roadEditor.render();A.simulator.refreshOverlay();A.signalEditor.select(i);A.history.rebase();return {keys,id:i.id};
  });
  const headers=()=>page.locator('[data-phase-header]').evaluateAll(buttons=>buttons.map(b=>Number(b.dataset.phaseHeader)));
  const header=id=>page.locator(`[data-phase-header="${id}"]`);
  const preserved=()=>page.evaluate(()=>{const c=StripeMaker.sheets.selected.intersections[0].trafficSignal;return JSON.stringify([c.phases.map(({order,...p})=>p),c.assignments,c.detectors]);});
  const before=await preserved();
  const drag=async(from,to,after=false,cancel=false)=>{await header(from).scrollIntoViewIfNeeded();const a=await header(from).boundingBox(),b=await header(to).boundingBox();await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width*(after?.8:.2),b.y+b.height/2,{steps:8});if(cancel)await page.keyboard.press('Escape');await page.mouse.up();};
  await drag(2,1);assert.deepEqual(await headers(),[2,1,3,4,5,6,7,8]);assert.equal(await preserved(),before);
  assert.equal(await page.locator('#signal-grid-split-1').inputValue(),'1.4','phase timing travels with its column');
  assert.equal(await page.evaluate(()=>document.activeElement.dataset.phaseHeader),'2');
  await page.evaluate(()=>StripeMaker.history.undo());assert.deepEqual(await headers(),[1,2,3,4,5,6,7,8]);await page.evaluate(()=>StripeMaker.history.redo());assert.deepEqual(await headers(),[2,1,3,4,5,6,7,8]);
  await drag(1,3,true);assert.deepEqual(await headers(),[2,1,3,4,5,6,7,8],'cross-barrier drops are rejected');
  await drag(1,5,true);assert.deepEqual(await headers(),[2,1,3,4,5,6,7,8],'cross-ring drops are rejected');
  await drag(1,2,false,true);assert.deepEqual(await headers(),[2,1,3,4,5,6,7,8],'Escape cancels the drag');
  await header(2).focus();await header(2).press('ArrowRight');assert.deepEqual(await headers(),[1,2,3,4,5,6,7,8]);await header(2).press('ArrowLeft');assert.deepEqual(await headers(),[2,1,3,4,5,6,7,8]);
  await page.click('#playSimulation');await page.waitForFunction(()=>StripeMaker.signalEditor.diagnostics().controllers[0].rings[0].phase===2);assert(await header(2).isDisabled());await page.click('#pauseSimulation');
  const project=await page.evaluate(()=>StripeMaker.projectJSON.snapshot());await page.evaluate(p=>StripeMaker.projectJSON.load(p,{applySettings:false}),project);
  await page.evaluate(()=>{StripeMaker.showEditor('simulatorEditor');StripeMaker.signalEditor.select(StripeMaker.sheets.selected.intersections[0]);});assert.deepEqual(await headers(),[2,1,3,4,5,6,7,8]);assert.equal(await preserved(),before);
  await page.setViewportSize({width:390,height:844});await header(7).scrollIntoViewIfNeeded();await header(7).focus();await header(7).press('ArrowRight');assert.deepEqual(await headers(),[2,1,3,4,5,6,8,7]);
  const moved=await header(7).boundingBox();assert(moved.x>=0&&moved.x+moved.width<=390,'reordered header stays visible on narrow screens');await header(7).press('ArrowLeft');await page.setViewportSize({width:1500,height:1100});
  await page.evaluate(()=>{const c=StripeMaker.sheets.selected.intersections[0].trafficSignal;for(const p of c.phases)p.enabled=[1,2].includes(p.id);StripeMaker.simulator.editSignal('Touch reorder fixture');StripeMaker.signalEditor.select(StripeMaker.sheets.selected.intersections[0]);});
  const touch=await page.evaluate(()=>{const from=document.querySelector('[data-phase-header="1"]'),to=document.querySelector('[data-phase-header="2"]'),a=from.getBoundingClientRect(),b=to.getBoundingClientRect();return {a:{x:a.x+a.width/2,y:a.y+a.height/2},b:{x:b.x+b.width*.2,y:b.y+b.height/2}};});
  await header(1).evaluate(b=>{b.setPointerCapture=()=>{};});
  await header(1).dispatchEvent('pointerdown',{pointerId:77,pointerType:'touch',isPrimary:true,button:0,clientX:touch.a.x,clientY:touch.a.y});
  await header(1).dispatchEvent('pointermove',{pointerId:77,pointerType:'touch',isPrimary:true,button:0,clientX:touch.b.x,clientY:touch.b.y});
  await header(1).dispatchEvent('pointerup',{pointerId:77,pointerType:'touch',isPrimary:true,button:0,clientX:touch.b.x,clientY:touch.b.y});
  assert.deepEqual(await headers(),[1,2]);
  await page.screenshot({path:'/tmp/stripemaker-phase-reorder.png'});assert.deepEqual(errors,[]);console.log('PASS phase reorder: drag/keyboard, group boundaries, cancel, unchanged phase data, playback sequence, undo/redo and project persistence.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
