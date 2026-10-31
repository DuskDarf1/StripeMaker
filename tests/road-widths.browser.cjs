/* Same isolated Chromium setup as intersections.browser.cjs. */
const assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
 try{
 const page=await browser.newPage({viewport:{width:1400,height:1000}}),errors=[];
 page.setDefaultTimeout(10000);
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.env.STRIPEMAKER_URL || pathToFileURL(path.resolve(__dirname,'../index.html')).href);
 const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=1600;c.height=1200;const g=c.getContext('2d');g.fillStyle='#777';g.fillRect(0,0,1600,1200);return c.toDataURL().split(',')[1];});
 await page.locator('#sheetFile').setInputFiles({name:'Width transitions.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
 await page.waitForFunction(()=>StripeMaker.sheets.selected);
 const result=await page.evaluate(()=>{
 const s=StripeMaker.sheets.selected;s.inchesPerPixel=4;
 const road=(id,width,start,end)=>({id,lanes:2,laneWidth:width,ends:[{joint:start,sign:1,length:null},{joint:end,sign:1,length:null}]});
 s.roads=[road(1,10,1,2),road(2,16,2,3)];
 s.joints=[{id:1,x:300,y:700,dir:{x:1,y:0},root:1,links:[]},{id:2,x:800,y:700,dir:{x:1,y:0},root:1,links:[{a:1,ai:0,b:2,bi:0}]},{id:3,x:1300,y:700,dir:{x:1,y:0},root:2,links:[]}];
 StripeMaker.roadEditor.render();StripeMaker.sheets.save(s);StripeMaker.history.record();
 const paths=[...s.roadLayer.querySelectorAll('.roadPavement > .roadBand')].map(p=>{const n=p.getAttribute('d').match(/-?\d*\.?\d+(?:e-?\d+)?/gi).map(Number);return Array.from({length:n.length/2},(_,i)=>({x:n[2*i],y:n[2*i+1]}));});
 const at=(p,x)=>p.filter(v=>Math.abs(v.x-x)<.01).map(v=>v.y).sort((a,b)=>a-b);
 return {left:at(paths[0],800),right:at(paths[1],800),free:at(paths[0],300),wide:at(paths[1],1300),points:paths};
 });
 const span=a=>a.at(-1)-a[0];
 assert(Math.abs(span(result.left)-64)<.01);assert(Math.abs(span(result.right)-100)<.01);
 assert(Math.abs(span(result.free)-64)<.01);assert(Math.abs(span(result.wide)-100)<.01);
 await page.screenshot({path:'/tmp/stripemaker-road-width-transition.png'});
 await page.locator('[data-editor="elementsEditor"]').click();
 assert.equal(await page.locator('#perLaneWidths').isChecked(),false);
 await page.locator('.roadNode[data-road="1"][data-end="1"][data-lane="0"]').click();
 assert.equal(await page.locator('#laneWidthFields').isVisible(),false);
 await page.locator('#perLaneWidths').check();
 await page.locator('#selectedLaneWidth').fill('18');await page.locator('#selectedLaneWidth').blur();
 await page.locator('#laneStartWidth').fill('14');await page.locator('#laneStartWidth').blur();
 await page.locator('#laneEndWidth').fill('20');await page.locator('#laneEndWidth').blur();
 const widths=()=>page.evaluate(()=>{const s=StripeMaker.sheets.selected,r=s.roads[0],w=StripeMaker.roadWidths;return [w.laneAt(s,r,0,0),w.laneAt(s,r,0,.5),w.laneAt(s,r,0,1),w.laneAt(s,r,1,.5),w.endWidth(s,s.roads[1],0,0)];});
 assert.deepEqual(await widths(),[14,18,20,10,16]);
 await page.locator('#perLaneWidths').uncheck();assert.deepEqual(await widths(),[10,10,10,10,16]);
 await page.locator('#undoButton').click();assert.deepEqual(await widths(),[14,18,20,10,16]);
 await page.screenshot({path:'/tmp/stripemaker-per-lane-widths.png'});
 // Let the final undo save replace any earlier in-flight transaction.
 await page.waitForTimeout(600);
 await page.waitForFunction(()=>new Promise(resolve=>{
  const request=indexedDB.open('StripeMaker');request.onsuccess=()=>{
   const db=request.result,get=db.transaction('sheets').objectStore('sheets').get(StripeMaker.sheets.selected.id);
   get.onsuccess=()=>{resolve(get.result?.roads?.[0]?.perLaneWidths && get.result.roads[0].laneEndWidths?.['1:0']===20);db.close();};
  };
 }));
 await page.reload();await page.waitForFunction(()=>StripeMaker.sheets.selected?.roads.length===2);
 assert.deepEqual(await widths(),[14,18,20,10,16]);
 if (!await page.locator('#roadLanes').isVisible()) await page.locator('[data-editor="elementsEditor"]').click();
 assert.equal(await page.locator('#roadLanes').getAttribute('max'),'999');assert.equal(await page.locator('#roadOpposite').getAttribute('max'),'999');
 await page.locator('#roadLanes').fill('999');await page.locator('#roadLanes').blur();
 await page.locator('#addRoad').click();await page.mouse.click(900,650);await page.mouse.click(1100,650);await page.keyboard.press('Escape');
 assert.equal(await page.evaluate(()=>StripeMaker.sheets.selected.roads.at(-1).lanes),999);
 const feed=await page.evaluate(()=>{
  const s=StripeMaker.sheets.selected;
  const road=(id,lanes,width,start,end)=>({id,lanes,laneWidth:width,ends:[{joint:start,sign:1,length:null},{joint:end,sign:1,length:null}]});
  s.roads=[road(1,2,10,1,2),road(2,2,10,2,3),road(3,1,20,4,2)];
  s.joints=[{id:1,x:300,y:700,dir:{x:1,y:0},root:1,links:[]},
   {id:2,x:800,y:700,dir:{x:1,y:0},root:1,links:[{a:1,ai:0,b:2,bi:0},{a:2,ai:1,b:3,bi:0,feed:true}]},
   {id:3,x:1300,y:700,dir:{x:1,y:0},root:2,links:[]},
   {id:4,x:400,y:1000,dir:{x:1,y:0},root:3,links:[]}];
  StripeMaker.roadEditor.render();
  const w=StripeMaker.roadWidths;
  return {widths:[w.endWidth(s,s.roads[0],1,1),w.endWidth(s,s.roads[1],0,1),w.endWidth(s,s.roads[2],1,0),w.laneAt(s,s.roads[2],0,.5)],
   masks:s.roadLayer.querySelectorAll('mask,[mask]').length,
   paths:[...s.roadLayer.querySelectorAll('.roadMarking')].every(p=>!p.getAttribute('d').includes('NaN'))};
 });
 assert.deepEqual(feed.widths,[10,10,10,20]);assert.equal(feed.masks,0);assert(feed.paths);
 await page.screenshot({path:'/tmp/stripemaker-edge-feed-trimmed.png'});
 await page.evaluate(()=>{
  const s=StripeMaker.sheets.selected;
  s.joints.find(j=>j.id===2).links=s.joints.find(j=>j.id===2).links.filter(l=>l.b!==3);
  s.joints.push({id:5,x:650,y:900,dir:{x:1,y:0},root:3,links:[]});
  s.roads[2].ends[1].joint=5;
  StripeMaker.roadEditor.render();
 });
 const moving=await page.locator('.roadNode[data-road="3"][data-end="1"][data-lane="0"]').boundingBox();
 const receiving=await page.locator('.roadNode[data-road="1"][data-end="0"][data-lane="1"]').boundingBox();
 await page.mouse.move(moving.x+moving.width/2,moving.y+moving.height/2);await page.mouse.down();
 await page.mouse.move(receiving.x+receiving.width/2,receiving.y+receiving.height/2,{steps:15});await page.mouse.up();
 assert.deepEqual(await page.evaluate(()=>{
  const s=StripeMaker.sheets.selected,r=s.roads[2],w=StripeMaker.roadWidths;
  return [r.ends[1].joint,s.roads[0].ends[0].joint,w.endWidth(s,r,1,0),w.endWidth(s,s.roads[0],0,1),w.laneAt(s,r,0,.5)];
 }),[1,1,10,10,20]);
 assert.deepEqual(errors,[]);console.log('Independent widths, checkbox, lane/end editing, undo, reload and creating a 999-lane road passed.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
