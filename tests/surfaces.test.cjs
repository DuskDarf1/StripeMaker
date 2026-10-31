const {test}=require('node:test');
const assert=require('node:assert/strict');
const {routeBetween}=require('../js/surfaces.js');
const roads=[1,2,3,4].map(id=>({id,ends:[{joint:id},{joint:id+1}]}));
const sheet={roads,joints:[{id:2,links:[{a:1,ai:1,b:2,bi:2,feed:true}]},{id:3,links:[{a:3,ai:1,b:2,bi:2}]},{id:4,links:[{a:3,ai:1,b:4,bi:1}]}]};
test('colored pavement follows lane links through several nodes in either click order',()=>{
 const a={road:roads[0],lane:1,f:.3},b={road:roads[3],lane:1,f:.8};
 const expected=roads.map((road,i)=>({road,lane:i===1?2:1,from:i?0:.3,to:i===3?.8:1}));
 assert.deepEqual(routeBetween(sheet,a,b),expected);
 assert.deepEqual(routeBetween(sheet,b,a),expected);
 assert.equal(routeBetween(sheet,a,{...b,lane:0}),null);
});
test('colored pavement does not cross unrelated lanes or beside links',()=>{
 const a={road:roads[0],lane:1,f:.3};
 assert.equal(routeBetween(sheet,a,{...a,lane:0,f:.8}),null);
 const copy=structuredClone(sheet);copy.joints[0].links[0].beside=1;
 assert.equal(routeBetween(copy,{...a,road:copy.roads[0]},{road:copy.roads[1],lane:2,f:.5}),null);
});
