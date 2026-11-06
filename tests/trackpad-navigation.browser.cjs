const assert=require('node:assert/strict'),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{const b=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});try{
 const p=await b.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));await p.goto(process.env.STRIPEMAKER_URL||'http://127.0.0.1:8884');await p.waitForFunction(()=>StripeMaker.sheets.ready);await p.locator('#blankSheet').evaluate(e=>e.click());await p.waitForFunction(()=>StripeMaker.sheets.selected);
 const view=()=>p.evaluate(()=>({...StripeMaker.sheets.selected.view}));
 const wheel=(dy,legacy,dx=0,mode=0,ctrl=false)=>p.evaluate(({dy,legacy,dx,mode,ctrl})=>{const e=new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaY:dy,deltaX:dx,deltaMode:mode,ctrlKey:ctrl,clientX:600,clientY:400});if(legacy!==null)Object.defineProperty(e,'wheelDeltaY',{value:legacy});document.querySelector('#workspace').dispatchEvent(e);},{dy,legacy,dx,mode,ctrl});
 const before=await view();
 await wheel(2.51,-8);await wheel(10,-29);await wheel(40,-120);await wheel(100,-120);await wheel(-.23,1,2.1);
 const after=await view();assert.equal(after.scale,before.scale,'rounded legacy values and large momentum events never zoom during a pan');assert(Math.abs(after.y-(before.y-152.28))<1e-6);assert(Math.abs(after.x-(before.x-2.1))<1e-6);
 await p.waitForTimeout(320);const mouse=await view();await wheel(100,-120);assert((await view()).scale<mouse.scale,'discrete mouse wheel still zooms');
 const pinch=await view();await wheel(-10,null,0,0,true);assert((await view()).scale>pinch.scale,'trackpad pinch still zooms');
 const line=await view();await wheel(3,-120,0,1);assert((await view()).scale<line.scale,'line-mode wheel still zooms');
 const pixel=await view();await wheel(5,null);assert.equal((await view()).scale,pixel.scale,'pixel scroll without legacy deltas pans');assert.deepEqual(errors,[]);
 console.log('PASS: rounded two-finger and momentum scrolls pan; mouse wheel, line wheel and pinch retain zoom.');
}finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1});
