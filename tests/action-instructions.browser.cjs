const assert=require('node:assert/strict'),path=require('node:path'),{pathToFileURL}=require('node:url');
const P=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const webkit=process.env.BROWSER==='webkit',browser=await P[webkit?'webkit':'chromium'].launch({headless:true,executablePath:webkit?process.env.WEBKIT_PATH:process.env.CHROME_PATH});
 try{
  const page=await browser.newPage({viewport:{width:1500,height:1100}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.STRIPEMAKER_URL||pathToFileURL(path.resolve(__dirname,'../index.html')).href);await page.waitForFunction(()=>StripeMaker.sheets.ready);
  await page.locator('#blankSheet').evaluate(b=>b.click());await page.waitForFunction(()=>StripeMaker.sheets.selected);
  await page.click('[data-editor="elementsEditor"]');await page.click('#addRoad');
  const hint=page.locator('#actionInstruction');await hint.waitFor({state:'visible'});
  assert.match(await hint.textContent(),/road.s start point/);
  await page.mouse.move(900,400);await page.waitForTimeout(50);
  let box=await hint.boundingBox();assert(box.y===15&&box.x+box.width===1485,'instructions stay in the top-right corner');
  await page.mouse.move(700,700);assert.deepEqual(await hint.boundingBox(),box,'moving the mouse does not move instructions');
  assert.equal(await hint.evaluate(e=>getComputedStyle(e).pointerEvents),'none');
  assert(await page.locator('#elementsHint').evaluate(e=>e.classList.contains('actionInstructionSource')),'original live region remains available to assistive technology');
  await page.mouse.click(900,400);assert.match(await hint.textContent(),/next node/,'instructions update after the first point');
  await page.keyboard.press('Escape');assert(await hint.isHidden(),'Escape dismisses instructions even when the tool handles the key');
  await page.click('#addMedian');await hint.waitFor({state:'visible'});assert.match(await hint.textContent(),/median.s corners/);
  await page.mouse.move(1490,1088);await page.waitForTimeout(50);box=await hint.boundingBox();assert(box.y===15&&box.x+box.width===1485,'instructions remain top-right at viewport edges');
  await page.setViewportSize({width:390,height:844});box=await hint.boundingBox();assert(box.x>=15&&box.y===15&&box.x+box.width===375,'instructions fit the top-right corner on narrow screens');
  await page.setViewportSize({width:1500,height:1100});
  await page.screenshot({path:'/tmp/stripemaker-top-right-instructions.png'});
  await page.keyboard.press('Escape');
  await page.click('[data-editor="markingsEditor"]');await page.click('#markingsLongitudinalTab');await hint.waitFor({state:'visible'});assert.match(await hint.textContent(),/lane line/,'Markings uses the shared instructions');
  await page.click('[data-editor="levelsEditor"]');await hint.waitFor({state:'visible'});assert.match(await hint.textContent(),/bridge/,'Levels uses the shared instructions');
  await page.click('[data-editor="sheetsMenu"]');await page.click('#setScale');await hint.waitFor({state:'visible'});assert.match(await hint.textContent(),/two yellow points/,'Scale instructions follow the newly opened panel');
  await page.click('#cancelScale');assert(await hint.isHidden(),'closing a tool removes its instructions');
  await page.click('[data-editor="elementsEditor"]');await page.locator('#addRoad').focus();await page.keyboard.press('Enter');await hint.waitFor({state:'visible'});assert.equal((await hint.boundingBox()).y,15,'keyboard activation shows the same fixed instructions');
  assert(await page.locator('#elementsHint').evaluate(e=>e.classList.contains('actionInstructionSource')));
  await page.keyboard.press('Tab');assert(await hint.isVisible(),'Tab does not dismiss instructions');
  await page.keyboard.press('Escape');
  await page.locator('#addMedian').dispatchEvent('pointerdown',{pointerType:'touch',pointerId:9});await page.locator('#addMedian').dispatchEvent('click',{detail:1});await hint.waitFor({state:'visible'});assert.equal((await hint.boundingBox()).y,15,'touch activation shows the same fixed instructions');
  await page.evaluate(()=>StripeMaker.showEditor(null));assert(await hint.isHidden());assert.deepEqual(errors,[]);
  console.log('PASS action instructions: fixed top-right placement, multi-step updates, panel changes, narrow screens, Escape, scale, keyboard/touch support, and non-interference.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
