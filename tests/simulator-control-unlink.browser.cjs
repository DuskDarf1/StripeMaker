const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
const P=require(process.env.PLAYWRIGHT_MODULE||'playwright'),choose=require('./select-choice.cjs');
(async()=>{
 const webkit=process.env.BROWSER==='webkit',executablePath=webkit?process.env.WEBKIT_PATH:process.env.CHROME_PATH;
 const browser=await P[webkit?'webkit':'chromium'].launch({headless:true,...(executablePath?{executablePath}:{})});
 try{
  const page=await browser.newPage({viewport:{width:1400,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(pathToFileURL(path.resolve(__dirname,'../index.html')).href);await page.waitForFunction(()=>StripeMaker.sheets.ready);
  await page.locator('#blankSheet').evaluate(b=>b.click());await page.waitForFunction(()=>StripeMaker.sheets.selected);
  const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/simulator-all-way-stop.json')));
  const ids=await page.evaluate(f=>{const A=StripeMaker,s=A.sheets.selected;Object.assign(s,f.data);s.view={x:120,y:100,scale:.65};A.sheets.zoomBy(1);A.roadEditor.render();A.history.rebase();A.showEditor('simulatorEditor');
   return {road:s.markings.find(m=>m.on.road===11&&m.trafficControl).id,inside:s.markings.find(m=>m.on.intersection&&m.trafficControl).id,intersection:s.intersections[0].id};
  },fixture);
  const open=async id=>{await page.locator(`[data-marking="${id}"].simulatorControl`).focus();await page.keyboard.press('Enter');};
  const state=id=>page.evaluate(id=>{const A=StripeMaker,s=A.sheets.selected;return {saved:s.markings.find(m=>m.id===id).trafficControl,resolved:A.markings.simulatorControls(s).find(c=>c.marking===id)};},id);
  await open(ids.road);assert((await state(ids.road)).resolved.inferred);
  await choose(page.locator('#simulatorControlIntersection'),'none');
  let current=await state(ids.road);assert.deepEqual(current.saved,{type:'stop',unlinked:true});assert.equal(current.resolved.intersection,undefined);assert.equal(current.resolved.type,'stop');
  assert.match(await page.locator('#simulatorControlHint').textContent(),/Automatic linking is disabled/);
  await page.click('#undoButton');await open(ids.road);assert((await state(ids.road)).resolved.inferred);
  await page.click('#redoButton');await open(ids.road);assert((await state(ids.road)).saved.unlinked);
  await choose(page.locator('#simulatorControlIntersection'),'');assert((await state(ids.road)).resolved.inferred,'Automatic restores mouth recognition');
  await choose(page.locator('#simulatorControlIntersection'),'none');
  await choose(page.locator('#simulatorControlIntersection'),ids.intersection);current=await state(ids.road);assert.equal(current.saved.intersection,ids.intersection);assert.equal(current.saved.unlinked,undefined,'manual links clear the override');
  await choose(page.locator('#simulatorControlIntersection'),'none');
  await open(ids.inside);await choose(page.locator('#simulatorControlIntersection'),'none');
  assert.equal((await state(ids.inside)).resolved.intersection,undefined,'override also beats placement on an intersection lane');
  await choose(page.locator('#simulatorControlIntersection'),'');assert.equal((await state(ids.inside)).resolved.intersection,ids.intersection);
  assert.match(await page.locator('#simulatorControlHint').textContent(),/Automatically controls/,'placement-based association is described correctly');
  await choose(page.locator('#simulatorControlIntersection'),'none');
  const portable=await page.evaluate(async()=>{const p=await StripeMaker.projectJSON.snapshot('selected');StripeMaker.projectJSON.validate(p);StripeMaker.sheets.save(StripeMaker.sheets.selected);return p;});
  assert(portable.sheets[0].data.markings.find(m=>m.id===ids.road).trafficControl.unlinked);
  await page.waitForTimeout(800);await page.reload();await page.waitForFunction(()=>StripeMaker.sheets.ready&&StripeMaker.sheets.selected);await page.evaluate(()=>StripeMaker.showEditor('simulatorEditor'));
  for(const id of [ids.road,ids.inside]){current=await state(id);assert(current.saved.unlinked);assert.equal(current.resolved.intersection,undefined);}
  await open(ids.road);assert.equal(await page.locator('#simulatorControlIntersection').inputValue(),'none');
  await page.evaluate(p=>StripeMaker.projectJSON.load(p,{applySettings:false}),portable);await page.evaluate(()=>StripeMaker.showEditor('simulatorEditor'));await open(ids.road);
  assert((await state(ids.road)).saved.unlinked,'project import preserves override');
  await page.click('#playSimulation');assert(await page.locator('#simulatorControlIntersection').isDisabled());await page.click('#pauseSimulation');
  await open(ids.road);await page.locator('#simulatorControlHint').scrollIntoViewIfNeeded();await page.screenshot({path:`/tmp/stripemaker-force-unlink-${webkit?'webkit':'chromium'}.png`});
  assert.deepEqual(errors,[]);console.log('PASS forced unlink, automatic/manual restore, road and intersection controls, undo/redo, reload, JSON import and playback locking');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
