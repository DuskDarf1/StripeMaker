const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('js/elements.js','utf8');
const context=vm.createContext({pairOf:(s,r)=>s.roads.find(p=>p.id===r.partner),pairLinks:(s,r)=>[{median:r.median??0}],attachments:(s,j)=>Array(j.count??2).fill({}),jointOf:(s,id)=>s.joints.find(j=>j.id===id),solve:()=>new Map(),travelAt:r=>r.direction??{x:1,y:0},dot:(a,b)=>a.x*b.x+a.y*b.y});
vm.runInContext(source.slice(source.indexOf('    function centerlineTransitionCandidate('),source.indexOf('    function prepareCenterlineTransition(')),context);
const setup=()=>({roads:[{id:1,partner:2,lanes:2},{id:2,partner:1,lanes:1},{id:3,partner:4,lanes:1},{id:4,partner:3,lanes:2}].map(r=>({...r,laneWidth:12,ends:[{joint:r.id},{joint:r.id}]})),joints:[1,2,3,4].map(id=>({id}))});
const candidate=s=>context.centerlineTransitionCandidate(s,s.roads[0],1,{road:s.roads[2],e:0});
test('detects equal-width opposing lane swaps, including constant profiles after a road cut',()=>{
 const s=setup();assert(candidate(s));s.roads[0].widthProfiles=[{start:12,end:12,width:12}];assert(candidate(s));
});
test('ordinary joins, branches, medians, bike facilities and custom tapers retain existing joins',()=>{
 for(const change of [s=>s.roads[0].partner=null,s=>s.roads[2].lanes=2,s=>s.roads[3].lanes=3,s=>s.roads[2].laneWidth=10,s=>s.roads[0].median=12,s=>s.joints[0].count=3,s=>s.roads[0].laneTypes={1:{type:'bike'}},s=>s.roads[0].tapers={'1:0':{mode:'taper'}},s=>s.roads[0].widthProfiles=[{start:10,end:12,width:12}],s=>s.roads[0].direction={x:0,y:1}]) {
  const s=setup();change(s);assert.equal(candidate(s),null);
 }
});
