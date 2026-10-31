const {test}=require('node:test');
const assert=require('node:assert/strict');
const {endWidth,widthAt,laneAt,splitWidths}=require('../js/road-widths.js');
const road=(id,laneWidth,start,end)=>({id,laneWidth,ends:[{joint:start},{joint:end}]});
test('joined roads keep independent widths on either side of a node',()=>{
 const a=road(1,10,1,2),b=road(2,16,2,3);
 const s={roads:[a,b],joints:[{id:1},{id:2,links:[{a:1,b:2,ai:0,bi:0}]},{id:3}]};
 assert.equal(endWidth(s,a,1),10);assert.equal(endWidth(s,b,0),16);
 assert.equal(endWidth(s,a,0),10);
 assert.equal(widthAt(10,10,13,0),10);assert.equal(widthAt(10,10,13,.5),10);assert.equal(widthAt(10,10,13,1),13);
 assert(widthAt(10,10,13,.75)>10);assert(widthAt(10,10,13,.75)<13);
 assert(Math.abs(widthAt(10,10,13,.99999)-13)<1e-8);
});
test('each intersection end and opposite direction may have a different width',()=>{
 const a=road(1,12,1,2),b=road(2,12,2,1);
 const s={roads:[a,b],joints:[{id:1},{id:2}],intersections:[{approaches:[
 {width:10,outWidth:14,links:[{road:1,e:1}]},
 {width:11,outWidth:16,links:[{road:1,e:0}]}]}]};
 assert.equal(endWidth(s,a,1),10);assert.equal(endWidth(s,b,0),14);
 assert.equal(endWidth(s,a,0),16);assert.equal(endWidth(s,b,1),11);
});
test('beside and opposite pair links do not average unrelated lane widths',()=>{
 const a=road(1,10,1,2),b=road(2,16,2,3);
 for(const kind of [{beside:1},{pair:true}]){
 const s={roads:[a,b],joints:[{id:2,links:[{a:1,b:2,ai:0,bi:0,...kind}]}]};
 assert.equal(endWidth(s,a,1),10);assert.equal(endWidth(s,b,0),16);
 }
});

test('per-lane widths are opt-in, independently adjustable at both ends, and survive cuts',()=>{
 const a={...road(1,12,1,2),lanes:2,laneWidths:{0:16},laneEndWidths:{'0:0':18,'1:0':10}};
 const s={roads:[a],joints:[]};
 assert.equal(laneAt(s,a,0,0),12);
 a.perLaneWidths=true;
 assert.equal(laneAt(s,a,0,0),18);assert.equal(laneAt(s,a,0,.5),16);assert.equal(laneAt(s,a,0,1),10);
 assert.equal(laneAt(s,a,1,.5),12);
 const [before,after]=splitWidths(s,a,.3);
 const b={...a,widthProfiles:before},c={...a,widthProfiles:after};
 for(let i=0;i<=10;i++) {
  assert(Math.abs(laneAt(s,b,0,i/10)-laneAt(s,a,0,.3*i/10))<1e-9);
  assert(Math.abs(laneAt(s,c,0,i/10)-laneAt(s,a,0,.3+.7*i/10))<1e-9);
 }
 assert.equal(endWidth(s,b,1,0),endWidth(s,c,0,0));
});
test('wide edge feed cannot change either piece of the receiving road',()=>{
 const a={...road(1,10,1,2),lanes:2},b={...road(2,10,2,3),lanes:2},r={...road(3,20,4,2),lanes:1};
 const s={roads:[a,b,r],joints:[{id:2,links:[{a:1,b:2,ai:0,bi:0},{a:2,b:3,ai:1,bi:0,feed:true}]}]};
 for(const lane of [0,1]) {assert.equal(endWidth(s,a,1,lane),10);assert.equal(endWidth(s,b,0,lane),10);}
 assert.equal(endWidth(s,r,1,0),10);
 assert.equal(laneAt(s,r,0,.5),20);
 assert(laneAt(s,r,0,.75)>10 && laneAt(s,r,0,.75)<20);
 r.perLaneWidths=true;r.laneEndWidths={'1:0':19};
 assert.equal(endWidth(s,r,1,0),10,'receiving lane controls even an explicit width');
 b.perLaneWidths=true;b.laneWidths={1:12};
 assert.equal(endWidth(s,r,1,0),12,'follows later receiving-lane edits');
});

test('previously saved edge feeds narrow without changing their receiving cut profile',()=>{
 const a={...road(1,10,1,2),lanes:1},b={...road(2,10,2,3),lanes:1},r={...road(3,20,4,2),lanes:1};
 const s={roads:[a,b,r],joints:[{id:2,links:[{a:1,b:2,ai:0,bi:0},{a:2,b:3,ai:0,bi:0}]}]};
 b.widthProfiles=[{width:10,start:10,end:10,from:.4,to:1}];
 assert.equal(endWidth(s,r,1,0),10);
 assert.equal(endWidth(s,b,0,0),10);
});

test('a wide road end narrows into an existing road start, including saved node joins',()=>{
 for (const flagged of [false,true]) {
  const host={...road(1,10,1,2),lanes:2,perLaneWidths:true,laneWidths:{1:11}};
  const ramp={...road(2,20,3,1),lanes:1};
  const s={roads:[host,ramp],joints:[{id:1,links:[{a:1,ai:1,b:2,bi:0,...(flagged?{feed:true}:{})}]}]};
  assert.equal(endWidth(s,ramp,1,0),11);
  assert.equal(endWidth(s,host,0,1),11);
  assert.equal(laneAt(s,ramp,0,.5),20);
  assert.equal(endWidth(s,ramp,0,0),20);
  s.joints[0].links=[];
  assert.equal(endWidth(s,ramp,1,0),20,'detaching restores the chosen width');
 }
});
test('a new departing start follows the existing road end without widening it',()=>{
 const host={...road(1,10,1,2),lanes:1},ramp={...road(2,20,2,3),lanes:1};
 const s={roads:[host,ramp],joints:[{id:2,links:[{a:1,ai:0,b:2,bi:0,feed:true}]}]};
 assert.equal(endWidth(s,ramp,0,0),10);assert.equal(endWidth(s,host,1,0),10);
});

test('bike widths survive vehicle feeds and generic intersection mouths',()=>{
 const a={...road(1,12,1,2),lanes:2,laneTypes:{1:{type:'bufferedBike',width:7}}};
 const b={...road(2,12,2,3),lanes:2};
 const s={roads:[a,b],joints:[{id:1,links:[]},{id:2,links:[{a:2,ai:1,b:1,bi:1,feed:true}]},{id:3,links:[]}],
  intersections:[{approaches:[{width:12,outWidth:12,links:[{road:1,e:1,lane:1}]}]}]};
 assert.equal(endWidth(s,a,1,1),7);
 a.laneTypes[1]={type:'bike',width:5};assert.equal(endWidth(s,a,1,1),5);
 a.perLaneWidths=true;a.laneEndWidths={'1:1':6};assert.equal(endWidth(s,a,1,1),6);
});
test('connected split medians add space without changing lane widths and preserve their profile across cuts',()=>{
 const W=require('../js/road-widths.js');
 const r={...road(1,12,1,2),lanes:2};
 const a={incoming:2,outgoing:0,width:12,inLanes:['a','b'],outLanes:[],links:[{road:1,e:1,lane:0,to:'a'},{road:1,e:1,lane:1,to:'b'}],splits:[{incoming:true,after:1,width:6,surface:'concrete'}]};
 const s={roads:[r],joints:[{id:1,links:[]},{id:2,links:[]}],intersections:[{approaches:[a]}]};
 assert.equal(W.endGaps(s,r,0)[1].width,0);assert.equal(W.endGaps(s,r,1)[1].width,6);
 assert.equal(W.endWidth(s,r,1,0),12);assert.equal(W.endWidth(s,r,1,1),12);
 assert.equal(W.gapAt(r,1,.5,0,6),3);
 const [first,last]=W.splitGaps(s,r,.4);
 const left={...r,gapProfiles:first},right={...r,gapProfiles:last};
 const loose={...s,intersections:[]};
 for(const [part,from,to] of [[left,0,.4],[right,.4,1]])for(const f of [0,.2,.7,1]){
  const ends=[0,1].map(e=>W.endGaps(loose,part,e)[1].width);
  assert(Math.abs(W.gapAt(part,1,f,...ends)-W.gapAt(r,1,from+(to-from)*f,0,6))<1e-9);
 }
 assert.doesNotThrow(()=>W.endGaps(s,{lanes:2,laneWidth:12},0),'drawing previews have no road ends yet');
});
