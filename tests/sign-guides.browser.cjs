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
 const choose=async(code,add=false)=>{if(add&&await page.locator('#signAssemblyEditor').isHidden())await page.locator('#openAssemblyEditor').click();await page.locator(add?'#addAssemblySign':'#chooseSign').click();await page.locator('#signSearch').fill(code);await page.locator('#signGrid button').first().click();await page.locator('#signPicker').waitFor({state:'hidden'});if(add)await page.locator('#assemblyCandidate').click();};
 await page.locator('#chooseSign').click();await page.locator('#signSearch').fill('US shield');
 assert(await page.locator('#signGrid button').count()>0);await page.keyboard.press('Escape');
 for(const code of ['D1-1','E5-1','D3-1']){await page.locator('#chooseSign').click();await page.locator('#signSearch').fill(code);assert(await page.locator('#signGrid button').count()>0,code);await page.keyboard.press('Escape');}
 for(const code of ['E1-1','E6-1','E8-2','D15-1']){await page.locator('#chooseSign').click();await page.locator('#signSearch').fill(code);assert.equal(await page.locator('#signGrid button').count(),0,code);await page.keyboard.press('Escape');}
 for(const code of ['M1-1','M1-4']){
   await choose(code);await page.locator('#signValue-route').fill('395');await page.locator('#signValue-route').blur();
   await page.waitForFunction(()=>document.querySelector('#signValue-route').getAttribute('aria-invalid')==='false');
 }
 await choose('M1-1');await page.locator('#signValue-route').fill('395');await page.locator('#signValue-route').blur();
 await page.waitForFunction(()=>document.querySelector('#signValue-route').getAttribute('aria-invalid')==='false');
 await page.locator('#addSign').click();await page.mouse.click(850,740);await page.mouse.click(980,430);
 await choose('M3-1P',true);
 const drag=async(source,target)=>{const a=await source.boundingBox(),b=await target.boundingBox();await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:10});await page.mouse.up();};
 await drag(page.locator('#assemblyGrid [data-assembly-index="1"]'),page.locator('#assemblyGrid [data-assembly-index="0"]'));
 await choose('M6-1P',true);
 await page.locator('#assemblyScale').fill('75');await page.locator('#assemblyScale').blur();
 const sign=await page.evaluate(()=>StripeMaker.sheets.selected.signs[0]);assert.equal(sign.values.route,'395');assert(sign.scale>100);
 assert(await page.evaluate(()=>StripeMaker.signCatalog.signs.find(e=>e.id===StripeMaker.sheets.selected.signs[0].design).variant.includes('3 digits')));assert.equal(sign.row,1);assert.equal(sign.panels[0].row,0);assert.equal(sign.panels.length,2);
 const fullCell=await page.locator('#assemblyGrid [data-row="0"][data-column="1"]').boundingBox();
 const occupied=await page.locator('#assemblyGrid [data-row="0"][data-column="0"]').boundingBox();
 assert(Math.abs(fullCell.width-occupied.width)<1);assert(Math.abs(fullCell.height-occupied.height)<1);
 await page.screenshot({path:'/tmp/stripemaker-route-assembly.png'});
 await selectChoice(page.locator('#assemblyPart'),'0');await page.locator('#signValue-route').fill('75');await page.locator('#signValue-route').blur();
 assert.equal(await page.evaluate(()=>StripeMaker.sheets.selected.signs[0].values.route),'75');
 assert.equal(await page.evaluate(()=>StripeMaker.signCatalog.signs.find(e=>e.id===StripeMaker.sheets.selected.signs[0].design).variant.includes('3 digits')),false);
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'/tmp/stripemaker-assembly-narrow.png'});
 assert(await page.locator('#closeAssemblyEditor').isVisible());
 assert.deepEqual(errors,[]);console.log('Route shields, guide search, editable route numbers, drag swapping, and narrow assembly editor passed.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
