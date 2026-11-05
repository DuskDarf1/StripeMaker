// Isolated browser: sign gestures must retain every edit, paint once per frame,
// and leave the rest of a connected drawing intact. No user project is touched.
const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
 try {
  const page=await browser.newPage({viewport:{width:1500,height:1100}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.STRIPEMAKER_URL||'http://127.0.0.1:8883');await page.waitForFunction(()=>StripeMaker.sheets.ready);
  await page.locator('#blankSheet').evaluate(b=>b.click());await page.waitForFunction(()=>StripeMaker.sheets.selected);
  await page.evaluate(async()=>{
   const A=StripeMaker,s=A.sheets.selected;s.inchesPerPixel=12;
   s.roads=[{id:1,lanes:2,laneWidth:12,ends:[{joint:1,sign:1},{joint:2,sign:1}]}];
   s.joints=[{id:1,x:500,y:700,links:[]},{id:2,x:1300,y:700,links:[]}];
   s.signs=[{id:'moving',text:'TEST',x:950,y:400,postX:900,postY:650,width:120,size:100},
    {id:'still',text:'UNCHANGED',x:1150,y:600,postX:1200,postY:700,width:110,size:100}];
   s.view={scale:1,x:0,y:0,fitted:false};A.sheets.zoomBy(1);await A.signs.ready(s);A.signs.focus('moving');A.history.rebase();
  });
  for(const part of ['face','post','arrowRotate'])for(const endType of ['pointerup','pointercancel']) {
   const handle=page.locator(`.signOverlay button[data-sign="moving"][data-part="${part}"]`),b=await handle.boundingBox(),x=b.x+b.width/2,y=b.y+b.height/2;
   await page.evaluate(()=>document.addEventListener('pointerdown',e=>window.testPointer=e.pointerId,{once:true,capture:true}));
   await page.mouse.move(x,y);await page.mouse.down();
   const result=await handle.evaluate((button,{x,y,endType})=>{
    const A=StripeMaker,s=A.sheets.selected,sign=s.signs[0],before=structuredClone(sign),raf=window.requestAnimationFrame,cancel=window.cancelAnimationFrame,render=A.roadEditor.renderSigns;
    if(!render)throw Error('Missing sign-only renderer');
    const pending=new Map(),poses=[],road=s.roadLayer.querySelector('.roadBand'),still=s.roadLayer.querySelector('[data-sign="still"]'),signGroup=s.roadLayer.querySelector('[data-sign="moving"]');
    const stillPaths=still.firstChild;let next=1000000,renders=0;
    window.requestAnimationFrame=f=>{const id=next++;pending.set(id,f);return id;};
    window.cancelAnimationFrame=id=>{if(!pending.delete(id))cancel.call(window,id);};
    A.roadEditor.renderSigns=function(...args){renders++;return render.apply(this,args);};
    const move=dx=>{button.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:testPointer,isPrimary:true,buttons:1,clientX:x+dx,clientY:y+dx/3}));poses.push(JSON.stringify(sign));};
    try {
     move(10);move(20);move(30);const queued={count:pending.size,renders};
     for(const[id,f]of[...pending]){pending.delete(id);f(performance.now());}
     const flushed={count:pending.size,renders};
     const retained=road.isConnected&&still.isConnected&&still.firstChild===stillPaths&&signGroup.isConnected;
     move(40);button.dispatchEvent(new PointerEvent(endType,{bubbles:true,pointerId:testPointer,isPrimary:true,buttons:0,clientX:x+40,clientY:y+40/3}));
     const finished={renders,sign:structuredClone(sign)};
     for(const[id,f]of[...pending]){pending.delete(id);f(performance.now());}
     const incremental=s.roadLayer.outerHTML;A.roadEditor.render();const fresh=s.roadLayer.outerHTML;
     return {before,poses,queued,flushed,finished,lateRenders:renders,retained,sameSVG:incremental===fresh};
    }finally{window.requestAnimationFrame=raf;window.cancelAnimationFrame=cancel;A.roadEditor.renderSigns=render;}
   },{x,y,endType});
   await page.mouse.up();
   assert.deepEqual(result.queued,{count:1,renders:0});assert.deepEqual(result.flushed,{count:0,renders:1});
   assert.equal(new Set(result.poses).size,4,'each pointer event updates the model');
   assert.equal(result.finished.renders,2);assert.equal(result.lateRenders,2,'no trailing redraw after release/cancel');
   assert(result.retained,'sign painting retains roads, unchanged sign paths, and sign layer group identities');
   assert(result.sameSVG,'incremental sign drawing equals a fresh full render');
   if(endType==='pointercancel')assert.deepEqual(result.finished.sign,result.before);
   else {
    await page.locator('#undoButton').click();assert.deepEqual(await page.evaluate(()=>StripeMaker.sheets.selected.signs[0]),result.before);
    await page.locator('#redoButton').click();assert.deepEqual(await page.evaluate(()=>StripeMaker.sheets.selected.signs[0]),result.finished.sign);
   }
  }
  const invalidation=await page.evaluate(()=>{
   const A=StripeMaker,s=A.sheets.selected,results=[];
   for(const mutate of [sign=>sign.text='NEW\nLEGEND',sign=>sign.rotation=35,sign=>{sign.width=160;sign.panels=[{text:'PANEL',scale:60,row:1,column:0}];},
    sign=>{sign.panels[0].text='CHANGED PANEL';sign.panels[0].column=1;}]) {
    mutate(s.signs[0]);const updated=A.signs.updateDrawing(s),incremental=s.roadLayer.outerHTML;A.roadEditor.render();results.push(updated&&incremental===s.roadLayer.outerHTML);
   }
   const first=s.signs.shift(),removed=!A.signs.updateDrawing(s);s.signs.unshift(first);A.roadEditor.render();
   s.roadLayer.querySelector('[data-sign="moving"]').remove();const stale=!A.signs.updateDrawing(s);A.roadEditor.render();
   const signs=[...s.roadLayer.querySelectorAll('.signCallout')],paths=signs.map(node=>node.firstChild),before=signs.map(node=>node.outerHTML);
   s.joints[0].x+=15;A.roadEditor.render();
   const retained=signs.every((node,i)=>node.isConnected&&node.firstChild===paths[i]);
   const fresh=document.createElementNS('http://www.w3.org/2000/svg','g');
   A.signs.draw({...s,signs:structuredClone(s.signs)},fresh);
   const sameFresh=JSON.stringify([...fresh.children].map(node=>node.outerHTML))===JSON.stringify(signs.map(node=>node.outerHTML));
   return {results,removed,stale,retained,sameFresh,unchanged:JSON.stringify(before)===JSON.stringify(signs.map(node=>node.outerHTML))};
  });
  assert(invalidation.results.every(Boolean),'text, rotation, size and assembly edits invalidate sign paint');
  assert(invalidation.removed&&invalidation.stale,'structural/stale layers fall back to full rendering');
  assert(invalidation.retained&&invalidation.unchanged&&invalidation.sameFresh,'full geometry rendering retains unchanged sign paths with exactly the same SVG as fresh callouts');
  assert.deepEqual(errors,[]);
  console.log('PASS: sign face, arrow tip and arrow rotation retain every pointer edit, draw once per frame, flush/cancel, undo/redo, exact SVG and unchanged layer identity.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
