/* Double turns followed by a second turn on a link too short to weave. */
const assert=require('node:assert/strict'),path=require('node:path'),{pathToFileURL}=require('node:url'),P=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{const webkit=process.env.BROWSER==='webkit',browser=await P[webkit?'webkit':'chromium'].launch({headless:true,executablePath:webkit?process.env.WEBKIT_PATH:process.env.CHROME_PATH});try{
 const page=await browser.newPage({viewport:{width:1400,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(pathToFileURL(path.resolve(__dirname,'../index.html')).href);await page.waitForFunction(()=>StripeMaker.sheets.ready);await page.locator('#blankSheet').evaluate(b=>b.click());await page.waitForFunction(()=>StripeMaker.sheets.selected);await page.clock.install();
 for(const turn of ['left','right'])for(const nextLane of [0,1]){
  const result=await page.evaluate(({turn,nextLane})=>{
   const A=StripeMaker,G=A.intersectionGeometry,s=A.sheets.selected,e=A.simulator.signalEngine();document.getElementById('pauseSimulation').click();e.reset();
   Object.assign(s,{inchesPerPixel:12,roads:[],joints:[],intersections:[],vehicleSpawns:[],gores:[],medians:[],bridges:[],markings:[],lines:[],surfaces:[],speedZones:[]});
   const first=G.create(),second=G.create();first.x=1500;first.y=800;
   const a=first.approaches[0],b=first.approaches[turn==='left'?1:3],u=G.axes(b).u;
   second.x=first.x+u.x*160;second.y=first.y+u.y*160;const c=second.approaches.find(p=>(p.angle+180)%360===b.angle),d=second.approaches.find(p=>(p.angle-c.angle+360)%360===(nextLane===0?90:270));
   a.incoming=b.outgoing=c.incoming=2;G.normalize(first);G.normalize(second);
   first.movements=[G.movement(a,0,b,0),G.movement(a,1,b,1)];second.movements=[G.movement(c,nextLane,d,0)];s.intersections=[first,second];
   const point=(i,a,incoming,lane=0)=>{const p=G.lane(a,incoming,lane);return {x:i.x+p.x,y:i.y+p.y};};
   function road(id,start,end,lanes,angle){const u=G.axes({angle}).u,r={id,lanes,laneWidth:12,ends:[]};for(const p of [start,end]){const j={id:s.joints.length+1,...p,dir:u,root:id,links:[]};s.joints.push(j);r.ends.push({joint:j.id,sign:1,length:null});}s.roads.push(r);A.roadEditor.alignLaneEnd(s,{road:id,e:0},0,start,angle);A.roadEditor.alignLaneEnd(s,{road:id,e:1},0,end,angle);return r;}
   const p=point(first,a,true),q=point(first,b,false),r=point(second,c,true),t=point(second,d,false),au=G.axes(a).u,du=G.axes(d).u;
   road(1,{x:p.x+au.x*600,y:p.y+au.y*600},p,2,(a.angle+180)%360);road(2,q,r,2,b.angle);road(3,t,{x:t.x+du.x*600,y:t.y+du.y*600},1,d.angle);
   a.links=a.inLanes.map((to,lane)=>({road:1,e:1,lane,to}));b.links=b.outLanes.map((to,lane)=>({road:2,e:0,lane,to}));c.links=c.inLanes.map((to,lane)=>({road:2,e:1,lane,to}));d.links=[{road:3,e:0,lane:0,to:d.outLanes[0]}];
   s.vehicleSpawns=[{road:1,rate:10,routes:[{percent:100,exit:{road:3,e:1}}]}];s.speedZones=s.roads.map(r=>({id:'zone'+r.id,road:r.id,from:0,to:1,mph:30}));A.roadEditor.render();A.showEditor('simulatorEditor');A.simulator.refreshOverlay();document.getElementById('playSimulation').click();
   const routes=e.sources.get('1:0')?.routes??[],probes=[];
   for(const lane of [0,1]){const route=routes.find(r=>r.key.startsWith('lane:'+lane+':'));if(!route){probes.push({lane,missing:true});continue;}
    // Put the actor in its current source lane 100 ft before the first turn.
    const graph=A.simulator.network(s),record=graph.laneRecords.get('r:1:'+lane),station=record.stations.at(-1)-100,pose=A.simulatorLaneChanges.sample(record,station),driver=A.simulatorDrivers.profile(()=>.5,0);
    const car={id:100+lane,source:'1:0',route,path:route.path,pathDistance:station,distance:station,...pose,driver,pixelsPerFoot:1,committed:new Set(),speed:1,decisionAt:0};
    const target=1-lane,points=route.replan({car,target,driver,cars:[],random:()=>.5,speed:e.speed}),planned=points&&A.simulatorVehicles.preparePath(points);
    probes.push({lane,target,plan:!!points,turns:planned?.movements.map(m=>({intersection:m.intersection,input:m.junction.input,output:m.junction.output})),changes:planned?.maneuvers.map(m=>({road:m.road,to:m.to}))});
   }
   return {turn,nextLane,probes,expectedInput:a.inLanes[nextLane],nextInput:c.inLanes[nextLane]};
  },{turn,nextLane});
  console.log(JSON.stringify(result));assert(result.probes.every(p=>!p.missing));const correct=result.probes.find(p=>p.lane===nextLane),wrong=result.probes.find(p=>p.lane!==nextLane);
  assert.equal(correct.plan,false,'do not leave the lane needed for the next turn');assert.equal(wrong.plan,true,'slow driver can prepare in the other double-turn lane');assert.equal(wrong.turns.length,2);assert.equal(wrong.turns[0].input,result.expectedInput);assert.equal(wrong.turns[1].input,result.nextInput);assert.deepEqual(wrong.changes,[{road:1,to:nextLane}]);
 }
 assert.deepEqual(errors,[]);console.log('PASS double left/right lane choices preserve the subsequent left/right turn.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
