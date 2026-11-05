const {test}=require('node:test'),assert=require('node:assert/strict');
const G=require('../js/simulator-gaps.js'),C=require('../js/simulator-collisions.js'),V=require('../js/simulator-vehicles.js'),B=require('../js/simulator-drivers.js');
const line=(turn=false)=>V.preparePath([{x:0,y:0}, {x:100,y:0},...(turn?Array.from({length:46},(_,i)=>({x:100+25*Math.sin(i*Math.PI/90),y:25*(1-Math.cos(i*Math.PI/90))})):[{x:140,y:0}]),{x:125,y:200}].map(p=>({...p,laneWidth:12})));
const actor=path=>({id:1,path,pathDistance:0,speed:60*5280/3600,driver:B.profile(()=>.5,0),...V.position(path,0)});
test('gap clearance predicts braking for the turn rather than maintaining approach speed',()=>{
 const c=actor(line(true)),f=G.forecast(c,1,88,C.desiredSpeed,null,c.path.length);
 assert(f(150)>150/88+1,'a slow turn needs substantially longer than distance divided by approach speed');
 assert(f(160)>f(140));assert(Number.isFinite(f(160)));
});
test('a blocked receiving lane cannot be assumed to clear on a free-flow forecast',()=>{
 const path=V.preparePath([{x:0,y:0,laneWidth:12},{x:1000,y:0,laneWidth:12}]),c={...actor(path),speed:0};
 const stopped=G.forecast(c,1,88,C.desiredSpeed,{car:{speed:0},gap:2/.3048},200);
 assert.equal(stopped(100),Infinity);assert.equal(stopped(0),0);
 const clear=G.forecast(c,1,88,C.desiredSpeed,null,200);assert(Number.isFinite(clear(100)));
});
