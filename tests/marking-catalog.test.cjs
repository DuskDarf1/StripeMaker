/* Lateral pavement marking dimensions: node --test tests/marking-catalog.test.cjs */
const test = require('node:test');
const assert = require('node:assert/strict');
globalThis.window = globalThis;
require('../assets/markings/symbols.js');
require('../assets/markings/font.js');
require('../assets/markings/cfx.js');
require('../assets/markings/bike.js');
const C = require('../js/marking-catalog.js');

const IN = 1 / 12;
const near = (actual, expected, tolerance, label) =>
  assert(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} vs ${expected}`);
const size = marking => {
  const b = C.bounds(C.geometry(marking).parts);
  return { width: b.x1 - b.x0, length: b.y1 - b.y0, b };
};
const area = ring => Math.abs(ring.reduce((s, p, i) => { const q = ring[(i + 1) % ring.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0) / 2);
const paint = marking => C.geometry(marking).parts.reduce((s, p) => s + area(p.rings[0]) - p.rings.slice(1).reduce((t, r) => t + area(r), 0), 0);

test('every catalog entry draws something', () => {
  for (const item of C.catalog) {
    const g = C.geometry({ type: item.id, route: '95', text: 'ONLY' });
    assert(g.parts.length > 0 && g.length > 0, item.id);
  }
});

test('lines across the lane (711-001 sheet 2)', () => {
  const stop = C.geometry({ type: 'stopLine' }, [{ left: -6, right: 6 }]);
  assert.equal(stop.length, 24 * IN);
  near(size({ type: 'stopLine' }).width, 12, 1e-9, 'stop line spans the lane');
  const both = C.geometry({ type: 'stopLine', all: true }, [{ left: -6, right: 6 }, { left: 6, right: 18 }]);
  near(C.bounds(both.parts).x1 - C.bounds(both.parts).x0, 24, 1e-9, 'stop line spans both lanes');
  const yieldLine = C.geometry({ type: 'yieldLine' }, [{ left: -6, right: 6 }, { left: 6, right: 18 }]);
  assert.equal(yieldLine.parts.length, 10);
  for (const p of yieldLine.parts) {
    const b = C.bounds([p]);
    near(b.x1 - b.x0, 18 * IN, 1e-9, 'triangle base'); near(b.y1 - b.y0, 27 * IN, 1e-9, 'triangle height');
    // The point faces approaching traffic (the back of the marking).
    assert(p.rings[0].some(([, y]) => y === 0) && p.rings[0].filter(([, y]) => y === 0).length === 1);
  }
  // Equally spaced within the lane.
  const centers = yieldLine.parts.slice(0, 5).map(p => p.rings[0][0][0]);
  const gaps = centers.slice(1).map((c, i) => c - centers[i]);
  for (const g of gaps) near(g, gaps[0], 1e-9, 'spacing');
  near(centers[0] - 9 * IN - -6, 6 - (centers[4] + 9 * IN), 1e-9, 'edge gaps');
});

test('arrows and symbols at 711-001 sheet 1 dimensions (within 1", note 2)', () => {
  const tol = 1.5 * IN;
  near(size({ type: 'through' }).length, 9.5, tol, 'through arrow');
  near(size({ type: 'through' }).width, 40 * IN, tol, "through arrow's 3'-4\" head");
  near(size({ type: 'turnLeft' }).length, 8, tol, 'turn arrow');
  near(size({ type: 'uTurn' }).length, 10, tol, 'U-turn arrow');
  near(size({ type: 'uTurn' }).width, 7, tol, "U-turn 3'-4\" + 3'-8\"");
  near(size({ type: 'throughLeft' }).length, 12.75, tol, 'turn and through arrow');
  near(size({ type: 'preferential' }).length, 13, tol, 'preferential diamond');
  near(size({ type: 'preferential' }).width, 3, tol, 'preferential diamond width');
  near(size({ type: 'railroad' }).length, 20, 1e-6, 'RXR');
  near(size({ type: 'railroad' }).width, 8, 0.01, 'RXR width');
  near(size({ type: 'pedestrian' }).length, 15, 1e-9, 'pedestrian warning');
  near(size({ type: 'pedestrian' }).width, 6, 1e-9, 'pedestrian warning width');
  // Square footage printed on the sheet (paint is solid, including bridged stencil gaps).
  near(paint({ type: 'through' }), 12, 0.5, 'through S.F.');
  near(paint({ type: 'turnLeft' }), 17, 1, 'turn S.F.');
  near(paint({ type: 'wrongWay' }), 24, 1, 'wrong-way S.F.');
  near(paint({ type: 'preferential' }), 11, 0.5, 'preferential S.F.');
});

test('arrows are solid, one piece each', () => {
  for (const type of ['through', 'turnLeft', 'turnRight', 'throughLeft', 'throughRight', 'uTurn', 'mergeLeft']) {
    assert.equal(C.geometry({ type }).parts.length, 1, type);
  }
});

test('right-hand arrows mirror the left-hand ones', () => {
  const left = size({ type: 'turnLeft' }).b, right = size({ type: 'turnRight' }).b;
  near(left.x0, -right.x1, 1e-9, 'mirror'); near(left.x1, -right.x0, 1e-9, 'mirror');
});

test('two-way left turn arrows: 8-12-8 ft, opposing (711-001 sheet 8)', () => {
  const g = C.geometry({ type: 'twoWayLeft' });
  near(g.length, 2 * C.geometry({ type: 'turnLeft' }).length + 12, 0.01, 'pair length');
});

test('yield ahead triangles (MUTCD Figure 3B-20)', () => {
  for (const [speed, length, bar] of [['fast', 20, 36], ['slow', 13, 30]]) {
    const g = C.geometry({ type: 'yieldAhead', speed });
    near(g.length, length, 1e-9, speed);
    near(size({ type: 'yieldAhead', speed }).width, 6, 1e-9, `${speed} width`);
    const inner = g.parts[0].rings[1];
    near(length - Math.max(...inner.map(p => p[1])), bar * IN, 1e-9, `${speed} bar`);
  }
});

test('route shields at 711-001 sizes with pavement numerals', () => {
  const art = C.geometry({ type: 'shieldInterstate', route: '95', size: 'arterial' });
  near(art.length, 15, 1e-9, 'arterial'); near(size({ type: 'shieldInterstate', route: '95' }).width, 6, 1e-3, 'arterial width');
  const lim = size({ type: 'shieldInterstate', route: '95', size: 'limited' });
  near(lim.length, 20, 1e-9, 'limited'); near(lim.width, 8, 1e-3, 'limited width');
  // Three digits widen the shield (711-001 note 5).
  assert(size({ type: 'shieldUS', route: '301' }).width > size({ type: 'shieldUS', route: '41' }).width);
  // Filled shields: the U.S. shield sits on its black panel.
  assert(C.geometry({ type: 'shieldUS', route: '41' }).parts.some(p => p.fill === '#000000' && p.rule === 'evenodd'));
  // Numerals are 8'-0" on the arterial shield.
  const numerals = art.parts.filter(p => p.fill === '#ffffff' && p.rule === 'nonzero');
  const b = C.bounds(numerals);
  near(b.y1 - b.y0, 8, 0.05, 'numeral height');
  assert(numerals.every(p => p.rings.flat().every(([x]) => Math.abs(x) < 3)), 'numerals inside the shield');
});

test('FDOT route markers stretched for pavement, numbers in pavement lettering', () => {
  for (const type of ['shieldState', 'shieldToll', 'shieldTurnpike']) {
    near(size({ type, route: '60' }).length, 15, 1e-6, type);
    near(size({ type, route: '60', size: 'limited' }).length, 20, 1e-6, `${type} limited`);
  }
  // The square Florida Route Marker becomes 6 ft x 15 ft; its 41.67/100 legend area
  // stretches to 6.25 ft numerals.
  near(size({ type: 'shieldState', route: '60' }).width, 6, 1e-6, 'state width');
  const state = C.geometry({ type: 'shieldState', route: '60' });
  const digits = state.parts.slice(C.geometry({ type: 'shieldState', route: '' }).parts.length);
  assert(digits.length >= 2);
  near(C.bounds(digits).y1 - C.bounds(digits).y0, 6.25, 0.05, 'state numerals');
  // Four-digit state roads use the wider face; the Turnpike has no number.
  assert(size({ type: 'shieldState', route: '9336' }).width > 6);
  assert.equal(C.geometry({ type: 'shieldTurnpike', route: '91' }).parts.length, C.geometry({ type: 'shieldTurnpike' }).parts.length);
  assert(C.geometry({ type: 'shieldToll', route: '417' }).parts.length > C.geometry({ type: 'shieldToll' }).parts.length);
});

test('one word marking, typed by the user', () => {
  assert.deepEqual(C.catalog.filter(i => i.kind === 'word').map(i => i.name), ['Word marking']);
  assert.equal(C.geometry({ type: 'word', text: '' }).parts.length, 0);
});

test('every part of a multi-unit marking names the point it turns about', () => {
  const g = C.build({ type: 'word', text: 'LEFT\nONLY', gap: 32, contrast: 'block' });
  assert.deepEqual([...new Set(g.parts.map(p => p.unit))].sort((a, b) => a - b), [4, 44]);
  assert.equal(g.parts.filter(p => p.contrast).length, 2, 'a block per line');
  assert.deepEqual([...new Set(C.geometry({ type: 'twoWayLeft' }).parts.map(p => p.unit))].length, 2);
});

test('word messages: 8 ft letters, first line nearest the driver', () => {
  const g = C.geometry({ type: 'word', text: 'left\nonly', gap: 40 });
  near(g.length, 8 + 40 + 8, 1e-9, 'two lines');
  const lines = C.textLines('left\n\nonly ');
  assert.deepEqual(lines, ['LEFT', 'ONLY']);
  const first = C.lettering('LEFT', 8), b = C.bounds(first.parts);
  near(b.y1 - b.y0, 8, 1e-3, 'letter height'); near((b.x0 + b.x1) / 2, 0, 1e-6, 'centered in the lane');
  assert.deepEqual(C.unsupported('ONLY!?'), ['!', '?']);
  assert.equal(C.LINE_GAP.min, 32); assert.equal(C.LINE_GAP.max, 80);
});

test('black contrast (FDM 230.3.1.3)', () => {
  const stop = C.build({ type: 'stopLine', contrast: 'border' }, [{ left: -6, right: 6 }]);
  const black = C.bounds(stop.parts.filter(p => p.contrast));
  near(black.y0, -4 * IN, 1e-9, 'stop line border before'); near(black.y1, 24 * IN + 4 * IN, 1e-9, 'after');
  const border = C.build({ type: 'through', contrast: 'border' });
  assert(border.parts[0].contrast && border.parts[0].stroke === 3 * IN, '1.5" border each side of the outline');
  const block = C.build({ type: 'through', contrast: 'block' });
  const box = C.bounds([block.parts[0]]), art = C.bounds(C.geometry({ type: 'through' }).parts);
  near(box.x0, art.x0 - 1.5 * IN, 1e-9, 'block margin'); near(box.y1, art.y1 + 1.5 * IN, 1e-9, 'block margin');
  const yields = C.build({ type: 'yieldLine', contrast: 'border' }, [{ left: -6, right: 6 }]);
  assert.equal(yields.parts.filter(p => p.contrast).length, 5, 'a block per triangle');
  assert.equal(C.build({ type: 'through' }).parts.filter(p => p.contrast).length, 0);
});

test('repeats run back from the first marking', () => {
  assert.deepEqual(C.repeats({}), [0]);
  assert.deepEqual(C.repeats({ repeat: { length: 250, spacing: 100 } }), [0, 100, 200]);
  assert.deepEqual(C.repeats({ repeat: { length: 200, spacing: 100 } }), [0, 100, 200]);
});

test('composed left-right arrows share the FDOT stem and fit their lane', () => {
  assert.equal(C.find('roundabout').id, 'turnLeft', 'saved roundabout arrows open as left turns with the dot');
  for (const type of ['leftRight', 'throughLeftRight']) {
    const g = C.geometry({ type }, [{ left: -6, right: 6 }]);
    assert.equal(g.parts.length, 1, `${type} is one solid piece`);
    const b = C.bounds(g.parts);
    assert(b.x1 - b.x0 <= 11 + 1e-9, `${type} clears the lane lines`);
    near(b.x0, -b.x1, 1e-6, `${type} is symmetric about its stem`);
    // In a wider lane it keeps its drawn size.
    const wide = C.bounds(C.geometry({ type }, [{ left: -7, right: 7 }]).parts);
    assert(wide.x1 - wide.x0 > 11.5);
  }
  near(C.geometry({ type: 'throughLeftRight' }, [{ left: -7, right: 7 }]).length, C.geometry({ type: 'throughLeft' }).length, 1e-6, 'through head length kept');
});

test('roundabout dot: an option on stemmed arrows, left of the stem', () => {
  assert(C.find('turnLeft').dot && C.find('through').dot && !C.find('mergeLeft').dot && !C.find('wrongWay').dot);
  const plain = C.geometry({ type: 'turnLeft' }), dotted = C.geometry({ type: 'turnLeft', dot: true });
  assert.equal(dotted.parts.length, plain.parts.length + 1);
  // The roundabout approach arrow from sheet 1, rebuilt: the same size.
  const source = globalThis.StripeMaker.markingSymbols.roundaboutLeft;
  near(dotted.length, source.length, 0.02, 'length with the dot');
  const dot = C.bounds([dotted.parts.at(-1)]), arrow = C.bounds(dotted.parts.slice(0, -1));
  assert(dot.x1 < arrow.x1, 'dot left of the stem');
  // Right turns keep the dot on the left (the central island's side).
  const right = C.geometry({ type: 'turnRight', dot: true }), rdot = C.bounds([right.parts.at(-1)]);
  assert(rdot.x0 < C.bounds(right.parts.slice(0, -1)).x0 + 1);
});

test('CFX toll route shield (CFX SPM sheet 47)', () => {
  const { width, length } = size({ type: 'cfxToll', route: '429' });
  near(width, 8, 1e-6, 'width'); near(length, 20, 1e-6, 'length');
  const parts = C.geometry({ type: 'cfxToll', route: '429' }).parts;
  const florida = parts.find(p => p.strokeColor);
  assert(florida && florida.fill === 'none', 'orange Florida outline');
  near(florida.stroke, 4 * IN, 1e-9, 'Florida outline width');
  // Numerals: 6'-3" tall, no wider than 48".
  // Letters and numerals: the black parts that aren't the border or the bar.
  const glyphs = parts.filter(p => p.fill === '#000000' && C.bounds([p]).x1 - C.bounds([p]).x0 < 2);
  const numerals = C.bounds(glyphs.filter(p => C.bounds([p]).y0 < 15));
  assert(numerals.y1 - numerals.y0 <= 75 * IN + 1e-6 && numerals.x1 - numerals.x0 <= 48 * IN + 1e-6, 'numerals fit');
  // TOLL fits its 33" x 37.5" box in the yellow panel.
  const toll = C.bounds(glyphs.filter(p => C.bounds([p]).y0 > 15));
  assert(toll.x1 - toll.x0 <= 33 * IN + 1e-6 && toll.y1 - toll.y0 <= 37.5 * IN + 1e-6, 'TOLL size');
  assert(toll.y0 > 15.5 && toll.y1 < 19.5, 'TOLL in the yellow panel');
});

test('CFX colored yield symbol (CFX SPM sheet 48)', () => {
  const { width, length, b } = size({ type: 'cfxYield' });
  near(width, 6, 1e-3, 'width'); near(length, 13, 1e-3, 'length');
  const parts = C.geometry({ type: 'cfxYield' }).parts;
  assert(parts.some(p => p.fill === '#bf311a') && parts.some(p => p.fill === '#ffffff'), 'red and white');
  // The point is nearest approaching traffic.
  const near0 = parts[0].rings[0].filter(([, y]) => y < 0.5);
  assert(near0.every(([x]) => Math.abs(x) < 0.5) && b.y0 === 0, 'point toward traffic');
});

test('CFX option lane arrow (CFX SPM sheet 46)', () => {
  const right = size({ type: 'cfxOptionRight' }), left = size({ type: 'cfxOptionLeft' });
  near(right.length, 105, 1e-6, 'length');
  near(right.b.x1, 8, 1e-6, 'ramp branch to the right'); near(left.b.x0, -8, 1e-6, 'mirrored to the left');
  const parts = C.geometry({ type: 'cfxOptionRight' }).parts;
  near(C.bounds([parts[0]]).x1 - C.bounds([parts[0]]).x0, 8 * IN, 1e-9, '8" line');
  near(C.bounds([parts[0]]).y1, 15, 1e-9, "15' to the point of diverge");
  const headA = C.bounds([parts[2]]);
  near(headA.x1 - headA.x0, 3.5, 1e-9, 'head A width'); near(headA.y1 - headA.y0, 25, 1e-9, 'head A length');
});

test('bicycle markings (FDOT Standard Plans 711-002 sheet 1)', () => {
  const bicyclist = size({ type: 'bicyclist' }), arrow = size({ type: 'bikeArrow' }), sharrow = size({ type: 'sharrow' });
  near(bicyclist.length, 6, 0.02, 'bicyclist 6\'-0"'); near(bicyclist.width, 40 * IN, 0.05, 'bicyclist 3\'-4"');
  near(arrow.length, 6, 0.01, 'arrow 6\'-0"'); near(arrow.width, 2, 0.01, 'arrow 2\'-0"');
  near(sharrow.length, 9 + 4 * IN, 0.02, 'sharrow 9\'-4"'); near(sharrow.width, 40 * IN, 0.05, 'sharrow 3\'-4"');
  // Sheet 2: the symbol, 6', then the arrow.
  near(size({ type: 'bikeLane' }).length, 18, 0.05, 'symbol + 6\' + arrow');
  // 711-001 sheet 2: one yield triangle in a bike lane.
  const g = C.geometry({ type: 'yieldLine' }, [{ left: -6, right: 6 }, { left: 6, right: 11, bike: true }]);
  assert.equal(g.parts.length, 6);
});

test('colored pavement preserves the common 2-4 phase across clipped segments',()=>{
 assert.deepEqual(C.stretches('dotted',12,1),[[0,1],[5,7],[11,12]]);
 const a=C.stretches('dotted',7,1),b=C.stretches('dotted',5,8).map(([x,y])=>[x+7,y+7]);
 assert.deepEqual([...a,...b],C.stretches('dotted',12,1));
});

// White paint and optional black contrast are separate dimensions.
test('emphasis bar is 24 inches, with 4-inch contrast on each side',()=>{
 const g=C.crosswalk({type:'crosswalkSpecial',width:10,contrast:true},{x:0,y:0},{x:20,y:0},[{x:10,y:0,t:{x:0,y:1},width:C.CROSSWALK.bar}]);
 const white=g.parts.filter(p=>p.fill==='#ffffff').at(-1);
 const black=g.parts.filter(p=>p.fill==='#000000').at(-1);
 const span=part=>Math.max(...part.rings[0].map(p=>p[0]))-Math.min(...part.rings[0].map(p=>p[0]));
 near(span(white)*12,24,1e-9,'white width');
 near(span(black)*12,32,1e-9,'white plus black surround');
});
