const assert=require('node:assert/strict'),path=require('node:path'),{pathToFileURL}=require('node:url'),choose=require('./select-choice.cjs');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});try{
const page=await browser.newPage({viewport:{width:1600,height:1100}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto(pathToFileURL(path.resolve(__dirname,'../index.html')).href);await page.waitForFunction(()=>StripeMaker.sheets.ready);await page.locator('#blankSheet').evaluate(b=>b.click());await page.waitForFunction(()=>StripeMaker.sheets.selected);
await page.evaluate(()=>{const A=StripeMaker,s=A.sheets.selected;s.inchesPerPixel=4;s.view={scale:1,x:0,y:0};A.sheets.zoomBy(1);
 const road=(id,a,b,sign)=>({id,lanes:2,laneWidth:12,ends:[{joint:a,sign,length:140},{joint:b,sign,length:90}]});
 s.roads=[road(1,2,3,1),road(2,3,2,-1),road(3,1,2,1),road(4,2,1,-1),road(5,3,4,1),road(6,4,3,-1)];
 const pair=(a,b)=>({a,ai:0,b,bi:0,pair:true}),link=(a,b)=>({a,ai:0,b,bi:0});
 s.joints=[{id:1,x:600,y:400,root:3,links:[pair(3,4)],dir:{x:0,y:1}},{id:2,x:850,y:500,root:3,links:[pair(3,4),pair(1,2),link(3,1)],dir:{x:1,y:0}},{id:3,x:1100,y:800,root:5,links:[pair(5,6),pair(1,2),link(1,5)],dir:{x:1,y:0}},{id:4,x:1400,y:650,root:5,links:[pair(5,6)],dir:{x:0,y:-1}}];
 A.roadEditor.focusRoad(s.roads[0]);A.history.rebase();});
const neighbors=()=>page.evaluate(()=>{const A=StripeMaker,s=A.sheets.selected;return {roads:s.roads.filter(r=>r.id>=3),tracks:A.roadEditor.laneTracks(s).filter(t=>t.road>=3),joints:s.joints.filter(j=>j.id===2||j.id===3)};});
const before=await neighbors(),unchanged=async()=>assert.deepEqual(await neighbors(),before,'Bézier shapes, handles, anchors and connections stay unchanged');
await choose(page.locator('#roadCurveType'),'arc');await unchanged();
for(const angle of ['90','-120','270','90']){await page.locator('#roadArcAngleValue').fill(angle);await page.locator('#roadArcAngleValue').blur();await unchanged();}
await page.locator('#roadArcRadius').fill('200');await page.locator('#roadArcRadius').blur();await unchanged();
await page.locator('#roadArcAngleValue').fill('90');await page.locator('#roadArcAngleValue').blur();
for(const selector of ['.arcAngleHandle','.arcRadiusHandle']){const b=await page.locator(selector).boundingBox();await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2+25,b.y+b.height/2+20,{steps:5});await page.mouse.up();await unchanged();await page.locator('#undoButton').click();await unchanged();await page.locator('#redoButton').click();await unchanged();}
await choose(page.locator('#roadCurveType'),'clothoid');await page.locator('#roadArcAngleValue').fill('-90');await page.locator('#roadArcAngleValue').blur();await unchanged();
await page.evaluate(()=>{for(let i=0;i<20;i++)StripeMaker.roadEditor.render();});await unchanged();
await page.waitForTimeout(600);await page.reload();await page.waitForFunction(()=>StripeMaker.sheets.selected?.roads.length===6);await unchanged();
assert.deepEqual(errors,[]);console.log('PASS: exact curves leave neighboring Bézier geometry, handles, joint headings and links unchanged through edits, handles, undo/redo and reload.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
