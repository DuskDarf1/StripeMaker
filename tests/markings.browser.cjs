/* Same isolated Chromium setup as intersections.browser.cjs:
   PLAYWRIGHT_MODULE=/path/to/playwright node tests/markings.browser.cjs
   (STRIPEMAKER_URL optional; defaults to opening index.html directly). */
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  try {
    const context = await browser.newContext({ viewport: { width: 1400, height: 1000 }, acceptDownloads: true });
    const page = await context.newPage(), errors = [];
    page.setDefaultTimeout(10000);
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(process.env.STRIPEMAKER_URL || pathToFileURL(path.resolve(__dirname, '../index.html')).href);
    const png = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 1600; c.height = 1200; const g = c.getContext('2d'); g.fillStyle = '#777'; g.fillRect(0, 0, 1600, 1200); return c.toDataURL().split(',')[1]; });
    await page.locator('#sheetFile').setInputFiles({ name: 'Markings test.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
    await page.waitForFunction(() => StripeMaker.sheets.selected);
    // Two 12 ft lanes eastbound (2 in per pixel: 6 px per foot), curving at the end.
    await page.evaluate(() => {
      const s = StripeMaker.sheets.selected; s.inchesPerPixel = 2;
      s.roads = [{ id: 1, lanes: 2, laneWidth: 12, ends: [{ joint: 1, sign: 1, length: null }, { joint: 2, sign: 1, length: 300 }] }];
      s.joints = [{ id: 1, x: 150, y: 650, dir: { x: 1, y: 0 }, root: 1, links: [] }, { id: 2, x: 1350, y: 350, dir: { x: 0, y: -1 }, root: 1, links: [] }];
      StripeMaker.roadEditor.render(); StripeMaker.sheets.save(s); StripeMaker.history.record();
      document.dispatchEvent(new CustomEvent('sheetchange'));
    });
    // A sheet point → client coordinates.
    const client = p => page.evaluate(p => {
      const box = document.getElementById('previewStage').getBoundingClientRect(), v = StripeMaker.sheets.selected.view;
      return { x: box.left + v.x + p.x * v.scale, y: box.top + v.y + p.y * v.scale };
    }, p);
    const lane = (d, k) => page.evaluate(([d, k]) => {
      // A point d px along road 1, in the center of lane k.
      const t = StripeMaker.roadEditor.laneTracks(StripeMaker.sheets.selected)[0];
      let s = 0;
      for (let i = 1; i < t.line.length; i++) {
        const a = t.line[i - 1], b = t.line[i], len = Math.hypot(b.x - a.x, b.y - a.y);
        if (s + len >= d) {
          const f = (d - s) / len, tx = (b.x - a.x) / len, ty = (b.y - a.y) / len, c = (t.bounds[i][k] + t.bounds[i][k + 1]) / 2;
          return { x: a.x + (b.x - a.x) * f - ty * c, y: a.y + (b.y - a.y) * f + tx * c };
        }
        s += len;
      }
    }, [d, k]);
    const state = () => page.evaluate(() => structuredClone(StripeMaker.sheets.selected.markings ?? []));

    await page.locator('[data-editor="markingsEditor"]').click();
    assert.equal(await page.locator('#markingsLateralTab').getAttribute('aria-selected'), 'true');
    // Segmented control: arrow keys switch tabs.
    await page.locator('#markingsLateralTab').focus(); await page.keyboard.press('ArrowLeft');
    assert.equal(await page.locator('#markingsLongitudinal').isVisible(), true);
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.locator('#markingsLateral').isVisible(), true);

    // Hover previews; click adds a through arrow in lane 2.
    let at = await client(await lane(400, 1));
    await page.mouse.move(at.x, at.y);
    await page.waitForFunction(() => document.querySelector('.markingPreview path'));
    await page.screenshot({ path: '/tmp/stripemaker-marking-hover.png' });
    await page.mouse.click(at.x, at.y);
    let marks = await state();
    assert.equal(marks.length, 1);
    assert.deepEqual(marks[0].on, { road: 1, lane: 1 });
    assert.equal(marks[0].type, 'through');
    assert.equal(await page.evaluate(() => StripeMaker.sheets.selected.roadLayer.querySelectorAll('.laneMarkings path').length), 1);

    // Repeat: drag the square handle back along the lane.
    const handle = await page.locator('.markingRepeat').boundingBox();
    const back = await client(await lane(80, 1));
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2); await page.mouse.down();
    await page.mouse.move(back.x, back.y, { steps: 8 }); await page.mouse.up();
    marks = await state();
    assert(marks[0].repeat.length > 30, `repeat ${marks[0].repeat.length}`);
    const copies = await page.evaluate(() => StripeMaker.sheets.selected.roadLayer.querySelectorAll('.laneMarkings path').length);
    assert.equal(copies, Math.floor(marks[0].repeat.length / marks[0].repeat.spacing + 1e-6) + 1);
    await page.locator('#markingSpacingValue').fill('20'); await page.locator('#markingSpacingValue').blur();
    assert.equal((await state())[0].repeat.spacing, 20);
    await page.locator('#undoButton').click();
    assert.equal((await state())[0].repeat.spacing, 100);
    await page.locator('#redoButton').click();

    // High contrast adds black under the paint.
    await page.locator('#markingContrast').check();
    assert.equal((await state())[0].contrast, 'border');
    assert(await page.evaluate(() => [...StripeMaker.sheets.selected.roadLayer.querySelectorAll('.laneMarkings path')].some(p => p.getAttribute('stroke') === '#000000')));
    await page.locator('#markingContrastStyle').selectOption('block');
    assert.equal((await state())[0].contrast, 'block');

    // Escape deselects; choose a stop line and Shift-click to span both lanes.
    await page.locator('.markingHandle').focus(); await page.keyboard.press('Escape');
    assert.equal(await page.locator('.markingHandle').count(), 0);
    await page.locator('#chooseMarking').click();
    await page.locator('#markingSearch').fill('stop line');
    await page.locator('#markingGrid button').first().click();
    await page.locator('#markingPicker').waitFor({ state: 'hidden' });
    const end = await page.evaluate(() => { const t = StripeMaker.roadEditor.laneTracks(StripeMaker.sheets.selected)[0]; let s = 0; for (let i = 1; i < t.line.length; i++) s += Math.hypot(t.line[i].x - t.line[i - 1].x, t.line[i].y - t.line[i - 1].y); return s; });
    at = await client(await lane(end - 20, 0));
    await page.keyboard.down('Shift'); await page.mouse.move(at.x, at.y); await page.mouse.click(at.x, at.y); await page.keyboard.up('Shift');
    marks = await state();
    assert.equal(marks.length, 2);
    assert.equal(marks[1].type, 'stopLine'); assert.equal(marks[1].all, true); assert.equal(marks[1].back, 0);
    // On the curve the stop line stays a true 24 in x 24 ft rectangle (no distortion).
    const sides = await page.evaluate(() => {
      const len = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
      const corners = d => { const n = d.match(/-?\d*\.?\d+/g).map(Number); return [0, 1, 2, 3].map(i => ({ x: n[2 * i], y: n[2 * i + 1] })); };
      const p = [...StripeMaker.sheets.selected.roadLayer.querySelectorAll('.laneMarkings path')].map(p => p.getAttribute('d'))
        .filter(d => d.split('L').length === 4).map(corners).find(p => len(p[0], p[1]) > 100);
      return { sides: p.map((a, i) => len(a, p[(i + 1) % 4])), diagonals: [len(p[0], p[2]), len(p[1], p[3])] };
    });
    assert(Math.abs(sides.sides[0] - 144) < 0.1 && Math.abs(sides.sides[2] - 144) < 0.1, JSON.stringify(sides));
    assert(Math.abs(sides.sides[1] - 12) < 0.1 && Math.abs(sides.sides[3] - 12) < 0.1, JSON.stringify(sides));
    assert(Math.abs(sides.diagonals[0] - sides.diagonals[1]) < 0.1, 'square corners');

    // A two-line word message near the curve.
    await page.locator('.markingHandle').focus(); await page.keyboard.press('Escape');
    await page.locator('#chooseMarking').click(); await page.locator('#markingSearch').fill('word');
    assert.equal(await page.locator('#markingGrid button').count(), 1);
    await page.locator('#markingGrid button').first().click();
    assert.equal(await page.locator('#markingText').inputValue(), '');
    await page.locator('#markingText').fill('LEFT\nONLY');
    at = await client(await lane(end - 300, 0));
    await page.mouse.move(at.x, at.y); await page.mouse.click(at.x, at.y);
    marks = await state();
    assert.equal(marks[2].type, 'word'); assert.equal(marks[2].text, 'LEFT\nONLY');

    // A route shield.
    await page.locator('.markingHandle').focus(); await page.keyboard.press('Escape');
    await page.locator('#chooseMarking').click(); await page.locator('#markingCategory').selectOption('Route shields');
    await page.locator('#markingGrid button').first().click();
    await page.locator('#markingRoute').fill('275');
    at = await client(await lane(end - 120, 0));
    await page.mouse.move(at.x, at.y); await page.mouse.click(at.x, at.y);
    marks = await state();
    assert.equal(marks[3].type, 'shieldInterstate'); assert.equal(marks[3].route, '275');
    await page.screenshot({ path: '/tmp/stripemaker-markings.png' });

    // Dragging on open pavement off the lanes still pans.
    const view = await page.evaluate(() => ({ ...StripeMaker.sheets.selected.view }));
    await page.mouse.move(900, 800); await page.mouse.down(); await page.mouse.move(960, 830, { steps: 4 }); await page.mouse.up();
    assert.notEqual((await page.evaluate(() => StripeMaker.sheets.selected.view.x)), view.x);
    assert.equal((await state()).length, 4);

    // Keyboard: move along the lane and to the other lane; Delete removes.
    await page.locator('.markingHandle').focus();
    const before = (await state())[3];
    await page.keyboard.press('ArrowLeft');
    assert.equal((await state())[3].on.lane, 0);
    await page.keyboard.press('ArrowRight');
    assert.equal((await state())[3].on.lane, 1);
    await page.keyboard.press('ArrowUp');
    assert(Math.abs((await state())[3].back - (before.back - 1)) < 1e-6);
    await page.keyboard.press('Delete');
    assert.equal((await state()).length, 3);
    await page.locator('#undoButton').click();
    assert.equal((await state()).length, 4);

    // Cutting the road keeps markings where they were.
    const drawnBefore = await page.evaluate(() => [...StripeMaker.sheets.selected.roadLayer.querySelectorAll('.laneMarkings path')].map(p => p.getAttribute('d')).join(''));
    // Saved and restored with the sheet.
    await page.waitForTimeout(700);
    const saved = await state();
    await page.reload();
    await page.waitForFunction(() => StripeMaker.sheets.selected?.markings?.length === 4);
    assert.deepEqual(await state(), saved);
    const drawnAfter = await page.evaluate(() => [...StripeMaker.sheets.selected.roadLayer.querySelectorAll('.laneMarkings path')].map(p => p.getAttribute('d')).join(''));
    assert.equal(drawnAfter, drawnBefore);

    // Vector PDF and PNG downloads.
    await page.locator('[data-editor="downloadMenu"]').click();
    for (const format of ['png', 'pdf']) {
      await page.locator(`[data-format="${format}"]`).click();
      const download = page.waitForEvent('download'); await page.locator('#downloadSheet').click();
      await (await download).saveAs(`/tmp/stripemaker-markings-export.${format}`);
    }
    // Clear all removes markings as one undoable step.
    page.once('dialog', d => d.accept()); await page.locator('#clearAll').click();
    assert.equal((await state()).length, 0);
    await page.locator('#undoButton').click();
    assert.equal((await state()).length, 4);
    // Intersection approach lanes take markings too, and they follow the intersection.
    await page.locator('[data-editor="intersectionsEditor"]').click();
    await page.locator('#newIntersection').click();
    await page.locator('[data-editor="markingsEditor"]').click();
    const approach = await page.evaluate(() => {
      const t = StripeMaker.intersections.laneTracks(StripeMaker.sheets.selected).find(t => t.on.incoming);
      const [a, b] = t.line, f = 0.85, c = (t.bounds[0][0][0] + t.bounds[0][0][1]) / 2;
      const len = Math.hypot(b.x - a.x, b.y - a.y), tx = (b.x - a.x) / len, ty = (b.y - a.y) / len;
      return { x: a.x + (b.x - a.x) * f - ty * c, y: a.y + (b.y - a.y) * f + tx * c, on: t.on };
    });
    await page.locator('.markingHandle').count().then(n => n && page.locator('.markingHandle').focus().then(() => page.keyboard.press('Escape')));
    await page.locator('#chooseMarking').click(); await page.locator('#markingSearch').fill('stop line');
    await page.locator('#markingGrid button').first().click();
    at = await client(approach);
    await page.mouse.move(at.x, at.y); await page.mouse.click(at.x, at.y);
    marks = await state();
    assert.equal(marks.length, 5);
    assert.equal(marks[4].on.intersection, approach.on.intersection);
    assert.equal(marks[4].on.incoming, true);
    const stopPath = () => page.evaluate(() => [...StripeMaker.sheets.selected.roadLayer.querySelectorAll('.laneMarkings path')].at(-1).getAttribute('d'));
    const first = await stopPath();
    await page.evaluate(() => { const i = StripeMaker.sheets.selected.intersections[0]; i.x += 30; StripeMaker.roadEditor.render(); });
    assert.notEqual(await stopPath(), first);
    await page.screenshot({ path: '/tmp/stripemaker-markings-intersection.png' });
    // Narrow screens keep the panel usable.
    await page.setViewportSize({ width: 390, height: 844 });
    assert(await page.locator('#chooseMarking').isVisible());
    await page.screenshot({ path: '/tmp/stripemaker-markings-narrow.png' });
    assert.deepEqual(errors, []);
    console.log('markings browser test passed');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
