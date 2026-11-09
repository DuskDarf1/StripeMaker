const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const G = require('../js/circular-arc.js');
const fixtures = ['arc-diverge-merge', 'arc-diverge-merge-updated'];
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  try {
    const page = await browser.newPage({viewport:{width:1600,height:1100}}), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(pathToFileURL(path.resolve(__dirname, '../index.html')).href);
    await page.waitForFunction(() => StripeMaker.sheets.ready);
    await page.locator('#blankSheet').evaluate(b => b.click());
    await page.waitForFunction(() => StripeMaker.sheets.selected);
    const snapshot = () => page.evaluate(() => {
      const A=StripeMaker,s=A.sheets.selected,solved=A.roadEditor.solve(s);
      return {
        fits: [...solved.arcFits].sort((a,b)=>a[0]-b[0]),
        hosts: s.roads.filter(r=>r.arcAngle==null), joints:s.joints,
        tracks: A.roadEditor.laneTracks(s).sort((a,b)=>a.road-b.road),
        corners: [...s.roadLayer.querySelectorAll('[data-corner]')].map(p=>({key:p.dataset.corner,d:p.getAttribute('d')})).sort((a,b)=>a.key.localeCompare(b.key)),
        goreEnds: [...s.roadLayer.querySelectorAll('.goreWhiteOutline path')].map(p=>{
          const q=p.getPointAtLength(p.getTotalLength());return {x:q.x,y:q.y};
        })
      };
    });
    for(const name of fixtures){
      const fixture=require(`./fixtures/${name}.json`);
      await page.evaluate(f=>{const A=StripeMaker,s=A.sheets.selected;Object.assign(s,structuredClone(f));A.roadEditor.render();A.history.rebase();},fixture);
      const before=await snapshot();
      assert.equal(before.fits.length,2,'only the split/rejoining arc pair is fitted');
      assert.deepEqual(before.hosts,fixture.roads.filter(r=>r.arcAngle==null),'host Bézier control data stays unchanged');
      assert.deepEqual(before.joints,fixture.joints,'fitting does not move or turn host joints');
      for(const [id,fit] of before.fits){
        const track=before.tracks.find(t=>t.road===id),points=track.line;
        const hostDirections=fit.hostCurves.map((c,e)=>G.laneCurve(c)(fit.mouthParameters[e]).tangent);
        [0,1].forEach(e=>{
          const p=points.at(e?-1:0),d=hostDirections[e];
          assert.ok(p.tangent.x*d.x+p.tangent.y*d.y>1-1e-10,'actual lane path is tangent to its meeting road');
          for(const edge of track.markingEdges){const q=edge.at(e?-1:0);assert.ok(Math.abs((q.x-p.x)*d.x+(q.y-p.y)*d.y)<1e-7,'mouth edges meet the same cross-section');}
        });
        const start=points.findIndex(p=>Math.hypot(p.x-fit.start.x,p.y-fit.start.y)<1e-7);
        const end=points.findIndex(p=>Math.hypot(p.x-fit.end.x,p.y-fit.end.y)<1e-7);
        assert.ok(end>start+30,'the entire circular bend is sampled');
        for(const p of points.slice(start,end+1))assert.ok(Math.abs(Math.hypot(p.x-fit.center.x,p.y-fit.center.y)-fit.radius)<1e-7,
          'the bend remains a true constant-radius circle, not an end-deformed curve');
        assert.ok(points.length>30);
      }
      const gaps=await page.evaluate(()=>{
        const A=StripeMaker,s=A.sheets.selected,net=A.roadEditor.simulatorNetwork(s);
        return net.connections.filter(c=>[8,9].includes(c.from.road)||[8,9].includes(c.to.road)).map(c=>{
          const p=net.lanes.find(l=>l.road===c.from.road&&l.lane===c.from.lane).points.at(-1),q=net.lanes.find(l=>l.road===c.to.road&&l.lane===c.to.lane).points[0];
          return Math.hypot(p.x-q.x,p.y-q.y);
        });
      });
      assert.ok(gaps.length>=4&&gaps.every(gap=>gap<1e-7),'lane connections actually meet at their set-back mouths');
      const outer=before.fits.find(([id])=>id===8)[1],inner=before.fits.find(([id])=>id===9)[1];
      assert.ok(inner.startOffset<outer.startOffset-1,'inner circular entry is set back along the approach');
      assert.ok(inner.endOffset>outer.endOffset+1,'inner circular exit is staggered along the departure');
      assert.equal(before.goreEnds.length,2);
      assert.ok(Math.hypot(before.goreEnds[0].x-before.goreEnds[1].x,before.goreEnds[0].y-before.goreEnds[1].y)<.03,
        'both white outlines reach the merge even when the painted length stops short');
      assert.equal(before.corners.filter(p=>/^2:.*:(8|9)$/.test(p.key)||/^(8|9):.*:10$/.test(p.key)).length,0,
        'tangent joins need no extra corner strokes');
      await page.evaluate(()=>{for(let i=0;i<5;i++)StripeMaker.roadEditor.render();});
      assert.deepEqual(await snapshot(),before,'repeated renders do not drift geometry or marks');
      await page.evaluate(()=>{StripeMaker.sheets.selected.roads.reverse();StripeMaker.roadEditor.render();});
      const reordered=await snapshot();
      assert.deepEqual(reordered.fits,before.fits);assert.deepEqual(reordered.tracks,before.tracks);
      assert.deepEqual(reordered.goreEnds,before.goreEnds);
      await page.evaluate(()=>{const A=StripeMaker,s=A.sheets.selected;A.roadEditor.focusRoad(s.roads.find(r=>r.id===9));A.history.rebase();});
      assert.equal(Number(await page.locator('#roadArcAngleValue').inputValue()),Number(inner.degrees.toFixed(2)),'angle control shows the fitted sweep');
      await page.locator('#roadArcRadius').fill('55');await page.locator('#roadArcRadius').blur();
      const resized=await snapshot(),resizedFit=resized.fits.find(([id])=>id===9)[1];
      assert.ok(Math.abs(resizedFit.radius*fixture.inchesPerPixel/12-55)<1e-7,'radius edits retain exact radius and tangent fitting');
      assert.deepEqual(resized.hosts,reordered.hosts);assert.deepEqual(resized.joints,before.joints);
      await page.locator('#undoButton').click();assert.deepEqual((await snapshot()).fits,before.fits);
      await page.locator('#redoButton').click();assert.deepEqual((await snapshot()).fits,resized.fits);
      assert.equal(await page.locator('#roadArcAngleValue').isDisabled(),true,'angle edits cannot silently disable fitting');
      await page.locator('#roadArcFit').uncheck();
      assert.equal((await snapshot()).fits.length,0,'the explicit switch releases both arcs together');
      assert.equal(await page.locator('#roadArcAngleValue').isDisabled(),false);
      await page.locator('#roadArcAngleValue').fill('-110');await page.locator('#roadArcAngleValue').blur();
      await page.locator('#undoButton').click();assert.equal((await snapshot()).fits.length,0);
      await page.locator('#undoButton').click();assert.deepEqual((await snapshot()).fits,resized.fits);
      await page.waitForTimeout(600);await page.reload();await page.waitForFunction(()=>StripeMaker.sheets.selected?.roads.length);
      assert.deepEqual((await snapshot()).fits,resized.fits,'fitted radius and joins survive persistence');
    }
    await page.evaluate(()=>{const s=StripeMaker.sheets.selected,svg=s.roadLayer.cloneNode(true);svg.id='arcPreview';svg.setAttribute('viewBox','415 368 80 75');svg.style.cssText='position:fixed;inset:0;width:1100px;height:1031px;z-index:9999;background:#3c4938;transform:none';svg.style.setProperty('--zoom',13.75);document.body.append(svg);});
    await page.locator('#arcPreview').screenshot({path:'/tmp/stripemaker-arc-join-option1.png'});
    assert.deepEqual(errors,[]);
    console.log('PASS: both supplied layouts have tangent, constant-radius, staggered joins; partial painted gores stay white to the merge; radius, undo, order and reload remain stable.');
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
