// Reduced geometry from the reported cantgore.json; no embedded sheet image.
const assert=require('node:assert/strict'),fixture=require('./fixtures/intersection-branch-gore.json');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});try{
 const page=await browser.newPage({viewport:{width:1500,height:1100}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.env.STRIPEMAKER_URL||'http://127.0.0.1:8879');await page.waitForFunction(()=>StripeMaker.sheets.ready&&StripeMaker.roadEditor&&StripeMaker.selection);
 await page.locator('#blankSheet').evaluate(b=>b.click());await page.waitForFunction(()=>StripeMaker.sheets.selected);
 await page.evaluate(f=>{const s=StripeMaker.sheets.selected;Object.assign(s,f);s.view={scale:1,x:-11800,y:-11500,fitted:false};StripeMaker.sheets.zoomBy(1);document.dispatchEvent(new Event('sheetchange'));StripeMaker.roadEditor.focusRoad(s.roads.find(r=>r.id===3));StripeMaker.history.rebase();},fixture);
 const handle=page.locator('.goreHandle[data-gore="3:1|8:0"]');assert.equal(await handle.count(),1);
 await handle.focus();await page.keyboard.press('Shift+ArrowRight');
 const gore=await page.evaluate(()=>StripeMaker.sheets.selected.gores.find(g=>g.key==='3:1|8:0'));assert(gore.length>0);
 assert(await page.locator('.goreBand').count()>0);
 assert.equal(await page.evaluate(()=>{
   const s=StripeMaker.sheets.selected,outline=s.roadLayer.querySelector('.goreWhiteOutline');
   const yellow=[...s.roadLayer.querySelectorAll('.roadMarking[stroke="#ffc72c"]')];
   return outline&&yellow.length>0&&yellow.every(path=>Boolean(path.compareDocumentPosition(outline)&Node.DOCUMENT_POSITION_FOLLOWING));
 }),true,'white gore boundaries paint above yellow road and intersection edge lines');
 await page.locator('#undoButton').click();assert.equal(await page.evaluate(()=>StripeMaker.sheets.selected.gores.some(g=>g.key==='3:1|8:0')),false);
 await page.locator('#redoButton').click();assert.equal(await page.evaluate(()=>StripeMaker.sheets.selected.gores.find(g=>g.key==='3:1|8:0').length),gore.length);
 await page.evaluate(()=>{const s=StripeMaker.sheets.selected;s.roads.reverse();StripeMaker.roadEditor.render();});assert.equal(await handle.count(),1,'candidate survives road ordering');
 await page.screenshot({path:'/tmp/stripe-intersection-branch-gore.png'});
 assert.deepEqual(errors,[]);console.log('PASS: intersection branch gore candidate, marking, undo/redo, and road ordering.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
