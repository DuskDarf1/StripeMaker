const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
 try {
  const page=await browser.newPage({viewport:{width:1400,height:1000}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.STRIPEMAKER_URL||'http://127.0.0.1:8878');
  await page.click('button[aria-controls="sheetsMenu"]');await page.click('#blankSheet');
  await page.waitForFunction(()=>StripeMaker.sheets.selected);
  for(const targetLane of [1,2]) {
   await page.evaluate(()=>{
    const s=StripeMaker.sheets.selected;s.inchesPerPixel=2;s.autoTapers=false;
    s.roads=[
     {id:1,lanes:4,laneWidth:12,laneTypes:{3:{type:'bufferedBike',width:7}},ends:[{joint:1,sign:1,length:null},{joint:2,sign:1,length:null}]},
     {id:2,lanes:3,laneWidth:12,laneTypes:{2:{type:'bufferedBike',width:7}},ends:[{joint:2,sign:1,length:null},{joint:3,sign:1,length:null}]},
     {id:3,lanes:1,laneWidth:12,ends:[{joint:5,sign:1,length:300},{joint:4,sign:1,length:null}]}
    ];
    s.joints=[
     {id:1,x:15000,y:16000,dir:{x:0,y:-1},root:1,links:[]},
     {id:2,x:15000,y:15000,dir:{x:0,y:-1},root:1,links:[{a:1,ai:0,b:2,bi:0},{a:1,ai:1,b:2,bi:1},{a:1,ai:3,b:2,bi:2}]},
     {id:3,x:15000,y:13000,dir:{x:0,y:-1},root:2,links:[]},
     {id:4,x:16500,y:13500,dir:{x:.7,y:-.7},root:3,links:[]},
     {id:5,x:15600,y:15200,dir:{x:0,y:-1},root:3,links:[]}
    ];
    s.view={...s.view,x:-6800,y:-7000,scale:.5,fitted:false};
    document.dispatchEvent(new Event('sheetchange'));
    StripeMaker.roadEditor.focusRoad(s.roads[2]);StripeMaker.history.rebase();
   });
   const moving=page.locator('.roadNode[data-road="3"][data-end="0"][data-lane="0"]');
   const target=page.locator(`.roadNode[data-road="2"][data-end="0"][data-lane="${targetLane}"]`);
   const a=await moving.boundingBox(),b=await target.boundingBox();
   assert(a&&b);
   await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();
   await page.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:12});await page.mouse.up();
   const state=()=>page.evaluate(()=>{
    const s=StripeMaker.sheets.selected,r=s.roads.find(r=>r.id===3),joint=s.joints.find(j=>j.id===r.ends[0].joint);
    return {joint:joint.id,links:joint.links};
   });
   const result=await state();
   assert.equal(result.joint,2);
   assert(result.links.some(l=>l.a===1&&l.ai===targetLane&&l.b===3&&l.bi===0),'ramp feeds from the incoming vehicle lane: '+JSON.stringify(result));
   assert(result.links.some(l=>l.a===1&&l.ai===3&&l.b===2&&l.bi===2),'bike continuation preserved');
   assert(!result.links.some(l=>l.a===2&&l.b===3),'no invalid start-to-start link');
   await page.click('#undoButton');assert.equal((await state()).joint,5);
   await page.click('#redoButton');assert.equal((await state()).joint,2);
  }
  assert.deepEqual(errors,[]);
  console.log('PASS: ramp start dragged onto connected through/start and bike/start nodes, vehicle feed, bike continuation, undo/redo.');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
