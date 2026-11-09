const assert=require('node:assert/strict'),path=require('node:path'),{pathToFileURL}=require('node:url');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fixture=require('./fixtures/arc-fit-disabled.json'),G=require('../js/circular-arc.js');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
 try{
  const page=await browser.newPage({viewport:{width:1600,height:1100}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(pathToFileURL(path.resolve(__dirname,'../index.html')).href);
  await page.waitForFunction(()=>StripeMaker.sheets.ready);
  await page.locator('#blankSheet').evaluate(b=>b.click());
  await page.waitForFunction(()=>StripeMaker.sheets.selected);
  await page.evaluate(f=>{
   const A=StripeMaker,s=A.sheets.selected;Object.assign(s,structuredClone(f));
   s.view={scale:7,x:-1900,y:-1650};A.sheets.zoomBy(1);
   A.roadEditor.focusRoad(s.roads.find(r=>r.id===22));A.history.rebase();
  },fixture);
  const snapshot=()=>page.evaluate(()=>{
   const A=StripeMaker,s=A.sheets.selected,solved=A.roadEditor.solve(s),tracks=A.roadEditor.laneTracks(s),net=A.roadEditor.simulatorNetwork(s);
   return {fits:[...solved.arcFits],hosts:s.roads.filter(r=>r.arcAngle==null),joints:s.joints,
    hostTracks:tracks.filter(t=>s.roads.find(r=>r.id===t.road).arcAngle==null),tracks,
    gaps:net.connections.filter(c=>[19,21,22,23].includes(c.from.road)||[19,21,22,23].includes(c.to.road)).map(c=>{
     const p=net.lanes.find(l=>l.road===c.from.road&&l.lane===c.from.lane).points.at(-1),q=net.lanes.find(l=>l.road===c.to.road&&l.lane===c.to.lane).points[0];
     return {...c,gap:Math.hypot(p.x-q.x,p.y-q.y)};
    })};
  });
  const before=await snapshot();
  assert.equal(await page.locator('#roadArcFit').isChecked(),false,'saved opt-outs are visible');
  assert.equal(await page.locator('#roadArcAngleValue').isDisabled(),false);
  assert.ok(!before.fits.some(([id])=>[22,23].includes(id)));
  await page.locator('#roadArcFit').check();
  const fitted=await snapshot(),upper=fitted.fits.filter(([id])=>[22,23].includes(id));
  assert.equal(upper.length,2,'one checkbox enables the complete upper arc pair');
  assert.equal(await page.locator('#roadArcAngleValue').isDisabled(),true);
  assert.equal(await page.locator('.arcAngleHandle').isVisible(),false);
  assert.equal(await page.locator('.arcRadiusHandle').isVisible(),true);
  assert.deepEqual(fitted.hosts,before.hosts);assert.deepEqual(fitted.joints,before.joints);
  assert.deepEqual(fitted.hostTracks,before.hostTracks,'the adjoining Bézier paths do not change');
  assert.ok(Math.abs(upper[0][1].startOffset-upper[1][1].startOffset)>10,'entries stagger along the actual approach');
  assert.ok(Math.abs(upper[0][1].endOffset-upper[1][1].endOffset)>5,'exits stagger along the curved departure');
  assert.ok(fitted.gaps.length>=5&&fitted.gaps.every(c=>c.gap<1e-7),'ramps AND the shared through lanes meet without simulator jumps');
  assert.ok(fitted.gaps.some(c=>c.from.road===7&&c.to.road===21),'the existing through movement is retained');
  for(const [id,fit] of upper){
   const points=fitted.tracks.find(t=>t.road===id).line;
   for(const e of [0,1]){
    const host=G.laneCurve(fit.hostCurves[e])(fit.parameters[e]),p=e?fit.end:fit.start;
    assert.ok(Math.hypot(p.x-host.x,p.y-host.y)<1e-7);
    const circle=G.geometry(fit.start,fit.end,fit.degrees).point(e);
    assert.ok(circle.tangent.x*host.tangent.x+circle.tangent.y*host.tangent.y>1-1e-10,'circle meets the true curved-lane tangent');
   }
   const a=points.findIndex(p=>Math.hypot(p.x-fit.start.x,p.y-fit.start.y)<1e-7),b=points.findIndex(p=>Math.hypot(p.x-fit.end.x,p.y-fit.end.y)<1e-7);
   assert.ok(b>a+30);
   for(const p of points.slice(a,b+1))assert.ok(Math.abs(Math.hypot(p.x-fit.center.x,p.y-fit.center.y)-fit.radius)<1e-7);
   for(let i=1;i<points.length;i++)assert.ok(Math.hypot(points[i].x-points[i-1].x,points[i].y-points[i-1].y)<1,'host-following lead-ins are continuous');
  }
  await page.locator('#undoButton').click();assert.deepEqual((await snapshot()).fits,before.fits);
  await page.locator('#redoButton').click();assert.deepEqual((await snapshot()).fits,fitted.fits);
  await page.locator('#roadArcRadius').fill('95');await page.locator('#roadArcRadius').blur();
  const resized=await snapshot();
  assert.ok(Math.abs(resized.fits.find(([id])=>id===22)[1].radius*fixture.inchesPerPixel/12-95)<1e-7);
  assert.ok(resized.gaps.every(c=>c.gap<1e-7));
  assert.deepEqual(resized.hostTracks,before.hostTracks);
  await page.locator('#roadArcRadius').fill('100000');await page.locator('#roadArcRadius').blur();
  assert.deepEqual((await snapshot()).fits,resized.fits,'an impossible radius cannot silently release fitting');
  await page.locator('.arcRadiusHandle').focus();await page.keyboard.press('ArrowRight');
  const nudged=await snapshot();assert.notDeepEqual(nudged.fits,resized.fits,'the radius handle stays editable');
  assert.equal(nudged.fits.filter(([id])=>[22,23].includes(id)).length,2);
  assert.deepEqual(nudged.hostTracks,before.hostTracks);
  await page.locator('#undoButton').click();assert.deepEqual((await snapshot()).fits,resized.fits);
  await page.locator('#roadArcFit').uncheck();
  assert.ok(!(await snapshot()).fits.some(([id])=>[22,23].includes(id)));
  assert.equal(await page.locator('#roadArcAngleValue').isDisabled(),false);
  await page.locator('#undoButton').click();assert.deepEqual((await snapshot()).fits,resized.fits);
  const saved=await page.evaluate(async()=>{
   const p=await StripeMaker.projectJSON.snapshot('all');StripeMaker.projectJSON.validate(p);return {version:p.version,roads:p.sheets[0].data.roads};
  });
  assert.equal(saved.version,1);
  for(const id of [22,23])assert.equal(saved.roads.find(r=>r.id===id).arcJoinFit,true);
  await page.waitForTimeout(600);await page.reload();await page.waitForFunction(()=>StripeMaker.sheets.selected?.roads.some(r=>r.id===23));
  assert.deepEqual((await snapshot()).fits,resized.fits,'fitting and radius survive reload');
  assert.deepEqual(errors,[]);
  console.log('PASS: upper curved-host split/merge has explicit pair fitting, staggered true circles, continuous ramp/through lanes, unchanged Béziers, radius editing, undo and version-1 persistence.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
