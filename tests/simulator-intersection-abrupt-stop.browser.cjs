/* Saved feedback sheet, actual temperature and continuous traffic; no watchdog. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const P=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const webkit=process.env.BROWSER==='webkit',executablePath=webkit?process.env.WEBKIT_PATH:process.env.CHROME_PATH;
 const browser=await P[webkit?'webkit':'chromium'].launch({headless:true,...(executablePath?{executablePath}:{})});
 try{
  const page=await browser.newPage({viewport:{width:1400,height:1000}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',message=>{if(message.text().startsWith('STUCK-RUN'))console.log(message.text());});
  await page.goto(process.env.STRIPEMAKER_URL||pathToFileURL(path.resolve(__dirname,'../index.html')).href);
  await page.waitForFunction(()=>StripeMaker.sheets.ready);
  await page.click('button[aria-controls="sheetsMenu"]');await page.click('#blankSheet');
  await page.waitForFunction(()=>StripeMaker.sheets.selected);
  const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/simulator-intersection-abrupt-stop.json')));
  await page.evaluate(data=>{
   const A=StripeMaker,s=A.sheets.selected;StripeMaker.settings.set('simulationTemperature',data.settings.simulationTemperature);Object.assign(s,data.data);Object.assign(A.sheets.selected,{speedZones:A.sheets.selected.roads.map(road=>({id:'test-speed-'+road.id,road:road.id,from:0,to:1,mph:data.settings.simulationSpeed}))});
   s.view={x:120,y:100,scale:.65};A.sheets.zoomBy(1);A.roadEditor.render();A.showEditor('simulatorEditor');
   const advance=A.simulatorVehicles.Engine.prototype.advance;
   A.simulatorVehicles.Engine.prototype.advance=function(seconds){window.testEngine=this;return advance.call(this,seconds);};
  },fixture);
  await page.clock.install();await page.click('#playSimulation');
  const reports=await page.evaluate(({seeds,seconds,temperature})=>{
   const A=StripeMaker,e=testEngine;e.recoverStuck=()=>{};const reports=[];
   for(const seed of seeds){e.reset();let state=seed;e.random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};A.simulator.refreshOverlay();if(temperature!=null)e.temperature=temperature;
    const report={seed,seconds,temperature:e.temperature,abrupt:[],overlaps:0,completed:0},step=e.driverStep;
    e.driverStep=function(dt){const speeds=new Map(e.cars.map(c=>[c.id,c.speed]));step.call(e,dt);
     for(const c of e.cars)if(c.intersection&&['1:0','2:0'].includes(c.source)&&(speeds.get(c.id)??0)>5*e.pixelsPerFoot&&c.speed===0){const other=e.cars.find(o=>o.id===(c.situation?.collision??c.situation?.leader));report.abrupt.push({time:e.time,id:c.id,source:c.source,previousMph:speeds.get(c.id)/e.pixelsPerFoot*3600/5280,situation:c.situation,other:other?{id:other.id,source:other.source,road:other.road,lane:other.lane,change:other.laneChange}:null});}
    };
    for(let i=0;i<seconds*20;i++){
     const ids=new Set(e.cars.map(c=>c.id));e.advance(.05);const alive=new Set(e.cars.map(c=>c.id));report.completed += [...ids].filter(id=>!alive.has(id)).length;
     if(i%4===0){const C=A.simulatorCollisions,w=C.scene(e.cars,e.pixelsPerFoot);for(const c of e.cars)report.overlaps+=w.query(C.bounds(c,0,e.pixelsPerFoot)).filter(o=>o.id>c.id&&C.overlap(c,o,e.pixelsPerFoot)).length;}
    }
    e.driverStep=step;reports.push(report);console.log('STUCK-RUN '+JSON.stringify(report));
   }return reports;
  },{seeds:(process.env.SEEDS||Array.from({length:24},(_,i)=>i+1).join(',')).split(',').map(Number),seconds:Number(process.env.SECONDS||120),temperature:process.env.TEMPERATURE==null?null:Number(process.env.TEMPERATURE)});
  for(const report of reports){assert.equal(report.overlaps,0);assert.deepEqual(report.abrupt,[],JSON.stringify(report));assert(report.completed>10);}
  assert.deepEqual(errors,[]);console.log(`PASS ${webkit?'WebKit':'Chromium'} high-demand intersection abrupt-stop batch: ${reports.length} seeded runs.`);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
