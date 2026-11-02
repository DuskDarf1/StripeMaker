/* Isolated Chromium. Exercises frame batching with real pointer capture. */
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fixture = require('./fixtures/roundabout-sarasota.json');
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
    await page.evaluate(f => {
      const app = StripeMaker, sheet = app.sheets.selected, x = sheet.intersections[0];
      Object.assign(x, f, { id: x.id, x: x.x, y: x.y });
      app.roadEditor.render(); app.history.record(); document.dispatchEvent(new CustomEvent('sheetchange'));
    }, fixture);
    await page.getByRole('button', { name: 'Select approach 3', exact: true }).focus(); await page.keyboard.press('Enter');
    const center = await page.evaluate(() => {
      const p = StripeMaker.sheets.toScreen(StripeMaker.sheets.selected.intersections[0]), b = document.getElementById('previewStage').getBoundingClientRect();
      return { x: p.x + b.left, y: p.y + b.top };
    });
    await page.mouse.move(center.x, center.y);
    for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, -300); await page.waitForTimeout(70); }
    await page.waitForTimeout(200);
    const handle = page.getByRole('button', { name: 'Approach 3 entry circle Bézier handle', exact: true });
    const state = () => page.evaluate(() => structuredClone(StripeMaker.sheets.selected.intersections[0]));
    const start = async () => {
      const box = await handle.boundingBox(), p = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      await page.mouse.move(p.x, p.y); await page.mouse.down(); return p;
    };
    await page.evaluate(() => {
      window.dragCounts = { renders: 0, validations: 0, records: 0 };
      for (const [obj, key, count] of [[StripeMaker.roadEditor, 'render', 'renders'], [StripeMaker.roundaboutGeometry, 'validate', 'validations'], [StripeMaker.history, 'record', 'records']]) {
        const original = obj[key]; obj[key] = function(...args) { dragCounts[count]++; return original.apply(this, args); };
      }
    });
    const initial = await state(), p = await start();
    const batch = await page.evaluate(async p => {
      const svg = document.querySelector('.intersectionOverlay svg');
      Object.assign(dragCounts, { renders: 0, validations: 0, records: 0 });
      for (let i = 1; i <= 30; i++) svg.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: p.x - i / 30, clientY: p.y, bubbles: true }));
      const immediate = { ...dragCounts };
      await new Promise(requestAnimationFrame);
      return { immediate, frame: { ...dragCounts } };
    }, p);
    assert.deepEqual(batch.immediate, { renders: 0, validations: 0, records: 0 }, 'moves are deferred to the next frame');
    assert.deepEqual(batch.frame, { renders: 1, validations: 1, records: 0 }, 'thirty events become one geometry update and redraw');
    const lastValid = await state(); assert.notDeepEqual(lastValid, initial);
    // A huge bend is rejected without replacing the last valid geometry or
    // adding a history step. The next valid position still works.
    await page.evaluate(async p => {
      document.querySelector('.intersectionOverlay svg').dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: p.x + 1500, clientY: p.y + 900, bubbles: true }));
      await new Promise(requestAnimationFrame);
    }, p);
    assert.deepEqual(await state(), lastValid);
    const released = await page.evaluate(p => {
      const svg = document.querySelector('.intersectionOverlay svg');
      Object.assign(dragCounts, { renders: 0, validations: 0, records: 0 });
      svg.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: p.x - 2, clientY: p.y, bubbles: true }));
      svg.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX: p.x - 2, clientY: p.y, bubbles: true }));
      return { ...dragCounts };
    }, p);
    await page.mouse.up();
    assert.equal(released.validations, 1, 'release flushes the queued position');
    assert.equal(released.records, 1, 'one history step per drag');
    assert.equal(released.renders, 2, 'pending move and final committed state each render once');
    const final = await state(); assert.notDeepEqual(final, lastValid);
    await page.locator('#undoButton').click(); assert.deepEqual(await state(), initial);
    await page.locator('#redoButton').click(); assert.deepEqual(await state(), final);
    const cancelAt = await start();
    await page.evaluate(async p => {
      const svg = document.querySelector('.intersectionOverlay svg');
      Object.assign(dragCounts, { renders: 0, validations: 0, records: 0 });
      svg.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: p.x - 2, clientY: p.y, bubbles: true }));
      svg.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1, bubbles: true }));
      await new Promise(requestAnimationFrame);
    }, cancelAt);
    await page.mouse.up(); assert.deepEqual(await state(), final);
    assert.deepEqual(await page.evaluate(() => ({ validations: dragCounts.validations, records: dragCounts.records })), { validations: 0, records: 0 }, 'cancel discards pending work');
    assert.equal(await page.locator('.roundaboutCheck').count(), 0);
    const tips = await page.locator('#intersectionEditor .headPopoverHint').allTextContents();
    assert.ok(tips.some(text => text.includes('Drag')));
    assert.ok(!tips.some(text => /typical|minimum|\d+ ft|\d+ in|Exhibit|state highway/i.test(text)), 'panel contains editing tips, not design guidance');
    await page.screenshot({ path: '/private/tmp/roundabout-constrained-editor.png' });
    assert.deepEqual(errors, []);
    console.log('Roundabout frame batching, constrained rollback, release, cancellation, undo/redo and concise editor passed.');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
