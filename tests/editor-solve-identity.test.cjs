const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {test}=require('node:test');
const source=fs.readFileSync('js/elements.js','utf8');
function api(){
 let solves=0;
 const context=vm.createContext({layerFor(){},window:{StripeMaker:{roadWidths:{withSnapshot:(_s,run)=>run()}}},
  computeSolved(sheet){
   solves++;const byJoint=new Map();
   for(const road of sheet.roads)road.ends.forEach((end,e)=>{if(!byJoint.has(end.joint))byJoint.set(end.joint,[]);byJoint.get(end.joint).push({road,e,end});});
   return Object.assign(new Map(),{byJoint,auto:new Set(),shapes:new Map(),dropLaneEnds:new Map(),dropLaneTargets:new Map(),dropPavementEnds:new Map()});
  }});
 vm.runInContext(source.slice(source.indexOf('    function solve(sheet)'),source.indexOf('    function computeSolved(sheet)')),context);
 return {solve:sheet=>context.solve(sheet),count:()=>solves};
}
const fixture=()=>({inchesPerPixel:6,autoTapers:false,roads:[{id:1,lanes:1,laneWidth:12,ends:[{joint:1,sign:1},{joint:2,sign:1}]}],
 joints:[{id:1,x:0,y:0,links:[]},{id:2,x:100,y:0,links:[]}],intersections:[]});
test('value-equal object replacements never expose stale attachment identities',()=>{
 const A=api(),sheet=fixture();A.solve(sheet);
 for(const replace of [
  ()=>{sheet.roads=structuredClone(sheet.roads);sheet.joints=structuredClone(sheet.joints);},
  ()=>{sheet.roads[0]=structuredClone(sheet.roads[0]);sheet.joints[0]=structuredClone(sheet.joints[0]);},
  ()=>{sheet.roads[0].ends=structuredClone(sheet.roads[0].ends);},
 ]){
  replace();const solved=A.solve(sheet),attachment=solved.byJoint.get(1)[0];
  assert.equal(attachment.road,sheet.roads[0],'terminal-end checks compare the current road objects');
  assert.equal(attachment.end,sheet.roads[0].ends[0],'attachment directions and topology use current endpoint objects');
 }
});
test('node stacks share only unchanged geometry while render-local fields stay private',()=>{
 const A=api(),sheet=fixture(),first=A.solve(sheet);first.stacks.set('1:0:0',2);first.crosswalkCuts=['private'];
 const second=A.solve(sheet);assert.equal(A.count(),1);assert.equal(second.stacks,first.stacks);assert.equal(second.crosswalkCuts,undefined);
 sheet.view={scale:3,x:10,y:20};assert.equal(A.solve(sheet).stacks,first.stacks,'screen inset changes do not change geometric stacking');
 sheet.joints[0].x+=1;assert.notEqual(A.solve(sheet).stacks,first.stacks,'moving a joint invalidates stacking');
 const third=A.solve(sheet);sheet.intersections=[{approaches:[{width:14}]}];
 assert.notEqual(A.solve(sheet).stacks,third.stacks,'intersection width rules are geometry dependencies');
});
test('uniform cross-section keys retain every numeric value, sample count and varying row',()=>{
 const context=vm.createContext({});
 vm.runInContext(source.slice(source.indexOf('    const sectionKey='),source.indexOf('    function drawRoad('))+'\nthis.key=sectionKey;',context);
 const encode=rows=>JSON.stringify(context.key(rows));
 const uniform=[[0,12,24],[0,12,24],[0,12,24]];
 assert.equal(encode(uniform),JSON.stringify([3,[0,12,24]]));
 assert.notEqual(encode(uniform),encode(uniform.slice(1)));
 const change=structuredClone(uniform);change[1][1]+=1e-12;assert.notEqual(encode(uniform),encode(change));
 const lanes=[[[0,12],[12,24]],[[0,12],[12,24]]];
 assert.equal(encode(lanes),JSON.stringify([2,lanes[0]]));
 lanes[1][1][1]+=1e-12;assert.equal(encode(lanes),JSON.stringify(lanes));
 const shorter=[[[0,12],[12,24]],[[0,12]]];assert.equal(encode(shorter),JSON.stringify(shorter));
});
