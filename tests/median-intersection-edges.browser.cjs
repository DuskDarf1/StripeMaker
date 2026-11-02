const assert=require('node:assert/strict'),fixture=require('./fixtures/median-intersection-edges.json');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});try{
 const page=await browser.newPage({viewport:{width:1500,height:1100}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/js/elements.js',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text()).replace('window.StripeMaker.roadEditor = {','window.StripeMaker.roadEditor = { auditMedianEdges: s => {const solved=solve(s);anchorMedians(s,solved);return medianLegs(s,solved,s.medians.find(m=>m.id===1).points);}, ')});});
 await page.goto(process.env.STRIPEMAKER_URL||'http://127.0.0.1:8879');await page.waitForFunction(()=>StripeMaker.sheets.ready&&StripeMaker.intersections);
 await page.locator('#blankSheet').evaluate(b=>b.click());await page.waitForFunction(()=>StripeMaker.sheets.selected);
 await page.evaluate(f=>{const s=StripeMaker.sheets.selected;Object.assign(s,f);s.view={scale:1,x:-11650,y:-11500,fitted:false};StripeMaker.sheets.zoomBy(1);document.dispatchEvent(new Event('sheetchange'));StripeMaker.roadEditor.render();},fixture);
 for(const reverse of [false,true]) {
 const result=await page.evaluate(reverse=>{const app=StripeMaker,s=app.sheets.selected;if(reverse){s.roads.reverse();s.intersections.reverse();}app.roadEditor.render();const legs=app.roadEditor.auditMedianEdges(s);return legs.map((leg,i)=>{const p=leg[0],q=legs[(i+1)%legs.length][0];return {count:leg.length,deviation:Math.max(...leg.map(r=>Math.abs((q.x-p.x)*(p.y-r.y)-(p.x-r.x)*(q.y-p.y))/Math.hypot(q.x-p.x,q.y-p.y)))};});},reverse);
 assert(result[1].count>5,'first long side follows the intersection corner into the road');assert(result[3].count>5,'second long side follows the other intersection corner into its road');
 assert(result[1].deviation>5,'first long side bends instead of using a chord');assert(result[3].deviation>5,'second long side bends instead of using a chord');
 }
 await page.screenshot({path:'/tmp/stripe-median-intersection-edges.png'});assert.deepEqual(errors,[]);console.log('PASS: the saved grass median follows road and intersection edge curves in either object ordering.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
