/* Demand units are presentation; the engine schedules vehicles per minute. */
(() => {
  const units={seconds:1/60,minutes:1,hours:60,days:1440,AADT:1440};
  const MAX_RATE=600,DEFAULT_RATE=12;
  // FHWA TMG glossary: AADT is the annual traffic volume / days in the year.
  // https://www.fhwa.dot.gov/policyinformation/tmguide/tmg_2022/tmg-glossary.cfm
  // Uniform 24-hour demand is this simulator's assumption, not a peak-hour factor.
  const unit=value=>Object.hasOwn(units,value)?value:'minutes';
  const perMinute=volume=>volume.amount/units[unit(volume.unit)];
  const amount=(rate,value)=>rate*units[unit(value)];
  const valid=volume=>volume&&typeof volume==='object'&&!Array.isArray(volume)&&Object.hasOwn(units,volume.unit)&&
    Number.isFinite(volume.amount)&&volume.amount>=0&&perMinute(volume)<=MAX_RATE+1e-9;
  const mode=spawn=>['total','weights'].includes(spawn?.routeVolumeMode)?spawn.routeVolumeMode:'percent';
  const baseRate=spawn=>spawn?.rate??(spawn?.outputs?Math.min(MAX_RATE,Object.values(spawn.outputs).reduce((a,b)=>a+b,0)):DEFAULT_RATE);
  const weights=spawn=>(spawn.routes??[]).map(route=>mode(spawn)==='percent'?(route.percent??1):valid(route.volume)?perMinute(route.volume):0);
  const rate=spawn=>mode(spawn)==='total'?weights(spawn).reduce((a,b)=>a+b,0):baseRate(spawn);
  function shares(spawn){
    const routes=spawn?.routes??[],values=weights(spawn??{}),total=values.reduce((a,b)=>a+b,0);
    return routes.map((route,i)=>({...route,percent:total?100*values[i]/total:mode(spawn)==='percent'?100/routes.length:0}));
  }
  function sync(spawn){
    if(mode(spawn)==='percent')return;
    const values=shares(spawn);(spawn.routes??[]).forEach((r,i)=>r.percent=values[i].percent);
    if(mode(spawn)==='total')spawn.rate=rate(spawn);
  }
  function setMode(spawn,next){
    spawn.routes??=[];
    const old=mode(spawn),total=rate(spawn),routes=shares(spawn);
    if(next!=='percent'&&old==='percent')spawn.routes.forEach((r,i)=>{
      r.volume={amount:amount(total*routes[i].percent/100,spawn.rateUnit),unit:unit(spawn.rateUnit)};
    });
    if(next==='percent'){
      spawn.routes.forEach((r,i)=>r.percent=routes[i].percent);spawn.rate=total;delete spawn.routeVolumeMode;
    }else {spawn.routeVolumeMode=next;sync(spawn);}
  }
  const api={units,unit,perMinute,amount,valid,mode,rate,shares,sync,setMode,MAX_RATE};
  (globalThis.StripeMaker??={}).simulatorVolumes=api;
  if(typeof module!=='undefined')module.exports=api;
})();
