/* Verify opening index.html directly, with no web server. */
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
 try{
  const page=await browser.newPage({viewport:{width:1400,height:1000},acceptDownloads:true});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(pathToFileURL(path.resolve(__dirname,'../index.html')).href);
  await page.locator('[data-editor="signsEditor"]').click();await page.locator('#chooseSign').click();
  for(const code of ['R1-2','W14-3']) {
   await page.locator('#signSearch').fill(code);
   assert.equal(await page.locator('#signGrid button').count(),1,`${code}: only one size in the selector`);
  }
  await page.locator('#signSearch').fill('R2-1');
  assert.equal(await page.locator('#signGrid button').count(),1,'sizes must not appear as separate designs');
  await page.locator('#signGrid button').click();await page.locator('#signPicker').waitFor({state:'hidden'});
  assert.equal(await page.locator('#signPhysicalSize').count(),0,'physical sizes are not exposed');
  await page.locator('#signValue-speed').waitFor();
  await page.locator('#signValue-speed').fill('35');await page.locator('#signValue-speed').blur();
  await page.locator('#signSize').fill('125');await page.locator('#signSize').blur();
  const preview=await page.locator('#signPreview').getAttribute('src');assert(preview.startsWith('data:image/svg+xml'));
  const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=1600;c.height=1200;const g=c.getContext('2d');g.fillStyle='#777';g.fillRect(0,0,1600,1200);return c.toDataURL().split(',')[1];});
  await page.locator('#sheetFile').setInputFiles({name:'Variable signs.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
  await page.waitForFunction(()=>StripeMaker.sheets.selected);
  await page.locator('#signValue-speed').fill('37');assert(await page.locator('#addSign').isDisabled());
  await page.locator('#signValue-speed').fill('35');await page.locator('#signValue-speed').blur();
  await page.locator('#addSign').click();await page.mouse.click(900,700);await page.mouse.click(1070,500);
  const state=()=>page.evaluate(()=>structuredClone(StripeMaker.sheets.selected.signs??[]));
  assert.equal((await state())[0].values.speed,'35');assert.equal((await state())[0].size,125);
  assert((await state())[0].design.includes('R2-1'));
  await page.screenshot({path:'/tmp/stripemaker-speed-35-file.png'});
  await page.locator('#signValue-speed').fill('65');await page.locator('#signValue-speed').blur();
  assert.equal((await state())[0].values.speed,'65');
  await page.locator('#undoButton').click();assert.equal((await state())[0].values.speed,'35');
  await page.locator('#redoButton').click();assert.equal((await state())[0].values.speed,'65');
  await page.waitForTimeout(600);const before=await state();await page.reload();
  await page.waitForFunction(()=>document.querySelector('.signCallout path'));
  assert.deepEqual(await state(),before);
  await page.locator('[data-editor="signsEditor"]').click();await page.locator('.signHit').click();
  await page.locator('#chooseSign').click();await page.locator('#signSearch').fill('W1-1');
  assert.equal(await page.locator('#signGrid button').count(),2,'left and right variants stay separate');
  await page.keyboard.press('Escape');
  for(const [code,key,value] of [['W12-2','inches','10'],['R12-1','weight','20'],['W16-8P','street','University Avenue'],['W16-2P','distance','1000']]){
   await page.locator('#chooseSign').click();await page.locator('#signSearch').fill(code);
   await page.locator('#signGrid button').first().click();await page.locator('#signPicker').waitFor({state:'hidden'});
   await page.locator(`#signValue-${key}`).fill(value);await page.locator(`#signValue-${key}`).blur();
   assert.equal(await page.locator(`#signValue-${key}`).getAttribute('aria-invalid'),'false',`${code} ${value}`);
   await page.screenshot({path:`/tmp/stripemaker-variable-${code}.png`});
  }
  await page.locator('[data-editor="downloadMenu"]').click();
  for(const format of ['png','pdf']) {
   await page.locator(`[data-format="${format}"]`).click();
   const pending=page.waitForEvent('download');await page.locator('#downloadSheet').click();
   await(await pending).saveAs(`/tmp/stripemaker-file-options.${format}`);
  }
  assert.deepEqual(errors,[]);console.log('Direct-file loading, default sizes, variable legends, validation, persistence and history passed.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
