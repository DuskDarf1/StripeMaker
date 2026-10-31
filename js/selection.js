/* Selection mode (the Select toolbar button), copy and paste, and right-click
   actions for everything on the sheet.

   In selection mode a click selects what's under the pointer, Shift-click adds
   or removes it, and dragging empty sheet draws a box that selects everything
   inside it (Shift adds). Dragging a selected item, or the arrow keys, move the
   whole selection.
   Everything selected is copied: roads (with both sides of a two-way road, the
   joints between them, their gores, bridges, markings, and lines),
   intersections, medians, lateral markings, longitudinal lines, and signs.
   Pasting puts the copy under the pointer with new ids, as one undo step.
   Right-clicking anything (in any panel) opens a menu of actions for it. */
(() => {
  const SVG = 'http://www.w3.org/2000/svg';
  const KINDS = ['roads', 'intersections', 'medians', 'markings', 'lines', 'surfaces', 'signs'];
  const NAMES = { roads: 'road', intersections: 'intersection', medians: 'median', markings: 'marking', lines: 'line', surfaces: 'colored pavement', signs: 'sign' };
  const PICK_PIXELS = 6, DRAG_PIXELS = 4, PASTE_OFFSET_FEET = 40;
  const app = window.StripeMaker ??= {};
  let clipboard = null;

  const svg = (tag, attrs, parent) => {
    const e = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    parent?.append(e);
    return e;
  };
  const pathData = (points, close) => `M${points.map(p => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join('L')}${close ? 'Z' : ''}`;
  const inside = (p, poly) => {
    let hit = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) hit = !hit;
    }
    return hit;
  };
  const clone = value => structuredClone(value);
  const nextNumber = list => Math.max(0, ...list.map(item => (typeof item.id === 'number' ? item.id : 0))) + 1;

  document.addEventListener('DOMContentLoaded', () => {
    const sheets = app.sheets;
    const get = id => document.getElementById(id);
    const workspace = get('workspace'), panel = get('selectEditor'), menu = get('itemMenu');
    const overlay = document.createElement('div');
    overlay.className = 'markingOverlay selectOverlay';
    sheets.addOverlay(overlay);
    const selection = new Map(KINDS.map(kind => [kind, new Set()]));
    let drag = null, pointer = null;

    const active = () => !panel.hidden;
    const sheet = () => sheets.selected;
    const ready = () => Boolean(sheet()?.inchesPerPixel);
    const total = () => KINDS.reduce((sum, kind) => sum + selection.get(kind).size, 0);
    const ppf = () => 12 / sheet().inchesPerPixel;
    const tell = text => { get('selectStatus').textContent = text; };
    const roadOf = id => sheet().roads.find(road => road.id === id);
    const records = kind => (kind === 'roads' ? sheet().roads : sheet()[kind] ?? []);
    const recordOf = (kind, id) => records(kind).find(item => item.id === id);

    // What's at a point: the item on top, smallest kinds first.
    function itemAt(point) {
      const s = sheet();
      if (!s?.inchesPerPixel) return null;
      for (const sign of [...(s.signs ?? [])].reverse()) {
        const box = app.signs?.box(sign);
        if (!box) continue;
        const a = -box.rotation * Math.PI / 180, dx = point.x - box.x, dy = point.y - box.y;
        const x = dx * Math.cos(a) - dy * Math.sin(a), y = dx * Math.sin(a) + dy * Math.cos(a);
        if (Math.abs(x) <= box.width / 2 && Math.abs(y) <= box.height / 2) return { kind: 'signs', id: sign.id };
      }
      const marking = app.markings?.hitAt(point);
      if (marking) return { kind: 'markings', id: marking };
      const line = app.longitudinal?.lineAt(point, PICK_PIXELS / s.view.scale);
      if (line) return { kind: 'lines', id: line.id };
      for (const surface of [...(s.surfaces ?? [])].reverse()) {
        if (shapes('surfaces', surface.id).some(shape => inside(point, shape))) return { kind: 'surfaces', id: surface.id };
      }
      for (const item of [...(s.intersections ?? [])].reverse()) {
        if (inside(point, app.intersections.outlineOf(s, item))) return { kind: 'intersections', id: item.id };
      }
      const median = app.roadEditor.medianAt(s, point);
      if (median != null) return { kind: 'medians', id: median };
      const road = app.roadEditor.roadAt(s, point);
      if (road) return { kind: 'roads', id: road.id };
      return null;
    }
    // Shapes that stand for an item: its outline(s), for highlighting and box selection.
    function shapes(kind, id) {
      const s = sheet(), item = recordOf(kind, id);
      if (!item) return [];
      if (kind === 'roads') return [app.roadEditor.outline(s, item)];
      if (kind === 'intersections') return [app.intersections.outlineOf(s, item)];
      if (kind === 'medians') return [item.points];
      if (kind === 'markings') return app.markings.outlines(id);
      if (kind === 'lines') return [app.longitudinal.pathOf(item)].filter(p => p.length);
      if (kind === 'surfaces') {
        const road = roadOf(item.on.road);
        return road ? [app.roadEditor.laneStrip(s, road, item.on.lane, item.from, item.to)] : [];
      }
      const box = app.signs?.box(item);
      if (!box) return [];
      const a = box.rotation * Math.PI / 180, c = Math.cos(a), sn = Math.sin(a);
      return [[[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => {
        const lx = x * box.width / 2, ly = y * box.height / 2;
        return { x: box.x + lx * c - ly * sn, y: box.y + lx * sn + ly * c };
      })];
    }
    // Both sides of a two-way road go together.
    function withPartners(ids) {
      const out = new Set(ids);
      for (const id of ids) {
        const partner = app.roadEditor.pairOf(sheet(), roadOf(id));
        if (partner) out.add(partner.id);
      }
      return out;
    }
    function setSelection(items, add = false) {
      if (!add) for (const kind of KINDS) selection.get(kind).clear();
      for (const { kind, id } of items) selection.get(kind).add(id);
      selection.set('roads', withPartners(selection.get('roads')));
      refresh();
    }
    function toggle(item) {
      const set = selection.get(item.kind);
      const ids = item.kind === 'roads' ? withPartners([item.id]) : new Set([item.id]);
      const on = !set.has(item.id);
      for (const id of ids) on ? set.add(id) : set.delete(id);
      refresh();
    }
    const selected = item => selection.get(item.kind).has(item.id);
    function selectAll() {
      setSelection(KINDS.flatMap(kind => records(kind).map(item => ({ kind, id: item.id }))));
    }
    // Keeps only items that still exist (after undo, deletes, and sheet changes).
    function prune() {
      if (!sheet()) return KINDS.forEach(kind => selection.get(kind).clear());
      for (const kind of KINDS) {
        const ids = new Set(records(kind).map(item => item.id));
        for (const id of selection.get(kind)) if (!ids.has(id)) selection.get(kind).delete(id);
      }
    }

    // Copying: everything selected, with what it depends on.
    function gather(items = selection) {
      const s = sheet(), ids = kind => items.get(kind) ?? new Set();
      const roadIds = withPartners(ids('roads')), interIds = ids('intersections');
      const roads = s.roads.filter(road => roadIds.has(road.id)).map(clone);
      const jointIds = new Set(roads.flatMap(road => road.ends.map(end => end.joint)));
      const joints = s.joints.filter(joint => jointIds.has(joint.id)).map(joint => {
        const copy = clone(joint);
        copy.links = copy.links.filter(link => roadIds.has(link.a) && roadIds.has(link.b));
        if (!roadIds.has(copy.root)) copy.root = roads.find(road => road.ends.some(end => end.joint === joint.id))?.id;
        return copy;
      });
      const endRoad = end => Number(end.split(':')[0]);
      const gores = (s.gores ?? []).filter(g => g.key.split('|').every(end => roadIds.has(endRoad(end)))).map(clone);
      const bridges = (s.bridges ?? []).filter(b => roadIds.has(b.road)).map(clone);
      const intersections = (s.intersections ?? []).filter(item => interIds.has(item.id)).map(item => {
        const copy = clone(item);
        for (const a of copy.approaches) {
          if (a.binding && !roadIds.has(a.binding.road)) delete a.binding;
          if (a.links) a.links = a.links.filter(link => roadIds.has(link.road));
        }
        return copy;
      });
      const onCopied = on => on && (roadIds.has(on.road) || interIds.has(on.intersection));
      const markings = (s.markings ?? []).filter(m => ids('markings').has(m.id) || onCopied(m.on)
        || (onCopied(m.a?.on) && onCopied(m.b?.on))).map(clone);
      const lines = (s.lines ?? []).filter(l => ids('lines').has(l.id) || onCopied(l.on)).map(clone);
      const goreKeys = new Set(gores.map(g => g.key));
      const medians = (s.medians ?? []).filter(m => ids('medians').has(m.id)).map(median => {
        const copy = clone(median);
        for (const p of copy.points) {
          if(p.on?.crossing&&!(roadIds.has(p.on.crossing.road)||interIds.has(p.on.crossing.intersection)||goreKeys.has(p.on.crossing.gore)))delete p.on.crossing;
          if (p.on && !(roadIds.has(p.on.road) || interIds.has(p.on.intersection) || goreKeys.has(p.on.gore))) delete p.on;
        }
        return copy;
      });
      const signs = (s.signs ?? []).filter(sign => ids('signs').has(sign.id)).map(clone);
      const surfaces = (s.surfaces ?? []).filter(x => ids('surfaces').has(x.id) || roadIds.has(x.on.road)).map(clone);
      // Markings and lines copied without their road are pasted onto the lane under the pointer.
      const loose = {
        markings: markings.filter(m => !onCopied(m.on) && !(m.a?.on && roadIds.has(m.a.on.road))),
        lines: lines.filter(l => !onCopied(l.on)),
      };
      const points = [...joints, ...intersections, ...medians.flatMap(m => m.points), ...signs];
      const center = points.length ? { x: points.reduce((t, p) => t + p.x, 0) / points.length, y: points.reduce((t, p) => t + p.y, 0) / points.length } : null;
      return { roads, joints, gores, bridges, intersections, markings, lines, medians, signs, surfaces, loose, center, inchesPerPixel: s.inchesPerPixel };
    }
    function copy() {
      if (!total()) return tell('Select something to copy.');
      clipboard = gather();
      tell(`Copied ${describe()}.`);
      refreshPanel();
    }
    function describe(counts = Object.fromEntries(KINDS.map(kind => [kind, selection.get(kind).size]))) {
      const parts = KINDS.filter(kind => counts[kind]).map(kind => `${counts[kind]} ${NAMES[kind]}${counts[kind] > 1 ? 's' : ''}`);
      return parts.join(', ') || 'nothing';
    }

    // Pasting: new ids everywhere, moved so the copy's center is at `at`.
    function paste(at = null, data = clipboard) {
      const s = sheet();
      if (!data || !s?.inchesPerPixel) return tell(data ? 'Set the sheet’s scale to paste here.' : 'Nothing copied yet.');
      const c = clone(data);
      const k = s.inchesPerPixel / (c.inchesPerPixel || s.inchesPerPixel);   // sheet pixels differ between sheets
      const scaleBack = p => (k === 1 ? p : { x: p.x / k, y: p.y / k });
      const center = c.center && scaleBack(c.center);
      const offset = center && at ? { x: at.x - center.x, y: at.y - center.y }
        : { x: PASTE_OFFSET_FEET * ppf(), y: PASTE_OFFSET_FEET * ppf() };
      const move = p => { const q = scaleBack(p); p.x = q.x + offset.x; p.y = q.y + offset.y; };
      const uuid = () => crypto.randomUUID();
      // Roads and joints.
      const roadMap = new Map(), jointMap = new Map();
      let nextRoad = nextNumber(s.roads), nextJoint = nextNumber(s.joints);
      for (const road of c.roads) roadMap.set(road.id, nextRoad++);
      for (const joint of c.joints) jointMap.set(joint.id, nextJoint++);
      for (const road of c.roads) {
        road.id = roadMap.get(road.id);
        for (const end of road.ends) end.joint = jointMap.get(end.joint);
      }
      for (const joint of c.joints) {
        joint.id = jointMap.get(joint.id);
        move(joint);
        joint.root = roadMap.get(joint.root) ?? c.roads.find(road => road.ends.some(end => end.joint === joint.id))?.id;
        for (const link of joint.links) { link.a = roadMap.get(link.a); link.b = roadMap.get(link.b); }
      }
      const remapEnd = end => { const [road, e] = end.split(':'); return `${roadMap.get(Number(road))}:${e}`; };
      const goreMap = new Map();
      for (const gore of c.gores) {
        const key = gore.key.split('|').map(remapEnd).sort().join('|');
        goreMap.set(gore.key, key);
        gore.key = key;
      }
      for (const bridge of c.bridges) {
        bridge.road = roadMap.get(bridge.road);
        bridge.id = uuid();
      }
      const spans = new Map();
      for (const bridge of c.bridges) bridge.span = spans.get(bridge.span) ?? spans.set(bridge.span, uuid()).get(bridge.span);
      // Intersections.
      const interMap = new Map();
      for (const item of c.intersections) {
        const id = app.intersectionGeometry?.id?.() ?? uuid();
        interMap.set(item.id, id);
        item.id = id;
        move(item);
        const names = new Set((s.intersections ?? []).map(x => x.name));
        if (names.has(item.name)) { let n = 2; while (names.has(`${item.name} (${n})`)) n++; item.name = `${item.name} (${n})`; }
        for (const a of item.approaches) {
          if (a.binding) a.binding.road = roadMap.get(a.binding.road);
          for (const link of a.links ?? []) link.road = roadMap.get(link.road);
        }
      }
      const remapOn = on => {
        if (!on) return on;
        if(on.crossing)remapOn(on.crossing);
        if (on.road != null && roadMap.has(on.road)) on.road = roadMap.get(on.road);
        if (on.intersection != null && interMap.has(on.intersection)) on.intersection = interMap.get(on.intersection);
        if (on.gore != null) on.gore = goreMap.get(on.gore) ?? on.gore;
        return on;
      };
      // Markings and lines; loose ones go to the lane under the pointer.
      const looseMarkings = new Set(c.loose.markings.map(m => m.id)), looseLines = new Set(c.loose.lines.map(l => l.id));
      const lane = at && app.markings?.anchorAt(at), target = at && app.longitudinal?.targetAt(at);
      const firstBack = c.loose.markings[0]?.back ?? 0, pastedLoose = [];
      for (const m of c.markings) {
        if (looseMarkings.has(m.id)) {
          pastedLoose.push(m);
          if (lane && m.on) { m.on = clone(lane.on); m.back = Math.max(0, lane.back + (m.back ?? 0) - firstBack); }
          else if (m.on) m.back = (m.back ?? 0) + PASTE_OFFSET_FEET;
          else for (const end of [m.a, m.b]) if (end) { move(end); delete end.on; }
        } else {
          remapOn(m.on);
          for (const end of [m.a, m.b]) if (end?.on) { remapOn(end.on); if (end.x != null) move(end); }
        }
        m.id = uuid();
      }
      for (const l of c.lines) {
        if (looseLines.has(l.id)) pastedLoose.push(l);
        if (looseLines.has(l.id) && target) {
          const span = l.to - l.from, start = target.s / target.length;
          Object.assign(l, { on: clone(target.on), from: Math.min(start, 1 - span), to: Math.min(1, start + span) });
        } else remapOn(l.on);
        l.id = uuid();
      }
      for (const median of c.medians) {
        median.id = nextNumber(s.medians) + c.medians.indexOf(median);
        for (const p of median.points) { move(p); remapOn(p.on); }
      }
      // Colored pavement goes with its road, or (copied alone) onto the lane under the pointer.
      const surfaceSpans = new Map();
      for (const surface of c.surfaces ?? []) {
        surface.id = uuid();
        if (surface.span) {
          if (!surfaceSpans.has(surface.span)) surfaceSpans.set(surface.span, uuid());
          surface.span = surfaceSpans.get(surface.span);
        }
        if (roadMap.has(surface.on.road)) surface.on.road = roadMap.get(surface.on.road);
        else if (lane?.on?.road != null) {
          const span = surface.to - surface.from;
          surface.on = { road: lane.on.road, lane: lane.on.lane };
          const road = s.roads.find(r => r.id === lane.on.road), line = road && app.roadEditor.crossSection(s)(road).line;
          let length = 0;
          for (let i = 1; i < (line?.length ?? 0); i++) length += Math.hypot(line[i].x - line[i - 1].x, line[i].y - line[i - 1].y);
          const f = length ? Math.max(0, Math.min(1, 1 - lane.back * ppf() / length)) : 0;
          Object.assign(surface, { from: Math.min(f, 1 - span), to: Math.min(1, Math.min(f, 1 - span) + span) });
        }
      }
      for (const sign of c.signs) {
        sign.id = uuid();
        move(sign);
        const post = { x: sign.postX, y: sign.postY };
        move(post);
        Object.assign(sign, { postX: post.x, postY: post.y });
      }
      s.roads.push(...c.roads);
      s.joints.push(...c.joints);
      (s.gores ??= []).push(...c.gores);
      (s.bridges ??= []).push(...c.bridges);
      (s.intersections ??= []).push(...c.intersections);
      (s.markings ??= []).push(...c.markings);
      (s.lines ??= []).push(...c.lines);
      (s.medians ??= []).push(...c.medians);
      (s.signs ??= []).push(...c.signs);
      (s.surfaces ??= []).push(...(c.surfaces ?? []));
      const pasted = [
        ...c.roads.map(r => ({ kind: 'roads', id: r.id })), ...c.intersections.map(i => ({ kind: 'intersections', id: i.id })),
        ...c.medians.map(m => ({ kind: 'medians', id: m.id })), ...c.signs.map(x => ({ kind: 'signs', id: x.id })),
        // Loose markings and lines; the rest ride along with their roads.
        ...pastedLoose.map(item => ({ kind: c.lines.includes(item) ? 'lines' : 'markings', id: item.id })),
        ...(roadMap.size ? [] : (c.surfaces ?? []).map(x => ({ kind: 'surfaces', id: x.id }))),
      ];
      commit();
      setSelection(pasted);
      tell(`Pasted ${describe(Object.fromEntries(KINDS.map(kind => [kind, pasted.filter(p => p.kind === kind).length])))}.`);
    }
    // Make Intersection: one intersection over every crossing among the
    // selected roads (a divided highway crossing another is four crossings).
    const selectedRoads = () => sheet().roads.filter(road => selection.get('roads').has(road.id));
    const crossingCount = () => (selection.get('roads').size > 1 ? app.roadEditor.crossingCount(sheet(), selectedRoads()) : 0);
    function makeIntersection() {
      const item = app.roadEditor.makeIntersection(sheet(), selectedRoads());
      if (!item) return tell('The selected roads don\u2019t cross, or a crossing is too close to a road\u2019s end.');
      setSelection([{ kind: 'intersections', id: item.id }]);
      tell(`${item.name} made from the selected roads.`);
    }
    function duplicate(items = selection) {
      if (!KINDS.some(kind => items.get(kind)?.size)) return tell('Select something to duplicate.');
      paste(null, gather(items));
    }

    function remove(items = selection) {
      const s = sheet(), ids = kind => items.get(kind) ?? new Set();
      if (!KINDS.some(kind => ids(kind).size)) return;
      if (ids('intersections').size && !window.confirm(`Delete ${ids('intersections').size} intersection${ids('intersections').size > 1 ? 's' : ''}?`)) return;
      const roadIds = withPartners(ids('roads'));
      if (roadIds.size) app.roadEditor.removeRoads(s, s.roads.filter(road => roadIds.has(road.id)));
      const endRoad = end => Number(end.split(':')[0]);
      s.gores = (s.gores ?? []).filter(g => !g.key.split('|').some(end => roadIds.has(endRoad(end))));
      s.intersections = (s.intersections ?? []).filter(item => !ids('intersections').has(item.id));
      s.medians = (s.medians ?? []).filter(m => !ids('medians').has(m.id));
      s.markings = (s.markings ?? []).filter(m => !ids('markings').has(m.id) && !roadIds.has(m.on?.road) && !ids('intersections').has(m.on?.intersection));
      s.lines = (s.lines ?? []).filter(l => !ids('lines').has(l.id) && !roadIds.has(l.on?.road));
      s.signs = (s.signs ?? []).filter(sign => !ids('signs').has(sign.id));
      s.surfaces = (s.surfaces ?? []).filter(x => !ids('surfaces').has(x.id) && !roadIds.has(x.on.road));
      const what = describe(Object.fromEntries(KINDS.map(kind => [kind, kind === 'roads' ? roadIds.size : ids(kind).size])));
      if (items === selection) KINDS.forEach(kind => selection.get(kind).clear());
      commit();
      tell(`Deleted ${what}.`);
    }

    // Moving the selection: road joints, intersections, median points, and signs.
    function moveBy(dx, dy) {
      const s = sheet(), roadIds = selection.get('roads');
      const joints = new Set(s.roads.filter(road => roadIds.has(road.id)).flatMap(road => road.ends.map(end => end.joint)));
      for (const joint of s.joints) if (joints.has(joint.id)) { joint.x += dx; joint.y += dy; }
      for (const item of s.intersections ?? []) if (selection.get('intersections').has(item.id)) { item.x += dx; item.y += dy; }
      for (const median of s.medians ?? []) if (selection.get('medians').has(median.id)) {
        for (const p of median.points) {
          p.x += dx; p.y += dy;
          if (p.on && !(roadIds.has(p.on.road) || selection.get('intersections').has(p.on.intersection))) delete p.on;
        }
      }
      for (const sign of s.signs ?? []) if (selection.get('signs').has(sign.id)) { sign.x += dx; sign.y += dy; sign.postX += dx; sign.postY += dy; }
      app.roadEditor.renderLater({ joints: [...joints] });
    }
    const movable = () => ['roads', 'intersections', 'medians', 'signs'].some(kind => selection.get(kind).size);

    function commit() {
      app.roadEditor.render();
      sheets.save(sheet());
      app.history.record();
      refresh();
    }

    // Overlay: selected items outlined, and the selection box while dragging.
    function refresh() {
      prune();
      overlay.replaceChildren();
      refreshPanel();
      const s = sheet();
      if (!s?.inchesPerPixel || (!total() && !drag?.box)) return;
      const root = svg('svg', { 'aria-hidden': 'true' }, overlay);
      const view = svg('g', { transform: `translate(${s.view.x} ${s.view.y}) scale(${s.view.scale})` }, root);
      for (const kind of KINDS) for (const id of selection.get(kind)) {
        for (const shape of shapes(kind, id)) {
          svg('path', { d: pathData(shape, kind !== 'lines'), class: 'selectionOutline', 'vector-effect': 'non-scaling-stroke' }, view);
        }
      }
      if (drag?.box) {
        const a = sheets.toScreen(drag.box.from), b = sheets.toScreen(drag.box.to);
        svg('rect', { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y), class: 'selectionBox' }, root);
      }
    }
    function refreshPanel() {
      if (panel.hidden) return;
      const has = total() > 0;
      get('selectCount').textContent = has ? `Selected: ${describe()}.` : 'Nothing selected.';
      for (const id of ['selectCopy', 'selectCut', 'selectDuplicate', 'selectDelete', 'selectClear']) get(id).disabled = !has;
      get('selectPaste').disabled = !clipboard;
      get('selectMakeIntersection').disabled = !crossingCount();
      if (!sheet()) tell('Upload a sheet first.');
      else if (!ready()) tell('Set the sheet’s scale (Sheets › Set Scale) to select.');
    }
    function boxSelect(from, to, add) {
      const x0 = Math.min(from.x, to.x), x1 = Math.max(from.x, to.x), y0 = Math.min(from.y, to.y), y1 = Math.max(from.y, to.y);
      const within = p => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1;
      const found = [];
      for (const kind of KINDS) for (const item of records(kind)) {
        const outline = shapes(kind, item.id);
        if (outline.length && outline.every(shape => shape.every(within))) found.push({ kind, id: item.id });
      }
      setSelection(found, add);
    }

    // Pointer: click, Shift-click, box select, and dragging the selection.
    const pointOf = event => sheets.toImage(event.clientX, event.clientY);
    workspace.addEventListener('pointerdown', event => {
      if (!active() || !ready() || event.button !== 0 || !event.isPrimary || event.target.closest('button, input, select')) return;
      event.preventDefault(); event.stopImmediatePropagation();
      closeMenu();
      const point = pointOf(event), hit = itemAt(point);
      drag = { pointer: event.pointerId, x: event.clientX, y: event.clientY, from: point, last: point, hit, shift: event.shiftKey, moved: false };
      if (hit && !event.shiftKey && !selected(hit)) setSelection([hit]);
      workspace.setPointerCapture(event.pointerId);
    }, true);
    workspace.addEventListener('pointermove', event => {
      if (active()) pointer = pointOf(event);
      if (!drag || event.pointerId !== drag.pointer) return;
      event.stopImmediatePropagation();
      if (!drag.moved && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) <= DRAG_PIXELS) return;
      drag.moved = true;
      const point = pointOf(event);
      if (drag.hit && selected(drag.hit) && !drag.shift && movable()) {
        moveBy(point.x - drag.last.x, point.y - drag.last.y);
        drag.last = point;
        refresh();
      } else {
        drag.box = { from: drag.from, to: point };
        refresh();
      }
    }, true);
    workspace.addEventListener('pointerup', event => {
      if (!drag || event.pointerId !== drag.pointer) return;
      event.stopImmediatePropagation();
      const d = drag;
      drag = null;
      if (workspace.hasPointerCapture(event.pointerId)) workspace.releasePointerCapture(event.pointerId);
      if (d.box) boxSelect(d.box.from, d.box.to, d.shift);
      else if (d.moved) { commit(); tell(`Moved ${describe()}.`); }
      else if (d.hit && d.shift) toggle(d.hit);
      else if (!d.hit && !d.shift) setSelection([]);
      else refresh();
    }, true);
    // In selection mode a double-click opens the item in its editor too.
    workspace.addEventListener('dblclick', event => {
      if (!active()) return;
      event.preventDefault(); event.stopImmediatePropagation();
      const point = pointOf(event), hit = itemAt(point);
      if (hit) edit(hit, point);
    }, true);

    // Keyboard: copy, cut, paste, duplicate, select all, delete, and Escape.
    document.addEventListener('keydown', event => {
      if (event.target.closest?.('input, select, textarea, dialog, [contenteditable="true"]') || document.querySelector('dialog[open]')) return;
      const mod = event.metaKey || event.ctrlKey, key = event.key.toLowerCase();
      if (mod && key === 'v' && clipboard && ready()) { event.preventDefault(); paste(pointer); return; }
      if (!active()) return;
      if (mod && key === 'c') { event.preventDefault(); copy(); }
      else if (mod && key === 'x') { event.preventDefault(); copy(); remove(); }
      else if (mod && key === 'd') { event.preventDefault(); duplicate(); }
      else if (mod && key === 'a') { event.preventDefault(); selectAll(); }
      else if ((event.key === 'Delete' || event.key === 'Backspace') && total()) { event.preventDefault(); remove(); }
      else if (event.key.startsWith('Arrow') && movable() && ready()) {
        // Arrow keys move the whole selection: 1 ft, or 10 ft with Shift.
        event.preventDefault();
        const step = (event.shiftKey ? 10 : 1) * ppf();
        const [dx, dy] = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
        moveBy(dx * step, dy * step);
        commit();
      }
      else if (event.key === 'Escape' && total()) { event.preventDefault(); event.stopImmediatePropagation(); setSelection([]); }
    }, true);

    // Right-click actions for everything on the sheet.
    function closeMenu() { menu.hidden = true; menu.replaceChildren(); }
    function openMenu(clientX, clientY, entries, label) {
      menu.replaceChildren(...entries.map(entry => {
        const li = document.createElement('li');
        li.setAttribute('role', entry === 'separator' ? 'separator' : 'presentation');
        if (entry === 'separator') return li;
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = entry.label;
        button.setAttribute('role', 'menuitem');
        button.disabled = Boolean(entry.disabled);
        button.addEventListener('click', () => { closeMenu(); entry.run(); });
        li.append(button);
        return li;
      }));
      menu.setAttribute('aria-label', label);
      menu.hidden = false;
      const { width, height } = menu.getBoundingClientRect(), margin = 8;
      const right = clientX + 12 + width + margin <= innerWidth;
      const top = Math.min(Math.max(clientY - 22, margin), Math.max(margin, innerHeight - height - margin));
      menu.dataset.side = right ? 'right' : 'left';
      menu.style.left = `${right ? clientX + 12 : clientX - 12 - width}px`;
      menu.style.top = `${top}px`;
      menu.style.setProperty('--pointer-y', `${Math.min(Math.max(clientY - top, 12), height - 12)}px`);
      menu.querySelector('button:not(:disabled)')?.focus({ preventScroll: true });
    }
    function edit(hit, point) {
      if (hit.kind === 'roads') app.roadEditor.focusRoad(roadOf(hit.id));
      else if (hit.kind === 'medians') app.roadEditor.focusMedian(hit.id);
      else if (hit.kind === 'markings') app.markings.focusAt(point);
      else if (hit.kind === 'intersections') app.intersections.focusAt(point);
      else if (hit.kind === 'lines') app.longitudinal.focus(hit.id);
      else if (hit.kind === 'signs') app.signs.focus(hit.id);
    }
    const just = hit => new Map(KINDS.map(kind => [kind, new Set(kind === hit.kind ? [hit.id] : [])]));
    workspace.addEventListener('contextmenu', event => {
      if (!ready() || event.target.closest('button, input, select, .nodeMenu')) return;
      const point = pointOf(event), hit = itemAt(point);
      // With Elements open, a road's own menu (lane ends, crossings) comes first.
      if (hit?.kind === 'roads' && !get('elementsEditor').hidden && !active()) return;
      event.preventDefault(); event.stopImmediatePropagation();
      const name = hit && NAMES[hit.kind];
      const many = hit && selected(hit) && total() > 1;
      const surface = hit?.kind === 'surfaces' && recordOf('surfaces', hit.id);
      const restyle = changes => () => { Object.assign(surface, changes); commit(); };
      const entries = hit ? [
        ...(surface ? [
          { label: surface.color === 'green' ? 'Make Red (Bus Lane)' : 'Make Green (Bike Lane)', run: restyle({ color: surface.color === 'green' ? 'red' : 'green' }) },
          ...['solid', 'dotted', 'conflict'].filter(p => p !== surface.pattern && (p !== 'conflict' || surface.color === 'green'))
            .map(p => ({ label: { solid: 'Solid Pattern', dotted: 'Dotted Pattern (2 ft / 4 ft)', conflict: 'Conflict Pattern (50 ft solid ends)' }[p], run: restyle({ pattern: p }) })),
          'separator',
        ] : [{ label: `Edit ${name[0].toUpperCase()}${name.slice(1)}`, run: () => edit(hit, point) }]),
        { label: selected(hit) ? 'Remove From Selection' : 'Add To Selection', run: () => { if (!active()) app.showEditor('selectEditor'); toggle(hit); } },
        'separator',
        { label: many ? `Copy Selection (${total()})` : 'Copy', run: () => { clipboard = gather(many ? selection : just(hit)); tell(`Copied ${many ? describe() : `1 ${name}`}.`); refreshPanel(); } },
        { label: many ? `Duplicate Selection (${total()})` : 'Duplicate', run: () => duplicate(many ? selection : just(hit)) },
        { label: 'Paste Here', disabled: !clipboard, run: () => paste(point) },
        ...(many && hit.kind === 'roads' && crossingCount() ? [{ label: 'Make Intersection From Selection', run: makeIntersection }] : []),
        'separator',
        { label: many ? `Delete Selection (${total()})` : `Delete ${name[0].toUpperCase()}${name.slice(1)}`, run: () => remove(many ? selection : just(hit)) },
      ] : [
        { label: 'Paste Here', disabled: !clipboard, run: () => paste(point) },
        { label: 'Select All', run: () => { app.showEditor('selectEditor'); selectAll(); } },
        total() && { label: 'Clear Selection', run: () => setSelection([]) },
      ].filter(Boolean);
      openMenu(event.clientX, event.clientY, entries, hit ? `${name} actions` : 'Sheet actions');
    }, true);
    menu.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeMenu(); return; }
      if (event.key === 'Tab') return closeMenu();
      if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const items = [...menu.querySelectorAll('button:not(:disabled)')], i = items.indexOf(document.activeElement);
      const next = { ArrowUp: i - 1, ArrowDown: i + 1, Home: 0, End: items.length - 1 }[event.key];
      items[(next + items.length) % items.length]?.focus();
    });
    document.addEventListener('pointerdown', event => { if (!menu.hidden && !menu.contains(event.target)) closeMenu(); }, true);
    document.addEventListener('sheetview', () => { closeMenu(); refresh(); });

    // Panel.
    get('selectCopy').addEventListener('click', copy);
    get('selectCut').addEventListener('click', () => { copy(); remove(); });
    get('selectPaste').addEventListener('click', () => paste(null));
    get('selectDuplicate').addEventListener('click', () => duplicate());
    get('selectDelete').addEventListener('click', () => remove());
    get('selectMakeIntersection').addEventListener('click', makeIntersection);
    get('selectAll').addEventListener('click', selectAll);
    get('selectClear').addEventListener('click', () => setSelection([]));
    new MutationObserver(() => {
      workspace.classList.toggle('selecting', active());
      if (active()) tell('Click to select; Shift-click adds or removes; drag on empty sheet to box-select; drag a selection to move it.');
      refresh();
    }).observe(panel, { attributes: true, attributeFilter: ['hidden'] });
    for (const event of ['sheetchange']) document.addEventListener(event, () => { KINDS.forEach(kind => selection.get(kind).clear()); refresh(); });
    document.addEventListener('sheethistory', refresh);
    app.selection = { diagnostics: () => Object.fromEntries([...selection].map(([kind,ids])=>[kind,[...ids]])), refresh, itemAt, edit, paste, copy: () => copy(), clear: () => setSelection([]) };
  });
})();
