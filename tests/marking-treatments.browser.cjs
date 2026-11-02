const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const selectChoice=require('./select-choice.cjs');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
 try {
  const page=await browser.newPage({viewport:{width:1500,height:1100}}),errors=[];page.setDefaultTimeout(10000);
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.STRIPEMAKER_URL||'http://127.0.0.1:8876');await page.waitForFunction(()=>StripeMaker.sheets.ready&&StripeMaker.markings);
  const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=1600;c.height=1200;return c.toDataURL().split(',')[1]});
  await page.locator('#sheetFile').setInputFiles({name:'Marking treatments.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
  await page.waitForFunction(()=>StripeMaker.sheets.selected);
  await page.evaluate(()=>{
   const s=StripeMaker.sheets.selected;s.inchesPerPixel=2;
   s.roads=[{id:1,lanes:3,laneWidth:12,ends:[{joint:1,sign:1,length:null},{joint:2,sign:1,length:300}]}];
   s.joints=[{id:1,x:150,y:700,dir:{x:1,y:0},root:1,links:[]},{id:2,x:1450,y:400,dir:{x:0,y:-1},root:1,links:[]}];
   StripeMaker.roadEditor.render();StripeMaker.sheets.save(s);StripeMaker.history.record();document.dispatchEvent(new CustomEvent('sheetchange'));
  });
  await page.locator('[data-editor="markingsEditor"]').click();
  const state=()=>page.evaluate(()=>structuredClone(StripeMaker.sheets.selected.markings??[]));
  const point=()=>page.evaluate(()=>{
   const s=StripeMaker.sheets.selected,t=StripeMaker.roadEditor.laneTracks(s)[0],i=Math.floor(t.line.length*0.65),p=t.line[i];
   const c=(t.bounds[i][1]+t.bounds[i][2])/2,prev=t.line[i-1],d=Math.hypot(p.x-prev.x,p.y-prev.y),n={x:-(p.y-prev.y)/d,y:(p.x-prev.x)/d};
   const b=document.getElementById('previewStage').getBoundingClientRect(),q=StripeMaker.sheets.toScreen({x:p.x+n.x*c,y:p.y+n.y*c});return {x:b.left+q.x,y:b.top+q.y};
  });
  const choose=async type=>{await page.locator('#chooseMarking').click();await page.locator('#markingSearch').fill('');await page.locator(`#markingGrid [data-type="${type}"]`).click();};
  const paths=()=>page.evaluate(()=>StripeMaker.sheets.selected.roadLayer.querySelectorAll('.laneMarkings path').length);
  let p=await point();await page.keyboard.down('Shift');await page.mouse.move(p.x,p.y);await page.mouse.click(p.x,p.y);await page.keyboard.up('Shift');
  assert.equal((await state())[0].all,true);assert.equal(await paths(),3,'one arrow in each curved lane');
  await page.locator('#undoButton').click();assert.equal((await state()).length,0);await page.locator('#redoButton').click();assert.equal(await paths(),3);
  await page.mouse.click(p.x,p.y);await choose('word');await page.locator('#markingText').fill('ONLY');await page.waitForFunction(()=>StripeMaker.sheets.selected.roadLayer.querySelectorAll('.laneMarkings path').length===12);assert.equal(await paths(),12,'four letters per lane');
  for(const type of ['doNotBlock','speedReduction','speedHump']) {
   await choose(type);assert.equal(await page.locator('#markingAllLanes').isChecked(),true);
   if(type==='speedReduction') {await page.locator('#markingTickCount').fill('8');assert.equal((await state())[0].count,8);await page.waitForFunction(()=>StripeMaker.sheets.selected.roadLayer.querySelectorAll('.laneMarkings path').length===24);assert.equal(await paths(),24);}
   else {
    const variants=await page.locator('#markingVariant option').evaluateAll(o=>o.map(x=>x.value));
    for(const variant of variants) {await selectChoice(page.locator('#markingVariant'),variant);assert.equal((await state())[0].variant??variants[0],variant);assert.ok(await paths()>0);}
   }
  }
  // Leave a compact pattern before placing the separate crossing upstream;
  // the advance-warning option occupies a full 100-foot selection region.
  await selectChoice(page.locator('#markingVariant'),'humpA');
  await choose('crosswalk');await page.locator('#markingAesthetic').check();await selectChoice(page.locator('#markingVariant'),'lattice');await selectChoice(page.locator('#markingAestheticTone'),'tan');
  // Changing between a lane marking and crosswalk deselects the old marking.
  p=await point();p.x-=160;await page.keyboard.down('Shift');await page.mouse.move(p.x,p.y);await page.mouse.click(p.x,p.y);await page.keyboard.up('Shift');
  let marks=await state();assert.equal(marks.length,2);assert.equal(marks[1].type,'crosswalk');assert.equal(marks[1].aesthetic,true);assert.equal(marks[1].variant,'lattice');assert.equal(marks[1].tone,'tan');
  assert.ok(Math.hypot(marks[1].b.x-marks[1].a.x,marks[1].b.y-marks[1].a.y)>200,'Shift crosswalk spans three lanes');
  await page.locator('#undoButton').click();assert.equal((await state()).length,1);await page.locator('#redoButton').click();
  // The treatment edits an existing crossing, including special-emphasis bars.
  await page.mouse.dblclick(p.x,p.y);
  await page.locator('#markingAesthetic').uncheck();assert.equal((await state())[1].aesthetic,false);
  await page.locator('#markingAesthetic').check();
  await choose('crosswalk');await page.locator('#markingEnhanced').check();assert.equal((await state())[1].aesthetic,true);assert.equal((await state())[1].enhanced,true);
  await selectChoice(page.locator('#markingAestheticTone'),'custom');
  await page.locator('#markingAestheticColor').fill('#346b85');await page.locator('#markingAestheticColor').dispatchEvent('change');
  await page.waitForTimeout(200); // let the palette's closing transition finish for the visual check
  await page.screenshot({path:'/private/tmp/stripemaker-crosswalk-custom-color.png'});
  marks=await state();assert.equal(marks[1].aestheticColor,'#346b85');assert.equal(marks[1].tone,'custom');
  await page.waitForFunction(()=>StripeMaker.sheets.selected.roadLayer.querySelector('.laneMarkings [fill="#346b85"]'));
  assert.equal(await page.evaluate(()=>{
   const app=StripeMaker,s=app.sheets.selected,m=s.markings[1];
   const decorated=JSON.stringify(app.markings.crosswalkCuts(s));
   m.aesthetic=false;const plain=JSON.stringify(app.markings.crosswalkCuts(s));m.aesthetic=true;
   return decorated===plain;
  }),true,'surface treatment does not change longitudinal stripe cutouts');
  await page.locator('#undoButton').click();assert.notEqual((await state())[1].aestheticColor,'#346b85');
  await page.locator('#redoButton').click();assert.deepEqual(await state(),marks);
  const snap=await page.evaluate(()=>StripeMaker.projectJSON.snapshot());await page.evaluate(p=>StripeMaker.projectJSON.load(p),snap);assert.deepEqual(await state(),marks);
  await page.screenshot({path:'/private/tmp/stripemaker-treatment-editor.png'});
  await page.locator('[data-editor="downloadMenu"]').click();await page.locator('[data-format="pdf"]').click();
  const download=page.waitForEvent('download');await page.locator('#downloadSheet').click();await (await download).saveAs('/private/tmp/stripemaker-treatments.pdf');
  await page.reload();await page.waitForFunction(()=>StripeMaker.sheets.selected?.markings?.length===2);assert.deepEqual(await state(),marks);
  const counts=await page.evaluate(f=>{
   const app=StripeMaker,s=app.sheets.selected,R=app.roundaboutGeometry,C=app.markingCatalog;
   s.roads=[];s.joints=[];const x=R.normalize(f);x.x=800;x.y=600;s.intersections=[x];
   const t=app.intersections.laneTracks(s).find(t=>t.on.approach==='circulatory'),k=12/s.inchesPerPixel;
   const active=b=>b.filter(([l,r])=>r-l>=0.5*k).length;
   const index=t.bounds.findIndex((b,i)=>i>20 && i<t.line.length-20 && active(b)>0 && active(b)<t.lanes.length);
   if(index<0)throw Error('Fixture must contain a reduced-lane circulating section');
   const length=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);let total=0,station=0;
   for(let i=1;i<t.line.length;i++){total+=length(t.line[i],t.line[i-1]);if(i===index)station=total;}
   const lane=t.bounds[index].findIndex(([l,r])=>r-l>=0.5*k);
   s.markings=[{id:'all-circle',type:'through',all:true,on:{...t.on,lane:t.lanes[lane]},back:(total-station)/k-C.build({type:'through'}).length/2}];
   app.roadEditor.render();return {expected:active(t.bounds[index]),actual:s.roadLayer.querySelectorAll('.laneMarkings path').length};
  },require('./fixtures/roundabout-lane-add-spiral.json'));
  assert.equal(counts.actual,counts.expected,'all-lane arrows omit a vanished spiral lane');
  assert.deepEqual(errors,[]);console.log('Crosswalk toggle/custom color, treatment dropdowns, Shift arrows/words/patterns/crosswalks, undo/redo and JSON persistence passed.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
