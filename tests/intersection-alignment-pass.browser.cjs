// A warm alignment cache must match another complete normalization pass.
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fixture = require('./fixtures/dense-editor.cjs');

(async () => {
  const browser = await chromium.launch({ headless: true,
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  try {
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.env.STRIPEMAKER_URL || 'http://127.0.0.1:8883');
    await page.waitForFunction(() => StripeMaker.sheets.ready);
    await page.locator('#blankSheet').evaluate(button => button.click());
    await page.waitForFunction(() => StripeMaker.sheets.selected);
    const results = await page.evaluate(data => {
      const A = StripeMaker, original = A.sheets.selected;
      const state = sheet => structuredClone({ roads: sheet.roads, joints: sheet.joints,
        intersections: sheet.intersections, medians: sheet.medians });
      const differences = (a, b, path = '', output = []) => {
        if (Object.is(a, b)) return output;
        if (typeof a === 'number' && typeof b === 'number') {
          // Repeating rotation/translation can change the last few binary bits.
          // Widths, IDs, links and all other state must still match exactly.
          if (Math.abs(a - b) <= 1e-9 && /\.(x|y|angle|axis)$/.test(path)) return output;
          output.push({ path, a, b }); return output;
        }
        if (a && b && typeof a === 'object' && typeof b === 'object') {
          for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) differences(a[key], b[key], `${path}.${key}`, output);
        } else output.push({ path, a, b });
        return output;
      };
      const results = [];
      for (const scenario of ['dense', 'widths', 'bound', 'stale-link', 'split', 'roundabout']) {
        const sheet = { ...original, ...structuredClone(data) };
        // Layer identity is irrelevant to geometry reads, but supplies the
        // existing layer so solve() does not initialize UI for this test copy.
        const last = sheet.intersections.at(-1), approach = last.approaches[2];
        if (scenario === 'widths') {
          sheet.roads[0].perLaneWidths = true;
          sheet.roads[0].laneEndWidths = { '0:0': 8, '1:1': 17 };
          for (const item of sheet.intersections) for (const a of item.approaches) { a.width = 10; a.outWidth = 14; }
        }
        if (scenario === 'bound') for (const item of sheet.intersections) for (const a of item.approaches) {
          a.binding = { road: a.links[0].road, e: a.links[0].e }; delete a.links;
        }
        if (scenario === 'stale-link') approach.links.push({ ...approach.links[0], lane: 900, to: 'removed' });
        if (scenario === 'split') approach.splits = [{ id: 'late-split', incoming: true, after: 1, width: 5, surface: 'concrete' }];
        if (scenario === 'roundabout') {
          last.kind = 'roundabout'; A.roundaboutGeometry.normalize(last);
          approach.bezierSides = { entry: { pull: 0, offset: 0, connection: { along: 3, across: 2 } } };
        }
        try { A.intersections.alignLinks(sheet); }
        catch (error) { throw new Error(`${scenario}, initial pass: ${error.stack}`); }
        for (let pass = 0; pass < 3; pass++) {
          const uncached = { ...sheet, ...state(sheet) };
          try { A.intersections.alignLinks(sheet); A.intersections.alignLinks(uncached); }
          catch (error) { throw new Error(`${scenario}, repeat ${pass}: ${error.stack}`); }
          results.push({ scenario, pass, differences: differences(state(sheet), state(uncached)).slice(0, 8) });
        }
      }
      // Retain the same item/approach/road objects between edits, so these
      // checks exercise warm per-approach entries as well as per-item entries.
      const sheet = { ...original, ...structuredClone(data) };
      A.intersections.alignLinks(sheet); A.intersections.alignLinks(sheet);
      const item = sheet.intersections[0], approach = item.approaches[0];
      const links = structuredClone(approach.links);
      const edits = [
        ['intersection position', () => { item.x += 71.25; item.y -= 37.5; }],
        ['one attached joint', () => {
          const link = approach.links[0], road = sheet.roads.find(r => r.id === link.road);
          const joint = sheet.joints.find(j => j.id === road.ends[link.e].joint);
          joint.x += 23.5; joint.y -= 19.25;
        }],
        ['mouth width', () => {
          approach.width = 13.5; approach.outWidth = 10.5;
          for (const id of approach.inLanes) if (approach.laneDetails?.[id]) approach.laneDetails[id].width = 13.5;
          for (const id of approach.outLanes) if (approach.laneDetails?.[id]) approach.laneDetails[id].width = 10.5;
        }],
        ['one lane detail', () => {
          approach.laneDetails[approach.outLanes[0]].width = 15.25;
          approach.laneDetails[approach.inLanes[1]].width = 9.75;
        }],
        ['remove one attachment', () => { approach.links = approach.links.slice(1); }],
        ['restore one attachment', () => { approach.links.unshift(structuredClone(links[0])); }],
        ['remove mouth attachments', () => { delete approach.links; }],
        ['restore mouth attachments', () => { approach.links = structuredClone(links); }],
        ['neighboring mouth dimensions', () => {
          const link = approach.links[0], road = sheet.roads.find(r => r.id === link.road);
          const farJoint = road.ends[1 - link.e].joint;
          const neighbors = new Set(sheet.roads.filter(r => r.ends.some(end => end.joint === farJoint)).map(r => r.id));
          for (const other of sheet.intersections) if (other !== item) for (const a of other.approaches) {
            if (!a.links?.some(ref => neighbors.has(ref.road))) continue;
            a.width = 14.75;
            for (const id of a.inLanes) if (a.laneDetails?.[id]) a.laneDetails[id].width = 14.75;
          }
        }],
      ];
      for (const [scenario, edit] of edits) {
        edit();
        for (let pass = 0; pass < 2; pass++) {
          const uncached = { ...sheet, ...state(sheet) };
          try { A.intersections.alignLinks(sheet); A.intersections.alignLinks(uncached); }
          catch (error) { throw new Error(`warm ${scenario}, repeat ${pass}: ${error.stack}`); }
          results.push({ scenario: `warm ${scenario}`, pass,
            differences: differences(state(sheet), state(uncached)).slice(0, 8) });
        }
      }
      return results;
    }, fixture(2));
    assert.deepEqual(errors, []);
    for (const result of results) assert.deepEqual(result.differences, [], `${result.scenario}, pass ${result.pass}`);
    console.log(`PASS: ${results.length} warm/uncached alignment passes preserve pose, widths, lane details, attachment edits, split medians and independent roundabout mouths.`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
