/* Two-lane southwest entrance from StripeMaker-project.json; geometry only. */
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
  const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/simulator-two-lane-yield.json')));
  await page.evaluate(data=>{
   const A=StripeMaker,s=A.sheets.selected;StripeMaker.settings.set('simulationTemperature',data.settings.simulationTemperature);Object.assign(s,data.data);Object.assign(A.sheets.selected,{speedZones:A.sheets.selected.roads.map(road=>({id:'test-speed-'+road.id,road:road.id,from:0,to:1,mph:data.settings.simulationSpeed}))});
   s.view={x:120,y:100,scale:.65};A.sheets.zoomBy(1);A.roadEditor.render();A.showEditor('simulatorEditor');
   const advance=A.simulatorVehicles.Engine.prototype.advance;
   A.simulatorVehicles.Engine.prototype.advance=function(seconds){window.testEngine=this;return advance.call(this,seconds);};
  },fixture);
  await page.clock.install();await page.click('#playSimulation');
  const report=await page.evaluate(()=>{
   const A=StripeMaker,e=testEngine,C=A.simulatorCollisions,V=A.simulatorVehicles,B=A.simulatorDrivers;
   let seed=123;e.reset();e.random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};A.simulator.refreshOverlay();e.recoverStuck=()=>{};
   const routes=e.sources.get('2:0').routes;
   const actor=(id,route,d,speed,request)=>{const c={id,route,path:V.preparePath(route.path.points),pathDistance:d,speed,driver:{...B.BASELINE},entryRequestedAt:request,entryIntersection:route.path.movements[0].intersection};Object.assign(c,V.position(c.path,d));return c;};
   const head=(id,key)=>{const c=actor(id,routes.find(r=>r.key===key),0,0,0),m=c.path.movements[0];c.pathDistance=m.entry-C.width(C.sample(c,m.entry),e.pixelsPerFoot)*381/214/2-2*e.pixelsPerFoot/.3048;Object.assign(c,V.position(c.path,c.pathDistance));return c;};
   const left=head(1,'lane:0:6:0:1'),right=head(2,'lane:1:6:1:1');
   const remote=actor(3,e.sources.get('3:0').routes.find(r=>r.key==='lane:0:6:1:1'),0,e.speed,10);remote.reservation=true;
   const holds=C.reservations([left,right,remote],e.pixelsPerFoot,1.67*e.pixelsPerFoot/.3048,20,.73*e.pixelsPerFoot/.3048,e.speed);
   if(holds.has(left.id)||holds.has(right.id)||!left.reservation||!right.reservation)throw Error('Both clear approach lanes must proceed ahead of a safely revocable upstream permission. '+JSON.stringify([...holds]));
   const seen=new Set(),admitted=new Set(),born=[0,0],entered=[0,0],stops=new Map();let overlaps=0,maxRingStop=0,completed=0;
   for(let i=0;i<9600;i++){
    const before=new Set(e.cars.map(c=>c.id));e.advance(.05);const alive=new Set(e.cars.map(c=>c.id));completed += [...before].filter(id=>!alive.has(id)).length;
    const world=C.scene(e.cars,e.pixelsPerFoot);
    for(const c of e.cars){
     overlaps+=world.query(C.bounds(c,0,e.pixelsPerFoot)).filter(other=>other.id>c.id&&C.overlap(c,other,e.pixelsPerFoot)).length;
     if(c.source==='2:0'){const lane=Number(c.route.key.split(':')[1]);if(!seen.has(c.id)){seen.add(c.id);born[lane]++;}if(c.circulating&&!admitted.has(c.id)){admitted.add(c.id);entered[lane]++;}}
     if(c.circulating&&c.speed<.1){const since=stops.get(c.id)??e.time;stops.set(c.id,since);maxRingStop=Math.max(maxRingStop,e.time-since);}else stops.delete(c.id);
    }
    if(i%1200===1199)console.log(`STUCK-RUN seconds=${e.time.toFixed(0)} entries=${entered} ringStop=${maxRingStop.toFixed(2)} overlaps=${overlaps}`);
   }
   return {born,entered,maxRingStop,overlaps,completed,watchdog:e.watchdogRemovals,time:e.time};
  });
  console.log(JSON.stringify(report));assert.equal(report.overlaps,0);assert(report.maxRingStop<10,'no sustained circulation stalls');assert.equal(report.watchdog,0);
  assert(report.entered.every(count=>count>=25),'both approach lanes continue entering');assert(report.completed>100);
  await page.clock.runFor(20);await page.screenshot({path:'/tmp/stripemaker-two-lane-yield.png'});assert.deepEqual(errors,[]);
  console.log(`PASS ${webkit?'WebKit':'Chromium'} two-lane clear admission and 480 simulated seconds at saved 46.4 mph / temperature 38, watchdog disabled: ${JSON.stringify(report)}`);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
