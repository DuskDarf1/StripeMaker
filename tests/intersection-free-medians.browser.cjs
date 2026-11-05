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
  await page.waitForFunction(()=>StripeMaker.sheets.ready);
  await page.locator('#blankSheet').evaluate(b=>b.click());
  await page.waitForFunction(()=>StripeMaker.sheets.selected?.inchesPerPixel);
  await page.getByRole('button',{name:'Intersections',exact:true}).click();await page.locator('#newIntersection').click();
  await page.evaluate(()=>{const app=StripeMaker,s=app.sheets.selected,i=s.intersections[0];s.view={scale:1,x:800-i.x,y:500-i.y};app.sheets.zoomBy(1);app.roadEditor.render();});
  const click=async(x,y)=>{const p=await page.evaluate(({x,y})=>{const a=StripeMaker,s=a.sheets.selected,i=s.intersections[0],p=a.sheets.toScreen({x:i.x+x*12/s.inchesPerPixel,y:i.y+y*12/s.inchesPerPixel}),r=document.querySelector('#previewStage').getBoundingClientRect();return {x:p.x+r.left,y:p.y+r.top};},{x,y});await page.mouse.click(p.x,p.y);};
  const state=()=>page.evaluate(()=>structuredClone(StripeMaker.sheets.selected.intersections[0]));
  await page.getByRole('button',{name:'Add Intersection Median',exact:true}).click();
  for(const [x,y]of [[-8,-8],[8,-8],[8,8],[-8,8]])await click(x,y);
  await page.keyboard.press('Enter');
  assert.equal((await state()).medians?.length,1,'click drawing creates an intersection-owned median');
  assert.equal((await state()).medians[0].points.length,4);
  await selectChoice(page.locator('#intersection-island-surface'),'painted');
  await selectChoice(page.locator('#intersection-island-color'),'white');
  assert.equal((await state()).medians[0].color,'white');
  assert.ok(await page.locator('.roadLayer [data-intersection-median] path[stroke="#ffffff"]').count());
  const point=()=>page.getByRole('button',{name:'Median point 1',exact:true});
  await point().focus();await page.keyboard.press('ArrowRight');
  const moved=(await state()).medians[0].points[0].x;assert.ok(moved>-8);
  await page.locator('#undoButton').click();assert.equal((await state()).medians[0].points[0].x,-8);
  await page.locator('#redoButton').click();assert.equal((await state()).medians[0].points[0].x,moved);
  await point().focus();await page.keyboard.press('Enter');assert.ok((await state()).medians[0].points[0].curve);
  const box=await point().boundingBox();await page.mouse.dblclick(box.x+box.width/2,box.y+box.height/2);assert.equal((await state()).medians[0].points[0].curve,undefined,'double-click toggles a curved vertex');
  await point().focus();await page.keyboard.press('Delete');assert.equal((await state()).medians[0].points.length,3);
  await page.locator('#undoButton').click();
  // Snap to the actual approach median's two mouth corners.
  await page.locator('#intersection-median').fill('12');await page.locator('#intersection-median').press('Tab');
  const corners=await page.evaluate(()=>{const G=StripeMaker.intersectionGeometry,i=StripeMaker.sheets.selected.intersections[0],a=i.approaches[0],p=G.medianEdge(i,{approach:a.id,side:'median'});return [p[0],p.at(-1)];});
  await page.getByRole('button',{name:'Add Intersection Median',exact:true}).click();
  for(const p of corners)await click(p.x,p.y);await click(20,0);await page.keyboard.press('Enter');
  assert.equal((await state()).medians.length,2);assert.ok((await state()).medians[1].points.slice(0,2).every(p=>p.on?.side==='median'));
  const cornerTarget=await page.evaluate(()=>{
    const app=StripeMaker,s=app.sheets.selected,i=s.intersections[0],G=app.intersectionGeometry;
    const edge=G.medianEdge(i,{approach:i.approaches[0].id,side:'corner'}),p=edge[Math.floor(edge.length/4)];
    const q=app.sheets.toScreen({x:i.x+p.x*12/s.inchesPerPixel,y:i.y+p.y*12/s.inchesPerPixel}),r=document.querySelector('#previewStage').getBoundingClientRect();
    return {x:q.x+r.left,y:q.y+r.top};
  });
  const handle=await page.getByRole('button',{name:'Median point 3',exact:true}).boundingBox();
  await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);await page.mouse.down();
  await page.mouse.move(cornerTarget.x,cornerTarget.y,{steps:5});await page.mouse.up();
  assert.equal((await state()).medians[1].points[2].on?.side,'corner','drag snaps to rounded intersection corner');
  await page.screenshot({path:'/tmp/intersection-free-medians.png'});
  // Whole-intersection duplication preserves and remaps median anchors.
  await page.locator('#duplicateIntersection').evaluate(b=>b.click());
  const copy=await page.evaluate(()=>StripeMaker.sheets.selected.intersections[1]);
  assert.equal(copy.medians.length,2);assert.equal(copy.medians[1].points[0].on.approach,copy.approaches[0].id);
  assert.notEqual(copy.medians[0].id,(await state()).medians[0].id);

  await page.waitForTimeout(800);await page.reload();await page.waitForFunction(()=>StripeMaker.sheets.selected?.intersections?.[0]?.medians?.length===2);
  assert.equal((await state()).medians[0].type,'painted');
  await page.getByRole('button',{name:'Download',exact:true}).click();
  await page.locator('[data-format="pdf"]').click();
  const downloading=page.waitForEvent('download');await page.locator('#downloadSheet').click();
  await (await downloading).saveAs('/tmp/intersection-free-medians.pdf');
  const pdf=require('node:fs').readFileSync('/tmp/intersection-free-medians.pdf').toString('latin1');
  const id=pdf.match(/\/Contents (\d+) 0 R/)[1],start=pdf.indexOf(`${id} 0 obj\n`),stream=pdf.indexOf('stream\n',start)+7;
  const length=Number(pdf.slice(start,stream).match(/\/Length (\d+)/)[1]);
  const content=require('node:zlib').inflateSync(Buffer.from(pdf.slice(stream,stream+length),'latin1')).toString();
  assert.match(content,/W\*?\s+n/,'median paint exports with vector clipping');
  assert.deepEqual(errors,[]);
  console.log('Intersection medians: drawing, paint, point editing, curves, snapping, undo/redo and reload passed.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
