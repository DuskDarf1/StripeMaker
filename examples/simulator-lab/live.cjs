// Real Chromium frames, production rendering and driver model; isolated storage.
const path=require('node:path');
const fs=require('node:fs');
const {pathToFileURL}=require('node:url');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
 try{
  const page=await browser.newPage({viewport:{width:1400,height:1000}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.STRIPEMAKER_URL||pathToFileURL(path.resolve(__dirname,'../../index.html')).href);
  const png=await page.evaluate(()=>document.createElement('canvas').toDataURL().split(',')[1]);
  await page.locator('#sheetFile').setInputFiles({name:'Agent stress playground.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
  await page.waitForFunction(()=>StripeMaker.sheets.selected);
  await page.evaluate(()=>{
   const app=StripeMaker,s=app.sheets.selected;let seed=123;
   Math.random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
   Object.assign(s,{inchesPerPixel:2,roads:[],joints:[],vehicleSpawns:[],intersections:[],gores:[],medians:[],markings:[],bridges:[],lines:[],surfaces:[],autoTapers:false});
   for(let i=0;i<8;i++){
    s.roads.push({id:i+1,lanes:3,laneWidth:12,ends:[{joint:2*i+1,sign:1},{joint:2*i+2,sign:1}]});
    s.joints.push({id:2*i+1,x:100,y:100+i*240,dir:{x:1,y:0},root:i+1,links:[]},{id:2*i+2,x:30100,y:100+i*240,dir:{x:1,y:0},root:i+1,links:[]});
    s.vehicleSpawns.push({road:i+1,rate:600,routes:[{name:'Corridor exit',percent:100,exit:{road:i+1,e:1}}]});
   }
   app.settings.set('simulationSpeed',30);app.roadEditor.render();app.showEditor('simulatorEditor');
   window.frameSamples=[];window.longTasks=[];let previous;
   new PerformanceObserver(list=>longTasks.push(...list.getEntries().map(e=>e.duration))).observe({type:'longtask',buffered:true});
   function sample(now){if(previous)frameSamples.push(now-previous);previous=now;requestAnimationFrame(sample);}requestAnimationFrame(sample);
  });
  const start=Date.now();await page.click('#playSimulation');
  await page.waitForTimeout(Number(process.env.DURATION_MS||15000));
  const report=await page.evaluate(()=>{
   const sorted=frameSamples.slice().sort((a,b)=>a-b),d=StripeMaker.simulator.diagnostics();
   return {scenario:'eight-three-lane-corridors',seed:123,frames:sorted.length,p50ms:sorted[Math.floor(sorted.length*.5)],p95ms:sorted[Math.floor(sorted.length*.95)],maxms:sorted.at(-1),longTasks:longTasks.length,cars:d.cars.length,queued:d.queued,simulationSeconds:d.time};
  });
  report.wallSeconds=(Date.now()-start)/1000;report.errors=errors;
  const output=process.env.REPORT||'/tmp/stripemaker-simulator-live.json';fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
  await page.screenshot({path:output.replace(/\.json$/,'.png')});console.log(JSON.stringify(report,null,2));
  if(errors.length)throw Error(errors.join('\n'));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
