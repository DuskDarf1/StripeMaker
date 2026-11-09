const {test}=require('node:test');
const assert=require('node:assert/strict');
const {validate}=require('../js/project-json.js');
const sample=()=>({format:'StripeMakerProject',version:1,selectedSheet:1,settings:{},shortcuts:{},sheets:[{id:1,width:30000,height:30000,file:{name:'blank.png',base64:'AAAA'},data:{name:'Test',blank:true,width:30000,height:30000,inchesPerPixel:2,view:{x:0,y:0,scale:1},roads:[{id:1,lanes:2,laneWidth:12,ends:[{joint:1,sign:1},{joint:2,sign:1}],laneTypes:{1:{type:'bufferedBike',width:7,conflict:'drop'}}}],joints:[{id:1,x:0,y:0,links:[]},{id:2,x:100,y:0,links:[]}],gores:[],medians:[],intersections:[],signs:[],markings:[],lines:[],bridges:[],surfaces:[],autoTapers:false}}]});
test('destination volume modes and fractional output survive project JSON; malformed demand is rejected',()=>{
 const p=sample();p.sheets[0].data.vehicleSpawns=[{road:1,rate:.125,rateUnit:'hours',routeVolumeMode:'total',routes:[{exit:{road:1,e:1},percent:100,volume:{amount:180,unit:'AADT'}}]}];
 const saved=JSON.stringify(p);assert.equal(validate(p),p);assert.equal(JSON.stringify(p),saved);
 for(const change of [s=>s.rateUnit='weeks',s=>s.routeVolumeMode='bogus',s=>s.routes[0].volume.unit='weeks',s=>s.routes[0].volume.amount=-1,s=>delete s.routes[0].volume,s=>s.routes[0].volume.amount=864001]){
  const q=structuredClone(p);change(q.sheets[0].data.vehicleSpawns[0]);assert.throws(()=>validate(q));
 }
 const s=p.sheets[0].data.vehicleSpawns[0];s.routes[0].volume={amount:400,unit:'minutes'};s.routes.push({...s.routes[0]});assert.throws(()=>validate(p),/total|limit/i);
 s.routeVolumeMode='weights';assert.equal(validate(p),p,'relative weights do not sum to entrance output');
});
test('project validation preserves all nested geometry fields without normalizing',()=>{
 const p=sample(),before=JSON.stringify(p);assert.equal(validate(p),p);assert.equal(JSON.stringify(p),before);
});
test('rejects incompatible versions, missing references, invalid coordinates and runtime fields',()=>{
 for(const change of [p=>p.version=2,p=>p.sheets[0].data.roads[0].ends[0].joint=99,p=>p.sheets[0].data.joints[0].x=Infinity,p=>p.sheets[0].data.content={},p=>p.sheets[0].data.joints[0].links.push({a:1,ai:9,b:1,bi:0}),p=>p.sheets.push(p.sheets[0])]){
  const p=sample();change(p);assert.throws(()=>validate(p));
 }
});
test('rejects prototype properties and external image loading',()=>{
 const p=sample();p.settings=JSON.parse('{"__proto__":{"polluted":true}}');assert.throws(()=>validate(p));
 const q=sample();q.sheets[0].data.signs=[{image:{src:'https://example.com/image.png'}}];assert.throws(()=>validate(q));
 assert.equal({}.polluted,undefined);
});

test('additive versions and unknown fields are accepted without mutation only with compatible reader contract',()=>{
 const p=sample();p.version=3;p.minReaderVersion=1;p.futureMetadata={hello:'world'};
 p.sheets[0].data.futureCollection=[{unrecognized:true}];
 p.sheets[0].data.roads[0].futureWidth={value:42};
 const before=JSON.stringify(p);assert.equal(validate(p),p);assert.equal(JSON.stringify(p),before);
 p.minReaderVersion=2;assert.throws(()=>validate(p),/Unsupported project version/);
 p.version=1;p.minReaderVersion=2;assert.throws(()=>validate(p));
});


test('simulator lane exclusions and exit routes round-trip and reject malformed references',()=>{
 const p=sample();p.sheets[0].data.vehicleSpawns=[{road:1,e:0,excludedLanes:[1],routes:[{lane:0,exit:{road:1,lane:0,e:1}}]}];
 const before=JSON.stringify(p);assert.equal(validate(p),p);assert.equal(JSON.stringify(p),before);
 for(const change of [s=>s.e=2,s=>s.excludedLanes=[-1],s=>s.routes={},s=>s.routes[0].lane=0.5,s=>s.routes[0].exit=null,s=>s.routes[0].exit.road='one',s=>s.routes[0].exit.e=4]) {
  const q=structuredClone(p);change(q.sheets[0].data.vehicleSpawns[0]);assert.throws(()=>validate(q));
 }
});


test('simulator output, route names and percentages round-trip and reject invalid values',()=>{
 const p=sample();p.sheets[0].data.vehicleSpawns=[{road:1,outputs:{0:120},routes:[{lane:0,name:'Downtown',percent:75,exit:{road:1,lane:0,e:1}},{lane:0,name:'Airport',percent:25,exit:{road:1,lane:1,e:1}}]}];
 assert.equal(validate(p),p);
 for(const change of [s=>s.outputs={0:-1},s=>s.outputs={0:601},s=>s.outputs={0:1.5},s=>s.outputs={oops:10},s=>s.routes[0].percent=101,s=>s.routes[0].percent=-1,s=>s.routes[0].name=10,s=>s.routes[0].name='a'.repeat(81)]){
  const q=structuredClone(p);change(q.sheets[0].data.vehicleSpawns[0]);assert.throws(()=>validate(q));
 }
});


test('grouped entrance spawns preserve lane shares and road-wide exit references',()=>{
 const p=sample();p.sheets[0].data.vehicleSpawns=[{road:1,rate:120,laneShares:{0:75,1:25},routes:[{name:'Downtown',percent:100,exit:{road:1,e:1}}]}];
 const before=JSON.stringify(p);assert.equal(validate(p),p);assert.equal(JSON.stringify(p),before);
 for(const change of [s=>s.rate=-1,s=>s.rate=601,s=>s.laneShares={0:101},s=>s.laneShares={bad:10},s=>s.laneShares={0:'50'}]){
  const q=structuredClone(p);change(q.sheets[0].data.vehicleSpawns[0]);assert.throws(()=>validate(q));
 }
});

test('match lines and text persist while malformed annotation geometry is rejected',()=>{
 const p=sample(),d=p.sheets[0].data;
 d.matchLines=[{id:'a',name:'A-A',x:100,y:200,angle:90,width:80,peerSheet:2,peerId:'b',roads:[{road:1,e:1}]}];
 d.signs=[{text:'SEE SHEET 2',arrowRotation:270}];
 const before=JSON.stringify(p);assert.equal(validate(p),p);assert.equal(JSON.stringify(p),before);
 for(const change of [d=>d.matchLines[0].width=-1,d=>d.matchLines[0].roads[0].e=2,d=>d.matchLines[0].peerSheet='two',d=>d.matchLines.push(d.matchLines[0]),d=>d.signs[0].text=123,d=>d.signs[0].arrowRotation='left']){
  const q=structuredClone(p);change(q.sheets[0].data);assert.throws(()=>validate(q));
 }
});

test('median Bézier vectors round-trip and reject malformed controls',()=>{
 const p=sample();p.sheets[0].data.medians=[{id:1,points:[{x:0,y:0,curve:{in:{x:-10,y:2},out:{x:20,y:-4}}},{x:100,y:0},{x:100,y:50}]}];
 const before=JSON.stringify(p);assert.equal(validate(p),p);assert.equal(JSON.stringify(p),before);
 for(const invalid of [{}, {in:{x:NaN,y:0},out:{x:0,y:0}}, {in:{x:0,y:0},out:null}]){const q=structuredClone(p);q.sheets[0].data.medians[0].points[0].curve=invalid;assert.throws(()=>validate(q),/median points|non-finite/);}
});

test('intersection medians preserve local geometry and anchors; malformed islands are rejected',()=>{
 const G=require('../js/intersection-geometry.js'),p=sample(),item=G.create();
 item.medians=[{id:G.id(),type:'painted',color:'yellow',lean:'right',spacing:20,points:[
  {x:-5,y:-5,on:{approach:item.approaches[0].id,side:'median',f:.5}},
  {x:5,y:-5,curve:{in:{x:-1,y:0},out:{x:1,y:0}}},{x:0,y:5}]}];
 p.sheets[0].data.intersections=[item];const saved=JSON.stringify(p);assert.equal(validate(p),p);assert.equal(JSON.stringify(p),saved);
 for(const edit of [m=>m.points.pop(),m=>m.type='unknown',m=>m.points[0].on.f=2,m=>m.points[1].curve.out.x='bad',m=>m.spacing=-1]){
  const q=structuredClone(p);edit(q.sheets[0].data.intersections[0].medians[0]);assert.throws(()=>validate(q),/intersection medians/);
 }
});
test('centerline transition is additive version-1 geometry with validated widths',()=>{
 const p=sample(),r=p.sheets[0].data.roads[0];r.centerlineTransition={start:[0,12],end:[12,12]};
 const copy=JSON.stringify(p);assert.equal(validate(p),p);assert.equal(JSON.stringify(p),copy);
 for(const bad of [{start:[12],end:[12,12]},{start:[0,0],end:[12,12]},{start:[-1,12],end:[12,12]},{start:[null,12],end:[12,12]}]){
  r.centerlineTransition=bad;assert.throws(()=>validate(p),/centerline transition/);
 }
});
test('circular arc angles round-trip additively and reject malformed geometry',()=>{
 const p=sample(),r=p.sheets[0].data.roads[0];
 for(const angle of [-180,-90,0,90,180]){r.arcAngle=angle;assert.equal(validate(p),p);assert.equal(r.arcAngle,angle);}
 for(const angle of ['90',NaN,Infinity,-361,361]){r.arcAngle=angle;assert.throws(()=>validate(p),/circular arc|non-finite/);}
});
test('closed circles and clothoids retain additive geometry with bounded finite metadata',()=>{
 const p=sample(),r=p.sheets[0].data.roads[0];r.arcAngle=360;r.arcLoop={radius:250,heading:{x:1,y:0}};assert.equal(validate(p),p);
 for(const radius of [0,-5,Infinity]){r.arcLoop.radius=radius;assert.throws(()=>validate(p));}r.arcLoop.radius=250;
 r.arcLoop.heading={x:2,y:0};assert.throws(()=>validate(p),/loop/);
 delete r.arcLoop;assert.throws(()=>validate(p),/loop/);delete r.arcAngle;
 r.clothoid={start:0,end:540};assert.equal(validate(p),p);
 for(const end of ['90',NaN,721]){r.clothoid.end=end;assert.throws(()=>validate(p));}
});
test('fitted circular join settings round-trip without changing the version-1 road graph',()=>{
 const p=sample(),r=p.sheets[0].data.roads[0];r.arcAngle=-112;r.arcJoinFit=true;r.arcJoinRadius=55;
 const before=JSON.stringify(p);assert.equal(validate(p),p);assert.equal(JSON.stringify(p),before);
 for(const edit of [r=>r.arcJoinFit='yes',r=>r.arcJoinRadius=0,r=>r.arcJoinRadius=Infinity]){
  const q=structuredClone(p);edit(q.sheets[0].data.roads[0]);assert.throws(()=>validate(q));
 }
});
