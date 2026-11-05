const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {pathToFileURL}=require('node:url'),P=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{const webkit=process.env.BROWSER==='webkit',browser=await P[webkit?'webkit':'chromium'].launch({headless:true,executablePath:webkit?process.env.WEBKIT_PATH:process.env.CHROME_PATH});try{
 const page=await browser.newPage({viewport:{width:1400,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.text().startsWith('UTURN progress'))console.log(m.text());});
 await page.goto(process.env.STRIPEMAKER_URL||pathToFileURL(path.resolve(__dirname,'../index.html')).href);await page.waitForFunction(()=>StripeMaker.sheets.ready);
 await page.click('button[aria-controls="sheetsMenu"]');await page.click('#blankSheet');await page.waitForFunction(()=>StripeMaker.sheets.selected);
 const fixture=require('./fixtures/simulator-minor-road-uturn.json');
 const topology=await page.evaluate(({f,mixed})=>{const A=StripeMaker,s=A.sheets.selected;Object.assign(s,f.data);A.settings.set('simulationTemperature',f.settings.simulationTemperature);A.roadEditor.render();
  const roads=A.roadEditor.simulatorNetwork(s),ints=A.intersections.simulatorNetwork(s),opts={speed:A.speedZones.planningSpeed(s)*5280/3600*12/s.inchesPerPixel,pixelsPerFoot:12/s.inchesPerPixel};
  const original=A.simulatorRouting.build(s,roads,ints,false,A.roadEditor.pairOf,{...opts,directEntries:false}),fixed=A.simulatorRouting.build(s,roads,ints,false,A.roadEditor.pairOf,opts);
  const source={road:25,lane:0,e:0},before=[...original.search(source).keys()],after=[...fixed.search(source).keys()];
  // The side road turns straight into the far lane; U-turn traffic keeps ordinary changes.
  const seq=p=>p.points.filter((q,i,a)=>q.road!=null&&(i===0||q.road!==a[i-1].road||q.lane!==a[i-1].lane)).map(q=>q.road+':'+q.lane);
  const routes=Object.fromEntries([...fixed.search(source)].map(([k,p])=>[k,seq(p)]));
  s.vehicleSpawns=[...(mixed?s.vehicleSpawns.filter(x=>x.road!==25):[]),{road:25,rate:3,rateUnit:'minutes',routes:[5,14,15,21].map(road=>({exit:{road,e:1},percent:25}))}];
  A.showEditor('simulatorEditor');const advance=A.simulatorVehicles.Engine.prototype.advance;A.simulatorVehicles.Engine.prototype.advance=function(seconds){window.testEngine=this;return advance.call(this,seconds);};
  return {before,after,routes};
 },{f:fixture,mixed:process.env.MIXED==='1'});
 assert(!topology.before.includes('r:5:0'));for(const key of ['r:5:0','r:14:0','r:15:0','r:21:0'])assert(topology.after.includes(key),key);
 await page.clock.install();await page.click('#playSimulation');
 const report=await page.evaluate(({seconds,failFast})=>{const A=StripeMaker,e=testEngine;e.recoverStuck=()=>{};e.reset();let seed=7;e.random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};A.simulator.refreshOverlay();
  const result={yieldsToUturn:0,mainlineMin:Infinity,sizes:new Set(),completed:{},uturnCars:[],crossings:{},overlaps:0,interventions:0,watchdog:0,stuck:[],plannedLimits:[]},seen=new Set(),crossings=new Map();
  for(let step=0;step<seconds*20;step++){
   if(step%1200===0)console.log('UTURN progress '+JSON.stringify({seconds:e.time,cars:e.cars.length,interventions:e.collisionInterventions??0}));
   if(failFast&&(e.collisionInterventions??0)>1000)break;
   const before=new Map(e.cars.map(c=>[c.id,c]));e.advance(.05);const alive=new Set(e.cars.map(c=>c.id));
   for(const [id,c] of before)if(!alive.has(id)&&c.source==='25:0'){const exit=c.route.key.split(':')[2];result.completed[exit]=(result.completed[exit]??0)+1;}
   for(const c of e.cars){if(c.situation?.reason==='yielding-entry'&&(c.road===1||c.road===24)&&c.source!=='25:0'){const L=e.cars.find(o=>o.id===c.situation.leader);if(L?.road===23){result.yieldsToUturn++;result.mainlineMin=Math.min(result.mainlineMin,c.speed/e.pixelsPerFoot);}}
    result.sizes.add(Math.round(A.simulatorCollisions.width?.(c,e.pixelsPerFoot)/e.pixelsPerFoot*1000));}
   for(const c of e.cars.filter(c=>c.source==='25:0')){
    if(c.road===23&&!seen.has(c.id)){seen.add(c.id);result.uturnCars.push(c.id);}
    if(c.path.maneuverLimits?.some(x=>Number.isFinite(x.limit))&&!result.plannedLimits.some(x=>x.id===c.id))result.plannedLimits.push({id:c.id,limits:c.path.maneuverLimits.filter(x=>Number.isFinite(x.limit)).map(x=>x.limit/e.pixelsPerFoot)});
    if(c.laneChange){const key=c.id+':'+c.laneChange.road+':'+c.laneChange.from+':'+c.laneChange.to;const record=crossings.get(key)??{start:e.time,duration:c.driver.duration,from:c.laneChange.from,to:c.laneChange.to,road:c.road,initialProgress:c.laneChange.progress,initialSpeed:c.speed/e.pixelsPerFoot,startStation:c.station/e.pixelsPerFoot};record.end=e.time;record.endProgress=c.laneChange.progress;record.endStation=c.station/e.pixelsPerFoot;record.lastSpeed=c.speed/e.pixelsPerFoot;record.limits=c.path.maneuverLimits;crossings.set(key,record);}
   }
   if(step%4===0){const C=A.simulatorCollisions,world=C.scene(e.cars,e.pixelsPerFoot);for(const c of e.cars)result.overlaps+=world.query(C.bounds(c,0,e.pixelsPerFoot)).filter(o=>o.id>c.id&&C.overlap(c,o,e.pixelsPerFoot)).length;}
  }
  result.collisions=e.cars.filter(c=>c.situation?.collision!=null||e.cars.some(o=>o.situation?.collision===c.id)).map(c=>({id:c.id,source:c.source,road:c.road,lane:c.lane,x:c.x,y:c.y,intersection:c.intersection,speed:c.speed,reason:c.situation,entryIntersection:c.entryIntersection,reservation:c.reservation,conflictLine:c.entryConflictLine,committed:c.entryCommitted,hold:c.entryHold,distance:c.pathDistance,movements:c.path.movements}));result.sizes=[...result.sizes];result.time=e.time;result.crossings=[...crossings.values()];result.interventions=e.collisionInterventions??0;result.watchdog=e.watchdogRemovals??0;result.stuck=e.cars.filter(c=>c.stoppedSeconds>30).map(c=>({id:c.id,road:c.road,lane:c.lane,station:c.station,reason:c.situation,route:c.route.key}));return result;
 },{seconds:Number(process.env.SECONDS||600),failFast:process.env.FAIL_FAST==='1'});
 fs.writeFileSync(process.env.REPORT||`/tmp/minor-road-uturn-${webkit?'webkit':'chromium'}.json`,JSON.stringify({topology,...report},null,2));
 for(const road of [5,14,15,21])assert(report.completed[road]>0,'completed route to road '+road);
 assert(report.uturnCars.length);
 // Out of the minor road the car turns directly into road 28's left lane.
 for(const key of ['r:5:0','r:14:0','r:15:0'])assert.equal(topology.routes[key][2],'28:0',key);
 assert.deepEqual(topology.routes['r:14:0'].filter(x=>x.startsWith('24:')),['24:0'],'U-turn traffic keeps ordinary lane changes');
 // Through traffic keeps priority over the U-turn's YIELD line: never stopped for it.
 assert(report.mainlineMin>15,'mainline slowed to '+report.mainlineMin+' ft/s for a U-turn car');
 // Cars keep a 12-ft-lane body on every lane width.
 if(report.sizes.every(Number.isFinite))assert(report.sizes.every(w=>w<=10000),'body widths '+report.sizes);
 assert.equal(report.overlaps,0);
 // Isolated route clearance needs no last-resort correction. In the original
 // dense flow, a transient numerical guard is diagnostic; a continuing guard
 // stall (the 30-second watchdog threshold, with recovery disabled) is a failure.
 if(process.env.MIXED==='1')assert(!report.stuck.some(c=>c.reason?.reason==='collision-avoidance'),'no sustained merge collision deadlock');
 else assert.equal(report.interventions,0);
 assert.equal(report.watchdog,0);assert.deepEqual(errors,[]);
 console.log(`PASS ${webkit?'WebKit':'Chromium'} minor-road routes: ${JSON.stringify(report.completed)}, ${report.uturnCars.length} U-turn vehicles, ${report.interventions} safety interventions, no overlaps or watchdog removals.`);
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
