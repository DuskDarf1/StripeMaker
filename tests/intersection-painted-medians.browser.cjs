/* Isolated browser regression; same environment variables as intersections.browser.cjs. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const selectChoice = require('./select-choice.cjs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'painted-intersection-'));
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, acceptDownloads: true }), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(process.env.STRIPEMAKER_URL || 'http://127.0.0.1:8876');
    await page.locator('#blankSheet').evaluate(b => b.click());
    await page.waitForFunction(() => StripeMaker.sheets.selected?.inchesPerPixel);
    await page.getByRole('button', { name: 'Intersections', exact: true }).click();
    await page.locator('#newIntersection').click();
    const fill = async (id, value) => { await page.locator(id).fill(String(value)); await page.locator(id).press('Tab'); };
    const state = () => page.evaluate(() => structuredClone(StripeMaker.sheets.selected.intersections[0]));
    await fill('#intersection-median', 12);
    await selectChoice(page.locator('#intersection-median-surface'), 'painted');
    assert.equal((await state()).approaches[0].surface, 'painted');
    assert.equal(await page.locator('#intersection-median-color').inputValue(), 'yellow');
    const stripes = () => page.evaluate(() => [...document.querySelectorAll('.roadLayer g[clip-path^="url(#intersection-painted-"]')].map(g => ({
      id: g.getAttribute('clip-path'), paths: [...g.querySelectorAll('path')].map(p => ({ d: p.getAttribute('d'), width: Number(p.getAttribute('stroke-width')), color: p.getAttribute('stroke') })),
    })));
    let marks = await stripes();
    assert.equal(marks.length, 1);
    assert.ok(marks[0].paths.length > 0);
    assert.ok(marks[0].paths.every(p => p.color === '#ffc72c' && p.width === 9), '18-inch stripes at 2 inches/pixel');
    const initialPaths = JSON.stringify(marks);
    await selectChoice(page.locator('#intersection-median-lean'), 'left');
    assert.notEqual(JSON.stringify(await stripes()), initialPaths, 'direction changes drawn stripes');
    await fill('#intersection-median-spacing', 10);
    assert.equal((await state()).approaches[0].spacing, 10);
    assert.equal(await page.locator('#intersection-median-spacing-range').inputValue(), '10');
    await page.locator('#undoButton').click();
    assert.equal((await state()).approaches[0].spacing, undefined, 'spacing is one undo step');
    await page.locator('#redoButton').click();
    assert.equal((await state()).approaches[0].spacing, 10);
    // A same-direction island defaults to white, independently of the center median.
    await fill('#intersection-Incominglanes', 2);
    await selectChoice(page.locator('#intersection-median-add'), 'in-1');
    await page.getByRole('button', { name: 'Add Median', exact: true }).click();
    const split = (await state()).approaches[0].splits[0];
    await selectChoice(page.locator(`#intersection-split-surface-${split.id}`), 'painted');
    assert.equal(await page.locator(`#intersection-split-${split.id}-color`).inputValue(), 'white');
    marks = await stripes();
    assert.equal(marks.length, 2);
    assert.ok(marks.some(m => m.paths.some(p => p.color === '#ffffff')));
    // No raised fills or curbs remain for either painted island.
    assert.equal(await page.locator('.roadLayer path[fill="#5e7f3c"], .roadLayer path[fill="#bdbbb4"]').count(), 0);
    await selectChoice(page.locator('#intersection-median-color'), 'white');
    assert.ok((await stripes()).every(m => m.paths.every(p => p.color === '#ffffff')));
    await selectChoice(page.locator('#intersection-median-color'), 'yellow');
    // Real road-layer rendering, fitted for visual inspection.
    await page.evaluate(() => {
      const s = StripeMaker.sheets.selected, it = s.intersections[0];
      const svg = s.roadLayer.cloneNode(true);
      svg.id = 'paintedMedianPreview';
      svg.setAttribute('viewBox', `${it.x - 480} ${it.y - 480} 960 960`);
      svg.style.cssText = 'position:fixed;right:0;top:0;width:960px;height:960px;z-index:9999;transform:none;background:white';
      document.body.append(svg);
    });
    await page.locator('#paintedMedianPreview').screenshot({ path: path.join(output, 'painted-medians.png') });
    await page.locator('#paintedMedianPreview').evaluate(e => e.remove());
    const saved = JSON.stringify(await state());
    await page.waitForTimeout(700);
    await page.reload();
    await page.waitForFunction(() => StripeMaker.sheets.ready && StripeMaker.sheets.selected?.intersections?.length);
    assert.equal(JSON.stringify(await state()), saved, 'all painted settings persist');
    assert.equal((await stripes()).length, 2, 'painted medians redraw after reload');
    await page.getByRole('button', { name: 'Download', exact: true }).click();
    await page.locator('[data-format="pdf"]').click();
    const downloading = page.waitForEvent('download');
    await page.locator('#downloadSheet').click();
    await (await downloading).saveAs(path.join(output, 'painted-medians.pdf'));
    const pdf = fs.readFileSync(path.join(output, 'painted-medians.pdf')).toString('latin1');
    const contentsId = pdf.match(/\/Contents (\d+) 0 R/)[1];
    const start = pdf.indexOf(`${contentsId} 0 obj\n`), stream = pdf.indexOf('stream\n', start) + 7;
    const length = Number(pdf.slice(start, stream).match(/\/Length (\d+)/)[1]);
    const content = require('node:zlib').inflateSync(Buffer.from(pdf.slice(stream, stream + length), 'latin1')).toString();
    assert.match(content, /W\*?\s+n/, 'PDF keeps vector clipping for painted stripes');
    assert.ok((content.match(/\bl\n/g) || []).length > 100, 'PDF includes vector island outlines and stripes');
    assert.deepEqual(errors, []);
    console.log(`PASS: painted center/split islands, direction, spacing, undo/redo, persistence, vector PDF. Artifacts: ${output}`);
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
