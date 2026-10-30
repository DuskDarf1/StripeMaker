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

 await page.locator('#chooseSign').click();
 assert.equal(await page.locator('#signGrid button').count(),48);
 await page.locator('#signGrid').evaluate(el=>el.scrollTop=el.scrollHeight);
 await page.waitForFunction(()=>document.querySelectorAll('#signGrid button').length===96);
 await page.locator('#signSearch').fill('Florida');
 assert.equal(await page.locator('#signGrid button').count(),5);
 await page.locator('#signGrid img').evaluateAll(imgs=>Promise.all(imgs.map(i=>i.decode())));
 await page.screenshot({path:'/tmp/stripemaker-florida-picker.png'});
 for(const [code,number] of [['FTP-612-25','5054'],['FTP-611-25','999'],['CFX-TM','444']]){
   await page.locator('#signSearch').fill(code);
   await page.locator('#signGrid button').first().click();await page.locator('#signPicker').waitFor({state:'hidden'});
   await page.locator('#signValue-route').fill(number);await page.locator('#signValue-route').blur();
   await page.waitForFunction(()=>document.querySelector('#signValue-route').getAttribute('aria-invalid')==='false');
   await page.screenshot({path:'/tmp/stripemaker-'+code+'.png'});
   await page.locator('#chooseSign').click();
 }
 await page.keyboard.press('Escape');
 await page.locator('#signImageFile').setInputFiles({name:'Custom sign.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
 await page.waitForFunction(()=>document.querySelector('#signStatus').textContent.includes('arrow tip location'));
 await page.mouse.click(850,740);await page.mouse.click(980,430);
 assert.equal(await page.evaluate(()=>StripeMaker.sheets.selected.signs[0].image.name),'Custom sign.png');
 await page.locator('#openAssemblyEditor').click();
 await page.locator('#signImageFile').setInputFiles({name:'Custom plaque.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
 await page.waitForFunction(()=>document.querySelector('#assemblyStatus').textContent.includes('uploaded sign'));
 for(const [r,c] of [[-1,0],[1,0],[0,-1],[0,1]])assert.equal(await page.locator(`#assemblyGrid button[data-row="${r}"][data-column="${c}"]`).count(),1);
 assert.equal(await page.locator('#assemblyGrid .assemblyEmpty').count(),4);
 await page.locator('#assemblyGrid button[data-row="-1"][data-column="0"]').click();
 assert.equal(await page.evaluate(()=>StripeMaker.sheets.selected.signs[0].panels[0].row),0);
 assert.equal(await page.evaluate(()=>StripeMaker.sheets.selected.signs[0].row),1);
 assert.equal(await page.evaluate(()=>StripeMaker.sheets.selected.signs[0].panels[0].scale),100);
 await page.locator('#assemblyGrid button[data-row="1"][data-column="-1"]').click();
 assert.equal(await page.evaluate(()=>StripeMaker.sheets.selected.signs[0].panels[1].column),0);
 assert.equal(await page.evaluate(()=>StripeMaker.sheets.selected.signs[0].column),1);
 await page.screenshot({path:'/tmp/stripemaker-orthogonal-assembly.png'});
 assert.equal(await page.evaluate(()=>StripeMaker.sheets.selected.signs[0].panels[0].image.name),'Custom plaque.png');
 assert.deepEqual(errors,[]);
 console.log('Florida search, digit layouts, bounded picker rendering, upload placement and assembly upload passed.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
