/* Same isolated Chromium setup as intersections.browser.cjs:
   PLAYWRIGHT_MODULE=/path/to/playwright node tests/editing-fixes.browser.cjs
   Double-click focus and road splitting, lane-split gores, independent curve
   handles, sign leader weight and the Settings popover. */
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
    await page.locator('#sheetFile').setInputFiles({ name: 'Fixes test.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
    await page.waitForFunction(() => StripeMaker.sheets.selected);
    // Road 1 (2 lanes, east) ends at joint 2; road 3 continues it; ramp road 2
    // starts on road 1's right lane (a lane split) and bends away south.
    await page.evaluate(() => {
      const s = StripeMaker.sheets.selected; s.inchesPerPixel = 2;
      s.roads = [
        { id: 1, lanes: 2, laneWidth: 12, ends: [{ joint: 1, sign: 1, length: null }, { joint: 2, sign: 1, length: null }] },
        { id: 3, lanes: 2, laneWidth: 12, ends: [{ joint: 2, sign: 1, length: null }, { joint: 3, sign: 1, length: null }] },
        { id: 2, lanes: 1, laneWidth: 12, ends: [{ joint: 2, sign: 1, length: 250 }, { joint: 4, sign: 1, length: null }] },
      ];
      s.joints = [
        { id: 1, x: 200, y: 500, dir: { x: 1, y: 0 }, root: 1, links: [] },
        { id: 2, x: 700, y: 500, dir: { x: 1, y: 0 }, root: 1, links: [{ a: 1, ai: 0, b: 3, bi: 0 }, { a: 1, ai: 1, b: 2, bi: 0 }] },
        { id: 3, x: 1450, y: 500, dir: { x: 1, y: 0 }, root: 3, links: [] },
        { id: 4, x: 1300, y: 800, dir: { x: 0.8, y: 0.6 }, root: 2, links: [] },
      ];
      StripeMaker.roadEditor.render(); StripeMaker.sheets.save(s); StripeMaker.history.record();
      document.dispatchEvent(new CustomEvent('sheetchange'));
    });
    const client = p => page.evaluate(p => {
      const box = document.getElementById('previewStage').getBoundingClientRect(), v = StripeMaker.sheets.selected.view;
      return { x: box.left + v.x + p.x * v.scale, y: box.top + v.y + p.y * v.scale };
    }, p);
    const view = () => page.evaluate(() => ({ ...StripeMaker.sheets.selected.view }));

    // 3. A lane split offers a gore.
    await page.locator('[data-editor="elementsEditor"]').click();
    await page.waitForFunction(() => document.querySelector('.goreHandle'));
    assert.equal(await page.locator('.goreHandle').count(), 1);
    // Three roads meet there: every road's nodes show, none on top of another.
    const spots = await page.evaluate(() => [...document.querySelectorAll('.roadNode')].map(n => `${Math.round(parseFloat(n.style.left))},${Math.round(parseFloat(n.style.top))}`));
    assert.equal(new Set(spots).size, spots.length, JSON.stringify(spots));
    // Each road's nodes share one color (red first); the split road's nodes are the outer ones.
    const nodes = await page.evaluate(() => [...document.querySelectorAll('.roadNode')].map(n => ({ road: n.dataset.road, end: n.dataset.end, lane: n.dataset.lane, x: parseFloat(n.style.left), icon: n.style.backgroundImage })));
    assert(nodes.some(n => n.icon.includes('hsl(0')), 'red group');
    const ramp = nodes.find(n => n.road === '2' && n.end === '0'), main = nodes.find(n => n.road === '3' && n.end === '0' && n.lane === '1');
    assert(ramp.x > main.x, 'split road steps aside');
    const icons = road => new Set(nodes.filter(n => n.road === road).map(n => n.icon));
    for (const road of ['1', '2', '3']) assert.equal(icons(road).size, 1, `road ${road} has one color`);
    assert.equal(new Set(['1', '2', '3'].map(r => [...icons(r)][0])).size, 3, 'each road its own color');

    // 1. Double-clicking a road (Elements closed) focuses it instead of refitting.
    await page.locator('[data-editor="elementsEditor"]').click();
    await page.mouse.move(700, 900); await page.mouse.wheel(0, -200); await page.waitForTimeout(100);
    const zoomed = await view();
    let at = await client({ x: 400, y: 500 + 36 });
    await page.mouse.dblclick(at.x, at.y);
    assert.equal(await page.locator('#elementsEditor').isVisible(), true);
    assert.deepEqual(await view(), zoomed, 'view kept');
    assert.equal(await page.locator('#deleteRoad').isDisabled(), false, 'road selected');
    // Double-click never refits, even on empty sheet.
    at = await client({ x: 300, y: 1100 });
    await page.mouse.dblclick(at.x, at.y);
    assert.deepEqual(await view(), zoomed, 'no double-click refit');

    // 4. With Elements open, double-clicking a road splits it in two, joined.
    // A crosswalk and a line on the road must not block the cut (they once did),
    // and both stay where they were.
    await page.evaluate(() => {
      const s = StripeMaker.sheets.selected;
      s.markings = [{ id: 'cw', type: 'crosswalk', a: { x: 1300, y: 422, on: { road: 3, side: 'L', f: 0.8 } }, b: { x: 1300, y: 578, on: { road: 3, side: 'R', f: 0.8 } }, width: 10 }];
      s.lines = [{ id: 'ln', style: 'solid', color: 'white', on: { road: 3, k: 1 }, from: 0.2, to: 0.9 }];
      StripeMaker.roadEditor.render();
    });
    const before = await page.evaluate(() => StripeMaker.sheets.selected.roads.length);
    at = await client({ x: 1200, y: 500 - 36 });
    await page.mouse.dblclick(at.x, at.y);
    const split = await page.evaluate(() => ({ roads: StripeMaker.sheets.selected.roads.length, joints: StripeMaker.sheets.selected.joints.length }));
    assert.equal(split.roads, before + 1);
    const kept = await page.evaluate(() => ({ lines: StripeMaker.sheets.selected.lines.map(l => l.on.road), cw: StripeMaker.sheets.selected.markings[0].a }));
    assert.equal(kept.lines.length, 2, 'the line is split across both pieces');
    assert(Math.abs(kept.cw.x - 1300) < 2 && kept.cw.on, 'crosswalk end still on the edge');
    await page.locator('#undoButton').click();
    assert.equal(await page.evaluate(() => StripeMaker.sheets.selected.roads.length), before);

    // 5. Option-dragging a curve handle at a shared joint turns only that road.
    const turned = await page.evaluate(() => {
      const s = StripeMaker.sheets.selected, joint = s.joints.find(j => j.id === 2), dir = { ...joint.dir };
      s.roads.find(r => r.id === 2).ends[0].dir = { x: 0.6, y: 0.8 };
      StripeMaker.roadEditor.render();
      return { joint: joint.dir, dir };
    });
    assert.deepEqual(turned.joint, turned.dir);
    // The bend it makes is paved round, with no gap.
    assert(await page.evaluate(() => StripeMaker.sheets.selected.roadLayer.querySelectorAll('.roadPavement > .roadBand').length > StripeMaker.sheets.selected.roads.length));
    await page.locator('#independentCurves').check();
    assert(await page.locator('#independentCurves').isChecked());

    // Settings: the sign arrow thickness is kept across reloads.
    await page.locator('[data-editor="settingsMenu"]').click();
    assert(await page.locator('#signArrowWeight').isVisible());
    await page.locator('#signArrowWeightValue').fill('200'); await page.locator('#signArrowWeightValue').blur();
    assert.equal(await page.evaluate(() => StripeMaker.settings.get('signArrowWeight')), 200);
    await page.waitForTimeout(700);
    await page.reload();
    await page.waitForFunction(() => StripeMaker.sheets.selected);
    assert.equal(await page.evaluate(() => StripeMaker.settings.get('signArrowWeight')), 200, 'kept across reloads');
    assert.deepEqual(errors, []);
    console.log('editing fixes browser test passed');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
