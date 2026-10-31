/* Same isolated Chromium setup as intersections.browser.cjs:
   PLAYWRIGHT_MODULE=/path/to/playwright node tests/longitudinal.browser.cjs */
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } }), errors = [];
    page.setDefaultTimeout(10000);
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(process.env.STRIPEMAKER_URL || pathToFileURL(path.resolve(__dirname, '../index.html')).href);
    const png = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 1600; c.height = 1200; const g = c.getContext('2d'); g.fillStyle = '#777'; g.fillRect(0, 0, 1600, 1200); return c.toDataURL().split(',')[1]; });
    await page.locator('#sheetFile').setInputFiles({ name: 'Lines test.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
    await page.waitForFunction(() => StripeMaker.sheets.selected);
    // Two 2-lane roads joined end to start at x = 700 (6 px per foot), and a
    // two-way road below.
    await page.evaluate(() => {
      const s = StripeMaker.sheets.selected; s.inchesPerPixel = 2;
      const road = (id, a, b, lanes = 2) => ({ id, lanes, laneWidth: 12, ends: [{ joint: a, sign: 1, length: null }, { joint: b, sign: 1, length: null }] });
      s.roads = [road(1, 1, 2), road(2, 2, 3), road(3, 4, 5, 1), { ...road(4, 5, 4, 1), ends: [{ joint: 5, sign: -1, length: null }, { joint: 4, sign: -1, length: null }] }];
      s.joints = [
        { id: 1, x: 150, y: 560, dir: { x: 1, y: 0 }, root: 1, links: [] },
        { id: 2, x: 700, y: 560, dir: { x: 1, y: 0 }, root: 1, links: [{ a: 1, ai: 0, b: 2, bi: 0 }] },
        { id: 3, x: 1450, y: 560, dir: { x: 1, y: 0 }, root: 2, links: [] },
        { id: 4, x: 150, y: 840, dir: { x: 1, y: 0 }, root: 3, links: [{ a: 3, ai: 0, b: 4, bi: 0, pair: true, median: 0 }] },
        { id: 5, x: 1450, y: 840, dir: { x: 1, y: 0 }, root: 3, links: [{ a: 3, ai: 0, b: 4, bi: 0, pair: true, median: 0 }] },
      ];
      StripeMaker.roadEditor.render(); StripeMaker.sheets.save(s); StripeMaker.history.record();
      document.dispatchEvent(new CustomEvent('sheetchange'));
    });
    const client = p => page.evaluate(p => {
      const box = document.getElementById('previewStage').getBoundingClientRect(), v = StripeMaker.sheets.selected.view;
      return { x: box.left + v.x + p.x * v.scale, y: box.top + v.y + p.y * v.scale };
    }, p);
    const lines = () => page.evaluate(() => structuredClone(StripeMaker.sheets.selected.lines ?? []));
    // Skip lines continue across the joint: road 2's lane line picks up the
    // 10'-30' cycle where road 1's leaves off.
    assert.equal(await page.evaluate(() => StripeMaker.longitudinal.phase('r:2:1')), 550);

    await page.locator('[data-editor="markingsEditor"]').click();
    await page.locator('#markingsLongitudinalTab').click();
    assert(await page.locator('#chooseLine').isVisible());
    await page.locator('#chooseLine').click();
    assert.equal(await page.locator('#markingCategory').isVisible(), false);
    assert(await page.locator('#markingGrid button').count() >= 12);
    await page.locator('#markingSearch').fill('solid line');
    await page.locator('#markingGrid button').first().click();
    await page.locator('#markingPicker').waitFor({ state: 'hidden' });
    // Drag along road 1's lane line (y = 560) from x = 300 to x = 600.
    let a = await client({ x: 300, y: 560 }), b = await client({ x: 600, y: 560 });
    await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 8 }); await page.mouse.up();
    let list = await lines();
    assert.equal(list.length, 1);
    assert.deepEqual(list[0].on, { road: 1, k: 1 });
    assert(Math.abs(list[0].from - 150 / 550) < 0.02 && Math.abs(list[0].to - 450 / 550) < 0.02, JSON.stringify(list[0]));
    assert.equal(list[0].style, 'solid');
    // The default skip line stays outside that stretch; the solid line is inside it.
    const strokes = await page.evaluate(() => [...StripeMaker.sheets.selected.roadLayer.querySelectorAll('.roadMarking')].map(p => {
      const [x, y] = p.getAttribute('d').slice(1).split('L')[0].split(' ').map(Number);
      return { x, y, dash: p.getAttribute('stroke-dasharray') };
    }).filter(s => Math.abs(s.y - 560) < 1 && s.x < 700));
    assert(strokes.some(s => Math.abs(s.x - 300) < 2 && !s.dash), JSON.stringify(strokes));
    assert(strokes.some(s => Math.abs(s.x - 600) < 2 && s.dash), JSON.stringify(strokes));
    assert(strokes.some(s => Math.abs(s.x - 150) < 2 && s.dash), JSON.stringify(strokes));

    // End nodes: the keyboard nudges the end 1 ft (6 px).
    await page.locator('.lineOverlay button[data-end="to"]').focus();
    await page.keyboard.press('ArrowRight');
    list = await lines();
    assert(Math.abs(list[0].to * 550 - (450 + 6)) < 1.5, JSON.stringify(list[0]));
    await page.locator('#undoButton').click();
    assert(Math.abs((await lines())[0].to * 550 - 450) < 1.5);
    await page.locator('#redoButton').click();

    // Shift-drag across all three of road 2's lines with a dotted guide line.
    await page.locator('.lineOverlay button[data-end]').first().focus(); await page.keyboard.press('Escape');
    await page.locator('#chooseLine').click(); await page.locator('#markingSearch').fill('guide');
    await page.locator('#markingGrid button').first().click();
    a = await client({ x: 900, y: 560 - 72 }); b = await client({ x: 1200, y: 560 + 72 });
    await page.keyboard.down('Shift');
    await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 8 }); await page.mouse.up();
    await page.keyboard.up('Shift');
    list = await lines();
    assert.equal(list.length, 4, JSON.stringify(list));
    assert.deepEqual(list.slice(1).map(l => l.on.k).sort(), [0, 1, 2]);
    assert(list.slice(1).every(l => l.style === 'dottedGuide'));

    // A click on a line marks all of it; high contrast skip lines add black.
    await page.locator('.lineOverlay button[data-end]').first().focus(); await page.keyboard.press('Escape');
    await page.locator('#chooseLine').click(); await page.locator('#markingSearch').fill('skip line');
    await page.locator('#markingGrid button').first().click();
    await page.locator('#lineContrast').check();
    a = await client({ x: 400, y: 560 + 72 });
    await page.mouse.click(a.x, a.y);
    list = await lines();
    assert.equal(list.length, 5);
    assert.deepEqual([list[4].from, list[4].to, list[4].contrast], [0, 1, undefined], 'no contrast on the right edge line');
    // Contrast on a lane line: select the first line, switch it to a skip with contrast.
    await page.locator('.lineOverlay button[data-end]').first().focus(); await page.keyboard.press('Escape');
    a = await client({ x: 400, y: 560 });
    await page.mouse.click(a.x, a.y);
    await page.locator('#chooseLine').click(); await page.locator('#markingSearch').fill('skip line');
    await page.locator('#markingGrid button').first().click();
    await page.locator('#lineContrast').check();
    list = await lines();
    assert.equal(list[0].style, 'skip'); assert.equal(list[0].contrast, true);
    assert(await page.evaluate(() => [...StripeMaker.sheets.selected.roadLayer.querySelectorAll('.roadMarking')].some(p => p.getAttribute('stroke') === '#000000' && p.getAttribute('stroke-dasharray'))));

    // A two-way road's centerline takes one line (solid and skip) that replaces
    // both sides' yellow edge lines.
    await page.locator('.lineOverlay button[data-end]').first().focus(); await page.keyboard.press('Escape');
    await page.locator('#chooseLine').click(); await page.locator('#markingSearch').fill('solid and skip');
    await page.locator('#markingGrid button').first().click();
    a = await client({ x: 500, y: 840 }); b = await client({ x: 1000, y: 840 });
    await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 8 }); await page.mouse.up();
    list = await lines();
    assert.deepEqual(list.at(-1).on, { road: 3, k: 'C' });
    await page.screenshot({ path: '/tmp/stripemaker-longitudinal.png' });

    // Through an intersection: a skip line on a movement edge continues the
    // pattern of the road lane line that feeds it.
    const chained = await page.evaluate(() => {
      const s = StripeMaker.sheets.selected, G = StripeMaker.intersectionGeometry;
      const item = G.create(); item.x = 1300; item.y = 1080; G.normalize(item);
      const [a, , c] = G.ordered(item).filter((_, i) => i !== 1 && i !== 3).length ? [item.approaches[0], null, item.approaches[2]] : [];
      item.movements.push(G.movement(a, 0, c, 0));
      s.intersections = [item];
      const k = 12 / s.inchesPerPixel, mouth = G.lane(a, true, 0), u = G.axes(a).u;
      // A one-lane road ending at the incoming lane's mouth, heading in.
      s.joints.push({ id: 6, x: item.x + (mouth.x + u.x * 60) * k, y: item.y + (mouth.y + u.y * 60) * k, dir: { x: -u.x, y: -u.y }, root: 5, links: [] },
        { id: 7, x: item.x + mouth.x * k, y: item.y + mouth.y * k, dir: { x: -u.x, y: -u.y }, root: 5, links: [] });
      s.roads.push({ id: 5, lanes: 1, laneWidth: 12, ends: [{ joint: 6, sign: 1, length: null }, { joint: 7, sign: 1, length: null }] });
      const m = item.movements[0];
      s.lines.push({ id: 'through', style: 'skip', color: 'white', on: { intersection: item.id, movement: m.id, side: 'L' }, from: 0, to: 1 });
      StripeMaker.roadEditor.render();
      return { edge: StripeMaker.longitudinal.phase(`m:${item.id}:${m.id}:L`), road: StripeMaker.longitudinal.phase('r:5:0'),
        drawn: [...s.roadLayer.querySelectorAll('.roadMarking')].filter(p => p.getAttribute('stroke-dasharray')).length };
    });
    assert(Math.abs(chained.edge - (chained.road + 60 * 6)) < 1, JSON.stringify(chained));

    // Saved and restored.
    await page.waitForTimeout(700);
    const saved = await lines();
    await page.reload();
    await page.waitForFunction(() => StripeMaker.sheets.selected?.lines?.length > 0);
    assert.deepEqual(await lines(), saved);
    // Clear all removes lines too, undoably.
    page.once('dialog', d => d.accept()); await page.locator('#clearAll').click();
    assert.equal((await lines()).length, 0);
    await page.locator('#undoButton').click();
    assert.equal((await lines()).length, saved.length);
    assert.deepEqual(errors, []);
    console.log('longitudinal browser test passed');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
