/* Isolated browser; same environment as roundabouts.browser.cjs. */
const assert = require('node:assert/strict');
const fixture = require('./fixtures/roundabout-movement-loop.json');
const selectChoice = require('./select-choice.cjs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } }), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(process.env.STRIPEMAKER_URL || 'http://127.0.0.1:8876');
    await page.waitForFunction(() => StripeMaker.roundaboutGeometry && StripeMaker.markingCatalog && StripeMaker.roadEditor);
    await page.locator('#blankSheet').evaluate(b => b.click());
    await page.waitForFunction(() => StripeMaker.sheets.selected?.inchesPerPixel);
    await page.getByRole('button', { name: 'Intersections', exact: true }).click();
    await page.locator('#newRoundabout').click();
    const panel = page.locator('#intersectionEditor');
    const visible = () => page.locator('.intersectionMovement[data-approach]').evaluateAll(paths => paths.map(p => p.dataset.approach));
    const chosen = () => page.evaluate(() => StripeMaker.intersections.diagnostics().chosen);
    assert.deepEqual(new Set(await visible()), new Set([await chosen()]), 'new roundabout shows only the selected approach');
    await page.evaluate(input => {
      const app = StripeMaker, s = app.sheets.selected, old = s.intersections[0];
      s.intersections[0] = { ...input, id: old.id, x: old.x, y: old.y };
      app.roadEditor.render(); app.sheets.save(s); app.history.record();
      document.dispatchEvent(new CustomEvent('sheetchange'));
    }, fixture);
    for (const a of fixture.approaches) {
      await selectChoice(panel.locator('#intersection-approach'), a.id);
      const expected = await page.evaluate(() => {
        const x = StripeMaker.sheets.selected.intersections[0], a = x.approaches.find(a => a.id === StripeMaker.intersections.diagnostics().chosen);
        return a.inLanes.reduce((n, id) => n + StripeMaker.roundaboutGeometry.destinations(x, a, id).length, 0);
      });
      assert.equal((await visible()).length, expected, 'all destinations of just one approach');
      assert.deepEqual(new Set(await visible()), new Set([a.id]));
    }
    const south = fixture.approaches[1];
    const lane = page.locator(`[data-key="lane-${south.inLanes[0]}"]`);
    await lane.focus(); await lane.press('Enter');
    assert.equal(await chosen(), south.id, 'selecting an entry arrow switches approaches');
    assert.deepEqual(new Set(await visible()), new Set([south.id]));
    // Panning/zooming rebuilds the overlay without restoring other entries.
    const center = await page.evaluate(() => {
      const p = StripeMaker.sheets.toScreen(StripeMaker.sheets.selected.intersections[0]);
      const r = document.getElementById('previewStage').getBoundingClientRect();
      return { x: p.x + r.left, y: p.y + r.top };
    });
    await page.mouse.move(center.x, center.y);
    for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, -300); await page.waitForTimeout(50); }
    await page.waitForTimeout(300);
    assert.deepEqual(new Set(await visible()), new Set([south.id]));
    const firstNumber = page.getByRole('button', { name: 'Select approach 1', exact: true });
    await firstNumber.click();
    assert.deepEqual(new Set(await visible()), new Set([fixture.approaches[0].id]), 'clicking a number switches roundabout guides');
    const secondNumber = page.getByRole('button', { name: 'Select approach 2', exact: true });
    await secondNumber.focus(); await secondNumber.press('Space');
    assert.deepEqual(new Set(await visible()), new Set([south.id]), 'number supports keyboard selection');
    assert.equal(await secondNumber.getAttribute('aria-pressed'), 'true');
    assert.ok(await secondNumber.evaluate(el => el === document.activeElement), 'number retains focus after redraw');
    assert.equal(await secondNumber.evaluate(el => getComputedStyle(el).outlineStyle), 'solid', 'keyboard focus is visible');
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/roundabout-selected-approach.png` });
    const edge = page.getByRole('button', { name: 'Approach 3 entry outer edge', exact: true });
    await edge.focus(); await edge.press('Enter');
    assert.deepEqual(new Set(await visible()), new Set([fixture.approaches[2].id]), 'edge handle selection also switches guides');
    assert.equal(await page.locator('.roadLayer .intersectionMovement').count(), 0, 'editor guides remain outside exported artwork');

    // Ordinary intersections also filter movements by the selected approach.
    const ids = await page.evaluate(() => {
      const app = StripeMaker, G = app.intersectionGeometry, s = app.sheets.selected, old = s.intersections[0], x = G.create();
      Object.assign(x, { id: old.id, x: old.x, y: old.y });
      G.normalize(x);
      x.movements = [G.movement(x.approaches[0], 0, x.approaches[2], 0), G.movement(x.approaches[1], 0, x.approaches[3], 0)];
      s.intersections[0] = x;
      app.roadEditor.render(); document.dispatchEvent(new CustomEvent('sheetchange'));
      return x.approaches.map(a => a.id);
    });
    await selectChoice(panel.locator('#intersection-approach'), ids[0]);
    const unchanged = await page.evaluate(() => JSON.stringify(StripeMaker.sheets.selected.intersections[0]));
    await page.getByRole('button', { name: 'Select approach 2', exact: true }).click();
    assert.equal(await chosen(), ids[1], 'number selects an ordinary intersection approach');
    await page.getByRole('button', { name: 'Select approach 1', exact: true }).focus();
    await page.getByRole('button', { name: 'Select approach 1', exact: true }).press('Enter');
    assert.equal(await chosen(), ids[0], 'ordinary intersection number supports Enter');
    assert.equal(await page.evaluate(() => JSON.stringify(StripeMaker.sheets.selected.intersections[0])), unchanged, 'selection preserves geometry and movements');
    const colors = await page.locator('.intersectionMovement[stroke^="hsl"]').evaluateAll(paths => [...new Set(paths.map(p => p.getAttribute('stroke')))]);
    assert.equal(colors.length, 1, 'ordinary intersection shows only the selected approach movements');
    assert.deepEqual(errors, []);
    console.log('roundabout selected-approach guide browser tests passed');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
