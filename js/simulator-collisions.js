/* Vehicle geometry and collision safeguards, not a calibrated driver model.
   Rectangles match the visible sprite (lane minus 2 ft, capped at a 12 ft lane; aspect 381/214).
   Swept separating-axis tests cover the entire fixed physics step, including
   path knots. No frame-end-only test or speed-dependent tunnelling.
   IDM/MOBIL provide behavioral acceleration/gaps; these are numerical guards.
   Roundabout entry yields to circulation: https://www.fdot.gov/agencyresources/roundabouts/faq.shtm
   Florida statutory priority is supplied by simulator-controls.js. Remaining
   unspecified numerical ties use ID; gap acceptance is not site calibrated. */
(() => {
 const Gaps=typeof module!=='undefined'?require('./simulator-gaps.js'):globalThis.StripeMaker.simulatorGaps;
 const Curves=typeof module!=='undefined'?require('./simulator-curves.js'):globalThis.StripeMaker.simulatorCurves;
 const Controls=typeof module!=='undefined'?require('./simulator-controls.js'):globalThis.StripeMaker.simulatorControls;
 // Bodies stay the size they have on a 12 ft lane: wider lanes never grow the car.
 const width=(car,ppf)=>Math.max(ppf,Math.min(Number.isFinite(car.laneWidth)?car.laneWidth:12*ppf,12*ppf)-2*ppf)+(car.bodyPad??0);
 function sample(car,distance=car.pathDistance??0){
  const path=car.path;if(!path||path.points.length<2)return {...car};
  const d=Math.max(0,Math.min(path.length,distance));let lo=1,hi=path.lengths.length-1;
  while(lo<hi){const mid=(lo+hi)>>1;if(path.lengths[mid]<d)lo=mid+1;else hi=mid;}
  const a=path.points[lo-1],b=path.points[lo],f=(d-path.lengths[lo-1])/(path.lengths[lo]-path.lengths[lo-1]||1);
  let heading=lo;
  while(heading<path.points.length-1&&path.lengths[heading]-path.lengths[heading-1]<=1e-8)heading++;
  while(heading>1&&path.lengths[heading]-path.lengths[heading-1]<=1e-8)heading--;
  const h0=path.points[heading-1],h1=path.points[heading];
  return {x:a.x+(b.x-a.x)*f,y:a.y+(b.y-a.y)*f,angle:Math.atan2(h1.y-h0.y,h1.x-h0.x)*180/Math.PI,
   laneWidth:(a.laneWidth??b.laneWidth??car.laneWidth)+( (b.laneWidth??a.laneWidth??car.laneWidth)-(a.laneWidth??b.laneWidth??car.laneWidth))*f,
   level:f<.5?(a.level??b.level??1):(b.level??a.level??1),
   intersection:a.intersection===b.intersection?a.intersection:undefined,
   circulating:Boolean(a.circulating&&b.circulating),
   roundaboutPhase:f<.5?a.roundaboutPhase:b.roundaboutPhase,
   speedLimit:Math.min(a.speedLimit??Infinity,b.speedLimit??Infinity),
   road:a.road!=null&&a.road===b.road?a.road:undefined};
 }
 function box(car,ppf){const w=width(car,ppf),r=(car.angle??0)*Math.PI/180;return {x:car.x,y:car.y,u:{x:Math.cos(r),y:Math.sin(r)},v:{x:-Math.sin(r),y:Math.cos(r)},half:w*381/214/2,side:w/2,level:car.level??1};}
 const dot=(a,b)=>a.x*b.x+a.y*b.y;
 const radius=(box,axis)=>box.half*Math.abs(dot(box.u,axis))+box.side*Math.abs(dot(box.v,axis));
 function overlap(a,b,ppf){return overlapBoxes(box(a,ppf),box(b,ppf));}
 function overlapBoxes(A,B){
  if(A.level!==B.level)return false;
  const delta={x:B.x-A.x,y:B.y-A.y};
  return [A.u,A.v,B.u,B.v].every(axis=>Math.abs(dot(delta,axis))<radius(A,axis)+radius(B,axis)-1e-7);
 }
 function swept(a0,a1,b0,b1,ppf){
  const A=box(a0,ppf),B=box(b0,ppf);if(A.level!==B.level)return null;
  const delta={x:b0.x-a0.x,y:b0.y-a0.y},velocity={x:b1.x-b0.x-a1.x+a0.x,y:b1.y-b0.y-a1.y+a0.y};let enter=0,leave=1;
  for(const axis of [A.u,A.v,B.u,B.v]){
   const extent=radius(A,axis)+radius(B,axis)+1e-5*ppf,d=dot(delta,axis),v=dot(velocity,axis);
   if(Math.abs(v)<1e-12){if(Math.abs(d)>=extent)return null;continue;}
   const t1=(-extent-d)/v,t2=(extent-d)/v;enter=Math.max(enter,Math.min(t1,t2));leave=Math.min(leave,Math.max(t1,t2));
   if(enter>leave)return null;
  }
  return enter<=1&&leave>=0?Math.max(0,enter):null;
 }
 function fractions(car,travel){
  if(!(travel>0)||!car.path)return [];
  const start=car.pathDistance??0,end=start+travel,out=[];
  const lengths=car.path.lengths;let lo=0,hi=lengths.length;
  while(lo<hi){const mid=(lo+hi)>>1;if(lengths[mid]<=start)lo=mid+1;else hi=mid;}
  for(let i=lo;i<lengths.length&&lengths[i]<end;i++)out.push((lengths[i]-start)/travel);return out;
 }
 function contact(a,da,b,db,ppf){
  // Stationary, separated bodies cannot acquire a collision from SAT padding.
  if(da===0&&db===0&&!overlap(a,b,ppf))return null;
  const knots=[0,...fractions(a,da),...fractions(b,db),1].sort((x,y)=>x-y);
  for(let i=1;i<knots.length;i++){
   const lo=knots[i-1],hi=knots[i];if(hi-lo<1e-12)continue;
   const mid=(lo+hi)/2,A=sample(a,(a.pathDistance??0)+da*mid),B=sample(b,(b.pathDistance??0)+db*mid);
   const a0=sample(a,(a.pathDistance??0)+da*lo),a1=sample(a,(a.pathDistance??0)+da*hi),b0=sample(b,(b.pathDistance??0)+db*lo),b1=sample(b,(b.pathDistance??0)+db*hi);
   // Heading is constant within each polyline piece, including at its knots.
   const time=swept({...a0,angle:A.angle,laneWidth:Math.max(a0.laneWidth??12*ppf,a1.laneWidth??12*ppf)},a1,{...b0,angle:B.angle,laneWidth:Math.max(b0.laneWidth??12*ppf,b1.laneWidth??12*ppf)},b1,ppf);
   if(time!=null)return lo+(hi-lo)*time;
  }
  return null;
 }
 // Bounds depend only on the path, position, travel and fallback width. Scenes
 // are rebuilt after every reroute, so unchanged cars reuse their box.
 const boundsCache=new WeakMap();
 function bounds(car,travel,ppf){
  if(!car.path||car.path.points.length<2)return boundsOf(car,travel,ppf);
  const key=boundsCache.get(car);
  if(key&&key.path===car.path&&key.distance===car.pathDistance&&key.travel===travel&&key.ppf===ppf&&key.laneWidth===car.laneWidth)return key.value;
  const value=boundsOf(car,travel,ppf);
  boundsCache.set(car,{path:car.path,distance:car.pathDistance,travel,ppf,laneWidth:car.laneWidth,value});return value;
 }
 function boundsOf(car,travel,ppf){
  if(car.path&&car.path.points.length>=2)return pathBounds(car,travel,ppf);
  const at=distance=>sample(car,distance);
  const poses=[at(car.pathDistance??0)];
  for(const f of fractions(car,travel))poses.push(at((car.pathDistance??0)+travel*f));
  poses.push(at((car.pathDistance??0)+travel));
  const out={left:Infinity,right:-Infinity,top:Infinity,bottom:-Infinity};
  for(let i=0;i<poses.length;i++)for(const angle of [poses[i].angle,i+1<poses.length?Math.atan2(poses[i+1].y-poses[i].y,poses[i+1].x-poses[i].x)*180/Math.PI:poses[i].angle]){
   const p=poses[i],r=angle*Math.PI/180,w=width(p,ppf)/2,l=w*381/214,x=Math.abs(Math.cos(r))*l+Math.abs(Math.sin(r))*w,y=Math.abs(Math.sin(r))*l+Math.abs(Math.cos(r))*w;
   out.left=Math.min(out.left,p.x-x);out.right=Math.max(out.right,p.x+x);out.top=Math.min(out.top,p.y-y);out.bottom=Math.max(out.bottom,p.y+y);
  }return out;
 }
 // boundsOf() for a car on a path, streamed: the same knot poses, angles and
 // extents without per-knot objects (it runs for every car each step).
 function pathBounds(car,travel,ppf){
  const path=car.path,points=path.points,lengths=path.lengths,n=lengths.length,start=car.pathDistance??0;
  let left=Infinity,right=-Infinity,top=Infinity,bottom=-Infinity,hint=0,have=false,px=0,py=0,pa=0,pw=0;
  const emit=(x0,y0,w0,angle)=>{
   const r=angle*Math.PI/180,w=w0/2,l=w*381/214,x=Math.abs(Math.cos(r))*l+Math.abs(Math.sin(r))*w,y=Math.abs(Math.sin(r))*l+Math.abs(Math.cos(r))*w;
   left=Math.min(left,x0-x);right=Math.max(right,x0+x);top=Math.min(top,y0-y);bottom=Math.max(bottom,y0+y);
  };
  const take=distance=>{
   const d=Math.max(0,Math.min(path.length,distance));let lo;
   if(hint>0&&d===d){lo=Math.min(Math.max(1,hint),n-1);while(lo>1&&lengths[lo-1]>=d)lo--;while(lo<n-1&&lengths[lo]<d)lo++;}
   else {lo=1;let hi=n-1;while(lo<hi){const mid=(lo+hi)>>1;if(lengths[mid]<d)lo=mid+1;else hi=mid;}}
   hint=lo;
   const a=points[lo-1],b=points[lo],f=(d-lengths[lo-1])/(lengths[lo]-lengths[lo-1]||1);
   let heading=lo;
   while(heading<n-1&&lengths[heading]-lengths[heading-1]<=1e-8)heading++;
   while(heading>1&&lengths[heading]-lengths[heading-1]<=1e-8)heading--;
   const h0=points[heading-1],h1=points[heading];
   const x=a.x+(b.x-a.x)*f,y=a.y+(b.y-a.y)*f,angle=Math.atan2(h1.y-h0.y,h1.x-h0.x)*180/Math.PI,
    laneWidth=(a.laneWidth??b.laneWidth??car.laneWidth)+( (b.laneWidth??a.laneWidth??car.laneWidth)-(a.laneWidth??b.laneWidth??car.laneWidth))*f;
   const w=Math.max(ppf,Math.min(Number.isFinite(laneWidth)?laneWidth:12*ppf,12*ppf)-2*ppf)+0;
   if(have){emit(px,py,pw,pa);emit(px,py,pw,Math.atan2(y-py,x-px)*180/Math.PI);}
   px=x;py=y;pa=angle;pw=w;have=true;
  };
  take(start);
  if(travel>0){
   const end=start+travel;let lo=0,hi=n;
   while(lo<hi){const mid=(lo+hi)>>1;if(lengths[mid]<=start)lo=mid+1;else hi=mid;}
   for(let i=lo;i<n&&lengths[i]<end;i++)take((car.pathDistance??0)+travel*((lengths[i]-start)/travel));
  }
  take(start+travel);
  emit(px,py,pw,pa);emit(px,py,pw,pa);
  return {left,right,top,bottom};
 }
 function scene(cars,ppf,travels=new Map()){
  const cell=64*ppf,grid=new Map(),boxes=new Map();
  // Numeric tile keys (same tiles and traversal order as "x:y" strings).
  const tile=(x,y)=>x*4194304+y;
  for(const car of cars){if(!Number.isFinite(car.x)||!Number.isFinite(car.y))continue;const b=bounds(car,travels.get(car.id)??0,ppf);boxes.set(car.id,b);
   for(let x=Math.floor(b.left/cell);x<=Math.floor(b.right/cell);x++)for(let y=Math.floor(b.top/cell);y<=Math.floor(b.bottom/cell);y++){const key=tile(x,y);let list=grid.get(key);if(!list)grid.set(key,list=[]);list.push(car);}}
  return {cars,ppf,query:b=>{
   const seen=new Set(),out=[];
   for(let x=Math.floor(b.left/cell);x<=Math.floor(b.right/cell);x++)for(let y=Math.floor(b.top/cell);y<=Math.floor(b.bottom/cell);y++){
    const list=grid.get(tile(x,y));if(!list)continue;
    for(const car of list){if(seen.has(car))continue;seen.add(car);const c=boxes.get(car.id);if(c.left<=b.right&&c.right>=b.left&&c.top<=b.bottom&&c.bottom>=b.top)out.push(car);}
   }return out;}};
 }
 function merging(car,ppf=1){
  if(!car.reservation||!car.path)return false;
  const m=car.path.movements?.find(m=>m.circle&&m.intersection===car.entryIntersection);
  const span=width(car,ppf)*381/214*2;
  return Boolean(m&&car.pathDistance>=m.entry-span&&car.pathDistance<=m.entry+span);
 }
 function priority(a,b,ppf=1){
  if(a.entryIntersection!=null&&a.entryIntersection===b.entryIntersection){
   // Numerical clearance for a permission already committed in the local
   // merge. It does not grant priority to a waiting/unadmitted entrant.
   const enteringA=merging(a,ppf),enteringB=merging(b,ppf);
   if(enteringA!==enteringB)return enteringA?-1:1;
  }
  if(a.circulating&&(b.roundaboutPhase==='entry'||b.intersection==null))return -1;
  if(b.circulating&&(a.roundaboutPhase==='entry'||a.intersection==null))return 1;
  const legal=Controls.order(a,b);if(legal)return legal;
  if(Boolean(a.laneChange)!==Boolean(b.laneChange))return a.laneChange?1:-1;
  return a.id-b.id;
 }
 function desiredSpeed(car,global,deceleration,ppf=1){
  const curvatureCar=car.mergeContext?.approachPath&&!(car.laneChange?.progress>1e-6)?{...car,path:car.mergeContext.approachPath}:car;
  const factor=car.driver?.roundaboutFactor??1;
  let desired=Math.min(global,(car.speedLimit??Infinity)*factor);
  for(const entry of car.path?.speedLimits??[]){
   const distance=entry.distance-car.pathDistance;if(distance<0)continue;
   desired=Math.min(desired,Math.sqrt((entry.limit*factor)**2+2*deceleration*distance));break;
  }
  let zone=Infinity;
  let maneuver=Infinity;
  // Personalized route preparation may require a slower, full-duration lane
  // change. Its cap is already personal; do not apply temperature a second time.
  for(const entry of car.path?.maneuverLimits??[]){
   const distance=entry.distance-car.pathDistance;
   if(distance<=1e-7)maneuver=entry.limit;
   else desired=Math.min(desired,Math.sqrt(entry.limit**2+2*deceleration*distance));
  }
  for(const entry of car.path?.zoneLimits??[]){
   const distance=entry.distance-car.pathDistance,limit=entry.limit*(car.driver?.speedFactor??1);
   if(distance<=1e-7)zone=limit;
   else desired=Math.min(desired,Math.sqrt(limit*limit+2*deceleration*distance));
  }
  return Math.min(desired,zone,maneuver,Curves.target(curvatureCar,global,deceleration,ppf));
 }
 function sharedStream(car,other,at,ppf){
  if(!other.path)return true;
  const half=width(other,ppf)*381/214/2,tolerance=Math.min(width(car,ppf),width(other,ppf))/4;
  return [-half,half].every(offset=>{const a=sample(car,at+offset),b=sample(other,(other.pathDistance??0)+offset);return Math.hypot(a.x-b.x,a.y-b.y)<tolerance;});
 }
 // Swept bodies widen by the corner sweep of their heading change in a step.
 function padded(a,b,ppf){const turn=Math.atan2(Math.sin((b.angle-a.angle)*Math.PI/180),Math.cos((b.angle-a.angle)*Math.PI/180));
  const extra=width(a,ppf)*Math.hypot(381/214,1)*Math.abs(Math.sin(turn/2));return {...a,bodyPad:2*extra};}
 function threat(car,world,desired,acceleration,ppf,leaderId){
  if(!car.path)return null;
  // Bounded numerical forecast, not a measured human reaction/perception time.
  const horizon=Math.min(8,(car.driver?.headway??1.6)+car.speed/Math.max(acceleration,1e-6)),distance=Math.min(car.path.length-car.pathDistance,Math.max(car.speed,desired)*horizon);
  let best=null;const own0=[],ownPadded=[];
  world.forecast??=scene(world.cars,ppf,new Map(world.cars.map(other=>[other.id,Math.max(0,other.speed)*8])));
  for(const other of world.forecast.query(bounds(car,distance,ppf))){
   if(other.id===car.id||other.id===leaderId||other.situation?.leader===car.id||other.situation?.collision===car.id||priority(car,other,ppf)<0||(car.level??1)!==(other.level??1))continue;
   // Do not forecast an unadmitted queue as if it could enter freely. Actual
   // circulating/exiting bodies and committed local merges remain observable.
   if(car.entryIntersection!=null&&car.entryIntersection===other.entryIntersection&&
    !((car.circulating||car.roundaboutPhase==='exit')&&(other.circulating||other.roundaboutPhase==='exit'||merging(other,ppf))))continue;
   if(car.road!=null&&car.road===other.road&&car.lane===other.lane&&car.direction===other.direction)continue;
   if(car.road!=null&&car.road===other.road&&!car.laneChange&&!other.laneChange&&sample(car,car.pathDistance+distance).road===car.road&&sample(other,(other.pathDistance??0)+other.speed*horizon).road===other.road)continue;
   // Shared quarter-second forecast samples bound sensing cost. The actual
   // collision guard below remains exact across every path knot in a step.
   world.predictions??=new Map();
   // A planned lane change is not an admitted movement. Forecast the other
   // car only up to its unaccepted steering point; otherwise through traffic
   // brakes for a car that is actually waiting for that very traffic to pass.
   // Active/just-admitted changes and the exact swept-body guard stay visible.
   const pending=other.path?.maneuvers?.find(m=>m.end>other.pathDistance+1e-6&&
    !other.committed?.has?.(m)&&!(other.laneIntent?.road===m.road&&other.laneIntent.from===m.from&&other.laneIntent.to===m.to));
   const admitted=pending?Math.max(0,pending.start-other.pathDistance):Infinity;
   let predictions=world.predictions.get(other.id);
   if(!predictions||predictions.admitted!==admitted){predictions=[sample(other)];predictions.admitted=admitted;world.predictions.set(other.id,predictions);}
   const steps=Math.ceil(horizon/.25);let previousOwn=0,previousOther=0;
   for(let n=1;n<=steps;n++){
    const t=n*.25,accelerating=Math.min(t,Math.max(0,(desired-car.speed)/acceleration));
    const own=Math.min(distance,car.speed*accelerating+.5*acceleration*accelerating*accelerating+Math.min(car.speed+acceleration*accelerating,desired)*(t-accelerating)),theirs=Math.min(admitted,Math.max(0,other.speed*t));
    if(other.path&&(other.pathDistance??0)+previousOther>other.path.length)break;
    // Same stream is handled by IDM with the real moving leader speed.
    // Own samples depend only on n: shared by every candidate (same values).
    own0[n-1]??=sample(car,car.pathDistance+previousOwn);own0[n]??=sample(car,car.pathDistance+own);
    const A0=own0[n-1],A1=own0[n];
    predictions[n]??=sample(other,(other.pathDistance??0)+theirs);
    const B0=predictions[n-1],B1=predictions[n];
    ownPadded[n]??=padded(A0,A1,ppf);predictions.padded??=[];predictions.padded[n]??=padded(B0,B1,ppf);
    const time=swept(ownPadded[n],A1,predictions.padded[n],B1,ppf);
    if(time!=null){
     const at=previousOwn+(own-previousOwn)*time;
     if(car.intersection!=null&&car.intersection===other.intersection&&sharedStream(car,{...other,pathDistance:(other.pathDistance??0)+previousOther+(theirs-previousOther)*time},car.pathDistance+at,ppf))break;
     if(!best||at<best.distance)best={car:other,distance:at};break;
    }
    previousOwn=own;previousOther=theirs;
   }
  }
  return best;
 }
 const routePoses=new WeakMap(),routeConflicts=new WeakMap();
 function movement(car,ppf){
  const key=car.path.source??car.path;let poses=routePoses.get(key);if(poses)return poses;
  poses=[];const path=car.path,step=width(car,ppf)/2;
  for(let i=1;i<path.points.length;i++)if(path.points[i-1].intersection!=null&&path.points[i-1].intersection===path.points[i].intersection){
   const start=path.lengths[i-1],end=path.lengths[i];
   for(let d=start;d<end;d+=step){const pose=sample(car,d);poses.push({...pose,d,body:box(pose,ppf)});}
  }
  routePoses.set(key,poses);return poses;
 }
 function indexConflicts(records){
  // Queries need only the furthest uncleared station on the other path.
  // Index once per route pair instead of rescanning every crossing each step.
  const groups=new Map();for(const record of records){if(!groups.has(record.intersection))groups.set(record.intersection,[]);groups.get(record.intersection).push(record);}
  records.index=new Map();for(const [intersection,group] of groups){
   group.sort((a,b)=>a.a-b.a);const suffix=[];let max=-Infinity;
   for(let i=group.length-1;i>=0;i--){max=Math.max(max,group[i].b);suffix[i]=max;}
   records.index.set(intersection,{stations:group.map(p=>p.a),suffix,records:group});
  }return records;
 }
 // Broad phase over one route's connector poses: candidate indices within
 // reach, ascending, so the exact pairwise checks run in their original order.
 const poseGrids=new WeakMap();
 function poseGrid(poses){
  let grid=poseGrids.get(poses);if(grid)return grid;
  const reach=Math.max(0,...poses.map(q=>q.body.half)),cell=Math.max(1e-6,2*reach),tiles=new Map();
  const key=(intersection,x,y)=>`${intersection}|${x}|${y}`;
  poses.forEach((q,j)=>{const k=key(q.intersection,Math.floor(q.x/cell),Math.floor(q.y/cell));let list=tiles.get(k);if(!list)tiles.set(k,list=[]);list.push(j);});
  grid={near:p=>{
   const r=p.body.half+reach,out=[];
   for(let x=Math.floor((p.x-r)/cell);x<=Math.floor((p.x+r)/cell);x++)for(let y=Math.floor((p.y-r)/cell);y<=Math.floor((p.y+r)/cell);y++){const list=tiles.get(key(p.intersection,x,y));if(list)for(const j of list)out.push(j);}
   return out.length>1?out.sort((m,n)=>m-n):out;}};
  poseGrids.set(poses,grid);return grid;
 }
 function conflicts(a,b,ppf){
  const ka=a.path.source??a.path,kb=b.path.source??b.path;let map=routeConflicts.get(ka);if(!map){map=new WeakMap();routeConflicts.set(ka,map);}if(map.has(kb))return map.get(kb);
  const found=[],others=movement(b,ppf),grid=poseGrid(others);
  for(const p of movement(a,ppf))for(const j of grid.near(p)){const q=others[j];
   if(p.intersection!==q.intersection||p.level!==q.level||Math.hypot(p.x-q.x,p.y-q.y)>p.body.half+q.body.half)continue;
   if(!overlapBoxes(p.body,q.body))continue;
   const radians=p.angle*Math.PI/180,at=p.d+(q.x-p.x)*Math.cos(radians)+(q.y-p.y)*Math.sin(radians);
   if(Math.cos((p.angle-q.angle)*Math.PI/180)>.9&&sharedStream(a,{...b,pathDistance:q.d},at,ppf)){
    const am=a.path.movements.find(m=>m.intersection===p.intersection&&m.start<=p.d&&m.end>=p.d),bm=b.path.movements.find(m=>m.intersection===q.intersection&&m.start<=q.d&&m.end>=q.d);
    // Different entrances merging into one receiving lane still need an
    // acceleration/rear gap. Only an established same-input queue (or ring
    // stream) may hand this space entirely to following observations.
    if(!am?.junction||am.circle||!bm?.junction||bm.circle||am.junction.input===bm.junction.input)continue;
   }
   found.push({a:p.d,b:q.d,intersection:p.intersection});
  }
  indexConflicts(found);map.set(kb,found);let reverse=routeConflicts.get(kb);if(!reverse){reverse=new WeakMap();routeConflicts.set(kb,reverse);}reverse.set(ka,indexConflicts(found.map(p=>({a:p.b,b:p.a,intersection:p.intersection}))));return found;
 }
 const angleSpan=(from,to,direction)=>((direction*(to-from))%(2*Math.PI)+2*Math.PI)%(2*Math.PI);
 // User-requested local-leg observation policy. Gap forecasts use the sampled
 // IDM acceleration and headway, not a fitted site-specific critical-gap table.
 function upstreamLeg(car,other,movement,ppf){
  const context=movement.roundabout;if(!context||!other.circulating)return true;
  const entry=sample(car,movement.entry),target=Math.atan2(entry.y-context.y,entry.x-context.x);
  const span=Math.min(...context.gates.filter(g=>g.id!==context.entry).map(g=>angleSpan(g.angle,target,context.direction)));
  const at=Math.atan2(other.y-context.y,other.x-context.x),ahead=angleSpan(at,target,context.direction);
  // Include the body straddling either end of the immediately upstream leg.
  const margin=width(other,ppf)*381/214/2/Math.max(ppf,Math.hypot(other.x-context.x,other.y-context.y));
  return ahead<=span+margin||ahead>=2*Math.PI-margin;
 }
 function arrival(distance,speed,acceleration,limit){
  if(distance<=0)return 0;
  limit=Math.max(speed,limit);if(!(limit>0))return Infinity;
  const ramp=Math.max(0,(limit-speed)/acceleration),length=speed*ramp+acceleration*ramp*ramp/2;
  return distance<=length?(Math.sqrt(speed*speed+2*acceleration*distance)-speed)/acceleration:ramp+(distance-length)/limit;
 }
 function entryConflict(car,other,movement,ppf,observations){
  if(!upstreamLeg(car,other,movement,ppf))return false;
  const half=width(car,ppf)*381/214/2,otherHalf=width(other,ppf)*381/214/2;
  // Two body lengths beyond the yield line cover the immediate merge. Later
  // route crossings must not reserve the whole roundabout against this entry.
  const limit=movement.entry+4*half,front=observations.get(car.id);
  const constrained=front&&front.gap<limit-car.pathDistance&&front.car.speed<car.entrySpeed;
  const ownAcceleration=(car.driver?.acceleration??.73)*ppf/.3048,otherAcceleration=(other.driver?.acceleration??.73)*ppf/.3048;
  const index=conflicts(car,other,ppf).index.get(movement.intersection);if(!index)return false;
  let lo=0,hi=index.stations.length;
  while(lo<hi){const mid=(lo+hi)>>1;if(index.stations[mid]<car.pathDistance-half)lo=mid+1;else hi=mid;}
  for(let n=lo;n<index.records.length&&index.records[n].a<=limit;n++){
   const record=index.records[n];if(record.b+otherHalf<other.pathDistance)continue;
   // Never assume an occupied crossing will clear on a free-flow forecast.
   if(record.b-otherHalf<=other.pathDistance||constrained)return true;
   const clear=arrival(record.a+half-car.pathDistance,car.speed,ownAcceleration,car.entrySpeed);
   const reach=arrival(record.b-otherHalf-other.pathDistance,other.speed,otherAcceleration,other.entrySpeed);
   if(clear+(car.driver?.headway??1.6)>=reach)return true;
  }return false;
 }
 function reservations(cars,ppf,deceleration,time,acceleration=.73*ppf/.3048,desired=Infinity,observations=new Map(),catalog=null,step=1/30){
  const claims=[],obstacles=new Map(),requests=[],forecasts=new Map();
  const prediction=car=>{
   if(!forecasts.has(car)){const free=desired*(car.driver?.speedFactor??1),a=(car.driver?.acceleration??.73)*ppf/.3048;
    const end=car.path.length;
    forecasts.set(car,Gaps.forecast(car,ppf,free,desiredSpeed,observations.get(car.id),end));}
   return forecasts.get(car);
  };
  const clearance=(car,distance)=>prediction(car)(distance);
  const receivingGap=(car,other,own,opposing)=>{
   if(!own?.junction||!opposing?.junction||own.junction.output!==opposing.junction.output)return false;
   const receiving=(car,m)=>car.path.roadEntries?.find(p=>m.junction.roadMerge
     ? p.distance>=m.start-1e-5&&p.distance<=m.end+1e-5&&`r:${p.road}:${p.lane}`===m.junction.output
     : p.distance>=m.end-1e-5);
   const join=receiving(car,own),otherJoin=receiving(other,opposing);
   if(!join||!otherJoin||join.road!==otherJoin.road||join.lane!==otherJoin.lane||join.direction!==otherJoin.direction)return false;
   const forecast=prediction(car),start=forecast(Math.max(car.pathDistance,join.distance-width(car,ppf)*381/214/2));if(!Number.isFinite(start))return true;
   const ppm=ppf/.3048,p=other.driver??{},a=(p.acceleration??.73)*ppm,b=(p.deceleration??1.67)*ppm,cap=Math.max(other.speed,desired*(p.speedFactor??1));
   const ramp=Math.max(0,(cap-other.speed)/a),ownA=(car.driver?.acceleration??.73)*ppm;
   const until=Math.min(60,start+Math.max(cap,desired*(car.driver?.speedFactor??1))/ownA+(p.headway??1.6));
   for(let t=start;t<=until;t+=.25){
    const mine=forecast.at(t);if(mine.distance>=car.path.length-1e-6)break;
    const accelerating=Math.min(t,ramp),speed=other.speed+a*accelerating,travel=other.speed*accelerating+.5*a*accelerating*accelerating+cap*(t-accelerating);
    const otherStation=(other.pathDistance+travel-otherJoin.distance)*join.direction+otherJoin.station,ownStation=(mine.distance-join.distance)*join.direction+join.station;
    const delta=(ownStation-otherStation)*join.direction;if(delta<0)continue;
    const gap=delta-(width(car,ppf)+width(other,ppf))*381/214/2;
    const wanted=(p.jamGap??2)*ppm+Math.max(0,speed*(p.headway??1.6)+speed*(speed-mine.speed)/(2*Math.sqrt(a*b)));
    const response=a*(1-(speed/cap)**(p.exponent??4)-(wanted/Math.max(.001*ppm,gap))**2);
    if(gap<=0||response< -b)return true;
    // Once the entering car has substantially reached its own cruise target,
    // later differences in desired speed are ordinary following, not a merge.
    if(t>start+(p.headway??1.6)&&mine.speed>=desired*(car.driver?.speedFactor??1)*.95)break;
   }return false;
  };
  for(const car of cars){
   if(!car.path)continue;
   const half=width(car,ppf)*381/214/2;
   const movement=car.path.movements?.find(m=>m.end+half>=car.pathDistance);
   if(!movement){delete car.reservation;delete car.entryCommitted;delete car.entryHold;delete car.entryConflictLine;continue;}
   if(car.entryIntersection!==movement.intersection){delete car.reservation;delete car.entryCommitted;delete car.entryRequestedAt;car.entryIntersection=movement.intersection;}
   car.entrySpeed=Math.min(desired*(car.driver?.speedFactor??1),Math.min(movement.speedLimit??Infinity,Curves.movementLimit(car.path,movement,ppf))*(car.driver?.roundaboutFactor??1));
   // Distinguish the marked/mouth hold from the actual crossing commitment.
   // A permissive turn may wait inside its approach before reaching the first
   // conflicting lane; it must not reserve every opposing lane at the mouth.
   let crossing=Infinity;
   if(movement.junction&&!movement.circle)for(const other of catalog?.length?catalog:cars){
    if(other===car||other.entryIntersection!==movement.intersection||Controls.order(car,other)<=0)continue;
    const om=Controls.movement(other);if(!om)continue;
    const index=conflicts(car,other,ppf).index.get(movement.intersection);if(!index)continue;
    for(const record of index.records)if(catalog?.length||record.a+half>=car.pathDistance&&record.b+width(other,ppf)*381/214/2>=other.pathDistance){crossing=Math.min(crossing,record.a);break;}
   }
   // A STOP entrant accepts its crossing gap at the painted bar. Once its
   // bumper passes that bar on an accepted turn, preserve that turn while it
   // accelerates across a wide/divided approach. Re-arbitrating at an interior
   // conflict point let later arrivals interrupt a driver already proceeding.
   const stoppedEntry=movement.control?.type==='stop';
   const conflictLine=stoppedEntry?movement.entry:Number.isFinite(crossing)?Math.max(movement.entry,
     movement.junction?.roadMerge?crossing-half:crossing-width(car,ppf)/2+half):movement.entry;
   const hold=movement.control&&car.pathDistance+half<=movement.entry+1e-6?movement.entry:conflictLine;
   const distance=hold-car.pathDistance;
   car.entryETA=distance/Math.max(car.speed,ppf);
   if(!Controls.ready(car,movement)){delete car.reservation;continue;}
   // Roundabouts retain the established braking-bound commitment. Ordinary
   // intersections commit at the conflicting lane, so a turn waiting inside
   // its approach does not take priority from opposing through traffic.
   // Use the driver's modeled safe-braking bound (MOBIL; simulator-drivers.js),
   // not the comfortable preference that can commit a fast car at its spawn.
   // Keep one actual physics step of response distance before cancelling becomes unsafe.
   const braking=Math.max(car.driver?.safeBraking??4,car.driver?.deceleration??1.67)*ppf/.3048;
   const stop=car.speed*car.speed/(2*braking)+(car.driver?.jamGap??2)*ppf/.3048+car.speed*step;
   const front=observations.get(car.id)?.car,frontMovement=front&&Controls.movement(front);
   if(front&&!front.reservation&&movement.junction&&!movement.circle&&frontMovement?.junction?.input===movement.junction.input)delete car.reservation;
   car.entryHold=hold;car.entryConflictLine=conflictLine;
   // A bumper resting exactly at the hold is still waiting. The 0.01-ft
   // tolerance prevents numerical creep from turning that wait into priority.
   car.entryCommitted=Boolean(car.reservation&&(movement.junction&&!movement.circle?car.pathDistance+half>conflictLine+.01*ppf:car.pathDistance+half+stop>=conflictLine));
   if(car.entryCommitted){claims.push(car);continue;}
   delete car.reservation;
   if(car.entryRequestedAt==null&&distance>car.speed*car.speed/(2*((car.driver?.deceleration??1.67)*ppf/.3048))+car.speed*(car.driver?.headway??1.6)+2*half)continue;
   car.entryRequestedAt??=time;
   requests.push({car,start:hold,eta:distance/Math.max(car.speed,ppf),half});
  }
  requests.sort((a,b)=>Controls.order(a.car,b.car)||
   (Controls.movement(a.car)?.junction&&!Controls.movement(a.car)?.circle&&Controls.movement(b.car)?.junction&&!Controls.movement(b.car)?.circle?a.eta-b.eta:0)||
   (a.car.entryRequestedAt-b.car.entryRequestedAt)||a.eta-b.eta||a.car.id-b.car.id);
  const blocked=(a,b)=>{
   if(a===b)return false;
   if(a.entryIntersection!==b.entryIntersection)return false;
   const movement=a.path.movements.find(m=>m.intersection===a.entryIntersection&&m.end>=a.pathDistance);
   if(movement?.roundabout)return entryConflict(a,b,movement,ppf,observations);
   const am=Controls.movement(a),bm=Controls.movement(b);
   // Cars sharing an incoming lane form one following stream, including a
   // through car behind a turning car. IDM follows the actual leading body;
   // a turn is not a red signal at the mouth for the rest of that stream.
   if(am?.junction&&!am.circle&&bm?.junction&&!bm.circle&&am.junction.entry===bm.junction.entry&&am.junction.input===bm.junction.input)return false;
   const index=conflicts(a,b,ppf).index.get(a.entryIntersection);if(!index)return false;
   const ordinary=Boolean(movement?.junction&&!movement.circle);
   if(ordinary&&Controls.order(a,b)<0&&!b.entryCommitted)return false;
   // At an all-way STOP, a later stopped driver cannot take an incompatible
   // turn first just because a divided approach places their conflict closer.
   // Keep the first stopped driver's turn until admitted; disjoint movements
   // still proceed together, and entered traffic clears by its actual body.
   if(am?.allWayStop&&bm?.allWayStop&&!b.entryCommitted&&Controls.ready(b,bm)&&Controls.order(a,b)>0){
    const ah=width(a,ppf)*381/214/2,bh=width(b,ppf)*381/214/2;
    if(index.records.some(r=>r.a+ah>=a.pathDistance&&r.b+bh>=b.pathDistance))return true;
   }
   if(ordinary&&receivingGap(a,b,am,bm))return true;
   if(ordinary||movement?.control||Controls.order(a,b)>0) {
    const ah=width(a,ppf)*381/214/2,bh=width(b,ppf)*381/214/2;
    const accelerationFor=c=>(c.driver?.acceleration??.73)*ppf/.3048;
    for(const record of index.records) {
     if(record.a+ah<a.pathDistance||record.b+bh<b.pathDistance)continue;
     const ownEnter=arrival(record.a-ah-a.pathDistance,a.speed,accelerationFor(a),ordinary?desired*(a.driver?.speedFactor??1):a.entrySpeed);
     const ownClear=ordinary?clearance(a,record.a+ah):arrival(record.a+ah-a.pathDistance,a.speed,accelerationFor(a),a.entrySpeed);
     const otherEnter=arrival(record.b-bh-b.pathDistance,b.speed,accelerationFor(b),ordinary?desired*(b.driver?.speedFactor??1):b.entrySpeed);
     const otherClear=ordinary?clearance(b,record.b+bh):arrival(record.b+bh-b.pathDistance,b.speed,accelerationFor(b),b.entrySpeed);
     const constrained=observations.get(b.id)||b.situation?.collision!=null;
     // Use the same margin from either direction: accepting with the turner
     // alone and rejecting with the through driver creates a false hard stop.
     const margin=Math.max(a.driver?.headway??1.6,b.driver?.headway??1.6);
     if(ownEnter<otherClear+margin&&ownClear+margin>otherEnter||constrained&&record.b-bh<=b.pathDistance)return true;
    }
    return false;
   }
   // Retain incompatible space until the rear of each body has passed it;
   // an old free-flow arrival estimate cannot guarantee that clearance.
   const threshold=a.pathDistance-width(a,ppf)*381/214/2;
   let lo=0,hi=index.stations.length;while(lo<hi){const mid=(lo+hi)>>1;if(index.stations[mid]<threshold)lo=mid+1;else hi=mid;}
   return lo<index.stations.length&&index.suffix[lo]+width(b,ppf)*381/214/2>=b.pathDistance;
  };
  // A driver yielding at a road-to-road merge watches the stream it joins
  // beyond the merge envelope: through cars still leaving an upstream
  // junction (e.g. a signal) are on the way and keep priority. Cars that have
  // not yet entered an intersection before the merge are not forecast
  // through it. Same gap forecasts apply.
  const upstream=car=>{
   const m=Controls.movement(car);if(!m?.junction?.roadMerge)return null;
   for(const other of cars){
    if(other===car||!other.path||other.entryIntersection===car.entryIntersection||other.signalControl&&!other.signalControl.allowed)continue;
    const target=other.path.movements?.find(x=>x.intersection===car.entryIntersection&&x.end>=other.pathDistance);if(!target)continue;
    if(other.path.movements.some(x=>x!==target&&!x.junction?.roadMerge&&x.start<target.start&&x.end>=other.pathDistance&&other.pathDistance<x.entry))continue;
    const view=Object.create(other);view.entryIntersection=car.entryIntersection;view.reservation=undefined;view.entryCommitted=false;
    if(Controls.order(car,view)>0&&blocked(car,view))return other;
   }return null;
  };
  const courtesy=Controls.courtesy(requests.map(r=>r.car),blocked);
  for(const request of requests){const {car}=request;
   const front=observations.get(car.id)?.car;
   // A reservation cannot jump an unadmitted vehicle in the same queue. A
   // rear car holding space while its leader waits causes a circular wait.
   const frontMovement=front&&Controls.movement(front);
   // A downstream leader may retain entryIntersection after clearing or
   // replanning past the junction. It remains an IDM leader at its real gap,
   // but cannot hold this entrance as an unadmitted queue head.
   const waitingAtEntry=frontMovement&&front.pathDistance+width(front,ppf)*381/214/2<=frontMovement.entry+1e-6;
   if(front&&front.entryIntersection===car.entryIntersection&&!front.reservation&&!front.circulating&&frontMovement?.junction&&!frontMovement.circle&&Controls.movement(car)?.junction?.input===frontMovement.junction.input){
    // Do not reserve ahead of an unadmitted leader, but keep following it at
    // its real gap instead of manufacturing a second stop at the mouth.
    continue;
   }
   if(front&&waitingAtEntry&&front.entryIntersection===car.entryIntersection&&!front.reservation&&!front.circulating){
    obstacles.set(car.id,{car:{id:front.id,speed:0},gap:Math.max(0,request.start-car.pathDistance-request.half)+(Controls.movement(car)?.control||Controls.movement(car)?.junction&&!Controls.movement(car)?.circle?(car.driver?.jamGap??2)*ppf/.3048:0)});continue;
   }
   // A denied entrant occupies no crossing space. Let another entrance use a
   // clear movement even when its eventual route crosses that waiting car's.
   const other=claims.find(other=>blocked(car,other))??cars.find(other=>other!==car&&other.entryIntersection===car.entryIntersection&&
    !courtesy.get(car.id)?.has(other.id)&&Controls.order(car,other)>0&&Controls.ready(other,Controls.movement(other)??{})&&blocked(car,other))??upstream(car);
   if(other){obstacles.set(car.id,{car:{id:other.id,speed:0},gap:Math.max(0,request.start-car.pathDistance-request.half)+(Controls.movement(car)?.control||Controls.movement(car)?.junction&&!Controls.movement(car)?.circle?(car.driver?.jamGap??2)*ppf/.3048:0)});}
   else {car.reservation=true;claims.push(car);}
  }return obstacles;
 }
 function resolve(updates,ppf){
  const byId=new Map(updates.map(u=>[u.car.id,u])),travels=new Map(updates.map(u=>[u.car.id,u.travel])),world=scene(updates.map(u=>u.car),ppf,travels),pairs=[];
  for(const update of updates)for(const other of world.query(bounds(update.car,update.travel,ppf)))
   if(other.id>update.car.id&&!overlap(update.car,other,ppf))pairs.push([update,byId.get(other.id)]);
  let interventions=0;
  const limit=(yielding,through)=>{
   const clear=travel=>contact(yielding.car,travel,through.car,through.travel,ppf)==null;
   if(!clear(0))return false;
   let lo=0,hi=yielding.travel;for(let n=0;n<16;n++){const mid=(lo+hi)/2;if(clear(mid))lo=mid;else hi=mid;}
   yielding.travel=Math.max(0,lo-1e-4*ppf);yielding.speed=0;yielding.reason='collision-avoidance';yielding.collisionWith=through.car.id;interventions++;return true;
  };
  // Resolve simultaneous trajectories, rather than pretending every car not
  // processed yet is parked. The latter locks moving streams at curved merges.
  for(let pass=0;pass<=updates.length;pass++){
   let changed=false;
   for(const [a,b] of pairs){
    if(contact(a.car,a.travel,b.car,b.travel,ppf)==null)continue;
    const [through,yielding]=priority(a.car,b.car,ppf)<0?[a,b]:[b,a];
    if(!limit(yielding,through)&&!limit(through,yielding)){
     yielding.travel=0;yielding.speed=0;yielding.reason='collision-avoidance';yielding.collisionWith=through.car.id;
     limit(through,yielding);
    }
    changed=true;
   }
   if(!changed)return interventions;
  }
  // Contain an unresolved chain locally. Stopping unrelated vehicles across
  // the entire sheet is not collision avoidance and creates phantom queues.
  const freeze=(update,other)=>{if(update.travel===0&&update.speed===0)return false;update.travel=0;update.speed=0;update.reason='collision-avoidance';update.collisionWith=other.car.id;interventions++;return true;};
  for(let pass=0;pass<=updates.length;pass++){
   let changed=false;
   for(const [a,b] of pairs)if(contact(a.car,a.travel,b.car,b.travel,ppf)!=null){changed=freeze(a,b)||changed;changed=freeze(b,a)||changed;}
   if(!changed)break;
  }return interventions;
 }
 const api={width,sample,box,overlap,swept,contact,bounds,scene,priority,desiredSpeed,sharedStream,threat,reservations,resolve};
 (globalThis.StripeMaker??={}).simulatorCollisions=api;
 if(typeof module!=='undefined')module.exports=api;
})();
