/* Modern roundabout geometry and pavement markings, in feet relative to the
   roundabout's center (its sheet-pixel origin). Pure functions shared by
   js/intersections.js and the tests.

   Source: FDOT Design Manual (FDM) Chapter 213, Modern Roundabouts, January 1,
   2025 (Topic #625-000-002), every section and exhibit: 213.3 geometry and
   Exhibit 213-2 (high-speed approach details), 213.3.5 splitter islands and
   Exhibit 213-1 (splitter island detail), 213.3.6 approach width, 213.3.7
   circulatory roadway, 213.3.8 truck apron (Figure 213.3.2), 213.4 path
   overlap (Figure 213.4.1), 213.5 spiral transitions (Figure 213.5.1), 213.7
   design vehicle and stay-in-lane gores, 213.7.3 exit radius, 213.10 signing
   and pavement markings with Exhibits 213-3 (1x2, spiral marking detail),
   213-4 (1x1) and 213-5 (2x2). Markings those exhibits reference to Standard
   Plans Index 711-001 use 711-001. Sidewalks, crosswalks and signs are not
   drawn. A right-turn bypass lane (Exhibit 213-4) is an ordinary road.

   Where FDM 213 leaves a dimension to the designer (decided by fastest-path and
   swept-path analysis, 213.6-213.7) it is an editable input. `checks()` reports
   design ranges and geometric conflicts without blocking approach edits.

   A roundabout is an intersection record with `kind: "roundabout"`. Its
   approaches use the intersection approach fields (mouth x/y, angle, lanes,
   lane ids, road links), so roads attach to it the same way. Circulation is
   counterclockwise as seen on the sheet (right-hand traffic); with the sheet's
   y axis pointing down that is decreasing polar angle. */
(() => {
  const G = globalThis.StripeMaker?.intersectionGeometry ??
    (typeof require !== "undefined" ? require("./intersection-geometry.js") : null);
  const { add, sub, mul, dot, length, unit, clamp, degrees, axes, id } = G;
  const TAU = Math.PI * 2;
  const IN = 1 / 12;
  const wrap = (t) => ((t % TAU) + TAU) % TAU;           // [0, 2π)
  const polar = (p) => Math.atan2(p.y, p.x);

  // ---- FDM 213 (2025) dimensions -------------------------------------------
  // 213.3 (3): ICD 120'-160' single-lane (140' a good starting point), 160'-200'
  // two-lane (180'). Exhibit 213-2 dimensions the ICD to the outside curbs.
  const ICD = { 1: 140, 2: 180 };
  const ICD_RANGE = { 1: [120, 160], 2: [160, 200] };
  // NCHRP Report 672, Exhibit 1-9 and §6.6 (FDOT's companion reference):
  // mini-roundabouts have a typical 45–90 ft ICD, one entering lane and a
  // fully traversable central island. Widths depend on vehicle swept paths.
  // https://www.fdot.gov/docs/default-source/traffic/doc_library/pdf/nchrp_rpt_672.pdf
  // Use 90 ft as the editable starting size, preserving existing approaches.
  const MINI_DIAMETER = [45, 90];
  // Circulatory roadway. Single lane: Exhibit 213-2, W = 18'-20'. Multi-lane:
  // 213.3.7 gives a typical 12'-18' range and describes a larger outside lane.
  // This editor uses one shared width, as requested: 15' is an application
  // default, not an FDM-prescribed dimension, preserving the former 30' pair.
  const SINGLE_WIDTH_RANGE = [18, 20];
  const CIRC_LANE_RANGE = [12, 18];
  const CIRCULATORY = { 1: [20], 2: [15, 15] };
  // 213.1: only single- and two-lane roundabouts on the State Highway System,
  // partial three-lane under certain conditions. More lanes are allowed for
  // other agencies; each uses the shared circulating width. FDM 213 gives
  // no diameter for them: they start from the two-lane
  // starting point (180 ft) widened by the added lanes on both sides, which
  // keeps its central island.
  const MAX_LANES = 6, FDM_LANES = 2;
  const defaultWidths = (C) => CIRCULATORY[C] ?? Array(C).fill(15);
  const defaultDiameter = (C) => ICD[C] ?? ICD[2] + 2 * (defaultWidths(C).reduce((x, y) => x + y, 0) - 30);
  // 213.3.8 / Figure 213.3.2: red truck apron matching AMS-STD-595-21105 (an
  // sRGB rendering), 12" concrete, Type RA curb at the circulatory roadway,
  // Type D curb at the central island. Figure 213.3.2 gives no width (it comes
  // from the design vehicle's swept path, 213.7); new roundabouts start at 15
  // ft, in proportion with the apron drawn beside the 18'-20' circulatory
  // roadway in Exhibit 213-2. It is an input.
  const APRON = { color: "#a52a24", width: 15 };
  // Exhibit 213-2: entry curb R 65' MIN, the one curb radius FDM 213 gives.
  // 213.7.3: an exit radius of 300 to 400 ft for a smoother vehicular path,
  // and flat exit geometry; AR3 (213.3.1, 75-100 ft) is likewise a path
  // radius set by fastest-path analysis. Neither dimensions a curb: the exit
  // lanes themselves follow the exit radius (the splitter's exit side curves
  // on it, the lanes keep their width), and the exit curb meets the circle on
  // the R 65' the exhibit gives for curbs, so exits never balloon wider than
  // their lanes.
  const ENTRY_RADIUS = 65, EXIT_RADIUS = 65, EXIT_RANGE = [300, 400], AR3 = 100, AR3_RANGE = [75, 100];
  // The splitter's sides follow those path radii near the circle: the entry
  // side AR3, the exit side the 300 ft exit radius, each after the 50 ft
  // desirable tangent past the nose (213.3) and over at most 25 degrees of
  // turn, which keeps the entry aimed into the circle.
  const CURVE_LIMIT = (25 * Math.PI) / 180;
  // 213.3.5: minimum splitter island length by approach design speed: 50 ft at
  // 35 mph or less (100 ft desirable), 100 ft at 45 mph or less, 200 ft at 50
  // mph or more. New islands start at the desirable or minimum length.
  const SPLITTER_MIN = (mph) => (mph >= 50 ? 200 : mph > 35 ? 100 : 50);
  const splitterLength = (mph) => (mph >= 50 ? 200 : 100);
  // Exhibit 213-1 splitter island detail and Exhibit 213-2 Details A and B:
  // min offset from lane edge line to face of curb 18" with Type E curb, 15"
  // with traffic separator; nose R 3' min, 3' from each lane edge line, easing
  // to the curb offset on R 200'; island end 3' from the circle's lane edge
  // line with R 3' (exit side) and R 2' (entry side) corners; island 8' min.
  const CURB = { E: 18 * IN, separator: 15 * IN };
  const NOSE_RADIUS = 3, NOSE_OFFSET = 3, NOSE_EASE = 200, ISLAND_SETBACK = 3;
  const END_RADIUS = { exit: 3, entry: 2 };
  const ISLAND_MIN = 8;
  // 213.3: tangents between reverse curves, 50 ft desirable and 25 ft minimum
  // (low speed); TAN1 100 ft and TAN2 50 ft minimum (high speed, Exhibit
  // 213-2); the nose extends beyond the exit curve (Exhibit 213-2).
  const TANGENT = { desirable: 50, min: 25 }, TAN1 = 100;
  // Exhibit 213-2 AR1 / AR2 radii (typ.) by approach design speed.
  const AR12 = [[50, 1100, 600], [55, 1400, 800], [60, 1800, 950], [65, 2200, 1100]];
  // Below 50 mph Exhibit 213-2 has no row; 213.3.1 gives the method: AR1 from
  // AASHTO Green Book 2011 Equation 3-8, R = V^2 / (15 (e + f)), with normal
  // crown e = +2% and f from Green Book Figure 3-6 (maximum side friction by
  // design speed; Green Book Table 3-7: 15 mph 0.32 ... 45 mph 0.15); AR2 the
  // same with e = -2% at a speed 15 mph lower (213.3.1: drivers have slowed
  // 15-20 mph). Radii round up to the next 100 ft, which reproduces the
  // exhibit's AR1 column (50 mph: 1042 -> 1100 ... 65 mph: 2167 -> 2200) and
  // its 50 and 55 mph AR2 values.
  const SIDE_FRICTION = [[15, 0.32], [20, 0.27], [25, 0.23], [30, 0.2], [35, 0.18], [40, 0.16], [45, 0.15], [50, 0.14], [55, 0.13], [60, 0.12], [65, 0.11], [70, 0.1]];
  function sideFriction(mph) {
    const v = clamp(mph, 15, 70), i = SIDE_FRICTION.findIndex(([s]) => s >= v);
    if (SIDE_FRICTION[i][0] === v || i === 0) return SIDE_FRICTION[i][1];
    const [s0, f0] = SIDE_FRICTION[i - 1], [s1, f1] = SIDE_FRICTION[i];
    return f0 + ((f1 - f0) * (v - s0)) / (s1 - s0);   // Figure 3-6 is a continuous curve
  }
  const curveRadius = (mph, e) => Math.ceil(clamp(mph, 15, 70) ** 2 / (15 * (e + sideFriction(mph))) / 100) * 100;
  // Exhibit 213-2: 7:1 taper (the stay-in-lane gore opens at it).
  const TAPER = 7;
  // 213.3.6 / Exhibit 213-2: 15' minimum face to face of curbs.
  const CURB_TO_CURB = 15;
  // 213.3.3: legs as close to 90 degrees as practical; consider realigning
  // below 75 degrees.
  const LEG_ANGLE = 75;
  // 213.7.2: two 12 ft lanes separated by a 6 to 7 ft painted gore; Exhibit
  // 213-5 note 2: gore channelization markings when the entry width is 30 ft
  // or more.
  const STAY_IN_LANE_GORE = [6, 7], GORE_ENTRY_WIDTH = 30;
  // Markings: Exhibits 213-3 to 213-5, and Standard Plans Index 711-001 where
  // they reference it.
  const LINE = 6 * IN;                     // 6" white and yellow lines
  const EXTENSION = { width: 12 * IN, on: 2, off: 2 };   // 12" white 2'-2' dotted extension
  const GUIDE = { on: 2, off: 4 };         // 6" white 2'-4' dotted guide (circulatory lanes, spiral marking)
  const SKIP = { on: 10, off: 30 };        // 6" white 10'-30' skip
  const GORE = { line: 8 * IN, chevron: 18 * IN, spacing: 20 };  // 711-001 sheet 8, gore channelization
  const SEPARATION = { stripe: 18 * IN };  // 711-001 sheet 8, traffic separation (18" yellow diagonals)
  const DOUBLE_SPACING = (6 + 4) * IN;    // 711-001 "Double Solid Lines": 6" lines, 4" gap, 10" center to center
  // 711-001 sheet 8: traffic separation diagonal spacing by posted speed.
  const separationSpacing = (mph) => (mph <= 30 ? 10 : mph <= 40 ? 20 : mph <= 45 ? 30 : 40);
  const WHITE = "#ffffff", YELLOW = "#ffc72c";
  // 213.10: lane-use arrows from 711-001: messages 25 ft back from the yield
  // marking (711-001 note 1) and a second set 100 ft upstream (711-001 sheet
  // 10). YIELD sits directly behind the dotted extension (Exhibits 213-3 to
  // 213-5).
  const ARROW_BACK = 25, ARROW_SPACING = 100, YIELD_CLEAR = 2, WORD_LENGTH = 8;  // 711-001 sheet 1: 8' letters

  // ---- Records -------------------------------------------------------------
  function settings(item) {
    const s = (item.roundabout ??= {});
    s.mini ??= false;
    s.lanes ??= "auto";          // circulating lanes: "auto" or 1-6
    s.icd ??= null;              // inscribed circle diameter (ft); null follows the lanes
    s.shape ??= s.ratio > 1 ? "oval" : "circle";   // "circle", "oval" or "peanut"
    s.ratio ??= 1;               // oval and peanut: overall length / diameter
    s.turn ??= 0;                // oval orientation (degrees)
    // Legacy per-lane widths become one shared width, preserving their total
    // paved width. Keep the original array as import evidence; laneWidth is
    // authoritative once set and survives subsequent lane-count changes.
    s.widths ??= null;
    const legacy = Array.isArray(s.widths) ? s.widths.filter(w => Number.isFinite(w) && w > 0) : [];
    s.laneWidth ??= legacy.length ? legacy.reduce((sum, w) => sum + w, 0) / legacy.length : null;
    s.apron ??= APRON.width;
    s.entryRadius ??= ENTRY_RADIUS;
    // Older roundabouts stored the flattest-that-fits 400 ft cap.
    if (s.exitRadius == null || (s.exitRadius === 400 && !s.exitCurb)) s.exitRadius = EXIT_RADIUS;
    s.exitCurb = true;
    s.spiral ??= "auto";         // spiral central island (213.5): "auto", "on", "off"
    return s;
  }
  function legDefaults(a) {
    a.speed ??= 35;              // approach design speed (mph)
    a.splitter ??= null;         // splitter island length (ft); null follows the speed
    a.curb ??= "E";              // splitter island edge: "E" (Type E curb) or "separator" (Type I traffic separator)
    a.ar3 ??= AR3;               // entry curve AR3 radius (ft)
    a.exitCurve ??= EXIT_RANGE[0]; // exit lane radius, 213.7.3 (not the curb fillet)
    a.bend ??= 0;                // sideways displacement of the connected mouth (ft)
    a.yieldSetback ??= 0;        // user-positioned yield line; 0 keeps the circle-edge placement
    delete a.splitWidth;
    a.entryGore ??= 0;           // stay-in-lane gore between entry lanes (213.7.2.2), ft
    a.dest ??= {};               // { [incoming lane id]: [exit approach ids] } where set by hand
    a.median ??= 0;
    a.radius ??= 20;
    a.nose ??= 60;
    a.surface ??= "grass";
    return a;
  }
  // Compact starting geometry: the splitter continues through the mouth,
  // rather than including the upstream AR1/AR2 separation taper. FDM 213.3.5
  // permits 50 ft at 35 mph; the 12 ft mouth median accommodates the
  // splitter nose and lane offsets (Exhibit 213-2). Existing records retain
  // their original medians, splitter lengths, and mouth positions.
  const approach = (angle) => Object.assign(legDefaults(G.approach(angle)), { median: 12, splitter: SPLITTER_MIN(35) });
  function create() {
    const item = { id: id(), kind: "roundabout", name: "Roundabout", x: 0, y: 0, rotation: 0, approaches: [], movements: [] };
    settings(item);
    item.approaches = [0, 90, 180, 270].map(approach);
    normalize(item);
    // Each mouth starts where its approach begins: the splitter island plus
    // the taper that opens the separation for it.
    for (const a of item.approaches) Object.assign(a, mul(axes(a).u, requiredReach(item, a)));
    return normalize(item);
  }
  function normalize(item) {
    G.normalize(item);
    settings(item);
    movementReferences(item);
    item.movements = [];
    for (const a of item.approaches) {
      legDefaults(a);
      a.median = Math.max(0, a.median ?? 0);
      delete a.bypass;
      if (a.entryGores) {
        for (const key of Object.keys(a.entryGores)) if (!a.inLanes.slice(1).includes(key)) delete a.entryGores[key];
      }
      if (a.entryGoreTypes) for (const key of Object.keys(a.entryGoreTypes)) {
        const k = a.inLanes.indexOf(key);
        if (!entryGoreWidth(a, k) || a.entryGoreTypes[key] !== "curbed") delete a.entryGoreTypes[key];
      }
      if (a.entryGoreLengths) for (const key of Object.keys(a.entryGoreLengths)) {
        const k = a.inLanes.indexOf(key);
        if (!entryGoreWidth(a, k)) delete a.entryGoreLengths[key];
      }
      for (const key of Object.keys(a.dest)) if (!a.inLanes.includes(key)) delete a.dest[key];
      for (const key of Object.keys(a.dest)) a.dest[key] = a.dest[key].filter((x) => item.approaches.some((b) => b.id === x && b.outgoing));
    }
    return item;
  }

  // Each boundary is keyed by the lane immediately outside it. The scalar
  // entryGore remains a fallback for older saved roundabouts.
  const entryGoreWidth = (a, k) => k > 0 && k < a.incoming ? Math.max(0, Number(a.entryGores?.[a.inLanes[k]] ?? a.entryGore) || 0) : 0;
  const entryGoreType = (a, k) => entryGoreWidth(a, k) && a.entryGoreTypes?.[a.inLanes[k]] === "curbed" ? "curbed" : "painted";

  // ---- Legs, flow order, lane assignments ----------------------------------
  // Movement meaning belongs to an approach, not its editable entry tangent
  // or mouth position. Save a logical bearing once and retain it through
  // bends, moves, whole-roundabout rotation, and JSON/undo round trips.
  function movementReferences(item) {
    const missing = item.approaches.filter(a => !Number.isFinite(a.movementAngle));
    if (!missing.length) return;
    // Older files have no reference. Their mouth bearings recover the leg
    // directions without mistaking a sharply angled entrance for another
    // approach. A later geometry edit must never reinitialize this bearing.
    const bearing = a => length(a) > 1e-6 ? degrees(polar(a) * 180 / Math.PI) : degrees(a.angle);
    const known = item.approaches.filter(a => Number.isFinite(a.movementAngle))
      .map(a => ({ bearing: bearing(a), movement: a.movementAngle })).sort((a, b) => a.bearing - b.bearing);
    for (const a of missing) {
      const position = bearing(a);
      if (!known.length) { a.movementAngle = position; continue; }
      // Insert a new leg between its neighbors in their existing logical
      // frame. This also works after the entire roundabout has rotated, or
      // the neighboring entrances have moved, without relabeling old legs.
      const next = known.findIndex(b => b.bearing > position), i = next < 0 ? 0 : next;
      const before = known[(i + known.length - 1) % known.length], after = known[i];
      const fraction = degrees(position - before.bearing) / (degrees(after.bearing - before.bearing) || 360);
      a.movementAngle = degrees(before.movement + fraction * (degrees(after.movement - before.movement) || 360));
    }
  }
  // Legs in the order circulating traffic meets them (counterclockwise on the
  // sheet: decreasing polar angle of each mouth). This physical order still
  // controls the paths; it does not redefine an approach's turn meanings.
  function flow(item) {
    return [...item.approaches].sort((a, b) => wrap(polar(b)) - wrap(polar(a)));
  }
  // Exits after entry a, in the order traffic reaches them: 1 = first exit
  // (right turn) ... legs = the U-turn back to a.
  function exitOrder(item, a, b) {
    const f = flow(item), i = f.findIndex(x => x.id === a.id), j = f.findIndex(x => x.id === b.id);
    return ((j - i + f.length - 1) % f.length) + 1;
  }
  // All lane defaults, arrow symbols, spiral decisions, and editor labels
  // share the saved movement references. Only ordinary intersections infer
  // turn meaning from their current approach angles.
  function turnOf(item, a, b) {
    if (a.id === b.id) return "u";
    movementReferences(item);
    const from = item.approaches.find(x => x.id === a.id) ?? a, to = item.approaches.find(x => x.id === b.id) ?? b;
    const t = degrees(to.movementAngle - from.movementAngle - 180);
    return t < 45 || t > 315 ? "through" : t > 180 ? "left" : "right";
  }
  const circulatingIn = (item, a) => a.incoming;
  const circulatingOut = (item, b) => b.outgoing;
  // FDM exhibits' lane use: a single-lane entry serves every exit; on a
  // multi-lane entry the left lane takes left turns and U-turns, plus through
  // where the receiving exit has enough lanes. The right lane takes right
  // and through (Exhibits 213-3/5); middle lanes go through.
  function defaultDestinations(item, a, j) {
    const exits = item.approaches.filter((b) => b.outgoing && circulatingOut(item, b) > 0);
    const n = circulatingIn(item, a);
    if (n <= 1) return exits.map((b) => b.id);
    const kinds = (b) => turnOf(item, a, b);
    const pick = (test) => exits.filter((b) => test(kinds(b))).map((b) => b.id);
    // Keep simultaneous through lanes in separate receiving lanes. When a
    // two-lane entry faces a single-lane exit, the outside lane keeps through
    // and the inside lane becomes left/U-turn only (FDM 213.4 path overlap;
    // 213.5 then supplies its spiral). Explicit destinations remain untouched.
    if (j === 0) return exits.filter(b => kinds(b) === "left" || kinds(b) === "u"
      || (kinds(b) === "through" && circulatingOut(item, b) >= n)).map(b => b.id);
    if (j === n - 1) return pick((k) => k === "right" || k === "through");
    const through = pick((k) => k === "through");
    return through.length ? through : pick((k) => k === "left");
  }
  function destinations(item, a, laneId) {
    const j = a.inLanes.indexOf(laneId);
    if (j < 0) return [];
    return a.dest?.[laneId] ?? defaultDestinations(item, a, j);
  }
  // How many circulating lanes each stretch needs: in front of each splitter
  // island ("front", from a leg's exit to its entry) and past each entry
  // ("after", from that entry to the next exit). Traffic keeps its lanes'
  // order, so a lane counts wherever it is still circulating.
  const laneUseCache = new WeakMap();
  function laneUse(item) {
    movementReferences(item);
    const f = flow(item), N = f.length;
    const key = JSON.stringify([f.map(a => a.id), item.approaches.map(a => [a.id, a.movementAngle, a.incoming, a.outgoing, a.inLanes, a.dest])]);
    const cached = laneUseCache.get(item);
    if (cached?.key === key) return cached.value;
    const order = new Map(f.map((a, i) => [a.id, i]));
    // Outside-first lane slots. Retain each source lane's remaining exits;
    // a count alone cannot determine a circulating arrow or an exit guide.
    const front = Array.from({ length: N }, () => []), after = Array.from({ length: N }, () => []);
    const put = (section, active, source) => active.forEach((lane, j) => {
      const o = active.length - 1 - j;
      (section[o] ??= []).push({ source: source.id, lane: lane.id, exits: lane.exits });
    });
    for (const [e, a] of f.entries()) {
      const lanes = a.inLanes.map(id => ({ id, exits: destinations(item, a, id).map(id => ({ id,
        order: ((order.get(id) - e + N - 1) % N) + 1 })) }));
      for (let t = 0; t < N; t++) {
        const k = (e + t) % N;
        const active = lanes.map(lane => ({ id: lane.id, exits: lane.exits.filter(exit => exit.order > t).map(exit => exit.id) }))
          .filter(lane => lane.exits.length);
        if (t > 0) put(front[k], active, a);
        put(after[k], active, a);
      }
    }
    const value = { front, after };
    laneUseCache.set(item, { key, value });
    return value;
  }
  function demand(item) {
    const use = laneUse(item);
    return { front: use.front.map(lanes => lanes.length), after: use.after.map(lanes => lanes.length) };
  }
  function circulatingArrows(item, a) {
    const f = flow(item), i = f.indexOf(a), next = f[(i + 1) % f.length];
    // Exhibit 213-3: forward leads to the next exit, left continues around
    // the island. These are relative choices at this splitter, not the turn
    // names from the original entry. Use only movements that reach this lane.
    return (laneUse(item).front[i] ?? []).map(records => {
      const exits = new Set(records.flatMap(record => record.exits));
      return arrowFor([...(exits.has(next.id) ? ["through"] : []),
        ...([...exits].some(id => id !== next.id) ? [globalThis.StripeMaker?.traffic?.reversed?"right":"left"] : [])], false);
    });
  }
  function laneCount(item) {
    const s = settings(item);
    if (s.lanes !== "auto") return clamp(Math.round(Number(s.lanes)) || 1, 1, MAX_LANES);
    const d = demand(item);
    return clamp(Math.max(1, ...d.front, ...d.after), 1, MAX_LANES);
  }
  function laneWidths(item) {
    const s = settings(item), C = laneCount(item);
    const width = s.laneWidth == null ? defaultWidths(C)[0] : clamp(Number(s.laneWidth) || CIRC_LANE_RANGE[0], 8, 40);
    return Array(C).fill(width);
  }
  const diameter = (item) => {
    const s = settings(item);
    if (s.icd != null) return s.icd;
    if (s.mini) return MINI_DIAMETER[1];
    // Painted entry gores take real space in addition to the lanes. Give the
    // automatic starting layout that extra radial room, instead of forcing
    // wide entries past the circle (R092). This is an editor sizing rule,
    // not a prescribed FDM diameter; explicit diameters stay authoritative.
    const extra = Math.max(0, ...item.approaches.map(a =>
      Array.from({ length: Math.max(0, a.incoming - 1) }, (_, j) => entryGoreWidth(a, j + 1)).reduce((sum, w) => sum + w, 0)));
    return defaultDiameter(laneCount(item)) + 2 * extra;
  };
  // FDM 213.5 requires a spiral for exclusive left-turn lanes. The same
  // shaped opening also supplies an inside lane added by the lane-demand
  // model (Exhibit 213-3); a shared through destination does not erase it.
  function spiralEntries(item) {
    const f = flow(item), need = demand(item);
    return f.filter((a, i) => a.inLanes.filter(id => destinations(item, a, id).length).length > 1 && (need.after[i] > need.front[i] || a.inLanes.some(id => {
      const to = destinations(item, a, id);
      return to.length && to.every(id => ["left", "u"].includes(turnOf(item, a, item.approaches.find(b => b.id === id))));
    })));
  }
  function spiralLaneCount(item, a) {
    const f = flow(item), i = f.indexOf(a), need = demand(item);
    let exclusive = 0;
    for (const id of a.inLanes) {
      const to = destinations(item, a, id);
      if (!to.length || !to.every(id => ["left", "u"].includes(turnOf(item, a, item.approaches.find(b => b.id === id))))) break;
      exclusive++;
    }
    // Existing circulating lanes also occupy the receiving section. Several
    // left-only entry lanes may share those lanes; only the available inside
    // slots start at the island. Never collapse a live lane at the new tip.
    const room = Math.max(1, laneCount(item) - Math.max(1, need.front[i]));
    return clamp(Math.max(1, exclusive, need.after[i] - need.front[i]), 1, room);
  }
  function spiralWanted(item) {
    const s = settings(item);
    if (s.spiral !== "auto") return s.spiral === "on" && laneCount(item) > 1;
    return laneCount(item) > 1 && spiralEntries(item).length > 0;
  }
  // The arrow for a set of destinations, from the 711-001 catalog. The left-turn
  // arrow with the circular dot marks the left lane of a multi-lane entry
  // (FDM 213.10).
  function arrowFor(kinds, leftLane) {
    const has = (k) => kinds.includes(k);
    const left = has("left") || has("u"), through = has("through"), right = has("right");
    let type = null;
    if (left && through && right) type = "throughLeftRight";
    else if (left && through) type = "throughLeft";
    else if (left && right) type = "leftRight";
    else if (left) type = has("left") ? "turnLeft" : "uTurn";
    else if (through && right) type = "throughRight";
    else if (through) type = "through";
    else if (right) type = "turnRight";
    return type && { type, dot: Boolean(leftLane && left) };
  }

  // ---- The inscribed shape ---------------------------------------------------
  // The edge of the circulatory roadway is a circle, an oval, or a peanut (two
  // circular lobes joined by a waist, one roadway round both). FDM 213 shows
  // only circular roundabouts; ovals and peanuts are offered as shapes, with
  // the same FDM cross section and markings. A ring is the shape offset inward
  // by `off` feet (negative is outward), sampled by polar angle.
  const SAMPLES = 720;
  const SHAPES = ["circle", "oval", "peanut"];
  // Peanut ratio is overall length over lobe diameter; the lobes must overlap.
  const RATIO_RANGE = { circle: [1, 1], oval: [1, 3], peanut: [1, 1.9] };
  function shape(item) {
    const s = settings(item), kind = SHAPES.includes(s.shape) ? s.shape : s.ratio > 1 ? "oval" : "circle";
    const [lo, hi] = RATIO_RANGE[kind], ratio = clamp(Number(s.ratio) || 1, lo, hi);
    // The ICD is to the outside curb faces (Exhibit 213-2); the circulatory
    // roadway's lane edge line is the curb offset inside it (213.3.6).
    const D = diameter(item), b = D / 2 - CURB.E, a = kind === "oval" ? (D * ratio) / 2 - CURB.E : b, t = (s.turn * Math.PI) / 180;
    return { kind, ratio, a, b, R: b, d: kind === "peanut" ? D * (ratio - 1) : 0, t, c: Math.cos(t), s: Math.sin(t) };
  }
  // The shape's radius along a ray at polar angle theta (in its own frame).
  function shapeRadius(sh, theta) {
    if (sh.kind === "oval") return (sh.a * sh.b) / Math.hypot(sh.b * Math.cos(theta), sh.a * Math.sin(theta));
    if (sh.kind === "peanut" && sh.d > 0) {
      const u = { x: Math.cos(theta), y: Math.sin(theta) };
      const lobe = (cx) => { const cu = cx * u.x; return cu + Math.sqrt(Math.max(0, sh.R * sh.R - cx * cx + cu * cu)); };
      // A smooth maximum of the two lobes rounds the waist.
      const k = 6, r1 = lobe(sh.d / 2), r2 = lobe(-sh.d / 2);
      return Math.pow(r1 ** k + r2 ** k, 1 / k);
    }
    return sh.b;
  }
  function ringSamples(sh, off) {
    const base = Array.from({ length: SAMPLES }, (_, k) => {
      const t = (TAU * k) / SAMPLES, r = shapeRadius(sh, t);
      return { x: Math.cos(t) * r, y: Math.sin(t) * r };
    });
    return base.map((p, k) => {
      const q0 = base[(k + SAMPLES - 1) % SAMPLES], q1 = base[(k + 1) % SAMPLES];
      const t = unit(sub(q1, q0));
      let n = { x: t.y, y: -t.x };
      if (dot(n, p) < 0) n = mul(n, -1);
      const x = p.x - n.x * off, y = p.y - n.y * off;
      return { x: x * sh.c - y * sh.s, y: x * sh.s + y * sh.c };
    });
  }
  // An inward offset stays usable while it still goes round the center in
  // order (a narrow oval or peanut waist folds it over).
  function folds(sh, off) {
    const pts = ringSamples(sh, off);
    return pts.some((p, k) => {
      const q = pts[(k + 1) % pts.length];
      return length(p) < 3 || wrap(polar(q) - polar(p)) > Math.PI;
    });
  }
  class Ring {
    constructor(points) {
      this.points = points.map((p) => ({ ...p, t: wrap(polar(p)) })).sort((p, q) => p.t - q.t);
    }
    at(theta) {
      const t = wrap(theta), P = this.points, n = P.length;
      let lo = 0, hi = n;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (P[m].t <= t) lo = m; else hi = m; }
      if (P[lo].t > t) lo = n - 1;
      const p = P[lo], q = P[(lo + 1) % n];
      const span = wrap(q.t - p.t) || 1e-9, f = wrap(t - p.t) / span;
      return { x: p.x + (q.x - p.x) * f, y: p.y + (q.y - p.y) * f };
    }
    radius(theta) { return length(this.at(theta)); }
    // The closest point to p (an oval's closest point is not on p's ray).
    nearest(p) {
      if (this.round) return this.at(polar(p));
      const P = this.points, n = P.length;
      // Fillet fitting asks this thousands of times per layout. Bound short
      // runs of vertices once, then skip runs that cannot contain the closest
      // vertex. This preserves the original search (including ties) and all
      // curve samples, without allocating vectors or taking a sqrt per vertex.
      const blocks = this.nearestBlocks ??= Array.from({ length: Math.ceil(n / 16) }, (_, i) => {
        const start = i * 16, end = Math.min(n, start + 16);
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (let k = start; k < end; k++) {
          x0 = Math.min(x0, P[k].x); x1 = Math.max(x1, P[k].x);
          y0 = Math.min(y0, P[k].y); y1 = Math.max(y1, P[k].y);
        }
        return { start, end, x0, y0, x1, y1 };
      });
      // Seed the bound from the same polar neighborhood. It is only a
      // bound: every block that could improve it is still searched exactly.
      const angle = wrap(polar(p));
      let lo = 0, hi = n;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (P[m].t <= angle) lo = m; else hi = m; }
      let best = lo, d = (P[lo].x - p.x) ** 2 + (P[lo].y - p.y) ** 2;
      for (const b of blocks) {
        const dx = Math.max(b.x0 - p.x, 0, p.x - b.x1), dy = Math.max(b.y0 - p.y, 0, p.y - b.y1);
        if (dx * dx + dy * dy > d) continue;
        for (let k = b.start; k < b.end; k++) {
          const dx = P[k].x - p.x, dy = P[k].y - p.y, e = dx * dx + dy * dy;
          if (e < d || (e === d && k < best)) { d = e; best = k; }
        }
      }
      const a = P[(best + n - 1) % n], b = P[best], c = P[(best + 1) % n];
      const proj = (u, v) => { const w = sub(v, u), f = clamp(dot(sub(p, u), w) / (dot(w, w) || 1), 0, 1); return add(u, mul(w, f)); };
      const q1 = proj(a, b), q2 = proj(b, c);
      return length(sub(q1, p)) < length(sub(q2, p)) ? q1 : q2;
    }
    inside(p) { return length(p) < this.radius(polar(p)); }
    // Points from angle t0 to t1, going down in angle (with traffic) when
    // `down`, else up; the span is taken modulo a full turn unless `full`.
    arc(t0, t1, down, full = false) {
      let span = down ? wrap(t0 - t1) : wrap(t1 - t0);
      if (full && span < 1e-6) span = TAU;
      const steps = Math.max(2, Math.ceil(span / (TAU / 360)));
      return Array.from({ length: steps + 1 }, (_, i) => this.at(t0 + (down ? -1 : 1) * (span * i) / steps));
    }
  }
  // Parallel lane boundaries measured perpendicular to travel (213.3.7).
  // Adding to a polar radius only gives the assigned width on a concentric
  // circle; it pinches lanes on the offset circles and tangent spiral curbs.
  function offsetRing(ring, distance) {
    if (!distance) return ring;
    const points = ring.points.filter((p, i, points) => !i || length(sub(p, points[i - 1])) > 1e-6);
    if (points.length > 1 && length(sub(points[0], points.at(-1))) < 1e-6) points.pop();
    const count = points.length;
    return new Ring(points.map((p, i) => {
      const before = unit(sub(p, points[(i + count - 1) % count]));
      const after = unit(sub(points[(i + 1) % count], p));
      const n0 = { x: before.y, y: -before.x }, n1 = { x: after.y, y: -after.x };
      const normal = unit(add(n0, n1));
      return add(p, mul(normal, distance / Math.max(0.25, dot(normal, n1))));
    }));
  }
  function circulationKeys(legs, flow, need) {
    const keys = [];
    for (const [i, a] of flow.entries()) {
      const L = legs.get(a.id), previous = (i + flow.length - 1) % flow.length;
      keys.push({ t: L.exitRight.t, q: Math.max(1, need.after[previous]) }, { t: L.exitLeft.t, q: Math.max(1, need.front[i]) },
        { t: L.entryLeft.t, q: Math.max(1, need.front[i]) }, { t: L.entryRight.t, q: Math.max(1, need.after[i]) });
    }
    keys.sort((a, b) => a.t - b.t);
    return keys;
  }
  function circulatingCounter(legs, flow, need) {
    const keys = circulationKeys(legs, flow, need);
    return theta => {
      const t = wrap(theta), found = keys.findIndex(k => k.t > t), i = found < 0 ? 0 : found;
      const hi = keys[i], lo = keys[(i + keys.length - 1) % keys.length];
      const x = clamp(wrap(t - lo.t) / (wrap(hi.t - lo.t) || 1e-9), 0, 1);
      return lo.q + (hi.q - lo.q) * x * x * (3 - 2 * x);
    };
  }
  // ---- Layout --------------------------------------------------------------
  const cache = new WeakMap(), constructionCache = new WeakMap(), identities = new WeakMap();
  let nextIdentity = 0;
  const identity = object => {
    if (!identities.has(object)) identities.set(object, ++nextIdentity);
    return identities.get(object);
  };
  // Retain only the constructions used by the latest layout. Dependencies
  // are explicit: a local curve edit can reuse the ring, other approaches
  // and their fitted corners without reducing sampling or skipping checks.
  function constructionMemo(item) {
    let store = constructionCache.get(item);
    if (!store) constructionCache.set(item, store = { values: new Map(), generation: 0 });
    store.generation++;
    for (const [key, entry] of store.values) if (entry.generation < store.generation - 1) store.values.delete(key);
    return (stage, dependencies, build) => {
      const key = stage + JSON.stringify(dependencies);
      let entry = store.values.get(key);
      if (!entry) store.values.set(key, entry = { value: build() });
      entry.generation = store.generation;
      return entry.value;
    };
  }
  function snapshot(item) {
    const copy = structuredClone(item), store = constructionCache.get(item);
    if (store) constructionCache.set(copy, { generation: store.generation,
      values: new Map([...store.values].map(([key, entry]) => [key, { ...entry }])) });
    return copy;
  }
  function layout(item) {
    const key = JSON.stringify([item.roundabout, item.approaches]);
    const hit = cache.get(item);
    if (hit?.key === key) return hit.value;
    const value = compute(item);
    // compute normalizes legacy data; cache its resulting inputs so the next
    // drawing/validation pass can share this exact layout.
    cache.set(item, { key: JSON.stringify([item.roundabout, item.approaches]), value });
    return value;
  }
  function compute(item) {
    normalize(item);
    const s = settings(item), sh = shape(item), C = laneCount(item), widths = laneWidths(item);
    const memo = constructionMemo(item), shapeKey = JSON.stringify(sh);
    const approachKeys = new Map(item.approaches.map(a => [a.id, JSON.stringify(a)]));
    let rings = new Map(), width = null, spiralOuter = null, spiralDividers = new Map();
    // ring(off): the circulatory roadway's outer edge, `off` feet in. Where
    // the roadway narrows (see below) its outer edge follows the width.
    const ring = (off) => {
      const k = Math.round(off * 1000) / 1000;
      if (!rings.has(k)) {
        let r;
        if (spiralOuter) r = memo("offset", [identity(spiralOuter), k], () => offsetRing(spiralOuter, -k));
        else if (width) r = new Ring(Array.from({ length: SAMPLES }, (_, n) => { const t = (TAU * n) / SAMPLES, rad = islandEdge + width(t) - k; return { x: Math.cos(t) * rad, y: Math.sin(t) * rad }; }));
        else { r = memo("ring", [shapeKey, k], () => new Ring(ringSamples(sh, k))); r.round = sh.kind === "circle" || (sh.kind === "oval" && sh.a === sh.b) || (sh.kind === "peanut" && !sh.d); }
        rings.set(k, r);
      }
      return rings.get(k);
    };
    let outer = ring(0);
    const total = widths.reduce((x, y) => x + y, 0);
    let islandEdge = sh.b - total;
    // Boundary b counts circulating lanes from the outside: the line between
    // the b outermost lanes and the rest.
    const boundaryOff = (b) => widths.slice(C - b).reduce((x, y) => x + y, 0);
    const laneCenterOff = (o) => boundaryOff(o) + widths[C - 1 - o] / 2;   // o = 0 is the outside lane
    const f = flow(item), N = f.length, need = demand(item);
    let legs = new Map();
    const placeLegs = () => {
      legs = new Map();
      for (const a of item.approaches) legs.set(a.id, memo("leg", [identity(outer), approachKeys.get(a.id), s.mini, diameter(item), circulatingIn(item, a), f.indexOf(a), need.front[f.indexOf(a)], need.after[f.indexOf(a)]],
        () => leg(item, JSON.parse(approachKeys.get(a.id)), outer, ring, memo)));
      for (const [i, a] of f.entries()) {
        const L = legs.get(a.id);
        L.flow = i;
        L.front = need.front[i];
        L.after = need.after[i];
      }
    };
    placeLegs();
    // Spiral central island (213.5, Figure 213.5.1), extended along the
    // selected base shape when the designer chooses an oval or peanut.
    const sources = spiralSources(item, f);
    const planAt = radius => memo("spiral", [shapeKey, widths, radius, s.apron,
      sources.map(({ entry, exit }) => [entry.id, exit?.id, spiralLaneCount(item, entry), identity(legs.get(entry.id)), legs.get(entry.id).after])],
      () => spiralPlan(item, legs, f, radius, widths[0], s.apron, C, sources));
    let spiral = spiralWanted(item) ? planAt(sh.b - total) : null;
    if (spiral) {
      // Keep assigned circulating widths: losing an inside lane leaves only
      // the outside lane's width, never the former two-lane paved band.
      const profile = (plan, withDividers = false) => {
        // Interior keys in a constant-width stretch do not change its curve.
        const keys = circulationKeys(legs, f, need);
        const changing = keys.filter((k, i) => k.q !== keys[(i + keys.length - 1) % keys.length].q || k.q !== keys[(i + 1) % keys.length].q);
        return memo("profile", [identity(plan), withDividers, changing.length ? changing : keys[0].q,
          plan.transitions.map(p => { const L = legs.get(p.entry); return [L.entryLeft.t, L.front]; })], () => {
          const circulatingCount = circulatingCounter(legs, f, need);
          const curb = new Ring(plan.apron);
          const parallel = new Map([[0, curb]]);
          const offset = distance => {
            if (!parallel.has(distance)) parallel.set(distance, offsetRing(curb, distance));
            return parallel.get(distance);
          };
          const dividers = new Map();
          let previous = curb;
          // Fitting and reconciliation use only the outer edge. Construct the
          // internal lane boundaries once, for the final reconciled profile.
          for (let c = 0; withDividers && c < C - 1; c++) {
            const openingBounds = plan.transitions.filter(p => c >= C - p.count).map(p => {
              const afterNew = C - p.count + p.added;
              const offset = c < afterNew ? -widths.slice(c + 1, afterNew).reduce((sum, w) => sum + w, 0)
                : widths.slice(afterNew, c + 1).reduce((sum, w) => sum + w, 0);
              const start = polar(spiralOffsetPoint(p, p.tip, Math.max(0, offset)));
              const end = polar(spiralOffsetPoint(p, p.marking.at(-1), Math.max(0, offset)));
              return { plan: p, offset, start, span: wrap(start - end) };
            });
            const angles = [...Array.from({ length: SAMPLES }, (_, n) => TAU * n / SAMPLES),
              ...plan.transitions.flatMap(t => t.marking.map(p => wrap(polar(p)))),
              ...openingBounds.flatMap(g => [wrap(g.start), wrap(g.start - g.span)])];
            const points = [...new Set(angles)].map(t => {
              // Slots are outside-first across the whole layout. An opening
              // into two lanes of a three-lane layout leaves the innermost
              // slot closed; it must not borrow a third lane's pavement width.
              const guide = openingBounds.find(g => wrap(g.start - t) <= g.span + 1e-8);
              let radius;
              if (guide) {
                // Every existing lane parallels the opening guide too. Using
                // the changing curb width for an intermediate divider applies
                // a second taper and bends the middle lane across its neighbors.
                radius = Math.max(previous.radius(t), spiralGuideRing(guide.plan, guide.offset).radius(t));
              } else {
                let q = clamp(circulatingCount(t), 1, C);
                // The new lane begins at the curb tip, not earlier at the
                // yield line. Its opening guide supplies the width until P_l.
                for (const g of openingBounds) {
                  const L = legs.get(g.plan.entry);
                  const span = wrap(L.entryLeft.t - g.start);
                  if (span < Math.PI && wrap(L.entryLeft.t - t) < span) q = Math.min(q, Math.max(1, L.front));
                }
                // Offset the curb directly. Offsetting a boundary whose lane
                // is itself tapering creates a second lateral bend in the next
                // lane, particularly when two inside lanes open together.
                const distance = q => widths.slice(Math.max(0, C - q), c + 1).reduce((sum, w) => sum + w, 0);
                const lo = Math.floor(q), hi = Math.ceil(q), amount = q - lo;
                const r0 = offset(distance(lo)).radius(t), r1 = offset(distance(hi)).radius(t);
                radius = r0 + (r1 - r0) * amount;
              }
              return { x: Math.cos(t) * radius, y: Math.sin(t) * radius };
            });
            previous = new Ring(points);
            dividers.set(C - c - 1, previous);
          }
          // Offset the actual circular guide while it opens, and the shaped
          // curb elsewhere. Interpolate only across lane-add/drop openings;
          // offsetting an already tapered boundary again can fold that offset.
          const offsets = Array.from({ length: C }, (_, c) => offsetRing(curb,
            widths[C - 1] + widths.slice(0, c).reduce((sum, w) => sum + w, 0)));
          const angles = [...Array.from({ length: SAMPLES }, (_, n) => TAU * n / SAMPLES),
            ...plan.transitions.flatMap(p => {
              const w = widths.slice(C - p.count + p.added).reduce((sum, w) => sum + w, 0);
              return p.marking.map(q => wrap(polar(spiralOffsetPoint(p, q, w))));
            })];
          const outerPoints = angles.map(t => {
            let q = clamp(circulatingCount(t), 1, C);
            const guide = plan.transitions.find(p => {
              const w = widths.slice(C - p.count + p.added).reduce((sum, v) => sum + v, 0);
              const start = spiralOffsetPoint(p, p.tip, w), end = spiralOffsetPoint(p, p.marking.at(-1), w);
              return wrap(polar(start) - t) <= wrap(polar(start) - polar(end)) + 1e-8;
            });
            let radius;
            if (guide) {
              radius = spiralGuideRing(guide, widths.slice(C - guide.count + guide.added).reduce((sum, w) => sum + w, 0)).radius(t);
            } else {
              for (const p of plan.transitions) {
                const L = legs.get(p.entry);
                const w = widths.slice(C - p.count + p.added).reduce((sum, w) => sum + w, 0);
                const start = spiralOffsetPoint(p, p.tip, w);
                const span = wrap(L.entryLeft.t - polar(start));
                if (span < Math.PI && L.front < C && wrap(L.entryLeft.t - t) < span) q = Math.max(1, L.front);
              }
              const lo = Math.floor(q) - 1, hi = Math.min(C - 1, lo + 1), amount = q - Math.floor(q);
              radius = offsets[lo].radius(t) + (offsets[hi].radius(t) - offsets[lo].radius(t)) * amount;
            }
            return { x: Math.cos(t) * radius, y: Math.sin(t) * radius };
          });
          return { outer: new Ring(outerPoints), dividers };
        });
      };
      // Fit the shaped roadway inside the configured inscribed diameter.
      const openingWidth = Math.max(...spiral.transitions.map(t => t.w));
      let lo = Math.max(s.apron + 6, islandEdge - openingWidth), hi = islandEdge;
      for (let i = 0; i < 12; i++) {
        const radius = (lo + hi) / 2, plan = planAt(radius);
        if (!plan) break;
        const max = Math.max(...profile(plan).outer.points.map(p => length(p) - shapeRadius(sh, polar(p) - sh.t)));
        if (max > 0) hi = radius; else lo = radius;
      }
      islandEdge = lo;
      spiral = planAt(islandEdge);
      ({ outer: spiralOuter, dividers: spiralDividers } = profile(spiral));
      rings = new Map(); outer = ring(0); placeLegs();
      // Reconcile the opening tangents and roadway widths to the same curve.
      for (let i = 0; i < 8; i++) {
        spiral = planAt(islandEdge);
        ({ outer: spiralOuter, dividers: spiralDividers } = profile(spiral, i === 7));
        rings = new Map(); outer = ring(0); placeLegs();
      }
    }
    // Automatic lanes adapt the roadway itself: each stretch is only as wide
    // as the lanes it needs (one lane: the single-lane width, 18-20 ft), the
    // central island stays round, and the outer curb comes in where fewer
    // lanes are needed. The width changes across the openings (exits and
    // entries), so the curbs between legs stay circular.
    const widthOf = (q) => (q >= C ? total : q <= 1 ? widths[C - 1] : widths.slice(0, q - 1).reduce((x, y) => x + y, 0) + widths[C - 1]);
    const adapt = !spiral && sh.kind === "circle" && s.lanes === "auto" && C > 1 && [...need.front, ...need.after].some((q) => q < C);
    if (adapt) {
      const keys = [];
      for (const [i, a] of f.entries()) {
        const L = legs.get(a.id), before = need.after[(i + N - 1) % N];
        keys.push({ t: L.exitRight.t, w: widthOf(before) }, { t: L.exitLeft.t, w: widthOf(need.front[i]) });
        keys.push({ t: L.entryLeft.t, w: widthOf(need.front[i]) }, { t: L.entryRight.t, w: widthOf(need.after[i]) });
      }
      keys.sort((p, q) => p.t - q.t);
      width = (theta) => {
        const t = wrap(theta);
        let i = keys.findIndex((k) => k.t > t);
        if (i < 0) i = 0;
        const hi = keys[i], lo = keys[(i + keys.length - 1) % keys.length];
        const span = wrap(hi.t - lo.t) || 1e-9, x = wrap(t - lo.t) / span;
        return lo.w + (hi.w - lo.w) * x * x * (3 - 2 * x);
      };
      rings = new Map();
      outer = ring(0);
      placeLegs();
      // Once more with the openings where the narrower roadway puts them.
      const again = [];
      for (const [i, a] of f.entries()) {
        const L = legs.get(a.id), before = need.after[(i + N - 1) % N];
        again.push({ t: L.exitRight.t, w: widthOf(before) }, { t: L.exitLeft.t, w: widthOf(need.front[i]) });
        again.push({ t: L.entryLeft.t, w: widthOf(need.front[i]) }, { t: L.entryRight.t, w: widthOf(need.after[i]) });
      }
      keys.splice(0, keys.length, ...again.sort((p, q) => p.t - q.t));
      rings = new Map();
      outer = ring(0);
      placeLegs();
    }
    const round = (r) => new Ring(Array.from({ length: SAMPLES }, (_, n) => { const t = (TAU * n) / SAMPLES; return { x: Math.cos(t) * r, y: Math.sin(t) * r }; }));
    const inner = spiral ? memo("inner", [identity(spiral)], () => new Ring(spiral.apron)) : width ? round(islandEdge) : ring(total);
    // A bundle of new inside lanes needs one guide per lane, not a single
    // stripe enclosing the whole bundle. Parallel guides emerge from the
    // shaped curb in order; nothing is painted through the truck apron.
    for (const plan of spiral?.transitions ?? []) {
      const start = polar(plan.tip), span = wrap(start - polar(plan.marking.at(-1)));
      plan.guides = Array.from({ length: plan.added }, (_, c) => {
        if (c === plan.added - 1) return { boundary: plan.count - 1 - c, points: plan.marking };
        const ring = spiralGuideRing(plan, -widths.slice(c + 1, plan.added).reduce((sum, w) => sum + w, 0));
        const clearance = t => ring.radius(t) - inner.radius(t);
        const points = [];
        let previous = start;
        for (let k = 1; k <= 120; k++) {
          const t = start - span * k / 120;
          if (clearance(t) > 0) {
            if (!points.length) {
              let lo = previous, hi = t;
              for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (clearance(m) > 0) hi = m; else lo = m; }
              points.push(ring.at((lo + hi) / 2));
            }
            points.push(ring.at(t));
          }
          previous = t;
        }
        return { boundary: plan.count - 1 - c, points };
      });
    }
    const dividerRadius = (theta, b = 1) => {
      if (!spiral) return ring(boundaryOff(b)).radius(theta);
      return spiralDividers.get(b).radius(theta);
    };
    const dividerRing = b => {
      if (!spiral) return ring(boundaryOff(b));
      const divider = spiralDividers.get(b);
      return memo("divider", [identity(divider)], () => exactDivider(divider));
    };
    // Lane occupancy changes through the openings, rather than resetting a
    // moving vehicle's lane number each time a new inside lane starts.
    const countAt = circulatingCounter(legs, f, need);
    // Bounds from the island outward. A spiral's new inside lane opens off
    // the curb; its surviving outside lane keeps its assigned width. The
    // nonspiral adaptive layout packs surviving lanes from its round island.
    const laneEdges = (theta, merge = false) => {
      const full = widths.map((_, c) => [total - boundaryOff(C - c), total - boundaryOff(C - c - 1)]);
      if (spiral) {
        // The curb consumes the inside lane as it spirals out. Retain stable
        // lane IDs, but let markings and movement centers follow the actual
        // remaining roadway instead of the old circular island.
        const curb = inner.radius(theta) - islandEdge;
        const extent = outer.radius(theta) - islandEdge;
        const edges = full.map((_, c) => [c ? dividerRadius(theta, C - c) - islandEdge : curb,
          c === C - 1 ? extent : dividerRadius(theta, C - c - 1) - islandEdge]);
        if (merge) {
          for (let c = C - 2; c >= 0; c--) {
            const [left, right] = edges[c], amount = clamp((right - left) / widths[c], 0, 1);
            const next = edges[c + 1][1];
            const center = Math.max(left + Math.min(widths[c] / 2, (extent - left) / 2),
              (left + right) / 2 * amount + (left + next) / 2 * (1 - amount));
            edges[c] = [left, 2 * center - left];
          }
        }
        return edges;
      }
      if (!width) return full;
      const w = width(theta);
      let q = 1;
      while (q < C && widthOf(q + 1) < w) q++;
      const hi = Math.min(C, q + 1), lowWidth = widthOf(q), highWidth = widthOf(hi);
      const f = highWidth > lowWidth ? clamp((w - lowWidth) / (highWidth - lowWidth), 0, 1) : 0;
      const atCount = (count) => {
        let edge = 0;
        const result = widths.map((_, c) => {
          const left = edge;
          edge += c >= count ? 0 : count === 1 ? widthOf(1) : c === count - 1 ? widths[C - 1] : widths[c];
          return [left, edge];
        });
        // A movement in a disappearing lane joins the last surviving lane;
        // custom marking bounds still collapse that lane at the pavement edge.
        return merge ? result.map((pair, c) => result[Math.min(c, count - 1)]) : result;
      };
      const loEdges = atCount(q), hiEdges = atCount(hi);
      return loEdges.map((pair, c) => pair.map((v, side) => v + (hiEdges[c][side] - v) * f));
    };
    // A circulating lane's center (o = 0 outside).
    const laneRings = new Map();
    const laneRing = (o, shift = 0) => {
      const key = `${o}:${shift}`;
      if (!laneRings.has(key)) {
        const result = memo("laneRing", [identity(outer), identity(inner), [...spiralDividers.values()].map(identity), widths, o, shift], () => {
          if (!width && !spiral) laneRings.set(key, ring(laneCenterOff(o) - shift));
          else {
            laneRings.set(key, new Ring(Array.from({ length: SAMPLES }, (_, n) => {
              const t = (TAU * n) / SAMPLES, [l, r] = laneEdges(t, true)[C - 1 - o];
              const rad = islandEdge + (l + r) / 2 + clamp(shift, -(r - l) / 2, (r - l) / 2);
              return { x: Math.cos(t) * rad, y: Math.sin(t) * rad };
            })));
          }
          return laneRings.get(key);
        });
        laneRings.set(key, result);
      }
      return laneRings.get(key);
    };
    const value = { item, memo, sh, C, widths, total, ring, outer, inner, spiral: Boolean(spiral), spiralPlan: spiral, legs, flow: f, use: laneUse(item), boundaryOff, laneCenterOff, laneRing, laneEdges, dividerRing, dividerRadius, countAt, width, islandEdge };
    value.corners = new Map();
    const ordered = G.ordered(item);
    for (const [i, a] of ordered.entries()) {
      const b = ordered[(i + 1) % ordered.length];
      value.corners.set(a.id, memo("corner", [legs.get(a.id).exitKey, legs.get(b.id).entryKey, s.entryRadius, s.exitRadius], () => corner(value, a, b)));
    }
    for (const [i, a] of ordered.entries()) {
      const base = legs.get(a.id), previous = ordered[(i + ordered.length - 1) % ordered.length];
      const L = memo("entry", [identity(base), identity(value.corners.get(previous.id)), a.outgoing ? null : identity(value.corners.get(a.id))],
        () => finishEntry(base, value.corners.get(previous.id), value.corners.get(a.id), outer, Boolean(width || spiral)));
      legs.set(a.id, L);
    }
    return value;
  }
  function exactDivider(divider) {
    const result = new Ring([]);
    // No interpolation across the radial jump at a new-lane opening.
    result.at = t => {
      const radius = divider.radius(t);
      return { x: Math.cos(t) * radius, y: Math.sin(t) * radius };
    };
    return result;
  }
  function finishEntry(base, entryCorner, exitCorner, outer, varying) {
    const a = base.a;
    const L = { ...base };
    L.entryCurb = entryCorner?.entryBoundary;
    L.entryInnerCurb = a.outgoing ? null : exitCorner?.exitBoundary;
    const t0 = entryCorner?.entryT ?? L.entryRight.t;
    const t1 = a.outgoing ? L.entryLeft.t : exitCorner?.exitT ?? L.entryLeft.t;
    L.yieldStart = t0;
    L.yieldEnd = t1;
    L.yieldRing = outer;
    if (varying && a.incoming) {
      // The roadway's smoothstep width transition can reverse curvature
      // across a multi-lane entry. The yield line instead sweeps smoothly
      // between the same curb/nose endpoints: a linear radial transition
      // has no inflection. All entry markings meet this shared boundary.
      const span = wrap(t1 - t0), r0 = outer.radius(t0), r1 = outer.radius(t1);
      if (span > 1e-5 && span < Math.PI && Math.abs(r1 - r0) > 0.01) {
        const angles = [...outer.points.map(p => p.t), wrap(t0), wrap(t1)];
        L.yieldRing = new Ring([...new Set(angles)].map(t => {
          const d = wrap(t - t0), r = d <= span ? r0 + (r1 - r0) * d / span : outer.radius(t);
          return { x: Math.cos(t) * r, y: Math.sin(t) * r };
        }));
      }
    }
    const circleRing = L.circleRing = L.yieldRing;
    L.circleMeet = off => L.meet(off, circleRing);
    if (a.incoming && (entryCorner?.shared || (!a.outgoing && exitCorner?.shared))) {
      const span = wrap(t1 - t0), r0 = length(entryCorner.entryQ), r1 = a.outgoing ? circleRing.radius(t1) : length(exitCorner.exitQ);
      if (span > 1e-5 && span < Math.PI) {
        const angles = [...circleRing.points.map(p => p.t), wrap(t0), wrap(t1)];
        L.yieldRing = new Ring([...new Set(angles)].map(t => {
          const distance = wrap(t - t0), d = distance > TAU - 1e-8 ? 0 : distance;
          // A shared curb moves the entry out beyond the circulating ring.
          // Ease that extra radius back to zero at the splitter instead of
          // interpolating a diagonal across the opening. The zero end slope
          // joins the circulating boundary tangentially at the median.
          const f = Math.min(d / span, 1), base = circleRing.radius(t);
          const extra = (r0 - circleRing.radius(t0)) * (1 - f) ** 2
            + (r1 - circleRing.radius(t1)) * f ** 2;
          const r = d <= span + 1e-8 ? Math.max(base, base + extra) : base;
          return { x: Math.cos(t) * r, y: Math.sin(t) * r };
        }));
      }
    }
    if (a.incoming && a.yieldSetback > 0) {
      // Position the line independently of the circulation boundary. Clip
      // its parallel curve to the actual entry curbs, including their flares.
      // This is an editing offset, not a prescribed yield-line setback.
      L.yieldRing = offsetRing(L.yieldRing, a.yieldSetback);
      const edge = (k, curb) => curb ?? L.line(sp => L.entryOff(k, sp), 0, L.circleMeet(sp => L.entryOff(k, sp)));
      const left = cutAtRing(edge(0, L.entryInnerCurb), L.yieldRing);
      const right = cutAtRing(edge(L.nIn, L.entryCurb), L.yieldRing);
      L.yieldEnd = wrap(polar(left.at(-1)));
      L.yieldStart = wrap(polar(right.at(-1)));
    }
    L.entryMeet = off => L.meet(off, L.yieldRing);
    const crossings = new Map();
    L.entryCrossings = j => {
      if (!crossings.has(j)) crossings.set(j, [
        L.entryMeet(sp => L.entryBounds(j, sp).reduce((sum, d) => sum + d, 0) / 2),
        ...[0, 1].map(side => L.entryMeet(sp => L.entryBounds(j, sp)[side])),
      ]);
      return crossings.get(j);
    };
    const entryEdges = new Map(), frames = new Map();
    L.entryFrame = (j, sp) => {
      const key = j + ":" + sp;
      if (frames.has(key)) return frames.get(key);
      const nominal = station => L.P(L.entryBounds(j, station).reduce((sum, d) => sum + d, 0) / 2, station);
      const p = nominal(sp), t = unit(sub(nominal(sp + 0.01), nominal(sp - 0.01))), right = { x: -t.y, y: t.x };
      if (!entryEdges.has(j)) entryEdges.set(j, [0, 1].map(side => {
        if (!side && !j && L.entryInnerCurb) return L.entryInnerCurb;
        if (side && j === a.incoming - 1 && L.entryCurb) return L.entryCurb;
        const off = station => L.entryBounds(j, station)[side];
        return L.line(off, 0, L.circleMeet(off));
      }));
      const edges = entryEdges.get(j), bounds = L.entryBounds(j, sp);
      const leftPoint = boundaryHit(p, mul(right, -1), edges[0]) ?? L.P(bounds[0], sp);
      const rightPoint = boundaryHit(p, right, edges[1]) ?? L.P(bounds[1], sp);
      const frame = { p: mul(add(leftPoint, rightPoint), 0.5), t };
      frames.set(key, frame);
      return frame;
    };
    return L;
  }
  // Intersect a lane cross section with its actual curb, including the fillet.
  // A nominal offset alone leaves words against the island when the outer
  // lane opens out toward the circulating roadway.
  function boundaryHit(p, n, boundary) {
    let best = null, distance = Infinity;
    for (let i = 1; i < boundary.length; i++) {
      const a = boundary[i - 1], v = sub(boundary[i], a), delta = sub(a, p), den = n.x * v.y - n.y * v.x;
      if (Math.abs(den) < 1e-9) continue;
      const d = (delta.x * v.y - delta.y * v.x) / den, f = (delta.x * n.y - delta.y * n.x) / den;
      if (d >= 0 && d < distance && f >= 0 && f <= 1) { distance = d; best = add(p, mul(n, d)); }
    }
    return best;
  }
  // The approach curves that open the separation for the splitter island
  // (213.3.1, Exhibit 213-2): AR1 (right) - tangent - AR2 (left), as a
  // lateral shift (ft) of the entry side over a longitudinal distance x. 50
  // mph and over: the exhibit's radii and TAN1 100'. Below: 213.3.1's method
  // for the radii and the 50 ft desirable tangent between reverse curves
  // (213.3).
  function approachCurves(mph) {
    const row = mph >= 50 ? [...AR12].reverse().find((r) => mph >= r[0]) : null;
    if (row) return { R1: row[1], R2: row[2], T: TAN1 };
    return { R1: curveRadius(mph, 0.02), R2: curveRadius(Math.max(15, mph - 15), -0.02), T: TANGENT.desirable };
  }
  function separation(mph, shift) {
    if (!(shift > 0.001)) return { length: 0, at: () => 0, kind: "none" };
    const { R1, R2, T: TAN } = approachCurves(mph);
    // Deflection a: (R1 + R2)(1 - cos a) + TAN1 sin a = shift.
    let lo = 0, hi = Math.PI / 2;
    for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; ((R1 + R2) * (1 - Math.cos(m)) + TAN * Math.sin(m) < shift ? (lo = m) : (hi = m)); }
    const a = (lo + hi) / 2, x1 = R1 * Math.sin(a), x2 = x1 + TAN * Math.cos(a), X = x2 + R2 * Math.sin(a);
    const y1 = R1 * (1 - Math.cos(a)), y2 = y1 + TAN * Math.sin(a);
    const at = (x) => {
      if (x <= 0) return 0;
      if (x <= x1) return R1 - Math.sqrt(Math.max(0, R1 * R1 - x * x));
      if (x <= x2) return y1 + (x - x1) * Math.tan(a);
      if (x < X) { const d = X - x; return shift - (R2 - Math.sqrt(Math.max(0, R2 * R2 - d * d))); }
      return shift;
    };
    return { length: X, at, kind: "reverse", R1, R2, tangent: TAN, deflection: a };
  }
  // The lateral gain (ft) of a curve of radius R begun d ft back.
  function curveGain(R, d) {
    if (!(d > 0) || !(R > 0)) return 0;
    const dc = R * Math.sin(CURVE_LIMIT);
    if (d <= dc) return R - Math.sqrt(R * R - d * d);
    return R * (1 - Math.cos(CURVE_LIMIT)) + (d - dc) * Math.tan(CURVE_LIMIT);
  }
  // Where the approach must begin (distance from the center to the mouth):
  // the circle's edge, the splitter island, and the separation taper.
  function requiredReach(item, a) {
    const sh = shape(item), t = polar(a.x || a.y ? a : axes(a).u);
    const edge = shapeRadius(sh, t - sh.t);
    // Minis do not need the conventional raised splitter's upstream
    // reverse-curve separation taper. Keep their editable compact stems.
    if (settings(item).mini) return Math.ceil(edge + Math.max(15, a.splitter ?? 50));
    const shift = a.incoming && a.outgoing ? Math.max(0, 2 * (NOSE_RADIUS + NOSE_OFFSET) - G.gap(a)) : 0;
    return Math.ceil(edge + (a.splitter ?? splitterLength(a.speed)) + separation(a.speed, shift).length);
  }
  // 213.5 / Figure 213.5.1: the spiral is two semicircles. The smaller is the
  // inside edge of travel lane beside the truck apron; the larger's diameter is
  // the smaller's plus the inside lane's width, so the inside lane narrows to
  // nothing along it. They share their end Q; at the other end the island's
  // curb runs on the small circle's tangent from P_s until it meets the large
  // circle (T), and the spiral marking (6" white 2'-4' dotted guide) continues
  // the large circle from T to P_l, opening the new inside lane at its entry.
  // The large half is the one circulating traffic travels before that entry.
  function spiralSources(item, f) {
    const sources = spiralEntries(item).map(entry => {
      const to = destinations(item, entry, entry.inLanes[0]).map(id => item.approaches.find(b => b.id === id));
      const preferred = to.filter(b => ["left", "u"].includes(turnOf(item, entry, b)));
      return { entry, exit: (preferred.length ? preferred : to).sort((p, q) => exitOrder(item, entry, p) - exitOrder(item, entry, q))[0] };
    });
    if (!sources.length) sources.push({ entry: f.find(a => circulatingIn(item, a) > 1) ?? f[0], exit: f.find(b => b.outgoing) });
    return sources;
  }
  function spiralPlan(item, legs, f, rs, w, apron, C, sources = spiralSources(item, f)) {
    const sh = shape(item), widths = laneWidths(item);
    // FDM 213.5 gives the circular one-lane construction. On an oval or
    // peanut, carry its curb displacement along the chosen base shape;
    // derive subsequent lane boundaries as normal offsets, not an affine
    // stretch of lane widths. This is a geometric extension of that example.
    const base = sh.kind === "circle" ? null : new Ring(ringSamples(sh, sh.b - rs));
    const transitions = sources.map(({ entry, exit }) => {
      const added = spiralLaneCount(item, entry);
      return entrySpiralPlan(item, legs, entry, exit, rs, widths.slice(0, added).reduce((sum, w) => sum + w, 0), apron, added, base);
    }).filter(Boolean);
    if (!transitions.length) return null;
    const first = transitions[0];
    if (transitions.length === 1) return { ...first, transitions };
    // FDM 213.5 supplies each local curb/guide opening. Between successive
    // openings, join their circular construction tangents with a monotone
    // radial Hermite curve. This is a derived multi-entry interpolation, not
    // an additional prescribed FDM radius or a rotated copy of one island.
    // Both the apron and grass use the same ordered sequence of openings.
    const compose = key => {
      const ordered = [...transitions].sort((a, b) => wrap(polar(b[key].T)) - wrap(polar(a[key].T)));
      const points = [];
      for (let i = 0; i < ordered.length; i++) {
        const a = ordered[i][key], b = ordered[(i + 1) % ordered.length][key];
        // T -> P_s is the straight tangent curb; preserve its exact vertices.
        points.push(...(a.tangent ?? [a.T, a.ps]));
        const from = polar(a.ps), to = polar(b.T), span = wrap(from - to);
        const r0 = length(a.ps), r1 = length(b.T);
        const lift0 = r0 - (base?.radius(from) ?? 0), lift1 = r1 - (base?.radius(to) ?? 0);
        // Radial slope at T from the receiving construction's large circle.
        const v = sub(b.T, b.center), tangent = base ? unit(sub(b.ring.at(polar(b.T) - 0.001), b.T)) : { x: v.y, y: -v.x };
        const angularSpeed = -(b.T.x * tangent.y - b.T.y * tangent.x) / (r1 * r1);
        const slope = dot(unit(b.T), tangent) / angularSpeed;
        const baseSlope = base ? (base.radius(to - 0.001) - base.radius(to + 0.001)) / 0.002 : 0;
        const m = clamp(span * (slope - baseSlope), 0, 3 * (lift1 - lift0));
        const steps = Math.max(2, Math.ceil(span / (TAU / SAMPLES)));
        for (let k = 1; k < steps; k++) {
          const u = k / steps;
          const t = from - span * u;
          const radius = (base?.radius(t) ?? 0) + lift0 + (lift1 - lift0) * (3 * u * u - 2 * u * u * u) + m * (u * u * u - u * u);
          points.push({ x: radius * Math.cos(t), y: radius * Math.sin(t) });
        }
      }
      return points;
    };
    const curb = compose("outerConstruction");
    return { ...first, transitions, apron: curb, island: compose("innerConstruction"),
      alignmentFits: transitions.every(t => t.alignmentFits) };
  }
  function entrySpiralPlan(item, legs, entry, exit, rs, w, apron, added = 1, base = null) {
    if (!exit || !(rs - apron > 5)) return null;
    // Figure 213.5.1: T (the curb/guide junction) opens the inside lane.
    // P_l is downstream of T, not at the entry. Solve the construction's
    // rotation from the new inside lane's left-edge tangent. T belongs on
    // that lane's left side, not at the divider beside the through/right lane. Using an entry angle for P_l puts T upstream by atan(t/r).
    const L = legs.get(entry.id), boundary = sp => L.entryOff(0, sp);
    const stop = L.meet(boundary), mouth = L.P(boundary(stop), stop);
    const travel = unit(sub(L.P(boundary(stop + 0.01), stop + 0.01), mouth));
    const tangentLength = Math.sqrt(2 * rs * w), tipRadius = Math.hypot(rs, tangentLength);
    const projection = dot(mouth, travel), discriminant = projection * projection - dot(mouth, mouth) + tipRadius * tipRadius;
    let distance = -projection - Math.sqrt(Math.max(0, discriminant));
    let fits = discriminant >= 0 && distance >= 0;
    const warp = p => {
      if (!base) return p;
      const t = polar(p), step = TAU / SAMPLES, tangent = unit(sub(base.at(t + step), base.at(t - step)));
      return add(base.at(t), mul({ x: tangent.y, y: -tangent.x }, length(p) - rs));
    };
    const target = add(mouth, mul(travel, Math.max(0, distance)));
    let tp = polar(target) - Math.atan2(tangentLength, rs);
    if (base) {
      // Solve the actual shaped tip against the incoming left edge. Normal
      // offsets keep lane widths intact; radial stretching does not.
      const at = t => warp({ x: tipRadius * Math.cos(t), y: tipRadius * Math.sin(t) });
      const side = t => { const d = sub(at(t), mouth); return d.x * travel.y - d.y * travel.x; };
      const hits = [];
      for (let k = 0; k < SAMPLES; k++) {
        let lo = TAU * k / SAMPLES, hi = TAU * (k + 1) / SAMPLES, sign = side(lo);
        if (sign * side(hi) > 0) continue;
        for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (side(m) * sign > 0) lo = m; else hi = m; }
        const t = (lo + hi) / 2, distance = dot(sub(at(t), mouth), travel);
        if (distance >= 0) hits.push({ t, distance });
      }
      hits.sort((a, b) => a.distance - b.distance);
      fits = Boolean(hits.length);
      if (fits) tp = hits[0].t - Math.atan2(tangentLength, rs);
    }
    const d = { x: Math.cos(tp), y: Math.sin(tp) }, tau = { x: -d.y, y: d.x };
    const cl = mul(d, w / 2);
    const build = (r) => {
      const rl = r + w / 2, ps = mul(d, r);
      const t = Math.sqrt(Math.max(0, rl * rl - (r - w / 2) ** 2)), T = add(ps, mul(tau, t));
      const psiT = polar(sub(T, cl));
      const small = Array.from({ length: 181 }, (_, k) => mul({ x: Math.cos(tp - (Math.PI * k) / 180), y: Math.sin(tp - (Math.PI * k) / 180) }, r));
      let span = wrap((tp + Math.PI) - psiT);
      const large = Array.from({ length: 121 }, (_, k) => { const a = tp + Math.PI - (span * k) / 120; return add(cl, { x: Math.cos(a) * rl, y: Math.sin(a) * rl }); });
      const tangent = base ? Array.from({ length: 41 }, (_, i) => add(T, mul(sub(ps, T), i / 40))) : [];
      return { points: [...small, ...large.slice(1), ...tangent.slice(1, -1)].map(warp), T: warp(T), ps: warp(ps), center: cl, psiT, rl,
        tangent: base ? tangent.map(warp) : null,
        ring: base ? new Ring(Array.from({ length: SAMPLES }, (_, k) => {
          const t = TAU * k / SAMPLES;
          return warp(add(cl, { x: Math.cos(t) * rl, y: Math.sin(t) * rl }));
        })) : null };
    };
    const outer = build(rs), inner = build(rs - apron);
    const markSpan = wrap(outer.psiT - tp);
    const marking = Array.from({ length: 41 }, (_, k) => { const a = outer.psiT - (markSpan * k) / 40; return warp(add(cl, { x: Math.cos(a) * outer.rl, y: Math.sin(a) * outer.rl })); });
    return { exit: exit.id, entry: entry.id, tip: outer.T, alignmentFits: fits, outerConstruction: outer, innerConstruction: inner, apron: outer.points, island: inner.points, marking, rs, rl: outer.rl, w, added, count: Math.max(added + 1, L.after), warped: Boolean(base) };
  }
  function spiralGuideRing(plan, offset = 0) {
    const rings = plan.guideRings ??= new Map();
    if (rings.has(offset)) return rings.get(offset);
    let ring;
    if (plan.warped) ring = offsetRing(plan.outerConstruction.ring, offset);
    else {
      const center = plan.outerConstruction.center, radius = plan.rl + offset;
      ring = new Ring([]);
      ring.radius = t => {
        const u = { x: Math.cos(t), y: Math.sin(t) }, along = dot(center, u);
        return along + Math.sqrt(Math.max(0, radius * radius - dot(center, center) + along * along));
      };
      ring.at = t => { const r = ring.radius(t); return { x: Math.cos(t) * r, y: Math.sin(t) * r }; };
    }
    rings.set(offset, ring);
    return ring;
  }
  function spiralOffsetPoint(plan, point, distance) {
    if (!plan.warped) return add(point, mul(unit(sub(point, plan.outerConstruction.center)), distance));
    const ring = spiralGuideRing(plan), t = polar(point), tangent = unit(sub(ring.at(t + 0.001), ring.at(t - 0.001)));
    return add(point, mul({ x: tangent.y, y: -tangent.x }, distance));
  }
  // Bracketed Illinois interpolation: converge on smooth lane/ring crossings
  // without dozens of identical bisections. Retain the bracket and a tight
  // numerical tolerance (feet), including where sampled ring tangents change.
  function crossingRoot(fn, lo, hi, f0 = fn(lo), f1 = fn(hi)) {
    let side = 0;
    for (let i = 0; i < 60; i++) {
      let m = (lo * f1 - hi * f0) / (f1 - f0);
      if (!Number.isFinite(m) || m <= lo || m >= hi) m = (lo + hi) / 2;
      const value = fn(m);
      if (Math.abs(value) < 1e-12 || hi - lo < 1e-11) return m;
      if ((value > 0) === (f0 > 0)) { lo = m; f0 = value; if (side === -1) f1 *= 0.5; side = -1; }
      else { hi = m; f1 = value; if (side === 1) f0 *= 0.5; side = 1; }
    }
    return (lo + hi) / 2;
  }
  // One leg. sp is distance in from the mouth along the approach axis; offsets
  // are feet right of the axis (+n, toward the exit side). The entry side's
  // lane edge line is hIn(sp) left of the axis, the exit side's hOut(sp) right.
  function leg(item, a, outer, ring, memo = (stage, inputs, build) => build()) {
    const s = settings(item), { u, n } = approachAxes(a);
    const anchor = sub(a, mul(n, a.bend));
    const straight = (d, sp) => add(add(anchor, mul(n, d)), mul(u, -sp));
    const reachRing = (d, r = outer) => {
      let lo = 0, hi = Math.max(0, dot(a, u));
      if (r.inside(straight(d, lo))) return 0;
      if (!r.inside(straight(d, hi))) return dot(a, u);
      for (let i = 0; i < 50; i++) { const m = (lo + hi) / 2; if (r.inside(straight(d, m))) hi = m; else lo = m; }
      return (lo + hi) / 2;
    };
    const twoWay = a.incoming > 0 && a.outgoing > 0;
    const S0 = memo("reach", [identity(outer), a.x, a.y, u.x, u.y, a.bend], () => Math.max(1, reachRing(0)));
    const sideKeys = {};
    for (const side of ["entry", "exit"]) {
      const inputs = JSON.parse(JSON.stringify(a));
      if (twoWay && inputs.bezierSides) delete inputs.bezierSides[side === "entry" ? "exit" : "entry"];
      sideKeys[side] = JSON.stringify([identity(outer), inputs, s.mini, diameter(item)]);
    }
    // One smooth centerline for both directions and the median. The mouth
    // follows the handle (and takes attached roads with it); the circle end
    // stays on its original axis. Zero slope and curvature at both ends keep
    // connected lanes tangent. This is an editing control, not a prescribed
    // highway alignment. Normal offsets preserve the cross section.
    const bendAt = sp => {
      if (!a.bend || sp >= S0) return { value: 0, slope: 0, second: 0 };
      if (sp <= 0) return { value: a.bend, slope: 0, second: 0 };
      const t = sp / S0, q = t * (1 - t);
      return { value: a.bend * (1 - t ** 3 * (10 - 15 * t + 6 * t * t)),
        slope: -a.bend * 30 * q ** 2 / S0,
        second: -a.bend * 60 * q * (1 - 2 * t) / (S0 * S0) };
    };
    const bezier = approachBezier(a, S0, straight(0, S0));
    const sideBeziers = {};
    for (const side of ["entry", "exit"]) if (a.bezierSides?.[side]) {
      const edit = a.bezierSides[side], points = bezier.points.map(p => ({ ...p }));
      points[2] = add(points[2], add(mul(u, edit.pull), mul(n, edit.offset)));
      if (edit.mouth) {
        points[1] = add(points[1], add(mul(u, -edit.mouth.pull), mul(n, edit.mouth.offset)));
        const inward = sub(points[1], points[0]), mouthNormal = length(inward) > 1e-8 ? unit({ x: inward.y, y: -inward.x }) : axes(a).n;
        // Rotate this carriageway's cross section about its own road mouth,
        // rather than swinging it around the median and moving the other side.
        const incoming = side === "entry", widths = incoming ? a.inLanes : a.outLanes;
        const middle = (incoming ? -1 : 1) * (G.gap(a) / 2 + widths.reduce((sum, _, j) => sum + G.width(a, incoming, j), 0) / 2);
        const shift = mul(sub(axes(a).n, mouthNormal), middle);
        points[0] = add(points[0], shift); points[1] = add(points[1], shift);
      }
      if (edit.connection) {
        const shift = add(mul(u, edit.connection.along), mul(n, edit.connection.across));
        points[0] = add(points[0], shift); points[1] = add(points[1], shift);
      }
      sideBeziers[side] = { points };
    }
    const sideOf = d => !a.outgoing ? "entry" : !a.incoming ? "exit" : d < 0 ? "entry" : d > 0 ? "exit" : null;
    const hasBezier = d => Boolean(a.bezier || sideBeziers[sideOf(d)]);
    // Each carriageway's cubic supplies its perpendicular offsets; its
    // splitter edge, pavement and lane paint all follow that same curve.
    // The flared boundaries can meet the ring beyond the cubic's endpoint.
    // Ease its acceleration to zero there instead of dropping curvature in
    // one step: width measured normal to a flared lane depends on curvature.
    const cubicSamples = new Map();
    const cubic = (sp, d = 0) => {
      const curve = sideBeziers[sideOf(d)] ?? bezier, hit = cubicSamples.get(curve);
      if (hit?.sp === sp) return hit.value;
      const { points: [p0, p1, p2, p3] } = curve, t = clamp(sp / S0, 0, 1), v = 1 - t;
      // These three values are used together by points, normals and lane
      // widths. Evaluate the same Bernstein expressions directly rather than
      // allocating dozens of temporary vectors for every boundary sample.
      const w0 = v ** 3, w1 = 3 * v * v * t, w2 = 3 * v * t * t, w3 = t ** 3;
      const d0 = v * v, d1 = 2 * v * t, d2 = t * t, firstScale = 3 / S0, secondScale = 6 / (S0 * S0);
      let point = { x: (p0.x * w0 + p1.x * w1) + (p2.x * w2 + p3.x * w3),
        y: (p0.y * w0 + p1.y * w1) + (p2.y * w2 + p3.y * w3) };
      let first = { x: ((p1.x - p0.x) * d0 + (p2.x - p1.x) * d1 + (p3.x - p2.x) * d2) * firstScale,
        y: ((p1.y - p0.y) * d0 + (p2.y - p1.y) * d1 + (p3.y - p2.y) * d2) * firstScale };
      let second = { x: ((p2.x - p1.x * 2 + p0.x) * v + (p3.x - p2.x * 2 + p1.x) * t) * secondScale,
        y: ((p2.y - p1.y * 2 + p0.y) * v + (p3.y - p2.y * 2 + p1.y) * t) * secondScale };
      if (sp < 0 || sp > S0) {
        const delta = sp - t * S0, sign = Math.sign(delta), fade = S0 / 4, d = Math.min(Math.abs(delta), fade);
        point = add(point, add(mul(first, delta), mul(second, d * d / 2 - d ** 3 / (6 * fade) + (Math.abs(delta) - d) * fade / 2)));
        first = add(first, mul(second, sign * (d - d * d / (2 * fade))));
        second = mul(second, 1 - d / fade);
      }
      const value = { point, first, second };
      cubicSamples.set(curve, { sp, value });
      return value;
    };
    const normal = (sp, d = 0) => {
      if (!hasBezier(d)) return unit(add(n, mul(u, bendAt(sp).slope)));
      const { first, second } = cubic(sp, d);
      // A control in a legacy file may sit directly on its endpoint. Use the
      // limiting tangent instead of collapsing its lanes onto one point.
      const tangent = length(first) > 1e-8 ? first : length(second) > 1e-8 ? mul(second, sp >= S0 ? -1 : 1)
        : sub((sideBeziers[sideOf(d)] ?? bezier).points[3], (sideBeziers[sideOf(d)] ?? bezier).points[0]);
      return unit({ x: tangent.y, y: -tangent.x });
    };
    const P = (d, sp) => hasBezier(d) ? add(cubic(sp, d).point, mul(normal(sp, d), d))
      : !a.bend ? straight(d, sp) : add(straight(bendAt(sp).value, sp), mul(normal(sp), d));
    const reference = (incoming, sp) => hasBezier(incoming ? -1 : 1) ? cubic(sp, incoming ? -1 : 1).point : P(0, sp);
    const metric = (d, sp) => {
      if (hasBezier(d)) {
        const { first, second } = cubic(sp, d), speed = length(first);
        return speed < 1e-8 ? 0 : speed + d * (first.x * second.y - first.y * second.x) / (speed * speed);
      }
      const b = bendAt(sp), speed = Math.hypot(1, b.slope);
      return speed - d * b.second / (speed * speed);
    };
    const hm = G.gap(a) / 2;
    const curb = CURB[a.curb] ?? CURB.E;
    const wantedLength = a.splitter ?? splitterLength(a.speed);
    // The lane edge lines are 12 ft apart at the nose: its R 3' plus 3' to
    // each line. A divided approach whose median already gives that keeps its
    // island from the mouth (213.3.1: AR1 is not needed there).
    const noseSeparation = s.mini ? 2 * hm : 2 * (NOSE_RADIUS + NOSE_OFFSET);
    const divided = twoWay && 2 * hm >= noseSeparation;
    const shift = twoWay && !divided ? noseSeparation - 2 * hm : 0;
    const sep = separation(a.speed, shift);
    // Exhibit 213-2: the opposing (exit) side stays on the approach centerline;
    // the entry side curves out to open the island.
    let nose = twoWay && (!s.mini || a.median > 0) ? (divided ? 0 : Math.max(0, S0 - wantedLength)) : null;
    let start = nose == null ? 0 : Math.max(0, nose - sep.length);
    const sepScale = nose != null && nose - start < sep.length - 0.01 ? (nose - start) / (sep.length || 1) : 1;
    const islandLength = nose == null ? 0 : S0 - nose;      // nose to the circle
    // Near the circle the entry side follows AR3 after its tangent; the exit
    // follows its independent lane radius.
    const islandFrom = nose == null || divided ? Math.max(0, S0 - wantedLength) : nose;
    const room = S0 - islandFrom;
    const tangent = room >= 2 * TANGENT.desirable ? TANGENT.desirable : room >= 2 * TANGENT.min ? TANGENT.min : room / 2;
    // 213.3 requires a tangent between reverse ENTRY curves. The exit has
    // no reverse curve here: use the available run for its flat, outward
    // sweep (213.7.3), instead of delaying it by the entry's tangent length.
    // Anchor the start using the default construction. Changing a radius
    // must bend this same run, not slide its start toward the circle and
    // undo the bend. curveGain continues tangentially after the angle cap.
    // Mini entries fit their deflection into the smaller opening. This
    // quarter-diameter editing envelope is not a prescribed design radius;
    // the independent radius controls still determine the actual curves.
    const compactFrom = s.mini ? S0 - diameter(item) / 4 : 0;
    const inFrom = Math.max(compactFrom, islandFrom + tangent, S0 - AR3 * Math.sin(CURVE_LIMIT));
    const outFrom = Math.max(compactFrom, islandFrom, S0 - EXIT_RANGE[0] * Math.sin(CURVE_LIMIT));
    const curveFrom = Math.min(inFrom, outFrom);
    const flareIn = (sp) => curveGain(a.ar3, sp - inFrom);
    const flareOut = (sp) => curveGain(a.exitCurve, sp - outFrom);
    const shiftAt = (sp) => (nose == null || divided ? 0 : sp <= start ? 0 : sp >= nose ? shift : sep.at(((sp - start) / sepScale)));
    const hIn = (sp) => hm + shiftAt(sp) + flareIn(sp);
    const hOut = (sp) => hm + flareOut(sp);
    // A stay-in-lane gore (213.7.2) has its full width along the island and
    // opens upstream at the 7:1 taper. Its construction moves upstream with
    // the yield setback; the visible end is trimmed to the actual yield curve.
    // Keep the saved length/width settings so resetting the line restores it.
    const goreEnd = Math.max(0, S0 - a.yieldSetback);
    const goreStart = (k) => a.entryGoreLengths?.[a.inLanes[k]] != null ? Math.max(0, goreEnd - a.entryGoreLengths[a.inLanes[k]])
      : a.entryGores?.[a.inLanes[k]] != null
      ? Math.max(0, goreEnd - TAPER * entryGoreWidth(a, k))
      : Math.max(0, (nose ?? S0) - a.yieldSetback - TAPER * entryGoreWidth(a, k));
    const gore = (sp, k = 1) => {
      const w = entryGoreWidth(a, k), start = goreStart(k);
      return w * clamp((sp - start) / Math.max(0.01, Math.min(TAPER * w, goreEnd - start)), 0, 1);
    };
    const inWidths = a.inLanes.map((_, j) => G.width(a, true, j)), outWidths = a.outLanes.map((_, j) => G.width(a, false, j));
    // Lane widths are square to the lanes: where the edge turns, a width w
    // spans w / cos(turn) across the approach axis.
    const stretch = (h, sp, side = 1) => Math.hypot(1, (h(sp + 0.5) - h(sp - 0.5)) / Math.max(0.1, Math.abs(metric(side * h(sp), sp))));
    const inSums = [0], outSums = [0], entrySections = new Map(), exitSections = new Map();
    for (const w of inWidths) inSums.push(inSums.at(-1) + w);
    for (const w of outWidths) outSums.push(outSums.at(-1) + w);
    const entrySection = sp => {
      if (!entrySections.has(sp)) {
        const gores = Array.from({ length: a.incoming + 1 }, (_, k) => gore(sp, k)), sums = [0];
        for (let k = 1; k <= a.incoming; k++) sums.push(sums.at(-1) + (k < a.incoming ? gores[k] : 0));
        entrySections.set(sp, { h: hIn(sp), stretch: stretch(hIn, sp, -1), gores, sums });
      }
      return entrySections.get(sp);
    };
    const entryOff = (k, sp) => { const v = entrySection(sp); return -(v.h + ((inSums[k] ?? inSums.at(-1)) + (v.sums[k] ?? v.sums.at(-1))) * v.stretch); };
    // The painted gore is outside the riding space used by YIELD and paths.
    const goreOffset = (sp, k) => { const v = entrySection(sp); return (v.gores[k] ?? gore(sp, k)) * v.stretch; };
    const entryBounds = (j, sp) => [entryOff(j, sp), entryOff(j + 1, sp) + goreOffset(sp, j + 1)];
    const exitOff = (k, sp) => {
      if (!exitSections.has(sp)) exitSections.set(sp, { h: hOut(sp), stretch: stretch(hOut, sp) });
      const v = exitSections.get(sp); return v.h + (outSums[k] ?? outSums.at(-1)) * v.stretch;
    };
    // The island's curb: 3' from each lane edge line at the nose, easing on
    // R 200' to the curb offset (Exhibit 213-2 Detail A).
    const easeFrom = nose == null ? 0 : divided ? -Infinity : nose + NOSE_RADIUS;
    const curbOffset = (sp) => {
      if (easeFrom === -Infinity) return curb;
      const x = sp - easeFrom;
      if (x <= 0) return NOSE_OFFSET;
      return Math.max(curb, NOSE_OFFSET - (NOSE_EASE - Math.sqrt(Math.max(0, NOSE_EASE * NOSE_EASE - x * x))));
    };
    // A directly edited circle corner stays on the splitter's setback ring.
    // Translate its endpoint and tangent control together: the neighboring
    // carriageway follows the corner with its widths and curve pull intact.
    // The angle is relative to the construction axis, so rotation/resize
    // preserve the edit instead of leaving a point behind on the sheet.
    for (const side of ["entry", "exit"]) {
      const edit = a.bezierSides?.[side];
      if (edit?.corner == null || !twoWay) continue;
      const target = ring(-ISLAND_SETBACK).at(polar(u) + edit.corner), sp = S0 * (edit.cornerAt ?? 1);
      const d = side === "entry" ? -(hIn(sp) - curbOffset(sp)) : hOut(sp) - curbOffset(sp);
      const points = sideBeziers[side].points;
      const shift = v => { points[2] = add(points[2], v); points[3] = add(points[3], v); cubicSamples.clear(); };
      // Retain the original station of the visible corner. Pinning the
      // cubic endpoint instead would jump the curve on its first edit.
      for (let i = 0; i < 8; i++) {
        const p = P(d, sp), error = sub(target, p);
        if (length(error) < 1e-8) break;
        shift({ x: 0.01, y: 0 }); const dx = mul(sub(P(d, sp), p), 100);
        shift({ x: -0.01, y: 0.01 }); const dy = mul(sub(P(d, sp), p), 100);
        shift({ x: 0, y: -0.01 });
        const det = dx.x * dy.y - dx.y * dy.x;
        if (Math.abs(det) < 1e-8) break;
        shift({ x: (error.x * dy.y - error.y * dy.x) / det, y: (dx.x * error.y - dx.y * error.x) / det });
      }
    }
    const line = (off, from = 0, to = null) => {
      const end = to ?? S0;
      const steps = Math.max(2, Math.ceil(Math.abs(end - from) / 2));
      return Array.from({ length: steps + 1 }, (_, i) => { const sp = from + ((end - from) * i) / steps; return P(off(sp), sp); });
    };
    const meet = (off, r = outer) => {
      let lo = 0, hi = S0 + 80;
      if (r.inside(P(off(lo), lo))) return 0;
      // A skewed cubic can enter and leave the ring before its extrapolated
      // endpoint. Bracket its FIRST crossing rather than assuming the far
      // endpoint is inside (which sent lane ends far past the roundabout).
      if (hasBezier(off(S0)) || a.bend) {
        const end = hi, step = Math.max(1, end / 80);
        let closest = 0, distance = Infinity, found = false;
        const separation = sp => { const p = P(off(sp), sp); return length(p) - r.radius(polar(p)); };
        for (let sp = 0; sp <= end + step / 2; sp += step) {
          const at = Math.min(end, sp), gap = separation(at);
          if (gap <= 0) { hi = at; lo = Math.max(0, at - step); found = true; break; }
          if (gap < distance) { distance = gap; closest = at; }
        }
        if (!found) {
          // A tangent or currently disconnected edge still needs a stable end
          // while editing. Use its nearest approach to the ring, not end+80.
          lo = Math.max(0, closest - step); hi = Math.min(end, closest + step);
          for (let i = 0; i < 30; i++) {
            const p = lo + (hi - lo) / 3, q = hi - (hi - lo) / 3;
            if (separation(p) < separation(q)) hi = q; else lo = p;
          }
          return (lo + hi) / 2;
        }
      }
      const gap = sp => { const p = P(off(sp), sp); return length(p) - r.radius(polar(p)); };
      const f0 = gap(lo), f1 = gap(hi);
      if (f0 * f1 <= 0) return crossingRoot(gap, lo, hi, f0, f1);
      // Preserve the endpoint behavior for a disconnected uncurved edge.
      for (let i = 0; i < 50; i++) { const m = (lo + hi) / 2; if (r.inside(P(off(m), m))) hi = m; else lo = m; }
      return (lo + hi) / 2;
    };
    const nIn = circulatingIn(item, a), nOut = a.outgoing;
    const entryLeft = memo("entryMeet", [sideKeys.entry, 0], () => meet(sp => entryOff(0, sp)));
    const exitLeft = memo("exitMeet", [sideKeys.exit, 0], () => meet(sp => exitOff(0, sp)));
    const entryRight = memo("entryMeet", [sideKeys.entry, nIn], () => meet(sp => entryOff(nIn, sp)));
    const exitRight = memo("exitMeet", [sideKeys.exit, nOut], () => meet(sp => exitOff(nOut, sp)));
    const angle = (off, sp) => wrap(polar(P(off(sp), sp)));
    const L = {
      a, u, n, P, reference, normal, metric, bezier, sideBeziers, S0, hIn, hOut, hm, shift, sep, sepScale, start, nose, divided, curb, curbOffset, tangent, curveFrom, islandLength,
      gore, goreStart, goreEnd, goreOffset, twoWay, entryOff, entryBounds, exitOff, line, meet, nIn, nOut, inWidths, outWidths, wantedLength,
      entryLeft: { sp: entryLeft, t: angle((sp) => entryOff(0, sp), entryLeft) },
      exitLeft: { sp: exitLeft, t: angle((sp) => exitOff(0, sp), exitLeft) },
      entryRight: { sp: entryRight, t: angle((sp) => entryOff(nIn, sp), entryRight) },
      exitRight: { sp: exitRight, t: angle((sp) => exitOff(nOut, sp), exitRight) },
    };
    L.entryKey = sideKeys.entry; L.exitKey = sideKeys.exit;
    L.entryMid = wrap(L.entryLeft.t - wrap(L.entryLeft.t - L.entryRight.t) / 2);
    L.exitMid = wrap(L.exitLeft.t + wrap(L.exitRight.t - L.exitLeft.t) / 2);
    L.phi = wrap(polar(P(0, S0)));
    return L;
  }
  // Curve handles sit on each splitter-side lane boundary just before the
  // circle. Solve the radius at that fixed station so the boundary follows
  // a sideways drag, with no movement of the mouth or its linked roads.
  function approachCurveHandle(item, a, incoming) {
    const L = layout(item).legs.get(a.id), sp = Math.max(0, L.S0 - 3);
    return { p: L.P(incoming ? -L.hIn(sp) : L.hOut(sp), sp), sp, n: mul(L.normal(sp), incoming ? -1 : 1) };
  }
  function approachBendHandle(item, a) {
    // At the median's outer end, on the road connection. An undivided
    // two-way approach uses its centerline; a one-way approach uses the
    // middle of its mouth, clear of both outer-edge handles.
    const offset = a.incoming && a.outgoing ? 0 : (G.side(a, true) + G.side(a, false)) / 2;
    return { p: G.local(a, offset), n: approachAxes(a).n };
  }
  // The construction axis stays separate from the mouth tangent. Rotating a
  // Bézier handle changes the tangent used by connected roads, without moving
  // the circle endpoint or redefining the approach's movement directions.
  const approachAxes = a => axes({ angle: a.bezier?.axis ?? a.angle });
  function approachBezier(a, span, end) {
    const { u, n } = approachAxes(a), curve = {
      axis: a.bezier?.axis ?? a.angle,
      mouth: { pull: span / 3, offset: 0, ...a.bezier?.mouth },
      circle: { pull: span / 3, offset: 0, ...a.bezier?.circle },
    };
    const p0 = { x: a.x, y: a.y }, p3 = end;
    return { curve, points: [p0, add(add(p0, mul(u, -curve.mouth.pull)), mul(n, curve.mouth.offset)),
      add(add(p3, mul(u, curve.circle.pull)), mul(n, curve.circle.offset)), p3] };
  }
  function approachBezierHandles(item, a) {
    const { bezier } = layout(item).legs.get(a.id);
    return { mouth: { from: bezier.points[0], p: bezier.points[1] }, circle: { from: bezier.points[3], p: bezier.points[2] } };
  }
  // Each carriageway has its own two controls. Deltas stay in the construction
  // frame so whole-approach moves and rotations carry all four controls along.
  function approachSideBezierHandles(item, a, side) {
    return sideBezierHandles(layout(item).legs.get(a.id), side);
  }
  function sideBezierHandles(L, side) {
    const incoming = side === "entry";
    const widths = incoming ? L.inWidths : L.outWidths, middle = widths.reduce((sum, w) => sum + w, 0) / 2;
    const points = (L.sideBeziers[side] ?? L.bezier).points;
    const mouth = L.P((incoming ? -1 : 1) * (L.hm + middle), 0);
    const circle = L.P(incoming ? -L.hIn(L.S0) - middle : L.hOut(L.S0) + middle, L.S0);
    return { mouth: { from: mouth, p: add(mouth, sub(points[1], points[0])) },
      circle: { from: circle, p: add(circle, sub(points[2], points[3])) } };
  }
  const approachSideBezierHandle = (item, a, side) => approachSideBezierHandles(item, a, side).circle;
  function setApproachSideBezier(item, a, side, delta, end = "circle") {
    const L = layout(item).legs.get(a.id), incoming = side === "entry";
    const previous = L.a.bezierSides?.[side] ?? { pull: 0, offset: 0 };
    if (end === "mouth") {
      const handle = approachSideBezierHandles(item, L.a, side).mouth, vector = add(sub(handle.p, handle.from), delta);
      const pull = -dot(vector, L.u);
      a.bezierSides = { ...L.a.bezierSides, [side]: { ...previous,
        mouth: { pull: pull - L.bezier.curve.mouth.pull, offset: dot(vector, L.n) - L.bezier.curve.mouth.offset } } };
      return;
    }
    const middle = (incoming ? L.inWidths : L.outWidths).reduce((sum, w) => sum + w, 0) / 2;
    const offset = incoming ? -L.hIn(L.S0) - middle : L.hOut(L.S0) + middle;
    let target = sub(add(approachSideBezierHandle(item, L.a, side).p, delta), (L.sideBeziers[side] ?? L.bezier).points[3]);
    if (length(target) < Math.hypot(offset, 1)) target = mul(unit(target), Math.hypot(offset, 1));
    const square = dot(target, target), pull = Math.sqrt(Math.max(1, square - offset * offset));
    // The endpoint normal rotates with this control. Invert that rotation as
    // well as the control vector so the handle follows the pointer exactly.
    const vector = mul(sub(mul(target, pull), mul({ x: -target.y, y: target.x }, offset)), pull / square);
    const edit = { pull: dot(vector, L.u) - L.bezier.curve.circle.pull,
      offset: dot(vector, L.n) - L.bezier.curve.circle.offset };
    if (previous.corner != null) {
      const Lt = layout(item), wanted = add(sideBezierHandles(L, side).circle.p, delta);
      const at = () => sideBezierHandles(leg(item, { ...L.a, bezierSides: { ...L.a.bezierSides, [side]: { ...previous, ...edit } } }, Lt.outer, Lt.ring), side).circle.p;
      for (let i = 0; i < 8; i++) {
        const p = at(), error = sub(wanted, p);
        if (length(error) < 1e-7) break;
        edit.pull += 0.01; const dp = mul(sub(at(), p), 100);
        edit.pull -= 0.01; edit.offset += 0.01; const dn = mul(sub(at(), p), 100);
        edit.offset -= 0.01;
        const det = dp.x * dn.y - dp.y * dn.x;
        if (Math.abs(det) < 1e-8) break;
        edit.pull += (error.x * dn.y - error.y * dn.x) / det;
        edit.offset += (dp.x * error.y - dp.y * error.x) / det;
      }
    }
    a.bezierSides = { ...L.a.bezierSides, [side]: { ...previous, ...edit } };
  }
  // Direct manipulation of the splitter's two sides, at the connected road
  // and the circle. These are geometric anchors, separate from Bézier pulls.
  function splitterCorners(item, a) {
    const Lt = layout(item), L = Lt.legs.get(a.id);
    if (!L.twoWay || L.nose == null) return null;
    const endRing = Lt.ring(-ISLAND_SETBACK), corners = {};
    for (const side of ["entry", "exit"]) {
      const off = sp => (side === "entry" ? -1 : 1) * ((side === "entry" ? L.hIn(sp) : L.hOut(sp)) - L.curbOffset(sp));
      const sp = L.meet(off, endRing);
      // An undivided stem's painted separation starts at the road mouth;
      // its raised island starts farther in. Use the painted edge there.
      const mouthOff = L.divided ? off(0) : side === "entry" ? L.entryOff(0, 0) : L.exitOff(0, 0);
      corners[side] = { mouth: L.P(mouthOff, 0), circle: L.P(off(sp), sp), sp };
    }
    return corners;
  }
  function setSplitterCorner(item, a, side, end, delta) {
    const Lt = layout(item), L = Lt.legs.get(a.id), old = L.a;
    const previous = old.bezierSides?.[side] ?? { pull: 0, offset: 0 }, edit = { ...previous };
    const corner = splitterCorners(item, old)[side];
    edit.corner ??= polar(corner.circle) - polar(L.u);
    edit.cornerAt ??= corner.sp / L.S0;
    if (end === "mouth") {
      edit.connection = {
        along: (previous.connection?.along ?? 0) + dot(delta, L.u),
        across: (previous.connection?.across ?? 0) + dot(delta, L.n),
      };
    } else {
      const wanted = add(corner.circle, delta);
      const target = Lt.ring(-ISLAND_SETBACK).nearest(wanted);
      edit.corner = polar(target) - polar(L.u);
    }
    a.bezierSides = { ...old.bezierSides, [side]: edit };
  }
  function yieldLineHandle(item, a) {
    const L = layout(item).legs.get(a.id);
    if(globalThis.StripeMaker?.traffic?.reversed) {
      if(!a.outgoing)return null;
      const sp=Math.max(0,Math.min(...Array.from({length:a.outgoing+1},(_,j)=>L.meet(s=>L.exitOff(j,s))))-(a.yieldSetback??0));
      const at=s=>L.P((L.exitOff(0,s)+L.exitOff(1,s))/2,s);
      return {p:at(sp),n:unit(sub(at(sp-.01),at(sp+.01)))};
    }
    if (!a.incoming) return null;
    if (L.yieldHandle) return L.yieldHandle;
    // Center the handle in a lane, not between lanes where a gore's resize
    // handle can cover it at ordinary zoom levels.
    const t = polar(L.entryFrame(0, L.entryCrossings(0)[0]).p);
    const p = L.yieldRing.at(t), tangent = unit(sub(L.yieldRing.at(t + 0.001), L.yieldRing.at(t - 0.001)));
    return L.yieldHandle = { p, n: { x: tangent.y, y: -tangent.x } };
  }
  function moveYieldLine(item, a, delta) {
    const old = item.approaches.find(b => b.id === a.id), h = yieldLineHandle(item, old);
    a.yieldSetback = Math.max(0, Math.round(((old.yieldSetback ?? 0) + dot(delta, h.n)) * 2) / 2);
  }
  function entryGoreHandles(item, a, k) {
    if (!entryGoreWidth(a, k)) return null;
    const L = layout(item).legs.get(a.id), start = L.goreStart(k);
    const sp = Math.max(start + 1, L.entryMeet(s => L.entryOff(k, s)) - 4);
    return { width: L.P(L.entryOff(k, sp), sp), tip: L.P(L.entryOff(k, start), start), sp, start };
  }
  function resizeEntryGore(item, a, k, end, delta) {
    const L = layout(item).legs.get(a.id), old = L.a, h = entryGoreHandles(item, old, k), key = old.inLanes[k];
    if (!h) return;
    if (end === "width") {
      const actual = L.goreOffset(h.sp, k), width = entryGoreWidth(old, k);
      const value = width - dot(delta, L.normal(h.sp, L.entryOff(k, h.sp))) * width / Math.max(0.1, actual);
      a.entryGores = { ...old.entryGores, [key]: clamp(value, 0.5, 20) };
    } else {
      const wanted = add(h.tip, delta);
      // The tip is on the inside edge (the gore has zero width there).
      // Find its station on that curved edge rather than projecting onto
      // the approach's original straight axis.
      const at = sp => L.P(L.entryOff(k, sp) + L.goreOffset(sp, k), sp);
      let best = 0, distance = Infinity;
      for (let sp = 0; sp <= L.goreEnd - 2; sp += 1) {
        const d = length(sub(at(sp), wanted));
        if (d < distance) { distance = d; best = sp; }
      }
      let lo = Math.max(0, best - 1), hi = Math.min(L.goreEnd - 2, best + 1);
      for (let i = 0; i < 30; i++) {
        const left = lo + (hi - lo) / 3, right = hi - (hi - lo) / 3;
        if (length(sub(at(left), wanted)) < length(sub(at(right), wanted))) hi = right; else lo = left;
      }
      a.entryGoreLengths = { ...old.entryGoreLengths, [key]: L.goreEnd - (lo + hi) / 2 };
    }
  }
  // The actual receiving/departing lane mouth and outward tangent, used by
  // snapping and connected roads as well as pavement and editor controls.
  function approachLane(item, a, incoming, j) {
    const L = layout(item).legs.get(a.id), off = incoming ? L.entryBounds(j, 0).reduce((p, q) => p + q, 0) / 2
      : (L.exitOff(j, 0) + L.exitOff(j + 1, 0)) / 2;
    const n = L.normal(0, off), u = { x: n.y, y: -n.x };
    return { p: L.P(off, 0), u, angle: degrees(Math.atan2(u.y, u.x) * 180 / Math.PI) };
  }
  function approachEdge(item, a, incoming, margin = 0) {
    const L = layout(item).legs.get(a.id);
    const off = incoming ? (a.incoming ? L.entryOff(a.incoming, 0) : L.exitOff(0, 0)) - margin
      : (a.outgoing ? L.exitOff(a.outgoing, 0) : L.entryOff(0, 0)) + margin;
    return L.P(off, 0);
  }
  function setApproachBezier(item, a, end, delta) {
    const L = layout(item).legs.get(a.id), { u, n } = L;
    const curve = structuredClone(L.bezier.curve), control = curve[end];
    // Geometric validation below rejects curves that fold or cross lanes.
    control.pull += dot(delta, u) * (end === "mouth" ? -1 : 1);
    control.offset += dot(delta, n);
    a.bezier = curve;
    const outward = sub(mul(u, curve.mouth.pull), mul(n, curve.mouth.offset));
    if (length(outward) > 1e-8) a.angle = degrees(Math.atan2(outward.y, outward.x) * 180 / Math.PI);
  }
  function straightenApproach(a) {
    a.angle = a.bezier?.axis ?? a.angle;
    delete a.bezier;
    delete a.bezierSides;
    setApproachBend(a, 0);
  }
  function setApproachBend(a, value) {
    Object.assign(a, add(a, mul(approachAxes(a).n, value - a.bend)), { bend: value });
  }
  function approachCurveRadius(item, a, incoming, delta) {
    const Lt = layout(item), h = approachCurveHandle(item, a, incoming), key = incoming ? "ar3" : "exitCurve";
    const offset = candidate => {
      const L = leg(item, { ...a, [key]: candidate }, Lt.outer, Lt.ring);
      return incoming ? L.hIn(h.sp) : L.hOut(h.sp);
    };
    const wanted = offset(a[key]) + dot(delta, h.n);
    let lo = 20, hi = 1200;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      if (offset(mid) > wanted) lo = mid; else hi = mid;
    }
    return Math.round((lo + hi) / 2);
  }
  // A curb fillet between an approach edge (a polyline from the mouth inward)
  // and the circle: its center sits `r` to the corner side of the edge and `r`
  // outside the circle. Returns the tangent index/point and the arc.
  function fillet(edge, side, r, ring, at) {
    if (r < 0.05) return null;
    // The fillet's center is r along the edge's own normal (it turns where
    // the edge curves), on the corner side.
    const normal = (i) => {
      const t = unit(sub(at(Math.min(edge.length - 1, i + 0.001)), at(Math.max(0, i - 0.001))));
      const nrm = { x: -t.y, y: t.x };
      return dot(nrm, side(i)) >= 0 ? nrm : mul(nrm, -1);
    };
    const centerAt = (i) => add(at(i), mul(normal(i), r));
    const g = (i) => { const c = centerAt(i); return (ring.inside(c) ? -1 : 1) * length(sub(c, ring.nearest(c))) - r; };
    // Walk from the circle outward; the first sign change is the tangent.
    let last = edge.length - 1;
    while (last > 0 && ring.inside(edge[last])) last--;
    // Start at the first point inside the shape, where the center is surely
    // less than r from its edge.
    const first = Math.min(edge.length - 1, last + 1);
    let previousGap = g(first);
    for (let i = first; i > 0; i--) {
      const g0 = previousGap, g1 = g(i - 1);
      previousGap = g1;
      if (g0 <= 0 && g1 > 0) {
        // The curb must leave the approach edge inside the approach, not past
        // its mouth.
        if (i - 1 < 1) return null;
        // Solve on the actual curved edge. Interpolating a sampled point but
        // keeping its neighbor's normal puts the fillet center off its radius;
        // forcing that arc onto the ring then makes a visible curb notch.
        const index = crossingRoot(g, i - 1, i, g1, g0), p = at(index), c = centerAt(index);
        const q = ring.nearest(c);
        // On a tightly edited curve the chosen corner-side normal can flip.
        // That discontinuity also changes g's sign, but is not a tangency.
        // Reject it before replacing the arc endpoint with a distant ring point.
        if (Math.abs(length(sub(c, q)) - r) > 0.001) continue;
        let t0 = Math.atan2(p.y - c.y, p.x - c.x), t1 = Math.atan2(q.y - c.y, q.x - c.x);
        let span = t1 - t0;
        while (span > Math.PI) span -= TAU;
        while (span < -Math.PI) span += TAU;
        const arc = Array.from({ length: 17 }, (_, k) => add(c, { x: Math.cos(t0 + (span * k) / 16) * r, y: Math.sin(t0 + (span * k) / 16) * r }));
        arc[arc.length - 1] = q;
        return { index, upto: Math.floor(index), p, q, c, arc, t: wrap(polar(q)) };
      }
    }
    return null;
  }
  // Closely spaced entry/exit edges can share a tangent curb without touching
  // the circulating circle. Forcing two circle fillets into that gap creates
  // a cusp. FDM 213.3.3 / 213.4 call for leg alignment and smooth vehicle paths
  // https://fdotwww.blob.core.windows.net/sitefinity/docs/default-source/roadway/fdm/2026/2026fdm213modroundabout.pdf
  // This is a geometric fit using the user's
  // radii, not an additional prescribed design dimension.
  function sharedFillet(exitAt, entryAt, exitSide, entrySide, exitCount, entryCount, r, ring, limits) {
    const center = (at, side, end, i) => {
      const t = unit(sub(at(Math.min(end, i + 0.001)), at(Math.max(0, i - 0.001))));
      const n = { x: -t.y, y: t.x };
      return add(at(i), mul(n, (dot(n, side(i)) >= 0 ? 1 : -1) * r));
    };
    const ca = i => center(exitAt, exitSide, exitCount - 1, i);
    const cb = i => center(entryAt, entrySide, entryCount - 1, i);
    const hit = crossing(Array.from({ length: exitCount }, (_, i) => ca(i)), Array.from({ length: entryCount }, (_, i) => cb(i)));
    if (!hit) return null;
    const fraction = (p, a, b) => dot(sub(p, a), sub(b, a)) / (dot(sub(b, a), sub(b, a)) || 1);
    let i = hit.i + fraction(hit.p, ca(hit.i), ca(hit.i + 1));
    let j = hit.j + fraction(hit.p, cb(hit.j), cb(hit.j + 1));
    // Refine both tangencies on the actual curves, not their sampled chords.
    for (let k = 0; k < 12; k++) {
      const d = sub(cb(j), ca(i)), u = mul(sub(ca(i + 0.001), ca(i - 0.001)), 500), v = mul(sub(cb(j + 0.001), cb(j - 0.001)), 500);
      const den = u.x * v.y - u.y * v.x;
      if (Math.abs(den) < 1e-9) return null;
      i += (d.x * v.y - d.y * v.x) / den;
      j += (d.x * u.y - d.y * u.x) / den;
      if (i < limits.exit || j < limits.entry || i >= exitCount - 1 || j >= entryCount - 1) return null;
      if (length(d) < 1e-6) break;
    }
    if (length(sub(ca(i), cb(j))) > 0.001) return null;
    const c = ca(i), p = exitAt(i), q = entryAt(j), t0 = polar(sub(p, c));
    let span = polar(sub(q, c)) - t0;
    while (span > Math.PI) span -= TAU;
    while (span < -Math.PI) span += TAU;
    const tangent = t => mul({ x: -Math.sin(t), y: Math.cos(t) }, Math.sign(span));
    if (dot(tangent(t0), unit(sub(exitAt(i + 0.001), p))) < 0.99
        || dot(tangent(t0 + span), unit(sub(entryAt(j - 0.001), q))) < 0.99) return null;
    const arc = Array.from({ length: 33 }, (_, k) => add(c, { x: Math.cos(t0 + span * k / 32) * r, y: Math.sin(t0 + span * k / 32) * r }));
    // The shared corner must leave all circulating lanes available.
    if (arc.some(p => length(p) < ring.radius(polar(p)) - 0.001)) return null;
    arc[0] = p; arc[32] = q;
    return { i, j, arc };
  }
  // The outer curb between leg a's exit and leg b's entry (b next by angle,
  // so b's entering traffic leaves at a: a right turn). `margin` moves it out
  // to the edge of pavement.
  function corner(Lt, a, b, margin = 0, scaleFixed = null) {
    const A = Lt.legs.get(a.id), B = Lt.legs.get(b.id);
    const ring = margin ? Lt.ring(-margin) : Lt.outer;
    const s = settings(Lt.item);
    const outA = A.outWidths.length ? A.nOut : 0;
    const exitOff = sp => (a.outgoing ? A.exitOff(outA, sp) : A.entryOff(0, sp)) + margin;
    const entryOff = sp => (b.incoming ? B.entryOff(b.incoming, sp) : B.exitOff(0, sp)) - margin;
    const exitEdge = A.line(exitOff, 0, A.S0 + 40);
    const entryEdge = B.line(entryOff, 0, B.S0 + 40);
    const exitSp = i => i * (A.S0 + 40) / (exitEdge.length - 1);
    const entrySp = i => i * (B.S0 + 40) / (entryEdge.length - 1);
    const exitAt = i => A.P(exitOff(exitSp(i)), exitSp(i));
    const entryAt = i => B.P(entryOff(entrySp(i)), entrySp(i));
    const exitSide = i => A.normal(exitSp(i), exitOff(exitSp(i))), entrySide = i => mul(B.normal(entrySp(i), entryOff(entrySp(i))), -1);
    // A fillet rounds the end of an edited bend; it must not shortcut an
    // entire reverse curve and turn its outside lane into a wide wedge.
    const lastInflection = (L, at, end) => {
      if (!L.a.bezier && !L.a.bezierSides && !L.a.bend) return 0;
      let previous = 0, last = 0;
      for (let i = 0.25; i < end; i += 0.25) {
        const p = sub(at(i), at(i - 0.01)), q = sub(at(i + 0.01), at(i));
        const cross = p.x * q.y - p.y * q.x;
        if (Math.abs(cross) < 1e-10) continue;
        const sign = Math.sign(cross);
        if (previous && sign !== previous) last = i;
        previous = sign;
      }
      return last;
    };
    // A one-way leg has no opposing carriageway to make room for. Round its
    // last carriageway-width of run rather than applying a two-way opening
    // across the whole stem. This is an editing envelope, not a design radius.
    const oneWayRun = L => [...L.inWidths, ...L.outWidths].reduce((sum, w) => sum + w, 0);
    const exitBend = Math.max(Lt.memo("exitInflection", [A.exitKey], () => lastInflection(A, exitAt, A.exitRight.sp * (exitEdge.length - 1) / (A.S0 + 40))),
      A.twoWay ? 0 : Math.max(0, (a.outgoing ? A.exitRight.sp : A.entryLeft.sp) - oneWayRun(A)) * (exitEdge.length - 1) / (A.S0 + 40));
    const entryBend = Math.max(Lt.memo("entryInflection", [B.entryKey], () => lastInflection(B, entryAt, B.entryRight.sp * (entryEdge.length - 1) / (B.S0 + 40))),
      B.twoWay ? 0 : Math.max(0, (b.incoming ? B.entryRight.sp : B.exitLeft.sp) - oneWayRun(B)) * (entryEdge.length - 1) / (B.S0 + 40));
    // Both fillets and the circle between them stay within the gap between legs.
    const start = a.outgoing ? A.exitRight.t : A.entryLeft.t;
    const finish = b.incoming ? B.entryRight.t : B.exitLeft.t;
    const gap = wrap(finish - start) || TAU;
    // The splitter's nose extends beyond the exit curve (Exhibit 213-2): the
    // exit curb leaves the exit edge circle-side of the nose.
    const pastNose = (f) => !A.twoWay || A.nose == null || f.index * (A.S0 + 40) / (exitEdge.length - 1) >= A.nose;
    const fits = (fa, fb) => fa && fb && pastNose(fa) && fa.index >= exitBend && fb.index >= entryBend
      && wrap(fa.t - start) < gap && wrap(fb.t - start) < gap && wrap(fb.t - fa.t) < gap && wrap(fb.t - fa.t) > 1e-4;
    // The entry curb keeps its radius; the exit curb is the flattest that fits
    // (up to its setting). If even the entry won't fit, both shrink and
    // checks() reports the entry shortfall.
    let radii = scaleFixed ?? { exit: s.exitRadius, entry: s.entryRadius }, fa = null, fb = null;
    const fitExit = radius => Lt.memo("exitFillet", [A.exitKey, margin, radius], () => fillet(exitEdge, exitSide, radius, ring, exitAt));
    const fitEntry = radius => Lt.memo("entryFillet", [B.entryKey, margin, radius], () => fillet(entryEdge, entrySide, radius, ring, entryAt));
    if (scaleFixed == null) {
      const retainBend = (r, fit, bend) => {
        if (!bend) return r;
        const fitsBend = value => { const f = fit(value); return f && f.index >= bend; };
        if (fitsBend(r)) return r;
        let lo = 0.05, hi = r;
        for (let i = 0; i < 25; i++) { const mid = (lo + hi) / 2; if (fitsBend(mid)) lo = mid; else hi = mid; }
        return lo;
      };
      radii = { exit: retainBend(radii.exit, fitExit, exitBend),
        entry: retainBend(radii.entry, fitEntry, entryBend) };
    }
    const tryRadii = (r) => {
      fa = fitExit(Math.max(0.05, r.exit - margin));
      fb = fitEntry(Math.max(0.05, r.entry - margin));
      return fits(fa, fb);
    };
    if (scaleFixed == null && !tryRadii(radii)) {
      // Preserve bends in the carriageway itself. A gore's widening taper can
      // add an outer-edge inflection right at the circle; that isn't a user
      // bend and must not force this shared corner down to a sharp point.
      const exitLimit = Math.max(1, (A.nose ?? 0) * (exitEdge.length - 1) / (A.S0 + 40),
        lastInflection(A, i => A.reference(!a.outgoing, exitSp(i)), A.exitRight.sp * (exitEdge.length - 1) / (A.S0 + 40)));
      const entryLimit = Math.max(1, lastInflection(B, i => B.reference(Boolean(b.incoming), entrySp(i)), B.entryRight.sp * (entryEdge.length - 1) / (B.S0 + 40)));
      for (let r = Math.min(s.exitRadius, s.entryRadius); r >= 2; r *= 0.8) {
        const fit = sharedFillet(exitAt, entryAt, exitSide, entrySide, exitEdge.length, entryEdge.length, r, ring, { exit: exitLimit, entry: entryLimit });
        if (!fit) continue;
        const exitBoundary = [...exitEdge.slice(0, Math.floor(fit.i) + 1), ...fit.arc.slice(0, 17)];
        const entryBoundary = [...entryEdge.slice(0, Math.floor(fit.j) + 1), ...fit.arc.slice(16).reverse()];
        const q = fit.arc[16], t = wrap(polar(q));
        return { points: [...exitBoundary, ...entryBoundary.slice(0, -1).reverse()],
          scale: null, radii: { exit: r, entry: r }, ok: true, tight: true, shared: true,
          exitQ: q, entryQ: q, exitT: t, entryT: t, exitBoundary, entryBoundary,
          exitSp: exitSp(fit.i), entrySp: entrySp(fit.j) };
      }
      let done = false;
      // Largest exit radius that fits beside the entry radius: step down, then
      // bisect between the last miss and the first fit.
      for (let r = radii.exit * 0.85, miss = radii.exit; r >= 2 && !done; miss = r, r *= 0.85)
        if (tryRadii({ exit: r, entry: radii.entry })) {
          let lo = r, hi = miss;
          for (let k = 0; k < 25; k++) { const m = (lo + hi) / 2; if (tryRadii({ exit: m, entry: radii.entry })) lo = m; else hi = m; }
          radii = { exit: lo, entry: radii.entry };
          tryRadii(radii);
          done = true;
        }
      for (let k = 0.9; !done && k > 0.02; k *= 0.85) {
        const r = { exit: Math.min(radii.exit, radii.entry) * k, entry: radii.entry * k };
        if (tryRadii(r)) { radii = r; done = true; }
      }
      if (!done) fa = fb = null;
    } else if (scaleFixed != null) tryRadii(radii);
    const points = [];
    if (fits(fa, fb)) {
      points.push(...exitEdge.slice(0, fa.upto + 1), ...fa.arc, ...ring.arc(fa.t, fb.t, false).slice(1, -1), ...[...fb.arc].reverse(), ...entryEdge.slice(0, fb.upto + 1).reverse());
      return { points, scale: radii, radii, ok: true, exitQ: fa.q, entryQ: fb.q, exitT: fa.t, entryT: fb.t,
        exitBoundary: [...exitEdge.slice(0, fa.upto + 1), ...fa.arc], entryBoundary: [...entryEdge.slice(0, fb.upto + 1), ...fb.arc],
        exitSp: exitSp(fa.index), entrySp: entrySp(fb.index) };
    }
    // No room for curb fillets: the edges meet directly (or the legs overlap).
    const cut = crossing(exitEdge, entryEdge);
    if (cut && !ring.inside(cut.p)) {
      points.push(...exitEdge.slice(0, cut.i + 1), cut.p, ...entryEdge.slice(0, cut.j + 1).reverse());
      const t = wrap(polar(cut.p));
      return { points, scale: null, radii: { exit: 0, entry: 0 }, ok: true, tight: true, exitQ: cut.p, entryQ: cut.p, exitT: t, entryT: t,
        exitBoundary: [...exitEdge.slice(0, cut.i + 1), cut.p], entryBoundary: [...entryEdge.slice(0, cut.j + 1), cut.p] };
    }
    // No fitted fillet is available. Join the actual lane edges to the ring,
    // rather than extending both past it and drawing a chord through the
    // roundabout. This also leaves usable curb/yield endpoints while editing.
    const sx = A.meet(exitOff, ring), se = B.meet(entryOff, ring);
    const exitBoundary = A.line(exitOff, 0, sx), entryBoundary = B.line(entryOff, 0, se);
    const exitQ = exitBoundary.at(-1), entryQ = entryBoundary.at(-1), exitT = wrap(polar(exitQ)), entryT = wrap(polar(entryQ));
    const span = wrap(entryT - exitT), physicalGap = wrap(polar(b) - polar(a)) || TAU;
    const arc = ring.arc(exitT, entryT, span > physicalGap + Math.PI / 2);
    points.push(...exitBoundary, ...arc.slice(1, -1), ...[...entryBoundary].reverse());
    return { points, scale: null, radii: { exit: 0, entry: 0 }, ok: false, exitQ, entryQ, exitT, entryT,
      exitBoundary, entryBoundary, ringArc: arc, exitSp: sx, entrySp: se };
  }
  function crossing(p, q) {
    for (let i = 1; i < p.length; i++)
      for (let j = 1; j < q.length; j++) {
        const a = p[i - 1], b = p[i], c = q[j - 1], d = q[j];
        if (Math.max(a.x, b.x) < Math.min(c.x, d.x) || Math.max(c.x, d.x) < Math.min(a.x, b.x)
          || Math.max(a.y, b.y) < Math.min(c.y, d.y) || Math.max(c.y, d.y) < Math.min(a.y, b.y)) continue;
        const r = sub(b, a), s = sub(d, c), den = r.x * s.y - r.y * s.x;
        if (Math.abs(den) < 1e-9) continue;
        const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / den, u = ((c.x - a.x) * r.y - (c.y - a.y) * r.x) / den;
        if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return { i: i - 1, j: j - 1, p: add(a, mul(r, t)) };
      }
    return null;
  }

  // ---- Outline, islands -------------------------------------------------------
  // The roundabout's pavement ends at its curb faces, the curb offset outside
  // the lane edge lines (213.3.6: 15' face to face around a 12' lane).
  const pave = (margin) => (margin > 0 ? CURB.E : 0);
  // A corner curb moved out by `margin`: each point along its normal, on the
  // side away from the circle (the corner runs up in angle round the center).
  function offsetCorner(points, margin) {
    if (!margin) return points;
    return points.map((p, i) => {
      const t = unit(sub(points[Math.min(points.length - 1, i + 1)], points[Math.max(0, i - 1)]));
      return add(p, mul({ x: t.y, y: -t.x }, margin));
    });
  }
  // Retain a boundary through its first crossing into a closed ring.
  function cutAtRing(points, ring) {
    const hit = points.findIndex(p => ring.inside(p));
    if (hit < 0) return points;
    if (!hit) return points.slice(0, 1);
    const p = points[hit - 1], d = sub(points[hit], p);
    let lo = 0, hi = 1;
    for (let i = 0; i < 35; i++) {
      const t = (lo + hi) / 2;
      if (ring.inside(add(p, mul(d, t)))) hi = t; else lo = t;
    }
    return [...points.slice(0, hit), add(p, mul(d, (lo + hi) / 2))];
  }
  function outline(item, margin = 0) {
    margin = pave(margin);
    const Lt = layout(item), ordered = G.ordered(item), points = [];
    for (const [i, a] of ordered.entries()) {
      const b = ordered[(i + 1) % ordered.length];
      points.push(approachEdge(item, a, true, margin), ...offsetCorner(Lt.corners.get(a.id).points, margin));
    }
    return points.length > 2 ? points : Lt.ring(-margin).arc(0, 0, false, true);
  }
  // Round polygon corner v (between neighbors p and q) with radius r.
  function roundCorner(p, v, q, r) {
    const a = unit(sub(p, v)), b = unit(sub(q, v)), cosA = clamp(dot(a, b), -1, 1), A = Math.acos(cosA);
    if (A < 1e-3 || Math.PI - A < 1e-3) return [v];
    const d = Math.min(r / Math.tan(A / 2), length(sub(p, v)) * 0.9, length(sub(q, v)) * 0.9), rr = d * Math.tan(A / 2);
    const s0 = add(v, mul(a, d)), s1 = add(v, mul(b, d)), c = add(v, mul(unit(add(a, b)), rr / Math.sin(A / 2)));
    let t0 = polar(sub(s0, c)), t1 = polar(sub(s1, c)), span = t1 - t0;
    while (span > Math.PI) span -= TAU;
    while (span < -Math.PI) span += TAU;
    return Array.from({ length: 9 }, (_, k) => add(c, { x: Math.cos(t0 + (span * k) / 8) * rr, y: Math.sin(t0 + (span * k) / 8) * rr }));
  }
  // The curbed splitter island (Exhibit 213-1, Exhibit 213-2 Details A and B):
  // its curb face the curb offset inside each lane edge line (3' at the nose,
  // easing on R 200'), a R 3' nose, and an end 3' from the circle's lane edge
  // line with R 3' (exit side) and R 2' (entry side) corners.
  function splitter(Lt, a) {
    const L = Lt.legs.get(a.id), exit = splitterExitBoundary(Lt, a);
    return Lt.memo("splitter", [identity(L), exit && identity(exit)], () => buildSplitter(Lt, L, exit));
  }
  function buildSplitter(Lt, L, exitBoundary) {
    if (L.nose == null) return null;
    const endRing = Lt.ring(-ISLAND_SETBACK);
    const entrySide = (sp) => -(L.hIn(sp) - L.curbOffset(sp)), exitSide = (sp) => L.hOut(sp) - L.curbOffset(sp);
    const begin = L.divided ? 0 : L.nose + NOSE_RADIUS;
    const se = L.meet(entrySide, endRing);
    if (se <= begin + 1) return null;
    const entry = L.line(entrySide, begin, se);
    let exit;
    if (exitBoundary && exitBoundary.sp > begin) {
      // The departing divider replaces the exit-side painted edge. Its
      // physical curb must use that same boundary, including the wider nose,
      // rather than leaving an asphalt wedge inside the splitter outline.
      // Keep the existing curb offset (Exhibit 213-2) perpendicular to it.
      const stem = L.line(sp => L.exitOff(0, sp), begin, exitBoundary.sp);
      const edge = [...stem, ...exitBoundary.solid.slice(0, -1).reverse()];
      const inset = edge.map((p, i) => {
        const t = unit(sub(edge[Math.min(i + 1, edge.length - 1)], edge[Math.max(0, i - 1)]));
        const sp = i < stem.length ? begin + (exitBoundary.sp - begin) * i / (stem.length - 1) : exitBoundary.sp;
        return add(p, mul({ x: -t.y, y: t.x }, L.curbOffset(sp)));
      });
      const trimmed = cutAtRing(inset, endRing);
      if (trimmed.length > 1) exit = trimmed;
    }
    if (!exit) {
      const sx = L.meet(exitSide, endRing);
      if (sx <= begin + 1) return null;
      exit = L.line(exitSide, begin, sx);
    }
    const end = endRing.arc(polar(exit.at(-1)), polar(entry.at(-1)), true);
    if (end.length < 3) return null;
    // Corners: the exit side's R 3' and the entry side's R 2'.
    const exitCorner = roundCorner(exit.at(-2), exit.at(-1), end[1], END_RADIUS.exit);
    const entryCorner = roundCorner(end.at(-2), entry.at(-1), entry.at(-2), END_RADIUS.entry);
    const points = [...exit.slice(0, -1), ...exitCorner, ...end.slice(1, -1), ...entryCorner, ...entry.slice(0, -1).reverse()];
    if (!L.divided) {
      // The R 3' nose, centered between the two curb lines.
      const c = mul(add(entry[0], exit[0]), 0.5), r = length(sub(exit[0], entry[0])) / 2;
      const t0 = polar(sub(entry[0], c));
      let span = Math.PI;
      if (dot(sub(add(c, { x: Math.cos(t0 + span / 2), y: Math.sin(t0 + span / 2) }), c), L.u) < 0) span = -Math.PI;
      for (let k = 1; k < 16; k++) {
        const t = t0 + (span * k) / 16;
        points.push(add(c, { x: Math.cos(t) * r, y: Math.sin(t) * r }));
      }
    }
    return points;
  }
  // Where each splitter side's yellow lane edge line ends: at the island's
  // end corner, past which the painted nose is outlined in white.
  function islandEnds(Lt, a) {
    const L = Lt.legs.get(a.id), endRing = Lt.ring(-ISLAND_SETBACK);
    if (L.islandEnds) return L.islandEnds;
    const stop = (off, r) => {
      let lo = 0, hi = L.S0 + 40;
      for (let i = 0; i < 50; i++) { const m = (lo + hi) / 2; if (endRing.inside(L.P(off(m), m))) hi = m; else lo = m; }
      return lo - r;
    };
    return L.islandEnds = {
      entry: stop((sp) => -(L.hIn(sp) - L.curbOffset(sp)), END_RADIUS.entry),
      exit: stop((sp) => L.hOut(sp) - L.curbOffset(sp), END_RADIUS.exit),
    };
  }
  // A departing circulating divider can meet the splitter-side exit edge
  // downstream of the island nose. That part is the painted island boundary,
  // not another dotted line beside it. Split the same fitted curve where it
  // leaves the circulatory roadway, and extend the nose outline to that point.
  // FDM 213 (2026), Exhibits 213-3/5: 6-inch solid white island outline and
  // 6-inch white 2'-4' guides through the circulatory conflict area.
  // https://fdotwww.blob.core.windows.net/sitefinity/docs/default-source/roadway/fdm/2026/2026fdm213modroundabout.pdf
  function splitterExitBoundary(Lt, a) {
    if (!Lt.legs.get(a.id).twoWay) return null;
    const guide = circulatoryDividers(Lt).find(g => g.exit === a.id && g.exitBoundary === 0);
    if (!guide) return null;
    if (guide.splitterEdge !== undefined) return guide.splitterEdge;
    const points = guide.points, outside = p => length(p) - Lt.outer.radius(polar(p));
    guide.splitterEdge = null;
    // Work back from the receiving edge: the final outside portion belongs
    // to this splitter even when an edited guide crosses the ring earlier.
    if (outside(points.at(-1)) <= 0) return null;
    for (let i = points.length - 2; i >= 0; i--) {
      if (outside(points[i]) > 0) continue;
      const p = points[i], delta = sub(points[i + 1], p);
      let lo = 0, hi = 1;
      for (let j = 0; j < 35; j++) {
        const mid = (lo + hi) / 2;
        if (outside(add(p, mul(delta, mid))) > 0) hi = mid; else lo = mid;
      }
      const join = add(p, mul(delta, (lo + hi) / 2));
      return guide.splitterEdge = {
        sp: guide.exitSp, t: wrap(polar(join)),
        dotted: [...points.slice(0, i + 1), join],
        solid: [join, ...points.slice(i + 1)],
      };
    }
    return null;
  }
  function entryGore(L, k) {
    const start = L.goreStart(k), left = sp => L.entryOff(k, sp) + L.goreOffset(sp, k), right = sp => L.entryOff(k, sp);
    const middle = sp => L.P((left(sp) + right(sp)) / 2, sp), stop = L.entryMeet(sp => (left(sp) + right(sp)) / 2);
    const leftLine = L.line(left, start, L.entryMeet(left)), rightLine = L.line(right, start, L.entryMeet(right));
    const cap = L.yieldRing.arc(polar(leftLine.at(-1)), polar(rightLine.at(-1)), true);
    return { start, stop, left, right, middle, leftLine, rightLine, cap, clip: [...leftLine, ...cap.slice(1, -1), ...[...rightLine].reverse()] };
  }
  function goreChevrons(gore) {
    const lines = [], { start, stop, middle } = gore;
    // FDOT 711-001 (FY 2026-27), sheet 8, Traffic Channelization at Gore:
    // 18-inch chevrons, 45 degrees, 20 feet apart. Measure along the curved
    // gore centerline and orient each V in its local tangent/normal frame.
    // https://fdotwww.blob.core.windows.net/sitefinity/docs/default-source/design/standardplans/2027/idx/711-001.pdf
    const steps = Math.max(1, Math.ceil((stop - start) / 0.25));
    let previous = middle(start), distance = 0, next = GORE.spacing;
    for (let i = 1; i <= steps; i++) {
      const sp = start + (stop - start) * i / steps, point = middle(sp), run = length(sub(point, previous));
      while (next < distance + run && run > 1e-9) {
        const at = sp - (stop - start) / steps * (1 - (next - distance) / run);
        const p = middle(at), t = mul(unit(sub(middle(at + 0.01), middle(at - 0.01))),globalThis.StripeMaker?.traffic?.reversed?-1:1), n = { x: -t.y, y: t.x };
        const reach = Math.abs(gore.left(at) - gore.right(at)) + GORE.chevron;
        lines.push({ points: [add(p, mul(add(t, n), reach)), p, add(p, mul(sub(t, n), reach))], color: WHITE, width: GORE.chevron, dash: null });
        next += GORE.spacing;
      }
      distance += run; previous = point;
    }
    return lines;
  }
  function goreIsland(L, k) {
    if (entryGoreType(L.a, k) !== "curbed") return null;
    const gore = entryGore(L, k), offset = CURB[L.a.curb] ?? CURB.E;
    // Reuse the selected curb clearance and the 3-foot circulatory setback
    // from FDM 213 (2026), Exhibit 213-1. This optional channelizing island
    // is fitted inside the existing separation; it is not the painted
    // stay-in-lane truck treatment specified by 213.7.2.2.
    // https://www.fdot.gov/roadway/fdm/2026-FDM
    const endRing = L.goreEndRing ??= offsetRing(L.yieldRing, ISLAND_SETBACK);
    const inset = (off, side, sp) => {
      const p = L.P(off(sp), sp), t = unit(sub(L.P(off(sp + 0.01), sp + 0.01), L.P(off(sp - 0.01), sp - 0.01)));
      return add(p, mul({ x: -t.y, y: t.x }, side * offset));
    };
    const edge = (off, side) => {
      let lo = gore.start, hi = L.entryMeet(off);
      if (endRing.inside(inset(off, side, lo))) return [];
      for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2;
        if (endRing.inside(inset(off, side, mid))) hi = mid; else lo = mid;
      }
      const steps = Math.max(1, Math.ceil((lo - gore.start) / 0.5));
      return Array.from({ length: steps + 1 }, (_, i) => inset(off, side, gore.start + (lo - gore.start) * i / steps));
    };
    // Offset the two lane boundaries toward each other.
    let left = edge(gore.left, 1), right = edge(gore.right, -1);
    const tip = crossing(left, right);
    if (!tip) return null;
    left = [tip.p, ...left.slice(tip.i + 1)]; right = [tip.p, ...right.slice(tip.j + 1)];
    const run = points => points.reduce((sum, p, i) => sum + (i ? length(sub(p, points[i - 1])) : 0), 0);
    if (Math.min(run(left), run(right)) < 1 || length(sub(left.at(-1), right.at(-1))) < 0.5) return null;
    // Fit a rounded tip into the available island. Its rounding is editing
    // geometry, not a claimed minimum nose radius for a splitter island.
    const trim = Math.min(NOSE_RADIUS, run(left) / 3, run(right) / 3);
    const shorten = points => {
      let d = 0;
      for (let i = 1; i < points.length; i++) {
        const step = length(sub(points[i], points[i - 1]));
        if (d + step >= trim) return [add(points[i - 1], mul(sub(points[i], points[i - 1]), (trim - d) / step)), ...points.slice(i)];
        d += step;
      }
      return points;
    };
    left = shorten(left); right = shorten(right);
    const nose = Array.from({ length: 13 }, (_, i) => {
      const t = i / 12;
      return add(add(mul(right[0], (1 - t) ** 2), mul(tip.p, 2 * t * (1 - t))), mul(left[0], t ** 2));
    });
    const cap = endRing.arc(polar(left.at(-1)), polar(right.at(-1)), true);
    return [...left, ...cap.slice(1, -1), ...[...right].reverse(), ...nose.slice(1, -1)];
  }
  // Painted areas, curbs and islands, from the bottom up.
  function surfaces(item, margin = 0) {
    const Lt = layout(item), s = settings(item), list = [];
    const plan = Lt.spiralPlan;
    const apron = plan ? plan.apron : Lt.inner.arc(0, 0, false, true).slice(0, -1);
    const island = plan ? plan.island : Lt.width ? Array.from({ length: SAMPLES }, (_, n) => { const t = (TAU * n) / SAMPLES, r = Math.max(1, Lt.islandEdge - s.apron); return { x: Math.cos(t) * r, y: Math.sin(t) * r }; }) : Lt.ring(Lt.total + s.apron).arc(0, 0, false, true).slice(0, -1);
    list.push({ kind: "apron", points: apron, fill: s.mini ? "concrete" : APRON.color, curb: true, mountable: s.mini });
    if (!s.mini) list.push({ kind: "island", points: island, fill: "grass", curb: true });
    for (const a of item.approaches) {
      const points = splitter(Lt, a);
      // A divided approach's island is open at the mouth, where the road's median continues.
      if (points) list.push({ kind: "splitter", approach: a.id, points, fill: s.mini ? "concrete" : "grass", curb: true, mountable: s.mini, open: Lt.legs.get(a.id).nose === 0 });
      for (let k = 1; k < a.incoming; k++) {
        const island = goreIsland(Lt.legs.get(a.id), k);
        if (island) list.push({ kind: "gore", approach: a.id, key: a.inLanes[k], points: island, fill: "concrete", curb: true });
      }
    }
    return list;
  }
  // The curb from leg a's exit round to the next leg's entry, at `margin`
  // outside the edge of traveled way (sheet order, as in outline()).
  function cornerPoints(item, a, margin = 0) {
    margin = pave(margin);
    const Lt = layout(item), ordered = G.ordered(item), b = ordered[(ordered.indexOf(a) + 1) % ordered.length];
    void b;
    return offsetCorner(Lt.corners.get(a.id).points, margin);
  }
  const holes = (item) => surfaces(item).filter((x) => x.kind !== "island").map((x) => x.points);

  // ---- Markings ----------------------------------------------------------------
  // Every line is { points, color, width, dash: [on, off] | null, phase }; clip
  // regions hold their own lines; symbols are 711-001 catalog parts placed by
  // a frame (point, direction of travel).
  function markings(item, catalog = globalThis.StripeMaker?.markingCatalog) {
    const Lt = layout(item), out = { lines: [], clips: [], symbols: [] };
    const lineOf = (points, color = WHITE, width = LINE, dash = null, phase = 0) => {
      if (points.length > 1) out.lines.push({ points, color, width, dash, phase });
    };
    const ordered = G.ordered(item);
    // Outer curb lines: white on the right of traffic all the way round each
    // corner (Exhibits 213-3 to 213-5, "6" White (Typ.)").
    for (const [i, a] of ordered.entries()) {
      const b = ordered[(i + 1) % ordered.length];
      const c = Lt.corners.get(a.id);
      const exitColor = a.outgoing ? WHITE : YELLOW, entryColor = b.incoming ? WHITE : YELLOW;
      if (exitColor === entryColor || !c.exitBoundary || !c.entryBoundary) lineOf(c.points, exitColor);
      else {
        const arc = c.tight ? [c.exitQ] : c.ringArc ?? Lt.outer.arc(c.exitT, c.entryT, false), middle = Math.floor(arc.length / 2);
        lineOf([...c.exitBoundary, ...arc.slice(1, middle + 1)], exitColor);
        lineOf([...arc.slice(middle, -1), ...[...c.entryBoundary].reverse()], entryColor);
      }
    }
    const guides = circulatoryDividers(Lt);
    for (const a of item.approaches) {
      const paint = Lt.memo("legPaint", [identity(Lt.legs.get(a.id)), catalog && identity(catalog),
        Boolean(globalThis.StripeMaker?.traffic?.reversed), guides.filter(g => g.exit === a.id).map(identity),
        a.inLanes.map(id => destinations(item, a, id).map(id => turnOf(item, a, item.approaches.find(b => b.id === id))))], () => {
        const paint = { lines: [], clips: [], symbols: [] };
        legMarkings(Lt, a, paint, (points, color = WHITE, width = LINE, dash = null, phase = 0) => {
          if (points.length > 1) paint.lines.push({ points, color, width, dash, phase });
        }, catalog);
        return paint;
      });
      for (const key of ["lines", "clips", "symbols"]) out[key].push(...paint[key]);
    }
    circulatoryMarkings(Lt, out, lineOf, catalog);
    return out;
  }
  function legMarkings(Lt, a, out, lineOf, catalog) {
    const item = Lt.item, L = Lt.legs.get(a.id);
    // Splitter edges: 6" yellow lane edge lines along both sides (Exhibits
    // 213-3 to 213-5, "6" Yellow (Typ.)") to the island's end corners; past
    // them the painted nose is outlined by the white lane edge line, which
    // runs along the circle between the two sides (Exhibit 213-1, "Lane Edge
    // Line"; Exhibit 213-2 Detail B).
    if (L.twoWay) {
      const ends = islandEnds(Lt, a), exit = splitterExitBoundary(Lt, a);
      const yIn = clamp(ends.entry, 0, L.entryLeft.sp), yOut = clamp(ends.exit, 0, exit?.sp ?? L.exitLeft.sp);
      lineOf(L.line((sp) => L.entryOff(0, sp), 0, yIn), YELLOW);
      lineOf(L.line((sp) => L.exitOff(0, sp), 0, yOut), YELLOW);
      const ein = L.line((sp) => L.entryOff(0, sp), yIn, L.entryLeft.sp);
      const exitStop = exit?.sp ?? L.exitLeft.sp;
      const eout = exitStop > yOut + 1e-6 ? L.line((sp) => L.exitOff(0, sp), yOut, exitStop) : [L.P(L.exitOff(0, exitStop), exitStop)];
      if (exit) eout.push(...[...exit.solid].reverse().slice(1));
      lineOf([...ein, ...Lt.outer.arc(L.entryLeft.t, exit?.t ?? L.exitLeft.t, false).slice(1, -1), ...eout.reverse()]);
      // Traffic separation where the separation opens (711-001 sheet 8,
      // "Markings for Traffic Separation", referenced by Exhibits 213-1 to
      // 213-5): 18" yellow diagonals at 45 degrees between the yellow lines,
      // spaced by speed. Moving away from the tip each runs from the arriving
      // side toward the departing side: exiting traffic arrives at the tip,
      // entering traffic departs from it, as in the road editor's gores.
      // It is edged in 6" double yellow on both sides: each yellow edge line
      // plus a second line 10" inside it (center to center: a 4" gap, 711-001
      // "Double Solid Lines"), the two inner lines meeting at the tip; the
      // diagonals lie between the inner lines.
      if (L.shift > 0 && L.nose > L.start + 1) {
        const step = DOUBLE_SPACING;
        const innerIn = (sp) => L.entryOff(0, sp) + step, innerOut = (sp) => L.exitOff(0, sp) - step;
        let tip = L.start;
        while (tip < L.nose && innerOut(tip) - innerIn(tip) < 0) tip += 0.25;
        if (tip < L.nose - 1) {
          const left = L.line(innerIn, tip, L.nose), right = L.line(innerOut, tip, L.nose);
          lineOf(left, YELLOW);
          lineOf(right, YELLOW);
          const lines = [], spacing = separationSpacing(a.speed), d = L.hm + L.shift + 2;
          for (let c = tip + spacing; c < L.nose + d; c += spacing)
            lines.push({ points: [L.P(d, c - d), L.P(-d, c + d)], color: YELLOW, width: SEPARATION.stripe, dash: null });
          out.clips.push({ clip: [...left, ...[...right].reverse()], lines });
        }
      }
    }
    // Lane lines are solid along the splitter island (Exhibits 213-3, 213-5 "6"
    // White") and 10'-30' skip upstream.
    const solidFrom = Math.max(0, L.nose ?? 0);
    // Lane lines between entry lanes: 6" white solid along the splitter, 10'-30'
    // skip upstream (Exhibits 213-3, 213-5). A stay-in-lane gore (213.7.2.2)
    // splits a boundary into two 8" white lines with chevrons between them.
    for (let k = 1; k < L.nIn; k++) {
      const stop = L.circleMeet((sp) => L.entryOff(k, sp));
      const entryWidth = L.inWidths.slice(0, L.nIn).reduce((x, y) => x + y, 0) + a.inLanes.slice(1).reduce((sum, _, j) => sum + entryGoreWidth(a, j + 1), 0);
      if (L.gore(stop, k) > 0.5) {
        const gore = entryGore(L, k), gStart = gore.start, r = gore.right;
        // The lane boundary k sits outside its gore: left line inside, right outside.
        const { leftLine, rightLine } = gore;
        lineOf(L.line(r, 0, Math.min(solidFrom, gStart)), WHITE, LINE, [SKIP.on, SKIP.off]);
        if (gStart > solidFrom) lineOf(L.line(r, solidFrom, gStart));
        out.lines.push({ points: leftLine, color: WHITE, width: GORE.line, dash: null });
        out.lines.push({ points: rightLine, color: WHITE, width: GORE.line, dash: null });
        // Close the roundabout-facing side with the same 8-inch solid white
        // outline as the gore edges (711-001, sheet 8), across the gap between
        // the two lanes' dotted yield extensions.
        if (entryGoreType(a, k) === "painted") lineOf(gore.cap, WHITE, GORE.line);
        if (entryGoreType(a, k) === "painted" && entryWidth >= GORE_ENTRY_WIDTH) {
          const lines = goreChevrons(gore);
          if (lines.length) out.clips.push({ clip: gore.clip, lines });
        }
      } else {
        lineOf(L.line((sp) => L.entryOff(k, sp), 0, solidFrom), WHITE, LINE, [SKIP.on, SKIP.off]);
        lineOf(L.line((sp) => L.entryOff(k, sp), solidFrom, stop));
      }
    }
    for (let k = 1; k < a.outgoing; k++) {
      const stop = circulatoryDividers(Lt).find(g => g.exit === a.id && g.exitBoundary === k)?.exitSp ?? L.meet((sp) => L.exitOff(k, sp));
      lineOf(L.line((sp) => L.exitOff(k, sp), 0, Math.min(solidFrom, stop)), WHITE, LINE, [SKIP.on, SKIP.off]);
      if (stop > solidFrom) lineOf(L.line((sp) => L.exitOff(k, sp), solidFrom, stop));
    }
    if(globalThis.StripeMaker?.traffic?.reversed) {
      // Keep the pavement and lane graph fixed; the old exit is now the entry.
      // Rebuild entry controls in that carriageway instead of leaving YIELD
      // facing departing traffic. Width/dash constants are shared above.
      if(!a.outgoing)return;
      const center=(j,sp)=>(L.exitOff(j,sp)+L.exitOff(j+1,sp))/2;
      const frame=(j,sp)=>{
        const at=s=>L.P(center(j,s),s),p=at(sp),t=unit(sub(at(sp+.01),at(sp-.01)));
        return {p,t};
      };
      const stop=Math.max(0,Math.min(...Array.from({length:a.outgoing+1},(_,j)=>L.meet(sp=>L.exitOff(j,sp))))-(a.yieldSetback??0));
      lineOf(Array.from({length:25},(_,i)=>L.P(L.exitOff(0,stop)+(L.exitOff(a.outgoing,stop)-L.exitOff(0,stop))*i/24,stop)),WHITE,EXTENSION.width,[EXTENSION.on,EXTENSION.off]);
      if(!catalog)return;
      for(let j=0;j<a.outgoing;j++) {
        const lanes=[{left:-L.outWidths[j]/2,right:L.outWidths[j]/2}],word=catalog.build({type:'word',text:'YIELD'},lanes);
        const at=sp=>frame(j,sp),wordBack=stationAlong(sp=>at(sp).p,stop,-YIELD_CLEAR-word.length);
        place(out,word,at,wordBack,word.length);
        const sources=item.approaches.filter(b=>b.inLanes.some(input=>destinations(item,b,input).includes(a.id)));
        const arrow=arrowFor(sources.map(b=>turnOf(item,a,b)),false);
        if(a.outgoing>1&&arrow) {
          const built=catalog.build(arrow,lanes);
          for(let k=0;k<2;k++)place(out,built,at,wordBack-ARROW_BACK-k*ARROW_SPACING-built.length,built.length);
        }
      }
      return;
    }
    if (!L.nIn) return;
    // 12" white 2'-2' dotted extension across the entry along the circle, from
    // the painted nose to the curb (Exhibits 213-3 to 213-5).
    const t1 = L.yieldStart;
    if (a.inLanes.slice(1).some((_, j) => entryGoreWidth(a, j + 1) > 0)) {
      for (let j = 0; j < L.nIn; j++) {
        const angles = [0, 1].map(side => {
          const off = sp => L.entryBounds(j, sp)[side], sp = L.entryCrossings(j)[side + 1];
          return wrap(polar(L.P(off(sp), sp)));
        });
        out.lines.push({ points: L.yieldRing.arc(j === L.nIn - 1 ? t1 : angles[1], j === 0 ? L.yieldEnd : angles[0], false), color: WHITE, width: EXTENSION.width, dash: [EXTENSION.on, EXTENSION.off], phase: 0 });
      }
    } else out.lines.push({ points: L.yieldRing.arc(t1, L.yieldEnd, false), color: WHITE, width: EXTENSION.width, dash: [EXTENSION.on, EXTENSION.off], phase: 0 });
    if (!catalog) return;
    // YIELD in each circulating entry lane, and lane-use arrows on multi-lane
    // entries (FDM 213.10: left-turn arrow with the circular dot in the left
    // lane, standard arrows elsewhere).
    for (let j = 0; j < a.incoming; j++) {
      const lane = [{ left: -L.inWidths[j] / 2, right: L.inWidths[j] / 2 }];
      const frameAt = sp => L.entryFrame(j, sp);
      const word = catalog.build({ type: "word", text: "YIELD" }, lane);
      const halfWord = Math.max(0, ...word.parts.flatMap(part => part.rings.flatMap(ring => ring.map(([x]) => Math.abs(x)))));
      const wordBack = yieldBack(L, j, word.length, halfWord);
      place(out, word, frameAt, wordBack, word.length);
      const kinds = destinations(item, a, a.inLanes[j]).map((x) => turnOf(item, a, item.approaches.find((b) => b.id === x)));
      if (L.nIn < 2 || !kinds.length) continue;
      const arrow = arrowFor(kinds, j === 0);
      if (!arrow) continue;
      const built = catalog.build(arrow, lane);
      for (let k = 0; k < 2; k++) {
        const sp = wordBack - ARROW_BACK - k * ARROW_SPACING - built.length;
        if (sp < 0) break;
        place(out, built, frameAt, sp, built.length);
      }
    }
  }
  // Where a lane's YIELD begins (sp): clear of the dotted extension across the
  // whole lane, since the circle crosses its two edges at different distances.
  function yieldBack(L, j, length = WORD_LENGTH, halfWidth = L.inWidths[j] / 2) {
    const cache = L.yieldBacks ??= new Map(), key = `${j}:${length}:${halfWidth}`;
    if (cache.has(key)) return cache.get(key);
    // Words, movement handles and yield controls share the same crossings;
    // changing glyph widths must not solve the Bézier/ring roots again.
    const front = Math.min(...L.entryCrossings(j));
    const at = sp => L.entryFrame(j, sp).p;
    let back = stationAlong(at, front, -EXTENSION.width / 2 - YIELD_CLEAR - length);
    const fits = sp => {
      const f = L.entryFrame(j, stationAlong(at, sp, length / 2)), right = { x: -f.t.y, y: f.t.x };
      return [-halfWidth, 0, halfWidth].every(x => {
        const p = add(f.p, add(mul(f.t, length / 2), mul(right, x))), q = L.yieldRing.nearest(p);
        return !L.yieldRing.inside(p) && Math.hypot(p.x - q.x, p.y - q.y) >= YIELD_CLEAR + EXTENSION.width / 2;
      });
    };
    // One-way entries flare on both sides. Their actual center meets the
    // yield line sooner than either nominal lane offset; keep the full word
    // (not just its nominal station) behind that shared line.
    while (back > 0 && !fits(back)) back -= 0.5;
    cache.set(key, back);
    return back;
  }
  // Where a lane's guide and drag handle sit: an entry lane's just behind its
  // YIELD, an exit lane's just outside the circle. `u` points out along the
  // lane toward the mouth, as an approach's axis does at its mouth.
  const HANDLE_FEET = 20;
  function handle(item, a, incoming, j) {
    const L = layout(item).legs.get(a.id);
    const cache = L.handles ??= new Map(), key = `${incoming}:${j}`;
    if (cache.has(key)) return cache.get(key);
    const center = (sp) => (incoming ? L.entryBounds(j, sp).reduce((x, y) => x + y, 0) : (L.exitOff(j, sp) + L.exitOff(j + 1, sp))) / 2;
    const sp = incoming ? Math.max(0, yieldBack(L, j) - HANDLE_FEET - 1) : Math.max(0, L.meet(center) - HANDLE_FEET - 4);
    const p = L.P(center(sp), sp), q = L.P(center(sp + 1), sp + 1);
    const value = { p, u: unit(sub(p, q)), sp };
    cache.set(key, value);
    return value;
  }
  // Rigidly place catalog parts (x right of travel, y forward) with their back
  // edge at `sp` along a lane.
  function place(out, built, frameAt, sp, len) {
    if (!(sp > 0) || !built.parts.length) return;
    const f = frameAt(stationAlong(sp => frameAt(sp).p, sp, len / 2)), t = f.t, r = { x: -t.y, y: t.x };
    const origin = sub(f.p, mul(t, len / 2));
    for (const part of built.parts)
      out.symbols.push({ ...part, rings: part.rings.map((ring) => ring.map(([x, y]) => add(origin, add(mul(r, x), mul(t, y))))) });
  }
  // `sp` parameterizes a Bézier, not distance. Walk the rendered lane so an
  // eight-foot word and its setback remain eight feet on short/long pulls.
  function stationAlong(at, from, distance) {
    const sign = Math.sign(distance), step = sign * 0.5;
    let remaining = Math.abs(distance), sp = from, p = at(sp);
    for (let i = 0; i < 4000 && remaining > 1e-6; i++) {
      const next = sp + step, q = at(next), d = length(sub(q, p));
      if (d >= remaining) return sp + step * remaining / d;
      remaining -= d; sp = next; p = q;
    }
    return sp;
  }
  function placeAlong(out, built, p, t) {
    if(globalThis.StripeMaker?.traffic?.reversed)t=mul(t,-1);
    const r = { x: -t.y, y: t.x }, origin = sub(p, mul(t, built.length / 2));
    for (const part of built.parts)
      out.symbols.push({ ...part, rings: part.rings.map((ring) => ring.map(([x, y]) => add(origin, add(mul(r, x), mul(t, y))))) });
  }
  // Circulatory roadway lane lines (Exhibits 213-3 and 213-5): in front of each
  // splitter island, a solid 6" white line between the circulating lanes; past
  // each entry a 6" white 2'-4' dotted guide spirals out to the next exit's lane
  // line, so the outside lane leads off at that exit. Where a stretch needs
  // fewer lanes than the roadway has (from the lanes' destinations), its line
  // is left off. Standard arrows mark the circulating lanes in front of each
  // splitter (FDM 213.10).
  // Share the actual divider/exit curves with movement routing. A circular
  // lane center alone does not describe a lane turning out of the circle.
  function circulatoryDividers(Lt) {
    if (Lt.dividers) return Lt.dividers;
    const { C, flow: f, legs, item } = Lt, N = f.length, lines = [];
    for (let b = 1; b < C; b++) {
      const off = Lt.boundaryOff(b);
      // Adaptive outer curbs widen across entries. Offsetting that changing
      // curb hooks the guide inward into the surviving lane. Keep the
      // circulating divider concentric with the fixed island (FDM 213,
      // Exhibits 213-3/5); only the exit connector turns outward.
      const r = Lt.spiral ? Lt.dividerRing(b) : Lt.width ? Lt.memo("adaptiveDivider", [b, Lt.islandEdge, Lt.total, off], () => new Ring(Array.from({ length: SAMPLES }, (_, n) => {
        const t = TAU * n / SAMPLES, radius = Lt.islandEdge + Lt.total - off;
        return { x: Math.cos(t) * radius, y: Math.sin(t) * radius };
      }))) : Lt.ring(off);
      // Estimate an exit connector's run from its full-width upstream lane,
      // before any lane drop. Using the collapsed divider at the far side of
      // the exit starts the turn far too early and cuts across that lane.
      for (let i = 0; i < N; i++) {
        const A = legs.get(f[i].id), B = legs.get(f[(i + 1) % N].id);
        const transition = Lt.spiralPlan?.transitions.find(t => t.entry === A.a.id);
        lines.push(...Lt.memo("sector", [b, identity(r), identity(Lt.inner), Lt.widths, Lt.spiral,
          A.after, A.front, A.twoWay, A.a.id, A.entryLeft.t, A.exitLeft.t,
          B.exitKey, B.front, circulatingOut(item, B.a), Lt.use.after[i], transition && identity(transition)],
          () => circulatorySector(Lt, b, i, r)));
      }
    }
    return Lt.dividers = lines;
  }
  function circulatorySector(Lt, b, i, r) {
    const { C, flow: f, legs, item } = Lt, N = f.length;
    const A = legs.get(f[i].id), B = legs.get(f[(i + 1) % N].id), lines = [];
    const record = (boundary, points, color = WHITE, width = LINE, dash, exit) =>
      lines.push({ boundary, points, color, width, dash, ...exit });

    const exitSupport = Lt.spiral ? offsetRing(Lt.inner,
      Lt.widths.slice(Math.max(0, C - A.after), C - b).reduce((sum, w) => sum + w, 0)) : r;
    // Solid only in front of the splitter. Existing dividers become
    // dotted at the entry's inside edge; a new inside lane has its own
    // opening guide. Extending every solid to that guide's far end paints
    // across the entry lanes, especially beside a wide median.
    const transition = Lt.spiralPlan?.transitions.find(t => t.entry === A.a.id);
    const opening = transition?.guides.find(g => g.boundary === b);
    const t0 = A.exitLeft.t, t1 = opening?.points.length ? wrap(polar(opening.points.at(-1))) : A.entryLeft.t;
    if (A.front > b && A.twoWay) record(b, r.arc(t0, A.entryLeft.t, true));
    // Past A's entry, out to B's exit lane line.
    const exitLanes = circulatingOut(item, B.a);
    const exitsHere = (Lt.use.after[i] ?? []).some(records => records.some(record => record.exits.includes(B.a.id)));
    // FDM 213 (2025), 213.10 and Exhibits 213-3 / 213-5: the 6"
    // white 2'-4' guide continues through an entry conflict area. A
    // single-lane exit does not remove a divider needed by the lanes
    // still circulating past it; join the next splitter's solid line.
    if (A.after > b && (!exitsHere || (exitLanes <= b && B.front > b))) {
      record(b, r.arc(t1, B.exitLeft.t, true), WHITE, LINE, [GUIDE.on, GUIDE.off]);
    } else if (A.after > b && exitLanes >= b) {
      // When the outside lane leaves at a single-lane exit, the divider
      // becomes that exit's splitter-side boundary (k=0). A two-lane exit
      // instead receives it at its internal divider (Exhibit 213-3).
      const k = Math.max(0, exitLanes - b);     // B's exit boundary, counted from its splitter
      // At a single-lane exit the roadway can narrow to this divider.
      // Joining at that circle point forces the guide to turn back on
      // itself. Start with the splitter's outer nose corner; the fit can
      // meet farther along that same exit edge when it needs more room.
      const meetSp = k === 0 && B.twoWay ? Math.min(B.exitLeft.sp, islandEnds(Lt, B.a).exit) : B.meet((x) => B.exitOff(k, x));
      // Follow the circle, then turn out to the receiving divider
      // (Exhibits 213-3/5). This curve interpolation needs room for a
      // complete lane even when its endpoints have similar radii;
      // radial displacement alone makes a tight hook at multi-lane exits.
      // A spiral opening can run into the next exit before reaching its
      // nominal end. Fit the departure from that same guide, starting at
      // its tip; waiting until its end reads the collapsing lane-drop
      // tangent and folds both the paint and its offset movement paths.
      const startT = opening ? wrap(polar(opening.points[0])) : t1;
      let source = r, openingRing;
      if (opening) {
        openingRing = spiralGuideRing(transition,
          -Lt.widths.slice(C - b, C - transition.count + transition.added).reduce((sum, w) => sum + w, 0));
        const openingSpan = wrap(startT - t1);
        source = new Ring([]);
        source.at = t => wrap(startT - t) <= openingSpan + 1e-6 ? openingRing.at(t) : r.at(t);
      }
      const floor = q => {
        const t = polar(q), full = exitSupport.radius(t);
        return opening && wrap(startT - t) < wrap(startT - t1) ? Math.min(full, openingRing.radius(t)) : full;
      };
      const width = Math.max(...Lt.widths);
      let best;
      // Choose the turn station as well as its tangent pulls. A fixed
      // lead can force an S-bend even when a simple outward turn fits.
      // Keep the full upstream lane corridor clear, allowing a partial
      // width only in a new spiral opening. Prefer broad bends with
      // little reversal, leaving room for lane-center offsets. Moving
      // the join out along the approach avoids pinching it at the nose.
      // These are interpolation
      // criteria, not additional prescribed roadway dimensions.
      for (const retreat of [0, 0.5, 1, 1.5, 2, 3]) {
        const sp = Math.max(0, meetSp - retreat * width);
        const end = B.P(B.exitOff(k, sp), sp), te = wrap(polar(end));
        const outward = unit(sub(B.P(B.exitOff(k, sp - 1), sp - 1), end));
        const available = wrap(startT - te);
        for (const run of [0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6]) {
          const lead = run * width / Math.max(10, exitSupport.radius(te));
          const span = Math.max(0, available - lead), turnAt = startT - span;
          const arc = span > 1e-6 ? source.arc(startT, turnAt, true) : [];
          const start = source.at(turnAt);
          const along = unit(sub(source.at(turnAt - 0.001), source.at(turnAt + 0.001)));
          const reach = length(sub(end, start)), chord = unit(sub(end, start));
          if (dot(along, chord) <= 0 || dot(outward, chord) <= 0) continue;
          for (const gain of [0.25, 0.4, 0.55, 0.75]) for (const endGain of [0.25, 0.4, 0.55, 0.75]) {
            const scale = Math.min(1, 0.95 / Math.max(1e-9, gain * dot(along, chord) + endGain * dot(outward, chord)));
            const controls = [start, add(start, mul(along, reach * gain * scale)), sub(end, mul(outward, reach * endGain * scale)), end];
            const pts = Array.from({ length: 33 }, (_, i) => G.sample(controls, i / 32));
            const clearance = Math.min(...pts.map(q => length(q) - floor(q)));
            let curvature = 0, turns = 0, turn = 0;
            for (let i = 1; i < pts.length - 1; i++) {
              const u = sub(pts[i], pts[i - 1]), v = sub(pts[i + 1], pts[i]);
              const cross = u.x * v.y - u.y * v.x, angle = Math.atan2(cross, dot(u, v));
              curvature = Math.max(curvature, 2 * Math.abs(cross) / Math.max(1e-9, length(u) * length(v) * length(add(u, v))));
              turns += Math.abs(angle); turn += angle;
            }
            const score = Math.max(0, -clearance - 0.01) * 1000 + Math.max(0, curvature * width - 0.5) * 100 + (turns - Math.abs(turn)) * 2 + curvature * width + retreat * 0.1;
            if (!best || score < best.score) best = { score, pts, arc, sp, outward };
          }
        }
        if (best?.score < 0.6) break;
      }
      if (!best) return lines;
      record(b, [...best.arc.slice(0, -1), ...best.pts], WHITE, LINE, [GUIDE.on, GUIDE.off], {
        exit: B.a.id, exitBoundary: k, exitSp: best.sp, turnIndex: Math.max(0, best.arc.length - 1),
        startTangent: unit(sub(source.at(startT - 0.001), source.at(startT + 0.001))), endTangent: best.outward,
        opening: opening ? A.a.id : null,
      });
    }
    return lines;
  }
  function circulatoryMarkings(Lt, out, lineOf, catalog) {
    const { C, flow: f, legs, item } = Lt;
    if (C < 2) return;
    // FDM 213.5: avoid painting an ordinary divider on the shaped curb or
    // duplicating the spiral guide where it opens the new inside lane.
    const ordinaryLine = (boundary, points, ...style) => {
      if (!Lt.spiral) return lineOf(points, ...style);
      let part = [];
      for (const p of points) {
        const t = wrap(polar(p));
        const onSpiralGuide = Lt.spiralPlan.transitions.some(plan => plan.guides.some(guide => {
          if (guide.boundary !== boundary || !guide.points.length) return false;
          const start = wrap(polar(guide.points[0])), end = wrap(polar(guide.points.at(-1)));
          return wrap(start - t) < wrap(start - end) - 1e-6;
        }));
        if (!onSpiralGuide && length(p) > Lt.inner.radius(t) + LINE / 2) part.push(p);
        else { if (part.length > 1) lineOf(part, ...style); part = []; }
      }
      if (part.length > 1) lineOf(part, ...style);
    };
    const dividers = circulatoryDividers(Lt);
    for (const guide of dividers) {
      const exit = guide.exitBoundary === 0 ? splitterExitBoundary(Lt, legs.get(guide.exit).a) : null;
      const points = exit?.dotted ?? guide.points;
      if (guide.opening) lineOf(points, guide.color, guide.width, guide.dash);
      else ordinaryLine(guide.boundary, points, guide.color, guide.width, guide.dash);
    }
    // Spiral marking (213.5, Figure 213.5.1; Exhibit 213-3 spiral marking
    // detail): 6" white 2'-4' dotted guide continuing the large semicircle.
    for (const transition of Lt.spiralPlan?.transitions ?? []) for (const guide of transition.guides) {
      if (!dividers.some(g => g.opening === transition.entry && g.boundary === guide.boundary))
        lineOf(guide.points, WHITE, LINE, [GUIDE.on, GUIDE.off]);
    }
    if (!catalog) return;
    for (const a of f) {
      const A = legs.get(a.id);
      if (!A.twoWay) continue;
      const arrows = circulatingArrows(item, a), q = Math.min(arrows.length, C);
      const tm = wrap(A.exitLeft.t - wrap(A.exitLeft.t - A.entryLeft.t) / 2);
      // Continuing traffic keeps the inside lanes, unless a spiral island has
      // taken them (213.5).
      const first = Lt.spiral ? 0 : C - q;
      for (let o = first; o < first + q; o++) {
        const bounds = Lt.laneEdges(tm)[C - 1 - o];
        if (Lt.spiral && bounds[1] - bounds[0] < Lt.widths[C - 1 - o] - 0.05) continue;
        const ro = Lt.laneRing(o);
        const p = ro.at(tm), t = unit(sub(ro.at(tm - 0.01), p));
        const width = Lt.widths[C - 1 - o];
        const arrow = arrows[o - first];
        if (arrow) placeAlong(out, catalog.build(arrow, [{ left: -width / 2, right: width / 2 }]), p, t);
      }
    }
  }

  // ---- Guides --------------------------------------------------------------
  function exitLaneGuide(Lt, B, lane, spread) {
    const guide = circulatoryDividers(Lt).filter(g => g.exit === B.a.id)
      .sort((a, b) => Math.abs(a.exitBoundary - lane - 0.5) - Math.abs(b.exitBoundary - lane - 0.5))[0];
    if (!guide) return null;
    const { points, turnIndex, exitSp: sp, exitBoundary: k } = guide;
    const from = (lane + 0.5 - k) * Lt.widths[0] + spread;
    const to = (B.outWidths.slice(0, lane).reduce((sum, w) => sum + w, 0) + B.outWidths[lane] / 2)
      - B.outWidths.slice(0, k).reduce((sum, w) => sum + w, 0);
    const offset = points.map((p, i) => {
      const t = i === 0 ? guide.startTangent : i === points.length - 1 ? guide.endTangent
        : unit(sub(points[i + 1], points[i - 1]));
      const x = clamp((i - turnIndex) / Math.max(1, points.length - 1 - turnIndex), 0, 1), blend = x * x * (3 - 2 * x);
      return add(p, mul({ x: -t.y, y: t.x }, from + (to - from) * blend));
    });
    // A normal offset meets the curved approach at a different station than
    // the boundary does. Find that station instead of pulling the centerline
    // sideways to the boundary's cross section and pinching the turn.
    const centerAt = s => B.P((B.exitOff(lane, s) + B.exitOff(lane + 1, s)) / 2, s);
    const distanceAt = s => length(sub(centerAt(s), offset.at(-1)));
    let lo = Math.max(0, sp - Math.abs(to) - 4), hi = sp + Math.abs(to) + 4;
    for (let i = 0; i < 35; i++) {
      const a = lo + (hi - lo) / 3, b = hi - (hi - lo) / 3;
      if (distanceAt(a) < distanceAt(b)) hi = b; else lo = a;
    }
    const station = (lo + hi) / 2, correction = sub(centerAt(station), offset.at(-1));
    return { sp: station, points: offset.map((p, i) => {
      const x = clamp((i - turnIndex) / Math.max(1, points.length - 1 - turnIndex), 0, 1);
      return add(p, mul(correction, x * x * (3 - 2 * x)));
    }) };
  }
  // A schematic path for traffic from lane j of entry a to exit b: along the
  // entry, round the circle in its circulating lane (counterclockwise), and out.
  // `spread` moves the circulating part sideways (ft, outward positive) so paths
  // from different entries sharing a lane stay apart instead of stacking.
  function path(item, a, j, b, spread = 0, ends = {}) {
    const Lt = layout(item), A = Lt.legs.get(a.id), B = Lt.legs.get(b.id);
    const entryCenter = (sp) => A.entryBounds(j, sp).reduce((x, y) => x + y, 0) / 2;
    const active = a.inLanes.filter(id => destinations(item, a, id).length);
    const opening = Lt.spiralPlan?.transitions.find(t => t.entry === a.id);
    const sourceSlot = opening && j < opening.added ? opening.count - 1 - j : clamp(active.length - 1 - active.indexOf(a.inLanes[j]), 0, Lt.C - 1);
    let o = sourceSlot;
    // An entry with fewer lanes than the circle can feed its surviving
    // inside lanes. A route continuing beyond a lane-drop exit must enter
    // those lanes now, rather than following the departing outer lane and
    // jumping inward at that exit (the saved continuing-lane kink).
    if (Lt.spiral || Lt.width) {
      const order = exitOrder(item, a, b);
      const ahead = Lt.flow.filter(c => exitOrder(item, a, c) < order)
        .sort((p, q) => exitOrder(item, a, p) - exitOrder(item, a, q));
      const drops = ahead.reduce((sum, c) => {
        const L = Lt.legs.get(c.id), previous = Lt.legs.get(Lt.flow[(L.flow + Lt.flow.length - 1) % Lt.flow.length].id);
        return sum + Math.max(0, previous.after - L.front);
      }, 0);
      // Only actual downstream lane drops require an inside receiving slot.
      // Using the widest section elsewhere on the roundabout incorrectly
      // shifted two-lane entries into a nonexistent third lane.
      o = Math.min(Lt.C - 1, Math.max(o, drops));
    }
    // An opening can use fewer lanes than the roundabout's widest section.
    // Keep those occupied slots through later entries; a source movement
    // ending does not remove a lane that other sources still use.
    const localShifts = [];
    let localExitSlot = o;
    if (Lt.spiral || Lt.width) {
      const order = exitOrder(item, a, b);
      const exits = Lt.flow.filter(c => exitOrder(item, a, c) < order)
        .sort((p, q) => exitOrder(item, a, p) - exitOrder(item, a, q));
      for (const c of exits) {
        const L = Lt.legs.get(c.id), previous = Lt.legs.get(Lt.flow[(L.flow + Lt.flow.length - 1) % Lt.flow.length].id);
        const count = Math.max(1, previous.after), drop = Math.max(0, count - Math.max(1, L.front));
        if (!drop) continue;
        const after = Math.max(0, localExitSlot - drop);
        localShifts.push({ leg: L, count, before: localExitSlot, after });
        localExitSlot = after;
      }
    }
    const outN = circulatingOut(item, b);
    // Exit slots follow the lanes still present at this destination. Using
    // the original entry slot sends both left-only lanes into the same exit
    // lane after an outside through lane has already departed. On a fixed
    // multi-lane circle no slots collapse: retain the circulating lane's
    // position instead of sending an inside left turn to the outside exit.
    const exitSlot = Lt.spiral || Lt.width ? localExitSlot : o;
    const jo = clamp(outN - 1 - Math.min(exitSlot, outN - 1), 0, b.outgoing - 1);
    const exitCenter = (sp) => (B.exitOff(jo, sp) + B.exitOff(jo + 1, sp)) / 2;
    const s1 = A.circleMeet(entryCenter), s2 = B.meet(exitCenter);
    const inLine = A.line(entryCenter, Math.min(ends.from ?? 0, s1 - 4), s1);
    let outLine = B.line(exitCenter, Math.min(ends.to ?? 0, s2 - 4), s2).reverse();
    const ta = wrap(polar(inLine.at(-1))), tb = wrap(polar(outLine[0]));
    let span = wrap(ta - tb);
    // A U-turn's entry and exit are opposite sides of the same splitter;
    // their wrapped span already covers almost one lap, not two.
    if (span < 0.05) span += TAU;
    let ring = Lt.laneRing(o, spread);
    if (Lt.spiral || Lt.width) {
      // A source's movement ending does not remove a circulating lane that
      // still serves other approaches. Change slots only where the physical
      // lane plan drops a lane, using this entry's local receiving count.
      const shifts = localShifts.map(s => ({ ...s, from: wrap(ta - s.leg.exitRight.t), span: wrap(s.leg.exitRight.t - s.leg.exitLeft.t) }));
      const parallelPoint = (theta, c) => {
        c = clamp(c, 0, Lt.C - 1);
        const distance = Lt.widths.slice(0, c).reduce((sum, w) => sum + w, 0) + Lt.widths[c] / 2 + spread;
        const offsets = Lt.pathOffsets ??= new Map();
        if (!offsets.has(distance)) offsets.set(distance, offsetRing(Lt.inner, distance));
        return offsets.get(distance).at(theta);
      };
      ring = new Ring(ring.points.map(p => {
        const theta = polar(p), traveled = wrap(ta - theta);
        let lane = o;
        for (const at of shifts) {
          if (traveled < at.from) break;
          const x = clamp((traveled - at.from) / Math.max(at.span, 1e-6), 0, 1);
          if (Lt.spiral && x < 1) {
            // Through a drop, the surviving lanes stay parallel to the
            // island. Their outside-first indices change as the departing
            // lane leaves; blending already-collapsed lane centers swerves
            // twice and can jump at the far side of a multi-lane exit.
            return parallelPoint(theta, at.count - 1 - at.before);
          }
          lane = at.before + (at.after - at.before) * x * x * (3 - 2 * x);
        }
        lane = clamp(lane, 0, Lt.C - 1);
        const lo = Math.floor(lane), hi = Math.ceil(lane), amount = lane - lo;
        let point = add(mul(Lt.laneRing(lo, spread).at(theta), 1 - amount), mul(Lt.laneRing(hi, spread).at(theta), amount));
        for (const opening of Lt.spiralPlan?.transitions ?? []) {
          if (opening.entry === a.id || lane < opening.count - opening.added) continue;
          const start = polar(opening.tip), span = wrap(start - polar(opening.marking.at(-1))), progress = wrap(start - theta);
          if (progress > span) continue;
          // An already-circulating movement cannot follow a zero-width
          // inside track around the island's sharp tip. Let its receiving
          // lane open before bringing the guide into that track.
          const x = progress / span, amount = x * x * (3 - 2 * x);
          const from = Lt.laneRing(Math.max(0, opening.count - opening.added - 1), spread).at(theta);
          // Aim at the full lane's curb offset, rather than its temporary
          // partial-width center. Blending that center a second time makes
          // an abrupt bend halfway through a later spiral opening.
          const to = parallelPoint(theta, Math.max(0, Math.round(opening.count - 1 - lane)));
          point = add(mul(from, 1 - amount), mul(to, amount));
        }
        return point;
      }));
    }
    // Give the tangent joins enough angular room to turn into the circle.
    // Tiny fixed joins bend back on themselves near short/compact exits.
    // This controls the schematic editor guides, not pavement dimensions.
    const lead = Math.min(span * 0.45, 32 / Math.max(20, ring.radius(ta)));
    // Join the new inside lane beyond the end of its dotted opening, where
    // its full riding width exists. A generic circle join cuts across that
    // guide near T, especially with the approach's left offset or a gore.
    const entryLead = opening && j < opening.added ? Math.min(span - lead, Math.max(lead, wrap(ta - polar(opening.marking.at(-1))))) : lead;
    // Once this lane turns out, follow a normal offset of its painted exit
    // divider. Continuing around a collapsing circular lane then joining the
    // mouth creates an S-bend and cuts away from the actual lane corridor.
    const guide = exitLaneGuide(Lt, B, jo, spread);
    const guideStart = guide?.points.findIndex(p => {
      const traveled = wrap(ta - polar(p));
      return traveled >= entryLead && traveled < span;
    }) ?? -1;
    const exitPath = guideStart >= 0 && guideStart < guide.points.length - 2 ? guide.points.slice(guideStart) : null;
    if (exitPath) outLine = B.line(exitCenter, Math.min(ends.to ?? 0, guide.sp - 4), guide.sp).reverse();
    const arcSpan = exitPath ? wrap(ta - polar(exitPath[0])) - entryLead : span - entryLead - lead;
    const arcPts = [];
    const steps = Math.max(8, Math.ceil(span / (TAU / 180)));
    for (let k = 0; k <= steps; k++) {
      const t = ta - entryLead - arcSpan * k / steps;
      arcPts.push(ring.at(t));
    }
    if (exitPath) {
      // At a nearby first exit the painted guide may already be turning
      // outward by the time this entry reaches it. Join that lane directly;
      // inserting a circular arc would end in a sideways jump to the guide.
      if (exitOrder(item, a, b) === 1) arcPts.splice(0, arcPts.length, exitPath[0]);
      else arcPts[arcPts.length - 1] = exitPath[0];
    }
    const join = (p, dp, q, dq) => {
      const chord = sub(q, p), distance = length(chord), forward = unit(chord);
      const sample = factor => {
        // Keep the control polygon ordered along the join's chord. A long
        // receiving tangent used to reach back past the entry and make a
        // small loop while seeking more apron clearance (weird.json).
        // Ordered projections make forward progress monotone, so a join
        // cannot double back or intersect itself. Positive tangents keep
        // their direction; only their handle lengths change.
        const from = dot(dp, forward) > 0 ? dp : { x: 0, y: 0 };
        const to = dot(dq, forward) > 0 ? mul(dq, factor) : { x: 0, y: 0 };
        const scale = Math.min(1, distance * 0.95 / Math.max(1e-9, dot(add(from, to), forward)));
        const controls = [p, add(p, mul(from, scale)), sub(q, mul(to, scale)), q];
        return Array.from({ length: 25 }, (_, k) => G.sample(controls, k / 24));
      };
      if (!Lt.spiral) return sample(1);
      const clearance = Math.min(...Lt.widths) / 2;
      let best = sample(1), bestClearance = -Infinity;
      // Preserve both endpoint tangents while selecting a handle that clears
      // the shaped curb. A circular chord can otherwise cut the spiral tip.
      for (const factor of [1, 1.25, 1.5, 2, 2.5, 3, 0.75, 0.5]) {
        const points = sample(factor), available = Math.min(...points.map(p => length(p) - Lt.inner.radius(polar(p))));
        if (available > bestClearance) { best = points; bestClearance = available; }
        if (available >= clearance - 0.05) break;
      }
      return best;
    };
    const d1 = length(sub(arcPts[0], inLine.at(-1))) * 0.5, d2 = length(sub(outLine[0], arcPts.at(-1))) * 0.5;
    const inDir = unit(sub(inLine.at(-1), inLine.at(-2))), outDir = unit(sub(outLine[1], outLine[0]));
    // A nearby first exit may leave no useful circulating arc between two
    // tangent joins. One continuous turn avoids the miniature S-bend made
    // by squeezing two connectors into that short sector. Accept it only
    // when it clears the island and stays inside the circulatory roadway.
    if (Lt.C === 1 && exitOrder(item, a, b) === 1 && span < Math.PI) {
      const from = inLine.at(-1), to = outLine[0], distance = length(sub(to, from));
      const region = Lt.guideRegion ??= { pavement: outline(item), splitters: item.approaches.map(a => splitter(Lt, a)).filter(Boolean) };
      for (const gain of [0.4, 0.35, 0.3, 0.25]) {
        const points = join(from, mul(inDir, distance * gain), to, mul(outDir, distance * gain));
        if (points.every(p => length(p) >= Lt.inner.radius(polar(p)) + Math.min(...Lt.widths) / 2 - 0.1 && G.contains(p, region.pavement) && !region.splitters.some(poly => G.contains(p, poly))))
          return [...inLine, ...points.slice(1, -1), ...outLine];
      }
    }
    const arcIn = unit(sub(arcPts[1] ?? exitPath[1], arcPts[0]));
    const arcOut = arcPts.length > 1 ? unit(sub(arcPts.at(-1), arcPts.at(-2))) : arcIn;
    return [...inLine, ...join(inLine.at(-1), mul(inDir, d1), arcPts[0], mul(arcIn, d1)).slice(1, -1), ...arcPts,
      ...(exitPath ? exitPath.slice(1, -1) : join(arcPts.at(-1), mul(arcOut, d2), outLine[0], mul(outDir, d2)).slice(1, -1)), ...outLine];
  }

  // Each entry's share of a circulating lane for its guide paths: entries in
  // flow order spread across the middle of the lane.
  function spreadFor(item, a) {
    const Lt = layout(item), N = Lt.flow.length, i = Lt.flow.indexOf(a), w = Math.min(...Lt.widths);
    const step = (w * 0.75) / Math.max(1, N - 1);
    return (i - (N - 1) / 2) * step;
  }
  // ---- Checks ----------------------------------------------------------------
  function validate(item) {
    normalize(item);
    if (item.approaches.length < 2) return "Keep at least two approaches.";
    const s = settings(item);
    if (![diameter(item), s.ratio, s.apron, s.entryRadius, s.exitRadius].every(Number.isFinite)) return "Enter valid roundabout dimensions.";
    if (diameter(item) < MINI_DIAMETER[0]) return "Keep the inscribed diameter at least 45 ft.";
    if (s.mini && (laneCount(item) > 1 || item.approaches.some(a => a.incoming > 1 || a.outgoing > 1))) return "Mini-roundabouts use one circulating lane and at most one entry and exit lane per approach.";
    for (const a of item.approaches) {
      if (![a.x, a.y, a.angle, a.width, a.outWidth, a.incoming, a.outgoing, a.speed, a.bend].every(Number.isFinite)) return "Enter valid approach dimensions.";
      if (a.bezier && ![a.bezier.axis, a.bezier.mouth?.pull, a.bezier.mouth?.offset, a.bezier.circle?.pull, a.bezier.circle?.offset].every(Number.isFinite)) return "Enter valid approach curve dimensions.";
      if (a.bezierSides && Object.values(a.bezierSides).some(edit => ![edit?.pull, edit?.offset,
        ...(edit?.mouth ? [edit.mouth.pull, edit.mouth.offset] : []),
        ...(edit?.connection ? [edit.connection.along, edit.connection.across] : []),
        ...(edit?.corner != null ? [edit.corner, edit.cornerAt ?? 1] : [])].every(Number.isFinite))) return "Enter valid entry and exit curve dimensions.";
      if (!a.incoming && !a.outgoing) return "Each approach needs at least one lane.";
      if (!Number.isFinite(a.yieldSetback) || a.yieldSetback < 0) return "Enter a nonnegative yield line setback.";
      if (Object.values(a.entryGoreLengths ?? {}).some(v => !Number.isFinite(v) || v <= 0)) return "Enter a positive entry gore length.";
    }
    return geometryChecks(item, layout(item))[0] ?? "";
  }
  // Geometric constraints apply to both panel edits and on-sheet handles.
  // Recommended design dimensions remain advisory in checks() below.
  function geometryChecks(item, Lt) {
    const out = [], s = settings(item);
    const islandSpace = s.mini ? 1 : s.apron + 5;
    if (Lt.sh.kind !== "circle" && folds(Lt.sh, Lt.total + islandSpace)) out.push(Lt.sh.kind === "peanut" ? "The peanut's waist is narrow for its circulatory roadway." : "The oval is narrow for its circulatory roadway.");
    // A spiral can have fewer lanes in some sectors; subtracting the maximum
    // lane count from its outer radius incorrectly rejects those narrow parts.
    const innerSpace = Lt.spiral ? Math.min(...Lt.inner.points.map(length)) : Lt.sh.b - Lt.total;
    if (innerSpace + 1e-6 < islandSpace) out.push("The circulating roadway leaves too little space for the central island and apron. Enlarge the circle or reduce its widths.");
    for (const a of item.approaches) {
      const L = Lt.legs.get(a.id), name = `Approach ${item.approaches.indexOf(a) + 1}`;
      out.push(...Lt.memo("legChecks", [identity(L), name], () => {
        const out = [];
        if (L.S0 < 15) out.push(`${name}: the connection is close to the circulatory roadway.`);
        if (a.incoming && a.yieldSetback > 0 && a.inLanes.some((_, j) => yieldBack(L, j) < 1))
          out.push(`${name}: keep the yield line and YIELD words within the approach. Move the line toward the circle or lengthen the approach.`);
        for (const [side, count] of [["entry", a.incoming], ["exit", a.outgoing]]) if (count) {
          const points = (L.sideBeziers[side] ?? L.bezier).points;
          // The control polygon can double back while the cubic itself still
          // advances smoothly. Test the actual quadratic derivative, including
          // its interior minimum, rather than rejecting crossed control pulls.
          const [d0, d1, d2] = points.slice(1).map((p, i) => -dot(sub(p, points[i]), L.u));
          const curvature = d0 - 2 * d1 + d2;
          const t = curvature > 0 ? clamp((d0 - d1) / curvature, 0, 1) : 0;
          const advance = (1 - t) ** 2 * d0 + 2 * t * (1 - t) * d1 + t * t * d2;
          if (Math.min(d0, d2, advance) < 1 - 1e-6)
            out.push(`${name}: the ${side} curve turns back on itself. Shorten its handles or move the connection farther out.`);
        }
        if (a.bend || a.bezier || a.bezierSides) for (let i = 0; i <= 100; i++) {
          const sp = L.S0 * i / 100;
          if (Math.min(L.metric(L.entryOff(a.incoming, sp), sp), L.metric(L.exitOff(a.outgoing, sp), sp)) < 0.15) {
            out.push(`${name}: the bend folds a lane edge. Adjust its curve or give the approach more room.`); break;
          }
        }
        // Independently shaped sides do not share a station or normal. A
        // negative projected gap at equal cubic parameters can be a perfectly
        // clear median. Check their actual visible boundaries for crossings.
        if (L.twoWay && a.bezierSides) {
          const entry = L.line(sp => L.entryOff(0, sp), 0, L.entryLeft.sp);
          const exit = L.line(sp => L.exitOff(0, sp), 0, L.exitLeft.sp);
          const mouthNormal = unit(add(L.normal(0, -1), L.normal(0, 1)));
          if (crossing(entry, exit) || dot(sub(exit[0], entry[0]), mouthNormal) < -1e-6)
            out.push(`${name}: the entry and exit curves cross.`);
        }
        for (let k = 1; k < a.incoming; k++) if (entryGoreType(a, k) === "curbed" && !goreIsland(L, k))
          out.push(`${name}: the entry gore is too small for a curbed island.`);
        return out;
      }));
    }
    if ([...Lt.corners.values()].some(c => !c.ok)) out.push("Some approach curbs meet the circle without a fitted corner radius.");
    // Neighboring legs must not overlap at the circle.
    const f = Lt.flow;
    for (let i = 0; i < f.length; i++) {
      const A = Lt.legs.get(f[i].id), B = Lt.legs.get(f[(i + 1) % f.length].id);
      if (wrap(A.entryRight.t - B.exitRight.t) > (wrap(A.phi - B.phi) || TAU)) {
        out.push("Approach openings overlap at the circle."); break;
      }
    }
    return out;
  }

  // Internal engineering audit, used by regression tests, not editor help.
  // Recommended design dimensions don't stop an edit; validate() rejects
  // unusable input and geometry that cannot fit together.
  function checks(item) {
    const s = settings(item), Lt = layout(item), C = Lt.C, sh = Lt.sh, out = geometryChecks(item, Lt);
    if (s.mini) {
      if (diameter(item) > MINI_DIAMETER[1]) out.push("Mini-roundabouts typically have a 45–90 ft inscribed diameter (NCHRP 672, Exhibit 1-9).");
      if (sh.kind !== "circle") out.push("Mini-roundabout guidance uses a circular central island.");
      return out;
    }
    const name = (a) => `Approach ${item.approaches.indexOf(a) + 1}`;
    if (C > FDM_LANES) out.push(`${C} circulating lanes: state highway roundabouts are single-lane or two-lane, partial three-lane under certain conditions (213.1).`);
    if (sh.kind !== "circle") out.push("The roundabout guidance covers circular roundabouts; this shape keeps its cross section and markings.");
    const range = ICD_RANGE[C], D = diameter(item);
    if (range && (D < range[0] || D > range[1])) out.push(`Inscribed diameter ${D} ft is outside the typical ${range[0]}–${range[1]} ft for a ${C === 1 ? "single" : "two"}-lane roundabout (213.3).`);
    if (C === 1 && (Lt.widths[0] < SINGLE_WIDTH_RANGE[0] || Lt.widths[0] > SINGLE_WIDTH_RANGE[1])) out.push(`Circulatory width ${Lt.widths[0]} ft is outside 18–20 ft (Exhibit 213-2).`);
    if (C > 1) {
      if (Lt.widths.some((w) => w < CIRC_LANE_RANGE[0] || w > CIRC_LANE_RANGE[1])) out.push("Circulating lanes typically range from 12 to 18 ft (213.3.7).");
    }

    const spiralEntries = item.approaches.filter(a => a.incoming > 1 && a.inLanes.some(id => {
      const to = destinations(item, a, id);
      return to.length && to.every(id => ["left", "u"].includes(turnOf(item, a, item.approaches.find(b => b.id === id))));
    }));
    if (spiralEntries.length && s.spiral === "off") out.push("Exclusive left-turn lanes need spiral transitions; the spiral is currently off (213.5).");
    if (Lt.spiralPlan && !Lt.spiralPlan.alignmentFits) out.push("The inside lane's left edge misses the spiral island. Adjust the entry angle, lane widths, or inscribed diameter to align the new inside lane (213.4–213.5).");

    if (!(s.apron > 0)) out.push("Enter the truck apron width from the design vehicle's swept path (WB-62FL on state highways; 213.3.8, 213.7).");

    if (s.entryRadius < ENTRY_RADIUS) out.push(`Entry curb radius ${s.entryRadius} ft is under the 65 ft minimum (Exhibit 213-2).`);
    const ordered = G.ordered(item), tightEntry = [], flatExit = [];
    for (const [i, a] of ordered.entries()) {
      const b = ordered[(i + 1) % ordered.length], c = Lt.corners.get(a.id);
      if (!c?.radii || !a.outgoing || !b.incoming) continue;
      if (c.radii.entry + 0.05 < Math.min(s.entryRadius, ENTRY_RADIUS) || c.tight) tightEntry.push(c.radii.entry);

    }
    const corners = (n) => (n === 1 ? "1 corner" : `${n} corners`);
    if (tightEntry.length) out.push(`Entry curbs fit only R ${Math.min(...tightEntry).toFixed(0)} ft at ${corners(tightEntry.length)} (65 ft minimum, Exhibit 213-2). Move legs apart or enlarge the circle.`);

    for (const a of item.approaches) {
      const L = Lt.legs.get(a.id);
      // FDM 213.4: simultaneous entry lanes cannot share a receiving lane.
      // Preserve explicit destinations, but expose their conflict for editing.
      for (const b of item.approaches) {
        const count = a.inLanes.filter(id => destinations(item, a, id).includes(b.id)).length;
        if (count > b.outgoing) out.push(`${name(a)}: ${count} entry lanes feed ${name(b).toLowerCase()}'s ${b.outgoing} exit lane${b.outgoing === 1 ? "" : "s"}. Change lane destinations or add exit lanes to avoid path overlap (213.4).`);
      }
      if (a.ar3 < AR3_RANGE[0] || a.ar3 > AR3_RANGE[1]) out.push(`${name(a)}: AR3 ${a.ar3} ft is outside the typical 75–100 ft (213.3.1).`);
      if (a.outgoing && (a.exitCurve < EXIT_RANGE[0] || a.exitCurve > EXIT_RANGE[1])) out.push(`${name(a)}: exit curve ${a.exitCurve} ft is outside the typical 300–400 ft (213.7.3).`);
      if (L.twoWay && L.islandLength + 0.5 < SPLITTER_MIN(a.speed)) out.push(`${name(a)}: the splitter island is ${L.islandLength.toFixed(0)} ft; at ${a.speed} mph it must be at least ${SPLITTER_MIN(a.speed)} ft (213.3.5). Lengthen the approach.`);
      if (L.twoWay && L.sepScale < 0.999) out.push(`${name(a)}: the approach is ${((1 - L.sepScale) * L.sep.length).toFixed(0)} ft too short for its AR1–tangent–AR2 curves (213.3.1).`);
      if (L.twoWay && L.tangent < TANGENT.min) out.push(`${name(a)}: no room for the 25 ft minimum tangent past the nose (213.3).`);
      if (L.twoWay) {
        const width = L.hIn(L.S0 / 2 + L.nose / 2) + L.hOut(L.S0 / 2 + L.nose / 2) - 2 * L.curbOffset(L.S0 / 2 + L.nose / 2);
        if (width < ISLAND_MIN) out.push(`${name(a)}: the splitter island is ${width.toFixed(1)} ft wide; 8 ft minimum (Exhibit 213-2).`);
      }
      const sides = [[a.incoming, L.inWidths.slice(0, L.nIn), "entry"], [a.outgoing, L.outWidths, "exit"]];
      for (const [count, widths, label] of sides)
        if (count && widths.reduce((x, y) => x + y, 0) + L.curb + CURB.E < CURB_TO_CURB) out.push(`${name(a)}: the ${label} is under 15 ft face to face of curbs (213.3.6).`);
      if (a.inLanes.slice(1).some((_, j) => { const w = entryGoreWidth(a, j + 1); return entryGoreType(a, j + 1) === "painted" && w > 0 && (w < STAY_IN_LANE_GORE[0] || w > STAY_IN_LANE_GORE[1]); })) out.push(`${name(a)}: a stay-in-lane gore is 6 to 7 ft (213.7.2).`);
    }
    const f = Lt.flow;
    for (let i = 0; i < f.length && f.length > 2; i++) {
      const a = f[i], b = f[(i + 1) % f.length], gap = degrees(Lt.legs.get(a.id).phi * 180 / Math.PI - Lt.legs.get(b.id).phi * 180 / Math.PI);
      if (gap < LEG_ANGLE) out.push(`${name(a)} and ${name(b)} meet at ${gap.toFixed(0)}°; consider realigning legs under 75° (213.3.3).`);
    }
    return out;
  }

  // Lane tracks for lateral markings on the approaches: each direction's
  // lanes from the mouth to the circle (incoming) or back (outgoing), with
  // their edges right of travel at each point.
  function tracks(item) {
    const Lt = layout(item), list = [];
    if (Lt.tracks) return Lt.tracks;
    for (const a of item.approaches) {
      const L = Lt.legs.get(a.id);
      for (const incoming of [true, false]) {
        const ids = incoming ? a.inLanes : a.outLanes;
        if (!ids.length) continue;
        const track = Lt.memo("track", [identity(L), incoming], () => {
          const end = incoming ? L.entryLeft.sp : L.exitLeft.sp, steps = Math.max(2, Math.ceil(end / 4));
          const sps = Array.from({ length: steps + 1 }, (_, i) => (end * i) / steps);
          const line = sps.map((sp) => L.reference(incoming, sp));
          const bounds = sps.map((sp) => ids.map((_, j) => incoming ? L.entryBounds(j, sp).map(v => -v) : [L.exitOff(j, sp), L.exitOff(j + 1, sp)]));
          const markingLaneEdges = ids.map((_, j) => [0, 1].map(side => {
            const off = sp => incoming ? L.entryBounds(j, sp)[side] : L.exitOff(j + side, sp);
            const points = L.line(off, 0, incoming ? L.circleMeet(off) : L.meet(off));
            return incoming ? points : points.reverse();
          }));
          const paintedGoreBoundaries = ids.map((_, j) => incoming && j > 0 && entryGoreWidth(a, j) > 0 && entryGoreType(a, j) === "painted");
          return { incoming, ids: [...ids], markingLaneEdges, paintedGoreBoundaries,
            line: incoming ? line : line.reverse(), bounds: incoming ? bounds : bounds.reverse() };
        });
        list.push({ ...track, approach: a });
      }
    }
    // The circulatory roadway, so markings can go in the circle: one loop with
    // traffic (counterclockwise) along its middle, the circulating lanes inside
    // to outside (right of travel is outward).
    const circle = Lt.memo("circleTrack", [identity(Lt.outer), identity(Lt.inner), Lt.widths,
      Array.from({ length: Math.max(0, Lt.C - 1) }, (_, b) => identity(Lt.dividerRing(b + 1)))], () => {
      const half = Lt.total / 2;
      // Adaptive/spiral bounds are radial coordinates, including on ovals and
      // peanuts. Use a circular reference so its right-of-travel normal is
      // radial too; an oval reference would apply the shape's stretch twice.
      const mid = Lt.width || Lt.spiral ? new Ring(Array.from({ length: SAMPLES }, (_, i) => {
        const t = TAU * i / SAMPLES, radius = Lt.islandEdge + half;
        return { x: radius * Math.cos(t), y: radius * Math.sin(t) };
      })) : Lt.ring(half);
      const line = mid.arc(0, 0, true, true);
      const edges = Lt.widths.map((_, c) => [half - Lt.widths.slice(c).reduce((x, y) => x + y, 0), half - Lt.widths.slice(c + 1).reduce((x, y) => x + y, 0)]);
      const bounds = line.map((p) => {
        if (!Lt.width && !Lt.spiral) return edges;
        return Lt.laneEdges(polar(p)).map(([l, r]) => [l - half, r - half]);
      });
      return { approach: { id: "circulatory" }, incoming: true, circulatory: true, ids: Lt.widths.map((_, c) => `circulatory-${c}`), line, bounds };
    });
    list.push(circle);
    return Lt.tracks = list;
  }

  const api = {
    create, approach, normalize, snapshot, checks, entryGoreWidth, entryGoreType, entryGoreHandles, resizeEntryGore, requiredReach, separation, approachCurves, approachAxes, approachBezierHandles, setApproachBezier, approachSideBezierHandle, approachSideBezierHandles, approachLane, approachEdge, setApproachSideBezier, splitterCorners, setSplitterCorner, straightenApproach, approachBendHandle, setApproachBend, approachCurveHandle, approachCurveRadius, curveRadius, sideFriction, settings, layout, flow, exitOrder, turnOf, demand, laneCount, laneWidths, diameter, destinations, defaultDestinations,
    arrowFor, laneUse, circulatingArrows, spiralWanted, spiralEntries, outline, cornerPoints, surfaces, holes, markings, path, validate, tracks, splitter, circulatingIn, spreadFor, handle,
    yieldLineHandle, moveYieldLine, splitterLength, SPLITTER_MIN, SHAPES, RATIO_RANGE, MAX_LANES, FDM_LANES, defaultWidths, defaultDiameter, shape, separationSpacing, ICD, ICD_RANGE, MINI_DIAMETER, CIRCULATORY, CIRC_LANE_RANGE, SINGLE_WIDTH_RANGE, APRON, ENTRY_RADIUS, EXIT_RADIUS, EXIT_RANGE, AR3, AR3_RANGE, CURB, STAY_IN_LANE_GORE, GORE_ENTRY_WIDTH, EXTENSION, GUIDE, LINE, NOSE_RADIUS, NOSE_OFFSET, ISLAND_SETBACK, END_RADIUS,
  };
  (globalThis.StripeMaker ??= {}).roundaboutGeometry = api;
  if (typeof module !== "undefined") module.exports = api;
})();
