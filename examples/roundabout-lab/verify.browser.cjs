/* Isolated browser; never opens or replaces the user's saved project.
   PLAYWRIGHT_MODULE=/path/to/playwright CHROME_PATH=/path/to/chrome \
   STRIPEMAKER_URL=http://127.0.0.1:8876 node examples/roundabout-lab/verify.browser.cjs */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = __dirname, manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json')));
const report = { observedAt: new Date().toISOString(), files: [], errors: [], cases: [] };
const reportFile = !process.env.LAB_FILE ? 'browser-audit.json' : process.env.LAB_FILE === 'Roundabout Inspection Library.json'
  ? 'review-browser-audit.json' : `${path.basename(process.env.LAB_FILE, '.json')}-browser-audit.json`;
const save = () => fs.writeFileSync(process.env.LAB_REPORT || path.join(root, reportFile), JSON.stringify(report, null, 2) + '\n');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  try {
    // The two-way file is a subset of the full lane-count matrix; validate its
    // envelope in generate.cjs, and exercise its cases once in the full matrix.
    for (const file of manifest.files.filter(f => f.file !== 'Two-way Lane Count Matrix.json' && (!process.env.LAB_FILE || f.file === process.env.LAB_FILE))) {
      const project = JSON.parse(fs.readFileSync(path.join(root, file.file)));
      const context = await browser.newContext({ viewport: { width: 1500, height: 1100 } }), page = await context.newPage();
      page.on('pageerror', e => report.errors.push({ file: file.file, message: e.message, stack: e.stack }));
      try {
        await page.goto(process.env.STRIPEMAKER_URL || 'http://127.0.0.1:8876');
        await page.waitForFunction(() => StripeMaker.sheets.ready && StripeMaker.projectJSON && StripeMaker.roundaboutGeometry
          && StripeMaker.markingCatalog && StripeMaker.markings && StripeMaker.longitudinal);
        const ids = await page.evaluate(async p => (await StripeMaker.projectJSON.load(p)).map(s => s.id), project);
        const result = { file: file.file, imported: ids.length, expected: project.sheets.length, reload: null };
        for (let offset = 0; offset < ids.length; offset += 8) {
          const records = await page.evaluate(({ ids, expected }) => ids.map((id, i) => {
            const app = StripeMaker, input = expected[i];
            document.querySelector(`button.headListButton[data-sheet-id="${id}"]`).click();
            const sheet = app.sheets.selected;
            try {
              app.roadEditor.render();
              const first = JSON.stringify(sheet.intersections);
              document.dispatchEvent(new CustomEvent('sheetchange'));
              const state = app.sheets.snapshot(sheet), svg = sheet.roadLayer?.outerHTML ?? '';
              // Compare editable input properties, allowing only extra
              // normalization fields. Record changes rather than fixing them.
              const changes = [], roundoff = [];
              const compare = (a, b, at = '') => {
                if (a && typeof a === 'object') {
                  for (const [key, value] of Object.entries(a)) compare(value, b?.[key], `${at}.${key}`);
                } else if (a !== b) {
                  const list = typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < 1e-8 ? roundoff : changes;
                  list.push({ path: at, before: a, after: b });
                }
              };
              for (const key of ['intersections', 'roads', 'joints', 'lines', 'markings']) compare(input.data[key], state[key], key);
              return { id: input.labCase.id, rendered: svg.includes('<path'), finite: !/NaN|Infinity/.test(svg),
                idempotent: first === JSON.stringify(sheet.intersections), inputChanges: changes, roundoff };
            } catch (error) { return { id: input.labCase.id, error: error.message }; }
          }), { ids: ids.slice(offset, offset + 8), expected: project.sheets.slice(offset, offset + 8) });
          report.cases.push(...records);
          console.log(`Rendered ${report.cases.length}/${manifest.uniqueCases}`);
        }
        if (file.file === 'Roundabout Inspection Library.json') {
          if (process.env.SHOTS) {
            fs.mkdirSync(process.env.SHOTS, { recursive: true });
            for (const caseId of ['R001', 'R004', 'R015', 'R021', 'R065', 'R084', 'R089', 'R092']) {
              const i = project.sheets.findIndex(s => s.labCase.id === caseId);
              if (i < 0) continue;
              await page.evaluate(id => document.querySelector(`button.headListButton[data-sheet-id="${id}"]`).click(), ids[i]);
              await page.screenshot({ path: path.join(process.env.SHOTS, `${caseId}.png`) });
            }
          }
          const before = await page.evaluate(() => StripeMaker.sheets.all.map(s => JSON.stringify(s.intersections)));
          await page.waitForTimeout(1000); await page.reload();
          await page.waitForFunction(() => StripeMaker.sheets.ready && StripeMaker.projectJSON);
          result.reload = JSON.stringify(before) === JSON.stringify(await page.evaluate(() => StripeMaker.sheets.all.map(s => JSON.stringify(s.intersections))));
          // Exercise the actual project exporter without the large diagnostics
          // payload becoming part of the fixture inputs.
          result.exportCount = await page.evaluate(async () => (await StripeMaker.projectJSON.snapshot()).sheets.length);
        }
        report.files.push(result); save();
      } catch (error) { report.files.push({ file: file.file, error: error.message }); save(); }
      finally { await context.close(); }
    }
    report.summary = { rendered: report.cases.filter(c => c.rendered).length,
      failures: report.cases.filter(c => c.error || !c.rendered || !c.finite || !c.idempotent).map(c => c.id),
      inputChanges: report.cases.filter(c => c.inputChanges?.length).map(c => c.id),
      pageErrors: report.errors.length, fileErrors: report.files.filter(f => f.error).length };
    save(); console.log(JSON.stringify(report.summary));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); save(); process.exitCode = 1; });
