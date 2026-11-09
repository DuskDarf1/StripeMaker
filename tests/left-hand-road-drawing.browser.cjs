const assert=require('node:assert/strict'),path=require('node:path'),{pathToFileURL}=require('node:url'),choose=require('./select-choice.cjs');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const near=(a,b)=>assert.ok(Math.hypot(a.x-b.x,a.y-b.y)<1e-6,`${JSON.stringify(a)} should meet ${JSON.stringify(b)}`);
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
 try{
  const page=await browser.newPage({viewport:{width:1800,height:1100}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.STRIPEMAKER_URL||pathToFileURL(path.resolve(__dirname,'../index.html')).href);
  await page.waitForFunction(()=>StripeMaker.sheets.ready);await page.locator('#blankSheet').evaluate(b=>b.click());await page.waitForFunction(()=>StripeMaker.sheets.selected);
  const reset=async(left,host=false)=>{
   await page.keyboard.press('Escape');
   await page.evaluate(({left,host})=>{
    const A=StripeMaker,s=A.sheets.selected;A.settings.set('leftHandTraffic',left);
    s.inchesPerPixel=4;s.autoTapers=false;s.intersections=[];s.medians=[];s.gores=[];s.markings=[];s.lines=[];s.bridges=[];s.surfaces=[];
    s.roads=host?[{id:1,lanes:1,laneWidth:12,ends:[{joint:1,sign:1,length:null},{joint:2,sign:1,length:null}]}]:[];
    s.joints=host?[{id:1,x:900,y:400,root:1,dir:{x:1,y:0},links:[]},{id:2,x:1200,y:400,root:1,dir:{x:1,y:0},links:[]}]:[];
    s.view={scale:1,x:0,y:0};A.sheets.zoomBy(1);A.roadEditor.focusRoad(null);
   },{left,host});
   await page.locator('#roadLanes').fill('1');await page.locator('#roadLanes').blur();
   await page.locator('#roadOpposite').fill('0');await page.locator('#roadOpposite').blur();
   await page.evaluate(()=>StripeMaker.history.rebase());
  };
  const click=async p=>{const at=await page.evaluate(p=>{const q=StripeMaker.sheets.toScreen(p),r=document.getElementById('previewStage').getBoundingClientRect();return{x:q.x+r.left,y:q.y+r.top}},p);await page.mouse.click(at.x,at.y);};
  const add=async()=>{await choose(page.locator('#elementToAdd'),'road');await page.locator('#addElement').click();};
  const read=()=>page.evaluate(()=>{
   const A=StripeMaker,s=A.sheets.selected,net=A.roadEditor.simulatorNetwork(s),solved=A.roadEditor.solve(s);
   return {roads:s.roads,joints:s.joints,tracks:A.roadEditor.laneTracks(s).map(t=>({road:t.road,line:A.traffic.path(t.line),laneStart:A.roadEditor.lanePoint(s,s.roads.find(r=>r.id===t.road),A.traffic.reversed?1:0,0,solved)})),
    connections:net.connections.map(c=>A.traffic.reversed?{from:c.to,to:c.from}:c)};
  });
  const joined=(s,from,to)=>assert.ok(s.connections.some(c=>c.from.road===from&&c.to.road===to),`visible traffic must connect road ${from} to ${to}`);
  for(const left of [false,true])for(const twoWay of [false,true]){
   await reset(left);if(twoWay){await page.locator('#roadOpposite').fill('1');await page.locator('#roadOpposite').blur();}
   await add();const first={x:700,y:350},second={x:1050,y:350},third={x:1300,y:550};
   await click(first);await click(second);
   assert.equal(await page.locator('#addRoad').getAttribute('aria-pressed'),'true','left-hand drawing continues after each click');
   await click(third);await page.keyboard.press('Escape');
   const s=await read(),ids=twoWay?[1,3]:[1,2];assert.equal(s.roads.length,twoWay?4:2);joined(s,...ids);
   for(const [i,id]of ids.entries()){
    const r=s.roads.find(r=>r.id===id),a=s.joints.find(j=>j.id===r.ends[left?1:0].joint),b=s.joints.find(j=>j.id===r.ends[left?0:1].joint);
    near(a,i?second:first);near(b,i?third:second);
    const track=s.tracks.find(t=>t.road===id).line;assert.ok(track.at(-1).x>track[0].x,'displayed traffic follows the drawing clicks');
   }
   if(twoWay){const y=s.tracks.find(t=>t.road===1).laneStart.y;assert.ok((y-first.y)*(left?-1:1)>0,'primary lanes use the correct physical side of the two-way centerline');}
   await page.locator('#undoButton').click();assert.equal((await read()).roads.length,twoWay?2:1);
   await page.locator('#redoButton').click();assert.deepEqual((await read()).roads,s.roads);
  }
  for(const left of [false,true])for(const menu of [false,true]){
   await reset(left,true);
   const e=left?0:1,at={x:left?900:1200,y:400},next={x:left?700:1400,y:550},last={x:left?550:1550,y:650};
   if(menu){
    await page.locator(`.roadNode[data-road="1"][data-end="${e}"]`).click({button:'right'});
    await page.getByRole('menuitem',{name:'Continue Road From Here',exact:true}).click();
   }else{await add();await click(at);}
   await click(next);await click(last);await page.keyboard.press('Escape');
   const s=await read();assert.equal(s.roads.length,3);joined(s,1,2);joined(s,2,3);
   near(s.tracks.find(t=>t.road===2).line[0],at);near(s.tracks.find(t=>t.road===3).line.at(-1),last);
  }
  for(const left of [false,true]){
   await reset(left,true);const e=left?1:0,at={x:left?1200:900,y:400},free={x:left?1400:700,y:550};
   await page.locator(`.roadNode[data-road="1"][data-end="${e}"]`).click({button:'right'});
   await page.getByRole('menuitem',{name:'Draw Road Into Here',exact:true}).click();await click(free);
   const s=await read();assert.equal(s.roads.length,2);joined(s,2,1);
   const line=s.tracks.find(t=>t.road===2).line;near(line[0],free);near(line.at(-1),at);
   assert.equal(await page.locator('#addRoad').getAttribute('aria-pressed'),'false','drawing into an existing start finishes normally');
  }
  for(const left of [false,true])for(const fromIntersection of [false,true]){
   await reset(left);
   const target=await page.evaluate(({left,fromIntersection})=>{
    const A=StripeMaker,s=A.sheets.selected,G=A.intersectionGeometry,x=G.create();Object.assign(x,{x:1200,y:500});G.normalize(x);s.intersections=[x];A.roadEditor.render();
    const a=x.approaches.find(a=>a.angle===180),incoming=fromIntersection?left:!left,p=G.add(x,G.mul(G.lane(a,incoming,0),3));
    return {point:p,lane:(incoming?a.inLanes:a.outLanes)[0],end:incoming?1:0};
   },{left,fromIntersection});
   const free={x:700,y:target.point.y+100};await add();await click(fromIntersection?target.point:free);await click(fromIntersection?free:target.point);await page.keyboard.press('Escape');
   const link=await page.evaluate(()=>StripeMaker.sheets.selected.intersections[0].approaches.flatMap(a=>a.links??[]));
   assert.deepEqual(link,[{road:1,e:target.end,lane:0,to:target.lane}],'road attaches to the visibly matching intersection lane');
   const s=await read(),line=s.tracks[0].line;near(line[fromIntersection?0:line.length-1],target.point);
  }
  // Drawing changes only new canonical records; switching traffic never rewrites
  // the geometry, and old version-1 readers retain the same road graph.
  const before=await read(),saved=await page.evaluate(async()=>{const p=await StripeMaker.projectJSON.snapshot('all');StripeMaker.projectJSON.validate(p);return p});
  assert.equal(saved.version,1);assert.equal(saved.settings.leftHandTraffic,true);
  await page.evaluate(()=>StripeMaker.settings.set('leftHandTraffic',false));assert.deepEqual((await read()).roads,before.roads);assert.deepEqual((await read()).joints,before.joints);
  await page.evaluate(()=>StripeMaker.settings.set('leftHandTraffic',true));
  await page.evaluate(async p=>StripeMaker.projectJSON.load(p),saved);assert.deepEqual((await read()).roads,before.roads);
  await page.waitForTimeout(650);await page.reload();await page.waitForFunction(()=>StripeMaker.sheets.selected?.roads.length===1);
  assert.deepEqual((await read()).roads,before.roads);assert.equal(await page.locator('#leftHandTraffic').isChecked(),true);
  assert.deepEqual(errors,[]);
  console.log('PASS: left/right-hand click order, continuous one/two-way roads, lane-node and context-menu continuations, drawing into roads, intersection mouths, undo/redo and version-1 JSON/reload.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
