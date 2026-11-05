// Every pointer event edits geometry; only its expensive redraw is coalesced.
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } }), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(process.env.STRIPEMAKER_URL || 'http://127.0.0.1:8876');
    await page.waitForFunction(() => StripeMaker.sheets.ready && StripeMaker.roadEditor && StripeMaker.history);
    await page.locator('#blankSheet').evaluate(b => b.click());
    await page.waitForFunction(() => StripeMaker.sheets.selected);
    await page.evaluate(() => {
      const A = StripeMaker, s = A.sheets.selected;
      s.roads = [{ id: 1, lanes: 2, laneWidth: 12, ends: [{ joint: 1, sign: 1 }, { joint: 2, sign: 1 }] }];
      s.joints = [{ id: 1, x: 100, y: 100, links: [] }, { id: 2, x: 1000, y: 100, links: [] }];
      s.medians = [{ id: 1, type: 'grass', points: [{ x: 500, y: 1200 }, { x: 1500, y: 1200 }, { x: 1000, y: 2500 }] }];
      s.view = { scale: .5, x: 650, y: -100 };
      A.sheets.zoomBy(1); A.roadEditor.focusMedian(1); A.roadEditor.render(); A.history.rebase();
    });
    for (const endType of ['pointerup', 'pointercancel']) {
      const handle = page.getByRole('button', { name: /^Median point 1 of / });
      const box = await handle.boundingBox(), x = box.x + box.width / 2, y = box.y + box.height / 2;
      await handle.evaluate(b => b.addEventListener('pointerdown', e => window.testPointer = e.pointerId, { once: true }));
      await page.mouse.move(x, y); await page.mouse.down();
      const result = await handle.evaluate((button, { x, y, endType }) => {
        const A = StripeMaker, s = A.sheets.selected, point = s.medians[0].points[0], before = { ...point };
        const raf = window.requestAnimationFrame, cancel = window.cancelAnimationFrame, draw = A.intersections.draw;
        const originalBand = s.roadLayer.querySelector('.roadBand');
        let next = 1000000, renders = 0;
        const pending = new Map(), positions = [];
        window.requestAnimationFrame = callback => { const id = next++; pending.set(id, callback); return id; };
        window.cancelAnimationFrame = id => { if (!pending.delete(id)) cancel.call(window, id); };
        A.intersections.draw = function (...args) { renders++; return draw.apply(this, args); };
        const move = dx => {
          button.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: testPointer, buttons: 1, isPrimary: true, clientX: x + dx, clientY: y }));
          positions.push({ x: point.x, y: point.y });
        };
        try {
          move(10); move(20); move(30);
          const queued = { count: pending.size, renders };
          for (const [id, callback] of [...pending]) { pending.delete(id); callback(performance.now()); }
          const flushed = { count: pending.size, renders };
          const retainedRoad = originalBand === s.roadLayer.querySelector('.roadBand');
          move(40);
          s.roads[0].laneWidth++;
          for (const [id, callback] of [...pending]) { pending.delete(id); callback(performance.now()); }
          const rebuiltRoad = originalBand !== s.roadLayer.querySelector('.roadBand');
          move(50);
          button.dispatchEvent(new PointerEvent(endType, { bubbles: true, pointerId: testPointer, buttons: 0, isPrimary: true, clientX: x + 50, clientY: y }));
          const finished = { renders, point: { ...point } };
          // Selection feedback also schedules a frame on pointerup. It must
          // not cause the already-flushed scene to draw again.
          for (const [id, callback] of [...pending]) { pending.delete(id); callback(performance.now()); }
          return { before, positions, queued, flushed, retainedRoad, rebuiltRoad, finished, lateRenders: renders, remaining: pending.size };
        } finally {
          window.requestAnimationFrame = raf; window.cancelAnimationFrame = cancel; A.intersections.draw = draw;
        }
      }, { x, y, endType });
      await page.mouse.up();
      assert.deepEqual(result.queued, { count: 1, renders: 0 });
      assert.deepEqual(result.flushed, { count: 0, renders: 1 });
      assert.equal(result.remaining, 0);
      assert.equal(result.lateRenders, result.finished.renders, 'release/cancel cancels the redundant drawing frame');
      assert(result.retainedRoad, 'unchanged road SVG is retained during median editing');
      assert(result.rebuiltRoad, 'a width change before the frame invalidates retained road SVG');
      assert.equal(result.finished.renders, 3, 'release/cancel flushes the final full drawing');
      result.positions.forEach((p, i) => assert.deepEqual(p, { x: result.before.x + (i + 1) * 20, y: result.before.y }));
      const undo = await page.evaluate(() => { StripeMaker.history.undo(); return StripeMaker.sheets.selected.medians[0].points[0]; });
      assert.deepEqual(undo, result.before, 'one undo step restores the entire gesture');
      const redo = await page.evaluate(() => { StripeMaker.history.redo(); return StripeMaker.sheets.selected.medians[0].points[0]; });
      assert.deepEqual(redo, result.finished.point);
    }
    assert.deepEqual(errors, []);
    console.log('PASS: median pointer bursts preserve every edit, draw once per frame, flush release/cancel and undo/redo as one gesture.');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
