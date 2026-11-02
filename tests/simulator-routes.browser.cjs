/* Real road/intersection/roundabout geometry, isolated Chromium. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
 try {
  const page=await browser.newPage({viewport:{width:1400,height:1000}}), errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.STRIPEMAKER_URL || pathToFileURL(path.resolve(__dirname,'../index.html')).href);
  const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=1600;c.height=1200;return c.toDataURL().split(',')[1];});
  await page.locator('#sheetFile').setInputFiles({name:'Routing test.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
  await page.waitForFunction(()=>StripeMaker.sheets.selected);
  // Install external roads through the same alignment and explicit-link APIs
  // used by the editor, with one road per direction of every approach.
  await page.evaluate(()=>{
   window.installSimulatorCase=(fixture=null)=>{
    const app=StripeMaker,s=app.sheets.selected,G=app.intersectionGeometry,R=app.roundaboutGeometry;
    app.settings.set('leftHandTraffic',false);
    Object.assign(s,{inchesPerPixel:12,roads:[],joints:[],intersections:[],vehicleSpawns:[],gores:[],medians:[],bridges:[],markings:[],lines:[],surfaces:[]});
    const item=fixture??G.create();item.x=800;item.y=600;
    (item.kind==='roundabout'?R:G).normalize(item);s.intersections=[item];
    let id=0;const refs=[];
    for(const a of item.approaches) {
     delete a.binding;a.links=[];
     for(const incoming of [true,false]) {
      const ids=incoming?a.inLanes:a.outLanes;if(!ids.length)continue;
      const e=incoming?1:0,frame=item.kind==='roundabout'?R.approachLane(item,a,incoming,0):{p:G.lane(a,incoming,0),u:G.axes(a).u,angle:a.angle};
      const mouth={x:item.x+frame.p.x,y:item.y+frame.p.y};
      const far={x:mouth.x+frame.u.x*200,y:mouth.y+frame.u.y*200};
      const road={id:++id,lanes:ids.length,laneWidth:incoming?a.width:a.outWidth??a.width,ends:[]};
      for(const p of incoming?[far,mouth]:[mouth,far]) {
       const joint={id:s.joints.length+1,x:p.x,y:p.y,dir:{x:frame.u.x*(incoming?-1:1),y:frame.u.y*(incoming?-1:1)},root:road.id,links:[]};s.joints.push(joint);road.ends.push({joint:joint.id,sign:1,length:null});
      }
      s.roads.push(road);app.roadEditor.alignLaneEnd(s,{road:road.id,e},0,mouth,frame.angle);
      ids.forEach((to,lane)=>a.links.push({road:road.id,e,lane,to}));refs.push({approach:a.id,incoming,road:road.id});
     }
    }
    app.roadEditor.render();app.history.rebase();app.showEditor('simulatorEditor');
    return refs;
   };
  });
  const refs=await page.evaluate(()=>{
   const refs=installSimulatorCase(),s=StripeMaker.sheets.selected,G=StripeMaker.intersectionGeometry;
   const [a,b,c]=s.intersections[0].approaches;
   s.intersections[0].movements=[G.movement(a,0,b,0)];
   s.vehicleSpawns=[{road:refs.find(r=>r.approach===a.id&&r.incoming).road}];
   StripeMaker.roadEditor.render();StripeMaker.history.rebase();
   return {source:refs.find(r=>r.approach===a.id&&r.incoming).road,allowed:refs.find(r=>r.approach===b.id&&!r.incoming).road,forbidden:refs.find(r=>r.approach===c.id&&!r.incoming).road};
  });
  const screen=async(road,lane,e)=>page.evaluate(({road,lane,e})=>{
   const s=StripeMaker.sheets.selected,r=s.roads.find(r=>r.id===road),p=StripeMaker.roadEditor.lanePoint(s,r,e,lane,StripeMaker.roadEditor.solve(s));
   const q=StripeMaker.sheets.toScreen(p),b=document.getElementById('previewStage').getBoundingClientRect();return {x:q.x+b.left,y:q.y+b.top};
  },{road,lane,e});
  const drag=async(source,exit)=>{const a=await screen(source,0,0),b=await screen(exit,0,1);await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:8});await page.mouse.up();};
  await drag(refs.source,refs.allowed);
  assert.equal(await page.locator('.simulatorRoute').count(),1,'valid drag creates a visible route');
  const saved=()=>page.evaluate(()=>StripeMaker.sheets.selected.vehicleSpawns);
  assert.equal((await saved())[0].routes[0].exit.road,refs.allowed);
  assert.equal(await page.locator('.simulatorRoute path[stroke^="hsl("]').count(),2,'weighted-color shaft and arrowhead');
  assert.equal(await page.locator('.simulatorRoute path[stroke="#fff"]').count(),2,'white outlined shaft and arrowhead');
  await drag(refs.source,refs.forbidden);
  assert.equal((await saved())[0].routes[0].exit.road,refs.allowed,'forbidden drop preserves the existing valid route');
  assert.match(await page.locator('#simulatorStatus').textContent(),/No permitted/);
  await page.click('#undoButton');assert.equal(await page.locator('.simulatorRoute').count(),0);
  await page.click('#redoButton');assert.equal(await page.locator('.simulatorRoute').count(),1);
  await page.evaluate(()=>{StripeMaker.sheets.selected.intersections[0].movements=[];StripeMaker.roadEditor.render();});
  assert.equal(await page.locator('.simulatorRoute').count(),0,'restriction edits invalidate saved routes immediately');
  await page.evaluate(()=>{const s=StripeMaker.sheets.selected,x=s.intersections[0];x.movements=[StripeMaker.intersectionGeometry.movement(x.approaches[0],0,x.approaches[1],0)];StripeMaker.roadEditor.render();});
  assert.equal(await page.locator('.simulatorRoute').count(),1);
  // Keyboard selection and removal; undo restores both source and route.
  await page.locator('.simulatorRouteHit').focus();await page.keyboard.press('Enter');await page.keyboard.press('Delete');
  assert.equal(await page.locator('.simulatorRoute').count(),0);assert.equal(await page.locator('.simulatorSpawn').count(),1);
  await page.click('#undoButton');assert.equal(await page.locator('.simulatorRoute').count(),1);
  await page.locator('.simulatorSpawn').focus();await page.keyboard.press('Enter');
  assert.equal(await page.locator('.simulatorExit').count(),1,'keyboard offers only the permitted exit');
  await page.keyboard.press('Enter');assert.equal(await page.locator('.simulatorRoute').count(),1);
  await page.locator('.simulatorSpawn').click();await page.click('#removeVehicleSpawnPoint');
  assert.equal(await page.locator('.simulatorSpawn').count(),0);assert.equal(await page.locator('.simulatorRoute').count(),0);
  await page.click('#undoButton');assert.equal(await page.locator('.simulatorRoute').count(),1);
  await page.waitForTimeout(1000);await page.reload();await page.waitForFunction(()=>StripeMaker.sheets.selected);
  await page.evaluate(()=>StripeMaker.showEditor('simulatorEditor'));
  assert.equal(await page.locator('.simulatorRoute').count(),1,'routes persist across reload');
  await page.screenshot({path:'/tmp/stripemaker-simulator-routes.png'});
  // Reload removes the test helper; reinstall its exact function in this page.
  // Use a new page-independent function saved below for geometry cases.
  await page.close();
  const geometry=await browser.newPage({viewport:{width:1400,height:1000}});
  geometry.on('pageerror',e=>errors.push(e.message));
  await geometry.goto(process.env.STRIPEMAKER_URL || pathToFileURL(path.resolve(__dirname,'../index.html')).href);
  await geometry.locator('#sheetFile').setInputFiles({name:'Geometry routing.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
  await geometry.waitForFunction(()=>StripeMaker.sheets.selected);
  const joined=await geometry.evaluate(()=>{
   const app=StripeMaker,s=app.sheets.selected;
   Object.assign(s,{inchesPerPixel:2,intersections:[],vehicleSpawns:[],roads:[
    {id:1,lanes:3,laneWidth:12,ends:[{joint:1,sign:1},{joint:2,sign:1}]},
    {id:2,lanes:3,laneWidth:12,ends:[{joint:2,sign:1},{joint:3,sign:1}]},
    {id:3,lanes:1,laneWidth:12,ends:[{joint:2,sign:1},{joint:4,sign:1}]},
    {id:4,lanes:1,laneWidth:12,ends:[{joint:5,sign:1},{joint:6,sign:1}]}],
    joints:[{id:1,x:300,y:650,dir:{x:1,y:0},root:1,links:[]},
    {id:2,x:700,y:650,dir:{x:1,y:0},root:1,links:[{a:1,ai:0,b:2,bi:0},{a:1,ai:2,b:3,bi:0}]},
    {id:3,x:1100,y:650,dir:{x:1,y:0},root:2,links:[]},
    {id:4,x:1100,y:1000,dir:{x:1,y:0},root:3,links:[]},
    {id:5,x:500,y:300,dir:{x:0,y:1},root:4,links:[]},
    {id:6,x:500,y:1000,dir:{x:0,y:1},root:4,links:[]}]});
   const graph=app.simulator.network(s);
   const forward=[0,1,2].map(lane=>[...graph.search({road:1,lane,e:0}).keys()].sort());
   app.settings.set('leftHandTraffic',true);
   const reversed=[...app.simulator.network(s).search({road:2,lane:1,e:1}).keys()];
   app.settings.set('leftHandTraffic',false);
   s.roads[0].laneTypes={1:{type:'bike',width:5}};s.roads[1].laneTypes={1:{type:'bike',width:5}};
   const bike=app.simulator.network(s).entrances.filter(ref=>ref.road===1).map(ref=>ref.lane);
   return {forward,reversed,bike};
  });
  assert.deepEqual(joined.forward,[['r:2:0'],['r:2:1'],['r:2:2','r:3:0']],'implicit parallel lanes and explicit branch preserve their lane routes; crossing stays disconnected');
  assert.deepEqual(joined.reversed,['r:1:1'],'reversed traffic follows only reversed legal lane links');
  assert.deepEqual(joined.bike,[0,2],'vehicle routes exclude bicycle lanes');
  // Feed real roundabout movement geometry directly into the production graph
  // with explicit road-to-mouth links. No synthetic turn geometry is used.
  const cases=[null,'mini','roundabout-two-lane-exit.json','roundabout-double-left-spiral.json','roundabout-mixed-spiral.json','roundabout-sarasota.json'];
  for(const filename of cases) {
   const fixture=filename&&filename!=='mini'?JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures',filename),'utf8')):filename==='mini'?'mini':null;
   const result=await geometry.evaluate(fixture=>{
    const app=StripeMaker,s=app.sheets.selected,R=app.roundaboutGeometry,G=app.intersectionGeometry;
    const item=fixture&&fixture!=='mini'?fixture:R.create();
    if(fixture==='mini') {item.roundabout.mini=true;item.roundabout.icd=75;for(const a of item.approaches){a.median=0;Object.assign(a,G.mul(G.axes(a).u,R.requiredReach(item,a)));}}
    R.normalize(item);item.x=800;item.y=600;
    Object.assign(s,{inchesPerPixel:12,roads:[],joints:[],intersections:[item],vehicleSpawns:[]});
    let id=0;const sourceByLane=new Map(),exitByLane=new Map();
    for(const a of item.approaches) {
     delete a.binding;a.links=[];
     for(const incoming of [true,false]) {
      const ids=incoming?a.inLanes:a.outLanes;
      for(let lane=0;lane<ids.length;lane++) {
       const e=incoming?1:0,p=R.approachLane(item,a,incoming,lane),mouth={x:item.x+p.p.x,y:item.y+p.p.y};
       const far={x:mouth.x+p.u.x*200,y:mouth.y+p.u.y*200};
       const road={id:++id,lanes:1,laneWidth:12,ends:[]};
       for(const point of incoming?[far,mouth]:[mouth,far]) {const j={id:s.joints.length+1,...point,dir:{x:p.u.x*(incoming?-1:1),y:p.u.y*(incoming?-1:1)},root:road.id,links:[]};s.joints.push(j);road.ends.push({joint:j.id,sign:1,length:null});}
       s.roads.push(road);app.roadEditor.alignLaneEnd(s,{road:road.id,e},0,mouth,p.angle);
       a.links.push({road:road.id,lane:0,e,to:ids[lane]});
       (incoming?sourceByLane:exitByLane).set(ids[lane],{road:road.id,lane:0,e:incoming?0:1,approach:a.id});
      }
     }
    }
    const graph=app.simulator.network(s),transitions=app.intersections.simulatorNetwork(s);
    const failures=[];let reachable=0;
    for(const a of item.approaches)for(const input of a.inLanes) {
     const source=sourceByLane.get(input),paths=graph.search(source),allowed=R.destinations(item,a,input);
     for(const route of paths.values()) {
      reachable++;
      const exit=[...exitByLane.values()].find(ref=>ref.road===route.exit.road);
      if(!allowed.includes(exit.approach))failures.push('forbidden destination');
      if(route.points.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)))failures.push('nonfinite geometry');
      const path=transitions.movements.find(m=>m.input===input&&exitByLane.get(m.output)?.road===exit.road);
      if(!path)failures.push('wrong exit lane');
     }
     for(const destination of allowed) if(![...paths.values()].some(route=>[...exitByLane.values()].some(ref=>ref.road===route.exit.road&&ref.approach===destination)))failures.push('missing permitted destination');
    }
    // Restrict every entry lane: old/default destinations must not leak back.
    for(const a of item.approaches)for(const input of a.inLanes)a.dest[input]=[];
    const restricted=app.simulator.network(s);
    const forbiddenCount=[...sourceByLane.values()].reduce((n,source)=>n+restricted.search(source).size,0);
    return {failures,reachable,forbiddenCount,movements:transitions.movements.length};
   },fixture);
   assert.deepEqual(result.failures,[],filename??'default roundabout');
   assert(result.reachable>0,`${filename}: roundabout routes exist`);
   assert.equal(result.forbiddenCount,0,'explicitly empty roundabout destinations forbid all exits');
   console.log(`${filename??'default roundabout'}: ${result.reachable} permitted lane routes passed`);
  }
  assert.deepEqual(errors,[]);console.log('Simulator drag, forbidden turns, route/spawn removal, keyboard, undo/redo, persistence and roundabout regressions passed.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
