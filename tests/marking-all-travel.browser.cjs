const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const engine=require(process.env.PLAYWRIGHT_MODULE||'playwright')[process.env.BROWSER||'chromium'];
const selectChoice=require('./select-choice.cjs');
(async()=>{
 // WebKit's ephemeral context cannot store Blob/File values in IndexedDB.
 // Use a disposable profile for its project-import check, never the user's.
 const profile=process.env.BROWSER==='webkit'?fs.mkdtempSync(path.join(os.tmpdir(),'stripemaker-marking-test-')):null;
 const options={headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})};
 const browser=profile?await engine.launchPersistentContext(profile,{...options,viewport:{width:1500,height:1100}}):await engine.launch(options);
 try {
  const page=profile?await browser.newPage():await browser.newPage({viewport:{width:1500,height:1100}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(10000);
  await page.goto(process.env.STRIPEMAKER_URL||'http://127.0.0.1:8876');
  await page.waitForFunction(()=>StripeMaker.sheets.ready&&StripeMaker.markings);
  const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=1600;c.height=1200;return c.toDataURL().split(',')[1]});
  await page.locator('#sheetFile').setInputFiles({name:'All travel lanes.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
  await page.waitForFunction(()=>StripeMaker.sheets.selected);
  await page.evaluate(()=>{
   const s=StripeMaker.sheets.selected;s.inchesPerPixel=2;
   s.roads=[{id:1,lanes:5,laneWidth:12,laneTypes:{2:{type:'bufferedBike',width:7},4:{type:'twoWayBike',width:12}},ends:[{joint:1,sign:1,length:null},{joint:2,sign:1,length:null}]}];
   s.joints=[{id:1,x:150,y:800,root:1,links:[]},{id:2,x:1450,y:800,root:1,links:[]}];
   StripeMaker.roadEditor.render();StripeMaker.history.record();document.dispatchEvent(new CustomEvent('sheetchange'));
  });
  const choose=async type=>{await page.locator('#chooseMarking').click();await page.locator('#markingSearch').fill('');await page.locator(`#markingGrid [data-type="${type}"]`).click();};
  const point=lane=>page.evaluate(lane=>{
   const s=StripeMaker.sheets.selected,t=StripeMaker.roadEditor.laneTracks(s)[0],d=(t.bounds[0][lane]+t.bounds[0][lane+1])/2;
   const p=StripeMaker.sheets.toScreen({x:950,y:800+d}),b=document.getElementById('previewStage').getBoundingClientRect();return{x:p.x+b.left,y:p.y+b.top};
  },lane);
  const marks=()=>page.evaluate(()=>structuredClone(StripeMaker.sheets.selected.markings));
  const count=()=>page.locator('.roadLayer .laneMarkings path').count();
  const checkPaint=async()=>assert.equal(await page.evaluate(()=>{
   const s=StripeMaker.sheets.selected,t=StripeMaker.roadEditor.laneTracks(s)[0];
   const b=t.laneBounds[0],vehicles=[[b[0][0],b[1][1]],b[3]].map(bounds=>bounds.map(v=>800+v));
   return [...s.roadLayer.querySelectorAll('.laneMarkings path')].every(path=>{
    const ys=[...path.getAttribute('d').matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map(m=>Number(m[2]));
    return vehicles.some(([l,r])=>Math.min(...ys)>=l-.02&&Math.max(...ys)<=r+.02);
   });
  }),true,'paint stays in vehicle lanes, including either side of a keyhole');
  await page.locator('[data-editor="markingsEditor"]').click();let p=await point(1);
  await page.keyboard.down('Shift');await page.mouse.click(p.x,p.y);await page.keyboard.up('Shift');
  assert.equal(await count(),3);assert.equal((await marks())[0].all,true);await checkPaint();
  for(const [type,width] of [['bike',5],['twoWayBike',12],['bufferedBike',7]]) {
   await page.evaluate(({type,width})=>{const s=StripeMaker.sheets.selected;s.roads[0].laneTypes[2]={type,width};StripeMaker.roadEditor.render();},{type,width});
   assert.equal(await count(),3);await checkPaint();
  }
  await page.locator('#markingAllLanes').uncheck();assert.equal(await count(),1);
  await page.locator('#markingAllLanes').check();assert.equal(await count(),3);
  await page.locator('#undoButton').click();assert.equal(await count(),1);await page.locator('#redoButton').click();assert.equal(await count(),3);
  for(const type of ['stopLine','yieldLine','doNotBlock','speedReduction','speedHump']){
   await choose(type);
   if(type==='stopLine')assert.equal(await count(),4,'vehicle bars plus a separate bar in each bike facility');
   if(type==='yieldLine')assert.equal(await count(),17,'five triangles per vehicle lane and one per bike facility');
   const variants=type==='speedHump'?await page.locator('#markingVariant option').evaluateAll(nodes=>nodes.map(n=>n.value)):[];
   if(variants.length)assert.deepEqual(variants,['humpA','humpB','humpC','tableA','tableB','advance']);
   for(const variant of variants){await selectChoice(page.locator('#markingVariant'),variant);await checkPaint();}
   if(!['stopLine','yieldLine'].includes(type))await checkPaint();
  }
  // Ordinary single-lane placement still permits bike-lane markings.
  await choose('through');await page.locator('.markingHandle').focus();await page.keyboard.press('Escape');
  p=await point(2);await page.mouse.click(p.x,p.y);
  assert.equal((await marks()).length,2);assert.equal((await marks())[1].on.lane,2);assert.ok(!(await marks())[1].all);
  // A manually placed crossing still spans bike lanes, including Shift placement.
  await choose('crosswalk');p=await point(1);p.x-=150;
  await page.keyboard.down('Shift');await page.mouse.click(p.x,p.y);await page.keyboard.up('Shift');
  const crossing=(await marks()).at(-1);assert.equal(crossing.type,'crosswalk');
  assert.ok(Math.hypot(crossing.b.x-crossing.a.x,crossing.b.y-crossing.a.y)>=55*6,'crosswalk includes the bike facilities');
  await page.locator('#markingsLongitudinalTab').click();
  const ends=await page.evaluate(()=>{
   const s=StripeMaker.sheets.selected,t=StripeMaker.roadEditor.laneTracks(s)[0],r=document.getElementById('previewStage').getBoundingClientRect();
   return [0,5].map((k,i)=>{const p=StripeMaker.sheets.toScreen({x:850+i*250,y:800+t.bounds[0][k]});return{x:r.left+p.x,y:r.top+p.y};});
  });
  await page.keyboard.down('Shift');await page.mouse.move(ends[0].x,ends[0].y);await page.mouse.down();
  await page.mouse.move(ends[1].x,ends[1].y,{steps:6});await page.mouse.up();await page.keyboard.up('Shift');
  assert.deepEqual(await page.evaluate(()=>StripeMaker.sheets.selected.lines.map(l=>l.on.k)),[0,1,2,3,4],'shared travel edges remain; the bike-only outer edge is skipped');
  // Persisted all-lane markings use the same exclusions after import.
  const snapshot=await page.evaluate(()=>StripeMaker.projectJSON.snapshot());
  const imported=await page.evaluate(async s=>{
   try {await StripeMaker.projectJSON.load(s);return {ok:true};}
   catch(error){return {ok:false,name:error?.name,message:error?.message,value:String(error)};}
  },snapshot);
  assert.deepEqual(imported,{ok:true},'saved project imports');
  assert.equal((await marks()).length,3);
  assert.deepEqual(errors,[]);console.log('All-lane symbols, bars, areas and hump variants skip bike facilities; single-lane markings and full crosswalks remain available.');
 }finally{await browser.close();if(profile)fs.rmSync(profile,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exit(1);});
