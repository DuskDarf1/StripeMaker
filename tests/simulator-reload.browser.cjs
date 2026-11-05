/* Isolated file:// reload and storage recovery; never touches a user profile. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const playwright=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const webkit=process.env.BROWSER==='webkit';
 const browser=await playwright[webkit?'webkit':'chromium'].launch({headless:true,...((webkit?process.env.WEBKIT_PATH:process.env.CHROME_PATH)?{executablePath:webkit?process.env.WEBKIT_PATH:process.env.CHROME_PATH}:{})});
 try{
  const page=await browser.newPage({viewport:{width:1400,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  page.setDefaultTimeout(15000);
  const url=process.env.STRIPEMAKER_URL||pathToFileURL(path.resolve(__dirname,'../index.html')).href;
  await page.goto(url);await page.waitForFunction(()=>StripeMaker.sheets.ready);
  await page.click('button[aria-controls="sheetsMenu"]');await page.click('#blankSheet');
  await page.waitForFunction(()=>StripeMaker.sheets.selected);
  const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/simulator-linked-roundabouts.json')));
  await page.evaluate(data=>{
   const A=StripeMaker,s=A.sheets.selected;Object.assign(s,data);s.name='Reload recovery';
   Object.assign(A.sheets.selected,{speedZones:A.sheets.selected.roads.map(road=>({id:'test-speed-'+road.id,road:road.id,from:0,to:1,mph:30}))});A.roadEditor.render();A.sheets.save(s);
  },fixture);
  await page.waitForTimeout(650);
  const durable=await page.evaluate(async()=>{
   const db=await new Promise(resolve=>{const r=indexedDB.open('StripeMaker',1);r.onsuccess=()=>resolve(r.result);});
   const record=await new Promise(resolve=>{const r=db.transaction('files','readonly').objectStore('files').get(StripeMaker.sheets.selected.id);r.onsuccess=()=>resolve(r.result);});db.close();
   return record?.bytes instanceof ArrayBuffer && record.bytes.byteLength>0 && !(record instanceof Blob);
  });
  assert(durable,'background persists as bytes rather than a Safari-fragile Blob/File');
  const expected=await page.evaluate(()=>({id:StripeMaker.sheets.selected.id,roads:StripeMaker.sheets.selected.roads.length,spawns:structuredClone(StripeMaker.sheets.selected.vehicleSpawns)}));
  for(const delay of [0,40,350,800]){
   await page.evaluate(()=>StripeMaker.showEditor('simulatorEditor'));await page.click('#playSimulation');
   if(delay)await page.waitForTimeout(delay);
   await page.reload();await page.waitForFunction(()=>StripeMaker.sheets.ready);
   assert.deepEqual(await page.evaluate(()=>({id:StripeMaker.sheets.selected?.id,roads:StripeMaker.sheets.selected?.roads.length,spawns:StripeMaker.sheets.selected?.vehicleSpawns})),expected);
   assert.equal(await page.evaluate(()=>StripeMaker.simulator.diagnostics().running),false);
  }
  // Reproduce the old failure chain: a failed restore rewrites meta.order,
  // orphaning still-intact sheet records. The blank's thumbnail is expendable.
  await page.evaluate(async()=>{
   const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('StripeMaker',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
   await new Promise((resolve,reject)=>{const t=db.transaction(['meta','files'],'readwrite');t.objectStore('meta').put({order:[],selected:null},'app');t.objectStore('files').put({name:'Blank sheet.png',type:'image/png',lastModified:0,bytes:new ArrayBuffer(0)},StripeMaker.sheets.selected.id);t.oncomplete=resolve;t.onerror=event=>reject(Error(String(event.target.error??t.error)));});db.close();
  });
  await page.reload();await page.waitForFunction(()=>StripeMaker.sheets.ready);
  assert.deepEqual(await page.evaluate(()=>({id:StripeMaker.sheets.selected?.id,roads:StripeMaker.sheets.selected?.roads.length,spawns:StripeMaker.sheets.selected?.vehicleSpawns})),expected,'orphaned drawing survives even with an unreadable blank thumbnail');
  await page.waitForTimeout(650);await page.reload();await page.waitForFunction(()=>StripeMaker.sheets.ready);
  assert.equal(await page.evaluate(()=>StripeMaker.sheets.selected?.roads.length),expected.roads,'repaired project survives another reload');
  // A real background cannot be regenerated. Keep its record/list entry,
  // report the error, reserve its ID, and recover after the source is repaired.
  await page.waitForTimeout(650);
  await page.evaluate(async()=>{
   const db=await new Promise(resolve=>{const r=indexedDB.open('StripeMaker',1);r.onsuccess=()=>resolve(r.result);});
   await new Promise((resolve,reject)=>{const t=db.transaction(['files','sheets'],'readwrite'),store=t.objectStore('sheets'),r=store.get(1);
    r.onsuccess=()=>store.put({...r.result,blank:false},1);
    t.objectStore('files').put({name:'Aerial.png',type:'image/png',lastModified:0,bytes:new ArrayBuffer(0)},1);t.oncomplete=resolve;t.onerror=event=>reject(Error(String(event.target.error??t.error)));});db.close();
  });
  await page.reload();await page.waitForFunction(()=>StripeMaker.sheets.ready);
  assert.equal(await page.evaluate(()=>StripeMaker.sheets.all.length),0);
  assert.match(await page.locator('#sheetStatus').textContent(),/Couldn't restore Reload recovery/);
  assert.deepEqual(await page.evaluate(()=>StripeMaker.sheets.diagnostics().unrestored),[expected.id]);
  await page.click('button[aria-controls="sheetsMenu"]');await page.click('#blankSheet');
  await page.waitForFunction(()=>StripeMaker.sheets.selected);
  assert((await page.evaluate(()=>StripeMaker.sheets.selected.id))>expected.id,'a failed sheet ID cannot be overwritten by a new sheet');
  await page.waitForTimeout(650);
  const stored=await page.evaluate(async()=>{
   const db=await new Promise(resolve=>{const r=indexedDB.open('StripeMaker',1);r.onsuccess=()=>resolve(r.result);});
   const result=await new Promise(resolve=>{const t=db.transaction(['meta','sheets'],'readonly'),r=t.objectStore('meta').get('app'),d=t.objectStore('sheets').get(1);t.oncomplete=()=>resolve({order:r.result.order,roads:d.result.roads.length});});db.close();return result;
  });
  assert(stored.order.includes(expected.id));assert.equal(stored.roads,expected.roads);
  await page.reload();await page.waitForFunction(()=>StripeMaker.sheets.ready);
  assert.match(await page.locator('#sheetStatus').textContent(),/Couldn't restore Reload recovery/,'later successful sheets must not erase the restore error');
  await page.evaluate(async()=>{
   const file=StripeMaker.sheets.selected.file,source={name:file.name,type:file.type,lastModified:file.lastModified,bytes:await file.arrayBuffer()};
   const db=await new Promise(resolve=>{const r=indexedDB.open('StripeMaker',1);r.onsuccess=()=>resolve(r.result);});
   await new Promise((resolve,reject)=>{const t=db.transaction(['files'],'readwrite');t.objectStore('files').put(source,1);t.oncomplete=resolve;t.onerror=event=>reject(Error(String(event.target.error??t.error)));});db.close();
  });
  await page.reload();await page.waitForFunction(()=>StripeMaker.sheets.ready);
  assert.equal(await page.evaluate(()=>StripeMaker.sheets.all.find(s=>s.id===1)?.roads.length),expected.roads);
  assert.deepEqual(await page.evaluate(()=>StripeMaker.sheets.diagnostics().unrestored),[]);
  if(!webkit){
   await page.evaluate(async()=>{
    const source=StripeMaker.sheets.selected.file;
    const db=await new Promise(resolve=>{const r=indexedDB.open('StripeMaker',1);r.onsuccess=()=>resolve(r.result);});
    await new Promise((resolve,reject)=>{const t=db.transaction('files','readwrite');t.objectStore('files').put(source,1);t.oncomplete=resolve;t.onerror=event=>reject(Error(String(event.target.error)));});db.close();
   });
   await page.reload();await page.waitForFunction(()=>StripeMaker.sheets.ready);await page.waitForTimeout(650);
   assert.equal(await page.evaluate(()=>StripeMaker.sheets.all.find(s=>s.id===1)?.roads.length),expected.roads,'legacy File backgrounds still restore');
   assert(await page.evaluate(async()=>{
    const db=await new Promise(resolve=>{const r=indexedDB.open('StripeMaker',1);r.onsuccess=()=>resolve(r.result);});
    const value=await new Promise(resolve=>{const r=db.transaction('files','readonly').objectStore('files').get(1);r.onsuccess=()=>resolve(r.result);});db.close();return value.bytes instanceof ArrayBuffer;
   }),'readable legacy files migrate to durable byte records');
  }
  assert.deepEqual(errors,[]);
  console.log(`PASS ${webkit?'WebKit':'Chromium'} file reloads during simulation and orphaned blank-sheet recovery.`);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
