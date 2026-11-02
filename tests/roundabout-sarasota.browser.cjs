const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fixture=require('./fixtures/roundabout-sarasota.json');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
 try {
  const page=await browser.newPage({viewport:{width:1500,height:1100}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.STRIPEMAKER_URL||'http://127.0.0.1:8876');
  await page.waitForFunction(()=>StripeMaker.sheets.ready&&StripeMaker.intersections);
  await page.locator('#blankSheet').evaluate(b=>b.click());
  await page.getByRole('button',{name:'Intersections',exact:true}).click();await page.locator('#newRoundabout').click();
  await page.evaluate(f=>{
   const app=StripeMaker,s=app.sheets.selected,x=s.intersections[0],position={id:x.id,x:x.x,y:x.y};
   Object.assign(x,f,position);app.roadEditor.render();app.sheets.save(s);app.history.record();document.dispatchEvent(new CustomEvent('sheetchange'));
  },fixture);
  await page.getByRole('button',{name:'Select approach 3',exact:true}).focus();await page.keyboard.press('Enter');
  const state=()=>page.evaluate(()=>{
   const x=StripeMaker.sheets.selected.intersections[0],R=StripeMaker.roundaboutGeometry;
   return {item:structuredClone(x),handle:R.approachSideBezierHandles(x,x.approaches[2],'entry').circle.p,valid:R.validate(x),turns:x.approaches.map(a=>x.approaches.map(b=>R.turnOf(x,a,b)))};
  });
  const before=await state();
  const handle=page.getByRole('button',{name:'Approach 3 entry circle Bézier handle',exact:true});
  await handle.focus();await handle.press('ArrowLeft');await handle.press('ArrowLeft');
  const after=await state();assert.equal(after.valid,'');assert.notDeepEqual(after.item,before.item);assert.deepEqual(after.turns,before.turns);
  assert.ok(after.handle.x<before.handle.x,'a valid skewed curve edit moves the handle');
  await page.locator('#undoButton').click();await page.locator('#undoButton').click();assert.deepEqual((await state()).item,before.item);
  await page.locator('#redoButton').click();await page.locator('#redoButton').click();assert.deepEqual((await state()).item,after.item);
  // Reproduce shortening the west exit with its visible median-corner handle.
  // Its control pulls overlap, but the actual cubic and lanes do not reverse.
  await page.getByRole('button',{name:'Select approach 2',exact:true}).focus();await page.keyboard.press('Enter');
  const start=await state(), k=await page.evaluate(()=>12/StripeMaker.sheets.selected.inchesPerPixel*StripeMaker.sheets.selected.view.scale);
  const corner=page.getByRole('button',{name:'Approach 2 median exit connection corner',exact:true}),box=await corner.boundingBox();
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
  await page.mouse.move(box.x+box.width/2+65*k,box.y+box.height/2+5.4*k);await page.mouse.up();
  const shortened=await state();assert.equal(shortened.valid,'');assert.notDeepEqual(shortened.item,start.item);
  assert.deepEqual(shortened.turns,start.turns);
  await page.locator('#undoButton').click();assert.deepEqual((await state()).item,start.item);
  await page.locator('#redoButton').click();assert.deepEqual((await state()).item,shortened.item);
  const snapshot=await page.evaluate(()=>StripeMaker.projectJSON.snapshot());await page.evaluate(p=>StripeMaker.projectJSON.load(p),snapshot);
  assert.deepEqual((await state()).item,shortened.item);
  assert.deepEqual(errors,[]);console.log('Sarasota skewed Bézier edits, movement meanings, undo/redo and JSON round-trip passed.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
