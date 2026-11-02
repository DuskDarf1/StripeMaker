const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fixture = require('./fixtures/roundabout-sarasota-assembled.json');
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
      const app = StripeMaker, s = app.sheets.selected, x = s.intersections[0], position = { id: x.id, x: x.x, y: x.y };
      Object.assign(x, f, position); app.roadEditor.render(); app.sheets.save(s); app.history.record();
      app.sheets.zoomBy(8);
      document.dispatchEvent(new CustomEvent('sheetchange'));
    }, fixture);
    await page.getByRole('button', { name: 'Select approach 3', exact: true }).focus();
    await page.keyboard.press('Enter');
    const state = () => page.evaluate(() => {
      const x = StripeMaker.sheets.selected.intersections[0], R = StripeMaker.roundaboutGeometry, a = x.approaches[2];
      const L=R.layout(x).legs.get(a.id), tip=R.entryGoreHandles(x,a,1).tip;
      const cap=R.markings(x).lines.find(line=>line.width===8/12 && line.points.every(p=>Math.abs(Math.hypot(p.x,p.y)-L.yieldRing.radius(Math.atan2(p.y,p.x)))<.01));
      return { value: a.yieldSetback, p: R.yieldLineHandle(x, a).p, tip, cap:cap?.points, valid: R.validate(x), item: structuredClone(x) };
    });
    const before = await state();
    const field = page.getByLabel('Yield line setback (ft)', { exact: true });
    await field.fill('15'); await field.press('Tab');
    const edited = await state(); assert.equal(edited.value, 15); assert.equal(edited.valid, '');
    assert.ok(edited.p.y < before.p.y - 10);
    assert.ok(edited.tip.y < before.tip.y - 1,'gore tip follows the yield setback');
    assert.ok(edited.cap?.length>1,'solid gore cap follows the yield line');
    await page.locator('#undoButton').click(); assert.equal((await state()).value, 0);
    await page.locator('#redoButton').click(); assert.equal((await state()).value, 15);
    const handle = page.getByRole('button', { name: 'Approach 3 yield line position', exact: true });
    await handle.focus(); await handle.press('ArrowUp');
    const nudged = await state(); assert.ok(nudged.value > 15);
    const box = await handle.boundingBox(), k = await page.evaluate(() => 12 / StripeMaker.sheets.selected.inchesPerPixel * StripeMaker.sheets.selected.view.scale);
    const hit = await page.evaluate(b => document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)?.outerHTML, box);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 6 * k); await page.mouse.up();
    const dragged = await state(); assert.ok(dragged.value > nudged.value, JSON.stringify({box,k,hit,before:nudged.value,after:dragged.value})); assert.equal(dragged.valid, '');
    await page.locator('#undoButton').click(); assert.equal((await state()).value, nudged.value);
    await page.locator('#redoButton').click(); assert.equal((await state()).value, dragged.value);
    await field.fill('1000'); await field.press('Tab'); assert.equal((await state()).value, dragged.value, 'invalid position rolls back');
    const snapshot = await page.evaluate(() => StripeMaker.projectJSON.snapshot());
    await page.evaluate(p => StripeMaker.projectJSON.load(p), snapshot);
    assert.deepEqual((await state()).item, dragged.item, 'normal project JSON retains the edit');
    await page.reload(); await page.waitForFunction(() => StripeMaker.sheets.ready);
    assert.equal((await state()).value, dragged.value, 'browser save retains the edit');
    assert.deepEqual(errors, []);
    console.log('Yield line panel, keyboard, drag, invalid rollback, undo/redo, JSON and reload passed.');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
