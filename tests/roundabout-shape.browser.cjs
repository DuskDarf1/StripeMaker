/* Isolated browser; run with STRIPEMAKER_URL=file:///.../index.html. */
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const playwright = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const webkit = process.env.BROWSER === 'webkit';
  const executablePath = webkit ? process.env.WEBKIT_PATH : process.env.CHROME_PATH;
  const browser = await playwright[webkit ? 'webkit' : 'chromium'].launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } }), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(process.env.STRIPEMAKER_URL || pathToFileURL(path.resolve(__dirname, '../index.html')).href);
    await page.waitForFunction(() => StripeMaker.sheets.ready && StripeMaker.intersections);
    await page.locator('#blankSheet').evaluate(b => b.click());
    await page.waitForFunction(() => StripeMaker.sheets.selected?.inchesPerPixel);
    await page.getByRole('button', { name: 'Intersections', exact: true }).click();
    await page.locator('#newRoundabout').click();
    await page.evaluate(() => {
      const app = StripeMaker, s = app.sheets.selected, x = s.intersections[0];
      // Keep both handles clear of the editor, independently of browser wheel scaling.
      s.view = { scale: .2, x: 900 - x.x * .2, y: 520 - x.y * .2, fitted: false };
      app.sheets.zoomBy(1);
    });
    const state = () => page.evaluate(() => {
      const s = StripeMaker.sheets.selected, x = s.intersections[0], R = StripeMaker.roundaboutGeometry;
      return { item: structuredClone(x), ring: R.layout(x).outer.points, valid: R.validate(x) };
    });
    const close = (a, b, message) => {
      assert.ok(Math.abs(a.item.roundabout.ratio - b.item.roundabout.ratio) < 1e-6, `${message}: ratio ${a.item.roundabout.ratio} vs ${b.item.roundabout.ratio}`);
      assert.equal(a.item.roundabout.turn, b.item.roundabout.turn, `${message}: axis`);
      for (let i = 0; i < a.item.approaches.length; i++) {
        const p = a.item.approaches[i], q = b.item.approaches[i];
        assert.ok(Math.hypot(p.x - q.x, p.y - q.y) < 1e-4, `${message}: mouth ${i}`);
      }
    };
    function rotated(before, after, degrees) {
      const t = degrees * Math.PI / 180, c = Math.cos(t), s = Math.sin(t);
      assert.equal(after.item.roundabout.turn, (before.item.roundabout.turn + degrees + 360) % 360);
      assert.equal(after.valid, '');
      // Match every actual ring vertex, independent of the polar sort seam.
      for (const p of before.ring) {
        const x = p.x * c - p.y * s, y = p.x * s + p.y * c;
        assert.ok(after.ring.some(q => Math.hypot(x - q.x, y - q.y) < 1e-7), 'the actual ring rotates rigidly');
      }
      before.item.approaches.forEach((p, i) => {
        const q = after.item.approaches[i];
        assert.ok(Math.hypot(p.x * c - p.y * s - q.x, p.x * s + p.y * c - q.y) < 1e-7, 'approach rotates without stretching');
      });
    }
    async function drag(side, feet, steps = 1, cancel = false) {
      const handle = page.getByRole('button', { name: `Roundabout length ${side < 0 ? 'start' : 'end'}`, exact: true });
      const b = await handle.boundingBox(), p = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
      const key = await page.evaluate(p => document.elementFromPoint(p.x, p.y)?.closest('[data-key]')?.dataset.key, p);
      assert.ok(key?.startsWith('shape-length'), `shape handle is exposed: ${key}`);
      const delta = await page.evaluate(({ side, feet }) => {
        const s = StripeMaker.sheets.selected, sh = StripeMaker.roundaboutGeometry.shape(s.intersections[0]);
        const k = feet * side * 12 / s.inchesPerPixel * s.view.scale;
        return { x: sh.c * k, y: sh.s * k };
      }, { side, feet });
      await page.mouse.move(p.x, p.y); await page.mouse.down();
      await page.mouse.move(p.x + delta.x, p.y + delta.y, { steps });
      if (cancel) await page.keyboard.press('Escape');
      await page.mouse.up();
      return state();
    }
    for (const kind of ['oval', 'peanut']) {
      await page.evaluate(kind => {
        const app = StripeMaker, s = app.sheets.selected, R = app.roundaboutGeometry, G = app.intersectionGeometry;
        const old = s.intersections[0], x = R.create();
        Object.assign(x, { id: old.id, x: old.x, y: old.y });
        Object.assign(x.roundabout, { shape: kind, ratio: 1.4, icd: 220, turn: 45 });
        R.normalize(x);
        for (const a of x.approaches) Object.assign(a, G.mul(G.axes(a).u, R.requiredReach(x, a)));
        s.intersections = [x];
        app.roadEditor.render(); app.history.record(); app.sheets.save(s);
        app.intersections.focusAt(x);
        document.dispatchEvent(new CustomEvent('sheetchange'));
      }, kind);
      const before = await state();
      assert.equal(before.valid, '');
      const size = await page.getByRole('button', { name: 'Roundabout diameter', exact: true }).boundingBox();
      assert.ok((await page.evaluate(p => document.elementFromPoint(p.x, p.y)?.dataset.key,
        { x: size.x + size.width / 2, y: size.y + size.height / 2 }))?.startsWith('diameter-'),
      'diameter remains exposed when the long axis is in the widest gap');
      // Exercise the selection transform that previously missed the shape.
      await page.evaluate(() => StripeMaker.selection.rotate(37));
      rotated(before, await state(), 37);
      await page.locator('#undoButton').click(); close(await state(), before, 'rotation undo');
      await page.locator('#redoButton').click(); rotated(before, await state(), 37);
      await page.locator('#undoButton').click();
      // The panel must rotate the axis exactly once, too.
      const field = page.getByLabel('Rotate roundabout (°)', { exact: true });
      await field.fill('90'); await field.dispatchEvent('change');
      rotated(before, await state(), 90);
      await page.locator('#undoButton').click();
      const fast = await drag(1, 8);
      assert.ok(fast.item.roundabout.ratio > before.item.roundabout.ratio + .05, 'stretch changes shape');
      assert.equal(fast.item.roundabout.icd, before.item.roundabout.icd, 'stretch keeps lobe/short diameter');
      assert.equal(fast.valid, '');
      await page.locator('#undoButton').click(); close(await state(), before, 'stretch undo');
      close(await drag(1, 8, 20), fast, 'event count independent');
      await page.locator('#undoButton').click();
      close(await drag(-1, 8), fast, 'either end stretches equally');
      await page.locator('#undoButton').click();
      close(await drag(1, 8, 20, true), before, 'Escape restores shape and mouths');
      await page.getByRole('button', { name: 'Roundabout length end', exact: true }).focus();
      await page.keyboard.press('Shift+ArrowRight');
      assert.ok((await state()).item.roundabout.ratio > before.item.roundabout.ratio, 'keyboard stretches');
      const saved = await state();
      await page.waitForTimeout(600);
      await page.reload();
      await page.waitForFunction(() => StripeMaker.sheets.ready && StripeMaker.sheets.selected?.intersections?.length);
      close(await state(), saved, 'reload preserves shape');
      await page.evaluate(() => StripeMaker.intersections.focusAt(StripeMaker.sheets.selected.intersections[0]));
      console.log(`${kind}: selection/panel rotation, shape drag, keyboard, cancel, undo/redo and reload passed`);
    }
    await page.screenshot({ path: '/tmp/roundabout-shape-handles.png' });
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
