const {test}=require('node:test'),assert=require('node:assert/strict');
const L=require('../js/sign-layout.js');
test('assemblies center different panel sizes in stacked rows and parallel columns',()=>{
 const s={width:100,panels:[{row:1,column:0},{row:1,column:1}]};
 const box=L.layout(s,p=>p===s?{width:100,height:100}:{width:60,height:30});
 assert.equal(box.width,160);assert.equal(box.height,130);
 assert.equal(box.items[1].y,box.items[2].y);assert(box.items[1].x<box.items[2].x);
});
test('face paths rotate as coordinates, preserving vector PDF export',()=>{
 assert.equal(L.path('M0 0 L10 0 L10 20 Z',1,-5,-10,90,100,200),'M110.0000 195.0000 L110.0000 205.0000 L90.0000 205.0000 Z');
});
