/* Run against an isolated local server/profile, like intersections.browser.cjs:
   PLAYWRIGHT_MODULE=/path/to/playwright STRIPEMAKER_URL=http://127.0.0.1:8876 node tests/signs.browser.cjs */
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
 const browser = await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
 try {
  const context = await browser.newContext({viewport:{width:1400,height:1000},acceptDownloads:true});
  const page=await context.newPage(), errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.STRIPEMAKER_URL || 'http://127.0.0.1:8876');
  const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=1600;c.height=1200;const g=c.getContext('2d');g.fillStyle='#777';g.fillRect(0,0,c.width,c.height);return c.toDataURL().split(',')[1];});
  await page.locator('#sheetFile').setInputFiles({name:'Signs test.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
  await page.waitForFunction(()=>StripeMaker.sheets.selected);
  await page.locator('[data-editor="signsEditor"]').click();
  await page.locator('#chooseSign').click();
  await page.locator('#signSearch').fill('r01-01 stop');
  await page.waitForFunction(()=>document.querySelector('#signGrid button'));
  assert(await page.locator('#signGrid button').count() > 0);
  await page.screenshot({path:'/tmp/stripemaker-sign-picker.png'});
  await page.locator('#signGrid button').first().click();await page.locator('#signPicker').waitFor({state:'hidden'});
  await page.locator('#addSign').click();
  await page.mouse.click(900,650);await page.mouse.move(1050,500);await page.mouse.click(1050,500);
  const state=()=>page.evaluate(()=>structuredClone(StripeMaker.sheets.selected.signs??[]));
  assert.equal((await state()).length,1);
  await page.waitForFunction(()=>document.querySelector('.signCallout path'));
  assert.equal(await page.locator('.signPost').count(),1);
  await page.screenshot({path:'/tmp/stripemaker-sign-placed.png'});
  const original=(await state())[0];
  await page.locator('.signPost').focus();await page.keyboard.press('ArrowLeft');
  assert((await state())[0].postX<original.postX);
  await page.locator('#undoButton').click();assert.equal((await state())[0].postX,original.postX);
  await page.locator('#redoButton').click();assert((await state())[0].postX<original.postX);
  const face=await page.locator('.signHit').boundingBox();
  await page.mouse.move(face.x+face.width/2,face.y+face.height/2);await page.mouse.down();await page.mouse.move(face.x+face.width/2+60,face.y+face.height/2+20,{steps:6});await page.mouse.up();
  assert((await state())[0].x>original.x);
  await page.locator('#signSize').fill('150');await page.locator('#signSize').blur();assert.equal((await state())[0].size,150);
  await page.locator('#chooseSign').click();await page.locator('#signSearch').fill('w1-1 left');
  assert(await page.locator('#signGrid button').count()>0);
  await page.locator('#signGrid button').first().click();await page.locator('#signPicker').waitFor({state:'hidden'});assert.notEqual((await state())[0].design,original.design);
  await page.locator('#chooseSign').click();await page.locator('#signSearch').fill('this cannot be a sign');
  assert.equal(await page.locator('#signGrid button').count(),0);await page.keyboard.press('Escape');await page.locator('#signPicker').waitFor({state:'hidden'});
  await page.locator('#addSign').click();await page.mouse.click(850,700);await page.keyboard.press('Escape');assert.equal((await state()).length,1);
  await page.waitForTimeout(600);const beforeReload=await state();await page.reload();
  await page.waitForFunction(()=>StripeMaker.sheets.selected?.signs?.length===1 && document.querySelector('.signCallout path'));
  assert.deepEqual(await state(),beforeReload);
  // Export both formats and retain artifacts for visual/vector inspection.
  await page.locator('[data-editor="downloadMenu"]').click();
  for (const format of ['png','pdf']) {
   await page.locator(`[data-format="${format}"]`).click();
   const download = page.waitForEvent('download');await page.locator('#downloadSheet').click();
   await (await download).saveAs(`/tmp/stripemaker-sign-export.${format}`);
  }
  await page.screenshot({path:'/tmp/stripemaker-sign-export-menu.png'});
  // Clear-all must be undoable, and cancellation leaves signs alone.
  page.once('dialog',d=>d.dismiss());await page.locator('#clearAll').click();assert.equal((await state()).length,1);
  page.once('dialog',d=>d.accept());await page.locator('#clearAll').click();assert.equal((await state()).length,0);
  await page.locator('#undoButton').click();assert.equal((await state()).length,1);
  await page.locator('[data-editor="signsEditor"]').click();await page.locator('.signHit').click();await page.locator('#deleteSign').click();assert.equal((await state()).length,0);
  await page.locator('#undoButton').click();assert.equal((await state()).length,1);
  await page.setViewportSize({width:390,height:844});
  await page.locator('#chooseSign').click();await page.locator('#signSearch').fill('r1-1 stop');
  await page.screenshot({path:'/tmp/stripemaker-sign-mobile.png'});
  assert(await page.locator('#closeSignPicker').isVisible());
  await page.emulateMedia({colorScheme:'dark'});
  await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');
  await page.screenshot({path:'/tmp/stripemaker-sign-mobile-dark.png'});
  assert.deepEqual(errors,[]);console.log('Signs browser checks passed.');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
