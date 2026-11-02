const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});try{
 const page=await browser.newPage({viewport:{width:1500,height:1100}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.env.STRIPEMAKER_URL||'http://127.0.0.1:8879');await page.waitForFunction(()=>StripeMaker.sheets.ready&&StripeMaker.roadEditor&&StripeMaker.selection);
 await page.locator('#blankSheet').evaluate(b=>b.click());await page.waitForFunction(()=>StripeMaker.sheets.selected);
 await page.evaluate(()=>{const s=StripeMaker.sheets.selected;s.inchesPerPixel=4;s.roads=[{id:1,lanes:2,laneWidth:12,ends:[{joint:1,sign:1,length:140},{joint:2,sign:1,length:140}]}];s.joints=[{id:1,x:14500,y:14700,dir:{x:1,y:0},root:1,links:[]},{id:2,x:15100,y:14700,dir:{x:1,y:0},root:1,links:[]}];s.view={scale:1,x:-14000,y:-14300,fitted:false};StripeMaker.sheets.zoomBy(1);document.dispatchEvent(new Event('sheetchange'));StripeMaker.roadEditor.focusRoad(s.roads[0]);StripeMaker.history.rebase();});
 const state=()=>page.evaluate(()=>({roads:structuredClone(StripeMaker.sheets.selected.roads),joints:structuredClone(StripeMaker.sheets.selected.joints)}));
 // Selecting the pavement must refresh immediately, before any pan or next click.
 await page.evaluate(()=>StripeMaker.roadEditor.focusRoad(null));
 const body=await page.evaluate(()=>{const p=StripeMaker.sheets.toScreen({x:14800,y:14700}),b=document.getElementById('previewStage').getBoundingClientRect();return {x:p.x+b.left,y:p.y+b.top};});
 await page.mouse.click(body.x,body.y);
 assert.deepEqual(await page.evaluate(()=>StripeMaker.selection.diagnostics().roads),[1],'first pavement click updates selection immediately');
 assert.equal(await page.locator('.selectOverlay .selectionOutline').count(),1,'first click draws the yellow selection outline');
 assert.equal(await page.locator('.selectionRotate').isVisible(),true);
 const empty=await page.evaluate(()=>{const p=StripeMaker.sheets.toScreen({x:15300,y:14900}),b=document.getElementById('previewStage').getBoundingClientRect();return {x:p.x+b.left,y:p.y+b.top};});
 await page.mouse.click(empty.x,empty.y);
 assert.deepEqual(await page.evaluate(()=>StripeMaker.selection.diagnostics().roads),[],'empty click clears selection immediately');
 assert.equal(await page.locator('.selectOverlay .selectionOutline').count(),0);
 await page.mouse.click(body.x,body.y);

 const before=await state();await page.locator('.roadNode[data-road="1"][data-end="0"][data-lane="0"]').focus();
 await page.keyboard.press('Control+c');await page.mouse.move(1100,850);await page.keyboard.press('Control+v');
 let s=await state();assert.equal(s.roads.length,2);assert.equal(await page.locator('#elementsEditor').isVisible(),true);assert.equal(await page.locator('#selectEditor').isVisible(),false);
 await page.locator('#undoButton').click();assert.equal((await state()).roads.length,1);await page.locator('#redoButton').click();assert.equal((await state()).roads.length,2);
 const other=await page.evaluate(()=>{const s=StripeMaker.sheets.selected,r=s.roads[1],solved=StripeMaker.roadEditor.solve(s),a=solved.get(`${r.id}:0`),z=solved.get(`${r.id}:1`),p=StripeMaker.sheets.toScreen({x:(a.x+z.x)/2,y:(a.y+z.y)/2}),b=document.getElementById('previewStage').getBoundingClientRect();return {x:p.x+b.left,y:p.y+b.top,id:r.id};});
 await page.mouse.click(other.x,other.y);
 assert.deepEqual(await page.evaluate(()=>StripeMaker.selection.diagnostics().roads),[other.id],'clicking another road switches the outline immediately');
 // Focus a road in its own editor, then rotate without opening Select.
 await page.evaluate(()=>StripeMaker.roadEditor.focusRoad(StripeMaker.sheets.selected.roads[0]));
 await page.locator('.roadNode[data-road="1"][data-end="0"][data-lane="0"]').focus();
 await page.keyboard.press(']');s=await state();assert(s.joints[1].y>s.joints[0].y);assert(Math.abs(Math.hypot(s.joints[1].x-s.joints[0].x,s.joints[1].y-s.joints[0].y)-600)<1e-6);
 assert.equal(await page.locator('#selectEditor').isVisible(),false);
 await page.locator('#undoButton').click();s=await state();assert.deepEqual(s.joints.slice(0,2),before.joints);
 // A focused rotation handle nudges the angle, rather than translating nodes.
 await page.evaluate(()=>StripeMaker.selection.rotate(15));await page.locator('.selectionRotate').focus();
 const rotated=await state();await page.keyboard.press('ArrowRight');s=await state();assert.notDeepEqual(s.joints.slice(0,2),rotated.joints.slice(0,2));
 const mid=a=>({x:(a[0].x+a[1].x)/2,y:(a[0].y+a[1].y)/2});assert.deepEqual(mid(s.joints),mid(rotated.joints));
 // The selection tool rotates all selected objects around one common center.
 await page.getByRole('button',{name:'Select',exact:true}).click();await page.keyboard.press('Control+a');
 const groupBefore=await state();await page.locator('#selectionRotation').fill('90');await page.locator('#selectRotateRight').click();s=await state();
 for(let i=0;i<s.joints.length;i++)for(let j=0;j<i;j++)assert(Math.abs(Math.hypot(s.joints[i].x-s.joints[j].x,s.joints[i].y-s.joints[j].y)-Math.hypot(groupBefore.joints[i].x-groupBefore.joints[j].x,groupBefore.joints[i].y-groupBefore.joints[j].y))<1e-6);
 await page.screenshot({path:'/tmp/stripe-selection-rotation.png'});
 await page.evaluate(()=>{const app=StripeMaker,s=app.sheets.selected;s.lines=[{id:1,on:{road:1,side:'R'},from:0,to:1,style:'solid',color:'white',width:6}];app.roadEditor.render();app.longitudinal.focus(1);app.selection.editorChanged();});
 assert.equal(await page.locator('.selectionRotate').isVisible(),false,'longitudinal selections have no rotation handle');
 assert.equal(await page.locator('#editorRotateAmount').isVisible(),false);
 assert.deepEqual(errors,[]);console.log('PASS: editor copy/paste, undo/redo, rotation shortcut, keyboard handle, and rigid group rotation.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
