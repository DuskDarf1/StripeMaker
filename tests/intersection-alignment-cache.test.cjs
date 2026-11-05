const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {test}=require('node:test');
const source=fs.readFileSync('js/intersections.js','utf8');
const context=vm.createContext({round:item=>item.kind==='roundabout'});
vm.runInContext(source.slice(source.indexOf('    function alignmentDependencies('),source.indexOf('    function reconcile(')),context);
function fixture() {
 const roads=[{id:1,ends:[{joint:1},{joint:2}]},{id:2,ends:[{joint:2},{joint:3}]},{id:3,ends:[{joint:4},{joint:5}]}];
 const joints=Array.from({length:5},(_,i)=>({id:i+1,x:i*100,y:0,links:[]}));
 const a={id:'a',approaches:[{id:'a1',width:12,links:[{road:1,e:0,lane:0,to:'in-a'}]}]};
 const b={id:'b',approaches:[{id:'b1',width:12,links:[{road:2,e:1,lane:0,to:'in-b'}]}]};
 return {inchesPerPixel:6,autoTapers:false,roads,joints,intersections:[a,b],medians:[]};
}
test('alignment dependencies follow connected roads and neighboring mouths while excluding unrelated drawings',()=>{
 const sheet=fixture(),item=sheet.intersections[0],key=()=>context.alignmentDependencies(sheet)(item),initial=key();
 sheet.signs=[{x:100,y:200}];sheet.markings=[{type:'through'}];sheet.joints[4].x+=50;
 assert.equal(key(),initial,'an unrelated component or drawing does not invalidate alignment');
 sheet.roads[1].laneWidth=16;assert.notEqual(key(),initial,'a road elsewhere in the linked component changes endpoint geometry');
 const beforeMouth=key();sheet.intersections[1].approaches[0].width=18;
 assert.notEqual(key(),beforeMouth,'the mouth at the far end supplies widths to this component');
 const beforeTopology=key();sheet.roads[2].ends[0].joint=3;
 assert.notEqual(key(),beforeTopology,'newly joined components change dependency membership');
 const joined=key();sheet.joints[4].y=40;assert.notEqual(key(),joined,'newly connected far joints participate');
});
test('structural mouths and owned median cleanup retain their wider dependencies',()=>{
 for(const structural of ['roundabout','split']) {
  const sheet=fixture(),item=sheet.intersections[0];
  if(structural==='roundabout')item.kind='roundabout';else item.approaches[0].splits=[{id:'split',after:1}];
  const key=()=>context.alignmentDependencies(sheet)(item),before=key();sheet.joints[4].x+=50;
  assert.notEqual(key(),before,`${structural} can regroup attachments beyond one component`);
 }
 const sheet=fixture(),item=sheet.intersections[0];
 sheet.medians=[{id:'owned',intersectionMedian:{intersection:'a'},points:[{x:0,y:0,on:{road:3,side:'R',f:0}}]}];
 const key=()=>context.alignmentDependencies(sheet)(item),before=key();sheet.roads=sheet.roads.filter(r=>r.id!==3);
 assert.notEqual(key(),before,'deleting a road referenced by an owned median triggers cleanup');
});
