/* Longitudinal line patterns (FDOT 711-001 sheet 2): node --test tests/line-styles.test.cjs */
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../js/line-styles.js');

const dash = (style, extra = {}) => S.stripes({ style, color: 'white', ...extra });

test('sheet 2 line patterns', () => {
  assert.deepEqual(dash('skip').map(s => [s.width, s.dash.on, s.dash.off]), [[6, 10, 30]]);
  assert.deepEqual(dash('dottedGuide').map(s => [s.width, s.dash.on, s.dash.off]), [[6, 2, 4]]);
  assert.deepEqual(dash('dottedExtension').map(s => [s.width, s.dash.on, s.dash.off]), [[12, 2, 2]]);
  assert.deepEqual(dash('dottedExtensionLong').map(s => [s.width, s.dash.on, s.dash.off]), [[6, 6, 10]]);
  assert.deepEqual(dash('dottedInterchange').map(s => [s.width, s.dash.on, s.dash.off]), [[6, 3, 9]]);
  assert.deepEqual(dash('dottedLaneDrop').map(s => [s.width, s.dash.on, s.dash.off]), [[12, 3, 9]]);
  assert.deepEqual(dash('channelizing', { width: 18 }).map(s => [s.width, s.dash]), [[18, null]]);
  // Double lines: 6" lines 4" apart, centers 5" either side.
  assert.deepEqual(S.stripes({ style: 'doubleSolid', color: 'yellow' }).map(s => [s.offset, s.width, s.color]), [[-5, 6, '#ffc72c'], [5, 6, '#ffc72c']]);
  const left = S.stripes({ style: 'solidSkip', color: 'yellow', side: 'left' }), right = S.stripes({ style: 'solidSkip', color: 'yellow', side: 'right' });
  assert.deepEqual(left.map(s => Boolean(s.dash)), [false, true]);
  assert.deepEqual(right.map(s => Boolean(s.dash)), [true, false]);
  assert(S.stripes({ style: 'doubleSkip', color: 'yellow' }).every(s => s.dash?.on === 10 && s.dash.off === 30));
  assert.deepEqual(S.stripes({ style: 'none' }), []);
  // Colors are limited to each style's own (lane drop lines are white only).
  assert.equal(S.stripes({ style: 'dottedLaneDrop', color: 'yellow' })[0].color, '#ffffff');
});

test('contrast variants (sheet 2)', () => {
  // Solid lane line: 1.5" black each side.
  const solid = dash('solid', { contrast: true });
  assert.deepEqual(solid.map(s => [s.color, s.width]), [['#000000', 9], ['#ffffff', 6]]);
  // 10' white, 10' black, 20' gap.
  const skip = dash('skip', { contrast: true });
  assert.deepEqual(skip.map(s => [s.color, s.dash.on, s.dash.off, s.dash.start]), [['#000000', 10, 30, 10], ['#ffffff', 10, 30, 0]]);
  // 3'-9' dotted: 3' white, 3' black, 6' gap, 3' white, 9' gap (period 24').
  const dotted = dash('dottedInterchange', { contrast: true });
  assert.deepEqual(dotted.map(s => [s.color, s.dash.on, s.dash.off, s.dash.start]), [['#000000', 3, 21, 3], ['#ffffff', 3, 9, 0]]);
  // Not on edge lines, and only white lines take contrast.
  assert.equal(dash('solid', { contrast: true }).length, 2);
  assert.equal(S.stripes({ style: 'solid', color: 'white', contrast: true }, { edge: true }).length, 1);
  assert.equal(S.stripes({ style: 'solid', color: 'yellow', contrast: true }).length, 1);
  assert.equal(S.contrastable({ style: 'doubleSolid', color: 'yellow' }), false);
});

test('dash phase follows distance along the chained line', () => {
  const d = S.dashAttributes({ on: 10, off: 30, start: 0 }, 50, 6);
  assert.equal(d.array, '60.000 180.000');
  assert.equal(d.offset, 10 * 6);   // 50 ft along a 40 ft cycle is 10 ft in
  assert.equal(S.dashAttributes({ on: 10, off: 30, start: 10 }, 0, 1).offset, 30);
  assert.equal(S.dashAttributes(null, 0, 1), null);
});
