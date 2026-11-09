const assert=require('node:assert/strict'),path=require('node:path'),{pathToFileURL}=require('node:url'),choose=require('./select-choice.cjs');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});try{
const page=await browser.newPage({viewport:{width:1600,height:1100}}),errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error(e.stack);});
await page.goto(pathToFileURL(path.resolve(__dirname,'../index.html')).href);await page.waitForFunction(()=>StripeMaker.sheets.ready);await page.locator('#blankSheet').evaluate(b=>b.click());await page.waitForFunction(()=>StripeMaker.sheets.selected);
await page.evaluate(()=>{const A=StripeMaker,s=A.sheets.selected;s.inchesPerPixel=4;s.view={scale:1,x:0,y:0};A.sheets.zoomBy(1);s.roads=[{id:1,lanes:1,laneWidth:12,ends:[{joint:1,sign:1,length:165.685424949},{joint:2,sign:1,length:165.685424949}]}];s.joints=[{id:1,x:850,y:650,dir:{x:1,y:0},root:1,links:[]},{id:2,x:1150,y:350,dir:{x:0,y:-1},root:1,links:[]}];A.roadEditor.focusRoad(s.roads[0]);A.history.rebase();});
const road=()=>page.evaluate(()=>structuredClone(StripeMaker.sheets.selected.roads[0]));
await choose(page.locator('#roadCurveType'),'arc');let r=await road();assert(Math.abs(r.arcAngle+90)<1,'conversion retains the original left turn');
const drag=async(selector,dx,dy)=>{const b=await page.locator(selector).boundingBox();assert(b);await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2+dx,b.y+b.height/2+dy,{steps:8});await page.mouse.up();};
const original=r.arcAngle;await drag('.arcAngleHandle',40,40);assert((await road()).arcAngle<original-5);await page.locator('#undoButton').click();assert(Math.abs((await road()).arcAngle-original)<1e-8);
const radius=Number(await page.locator('#roadArcRadius').inputValue());await drag('.arcRadiusHandle',40,40);assert(Math.abs(Number(await page.locator('#roadArcRadius').inputValue())-radius)>5);await page.locator('#undoButton').click();
await page.locator('#roadArcAngleValue').fill('270');await page.locator('#roadArcAngleValue').blur();assert.equal((await road()).arcAngle,270);
await page.locator('#roadArcAngleValue').fill('360');await page.locator('#roadArcAngleValue').blur();r=await road();assert.equal(r.arcAngle,360);assert(r.arcLoop.radius>0);
const closed=()=>page.evaluate(()=>{const A=StripeMaker,s=A.sheets.selected,r=s.roads[0],t=A.roadEditor.laneTracks(s)[0],a=t.line[0],b=t.line.at(-1),g=A.circularArc.geometry(a,b,r.arcAngle,r.arcLoop);return {gap:Math.hypot(a.x-b.x,a.y-b.y),error:Math.max(...t.line.map(p=>Math.abs(Math.hypot(p.x-g.center.x,p.y-g.center.y)-g.radius)))};});
let loop=await closed();assert(loop.gap<1e-7&&loop.error<1e-7);
await drag('.arcRadiusHandle',0,-35);assert(Math.abs((await road()).arcLoop.radius-r.arcLoop.radius)>20);loop=await closed();assert(loop.gap<1e-7&&loop.error<1e-7);
const saved=await page.evaluate(async()=>{const p=await StripeMaker.projectJSON.snapshot();StripeMaker.projectJSON.validate(p);return p;});assert.equal(saved.version,1);
await page.screenshot({path:'/tmp/stripemaker-loop-handles.png'});
await page.waitForTimeout(600);await page.reload();await page.waitForFunction(()=>StripeMaker.sheets.selected?.roads[0]?.arcLoop);loop=await closed();assert(loop.gap<1e-7&&loop.error<1e-7);
await page.evaluate(p=>StripeMaker.projectJSON.load(p),saved);await page.evaluate(()=>StripeMaker.roadEditor.focusRoad(StripeMaker.sheets.selected.roads[0]));
// Opening a closed circle retains its radius, then convert to a clothoid.
await page.locator('#roadArcAngleValue').fill('90');await page.locator('#roadArcAngleValue').blur();assert(!(await road()).arcLoop);
await choose(page.locator('#roadCurveType'),'clothoid');r=await road();assert(r.clothoid);assert(r.clothoid.end>0);assert(!await page.locator('#roadArcRadius').isVisible());assert(await page.locator('.arcAngleHandle').isVisible());
await page.locator('#roadArcAngleValue').fill('-90');await page.locator('#roadArcAngleValue').blur();r=await road();assert(Math.abs((r.clothoid.start+r.clothoid.end)/2+90)<1e-8);
await page.locator('.arcAngleHandle').focus();await page.keyboard.press('ArrowDown');assert.notDeepEqual((await road()).clothoid,r.clothoid);await page.locator('#undoButton').click();assert.equal(JSON.stringify((await road()).clothoid),JSON.stringify(r.clothoid));
await page.evaluate(async()=>{const p=await StripeMaker.projectJSON.snapshot();StripeMaker.projectJSON.validate(p);await StripeMaker.projectJSON.load(p);});assert((await road()).clothoid);
// A split clothoid keeps the same centerline, including its changing curvature.
const splitTarget=await page.evaluate(()=>{const A=StripeMaker,s=A.sheets.selected,r=s.roads[0];A.roadEditor.focusRoad(r);const line=A.roadEditor.laneTracks(s)[0].line,p=line[Math.floor(line.length*.3)];s.view={scale:1,x:900-p.x,y:500-p.y};A.sheets.zoomBy(1);const at=A.sheets.toScreen(p),box=document.getElementById('previewStage').getBoundingClientRect();return {x:at.x+box.left,y:at.y+box.top,line};});
await page.mouse.dblclick(splitTarget.x,splitTarget.y);
const split=await page.evaluate(()=>({roads:StripeMaker.sheets.selected.roads,tracks:StripeMaker.roadEditor.laneTracks(StripeMaker.sheets.selected)}));assert.equal(split.roads.length,2);assert(split.roads.every(r=>r.clothoid));
for(const track of split.tracks)for(const p of track.line){let distance=Infinity;for(let i=1;i<splitTarget.line.length;i++){const a=splitTarget.line[i-1],b=splitTarget.line[i],dx=b.x-a.x,dy=b.y-a.y,f=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy)));distance=Math.min(distance,Math.hypot(p.x-a.x-f*dx,p.y-a.y-f*dy));}assert(distance<.2,'split retains clothoid shape');}
// Closed loops can become editable freeform or clothoid sections without collapsing.
for(const mode of ['freeform','clothoid']){
 await page.evaluate(async p=>{await StripeMaker.projectJSON.load(p);StripeMaker.roadEditor.focusRoad(StripeMaker.sheets.selected.roads[0]);},saved);
 await choose(page.locator('#roadCurveType'),mode);
 const converted=await page.evaluate(()=>({roads:StripeMaker.sheets.selected.roads,tracks:StripeMaker.roadEditor.laneTracks(StripeMaker.sheets.selected)}));assert.equal(converted.roads.length,2);assert(converted.roads.every(r=>!r.arcLoop&& (mode==='freeform'?!r.clothoid:!!r.clothoid)));
 for(const t of converted.tracks)assert(Math.hypot(t.line[0].x-t.line.at(-1).x,t.line[0].y-t.line.at(-1).y)>100);
}
assert.deepEqual(errors,[]);console.log('PASS: fitted conversion, angle/radius handles, one-step undo, 270°/360° loops, persistence, clothoid conversion and keyboard editing.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
