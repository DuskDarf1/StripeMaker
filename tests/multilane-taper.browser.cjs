const assert = require('node:assert/strict');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const P = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fixture = require('./fixtures/multilane-taper.json');
(async () => {
  const webkit = process.env.BROWSER === 'webkit';
  const executablePath = webkit ? process.env.WEBKIT_PATH : process.env.CHROME_PATH;
  const browser = await P[webkit ? 'webkit' : 'chromium'].launch({headless:true, ...(executablePath ? {executablePath} : {})});
  try {
    const page = await browser.newPage({viewport:{width:1800,height:900}}), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(process.env.STRIPEMAKER_URL || pathToFileURL(path.resolve(__dirname, '../index.html')).href);
    await page.waitForFunction(() => StripeMaker.sheets.ready);
    await page.locator('#blankSheet').evaluate(b => b.click());
    await page.waitForFunction(() => StripeMaker.sheets.selected);
    await page.evaluate(data => {
      const A = StripeMaker, s = A.sheets.selected;
      Object.assign(s, data);
      s.view = {scale:6,x:-20100,y:-4750,fitted:false};
      A.sheets.zoomBy(1);
      document.dispatchEvent(new Event('sheetchange'));
      A.roadEditor.focusRoad(s.roads[1]);
      A.history.rebase();
    }, fixture);
    const state = () => page.evaluate(() => {
      const A = StripeMaker, s = A.sheets.selected, t = A.roadEditor.laneTracks(s).find(t => t.road === 2);
      const stations = [0];
      for (let i = 1; i < t.line.length; i++) stations.push(stations.at(-1) + Math.hypot(t.line[i].x-t.line[i-1].x,t.line[i].y-t.line[i-1].y)*s.inchesPerPixel/12);
      return {tapers:s.roads[1].tapers, stations, widths:t.laneBounds.map(lanes => lanes.map(([a,b]) => (b-a)*s.inchesPerPixel/12))};
    });
    const checkGeometry = async (feet, end = 0) => {
      const actual = await state(), total = actual.stations.at(-1);
      for (const lane of [0,1]) {
        const indices = actual.stations.map((_,i) => i);
        if (end) indices.reverse();
        const full = indices.find(i => actual.widths[i][lane] >= 12-1e-7);
        const distance = end ? total-actual.stations[full] : actual.stations[full];
        assert(Math.abs(distance-Math.min(feet,total)) < 1e-6, `lane ${lane+1} becomes full width at ${distance} ft, expected ${feet}`);
        for (const i of indices) {
          const along = end ? total-actual.stations[i] : actual.stations[i];
          assert(Math.abs(actual.widths[i][lane]-12*Math.min(1,along/Math.min(feet,total))) < 1e-6, 'both lanes widen together');
        }
      }
      for (const widths of actual.widths) for (const lane of [2,3]) assert(Math.abs(widths[lane]-12) < 1e-6, 'through lanes retain full width');
    };
    const selectLane = async (lane,end=0) => {
      const node = page.locator(`.roadNode[data-road="2"][data-end="${end}"][data-lane="${lane}"]`);
      await node.focus();
      await node.press('Shift+F10');
      await page.keyboard.press('Escape');
      assert.deepEqual(await page.evaluate(() => StripeMaker.roadEditor.diagnostics().selectedLane), {e:end,lane});
    };
    await checkGeometry(50);
    for (const lane of [0,1]) {
      await selectLane(lane);
      await page.locator('#laneTaperLength').fill('100');
      await page.locator('#laneTaperLength').press('Tab');
      assert.deepEqual(Object.values((await state()).tapers).map(t => t.length), [100,100]);
      await checkGeometry(100);
      await page.locator('#undoButton').click();
      await checkGeometry(50);
      assert.deepEqual(Object.values((await state()).tapers).map(t => t.length), [50,50]);
      await page.locator('#redoButton').click();
      await checkGeometry(100);
      await page.locator('#undoButton').click();
    }
    // Also pin the opposite-end taper boundary and preserve one undoable edit.
    await page.evaluate(() => {
      const A=StripeMaker,s=A.sheets.selected;
      s.roads[1].tapers={'1:0':{mode:'taper',length:50},'1:1':{mode:'taper',length:50}};
      A.roadEditor.render();A.history.rebase();
    });
    await checkGeometry(50,1);
    await selectLane(0,1);
    await page.locator('#laneTaperLength').fill('80');
    await page.locator('#laneTaperLength').press('Tab');
    await checkGeometry(80,1);
    const exported=await page.evaluate(() => StripeMaker.projectJSON.snapshot());
    assert.deepEqual(exported.sheets[0].data.roads[1].tapers, {'1:0':{mode:'taper',length:80},'1:1':{mode:'taper',length:80}});
    assert.deepEqual(errors, []);
    console.log('PASS: saved multilane geometry, exact shared length, editing either lane, starts/ends, undo/redo and export.');
  } finally {await browser.close();}
})().catch(e => {console.error(e);process.exitCode=1;});
