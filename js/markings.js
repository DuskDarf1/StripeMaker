/* Markings editor: lateral pavement markings (stop and yield lines, arrows,
   symbols, route shields, and word messages) placed in road and intersection
   approach lanes. Shapes and dimensions are in js/marking-catalog.js.

   Hover a lane to preview the chosen marking and click to add it. A marking
   stays attached to its lane at a distance back from the lane's end, so it moves
   and bends with the road. Repeating markings have a square handle at the
   upstream end of their repeat range. */
(() => {
  const SVG = 'http://www.w3.org/2000/svg';
  const SNAP_STOP_FEET = 10;        // lines this close to a lane's end sit at the end
  const SNAP_MESSAGE_FEET = 8;      // other markings this close to 25 ft back snap to it
  const CLICK_PIXELS = 5;           // pointer travel that still counts as a click
  const HOVER_HINT = 'Hover a lane to preview the marking; click to add it.';
  const CROSSWALK_HINT = 'Click one edge of the roadway, then the other. Click off-square to skew the crosswalk.';
  const TYPE_HINT = 'Type a message, then hover a lane to preview it.';
  const SCALE_HINT = 'Set the sheet’s scale (Sheets › Set Scale) to add markings.';

  document.addEventListener('DOMContentLoaded', () => {
    const app = window.StripeMaker, sheets = app.sheets, C = app.markingCatalog;
    const get = id => document.getElementById(id);
    const workspace = get('workspace'), panel = get('markingsEditor'), picker = get('markingPicker');
    const overlay = document.createElement('div');
    overlay.className = 'markingOverlay';
    sheets.addOverlay(overlay);

    let tab = 'lateral';
    let selected = null, selectedSheet = null;
    let hover = null, hoverMarking = null, press = null, drag = null;
    let crosswalkStart = null;          // a crosswalk's first end, until the second click
    let tracks = new Map(), drawn = new Map();
    // The next marking's settings; a selected marking's settings show instead.
    const draft = { type: 'through', text: '', gap: C.LINE_GAP.min, route: '95', size: 'arterial', speed: 'fast',
      contrast: false, contrastStyle: 'border', all: false, spacing: C.ARROW_SPACING, width: C.CROSSWALK.width };

    const active = () => !panel.hidden && tab === 'lateral';
    const current = () => sheets.selected?.markings?.find(m => m.id === selected) ?? null;
    const model = () => current() ?? draft;
    const ppf = sheet => 12 / sheet.inchesPerPixel;
    const tell = text => { get('markingStatus').textContent = text; };
    const kindOf = m => C.find(m.type)?.kind;
    const svg = (tag, attrs, parent) => {
      const e = document.createElementNS(SVG, tag);
      for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
      parent?.append(e);
      return e;
    };

    // Lane tracks: a centerline with, at each point, every lane's left and right
    // edge in pixels right of travel. Roads come from the road editor, approach
    // lanes from intersections.
    function prepare(track) {
      const line = track.line;
      const along = [0];
      for (let i = 1; i < line.length; i++) along.push(along[i - 1] + Math.hypot(line[i].x - line[i - 1].x, line[i].y - line[i - 1].y));
      const tangents = line.map((p, i) => {
        const a = line[Math.max(0, i - 1)], b = line[Math.min(line.length - 1, i + 1)];
        const t = p.tangent ?? { x: b.x - a.x, y: b.y - a.y }, n = Math.hypot(t.x, t.y) || 1;
        return { x: t.x / n, y: t.y / n };
      });
      return { ...track, along, tangents, length: along.at(-1), count: track.bounds[0].length };
    }
    function collect(sheet, solved) {
      const list = [];
      for (const t of app.roadEditor.laneTracks(sheet, solved)) {
        list.push(prepare({ key: `r:${t.road}`, on: { road: t.road }, line: t.line,
          bounds: t.bounds.map(b => b.slice(0, -1).map((left, k) => [left, b[k + 1]])) }));
      }
      for (const t of app.intersections?.laneTracks?.(sheet) ?? []) list.push(prepare(t));
      return new Map(list.map(t => [t.key, t]));
    }
    const trackKey = on => (on.road != null ? `r:${on.road}` : `i:${on.intersection}:${on.approach}:${on.incoming ? 'in' : 'out'}`);
    const laneIndex = (track, on) => (on.road != null ? on.lane : track.lanes?.indexOf(on.lane));
    const laneRef = (track, k) => (track.on.road != null ? { ...track.on, lane: k } : { ...track.on, lane: track.lanes[k] });
    // Position and lane edges at distance d along a track; past either end the
    // track continues straight.
    function at(track, d) {
      const { line, along, tangents, bounds } = track;
      let i = 0, f = 0;
      if (d <= 0) { i = 0; f = 0; }
      else if (d >= track.length) { i = line.length - 2; f = 1; }
      else {
        let lo = 0, hi = along.length - 1;
        while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (along[mid] <= d) lo = mid; else hi = mid; }
        i = lo; f = (d - along[lo]) / ((along[hi] - along[lo]) || 1);
      }
      i = Math.max(0, Math.min(line.length - 2, i));
      const a = line[i], b = line[i + 1], ta = tangents[i], tb = tangents[i + 1];
      const tx = ta.x + (tb.x - ta.x) * f, ty = ta.y + (tb.y - ta.y) * f, n = Math.hypot(tx, ty) || 1;
      const extra = d < 0 ? d : d > track.length ? d - track.length : 0;
      const t = { x: tx / n, y: ty / n };
      return {
        x: a.x + (b.x - a.x) * f + t.x * extra, y: a.y + (b.y - a.y) * f + t.y * extra, t, n: { x: -t.y, y: t.x },
        edges: bounds[i].map((e, k) => [e[0] + (bounds[i + 1][k][0] - e[0]) * f, e[1] + (bounds[i + 1][k][1] - e[1]) * f]),
      };
    }
    // The track and lane under a sheet point, with its distance along the track.
    function locate(point) {
      let best = null;
      for (const track of tracks.values()) {
        const { line, along } = track;
        for (let i = 0; i < line.length - 1; i++) {
          const a = line[i], b = line[i + 1], dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy || 1;
          const f = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / len2));
          const d = along[i] + f * Math.sqrt(len2);
          const p = at(track, d), side = (point.x - p.x) * p.n.x + (point.y - p.y) * p.n.y;
          const along2 = (point.x - p.x) * p.t.x + (point.y - p.y) * p.t.y;
          if (Math.abs(along2) > 1) continue;
          const lane = p.edges.findIndex(([l, r]) => side >= l && side <= r);
          if (lane < 0) continue;
          const distance = Math.abs(side - (p.edges[lane][0] + p.edges[lane][1]) / 2);
          if (!best || distance < best.distance) best = { track, lane, d, distance };
        }
      }
      return best;
    }

    // A marking's drawn shapes. Each unit (an arrow, a line of a message, a stop
    // line) is placed rigidly at its own point along the lane, centered in the
    // lane and square to it, so curves and changing lane widths never distort
    // it; a long message or a repeat still follows a curving lane unit by unit.
    function layout(sheet, marking) {
      const track = tracks.get(trackKey(marking.on ?? {}));
      if (!track) return null;
      const lane = laneIndex(track, marking.on);
      if (!(lane >= 0 && lane < track.count)) return null;
      const k = ppf(sheet);
      const line = kindOf(marking) === 'line';
      // Bike lanes are marked as such (one yield triangle instead of five).
      const road = marking.on?.road != null ? sheets.selected?.roads.find(r => r.id === marking.on.road) : null;
      // A buffered bike lane's riding space starts past its double line (6",
      // 8" gap, 6": 17" from the lane line's center) on the through-lane side,
      // so its markings center there.
      const riding = edges => edges.map(([l, r], i) => {
        if (road?.laneTypes?.[i]?.type !== 'bufferedBike') return [l, r];
        const buffer = 17 / 12 * k;
        return i > 0 || edges.length === 1 ? [l + buffer, r] : [l, r - buffer];
      });
      const lanes = all => {
        const edges = riding(all), center = (edges[lane][0] + edges[lane][1]) / 2;
        return (line && marking.all ? edges.map((e, i) => [e, i]) : [[edges[lane], lane]])
          .map(([[l, r], i]) => ({ left: (l - center) / k, right: (r - center) / k, bike: ['bike', 'bufferedBike', 'twoWayBike'].includes(road?.laneTypes?.[i]?.type) }));
      };
      const frame = d => {
        const p = at(track, d), edges = riding(p.edges), c = (edges[lane][0] + edges[lane][1]) / 2;
        return { x: p.x + p.n.x * c, y: p.y + p.n.y * c, t: p.t, n: p.n, edges: p.edges };
      };
      const back = marking.back ?? 0;
      const probe = C.build(marking, lanes(frame(track.length - back * k).edges));
      const copies = C.repeats(marking).map(offset => {
        const front = track.length - (back + offset) * k;
        const middle = frame(front - (probe.length / 2) * k);
        const built = C.build(marking, lanes(middle.edges));
        const frames = new Map();
        const place = (unit = built.length / 2) => {
          if (!frames.has(unit)) frames.set(unit, frame(front - (built.length - unit) * k));
          const f = frames.get(unit);
          return ([x, y]) => ({ x: f.x + f.t.x * (y - unit) * k + f.n.x * x * k, y: f.y + f.t.y * (y - unit) * k + f.n.y * x * k });
        };
        const parts = built.parts.map(part => ({ ...part, rings: part.rings.map(r => r.map(place(part.unit))) }));
        const hit = box(parts.flatMap(part => part.rings.flat()), middle.t);
        return { parts, hit, center: place()([0, built.length / 2]) };
      });
      const tail = frame(track.length - (back + (marking.repeat?.length ?? 0) + probe.length) * k);
      return { track, lane, length: probe.length, copies, repeatPoint: { x: tail.x, y: tail.y } };
    }
    // A marking's pick area and outline: the rectangle around it, square to
    // direction t.
    function box(points, t) {
      const n = { x: -t.y, y: t.x };
      const along = points.map(p => p.x * t.x + p.y * t.y), across = points.map(p => p.x * n.x + p.y * n.y);
      const [a0, a1, c0, c1] = [Math.min(...along), Math.max(...along), Math.min(...across), Math.max(...across)];
      return [[a0, c0], [a1, c0], [a1, c1], [a0, c1]].map(([a, c]) => ({ x: t.x * a + n.x * c, y: t.y * a + n.y * c }));
    }
    const pathData = ring => `M${ring.map(p => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join('L')}Z`;
    function paint(parts, parent, sheet) {
      for (const part of parts) {
        const attrs = { d: part.rings.map(pathData).join(''), fill: part.fill, 'fill-rule': part.rule };
        // Contrast borders: the outline stroked under the paint, round at corners
        // so the black stays the same width around arrow tips.
        if (part.stroke) Object.assign(attrs, { stroke: part.strokeColor ?? '#000000', 'stroke-width': (part.stroke * ppf(sheet)).toFixed(3), 'stroke-linejoin': 'round' });
        svg('path', attrs, parent);
      }
    }
    // Crosswalks: from one edge of the pavement to the other. Ends snap to road
    // pavement edges (and stay on them as the road moves) or intersection curbs.
    const EDGE_SNAP_PIXELS = 12;
    const crossing = () => C.find(draft.type)?.kind === 'crosswalk';
    // Colored pavement is placed by js/surfaces.js (two clicks along a lane).
    const surfacing = () => C.find(draft.type)?.kind === 'surface';
    function boundaryLine(track, k) {
      return track.line.map((p, i) => {
        const offset = k === 0 ? track.bounds[i][0][0] : track.bounds[i][k - 1][1], t = track.tangents[i];
        return { x: p.x - t.y * offset, y: p.y + t.x * offset };
      });
    }
    function pavementEdges(sheet) {
      const margin = 8 / sheet.inchesPerPixel, edges = [];  // edge of traveled way to edge of pavement
      const roads = [...tracks.values()].filter(t => t.on.road != null);
      // A two-way road without a median has no pavement edge at its centerline:
      // each side's left edge line runs 10" from the other's, the other way.
      // (A one-way road joined end to start also meets the next road's left
      // edge, but heading the same way.)
      const centered = track => roads.some(other => {
        if (other === track) return false;
        const p = boundaryLine(track, 0)[0], q = boundaryLine(other, 0).at(-1);
        const t = track.tangents[0], u = other.tangents.at(-1);
        return Math.hypot(p.x - q.x, p.y - q.y) < ppf(sheet) && t.x * u.x + t.y * u.y < -0.5;
      });
      for (const track of roads) {
        const sides = centered(track) ? [['R', track.count, margin]] : [['L', 0, -margin], ['R', track.count, margin]];
        for (const [side, k, extra] of sides) {
          const points = boundaryLine(track, k).map((p, i) => {
            const t = track.tangents[i];
            return { x: p.x - t.y * extra, y: p.y + t.x * extra };
          });
          edges.push({ points, on: { road: track.on.road, side } });
        }
      }
      for (const edge of app.intersections?.boundaries(sheet).edges ?? []) if (edge.on.side === 'corner') edges.push({ points: edge });
      return edges;
    }
    const lengthOf = points => points.reduce((sum, p, i) => sum + (i ? Math.hypot(p.x - points[i - 1].x, p.y - points[i - 1].y) : 0), 0);
    // A point a fraction along an edge, with the edge's direction there.
    function alongEdge(points, f) {
      let left = lengthOf(points) * f;
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1], b = points[i], step = Math.hypot(b.x - a.x, b.y - a.y);
        if (left <= step || i === points.length - 1) {
          const g = step ? Math.min(1, left / step) : 0;
          return { x: a.x + (b.x - a.x) * g, y: a.y + (b.y - a.y) * g, t: { x: (b.x - a.x) / (step || 1), y: (b.y - a.y) / (step || 1) } };
        }
        left -= step;
      }
      return points[0];
    }
    function snapEnd(sheet, point) {
      let best = null;
      for (const edge of pavementEdges(sheet)) {
        let walked = 0;
        for (let i = 1; i < edge.points.length; i++) {
          const a = edge.points[i - 1], b = edge.points[i], dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
          const f = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (len * len)));
          const q = { x: a.x + dx * f, y: a.y + dy * f }, d = Math.hypot(point.x - q.x, point.y - q.y);
          if (!best || d < best.d) best = { d, q, edge, s: walked + f * len, t: { x: dx / len, y: dy / len } };
          walked += len;
        }
      }
      if (!best || best.d * sheet.view.scale > EDGE_SNAP_PIXELS) return { x: point.x, y: point.y };
      const end = { x: best.q.x, y: best.q.y, t: best.t };
      if (best.edge.on) end.on = { ...best.edge.on, f: best.s / (lengthOf(best.edge.points) || 1) };
      return end;
    }
    function endPoint(sheet, end) {
      if (!end?.on) return end;
      const edge = pavementEdges(sheet).find(e => e.on?.road === end.on.road && e.on.side === end.on.side);
      return edge ? alongEdge(edge.points, end.on.f) : end;
    }
    // Where the crosswalk's centerline crosses each lane line and lane center, with
    // that lane's direction of travel, for special emphasis bars (sheet 9).
    function barsAcross(a, b) {
      const bars = [], centers = [];
      const hit = (p, q) => {
        const d1 = { x: b.x - a.x, y: b.y - a.y }, d2 = { x: q.x - p.x, y: q.y - p.y };
        const den = d1.x * d2.y - d1.y * d2.x;
        if (Math.abs(den) < 1e-9) return null;
        const t = ((p.x - a.x) * d2.y - (p.y - a.y) * d2.x) / den, u = ((p.x - a.x) * d1.y - (p.y - a.y) * d1.x) / den;
        return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? { x: a.x + d1.x * t, y: a.y + d1.y * t } : null;
      };
      for (const track of tracks.values()) {
        const at = [];
        for (let k = 0; k <= track.count; k++) {
          const line = boundaryLine(track, k);
          for (let i = 1; i < line.length && !at[k]; i++) {
            const p = hit(line[i - 1], line[i]);
            if (p) at[k] = { ...p, t: track.tangents[i] };
          }
        }
        for (let k = 0; k < track.count; k++) {
          if (at[k] && at[k + 1]) bars.push({ x: (at[k].x + at[k + 1].x) / 2, y: (at[k].y + at[k + 1].y) / 2, t: at[k].t });
          if (k > 0 && at[k]) bars.push(at[k]);
        }
        if (at[0]) centers.push({ ...at[0], key: track.key });
      }
      // A two-way road's centerline: two left edges 10" apart (no median).
      const k = ppf(sheets.selected);
      centers.forEach((p, i) => centers.slice(i + 1).forEach(q => {
        if (Math.hypot(p.x - q.x, p.y - q.y) < k && p.t.x * q.t.x + p.t.y * q.t.y < -0.5) bars.push({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2, t: p.t });
      }));
      return bars;
    }
    const unitVector = (a, b) => { const d = Math.hypot(b.x - a.x, b.y - a.y) || 1; return { x: (b.x - a.x) / d, y: (b.y - a.y) / d }; };
    function layoutCrosswalk(sheet, marking) {
      const a = endPoint(sheet, marking.a), b = endPoint(sheet, marking.b), k = ppf(sheet);
      if (!a || !b || Math.hypot(b.x - a.x, b.y - a.y) < k) return null;
      const feet = p => ({ x: p.x / k, y: p.y / k });
      const g = C.crosswalk(marking, { ...feet(a), t: a.t }, { ...feet(b), t: b.t }, barsAcross(a, b).map(bar => ({ ...feet(bar), t: bar.t })));
      const parts = g.parts.map(part => ({ ...part, rings: part.rings.map(r => r.map(([x, y]) => ({ x: x * k, y: y * k }))) }));
      return { crosswalk: true, a, b, length: g.length, copies: [{ parts, hit: box(parts.flatMap(p => p.rings.flat()), unitVector(a, b)), center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } }] };
    }

    // Drawn into the road layer's markings group (vector in PDF downloads). With
    // bridges, `place(point, road)` gives the group on the level each unit sits
    // on (null when that level is hidden).
    function draw(sheet, parent, solved, place = null) {
      tracks = collect(sheet, solved);
      drawn = new Map();
      sheet.markings ??= [];
      // Markings go with their lane: a removed road, approach, or lane drops them.
      sheet.markings = sheet.markings.filter(m => {
        if (kindOf(m) === 'crosswalk') return true;
        const track = tracks.get(trackKey(m.on ?? {}));
        return track && laneIndex(track, m.on) >= 0 && laneIndex(track, m.on) < track.count;
      });
      const groups = new Map();
      const groupIn = into => groups.get(into) ?? groups.set(into, svg('g', { class: 'laneMarkings' }, into)).get(into);
      for (const marking of sheet.markings) {
        const placed = kindOf(marking) === 'crosswalk' ? layoutCrosswalk(sheet, marking) : layout(sheet, marking);
        if (!placed) continue;
        const road = marking.on?.road ?? marking.a?.on?.road;
        let shown = false, contrasted = null;
        placed.copies.forEach((copy, i) => {
          const center = copy.center ?? copy.hit.reduce((c, p, j, all) => ({ x: c.x + p.x / all.length, y: c.y + p.y / all.length }), { x: 0, y: 0 });
          const into = place ? place(center, road, marking.on?.intersection) : parent;
          if (!into) return;
          // Settings › High contrast on elevated levels: on a concrete deck the
          // unit gets black contrast (FDM 230.3.1.3) unless it already has it.
          let parts = copy.parts;
          if (into.level > 1 && !marking.contrast && app.settings?.get('autoContrast')) {
            contrasted ??= kindOf(marking) === 'crosswalk' ? layoutCrosswalk(sheet, { ...marking, contrast: true }) : layout(sheet, { ...marking, contrast: true });
            parts = contrasted?.copies[i]?.parts ?? parts;
          }
          paint(parts, groupIn(into), sheet);
          shown = true;
        });
        // Markings on hidden levels can't be picked.
        if (shown) drawn.set(marking.id, placed);
      }
      if (!groups.size) groupIn(parent);
      if (hover && !drag) hover = refreshHover(hover.point);
    }

    // Overlay: hover preview, selection outline, and handles (screen pixels).
    function refreshOverlay() {
      if (drag?.handle) return;  // keep the captured handle alive during a drag
      overlay.replaceChildren();
      const sheet = sheets.selected;
      if (!sheet || panel.hidden || tab !== 'lateral') return;
      const screen = svg('svg', { class: 'markingPreview', 'aria-hidden': 'true' }, overlay);
      const view = svg('g', { transform: `translate(${sheet.view.x} ${sheet.view.y}) scale(${sheet.view.scale})` }, screen);
      if (hover?.layout && !hoverMarking) {
        const ghost = svg('g', { opacity: '0.75' }, view);
        for (const copy of hover.layout.copies) paint(copy.parts, ghost, sheet);
      }
      const outline = (placed, cls) => {
        for (const copy of placed.copies) svg('path', { d: pathData(copy.hit), class: cls, 'vector-effect': 'non-scaling-stroke' }, view);
      };
      if (hoverMarking && hoverMarking !== selected && drawn.get(hoverMarking)) outline(drawn.get(hoverMarking), 'markingHover');
      for (const end of [crosswalkStart, hover?.snap].filter(Boolean)) {
        const s = sheets.toScreen(end);
        svg('circle', { cx: s.x, cy: s.y, r: end.on ? 6 : 4, class: 'markingSnap' }, screen);
      }
      const placed = selected && drawn.get(selected);
      const marking = current();
      if (!placed || !marking) return;
      outline(placed, 'markingSelected');
      const label = C.find(marking.type)?.name ?? 'Marking';
      const button = (part, point, text) => {
        const b = document.createElement('button');
        b.type = 'button'; b.className = part === 'repeat' ? 'markingRepeat' : 'markingHandle';
        b.dataset.part = part; b.setAttribute('aria-label', text); b.title = text;
        const s = sheets.toScreen(point);
        Object.assign(b.style, { left: `${s.x}px`, top: `${s.y}px` });
        overlay.append(b);
        return b;
      };
      if (placed.crosswalk) {
        for (const end of ['a', 'b']) button(end, placed[end], `${label} ${end === 'a' ? 'first' : 'second'} end. Drag to a pavement edge, or use the arrow keys (Shift for 10 ft); Delete removes the crosswalk.`);
        return;
      }
      button('move', placed.copies[0].center, `${label}. Drag to move; arrow keys move it along the lane (Shift for 10 ft) or to the next lane; Delete removes it.`);
      if (C.find(marking.type)?.repeat) {
        button('repeat', placed.repeatPoint, `${label} repeat range, ${Math.round(marking.repeat?.length ?? 0)} ft. Drag back along the lane, or use the up and down arrow keys.`);
      }
    }

    // Where the chosen marking would go for a sheet point: centered on the
    // pointer, snapped to the lane's end (lines) or 25 ft back from it.
    function placement(point, shift) {
      const sheet = sheets.selected, found = locate(point);
      if (!found) return null;
      const k = ppf(sheet), item = C.find(draft.type);
      if (item.kind === 'word' && !C.textLines(draft.text).length) return null;
      const marking = candidate(found, 0, shift);
      const length = C.build(marking, [{ left: -6, right: 6 }]).length;
      let back = (found.track.length - found.d) / k - length / 2;
      let snapped = '';
      if (item.kind === 'line' && back < SNAP_STOP_FEET) { back = 0; snapped = 'At the end of the lane.'; }
      else if (item.kind !== 'line' && Math.abs(back - C.MESSAGE_BACK) < SNAP_MESSAGE_FEET) { back = C.MESSAGE_BACK; snapped = `${C.MESSAGE_BACK} ft back from the end of the lane.`; }
      back = Math.max(0, Math.min(back, found.track.length / k - length));
      marking.back = Math.max(0, back);
      return { marking, snapped };
    }
    function candidate(found, back, shift) {
      const item = C.find(draft.type);
      const m = { id: 'preview', type: draft.type, on: laneRef(found.track, found.lane), back };
      if (item.kind === 'word') Object.assign(m, { text: draft.text, gap: draft.gap });
      if (item.kind === 'shield') Object.assign(m, { route: draft.route, size: draft.size });
      if (draft.type === 'yieldAhead') m.speed = draft.speed;
      if (item.dot && draft.dot) m.dot = true;
      if (item.kind === 'line' && (draft.all || shift)) m.all = true;
      if (draft.contrast) m.contrast = draft.contrastStyle;
      if (item.repeat) m.repeat = { length: 0, spacing: draft.spacing };
      return m;
    }
    function hitMarking(point) {
      const inside = (p, poly) => {
        let hit = false;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
          const a = poly[i], b = poly[j];
          if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) hit = !hit;
        }
        return hit;
      };
      const list = sheets.selected?.markings ?? [];
      for (let i = list.length - 1; i >= 0; i--) {
        const placed = drawn.get(list[i].id);
        if (placed?.copies.some(copy => inside(point, copy.hit))) return list[i].id;
      }
      return null;
    }
    function refreshHover(point, shift = hover?.shift) {
      const sheet = sheets.selected;
      if (!sheet?.inchesPerPixel || !point) return null;
      hoverMarking = crosswalkStart ? null : hitMarking(point);
      if (hoverMarking) return { point, shift };
      if (crossing()) {
        const snap = snapEnd(sheet, point);
        if (!crosswalkStart) return { point, shift, snap, layout: null };
        const marking = { id: 'preview', type: draft.type, a: crosswalkStart, b: snap, width: draft.width, ...(draft.contrast ? { contrast: true } : {}) };
        return { point, shift, snap, marking, layout: layoutCrosswalk(sheet, marking) };
      }
      const found = placement(point, shift);
      if (!found) return { point, shift };
      const placed = layout(sheet, found.marking);
      return { point, shift, layout: placed, marking: found.marking, snapped: found.snapped };
    }

    function changed(message) {
      app.roadEditor.render();
      updatePanel();
      sheets.save(sheets.selected);
      app.history.record();
      if (message) tell(message);
    }
    function select(id) {
      selected = id; selectedSheet = sheets.selected;
      updatePanel(); refreshOverlay();
    }
    function add() {
      const sheet = sheets.selected;
      if (crossing() && hover?.snap && sheet) {
        // First click: one edge of the roadway; second click: the other.
        if (!crosswalkStart) { crosswalkStart = hover.snap; refreshOverlay(); tell('Click the other edge of the roadway.'); return; }
        if (!hover.layout) { tell('Click farther from the first end.'); return; }
        const marking = { ...structuredClone(hover.marking), id: crypto.randomUUID() };
        crosswalkStart = null;
        (sheet.markings ??= []).push(marking);
        selected = marking.id; selectedSheet = sheet;
        changed('Crosswalk added.');
        return;
      }
      if (!hover?.marking || !sheet) return;
      const marking = { ...structuredClone(hover.marking), id: crypto.randomUUID() };
      if (marking.type === 'word' && !C.textLines(marking.text).length) { tell('Type a message first.'); return; }
      (sheet.markings ??= []).push(marking);
      selected = marking.id; selectedSheet = sheet;
      changed(hover.snapped ? `Marking added ${hover.snapped.toLowerCase()}` : 'Marking added.');
    }
    function remove() {
      const sheet = sheets.selected;
      if (!current()) return;
      sheet.markings = sheet.markings.filter(m => m.id !== selected);
      selected = null;
      changed('Marking deleted.');
    }

    // Pointer: hover previews; a click on a lane adds the marking; pressing an
    // existing marking selects it and drags it. A drag that starts on open
    // pavement still pans the sheet.
    const pointOf = event => sheets.toImage(event.clientX, event.clientY);
    workspace.addEventListener('pointermove', event => {
      if (!active() || !sheets.selected) return;
      if (drag && event.pointerId === drag.pointer) { moveDrag(event); return; }
      if (surfacing()) { hover = null; return; }
      if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > CLICK_PIXELS) press = null;
      if (event.pointerType === 'touch' && !press) return;
      hover = refreshHover(pointOf(event), event.shiftKey);
      workspace.classList.toggle('markingPlacing', Boolean(hover?.layout || hover?.snap || hoverMarking));
      refreshOverlay();
    });
    workspace.addEventListener('pointerleave', () => {
      if (drag) return;
      hover = null; hoverMarking = null;
      workspace.classList.remove('markingPlacing');
      refreshOverlay();
    });
    workspace.addEventListener('pointerdown', event => {
      if (!active() || !sheets.selected?.inchesPerPixel || event.button !== 0 || !event.isPrimary) return;
      if (event.target.closest('.markingOverlay button') || surfacing()) return;
      const point = pointOf(event);
      const id = hitMarking(point);
      if (id) {
        // Grab the marking: no pan.
        event.preventDefault(); event.stopImmediatePropagation();
        select(id);
        const m = current();
        drag = { pointer: event.pointerId, part: 'move', before: structuredClone(m), moved: false, x: event.clientX, y: event.clientY, start: point };
        workspace.setPointerCapture(event.pointerId);
        return;
      }
      hover = refreshHover(point, event.shiftKey);
      press = hover?.layout || crossing() ? { x: event.clientX, y: event.clientY, pointer: event.pointerId, shift: event.shiftKey } : null;
    }, true);
    workspace.addEventListener('pointerup', event => {
      if (drag && event.pointerId === drag.pointer) { endDrag(event); return; }
      if (!active() || !press || event.pointerId !== press.pointer) return;
      const moved = Math.hypot(event.clientX - press.x, event.clientY - press.y) > CLICK_PIXELS;
      const shift = press.shift || event.shiftKey;
      press = null;
      if (moved) return;
      hover = refreshHover(pointOf(event), shift);
      add();
    }, true);
    workspace.addEventListener('pointercancel', event => {
      press = null;
      if (drag && event.pointerId === drag.pointer) endDrag(event, true);
    }, true);
    workspace.addEventListener('dblclick', event => {
      if (active() && (hover?.layout || hoverMarking)) { event.preventDefault(); event.stopImmediatePropagation(); }
    }, true);

    function moveDrag(event) {
      const marking = current(), sheet = sheets.selected;
      if (!marking) return;
      if (!drag.moved && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) <= CLICK_PIXELS) return;
      drag.moved = true;
      const point = pointOf(event), k = ppf(sheet);
      if (kindOf(marking) === 'crosswalk') {
        if (drag.part === 'a' || drag.part === 'b') marking[drag.part] = snapEnd(sheet, point);
        else {
          // Grabbing the crosswalk moves both ends (off any edge they were on).
          const shift = p => ({ x: p.x + point.x - drag.start.x, y: p.y + point.y - drag.start.y });  // off its edge: cut square
          marking.a = shift(endPoint(sheet, drag.before.a)); marking.b = shift(endPoint(sheet, drag.before.b));
        }
      } else if (drag.part === 'repeat') {
        const track = tracks.get(trackKey(marking.on));
        const found = track && nearestAlong(track, point);
        if (found == null) return;
        const length = drawn.get(marking.id)?.length ?? 0;
        const span = (track.length - found) / k - (marking.back ?? 0) - length;
        marking.repeat = { ...(marking.repeat ?? { spacing: draft.spacing }), length: Math.max(0, Math.min(span, track.length / k)) };
      } else {
        const found = locate(point);
        if (!found) return;
        const length = drawn.get(marking.id)?.length ?? 0;
        marking.on = laneRef(found.track, found.lane);
        marking.back = Math.max(0, (found.track.length - found.d) / k - length / 2);
      }
      app.roadEditor.render();
      if (drag.handle) {
        const placed = drawn.get(marking.id);
        const s = sheets.toScreen(placed.crosswalk ? placed[drag.part] : drag.part === 'repeat' ? placed.repeatPoint : placed.copies[0].center);
        Object.assign(drag.handle.style, { left: `${s.x}px`, top: `${s.y}px` });
      }
      updatePanel();
    }
    function endDrag(event, cancel = false) {
      const d = drag;
      drag = null;
      const marking = current();
      if (cancel && marking) Object.assign(marking, d.before);
      if (d.handle?.hasPointerCapture(event.pointerId)) d.handle.releasePointerCapture(event.pointerId);
      if (workspace.hasPointerCapture(event.pointerId)) workspace.releasePointerCapture(event.pointerId);
      if (d.moved) changed();
      else { app.roadEditor.render(); updatePanel(); }
      overlay.querySelector(`button[data-part="${d.part}"]`)?.focus({ preventScroll: true });
    }
    function nearestAlong(track, point) {
      let best = null;
      const { line, along } = track;
      for (let i = 0; i < line.length - 1; i++) {
        const a = line[i], b = line[i + 1], dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy || 1;
        const f = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / len2));
        const q = { x: a.x + dx * f, y: a.y + dy * f }, distance = Math.hypot(point.x - q.x, point.y - q.y);
        if (!best || distance < best.distance) best = { d: along[i] + f * Math.sqrt(len2), distance };
      }
      return best?.d;
    }
    overlay.addEventListener('pointerdown', event => {
      const handle = event.target.closest('button[data-part]');
      if (!handle || event.button !== 0) return;
      event.preventDefault(); event.stopPropagation();
      const m = current();
      if (!m) return;
      drag = { pointer: event.pointerId, part: handle.dataset.part, before: structuredClone(m), moved: false, x: event.clientX, y: event.clientY, handle };
      handle.setPointerCapture(event.pointerId);
      handle.focus({ preventScroll: true });
    });
    overlay.addEventListener('pointermove', event => { if (drag?.handle && event.pointerId === drag.pointer) moveDrag(event); });
    overlay.addEventListener('pointerup', event => { if (drag?.handle && event.pointerId === drag.pointer) endDrag(event); });
    overlay.addEventListener('pointercancel', event => { if (drag?.handle && event.pointerId === drag.pointer) endDrag(event, true); });
    overlay.addEventListener('click', event => event.stopPropagation());
    overlay.addEventListener('keydown', event => {
      const handle = event.target.closest('button[data-part]'), m = current(), sheet = sheets.selected;
      if (!handle || !m) return;
      if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); event.stopPropagation(); remove(); return; }
      const step = event.shiftKey ? 10 : 1;
      if (kindOf(m) === 'crosswalk') {
        const [dx, dy] = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key] ?? [];
        if (dx == null) return;
        event.preventDefault(); event.stopPropagation();
        const end = endPoint(sheet, m[handle.dataset.part]), d = step * ppf(sheet);
        m[handle.dataset.part] = { x: end.x + dx * d, y: end.y + dy * d };
        changed();
        overlay.querySelector(`button[data-part="${handle.dataset.part}"]`)?.focus({ preventScroll: true });
        return;
      }
      const placed = drawn.get(m.id), track = placed?.track;
      if (!track) return;
      const max = track.length / ppf(sheet) - placed.length;
      if (handle.dataset.part === 'repeat') {
        const dir = { ArrowUp: -1, ArrowDown: 1 }[event.key];
        if (!dir) return;
        event.preventDefault(); event.stopPropagation();
        m.repeat = { ...m.repeat, length: Math.max(0, Math.min(max - (m.back ?? 0), (m.repeat?.length ?? 0) + dir * step)) };
      } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault(); event.stopPropagation();
        m.back = Math.max(0, Math.min(max, (m.back ?? 0) + (event.key === 'ArrowUp' ? -step : step)));
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault(); event.stopPropagation();
        const lane = placed.lane + (event.key === 'ArrowLeft' ? -1 : 1);
        if (lane < 0 || lane >= track.count) return;
        m.on = laneRef(track, lane);
      } else return;
      changed();
      overlay.querySelector(`button[data-part="${handle.dataset.part}"]`)?.focus({ preventScroll: true });
    });
    document.addEventListener('keydown', event => {
      if (!active() || picker.open || event.target.closest('input,select,textarea,[contenteditable="true"]')) return;
      if ((event.key === 'Delete' || event.key === 'Backspace') && current()) { event.preventDefault(); remove(); }
      else if (event.key === 'Escape' && crosswalkStart) { event.preventDefault(); event.stopImmediatePropagation(); crosswalkStart = null; hover = null; refreshOverlay(); tell('Crosswalk canceled.'); }
      else if (event.key === 'Escape' && current()) { event.preventDefault(); event.stopImmediatePropagation(); select(null); tell(HOVER_HINT); }
    }, true);
    document.addEventListener('keydown', event => {
      if (event.key === 'Shift' && active() && hover?.point) { hover = refreshHover(hover.point, true); refreshOverlay(); }
    });
    document.addEventListener('keyup', event => {
      if (event.key === 'Shift' && active() && hover?.point) { hover = refreshHover(hover.point, false); refreshOverlay(); }
    });

    // Panel.
    const tabs = { longitudinal: get('markingsLongitudinalTab'), lateral: get('markingsLateralTab') };
    function showTab(name) {
      tab = name;
      crosswalkStart = null;
      get('markingsLongitudinal').hidden = name !== 'longitudinal';
      get('markingsLateral').hidden = name !== 'lateral';
      for (const [key, button] of Object.entries(tabs)) {
        button.classList.toggle('selected', key === name);
        button.setAttribute('aria-selected', String(key === name));
        button.tabIndex = key === name ? 0 : -1;
      }
      hover = null;
      refreshOverlay();
      app.longitudinal?.refreshOverlay?.();
    }
    for (const [name, button] of Object.entries(tabs)) {
      button.addEventListener('click', () => showTab(name));
      button.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === 'End' || event.key === 'ArrowRight' ? 'lateral' : 'longitudinal';
        showTab(next); tabs[next].focus();
      });
    }

    // Thumbnails: the marking on a 12 ft lane of asphalt (white lane lines).
    const thumbs = new Map();
    function thumbnail(m) {
      const key = JSON.stringify(m);
      if (thumbs.has(key)) return thumbs.get(key);
      const built = C.build(m, [{ left: -6, right: 6 }]);
      const b = built.parts.length ? C.bounds(built.parts) : { x0: -6, x1: 6, y0: 0, y1: 4 };
      const h = Math.max(b.y1 - b.y0, 12) + 4, top = (b.y0 + b.y1) / 2 + h / 2;
      const root = document.createElementNS(SVG, 'svg');
      root.setAttribute('xmlns', SVG);
      root.setAttribute('viewBox', `-${h / 2} 0 ${h} ${h}`);
      svg('rect', { x: -h / 2, y: 0, width: h, height: h, fill: '#55575a' }, root);
      for (const x of [-6, 6]) svg('rect', { x: x - 0.25, y: 0, width: 0.5, height: h, fill: '#ffffff' }, root);
      for (const part of built.parts) {
        const attrs = { d: part.rings.map(r => `M${r.map(([x, y]) => `${x.toFixed(3)} ${(top - y).toFixed(3)}`).join('L')}Z`).join(''), fill: part.fill, 'fill-rule': part.rule };
        if (part.stroke) Object.assign(attrs, { stroke: part.strokeColor ?? '#000000', 'stroke-width': part.stroke, 'stroke-linejoin': 'round' });
        svg('path', attrs, root);
      }
      const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(root));
      thumbs.set(key, url);
      return url;
    }
    const sample = item => ({
      type: item.id, text: item.kind === 'word' ? 'ONLY' : undefined, gap: C.LINE_GAP.min, route: item.kind === 'shield' ? '95' : undefined,
    });
    // The picker lists lateral markings, or on the Longitudinal tab its lines.
    function populate() {
      const query = get('markingSearch').value.trim().toLowerCase().split(/\s+/).filter(Boolean);
      const group = get('markingCategory').value, grid = get('markingGrid');
      const lines = tab === 'longitudinal' ? app.longitudinal.source : null;
      const matches = (lines ? lines.items() : C.catalog).filter(item => (!group || item.group === group)
        && query.every(word => `${item.name} ${item.group} ${item.note ?? ''}`.toLowerCase().includes(word)));
      grid.replaceChildren(...matches.map(item => {
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'iconGridItem'; button.dataset.type = item.id;
        button.setAttribute('aria-label', `${item.name} — ${item.group}`); button.title = item.name;
        button.setAttribute('aria-pressed', String(lines ? lines.chosen(item) : model().type === item.id));
        const img = document.createElement('img'); img.src = lines ? lines.thumbnail(item) : thumbnail(sample(item)); img.alt = ''; img.decoding = 'async';
        const caption = document.createElement('span'); caption.textContent = item.name;
        button.append(img, caption);
        button.addEventListener('click', () => {
          if (!lines) { choose(item); return; }
          lines.choose(item); picker.close();
        });
        return button;
      }));
      get('markingSearchStatus').textContent = matches.length ? `${matches.length} markings` : 'No matching markings.';
    }
    function choose(item) {
      // Crosswalks and lane markings are placed differently: switching between
      // them starts a new marking instead of changing the selected one.
      if (current() && (C.find(current().type)?.kind === 'crosswalk') !== (item.kind === 'crosswalk')) select(null);
      crosswalkStart = null;
      if (item.kind === 'surface') {
        select(null);
        draft.type = item.id;
        updatePanel();
        tell('Click where the colored pavement starts on a lane, then where it ends.');
        picker.close();
        return;
      }
      const m = current();
      const type = item.id;
      const text = item.kind === 'word' ? (m?.text ?? draft.text) : undefined;
      if (m) {
        if (C.find(m.type)?.kind === 'line' && item.kind !== 'line') delete m.all;
        m.type = type;
        if (text != null) { m.text = text; m.gap ??= C.LINE_GAP.min; }
        if (item.kind === 'shield') Object.assign(m, { route: m.route ?? draft.route, size: m.size ?? draft.size });
        if (item.repeat) m.repeat ??= { length: 0, spacing: item.repeat };
        else delete m.repeat;
        changed('Marking changed.');
      } else {
        draft.type = type;
        if (text != null) draft.text = text;
        if (item.repeat) draft.spacing = item.repeat;
        updatePanel();
        tell(item.kind === 'crosswalk' ? CROSSWALK_HINT : HOVER_HINT);
      }
      picker.close();
      if (item.id === 'word') get('markingText').focus();
    }
    function openPicker() {
      get('markingSearch').value = ''; get('markingCategory').value = '';
      get('markingCategory').hidden = tab === 'longitudinal';
      get('markingPickerTitle').textContent = tab === 'longitudinal' ? 'Select a Line' : 'Select a Marking';
      populate(); picker.showModal(); get('markingSearch').focus();
    }
    get('chooseMarking').addEventListener('click', openPicker);
    get('markingSearch').addEventListener('input', populate);
    get('markingCategory').addEventListener('change', populate);
    get('closeMarkingPicker').addEventListener('click', () => picker.close());
    picker.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); picker.close(); }
    });
    picker.addEventListener('close', () => get(tab === 'longitudinal' ? 'chooseLine' : 'chooseMarking').focus({ preventScroll: true }));
    get('deleteMarking').addEventListener('click', remove);

    // Field edits apply to the selected marking, or to the next one placed.
    function edit(apply) {
      const m = current();
      if (m) { apply(m); changed(); }
      else { apply(draft); updatePanel(); if (hover?.point) hover = refreshHover(hover.point); refreshOverlay(); }
    }
    get('markingText').addEventListener('input', event => {
      const text = event.target.value.toUpperCase();
      const bad = C.unsupported(text);
      get('markingTextHint').textContent = bad.length ? `Leaves out ${bad.join(' ')}: pavement lettering has A–Z and 0–9.`
        : C.textLines(text).length > C.LINE_GAP.lines ? `Use no more than ${C.LINE_GAP.lines} lines.` : 'Enter starts a new line. The first line is nearest the driver.';
      edit(m => { m.text = text; });
    });
    const pair = (id, apply, read) => {
      for (const input of [get(id), get(`${id}Value`)]) input.addEventListener('input', event => {
        const value = event.target.valueAsNumber;
        if (!Number.isFinite(value) || !event.target.checkValidity()) return;
        edit(m => apply(m, value));
      });
      get(`${id}Value`).addEventListener('change', () => { get(`${id}Value`).value = read(); });
    };
    pair('markingGap', (m, v) => { m.gap = v; }, () => model().gap ?? C.LINE_GAP.min);
    pair('markingCrosswalkWidth', (m, v) => { m.width = v; }, () => model().width ?? C.CROSSWALK.width);
    pair('markingSpacing', (m, v) => {
      if (m === draft) m.spacing = v;
      else m.repeat = { ...(m.repeat ?? { length: 0 }), spacing: v };
    }, () => (model() === draft ? draft.spacing : model().repeat?.spacing ?? draft.spacing));
    get('markingRepeatLength').addEventListener('input', event => {
      const value = event.target.valueAsNumber, m = current();
      if (!m || !Number.isFinite(value) || value < 0) return;
      m.repeat = { ...(m.repeat ?? { spacing: draft.spacing }), length: value };
      changed();
    });
    get('markingRoute').addEventListener('input', event => {
      if (!event.target.checkValidity() || !event.target.value) return;
      edit(m => { m.route = event.target.value; });
    });
    get('markingSize').addEventListener('change', event => edit(m => { m.size = event.target.value; }));
    get('markingSpeed').addEventListener('change', event => edit(m => { m.speed = event.target.value; }));
    get('markingDot').addEventListener('change', event => edit(m => { if (event.target.checked) m.dot = true; else delete m.dot; }));
    get('markingAllLanes').addEventListener('change', event => edit(m => { if (event.target.checked) m.all = true; else delete m.all; }));
    get('markingContrast').addEventListener('change', event => edit(m => {
      const style = get('markingContrastStyle').value;
      if (m === draft) m.contrast = event.target.checked;
      else if (event.target.checked) m.contrast = style; else delete m.contrast;
    }));
    get('markingContrastStyle').addEventListener('change', event => edit(m => {
      if (m === draft) m.contrastStyle = event.target.value;
      else if (m.contrast) m.contrast = event.target.value;
    }));

    function updatePanel() {
      const sheet = sheets.selected, m = model(), item = C.find(m.type), kind = item?.kind;
      if (selectedSheet !== sheet) selected = null;
      const editing = Boolean(current());
      get('deleteMarking').disabled = !editing;
      const name = kind === 'word' ? (C.textLines(m.text).join(' / ') || 'Word marking') : item?.name ?? '';
      get('markingName').textContent = editing ? `Selected: ${name}` : name;
      const preview = { ...m };
      if (kind === 'word' && !C.textLines(m.text).length) preview.text = 'ONLY';
      if (draft === m && m.contrast) preview.contrast = m.contrastStyle;
      get('markingPreview').src = thumbnail({ ...preview, id: undefined, on: undefined, back: undefined, repeat: undefined });
      const set = (id, value) => { if (document.activeElement !== get(id)) get(id).value = value; };
      get('markingWordFields').hidden = kind !== 'word';
      if (kind === 'word') {
        set('markingText', m.text ?? '');
        set('markingGap', m.gap ?? C.LINE_GAP.min); set('markingGapValue', m.gap ?? C.LINE_GAP.min);
      }
      get('markingShieldFields').hidden = kind !== 'shield';
      get('markingRouteRow').hidden = !item?.route;
      get('markingRoute').maxLength = item?.digits ?? 3;
      get('markingRoute').pattern = `[0-9]{1,${item?.digits ?? 3}}`;
      if (kind === 'shield') { set('markingRoute', m.route ?? ''); set('markingSize', m.size ?? 'arterial'); }
      get('markingSpeedFields').hidden = m.type !== 'yieldAhead';
      get('markingCrosswalkFields').hidden = kind !== 'crosswalk';
      if (kind === 'crosswalk') { set('markingCrosswalkWidth', m.width ?? C.CROSSWALK.width); set('markingCrosswalkWidthValue', m.width ?? C.CROSSWALK.width); }
      get('markingDotRow').hidden = !item?.dot;
      get('markingDot').checked = Boolean(m.dot || m.type === 'roundabout');
      set('markingSpeed', m.speed ?? 'fast');
      get('markingLineFields').hidden = kind !== 'line';
      get('markingAllLanes').checked = Boolean(m.all);
      const contrast = m === draft ? m.contrast : Boolean(m.contrast);
      get('markingContrast').checked = contrast;
      const fixed = ['stopLine', 'yieldLine'].includes(m.type) || kind === 'crosswalk';
      get('markingContrastStyleRow').hidden = !contrast || fixed;
      set('markingContrastStyle', m === draft ? m.contrastStyle : (m.contrast || draft.contrastStyle));
      get('markingContrastHint').textContent = !contrast ? ''
        : m.type === 'stopLine' ? '4 in black border on both sides of the line.'
          : kind === 'crosswalk' ? '4 in black on both sides of every line and bar.'
          : m.type === 'yieldLine' ? 'Black block reaching 1.5 in past each triangle.'
            : (m === draft ? m.contrastStyle : m.contrast) === 'block' ? 'Black block reaching 1.5 in past the marking.' : '1.5 in black border around the marking.';
      get('markingRepeatFields').hidden = !item?.repeat;
      const spacing = m === draft ? draft.spacing : m.repeat?.spacing ?? item?.repeat ?? draft.spacing;
      set('markingSpacing', spacing); set('markingSpacingValue', spacing);
      get('markingRepeatLengthRow').hidden = !editing;
      if (editing) set('markingRepeatLength', Math.round(m.repeat?.length ?? 0));
      const copies = editing ? C.repeats(m).length : 1;
      get('markingRepeatHint').textContent = editing
        ? `${copies} ${copies === 1 ? 'marking' : 'markings'}. Drag the square handle back along the lane to repeat.`
        : 'After adding, drag its square handle back along the lane to repeat it.';
      const status = get('markingStatus').textContent;
      if (!sheet) tell('Upload a sheet first.');
      else if (!sheet.inchesPerPixel) tell(SCALE_HINT);
      else if (!editing && kind === 'word' && !C.textLines(m.text).length) tell(TYPE_HINT);
      else if (!editing && kind === 'crosswalk' && !crosswalkStart && (!status || [SCALE_HINT, TYPE_HINT, HOVER_HINT, 'Upload a sheet first.'].includes(status))) tell(CROSSWALK_HINT);
      else if (!status || [SCALE_HINT, TYPE_HINT, 'Upload a sheet first.'].includes(status) || (kind !== 'crosswalk' && status === CROSSWALK_HINT)) tell(HOVER_HINT);
    }

    // Cutting a road keeps markings where they are: before the cut, note each
    // marking's front point; afterward, move it to the piece it lies on.
    // Crosswalk ends anchored to a cut road's edge go back on whichever piece's
    // edge they lie on.
    function capture(sheet, roads) {
      const ids = roads.filter(id => id != null);
      if (!sheet.inchesPerPixel) return [];
      tracks = collect(sheet);
      const placed = [];
      for (const m of sheet.markings ?? []) {
        if (kindOf(m) === 'crosswalk') {
          for (const end of ['a', 'b']) if (ids.includes(m[end]?.on?.road)) placed.push({ marking: m, end, point: endPoint(sheet, m[end]) });
          continue;
        }
        if (!ids.includes(m.on?.road)) continue;
        const track = tracks.get(trackKey(m.on));
        if (!track) continue;
        const p = at(track, track.length - (m.back ?? 0) * ppf(sheet));
        const lane = m.on.lane, c = (p.edges[lane][0] + p.edges[lane][1]) / 2;
        placed.push({ marking: m, point: { x: p.x + p.n.x * c, y: p.y + p.n.y * c } });
      }
      return placed;
    }
    function rehome(sheet, placed) {
      if (!placed?.length) return;
      tracks = collect(sheet);
      for (const { marking, point, end } of placed) {
        if (end) { marking[end] = snapEnd(sheet, point); continue; }
        const found = locate(point);
        if (!found?.track.on.road) continue;
        marking.on = laneRef(found.track, found.lane);
        marking.back = Math.max(0, (found.track.length - found.d) / ppf(sheet));
      }
    }

    new MutationObserver(() => {
      if (panel.hidden) { hover = null; press = null; crosswalkStart = null; workspace.classList.remove('markingPlacing'); }
      updatePanel(); refreshOverlay();
    }).observe(panel, { attributes: true, attributeFilter: ['hidden'] });
    document.addEventListener('sheetview', refreshOverlay);
    for (const event of ['sheetchange', 'sheethistory']) document.addEventListener(event, () => {
      hover = null; drag = null; press = null;
      if (selectedSheet !== sheets.selected || !current()) selected = null;
      updatePanel(); refreshOverlay();
    });

    // Double-clicking a marking on the sheet opens it here, selected.
    function focusAt(point) {
      const id = hitMarking(point);
      if (!id) return false;
      app.showEditor('markingsEditor');
      showTab('lateral');
      select(id);
      return true;
    }
    // For selection: the marking at a point, and a marking's outlines.
    const hitAt = point => hitMarking(point);
    // For pasting: the lane under a point and how far back from its end (ft).
    const anchorAt = point => {
      const found = locate(point);
      return found && { on: laneRef(found.track, found.lane), back: (found.track.length - found.d) / ppf(sheets.selected) };
    };
    const outlines = id => drawn.get(id)?.copies.map(copy => copy.hit) ?? [];
    app.markings = { draw, refreshOverlay, capture, rehome, openPicker, focusAt, hitAt, anchorAt, outlines, showTab, draftType: () => draft.type, tab: () => tab };
    showTab('lateral');
    updatePanel();
    app.roadEditor.render();
    tell(HOVER_HINT);
  });
})();
