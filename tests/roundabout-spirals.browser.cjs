/* Isolated browser; same environment as roundabouts.browser.cjs.
   ROUNDABOUT_REPRO_FILES may name original exported projects, separated by |. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fixtures = ['roundabout-continuing-lane-kink', 'roundabout-mini-path-kink', 'roundabout-double-left-spiral', 'roundabout-path-lane-alignment', 'roundabout-wide-medians', 'roundabout-two-lane-exit'];
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } }), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(process.env.STRIPEMAKER_URL || 'http://127.0.0.1:8876');
    await page.waitForFunction(() => StripeMaker.sheets.ready && StripeMaker.projectJSON && StripeMaker.intersections);
    await page.locator('#blankSheet').evaluate(b => b.click());
    await page.waitForFunction(() => StripeMaker.sheets.selected?.inchesPerPixel);
    const base = await page.evaluate(() => StripeMaker.projectJSON.snapshot('selected'));
    async function verify(project, name) {
      await page.evaluate(project => StripeMaker.projectJSON.load(project), project);
      const report = await page.evaluate(() => {
        const app = StripeMaker, s = app.sheets.selected, x = s.intersections.find(x => x.kind === 'roundabout'), R = app.roundaboutGeometry;
        app.intersections.focusAt(x);
        const L = R.layout(x), painting = R.markings(x);
        return { name: x.name, paths: s.roadLayer.querySelectorAll('path').length,
          bad: [...s.roadLayer.querySelectorAll('path')].some(p => /NaN|Infinity/.test(p.getAttribute('d'))),
          guides: L.spiralPlan?.transitions.map(t => t.guides.length) ?? [],
          painted: painting.lines.filter(l => l.dash?.[0] === 2 && l.dash[1] === 4).length,
          approaches: x.approaches.length };
      });
      assert.ok(report.paths > 10, 'pavement and markings rendered');
      assert.equal(report.bad, false, 'all vector coordinates finite');
      if (name.startsWith('double-')) { assert.deepEqual(report.guides, [2]); assert.ok(report.painted >= 2); }
      for (let i = 1; i <= report.approaches; i++) {
        const number = page.getByRole('button', { name: `Select approach ${i}`, exact: true });
        await number.focus(); await number.press('Enter');
        const guides = await page.locator('.intersectionMovement[data-approach]').evaluateAll(paths => paths.map(p => ({ approach: p.dataset.approach, d: p.getAttribute('d') })));
        assert.ok(new Set(guides.map(p => p.approach)).size <= 1, 'only the selected approach');
        assert.ok(guides.every(p => !/NaN|Infinity/.test(p.d)));
      }
      if (process.env.SHOTS) {
        const entry = await page.evaluate(() => Math.max(1, StripeMaker.sheets.selected.intersections.find(x => x.kind === 'roundabout').approaches.findIndex(a => a.incoming > 1) + 1));
        await page.getByRole('button', { name: `Select approach ${entry}`, exact: true }).press('Enter');
        await page.evaluate(() => {
          const s = StripeMaker.sheets.selected, x = s.intersections.find(x => x.kind === 'roundabout'), R = StripeMaker.roundaboutGeometry;
          const points = R.outline(x), scale = 12 / s.inchesPerPixel;
          const xs = points.map(p => x.x + p.x * scale), ys = points.map(p => x.y + p.y * scale);
          const svg = s.roadLayer.cloneNode(true), pad = 50;
          svg.id = 'spiral-preview';
          svg.setAttribute('viewBox', `${Math.min(...xs)-pad} ${Math.min(...ys)-pad} ${Math.max(...xs)-Math.min(...xs)+pad*2} ${Math.max(...ys)-Math.min(...ys)+pad*2}`);
          svg.style.cssText = 'position:fixed;inset:0;width:1500px;height:1100px;z-index:9999;transform:none;background:white';
          document.body.append(svg);
        });
        await page.screenshot({ path: `${process.env.SHOTS}/${name}.png` });
        await page.locator('#spiral-preview').evaluate(p => p.remove());
      }
      const output = await page.evaluate(() => StripeMaker.projectJSON.snapshot('selected'));
      assert.deepEqual(output.diagnostics.invalidNumbers, []);
      assert.ok(output.diagnostics.sheets[0].renderedSVG.includes('<path'), 'export uses the actual vector geometry');
      console.log(`${name}: imported, rendered, selected every approach, exported`);
    }
    for (const [i, name] of fixtures.entries()) {
      const input = require(`./fixtures/${name}.json`);
      for (const shape of i === 2 ? ['circle', 'oval', 'peanut'] : [null]) {
        const project = structuredClone(base), x = structuredClone(input), d = project.sheets[0].data;
        Object.assign(x, { x: 15000, y: 15000 });
        if (shape) {
          x.roundabout.shape = shape; x.roundabout.ratio = 1.5;
          // Shape changes move the free mouths out along their own directions.
          x.approaches = await page.evaluate(x => { const R=StripeMaker.roundaboutGeometry,G=StripeMaker.intersectionGeometry;
            for(const a of x.approaches)Object.assign(a,G.mul(G.axes(a).u,R.requiredReach(x,a)));return x.approaches; }, x);
        }
        d.intersections = [x];
        await verify(project, shape ? `double-${shape}` : name);
      }
    }
    for (const [i, file] of (process.env.ROUNDABOUT_REPRO_FILES || '').split('|').filter(Boolean).entries())
      await verify(JSON.parse(fs.readFileSync(file, 'utf8')), `original-${i+1}`);
    const before = await page.evaluate(() => JSON.stringify(StripeMaker.sheets.selected.intersections));
    await page.waitForTimeout(600); await page.reload();
    await page.waitForFunction(() => StripeMaker.sheets.ready && StripeMaker.sheets.selected?.intersections?.length);
    assert.equal(await page.evaluate(() => JSON.stringify(StripeMaker.sheets.selected.intersections)), before, 'geometry persists on reload');
    assert.deepEqual(errors, []);
    console.log('roundabout spiral regression browser tests passed');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
