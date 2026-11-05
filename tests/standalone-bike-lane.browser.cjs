const assert = require('node:assert/strict');
const selectChoice=require('./select-choice.cjs');
const addElement=require('./add-element.cjs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } }), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(process.env.STRIPEMAKER_URL || 'http://127.0.0.1:8876');
    await page.waitForFunction(() => StripeMaker.sheets.ready);
    await page.locator('#blankSheet').evaluate(b => b.click());
    await page.waitForFunction(() => StripeMaker.sheets.selected?.inchesPerPixel);
    await page.locator('[data-editor="elementsEditor"]').click();
    await page.locator('#roadOpposite').fill('2'); await page.locator('#roadOpposite').press('Tab');
    await addElement(page,'bike');
    assert.equal(await page.locator('#addStandaloneBikeLane').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('#addRoad').getAttribute('aria-pressed'), 'false');
    assert.equal(await page.locator('#roadOpposite').inputValue(), '0');
    await page.mouse.click(700, 400); await page.mouse.click(900, 400); await page.mouse.click(1100, 430); await page.keyboard.press('Escape');
    const read = () => page.evaluate(() => structuredClone(StripeMaker.sheets.selected.roads));
    const roads = await read();
    assert.equal(roads.length, 2, 'click chains create one bike lane per segment, with no opposite vehicle road');
    for (const road of roads) {
      assert.equal(road.lanes, 1);
      assert.equal(road.laneTypes[0].type, 'bike');
      assert.equal(road.laneTypes[0].width, 5);
    }
    const edges = await page.locator('.roadLayer path.roadMarking').evaluateAll(paths => paths.map(p => ({ color: p.getAttribute('stroke'), dash: p.getAttribute('stroke-dasharray') })));
    assert.equal(edges.filter(p => p.color === '#ffffff' && !p.dash).length, 0, 'independent outer edges stay unmarked outside conflicts');
    assert.equal(edges.filter(p => p.color === '#ffc72c').length, 0);
    await page.screenshot({path:'/tmp/standalone-bike-lane.png'});
    const trackEdges = await page.evaluate(() => {
      const A=StripeMaker,s=A.sheets.selected,r=s.roads[0],before=structuredClone(r.laneTypes);
      r.laneTypes[0]={type:'twoWayBike',width:12}; A.roadEditor.render();
      const count=s.roadLayer.querySelectorAll('.roadMarking[stroke="#ffc72c"][stroke-dasharray]').length;
      r.laneTypes=before; A.roadEditor.render();return count;
    });
    assert(trackEdges>0,'two-way bike facilities retain their yellow broken centerline');
    await page.locator('#undoButton').click(); assert.equal((await read()).length, 1);
    await page.locator('#redoButton').click(); assert.deepEqual(await read(), roads);
    await addElement(page,'road');
    assert.equal(await page.locator('#roadOpposite').inputValue(), '2', 'standalone drawing leaves ordinary road defaults intact');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(800); await page.reload();
    await page.waitForFunction(() => StripeMaker.sheets.selected?.roads?.length === 2);
    assert.deepEqual(await read(), roads);
    await page.evaluate(()=>{const A=StripeMaker;A.roadEditor.focusRoad(A.sheets.selected.roads[0]);});
    await selectChoice(page.locator('#standaloneBikeType'),'twoWayBike');
    assert.equal((await read())[0].laneTypes[0].type,'twoWayBike','selector converts an existing standalone lane');
    assert.equal((await read())[0].laneTypes[0].width,12);
    await page.locator('#undoButton').click();assert.deepEqual(await read(),roads);
    await page.locator('#redoButton').click();
    await addElement(page,'track');
    await page.mouse.click(700,600);await page.mouse.click(1000,600);await page.keyboard.press('Escape');
    const twoWay=await read();assert.equal(twoWay.length,3);
    assert.equal(twoWay[2].laneTypes[0].type,'twoWayBike','new standalone tracks use the selected type');
    assert.equal(twoWay[2].laneTypes[0].width,12);
    assert(await page.locator('.roadMarking[stroke="#ffc72c"][stroke-dasharray]').count()>0,'two-way tracks draw their yellow broken centerline');
    await page.waitForTimeout(800);await page.reload();await page.waitForFunction(()=>StripeMaker.sheets.selected?.roads?.length===3);
    assert.deepEqual(await read(),twoWay,'two-way tracks persist');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('[data-editor="elementsEditor"]').click();
    const button = page.locator('#addElement'); await button.focus();
    const box = await button.boundingBox(); assert(box.x >= 0 && box.x + box.width <= 390);
    assert.deepEqual(errors, []);
    console.log('PASS: standalone bike button, chained drawing, unmarked outer edges, ordinary defaults, undo/redo, reload and narrow layout.');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
