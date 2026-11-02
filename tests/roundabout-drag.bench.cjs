// Run with a local server and the same PLAYWRIGHT_MODULE / CHROME_PATH settings
// as the browser suites. No CPU profiler: report real input-to-release latency.
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fixture = require('./fixtures/roundabout-sarasota.json');
(async () => {
  const browser = await chromium.launch({headless:true, ...(process.env.CHROME_PATH ? {executablePath:process.env.CHROME_PATH} : {})});
  const results = [];
  try {
    for (let run = 0; run < Number(process.env.ROUNDABOUT_BENCH_RUNS || 5); run++) {
      const context = await browser.newContext({viewport:{width:1500,height:1100}});
      const page = await context.newPage(), errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(process.env.STRIPEMAKER_URL || 'http://127.0.0.1:8876');
      await page.waitForFunction(() => StripeMaker.sheets.ready && StripeMaker.intersections);
      await page.locator('#blankSheet').evaluate(b => b.click());
      await page.getByRole('button',{name:'Intersections',exact:true}).click();
      await page.locator('#newRoundabout').click();
      await page.evaluate(f => {
        const app=StripeMaker,s=app.sheets.selected,x=s.intersections[0],p={id:x.id,x:x.x,y:x.y};
        Object.assign(x,f,p);app.roadEditor.render();document.dispatchEvent(new CustomEvent('sheetchange'));
      }, fixture);
      await page.getByRole('button',{name:'Select approach 3',exact:true}).focus();
      await page.keyboard.press('Enter');
      const center = await page.evaluate(() => {
        const b=document.getElementById('previewStage').getBoundingClientRect(),p=StripeMaker.sheets.toScreen(StripeMaker.sheets.selected.intersections[0]);
        return {x:b.left+p.x,y:b.top+p.y};
      });
      await page.mouse.move(center.x,center.y);
      for(let i=0;i<3;i++){await page.mouse.wheel(0,-300);await page.waitForTimeout(70);}
      await page.waitForTimeout(200);
      await page.evaluate(() => {
        window.dragTiming={render:[],validate:[]};
        window.startingCurve=JSON.stringify(StripeMaker.sheets.selected.intersections[0].approaches[2].bezierSides.entry);
        for(const [object,key] of [[StripeMaker.roadEditor,'render'],[StripeMaker.roundaboutGeometry,'validate']]) {
          const original=object[key];object[key]=function(...args){const start=performance.now();try{return original.apply(this,args);}finally{dragTiming[key].push(performance.now()-start);}};
        }
      });
      const h=await page.getByRole('button',{name:'Approach 3 entry circle Bézier handle',exact:true}).boundingBox();
      const p={x:h.x+h.width/2,y:h.y+h.height/2};
      await page.mouse.move(p.x,p.y);await page.mouse.down();
      const start=performance.now();
      for(let i=1;i<=12;i++)await page.mouse.move(p.x-i/2,p.y);
      await page.mouse.up();
      const elapsed=performance.now()-start;
      const detail=await page.evaluate(() => ({...dragTiming,
        moved:startingCurve!==JSON.stringify(StripeMaker.sheets.selected.intersections[0].approaches[2].bezierSides.entry)}));
      assert.ok(detail.moved,'the drag must change the curve');assert.equal(detail.validate.length,12);
      assert.ok(detail.render.length>=12,'every move renders full detail');assert.deepEqual(errors,[]);
      results.push({elapsed:Math.round(elapsed),renderMs:Math.round(detail.render.reduce((a,b)=>a+b,0)),validationMs:Math.round(detail.validate.reduce((a,b)=>a+b,0))});
      await context.close();
    }
    const times=results.map(r=>r.elapsed).sort((a,b)=>a-b),median=times[Math.floor(times.length/2)];
    console.log(JSON.stringify({moves:12,targetMs:250,medianMs:median,minMs:times[0],maxMs:times.at(-1),runs:results},null,2));
    if(process.env.ROUNDABOUT_DRAG_BUDGET_MS)assert.ok(median<=Number(process.env.ROUNDABOUT_DRAG_BUDGET_MS),`Median ${median} ms exceeds the drag budget`);
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
