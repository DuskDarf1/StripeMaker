/* Isolated browser; uses the same environment as roundabouts.browser.cjs. */
const assert = require('node:assert/strict');
const selectChoice = require('./select-choice.cjs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } }), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(process.env.STRIPEMAKER_URL || 'http://127.0.0.1:8876');
    await page.waitForFunction(() => StripeMaker.roundaboutGeometry && StripeMaker.roadEditor);
    await page.locator('#blankSheet').evaluate(b => b.click());
    await page.waitForFunction(() => StripeMaker.sheets.selected?.inchesPerPixel);
    await page.getByRole('button', { name: 'Intersections', exact: true }).click();
    await page.locator('#newRoundabout').click();
    const southId = await page.evaluate(() => {
      const app = StripeMaker, sheet = app.sheets.selected, item = sheet.intersections[0], R = app.roundaboutGeometry, G = app.intersectionGeometry;
      for (const a of item.approaches) Object.assign(a, { incoming: 2, outgoing: 2 });
      R.normalize(item);
      for (const a of item.approaches) {
        for (const id of a.inLanes) a.dest[id] = [];
        Object.assign(a, G.mul(G.axes(a).u, R.requiredReach(item, a)));
      }
      const [east, south, west, north] = item.approaches;
      south.dest[south.inLanes[0]] = [west.id];
      south.dest[south.inLanes[1]] = [east.id, north.id];
      app.roadEditor.render(); app.sheets.save(sheet); app.history.record();
      document.dispatchEvent(new CustomEvent('sheetchange'));
      return south.id;
    });
    const panel = page.locator('#intersectionEditor');
    await selectChoice(panel.locator('#intersection-approach'), southId);
    const state = () => page.evaluate(() => {
      const R = StripeMaker.roundaboutGeometry, x = StripeMaker.sheets.selected.intersections[0];
      return { arrows: R.circulatingArrows(x, x.approaches[0]).map(a => a.type),
        marks: StripeMaker.sheets.selected.roadLayer.innerHTML, dest: x.approaches[1].dest };
    });
    const original = await state();
    assert.deepEqual(original.arrows, ['through', 'turnLeft']);
    const outside = panel.locator('fieldset').filter({ hasText: 'Lane 2 (outside)' });
    await outside.getByLabel(/through/).uncheck();
    assert.deepEqual((await state()).arrows, ['turnLeft']);
    await outside.getByLabel(/left turn/i).check();
    const edited = await state();
    assert.deepEqual(edited.arrows, ['turnLeft', 'turnLeft']);
    assert.notEqual(edited.marks, original.marks, 'visible road-layer markings change with destinations');
    await page.locator('#undoButton').click();
    assert.deepEqual((await state()).arrows, ['turnLeft']);
    await page.locator('#redoButton').click();
    assert.deepEqual((await state()).arrows, ['turnLeft', 'turnLeft']);
    await page.waitForTimeout(1500); await page.reload();
    await page.waitForFunction(() => StripeMaker.sheets.selected?.intersections?.length && StripeMaker.roundaboutGeometry);
    const restored = await state();
    assert.deepEqual(restored.arrows, edited.arrows);
    assert.deepEqual(restored.dest, edited.dest, 'movement choices and derived interior markings survive reload');
    assert.deepEqual(errors, []);
    console.log('roundabout movement editor browser tests passed');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
