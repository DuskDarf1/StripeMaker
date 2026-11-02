/* Isolated browser; same environment variables as roundabouts.browser.cjs. */
const assert = require('node:assert/strict');
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
    const state = () => page.evaluate(() => {
      const x = StripeMaker.sheets.selected.intersections[0], R = StripeMaker.roundaboutGeometry;
      return { item: structuredClone(x), diameter: R.diameter(x), valid: R.validate(x), surfaces: R.surfaces(x), marks: StripeMaker.sheets.selected.roadLayer.innerHTML };
    });
    const zoom = async count => {
      const p = await page.evaluate(() => {
        const p = StripeMaker.sheets.toScreen(StripeMaker.sheets.selected.intersections[0]);
        const box = document.getElementById('previewStage').getBoundingClientRect();
        return { x: p.x + box.left, y: p.y + box.top };
      });
      await page.mouse.move(p.x, p.y);
      for (let i = 0; i < count; i++) { await page.mouse.wheel(0, -300); await page.waitForTimeout(50); }
      await page.waitForTimeout(300);
    };
    await zoom(4);
    const whole = page.getByRole('button', { name: 'Approach 1 whole approach curve', exact: true });
    assert.equal(await page.getByRole('button', { name: /^Approach \d+ whole approach curve$/ }).count(), 4);
    const before = await state(), box = await whole.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 8, { steps: 5 });
    await page.mouse.up();
    let bent = await state();
    assert.ok(bent.item.approaches[0].bend > 0, 'whole leg follows pointer drag');
    assert.equal(bent.valid, '');
    assert.notEqual(bent.marks, before.marks, 'pavement, median and paint update');
    assert.deepEqual(bent.item.approaches.map(a => [a.angle, a.ar3, a.exitCurve]),
      before.item.approaches.map(a => [a.angle, a.ar3, a.exitCurve]));
    assert.ok(Math.abs(bent.item.approaches[0].y - before.item.approaches[0].y - bent.item.approaches[0].bend) < 1e-8, 'mouth moves by the bend amount');
    const movedBox = await whole.boundingBox();
    assert.ok(Math.abs(movedBox.y - box.y - 8) < 1, 'handle follows the pointer at the connection');
    await page.locator('#undoButton').click();
    assert.equal((await state()).item.approaches[0].bend, 0);
    assert.equal((await state()).item.approaches[0].y, before.item.approaches[0].y);
    await page.locator('#redoButton').click();
    assert.equal((await state()).item.approaches[0].bend, bent.item.approaches[0].bend);
    await whole.focus(); await whole.press('ArrowUp');
    assert.ok((await state()).item.approaches[0].bend < bent.item.approaches[0].bend, 'keyboard bends whole leg');
    await panel.getByLabel('Whole approach bend (ft)', { exact: true }).fill('4');
    await panel.getByLabel('Whole approach bend (ft)', { exact: true }).press('Tab');
    bent = await state();
    assert.ok(Math.abs(bent.item.approaches[0].y - before.item.approaches[0].y - 4) < 1e-8, 'panel bend moves the same connection');
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/roundabout-whole-leg.png` });
    await panel.getByRole('button', { name: 'Straighten Whole Approach', exact: true }).click();
    assert.equal((await state()).item.approaches[0].bend, 0);
    await page.locator('#undoButton').click();
    assert.equal((await state()).item.approaches[0].bend, 4);

    await selectChoice(panel.locator('#intersection-rb-type'), 'mini');
    assert.equal((await state()).diameter, 90);
    assert.ok((await state()).surfaces.every(s => s.mountable && s.fill === 'concrete'));
    assert.equal(await panel.getByLabel('Truck apron (ft)', { exact: true }).count(), 0);
    const fill = async (label, value) => { const input = panel.getByLabel(label, { exact: true }); await input.fill(value); await input.press('Tab'); };
    await fill('Circulating lane width (ft)', '12');
    const ids = (await state()).item.approaches.map(a => a.id);
    for (const id of ids) {
      await selectChoice(panel.locator('#intersection-approach'), id);
      await fill('Median at mouth (ft)', '0');
    }
    await fill('Inscribed diameter (ft)', '45');
    const mini = await state();
    assert.equal(mini.diameter, 45);
    assert.equal(mini.valid, '');
    assert.equal(mini.surfaces.length, 1);
    assert.equal(mini.item.approaches[0].bend, 4);
    await page.locator('#undoButton').click();
    assert.equal((await state()).diameter, 90);
    await page.locator('#redoButton').click();
    assert.equal((await state()).diameter, 45);
    const sizeHandle = page.getByRole('button', { name: 'Roundabout diameter', exact: true });
    await sizeHandle.focus(); await sizeHandle.press('ArrowRight');
    assert.ok((await state()).diameter >= 45, 'diameter handle respects the new lower bound');
    await fill('Inscribed diameter (ft)', '45');
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/mini-roundabout.png` });
    await page.waitForTimeout(1500); await page.reload();
    await page.waitForFunction(() => StripeMaker.sheets.selected?.intersections?.length && StripeMaker.roadEditor);
    const restored = await state();
    assert.equal(restored.item.roundabout.mini, true);
    assert.equal(restored.diameter, 45);
    assert.equal(restored.item.approaches[0].bend, 4);
    assert.equal(restored.valid, '');
    assert.deepEqual(errors, []);
    console.log('roundabout whole-leg curve and mini-roundabout browser tests passed');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
