// The user's pinchpiont.json, reduced to its standalone merging intersection.
const assert=require('node:assert/strict'),fixture=require('./fixtures/intersection-pinch-point.json');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright'),selectChoice=require('./select-choice.cjs');
(async()=>{const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});try{
 const page=await browser.newPage({viewport:{width:1500,height:1100}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.env.STRIPEMAKER_URL||'http://127.0.0.1:8879');await page.waitForFunction(()=>StripeMaker.sheets.ready&&StripeMaker.intersections);
 await page.locator('#blankSheet').evaluate(b=>b.click());await page.waitForFunction(()=>StripeMaker.sheets.selected);
 const points=await page.evaluate(f=>{const app=StripeMaker,s=app.sheets.selected,G=app.intersectionGeometry;Object.assign(f,{x:15000,y:15000});s.inchesPerPixel=2;s.intersections=[f];s.view={scale:.4,x:-4800,y:-5700,fitted:false};app.sheets.zoomBy(1);document.dispatchEvent(new Event('sheetchange'));app.roadEditor.focusRoad(null);app.history.rebase();const a=f.approaches[1],b=f.approaches[2],c=G.corner(a,b);return [c.center,c.points[0],c.points.at(-1)].map(p=>({x:f.x+p.x*6,y:f.y+p.y*6}));},structuredClone(fixture));
 const click=async p=>{const q=await page.evaluate(p=>{const q=StripeMaker.sheets.toScreen(p),b=document.getElementById('previewStage').getBoundingClientRect();return {x:q.x+b.left,y:q.y+b.top};},p);await page.mouse.click(q.x,q.y);};
 assert.equal(await page.locator('.goreHandle[data-gore^="i:"]').count(),1,'intersection-only merge offers a gore at its notch');
 await page.locator('#addMedian').click();for(const p of points)await click(p);await page.keyboard.press('Enter');
 const median=await page.evaluate(()=>StripeMaker.sheets.selected.medians[0]);assert(median);assert(Math.hypot(median.points[0].x-points[0].x,median.points[0].y-points[0].y)<1e-6);assert.equal(median.points[0].on.tip,true,'the first point anchors to the visible pinch');
 // The tip remains the tip after editing a contributing approach.
 const anchored=await page.evaluate(()=>{const app=StripeMaker,s=app.sheets.selected,x=s.intersections[0],G=app.intersectionGeometry;x.approaches[1].y+=4;app.roadEditor.render();const p=G.corner(x.approaches[1],x.approaches[2]).center;return {actual:s.medians[0].points[0],expected:{x:x.x+p.x*6,y:x.y+p.y*6}};});
 assert(Math.hypot(anchored.actual.x-anchored.expected.x,anchored.actual.y-anchored.expected.y)<1e-6);
 await selectChoice(page.locator('#medianType'),'painted');await selectChoice(page.locator('#medianColor'),'white');
 let stripes=await page.evaluate(()=>[...StripeMaker.sheets.selected.roadLayer.querySelectorAll('.medianChevrons path')].map(p=>p.getAttribute('d')));
 assert(stripes.length>0);assert(stripes.every(d=>(d.match(/L/g)||[]).length===2),'white medians use two-arm chevrons');
 assert.equal(await page.locator('label[for="medianLean"]').textContent(),'Chevron direction');
 await selectChoice(page.locator('#medianLean'),'left');assert.notDeepEqual(await page.evaluate(()=>[...StripeMaker.sheets.selected.roadLayer.querySelectorAll('.medianChevrons path')].map(p=>p.getAttribute('d'))),stripes);
 await page.locator('#undoButton').click();assert.deepEqual(await page.evaluate(()=>[...StripeMaker.sheets.selected.roadLayer.querySelectorAll('.medianChevrons path')].map(p=>p.getAttribute('d'))),stripes);
 await selectChoice(page.locator('#medianColor'),'yellow');assert.equal(await page.locator('.medianChevrons').count(),0);
 assert.equal(await page.evaluate(()=>{const s=StripeMaker.sheets.selected,g=s.roadLayer.querySelector(`[clip-path="url(#median-${s.id}-${s.medians[0].id}-stripes)"]`);return [...g.querySelectorAll('path')].every(p=>(p.getAttribute('d').match(/L/g)||[]).length===1);}),true,'yellow medians retain diagonals');
 await page.evaluate(()=>{const s=StripeMaker.sheets.selected;s.medians=[];StripeMaker.roadEditor.render();StripeMaker.history.rebase();});
 const gore=page.locator('.goreHandle[data-gore^="i:"]');await gore.focus();await page.keyboard.press('Shift+ArrowRight');
 let state=await page.evaluate(()=>({gore:structuredClone(StripeMaker.sheets.selected.gores[0]),bands:StripeMaker.sheets.selected.roadLayer.querySelectorAll('.goreBand').length}));assert(state.gore.length>0);assert.equal(state.gore.intersection,fixture.id);assert.equal(state.bands,1);
 await page.locator('#undoButton').click();assert.equal(await page.evaluate(()=>StripeMaker.sheets.selected.gores.length),0);await page.locator('#redoButton').click();
 // Portable copying includes internal gore metadata and remaps its owning intersection.
 await page.evaluate(()=>{const s=StripeMaker.sheets.selected,x=s.intersections[0];StripeMaker.intersections.focusAt({x:x.x,y:x.y+18*6});});await page.locator('#intersectionEditorTitle').focus();await page.keyboard.press('Control+c');await page.mouse.move(1000,850);await page.keyboard.press('Control+v');
 state=await page.evaluate(()=>{const s=StripeMaker.sheets.selected;return {count:s.intersections.length,gores:s.gores.map(g=>({key:g.key,intersection:g.intersection})),ids:s.intersections.map(x=>x.id)};});assert.equal(state.count,2);assert.equal(state.gores.length,2);assert(state.gores.every(g=>state.ids.includes(g.intersection)&&g.key.startsWith(`i:${g.intersection}:`)));
 await page.screenshot({path:'/tmp/stripe-pinch-gore.png'});
 await page.waitForFunction(()=>StripeMaker.projectJSON?.snapshot);
 const project=await page.evaluate(()=>StripeMaker.projectJSON.snapshot());assert.equal(project.sheets[0].data.gores.length,2);
 await page.waitForTimeout(650);await page.reload();await page.waitForFunction(()=>StripeMaker.sheets.ready&&StripeMaker.sheets.selected?.gores?.length===2);
 assert.equal(await page.locator('.goreBand').count(),2);assert.deepEqual(errors,[]);console.log('PASS: pinch-point snapping and anchors, white median chevrons/yellow diagonals, intersection-only gore, undo/redo, copying, JSON and reload.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
