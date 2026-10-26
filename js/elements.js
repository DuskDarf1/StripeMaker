(() => {
  // Roads are one-way lines between two nodes, stored in sheet image pixels. Lane
  // widths are in feet and drawn true size from the sheet's inches per pixel.
  // Lane lines follow FDOT Standard Plans Index 711-001: 6 in white skip, 10 ft
  // stripe / 30 ft gap.
  const LANE_LINE_INCHES = 6;
  const SKIP_STRIPE_FEET = 10;
  const SKIP_GAP_FEET = 30;
  const MAX_LANES = 8;
  const MIN_LANE_WIDTH = 8;
  const MAX_LANE_WIDTH = 20;
  const CURVE_SEGMENTS = 96;
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
    let selectedRoad = null;
    let drawing = null;
    let nextId = 1;

    const overlay = document.createElement("div");
    overlay.className = "roadOverlay";
    overlay.hidden = true;
    overlay.innerHTML = `<svg aria-hidden="true"><line class="roadControlLine"/><line class="roadControlLine"/></svg>
      <button type="button" class="roadNode" aria-label="Road start point" aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown"></button>
      <button type="button" class="roadNode" aria-label="Road end point" aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown"></button>
      <button type="button" class="roadControl" aria-label="Start curve handle" aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown"></button>
      <button type="button" class="roadControl" aria-label="End curve handle" aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown"></button>`;
    const controlLines = [...overlay.querySelectorAll("line")];
    const nodeButtons = [...overlay.querySelectorAll(".roadNode")];
    const controlButtons = [...overlay.querySelectorAll(".roadControl")];
    sheets.addOverlay(overlay);

    const active = () => !editor.hidden;
    const feetToPixels = (sheet, feet) => feet * 12 / sheet.inchesPerPixel;

    function layerFor(sheet) {
      if (!sheet.roadLayer) {
        sheet.roads = [];
        sheet.roadLayer = document.createElementNS(SVG, "svg");
        sheet.roadLayer.classList.add("roadLayer");
        sheet.roadLayer.setAttribute("viewBox", `0 0 ${sheet.width} ${sheet.height}`);
        sheet.roadLayer.setAttribute("aria-hidden", "true");
        sheet.content.append(sheet.roadLayer);
      }
      return sheet.roadLayer;
    }

    // A cubic Bézier between the nodes; a node without a handle pulls straight.
    function centerline(road) {
      const [a, b] = road.nodes;
      if (!a.handle && !b.handle) return [{ x: a.x, y: a.y }, { x: b.x, y: b.y }];
      const c0 = a.handle ?? a;
      const c1 = b.handle ?? b;
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

    function roadElement(sheet, road, className) {
      const group = document.createElementNS(SVG, "g");
      const line = centerline(road);
      const laneWidth = feetToPixels(sheet, road.laneWidth);
      const half = road.lanes * laneWidth / 2;
      const band = document.createElementNS(SVG, "path");
      band.setAttribute("class", `roadBand ${className}`);
      band.setAttribute("d", `${pathData([...offset(line, -half), ...offset(line, half).reverse()])}Z`);
      group.append(band);
      for (let i = 1; i < road.lanes; i++) {
        const laneLine = document.createElementNS(SVG, "path");
        laneLine.setAttribute("class", "laneLine");
        laneLine.setAttribute("d", pathData(offset(line, i * laneWidth - half)));
        laneLine.setAttribute("stroke-width", LANE_LINE_INCHES / sheet.inchesPerPixel);
        laneLine.setAttribute("stroke-dasharray", `${feetToPixels(sheet, SKIP_STRIPE_FEET)} ${feetToPixels(sheet, SKIP_GAP_FEET)}`);
        group.append(laneLine);
      }
      return group;
    }

    function render() {
      const sheet = sheets.selected;
      if (sheet) {
        const layer = layerFor(sheet);
        const elements = sheet.inchesPerPixel
          ? sheet.roads.map(road => roadElement(sheet, road, road === selectedRoad ? "selected" : "")) : [];
        if (drawing?.start && drawing.cursor && sheet.inchesPerPixel) {
          const preview = { ...defaults, nodes: [drawing.start, drawing.cursor] };
          elements.push(roadElement(sheet, preview, "preview"));
        }
        layer.replaceChildren(...elements);
      }
      drawOverlay();
      updatePanel();
    }

    function place(element, point) {
      const screen = sheets.toScreen(point);
      element.style.left = `${screen.x}px`;
      element.style.top = `${screen.y}px`;
      return screen;
    }
    function drawOverlay() {
      const road = active() && !drawing ? selectedRoad : null;
      overlay.hidden = !sheets.selected || !(road || drawing?.start);
      if (overlay.hidden) return;
      const nodes = road ? road.nodes : [drawing.start];
      nodeButtons.forEach((button, i) => {
        const node = nodes[i];
        const control = road && node.curve ? node.handle : null;
        button.hidden = !node;
        button.classList.toggle("preview", !road);
        controlButtons[i].hidden = !control;
        controlLines[i].setAttribute("visibility", control ? "visible" : "hidden");
        if (!node) return;
        const from = place(button, node);
        if (!control) return;
        const to = place(controlButtons[i], control);
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
      else if (drawing && !drawing.start) hint.textContent = "Click the road's start point.";
      else if (drawing) hint.textContent = "Click the end point. Traffic flows from start to end. Esc cancels.";
      else if (selectedRoad) hint.textContent = "Drag the yellow points to move the ends. Double-click a point to curve the road.";
      else hint.textContent = "Add a one-way road, or click a road to edit it. Lane settings apply to the next road.";
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
      render();
    }

    function segmentDistance(p, a, b) {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
      return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
    }
    function roadAt(sheet, point) {
      for (const road of [...sheet.roads].reverse()) {
        const reach = road.lanes * feetToPixels(sheet, road.laneWidth) / 2 + 6 / sheet.view.scale;
        const line = centerline(road);
        for (let i = 1; i < line.length; i++) {
          if (segmentDistance(point, line[i - 1], line[i]) <= reach) return road;
        }
      }
      return null;
    }

    addButton.addEventListener("click", () => (drawing ? stopDrawing() : startDrawing()));
    deleteButton.addEventListener("click", deleteRoad);
    function deleteRoad() {
      const roads = sheets.selected?.roads;
      if (!roads || !selectedRoad) return;
      roads.splice(roads.indexOf(selectedRoad), 1);
      selectRoad(null);
    }
    function bindNumber(input, key, min, max, round) {
      input.addEventListener("input", () => {
        const value = round(Number(input.value));
        if (!(value >= min && value <= max)) return;
        defaults[key] = value;
        if (selectedRoad) selectedRoad[key] = value;
        render();
      });
      input.addEventListener("change", () => {
        input.value = (selectedRoad ?? defaults)[key];
      });
    }
    bindNumber(lanesInput, "lanes", 1, MAX_LANES, Math.round);
    bindNumber(widthInput, "laneWidth", MIN_LANE_WIDTH, MAX_LANE_WIDTH, value => Math.round(value * 2) / 2);

    // A click (not a pan) places road points while drawing, otherwise selects a road.
    let press = null;
    workspace.addEventListener("pointerdown", event => {
      if (event.isPrimary) press = { x: event.clientX, y: event.clientY };
    });
    workspace.addEventListener("pointermove", event => {
      if (!drawing?.start || event.buttons || !sheets.selected) return;
      drawing.cursor = sheets.toImage(event.clientX, event.clientY);
      render();
    });
    workspace.addEventListener("click", event => {
      const sheet = sheets.selected;
      if (!active() || !sheet?.inchesPerPixel || !press || event.target.closest(".roadNode, .roadControl")) return;
      if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > 4) return;
      const point = sheets.toImage(event.clientX, event.clientY);
      if (!drawing) return selectRoad(roadAt(sheet, point));
      if (!drawing.start) {
        drawing.start = point;
        drawing.cursor = point;
        return render();
      }
      if (Math.hypot(point.x - drawing.start.x, point.y - drawing.start.y) * sheet.view.scale < 4) return;
      const road = {
        id: nextId++, lanes: defaults.lanes, laneWidth: defaults.laneWidth,
        nodes: [{ ...drawing.start, handle: null, curve: false }, { ...point, handle: null, curve: false }],
      };
      sheet.roads.push(road);
      drawing = null;
      selectRoad(road);
    });
    // Quick clicks while drawing must not trigger the double-click refit.
    workspace.addEventListener("dblclick", event => { if (drawing) event.preventDefault(); }, true);

    // Node and curve handles: drag, arrow-key nudges, and double-clicks.
    function bindHandle(button, move) {
      button.addEventListener("pointerdown", event => {
        if (!selectedRoad) return;
        event.stopPropagation();
        button.setPointerCapture(event.pointerId);
      });
      button.addEventListener("pointermove", event => {
        if (!button.hasPointerCapture(event.pointerId) || !selectedRoad) return;
        move(sheets.toImage(event.clientX, event.clientY));
        render();
      });
      button.addEventListener("keydown", event => {
        const moves = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
        if (!moves[event.key] || !selectedRoad) return;
        event.preventDefault();
        event.stopPropagation();
        const step = (event.shiftKey ? 10 : 1) / sheets.selected.view.scale;
        move(null, moves[event.key][0] * step, moves[event.key][1] * step);
        render();
      });
    }
    nodeButtons.forEach((button, i) => {
      bindHandle(button, (to, dx = to.x - selectedRoad.nodes[i].x, dy = to.y - selectedRoad.nodes[i].y) => {
        const node = selectedRoad.nodes[i];
        node.x += dx;
        node.y += dy;
        if (node.handle) {
          node.handle.x += dx;
          node.handle.y += dy;
        }
      });
      // Double-clicking a node shows or hides its Bézier handle.
      button.addEventListener("dblclick", () => {
        if (!selectedRoad) return;
        const node = selectedRoad.nodes[i];
        const other = selectedRoad.nodes[1 - i];
        node.curve = !node.curve;
        if (node.curve && !node.handle) node.handle = { x: node.x + (other.x - node.x) / 3, y: node.y + (other.y - node.y) / 3 };
        render();
      });
    });
    controlButtons.forEach((button, i) => {
      bindHandle(button, (to, dx, dy) => {
        const handle = selectedRoad.nodes[i].handle;
        handle.x = to ? to.x : handle.x + dx;
        handle.y = to ? to.y : handle.y + dy;
      });
      // Double-clicking a handle straightens that end again.
      button.addEventListener("dblclick", () => {
        if (!selectedRoad) return;
        Object.assign(selectedRoad.nodes[i], { handle: null, curve: false });
        render();
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
      if (!active()) drawing = null;
      render();
    }).observe(editor, { attributes: true, attributeFilter: ["hidden"] });
    document.addEventListener("sheetview", drawOverlay);
    document.addEventListener("sheetchange", () => {
      if (!sheets.selected?.roads?.includes(selectedRoad)) selectedRoad = null;
      drawing = null;
      render();
    });
    render();
  });
})();
