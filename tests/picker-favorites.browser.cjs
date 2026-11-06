const selectChoice=require('./select-choice.cjs');
/* Isolated browser; run with the environment variables used by signs.browser.cjs. */
const assert=require('node:assert/strict'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
 try{
 const page=await browser.newPage({viewport:{width:1400,height:1000},acceptDownloads:true}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(pathToFileURL(path.resolve(__dirname,'../index.html')).href);
 const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=1600;c.height=1200;const g=c.getContext('2d');g.fillStyle='#777';g.fillRect(0,0,1600,1200);return c.toDataURL().split(',')[1];});
 await page.locator('#sheetFile').setInputFiles({name:'Assemblies.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
 await page.waitForFunction(()=>StripeMaker.sheets.selected);
 await page.locator('[data-editor="signsEditor"]').click();

 await page.locator('#chooseSign').click();await page.locator('#signSearch').fill('R1-1');
 const star=page.locator('#signGrid .pickerFavoriteButton').first();
 await star.focus();await page.keyboard.press('Enter');
 assert(await page.locator('#signPicker').isVisible(),'favorite does not choose or dismiss');
 assert.equal(await page.locator('#signGrid .pickerFavoriteHeading').first().textContent(),'Favorites');
 assert.equal(await page.evaluate(()=>document.activeElement.className),'pickerFavoriteButton');
 await page.locator('#signSearch').fill('');
 assert((await page.locator('#signGrid .iconGridItem').first().getAttribute('data-design')).startsWith('R1-1--'));
 await page.reload();await page.locator('[data-editor="signsEditor"]').click();await page.locator('#chooseSign').click();
 assert.equal(await page.locator('#signGrid .pickerFavoriteButton').first().getAttribute('aria-pressed'),'true');
 await page.locator('#signGrid .pickerFavoriteButton').first().click();
 assert.equal(await page.locator('#signGrid .pickerFavoriteHeading').count(),0);
 await page.keyboard.press('Escape');
 await page.locator('[data-editor="markingsEditor"]').click();
 await page.locator('#chooseMarking').click();
 await page.locator('#markingGrid .pickerFavoriteButton').first().click();
 assert(await page.locator('#markingPicker').isVisible());
 assert.equal(await page.locator('#markingGrid .pickerFavoriteHeading').first().textContent(),'Favorites');
 await page.locator('#markingSearch').fill('no-such-marking');
 assert.equal(await page.locator('#markingGrid .iconGridItem').count(),0,'search filters favorites too');
 await page.locator('#markingSearch').fill('');
 assert.equal(await page.locator('#markingGrid .pickerFavoriteButton').first().getAttribute('aria-pressed'),'true');
 await page.screenshot({path:'/tmp/stripemaker-picker-favorites.png'});
 await page.keyboard.press('Escape');await page.locator('#markingsLongitudinalTab').click();await page.locator('#chooseLine').click();
 assert.equal(await page.locator('#markingGrid .pickerFavoriteHeading').count(),0,'line favorites are separate from lateral markings');
 await page.locator('#markingGrid .pickerFavoriteButton').first().click();
 assert.equal(await page.locator('#markingGrid .pickerFavoriteHeading').first().textContent(),'Favorites');
 const stored=await page.evaluate(()=>JSON.parse(localStorage.getItem('StripeMaker.pickerFavorites.v1')));
 assert.equal(stored.lines.length,1);assert.equal(stored.markings.length,1);

 assert.deepEqual(errors,[]);console.log('Picker favorites, keyboard focus, search and reload passed.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
