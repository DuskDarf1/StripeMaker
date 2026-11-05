/* Florida right of way:
   https://www.flsenate.gov/Laws/Statutes/2026/316.123 (STOP/YIELD, four-way order)
   https://www.flsenate.gov/Laws/Statutes/2026/316.121 (entered traffic, yield right)
   https://www.flsenate.gov/Laws/Statutes/2026/316.122 (opposing traffic on left turns)
   The law supplies obligations, not numerical gap acceptance or a dwell time.
   Body/gap forecasts use the existing driver model; a full zero-speed physics
   sample at the bar records compliance. Temperature never randomizes the law. */
(() => {
 const half=(car,ppf)=>Math.max(ppf,Math.min(car.laneWidth??12*ppf,12*ppf)-2*ppf)*381/214/2;
 function attach(path,controls) {
  path.controls=[];
  for(const control of controls) {
   const t=control.direction,n={x:-t.y,y:t.x},dot=(p,v)=>p.x*v.x+p.y*v.y;
   const along=Math.min(...control.points.map(p=>dot(p,t))),cross=control.points.map(p=>dot(p,n));
   const low=Math.min(...cross),high=Math.max(...cross);
   for(let i=1;i<path.points.length;i++) {
    const a=path.points[i-1],b=path.points[i];
    if((a.level??b.level??1)!==control.level)continue;
    const matches=p=>control.on.some(on=>on.road!=null?p.road===on.road&&p.lane===on.lane:
     p.intersection===on.intersection&&p.junction?.entry===on.approach&&p.junction?.input===on.lane);
    if(!matches(a)&&!matches(b))continue;
    const start=dot(a,t),end=dot(b,t);if(end<=start||start>along+1e-6||end<along-1e-6)continue;
    const f=(along-start)/(end-start),p={x:a.x+(b.x-a.x)*f,y:a.y+(b.y-a.y)*f},across=dot(p,n);
    if(across<low-1e-6||across>high+1e-6)continue;
    const distance=path.lengths[i-1]+(path.lengths[i]-path.lengths[i-1])*f;
    if(!path.controls.some(c=>c.id===control.id&&Math.abs(c.distance-distance)<1e-5))path.controls.push({...control,distance});
   }
  }
  path.controls.sort((a,b)=>a.distance-b.distance);
  let previous=-Infinity;
  for(const m of [...path.movements].sort((x,y)=>x.start-y.start)) {
   m.entry=m.baseEntry??m.entry;m.baseEntry=m.entry;delete m.control;
   // A road-to-road merge has no intersection record. A STOP/YIELD line on
   // the feeding lanes (after any earlier junction) governs that merge: the
   // controlled feeder yields to the uncontrolled stream (F.S. 316.123(3)).
   const candidates=m.junction?.roadMerge?path.controls.filter(c=>c.intersection==null&&c.type!=='signal'&&c.distance>previous&&c.distance<=m.end):
    path.controls.filter(c=>c.intersection===m.intersection&&c.distance<=m.end&&
    (!c.approach||!m.junction||c.approach===m.junction.entry));
   previous=Math.max(previous,m.end);
   m.control=candidates.find(c=>c.distance>=m.start)??candidates.at(-1);
   if(m.control)m.entry=m.control.distance;
   const approaches=m.junction?.approachLanes;
   m.allWayStop=Boolean(approaches?.filter(a=>a.incoming.length).length&&approaches.every(a=>a.incoming.every(lane=>controls.some(c=>c.intersection===m.intersection&&c.approach===a.id&&c.type==='stop'&&c.controlledLanes?.includes(lane)))));
  }
 }
 function observe(car,ppf,time) {
  car.stops??=new Map();
  for(const control of car.path.controls??[]) {
   const remaining=control.distance-car.pathDistance-half(car,ppf);
   // Millimetre geometry tolerance, not a human stopping-distance parameter.
   if(control.type==='stop'&&Math.abs(remaining)<=.001*ppf/.3048&&car.speed===0&&!car.stops.has(control.marking))car.stops.set(control.marking,time);
  }
 }
 function ready(car,movement) {if(car.signalControl?.movement===movement)return car.signalControl.allowed;return movement.control?.type!=='stop'||car.stops?.has(movement.control.marking);}
 function obstacle(car,ppf) {
  const signal=car.signalControl;
  const control=car.path.controls?.find(c=>!(signal&&c===signal.movement.control)&&!(signal&&c.marking===signal.movement.control?.marking)&&c.type==='stop'&&!car.stops?.has(c.marking)&&c.distance>=car.pathDistance-1e-6);
  if(signal&&!signal.allowed&&(!control||signal.distance<=control.distance))return {control:signal,remaining:signal.remaining,gap:signal.remaining+(car.driver.jamGap??2)*ppf/.3048,car:{speed:0}};
  if(!control)return null;
  const remaining=Math.max(0,control.distance-car.pathDistance-half(car,ppf));
  return {control,remaining,gap:remaining+(car.driver.jamGap??2)*ppf/.3048,car:{speed:0}};
 }
 const movement=car=>car.path?.movements?.find(m=>m.intersection===car.entryIntersection&&m.end>=car.pathDistance);
 const delta=(a,b)=>((b-a+540)%360)-180;
 const left=m=>{const j=m?.junction;return j&&delta(j.angle+180,j.exitAngle)<-30;};
 // Negative means a proceeds before b. Equal means use actual arrival order.
 function order(a,b) {
  const A=movement(a),B=movement(b);
  if(!A||!B||A.circle||B.circle||A.intersection!==B.intersection)return 0;
  // At an explicit road join, the curving feeder yields to the established
  // continuing stream. Entered/committed bodies still retain clearance in
  // collision reservations; this does not give permission to force a merge.
  // A STOP/YIELD feeder yields to uncontrolled traffic before any bend rule.
  if(A.junction?.roadMerge&&B.junction?.roadMerge&&Boolean(A.control)!==Boolean(B.control))return A.control?1:-1;
  if(A.junction?.roadMerge&&B.junction?.roadMerge&&Math.abs(A.junction.mergeBend-B.junction.mergeBend)>1)
    return A.junction.mergeBend-B.junction.mergeBend;
  const as=a.signalControl,bs=b.signalControl;
  if(as?.aspect==='flash-red'&&bs?.aspect==='flash-red'&&a.signalMemory?.stoppedAt!=null&&b.signalMemory?.stoppedAt!=null&&Math.abs(a.signalMemory.stoppedAt-b.signalMemory.stoppedAt)>1/60)return a.signalMemory.stoppedAt-b.signalMemory.stoppedAt;
  if(as||bs){const ap=as?.priority??1,bp=bs?.priority??1;if(ap!==bp)return bp-ap;if(ap===2&&bp===2)return 0;}
  // A signal stop bar locates the waiting point; it must not turn equal
  // permissive greens into different STOP/YIELD priorities.
  const ac=!as&&Boolean(A.control),bc=!bs&&Boolean(B.control);
  if(ac!==bc)return ac?1:-1;
  if(A.allWayStop&&B.allWayStop) {
   const at=a.stops?.get(A.control?.marking),bt=b.stops?.get(B.control?.marking);
   if(at!=null&&bt!=null&&Math.abs(at-bt)>1/60+1e-8)return at-bt;
  }
  const aj=A.junction,bj=B.junction;if(!aj||!bj||aj.entry===bj.entry)return 0;
  const angle=delta(aj.angle,bj.angle);
  if(Math.abs(angle)>135&&left(A)!==left(B))return left(A)?1:-1;
  if(A.allWayStop&&B.allWayStop||Math.abs((a.entryETA??0)-(b.entryETA??0))<=1/60) {
   if(angle< -1&&angle> -179)return 1;
   if(angle>1&&angle<179)return -1;
  }
  return 0;
 }
 // Four simultaneous stops can form a circular yield-right dependency. Model
 // one driver's courtesy acceptance only within that unresolved stopped cycle;
 // occupied/committed crossings still take precedence. ID is a repeatable
 // numerical tie-break here, not a Florida right-of-way rule.
 function courtesy(cars,blocked) {
  const waiting=cars.filter(c=>movement(c)?.allWayStop&&ready(c,movement(c))&&!c.reservation),edges=new Map();
  for(const c of waiting)edges.set(c.id,waiting.filter(o=>o!==c&&order(c,o)>0&&blocked(c,o)).map(o=>o.id));
  const reach=new Map();
  for(const c of waiting){const found=new Set(),visit=id=>{for(const next of edges.get(id)??[])if(!found.has(next)){found.add(next);visit(next);}};visit(c.id);reach.set(c.id,found);}
  const result=new Map();
  for(const c of waiting){const group=waiting.filter(o=>o===c||reach.get(c.id).has(o.id)&&reach.get(o.id).has(c.id));
   if(group.length>1&&c.id===Math.min(...group.map(o=>o.id)))result.set(c.id,new Set(group.filter(o=>o!==c).map(o=>o.id)));
  }return result;
 }
 const api={attach,observe,obstacle,ready,order,movement,courtesy};
 if(typeof module!=='undefined')module.exports=api;else globalThis.StripeMaker.simulatorControls=api;
})();
