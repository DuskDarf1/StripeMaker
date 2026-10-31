const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
 const browser = await chromium.launch({headless:true, ...(process.env.CHROME_PATH ? {executablePath:process.env.CHROME_PATH}: {})});
 try {
 const page = await browser.newPage({viewport:{width:1400,height:1000}}), errors=[];
 page.on('pageerror', e=>{errors.push(e.message);console.error(e.stack);});
 // Instrument only the test response to inspect the production conflict ranges.
 await page.route('**/js/elements.js', async route=>{
   const response=await route.fetch();
   const body=(await response.text()).replace('window.StripeMaker.roadEditor = { render,',
     `window.StripeMaker.roadEditor = { auditRoutes: s => {const solved=solve(s);return bikeTransitions(s,solved).map(t=>{
       const left=boundary(t.shape,t.lane),right=boundary(t.shape,t.lane+1);
       const centers=left.map((p,i)=>({x:(p.x+right[i].x)/2,y:(p.y+right[i].y)/2}));
       const physical=shapeOf(s,t.road,solved),polygon=[...boundary(physical,0),...boundary(physical,t.road.lanes).reverse()];
       const end=centers[t.entering?0:centers.length-1];
       const target=lanePoint(s,t.entering?t.from:t.to,t.entering?1:0,t.entering?t.fromLane:t.toLane,solved);
       const other=t.entering?t.from:t.to,otherLane=t.entering?t.fromLane:t.toLane,otherShape=shapeOf(s,other,solved);
       const mismatches=[0,1].map(side=>{
        const p=boundary(t.shape,t.lane+side)[t.entering?0:left.length-1];
        const q=boundary(otherShape,otherLane+side)[t.entering?otherShape.line.length-1:0];
        return Math.hypot(p.x-q.x,p.y-q.y);
       });
       const p=boundary(t.shape,t.lane,inchesToPixels(s,BIKE_BUFFER_INCHES))[t.entering?0:left.length-1];
       const q=boundary(otherShape,otherLane,inchesToPixels(s,BIKE_BUFFER_INCHES))[t.entering?otherShape.line.length-1:0];
       return {solidTargets:[boundary(otherShape,otherLane)[t.entering?otherShape.line.length-1:0],q],meets:Math.max(...mismatches,Math.hypot(p.x-q.x,p.y-q.y),Math.hypot(end.x-target.x,end.y-target.y)),onPavement:centers.slice(1,-1).every(p=>insidePolygon(p,polygon))};
     });}, auditConflicts: (s,r) => [...bikeConflicts(s,r,shapeOf(s,r,solve(s)),solve(s))], render,`);
   await route.fulfill({response,body});
 });
 await page.goto(process.env.STRIPEMAKER_URL || 'http://127.0.0.1:8876/');
 await page.click('button[aria-controls="sheetsMenu"]'); await page.click('#blankSheet');
 await page.waitForFunction(()=>StripeMaker.sheets.selected);
 for (const scenario of ['entry','exit']) for (const layout of ['auto','drop','freeflow']) for (const feed of [false,true]) for (const reverse of [false,true]) for (const type of ['bike','bufferedBike']) {
 const result = await page.evaluate(({feed,reverse,type,layout,scenario})=>{
 const s=StripeMaker.sheets.selected;
    s.roads = [
      { id: 1, lanes: 4, laneWidth: 12, laneTypes: { 3: { type: 'bufferedBike', width: 7 } }, ends: [{ joint: 1, sign: 1, length: null }, { joint: 2, sign: 1, length: null }] },
      { id: 2, lanes: 3, laneWidth: 12, laneTypes: { 2: { type: 'bufferedBike', width: 7 } }, ends: [{ joint: 2, sign: 1, length: null }, { joint: 3, sign: 1, length: null }] },
      { id: 3, lanes: 1, laneWidth: 12, ends: [{ joint: 2, sign: 1, length: 300 }, { joint: 4, sign: 1, length: null }] }];
    s.joints = [{ id: 1, x: 15000, y: 16000, dir: { x: 0, y: -1 }, root: 1, links: [] },
      { id: 2, x: 15000, y: 15000, dir: { x: 0, y: -1 }, root: 1, links: [{ a: 1, ai: 0, b: 2, bi: 0 }, { a: 1, ai: 1, b: 2, bi: 1 }, { a: 1, ai: 2, b: 2, bi: 2 }, { a: 1, ai: 2, b: 3, bi: 0 }] },
      { id: 3, x: 14960, y: 13000, dir: { x: 0, y: -1 }, root: 2, links: [] }, { id: 4, x: 16500, y: 13500, dir: { x: 0.7, y: -0.7 }, root: 3, links: [] }];

 if(scenario==='entry') {
   s.roads[0].lanes=3;s.roads[0].laneTypes={2:{type:'bufferedBike',width:7}};
   s.roads[1].lanes=4;s.roads[1].laneTypes={3:{type:'bufferedBike',width:7}};
   s.roads[2].ends=[{joint:4,sign:1,length:null},{joint:2,sign:1,length:300}];
   s.joints[3].y=16500;s.joints[3].dir={x:-.7,y:-.7};
   s.joints[1].links=[{a:1,ai:0,b:2,bi:0},{a:1,ai:1,b:2,bi:1},{a:1,ai:2,b:2,bi:3},{a:3,ai:0,b:2,bi:2}];
 }
 const bikeLane=scenario==='entry'?3:2;
 for (const r of s.roads) for (const t of Object.values(r.laneTypes??{})) {t.type=type;t.width=type==='bike'?5:7;t.conflict=layout;}
 for (const l of s.joints[1].links) {if(feed)l.feed=true; if(reverse){[l.a,l.b]=[l.b,l.a];[l.ai,l.bi]=[l.bi,l.ai];}}
 document.dispatchEvent(new Event('sheetchange'));
 const routes=StripeMaker.roadEditor.auditRoutes(s);
 if(routes.length!==1 || routes.some(r=>r.meets>.01||!r.onPavement))throw new Error('Disconnected or off-pavement bike route: '+JSON.stringify(routes));
 const downstream=s.roads[1];
 const track=StripeMaker.roadEditor.laneTracks(s).find(t=>t.road===2).line;
 const feet=track.slice(1).reduce((sum,p,i)=>sum+Math.hypot(p.x-track[i].x,p.y-track[i].y),0)*s.inchesPerPixel/12;
 const conflicts=StripeMaker.roadEditor.auditConflicts(s,downstream);
 const move=conflicts.find(([k])=>k===bikeLane)?.[1]??[];
 if(scenario==='entry') {
  assertRange(move,[[0,100,'dotted'],[100,150,'blank'],[150,200,'dotted']],feet);
 } else assertRange(move,[],feet);
 const upstream=s.roads[0], upLane=scenario==='entry'?2:3;
 const upTrack=StripeMaker.roadEditor.laneTracks(s).find(t=>t.road===1).line;
 const upFeet=upTrack.slice(1).reduce((sum,p,i)=>sum+Math.hypot(p.x-upTrack[i].x,p.y-upTrack[i].y),0)*s.inchesPerPixel/12;
 const up=StripeMaker.roadEditor.auditConflicts(s,upstream).find(([k])=>k===upLane)?.[1]??[];
 assertRange(up,scenario==='entry'?[]:[[upFeet-100,upFeet-50,'dotted'],[upFeet-50,upFeet-20,'blank'],[upFeet-20,upFeet,'dotted']],upFeet);
 function assertRange(actual,expected,length) {
  if(actual.length!==expected.length || actual.some((r,i)=>r[2]!==expected[i][2] || Math.abs(r[0]*length-expected[i][0])>.01 || Math.abs(r[1]*length-expected[i][1])>.01))
   throw new Error(scenario+' conflict placement: '+JSON.stringify({actual,expected,length}));
 }
 // The exit weave belongs on the wider approach, before pavement drops away.
 s.surfaces=[scenario==='entry'
  ? {id:'gap',on:{road:2,lane:bikeLane},from:100/feet,to:150/feet,color:'green',pattern:'conflict'}
  : {id:'gap',on:{road:1,lane:upLane},from:1-50/upFeet,to:1-20/upFeet,color:'green',pattern:'conflict'}];
 StripeMaker.roadEditor.render();
 if(s.roadLayer.querySelectorAll('.laneSurface').length)throw new Error('Green paint entered the weaving gap');
 s.surfaces[0].from=0;
 s.surfaces[0].to=1;StripeMaker.roadEditor.render();
 if(!s.roadLayer.querySelectorAll('.laneSurface').length)throw new Error('Missing conflict color');
 s.surfaces=[];
 const once=JSON.stringify([s.roads,s.joints]);
 document.dispatchEvent(new Event('sheetchange'));
 const links=s.joints[1].links;
 const joins=(a,ai,b,bi)=>links.some(l=>(l.a===a&&l.ai===ai&&l.b===b&&l.bi===bi)||(l.b===a&&l.bi===ai&&l.a===b&&l.ai===bi));
 return {bike:scenario==='entry'?joins(1,2,2,3):joins(1,3,2,2),ramp:scenario==='entry'?joins(3,0,2,2):joins(1,2,3,0),wrong:joins(1,2,2,2),stable:once===JSON.stringify([s.roads,s.joints]),finite:!s.roadLayer.innerHTML.includes('NaN')};
 },{feed,reverse,type,layout,scenario});
 assert.deepEqual(result,{bike:true,ramp:true,wrong:false,stable:true,finite:true},JSON.stringify({feed,reverse,type}));
 if(scenario==='entry' && layout==='freeflow' && feed && reverse && type==='bufferedBike') {
  await page.evaluate(()=>{
   const s=StripeMaker.sheets.selected;
   s.surfaces=[{id:'entry-a',span:'entry',order:0,on:{road:1,lane:2},from:0,to:1,color:'green',pattern:'conflict'},{id:'entry-b',span:'entry',order:1,on:{road:2,lane:3},from:0,to:1,color:'green',pattern:'conflict'}];
   StripeMaker.roadEditor.render();
   const svg=s.roadLayer.cloneNode(true);
   svg.id='entryAuditPreview';svg.setAttribute('viewBox','14750 13000 1200 3600');
   svg.style.cssText='position:fixed;left:0;top:0;width:400px;height:800px;z-index:9999;background:#202124;transform:none';
   document.body.append(svg);
  });
  await page.locator('#entryAuditPreview').screenshot({path:'/tmp/stripemaker-ramp-entry-audit.png'});
  await page.locator('#entryAuditPreview').evaluate(el=>el.remove());
 }

 }
 // Different widths and independently curved joint ends must join at
 // both edges and at the buffered inner stripe, not merely at lane centers.
 for(const variant of ['width','angle','both']) {
  const result=await page.evaluate(variant=>{
   const s=StripeMaker.sheets.selected,roads=structuredClone(s.roads);
   if(variant!=='angle')s.roads[1].laneTypes[2].width=9;
   if(variant!=='width')s.roads[1].ends[0].dir={x:.08,y:-Math.sqrt(1-.08*.08)};
   const routes=StripeMaker.roadEditor.auditRoutes(s);
   if(variant==='both') {
    StripeMaker.roadEditor.render();
    const endpoints=[...s.roadLayer.querySelectorAll('path.roadMarking[stroke]')]
     .filter(p=>!p.hasAttribute('stroke-dasharray'))
     .flatMap(p=>{const n=(p.getAttribute('d').match(/-?\d+(?:\.\d+)?/g)??[]).map(Number);return [{x:n[0],y:n[1]},{x:n.at(-2),y:n.at(-1)}];});
    for(const t of routes.flatMap(r=>r.solidTargets))if(!endpoints.some(p=>Math.hypot(p.x-t.x,p.y-t.y)<.03))
     throw new Error('Solid continuation clipped away at '+JSON.stringify(t));
    const svg=s.roadLayer.cloneNode(true);svg.id='skewAuditPreview';
    svg.setAttribute('viewBox','14880 14500 550 1100');
    svg.style.cssText='position:fixed;left:0;top:0;width:400px;height:800px;z-index:9999;background:#202124;transform:none';
    document.body.append(svg);
   }
   s.roads=roads;
   return routes;
  },variant);
  assert(result.length===1&&result.every(r=>r.meets<.01),variant+': '+JSON.stringify(result));
  if(variant==='both') {
   await page.locator('#skewAuditPreview').screenshot({path:'/tmp/stripemaker-bike-skew-audit.png'});
   await page.locator('#skewAuditPreview').evaluate(el=>el.remove());
  }
 }
 await page.evaluate(()=>{
  const s=StripeMaker.sheets.selected;
  s.surfaces=[{id:'exit-a',span:'exit',order:0,on:{road:1,lane:3},from:0,to:1,color:'green',pattern:'conflict'},{id:'exit-b',span:'exit',order:1,on:{road:2,lane:2},from:0,to:1,color:'green',pattern:'conflict'}];
  StripeMaker.roadEditor.render();
  const svg=s.roadLayer.cloneNode(true);
  svg.id='bikeAuditPreview';svg.setAttribute('viewBox','14750 14200 1200 2000');
  svg.setAttribute('width','480');svg.setAttribute('height','800');
  svg.style.cssText='position:fixed;left:0;top:0;width:480px;height:800px;z-index:9999;background:#202124;transform:none';
  document.body.append(svg);
 });
 await page.locator('#bikeAuditPreview').screenshot({path:'/tmp/stripemaker-three-to-two-audit.png'});
 await page.locator('#bikeAuditPreview').evaluate(el=>el.remove());
 await page.evaluate(()=>{StripeMaker.sheets.selected.surfaces=[];StripeMaker.roadEditor.render();});
 // Existing generated surfaces are retired; hand-placed pavement survives.
 assert.deepEqual(await page.evaluate(()=>{
  const s=StripeMaker.sheets.selected;
  const manual={id:'manual-green',on:{road:1,lane:3},from:0,to:1,color:'green',pattern:'conflict'};
  s.surfaces=[manual,{...manual,id:'old-auto',bikeTreatment:true}];
  document.dispatchEvent(new Event('sheetchange'));
  const ids=s.surfaces.map(s=>s.id);s.surfaces=[];
  return ids;
 }),['manual-green']);
 // Road selection exposes setup without selecting or right-clicking a node.
 await page.evaluate(()=>StripeMaker.roadEditor.focusRoad(StripeMaker.sheets.selected.roads[0]));
 assert(await page.locator('#bikeSetup').isVisible());
 await page.selectOption('#bikeConflict','separate');
 await page.click('#bikeAddTurn');
 assert.deepEqual(await page.evaluate(()=>{const r=StripeMaker.sheets.selected.roads[0];return [r.lanes,r.tapers['0:4'].mode];}),[5,'taper']);
 await page.selectOption('#bikeSpeed','45');
 assert.equal(await page.evaluate(()=>StripeMaker.sheets.selected.roads[0].tapers['0:4'].length),85);
 assert.equal(await page.locator('#bikeGreen').count(),0);
 assert.equal(await page.evaluate(()=>StripeMaker.sheets.selected.surfaces.length),0);
 await page.screenshot({path:'/tmp/stripemaker-bike-setup.png'});
 await page.setViewportSize({width:390,height:844});
 await page.locator('#bikeConflict').scrollIntoViewIfNeeded();
 const mobileControl=await page.locator('#bikeConflict').boundingBox();
 assert(mobileControl.x>=0 && mobileControl.x+mobileControl.width<=390);
 await page.screenshot({path:'/tmp/stripemaker-bike-setup-mobile.png'});
 await page.setViewportSize({width:1400,height:1000});
 await page.click('#undoButton'); // speed
 await page.click('#undoButton'); // added lane
 assert.equal(await page.evaluate(()=>StripeMaker.sheets.selected.roads[0].lanes),4);
 // Right-click on the actual + control, then keyboard context-menu access.
 await page.evaluate(()=>StripeMaker.roadEditor.focusRoad(StripeMaker.sheets.selected.roads[1]));
 const plus=page.getByRole('button',{name:'Add a lane on the right',exact:true});
 await plus.dispatchEvent('contextmenu',{button:2});
 await page.getByRole('menuitem',{name:'Add Turn Lane on Right of Bike Lane',exact:true}).click();
 assert.equal(await page.evaluate(()=>StripeMaker.sheets.selected.roads[1].lanes),4);
 await page.click('#undoButton');
 await plus.focus();await plus.press('Shift+F10');
 assert.equal(await page.getByRole('menuitem',{name:'Add Travel Lane Inside Bike Lane',exact:true}).count(),1);
 await page.keyboard.press('Escape');
 assert.equal(await page.locator('#nodeMenu').isVisible(),false);
 // The visible node menu provides outside lane adding without a modifier.
 await page.evaluate(()=>{const s=StripeMaker.sheets.selected;StripeMaker.roadEditor.focusRoad(s.roads[1]);});
 const node=page.locator('.roadNode[data-road="2"][data-end="0"][data-lane="2"]');
 await node.dispatchEvent('contextmenu',{button:2});
 await page.getByRole('menuitem',{name:'Add Turn Lane on Right of Bike Lane',exact:true}).click();
 const lanes=()=>page.evaluate(()=>{const r=StripeMaker.sheets.selected.roads[1];return [r.lanes,r.laneTypes[2].type,r.laneTypes[3]?.type??'travel'];});
 assert.deepEqual(await lanes(),[4,'bufferedBike','travel']);
 await page.click('#undoButton'); assert.deepEqual(await lanes(),[3,'bufferedBike','travel']);
 await page.click('#redoButton'); assert.deepEqual(await lanes(),[4,'bufferedBike','travel']);
 // The explicit layout and design-speed controls persist as one edit each.
 await node.dispatchEvent('contextmenu',{button:2});await page.keyboard.press('Escape');
 await page.selectOption('#bikeConflict','separate');await page.selectOption('#bikeSpeed','45');
 assert.deepEqual(await page.evaluate(()=>{const l=StripeMaker.sheets.selected.roads[1].laneTypes[2];return [l.conflict,l.designSpeed];}),['separate',45]);
 await page.click('#undoButton');
 assert.equal(await page.evaluate(()=>StripeMaker.sheets.selected.roads[1].laneTypes[2].designSpeed??0),0);
 // Real geometry: a 100-ft bike lane with an outside turn lane. The
 // conflict must cover the entire 80-ft taper, not half of this short road.
 for (const end of [0,1]) for (const type of ['bike','bufferedBike']) {
 const ranges=await page.evaluate(({end,type})=>{
   const s=StripeMaker.sheets.selected;s.inchesPerPixel=12;s.intersections=[];
   s.roads=[{id:1,lanes:3,laneWidth:12,laneTypes:{1:{type,width:type==='bike'?5:7}},
    tapers:{[`${end}:2`]:{mode:'taper',length:80}},
    ends:[{joint:1,sign:1,length:null},{joint:2,sign:1,length:null}]}];
   s.joints=[{id:1,x:0,y:0,dir:{x:1,y:0},root:1,links:[]},{id:2,x:100,y:0,dir:{x:1,y:0},root:1,links:[]}];
   return StripeMaker.roadEditor.auditConflicts(s,s.roads[0]);
 },{end,type});
 for(const k of [1,2]) {
  const span=ranges.find(r=>r[0]===k)?.[1];
  assert(span && span.length===1);
  assert(Math.abs(span[0][0]-(end?0.2:0))<.001);
  assert(Math.abs(span[0][1]-(end?1:0.8))<.001);
 }
 }
 // Exhibit C: both bus-bay tapers cross the bike lane, with a solid
 // section between them. No arbitrary 100/150-ft lane-change gap is inserted.
 const bus=await page.evaluate(()=>{
  const s=StripeMaker.sheets.selected,r=s.roads[0];s.joints[1].x=400;
  r.tapers={'0:2':{mode:'taper',length:80},'1:2':{mode:'taper',length:80}};
  const ranges=StripeMaker.roadEditor.auditConflicts(s,r);
  s.joints[1].x=100;r.tapers={'1:2':{mode:'taper',length:80}};
  return ranges;
 });
 for(const k of [1,2]) assert.deepEqual(bus.find(([n])=>n===k)[1],[[0,.2,'dotted'],[.8,1,'dotted']]);
 // Exhibit A design-speed table overrides the arbitrary drawn taper length.
 const speedRange=await page.evaluate(()=>{
  const s=StripeMaker.sheets.selected,r=s.roads[0];r.laneTypes[1].conflict='separate';r.laneTypes[1].designSpeed=45;
  return StripeMaker.roadEditor.auditConflicts(s,r);
 });
 assert(Math.abs(speedRange.find(([k])=>k===1)[1][0][0]-.15)<.001,'45 mph gives an 85-ft L1 on this 100-ft road');
 // Explicit and automatic tapers on a bike lane must keep its full width.
 for (const mode of ['auto','taper']) {
 const widths=await page.evaluate(mode=>{
  const s=StripeMaker.sheets.selected,r=s.roads[0];s.autoTapers=true;
  r.tapers={'0:1':{mode,length:80},'1:1':{mode,length:80}};
  const t=StripeMaker.roadEditor.laneTracks(s)[0];
  return [t.bounds[0][2]-t.bounds[0][1],t.bounds.at(-1)[2]-t.bounds.at(-1)[1]];
 },mode);
 assert.deepEqual(widths,[7,7]);
 }
 // A crossing road that still overlaps beyond the old 600-ft search cap
 // must not lose all of its conflict striping.
 const longConflict=await page.evaluate(()=>{
  const s=StripeMaker.sheets.selected,r=s.roads[0];r.lanes=2;r.tapers={};s.autoTapers=false;
  s.joints[1].x=1000;
  s.joints.push({id:3,x:1000,y:0,dir:{x:1,y:0},root:2,links:[]});
  s.roads.push({id:2,lanes:1,laneWidth:20,ends:[{joint:1,sign:1,length:null},{joint:3,sign:1,length:null}]});
  const result=StripeMaker.roadEditor.auditConflicts(s,r);
  r.laneTypes[1].conflict='channelized';
  const curbed=StripeMaker.roadEditor.auditConflicts(s,r);
  if(JSON.stringify(curbed)!==JSON.stringify(result))throw new Error('Curbed crossing must use actual pavement overlap');
  delete r.laneTypes[1].conflict;
  s.roads.pop();s.joints.pop();
  return result;
 });
 assert(longConflict.find(([k])=>k===1)?.[1].some(([a,b])=>a===0&&b>.99),'long overlap remains dotted');
 // An ordinary attached intersection approach gets 150 ft of dotted buffer.
 const approach=await page.evaluate(()=>{
  const s=StripeMaker.sheets.selected,r=s.roads[0];r.lanes=2;r.tapers={};
  s.joints[1].x=200;
  s.intersections=[{approaches:[{binding:{road:1,e:1}}]}];
  return StripeMaker.roadEditor.auditConflicts(s,r);
 });
 assert.deepEqual(approach,[[1,[[.25,1,'dotted']]]]);
 // A separated two-way track must never acquire keyhole conflict stripes.
 assert.deepEqual(await page.evaluate(()=>{
  const s=StripeMaker.sheets.selected;s.roads[0].laneTypes[1]={type:'twoWayBike',width:12};
  return StripeMaker.roadEditor.auditConflicts(s,s.roads[0]);
 }),[]);
 assert.deepEqual(errors,[]);
 console.log('PASS: feed and ordinary links, both link orientations, plain/buffered migration, idempotence, outside turn lane menu and undo/redo.');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
