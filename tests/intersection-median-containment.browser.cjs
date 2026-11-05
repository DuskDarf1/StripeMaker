/* Run against a local server; PLAYWRIGHT_MODULE and CHROME_PATH match existing browser regressions. */
const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const selectChoice=require('./select-choice.cjs');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
 try {
  const page=await browser.newPage({viewport:{width:1400,height:1000}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.STRIPEMAKER_URL||'http://127.0.0.1:8876');
  await page.locator('#blankSheet').evaluate(b=>b.click());
  await page.waitForFunction(()=>StripeMaker.sheets.selected?.inchesPerPixel);
  await page.getByRole('button',{name:'Intersections',exact:true}).click();await page.locator('#newIntersection').click();
  await page.evaluate(()=>{const app=StripeMaker,s=app.sheets.selected,i=s.intersections[0];s.view={scale:1,x:800-i.x,y:500-i.y};app.sheets.zoomBy(1);app.roadEditor.render();});
  const click=async(x,y)=>{const p=await page.evaluate(({x,y})=>{const a=StripeMaker,s=a.sheets.selected,i=s.intersections[0],p=a.sheets.toScreen({x:i.x+x*12/s.inchesPerPixel,y:i.y+y*12/s.inchesPerPixel}),r=document.querySelector('#previewStage').getBoundingClientRect();return {x:p.x+r.left,y:p.y+r.top};},{x,y});await page.mouse.click(p.x,p.y);};
  const state=()=>page.evaluate(()=>structuredClone(StripeMaker.sheets.selected.intersections[0]));
  await page.locator('#intersection-Incominglanes').fill('2');await page.locator('#intersection-Incominglanes').press('Tab');
  await page.getByRole('button',{name:'Add Intersection Median',exact:true}).click();
  await click(70,0);await page.keyboard.press('Enter');
  assert.equal((await state()).medians?.length??0,0,'outside clicks cannot create a median');
  const lane=await page.evaluate(()=>{const G=StripeMaker.intersectionGeometry,i=StripeMaker.sheets.selected.intersections[0],a=i.approaches[0];return {y:G.boundary(a,true,1),outer:G.boundary(a,true,1)-G.width(a,true,1),id:a.inLanes[1],inner:a.inLanes[0]};});
  await page.getByRole('button',{name:'Add Intersection Median',exact:true}).click();
  await click(45,lane.y+.2);await click(40,lane.y+.2);await click(35,-20);await page.keyboard.press('Enter');
  let median=(await state()).medians[0];assert.equal(median.points.length,3);
  assert.equal(median.points[0].on.side,`lane:in:${lane.inner}:R`,'drawing snaps to the approach lane boundary');
  assert.equal(median.points[0].y,lane.y);
  const dragPoint=async(index,x,y)=>{
    const box=await page.getByRole('button',{name:`Median point ${index}`,exact:true}).boundingBox();
    const target=await page.evaluate(({x,y})=>{const app=StripeMaker,s=app.sheets.selected,i=s.intersections[0],p=app.sheets.toScreen({x:i.x+x*12/s.inchesPerPixel,y:i.y+y*12/s.inchesPerPixel}),r=document.querySelector('#previewStage').getBoundingClientRect();return {x:p.x+r.left,y:p.y+r.top};},{x,y});
    await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(target.x,target.y);await page.mouse.up();
  };
  const before=JSON.stringify(median);await dragPoint(1,70,0);assert.equal(JSON.stringify((await state()).medians[0]),before,'outside drag keeps the last valid shape');
  await dragPoint(1,43,lane.outer+.2);
  median=(await state()).medians[0];assert.equal(median.points[0].on.side,`lane:in:${lane.id}:R`,'dragging also snaps to lane lines');
  assert.ok(await page.evaluate(()=>{const i=StripeMaker.sheets.selected.intersections[0];return StripeMaker.intersectionGeometry.islandWithin(i,i.medians[0]);}));
  await page.locator('#undoButton').click();assert.equal(JSON.stringify((await state()).medians[0]),before,'accepted drag is one undo step');
  await page.locator('#redoButton').click();
  await page.locator('#duplicateIntersection').evaluate(b=>b.click());
  assert.ok(await page.evaluate(()=>{const i=StripeMaker.sheets.selected.intersections[1];return i.medians[0].points[0].on.side.includes(i.approaches[0].inLanes[1]);}),'duplication remaps lane anchors');
  await page.waitForTimeout(800);await page.reload();await page.waitForFunction(()=>StripeMaker.sheets.selected?.intersections?.[0]?.medians?.length);
  assert.equal((await state()).medians[0].points[0].on.side,`lane:in:${lane.id}:R`,'lane anchors persist');
  assert.deepEqual(errors,[]);console.log('Intersection median containment and lane-line snapping passed.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
