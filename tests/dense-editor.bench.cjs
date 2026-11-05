// Run scenarios sequentially. PROFILE=1 is a separate diagnostic pass;
// BASELINE_JS_DIR serves saved pre-change JS. REPORT=/tmp/dense-before.json.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const gridSize=Number(process.env.GRID_SIZE||4),fixture=require('./fixtures/dense-editor.cjs')(gridSize);
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const stats=values=>{const a=values.slice().sort((a,b)=>a-b);return {count:a.length,p50:a[Math.floor(a.length*.5)]??0,p95:a[Math.floor(a.length*.95)]??0,max:a.at(-1)??0,over33ms:a.filter(n=>n>34).length};};
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
 const report=process.env.REPORT||'/tmp/dense-editor.json',output={browser:await browser.version(),gridSize,
  counts:{...Object.fromEntries(Object.entries(fixture).filter(([,v])=>Array.isArray(v)).map(([k,v])=>[k,v.length])),intersectionMedians:fixture.intersections.reduce((n,i)=>n+i.medians.length,0)},scenarios:[]};
 try{
  const page=await browser.newPage({viewport:{width:1500,height:1100}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.text().startsWith('STRESS '))console.log(m.text());});
  if(process.env.BASELINE_JS_DIR)await page.route('**/js/*.js',async route=>{const file=path.join(process.env.BASELINE_JS_DIR,path.basename(new URL(route.request().url()).pathname));if(fs.existsSync(file))return route.fulfill({path:file,contentType:'text/javascript'});await route.continue();});
  await page.goto(process.env.STRIPEMAKER_URL||'http://127.0.0.1:8884');await page.waitForFunction(()=>StripeMaker.sheets.ready);
  await page.locator('#blankSheet').evaluate(b=>b.click());await page.waitForFunction(()=>StripeMaker.sheets.selected);
  for(const scenario of (process.env.SCENARIOS||'sign,marking,node,intersection').split(',')){
   const startup=await page.context().newCDPSession(page);
   if(process.env.PROFILE_SETUP){await startup.send('Profiler.enable');await startup.send('Profiler.start');}
   const timer=process.env.PROFILE_SETUP?setTimeout(async()=>{const {profile}=await startup.send('Profiler.stop');fs.writeFileSync(report.replace('.json','-setup.cpuprofile'),JSON.stringify(profile));console.log('STRESS setup profile saved');},20000):null;
   const setup=await page.evaluate(async({data,scenario})=>{
    console.log('STRESS starting '+scenario);
    const A=StripeMaker,s=A.sheets.selected;A.showEditor(null);Object.assign(s,structuredClone(data));s.id='dense-sheet';
    s.view={scale:.12,x:480,y:20,fitted:false};A.sheets.zoomBy(1);
    const t=performance.now();A.roadEditor.render();console.log('STRESS first render '+Math.round(performance.now()-t)+'ms');await A.signs.ready(s);A.history.rebase();
    const item=scenario==='intersection'?s.intersections[14]:scenario==='sign'?s.signs[14]:scenario==='marking'?s.markings.find(m=>m.id==='arrow-1'):s.roads[0];
    let point=item;
    if(scenario==='marking'){const ring=A.markings.outlines(item.id)[0];point=ring.reduce((p,q)=>({x:p.x+q.x/ring.length,y:p.y+q.y/ring.length}),{x:0,y:0});}
    if(scenario==='node')point=s.joints.find(j=>j.id===item.ends[1].joint);
    const zoom=scenario==='marking'?2:.65;
    s.view={scale:zoom,x:900-point.x*zoom,y:550-point.y*zoom,fitted:false};A.sheets.zoomBy(1);A.roadEditor.render();
    if(scenario==='intersection')A.intersections.focusAt(item);
    if(scenario==='node')A.roadEditor.focusRoad(item);
    if(scenario==='marking'&&!A.markings.focusAt(point))throw Error('Missing marking');
    if(scenario==='sign')A.showEditor('signsEditor');
    const links=s.intersections.flatMap(i=>i.approaches.flatMap(a=>a.links??[]));
    // Graph connectivity follows actual shared joints and linked approaches.
    const graph=new Map(s.roads.map(r=>[`r${r.id}`,new Set()]));
    const join=(a,b)=>{if(!graph.has(a))graph.set(a,new Set());if(!graph.has(b))graph.set(b,new Set());graph.get(a).add(b);graph.get(b).add(a);};
    for(const j of s.joints){const ids=s.roads.filter(r=>r.ends.some(e=>e.joint===j.id)).map(r=>`r${r.id}`);for(const id of ids)join(ids[0],id);}
    for(const i of s.intersections)for(const a of i.approaches)for(const l of a.links??[])join(`i${i.id}`,`r${l.road}`);
    const seen=new Set(),queue=[graph.keys().next().value];while(queue.length){const a=queue.pop();if(seen.has(a))continue;seen.add(a);queue.push(...graph.get(a));}
    return {setupMs:performance.now()-t,item:item.id,links:links.length,connected:seen.size,total:graph.size,domNodes:s.roadLayer.querySelectorAll('*').length};
   },{data:fixture,scenario});
   if(timer)clearTimeout(timer);await startup.detach();console.log('STRESS ready '+scenario+' '+JSON.stringify(setup));
   assert.equal(setup.connected,setup.total,'All structural objects form one connected network');assert.equal(setup.links,gridSize*gridSize*16);
   await page.waitForTimeout(300);
   if(output.scenarios.length===0&&(process.env.SAVE_FIXTURE||process.env.OVERVIEW)){
    const savedView=await page.evaluate(()=>{
     const A=StripeMaker,s=A.sheets.selected,old={...s.view},xs=s.joints.map(j=>j.x),ys=s.joints.map(j=>j.y);
     const x0=Math.min(...xs)-250,x1=Math.max(...xs)+300,y0=Math.min(...ys)-250,y1=Math.max(...ys)+250;
     const scale=Math.min(1350/(x1-x0),930/(y1-y0));s.view={scale,x:750-(x0+x1)*scale/2,y:480-(y0+y1)*scale/2,fitted:false};A.showEditor(null);A.sheets.zoomBy(1);return old;
    });
    if(process.env.SAVE_FIXTURE){const project=await page.evaluate(()=>StripeMaker.projectJSON.snapshot('selected'));delete project.diagnostics;fs.writeFileSync(process.env.SAVE_FIXTURE,JSON.stringify(project));}
    if(process.env.OVERVIEW)await page.screenshot({path:process.env.OVERVIEW});
    await page.evaluate(({view,scenario,id})=>{const A=StripeMaker,s=A.sheets.selected;s.view=view;A.sheets.zoomBy(1);
     if(scenario==='intersection')A.intersections.focusAt(s.intersections.find(i=>i.id===id));
     if(scenario==='node')A.roadEditor.focusRoad(s.roads.find(r=>r.id===id));
     if(scenario==='sign')A.showEditor('signsEditor');
     if(scenario==='marking'){const ring=A.markings.outlines(id)[0];A.markings.focusAt(ring.reduce((p,q)=>({x:p.x+q.x/ring.length,y:p.y+q.y/ring.length}),{x:0,y:0}));}
    },{view:savedView,scenario,id:setup.item});
   }
   let target=scenario==='sign'?page.locator(`.signHit[data-sign="${setup.item}"]`):scenario==='marking'?page.locator('.markingOverlay button[data-part="move"]'):scenario==='node'?page.locator('.roadNode[data-road="1"][data-end="1"][data-lane="0"]'):page.locator(`.intersectionHit[data-key="body-${setup.item}"]`);
   const rect=await target.boundingBox();assert(rect,`Missing ${scenario} handle`);let x=rect.x+rect.width/2,y=rect.y+rect.height/2;
   if(scenario==='marking')({x,y}=await page.evaluate(id=>{
    const A=StripeMaker,ring=A.markings.outlines(id)[0],r=document.querySelector('#previewStage').getBoundingClientRect();
    const xs=ring.map(p=>p.x),ys=ring.map(p=>p.y),left=Math.min(...xs),top=Math.min(...ys),w=Math.max(...xs)-left,h=Math.max(...ys)-top;
    for(let j=1;j<10;j++)for(let i=1;i<10;i++){
     const p={x:left+w*i/10,y:top+h*j/10},q=A.sheets.toScreen(p),x=q.x+r.left,y=q.y+r.top;
     if(A.markings.hitAt(p)===id && !document.elementFromPoint(x,y)?.closest('button'))return{x,y};
    }
    throw Error('No unobstructed marking body');
   },setup.item));
   if(scenario==='intersection')({x,y}=await page.evaluate(id=>{const item=StripeMaker.sheets.selected.intersections.find(i=>i.id===id),p=StripeMaker.sheets.toScreen(item),r=document.querySelector('#previewStage').getBoundingClientRect();for(let dy=-40;dy<=40;dy+=10)for(let dx=-40;dx<=40;dx+=10){const x=p.x+r.left+dx,y=p.y+r.top+dy;if(document.elementFromPoint(x,y)?.dataset.key===`body-${id}`)return{x,y};}throw Error('No intersection body');},setup.item));
   const snapshot=()=>page.evaluate(()=>{const s=StripeMaker.sheets.selected;return {geometry:JSON.stringify([s.roads,s.joints,s.intersections,s.markings,s.signs,s.medians,s.gores,s.lines]),svg:s.roadLayer.outerHTML};});
   const before=await snapshot();
   const editedValue=()=>page.evaluate(({scenario,id})=>{const s=StripeMaker.sheets.selected,item=scenario==='sign'?s.signs.find(v=>v.id===id):scenario==='marking'?s.markings.find(v=>v.id===id):scenario==='intersection'?s.intersections.find(v=>v.id===id):s.joints.find(j=>j.id===s.roads[0].ends[1].joint);return JSON.stringify(scenario==='marking'?[item.on,item.back]:[item.x,item.y]);},{scenario,id:setup.item});
   const beforeValue=await editedValue();const cdp=await page.context().newCDPSession(page);
   if(process.env.PROFILE){await cdp.send('Profiler.enable');await cdp.send('Profiler.start');}
   const trace=[];let traceComplete;
   if(process.env.TRACE){cdp.on('Tracing.dataCollected',({value})=>trace.push(...value));traceComplete=new Promise(resolve=>cdp.once('Tracing.tracingComplete',resolve));await cdp.send('Tracing.start',{categories:'devtools.timeline,blink.user_timing',transferMode:'ReportEvents'});}
   await page.mouse.move(x,y);const down=performance.now();await page.mouse.down();const pressMs=performance.now()-down;
   await page.evaluate(()=>{window.stressFrames=[];window.stressRunning=true;performance.mark('stress-start');let prev;function frame(t){if(!stressRunning)return;if(prev)stressFrames.push(t-prev);prev=t;requestAnimationFrame(frame);}requestAnimationFrame(frame);});
   const eventTimes=[],snapshots=[],start=performance.now();
   for(let i=1;i<=Number(process.env.MOVES||24);i++){const t=performance.now();await page.mouse.move(x+i*3,y+i);eventTimes.push(performance.now()-t);if(process.env.VERIFY){await page.evaluate(()=>new Promise(requestAnimationFrame));const s=await snapshot();snapshots.push({geometry:hash(s.geometry),svg:hash(s.svg)});}}
   const moveMs=performance.now()-start;await page.evaluate(()=>{stressRunning=false;performance.mark('stress-end');});const up=performance.now();await page.mouse.up();const releaseMs=performance.now()-up;
   if(process.env.PROFILE){const {profile}=await cdp.send('Profiler.stop');fs.writeFileSync(report.replace('.json',`-${scenario}.cpuprofile`),JSON.stringify(profile));}
   if(process.env.TRACE){await cdp.send('Tracing.end');await traceComplete;fs.writeFileSync(report.replace('.json',`-${scenario}.trace.json`),JSON.stringify({traceEvents:trace}));}
   const after=await snapshot();assert.notEqual(after.geometry,before.geometry,`${scenario} drag must actually edit`);
   assert.notEqual(await editedValue(),beforeValue,`${scenario} drag must change the intended object`);
   const frames=await page.evaluate(()=>stressFrames);
   const result={scenario,...setup,pressMs,moveMs,releaseMs,events:stats(eventTimes),frames:stats(frames),geometryHash:hash(after.geometry),svgHash:hash(after.svg),snapshots};
   if(process.env.TRACE){const from=trace.find(e=>e.name==='stress-start')?.ts,to=trace.find(e=>e.name==='stress-end')?.ts,active=trace.filter(e=>e.ph==='X'&&e.ts>=from&&e.ts<to);
    result.work={animationCallbacks:stats(active.filter(e=>e.name==='FireAnimationFrame').map(e=>e.dur/1000)),pointerMoves:stats(active.filter(e=>e.name==='EventDispatch'&&e.args?.data?.type==='pointermove').map(e=>e.dur/1000))};}
   output.scenarios.push(result);console.log(JSON.stringify({...result,snapshots:snapshots.length}));
   fs.writeFileSync(report,JSON.stringify({...output,errors},null,2));
   fs.writeFileSync(report.replace('.json',`-${scenario}.geometry.json`),after.geometry);
   fs.writeFileSync(report.replace('.json',`-${scenario}.svg`),after.svg);
   if(process.env.SCREENSHOT)await page.screenshot({path:report.replace('.json',`-${scenario}.png`)});
   await cdp.detach();
  }
  if(process.env.COMPARE_WITH){
   const prior=JSON.parse(fs.readFileSync(process.env.COMPARE_WITH));
   for(const current of output.scenarios){
    const old=prior.scenarios.find(s=>s.scenario===current.scenario);
    assert.equal(current.svgHash,old.svgHash,`${current.scenario}: byte-identical SVG`);
    const load=file=>JSON.parse(fs.readFileSync(file.replace('.json',`-${current.scenario}.geometry.json`)));
    let maxDelta=0,roundingDifferences=0;
    const compare=(a,b,p)=>{
     if(Object.is(a,b))return;
     if(typeof a==='number'&&typeof b==='number'){const delta=Math.abs(a-b);assert(delta<1e-9,`${p}: geometry changed ${a} -> ${b}`);maxDelta=Math.max(maxDelta,delta);roundingDifferences++;return;}
     assert.equal(typeof a,typeof b,p);assert.equal(a==null,b==null,p);
     assert(a&&b&&typeof a==='object',`${p}: model value changed`);
     assert.deepEqual(Object.keys(a),Object.keys(b),`${p}: fields/ordering unchanged`);
     for(const key of Object.keys(a))compare(a[key],b[key],`${p}.${key}`);
    };
    compare(load(process.env.COMPARE_WITH),load(report),current.scenario);
    current.comparison={identicalSVG:true,maxNumericDelta:maxDelta,roundingDifferences};
   }
   fs.writeFileSync(report,JSON.stringify({...output,errors},null,2));
  }
  assert.deepEqual(errors,[]);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
