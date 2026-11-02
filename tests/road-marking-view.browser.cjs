// Draw through the UI, then keep road nodes, painted geometry, and both marking
// editors aligned through pan/zoom. Run with the browser-suite environment vars.
const assert = require('node:assert/strict');
const {pathToFileURL} = require('node:url');
const path = require('node:path');
const playwright = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const browser = await playwright[process.env.BROWSER || 'chromium'].launch({headless:true,
    ...(process.env.CHROME_PATH ? {executablePath:process.env.CHROME_PATH} : {})});
  try {
    const page = await browser.newPage({viewport:{width:1500,height:1100}}), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(process.env.STRIPEMAKER_URL || pathToFileURL(path.resolve(__dirname,'../index.html')).href);
    await page.waitForFunction(() => StripeMaker.sheets.ready && StripeMaker.markings);
    const png = await page.evaluate(() => {
      const c = document.createElement('canvas'); c.width=1600; c.height=1200;
      return c.toDataURL().split(',')[1];
    });
    await page.locator('#sheetFile').setInputFiles({name:'View test.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
    await page.waitForFunction(() => StripeMaker.sheets.selected);
    await page.evaluate(() => {
      StripeMaker.sheets.selected.inchesPerPixel=2;
      document.dispatchEvent(new CustomEvent('sheetchange'));
    });
    await page.locator('[data-editor="elementsEditor"]').click();
    await page.locator('#roadLanes').fill('3'); await page.locator('#roadLanes').blur();
    await page.locator('#addRoad').click();
    await page.mouse.click(600,700); await page.mouse.click(1200,700);
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => StripeMaker.sheets.selected.roads.length),1);
    // Free road ends have no explicit Bézier direction. A bike lane must still
    // produce valid placement bounds, including at both zero-derivative ends.
    await page.locator('#addBikeLane').click();
    assert.equal(await page.evaluate(() => StripeMaker.sheets.selected.roads[0].lanes),4);

    const center = async locator => {
      const b = await locator.boundingBox(); assert.ok(b);
      return {x:b.x+b.width/2,y:b.y+b.height/2};
    };
    const settle = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    const node = page.getByRole('button',{name:'Road 1, lane 2 end',exact:true});
    const checkNode = async () => {
      const actual = await center(node);
      const expected = await page.evaluate(() => {
        const app=StripeMaker,s=app.sheets.selected,t=app.roadEditor.laneTracks(s)[0],i=t.line.length-1,p=t.line[i],a=t.line[i-1];
        const len=Math.hypot(p.x-a.x,p.y-a.y),u={x:(p.x-a.x)/len,y:(p.y-a.y)/len},d=(t.bounds[i][1]+t.bounds[i][2])/2;
        // Transform the lane end with the painted SVG's actual screen matrix.
        const q=new DOMPoint(p.x-u.y*d,p.y+u.x*d).matrixTransform(s.roadLayer.getScreenCTM());
        return {x:q.x-u.x*13,y:q.y-u.y*13};
      });
      assert.ok(Math.hypot(actual.x-expected.x,actual.y-expected.y)<0.2,JSON.stringify({actual,expected}));
    };
    await checkNode();
    await page.evaluate(() => StripeMaker.sheets.zoomBy(1.3)); await settle(); await checkNode();
    await page.mouse.move(1000,900); await page.mouse.down();
    await page.mouse.move(960,920,{steps:4}); await page.mouse.up(); await settle(); await checkNode();
    const before=await center(node), oldEnd=await page.evaluate(() => structuredClone(StripeMaker.sheets.selected.joints[1]));
    await page.mouse.move(before.x,before.y); await page.mouse.down();
    await page.mouse.move(before.x-100,before.y-80,{steps:10}); await page.mouse.up(); await settle();
    assert.notDeepEqual(await page.evaluate(() => StripeMaker.sheets.selected.joints[1]),oldEnd);
    await checkNode();

    const roadPoint = (lane, fraction, boundary=false) => page.evaluate(({lane,fraction,boundary}) => {
      const s=StripeMaker.sheets.selected,t=StripeMaker.roadEditor.laneTracks(s)[0],i=Math.round((t.line.length-1)*fraction),p=t.line[i];
      const d=boundary?t.bounds[i][lane]:(t.bounds[i][lane]+t.bounds[i][lane+1])/2;
      const q=new DOMPoint(p.x-p.tangent.y*d,p.y+p.tangent.x*d).matrixTransform(s.roadLayer.getScreenCTM());
      return {x:q.x,y:q.y};
    },{lane,fraction,boundary});
    await page.locator('[data-editor="markingsEditor"]').click();
    assert.equal(await page.locator('.roadOverlay').isVisible(),false,'road handles hide when switching editors');
    let at=await roadPoint(1,0.5);
    await page.mouse.move(at.x,at.y); await page.mouse.click(at.x,at.y);
    assert.equal(await page.evaluate(() => StripeMaker.sheets.selected.markings.length),1);
    assert.deepEqual(await page.evaluate(() => StripeMaker.sheets.selected.markings[0].on),{road:1,lane:1});
    const checkMarking = async () => {
      const painted=await page.locator('.roadLayer .laneMarkings path').first().boundingBox();
      const outline=await page.locator('.markingPreview .markingSelected').first().boundingBox();
      assert.ok(painted && outline);
      const p={x:painted.x+painted.width/2,y:painted.y+painted.height/2},o={x:outline.x+outline.width/2,y:outline.y+outline.height/2};
      // The arrow's asymmetric tip need not fill its selection rectangle.
      assert.ok(Math.hypot(p.x-o.x,p.y-o.y)<1,JSON.stringify({p,o}));
    };
    await checkMarking();
    await page.evaluate(() => StripeMaker.sheets.zoomBy(0.8)); await settle(); await checkMarking();
    // Existing markings can be selected again after zooming.
    await page.locator('.markingHandle').focus(); await page.keyboard.press('Escape');
    at=await roadPoint(1,0.5); await page.mouse.click(at.x,at.y);
    assert.equal(await page.evaluate(() => StripeMaker.sheets.selected.markings.length),1);
    assert.equal(await page.locator('.markingHandle').count(),1);

    await page.locator('#markingsLongitudinalTab').click();
    at=await roadPoint(1,0.5,true); await page.mouse.move(at.x,at.y); await page.mouse.click(at.x,at.y);
    assert.equal(await page.evaluate(() => StripeMaker.sheets.selected.lines.length),1);
    assert.deepEqual(await page.evaluate(() => StripeMaker.sheets.selected.lines[0].on),{road:1,k:1});
    await page.evaluate(() => StripeMaker.sheets.zoomBy(1.1)); await settle();
    const line=page.locator('.lineOverlay .lineSelected');
    assert.ok(await line.isVisible());
    await page.locator('.lineOverlay button[data-end="to"]').focus(); await page.keyboard.press('Escape');
    at=await roadPoint(1,0.5,true); await page.mouse.click(at.x,at.y);
    assert.equal(await page.evaluate(() => StripeMaker.sheets.selected.lines.length),1);
    assert.equal(await page.locator('.lineOverlay button[data-end]').count(),2);
    assert.deepEqual(errors,[]);
    console.log('Road drawing/dragging, pan/zoom alignment, editor switching, and lateral/longitudinal placement and selection passed.');
  } finally { await browser.close(); }
})().catch(e => {console.error(e);process.exit(1);});
