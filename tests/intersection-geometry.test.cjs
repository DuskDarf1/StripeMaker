const { test } = require("node:test");
const assert = require("node:assert/strict");
const G = require("../js/intersection-geometry.js");
// A default intersection with the automatic movements filled in.
const filled = () => {
  const x = G.create();
  G.auto(x);
  return x;
};
const inside = (p, poly) => {
  let yes = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i],
      b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) yes = !yes;
  }
  return yes;
};
test("default junction has four mouths, correct traffic sides and curved corners", () => {
  const x = filled();
  assert.equal(G.validate(x), "");
  assert.equal(x.approaches.length, 4);
  const a = x.approaches[0];
  // Lanes sit beside the double yellow: half of its 10" centerline spacing out.
  const half = 5 / 12;
  assert.ok(Math.abs(G.lane(a, true, 0).y - -(6 + half)) < 1e-9);
  assert.ok(Math.abs(G.lane(a, false, 0).y - (6 + half)) < 1e-9);
  assert.deepEqual(G.medians(a), [], "a double yellow is not a median");
  assert.equal(G.corner(a, x.approaches[1]).radius, 20);
  assert.ok(!inside({ x: 80, y: 80 }, G.outline(x)));
});
test("default lane movements remain inside pavement and have correct endpoint tangents", () => {
  const x = filled(),
    poly = G.outline(x, 2 / 3);
  for (const m of x.movements) {
    const c = G.curve(x, m),
      a = x.approaches.find((a) => a.id === m.from),
      b = x.approaches.find((a) => a.id === m.to);
    assert.ok(G.dot(G.unit(G.sub(c[1], c[0])), G.axes(a).u) < -0.999);
    assert.ok(G.dot(G.unit(G.sub(c[3], c[2])), G.axes(b).u) > 0.999);
    for (let i = 1; i < 100; i++) assert.ok(inside(G.sample(c, i / 100), poly), "movement leaves pavement");
  }
});
test("T, five-leg, one-way and skew layouts validate", () => {
  for (const type of ["T", "five", "oneway", "skew"]) {
    const x = filled();
    if (type === "T") x.approaches.pop();
    if (type === "five") x.approaches.push(G.approach(45));
    if (type === "oneway") x.approaches[0].outgoing = 0;
    if (type === "skew") {
      const a = x.approaches[0];
      a.angle = 15;
      Object.assign(a, G.mul(G.axes(a).u, 100));
    }
    G.normalize(x);
    assert.equal(G.validate(x), "", type);
  }
});
test("removing lanes preserves surviving lane identity and custom movements", () => {
  const x = filled(),
    a = x.approaches[0],
    m = x.movements.find((m) => m.input === a.inLanes[0]);
  m.autoCurve = false;
  m.pullIn = 71;
  a.incoming = 1;
  G.normalize(x);
  assert.ok(x.movements.includes(m));
  assert.equal(m.pullIn, 71);
  assert.ok(x.movements.every((m) => x.approaches.some((a) => a.inLanes.includes(m.input))));
});
test("median nose is capped and square corners have no radius", () => {
  const x = filled(),
    a = x.approaches[0];
  a.median = 12;
  a.nose = 500;
  a.radius = 0;
  assert.equal(G.corner(a, x.approaches[1]).radius, 0);
  assert.ok(G.median(a).every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)));
  assert.ok(Math.min(...G.median(a).map((p) => p.x)) >= 5);
});
test("rejects overlapping openings and inward approaches", () => {
  const x = filled();
  x.approaches[1] = { ...x.approaches[1], x: x.approaches[0].x - 1, y: 1, angle: 0 };
  assert.notEqual(G.validate(x), "");
  const y = filled();
  y.approaches[0].angle = 180;
  assert.notEqual(G.validate(y), "");
});

test("movement routes follow tight and skewed T pavement corners instead of leaving the surface", () => {
  for (const radius of [0, 5, 20, 80]) {
    const item = filled();
    item.approaches.shift();
    for (const a of item.approaches) {
      a.radius = radius;
      const distance = a.angle === 180 ? 140 : 200;
      a.angle = a.angle === 180 ? 188 : a.angle;
      Object.assign(a, G.mul(G.axes(a).u, distance));
    }
    G.normalize(item);
    G.auto(item);
    const region = G.routing(item, 2 / 3);
    for (const m of item.movements) {
      const route = G.route(item, m, region);
      assert.ok(route.length > 2);
      for (let i = 1; i < route.length; i++) {
        for (let j = 1; j < 10; j++) {
          const p = G.add(route[i - 1], G.mul(G.sub(route[i], route[i - 1]), j / 10));
          assert.ok(
            G.contains(p, region.polygon),
            `radius ${radius}: route outside pavement at ${p.x},${p.y}`,
          );
        }
      }
    }
  }
});
test("movement routes avoid median noses as their setbacks change", () => {
  const item = filled();
  for (const a of item.approaches) {
    a.median = 18;
    a.nose = 65;
  }
  G.normalize(item);
  const a = item.approaches[0];
  item.movements.push(G.movement(a, 0, a, 0));
  const region = G.routing(item, 2 / 3);
  for (const m of item.movements) {
    const route = G.route(item, m, region);
    for (const p of route.slice(1, -1)) {
      assert.ok(G.contains(p, region.polygon));
      assert.ok(!region.holes.some((h) => G.contains(p, h)), "route crossed a median");
    }
  }
});
const segmentDistance = (p, a, b) => {
  const d = G.sub(b, a),
    t = Math.max(0, Math.min(1, G.dot(G.sub(p, a), d) / (G.dot(d, d) || 1)));
  return G.length(G.sub(p, G.add(a, G.mul(d, t))));
};
const apart = (p, q) => {
  const mid = (r) => r.slice(Math.floor(r.length * 0.15), Math.ceil(r.length * 0.85));
  let best = Infinity;
  for (const x of mid(p))
    for (let i = 1; i < q.length; i++) best = Math.min(best, segmentDistance(x, q[i - 1], q[i]));
  return best;
};
test("movements between the same two approaches stay parallel instead of crossing", () => {
  for (const turn of ["through", "left", "right"]) {
    const x = filled(),
      a = x.approaches[0],
      b = x.approaches[turn === "through" ? 2 : turn === "left" ? 3 : 1];
    a.incoming = 3;
    b.outgoing = 3;
    G.normalize(x);
    x.movements = x.movements.filter((m) => m.from !== a.id);
    for (let i = 0; i < 3; i++) x.movements.push(G.movement(a, i, b, i));
    const paths = G.routes(x, G.routing(x));
    const group = x.movements.filter((m) => m.from === a.id).map((m) => paths.get(m.id));
    for (let i = 0; i < group.length; i++)
      for (let j = i + 1; j < group.length; j++)
        assert.ok(apart(group[i], group[j]) > 12 * 0.6, `${turn} movements ${i} and ${j} crowd each other`);
    const region = G.routing(x);
    for (const route of group)
      for (const p of route.slice(1, -1)) {
        assert.ok(inside(p, G.outline(x, 1)), `${turn} route leaves pavement`);
        assert.ok(!region.holes.some((h) => inside(p, h)), `${turn} route crosses a median`);
      }
  }
});
test("split medians separate same-direction lanes and stay out of movement routes", () => {
  const x = filled(),
    a = x.approaches[0];
  a.incoming = 3;
  a.splits = [{ incoming: true, after: 2, width: 6, nose: 40, surface: "concrete" }];
  G.normalize(x);
  G.auto(x);
  assert.equal(G.validate(x), "");
  // Lane 3 (index 2) sits a median's width further out than without the split.
  const half = 5 / 12;
  assert.ok(Math.abs(G.lane(a, true, 1).y - -(18 + half)) < 1e-9);
  assert.ok(Math.abs(G.lane(a, true, 2).y - -(36 + half)) < 1e-9);
  assert.ok(Math.abs(G.side(a, true) - -(42 + half)) < 1e-9);
  const medians = G.medians(a);
  assert.equal(medians.length, 1);
  assert.equal(medians[0].key, `split-${a.splits[0].id}`);
  assert.ok(inside(G.local(a, G.splitCenter(a, a.splits[0]), -10), medians[0].points));
  const region = G.routing(x);
  for (const route of G.routes(x, region).values())
    for (const p of route.slice(1, -1))
      assert.ok(!inside(p, medians[0].points), "route crosses the split median");
  // A split past the last lane boundary is dropped.
  a.splits.push({ incoming: false, after: 2, width: 6 });
  G.normalize(x);
  assert.equal(a.splits.length, 1);
});
test("default is a compact crossing of two 2-lane two-way roads with turns inside the corners", () => {
  const x = filled();
  assert.equal(x.approaches.length, 4);
  for (const a of x.approaches) {
    assert.equal(a.incoming, 1);
    assert.equal(a.outgoing, 1);
    assert.equal(G.length(a), G.REACH);
  }
  const paths = G.routes(x, G.routing(x));
  for (const m of x.movements) {
    const a = x.approaches.find((a) => a.id === m.from),
      b = x.approaches.find((a) => a.id === m.to);
    if (a === b || Math.abs(G.dot(G.axes(a).u, G.axes(b).u)) > 0.99) continue;
    // A turn runs straight along its lane until the curb starts curving, then
    // turns; it never starts sweeping out at the opening.
    const route = paths.get(m.id),
      u = G.axes(a).u,
      v = G.axes(b).u;
    const bent = (p, dir, lane) => Math.abs(G.dot(G.sub(p, lane), { x: -dir.y, y: dir.x })) > 0.05;
    for (const p of route) {
      if (bent(p, u, route[0]))
        assert.ok(G.dot(p, u) <= G.throat(x, a) + 0.5, "turn starts before the curb curves");
      if (bent(p, v, route.at(-1)))
        assert.ok(G.dot(p, v) <= G.throat(x, b) + 0.5, "turn ends after the curb curves");
    }
  }
});
test("a new intersection starts with no movements", () => {
  const x = G.create();
  assert.deepEqual(x.movements, []);
  assert.equal(G.validate(x), "");
});

test('connected median islands taper at the mouth without moving lane centers',()=>{
 const item=G.create(),a=item.approaches[0];a.incoming=2;a.outgoing=2;a.median=0;G.normalize(item);
 const lanes=[true,false].flatMap(incoming=>[0,1].map(i=>G.lane(a,incoming,i)));
 const edges=[G.edge(a,true),G.edge(a,false)];
 a.gap=G.gap(a);a.median=6;a.medianInset=true;a.medianMouth=0;
 a.splits=[{id:'inset',incoming:true,after:1,width:6,nose:35,surface:'grass',inset:true}];
 assert.deepEqual([true,false].flatMap(incoming=>[0,1].map(i=>G.lane(a,incoming,i))),lanes);
 assert.deepEqual([G.edge(a,true),G.edge(a,false)],edges);
 for(const m of G.medians(a)){
  assert.deepEqual(m.points[0],m.points.at(-1),'island tapers to its mouth point');
  assert(m.points.length>26,'full rounded nose remains');
  assert(m.points.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)));
 }
});

// Same 8-inch pavement margin used by the road renderer, measured from
// marking center; split islands use white, center medians use yellow.
test('intersection island surfaces match road median edge-line setbacks', () => {
 const a=G.create().approaches[0];a.median=8;a.nose=25;
 a.incoming=2;a.inLanes=['i0','i1'];
 a.splits=[{id:'island',incoming:true,after:1,width:6,nose:20,surface:'concrete'}];
 for(const m of G.medians(a)) {
  const points=G.medianSurface(a,m,8/12);
  const half=(m.split?m.split.width:a.median)/2;
  const ring=half+(m.split?0:5/12);
  const n=G.axes(a).n,u=G.axes(a).u;
  const lateral=p=>G.dot(G.sub(p,a),n);
  assert(Math.abs(Math.abs(lateral(points[0])-m.center)-(ring-8/12))<1e-9);
  assert(Math.abs(G.dot(G.sub(points[0],a),u))<1e-9,'mouth remains at road joint');
  const tip=points.reduce((best,p)=>G.dot(G.sub(p,a),u)<G.dot(G.sub(best,a),u)?p:best);
  const surfaceReach=-G.dot(G.sub(tip,a),u);
  const lineReach=G.reach(a,half,m.nose)-half+ring;
  assert(Math.abs(lineReach-surfaceReach-8/12)<1e-9,'same setback around rounded nose');
 }
});
