const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
 try {
  const page=await browser.newPage({viewport:{width:1400,height:1000}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.STRIPEMAKER_URL||'http://127.0.0.1:8883');
  await page.waitForFunction(()=>StripeMaker.sheets.ready);
  await page.locator('#blankSheet').evaluate(b=>b.click());await page.waitForFunction(()=>StripeMaker.sheets.selected);
  await page.evaluate(()=>{
   const A=StripeMaker,s=A.sheets.selected,i=A.intersectionGeometry.create();
   Object.assign(i,{x:15000,y:15000});s.intersections=[i];
   s.markings=[{id:'crosswalk',type:'crosswalk',enhanced:true,width:10,a:{x:14910,y:14970},b:{x:15090,y:15030}}];
   s.view={scale:1,x:800-i.x,y:500-i.y,fitted:false};A.sheets.zoomBy(1);
   document.dispatchEvent(new Event('sheetchange'));A.roadEditor.render();A.markings.focusAt({x:15000,y:15000});A.history.rebase();
  });
  const paint=()=>page.locator('.laneMarkings path[fill="#ffffff"]').evaluateAll(paths=>paths.map(p=>p.getAttribute('d')));
  const model=()=>page.evaluate(()=>structuredClone(StripeMaker.sheets.selected.markings[0]));
  assert.equal((await paint()).length,2);assert.equal(await page.locator('#markingBarDirection').count(),0);
  assert.equal(await page.locator('#markingBarAngleRow').isVisible(),false);
  await page.locator('#markingForceBars').check();
  assert.equal(await page.locator('#markingBarAngle').inputValue(),'0');
  const perpendicular=await paint();assert(perpendicular.length>2);
  await page.locator('#markingBarAngle').focus();await page.keyboard.press('ArrowRight');
  assert.equal((await model()).barAngle,1);assert.equal(await page.locator('#markingBarAngleValue').inputValue(),'1');
  await page.locator('#markingBarAngleValue').fill('30');await page.locator('#markingBarAngleValue').blur();
  const angled=await paint();assert.notDeepEqual(angled,perpendicular);assert.equal((await model()).barAngle,30);
  assert.equal(await page.locator('#markingBarAngle').inputValue(),'30');
  const rotation=Math.atan2(60,180)+Math.PI/6,t={x:-Math.sin(rotation),y:Math.cos(rotation)};
  const ring=angled[3].match(/-?\d*\.?\d+/g).map(Number);
  assert(Array.from({length:ring.length/2},(_,i)=>{const j=(i+1)%(ring.length/2),dx=ring[2*j]-ring[2*i],dy=ring[2*j+1]-ring[2*i+1];return Math.hypot(dx,dy)>5&&Math.abs(dx*t.y-dy*t.x)<.01;}).some(Boolean),'paint follows the chosen angle');
  await page.locator('#undoButton').click();assert.notEqual((await model()).barAngle,30);
  await page.locator('#redoButton').click();assert.deepEqual(await paint(),angled);
  await page.evaluate(()=>StripeMaker.markings.focusAt({x:15000,y:15000}));
  await page.locator('#markingForceBars').uncheck();assert.equal((await paint()).length,2);
  assert.equal(await page.locator('#markingBarAngleRow').isVisible(),false);
  await page.locator('#markingForceBars').check();assert.deepEqual(await paint(),angled);
  await page.locator('#markingEnhanced').uncheck();assert.equal((await paint()).length,2);
  await page.locator('#markingEnhanced').check();assert.deepEqual(await paint(),angled);
  for(const value of ['-90','90']){
   await page.locator('#markingBarAngleValue').fill(value);await page.locator('#markingBarAngleValue').blur();
   assert((await paint()).length>2,'slider endpoints keep visible bars');
  }
  await page.locator('#markingBarAngleValue').fill('30');await page.locator('#markingBarAngleValue').blur();
  await page.screenshot({path:'/tmp/crosswalk-bar-angle.png'});
  // Angle and force state survive project round trips.
  const project=await page.evaluate(()=>StripeMaker.projectJSON.snapshot());
  await page.evaluate(p=>StripeMaker.projectJSON.load(p),project);
  assert.equal((await model()).barAngle,30);assert.deepEqual(await paint(),angled);
  // Draft controls work before any road or crosswalk has been picked.
  await page.locator('#chooseMarking').click();await page.locator('#markingSearch').fill('crosswalk');
  await page.locator('#markingGrid [data-type="crosswalk"]').click();
  await page.locator('#markingEnhanced').check();await page.locator('#markingForceBars').check();
  await page.locator('#markingBarAngleValue').fill('-25');await page.locator('#markingBarAngleValue').blur();
  const move=async(x,y)=>{const p=await page.evaluate(({x,y})=>{const A=StripeMaker,q=A.sheets.toScreen({x,y}),r=document.querySelector('#previewStage').getBoundingClientRect();return{x:q.x+r.left,y:q.y+r.top};},{x,y});await page.mouse.move(p.x,p.y);return p;};
  let p=await move(14940,15100);await page.mouse.click(p.x,p.y);p=await move(15060,15100);
  assert(await page.locator('.markingPreview path[fill="#ffffff"]').count()>2);await page.mouse.click(p.x,p.y);
  assert.equal(await page.evaluate(()=>StripeMaker.sheets.selected.markings[1].barAngle),-25);
  await page.evaluate(()=>{StripeMaker.selection.copy();StripeMaker.selection.paste(null);});
  assert.equal(await page.evaluate(()=>StripeMaker.sheets.selected.markings.at(-1).barAngle),-25);
  await page.waitForTimeout(800);await page.reload();
  await page.waitForFunction(()=>StripeMaker.sheets.ready&&StripeMaker.sheets.selected?.markings?.length===3);
  assert.deepEqual(await page.evaluate(()=>StripeMaker.sheets.selected.markings.map(m=>[m.forceBars,m.barAngle])),[[true,30],[true,-25],[true,-25]]);
  assert.deepEqual(errors,[]);
  console.log('PASS: simple force checkbox and angle slider, live rotation, full angle range, automatic mode, draft preview, undo/redo, JSON, copy/paste and reload.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
