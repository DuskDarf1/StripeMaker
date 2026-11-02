/* Isolated Chromium; same environment as roundabouts.browser.cjs. */
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1450, height: 1100 } }), errors = [];
    page.setDefaultTimeout(10000);
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(process.env.STRIPEMAKER_URL || 'http://127.0.0.1:8876');
    await page.waitForFunction(() => StripeMaker.sheets.ready && StripeMaker.roundaboutGeometry && StripeMaker.roadEditor);
    await page.locator('#blankSheet').evaluate(b => b.click());
    await page.waitForFunction(() => StripeMaker.sheets.selected?.inchesPerPixel);
    await page.getByRole('button', { name: 'Intersections', exact: true }).click();
    await page.locator('#newRoundabout').click();
    await page.evaluate(() => {
      const app = StripeMaker, s = app.sheets.selected, x = s.intersections[0], R = app.roundaboutGeometry, G = app.intersectionGeometry;
      x.roundabout.icd = 360;
      for (const a of x.approaches) Object.assign(a, { incoming: 2, outgoing: 2 });
      R.normalize(x);
      for (const a of x.approaches) Object.assign(a, G.mul(G.axes(a).u, R.requiredReach(x, a)));
      app.roadEditor.render(); app.sheets.save(s); app.history.record();
      document.dispatchEvent(new CustomEvent('sheetchange'));
    });
    await page.getByRole('button', { name: 'Select approach 1', exact: true }).focus();
    await page.keyboard.press('Enter');
    const state = (index = 0) => page.evaluate(index => {
      const R = StripeMaker.roundaboutGeometry, x = StripeMaker.sheets.selected.intersections[index];
      return { references: x.approaches.map(a => a.movementAngle),
        turns: x.approaches.map(a => x.approaches.map(b => R.turnOf(x, a, b))),
        destinations: x.approaches.map(a => a.inLanes.map(id => R.destinations(x, a, id).map(id => x.approaches.findIndex(b => b.id === id)))),
        arrows: x.approaches.map(a => R.circulatingArrows(x, a)), lanes: R.laneCount(x), spiral: R.spiralWanted(x) };
    }, index);
    const original = await state(), originalPaint = await page.locator('.roadLayer').innerHTML();
    const labels = () => page.locator('#intersectionEditor fieldset label').allTextContents();
    const originalLabels = await labels();
    assert.ok(originalLabels.some(label => label.includes('Approach 3') && label.includes('through')));
    const set = async (id, value) => { await page.locator(id).fill(String(value)); await page.locator(id).blur(); };
    await set('#intersection-Angle', 50);
    assert.equal(await page.locator('#intersection-Angle').inputValue(), '50', 'skewed entrance accepted');
    assert.deepEqual(await state(), original, 'angle edit preserves movement logic');
    assert.deepEqual(await labels(), originalLabels, 'movement editor keeps its turn names');
    assert.notEqual(await page.locator('.roadLayer').innerHTML(), originalPaint, 'pavement and paint still follow the moved entrance');
    await set('#intersection-rb-bend', 5);
    assert.equal(await page.locator('#intersection-rb-bend').inputValue(), '5');
    assert.deepEqual(await state(), original, 'whole-leg bend retains movement logic');
    await page.locator('#undoButton').click(); await page.locator('#undoButton').click();
    assert.equal(await page.locator('#intersection-Angle').inputValue(), '0');
    assert.deepEqual(await state(), original);
    await page.locator('#redoButton').click(); await page.locator('#redoButton').click();
    assert.equal(await page.locator('#intersection-Angle').inputValue(), '50');
    assert.deepEqual(await state(), original, 'undo/redo preserve references');
    await set('#intersection-rb-rotate', 120);
    assert.deepEqual(await state(), original, 'whole-roundabout rotation keeps relative movements');
    assert.deepEqual(await labels(), originalLabels);
    // Resetting automatic lane use must use the saved directions as well.
    const outside = page.locator('#intersectionEditor fieldset').filter({ hasText: 'Lane 2 (outside)' });
    await outside.getByLabel(/Approach 3.*through/).uncheck();
    await page.getByRole('button', { name: 'Reset Lane Destinations', exact: true }).click();
    assert.deepEqual(await state(), original, 'reset uses logical directions, not the current entrance tangent');
    await page.locator('#intersectionSheetAdd').click();
    assert.equal(await page.evaluate(() => StripeMaker.sheets.selected.intersections[0].approaches.length), 5);
    const withNewLeg = await state();
    assert.deepEqual(withNewLeg.references.slice(0, 4), original.references, 'new leg retains existing references');
    assert.deepEqual(withNewLeg.turns.slice(0, 4).map(row => row.slice(0, 4)), original.turns);
    await page.locator('#undoButton').click();
    assert.deepEqual(await state(), original);
    await page.getByRole('button', { name: 'Intersections', exact: true }).click();
    await page.locator('#duplicateIntersection').click();
    assert.deepEqual(await state(1), original, 'duplicate remaps lane/approach IDs but retains movement meanings');
    const project = await page.evaluate(() => StripeMaker.projectJSON.snapshot('selected'));
    assert.deepEqual(project.sheets[0].data.intersections[0].approaches.map(a => a.movementAngle), original.references);
    await page.evaluate(project => StripeMaker.projectJSON.load(project), project);
    assert.deepEqual(await state(), original, 'JSON import retains saved references');
    await page.waitForTimeout(650); await page.reload();
    await page.waitForFunction(() => StripeMaker.sheets.ready && StripeMaker.sheets.selected?.intersections?.length);
    assert.deepEqual(await state(), original, 'movement meanings survive reload');
    assert.deepEqual(errors, []);
    console.log('roundabout stable-direction browser tests passed: angle/bend/rotation, labels, defaults, undo/redo, add, duplicate, JSON and reload');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
