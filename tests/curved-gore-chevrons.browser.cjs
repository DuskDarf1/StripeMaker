const assert=require('node:assert/strict'),path=require('node:path'),{pathToFileURL}=require('node:url');
const fixture={inchesPerPixel:4,roads:[
 {id:1,lanes:1,laneWidth:12,ends:[{joint:1,sign:1,length:500},{joint:2,sign:1,length:500}]},
 {id:2,lanes:1,laneWidth:12,ends:[{joint:1,sign:1,length:580},{joint:2,sign:1,length:580}]}
],joints:[{id:1,x:1100,y:200,dir:{x:-1,y:0},root:1,links:[{a:1,ai:'R',b:2,bi:'L'}]},
{id:2,x:1100,y:850,dir:{x:1,y:0},root:1,links:[{a:1,ai:'R',b:2,bi:'L'}]}]};
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});try{
const page=await browser.newPage({viewport:{width:1200,height:950}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto(pathToFileURL(path.resolve(__dirname,'../index.html')).href);await page.waitForFunction(()=>StripeMaker.sheets.ready);
await page.locator('#blankSheet').evaluate(b=>b.click());await page.waitForFunction(()=>StripeMaker.sheets.selected);
await page.evaluate(f=>{const s=StripeMaker.sheets.selected;Object.assign(s,f);s.medians=[];s.gores=[];StripeMaker.showEditor('elementsEditor');StripeMaker.roadEditor.render();StripeMaker.history.rebase();},fixture);
const keys=await page.locator('.goreHandle').evaluateAll(nodes=>nodes.map(n=>n.dataset.gore).filter(key=>key==='1:0|2:0'));assert(keys.length);
await page.evaluate(keys=>{const s=StripeMaker.sheets.selected;s.gores=keys.map(key=>({key,length:1000,spacing:20}));StripeMaker.roadEditor.render();StripeMaker.history.record();},keys);
const read=()=>page.locator('.goreChevrons path').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('d').match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi).map(Number)));
const before=await read();assert(before.length>5,'curved gores have multiple chevrons');
const direction=coords=>{assert.equal(coords.length,6);const [ax,ay,x,y,bx,by]=coords,u=[ax-x,ay-y],v=[bx-x,by-y],a=Math.hypot(...u),b=Math.hypot(...v);assert(a>0&&b>0);assert(Math.abs((u[0]*v[0]+u[1]*v[1])/(a*b))<.01,'arms stay at 45 degrees to local curve');return [u[0]/a+v[0]/b,u[1]/a+v[1]/b];};
const directions=before.map(direction);assert(directions.some(d=>Math.abs(d[0]*directions[0][1]-d[1]*directions[0][0])>.5),'chevrons rotate along curve');
await page.evaluate(()=>StripeMaker.settings.set('leftHandTraffic',true));const reversed=await read();assert.equal(reversed.length,before.length);
reversed.forEach((p,i)=>{assert(Math.hypot(p[2]-before[i][2],p[3]-before[i][3])<.05);const d=direction(p);assert(d[0]*directions[i][0]+d[1]*directions[i][1]<0,'reverse traffic reverses chevrons');});
await page.evaluate(()=>{StripeMaker.settings.set('leftHandTraffic',false);const s=StripeMaker.sheets.selected;s.roads.reverse();StripeMaker.roadEditor.render();});assert.equal((await read()).length,before.length);
await page.locator('#undoButton').click();assert.equal((await read()).length,0);await page.locator('#redoButton').click();assert.equal((await read()).length,before.length);
await page.evaluate(()=>{const s=StripeMaker.sheets.selected,svg=s.roadLayer.cloneNode(true);svg.id='gorePreview';svg.setAttribute('viewBox','350 100 850 850');svg.style.cssText='position:fixed;inset:0;width:950px;height:850px;z-index:9999;background:#202124;transform:none';svg.style.setProperty('--zoom',1);document.body.append(svg);});
await page.locator('#gorePreview').screenshot({path:'/tmp/stripemaker-curved-gore.png'});
assert.deepEqual(errors,[]);console.log('PASS: curved gore chevrons remain perpendicular, follow the bend, reverse with traffic, and survive road reordering and undo/redo.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
