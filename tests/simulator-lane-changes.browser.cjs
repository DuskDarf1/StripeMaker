/* Production geometry + legal routing + actual vehicle playback. */
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
 try{
  const page=await browser.newPage({viewport:{width:1400,height:1000}}),errors=[];
  page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.STRIPEMAKER_URL||pathToFileURL(path.resolve(__dirname,'../index.html')).href);
  const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=1600;c.height=1200;return c.toDataURL().split(',')[1];});
  await page.locator('#sheetFile').setInputFiles({name:'Lane changes.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
  await page.waitForFunction(()=>StripeMaker.sheets.selected);
  await page.evaluate(()=>{
   window.installLaneChangeCase=(bike=false)=>{
    const app=StripeMaker,s=app.sheets.selected,target=bike?2:1;
    app.settings.set('simulationSpeed',5);app.settings.set('leftHandTraffic',false);
    Object.assign(s,{inchesPerPixel:2,roads:[
     {id:1,lanes:bike?3:2,laneWidth:12,laneTypes:bike?{1:{type:'bike',width:5}}:{},tapers:bike?{'0:2':{mode:'taper',length:90}}:{},ends:[{joint:1,sign:1},{joint:2,sign:1}]},
     {id:2,lanes:1,laneWidth:12,ends:[{joint:2,sign:1},{joint:3,sign:1}]},
     {id:3,lanes:1,laneWidth:12,ends:[{joint:2,sign:1},{joint:4,sign:1}]}],
     joints:[{id:1,x:650,y:600,dir:{x:1,y:0},root:1,links:[]},
      {id:2,x:1250,y:600,dir:{x:1,y:0},root:1,links:[{a:1,ai:target,b:2,bi:0},{a:1,ai:0,b:3,bi:0}]},
      {id:3,x:1550,y:900,dir:{x:1,y:0},root:2,links:[]},
      {id:4,x:1550,y:250,dir:{x:1,y:0},root:3,links:[]}],
     vehicleSpawns:[{road:1,rate:bike?600:1,laneShares:{0:100,[target]:0},routes:[
      {name:'Turn exit',percent:75,exit:{road:2,e:1}},
      {name:'Stay in lane',percent:25,exit:{road:3,e:1}}]}],
     intersections:[],gores:[],medians:[],markings:[],bridges:[],lines:[],surfaces:[],autoTapers:false});
    app.roadEditor.render();app.history.rebase();app.showEditor('simulatorEditor');
    const graph=app.simulator.network(s),paths=graph.search({road:1,lane:0,e:0});
    const required=paths.get('r:2:0'),straight=paths.get('r:3:0');
    return {required,straight,entrances:graph.entrances};
   };
  });
  let result=await page.evaluate(()=>installLaneChangeCase());
  assert(result.required,'upcoming turn is reachable from the wrong initial lane');
  assert.equal(result.required.laneChanges.length,1);assert.equal(result.straight.laneChanges.length,0);
  assert.equal(result.required.laneChanges[0].from,0);assert.equal(result.required.laneChanges[0].to,1);
  assert(result.required.laneChanges[0].duration>=6.28);
  // Percentage changes color both the route shaft and head, with white contrast.
  let colors=await page.locator('.simulatorRoute').evaluateAll(groups=>groups.map(g=>({share:Number(g.dataset.percent),color:g.dataset.color,strokes:[...g.querySelectorAll('path')].map(p=>p.getAttribute('stroke'))})));
  assert(colors.some(c=>c.share===75&&c.color==='hsl(30.0 80% 42%)'));
  assert(colors.some(c=>c.share===25&&c.color==='hsl(90.0 80% 42%)'));
  assert(colors.every(c=>c.strokes.filter(s=>s===c.color).length===2&&c.strokes.filter(s=>s==='#fff').length===2));
  const arrows=await page.locator('.simulatorRoute').evaluateAll(groups=>groups.map(g=>({opacity:g.getAttribute('opacity'),paths:[...g.querySelectorAll('path')].map(p=>({d:p.getAttribute('d'),width:p.getAttribute('stroke-width')}))})));
  assert(arrows.every(a=>a.opacity==='.55'||a.opacity==='0.55'));
  assert(arrows.every(a=>a.paths.some(p=>p.width==='2.5'&&(p.d.match(/L/g)||[]).length>2)),'thin arrows follow road geometry without lane-change weaving');
  await page.locator('.simulatorSpawn').click();
  await page.locator('.simulatorRouteRow [data-route-field=shareValue]').first().fill('20');
  await page.locator('.simulatorRouteRow [data-route-field=shareValue]').first().blur();
  colors=await page.locator('.simulatorRoute').evaluateAll(groups=>groups.map(g=>({share:Number(g.dataset.percent),color:g.dataset.color})));
  assert(colors.some(c=>c.share===20&&c.color==='hsl(96.0 80% 42%)'));
  assert(colors.some(c=>c.share===80&&c.color==='hsl(24.0 80% 42%)'));
  await page.locator('.simulatorRouteRow [data-route-field=shareValue]').first().fill('100');
  await page.locator('.simulatorRouteRow [data-route-field=shareValue]').first().blur();
  await page.clock.install();
  await page.evaluate(()=>{Math.random=()=>0;});
  const speed=5*5280/3600*6;
  await page.click('#playSimulation');
  const personal=await page.evaluate(()=>StripeMaker.simulator.diagnostics().cars[0].plan.changes[0]);
  await page.clock.runFor(Math.ceil((personal.start+personal.end)/2/speed*1000)+40);
  let state=await page.evaluate(()=>StripeMaker.simulator.diagnostics());
  const car=state.cars[0];assert(car&&car.laneChange,'a real car moves laterally in playback');
  assert.equal(car.laneChange.from,0);assert.equal(car.laneChange.to,1);assert(car.laneChange.progress>0&&car.laneChange.progress<1);
  assert(Math.abs(car.angle)>1,'car points along its changing path');
  assert.equal(await page.locator('.simulatorRoute').count(),0,'weighted arrows still hide while playing');
  await page.screenshot({path:'/tmp/stripemaker-lane-change.png'});
  await page.click('#pauseSimulation');const paused=await page.evaluate(()=>StripeMaker.simulator.diagnostics());
  await page.clock.runFor(2000);assert.deepEqual(await page.evaluate(()=>StripeMaker.simulator.diagnostics()),paused);
  await page.locator('#simulationSpeedValue').fill('0');await page.locator('#simulationSpeedValue').blur();
  const beforeStop=await page.evaluate(()=>StripeMaker.simulator.diagnostics());assert(beforeStop.cars.length>0,'zero speed retains the in-progress lane-changing car');
  await page.click('#playSimulation');await page.clock.runFor(1000);
  const stopped=await page.evaluate(()=>StripeMaker.simulator.diagnostics());
  assert.equal(stopped.cars[0].distance,beforeStop.cars[0].distance);await page.click('#pauseSimulation');
  // Production bike conflict geometry, not a synthetic permission flag.
  result=await page.evaluate(()=>installLaneChangeCase(true));
  assert(result.required,'a car can cross the keyhole bike lane to the turn lane');
  const bikeChange=result.required.laneChanges.find(c=>c.acrossBike);assert(bikeChange);assert.equal(bikeChange.to,2);
  assert(!result.entrances.some(ref=>ref.road===1&&ref.lane===1),'bicycle lane cannot spawn cars');
  const bikeIndex=result.required.points.findIndex(p=>p.maneuver?.acrossBike&&p.maneuver.progress>.48&&p.maneuver.progress<.52);
  assert(bikeIndex>0);
  await page.click('#playSimulation');await page.clock.runFor(300);
  const bikePersonal=await page.evaluate(()=>StripeMaker.simulator.diagnostics().cars[0].plan.changes[0]);
  await page.clock.runFor(Math.max(0,Math.ceil((bikePersonal.start+bikePersonal.end)/2/speed*1000)-200));
  state=await page.evaluate(()=>StripeMaker.simulator.diagnostics());
  assert(state.cars.some(car=>car.laneChange?.acrossBike),'actual cars cross the bicycle conflict section');
  await page.click('#pauseSimulation');
  // Replacing the ordinary lane with a separated two-way track closes the path.
  const blocked=await page.evaluate(()=>{
   const s=StripeMaker.sheets.selected;s.roads[0].laneTypes[1]={type:'twoWayBike',width:12};
   StripeMaker.roadEditor.render();
   return StripeMaker.simulator.network(s).search({road:1,lane:0,e:0}).has('r:2:0');
  });assert.equal(blocked,false,'two-way cycle tracks remain barriers');
  assert.deepEqual(errors,[]);
  console.log('PASS: route-aware lane changes, real keyhole crossings, track barriers, empirical timing, car playback, paused positions and weighted arrow colors.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
