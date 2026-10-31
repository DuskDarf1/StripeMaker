const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH});try{
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/js/markings.js',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text()).replace('app.markings = {','app.markings = { auditLayout: (s,m)=>{tracks=collect(s);return layout(s,m);}, ')});});
 await page.goto(process.env.STRIPEMAKER_URL||'http://127.0.0.1:8878');await page.waitForFunction(()=>StripeMaker.sheets.ready);
 await page.click('button[aria-controls="sheetsMenu"]');await page.click('#blankSheet');await page.waitForFunction(()=>StripeMaker.sheets.selected);
 for(const type of ['bike','bufferedBike'])for(const linked of [false,true]){
 const result=await page.evaluate(({type,linked})=>{
  const s=StripeMaker.sheets.selected,G=StripeMaker.intersectionGeometry;s.inchesPerPixel=2;s.intersections=[];
  const w=type==='bike'?5:7;
  const road=(id,a,b)=>({id,lanes:2,laneWidth:12,laneTypes:{1:{type,width:w}},ends:[{joint:a,sign:1,length:null},{joint:b,sign:1,length:null}]});
  s.roads=[road(1,1,2),road(2,3,4)];
  s.joints=[{id:1,x:15000,y:16000,root:1},{id:2,x:15000,y:15200,root:1},{id:3,x:15000,y:14800,root:2},{id:4,x:15000,y:14000,root:2}].map(j=>({...j,dir:{x:0,y:-1},links:[]}));
  const item=StripeMaker.intersections.makeAt(s,{x:15000,y:15000},[2,3]);StripeMaker.roadEditor.render();
  const a=item.approaches.find(a=>a.incoming),b=item.approaches.find(a=>a.outgoing);
  if(linked)for(const [approach,road,e] of [[a,1,1],[b,2,0]]){delete approach.binding;approach.links=(e?approach.inLanes:approach.outLanes).map((to,lane)=>({road,e,lane,to}));}
  StripeMaker.roadEditor.render();
  const m={id:'bike-movement',from:a.id,to:b.id,input:a.inLanes[1],output:b.outLanes[1],pullIn:30,pullOut:30};item.movements=[m];
  const curve=G.curve(item,m),tracks=StripeMaker.roadEditor.laneTracks(s);
  const misses=[];
  for(const [approach,road,e,incoming] of [[a,1,1,true],[b,2,0,false]]){
   const t=tracks.find(t=>t.road===road),i=e?t.line.length-1:0,p=t.line[i];
   for(const lane of [0,1]){
    const d=(t.laneBounds[i][lane][0]+t.laneBounds[i][lane][1])/2,q=G.lane(approach,incoming,lane);
    misses.push(Math.hypot(p.x-p.tangent.y*d-item.x-q.x*6,p.y+p.tangent.x*d-item.y-q.y*6));
   }
  }
  const markerChecks=[];
  for(const [approach,road,incoming] of [[a,1,true],[b,2,false]]){
   const target=G.ridingLane(approach,incoming,1),x=item.x+target.x*6;
   for(const on of [{road,lane:1},{intersection:item.id,approach:approach.id,incoming,lane:(incoming?approach.inLanes:approach.outLanes)[1]}]){
    const mark={type:'bikeArrow',on,back:on.road?30:0};
    const placed=StripeMaker.markings.auditLayout(s,mark);
    markerChecks.push(Math.abs(placed.copies[0].center.x-x));
   }
  }
  const shift=G.length(G.sub(curve[0],G.lane(a,true,1)));
  StripeMaker.roadEditor.render();
  return {markerChecks,misses,widths:[G.width(a,true,0),G.width(a,true,1),G.width(b,false,1)],shift,curve,expected:[G.ridingLane(a,true,1),G.ridingLane(b,false,1)]};
 },{type,linked});
 assert(result.markerChecks.every(d=>d<.01),'lateral marking centers: '+JSON.stringify(result));
 assert(result.misses.every(d=>d<.01),JSON.stringify(result));
 assert.deepEqual(result.widths,[12,type==='bike'?5:7,type==='bike'?5:7]);
 assert(Math.abs(result.shift-(type==='bike'?0:14/24))<1e-8);
 assert.deepEqual(result.curve[0],result.expected[0]);assert.deepEqual(result.curve[3],result.expected[1]);
 }
 assert.deepEqual(errors,[]);console.log('PASS: bike approaches use actual lane widths; buffered movements center in riding space.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
