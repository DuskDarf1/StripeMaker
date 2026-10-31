// Lane and endpoint overrides belong to this road, never to its neighbors.
(() => {
  function endWidth(sheet, road, e, lane, visiting = new Set()) {
    if (lane == null && road.lanes) return Array.from({length: road.lanes}, (_, i) => endWidth(sheet, road, e, i)).reduce((a,b) => a+b, 0) / road.lanes;
    lane ??= 0;
    // FDM 223.2.2.1: bicycle width belongs to the bicycle facility. A travel
    // lane feed or a generic intersection mouth must not stretch it to 12 ft.
    const type = road.laneTypes?.[lane]?.type;
    if (type && type !== 'travel') return (road.perLaneWidths ? road.laneEndWidths?.[`${e}:${lane}`] : null) ?? laneWidth(road, lane);
    const key = `${road.id}:${e}:${lane}`;
    if (!visiting.has(key) && road.ends?.[e]) {
      visiting.add(key);
      const joint = sheet.joints.find(j => j.id === road.ends[e].joint);
      for (const link of joint?.links ?? []) {
        if (link.b !== road.id || link.bi !== lane || link.pair || link.beside || typeof link.ai !== 'number') continue;
        const receiver = sheet.roads.find(r => r.id === link.a);
        if (!receiver) continue;
        const re = receiver.ends.findIndex(end => end.joint === joint.id);
        // Older edge feeds predate the flag. Their receiving road is the second
        // piece of a cut, with its untouched continuation at the same joint.
        const legacy = re === 0 && receiver.widthProfiles?.[link.ai]?.from > 0 &&
          joint.links.some(l => l.b === receiver.id && l.a !== road.id && !l.pair && !l.beside && typeof l.ai === 'number');
        // Saved end-to-start node joins use the same a=host, b=joining
        // convention as edge feeds. Honor explicit per-end edits on legacy
        // node links; new connections explicitly opt into following the host.
        const nodeFeed = e === 1 && re === 0 &&
          !(road.perLaneWidths && road.laneEndWidths?.[`${e}:${lane}`] != null);
        if (re >= 0 && (link.feed || legacy || nodeFeed)) {
          const width = endWidth(sheet, receiver, re, link.ai, visiting);
          visiting.delete(key);
          return width;
        }
      }
      visiting.delete(key);
    }
    const own = (road.perLaneWidths ? road.laneEndWidths?.[`${e}:${lane}`] : null) ?? laneWidth(road, lane);
    if (road.widthProfiles?.[lane]) return profileAt(road.widthProfiles[lane], e);
    if (road.perLaneWidths && road.laneEndWidths?.[`${e}:${lane}`] != null) return own;
    if (!road.ends?.[e]) return own;
    const joint = sheet.joints.find(j => j.id === road.ends[e].joint);
    for (const item of sheet.intersections ?? []) for (const a of item.approaches) {
      if (a.binding) continue; // Whole-mouth attachments inherit the road dimensions.
      for (const link of a.links ?? []) {
        const linked = sheet.roads.find(r => r.id === link.road);
        if (!linked || linked.ends[link.e].joint !== joint?.id) continue;
        if (link.road === road.id && (link.lane == null || link.lane === lane)) return link.e ? a.width : (a.outWidth ?? a.width);
        // A paired road shares this mouth but travels in the opposite direction.
        if (linked.ends[0].joint === road.ends[1].joint && linked.ends[1].joint === road.ends[0].joint)
          return e ? a.width : (a.outWidth ?? a.width);
      }
    }
    return own;
  }
  function widthAt(width, start, end, fraction) {
    // Meet the shared width square at the joint, and recover the chosen road
    // width at mid-length. Smoothstep keeps the pavement edges tangent there.
    const t = Math.max(0, Math.min(1, fraction < .5 ? fraction * 2 : (1 - fraction) * 2));
    const blend = t * t * (3 - 2 * t);
    const endpoint = fraction < .5 ? start : end;
    return endpoint + (width - endpoint) * blend;
  }
  // A bike lane keeps its own width (laneTypes) unless Per Lane widths sets one.
  const laneWidth = (road, lane) => (road.perLaneWidths ? road.laneWidths?.[lane] : null) ?? road.laneTypes?.[lane]?.width ?? road.laneWidth;
  const profileAt = (p, f) => widthAt(p.width, p.start, p.end, p.from + (p.to - p.from) * f);
  function splitWidths(sheet, road, fraction) {
    const before = [], after = [];
    for (let lane = 0; lane < road.lanes; lane++) {
      const p = road.widthProfiles?.[lane] ?? {width: laneWidth(road, lane), start: endWidth(sheet, road, 0, lane), end: endWidth(sheet, road, 1, lane), from: 0, to: 1};
      const middle = p.from + (p.to - p.from) * fraction;
      before.push({...p, to: middle}); after.push({...p, from: middle});
    }
    return [before, after];
  }
  // Callers sampling many fractions of one lane can pass its [start, end]
  // endpoint widths, which don't change along the road.
  function laneAt(sheet, road, lane, fraction, ends = [endWidth(sheet, road, 0, lane), endWidth(sheet, road, 1, lane)]) {
    if (road.widthProfiles?.[lane]) {
      const p = road.widthProfiles[lane];
      // Preserve a cut road's profile, adding only the correction needed by a
      // new receiving lane at either endpoint.
      return profileAt(p, fraction) + widthAt(0, ends[0] - profileAt(p, 0), ends[1] - profileAt(p, 1), fraction);
    }
    return widthAt(laneWidth(road, lane), ends[0], ends[1], fraction);
  }
  const api = { endWidth, widthAt, laneWidth, laneAt, splitWidths };
  if (typeof module !== 'undefined') module.exports = api;
  else (window.StripeMaker ??= {}).roadWidths = api;
})();
