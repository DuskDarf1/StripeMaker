/* Predict crossing clearance using the same personal IDM/curve preferences as
   playback. Headway/a/b come from simulator-drivers.js and its cited sources.
   This is a numerical forecast, not a calibrated critical-gap distribution.
   Other traffic's earliest arrival remains a conservative accelerating bound. */
(() => {
 function forecast(car,ppf,free,desiredSpeed,observation,end){
  const ppm=ppf/.3048,p=car.driver??{},a=(p.acceleration??.73)*ppm,b=(p.deceleration??1.67)*ppm,s0=(p.jamGap??2)*ppm;
  const distances=[car.pathDistance],times=[0],speeds=[car.speed],dt=.125;
  let d=car.pathDistance,v=car.speed,t=0;
  const virtual={...car,speedLimit:undefined};
  for(let i=0;i<480&&d<end;i++){
   virtual.pathDistance=d;virtual.speed=v;
   const target=desiredSpeed(virtual,free,b,ppf);
   let acceleration=target>0?a*(1-(v/target)**(p.exponent??4)):-b;
   let gap=Infinity;
   if(observation){const lead=observation.car.speed??0;gap=observation.gap+lead*t-(d-car.pathDistance);
    const wanted=s0+Math.max(0,v*(p.headway??1.6)+v*(v-lead)/(2*Math.sqrt(a*b)));
    acceleration-=a*(wanted/Math.max(.001*ppm,gap))**2;
   }
   const next=Math.max(0,Math.min(free,v+acceleration*dt));
   let travel=acceleration<0&&next===0?Math.max(0,-v*v/(2*acceleration)):(v+next)*dt/2;
   if(observation)travel=Math.min(travel,Math.max(0,gap-s0)+(observation.car.speed??0)*dt);
   d+=travel;t+=dt;v=next;
   if(d>distances.at(-1)+1e-8||v<=1e-8){distances.push(d);times.push(t);speeds.push(v);}
   if(travel<=1e-8&&v<=1e-8&&(target<=0||observation&&observation.car.speed<=1e-8))break;
  }
  const arrival=distance=>{
   if(distance<=distances[0])return 0;if(distance>distances.at(-1))return Infinity;
   let lo=1,hi=distances.length-1;while(lo<hi){const mid=(lo+hi)>>1;if(distances[mid]<distance)lo=mid+1;else hi=mid;}
   const f=(distance-distances[lo-1])/(distances[lo]-distances[lo-1]||1);return times[lo-1]+f*(times[lo]-times[lo-1]);
  };
  const at=time=>{let lo=1,hi=times.length-1;if(time<=0)return {distance:distances[0],speed:speeds[0]};if(time>=times.at(-1))return {distance:distances.at(-1),speed:speeds.at(-1)};
   while(lo<hi){const mid=(lo+hi)>>1;if(times[mid]<time)lo=mid+1;else hi=mid;}
   const f=(time-times[lo-1])/(times[lo]-times[lo-1]||1);return {distance:distances[lo-1]+f*(distances[lo]-distances[lo-1]),speed:speeds[lo-1]+f*(speeds[lo]-speeds[lo-1])};};
  arrival.at=at;return arrival;
 }
 const api={forecast};if(typeof module!=='undefined')module.exports=api;else globalThis.StripeMaker.simulatorGaps=api;
})();
