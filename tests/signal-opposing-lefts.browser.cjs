const assert=require('node:assert/strict'),path=require('node:path'),{pathToFileURL}=require('node:url');
const P=require(process.env.PLAYWRIGHT_MODULE||'playwright'),fixture=require('./fixtures/signal-opposing-lefts.json');
(async()=>{
 const webkit=process.env.BROWSER==='webkit',browser=await P[webkit?'webkit':'chromium'].launch({headless:true,executablePath:webkit?process.env.WEBKIT_PATH:process.env.CHROME_PATH});
 try{
  const page=await browser.newPage({viewport:{width:1500,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.STRIPEMAKER_URL||pathToFileURL(path.resolve(__dirname,'../index.html')).href);await page.waitForFunction(()=>StripeMaker.sheets.ready);
  await page.locator('#blankSheet').evaluate(b=>b.click());await page.waitForFunction(()=>StripeMaker.sheets.selected);
  const before=await page.evaluate(f=>{
   const A=StripeMaker,s=A.sheets.selected,i=f.intersection,c=i.trafficSignal;
   s.inchesPerPixel=f.inchesPerPixel;s.intersections=[i];s.view={x:-i.x*.5+900,y:-i.y*.5+450,scale:.5,fitted:false};
   // Existing pedestrian settings and a real crosswalk remain stored but inactive.
   s.markings=[{id:'walk',type:'crosswalk',a:{x:i.x-40,y:i.y+500},b:{x:i.x+40,y:i.y+500},width:10}];
   c.peds=[{id:'ped',marking:'walk',end:0,phase:3,countdown:true}];Object.assign(c.phases[2],{pedMode:'rest',pedRecall:true,pedExclusive:true,pedLead:20,walk:90,pedClear:90,pedBuffer:30});
   A.showEditor('simulatorEditor');A.sheets.zoomBy(1);A.roadEditor.render();A.simulator.refreshOverlay();A.signalEditor.select(i);A.history.rebase();return JSON.stringify(c);
  },fixture);
  const result=await page.evaluate(()=>{const A=StripeMaker,M=A.simulatorSignals,s=A.sheets.selected,i=s.intersections[0],moves=A.intersections.simulatorNetwork(s).movements;return {pedestrians:M.features.pedestrians,errors:M.conflictErrors(M.normalize(i.trafficSignal),moves),types:moves.slice(2,4).map(M.movementType),crosses:M.crosses(moves[2].points,moves[3].points),phases:moves.slice(2,4).map(m=>M.phaseMode(i.trafficSignal,m,3))};});
  assert.deepEqual(result,{pedestrians:false,errors:[],types:['left','left'],crosses:true,phases:['green','green']});
  assert.equal(await page.locator('.signalErrors').count(),0);
  assert.equal(await page.locator('#toggleSignalPreemption,#signalAdd-ped,#signal-Pedestrian-recall,#signal-Pedestrian-mode,#signal-Walk--sec-,[data-signal-part="ped"]').count(),0);
  assert(!/preempt|pedestrian|flashing hand|rest in walk/i.test(await page.locator('#signalEditorFields').innerText()));
  await page.click('#playSimulation');
  await page.waitForFunction(()=>StripeMaker.signalEditor.diagnostics().controllers.some(c=>c.rings.some(r=>r.phase===3&&r.state==='green')),{},{timeout:30000});
  const runtime=await page.evaluate(()=>{const A=StripeMaker,ctl=A.simulator.signalEngine().signals.records.values().next().value.controller;ctl.requestPed(3);return {errors:ctl.errors,pedCalls:[...ctl.pedCalls],ped:ctl.rings.some(r=>r.ped),configPreemption:Object.hasOwn(ctl.config,'preemption')};});
  assert.deepEqual(runtime,{errors:[],pedCalls:[],ped:false,configPreemption:false});
  await page.click('#pauseSimulation');
  const after=await page.evaluate(()=>JSON.stringify(StripeMaker.sheets.selected.intersections[0].trafficSignal));assert.equal(after,before);
  const project=await page.evaluate(()=>StripeMaker.projectJSON.snapshot());await page.evaluate(p=>StripeMaker.projectJSON.load(p,{applySettings:false}),project);
  assert.equal(await page.evaluate(()=>JSON.stringify(StripeMaker.sheets.selected.intersections[0].trafficSignal)),before);
  await page.screenshot({path:'/tmp/stripemaker-opposing-lefts.png'});assert.deepEqual(errors,[]);
  console.log('PASS saved offset left turns: green balls accepted, actual playback, preemption absent, pedestrians inactive and saved settings preserved.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
