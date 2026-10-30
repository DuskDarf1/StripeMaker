const {test}=require('node:test');
const assert=require('node:assert/strict');
const {endWidth,widthAt}=require('../js/road-widths.js');
const road=(id,laneWidth,start,end)=>({id,laneWidth,ends:[{joint:start},{joint:end}]});
test('joined roads meet at one width and blend smoothly to their own width',()=>{
 const a=road(1,10,1,2),b=road(2,16,2,3);
 const s={roads:[a,b],joints:[{id:1},{id:2,links:[{a:1,b:2,ai:0,bi:0}]},{id:3}]};
 assert.equal(endWidth(s,a,1),13);assert.equal(endWidth(s,b,0),13);
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
