const assert=require('node:assert/strict'),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{const b=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});try{
 const p=await b.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));await p.goto(process.env.STRIPEMAKER_URL||'http://127.0.0.1:8884');await p.waitForFunction(()=>StripeMaker.sheets.ready);await p.locator('#blankSheet').evaluate(e=>e.click());await p.waitForFunction(()=>StripeMaker.sheets.selected);
 const view=()=>p.evaluate(()=>({...StripeMaker.sheets.selected.view}));
 const wheel=(dy,legacy,dx=0,mode=0,ctrl=false)=>p.evaluate(({dy,legacy,dx,mode,ctrl})=>{const e=new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaY:dy,deltaX:dx,deltaMode:mode,ctrlKey:ctrl,clientX:600,clientY:400});Object.defineProperty(e,'wheelDeltaY',{value:legacy??undefined});document.querySelector('#workspace').dispatchEvent(e);},{dy,legacy,dx,mode,ctrl});
 const before=await view();
 await wheel(2.51,-8);await wheel(10,-29);await wheel(40,-120);await wheel(100,-120);await wheel(-.23,1,2.1);
 const after=await view();assert.equal(after.scale,before.scale,'rounded legacy values and large momentum events never zoom during a pan');assert(Math.abs(after.y-(before.y-152.28))<1e-6);assert(Math.abs(after.x-(before.x-2.1))<1e-6);
 await p.waitForTimeout(320);const mouse=await view();await wheel(100,-120);assert((await view()).scale<mouse.scale,'discrete mouse wheel still zooms');
 for(const [delta,legacy] of [[40,-120],[-40,120],[80,-240],[33.333,-120],[100,null],[100,-100]]){
  const previous=await view();await wheel(delta,legacy);
  assert(delta>0?(await view()).scale<previous.scale:(await view()).scale>previous.scale,`mouse wheel zooms: delta ${delta}, legacy ${legacy}`);
 }
 const pinch=await view();await wheel(-10,null,0,0,true);assert((await view()).scale>pinch.scale,'trackpad pinch still zooms');
 const line=await view();await wheel(3,-120,0,1);assert((await view()).scale<line.scale,'line-mode wheel still zooms');
 const pixel=await view();await wheel(5,null);assert.equal((await view()).scale,pixel.scale,'pixel scroll without legacy deltas pans');assert.deepEqual(errors,[]);
 const choose=require('./select-choice.cjs');
 await p.locator('[data-editor="settingsMenu"]').click();
 await choose(p.locator('#scrollWheelMode'),'zoom');
 const forcedZoom=await view();await wheel(5,null,2);assert((await view()).scale<forcedZoom.scale,'Zoom overrides smooth/diagonal events and a previous pan burst');
 await choose(p.locator('#scrollWheelMode'),'pan');
 const forcedPan=await view();await wheel(100,-120);assert.equal((await view()).scale,forcedPan.scale,'Pan overrides discrete wheel events');assert.equal((await view()).y,forcedPan.y-100);
 const forcedPinch=await view();await wheel(-10,null,0,0,true);assert((await view()).scale>forcedPinch.scale,'pinch still zooms in Pan mode');
 await choose(p.locator('#scrollWheelMode'),'zoom');
 await p.evaluate(()=>StripeMaker.sheets.flush());await p.reload();await p.waitForFunction(()=>StripeMaker.sheets.ready);
 assert.equal(await p.evaluate(()=>StripeMaker.settings.get('scrollWheelMode')),'zoom');
 const restored=await view();await wheel(-3,null);assert((await view()).scale>restored.scale,'saved Zoom mode works after reload');
 const exported=await p.evaluate(()=>StripeMaker.projectJSON.snapshot());assert.equal(exported.settings.scrollWheelMode,'zoom');
 exported.settings.scrollWheelMode='pan';
 await p.evaluate(project=>StripeMaker.projectJSON.load(project),exported);
 assert.equal(await p.evaluate(()=>StripeMaker.settings.get('scrollWheelMode')),'zoom','settings import stays opt-in');
 await p.evaluate(project=>StripeMaker.projectJSON.load(project,{applySettings:true}),exported);
 assert.equal(await p.evaluate(()=>StripeMaker.settings.get('scrollWheelMode')),'pan');
 assert.deepEqual(errors,[]);
 console.log('PASS: automatic navigation, explicit Zoom/Pan UI, pinch, reload and optional project settings import.');
}finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1});
