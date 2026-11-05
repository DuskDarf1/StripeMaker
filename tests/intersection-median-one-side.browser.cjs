const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fixture=require('./fixtures/dense-editor.cjs')(2);
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
 try{
  const page=await browser.newPage({viewport:{width:1500,height:1100}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.STRIPEMAKER_URL||'http://127.0.0.1:8884');await page.waitForFunction(()=>StripeMaker.sheets.ready);
  await page.locator('#blankSheet').evaluate(b=>b.click());
  const state=()=>page.evaluate(()=>{
   const A=StripeMaker,s=A.sheets.selected,i=s.intersections[0],a=i.approaches[0],G=A.intersectionGeometry;
   return {width:a.median,x:a.x,y:a.y,edges:[-1,1].map(side=>G.local(a,side*a.median/2))};
  });
  for(const linked of [false,true])for(const incoming of [false,true])for(const shift of [false,true]){
   await page.evaluate(({data,linked})=>{
    const A=StripeMaker,s=A.sheets.selected;A.showEditor(null);Object.assign(s,structuredClone(data));
    if(!linked){s.roads=[];s.joints=[];for(const i of s.intersections)for(const a of i.approaches)delete a.links;}
    A.roadEditor.render();const i=s.intersections[0];s.view={scale:2,x:850-i.x*2,y:550-i.y*2,fitted:false};A.sheets.zoomBy(1);A.intersections.focusAt(i);A.history.rebase();
   },{data:fixture,linked});
   const before=await state(),handle=page.getByRole('button',{name:`Approach 1 median ${incoming?'incoming':'outgoing'} edge`,exact:true});
   const b=await handle.boundingBox(),x=b.x+b.width/2,y=b.y+b.height/2,side=incoming?-1:1;
   if(shift)await page.keyboard.down('Shift');
   await page.mouse.move(x,y);await page.mouse.down();
   // Two moves exercise cumulative drag bookkeeping; total is four feet.
   await page.mouse.move(x,y+side*8);await page.mouse.move(x,y+side*16);await page.mouse.up();
   if(shift)await page.keyboard.up('Shift');
   const after=await state(),same=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y)<1e-7;
   assert(Math.abs(after.width-before.width-(shift?4:8))<1e-6,`width: linked=${linked}, incoming=${incoming}, shift=${shift}`);
   const fixed=incoming?1:0,moving=incoming?0:1;
   assert.equal(same(after.edges[fixed],before.edges[fixed]),shift,'opposite edge stays fixed only with Shift');
   assert(!same(after.edges[moving],before.edges[moving]),'grabbed edge moves');
   await page.locator('#undoButton').click();assert.deepEqual(await state(),before);
   await page.locator('#redoButton').click();assert.deepEqual(await state(),after);
  }
  assert.deepEqual(errors,[]);console.log('PASS: both median mouth sides resize independently with Shift, symmetric drags remain, attached roads follow, undo/redo restores geometry.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
