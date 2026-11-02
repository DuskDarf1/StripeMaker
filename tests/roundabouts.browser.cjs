const selectChoice = require("./select-choice.cjs");
/* Roundabouts in the browser. Run against a local server in an isolated profile:
   PLAYWRIGHT_MODULE=/path/to/playwright CHROME_PATH=/path/to/chrome \
   STRIPEMAKER_URL=http://127.0.0.1:8876 node tests/roundabouts.browser.cjs
   SHOTS=/some/dir also saves screenshots. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  try {
    const context = await browser.newContext({ viewport: { width: 1400, height: 1000 }, acceptDownloads: true });
    const page = await context.newPage(), errors = [];
    page.on("pageerror", (e) => { errors.push(e.message); console.error("Browser error:", e.stack); });
    page.setDefaultTimeout(8000);
    const shot = async (name) => process.env.SHOTS && page.screenshot({ path: `${process.env.SHOTS}/${name}.png` });
    await page.goto(process.env.STRIPEMAKER_URL || "http://127.0.0.1:8876");
    await page.waitForFunction(() => globalThis.StripeMaker?.sheets && StripeMaker.roadEditor && StripeMaker.intersections);
    await page.locator("#blankSheet").evaluate((b) => b.click());
    await page.waitForFunction(() => StripeMaker.sheets.selected?.inchesPerPixel);
    const state = () => page.evaluate(() => structuredClone(StripeMaker.sheets.selected.intersections ?? []));
    const panel = page.locator("#intersectionEditor");
    async function fill(label, value) {
      await panel.getByLabel(label, { exact: true }).fill(String(value));
      await panel.getByLabel(label, { exact: true }).press("Tab");
    }
    const screenOf = (p) => page.evaluate((p) => {
      const at = StripeMaker.sheets.toScreen(p), r = document.getElementById("previewStage").getBoundingClientRect();
      return { x: at.x + r.left, y: at.y + r.top };
    }, p);

    // New Roundabout: a single-lane, four-leg roundabout, edited on the sheet.
    await page.getByRole("button", { name: "Intersections", exact: true }).click();
    await page.locator("#newRoundabout").click();
    let item = (await state())[0];
    assert.equal(item.kind, "roundabout");
    assert.equal(item.approaches.length, 4);
    assert.ok(await panel.isVisible(), "the panel opens");
    assert.equal(await panel.getByLabel("Inscribed diameter (ft)", { exact: true }).inputValue(), "140", "single-lane starting diameter");
    assert.equal(item.movements.length, 0, "roundabouts keep lane destinations, not movements");
    // Zoom in on it.
    const center = await screenOf(item);
    await page.mouse.move(center.x, center.y);
    for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, -300); await page.waitForTimeout(50); }
    await page.waitForTimeout(300);
    // Painted in the road layer: the red truck apron and dashed markings.
    const layer = await page.evaluate(() => {
      const paths = [...document.querySelectorAll(".roadLayer path")];
      return {
        apron: paths.filter((p) => p.getAttribute("fill") === StripeMaker.roundaboutGeometry.APRON.color).length,
        dashed: paths.filter((p) => p.getAttribute("stroke-dasharray")).length,
        symbols: paths.filter((p) => p.getAttribute("fill-rule")).length,
      };
    });
    assert.ok(layer.apron >= 1, "truck apron painted");
    assert.ok(layer.dashed >= 4, "a dotted extension at each entry");
    assert.ok(layer.symbols >= 4, "YIELD in each entry lane");
    assert.equal(await page.locator('[data-key^="add-gore-"]').count(), 0, "single-lane entries have no boundary to split");
    await shot("rb-1x1");
    // Each approach direction is a lane track for lateral markings, following the splitter's curve.
    const tracks = await page.evaluate(() => StripeMaker.intersections.laneTracks(StripeMaker.sheets.selected).map((t) => t.line.length));
    assert.equal(tracks.length, 9, "an entry and an exit track per approach, and the circulatory roadway");
    assert.ok(tracks.every((n) => n > 10), "tracks follow the curve");
    // Custom markings can go in the circle: the circulatory roadway is a lane.
    const inCircle = await page.evaluate(() => {
      const s = StripeMaker.sheets.selected, it = s.intersections[0], G = StripeMaker.intersectionGeometry, R = StripeMaker.roundaboutGeometry;
      const L = R.layout(it), r = L.outer.radius(Math.PI / 2) - L.total / 2;
      return StripeMaker.markings.anchorAt(G.add(it, G.mul({ x: 0, y: r }, 12 / s.inchesPerPixel)))?.on;
    });
    assert.equal(inCircle?.approach, "circulatory", "a marking anchors in the circulating lane");

    // The + at a mouth adds an entry lane; undo and redo restore it.
    const id0 = item.approaches[0].id;
    await page.locator(`[data-key="add-lane-${id0}-true"]`).click();
    assert.equal((await state())[0].approaches[0].incoming, 2, "+ adds an entry lane");
    await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
    assert.equal((await state())[0].approaches[0].incoming, 1, "undo removes it");
    await page.keyboard.press(process.platform === "darwin" ? "Meta+Shift+z" : "Control+Shift+z");
    assert.equal((await state())[0].approaches[0].incoming, 2, "redo restores it");

    // Two lanes on every leg: the circle adapts without moving the road
    // connections outward during a lane edit.
    const mouths = (await state())[0].approaches.map(({ x, y }) => ({ x, y }));
    for (const a of (await state())[0].approaches) {
      await selectChoice(panel.locator("#intersection-approach"), a.id);
      await fill("Entry lanes", 2);
      await fill("Exit lanes", 2);
    }
    item = (await state())[0];
    assert.equal(await page.evaluate(() => StripeMaker.roundaboutGeometry.laneCount(StripeMaker.sheets.selected.intersections[0])), 2);
    assert.equal(await panel.getByLabel("Inscribed diameter (ft)", { exact: true }).inputValue(), "180", "two-lane starting diameter");
    const outside = await page.evaluate(() => {
      const it = StripeMaker.sheets.selected.intersections[0], L = StripeMaker.roundaboutGeometry.layout(it);
      return Math.min(...it.approaches.map((a) => L.legs.get(a.id).S0));
    });
    assert.deepEqual(item.approaches.map(({ x, y }) => ({ x, y })), mouths, "lane edits retain road connection positions");
    assert.ok(outside >= 15 && outside < 70, "short openings retain usable stems as the circle grows");
    await shot("rb-2x2");
    const goreLane = item.approaches[0].inLanes[1];
    const gorePlus = page.locator(`[data-key="add-gore-${id0}-${goreLane}"]`);
    await gorePlus.focus();
    await page.keyboard.press("Enter");
    assert.equal((await state())[0].approaches[0].incoming, 2, "gore does not add an entry lane");
    assert.equal((await state())[0].approaches[0].entryGores[goreLane], 6);
    assert.equal(await gorePlus.count(), 0, "a marked boundary no longer offers another gore");
    await shot("rb-entry-gore");
    if (process.env.SHOTS) {
      await page.evaluate(() => {
        const s = StripeMaker.sheets.selected, it = s.intersections[0], svg = s.roadLayer.cloneNode(true);
        svg.id = "roundaboutGorePreview";
        svg.setAttribute("viewBox", `${it.x - 1050} ${it.y - 1050} 2100 2100`);
        svg.style.cssText = "position:fixed;right:0;top:0;width:950px;height:950px;z-index:9999;transform:none;background:white";
        document.body.append(svg);
      });
      await page.locator("#roundaboutGorePreview").screenshot({ path: `${process.env.SHOTS}/rb-entry-gore-detail.png` });
      await page.locator("#roundaboutGorePreview").evaluate(e => e.remove());
    }
    await page.locator("#undoButton").click();
    assert.equal((await state())[0].approaches[0].entryGores, undefined, "one undo removes the gore");
    await page.locator("#redoButton").click();
    assert.equal((await state())[0].approaches[0].entryGores[goreLane], 6);
    await fill("Gore between entry lanes 1 and 2 (ft)", 0);
    assert.equal(await gorePlus.count(), 1, "zero removes the gore and restores its +");


    // Lane destinations: unchecking the left lane's through movement leaves it
    // left-turn only, which calls for a spiral island.
    await selectChoice(panel.locator("#intersection-approach"), id0);
    const before = await page.evaluate(() => {
      const it = StripeMaker.sheets.selected.intersections[0], a = it.approaches[0], R = StripeMaker.roundaboutGeometry;
      return R.destinations(it, a, a.inLanes[0]).map((x) => R.turnOf(it, a, it.approaches.find((b) => b.id === x)));
    });
    assert.deepEqual(new Set(before), new Set(["left", "u", "through"]), "left lane: left, U-turn and through");
    const lane1 = panel.locator("fieldset").filter({ hasText: "Lane 1 (inside)" });
    await lane1.getByLabel(/through/).uncheck();
    item = (await state())[0];
    assert.equal(item.approaches[0].dest[item.approaches[0].inLanes[0]].length, 2, "destination removed");
    assert.ok(await page.evaluate(() => StripeMaker.roundaboutGeometry.spiralWanted(StripeMaker.sheets.selected.intersections[0])), "left-turn-only lane: spiral island");
    // Dragging from an entry lane's arrow onto an exit toggles that exit back.
    const through = item.approaches.find((b) => Math.abs(((b.angle - item.approaches[0].angle + 540) % 360) - 180) > 170 && b !== item.approaches[0]);
    const from = page.locator(`[data-key="lane-${item.approaches[0].inLanes[0]}"]`);
    const r = await from.boundingBox();
    const target = await page.evaluate((id) => {
      // The exit's handle sits just outside the circle.
      const it = StripeMaker.sheets.selected.intersections[0], b = it.approaches.find((x) => x.id === id), G = StripeMaker.intersectionGeometry;
      const h = StripeMaker.roundaboutGeometry.handle(it, b, false, 0);
      return G.add(it, G.mul(G.sub(h.p, G.mul(h.u, 9)), 12 / StripeMaker.sheets.selected.inchesPerPixel));
    }, through.id);
    const to = await screenOf(target);
    await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 15 });
    await page.mouse.up();
    item = (await state())[0];
    assert.ok(item.approaches[0].dest[item.approaches[0].inLanes[0]].includes(through.id), "drag adds the exit back");
    // Entry handles sit just behind YIELD, not out at the mouth.
    const near = await page.evaluate(() => {
      const it = StripeMaker.sheets.selected.intersections[0], a = it.approaches[0], R = StripeMaker.roundaboutGeometry;
      return R.layout(it).legs.get(a.id).S0 - R.handle(it, a, true, 0).sp;
    });
    assert.ok(near < 45, `entry handle ${near.toFixed(0)} ft from the circle`);
    await page.getByRole("button", { name: "Reset Lane Destinations" }).click();
    assert.deepEqual((await state())[0].approaches[0].dest, {}, "reset clears hand-set destinations");

    // A divided approach: the + at the mouth's center adds a median, which
    // becomes the splitter island from the mouth; the panel sets its width.
    await fill("Median at mouth (ft)", 0);
    await page.locator(`[data-key="add-median-${id0}"]`).click();
    assert.equal((await state())[0].approaches[0].median, 6, "+ adds a median");
    assert.ok(await page.locator(`[data-key="median-corner-${id0}-entry-mouth"]`).isVisible(), "median connection corner handle");
    await fill("Median at mouth (ft)", 12);
    assert.equal(await page.evaluate(() => {
      const it = StripeMaker.sheets.selected.intersections[0];
      return StripeMaker.roundaboutGeometry.layout(it).legs.get(it.approaches[0].id).nose;
    }), 0, "island starts at the mouth");

    // Shapes: an oval and a peanut, with no layout error.
    for (const shape of ["oval", "peanut"]) {
      await selectChoice(panel.locator("#intersection-rb-shape"), shape);
      assert.doesNotMatch(await page.locator("#intersectionSheetMessage").textContent(), /overlap|narrow|no central|valid/i, `${shape} lays out`);
      assert.equal((await state())[0].roundabout.shape, shape);
    }
    await shot("rb-peanut");
    await selectChoice(panel.locator("#intersection-rb-shape"), "circle");
    // Additional circulating lanes stay editable without design guidance.
    await selectChoice(panel.locator("#intersection-rb-lanes"), "4");
    assert.equal(await page.evaluate(() => StripeMaker.roundaboutGeometry.laneCount(StripeMaker.sheets.selected.intersections[0])), 4);
    assert.equal(await panel.getByText(/goes beyond that practice/).count(), 0, "design recommendations stay out of the editor");
    await selectChoice(panel.locator("#intersection-rb-lanes"), "auto");

    // A road's lane node dragged onto an entry lane links it; resizing the circle
    // carries the road end with the opening.
    await page.evaluate(() => {
      const s = StripeMaker.sheets.selected, it = s.intersections[0], a = it.approaches[0], G = StripeMaker.intersectionGeometry;
      const k = 12 / s.inchesPerPixel, mouth = G.add(it, G.mul(a, k)), u = G.axes(a).u;
      s.roads.push({ id: 900, lanes: 1, laneWidth: 12, ends: [{ joint: 900, sign: 1, length: null }, { joint: 901, sign: 1, length: null }] });
      s.joints.push(
        { id: 900, x: mouth.x + u.x * 600 * k, y: mouth.y + u.y * 600 * k - 60 * k, dir: { x: -u.x, y: -u.y }, root: 900, links: [] },
        { id: 901, x: mouth.x + u.x * 120 * k, y: mouth.y + u.y * 120 * k - 60 * k, dir: { x: -u.x, y: -u.y }, root: 900, links: [] },
      );
      StripeMaker.roadEditor.render();
      StripeMaker.history.record();
    });
    await page.getByRole("button", { name: "Elements", exact: true }).click();
    const node = page.locator('.roadNode[data-road="900"][data-end="1"]').first();
    const nb = await node.boundingBox();
    const laneMouth = await page.evaluate(() => {
      const s = StripeMaker.sheets.selected, it = s.intersections[0], a = it.approaches[0], G = StripeMaker.intersectionGeometry;
      return G.add(it, G.mul(G.lane(a, true, 1), 12 / s.inchesPerPixel));
    });
    const lm = await screenOf(laneMouth);
    await page.mouse.move(nb.x + nb.width / 2, nb.y + nb.height / 2);
    await page.mouse.down();
    await page.mouse.move(lm.x, lm.y, { steps: 12 });
    await page.mouse.up();
    item = (await state())[0];
    assert.equal(item.approaches[0].links?.[0]?.road, 900, "road lane links to the entry lane");
    const joint = () => page.evaluate(() => structuredClone(StripeMaker.sheets.selected.joints.find((j) => j.id === 901)));
    const j0 = await joint();
    await page.getByRole("button", { name: "Intersections", exact: true }).click();
    await page.locator("#intersectionList button").first().click();
    await page.locator("#editIntersection").click();
    await fill("Inscribed diameter (ft)", 220);
    const j1 = await joint();
    assert.ok(Math.hypot(j1.x - j0.x, j1.y - j0.y) > 5, "linked road end follows the opening");
    await shot("rb-road");
    await selectChoice(panel.locator("#intersection-approach"), id0);
    await fill("Gore between entry lanes 1 and 2 (ft)", 6);
    assert.equal((await state())[0].approaches[0].links[0].road, 900, "gore preserves road attachment");
    const beforeBend = await joint();
    await fill("Whole approach bend (ft)", 1);
    assert.equal((await state())[0].approaches[0].bend, 1);
    const bentJoint = await joint();
    const linkedMovement = await page.evaluate(() => {
      const s = StripeMaker.sheets.selected, a = s.intersections[0].approaches[0], n = StripeMaker.intersectionGeometry.axes(a).n;
      return StripeMaker.intersectionGeometry.mul(n, 12 / s.inchesPerPixel);
    });
    assert.ok(Math.abs(bentJoint.x - beforeBend.x - linkedMovement.x) < 0.01 && Math.abs(bentJoint.y - beforeBend.y - linkedMovement.y) < 0.01,
      "whole-leg bend carries the linked road mouth to the new connection");
    await page.locator('#undoButton').click();
    assert.equal(JSON.stringify(await joint()), JSON.stringify(beforeBend), 'undo restores the connected road too');
    await page.locator('#redoButton').click();
    assert.equal(JSON.stringify(await joint()), JSON.stringify(bentJoint), 'redo moves the connected road again');
    const connectedMouth = structuredClone((await state())[0].approaches[0]);
    const connectionHandle = page.getByRole('button', { name: 'Approach 1 whole approach curve', exact: true });
    const hb = await connectionHandle.boundingBox();
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    await page.mouse.move(hb.x + hb.width / 2 + 6, hb.y + hb.height / 2 + 4, { steps: 6 });
    await page.mouse.up();
    const draggedMouth = (await state())[0].approaches[0], draggedJoint = await joint();
    const pixelsPerFoot = await page.evaluate(() => 12 / StripeMaker.sheets.selected.inchesPerPixel);
    assert.ok(Math.hypot(draggedMouth.x - connectedMouth.x, draggedMouth.y - connectedMouth.y) > 1, 'connected mouth follows a diagonal handle drag');
    assert.ok(Math.abs(draggedJoint.x - bentJoint.x - (draggedMouth.x - connectedMouth.x) * pixelsPerFoot) < 0.01 &&
      Math.abs(draggedJoint.y - bentJoint.y - (draggedMouth.y - connectedMouth.y) * pixelsPerFoot) < 0.01, 'attached road follows both directions of the handle drag');
    await page.locator('#undoButton').click();
    assert.equal(JSON.stringify(await joint()), JSON.stringify(bentJoint), 'one undo restores the entire connected drag');
    // Duplicating regenerates lane IDs and rehomes their gore widths.
    await page.getByRole("button", { name: "Intersections", exact: true }).click();
    await page.locator("#duplicateIntersection").click();
    const duplicate = (await state())[1];
    assert.notEqual(duplicate.approaches[0].inLanes[1], goreLane);
    assert.equal(duplicate.approaches[0].entryGores[duplicate.approaches[0].inLanes[1]], 6);
    assert.equal(duplicate.approaches[0].bend, 1, "duplicate retains its whole-leg curve");
    page.once("dialog", d => d.accept());
    await page.locator("#deleteIntersection").click();

    // Exports draw it as vectors, without the screen guides.
    await page.getByRole("button", { name: "Download", exact: true }).click();
    await page.locator('[data-format="pdf"]').click();
    const downloading = page.waitForEvent("download");
    await page.locator("#downloadSheet").click();
    const file = `${require("node:os").tmpdir()}/roundabout-export.pdf`;
    await (await downloading).saveAs(file);
    const pdf = fs.readFileSync(file).toString("latin1");
    assert.ok(pdf.startsWith("%PDF-"));
    const contentsId = pdf.match(/\/Contents (\d+) 0 R/)[1];
    const objectStart = pdf.indexOf(`${contentsId} 0 obj\n`), streamStart = pdf.indexOf("stream\n", objectStart) + 7;
    const contentLength = Number(pdf.slice(objectStart, streamStart).match(/\/Length (\d+)/)[1]);
    const content = require("node:zlib").inflateSync(Buffer.from(pdf.slice(streamStart, streamStart + contentLength), "latin1")).toString();
    assert.ok((content.match(/\bl\n/g) || []).length > 400, "PDF contains vector roundabout paths");
    assert.ok(/\] \S+ d\n/.test(content), "PDF keeps dash patterns");
    assert.equal(await page.locator(".roadLayer .intersectionMovement").count(), 0, "guides never export");

    // It is saved and comes back after a reload.
    await page.waitForTimeout(1500);
    await page.reload();
    await page.waitForFunction(() => StripeMaker.sheets.selected?.intersections?.length);
    item = (await state())[0];
    assert.equal(item.kind, "roundabout");
    assert.equal(item.roundabout.icd, 220);
    assert.equal(item.approaches[0].median, 12);
    assert.equal(item.approaches[0].bend, 1);
    assert.equal(item.approaches[0].entryGores[goreLane], 6, "per-boundary gore survives reload");
    assert.deepEqual(errors, []);
    console.log("roundabout browser tests passed");
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
