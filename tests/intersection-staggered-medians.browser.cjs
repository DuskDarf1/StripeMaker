const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});try{
 const page=await browser.newPage({viewport:{width:1400,height:1100}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.env.STRIPEMAKER_URL||'http://127.0.0.1:8878');await page.waitForFunction(()=>StripeMaker.sheets.ready&&StripeMaker.projectJSON);
 if(process.env.REPAIR_PROJECT)await page.evaluate(p=>StripeMaker.projectJSON.load(p),JSON.parse(await fs.readFile(process.env.REPAIR_PROJECT,'utf8')));
 else {await page.click('button[aria-controls="sheetsMenu"]');await page.click('#blankSheet');await page.waitForFunction(()=>StripeMaker.sheets.selected);} 
 const fixture=JSON.parse(await fs.readFile('tests/fixtures/divided-crossings-staggered.json','utf8'));
 const result=await page.evaluate(f=>{
  const s=StripeMaker.sheets.selected;Object.assign(s,structuredClone(f));s.name='Repaired divided intersection';
  StripeMaker.roadEditor.render();StripeMaker.history.rebase();
  const before=JSON.stringify([s.roads,s.joints,s.intersections]);
  const originalEnds=s.joints.filter(j=>[1,4,6,7].includes(j.id)).map(j=>({id:j.id,x:j.x,y:j.y}));
  const crossings=StripeMaker.roadEditor.crossingCount(s,s.roads);
  const item=StripeMaker.roadEditor.makeIntersection(s,[...s.roads]);
  const G=StripeMaker.intersectionGeometry,tracks=StripeMaker.roadEditor.laneTracks(s);
  const gaps=item.approaches.flatMap(a=>(a.links??[]).map(l=>{
   const track=tracks.find(t=>t.road===l.road),i=l.e?track.line.length-1:0,p=track.line[i],t=p.tangent;
   const offset=(track.bounds[i][l.lane]+track.bounds[i][l.lane+1])/2;
   const target=G.lane(a,l.e===1,(l.e===1?a.inLanes:a.outLanes).indexOf(l.to));
   return Math.hypot(p.x-t.y*offset-item.x-target.x*6,p.y+t.x*offset-item.y-target.y*6);
  }));
  return {before,crossings,item,gaps,validation:G.validate(item),medianPoints:item.approaches.map(a=>G.median(a).length),originalEnds,afterEnds:s.joints.filter(j=>[1,4,6,7].includes(j.id)).map(j=>({id:j.id,x:j.x,y:j.y}))};
 },fixture);
 assert.equal(result.crossings,4);assert.equal(result.item.approaches.length,4,'slightly angled carriageways form four divided arms');
 assert.equal(result.validation,'');assert.deepEqual(result.afterEnds,result.originalEnds,'remote road ends remain fixed');
 for(const a of result.item.approaches){assert.equal(a.incoming,2);assert.equal(a.outgoing,2);assert(a.median>15&&a.median<30);assert.equal(a.surface,'grass');assert.equal(a.links.length,4);}
 assert(result.medianPoints.every(n=>n>24));assert(result.gaps.every(d=>d<.05),JSON.stringify(result.gaps));
 await page.click('#undoButton');assert.equal(await page.evaluate(()=>{const s=StripeMaker.sheets.selected;return JSON.stringify([s.roads,s.joints,s.intersections]);}),result.before);
 await page.click('#redoButton');
 await page.evaluate(()=>{const svg=StripeMaker.sheets.selected.roadLayer.cloneNode(true);svg.id='staggeredPreview';svg.setAttribute('viewBox','8800 4200 2300 1500');svg.style.cssText='position:fixed;left:0;top:0;width:1300px;height:900px;z-index:9999;background:white;transform:none';document.body.append(svg);});
 await page.locator('#staggeredPreview').screenshot({path:'/tmp/intersection-staggered-fixed.png'});await page.locator('#staggeredPreview').evaluate(e=>e.remove());
 await page.waitForTimeout(700);await page.reload();await page.waitForFunction(()=>StripeMaker.sheets.ready);
 const saved=await page.evaluate(()=>StripeMaker.sheets.selected.intersections[0]);assert.equal(saved.approaches.filter(a=>a.median>0).length,4);
 if(process.env.REPAIR_OUTPUT)await fs.writeFile(process.env.REPAIR_OUTPUT,JSON.stringify(await page.evaluate(()=>StripeMaker.projectJSON.snapshot('selected')),null,2));
 assert.deepEqual(errors,[]);
 console.log('PASS: exact reported four-crossing layout creates four rounded grass medians, aligned lane links, fixed remote ends, undo/redo, and reload.');
 }finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
