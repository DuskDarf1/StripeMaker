const assert=require('node:assert/strict');
const fixture=require('./fixtures/median-curved-merge.json');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH});try{
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/js/elements.js',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text()).replace('window.StripeMaker.roadEditor = {','window.StripeMaker.roadEditor = { auditMedian: s => {const solved=solve(s);anchorMedians(s,solved);return medianLegs(s,solved,s.medians.find(m=>m.id===3).points);}, ')});});
 await page.goto(process.env.STRIPEMAKER_URL||'http://127.0.0.1:8878');await page.waitForFunction(()=>StripeMaker.sheets.ready);
 await page.click('button[aria-controls="sheetsMenu"]');await page.click('#blankSheet');await page.waitForFunction(()=>StripeMaker.sheets.selected);
 await page.evaluate(f=>{Object.assign(StripeMaker.sheets.selected,f);StripeMaker.roadEditor.render();},fixture);
 for(const reverse of [false,true]){
 const result=await page.evaluate(reverse=>{
  const s=StripeMaker.sheets.selected;if(reverse)s.roads.reverse();
  StripeMaker.roadEditor.render();
  const legs=StripeMaker.roadEditor.auditMedian(s),p=legs[0][0],q=legs[1][0];
  const deviation=Math.max(...legs[0].map(r=>Math.abs((q.x-p.x)*(p.y-r.y)-(p.x-r.x)*(q.y-p.y))/Math.hypot(q.x-p.x,q.y-p.y)));
  return {count:legs[0].length,deviation};
 },reverse);
 assert(result.count>10,'median follows multiple curved edge samples across merge');assert(result.deviation>20,'edge follows curve instead of the straight chord');
 }
 // Double-click a sampled point on the curved boundary: preserve its road
 // anchor and the existing outline, then verify one-step undo/redo.
 const click=await page.evaluate(()=>{
  const s=StripeMaker.sheets.selected;s.view={scale:1,x:-8500,y:-4400,fitted:false};
  document.dispatchEvent(new Event('sheetchange'));StripeMaker.showEditor('elementsEditor');
  StripeMaker.roadEditor.render();StripeMaker.history.rebase();
  const leg=StripeMaker.roadEditor.auditMedian(s)[0];
  const p=StripeMaker.sheets.toScreen(leg[Math.floor(leg.length*.8)]),box=document.getElementById("previewStage").getBoundingClientRect();
  return {x:p.x+box.left,y:p.y+box.top};
 });
 await page.mouse.dblclick(click.x,click.y);
 const added=await page.evaluate(()=>StripeMaker.sheets.selected.medians.find(m=>m.id===3).points);
 assert.equal(added.length,5);assert(added[1].on?.road,'new curve point stays anchored');
 assert(await page.locator('.medianPoint:focus').count());
 await page.click('#undoButton');assert.equal(await page.evaluate(()=>StripeMaker.sheets.selected.medians.find(m=>m.id===3).points.length),4);
 await page.click('#redoButton');assert.equal(await page.evaluate(()=>StripeMaker.sheets.selected.medians.find(m=>m.id===3).points.length),5);
 // The new point can be nudged like any existing point.
 await page.locator('.medianPoint').nth(1).focus();await page.keyboard.press('ArrowDown');
 const moved=await page.evaluate(()=>StripeMaker.sheets.selected.medians.find(m=>m.id===3).points[1]);
 assert(moved.y>added[1].y);assert(!moved.on);
 await page.click('#undoButton');
 await page.evaluate(()=>{const s=StripeMaker.sheets.selected,svg=s.roadLayer.cloneNode(true);svg.id='medianCurvePreview';svg.setAttribute('viewBox','8950 4520 950 850');svg.style.cssText='position:fixed;inset:0;width:950px;height:850px;z-index:9999;background:#202124;transform:none';document.body.append(svg);});
 await page.locator('#medianCurvePreview').screenshot({path:'/tmp/stripemaker-median-curved-merge.png'});
 assert.deepEqual(errors,[]);console.log('PASS: reported median follows curved merge in either road ordering.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
