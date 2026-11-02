const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
// Marking symbols and the pavement font, for YIELD and arrows.
globalThis.window = globalThis;
globalThis.StripeMaker = {};
for (const f of ["assets/markings/symbols.js", "assets/markings/font.js"])
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, "..", f), "utf8"));
const G = require("../js/intersection-geometry.js");
globalThis.StripeMaker.intersectionGeometry = G;
const C = require("../js/marking-catalog.js");
const R = require("../js/roundabout-geometry.js");

const lanes = (x, n) => {
  for (const a of x.approaches) Object.assign(a, { incoming: n, outgoing: n });
  return R.normalize(x);
};
const inside = (p, poly) => {
  let yes = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) yes = !yes;
  }
  return yes;
};
const kinds = (x, a, j) => R.destinations(x, a, a.inLanes[j]).map((id) => R.turnOf(x, a, x.approaches.find((b) => b.id === id))).sort();
const lineDistance = (p, line) => Math.min(...line.slice(1).map((q, i) => {
  const v = G.sub(q, line[i]), f = Math.max(0, Math.min(1, G.dot(G.sub(p, line[i]), v) / (G.dot(v, v) || 1)));
  return G.length(G.sub(p, G.add(line[i], G.mul(v, f))));
}));
// A broad exit connector may meet the approach farther out than the circle
// intersection. At a splitter, its final stretch becomes the solid island
// outline. Follow that connected stretch to the receiving edge as well.
const exitGuides = (paint, leg, k) => {
  const edge = leg.line(s => leg.exitOff(k, s), 0, leg.meet(s => leg.exitOff(k, s)));
  return paint.filter(l => l.width === 0.5 && l.dash?.[0] === 2 && l.dash[1] === 4).flatMap(l => {
    const end = l.points.at(-1);
    if (lineDistance(end, edge) < 0.02) return [l];
    if (k) return [];
    for (const solid of paint.filter(s => s.width === 0.5 && s.color === '#ffffff' && !s.dash)) {
      if (lineDistance(solid.points.at(-1), edge) > 0.02) continue;
      const join = solid.points.findIndex(p => G.length(G.sub(p, end)) < 1e-6);
      if (join >= 0) return [{ ...l, points: [...l.points, ...solid.points.slice(join + 1)] }];
    }
    return [];
  });
};
// Measure across the lane, not along a ray from the roundabout center.
// Spiral circles have different centers, so radial subtraction conceals
// width errors and rejects correct parallel boundaries.
const normalWidth = (inner, outer, theta) => {
  const p = inner.at(theta), tangent = G.unit(G.sub(inner.at(theta + 0.001), inner.at(theta - 0.001)));
  const normal = { x: tangent.y, y: -tangent.x };
  let lo = 0, hi = 100;
  for (let i = 0; i < 40; i++) {
    const m = (lo + hi) / 2, q = G.add(p, G.mul(normal, m));
    if (G.length(q) < outer.radius(Math.atan2(q.y, q.x))) lo = m; else hi = m;
  }
  return (lo + hi) / 2;
};

test("default roundabout is single-lane at the FDM starting diameter", () => {
  const x = R.create();
  assert.equal(R.validate(x), "");
  assert.equal(x.kind, "roundabout");
  assert.equal(R.laneCount(x), 1);
  assert.equal(R.diameter(x), 140);              // FDM 213.3 (4)(a)
  assert.deepEqual(R.laneWidths(x), [20]);        // Exhibit 213-2, W = 18'-20'
  assert.deepEqual(kinds(x, x.approaches[0], 0), ["left", "right", "through", "u"], "a single lane serves every exit");
  const poly = R.outline(x);
  assert.ok(inside({ x: 0, y: 0 }, poly), "the circle is paved");
  assert.ok(!inside({ x: 150, y: 150 }, poly), "corners are not");
});

test("two-lane legs give a two-lane circle with FDM lane use", () => {
  const x = lanes(R.create(), 2);
  assert.equal(R.validate(x), "");
  assert.equal(R.laneCount(x), 2);
  assert.equal(R.diameter(x), 180);              // FDM 213.3 (4)(b)
  assert.deepEqual(R.laneWidths(x), [15, 15]);    // Shared editor width; 15 ft is the application default
  const a = x.approaches[0];
  assert.deepEqual(kinds(x, a, 0), ["left", "through", "u"]);
  assert.deepEqual(kinds(x, a, 1), ["right", "through"]);
  assert.deepEqual(R.demand(x), { front: [2, 2, 2, 2], after: [2, 2, 2, 2] });
});

const movementMeanings = x => x.approaches.map(a => ({
  id: a.id,
  turns: Object.fromEntries(x.approaches.map(b => [b.id, R.turnOf(x, a, b)])),
  destinations: a.inLanes.map(id => [...R.destinations(x, a, id)]),
}));

test('roundabout movement meanings survive entrance angles, mouth moves, and whole-leg bends', () => {
  for (const count of [1, 2, 3, 4]) {
    const x = lanes(R.create(), count), meanings = movementMeanings(x);
    const references = x.approaches.map(a => a.movementAngle);
    // Move mouths into different quadrants and change their tangents by
    // enough to change the old angle-based through/left/right classifier.
    for (const [i, a] of x.approaches.entries()) {
      const angle = a.angle + [70, -55, 100, -80][i];
      Object.assign(a, G.mul(G.axes({ angle }).u, 280 + i * 20), { angle });
      R.setApproachBend(a, i % 2 ? 35 : -35);
    }
    R.normalize(x);
    assert.deepEqual(movementMeanings(x), meanings, 'approach IDs retain their turn meanings and default lane destinations');
    assert.deepEqual(x.approaches.map(a => a.movementAngle), references);
    const restored = R.normalize(JSON.parse(JSON.stringify(x)));
    assert.deepEqual(movementMeanings(restored), meanings, 'saved references survive JSON normalization');
  }
});

test('a skewed but valid entrance keeps its lane count, arrows, and spiral decisions', () => {
  for (const shape of ['circle', 'oval', 'peanut']) {
    const x = lanes(R.create(), 2);
    Object.assign(x.roundabout, { shape, ratio: 1.2, icd: 360 });
    for (const a of x.approaches) Object.assign(a, G.mul(G.axes(a).u, R.requiredReach(x, a)));
    const a = x.approaches[0], through = x.approaches[2];
    a.dest[a.inLanes[0]] = [through.id];
    const before = movementMeanings(x), count = R.laneCount(x), spiral = R.spiralWanted(x);
    const arrows = x.approaches.map(a => R.circulatingArrows(x, a));
    Object.assign(a, G.mul(G.axes({ angle: 50 }).u, G.length(a)), { angle: 50 });
    R.normalize(x);
    assert.equal(R.validate(x), '', `${shape}: the edited approach fits`);
    assert.deepEqual(movementMeanings(x), before, 'explicit and automatic destinations both retain their meanings');
    assert.equal(R.turnOf(x, a, through), 'through');
    assert.equal(R.laneCount(x), count);
    assert.equal(R.spiralWanted(x), spiral);
    assert.deepEqual(x.approaches.map(a => R.circulatingArrows(x, a)), arrows);
    assert.ok(R.markings(x, C).lines.every(l => l.points.every(p => Number.isFinite(p.x) && Number.isFinite(p.y))));
  }
});

test('legacy roundabouts acquire stable movement references from their mouths, not skewed tangents', () => {
  const x = lanes(R.create(), 2), meanings = movementMeanings(x);
  for (const a of x.approaches) delete a.movementAngle;
  x.approaches[3].angle += 70;
  R.normalize(x);
  assert.deepEqual(movementMeanings(x), meanings, 'a north mouth still represents the north approach');
  x.approaches[3].angle += 70;
  Object.assign(x.approaches[3], { x: 250, y: 10 });
  R.normalize(x);
  assert.deepEqual(movementMeanings(x), meanings, 'migration runs once, not on every edit');
});

test('adding and deleting legs after rotation preserves existing roundabout movement references', () => {
  const x = lanes(R.create(), 2), original = movementMeanings(x);
  for (const a of x.approaches) {
    a.angle += 120;
    Object.assign(a, G.mul(G.axes(a).u, 250));
  }
  // The new leg is 30 degrees clockwise of the original east approach,
  // despite now having a physical bearing of 150 degrees on the sheet.
  const added = R.approach(150); x.approaches.push(added); R.normalize(x);
  assert.ok(Math.abs(added.movementAngle - 30) < 1e-6);
  for (const record of original) {
    const a = x.approaches.find(a => a.id === record.id);
    for (const [id, turn] of Object.entries(record.turns))
      assert.equal(R.turnOf(x, a, x.approaches.find(b => b.id === id)), turn);
  }
  x.approaches = x.approaches.filter(a => a !== added);
  R.normalize(x);
  assert.deepEqual(movementMeanings(x), original, 'deleting a leg does not renumber movement directions');
});

test("a 1x2 roundabout leaves out lane lines where one lane is needed (Exhibit 213-3)", () => {
  const x = R.create();
  x.approaches.forEach((a, i) => { if (i % 2) Object.assign(a, { incoming: 2, outgoing: 2 }); });
  R.normalize(x);
  const d = R.demand(x);
  assert.equal(R.laneCount(x), 2);
  assert.equal(d.front.filter((q) => q === 1).length, 2, "two fronts need one lane");
  assert.equal(d.front.filter((q) => q === 2).length, 2);
});

test("markings: dotted extensions, YIELD, left-lane arrow with the dot", () => {
  const x = lanes(R.create(), 2), m = R.markings(x, C);
  const extensions = m.lines.filter((l) => l.dash && Math.abs(l.width - 1) < 1e-9);
  assert.equal(extensions.length, 4, "12 in 2'-2' dotted extension at each entry");
  assert.deepEqual(extensions[0].dash, [2, 2]);
  const guides = m.lines.filter((l) => l.dash && l.dash[0] === 2 && l.dash[1] === 4);
  assert.ok(guides.length >= 4, "6 in 2'-4' dotted guides spiral to the exits");
  assert.ok(m.lines.some((l) => l.color === "#ffc72c"), "yellow splitter edge lines");
  assert.ok(m.symbols.length > 20, "YIELD words and arrows");
  assert.deepEqual(R.arrowFor(["left", "through", "u"], true), { type: "throughLeft", dot: true });
  assert.deepEqual(R.arrowFor(["right", "through"], false), { type: "throughRight", dot: false });
  // Single-lane entries get no arrows (Exhibit 213-4).
  const single = R.markings(R.create(), C);
  assert.equal(single.symbols.filter((p) => p.rule === "evenodd").length, 0);
});

test("destinations adapt the circle: a left-turn-only lane brings a spiral island", () => {
  const x = lanes(R.create(), 2);
  R.normalize(x);
  assert.equal(R.spiralWanted(x), false);
  const a = x.approaches[0], left = x.approaches.find((b) => R.turnOf(x, a, b) === "left");
  a.dest[a.inLanes[0]] = [left.id];
  assert.equal(R.spiralWanted(x), true);
  assert.equal(R.validate(x), "");
  const L = R.layout(x), radii = L.inner.points.map((p) => Math.hypot(p.x, p.y));
  assert.ok(Math.max(...radii) - Math.min(...radii) > 5, "the island grows where fewer lanes are needed");
  // Never lumpy: the island is a smooth convex oval.
  const P = L.inner.points, turns = P.map((p, i) => {
    const a = P[(i + P.length - 1) % P.length], b = P[(i + 1) % P.length];
    return (p.x - a.x) * (b.y - p.y) - (p.y - a.y) * (b.x - p.x);
  });
  assert.ok(turns.every((t) => t >= -1e-6) || turns.every((t) => t <= 1e-6), "convex");
  // It never takes a lane a stretch needs: every point is outside the
  // narrowest roadway that stretch allows.
  for (const p of P) assert.ok(Math.hypot(p.x, p.y) <= L.outer.radius(Math.atan2(p.y, p.x)) - L.widths.at(-1) + 0.5);
});

test("splitter islands follow the approach design speed (213.3.5)", () => {
  assert.equal(R.SPLITTER_MIN(35), 50);
  assert.equal(R.SPLITTER_MIN(45), 100);
  assert.equal(R.SPLITTER_MIN(55), 200);
  const x = R.create(), a = x.approaches[0];
  a.speed = 55;
  a.median = 0;
  a.splitter = null;
  R.normalize(x);
  Object.assign(a, G.mul(G.axes(a).u, R.requiredReach(x, a)));
  const L = R.layout(x).legs.get(a.id);
  assert.equal(L.islandLength, 200, "200 ft island at 55 mph");
  assert.equal(L.sep.kind, "reverse", "AR1-TAN1-AR2 at 55 mph (Exhibit 213-2)");
  assert.deepEqual([L.sep.R1, L.sep.R2], [1400, 800]);
  assert.equal(R.separationSpacing(55), 40);
});

test("divided approaches start the island at the mouth", () => {
  const x = R.create(), a = x.approaches[0];
  a.median = 12;
  R.normalize(x);
  assert.equal(R.validate(x), "");
  assert.equal(R.layout(x).legs.get(a.id).nose, 0);
});

test("shapes: oval and peanut lay out; a folded waist is rejected", () => {
  for (const [shape, ratio] of [["oval", 1.5], ["peanut", 1.6]]) {
    const x = lanes(R.create(), 2);
    Object.assign(x.roundabout, { shape, ratio, icd: 220 });
    for (const a of x.approaches) Object.assign(a, G.mul(G.axes(a).u, R.requiredReach(x, a)));
    R.normalize(x);
    assert.equal(R.validate(x), "", shape);
    const r = R.layout(x).outer.points.map((p) => Math.hypot(p.x, p.y));
    assert.ok(Math.max(...r) / Math.min(...r) > 1.3, `${shape} is elongated`);
  }
  const x = lanes(R.create(), 2);
  Object.assign(x.roundabout, { shape: "peanut", ratio: 1.9, icd: 120 });
  for (const a of x.approaches) Object.assign(a, G.mul(G.axes(a).u, 340));
  assert.match(R.validate(x), /waist/);
});

test("more than three circulating lanes are allowed", () => {
  const x = lanes(R.create(), 3);
  x.roundabout.lanes = 5;
  for (const a of x.approaches) Object.assign(a, G.mul(G.axes(a).u, 400));
  R.normalize(x);
  assert.equal(R.laneCount(x), 5);
  assert.deepEqual(R.laneWidths(x), [15, 15, 15, 15, 15]);
  assert.equal(R.diameter(x), 270, "the two-lane starting point widened by the added lanes");
  assert.equal(R.validate(x), "");
});

test("guide paths stay in their lanes and do not stack", () => {
  const x = lanes(R.create(), 2), [a] = x.approaches, f = R.flow(x);
  const through = x.approaches.find((b) => R.turnOf(x, a, b) === "through");
  const p0 = R.path(x, a, 0, through), p1 = R.path(x, a, 1, through);
  // The inside lane circulates inside the outside lane.
  const mid = (p) => p[Math.floor(p.length / 2)];
  assert.ok(Math.hypot(mid(p0).x, mid(p0).y) < Math.hypot(mid(p1).x, mid(p1).y));
  assert.notEqual(R.spreadFor(x, f[0]), R.spreadFor(x, f[1]));
});

test("approaches too close together are rejected", () => {
  const x = lanes(R.create(), 2), a = x.approaches[1];
  a.angle = 15;
  Object.assign(a, G.mul(G.axes(a).u, 250));
  assert.match(R.validate(x), /overlap|fitted corner/);
});

test('valid Sarasota independent curves remain editable and use the first ring crossing', () => {
  const saved = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/roundabout-sarasota.json')));
  for (let i = 0; i < saved.approaches.length; i++) for (const side of ['entry', 'exit']) for (const end of ['mouth', 'circle']) {
    const x = R.normalize(structuredClone(saved)), a = x.approaches[i], before = movementMeanings(x);
    R.setApproachSideBezier(x, a, side, { x: i > 0 && side === 'entry' && end === 'circle' ? -2 : 2, y: 0 }, end);
    assert.equal(R.validate(x), '', `${i} ${side} ${end}`);
    assert.deepEqual(movementMeanings(x), before);
    const Lt = R.layout(x), L = Lt.legs.get(a.id);
    const points = [...R.outline(x), ...R.markings(x, C).lines.flatMap(l => l.points)];
    assert.ok(points.every(p => Number.isFinite(p.x) && Number.isFinite(p.y) && G.length(p) < 600));
    for (const incoming of [true, false]) {
      const off = sp => incoming ? L.entryOff(incoming ? a.incoming : 0, sp) : L.exitOff(a.outgoing, sp);
      const at = L.meet(off);
      for (let sp = 0; sp < at - 0.1; sp += 1)
        assert.ok(!Lt.outer.inside(L.P(off(sp), sp)), 'lane ends at its first circle intersection');
    }
    assert.equal(R.validate(R.normalize(JSON.parse(JSON.stringify(x)))), '');
  }
});

// FDM 213 (2025) dimensions, measured on the drawn geometry.
test("splitter nose: R 3' with 3' to each lane edge line, easing on R 200' (Exhibit 213-2 Detail A)", () => {
  const x = R.create(), a = x.approaches[0];
  a.median = 0;
  a.splitter = null;
  Object.assign(a, G.mul(G.axes(a).u, R.requiredReach(x, a)));
  const L = R.layout(x).legs.get(a.id);
  assert.ok(Math.abs(L.hIn(L.nose) + L.hOut(L.nose) - 12) < 1e-6, "lane edge lines 12 ft apart at the nose");
  assert.equal(L.curbOffset(L.nose + 3), 3);
  const ease = Math.sqrt(200 * 200 - 198.5 * 198.5);  // R 200' covering 3' -> 18"
  assert.ok(Math.abs(L.curbOffset(L.nose + 3 + ease) - 1.5) < 1e-6);
  assert.equal(L.curbOffset(L.nose + 3 + ease + 10), 1.5, "18 in with Type E curb");
  a.curb = "separator";
  R.normalize(x);
  assert.equal(R.layout(x).legs.get(a.id).curbOffset(L.nose + 60), 15 / 12, "15 in with traffic separator");
});

test("island ends 3' from the circle's lane edge line (Exhibit 213-2 Detail B)", () => {
  const x = R.create(), Lt = R.layout(x), a = x.approaches[0];
  const pts = R.splitter(Lt, a), edge = Lt.outer;
  const closest = Math.min(...pts.map((p) => Math.hypot(p.x, p.y) - edge.radius(Math.atan2(p.y, p.x))));
  assert.ok(Math.abs(closest - 3) < 0.05, `setback ${closest}`);
});

test("separation opens on AR1-tangent-AR2 at every speed (213.3.1, Exhibit 213-2)", () => {
  // Green Book Equation 3-8 with e = +2% reproduces the exhibit's AR1 column.
  for (const [mph, ar1] of [[50, 1100], [55, 1400], [60, 1800], [65, 2200]]) assert.equal(R.curveRadius(mph, 0.02), ar1);
  assert.deepEqual(R.approachCurves(60), { R1: 1800, R2: 950, T: 100 }, "the exhibit's row and TAN1 100'");
  // Below 50 mph: the same method, AR2 15 mph slower at e = -2%, 50 ft tangent.
  const low = R.approachCurves(35);
  assert.deepEqual(low, { R1: 500, R2: 200, T: 50 });   // 35^2/(15*0.20) = 408 -> 500; 20^2/(15*0.25) = 107 -> 200
  const sep = R.separation(35, 10);
  assert.equal(sep.kind, "reverse");
  assert.ok(Math.abs(sep.at(sep.length) - 10) < 1e-6);
  const high = R.separation(60, 10);
  assert.ok(high.length > 100, "includes the 100 ft TAN1");
});

test("the ICD is to the outside curbs; lane edge lines are 18 in inside (Exhibit 213-2, 213.3.6)", () => {
  const x = R.create(), Lt = R.layout(x);
  assert.ok(Math.abs(Lt.outer.radius(0.3) - (140 / 2 - 1.5)) < 1e-2);
  const pave = R.outline(x, 8 / 12);
  const far = Math.max(...pave.map((p) => Math.hypot(p.x, p.y)));
  assert.ok(far > 70, "pavement to the curb faces");
});

test("entry curbs keep R 65 ft; exit curbs are the flattest that fit, up to 400 ft (213.7.3)", () => {
  const x = R.create(), Lt = R.layout(x);
  for (const c of Lt.corners.values()) {
    assert.ok(Math.abs(c.radii.entry - 65) < 1e-6);
    assert.ok(c.radii.exit >= 65 && c.radii.exit <= 400);
  }
});

test("new single- and two-lane roundabouts meet every check", () => {
  const x = R.create();
  assert.equal(x.roundabout.apron, 15);
  assert.deepEqual(R.checks(x), []);
  const two = lanes(R.create(), 2);
  for (const b of two.approaches) Object.assign(b, G.mul(G.axes(b).u, R.requiredReach(two, b)));
  assert.deepEqual(R.checks(two), []);
  x.roundabout.apron = 0;
  assert.ok(R.checks(x).some((t) => /truck apron/.test(t)), "a cleared apron is asked for");
});

test("spiral: semicircles whose diameters differ by the inside lane's width (213.5)", () => {
  const x = lanes(R.create(), 2);
  for (const i of [1, 2, 3]) x.approaches[i].incoming = 1;
  R.normalize(x);
  const a = x.approaches[0], left = x.approaches.find((b) => R.turnOf(x, a, b) === "left");
  a.dest[a.inLanes[0]] = [left.id];
  for (const b of x.approaches) Object.assign(b, G.mul(G.axes(b).u, R.requiredReach(x, b)));
  const Lt = R.layout(x), plan = Lt.spiralPlan;
  assert.ok(plan, "spiral drawn");
  assert.equal(plan.exit, left.id, "it pushes the inside lane out at the left-turn exit");
  assert.ok(Math.abs(2 * plan.rl - (2 * plan.rs + Lt.widths[0])) < 1e-9, "larger diameter = smaller + inside lane width");
  // The marking ends where the inside lane has gone: at the lane line's radius.
  const end = plan.marking.at(-1);
  assert.ok(Math.abs(Math.hypot(end.x, end.y) - (plan.rs + Lt.widths[0])) < 1e-6);
});

test("gore channelization only at entries 30 ft wide or more (Exhibit 213-5 note 2)", () => {
  const x = lanes(R.create(), 2);
  for (const b of x.approaches) Object.assign(b, G.mul(G.axes(b).u, R.requiredReach(x, b)));
  const none = R.markings(x, C).clips.length;
  x.approaches[0].entryGore = 6;     // 12 + 6 + 12 = 30 ft
  R.normalize(x);
  assert.ok(R.markings(x, C).clips.length > none);
});

// 213.7.3's 300-400 ft "exit radius ... smoother vehicular path" cannot be a
// curb radius: across FDM's whole ICD range, four perpendicular legs leave no
// room for a 300 ft exit curb beside the R 65' entry curb. It is the
// fastest-path exit radius (213.6), so the curb is drawn as flat as fits.
test("a 300 ft exit curb never fits a perpendicular four-leg roundabout in FDM's ICD ranges", () => {
  for (const [n, icds] of [[1, [120, 130, 140, 150, 160]], [2, [160, 170, 180, 190, 200]]])
    for (const icd of icds) {
      const x = lanes(R.create(), n);
      Object.assign(x.roundabout, { icd, exitRadius: 300 });
      for (const b of x.approaches) Object.assign(b, G.mul(G.axes(b).u, R.requiredReach(x, b) + 200));
      const best = Math.max(...[...R.layout(x).corners.values()].map((c) => c.radii.exit));
      assert.ok(best < 300, `${n}-lane ICD ${icd}: exit curb ${best}`);
    }
});

test("the exit curb leaves the exit edge circle-side of the splitter nose at any diameter (Exhibit 213-2)", () => {
  for (const icd of [140, 200, 260, 320]) {
    const x = R.create();
    x.roundabout.icd = icd;
    for (const b of x.approaches) Object.assign(b, G.mul(G.axes(b).u, R.requiredReach(x, b)));
    R.normalize(x);
    const Lt = R.layout(x), ordered = G.ordered(x);
    for (const a of ordered) {
      const L = Lt.legs.get(a.id), c = Lt.corners.get(a.id);
      // The first curb point past the straight exit edge.
      const along = c.points.map((p) => G.dot(G.sub(a, p), L.u));
      const leave = along.find((s, i) => i > 0 && Math.abs(G.dot(G.sub(c.points[i], a), L.n) - L.exitOff(L.nOut, s)) > 0.05);
      assert.ok(leave >= L.nose - 2, `ICD ${icd}: exit curb leaves at ${leave?.toFixed(1)}, nose at ${L.nose.toFixed(1)}`);
    }
  }
});

test("the circulatory roadway is a lane track for custom markings", () => {
  const x = lanes(R.create(), 2), t = R.tracks(x).find((k) => k.circulatory);
  assert.ok(t, "circulatory track");
  assert.deepEqual(t.ids, ["circulatory-0", "circulatory-1"]);
  assert.ok(t.line.length > 300, "a full loop");
  const [inner, outer] = t.bounds[0];
  assert.ok(Math.abs(inner[1] - inner[0] - 15) < 1e-9 && Math.abs(outer[1] - outer[0] - 15) < 1e-9, "both circulating lanes are 15 ft");
});

test("the circulating dotted guide stays on the lane line until it turns out at the exit (Exhibits 213-3, 213-5)", () => {
  // The reported layout: a 255.5 ft circle, a two-lane entry whose inside
  // lane goes left, through and U-turn, and a two-lane exit a quarter turn on.
  const x = R.create();
  x.roundabout.spiral = "off";
  x.roundabout.icd = 255.5;
  const [east, south, west] = x.approaches;
  east.incoming = 2;
  west.outgoing = 2;
  R.normalize(x);
  east.dest[east.inLanes[0]] = [south.id, west.id, east.id];
  for (const b of x.approaches) Object.assign(b, G.mul(G.axes(b).u, R.requiredReach(x, b)));
  R.normalize(x);
  const Lt = R.layout(x), line = Lt.boundaryOff(1);
  const guides = R.markings(x, C).lines.filter((l) => l.dash && l.dash[0] === 2 && l.dash[1] === 4 && Math.abs(l.width - 0.5) < 1e-9);
  assert.ok(guides.length >= 1);
  for (const g of guides)
    for (const p of g.points) {
      const inward = Lt.outer.radius(Math.atan2(p.y, p.x)) - Math.hypot(p.x, p.y);
      assert.ok(inward <= line + 0.5, `guide point ${inward.toFixed(2)} ft in from the edge; lane line at ${line}`);
    }
});

test("automatic lanes adapt the roadway: one-lane stretches are one lane wide, the island stays round", () => {
  const x = R.create();
  x.roundabout.spiral = "off";
  const [east, south, west, north] = x.approaches;
  east.incoming = 2;
  west.outgoing = 2;
  R.normalize(x);
  east.dest[east.inLanes[0]] = [south.id, west.id, east.id];
  for (const b of x.approaches) Object.assign(b, G.mul(G.axes(b).u, R.requiredReach(x, b)));
  R.normalize(x);
  const Lt = R.layout(x), width = (a) => Lt.outer.radius(Lt.legs.get(a.id).phi) - Lt.islandEdge;
  assert.equal(Lt.C, 2);
  assert.ok(Math.abs(width(north) - 30) < 0.1, `north front needs two lanes: ${width(north)}`);
  assert.ok(Math.abs(width(south) - 15) < 0.1, `south front needs one: ${width(south)}`);
  const island = Lt.inner.points.map((p) => Math.hypot(p.x, p.y));
  assert.ok(Math.max(...island) - Math.min(...island) < 0.01, "round central island");
  assert.equal(R.validate(x), "");
});

test("exit curbs meet the circle at R 65 ft, so exit lanes keep their width", () => {
  for (const icd of [140, 300]) {
    const x = R.create();
    x.roundabout.icd = icd;
    for (const b of x.approaches) Object.assign(b, G.mul(G.axes(b).u, R.requiredReach(x, b)));
    R.normalize(x);
    for (const c of R.layout(x).corners.values()) assert.ok(Math.abs(c.radii.exit - 65) < 1e-6, `ICD ${icd}: ${c.radii.exit}`);
  }
});

test("custom marking tracks stay between the island and the adaptive outer edge", () => {
  // Reproduce wrong.json's small, skewed two-lane entry and two-lane exit.
  const x = R.create(), [east, south, west] = x.approaches;
  x.roundabout.spiral = "off";
  x.roundabout.icd = 146.5;
  east.incoming = 2;
  east.angle = 0.9;
  east.median = 24.675378595341858;
  west.outgoing = 2;
  R.normalize(x);
  east.dest[east.inLanes[0]] = [south.id, west.id, east.id];
  for (const a of x.approaches) Object.assign(a, G.mul(G.axes(a).u, R.requiredReach(x, a)));
  R.normalize(x);
  const Lt = R.layout(x), track = R.tracks(x).find((t) => t.circulatory);
  assert.ok(Lt.width, "layout adapts to lane demand");
  assert.equal(R.validate(x), "");
  for (const [i, p] of track.line.entries()) {
    const radius = Math.hypot(p.x, p.y), theta = Math.atan2(p.y, p.x);
    const edges = track.bounds[i];
    assert.ok(Math.abs(radius + edges[0][0] - Lt.islandEdge) < 0.01, "inner bound stays on the island edge");
    assert.ok(Math.abs(radius + edges.at(-1)[1] - Lt.outer.radius(theta)) < 0.01, "outer bound follows the narrowing roadway");
    if (Math.abs(Lt.width(theta) - 15) < 0.001) {
      assert.ok(Math.abs(edges[0][1] - edges[0][0] - 15) < 0.01, "the surviving lane has the full single-lane width");
      assert.ok(Math.abs(edges[1][1] - edges[1][0]) < 0.01, "no phantom second lane");
      for (let o = 0; o < Lt.C; o++)
        assert.ok(Math.abs(Lt.laneRing(o).radius(theta) - Lt.islandEdge - 7.5) < 0.01, "all movements merge into the single lane's center");
    }
  }
});

test("new roundabouts have short stems; opening a saved roundabout does not shorten it", () => {
  const x = R.create();
  for (const a of x.approaches) {
    assert.ok(G.length(a) < 125, "mouth is about 120 ft from center instead of 303 ft");
    const L = R.layout(x).legs.get(a.id);
    assert.ok(L.S0 >= 50 && L.S0 < 52);
    assert.equal(L.nose, 0, "splitter continues from the mouth");
  }
  const a = x.approaches[0];
  Object.assign(a, { x: 303, y: 0, median: 0, splitter: null });
  R.normalize(x);
  assert.equal(a.x, 303);
  assert.equal(a.median, 0);
  assert.equal(a.splitter, null);
});

test("entry gores separate only the chosen existing lanes and keep paint out of riding space", () => {
  const x = R.create(), a = x.approaches[0];
  a.incoming = 3;
  R.normalize(x);
  for (const b of x.approaches) Object.assign(b, G.mul(G.axes(b).u, R.requiredReach(x, b)));
  const laneIds = [...a.inLanes];
  a.entryGores = { [a.inLanes[1]]: 6 };
  const L = R.layout(x).legs.get(a.id);
  assert.equal(R.validate(x), "");
  assert.deepEqual(a.inLanes, laneIds);
  assert.equal(L.gore(0, 1), 0, "gore has no width at the mouth");
  assert.equal(L.gore(L.S0, 1), 6);
  assert.equal(L.gore(L.S0, 2), 0, "other boundary is unchanged");
  assert.ok(Math.abs((L.S0 - L.goreStart(1)) / 6 - 7) < 1e-9, "7:1 taper");
  const sp = L.S0, first = L.entryBounds(0, sp), second = L.entryBounds(1, sp), third = L.entryBounds(2, sp);
  assert.ok(first[1] > second[0], "the painted gap is outside both lanes");
  assert.ok(Math.abs(second[1] - third[0]) < 1e-9, "unmarked boundary stays shared");
  const paint = R.markings(x, C), gores = paint.clips.filter(c => c.lines.some(l => l.width === 1.5 && l.color === '#ffffff'));
  assert.equal(gores.length, 1, "one clipped chevron area");
  assert.equal(paint.lines.filter(l => l.width === 1 && l.dash).length, 6, "yield extension skips the painted gore");
  a.incoming = 1;
  R.normalize(x);
  assert.deepEqual(a.entryGores, {}, "removed lane drops its gore");
});

test('gore chevrons follow the local curve, with 45-degree arms and 20-foot arc spacing', () => {
  for (const shape of ['circle', 'oval', 'peanut']) for (const angle of [0, 90, 180, 270]) for (const legacy of [false, true]) {
    const x = lanes(R.create(), 2), a = x.approaches.find(a => a.angle === angle);
    Object.assign(x.roundabout, { icd: 360, shape, ratio: shape === 'circle' ? 1 : 1.2 });
    for (const b of x.approaches) Object.assign(b, G.mul(G.axes(b).u, R.requiredReach(x, b) + 80));
    const n = G.axes(a).n;
    R.setApproachBezier(x, a, 'mouth', G.mul(n, 8));
    R.setApproachBezier(x, a, 'circle', G.mul(n, -5));
    if (legacy) a.entryGore = 8; else a.entryGores = { [a.inLanes[1]]: 8 };
    assert.equal(R.validate(x), '');
    const L = R.layout(x).legs.get(a.id), middle = sp => L.P(L.entryOff(1, sp) + L.goreOffset(sp, 1) / 2, sp);
    const start = L.goreStart(1), end = L.entryMeet(sp => L.entryOff(1, sp) + L.goreOffset(sp, 1) / 2);
    // Independently measure distance along a fine centerline polyline.
    const count = Math.ceil((end - start) / 0.02), points = [], stations = [];
    let distance = 0;
    for (let i = 0; i <= count; i++) {
      const p = middle(start + (end - start) * i / count);
      if (i) distance += G.length(G.sub(p, points.at(-1)));
      points.push(p); stations.push(distance);
    }
    const chevrons = R.markings(x, C).clips.flatMap(c => c.lines).filter(l => l.width === 1.5 && l.color === '#ffffff');
    assert.ok(chevrons.length >= 2);
    for (const [j, chevron] of chevrons.entries()) {
      const [p, v, q] = chevron.points;
      let nearest = 0;
      for (let i = 1; i < points.length; i++) if (G.length(G.sub(v, points[i])) < G.length(G.sub(v, points[nearest]))) nearest = i;
      assert.ok(G.length(G.sub(v, points[nearest])) < 0.02, 'vertex lies on the curved gore centerline');
      assert.ok(Math.abs(stations[nearest] - (j + 1) * 20) < 0.025, 'spacing follows curve length');
      const sp = start + (end - start) * nearest / count, tangent = G.unit(G.sub(middle(sp + 0.001), middle(sp - 0.001)));
      const bisector = G.unit(G.sub(G.add(p, q), G.mul(v, 2)));
      assert.ok(G.dot(bisector, tangent) > 0.999999, 'each chevron turns with the local lane');
      for (const arm of [p, q]) assert.ok(Math.abs(G.dot(G.unit(G.sub(arm, v)), bisector) - Math.SQRT1_2) < 1e-8, '45-degree arm');
    }
  }
});

test('curbed entry gores follow Bézier legs without changing lane geometry or painting over the island', () => {
  for (const shape of ['circle', 'oval', 'peanut']) {
    const x = R.create(), a = x.approaches[0];
    Object.assign(x.roundabout, { icd: 360, shape, ratio: shape === 'circle' ? 1 : 1.2 });
    a.incoming = 3; R.normalize(x);
    for (const b of x.approaches) Object.assign(b, G.mul(G.axes(b).u, R.requiredReach(x, b) + 100));
    a.entryGores = { [a.inLanes[1]]: 6, [a.inLanes[2]]: 7 };
    R.setApproachBezier(x, a, 'mouth', { x: 0, y: 8 }); R.setApproachBezier(x, a, 'circle', { x: 0, y: -4 });
    const paint = R.markings(x, C), goreClips = paint.clips.filter(c => c.lines.some(l => l.width === 1.5 && l.color === '#ffffff'));
    assert.equal(goreClips.length, 2);
    const tracks = R.tracks(x).map(({ line, bounds }) => ({ line, bounds })), meanings = movementMeanings(x);
    a.entryGoreTypes = { [a.inLanes[1]]: 'curbed', [a.inLanes[2]]: 'curbed' };
    assert.equal(R.validate(x), '');
    assert.deepEqual(R.tracks(x).map(({ line, bounds }) => ({ line, bounds })), tracks, 'conversion keeps lane widths, positions and markings tracks');
    assert.deepEqual(movementMeanings(x), meanings);
    const islands = R.surfaces(x).filter(s => s.kind === 'gore');
    assert.equal(islands.length, 2);
    assert.equal(R.markings(x, C).clips.flatMap(c => c.lines).filter(l => l.width === 1.5 && l.color === '#ffffff').length, 0);
    for (const [i, island] of islands.entries()) {
      assert.equal(island.fill, 'concrete'); assert.equal(island.curb, true);
      assert.equal(island.key, a.inLanes[i + 1]);
      assert.equal(selfCrossing([...island.points, island.points[0]]), null);
      assert.ok(island.points.every(p => inside(p, goreClips[i].clip)), 'curb stays inside its own gore');
      const L = R.layout(x).legs.get(a.id);
      assert.ok(island.points.every(p => !L.yieldRing.inside(p)), 'island stays upstream of YIELD');
    }
    const restored = R.normalize(JSON.parse(JSON.stringify(x)));
    assert.deepEqual(R.surfaces(restored), R.surfaces(x));
    a.entryGores[a.inLanes[1]] = 0; R.normalize(x);
    assert.equal(a.entryGoreTypes[a.inLanes[1]], undefined, 'removing a gore clears its type');
    a.incoming = 1; R.normalize(x);
    assert.deepEqual(a.entryGoreTypes, {}, 'removing entry lanes clears stale island treatments');
    assert.equal(R.surfaces(x).filter(s => s.kind === 'gore').length, 0);
  }
});

test('a curbed entry gore needs enough room inside its lane boundaries', () => {
  const x = lanes(R.create(), 2), a = x.approaches[0];
  a.entryGores = { [a.inLanes[1]]: 2 }; a.entryGoreTypes = { [a.inLanes[1]]: 'curbed' };
  assert.match(R.validate(x), /too small for a curbed island/);
  delete a.entryGoreTypes;
  assert.equal(R.entryGoreType(a, 1), 'painted', 'legacy gores remain painted');
});

test("narrow entry gores retain their outlines without channelization chevrons", () => {
  const x = R.create(), a = x.approaches[0];
  a.incoming = 2;
  a.width = 8;
  R.normalize(x);
  for (const b of x.approaches) Object.assign(b, G.mul(G.axes(b).u, R.requiredReach(x, b)));
  a.entryGores = { [a.inLanes[1]]: 6 };
  const paint = R.markings(x, C);
  assert.equal(paint.lines.filter(l => l.color === '#ffffff' && Math.abs(l.width - 8 / 12) < 1e-9).length, 3, 'both sides and the solid end cap');
  assert.equal(paint.clips.filter(c => c.lines.some(l => l.color === '#ffffff')).length, 0, "22 ft entry is below the 30 ft chevron threshold");
});

test("adaptive entry yield lines do not reverse curvature between lanes", () => {
  // Screenshot regression: east has two entering lanes, west two exiting
  // lanes, while the other directions stay single-lane.
  for (const turn of [0, 37, 180, 315]) for (const gore of [0, 6]) {
    const x = R.create(), a = x.approaches[0];
    x.roundabout.spiral = "off";
    a.incoming = 2;
    x.approaches[2].outgoing = 2;
    R.normalize(x);
    if (gore) a.entryGores = { [a.inLanes[1]]: gore };
    for (const b of x.approaches) {
      b.angle += turn;
      Object.assign(b, G.mul(G.axes(b).u, R.requiredReach(x, b)));
    }
    const Lt = R.layout(x), L = Lt.legs.get(a.id);
    assert.ok(Lt.width, "fixture has a changing circulating width");
    const curve = L.yieldRing.arc(L.yieldStart, L.entryLeft.t, false);
    let positive = 0, negative = 0;
    for (let i = 1; i < curve.length - 1; i++) {
      const u = G.unit(G.sub(curve[i], curve[i - 1])), v = G.unit(G.sub(curve[i + 1], curve[i]));
      const cross = u.x * v.y - u.y * v.x;
      if (cross > 1e-5) positive++;
      if (cross < -1e-5) negative++;
    }
    assert.ok(positive > 0 && negative === 0, `rotation ${turn}, gore ${gore}: no S-bend (${negative} reverse turns)`);
    assert.ok(G.length(G.sub(curve[0], Lt.corners.get(x.approaches[3].id).entryQ)) < 0.02, "yield line still meets the outer curb");
    assert.ok(G.length(G.sub(curve.at(-1), Lt.outer.at(L.entryLeft.t))) < 0.02, "yield line still meets the splitter nose outline");
    const boundary = sp => L.entryOff(1, sp), stop = L.entryMeet(boundary), p = L.P(boundary(stop), stop);
    assert.ok(Math.abs(Math.hypot(p.x, p.y) - L.yieldRing.radius(Math.atan2(p.y, p.x))) < 1e-6);
    const paint = R.markings(x, C);
    assert.ok(paint.lines.some(l => l.width === (gore ? 8 / 12 : 0.5) && G.length(G.sub(l.points.at(-1), p)) < 0.01), "lane divider or gore outline ends on the yield line");
  }
});

test("dotted circulating guides continue past single-lane exits when two lanes remain", () => {
  for (const gore of [0, 6]) {
    const x = lanes(R.create(), 2), east = x.approaches[0], north = x.approaches[3];
    north.outgoing = 1;
    x.roundabout.spiral = "off"; // exercise the circular-guide branch explicitly
    R.normalize(x);
    if (gore) east.entryGores = { [east.inLanes[1]]: gore };
    for (const a of x.approaches) Object.assign(a, G.mul(G.axes(a).u, R.requiredReach(x, a)));
    const Lt = R.layout(x), A = Lt.legs.get(east.id), B = Lt.legs.get(north.id);
    assert.equal(B.nOut, 1);
    assert.equal(A.after, 2);
    assert.equal(B.front, 2);
    const ring = Lt.ring(Lt.boundaryOff(1)), start = ring.at(A.entryLeft.t), end = ring.at(B.exitLeft.t);
    const paint = R.markings(x, C), guide = paint.lines.find(l => l.width === 0.5 && l.dash?.[0] === 2 && l.dash?.[1] === 4
      && G.length(G.sub(l.points[0], start)) < 0.01 && G.length(G.sub(l.points.at(-1), end)) < 0.01);
    assert.ok(guide, `gore ${gore}: guide joins the circulating divider across the entry`);
    assert.ok(paint.lines.some(l => !l.dash && l.width === 0.5 && G.length(G.sub(l.points.at(-1), start)) < 0.01), "joins preceding solid line");
    assert.ok(paint.lines.some(l => !l.dash && l.width === 0.5 && G.length(G.sub(l.points[0], end)) < 0.01), "joins following solid line");
    for (const p of guide.points) assert.ok(Math.abs(Math.hypot(p.x, p.y) - ring.radius(Math.atan2(p.y, p.x))) < 0.02, "guide stays on the circulating lane boundary");
  }
});


test("an entry widening from one circulating lane to two does not hook the guide inward", () => {
  const x = R.create();
  x.roundabout.icd = 186.5;
  x.roundabout.spiral = "off";
  const [east, south, west, north] = x.approaches;
  east.incoming = south.incoming = 2;
  west.outgoing = 2;
  north.median = 48.68831421600832;
  R.normalize(x);
  for (const a of x.approaches) Object.assign(a, G.mul(G.axes(a).u, R.requiredReach(x, a)));
  const Lt = R.layout(x), A = Lt.legs.get(south.id);
  assert.equal(A.front, 1);
  assert.equal(A.after, 2);
  assert.ok(Lt.width);
  const radius = Lt.islandEdge + Lt.widths[0];
  const guides = R.markings(x, C).lines.filter(l => l.width === 0.5 && l.dash?.[0] === 2 && l.dash?.[1] === 4);
  assert.ok(guides.length);
  for (const guide of guides) for (const p of guide.points)
    assert.ok(Math.hypot(p.x, p.y) >= radius - 0.02, "guide cannot dip inside the circular lane divider during widening");
});

test("mixed entries choose separate receiving lanes and release a new lane at the spiral entry", () => {
  const x = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/roundabout-mixed-spiral.json"), "utf8"));
  R.normalize(x);
  const south = x.approaches[1], north = x.approaches[3];
  assert.ok(!R.destinations(x, south, south.inLanes[0]).includes(north.id));
  assert.ok(R.destinations(x, south, south.inLanes[1]).includes(north.id));
  const Lt = R.layout(x), plan = Lt.spiralPlan;
  assert.ok(plan, "default lane allocation calls for a shaped island");
  assert.equal(plan.entry, south.id);
  const end = plan.marking.at(-1);
  assert.ok(G.length(G.sub(plan.marking[0], plan.tip)) < 1e-6, "spiral guide starts at the shaped curb tip");
  const L = Lt.legs.get(south.id), divider = sp => L.entryOff(0, sp);
  const sp = L.entryMeet(divider), p = L.P(divider(sp), sp), direction = G.unit(G.sub(L.P(divider(sp + 0.01), sp + 0.01), p));
  const delta = G.sub(plan.tip, p);
  assert.ok(Math.abs(delta.x * direction.y - delta.y * direction.x) < 0.05, "curb tip aligns with the left edge of the new inside lane");
  assert.ok(delta.x * direction.x + delta.y * direction.y > 0, "tip lies ahead of entering traffic");
  const paint = R.markings(x, C);
  assert.ok(paint.lines.some(l => l.dash?.[0] === 2 && l.dash?.[1] === 4 && G.length(G.sub(l.points[0], end)) < 0.02), "ordinary guide continues from the spiral guide");
  for (const a of x.approaches) for (const [j, id] of a.inLanes.entries()) {
    for (const dest of R.destinations(x, a, id)) {
      const b = x.approaches.find(b => b.id === dest);
      for (const p of R.path(x, a, j, b))
        assert.ok(Math.hypot(p.x, p.y) - Lt.inner.radius(Math.atan2(p.y, p.x)) > 5.5, "movement centers clear the shaped apron");
    }
  }
  const track = R.tracks(x).find(t => t.circulatory), half = Lt.total / 2;
  for (const [i, p] of track.line.entries()) {
    const curb = Lt.inner.radius(Math.atan2(p.y, p.x)) - Lt.islandEdge;
    for (const [left] of track.bounds[i]) assert.ok(left + half >= curb - 0.02, "custom marking bounds exclude the apron");
  }
  south.dest[south.inLanes[0]] = [north.id];
  R.normalize(x);
  assert.deepEqual(R.destinations(x, south, south.inLanes[0]), [north.id], "explicit choices survive normalization");
  assert.ok(R.checks(x).some(message => message.includes("2 entry lanes feed approach 4's 1 exit lane")), "explicit receiving-lane conflicts are reported");
});

test("spiral entry tips align for every leg, rotation, lane width, and gore", () => {
  for (const turn of [0, 23]) for (let entry = 0; entry < 4; entry++) for (const gore of [0, 6]) for (const width of [10, 12, 14]) {
    const x = R.create(), a = x.approaches[entry];
    a.incoming = 2;
    a.width = width;
    R.normalize(x);
    if (gore) a.entryGores = { [a.inLanes[1]]: gore };
    for (const b of x.approaches) {
      b.angle += turn;
      Object.assign(b, G.mul(G.axes(b).u, R.requiredReach(x, b)));
    }
    const Lt = R.layout(x), plan = Lt.spiralPlan, L = Lt.legs.get(a.id);
    assert.ok(plan && plan.alignmentFits);
    const boundary = sp => L.entryOff(0, sp);
    const stop = L.entryMeet(boundary), mouth = L.P(boundary(stop), stop);
    const travel = G.unit(G.sub(L.P(boundary(stop + 0.01), stop + 0.01), mouth)), delta = G.sub(plan.tip, mouth);
    assert.ok(Math.abs(delta.x * travel.y - delta.y * travel.x) < 0.05, `entry ${entry}, rotation ${turn}, width ${width}, gore ${gore}: tip on inside lane left edge`);
    assert.ok(G.dot(delta, travel) > 0);
    const paint = R.markings(x, C), f = Lt.flow;
    // Downstream: the outside lane exits at the single through exit. Its
    // divider must lead into that exit's splitter boundary, not stop in space.
    let exitsChecked = 0;
    for (let i = 0; i < f.length; i++) {
      const A = Lt.legs.get(f[i].id), B = Lt.legs.get(f[(i + 1) % f.length].id);
      if (A.after !== 2 || B.front !== 1 || B.nOut !== 1) continue;
      assert.equal(exitGuides(paint.lines, B, 0).length, 1, "guide reaches the single exit boundary");
      exitsChecked++;
    }
    assert.ok(exitsChecked > 0);
    for (const b of x.approaches) for (const [j, id] of b.inLanes.entries()) for (const to of R.destinations(x, b, id)) {
      for (const p of R.path(x, b, j, x.approaches.find(c => c.id === to)))
        assert.ok(Math.hypot(p.x, p.y) > Lt.inner.radius(Math.atan2(p.y, p.x)), "movement never crosses the apron");
    }
  }
});

test("all 256 one/two-lane entry-exit combinations keep guides off the apron and construct every spiral", () => {
  for (let entries = 0; entries < 16; entries++) for (let exits = 0; exits < 16; exits++) {
    const x = R.create();
    x.approaches.forEach((a, i) => {
      a.incoming = 1 + ((entries >> i) & 1);
      a.outgoing = 1 + ((exits >> i) & 1);
    });
    R.normalize(x);
    for (const a of x.approaches) Object.assign(a, G.mul(G.axes(a).u, R.requiredReach(x, a)));
    const Lt = R.layout(x), paint = R.markings(x, null);
    for (const line of paint.lines) for (const p of line.points) {
      assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
      if (line.width === 0.5 && line.dash?.[0] === 2 && line.dash?.[1] === 4)
        assert.ok(Math.hypot(p.x, p.y) >= Lt.inner.radius(Math.atan2(p.y, p.x)) - 0.1, `configuration ${entries}/${exits}: guide outside apron`);
    }
    const sources = x.approaches.filter(a => a.incoming > 1 && a.inLanes.some(id => {
      const to = R.destinations(x, a, id);
      return to.length && to.every(id => ["left", "u"].includes(R.turnOf(x, a, x.approaches.find(b => b.id === id))));
    }));
    const required = R.spiralEntries(x);
    assert.equal(Lt.spiralPlan?.transitions.length ?? 0, required.length, "every exclusive-turn or lane-add entry receives a spiral opening");
    for (const source of required) {
      const transition = Lt.spiralPlan.transitions.find(t => t.entry === source.id);
      assert.ok(transition);
      assert.ok(G.length(G.sub(transition.marking[0], transition.tip)) < 1e-6);
      assert.ok(paint.lines.some(l => l.dash?.[1] === 4 && G.length(G.sub(l.points[0], transition.tip)) < 0.02), "each tip starts its guide");
      assert.ok(Math.abs(Lt.inner.radius(Math.atan2(transition.tip.y, transition.tip.x)) - Math.hypot(transition.tip.x, transition.tip.y)) < 0.02, "each tip is actually on the composite curb");
    }
  }
});

test("multiple spirals retain the shared lane width and narrow two lanes to one", () => {
  for (const count of [1, 2, 3, 4]) for (const width of [12, 15, 18]) {
    const x = R.create();
    x.roundabout.laneWidth = width;
    const widths = [width, width];
    x.approaches.slice(0, count).forEach(a => { a.incoming = 2; });
    R.normalize(x);
    for (const a of x.approaches) Object.assign(a, G.mul(G.axes(a).u, R.requiredReach(x, a)));
    const Lt = R.layout(x);
    assert.equal(Lt.spiralPlan.transitions.length, count);
    for (const a of x.approaches) {
      const t = Math.atan2(a.y, a.x), q = Lt.countAt(t);
      const roadWidth = normalWidth(Lt.inner, Lt.outer, t);
      assert.ok(Math.abs(roadWidth - (q === 1 ? widths[1] : widths[0] + widths[1])) < 0.05, `${count} spirals: assigned width at approach ${a.angle}`);
      const edges = Lt.laneEdges(t);
      assert.ok(Math.abs(edges.at(-1)[1] - edges[0][0] - (Lt.outer.radius(t) - Lt.inner.radius(t))) < 0.05);
      if (q === 2) {
        assert.ok(Math.abs(normalWidth(Lt.inner, Lt.dividerRing(1), t) - widths[0]) < 0.05, 'inside lane retains assigned width');
        assert.ok(Math.abs(normalWidth(Lt.dividerRing(1), Lt.outer, t) - widths[1]) < 0.05, 'outside lane retains assigned width');
      }
    }
    // Every curb tip must belong to the combined outline, not just a spare
    // per-entry guide disconnected from the drawn island.
    for (const transition of Lt.spiralPlan.transitions) {
      const t = Math.atan2(transition.tip.y, transition.tip.x);
      assert.ok(Math.abs(Lt.inner.radius(t) - Math.hypot(transition.tip.x, transition.tip.y)) < 0.02);
    }
  }
});

test("shared through lanes still get a shaped opening when the south entry adds an inside lane", () => {
  const x = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/roundabout-lane-add-spiral.json'), 'utf8'));
  R.normalize(x);
  const south = x.approaches[1], north = x.approaches[3];
  assert.ok(south.inLanes.every(id => R.destinations(x, south, id).includes(north.id)), 'both lanes can continue to the two-lane through exit');
  const Lt = R.layout(x), L = Lt.legs.get(south.id);
  assert.equal(L.front, 1); assert.equal(L.after, 2);
  assert.equal(Lt.spiralPlan.transitions.length, 1);
  const transition = Lt.spiralPlan.transitions[0];
  assert.equal(transition.entry, south.id, 'south actually adds a circulating lane');
  const theta = Math.atan2(south.y, south.x);
  assert.ok(Math.abs(Lt.outer.radius(theta) - Lt.inner.radius(theta) - 15) < 0.05, 'single circulating lane ahead of south keeps its assigned width');
  const sp = L.entryMeet(s => L.entryOff(0, s)), p = L.P(L.entryOff(0, sp), sp);
  const tangent = G.unit(G.sub(L.P(L.entryOff(0, sp + 0.01), sp + 0.01), p)), delta = G.sub(transition.tip, p);
  assert.ok(Math.abs(delta.x * tangent.y - delta.y * tangent.x) < 0.05, 'wide gore does not move the spiral over to the through/right lane');
});

test('circulating arrows and guides follow edited destinations, including removed movements', () => {
  const x = lanes(R.create(), 2), [east, south, west, north] = x.approaches;
  for (const a of x.approaches) for (const id of a.inLanes) a.dest[id] = [];
  south.dest[south.inLanes[0]] = [west.id];
  south.dest[south.inLanes[1]] = [east.id, north.id];
  assert.deepEqual(R.circulatingArrows(x, east).map(a => a.type), ['through', 'turnLeft'],
    'outside goes to the next exit; inside can only continue toward its left-turn destination');
  south.dest[south.inLanes[1]] = [east.id, west.id];
  assert.deepEqual(R.circulatingArrows(x, east).map(a => a.type), ['turnLeft', 'turnLeft'],
    'removing through and adding left updates both interior lanes');
  assert.deepEqual(R.circulatingArrows(x, north).map(a => a.type), ['through', 'through'],
    'both lanes are exit-only at their selected destination');
  const Lt = R.layout(x), L = Lt.legs.get(north.id);
  const sp = L.meet(s => L.exitOff(1, s)), exitDivider = L.P(L.exitOff(1, sp), sp);
  const guides = R.markings(x, C).lines.filter(l => l.dash?.[0] === 2 && l.dash?.[1] === 4);
  assert.ok(!guides.some(l => G.length(G.sub(l.points.at(-1), exitDivider)) < 0.05),
    'no guide directs either lane into the deselected north exit');
  south.dest[south.inLanes[1]] = [];
  assert.deepEqual(R.circulatingArrows(x, east).map(a => a.type), ['turnLeft']);
  assert.equal(R.laneCount(x), 1, 'an explicitly empty destination list adds no circulating lane');
  assert.deepEqual(south.dest[south.inLanes[1]], [], 'empty choices remain explicit');
});

test('the outside lane keeps its normal width for the full spiral opening', () => {
  for (const count of [1, 2, 3, 4]) for (const width of [12, 15, 18]) {
    const x = R.create();
    x.roundabout.laneWidth = width;
    const widths = [width, width];
    x.approaches.slice(0, count).forEach(a => { a.incoming = 2; });
    R.normalize(x);
    for (const a of x.approaches) Object.assign(a, G.mul(G.axes(a).u, R.requiredReach(x, a)));
    const Lt = R.layout(x);
    for (const transition of Lt.spiralPlan.transitions) {
      for (const p of transition.marking.slice(2, -2)) {
        const n = G.unit(G.sub(p, transition.outerConstruction.center));
        const edge = G.add(p, G.mul(n, widths[1]));
        assert.ok(Math.abs(G.length(edge) - Lt.outer.radius(Math.atan2(edge.y, edge.x))) < 0.03,
          `${count} spirals: outside lane stays ${widths[1]} ft wide while the inside lane opens`);
        const edges = Lt.laneEdges(Math.atan2(p.y, p.x));
        assert.ok(Math.abs(edges[0][1] + Lt.islandEdge - G.length(p)) < 0.02,
          'marking, movement, and placement bounds share the same divider without a second taper');
      }
    }
  }
});

test('one circulating width survives legacy imports and lane-count changes', () => {
  const x = lanes(R.create(), 2);
  x.roundabout.widths = [12, 18];
  R.normalize(x);
  assert.equal(x.roundabout.laneWidth, 15, 'legacy total width is preserved');
  for (const count of [1, 2, 3, 4, 5, 6]) {
    x.roundabout.lanes = count;
    assert.deepEqual(R.laneWidths(x), Array(count).fill(15));
  }
  x.roundabout.laneWidth = 16;
  const restored = R.normalize(JSON.parse(JSON.stringify(x)));
  assert.deepEqual(R.laneWidths(restored), Array(6).fill(16), 'shared setting takes precedence over legacy array');
});

test('R015 single-lane exit guide has no hook, in every orientation and shared width', () => {
  for (const width of [12, 15, 18]) for (const turn of [0, 90, 180, 270]) {
    const x = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/roundabout-r015-spiral.json')));
    x.roundabout.laneWidth = width;
    const t = turn * Math.PI / 180;
    for (const a of x.approaches) Object.assign(a, {
      x: a.x * Math.cos(t) - a.y * Math.sin(t), y: a.x * Math.sin(t) + a.y * Math.cos(t), angle: a.angle + turn,
    });
    R.normalize(x);
    const Lt = R.layout(x), B = Lt.legs.get(x.approaches[1].id);
    const paint = R.markings(x, null);
    const [guide] = exitGuides(paint.lines, B, 0);
    assert.ok(guide, 'guide joins the exit boundary');
    for (let i = 1; i < guide.points.length - 1; i++) {
      const before = G.unit(G.sub(guide.points[i], guide.points[i - 1]));
      const after = G.unit(G.sub(guide.points[i + 1], guide.points[i]));
      assert.ok(G.dot(before, after) > Math.cos(15 * Math.PI / 180), `no sharp reversal at ${width} ft / ${turn} degrees`);
    }
  }
});

test('exit guides become the splitter outline at the circle, without a second edge beside them', () => {
  let checked = 0;
  for (const name of ['splitter-exit-gore', 'r015-spiral', 'two-lane-exit'])
    for (const shape of ['circle', 'oval', 'peanut']) for (const width of [12, 15, 18]) {
      const x = JSON.parse(fs.readFileSync(path.join(__dirname, `fixtures/roundabout-${name}.json`)));
      Object.assign(x.roundabout, { shape, ratio: shape === 'circle' ? 1 : 1.15, laneWidth: width });
      R.normalize(x);
      const L = R.layout(x), paint = R.markings(x, null).lines;
      for (const guide of L.dividers.filter(g => g.exitBoundary === 0)) {
        const B = L.legs.get(guide.exit), full = guide.points;
        const outside = p => G.length(p) - L.outer.radius(Math.atan2(p.y, p.x));
        if (!B.twoWay || outside(full.at(-1)) <= 0) continue;
        const dotted = paint.find(l => l.dash?.[0] === 2 && l.dash[1] === 4 &&
          G.length(G.sub(l.points[0], full[0])) < 1e-6);
        assert.ok(dotted, 'circulating part of the exit guide remains dotted');
        const join = dotted.points.at(-1);
        assert.ok(Math.abs(outside(join)) < 1e-6, 'dots end exactly at the circulatory roadway edge');
        assert.ok(G.length(G.sub(join, full.at(-1))) > 0.01, 'dotted guide stops before the receiving yellow edge');
        const solid = paint.find(l => !l.dash && l.width === 0.5 && l.color === '#ffffff' &&
          l.points.some(p => G.length(G.sub(p, join)) < 1e-6));
        assert.ok(solid, 'island nose and exit guide share their exact joining point');
        for (const p of full.filter(p => outside(p) > 0.01)) {
          assert.ok(lineDistance(p, solid.points) < 1e-6, 'departing boundary is the solid splitter outline');
          assert.ok(!paint.some(l => l.dash?.[1] === 4 && lineDistance(p, l.points) < 1e-6), 'no dots run alongside the splitter');
        }
        assert.ok(paint.some(l => !l.dash && l.color === '#ffc72c' &&
          G.length(G.sub(l.points.at(-1), solid.points.at(-1))) < 1e-6), 'white outline meets the yellow edge without a gap');
        // Past the new solid join, the old splitter-side curve is inside
        // the painted island. It must not remain as a second edge line.
        for (const p of B.line(s => B.exitOff(0, s), guide.exitSp + 1, B.exitLeft.sp - 1)) {
          if (lineDistance(p, solid.points) < 0.1) continue;
          assert.ok(!paint.some(l => !l.dash && l.width === 0.5 && lineDistance(p, l.points) < 0.01), 'old edge is replaced, not duplicated');
        }
        checked++;
      }
    }
  assert.ok(checked >= 27, 'covers edited and straight approaches, single/two-lane exits, and all three shapes');
});

test('R084 and R092 keep shared widths, through lanes, and one guide per exit divider', () => {
  for (const [name, count] of [['r084', 3], ['r092', 4]]) {
    const x = JSON.parse(fs.readFileSync(path.join(__dirname, `fixtures/roundabout-${name}.json`)));
    R.normalize(x);
    assert.equal(R.validate(x), '', 'automatic diameter fits lanes and entry gores');
    assert.equal(R.spiralWanted(x), false, 'equal receiving capacity does not force left-only spirals');
    const Lt = R.layout(x), guides = R.markings(x, null).lines.filter(l => l.width === 0.5 && l.dash?.[1] === 4);
    for (let i = 0; i < 360; i++) {
      const t = i * Math.PI / 180, edges = Lt.laneEdges(t);
      for (const [lo, hi] of edges) assert.ok(Math.abs(hi - lo - 15) < 0.02, 'every circulating lane is 15 ft');
    }
    for (const a of x.approaches) {
      assert.ok(kinds(x, a, 0).includes('through'), 'inside through movement is available');
      const L = Lt.legs.get(a.id);
      for (let k = 1; k < count; k++) {
        assert.equal(exitGuides(guides, L, k).length, 1, 'one guide reaches each receiving divider');
      }
    }
    // Explicit compact dimensions remain editable, but cannot send a guide
    // backward through a nearly complete extra lap when space runs out.
    x.roundabout.icd = count === 4 ? 240 : 210;
    assert.equal(R.diameter(x), x.roundabout.icd);
    for (const line of R.markings(x, null).lines.filter(l => l.width === 0.5 && l.dash?.[1] === 4)) {
      const swept = line.points.slice(1).reduce((sum, p, i) => {
        const q = line.points[i];
        return sum + Math.abs(Math.atan2(p.x * q.y - p.y * q.x, G.dot(p, q)));
      }, 0);
      assert.ok(swept < Math.PI, 'a guide stays in its approach-to-exit sector');
    }
    const a = x.approaches[0], left = x.approaches.find(b => R.turnOf(x, a, b) === 'left');
    a.dest[a.inLanes[0]] = [left.id];
    assert.ok(R.spiralEntries(x).includes(a), 'explicit left-only movement still requests a spiral');
  }
});

test('entrance and exit curves bend independently without moving their mouths or changing lane widths', () => {
  for (const angle of [0, 90, 180, 270]) for (const incoming of [true, false]) for (const pull of [0.5, 5]) {
    const x = R.create(), a = x.approaches.find(a => a.angle === angle), original = structuredClone(a);
    const h = R.approachCurveHandle(x, a, incoming), key = incoming ? 'ar3' : 'exitCurve';
    const delta = G.mul(h.n, pull), radius = R.approachCurveRadius(x, a, incoming, delta);
    assert.ok(radius < a[key], 'pulling outward increases the bend');
    a[key] = radius;
    const next = R.approachCurveHandle(x, a, incoming);
    assert.ok(Math.abs(G.dot(G.sub(next.p, h.p), h.n) - pull) < 0.06, 'curve follows small and large drags without reversing');
    assert.deepEqual([a.x, a.y, a.angle, a.width, a.outWidth], [original.x, original.y, original.angle, original.width, original.outWidth]);
    assert.equal(a[incoming ? 'exitCurve' : 'ar3'], original[incoming ? 'exitCurve' : 'ar3']);
    assert.equal(R.validate(x), '');
  }
  const x = R.create(), a = x.approaches[0], L = R.layout(x).legs.get(a.id);
  assert.equal(a.exitCurve, 300, 'default uses the lower end of the 213.7.3 range');
  assert.ok(L.hOut(L.S0) - L.hOut(0) > 4, 'short default stem still has a visible outward exit sweep');
});

const selfCrossing = points => {
  for (let i = 1; i < points.length; i++) for (let j = i + 2; j < points.length; j++) {
    const a = points[i - 1], c = points[j - 1];
    const u = G.sub(points[i], a), v = G.sub(points[j], c), w = G.sub(c, a);
    const cross = (p, q) => p.x * q.y - p.y * q.x, den = cross(u, v);
    if (Math.abs(den) < 1e-9) continue;
    const t = cross(w, v) / den, s = cross(w, u) / den;
    if (t > 1e-5 && t < 1 - 1e-5 && s > 1e-5 && s < 1 - 1e-5) return [i, j];
  }
  return null;
};
const angularTravel = points => points.slice(1).reduce((sum, p, i) => {
  const q = points[i];
  return sum + Math.abs(Math.atan2(p.x * q.y - p.y * q.x, G.dot(p, q)));
}, 0);

test('offset spiral entries join their lane without loops, including trimmed previews and U-turns', () => {
  for (const rotation of [0, 37, 90, 183]) {
    const x = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/roundabout-movement-loop.json')));
    const t = rotation * Math.PI / 180;
    for (const a of x.approaches) Object.assign(a, {
      x: a.x * Math.cos(t) - a.y * Math.sin(t), y: a.x * Math.sin(t) + a.y * Math.cos(t), angle: a.angle + rotation,
    });
    R.normalize(x);
    const Lt = R.layout(x);
    for (const a of x.approaches) for (const [j, id] of a.inLanes.entries()) for (const exit of R.destinations(x, a, id)) {
      const b = x.approaches.find(b => b.id === exit);
      for (const trim of [0, 20]) for (const spread of [0, R.spreadFor(x, a)]) {
        const points = R.path(x, a, j, b, spread, {
          from: R.handle(x, a, true, j).sp + trim, to: R.handle(x, b, false, 0).sp + trim,
        });
        assert.equal(selfCrossing(points), null, 'entry join and route never intersect themselves');
        assert.ok(angularTravel(points) < 2 * Math.PI + 0.1, 'a movement never makes an extra lap');
        for (const p of points) assert.ok(G.length(p) > Lt.inner.radius(Math.atan2(p.y, p.x)), 'loop correction stays outside the apron');
      }
    }
  }
});

test('U-turn guides take one circuit on single- through four-lane roundabouts', () => {
  for (const count of [1, 2, 3, 4]) {
    const x = lanes(R.create(), count);
    for (const a of x.approaches) Object.assign(a, G.mul(G.axes(a).u, R.requiredReach(x, a)));
    for (const a of x.approaches) {
      const points = R.path(x, a, 0, a), sweep = angularTravel(points);
      assert.ok(sweep > Math.PI && sweep < 2 * Math.PI + 0.1, 'single circuit returns to the same approach');
      assert.equal(selfCrossing(points), null);
    }
  }
});

test('whole approach Bézier controls keep mouths tangent, widths constant, and movement meanings stable', () => {
  for (const shape of ['circle', 'oval', 'peanut']) for (const angle of [0, 90, 180, 270]) {
    const x = lanes(R.create(), 1 + angle / 90);
    Object.assign(x.roundabout, { icd: 400, shape, ratio: shape === 'circle' ? 1 : 1.2 });
    for (const b of x.approaches) Object.assign(b, G.mul(G.axes(b).u, R.requiredReach(x, b) + 100));
    const a = x.approaches.find(b => b.angle === angle), original = structuredClone(a);
    const meanings = movementMeanings(x), before = R.layout(x).legs.get(a.id), tip = before.P(0, before.S0);
    const { n } = G.axes(a);
    R.setApproachBezier(x, a, 'mouth', G.mul(n, 10));
    R.setApproachBezier(x, a, 'circle', G.mul(n, -6));
    assert.equal(R.validate(x), '', `${shape} ${angle}`);
    const L = R.layout(x).legs.get(a.id);
    assert.deepEqual({ x: a.x, y: a.y }, { x: original.x, y: original.y }, 'control pulls leave the connection in place');
    assert.ok(G.length(G.sub(L.P(0, L.S0), tip)) < 1e-8, 'circle anchor stays in place');
    assert.deepEqual(movementMeanings(x), meanings);
    assert.ok(Math.abs(a.angle - original.angle) > 1, 'connection tangent changes with its handle');
    const outward = G.unit(G.sub(L.P(0, 0), L.P(0, 0.0001)));
    assert.ok(G.dot(outward, G.axes(a).u) > 0.999999, 'connected road uses the cubic tangent');
    for (const incoming of [true, false]) {
      const off = incoming ? 'entryOff' : 'exitOff';
      assert.ok(G.length(G.sub(L.P(L[off](a[incoming ? 'incoming' : 'outgoing'], 0), 0), G.edge(a, incoming))) < 1e-7, 'mouth cross section matches its lane nodes');
      for (const f of [0.1, 0.3, 0.5]) {
        const sp = L.S0 * f, left = L.P(L[off](0, sp), sp), right = L.P(L[off](1, sp), sp);
        const tangent = G.unit(G.sub(L.P(L[off](0, sp + 0.001), sp + 0.001), L.P(L[off](0, sp - 0.001), sp - 0.001)));
        assert.ok(Math.abs(Math.abs(G.dot(G.sub(right, left), { x: -tangent.y, y: tangent.x })) - 12) < 0.02, 'normal lane width stays 12 feet');
      }
      assert.equal(selfCrossing(L.line(sp => L[off](a[incoming ? 'incoming' : 'outgoing'], sp))), null);
    }
    const h = R.approachBezierHandles(x, a);
    assert.ok(G.length(G.sub(h.mouth.p, h.mouth.from)) > 10);
    assert.ok(R.markings(x).lines.every(mark => mark.points.every(p => Number.isFinite(p.x) && Number.isFinite(p.y))));
    const restored = R.normalize(JSON.parse(JSON.stringify(x)));
    assert.deepEqual(R.approachBezierHandles(restored, restored.approaches.find(b => b.id === a.id)), h);
    R.setApproachBend(a, 3);
    const moved = R.layout(x).legs.get(a.id);
    assert.ok(G.length(G.sub(moved.P(0, moved.S0), tip)) < 1e-8, 'whole handle still moves only the connected end');
    assert.equal(a.bezier.mouth.offset, 10, 'whole leg drag preserves its control vectors');
    R.straightenApproach(a);
    assert.equal(a.bezier, undefined); assert.equal(a.bend, 0);
    assert.ok(G.length(G.sub(a, original)) < 1e-8);
    assert.equal(a.angle, original.angle);
  }
});

test('whole approach Bézier controls reject lane folds and invalid input', () => {
  const x = R.create(), a = x.approaches[0];
  R.setApproachBezier(x, a, 'mouth', { x: 0, y: 100 });
  assert.match(R.validate(x), /folds a lane edge/);
  a.bezier.mouth.pull = NaN;
  assert.match(R.validate(x), /curve dimensions/);
});

test('saved sharp Bézier approach keeps smooth curbs and does not shortcut its reverse bend', () => {
  const x = R.normalize(JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/roundabout-extreme-bezier.json'))));
  assert.equal(R.validate(x), '');
  const Lt = R.layout(x), a = x.approaches[1], L = Lt.legs.get(a.id);
  for (const c of Lt.corners.values()) for (let i = 1; i < c.points.length - 1; i++) {
    const before = G.unit(G.sub(c.points[i], c.points[i - 1])), after = G.unit(G.sub(c.points[i + 1], c.points[i]));
    assert.ok(G.dot(before, after) > Math.cos(8 * Math.PI / 180), 'no short spur at either fillet join');
  }
  const entry = Lt.corners.get(x.approaches[0].id);
  assert.ok(entry.entrySp > 50, 'outside curb follows the saved reverse bend instead of leaving it halfway through');
  for (const off of ['entryOff', 'exitOff']) {
    const at = sp => L.P(L[off](1, sp), sp);
    assert.ok(G.length(G.sub(at(L.S0 + 0.0001), at(L.S0 - 0.0001))) < 0.001, 'flared lane stays continuous beyond the cubic endpoint');
  }
});

test('YIELD words center between visible lane boundaries on straight, sharp, and one-way entries', () => {
  const rectangle = { build: spec => ({ length: 8, parts: spec.type === 'word'
    ? [{ fill: '#ffffff', rings: [[[-2, 0], [2, 0], [2, 8], [-2, 8]]] }] : [] }) };
  const ray = (p, n, points) => {
    let best = Infinity;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], v = G.sub(points[i], a), d = G.sub(a, p), den = n.x * v.y - n.y * v.x;
      if (Math.abs(den) < 1e-10) continue;
      const t = (d.x * v.y - d.y * v.x) / den, f = (d.x * n.y - d.y * n.x) / den;
      if (t >= 0 && f >= 0 && f <= 1) best = Math.min(best, t);
    }
    return best;
  };
  for (const oneWay of [false, true]) {
    const x = R.normalize(JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/roundabout-extreme-bezier.json'))));
    if (oneWay) { x.approaches[2].outgoing = 0; R.normalize(x); }
    const Lt = R.layout(x), marks = R.markings(x, rectangle), pavement = R.outline(x, 8 / 12);
    assert.equal(marks.symbols.length, 4);
    marks.symbols.forEach((symbol, i) => {
      const L = Lt.legs.get(x.approaches[i].id), points = symbol.rings[0];
      const p = G.mul(points.reduce(G.add, { x: 0, y: 0 }), 0.25), right = G.unit(G.sub(points[1], points[0]));
      const inner = L.entryInnerCurb ?? L.line(sp => L.entryBounds(0, sp)[0], 0, L.entryLeft.sp);
      const leftDistance = ray(p, G.mul(right, -1), inner), rightDistance = ray(p, right, L.entryCurb);
      assert.ok(Number.isFinite(leftDistance + rightDistance));
      assert.ok(Math.abs(leftDistance - rightDistance) < 0.001, 'word is centered across the actual lane');
      assert.ok(points.every(q => inside(q, pavement) && !L.yieldRing.inside(q)), 'word stays on pavement behind the dotted yield line');
    });
    if (oneWay) {
      const a = x.approaches[2], L = Lt.legs.get(a.id), end = L.yieldRing.at(L.yieldEnd);
      assert.ok(G.length(G.sub(end, Lt.corners.get(a.id).exitQ)) < 0.001, 'one-way yield line ends at the actual left curb');
      const nominal = L.line(sp => L.entryOff(0, sp), 0, L.entryLeft.sp);
      assert.ok(!marks.lines.some(mark => mark.color === '#ffc72c' && mark.points.length === nominal.length
        && G.length(G.sub(mark.points.at(-1), nominal.at(-1))) < 0.001), 'no extra yellow line forks into the one-way entry');
    }
  }
});

test('independent entry and exit Bézier controls preserve the other side, connections, and movement meanings', () => {
  for (const shape of ['circle', 'oval', 'peanut']) for (const count of [1, 2, 3, 4]) {
    const x = lanes(R.create(), count);
    Object.assign(x.roundabout, { icd: 400, shape, ratio: shape === 'circle' ? 1 : 1.2 });
    for (const b of x.approaches) Object.assign(b, G.mul(G.axes(b).u, R.requiredReach(x, b) + 100));
    const a = x.approaches[count - 1], meanings = movementMeanings(x), original = structuredClone(a);
    for (const side of ['entry', 'exit']) {
      const before = R.layout(x).legs.get(a.id), otherOff = side === 'entry' ? 'exitOff' : 'entryOff';
      const other = before.line(sp => before[otherOff](count, sp)), h = R.approachSideBezierHandle(x, a, side);
      const delta = G.mul(R.approachAxes(a).n, side === 'entry' ? -4 : 4);
      R.setApproachSideBezier(x, a, side, delta);
      assert.equal(R.validate(x), '', `${shape}, ${count} lanes, ${side}`);
      const after = R.layout(x).legs.get(a.id), moved = R.approachSideBezierHandle(x, a, side);
      assert.deepEqual(after.line(sp => after[otherOff](count, sp)), other, 'opposite carriageway is unchanged');
      assert.ok(G.length(G.sub(G.sub(moved.p, h.p), delta)) < 1e-6, 'handle follows the pointer');
      assert.deepEqual(movementMeanings(x), meanings);
      assert.deepEqual([a.x, a.y, a.angle], [original.x, original.y, original.angle], 'connected mouth stays in place and tangent');
      const off = side === 'entry' ? 'entryOff' : 'exitOff';
      assert.notDeepEqual(after.line(sp => after[off](count, sp)), before.line(sp => before[off](count, sp)));
      assert.ok(G.length(G.sub(after.P(after[off](count, 0), 0), G.edge(a, side === 'entry'))) < 1e-6);
      const track = R.tracks(x).find(track => track.approach.id === a.id && track.incoming === (side === 'entry'));
      const points = side === 'entry' ? track.line : [...track.line].reverse();
      const end = side === 'entry' ? after.entryLeft.sp : after.exitLeft.sp;
      assert.ok(points.every((p, i) => G.length(G.sub(p, after.reference(side === 'entry', end * i / (points.length - 1)))) < 1e-6),
        'custom markings follow the independently curved carriageway');
      assert.ok(R.markings(x).lines.every(mark => mark.points.every(p => Number.isFinite(p.x + p.y))));
    }
    const restored = R.normalize(JSON.parse(JSON.stringify(x)));
    assert.deepEqual(R.outline(restored), R.outline(x), 'both curves survive saving and loading');
    R.straightenApproach(a); assert.equal(a.bezierSides, undefined);
  }
});

test('both ends of each carriageway curve independently about a fixed road connection', () => {
  for (const shape of ['circle', 'oval', 'peanut']) for (const count of [1, 2, 3, 4]) for (const oneWay of [false, true]) {
    const x = lanes(R.create(), count);
    Object.assign(x.roundabout, { icd: 400, shape, ratio: shape === 'circle' ? 1 : 1.2 });
    const a = x.approaches[count - 1];
    if (oneWay) a[count % 2 ? 'incoming' : 'outgoing'] = 0;
    R.normalize(x);
    for (const b of x.approaches) Object.assign(b, G.mul(G.axes(b).u, R.requiredReach(x, b) + 100));
    const meanings = movementMeanings(x), initialAngle = a.angle;
    for (const side of ['entry', 'exit']) {
      const incoming = side === 'entry'; if (!a[incoming ? 'incoming' : 'outgoing']) continue;
      const before = R.layout(x).legs.get(a.id), other = incoming ? 'exitOff' : 'entryOff';
      const otherLine = before.line(sp => before[other](count, sp));
      const controls = R.approachSideBezierHandles(x, a, side), delta = G.mul(R.approachAxes(a).n, incoming ? -8 : 8);
      R.setApproachSideBezier(x, a, side, delta, 'mouth');
      assert.equal(R.validate(x), '', `${shape}/${count}/${side}/${oneWay}`);
      const edited = R.layout(x).legs.get(a.id), handles = R.approachSideBezierHandles(x, a, side);
      assert.ok(G.length(G.sub(handles.mouth.from, controls.mouth.from)) < 1e-8, 'carriageway pivots about its road connection center');
      assert.ok(G.length(G.sub(handles.mouth.p, G.add(controls.mouth.p, delta))) < 1e-8, 'road-end control follows the pointer');
      for (const key of ['from', 'p']) assert.ok(G.length(G.sub(handles.circle[key], controls.circle[key])) < 1e-8, 'other control on this side stays put');
      if (!oneWay) assert.deepEqual(edited.line(sp => edited[other](count, sp)), otherLine, 'opposite carriageway stays unchanged');
      for (let j = 0; j < count; j++) {
        const lane = R.approachLane(x, a, incoming, j), off = incoming ? edited.entryBounds(j, 0) : [edited.exitOff(j, 0), edited.exitOff(j + 1, 0)];
        const edge = off.map(d => edited.P(d, 0));
        assert.ok(Math.abs(G.length(G.sub(edge[1], edge[0])) - G.width(a, incoming, j)) < .001, 'lane mouth keeps its width');
        assert.ok(Math.abs(G.dot(G.sub(edge[1], edge[0]), lane.u)) < 1e-6, 'road meets its lane squarely');
        const tangent = G.unit(G.sub(lane.p, edited.P((off[0] + off[1]) / 2, .0001)));
        assert.ok(G.dot(tangent, lane.u) > .999999, 'connection uses the actual tangent');
      }
      const mouth = structuredClone(a.bezierSides[side].mouth);
      R.setApproachSideBezier(x, a, side, G.mul(delta, -.25));
      assert.deepEqual(a.bezierSides[side].mouth, mouth, 'editing the circle end retains the road-end curve');
      assert.equal(R.validate(x), '');
      assert.equal(a.angle, initialAngle, 'side edits do not rotate the whole approach');
      assert.deepEqual(movementMeanings(x), meanings);
    }
    const restored = R.normalize(JSON.parse(JSON.stringify(x)));
    assert.deepEqual(R.outline(restored), R.outline(x), 'all independent controls survive JSON');
    a.bezierSides[Object.keys(a.bezierSides)[0]].mouth.offset = NaN;
    assert.match(R.validate(x), /curve dimensions/);
  }
});

test('median corners move their own lanes and retain independent endpoints, widths and movement meanings', () => {
  for (const shape of ['circle', 'oval', 'peanut']) for (const count of [1, 2, 4]) {
    const x = lanes(R.create(), count);
    Object.assign(x.roundabout, { icd: 400, shape, ratio: shape === 'circle' ? 1 : 1.2 });
    for (const b of x.approaches) Object.assign(b, G.mul(G.axes(b).u, R.requiredReach(x, b) + 100));
    const a = x.approaches[count - 1], meanings = movementMeanings(x), { u, n } = R.approachAxes(a);
    for (const side of ['entry', 'exit']) {
      const incoming = side === 'entry', old = R.splitterCorners(x, a), other = incoming ? 'exit' : 'entry';
      const delta = G.add(G.mul(u, 12), G.mul(n, incoming ? -6 : 6));
      R.setSplitterCorner(x, a, side, 'mouth', delta);
      let moved = R.splitterCorners(x, a);
      assert.ok(G.length(G.sub(moved[side].mouth, G.add(old[side].mouth, delta))) < 1e-6, 'connection corner follows the pointer in both axes');
      assert.ok(G.length(G.sub(moved[side].circle, old[side].circle)) < 1e-3, 'connection edit holds the circle corner');
      assert.deepEqual(moved[other], old[other], 'opposite side stays fixed');
      const mouth = moved[side].mouth;
      R.setSplitterCorner(x, a, side, 'circle', G.mul(n, incoming ? -4 : 4));
      moved = R.splitterCorners(x, a);
      assert.ok(G.length(G.sub(moved[side].circle, old[side].circle)) > 2, 'circle corner moves along the roundabout');
      assert.ok(G.length(G.sub(moved[side].mouth, mouth)) < 1e-8, 'circle edit holds the road connection');
      const circle = moved[side].circle, handle = R.approachSideBezierHandles(x, a, side).circle;
      const pull = G.add(G.mul(u, 1), G.mul(n, incoming ? -2 : 2));
      R.setApproachSideBezier(x, a, side, pull);
      assert.ok(G.length(G.sub(R.approachSideBezierHandles(x, a, side).circle.p, G.add(handle.p, pull))) < 1e-5, 'Bézier control still follows the pointer after corner edits');
      assert.ok(G.length(G.sub(R.splitterCorners(x, a)[side].circle, circle)) < 1e-3, 'Bézier pull retains the pinned corner');
      assert.equal(R.validate(x), '', `${shape}/${count}/${side}`);
      const L = R.layout(x).legs.get(a.id), off = incoming ? 'entryOff' : 'exitOff';
      for (let j = 0; j < count; j++) for (const sp of [0, L.S0 / 3, L.S0 * .8]) {
        const left = L.P(L[off](j, sp), sp), right = L.P(L[off](j + 1, sp), sp);
        const t = G.unit(G.sub(L.P(L[off](0, sp + .001), sp + .001), L.P(L[off](0, sp - .001), sp - .001)));
        assert.ok(Math.abs(Math.abs(G.dot(G.sub(right, left), { x: -t.y, y: t.x })) - 12) < .02, 'adjacent lanes keep their perpendicular width');
      }
      assert.deepEqual(movementMeanings(x), meanings);
    }
    const restored = R.normalize(JSON.parse(JSON.stringify(x)));
    assert.deepEqual(R.outline(restored), R.outline(x), 'corner anchors survive JSON');
    assert.deepEqual(R.splitterCorners(restored, restored.approaches[count - 1]), R.splitterCorners(x, a));
    const corners = R.splitterCorners(x, a), angle = 37 * Math.PI / 180;
    for (const b of x.approaches) {
      const p = { x: b.x * Math.cos(angle) - b.y * Math.sin(angle), y: b.x * Math.sin(angle) + b.y * Math.cos(angle) };
      Object.assign(b, p, { angle: b.angle + 37 }); if (b.bezier) b.bezier.axis += 37;
    }
    x.roundabout.turn += 37;
    const rotated = R.splitterCorners(x, a);
    for (const side of ['entry', 'exit']) for (const end of ['mouth', 'circle']) {
      const p = corners[side][end], expected = { x: p.x * Math.cos(angle) - p.y * Math.sin(angle), y: p.x * Math.sin(angle) + p.y * Math.cos(angle) };
      assert.ok(G.length(G.sub(rotated[side][end], expected)) < .01, 'rotation carries every corner');
    }
  }
});

test('gore size handles follow curved entries, preserve lanes and persist both treatments', () => {
  for (const type of ['painted', 'curbed']) for (const shape of ['circle', 'oval', 'peanut']) {
    const x = lanes(R.create(), 3), a = x.approaches[1];
    Object.assign(x.roundabout, { icd: 400, shape, ratio: shape === 'circle' ? 1 : 1.2 });
    for (const b of x.approaches) Object.assign(b, G.mul(G.axes(b).u, R.requiredReach(x, b) + 100));
    R.setApproachBezier(x, a, 'mouth', { x: 12, y: 0 });
    a.entryGores = { [a.inLanes[1]]: 6 }; a.entryGoreTypes = { [a.inLanes[1]]: type };
    const meanings = movementMeanings(x), before = R.entryGoreHandles(x, a, 1), L = R.layout(x).legs.get(a.id);
    R.resizeEntryGore(x, a, 1, 'width', G.mul(L.normal(before.sp, -1), -2));
    assert.ok(R.entryGoreWidth(a, 1) > 6, 'width square widens the gore');
    const width = R.entryGoreWidth(a, 1), current = R.entryGoreHandles(x, a, 1);
    const inner = sp => L.P(L.entryOff(1, sp) + L.goreOffset(sp, 1), sp);
    const target = inner(current.start - 18);
    R.resizeEntryGore(x, a, 1, 'tip', G.sub(target, current.tip));
    const after = R.entryGoreHandles(x, a, 1);
    assert.ok(G.length(G.sub(after.tip, target)) < .05, 'tip follows the curved lane boundary');
    assert.ok(after.start < current.start - 15, 'dragging upstream lengthens the gore');
    assert.equal(R.entryGoreWidth(a, 1), width, 'length edits retain width');
    assert.equal(R.entryGoreType(a, 1), type);
    assert.deepEqual(movementMeanings(x), meanings);
    assert.equal(R.validate(x), '');
    const restored = R.normalize(JSON.parse(JSON.stringify(x)));
    assert.deepEqual(R.markings(restored), R.markings(x));
    assert.deepEqual(R.surfaces(restored), R.surfaces(x));
    a.entryGores[a.inLanes[1]] = 0; R.normalize(x);
    assert.equal(a.entryGoreLengths[a.inLanes[1]], undefined, 'removing a gore clears its length');
  }
});

test('whole approach handle moves the connected mouth while preserving the circle end and lane widths', () => {
  for (const angle of [0, 90, 180, 270]) for (const bend of [-4, 4]) {
    const x = R.create(), a = x.approaches.find(a => a.angle === angle);
    const before = R.layout(structuredClone(x)).legs.get(a.id), h = R.approachBendHandle(x, a);
    R.setApproachBend(a, bend);
    const after = R.layout(x).legs.get(a.id), moved = R.approachBendHandle(x, a), sp = after.S0 / 2;
    assert.equal(R.validate(x), '');
    assert.deepEqual(moved.p, { x: a.x, y: a.y }, 'handle sits at the moving road connection');
    assert.ok(Math.abs(G.dot(G.sub(moved.p, h.p), h.n) - bend) < 1e-6, 'connection follows the entire sideways drag');
    assert.ok(G.length(G.sub(after.P(0, after.S0), before.P(0, before.S0))) < 1e-8, 'circle end stays anchored');
    assert.ok(Math.abs(G.dot(G.sub(after.P(0, sp), before.P(0, sp)), h.n) - bend / 2) < 1e-6, 'middle smoothly transitions between connection and circle');
    for (const incoming of [true, false]) {
      const off = incoming ? 'entryOff' : 'exitOff';
      for (const k of [0, 1]) assert.ok(G.length(G.sub(after.P(after[off](k, 0), 0), G.add(before.P(before[off](k, 0), 0), G.mul(h.n, bend)))) < 1e-8, 'all lane mouths move together');
      // Measure square to each lane boundary, including the exit's own flare.
      for (const s of [sp / 3, sp / 2]) {
        const left = after.P(after[off](0, s), s), right = after.P(after[off](1, s), s);
        const tangent = G.unit(G.sub(after.P(after[off](0, s + 0.001), s + 0.001), after.P(after[off](0, s - 0.001), s - 0.001)));
        const width = Math.abs(G.dot(G.sub(right, left), { x: -tangent.y, y: tangent.x }));
        assert.ok(Math.abs(width - 12) < 0.01, 'no shearing of the cross section');
      }
      const line = after.line(s => after[off](1, s));
      assert.equal(selfCrossing(line), null);
      assert.notDeepEqual(line, before.line(s => before[off](1, s)), 'both carriageways follow the shared centerline');
      const curve = R.approachCurveHandle(x, a, incoming);
      const radius = R.approachCurveRadius(x, a, incoming, G.mul(curve.n, 0.5));
      a[incoming ? 'ar3' : 'exitCurve'] = radius;
      assert.equal(a.bend, bend, 'individual curve controls preserve whole approach bend');
    }
    assert.ok(R.splitter(R.layout(x), a).every(p => Number.isFinite(p.x) && Number.isFinite(p.y)));
    const restored = R.normalize(JSON.parse(JSON.stringify(x)));
    assert.equal(restored.approaches.find(b => b.id === a.id).bend, bend, 'bend survives save/load');
  }
  const x = R.create(); R.setApproachBend(x.approaches[0], 40);
  assert.match(R.validate(x), /folds a lane edge/);
  for (const incoming of [true, false]) {
    const oneWay = R.create(), a = oneWay.approaches[0];
    Object.assign(a, { incoming: incoming ? 1 : 0, outgoing: incoming ? 0 : 1, median: 0 });
    R.normalize(oneWay);
    const h = R.approachBendHandle(oneWay, a);
    for (const side of [true, false]) assert.ok(G.length(G.sub(h.p, G.edge(a, side))) > 5, 'one-way handle does not cover an outer-edge handle');
    assert.ok(Math.abs(G.dot(G.sub(h.p, a), G.axes(a).u)) < 1e-8, 'one-way handle stays on the connection cross section');
  }
});

test('mini-roundabouts fit 45–90 ft diameters with a traversable center and no raised grass island', () => {
  for (const diameter of [45, 60, 90]) {
    const x = R.create(); Object.assign(x.roundabout, { mini: true, icd: diameter, laneWidth: 12 });
    for (const a of x.approaches) { a.median = 0; Object.assign(a, G.mul(G.axes(a).u, R.requiredReach(x, a))); }
    assert.equal(R.validate(x), '');
    assert.deepEqual(R.checks(x), []);
    const surfaces = R.surfaces(x);
    assert.equal(surfaces.length, 1, 'no forced raised splitters on undivided mini approaches');
    assert.equal(surfaces[0].fill, 'concrete');
    assert.equal(surfaces[0].mountable, true);
    assert.ok(Math.abs(G.length(surfaces[0].points[0]) - (diameter / 2 - R.CURB.E - 12)) < 0.01);
    for (const line of R.markings(x, C).lines) assert.ok(line.points.every(p => Number.isFinite(p.x) && Number.isFinite(p.y)));
    for (const a of x.approaches) for (const b of x.approaches) assert.equal(selfCrossing(R.path(x, a, 0, b)), null);
    const restored = R.normalize(JSON.parse(JSON.stringify(x)));
    assert.equal(restored.roundabout.mini, true);
    assert.equal(R.diameter(restored), diameter);
    x.roundabout.icd = 45;
    x.roundabout.laneWidth = 30;
    assert.match(R.validate(x), /central island/);
  }
  const x = R.create(); x.roundabout.mini = true;
  assert.equal(R.diameter(x), 90, 'automatic mini size keeps existing divided approaches');
  assert.equal(R.validate(x), '');
  assert.ok(R.surfaces(x).every(s => s.mountable && s.fill === 'concrete'));
  assert.equal(x.roundabout.apron, 15, 'regular apron setting is retained');
  x.roundabout.mini = false;
  assert.equal(R.diameter(x), 140);
  assert.ok(R.surfaces(x).some(s => s.kind === 'island' && s.fill === 'grass'));
  x.roundabout.mini = true; x.approaches[0].incoming = 2;
  assert.match(R.validate(x), /at most one entry/);
});

const maxPathTurn = points => Math.max(0, ...points.slice(1, -1).map((p, i) => {
  const before = G.unit(G.sub(p, points[i])), after = G.unit(G.sub(points[i + 2], p));
  return Math.acos(Math.max(-1, Math.min(1, G.dot(before, after)))) * 180 / Math.PI;
}));

test('one-way connections retain their carriageway through the stem before rounding into the circle', () => {
  for (const incoming of [true, false]) for (const count of [1, 2, 3, 4]) {
    const x = R.create(); x.roundabout.icd = 360;
    const a = x.approaches[0]; a.incoming = incoming ? count : 0; a.outgoing = incoming ? 0 : count;
    R.normalize(x);
    for (const b of x.approaches) Object.assign(b, G.mul(G.axes(b).u, R.requiredReach(x, b) + 60));
    assert.equal(R.validate(x), '');
    const L = R.layout(x), A = L.legs.get(a.id), width = [...A.inWidths, ...A.outWidths].reduce((sum, w) => sum + w, 0);
    const left = L.corners.get(a.id), right = L.corners.get(x.approaches.at(-1).id);
    assert.ok(left.ok && right.ok, 'both sides have a rounded connection');
    assert.ok(left.exitSp >= (incoming ? A.entryLeft.sp : A.exitRight.sp) - width - .001, 'left curb keeps the stem narrow');
    assert.ok(right.entrySp >= (incoming ? A.entryRight.sp : A.exitLeft.sp) - width - .001, 'right curb keeps the stem narrow');
    const leftAt = sp => A.P(incoming ? A.entryOff(0, sp) : A.exitOff(count, sp), sp);
    const rightAt = sp => A.P(incoming ? A.entryOff(count, sp) : A.exitOff(0, sp), sp);
    for (const f of [.1, .3, .6]) {
      const sp = Math.min(left.exitSp, right.entrySp) * f;
      assert.ok(lineDistance(leftAt(sp), left.exitBoundary) < .015, 'left curb follows the remaining carriageway');
      assert.ok(lineDistance(rightAt(sp), right.entryBoundary) < .015, 'right curb follows the remaining carriageway');
    }
  }
});

test('saved one-way exit and curved entries keep movement paths on continuing lanes across later entries', () => {
  for (const width of [14, 15, 18]) for (const rotation of [0, 37, 90, 183]) {
    const x = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/roundabout-oneway-exit-paths.json')));
    x.roundabout.laneWidth = width;
    const t = rotation * Math.PI / 180;
    for (const a of x.approaches) {
      Object.assign(a, { x: a.x * Math.cos(t) - a.y * Math.sin(t), y: a.x * Math.sin(t) + a.y * Math.cos(t), angle: a.angle + rotation });
      if (a.bezier) a.bezier.axis += rotation;
    }
    R.normalize(x);
    assert.equal(R.validate(x), '');
    const pavement = R.outline(x, 8 / 12), island = R.layout(x).inner;
    for (const a of x.approaches) for (const [j, id] of a.inLanes.entries()) for (const to of R.destinations(x, a, id)) {
      const b = x.approaches.find(b => b.id === to);
      for (const ends of [{}, { from: R.handle(x, a, true, j).sp + 20, to: R.handle(x, b, false, 0).sp + 20 }]) {
        const points = R.path(x, a, j, b, 0, ends), context = `${width} ft / ${rotation} deg / ${a.id}:${j} to ${b.id}`;
        assert.equal(selfCrossing(points), null, context);
        assert.ok(maxPathTurn(points) < 20, `${context}: no lateral jump (${maxPathTurn(points)} deg)`);
        for (const p of points.slice(1, -1)) {
          assert.ok(inside(p, pavement), `${context}: stays on pavement`);
          assert.ok(!island.inside(p), `${context}: stays outside the apron`);
        }
      }
    }
  }
});

test('mixed-size spiral openings use their local lane count across shapes', () => {
  for (const [maximum, local] of [[3, 2], [4, 2], [4, 3]]) for (const shape of ['circle', 'oval', 'peanut']) {
    const x = R.create(); Object.assign(x.roundabout, { icd: 300, shape, ratio: 1.3 });
    x.approaches[0].incoming = maximum; x.approaches[1].incoming = local;
    x.approaches[2].outgoing = maximum - 1; x.approaches[3].outgoing = local - 1;
    R.normalize(x);
    for (const a of x.approaches) Object.assign(a, G.mul(G.axes(a).u, R.requiredReach(x, a)));
    const L = R.layout(x);
    assert.equal(L.C, maximum);
    for (const opening of L.spiralPlan.transitions) {
      const count = L.legs.get(opening.entry).after;
      assert.equal(opening.count, count, 'opening uses its own receiving section');
      assert.deepEqual(opening.guides.map(g => g.boundary), Array.from({ length: opening.added }, (_, i) => count - 1 - i));
      // Measure the existing lanes outside the primary opening, square to
      // the guide. The widest section elsewhere must not add unused asphalt.
      for (let i = 2; i < opening.marking.length - 2; i += 4) {
        const p = opening.marking[i], tangent = G.unit(G.sub(opening.marking[i + 1], opening.marking[i - 1]));
        const normal = { x: -tangent.y, y: tangent.x }, w = (count - opening.added) * L.widths[0];
        const edge = G.add(p, G.mul(normal, w));
        assert.ok(Math.abs(G.length(edge) - L.outer.radius(Math.atan2(edge.y, edge.x))) < 0.12,
          `${shape}/${maximum}/${local}: only the occupied lanes lie outside the opening`);
        for (let outside = 1; outside < count - opening.added; outside++) {
          const divider = G.add(p, G.mul(normal, outside * L.widths[0]));
          assert.ok(Math.abs(G.length(divider) - L.dividerRadius(Math.atan2(divider.y, divider.x), count - opening.added - outside)) < 0.12,
            'existing lanes retain their normal widths through the opening');
        }
      }
    }
  }
});

test('wide-median repro keeps entry paint dotted and its two-lane opening and exit paths smooth', () => {
  for (const width of [14, 15, 18]) for (const rotation of [0, 37, 90, 183]) {
    const x = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/roundabout-wide-medians.json')));
    x.roundabout.laneWidth = width;
    const t = rotation * Math.PI / 180, tau = 2 * Math.PI, wrap = t => (t % tau + tau) % tau;
    for (const a of x.approaches) Object.assign(a, {
      x: a.x * Math.cos(t) - a.y * Math.sin(t), y: a.x * Math.sin(t) + a.y * Math.cos(t), angle: a.angle + rotation,
    });
    R.normalize(x);
    assert.equal(R.validate(x), '', 'test variations have non-overlapping approaches');
    const L = R.layout(x), paint = R.markings(x).lines;
    for (const a of x.approaches) {
      const A = L.legs.get(a.id), span = wrap(A.entryLeft.t - A.yieldStart);
      for (const line of paint.filter(l => !l.dash && l.color === '#ffffff' && l.width === 0.5)) for (const p of line.points) {
        const theta = Math.atan2(p.y, p.x), progress = wrap(A.entryLeft.t - theta), radius = G.length(p);
        if (progress < 0.002 || progress >= span - 0.002 || radius >= L.outer.radius(theta) - 0.1 || radius <= L.inner.radius(theta) + 0.1) continue;
        for (let b = 1; b < L.C; b++)
          assert.ok(Math.abs(radius - L.dividerRadius(theta, b)) > 0.01, `no solid circulating divider crosses entry ${a.angle}, width ${width}, boundary ${b}, point ${JSON.stringify(p)}`);
      }
      for (const [j, id] of a.inLanes.entries()) for (const dest of R.destinations(x, a, id)) {
        const b = x.approaches.find(b => b.id === dest);
        const points = R.path(x, a, j, b, 0, { from: R.handle(x, a, true, j).sp + 20, to: R.handle(x, b, false, 0).sp + 20 });
        assert.equal(selfCrossing(points), null, 'movement does not loop');
        assert.ok(maxPathTurn(points) < 15, `every approach keeps its lane through joins: width ${width}, ${a.angle}/${j} to ${b.angle}, turn ${maxPathTurn(points)}`);
      }
    }
    const west = L.legs.get(x.approaches[2].id);
    for (let k = 0; k < 2; k++) {
      const [guide] = exitGuides(paint, west, k);
      assert.ok(guide, 'each exit boundary receives its dotted guide');
      for (let i = 1; i < guide.points.length - 1; i++) {
        const a = G.sub(guide.points[i], guide.points[i - 1]), b = G.sub(guide.points[i + 1], guide.points[i]);
        const twiceArea = Math.abs(a.x * b.y - a.y * b.x);
        if (twiceArea < 1e-9) continue;
        const radius = G.length(a) * G.length(b) * G.length(G.add(a, b)) / (2 * twiceArea);
        assert.ok(radius > width / 2, 'exit guide is broad enough for its lane-center offset without a hook');
      }
    }
  }
});

test('two-lane exits turn directly out of an opening spiral and keep continuing lanes clear', () => {
  for (const width of [12, 14, 15, 18]) for (const rotation of [0, 37, 90, 183]) {
    const x = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/roundabout-two-lane-exit.json')));
    x.roundabout.laneWidth = width;
    const t = rotation * Math.PI / 180;
    for (const a of x.approaches) Object.assign(a, {
      x: a.x * Math.cos(t) - a.y * Math.sin(t), y: a.x * Math.sin(t) + a.y * Math.cos(t), angle: a.angle + rotation,
    });
    R.normalize(x);
    assert.equal(R.validate(x), '');
    const L = R.layout(x), paint = R.markings(x).lines, east = x.approaches[0], south = x.approaches[1];
    for (const [a, k] of [[east, 1], [x.approaches[2], 0], [x.approaches[2], 1]]) {
      const leg = L.legs.get(a.id), guides = exitGuides(paint, leg, k);
      assert.equal(guides.length, 1, 'one continuous dotted guide meets each receiving boundary');
      const points = guides[0].points;
      assert.equal(selfCrossing(points), null, 'exit guide never loops');
      assert.ok(maxPathTurn(points) < 15, 'exit guide has no kink');
      for (let i = 1; i < points.length - 1; i++) {
        const u = G.sub(points[i], points[i - 1]), v = G.sub(points[i + 1], points[i]);
        const curvature = 2 * Math.abs(u.x * v.y - u.y * v.x) / (G.length(u) * G.length(v) * G.length(G.add(u, v)));
        assert.ok(curvature * width < 1, 'the bend leaves room for a lane-center offset');
      }
      if (k) {
        const end = points.at(-1);
        assert.ok(paint.some(l => !l.dash && l.width === 0.5 && G.length(G.sub(l.points.at(-1), end)) < 0.02),
          'solid receiving line stops exactly at the dotted guide');
      }
    }
    for (const [j, id] of east.inLanes.entries()) for (const dest of R.destinations(x, east, id)) {
      const b = x.approaches.find(a => a.id === dest);
      const points = R.path(x, east, j, b, 0, { from: R.handle(x, east, true, j).sp + 20, to: R.handle(x, b, false, 0).sp + 20 });
      assert.equal(selfCrossing(points), null, 'east entry paths do not fold at either exit');
      assert.ok(maxPathTurn(points) < 15, 'east entry paths join the exit smoothly');
      if (j === 0) for (const guide of exitGuides(paint, L.legs.get(x.approaches[2].id), 0)) {
        for (const p of guide.points)
          assert.ok(lineDistance(p, points) > width / 2 - 0.15, 'the west departure leaves the continuing inside lane clear');
      }
    }
    const paths = [0, 1].map(j => R.path(x, south, j, east));
    for (const points of paths) {
      assert.equal(selfCrossing(points), null, 'both southern lanes enter the east exit without loops');
      assert.ok(maxPathTurn(points) < 15);
    }
    assert.ok(G.length(G.sub(paths[0].at(-1), paths[1].at(-1))) > 11.9, 'two southern lanes reach distinct receiving lanes');
  }
});

test('saved east-entry right and through paths follow their painted lane, at every orientation and width', () => {
  const crossing = (p, q) => {
    const cross = (a, b) => a.x * b.y - a.y * b.x;
    for (let i = 1; i < p.length; i++) for (let j = 1; j < q.length; j++) {
      const u = G.sub(p[i], p[i - 1]), v = G.sub(q[j], q[j - 1]), w = G.sub(q[j - 1], p[i - 1]), den = cross(u, v);
      if (Math.abs(den) < 1e-9) continue;
      const t = cross(w, v) / den, s = cross(w, u) / den;
      if (t > 1e-5 && t < 1 - 1e-5 && s > 1e-5 && s < 1 - 1e-5) return true;
    }
    return false;
  };
  const distance = (p, line) => Math.min(...line.slice(1).map((q, i) => {
    const v = G.sub(q, line[i]), t = Math.max(0, Math.min(1, G.dot(G.sub(p, line[i]), v) / G.dot(v, v)));
    return G.length(G.sub(p, G.add(line[i], G.mul(v, t))));
  }));
  for (const width of [12, 15, 18]) for (const rotation of [0, 37, 90, 183]) {
    const x = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/roundabout-path-lane-alignment.json')));
    x.roundabout.laneWidth = width;
    const t = rotation * Math.PI / 180;
    for (const a of x.approaches) Object.assign(a, {
      x: a.x * Math.cos(t) - a.y * Math.sin(t), y: a.x * Math.sin(t) + a.y * Math.cos(t), angle: a.angle + rotation,
    });
    R.normalize(x);
    const a = x.approaches[0], L = R.layout(x), paint = R.markings(x).lines;
    for (const dest of R.destinations(x, a, a.inLanes[1])) {
      const b = x.approaches.find(b => b.id === dest), B = L.legs.get(b.id);
      const points = R.path(x, a, 1, b, 0, { from: R.handle(x, a, true, 1).sp + 20, to: R.handle(x, b, false, 0).sp + 20 });
      assert.equal(selfCrossing(points), null, 'movement has no loop');
      assert.ok(maxPathTurn(points) < 15, 'movement joins stay smooth');
      for (const line of paint.filter(l => l.width === 0.5 && l.color === '#ffffff'))
        assert.equal(crossing(points, line.points), false, 'outer lane never cuts across a divider or edge');
      if (R.turnOf(x, a, b) !== 'through') continue;
      const [guide] = exitGuides(paint, B, 0);
      assert.ok(guide, 'the departing lane has a painted guide');
      for (const p of guide.points) {
        const d = distance(p, points);
        assert.ok(d >= Math.min(width, b.outWidth) / 2 - 0.15, 'through path keeps half a lane clear of the exit divider');
        assert.ok(d <= Math.max(width, b.outWidth) / 2 + 0.15, 'through path follows the divider into the receiving lane');
      }
    }
  }
});

test('fixed two- through four-lane circles keep receiving lanes and smooth exit-guide joins', () => {
  const cases = [2, 3, 4].map(n => {
    const x = lanes(R.create(), n);
    for (const a of x.approaches) Object.assign(a, G.mul(G.axes(a).u, R.requiredReach(x, a)));
    return x;
  });
  for (const name of ['r084', 'r092']) cases.push(JSON.parse(fs.readFileSync(path.join(__dirname, `fixtures/roundabout-${name}.json`))));
  for (const x of cases) {
    R.normalize(x);
    const L = R.layout(x);
    for (const a of x.approaches) for (const [j, id] of a.inLanes.entries()) for (const dest of R.destinations(x, a, id)) {
      const b = x.approaches.find(b => b.id === dest), B = L.legs.get(b.id);
      const points = R.path(x, a, j, b, 0, { from: R.handle(x, a, true, j).sp + 20, to: R.handle(x, b, false, 0).sp + 20 });
      assert.equal(selfCrossing(points), null, 'movement has no loop');
      assert.ok(maxPathTurn(points) < 15, 'the circulating lane and exit guide join without a sideways step');
      const end = points.at(-1), center = s => (B.exitOff(j, s) + B.exitOff(j + 1, s)) / 2;
      assert.ok(B.line(center, 0, B.S0).some(p => G.length(G.sub(p, end)) < 1.01), 'movement reaches its corresponding receiving lane');
    }
  }
});

test('saved regular and mini layouts have smooth movement joins in every orientation', () => {
  for (const fixture of ['roundabout-continuing-lane-kink', 'roundabout-mini-path-kink']) for (const rotation of [0, 37, 90, 183]) {
    const x = JSON.parse(fs.readFileSync(path.join(__dirname, `fixtures/${fixture}.json`)));
    const t = rotation * Math.PI / 180;
    for (const a of x.approaches) Object.assign(a, {
      x: a.x * Math.cos(t) - a.y * Math.sin(t), y: a.x * Math.sin(t) + a.y * Math.cos(t), angle: a.angle + rotation,
    });
    R.normalize(x);
    const L = R.layout(x);
    for (const a of x.approaches) for (const [j, id] of a.inLanes.entries()) for (const dest of R.destinations(x, a, id)) {
      const b = x.approaches.find(b => b.id === dest);
      const points = R.path(x, a, j, b, 0, { from: R.handle(x, a, true, j).sp + 20, to: R.handle(x, b, false, 0).sp + 20 });
      assert.equal(selfCrossing(points), null, `${fixture}: no movement loop`);
      assert.ok(maxPathTurn(points) < 15, `${fixture}: no abrupt join (${a.angle} to ${b.angle})`);
      assert.ok(points.every(p => G.length(p) > L.inner.radius(Math.atan2(p.y, p.x))), 'movement clears the island');
    }
    for (const line of R.markings(x).lines.filter(l => l.width === 0.5 && l.dash?.[0] === 2 && l.dash[1] === 4)) {
      assert.equal(selfCrossing(line.points), null, 'skip guide does not loop');
      assert.ok(maxPathTurn(line.points) < 15, 'skip guide meets its exit smoothly');
    }
  }
});

const spiralCase = (shape, count, entries = 1, rotation = 0) => {
  const x = R.create();
  Object.assign(x.roundabout, { shape, ratio: 1.5, turn: rotation, icd: 300, lanes: count });
  for (const [i, a] of x.approaches.entries()) Object.assign(a, {
    incoming: i === 1 || entries > 1 && i === 3 ? count : 1,
    outgoing: count - 1, angle: a.angle + rotation,
  });
  R.normalize(x);
  for (const a of x.approaches) {
    Object.assign(a, G.mul(G.axes(a).u, 400));
    Object.assign(a, G.mul(G.axes(a).u, R.requiredReach(x, a)));
    if (a.incoming === count) {
      const left = x.approaches.find(b => R.turnOf(x, a, b) === 'left');
      for (let j = 0; j < count - 1; j++) a.dest[a.inLanes[j]] = [left.id];
      a.dest[a.inLanes[count - 1]] = x.approaches.filter(b => ['through', 'right'].includes(R.turnOf(x, a, b))).map(b => b.id);
    }
  }
  return x;
};

test('oval and peanut spirals open each new inside lane and retain equal normal widths', () => {
  for (const shape of ['circle', 'oval', 'peanut']) for (const count of [2, 3, 4]) for (const rotation of [0, 37, 90]) {
    const x = spiralCase(shape, count, 1, rotation), L = R.layout(x), plan = L.spiralPlan;
    assert.equal(R.validate(x), '', `${shape}/${count}: usable geometry`);
    assert.ok(plan.alignmentFits, 'tip aligns with incoming left edge');
    assert.equal(plan.transitions.length, 1);
    const opening = plan.transitions[0];
    assert.equal(opening.guides.length, count - 1, 'one guide for each new inside lane');
    for (const guide of opening.guides) {
      assert.ok(guide.points.length > 2, 'new lane has an actual opening guide');
      const start = guide.points[0];
      assert.ok(Math.abs(G.length(start) - L.inner.radius(Math.atan2(start.y, start.x))) < 0.05, 'each guide starts on the actual island edge');
      assert.equal(selfCrossing(guide.points), null, 'spiral guide does not cross itself');
      for (const p of guide.points) assert.ok(G.length(p) >= L.inner.radius(Math.atan2(p.y, p.x)) - 0.05, 'no paint on apron');
    }
    for (const surface of R.surfaces(x).filter(s => s.kind === 'apron' || s.kind === 'island'))
      assert.equal(selfCrossing([...surface.points, surface.points[0]]), null, `${shape}: island outline stays simple`);
    const track = R.tracks(x).find(t => t.circulatory);
    track.line.forEach((p, i) => {
      const t = Math.atan2(p.y, p.x), bounds = track.bounds[i];
      assert.ok(Math.abs(G.length(p) + bounds[0][0] - L.inner.radius(t)) < 0.01, 'custom marking track follows the shaped island');
      assert.ok(Math.abs(G.length(p) + bounds.at(-1)[1] - L.outer.radius(t)) < 0.01, 'custom marking track follows the actual outer edge');
    });
    for (const a of x.approaches) {
      const leg = L.legs.get(a.id), t = leg.exitLeft.t - ((leg.exitLeft.t - leg.entryLeft.t + 2 * Math.PI) % (2 * Math.PI)) / 2;
      const rings = [L.inner, ...Array.from({ length: count - 1 }, (_, c) => L.dividerRing(count - 1 - c)), L.outer];
      let open = 0;
      for (let c = 0; c < count; c++) {
        const available = rings[c + 1].radius(t) - rings[c].radius(t);
        assert.ok(available > -0.05, 'boundaries keep their order');
        if (available < 1) continue;
        open++;
        assert.ok(Math.abs(normalWidth(rings[c], rings[c + 1], t) - 15) < 0.15, `${shape}/${count}: every active lane stays 15 ft wide`);
      }
      assert.equal(open, Math.max(1, leg.front), 'closed lanes consume no pavement width');
    }
    const a = x.approaches.find(a => a.incoming === count), left = x.approaches.find(b => R.turnOf(x, a, b) === 'left');
    const paths = Array.from({ length: count - 1 }, (_, j) => R.path(x, a, j, left));
    paths.forEach(p => assert.equal(selfCrossing(p), null, 'parallel left-turn paths do not loop'));
    for (let j = 1; j < paths.length; j++) assert.ok(G.length(G.sub(paths[j].at(-1), paths[j - 1].at(-1))) > 11.9, 'left-turn lanes reach separate exit lanes');
  }
});

test('multiple wide spiral entries preserve live lanes instead of collapsing them at a new tip', () => {
  for (const shape of ['circle', 'oval', 'peanut']) {
    const x = spiralCase(shape, 4, 2);
    // Two left-only lanes plus two through lanes, both at opposing entries.
    for (const a of x.approaches.filter(a => a.incoming === 4)) {
      const through = x.approaches.find(b => R.turnOf(x, a, b) === 'through');
      a.dest[a.inLanes[2]] = [through.id];
    }
    const L = R.layout(x);
    assert.equal(L.spiralPlan.transitions.length, 2);
    for (const opening of L.spiralPlan.transitions) {
      assert.equal(opening.guides.length, 2, 'both left lanes receive an opening');
      const entry = x.approaches.find(a => a.id === opening.entry), left = x.approaches.find(b => R.turnOf(x, entry, b) === 'left');
      const a = R.path(x, entry, 0, left), b = R.path(x, entry, 1, left);
      assert.ok(G.length(G.sub(a.at(-1), b.at(-1))) > 11.9, 'two distinct receiving lanes');
      for (const points of [a, b]) assert.equal(selfCrossing(points), null);
    }
  }
});

test('collapsed Bézier pulls are rejected while loaded geometry stays finite', () => {
  for (const end of ['mouth','circle']) {
    const x=R.create(),a=x.approaches[0],h=R.approachBezierHandles(x,a)[end];
    R.setApproachBezier(x,a,end,G.sub(h.from,h.p));
    assert.match(R.validate(x), /turns back|folds a lane edge/);
    const L=R.layout(x).legs.get(a.id);
    assert.ok(Number.isFinite(L.metric(L.entryOff(1,0),0)));
    assert.ok(G.length(L.normal(end==='mouth'?0:L.S0,-1))>0.99);
    assert.ok(R.outline(x).every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)));
  }
});

test('Sarasota connections can shorten past overlapping control pulls without folding the actual curve', () => {
  for (const [index, side, delta] of [[1, 'exit', {x:65,y:5.4}], [2, 'entry', {x:-12.2,y:35.7}]]) {
    const x = R.normalize(JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/roundabout-sarasota.json'))));
    const a = x.approaches[index], before = R.splitterCorners(x, a)[side], meanings = movementMeanings(x);
    R.setSplitterCorner(x, a, side, 'mouth', delta);
    assert.equal(R.validate(x), '');
    const L = R.layout(x).legs.get(a.id), p = L.sideBeziers[side].points;
    assert.ok(-G.dot(G.sub(p[2],p[1]),L.u)<0, 'control pulls overlap along the construction axis');
    for (const k of [0, side === 'entry' ? a.incoming : a.outgoing]) {
      const line = L.line(s => side === 'entry' ? L.entryOff(k,s) : L.exitOff(k,s));
      assert.equal(selfCrossing(line), null, 'the actual lane boundary remains simple');
    }
    assert.ok(G.length(G.sub(R.splitterCorners(x,a)[side].mouth,G.add(before.mouth,delta)))<1e-5);
    assert.deepEqual(movementMeanings(x),meanings);
  }
});

test('independent Sarasota carriageways are checked at their actual boundaries, not equal curve parameters', () => {
  const x = R.normalize(JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/roundabout-sarasota.json'))));
  const a = x.approaches[1], before = structuredClone(a.bezierSides.exit);
  R.setSplitterCorner(x,a,'entry','mouth',{x:40,y:-5});
  const L = R.layout(x).legs.get(a.id);
  const projected = Array.from({length:101},(_,i)=>{
    const s=L.S0*i/100;
    return G.dot(G.sub(L.P(L.exitOff(0,s),s),L.P(L.entryOff(0,s),s)),L.normal(s));
  });
  assert.ok(Math.min(...projected)<-3, 'equal parameters would incorrectly report a crossed median');
  assert.equal(R.validate(x),'');
  assert.deepEqual(a.bezierSides.exit,before, 'the opposing carriageway stays unchanged');
  const crossed = R.normalize(JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/roundabout-sarasota.json'))));
  R.setSplitterCorner(crossed,crossed.approaches[0],'exit','mouth',{x:-15,y:-38});
  assert.match(R.validate(crossed),/entry and exit curves cross/, 'a real crossing is still rejected');
});

test('assembled Sarasota keeps four editable legs, simple curbs and non-looping movements', () => {
  const x=R.normalize(JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/roundabout-sarasota-assembled.json'))));
  assert.equal(R.validate(x),'');
  assert.equal(x.approaches.length,4);
  assert.deepEqual(x.approaches.map(a=>[a.incoming,a.outgoing]),[[3,2],[3,2],[2,2],[0,1]]);
  assert.equal(selfCrossing(R.outline(x)),null);
  for(const a of x.approaches) {
    for(const side of ['entry','exit'].filter(side=>side==='entry'?a.incoming:a.outgoing)) {
      const handles=R.approachSideBezierHandles(x,a,side);
      assert.ok(Object.values(handles).every(h=>[h.from.x,h.from.y,h.p.x,h.p.y].every(Number.isFinite)));
    }
    for(const [j,lane] of a.inLanes.entries()) for(const id of R.destinations(x,a,lane)) {
      const points=R.path(x,a,j,x.approaches.find(b=>b.id===id));
      assert.equal(selfCrossing(points),null, `approach ${x.approaches.indexOf(a)+1}, lane ${j+1}`);
      assert.ok(points.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)));
    }
  }
});

test('whole and independent Bézier controls cannot reverse or cross their pulls', () => {
  for (const side of ['whole', 'entry', 'exit']) for (const end of ['mouth', 'circle']) {
    const x = R.create(), a = x.approaches[0];
    const delta = G.mul(G.axes(a).u, end === 'mouth' ? 100 : -100);
    if (side === 'whole') R.setApproachBezier(x, a, end, delta);
    else R.setApproachSideBezier(x, a, side, delta, end);
    assert.notEqual(R.validate(x), '', `${side}/${end} rejects an inverted curve`);
  }
});

test('accelerated ring search preserves the nearest vertex and adjacent-segment projection', () => {
  const reference = (ring, p) => {
    const pts = ring.points, n = pts.length;
    let best = 0, distance = Infinity;
    pts.forEach((q, i) => { const d = G.length(G.sub(q, p)); if (d < distance) { best = i; distance = d; } });
    const project = (a, b) => {
      const v = G.sub(b, a), f = Math.max(0, Math.min(1, G.dot(G.sub(p, a), v) / (G.dot(v, v) || 1)));
      return G.add(a, G.mul(v, f));
    };
    const a = project(pts[(best + n - 1) % n], pts[best]), b = project(pts[best], pts[(best + 1) % n]);
    return G.length(G.sub(a, p)) < G.length(G.sub(b, p)) ? a : b;
  };
  for (const shape of ['circle', 'oval', 'peanut']) {
    const x = lanes(R.create(), 2);
    Object.assign(x.roundabout, { shape, ratio: 1.3, icd: 320, spiral: 'on' });
    for (const a of x.approaches) Object.assign(a, G.mul(G.axes(a).u, R.requiredReach(x, a)));
    const Lt = R.layout(x);
    for (const ring of [Lt.outer, Lt.inner]) for (let i = 0; i < 240; i++) {
      const theta = i * 2.399963229728653, radius = 5 + (i * 37 % 500), p = { x: Math.cos(theta) * radius, y: Math.sin(theta) * radius };
      assert.ok(G.length(G.sub(ring.nearest(p), reference(ring, p))) < 1e-9, `${shape}: exact nearest point`);
    }
    assert.equal(R.layout(x), Lt, 'repeated calls share normalized layout');
  }
});

test('physical splitter curb follows the full departing edge in the saved south approach', () => {
  let checked = 0;
  for (const name of ['splitter-curb', 'splitter-exit-gore', 'r015-spiral']) {
    const x = R.normalize(JSON.parse(fs.readFileSync(path.join(__dirname, `fixtures/roundabout-${name}.json`))));
    const Lt = R.layout(x);
    R.markings(x, null);
    for (const guide of Lt.dividers.filter(g => g.exitBoundary === 0 && g.splitterEdge)) {
      const a = x.approaches.find(a => a.id === guide.exit), L = Lt.legs.get(a.id);
      const curb = R.splitter(Lt, a), closed = [...curb, curb[0]];
      assert.equal(selfCrossing(closed), null, 'expanded splitter remains a simple polygon');
      for (const p of guide.splitterEdge.solid.slice(1, -1)) {
        if (G.length(p) - Lt.outer.radius(Math.atan2(p.y, p.x)) < R.ISLAND_SETBACK + R.END_RADIUS.exit + 2) continue;
        assert.ok(Math.abs(lineDistance(p, closed) - L.curb) < 0.08, 'physical curb follows the new painted exit edge at its curb offset');
        checked++;
      }
    }
  }
  assert.ok(checked > 15, 'checks the extended nose, not only the unchanged stem');
});

test('yield setback without an entry gore moves paint without changing lane geometry or movements', () => {
  const x = R.normalize(JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/roundabout-sarasota-assembled.json'))));
  const a = x.approaches[2]; a.entryGores = {}; a.entryGore = 0;
  const before = structuredClone(x), pavement = R.outline(x), ring = R.layout(x).outer;
  const paths = a.inLanes.map((id, j) => R.destinations(x, a, id).map(id => R.path(x, a, j, x.approaches.find(b => b.id === id))));
  const tracks = R.tracks(x), h0 = R.yieldLineHandle(x, a);
  a.yieldSetback = 15;
  assert.equal(R.validate(x), '');
  const Lt = R.layout(x), L = Lt.legs.get(a.id), h1 = R.yieldLineHandle(x, a);
  assert.ok(h1.p.y < h0.p.y - 10, 'north entry moves upstream toward the north');
  assert.deepEqual(R.outline(x), pavement);
  assert.deepEqual(R.surfaces(x), R.surfaces(before), 'yield position does not move the islands or entry gores');
  const lanePaint = x => R.markings(x, null).lines.filter(l => !(l.width === R.EXTENSION.width && l.dash?.[1] === 2));
  assert.deepEqual(lanePaint(x), lanePaint(before), 'lane boundaries keep reaching the circle');
  assert.deepEqual(R.tracks(x).map(t => [t.line, t.markingLaneEdges]), tracks.map(t => [t.line, t.markingLaneEdges]));
  assert.deepEqual(a.dest, before.approaches[2].dest);
  assert.deepEqual(a.inLanes.map((id, j) => R.destinations(x, a, id).map(id => R.path(x, a, j, x.approaches.find(b => b.id === id)))), paths);
  const line = L.yieldRing.arc(L.yieldStart, L.yieldEnd, false);
  assert.ok(line.every(p => !ring.inside(p) && inside(p, R.outline(x, 8 / 12))));
  assert.ok(lineDistance(line[0], L.entryCurb) < 0.01, 'outside end meets actual curb');
  assert.ok(lineDistance(line.at(-1), L.line(s => L.entryOff(0, s), 0, L.entryLeft.sp)) < 0.01, 'inside end meets median edge');
  for (let j = 0; j < a.incoming; j++) {
    const off = s => L.entryBounds(j, s).reduce((sum, d) => sum + d, 0) / 2;
    assert.ok(L.entryMeet(off) < L.circleMeet(off));
  }
  a.yieldSetback = 0;
  assert.deepEqual(R.markings(x, C), R.markings(before, C), 'reset restores all paint');
});

test('setback yield lines and words fit curved, one-way, oval and peanut entries', () => {
  const rectangle = { build: spec => ({ length: 8, parts: spec.type === 'word'
    ? [{ fill: '#ffffff', rings: [[[-2, 0], [2, 0], [2, 8], [-2, 8]]] }] : [] }) };
  for (const shape of ['circle', 'oval', 'peanut']) for (const n of [1, 2, 3, 4]) {
    const x = lanes(R.create(), n);
    Object.assign(x.roundabout, {shape, ratio: shape === 'circle' ? 1 : 1.15, icd: 350, lanes: n});
    for (const a of x.approaches) { Object.assign(a, G.mul(G.axes(a).u, R.requiredReach(x, a))); a.yieldSetback = 12; }
    const a = x.approaches[3]; a.outgoing = 0; R.normalize(x);
    if (n > 1) a.entryGores = {[a.inLanes[1]]: 6};
    const Lt = R.layout(x), paint = R.markings(x, rectangle), pavement = R.outline(x, 8 / 12);
    let index = 0;
    for (const a of x.approaches) {
      const L = Lt.legs.get(a.id);
      const ends = [L.yieldRing.at(L.yieldStart), L.yieldRing.at(L.yieldEnd)];
      assert.ok(lineDistance(ends[0], L.entryCurb) < 0.02, `${shape}/${n}: outside end clipped to curb`);
      if (!a.outgoing) assert.ok(lineDistance(ends[1], L.entryInnerCurb) < 0.02, 'one-way inner end clipped to its curb');
      for (let j = 0; j < a.incoming; j++) {
        const points = paint.symbols[index++].rings[0];
        assert.ok(points.every(p => inside(p, pavement) && !L.yieldRing.inside(p)), `${shape}/${n}: word behind line and on pavement`);
      }
    }
    assert.equal(paint.lines.filter(l => l.width === R.EXTENSION.width && l.dash?.[1] === 2).length, n > 1 ? 3 + n : 4, 'yield marks split around the entry gore');
  }
});

test('yield line editing rejects positions beyond the road connection and invalid values', () => {
  const x = R.create(), a = x.approaches[3];
  for (const v of [-1, NaN, Infinity]) { a.yieldSetback = v; assert.match(R.validate(x), /yield line setback/); }
  a.yieldSetback = 1000; assert.match(R.validate(x), /within the approach/);
  a.yieldSetback = 0; assert.equal(R.validate(x), '');
});

test('closely spaced Sarasota entry and exit share a smooth curb with attached yield markings', () => {
  for (const rotation of [0, 37, 90, 183]) for (const gore of [0, 6, 16.81848631582739]) for (const setback of [0, 9]) {
    const x = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/roundabout-close-entries.json')));
    const t = rotation * Math.PI / 180;
    for (const a of x.approaches) Object.assign(a, {
      x: a.x * Math.cos(t) - a.y * Math.sin(t), y: a.x * Math.sin(t) + a.y * Math.cos(t), angle: a.angle + rotation,
    });
    const a=x.approaches[2], b=x.approaches[3];
    b.entryGores[b.inLanes[1]]=gore; b.yieldSetback=setback;
    R.normalize(x);
    assert.equal(R.validate(x),'');
    const Lt=R.layout(x), corner=Lt.corners.get(a.id), L=Lt.legs.get(b.id), pavement=R.outline(x,8/12);
    const join=corner.exitBoundary.length;
    assert.ok(maxPathTurn(corner.points.slice(join-19,join+19))<6,`close curb has no sharp join: ${rotation}/${gore}/${setback}`);
    assert.equal(selfCrossing(corner.points),null,'curb does not loop');
    assert.ok(corner.points.every(p=>G.length(p)>=Lt.outer.radius(Math.atan2(p.y,p.x))-.01),'corner retains the circulating roadway');
    const yieldLine=L.yieldRing.arc(L.yieldStart,L.yieldEnd,false);
    assert.ok(lineDistance(yieldLine[0],L.entryCurb)<.02,`yield meets the shared curb: ${rotation}/${gore}/${setback}: ${lineDistance(yieldLine[0],L.entryCurb)}`);
    assert.ok(lineDistance(yieldLine.at(-1),L.line(s=>L.entryOff(0,s),0,L.entryLeft.sp))<.02,'yield meets the median edge');
    assert.ok(yieldLine.every(p=>inside(p,pavement)),'yield stays on pavement');
    for(const j of [0,1]) for(const id of R.destinations(x,b,b.inLanes[j])) {
      const points=R.path(x,b,j,x.approaches.find(a=>a.id===id));
      assert.equal(selfCrossing(points),null,'entry paths stay continuous');
      assert.ok(points.every(p=>inside(p,pavement)||lineDistance(p,[...pavement,pavement[0]])<.02),`entry paths stay on the roadway: ${rotation}/${gore}/${setback}/${j}/${id}`);
    }
    const serialized=JSON.stringify(x);
    R.markings(x,C);
    assert.equal(JSON.stringify(x),serialized,'fitting does not move the edited approach controls');
  }
});

test('yield setback carries painted and curbed entry gores, with a solid cap joining the painted edges', () => {
  for (const shape of ['circle','oval','peanut']) for (const type of ['painted','curbed']) {
    const x=lanes(R.create(),3), a=x.approaches[1];
    Object.assign(x.roundabout,{icd:400,shape,ratio:shape==='circle'?1:1.2});
    for(const b of x.approaches) Object.assign(b,G.mul(G.axes(b).u,R.requiredReach(x,b)+100));
    R.setApproachBezier(x,a,'mouth',{x:12,y:0});
    a.entryGores={[a.inLanes[1]]:6,[a.inLanes[2]]:7};
    a.entryGoreTypes={[a.inLanes[1]]:type,[a.inLanes[2]]:type};
    a.entryGoreLengths={[a.inLanes[1]]:70,[a.inLanes[2]]:80};
    const before=R.markings(x), surfaces=R.surfaces(x), tips=[1,2].map(k=>R.entryGoreHandles(x,a,k).tip), meanings=movementMeanings(x);
    for(const setback of [12,6]) {
      a.yieldSetback=setback;
      assert.equal(R.validate(x),'');
      const L=R.layout(x).legs.get(a.id), paint=R.markings(x), pavement=R.outline(x,8/12);
      for(const k of [1,2]) {
        const handle=R.entryGoreHandles(x,a,k), direction=G.unit(G.sub(L.P(L.entryOff(k,handle.start+.01),handle.start+.01),handle.tip));
        assert.ok(G.dot(G.sub(handle.tip,tips[k-1]),direction)<-setback*.8,'tip moves upstream with the yield line');
        const off=[s=>L.entryOff(k,s)+L.goreOffset(s,k),s=>L.entryOff(k,s)];
        const ends=off.map(f=>{const sp=L.entryMeet(f);return L.P(f(sp),sp);});
        const outlines=paint.lines.filter(l=>l.width===8/12 && !l.dash);
        for(const end of ends) assert.ok(outlines.some(l=>G.length(G.sub(l.points.at(-1),end))<.01),'gore sides end at YIELD');
        const cap=outlines.find(l=>G.length(G.sub(l.points[0],ends[0]))<.01 && G.length(G.sub(l.points.at(-1),ends[1]))<.01);
        if(type==='painted') {
          assert.ok(cap,'solid white cap connects both gore edges');
          assert.ok(cap.points.every(p=>Math.abs(G.length(p)-L.yieldRing.radius(Math.atan2(p.y,p.x)))<.01),'cap follows the yield curve');
        }
        assert.ok(G.length(G.sub(handle.width,L.P(L.entryOff(k,handle.sp),handle.sp)))<1e-6,'width handle follows the moved gore');
      }
      const islands=R.surfaces(x).filter(s=>s.kind==='gore');
      assert.equal(islands.length,type==='curbed'?2:0);
      for(const island of islands) {
        assert.ok(island.points.every(p=>!L.yieldRing.inside(p) && inside(p,pavement)),'curbed island moves fully behind the yield line');
        assert.equal(selfCrossing([...island.points,island.points[0]]),null);
      }
      assert.deepEqual(movementMeanings(x),meanings,'lane movements retain their meaning');
      assert.deepEqual(R.markings(R.normalize(JSON.parse(JSON.stringify(x)))),paint,'project JSON preserves shifted gore');
      // Length editing continues to use its original configured span after moving.
      const saved=structuredClone(a.entryGoreLengths), h=R.entryGoreHandles(x,a,1);
      R.resizeEntryGore(x,a,1,'tip',{x:0,y:0});
      assert.ok(Math.abs(a.entryGoreLengths[a.inLanes[1]]-saved[a.inLanes[1]])<.02,'tip does not jump on its next drag');
      a.entryGoreLengths=saved;
    }
    a.yieldSetback=0;
    assert.deepEqual(R.markings(x),before,'reset returns the original paint');
    assert.deepEqual(R.surfaces(x),surfaces,'reset returns the original islands');
  }
});


test('shortened splitter connections do not create a false curb tangency', () => {
  const x = R.normalize(JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/roundabout-flipped-fillet.json'), 'utf8')));
  assert.equal(R.validate(x), '');
  const Lt = R.layout(x);
  for (const corner of Lt.corners.values()) {
    assert.ok(corner.ok, 'the shortened approach still has fitted corners');
    for (const points of [corner.entryBoundary, corner.exitBoundary]) {
      for (let i = 2; i < points.length; i++) {
        const before = G.sub(points[i - 1], points[i - 2]), after = G.sub(points[i], points[i - 1]);
        if (G.length(before) < 1e-6 || G.length(after) < 1e-6) continue;
        assert.ok(G.dot(G.unit(before), G.unit(after)) > 0.8, 'curb joins stay tangent without a stretched endpoint');
      }
    }
  }
});


test('close approach yield line eases into the splitter instead of cutting diagonally', () => {
  const x = R.normalize(JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/roundabout-close-yield.json'), 'utf8')));
  const Lt = R.layout(x), L = Lt.legs.get(x.approaches[3].id);
  assert.ok(Lt.corners.get(x.approaches[2].id).shared);
  const span = (L.yieldEnd - L.yieldStart + Math.PI * 2) % (Math.PI * 2);
  const radius = t => G.length(L.yieldRing.at(t));
  const excess = radius(L.yieldStart) - G.length(L.circleRing.at(L.yieldStart));
  assert.ok(excess > 10, 'fixture has a shared curb outside the circle');
  const nearEnd = L.yieldStart + span * 0.95;
  assert.ok(radius(nearEnd) - G.length(L.circleRing.at(nearEnd)) < excess * 0.01,
    'yield curve approaches the splitter with a flat radial slope');
  const points = L.yieldRing.arc(L.yieldStart, L.yieldEnd, false);
  assert.ok(lineDistance(points[0], L.entryCurb) < 0.02);
  assert.ok(lineDistance(points.at(-1), L.line(s => L.entryOff(0, s), 0, L.entryLeft.sp)) < 0.02);
});
