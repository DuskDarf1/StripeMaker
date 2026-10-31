const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  try {
  const page = await (await browser.newContext({ viewport: { width: 1200, height: 800 } })).newPage(); const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(process.env.STRIPEMAKER_URL || 'http://127.0.0.1:8876/');
  await page.click('button[aria-controls="sheetsMenu"]'); await page.click('#blankSheet');
  await page.waitForFunction(() => StripeMaker.sheets.selected);
  // Save the old (bad) structure directly, without an edit.
  await page.evaluate(() => {
    const s = StripeMaker.sheets.selected;
    s.roads = [
      { id: 1, lanes: 4, laneWidth: 12, laneTypes: { 3: { type: 'bufferedBike', width: 7 } }, ends: [{ joint: 1, sign: 1, length: null }, { joint: 2, sign: 1, length: null }] },
      { id: 2, lanes: 3, laneWidth: 12, laneTypes: { 2: { type: 'bufferedBike', width: 7 } }, ends: [{ joint: 2, sign: 1, length: null }, { joint: 3, sign: 1, length: null }] },
      { id: 3, lanes: 1, laneWidth: 12, ends: [{ joint: 2, sign: 1, length: 300 }, { joint: 4, sign: 1, length: null }] }];
    s.joints = [{ id: 1, x: 15000, y: 16000, dir: { x: 0, y: -1 }, root: 1, links: [] },
      { id: 2, x: 15000, y: 15000, dir: { x: 0, y: -1 }, root: 1, links: [{ a: 1, ai: 0, b: 2, bi: 0 }, { a: 1, ai: 1, b: 2, bi: 1 }, { a: 1, ai: 2, b: 2, bi: 2 }, { a: 1, ai: 2, b: 3, bi: 0 }] },
      { id: 3, x: 14960, y: 13000, dir: { x: 0, y: -1 }, root: 2, links: [] }, { id: 4, x: 16500, y: 13500, dir: { x: 0.7, y: -0.7 }, root: 3, links: [] }];
    StripeMaker.sheets.save(s);
  });
  await page.waitForTimeout(1500); await page.reload(); await page.waitForFunction(() => StripeMaker.sheets.selected?.roads?.length === 3, null, { timeout: 15000 });
  const links = await page.evaluate(() => JSON.stringify(StripeMaker.sheets.selected.joints.find(j => j.id === 2).links));
  const undo = await page.evaluate(() => document.getElementById('undoButton').disabled);
  const assert = require('node:assert/strict');
  assert.deepEqual(JSON.parse(links), [
    { a: 1, ai: 0, b: 2, bi: 0 },
    { a: 1, ai: 1, b: 2, bi: 1 },
    { a: 1, ai: 2, b: 3, bi: 0 },
    { a: 1, ai: 3, b: 2, bi: 2 },
  ], 'opening an old sheet connects bike lanes while preserving the ramp feed');
  assert.equal(undo, true, 'migration must not create an undo step');
  assert.deepEqual(errors, []);
  console.log('PASS: saved bike lane connections migrate on reload.');
  } finally { await browser.close(); }
})();
