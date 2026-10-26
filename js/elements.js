(() => {
  // Roads are one-way groups of parallel lanes, stored in sheet image pixels. Every
  // lane has its own line with a node at each end, and a road's lanes move together.
  // Roads connect lane to lane: one lane's end node joins another lane's start node.
  //
  // Each road end sits on a joint: a point and a direction of travel shared by every
  // road end connected there. Lane-to-lane links fix each road's sideways position
  // on the joint, so joined ends line up and move together. A road joined in the
  // opposite direction sits beside the other road, left edge to left edge, making
  // a two-way road with a double yellow centerline.
  //
  // Markings follow FDOT Standard Plans Index 711-001 (FY 2025-26). Dimensions are
  // to the centerline of markings.
  const LINE_INCHES = 6;              // edge lines, lane lines, and centerlines
  const DOUBLE_GAP_INCHES = 4;        // gap between double solid lines
  const SKIP_STRIPE_FEET = 10;        // 10'-30' skip lane line
  const SKIP_GAP_FEET = 30;
  const PAVEMENT_MARGIN_INCHES = 8;   // edge of traveled way to edge of pavement
  const YELLOW = "#ffc72c";
  const WHITE = "#ffffff";
  const MAX_LANES = 8;
  const MIN_LANE_WIDTH = 8;
  const MAX_LANE_WIDTH = 20;
  const CURVE_SEGMENTS = 96;
  const SNAP_PIXELS = 14;
  const NODE_INSET_PIXELS = 13;       // nodes sit just inside their road's end
  const DEFAULT_TAPER_FEET = 300;
  const MIN_TAPER_FEET = 10;
  const MAX_TAPER_FEET = 2000;
  const LEFT_EDGE = -0.5;             // lane "index" of a road's left edge
  const SVG = "http://www.w3.org/2000/svg";

  document.addEventListener("DOMContentLoaded", () => {
    const sheets = window.StripeMaker.sheets;
    const workspace = document.getElementById("workspace");
    const editor = document.getElementById("elementsEditor");
    const addButton = document.getElementById("addRoad");
    const deleteButton = document.getElementById("deleteRoad");
    const hint = document.getElementById("elementsHint");
    const lanesInput = document.getElementById("roadLanes");
    const widthInput = document.getElementById("roadLaneWidth");
    const laneFields = document.getElementById("laneFields");
    const laneTitle = document.getElementById("laneTitle");
    const taperSelect = document.getElementById("laneTaper");
    const taperLength = document.getElementById("laneTaperLength");
    const taperState = document.getElementById("laneTaperState");
    const defaults = { lanes: 1, laneWidth: 12 };
    const openCurves = new Set();
    const nodeButtons = new Map();
    let selectedRoad = null;
    let selectedLane = null;
    let drawing = null;
    let drag = null;
    let snapTarget = null;

    const overlay = document.createElement("div");
    overlay.className = "roadOverlay";
    overlay.hidden = true;
    overlay.innerHTML = `<svg aria-hidden="true"><line class="roadControlLine"/><line class="roadControlLine"/><circle class="roadSnap" r="15"/></svg>
      <span class="roadNode preview" aria-hidden="true"></span>
      <button type="button" class="roadControl" aria-label="Start curve handle" aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown"></button>
      <button type="button" class="roadControl" aria-label="End curve handle" aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown"></button>`;
    const controlLines = [...overlay.querySelectorAll("line")];
    const snapRing = overlay.querySelector(".roadSnap");
    const startMarker = overlay.querySelector(".roadNode.preview");
    const controlButtons = [...overlay.querySelectorAll(".roadControl")];
    sheets.addOverlay(overlay);

    const active = () => !editor.hidden;
    const inchesToPixels = (sheet, inches) => inches / sheet.inchesPerPixel;
    const feetToPixels = (sheet, feet) => inchesToPixels(sheet, feet * 12);
    const nextId = items => items.reduce((max, item) => Math.max(max, item.id), 0) + 1;
    const unit = v => {
      const length = Math.hypot(v.x, v.y) || 1;
      return { x: v.x / length, y: v.y / length };
    };
    const rightOf = v => ({ x: -v.y, y: v.x });
    const dot = (a, b) => a.x * b.x + a.y * b.y;
    const jointOf = (sheet, id) => sheet.joints.find(joint => joint.id === id);
    const roadOf = (sheet, id) => sheet.roads.find(road => road.id === id);
    const attachments = (sheet, joint) => sheet.roads.flatMap(road => road.ends
      .map((end, e) => ({ road, e, end }))).filter(({ end }) => end.joint === joint.id);
    // Sideways position of a lane's center (or the left edge), right of travel.
    const laneLateral = (sheet, road, lane) => (Math.min(lane, road.lanes - 1) + 0.5 - road.lanes / 2) * feetToPixels(sheet, road.laneWidth);
    const pairOf = (sheet, road) => sheet.roads.find(other => other !== road
      && other.ends[0].joint === road.ends[1].joint && other.ends[1].joint === road.ends[0].joint);

    function save() {
      if (sheets.selected) sheets.save(sheets.selected);
    }
    function layerFor(sheet) {
      if (!sheet.roadLayer) {
        sheet.roads = (sheet.roads ?? []).filter(road => road.ends);
        sheet.joints ??= [];
        sheet.roadLayer = document.createElementNS(SVG, "svg");
        sheet.roadLayer.classList.add("roadLayer");
        sheet.roadLayer.setAttribute("viewBox", `0 0 ${sheet.width} ${sheet.height}`);
        sheet.roadLayer.setAttribute("aria-hidden", "true");
        sheet.content.append(sheet.roadLayer);
      }
      return sheet.roadLayer;
    }

    // Road centers at each end. The joint's root road is centered on the joint;
    // links place the rest sideways so their linked lanes coincide.
    function solve(sheet) {
      layerFor(sheet);
      const solved = Object.assign(new Map(), { auto: new Set(), shapes: new Map() });
      const separation = inchesToPixels(sheet, DOUBLE_GAP_INCHES + LINE_INCHES);
      for (const joint of sheet.joints) {
        const here = attachments(sheet, joint);
        if (!here.length) continue;
        const byRoad = new Map(here.map(item => [item.road.id, item]));
        const root = byRoad.has(joint.root) ? joint.root : here[0].road.id;
        const offsets = new Map([[root, 0]]);
        for (let grew = true; grew;) {
          grew = false;
          for (const link of joint.links) {
            for (const [from, fromLane, to, toLane] of [[link.a, link.ai, link.b, link.bi], [link.b, link.bi, link.a, link.ai]]) {
              const a = byRoad.get(from);
              const b = byRoad.get(to);
              if (!a || !b || !offsets.has(from) || offsets.has(to)) continue;
              const reference = link.pair
                ? offsets.get(from) + a.end.sign * (laneLateral(sheet, a.road, LEFT_EDGE) - separation)
                : offsets.get(from) + a.end.sign * laneLateral(sheet, a.road, fromLane);
              offsets.set(to, reference - b.end.sign * laneLateral(sheet, b.road, link.pair ? LEFT_EDGE : toLane));
              grew = true;
            }
          }
        }
        // Lanes that don't continue across a joint taper automatically: ending
        // lanes drop, starting lanes are added.
        const lateral = (item, lane) => (offsets.get(item.road.id) ?? 0) + item.end.sign * laneLateral(sheet, item.road, lane);
        for (const item of here) {
          const across = here.filter(other => other.e !== item.e && other.end.sign === item.end.sign);
          if (!across.length) continue;
          for (let lane = 0; lane < item.road.lanes; lane++) {
            const at = lateral(item, lane);
            const continues = across.some(other => Array.from({ length: other.road.lanes }, (_, j) => j).some(j =>
              Math.abs(lateral(other, j) - at) < feetToPixels(sheet, Math.min(item.road.laneWidth, other.road.laneWidth)) / 2));
            if (!continues) solved.auto.add(`${item.road.id}:${item.e}:${lane}`);
          }
        }
        const normal = joint.dir ? rightOf(joint.dir) : { x: 0, y: 0 };
        for (const { road, e, end } of here) {
          const offset = offsets.get(road.id) ?? 0;
          solved.set(`${road.id}:${e}`, {
            x: joint.x + normal.x * offset, y: joint.y + normal.y * offset,
            travel: joint.dir && { x: joint.dir.x * end.sign, y: joint.dir.y * end.sign },
          });
        }
      }
      return solved;
    }

    // A cubic Bézier between the road's end centers, leaving each end along its
    // joint's direction; a free end with no direction pulls straight.
    function centerline(road, solved) {
      const a = solved.get(`${road.id}:0`);
      const b = solved.get(`${road.id}:1`);
      const chord = Math.hypot(b.x - a.x, b.y - a.y);
      const [l0, l1] = road.ends.map((end, e) => ((e ? b : a).travel ? end.length ?? chord / 3 : 0));
      const c0 = { x: a.x + (a.travel?.x ?? 0) * l0, y: a.y + (a.travel?.y ?? 0) * l0 };
      const c1 = { x: b.x - (b.travel?.x ?? 0) * l1, y: b.y - (b.travel?.y ?? 0) * l1 };
      // Enough samples for smooth curves and tapers (about one per 12 px).
      const segments = Math.min(400, Math.max(CURVE_SEGMENTS / 4, Math.ceil((chord + l0 + l1) / 12)));
      const points = [];
      for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const u = 1 - t;
        const w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
        points.push({
          x: w[0] * a.x + w[1] * c0.x + w[2] * c1.x + w[3] * b.x,
          y: w[0] * a.y + w[1] * c0.y + w[2] * c1.y + w[3] * b.y,
        });
      }
      return points;
    }
    // Positive distances offset to the right of travel (start → end).
    function offset(points, distance) {
      return points.map((point, i) => {
        const d = typeof distance === "function" ? distance(i) : distance;
        const prev = points[Math.max(0, i - 1)];
        const next = points[Math.min(points.length - 1, i + 1)];
        const normal = rightOf(unit({ x: next.x - prev.x, y: next.y - prev.y }));
        return { x: point.x + normal.x * d, y: point.y + normal.y * d };
      });
    }
    const endOf = (points, e) => points[e ? points.length - 1 : 0];
    function travelAt(road, e, solved) {
      const line = centerline(road, solved);
      const [a, b] = e ? line.slice(-2) : line.slice(0, 2);
      return unit({ x: b.x - a.x, y: b.y - a.y });
    }
    // Lane boundaries along the road. A tapering lane's width runs from zero at its
    // tapered end to full over the taper length; the first untapered lane holds its
    // place and the others pack against it.
    function buildShape(sheet, road, line, tapers) {
      const along = [0];
      for (let i = 1; i < line.length; i++) along.push(along[i - 1] + Math.hypot(line[i].x - line[i - 1].x, line[i].y - line[i - 1].y));
      const total = along[along.length - 1];
      const laneWidth = feetToPixels(sheet, road.laneWidth);
      const tapered = lane => tapers.has(`0:${lane}`) || tapers.has(`1:${lane}`);
      let anchor = 0;
      while (anchor < road.lanes - 1 && tapered(anchor)) anchor++;
      const anchorLeft = laneLateral(sheet, road, anchor) - laneWidth / 2;
      const bounds = along.map(s => {
        const widths = Array.from({ length: road.lanes }, (_, lane) => {
          const start = tapers.get(`0:${lane}`);
          const end = tapers.get(`1:${lane}`);
          let fraction = 1;
          if (start) fraction = Math.min(fraction, s / Math.min(start, total));
          if (end) fraction = Math.min(fraction, (total - s) / Math.min(end, total));
          return laneWidth * Math.max(0, Math.min(1, fraction || 0));
        });
        const b = [];
        b[anchor] = anchorLeft + (laneWidth - widths[anchor]) / 2;
        b[anchor + 1] = b[anchor] + widths[anchor];
        for (let k = anchor + 1; k < road.lanes; k++) b[k + 1] = b[k] + widths[k];
        for (let k = anchor - 1; k >= 0; k--) b[k] = b[k + 1] - widths[k];
        return b;
      });
      return { line, bounds, tapers };
    }
    // Taper settings per lane end: Auto (only where a lane doesn't continue across
    // a joint), Taper, or None.
    function tapersOf(sheet, road, solved) {
      const tapers = new Map();
      for (const e of [0, 1]) {
        for (let lane = 0; lane < road.lanes; lane++) {
          const key = `${e}:${lane}`;
          const setting = road.tapers?.[key];
          const mode = setting?.mode ?? "auto";
          if (mode === "taper" || (mode === "auto" && solved.auto.has(`${road.id}:${key}`))) {
            tapers.set(key, feetToPixels(sheet, setting?.length ?? DEFAULT_TAPER_FEET));
          }
        }
      }
      return tapers;
    }
    function shapeOf(sheet, road, solved) {
      if (!solved.shapes.has(road)) solved.shapes.set(road, buildShape(sheet, road, centerline(road, solved), tapersOf(sheet, road, solved)));
      return solved.shapes.get(road);
    }
    // Where a lane node is drawn: just inside the road, so the end nodes of one road
    // and the start nodes of the next don't cover each other at a joint.
    function nodePoint(sheet, road, e, lane, solved) {
      const { line } = shapeOf(sheet, road, solved);
      const at = lanePoint(sheet, road, e, lane, solved);
      const inward = unit(e ? { x: line[line.length - 2].x - line[line.length - 1].x, y: line[line.length - 2].y - line[line.length - 1].y }
        : { x: line[1].x - line[0].x, y: line[1].y - line[0].y });
      const inset = NODE_INSET_PIXELS / sheet.view.scale;
      return { x: at.x + inward.x * inset, y: at.y + inward.y * inset };
    }
    const boundary = (shape, k, extra = 0) => offset(shape.line, i => shape.bounds[i][k] + extra);
    function lanePoint(sheet, road, e, lane, solved) {
      const { line, bounds } = shapeOf(sheet, road, solved);
      const i = e ? line.length - 1 : 0;
      return offset([line[e ? i - 1 : 0], line[e ? i : 1]], (bounds[i][lane] + bounds[i][lane + 1]) / 2)[e];
    }
    const pathData = points => `M${points.map(p => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join("L")}`;

    function strokePath(points, color, width, dash) {
      const path = document.createElementNS(SVG, "path");
      path.setAttribute("class", "roadMarking");
      path.setAttribute("d", pathData(points));
      path.setAttribute("stroke", color);
      path.setAttribute("stroke-width", width);
      if (dash) path.setAttribute("stroke-dasharray", dash);
      return path;
    }
    // Yellow left edge, white right edge, and white skip lines between lanes.
    function drawRoad(sheet, road, shape, layers, className = "") {
      const margin = inchesToPixels(sheet, PAVEMENT_MARGIN_INCHES);
      const band = document.createElementNS(SVG, "path");
      band.setAttribute("class", `roadBand ${className}`);
      band.setAttribute("d", `${pathData([...boundary(shape, 0, -margin), ...boundary(shape, road.lanes, margin).reverse()])}Z`);
      layers.pavement.append(band);
      const lineWidth = inchesToPixels(sheet, LINE_INCHES);
      const skip = `${feetToPixels(sheet, SKIP_STRIPE_FEET)} ${feetToPixels(sheet, SKIP_GAP_FEET)}`;
      const group = document.createElementNS(SVG, "g");
      if (className) group.setAttribute("class", className);
      for (let k = 1; k < road.lanes; k++) group.append(strokePath(boundary(shape, k), WHITE, lineWidth, skip));
      group.append(strokePath(boundary(shape, 0), YELLOW, lineWidth));
      group.append(strokePath(boundary(shape, road.lanes), WHITE, lineWidth));
      layers.markings.append(group);
      if (className === "selected") {
        const ring = band.cloneNode();
        ring.setAttribute("class", "roadSelection");
        layers.selection.append(ring);
      }
    }

    function render() {
      const sheet = sheets.selected;
      let solved = null;
      if (sheet) {
        const layer = layerFor(sheet);
        solved = solve(sheet);
        const layers = Object.fromEntries(["pavement", "markings", "selection"].map(name => {
          const group = document.createElementNS(SVG, "g");
          group.setAttribute("class", `road${name[0].toUpperCase()}${name.slice(1)}`);
          return [name, group];
        }));
        if (sheet.inchesPerPixel) {
          sheet.roads.forEach(road => drawRoad(sheet, road, shapeOf(sheet, road, solved), layers, road === selectedRoad ? "selected" : ""));
          if (drawing?.start && drawing.cursor) {
            drawRoad(sheet, defaults, buildShape(sheet, defaults, [drawing.start, drawing.cursor], new Map()), layers, "preview");
          }
        }
        layer.replaceChildren(layers.pavement, layers.markings, layers.selection);
      }
      drawOverlay(solved);
      updatePanel(solved);
    }
    function changed() {
      render();
      save();
    }

    function place(element, point) {
      const screen = sheets.toScreen(point);
      element.style.left = `${screen.x}px`;
      element.style.top = `${screen.y}px`;
      return screen;
    }
    function nodeButton(key) {
      let button = nodeButtons.get(key);
      if (button) return button;
      const [road, end, lane] = key.split(":").map(Number);
      button = document.createElement("button");
      button.type = "button";
      button.className = "roadNode";
      Object.assign(button.dataset, { road, end, lane });
      button.setAttribute("aria-keyshortcuts", "ArrowLeft ArrowRight ArrowUp ArrowDown");
      bindNode(button);
      nodeButtons.set(key, button);
      overlay.append(button);
      return button;
    }
    // Every lane of every road shows a steering-wheel node at each end.
    function drawOverlay(solved = sheets.selected && solve(sheets.selected)) {
      const sheet = sheets.selected;
      overlay.hidden = !sheet || !active() || !sheet.inchesPerPixel;
      overlay.classList.toggle("drawing", Boolean(drawing));
      const seen = new Set();
      if (!overlay.hidden) {
        for (const road of sheet.roads) {
          for (let lane = 0; lane < road.lanes; lane++) {
            for (const e of [0, 1]) {
              const key = `${road.id}:${e}:${lane}`;
              const button = nodeButton(key);
              seen.add(key);
              button.classList.toggle("selected", road === selectedRoad);
              button.classList.toggle("laneSelected", road === selectedRoad && selectedLane?.e === e && selectedLane.lane === lane);
              button.setAttribute("aria-label", `Road ${road.id}, lane ${lane + 1} ${e ? "end" : "start"}`);
              place(button, nodePoint(sheet, road, e, lane, solved));
            }
          }
        }
      }
      for (const [key, button] of nodeButtons) {
        if (seen.has(key)) continue;
        button.remove();
        nodeButtons.delete(key);
      }
      if (overlay.hidden) return;
      startMarker.hidden = !drawing?.start;
      if (drawing?.start) place(startMarker, drawing.start);
      snapRing.setAttribute("visibility", snapTarget ? "visible" : "hidden");
      if (snapTarget) {
        const at = sheets.toScreen(snapTarget);
        snapRing.setAttribute("cx", at.x);
        snapRing.setAttribute("cy", at.y);
      }
      controlButtons.forEach((button, e) => {
        const handle = selectedRoad && !drawing && openCurves.has(`${selectedRoad.id}:${e}`) ? handlePoint(sheet, selectedRoad, e, solved) : null;
        button.hidden = !handle;
        controlLines[e].setAttribute("visibility", handle ? "visible" : "hidden");
        if (!handle) return;
        const from = sheets.toScreen(handle.from);
        const to = place(button, handle.at);
        controlLines[e].setAttribute("x1", from.x);
        controlLines[e].setAttribute("y1", from.y);
        controlLines[e].setAttribute("x2", to.x);
        controlLines[e].setAttribute("y2", to.y);
      });
    }

    function updatePanel(solved) {
      const sheet = sheets.selected;
      const ready = Boolean(sheet?.inchesPerPixel);
      addButton.disabled = !ready;
      addButton.setAttribute("aria-pressed", String(Boolean(drawing)));
      deleteButton.disabled = !selectedRoad;
      const values = selectedRoad ?? defaults;
      if (document.activeElement !== lanesInput) lanesInput.value = values.lanes;
      if (document.activeElement !== widthInput) widthInput.value = values.laneWidth;
      const lane = selectedRoad && selectedLane?.lane < selectedRoad.lanes ? selectedLane : null;
      laneFields.hidden = !lane || !solved;
      if (!laneFields.hidden) {
        const key = `${lane.e}:${lane.lane}`;
        const setting = selectedRoad.tapers?.[key];
        laneTitle.textContent = `Lane ${lane.lane + 1} ${lane.e ? "end" : "start"}`;
        if (document.activeElement !== taperSelect) taperSelect.value = setting?.mode ?? "auto";
        if (document.activeElement !== taperLength) taperLength.value = setting?.length ?? DEFAULT_TAPER_FEET;
        const tapering = shapeOf(sheet, selectedRoad, solved).tapers.has(key);
        taperState.textContent = !tapering ? "No taper here."
          : lane.e ? "This lane narrows to nothing at its end (lane drop)." : "This lane widens from nothing at its start (lane add).";
      }
      workspace.classList.toggle("drawing", Boolean(drawing));
      workspace.classList.toggle("elementsActive", active());
      if (!sheet) hint.textContent = "Upload a sheet first.";
      else if (!ready) hint.textContent = "Set this sheet's scale first (Sheets › Set Scale) so lanes draw true size.";
      else if (drawing && !drawing.start) hint.textContent = "Click the road's start point, or a lane's end node to continue from it.";
      else if (drawing) hint.textContent = "Click the end point, or a lane's start node to join it. Traffic flows from start to end. Esc cancels.";
      else if (lane) hint.textContent = "Lane end selected. Set its taper below, or drag the node to move the road end.";
      else if (selectedRoad) hint.textContent = "Click a lane node to set its taper. Drag a lane's end node onto another lane's start node to join them. Join opposite roads for a two-way road. Option-drag pulls an end free; double-click a node to curve.";
      else hint.textContent = "Add a one-way road, or click a road to edit it.";
    }

    function selectRoad(road) {
      selectedRoad = road;
      selectedLane = null;
      render();
    }
    function startDrawing() {
      drawing = { start: null, cursor: null };
      selectedRoad = null;
      selectedLane = null;
      render();
    }
    function stopDrawing() {
      drawing = null;
      snapTarget = null;
      render();
    }

    // The nearest lane node within snapping distance that an end of `road` can join:
    // ends join starts, and never a joint the road already uses.
    function snapLane(sheet, solved, point, e, road = null) {
      let best = null;
      let bestDistance = SNAP_PIXELS / sheet.view.scale;
      for (const other of sheet.roads) {
        if (other === road) continue;
        const f = 1 - e;
        if (road && road.ends.some(end => end.joint === other.ends[f].joint)) continue;
        for (let lane = 0; lane < other.lanes; lane++) {
          // Either the lane's true end or its drawn node counts.
          const at = lanePoint(sheet, other, f, lane, solved);
          const shown = nodePoint(sheet, other, f, lane, solved);
          const distance = Math.min(Math.hypot(at.x - point.x, at.y - point.y), Math.hypot(shown.x - point.x, shown.y - point.y));
          if (distance <= bestDistance) {
            best = { road: other, e: f, lane, x: at.x, y: at.y };
            bestDistance = distance;
          }
        }
      }
      return best;
    }
    function insidePolygon(point, polygon) {
      let inside = false;
      for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const a = polygon[i];
        const b = polygon[j];
        if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
      }
      return inside;
    }
    function roadAt(sheet, point) {
      const solved = solve(sheet);
      const slop = 6 / sheet.view.scale;
      for (const road of [...sheet.roads].reverse()) {
        const shape = shapeOf(sheet, road, solved);
        if (insidePolygon(point, [...boundary(shape, 0, -slop), ...boundary(shape, road.lanes, slop).reverse()])) return road;
      }
      return null;
    }

    function newJoint(sheet, point, root, dir = null) {
      const joint = { id: nextId(sheet.joints), x: point.x, y: point.y, dir, root, links: [] };
      sheet.joints.push(joint);
      return joint;
    }
    // Joins lane `lane` at end `e` of `road` to the target lane. The road's end (and
    // anything already joined to it) moves onto the target's joint, turning to its
    // direction so the ends line up. Opposite directions join left edge to left edge.
    function connect(sheet, road, e, lane, target) {
      const host = jointOf(sheet, target.road.ends[target.e].joint);
      const moving = jointOf(sheet, road.ends[e].joint);
      if (host === moving || road.ends[1 - e].joint === host.id) return;
      const solved = solve(sheet);
      const pair = dot(travelAt(road, e, solved), travelAt(target.road, target.e, solved)) < 0;
      host.dir ??= travelAt(target.road, target.e, solved);
      for (const item of attachments(sheet, moving)) {
        item.end.sign = dot(travelAt(item.road, item.e, solved), host.dir) < 0 ? -1 : 1;
        item.end.joint = host.id;
      }
      host.links.push(...moving.links, { a: target.road.id, ai: target.lane, b: road.id, bi: lane, pair });
      sheet.joints.splice(sheet.joints.indexOf(moving), 1);
    }
    // After links or roads leave a joint, each still-linked group keeps its own
    // joint, left where it was.
    function regroup(sheet, joint, before) {
      const here = attachments(sheet, joint);
      if (!here.length) {
        sheet.joints.splice(sheet.joints.indexOf(joint), 1);
        return;
      }
      const remaining = new Map(here.map(item => [item.road.id, item]));
      let first = true;
      while (remaining.size) {
        const rootId = remaining.has(joint.root) ? joint.root : remaining.keys().next().value;
        const group = new Set([rootId]);
        remaining.delete(rootId);
        for (let grew = true; grew;) {
          grew = false;
          for (const { a, b } of joint.links) {
            for (const [from, to] of [[a, b], [b, a]]) {
              if (group.has(from) && remaining.has(to)) {
                group.add(to);
                remaining.delete(to);
                grew = true;
              }
            }
          }
        }
        const rootItem = here.find(item => item.road.id === rootId);
        const at = before.get(`${rootId}:${rootItem.e}`);
        const target = first ? joint : newJoint(sheet, at, rootId, joint.dir && { ...joint.dir });
        Object.assign(target, { x: at.x, y: at.y, root: rootId });
        if (!first) {
          here.filter(item => group.has(item.road.id)).forEach(item => { item.end.joint = target.id; });
          target.links = joint.links.filter(link => group.has(link.a) && group.has(link.b));
          joint.links = joint.links.filter(link => !target.links.includes(link));
        }
        first = false;
      }
    }
    function detach(sheet, road, e) {
      const joint = jointOf(sheet, road.ends[e].joint);
      if (attachments(sheet, joint).length < 2) return;
      const before = solve(sheet);
      const at = before.get(`${road.id}:${e}`);
      joint.links = joint.links.filter(link => link.a !== road.id && link.b !== road.id);
      road.ends[e] = { ...road.ends[e], joint: newJoint(sheet, at, road.id, at.travel).id, sign: 1 };
      regroup(sheet, joint, before);
    }

    function handlePoint(sheet, road, e, solved) {
      const line = centerline(road, solved);
      const from = endOf(line, e);
      const other = endOf(line, 1 - e);
      const travel = solved.get(`${road.id}:${e}`).travel ?? travelAt(road, e, solved);
      const length = road.ends[e].length ?? Math.hypot(other.x - from.x, other.y - from.y) / 3;
      const away = e ? -1 : 1;
      return { from, at: { x: from.x + travel.x * length * away, y: from.y + travel.y * length * away } };
    }

    addButton.addEventListener("click", () => (drawing ? stopDrawing() : startDrawing()));
    deleteButton.addEventListener("click", deleteRoad);
    function deleteRoad() {
      const sheet = sheets.selected;
      if (!sheet?.roads || !selectedRoad) return;
      const before = solve(sheet);
      const road = selectedRoad;
      sheet.roads.splice(sheet.roads.indexOf(road), 1);
      for (const end of road.ends) {
        const joint = jointOf(sheet, end.joint);
        if (!joint) continue;
        joint.links = joint.links.filter(link => link.a !== road.id && link.b !== road.id);
        regroup(sheet, joint, before);
      }
      selectedRoad = null;
      selectedLane = null;
      changed();
    }
    function setTaper(changes) {
      if (!selectedRoad || !selectedLane) return;
      const key = `${selectedLane.e}:${selectedLane.lane}`;
      selectedRoad.tapers ??= {};
      selectedRoad.tapers[key] = { mode: "auto", length: DEFAULT_TAPER_FEET, ...selectedRoad.tapers[key], ...changes };
      changed();
    }
    taperSelect.addEventListener("change", () => setTaper({ mode: taperSelect.value }));
    taperLength.addEventListener("input", () => {
      const feet = Number(taperLength.value);
      if (feet >= MIN_TAPER_FEET && feet <= MAX_TAPER_FEET) setTaper({ length: feet });
    });
    taperLength.addEventListener("change", () => {
      taperLength.value = selectedRoad?.tapers?.[`${selectedLane?.e}:${selectedLane?.lane}`]?.length ?? DEFAULT_TAPER_FEET;
    });
    function bindNumber(input, key, min, max, round) {
      input.addEventListener("input", () => {
        const value = round(Number(input.value));
        if (!(value >= min && value <= max)) return;
        defaults[key] = value;
        if (selectedRoad) {
          selectedRoad[key] = value;
          changed();
        } else render();
      });
      input.addEventListener("change", () => {
        input.value = (selectedRoad ?? defaults)[key];
      });
    }
    bindNumber(lanesInput, "lanes", 1, MAX_LANES, Math.round);
    bindNumber(widthInput, "laneWidth", MIN_LANE_WIDTH, MAX_LANE_WIDTH, value => Math.round(value * 2) / 2);

    // While drawing, points snap to lane nodes so the new road joins them.
    function drawingPoint(sheet, clientX, clientY) {
      const point = sheets.toImage(clientX, clientY);
      snapTarget = snapLane(sheet, solve(sheet), point, drawing.start ? 1 : 0);
      return snapTarget ? { x: snapTarget.x, y: snapTarget.y, target: snapTarget } : point;
    }

    // A click (not a pan) places road points while drawing, otherwise selects a road.
    let press = null;
    workspace.addEventListener("pointerdown", event => {
      if (event.isPrimary) press = { x: event.clientX, y: event.clientY };
    });
    workspace.addEventListener("pointermove", event => {
      const sheet = sheets.selected;
      if (!drawing || event.buttons || !sheet?.inchesPerPixel || !active()) return;
      const point = drawingPoint(sheet, event.clientX, event.clientY);
      if (drawing.start) drawing.cursor = point;
      render();
    });
    workspace.addEventListener("click", event => {
      const sheet = sheets.selected;
      if (!active() || !sheet?.inchesPerPixel || !press || event.target.closest(".roadNode, .roadControl")) return;
      if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > 4) return;
      if (!drawing) return selectRoad(roadAt(sheet, sheets.toImage(event.clientX, event.clientY)));
      layerFor(sheet);
      const point = drawingPoint(sheet, event.clientX, event.clientY);
      if (!drawing.start) {
        drawing.start = point;
        drawing.cursor = point;
        return render();
      }
      const start = drawing.start;
      if (Math.hypot(point.x - start.x, point.y - start.y) * sheet.view.scale < 4) return;
      const road = { id: nextId(sheet.roads), lanes: defaults.lanes, laneWidth: defaults.laneWidth, ends: [] };
      road.ends = [start, point].map(p => ({ joint: newJoint(sheet, p, road.id).id, sign: 1, length: null }));
      sheet.roads.push(road);
      // A new road lines its matching lane up with the lane it was drawn from or to.
      [start, point].forEach((p, e) => {
        if (p.target) connect(sheet, road, e, Math.min(p.target.lane, road.lanes - 1), p.target);
      });
      drawing = null;
      snapTarget = null;
      selectedRoad = road;
      changed();
    });
    // Quick clicks while drawing must not trigger the double-click refit.
    workspace.addEventListener("dblclick", event => { if (drawing) event.preventDefault(); }, true);

    // Lane nodes: dragging moves the road's whole end (and everything joined to it);
    // dropping onto another lane's node joins them.
    function nudgeKeys(button, move) {
      button.addEventListener("keydown", event => {
        const moves = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
        if (!moves[event.key] || !sheets.selected) return;
        event.preventDefault();
        event.stopPropagation();
        const step = (event.shiftKey ? 10 : 1) / sheets.selected.view.scale;
        if (move(moves[event.key][0] * step, moves[event.key][1] * step) !== false) changed();
      });
    }
    function nodeTarget(button) {
      const sheet = sheets.selected;
      const road = sheet && roadOf(sheet, Number(button.dataset.road));
      return road && { sheet, road, e: Number(button.dataset.end), lane: Number(button.dataset.lane) };
    }
    function bindNode(button) {
      button.addEventListener("pointerdown", event => {
        const node = nodeTarget(button);
        if (!node || drawing) return;
        event.stopPropagation();
        button.setPointerCapture(event.pointerId);
        selectedRoad = node.road;
        selectedLane = { e: node.e, lane: node.lane };
        // Option/Alt-drag gives this road's end its own joint, pulling it free.
        if (event.altKey) detach(node.sheet, node.road, node.e);
        const solved = solve(node.sheet);
        drag = { ...node, from: lanePoint(node.sheet, node.road, node.e, node.lane, solved), pointer: sheets.toImage(event.clientX, event.clientY) };
        render();
      });
      button.addEventListener("pointermove", event => {
        if (!drag || !button.hasPointerCapture(event.pointerId)) return;
        const { sheet, road, e, lane } = drag;
        const pointer = sheets.toImage(event.clientX, event.clientY);
        const wanted = { x: drag.from.x + pointer.x - drag.pointer.x, y: drag.from.y + pointer.y - drag.pointer.y };
        const solved = solve(sheet);
        snapTarget = snapLane(sheet, solved, wanted, e, road);
        const goal = snapTarget ?? wanted;
        const current = lanePoint(sheet, road, e, lane, solved);
        const joint = jointOf(sheet, road.ends[e].joint);
        joint.x += goal.x - current.x;
        joint.y += goal.y - current.y;
        render();
      });
      const finish = event => {
        if (!drag || !button.hasPointerCapture(event.pointerId)) return;
        button.releasePointerCapture(event.pointerId);
        if (snapTarget && event.type === "pointerup") connect(drag.sheet, drag.road, drag.e, drag.lane, snapTarget);
        drag = null;
        snapTarget = null;
        changed();
      };
      button.addEventListener("pointerup", finish);
      button.addEventListener("pointercancel", finish);
      nudgeKeys(button, (dx, dy) => {
        const node = nodeTarget(button);
        if (!node) return false;
        selectedRoad = node.road;
        const joint = jointOf(node.sheet, node.road.ends[node.e].joint);
        joint.x += dx;
        joint.y += dy;
      });
      // Double-clicking a node shows or hides the curve handle at that end.
      button.addEventListener("dblclick", () => {
        const node = nodeTarget(button);
        if (!node) return;
        const key = `${node.road.id}:${node.e}`;
        if (openCurves.delete(key)) return render();
        openCurves.add(key);
        const solved = solve(node.sheet);
        const joint = jointOf(node.sheet, node.road.ends[node.e].joint);
        const handle = handlePoint(node.sheet, node.road, node.e, solved);
        joint.dir ??= travelAt(node.road, node.e, solved);
        node.road.ends[node.e].length ??= Math.hypot(handle.at.x - handle.from.x, handle.at.y - handle.from.y);
        changed();
      });
    }

    // Curve handles turn the joint, so every road joined there stays lined up.
    function moveHandle(e, to) {
      const sheet = sheets.selected;
      const road = selectedRoad;
      const { from } = handlePoint(sheet, road, e, solve(sheet));
      const away = { x: to.x - from.x, y: to.y - from.y };
      const length = Math.hypot(away.x, away.y);
      if (length < 1) return;
      const travel = unit(e ? { x: -away.x, y: -away.y } : away);
      const end = road.ends[e];
      jointOf(sheet, end.joint).dir = { x: travel.x * end.sign, y: travel.y * end.sign };
      end.length = length;
      const pair = pairOf(sheet, road);
      if (pair) pair.ends[1 - e].length = length;
    }
    controlButtons.forEach((button, e) => {
      button.addEventListener("pointerdown", event => {
        if (!selectedRoad) return;
        event.stopPropagation();
        button.setPointerCapture(event.pointerId);
      });
      button.addEventListener("pointermove", event => {
        if (!button.hasPointerCapture(event.pointerId) || !selectedRoad) return;
        moveHandle(e, sheets.toImage(event.clientX, event.clientY));
        render();
      });
      button.addEventListener("pointerup", event => {
        if (!button.hasPointerCapture(event.pointerId)) return;
        button.releasePointerCapture(event.pointerId);
        changed();
      });
      nudgeKeys(button, (dx, dy) => {
        if (!selectedRoad) return false;
        const { at } = handlePoint(sheets.selected, selectedRoad, e, solve(sheets.selected));
        moveHandle(e, { x: at.x + dx, y: at.y + dy });
      });
      // Double-clicking a handle returns that end to its default pull; a free end
      // goes straight again.
      button.addEventListener("dblclick", () => {
        const sheet = sheets.selected;
        if (!selectedRoad) return;
        const end = selectedRoad.ends[e];
        const joint = jointOf(sheet, end.joint);
        end.length = null;
        if (attachments(sheet, joint).length === 1) joint.dir = null;
        openCurves.delete(`${selectedRoad.id}:${e}`);
        changed();
      });
    });

    window.addEventListener("keydown", event => {
      if (!active() || document.querySelector("dialog[open]")) return;
      const typing = event.target.closest?.("input, select, textarea");
      if (event.key === "Escape" && (drawing || selectedRoad)) {
        event.stopPropagation();
        drawing ? stopDrawing() : selectRoad(null);
      } else if ((event.key === "Delete" || event.key === "Backspace") && selectedRoad && !typing) {
        event.preventDefault();
        deleteRoad();
      }
    }, true);

    new MutationObserver(() => {
      if (!active()) {
        drawing = null;
        snapTarget = null;
      }
      render();
    }).observe(editor, { attributes: true, attributeFilter: ["hidden"] });
    document.addEventListener("sheetview", () => { if (active()) drawOverlay(); });
    document.addEventListener("sheetchange", () => {
      if (!sheets.selected?.roads?.includes(selectedRoad)) {
        selectedRoad = null;
        selectedLane = null;
      }
      drawing = null;
      snapTarget = null;
      render();
    });
    render();
  });
})();
