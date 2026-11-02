/* Isolated Chromium; same environment as roundabouts.browser.cjs. */
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } }), errors = [];
    page.setDefaultTimeout(10000);
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(process.env.STRIPEMAKER_URL || 'http://127.0.0.1:8876');
    await page.waitForFunction(() => StripeMaker.sheets.ready && StripeMaker.roundaboutGeometry && StripeMaker.roadEditor);
    await page.locator('#blankSheet').evaluate(b => b.click());
    await page.waitForFunction(() => StripeMaker.sheets.selected?.inchesPerPixel);
    await page.getByRole('button', { name: 'Intersections', exact: true }).click();
    await page.locator('#newRoundabout').click();
    await page.evaluate(() => {
      const app = StripeMaker, s = app.sheets.selected, x = s.intersections[0], a = x.approaches[0], G = app.intersectionGeometry;
      a.x += 100;
      const p = G.add(x, G.mul(G.lane(a, true, 0), 12 / s.inchesPerPixel));
      s.roads.push({ id: 100, lanes: 1, laneWidth: 12, ends: [{ joint: 100, sign: 1, length: null }, { joint: 101, sign: 1, length: null, dir: { x: -1, y: 0 } }] });
      s.joints.push({ id: 100, x: p.x + 600, y: p.y, dir: { x: -1, y: 0 }, root: 100, links: [] },
        { id: 101, x: p.x, y: p.y, dir: { x: -1, y: 0 }, root: 100, links: [] });
      app.intersections.linkLane(s, { intersection: x.id, approach: a.id, to: a.inLanes[0] }, { road: 100, e: 1 }, 0);
      const out = G.add(x, G.mul(G.lane(a, false, 0), 12 / s.inchesPerPixel));
      s.roads.push({ id: 200, lanes: 1, laneWidth: 12, ends: [{ joint: 200, sign: 1, length: null }, { joint: 201, sign: 1, length: null }] });
      s.joints.push({ id: 200, ...out, dir: { x: 1, y: 0 }, root: 200, links: [] },
        { id: 201, x: out.x + 600, y: out.y, dir: { x: 1, y: 0 }, root: 200, links: [] });
      app.intersections.linkLane(s, { intersection: x.id, approach: a.id, to: a.outLanes[0] }, { road: 200, e: 0 }, 0);
      app.roadEditor.render(); app.sheets.save(s); app.history.record();
      document.dispatchEvent(new CustomEvent('sheetchange'));
    });
    const panel = page.locator('#intersectionEditor');
    const state = () => page.evaluate(() => {
      const app = StripeMaker, s = app.sheets.selected, x = s.intersections[0], a = x.approaches[0], R = app.roundaboutGeometry, G = app.intersectionGeometry;
      const connections = [true, false].map(incoming => {
        const end = app.roadEditor.intersectionEnd(s, { road: incoming ? 100 : 200, e: incoming ? 1 : 0 });
        const roadLane = G.add(end, G.mul(G.axes(end).n, (incoming ? -1 : 1) * end.width / 2 * 12 / s.inchesPerPixel));
        const pose = R.approachLane(x, a, incoming, 0);
        return { end: { ...roadLane, angle: end.angle }, mouth: G.add(x, G.mul(pose.p, 12 / s.inchesPerPixel)), angle: pose.angle };
      });
      return { a: structuredClone(a), item: structuredClone(x), valid: R.validate(x),
        entry: R.layout(x).legs.get(a.id).line(sp => R.layout(x).legs.get(a.id).entryOff(1, sp)),
        exit: R.layout(x).legs.get(a.id).line(sp => R.layout(x).legs.get(a.id).exitOff(1, sp)),
        turns: x.approaches.map(b => x.approaches.map(c => R.turnOf(x, b, c))),
        connections,
        paint: s.roadLayer.innerHTML };
    });
    const connected = value => {
      for (const c of value.connections) {
        assert.ok(Math.hypot(c.end.x - c.mouth.x, c.end.y - c.mouth.y) < 1e-5, 'linked road follows its own lane mouth');
        assert.ok(Math.abs(((c.end.angle - c.angle + 540) % 360) - 180) < 1e-6, 'linked road shares its own Bézier tangent');
      }
      assert.equal(value.valid, '');
    };
    const center = await page.evaluate(() => {
      const p = StripeMaker.sheets.toScreen(StripeMaker.sheets.selected.intersections[0]), b = document.getElementById('previewStage').getBoundingClientRect();
      return { x: p.x + b.left, y: p.y + b.top };
    });
    await page.mouse.move(center.x, center.y);
    for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, -300); await page.waitForTimeout(70); }
    await page.waitForTimeout(200);
    const whole = page.getByRole('button', { name: 'Approach 1 whole approach curve', exact: true });
    const initial = await state();
    assert.equal(await page.getByRole('button', { name: /Bézier handle$/ }).count(), 4, 'both ends of both sides are visible immediately');
    const entry = page.getByRole('button', { name: 'Approach 1 entry circle Bézier handle', exact: true });
    const entryMouth = page.getByRole('button', { name: 'Approach 1 entry connection Bézier handle', exact: true });
    const exitMouth = page.getByRole('button', { name: 'Approach 1 exit connection Bézier handle', exact: true });
    await entry.focus(); await entry.press('ArrowUp');
    const entryOnly = await state(); connected(entryOnly);
    assert.ok(entryOnly.a.bezierSides.entry);
    assert.notDeepEqual(entryOnly.entry, initial.entry);
    assert.deepEqual(entryOnly.exit, initial.exit, 'entry edit leaves the exit untouched');
    assert.deepEqual(entryOnly.turns, initial.turns);
    const exit = page.getByRole('button', { name: 'Approach 1 exit circle Bézier handle', exact: true });
    assert.equal(await entry.count(), 1, 'both sides remain available on the drawing');
    await exit.focus(); await exit.press('ArrowDown');
    const separate = await state(); connected(separate);
    assert.deepEqual(separate.entry, entryOnly.entry, 'exit edit leaves the entry untouched');
    assert.notDeepEqual(separate.exit, entryOnly.exit);
    await page.locator('#undoButton').click();
    assert.deepEqual((await state()).a, entryOnly.a);
    await page.locator('#redoButton').click();
    assert.deepEqual((await state()).a, separate.a);
    await panel.getByRole('button', { name: 'Reset Entry Curve', exact: true }).click();
    assert.equal((await state()).a.bezierSides.entry, undefined);
    assert.deepEqual((await state()).a.bezierSides.exit, separate.a.bezierSides.exit);
    await page.locator('#undoButton').click();
    assert.deepEqual((await state()).a, separate.a);
    const drag = async (locator, dx, dy, cancel = false) => {
      const box = await locator.boundingBox(), p = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      await page.mouse.move(p.x, p.y); await page.mouse.down();
      await page.mouse.move(p.x + dx, p.y + dy, { steps: 5 });
      if (cancel) await page.keyboard.press('Escape');
      await page.mouse.up();
    };
    await drag(entryMouth, 0, -8);
    const entryRoad = await state(); connected(entryRoad);
    assert.ok(entryRoad.a.bezierSides.entry.mouth.offset < 0);
    assert.deepEqual(entryRoad.exit, separate.exit, 'entry mouth leaves the exit curve unchanged');
    assert.deepEqual(entryRoad.connections[1], separate.connections[1], 'opposite connected road stays in place');
    const target = await page.evaluate(() => {
      const app = StripeMaker, s = app.sheets.selected, x = s.intersections[0], a = x.approaches[0], pose = app.roundaboutGeometry.approachLane(x, a, true, 0);
      const at = app.intersectionGeometry.add(x, app.intersectionGeometry.mul(pose.p, 12 / s.inchesPerPixel));
      return { pose, snap: app.intersections.laneAt(s, { road: 100, e: 1 }, at) };
    });
    assert.ok(target.snap); assert.equal(target.snap.angle, target.pose.angle, 'road snapping uses the independently curved mouth');
    await exitMouth.focus(); await exitMouth.press('ArrowDown');
    const sideMouths = await state(); connected(sideMouths);
    assert.deepEqual(sideMouths.entry, entryRoad.entry, 'exit mouth leaves the entry curve unchanged');
    await page.locator('#undoButton').click();
    assert.deepEqual((await state()).a, entryRoad.a); connected(await state());
    await page.locator('#redoButton').click();
    assert.deepEqual((await state()).a, sideMouths.a); connected(await state());
    await drag(entryMouth, 0, -5, true);
    assert.deepEqual((await state()).a, sideMouths.a, 'Escape restores the side curve'); connected(await state());
    await page.getByRole('button', { name: 'Select approach 2', exact: true }).click();
    assert.equal(await entry.count(), 0, 'only the selected approach shows curve controls');
    assert.equal(await page.getByRole('button', { name: /^Approach 2 .*Bézier handle$/ }).count(), 4);
    await page.getByRole('button', { name: 'Select approach 1', exact: true }).click();
    assert.equal(await entry.count(), 1);
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/roundabout-side-bezier.png` });
    const original = await state(); connected(original);
    await whole.dblclick();
    const mouth = page.getByRole('button', { name: 'Approach 1 connection Bézier handle', exact: true });
    const circle = page.getByRole('button', { name: 'Approach 1 circle Bézier handle', exact: true });
    await mouth.waitFor({ state: 'visible' });
    assert.equal(await page.getByRole('button', { name: /Bézier handle$/ }).count(), 2);
    assert.deepEqual((await state()).a, original.a, 'showing whole-approach handles does not change geometry');
    await drag(mouth, 0, 8);
    const bent = await state(); connected(bent);
    assert.ok(bent.a.bezier.mouth.offset > 0);
    assert.notEqual(bent.a.angle, original.a.angle);
    assert.deepEqual(bent.turns, original.turns);
    assert.notEqual(bent.paint, original.paint);
    assert.deepEqual([bent.a.x, bent.a.y], [original.a.x, original.a.y]);
    await page.locator('#undoButton').click();
    assert.deepEqual((await state()).a, original.a); connected(await state());
    await page.locator('#redoButton').click();
    assert.deepEqual((await state()).a, bent.a); connected(await state());
    await circle.focus(); await circle.press('ArrowUp');
    const both = await state(); connected(both);
    assert.ok(both.a.bezier.circle.offset < 0);
    await drag(mouth, 0, 5, true);
    assert.deepEqual((await state()).a, both.a, 'Escape restores the entire curve and linked road'); connected(await state());
    await drag(whole, 7, 4);
    const moved = await state(); connected(moved);
    assert.deepEqual(moved.a.bezier, both.a.bezier, 'moving the whole leg preserves both control vectors');
    assert.notEqual(moved.a.x, both.a.x); assert.notEqual(moved.a.y, both.a.y);
    await panel.getByRole('button', { name: 'Hide Bézier Handles', exact: true }).click();
    assert.equal(await mouth.count(), 0);
    await panel.getByRole('button', { name: 'Edit Whole Approach Curve', exact: true }).click();
    await mouth.waitFor({ state: 'visible' });
    const set = async (id, value) => { await page.locator(id).fill(String(value)); await page.locator(id).blur(); };
    const span = await page.evaluate(() => {
      const x = StripeMaker.sheets.selected.intersections[0]; return StripeMaker.roundaboutGeometry.layout(x).legs.get(x.approaches[0].id).S0;
    });
    await set('#intersection-rb-icd', 180);
    connected(await state());
    assert.ok(Math.abs(await page.evaluate(() => {
      const x = StripeMaker.sheets.selected.intersections[0]; return StripeMaker.roundaboutGeometry.layout(x).legs.get(x.approaches[0].id).S0;
    }) - span) < 0.02, 'resizing the circle keeps the Bézier leg length');
    const beforeRotate = await state();
    await set('#intersection-rb-rotate', 30);
    const rotated = await state(); connected(rotated);
    assert.equal(rotated.a.bezier.axis, (beforeRotate.a.bezier.axis + 30) % 360);
    assert.deepEqual(rotated.a.bezier.mouth, beforeRotate.a.bezier.mouth);
    assert.deepEqual(rotated.turns, original.turns);
    await panel.getByRole('button', { name: 'Straighten Whole Approach', exact: true }).click();
    assert.equal((await state()).a.bezier, undefined); connected(await state());
    assert.equal((await state()).a.bezierSides, undefined);
    await page.locator('#undoButton').click();
    assert.deepEqual((await state()).a, rotated.a); connected(await state());
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/roundabout-bezier.png` });
    const project = await page.evaluate(() => StripeMaker.projectJSON.snapshot('selected'));
    await page.evaluate(project => StripeMaker.projectJSON.load(project), project);
    assert.deepEqual((await state()).a, rotated.a); connected(await state());
    await page.waitForTimeout(800); await page.reload();
    await page.waitForFunction(() => StripeMaker.sheets.ready && StripeMaker.sheets.selected?.intersections?.length);
    assert.deepEqual((await state()).a, rotated.a); connected(await state());
    assert.deepEqual(errors, []);
    console.log('roundabout Bézier browser tests passed: handles, attached road tangent, drag/keyboard, undo/redo/Escape, resize/rotate, straighten, JSON and reload');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
