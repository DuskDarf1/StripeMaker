const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('js/elements.js', 'utf8');
const start = source.indexOf('    function bikeTransitionLinks(');
const end = source.indexOf('    function bikeTransitions(', start);
const context = vm.createContext({
  laneLinks: (sheet, joint) => joint.links,
  bikeType: (road, lane) => road.laneTypes?.[lane]?.type,
});
vm.runInContext(source.slice(start, end), context);
const from = { lanes: 4, laneTypes: { 3: { type: 'bike', conflict: 'drop' } } };
const to = { lanes: 5, laneTypes: { 3: { type: 'bike' } } };
const anchor = { from, to, fromLane: 1, toLane: 2 };
const links = context.bikeTransitionLinks({}, { links: [anchor] });
assert.equal(links.length, 2);
assert.equal(links[1].fromLane, 3);
assert.equal(links[1].toLane, 3);
assert.equal(anchor.fromLane, 1); // Detection must preserve the physical joint.
from.laneTypes[3].conflict = 'auto';
assert.equal(context.bikeTransitionLinks({}, { links: [anchor] }).length, 1);
from.laneTypes[3].conflict = 'drop';
const explicit = { from, to, fromLane: 3, toLane: 3 };
assert.equal(context.bikeTransitionLinks({}, { links: [anchor, explicit] }).length, 2);
console.log('PASS: bike drop follows shifted lane alignment without changing joint links.');
// Transition edges must retain one sample per centerline station, including
// at the crossover, because stationSlice pairs them by index.
const transitionStart = source.indexOf('    function bikeTransitions(');
const transitionEnd = source.indexOf('    function bikeMarkingShape(', transitionStart);
const transitionSource = source.slice(transitionStart, transitionEnd);
assert.match(transitionSource, /bikeEdges\[lane\+side\]=edge\.map/);
assert.match(transitionSource, /const blend=entering\?1-progress:progress/);
assert.doesNotMatch(transitionSource, /const eased=/);
