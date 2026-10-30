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
 await choose('W1-1');await page.locator('#addSign').click();await page.mouse.click(850,740);await page.mouse.click(980,430);
 await choose('W13-1P',true);await page.locator('#signValue-speed').fill('25');await page.locator('#signValue-speed').blur();
 const state=()=>page.evaluate(()=>structuredClone(StripeMaker.sheets.selected.signs));
 assert.equal((await state())[0].panels[0].values.speed,'25');
 await page.locator('#assemblyScale').fill('70');await page.locator('#assemblyScale').blur();
 await page.locator('#closeAssemblyEditor').click();
 await page.locator('#signRotationValue').fill('35');await page.locator('#signRotationValue').blur();
 assert.equal(await page.locator('#signPostRotationValue').count(),0);
 assert.equal((await state())[0].rotation,35);
 await page.locator('#undoButton').click();assert.equal((await state())[0].rotation??0,0);
 await page.locator('#redoButton').click();assert.equal((await state())[0].rotation,35);
 await page.locator('#openAssemblyEditor').click();
 await page.locator('#assemblyPart').selectOption('0');assert.equal(await page.locator('#signValue-speed').count(),0);
 await page.screenshot({path:'/tmp/stripemaker-warning-assembly.png'});
 // Add a second plaque by dragging the candidate into a new column, then remove it by dragging.
 await page.locator('#addAssemblySign').click();await page.locator('#signSearch').fill('W13-1P');await page.locator('#signGrid button').first().click();await page.locator('#signPicker').waitFor({state:'hidden'});
 const drag=async(source,target)=>{const a=await source.boundingBox(),b=await target.boundingBox();await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:10});await page.mouse.up();};
 await drag(page.locator('#assemblyCandidate'),page.locator('#assemblyGrid [data-row="0"][data-column="1"]'));
 assert.equal((await state())[0].panels.length,2);
 await drag(page.locator('#assemblyGrid [data-assembly-index="2"]'),page.locator('#assemblyRemoveDrop'));
 assert.equal((await state())[0].panels.length,1);
 await page.locator('#undoButton').click();assert.equal((await state())[0].panels.length,2);
 await page.locator('#redoButton').click();assert.equal((await state())[0].panels.length,1);
 assert.equal(await page.locator('#assemblyGrid').evaluate(e=>getComputedStyle(e).gap),'0px');
 await page.locator('#closeAssemblyEditor').click();await page.locator('#signsTitle').focus();
 await page.evaluate(async()=>{
 const c=document.createElement('canvas');c.width=120;c.height=80;const g=c.getContext('2d');g.fillStyle='#ff0000';g.fillRect(0,0,50,40);g.fillStyle='#00ffff';g.fillRect(80,50,40,30);
 const blob=await new Promise(r=>c.toBlob(r));const data=new DataTransfer();data.items.add(new File([blob],'custom.png',{type:'image/png'}));
 document.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));
 });
 await page.waitForFunction(()=>document.querySelector('#signStatus').textContent.startsWith('Image pasted'));
 await page.mouse.click(1100,760);await page.mouse.click(1150,550);
 await page.locator('#signRotationValue').fill('90');await page.locator('#signRotationValue').blur();
 assert((await state())[1].image.src.startsWith('data:image/png'));
 await page.waitForTimeout(600);const before=await state();await page.reload();
 await page.waitForFunction(()=>document.querySelectorAll('.signCallout').length===2);
 assert.deepEqual(await state(),before);
 assert.equal(await page.locator('.signCallout image').count(),1);
 await page.screenshot({path:'/tmp/stripemaker-pasted-sign.png'});
 await page.locator('[data-editor="downloadMenu"]').click();
 for(const format of ['png','pdf']){await page.locator(`[data-format="${format}"]`).click();const pending=page.waitForEvent('download');await page.locator('#downloadSheet').click();await(await pending).saveAs(`/tmp/stripemaker-sign-assemblies.${format}`);}
 assert.deepEqual(errors,[]);console.log('Assembly editing, face rotation, pasted image, undo, reload and exports passed.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
