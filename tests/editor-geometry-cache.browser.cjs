// Regression for render-local boundary reuse: placement must be identical to
// fresh geometry after edits, with at most one boundary query per collection.
const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
 try {
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.STRIPEMAKER_URL||'http://127.0.0.1:8876');
  await page.waitForFunction(()=>StripeMaker.sheets.ready&&StripeMaker.roadEditor&&StripeMaker.markings);
  await page.locator('#blankSheet').evaluate(b=>b.click());await page.waitForFunction(()=>StripeMaker.sheets.selected);
  const checks=await page.evaluate(()=>{
   const A=StripeMaker,s=A.sheets.selected;
   s.inchesPerPixel=2;s.roads=[{id:1,lanes:2,laneWidth:12,ends:[{joint:1,sign:1},{joint:2,sign:1}]}];
   s.joints=[{id:1,x:100,y:500,links:[]},{id:2,x:1500,y:500,links:[]}];
   s.markings=Array.from({length:8},(_,i)=>({id:i+1,type:'crosswalk',width:10,
    a:{x:0,y:0,on:{road:1,side:'L',f:(i+1)/10}},b:{x:0,y:0,on:{road:1,side:'R',f:(i+1)/10}}}));
   const original=A.intersections.boundaries,checks=[];let calls=0;
   A.intersections.boundaries=function(...args){calls++;return original.apply(this,args);};
   try {
    for(let edit=0;edit<4;edit++){
     if(edit===1)s.joints[1].y+=120;
     if(edit===2)s.roads[0].laneWidth=14;
     if(edit===3){s.roads[0].lanes=3;s.inchesPerPixel=4;}
     calls=0;const expected=A.markings.crosswalkCuts(s),uncachedCalls=calls;
     calls=0;const actual=A.markings.crosswalkCuts(s,A.roadEditor.solve(s));
     checks.push({expected,actual,uncachedCalls,cachedCalls:calls});
    }
   }finally{A.intersections.boundaries=original;}
   return checks;
  });
  for(const c of checks){assert.deepEqual(c.actual,c.expected);assert.equal(c.actual.length,8);assert.equal(c.uncachedCalls,1);assert(c.cachedCalls<=1);}
  assert.notDeepEqual(checks[0].actual,checks[1].actual);assert.notDeepEqual(checks[1].actual,checks[2].actual);assert.notDeepEqual(checks[2].actual,checks[3].actual);
  assert.deepEqual(errors,[]);console.log('PASS: crosswalk placement changes correctly after geometry/width/lane/scale edits, with at most one boundary query per collection.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
