const selectChoice=require('./select-choice.cjs');
/* Same isolated Chromium setup as intersections.browser.cjs:
   PLAYWRIGHT_MODULE=/path/to/playwright node tests/crosswalks.browser.cjs */
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } }), errors = [];
    page.setDefaultTimeout(10000);
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/js/markings.js',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text()).replace('app.markings = {','app.markings = { auditSnap: (s,p)=>{tracks=collect(s);return snapEnd(s,p);}, auditEnd: (s,p)=>{tracks=collect(s);return endPoint(s,p);}, ')});});
    await page.goto(process.env.STRIPEMAKER_URL || pathToFileURL(path.resolve(__dirname, '../index.html')).href);
    const png = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 1600; c.height = 1200; const g = c.getContext('2d'); g.fillStyle = '#777'; g.fillRect(0, 0, 1600, 1200); return c.toDataURL().split(',')[1]; });
    await page.locator('#sheetFile').setInputFiles({ name: 'Crosswalk test.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
    await page.waitForFunction(() => StripeMaker.sheets.selected);
    // A two-way road (one 12 ft lane each way, 6 px per foot) running east-west at y = 700.
    await page.evaluate(() => {
      const s = StripeMaker.sheets.selected; s.inchesPerPixel = 2;
      s.roads = [{ id: 1, lanes: 1, laneWidth: 12, ends: [{ joint: 1, sign: 1, length: null }, { joint: 2, sign: 1, length: null }] },
        { id: 2, lanes: 1, laneWidth: 12, ends: [{ joint: 2, sign: -1, length: null }, { joint: 1, sign: -1, length: null }] }];
      const link = { a: 1, ai: 0, b: 2, bi: 0, pair: true, median: 0 };
      s.joints = [{ id: 1, x: 200, y: 700, dir: { x: 1, y: 0 }, root: 1, links: [link] }, { id: 2, x: 1400, y: 700, dir: { x: 1, y: 0 }, root: 1, links: [{ ...link }] }];
      StripeMaker.roadEditor.render(); StripeMaker.sheets.save(s); StripeMaker.history.record();
      document.dispatchEvent(new CustomEvent('sheetchange'));
    });
    const client = p => page.evaluate(p => {
      const box = document.getElementById('previewStage').getBoundingClientRect(), v = StripeMaker.sheets.selected.view;
      return { x: box.left + v.x + p.x * v.scale, y: box.top + v.y + p.y * v.scale };
    }, p);
    const marks = () => page.evaluate(() => structuredClone(StripeMaker.sheets.selected.markings ?? []));
    await page.locator('[data-editor="markingsEditor"]').click();
    await page.locator('#chooseMarking').click();
    await selectChoice(page.locator('#markingCategory'),'Crosswalks');
    assert.equal(await page.locator('#markingGrid button').count(), 2);
    await page.locator('#markingGrid button').nth(1).click();
    await page.locator('#markingContrast').check();
    // Pavement edges: 12 ft + 5 in + 8 in from the centerline (78.5 px); click a
    // little off each edge so the ends snap. The second end is 60 px east: skewed.
    const north = await client({ x: 700, y: 700 - 80 }), south = await client({ x: 760, y: 700 + 80 });
    await page.mouse.move(north.x, north.y); await page.mouse.click(north.x, north.y);
    assert.match(await page.locator('#markingStatus').textContent(), /other edge/);
    await page.mouse.move(south.x, south.y);
    await page.waitForFunction(() => document.querySelector('.markingPreview path'));
    await page.mouse.click(south.x, south.y);
    let list = await marks();
    assert.equal(list.length, 1);
    const cw = list[0];
    assert.equal(cw.type, 'crosswalkSpecial'); assert.equal(cw.width, 10); assert.equal(cw.contrast, true);
    // North is the westbound side's right edge, south the eastbound side's.
    assert.deepEqual([cw.a.on.road, cw.a.on.side, cw.b.on.road, cw.b.on.side], [2, 'R', 1, 'R']);
    assert(Math.abs(cw.a.y - (700 - 78.5)) < 0.5 && Math.abs(cw.b.y - (700 + 78.5)) < 0.5, JSON.stringify(cw));
    // Bars: both lane centers and the centerline, each parallel to traffic (east-west)
    // even though the crosswalk is skewed; plus two transverse lines; contrast under all.
    const shapes = await page.evaluate(() => [...StripeMaker.sheets.selected.roadLayer.querySelectorAll('.laneMarkings path')].map(p => ({ fill: p.getAttribute('fill'), d: p.getAttribute('d') })));
    const white = shapes.filter(s => s.fill === '#ffffff'), black = shapes.filter(s => s.fill === '#000000');
    assert.equal(white.length, 5, JSON.stringify(shapes));
    assert.equal(black.length, 5);
    const corners = d => { const n = d.match(/-?\d*\.?\d+/g).map(Number); return [0, 1, 2, 3].map(i => ({ x: n[2 * i], y: n[2 * i + 1] })); };
    // A bar: long edges (p0-p1, q1-q0) along traffic, 24 in (12 px) across it
    // measured square to traffic; its ends lie along the skewed transverse lines.
    const bars = white.map(s => corners(s.d)).filter(p => Math.abs(Math.abs(p[2].y - p[1].y) - 12) < 0.1 && Math.abs(p[0].y - p[1].y) < 0.01);
    assert.equal(bars.length, 3, 'bars at two lane centers and the centerline');
    for (const p of bars) assert(Math.abs(p[0].y - p[1].y) < 0.01 && Math.abs(p[2].y - p[3].y) < 0.01, 'bar edges run with traffic');
    const centers = bars.map(p => (p[0].y + p[1].y + p[2].y + p[3].y) / 4).sort((a, b) => a - b);
    assert(Math.abs(centers[1] - 700) < 0.5 && Math.abs(centers[0] - (700 - 38.5)) < 1 && Math.abs(centers[2] - (700 + 38.5)) < 1, JSON.stringify(centers));
    await page.screenshot({ path: '/tmp/stripemaker-crosswalk.png' });
    // Width slider; ends follow their edge when the road moves; drag an end; undo.
    await page.locator('#markingCrosswalkWidthValue').fill('14'); await page.locator('#markingCrosswalkWidthValue').blur();
    assert.equal((await marks())[0].width, 14);
    const top = () => page.evaluate(() => Math.min(...[...StripeMaker.sheets.selected.roadLayer.querySelectorAll('.laneMarkings path')].flatMap(p => p.getAttribute('d').match(/-?\d*\.?\d+/g).map(Number).filter((_, i) => i % 2))));
    const before = await top();
    await page.evaluate(() => { const s = StripeMaker.sheets.selected; s.joints.forEach(j => { j.y += 30; }); StripeMaker.roadEditor.render(); });
    assert(Math.abs(await top() - before - 30) < 0.5, 'crosswalk followed the road');
    const handle = await page.locator('.markingOverlay button[data-part="b"]').boundingBox();
    const to = await client({ x: 900, y: 730 + 80 });
    await page.mouse.move(handle.x + 7, handle.y + 7); await page.mouse.down(); await page.mouse.move(to.x, to.y, { steps: 6 }); await page.mouse.up();
    assert(Math.abs((await marks())[0].b.x - 900) < 2);
    await page.locator('#undoButton').click();
    assert(Math.abs((await marks())[0].b.x - 900) > 50);
    // Escape cancels a half-placed crosswalk.
    await page.locator('.markingOverlay button[data-part="a"]').focus(); await page.keyboard.press('Escape');
    const c = await client({ x: 400, y: 730 - 80 });
    await page.mouse.click(c.x, c.y);
    await page.locator('#markingsLateralTab').focus(); await page.keyboard.press('Escape');
    assert.equal((await marks()).length, 1);
    // Bike lanes, including their buffer, get one full 24-inch bar.
    for(const type of ['bike','bufferedBike']) for(const skew of [false,true]) {
    const bikeBars=await page.evaluate(({type,skew})=>{
      const s=StripeMaker.sheets.selected;
      s.roads=[{id:1,lanes:3,laneWidth:12,laneTypes:{1:{type,width:type==='bike'?5:7}},ends:[{joint:1,sign:1,length:null},{joint:2,sign:1,length:null}]}];
      s.joints=[{id:1,x:200,y:700,dir:{x:1,y:0},root:1,links:[]},{id:2,x:1400,y:700,dir:{x:1,y:0},root:1,links:[]}];
      s.markings=[{id:'bike-crosswalk',type:'crosswalkSpecial',width:10,contrast:true,a:{x:skew?760:800,y:603},b:{x:skew?840:800,y:797}}];
      StripeMaker.roadEditor.render();
      // At the crosswalk center, no old default stripe may add paint beside
      // the emphasis bars (especially the buffered lane's second stripe).
      for(const path of s.roadLayer.querySelectorAll('path.roadMarking')) {
        const n=(path.getAttribute('d').match(/-?\d*\.?\d+/g)??[]).map(Number);
        for(let i=2;i<n.length;i+=2)if(n[i-2]<800&&n[i]>800)
          throw new Error('Longitudinal stripe still crosses the crosswalk interior');
      }
      return [...s.roadLayer.querySelectorAll('.laneMarkings path')].filter(p=>p.getAttribute('fill')==='#ffffff').map(p=>{
        const n=p.getAttribute('d').match(/-?\d*\.?\d+/g).map(Number),x=n.filter((_,i)=>i%2===0),y=n.filter((_,i)=>i%2);
        return {width:Math.max(...y)-Math.min(...y),center:(Math.max(...y)+Math.min(...y))/2,length:Math.max(...x)-Math.min(...x)};
      }).filter(p=>p.length>20&&p.width<20);
    },{type,skew});
    assert.equal(bikeBars.length,3,'one bar per lane, with no duplicate bike boundary bars');
    assert(bikeBars.every(b=>Math.abs(b.width-12)<.01),'all bars are 24 inches at 2 inches per pixel');
    assert.equal(bikeBars.filter(b=>Math.abs(b.center-700)<.01).length,1,'one bar centered across the bike lane and buffer');
    }
    await page.screenshot({path:'/tmp/stripemaker-bike-crosswalk.png'});
    const snapped=await page.evaluate(()=>{
      const s=StripeMaker.sheets.selected,G=StripeMaker.intersectionGeometry;
      s.roads=[];s.joints=[];s.markings=[];
      const item=G.create();item.x=800;item.y=700;
      const a=item.approaches[0];a.incoming=2;a.median=8;a.nose=30;
      a.splits=[{id:'crosswalk-island',incoming:true,after:1,width:6,nose:25,surface:'concrete'}];
      s.intersections=[item];G.normalize(item);StripeMaker.roadEditor.render();
      const edges=StripeMaker.intersections.boundaries(s).edges.filter(e=>e.on.approach===a.id&&['median','split-crosswalk-island'].includes(e.on.side));
      const results=[];
      for(const edge of edges)for(const index of [1,Math.floor(edge.length/2)]){
        const p=edge[index],end=StripeMaker.markings.auditSnap(s,p);
        if(end.on?.side!==edge.on.side||end.on?.approach!==a.id||end.on?.intersection!==item.id)throw Error('Missing island anchor');
        const before=StripeMaker.markings.auditEnd(s,end);
        item.x+=60;item.y+=20;
        const after=StripeMaker.markings.auditEnd(s,end);
        results.push(Math.hypot(after.x-before.x-60,after.y-before.y-20));
        item.x-=60;item.y-=20;
      }
      return results;
    });
    assert.equal(snapped.length,4);assert(snapped.every(d=>d<.001),'side and nose anchors follow intersection movement');
    assert.deepEqual(errors, []);
    console.log('crosswalk browser test passed');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
