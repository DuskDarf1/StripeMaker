// Exact component/full-sheet geometry equivalence on an isolated dense sheet.
// Uses real editor modules; no existing browser profile or project is touched.
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
    await page.evaluate(data => {
      const A = StripeMaker, sheet = A.sheets.selected;
      Object.assign(sheet, data);
      A.roadEditor.render();
      A.history.rebase();
      window.componentFixture = structuredClone(data);
    }, fixture(4));

    let checked = 0;
    const compare = async stage => {
      const {pairs,sameTracks} = await page.evaluate(() => {
        const A = StripeMaker, sheet = A.sheets.selected, solved = A.roadEditor.solve(sheet);
        const pairs=sheet.roads.flatMap(road => [0, 1].map(e => {
          const binding = { road: road.id, e };
          return { binding,
            component: A.roadEditor.intersectionEnd(sheet, binding),
            full: A.roadEditor.intersectionEnd(sheet, binding, solved) };
        }));
        const fresh={...sheet,roads:structuredClone(sheet.roads),joints:structuredClone(sheet.joints),intersections:structuredClone(sheet.intersections)};
        const sameTracks=JSON.stringify(A.roadEditor.laneTracks(sheet))===JSON.stringify(A.roadEditor.laneTracks(fresh));
        return {pairs,sameTracks};
      });
      assert(sameTracks,`${stage}: retained road shapes match freshly sampled lane geometry`);
      for (const { binding, component, full } of pairs) {
        assert.deepEqual(component, full, `${stage}: road ${binding.road}, end ${binding.e}`);
        checked++;
      }
    };
    await compare('normalized dense sheet');
    await page.evaluate(() => {
      const sheet = StripeMaker.sheets.selected, road = sheet.roads[0];
      road.perLaneWidths = true;
      road.laneWidths = { 0: 9, 1: 15 };
      road.laneEndWidths = { '0:0': 10.25, '1:0': 13.75 };
      road.ends[0].dir = { x: .8, y: .6 };
      road.ends[1].length = 137;
      sheet.roads[1].laneTypes = { 1: { type: 'bufferedBike', width: 7 } };
      sheet.joints[2].x += 27;
      sheet.joints[2].y -= 31;
    });
    await compare('widths, independent curve, bike lane and moved joint');
    await page.evaluate(() => {
      const sheet = StripeMaker.sheets.selected;
      for (const item of [sheet.intersections[0], sheet.intersections[1]]) {
        const a = item.approaches[0];
        a.width = 14;
        a.outWidth = 10;
        a.laneDetails = { [a.inLanes[0]]: { width: 8.5 }, [a.outLanes[1]]: { width: 16 } };
        a.splits = [{ id: `component-${item.id}`, incoming: true, after: 1, width: 4, surface: 'concrete' }];
      }
      const bound = sheet.intersections[0].approaches[1];
      bound.binding = { road: bound.links[0].road, e: bound.links[0].e };
      delete bound.links;
    });
    await compare('mouth dimensions, lane details, split gaps and binding replacement');
    await page.evaluate(() => {
      const sheet = StripeMaker.sheets.selected, first = sheet.roads[0], last = sheet.roads.at(-1);
      const target = sheet.joints.find(j => j.id === first.ends[1].joint);
      // Join previously separate solver components without changing array sizes.
      last.ends[0].joint = target.id;
      target.links.push({ a: first.id, ai: 1, b: last.id, bi: 0, feed: true });
      sheet.autoTapers = true;
    });
    await compare('component merge, feed link and automatic tapers');
    await page.evaluate(() => {
      const sheet = StripeMaker.sheets.selected;
      sheet.roads.reverse(); sheet.joints.reverse(); sheet.intersections.reverse();
      for (const joint of sheet.joints) joint.links.reverse();
      for (const item of sheet.intersections) for (const a of item.approaches) a.links?.reverse();
    });
    await compare('reordered road, joint and attachment iteration');
    await page.evaluate(() => {
      const sheet = StripeMaker.sheets.selected;
      // Replace objects in existing arrays, as well as entire arrays: both are
      // common during restoration/import and must discard component references.
      sheet.roads[0] = structuredClone(sheet.roads[0]); sheet.roads[0].laneWidth += 1;
      sheet.joints[0] = structuredClone(sheet.joints[0]); sheet.joints[0].x += 15;
      sheet.intersections = structuredClone(sheet.intersections);
    });
    await compare('object replacement inside stable arrays');
    await page.evaluate(() => {
      const sheet = StripeMaker.sheets.selected;
      sheet.roads = structuredClone(sheet.roads);
      sheet.joints = structuredClone(sheet.joints);
      sheet.inchesPerPixel = 5.25;
    });
    await compare('array replacement and scale change');
    await page.evaluate(() => {
      const A = StripeMaker, sheet = A.sheets.selected;
      Object.assign(sheet, structuredClone(window.componentFixture));
      A.roadEditor.render(); A.history.rebase();
      sheet.joints[0].x += 17;
      sheet.roads[0].perLaneWidths = true;
      sheet.roads[0].laneEndWidths = { '0:0': 9 };
      A.roadEditor.render(); A.history.record();
    });
    await compare('recorded geometry edit');
    await page.evaluate(() => StripeMaker.history.undo());
    await compare('undo replacement');
    await page.evaluate(() => StripeMaker.history.redo());
    await compare('redo replacement');
    assert.deepEqual(errors, []);
    console.log(`PASS: ${checked} component/full-sheet endpoint comparisons across dense geometry, widths, mouths, topology, order, object replacement, scale and undo/redo.`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
