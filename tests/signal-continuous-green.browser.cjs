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
  const choose=async(phase,name)=>{await page.locator(`#signal-cell-0-${phase}-button`).click();await page.getByRole('option',{name,exact:true}).click();};
  const values=()=>page.evaluate(()=>[1,2,3].map(n=>document.querySelector(`#signal-cell-0-${n}`).value));
  await choose(1,'G · Green ball — turns yield');await choose(2,'G · Green ball — turns yield');
  assert.deepEqual(await values(),['green','green','red'],'second green keeps the first green');
  await choose(2,'GA · Protected green arrow');assert.deepEqual(await values(),['green','protected','red'],'each cell keeps its own indication type');
  await choose(2,'R · Red');assert.deepEqual(await values(),['green','red','red']);
  await page.evaluate(()=>StripeMaker.history.undo());assert.deepEqual(await values(),['green','protected','red']);
  await page.evaluate(()=>StripeMaker.history.redo());assert.deepEqual(await values(),['green','red','red']);
  await choose(2,'G · Green ball — turns yield');
  assert.match(await page.locator('#signalMovementSettings').textContent(),/Green in phases: 1, 2/);
  await page.evaluate(()=>{window.greenSamples=[];window.greenTimer=setInterval(()=>{const c=StripeMaker.signalEditor.diagnostics().controllers[0],r=c?.rings[0],line=document.querySelector('.signalMovementPreview'),head=document.querySelector('[data-signal-part="head"]');if(r)greenSamples.push({phase:r.phase,state:r.state,aspect:line?.dataset.state,head:head?.getAttribute('aria-label')});},16);});
  await page.click('#playSimulation');await page.waitForFunction(()=>greenSamples.some(s=>s.phase===3));await page.click('#pauseSimulation');
  const samples=await page.evaluate(()=>{clearInterval(greenTimer);return greenSamples;});
  for(const state of ['yellow','red'])assert(samples.some(s=>s.phase===1&&s.state===state&&s.aspect==='green'&&s.head.includes('green ball')),`movement and head stay green through phase 1 ${state}`);
  assert(samples.some(s=>s.phase===2&&s.state==='green'&&s.aspect==='green'));
  assert(samples.some(s=>s.phase===2&&s.state==='yellow'&&s.aspect==='yellow'),'yellow starts at the end of the green run');
  assert(samples.some(s=>s.phase===2&&s.state==='red'&&s.aspect==='red'),'red clearance still runs at the end');
  const project=await page.evaluate(()=>StripeMaker.projectJSON.snapshot());await page.evaluate(p=>StripeMaker.projectJSON.load(p,{applySettings:false}),project);
  await page.evaluate(()=>{StripeMaker.showEditor('simulatorEditor');StripeMaker.signalEditor.select(StripeMaker.sheets.selected.intersections[0]);});
  assert.deepEqual(await values(),['green','green','red'],'project round-trip keeps all grid greens');
  await page.screenshot({path:'/tmp/stripemaker-continuous-green.png'});assert.deepEqual(errors,[]);
  console.log('PASS continuous-green grid: independent cells, glyphs, undo/redo, live head/path continuity, final clearance and project persistence.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
