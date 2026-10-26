(() => {
  // Roads are one-way lines between two nodes, stored in sheet image pixels. Nodes
  // are shared, so roads joined at a node move together. Two roads joining the
  // same nodes in opposite directions form a two-way road. Lane widths are in feet
  // and drawn true size from the sheet's inches per pixel.
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
  const SNAP_PIXELS = 12;
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
    const defaults = { lanes: 1, laneWidth: 12 };
    const openCurves = new Set();
    let selectedRoad = null;
    let drawing = null;
    let snapTarget = null;

    const overlay = document.createElement("div");
    overlay.className = "roadOverlay";
    overlay.hidden = true;
    overlay.innerHTML = `<svg aria-hidden="true"><line class="roadControlLine"/><line class="roadControlLine"/><circle class="roadSnap" r="14"/></svg>
      <button type="button" class="roadNode" aria-label="Road start point" aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown"></button>
      <button type="button" class="roadNode" aria-label="Road end point" aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown"></button>
      <button type="button" class="roadControl" aria-label="Start curve handle" aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown"></button>
      <button type="button" class="roadControl" aria-label="End curve handle" aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown"></button>`;
    const controlLines = [...overlay.querySelectorAll("line")];
    const snapRing = overlay.querySelector(".roadSnap");
    const nodeButtons = [...overlay.querySelectorAll(".roadNode")];
    const controlButtons = [...overlay.querySelectorAll(".roadControl")];
    sheets.addOverlay(overlay);

    const active = () => !editor.hidden;
    const inchesToPixels = (sheet, inches) => inches / sheet.inchesPerPixel;
    const feetToPixels = (sheet, feet) => inchesToPixels(sheet, feet * 12);
    const nextId = items => items.reduce((max, item) => Math.max(max, item.id), 0) + 1;
    const nodeOf = (sheet, id) => sheet.nodes.find(node => node.id === id);
    const roadsAt = (sheet, id) => sheet.roads.filter(road => road.nodes.includes(id));
    const pairOf = (sheet, road) => sheet.roads.find(other => other !== road
      && other.nodes[0] === road.nodes[1] && other.nodes[1] === road.nodes[0]);

    function save() {
      if (sheets.selected) sheets.save(sheets.selected);
    }
    function layerFor(sheet) {
      sheet.roads ??= [];
      sheet.nodes ??= [];
      if (!sheet.roadLayer) {
        sheet.roadLayer = document.createElementNS(SVG, "svg");
        sheet.roadLayer.classList.add("roadLayer");
        sheet.roadLayer.setAttribute("viewBox", `0 0 ${sheet.width} ${sheet.height}`);
        sheet.roadLayer.setAttribute("aria-hidden", "true");
        sheet.content.append(sheet.roadLayer);
      }
      return sheet.roadLayer;
    }

    // Each end's Bézier handle is stored relative to its node, pointing along the
    // road; an end without a handle pulls straight.
    function centerline(a, b, handles) {
      if (!handles[0] && !handles[1]) return [{ x: a.x, y: a.y }, { x: b.x, y: b.y }];
      const c0 = { x: a.x + (handles[0]?.x ?? 0), y: a.y + (handles[0]?.y ?? 0) };
      const c1 = { x: b.x + (handles[1]?.x ?? 0), y: b.y + (handles[1]?.y ?? 0) };
      const points = [];
      for (let i = 0; i <= CURVE_SEGMENTS; i++) {
        const t = i / CURVE_SEGMENTS;
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
        const prev = points[Math.max(0, i - 1)];
        const next = points[Math.min(points.length - 1, i + 1)];
        const dx = next.x - prev.x;
        const dy = next.y - prev.y;
        const length = Math.hypot(dx, dy) || 1;
        return { x: point.x - dy / length * distance, y: point.y + dx / length * distance };
      });
    }
    const pathData = points => `M${points.map(p => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join("L")}`;

    // A one-way road is centered on its line. Half of a two-way road sits to the
    // right of the shared line, with its yellow line forming half of the double
    // yellow centerline.
    function geometry(sheet, road) {
      const line = centerline(nodeOf(sheet, road.nodes[0]), nodeOf(sheet, road.nodes[1]), road.handles);
      const width = road.lanes * feetToPixels(sheet, road.laneWidth);
      const twoWay = Boolean(pairOf(sheet, road));
      const left = twoWay ? 0 : -width / 2;
      const margin = inchesToPixels(sheet, PAVEMENT_MARGIN_INCHES);
      return {
        line, left, right: left + width, twoWay,
        outline: [...offset(line, twoWay ? 0 : left - margin), ...offset(line, left + width + margin).reverse()],
      };
    }
    function strokePath(points, color, width, dash) {
      const path = document.createElementNS(SVG, "path");
      path.setAttribute("class", "roadMarking");
      path.setAttribute("d", pathData(points));
      path.setAttribute("stroke", color);
      path.setAttribute("stroke-width", width);
      if (dash) path.setAttribute("stroke-dasharray", dash);
      return path;
    }
    function drawRoad(sheet, road, layers, className = "") {
      const { line, left, right, twoWay, outline } = geometry(sheet, road);
      const band = document.createElementNS(SVG, "path");
      band.setAttribute("class", `roadBand ${className}`);
      band.setAttribute("d", `${pathData(outline)}Z`);
      layers.pavement.append(band);
      const lineWidth = inchesToPixels(sheet, LINE_INCHES);
      const yellowAt = twoWay ? inchesToPixels(sheet, DOUBLE_GAP_INCHES + LINE_INCHES) / 2 : left;
      const laneWidth = feetToPixels(sheet, road.laneWidth);
      const skip = `${feetToPixels(sheet, SKIP_STRIPE_FEET)} ${feetToPixels(sheet, SKIP_GAP_FEET)}`;
      const group = document.createElementNS(SVG, "g");
      if (className) group.setAttribute("class", className);
      for (let i = 1; i < road.lanes; i++) group.append(strokePath(offset(line, left + i * laneWidth), WHITE, lineWidth, skip));
      group.append(strokePath(offset(line, yellowAt), YELLOW, lineWidth));
      group.append(strokePath(offset(line, right), WHITE, lineWidth));
      layers.markings.append(group);
      if (className === "selected") {
        const ring = band.cloneNode();
        ring.setAttribute("class", "roadSelection");
        layers.selection.append(ring);
      }
    }

    function render() {
      const sheet = sheets.selected;
      if (sheet) {
        const layer = layerFor(sheet);
        const layers = Object.fromEntries(["pavement", "markings", "selection"].map(name => {
          const group = document.createElementNS(SVG, "g");
          group.setAttribute("class", `road${name[0].toUpperCase()}${name.slice(1)}`);
          return [name, group];
        }));
        if (sheet.inchesPerPixel) {
          sheet.roads.forEach(road => drawRoad(sheet, road, layers, road === selectedRoad ? "selected" : ""));
          if (drawing?.start && drawing.cursor) {
            const ghost = { ...sheet, nodes: [{ ...drawing.start, id: -1 }, { ...drawing.cursor, id: -2 }], roads: [] };
            drawRoad(ghost, { ...defaults, nodes: [-1, -2], handles: [null, null] }, layers, "preview");
          }
        }
        layer.replaceChildren(layers.pavement, layers.markings, layers.selection);
      }
      drawOverlay();
      updatePanel();
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
    function drawOverlay() {
      const sheet = sheets.selected;
      const road = active() && !drawing ? selectedRoad : null;
      overlay.hidden = !sheet || !(road || drawing?.start || snapTarget);
      if (overlay.hidden) return;
      snapRing.setAttribute("visibility", snapTarget ? "visible" : "hidden");
      if (snapTarget) {
        const at = sheets.toScreen(snapTarget);
        snapRing.setAttribute("cx", at.x);
        snapRing.setAttribute("cy", at.y);
      }
      const nodes = road ? road.nodes.map(id => nodeOf(sheet, id)) : [drawing?.start];
      nodeButtons.forEach((button, i) => {
        const node = nodes[i];
        const handle = road && openCurves.has(`${road.id}:${i}`) ? road.handles[i] : null;
        button.hidden = !node;
        button.classList.toggle("preview", !road);
        controlButtons[i].hidden = !handle;
        controlLines[i].setAttribute("visibility", handle ? "visible" : "hidden");
        if (!node) return;
        const from = place(button, node);
        if (!handle) return;
        const to = place(controlButtons[i], { x: node.x + handle.x, y: node.y + handle.y });
        controlLines[i].setAttribute("x1", from.x);
        controlLines[i].setAttribute("y1", from.y);
        controlLines[i].setAttribute("x2", to.x);
        controlLines[i].setAttribute("y2", to.y);
      });
    }

    function updatePanel() {
      const sheet = sheets.selected;
      const ready = Boolean(sheet?.inchesPerPixel);
      addButton.disabled = !ready;
      addButton.setAttribute("aria-pressed", String(Boolean(drawing)));
      deleteButton.disabled = !selectedRoad;
      const values = selectedRoad ?? defaults;
      if (document.activeElement !== lanesInput) lanesInput.value = values.lanes;
      if (document.activeElement !== widthInput) widthInput.value = values.laneWidth;
      workspace.classList.toggle("drawing", Boolean(drawing));
      workspace.classList.toggle("elementsActive", active());
      if (!sheet) hint.textContent = "Upload a sheet first.";
      else if (!ready) hint.textContent = "Set this sheet's scale first (Sheets › Set Scale) so lanes draw true size.";
      else if (drawing && !drawing.start) hint.textContent = "Click the road's start point. Click an existing point to connect to it.";
      else if (drawing) hint.textContent = "Click the end point. Traffic flows from start to end. Esc cancels.";
      else if (selectedRoad) hint.textContent = "Drag a yellow point onto another road's point to connect them; Option-drag pulls this road's end free. Double-click a point to curve the road.";
      else hint.textContent = "Add a one-way road, or click a road to edit it. For a two-way road, draw a second road from one road's end back to its start.";
    }

    function selectRoad(road) {
      selectedRoad = road;
      render();
    }
    function startDrawing() {
      drawing = { start: null, cursor: null };
      selectedRoad = null;
      render();
    }
    function stopDrawing() {
      drawing = null;
      snapTarget = null;
      render();
    }

    // The nearest node within snapping distance, skipping the given node ids.
    function snapNode(sheet, point, skip = []) {
      let best = null;
      let bestDistance = SNAP_PIXELS / sheet.view.scale;
      for (const node of sheet.nodes) {
        const distance = Math.hypot(node.x - point.x, node.y - point.y);
        if (distance <= bestDistance && !skip.includes(node.id)) {
          best = node;
          bestDistance = distance;
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
      const slop = 6 / sheet.view.scale;
      for (const road of [...sheet.roads].reverse()) {
        const { line, left, right, twoWay } = geometry(sheet, road);
        const polygon = [...offset(line, (twoWay ? 0 : left) - slop), ...offset(line, right + slop).reverse()];
        if (insidePolygon(point, polygon)) return road;
      }
      return null;
    }

    // Two halves of a two-way road share one curve; other roads continuing
    // through a node keep a smooth tangent.
    function shareHandle(sheet, road, end) {
      const nodeId = road.nodes[end];
      const vector = road.handles[end];
      const pair = pairOf(sheet, road);
      if (pair) pair.handles[1 - end] = vector && { ...vector };
      if (!vector) return;
      const node = nodeOf(sheet, nodeId);
      for (const other of roadsAt(sheet, nodeId)) {
        if (other === road || other === pair) continue;
        const index = other.nodes.indexOf(nodeId);
        const far = nodeOf(sheet, other.nodes[1 - index]);
        const away = other.handles[index] ?? { x: far.x - node.x, y: far.y - node.y };
        const length = Math.hypot(away.x, away.y);
        const cos = (away.x * vector.x + away.y * vector.y) / (length * Math.hypot(vector.x, vector.y) || 1);
        if (Math.abs(cos) < 0.7) continue;
        const scale = Math.sign(cos) * (other.handles[index] ? length : Math.hypot(vector.x, vector.y)) / Math.hypot(vector.x, vector.y);
        other.handles[index] = { x: vector.x * scale, y: vector.y * scale };
        const otherPair = pairOf(sheet, other);
        if (otherPair) otherPair.handles[1 - index] = { ...other.handles[index] };
      }
    }
    // A road drawn or connected as the opposite half of another adopts its curve.
    function adoptPairCurve(sheet, road) {
      const pair = pairOf(sheet, road);
      if (pair) road.handles = [pair.handles[1] && { ...pair.handles[1] }, pair.handles[0] && { ...pair.handles[0] }];
    }
    function dropUnusedNodes(sheet) {
      sheet.nodes = sheet.nodes.filter(node => sheet.roads.some(road => road.nodes.includes(node.id)));
    }
    function nodeFor(sheet, point) {
      if (point.id) return point.id;
      const node = { id: nextId(sheet.nodes), x: point.x, y: point.y };
      sheet.nodes.push(node);
      return node.id;
    }

    addButton.addEventListener("click", () => (drawing ? stopDrawing() : startDrawing()));
    deleteButton.addEventListener("click", deleteRoad);
    function deleteRoad() {
      const sheet = sheets.selected;
      if (!sheet?.roads || !selectedRoad) return;
      sheet.roads.splice(sheet.roads.indexOf(selectedRoad), 1);
      dropUnusedNodes(sheet);
      selectedRoad = null;
      changed();
    }
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

    // While drawing, points snap to existing nodes so the new road connects.
    function drawingPoint(sheet, clientX, clientY, skip) {
      const point = sheets.toImage(clientX, clientY);
      const node = snapNode(sheet, point, skip);
      snapTarget = node;
      return node ? { id: node.id, x: node.x, y: node.y } : point;
    }

    // A click (not a pan) places road points while drawing, otherwise selects a road.
    let press = null;
    workspace.addEventListener("pointerdown", event => {
      if (event.isPrimary) press = { x: event.clientX, y: event.clientY };
    });
    workspace.addEventListener("pointermove", event => {
      const sheet = sheets.selected;
      if (!drawing || event.buttons || !sheet?.inchesPerPixel) return;
      const point = drawingPoint(sheet, event.clientX, event.clientY, drawing.start?.id ? [drawing.start.id] : []);
      if (drawing.start) drawing.cursor = point;
      render();
    });
    workspace.addEventListener("click", event => {
      const sheet = sheets.selected;
      if (!active() || !sheet?.inchesPerPixel || !press || event.target.closest(".roadNode, .roadControl")) return;
      if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > 4) return;
      if (!drawing) return selectRoad(roadAt(sheet, sheets.toImage(event.clientX, event.clientY)));
      layerFor(sheet);
      const point = drawingPoint(sheet, event.clientX, event.clientY, drawing.start?.id ? [drawing.start.id] : []);
      if (!drawing.start) {
        drawing.start = point;
        drawing.cursor = point;
        return render();
      }
      if (Math.hypot(point.x - drawing.start.x, point.y - drawing.start.y) * sheet.view.scale < 4) return;
      const road = {
        id: nextId(sheet.roads), lanes: defaults.lanes, laneWidth: defaults.laneWidth,
        nodes: [nodeFor(sheet, drawing.start), nodeFor(sheet, point)], handles: [null, null],
      };
      sheet.roads.push(road);
      adoptPairCurve(sheet, road);
      drawing = null;
      snapTarget = null;
      selectedRoad = road;
      changed();
    });
    // Quick clicks while drawing must not trigger the double-click refit.
    workspace.addEventListener("dblclick", event => { if (drawing) event.preventDefault(); }, true);

    // Node and curve handles: drag, arrow-key nudges, and double-clicks.
    function bindHandle(button, { start = () => {}, move, end = () => {} }) {
      button.addEventListener("pointerdown", event => {
        if (!selectedRoad) return;
        event.stopPropagation();
        button.setPointerCapture(event.pointerId);
        start(event);
      });
      button.addEventListener("pointermove", event => {
        if (!button.hasPointerCapture(event.pointerId) || !selectedRoad) return;
        move(sheets.toImage(event.clientX, event.clientY));
        render();
      });
      const finish = event => {
        if (!button.hasPointerCapture(event.pointerId) || !selectedRoad) return;
        button.releasePointerCapture(event.pointerId);
        end();
        changed();
      };
      button.addEventListener("pointerup", finish);
      button.addEventListener("pointercancel", finish);
      button.addEventListener("keydown", event => {
        const moves = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
        if (!moves[event.key] || !selectedRoad) return;
        event.preventDefault();
        event.stopPropagation();
        const step = (event.shiftKey ? 10 : 1) / sheets.selected.view.scale;
        move(null, moves[event.key][0] * step, moves[event.key][1] * step);
        changed();
      });
    }
    nodeButtons.forEach((button, i) => {
      bindHandle(button, {
        // Option/Alt-drag gives this road's end its own node, pulling it free.
        start(event) {
          const sheet = sheets.selected;
          const id = selectedRoad.nodes[i];
          if (!event.altKey || roadsAt(sheet, id).length < 2) return;
          const node = nodeOf(sheet, id);
          selectedRoad.nodes[i] = nodeFor(sheet, { x: node.x, y: node.y });
        },
        move(to, dx, dy) {
          const sheet = sheets.selected;
          const node = nodeOf(sheet, selectedRoad.nodes[i]);
          if (to) {
            // Never snap onto a node that would make a connected road zero-length.
            const linked = roadsAt(sheet, node.id).flatMap(road => road.nodes);
            snapTarget = snapNode(sheet, to, linked);
            node.x = snapTarget?.x ?? to.x;
            node.y = snapTarget?.y ?? to.y;
          } else {
            node.x += dx;
            node.y += dy;
          }
        },
        // Dropping onto another node connects: every road here moves to that node.
        end() {
          const sheet = sheets.selected;
          const target = snapTarget;
          snapTarget = null;
          if (!target) return;
          const from = selectedRoad.nodes[i];
          sheet.roads.forEach(road => { road.nodes = road.nodes.map(id => (id === from ? target.id : id)); });
          dropUnusedNodes(sheet);
          adoptPairCurve(sheet, selectedRoad);
        },
      });
      // Double-clicking a node shows or hides its Bézier handle.
      button.addEventListener("dblclick", () => {
        const sheet = sheets.selected;
        if (!selectedRoad) return;
        const key = `${selectedRoad.id}:${i}`;
        if (openCurves.delete(key)) return render();
        openCurves.add(key);
        if (!selectedRoad.handles[i]) {
          const node = nodeOf(sheet, selectedRoad.nodes[i]);
          const other = nodeOf(sheet, selectedRoad.nodes[1 - i]);
          selectedRoad.handles[i] = { x: (other.x - node.x) / 3, y: (other.y - node.y) / 3 };
          shareHandle(sheet, selectedRoad, i);
        }
        changed();
      });
    });
    controlButtons.forEach((button, i) => {
      bindHandle(button, {
        move(to, dx, dy) {
          const sheet = sheets.selected;
          const handle = selectedRoad.handles[i];
          const node = nodeOf(sheet, selectedRoad.nodes[i]);
          handle.x = to ? to.x - node.x : handle.x + dx;
          handle.y = to ? to.y - node.y : handle.y + dy;
          shareHandle(sheet, selectedRoad, i);
        },
      });
      // Double-clicking a handle straightens that end again.
      button.addEventListener("dblclick", () => {
        if (!selectedRoad) return;
        selectedRoad.handles[i] = null;
        shareHandle(sheets.selected, selectedRoad, i);
        openCurves.delete(`${selectedRoad.id}:${i}`);
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
    document.addEventListener("sheetview", drawOverlay);
    document.addEventListener("sheetchange", () => {
      if (!sheets.selected?.roads?.includes(selectedRoad)) selectedRoad = null;
      drawing = null;
      snapTarget = null;
      render();
    });
    render();
  });
})();
