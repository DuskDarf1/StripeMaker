/* Intersection geometry is in feet relative to the object's sheet-pixel origin.
   These are editable layout defaults, not pavement-marking standards. No paint
   is generated here. Road attachment dimensions come from the road renderer. */
(() => {
  const id = () => globalThis.crypto.randomUUID();
  const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
  const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
  const mul = (a, k) => ({ x: a.x * k, y: a.y * k });
  const dot = (a, b) => a.x * b.x + a.y * b.y;
  const cross = (a, b) => a.x * b.y - a.y * b.x;
  const length = (a) => Math.hypot(a.x, a.y);
  const unit = (a) => mul(a, 1 / (length(a) || 1));
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const degrees = (a) => ((a % 360) + 360) % 360;
  const axes = (a) => {
    const t = (a.angle * Math.PI) / 180;
    return { u: { x: Math.cos(t), y: Math.sin(t) }, n: { x: -Math.sin(t), y: Math.cos(t) } };
  };
  // Two-way approaches keep the same centerline spacing as two-way roads: two
  // 6" double yellow lines with a 4" gap, dimensioned to the centerline of the
  // markings (FDOT Standard Plans Index 711-001, "Double Solid Lines"), so a
  // road's lanes line up with an approach's lanes. A median adds to it.
  const DOUBLE_YELLOW_FEET = (6 + 4) / 12;
  const gap = (a) => (a.incoming && a.outgoing ? (a.gap ?? (a.median ?? 0) + DOUBLE_YELLOW_FEET) : 0);
  const width = (a, incoming) => (incoming ? a.width : (a.outWidth ?? a.width));
  const local = (a, d, along = 0) => {
    const { u, n } = axes(a);
    return add(a, add(mul(n, d), mul(u, along)));
  };
  // Besides the center median between the two directions, an approach can split
  // lanes going the same way with more medians (channelizing islands):
  // a.splits = [{ id, incoming, after, width, nose, surface }], a median between
  // lane `after - 1` and lane `after` of that side, counted from the center.
  const splits = (a, incoming) =>
    (a.splits ?? [])
      .filter((s) => s.incoming === incoming && s.after > 0 && s.after < (incoming ? a.incoming : a.outgoing))
      .sort((x, y) => x.after - y.after);
  const splitWidth = (a, incoming, below = Infinity) =>
    splits(a, incoming).reduce((sum, s) => sum + (s.after <= below ? s.width : 0), 0);
  const side = (a, incoming, margin = 0) =>
    (incoming ? -1 : 1) *
    (gap(a) / 2 +
      (incoming ? a.incoming : a.outgoing) * width(a, incoming) +
      splitWidth(a, incoming) +
      margin);
  const edge = (a, incoming, margin = 0) => local(a, side(a, incoming, margin));
  const lane = (a, incoming, index) =>
    local(
      a,
      (incoming ? -1 : 1) *
        (gap(a) / 2 + (index + 0.5) * width(a, incoming) + splitWidth(a, incoming, index)),
    );
  // Center offset of a split median, and the lane boundary it sits on.
  const splitCenter = (a, s) =>
    (s.incoming ? -1 : 1) *
    (gap(a) / 2 + s.after * width(a, s.incoming) + splitWidth(a, s.incoming, s.after - 1) + s.width / 2);
  const boundary = (a, incoming, after) =>
    (incoming ? -1 : 1) * (gap(a) / 2 + after * width(a, incoming) + splitWidth(a, incoming, after - 1));
  function normalize(item) {
    item.movements ??= [];
    item.rotation ??= 0;
    for (const a of item.approaches) {
      if (!Number.isFinite(a.x) || !Number.isFinite(a.y)) Object.assign(a, mul(axes(a).u, a.distance ?? 100));
      a.radius ??= 20;
      a.nose ??= Math.max(20, length(a) - 40);
      a.surface ??= "grass";
      a.inLanes ??= [];
      a.outLanes ??= [];
      while (a.inLanes.length < a.incoming) a.inLanes.push(id());
      while (a.outLanes.length < a.outgoing) a.outLanes.push(id());
      a.inLanes.length = a.incoming;
      a.outLanes.length = a.outgoing;
      a.outWidth ??= a.width;
      if (a.splits) {
        a.splits = a.splits.filter((s) => s.after > 0 && s.after < (s.incoming ? a.incoming : a.outgoing));
        for (const s of a.splits) {
          s.id ??= id();
          s.nose ??= 50;
          s.surface ??= "concrete";
        }
        if (!a.splits.length) delete a.splits;
      }
    }
    for (const m of item.movements) {
      const a = item.approaches.find((a) => a.id === m.from),
        b = item.approaches.find((a) => a.id === m.to);
      m.id ??= id();
      m.input ??= a?.inLanes[m.lane];
      m.output ??= b?.outLanes[m.out];
      m.pullIn ??= m.pull ?? 50;
      m.pullOut ??= m.pull ?? 50;
    }
    item.movements = item.movements.filter(
      (m) =>
        item.approaches.some((a) => a.id === m.from && a.inLanes.includes(m.input)) &&
        item.approaches.some((a) => a.id === m.to && a.outLanes.includes(m.output)),
    );
    return item;
  }
  // New openings sit this far (ft) from the center: past a 20 ft corner radius
  // with room for the lane arrows, so a default intersection stays compact.
  const REACH = 55;
  function approach(angle) {
    const a = {
      id: id(),
      angle,
      incoming: 1,
      outgoing: 1,
      width: 12,
      outWidth: 12,
      median: 0,
      radius: 20,
      nose: 60,
      surface: "grass",
      ...mul(axes({ angle }).u, REACH),
    };
    return a;
  }
  function movement(a, i, b, j) {
    return {
      id: id(),
      from: a.id,
      input: a.inLanes[i],
      to: b.id,
      output: b.outLanes[j],
      pullIn: 50,
      pullOut: 50,
      autoCurve: true,
    };
  }
  function auto(item, only = null) {
    normalize(item);
    for (const a of item.approaches)
      for (let i = 0; i < a.incoming; i++) {
        if (only && !only.has(a.inLanes[i])) continue;
        for (const b of item.approaches) {
          if (a === b || !b.outgoing) continue;
          const turn = degrees(b.angle - a.angle - 180);
          const through = turn < 45 || turn > 315;
          if (through || (turn > 180 ? i === 0 : i === a.incoming - 1)) {
            const j = through ? Math.min(i, b.outgoing - 1) : turn > 180 ? 0 : b.outgoing - 1;
            if (!item.movements.some((m) => m.input === a.inLanes[i] && m.output === b.outLanes[j]))
              item.movements.push(movement(a, i, b, j));
          }
        }
      }
  }
  function create() {
    const item = {
      id: id(),
      name: "Intersection",
      x: 0,
      y: 0,
      rotation: 0,
      approaches: [0, 90, 180, 270].map(approach),
      movements: [],
    };
    return item;
  }
  const ordered = (item) => [...item.approaches].sort((a, b) => Math.atan2(a.y, a.x) - Math.atan2(b.y, b.x));
  // The concave corner is the intersection of neighboring approach edge rays.
  // A circular fillet is sampled into M/L/Z paths for the vector PDF writer.
  function corner(a, b, margin = 0) {
    const p = edge(a, false, margin),
      q = edge(b, true, margin),
      u = axes(a).u,
      v = axes(b).u;
    const den = cross(u, v);
    if (Math.abs(den) < 1e-6) return { points: [p, q], center: mul(add(p, q), 0.5), radius: 0 };
    const t = cross(sub(q, p), v) / den,
      s = cross(sub(q, p), u) / den;
    const at = add(p, mul(u, t));
    if (t > 0 || s > 0 || length(at) > Math.max(length(a), length(b)) * 2)
      return { points: [p, q], center: mul(add(p, q), 0.5), radius: 0 };
    const theta = Math.acos(clamp(dot(u, v), -1, 1));
    const radius = Math.min(a.radius, Math.max(0, Math.min(-t, -s) * 0.9 * Math.tan(theta / 2)));
    if (radius < 0.001) return { points: [p, at, q], center: at, radius: 0 };
    const d = radius / Math.tan(theta / 2),
      start = add(at, mul(u, d)),
      end = add(at, mul(v, d));
    const center = add(at, mul(unit(add(u, v)), radius / Math.sin(theta / 2)));
    let delta =
      Math.atan2(end.y - center.y, end.x - center.x) - Math.atan2(start.y - center.y, start.x - center.x);
    while (delta > Math.PI) delta -= 2 * Math.PI;
    while (delta < -Math.PI) delta += 2 * Math.PI;
    const angle = Math.atan2(start.y - center.y, start.x - center.x),
      points = [p];
    for (let i = 0; i <= 24; i++) {
      const t = angle + (delta * i) / 24;
      points.push(add(center, { x: Math.cos(t) * radius, y: Math.sin(t) * radius }));
    }
    points.push(q);
    return { points, center: points[13], radius };
  }
  function outline(item, margin = 0) {
    const roads = ordered(item),
      points = [];
    for (let i = 0; i < roads.length; i++) {
      const a = roads[i],
        b = roads[(i + 1) % roads.length];
      points.push(edge(a, true, margin), ...corner(a, b, margin).points);
    }
    return points;
  }
  // How far a median reaches in from the mouth: its nose setback, kept 5 ft
  // inside the approach and at least as long as its rounded tip.
  const reach = (a, half, nose) => clamp(nose, half, Math.max(half, length(a) - 5));
  // A median band from the mouth inward, with a rounded nose.
  function band(a, center, half, noseLength) {
    const nose = reach(a, half, noseLength);
    const points = [local(a, center - half), local(a, center - half, -nose + half)];
    for (let i = 0; i <= 24; i++) {
      const t = (Math.PI * i) / 24;
      points.push(local(a, center - Math.cos(t) * half, -nose + half - Math.sin(t) * half));
    }
    points.push(local(a, center + half));
    return points;
  }
  function median(a) {
    if (!a.incoming || !a.outgoing || !(a.median > 0.01)) return [];
    return band(a, 0, a.median / 2, a.nose);
  }
  // Every median of an approach: the center one and any splits.
  function medians(a) {
    const list = [];
    const center = median(a);
    if (center.length)
      list.push({ key: "median", points: center, surface: a.surface, nose: a.nose, center: 0 });
    for (const incoming of [true, false])
      for (const s of splits(a, incoming))
        if (s.width > 0.01)
          list.push({
            key: `split-${s.id}`,
            split: s,
            points: band(a, splitCenter(a, s), s.width / 2, s.nose),
            surface: s.surface,
            nose: s.nose,
            center: splitCenter(a, s),
          });
    return list;
  }
  function pulls(item, m) {
    if (!m.autoCurve) return [m.pullIn, m.pullOut];
    const a = item.approaches.find((a) => a.id === m.from),
      b = item.approaches.find((a) => a.id === m.to);
    const p = lane(a, true, a.inLanes.indexOf(m.input)),
      q = lane(b, false, b.outLanes.indexOf(m.output));
    const u = axes(a).u,
      v = axes(b).u,
      den = cross(u, v);
    if (a === b) return [Math.max(30, a.nose + 20), Math.max(30, a.nose + 20)];
    if (Math.abs(den) < 0.01) return [length(sub(p, q)) / 3, length(sub(p, q)) / 3];
    return [
      clamp(-cross(sub(q, p), v) / den, 10, 2 * length(p)),
      clamp(-cross(sub(q, p), u) / den, 10, 2 * length(q)),
    ];
  }
  function curve(item, m) {
    const a = item.approaches.find((a) => a.id === m.from),
      b = item.approaches.find((a) => a.id === m.to);
    if (!a || !b) return null;
    const i = a.inLanes.indexOf(m.input),
      j = b.outLanes.indexOf(m.output);
    if (i < 0 || j < 0) return null;
    const p = lane(a, true, i),
      q = lane(b, false, j),
      [entry, exit] = pulls(item, m);
    return [p, sub(p, mul(axes(a).u, entry)), sub(q, mul(axes(b).u, exit)), q];
  }
  function sample(c, t) {
    const u = 1 - t;
    return add(
      add(mul(c[0], u * u * u), mul(c[1], 3 * u * u * t)),
      add(mul(c[2], 3 * u * t * t), mul(c[3], t * t * t)),
    );
  }
  function intersects(a, b, c, d) {
    const u = sub(b, a),
      v = sub(d, c),
      den = cross(u, v);
    if (Math.abs(den) < 1e-8) return false;
    const t = cross(sub(c, a), v) / den,
      s = cross(sub(c, a), u) / den;
    return t > 1e-6 && t < 1 - 1e-6 && s > 1e-6 && s < 1 - 1e-6;
  }
  // Lane routes are geometry, not clipped artwork. Fit tangent arcs to the
  // available pavement (including median noses), with a visibility-path fallback
  // for skewed/multi-leg layouts. No segment is discarded at the pavement edge.
  function contains(p, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const a = polygon[i],
        b = polygon[j];
      if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  }
  function distanceToSegment(p, a, b) {
    const d = sub(b, a),
      t = clamp(dot(sub(p, a), d) / (dot(d, d) || 1), 0, 1);
    return length(sub(p, add(a, mul(d, t))));
  }
  // How far from the center an approach's curbs start curving into its
  // neighbors: turning paths begin and end inside that, like real turns.
  function throat(item, a) {
    const list = ordered(item),
      i = list.indexOf(a),
      next = list[(i + 1) % list.length],
      prev = list[(i + list.length - 1) % list.length],
      u = axes(a).u;
    const after = corner(a, next).points,
      before = corner(prev, a).points;
    return Math.max(
      dot(after[Math.min(1, after.length - 1)], u),
      dot(before[Math.max(0, before.length - 2)], u),
    );
  }
  function routing(item, margin = 0) {
    const polygon = outline(item, margin),
      holes = item.approaches.flatMap((a) => medians(a).map((m) => m.points));
    return { polygon, holes };
  }
  function route(item, m, region = routing(item)) {
    const a = item.approaches.find((a) => a.id === m.from),
      b = item.approaches.find((a) => a.id === m.to),
      c = curve(item, m);
    if (!c) return [];
    const p = c[0],
      q = c[3],
      u = axes(a).u,
      v = axes(b).u;
    const nearBoundary = (point, poly) =>
      poly.some((x, i) => distanceToSegment(point, x, poly[(i + 1) % poly.length]) < 0.002);
    const inside = (point) =>
      (contains(point, region.polygon) || nearBoundary(point, region.polygon)) &&
      !region.holes.some((h) => contains(point, h) && !nearBoundary(point, h));
    const safe = (points) => points.every(inside);
    const sampleLine = (p, q) => {
      const count = Math.max(2, Math.ceil(length(sub(q, p)) / 2));
      return Array.from({ length: count + 1 }, (_, i) => add(p, mul(sub(q, p), i / count)));
    };
    const joinLines = (points) => points.flatMap((p, i) => (i ? sampleLine(points[i - 1], p).slice(1) : [p]));
    const bezierPoints = Array.from({ length: 129 }, (_, i) => sample(c, i / 128));
    if (!m.autoCurve && safe(bezierPoints)) return bezierPoints;
    const den = cross(u, v);
    if (Math.abs(den) > 0.01) {
      const t = cross(sub(q, p), v) / den,
        s = cross(sub(q, p), u) / den;
      const at = add(p, mul(u, t)),
        theta = Math.acos(clamp(dot(u, v), -1, 1));
      if (t < 0 && s < 0 && inside(at)) {
        // The largest safe tangent arc tracks the actual pavement corner. Keep
        // a lane-center clearance from its edge rather than hugging the outline.
        const clearance = Math.min(width(a, true), width(b, false)) * 0.4;
        const clear = (point) => {
          if (!inside(point)) return false;
          for (let i = 0; i < region.polygon.length; i++) {
            const x = region.polygon[i],
              y = region.polygon[(i + 1) % region.polygon.length];
            const onMouth = [a, b].some(
              (end) =>
                Math.abs(dot(sub(x, end), axes(end).u)) < 0.01 &&
                Math.abs(dot(sub(y, end), axes(end).u)) < 0.01,
            );
            if (!onMouth && distanceToSegment(point, x, y) < clearance) return false;
          }
          return !region.holes.some((h) =>
            h.some((x, i) => distanceToSegment(point, x, h[(i + 1) % h.length]) < clearance),
          );
        };
        const max = Math.max(
          0,
          Math.min(-t * 0.98, -s * 0.98, throat(item, a) - dot(at, u), throat(item, b) - dot(at, v)),
        );
        for (let k = 24; k >= 0; k--) {
          const d = (max * k) / 24,
            r = d * Math.tan(theta / 2);
          let points;
          if (d < 0.001) points = joinLines([p, at, q]);
          else {
            const start = add(at, mul(u, d)),
              end = add(at, mul(v, d)),
              center = add(at, mul(unit(add(u, v)), r / Math.sin(theta / 2)));
            const angle = Math.atan2(start.y - center.y, start.x - center.x);
            let delta = Math.atan2(end.y - center.y, end.x - center.x) - angle;
            while (delta > Math.PI) delta -= 2 * Math.PI;
            while (delta < -Math.PI) delta += 2 * Math.PI;
            const arc = Array.from({ length: 49 }, (_, i) =>
              add(center, {
                x: Math.cos(angle + (delta * i) / 48) * r,
                y: Math.sin(angle + (delta * i) / 48) * r,
              }),
            );
            points = [...sampleLine(p, start), ...arc.slice(1), ...sampleLine(end, q).slice(1)];
          }
          if (points.every(clear)) return points;
        }
        if (safe(joinLines([p, at, q]))) return rounded(joinLines([p, at, q]), inside);
      }
    }
    if (safe(bezierPoints)) return bezierPoints;
    // A shortest visible path around concave corners and median noses. Vertices
    // are nudged into pavement so the following corner smoothing stays inside.
    const entry = sub(p, mul(u, Math.min(10, length(a) / 4))),
      exit = sub(q, mul(v, Math.min(10, length(b) / 4)));
    const nodes = [entry, exit];
    for (const poly of [region.polygon, ...region.holes])
      for (let i = 0; i < poly.length; i++) {
        const at = poly[i],
          prev = poly[(i + poly.length - 1) % poly.length],
          next = poly[(i + 1) % poly.length];
        if (Math.abs(cross(unit(sub(at, prev)), unit(sub(next, at)))) < 0.001) continue;
        for (const d of [
          { x: 1, y: 0 },
          { x: -1, y: 0 },
          { x: 0, y: 1 },
          { x: 0, y: -1 },
        ]) {
          const candidate = add(at, mul(d, 0.3));
          if (inside(candidate)) {
            nodes.push(candidate);
            break;
          }
        }
      }
    const visible = (a, b) => safe(sampleLine(a, b));
    const distances = nodes.map(() => Infinity),
      previous = nodes.map(() => -1),
      visited = new Set();
    distances[0] = 0;
    for (let count = 0; count < nodes.length; count++) {
      let best = -1;
      for (let i = 0; i < nodes.length; i++)
        if (!visited.has(i) && (best < 0 || distances[i] < distances[best])) best = i;
      if (best < 0 || !Number.isFinite(distances[best])) break;
      if (best === 1) break;
      visited.add(best);
      for (let j = 0; j < nodes.length; j++) {
        if (visited.has(j) || j === best) continue;
        const d = distances[best] + length(sub(nodes[j], nodes[best]));
        if (d < distances[j] && visible(nodes[best], nodes[j])) {
          distances[j] = d;
          previous[j] = best;
        }
      }
    }
    if (Number.isFinite(distances[1])) {
      const points = [];
      for (let i = 1; i !== -1; i = previous[i]) points.unshift(nodes[i]);
      return rounded([p, ...points, q], inside);
    }
    // Valid layouts ordinarily have a connected central pavement. Preserve a
    // continuous route through its center if a nearly degenerate opening cannot
    // support the preferred smoothing.
    return rounded([p, entry, { x: 0, y: 0 }, exit, q], inside);
  }
  // Movements between the same two approaches (two or three throughs, dual
  // turns) must not cross or crowd each other. When automatic routes do, each is
  // redrawn as an offset of one shared base route, easing from its lane offset at
  // the entry to its lane offset at the exit, so the group stays parallel.
  function polylineDistance(p, q) {
    let best = Infinity;
    for (const x of p)
      for (let i = 1; i < q.length; i++) best = Math.min(best, distanceToSegment(x, q[i - 1], q[i]));
    return best;
  }
  function crosses(p, q) {
    for (let i = 1; i < p.length; i++)
      for (let j = 1; j < q.length; j++) if (intersects(p[i - 1], p[i], q[j - 1], q[j])) return true;
    return false;
  }
  // The middle part of a route, away from the lane ends where neighbors are
  // exactly one lane apart by construction.
  function middle(points) {
    const n = points.length;
    return n < 6 ? points : points.slice(Math.floor(n * 0.15), Math.ceil(n * 0.85));
  }
  function offsetRoute(base, start, end) {
    const lengths = [0];
    for (let i = 1; i < base.length; i++) lengths.push(lengths[i - 1] + length(sub(base[i], base[i - 1])));
    const total = lengths.at(-1) || 1;
    return base.map((p, i) => {
      const before = base[Math.max(0, i - 1)],
        after = base[Math.min(base.length - 1, i + 1)],
        t = unit(sub(after, before)),
        n = { x: -t.y, y: t.x },
        f = lengths[i] / total,
        eased = f * f * (3 - 2 * f);
      return add(p, mul(n, start + (end - start) * eased));
    });
  }
  function routes(item, region = routing(item)) {
    const paths = new Map(item.movements.map((m) => [m.id, route(item, m, region)]));
    const groups = new Map();
    for (const m of item.movements) {
      const key = `${m.from}>${m.to}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(m);
    }
    for (const group of groups.values()) {
      const automatic = group.filter((m) => m.autoCurve && paths.get(m.id)?.length > 1);
      if (automatic.length < 2) continue;
      const a = item.approaches.find((x) => x.id === group[0].from),
        b = item.approaches.find((x) => x.id === group[0].to);
      const spacing = Math.min(width(a, true), width(b, false)) * 0.6;
      const conflict = automatic.some((m, i) =>
        automatic.slice(i + 1).some((k) => {
          const p = paths.get(m.id),
            q = paths.get(k.id);
          return crosses(p, q) || polylineDistance(middle(p), middle(q)) < spacing;
        }),
      );
      if (!conflict) continue;
      // The base is the innermost route of a turn (the middle one for throughs):
      // offsets toward the outside of a curve stay smooth, while offsets toward
      // the inside can fold back on a tight corner.
      const sorted = [...automatic].sort((m, k) => a.inLanes.indexOf(m.input) - a.inLanes.indexOf(k.input));
      const u = axes(a).u,
        v = axes(b).u,
        turn = cross(mul(u, -1), v),
        towardCenter = { x: u.y, y: -u.x },
        offsetOf = (m) => dot(curve(item, m)[0], towardCenter);
      if (Math.abs(turn) > 0.1) sorted.sort((m, k) => (offsetOf(k) - offsetOf(m)) * Math.sign(turn));
      const base = paths.get(sorted[Math.abs(turn) > 0.1 ? 0 : Math.floor((sorted.length - 1) / 2)].id);
      const startNormal = (() => {
          const t = unit(sub(base[1], base[0]));
          return { x: -t.y, y: t.x };
        })(),
        endNormal = (() => {
          const t = unit(sub(base.at(-1), base.at(-2)));
          return { x: -t.y, y: t.x };
        })();
      const inside = (point) =>
        contains(point, region.polygon) && !region.holes.some((h) => contains(point, h));
      for (const m of automatic) {
        const c = curve(item, m);
        const offset = offsetRoute(
          base,
          dot(sub(c[0], base[0]), startNormal),
          dot(sub(c[3], base.at(-1)), endNormal),
        );
        offset[0] = c[0];
        offset[offset.length - 1] = c[3];
        if (middle(offset).every(inside)) paths.set(m.id, offset);
      }
    }
    return paths;
  }
  function rounded(points, inside) {
    // Simplify collinear samples, then round each waypoint only as far as the
    // pavement permits. Endpoints and their lane-direction leads stay fixed.
    const line = points.filter(
      (p, i) =>
        !i ||
        i === points.length - 1 ||
        Math.abs(cross(unit(sub(p, points[i - 1])), unit(sub(points[i + 1], p)))) > 0.001,
    );
    const result = [line[0]];
    for (let i = 1; i < line.length - 1; i++) {
      const p = line[i],
        before = line[i - 1],
        after = line[i + 1];
      let accepted = null;
      for (let fraction = 0.4; fraction > 0.005; fraction /= 2) {
        const d = Math.min(length(sub(p, before)), length(sub(after, p))) * fraction,
          start = add(p, mul(unit(sub(before, p)), d)),
          end = add(p, mul(unit(sub(after, p)), d));
        const curve = Array.from({ length: 25 }, (_, i) => {
          const t = i / 24,
            u = 1 - t;
          return add(add(mul(start, u * u), mul(p, 2 * u * t)), mul(end, t * t));
        });
        if (curve.every(inside)) {
          accepted = curve;
          break;
        }
      }
      result.push(...(accepted ?? [p]));
    }
    result.push(line.at(-1));
    return result;
  }

  function validate(item) {
    if (item.approaches.length < 2) return "Keep at least two approaches.";
    for (const a of item.approaches) {
      if (
        ![a.x, a.y, a.angle, a.width, a.outWidth, a.incoming, a.outgoing, a.median, a.radius, a.nose].every(
          Number.isFinite,
        )
      )
        return "Enter valid approach dimensions.";
      if (!a.incoming && !a.outgoing) return "Each approach needs at least one lane.";
      if ((a.splits ?? []).some((s) => ![s.width, s.nose].every(Number.isFinite) || s.width < 0))
        return "Enter valid median dimensions.";
      if (length(a) < 20 || dot(unit(a), axes(a).u) < 0.25)
        return "Keep approach openings outside the center and facing outward.";
    }
    // Check the last lane-width of each opening as oriented rectangles, including
    // parallel/collinear overlaps that a segment-crossing test alone misses.
    const rectangles = item.approaches.map((a) => [
      edge(a, true),
      edge(a, false),
      sub(edge(a, false), mul(axes(a).u, Math.max(a.width, a.outWidth))),
      sub(edge(a, true), mul(axes(a).u, Math.max(a.width, a.outWidth))),
    ]);
    for (let i = 0; i < rectangles.length; i++)
      for (let j = i + 1; j < rectangles.length; j++) {
        const a = rectangles[i],
          b = rectangles[j],
          axesToTest = [
            axes(item.approaches[i]).u,
            axes(item.approaches[i]).n,
            axes(item.approaches[j]).u,
            axes(item.approaches[j]).n,
          ];
        const separate = axesToTest.some((axis) => {
          const aa = a.map((p) => dot(p, axis)),
            bb = b.map((p) => dot(p, axis));
          return Math.max(...aa) <= Math.min(...bb) + 0.01 || Math.max(...bb) <= Math.min(...aa) + 0.01;
        });
        if (!separate) return "Approach openings overlap. Move them apart or reduce their widths.";
      }
    const points = outline(item);
    for (let i = 0; i < points.length; i++)
      for (let j = i + 2; j < points.length; j++)
        if (
          intersects(points[i], points[(i + 1) % points.length], points[j], points[(j + 1) % points.length])
        )
          return "Approach openings overlap. Move them apart or reduce their widths.";
    return "";
  }
  const api = {
    id,
    add,
    sub,
    mul,
    dot,
    length,
    unit,
    clamp,
    degrees,
    axes,
    gap,
    width,
    local,
    side,
    edge,
    lane,
    splits,
    splitCenter,
    boundary,
    normalize,
    approach,
    movement,
    auto,
    create,
    ordered,
    corner,
    outline,
    median,
    medians,
    pulls,
    curve,
    sample,
    validate,
    contains,
    routing,
    route,
    routes,
    throat,
    reach,
    REACH,
  };
  (globalThis.StripeMaker ??= {}).intersectionGeometry = api;
  if (typeof module !== "undefined") module.exports = api;
})();
