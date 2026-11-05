const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {test}=require('node:test');
const source=fs.readFileSync('js/markings.js','utf8');
const prepareSource=source.slice(source.indexOf('    function prepare('),source.indexOf('    const trackGeometryKey'));
const atSource=source.slice(source.indexOf('    function at('),source.indexOf('    // The track and lane under'));
const locateSource=source.slice(source.indexOf('    function locate('),source.indexOf('    // A marking\'s drawn shapes.'));
const edgeSource=source.slice(source.indexOf('    function boundaryLine('),source.indexOf('    const lengthOf'));

function hitContext(unbounded=false) {
 const context=vm.createContext({tracks:new Map(),ensureTracks(){}});
 vm.runInContext(prepareSource+atSource+locateSource,context);
 const at=context.at;context.atCalls=0;context.at=(...args)=>{context.atCalls++;return at(...args);};
 context.add=track=>{const ready=context.prepare(track);if(unbounded){delete ready.pickBounds;delete ready.pickPadding;}context.tracks.set(ready.key,ready);};
 return context;
}
const summarize=hit=>hit&&{key:hit.track.key,lane:hit.lane,d:hit.d,distance:hit.distance};
test('conservative lane-hit bounds retain exact picks through curves, varying widths and overlaps',()=>{
 const bounded=hitContext(),unbounded=hitContext(true);
 let seed=7331;const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/2**32);
 const points=[];
 for(let road=0;road<18;road++) {
  const line=Array.from({length:15},(_,i)=>({x:(road%6)*140+i*7,y:Math.floor(road/6)*130+Math.sin(i/3+road)*35}));
  if(road%3===0)line[6]={...line[5]};
  const bounds=line.map((_,i)=>[[-18-i*.2,-6],[-6,6],[6,18+i*.3]]);
  const track={key:`r:${road}`,on:{road},line,bounds};bounded.add(track);unbounded.add(track);
  for(const p of line)for(const delta of [-25,-18,-6,0,6,18,25])points.push({x:p.x+delta*.2,y:p.y+delta});
 }
 points.push(...Array.from({length:300},()=>({x:random()*1000-100,y:random()*500-100})));
 for(const point of points)assert.deepEqual(summarize(bounded.locate(point)),summarize(unbounded.locate(point)),JSON.stringify(point));
 assert(bounded.atCalls<unbounded.atCalls/4,'distant segments avoid constructing interpolated lane frames');
});

function edgesContext(legacy=false) {
 let boundaryReads=0,leftSamples=0;
 const context=vm.createContext({tracks:new Map(),ppf:s=>12/s.inchesPerPixel,
  trackGeometryKey:s=>JSON.stringify([s.inchesPerPixel,s.autoTapers,s.roads,s.joints,s.intersections]),
  app:{intersections:{boundaries:s=>{boundaryReads++;return {edges:[Object.assign([{x:s.intersections[0].x,y:10},{x:20,y:15}],{on:{intersection:1,side:'median'}})]};}}}});
 let code=edgeSource;
 if(legacy)code=code.replace('const leftEdges=new Map(roads.map(track=>[track,boundaryLine(track,0)]));','')
  .replace('const p = leftEdges.get(track)[0], q = leftEdges.get(other).at(-1);','const p = boundaryLine(track, 0)[0], q = boundaryLine(other, 0).at(-1);')
  .replace('(k===0?leftEdges.get(track):boundaryLine(track,k))','boundaryLine(track,k)');
 vm.runInContext(code,context);
 const boundaryLine=context.boundaryLine;context.boundaryLine=(track,k)=>{if(k===0)leftSamples++;return boundaryLine(track,k);};
 context.counts=()=>({boundaryReads,leftSamples});return context;
}
test('crosswalk edge reuse preserves paired-road edges and invalidates geometry and track changes',()=>{
 const fast=edgesContext(),legacy=edgesContext(true),sheet={inchesPerPixel:12,roads:[],joints:[],intersections:[{id:1,x:0}]};
 for(let i=0;i<40;i++) {
  const reverse=i===1,line=Array.from({length:30},(_,j)=>({x:reverse?290-j*10:j*10,y:i<2?0:i*35+Math.sin(j/3)*5}));
  const track={on:{road:i},line,count:2,bounds:line.map(()=>[[0,12],[12,24]]),tangents:line.map(()=>({x:reverse?-1:1,y:0}))};
  fast.tracks.set(i,track);legacy.tracks.set(i,track);
 }
 const solved={},expected=legacy.pavementEdges(sheet),actual=fast.pavementEdges(sheet,solved);
 assert.deepEqual(structuredClone(actual),structuredClone(expected));
 assert.equal(fast.counts().leftSamples,40,'each road left boundary is sampled once');
 assert(legacy.counts().leftSamples>1000,'fixture exercises the quadratic reference sampling');
 assert.equal(fast.pavementEdges(sheet),actual,'hover reuses the preceding draw edges without a solved argument');
 assert.equal(fast.pavementEdges(sheet,solved),actual);
 sheet.signs=[{id:'unrelated'}];assert.equal(fast.pavementEdges(sheet),actual);
 assert.equal(fast.counts().boundaryReads,1);
 sheet.intersections[0].x=12;const edited=fast.pavementEdges(sheet);
 assert.notEqual(edited,actual);assert.equal(edited.at(-1).points[0].x,12);
 sheet.joints.push({id:1,x:10,y:20});assert.notEqual(fast.pavementEdges(sheet),edited);
 const before=fast.counts().boundaryReads;fast.tracks=new Map(fast.tracks);fast.pavementEdges(sheet);
 assert.equal(fast.counts().boundaryReads,before+1,'fresh track collections invalidate edge samples');
});
