const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH});try{
 const page=await browser.newPage({viewport:{width:1500,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.env.STRIPEMAKER_URL||'http://127.0.0.1:8878');await page.waitForFunction(()=>StripeMaker.sheets.ready);
 await page.click('button[aria-controls="sheetsMenu"]');await page.click('#blankSheet');await page.waitForFunction(()=>StripeMaker.sheets.selected);
 for(const direct of [false,true])for(const startOnEdge of [false,true])for(const side of ["L","R"]){
  await page.keyboard.press('Escape');
  await page.evaluate(()=>{
   const s=StripeMaker.sheets.selected;s.inchesPerPixel=2;s.view={scale:1,x:0,y:0,fitted:false};
   s.roads=[{id:1,lanes:1,laneWidth:12,ends:[{joint:1,sign:1,length:null},{joint:2,sign:1,length:null}]}];
   s.joints=[{id:1,x:450,y:400,root:1,dir:{x:1,y:0},links:[]},{id:2,x:1250,y:400,root:1,dir:{x:1,y:0},links:[]}];
   s.intersections=[];s.medians=[];StripeMaker.showEditor('elementsEditor');StripeMaker.roadEditor.render();StripeMaker.history.rebase();
  });
  await page.locator('#roadLanes').fill('1');await page.locator('#roadLanes').press('Tab');
  await page.click('#addRoad');
  const edge={x:850,y:side==="R"?436:364},free={x:startOnEdge?1150:550,y:side==="R"?650:150};
  const client=async p=>page.evaluate(p=>{const b=document.getElementById('previewStage').getBoundingClientRect();return {x:p.x+b.left,y:p.y+b.top};},p);
  const first=await client(startOnEdge?edge:free),last=await client(startOnEdge?free:edge);
  if(!startOnEdge)await page.mouse.click(first.x,first.y);
  const target=startOnEdge?first:last;
  await page.mouse.move(target.x,target.y);
  if(direct){
   await page.keyboard.down('Shift');
   await page.waitForFunction(()=>document.getElementById('elementsHint')?.textContent.includes('Direct lane connection')||[...document.querySelectorAll('.elementsHint')].some(e=>e.textContent.includes('Direct lane connection')));
  }
  if(direct){
   await page.keyboard.up('Shift');
   assert(await page.locator('#elementsEditor').textContent().then(t=>t.includes('Hold Shift to connect directly')));
   await page.keyboard.down('Shift');
  }
  await page.mouse.click(target.x,target.y);
  if(direct)await page.keyboard.up('Shift');
  if(startOnEdge)await page.mouse.click(last.x,last.y);
  await page.keyboard.press('Escape');
  const state=await page.evaluate(()=>{const s=StripeMaker.sheets.selected;return {roads:s.roads,links:s.joints.flatMap(j=>j.links)};});
  assert.equal(state.roads.length,3);
  const link=state.links.find(l=>l.b===2);assert(link);
  if(direct){assert.equal(link.feed,true);assert.equal(typeof link.ai,'number');assert.equal(typeof link.bi,'number');}
  else {assert.equal(typeof link.ai,'string');assert.equal(typeof link.bi,'string');assert(!link.feed);}
  await page.click('#undoButton');assert.equal(await page.evaluate(()=>StripeMaker.sheets.selected.roads.length),1);
  await page.click('#redoButton');assert.equal(await page.evaluate(()=>StripeMaker.sheets.selected.roads.length),3);
 }
 assert.deepEqual(errors,[]);console.log('PASS: Shift drawing feeds directly at either end; normal edge drawing stays beside; undo/redo.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
