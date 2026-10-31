const {test}=require('node:test');
const assert=require('node:assert/strict');
const {trim}=require('../js/marking-trim.js');
const box=(x,y,w,h)=>[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}];
test('crossing markings end at the receiving boundary, with phase distance preserved',()=>{
 const parts=trim([{x:0,y:5},{x:20,y:5}],[box(5,0,10,10)]);
 assert.deepEqual(parts,[{points:[{x:0,y:5},{x:5,y:5}],distance:0},{points:[{x:15,y:5},{x:20,y:5}],distance:15}]);
});
test('shared edges stay whole and tangent contacts do not break lines',()=>{
 assert.deepEqual(trim([{x:0,y:0},{x:20,y:0}],[box(5,0,10,10)]).map(p=>p.distance),[0]);
 assert.equal(trim([{x:0,y:0},{x:20,y:0}],[]).length,1);
});
test('overlapping joined pavements remove the union and keep arc distance across vertices',()=>{
 const parts=trim([{x:0,y:5},{x:10,y:5},{x:20,y:5}],[box(3,0,8,10),box(9,0,6,10)]);
 assert.equal(parts.length,2);assert.equal(parts[1].distance,15);
 assert.equal(parts[0].points.at(-1).x,3);
});
