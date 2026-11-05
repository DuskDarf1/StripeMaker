const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const selectChoice = require('./select-choice.cjs');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } }), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/js/markings.js', async route => {
      const response = await route.fetch();
      await route.fulfill({ response, body: (await response.text()).replace('app.markings = {', 'app.markings = { auditEnd: (s,p)=>{tracks=collect(s);return endPoint(s,p);}, ') });
    });
    await page.goto(process.env.STRIPEMAKER_URL || 'http://127.0.0.1:8876');
    await page.waitForFunction(() => StripeMaker.sheets.ready);
    await page.locator('#blankSheet').evaluate(b => b.click());
    await page.waitForFunction(() => StripeMaker.sheets.selected?.inchesPerPixel);
    await page.getByRole('button', { name: 'Intersections', exact: true }).click(); await page.locator('#newIntersection').click();
    await page.waitForFunction(() => StripeMaker.sheets.selected?.intersections?.length === 1);
    await page.evaluate(() => {
      const A = StripeMaker, s = A.sheets.selected, i = s.intersections[0];
      i.medians = [{ id: 'island-a', type: 'concrete', points: [{x:-20,y:-10},{x:-10,y:-10},{x:-10,y:10},{x:-20,y:10}] },
        { id: 'island-b', type: 'painted', color:'yellow', points: [{x:10,y:-10},{x:20,y:-10},{x:20,y:10},{x:10,y:10}] }];
      s.view = { scale: 1, x: 850 - i.x, y: 480 - i.y }; A.sheets.zoomBy(1); A.roadEditor.render(); A.history.rebase();
    });
    const client = async (x, y) => page.evaluate(({x,y}) => {
      const A = StripeMaker, s = A.sheets.selected, i = s.intersections[0], p = A.sheets.toScreen({x:i.x+x*6,y:i.y+y*6}), r = document.querySelector('#previewStage').getBoundingClientRect();
      return {x:p.x+r.left,y:p.y+r.top};
    }, {x,y});
    const doubleEdges=await page.locator('[data-median-edge="island-b"] path').evaluateAll(paths=>paths.map(p=>p.getAttribute('d')));
    assert.equal(doubleEdges.length,2);
    assert(doubleEdges.every(d=>d.endsWith('Z')),'both yellow stripes close cleanly at the first corner');
    const margin=await page.evaluate(()=>{
      const A=StripeMaker,s=A.sheets.selected,i=s.intersections[0],group=s.roadLayer.querySelector('[data-intersection-median="island-a"]');
      const points=path=>(path.getAttribute('d').match(/-?\d*\.?\d+/g)||[]).map(Number);
      const surface=points(group.querySelector(':scope > path')),line=points(group.querySelector('[data-median-edge] path'));
      const box=p=>({x0:Math.min(...p.filter((_,n)=>n%2===0)),x1:Math.max(...p.filter((_,n)=>n%2===0)),y0:Math.min(...p.filter((_,n)=>n%2)),y1:Math.max(...p.filter((_,n)=>n%2))});
      const edge=A.intersections.boundaries(s).edges.find(e=>e.on.median==='island-a');
      return {surface:box(surface),line:box(line),curb:box(points(group.querySelector('g[clip-path] path'))),snap:box(edge.flatMap(p=>[p.x,p.y]))};
    });
    for(const axis of ['x','y']) {
      assert(Math.abs(margin.surface[axis+'0']-margin.line[axis+'0']-4)<.01,'8-inch margin inside the edge-line center');
      assert(Math.abs(margin.line[axis+'1']-margin.surface[axis+'1']-4)<.01);
    }
    assert.deepEqual(margin.curb,margin.surface,'curb stays at the inset surface');
    assert.deepEqual(margin.snap,margin.surface,'crosswalks snap to the actual curb');
    const click = async (x,y) => { const p = await client(x,y); await page.mouse.click(p.x,p.y); };
    await page.locator('[data-editor="markingsEditor"]').click(); await page.locator('#markingsLongitudinalTab').click();
    await page.locator('#chooseLine').click(); await page.locator('#markingSearch').fill('solid line'); await page.locator('#markingGrid button').first().click();
    await click(-10,0);
    let line = await page.evaluate(() => StripeMaker.sheets.selected.lines[0]);
    assert.equal(line.on.median, 'island-a'); assert.equal(line.from, 0); assert.equal(line.to, 1);
    await selectChoice(page.locator('#lineColor'), 'white');
    assert(await page.locator('[data-median-edge="island-a"] path[stroke="#ffffff"]').count());
    const before = await page.locator('[data-median-edge="island-a"]').innerHTML();
    await page.locator('#undoButton').click(); assert.notEqual(await page.locator('[data-median-edge="island-a"]').innerHTML(), before);
    await page.locator('#redoButton').click(); assert.equal(await page.locator('[data-median-edge="island-a"]').innerHTML(), before);
    await click(-10,0); // Undo can clear selection; select the restored line.
    await page.locator('#chooseLine').click(); await page.locator('#markingSearch').fill('No line'); await page.locator('#markingGrid [data-type="none"]').click();
    assert.equal(await page.locator('[data-median-edge="island-a"] path').count(),0,JSON.stringify(await page.evaluate(()=>({lines:StripeMaker.sheets.selected.lines,selected:StripeMaker.longitudinal.selectedItem(),edge:document.querySelector('[data-median-edge="island-a"]').innerHTML}))));
    await page.locator('#undoButton').click(); assert.equal(await page.locator('[data-median-edge="island-a"]').innerHTML(),before);
    await page.locator('#markingsLateralTab').click(); await page.locator('#chooseMarking').click();
    await page.locator('#markingSearch').fill('crosswalk'); await page.locator('#markingGrid [data-type="crosswalk"]').click();
    await click(-9.5,0); await click(9.5,0);
    const crossing = () => page.evaluate(() => structuredClone(StripeMaker.sheets.selected.markings.find(m=>m.type==='crosswalk')));
    const cw = await crossing(); assert(cw, 'crosswalk added through actual two-click tool');
    assert.equal(cw.a.on.median, 'island-a'); assert.equal(cw.b.on.median, 'island-b');
    const resolved = () => page.evaluate(() => { const A=StripeMaker,s=A.sheets.selected,cw=s.markings.find(m=>m.type==='crosswalk');return ['a','b'].map(k=>A.markings.auditEnd(s,cw[k])); });
    const positions = await resolved();
    await page.evaluate(() => { const A=StripeMaker,s=A.sheets.selected; s.intersections[0].medians[0].points.forEach(p=>p.x-=2); A.roadEditor.render(); A.sheets.save(s); A.history.record(); });
    const moved = await resolved(); assert(Math.abs(moved[0].x-positions[0].x+12)<1e-8); assert.deepEqual(moved[1],positions[1]);
    assert.notEqual(await page.locator('[data-median-edge="island-a"]').innerHTML(),before,'line follows median geometry');
    await page.screenshot({path:'/tmp/intersection-median-markings.png'});
    await page.locator('#duplicateIntersection').evaluate(b=>b.click());
    const duplicate = await page.evaluate(() => {const s=StripeMaker.sheets.selected,i=s.intersections[1];return {i,lines:s.lines.filter(l=>l.on.intersection===i.id)};});
    assert.equal(duplicate.lines.length,1); assert.equal(duplicate.lines[0].on.median,duplicate.i.medians[0].id);
    const project = await page.evaluate(() => StripeMaker.projectJSON.snapshot());
    await page.evaluate(project=>StripeMaker.projectJSON.load(project),project);
    assert.deepEqual(await crossing(),cw,'crosswalk anchors survive project JSON');
    assert.deepEqual(await resolved(),moved);
    await page.waitForTimeout(800); await page.reload(); await page.waitForFunction(()=>StripeMaker.sheets.selected?.markings?.some(m=>m.type==='crosswalk'));
    assert.deepEqual(await resolved(),moved);
    assert.deepEqual(errors,[]);
    console.log('PASS: customizable custom-median outlines, undo/redo, crosswalk snapping and following, duplication, JSON and reload.');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
