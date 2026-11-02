/* Isolated browser; same environment variables as roundabouts.browser.cjs. */
const assert = require('node:assert/strict');
const selectChoice = require('./select-choice.cjs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } }), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(process.env.STRIPEMAKER_URL || 'http://127.0.0.1:8876');
    await page.waitForFunction(() => StripeMaker.roundaboutGeometry && StripeMaker.markingCatalog && StripeMaker.roadEditor);
    await page.locator('#blankSheet').evaluate(b => b.click());
    await page.waitForFunction(() => StripeMaker.sheets.selected?.inchesPerPixel);
    await page.getByRole('button', { name: 'Intersections', exact: true }).click();
    await page.locator('#newRoundabout').click();
    const panel = page.locator('#intersectionEditor');
    const state = () => page.evaluate(() => {
      const x = StripeMaker.sheets.selected.intersections[0], R = StripeMaker.roundaboutGeometry;
      return { item: structuredClone(x), widths: R.laneWidths(x), marks: StripeMaker.sheets.selected.roadLayer.innerHTML };
    });
    await page.evaluate(() => {
      const app = StripeMaker, s = app.sheets.selected, x = s.intersections[0], R = app.roundaboutGeometry, G = app.intersectionGeometry;
      for (const a of x.approaches) Object.assign(a, { incoming: 2, outgoing: 2 });
      Object.assign(x.roundabout, { widths: [12, 18], laneWidth: null });
      R.normalize(x);
      for (const a of x.approaches) Object.assign(a, G.mul(G.axes(a).u, R.requiredReach(x, a)));
      app.roadEditor.render(); app.history.record(); app.sheets.save(s);
      document.dispatchEvent(new CustomEvent('sheetchange'));
    });
    assert.deepEqual((await state()).widths, [15, 15], 'legacy widths become shared');
    const width = panel.getByLabel('Circulating lane width (ft)', { exact: true });
    assert.equal(await width.count(), 1);
    await width.fill('16'); await width.press('Tab');
    assert.deepEqual((await state()).widths, [16, 16]);
    await page.locator('#undoButton').click();
    assert.deepEqual((await state()).widths, [15, 15]);
    await page.locator('#redoButton').click();
    assert.deepEqual((await state()).widths, [16, 16]);
    await selectChoice(panel.locator('#intersection-rb-lanes'), '4');
    assert.deepEqual((await state()).widths, [16, 16, 16, 16]);
    await selectChoice(panel.locator('#intersection-rb-lanes'), 'auto');

    // Bézier controls replace the on-sheet entry/exit curve dots. Radius
    // fields remain available for the independent entrance/exit geometry.
    assert.equal(await page.getByRole('button', { name: /^Approach \d+ (entry|exit) curve$/ }).count(), 0);
    const entry = panel.getByLabel('Entry curve AR3 (ft)', { exact: true });
    const exit = panel.getByLabel('Exit lane curve (ft)', { exact: true });
    const before = await state();
    await entry.fill('99'); await entry.press('Tab');
    let edited = await state();
    assert.ok(edited.item.approaches[0].ar3 < before.item.approaches[0].ar3, 'entry radius remains editable');
    assert.equal(edited.item.approaches[0].exitCurve, before.item.approaches[0].exitCurve);
    assert.notEqual(edited.marks, before.marks, 'curbs and paint follow the bend');
    await page.locator('#undoButton').click();
    assert.equal((await state()).item.approaches[0].ar3, before.item.approaches[0].ar3);
    await page.locator('#redoButton').click();
    assert.equal((await state()).item.approaches[0].ar3, edited.item.approaches[0].ar3);
    await exit.fill('299'); await exit.press('Tab');
    const after = await state();
    assert.ok(after.item.approaches[0].exitCurve < before.item.approaches[0].exitCurve, 'exit radius remains editable');
    assert.equal(after.item.approaches[0].ar3, edited.item.approaches[0].ar3, 'exit does not change entry');
    assert.deepEqual(after.item.approaches.map(a => [a.x, a.y, a.angle, a.width, a.outWidth]),
      before.item.approaches.map(a => [a.x, a.y, a.angle, a.width, a.outWidth]), 'mouths and lane widths stay fixed');
    await page.locator('#undoButton').click();
    assert.equal((await state()).item.approaches[0].exitCurve, before.item.approaches[0].exitCurve, 'radius edit is one undo step');
    await page.locator('#redoButton').click();
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/roundabout-curve-fields.png` });
    await page.waitForTimeout(1500); await page.reload();
    await page.waitForFunction(() => StripeMaker.sheets.selected?.intersections?.length && StripeMaker.roundaboutGeometry && StripeMaker.roadEditor);
    const restored = await state();
    assert.deepEqual(restored.widths, [16, 16]);
    assert.equal(restored.item.approaches[0].exitCurve, after.item.approaches[0].exitCurve);
    assert.equal(restored.item.approaches[0].ar3, after.item.approaches[0].ar3);
    assert.deepEqual(errors, []);
    console.log('roundabout shared-width and curve-field browser tests passed');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
