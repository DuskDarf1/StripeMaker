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
    const report={seed,seconds,temperature:e.temperature,abrupt:[],hardThroughBraking:[],sameLaneBarriers:[],overlaps:0,completed:0,turnsCompleted:0},step=e.driverStep;
    const isThrough=m=>m?.junction&&Math.abs(((m.junction.exitAngle-m.junction.angle+360)%360)-180)<30;
    e.driverStep=function(dt){const speeds=new Map(e.cars.map(c=>[c.id,c.speed]));step.call(e,dt);
     for(const c of e.cars){if(!['1:0','2:0'].includes(c.source))continue;const before=speeds.get(c.id);if(before==null)continue;
      const other=e.cars.find(o=>o.id===(c.situation?.collision??c.situation?.leader)),m=c.path.movements.find(m=>m.end>=c.pathDistance),om=other?.path.movements.find(m=>m.end>=other.pathDistance);
      const braking=(before-c.speed)/dt/(e.pixelsPerFoot/.3048);
      if(before>5*e.pixelsPerFoot&&c.speed===0)report.abrupt.push({time:e.time,id:c.id,inside:!!c.intersection,situation:c.situation});
      if(isThrough(m)&&before>2*e.pixelsPerFoot&&braking>Math.max(4,c.driver.safeBraking)*1.05)report.hardThroughBraking.push({time:e.time,id:c.id,braking,situation:c.situation,other:other?.id,otherTurning:!!om&&!isThrough(om)});
      if(c.situation?.reason==='yielding-entry'&&m?.junction&&om?.junction&&m.junction.entry===om.junction.entry&&m.junction.input===om.junction.input)report.sameLaneBarriers.push({time:e.time,id:c.id,other:other.id});
     }
    };
    for(let i=0;i<seconds*20;i++){
     const before=new Map(e.cars.map(c=>[c.id,c]));e.advance(.05);const alive=new Set(e.cars.map(c=>c.id));for(const [id,c]of before)if(!alive.has(id)){report.completed++;if([14,15].includes(Number(c.route.key.split(':')[2])))report.turnsCompleted++;}
     if(i%4===0){const C=A.simulatorCollisions,w=C.scene(e.cars,e.pixelsPerFoot);for(const c of e.cars)report.overlaps+=w.query(C.bounds(c,0,e.pixelsPerFoot)).filter(o=>o.id>c.id&&C.overlap(c,o,e.pixelsPerFoot)).length;}
    }
    e.driverStep=step;reports.push(report);console.log('STUCK-RUN '+JSON.stringify({...report,abrupt:report.abrupt.length,hardThroughBraking:report.hardThroughBraking.length,sameLaneBarriers:report.sameLaneBarriers.length}));
   }return reports;
  },{seeds:(process.env.SEEDS||'1,2,3,7').split(',').map(Number),seconds:Number(process.env.SECONDS||120),temperature:process.env.TEMPERATURE==null?null:Number(process.env.TEMPERATURE)});
  fs.writeFileSync(process.env.REPORT||`/tmp/stripemaker-turn-gaps-${webkit?'webkit':'chromium'}.json`,JSON.stringify(reports,null,2));
  for(const report of reports){assert.equal(report.overlaps,0);assert.equal(report.abrupt.length,0,JSON.stringify(report.abrupt.slice(0,5)));assert.equal(report.hardThroughBraking.length,0,JSON.stringify(report.hardThroughBraking.slice(0,5)));assert.deepEqual(report.sameLaneBarriers,[]);assert(report.completed>10);}
  // A single selected seed may legitimately sample no low-weight major turn.
  // Require turn coverage across a multi-seed audit, not every random run.
  if(reports.length>1)assert(reports.reduce((sum,r)=>sum+r.turnsCompleted,0)>0,'actual major-to-minor turns occur across the seeded sample');
  assert.deepEqual(errors,[]);console.log(`PASS ${webkit?'WebKit':'Chromium'} major/minor turning-gap and hard-braking audit: ${reports.length} seeded runs.`);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
