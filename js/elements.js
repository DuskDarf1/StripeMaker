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
    const defaults = { lanes: 1, laneWidth: 12, opposite: 0, median: 0 };
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
    overlay.innerHTML = `<svg aria-hidden="true"><line class="roadControlLine"/><line class="roadControlLine"/><circle class="roadSnap" r="15"/></svg>
      <span class="roadNode preview" aria-hidden="true"></span>
      <button type="button" class="roadControl" aria-label="Start curve handle" aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown"></button>
      <button type="button" class="roadControl" aria-label="End curve handle" aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown"></button>`;
    const controlLines = [...overlay.querySelectorAll("line")];
    const snapRing = overlay.querySelector(".roadSnap");
    const startMarker = overlay.querySelector(".roadNode.preview");
    const controlButtons = [...overlay.querySelectorAll(".roadControl")];
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
                : offsets.get(from) + a.end.sign * laneLateral(sheet, a.road, fromLane);
              offsets.set(to, reference - b.end.sign * laneLateral(sheet, b.road, link.pair ? LEFT_EDGE : toLane));
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
      const a = solved.get(`${road.id}:0`);
      const b = solved.get(`${road.id}:1`);
      const chord = Math.hypot(b.x - a.x, b.y - a.y);
      const [l0, l1] = road.ends.map((end, e) => ((e ? b : a).travel ? end.length ?? chord / 3 : 0));
      const c0 = { x: a.x + (a.travel?.x ?? 0) * l0, y: a.y + (a.travel?.y ?? 0) * l0 };
      const c1 = { x: b.x - (b.travel?.x ?? 0) * l1, y: b.y - (b.travel?.y ?? 0) * l1 };
      return bezier(a, c0, c1, b);
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
        shape = buildShape(sheet, road, sharedCenterline(road, partner, solved, shift), tapers, shift);
      } else shape = buildShape(sheet, road, centerline(road, solved), tapers);
      solved.shapes.set(road, shape);
      return shape;
    }
    // The two-way centerline, from this side's point of view: its end centers moved
    // left by `shift`, with the same Bézier pull both sides share.
    function sharedCenterline(road, partner, solved, shift) {
      const [a, b] = [0, 1].map(e => {
        const at = solved.get(`${road.id}:${e}`);
        const travel = at.travel ?? travelAt(road, e, solved);
        const right = rightOf(travel);
        return { x: at.x - right.x * shift, y: at.y - right.y * shift, travel: at.travel };
      });
      const chord = Math.hypot(b.x - a.x, b.y - a.y);
      // The lower-id side's pulls drive both sides, so they can't drift apart.
      const lengths = road.id < partner.id ? road.ends.map(end => end.length) : [partner.ends[1].length, partner.ends[0].length];
      const [l0, l1] = lengths.map((length, e) => ((e ? b : a).travel ? length ?? chord / 3 : 0));
      const c0 = { x: a.x + (a.travel?.x ?? 0) * l0, y: a.y + (a.travel?.y ?? 0) * l0 };
      const c1 = { x: b.x - (b.travel?.x ?? 0) * l1, y: b.y - (b.travel?.y ?? 0) * l1 };
      return bezier(a, c0, c1, b);
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
          const edges = item => [0, item.road.lanes].map(k => {
            const points = boundary(shapeOf(sheet, item.road, solved), k);
            return item.e ? points.reverse() : points;
          });
          let best = null;
          for (const e1 of edges(a)) for (const e2 of edges(b)) {
            const gap = Math.hypot(e1[0].x - e2[0].x, e1[0].y - e2[0].y);
            if (!best || gap < best.gap) best = { e1, e2, gap };
          }
          if (best.gap > tolerance) return;
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
          // Diagonals run from the departing side toward the arriving side as they
          // move away from the gore point, as drawn in 711-001.
          const side = candidate.awayFirst ? 1 : -1;
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
      overlay.classList.toggle("drawing", Boolean(drawing));
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
    const separationSpeed = feet => ({ 10: "30 mph or less", 20: "35–40 mph", 30: "45 mph", 40: "50 mph or more" })[feet];

    function updatePanel(solved) {
      const sheet = sheets.selected;
      const ready = Boolean(sheet?.inchesPerPixel);
      addButton.disabled = !ready;
      addButton.setAttribute("aria-pressed", String(Boolean(drawing)));
      deleteButton.disabled = !selectedRoad && !sheet?.gores?.some(gore => gore.key === selectedGore);
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
      workspace.classList.toggle("drawing", Boolean(drawing));
      workspace.classList.toggle("elementsActive", active());
      if (!sheet) hint.textContent = "Upload a sheet first.";
      else if (!ready) hint.textContent = "Set this sheet's scale first (Sheets › Set Scale) so lanes draw true size.";
      else if (drawing?.end && !drawing.start) hint.textContent = "Click where the new road starts; it ends at the chosen lane's start. Esc cancels.";
      else if (drawing && !drawing.start) hint.textContent = defaults.opposite
        ? "Click the start of the two-way road's centerline." : "Click the road's start point, or a lane's end node to continue from it.";
      else if (drawing) hint.textContent = defaults.opposite
        ? "Click the end of the centerline. Lanes travel start to end; opposite lanes return. Esc cancels."
        : "Click the end point, or a lane's start node to join it. Traffic flows from start to end. Esc cancels.";
      else if (candidate) hint.textContent = sheet.gores.some(gore => gore.key === selectedGore)
        ? "Drag the gore icon along the gore to change how far the marking reaches. Drag it back to the point to remove it."
        : "Drag the gore icon along the center of the gore to mark it.";
      else if (lane) hint.textContent = "Lane end selected. Set its taper below, drag the node to move the road end, or right-click it for more.";
      else if (partner) hint.textContent = "Two-way road. Right-click a lane node for actions like curving, tapering, or splitting into one-way roads.";
      else if (selectedRoad) hint.textContent = "Drag a lane node to move the road end, or onto another road's node to join them. Right-click a node for actions like curving, tapering, or making the road two-way.";
      else hint.textContent = goreButtons.size
        ? "Add a road, or click a road to edit it. Drag a gore icon along a gore to mark it. Right-click any lane node for actions."
        : "Add a road (set Opposite lanes for two-way), or click a road to edit it. Right-click any lane node for actions.";
    }

    function selectRoad(road) {
      selectedGore = null;
      selectedRoad = road;
      selectedLane = null;
      render();
    }
    // Drawing can begin from a lane's end (`start`) or toward a lane's start (`end`).
    function startDrawing({ start = null, end = null } = {}) {
      drawing = { start, end, cursor: null };
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
    deleteButton.addEventListener("click", deleteSelection);
    function deleteSelection() {
      if (selectedGore) removeGore();
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
      if (drawing.start || drawing.end) drawing.cursor = point;
      render();
    });
    workspace.addEventListener("click", event => {
      const sheet = sheets.selected;
      if (!active() || !sheet?.inchesPerPixel || !press || event.target.closest(".roadNode, .roadControl")) return;
      if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > 4) return;
      if (!drawing) {
        const point = sheets.toImage(event.clientX, event.clientY);
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
        if (p.target) connect(sheet, road, e, Math.min(p.target.lane, road.lanes - 1), p.target);
      });
      if (defaults.opposite) addOpposite(sheet, road, defaults.opposite, defaults.median, false);
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
      } else if (event.key === "Escape" && (drawing || selectedRoad || selectedGore)) {
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
      drawing = null;
      snapTarget = null;
      closeMenu();
      render();
    });
    render();
  });
})();
