const assert=require('node:assert/strict'),path=require('node:path'),{pathToFileURL}=require('node:url');
const choose=require('./select-choice.cjs');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});try{
 const page=await browser.newPage({viewport:{width:1500,height:1100}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(pathToFileURL(path.resolve(__dirname,'../index.html')).href);await page.waitForFunction(()=>StripeMaker.sheets.ready);
 await page.locator('#blankSheet').evaluate(b=>b.click());await page.waitForFunction(()=>StripeMaker.sheets.selected);
 await page.locator('[data-editor="intersectionsEditor"]').click();await page.locator('#newIntersection').click();
 const ids=await page.evaluate(()=>{
  const A=StripeMaker,s=A.sheets.selected,i=s.intersections[0],G=A.intersectionGeometry;
  i.movements=i.approaches.map((a,j)=>G.movement(a,0,i.approaches[(j+2)%4],0));
  A.history.record();A.roadEditor.render();document.dispatchEvent(new CustomEvent('sheethistory'));
  const rect=document.getElementById('previewStage').getBoundingClientRect();s.view.scale=.5;s.view.x=rect.width/2-i.x*.5;s.view.y=rect.height/2-i.y*.5;document.dispatchEvent(new CustomEvent('sheetview'));
  return i.approaches.map(a=>a.id);
 });
 const verify=async index=>{
  assert.equal(await page.locator('#intersection-approach').inputValue(),ids[index]);
  const number=page.getByRole('button',{name:`Select approach ${index+1}`,exact:true});
  assert.equal(await number.getAttribute('aria-pressed'),'true');
  assert.equal(await number.evaluate(e=>getComputedStyle(e).outlineStyle),'solid');
  const hits=await page.locator('.intersectionConnectionHit').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('aria-label')));
  assert.equal(hits.length,1);assert(hits[0].startsWith(`Movement from approach ${index+1} `));
 };
 await verify(0);
 for(let index=0;index<4;index++){
  // Force an overlay replacement between press and release.
  const number=page.getByRole('button',{name:`Select approach ${index+1}`,exact:true});
  await number.dispatchEvent('pointerdown',{button:0,pointerId:1});
  await page.evaluate(()=>document.dispatchEvent(new CustomEvent('sheetview')));
  await verify(index);
 }
 await page.getByRole('button',{name:'Select approach 1',exact:true}).click();await verify(0);
 await choose(page.locator('#intersection-approach'),ids[1]);await verify(1);
 await page.getByRole('button',{name:'Select approach 3',exact:true}).press('Enter');await verify(2);
 await page.locator('#intersectionSheetName').focus();await verify(2); // Selection box survives focus changes.
 await page.evaluate(()=>StripeMaker.settings.set('leftHandTraffic',true));await verify(2);
 const original=await page.evaluate(()=>JSON.stringify(StripeMaker.sheets.selected.intersections[0].movements));
 await page.getByRole('button',{name:'Select approach 4',exact:true}).press('Space');await verify(3);
 assert.equal(await page.evaluate(()=>JSON.stringify(StripeMaker.sheets.selected.intersections[0].movements)),original,'filtering never changes movements');
 assert.deepEqual(errors,[]);console.log('PASS: approach selection survives redraw/focus changes; guides filter by approach in both traffic directions.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
