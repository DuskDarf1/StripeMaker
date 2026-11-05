/* Paired sheet match lines. SignalMaker editor/field/button conventions, GPL-3.0.
   Road continuations are ordinary editable roads; no simulator connections cross sheets. */
(() => {document.addEventListener('DOMContentLoaded',()=>{
 const A=StripeMaker,S=A.sheets,R=A.roadEditor,W=A.roadWidths,get=id=>document.getElementById(id),panel=get('matchLineEditor'),workspace=get('workspace');
 const overlay=document.createElement('div');overlay.className='markingOverlay matchLineOverlay';S.addOverlay(overlay);
 let pending=null,selected=null,selectedSheet=null,cursor=null;
 const uuid=()=>crypto.randomUUID(),rad=a=>a*Math.PI/180,rotate=(p,a)=>({x:p.x*Math.cos(rad(a))-p.y*Math.sin(rad(a)),y:p.x*Math.sin(rad(a))+p.y*Math.cos(rad(a))});
 const svg=(tag,attrs,parent)=>{const n=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,v);parent.append(n);return n;};
 const status=t=>get('matchLineStatus').textContent=t,active=()=>!panel.hidden,ppf=s=>12/s.inchesPerPixel;
 const current=()=>selectedSheet===S.selected?(S.selected?.matchLines??[]).find(l=>l.id===selected):null;
 const peer=l=>{const sheet=S.all.find(s=>s.id===l.peerSheet);return {sheet,line:sheet?.matchLines?.find(p=>p.id===l.peerId)};};
 function candidates(sheet){
  if(!sheet?.inchesPerPixel)return [];
  const section=R.crossSection(sheet),solved=R.solve(sheet),out=[];
  for(const road of sheet.roads)for(const e of [0,1]){
   const end=R.intersectionEnd(sheet,{road:road.id,e},solved);if(!end?.terminal)continue;
   const shape=section(road),at=points=>points[e?points.length-1:0],left=at(shape.left),right=at(shape.right),line=shape.line;
   const a=e?line.at(-2):line[1],b=at(line),length=Math.hypot(b.x-a.x,b.y-a.y);if(!length)continue;
   out.push({road:road.id,e,x:(left.x+right.x)/2,y:(left.y+right.y)/2,left,right,outward:{x:(b.x-a.x)/length,y:(b.y-a.y)/length}});
  }return out;
 }
 function capture(sheet,refs){
  const available=candidates(sheet),ends=refs.map(ref=>available.find(e=>e.road===ref.road&&e.e===ref.e));
  if(!ends.length||ends.some(e=>!e))throw Error('Choose free road ends. An attached or tapered end cannot be a match line.');
  const u=ends[0].outward;
  if(ends.some(e=>e.outward.x*u.x+e.outward.y*u.y<.94))throw Error('Choose ends facing the same side of the sheet.');
  for(const end of ends){const road=sheet.roads.find(r=>r.id===end.road),partner=R.pairOf(sheet,road);
   if(partner&&!refs.some(r=>r.road===partner.id&&partner.ends[r.e].joint===road.ends[end.e].joint))throw Error('Click the other direction of this divided roadway too.');
  }
  const points=ends.flatMap(e=>[e.left,e.right]),center={x:ends.reduce((s,e)=>s+e.x,0)/ends.length,y:ends.reduce((s,e)=>s+e.y,0)/ends.length},v={x:-u.y,y:u.x};
  const across=points.map(p=>(p.x-center.x)*v.x+(p.y-center.y)*v.y),lo=Math.min(...across)-10*ppf(sheet),hi=Math.max(...across)+10*ppf(sheet),mid=(lo+hi)/2;
  center.x+=v.x*mid;center.y+=v.y*mid;
  return {center,angle:Math.atan2(v.y,v.x)*180/Math.PI,width:hi-lo,outward:u,ends};
 }
 function update(){
  const s=S.selected,line=current(),placing=!!pending;
  get('addMatchLine').disabled=!s?.inchesPerPixel||placing;
  get('finishMatchRoads').hidden=!pending||pending.stage!=='roads';get('finishMatchRoads').disabled=!pending?.refs.length;
  get('cancelMatchLine').hidden=!placing;get('matchPlacementFields').hidden=!placing;
  get('deleteMatchLine').disabled=!line||placing;
  if(line&&document.activeElement!==get('matchLineName'))get('matchLineName').value=line.name;
  const list=get('matchLineList');list.replaceChildren();
  for(const l of s?.matchLines??[]){const b=document.createElement('button');b.type='button';b.textContent=`${l.name} · ${peer(l).sheet?.name??'Missing sheet'}`;b.setAttribute('aria-pressed',String(l.id===selected));b.onclick=()=>{selected=l.id;selectedSheet=s;update();refreshOverlay();};list.append(b);}
 }
 function cancel(){pending=null;cursor=null;status('Match line placement canceled.');update();refreshOverlay();}
 function start(){if(!S.selected?.inchesPerPixel)return;selected=null;pending={stage:'roads',sheet:S.selected,refs:[]};cursor=null;get('matchLineName').value=`${S.all.reduce((n,s)=>n+(s.matchLines?.length??0),0)/2+1}`;get('matchPlacementAngle').value=get('matchPlacementAngleValue').value=0;status('Click the road ends to include. Click both directions for a divided roadway, then Use Selected Road Ends.');update();refreshOverlay();}
 function finish(){try{pending.geometry=capture(pending.sheet,pending.refs);pending.stage='place';status('Switch to another scaled sheet, then click to place the paired match line and road continuations.');update();refreshOverlay();}catch(e){status(e.message);}}
 function place(point){
  const target=S.selected,source=pending.sheet;if(target===source){status('Switch to another sheet before placing the other match line.');return;}
  if(!target?.inchesPerPixel){status('Set this sheet’s scale before placing the match line.');return;}
  if(point.x<0||point.y<0||point.x>target.width||point.y>target.height){status('Place the match line inside the sheet.');return;}
  const length=get('matchStubLength').valueAsNumber,angle=get('matchPlacementAngleValue').valueAsNumber;
  if(!get('matchStubLength').checkValidity()||!get('matchPlacementAngleValue').checkValidity()||!Number.isFinite(length+angle))return;
  let geometry;try{geometry=capture(source,pending.refs);}catch(e){status(e.message);return;}
  const ratio=source.inchesPerPixel/target.inchesPerPixel,transform=p=>{const q=rotate({x:(p.x-geometry.center.x)*ratio,y:(p.y-geometry.center.y)*ratio},angle);return {x:point.x+q.x,y:point.y+q.y};};
  const u=rotate(geometry.outward,angle),roadMap=new Map(),jointMap=new Map(),roads=[],joints=[];
  let roadId=Math.max(0,...target.roads.map(r=>r.id))+1,jointId=Math.max(0,...target.joints.map(j=>j.id))+1;
  for(const ref of pending.refs)roadMap.set(ref.road,roadId++);
  for(const ref of pending.refs){const original=source.roads.find(r=>r.id===ref.road),at=source.joints.find(j=>j.id===original.ends[ref.e].joint);
   if(!jointMap.has(at.id)){
    const mouth=geometry.ends.find(e=>e.road===ref.road&&e.e===ref.e),sign=(ref.e?1:-1)*original.ends[ref.e].sign;
    const here=transform(at),dir=rotate({x:mouth.outward.x*sign,y:mouth.outward.y*sign},angle);
    const common={root:roadMap.get(at.root)??roadMap.get(ref.road),dir,links:at.links.filter(l=>roadMap.has(l.a)&&roadMap.has(l.b)).map(l=>({...l,a:roadMap.get(l.a),b:roadMap.get(l.b)}))};
    const start={...structuredClone(common),...here,id:jointId++},end={...structuredClone(common),x:here.x+u.x*length*ppf(target),y:here.y+u.y*length*ppf(target),id:jointId++};joints.push(start,end);jointMap.set(at.id,{start,end});
   }
   const pair=jointMap.get(at.id),ids=ref.e?[pair.start.id,pair.end.id]:[pair.end.id,pair.start.id],widths=Array.from({length:original.lanes},(_,lane)=>W.endWidth(source,original,ref.e,lane));
   const road={id:roadMap.get(ref.road),lanes:original.lanes,laneWidth:original.laneWidth,perLaneWidths:true,laneWidths:Object.fromEntries(widths.map((w,lane)=>[lane,w])),laneTypes:structuredClone(original.laneTypes??{}),ends:ids.map(joint=>({joint,sign:original.ends[ref.e].sign,length:null})),tapers:Object.fromEntries([0,1].flatMap(e=>widths.map((_,lane)=>[`${e}:${lane}`,{mode:'none'}])))};
   const gaps=W.endGaps(source,original,ref.e);road.gapProfiles=Object.fromEntries(gaps.map((g,k)=>[k,{start:g.width,end:g.width,from:0,to:1,surface:g.surface}]).filter(([,g])=>g.start));
   roads.push(road);
  }
  const name=get('matchLineName').value.trim()||'Match line',a={id:uuid(),name,x:geometry.center.x,y:geometry.center.y,angle:geometry.angle,width:geometry.width,roads:structuredClone(pending.refs)},b={id:uuid(),name,x:point.x,y:point.y,angle:geometry.angle+angle,width:geometry.width*ratio,roads:pending.refs.map(ref=>({road:roadMap.get(ref.road),e:1-ref.e}))};
  Object.assign(a,{peerSheet:target.id,peerId:b.id});Object.assign(b,{peerSheet:source.id,peerId:a.id});
  target.roads.push(...roads);target.joints.push(...joints);(source.matchLines??=[]).push(a);(target.matchLines??=[]).push(b);
  pending=null;cursor=null;selected=b.id;selectedSheet=target;S.save(source);S.save(target);A.history.record();R.render();update();status('Match lines linked. Click either match line to visit the other sheet. Continue the new roads with Elements.');
 }
 function lineGeometry(sheet,line){try{const g=capture(sheet,line.roads);return {...line,x:g.center.x,y:g.center.y,angle:g.angle,width:g.width};}catch{return line;}}
 function endpoints(l){const u=rotate({x:l.width/2,y:0},l.angle);return [{x:l.x-u.x,y:l.y-u.y},{x:l.x+u.x,y:l.y+u.y}];}
 function drawLine(sheet,line,parent,preview=false){
  const l=lineGeometry(sheet,line),[a,b]=endpoints(l),k=ppf(sheet),stroke=Math.max(.12*k,.5),name=`MATCH LINE ${l.name} — ${peer(l).sheet?.name??(preview?'PLACE ON OTHER SHEET':'MISSING SHEET')}`;
  const d=`M${a.x} ${a.y} L${b.x} ${b.y}`,g=svg('g',{class:preview?'preview':'matchLine','data-match-line':l.id??'preview'},parent);
  svg('path',{d,fill:'none',stroke:'#fff','stroke-width':stroke*4},g);svg('path',{d,fill:'none',stroke:'#000','stroke-width':stroke,'stroke-dasharray':`${5*k} ${2*k}`},g);
  const layout=A.engineeringText.layout(name),height=3*k,scale=height/layout.height;let angle=((l.angle+360)%360);if(angle>90&&angle<270)angle+=180;
  const n=rotate({x:0,y:-(height+2*k)},angle),x=l.x+n.x,y=l.y+n.y;
  for(const path of A.engineeringText.paths(name))svg('path',{...path,d:A.signLayout.path(path.d,scale,-layout.width*scale/2,-height/2,angle,x,y)},g);
 }
 function draw(sheet,parent){if(!sheet.inchesPerPixel)return;for(const line of sheet.matchLines??[])drawLine(sheet,line,parent);}
 function visit(line){const other=peer(line);if(!other.sheet||!other.line){A.showEditor('matchLineEditor');selected=line.id;selectedSheet=S.selected;update();status('The linked sheet or match line is missing.');return;}
  const l=lineGeometry(other.sheet,other.line),rect=get('previewStage').getBoundingClientRect(),scale=other.sheet.view?.scale??1;other.sheet.view={x:rect.width/2-l.x*scale,y:rect.height/2-l.y*scale,scale,fitted:false};S.select(other.sheet);
 }
 function refreshOverlay(){
  overlay.replaceChildren();const sheet=S.selected;if(!sheet?.inchesPerPixel)return;
  const root=svg('svg',{},overlay),g=svg('g',{transform:`translate(${sheet.view.x} ${sheet.view.y}) scale(${sheet.view.scale})`},root);
  for(const line of sheet.matchLines??[]){const l=lineGeometry(sheet,line),[a,b]=endpoints(l),hit=svg('path',{d:`M${a.x} ${a.y} L${b.x} ${b.y}`,fill:'none',stroke:'transparent','stroke-width':20/sheet.view.scale,tabindex:0,role:'link','aria-label':`Match line ${line.name}: go to ${peer(line).sheet?.name??'missing sheet'}`,class:'matchLineHit'},g);hit.addEventListener('pointerdown',e=>{e.preventDefault();e.stopPropagation();});hit.onclick=e=>{e.stopPropagation();if(!pending)visit(line);};hit.onkeydown=e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();if(!pending)visit(line);}};}
  if(!pending)return;
  if(pending.stage==='roads'&&pending.sheet===sheet){for(const end of candidates(sheet)){const b=document.createElement('button'),at=S.toScreen(end),chosen=pending.refs.some(r=>r.road===end.road&&r.e===end.e);b.type='button';b.className='roadHandle matchEnd';b.textContent=chosen?'✓':'+';b.setAttribute('aria-label',`Road ${end.road} ${end.e?'end':'start'}`);b.setAttribute('aria-pressed',String(chosen));Object.assign(b.style,{left:`${at.x}px`,top:`${at.y}px`});b.onpointerdown=e=>{e.preventDefault();e.stopPropagation();};b.onclick=e=>{e.stopPropagation();pending.refs=chosen?pending.refs.filter(r=>!(r.road===end.road&&r.e===end.e)):[...pending.refs,{road:end.road,e:end.e}];update();refreshOverlay();};overlay.append(b);}}
  if(pending.stage==='place'&&sheet===pending.sheet){const source=pending.geometry;drawLine(sheet,{x:source.center.x,y:source.center.y,angle:source.angle,width:source.width,name:get('matchLineName').value,roads:pending.refs},g,true);}
  if(pending.stage==='place'&&sheet!==pending.sheet&&cursor){
   const source=pending.geometry,angle=+get('matchPlacementAngleValue').value,ratio=pending.sheet.inchesPerPixel/sheet.inchesPerPixel,u=rotate(source.outward,angle),length=(+get('matchStubLength').value||100)*ppf(sheet);
   const transform=p=>{const q=rotate({x:(p.x-source.center.x)*ratio,y:(p.y-source.center.y)*ratio},angle);return {x:cursor.x+q.x,y:cursor.y+q.y};};
   for(const end of source.ends){const a=transform(end.left),b=transform(end.right),c={x:b.x+u.x*length,y:b.y+u.y*length},d={x:a.x+u.x*length,y:a.y+u.y*length};svg('path',{class:'preview',d:`M${a.x} ${a.y} L${b.x} ${b.y} L${c.x} ${c.y} L${d.x} ${d.y} Z`,fill:'#555',opacity:.35,stroke:'#000','stroke-width':1/sheet.view.scale},g);}
   drawLine(sheet,{x:cursor.x,y:cursor.y,angle:source.angle+angle,width:source.width*ratio,name:get('matchLineName').value,roads:[]},g,true);
  }
 }
 get('openMatchLines').onclick=()=>{A.showEditor('matchLineEditor');update();refreshOverlay();};get('addMatchLine').onclick=start;get('finishMatchRoads').onclick=finish;get('cancelMatchLine').onclick=cancel;
 get('deleteMatchLine').onclick=()=>{const line=current();if(!line)return;const s=S.selected,other=peer(line);s.matchLines=s.matchLines.filter(l=>l!==line);if(other.sheet&&other.line){other.sheet.matchLines=other.sheet.matchLines.filter(l=>l!==other.line);S.save(other.sheet);}selected=null;S.save(s);A.history.record();R.render();update();status('Paired match lines removed. Road continuations remain editable.');};
 get('matchLineName').onchange=()=>{const line=current();if(!line)return;line.name=get('matchLineName').value.trim()||'Match line';const other=peer(line);if(other.line){other.line.name=line.name;S.save(other.sheet);}S.save(S.selected);A.history.record();R.render();update();};
 get('matchStubLength').oninput=refreshOverlay;
 for(const id of ['matchPlacementAngle','matchPlacementAngleValue'])get(id).oninput=e=>{if(e.target.checkValidity()){get('matchPlacementAngle').value=get('matchPlacementAngleValue').value=e.target.value;refreshOverlay();}};
 workspace.addEventListener('pointerdown',e=>{if(!pending||e.button!==0||e.target.closest('.matchEnd'))return;if(pending.stage==='place'){e.preventDefault();e.stopImmediatePropagation();place(S.toImage(e.clientX,e.clientY));}else if(e.target.closest('#previewStage')){e.preventDefault();e.stopImmediatePropagation();}},true);
 workspace.addEventListener('pointermove',e=>{if(pending?.stage==='place'){cursor=S.toImage(e.clientX,e.clientY);refreshOverlay();}});
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&pending){e.preventDefault();e.stopImmediatePropagation();cancel();}},true);
 for(const event of ['sheetchange','sheethistory'])document.addEventListener(event,()=>{if(selectedSheet!==S.selected)selected=null;cursor=null;if(pending&&!S.all.includes(pending.sheet))pending=null;if(event==='sheethistory')pending=null;if(pending?.stage==='place'&&S.selected!==pending.sheet){A.showEditor('matchLineEditor');status('Click to place the paired match line. Adjust rotation or continuation length here first.');}update();refreshOverlay();});
 document.addEventListener('sheetview',refreshOverlay);new MutationObserver(()=>{update();refreshOverlay();}).observe(panel,{attributes:true,attributeFilter:['hidden']});
 A.matchLines={draw,refreshOverlay,candidates,capture,diagnostics:()=>({pending:pending?{stage:pending.stage,sheet:pending.sheet.id,refs:structuredClone(pending.refs)}:null,selected}),visit};update();R.render();
});})();
