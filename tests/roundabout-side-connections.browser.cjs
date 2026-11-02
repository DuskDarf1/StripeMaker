/* Isolated Chromium; same environment as roundabout-bezier.browser.cjs. */
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } }), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(process.env.STRIPEMAKER_URL || 'http://127.0.0.1:8876');
    await page.waitForFunction(() => StripeMaker.sheets.ready && StripeMaker.intersections);
    await page.locator('#blankSheet').evaluate(b => b.click());
    await page.getByRole('button', { name: 'Intersections', exact: true }).click();
    await page.locator('#newRoundabout').click();
    await page.evaluate(() => {
      const app = StripeMaker, s = app.sheets.selected, x = s.intersections[0], a = x.approaches[0], G = app.intersectionGeometry;
      a.x += 100;
      const near = G.add(x, G.mul(a, 12 / s.inchesPerPixel)), far = { x: near.x + 800, y: near.y };
      s.roads = [
        { id: 1, lanes: 1, laneWidth: 12, ends: [{ joint: 2, sign: -1, length: null }, { joint: 1, sign: -1, length: null }] },
        { id: 2, lanes: 1, laneWidth: 12, ends: [{ joint: 1, sign: 1, length: null }, { joint: 2, sign: 1, length: null }] },
      ];
      const link = { a: 1, ai: 0, b: 2, bi: 0, pair: true, median: a.median };
      s.joints = [{ id: 1, ...near, dir: { x: 1, y: 0 }, root: 1, links: [link] },
        { id: 2, ...far, dir: { x: 1, y: 0 }, root: 1, links: [{ ...link }] }];
      a.binding = { road: 1, e: 1 }; delete a.links;
      const next = G.create(), west = next.approaches[2];
      next.x = far.x - west.x * 12 / s.inchesPerPixel; next.y = far.y;
      west.median = a.median; west.binding = { road: 2, e: 1 };
      s.intersections.push(next);
      app.roadEditor.render(); app.sheets.save(s); app.history.record();
      document.dispatchEvent(new CustomEvent('sheetchange'));
    });
    const state = () => page.evaluate(() => {
      const app = StripeMaker, s = app.sheets.selected, x = s.intersections[0], a = x.approaches[0], G = app.intersectionGeometry, R = app.roundaboutGeometry;
      const tracks = app.roadEditor.laneTracks(s), solve = app.roadEditor.solve(s);
      const exit = tracks.find(t => t.road === 2);
      return { a: structuredClone(a), intersections: structuredClone(s.intersections), roads: structuredClone(s.roads), joints: structuredClone(s.joints),
        paired: Boolean(app.roadEditor.pairOf(s, s.roads[0])), valid: R.validate(x),
        mouths: [true, false].map(incoming => {
          const pose = R.approachLane(x, a, incoming, 0), road = s.roads.find(r => r.id === (incoming ? 1 : 2));
          const at = solve.get(`${road.id}:${incoming ? 1 : 0}`), direction = G.mul(at.travel, incoming ? -1 : 1);
          return { p: G.add(x, G.mul(pose.p, 12 / s.inchesPerPixel)), u: pose.u, actual: { x: at.x, y: at.y }, direction };
        }),
        far: [solve.get('1:0'), solve.get('2:1')].map(p => ({ x: p.x, y: p.y })),
        exit: exit.line.map((p, i) => {
          const d = (exit.laneBounds[i][0][0] + exit.laneBounds[i][0][1]) / 2;
          return { x: p.x - p.tangent.y * d, y: p.y + p.tangent.x * d };
        }) };
    });
    const close = (a, b) => assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 1e-5, `${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`);
    const check = s => {
      assert.equal(s.valid, '');
      for (const mouth of s.mouths) { close(mouth.p, mouth.actual); close(mouth.u, mouth.direction); }
    };
    const center = await page.evaluate(() => {
      const p = StripeMaker.sheets.toScreen(StripeMaker.sheets.selected.intersections[0]), b = document.getElementById('previewStage').getBoundingClientRect();
      return { x: p.x + b.left, y: p.y + b.top };
    });
    await page.mouse.move(center.x, center.y);
    for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, -300); await page.waitForTimeout(70); }
    await page.waitForTimeout(200);
    const initial = await state(); check(initial); assert.equal(initial.paired, true);
    assert.equal(await page.getByRole('button', { name: /^Approach 1 median (entry|exit) (connection|circle) corner$/ }).count(), 4);
    const corner = page.getByRole('button', { name: 'Approach 1 median entry connection corner', exact: true });
    const box = await corner.boundingBox(), from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    assert.equal(await page.evaluate(p => document.elementFromPoint(p.x, p.y)?.getAttribute('aria-label'), from),
      'Approach 1 median entry connection corner', JSON.stringify(await page.getByRole('button', { name: /^Approach 1 median/ }).evaluateAll(es => es.map(e => ({label:e.getAttribute('aria-label'),x:e.getAttribute('x'),y:e.getAttribute('y')})))));
    await page.mouse.move(from.x, from.y); await page.mouse.down();
    await page.mouse.move(from.x + 15, from.y - 8, { steps: 5 }); await page.mouse.up();
    const shifted = await state(); check(shifted);
    assert.equal(shifted.paired, false, 'moving one median corner separates paired road ends');
    assert.ok(Math.hypot(shifted.mouths[0].p.x - initial.mouths[0].p.x, shifted.mouths[0].p.y - initial.mouths[0].p.y) > 1,
      JSON.stringify({ before: initial.mouths[0], after: shifted.mouths[0], edit: shifted.a.bezierSides }));
    close(shifted.mouths[1].p, initial.mouths[1].p);
    initial.far.forEach((p, i) => close(p, shifted.far[i]));
    assert.equal(shifted.a.links.length, 2); assert.equal(shifted.intersections[1].approaches[2].links.length, 2);
    await page.locator('#undoButton').click(); check(await state());
    assert.deepEqual((await state()).intersections, initial.intersections);
    assert.deepEqual((await state()).roads, initial.roads);
    await page.locator('#redoButton').click(); check(await state());
    assert.deepEqual((await state()).a.bezierSides, shifted.a.bezierSides);
    await page.locator('#undoButton').click();
    const entry = page.getByRole('button', { name: 'Approach 1 entry connection Bézier handle', exact: true });
    await entry.focus(); await entry.press('ArrowUp');
    const bent = await state(); check(bent);
    assert.equal(bent.paired, false, 'the two directions get independently aligned road ends');
    assert.equal(bent.roads.length, 2, 'existing roads retain their IDs');
    assert.equal(bent.a.links.length, 2, 'both directions stay connected');
    assert.equal(bent.intersections[1].approaches[2].links.length, 2, 'the far intersection retains both lane connections');
    initial.far.forEach((p, i) => close(p, bent.far[i]));
    assert.ok(bent.exit.every(p => Math.abs(p.y - initial.exit[0].y) < 1e-5), 'opposite road stays straight and in place');
    await page.locator('#undoButton').click();
    const undone = await state(); check(undone);
    assert.deepEqual(undone.roads, initial.roads); assert.deepEqual(undone.joints, initial.joints);
    assert.deepEqual(undone.intersections, initial.intersections);
    await page.locator('#redoButton').click(); check(await state());
    const exit = page.getByRole('button', { name: 'Approach 1 exit connection Bézier handle', exact: true });
    await exit.focus(); await exit.press('ArrowDown');
    const both = await state(); check(both);
    assert.deepEqual(both.a.bezierSides.entry, bent.a.bezierSides.entry);
    initial.far.forEach((p, i) => close(p, both.far[i]));
    const circle = page.getByRole('button', { name: 'Approach 1 median exit circle corner', exact: true });
    await circle.focus(); await circle.press('ArrowDown');
    const positioned = await state(); check(positioned);
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/roundabout-median-corners.png` });
    assert.ok(Number.isFinite(positioned.a.bezierSides.exit.corner));
    both.mouths.forEach((m, i) => close(m.p, positioned.mouths[i].p));
    const cornerBox = await circle.boundingBox();
    await page.mouse.move(cornerBox.x + 4, cornerBox.y + 4); await page.mouse.down();
    await page.mouse.move(cornerBox.x + 4, cornerBox.y + 12); await page.keyboard.press('Escape'); await page.mouse.up();
    assert.deepEqual((await state()).a.bezierSides, positioned.a.bezierSides, 'Escape restores the corner drag');
    await page.getByRole('button', { name: 'Reset Median Corners', exact: true }).click();
    const reset = await state(); check(reset);
    assert.equal(reset.a.bezierSides.exit.corner, undefined);
    assert.deepEqual(reset.a.bezierSides.exit.mouth, positioned.a.bezierSides.exit.mouth, 'reset corners retains Bézier controls');
    await page.locator('#undoButton').click();
    assert.deepEqual((await state()).a.bezierSides, positioned.a.bezierSides);
    const saved = await page.evaluate(() => StripeMaker.projectJSON.snapshot('selected'));
    await page.evaluate(saved => StripeMaker.projectJSON.load(saved), saved);
    check(await state()); assert.deepEqual((await state()).a, positioned.a);
    await page.waitForTimeout(800); await page.reload();
    await page.waitForFunction(() => StripeMaker.sheets.ready && StripeMaker.sheets.selected?.intersections?.length);
    check(await state()); assert.deepEqual((await state()).a, positioned.a);
    for (const incoming of [true, false]) {
      await page.evaluate(incoming => {
        const app = StripeMaker, s = app.sheets.selected, x = s.intersections[0], a = x.approaches[0];
        s.roads = []; s.joints = []; s.intersections = [x]; delete a.links; delete a.binding;
        a.incoming = incoming ? 1 : 0; a.outgoing = incoming ? 0 : 1;
        delete a.bezierSides; app.roundaboutGeometry.normalize(x); app.roadEditor.render();
        const L = app.roundaboutGeometry.layout(x).legs.get(a.id), off = incoming ? L.entryBounds(0, 10).reduce((p, q) => p + q) / 2
          : (L.exitOff(0, 10) + L.exitOff(1, 10)) / 2;
        if (!app.intersections.focusAt(app.intersectionGeometry.add(x, app.intersectionGeometry.mul(L.P(off, 10), 12 / s.inchesPerPixel))))
          throw Error('Could not select the one-way approach pavement');
      }, incoming);
      const label = page.getByRole('button', { name: 'Select approach 1', exact: true });
      await label.focus(); await label.press('Enter');
      const side = incoming ? 'entry' : 'exit';
      assert.equal(await page.getByRole('button', { name: /Bézier handle$/ }).count(), 2, 'one-way legs show only the existing side');
      assert.equal(await page.getByRole('button', { name: /^Approach 1 median .* corner$/ }).count(), 0, 'one-way legs have no median corners');
      const handle = page.getByRole('button', { name: `Approach 1 ${side} connection Bézier handle`, exact: true });
      await handle.focus(); await handle.press(incoming ? 'ArrowUp' : 'ArrowDown');
      assert.equal(await page.evaluate(() => StripeMaker.roundaboutGeometry.validate(StripeMaker.sheets.selected.intersections[0])), '');
    }
    assert.deepEqual(errors, []);
    console.log('roundabout side connections passed: corner drag/keyboard/reset, paired roads, far connections, independent tangents, undo/redo/Escape, JSON/reload and one-way handles');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
