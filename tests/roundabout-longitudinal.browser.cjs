/* Isolated browser: same PLAYWRIGHT_MODULE, CHROME_PATH and STRIPEMAKER_URL as roundabouts.browser.cjs. */
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } }), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(process.env.STRIPEMAKER_URL || 'http://127.0.0.1:8876');
    await page.waitForFunction(() => globalThis.StripeMaker?.sheets && StripeMaker.roadEditor && StripeMaker.intersections);
    await page.locator('#blankSheet').evaluate(b => b.click());
    await page.waitForFunction(() => StripeMaker.sheets.selected?.inchesPerPixel);
    const position = await page.evaluate(() => {
      const app = StripeMaker, s = app.sheets.selected, R = app.roundaboutGeometry, G = app.intersectionGeometry;
      const item = R.create();
      item.x = 1200; item.y = 1000;
      item.approaches.forEach((a, i) => { if (i % 2) a.incoming = 2; });
      R.normalize(item);
      for (const a of item.approaches) Object.assign(a, G.mul(G.axes(a).u, R.requiredReach(item, a)));
      s.intersections = [item]; s.view = { x: 220, y: 100, scale: 0.4 };
      app.roadEditor.render(); app.sheets.save(s); app.history.record();
      document.dispatchEvent(new CustomEvent('sheetchange'));
      const targets = app.intersections.lineTargets(s);
      const circles = targets.filter(t => t.on.roundabout && t.on.approach === 'circulatory');
      if (circles.length !== 3) throw new Error('all circulating boundaries must be longitudinal targets');
      const target = circles.find(t => t.on.k === 1);
      const p = target.points.reduce((a, b) => a.x > b.x ? a : b);
      const box = document.getElementById('previewStage').getBoundingClientRect();
      return { x: box.left + s.view.x + p.x * s.view.scale, y: box.top + s.view.y + p.y * s.view.scale };
    });
    await page.locator('[data-editor="markingsEditor"]').click();
    await page.locator('#markingsLongitudinalTab').click();
    await page.locator('#chooseLine').click();
    await page.locator('#markingSearch').fill('solid line');
    await page.locator('#markingGrid button').first().click();
    await page.mouse.click(position.x, position.y);
    const lines = () => page.evaluate(() => structuredClone(StripeMaker.sheets.selected.lines));
    let saved = await lines();
    assert.equal(saved.length, 1, 'clicking an unconnected roundabout boundary places a longitudinal marking');
    assert.equal(saved[0].on.approach, 'circulatory');
    assert.equal(saved[0].on.roundabout, true);
    assert.deepEqual([saved[0].from, saved[0].to], [0, 1], 'the entire loop is available');
    await page.locator('#undoButton').click(); assert.equal((await lines()).length, 0);
    await page.locator('#redoButton').click(); assert.equal((await lines()).length, 1);
    await page.evaluate(() => {
      const app = StripeMaker, s = app.sheets.selected;
      s.intersections[0].roundabout.icd = 210;
      app.roadEditor.render(); app.sheets.save(s);
    });
    assert.equal((await lines()).length, 1, 'geometry changes retain the stable boundary attachment');
    await page.waitForTimeout(1500); await page.reload();
    await page.waitForFunction(() => StripeMaker.sheets.selected?.lines?.length);
    assert.deepEqual(await lines(), saved, 'longitudinal roundabout attachment survives reload');
    assert.deepEqual(errors, []);
    console.log('roundabout longitudinal browser tests passed');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
