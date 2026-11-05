/* Saved weaving experiment; retain demand, temperature, speed zones and exits. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {pathToFileURL}=require('node:url'),P=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const webkit=process.env.BROWSER==='webkit',executablePath=webkit?process.env.WEBKIT_PATH:process.env.CHROME_PATH;
 const browser=await P[webkit?'webkit':'chromium'].launch({headless:true,...(executablePath?{executablePath}:{})});
 const output=process.env.REPORT||'/tmp/stripemaker-weaving.json';
 try{
  const page=await browser.newPage({viewport:{width:1500,height:1000}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(pathToFileURL(path.resolve(__dirname,'../index.html')).href);
  await page.waitForFunction(()=>StripeMaker.sheets.ready);
  await page.locator('#blankSheet').evaluate(b=>b.click());
  await page.waitForFunction(()=>StripeMaker.sheets.selected);
  const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/simulator-weaving.json')));
  await page.evaluate(({fixture,seed,traceIds})=>{
   const A=StripeMaker,s=A.sheets.selected;Object.assign(s,fixture.data);
   for(const key of ['simulationTemperature','simulationPlaybackRate','simulationOverlays'])A.settings.set(key,fixture.settings[key]);
   s.view={x:400,y:100-5000*.065,scale:.065,fitted:false};A.sheets.zoomBy(1);A.roadEditor.render();A.showEditor('simulatorEditor');
   const E=A.simulatorVehicles.Engine,advance=E.prototype.advance;
   window.originalAdvance=advance;window.manual=true;
   E.prototype.advance=function(seconds){window.testEngine=this;if(!manual)return advance.call(this,seconds);};
   window.initialize=()=>{
    const e=testEngine;e.reset();e.nextId=1;e.recoverStuck=()=>{};let state=seed;
    e.random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
    A.simulator.refreshOverlay();
    if(e.sources.size!==2)throw new Error('Expected both saved weaving entrances');
    const route=e.sources.get('9:0').routes.find(r=>r.key==='lane:3:12:3:1');
    if(!route)throw new Error('Missing saved mainline route');
    const first=route.path.points.findIndex(p=>p.road===11&&p.lane===3),distance=route.path.lengths[first];
    const driver={...A.simulatorDrivers.profile(()=>.5,0),duration:3.4};
    const car={id:-1,route,path:route.path,pathDistance:distance,distance,speed:e.speed,driver,committed:new Set(),...A.simulatorVehicles.position(route.path,distance),...route.path.points[first]};
    const options={car,driver,cars:[],random:()=>.5,speed:e.speed};
    if(route.replan({...options,target:4})!==null)throw new Error('Discretionary passing must not enter the exit-only lane and require a return weave');
    if(!route.replan({...options,target:2}))throw new Error('Passing into an available through lane must remain possible');
    window.report={seed,temperature:e.temperature,completed:0,bySource:{},stoppedSeconds:0,slowSeconds:0,maxStopped:0,overlaps:0,interventions:0,windows:[],events:[],samples:[],trace:[]};window.traceIds=traceIds;
    window.seen=new Set();window.stops=new Map();window.samples=new Set();
    window.pose=c=>({id:c.id,source:c.source,road:c.road,lane:c.lane,station:c.station/e.pixelsPerFoot,mph:c.speed/e.pixelsPerFoot/1.4666666667,target:c.desiredSpeed/e.pixelsPerFoot/1.4666666667,change:c.laneChange,situation:c.situation,profile:c.driver,
     merge:c.mergeContext&&{road:c.mergeContext.road,from:c.mergeContext.from,to:c.mergeContext.to,remaining:c.mergeContext.remaining/e.pixelsPerFoot},
     pending:c.path.maneuvers.filter(m=>m.end>c.pathDistance&&!c.committed.has(m)).map(m=>({...m,remaining:(m.start-c.pathDistance)/e.pixelsPerFoot}))});
    const step=e.driverStep;
    e.driverStep=function(dt){
     const old=new Map(this.cars.map(c=>[c.id,{car:c,speed:c.speed}]));step.call(this,dt);
     const alive=new Set(this.cars.map(c=>c.id));
     for(const [id,{car}]of old)if(!alive.has(id)){report.completed++;report.bySource[car.source]=(report.bySource[car.source]??0)+1;stops.delete(id);}
     for(const c of this.cars){
      const mph=c.speed/this.pixelsPerFoot/1.4666666667;
      if(mph<5)report.slowSeconds+=dt;
      if(mph<.01){report.stoppedSeconds+=dt;stops.set(c.id,(stops.get(c.id)??0)+dt);report.maxStopped=Math.max(report.maxStopped,stops.get(c.id));}else stops.delete(c.id);
      if(old.get(c.id)?.speed/this.pixelsPerFoot/1.4666666667>5&&mph<.01&&report.events.length<40)
       report.events.push({time:this.time,car:pose(c),other:pose(this.cars.find(o=>o.id===c.situation?.collision)||this.cars.find(o=>o.id===c.situation?.leader)||c)});
     }
    };
   };
  },{fixture,seed:Number(process.env.SEED||7),traceIds:(process.env.TRACE_IDS||'').split(',').map(Number)});
  await page.click('#playSimulation');await page.waitForFunction(()=>window.testEngine);await page.evaluate(()=>initialize());
  const seconds=Number(process.env.SECONDS||1500),start=performance.now();
  for(let t=0;t<seconds;t+=10){
   const progress=await page.evaluate(duration=>{
    const e=testEngine,A=StripeMaker,C=A.simulatorCollisions;
    for(let i=0;i<duration;i++){
     originalAdvance.call(e,1);
     for(const c of e.cars)if(traceIds.includes(c.id)){const m=c.path.maneuvers.find(m=>m.end>c.pathDistance&&!c.committed.has(m)),n=m&&A.simulatorDrivers.safe({...c,road:m.road,lane:m.from,station:c.road===m.road?c.station:m.station},e.cars,m.to,e.speed*(c.driver.speedFactor??1),e.pixelsPerFoot);report.trace.push({time:e.time,...pose(c),gap:n&&{allowed:n.allowed,front:n.neighbors.front&&pose(n.neighbors.front.car),rear:n.neighbors.rear&&pose(n.neighbors.rear.car),frontGap:n.frontGap/e.pixelsPerFoot,rearGap:n.rearGap/e.pixelsPerFoot,own:n.own/e.pixelsPerFoot*.3048,follower:n.follower/e.pixelsPerFoot*.3048}});}
     const w=C.scene(e.cars,e.pixelsPerFoot);for(const c of e.cars)report.overlaps+=w.query(C.bounds(c,0,e.pixelsPerFoot)).filter(o=>o.id>c.id&&C.overlap(c,o,e.pixelsPerFoot)).length;
     for(const c of e.cars)if(c.speed/e.pixelsPerFoot/1.4666666667<5&&!samples.has(c.id)&&report.samples.length<60){samples.add(c.id);report.samples.push({time:e.time,car:pose(c),leader:e.cars.find(o=>o.id===c.situation?.leader)&&pose(e.cars.find(o=>o.id===c.situation.leader))});}
    }
    const window={time:e.time,completed:report.completed,cars:e.cars.length,slow:e.cars.filter(c=>c.speed/e.pixelsPerFoot/1.4666666667<5).length,stopped:e.cars.filter(c=>c.speed<.01).length,pending:[...e.sources.values()].reduce((n,s)=>n+s.pending,0),reasons:e.cars.reduce((o,c)=>(o[c.situation?.reason]=(o[c.situation?.reason]??0)+1,o),{})};
    report.windows.push(window);report.interventions=e.collisionInterventions;return window;
   },Math.min(10,seconds-t));
   if(t%60===0)console.log(JSON.stringify(progress));
   if(process.env.STOP_AT_STALL==='1'&&progress.stopped>0&&t>100)break;
  }
  const liveMs=Number(process.env.LIVE_MS||0);
  if(liveMs){
   await page.evaluate(()=>{window.frames=[];window.lastFrame=null;window.liveStart={wall:performance.now(),time:testEngine.time};window.manual=false;
    const frame=now=>{if(lastFrame!=null)frames.push(now-lastFrame);lastFrame=now;if(!manual)requestAnimationFrame(frame);};requestAnimationFrame(frame);
   });
   for(let elapsed=0;elapsed<liveMs;elapsed+=10000){
    await page.waitForTimeout(Math.min(10000,liveMs-elapsed));
    console.log('LIVE '+JSON.stringify(await page.evaluate(()=>{
     const e=testEngine,C=StripeMaker.simulatorCollisions,w=C.scene(e.cars,e.pixelsPerFoot);
     for(const c of e.cars)report.overlaps+=w.query(C.bounds(c,0,e.pixelsPerFoot)).filter(o=>o.id>c.id&&C.overlap(c,o,e.pixelsPerFoot)).length;
     const window={time:e.time,cars:e.cars.length,completed:report.completed,slow:e.cars.filter(c=>c.speed/e.pixelsPerFoot/1.4666666667<5).length};report.windows.push(window);return window;
    })));
   }
   await page.evaluate(()=>{manual=true;const sorted=frames.slice().sort((a,b)=>a-b);report.live={wallSeconds:(performance.now()-liveStart.wall)/1000,simulationSeconds:testEngine.time-liveStart.time,frameP95ms:sorted[Math.floor(sorted.length*.95)],frameMaxms:sorted.at(-1)};});
  }
  const report=await page.evaluate(()=>({...window.report,interventions:testEngine.collisionInterventions,time:testEngine.time,final:testEngine.cars.map(pose)}));
  if(process.env.DEBUG==='1')fs.writeFileSync(output.replace(/\.json$/,'.cars.json'),await page.evaluate(()=>JSON.stringify(testEngine.cars)));
  report.wallSeconds=(performance.now()-start)/1000;report.errors=errors;
  fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');await page.screenshot({path:output.replace(/\.json$/,'.png')});
  console.log(JSON.stringify({completed:report.completed,bySource:report.bySource,stoppedSeconds:report.stoppedSeconds,slowSeconds:report.slowSeconds,maxStopped:report.maxStopped,overlaps:report.overlaps,interventions:report.interventions,wallSeconds:report.wallSeconds,output}));
  assert.deepEqual(errors,[]);
  if(process.env.RECORD!=='1'){
   assert.equal(report.overlaps,0);assert.equal(report.interventions,0);assert(report.completed>report.time*.5,'sustained throughput');
   // Demand is deliberately concentrated in one mainline lane. A temporary
   // queue may stop; no individual stop should reach the user's 30-second
   // watchdog threshold, and both streams must continue completing trips.
   assert(report.maxStopped<30,'no stop reaches watchdog recovery duration');
   for(const source of ['9:0','10:0'])assert(report.bySource[source]>report.time*.1,source+' keeps completing trips');
   for(let i=0;i<report.windows.length;i++){
    const start=report.windows[i],end=report.windows.find(w=>w.time>=start.time+60-1e-6);
    if(end&&start.time>60)assert(end.completed>start.completed,'no minute without departures');
   }
  }
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
