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
   const c=M.normalize();c.mode='fixed';for(const p of c.phases){p.enabled=[1,2,3].includes(p.id);p.recall='min';p.minGreen=1;p.yellow=.5;p.red=.5;p.split=3;}
   const keys=[`${a.inLanes[0]}>${left.outLanes[0]}`,`${opposite.inLanes[0]}>${a.outLanes[0]}`,`${a.inLanes[0]}>${right.outLanes[0]}`];
   c.assignments=Object.fromEntries(keys.map((k,n)=>[k,{phase:0,greenMode:'auto',permissive:[],overlap:[],flashingRed:[],noTurnOnRed:true}]));
   c.arms=[{id:'arm',x:-25,y:45,angle:0,length:50}];c.heads=[{id:'head',arm:'arm',at:30,type:'fya-left',movement:keys[0],auto:true,angle:0}];M.setPhaseMode(c,keys[0],1,'green');M.setPhaseMode(c,keys[0],2,'green');c.assignments[keys[2]].flashingRedArrows=[1,2];
   c.detectors=[{id:'detector',x:60,y:0,angle:0,length:10,width:8,phase:1,delay:0,extend:0,memory:true}];
   i.trafficSignal=c;const other=G.create();other.x=1450;other.y=1000;G.normalize(other);other.movements=[G.movement(other.approaches[0],0,other.approaches[2],0)];const second=M.normalize();for(const p of second.phases)p.enabled=p.id===2;second.assignments[`${other.approaches[0].inLanes[0]}>${other.approaches[2].outLanes[0]}`]={phase:0,greenMode:'auto',permissive:[2],overlap:[]};other.trafficSignal=second;s.intersections=[i,other];A.showEditor('simulatorEditor');A.sheets.zoomBy(1);A.roadEditor.render();A.simulator.refreshOverlay();A.signalEditor.select(i);A.history.rebase();return {keys,id:i.id};
  });
  assert.equal(await page.evaluate(()=>StripeMaker.signalFeatures.mastHeads),false);
  assert.equal(await page.locator('#signalAdd-arm,#signalAdd-head,[data-signal-part="arm"],[data-signal-part="head"]').count(),0);
  await page.locator('#signal-cell-0-1-button').click();await page.keyboard.press('Escape');
  assert.equal(await page.getByText('Heads serving this movement',{exact:true}).count(),0);
  assert.equal(await page.locator('#signalHeadEditor:not([hidden])').count(),0);
  assert(await page.locator('#signalAdd-detector').isVisible(),'detection editor remains available');
  const equipment=await page.evaluate(()=>{const c=StripeMaker.sheets.selected.intersections[0].trafficSignal;return JSON.stringify([c.arms,c.heads,c.detectors]);});
  await page.evaluate(()=>{window.phaseSamples=[];window.phaseTimer=setInterval(()=>{const c=StripeMaker.signalEditor.diagnostics().controllers[0],r=c?.rings[0],lines=[...document.querySelectorAll('.signalMovementPreview')];if(r)phaseSamples.push({phase:r.phase,state:r.state,aspect:lines[0]?.dataset.state});},16);});
  await page.click('#playSimulation');await page.click('#minimizeSimulator');
  assert(await page.locator('#simulatorContent').isHidden());assert(await page.locator('#pauseMinimizedSimulation').isVisible());assert.equal(await page.locator('#minimizeSimulator').getAttribute('aria-expanded'),'false');
  assert((await page.locator('#simulatorEditor').boundingBox()).height<90,'minimized panel is just a compact bar');
  assert.equal(await page.locator('.signalMovementPreview').count(),4,'all signalized intersections show live paths');
  assert.equal(await page.locator('.signalEquipment,.signalPhaseLabel,.simulatorSignal,.signalMovementHit').count(),0,'playback shows phase paths without equipment or editing targets');
  for(const state of ['permissive','flash-red'])for(const opacity of ['1','0.08'])await page.waitForFunction(([state,opacity])=>[...document.querySelectorAll('.signalMovementPreview')].some(p=>p.dataset.state===state&&p.getAttribute('stroke-opacity')===opacity),[state,opacity]);
  await page.waitForFunction(()=>phaseSamples.some(s=>s.phase===1&&s.state==='yellow'&&s.aspect==='green'));
  await page.waitForFunction(()=>phaseSamples.some(s=>s.phase===2&&s.state==='yellow'&&s.aspect==='yellow'));
  await page.waitForFunction(()=>phaseSamples.some(s=>s.phase===3&&s.aspect==='red'));await page.evaluate(()=>clearInterval(phaseTimer));
  await page.click('#minimizeSimulator');assert(await page.locator('#simulatorContent').isVisible());assert.equal(await page.locator('#minimizeSimulator').getAttribute('aria-expanded'),'true');
  await page.getByRole('button',{name:'Close signal editor',exact:true}).click();assert.equal(await page.locator('.signalMovementPreview').count(),4,'paths remain when the phase editor closes');
  await page.click('#minimizeSimulator');await page.screenshot({path:'/tmp/stripemaker-simulator-minimized.png'});
  await page.click('#pauseMinimizedSimulation');assert(await page.locator('#simulatorContent').isVisible());assert(await page.locator('#minimizeSimulator').isHidden());assert(await page.locator('#playSimulation').isEnabled());
  assert.equal(await page.locator('[data-signal-part="arm"],[data-signal-part="head"]').count(),0);
  assert.equal(await page.evaluate(()=>{const c=StripeMaker.sheets.selected.intersections[0].trafficSignal;return JSON.stringify([c.arms,c.heads,c.detectors]);}),equipment,'disabled equipment data is preserved');
  const project=await page.evaluate(()=>StripeMaker.projectJSON.snapshot());await page.evaluate(p=>StripeMaker.projectJSON.load(p,{applySettings:false}),project);
  assert.equal(await page.evaluate(()=>{const c=StripeMaker.sheets.selected.intersections[0].trafficSignal;return JSON.stringify([c.arms,c.heads,c.detectors]);}),equipment,'saved projects retain disabled equipment');
  await page.click('#playSimulation');await page.click('#minimizeSimulator');await page.setViewportSize({width:390,height:844});assert((await page.locator('#simulatorEditor').boundingBox()).width<=390);await page.click('#pauseMinimizedSimulation');
  assert.deepEqual(errors,[]);console.log('PASS movement-only playback: equipment disabled/preserved, all intersections, phase transitions, flashing, minimize/restore/pause and narrow layout.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
