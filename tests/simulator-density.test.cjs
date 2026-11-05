const {test}=require('node:test'),assert=require('node:assert/strict'),D=require('../js/simulator-density.js');
const lane=(lane=0,ppf=1)=>({road:1,lane,stations:[0,100*ppf,200*ppf],points:[0,100,200].map(x=>({x:x*ppf,y:lane*12*ppf,laneWidth:12*ppf,level:1}))});
const car=(station,lane=0,ppf=1)=>({road:1,lane,station:station*ppf,laneWidth:12*ppf,driver:{jamGap:2}});
test('density progresses from empty green through sparse to congested red sections',()=>{
 const grid=D.build([lane()],1),empty=D.values(grid,[]),sparse=D.values(grid,[car(50)]),dense=D.values(grid,[20,44,68,92].map(s=>car(s)));
 assert.deepEqual(empty,[0,0]);assert(sparse[0]>0&&sparse[0]<.3);assert(dense[0]>.8&&dense[0]<=1);assert.equal(dense[1]>0,true,'space blends across cell boundaries');
 assert.equal(D.color(0),'hsl(120.0 80% 42%)');assert.equal(D.color(1),'hsl(0.0 80% 42%)');assert.equal(D.color(2),D.color(1));
});
test('lane changes distribute one vehicle without creating duplicate density',()=>{
 const grid=D.build([lane(0),lane(1)],1),single=D.values(grid,[car(50)]),changing=D.values(grid,[{...car(50),laneChange:{from:0,to:1,progress:.5}}]);
 assert(Math.abs(changing[0]-single[0]/2)<1e-10);assert(Math.abs(changing[2]-single[0]/2)<1e-10);assert.equal(changing.reduce((s,n)=>s+n,0),single.reduce((s,n)=>s+n,0));
});
test('density is scale-independent and does not mutate roads or vehicles',()=>{
 const a=lane(0),b=lane(0,6),cars=[car(99)],before=JSON.stringify([a,cars]);
 const small=D.values(D.build([a],1),cars),large=D.values(D.build([b],6),[car(99,0,6)]);small.forEach((value,i)=>assert(Math.abs(value-large[i])<1e-10));
 assert.equal(JSON.stringify([a,cars]),before);assert.deepEqual(D.values(D.build([a],1),[{...car(50),road:99}]),[0,0]);
});
test('curves, shortened last sections and levels retain usable visualization geometry',()=>{
 const record={road:1,lane:0,stations:[0,50,120],points:[{x:0,y:0,laneWidth:12,level:2},{x:40,y:30,laneWidth:12,level:2},{x:40,y:100,laneWidth:8,level:2}]};
 const grid=D.build([record],1);assert.equal(grid.cells.length,2);assert.equal(grid.cells[1].end-grid.cells[1].start,20);assert(grid.cells.every(c=>c.level===2&&!c.d.includes('NaN')));assert(D.values(grid,[car(119)]).every(v=>Number.isFinite(v)&&v>=0&&v<=1));
});
