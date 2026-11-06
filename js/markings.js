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
  const HOVER_HINT = 'Hover a lane to preview; click to add. Hold Shift to mark every lane.';
  const CROSSWALK_HINT = 'Click one roadway edge, then the other. Shift-click a lane to cross all lanes in that direction.';
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
    let hover = null, hoverMarking = null, press = null, drag = null, hoverFrame = 0;
    let crosswalkStart = null;          // a crosswalk's first end, until the second click
    let tracks = new Map(), drawn = new Map(), tracksReady = true;
    // The next marking's settings; a selected marking's settings show instead.
    const draft = { type: 'through', text: '', gap: C.LINE_GAP.min, route: '95', size: 'arterial', speed: 'fast',
      contrast: false, contrastStyle: 'border', all: false, spacing: C.ARROW_SPACING, width: C.CROSSWALK.width };

    const active = () => !panel.hidden && tab === 'lateral';
    const current = () => sheets.selected?.markings?.find(m => m.id === selected) ?? null;
    const model = () => current() ?? draft;
    const copyOptions = (from, to) => {
      for (const key of ['variant', 'message', 'extent', 'count', 'tableWidth', 'tone', 'enhanced', 'forceBars', 'barAngle', 'aesthetic', 'aestheticColor', 'aestheticImage', 'imageFit']) if (from[key] != null) to[key] = from[key];
      return to;
    };
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
      // A successful lane hit is at most its largest lateral bound plus the
      // existing one-pixel longitudinal tolerance from a centerline segment.
      // These conservative boxes reject distant segments before interpolation;
      // curved/tapered lanes keep the same exact nearest-lane calculation below.
      let pickPadding=1,minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
      for(const lanes of track.bounds)for(const [left,right] of lanes)pickPadding=Math.max(pickPadding,Math.abs(left)+1,Math.abs(right)+1);
      for(const p of line){minX=Math.min(minX,p.x);minY=Math.min(minY,p.y);maxX=Math.max(maxX,p.x);maxY=Math.max(maxY,p.y);}
      const pickBounds={minX:minX-pickPadding,minY:minY-pickPadding,maxX:maxX+pickPadding,maxY:maxY+pickPadding};
      return { ...track, along, tangents, length: along.at(-1), count: track.bounds[0].length, pickPadding, pickBounds };
    }
    const trackGeometryKey = sheet => JSON.stringify([sheet.inchesPerPixel,sheet.autoTapers,sheet.roads,sheet.joints,sheet.intersections]);
    function collect(sheet, solved) {
      const cached = solved?.markingTracks;
      if (cached && cached.key === trackGeometryKey(sheet)) return cached.tracks;
      const list = [];
      for (const t of app.roadEditor.laneTracks(sheet, solved)) {
        list.push(prepare({ key: `r:${t.road}`, on: { road: t.road }, line: t.line, markingEdges:t.markingEdges,bikeLanes:t.bikeLanes,placementBounds:t.placementBounds,
          bounds: t.laneBounds ?? t.bounds.map(b => b.slice(0, -1).map((left, k) => [left, b[k + 1]])) }));
      }
      for (const t of app.intersections?.laneTracks?.(sheet) ?? []) list.push(prepare(t));
      const tracks = new Map(list.map(t => [t.key, t]));
      // Intersections can normalize attachments while collecting. Subsequent
      // crosswalk clipping and painting may share these tracks only unchanged.
      if (solved) solved.markingTracks = { key: trackGeometryKey(sheet), tracks };
      return tracks;
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
    function ensureTracks() {
      if (!tracksReady) { tracks = collect(sheets.selected); tracksReady = true; }
    }
    function locate(point) {
      ensureTracks();
      let best = null;
      for (const track of tracks.values()) {
        const bounds=track.pickBounds,padding=track.pickPadding;
        if(bounds&&(point.x<bounds.minX||point.x>bounds.maxX||point.y<bounds.minY||point.y>bounds.maxY))continue;
        const { line, along } = track;
        for (let i = 0; i < line.length - 1; i++) {
          const a = line[i], b = line[i + 1], dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy || 1;
          if(padding!=null&&(point.x<Math.min(a.x,b.x)-padding||point.x>Math.max(a.x,b.x)+padding||point.y<Math.min(a.y,b.y)-padding||point.y>Math.max(a.y,b.y)+padding))continue;
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
      const road = marking.on?.road != null ? sheet.roads.find(r => r.id === marking.on.road) : null;
      const laneType=i=>road?.laneTypes?.[i]?.type??track.laneDetails?.[i]?.type;
      const bike = i => ['bike', 'bufferedBike', 'twoWayBike'].includes(laneType(i));
      const standaloneStop=marking.type==='stopLine'&&road&&Array.from({length:track.count},(_,i)=>bike(i)).every(Boolean);
      const line = ['line', 'area'].includes(kindOf(marking));
      // Repeated symbols each use their own travel-lane frame through curves.
      // They remain one saved/undoable marking.
      if (marking.all) {
        const groups = [];
        for (let i=0;i<track.count;i++) {
          const includeBike = ['stopLine', 'yieldLine'].includes(marking.type);
          if (bike(i) && !includeBike) continue;
          // Bike facilities get their own riding-space bar or yield triangle;
          // never bridge the buffer with a continuous vehicle-lane bar.
          if (line && !bike(i) && !bike(i-1) && groups.at(-1)?.at(-1) === i-1) groups.at(-1).push(i);
          else groups.push([i]);
        }
        // Split continuous bars/areas around an interior bike lane, too. Merely
        // filtering the lane list would let their min/max envelope paint over it.
        const layouts = groups.map(lanes => layout(sheet, { ...marking, all: false,
          allLaneCopy: !line, laneSubset: line ? lanes : undefined,
          on: laneRef(track, lanes.includes(lane) ? lane : lanes[0]) })).filter(l => l?.copies.length);
        const anchor = layouts.find(l => l.lane === lane) ?? layouts[0];
        return anchor && { ...anchor, copies: layouts.flatMap(l => l.copies) };
      }
      const k = ppf(sheet);
      // Bike lanes are marked as such (one yield triangle instead of five).
      const placementTrack=track.placementBounds?{...track,bounds:track.placementBounds}:track;
      // A buffered bike lane's riding space starts past its double line (6",
      // 8" gap, 6": 17" from the lane line's center) on the through-lane side,
      // so its markings center there.
      const riding = edges => edges.map(([l, r], i) => {
        // A standalone facility's stop bar fills its pavement, including the
        // 8-inch pavement apron beyond traveled way (711-001). Other markings
        // retain their riding-space placement, and mixed roads retain buffers.
        if(standaloneStop)return [l-(i===0?8/12*k:0),r+(i===edges.length-1?8/12*k:0)];
        if (laneType(i) !== 'bufferedBike') return [l, r];
        const buffer = 17 / 12 * k;
        const halfStripe = 3 / 12 * k; // 6-inch edge stripe, measured to its center (711-001).
        const bufferOnLeft=track.laneDetails?.[i]?.centerShift!=null?track.laneDetails[i].centerShift>=0:i>0||edges.length===1;
        return bufferOnLeft ? [l + buffer, r - halfStripe] : [l + halfStripe, r - buffer];
      });
      const lanes = all => {
        const edges = riding(all), center = (edges[lane][0] + edges[lane][1]) / 2;
        return (marking.laneSubset ? marking.laneSubset.map(i => [edges[i], i]) : [[edges[lane], lane]])
          .map(([[l, r], i]) => ({ left: (l - center) / k, right: (r - center) / k, bike: ['bike', 'bufferedBike', 'twoWayBike'].includes(laneType(i)) }));
      };
      const frame = d => {
        const p = at(placementTrack, d), edges = riding(p.edges), c = (edges[lane][0] + edges[lane][1]) / 2;
        return { x: p.x + p.n.x * c, y: p.y + p.n.y * c, t: p.t, n: p.n, edges: p.edges };
      };
      const back = marking.back ?? 0;
      const probe = C.build(marking, lanes(frame(track.length - back * k).edges));
      const copies = C.repeats(marking).map(offset => {
        const front = track.length - (back + offset) * k;
        const middle = frame(front - (probe.length / 2) * k);
        // A spiral can remove a circulating lane at this station. Do not
        // stamp the vanished lane's copy on its neighbor or the island.
        if (marking.allLaneCopy && middle.edges[lane][1] - middle.edges[lane][0] < 0.5 * k) return null;
        const built = C.build(marking, lanes(middle.edges));
        const frames = new Map();
        const place = (unit = built.length / 2) => {
          if (!frames.has(unit)) frames.set(unit, frame(front - (built.length - unit) * k));
          const f = frames.get(unit);
          return ([x, y]) => ({ x: f.x + f.t.x * (y - unit) * k + f.n.x * x * k, y: f.y + f.t.y * (y - unit) * k + f.n.y * x * k });
        };
        const parts = built.parts.map(part => ({ ...part, rings: part.rings.map(r => r.map(place(part.unit))) }));
        const hit = box(parts.flatMap(part => part.rings.flat()), middle.t);
        return { parts, hit, on: laneRef(track, lane), lanes: marking.laneSubset?.map(i => laneRef(track, i)) ?? [laneRef(track, lane)], center: place()([0, built.length / 2]) };
      }).filter(Boolean);
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
    let imageClip=0;
    function paintImage(part,parent) {
      const image=part.image;if(!image?.src||!image.width||!image.height)return;
      const a=part.imageAngle??0,u={x:Math.cos(a),y:Math.sin(a)},v={x:-Math.sin(a),y:Math.cos(a)};
      const points=part.rings.flat(),along=points.map(p=>p.x*u.x+p.y*u.y),across=points.map(p=>p.x*v.x+p.y*v.y);
      const x0=Math.min(...along),x1=Math.max(...along),y0=Math.min(...across),y1=Math.max(...across);
      const w=x1-x0,h=y1-y0;if(!(w>0&&h>0))return;
      const scale=Math.max(w/image.width,h/image.height);
      const width=part.imageFit==='stretch'?w:image.width*scale,height=part.imageFit==='stretch'?h:image.height*scale;
      const x=(x0+x1-width)/2,y=(y0+y1-height)/2;
      const id=`crosswalk-image-${++imageClip}`,defs=svg('defs',{},parent),clip=svg('clipPath',{id,clipPathUnits:'userSpaceOnUse'},defs);
      svg('path',{d:part.rings.map(pathData).join('')},clip);
      const group=svg('g',{'clip-path':`url(#${id})`},parent);
      svg('image',{href:image.src,width:1,height:1,preserveAspectRatio:'none',
        transform:`matrix(${u.x*width} ${u.y*width} ${v.x*height} ${v.y*height} ${u.x*x+v.x*y} ${u.y*x+v.y*y})`},group);
    }
    function paint(parts, parent, sheet) {
      for (const part of parts) {
        if(part.image){paintImage(part,parent);continue;}
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
    const pavementCache=new WeakMap();
    function pavementEdges(sheet, solved) {
      // The solved geometry belongs to one render. Reuse the exact same edge
      // samples for every crosswalk end in the current lane-track collection.
      const edgeKey=()=>trackGeometryKey(sheet);
      const cached=solved?.markingPavementEdges??pavementCache.get(sheet);
      if(cached&&cached.tracks===tracks&&cached.key===edgeKey())return cached.edges;
      const margin = 8 / sheet.inchesPerPixel, edges = [];  // edge of traveled way to edge of pavement
      const roads = [...tracks.values()].filter(t => t.on.road != null);
      const leftEdges=new Map(roads.map(track=>[track,boundaryLine(track,0)]));
      // A two-way road without a median has no pavement edge at its centerline:
      // each side's left edge line runs 10" from the other's, the other way.
      // (A one-way road joined end to start also meets the next road's left
      // edge, but heading the same way.)
      const centered = track => roads.some(other => {
        if (other === track) return false;
        const p = leftEdges.get(track)[0], q = leftEdges.get(other).at(-1);
        const t = track.tangents[0], u = other.tangents.at(-1);
        return Math.hypot(p.x - q.x, p.y - q.y) < ppf(sheet) && t.x * u.x + t.y * u.y < -0.5;
      });
      for (const track of roads) {
        const sides = centered(track) ? [['R', track.count, margin]] : [['L', 0, -margin], ['R', track.count, margin]];
        for (const [side, k, extra] of sides) {
          const points = (k===0?leftEdges.get(track):boundaryLine(track,k)).map((p, i) => {
            const t = track.tangents[i];
            return { x: p.x - t.y * extra, y: p.y + t.x * extra };
          });
          edges.push({ points, on: { road: track.on.road, side } });
        }
      }
      for (const edge of app.intersections?.boundaries(sheet).edges ?? [])
        if (edge.on.side === 'corner' || edge.on.side === 'median' || edge.on.side === 'island' || edge.on.side.startsWith('split-') || edge.on.side.startsWith('gore-') || /^(splitter|apron)-\d+$/.test(edge.on.side))
          edges.push({ points: edge, on: { ...edge.on } });
      // Boundary reconciliation can normalize attachments. Capture its final
      // inputs, so a later geometry edit cannot reuse an earlier boundary.
      const stored={key:edgeKey(),tracks,edges};
      pavementCache.set(sheet,stored);
      if(solved)solved.markingPavementEdges=stored;
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
    function snapEnd(sheet, point, solved) {
      ensureTracks();
      let best = null;
      for (const edge of pavementEdges(sheet, solved)) {
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
    function endPoint(sheet, end, solved, edges) {
      if (!end?.on) return end;
      const key = on => {
        if (on?.intersection != null) {
          if (on.median != null) return `im:${on.intersection}:${on.median}`;
          // Roundabout surface indices change when another splitter appears
          // or a mini center becomes a raised island. The approach and kind
          // identify the curb; its position in the surface list does not.
          const kind = /^(splitter|apron)-\d+$/.exec(on.side)?.[1];
          return `i:${on.intersection}:${kind === 'apron' ? 'circulatory' : on.approach}:${kind ?? on.side}`;
        }
        return on?.road != null ? `r:${on.road}:${on.side}` : null;
      };
      const edge = (edges ?? pavementEdges(sheet, solved)).find(e => key(e.on) === key(end.on));
      return edge ? alongEdge(edge.points, end.on.f) : end;
    }
    // Where the crosswalk's centerline crosses each lane line and lane center, with
    // that lane's direction of travel, for special emphasis bars (sheet 9).
    function barsAcross(a, b, sheet = sheets.selected) {
      const bars = [], centers = [];
      const hit = (p, q) => {
        const d1 = { x: b.x - a.x, y: b.y - a.y }, d2 = { x: q.x - p.x, y: q.y - p.y };
        const den = d1.x * d2.y - d1.y * d2.x;
        if (Math.abs(den) < 1e-9) return null;
        const t = ((p.x - a.x) * d2.y - (p.y - a.y) * d2.x) / den, u = ((p.x - a.x) * d1.y - (p.y - a.y) * d1.x) / den;
        return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? { x: a.x + d1.x * t, y: a.y + d1.y * t } : null;
      };
      const firstHit = line => {
        for (let i = 1; i < line.length; i++) {
          const p = hit(line[i-1],line[i]);
          if (p) return { ...p, t:unitVector(line[i-1],line[i]) };
        }
        return null;
      };
      const addBar = bar => {
        if (bar && !bars.some(other => Math.hypot(other.x - bar.x, other.y - bar.y) < ppf(sheet) * 0.02)) bars.push(bar);
      };
      for (const track of tracks.values()) {
        // A gore has two different edges at one lane boundary. Keep both,
        // and locate each lane center within its own riding space.
        const at = Array.from({ length: track.count }, (_, lane) => [0, 1].map(side => firstHit(
          track.markingLaneEdges?.[lane]?.[side] ?? track.markingEdges?.[lane + side] ?? track.line.map((p, i) => {
            const offset = track.bounds[i][lane][side], t = track.tangents[i];
            return { x: p.x - t.y * offset, y: p.y + t.x * offset };
          }))));
        for (let k = 0; k < track.count; k++) {
          // FDOT 711-001 sheet 9, Special Emphasis Crosswalk Details:
          // put 24-inch bars on the bike lane's two boundary lines, rather
          // than replacing them with a bar in the bike lane's center.
          const [left, right] = at[k];
          if (track.bikeLanes?.[k]) {
            addBar(left);
            addBar(right);
          } else if (left && right) addBar({ x: (left.x + right.x) / 2, y: (left.y + right.y) / 2, t: left.t });
          if (k > 0 && !track.bikeLanes?.[k] && !track.bikeLanes?.[k - 1]) {
            addBar(at[k - 1][1]);
            if (track.paintedGoreBoundaries?.[k]) addBar(left);
          }
        }
        // Enhanced crossings also place bars on the outer edge lines.
        addBar(at[0]?.[0]);
        addBar(at[track.count - 1]?.[1]);
        if (at[0]?.[0]) centers.push({ ...at[0][0], key: track.key });
      }
      // Marked gores between separate roads also get one 24" bar on each
      // bounding line (711-001 sheet 9 lane-line bar placement). Deduplicate
      // coincident shared edges at a gore tip.
      for (const edge of app.roadEditor.paintedGoreEdges?.(sheet) ?? []) addBar(firstHit(edge));
      // A two-way road's centerline: two left edges 10" apart (no median).
      const k = ppf(sheet);
      centers.forEach((p, i) => centers.slice(i + 1).forEach(q => {
        if (Math.hypot(p.x - q.x, p.y - q.y) < k && p.t.x * q.t.x + p.t.y * q.t.y < -0.5) bars.push({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2, t: p.t });
      }));
      return bars;
    }
    const forceBars = m => m.forceBars ?? (m.barDirection === 'perpendicular');
    const unitVector = (a, b) => { const d = Math.hypot(b.x - a.x, b.y - a.y) || 1; return { x: (b.x - a.x) / d, y: (b.y - a.y) / d }; };
    function layoutCrosswalk(sheet, marking, solved, edges) {
      const a = endPoint(sheet, marking.a, solved, edges), b = endPoint(sheet, marking.b, solved, edges), k = ppf(sheet);
      if (!a || !b || Math.hypot(b.x - a.x, b.y - a.y) < k) return null;
      const feet = p => ({ x: p.x / k, y: p.y / k });
      const forced = forceBars(marking);
      const bars = forced ? [] : barsAcross(a, b, sheet);
      const g = C.crosswalk(marking, { ...feet(a), t: a.t }, { ...feet(b), t: b.t }, bars.map(bar => ({ ...feet(bar), t: bar.t, width:bar.width })));
      const parts = g.parts.map(part => ({ ...part, rings: part.rings.map(r => r.map(([x, y]) => ({ x: x * k, y: y * k }))) }));
      return { crosswalk: true, a, b, length: g.length, copies: [{ parts, hit: box(parts.flatMap(p => p.rings.flat()), unitVector(a, b)), center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } }] };
    }

    // Drawn into the road layer's markings group (vector in PDF downloads). With
    // bridges, `place(point, road)` gives the group on the level each unit sits
    // 711-001 sheet 9: longitudinal lane striping stops at the transverse
    // crosswalk lines. Otherwise the second buffer stripe adds paint beside
    // the emphasis bar, making the combined marking wider.
    function crosswalkCuts(sheet, solved) {
      const crossings=(sheet.markings??[]).filter(marking=>kindOf(marking)==='crosswalk');
      if(!crossings.length)return [];
      tracks=collect(sheet,solved);
      const scale=ppf(sheet),cuts=[];
      const edges = solved && crossings.some(m => m.a?.on || m.b?.on) ? pavementEdges(sheet,solved) : undefined;
      for(const marking of crossings) {
        const a=endPoint(sheet,marking.a,solved,edges),b=endPoint(sheet,marking.b,solved,edges);
        if(!a||!b)continue;
        const toFeet=p=>({...p,x:p.x/scale,y:p.y/scale});
        const parts=C.crosswalk({...marking,type:'crosswalk',enhanced:false,aesthetic:false,contrast:false},toFeet(a),toFeet(b)).parts;
        const first=parts[0].rings[0],second=parts[1].rings[0];
        cuts.push([first[0],first[1],second[1],second[0]].map(([x,y])=>app.itemTransform.apply(marking,{x:x*scale,y:y*scale})));
      }
      return cuts;
    }
    // on (null when that level is hidden).
    function transformPlacement(placed, marking) {
      if (!placed) return placed;
      if(app.traffic.reversed && kindOf(marking)!=='crosswalk')for(const copy of placed.copies) {
        const c=copy.center??copy.hit.reduce((c,p,_,all)=>({x:c.x+p.x/all.length,y:c.y+p.y/all.length}),{x:0,y:0});
        const reverse=p=>({x:2*c.x-p.x,y:2*c.y-p.y});
        copy.parts=copy.parts.map(part=>({...part,rings:part.rings.map(r=>r.map(reverse))}));
        copy.hit=copy.hit.map(reverse);
      }
      if(!marking.placementTransform)return placed;
      const point=p=>app.itemTransform.apply(marking,p);
      for (const copy of placed.copies) {
        copy.parts=copy.parts.map(part=>({...part,...(part.image?{imageAngle:(part.imageAngle??0)+marking.placementTransform.angle*Math.PI/180}:{}),rings:part.rings.map(r=>r.map(point))}));
        copy.hit=copy.hit.map(point);if(copy.center)copy.center=point(copy.center);
      }
      for(const key of ['a','b','repeatPoint'])if(placed[key])placed[key]=point(placed[key]);
      return placed;
    }
    const markingDrawings=new WeakMap();
    const markingDrawingKey=m=>[JSON.stringify({...m,aestheticImage:m.aestheticImage?{...m.aestheticImage,src:null}:null}),m.aestheticImage?.src];
    const sameDrawingKey=(a,b)=>a.length===b.length&&a.every((value,i)=>value===b[i]);
    const drawingGeometryKey=sheet=>JSON.stringify([trackGeometryKey(sheet),sheet.bridges,sheet.gores,sheet.medians,sheet.lines,sheet.surfaces,
      app.traffic.reversed,app.settings?.get('autoContrast'),app.settings?.get('hideLevelsAbove')]);
    function draw(sheet, parent, solved, place = null) {
      tracksReady = Boolean(sheet.markings?.length || active());
      tracks = tracksReady ? collect(sheet, solved) : new Map();
      drawn = new Map();
      sheet.markings ??= [];
      const intersectionIds=new Set((sheet.intersections??[]).map(item=>item.id));
      for(const marking of sheet.markings)if(marking.trafficControl){
        const expected=marking.type==='stopLine'?'stop':marking.type==='yieldLine'?'yield':null;
        if(marking.trafficControl.type!==expected)delete marking.trafficControl;
        else if(marking.trafficControl.intersection!=null&&!intersectionIds.has(marking.trafficControl.intersection))delete marking.trafficControl.intersection;
      }
      // Markings go with their lane: a removed road, approach, or lane drops them.
      sheet.markings = sheet.markings.filter(m => {
        if (kindOf(m) === 'crosswalk') return true;
        const track = tracks.get(trackKey(m.on ?? {}));
        return track && laneIndex(track, m.on) >= 0 && laneIndex(track, m.on) < track.count;
      });
      const groups = new Map(),entries=[];
      const groupIn = into => groups.get(into) ?? groups.set(into, svg('g', { class: 'laneMarkings' }, into)).get(into);
      const edges = solved && sheet.markings.some(m => kindOf(m) === 'crosswalk' && (m.a?.on || m.b?.on)) ? pavementEdges(sheet,solved) : undefined;
      for (const marking of sheet.markings) {
        const entry={id:marking.id,type:marking.type,crosswalk:kindOf(marking)==='crosswalk',control:JSON.stringify(marking.trafficControl),key:markingDrawingKey(marking),nodes:[]};entries.push(entry);
        const placed = transformPlacement(kindOf(marking) === 'crosswalk' ? layoutCrosswalk(sheet, marking, solved, edges) : layout(sheet, marking), marking);
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
            contrasted ??= transformPlacement(kindOf(marking) === 'crosswalk' ? layoutCrosswalk(sheet, { ...marking, contrast: true }, solved, edges) : layout(sheet, { ...marking, contrast: true }),marking);
            parts = contrasted?.copies[i]?.parts ?? parts;
          }
          const group=groupIn(into),previous=group.lastChild;
          paint(parts, group, sheet);
          for(let node=previous?previous.nextSibling:group.firstChild;node;node=node.nextSibling)entry.nodes.push(node);
          shown = true;
        });
        // Markings on hidden levels can't be picked.
        if (shown) drawn.set(marking.id, placed);
      }
      if (!groups.size) groupIn(parent);
      markingDrawings.set(sheet,{entries,tracks,key:drawingGeometryKey(sheet),group:groups.size===1?groups.values().next().value:null});
      if (hover && !drag) hover = refreshHover(hover.point);
    }
    function updateDrawing(sheet) {
      const saved=markingDrawings.get(sheet),markings=sheet.markings??[];
      // Crosswalk changes clip road stripes, and elevated markings can move
      // between slots. Those edits retain the complete drawing path.
      if(!saved || saved.tracks!==tracks || saved.key!==drawingGeometryKey(sheet) || saved.entries.length!==markings.length ||
        sheet.bridges?.length || sheet.intersections?.some(item=>(item.level??1)>1) || sheet.roads.some(road=>(road.level??1)>1) ||
        !saved.group || !sheet.roadLayer?.contains(saved.group))return false;
      const patches=[];
      for(let i=0;i<markings.length;i++) {
        const marking=markings[i],entry=saved.entries[i],key=markingDrawingKey(marking);
        if(entry.id!==marking.id || entry.type!==marking.type || entry.control!==JSON.stringify(marking.trafficControl) ||
          entry.nodes.some(node=>node.parentNode!==saved.group))return false;
        if(sameDrawingKey(entry.key,key))continue;
        if(entry.crosswalk || !entry.nodes.length)return false;
        const placed=transformPlacement(layout(sheet,marking),marking);
        if(!placed)return false;
        const holder=document.createElementNS(SVG,'g');
        for(const copy of placed.copies)paint(copy.parts,holder,sheet);
        const nodes=[...holder.childNodes];if(!nodes.length)return false;
        patches.push({entry,key,placed,nodes});
      }
      for(const {entry,key,placed,nodes} of patches) {
        // Replace only this marking's paths, at its original position. Retain
        // the laneMarkings group referenced by the road renderer's layer parts.
        const anchor=entry.nodes[0];for(const node of nodes)saved.group.insertBefore(node,anchor);
        entry.nodes.forEach(node=>node.remove());entry.nodes=nodes;entry.key=key;drawn.set(entry.id,placed);
      }
      if(hover&&!drag)hover=refreshHover(hover.point);
      return true;
    }

    // Overlay: hover preview, selection outline, and handles (screen pixels).
    function refreshOverlay() {
      cancelAnimationFrame(hoverFrame);hoverFrame=0;
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
      if (draft.all || shift) m.all = true;
      copyOptions(draft, m);
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
        if (shift) {
          const found = locate(point);
          if (found) {
            const p = at(found.track, found.d), left = p.edges[0][0], right = p.edges.at(-1)[1];
            const edge = d => snapEnd(sheet, { x: p.x + p.n.x * d, y: p.y + p.n.y * d });
            const marking = copyOptions(draft, { id: 'preview', type: draft.type, a: edge(left), b: edge(right), width: draft.width, ...(draft.contrast ? { contrast: true } : {}) });
            return { point, shift, wholeCrosswalk: true, marking, layout: layoutCrosswalk(sheet, marking) };
          }
        }
        const snap = snapEnd(sheet, point);
        if (!crosswalkStart) return { point, shift, snap, layout: null };
        const marking = copyOptions(draft, { id: 'preview', type: draft.type, a: crosswalkStart, b: snap, width: draft.width, ...(draft.contrast ? { contrast: true } : {}) });
        return { point, shift, snap, marking, layout: layoutCrosswalk(sheet, marking) };
      }
      const found = placement(point, shift);
      if (!found) return { point, shift };
      const placed = layout(sheet, found.marking);
      return { point, shift, layout: placed, marking: found.marking, snapped: found.snapped };
    }

    let dragFrame = 0;
    function cancelDragFrame() {
      cancelAnimationFrame(dragFrame);
      dragFrame = 0;
    }
    function drawDrag() {
      cancelDragFrame();
      renderMarkings();
      if (drag?.handle) {
        const placed = drawn.get(selected);
        const point = placed && (placed.crosswalk ? placed[drag.part] : drag.part === 'repeat' ? placed.repeatPoint : placed.copies[0].center);
        if (point) {
          const s = sheets.toScreen(point);
          Object.assign(drag.handle.style, { left: `${s.x}px`, top: `${s.y}px` });
        }
      }
      updatePanel();
    }
    function renderMarkings() { (app.roadEditor.renderMarkings??app.roadEditor.render)(); }
    function changed(message) {
      cancelDragFrame();
      renderMarkings();
      updatePanel();
      sheets.save(sheets.selected);
      app.history.record();
      if (message) tell(message);
    }
    function select(id) {
      selected = id; selectedSheet = sheets.selected;
      updatePanel(); refreshOverlay(); app.selection?.editorChanged();
    }
    function add() {
      const sheet = sheets.selected;
      if (crossing() && (hover?.snap || hover?.wholeCrosswalk) && sheet) {
        // First click: one edge of the roadway; second click: the other.
        if (!crosswalkStart && !hover.wholeCrosswalk) { crosswalkStart = hover.snap; refreshOverlay(); tell('Click the other edge of the roadway.'); return; }
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
      hoverFrame ||= requestAnimationFrame(refreshOverlay);
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
        // The existing boundary cache validates geometry and the track set.
        // Both endpoints and all events before a redraw can share it.
        const geometry = drag.geometry ??= {};
        if (drag.part === 'a' || drag.part === 'b') marking[drag.part] = snapEnd(sheet, point, geometry);
        else {
          // Grabbing the crosswalk moves both ends (off any edge they were on).
          const shift = p => ({ x: p.x + point.x - drag.start.x, y: p.y + point.y - drag.start.y });  // off its edge: cut square
          marking.a = shift(endPoint(sheet, drag.before.a, geometry)); marking.b = shift(endPoint(sheet, drag.before.b, geometry));
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
      // Placement is updated for every event, including the length used by the
      // next move/repeat edit. Only drawing and panel work wait for the frame.
      if (kindOf(marking) !== 'crosswalk') {
        const placed = transformPlacement(layout(sheet, marking), marking);
        if (placed) drawn.set(marking.id, placed);
      }
      dragFrame ||= requestAnimationFrame(drawDrag);
    }
    function endDrag(event, cancel = false) {
      cancelDragFrame();
      const d = drag;
      drag = null;
      const marking = current();
      if (cancel && marking) Object.assign(marking, d.before);
      if (d.handle?.hasPointerCapture(event.pointerId)) d.handle.releasePointerCapture(event.pointerId);
      if (workspace.hasPointerCapture(event.pointerId)) workspace.releasePointerCapture(event.pointerId);
      if (d.moved) changed();
      else { renderMarkings(); updatePanel(); }
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
    const markingFavorites=app.pickerFavorites('markings'),lineFavorites=app.pickerFavorites('lines');
    function populate() {
      const query = get('markingSearch').value.trim().toLowerCase().split(/\s+/).filter(Boolean);
      const group = get('markingCategory').value, grid = get('markingGrid');
      const lines = tab === 'longitudinal' ? app.longitudinal.source : null;
      const matches = (lines ? lines.items() : C.catalog).filter(item => (!group || item.group === group)
        && query.every(word => `${item.name} ${item.group} ${item.note ?? ''}`.toLowerCase().includes(word)));
      const favorites=lines?lineFavorites:markingFavorites,ordered=favorites.order(matches,item=>item.id),hasFavorites=ordered.some(item=>favorites.has(item.id));
      grid.replaceChildren();
      for(const item of ordered){
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
        favorites.append(grid,button,item.id,item.name,populate,{headings:hasFavorites,otherLabel:'Other markings'});
      }
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
        if (m.type === 'crosswalkAesthetic') m.aesthetic = true;
        m.type = type;
        if (!C.variantsFor(m)?.some(([v]) => v === m.variant)) delete m.variant;
        if (text != null) { m.text = text; m.gap ??= C.LINE_GAP.min; }
        if (item.kind === 'shield') Object.assign(m, { route: m.route ?? draft.route, size: m.size ?? draft.size });
        if (item.repeat) m.repeat ??= { length: 0, spacing: item.repeat };
        else delete m.repeat;
        changed('Marking changed.');
      } else {
        draft.type = type;
        if (!C.variantsFor(draft)?.some(([v]) => v === draft.variant)) delete draft.variant;
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
    pair('markingExtent', (m, v) => { m.extent = v; }, () => model().extent ?? (model().type === 'speedReduction' ? C.TICKS.length : C.BLOCK.length));
    pair('markingTableWidth', (m, v) => { m.tableWidth = v; }, () => model().tableWidth ?? C.HUMP.table);
    get('markingTickCount').addEventListener('input', event => {
      if (event.target.checkValidity() && Number.isFinite(event.target.valueAsNumber)) edit(m => { m.count = event.target.valueAsNumber; });
    });
    for (const [id, key] of [['markingVariant', 'variant'], ['markingBlockMessage', 'message'], ['markingAestheticTone', 'tone']])
      get(id).addEventListener('change', event => edit(m => { m[key] = event.target.value; }));
    get('markingForceBars').addEventListener('change', event => edit(m => { m.forceBars = event.target.checked; delete m.barDirection; delete m.barSource; }));
    pair('markingBarAngle', (m, v) => {
      m.forceBars = true;
      m.barAngle = v;
      delete m.barDirection; delete m.barSource;
    }, () => model().barAngle ?? 0);
    get('markingEnhanced').addEventListener('change', event => edit(m => {
      m.enhanced = event.target.checked;
      if (m.type === 'crosswalkSpecial') m.type = 'crosswalk';
    }));
    // SignalMaker's native upload button + hidden file input convention.
    // Decode locally and store a bounded PNG; no uploaded markup or remote URL.
    let crosswalkUpload=0;
    get('uploadCrosswalkImage').addEventListener('click',()=>get('crosswalkImageFile').click());
    get('removeCrosswalkImage').addEventListener('click',()=>edit(m=>{delete m.aestheticImage;}));
    get('crosswalkImageFit').addEventListener('change',event=>edit(m=>{m.imageFit=event.target.value;}));
    get('crosswalkImageFile').addEventListener('change',async event=>{
      const file=event.target.files[0];event.target.value='';if(!file)return;
      if(file.size>20*1024*1024){tell('Choose an image smaller than 20 MB.');return;}
      const request=++crosswalkUpload,target=model(),sheet=sheets.selected,url=URL.createObjectURL(file);
      tell('Loading image…');
      try {
        const image=new Image();image.src=url;await image.decode();
        if(request!==crosswalkUpload)return;
        if(model()!==target||sheets.selected!==sheet){tell('The selected crosswalk changed. Upload the image again.');return;}
        const scale=Math.min(1,2048/Math.max(image.naturalWidth,image.naturalHeight));
        const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
        canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
        edit(m=>{m.aestheticImage={src:canvas.toDataURL('image/png'),width:canvas.width,height:canvas.height,name:file.name};m.variant='image';m.aesthetic=true;m.imageFit??='cover';});
        tell('Image added. Choose Cover or Stretch to fit it.');
      }catch{tell('Could not read that image. Choose a PNG, JPEG, or WebP image.');}
      finally{URL.revokeObjectURL(url);}
    });
    get('markingAesthetic').addEventListener('change', event => edit(m => {
      if (m.type === 'crosswalkAesthetic') m.type = 'crosswalk';
      m.aesthetic = event.target.checked;
    }));
    get('markingAestheticColor').addEventListener('input', event => edit(m => {
      m.aestheticColor = event.target.value; m.tone = 'custom';
    }));
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
      const variants = C.variantsFor(m);
      get('markingVariantFields').hidden = !variants;
      if (variants) {
        const select = get('markingVariant');
        if (select.dataset.family !== m.type) {
          select.replaceChildren(...variants.map(([value, label]) => new Option(label, value)));
          select.dataset.family = m.type;
        }
        set('markingVariant', m.variant ?? variants[0][0]);
      }
      get('markingBlockMessageFields').hidden = m.type !== 'doNotBlock' || !['outlineWords', 'words'].includes(m.variant);
      set('markingBlockMessage', m.message ?? 'doNotBlock');
      get('markingExtentFields').hidden = !['doNotBlock', 'speedReduction'].includes(m.type);
      const extent = m.extent ?? (m.type === 'speedReduction' ? C.TICKS.length : C.BLOCK.length);
      set('markingExtent', extent); set('markingExtentValue', extent);
      get('markingTickCountFields').hidden = m.type !== 'speedReduction'; set('markingTickCount', m.count ?? C.TICKS.count);
      get('markingTableFields').hidden = m.type !== 'speedHump' || !/^(table|crosswalk)/.test(m.variant ?? '');
      set('markingTableWidth', m.tableWidth ?? C.HUMP.table); set('markingTableWidthValue', m.tableWidth ?? C.HUMP.table);
      const aesthetic = C.isAesthetic(m);
      get('markingEnhancedRow').hidden = kind !== 'crosswalk';
      get('markingEnhanced').checked = Boolean(m.enhanced || m.type === 'crosswalkSpecial');
      const enhanced = kind === 'crosswalk' && get('markingEnhanced').checked;
      get('markingForceBarsRow').hidden = !enhanced;
      get('markingForceBars').checked = Boolean(forceBars(m));
      const override = enhanced && forceBars(m);
      get('markingBarAngleRow').hidden = !override;
      set('markingBarAngle', m.barAngle ?? 0); set('markingBarAngleValue', m.barAngle ?? 0);
      get('markingAestheticToggleRow').hidden = kind !== 'crosswalk';
      get('markingAesthetic').checked = aesthetic;
      get('markingAestheticImageFields').hidden=!aesthetic||m.variant!=='image';
      set('crosswalkImageFit',m.imageFit??'cover');
      get('crosswalkImageName').textContent=m.aestheticImage?.name??'No image uploaded.';
      get('removeCrosswalkImage').disabled=!m.aestheticImage;
      get('markingAestheticFields').hidden = !aesthetic||m.variant==='image'; set('markingAestheticTone', m.tone ?? 'brick');
      get('markingAestheticColorRow').hidden = !aesthetic || m.variant==='image' || m.tone !== 'custom';
      set('markingAestheticColor', C.aestheticColor(m));
      get('markingTreatmentHint').textContent = m.type === 'doNotBlock' ? 'Choose a treatment and adjust the marked length.'
        : m.type === 'speedReduction' ? 'Adjust the marked length and number of tick pairs.'
        : m.type === 'speedHump' ? 'Choose a hump, table, or advance treatment.'
        : aesthetic && m.variant==='image' ? 'Upload an image, choose its fit, then click both ends of the crossing.' : aesthetic ? 'Choose a pattern and surface color, then click both ends of the crossing.' : '';
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
      get('markingLineFields').hidden = kind === 'crosswalk' || kind === 'surface';
      get('markingAllLanes').checked = Boolean(m.all);
      const contrast = m === draft ? m.contrast : Boolean(m.contrast);
      get('markingContrast').checked = contrast;
      const fixed = ['stopLine', 'yieldLine'].includes(m.type) || kind === 'crosswalk';
      get('markingContrastStyleRow').hidden = !contrast || fixed;
      set('markingContrastStyle', m === draft ? m.contrastStyle : (m.contrast || draft.contrastStyle));
      get('markingRepeatFields').hidden = !item?.repeat;
      const spacing = m === draft ? draft.spacing : m.repeat?.spacing ?? item?.repeat ?? draft.spacing;
      set('markingSpacing', spacing); set('markingSpacingValue', spacing);
      get('markingRepeatLengthRow').hidden = !editing;
      if (editing) set('markingRepeatLength', Math.round(m.repeat?.length ?? 0));
      const copies = editing ? drawn.get(m.id)?.copies.length ?? C.repeats(m).length : 1;
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
      cancelDragFrame();
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
    // Use the actual painted geometry (including transforms), not the pick box
    // or an intersection mouth. Hidden display levels still retain controls.
    function simulatorControls(sheet, {signalStops=false}={}) {
      const result=[];
      let solved;
      for(const marking of sheet.markings??[]) {
        const virtual=signalStops&&marking.type==='stopLine'&&marking.trafficControl?.unlinked!==true;
        if(signalStops&&!virtual)continue;
        const control=virtual?{type:'stop',intersection:marking.trafficControl?.intersection}:marking.trafficControl;
        if(!control||!['stop','yield'].includes(control.type)||marking.type!==(control.type==='stop'?'stopLine':'yieldLine'))continue;
        const placed=transformPlacement(layout(sheet,{...marking,contrast:false}),marking);
        for(const [i,copy] of (placed?.copies??[]).entries()) {
          const a=copy.hit[0],b=copy.hit[1],length=Math.hypot(b.x-a.x,b.y-a.y);
          if(!length)continue;
          const direction={x:(b.x-a.x)/length,y:(b.y-a.y)/length};
          const points=copy.parts.flatMap(part=>part.rings.flat());
          const road=sheet.roads.find(r=>r.id===copy.on.road),level=road?.level??1;
          const incoming=a=>(a.links??[]).some(l=>l.road===copy.on.road&&Boolean(l.e)!==Boolean(app.traffic.reversed));
          // An explicit standalone override beats both a manual association
          // and the marking's road/intersection placement. Keep the STOP/YIELD
          // action itself: only its participation in turn-taking is disabled.
          let intersection=control.unlinked===true?undefined:control.intersection??copy.on.intersection,inferred=false;
          if(control.unlinked!==true&&intersection==null&&road){
            // Signals can use set-back bars on a directly attached approach road.
            // They are virtual signal gates, never standalone STOP actions; the
            // nearest matching bar before the mouth is chosen by Controls.attach.
            // A line ending exactly at an attached incoming road mouth is
            // unambiguous intersection control, even without a manual link.
            // Use actual transformed paint, topology and level, never mere
            // proximity. Set-back/standalone lines retain explicit linking.
            const dot=p=>p.x*direction.x+p.y*direction.y,n={x:-direction.y,y:direction.x};
            const front=Math.max(...points.map(dot)),across=points.map(p=>p.x*n.x+p.y*n.y),epsilon=.001*ppf(sheet)/.3048;
            const end=app.traffic.reversed?0:1;solved??=app.roadEditor.solve(sheet);
            const atMouth=copy.lanes.every(on=>{
              const p=app.roadEditor.lanePoint(sheet,road,end,on.lane,solved),cross=p.x*n.x+p.y*n.y;
              return Math.abs(dot(p)-front)<=epsilon&&cross>=Math.min(...across)-epsilon&&cross<=Math.max(...across)+epsilon;
            });
            const candidates=(atMouth||virtual)?(sheet.intersections??[]).filter(item=>(item.level??1)===level).flatMap(item=>item.approaches.filter(incoming).map(()=>item)):[];
            if(candidates.length===1){intersection=candidates[0].id;inferred=true;}
          }
          const item=sheet.intersections?.find(item=>item.id===intersection);
          if(virtual&&!item?.trafficSignal?.version)continue;
          const approach=copy.on.approach??item?.approaches.find(incoming)?.id;
          result.push({id:`${virtual?'signal:':''}${marking.id}:${i}`,marking:marking.id,type:virtual?'signal':control.type,intersection,approach,inferred,
            on:copy.lanes,controlledLanes:copy.lanes.flatMap(on=>{
              if(on.intersection!=null)return [on.lane];
              const a=item?.approaches.find(a=>a.id===approach),link=a?.links?.find(l=>l.road===on.road&&Boolean(l.e)!==Boolean(app.traffic.reversed));
              const ids=app.traffic.reversed?a?.outLanes:a?.inLanes,index=ids?.indexOf(link?.to);
              return index>=0?[ids[index+on.lane-link.lane]].filter(Boolean):[];
            }),direction,points,
            level:copy.on.road!=null?level:(sheet.intersections?.find(i=>i.id===copy.on.intersection)?.level??item?.level??1)});
        }
      }
      return result;
    }
    const outlines = id => drawn.get(id)?.copies.map(copy => copy.hit) ?? [];
    app.markings = { simulatorControls, selectedItem:()=>!panel.hidden && tab==='lateral' && current()?{kind:'markings',id:selected}:null, diagnostics: () => structuredClone({selected,tab,draft,crosswalkStart}), draw, updateDrawing, crosswalkCuts, refreshOverlay, capture, rehome, openPicker, focusAt, hitAt, anchorAt, outlines, showTab, draftType: () => draft.type, tab: () => tab };
    showTab('lateral');
    updatePanel();
    app.roadEditor.render();
    tell(HOVER_HINT);
  });
})();
