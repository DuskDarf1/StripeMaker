/* Strategic lane changes for the constant-speed simulator.
   Empirical parameter: NHTSA DOT HS 809 702 (2004), section 3, printed p.69,
   Table 3.38: 7,196 single lane changes, mean 6.28 s, SD 2.0 s, median 6.0 s.
   https://www.nhtsa.gov/sites/nhtsa.gov/files/documents/lane_change_final.pdf
   The sample is interstate/highway driving, not calibrated urban/bike traffic.
   We use the mean, not an invented probability distribution. Wider crossings
   scale time by lateral distance / 12 ft (a deliberate extrapolation).
   Quintic lateral interpolation, station discretization and route cost are
   numerical choices, NOT measured human-behavior parameters. No gap acceptance,
   cyclists, car following, obstacle avoidance or yielding are modeled here. */
(() => {
  const DURATION_SECONDS = 6.28;
  const MAX_STATIONS = 256, CURVE_SAMPLES = 48;
  const distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
  const length = points => points.slice(1).reduce((sum, p, i) => sum + distance(points[i], p), 0);
  function stationsOf(lane) {
    if (lane.stations) return lane.stations;
    const stations = [0];
    for (let i = 1; i < lane.points.length; i++) stations.push(stations.at(-1) + distance(lane.points[i - 1], lane.points[i]));
    return stations;
  }
  function sample(lane, station) {
    const stations = stationsOf(lane), points = lane.points;
    let lo = 1, hi = stations.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (stations[mid] < station) lo = mid + 1; else hi = mid; }
    const a = points[lo - 1], b = points[lo], f = Math.max(0, Math.min(1, (station - stations[lo - 1]) / (stations[lo] - stations[lo - 1] || 1)));
    const lerp = key => (a[key] ?? b[key] ?? 0) + ((b[key] ?? a[key] ?? 0) - (a[key] ?? b[key] ?? 0)) * f;
    return { x: lerp('x'), y: lerp('y'), laneWidth: lerp('laneWidth'), lateral: lerp('lateral'),
      road: lane.road, lane: lane.lane, station, direction: 1 };
  }
  function slice(lane, start, end) {
    if (start > end) return slice(lane, end, start).reverse().map(p => ({ ...p, direction: -1 }));
    const stations = stationsOf(lane);
    return [sample(lane, start), ...lane.points.filter((_, i) => stations[i] > start && stations[i] < end), sample(lane, end)];
  }
  const smooth = t => t * t * t * (10 + t * (-15 + 6 * t));
  function transition(from, to, start, end, pair, total) {
    if ((pair.blocked ?? []).some(([a, b]) => a * total < Math.max(start, end) && b * total > Math.min(start, end))) return null;
    const points = [];
    for (let i = 0; i <= CURVE_SAMPLES; i++) {
      const t = i / CURVE_SAMPLES, station = start + (end - start) * t;
      const a = sample(from, station), b = sample(to, station), u = smooth(t);
      points.push({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u,
        lateral: a.lateral + (b.lateral - a.lateral) * u,
        laneWidth: Math.min(sample(from, start).laneWidth, sample(to, end).laneWidth),
        road: from.road, lane: t < 1 ? from.lane : to.lane, direction: Math.sign(end - start), station, maneuver: { road: from.road, from: from.lane, to: to.lane, progress: t, acrossBike: Boolean(pair.crossings?.length) },
      });
    }
    // Bicycle facilities are crossings, never graph lanes. Test each actual
    // boundary crossing against existing 223.5.2 dotted/blank conflict ranges.
    // Do not require the whole approach/settling maneuver to be in those ranges.
    for (const crossing of pair.crossings ?? []) {
      let crossed = false;
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1], b = points[i];
        const boundaryAt = station => sample({ points: crossing.points, stations: stationsOf(from) }, station).lateral;
        const da = a.lateral - boundaryAt(a.station), db = b.lateral - boundaryAt(b.station);
        if (da * db > 0 || da === db) continue;
        const f = Math.abs(da) / (Math.abs(da) + Math.abs(db));
        const at = (a.station + (b.station - a.station) * f) / total;
        if (!(crossing.ranges ?? []).some(([lo, hi]) => at >= lo - 1e-8 && at <= hi + 1e-8)) return null;
        crossed = true;
      }
      if (!crossed) return null;
    }
    return points;
  }
  function network(lanes, pairs, { speed, pixelsPerFoot }) {
    if (!lanes.length || !pairs.length || !(speed > 0) || !(pixelsPerFoot > 0)) return null;
    const total = stationsOf(lanes[0]).at(-1), minimum = speed * DURATION_SECONDS;
    if (total < minimum) return null; // Never squeeze an empirical maneuver into a shorter road.
    const steps = Math.min(MAX_STATIONS, Math.max(2, Math.floor(total / (minimum / 8))));
    const key = (lane, i) => `r:${lane.road}:${lane.lane}:${i === 0 ? '0' : i === steps ? '1' : `s${i}`}`;
    const nodes = [], edges = [], byLane = new Map(lanes.map(lane => [lane.lane, lane]));
    for (const lane of lanes) {
      for (let i = 0; i <= steps; i++) nodes.push({ key: key(lane, i), point: sample(lane, total * i / steps) });
      for (let i = 0; i < steps; i++) edges.push({ from: key(lane, i), to: key(lane, i + 1), points: slice(lane, total * i / steps, total * (i + 1) / steps) });
    }
    for (const pair of pairs) for (const [a, b] of [[pair.from, pair.to], [pair.to, pair.from]]) {
      const from = byLane.get(a), to = byLane.get(b);
      if (!from || !to) continue;
      for (let i = 0; i < steps; i++) {
        const start = total * i / steps;
        // Across a bike lane the larger lateral offset takes proportionally
        // longer; this is a conservative geometric assumption, not bike data.
        const separation = Math.max(distance(sample(from, start), sample(to, start)),
          distance(sample(from, total), sample(to, total)));
        const required = minimum * Math.max(1, separation / (12 * pixelsPerFoot));
        const j = Math.ceil((start + required - 1e-8) / total * steps);
        if (j > steps || sample(from, start).laneWidth <= pixelsPerFoot || sample(to, total * j / steps).laneWidth <= pixelsPerFoot) continue;
        const end = total * j / steps, points = transition(from, to, start, end, pair, total);
        if (points) edges.push({ from: key(from, i), to: key(to, j), points,
          laneChange: { road: from.road, from: a, to: b, acrossBike: Boolean(pair.crossings?.length), duration: length(points) / speed } });
      }
    }
    return { nodes, edges };
  }
  // Personal paths are generated per driver, not drawn as route arrows.
  // Different feasible start positions are a decision-policy assumption, not
  // a measured start-position distribution. Duration comes from the driver.
  function personalize(path, lanes, pairs, { speed, pixelsPerFoot, driver, random, assess = () => 0 }) {
    const changes = path.laneChanges ?? [];
    if (!changes.length) return path.points;
    const output = [], records = new Map(lanes.map(lane => [`${lane.road}:${lane.lane}`, lane]));
    for (let first = 0; first < path.points.length;) {
      const road = path.points[first].road;
      let last = first + 1;
      while (last < path.points.length && path.points[last].road === road) last++;
      const run = path.points.slice(first, last), wanted = changes.filter(change => change.road === road);
      if (road == null || !wanted.length) { output.push(...run); first = last; continue; }
      const direction = run.at(-1).station >= run[0].station ? 1 : -1;
      const start = run[0].station, finish = run.at(-1).station, available = Math.abs(finish - start);
      const plans = wanted.map(change => {
        const from = records.get(`${road}:${change.from}`), to = records.get(`${road}:${change.to}`);
        const pair = pairs.find(pair => pair.road === road && [pair.from,pair.to].includes(change.from) && [pair.from,pair.to].includes(change.to));
        if (!from || !to || !pair) return null;
        const separation = Math.max(distance(sample(from,start),sample(to,start)),distance(sample(from,finish),sample(to,finish)));
        return { change, from, to, pair, span: speed * driver.duration * Math.max(1,separation/(12*pixelsPerFoot)) };
      });
      if (plans.some(plan => !plan) || plans.reduce((sum, plan) => sum + plan.span,0) > available + 1e-6) return null;
      let cursor = start, current = plans[0].from;
      for (let i=0;i<plans.length;i++) {
        const plan=plans[i], reserve=plans.slice(i+1).reduce((sum,next)=>sum+next.span,0);
        const earliest=cursor, latest=finish-direction*(plan.span+reserve);
        const choices=[];
        // Sample legal opportunities across the available road, ranked by
        // current traffic. These are planning samples, not random steering.
        for(let n=0;n<16;n++) {
          const at=earliest+(latest-earliest)*(n===0?0:n===1?1:random());
          const end=at+direction*plan.span;
          const points=transition(plan.from,plan.to,at,end,plan.pair,stationsOf(plan.from).at(-1));
          if(!points)continue;
          choices.push({at,end,points,score:assess({road,from:plan.change.from,to:plan.change.to,station:at,direction,
            arrival:Math.abs(at-start)/Math.max(speed,1e-9),duration:driver.duration})});
        }
        if(!choices.length)return null;
        // Uniform selection among comparably free opportunities is an explicit
        // uncalibrated policy; traffic penalties always take priority.
        const best=Math.min(...choices.map(choice=>choice.score));
        const free=choices.filter(choice=>choice.score<=best+1e-8);
        const choice=free[Math.min(free.length-1,Math.floor(random()*free.length))];
        output.push(...slice(current,cursor,choice.at),...choice.points);
        cursor=choice.end;current=plan.to;
      }
      output.push(...slice(current,cursor,finish));first=last;
    }
    return output;
  }
  const api = { DURATION_SECONDS, network, transition, sample, slice, stationsOf, length, personalize };
  (globalThis.StripeMaker ??= {}).simulatorLaneChanges = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
