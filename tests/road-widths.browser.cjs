/* Same isolated Chromium setup as intersections.browser.cjs. */
const assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
 try{
 const page=await browser.newPage({viewport:{width:1400,height:1000}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(pathToFileURL(path.resolve(__dirname,'../index.html')).href);
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
 assert.deepEqual(result.left,result.right,'both pavement edges meet exactly');
 const span=a=>a.at(-1)-a[0];assert(Math.abs(span(result.left)-82)<.01);assert(Math.abs(span(result.free)-64)<.01);assert(Math.abs(span(result.wide)-100)<.01);
 assert(result.points[0].some(p=>p.x>550&&p.x<800&&p.y<670&&p.y>659),'transition has intermediate widths');
 await page.screenshot({path:'/tmp/stripemaker-road-width-transition.png'});
 await page.locator('[data-editor="elementsEditor"]').click();
 assert.equal(await page.locator('#roadLanes').getAttribute('max'),'999');assert.equal(await page.locator('#roadOpposite').getAttribute('max'),'999');
 await page.locator('#roadLanes').fill('999');await page.locator('#roadLanes').blur();
 await page.locator('#addRoad').click();await page.mouse.click(900,650);await page.mouse.click(1100,650);await page.keyboard.press('Escape');
 assert.equal(await page.evaluate(()=>StripeMaker.sheets.selected.roads.at(-1).lanes),999);
 assert.deepEqual(errors,[]);console.log('Rendered width transitions and creating a 999-lane road passed.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
