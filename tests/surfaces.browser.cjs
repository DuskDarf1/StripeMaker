/* Same isolated Chromium setup as intersections.browser.cjs:
   PLAYWRIGHT_MODULE=/path/to/playwright node tests/markings.browser.cjs
   (STRIPEMAKER_URL optional; defaults to opening index.html directly). */
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  try {
    const context = await browser.newContext({ viewport: { width: 1400, height: 1000 }, acceptDownloads: true });
    const page = await context.newPage(), errors = [];
    page.setDefaultTimeout(10000);
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(process.env.STRIPEMAKER_URL || pathToFileURL(path.resolve(__dirname, '../index.html')).href);
    const png = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 1600; c.height = 1200; const g = c.getContext('2d'); g.fillStyle = '#777'; g.fillRect(0, 0, 1600, 1200); return c.toDataURL().split(',')[1]; });
    await page.locator('#sheetFile').setInputFiles({ name: 'Markings test.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
    await page.waitForFunction(() => StripeMaker.sheets.selected);
    await page.evaluate(()=>{
      const s=StripeMaker.sheets.selected;s.inchesPerPixel=2;
      s.roads=[1,2,3].map(id=>({id,lanes:3,laneWidth:12,laneTypes:{1:{type:'bufferedBike',width:7}},tapers:{'0:2':{mode:'taper',length:50}},ends:[{joint:id,sign:1,length:null},{joint:id+1,sign:1,length:null}]}));
      s.joints=[1,2,3,4].map(id=>({id,x:400+(id-1)*300,y:650,dir:{x:1,y:0},root:Math.min(id,3),links:id>1&&id<4?[0,1,2].map(lane=>({a:id-1,ai:lane,b:id,bi:lane,feed:true})):[]}));
      StripeMaker.roadEditor.render();StripeMaker.history.rebase();
      StripeMaker.showEditor('markingsEditor');StripeMaker.markings.showTab('lateral');
    });
    await page.click('#chooseMarking');await page.fill('#markingSearch','Green bike lane, dotted');await page.locator('#markingGrid button').first().click();
    const clickAt=async x=>{
      const p=await page.evaluate(x=>{const s=StripeMaker.sheets.selected,b=document.getElementById('previewStage').getBoundingClientRect();return {x:b.left+s.view.x+x*s.view.scale,y:b.top+s.view.y+650*s.view.scale};},x);
      await page.mouse.click(p.x,p.y);
    };
    await clickAt(550);await clickAt(1200);
    const surfaces=()=>page.evaluate(()=>StripeMaker.sheets.selected.surfaces??[]);
    const records=await surfaces();assert.equal(records.length,3);assert.equal(new Set(records.map(s=>s.span)).size,1);
    assert.deepEqual(records.map(s=>s.on.road),[1,2,3]);
    // Every full green block shares its longitudinal extent with white conflict dots.
    const aligned=await page.evaluate(()=>{
      const root=StripeMaker.sheets.selected.roadLayer;
      const extent=p=>{const nums=p.getAttribute('d').match(/-?[\d.]+/g).map(Number), xs=nums.filter((_,i)=>i%2===0);return [Math.min(...xs),Math.max(...xs)];};
      const greens=[...root.querySelectorAll('.laneSurface')].map(extent).filter(([a,b])=>a>705&&b<995&&Math.abs(b-a-12)<.1);
      const whites=[...root.querySelectorAll('.roadMarking')].map(extent);
      return {count:greens.length,match:greens.every(([a,b])=>whites.some(([c,d])=>Math.abs(a-c)<.1&&Math.abs(b-d)<.1))};
    });
    assert(aligned.count>5);assert(aligned.match);
    await page.click('#undoButton');assert.equal((await surfaces()).length,0);
    await page.click('#redoButton');assert.equal((await surfaces()).length,3);
    await page.screenshot({path:'/tmp/stripemaker-surface-chain.png'});
    // Let the debounced redo save supersede any in-flight undo save.
    await page.waitForTimeout(600);
    await page.waitForFunction(()=>new Promise(resolve=>{
      const request=indexedDB.open('StripeMaker');request.onsuccess=()=>{
        const db=request.result,id=StripeMaker.sheets.selected.id;
        const tx=db.transaction(['sheets','files','meta']);
        const record=tx.objectStore('sheets').get(id),file=tx.objectStore('files').get(id),meta=tx.objectStore('meta').get('app');
        tx.oncomplete=()=>{resolve(record.result?.surfaces?.length===3 && Boolean(file.result) && meta.result?.order?.includes(id));db.close();};
      };
    }));
    await page.reload();await page.waitForFunction(()=>StripeMaker.sheets.selected?.surfaces?.length===3);
    assert.equal(new Set((await surfaces()).map(s=>s.span)).size,1);
    assert.deepEqual(errors,[]);console.log('PASS: multi-node colored pavement, shared white/green phase, undo/redo.');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
