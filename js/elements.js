(() => {
  // Roads are one-way groups of parallel lanes, stored in sheet image pixels. Every
  // lane has its own line with a node at each end, and a road's lanes move together.
  // Roads connect lane to lane: one lane's end node joins another lane's start node.
  //
  // Each road end sits on a joint: a point and a direction of travel shared by every
  // road end connected there. Lane-to-lane links fix each road's sideways position
  // on the joint, so joined ends line up and move together. A road joined in the
  // opposite direction sits beside the other road, left edge to left edge, making
  // a two-way road with a double yellow centerline (or a median between them). A
  // two-way road's joints sit on its centerline, so lane changes grow outward.
  //
  // Right-clicking a lane node opens a small popover of actions for that road end
  // (curve, straighten, taper, detach, two-way, delete), pointing at the node.
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
  const MAX_MEDIAN_FEET = 200;
  const CURVE_SEGMENTS = 96;
  const SNAP_PIXELS = 14;
  const NODE_INSET_PIXELS = 13;       // nodes sit just inside their road's end
  const ARROW_PIXELS = 20;            // flow arrows sit this far inside their node
  const TAPER_BADGE_PIXELS = 36;      // and taper badges just past the arrow
  const DEFAULT_TAPER_FEET = 300;
  const MIN_TAPER_FEET = 10;
  const MAX_TAPER_FEET = 2000;
  const LEFT_EDGE = -0.5;             // lane "index" of a road's left edge
  // Gores and traffic separation, FDOT 711-001 sheet 8. "Traffic Channelization at
  // Gore" (same-direction roads): 8" white gore lines, 18" white chevrons at 45°,
  // 20' apart. "Markings for Traffic Separation" (opposite directions): 18" yellow
  // diagonals at 45°, Y apart by posted speed.
  const GORE_LINE_INCHES = 8;
  const GORE_STRIPE_INCHES = 18;
  const GORE_SPACING_FEET = 20;
  const SEPARATION_SPACING = [[30, 10], [40, 20], [45, 30], [Infinity, 40]];  // [up to mph, Y ft]
  const MIN_GORE_SPACING_FEET = 10;
  const MAX_GORE_SPACING_FEET = 40;
  const GORE_ICON_PIXELS = 26;        // gore icons rest this far along from the gore point
  // Medians, FDOT Design Manual 210.3. Grass medians are turf; concrete medians are
  // raised and curbed (Standard Plans Index 520-001, Type F curb, 6" top drawn at
  // the median's edge); painted medians carry the 711-001 sheet 8 traffic
  // separation markings: a 6" yellow line 10" inside the road's yellow edge line
  // (a double yellow) and 18" yellow diagonals at 45°, spaced Y by posted speed.
  const MEDIAN_TYPES = { grass: "Grass", concrete: "Concrete", painted: "Painted" };
  const GRASS = "#5e7f3c";
  const CONCRETE = "#bdbbb4";
  const CURB = "#dedcd5";
  const CURB_INCHES = 6;
  const MEDIAN_SPACING_FEET = 20;
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
    const oppositeInput = document.getElementById("roadOpposite");
    const medianRow = document.getElementById("medianRow");
    const medianInput = document.getElementById("roadMedian");
    const splitRow = document.getElementById("splitRow");
    const laneFields = document.getElementById("laneFields");
    const laneTitle = document.getElementById("laneTitle");
    const taperSelect = document.getElementById("laneTaper");
    const taperLength = document.getElementById("laneTaperLength");
    const taperState = document.getElementById("laneTaperState");
    const autoTapersInput = document.getElementById("autoTapers");
    const goreFields = document.getElementById("goreFields");
    const goreTitle = document.getElementById("goreTitle");
    const goreState = document.getElementById("goreState");
    const goreSpacing = document.getElementById("goreSpacing");
    const goreSpacingValue = document.getElementById("goreSpacingValue");
    const goreSpacingHint = document.getElementById("goreSpacingHint");
    const goreLength = document.getElementById("goreLength");
    const addMedianButton = document.getElementById("addMedian");
    const medianFields = document.getElementById("medianFields");
    const medianTitle = document.getElementById("medianTitle");
    const medianType = document.getElementById("medianType");
    const paintedFields = document.getElementById("paintedFields");
    const medianColor = document.getElementById("medianColor");
    const medianLean = document.getElementById("medianLean");
    const medianSpacing = document.getElementById("medianSpacing");
    const medianSpacingValue = document.getElementById("medianSpacingValue");
    const medianSpacingHint = document.getElementById("medianSpacingHint");
    const medianState = document.getElementById("medianState");
    const defaults = { lanes: 1, laneWidth: 12, opposite: 0, median: 0, medianType: "grass", medianSpacing: MEDIAN_SPACING_FEET, medianColor: "yellow", medianLean: "right" };
    const medianPoints = [];
    let selectedMedian = null;
    let medianSheet = null;
    let medianDraw = null;
    const openCurves = new Set();
    const nodeButtons = new Map();
    const goreButtons = new Map();
    let selectedRoad = null;
    let selectedLane = null;
    let drawing = null;
    let drag = null;
    let snapTarget = null;
    let menuNode = null;
    let selectedGore = null;

    const overlay = document.createElement("div");
    overlay.className = "roadOverlay";
    overlay.hidden = true;
    overlay.innerHTML = `<svg aria-hidden="true"><line class="roadControlLine"/><line class="roadControlLine"/>
      <polyline class="medianPreview"/><line class="medianPreview closing"/><g class="medianPreviewPoints"></g><circle class="roadSnap" r="15"/></svg>
      <span class="roadNode preview" aria-hidden="true"></span>
      <button type="button" class="roadControl" aria-label="Start curve handle" aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown"></button>
      <button type="button" class="roadControl" aria-label="End curve handle" aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown"></button>`;
    const controlLines = [...overlay.querySelectorAll("line")];
    const snapRing = overlay.querySelector(".roadSnap");
    const startMarker = overlay.querySelector(".roadNode.preview");
    const controlButtons = [...overlay.querySelectorAll(".roadControl")];
    const [medianPreview, medianClosing] = overlay.querySelectorAll(".medianPreview");
    const medianPreviewPoints = overlay.querySelector(".medianPreviewPoints");
    sheets.addOverlay(overlay);
    const nodeMenu = document.getElementById("nodeMenu");

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
    // A link names a lane by index, or a road's left ("L") or right ("R") edge line,
    // so roads can be joined edge to edge as well as lane to lane.
    const linkLateral = (sheet, road, index) => (index === "L" || index === "R"
      ? (index === "R" ? 1 : -1) * road.lanes * feetToPixels(sheet, road.laneWidth) / 2
      : laneLateral(sheet, road, index));
    const pairOf = (sheet, road) => road && sheet.roads.find(other => other !== road
      && other.ends[0].joint === road.ends[1].joint && other.ends[1].joint === road.ends[0].joint);
    const pairLinks = (sheet, road, pair) => road.ends.flatMap(end => jointOf(sheet, end.joint).links)
      .filter(link => link.pair && [link.a, link.b].includes(road.id) && [link.a, link.b].includes(pair.id));

    function save() {
      if (sheets.selected) sheets.save(sheets.selected);
    }
    function layerFor(sheet) {
      if (!sheet.roadLayer) {
        sheet.roads = (sheet.roads ?? []).filter(road => road.ends);
        sheet.joints ??= [];
        sheet.gores ??= [];
        sheet.medians ??= [];
        delete sheet.connectors;
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
                ? offsets.get(from) + a.end.sign * (laneLateral(sheet, a.road, LEFT_EDGE) - separation - feetToPixels(sheet, link.median ?? 0))
                : offsets.get(from) + a.end.sign * linkLateral(sheet, a.road, fromLane);
              offsets.set(to, reference - b.end.sign * (link.pair ? laneLateral(sheet, b.road, LEFT_EDGE) : linkLateral(sheet, b.road, toLane)));
              grew = true;
            }
          }
        }
        // A two-way road's joint sits on its centerline: midway between the two
        // yellow lines (across the median, if any).
        const pairLink = joint.links.find(link => link.pair && offsets.has(link.a) && offsets.has(link.b));
        if (pairLink) {
          const half = byRoad.get(pairLink.a);
          const gap = separation + feetToPixels(sheet, pairLink.median ?? 0);
          const center = offsets.get(pairLink.a) + half.end.sign * (laneLateral(sheet, half.road, LEFT_EDGE) - gap / 2);
          for (const [id, value] of offsets) offsets.set(id, value - center);
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
      const { a, c0, c1, b } = controls(solved.get(`${road.id}:0`), solved.get(`${road.id}:1`), road.ends.map(end => end.length));
      return bezier(a, c0, c1, b);
    }
    // A Bézier's control points from its end centers (with their travel) and pulls;
    // an end without a travel direction doesn't pull.
    function controls(a, b, lengths) {
      const chord = Math.hypot(b.x - a.x, b.y - a.y);
      const [l0, l1] = lengths.map((length, e) => ((e ? b : a).travel ? length ?? chord / 3 : 0));
      return {
        a, b,
        c0: { x: a.x + (a.travel?.x ?? 0) * l0, y: a.y + (a.travel?.y ?? 0) * l0 },
        c1: { x: b.x - (b.travel?.x ?? 0) * l1, y: b.y - (b.travel?.y ?? 0) * l1 },
      };
    }
    // Samples a cubic Bézier: enough for smooth curves and tapers (about one per 12 px).
    function bezier(a, c0, c1, b) {
      const reach = Math.hypot(c0.x - a.x, c0.y - a.y) + Math.hypot(c1.x - c0.x, c1.y - c0.y) + Math.hypot(b.x - c1.x, b.y - c1.y);
      const segments = Math.min(400, Math.max(CURVE_SEGMENTS / 4, Math.ceil(reach / 12)));
      const points = [];
      for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const u = 1 - t;
        const w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
        // The exact tangent, so joined curves meet square at their shared joint.
        const d = [3 * u * u, 6 * u * t, 3 * t * t];
        const tangent = {
          x: d[0] * (c0.x - a.x) + d[1] * (c1.x - c0.x) + d[2] * (b.x - c1.x),
          y: d[0] * (c0.y - a.y) + d[1] * (c1.y - c0.y) + d[2] * (b.y - c1.y),
        };
        points.push({
          x: w[0] * a.x + w[1] * c0.x + w[2] * c1.x + w[3] * b.x,
          y: w[0] * a.y + w[1] * c0.y + w[2] * c1.y + w[3] * b.y,
          tangent: Math.hypot(tangent.x, tangent.y) > 1e-6 ? unit(tangent) : null,
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
        const normal = rightOf(point.tangent ?? unit({ x: next.x - prev.x, y: next.y - prev.y }));
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
    function buildShape(sheet, road, line, tapers, shift = 0) {
      const along = [0];
      for (let i = 1; i < line.length; i++) along.push(along[i - 1] + Math.hypot(line[i].x - line[i - 1].x, line[i].y - line[i - 1].y));
      const total = along[along.length - 1];
      const laneWidth = feetToPixels(sheet, road.laneWidth);
      const tapered = lane => tapers.has(`0:${lane}`) || tapers.has(`1:${lane}`);
      let anchor = 0;
      while (anchor < road.lanes - 1 && tapered(anchor)) anchor++;
      const anchorLeft = laneLateral(sheet, road, anchor) - laneWidth / 2 + shift;
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
          const id = `${road.id}:${key}`;
          // Auto tapers only when the sheet's Auto tapers setting is on (off by default).
          if (mode === "taper" || (mode === "auto" && sheet.autoTapers && solved.auto.has(id))) {
            tapers.set(key, feetToPixels(sheet, setting?.length ?? DEFAULT_TAPER_FEET));
          }
        }
      }
      return tapers;
    }
    // Both sides of a two-way road are offsets of one shared centerline curve, so
    // the double yellow (or median) stays parallel through curves. Lane bounds are
    // shifted right of that centerline by half the gap plus half this side's width.
    function shapeOf(sheet, road, solved) {
      if (solved.shapes.has(road)) return solved.shapes.get(road);
      const partner = pairOf(sheet, road);
      const tapers = tapersOf(sheet, road, solved);
      let shape;
      if (partner) {
        const gap = inchesToPixels(sheet, DOUBLE_GAP_INCHES + LINE_INCHES) + feetToPixels(sheet, pairLinks(sheet, road, partner)[0]?.median ?? 0);
        const shift = gap / 2 - laneLateral(sheet, road, LEFT_EDGE);
        const { a, c0, c1, b } = sharedControls(road, partner, solved, shift);
        shape = buildShape(sheet, road, bezier(a, c0, c1, b), tapers, shift);
      } else shape = buildShape(sheet, road, centerline(road, solved), tapers);
      solved.shapes.set(road, shape);
      return shape;
    }
    // The two-way centerline, from this side's point of view: its end centers moved
    // left by `shift`, with the same Bézier pull both sides share.
    function sharedControls(road, partner, solved, shift) {
      const [a, b] = [0, 1].map(e => {
        const at = solved.get(`${road.id}:${e}`);
        const travel = at.travel ?? travelAt(road, e, solved);
        const right = rightOf(travel);
        return { x: at.x - right.x * shift, y: at.y - right.y * shift, travel: at.travel };
      });
      // The lower-id side's pulls drive both sides, so they can't drift apart.
      return controls(a, b, road.id < partner.id ? road.ends.map(end => end.length) : [partner.ends[1].length, partner.ends[0].length]);
    }
    // The curve a road is drawn along: its own centerline, or a two-way road's
    // shared centerline.
    function curveOf(sheet, road, solved) {
      const partner = pairOf(sheet, road);
      if (!partner) return controls(solved.get(`${road.id}:0`), solved.get(`${road.id}:1`), road.ends.map(end => end.length));
      const gap = inchesToPixels(sheet, DOUBLE_GAP_INCHES + LINE_INCHES) + feetToPixels(sheet, pairLinks(sheet, road, partner)[0]?.median ?? 0);
      return sharedControls(road, partner, solved, gap / 2 - laneLateral(sheet, road, LEFT_EDGE));
    }
    // Where a lane node is drawn: just inside the road, so the end nodes of one road
    // and the start nodes of the next don't cover each other at a joint.
    // The direction from a road's end into the road.
    const inwardAt = (line, e) => unit(e ? { x: line[line.length - 2].x - line[line.length - 1].x, y: line[line.length - 2].y - line[line.length - 1].y }
      : { x: line[1].x - line[0].x, y: line[1].y - line[0].y });
    function nodePoint(sheet, road, e, lane, solved) {
      const { line } = shapeOf(sheet, road, solved);
      const at = lanePoint(sheet, road, e, lane, solved);
      const inward = inwardAt(line, e);
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

    function strokePath(points, color, width, dash, phase = 0) {
      const path = document.createElementNS(SVG, "path");
      path.setAttribute("class", "roadMarking");
      path.setAttribute("d", pathData(points));
      path.setAttribute("stroke", color);
      path.setAttribute("stroke-width", width);
      if (dash) path.setAttribute("stroke-dasharray", dash);
      if (phase) path.setAttribute("stroke-dashoffset", phase.toFixed(2));
      return path;
    }
    const polylineLength = points => points.reduce((sum, p, i) => (i ? sum + Math.hypot(p.x - points[i - 1].x, p.y - points[i - 1].y) : 0), 0);
    // Where lane line k picks up the skip pattern: a lane line that continues from
    // a road joined before it carries on that road's 10'-30' cycle instead of
    // restarting at the joint.
    function skipPhase(sheet, road, k, solved, visiting = new Set()) {
      const key = `${road.id}:${k}`;
      solved.phases ??= new Map();
      if (solved.phases.has(key)) return solved.phases.get(key);
      if (visiting.has(key)) return 0;
      visiting.add(key);
      let phase = 0;
      const joint = jointOf(sheet, road.ends[0].joint);
      const start = boundary(shapeOf(sheet, road, solved), k)[0];
      const tolerance = feetToPixels(sheet, road.laneWidth) / 4;
      for (const { road: before, e, end } of attachments(sheet, joint)) {
        if (e !== 1 || end.sign !== road.ends[0].sign || before === road) continue;
        const shape = shapeOf(sheet, before, solved);
        const j = Array.from({ length: before.lanes - 1 }, (_, i) => i + 1).find(i => {
          const at = boundary(shape, i).at(-1);
          return Math.hypot(at.x - start.x, at.y - start.y) < tolerance;
        });
        if (j === undefined) continue;
        const period = feetToPixels(sheet, SKIP_STRIPE_FEET + SKIP_GAP_FEET);
        phase = (skipPhase(sheet, before, j, solved, visiting) + polylineLength(boundary(shape, j))) % period;
        break;
      }
      solved.phases.set(key, phase);
      return phase;
    }
    // Yellow left edge, white right edge, and white skip lines between lanes.
    function drawRoad(sheet, road, shape, layers, className = "", solved = null) {
      const margin = inchesToPixels(sheet, PAVEMENT_MARGIN_INCHES);
      const band = document.createElementNS(SVG, "path");
      band.setAttribute("class", `roadBand ${className}`);
      band.setAttribute("d", `${pathData([...boundary(shape, 0, -margin), ...boundary(shape, road.lanes, margin).reverse()])}Z`);
      layers.pavement.append(band);
      const lineWidth = inchesToPixels(sheet, LINE_INCHES);
      const skip = `${feetToPixels(sheet, SKIP_STRIPE_FEET)} ${feetToPixels(sheet, SKIP_GAP_FEET)}`;
      const group = document.createElementNS(SVG, "g");
      if (className) group.setAttribute("class", className);
      for (let k = 1; k < road.lanes; k++) {
        group.append(strokePath(boundary(shape, k), WHITE, lineWidth, skip, solved ? skipPhase(sheet, road, k, solved) : 0));
      }
      group.append(strokePath(boundary(shape, 0), YELLOW, lineWidth));
      group.append(strokePath(boundary(shape, road.lanes), WHITE, lineWidth));
      const mask = solved && maskJoined(sheet, road, group, solved);
      if (mask) layers.markings.append(mask);
      layers.markings.append(group);
      if (className === "selected") {
        const ring = band.cloneNode();
        ring.setAttribute("class", "roadOutline");
        layers.selection.append(ring);
      }
    }

    // Gores: where two road ends leave a joint on the same side and their facing
    // edges spread apart, the space between them can be marked. Same-direction
    // roads (a split or merge) get a gore; opposite directions get traffic
    // separation. Each candidate is keyed by its two road ends.
    function resample(points, count, total) {
      const out = [];
      let i = 0;
      let walked = 0;
      const segment = k => Math.hypot(points[k + 1].x - points[k].x, points[k + 1].y - points[k].y);
      for (let n = 0; n <= count; n++) {
        const s = total * n / count;
        while (i < points.length - 2 && walked + segment(i) < s) walked += segment(i++);
        const f = Math.min(1, Math.max(0, (s - walked) / (segment(i) || 1)));
        out.push({ x: points[i].x + (points[i + 1].x - points[i].x) * f, y: points[i].y + (points[i + 1].y - points[i].y) * f });
      }
      return out;
    }
    const sideOf = ({ e, end }) => ((e === 0) === (end.sign === 1) ? 1 : -1);
    const goreKey = (a, b) => [`${a.road.id}:${a.e}`, `${b.road.id}:${b.e}`].sort().join("|");
    function goreCandidates(sheet, solved) {
      if (solved.gores) return solved.gores;
      solved.gores = new Map();
      const tolerance = inchesToPixels(sheet, DOUBLE_GAP_INCHES + LINE_INCHES) + feetToPixels(sheet, 1);
      for (const joint of sheet.joints) {
        const here = attachments(sheet, joint);
        here.forEach((a, i) => here.slice(i + 1).forEach(b => {
          if (a.road === b.road || pairOf(sheet, a.road) === b.road || sideOf(a) !== sideOf(b)) return;
          // The facing edges are the two edges, one per road, that start closest.
          // Each edge's side across the joint: only a pair of edges facing each
          // other across the gap can bound a gore.
          const edges = item => [0, item.road.lanes].map(k => {
            const points = boundary(shapeOf(sheet, item.road, solved), k);
            return { points: item.e ? points.reverse() : points, side: (k ? 1 : -1) * item.end.sign };
          });
          let best = null;
          for (const e1 of edges(a)) for (const e2 of edges(b)) {
            if (e1.side !== -e2.side) continue;
            const gap = Math.hypot(e1.points[0].x - e2.points[0].x, e1.points[0].y - e2.points[0].y);
            if (!best || gap < best.gap) best = { e1: e1.points, e2: e2.points, gap };
          }
          if (!best || best.gap > tolerance) return;
          const total = Math.min(polylineLength(best.e1), polylineLength(best.e2));
          const count = Math.min(400, Math.max(20, Math.ceil(total / feetToPixels(sheet, 2))));
          const e1 = resample(best.e1, count, total);
          const e2 = resample(best.e2, count, total);
          const mid = e1.map((p, n) => ({ x: (p.x + e2[n].x) / 2, y: (p.y + e2[n].y) / 2 }));
          const width = e1.map((p, n) => Math.hypot(e2[n].x - p.x, e2[n].y - p.y));
          if (Math.max(...width) < feetToPixels(sheet, 4)) return;
          const along = [0];
          for (let n = 1; n < mid.length; n++) along.push(along[n - 1] + Math.hypot(mid[n].x - mid[n - 1].x, mid[n].y - mid[n - 1].y));
          const key = goreKey(a, b);
          solved.gores.set(key, {
            key, e1, e2, mid, width, along,
            same: a.e === b.e,          // both start (split) or both end (merge) here
            split: a.e === 0 && b.e === 0,
            awayFirst: a.e === 0,       // e1's road leaves the gore point
          });
        }));
      }
      return solved.gores;
    }
    const indexAt = (along, s) => {
      const i = along.findIndex(value => value >= s);
      return i < 0 ? along.length - 1 : i;
    };
    const goreTangent = (mid, i) => unit({ x: mid[Math.min(i + 1, mid.length - 1)].x - mid[Math.max(i - 1, 0)].x, y: mid[Math.min(i + 1, mid.length - 1)].y - mid[Math.max(i - 1, 0)].y });
    const goreDefaultSpacing = candidate => (candidate.same ? GORE_SPACING_FEET : 20);
    function goreLine(points, color, width, join) {
      const path = strokePath(points, color, width);
      if (join) path.setAttribute("stroke-linejoin", "miter");
      return path;
    }
    // Paves the gore from its point to the marked length, then lays chevrons (same
    // direction) or diagonals (opposite directions) clipped to it.
    function drawGore(sheet, gore, candidate, layers) {
      const length = Math.min(feetToPixels(sheet, gore.length), candidate.along.at(-1));
      const last = indexAt(candidate.along, length);
      if (last < 1) return;
      const outline = [...candidate.e1.slice(0, last + 1), ...candidate.e2.slice(0, last + 1).reverse()];
      // Traffic separation is edged in 6" double yellow on both sides: the roads'
      // yellow edges plus a second line 10" inside each, meeting at the tip.
      const inner = !candidate.same && separationInner(sheet, candidate, last);
      const band = document.createElementNS(SVG, "path");
      band.setAttribute("class", `roadBand goreBand${gore.key === selectedGore ? " selected" : ""}`);
      band.setAttribute("d", `${pathData(outline)}Z`);
      layers.pavement.append(band);
      if (gore.key === selectedGore) {
        const ring = band.cloneNode();
        ring.setAttribute("class", "roadOutline");
        layers.selection.append(ring);
      }
      const clip = document.createElementNS(SVG, "clipPath");
      clip.id = `gore-${sheet.id}-${gore.key.replace(/[^0-9]/g, "-")}`;
      const clipShape = band.cloneNode();
      clipShape.removeAttribute("class");
      if (inner) clipShape.setAttribute("d", `${pathData([...inner.e1, ...[...inner.e2].reverse()])}Z`);
      clip.append(clipShape);
      const stripes = document.createElementNS(SVG, "g");
      stripes.setAttribute("clip-path", `url(#${clip.id})`);
      const color = candidate.same ? WHITE : YELLOW;
      const stripe = inchesToPixels(sheet, GORE_STRIPE_INCHES);
      const spacing = feetToPixels(sheet, gore.spacing ?? goreDefaultSpacing(candidate));
      for (let s = spacing; s < length; s += spacing) {
        const i = indexAt(candidate.along, s);
        const w = candidate.width[i];
        if (w < stripe) continue;
        const m = candidate.mid[i];
        const t = goreTangent(candidate.mid, i);
        const n = unit({ x: candidate.e2[i].x - candidate.e1[i].x, y: candidate.e2[i].y - candidate.e1[i].y });
        const reach = w * 1.5;
        if (candidate.same) {
          // Chevrons point back toward approaching traffic.
          const f = candidate.split ? t : { x: -t.x, y: -t.y };
          const arms = [1, -1].map(side => unit({ x: f.x + n.x * side, y: f.y + n.y * side }));
          stripes.append(goreLine([{ x: m.x + arms[0].x * reach, y: m.y + arms[0].y * reach }, m,
            { x: m.x + arms[1].x * reach, y: m.y + arms[1].y * reach }], color, stripe, true));
        } else {
          // Diagonals run from the arriving side toward the departing side as they
          // move away from the gore point, as drawn in 711-001.
          const side = candidate.awayFirst ? -1 : 1;
          const d = unit({ x: t.x + n.x * side, y: t.y + n.y * side });
          stripes.append(goreLine([{ x: m.x - d.x * reach, y: m.y - d.y * reach }, { x: m.x + d.x * reach, y: m.y + d.y * reach }], color, stripe));
        }
      }
      layers.markings.append(clip, stripes);
      if (inner) {
        const lineWidth = inchesToPixels(sheet, LINE_INCHES);
        layers.markings.append(strokePath(inner.e1, YELLOW, lineWidth), strokePath(inner.e2, YELLOW, lineWidth));
      }
      // Gores are outlined in 8" white over the roads' edge lines.
      if (candidate.same) {
        const lineWidth = inchesToPixels(sheet, GORE_LINE_INCHES);
        layers.markings.append(strokePath(candidate.e1.slice(0, last + 1), WHITE, lineWidth), strokePath(candidate.e2.slice(0, last + 1), WHITE, lineWidth));
      }
    }
    // The inner lines of each side's double yellow, from where the sides are far
    // enough apart for both (where the inner lines meet) to the marked length.
    function separationInner(sheet, candidate, last) {
      const step = inchesToPixels(sheet, DOUBLE_GAP_INCHES + LINE_INCHES);
      const first = candidate.width.findIndex(w => w >= step * 2);
      if (first < 0 || first >= last) return null;
      const e1 = [];
      const e2 = [];
      for (let i = first; i <= last; i++) {
        const a = candidate.e1[i];
        const b = candidate.e2[i];
        const n = unit({ x: b.x - a.x, y: b.y - a.y });
        e1.push({ x: a.x + n.x * step, y: a.y + n.y * step });
        e2.push({ x: b.x - n.x * step, y: b.y - n.y * step });
      }
      return { e1, e2 };
    }
    function goreAt(sheet, point) {
      const solved = solve(sheet);
      const candidates = goreCandidates(sheet, solved);
      for (const gore of sheet.gores) {
        const candidate = candidates.get(gore.key);
        if (!candidate) continue;
        const last = indexAt(candidate.along, feetToPixels(sheet, gore.length));
        if (last > 0 && insidePolygon(point, [...candidate.e1.slice(0, last + 1), ...candidate.e2.slice(0, last + 1).reverse()])) return gore.key;
      }
      return null;
    }
    // Drops gore markings whose roads no longer form a gore.
    function pruneGores(sheet) {
      if (!sheet?.gores?.length || !sheet.inchesPerPixel) return;
      const candidates = goreCandidates(sheet, solve(sheet));
      sheet.gores = sheet.gores.filter(gore => candidates.has(gore.key) && gore.length > 0);
    }

    // Medians are closed outlines clicked point by point. Points snap to the corners
    // and edges of road pavement, marked gores, and other medians, so medians of
    // different surfaces can share points and edges.
    const samePoint = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) < 1e-3;
    const medianOf = (sheet, id) => sheet?.medians?.find(median => median.id === id);
    function nearestOn(points, point) {
      let best = null;
      for (let i = 0; i < points.length - 1; i++) {
        const p = points[i];
        const q = points[i + 1];
        const dx = q.x - p.x;
        const dy = q.y - p.y;
        const squared = dx * dx + dy * dy;
        const f = squared ? Math.max(0, Math.min(1, ((point.x - p.x) * dx + (point.y - p.y) * dy) / squared)) : 0;
        const at = { x: p.x + dx * f, y: p.y + dy * f };
        const distance = Math.hypot(at.x - point.x, at.y - point.y);
        if (!best || distance < best.distance) best = { ...at, distance, s: i + f };
      }
      return best;
    }
    // Road pavement edges and marked gore outlines, which medians snap to and follow.
    function pavementEdges(sheet, solved) {
      if (solved.pavementEdges) return solved.pavementEdges;
      const margin = inchesToPixels(sheet, PAVEMENT_MARGIN_INCHES);
      const corners = [];
      const edges = [];
      const byKey = new Map();
      // Each road edge is tagged with its road and side (L, R, or the S and E end
      // caps), so median points on it can be anchored there and follow the road.
      for (const road of sheet.roads) {
        const shape = shapeOf(sheet, road, solved);
        const [left, right] = [boundary(shape, 0, -margin), boundary(shape, road.lanes, margin)];
        const sides = { L: left, R: right, S: [left[0], right[0]], E: [left.at(-1), right.at(-1)] };
        for (const [side, edge] of Object.entries(sides)) {
          edge.on = { road: road.id, side };
          byKey.set(`${road.id}:${side}`, edge);
          edges.push(edge);
        }
        corners.push(...[["L", 0], ["L", 1], ["R", 0], ["R", 1]].map(([side, f]) => ({ ...sides[side][f ? sides[side].length - 1 : 0], on: { road: road.id, side, f } })));
      }
      const candidates = goreCandidates(sheet, solved);
      for (const gore of sheet.gores) {
        const candidate = candidates.get(gore.key);
        const last = candidate ? indexAt(candidate.along, feetToPixels(sheet, gore.length)) : 0;
        if (last < 1) continue;
        const [e1, e2] = [candidate.e1.slice(0, last + 1), candidate.e2.slice(0, last + 1)];
        corners.push(e1[0], e1[last], e2[last]);
        edges.push(e1, e2, [e1[last], e2[last]]);
      }
      return (solved.pavementEdges = { corners, edges, byKey });
    }
    // Arc-length fraction of position `s` (segment index plus fraction) along a
    // polyline, and the point at a fraction.
    function fractionAt(points, s) {
      const total = polylineLength(points) || 1;
      const i = Math.min(Math.floor(s), points.length - 2);
      return (polylineLength(points.slice(0, i + 1)) + Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y) * (s - i)) / total;
    }
    function pointAtFraction(points, f) {
      const [, at] = resample(points, 1, polylineLength(points) * Math.max(0, Math.min(1, f)));
      return at;
    }
    // Median points anchored to a road edge move with the road; an anchor to a
    // road that's gone is dropped and the point stays where it was.
    function anchorMedians(sheet, solved) {
      const { byKey } = pavementEdges(sheet, solved);
      for (const p of sheet.medians.flatMap(median => median.points)) {
        if (!p.on) continue;
        const edge = byKey.get(`${p.on.road}:${p.on.side}`);
        if (!edge) delete p.on;
        else Object.assign(p, pointAtFraction(edge, p.on.f));
      }
    }
    // After a road is cut, points anchored to it re-anchor to whichever piece
    // they lie on.
    function rehomeMedians(sheet, roads) {
      const ids = roads.map(road => road.id);
      const edges = pavementEdges(sheet, solve(sheet)).edges.filter(edge => ids.includes(edge.on?.road));
      for (const p of (sheet.medians ?? []).flatMap(median => median.points)) {
        if (!p.on || !ids.includes(p.on.road)) continue;
        let best = null;
        for (const edge of edges) {
          const at = nearestOn(edge, p);
          if (at && (!best || at.distance < best.at.distance)) best = { edge, at };
        }
        if (best) p.on = { ...best.edge.on, f: fractionAt(best.edge, best.at.s) };
      }
    }
    // A median's drawn outline: between two points on the same pavement edge it
    // follows that edge (a curved road's edge, say) instead of cutting across.
    function medianOutline(sheet, solved, points) {
      const { edges } = pavementEdges(sheet, solved);
      const tolerance = 0.5;
      const on = points.map(p => edges.map(edge => {
        const at = nearestOn(edge, p);
        return at && at.distance <= tolerance ? at.s : null;
      }));
      return points.flatMap((p, i) => {
        const j = (i + 1) % points.length;
        const k = edges.findIndex((edge, n) => on[i][n] != null && on[j][n] != null && edge.length > 2);
        if (k < 0) return [p];
        const [from, to] = [on[i][k], on[j][k]];
        const between = [];
        if (from < to) for (let n = Math.floor(from) + 1; n < to; n++) between.push(edges[k][n]);
        else for (let n = Math.ceil(from) - 1; n > to; n--) between.push(edges[k][n]);
        return [p, ...between];
      });
    }
    // Corners and edges a median point can snap to; points in `exclude` (the ones
    // being dragged) and median edges touching them are left out.
    function medianSnaps(sheet, solved, exclude) {
      const { corners: pavementCorners, edges: pavement } = pavementEdges(sheet, solved);
      const corners = [...pavementCorners];
      const edges = [...pavement];
      for (const median of sheet.medians) {
        if (median.points.some(p => exclude.has(p))) {
          median.points.forEach(p => !exclude.has(p) && corners.push(p));
          continue;
        }
        corners.push(...median.points);
        const outline = medianOutline(sheet, solved, median.points);
        edges.push([...outline, outline[0]]);
      }
      return { corners, edges };
    }
    // Corners win over edges within the snapping distance.
    function snapMedian(sheet, point, exclude = new Set(), extra = []) {
      const radius = SNAP_PIXELS / sheet.view.scale;
      const { corners, edges } = medianSnaps(sheet, solve(sheet), exclude);
      let best = null;
      for (const corner of [...corners, ...extra]) {
        const distance = Math.hypot(corner.x - point.x, corner.y - point.y);
        if (distance <= radius && (!best || distance < best.distance)) best = { x: corner.x, y: corner.y, on: corner.on, distance };
      }
      if (best) return best;
      for (const edge of edges) {
        const at = nearestOn(edge, point);
        if (at && at.distance <= radius && (!best || at.distance < best.distance)) best = { ...at, on: edge.on && { ...edge.on, f: fractionAt(edge, at.s) } };
      }
      return best;
    }
    // Every median point at the same place, so shared points move together.
    const sharedPoints = (sheet, point) => sheet.medians.flatMap(median => median.points.filter(p => samePoint(p, point)));
    // The outline moved `distance` inward, with mitered corners.
    function insetPolygon(points, distance) {
      const area = points.reduce((sum, p, i) => {
        const q = points[(i + 1) % points.length];
        return sum + p.x * q.y - q.x * p.y;
      }, 0);
      const inward = v => (area > 0 ? rightOf(v) : { x: v.y, y: -v.x });
      return points.map((p, i) => {
        const prev = points[(i - 1 + points.length) % points.length];
        const next = points[(i + 1) % points.length];
        const n1 = inward(unit({ x: p.x - prev.x, y: p.y - prev.y }));
        const n2 = inward(unit({ x: next.x - p.x, y: next.y - p.y }));
        const scale = distance / Math.max(0.25, 1 + dot(n1, n2));
        return { x: p.x + (n1.x + n2.x) * scale, y: p.y + (n1.y + n2.y) * scale };
      });
    }
    function drawMedian(sheet, median, layers, solved) {
      const corners = median.points.filter((p, i) => !samePoint(p, median.points[(i + 1) % median.points.length]));
      if (corners.length < 3) return;
      const points = medianOutline(sheet, solved, corners).filter((p, i, all) => !samePoint(p, all[(i + 1) % all.length]));
      const outline = `${pathData(points)}Z`;
      const fill = document.createElementNS(SVG, "path");
      fill.setAttribute("d", outline);
      if (median.type === "painted") fill.setAttribute("class", "roadBand medianBand");
      else fill.setAttribute("fill", median.type === "concrete" ? CONCRETE : GRASS);
      layers.pavement.append(fill);
      if (median.id === selectedMedian) {
        const ring = document.createElementNS(SVG, "path");
        ring.setAttribute("class", "roadOutline");
        ring.setAttribute("d", outline);
        layers.selection.append(ring);
      }
      if (median.type === "grass") return;
      const clipTo = (shape, id) => {
        const clip = document.createElementNS(SVG, "clipPath");
        clip.id = `median-${sheet.id}-${median.id}-${id}`;
        const path = document.createElementNS(SVG, "path");
        path.setAttribute("d", `${pathData(shape)}Z`);
        clip.append(path);
        const group = document.createElementNS(SVG, "g");
        group.setAttribute("clip-path", `url(#${clip.id})`);
        layers.markings.append(clip, group);
        return group;
      };
      const color = median.type === "concrete" ? CURB : median.color === "white" ? WHITE : YELLOW;
      const closed = shape => {
        const path = strokePath([...shape, shape[0]], color, 0);
        path.setAttribute("stroke-linejoin", "miter");
        return path;
      };
      if (median.type === "concrete") {
        // The curb: a stroke twice its width, clipped to the inside of the outline.
        const curb = closed(points);
        curb.setAttribute("stroke-width", inchesToPixels(sheet, CURB_INCHES) * 2);
        clipTo(points, "curb").append(curb);
        return;
      }
      // The inner line sits 10" (center to center) inside the road's edge line,
      // which is itself 8" inside the pavement edge the median snaps to. White
      // (same-direction) medians are outlined like gores, in 8" white.
      const inner = insetPolygon(points, inchesToPixels(sheet, DOUBLE_GAP_INCHES + LINE_INCHES - PAVEMENT_MARGIN_INCHES));
      // Diagonals at 45° to the median's longest side, `spacing` apart along it,
      // leaning right (╱) or left (╲) as seen with that side running left to right.
      let along = { x: 1, y: 0 };
      let longest = 0;
      corners.forEach((p, i) => {
        const q = corners[(i + 1) % corners.length];
        const length = Math.hypot(q.x - p.x, q.y - p.y);
        if (length > longest) [longest, along] = [length, unit({ x: q.x - p.x, y: q.y - p.y })];
      });
      if (along.x < -1e-6 || (Math.abs(along.x) <= 1e-6 && along.y > 0)) along = { x: -along.x, y: -along.y };
      const lean = median.lean === "left" ? 1 : -1;
      const d = unit({ x: along.x + rightOf(along).x * lean, y: along.y + rightOf(along).y * lean });
      const across = rightOf(d);
      const step = feetToPixels(sheet, median.spacing ?? MEDIAN_SPACING_FEET) / Math.SQRT2;
      const [lo, hi] = [Math.min(...points.map(p => dot(p, across))), Math.max(...points.map(p => dot(p, across)))];
      const [first, last] = [Math.min(...points.map(p => dot(p, d))), Math.max(...points.map(p => dot(p, d)))];
      const stripes = clipTo(inner, "stripes");
      const stripe = inchesToPixels(sheet, GORE_STRIPE_INCHES);
      for (let c = lo + ((hi - lo) % step) / 2; c <= hi; c += step) {
        stripes.append(strokePath([first, last].map(t => ({ x: across.x * c + d.x * t, y: across.y * c + d.y * t })), color, stripe));
      }
      const line = closed(inner);
      line.setAttribute("stroke-width", inchesToPixels(sheet, median.color === "white" ? GORE_LINE_INCHES : LINE_INCHES));
      layers.markings.append(line);
    }
    function medianAt(sheet, point) {
      const solved = solve(sheet);
      return [...sheet.medians].reverse().find(median => median.points.length > 2 && insidePolygon(point, medianOutline(sheet, solved, median.points)))?.id ?? null;
    }

    // A road's lines aren't painted on the travel lanes of roads joined to it: where
    // a ramp overlaps the lane it feeds, its edge line stops at the other road's
    // edge, and that road's edge line stops where the ramp crosses it. The masks
    // are shrunk by a line width so lines running along a shared edge (two-way
    // roads, roads side by side, end-to-end joins) stay. Unjoined roads that cross
    // (an overpass) keep all their lines.
    function maskJoined(sheet, road, group, solved) {
      const joints = road.ends.map(end => end.joint);
      const joined = sheet.roads.filter(other => other !== road && other.ends.some(end => joints.includes(end.joint)));
      if (!joined.length) return null;
      const inset = inchesToPixels(sheet, LINE_INCHES);
      const mask = document.createElementNS(SVG, "mask");
      mask.id = `lines-${sheet.id}-${road.id}`;
      mask.setAttribute("maskUnits", "userSpaceOnUse");
      // The mask must cover the whole road, even off the sheet: outside a mask's
      // region (by default just the sheet plus 10%) nothing is drawn.
      const own = shapeOf(sheet, road, solved);
      const points = [...boundary(own, 0), ...boundary(own, road.lanes)];
      const pad = feetToPixels(sheet, road.laneWidth);
      const [left, top] = ["x", "y"].map(axis => Math.min(...points.map(point => point[axis])) - pad);
      const [right, bottom] = ["x", "y"].map(axis => Math.max(...points.map(point => point[axis])) + pad);
      const region = { x: left, y: top, width: right - left, height: bottom - top };
      Object.entries(region).forEach(([key, value]) => mask.setAttribute(key, value));
      const all = document.createElementNS(SVG, "rect");
      Object.entries({ ...region, fill: "#fff" }).forEach(([key, value]) => all.setAttribute(key, value));
      mask.append(all);
      for (const other of joined) {
        const shape = shapeOf(sheet, other, solved);
        const hole = document.createElementNS(SVG, "path");
        hole.setAttribute("d", `${pathData([...boundary(shape, 0, inset), ...boundary(shape, other.lanes, -inset).reverse()])}Z`);
        hole.setAttribute("fill", "#000");
        mask.append(hole);
      }
      group.setAttribute("mask", `url(#${mask.id})`);
      return mask;
    }

    function render() {
      const sheet = sheets.selected;
      let solved = null;
      // Selecting a road or gore deselects the median.
      if (selectedRoad || selectedGore) selectedMedian = null;
      if (sheet) {
        const layer = layerFor(sheet);
        solved = solve(sheet);
        anchorMedians(sheet, solved);
        const layers = Object.fromEntries(["pavement", "markings", "selection"].map(name => {
          const group = document.createElementNS(SVG, "g");
          group.setAttribute("class", `road${name[0].toUpperCase()}${name.slice(1)}`);
          return [name, group];
        }));
        if (sheet.inchesPerPixel) {
          // Medians go under the roads, so road pavement always shows over them.
          sheet.medians.forEach(median => drawMedian(sheet, median, layers, solved));
          const partner = pairOf(sheet, selectedRoad);
          sheet.roads.forEach(road => drawRoad(sheet, road, shapeOf(sheet, road, solved), layers, road === selectedRoad || road === partner ? "selected" : "", solved));
          const candidates = goreCandidates(sheet, solved);
          for (const gore of sheet.gores) {
            const candidate = candidates.get(gore.key);
            if (candidate) drawGore(sheet, gore, candidate, layers);
          }
          if ((drawing?.start || drawing?.end) && drawing.cursor) drawPreview(sheet, layers);
        }
        layer.replaceChildren(layers.pavement, layers.markings, layers.selection);
      }
      drawOverlay(solved);
      updatePanel(solved);
    }
    // A two-way preview puts the clicked line on the centerline, like the result.
    function drawPreview(sheet, layers) {
      const line = drawing.end ? [drawing.cursor, drawing.end] : [drawing.start, drawing.cursor];
      if (!defaults.opposite) return drawRoad(sheet, defaults, buildShape(sheet, defaults, line, new Map()), layers, "preview");
      const half = (inchesToPixels(sheet, DOUBLE_GAP_INCHES + LINE_INCHES) + feetToPixels(sheet, defaults.median)) / 2;
      const width = lanes => lanes * feetToPixels(sheet, defaults.laneWidth) / 2;
      const opposite = { ...defaults, lanes: defaults.opposite };
      drawRoad(sheet, defaults, buildShape(sheet, defaults, offset(line, half + width(defaults.lanes)), new Map()), layers, "preview");
      drawRoad(sheet, opposite, buildShape(sheet, opposite, offset([...line].reverse(), half + width(opposite.lanes)), new Map()), layers, "preview");
    }
    // Every edit is an undo step (typing in a field is one step until it's left).
    function changed() {
      pruneGores(sheets.selected);
      render();
      save();
      window.StripeMaker.history.record();
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
      button.setAttribute("aria-keyshortcuts", "ArrowLeft ArrowRight ArrowUp ArrowDown Shift+F10");
      button.setAttribute("aria-haspopup", "menu");
      bindNode(button);
      // A flow arrow just inside the node, then a badge when the lane end tapers.
      button.arrow = Object.assign(document.createElement("span"), { className: "roadArrow" });
      button.taper = Object.assign(document.createElement("span"), { className: "roadTaper" });
      button.arrow.setAttribute("aria-hidden", "true");
      button.taper.setAttribute("aria-hidden", "true");
      nodeButtons.set(key, button);
      overlay.append(button.arrow, button.taper, button);
      return button;
    }
    // Every lane of every road shows a steering-wheel node at each end.
    function drawOverlay(solved = sheets.selected && solve(sheets.selected)) {
      const sheet = sheets.selected;
      overlay.hidden = !sheet || !active() || !sheet.inchesPerPixel;
      overlay.classList.toggle("drawing", Boolean(drawing || medianDraw));
      const seen = new Set();
      if (!overlay.hidden) {
        for (const road of sheet.roads) {
          for (let lane = 0; lane < road.lanes; lane++) {
            for (const e of [0, 1]) {
              const key = `${road.id}:${e}:${lane}`;
              const button = nodeButton(key);
              seen.add(key);
              button.classList.toggle("selected", road === selectedRoad || road === pairOf(sheet, selectedRoad));
              button.classList.toggle("laneSelected", road === selectedRoad && selectedLane?.e === e && selectedLane.lane === lane);
              const shape = shapeOf(sheet, road, solved);
              const tapered = shape.tapers.has(`${e}:${lane}`);
              button.setAttribute("aria-label", `Road ${road.id}, lane ${lane + 1} ${e ? "end" : "start"}${tapered ? (e ? ", lane drop taper" : ", lane add taper") : ""}`);
              button.setAttribute("aria-expanded", String(button === menuNode?.button));
              const at = place(button, nodePoint(sheet, road, e, lane, solved));
              const inward = inwardAt(shape.line, e);
              const travel = e ? { x: -inward.x, y: -inward.y } : inward;
              const angle = Math.atan2(travel.y, travel.x);
              button.arrow.style.left = `${at.x + inward.x * ARROW_PIXELS}px`;
              button.arrow.style.top = `${at.y + inward.y * ARROW_PIXELS}px`;
              button.arrow.style.setProperty("--angle", `${angle}rad`);
              // The wedge sits past the arrow and narrows toward the lane's zero-width end.
              button.taper.hidden = !tapered;
              button.taper.style.left = `${at.x + inward.x * TAPER_BADGE_PIXELS}px`;
              button.taper.style.top = `${at.y + inward.y * TAPER_BADGE_PIXELS}px`;
              button.taper.style.setProperty("--angle", `${angle + (e ? 0 : Math.PI)}rad`);
            }
          }
        }
      }
      for (const [key, button] of nodeButtons) {
        if (seen.has(key)) continue;
        button.remove();
        button.arrow.remove();
        button.taper.remove();
        nodeButtons.delete(key);
      }
      drawGoreButtons(sheet, solved);
      drawMedianOverlay(sheet);
      positionMenu();
      if (overlay.hidden) return;
      const anchor = drawing?.start ?? drawing?.end;
      startMarker.hidden = !anchor;
      if (anchor) place(startMarker, anchor);
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

    // Every place a gore can go shows a gore icon at its point; dragging it along
    // the gore's center marks the gore up to the icon.
    function goreButton(key) {
      let button = goreButtons.get(key);
      if (button) return button;
      button = document.createElement("button");
      button.type = "button";
      button.className = "goreHandle";
      button.dataset.gore = key;
      button.setAttribute("aria-keyshortcuts", "ArrowLeft ArrowRight ArrowUp ArrowDown Delete");
      bindGore(button);
      goreButtons.set(key, button);
      overlay.append(button);
      return button;
    }
    function drawGoreButtons(sheet, solved) {
      const seen = new Set();
      if (!overlay.hidden) {
        for (const candidate of goreCandidates(sheet, solved).values()) {
          const gore = sheet.gores.find(item => item.key === candidate.key);
          const button = goreButton(candidate.key);
          seen.add(candidate.key);
          const rest = GORE_ICON_PIXELS / sheet.view.scale;
          const at = Math.min(Math.max(gore ? feetToPixels(sheet, gore.length) : 0, rest), candidate.along.at(-1));
          const i = indexAt(candidate.along, at);
          const t = goreTangent(candidate.mid, i);
          place(button, candidate.mid[i]);
          button.style.setProperty("--angle", `${Math.atan2(t.y, t.x)}rad`);
          button.classList.toggle("marked", Boolean(gore));
          button.classList.toggle("selected", candidate.key === selectedGore);
          const kind = candidate.same ? "Gore" : "Traffic separation";
          button.setAttribute("aria-label", gore ? `${kind}, marked ${Math.round(gore.length)} ft` : `${kind}, unmarked. Drag along the gore to mark it.`);
        }
      }
      for (const [key, button] of goreButtons) {
        if (seen.has(key)) continue;
        button.remove();
        goreButtons.delete(key);
      }
      if (selectedGore && !seen.has(selectedGore) && !overlay.hidden) selectedGore = null;
    }
    function setGoreLength(sheet, key, feet) {
      let gore = sheet.gores.find(item => item.key === key);
      const candidate = goreCandidates(sheet, solve(sheet)).get(key);
      if (!candidate) return;
      feet = Math.max(0, Math.min(feet, candidate.along.at(-1) / feetToPixels(sheet, 1)));
      if (!gore && feet > 0) sheet.gores.push(gore = { key, length: feet, spacing: goreDefaultSpacing(candidate) });
      if (gore) gore.length = feet;
    }
    function bindGore(button) {
      let dragging = false;
      button.addEventListener("pointerdown", event => {
        if (event.button !== 0 || drawing) return;
        event.stopPropagation();
        button.setPointerCapture(event.pointerId);
        dragging = false;
        selectGore(button.dataset.gore);
      });
      button.addEventListener("pointermove", event => {
        if (!button.hasPointerCapture(event.pointerId)) return;
        const sheet = sheets.selected;
        const candidate = goreCandidates(sheet, solve(sheet)).get(button.dataset.gore);
        if (!candidate) return;
        dragging = true;
        // The marking follows the nearest point along the gore's center.
        const pointer = sheets.toImage(event.clientX, event.clientY);
        let nearest = 0;
        candidate.mid.forEach((p, i) => {
          const m = candidate.mid[nearest];
          if (Math.hypot(p.x - pointer.x, p.y - pointer.y) < Math.hypot(m.x - pointer.x, m.y - pointer.y)) nearest = i;
        });
        const s = candidate.along[nearest];
        setGoreLength(sheet, button.dataset.gore, s < GORE_ICON_PIXELS / sheet.view.scale / 2 ? 0 : s / feetToPixels(sheet, 1));
        render();
      });
      const finish = event => {
        if (!button.hasPointerCapture(event.pointerId)) return;
        button.releasePointerCapture(event.pointerId);
        if (dragging) changed();
      };
      button.addEventListener("pointerup", finish);
      button.addEventListener("pointercancel", finish);
      button.addEventListener("keydown", event => {
        const moves = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 };
        if (!moves[event.key]) return;
        event.preventDefault();
        event.stopPropagation();
        const sheet = sheets.selected;
        const gore = sheet.gores.find(item => item.key === button.dataset.gore);
        selectedGore = button.dataset.gore;
        setGoreLength(sheet, button.dataset.gore, (gore?.length ?? 0) + moves[event.key] * (event.shiftKey ? 50 : 5));
        changed();
      });
    }
    function selectGore(key) {
      selectedGore = key;
      selectedRoad = null;
      selectedLane = null;
      closeMenu();
      render();
    }
    function removeGore() {
      const sheet = sheets.selected;
      if (!sheet || !selectedGore) return;
      sheet.gores = sheet.gores.filter(gore => gore.key !== selectedGore);
      changed();
    }
    // While a median is drawn: its points so far and lines to the cursor and back to
    // the first point. Once selected: a handle on each point; dragging a shared
    // point moves every median that shares it.
    function drawMedianOverlay(sheet) {
      const show = !overlay.hidden && medianDraw;
      const path = show ? [...medianDraw.points, ...(medianDraw.cursor ? [medianDraw.cursor] : [])].map(p => sheets.toScreen(p)) : [];
      medianPreview.setAttribute("points", path.map(p => `${p.x},${p.y}`).join(" "));
      medianClosing.setAttribute("visibility", path.length > 2 ? "visible" : "hidden");
      if (path.length > 2) {
        Object.entries({ x1: path.at(-1).x, y1: path.at(-1).y, x2: path[0].x, y2: path[0].y }).forEach(([key, value]) => medianClosing.setAttribute(key, value));
      }
      medianPreviewPoints.replaceChildren(...(show ? medianDraw.points : []).map(p => {
        const at = sheets.toScreen(p);
        const mark = document.createElementNS(SVG, "circle");
        Object.entries({ cx: at.x, cy: at.y, r: 4 }).forEach(([key, value]) => mark.setAttribute(key, value));
        return mark;
      }));
      const median = !overlay.hidden && !medianDraw && medianOf(sheet, selectedMedian);
      const count = median ? median.points.length : 0;
      while (medianPoints.length > count) medianPoints.pop().remove();
      while (medianPoints.length < count) medianPoints.push(medianPointButton(medianPoints.length));
      medianPoints.forEach((button, i) => {
        place(button, median.points[i]);
        const shared = sharedPoints(sheet, median.points[i]).length > 1;
        button.classList.toggle("shared", shared);
        button.setAttribute("aria-label", `Median point ${i + 1} of ${count}${shared ? ", shared with another median" : ""}`);
      });
    }
    function medianPointButton(index) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "medianPoint";
      button.setAttribute("aria-keyshortcuts", "ArrowLeft ArrowRight ArrowUp ArrowDown Delete");
      const target = () => medianOf(sheets.selected, selectedMedian)?.points[index];
      let moving = null;
      button.addEventListener("pointerdown", event => {
        const point = target();
        if (event.button !== 0 || !point) return;
        event.stopPropagation();
        button.setPointerCapture(event.pointerId);
        moving = sharedPoints(sheets.selected, point);
      });
      button.addEventListener("pointermove", event => {
        if (!moving || !button.hasPointerCapture(event.pointerId)) return;
        const pointer = sheets.toImage(event.clientX, event.clientY);
        snapTarget = snapMedian(sheets.selected, pointer, new Set(moving));
        const goal = snapTarget ?? pointer;
        moving.forEach(p => {
          Object.assign(p, { x: goal.x, y: goal.y, on: goal.on && { ...goal.on } });
          if (!p.on) delete p.on;
        });
        render();
      });
      const finish = event => {
        if (!moving || !button.hasPointerCapture(event.pointerId)) return;
        button.releasePointerCapture(event.pointerId);
        moving = null;
        snapTarget = null;
        changed();
      };
      button.addEventListener("pointerup", finish);
      button.addEventListener("pointercancel", finish);
      nudgeKeys(button, (dx, dy) => {
        const point = target();
        if (!point) return false;
        // A nudged point leaves the edge it was anchored to.
        sharedPoints(sheets.selected, point).forEach(p => {
          Object.assign(p, { x: p.x + dx, y: p.y + dy });
          delete p.on;
        });
      });
      button.dataset.index = index;
      overlay.append(button);
      return button;
    }
    // A median keeps at least three points.
    function removeMedianPoint(index) {
      const median = medianOf(sheets.selected, selectedMedian);
      if (!median || median.points.length <= 3) return;
      median.points.splice(index, 1);
      changed();
      medianPoints[Math.min(index, medianPoints.length - 1)]?.focus();
    }
    function selectMedian(id) {
      selectedMedian = id;
      medianSheet = sheets.selected;
      selectedRoad = null;
      selectedLane = null;
      selectedGore = null;
      closeMenu();
      render();
    }
    function startMedian() {
      drawing = null;
      snapTarget = null;
      selectMedian(null);
      medianDraw = { points: [], cursor: null };
      render();
    }
    // Three or more points close the outline; fewer cancel it.
    function finishMedian() {
      const sheet = sheets.selected;
      const points = medianDraw?.points ?? [];
      medianDraw = null;
      snapTarget = null;
      if (!sheet || points.length < 3) return render();
      const median = {
        id: nextId(sheet.medians), type: defaults.medianType, spacing: defaults.medianSpacing,
        color: defaults.medianColor, lean: defaults.medianLean, points,
      };
      sheet.medians.push(median);
      selectMedian(median.id);
      changed();
    }
    function removeMedian() {
      const sheet = sheets.selected;
      sheet.medians = sheet.medians.filter(median => median.id !== selectedMedian);
      selectedMedian = null;
      changed();
    }
    // The median's own points count too, so clicking the first one closes it.
    function medianDrawPoint(sheet, clientX, clientY) {
      const point = sheets.toImage(clientX, clientY);
      snapTarget = snapMedian(sheet, point, new Set(), medianDraw.points);
      return snapTarget ? { x: snapTarget.x, y: snapTarget.y, ...(snapTarget.on && { on: { ...snapTarget.on } }) } : point;
    }
    const separationSpeed = feet => ({ 10: "30 mph or less", 20: "35–40 mph", 30: "45 mph", 40: "50 mph or more" })[feet];

    function updatePanel(solved) {
      const sheet = sheets.selected;
      const ready = Boolean(sheet?.inchesPerPixel);
      addButton.disabled = !ready;
      addButton.setAttribute("aria-pressed", String(Boolean(drawing)));
      addMedianButton.disabled = !ready;
      addMedianButton.setAttribute("aria-pressed", String(Boolean(medianDraw)));
      const median = medianOf(sheet, selectedMedian);
      deleteButton.disabled = !selectedRoad && !median && !sheet?.gores?.some(gore => gore.key === selectedGore);
      const values = selectedRoad ?? defaults;
      const partner = sheet && pairOf(sheet, selectedRoad);
      if (document.activeElement !== lanesInput) lanesInput.value = values.lanes;
      if (document.activeElement !== widthInput) widthInput.value = values.laneWidth;
      if (document.activeElement !== oppositeInput) oppositeInput.value = selectedRoad ? partner?.lanes ?? 0 : defaults.opposite;
      medianRow.hidden = selectedRoad ? !partner : !defaults.opposite;
      if (document.activeElement !== medianInput) {
        medianInput.value = partner ? pairLinks(sheet, selectedRoad, partner)[0]?.median ?? 0 : defaults.median;
      }
      splitRow.hidden = !partner;
      const lane = selectedRoad && selectedLane?.lane < selectedRoad.lanes ? selectedLane : null;
      laneFields.hidden = !lane || !solved;
      if (!laneFields.hidden) {
        const key = `${lane.e}:${lane.lane}`;
        const setting = selectedRoad.tapers?.[key];
        laneTitle.textContent = `Lane ${lane.lane + 1} ${lane.e ? "end" : "start"}`;
        if (document.activeElement !== taperSelect) taperSelect.value = setting?.mode ?? "auto";
        if (document.activeElement !== taperLength) taperLength.value = setting?.length ?? DEFAULT_TAPER_FEET;
        const tapering = shapeOf(sheet, selectedRoad, solved).tapers.has(key);
        const autoOff = (setting?.mode ?? "auto") === "auto" && !sheet.autoTapers && solved.auto.has(`${selectedRoad.id}:${key}`);
        taperState.textContent = autoOff ? "Auto tapers are off, so this lane stays full width. Choose Taper to taper it."
          : !tapering ? "No taper here."
          : lane.e ? "This lane narrows to nothing at its end (lane drop)." : "This lane widens from nothing at its start (lane add).";
      }
      autoTapersInput.disabled = !ready;
      autoTapersInput.checked = Boolean(sheet?.autoTapers);
      const candidate = selectedGore && solved && goreCandidates(sheet, solved).get(selectedGore);
      goreFields.hidden = !candidate;
      if (candidate) {
        const gore = sheet.gores.find(item => item.key === selectedGore);
        const spacing = gore?.spacing ?? goreDefaultSpacing(candidate);
        goreTitle.textContent = candidate.same ? "Gore" : "Traffic Separation";
        goreState.textContent = candidate.same
          ? "Channelization at a gore: 8\" white gore lines and 18\" white chevrons at 45°."
          : "Traffic separation: 6\" double yellow on each side and 18\" yellow diagonals at 45° between opposing traffic.";
        for (const input of [goreSpacing, goreSpacingValue]) {
          input.disabled = !gore;
          if (document.activeElement !== input) input.value = spacing;
        }
        if (document.activeElement !== goreLength) goreLength.value = Math.round(gore?.length ?? 0);
        goreLength.max = Math.floor(candidate.along.at(-1) / feetToPixels(sheet, 1));
        goreSpacingHint.textContent = candidate.same
          ? `Standard chevron spacing is ${GORE_SPACING_FEET} ft.`
          : `Spacing by posted speed: 10 ft ≤30 mph, 20 ft 35–40, 30 ft 45, 40 ft ≥50.${separationSpeed(spacing) ? ` ${spacing} ft fits ${separationSpeed(spacing)}.` : ""}`;
      }
      medianFields.hidden = !median && !medianDraw;
      if (!medianFields.hidden) {
        const values = median ?? { type: defaults.medianType, spacing: defaults.medianSpacing, color: defaults.medianColor, lean: defaults.medianLean };
        medianTitle.textContent = median ? `${MEDIAN_TYPES[values.type]} Median` : "New Median";
        if (document.activeElement !== medianType) medianType.value = values.type;
        paintedFields.hidden = values.type !== "painted";
        if (document.activeElement !== medianColor) medianColor.value = values.color ?? "yellow";
        if (document.activeElement !== medianLean) medianLean.value = values.lean ?? "right";
        for (const input of [medianSpacing, medianSpacingValue]) {
          if (document.activeElement !== input) input.value = values.spacing ?? MEDIAN_SPACING_FEET;
        }
        const spacing = values.spacing ?? MEDIAN_SPACING_FEET;
        medianSpacingHint.textContent = `Spacing by posted speed: 10 ft ≤30 mph, 20 ft 35–40, 30 ft 45, 40 ft ≥50.${separationSpeed(spacing) ? ` ${spacing} ft fits ${separationSpeed(spacing)}.` : ""}`;
        medianState.textContent = {
          grass: "Unpaved turf median.",
          concrete: "Raised concrete median with a 6\" curb along its edge.",
          painted: values.color === "white"
            ? "Painted median between same-direction traffic: 8\" white outline and 18\" white diagonals at 45°."
            : "Painted median between opposing traffic: a second 6\" yellow line 10\" inside each road's yellow edge line, and 18\" yellow diagonals at 45°.",
        }[values.type];
      }
      workspace.classList.toggle("drawing", Boolean(drawing || medianDraw));
      workspace.classList.toggle("elementsActive", active());
      if (!sheet) hint.textContent = "Upload a sheet first.";
      else if (!ready) hint.textContent = "Set this sheet's scale first (Sheets › Set Scale) so lanes draw true size.";
      else if (medianDraw) hint.textContent = medianDraw.points.length < 3
        ? "Click the median's corners. Points snap to road and gore corners and edges, and to other medians' points."
        : "Keep clicking corners. Click the first point, double-click, or press Esc to close the median."
      else if (drawing?.end && !drawing.start) hint.textContent = "Click where the new road starts; it ends at the chosen lane's start. Esc cancels.";
      else if (drawing && !drawing.start) hint.textContent = defaults.opposite
        ? "Click the start of the two-way road's centerline." : "Click the road's start point, a lane's end node to continue from it, or a road's edge line to branch off it.";
      else if (drawing) hint.textContent = defaults.opposite
        ? "Click the next node of the centerline; keep clicking to continue, and double-click or press Esc to finish. Lanes travel start to end; opposite lanes return."
        : drawing.last
          ? "Click to add the next node, or a lane's start node or edge line to join it. Double-click or press Esc to finish."
          : "Click the next node, a lane's start node to join it, or a road's edge line to merge into it. Keep clicking to continue the road; double-click or press Esc to finish. Traffic flows from start to end.";
      else if (candidate) hint.textContent = sheet.gores.some(gore => gore.key === selectedGore)
        ? "Drag the gore icon along the gore to change how far the marking reaches. Drag it back to the point to remove it."
        : "Drag the gore icon along the center of the gore to mark it.";
      else if (median) hint.textContent = "Median selected. Drag its points to reshape it; points shared with another median move both. Delete removes a focused point or the median."
      else if (lane) hint.textContent = "Lane end selected. Set its taper below, drag the node to move the road end, or right-click it for more.";
      else if (partner) hint.textContent = "Two-way road. Right-click a lane node for actions like curving, tapering, or splitting into one-way roads.";
      else if (selectedRoad) hint.textContent = "Drag a lane node to move the road end, onto another road's node to join them, or onto a road's edge line to feed its edge lane. Right-click a node for actions like curving, tapering, or making the road two-way.";
      else hint.textContent = goreButtons.size
        ? "Add a road or median, or click one to edit it. Drag a gore icon along a gore to mark it. Right-click any lane node for actions."
        : "Add a road (set Opposite lanes for two-way) or median, or click one to edit it. Right-click any lane node for actions.";
    }

    function selectRoad(road) {
      selectedGore = null;
      selectedMedian = null;
      selectedRoad = road;
      selectedLane = null;
      render();
    }
    // Drawing can begin from a lane's end (`start`) or toward a lane's start (`end`).
    function startDrawing({ start = null, end = null } = {}) {
      drawing = { start, end, cursor: null };
      medianDraw = null;
      selectedMedian = null;
      selectedRoad = null;
      selectedLane = null;
      render();
    }
    // Finishing a chain of road segments selects the last one.
    function stopDrawing() {
      if (drawing?.last) selectedRoad = roadOf(sheets.selected, drawing.last) ?? null;
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
      reanchor(sheet, solved, [host]);
    }
    // Moves each joint so its root road ends up where it was before a change.
    function reanchor(sheet, before, joints) {
      const after = solve(sheet);
      for (const joint of joints) {
        const here = attachments(sheet, joint);
        const item = here.find(i => i.road.id === joint.root && before.has(`${i.road.id}:${i.e}`))
          ?? here.find(i => before.has(`${i.road.id}:${i.e}`));
        if (!item) continue;
        const was = before.get(`${item.road.id}:${item.e}`);
        const now = after.get(`${item.road.id}:${item.e}`);
        joint.x += was.x - now.x;
        joint.y += was.y - now.y;
      }
    }
    // After links or roads leave a joint, each still-linked group keeps its own
    // joint, left where it was.
    function regroup(sheet, joint, before) {
      const here = attachments(sheet, joint);
      if (!here.length) {
        sheet.joints.splice(sheet.joints.indexOf(joint), 1);
        return;
      }
      const results = [joint];
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
        if (!first) results.push(target);
        Object.assign(target, { x: at.x, y: at.y, root: rootId });
        if (!first) {
          here.filter(item => group.has(item.road.id)).forEach(item => { item.end.joint = target.id; });
          target.links = joint.links.filter(link => group.has(link.a) && group.has(link.b));
          joint.links = joint.links.filter(link => !target.links.includes(link));
        }
        first = false;
      }
      // An end left on its own with no curve set goes back to pulling straight.
      for (const result of results) {
        const alone = attachments(sheet, result);
        if (alone.length === 1 && alone[0].end.length == null) {
          result.dir = null;
          alone[0].end.sign = 1;
        }
      }
      reanchor(sheet, before, results);
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
    addMedianButton.addEventListener("click", () => (medianDraw ? finishMedian() : startMedian()));
    for (const [input, key, field] of [[medianColor, "medianColor", "color"], [medianLean, "medianLean", "lean"]]) {
      input.addEventListener("change", () => {
        const median = medianOf(sheets.selected, selectedMedian);
        defaults[key] = input.value;
        if (!median) return render();
        median[field] = input.value;
        changed();
      });
    }
    medianType.addEventListener("change", () => {
      const median = medianOf(sheets.selected, selectedMedian);
      defaults.medianType = medianType.value;
      if (!median) return render();
      median.type = medianType.value;
      changed();
    });
    for (const input of [medianSpacing, medianSpacingValue]) {
      input.addEventListener("input", () => {
        const feet = Number(input.value);
        if (!(feet >= MIN_GORE_SPACING_FEET && feet <= MAX_GORE_SPACING_FEET)) return;
        defaults.medianSpacing = feet;
        const median = medianOf(sheets.selected, selectedMedian);
        if (!median) return render();
        median.spacing = feet;
        changed();
      });
    }
    deleteButton.addEventListener("click", deleteSelection);
    function deleteSelection() {
      if (selectedGore) removeGore();
      else if (medianOf(sheets.selected, selectedMedian)) removeMedian();
      else deleteRoad();
    }
    document.getElementById("removeGore").addEventListener("click", removeGore);
    autoTapersInput.addEventListener("change", () => {
      if (!sheets.selected) return;
      sheets.selected.autoTapers = autoTapersInput.checked;
      changed();
    });
    goreLength.addEventListener("input", () => {
      const feet = Number(goreLength.value);
      if (!(feet >= 0) || !selectedGore) return;
      setGoreLength(sheets.selected, selectedGore, feet);
      changed();
    });
    for (const input of [goreSpacing, goreSpacingValue]) {
      input.addEventListener("input", () => {
        const feet = Number(input.value);
        const gore = sheets.selected?.gores.find(item => item.key === selectedGore);
        if (!gore || !(feet >= MIN_GORE_SPACING_FEET && feet <= MAX_GORE_SPACING_FEET)) return;
        gore.spacing = feet;
        changed();
      });
    }
    // Deleting a two-way road deletes both sides.
    function deleteRoad() {
      const sheet = sheets.selected;
      if (!sheet?.roads || !selectedRoad) return;
      removeRoads(sheet, [selectedRoad, pairOf(sheet, selectedRoad)].filter(Boolean));
      selectedRoad = null;
      selectedLane = null;
      changed();
    }
    function removeRoads(sheet, roads) {
      const before = solve(sheet);
      const ids = roads.map(road => road.id);
      sheet.roads = sheet.roads.filter(road => !ids.includes(road.id));
      const joints = new Set(roads.flatMap(road => road.ends.map(end => jointOf(sheet, end.joint))).filter(Boolean));
      for (const joint of joints) {
        joint.links = joint.links.filter(link => !ids.includes(link.a) && !ids.includes(link.b));
        regroup(sheet, joint, before);
      }
    }
    // Adds the opposite side of a two-way road on the shared joints. With `keep`,
    // the existing road stays put; otherwise only joints shared with other roads
    // hold still, so a newly drawn road's clicked line becomes its centerline.
    function addOpposite(sheet, road, lanes, median, keep) {
      const before = solve(sheet);
      const joints = road.ends.map(end => jointOf(sheet, end.joint));
      const shared = joints.filter(joint => attachments(sheet, joint).length > 1);
      const opposite = {
        id: nextId(sheet.roads), lanes, laneWidth: road.laneWidth,
        ends: [1, 0].map(e => ({ joint: road.ends[e].joint, sign: -road.ends[e].sign, length: road.ends[e].length })),
      };
      joints.forEach((joint, e) => {
        if (!joint.dir) {
          const travel = travelAt(road, e, before);
          joint.dir = { x: travel.x * road.ends[e].sign, y: travel.y * road.ends[e].sign };
        }
        joint.links.push({ a: road.id, ai: 0, b: opposite.id, bi: 0, pair: true, median });
      });
      sheet.roads.push(opposite);
      reanchor(sheet, before, keep ? joints : shared);
      return opposite;
    }
    // Separates a two-way road into two one-way roads, left in place.
    function splitRoad() {
      const sheet = sheets.selected;
      const partner = pairOf(sheet, selectedRoad);
      if (!partner) return;
      const before = solve(sheet);
      for (const end of partner.ends) {
        const joint = jointOf(sheet, end.joint);
        joint.links = joint.links.filter(link => !(link.pair && [link.a, link.b].includes(partner.id) && [link.a, link.b].includes(selectedRoad.id)));
        regroup(sheet, joint, before);
      }
      changed();
    }
    document.getElementById("splitRoad").addEventListener("click", splitRoad);
    oppositeInput.addEventListener("input", () => {
      const lanes = Math.round(Number(oppositeInput.value));
      if (!(lanes >= 0 && lanes <= MAX_LANES)) return;
      defaults.opposite = lanes;
      const sheet = sheets.selected;
      if (!selectedRoad || !sheet) return render();
      const partner = pairOf(sheet, selectedRoad);
      if (partner && !lanes) removeRoads(sheet, [partner]);
      else if (partner) partner.lanes = lanes;
      else if (lanes) addOpposite(sheet, selectedRoad, lanes, defaults.median, true);
      changed();
    });
    oppositeInput.addEventListener("change", () => {
      oppositeInput.value = selectedRoad ? pairOf(sheets.selected, selectedRoad)?.lanes ?? 0 : defaults.opposite;
    });
    medianInput.addEventListener("input", () => {
      const feet = Number(medianInput.value);
      if (!(feet >= 0 && feet <= MAX_MEDIAN_FEET)) return;
      defaults.median = feet;
      const sheet = sheets.selected;
      const partner = sheet && pairOf(sheet, selectedRoad);
      if (!partner) return render();
      pairLinks(sheet, selectedRoad, partner).forEach(link => { link.median = feet; });
      changed();
    });
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
          // Both sides of a two-way road share a lane width.
          const partner = key === "laneWidth" && pairOf(sheets.selected, selectedRoad);
          if (partner) partner.laneWidth = value;
          changed();
        } else render();
      });
      input.addEventListener("change", () => {
        input.value = (selectedRoad ?? defaults)[key];
      });
    }
    bindNumber(lanesInput, "lanes", 1, MAX_LANES, Math.round);
    bindNumber(widthInput, "laneWidth", MIN_LANE_WIDTH, MAX_LANE_WIDTH, value => Math.round(value * 2) / 2);

    // The nearest point on a road's edge line within `radius`, away from the road's
    // ends (where lane nodes are). A new road started or ended there branches off
    // the road as a split or merge.
    function snapEdge(sheet, solved, point, radius, exclude = []) {
      let best = null;
      for (const road of sheet.roads) {
        if (exclude.includes(road)) continue;
        const shape = shapeOf(sheet, road, solved);
        const clear = feetToPixels(sheet, road.laneWidth);
        // A two-way road's left edges are its centerline, so only its outer edges snap.
        for (const [side, k] of pairOf(sheet, road) ? [["R", road.lanes]] : [["L", 0], ["R", road.lanes]]) {
          const edge = boundary(shape, k);
          const total = polylineLength(edge);
          let walked = 0;
          for (let i = 0; i < edge.length - 1; i++) {
            const p = edge[i];
            const q = edge[i + 1];
            const length = Math.hypot(q.x - p.x, q.y - p.y);
            const f = length ? Math.max(0, Math.min(1, ((point.x - p.x) * (q.x - p.x) + (point.y - p.y) * (q.y - p.y)) / (length * length))) : 0;
            const at = { x: p.x + (q.x - p.x) * f, y: p.y + (q.y - p.y) * f };
            const distance = Math.hypot(at.x - point.x, at.y - point.y);
            const along = walked + length * f;
            walked += length;
            if (distance > radius || along < clear || along > total - clear || (best && distance >= best.distance)) continue;
            // The center of the lane along this edge, for lanes fed straight into it.
            const right = rightOf(unit({ x: q.x - p.x, y: q.y - p.y }));
            const inward = (side === "R" ? -1 : 1) * feetToPixels(sheet, road.laneWidth) / 2;
            const center = { x: at.x + right.x * inward, y: at.y + right.y * inward };
            best = { road, side, t: (i + f) / (edge.length - 1), x: at.x, y: at.y, center, distance, edge: true };
          }
        }
      }
      return best;
    }
    // Cuts a road in two at curve parameter `t`, keeping its shape (de Casteljau),
    // on a new joint where the two parts stay joined lane to lane. A two-way road is
    // cut on both sides. Returns the joint and the part after the cut.
    function cutRoad(sheet, road, t) {
      const solved = solve(sheet);
      const partner = pairOf(sheet, road);
      const { a, c0, c1, b } = curveOf(sheet, road, solved);
      const lerp = (p, q) => ({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
      const p01 = lerp(a, c0);
      const p12 = lerp(c0, c1);
      const p23 = lerp(c1, b);
      const p012 = lerp(p01, p12);
      const p123 = lerp(p12, p23);
      const m = lerp(p012, p123);
      const distance = (p, q) => Math.hypot(q.x - p.x, q.y - p.y);
      const pulls = { start: a.travel ? distance(a, p01) : null, before: distance(p012, m), after: distance(m, p123), end: b.travel ? distance(p23, b) : null };
      const joint = newJoint(sheet, m, road.id, unit(distance(p012, p123) > 1e-6 ? { x: p123.x - p012.x, y: p123.y - p012.y } : { x: b.x - a.x, y: b.y - a.y }));
      const rename = (at, from, to) => {
        const far = jointOf(sheet, at);
        far.links.forEach(link => {
          if (link.a === from) link.a = to;
          if (link.b === from) link.b = to;
        });
        if (far.root === from) far.root = to;
        sheet.gores.forEach(gore => { gore.key = gore.key.split("|").map(end => (end === `${from}:1` ? `${to}:1` : end)).sort().join("|"); });
        openCurves.delete(`${from}:1`);
      };
      // The far end's tapers travel with the part after the cut.
      const split = (from, to) => {
        to.tapers = Object.fromEntries(Object.entries(from.tapers ?? {}).filter(([key]) => key.startsWith("1:")));
        from.tapers = Object.fromEntries(Object.entries(from.tapers ?? {}).filter(([key]) => !key.startsWith("1:")));
      };
      const piece = (from, ends) => {
        const made = { id: nextId(sheet.roads), lanes: from.lanes, laneWidth: from.laneWidth, ends };
        sheet.roads.push(made);
        return made;
      };
      const after = piece(road, [{ joint: joint.id, sign: 1, length: pulls.after }, { ...road.ends[1], length: pulls.end }]);
      rename(road.ends[1].joint, road.id, after.id);
      split(road, after);
      road.ends[0].length = pulls.start;
      road.ends[1] = { joint: joint.id, sign: 1, length: pulls.before };
      joint.links.push({ a: road.id, ai: 0, b: after.id, bi: 0 });
      if (partner) {
        const median = pairLinks(sheet, road, partner)[0]?.median ?? 0;
        const back = piece(partner, [{ joint: joint.id, sign: -1, length: pulls.before }, { ...partner.ends[1], length: pulls.start }]);
        rename(partner.ends[1].joint, partner.id, back.id);
        split(partner, back);
        partner.ends[0].length = pulls.end;
        partner.ends[1] = { joint: joint.id, sign: -1, length: pulls.after };
        joint.links.push({ a: partner.id, ai: 0, b: back.id, bi: 0 }, { a: road.id, ai: 0, b: back.id, bi: 0, pair: true, median });
        rehomeMedians(sheet, [partner, back]);
      }
      rehomeMedians(sheet, [road, after]);
      return { joint, after };
    }
    // Joins end `e` of a new road to the edge line it was drawn onto: the edge's road
    // is cut there, and the new road sits beside it, edge line on edge line.
    function attachToEdge(sheet, road, e, point) {
      const target = snapEdge(sheet, solve(sheet), point, 1 / sheet.view.scale + 0.5, [road]);
      if (!target) return;
      const { joint, after } = cutRoad(sheet, target.road, target.t);
      const own = jointOf(sheet, road.ends[e].joint);
      const solved = solve(sheet);
      const sign = dot(travelAt(road, e, solved), joint.dir) < 0 ? -1 : 1;
      road.ends[e] = { ...road.ends[e], joint: joint.id, sign };
      if (!attachments(sheet, own).length) sheet.joints.splice(sheet.joints.indexOf(own), 1);
      // The new road's edge that faces the cut road: its left edge when it's on the
      // right going the same way, and so on.
      const facing = (target.side === "R") === (sign === 1) ? "L" : "R";
      joint.links.push({ a: after.id, ai: target.side, b: road.id, bi: facing });
    }
    // Joins a dragged lane end head-on to the lane along an edge line: the edge's
    // road is cut there and the dragged lane carries straight into (or out of) its
    // outermost lane, like a ramp feeding the edge lane. Everything joined at the
    // dragged end comes along, as with lane-to-lane joins.
    function feedEdge(sheet, road, e, lane, edgePoint) {
      const moving = jointOf(sheet, road.ends[e].joint);
      const target = snapEdge(sheet, solve(sheet), edgePoint, 1 / sheet.view.scale + 0.5, attachments(sheet, moving).map(item => item.road));
      if (!target) return;
      const { joint, after } = cutRoad(sheet, target.road, target.t);
      const solved = solve(sheet);
      for (const item of attachments(sheet, moving)) {
        item.end.sign = dot(travelAt(item.road, item.e, solved), joint.dir) < 0 ? -1 : 1;
        item.end.joint = joint.id;
      }
      joint.links.push(...moving.links, { a: after.id, ai: target.side === "R" ? after.lanes - 1 : 0, b: road.id, bi: lane });
      sheet.joints.splice(sheet.joints.indexOf(moving), 1);
    }

    // While drawing, points snap to lane nodes so the new road joins them, or to a
    // road's edge line to branch off it (one-way roads only).
    function drawingPoint(sheet, clientX, clientY) {
      const point = sheets.toImage(clientX, clientY);
      const solved = solve(sheet);
      snapTarget = snapLane(sheet, solved, point, drawing.start ? 1 : 0)
        ?? (defaults.opposite ? null : snapEdge(sheet, solved, point, SNAP_PIXELS / sheet.view.scale));
      return snapTarget ? { x: snapTarget.x, y: snapTarget.y, target: snapTarget } : point;
    }

    // A click (not a pan) places road points while drawing, otherwise selects a road.
    let press = null;
    workspace.addEventListener("pointerdown", event => {
      if (event.isPrimary) press = { x: event.clientX, y: event.clientY };
    });
    workspace.addEventListener("pointermove", event => {
      const sheet = sheets.selected;
      if (medianDraw && !event.buttons && sheet?.inchesPerPixel && active()) {
        medianDraw.cursor = medianDrawPoint(sheet, event.clientX, event.clientY);
        return drawOverlay();
      }
      if (!drawing || event.buttons || !sheet?.inchesPerPixel || !active()) return;
      const point = drawingPoint(sheet, event.clientX, event.clientY);
      if (drawing.start || drawing.end) drawing.cursor = point;
      render();
    });
    workspace.addEventListener("click", event => {
      const sheet = sheets.selected;
      if (!active() || !sheet?.inchesPerPixel || !press || event.target.closest(".roadNode, .roadControl, .medianPoint")) return;
      if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > 4) return;
      if (medianDraw) {
        const point = medianDrawPoint(sheet, event.clientX, event.clientY);
        const { points } = medianDraw;
        if (points.length > 2 && samePoint(point, points[0])) return finishMedian();
        if (!points.some(p => samePoint(p, point))) points.push(point);
        medianDraw.cursor = point;
        return render();
      }
      if (!drawing) {
        const point = sheets.toImage(event.clientX, event.clientY);
        const median = medianAt(sheet, point);
        if (median) return selectMedian(median);
        const road = roadAt(sheet, point);
        const gore = !road && goreAt(sheet, point);
        return gore ? selectGore(gore) : selectRoad(road);
      }
      layerFor(sheet);
      const point = drawingPoint(sheet, event.clientX, event.clientY);
      if (!drawing.start && !drawing.end) {
        drawing.start = point;
        drawing.cursor = point;
        return render();
      }
      const [start, end] = drawing.start ? [drawing.start, point] : [point, drawing.end];
      if (Math.hypot(end.x - start.x, end.y - start.y) * sheet.view.scale < 4) return;
      const road = { id: nextId(sheet.roads), lanes: defaults.lanes, laneWidth: defaults.laneWidth, ends: [] };
      road.ends = [start, end].map(p => ({ joint: newJoint(sheet, p, road.id).id, sign: 1, length: null }));
      sheet.roads.push(road);
      // A new road lines its matching lane up with the lane it was drawn from or to.
      [start, end].forEach((p, e) => {
        if (p.target?.edge) attachToEdge(sheet, road, e, p);
        else if (p.target) connect(sheet, road, e, Math.min(p.target.lane, road.lanes - 1), p.target);
      });
      if (defaults.opposite) addOpposite(sheet, road, defaults.opposite, defaults.median, false);
      snapTarget = null;
      // Like Cities: Skylines, each click adds a node: the road carries on from the
      // segment just drawn until a double-click or Esc, or until it joins a lane
      // or edge line. A two-way road carries on from its centerline.
      if (drawing.start && !end.target) {
        const solved = solve(sheet);
        const joint = jointOf(sheet, road.ends[1].joint);
        const at = defaults.opposite ? { x: joint.x, y: joint.y } : solved.get(`${road.id}:1`);
        const start = { x: at.x, y: at.y, target: { road, e: 1, lane: 0 } };
        drawing = { start, end: null, cursor: start, last: road.id };
        selectedRoad = null;
      } else {
        drawing = null;
        selectedRoad = road;
      }
      changed();
    });
    // A double-click finishes the road or median being drawn (its first click has
    // already placed the last node), and must not trigger the refit.
    workspace.addEventListener("dblclick", event => {
      if (!drawing && !medianDraw) return;
      event.preventDefault();
      if (drawing) stopDrawing();
      else finishMedian();
    }, true);

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
        // Right-click (or Control-click) opens the node menu instead of dragging.
        if (event.button !== 0 || event.ctrlKey) return;
        closeMenu();
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
        // Lane nodes first, then edge lines, which pull the dragged lane onto the
        // center of the edge lane it will feed.
        const moving = attachments(sheet, jointOf(sheet, road.ends[e].joint)).map(item => item.road);
        snapTarget = snapLane(sheet, solved, wanted, e, road);
        const edge = !snapTarget && snapEdge(sheet, solved, wanted, SNAP_PIXELS / sheet.view.scale, [...moving, road]);
        if (edge) snapTarget = { ...edge, x: edge.center.x, y: edge.center.y, edgePoint: { x: edge.x, y: edge.y } };
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
        if (snapTarget?.edge && event.type === "pointerup") feedEdge(drag.sheet, drag.road, drag.e, drag.lane, snapTarget.edgePoint);
        else if (snapTarget && event.type === "pointerup") connect(drag.sheet, drag.road, drag.e, drag.lane, snapTarget);
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
        if (openCurves.has(`${node.road.id}:${node.e}`)) hideCurve(node);
        else showCurve(node);
      });
      button.addEventListener("contextmenu", event => {
        event.preventDefault();
        event.stopPropagation();
        openMenu(button);
      });
      button.addEventListener("keydown", event => {
        if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
          event.preventDefault();
          openMenu(button);
        }
      });
    }
    function showCurve(node) {
      openCurves.add(`${node.road.id}:${node.e}`);
      const solved = solve(node.sheet);
      const joint = jointOf(node.sheet, node.road.ends[node.e].joint);
      const handle = handlePoint(node.sheet, node.road, node.e, solved);
      joint.dir ??= travelAt(node.road, node.e, solved);
      node.road.ends[node.e].length ??= Math.hypot(handle.at.x - handle.from.x, handle.at.y - handle.from.y);
      selectedRoad = node.road;
      changed();
    }
    function hideCurve(node) {
      openCurves.delete(`${node.road.id}:${node.e}`);
      render();
    }
    // Returns a road end to its default pull; a free end goes straight again.
    function straighten(sheet, road, e) {
      const end = road.ends[e];
      end.length = null;
      if (attachments(sheet, jointOf(sheet, end.joint)).length === 1) jointOf(sheet, end.joint).dir = null;
      openCurves.delete(`${road.id}:${e}`);
      changed();
    }

    // Right-clicking a lane node opens a popover of actions for that road end,
    // with a pointer to the node, like a macOS popover.
    function menuItems(node) {
      const { sheet, road, e, lane } = node;
      const end = road.ends[e];
      const partner = pairOf(sheet, road);
      // A two-way road's own opposite side doesn't count as something to pull free from.
      const joined = attachments(sheet, jointOf(sheet, end.joint)).some(item => item.road !== road && item.road !== partner);
      const curveOpen = openCurves.has(`${road.id}:${e}`);
      const here = { ...lanePoint(sheet, road, e, lane, solve(sheet)), target: { road, e, lane } };
      const taper = road.tapers?.[`${e}:${lane}`]?.mode ?? "auto";
      const setTaperMode = mode => () => {
        selectedRoad = road;
        selectedLane = { e, lane };
        setTaper({ mode });
      };
      return [
        { label: curveOpen ? "Hide Curve Handle" : "Curve This End", run: () => (curveOpen ? hideCurve(node) : showCurve(node)) },
        end.length != null && { label: "Straighten", run: () => straighten(sheet, road, e) },
        { label: e ? "Continue Road From Here" : "Draw Road Into Here", run: () => startDrawing({ [e ? "start" : "end"]: here }) },
        joined && { label: "Pull End Free", run: () => { detach(sheet, road, e); changed(); } },
        "separator",
        { label: "Auto Taper", checked: taper === "auto", run: setTaperMode("auto") },
        { label: e ? "Taper (Lane Drop)" : "Taper (Lane Add)", checked: taper === "taper", run: setTaperMode("taper") },
        { label: "No Taper", checked: taper === "none", run: setTaperMode("none") },
        "separator",
        partner ? { label: "Make One-Way", run: () => { removeRoads(sheet, [partner]); changed(); } }
          : { label: "Make Two-Way", run: () => { addOpposite(sheet, road, road.lanes, defaults.median, true); changed(); } },
        partner && { label: "Split Into One-Way Roads", run: splitRoad },
        { label: partner ? "Delete Two-Way Road" : "Delete Road", run: deleteRoad },
      ].filter(Boolean);
    }
    function openMenu(button) {
      const node = nodeTarget(button);
      if (!node || drawing) return;
      closeMenu();
      selectedRoad = node.road;
      selectedLane = { e: node.e, lane: node.lane };
      menuNode = { button, key: `${node.road.id}:${node.e}:${node.lane}` };
      nodeMenu.setAttribute("aria-label", `Road ${node.road.id}, lane ${node.lane + 1} ${node.e ? "end" : "start"}`);
      nodeMenu.replaceChildren(...menuItems(node).map(item => {
        const li = document.createElement("li");
        li.setAttribute("role", item === "separator" ? "separator" : "presentation");
        if (item === "separator") return li;
        const entry = document.createElement("button");
        entry.type = "button";
        entry.textContent = item.label;
        entry.setAttribute("role", "checked" in item ? "menuitemradio" : "menuitem");
        if ("checked" in item) entry.setAttribute("aria-checked", String(item.checked));
        entry.addEventListener("click", () => {
          closeMenu(true);
          item.run();
        });
        li.append(entry);
        return li;
      }));
      nodeMenu.hidden = false;
      render();
      nodeMenu.querySelector("button")?.focus({ preventScroll: true });
    }
    function closeMenu(restoreFocus = false) {
      if (!menuNode) return;
      const { button } = menuNode;
      menuNode = null;
      nodeMenu.hidden = true;
      nodeMenu.replaceChildren();
      button.setAttribute("aria-expanded", "false");
      if (restoreFocus && button.isConnected) button.focus({ preventScroll: true });
    }
    // Sits beside its node (right, or left if there's no room) with the pointer
    // aimed at the node, and follows it while the sheet pans or zooms.
    function positionMenu() {
      if (!menuNode) return;
      const button = nodeButtons.get(menuNode.key);
      if (!button || overlay.hidden) return closeMenu();
      const node = button.getBoundingClientRect();
      const x = node.left + node.width / 2;
      const y = node.top + node.height / 2;
      const gap = node.width / 2 + 10;
      const margin = 8;
      const { width, height } = nodeMenu.getBoundingClientRect();
      const right = x + gap + width + margin <= innerWidth || x - gap - width < margin;
      const top = Math.min(Math.max(y - 22, margin), Math.max(margin, innerHeight - height - margin));
      nodeMenu.dataset.side = right ? "right" : "left";
      nodeMenu.style.left = `${right ? x + gap : x - gap - width}px`;
      nodeMenu.style.top = `${top}px`;
      nodeMenu.style.setProperty("--pointer-y", `${Math.min(Math.max(y - top, 12), height - 12)}px`);
    }
    nodeMenu.addEventListener("keydown", event => {
      if (event.key === "Tab") return closeMenu(true);
      if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const items = [...nodeMenu.querySelectorAll("button")];
      const index = items.indexOf(document.activeElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
        : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      items[next]?.focus();
    });
    document.addEventListener("pointerdown", event => {
      if (menuNode && !nodeMenu.contains(event.target)) closeMenu();
    }, true);
    window.addEventListener("resize", positionMenu);

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
      if (menuNode && (event.key === "Escape" || nodeMenu.contains(event.target))) {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        closeMenu(true);
      } else if (medianDraw && (event.key === "Escape" || (event.key === "Enter" && !typing))) {
        event.preventDefault();
        event.stopPropagation();
        finishMedian();
      } else if ((event.key === "Delete" || event.key === "Backspace") && event.target.closest?.(".medianPoint")) {
        event.preventDefault();
        removeMedianPoint(medianPoints.indexOf(event.target.closest(".medianPoint")));
      } else if (event.key === "Escape" && (drawing || selectedRoad || selectedGore || selectedMedian)) {
        event.stopPropagation();
        drawing ? stopDrawing() : selectRoad(null);
      } else if ((event.key === "Delete" || event.key === "Backspace") && !typing && !deleteButton.disabled) {
        event.preventDefault();
        deleteSelection();
      }
    }, true);

    new MutationObserver(() => {
      if (!active()) {
        drawing = null;
        medianDraw = null;
        snapTarget = null;
        closeMenu();
      }
      render();
    }).observe(editor, { attributes: true, attributeFilter: ["hidden"] });
    document.addEventListener("sheetview", () => { if (active()) drawOverlay(); });
    // Undo and redo replace the sheet's roads, so selection follows by id.
    document.addEventListener("sheethistory", () => {
      const sheet = sheets.selected;
      sheet && (sheet.gores ??= []);
      sheet && (sheet.medians ??= []);
      if (!medianOf(sheet, selectedMedian)) selectedMedian = null;
      medianDraw = null;
      selectedRoad = sheet?.roads && selectedRoad ? roadOf(sheet, selectedRoad.id) ?? null : null;
      if (!(selectedRoad && selectedLane?.lane < selectedRoad.lanes)) selectedLane = null;
      for (const key of openCurves) if (!sheet?.roads?.some(road => key.startsWith(`${road.id}:`))) openCurves.delete(key);
      drawing = null;
      drag = null;
      snapTarget = null;
      closeMenu();
      render();
    });
    document.addEventListener("sheetchange", () => {
      if (!sheets.selected?.roads?.includes(selectedRoad)) {
        selectedRoad = null;
        selectedLane = null;
      }
      if (sheets.selected !== medianSheet) selectedMedian = null;
      drawing = null;
      medianDraw = null;
      snapTarget = null;
      closeMenu();
      render();
    });
    render();
  });
})();
