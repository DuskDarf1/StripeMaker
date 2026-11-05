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
  const data=await page.evaluate(()=>{
   StripeMaker.simulatorSignals.features.pedestrians=true;const A=StripeMaker,s=A.sheets.selected,G=A.intersectionGeometry,i=G.create();s.inchesPerPixel=12;s.view={x:-3100,y:-3500,scale:4,fitted:false};i.x=i.y=1000;i.name='Signal controller test';
   for(const a of i.approaches){a.incoming=a.outgoing=2;}G.normalize(i);
   i.movements=i.approaches.flatMap((a,j)=>[0,1].map(l=>G.movement(a,l,i.approaches[(j+2)%4],l)));
   s.intersections=[i];s.roads=[{id:1,lanes:1,laneWidth:12,ends:[{joint:1,sign:1},{joint:2,sign:1}]}];s.joints=[{id:1,x:1100,y:1200,dir:{x:1,y:0},root:1,links:[]},{id:2,x:1250,y:1200,dir:{x:1,y:0},root:1,links:[]}];s.vehicleSpawns=[{road:1,rate:0,routes:[{exit:{road:1,e:1},percent:100}]}];s.markings=[{id:'signal-stop',type:'stopLine',on:{intersection:i.id,approach:i.approaches[0].id,incoming:true,lane:i.approaches[0].inLanes[0]},back:5},{id:'walk',type:'crosswalk',a:{x:978,y:1035},b:{x:1022,y:1035},width:10}];
   A.showEditor('simulatorEditor');A.sheets.zoomBy(1);A.roadEditor.render();A.history.rebase();A.simulator.refreshOverlay();return {id:i.id,angles:i.approaches.map(a=>a.angle)};
  });
  const click=async p=>{const q=await page.evaluate(p=>{const q=StripeMaker.sheets.toScreen(p),r=document.getElementById('previewStage').getBoundingClientRect();return{x:q.x+r.left,y:q.y+r.top};},p);await page.mouse.click(q.x,q.y);};
  const screen=p=>page.evaluate(p=>{const q=StripeMaker.sheets.toScreen(p),r=document.getElementById('previewStage').getBoundingClientRect();return{x:q.x+r.left,y:q.y+r.top};},p);
  assert.equal(await page.locator('.simulatorRoute').count(),1,'saved exit route is shown before signal editing');
  await page.click('#addTrafficSignal');await click({x:1000,y:1000});assert(await page.locator('#signalEditorFields').isVisible());assert(await page.evaluate(()=>StripeMaker.simulator.signalEngine().controls.some(c=>c.type==='signal'&&c.marking==='signal-stop')),'signal uses painted stop bar without a STOP action');
  assert.equal(await page.locator('.simulatorRoute').count(),0,'opening a signal immediately hides exit routes');
  assert.equal(await page.locator('.simulatorRouteHit').count(),0,'hidden routes cannot intercept movement editing');
  assert.match(await page.locator('#signal-grid-maxGreen-2').getAttribute('data-help'),/another phase requests service/);
  assert.match(await page.locator('#signal-Recall-button').getAttribute('data-help'),/Soft requests/);
  const helpId=await page.locator('#signal-Recall-button').getAttribute('aria-describedby');assert.match(await page.locator('#'+helpId).textContent(),/None waits for a detector or manual call/);
  await page.getByRole('button',{name:'Close signal editor',exact:true}).click();assert.equal(await page.locator('.simulatorRoute').count(),1,'closing the editor restores saved exit routes');
  await page.locator('.simulatorSignal:not(.simulatorSignalTarget)').click();assert.equal(await page.locator('.simulatorRoute').count(),0,'reopening a configured signal hides routes');
  await page.evaluate(()=>StripeMaker.sheets.zoomBy(1));assert.equal(await page.locator('.simulatorRoute').count(),0,'view refresh retains hidden routes');
  await page.click('#signalAdd-arm');await click({x:975,y:1045});await click({x:1025,y:1045});assert.equal(await page.evaluate(()=>StripeMaker.sheets.selected.intersections[0].trafficSignal.arms.length),1);
  await page.click('#signalAdd-head');await click({x:1006.4,y:1045});await page.keyboard.press('Escape');
  let saved=await page.evaluate(()=>StripeMaker.sheets.selected.intersections[0].trafficSignal);assert.equal(saved.heads.length,1);assert(saved.heads[0].movement);assert(Math.abs(saved.heads[0].at-31.4167)<.2,'head snaps to a lane center');
  await page.locator('#signal-Head-type-button').click();await page.getByRole('option',{name:'Flashing yellow left · 4 sections',exact:true}).click();assert.equal(await page.locator('[data-signal-part="head"]').count(),1);
  const cell=page.locator('.signalCell .nativeSelectTrigger').first();
  const beforePreview=await page.evaluate(()=>JSON.stringify(StripeMaker.sheets.selected.intersections[0].trafficSignal));
  await cell.click();await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(()=>JSON.stringify(StripeMaker.sheets.selected.intersections[0].trafficSignal)),beforePreview,'opening a cell only previews; it does not change assignments');
  for(const [name,state] of [['G · Green ball — turns yield','green'],['GA · Protected green arrow','protected'],['FY · Flashing yellow — yield','permissive'],['FRA · Flashing red arrow — stop, then yield','flash-red-arrow'],['R · Red','red']]){await cell.click();await page.getByRole('option',{name,exact:true}).click();assert(await cell.evaluate((e,state)=>e.closest('td').classList.contains(state),state));}
  await cell.click();await page.getByRole('option',{name:'GA · Protected green arrow',exact:true}).click();
  assert.equal(await page.locator('.signalPhaseLabel').first().textContent(),'1');
  assert.equal(await page.locator('.signalMovementPreview').first().getAttribute('data-state'),'protected');
  await page.locator('#signal-grid-maxGreen-1').fill('35');await page.locator('#signal-grid-maxGreen-1').press('Tab');
  assert.equal(await page.evaluate(()=>StripeMaker.sheets.selected.intersections[0].trafficSignal.phases[0].maxGreen),35,'duration header edits the existing timing');
  await page.evaluate(()=>StripeMaker.history.undo());
  assert.equal(await page.evaluate(()=>StripeMaker.sheets.selected.intersections[0].trafficSignal.phases[0].maxGreen),30,'header edit is undoable');
  await page.evaluate(()=>StripeMaker.history.redo());
  await page.evaluate(()=>StripeMaker.showEditor('elementsEditor'));
  assert(await page.locator('.signalOverlay').isVisible(),'signal equipment remains visible outside Simulator');
  assert.equal(await page.locator('[data-signal-part="arm"]').count(),1);assert.equal(await page.locator('[data-signal-part="head"]').count(),1);
  assert.equal(await page.locator('.signalPhaseLabel').first().textContent(),'1','phase numbers remain visible');
  assert.equal(await page.locator('.signalMovementHit').count(),0,'movement editing stays in Simulator');
  assert.equal(await page.locator('.signalOverlay [tabindex]').count(),0,'passive equipment cannot capture keyboard focus');
  assert.equal(await page.locator('[data-signal-part="head"]').evaluate(e=>getComputedStyle(e).pointerEvents),'none','equipment does not block other editors');
  await page.screenshot({path:'/tmp/stripemaker-signals-persistent.png'});
  await page.evaluate(()=>{StripeMaker.showEditor('simulatorEditor');StripeMaker.signalEditor.select(StripeMaker.sheets.selected.intersections[0]);});
  // Changing the focused matrix cell must not restore the previous movement.
  for(const index of [7,0,6]){
    const target=await page.locator('.signalMovementHit').nth(index).evaluate(path=>{
      const key=path.dataset.signalMovement,transform=path.getScreenCTM(),length=path.getTotalLength();
      for(let n=1;n<20;n++){const p=path.getPointAtLength(length*n/20),q=new DOMPoint(p.x,p.y).matrixTransform(transform);if(document.elementFromPoint(q.x,q.y)?.closest('[data-signal-movement]')?.dataset.signalMovement===key)return {key,x:q.x,y:q.y};}
      throw new Error('No exposed point on movement '+key);
    });
    await page.mouse.click(target.x,target.y);
    await page.waitForFunction(key=>document.querySelector('.signalPhaseGrid tr.selected')?.dataset.movementRow===key,target.key);
    assert.equal(await page.locator('.symbolPickerMenu.open').count(),0,'jumping to a movement does not open a blocking picker');
  }
  await page.getByRole('button',{name:'Edit phase 8',exact:true}).click();
  const phase8=await page.evaluate(()=>structuredClone(StripeMaker.sheets.selected.intersections[0].trafficSignal.phases[7]));
  assert(await page.locator('#signalAddPhase').isDisabled(),'all eight slots initially enabled');
  await page.locator('#signalRemovePhase').click();assert.equal(await page.locator('[data-phase-header]').count(),7);
  await page.locator('#signalAddPhase').click();assert.equal(await page.locator('[data-phase-header]').count(),8);
  assert.deepEqual(await page.evaluate(()=>StripeMaker.sheets.selected.intersections[0].trafficSignal.phases[7]),phase8,'adding restores saved phase settings');
  await page.getByRole('button',{name:'Edit phase 2',exact:true}).click();
  assert.equal(await page.locator('.signalMovementPreview').first().getAttribute('data-state'),'red','preview follows the selected phase without changing its assignment');
  await page.locator('#signal-grid-minGreen-2').fill('6');await page.locator('#signal-grid-minGreen-2').press('Tab');
  assert.equal(await page.evaluate(()=>StripeMaker.sheets.selected.intersections[0].trafficSignal.phases[1].minGreen),6);
  await page.locator('#signal-Pedestrian-mode-button').click();await page.getByRole('option',{name:'Rest in walk',exact:true}).click();
  await page.locator('#signal-Pedestrian-recall').check();assert.equal(await page.evaluate(()=>StripeMaker.sheets.selected.intersections[0].trafficSignal.phases[1].pedMode),'rest');
  assert.equal(await page.evaluate(()=>StripeMaker.sheets.selected.intersections[0].trafficSignal.phases[1].pedRecall),true);await page.locator('#signal-Pedestrian-recall').uncheck();
  await page.locator('#signal-Leading-pedestrian-interval--sec-').fill('3');await page.locator('#signal-Leading-pedestrian-interval--sec-').press('Tab');
  await page.locator('#signal-Recall-button').click();await page.getByRole('option',{name:'Soft (rest when no conflicting calls)',exact:true}).click();
  assert.equal(await page.evaluate(()=>StripeMaker.sheets.selected.intersections[0].trafficSignal.phases[1].recall),'soft');
  assert.equal(await page.locator('.simulatorRoute').count(),0,'signal edits keep route arrows hidden');
  assert.equal(await page.locator('#signalIndicationLegend .signalIndicationIcon').count(),4,'legend uses real indication artwork');
  await cell.click();assert.equal(await page.locator('.symbolPickerMenu.open .signalIndicationIcon').count(),5,'each indication choice has SignalMaker artwork');await page.keyboard.press('Escape');
  const flashing=page.locator('#signalIndicationLegend .signalFlashingLamp').first();
  const opacity=await flashing.evaluate(e=>getComputedStyle(e).opacity);await page.waitForFunction(([selector,opacity])=>getComputedStyle(document.querySelector(selector)).opacity!==opacity,['#signalIndicationLegend .signalFlashingLamp',opacity]);
  await page.getByRole('button',{name:'Edit phase 2',exact:true}).click();
  await page.click('#signalAdd-detector');
  const lane=await page.evaluate(()=>{const m=StripeMaker.intersections.simulatorNetwork(StripeMaker.sheets.selected).movements.find(m=>m.points[0].x>1040);const a=m.points[0],b=m.points[1],l=Math.hypot(b.x-a.x,b.y-a.y);return {a:{x:a.x-(b.x-a.x)/l*5,y:a.y-(b.y-a.y)/l*5},b:{x:a.x-(b.x-a.x)/l*20,y:a.y-(b.y-a.y)/l*20}};});
  const a=await screen(lane.a),b=await screen(lane.b);await page.keyboard.down('Shift');await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:5});await page.mouse.up();await page.keyboard.up('Shift');
  saved=await page.evaluate(()=>StripeMaker.sheets.selected.intersections[0].trafficSignal);assert.equal(saved.detectors.length,1);assert(saved.detectors[0].width>=23.9);assert(Math.abs(saved.detectors[0].length-15)<.1);
  assert.equal(await page.locator('.signalDetectorPhase').textContent(),String(saved.detectors[0].phase));
  await page.locator('#signal-Detector-phase-4').check();if(saved.detectors[0].phase!==4)await page.locator('#signal-Detector-phase-'+saved.detectors[0].phase).uncheck();
  assert.equal(await page.locator('.signalDetectorPhase').textContent(),'4','detector number updates with its assigned phase');
  const missingHelp=await page.locator('#signalEditorFields').evaluate(root=>[...root.querySelectorAll('input,select')].filter(e=>!e.dataset.help||!e.getAttribute('aria-describedby')).map(e=>e.id||e.outerHTML));
  assert.deepEqual(missingHelp,[],'every signal setting has a tooltip and accessible explanation');
  assert.match(await page.locator('#signal-Lock-detector-call').getAttribute('data-help'),/On:.*Off:.*For example/);

  await page.click('#signalAdd-ped');const ends=await page.evaluate(()=>StripeMaker.markings.outlines('walk'));assert(ends.flat().length,'crosswalk footprint');
  await click({x:1022,y:1035});assert.equal(await page.evaluate(()=>StripeMaker.sheets.selected.intersections[0].trafficSignal.peds.length),1);
  await page.evaluate(()=>{StripeMaker.simulatorSignals.features.pedestrians=true;const A=StripeMaker,i=A.sheets.selected.intersections[0];i.trafficSignal.phases[1].recall='none';A.simulator.editSignal('Detector test');});
  await page.click('#playSimulation');assert(await page.locator('#signalAdd-arm').isDisabled());await page.waitForTimeout(200);
  assert(await page.evaluate(()=>StripeMaker.simulator.diagnostics().running),'signals run without vehicle spawns');
  const ped=page.locator('[data-signal-part="ped"]');await ped.focus();await page.keyboard.press('Enter');
  assert(await page.evaluate(()=>{const c=StripeMaker.simulator.signalEngine().signals.records.values().next().value.controller;return c.pedCalls.has(2)||c.rings.some(r=>r.phase===2&&r.ped);}),'ped head submits call');
  assert.equal(await page.locator('#toggleSignalPreemption').count(),0);assert(!/preempt/i.test(await page.locator('#simulatorEditor').innerText()));await page.click('#pauseSimulation');
  const project=await page.evaluate(()=>StripeMaker.projectJSON.snapshot());await page.evaluate(p=>StripeMaker.projectJSON.load(p,{applySettings:false}),project);
  saved=await page.evaluate(()=>StripeMaker.sheets.selected.intersections[0].trafficSignal);assert.equal(saved.heads[0].type,'fya-left');assert.equal(saved.detectors.length,1);assert.equal(saved.peds.length,1);
  await page.evaluate(()=>{StripeMaker.showEditor('simulatorEditor');StripeMaker.signalEditor.select(StripeMaker.sheets.selected.intersections[0]);});
  await page.locator('#simulatorEditor .editorContent').evaluate(e=>e.scrollTop=0);
  assert(await page.locator('.signalGridScroll').evaluate(e=>e.scrollWidth<=e.clientWidth+1),'all eight columns fit the desktop panel');await page.screenshot({path:'/tmp/stripemaker-signal-editor.png'});await page.setViewportSize({width:390,height:844});
  const box=await page.locator('#simulatorEditor').boundingBox();assert(box.x>=0&&box.x+box.width<=391,'narrow panel stays on screen');await page.screenshot({path:'/tmp/stripemaker-signal-editor-mobile.png'});
  await page.waitForTimeout(700);await page.reload();await page.waitForFunction(()=>StripeMaker.sheets.ready);assert.equal(await page.evaluate(()=>StripeMaker.sheets.selected.intersections[0].trafficSignal.heads.length),1);assert(await page.locator('.signalOverlay').isVisible(),'saved equipment renders after reload with Simulator closed');assert.equal(await page.locator('.signalPhaseLabel').first().textContent(),'1');assert.deepEqual(errors,[]);
  console.log('PASS signal editor: persistent equipment and phase labels, explicit color picker and previews, timing headers and undo/redo, mast/head placement, detection, pedestrian calls, JSON/reload, desktop/mobile layout.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
