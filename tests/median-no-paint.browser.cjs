const assert=require('node:assert/strict'),choose=require('./select-choice.cjs');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});try{
 const page=await browser.newPage({viewport:{width:1400,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.env.STRIPEMAKER_URL||'http://127.0.0.1:8884');await page.waitForFunction(()=>StripeMaker.sheets.ready);await page.locator('#blankSheet').evaluate(b=>b.click());await page.waitForFunction(()=>StripeMaker.sheets.selected);
 await page.evaluate(()=>{const A=StripeMaker,s=A.sheets.selected;s.inchesPerPixel=12;s.roads=[];s.joints=[];
  s.medians=[{id:1,type:'painted',color:'yellow',spacing:20,points:[{x:500,y:100},{x:700,y:100},{x:700,y:200},{x:500,y:200}]}];
  const i=A.intersectionGeometry.create();i.x=1000;i.y=700;i.approaches[0].median=12;i.approaches[0].surface='painted';i.approaches[0].color='none';
  i.medians=[{id:'asphalt-island',type:'painted',color:'none',points:[{x:-5,y:-5},{x:5,y:-5},{x:5,y:5},{x:-5,y:5}]}];s.intersections=[i];
  A.roadEditor.render();A.history.rebase();A.roadEditor.focusMedian(1);
 });
 await choose(page.locator('#medianColor'),'none');
 assert(await page.locator('#medianLean').isHidden());
 const check=()=>page.evaluate(()=>{const s=StripeMaker.sheets.selected,g=s.roadLayer.querySelector('[data-intersection-median="asphalt-island"]');return{
  color:s.medians[0].color,islandPaint:g.querySelectorAll('[stroke],g[clip-path]').length,islandAsphalt:g.querySelectorAll('.roadBand').length,
  approachHatch:s.roadLayer.querySelectorAll('[clip-path^="url(#intersection-painted-"]').length,
  standalonePaint:[...s.roadLayer.querySelectorAll('.roadMarking')].filter(p=>{const a=p.getAttribute('d')?.match(/-?\d*\.?\d+/g)?.map(Number)??[];return a.length&&a.every((v,i)=>i%2?v>=100&&v<=200:v>=500&&v<=700);}).length
 };});
 assert.deepEqual(await check(),{color:'none',islandPaint:0,islandAsphalt:1,approachHatch:0,standalonePaint:0});
 await page.locator('#undoButton').click();assert.equal((await check()).color,'yellow');await page.locator('#redoButton').click();assert.equal((await check()).color,'none');
 await page.evaluate(()=>{const A=StripeMaker,s=A.sheets.selected;s.roads=[{id:1,lanes:1,laneWidth:12,ends:[{joint:1,sign:1},{joint:2,sign:1}]}];s.joints=[{id:1,x:493.3333333333333,y:50,dir:{x:0,y:1},links:[]},{id:2,x:493.3333333333333,y:250,dir:{x:0,y:1},links:[]}];A.roadEditor.render();A.roadEditor.focusMedian(1);A.history.rebase();});
 const crossing=()=>page.evaluate(()=>[...StripeMaker.sheets.selected.roadLayer.querySelectorAll('.roadMarking[stroke="#ffc72c"]')].some(p=>{const n=p.getAttribute('d').match(/-?\d*\.?\d+/g).map(Number);const xs=n.filter((_,i)=>i%2===0),ys=n.filter((_,i)=>i%2);return xs.every(x=>Math.abs(x-499.33)<.02)&&Math.min(...ys)<130&&Math.max(...ys)>170;}));
 assert(await crossing(),'adjacent road edge starts visible');
 await page.locator('#medianHideEdges').check();assert(!(await crossing()),'checked option trims the road edge beside asphalt median');
 await page.locator('#undoButton').click();assert(await crossing(),'undo restores edge');await page.locator('#redoButton').click();assert(!(await crossing()),'redo hides edge');
 const json=await page.evaluate(()=>StripeMaker.projectJSON.snapshot('selected'));await page.evaluate(p=>StripeMaker.projectJSON.load(p),json);
 assert.equal((await check()).color,'none');assert.equal((await check()).islandPaint,0);
 await page.waitForTimeout(800);await page.reload();await page.waitForFunction(()=>StripeMaker.sheets.selected?.medians?.length);assert.equal((await check()).color,'none');
 assert.deepEqual(errors,[]);console.log('PASS: asphalt-only painted medians render without outlines/hatching for sheet and intersection medians; undo/redo, full JSON and reload preserve no paint.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
