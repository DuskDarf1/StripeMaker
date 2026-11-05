const assert=require('node:assert/strict'),path=require('node:path'),{pathToFileURL}=require('node:url');
const P=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const webkit=process.env.BROWSER==='webkit',browser=await P[webkit?'webkit':'chromium'].launch({headless:true,executablePath:webkit?process.env.WEBKIT_PATH:process.env.CHROME_PATH});
 try{
  const page=await browser.newPage({viewport:{width:1700,height:1100}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
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
   c.arms=[{id:'arm',x:-25,y:45,angle:0,length:50}];c.heads=[{id:'head',arm:'arm',at:30,type:'ball',movement:keys[0],auto:true,angle:0}];i.trafficSignal=c;s.intersections=[i];A.showEditor('simulatorEditor');A.sheets.zoomBy(1);A.roadEditor.render();A.simulator.refreshOverlay();A.signalEditor.select(i);A.history.rebase();return {keys,id:i.id};
  });
  const head=page.locator('[data-signal-part="head"]');await head.click({force:true});
  const right=page.locator('#signalHeadEditor');assert(await right.isVisible());assert(await page.locator('#simulatorEditor').isVisible());
  const box=await right.boundingBox();assert(box.x>1000,'head editor is on the right');
  assert.equal(await right.getByText(/Backplate|Housing|Plate margin|Border \(in/).count(),0,'no housing or backplate controls');
  const choose=async(input,name)=>{const id=await input.getAttribute('id');await page.locator('#'+id+'-button').click();await page.getByRole('option',{name,exact:true}).click();};
  await right.getByRole('button',{name:'Horizontal',exact:true}).click();
  await choose(right.locator('select[id^="signal-lens-symbol-"]').nth(2),'Right arrow');
  await choose(right.locator('select[id^="signal-lens-size-"]').nth(2),'8 in');
  await right.getByRole('button',{name:'Add Indication',exact:true}).click();assert.equal(await right.locator('fieldset').count(),4);
  const move=right.getByRole('button',{name:'Move indication 4',exact:true});await move.focus();await move.press('ArrowUp');
  let saved=await page.evaluate(()=>StripeMaker.sheets.selected.intersections[0].trafficSignal.heads[0]);
  assert.equal(saved.design.orientation,'horizontal');assert.equal(saved.design.indications[3].symbol,'right');assert.equal(saved.design.indications[3].size,8);
  await right.getByRole('button',{name:'Delete indication 3',exact:true}).click();assert.equal(await right.locator('fieldset').count(),3);
  await right.getByRole('button',{name:'Doghouse',exact:true}).click();assert.equal(await right.locator('fieldset').count(),5);assert(await right.getByRole('button',{name:'Add Indication',exact:true}).isDisabled());
  await right.getByRole('button',{name:'4 section cluster below',exact:true}).click();assert.equal(await right.locator('fieldset').count(),4);
  await right.getByRole('button',{name:'Linear',exact:true}).click();
  const before=await page.evaluate(()=>JSON.stringify(StripeMaker.sheets.selected.intersections[0].trafficSignal.assignments));
  const link=async(index,share=false,cancel=false)=>{
   const from=await head.boundingBox();const target=await page.locator('.signalMovementHit').nth(index).evaluate(path=>{const transform=path.getScreenCTM(),length=path.getTotalLength();for(let n=1;n<30;n++){const p=path.getPointAtLength(length*n/30),q=new DOMPoint(p.x,p.y).matrixTransform(transform);if(document.elementFromPoint(q.x,q.y)?.closest('[data-signal-movement]')?.dataset.signalMovement===path.dataset.signalMovement)return {x:q.x,y:q.y};}throw new Error('No exposed movement');});
   if(share)await page.keyboard.down('Shift');await page.mouse.move(from.x+from.width/2,from.y+from.height/2);await page.mouse.down();await page.mouse.move(target.x,target.y,{steps:8});assert.equal(await page.locator('.signalHeadLink').count(),1);if(cancel)await page.keyboard.press('Escape');await page.mouse.up();if(share)await page.keyboard.up('Shift');
  };
  await link(1);saved=await page.evaluate(()=>StripeMaker.sheets.selected.intersections[0].trafficSignal.heads[0]);assert.equal(saved.movement,fixture.keys[1]);assert.equal(saved.at,30,'linking does not move the head');
  await link(2,true);saved=await page.evaluate(()=>StripeMaker.sheets.selected.intersections[0].trafficSignal.heads[0]);assert.deepEqual(saved.sharedMovements,[fixture.keys[2]]);assert.equal(saved.movement,fixture.keys[1]);
  await link(0,false,true);assert.equal(await page.evaluate(()=>StripeMaker.sheets.selected.intersections[0].trafficSignal.heads[0].movement),fixture.keys[1]);
  assert.equal(await page.evaluate(()=>JSON.stringify(StripeMaker.sheets.selected.intersections[0].trafficSignal.assignments)),before,'head edits and linking preserve phases');
  await page.evaluate(()=>StripeMaker.history.undo());assert.deepEqual(await page.evaluate(()=>StripeMaker.sheets.selected.intersections[0].trafficSignal.heads[0].sharedMovements),[]);
  await page.evaluate(()=>StripeMaker.history.redo());
  await choose(right.locator('select[id^="signal-lens-symbol-"]').last(),'Bicycle');
  await choose(right.locator('select[id^="signal-lens-color-"]').last(),'Yellow');
  await choose(right.locator('select[id^="signal-lens-service-"]').last(),'Flashing yellow / yield');
  await page.locator('#signal-cell-1-2-button').click();await page.getByRole('option',{name:'FY · Flashing yellow — yield',exact:true}).click();
  await page.click('#playSimulation');
  await page.waitForFunction(()=>[...document.querySelector('[data-signal-part="head"]').querySelectorAll('g[stroke]')].some(g=>g.getAttribute('stroke')===StripeMakerSignalAssets.colors.yellow));
  await page.waitForFunction(()=>![...document.querySelector('[data-signal-part="head"]').querySelectorAll('g[stroke]')].some(g=>g.getAttribute('stroke')===StripeMakerSignalAssets.colors.yellow));
  await page.click('#pauseSimulation');
  await choose(right.locator('select[id^="signal-lens-symbol-"]').last(),'Bus go straight');
  await choose(right.locator('select[id^="signal-lens-service-"]').last(),'Automatic by color');
  await page.locator('#signal-cell-1-2-button').click();await page.getByRole('option',{name:'G · Green ball — turns yield',exact:true}).click();
  await page.click('#playSimulation');await page.waitForFunction(()=>[...document.querySelector('[data-signal-part="head"]').querySelectorAll('g[fill]')].some(g=>g.getAttribute('fill')===StripeMakerSignalAssets.colors.white&&g.querySelector('rect')));await page.click('#pauseSimulation');
  saved=await page.evaluate(()=>StripeMaker.sheets.selected.intersections[0].trafficSignal.heads[0]);
  const project=await page.evaluate(()=>StripeMaker.projectJSON.snapshot());await page.evaluate(p=>StripeMaker.projectJSON.load(p,{applySettings:false}),project);
  const restored=await page.evaluate(()=>StripeMaker.sheets.selected.intersections[0].trafficSignal.heads[0]);assert.deepEqual(restored.design,saved.design);assert.deepEqual(restored.sharedMovements,[fixture.keys[2]]);
  await page.evaluate(()=>{StripeMaker.showEditor('simulatorEditor');StripeMaker.signalEditor.select(StripeMaker.sheets.selected.intersections[0]);});await head.click({force:true});
  await right.getByRole('button',{name:'Close head editor',exact:true}).click();assert(await right.isHidden());assert(await page.locator('#simulatorEditor').isVisible());await head.click({force:true});
  await page.screenshot({path:'/tmp/stripemaker-head-editor-right.png'});
  await page.setViewportSize({width:390,height:844});assert(await right.isVisible());assert((await right.boundingBox()).width<=390);
  assert(await right.evaluate(e=>e.querySelector('.editorContent').scrollWidth<=e.querySelector('.editorContent').clientWidth+1),'narrow head panel has no horizontal overflow');
  await page.screenshot({path:'/tmp/stripemaker-head-editor-mobile.png'});assert.deepEqual(errors,[]);
  console.log('PASS right head editor: indication/layout controls, fixed housing, reorder, custom persistence, drag/shared links, cancel, undo/redo and narrow layout.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
