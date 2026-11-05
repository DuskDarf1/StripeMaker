/* Curvature-based speed preference, not a posted advisory-speed determination.
   FHWA: V²=15 R (e+f), V mph, R feet, e dimensionless.
   https://highways.dot.gov/safety/speed-management/speed-concepts-informational-guide/chapter-4-engineering-and-technical
   Side friction (comfort), AASHTO table reproduced by Iowa DOT:
   https://iowadot.gov/design-manual/chapter-2-alignments/2b-superelevation
   10 mph f=.38: https://www.pa.gov/content/dam/copapwp-pagov/en/penndot/documents/public/pubsforms/publications/pub-13m/april%202021%20change%20no.%206.pdf
   The editor has no banking metadata: assume e=0. Linear interpolation,
   5-ft curvature sampling, and use as a driver target are explicit model choices.
   Personal roundaboutFactor also varies these preferences with temperature. */
(() => {
 const FRICTION=[[10,.38],[15,.32],[20,.27],[25,.23],[30,.20],[35,.18],[40,.16],[45,.15],[50,.14],[55,.13],[60,.12],[65,.11],[70,.10],[75,.09],[80,.08]];
 function friction(mph){
  for(let i=1;i<FRICTION.length;i++)if(mph<=FRICTION[i][0]){const [v0,f0]=FRICTION[i-1],[v1,f1]=FRICTION[i];return mph<v0?f0:f0+(f1-f0)*(mph-v0)/(v1-v0);}
  return FRICTION.at(-1)[1];
 }
 function speedForRadius(feet){
  if(!Number.isFinite(feet))return Infinity;if(!(feet>0))return 0;
  let lo=0,hi=999;for(let i=0;i<24;i++){const mid=(lo+hi)/2;if(mid*mid<=15*feet*friction(mid))lo=mid;else hi=mid;}return lo;
 }
 const cache=new WeakMap();
 function limits(path,ppf){
  if((path?.points?.length??0)<2||!(path.length>0)||!(ppf>0))return [];
  const key=path.source??path;let scales=cache.get(key);if(!scales){scales=new Map();cache.set(key,scales);}if(scales.has(ppf))return scales.get(ppf);
  const samples=[],out=[],step=5*ppf;let segment=1;
  const at=d=>{while(segment<path.points.length-1&&path.lengths[segment]<d)segment++;const a=path.points[segment-1],b=path.points[segment],f=(d-path.lengths[segment-1])/(path.lengths[segment]-path.lengths[segment-1]||1);return {x:a.x+(b.x-a.x)*f,y:a.y+(b.y-a.y)*f,d,circulating:Boolean(a.circulating&&b.circulating)};};
  for(let d=0;d<path.length;d+=step)samples.push(at(d));samples.push(at(path.length));
  for(let i=1;i<samples.length-1;i++){
   const a=samples[i-1],b=samples[i],c=samples[i+1],ux=b.x-a.x,uy=b.y-a.y,vx=c.x-b.x,vy=c.y-b.y;
   const ab=Math.hypot(ux,uy),bc=Math.hypot(vx,vy),ac=Math.hypot(c.x-a.x,c.y-a.y),cross=Math.abs(ux*vy-uy*vx);
   // Circulating spiral paths contain lane-routing/weaving bends, not the
   // roadway alignment. Keep the existing FDOT circulation target (with its
   // personal variation); assess actual entry/exit curves outside the ring.
   const radius=a.circulating||b.circulating||c.circulating?Infinity:cross>1e-10*ab*bc?ab*bc*ac/(2*cross)/ppf:ux*vx+uy*vy<0?0:Infinity;
   out.push({distance:b.d,limit:speedForRadius(radius)*5280/3600*ppf,radius});
  }
  // Infinite straight samples cannot constrain speed. Retain straight guards
  // beside each curved run so the current cap releases at the same station.
  const compact=out.filter((entry,i)=>Number.isFinite(entry.limit)||Number.isFinite(out[i-1]?.limit)||Number.isFinite(out[i+1]?.limit));
  scales.set(ppf,compact);return compact;
 }
 function target(car,global,deceleration,ppf){
  const entries=limits(car.path,ppf);if(!entries.length)return global;
  let lo=0,hi=entries.length;while(lo<hi){const mid=(lo+hi)>>1;if(entries[mid].distance<car.pathDistance)lo=mid+1;else hi=mid;}
  // Read curvature ahead using this driver's existing headway and braking
  // preference. This is planning, not a measured visual-perception delay.
  const lead=Math.max(0,car.speed??0)*(car.driver?.headway??1.6),b=Math.max(1e-6,deceleration),horizon=global*global/(2*b)+lead;
  const factor=car.driver?.roundaboutFactor??1;let desired=global;
  for(let i=Math.max(0,lo-1);i<entries.length;i++){
   const distance=entries[i].distance-car.pathDistance;if(distance>horizon)break;
   const cap=entries[i].limit*factor;
   desired=Math.min(desired,Math.sqrt(cap*cap+2*b*Math.max(0,distance-lead)));
  }return desired;
 }
 const movementCaps=new WeakMap();
 function movementLimit(path,movement,ppf){
  let scales=movementCaps.get(movement);if(!scales){scales=new Map();movementCaps.set(movement,scales);}if(scales.has(ppf))return scales.get(ppf);
  let cap=Infinity;for(const entry of limits(path,ppf))if(entry.distance>=movement.start&&entry.distance<=movement.end)cap=Math.min(cap,entry.limit);
  scales.set(ppf,cap);return cap;
 }
 const api={friction,speedForRadius,limits,target,movementLimit};
 if(typeof module!=='undefined')module.exports=api;else globalThis.StripeMaker.simulatorCurves=api;
})();
