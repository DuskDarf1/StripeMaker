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
    await page.route('**/js/markings.js',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text()).replace('app.markings = {','app.markings = { auditBars: (s,a,b)=>{tracks=collect(s);return barsAcross(a,b);}, auditSnap: (s,p)=>{tracks=collect(s);return snapEnd(s,p);}, auditEnd: (s,p)=>{tracks=collect(s);return endPoint(s,p);}, ')});});
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
    assert.equal(await page.locator('#markingGrid button').count(), 1);
    await page.locator('#markingGrid button').first().click();
    await page.locator('#markingEnhanced').check();
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
    assert.equal(cw.type, 'crosswalk'); assert.equal(cw.enhanced,true); assert.equal(cw.width, 10); assert.equal(cw.contrast, true);
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
    // Bike lanes get a full 24-inch bar on each boundary.
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
    assert.equal(bikeBars.length,4,'two vehicle center bars and two bike boundary bars');
    assert(bikeBars.every(b=>Math.abs(b.width-12)<.01),'all bars are 24 inches at 2 inches per pixel');
    assert.equal(bikeBars.filter(b=>Math.abs(b.center-700)<.01).length,0,'no bar centered in the bike lane');
    const half=(type==='bike'?5:7)*3;
    for(const side of [-1,1])assert(bikeBars.some(b=>Math.abs(b.center-(700+side*half))<.01),'bar on each bike boundary');
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
    const roundaboutSnaps = await page.evaluate(() => {
      const app = StripeMaker, s = app.sheets.selected, R = app.roundaboutGeometry, results = [];
      for (const shape of ['circle', 'oval', 'peanut']) {
        const item = R.create(); Object.assign(item, { x: 800, y: 700 });
        Object.assign(item.roundabout, { shape, ratio: 1.3 });
        s.intersections = [item]; s.markings = [];
        R.normalize(item); app.roadEditor.render();
        const target = item.approaches[1];
        const edges = app.intersections.boundaries(s).edges.filter(e =>
          e.on.approach === target.id && e.on.side.startsWith('splitter-'));
        if (edges.length !== 1) throw Error('Missing roundabout splitter curb');
        const edge = edges[0];
        for (const index of [1, Math.floor(edge.length / 2), edge.length - 3]) {
          const p = edge[index], end = app.markings.auditSnap(s, p);
          if (end.on?.side !== edge.on.side || end.on?.approach !== target.id) throw Error('Crosswalk did not snap to roundabout median');
          const before = app.markings.auditEnd(s, end);
          item.x += 60; item.y += 20;
          const after = app.markings.auditEnd(s, end);
          if (Math.hypot(after.x - before.x - 60, after.y - before.y - 20) > .001) throw Error('Roundabout anchor did not move');
          item.x -= 60; item.y -= 20;
          results.push(end);
        }
        const anchor = structuredClone(results.at(-1)), before = app.markings.auditEnd(s, anchor);
        // Removing an earlier splitter changes its surface index. The target
        // approach remains the same and its saved curb anchor must survive.
        item.approaches[0].outgoing = 0; R.normalize(item);
        const changedEdge = app.intersections.boundaries(s).edges.find(e => e.on.approach === target.id && e.on.side.startsWith('splitter-'));
        if (changedEdge.on.side === anchor.on.side) throw Error('Test did not change the surface index');
        const lengths = changedEdge.slice(1).map((p, i) => Math.hypot(p.x - changedEdge[i].x, p.y - changedEdge[i].y));
        let distance = lengths.reduce((a, b) => a + b, 0) * anchor.on.f, expected;
        for (let i = 0; i < lengths.length; i++) {
          if (distance <= lengths[i]) {
            const a = changedEdge[i], b = changedEdge[i + 1], f = distance / lengths[i];
            expected = { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }; break;
          }
          distance -= lengths[i];
        }
        const after = app.markings.auditEnd(s, anchor);
        if (!expected || Math.hypot(after.x - expected.x, after.y - expected.y) > .001) throw Error('Saved anchor lost its splitter after another island was removed');
        s.markings = [{ id: 'roundabout-crosswalk', type: 'crosswalk', width: 10, a: anchor, b: { x: before.x + 90, y: before.y } }];
      }
      app.roadEditor.render(); app.sheets.save(s);
      return results;
    });
    assert.equal(roundaboutSnaps.length,9,'roundabout median sides and noses snap on all shapes');
    const anchor = await page.evaluate(() => structuredClone(StripeMaker.sheets.selected.markings[0].a));
    await page.waitForTimeout(650); await page.reload();
    await page.waitForFunction(() => StripeMaker.sheets.ready && StripeMaker.sheets.selected?.markings?.length);
    assert.deepEqual(await page.evaluate(() => StripeMaker.sheets.selected.markings[0].a),anchor,'roundabout curb anchor persists on reload');
    for (const curved of [false, true]) for (const skew of [false, true]) {
      const result = await page.evaluate(({curved, skew}) => {
        const app = StripeMaker, s = app.sheets.selected, R = app.roundaboutGeometry, G = app.intersectionGeometry;
        const item = R.create(); item.x = 700; item.y = 700; item.roundabout.icd = 360;
        item.approaches.forEach(a => { a.incoming = 3; a.outgoing = 3; }); R.normalize(item);
        item.approaches.forEach(a => Object.assign(a, G.mul(G.axes(a).u, R.requiredReach(item, a) + 60)));
        const a = item.approaches[0]; a.entryGores = { [a.inLanes[1]]: 6, [a.inLanes[2]]: 7 };
        if (curved) { R.setApproachBezier(item, a, 'mouth', {x: 0, y: 6}); R.setApproachSideBezier(item, a, 'entry', {x: 0, y: -4}); }
        s.roads = []; s.joints = []; s.gores = []; s.intersections = [item]; s.markings = [];
        const L = R.layout(item).legs.get(a.id), sp = L.S0 - 14, scale = 12 / s.inchesPerPixel;
        const world = p => G.add(item, G.mul(p, scale));
        const start = world(L.P(L.entryOff(0, sp) + L.curb, sp)), finishSp = sp + (skew ? 4 : 0);
        const finish = world(L.P(L.entryOff(3, finishSp) - L.curb, finishSp));
        s.markings = [{ id: 'gore-crosswalk', type: 'crosswalkSpecial', width: 10, a: start, b: finish }];
        app.roadEditor.render();
        const bars = app.markings.auditBars(s, start, finish);
        const cuts = [];
        for (let k = 1; k < 3; k++) for (const off of [q => L.entryBounds(k - 1, q)[1], q => L.entryBounds(k, q)[0]]) {
          const line = L.line(off, 0, L.entryMeet(off)).map(world), d = G.sub(finish, start);
          for (let i = 1; i < line.length; i++) {
            const v = G.sub(line[i], line[i - 1]), q = G.sub(line[i - 1], start), den = d.x * v.y - d.y * v.x;
            if (Math.abs(den) < 1e-9) continue;
            const t = (q.x * v.y - q.y * v.x) / den, u = (q.x * d.y - q.y * d.x) / den;
            if (t >= 0 && t <= 1 && u >= 0 && u <= 1) { cuts.push(G.add(start, G.mul(d, t))); break; }
          }
        }
        const polygon = app.markings.crosswalkCuts(s)[0];
        const inside = p => {
          let yes = false;
          for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
            const a = polygon[i], b = polygon[j];
            if (a.y > p.y !== b.y > p.y && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) yes = !yes;
          }
          return yes;
        };
        for (const path of s.roadLayer.querySelectorAll('path.roadMarking')) {
          const n = path.getAttribute('d').match(/-?\d*\.?\d+/g).map(Number);
          for (let i = 2; i < n.length; i += 2) for (const f of [.05, .25, .5, .75, .95]) {
            if (inside({ x: n[i - 2] + (n[i] - n[i - 2]) * f, y: n[i - 1] + (n[i + 1] - n[i - 1]) * f }))
              throw Error('Gore paint still crosses the crosswalk interior');
          }
        }
        if (curved && skew) {
          const svg = s.roadLayer.cloneNode(true); svg.id = 'goreCrosswalkPreview';
          const xs = [start.x, finish.x], ys = [start.y, finish.y], pad = 70;
          svg.setAttribute('viewBox', `${Math.min(...xs) - pad} ${Math.min(...ys) - pad} ${Math.max(...xs) - Math.min(...xs) + pad * 2} ${Math.max(...ys) - Math.min(...ys) + pad * 2}`);
          svg.style.cssText = 'position:fixed;right:0;top:0;width:900px;height:800px;z-index:9999;transform:none;background:white';
          document.body.append(svg);
        }
        return { count: bars.length, edgeCounts: cuts.map(p => bars.filter(b => G.length(G.sub(p, b)) < .01).length),
          whitePaths: [...s.roadLayer.querySelectorAll('.laneMarkings path')].filter(p => p.getAttribute('fill') === '#ffffff').length };
      }, {curved, skew});
      assert.equal(result.count, 7, 'three lane-center bars and four gore-edge bars');
      assert.deepEqual(result.edgeCounts, [1, 1, 1, 1], 'exactly one bar on each painted gore edge');
      assert.equal(result.whitePaths, 9, 'seven bars plus two transverse lines render as vectors');
    }
    await page.locator('#goreCrosswalkPreview').screenshot({ path: '/tmp/stripemaker-gore-crosswalk.png' });
    await page.locator('#goreCrosswalkPreview').evaluate(e => e.remove());
    const roadGore = await page.evaluate(() => {
      const app = StripeMaker, s = app.sheets.selected;
      s.intersections = [];
      s.roads = [
        { id: 1, lanes: 1, laneWidth: 12, ends: [{ joint: 1, sign: 1, length: null }, { joint: 2, sign: 1, length: null }] },
        { id: 2, lanes: 1, laneWidth: 12, ends: [{ joint: 1, sign: 1, length: null }, { joint: 3, sign: 1, length: null }] },
      ];
      s.joints = [
        { id: 1, x: 200, y: 700, dir: { x: 1, y: 0 }, root: 1, links: [{ a: 1, ai: 0, b: 2, bi: 0, beside: 1 }] },
        { id: 2, x: 1400, y: 700, dir: { x: 1, y: 0 }, root: 1, links: [] },
        { id: 3, x: 1400, y: 1050, dir: { x: 1, y: 0 }, root: 2, links: [] },
      ];
      s.gores = [{ key: '1:0|2:0', length: 200, spacing: 20 }];
      const a = { x: 900, y: 600 }, b = { x: 900, y: 1100 };
      s.markings = [{ id: 'road-gore-crosswalk', type: 'crosswalkSpecial', width: 10, a, b }];
      app.roadEditor.render();
      const bars = app.markings.auditBars(s, a, b), edges = app.roadEditor.paintedGoreEdges(s);
      const hits = edges.map(line => {
        for (let i = 1; i < line.length; i++) {
          const p = line[i - 1], q = line[i];
          if (p.x < 900 && q.x >= 900) return p.y + (q.y - p.y) * (900 - p.x) / (q.x - p.x);
        }
      });
      // No longitudinal line or gore chevron may continue through the bars.
      for (const path of s.roadLayer.querySelectorAll('path[stroke]')) {
        if (path.closest('.laneMarkings')) continue;
        for (const segment of (path.getAttribute('d') ?? '').split('M').filter(Boolean)) {
          const n = segment.match(/-?\d*\.?\d+/g).map(Number);
          for (let i = 2; i < n.length; i += 2) {
            const t = (900 - n[i - 2]) / (n[i] - n[i - 2]), y = n[i - 1] + (n[i + 1] - n[i - 1]) * t;
            if (t > 0 && t < 1 && y > 600 && y < 1100) throw Error('Road gore paint still crosses the crosswalk interior');
          }
        }
      }
      return { count: bars.length, edges: hits.map(y => bars.filter(bar => Math.hypot(bar.x - 900, bar.y - y) < .01).length) };
    });
    assert.equal(roadGore.count, 4, 'two road-lane centers and both gore-edge bars');
    assert.deepEqual(roadGore.edges, [1, 1], 'road gores also have exactly one bar at each edge');
    assert.deepEqual(errors, []);
    console.log('crosswalk browser test passed');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
