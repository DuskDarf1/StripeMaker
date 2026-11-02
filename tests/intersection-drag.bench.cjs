// Input-to-release timing, with complete pavement, movements and validation.
const assert=require('node:assert/strict'),{performance}=require('node:perf_hooks');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});try{
 const runs=[];
 for(let run=0;run<Number(process.env.INTERSECTION_BENCH_RUNS||3);run++) {
  const page=await browser.newPage({viewport:{width:1500,height:1100}});await page.goto(process.env.STRIPEMAKER_URL||'http://127.0.0.1:8879');await page.waitForFunction(()=>StripeMaker.sheets?.ready&&StripeMaker.intersections);
  await page.locator('#blankSheet').evaluate(b=>b.click());await page.waitForFunction(()=>StripeMaker.sheets.selected);
  await page.evaluate(()=>{const app=StripeMaker,s=app.sheets.selected,G=app.intersectionGeometry,x=G.create();G.normalize(x);G.auto(x);x.x=15000;x.y=15000;s.inchesPerPixel=2;s.intersections=[x];s.view={scale:.6,x:-8300,y:-8500,fitted:false};app.sheets.zoomBy(1);document.dispatchEvent(new Event('sheetchange'));app.roadEditor.render();app.intersections.focusAt(x);
   window.timings={render:[],validate:[]};for(const [obj,key]of [[app.roadEditor,'render'],[G,'validate']]){const old=obj[key];obj[key]=function(...args){const t=performance.now();try{return old.apply(this,args);}finally{timings[key].push(performance.now()-t);}};}
  });
  const h=await page.getByRole('button',{name:'Approach 1 Bézier curve',exact:true}).boundingBox();assert(h);const x=h.x+h.width/2,y=h.y+h.height/2;
  await page.mouse.move(x,y);await page.mouse.down();const start=performance.now();for(let i=1;i<=12;i++)await page.mouse.move(x,y+i*.3);await page.mouse.up();
  const elapsed=performance.now()-start,detail=await page.evaluate(()=>({...timings,curved:!!StripeMaker.sheets.selected.intersections[0].approaches[0].approachCurve}));assert(detail.curved);assert(detail.render.length>0);runs.push({elapsed:Math.round(elapsed),renders:detail.render.length,renderMs:Math.round(detail.render.reduce((a,b)=>a+b,0)),validateMs:Math.round(detail.validate.reduce((a,b)=>a+b,0))});await page.close();
 }
 const sorted=runs.map(r=>r.elapsed).sort((a,b)=>a-b);console.log(JSON.stringify({moves:12,movements:12,medianMs:sorted[Math.floor(sorted.length/2)],runs},null,2));
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
