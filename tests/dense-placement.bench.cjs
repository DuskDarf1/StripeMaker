// Real pointer previews on the same connected fixture as dense-editor.bench.cjs.
// Run separately from other browser benchmarks. Escape cancels every preview.
const fs=require('node:fs'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const gridSize=Number(process.env.GRID_SIZE||6),fixture=require('./fixtures/dense-editor.cjs')(gridSize);
const stats=values=>{const a=values.slice().sort((a,b)=>a-b);return {count:a.length,p50:a[Math.floor(a.length*.5)]??0,p95:a[Math.floor(a.length*.95)]??0,max:a.at(-1)??0};};
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
 const output={browser:await browser.version(),gridSize,scenarios:[]};
 try{
  const page=await browser.newPage({viewport:{width:1500,height:1100}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.STRIPEMAKER_URL||'http://127.0.0.1:8884');await page.waitForFunction(()=>StripeMaker.sheets.ready);
  await page.locator('#blankSheet').evaluate(b=>b.click());await page.waitForFunction(()=>StripeMaker.sheets.selected);
  for(const scenario of ['road','marking','crosswalk','sign']){
   const data=await page.evaluate(({fixture,scenario})=>{
    const A=StripeMaker,s=A.sheets.selected;A.showEditor(null);Object.assign(s,structuredClone(fixture));
    A.roadEditor.render();A.history.rebase();
    const t=A.roadEditor.laneTracks(s)[0],i=Math.floor(t.line.length*.35),p=t.line[i],offset=(t.laneBounds[i][0][0]+t.laneBounds[i][0][1])/2;
    const at={x:p.x-p.tangent.y*offset,y:p.y+p.tangent.x*offset};
    s.view={scale:1,x:800-at.x,y:500-at.y,fitted:false};A.sheets.zoomBy(1);
    A.showEditor(scenario==='road'?'elementsEditor':scenario==='sign'?'signsEditor':'markingsEditor');
    const r=document.querySelector('#previewStage').getBoundingClientRect();
    return {x:800+r.left,y:500+r.top,counts:[s.roads.length,s.markings.length,s.signs.length,s.intersections.length]};
   },{fixture,scenario});
   await page.waitForTimeout(100);
   let {x,y}=data;
   if(scenario==='road') {await page.locator('#addRoad').click();y-=150;await page.mouse.click(x-80,y-80);}
   if(scenario==='sign') {await page.locator('#addText').click();y-=150;await page.mouse.click(x-80,y-80);}
   if(scenario==='crosswalk') {
    await page.locator('#chooseMarking').click();await page.locator('#markingPicker [data-type="crosswalk"]').click();
    await page.mouse.click(x,y-55);
   }
   await page.mouse.move(x,y);await page.evaluate(()=>new Promise(requestAnimationFrame));
   const preview=()=>page.evaluate(scenario=>scenario==='road'?StripeMaker.sheets.selected.roadLayer.querySelector('.preview')?.outerHTML:
    document.querySelector(scenario==='sign'?'.signOverlay .preview':'.markingPreview')?.outerHTML,scenario);
   const before=await preview();assert(before,`${scenario}: preview is visible`);
   await page.evaluate(()=>{window.placementFrames=[];window.placementRunning=true;let last;function frame(t){if(!placementRunning)return;if(last)placementFrames.push(t-last);last=t;requestAnimationFrame(frame);}requestAnimationFrame(frame);});
   const events=[],start=performance.now();
   for(let i=1;i<=Number(process.env.MOVES||30);i++){const t=performance.now();await page.mouse.move(x+i*2,y+(scenario==='crosswalk'?i*.5:0));events.push(performance.now()-t);}
   const moveMs=performance.now()-start;await page.evaluate(()=>new Promise(requestAnimationFrame));
   assert.notEqual(await preview(),before,`${scenario}: preview follows pointer`);
   const frames=await page.evaluate(()=>{placementRunning=false;return placementFrames;});
   if(process.env.VERIFY){
    const fast=await page.evaluate(()=>StripeMaker.sheets.selected.roadLayer.outerHTML);
    await page.evaluate(()=>StripeMaker.roadEditor.render());
    assert.equal(await page.evaluate(()=>StripeMaker.sheets.selected.roadLayer.outerHTML),fast,`${scenario}: preview update matches a complete render`);
   }
   await page.keyboard.press('Escape');
   const counts=await page.evaluate(()=>{const s=StripeMaker.sheets.selected;return[s.roads.length,s.markings.length,s.signs.length,s.intersections.length];});
   assert.deepEqual(counts,data.counts,`${scenario}: canceled preview does not add objects`);
   const result={scenario,moveMs,events:stats(events),frames:stats(frames)};output.scenarios.push(result);console.log(JSON.stringify(result));
  }
  assert.deepEqual(errors,[]);fs.writeFileSync(process.env.REPORT||'/tmp/dense-placement.json',JSON.stringify({...output,errors},null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
