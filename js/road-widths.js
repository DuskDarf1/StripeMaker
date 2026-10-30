// Width transitions are derived from connections; no extra saved geometry.
(() => {
  function endWidth(sheet, road, e) {
    if (!road.ends?.[e]) return road.laneWidth;
    const joint = sheet.joints.find(j => j.id === road.ends[e].joint);
    const connected = new Set([road.id]);
    for (let grew = true; grew;) {
      grew = false;
      for (const link of joint?.links ?? []) {
        if (link.pair || link.beside || typeof link.ai !== 'number' || typeof link.bi !== 'number') continue;
        if (connected.has(link.a) === connected.has(link.b)) continue;
        connected.add(link.a); connected.add(link.b); grew = true;
      }
    }
    const members = sheet.roads.filter(r => connected.has(r.id));
    for (const item of sheet.intersections ?? []) for (const a of item.approaches) {
      if (a.binding) continue; // Whole-mouth attachments inherit the road dimensions.
      for (const link of a.links ?? []) {
        const linked = sheet.roads.find(r => r.id === link.road);
        if (!linked || linked.ends[link.e].joint !== joint?.id) continue;
        if (connected.has(link.road)) return link.e ? a.width : (a.outWidth ?? a.width);
        // A paired road shares this mouth but travels in the opposite direction.
        if (linked.ends[0].joint === road.ends[1].joint && linked.ends[1].joint === road.ends[0].joint)
          return e ? a.width : (a.outWidth ?? a.width);
      }
    }
    return members.length ? members.reduce((sum, r) => sum + r.laneWidth, 0) / members.length : road.laneWidth;
  }
  function widthAt(width, start, end, fraction) {
    // Meet the shared width square at the joint, and recover the chosen road
    // width at mid-length. Smoothstep keeps the pavement edges tangent there.
    const t = Math.max(0, Math.min(1, fraction < .5 ? fraction * 2 : (1 - fraction) * 2));
    const blend = t * t * (3 - 2 * t);
    const endpoint = fraction < .5 ? start : end;
    return endpoint + (width - endpoint) * blend;
  }
  const api = { endWidth, widthAt };
  if (typeof module !== 'undefined') module.exports = api;
  else (window.StripeMaker ??= {}).roadWidths = api;
})();
