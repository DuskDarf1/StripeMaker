const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const selectChoice=require('./select-choice.cjs');
(async()=>{const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});try{
 const page=await browser.newPage({viewport:{width:1500,height:1100}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.env.STRIPEMAKER_URL||'http://127.0.0.1:8879');await page.waitForFunction(()=>StripeMaker.sheets.ready&&StripeMaker.roadEditor&&StripeMaker.selection);
 await page.locator('#blankSheet').evaluate(b=>b.click());await page.waitForFunction(()=>StripeMaker.sheets.selected);
 await page.evaluate(()=>{const s=StripeMaker.sheets.selected;s.inchesPerPixel=4;s.roads=[
 {id:1,lanes:2,laneWidth:12,ends:[{joint:1,sign:1,length:200},{joint:2,sign:1,length:160}]},
 {id:2,lanes:2,laneWidth:12,ends:[{joint:3,sign:1,length:160},{joint:4,sign:1,length:160}]}];
 s.joints=[{id:1,x:14500,y:14700,dir:{x:1,y:0},root:1,links:[]},{id:2,x:15100,y:14700,dir:{x:0,y:1},root:1,links:[]},{id:3,x:14500,y:15100,dir:{x:1,y:0},root:2,links:[]},{id:4,x:15100,y:15200,dir:{x:1,y:0},root:2,links:[]}];
 s.view={scale:1,x:-14000,y:-14300,fitted:false};StripeMaker.sheets.zoomBy(1);document.dispatchEvent(new Event('sheetchange'));StripeMaker.roadEditor.focusRoad(s.roads[0]);StripeMaker.history.rebase();});
 const node=(road,e)=>page.locator(`.roadNode[data-road="${road}"][data-end="${e}"][data-lane="0"]`);
 const menu=async(name)=>{await node(1,0).click({button:'right'});await page.getByRole('menuitem',{name,exact:true}).click();};
 const state=()=>page.evaluate(()=>{const s=StripeMaker.sheets.selected,solved=StripeMaker.roadEditor.solve(s);return {roads:structuredClone(s.roads),joints:structuredClone(s.joints),points:s.roads.map(r=>r.ends.map((_,e)=>solved.get(`${r.id}:${e}`)))};});
 await menu('Link Curve Handles…');await node(2,0).click();let s=await state();
 assert.equal(s.roads[0].ends[0].curveLink.id,s.roads[1].ends[0].curveLink.id);assert.equal(s.roads[1].ends[0].length,200);
 const originalJoints=structuredClone(s.joints);
 await page.locator('.roadControl[aria-label="Start curve handle"]').focus();await page.keyboard.press('ArrowDown');s=await state();
 assert(s.points[0][0].travel.y>0);assert(Math.abs(s.points[0][0].travel.y-s.points[1][0].travel.y)<1e-8);
 assert.deepEqual(s.joints.map(j=>({x:j.x,y:j.y})),originalJoints.map(j=>({x:j.x,y:j.y})),'linked handles leave node positions alone');
 await selectChoice(page.locator('#curveRotation'),'opposite');
 const before=await state();await page.locator('.roadControl[aria-label="Start curve handle"]').focus();await page.keyboard.press('ArrowDown');s=await state();
 assert(s.points[0][0].travel.y>before.points[0][0].travel.y);assert(s.points[1][0].travel.y<before.points[1][0].travel.y,'opposite rotation turns the peer the other way');
 await page.locator('#unlinkCurve').click();assert(!(await state()).roads[0].ends[0].curveLink);
 await menu('Link Curve Handles…');await node(1,1).click();s=await state();
 assert.equal(s.roads[0].ends[0].curveLink.id,s.roads[0].ends[1].curveLink.id,'the two ends of one road may share curve handles');
 await page.locator('#unlinkCurve').click();
 await menu('Mirror Curve…');await node(2,0).click();
 const clickPoint=async p=>{const q=await page.evaluate(p=>{const q=StripeMaker.sheets.toScreen(p),b=document.getElementById('previewStage').getBoundingClientRect();return {x:q.x+b.left,y:q.y+b.top};},p);await page.mouse.click(q.x,q.y);};
 await clickPoint({x:14500,y:14900});await page.mouse.move(1000,600);await clickPoint({x:15100,y:14900});
 assert.equal(await page.locator('#applyCurveMirror').isEnabled(),true);assert.equal(await page.locator('.curveGuide polyline').count(),2);
 const beforeMirror=await state();await page.locator('#applyCurveMirror').click();s=await state();
 for(const e of [0,1]){assert(Math.abs(s.points[1][e].x-s.points[0][e].x)<1e-6);assert(Math.abs(s.points[1][e].y-(29800-s.points[0][e].y))<1e-6);}
 await page.locator('#undoButton').click();assert.deepEqual((await state()).joints,beforeMirror.joints);
 await page.locator('#redoButton').click();
 await node(1,0).focus();await page.keyboard.press('ArrowDown');s=await state();assert(Math.abs(s.points[1][0].y-(29800-s.points[0][0].y))<1e-6);
 const project=await page.evaluate(()=>StripeMaker.projectJSON.snapshot());assert(project.sheets[0].data.roads[0].ends[0].curveLink);
 await page.waitForTimeout(650);
 await page.reload();await page.waitForFunction(()=>StripeMaker.sheets.ready&&StripeMaker.sheets.selected?.roads?.length===2);
 s=await state();assert.equal(s.roads[0].ends[0].curveLink.mode,'mirror');
 await page.getByRole('button',{name:'Select',exact:true}).click();await page.keyboard.press('Control+a');await page.keyboard.press('Control+c');await page.mouse.move(1100,850);await page.keyboard.press('Control+v');
 s=await state();assert.equal(s.roads.length,4);
 assert.notEqual(s.roads[0].ends[0].curveLink.id,s.roads[2].ends[0].curveLink.id,'pasted relationships are independent of the originals');
 assert.equal(s.roads[2].ends[0].curveLink.id,s.roads[3].ends[0].curveLink.id,'copied members stay linked to each other');

 assert.deepEqual(errors,[]);console.log('PASS: linked rotation in both directions, mirror preview, symmetric node movement, undo/redo, project JSON and reload.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
