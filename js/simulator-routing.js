/* Directed lane routing shared by simulator interaction and regression tests.
   Permitted turns plus timed, strategic lane changes. No nearest-road jumps
   or wrong-way edges; bicycle facilities are crossed, never driven along. */
(() => {
  const laneChanges = typeof module !== 'undefined' ? require('./simulator-lane-changes.js') : globalThis.StripeMaker.simulatorLaneChanges;
  const pathLength = points => points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - points[i].x, p.y - points[i].y), 0);
  const less = (a, b) => a.changes < b.changes || a.changes === b.changes && a.distance < b.distance;
  class Queue {
    constructor() { this.items = []; }
    push(value) {
      const items = this.items; let i = items.length; items.push(value);
      while (i > 0) { const parent = (i - 1) >> 1; if (!less(value, items[parent])) break; items[i] = items[parent]; i = parent; }
      items[i] = value;
    }
    pop() {
      const items = this.items, first = items[0], last = items.pop();
      if (items.length) {
        let i = 0;
        while (i * 2 + 1 < items.length) {
          let child = i * 2 + 1;
          if (child + 1 < items.length && less(items[child + 1], items[child])) child++;
          if (!less(items[child], last)) break;
          items[i] = items[child]; i = child;
        }
        items[i] = last;
      }
      return first;
    }
  }
  const laneKey = ref => `r:${ref.road}:${ref.lane}`;
  const portKey = (intersection, lane) => `i:${intersection}:${lane}`;
  const endpoint = (ref, e) => `${laneKey(ref)}:${e}`;
  function build(sheet, roads, intersections, reversed = false, pairOf = () => null, options = {}) {
    const nodes = new Map(), adjacency = new Map(), lanes = new Map();
    const occupied = new Set();
    const edge = (from, to, points, laneChange = null) => {
      if (!nodes.has(from) || !nodes.has(to)) return;
      if (reversed) {
        [from, to] = [to, from];
        points = [...points].reverse().map(p => ({ ...p, ...(p.road != null ? { direction: -1 } : {}),
          ...(p.maneuver ? { lane: p.maneuver.progress > 0 ? p.maneuver.to : p.maneuver.from,
            maneuver: { ...p.maneuver, from: p.maneuver.to, to: p.maneuver.from, progress: 1 - p.maneuver.progress } } : {}) }));
        if (laneChange) laneChange = { ...laneChange, from: laneChange.to, to: laneChange.from };
      }
      const list = adjacency.get(from) ?? [];
      if (!list.some(e => e.to === to)) list.push({ to, points, laneChange, distance: pathLength(points) });
      adjacency.set(from, list);
    };
    for (const lane of roads.lanes) {
      lanes.set(laneKey(lane), lane);
      nodes.set(endpoint(lane, 0), lane.points[0]);
      nodes.set(endpoint(lane, 1), lane.points.at(-1));
    }
    const changedRoads = new Set();
    const pixelsPerFoot = options.pixelsPerFoot ?? (sheet.inchesPerPixel > 0 ? 12 / sheet.inchesPerPixel : 0);
    const speed = options.speed ?? 44 * pixelsPerFoot;
    for (const road of sheet.roads) {
      const network = laneChanges.network(roads.lanes.filter(lane => lane.road === road.id),
        (roads.laneChangePairs ?? []).filter(pair => pair.road === road.id), { speed, pixelsPerFoot });
      if (!network) continue;
      changedRoads.add(road.id);
      for (const node of network.nodes) nodes.set(node.key, node.point);
      for (const item of network.edges) edge(item.from, item.to, item.points, item.laneChange);
    }
    for (const lane of roads.lanes) if (!changedRoads.has(lane.road)) edge(endpoint(lane, 0), endpoint(lane, 1), lane.points);
    for (const link of roads.connections) {
      const a = endpoint(link.from, 1), b = endpoint(link.to, 0);
      if (nodes.has(a) && nodes.has(b)) edge(a, b, [nodes.get(a), nodes.get(b)]);
    }
    for (const port of intersections.ports) {
      const key = portKey(port.intersection, port.lane);
      for (const ref of port.ends) {
        const end = endpoint(ref, ref.e);
        if (!nodes.has(end)) continue;
        occupied.add(`${ref.road}:${ref.e}`);
        nodes.set(key, nodes.get(end));
      }
    }
    for (const m of intersections.movements) {
      const input = portKey(m.intersection, m.input), output = portKey(m.intersection, m.output);
      // Unattached ports still permit paths between attached mouths via an
      // explicitly linked internal movement; they are never road exits.
      if (!nodes.has(input)) nodes.set(input, m.points[0]);
      if (!nodes.has(output)) nodes.set(output, m.points.at(-1));
      edge(input, output, m.points);
    }
    for (const port of intersections.ports) for (const ref of port.ends) {
      const end = endpoint(ref, ref.e), key = portKey(port.intersection, port.lane);
      if (!nodes.has(end) || !nodes.has(key) || !lanes.get(laneKey(ref))?.open[ref.e]) continue;
      edge(ref.e ? end : key, ref.e ? key : end, ref.e ? [nodes.get(end), nodes.get(key)] : [nodes.get(key), nodes.get(end)]);
    }
    function terminal(ref, e) {
      const road = sheet.roads.find(r => r.id === ref.road), partner = pairOf(sheet, road);
      if (!road || occupied.has(`${ref.road}:${e}`)) return false;
      const joint = road.ends[e].joint;
      return !sheet.roads.some(other => other !== road && other !== partner && other.ends.some(end => end.joint === joint));
    }
    const startEnd = reversed ? 1 : 0, exitEnd = 1 - startEnd;
    const entrances = [], exits = [];
    for (const lane of roads.lanes) {
      const ref = { road: lane.road, lane: lane.lane };
      if (lane.open[startEnd] && terminal(ref, startEnd)) entrances.push({ ...ref, e: startEnd, point: nodes.get(endpoint(ref, startEnd)) });
      if (lane.open[exitEnd] && terminal(ref, exitEnd)) exits.push({ ...ref, e: exitEnd, point: nodes.get(endpoint(ref, exitEnd)) });
    }
    const searchCache = new Map();
    function search(source) {
      if (!entrances.some(ref => ref.road === source.road && ref.lane === source.lane && (source.e ?? 0) === ref.e)) return new Map();
      return pathsFrom(endpoint(source,startEnd));
    }
    function pathsFrom(start) {
      if(searchCache.has(start))return searchCache.get(start);
      const previous = new Map([[start, null]]), queue = new Queue();
      const best = new Map([[start, { changes: 0, distance: 0 }]]);
      queue.push({ node: start, changes: 0, distance: 0 });
      while (queue.items.length) {
        const current = queue.pop(), from = current.node, cost = best.get(from);
        if (current.changes !== cost.changes || current.distance !== cost.distance) continue;
        for (const edge of adjacency.get(from) ?? []) {
          const next = { node: edge.to, changes: current.changes + Number(Boolean(edge.laneChange)), distance: current.distance + edge.distance };
          if (best.has(edge.to) && !less(next, best.get(edge.to))) continue;
          best.set(edge.to, next); previous.set(edge.to, { from, ...edge }); queue.push(next);
        }
      }
      const paths = new Map();
      for (const exit of exits) {
        let at = endpoint(exit, exitEnd);
        if (!previous.has(at)) continue;
        const pieces = [];
        while (at !== start) { const step = previous.get(at); pieces.push(step); at = step.from; }
        const points = [], changes = []; let walked = 0;
        for (const piece of pieces.reverse()) {
          const startDistance = walked;
          for (const p of piece.points) {
            const last = points.at(-1), distance = last ? Math.hypot(last.x - p.x, last.y - p.y) : 0;
            if (!last || distance > 1e-6) { points.push(p); walked += distance; }
            else if (p.maneuver) points[points.length - 1] = p;
          }
          if (piece.laneChange) changes.push({ ...piece.laneChange, startDistance, endDistance: walked });
        }
        paths.set(laneKey(exit), { exit, points, laneChanges: changes });
      }
      searchCache.set(start, paths);
      return paths;
    }
    const laneRecords=new Map(roads.lanes.map(lane=>[laneKey(lane),lane]));
    // Replanning is frequent in queues; group station nodes once per network.
    const stationNodes=new Map();
    for(const entry of nodes)if(entry[1].road!=null){
      const key=laneKey(entry[1]);if(!stationNodes.has(key))stationNodes.set(key,[]);
      stationNodes.get(key).push(entry);
    }
    for(const entries of stationNodes.values())entries.sort((a,b)=>a[1].station-b[1].station);
    function continueFrom(state,exit) {
      const lane=laneRecords.get(laneKey(state));if(!lane)return null;
      const direction=reversed?-1:1;
      const entries=stationNodes.get(laneKey(state))??[];
      let low=0,high=entries.length;
      const threshold=state.station-direction*1e-7;
      while(low<high){const mid=(low+high)>>1;if(entries[mid][1].station<threshold)low=mid+1;else high=mid;}
      const next=direction===1?entries[low]:(entries[low]?.[1].station===threshold?entries[low]:entries[low-1]);
      if(!next)return null;
      const path=pathsFrom(next[0]).get(laneKey(exit));if(!path)return null;
      const prefix=laneChanges.slice(lane,state.station,next[1].station),shift=pathLength(prefix);
      return {...path,points:[...prefix,...path.points],laneChanges:path.laneChanges.map(change=>({...change,startDistance:change.startDistance+shift,endDistance:change.endDistance+shift}))};
    }
    function personalize(path,driver,random,assess,speedOverride=speed) {
      return laneChanges.personalize(path,roads.lanes,roads.laneChangePairs??[],{speed:speedOverride,pixelsPerFoot,driver,random,assess});
    }
    // Overlay geometry follows each road's carriageway center, independent of
    // the selected driving lane or its lane-change trajectory. Keep connector
    // curvature and blend endpoint offsets through intersections/roundabouts.
    const displayCache = new WeakMap(), roadLanes = new Map();
    for (const lane of roads.lanes) {
      if (!roadLanes.has(lane.road)) roadLanes.set(lane.road, []);
      roadLanes.get(lane.road).push(lane);
    }
    function displayPath(path) {
      if (displayCache.has(path)) return displayCache.get(path);
      const original = path.points, points = original.map(point => {
        const records = roadLanes.get(point.road);
        if (!records || !Number.isFinite(point.station)) return { x: point.x, y: point.y };
        const samples = records.map(lane => laneChanges.sample(lane, point.station)).filter(p => p.laneWidth > pixelsPerFoot / 12);
        if (!samples.length) return { x: point.x, y: point.y };
        const a = samples[0], b = samples.at(-1);
        return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      });
      for (let first = 0; first < points.length;) {
        if (roadLanes.has(original[first].road)) { first++; continue; }
        let end = first;
        while (end < points.length && !roadLanes.has(original[end].road)) end++;
        const lo = Math.max(0, first - 1), hi = Math.min(points.length - 1, end), lengths = [0];
        for (let i = lo + 1; i <= hi; i++) lengths.push(lengths.at(-1) + Math.hypot(original[i].x-original[i-1].x,original[i].y-original[i-1].y));
        const a = {x:points[lo].x-original[lo].x,y:points[lo].y-original[lo].y}, b = {x:points[hi].x-original[hi].x,y:points[hi].y-original[hi].y};
        for (let i = first; i < end; i++) {
          const t = lengths[i-lo] / (lengths.at(-1) || 1);
          points[i] = {x:original[i].x+a.x*(1-t)+b.x*t,y:original[i].y+a.y*(1-t)+b.y*t};
        }
        first = end;
      }
      displayCache.set(path, points); return points;
    }
    return { entrances, exits, search, laneKey, continueFrom, personalize, displayPath, laneRecords,
      pairs:roads.laneChangePairs??[],pixelsPerFoot,speed };

  }
  const api = { build, laneKey };
  (globalThis.StripeMaker ??= {}).simulatorRouting = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
