const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');const src=fs.readFileSync('js/elements.js','utf8');const cut=(a,b)=>src.slice(src.indexOf(a),src.indexOf(b));
const ctx=vm.createContext({window:{StripeMaker:{roadWidths:require(process.cwd()+'/js/road-widths.js')}},console});
let code=cut('  const LINE_INCHES','  document.addEventListener')+cut('    const inchesToPixels','    function layerFor')+'function layerFor(){}\n'+cut('    function solve(','    // Where a lane node is drawn')+cut('    const shapeOffset=','    function strokePath')+cut('    function wideTurnHosts(','    function joinedPolygons(')+cut('    function laneLinks(','    // Bike lane keyholes')+'const polylineLength=p=>p.slice(1).reduce((a,v,i)=>a+Math.hypot(v.x-p[i].x,v.y-p[i].y),0);';
code+=cut('    function medianEdgeCuts(','    function wideTurnHosts(')+cut('    const CONFLICT_SAMPLE_FEET','    // Colored pavement split at a cut')+cut('    function insidePolygon(',"    // A road's centerline (a two-way");
vm.runInContext(code,ctx);ctx.sheet=JSON.parse(fs.readFileSync('tests/fixtures/bike-driveway-conflicts.json'));


const result=vm.runInContext(`(()=>{
 const solved=solve(sheet),road=sheet.roads.find(r=>r.id===10),shape=shapeOf(sheet,road,solved);
 const ranges=bikeConflicts(sheet,road,shape,solved);
 return {ranges:[...ranges],wide:laneStrip({line:[{x:0,y:0},{x:100,y:0}],laneBounds:[[[0,5]],[[0,5]]],pavementEdges:{1:[{x:0,y:9},{x:100,y:12}]}},0,0,100)};
})()`,ctx);
assert(result.ranges.length===2,'both bike edges detect the detached driveway crossings');
assert(result.ranges.every(([k,ranges])=>ranges.some(r=>r[2]==='dotted'&&r[0]>.3)),'lower bike lane has dotted conflict ranges');
assert(result.wide.some(p=>p.y===12),'green strip follows the widened drawn boundary, not stale lane width');
ctx.window.StripeMaker.levels={levelAt:(_,p,id)=>id===10?2:1};
assert.equal(vm.runInContext('(()=>{const s=solve(sheet),r=sheet.roads.find(r=>r.id===10);return bikeConflicts(sheet,r,shapeOf(sheet,r,s),s).size})()',ctx),0,'grade-separated crossings are not conflicts');
console.log('PASS: supplied lower bike lane detects driveway conflicts, widened fill follows its edge, and bridges do not create false conflicts.');
const fills=vm.runInContext(`(()=>{
 const sh={line:[{x:0,y:0},{x:100,y:0}],laneBounds:[[[0,5]],[[0,5]]]};
 const r={lanes:1,laneTypes:{0:{type:'bike',width:5}}},s={inchesPerPixel:12};
 return {green:surfaceStrip(s,r,sh,0,0,100,'green'),red:surfaceStrip(s,r,sh,0,0,100,'red')};
})()`,ctx);
assert.equal(Math.min(...fills.green.map(p=>p.y)),-8/12,'green reaches left pavement edge');
assert.equal(Math.max(...fills.green.map(p=>p.y)),5+8/12,'green reaches right pavement edge');
assert.equal(Math.min(...fills.red.map(p=>p.y)),0,'non-bike treatment keeps its lane bounds');
assert.equal(Math.max(...fills.red.map(p=>p.y)),5);
console.log('PASS: detached bike green fill covers both pavement aprons; other surface colors are unchanged.');
const edges=vm.runInContext(`(()=>{
 const s={inchesPerPixel:12},r={lanes:1,laneTypes:{0:{type:'bike'}}};
 const plain=[0,1].map(side=>bikePavementExtra(s,r,{},0,side));
 const virtual=[0,1].map(side=>bikePavementExtra(s,r,{bikeEdges:{0:[],1:[]}},0,side));
 const beside={lanes:2,laneTypes:{1:{type:'bike'}}};
 return {plain,virtual,beside:[0,1].map(side=>bikePavementExtra(s,beside,{},1,side))};
})()`,ctx);
assert.equal(edges.plain[0],Math.min(...fills.green.map(p=>p.y)),'left white conflict centerline follows green outer edge');
assert.equal(5+edges.plain[1],Math.max(...fills.green.map(p=>p.y)),'right white conflict centerline follows green outer edge');
assert.deepEqual(Array.from(edges.virtual),[0,0],'weaving crossover keeps its existing shared geometry');
assert.equal(edges.beside[0],0,'travel-lane separator stays in place');
console.log('PASS: white conflict stripes and green fill share exposed edges without shifting interior or virtual crossover boundaries.');
const approaches=vm.runInContext(`(()=>{
 const check=mixed=>{
  const road={id:1,lanes:mixed?2:1,laneWidth:12,ends:[{joint:1,sign:1},{joint:2,sign:1}],laneTypes:{[mixed?1:0]:{type:'bike',width:5}}};
  const s={inchesPerPixel:12,roads:[road],joints:[{id:1,x:0,y:0,links:[]},{id:2,x:1000,y:0,links:[]}],
   intersections:[{approaches:[{width:12,inLanes:['bike'],outLanes:[],links:[{road:1,e:1,lane:mixed?1:0,to:'bike'}]}]}]};
  const solved=solve(s);return [...bikeConflicts(s,road,shapeOf(s,road,solved),solved)];
 };
 return {independent:check(false),besideTraffic:check(true)};
})()`,ctx);
assert.equal(approaches.independent.length,0,'independent bike roads do not inherit an adjacent-traffic intersection merge');
assert.equal(approaches.besideTraffic.length,1,'bike lanes beside motor traffic retain the approach treatment');
assert.equal(approaches.besideTraffic[0][0],1);
assert.deepEqual(Array.from(approaches.besideTraffic[0][1][0]),[.85,1,'dotted'],'the existing 150 ft approach remains on a mixed road');
console.log('PASS: independent bike approaches stay solid; mixed-road bike lanes retain their 150 ft merge treatment.');
