const assert=require('node:assert/strict'),add=require('./add-element.cjs');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});try{
 const page=await browser.newPage({viewport:{width:1400,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.env.STRIPEMAKER_URL||'http://127.0.0.1:8884');await page.waitForFunction(()=>StripeMaker.sheets.ready);
 await page.locator('#blankSheet').evaluate(b=>b.click());await page.locator('[data-editor="elementsEditor"]').click();
 assert(await page.locator('#elementToAdd option[value="roadBike"]').isDisabled());
 await add(page,'road');await page.mouse.click(700,400);await page.mouse.click(1100,400);await page.keyboard.press('Escape');
 await add(page,'roadBike');assert.equal(await page.evaluate(()=>StripeMaker.sheets.selected.roads[0].laneTypes[1].type),'bufferedBike');
 await page.locator('#undoButton').click();
 await add(page,'roadTrack');assert.equal(await page.evaluate(()=>StripeMaker.sheets.selected.roads[0].laneTypes[1].type),'twoWayBike');
 await add(page,'median');for(const [x,y]of[[700,650],[850,650],[850,800]])await page.mouse.click(x,y);await page.keyboard.press('Enter');
 assert.equal(await page.evaluate(()=>StripeMaker.sheets.selected.medians.length),1);
 await add(page,'match');assert(await page.locator('#matchLineEditor').isVisible());
 await page.locator('[data-editor="elementsEditor"]').click();
 for(const width of [1400,390]){await page.setViewportSize({width,height:1000});
  const row=page.locator('.elementAddRow'),box=await row.boundingBox();assert(box.x>=0&&box.x+box.width<=width,'Add row fits viewport');
  assert(await page.locator('#elementToAdd-button').isVisible());assert(await page.locator('#addElement').isVisible());
  await page.screenshot({path:`/tmp/elements-add-${width}.png`});
 }
 assert.deepEqual(errors,[]);console.log('PASS: Add picker dispatches road, attached bike/track, median and match-line actions; selection gating and narrow layout work.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
