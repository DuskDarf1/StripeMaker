const assert=require('node:assert/strict'),path=require('node:path'),{pathToFileURL}=require('node:url'),choose=require('./select-choice.cjs');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});try{
const page=await browser.newPage({viewport:{width:1500,height:1100}}),errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error(e.stack);});
await page.goto(pathToFileURL(path.resolve(__dirname,'../index.html')).href);await page.waitForFunction(()=>StripeMaker.sheets.ready);
await page.locator('#blankSheet').evaluate(b=>b.click());await page.waitForFunction(()=>StripeMaker.sheets.selected);
await page.evaluate(()=>{const A=StripeMaker,s=A.sheets.selected;s.inchesPerPixel=4;s.view={scale:1,x:0,y:0};A.sheets.zoomBy(1);
s.roads=[{id:1,lanes:2,laneWidth:12,ends:[{joint:1,sign:1,length:null},{joint:2,sign:1,length:null}]},{id:2,lanes:1,laneWidth:12,ends:[{joint:2,sign:-1,length:null},{joint:1,sign:-1,length:null}]}];s.joints=[{id:1,x:650,y:300},{id:2,x:1100,y:750}].map(j=>({...j,dir:{x:Math.SQRT1_2,y:Math.SQRT1_2},root:1,links:[{a:1,ai:0,b:2,bi:0,pair:true}]}));A.roadEditor.focusRoad(s.roads[0]);A.history.rebase();});
await choose(page.locator('#roadCurveType'),'arc');
assert.equal(await page.locator('#roadArcAngleValue').inputValue(),'0','straight conversion keeps direction');
await page.locator('#roadArcAngleValue').fill('90');await page.locator('#roadArcAngleValue').blur();
const inspect=()=>page.evaluate(()=>{const A=StripeMaker,s=A.sheets.selected;return {roads:structuredClone(s.roads),tracks:A.roadEditor.laneTracks(s),joints:structuredClone(s.joints)};});
let result=await inspect();assert.deepEqual(result.roads.map(r=>r.arcAngle),[90,-90]);
const checkCircle=(tracks,center,radius)=>{for(const t of tracks)for(const p of t.line)assert(Math.abs(Math.hypot(p.x-center.x,p.y-center.y)-radius)<.01,'constant radius');};
checkCircle(result.tracks,{x:650,y:750},450);assert(Math.abs(Number(await page.locator('#roadArcRadius').inputValue())-150)<.01);
await page.locator('#roadArcAngleValue').fill('-90');await page.locator('#roadArcAngleValue').blur();checkCircle((await inspect()).tracks,{x:1100,y:300},450);
await page.locator('#undoButton').click();assert.equal((await inspect()).roads[0].arcAngle,90);await page.locator('#redoButton').click();assert.equal((await inspect()).roads[0].arcAngle,-90);
await page.locator('#roadArcRadius').fill('200');await page.locator('#roadArcRadius').blur();assert(Math.abs(Number(await page.locator('#roadArcRadius').inputValue())-200)<.01);
await page.locator('#roadArcAngleValue').fill('90');await page.locator('#roadArcAngleValue').blur();
// Double-click the outer lane of the selected arc to split it.
const click=await page.evaluate(()=>{const A=StripeMaker,s=A.sheets.selected,t=A.roadEditor.laneTracks(s)[0],i=Math.floor(t.line.length/2),p=t.markingEdges.at(-1)[i],q=t.markingEdges.at(-2)[i],at=A.sheets.toScreen({x:(p.x+q.x)/2,y:(p.y+q.y)/2}),r=document.getElementById('previewStage').getBoundingClientRect();return {x:at.x+r.left,y:at.y+r.top};});
await page.mouse.dblclick(click.x,click.y);result=await inspect();assert.equal(result.roads.length,4);checkCircle(result.tracks,{x:650,y:750},450);assert(result.roads.every(r=>Math.abs(r.arcAngle)<90));
const saved=await page.evaluate(async()=>{const p=await StripeMaker.projectJSON.snapshot();StripeMaker.projectJSON.validate(p);return p;});assert.equal(saved.version,1);
await page.screenshot({path:'/tmp/stripemaker-circular-arc.png'});
await page.waitForTimeout(600);await page.reload();await page.waitForFunction(()=>StripeMaker.sheets.selected?.roads.length===4);checkCircle((await inspect()).tracks,{x:650,y:750},450);
await page.evaluate(p=>StripeMaker.projectJSON.load(p),saved);checkCircle((await inspect()).tracks,{x:650,y:750},450);
// Menu mode changes and endpoint dragging preserve true circles.
const id=await page.evaluate(()=>{const A=StripeMaker,s=A.sheets.selected;A.roadEditor.focusRoad(s.roads[0]);return s.roads[0].id;});
const node=page.locator(`.roadNode[data-road="${id}"][data-end="0"][data-lane="0"]`);
await node.click({button:'right'});await page.getByRole('menuitem',{name:'Use Freeform Curve',exact:true}).click();
assert.equal((await inspect()).roads.find(r=>r.id===id).arcAngle,undefined);
await node.click({button:'right'});await page.getByRole('menuitem',{name:'Make Circular Arc',exact:true}).click();
assert((await inspect()).roads.find(r=>r.id===id).arcAngle>0,'refitting freeform retains bend direction');
const box=await node.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+70,box.y+box.height/2-40,{steps:8});await page.mouse.up();
assert.equal(await page.evaluate(()=>{const A=StripeMaker,s=A.sheets.selected;return A.roadEditor.laneTracks(s).every(t=>{const r=s.roads.find(r=>r.id===t.road);if(r.arcAngle==null)return true;const g=A.circularArc.geometry(t.line[0],t.line.at(-1),r.arcAngle),a=t.line[0],sign=Math.sign(r.arcAngle),c={x:a.x-a.tangent.y*g.radius*sign,y:a.y+a.tangent.x*g.radius*sign};return t.line.every(p=>Math.abs(Math.hypot(p.x-c.x,p.y-c.y)-g.radius)<.01);});}),true);
assert.deepEqual(errors,[]);console.log('PASS: circular arc controls, radius, opposite side, splitting, undo/redo, reload and JSON.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
