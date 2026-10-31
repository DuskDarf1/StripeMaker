const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
 try{
 const page=await browser.newPage({viewport:{width:1000,height:1100}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/js/elements.js',async route=>{const r=await route.fetch();const body=(await r.text()).replace('window.StripeMaker.roadEditor = {',`window.StripeMaker.roadEditor = { auditDrop: s=>{const solved=solve(s),from=s.roads[0],to=s.roads[1],ramp=s.roads[2];
 const a=shapeOf(s,from,solved),b=shapeOf(s,ramp,solved),through=shapeOf(s,to,solved);
 const p=boundary(through,to.lanes)[0],q=boundary(b,0)[0],outer=boundary(a,from.lanes).at(-1),r=boundary(b,ramp.lanes)[0];
 const n=lanePoint(s,from,1,from.lanes-2,solved),m=lanePoint(s,ramp,0,0,solved);
 return {bikeRampGap:Math.hypot(p.x-q.x,p.y-q.y),outsideGap:Math.hypot(outer.x-r.x,outer.y-r.y),nodeGap:Math.hypot(n.x-m.x,n.y-m.y),transitions:bikeTransitions(s,solved).map(t=>({gapStart:t.gapStart,total:t.total}))};},`);await route.fulfill({response:r,body});});
 await page.goto(process.env.STRIPEMAKER_URL||'http://127.0.0.1:8878');await page.waitForFunction(()=>StripeMaker.sheets.ready&&StripeMaker.projectJSON);
 const project=JSON.parse(fs.readFileSync('examples/bike-lane-lab/Bike Lane Inspection Library.json'));
 for(const num of [9,10,13,14,33,34]){
  const sheet=structuredClone(project.sheets.find(s=>s.data.name.startsWith(String(num).padStart(2,'0')+' ')));
  delete sheet.source;
  const p={format:project.format,version:1,selectedSheet:sheet.id,sheets:[sheet]};
  const result=await page.evaluate(async p=>{const [s]=await StripeMaker.projectJSON.load(p);return StripeMaker.roadEditor.auditDrop(s);},p);
  assert(result.bikeRampGap<.05,JSON.stringify(result));assert(result.outsideGap<.05,JSON.stringify(result));assert(result.nodeGap<.05,JSON.stringify(result));
  for(const root of [1,2,3])for(const reverse of [false,true]){
   const variant=structuredClone(p);variant.sheets[0].data.joints.find(j=>j.id===2).root=root;
   if(reverse)for(const j of variant.sheets[0].data.joints)for(const l of j.links){[l.a,l.b]=[l.b,l.a];[l.ai,l.bi]=[l.bi,l.ai];}
   const checked=await page.evaluate(async p=>{const [s]=await StripeMaker.projectJSON.load(p);return StripeMaker.roadEditor.auditDrop(s);},variant);
   assert(checked.bikeRampGap<.05&&checked.outsideGap<.05&&checked.nodeGap<.05,JSON.stringify({num,root,reverse,checked}));
  }
  if(num===10){await page.evaluate(()=>{const s=StripeMaker.sheets.selected;const svg=s.roadLayer.cloneNode(true);svg.id='dropPreview';svg.setAttribute('viewBox','600 950 210 550');svg.style.cssText='position:fixed;left:0;top:0;width:420px;height:1100px;z-index:9999;background:#f4f6f9';document.body.append(svg);});await page.locator('#dropPreview').screenshot({path:'/tmp/bike-drop-continuity-fixed.png'});await page.locator('#dropPreview').evaluate(e=>e.remove());}
 }
 assert.deepEqual(errors,[]);console.log('PASS: drop ramp meets relocated bike boundary, continuous outside pavement edge, vehicle node meets ramp center.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
