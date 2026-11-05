/* Road-density visualization only; does not change traffic or pavement.
   100 ft cells and the green/red scale are display policies. Normalize occupied
   longitudinal space by the model's visible vehicle length plus standstill gap,
   not a claimed calibrated capacity. Lane changes share one vehicle's weight. */
(() => {
 const L=typeof module!=='undefined'?require('./simulator-lane-changes.js'):globalThis.StripeMaker.simulatorLaneChanges;
 const key=(road,lane)=>`${road}:${lane}`;
 function build(records,ppf){
  const size=100*ppf,cells=[],lanes=new Map();
  for(const lane of records){
   if(lane.points.length<2)continue;
   const end=L.stationsOf(lane).at(-1);if(!(end>0))continue;
   const list=[];
   for(let start=0;start<end;start+=size){
    const finish=Math.min(end,start+size),points=L.slice(lane,start,finish),left=[],right=[];
    for(let i=0;i<points.length;i++){
     const p=points[i],a=points[Math.max(0,i-1)],b=points[Math.min(points.length-1,i+1)],dx=b.x-a.x,dy=b.y-a.y,n=Math.hypot(dx,dy)||1,half=(p.laneWidth??12*ppf)/2;
     left.push({x:p.x-dy/n*half,y:p.y+dx/n*half});right.push({x:p.x+dy/n*half,y:p.y-dx/n*half});
    }
    const ring=[...left,...right.reverse()],cell={road:lane.road,lane:lane.lane,start,end:finish,level:L.sample(lane,(start+finish)/2).level??1,index:cells.length,
     d:`M${ring.map(p=>`${p.x.toFixed(3)},${p.y.toFixed(3)}`).join('L')}Z`};
    cells.push(cell);list.push(cell);
   }lanes.set(key(lane.road,lane.lane),list);
  }return {cells,lanes,size,ppf};
 }
 function values(grid,cars){
  const occupied=new Array(grid.cells.length).fill(0),ppf=grid.ppf;
  for(const car of cars){
   if(car.road==null||!Number.isFinite(car.station))continue;
   const changing=car.laneChange,progress=Math.max(0,Math.min(1,changing?.progress??0));
   const shares=changing?[[changing.from,1-progress],[changing.to,progress]]:[[car.lane,1]];
   const body=Math.max(ppf,Math.min(car.laneWidth??12*ppf,12*ppf)-2*ppf)*381/214;
   const space=body+(car.driver?.jamGap??2)*ppf/.3048,start=car.station-space/2,end=car.station+space/2;
   for(const [lane,weight] of shares){
    if(!weight)continue;const list=grid.lanes.get(key(car.road,lane));if(!list)continue;
    for(let i=Math.max(0,Math.floor(start/grid.size));i<list.length&&list[i].start<end;i++){
     const cell=list[i];occupied[cell.index]+=Math.max(0,Math.min(end,cell.end)-Math.max(start,cell.start))*weight;
    }
   }
  }return grid.cells.map(cell=>Math.max(0,Math.min(1,occupied[cell.index]/(cell.end-cell.start))));
 }
 const color=value=>`hsl(${(120*(1-Math.max(0,Math.min(1,value)))).toFixed(1)} 80% 42%)`;
 const api={build,values,color};(globalThis.StripeMaker??={}).simulatorDensity=api;
 if(typeof module!=='undefined')module.exports=api;
})();
