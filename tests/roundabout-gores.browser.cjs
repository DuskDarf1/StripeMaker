/* Isolated Chromium; same environment as roundabouts.browser.cjs. */
const assert = require('node:assert/strict');
const selectChoice = require('./select-choice.cjs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } }), errors = [];
    page.setDefaultTimeout(10000);
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/js/markings.js', async route => {
      const response = await route.fetch();
      await route.fulfill({ response, body: (await response.text()).replace('app.markings = {', 'app.markings = { auditSnap: (s,p)=>{tracks=collect(s);return snapEnd(s,p);}, auditEnd: (s,p)=>{tracks=collect(s);return endPoint(s,p);}, ') });
    });
    await page.goto(process.env.STRIPEMAKER_URL || 'http://127.0.0.1:8876');
    await page.waitForFunction(() => StripeMaker.sheets.ready && StripeMaker.roundaboutGeometry && StripeMaker.roadEditor);
    await page.locator('#blankSheet').evaluate(b => b.click());
    await page.waitForFunction(() => StripeMaker.sheets.selected?.inchesPerPixel);
    await page.getByRole('button', { name: 'Intersections', exact: true }).click();
    await page.locator('#newRoundabout').click();
    await page.evaluate(() => {
      const app = StripeMaker, s = app.sheets.selected, x = s.intersections[0], R = app.roundaboutGeometry, G = app.intersectionGeometry;
      x.roundabout.icd = 360;
      x.approaches[0].incoming = 3; x.approaches[0].outgoing = 2;
      R.normalize(x);
      for (const a of x.approaches) Object.assign(a, G.mul(G.axes(a).u, R.requiredReach(x, a) + 80));
      const a = x.approaches[0];
      R.setApproachBezier(x, a, 'mouth', { x: 0, y: 8 }); R.setApproachBezier(x, a, 'circle', { x: 0, y: -5 });
      app.roadEditor.render(); app.history.record(); app.sheets.save(s);
      document.dispatchEvent(new CustomEvent('sheetchange'));
    });
    const state = (index = 0) => page.evaluate(index => {
      const s = StripeMaker.sheets.selected, x = s.intersections[index], R = StripeMaker.roundaboutGeometry;
      return { a: structuredClone(x.approaches[0]), item: structuredClone(x), valid: R.validate(x),
        islands: R.surfaces(x).filter(s => s.kind === 'gore'),
        tracks: R.tracks(x).map(({ line, bounds }) => ({ line, bounds })),
        chevrons: R.markings(x).clips.flatMap(c => c.lines).filter(l => l.width === 1.5 && l.color === '#ffffff').length,
        paint: s.roadLayer.innerHTML };
    }, index);
    const detail = async name => {
      if (!process.env.SHOTS) return;
      await page.evaluate(() => {
        const app = StripeMaker, s = app.sheets.selected, x = s.intersections[0], a = x.approaches[0], R = app.roundaboutGeometry, G = app.intersectionGeometry;
        const L = R.layout(x).legs.get(a.id), start = Math.min(...a.inLanes.slice(1).map((_, i) => L.goreStart(i + 1)));
        const points = [0, a.incoming].flatMap(k => L.line(sp => L.entryOff(k, sp), start - 5, L.entryMeet(sp => L.entryOff(k, sp)) + 4)).map(p => G.add(x, G.mul(p, 12 / s.inchesPerPixel)));
        const xs = points.map(p => p.x), ys = points.map(p => p.y), pad = 35;
        const svg = s.roadLayer.cloneNode(true); svg.id = 'gorePreview';
        svg.setAttribute('viewBox', `${Math.min(...xs) - pad} ${Math.min(...ys) - pad} ${Math.max(...xs) - Math.min(...xs) + 2 * pad} ${Math.max(...ys) - Math.min(...ys) + 2 * pad}`);
        svg.style.cssText = 'position:fixed;right:0;top:0;width:900px;height:800px;z-index:9999;transform:none;background:white';
        document.body.append(svg);
      });
      await page.locator('#gorePreview').screenshot({ path: `${process.env.SHOTS}/${name}.png` });
      await page.locator('#gorePreview').evaluate(e => e.remove());
    };
    const center = await page.evaluate(() => {
      const p = StripeMaker.sheets.toScreen(StripeMaker.sheets.selected.intersections[0]), b = document.getElementById('previewStage').getBoundingClientRect();
      return { x: p.x + b.left, y: p.y + b.top };
    });
    await page.mouse.move(center.x, center.y);
    for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, -300); await page.waitForTimeout(70); }
    await page.waitForTimeout(200);
    const before = await state(), a = before.a;
    assert.equal(await page.getByRole('button', { name: /^Approach \d+ (entry|exit) curve$/ }).count(), 0);
    assert.equal(await page.getByRole('button', { name: /^Approach \d+ whole approach curve$/ }).count(), 4);
    const plus = k => page.locator(`[data-key="add-gore-${a.id}-${a.inLanes[k]}"]`);
    const choice = k => page.locator(`[id="intersection-rb-gore-type-${a.inLanes[k]}"]`);
    for (const k of [1, 2]) { await plus(k).focus(); await page.keyboard.press('Enter'); }
    const painted = await state();
    assert.equal(painted.a.incoming, 3, 'the + buttons still separate existing lanes');
    assert.equal(painted.islands.length, 0); assert.ok(painted.chevrons > 0);
    assert.equal(painted.valid, '');
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/roundabout-gore-size-handles.png` });
    const widthHandle = page.getByRole('button', { name: 'Approach 1 gore between entry lanes 1 and 2 width', exact: true });
    const lengthHandle = page.getByRole('button', { name: 'Approach 1 gore between entry lanes 1 and 2 length', exact: true });
    assert.equal(await page.getByRole('button', { name: /^Approach 1 gore between entry lanes .* (width|length)$/ }).count(), 4);
    await widthHandle.focus(); await widthHandle.press('ArrowUp');
    const wider = await state();
    assert.ok(wider.a.entryGores[a.inLanes[1]] > painted.a.entryGores[a.inLanes[1]], 'width square adjusts the gore');
    await page.locator('#undoButton').click(); assert.deepEqual((await state()).a, painted.a);
    await page.locator('#redoButton').click(); assert.deepEqual((await state()).a, wider.a);
    await page.locator('#undoButton').click();
    const tip = await lengthHandle.boundingBox();
    await page.mouse.move(tip.x + tip.width / 2, tip.y + tip.height / 2); await page.mouse.down();
    await page.mouse.move(tip.x + tip.width / 2 + 16, tip.y + tip.height / 2, { steps: 4 }); await page.mouse.up();
    const longer = await state();
    assert.ok(longer.a.entryGoreLengths[a.inLanes[1]] > 42, 'tip drag lengthens the gore');
    assert.equal(longer.a.entryGores[a.inLanes[1]], 6, 'tip drag keeps its width');
    await page.locator('#undoButton').click(); assert.deepEqual((await state()).a, painted.a);
    await detail('roundabout-curved-chevron-detail');
    await selectChoice(choice(1), 'curbed');
    assert.equal((await state()).islands.length, 1);
    assert.deepEqual((await state()).tracks, painted.tracks);
    await page.locator('#undoButton').click();
    assert.equal((await state()).islands.length, 0);
    await page.locator('#redoButton').click();
    assert.equal((await state()).islands.length, 1);
    await selectChoice(choice(2), 'curbed');
    const curbed = await state();
    assert.equal(curbed.islands.length, 2); assert.equal(curbed.chevrons, 0); assert.equal(curbed.valid, '');
    assert.deepEqual(curbed.tracks, painted.tracks, 'surface conversion preserves every lane');
    assert.notEqual(curbed.paint, painted.paint, 'concrete and curb render in the exportable road layer');
    await detail('roundabout-curbed-gore-detail');
    await lengthHandle.focus(); await lengthHandle.press('ArrowRight');
    assert.ok((await state()).a.entryGoreLengths[a.inLanes[1]] > 42, 'curbed gore uses the same length handle');
    await page.locator('#undoButton').click();
    const anchor = await page.evaluate(() => {
      const app = StripeMaker, s = app.sheets.selected, a = s.intersections[0].approaches[0];
      const edge = app.intersections.boundaries(s).edges.find(e => e.on.side === `gore-${a.inLanes[2]}`);
      const p = edge[Math.floor(edge.length / 3)], end = app.markings.auditSnap(s, p);
      return { end, p, side: edge.on.side };
    });
    assert.equal(anchor.end.on?.side, anchor.side, 'crosswalk snaps to the new island curb');
    const width1 = page.locator(`[id="intersection-rb-gore-${a.inLanes[1]}"]`);
    await width1.fill('0'); await width1.blur();
    assert.equal((await state()).a.entryGoreTypes[a.inLanes[1]], undefined);
    assert.equal(await plus(1).count(), 1, 'removing the island restores its +');
    const clearance = await page.evaluate(end => {
      const app = StripeMaker, s = app.sheets.selected, p = app.markings.auditEnd(s, end);
      const edge = app.intersections.boundaries(s).edges.find(e => e.on.side === end.on.side);
      return Math.min(...edge.slice(1).map((q, i) => {
        const a = edge[i], dx = q.x - a.x, dy = q.y - a.y;
        const f = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
        return Math.hypot(p.x - a.x - dx * f, p.y - a.y - dy * f);
      }));
    }, anchor.end);
    assert.ok(clearance < 1e-5, 'removing another gore keeps the anchor on its moved curb');
    await page.locator('#undoButton').click();
    assert.equal((await state()).islands.length, 2);
    await selectChoice(choice(1), 'painted');
    assert.equal((await state()).islands.length, 1); assert.ok((await state()).chevrons > 0);
    await page.locator('#undoButton').click();
    await lengthHandle.focus(); await lengthHandle.press('ArrowRight');
    const current = await state();
    await page.getByRole('button', { name: 'Intersections', exact: true }).click();
    await page.locator('#duplicateIntersection').click();
    const copy = await state(1);
    assert.equal(copy.islands.length, 2);
    assert.notEqual(copy.a.inLanes[1], a.inLanes[1]);
    for (const lane of copy.a.inLanes.slice(1)) assert.equal(copy.a.entryGoreTypes[lane], 'curbed', 'duplicate remaps gore treatment keys');
    assert.equal(copy.a.entryGoreLengths[copy.a.inLanes[1]], current.a.entryGoreLengths[a.inLanes[1]], 'duplicate remaps gore lengths');
    const project = await page.evaluate(() => StripeMaker.projectJSON.snapshot('selected'));
    await page.evaluate(project => StripeMaker.projectJSON.load(project), project);
    assert.deepEqual((await state()).a.entryGoreTypes, current.a.entryGoreTypes);
    assert.deepEqual((await state()).a.entryGoreLengths, current.a.entryGoreLengths);
    await page.waitForTimeout(800); await page.reload();
    await page.waitForFunction(() => StripeMaker.sheets.ready && StripeMaker.sheets.selected?.intersections?.length);
    assert.deepEqual((await state()).a.entryGoreTypes, current.a.entryGoreTypes);
    assert.equal((await state()).islands.length, 2); assert.equal((await state()).valid, '');
    assert.deepEqual(errors, []);
    console.log('roundabout gore browser tests passed: removed handles, + buttons, treatments, lane geometry, undo/redo, curb snapping, duplicate, JSON and reload');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
