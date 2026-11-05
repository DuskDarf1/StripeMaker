// Exactness and invalidation checks for editor-only geometry reuse.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const elements = fs.readFileSync('js/elements.js', 'utf8');
const intersections = fs.readFileSync('js/intersections.js', 'utf8');

test('uniform cross sections exactly match sampling every station, with profiles and tapers falling back', () => {
  const source = elements.slice(elements.indexOf('    function buildShape('), elements.indexOf('    // Taper settings per lane end'));
  const globals = { window: { StripeMaker: { roadWidths: require('../js/road-widths.js') } },
    feetToPixels: (s,n) => n*12/s.inchesPerPixel, unit: p => { const n=Math.hypot(p.x,p.y)||1;return {x:p.x/n,y:p.y/n}; } };
  const optimized = vm.createContext(globals), sampled = vm.createContext({...globals});
  vm.runInContext(source,optimized); vm.runInContext(source.replace('const uniform = !tapers.size','const uniform = false && !tapers.size'),sampled);
  const line=Array.from({length:101},(_,i)=>({x:i*12.345,y:Math.sin(i/20)*100}));
  for(let n=1;n<=8;n++)for(const mode of ['uniform','wide','ends','profile','gap','taper']) {
    const road={id:1,lanes:n,laneWidth:12,ends:[{joint:1},{joint:2}],laneTypes:{0:{type:'bike',width:5}}};
    if(mode==='wide')road.keepWidthAtJoins=true;
    if(mode==='ends')Object.assign(road,{perLaneWidths:true,laneEndWidths:{'0:0':6,'1:0':8}});
    if(mode==='profile')road.widthProfiles={0:{width:12,start:8,end:10,from:.1,to:.7}};
    if(mode==='gap')road.gapProfiles={1:{start:6,end:0,from:0,to:1}};
    const sheet={inchesPerPixel:2.31,roads:[road],joints:[{id:1,links:[]},{id:2,links:[]}]};
    const tapers=mode==='taper'?new Map([['0:0',111],['1:0',227]]):new Map();
    for(const shift of [0,1.2,(width,f)=>width*f]) {
      const a=structuredClone(optimized.buildShape(sheet,road,line,tapers,shift));
      const b=structuredClone(sampled.buildShape(sheet,road,line,tapers,shift));
      assert.deepEqual(a,b,`${mode}, ${n} lanes`);
    }
    const pairedShift=width=>6.5+n*width/2;
    assert.deepEqual(structuredClone(optimized.buildShape(sheet,road,line,tapers,pairedShift,true)),
      structuredClone(sampled.buildShape(sheet,road,line,tapers,pairedShift,true)),`paired ${mode}, ${n} lanes`);
  }
});

test('boundary reuse returns independent geometry and invalidates replaced shape samples', () => {
  let calls=0;
  const context=vm.createContext({shapeOffset:(shape,f)=>{calls++;return shape.line.map((p,i)=>({x:p.x,y:p.y+f(i)}));}});
  vm.runInContext(elements.slice(elements.indexOf('    const boundaryCache ='),elements.indexOf('    function lanePoint('))+'\nthis.boundary=boundary;',context);
  const shape={line:[{x:0,y:0},{x:10,y:2}],bounds:[[0,12],[0,12]]};
  const expected=structuredClone(context.boundary(shape,1));
  const mutated=context.boundary(shape,1);mutated.reverse();mutated[0].x=500;
  assert.deepEqual(structuredClone(context.boundary(shape,1)),expected);assert.equal(calls,1);
  shape.bounds=[[0,15],[0,15]];assert.notDeepEqual(structuredClone(context.boundary(shape,1)),expected);assert.equal(calls,2);
  shape.line=[{x:0,y:5},{x:10,y:9}];context.boundary(shape,1);assert.equal(calls,3);
});

test('indexed polyline slices exactly match walking every segment, including duplicate points and endpoints', () => {
  let hypotCalls = 0;
  const math = Object.create(Math);
  math.hypot = (...args) => { hypotCalls++; return Math.hypot(...args); };
  const context = vm.createContext({ Math: math });
  vm.runInContext(elements.slice(elements.indexOf('    function measurePolyline('), elements.indexOf('    // A lane\'s pavement between arc lengths')), context);
  let seed = 42;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  for (let trial = 0; trial < 60; trial++) {
    const points = Array.from({ length: trial % 20 }, (_, i) => ({ x: i % 3 ? random() * 10000 : 0, y: random() * 10000 }));
    if (points.length > 4) points[3] = { ...points[2] };
    const measured = context.measurePolyline(points), total = measured.along.at(-1);
    const ranges = [[-10, -1], [0, 0], [0, total], [total, total], [total + 1, total + 2], [total, 0],
      ...measured.along.map(s => [s, s + .01]),
      ...Array.from({ length: 20 }, () => { const a = random() * total; return [a, a + random() * total]; })];
    for (const [a, b] of ranges) {
      const expected = structuredClone(context.slicePolyline(points, a, b));
      hypotCalls = 0;
      const actual = structuredClone(context.slicePolyline(points, a, b, measured));
      assert.deepEqual(actual, expected);
      assert.equal(hypotCalls, 0, 'prepared slices never remeasure segments');
    }
  }
});

function reconciliation({ removeLink = false, updateWidth = false, supplied = false } = {}) {
  const a = { inLanes: ['a', 'b'], outLanes: [], laneDetails: { a: { width: updateWidth ? 8 : 12 }, b: { width: 12 } },
    links: [{ road: 1, e: 1, lane: 0, to: 'a' }, { road: 1, e: 1, lane: 1, to: 'b' }] };
  if (removeLink) a.links.push({ road: 1, e: 1, lane: 9, to: 'missing' });
  const item = { approaches: [a] }, sheet = { roads: [{ id: 1, lanes: 2 }], intersections: [item] };
  let solves = 0, reads = 0;
  const snapshot = () => ({ width: a.laneDetails.a.width, count: a.links.length });
  const provided = supplied ? snapshot() : undefined;
  const roads = {
    solve: () => { solves++; return snapshot(); },
    intersectionEnd: (_sheet, _link, solved) => {
      reads++;
      if (supplied) assert.equal(solved, provided, 'retain the caller\'s solve semantics');
      else if (!solved) { solves++; solved = snapshot(); }
      return { freeLanes: [true, true], inDetails: [{ width: removeLink ? solved.count + 10 : 12 }, { width: updateWidth ? solved.width : 12 }] };
    },
  };
  const context = vm.createContext({ roads, app:{roadWidths:{invalidateSnapshot(){}}}, normalize() {}, dragging: null, syncBoundMedian() {},
    laneOf: (approach, link) => approach.inLanes.indexOf(link.to), roadLanes: () => 2 });
  vm.runInContext(intersections.slice(intersections.indexOf('    function reconcile('), intersections.indexOf('    // Lane links pin')), context);
  context.reconcile(sheet, item, provided);
  return { a, solves, reads };
}

test('stable lane links share one complete road-end calculation', () => {
  const result = reconciliation();
  assert.equal(result.solves, 1);
  assert.equal(result.reads, 1);
  assert.equal(result.a.laneDetails.b.width, 12);
});

test('removing a stale lane link invalidates the road end before reading lane details', () => {
  const result = reconciliation({ removeLink: true });
  assert.equal(result.a.links.length, 2);
  assert.equal(result.a.laneDetails.a.width, 12);
  assert.equal(result.solves, 2);
});

test('a normalized lane width invalidates later lane details within the same approach', () => {
  const result = reconciliation({ updateWidth: true });
  assert.equal(result.a.laneDetails.a.width, 12);
  assert.equal(result.a.laneDetails.b.width, 12);
  assert.equal(result.solves, 2);
  const supplied = reconciliation({ updateWidth: true, supplied: true });
  assert.equal(supplied.solves, 0);
  assert.equal(supplied.a.laneDetails.b.width, 8);
});

test('attachment reuse tracks its complete road component and neighboring mouths', () => {
  const context=vm.createContext({round:item=>item.kind==='roundabout'});
  vm.runInContext(intersections.slice(intersections.indexOf('    function alignmentDependencies('),intersections.indexOf('    function reconcile(')),context);
  const data=require('./fixtures/dense-editor.cjs')(4),item=data.intersections[0];
  const dependency=()=>context.alignmentDependencies(data)(item),before=dependency();
  // Opposite corner has no common road component and must not invalidate.
  data.intersections.at(-1).x+=5;assert.equal(dependency(),before);
  const linked=item.approaches[0].links[0],road=data.roads.find(r=>r.id===linked.road);
  const remote=data.joints.find(j=>j.id===road.ends[1-linked.e].joint);
  remote.y+=7;assert.notEqual(dependency(),before);remote.y-=7;
  assert.equal(dependency(),before);
  // The far intersection changes endpoint widths without editing road JSON.
  data.intersections[1].approaches[2].width=15;assert.notEqual(dependency(),before);
  data.intersections[1].approaches[2].width=12;assert.equal(dependency(),before);
  // Reconnecting topology updates membership, even with unchanged list lengths.
  road.ends[1-linked.e].joint=data.joints.at(-1).id;assert.notEqual(dependency(),before);
});
