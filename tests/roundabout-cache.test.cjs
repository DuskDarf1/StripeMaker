const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
globalThis.window=globalThis;globalThis.StripeMaker={};
for(const file of ['assets/markings/symbols.js','assets/markings/font.js'])vm.runInThisContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'));
globalThis.StripeMaker.intersectionGeometry=require('../js/intersection-geometry.js');
require('../js/marking-catalog.js');
const R=require('../js/roundabout-geometry.js');
const fixture=name=>JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures',`roundabout-${name}.json`)));
const capture=x=>{
 const L=R.layout(x);
 return {valid:R.validate(x),outline:R.outline(x),surfaces:R.surfaces(x),paint:R.markings(x),
  edges:Array.from({length:36},(_,i)=>L.laneEdges(i*Math.PI/18)),tracks:R.tracks(x),
  paths:x.approaches.flatMap(a=>a.inLanes.flatMap((lane,j)=>R.destinations(x,a,lane).map(id=>R.path(x,a,j,x.approaches.find(b=>b.id===id))))) };
};
const compare=(a,b,where='geometry')=>{
 if(typeof a==='number' && typeof b==='number') {assert.ok(Math.abs(a-b)<1e-8 || Object.is(a,b),`${where}: ${a} != ${b}`);return;}
 if(a && typeof a==='object') {
  assert.deepEqual(Object.keys(a),Object.keys(b),where);
  for(const key of Object.keys(a))compare(a[key],b[key],`${where}.${key}`);
 }else assert.equal(a,b,where);
};
test('incremental geometry equals a fresh solve after curve, lane, movement, shape and undo edits',()=>{
 for(const name of ['sarasota','double-left-spiral','oneway-exit-paths','close-entries']) {
  const x=R.normalize(fixture(name));capture(x);
  const before=R.snapshot(x);
  const edits=[
   x=>{const a=x.approaches.at(-1);R.setApproachSideBezier(x,a,'entry',{x:-0.3,y:0.2});},
   x=>{const a=x.approaches[0];R.setApproachSideBezier(x,a,'exit',{x:0.2,y:0.1});},
   x=>{x.approaches[0].yieldSetback=10;},
   x=>{x.approaches[0].yieldSetback=0;},
   x=>{x.roundabout.laneWidth=14;},
   x=>{x.roundabout.shape='oval';x.roundabout.ratio=1.3;},
   x=>{x.roundabout.shape='peanut';},
   x=>{const a=x.approaches[0];a.dest={[a.inLanes[0]]:[x.approaches[1].id]};},
   x=>{x.approaches[0].incoming=4;},
   x=>{x.approaches.reverse();},
   x=>{for(const key of Object.keys(x))delete x[key];Object.assign(x,structuredClone(before));},
  ];
  for(const [i,edit] of edits.entries()) {
   edit(x);R.normalize(x);
   compare(capture(x),capture(structuredClone(x)),`${name} edit ${i}`);
  }
  // Editing the live record must never change the drag's starting geometry.
  compare(capture(before),capture(structuredClone(before)),`${name} snapshot`);
 }
});
test('unrelated entry edits reuse the circulating ring and unaffected approach geometry',()=>{
 const x=R.normalize(fixture('sarasota')),L=R.layout(x),a=x.approaches[2];R.markings(x);R.tracks(x);
 R.setApproachSideBezier(x,a,'entry',{x:-0.1,y:0});
 const next=R.layout(x);
 assert.equal(next.outer,L.outer);assert.equal(next.inner,L.inner);
 assert.equal(next.legs.get(x.approaches[0].id),L.legs.get(x.approaches[0].id));
 compare(capture(x),capture(structuredClone(x)));
});
