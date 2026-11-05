/* FIXTURE=/path/to/project.json; optional BASELINE_JS_DIR serves saved JS for
   exact before/after comparison. SCENARIO=node|median|intersection|marking; ITEM selects
   median/intersection, ROAD selects a visible road. VERIFY=1 captures each drag
   step (run separately from timing); COMPARE_WITH asserts exact saved hashes.
   FRAME_P95_MS optionally gates frame time. TRACE=1 records Chromium's timeline.
   STEP_X/STEP_Y set each move's screen-pixel delta (defaults .5/.3).
   Run timing scenarios sequentially; keep profiling separate from timing.
   Uses an isolated profile; never writes fixture. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const hash=x=>crypto.createHash('sha256').update(typeof x==='string'?x:JSON.stringify(x)).digest('hex');
(async()=>{
 assert(process.env.FIXTURE,'Set FIXTURE to a saved project JSON');
 const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
 const report=process.env.REPORT||'/tmp/editor-drag.json';
 try {
  const page=await browser.newPage({viewport:{width:1500,height:1100}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  if(process.env.BASELINE_JS_DIR)await page.route('**/js/*.js',async route=>{
   const file=path.join(process.env.BASELINE_JS_DIR,path.basename(new URL(route.request().url()).pathname));
   if(fs.existsSync(file))return route.fulfill({path:file,contentType:'text/javascript'});await route.continue();
  });
  await page.goto(process.env.STRIPEMAKER_URL||'http://127.0.0.1:8876');await page.waitForFunction(()=>StripeMaker.sheets.ready);
  await page.evaluate(p=>StripeMaker.projectJSON.load(p),JSON.parse(fs.readFileSync(process.env.FIXTURE)));
  await page.evaluate(()=>{const A=StripeMaker,s=A.sheets.selected;A.showEditor('elementsEditor');const joints=s.joints,x0=Math.min(...joints.map(p=>p.x)),x1=Math.max(...joints.map(p=>p.x)),y0=Math.min(...joints.map(p=>p.y)),y1=Math.max(...joints.map(p=>p.y));
   const scale=Math.min(900/(x1-x0),850/(y1-y0));s.view={scale,x:950-(x0+x1)*scale/2,y:550-(y0+y1)*scale/2};A.sheets.zoomBy(1);A.roadEditor.render();
  });
  await page.waitForTimeout(500);
  const scenario=process.env.SCENARIO||'node';
  if(scenario!=='node')await page.evaluate(({scenario,index})=>{
   const A=StripeMaker,s=A.sheets.selected,item=scenario==='intersection'?s.intersections[index]:scenario==='marking'?s.markings[index]:s.medians[index];
   if(!item)throw Error('Missing benchmark item');
   const ring=scenario==='marking'?A.markings.outlines(item.id)[0]:null;
   const p=ring?ring.reduce((p,q)=>({x:p.x+q.x/ring.length,y:p.y+q.y/ring.length}),{x:0,y:0}):scenario==='intersection'?item:item.points[0];
   s.view={scale:.5,x:900-p.x*.5,y:550-p.y*.5};A.sheets.zoomBy(1);A.roadEditor.render();
   if(scenario==='intersection')A.intersections.focusAt(item);else if(scenario==='marking'){if(!A.markings.focusAt(p))throw Error('Cannot select benchmark marking');}else A.roadEditor.focusMedian(item.id);
  },{scenario,index:Number(process.env.ITEM||0)});
  const candidates=await page.locator('.roadNode').evaluateAll(nodes=>nodes.map(b=>({road:b.dataset.road,end:b.dataset.end,rect:b.getBoundingClientRect().toJSON()})).filter(n=>n.rect.x>500&&n.rect.x<1400&&n.rect.y>120&&n.rect.y<950));
  if(scenario==='node')assert(candidates.length,'Need a visible road node');
  const node=candidates.find(n=>n.road===process.env.ROAD)??candidates[0]??{};
  if(process.env.ROAD)assert.equal(node.road,process.env.ROAD,'Requested road must be visible');
  const button=scenario==='intersection'?page.locator('.intersectionHit[data-key^="body-"]').first():scenario==='marking'?page.locator('.markingOverlay button[data-part]').first():scenario==='median'?page.getByRole('button',{name:/^Median point 1 of /}):page.locator(`.roadNode[data-road="${node.road}"][data-end="${node.end}"]`).first();
  const b=await button.boundingBox();let x=b.x+b.width/2,y=b.y+b.height/2;
  if(scenario==='intersection')({x,y}=await page.evaluate(index=>{
   const s=StripeMaker.sheets.selected,item=s.intersections[index],p=StripeMaker.sheets.toScreen(item),r=document.querySelector('#previewStage').getBoundingClientRect();
   for(let dy=-40;dy<=40;dy+=10)for(let dx=-40;dx<=40;dx+=10){const x=p.x+r.left+dx,y=p.y+r.top+dy;if(document.elementFromPoint(x,y)?.dataset.key===`body-${item.id}`)return {x,y};}
   throw Error('No unobstructed intersection body to drag');
  },Number(process.env.ITEM||0)));
  const initial=await page.evaluate(()=>{const s=StripeMaker.sheets.selected;return JSON.stringify({roads:s.roads,joints:s.joints,intersections:s.intersections,medians:s.medians,gores:s.gores,markings:s.markings,lines:s.lines});});
  let session;
  if(process.env.PROFILE==='1'||process.env.TRACE==='1')session=await page.context().newCDPSession(page);
  if(process.env.PROFILE==='1'){await session.send('Profiler.enable');await session.send('Profiler.start');}
  const timeline=[];let traceComplete;
  if(process.env.TRACE==='1'){
   session.on('Tracing.dataCollected',({value})=>timeline.push(...value));
   traceComplete=new Promise(resolve=>session.once('Tracing.tracingComplete',resolve));
   await session.send('Tracing.start',{categories:'devtools.timeline,blink.user_timing',transferMode:'ReportEvents'});
  }
  await page.mouse.move(x,y);await page.mouse.down();
  await page.evaluate(()=>{window.dragFrames=[];window.measuring=true;performance.mark('editor-drag-start');let previous;function f(t){if(!measuring)return;if(previous)dragFrames.push(t-previous);previous=t;requestAnimationFrame(f);}requestAnimationFrame(f);});
  const snapshots=[],start=performance.now();
  for(let i=1;i<=Number(process.env.MOVES||30);i++){
   await page.mouse.move(x+i*Number(process.env.STEP_X??.5),y+i*Number(process.env.STEP_Y??.3));
   if(process.env.VERIFY==='1')snapshots.push(await page.evaluate(async()=>{
    await new Promise(requestAnimationFrame);const s=StripeMaker.sheets.selected;
    return {geometry:JSON.stringify({roads:s.roads,joints:s.joints,intersections:s.intersections,medians:s.medians,gores:s.gores,markings:s.markings,lines:s.lines}),svg:s.roadLayer.outerHTML,selection:document.querySelector('.selectionRotate').parentNode.innerHTML};
   }));
  }
  const movingMs=performance.now()-start;
  await page.evaluate(()=>{measuring=false;performance.mark('editor-drag-end');});
  const release=performance.now();await page.mouse.up();const releaseMs=performance.now()-release;
  if(process.env.PROFILE==='1'){const {profile}=await session.send('Profiler.stop');fs.writeFileSync(report.replace(/\.json$/,'.cpuprofile'),JSON.stringify(profile));}
  if(process.env.TRACE==='1'){await session.send('Tracing.end');await traceComplete;fs.writeFileSync(report.replace(/\.json$/,'.trace.json'),JSON.stringify({traceEvents:timeline}));}
  const result=await page.evaluate(()=>{measuring=false;const A=StripeMaker,s=A.sheets.selected;return {frames:dragFrames,geometry:JSON.stringify({roads:s.roads,joints:s.joints,intersections:s.intersections,medians:s.medians,gores:s.gores,markings:s.markings,lines:s.lines}),svg:s.roadLayer.outerHTML,selection:document.querySelector('.selectionRotate').parentNode.innerHTML};});
  await page.waitForTimeout(500);
  const stats=v=>{v=v.slice().sort((a,b)=>a-b);return {count:v.length,p50:v[Math.floor(v.length*.5)],p95:v[Math.floor(v.length*.95)],max:v.at(-1),over25ms:v.filter(t=>t>25).length};};
  const traceStart=timeline.find(e=>e.name==='editor-drag-start')?.ts,traceEnd=timeline.find(e=>e.name==='editor-drag-end')?.ts;
  const duringDrag=timeline.filter(e=>e.ph==='X'&&e.ts>=traceStart&&e.ts<traceEnd);
  const work=process.env.TRACE==='1'?{
   pointerMoves:stats(duringDrag.filter(e=>e.name==='EventDispatch'&&e.args?.data?.type==='pointermove').map(e=>e.dur/1000)),
   animationCallbacks:stats(duringDrag.filter(e=>e.name==='FireAnimationFrame').map(e=>e.dur/1000))
  }:undefined;
  assert.notEqual(result.geometry,initial,'The gesture must edit geometry');
  if(snapshots.length)assert(new Set(snapshots.map(s=>s.geometry)).size>1,'Each replay must actually move geometry, not click an overlapping control');
  const network=await page.evaluate(()=>({roads:StripeMaker.roadEditor.simulatorNetwork(StripeMaker.sheets.selected),intersections:StripeMaker.intersections.simulatorNetwork(StripeMaker.sheets.selected)}));
  const output={networkHash:hash(network),scenario,item:Number(process.env.ITEM||0),snapshots:snapshots.map(s=>({geometry:hash(s.geometry),svg:hash(s.svg),selection:hash(s.selection)})),node:{road:node.road,end:node.end},movingMs,releaseMs,frames:stats(result.frames),work,geometryHash:hash(result.geometry),svgHash:hash(result.svg),selectionHash:hash(result.selection),errors};
  fs.writeFileSync(report,JSON.stringify(output,null,2));fs.writeFileSync(report.replace(/\.json$/,'.svg'),result.svg);fs.writeFileSync(report.replace(/\.json$/,'.geometry.json'),result.geometry);
  if(process.env.DUMP_STEPS==='1')fs.writeFileSync(report.replace(/\.json$/,'.steps.json'),JSON.stringify(snapshots));
  if(process.env.COMPARE_WITH){
   const previous=JSON.parse(fs.readFileSync(process.env.COMPARE_WITH));
   for(const key of ['snapshots','geometryHash','svgHash','networkHash'])assert.deepEqual(output[key],previous[key],`Unchanged ${key}`);
   if(previous.selectionHash)assert.equal(output.selectionHash,previous.selectionHash,'Unchanged selection and rotation handle');
  }
  if(process.env.FRAME_P95_MS)assert(output.frames.p95<=Number(process.env.FRAME_P95_MS),'Drag frame budget');
  console.log(JSON.stringify({...output,snapshots:output.snapshots.length},null,2));assert.deepEqual(errors,[]);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
