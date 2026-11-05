/* Supplied allwaystop.json: continuous major demand, no watchdog recovery. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
const P=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const webkit=process.env.BROWSER==='webkit',executablePath=webkit?process.env.WEBKIT_PATH:process.env.CHROME_PATH;
 const browser=await P[webkit?'webkit':'chromium'].launch({headless:true,...(executablePath?{executablePath}:{})});
 const output=process.env.REPORT||'/tmp/stripemaker-all-way-stop.json';
 try{
  const page=await browser.newPage({viewport:{width:1400,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(pathToFileURL(path.resolve(__dirname,'../index.html')).href);await page.waitForFunction(()=>StripeMaker.sheets.ready);
  await page.locator('#blankSheet').evaluate(b=>b.click());await page.waitForFunction(()=>StripeMaker.sheets.selected);
  const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/simulator-all-way-stop.json')));
  await page.evaluate(({fixture,seed})=>{
   const A=StripeMaker,s=A.sheets.selected;Object.assign(s,fixture.data);for(const key of ['simulationTemperature','simulationPlaybackRate','simulationOverlays'])A.settings.set(key,fixture.settings[key]);
   s.view={x:120,y:100,scale:.65};A.sheets.zoomBy(1);A.roadEditor.render();A.history.rebase();A.showEditor('simulatorEditor');
   window.advance=A.simulatorVehicles.Engine.prototype.advance;A.simulatorVehicles.Engine.prototype.advance=function(){window.engine=this;};window.seed=seed;
  },{fixture,seed:Number(process.env.SEED||7)});
  const association=await page.evaluate(()=>{
   const A=StripeMaker,s=A.sheets.selected,road=s.markings.find(m=>m.on.road===11&&m.trafficControl),before=JSON.stringify(s.markings),resolve=sheet=>A.markings.simulatorControls(sheet).find(c=>c.marking===road.id);
   const original=resolve(s),setback=structuredClone(s.markings);setback.find(m=>m.id===road.id).back=20;
   const standalone=resolve({...s,markings:setback});setback.find(m=>m.id===road.id).trafficControl.intersection=s.intersections[0].id;
   const explicit=resolve({...s,markings:setback});
   const raised=resolve({...s,roads:s.roads.map(r=>r.id===11?{...r,level:2}:r)});
   const detached=resolve({...s,intersections:s.intersections.map(i=>({...i,approaches:i.approaches.map(a=>({...a,links:a.links.filter(l=>l.road!==11)}))}))});
   const moved=structuredClone(s.markings);moved.find(m=>m.id===road.id).placementTransform={angle:0,x:200,y:200};
   const transformed=resolve({...s,markings:moved});
   const ambiguous=resolve({...s,intersections:s.intersections.map(i=>({...i,approaches:[...i.approaches,...i.approaches.filter(a=>a.links.some(l=>l.road===11))]}))});
   const oneLane=structuredClone(s.markings);oneLane.find(m=>m.id===road.id).all=false;const partial=resolve({...s,markings:oneLane});
   return {id:road.id,original,standalone,explicit,raised,detached,transformed,ambiguous,partial,unchanged:JSON.stringify(s.markings)===before};
  });
  assert(association.original.inferred);assert.equal(association.original.controlledLanes.length,4);
  for(const key of ['standalone','raised','detached','transformed','ambiguous'])assert.equal(association[key].intersection,undefined,key+' must not borrow intersection priority');
  assert(association.explicit.intersection);assert(!association.explicit.inferred);assert(association.unchanged,'inference never rewrites saved controls');
  assert(association.partial.inferred);assert.equal(association.partial.controlledLanes.length,1,'one lane control never controls the whole approach');
  await page.locator(`[data-marking="${association.id}"].simulatorControl`).focus();await page.keyboard.press('Enter');
  assert.match(await page.locator('#simulatorControlHint').textContent(),/Automatically controls/);
  assert.match(await page.locator('#simulatorControlIntersection option').first().textContent(),/^Automatic:/);
  await page.locator('#simulatorControlHint').scrollIntoViewIfNeeded();await page.screenshot({path:output.replace(/\.json$/,'.png')});
  await page.click('#playSimulation');await page.waitForFunction(()=>window.engine);
  const setup=await page.evaluate(()=>{
   const A=StripeMaker,e=engine;e.reset();e.recoverStuck=()=>{};let state=seed;e.random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};A.simulator.refreshOverlay();
   window.report={seed,completed:{},stops:{},violations:0,overlaps:0,maxWait:{},windows:[]};window.departed=new Set();window.seenStops=new Set();
   return {controls:A.markings.simulatorControls(A.sheets.selected).map(c=>({id:c.id,intersection:c.intersection,approach:c.approach,lanes:c.controlledLanes})),sources:[...e.sources.values()].map(s=>({key:s.key,rate:s.rate,movements:s.routes.map(r=>r.path.movements.map(m=>({allWayStop:m.allWayStop,control:m.control?.id,entry:m.junction?.entry})))}))};
  });
  const seconds=Number(process.env.SECONDS||480);
  for(let t=0;t<seconds;t+=30){
   const progress=await page.evaluate(duration=>{
    const A=StripeMaker,e=engine,C=A.simulatorCollisions;
    for(let i=0;i<duration*30;i++){
     const before=new Map(e.cars.map(c=>[c.id,c]));advance.call(e,1/30);const alive=new Set(e.cars.map(c=>c.id));
     for(const [id,c]of before)if(!alive.has(id)){report.completed[c.source]=(report.completed[c.source]??0)+1;departed.add(id);}
     const w=C.scene(e.cars,e.pixelsPerFoot);
     for(const c of e.cars){const half=C.width(c,e.pixelsPerFoot)*381/214/2;
      report.overlaps+=w.query(C.bounds(c,0,e.pixelsPerFoot)).filter(o=>o.id>c.id&&C.overlap(c,o,e.pixelsPerFoot)).length;
      for(const bar of c.path.controls){
       if(bar.type!=='stop')continue;
       if(c.stops?.has(bar.marking)){const key=c.id+':'+bar.marking;if(!seenStops.has(key)){seenStops.add(key);report.stops[c.source]=(report.stops[c.source]??0)+1;}
        if(c.pathDistance+half<=bar.distance+.01*e.pixelsPerFoot)report.maxWait[c.source]=Math.max(report.maxWait[c.source]??0,e.time-c.stops.get(bar.marking));
       }
       if(c.pathDistance+half>bar.distance+.01*e.pixelsPerFoot&&!c.stops?.has(bar.marking))report.violations++;
      }
     }
    }
    const sample={time:e.time,completed:{...report.completed},cars:e.cars.length,waiting:e.cars.filter(c=>c.speed<.01).length};report.windows.push(sample);return sample;
   },Math.min(30,seconds-t));console.log(JSON.stringify(progress));
  }
  const report=await page.evaluate(()=>({...window.report,time:engine.time,interventions:engine.collisionInterventions,watchdog:engine.watchdogRemovals??0,
   final:engine.cars.map(c=>({id:c.id,source:c.source,speed:c.speed,road:c.road,lane:c.lane,situation:c.situation,stops:[...(c.stops??[])],reservation:c.reservation,committed:c.entryCommitted,
    movements:c.path.movements.map(m=>({allWayStop:m.allWayStop,control:m.control?.id,start:m.start,entry:m.entry,end:m.end})),pathDistance:c.pathDistance}))}));
  Object.assign(report,{setup,errors});fs.writeFileSync(output,JSON.stringify(report,null,2));console.log(JSON.stringify({completed:report.completed,maxWait:report.maxWait,violations:report.violations,overlaps:report.overlaps,interventions:report.interventions,output}));
  assert.deepEqual(errors,[]);
  if(process.env.RECORD!=='1'){
   assert(setup.sources.every(s=>s.movements.every(ms=>ms.every(m=>m.allWayStop))),'every approach participates in the all-way STOP');
   assert.equal(report.violations,0);assert.equal(report.overlaps,0);assert.equal(report.watchdog,0);
   for(const source of ['13:0','16:0'])assert((report.completed[source]??0)>=seconds/60,'each minor stream continues to complete trips under continuous major demand');
   assert(Object.values(report.maxWait).every(t=>t<30),'no served stop waits for watchdog recovery');
  }
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
