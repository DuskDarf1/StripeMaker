/* Geometry-only regression from the user's linked-roundabout project. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
 try{
  const page=await browser.newPage({viewport:{width:1400,height:1000}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.STRIPEMAKER_URL||pathToFileURL(path.resolve(__dirname,'../index.html')).href);
  await page.click('button[aria-controls="sheetsMenu"]');await page.click('#blankSheet');
  await page.waitForFunction(()=>StripeMaker.sheets.selected);
  const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/simulator-linked-roundabouts.json')));
  const result=await page.evaluate(data=>{
   const app=StripeMaker,s=app.sheets.selected;Object.assign(s,data);s.width=30000;s.height=30000;s.blank=true;
   app.roadEditor.render();app.showEditor('simulatorEditor');
   const rb=s.intersections.find(i=>i.name==='Roundabout 1'),a=rb.approaches[0];
   const network=app.intersections.simulatorNetwork(s);
   const aligned=network.ports.find(p=>p.intersection===rb.id&&p.lane===a.inLanes[0]);
   const before=JSON.stringify(a.links);
   const speeds=[5,30,67.7].map(speed=>{
    Object.assign(app.sheets.selected,{speedZones:app.sheets.selected.roads.map(road=>({id:'test-speed-'+road.id,road:road.id,from:0,to:1,mph:speed}))});app.simulator.refreshOverlay();
    const g=app.simulator.network(s);
    const paths=Array.from({length:3},(_,lane)=>[...g.search({road:2,lane,e:0}).values()].map(p=>p.exit.road));
    const fromSouth=[...g.search({road:33,lane:0,e:0}).values()].map(p=>p.exit.road);
    return {speed,paths,fromSouth,exits:g.exits};
   });
   // Infer only through an existing attachment. A matching but unlinked road
   // is not permission to drive into this roundabout.
   a.links=a.links.filter(link=>link.road!==29);
   const detached=app.intersections.simulatorNetwork(s).ports.filter(p=>p.intersection===rb.id).flatMap(p=>p.ends);
   a.links=JSON.parse(before);
   // An occupied lane beside an approach must keep feeding its branch.
   s.roads.push({id:99,lanes:1,laneWidth:12,ends:[{joint:4,sign:1},{joint:999,sign:1}]});
   s.joints.push({id:999,x:4000,y:11000,root:99,links:[]});
   s.joints.find(j=>j.id===4).links.push({a:29,ai:0,b:99,bi:0});
   const occupied=app.intersections.simulatorNetwork(s).ports.filter(p=>p.intersection===rb.id).flatMap(p=>p.ends);
   s.roads.pop();s.joints.pop();s.joints.find(j=>j.id===4).links.pop();
   Object.assign(app.sheets.selected,{speedZones:app.sheets.selected.roads.map(road=>({id:'test-speed-'+road.id,road:road.id,from:0,to:1,mph:30}))});
   s.vehicleSpawns=[{road:2,rate:60,routes:[{exit:{road:34,e:1},percent:100}]}];
   s.view={scale:.05,x:0,y:-100};app.sheets.zoomBy(1);app.roadEditor.render();app.simulator.refreshOverlay();
   const g=app.simulator.network(s),p=[...g.search({road:2,lane:0,e:0}).values()].find(p=>p.exit.road===34);
   const diagram=g.displayPath(p);
   return {aligned,speeds,detached,occupied,unchanged:JSON.stringify(a.links)===before,
    diagram:{count:diagram.length,minX:Math.min(...diagram.map(p=>p.x)),maxY:Math.max(...diagram.map(p=>p.y)),length:diagram.slice(1).reduce((sum,p,i)=>sum+Math.hypot(p.x-diagram[i].x,p.y-diagram[i].y),0),chord:Math.hypot(diagram.at(-1).x-diagram[0].x,diagram.at(-1).y-diagram[0].y)}};
  },fixture);
  assert(result.aligned.ends.some(e=>e.road===29&&e.lane===0&&e.e===1),'the aligned inner lane connects despite only the outer lane storing an explicit link');
  assert(result.unchanged,'inferred lanes do not rewrite saved attachments');
  for(const test of result.speeds){
   assert(!test.exits.some(e=>e.road===29),'an attached road mouth is not a terminal exit');
   for(const paths of test.paths)for(const exit of [30,34,35])assert(paths.includes(exit),`road 2 reaches left-roundabout exit ${exit} at ${test.speed} mph`);
   for(const exit of [10,30,34,35])assert(test.fromSouth.includes(exit),`southern entrance reaches ${exit} at ${test.speed} mph`);
  }
  assert(!result.detached.some(e=>e.road===29),'unattached coincident pavement does not connect');
  assert(!result.occupied.some(e=>e.road===29&&e.lane===0),'branch occupancy excludes inferred links');
  assert(result.diagram.count>100&&result.diagram.length>result.diagram.chord*1.1,'arrow follows the winding roads and roundabout instead of an endpoint chord');
  const arrow=page.locator('.simulatorRoute').first();await arrow.waitFor();
  assert(await arrow.locator('path').first().getAttribute('d').then(d=>(d.match(/L/g)||[]).length>100));
  await page.screenshot({path:'/tmp/stripemaker-linked-roundabout-routes.png'});
  await page.clock.install();await page.click('#playSimulation');await page.clock.runFor(2000);
  const cars=await page.evaluate(()=>StripeMaker.simulator.diagnostics().cars);
  assert(cars.some(c=>c.distance>0));assert.equal(await page.locator('.simulatorRoute').count(),0);
  assert.deepEqual(errors,[]);
  console.log('PASS linked roundabouts: aligned lanes, no phantom exits, branch and attachment restrictions, 5/30/67.7 mph, road-following arrows and playback.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
