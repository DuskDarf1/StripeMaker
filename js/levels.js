/* Levels: roads graded up onto bridges (the Levels panel).

   Every road is on level 1 (the ground). Dragging along a road with the Levels
   panel open puts that stretch on a bridge one level above what's there, up to
   level 10, carried on through any roads joined to it (end to start) as far
   as the pointer goes. Each road's piece of a bridge is stored per sheet as
   { id, span, road, from, to, level, skew }: pieces sharing a span are one
   bridge; from and to are fractions along the road's centerline (both sides
   of a two-way road), and skew is in degrees from square.

   Bridges are drawn over everything on lower levels: a concrete copy of the
   road's pavement with its lines, clipped to the stretch, a barrier along its
   outer edges, and a line across each end, turned by the skew. Where a piece
   meets the end of its road the cut stays square (the road's own end), so the
   pieces of one bridge read as one. */
(() => {
  const SVG = 'http://www.w3.org/2000/svg';
  const LEVELS = 10;
  const MIN_FEET = 10;              // shorter drags are clicks
  const CLICK_PIXELS = 5;
  // Schematic bridge barrier and end line widths (plan view only; not a
  // pavement marking dimension).
  const BARRIER_FEET = 1.5;
  const END_LINE_INCHES = 6;
  const END_LINE = '#252628';

  const app = window.StripeMaker ??= {};
  const ppf = sheet => 12 / sheet.inchesPerPixel;
  // Level 1 is red; each level up steps around the hues.
  const levelColor = level => `hsl(${(level - 1) * 360 / LEVELS} 90% 50%)`;
  const svg = (tag, attrs, parent) => {
    const e = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    parent?.append(e);
    return e;
  };
  const pathData = (points, close) => `M${points.map(p => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join('L')}${close ? 'Z' : ''}`;

  // Polyline helpers (sheet pixels).
  function measure(points) {
    const along = [0];
    for (let i = 1; i < points.length; i++) along.push(along[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
    return along;
  }
  // The point at arc length s, carried on straight past either end.
  function pointAt(points, along, s) {
    let i = 1;
    while (i < points.length - 1 && along[i] < s) i++;
    const a = points[i - 1], b = points[i], len = (along[i] - along[i - 1]) || 1;
    const f = (s - along[i - 1]) / len;
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, t: { x: (b.x - a.x) / len, y: (b.y - a.y) / len } };
  }
  function slice(points, along, a, b) {
    const out = [pointAt(points, along, a)];
    for (let i = 0; i < points.length; i++) if (along[i] > a && along[i] < b) out.push(points[i]);
    out.push(pointAt(points, along, b));
    return out;
  }
  // Offset to the right of travel (negative: left).
  function offsetLine(points, distance) {
    return points.map((p, i) => {
      const a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)];
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      return { x: p.x - (b.y - a.y) / len * distance, y: p.y + (b.x - a.x) / len * distance };
    });
  }
  function project(points, along, point) {
    let best = null;
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i], b = points[i + 1], dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy || 1;
      const f = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / len2));
      const d = Math.hypot(point.x - (a.x + dx * f), point.y - (a.y + dy * f));
      if (!best || d < best.distance) best = { s: along[i] + f * Math.sqrt(len2), distance: d };
    }
    return best;
  }
  function inside(point, polygon) {
    let hit = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const a = polygon[j], b = polygon[i];
      if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) hit = !hit;
    }
    return hit;
  }
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const spanOf = bridge => bridge.span ?? bridge.id;

  // A road's geometry for levels: its centerline (measured), pavement edges,
  // and pavement outline.
  function geometry(section, road) {
    const g = section(road);
    return { ...g, road, along: measure(g.line), length: measure(g.line).at(-1), outline: [...g.left, ...[...g.right].reverse()] };
  }
  // A bridge piece's deck: its road (both sides of a two-way road), any road
  // splitting off or merging in at the same joints while it still touches the
  // road or the gore between them, and those gores. `paved` is the deck's
  // pavement; `clip` is the stretch (ends turned by the skew, square at the
  // road's own ends); `barriers` run along the deck's outer edges; `lines`
  // cross its ends.
  function deckOf(sheet, piece, { geometryOf, pairOf, gores }) {
    const g = geometryOf(piece.road), road = g.road;
    const partner = pairOf(road), pg = partner && geometryOf(partner.id);
    const mine = [road.id, partner?.id];
    const near = gores.filter(gore => gore.roads.some(id => mine.includes(id)));
    const base = [g.outline, ...(pg ? [pg.outline] : []), ...near.map(gore => gore.outline)];
    const tolerance = ppf(sheet);
    const touches = p => base.some(poly => inside(p, poly) || project([...poly, poly[0]], measure([...poly, poly[0]]), p).distance <= tolerance);
    // Splits and merges: roads leaving this road's start joint or reaching its
    // end joint, for as long as they touch it (from the shared joint on).
    const companions = [];
    for (const other of sheet.roads) {
      if (mine.includes(other.id)) continue;
      const e = other.ends[0].joint === road.ends[0].joint ? 0 : other.ends[1].joint === road.ends[1].joint ? 1 : -1;
      if (e < 0) continue;
      const x = geometryOf(other.id), n = x.line.length;
      const order = e ? [...Array(n).keys()].reverse() : [...Array(n).keys()];
      let reach = 0;
      while (reach < n && touches(x.left[order[reach]]) || reach < n && touches(x.right[order[reach]])) reach++;
      if (reach < 2) continue;
      const kept = order.slice(0, Math.min(n, reach + 1)).sort((i, j) => i - j);
      companions.push({ x, outline: [...kept.map(i => x.left[i]), ...kept.map(i => x.right[i]).reverse()] });
    }
    const paved = [...base, ...companions.map(c => c.outline)];
    const barrier = BARRIER_FEET * ppf(sheet);
    const W = Math.max(...paved.flat().map(p => project(g.line, g.along, p).distance)) + barrier + 2 * ppf(sheet);
    const tan = Math.tan((piece.skew ?? 0) * Math.PI / 180);
    const ends = [piece.from, piece.to].map((f, e) => {
      const atEnd = e ? f >= 1 - 1e-6 : f <= 1e-6;
      return { s: f * g.length + (atEnd ? (e ? 1 : -1) : 0), tan: atEnd ? 0 : tan, atEnd };
    });
    const [a, b] = ends;
    const right = offsetLine(slice(g.line, g.along, a.s + W * a.tan, b.s + W * b.tan), W);
    const left = offsetLine(slice(g.line, g.along, a.s - W * a.tan, b.s - W * b.tan), -W);
    const lines = ends.map(end => {
      const c = pointAt(g.line, g.along, end.s), n = { x: -c.t.y, y: c.t.x };
      const angle = Math.atan(end.tan), d = { x: n.x * Math.cos(angle) + c.t.x * Math.sin(angle), y: n.y * Math.cos(angle) + c.t.y * Math.sin(angle) };
      const reach = W / Math.cos(angle);
      return { from: { x: c.x - d.x * reach, y: c.y - d.y * reach }, to: { x: c.x + d.x * reach, y: c.y + d.y * reach }, atEnd: end.atEnd, center: c };
    });
    // Barriers: each edge where just outside it (half the barrier out) isn't
    // deck, offset outward so the barrier sits on the deck's edge.
    const probe = barrier / 2 + 1 / sheet.inchesPerPixel;
    const edges = [g, pg, ...companions.map(c => c.x)].filter(Boolean).flatMap(x => [{ points: x.right, out: 1 }, { points: x.left, out: -1 }]);
    const barriers = [];
    for (const edge of edges) {
      const outside = offsetLine(edge.points, edge.out * probe), centered = offsetLine(edge.points, edge.out * barrier / 2);
      let run = [];
      outside.forEach((p, i) => {
        if (!paved.some(poly => inside(p, poly))) run.push(centered[i]);
        else { if (run.length > 1) barriers.push(run); run = []; }
      });
      if (run.length > 1) barriers.push(run);
    }
    return { piece, g, pg, companions, gores: near, paved, clip: [...right, ...left.reverse()], barriers, barrier, lines };
  }
  const boxOf = points => points.reduce((b, p) => ({ x0: Math.min(b.x0, p.x), y0: Math.min(b.y0, p.y), x1: Math.max(b.x1, p.x), y1: Math.max(b.y1, p.y) }),
    { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
  // Is a point on this deck (in its stretch and on its pavement)?
  function onDeck(deck, p) {
    deck.box ??= boxOf(deck.clip);
    if (p.x < deck.box.x0 || p.x > deck.box.x1 || p.y < deck.box.y0 || p.y > deck.box.y1) return false;
    return inside(p, deck.clip) && deck.paved.some(poly => inside(p, poly));
  }
  // A bridge end at its road's end that another piece on the same level
  // carries on from draws no end line.
  function carriedOn(deck, line, decks) {
    if (!line.atEnd) return false;
    return decks.some(other => other !== deck && other.piece.level === deck.piece.level
      && other.lines.some(l => l.atEnd && distance(l.center, line.center) < distance(line.from, line.to) / 4));
  }
  // A copy of drawn nodes with their own ids (gores clip their stripes by id).
  let cloneCount = 0;
  function copy(node) {
    const out = node.cloneNode(true);
    const renamed = new Map();
    for (const e of [out, ...out.querySelectorAll('[id]')]) {
      if (!e.id) continue;
      const id = `${e.id}-bridge-${++cloneCount}`;
      renamed.set(e.id, id);
      e.id = id;
    }
    for (const e of [out, ...out.querySelectorAll('[clip-path],[mask]')]) for (const attr of ['clip-path', 'mask']) {
      const ref = e.getAttribute?.(attr)?.match(/^url\(#(.+)\)$/)?.[1];
      if (ref && renamed.has(ref)) e.setAttribute(attr, `url(#${renamed.get(ref)})`);
    }
    return out;
  }

  // Levels above this one aren't drawn (the Settings popover's Hide levels
  // above), except in downloads, which always show every level.
  let exporting = false;
  const shownLevels = () => (exporting ? LEVELS : app.settings?.get('hideLevelsAbove') || LEVELS);
  // The level at a point on a road: the highest deck there that carries it.
  const deckRoads = deck => [deck.g, deck.pg, ...deck.companions.map(c => c.x)].filter(Boolean).map(x => x.road.id);
  const levelOf = (decks, point, road) => Math.max(1, ...decks.filter(d => (road == null || deckRoads(d).includes(road)) && onDeck(d, point)).map(d => d.piece.level));
  // A mask (white sheet, black holes) in the form downloads turn into clips.
  function hide(node, holes, sheet) {
    const id = `level-mask-${++cloneCount}`;
    const wrap = svg('g', { mask: `url(#${id})`, class: 'levelHidden' });
    const mask = svg('mask', { id, maskUnits: 'userSpaceOnUse', x: -sheet.width, y: -sheet.height, width: sheet.width * 3, height: sheet.height * 3 }, wrap);
    svg('rect', { x: -sheet.width, y: -sheet.height, width: sheet.width * 3, height: sheet.height * 3, fill: '#fff' }, mask);
    for (const hole of holes) svg('path', { d: pathData(hole, true), fill: '#000' }, mask);
    node.replaceWith(wrap);
    wrap.append(node);
    return wrap;
  }
  // Masks from the last draw, taken off before the next one (a partial road
  // render keeps the roads it didn't change).
  let masks = [];

  // Bridges over everything below them, lowest first. Returns where to draw
  // something on a road at a point: the group on its level, or null when that
  // level is hidden.
  let last = { sheet: null, gores: [], decks: [] };
  function draw(sheet, parent, { section, nodes, gores, pairOf, concrete, barrier }) {
    for (const wrap of masks) if (wrap.isConnected) wrap.replaceWith(...[...wrap.childNodes].filter(n => n.tagName !== 'mask'));
    masks = [];
    const roads = new Map(sheet.roads.map(road => [road.id, road]));
    sheet.bridges = (sheet.bridges ?? []).filter(b => roads.has(b.road));
    const cache = new Map(), geometryOf = id => cache.get(id) ?? cache.set(id, geometry(section, roads.get(id))).get(id);
    const shapes = gores.map(({ roads, outline }) => ({ roads, outline }));
    const decks = sheet.bridges.map(piece => deckOf(sheet, piece, { geometryOf, pairOf, gores: shapes }));
    last = { sheet, gores: shapes, decks };
    const top = Math.max(1, ...decks.map(d => d.piece.level), ...(sheet.intersections ?? []).map(item => item.level ?? 1));
    if (top === 1) return Object.assign(() => parent, { slot: () => parent, levelOf: () => 1 });
    const shown = shownLevels();
    // Hidden stretches: their roads and gores aren't drawn there on lower levels either.
    const hidden = decks.filter(d => d.piece.level > shown);
    const holes = new Map();
    for (const deck of hidden) {
      for (const id of deckRoads(deck)) holes.set(id, [...holes.get(id) ?? [], deck.clip]);
    }
    for (const [id, polygons] of holes) {
      const drawn = nodes.get(id);
      if (drawn) for (const node of [drawn.band, drawn.group]) masks.push(hide(node, polygons, sheet));
    }
    for (const gore of gores) {
      const polygons = hidden.filter(d => d.gores.some(g => g.outline === gore.outline)).map(d => d.clip);
      if (polygons.length) for (const node of gore.nodes) if (node.tagName !== 'clipPath') masks.push(hide(node, polygons, sheet));
    }
    // Level 1's markings, then each level's bridges and their markings.
    const slots = [];
    for (let level = 1; level <= shown; level++) {
      for (const deck of decks.filter(d => d.piece.level === level)) {
        const group = drawDeck(sheet, deck, decks, { nodes, gores, concrete, barrier }, parent);
        const over = hidden.filter(h => deckRoads(h).some(id => deckRoads(deck).includes(id))).map(h => h.clip);
        if (over.length) hide(group, over, sheet);
      }
      slots[level] = svg('g', { class: `level${level}` }, parent);
      slots[level].level = level;
    }
    // Something on an intersection is on that intersection's level.
    const levelAtPoint = (point, road, intersection) => intersection != null
      ? (sheet.intersections ?? []).find(item => item.id === intersection)?.level ?? 1 : levelOf(decks, point, road);
    return Object.assign((point, road, intersection) => {
      const level = levelAtPoint(point, road, intersection);
      return level > shown ? null : slots[level];
    }, { slot: level => (level > shown ? null : slots[level]), levelOf: levelAtPoint });
  }
  // Settings › High contrast on elevated levels: white lane lines on a bridge
  // deck get black contrast (FDOT Standard Plans 711-001 sheet 2): a 1.5" black
  // border on both sides of a solid line, and a 10' black dash right after each
  // white dash of a skip line. Edge lines and yellow lines get none.
  function withContrast(group, sheet) {
    if (!app.settings?.get('autoContrast')) return group;
    const border = 1.5 / sheet.inchesPerPixel;
    for (const path of [...group.querySelectorAll('path.roadMarking')]) {
      if (path.dataset.edge || path.getAttribute('stroke')?.toLowerCase() !== '#ffffff') continue;
      const black = path.cloneNode();
      black.setAttribute('stroke', '#000000');
      const dash = path.getAttribute('stroke-dasharray');
      if (dash) {
        const [on] = dash.split(/[ ,]+/).map(Number);
        black.setAttribute('stroke-dashoffset', (Number(path.getAttribute('stroke-dashoffset') ?? 0) - on).toFixed(2));
      } else black.setAttribute('stroke-width', (Number(path.getAttribute('stroke-width')) + 2 * border).toFixed(3));
      path.before(black);
    }
    return group;
  }
  function drawDeck(sheet, deck, decks, { nodes, gores, concrete, barrier }, parent) {
    const group = svg('g', { class: 'bridge' }, parent);
    const clipped = (polygon, into) => {
      const id = `bridge-clip-${++cloneCount}`;
      svg('path', { d: pathData(polygon, true) }, svg('clipPath', { id }, into));
      return svg('g', { 'clip-path': `url(#${id})` }, into);
    };
    const stretch = clipped(deck.clip, group);
    // The deck is concrete: each road's pavement, then its lines, as drawn.
    const pieces = [deck.g, deck.pg].filter(Boolean).map(x => ({ id: x.road.id, into: stretch }))
      .concat(deck.companions.map(c => ({ id: c.x.road.id, into: clipped(c.outline, stretch) })));
    // A slightly wide edge keeps the asphalt from showing where pieces meet.
    const pave = (d, into) => svg('path', { d, fill: concrete, stroke: concrete, 'stroke-width': '1.5' }, into);
    for (const { id, into } of pieces) {
      const drawn = nodes.get(id);
      if (drawn) pave(drawn.band.getAttribute('d'), into);
    }
    for (const gore of deck.gores) pave(`${pathData(gore.outline)}Z`, stretch);
    for (const { id, into } of pieces) {
      const drawn = nodes.get(id);
      if (drawn) into.append(withContrast(drawn.group.cloneNode(true), sheet));
    }
    for (const gore of gores.filter(item => deck.gores.some(near => near.outline === item.outline))) {
      for (const node of gore.nodes) if (!node.classList?.contains('goreBand') && !node.classList?.contains('roadOutline')) stretch.append(copy(node));
    }
    for (const run of deck.barriers) svg('path', { d: pathData(run), fill: 'none', stroke: barrier, 'stroke-width': deck.barrier.toFixed(2) }, stretch);
    // End lines span the deck's pavement (drawn once per paved area, since a
    // download clips by each path of a clip in turn).
    for (const line of deck.lines) {
      if (carriedOn(deck, line, decks)) continue;
      for (const poly of deck.paved) {
        svg('path', { d: pathData([line.from, line.to]), fill: 'none', stroke: END_LINE, 'stroke-width': (END_LINE_INCHES / sheet.inchesPerPixel).toFixed(2) }, clipped(poly, group));
      }
    }
    return group;
  }
  // Whether a road is drawn at a point (not on a hidden level), and the level.
  const levelAt = (sheet, point, road) => (last.sheet === sheet ? levelOf(last.decks, point, road) : 1);
  const shownAt = (sheet, point, road) => levelAt(sheet, point, road) <= shownLevels();
  // Downloads draw every level.
  function showingAll(run) {
    exporting = true;
    app.roadEditor.render();
    const done = () => { exporting = false; app.roadEditor.render(); };
    return Promise.resolve().then(run).finally(done);
  }

  // Cutting a road keeps its bridges where they are: before the cut, sample
  // each bridge along its road; afterward, each piece of that road takes the
  // samples on it (a bridge across the cut becomes one on each piece).
  function capture(sheet, ids, section) {
    const roads = sheet.roads.filter(road => ids.includes(road.id));
    return (sheet.bridges ?? []).filter(b => roads.some(road => road.id === b.road)).map(bridge => {
      const g = geometry(section, roads.find(road => road.id === bridge.road));
      const samples = [];
      for (let s = bridge.from * g.length; s < bridge.to * g.length; s += ppf(sheet)) samples.push(pointAt(g.line, g.along, s));
      samples.push(pointAt(g.line, g.along, bridge.to * g.length));
      return { bridge, samples };
    });
  }
  function rehome(sheet, captured, groups, section) {
    if (!captured?.length) return;
    const tolerance = ppf(sheet);
    for (const { bridge, samples } of captured) {
      sheet.bridges = sheet.bridges.filter(b => b !== bridge);
      const pieces = groups.find(group => group.includes(bridge.road)) ?? [];
      let first = true;
      for (const id of pieces) {
        const road = sheet.roads.find(r => r.id === id);
        if (!road) continue;
        const g = geometry(section, road);
        const on = samples.map(p => project(g.line, g.along, p)).filter(p => p.distance <= tolerance).map(p => p.s);
        if (on.length < 2 || Math.max(...on) - Math.min(...on) < tolerance) continue;
        sheet.bridges.push({ ...bridge, id: first ? bridge.id : crypto.randomUUID(), span: spanOf(bridge), road: id,
          from: Math.max(0, Math.min(...on) / g.length), to: Math.min(1, Math.max(...on) / g.length) });
        first = false;
      }
    }
  }

  // The roads a drag can carry a bridge on through: each road joined end to
  // start, going with traffic (+1) or against it (-1), but not the other side
  // of a two-way road, which shares its joints.
  function joined(sheet, road, way, pairOf) {
    const joint = road.ends[way > 0 ? 1 : 0].joint, partner = pairOf(road);
    return sheet.roads.filter(other => other !== road && other !== partner && other.ends[way > 0 ? 0 : 1].joint === joint);
  }
  // The roads from `start` to `target` through joined roads, nearest first, and
  // which way they go; null when target isn't reachable.
  function route(sheet, start, target, pairOf) {
    if (start === target) return { roads: [start], way: 1 };
    for (const way of [1, -1]) {
      const parent = new Map([[start, null]]), queue = [start];
      while (queue.length && parent.size < 500) {
        const road = queue.shift();
        for (const next of joined(sheet, road, way, pairOf)) {
          if (parent.has(next)) continue;
          parent.set(next, road);
          if (next === target) {
            const roads = [];
            for (let r = target; r; r = parent.get(r)) roads.unshift(r);
            return { roads, way };
          }
          queue.push(next);
        }
      }
    }
    return null;
  }

  // Grade separation at a crossing (right-click Grade Separate): a bridge on
  // `over` spanning `under`'s full pavement plus a schematic 25 ft each side, a
  // level above anything along it, its ends turned parallel to `under`.
  const SEPARATION_CLEAR_FEET = 25;
  function separate(sheet, over, under, point, section, pairOf) {
    const g = geometry(section, over), u = geometry(section, under), partner = pairOf(under);
    const s = project(g.line, g.along, point).s, t = pointAt(g.line, g.along, s).t;
    const tu = pointAt(u.line, u.along, project(u.line, u.along, point).s).t;
    const sin = Math.max(0.25, Math.abs(t.x * tu.y - t.y * tu.x));
    const far = partner ? geometry(section, partner).right : u.left;
    const width = [u.right, far].reduce((sum, edge) => sum + project(edge, measure(edge), point).distance, 0);
    const half = width / sin / 2 + SEPARATION_CLEAR_FEET * ppf(sheet);
    const from = Math.max(0, (s - half) / g.length), to = Math.min(1, (s + half) / g.length);
    const n = { x: -t.y, y: t.x };
    let skew = Math.atan2(tu.x * t.x + tu.y * t.y, tu.x * n.x + tu.y * n.y) * 180 / Math.PI;
    if (skew > 90) skew -= 180; else if (skew < -90) skew += 180;
    skew = Math.round(Math.max(-60, Math.min(60, skew)));
    const decks = last.sheet === sheet ? last.decks : [];
    let level = 1;
    for (let f = from; f <= to; f += ppf(sheet) / g.length) level = Math.max(level, levelOf(decks, pointAt(g.line, g.along, f * g.length)));
    const id = crypto.randomUUID();
    const piece = { id, span: id, road: over.id, from, to, level: Math.min(LEVELS, level + 1), skew };
    (sheet.bridges ??= []).push(piece);
    return piece;
  }

  app.levels = { draw, capture, rehome, levelColor, levelAt, shownAt, showingAll, separate };

  document.addEventListener('DOMContentLoaded', () => {
    const sheets = app.sheets;
    const get = id => document.getElementById(id);
    const workspace = get('workspace'), panel = get('levelsEditor');
    const overlay = document.createElement('div');
    overlay.className = 'markingOverlay levelOverlay';
    sheets.addOverlay(overlay);
    let selected = null, drag = null, hover = false;

    const active = () => !panel.hidden && Boolean(sheets.selected?.inchesPerPixel);
    // The selected bridge's pieces, in the order traffic crosses them.
    const current = () => (sheets.selected?.bridges ?? []).filter(b => spanOf(b) === selected);
    const tell = text => { get('levelsStatus').textContent = text; };
    const HINT = 'Drag along a road to put that stretch on a bridge a level up (up to 10); keep dragging to carry it on through joined roads. Click a bridge to select it.';
    const pairOf = road => app.roadEditor.pairOf(sheets.selected, road);
    const geometries = () => {
      const sheet = sheets.selected, section = app.roadEditor.crossSection(sheet);
      return new Map(sheet.roads.map(road => [road.id, geometry(section, road)]));
    };
    // A point on a road's pavement, or on its two-way partner's (they share a
    // centerline, so either side's point measures along the road).
    const onRoad = (all, g, point) => inside(point, g.outline) || Boolean(pairOf(g.road) && inside(point, all.get(pairOf(g.road).id)?.outline ?? []));

    // Every bridge piece's deck, from the last render's gores.
    function decks(all = geometries(), extra = []) {
      const sheet = sheets.selected, gores = last.sheet === sheet ? last.gores : [];
      const ctx = { geometryOf: id => all.get(id), pairOf, gores };
      return [...sheet.bridges ?? [], ...extra].filter(piece => all.has(piece.road)).map(piece => deckOf(sheet, piece, ctx));
    }
    const levelHere = (decks, p, road) => levelOf(decks, p, road?.id);
    // Decks on levels drawn now (Settings › Hide levels above).
    const visible = list => list.filter(d => d.piece.level <= shownLevels() || d.piece.span === 'preview');
    // The road on top at a point: the highest level there, then the one drawn last.
    function topAt(point, all = geometries(), found = null) {
      let best = null;
      for (const g of all.values()) {
        if (!inside(point, g.outline)) continue;
        const level = levelHere(found ??= visible(decks(all)), point, g.road);
        if (!best || level >= best.level) best = { g, s: project(g.line, g.along, point).s, level };
      }
      return best;
    }
    // The bridge piece on top at a point.
    function bridgeAt(point) {
      let best = null;
      for (const deck of visible(decks())) if (onDeck(deck, point) && (!best || deck.piece.level >= best.level)) best = deck.piece;
      return best;
    }
    // An end of a piece is one of the bridge's ends unless another piece of the
    // same bridge carries on from it across the joint.
    function outerEnds(pieces) {
      const roadOf = id => sheets.selected.roads.find(r => r.id === id);
      // Does another piece pick up where this piece's end `e` meets its road's end?
      const carried = (piece, e) => {
        const road = roadOf(piece.road);
        if (!road || (e ? piece.to < 1 - 1e-6 : piece.from > 1e-6)) return false;
        return pieces.some(other => {
          const next = other !== piece && roadOf(other.road);
          if (!next) return false;
          return e ? other.from <= 1e-6 && next.ends[0].joint === road.ends[1].joint
            : other.to >= 1 - 1e-6 && next.ends[1].joint === road.ends[0].joint;
        });
      };
      return pieces.flatMap(piece => ['from', 'to'].filter((end, e) => !carried(piece, e)).map(end => ({ piece, end })));
    }

    function refreshOverlay() {
      overlay.replaceChildren();
      const sheet = sheets.selected;
      if (!active()) return;
      const root = svg('svg', { 'aria-hidden': 'true' }, overlay);
      const view = svg('g', { transform: `translate(${sheet.view.x} ${sheet.view.y}) scale(${sheet.view.scale})` }, root);
      const all = geometries();
      // Every road's pavement in its level's color: level 1 under everything,
      // then each bridge (and the one being dragged) clipped to its stretch.
      // Hidden levels' stretches aren't tinted on the roads below either.
      const hiddenDecks = decks(all).filter(d => d.piece.level > shownLevels());
      for (const g of all.values()) {
        const tint = svg('path', { d: pathData(g.outline, true), class: 'levelPath', fill: levelColor(1) }, view);
        const holes = hiddenDecks.filter(d => deckRoads(d).includes(g.road.id)).map(d => d.clip);
        if (holes.length) hide(tint, holes, sheet);
      }
      for (const item of sheets.selected.intersections ?? []) {
        if ((item.level ?? 1) > shownLevels()) continue;
        const outline = app.intersections.outlineOf(sheet, item);
        svg('path', { d: pathData(outline, true), class: 'levelPath', fill: levelColor(item.level ?? 1) }, view);
        if (item.id === selectedItem) svg('path', { d: pathData(outline, true), class: 'lineSelected', 'vector-effect': 'non-scaling-stroke' }, view);
      }
      const chosen = drag?.preview ?? current();
      const outer = outerEnds(chosen);
      let n = 0;
      for (const deck of visible(decks(all, drag?.preview ?? [])).sort((a, b) => a.piece.level - b.piece.level)) {
        const id = `level-clip-${n++}`;
        svg('path', { d: pathData(deck.clip, true) }, svg('clipPath', { id }, view));
        const group = svg('g', { 'clip-path': `url(#${id})` }, view);
        for (const poly of deck.paved) svg('path', { d: pathData(poly, true), class: 'levelPath', fill: levelColor(deck.piece.level) }, group);
        if (!chosen.includes(deck.piece)) continue;
        const pavedId = `level-clip-${n++}`, pavedClip = svg('clipPath', { id: pavedId }, view);
        for (const poly of deck.paved) svg('path', { d: pathData(poly, true) }, pavedClip);
        const ends = svg('g', { 'clip-path': `url(#${pavedId})` }, view);
        deck.lines.forEach((line, e) => {
          if (outer.some(o => o.piece === deck.piece && o.end === (e ? 'to' : 'from'))) svg('path', { d: pathData([line.from, line.to]), class: 'lineSelected', 'vector-effect': 'non-scaling-stroke' }, ends);
        });
      }
      if (drag?.preview) return;
      for (const { piece, end } of outer) {
        const g = all.get(piece.road);
        if (!g) continue;
        const p = sheets.toScreen(pointAt(g.line, g.along, piece[end] * g.length));
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'markingHandle'; b.dataset.end = end; b.dataset.piece = piece.id;
        b.setAttribute('aria-label', `Bridge ${end === 'from' ? 'start' : 'end'}. Drag along the road, or use the arrow keys (Shift for 10 ft); Delete removes the bridge.`);
        b.title = `Bridge ${end === 'from' ? 'start' : 'end'}`;
        Object.assign(b.style, { left: `${p.x}px`, top: `${p.y}px` });
        overlay.append(b);
      }
    }

    function changed(message) {
      app.roadEditor.render();
      sheets.save(sheets.selected);
      app.history.record();
      updatePanel();
      refreshOverlay();
      if (message) tell(message);
    }
    function select(span) { selected = span; selectedItem = null; updatePanel(); refreshOverlay(); }
    // Intersections have a level too (Intersection › Level in this panel).
    let selectedItem = null;
    const currentItem = () => (sheets.selected?.intersections ?? []).find(item => item.id === selectedItem) ?? null;
    function intersectionAt(point) {
      const items = [...(sheets.selected?.intersections ?? [])].filter(item => (item.level ?? 1) <= shownLevels()).reverse();
      return items.find(item => inside(point, app.intersections.outlineOf(sheets.selected, item))) ?? null;
    }
    function selectIntersection(id) { selected = null; selectedItem = id; updatePanel(); refreshOverlay(); }
    get('intersectionLevel').addEventListener('input', event => {
      const item = currentItem(), level = Number(event.target.value);
      if (!item || !Number.isInteger(level) || level < 1 || level > LEVELS) return;
      if (level === 1) delete item.level; else item.level = level;
      changed(`${item.name} is on level ${level}.`);
    });
    function remove() {
      const sheet = sheets.selected;
      if (!current().length) return;
      sheet.bridges = sheet.bridges.filter(b => spanOf(b) !== selected);
      selected = null;
      changed('Bridge removed.');
    }

    // Dragging along a road: the stretch from the press to the pointer, a level
    // above what the press was on, through every road joined between them.
    const pointOf = event => sheets.toImage(event.clientX, event.clientY);
    function stretch(d, point) {
      const sheet = sheets.selected, all = geometries();
      // The road under the pointer the drag can reach, nearest along the roads first.
      let target = d.g, path = { roads: [d.g.road], way: 1 };
      if (!onRoad(all, d.g, point)) {
        let best = null;
        for (const g of all.values()) {
          if (!onRoad(all, g, point)) continue;
          const found = route(sheet, d.g.road, g.road, pairOf);
          if (found && (!best || found.roads.length < best.path.roads.length)) best = { g, path: found };
        }
        if (best) ({ g: target, path } = best);
      }
      const end = Math.max(0, Math.min(target.length, project(target.line, target.along, point).s));
      const span = 'preview';
      let level = 0;
      const piece = (road, from, to) => ({ id: `preview-${road.id}`, span, road: road.id, from, to, level, skew: 0 });
      const pieces = path.roads.length === 1 ? [piece(d.g.road, Math.min(d.s, end) / d.g.length, Math.max(d.s, end) / d.g.length)]
        : path.roads.map((road, i) => {
          const first = i === 0, final = i === path.roads.length - 1;
          if (path.way > 0) return piece(road, first ? d.s / d.g.length : 0, final ? end / target.length : 1);
          return piece(road, final ? end / target.length : 0, first ? d.s / d.g.length : 1);
        });
      // A level above anything along the way: the road's own bridges and every
      // bridge it crosses.
      level = Math.min(LEVELS + 1, 1 + Math.max(...pieces.flatMap(p => {
        const g = all.get(p.road), out = [];
        for (let s = p.from * g.length; s <= p.to * g.length; s += 5 * ppf(sheet)) out.push(levelHere(d.decks, pointAt(g.line, g.along, s)));
        out.push(levelHere(d.decks, pointAt(g.line, g.along, p.to * g.length)));
        return out;
      })));
      pieces.forEach(p => { p.level = level; });
      return pieces;
    }
    const lengthOf = (pieces, all = geometries()) => pieces.reduce((sum, p) => sum + (p.to - p.from) * (all.get(p.road)?.length ?? 0), 0);
    workspace.addEventListener('pointerdown', event => {
      if (!active() || event.button !== 0 || !event.isPrimary || event.target.closest('.levelOverlay button')) return;
      const top = topAt(pointOf(event));
      if (!top) {
        // An intersection is selected with a click; off everything, a drag pans.
        const item = intersectionAt(pointOf(event));
        if (!item) return;
        event.preventDefault(); event.stopImmediatePropagation();
        selectIntersection(item.id);
        return;
      }
      event.preventDefault(); event.stopImmediatePropagation();
      drag = { pointer: event.pointerId, ...top, decks: decks(), x: event.clientX, y: event.clientY, moved: false };
      workspace.setPointerCapture(event.pointerId);
    }, true);
    workspace.addEventListener('pointermove', event => {
      if (!active()) return;
      if (drag && event.pointerId === drag.pointer && !drag.handle) {
        if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > CLICK_PIXELS) drag.moved = true;
        if (drag.moved) drag.preview = stretch(drag, pointOf(event));
        refreshOverlay();
        return;
      }
      const over = Boolean(topAt(pointOf(event)));
      if (over !== hover) workspace.classList.toggle('markingPlacing', (hover = over));
    }, true);
    workspace.addEventListener('pointerleave', () => { hover = false; workspace.classList.remove('markingPlacing'); });
    workspace.addEventListener('pointerup', event => {
      if (!drag || event.pointerId !== drag.pointer || drag.handle) return;
      const d = drag, sheet = sheets.selected;
      drag = null;
      if (workspace.hasPointerCapture(event.pointerId)) workspace.releasePointerCapture(event.pointerId);
      const made = d.moved ? stretch(d, pointOf(event)) : [];
      if (!made.length || lengthOf(made) < MIN_FEET * ppf(sheet)) {
        // A click selects the bridge on top there, or the intersection.
        const hit = bridgeAt(pointOf(event)), item = !hit && intersectionAt(pointOf(event));
        if (item) selectIntersection(item.id);
        else select(hit ? spanOf(hit) : null);
        return;
      }
      if (made[0].level > LEVELS) { refreshOverlay(); tell(`Level ${LEVELS} is the highest.`); return; }
      const span = crypto.randomUUID();
      made.forEach((piece, i) => Object.assign(piece, { id: i ? crypto.randomUUID() : span, span }));
      (sheet.bridges ??= []).push(...made.filter(p => p.to - p.from > 1e-6));
      selected = span;
      changed(`Bridge added on level ${made[0].level}${made.length > 1 ? ` across ${made.length} roads` : ''}${made[0].level > shownLevels() ? ' (hidden in Settings)' : ''}.`);
    }, true);
    workspace.addEventListener('pointercancel', event => {
      if (drag && event.pointerId === drag.pointer && !drag.handle) { drag = null; refreshOverlay(); }
    }, true);
    // Double-clicking a road here doesn't open the Elements editor.
    workspace.addEventListener('dblclick', event => {
      if (active() && topAt(pointOf(event))) { event.preventDefault(); event.stopImmediatePropagation(); }
    }, true);

    // End handles: drag along the piece's road or nudge with the arrow keys.
    // An end stays at least a foot short of its piece's other end.
    const pieceOf = handle => current().find(p => p.id === handle.dataset.piece);
    const geometryOf = piece => geometries().get(piece.road);
    function setEnd(piece, end, s, g) {
      const gap = ppf(sheets.selected) / g.length;
      piece[end] = end === 'from' ? Math.max(0, Math.min(piece.to - gap, s / g.length)) : Math.min(1, Math.max(piece.from + gap, s / g.length));
    }
    overlay.addEventListener('pointerdown', event => {
      const handle = event.target.closest('button[data-end]'), piece = handle && pieceOf(handle);
      if (!piece || event.button !== 0) return;
      event.preventDefault(); event.stopPropagation();
      drag = { pointer: event.pointerId, handle, piece, end: handle.dataset.end, before: structuredClone(piece), moved: false };
      handle.setPointerCapture(event.pointerId);
      handle.focus({ preventScroll: true });
    });
    overlay.addEventListener('pointermove', event => {
      if (!drag?.handle || event.pointerId !== drag.pointer) return;
      const g = geometryOf(drag.piece);
      if (!g) return;
      drag.moved = true;
      setEnd(drag.piece, drag.end, project(g.line, g.along, pointOf(event)).s, g);
      app.roadEditor.renderLater();
      const p = sheets.toScreen(pointAt(g.line, g.along, drag.piece[drag.end] * g.length));
      Object.assign(drag.handle.style, { left: `${p.x}px`, top: `${p.y}px` });
      updatePanel();
    });
    function endHandle(event, cancel) {
      if (!drag?.handle || event.pointerId !== drag.pointer) return;
      const d = drag;
      drag = null;
      if (cancel) Object.assign(d.piece, d.before);
      if (d.handle.hasPointerCapture(event.pointerId)) d.handle.releasePointerCapture(event.pointerId);
      if (d.moved) changed(); else refreshOverlay();
      overlay.querySelector(`button[data-piece="${d.piece.id}"][data-end="${d.end}"]`)?.focus({ preventScroll: true });
    }
    overlay.addEventListener('pointerup', event => endHandle(event, false));
    overlay.addEventListener('pointercancel', event => endHandle(event, true));
    overlay.addEventListener('click', event => event.stopPropagation());
    overlay.addEventListener('keydown', event => {
      const handle = event.target.closest('button[data-end]'), piece = handle && pieceOf(handle);
      if (!piece) return;
      if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); event.stopPropagation(); remove(); return; }
      const dir = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[event.key];
      const g = geometryOf(piece);
      if (!dir || !g) return;
      event.preventDefault(); event.stopPropagation();
      setEnd(piece, handle.dataset.end, piece[handle.dataset.end] * g.length + dir * (event.shiftKey ? 10 : 1) * ppf(sheets.selected), g);
      changed();
      overlay.querySelector(`button[data-piece="${piece.id}"][data-end="${handle.dataset.end}"]`)?.focus({ preventScroll: true });
    });
    document.addEventListener('keydown', event => {
      if (panel.hidden || event.target.closest('input,select,textarea,dialog')) return;
      if ((event.key === 'Delete' || event.key === 'Backspace') && current().length) { event.preventDefault(); remove(); }
      else if (event.key === 'Escape' && (current().length || selectedItem)) { event.preventDefault(); event.stopImmediatePropagation(); select(null); }
    }, true);

    // Panel: level and skew apply to every piece of the bridge.
    get('bridgeLevel').addEventListener('input', event => {
      const pieces = current(), level = Number(event.target.value);
      if (!pieces.length || !Number.isInteger(level) || level < 2 || level > LEVELS) return;
      pieces.forEach(piece => { piece.level = level; });
      changed();
    });
    for (const id of ['bridgeSkew', 'bridgeSkewValue']) get(id).addEventListener('input', event => {
      const pieces = current(), skew = Number(event.target.value);
      if (!pieces.length || event.target.value === '' || !(skew >= -60 && skew <= 60)) return;
      pieces.forEach(piece => { piece.skew = skew; });
      changed();
    });
    get('removeBridge').addEventListener('click', remove);
    function updatePanel() {
      const sheet = sheets.selected, pieces = current(), item = currentItem();
      get('levelIntersectionFields').hidden = !item || panel.hidden;
      if (item) {
        get('levelIntersectionTitle').textContent = `${item.name} (level ${item.level ?? 1})`;
        if (document.activeElement !== get('intersectionLevel')) get('intersectionLevel').value = String(item.level ?? 1);
      }
      get('bridgeFields').hidden = !pieces.length || panel.hidden;
      if (pieces.length) {
        const [first] = pieces;
        get('bridgeTitle').textContent = `Bridge (level ${first.level})`;
        get('bridgeLength').textContent = `${Math.round(lengthOf(pieces) / ppf(sheet))} ft long${pieces.length > 1 ? `, across ${pieces.length} roads` : ''}.`;
        if (document.activeElement !== get('bridgeLevel')) get('bridgeLevel').value = String(first.level);
        for (const id of ['bridgeSkew', 'bridgeSkewValue']) if (document.activeElement !== get(id)) get(id).value = String(first.skew ?? 0);
      }
      const shown = shownLevels();
      get('levelsHidden').hidden = shown >= LEVELS;
      get('levelsHidden').textContent = `Levels above ${shown} are hidden (Settings › Hide levels above).`;
      if (!sheet) tell('Upload a sheet first.');
      else if (!sheet.inchesPerPixel) tell('Set the sheet’s scale (Sheets › Set Scale) to grade roads.');
      else if (!get('levelsStatus').textContent || /^(Upload|Set the)/.test(get('levelsStatus').textContent)) tell(HINT);
    }

    new MutationObserver(() => {
      if (panel.hidden) { drag = null; hover = false; workspace.classList.remove('markingPlacing'); }
      updatePanel(); refreshOverlay();
    }).observe(panel, { attributes: true, attributeFilter: ['hidden'] });
    document.addEventListener('sheetview', refreshOverlay);
    document.addEventListener('settingschange', updatePanel);
    for (const event of ['sheetchange', 'sheethistory']) document.addEventListener(event, () => {
      drag = null;
      if (!current().length) selected = null;
      updatePanel(); refreshOverlay();
    });
    Object.assign(app.levels, { refreshOverlay });
    updatePanel();
  });
})();
