/* Stable, editable inputs. Do not turn a rendering defect into an input fix:
   this library is meant to retain failing cases while the renderer evolves. */
const G = require('../../js/intersection-geometry.js');
const R = require('../../js/roundabout-geometry.js');
const fs = require('node:fs');
const path = require('node:path');
const clone = x => structuredClone(x);
const directions = ['E', 'S', 'W', 'N'];
const states = [[1, 1], [1, 2], [2, 1], [2, 2], [0, 1], [0, 2], [1, 0], [2, 0]];
const combinations = (base, length, number) => Array.from({ length }, (_, i) => Math.floor(number / base ** i) % base);

function itemFor(id, counts = Array(4).fill([1, 1]), angles = counts.map((_, i) => i * 360 / counts.length)) {
  const item = { id: `${id}-roundabout`, kind: 'roundabout', name: id, x: 0, y: 0, rotation: 0, movements: [], roundabout: {}, approaches: [] };
  item.approaches = counts.map(([incoming, outgoing], i) => ({ ...R.approach(angles[i]), id: `${id}-a${i + 1}`, incoming, outgoing,
    inLanes: Array.from({ length: incoming }, (_, j) => `${id}-a${i + 1}-in${j + 1}`),
    outLanes: Array.from({ length: outgoing }, (_, j) => `${id}-a${i + 1}-out${j + 1}`) }));
  return R.normalize(item);
}
function place(item) {
  R.normalize(item);
  for (const a of item.approaches) Object.assign(a, G.mul(G.axes(a).u, R.requiredReach(item, a)));
}
function stableCopy(source, id) {
  const item = clone(source), ids = new Map([[item.id, `${id}-roundabout`]]);
  item.approaches.forEach((a, i) => {
    ids.set(a.id, `${id}-a${i + 1}`);
    a.inLanes.forEach((v, j) => ids.set(v, `${id}-a${i + 1}-in${j + 1}`));
    a.outLanes.forEach((v, j) => ids.set(v, `${id}-a${i + 1}-out${j + 1}`));
  });
  const remap = value => typeof value === 'string' ? ids.get(value) ?? value : Array.isArray(value) ? value.map(remap)
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k, v]) => [ids.get(k) ?? k, remap(v)])) : value;
  return Object.assign(remap(item), { x: 0, y: 0 });
}
function describe(item) {
  return item.approaches.map((a, i) => ({ approach: i + 1, angle: a.angle, incoming: a.incoming, outgoing: a.outgoing,
    destinations: a.inLanes.map(id => ({ lane: id, explicit: Object.hasOwn(a.dest, id), exits: R.destinations(item, a, id).map(id => item.approaches.findIndex(b => b.id === id) + 1) })) }));
}
function fixture(id, title, note, item, family, options = {}) {
  if (!options.keepMouths) place(item);
  item.name = `${id} ${title}`;
  const extent = Math.max(180, ...item.approaches.map(a => G.length(a) + Math.max(a.incoming, a.outgoing) * a.width + (options.attach ? 180 : 20)));
  const size = Math.ceil((extent * 8 + 440) / 100) * 100;
  Object.assign(item, { x: size / 2, y: size / 2 + 60 });
  const data = { name: item.name, inchesPerPixel: 3, view: null, blank: true, width: size, height: size, autoTapers: false,
    roads: [], joints: [], gores: [], medians: [], intersections: [item], signs: [], markings: [], lines: [], bridges: [], surfaces: [] };
  if (options.attach) {
    const a = item.approaches[0]; a.links = [];
    for (const incoming of [true, false]) {
      const ids = incoming ? a.inLanes : a.outLanes;
      if (!ids.length) continue;
      const road = data.roads.length + 1, j0 = road * 2 - 1, j1 = j0 + 1, u = G.axes(a).u;
      const points = ids.map((_, j) => G.lane(a, incoming, j));
      const mouth = G.add(item, G.mul(points.reduce((sum, p) => G.add(sum, G.mul(p, 1 / points.length)), { x: 0, y: 0 }), 4));
      const far = G.add(mouth, G.mul(u, 150 * 4)), dir = G.mul(u, incoming ? -1 : 1);
      data.roads.push({ id: road, lanes: ids.length, laneWidth: 12, ends: [{ joint: j0, sign: 1, length: null }, { joint: j1, sign: 1, length: null }], tapers: {} });
      data.joints.push(...(incoming ? [far, mouth] : [mouth, far]).map((p, j) => ({ id: j ? j1 : j0, ...p, dir, root: road, links: [] })));
      ids.forEach((to, lane) => a.links.push({ road, e: incoming ? 1 : 0, lane, to }));
    }
  }
  if (options.markings) {
    data.lines = [{ id: `${id}-line`, on: { intersection: item.id, roundabout: true, approach: 'circulatory', incoming: true, k: 1 }, from: 0.12, to: 0.4, style: 'solid', color: 'yellow' }];
    data.markings = [{ id: `${id}-arrow`, type: 'through', on: { intersection: item.id, approach: 'circulatory', incoming: true, lane: 'circulatory-0' }, back: 30 }];
  }
  return { id, title, note, family, size, data, inputs: describe(item) };
}

function reviewCases() {
  const cases = [];
  const add = (title, note, counts, edit = () => {}, options = {}) => {
    const id = `R${String(cases.length + 1).padStart(3, '0')}`;
    const item = options.source ? stableCopy(options.source, id) : itemFor(id, counts, options.angles);
    edit(item); cases.push(fixture(id, title, note, item, 'review', options));
  };
  const all = (n, out = n) => Array(4).fill([n, out]);
  const mixed = JSON.parse(fs.readFileSync(path.join(__dirname, '../../tests/fixtures/roundabout-mixed-spiral.json')));
  const south = JSON.parse(fs.readFileSync(path.join(__dirname, '../../tests/fixtures/roundabout-lane-add-spiral.json')));
  add('Single-lane baseline', 'Compact default. Check all four entry and exit corners.', all(1));
  add('Two-lane baseline', 'Check lane widths, interior arrows, entry guides and exit connections.', all(2));
  add('Saved mixed-spiral report', 'Preserves the earlier reported geometry, with stable anonymous IDs.', null, () => {}, { source: mixed, keepMouths: true });
  add('Saved southern spiral report', 'Preserves the southern lane-add case and its 20 ft gore; do not silently resize it.', null, () => {}, { source: south, keepMouths: true });
  for (const indices of [[0, 2], [1, 3]]) add(`1x2 pair ${indices.map(i => directions[i]).join('/')}`, 'Two-lane opposite approaches; inspect the transition to each one-lane sector.', all(1).map((pair, i) => indices.includes(i) ? [2, 2] : pair));
  for (let mask = 1; mask < 16; mask++) {
    const selected = directions.filter((_, i) => mask & (1 << i));
    add(`Spiral entries ${selected.join('/')}`, 'Two entry lanes and one exit lane at each named approach; inspect every opening and the lane remaining after each exit.', all(1).map((pair, i) => mask & (1 << i) ? [2, 1] : pair));
  }
  for (const mode of ['auto', 'on', 'off']) add(`Spiral mode ${mode}`, 'Same south two-lane entry. Compare shaped island and guide behavior across the three modes.', [[1, 1], [2, 1], [1, 1], [1, 1]], x => { x.roundabout.spiral = mode; });
  for (const widths of [[12, 18], [14, 16], [16, 16], [18, 12]]) add(`Circulating widths ${widths.join('/')}`, 'Measure perpendicular to each lane. Equal and reversed widths deliberately exercise design checks.', [[1, 1], [2, 1], [1, 1], [1, 1]], x => { x.roundabout.widths = widths; });
  for (const width of [0, 2, 6, 7, 20]) add(`South entry gore ${width} ft`, 'Check the tip, yield gaps, lane centers and guide alignment; widths outside 6–7 ft are deliberate stress inputs.', all(2), x => { x.approaches[1].entryGores = { [x.approaches[1].inLanes[1]]: width }; });
  for (let mask = 1; mask < 16; mask++) add(`Gore placement ${directions.filter((_, i) => mask & (1 << i)).join('/')}`, 'All subsets of approaches with a 6 ft entry gore. No entry lanes are added by the gore.', all(2), x => x.approaches.forEach((a, i) => { if (mask & (1 << i)) a.entryGores = { [a.inLanes[1]]: 6 }; }));
  for (const median of [0, 6, 12, 20, 40]) add(`South median ${median} ft`, 'Check splitter nose and entry alignment without changing lane widths.', [[1, 1], [2, 1], [1, 2], [1, 2]], x => { x.approaches[1].median = median; });
  for (const icd of [120, 140, 160, 180, 200, 300]) add(`Two-lane diameter ${icd} ft`, 'Boundary and out-of-range diameters are intentional; inspect curvature and design checks.', all(2), x => { x.roundabout.icd = icd; });
  for (const speed of [25, 35, 45, 50, 65]) add(`Approach speed ${speed} mph`, 'Use speed-dependent splitter lengths and approach geometry. Inspect long stems and island transitions.', all(2), x => x.approaches.forEach(a => { a.speed = speed; a.splitter = null; a.median = 0; }));
  for (const angles of [[0, 75, 180, 270], [0, 105, 180, 270], [15, 100, 190, 285], [0, 60, 180, 270]]) add(`Skew ${angles.join('/')}`, 'Inspect asymmetric corners, spiral alignment and lane widths at each leg.', [[1, 1], [2, 1], [1, 2], [1, 2]], () => {}, { angles });
  for (const legs of [2, 3, 5, 6]) for (const n of [1, 2]) add(`${legs} legs, ${n} lane(s)`, 'Additional and reduced approach counts. Close angles and overlapping mouths remain visible as test inputs.', Array(legs).fill([n, n]), x => { if (legs > 4) x.roundabout.icd = n === 1 ? 180 : 240; });
  for (const shape of ['oval', 'peanut']) for (const ratio of [1.2, 1.6]) add(`${shape} ratio ${ratio}`, 'Alternative shapes exercise the app; FDM roundabout guidance is circular. Check both ends and the waist.', all(2), x => Object.assign(x.roundabout, { shape, ratio, spiral: 'off', icd: 220 }));
  for (const n of [1, 2]) add(`Attached roads, ${n} lane(s)`, 'Incoming and outgoing roads are linked lane to lane to the east approach. Move the roundabout and inspect the joints.', all(n), () => {}, { attach: true });
  add('Manual circulating markings', 'A yellow longitudinal span and an arrow are attached to the circulating track. Edit geometry, save and reload.', [[1, 1], [2, 1], [1, 2], [1, 2]], () => {}, { markings: true });
  for (const n of [3, 4]) {
    add(`${n} circulating lanes, symmetric`, 'Beyond the main one/two-lane matrix. Preserve and review all design checks.', all(n));
    add(`${n} circulating lanes, mixed`, 'One multi-lane entry; other approaches have one or two lanes. Inspect lane adds and drops.', [[n, 1], [1, 2], [1, n], [1, 1]]);
    add(`${n} circulating lanes, unequal widths`, 'Lane widths are assigned individually, inside to outside.', all(n), x => { x.roundabout.widths = Array.from({ length: n }, (_, j) => j === n - 1 ? 18 : 12 + j); });
    add(`${n} circulating lanes, all entry gores`, 'A 6 ft gore at every entry boundary; inspect distinct yield gaps and lane centers.', all(n), x => x.approaches.forEach(a => { a.entryGores = Object.fromEntries(a.inLanes.slice(1).map(id => [id, 6])); }));
    add(`${n} circulating lanes, forced count`, 'One-lane roads with a manual circulating lane count. Test unused lane markings.', all(1), x => { x.roundabout.lanes = n; });
  }
  return cases;
}

function structuralCases() {
  // Exhaustive labeled E/S/W/N combinations: 8 legal (entry,exit) pairs ^ 4.
  return Array.from({ length: 4096 }, (_, index) => {
    const id = `L${String(index + 1).padStart(4, '0')}`, counts = combinations(8, 4, index).map(i => states[i]);
    const title = counts.map(([i, o], k) => `${directions[k]} ${i}/${o}`).join('  ');
    return fixture(id, title, 'Counts are entry/exit. Default destinations remain automatic. Zero-entry or zero-exit networks are retained as negative cases.', itemFor(id, counts), 'lane-counts');
  });
}
function movementCases() {
  const cases = [];
  // Every subset of R/T/L/U for each of two lanes, at every orientation.
  // Other approaches remain two-lane defaults, exposing downstream effects.
  for (let leg = 0; leg < 4; leg++) for (let inner = 0; inner < 16; inner++) for (let outer = 0; outer < 16; outer++) {
    const id = `M${String(cases.length + 1).padStart(4, '0')}`, item = itemFor(id, Array(4).fill([2, 2])), a = item.approaches[leg];
    const kinds = ['right', 'through', 'left', 'u'], labels = ['R', 'T', 'L', 'U'];
    const label = mask => labels.filter((_, i) => mask & (1 << i)).join('') || 'none';
    [inner, outer].forEach((mask, j) => { a.dest[a.inLanes[j]] = item.approaches.filter(b => mask & (1 << kinds.indexOf(R.turnOf(item, a, b)))).map(b => b.id); });
    cases.push(fixture(id, `${directions[leg]} inside ${label(inner)} / outside ${label(outer)}`,
      'Explicit movement choices on the named entry; all other approaches keep defaults. Empty, crossed and conflicting choices are intentional.', item, 'movements'));
  }
  return cases;
}
module.exports = { reviewCases, structuralCases, movementCases, describe };
