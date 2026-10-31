const {test}=require('node:test');
const assert=require('node:assert/strict');
const {validate}=require('../js/project-json.js');
const sample=()=>({format:'StripeMakerProject',version:1,selectedSheet:1,settings:{},shortcuts:{},sheets:[{id:1,width:30000,height:30000,file:{name:'blank.png',base64:'AAAA'},data:{name:'Test',blank:true,width:30000,height:30000,inchesPerPixel:2,view:{x:0,y:0,scale:1},roads:[{id:1,lanes:2,laneWidth:12,ends:[{joint:1,sign:1},{joint:2,sign:1}],laneTypes:{1:{type:'bufferedBike',width:7,conflict:'drop'}}}],joints:[{id:1,x:0,y:0,links:[]},{id:2,x:100,y:0,links:[]}],gores:[],medians:[],intersections:[],signs:[],markings:[],lines:[],bridges:[],surfaces:[],autoTapers:false}}]});
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
