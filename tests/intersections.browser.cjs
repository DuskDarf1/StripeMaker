/* Run against a local server in an isolated browser profile:
   PLAYWRIGHT_MODULE=/path/to/playwright CHROME_PATH=/path/to/chrome \
   STRIPEMAKER_URL=http://127.0.0.1:8876 node tests/intersections.browser.cjs */
const assert = require("node:assert/strict");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
(async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
  });
  try {
    const context = await browser.newContext({
      viewport: { width: 1400, height: 1000 },
      acceptDownloads: true,
    });
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => { errors.push(e.message); console.error("Browser error:", e.stack); });
    page.setDefaultTimeout(8000);
    await page.goto(process.env.STRIPEMAKER_URL || "http://127.0.0.1:8876");
    const png = await page.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = 1600;
      c.height = 1200;
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#777";
      ctx.fillRect(0, 0, 1600, 1200);
      return c.toDataURL().split(",")[1];
    });
    await page.locator("#sheetFile").setInputFiles({
      name: "Intersection test.png",
      mimeType: "image/png",
      buffer: Buffer.from(png, "base64"),
    });
    await page.waitForFunction(() => StripeMaker.sheets.selected);
    await page.evaluate(() => {
      const s = StripeMaker.sheets.selected;
      s.inchesPerPixel = 4;
      StripeMaker.history.rebase();
      document.dispatchEvent(new Event("sheetchange"));
    });
    const state = () => page.evaluate(() => structuredClone(StripeMaker.sheets.selected.intersections ?? []));
    const panel = page.locator("#intersectionEditor");
    // Edit opens the selected intersection in the side panel.
    const open = async () => {
      if (!(await page.locator("#intersectionsEditor").isVisible()))
        await page.getByRole("button", { name: "Intersections", exact: true }).click();
      if (!(await page.locator("#intersectionList button.active").count()))
        await page.locator("#intersectionList button").first().click();
      await page.locator("#editIntersection").click();
    };
    async function fill(label, value) {
      await panel.getByLabel(label, { exact: true }).fill(String(value));
      await panel.getByLabel(label, { exact: true }).press("Tab");
    }
    async function drag(locator, to, alt = false) {
      const r = await locator.boundingBox();
      assert.ok(r, "drag handle visible");
      if (alt) await page.keyboard.down("Alt");
      await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
      await page.mouse.down();
      await page.mouse.move(to.x, to.y, { steps: 12 });
      await page.mouse.up();
      if (alt) await page.keyboard.up("Alt");
    }
    const sheetPoint = (p) =>
      page.evaluate((p) => {
        const at = StripeMaker.sheets.toScreen(p),
          r = document.getElementById("previewStage").getBoundingClientRect();
        return { x: at.x + r.left, y: at.y + r.top };
      }, p);
    // New Intersection places the default layout and opens it in the side panel.
    await page.getByRole("button", { name: "Intersections", exact: true }).click();
    await page.locator("#newIntersection").click();
    assert.equal((await state()).length, 1);
    assert.ok(await panel.isVisible(), "new intersection opens the side panel");
    assert.equal(await page.locator("dialog#intersectionDialog").count(), 0, "no intersection dialog");
    // The default is two 2-lane two-way roads crossing: one lane each way per approach.
    assert.equal(await panel.getByLabel("Incoming lanes", { exact: true }).inputValue(), "1");
    assert.equal(await panel.getByLabel("Outgoing lanes", { exact: true }).inputValue(), "1");
    assert.equal(await page.locator("#intersection-approach option").count(), 4);
    await page.locator("#intersectionSheetName").fill("Main and First");
    await page.locator("#intersectionSheetName").press("Tab");
    assert.equal((await state())[0].name, "Main and First");
    // A new intersection has no movements; each incoming lane shows a ? until one is drawn.
    assert.equal((await state())[0].movements.length, 0, "new intersections start without movements");
    assert.equal(await page.locator(".intersectionLaneUnknown").count(), 4, "lanes without movements show ?");
    // Intersection lines are painted in the road layer: white curb lines around
    // each corner and a double yellow on each two-way approach.
    const painted = (color) =>
      page.evaluate(
        (color) =>
          StripeMaker.sheets.selected.roadLayer.querySelectorAll(`.roadMarkings path[stroke="${color}"]`)
            .length,
        color,
      );
    assert.equal(await painted("#ffffff"), 4, "a white edge line rides each corner");
    assert.equal(await painted("#ffc72c"), 8, "each approach has a double yellow");
    // Later steps use the usual through and turn movements.
    await page.evaluate(() => {
      const s = StripeMaker.sheets.selected;
      StripeMaker.intersectionGeometry.auto(s.intersections[0]);
      StripeMaker.roadEditor.render();
      StripeMaker.history.record();
    });
    assert.equal(
      await page.locator(".intersectionLaneUnknown").count(),
      0,
      "? clears once a lane has movements",
    );
    const original = JSON.stringify(await state());
    await page.locator("#intersectionSheetAdd").click();
    assert.equal(await page.locator("#intersection-approach option").count(), 5);
    await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
    assert.equal(JSON.stringify(await state()), original, "adding an approach is one undo step");
    await fill("Center median (ft)", 12);
    await panel.locator("#intersection-median-surface").selectOption("concrete");
    await fill("Corner radius (ft)", 0);
    await panel.getByLabel("Edit curve", { exact: true }).selectOption({ index: 1 });
    await fill("Entry pull (ft)", 77);
    let first = (await state())[0].approaches[0];
    assert.equal(first.median, 12);
    assert.equal(first.surface, "concrete");
    assert.equal(first.radius, 0);
    assert.ok((await state())[0].movements.some((m) => m.pullIn === 77 && !m.autoCurve));
    await page.locator("#undoButton").click();
    assert.ok(!(await state())[0].movements.some((m) => m.pullIn === 77), "each panel edit is one undo step");
    await page.locator("#redoButton").click();
    assert.ok((await state())[0].movements.some((m) => m.pullIn === 77));
    console.log("editor and history passed");
    // Prepare a divided terminal road with a different cross section.
    await page.evaluate(() => {
      const s = StripeMaker.sheets.selected;
      s.roads = [
        {
          id: 100,
          lanes: 3,
          laneWidth: 11,
          ends: [
            { joint: 100, sign: 1, length: null },
            { joint: 101, sign: 1, length: null },
          ],
        },
        {
          id: 101,
          lanes: 1,
          laneWidth: 13,
          ends: [
            { joint: 101, sign: -1, length: null },
            { joint: 100, sign: -1, length: null },
          ],
        },
      ];
      s.joints = [
        {
          id: 100,
          x: 1500,
          y: 600,
          dir: { x: -1, y: 0 },
          root: 100,
          links: [{ a: 100, ai: 0, b: 101, bi: 0, pair: true, median: 10 }],
        },
        {
          id: 101,
          x: 1220,
          y: 600,
          dir: { x: -1, y: 0 },
          root: 100,
          links: [{ a: 100, ai: 0, b: 101, bi: 0, pair: true, median: 10 }],
        },
      ];
      StripeMaker.roadEditor.render();
      StripeMaker.history.record();
    });
    if (!(await page.locator("#intersectionsEditor").isVisible()))
      await page.getByRole("button", { name: "Intersections", exact: true }).click();
    const target = await sheetPoint({ x: 1220, y: 600 - 3 * (33 + 65 / 12 + 2 / 3) });
    await drag(page.getByRole("button", { name: "Approach 1 incoming outer edge", exact: true }), target);
    console.log("snap gesture complete");
    let item = (await state())[0],
      a = item.approaches[0];
    assert.ok(a.binding, "road endpoint attached");
    assert.equal(a.incoming, 3);
    assert.equal(a.outgoing, 1);
    assert.equal(a.width, 11);
    assert.equal(a.outWidth, 13);
    assert.equal(a.median, 10);
    assert.ok(Math.abs(a.x - 140) < 1e-5);
    assert.ok(Math.abs(a.y) < 1e-5);
    await page.locator("#undoButton").click();
    assert.equal((await state())[0].approaches[0].binding, undefined);
    await page.locator("#redoButton").click();
    assert.ok((await state())[0].approaches[0].binding);
    await open();
    await panel.getByLabel("Approach", { exact: true }).selectOption({ index: 0 });
    assert.ok(await panel.getByLabel("Incoming width (ft)", { exact: true }).isDisabled());
    console.log("attachment history passed");
    // Moving the road updates the attached opening without changing another mouth.
    await page.evaluate(() => {
      const s = StripeMaker.sheets.selected;
      s.joints.find((j) => j.id === 101).y += 30;
      StripeMaker.roadEditor.render();
      StripeMaker.sheets.save(s);
      StripeMaker.history.record();
    });
    assert.ok(Math.abs((await state())[0].approaches[0].y - 10) < 1e-5);
    // Alt-drag releases the binding and does not move the road.
    if (!(await page.locator("#intersectionsEditor").isVisible()))
      await page.getByRole("button", { name: "Intersections", exact: true }).click();
    const beforeRoad = await page.evaluate(() => JSON.stringify(StripeMaker.sheets.selected.joints));
    const handle = page.getByRole("button", { name: "Approach 1 incoming outer edge", exact: true }),
      box = await handle.boundingBox();
    await drag(handle, { x: box.x + 35, y: box.y - 20 }, true);
    assert.equal((await state())[0].approaches[0].binding, undefined);
    assert.equal(await page.evaluate(() => JSON.stringify(StripeMaker.sheets.selected.joints)), beforeRoad);
    await page.locator("#undoButton").click();
    assert.ok((await state())[0].approaches[0].binding);
    if (!(await page.locator("#intersectionsEditor").isVisible()))
      await page.getByRole("button", { name: "Intersections", exact: true }).click();
    // Duplicate is independent, including IDs and attachment references.
    await page.locator("#duplicateIntersection").click();
    let all = await state();
    assert.equal(all.length, 2);
    assert.equal(all[1].approaches[0].binding, undefined);
    assert.notEqual(all[0].approaches[0].inLanes[0], all[1].approaches[0].inLanes[0]);
    // Deleting asks first; dismissing keeps the intersection.
    page.once("dialog", (d) => d.dismiss());
    await page.locator("#deleteIntersection").click();
    assert.equal((await state()).length, 2, "dismissed confirmation keeps the intersection");
    page.once("dialog", (d) => d.accept());
    await page.locator("#deleteIntersection").click();
    assert.equal((await state()).length, 1);
    // Guides show only on the clicked intersection: none with the tools closed,
    // and they are never part of export SVG.
    await page.getByRole("button", { name: "Intersections", exact: true }).click();
    assert.equal(await page.locator(".intersectionOverlay .intersectionMovement").count(), 0);
    assert.equal(await page.locator(".roadLayer .intersectionMovement").count(), 0);
    // Both export pipelines must include only pavement/surfaces, not screen guides.
    await page.getByRole("button", { name: "Download", exact: true }).click();
    await page.locator('[data-format="pdf"]').click();
    let downloading = page.waitForEvent("download");
    await page.locator("#downloadSheet").click();
    let download = await downloading;
    await download.saveAs("/tmp/intersection-export.pdf");
    const fs = require("node:fs");
    const pdf = fs.readFileSync("/tmp/intersection-export.pdf").toString("latin1");
    assert.ok(pdf.startsWith("%PDF-"));
    assert.ok(pdf.includes("/Subtype /Image"));
    const contentsId = pdf.match(/\/Contents (\d+) 0 R/)[1];
    const objectStart = pdf.indexOf(`${contentsId} 0 obj\n`),
      streamStart = pdf.indexOf("stream\n", objectStart) + 7;
    const contentLength = Number(pdf.slice(objectStart, streamStart).match(/\/Length (\d+)/)[1]);
    const content = require("node:zlib")
      .inflateSync(Buffer.from(pdf.slice(streamStart, streamStart + contentLength), "latin1"))
      .toString();
    assert.ok((content.match(/\bl\n/g) || []).length > 40, "PDF contains vector pavement segments");
    await page.locator('[data-format="png"]').click();
    downloading = page.waitForEvent("download");
    await page.locator("#downloadSheet").click();
    download = await downloading;
    await download.saveAs("/tmp/intersection-export.png");
    assert.equal(fs.readFileSync("/tmp/intersection-export.png").subarray(1, 4).toString(), "PNG");
    // Keyboard movement of a bound mouth moves its road and undoes atomically.
    await page.getByRole("button", { name: "Intersections", exact: true }).click();
    if (!(await page.locator("#intersectionsEditor").isVisible()))
      await page.getByRole("button", { name: "Intersections", exact: true }).click();
    await page.locator("#intersectionList button").click();
    const boundBefore = await state();
    const jointsBefore = await page.evaluate(() => JSON.stringify(StripeMaker.sheets.selected.joints));
    const boundHandle = page.getByRole("button", { name: "Approach 1 incoming outer edge", exact: true });
    await boundHandle.focus();
    await boundHandle.press("ArrowRight");
    assert.notEqual(
      await page.evaluate(() => JSON.stringify(StripeMaker.sheets.selected.joints)),
      jointsBefore,
    );
    await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
    assert.equal(await page.evaluate(() => JSON.stringify(StripeMaker.sheets.selected.joints)), jointsBefore);
    assert.equal(JSON.stringify(await state()), JSON.stringify(boundBefore));
    console.log("exports and keyboard/curve editing passed");
    // Selecting a sheet connection reveals exactly two curve handles; dragging
    // them keeps the selection and records an undoable movement edit.
    const connection = page.locator(".intersectionConnectionHit").last();
    const connectionPoint = await connection.evaluate((e) => {
      const p = e.getPointAtLength(e.getTotalLength() * 0.3),
        q = new DOMPoint(p.x, p.y).matrixTransform(e.getScreenCTM());
      return { x: q.x, y: q.y };
    });
    assert.equal(await page.getByRole("button", { name: "Entry curve handle", exact: true }).count(), 0);
    await page.mouse.click(connectionPoint.x, connectionPoint.y);
    const sheetCurve = page.getByRole("button", { name: "Entry curve handle", exact: true });
    assert.equal(await sheetCurve.count(), 1);
    assert.equal(await page.getByRole("button", { name: "Exit curve handle", exact: true }).count(), 1);
    const curveBefore = JSON.stringify(await state()),
      sheetCurveBox = await sheetCurve.boundingBox();
    await drag(sheetCurve, { x: sheetCurveBox.x + 25, y: sheetCurveBox.y + 10 });
    assert.ok(
      await page.locator("#intersectionEditor").isVisible(),
      "curve drag keeps the sheet editor open",
    );
    assert.equal(await sheetCurve.count(), 1, "curve stays selected");
    assert.notEqual(JSON.stringify(await state()), curveBefore);
    await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
    assert.equal(JSON.stringify(await state()), curveBefore);
    // Drag actual pavement between lane guides: it must stay selected after release.
    if (!(await page.locator("#intersectionsEditor").isVisible()))
      await page.getByRole("button", { name: "Intersections", exact: true }).click();
    await page.locator("#intersectionList button").click();
    const bodyPoint = await page.evaluate(() => {
      const s = StripeMaker.sheets.selected,
        item = s.intersections[0],
        G = StripeMaker.intersectionGeometry,
        a = item.approaches[0];
      const local = G.add(G.sub(G.lane(a, false, 0), G.mul(G.axes(a).u, 15)), G.mul(G.axes(a).n, 3));
      const p = StripeMaker.sheets.toScreen(G.add(item, G.mul(local, 12 / s.inchesPerPixel))),
        r = document.getElementById("previewStage").getBoundingClientRect();
      return { x: p.x + r.left, y: p.y + r.top };
    });
    const bodyBefore = JSON.stringify(await state());
    await page.mouse.move(bodyPoint.x, bodyPoint.y);
    await page.mouse.down();
    await page.mouse.move(bodyPoint.x + 20, bodyPoint.y + 10, { steps: 8 });
    await page.mouse.up();
    assert.ok(await page.locator("#intersectionEditor").isVisible(), "body drag keeps the sheet editor open");
    assert.equal(await page.locator(".intersectionOutline").count(), 1, "intersection remains selected");
    assert.notEqual(JSON.stringify(await state()), bodyBefore);
    await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
    assert.equal(JSON.stringify(await state()), bodyBefore);
    console.log("sheet curve handles and drag selection passed");
    // Branching from a connected road cuts that road; the intersection binding
    // follows the surviving terminal piece without moving the intersection.
    await page.getByRole("button", { name: "Elements", exact: true }).click();
    const beforeCut = JSON.stringify(await state());
    const branchPoint = await page.evaluate(() => {
      const path = StripeMaker.sheets.selected.roadLayer.querySelector(".roadPavement > .roadBand");
      const values = path
        .getAttribute("d")
        .match(/-?\d*\.?\d+(?:e-?\d+)?/gi)
        .map(Number);
      const points = [];
      for (let i = 0; i < values.length; i += 2) points.push({ x: values[i], y: values[i + 1] });
      return points[Math.floor(points.length * 0.75)];
    });
    await page.locator("#addRoad").click();
    for (const p of [branchPoint, { x: branchPoint.x, y: branchPoint.y - 130 }]) {
      const at = await sheetPoint(p);
      await page.mouse.click(at.x, at.y);
    }
    await page.keyboard.press("Escape");
    assert.ok(await page.evaluate(() => StripeMaker.sheets.selected.roads.length > 2), "branch cuts road");
    const cutItem = (await state())[0];
    assert.ok(cutItem.approaches[0].binding);
    assert.notEqual(cutItem.approaches[0].binding.road, JSON.parse(beforeCut)[0].approaches[0].binding.road);
    assert.ok(Math.abs(cutItem.approaches[0].x - JSON.parse(beforeCut)[0].approaches[0].x) < 0.01);
    await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
    assert.equal(JSON.stringify(await state()), beforeCut);
    console.log("road-cut attachment preservation passed");
    // Standalone median points snap to the curved intersection boundary and stay anchored.
    if (!(await page.locator("#elementsEditor").isVisible()))
      await page.getByRole("button", { name: "Elements", exact: true }).click();
    await page.locator("#addMedian").click();
    const edge = await page.evaluate(() => {
      const s = StripeMaker.sheets.selected;
      const edge = StripeMaker.intersections
        .boundaries(s)
        .edges.find((e) => e.on.side === "corner" && e.length > 10);
      return { a: edge[Math.floor(edge.length * 0.25)], b: edge[Math.floor(edge.length * 0.75)] };
    });
    for (const p of [edge.a, edge.b, { x: edge.a.x + 100, y: edge.a.y + 100 }]) {
      const at = await sheetPoint(p);
      await page.mouse.click(at.x, at.y);
    }
    await page.keyboard.press("Enter");
    const anchors = await page.evaluate(() =>
      StripeMaker.sheets.selected.medians.at(-1).points.map((p) => p.on),
    );
    assert.ok(anchors[0]?.intersection && anchors[1]?.intersection, "median snaps to intersection boundary");
    const medianBefore = await page.evaluate(() =>
      JSON.stringify(StripeMaker.sheets.selected.medians.at(-1).points),
    );
    await page.evaluate(() => {
      const s = StripeMaker.sheets.selected;
      s.intersections[0].x += 10;
      StripeMaker.roadEditor.render();
      StripeMaker.sheets.save(s);
      StripeMaker.history.record();
    });
    assert.notEqual(
      await page.evaluate(() => JSON.stringify(StripeMaker.sheets.selected.medians.at(-1).points)),
      medianBefore,
      "median anchors follow the intersection",
    );
    console.log("median intersection snapping passed");
    // Picking an intersection on the sheet opens its panel, which survives panning
    // and clicks on empty sheet, and edits the live intersection as undo steps.
    if (!(await page.locator("#intersectionsEditor").isVisible()))
      await page.getByRole("button", { name: "Intersections", exact: true }).click();
    const centerPoint = await page.evaluate(() => {
      const item = StripeMaker.sheets.selected.intersections[0],
        at = StripeMaker.sheets.toScreen(item),
        r = document.getElementById("previewStage").getBoundingClientRect();
      return { x: at.x + r.left, y: at.y + r.top };
    });
    await page.mouse.click(centerPoint.x, centerPoint.y);
    const sheetPanel = page.locator("#intersectionEditor");
    assert.ok(await sheetPanel.isVisible(), "sheet click opens the intersection panel");
    const emptyPoint = await sheetPoint({ x: 60, y: 1100 });
    await page.mouse.move(emptyPoint.x, emptyPoint.y);
    await page.mouse.down();
    await page.mouse.move(emptyPoint.x + 40, emptyPoint.y - 20, { steps: 6 });
    await page.mouse.up();
    await page.mouse.click(emptyPoint.x + 40, emptyPoint.y - 20);
    assert.ok(await sheetPanel.isVisible(), "panning and empty clicks keep the panel open");
    assert.equal(await page.locator(".intersectionOutline").count(), 1, "intersection stays selected");
    await sheetPanel.getByLabel("Approach", { exact: true }).selectOption({ index: 1 });
    const panelBefore = JSON.stringify(await state());
    await sheetPanel.getByLabel("Corner radius (ft)", { exact: true }).fill("33");
    await sheetPanel.getByLabel("Corner radius (ft)", { exact: true }).press("Tab");
    assert.equal((await state())[0].approaches[1].radius, 33, "panel edits the sheet intersection");
    await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
    assert.equal(JSON.stringify(await state()), panelBefore, "panel edit is one undo step");
    // Drag from an incoming lane arrow to an outgoing lane on the sheet.
    const overlayLane = (name) =>
      page.locator(".intersectionOverlay").getByRole("button", { name, exact: true });
    const movementCount = (await state())[0].movements.length;
    const toLane = await overlayLane("Outgoing lane 1, approach 2").boundingBox();
    await drag(overlayLane("Incoming lane 1, approach 2"), {
      x: toLane.x + toLane.width / 2,
      y: toLane.y + toLane.height / 2,
    });
    assert.equal((await state())[0].movements.length, movementCount + 1, "sheet lane drag adds a movement");
    assert.ok(await sheetPanel.isVisible());
    // Dragging the same movement again removes it.
    await drag(overlayLane("Incoming lane 1, approach 2"), {
      x: toLane.x + toLane.width / 2,
      y: toLane.y + toLane.height / 2,
    });
    assert.equal(
      (await state())[0].movements.length,
      movementCount,
      "dragging an existing movement removes it",
    );
    await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
    assert.equal((await state())[0].movements.length, movementCount + 1);
    await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
    assert.equal((await state())[0].movements.length, movementCount);
    console.log("sheet panel and movement editing passed");
    // A + at a lane boundary adds a median between those lanes; its edge drags
    // its width, the Delete key removes it, and the center median has a + too.
    await panel.getByLabel("Approach", { exact: true }).selectOption({ index: 1 });
    await fill("Incoming lanes", 2);
    const splitBefore = JSON.stringify(await state());
    await page
      .getByRole("button", { name: "Add a median to approach 2 between incoming lanes 1 and 2", exact: true })
      .click();
    let split = (await state())[0].approaches[1].splits?.[0];
    assert.ok(split && split.incoming && split.after === 1 && split.width === 6, "+ adds a split median");
    const splitEdge = page.getByRole("button", {
      name: "Approach 2 median between incoming lanes 1 and 2, outer edge",
      exact: true,
    });
    const edgeBox = await splitEdge.boundingBox();
    const outward = await page.evaluate(() => {
      const a = StripeMaker.sheets.selected.intersections[0].approaches[1],
        n = StripeMaker.intersectionGeometry.axes(a).n;
      return { x: -n.x, y: -n.y };
    });
    const perFoot = await page.evaluate(() => StripeMaker.sheets.selected.view.scale * 3);
    await drag(splitEdge, {
      x: edgeBox.x + edgeBox.width / 2 + outward.x * perFoot * 4,
      y: edgeBox.y + edgeBox.height / 2 + outward.y * perFoot * 4,
    });
    split = (await state())[0].approaches[1].splits[0];
    assert.ok(Math.abs(split.width - 10) < 0.6, `dragging the edge widens the median (${split.width})`);
    await splitEdge.focus();
    await page.keyboard.press("Delete");
    assert.equal((await state())[0].approaches[1].splits, undefined, "Delete removes a split median");
    assert.equal((await state()).length, 1, "Delete on a median handle keeps the intersection");
    await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
    await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
    await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
    assert.equal(JSON.stringify(await state()), splitBefore);
    await page
      .getByRole("button", { name: "Add a median to approach 2 between the two directions", exact: true })
      .click();
    assert.equal((await state())[0].approaches[1].median, 6, "+ adds a center median");
    await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
    await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
    console.log("median + controls passed");
    // A road's lane node dragged onto any approach lane links those two lanes; the
    // approach keeps its own size, and the road end follows the intersection.
    await page.evaluate(() => {
      const s = StripeMaker.sheets.selected,
        item = s.intersections[0];
      Object.assign(item.approaches.find((a) => Math.abs(a.angle - 180) < 1), { incoming: 2, width: 10, outWidth: 14 });
      StripeMaker.intersectionGeometry.normalize(item);
      s.roads.push({
        id: 300,
        lanes: 1,
        laneWidth: 12,
        ends: [
          { joint: 300, sign: 1, length: null },
          { joint: 301, sign: 1, length: null },
        ],
      });
      s.joints.push(
        { id: 300, x: item.x - 900, y: item.y + 140, dir: { x: 1, y: -0.3 }, root: 300, links: [] },
        { id: 301, x: item.x - 500, y: item.y + 140, dir: { x: 1, y: -0.3 }, root: 300, links: [] },
      );
      StripeMaker.roadEditor.render();
      StripeMaker.history.record();
    });
    await page.getByRole("button", { name: "Elements", exact: true }).click();
    const laneMouth = () =>
      page.evaluate(() => {
        const s = StripeMaker.sheets.selected,
          item = s.intersections[0],
          a = item.approaches.find((a) => Math.abs(a.angle - 180) < 1),
          G = StripeMaker.intersectionGeometry;
        return G.add(item, G.mul(G.lane(a, true, 1), 12 / s.inchesPerPixel));
      });
    const approachBefore = (await state())[0].approaches.find((a) => Math.abs(a.angle - 180) < 1);
    const roadBefore = JSON.stringify(await state());
    await drag(
      page.locator('.roadNode[data-road="300"][data-end="1"]').first(),
      await sheetPoint(await laneMouth()),
    );
    const linked = (await state())[0].approaches.find((a) => Math.abs(a.angle - 180) < 1);
    assert.deepEqual(
      linked.links,
      [{ road: 300, e: 1, lane: 0, to: approachBefore.inLanes[1] }],
      "lanes link",
    );
    for (const key of ["x", "y", "angle", "incoming", "outgoing", "width", "outWidth", "median"])
      assert.equal(linked[key], approachBefore[key], `approach keeps its ${key}`);
    const laneEnd = () =>
      page.evaluate(() => {
        const s = StripeMaker.sheets.selected,
          j = s.joints.find((j) => j.id === 301);
        return { x: j.x, y: j.y, dir: j.dir };
      });
    assert.equal(await page.evaluate(() => StripeMaker.roadEditor.intersectionEnd(StripeMaker.sheets.selected, { road: 300, e: 1 }).width), 10, "road mouth matches incoming width independently");
    const placed = await laneEnd();
    assert.ok(Math.abs(placed.dir.y / placed.dir.x) < 1e-6, "road end turns to the approach");
    // Moving the intersection carries the linked road end with it.
    await page.evaluate(() => {
      const s = StripeMaker.sheets.selected;
      s.intersections[0].y += 30;
    });
    await open();
    await fill("Corner radius (ft)", 21);
    const followed = await laneEnd();
    assert.ok(Math.abs(followed.y - placed.y - 30) < 1e-6, "linked road end follows the intersection");
    await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
    await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
    assert.equal(JSON.stringify(await state()), roadBefore, "lane link is one undo step");
    console.log("road end to approach snapping passed");
    // Drawing to a free incoming mouth links the new road and finishes the chain.
    if (!(await page.locator("#addRoad").isVisible()))
      await page.getByRole("button", { name: "Elements", exact: true }).click();
    const beforeDraw = await page.evaluate(() => JSON.stringify({
      roads: StripeMaker.sheets.selected.roads, joints: StripeMaker.sheets.selected.joints,
      intersections: StripeMaker.sheets.selected.intersections,
    }));
    const mouth = await laneMouth();
    await page.locator("#addRoad").click();
    const startPoint = await sheetPoint({ x: mouth.x - 180, y: mouth.y - 70 });
    const endPoint = await sheetPoint(mouth);
    await page.mouse.click(startPoint.x, startPoint.y);
    await page.mouse.move(endPoint.x, endPoint.y);
    await page.mouse.click(endPoint.x, endPoint.y);
    assert.equal(await page.locator("#addRoad").getAttribute("aria-pressed"), "false", "connecting ends drawing");
    const drawn = await page.evaluate(() => {
      const s = StripeMaker.sheets.selected, road = s.roads.at(-1);
      const a = s.intersections[0].approaches.find(a => Math.abs(a.angle - 180) < 1);
      const end = StripeMaker.roadEditor.intersectionEnd(s, { road: road.id, e: 1 });
      const angle = end.angle * Math.PI / 180;
      const offset = -(end.width / 2 + end.gap / 2) * 12 / s.inchesPerPixel;
      return { road, link: a.links?.find(l => l.road === road.id), end: { x: end.x - Math.sin(angle) * offset, y: end.y + Math.cos(angle) * offset } };
    });
    assert.equal(drawn.link?.to, approachBefore.inLanes[1], "drawn road links to the clicked lane");
    assert.equal(drawn.link.e, 1);
    assert.ok(Math.hypot(drawn.end.x - mouth.x, drawn.end.y - mouth.y) < 1e-6, "road end aligns to mouth");
    await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
    assert.equal(await page.evaluate(() => JSON.stringify({
      roads: StripeMaker.sheets.selected.roads, joints: StripeMaker.sheets.selected.joints,
      intersections: StripeMaker.sheets.selected.intersections,
    })), beforeDraw, "drawing and linking undo together");
    console.log("draw road to approach passed");

    // Clear all erases the sheet's drawing after confirmation, and undo restores it.
    const drawing = () =>
      page.evaluate(() => {
        const s = StripeMaker.sheets.selected;
        return JSON.stringify([s.roads, s.joints, s.gores ?? [], s.medians ?? [], s.intersections ?? []]);
      });
    const beforeClear = await drawing();
    page.once("dialog", (d) => d.dismiss());
    await page.getByRole("button", { name: "Clear all", exact: true }).click();
    assert.equal(await drawing(), beforeClear, "dismissed Clear all changes nothing");
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Clear all", exact: true }).click();
    assert.equal(await drawing(), JSON.stringify([[], [], [], [], []]), "Clear all erases the drawing");
    assert.equal(await page.evaluate(() => StripeMaker.sheets.selected.inchesPerPixel), 4, "scale stays");
    await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
    assert.equal(await drawing(), beforeClear, "undo restores a cleared sheet");
    console.log("clear all passed");
    await page.waitForTimeout(600);
    const saved = JSON.stringify(await state());
    await page.reload();
    await page.waitForFunction(() => StripeMaker.sheets.selected?.intersections?.length);
    assert.equal(JSON.stringify(await state()), saved, "reload preserves intersections");
    await page.getByRole("button", { name: "Intersections", exact: true }).click();
    if (!(await page.locator("#intersectionsEditor").isVisible()))
      await page.getByRole("button", { name: "Intersections", exact: true }).click();
    await open();
    await page.emulateMedia({ colorScheme: "dark" });
    await page.screenshot({ path: "/tmp/intersection-dark.png" });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: "/tmp/intersection-mobile.png" });
    const bounds = await panel.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 391, "panel fits a phone");
    await page.keyboard.press("Escape");
    assert.ok(!(await panel.isVisible()));
    assert.deepEqual(errors, []);
    console.log(
      "PASS: creation, panel editing, medians, geometry editing, undo/redo, road snapping, matching dimensions, live attachments, detachment, duplication, persistence, guide isolation, dark/mobile UI.",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
