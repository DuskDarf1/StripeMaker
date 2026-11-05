const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {test}=require('node:test');
const W=require('../js/road-widths.js'),fixture=require('./fixtures/dense-editor.cjs');
const read=(sheet,api=W)=>sheet.roads.flatMap(road=>[0,1].map(e=>({id:road.id,e,widths:Array.from({length:road.lanes},(_,lane)=>api.endWidth(sheet,road,e,lane)),gaps:api.endGaps(sheet,road,e)})));
function compare(sheet) {
 const before=JSON.stringify(sheet),plain=read(sheet),indexed=W.withSnapshot(sheet,()=>read(sheet));
 assert.deepEqual(indexed,plain);assert.equal(JSON.stringify(sheet),before,'width reads never modify the sheet');
}
test('scoped indexes match unscoped widths/gaps on a dense connected sheet and after in-place edits',()=>{
 const sheet=fixture(),approach=sheet.intersections.flatMap(i=>i.approaches).find(a=>a.links?.length),road=sheet.roads[0];
 compare(sheet);
 road.perLaneWidths=true;road.laneWidths={0:15};road.laneEndWidths={'0:0':10};compare(sheet);
 approach.laneDetails??={};approach.laneDetails[approach.links[0].to]={width:17};compare(sheet);
 approach.splits=[{incoming:approach.links[0].e===1,after:1,width:6,surface:'concrete'}];compare(sheet);
 approach.links.reverse();compare(sheet);
 approach.binding={road:approach.links[0].road,e:approach.links[0].e};compare(sheet);
 delete approach.binding;road.ends[0].joint=sheet.roads[1].ends[0].joint;compare(sheet);
 sheet.roads.reverse();sheet.joints.reverse();compare(sheet);
 sheet.roads=structuredClone(sheet.roads);sheet.intersections=structuredClone(sheet.intersections);compare(sheet);
});
test('scopes preserve recursive feed visitation and restore earlier sheets after nesting and errors',()=>{
 const first={roads:[{id:1,lanes:1,laneWidth:10,ends:[{joint:1},{joint:2}]},{id:2,lanes:1,laneWidth:14,ends:[{joint:2},{joint:1}]}],
  joints:[{id:1,links:[{a:1,ai:0,b:2,bi:0,feed:true},{a:2,ai:0,b:1,bi:0,feed:true}]},{id:2,links:[]}],intersections:[]};
 const second={roads:[{id:1,lanes:1,laneWidth:18,ends:[{joint:1},{joint:2}]}],joints:[{id:1,links:[]},{id:2,links:[]}],intersections:[]};
 const original=read(first);
 W.withSnapshot(first,()=>{
  assert.deepEqual(W.withSnapshot(first,()=>read(first)),original);
  assert.deepEqual(W.withSnapshot(second,()=>read(second)),read(second));
  assert.throws(()=>W.withSnapshot(second,()=>{throw Error('test failure');}),/test failure/);
  assert.deepEqual(read(first),original);
  for(const initial of [[],['1:0:0'],['2:1:0']]) {
   const visiting=new Set(initial),before=[...visiting];W.endWidth(first,first.roads[0],0,0,visiting);assert.deepEqual([...visiting],before);
  }
 });
 first.roads[0].laneWidth=22;first.joints[0].links=[];compare(first);
 assert.equal(W.withSnapshot(first,()=>W.endWidth(first,first.roads[0],0,0)),22);
});
test('explicit invalidation rebuilds indexes after attachment and topology normalization within a scope',()=>{
 const context={module:{exports:{}}};vm.runInNewContext(fs.readFileSync('js/road-widths.js','utf8'),context);
 const unscoped=context.module.exports,sheet=fixture(2),other=fixture(2);
 const approach=sheet.intersections[0].approaches.find(a=>a.links?.length),saved=structuredClone(approach.links);
 const check=()=>assert.deepEqual(read(sheet),structuredClone(read(sheet,unscoped)));
 W.withSnapshot(sheet,()=>{
  check();
  for(const change of [()=>approach.links.splice(0,1),()=>{approach.binding={road:saved[0].road,e:saved[0].e};},
   ()=>{delete approach.binding;approach.links=structuredClone(saved);},()=>{sheet.roads[0].ends[0].joint=sheet.roads[1].ends[0].joint;},
   ()=>{sheet.roads=structuredClone(sheet.roads);sheet.joints=structuredClone(sheet.joints);},()=>{sheet.intersections=structuredClone(sheet.intersections);}]) {
   change();W.invalidateSnapshot(sheet);check();
  }
  W.withSnapshot(other,()=>{sheet.roads[0].laneWidth=19;W.invalidateSnapshot(sheet);});check();
 });
});
