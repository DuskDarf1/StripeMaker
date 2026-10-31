/* Colored pavement (green bike lanes, red bus lanes): with a Colored pavement
   item chosen in the Markings panel's Lateral tab, click where it starts on a
   lane and where it ends. Stored per sheet as
   surfaces: [{ id, on: { road, lane }, from, to, color, pattern }]
   (fractions along the road), drawn under the lane's lines by the road editor
   in the item's pattern (js/marking-catalog.js). */
(() => {
  const SVG = 'http://www.w3.org/2000/svg';
  function routeBetween(sheet, start, end) {
    function forward(a,b) {
      const queue=[{road:a.road,lane:a.lane,path:[]}], seen=new Set();
      while(queue.length) {
        const current=queue.shift(), key=`${current.road.id}:${current.lane}`;
        if(seen.has(key))continue;seen.add(key);
        if(current.road===b.road && current.lane===b.lane) {
          if(!current.path.length && b.f<a.f)return null;
          return [...current.path,{road:current.road,lane:current.lane,from:current.path.length?0:a.f,to:b.f}];
        }
        const joint=sheet.joints.find(j=>j.id===current.road.ends[1].joint);
        for(const l of joint?.links??[]) {
          if(l.pair||l.beside||typeof l.ai!=='number'||typeof l.bi!=='number')continue;
          const other=l.a===current.road.id&&l.ai===current.lane ? [l.b,l.bi] : l.b===current.road.id&&l.bi===current.lane ? [l.a,l.ai] : null;
          const road=other&&sheet.roads.find(r=>r.id===other[0]);
          if(!road||road.ends[0].joint!==joint.id)continue;
          queue.push({road,lane:other[1],path:[...current.path,{road:current.road,lane:current.lane,from:current.path.length?0:a.f,to:1}]});
        }
      }
      return null;
    }
    return forward(start,end)??forward(end,start);
  }
  if(typeof module==='object')module.exports={routeBetween};
  if(typeof window==='undefined')return;
  const app = window.StripeMaker ??= {};
  const CLICK_PIXELS = 5;
  const svg = (tag, attrs, parent) => {
    const e = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    parent?.append(e);
    return e;
  };
  const pathData = points => `M${points.map(p => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join('L')}Z`;

  document.addEventListener('DOMContentLoaded', () => {
    const sheets = app.sheets, C = app.markingCatalog;
    const get = id => document.getElementById(id);
    const workspace = get('workspace'), panel = get('markingsEditor');
    const overlay = document.createElement('div');
    overlay.className = 'markingOverlay surfaceOverlay';
    sheets.addOverlay(overlay);
    let start = null, hover = null, press = null;

    const item = () => C.find(app.markings?.draftType?.());
    const active = () => !panel.hidden && app.markings?.tab() === 'lateral' && item()?.kind === 'surface' && Boolean(sheets.selected?.inchesPerPixel);
    const tell = text => { const status = get('markingStatus'); if (status) status.textContent = text; };
    // The lane under a point (roads only) and how far along the road it is.
    function anchor(point) {
      const sheet = sheets.selected, found = app.markings.anchorAt(point);
      const road = found?.on?.road != null && sheet.roads.find(r => r.id === found.on.road);
      if (!road) return null;
      const line = app.roadEditor.crossSection(sheet)(road).line;
      let length = 0;
      for (let i = 1; i < line.length; i++) length += Math.hypot(line[i].x - line[i - 1].x, line[i].y - line[i - 1].y);
      const f = Math.max(0, Math.min(1, 1 - found.back * (12 / sheet.inchesPerPixel) / length));
      return { road, lane: found.on.lane, f };
    }
    function refresh() {
      overlay.replaceChildren();
      const sheet = sheets.selected;
      if (!active() || !start) return;
      const root = svg('svg', { 'aria-hidden': 'true' }, overlay);
      const view = svg('g', { transform: `translate(${sheet.view.x} ${sheet.view.y}) scale(${sheet.view.scale})` }, root);
      const route = hover && routeBetween(sheet,start,hover);
      for (const segment of route ?? [{road:start.road,lane:start.lane,from:start.f,to:Math.min(1,start.f+1e-4)}]) {
        const strip = app.roadEditor.laneStrip(sheet,segment.road,segment.lane,segment.from,segment.to);
        svg('path', { d: pathData(strip), fill: C.SURFACE[item().color], opacity: '0.6', stroke: '#ffdf00', 'stroke-width': '2', 'vector-effect': 'non-scaling-stroke' }, view);
      }
    }
    const pointOf = event => sheets.toImage(event.clientX, event.clientY);
    workspace.addEventListener('pointermove', event => {
      if (!active()) return;
      hover = anchor(pointOf(event));
      workspace.classList.toggle('markingPlacing', Boolean(hover));
      refresh();
    });
    workspace.addEventListener('pointerdown', event => {
      if (!active() || event.button !== 0 || !event.isPrimary) return;
      press = anchor(pointOf(event)) ? { x: event.clientX, y: event.clientY, pointer: event.pointerId } : null;
    }, true);
    workspace.addEventListener('pointerup', event => {
      if (!active() || !press || event.pointerId !== press.pointer) return;
      const moved = Math.hypot(event.clientX - press.x, event.clientY - press.y) > CLICK_PIXELS;
      press = null;
      if (moved) return;   // a drag pans
      const at = anchor(pointOf(event));
      if (!at) return;
      if (!start) {
        start = at;
        tell('Now click where it ends, on this lane or a connected lane.');
        return refresh();
      }
      const sheet = sheets.selected, kind = item();
      const route = routeBetween(sheet,start,at);
      if (!route) return tell('Choose an end on a lane connected to the starting lane.');
      const span = crypto.randomUUID();
      const surfaces = route.filter(s=>s.to-s.from>1e-4).map((s,order)=>({
        id:crypto.randomUUID(),span,order,on:{road:s.road.id,lane:s.lane},from:s.from,to:s.to,color:kind.color,pattern:kind.pattern,
      }));
      start = null;
      if (!surfaces.length) return refresh();
      (sheet.surfaces ??= []).push(...surfaces);
      app.roadEditor.render();
      sheets.save(sheet);
      app.history.record();
      refresh();
      tell(`${kind.name} added. Click again to add another, or choose another marking.`);
    }, true);
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && start && active()) {
        event.preventDefault(); event.stopImmediatePropagation();
        start = null;
        refresh();
        tell('Colored pavement canceled.');
      }
    }, true);
    document.addEventListener('sheetview', refresh);
    for (const event of ['sheetchange', 'sheethistory']) document.addEventListener(event, () => { start = null; refresh(); });
    new MutationObserver(() => { if (panel.hidden) start = null; refresh(); }).observe(panel, { attributes: true, attributeFilter: ['hidden'] });
  });
})();
