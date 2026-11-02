/* Isolated browser; same environment as roundabouts.browser.cjs. */
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
    await page.waitForFunction(() => StripeMaker.sheets.selected?.inchesPerPixel);
    await page.getByRole('button', { name: 'Intersections', exact: true }).click();
    await page.locator('#newRoundabout').click();
    const center = await page.evaluate(() => {
      const p = StripeMaker.sheets.toScreen(StripeMaker.sheets.selected.intersections[0]);
      const box = document.getElementById('previewStage').getBoundingClientRect();
      return { x: p.x + box.left, y: p.y + box.top };
    });
    await page.mouse.move(center.x, center.y);
    for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, -300); await page.waitForTimeout(50); }
    await page.waitForTimeout(200);
    const state = () => page.evaluate(() => {
      const s = StripeMaker.sheets.selected, x = s.intersections[0], R = StripeMaker.roundaboutGeometry;
      return { item: structuredClone(x), joints: structuredClone(s.joints), diameter: R.diameter(x), valid: R.validate(x) };
    });
    const close = (a, b, message) => {
      assert.ok(Math.abs(a.diameter - b.diameter) < 1e-8, `${message}: diameter`);
      for (let i = 0; i < a.item.approaches.length; i++) {
        const p = a.item.approaches[i], q = b.item.approaches[i];
        assert.ok(Math.hypot(p.x - q.x, p.y - q.y) < 1e-6, `${message}: approach ${i+1} (${p.x}, ${p.y}) vs (${q.x}, ${q.y})`);
        for (const field of ['angle', 'bend', 'width', 'outWidth', 'incoming', 'outgoing', 'median']) assert.equal(p[field], q[field], `${message}: ${field}`);
        assert.deepEqual(p.links, q.links, `${message}: connections`);
      }
      for (let i = 0; i < a.joints.length; i++) assert.ok(Math.hypot(a.joints[i].x - b.joints[i].x, a.joints[i].y - b.joints[i].y) < 1e-6, `${message}: linked joint`);
    };
    async function drag(feet, steps, action = 'release') {
      const box = await page.getByRole('button', { name: 'Roundabout diameter', exact: true }).boundingBox();
      const p = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      const hit = await page.evaluate(p => document.elementFromPoint(p.x, p.y)?.closest('[data-key]')?.dataset.key, p);
      assert.ok(hit?.startsWith('diameter-'), `resize handle is exposed at ${p.x}, ${p.y}: ${hit}`);
      const pf = await page.evaluate(() => 12 / StripeMaker.sheets.selected.inchesPerPixel * StripeMaker.sheets.selected.view.scale);
      const length = Math.hypot(p.x - center.x, p.y - center.y);
      const delta = { x: (p.x - center.x) / length * feet * pf, y: (p.y - center.y) / length * feet * pf };
      await page.mouse.move(p.x, p.y); await page.mouse.down();
      await page.mouse.move(p.x + delta.x, p.y + delta.y, { steps });
      const status = await page.locator('#intersectionStatus').textContent();
      if (action === 'return') await page.mouse.move(p.x, p.y, { steps });
      if (action === 'cancel') await page.keyboard.press('Escape');
      await page.mouse.up();
      return { ...await state(), status };
    }
    for (const kind of ['regular', 'mini', 'oval', 'peanut']) {
      await page.evaluate(kind => {
        const app = StripeMaker, s = app.sheets.selected, R = app.roundaboutGeometry, G = app.intersectionGeometry;
        const old = s.intersections[0], x = R.create();
        Object.assign(x, { id: old.id, x: old.x, y: old.y });
        if (kind === 'mini') {
          Object.assign(x.roundabout, { mini: true, icd: 75, laneWidth: 12 });
          for (const a of x.approaches) Object.assign(a, { median: 0, splitter: 30 });
        } else if (kind !== 'regular') {
          Object.assign(x.roundabout, { shape: kind, ratio: 1.4, icd: 220 });
          x.approaches[1].incoming = 2;
        }
        R.normalize(x);
        for (const a of x.approaches) Object.assign(a, G.mul(G.axes(a).u, R.requiredReach(x, a)));
        R.setApproachBend(x.approaches[0], 2);
        s.intersections = [x]; s.roads = []; s.joints = [];
        // A lane-linked incoming road follows the resized mouth; its distant
        // endpoint must remain where it was.
        const a = x.approaches[0], k = 12 / s.inchesPerPixel, p = G.add(x, G.mul(G.lane(a, true, 0), k)), u = G.axes(a).u;
        s.roads.push({ id: 900, lanes: 1, laneWidth: 12, ends: [{ joint: 900, sign: 1, length: null }, { joint: 901, sign: 1, length: null }] });
        s.joints.push({ id: 900, x: p.x + u.x * 300 * k, y: p.y + u.y * 300 * k, dir: G.mul(u, -1), root: 900, links: [] },
          { id: 901, x: p.x, y: p.y, dir: G.mul(u, -1), root: 900, links: [] });
        a.links = [{ road: 900, e: 1, lane: 0, to: a.inLanes[0] }];
        app.roadEditor.render(); app.history.record(); app.sheets.save(s);
        app.intersections.focusAt(x);
        document.dispatchEvent(new CustomEvent('sheetchange'));
      }, kind);
      const before = await state();
      assert.equal(before.valid, '', `${kind}: starting geometry is valid`);
      const fast = await drag(20, 1);
      assert.ok(fast.diameter > before.diameter + 30, `${kind}: diameter actually increases (${before.diameter} → ${fast.diameter}; ${fast.status})`);
      await page.locator('#undoButton').click(); close(await state(), before, 'undo single drag');
      const slow = await drag(20, 40);
      close(slow, fast, `${kind}: drag speed does not change approach length`);
      assert.equal(slow.valid, '');
      assert.deepEqual([slow.joints[0].x, slow.joints[0].y], [before.joints[0].x, before.joints[0].y], 'far end of attached road stays fixed');
      const scale = await page.evaluate(() => 12 / StripeMaker.sheets.selected.inchesPerPixel);
      const a = slow.item.approaches[0], b = before.item.approaches[0];
      assert.ok(Math.abs(slow.joints[1].x - before.joints[1].x - (a.x - b.x) * scale) < 1e-6);
      assert.ok(Math.abs(slow.joints[1].y - before.joints[1].y - (a.y - b.y) * scale) < 1e-6);
      await page.locator('#undoButton').click(); close(await state(), before, 'one undo restores the entire resize');
      await page.locator('#redoButton').click(); close(await state(), slow, 'redo restores the resize');
      await page.locator('#undoButton').click();
      close(await drag(20, 25, 'return'), before, `${kind}: dragging out and back restores the original approaches`);
      close(await drag(20, 25, 'cancel'), before, `${kind}: Escape restores the roundabout and road`);
      const shrinkFast = await drag(-8, 1);
      await page.locator('#undoButton').click();
      close(await drag(-8, 30), shrinkFast, `${kind}: shrinking is independent of pointer event count`);
      await page.locator('#undoButton').click();
      console.log(`${kind}: repeated resize, return, cancel, undo/redo, attached road passed`);
    }
    assert.deepEqual(errors, []);
    console.log('roundabout resize browser regression passed');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
