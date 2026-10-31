const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH});try{
 const page=await browser.newPage({viewport:{width:1400,height:1000},hasTouch:true}),errors=[];
 page.setDefaultTimeout(8000);
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.env.STRIPEMAKER_URL||'http://127.0.0.1:8878');await page.waitForFunction(()=>StripeMaker.sheets?.ready);
 assert(await page.locator('select.pickerSource').count()>15);
 assert.equal(await page.locator('select:not(.pickerSource)').count(),0);
 await page.click('button[aria-controls="sheetsMenu"]');await page.click('#blankSheet');await page.waitForFunction(()=>StripeMaker.sheets.selected);
 await page.evaluate(()=>{
  const s=StripeMaker.sheets.selected;s.roads=[{id:1,lanes:2,laneWidth:12,laneTypes:{1:{type:'bufferedBike',width:7}},ends:[{joint:1,sign:1,length:null},{joint:2,sign:1,length:null}]}];
  s.joints=[{id:1,x:15000,y:16000,root:1,dir:{x:0,y:-1},links:[]},{id:2,x:15000,y:14000,root:1,dir:{x:0,y:-1},links:[]}];
  StripeMaker.roadEditor.focusRoad(s.roads[0]);StripeMaker.history.rebase();
 });
 const situation=page.locator('#bikeConflict-button');
 await situation.click();assert.equal(await situation.getAttribute('aria-expanded'),'true');
 await page.locator('.symbolPickerMenu.open').getByRole('option',{name:'Lane drops to right turn',exact:true}).click();
 assert.equal(await page.locator('#bikeConflict').inputValue(),'drop');
 assert.equal(await page.evaluate(()=>StripeMaker.sheets.selected.roads[0].laneTypes[1].conflict),'drop');
 await page.click('#undoButton');assert((await situation.textContent()).includes('Automatic'));
 await situation.focus();await page.keyboard.press('ArrowDown');await page.keyboard.press('End');await page.keyboard.press('Enter');
 assert.equal(await page.locator('#bikeConflict').inputValue(),'channelized');
 await situation.click();await page.keyboard.press('Escape');assert(await page.locator('#elementsEditor').isVisible());assert.equal(await situation.getAttribute('aria-expanded'),'false');
 await situation.focus();await page.keyboard.press('f');assert.equal(await page.locator('#bikeConflict').inputValue(),'freeflow');
 // Native model updates and option replacement stay synchronized without emitting changes.
 await page.evaluate(()=>{const s=document.getElementById('bikeSpeed');s.value='45';});
 assert((await page.locator('#bikeSpeed-button').textContent()).includes('45'));
 // Dynamically built intersection controls use the same picker.
 await page.click('button[aria-controls="intersectionsEditor"]');await page.click('#newIntersection');
 await page.locator('#intersection-approach-button').waitFor();
 await page.locator('#intersection-approach-button').click();await page.keyboard.press('End');await page.keyboard.press('Enter');
 await page.locator('#intersection-approach-button').waitFor();
 assert.equal(await page.locator('select:not(.pickerSource)').count(),0);
 // A dialog's picker stays in its top layer and remains usable.
 await page.evaluate(()=>{document.getElementById('markingPicker').showModal();});
 await page.locator('#markingCategory-button').click();
 assert.equal(await page.locator('#markingPicker .symbolPickerMenu.open').count(),1);
 await page.locator('.symbolPickerMenu.open').getByRole('option',{name:'Arrows',exact:true}).click();
 assert.equal(await page.locator('#markingCategory').inputValue(),'Arrows');
 await page.locator('#markingCategory-button').click();await page.keyboard.press('Escape');assert(await page.locator('#markingPicker').isVisible());
 await page.evaluate(()=>document.getElementById('markingPicker').close());
 // Disabled / hidden / rebuilt controls and empty option lists.
 await page.evaluate(()=>{
  const row=document.createElement('div');row.id='pickerTest';row.style.cssText='position:fixed;left:550px;top:450px;width:240px;z-index:3000';
  row.innerHTML='<label for="testSelect">Test choice</label><select id="testSelect"><option>Alpha</option><option disabled>Beta</option><option>Gamma</option></select>';document.body.append(row);
 });
 await page.locator('#testSelect-button').waitFor();
 await page.locator('#testSelect-button').click();await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');assert.equal(await page.locator('#testSelect').inputValue(),'Gamma');
 await page.evaluate(()=>document.getElementById('testSelect').disabled=true);assert(await page.locator('#testSelect-button').isDisabled());
 await page.evaluate(()=>{const s=document.getElementById('testSelect');s.disabled=false;s.replaceChildren(new Option('Delta','d'),new Option('Echo','e'));s.value='e';});
 await page.waitForFunction(()=>document.getElementById('testSelect-button').textContent.includes('Echo'));
 // Press-drag-release selection, as in the indication picker.
 const box=await page.locator('#testSelect-button').boundingBox();await page.mouse.move(box.x+10,box.y+10);await page.mouse.down();
 const option=page.locator('.symbolPickerMenu.open').getByRole('option',{name:'Delta',exact:true});await option.waitFor();const ob=await option.boundingBox();await page.mouse.move(ob.x+15,ob.y+ob.height/2);await page.mouse.up();assert.equal(await page.locator('#testSelect').inputValue(),'d');
 await page.evaluate(()=>document.getElementById('testSelect').hidden=true);assert(!(await page.locator('#testSelect-button').isVisible()));
 await page.evaluate(()=>{const s=document.getElementById('testSelect');s.hidden=false;s.replaceChildren();});
 await page.locator('#testSelect-button').click();assert.equal(await page.locator('.symbolPickerMenu.open').count(),0);
 await page.evaluate(()=>document.getElementById('pickerTest').remove());
 assert.equal(await page.locator('#testSelect-button').count(),0);
 // Small screens, touch, upward opening and light/dark palettes.
 await page.setViewportSize({width:390,height:844});
 await page.click('button[aria-controls="settingsMenu"]');
 await page.locator('#hideLevelsAbove-button').tap();
 await page.emulateMedia({colorScheme:'dark'});await page.waitForTimeout(200);
 await page.screenshot({path:'/tmp/stripemaker-select-mobile-dark.png'});
 const mb=await page.locator('.symbolPickerMenu.open').boundingBox();assert(mb.x>=0&&mb.x+mb.width<=390&&mb.y>=0&&mb.y+mb.height<=844);
 await page.locator('.symbolPickerMenu.open').getByRole('option',{name:'Level 2',exact:true}).tap();assert.equal(await page.locator('#hideLevelsAbove').inputValue(),'2');
 await page.evaluate(()=>document.documentElement.dataset.theme='light');await page.locator('#hideLevelsAbove-button').tap();await page.waitForTimeout(200);await page.screenshot({path:'/tmp/stripemaker-select-mobile-light.png'});
 assert.deepEqual(errors,[]);console.log('PASS: all selects enhanced; keyboard, pointer drag, touch, dialogs, dynamic state, disabled options, undo and mobile layout.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
