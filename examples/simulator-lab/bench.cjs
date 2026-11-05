// Agent-only repeatable driver stress benchmark. No dependencies or app storage.
const {performance}=require('node:perf_hooks');
const B=require('../../js/simulator-drivers.js');
const V=require('../../js/simulator-vehicles.js');
const count=Number(process.env.CARS||500),steps=Number(process.env.STEPS||40);
const engine=new V.Engine({behavior:B,speed:44,pixelsPerFoot:1});
for(let i=0;i<count;i++){
 const road=Math.floor(i/50),lane=i%3,station=Math.floor((i%50)/3)*100;
 const points=Array.from({length:201},(_,j)=>({x:j*100,y:road*60+lane*12,road:road+(j>=100?100:0),lane,station:j*100,direction:1,laneWidth:12}));
 const car={id:i,road,lane,station,direction:1,driver:{duration:6.28,headway:1.6},speed:44,path:V.preparePath(points),pathDistance:station,distance:station,committed:new Set(),decisionAt:Infinity,route:{},laneWidth:12};
 engine.updateCar(car);engine.cars.push(car);
}
const times=[];
for(let i=0;i<steps;i++){const start=performance.now();engine.driverStep(B.STEP);times.push(performance.now()-start);}
times.sort((a,b)=>a-b);
console.log(JSON.stringify({scenario:'dense-connected-corridors',cars:count,steps,p50ms:times[Math.floor(steps*.5)],p95ms:times[Math.floor(steps*.95)],maxms:times.at(-1),node:process.version},null,2));
