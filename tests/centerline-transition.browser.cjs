const assert=require('node:assert/strict'),path=require('node:path'),{pathToFileURL}=require('node:url');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});try{
const page=await browser.newPage({viewport:{width:1500,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto(pathToFileURL(path.resolve(__dirname,'../index.html')).href);await page.waitForFunction(()=>StripeMaker.sheets.ready);
await page.locator('#blankSheet').evaluate(b=>b.click());await page.waitForFunction(()=>StripeMaker.sheets.selected);
await page.locator('[data-editor="elementsEditor"]').click();
await page.evaluate(()=>{
 const A=StripeMaker,s=A.sheets.selected;s.inchesPerPixel=4;s.view={scale:1,x:0,y:0};s.content.style.transform="translate(0px, 0px) scale(1)";s.content.style.setProperty("--zoom",1);
 const r=(id,lanes,a,b,sign)=>({id,lanes,laneWidth:12,ends:[{joint:a,sign,length:null},{joint:b,sign,length:null}]});
 s.roads=[r(1,2,1,2,1),r(2,1,2,1,-1),r(3,1,3,4,1),r(4,2,4,3,-1)];
 s.joints=[{id:1,x:550,y:500},{id:2,x:850,y:500},{id:3,x:1050,y:536},{id:4,x:1350,y:536}].map((j,i)=>({...j,root:i<2?1:3,dir:{x:1,y:0},links:[{a:i<2?1:3,ai:0,b:i<2?2:4,bi:0,pair:true}]}));
 A.roadEditor.render();document.dispatchEvent(new CustomEvent('sheetview'));A.history.record();
});
const from=await page.locator(process.env.REVERSE_JOIN ? '.roadNode[data-road="3"][data-end="0"][data-lane="0"]' : '.roadNode[data-road="1"][data-end="1"][data-lane="0"]').boundingBox();
const to=await page.locator(process.env.REVERSE_JOIN ? '.roadNode[data-road="1"][data-end="1"][data-lane="0"]' : '.roadNode[data-road="3"][data-end="0"][data-lane="0"]').boundingBox();
await page.mouse.move(from.x+from.width/2,from.y+from.height/2);await page.mouse.down();await page.mouse.move(to.x+to.width/2,to.y+to.height/2,{steps:12});await page.mouse.up();
const inspect=()=>page.evaluate(()=>{
const A=StripeMaker,s=A.sheets.selected,tracks=A.roadEditor.laneTracks(s);
return {roads:s.roads,joints:s.joints,edges:tracks.filter(t=>s.roads.find(r=>r.id===t.road).centerlineTransition).map(t=>({road:t.road,outer:t.markingEdges.at(-1),inner:t.markingEdges[0]})),network:A.roadEditor.simulatorNetwork(s)};
});
let result=await inspect();assert.equal(result.roads.length,6);assert.equal(result.edges.length,2);
for(const edge of result.edges){const ys=edge.outer.map(p=>p.y);assert(Math.max(...ys)-Math.min(...ys)<.01,JSON.stringify({road:edge.road,range:[Math.min(...ys),Math.max(...ys)]}));assert(Math.abs(edge.inner[0].y-edge.inner.at(-1).y)>35);}
assert.equal(result.roads.filter(r=>r.centerlineTransition).length,2);
const saved=await page.evaluate(async()=>{const p=await StripeMaker.projectJSON.snapshot();StripeMaker.projectJSON.validate(p);return p;});
assert.equal(saved.version,1);assert.equal(saved.sheets[0].data.roads.filter(r=>r.centerlineTransition).length,2);
await page.screenshot({path:'/tmp/centerline-transition.png'});
await page.locator('#undoButton').click();assert.equal(await page.evaluate(()=>StripeMaker.sheets.selected.roads.length),4);
await page.locator('#redoButton').click();assert.equal((await inspect()).edges.length,2);
await page.waitForTimeout(700);await page.reload();await page.waitForFunction(()=>StripeMaker.sheets.selected?.roads.length===6);
assert.equal((await inspect()).edges.length,2);
// Import retains profiles without changing the JSON envelope.
await page.evaluate(async p=>{await StripeMaker.projectJSON.load(p);},saved);
assert.equal((await inspect()).edges.length,2);
// Splitting the transition must retain its outer edges and linear lane widths.
const click=await page.evaluate(()=>{const s=StripeMaker.sheets.selected,r=s.roads.find(r=>r.centerlineTransition);StripeMaker.roadEditor.focusRoad(r);const track=StripeMaker.roadEditor.laneTracks(s).find(t=>t.road===r.id);const i=Math.floor(track.line.length/2),p=track.markingEdges.at(-1)[i];const inner=track.markingEdges.at(-2)[i],at=StripeMaker.sheets.toScreen({x:(p.x+inner.x)/2,y:(p.y+inner.y)/2}),rect=document.getElementById("previewStage").getBoundingClientRect();return {x:at.x+rect.left,y:at.y+rect.top};});
await page.mouse.dblclick(click.x,click.y);
const split=await inspect();assert.equal(split.edges.length,4);
for(const edge of split.edges){const ys=edge.outer.map(p=>p.y);assert(Math.max(...ys)-Math.min(...ys)<.05,'split keeps outer edge straight');}
assert.deepEqual(errors,[]);
console.log('PASS: drag join creates paired centerline transition with straight outer edges, undo/redo and reload.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
