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
   const c=M.normalize();c.mode='fixed';for(const p of c.phases){p.enabled=[1,2,3].includes(p.id);p.recall='min';p.minGreen=.3;p.yellow=.3;p.red=.2;p.split=1.2;}
   const keys=[`${a.inLanes[0]}>${left.outLanes[0]}`,`${opposite.inLanes[0]}>${a.outLanes[0]}`,`${a.inLanes[0]}>${right.outLanes[0]}`];
   c.assignments=Object.fromEntries(keys.map((k,n)=>[k,{phase:0,greenMode:'auto',permissive:[],overlap:[],flashingRed:[],noTurnOnRed:true}]));
   c.arms=[{id:'arm',x:-25,y:45,angle:0,length:50}];c.heads=[{id:'head',arm:'arm',at:30,type:'fya-left',movement:keys[0],auto:true,angle:0}];i.trafficSignal=c;s.intersections=[i];A.showEditor('simulatorEditor');A.sheets.zoomBy(1);A.roadEditor.render();A.simulator.refreshOverlay();A.signalEditor.select(i);A.history.rebase();return {keys,id:i.id};
  });
  const choose=async(phase,name,row=0)=>{await page.locator(`#signal-cell-${row}-${phase}-button`).click();await page.getByRole('option',{name,exact:true}).click();};
  const values=()=>page.evaluate(()=>[1,2,3].map(n=>document.querySelector(`#signal-cell-0-${n}`).value));
  await choose(1,'FY · Flashing yellow — yield');await choose(2,'FY · Flashing yellow — yield');
  assert.deepEqual(await values(),['permissive','permissive','red']);
  await choose(1,'G · Protected green',1);
  assert.equal(await page.locator('#signal-cell-1-1-button .signalIndicationIcon polygon').count(),0,'through protection uses a circle, not an up arrow');
  assert(await page.locator('#signal-cell-1-1-button .signalIndicationIcon circle').count()>1);
  await choose(1,'R · Red',1);
  await page.evaluate(()=>{window.flashSamples=[];window.flashTimer=setInterval(()=>{StripeMaker.signalEditor.tick(true);const c=StripeMaker.signalEditor.diagnostics().controllers[0],r=c?.rings[0],line=document.querySelector('.signalMovementPreview'),head=document.querySelector('[data-signal-part="head"]');if(r)flashSamples.push({phase:r.phase,state:r.state,aspect:line?.dataset.state,opacity:line?.getAttribute('stroke-opacity'),yellow:[...head.querySelectorAll('[fill]')].some(e=>e.getAttribute('fill')===StripeMakerSignalAssets.colors.yellow),arrow:[...head.querySelectorAll('g[fill]')].some(e=>e.getAttribute('fill')===StripeMakerSignalAssets.colors.yellow&&e.querySelector('polygon'))});},16);});
  await page.click('#playSimulation');await page.waitForFunction(()=>flashSamples.some(s=>s.phase===3));await page.click('#pauseSimulation');
  const samples=await page.evaluate(()=>{clearInterval(flashTimer);return flashSamples;});require('node:fs').writeFileSync('/tmp/flashing-yellow-samples.json',JSON.stringify(samples));
  for(const state of ['yellow','red'])assert(samples.some(s=>s.phase===1&&s.state===state&&s.aspect==='permissive'),`flashing service continues through parent ${state}`);
  const carried=samples.filter(s=>s.phase===1||s.phase===2&&s.state==='green');assert(carried.every(s=>s.aspect==='permissive'));
  for(const opacity of ['1','0.08'])assert(carried.some(s=>Number(s.opacity)===Number(opacity)&&s.yellow===(opacity==='1')),'head and line keep flashing together');
  const yellow=samples.filter(s=>s.phase===2&&s.state==='yellow');assert(yellow.length>5);assert(yellow.every(s=>s.aspect==='yellow'&&s.opacity==null&&s.yellow&&s.arrow),'full steady-yellow arrow and line clearance');
  assert(samples.some(s=>s.phase===2&&s.state==='red'&&s.aspect==='red'&&!s.yellow));
  const project=await page.evaluate(()=>StripeMaker.projectJSON.snapshot());await page.evaluate(p=>StripeMaker.projectJSON.load(p,{applySettings:false}),project);
  await page.evaluate(()=>{StripeMaker.showEditor('simulatorEditor');StripeMaker.signalEditor.select(StripeMaker.sheets.selected.intersections[0]);});
  assert.deepEqual(await values(),['permissive','permissive','red'],'project round-trip keeps flashing assignments');
  await page.screenshot({path:'/tmp/stripemaker-continuous-flashing-yellow.png'});assert.deepEqual(errors,[]);
  console.log('PASS flashing-yellow continuity, steady clearance, live head/path flashing, circular through symbols and persistence.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
