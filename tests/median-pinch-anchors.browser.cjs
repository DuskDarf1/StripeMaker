const assert=require('node:assert/strict');
const fixture=require('./fixtures/median-curved-merge.json');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH});try{
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/js/elements.js',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text()).replace('window.StripeMaker.roadEditor = {',`window.StripeMaker.roadEditor = { auditPinches:s=>{const solved=solve(s),edges=pavementEdges(s,solved).edges.filter(e=>[7,8].includes(e.on?.road)&&['L','R'].includes(e.on.side));return edges.flatMap(a=>edges.filter(b=>b.on.road!==a.on.road).flatMap(b=>edgeCrossings(a,b).filter(p=>p.a>.001&&p.a<.999&&p.b>.001&&p.b<.999).map(p=>({x:p.x,y:p.y,on:{...a.on,f:p.a,crossing:{...b.on,f:p.b}}}))));}, auditAnchor:s=>{const solved=solve(s);anchorMedians(s,solved);const p=s.medians[0].points[0],edges=pavementEdges(s,solved).byKey;return {point:p,distances:[p.on,p.on?.crossing].filter(Boolean).map(on=>nearestOn(edges.get(medianAnchorKey(on)),p).distance)};}, auditSnap:(s,p)=>snapMedian(s,p), `)});});
 await page.goto(process.env.STRIPEMAKER_URL||'http://127.0.0.1:8878');await page.waitForFunction(()=>StripeMaker.sheets.ready);
 await page.click('button[aria-controls="sheetsMenu"]');await page.click('#blankSheet');await page.waitForFunction(()=>StripeMaker.sheets.selected);
 await page.evaluate(f=>{Object.assign(StripeMaker.sheets.selected,f);StripeMaker.roadEditor.render();},fixture);
 for(const feed of [true,false]) {
 const result=await page.evaluate(({fixture,feed})=>{
  const s=StripeMaker.sheets.selected;Object.assign(s,structuredClone(fixture));
  s.joints.find(j=>j.id===17).links.find(l=>l.b===8).feed=feed;
  StripeMaker.roadEditor.render();
  const candidates=StripeMaker.roadEditor.auditPinches(s);
  if(!candidates.length)throw Error('Fixture has no crossing');
  const p=candidates[0],snap=StripeMaker.roadEditor.auditSnap(s,p);
  if(!snap.on?.crossing)throw Error('Snapping omitted second edge');
  s.medians=[{id:100,type:'grass',points:[structuredClone(p),{x:p.x+100,y:p.y+100},{x:p.x-100,y:p.y+100}]}];
  StripeMaker.history.rebase();
  const start={x:p.x,y:p.y};
  s.joints.find(j=>j.id===15).y+=100;
  const after=StripeMaker.roadEditor.auditAnchor(s);
  const moved=Math.hypot(after.point.x-start.x,after.point.y-start.y);
  StripeMaker.history.record();StripeMaker.history.undo();
  const undone=StripeMaker.roadEditor.auditAnchor(s).point;
  if(Math.hypot(undone.x-start.x,undone.y-start.y)>.01)throw Error('Undo lost pinch anchor');
  StripeMaker.history.redo();
  s.joints.find(j=>j.id===13).x-=40;
  const second=StripeMaker.roadEditor.auditAnchor(s);
  if(second.distances.length!==2||second.distances.some(d=>d>.01))throw Error('Moving other branch lost pinch');
  // Deleting one referenced road retains attachment to the surviving edge.
  const deleted=second.point.on.road;
  s.roads=s.roads.filter(r=>r.id!==deleted);
  for(const j of s.joints)j.links=j.links.filter(l=>l.a!==deleted&&l.b!==deleted);
  const surviving=StripeMaker.roadEditor.auditAnchor(s).point;
  if(!surviving.on||surviving.on.road===deleted)throw Error('Surviving edge anchor lost');
  // Saved old single-edge anchors at a crossing upgrade before a road edit.
  Object.assign(s,structuredClone(fixture));StripeMaker.roadEditor.render();
  const legacy=StripeMaker.roadEditor.auditPinches(s)[0];delete legacy.on.crossing;
  s.medians=[{id:100,type:'grass',points:[legacy,{x:0,y:0},{x:10,y:0}]}];
  const upgraded=StripeMaker.roadEditor.auditAnchor(s).point;
  return {moved,distances:after.distances,upgraded:!!upgraded.on.crossing};
 },{fixture,feed});
 assert(result.moved>1,'pinch point follows moving road');assert.equal(result.distances.length,2);assert(result.distances.every(d=>d<.01));assert(result.upgraded);
 }
 assert.deepEqual(errors,[]);console.log('PASS: direct lane feed and ordinary merge pinch anchors follow both edges; legacy anchors upgrade.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
