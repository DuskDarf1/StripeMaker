const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('js/elements.js', 'utf8');
const context = vm.createContext({ CURVE_SEGMENTS: 64, unit: p => {const n=Math.hypot(p.x,p.y);return {x:p.x/n,y:p.y/n};} });
vm.runInContext(source.slice(source.indexOf('    function bezier('), source.indexOf('    // Positive distances offset')),context);
// A tight driveway turn. Position and tangent must describe the same smooth
// curve; interpolating coarse chords while rotating normals violates this.
const points = context.bezier({x:0,y:0},{x:80,y:0},{x:100,y:20},{x:100,y:100},true);
let worst = 0;
for(let i=1;i<points.length-1;i++) {
 const a=points[i-1],b=points[i+1],p=points[i];
 const angle=Math.atan2(b.y-a.y,b.x-a.x);
 const tangent=Math.atan2(p.tangent.y,p.tangent.x);
 worst=Math.max(worst,Math.abs(angle-tangent));
}
assert(worst<0.001,`Position/tangent disagreement: ${worst} radians`);
assert.deepEqual(JSON.parse(JSON.stringify(points[0].tangent)),{x:1,y:0});
assert.deepEqual(JSON.parse(JSON.stringify(points.at(-1).tangent)),{x:0,y:1});
console.log('PASS: tight-turn curve samples agree with their normals and preserve endpoint alignment.');
