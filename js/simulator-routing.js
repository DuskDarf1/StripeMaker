/* Directed lane routing shared by simulator interaction and regression tests.
   Permitted turns plus timed, strategic lane changes. No nearest-road jumps
   or wrong-way edges; bicycle facilities are crossed, never driven along. */
(() => {
  const laneChanges = typeof module !== 'undefined' ? require('./simulator-lane-changes.js') : globalThis.StripeMaker.simulatorLaneChanges;
  const pathLength = points => points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - points[i].x, p.y - points[i].y), 0);
  const less = (a, b) => a.changes < b.changes || a.changes === b.changes && a.distance < b.distance;
  // A queue choice may change the lane used by a double turn, but not the
  // driver's sequence of approaches/destinations. These are routing semantics,
  // not new driver-behavior parameters. Movement lane IDs deliberately differ.
  function sameTurns(points,movements) {
    const turns=[];let previous=null;
    for(const p of points){
      if(!p.junction||p.junction.roadMerge){previous=null;continue;}
      const key=JSON.stringify([p.intersection,p.junction.entry,p.junction.exit]);
      if(key!==previous)turns.push(key);previous=key;
    }
    movements=movements.filter(m=>!m.junction?.roadMerge);
    return turns.length===movements.length&&turns.every((key,i)=>key===JSON.stringify([movements[i].intersection,movements[i].junction?.entry,movements[i].junction?.exit]));
  }
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
    const edge = (from, to, points, laneChange = null, penalty = 0) => {
      if (!nodes.has(from) || !nodes.has(to)) return;
      if (reversed) {
        [from, to] = [to, from];
        points = [...points].reverse().map(p => ({ ...p, ...(p.road != null ? { direction: -1 } : {}),
          ...(p.junction?{junction:{...p.junction,entry:p.junction.exit,exit:p.junction.entry,input:p.junction.output,output:p.junction.input,angle:p.junction.exitAngle,exitAngle:p.junction.angle,...(p.junction.approachLanes?{approachLanes:p.junction.approachLanes.map(a=>({...a,incoming:a.outgoing,outgoing:a.incoming}))}:{})}}:{}),
          ...(p.roundabout?{roundabout:{...p.roundabout,direction:-p.roundabout.direction,entry:p.roundabout.exit,exit:p.roundabout.entry,gates:p.roundabout.reverseGates,reverseGates:p.roundabout.gates}}:{}),
          ...(p.roundaboutPhase ? {roundaboutPhase:p.roundaboutPhase==='entry'?'exit':p.roundaboutPhase==='exit'?'entry':p.roundaboutPhase}:{}),
          ...(p.maneuver ? { lane: p.maneuver.progress > 0 ? p.maneuver.to : p.maneuver.from,
            maneuver: { ...p.maneuver, from: p.maneuver.to, to: p.maneuver.from, progress: 1 - p.maneuver.progress } } : {}) }));
        if (laneChange) laneChange = { ...laneChange, from: laneChange.to, to: laneChange.from };
      }
      const list = adjacency.get(from) ?? [];
      if (!list.some(e => e.to === to)) list.push({ to, points, laneChange, penalty, distance: pathLength(points) });
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
        (roads.laneChangePairs ?? []).filter(pair => pair.road === road.id), { speed, pixelsPerFoot, slowLaneChanges:options.slowLaneChanges });
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
    // Explicit road-to-road merges need the same upstream conflict admission
    // as an intersection mouth. Geometry remains on its original road/lane.
    const incoming=new Map(),directed=roads.connections.map(c=>reversed?{from:c.to,to:c.from}:c);
    for(const c of directed){const key=laneKey(c.to);if(!incoming.has(key))incoming.set(key,new Set());incoming.get(key).add(c.from.road);}
    const mergeJoints=new Set([...incoming].filter(([,from])=>from.size>1).map(([key])=>sheet.roads.find(r=>r.id===lanes.get(key)?.road)?.ends[startEnd].joint));
    const mergeLinks=new Map();
    for(const c of directed) {
      const joint=sheet.roads.find(r=>r.id===c.to.road)?.ends[startEnd].joint;
      if(!mergeJoints.has(joint))continue;
      const from=lanes.get(laneKey(c.from)),to=lanes.get(laneKey(c.to));if(!from||!to)continue;
      const a=from.points[startEnd?from.points.length-1:0],b=from.points[exitEnd?from.points.length-1:0];
      const out=to.points[startEnd?to.points.length-1:0],next=to.points[startEnd?to.points.length-2:1];
      const angle=Math.atan2(b.y-a.y,b.x-a.x)*180/Math.PI,exitAngle=Math.atan2(next.y-out.y,next.x-out.x)*180/Math.PI;
      const bend=Math.abs(((angle-exitAngle+540)%360)-180);
      mergeLinks.set(`${laneKey(c.from)}>${laneKey(c.to)}`,{intersection:`road-merge:${joint}`,junction:{roadMerge:true,entry:c.from.road,exit:c.to.road,input:laneKey(c.from),output:laneKey(c.to),angle:angle+180,exitAngle,mergeBend:bend}});
    }
    // A side road joining a multi-lane road at a merge may turn directly into
    // any farther lane (legal, and common out of a minor road). The turn keeps
    // the side road's yield obligation: every crossed lane's through stream is
    // tagged into the same merge admission envelope. The entry curve reaches
    // its lane within that envelope, or 3 x its lateral shift (an average
    // heading of about 18 degrees) when wider: a numerical geometric policy,
    // not measured driver data. Bicycle facilities and separators never cross.
    // Direct turns are a fallback for destinations that ordinary lane changes
    // cannot reach at normal speed; their admission links are always present
    // so playback decorates paths from either graph alike.
    if(!reversed)for(const c of directed) {
      const joint=sheet.roads.find(r=>r.id===c.to.road)?.ends[0].joint,link=mergeLinks.get(`${laneKey(c.from)}>${laneKey(c.to)}`);
      if(!mergeJoints.has(joint)||!link)continue;
      const into=[...mergeLinks.values()].filter(m=>m.junction.exit===c.to.road&&m.intersection===link.intersection);
      if(!(link.junction.mergeBend>Math.min(...into.map(m=>m.junction.mergeBend))+1))continue;
      const feeder=lanes.get(laneKey(c.from)),receiving=lanes.get(laneKey(c.to));if(!feeder||!receiving)continue;
      const P0=feeder.points.at(-1),before=feeder.points.at(-2)??P0,heading=Math.atan2(P0.y-before.y,P0.x-before.x);
      const pairs=(roads.laneChangePairs??[]).filter(p=>p.road===c.to.road);
      for(const target of roads.lanes.filter(l=>l.road===c.to.road&&l.lane!==c.to.lane)) {
        const total=laneChanges.stationsOf(target).at(-1),lateral=Math.hypot(target.points[0].x-receiving.points[0].x,target.points[0].y-receiving.points[0].y);
        const span=Math.max(P0.laneWidth??12*pixelsPerFoot,target.points[0].laneWidth??12*pixelsPerFoot)*381/214*4,D=Math.max(span,3*lateral);
        if(!(D<total-pixelsPerFoot)||laneChanges.sample(target,D).laneWidth<=pixelsPerFoot)continue;
        // Every adjacent boundary crossed must permit a lane change over the curve.
        let ok=true;
        for(let k=Math.min(c.to.lane,target.lane);k<Math.max(c.to.lane,target.lane)&&ok;k++){
          const pair=pairs.find(p=>Math.min(p.from,p.to)===k&&Math.max(p.from,p.to)===k+1);
          ok=Boolean(pair)&&!pair.crossings?.length&&!(pair.blocked??[]).some(([lo])=>lo*total<D);
        }
        if(!ok)continue;
        const P3=laneChanges.sample(target,D),ahead=laneChanges.sample(target,Math.min(total,D+pixelsPerFoot)),out=Math.atan2(ahead.y-P3.y,ahead.x-P3.x);
        const reach=Math.hypot(P3.x-P0.x,P3.y-P0.y)/3,P1={x:P0.x+Math.cos(heading)*reach,y:P0.y+Math.sin(heading)*reach},P2={x:P3.x-Math.cos(out)*reach,y:P3.y-Math.sin(out)*reach};
        const curve=[];
        for(let i=1;i<=24;i++){const t=i/24,u=1-t,x=u*u*u*P0.x+3*u*u*t*P1.x+3*u*t*t*P2.x+t*t*t*P3.x,y=u*u*u*P0.y+3*u*u*t*P1.y+3*u*t*t*P2.y+t*t*t*P3.y;
          curve.push({...laneChanges.sample(target,D*t),x,y});}
        const nodesOnLane=[...nodes].filter(([key,p])=>key.startsWith(`${laneKey(target)}:s`)&&p.station>=D).sort((a,b)=>a[1].station-b[1].station);
        const [to,station]=nodesOnLane.length?[nodesOnLane[0][0],nodesOnLane[0][1].station]:[endpoint(target,1),total];
        // Costs slightly more than the lane changes it replaces, so ordinary
        // changes win wherever they fit.
        if(options.directEntries===true)edge(endpoint(c.from,1),to,[P0,...curve,...laneChanges.slice(target,D,station).slice(1)],null,Math.abs(target.lane-c.to.lane)+.5);
        mergeLinks.set(`${laneKey(c.from)}>${laneKey(target)}`,{...link,junction:{...link.junction,output:laneKey(target)},reach:D+span});
        // Through traffic in the crossed lane joins the same admission envelope.
        for(const through of directed.filter(t=>laneKey(t.to)===laneKey(target)&&!mergeLinks.has(`${laneKey(t.from)}>${laneKey(target)}`))){
          const from=lanes.get(laneKey(through.from));if(!from)continue;
          const a=from.points[0],b2=from.points.at(-1),next=target.points[1]??target.points[0],angle=Math.atan2(b2.y-a.y,b2.x-a.x)*180/Math.PI,exitAngle=Math.atan2(next.y-target.points[0].y,next.x-target.points[0].x)*180/Math.PI;
          mergeLinks.set(`${laneKey(through.from)}>${laneKey(target)}`,{intersection:link.intersection,reach:D+span,junction:{roadMerge:true,entry:through.from.road,exit:target.road,input:laneKey(through.from),output:laneKey(target),angle:angle+180,exitAngle,mergeBend:Math.abs(((angle-exitAngle+540)%360)-180)}});
        }
      }
    }
    function decorateMerges(points) {
      if(!points||!mergeLinks.size)return points;
      const result=points.map(p=>({...p})),lengths=[0];
      for(let i=1;i<points.length;i++)lengths.push(lengths.at(-1)+Math.hypot(points[i].x-points[i-1].x,points[i].y-points[i-1].y));
      for(let i=1;i<points.length;i++) {
        const p=points[i-1],q=points[i];if(p.road==null||q.road==null||p.road===q.road)continue;
        const merge=mergeLinks.get(`${laneKey(p)}>${laneKey(q)}`);if(!merge)continue;
        // Four body-length envelopes (using full lane width) cover the curved approach
        // and receiving stream. This is a collision lookahead envelope, not
        // an invented stop bar or a change to the sheet's road geometry.
        const span=Math.max(p.laneWidth??12*pixelsPerFoot,q.laneWidth??12*pixelsPerFoot)*381/214*4;
        for(let j=i;j>=0&&lengths[i]-lengths[j]<=span;j--)if(result[j].intersection==null||result[j].junction?.roadMerge)Object.assign(result[j],{intersection:merge.intersection,junction:merge.junction});
        const {reach,...tag}=merge,ahead=Math.max(span,reach??0);
        for(let j=i+1;j<points.length&&lengths[j]-lengths[i]<=ahead;j++)if(result[j].intersection==null||result[j].junction?.roadMerge)Object.assign(result[j],tag);
      }
      return result;
    }
    const entrances = [], exits = [];
    for (const lane of roads.lanes) {
      const ref = { road: lane.road, lane: lane.lane };
      if (lane.open[startEnd] && terminal(ref, startEnd)) entrances.push({ ...ref, e: startEnd, point: nodes.get(endpoint(ref, startEnd)) });
      if (lane.open[exitEnd] && terminal(ref, exitEnd)) exits.push({ ...ref, e: exitEnd, point: nodes.get(endpoint(ref, exitEnd)) });
    }
    const searchCache = new Map();
    let slowGraph=null;
    // Normal paths first, then direct multi-lane merge turns, then slower
    // preparation (which may also use direct turns).
    const fallback=()=>options.directEntries==null&&!reversed
      ? (slowGraph??=build(sheet,roads,intersections,reversed,pairOf,{...options,directEntries:true}))
      : options.allowSlowLaneChanges&&!options.slowLaneChanges
      ? (slowGraph??=build(sheet,roads,intersections,reversed,pairOf,{...options,slowLaneChanges:true})) : null;
    const entranceCache=new Map();
    function search(source) {
      if (!entrances.some(ref => ref.road === source.road && ref.lane === source.lane && (source.e ?? 0) === ref.e)) return new Map();
      const key=endpoint(source,startEnd);
      if(entranceCache.has(key))return entranceCache.get(key);
      const paths=new Map(pathsFrom(key));
      if(paths.size<exits.length)for(const [key,path] of fallback()?.search(source)??[])if(!paths.has(key))paths.set(key,path);
      entranceCache.set(key,paths);return paths;
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
          const next = { node: edge.to, changes: current.changes + Number(Boolean(edge.laneChange)) + edge.penalty, distance: current.distance + edge.distance };
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
            if (!last || distance > 1e-6 || last.road !== p.road || last.intersection !== p.intersection) { points.push(p); walked += distance; }
            // A coincident connector endpoint must adopt the road's station
            // metadata, so cars are observable from the start of the exit.
            else if (p.maneuver || last.road == null && p.road != null)
              points[points.length - 1] = { ...p, ...(last.intersection != null && p.intersection == null ? { intersection: last.intersection } : {}) };
            else if (p.intersection != null && last.intersection == null)
              points[points.length - 1] = { ...last, intersection: p.intersection };
          }
          if (piece.laneChange) changes.push({ ...piece.laneChange, startDistance, endDistance: walked });
        }
        paths.set(laneKey(exit), { exit, points, laneChanges: changes, ...(options.slowLaneChanges?{slowLaneChanges:true}:{}) });
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
    function continueFrom(state,exit,{anyLane=false}={}) {
      const lane=laneRecords.get(laneKey(state));if(!lane)return null;
      const direction=reversed?-1:1;
      const entries=stationNodes.get(laneKey(state))??[];
      let low=0,high=entries.length;
      const threshold=state.station-direction*1e-7;
      while(low<high){const mid=(low+high)>>1;if(entries[mid][1].station<threshold)low=mid+1;else high=mid;}
      const next=direction===1?entries[low]:(entries[low]?.[1].station===threshold?entries[low]:entries[low-1]);
      if(!next)return null;
      const available=pathsFrom(next[0]);
      const path=anyLane?[...available.values()].filter(p=>p.exit.road===exit.road&&p.exit.e===exit.e)
        .sort((a,b)=>(a.laneChanges.length-b.laneChanges.length)||pathLength(a.points)-pathLength(b.points))[0]:available.get(laneKey(exit));
      if(!path)return fallback()?.continueFrom(state,exit,{anyLane})??null;
      const prefix=laneChanges.slice(lane,state.station,next[1].station),shift=pathLength(prefix);
      return {...path,points:[...prefix,...path.points],laneChanges:path.laneChanges.map(change=>({...change,startDistance:change.startDistance+shift,endDistance:change.endDistance+shift}))};
    }
    function personalize(path,driver,random,assess,speedOverride=speed,reserveSpeed=0) {
      return laneChanges.personalize(path,roads.lanes,roads.laneChangePairs??[],{speed:speedOverride,pixelsPerFoot,driver,random,assess,reserveSpeed});
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
    const continues=(road,lane)=>Boolean(adjacency.get(endpoint({road,lane},exitEnd))?.length);
    // A weaving lane can continue physically into an off-ramp while ending
    // for a driver's chosen destination. Reuse the cached legal path search.
    const continuesTo=(road,lane,exit,{anyLane=false}={})=>[...pathsFrom(endpoint({road,lane},exitEnd)).values()]
      .some(p=>p.exit.road===exit.road&&p.exit.e===exit.e&&(anyLane||p.exit.lane===exit.lane)&&!p.laneChanges.length);
    return { entrances, exits, search, laneKey, continueFrom, personalize, displayPath, laneRecords,continues,continuesTo,decorateMerges,
      pairs:roads.laneChangePairs??[],pixelsPerFoot,speed };

  }
  const api = { build, laneKey, sameTurns };
  (globalThis.StripeMaker ??= {}).simulatorRouting = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
