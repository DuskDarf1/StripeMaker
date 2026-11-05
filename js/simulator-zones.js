/* Road-section speed zones. Fractions follow road centerline arc length.
   Editor controls reuse SignalMaker's headActions/fieldRow/dimensionInputs. */
(() => {
 const DEFAULT_MPH=30; // Initial editable local section speed, not a global cap.
 const envelope=sheet=>(sheet.speedZones??[]).reduce((maximum,z)=>Math.max(maximum,z.mph),DEFAULT_MPH);
 const planningSpeed=sheet=>{const speeds=(sheet.roads??[]).flatMap(road=>sections(sheet.speedZones??[],road.id).map(s=>s.mph??DEFAULT_MPH)).filter(speed=>speed>0);return speeds.length?Math.min(...speeds):1;}; // Positive topology seed even when every section is stopped.
 const measure=line=>line.reduce((a,p,i)=>(a.push(i?a[i-1]+Math.hypot(p.x-line[i-1].x,p.y-line[i-1].y):0),a),[]);
 function at(line,lengths,s){let i=1;while(i<line.length-1&&lengths[i]<s)i++;const f=(s-lengths[i-1])/(lengths[i]-lengths[i-1]||1),a=line[i-1],b=line[i];return {x:a.x+(b.x-a.x)*f,y:a.y+(b.y-a.y)*f};}
 function project(line,lengths,p){let best={distance:Infinity,s:0};for(let i=1;i<line.length;i++){const a=line[i-1],b=line[i],dx=b.x-a.x,dy=b.y-a.y,f=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1))),distance=Math.hypot(p.x-a.x-dx*f,p.y-a.y-dy*f);if(distance<best.distance)best={distance,s:lengths[i-1]+f*(lengths[i]-lengths[i-1])};}return best;}
 // Exact nearest-segment lookup for an immutable road geometry snapshot.
 // Bounding boxes only prune impossible candidates; projection arithmetic and
 // earliest-segment ties match project(), including folded/overlapping roads.
 function projector(line,lengths){
  const segments=line.slice(1).map((b,i)=>{const a=line[i];return {i,a,b,dx:b.x-a.x,dy:b.y-a.y,left:Math.min(a.x,b.x),right:Math.max(a.x,b.x),top:Math.min(a.y,b.y),bottom:Math.max(a.y,b.y)};});
  const build=(lo,hi)=>{
   const node={left:Infinity,right:-Infinity,top:Infinity,bottom:-Infinity,lo,hi};
   for(let i=lo;i<hi;i++){const s=segments[i];node.left=Math.min(node.left,s.left);node.right=Math.max(node.right,s.right);node.top=Math.min(node.top,s.top);node.bottom=Math.max(node.bottom,s.bottom);}
   if(hi-lo>8){const mid=(lo+hi)>>1;node.a=build(lo,mid);node.b=build(mid,hi);}return node;
  };
  const root=build(0,segments.length);
  return p=>{
   let best={distance:Infinity,s:0},index=Infinity;
   const rounding=8*Number.EPSILON*Math.max(1,Math.abs(p.x),Math.abs(p.y),Math.abs(root.left),Math.abs(root.right),Math.abs(root.top),Math.abs(root.bottom));
   const lower=n=>Math.hypot(Math.max(0,n.left-p.x,p.x-n.right),Math.max(0,n.top-p.y,p.y-n.bottom));
   const visit=n=>{
    // Numerical padding retains candidates at floating-point box boundaries.
    if(lower(n)>best.distance+rounding+1e-9*Math.max(1,best.distance))return;
    if(n.a){if(lower(n.a)<=lower(n.b)){visit(n.a);visit(n.b);}else{visit(n.b);visit(n.a);}return;}
    for(let j=n.lo;j<n.hi;j++){const {i,a,dx,dy}=segments[j],f=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1))),distance=Math.hypot(p.x-a.x-dx*f,p.y-a.y-dy*f);
     if(distance<best.distance||distance===best.distance&&i<index){index=i;best={distance,s:lengths[i]+f*(lengths[i+1]-lengths[i])};}}
   };visit(root);return best;
  };
 }
 function sections(zones,road){const items=zones.filter(z=>z.road===road),cuts=[...new Set([0,1,...items.flatMap(z=>[z.from,z.to])])].sort((a,b)=>a-b);return cuts.slice(1).map((to,i)=>{const from=cuts[i],zone=items.findLast(z=>z.from<to&&z.to>from);return {from,to,zone,mph:zone?.mph};});}
 function split(sheet,road,after,f){const made=[];sheet.speedZones=(sheet.speedZones??[]).flatMap(z=>{if(z.road!==road)return [z];if(z.from<f)made.push({...z,to:Math.min(f,z.to)/f,from:z.from/f});if(z.to>f)made.push({...z,id:z.from<f?crypto.randomUUID():z.id,road:after,from:Math.max(0,z.from-f)/(1-f),to:(z.to-f)/(1-f)});return [];}).concat(made);}
 function decorate(points,sheet,geometry,projection=project){
  if(!points)return points;
  const byRoad=new Map();for(const z of sheet.speedZones??[]){if(!byRoad.has(z.road))byRoad.set(z.road,[]);byRoad.get(z.road).push(z);}
  const wholeRoad=new Map([...byRoad].filter(([,zones])=>zones.every(z=>z.from===0&&z.to===1)).map(([road,zones])=>[road,zones.at(-1).mph??DEFAULT_MPH]));
  const fraction=p=>{const g=geometry(p.road);return g?projection(g.line,g.lengths,p,g).s/g.lengths.at(-1):0;};
  const limit=(road,f)=>byRoad.get(road)?.findLast(z=>f>=z.from-1e-9&&f<z.to-1e-9)?.mph??DEFAULT_MPH;
  const out=[];let carried=DEFAULT_MPH;
  for(let i=0;i<points.length;i++){
   // Full-road zones have no interior boundary to insert or project onto.
   if(wholeRoad.has(points[i].road)){carried=wholeRoad.get(points[i].road);out.push({...points[i],zoneLimit:carried*5280/3600*12/sheet.inchesPerPixel});continue;}
   const a=points[i],b=points[i+1],zones=byRoad.get(a.road),fa=zones?fraction(a):0;
   let initial=a.road==null?carried:limit(a.road,Math.max(1e-8,Math.min(1-1e-8,fa))),inserts=[];
   if(zones&&b?.road===a.road){const fb=fraction(b),delta=fb-fa;
    if(Math.abs(delta)>1e-9){initial=limit(a.road,fa+Math.sign(delta)*1e-8);
     for(const f of [...new Set(zones.flatMap(z=>[z.from,z.to]))]){const t=(f-fa)/delta;if(t>1e-8&&t<1-1e-8){const p={...a,x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,station:a.station+(b.station-a.station)*t};if(a.maneuver&&b.maneuver)p.maneuver={...a.maneuver,progress:a.maneuver.progress+(b.maneuver.progress-a.maneuver.progress)*t};inserts.push({t,p:{...p,zoneLimit:limit(a.road,f+Math.sign(delta)*1e-8)*5280/3600*12/sheet.inchesPerPixel}});}}
    }
   }
   carried=initial;
   out.push({...a,zoneLimit:initial==null?undefined:initial*5280/3600*12/sheet.inchesPerPixel},...inserts.sort((a,b)=>a.t-b.t).map(i=>({...i.p,zoneLimit:Number.isFinite(i.p.zoneLimit)?i.p.zoneLimit:undefined})));
  }return out;
 }
 const api={DEFAULT_MPH,envelope,planningSpeed,measure,at,project,projector,sections,split,decorate};
 if(typeof module!=='undefined'){module.exports=api;return;}
 const app=window.StripeMaker??={};app.speedZones=api;
 document.addEventListener('DOMContentLoaded',()=>{
  const sheets=app.sheets,get=id=>document.getElementById(id),workspace=get('workspace'),panel=get('simulatorEditor'),button=get('addSpeedZone');
  const overlay=document.createElement('div');overlay.className='markingOverlay simulatorSpeedZones';sheets.addOverlay(overlay);
  let mode=false,selected=null,drag=null,cacheSheet=null,cache=new Map();
  api.editing=()=>mode;
  const running=()=>app.simulator?.diagnostics().running;
  const geometry=road=>{const sheet=sheets.selected;if(cacheSheet!==sheet){cacheSheet=sheet;cache.clear();}if(!cache.has(road)){const r=sheet.roads.find(r=>r.id===road);if(!r)return null;const g=app.roadEditor.crossSection(sheet)(r);cache.set(road,{...g,lengths:measure(g.line)});}return cache.get(road);};
  const projections=new WeakMap();
  api.decoratePlayback=points=>decorate(points,sheets.selected,geometry,(line,lengths,p,g)=>{
   let lookup=projections.get(g);if(!lookup){lookup=projector(line,lengths);projections.set(g,lookup);}return lookup(p);
  });
  const current=()=>sheets.selected?.speedZones?.find(z=>z.id===selected);
  const svg=(tag,attrs,parent)=>{const e=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v]of Object.entries(attrs))e.setAttribute(k,v);parent.append(e);return e;};
  const slice=(edge,from,to)=>{const lengths=measure(edge),total=lengths.at(-1);return [at(edge,lengths,from*total),...edge.filter((_,i)=>lengths[i]>from*total&&lengths[i]<to*total),at(edge,lengths,to*total)];};
  function render(){
   overlay.replaceChildren();overlay.hidden=panel.hidden||!mode;button.setAttribute('aria-pressed',String(mode));button.disabled=!!running();
   const z=current();get('speedZoneFields').hidden=!mode;get('removeSpeedZone').disabled=!z||!!running();
   for(const id of ['speedZoneMph','speedZoneMphValue']){get(id).disabled=!!running();if(z&&document.activeElement!==get(id))get(id).value=z.mph;}
   if(overlay.hidden||!sheets.selected?.inchesPerPixel)return;
   const root=svg('svg',{'aria-label':'Road speed zones'},overlay),sheet=sheets.selected;
   for(const road of sheet.roads){const g=geometry(road.id);if(!g?.line.length)continue;
    for(const section of sections(sheet.speedZones??[],road.id)){
     const poly=[...slice(g.left,section.from,section.to),...slice(g.right,section.from,section.to).reverse()].map(p=>sheets.toScreen(p));
     svg('path',{d:`M${poly.map(p=>`${p.x},${p.y}`).join('L')}Z`,fill:'none',stroke:'#ffcc00','stroke-width':2},root);
     const p=sheets.toScreen(at(g.line,g.lengths,(section.from+section.to)/2*g.lengths.at(-1))),label=svg('text',{x:p.x,y:p.y,'text-anchor':'middle','dominant-baseline':'middle',fill:'white',stroke:'#172334','stroke-width':3,'paint-order':'stroke',style:'font: 600 12px Inter, sans-serif'},root);label.textContent=`${section.mph??DEFAULT_MPH} mph`;
    }
   }
   if(drag){const g=geometry(drag.road),a=sheets.toScreen(at(g.line,g.lengths,drag.from*g.lengths.at(-1))),b=sheets.toScreen(at(g.line,g.lengths,drag.to*g.lengths.at(-1)));svg('path',{d:`M${a.x},${a.y}L${b.x},${b.y}`,stroke:'#ffcc00','stroke-width':5,opacity:.6},root);}
  }
  function hit(event){const p=sheets.toImage(event.clientX,event.clientY);let best=null;for(const road of sheets.selected?.roads??[]){const g=geometry(road.id),outline=[...g.left,...[...g.right].reverse()];if(!app.intersectionGeometry.contains(p,outline))continue;const level=app.levels.levelAt(sheets.selected,p,road.id);if(!best||level>=best.level)best={road:road.id,f:project(g.line,g.lengths,p).s/g.lengths.at(-1),level};}return best;}
  function changed(){sheets.save(sheets.selected);app.history.record();app.simulator.refreshOverlay();render();}
  button.addEventListener('click',()=>{if(running()||!sheets.selected?.inchesPerPixel)return;app.simulator.cancelPlacement();mode=!mode;selected=null;get('simulatorStatus').textContent=mode?'Drag along a road to set a speed zone. Click a section to edit it. Escape finishes.':'';app.simulator.refreshOverlay(false);render();});
  workspace.addEventListener('pointerdown',e=>{if(!mode||panel.hidden||running()||e.button!==0||e.target.closest('button,input,select'))return;const h=hit(e);if(!h)return;e.preventDefault();e.stopImmediatePropagation();drag={road:h.road,from:h.f,to:h.f,pointer:e.pointerId,x:e.clientX,y:e.clientY};workspace.setPointerCapture(e.pointerId);},true);
  workspace.addEventListener('pointermove',e=>{if(!drag||e.pointerId!==drag.pointer)return;e.preventDefault();e.stopImmediatePropagation();const g=geometry(drag.road);drag.to=project(g.line,g.lengths,sheets.toImage(e.clientX,e.clientY)).s/g.lengths.at(-1);render();},true);
  workspace.addEventListener('pointerup',e=>{if(!drag||e.pointerId!==drag.pointer)return;e.preventDefault();e.stopImmediatePropagation();const d=drag;drag=null;if(workspace.hasPointerCapture(e.pointerId))workspace.releasePointerCapture(e.pointerId);const sheet=sheets.selected;
   if(Math.hypot(e.clientX-d.x,e.clientY-d.y)<5){const section=sections(sheet.speedZones??[],d.road).find(s=>d.from>=s.from&&d.from<=s.to);let z=section?.zone;if(!z&&section){z={id:crypto.randomUUID(),span:crypto.randomUUID(),road:d.road,from:section.from,to:section.to,mph:DEFAULT_MPH};(sheet.speedZones??=[]).push(z);const partner=app.roadEditor.pairOf(sheet,sheet.roads.find(r=>r.id===d.road));if(partner)sheet.speedZones.push({...z,id:crypto.randomUUID(),road:partner.id,from:1-z.to,to:1-z.from});selected=z.id;changed();}else{selected=z?.id??null;render();}return;}
   if(Math.abs(d.to-d.from)*geometry(d.road).lengths.at(-1)<12/sheet.inchesPerPixel){render();return;}
   const z={id:crypto.randomUUID(),span:crypto.randomUUID(),road:d.road,from:Math.min(d.from,d.to),to:Math.max(d.from,d.to),mph:Math.round(Math.max(0,Math.min(85,Number(get('speedZoneMphValue').value)||0))*10)/10};(sheet.speedZones??=[]).push(z);
   const partner=app.roadEditor.pairOf(sheet,sheet.roads.find(r=>r.id===d.road));if(partner)sheet.speedZones.push({...z,id:crypto.randomUUID(),road:partner.id,from:1-z.to,to:1-z.from});
   selected=z.id;changed();
  },true);
  workspace.addEventListener('pointercancel',()=>{drag=null;render();});
  for(const id of ['speedZoneMph','speedZoneMphValue'])get(id).addEventListener('input',e=>{if(running()||e.target.value==='')return;const value=Math.round(Math.max(0,Math.min(85,Number(e.target.value)||0))*10)/10;for(const other of ['speedZoneMph','speedZoneMphValue'])if(other!==id||Number(e.target.value)<0||Number(e.target.value)>85)get(other).value=value;const z=current();if(z){for(const other of sheets.selected.speedZones)if(other===z||z.span&&other.span===z.span)other.mph=value;changed();}});
  get('removeSpeedZone').addEventListener('click',()=>{if(running()||!current())return;const chosen=current();sheets.selected.speedZones=sheets.selected.speedZones.filter(z=>z.id!==selected&&(!chosen.span||z.span!==chosen.span));selected=null;changed();});
  document.addEventListener('keydown',e=>{if(!mode||panel.hidden||e.target.closest('input,textarea,select'))return;if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();drag=null;mode=false;app.simulator.refreshOverlay(false);render();button.focus();}else if(['Delete','Backspace'].includes(e.key)&&current()){e.preventDefault();e.stopImmediatePropagation();get('removeSpeedZone').click();}},true);
  document.addEventListener('sheetview',render);document.addEventListener('settingschange',render);
  for(const event of ['sheetchange','sheethistory'])document.addEventListener(event,()=>{cache.clear();selected=null;drag=null;render();});
  new MutationObserver(()=>{if(panel.hidden){mode=false;drag=null;}render();}).observe(panel,{attributes:true,attributeFilter:['hidden']});
  // Route/spawn tools and playback leave zone creation; one placement mode at a time.
  panel.addEventListener('click',e=>{if(e.target.closest('#playSimulation,#createVehicleSpawnPoint,#addTrafficSignal,#addStopControl,#addYieldControl')){mode=false;drag=null;app.simulator.refreshOverlay(false);render();}});
  api.refresh=()=>{cache.clear();render();};render();
 });
})();
