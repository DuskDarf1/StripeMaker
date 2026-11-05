/* Signal editor: SignalMaker's editor, fieldRow, headActions and dimensionInputs
   conventions, GPL-3.0. Head artwork is reused verbatim except lamp illumination.
   The mast's plan silhouette uses SignalMaker's inch-based taper/profile data. */
(() => {
 document.addEventListener('DOMContentLoaded',()=>{
  const A=window.StripeMaker,S=A.sheets,M=A.simulatorSignals,H=window.StripeMakerSignalAssets;
  const get=id=>document.getElementById(id),panel=get('simulatorEditor'),fields=get('signalEditorFields'),status=get('simulatorStatus');
  const overlay=document.createElement('div');overlay.className='markingOverlay signalOverlay';S.addOverlay(overlay);
  const ns='http://www.w3.org/2000/svg',uid=()=>crypto.randomUUID(),rad=a=>a*Math.PI/180;
  let selected=null,selectedSheet=null,part=null,movement=null,selectedPhase=2,placing=null,drag=null,running=false,engine=null,geometry=null,lastPaint=-Infinity;
  let newHeadType='ball',placingMovement=null,headSelection=null,linkBank='main';
  let cancelPhaseDrag=null,suppressPhaseClickUntil=0,phaseDragInProgress=false;
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&phaseDragInProgress){event.preventDefault();event.stopImmediatePropagation();cancelPhaseDrag?.();status.textContent='Phase reorder canceled.';}},true);
  window.addEventListener('blur',()=>cancelPhaseDrag?.());
  const headTypes=[['ball','Circular · 3 sections'],['left','Left arrow · 3 sections'],['right','Right arrow · 3 sections'],['fya-left','Flashing yellow left · 4 sections'],['fya-right','Flashing yellow right · 4 sections'],['doghouse','Doghouse · arrow / circular · 5 sections']];
  const current=()=>selectedSheet===S.selected?(S.selected?.intersections??[]).find(i=>i.id===selected&&i.trafficSignal):null;
  const active=()=>!panel.hidden&&S.selected?.inchesPerPixel;
  const mastHeadsEnabled=()=>A.signalFeatures?.mastHeads===true;
  const ppf=()=>12/S.selected.inchesPerPixel;
  const config=()=>current()?.trafficSignal;
  const world=(item,p)=>{const c=Math.cos(rad(item.rotation??0)),s=Math.sin(rad(item.rotation??0)),k=ppf();return {x:item.x+(p.x*c-p.y*s)*k,y:item.y+(p.x*s+p.y*c)*k};};
  const local=(item,p)=>{const a=rad(-(item.rotation??0)),x=(p.x-item.x)/ppf(),y=(p.y-item.y)/ppf();return {x:x*Math.cos(a)-y*Math.sin(a),y:x*Math.sin(a)+y*Math.cos(a)};};
  const vector=a=>({x:Math.cos(rad(a)),y:Math.sin(rad(a))});
  const svg=(tag,attrs,parent)=>{const e=document.createElementNS(ns,tag);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,v);parent?.append(e);return e;};
  const el=(tag,text,parent,cls)=>{const e=document.createElement(tag);if(text!=null)e.textContent=text;if(cls)e.className=cls;parent?.append(e);return e;};
  // SignalMaker field/picker conventions; the shared top-right help displays
  // descriptions, also exposed to keyboard and screen-reader users.
  const explanations={
    "Detector phases":"Select every phase this detector should call or extend. For a mainline served in phases 1 and 4, select both: detection resets the gap timer of whichever is green and requests the other for its later turn. Delay, extension and locking apply to each assignment. Detection does not override maximum green, coordinated force-offs or phase omit. All selected numbers appear inside the detector.",
    "Operation":"Actuated: detectors and recall request phases. Green lasts at least Minimum green, extends with detections, and can end on a traffic gap or Maximum green when another phase is waiting. Split is not used.\n\nFixed time: enabled phases repeat even without detections. Split sets their total green, yellow and red time; gap and maximum-green settings do not control the normal ending.\n\nCoordinated: phases occupy scheduled slots in a shared cycle. Cycle, splits and offset align nearby signals. Calls/recall still determine service; a phase can gap out early, leaving the rest of its slot red. Scheduled force-offs keep the cycle aligned.",
    "Dual entry":"The two rings run alongside each other; each ring serves one phase at a time. With Dual entry on, a request on one side of a barrier also starts an enabled phase in the other ring, even without a request there. For example, a call for phase 2 can also start phase 6 when it is the other ring’s last enabled phase in that barrier group. With it off, the uncalled ring can stay red. This applies when entering a barrier group in actuated/fixed operation; coordinated operation uses scheduled slots.",
    "Simultaneous gap at barrier":"A barrier is a shared boundary that both rings must clear before serving the next group. In actuated operation, turn this on to wait until both rings’ last phases have a large enough traffic gap before ending them by gap-out. A new detection in either ring can keep that pair serving. With it off, each can gap out separately and wait red for the other. Maximum green and force-offs can still end service; both rings must complete clearance before crossing the barrier.",
    "Phase enabled":"Allow this phase to run. Turning it off skips the phase but retains its timings, detector links and movement assignments. Its movements stay red unless another enabled phase serves them. The matrix +/− buttons control the same setting.",
    "Sequence position":"First or second within this phase’s ring and barrier group. Changing this swaps its position with the other phase in that group. The other ring runs in parallel; phase numbers are identifiers, not one global playback order. Dragging a matrix header changes this same order.",
    "Minimum green":"Shortest green before normal gap-out or force-off can end this phase. For example, 5 seconds guarantees the initial 5 seconds even if detection stops. Added initial can increase this starting time. Continuing movement greens can span more than one phase.",
    "Maximum green":"In actuated operation, limit how long green can continue after another phase requests service. For example, 30 seconds allows up to 30 more seconds once waiting demand starts the timer, even if detections continue. With no waiting demand, green can rest indefinitely. A manual hold overrides this limit. Fixed and coordinated operation use their splits instead.",
    "Passage / gap":"In actuated operation, each active detection resets the gap timer. Once minimum service is complete and another phase is waiting, a gap this long can end green. With 3 seconds, detections less than 3 seconds apart keep extending service until another limit applies. Gap reduction can shorten this allowance. Coordinated gap-out uses this value without reduction; fixed time does not gap out.",
    "Minimum gap":"Smallest gap allowed after gap reduction in actuated operation. For example, Passage / gap = 3 and Minimum gap = 1 gradually reduce the allowed time between detections from 3 seconds to 1. Setting both equal disables reduction. This is a time interval, not vehicle spacing.",
    "Time before reduction":"In actuated operation, wait this many seconds from the start of green before shortening Passage / gap. With 10 seconds, the original gap stays in effect for the first 10 seconds; reduction then begins.",
    "Time to reduce":"Seconds spent gradually reducing Passage / gap to Minimum gap after Time before reduction. For example, a 3-second gap reduced to 1 over 10 seconds is about 2 seconds halfway through. A value of 0 applies the minimum gap immediately when reduction begins. Used in actuated operation.",
    "Yellow change":"Seconds of steady yellow when this phase ends green, before red clearance. For example, 3 gives a 3-second yellow. A movement with matching greens in consecutive served phases keeps green across that transition and clears when its green run ends.",
    "Red clearance":"Seconds of red after yellow before this phase finishes and the next phase may start. Other compatible movements may still be green, so this is not necessarily an intersection-wide all-red interval. Matching continuous greens retain their separate behavior.",
    "Split":"Total phase time: green + yellow + red clearance. For example, a 30-second split with 3 yellow and 1 red leaves 26 seconds for green in fixed time. Coordinated operation reserves a slot this long but can serve less green after a late call or early gap-out. Splits must cover minimum service and clearances. Actuated operation does not use Split to end green.",
    "Added initial per actuation":"Add this many seconds to the initial green for each detector entry counted while this phase is not green. For example, Minimum green = 5 and Added initial = 2 with three entries gives 11 seconds of initial service, subject to Maximum initial. Use 0 to disable this addition. One shared detector can count entries for each assigned phase.",
    "Maximum initial":"Cap the initial green built up by Added initial per actuation. For example, a cap of 20 limits that starting allowance to 20 seconds even with many entries. Minimum green still takes precedence if it is larger. This does not cap later extensions; Maximum green controls those in actuated operation.",
    'Walk':'Time displaying WALK so pedestrians can start crossing.',
    'Flashing hand clearance':'Time displaying a flashing hand for pedestrians already crossing to finish. New crossings should not start.',
    'Pedestrian buffer':'Steady-hand interval after flashing-hand clearance before conflicting traffic can be released.',
    'Leading pedestrian interval':'Give pedestrians WALK before this phase’s vehicle green, allowing them to enter the crossing first.',
    "Recall":"None waits for a detector or manual call.\nMinimum requests service every cycle, then allows gap-out after minimum service.\nMaximum requests service every cycle and prevents gap-out; actuated Maximum green or a coordinated force-off can still end it.\nSoft requests this phase when no other enabled phase has a waiting call.\nFixed time serves every enabled phase regardless of recall. Recall does not override an omitted phase.",
    'Pedestrian recall':'On: request WALK and pedestrian clearance every time this phase receives service, without a button press. Off: pedestrian service normally waits for a pushbutton call. Omit pedestrian service overrides recall; recall does not shorten clearance.',
    'Pedestrian mode':'Actuated serves button calls. Rest in walk keeps WALK on until conflicting demand requires clearance. Omit disables pedestrian service, including recall and button calls.',
    'Exclusive pedestrian phase':'Serve pedestrians while holding vehicle indications red. Vehicle phases in the other ring on this side of the barrier must be omitted or exclusive too.',
    "Call phase":"While playing, request this phase as if a detector had called it. It waits for its place in the ring sequence and required clearances; it does not instantly turn green or enable an omitted phase. The request is consumed when service starts. In coordinated operation it must wait for its scheduled slot.",
    "Hold phase":"While playing, toggle a temporary hold for this phase. When it is green, the hold prevents ordinary gap-out, actuated max-out and fixed-time split termination. It does not call a red phase or bypass clearances. Click again to release. Manual Force off phase and coordinated scheduled force-offs still end green after minimum service.",
    "Force off phase":"While this phase is green, request an end after its required minimum service. Yellow and red clearance still run; this does not instantly switch conflicting traffic to green. It overrides a manual hold. It does not request a phase that is currently red. Use Call phase to request service.",
    'Green phase':'Phase that gives this movement green. Green ball lets left and right turns yield to conflicting traffic. Protected green arrow reserves the movement; conflicting protected greens hold the controller red.',
    'Green indication':'Green ball allows left and right turns to proceed after yielding to conflicting traffic. Protected green arrow keeps protected service and conflict checks. Overlap parents remain protected. Flashing yellow and red are separate per-phase choices.',
    'No turn on red':'Prevent this movement from turning on steady red. When off, eligible red turns may proceed after stopping and yielding. A configured flashing-red indication is a separate stop-then-yield permission.',
    "Coordination group":"Give nearby signals the same group name so Sync group cycle can update them together on this sheet. Typing the name alone changes no timing. A green wave uses a common cycle plus offsets spaced for vehicle travel time.",
    "Cycle":"Seconds for one full coordinated sequence. Each ring’s enabled splits must add to this total, and both rings must have equal totals on each side of each barrier. For example, a 90-second cycle repeats its scheduled slots every 90 simulation seconds. Used only in Coordinated operation.",
    "Offset":"Start time of the first enabled phase in ring 1, measured within the shared cycle. For example, offset 15 starts that signal’s cycle 15 seconds after offset 0. Offsets wrap at the cycle length. Use different offsets along a corridor to let a group of vehicles reach successive greens.",
    "Progression speed":"Assumed vehicle speed for Calculate offset, in mph. Together with the route distance, it estimates travel time from the reference signal. It does not change vehicle speeds or road speed limits. For example, 30 mph covers about 44 feet per second.",
    "Route distance from reference":"Distance vehicles travel from the reference signal to this one, in feet. Use the actual route length for a curved corridor. A value of 0 uses straight-line distance between intersection centers. Calculate offset divides this distance by Progression speed.",
    "Reference signal":"Choose the upstream signal whose offset Calculate offset uses as its starting point. Selecting it does not automatically change either signal’s timing. For useful coordination, use a shared cycle and suitable phase assignments at both intersections.",
    "Calculate offset":"Set this signal’s offset to the reference signal’s offset plus estimated travel time, wrapped within this signal’s cycle. For example, 440 feet at 30 mph adds about 10 seconds. This changes only the offset; it does not change operation mode, splits or movement assignments. Run again after changing distance or speed.",
    "Sync group cycle":"Apply this signal’s cycle length to all signals with the same nonempty group name on this sheet, including this one. Switch them to Coordinated operation and scale their splits proportionally. Offsets stay as entered. Check the split totals and calculate suitable offsets afterward; matching cycles alone does not create a green wave.",
    'Arm length':'Length from the mast pole to the arm tip. You can also drag the tip to resize and rotate the arm.',
    'Arm rotation':'Rotate the mast arm about its pole. Heads remain attached to it.',
    'Head type':'Choose the housing and lens layout: circular, arrow, four-section flashing-yellow arrow, or five-section. The matrix determines the illuminated indication: green ball, protected arrow, flashing yellow, or flashing red. Heads retain SignalMaker’s default reflective backplate.',
    'Drag links to':'Choose which indication source a drag-to-movement link changes. Head movement drives the main indications; Circular movement drives the circular indications of a shared head. Hold Shift while dragging to add a shared movement.',
    'Head movement':'Movement whose signal state this head displays. Automatic facing points the head toward that movement’s approach.',
    'Circular movement':'Movement controlling the circular indications of a doghouse head independently of its arrows. Head movement controls its arrows, pointing left or right with that movement.',
    'New head setup':'Choose the housing for the next head placed for this movement. Existing heads can be assigned below, including heads shared with other movements.',
    'Place head for movement':'Click a mast arm to place this setup for the selected movement. Lane snapping positions the head without changing the movement you selected.',
    'Face movement automatically':'Keep the green end of the head nearest approaching traffic. Turn off to use a manual head rotation.',
    'Head rotation':'Rotate this head’s face. Changing this value turns automatic facing off.',
    'Position on arm':'Distance from the mast pole along the arm. Dragging the head also snaps it to lane centers and boundaries.',
    'Detector rotation':'Rotate the detection rectangle to align with approaching traffic.',
    'Detector length':'Length of the detection rectangle along traffic flow. Longer detectors remain occupied for more of a vehicle’s approach.',
    'Detector width':'Width of the detection rectangle across traffic. Hold Shift while placing a detector to span all incoming lanes of the approach.',
    'Detector phase':'The phase requested by vehicles occupying this rectangle. Its number appears inside the detector. An omitted phase cannot serve the request until enabled; this assignment does not itself give a movement green.',
    'Detection mode':'Presence calls while the detector is occupied. Pulse calls once when an entry satisfies the detector delay. Extension can keep either call active longer.',
    'Detector delay':'Seconds the detector must stay occupied before it requests its phase. A vehicle that leaves before this delay finishes produces no call. Use 0 for an immediate request.',
    'Detector extension':'Seconds to keep the detector call active after its trigger ends. This can bridge short gaps between vehicles. Use 0 for no extra hold; locking can still retain a waiting call.',
    'Lock detector call':'On: remember each request made while an assigned phase is red until that phase receives green, even if the vehicle leaves the detector. Off: release the request after detection and Detector extension end, unless another detector still requests it. For example, with phases 1 and 4 assigned, detection can extend phase 1 while remembering a separate waiting call for phase 4. Each call is cleared when its phase starts service. Locking does not hold green indefinitely or bypass Maximum green; Recall can independently request service even after an unlocked detector call disappears.',
    'Countdown display':'Show seconds remaining during flashing-hand pedestrian clearance.',
    'Pedestrian phase':'Phase requested by this head’s pushbutton and used for its WALK, flashing hand and steady hand indications.',
    'Push pedestrian button':'Place a temporary pedestrian call, just like clicking the pedestrian head on the sheet.',
    'Close signal editor':'Return to the general simulator controls and show the spawn-to-exit route arrows again when paused.',
    'Remove Traffic Signal':'Remove this intersection’s controller, mast arms, heads and detectors. The intersection remains; Undo restores the signal.',
    'Delete selected equipment':'Remove the selected item. Deleting a mast arm also removes the heads mounted on it.',
    'R':'This phase does not serve this movement. Use the color menu to change its assignment. Legal turn-on-red rules remain controlled by No turn on red.',
    'G':'Ordinary circular green. Left and right turns yield to conflicting traffic; through traffic proceeds. Choose GA for a protected arrow.',
    'FY':'Permissive service: yield to conflicting traffic. Matching flashing-yellow cells continue flashing through consecutive served phases. When the run ends, the configured steady yellow and red clearance follow.',
  };
  let descriptionId=0;
  const explanation=label=>explanations[label.replace(/ \((?:sec|ft|mph|deg)\)$/,'')];
  function explain(control,text){
    if(!text)return control;
    control.dataset.help=text;
    const description=el('span',text,fields);description.hidden=true;description.id=`signal-help-${++descriptionId}`;
    control.setAttribute('aria-describedby',description.id);return control;
  }
  const action=(parent,label,fn,live=false)=>{const b=el('button',label,parent);b.type='button';b.disabled=running&&!live;b.onclick=fn;return explain(b,explanation(label));};
  const actions=parent=>el('div',null,parent,'headActions');
  function field(parent,label,value,set,options={}) {
    const row=el('div',null,parent,'fieldRow'),id='signal-'+label.replace(/[^a-z0-9]/gi,'-');el('label',label,row).htmlFor=id;
    const input=el(options.choices?'select':'input',null,row);input.id=id;input.disabled=running&&!options.live;explain(input,explanation(label));if(input.dataset.help)row.querySelector('label').dataset.help=input.dataset.help;
    if(options.choices)for(const [v,l] of options.choices)input.add(new Option(l,v));
    else {input.type=options.type??'number';if(input.type==='number'){input.min=options.min??0;input.max=options.max??999;input.step=options.step??.1;}}
    if(options.type==='checkbox')input.checked=Boolean(value);else input.value=value??'';
    input.onchange=()=>{if(!input.checkValidity()){input.reportValidity();return;}set(options.type==='checkbox'?input.checked:options.choices||options.type==='text'?input.value:input.valueAsNumber);};return input;
  }
  function dimensions(parent,label,value,min,max,set){
    const input=field(parent,label,value,set,{min,max}),wrap=el('div',null,input.parentNode,'dimensionInputs');wrap.append(input);
    const slider=el('input');slider.type='range';slider.min=min;slider.max=max;slider.step=.1;slider.value=value;slider.disabled=running;slider.setAttribute('aria-label',label);slider.dataset.help=input.dataset.help??'';slider.setAttribute('aria-describedby',input.getAttribute('aria-describedby'));wrap.prepend(slider);
    slider.oninput=()=>{input.value=slider.value;};slider.onchange=()=>set(Number(slider.value));return input;
  }
  function section(title,open=false){const d=el('details',null,fields);d.dataset.section=title;d.open=open;el('summary',title,d);return d;}
  function commit(message='Signal configuration updated.') {geometry=null;A.simulator.editSignal(message);renderFields();draw();}
  function movementGeometry(){if(!geometry)geometry=A.intersections.simulatorNetwork(S.selected);return geometry;}
  const paths=item=>movementGeometry().movements.filter(m=>m.intersection===item.id);
  const pathFor=(item,k)=>paths(item).find(m=>M.key(m)===k);
  const nameFor=(item,m)=>{const a=item.approaches.find(a=>a.inLanes.includes(m.input)),b=item.approaches.find(a=>a.outLanes.includes(m.output));return `${a?.name||'Approach '+(item.approaches.indexOf(a)+1)} L${(a?.inLanes.indexOf(m.input)??0)+1} → ${b?.name||'Approach '+(item.approaches.indexOf(b)+1)} L${(b?.outLanes.indexOf(m.output)??0)+1}`;};
  function select(item){if(!item?.trafficSignal)return;if(selected!==item.id)headSelection=null;selected=item.id;selectedSheet=S.selected;part=null;movement=null;placing=null;
    if(!item.trafficSignal.version){item.trafficSignal=M.normalize(item.trafficSignal);commit('Signal controller created. Assign movements to phases.');}else {renderFields();draw();A.simulator.refreshOverlay(false);}
  }
  let minimized=false;
  function minimize(value){
    minimized=Boolean(value&&running);panel.classList.toggle('simulatorMinimized',minimized);get('simulatorContent').hidden=minimized;
    const button=get('minimizeSimulator');button.textContent=minimized?'Restore':'Minimize';button.setAttribute('aria-label',`${minimized?'Restore':'Minimize'} simulator panel`);button.setAttribute('aria-expanded',String(!minimized));button.title=minimized?'Restore simulator controls':'Minimize the panel while playback continues';
    get('pauseMinimizedSimulation').hidden=!minimized;
  }
  get('minimizeSimulator').onclick=()=>minimize(!minimized);
  get('pauseMinimizedSimulation').onclick=()=>{get('pauseSimulation').click();get('playSimulation').focus();};
  function setRunning(value){if(value===running)return;running=value;get('minimizeSimulator').hidden=!running;if(!running)minimize(false);placing=null;drag=null;renderFields();draw();}
  function crosswalkEnds(marking){
    const points=(A.markings.outlines(marking.id)??[]).flat();if(points.length<3)return [];
    // Long axis of the crosswalk footprint, with endpoints at the two curbs.
    let longest={length:0};for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length],length=Math.hypot(b.x-a.x,b.y-a.y);if(length>longest.length)longest={length,a,b};}
    const u={x:(longest.b.x-longest.a.x)/longest.length,y:(longest.b.y-longest.a.y)/longest.length},n={x:-u.y,y:u.x};
    const xs=points.map(p=>p.x*u.x+p.y*u.y),ys=points.map(p=>p.x*n.x+p.y*n.y),y=(Math.min(...ys)+Math.max(...ys))/2;
    return [Math.min(...xs),Math.max(...xs)].map(x=>({x:u.x*x+n.x*y,y:u.y*x+n.y*y}));
  }
  function detectorWorld(item,d){return {...d,...world(item,d),angle:d.angle+(item.rotation??0),level:item.level??1};}
  function configure(target){
    engine=target;const sheet=S.selected;if(!sheet?.inchesPerPixel)return;
    const network=A.intersections.simulatorNetwork(sheet);
    const records=(sheet.intersections??[]).filter(i=>i.trafficSignal?.version).map(item=>({id:item.id,config:item.trafficSignal,movements:network.movements.filter(m=>m.intersection===item.id),pedConflicts:Object.fromEntries(network.movements.filter(m=>m.intersection===item.id).map(m=>[M.key(m),(M.features.pedestrians?item.trafficSignal.peds:[]).filter(p=>{const marking=sheet.markings.find(x=>x.id===p.marking);return marking&&M.crosses(m.points,crosswalkEnds(marking));}).map(p=>p.phase)])),detectors:item.trafficSignal.detectors.map(d=>detectorWorld(item,d))}));
    const next=JSON.stringify([sheet.id,sheet.inchesPerPixel,records]);
    if(target.signalSignature===next)return;
    target.signals=new M.System(records,12/sheet.inchesPerPixel);target.signalSignature=next;
  }
  const controller=item=>engine?.signals?.records.get(item.id)?.controller;
  function clearDescriptions(parent){for(const control of parent.querySelectorAll('[aria-describedby]'))for(const id of control.getAttribute('aria-describedby').split(' '))get(id)?.remove();}
  function renderMovementSettings(item,c){
    if(movement){const m=pathFor(item,movement),a=c.assignments[movement]??{phase:0,permissive:[],overlap:[],noTurnOnRed:false};if(m){
      const ms=section('Selected movement',true);ms.id='signalMovementSettings';el('p',nameFor(item,m),ms);
      el('p',`Green in phases: ${M.greenPhases(a).sort((a,b)=>a-b).join(', ')||'none'}. Flashing yellow in phases: ${(a.permissive??[]).slice().sort((a,b)=>a-b).join(', ')||'none'}. Matching green or flashing yellow continues through consecutive served phases; red ends the run with steady yellow and red clearance.`,ms,'fieldHint');
      el('p','Left and right turns on a green ball yield to conflicting traffic. Two nonconflicting opposing turns can run together. Green arrows keep protected service.',ms,'fieldHint');
      field(ms,'No turn on red',a.noTurnOnRed,v=>{a.noTurnOnRed=v;c.assignments[movement]=a;commit();},{type:'checkbox'});
      if(mastHeadsEnabled()){
      el('h4','Heads serving this movement',ms);
      field(ms,'New head setup',newHeadType,v=>{newHeadType=v;},{choices:headTypes});
      const place=action(actions(ms),'Place head for movement',()=>{placing='head';placingMovement=movement;headSelection=null;if(part?.kind==='head')part=null;A.signalHeadEditor.hide();A.simulator.cancelPlacement();status.textContent='Click a mast arm to place the selected head setup for this movement.';draw();});place.disabled=running||!c.arms.length;
      for(const [index,h] of c.heads.entries()){
        const bank=M.headMovements(h).includes(movement)?'main':M.headMovements(h,'circular').includes(movement)?'circular':'';
        const label=`Head ${index+1}`;
        explain(field(ms,`${label} assignment`,bank,value=>{M.assignHeadMovement(h,movement,value);commit();},{choices:[['','Not assigned'],['main',h.type==='doghouse'?'Arrow indications':h.design?'Main indications':'Shared indications'],...((h.type==='doghouse'||h.design)?[['circular','Circular indications']]:[])]}),`Assign this movement to ${label.toLowerCase()} without duplicating the physical head. A doghouse has separate arrow and circular indications. Movements sharing the same indications should use matching phase settings; this does not change their timings.`);
        if(bank){
          explain(field(ms,`${label} setup`,h.design?'custom':h.type,value=>{if(value==='custom')return;h.type=value;delete h.design;commit();},{choices:h.design?[['custom','Custom indications and layout'],...headTypes]:headTypes}),explanations['Head type']);
          explain(action(actions(ms),`Edit ${label.toLowerCase()}`,()=>{part={kind:'head',id:h.id};renderFields();draw();get('signal-Head-type-button')?.focus();}),`Edit this head's movement sources, sharing, rotation and position on its mast arm.`);
          const members=M.headMovements(h,bank);el('p',`Display source: ${nameFor(item,pathFor(item,members[0])??{})}. ${members.length} movement${members.length===1?'':'s'} assigned.`,ms,'fieldHint');
          if(members.some(k=>c.phases.some(p=>M.phaseMode(c,pathFor(item,k)??{},p.id)!==M.phaseMode(c,pathFor(item,members[0])??{},p.id))))el('p',`${label}: shared indications have different phase settings. The head displays its source movement; align the assignments or use separate indications.`,ms,'fieldHint');
        }
      }
    }}}
  }
  function renderPhaseSettings(sec,c,item){
    const p=c.phases.find(p=>p.id===selectedPhase);el('h4',`Phase ${p.id} · Ring ${p.ring} · Barrier ${p.barrier}`,sec);
    el('p','Edit minimum green, maximum green or split, yellow, and red clearance in the matrix above.',sec,'fieldHint');
    const timingFields=[['passage','Passage / gap'],['minGap','Minimum gap'],['timeBeforeReduction','Time before reduction'],['timeToReduce','Time to reduce'],['addedInitial','Added initial per actuation'],['maxInitial','Maximum initial'],['walk','Walk'],['pedClear','Flashing hand clearance'],['pedBuffer','Pedestrian buffer'],['pedLead','Leading pedestrian interval']];
    for(const [key,label] of timingFields.filter(([key])=>M.features.pedestrians||!['walk','pedClear','pedBuffer','pedLead'].includes(key)))field(sec,label+' (sec)',p[key],v=>{p[key]=v;commit();},{min:key==='yellow'||key==='split'?.1:0});
    field(sec,'Recall',p.recall,v=>{p.recall=v;commit();},{choices:[['none','None (detection)'],['min','Minimum'],['max','Maximum'],['soft','Soft (rest when no conflicting calls)']]});
    if(M.features.pedestrians){
    field(sec,'Pedestrian recall',p.pedRecall,v=>{p.pedRecall=v;commit();},{type:'checkbox'});
    field(sec,'Pedestrian mode',p.pedMode,v=>{p.pedMode=v;commit();},{choices:[['actuated','Actuated / pushbutton'],['rest','Rest in walk'],['omit','Omit pedestrian service']]});
    field(sec,'Exclusive pedestrian phase',p.pedExclusive,v=>{p.pedExclusive=v;commit();},{type:'checkbox'});
    }
    const manual=actions(sec);action(manual,'Call phase',()=>{controller(item)?.calls.add(p.id);tick(true);},true);const hold=action(manual,'Hold phase',()=>{const ctl=controller(item);if(!ctl)return;if(ctl.holds.has(p.id))ctl.holds.delete(p.id);else ctl.holds.add(p.id);renderFields();},true);hold.setAttribute('aria-pressed',String(controller(item)?.holds.has(p.id)??false));action(manual,'Force off phase',()=>{controller(item)?.forceOffs.add(p.id);tick(true);},true);
    el('p',M.features.pedestrians?'Use the matrix +/− buttons to enable or omit phases, and drag phase headers to reorder them. Pedestrian recall calls every service; rest-in-walk holds WALK until conflicting demand. Force-off preserves pedestrian and vehicle clearances.':'Use the matrix +/− buttons to enable or omit phases, and drag phase headers to reorder them. Force-off preserves minimum green and vehicle clearances.',sec,'fieldHint');
  }
  function bindPhaseReorder(table,scroll,c){
    // SignalMaker's faded drag source, insertion marker and arrow-key reorder,
    // using pointer capture for mouse, pen and touch column headers.
    let moving=null;
    const clean=()=>{table.querySelectorAll('.signalPhaseDragging,.phaseDropBefore,.phaseDropAfter,.phaseDropInvalid').forEach(e=>e.classList.remove('signalPhaseDragging','phaseDropBefore','phaseDropAfter','phaseDropInvalid'));};
    const cancel=()=>{const old=moving;moving=null;phaseDragInProgress=false;clean();if(old?.started)suppressPhaseClickUntil=performance.now()+250;if(old?.button.hasPointerCapture(old.pointer))old.button.releasePointerCapture(old.pointer);};
    cancelPhaseDrag=cancel;
    const apply=(id,target,after)=>{if(running||!M.reorderPhase(c,id,target,after))return;const left=scroll.scrollLeft;selectedPhase=id;commit(`Phase ${id} reordered within its ring and barrier.`);queueMicrotask(()=>{const grid=fields.querySelector('.signalGridScroll'),header=get(`signal-phase-header-${id}`);if(grid)grid.scrollLeft=left;header?.focus({preventScroll:true});header?.scrollIntoView({block:'nearest',inline:'nearest'});});};
    for(const button of table.querySelectorAll('[data-phase-header]')){
      const id=Number(button.dataset.phaseHeader),phase=c.phases.find(p=>p.id===id);
      button.addEventListener('pointerdown',e=>{if(running||e.button!==0||e.isPrimary===false)return;cancel();moving={button,pointer:e.pointerId,x:e.clientX,y:e.clientY,id,started:false,target:null};phaseDragInProgress=true;button.focus({preventScroll:true});button.setPointerCapture(e.pointerId);});
      button.addEventListener('pointermove',e=>{
        if(!moving||moving.pointer!==e.pointerId)return;
        if(!moving.started&&Math.hypot(e.clientX-moving.x,e.clientY-moving.y)<6)return;
        e.preventDefault();moving.started=true;clean();
        const column=button.closest('th').cellIndex;for(const row of table.rows)row.cells[column]?.classList.add('signalPhaseDragging');
        const bounds=scroll.getBoundingClientRect();if(e.clientX<bounds.left+24)scroll.scrollLeft-=16;else if(e.clientX>bounds.right-24)scroll.scrollLeft+=16;
        const target=document.elementFromPoint(e.clientX,e.clientY)?.closest('[data-phase-header]');moving.target=null;
        if(!target||!table.contains(target))return;
        const p=c.phases.find(p=>p.id===Number(target.dataset.phaseHeader));if(p.ring!==phase.ring||p.barrier!==phase.barrier){target.closest('th').classList.add('phaseDropInvalid');status.textContent=`Drag phase ${id} only within ring ${phase.ring}, barrier ${phase.barrier}.`;return;}
        const rect=target.getBoundingClientRect();moving.target=p.id;moving.after=e.clientX>=rect.left+rect.width/2;target.closest('th').classList.add(moving.after?'phaseDropAfter':'phaseDropBefore');
      });
      button.addEventListener('pointerup',e=>{if(!moving||moving.pointer!==e.pointerId)return;const d=moving;cancel();if(d.started){e.preventDefault();if(d.target!=null)apply(d.id,d.target,d.after);}});
      button.addEventListener('pointercancel',cancel);button.addEventListener('lostpointercapture',()=>{if(moving)cancel();});
      button.addEventListener('keydown',e=>{
        if(e.key==='Escape'&&moving){e.preventDefault();e.stopPropagation();cancel();status.textContent='Phase reorder canceled.';return;}
        if(running||!['ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();
        const group=c.phases.filter(p=>p.enabled&&p.ring===phase.ring&&p.barrier===phase.barrier).sort((a,b)=>a.order-b.order||a.id-b.id),index=group.findIndex(p=>p.id===id),offset=e.key==='ArrowLeft'?-1:1,target=group[index+offset];
        if(target)apply(id,target.id,offset>0);
      });
    }
  }
  function renderFields(restoreFocus=true){
    cancelPhaseDrag?.();
    const item=current();fields.hidden=!item;panel.classList.toggle('signalEditing',Boolean(item));if(!item){fields.replaceChildren();A.signalHeadEditor.hide();return;}
    const sections=new Map([...fields.querySelectorAll('details')].map(d=>[d.dataset.section,d.open])),focus=restoreFocus?document.activeElement?.id:null;
    fields.replaceChildren();const c=item.trafficSignal,head=el('h3',`Traffic signal · ${item.name||'Intersection'}`,fields);
    const live=actions(fields);action(live,'Close signal editor',()=>{selected=null;placing=null;renderFields();draw();A.simulator.refreshOverlay(false);},true);
    explain(el('p','',fields,'fieldHint'),'Live controller state in simulated seconds. Gap-out means the detector gap expired; max-out means maximum green was reached after another phase called; force-off means a scheduled or manual end. Calls are phases waiting for service.').id='signalLiveStatus';
    const tools=actions(fields);
    for(const [id,label,hint] of [['arm','Add Mast Arm','Click the pole position, then the tip.'],['head','Add Signal Head','Click a mast arm. Heads snap to lane centers and lane lines.'],['detector','Add Detector','Drag along an approaching lane. Hold Shift to span its approach lanes.'],['ped','Add Ped Head','Click an end of a crosswalk. Clicking a placed head calls its pedestrian phase.']]){
      if(!mastHeadsEnabled()&&['arm','head'].includes(id)||id==='ped'&&!M.features.pedestrians)continue;
      const b=action(tools,label,()=>{placing=placing===id?null:id;placingMovement=null;if(placing){headSelection=null;if(part?.kind==='head')part=null;A.signalHeadEditor.hide();}if(id==='head')newHeadType='ball';A.simulator.cancelPlacement();status.textContent=placing?hint:'Signal placement canceled.';draw();});explain(b,hint);b.id='signalAdd-'+id;b.disabled=running||id==='head'&&!c.arms.length;
    }
    field(fields,'Operation',['actuated','fixed','coordinated'].includes(c.mode)?c.mode:'actuated',v=>{c.mode=v;commit();},{choices:[['actuated','Actuated'],['fixed','Fixed time'],['coordinated','Coordinated']]});
    field(fields,'Dual entry',c.dualEntry,v=>{c.dualEntry=v;commit();},{type:'checkbox'});
    field(fields,'Simultaneous gap at barrier',c.simultaneousGap,v=>{c.simultaneousGap=v;commit();},{type:'checkbox'});
    const errors=[...M.validate(M.normalize(c)),...M.conflictErrors(M.normalize(c),paths(item))];if(errors.length)el('p',errors.join('\n'),fields,'signalErrors');
    const sec=section('Phases and movements',true);
    el('p','Set matching green or flashing yellow in multiple columns to continue that indication through consecutive served phases. Red ends the run with yellow and red clearance. Edit minimum green and other phase timings in the column headers. Click a lane path to find its row. White numbers on the drawing identify assigned phases.',sec,'fieldHint');
    const legend=el('p','',sec,'fieldHint signalIndicationLegend');legend.id='signalIndicationLegend';
    for(const [mode,label] of [['green','Green ball · turns yield'],['protected','Green arrow · protected'],['permissive','Flashing yellow · yield'],['flash-red-arrow','Flashing red arrow · stop, then yield']]){const entry=el('span',null,legend);entry.innerHTML=indicationIcon(mode,'left');entry.append(label);}
    el('p','Drag phase numbers to reorder playback within the same ring and barrier, or focus a number and use Left/Right arrows. The two rings run together. Yellow and red clearance follow green automatically.',sec,'fieldHint');
    const phaseTools=actions(sec);phaseTools.classList.add('signalMatrixActions');
    const add=action(phaseTools,'+',()=>{const p=c.phases.find(p=>!p.enabled);if(!p)return;p.enabled=true;selectedPhase=p.id;commit(`Phase ${p.id} enabled.`);});add.id='signalAddPhase';add.setAttribute('aria-label','Add phase');add.disabled=running||c.phases.every(p=>p.enabled);explain(add,'Enable the next omitted cabinet phase and show its column. Existing timings and assignments are retained. This cabinet has eight phase slots; remove a phase to free a slot when all eight are enabled.');
    const remove=action(phaseTools,'−',()=>{const p=c.phases.find(p=>p.id===selectedPhase);if(!p?.enabled)return;p.enabled=false;selectedPhase=c.phases.find(p=>p.enabled)?.id??p.id;commit(`Phase ${p.id} omitted. Its timings and assignments are retained.`);});remove.id='signalRemovePhase';remove.setAttribute('aria-label','Remove selected phase');remove.disabled=running||!c.phases.find(p=>p.id===selectedPhase)?.enabled;explain(remove,'Omit the selected phase from service and hide its column. Its timings, detectors and movement assignments are kept for restoring with +. Movements served only by this phase remain red. Undo restores the phase.');
    el('span',`${c.phases.filter(p=>p.enabled).length} / 8 phases`,phaseTools,'fieldHint');
    const visiblePhases=c.phases.filter(p=>p.enabled).sort((a,b)=>a.ring-b.ring||a.barrier-b.barrier||a.order-b.order||a.id-b.id);
    const scroll=el('div',null,sec,'signalGridScroll'),table=el('table',null,scroll,'signalPhaseGrid');table.setAttribute('aria-label','Movement and phase assignments');
    const row=el('tr',null,el('thead',null,table));el('th','Movement / phase',row);
    for(const ring of [1,2])el('p',`Ring ${ring}: `+[1,2].map(b=>c.phases.filter(p=>p.ring===ring&&p.barrier===b&&p.enabled).sort((a,b)=>a.order-b.order).map(p=>'P'+p.id).join(' → ')||'—').join(' │ '),sec,'fieldHint');
    for(const p of visiblePhases){const cell=el('th',null,row),b=action(cell,String(p.id),()=>{if(performance.now()<suppressPhaseClickUntil)return;selectedPhase=p.id;renderFields();draw();});explain(b,`Select phase ${p.id} and preview its movements. Drag left or right, or use Left/Right arrow keys, to change playback order within ring ${p.ring}, barrier ${p.barrier}. Other rings and barrier groups stay fixed. Timings, detectors and movement assignments stay with this phase.`);b.dataset.phaseHeader=p.id;b.id=`signal-phase-header-${p.id}`;b.setAttribute('aria-label',`Edit phase ${p.id}`);b.setAttribute('aria-pressed',String(selectedPhase===p.id));b.setAttribute('aria-keyshortcuts','ArrowLeft ArrowRight');cell.classList.toggle('signalPhaseOmitted',!p.enabled);}
    bindPhaseReorder(table,scroll,c);
    // AnyLogic's duration headers and cell color picker, adapted to cabinet
    // phases (two concurrent rings). Headers also reorder within a ring/barrier.
    // https://anylogic.help/online/tutorials/road-traffic/6-traffic-lights.html
    const header=table.tHead;
    for(const [key,label] of [['minGreen','Minimum green (sec)'],[['fixed','coordinated'].includes(c.mode)?'split':'maxGreen',['fixed','coordinated'].includes(c.mode)?'Split (sec)':'Max green (sec)'],['yellow','Yellow (sec)'],['red','Red clearance (sec)']]){
      const timing=el('tr',null,header);el('th',label,timing);
      for(const p of visiblePhases){const td=el('td',null,timing),input=el('input',null,td);input.type='number';input.min=key==='yellow'||key==='split'?.1:0;input.max=999;input.step=.1;input.value=p[key];input.disabled=running;input.id=`signal-grid-${key}-${p.id}`;input.setAttribute('aria-label',`Phase ${p.id} ${label}`);explain(input,explanation(key==='minGreen'?'Minimum green':key==='maxGreen'?'Maximum green':key==='split'?'Split':key==='yellow'?'Yellow change':'Red clearance'));input.onchange=()=>{if(!input.checkValidity()){input.reportValidity();return;}p[key]=input.valueAsNumber;selectedPhase=p.id;commit();};}
    }
    const body=el('tbody',null,table);
    for(const [index,m] of paths(item).entries()){
      const k=M.key(m),a=c.assignments[k]??{},tr=el('tr',null,body);tr.dataset.movementRow=k;tr.classList.toggle('selected',movement===k);const th=el('th',null,tr);explain(action(th,nameFor(item,m),()=>{movement=k;renderFields();draw();}),'Highlight this lane-to-lane movement on the drawing and edit its assignments below.');
      for(const p of visiblePhases){const mode=M.phaseMode(c,m,p.id),td=el('td',null,tr,'signalCell '+mode),select=el('select',null,td);td.classList.toggle('signalSelectedCell',movement===k&&selectedPhase===p.id);
        select.id=`signal-cell-${index}-${p.id}`;select.disabled=running;select.setAttribute('aria-label',`${nameFor(item,m)}, phase ${p.id}`);
        const type=M.movementType(m);select.pickerIconForValue=value=>indicationIcon(value,type);
        for(const [value,label] of [['red','R · Red'],['green','G · Green ball — turns yield'],['protected',type==='through'?'G · Protected green':'GA · Protected green arrow'],['permissive','FY · Flashing yellow — yield'],['flash-red-arrow',type==='through'?'FR · Flashing red — stop, then yield':'FRA · Flashing red arrow — stop, then yield']])select.add(new Option(label,value));select.value=mode;
        if(mode==='green'&&['left','right'].includes(type)){td.classList.add('signalYieldCell');const note=el('span','Yield',td,'signalYieldLabel');note.title='Green ball: yield to conflicting traffic. This is not a protected arrow.';}
        else if(['permissive','flash-red-arrow'].includes(mode))el('span',mode.startsWith('flash-red')?'Stop / yield':'Yield',td,'signalFlashLabel');
        explain(select,'Green ball: left and right turns yield to conflicting traffic. Green arrow: protected service. Flashing yellow: yield without a mandatory stop. Flashing red arrow: stop fully, then yield. The arrow points in this movement’s direction. Red: wait, subject to No turn on red. Each cell changes only this phase. Matching greens or flashing yellows in consecutive served phases continue through the transition. When flashing yellow ends, the configured steady yellow and red clearance run. Through movements use circular symbols.');
        const preview=()=>{if(selectedPhase===p.id&&movement===k)return;selectedPhase=p.id;movement=k;get('signalRemovePhase').disabled=running||!p.enabled;for(const h of table.querySelectorAll('[data-phase-header]'))h.setAttribute('aria-pressed',String(Number(h.dataset.phaseHeader)===p.id));for(const r of body.rows)r.classList.toggle('selected',r.dataset.movementRow===k);for(const cell of body.querySelectorAll('.signalSelectedCell'))cell.classList.remove('signalSelectedCell');td.classList.add('signalSelectedCell');const settings=get('signalPhaseSettings');if(settings){clearDescriptions(settings);settings.replaceChildren();el('summary','Phase timing and detection',settings);renderPhaseSettings(settings,c,item);}const old=get('signalMovementSettings');if(old){clearDescriptions(old);old.remove();}renderMovementSettings(item,c);if(settings&&get('signalMovementSettings'))settings.after(get('signalMovementSettings'));draw();};
        td.addEventListener('focusin',preview);td.addEventListener('pointerdown',preview);
        select.onchange=()=>{const value=select.value;movement=k;selectedPhase=p.id;
          M.setPhaseMode(c,k,p.id,value);commit('Movement phase assignment updated.');
        };
      }
    }
    if(!paths(item).length)el('p','Create lane movements in the Intersection editor first.',sec,'fieldHint');
    const settings=section('Phase timing and detection',true);settings.id='signalPhaseSettings';renderPhaseSettings(settings,c,item);
    renderMovementSettings(item,c);
    renderPart(item);
    if(part?.kind==='head')headSelection=part.id;
    renderHeadPanel(item);
    const coord=section('Coordination and green wave');
    field(coord,'Coordination group',c.coordination.group,v=>{c.coordination.group=v;commit();},{type:'text'});
    for(const [key,label,min,max] of [['cycle','Cycle (sec)',10,999],['offset','Offset (sec)',0,999],['speed','Progression speed (mph)',1,85],['distance','Route distance from reference (ft)',0,100000]])field(coord,label,c.coordination[key],v=>{c.coordination[key]=v;commit();},{min,max});
    field(coord,'Reference signal',c.coordination.reference??'',v=>{c.coordination.reference=v||null;commit();},{choices:[['','Choose reference'],...S.selected.intersections.filter(i=>i.id!==item.id&&i.trafficSignal).map(i=>[i.id,i.name||'Intersection'])]});
    el('p','Offset is the start of the first phase in ring 1. A positive offset starts later. Use route distance for curved corridors; 0 uses straight-line spacing.',coord,'fieldHint');
    const ca=actions(coord);action(ca,'Calculate offset',()=>calculateOffset(item));action(ca,'Sync group cycle',()=>{if(!c.coordination.group){status.textContent='Enter a coordination group first.';return;}for(const i of S.selected.intersections.filter(i=>i.trafficSignal?.coordination?.group===c.coordination.group)){const x=i.trafficSignal,f=c.coordination.cycle/x.coordination.cycle;x.coordination.cycle=c.coordination.cycle;x.mode='coordinated';for(const p of x.phases)p.split=+(p.split*f).toFixed(3);}commit('Group cycle synchronized. Check splits and offsets.');});
    const list=section('Placed equipment');
    for(const [kind,key,label] of [['arm','arms','Mast arm'],['head','heads','Head'],['detector','detectors','Detector'],['ped','peds','Pedestrian head']])for(const [i,v] of ((mastHeadsEnabled()||!['arm','head'].includes(kind))&&(kind!=='ped'||M.features.pedestrians)?c[key]:[]).entries())explain(action(actions(list),`${label} ${i+1}`,()=>{part={kind,id:v.id};renderFields();draw();}),`Select ${label.toLowerCase()} ${i+1} to edit its properties or delete it.`);
    action(actions(fields),'Remove Traffic Signal',()=>{delete item.trafficSignal;selected=null;commit('Traffic signal removed.');});
    for(const d of fields.querySelectorAll('details'))if(sections.has(d.dataset.section))d.open=sections.get(d.dataset.section);
    if(focus)queueMicrotask(()=>get(focus)?.focus({preventScroll:true}));tick(true);
  }
  function calculateOffset(item){const c=item.trafficSignal.coordination,ref=S.selected.intersections.find(i=>String(i.id)===String(c.reference));if(!ref?.trafficSignal){status.textContent='Choose a reference signal.';return;}
    const distance=c.distance||Math.hypot(ref.x-item.x,ref.y-item.y)/ppf();c.offset=+M.mod((ref.trafficSignal.coordination?.offset??0)+distance/(c.speed*5280/3600),c.cycle).toFixed(2);commit(`Offset set to ${c.offset} seconds for ${Math.round(distance)} ft.`);
  }
  function renderPart(item){
    if(!mastHeadsEnabled()&&['arm','head'].includes(part?.kind))return;
    const c=item.trafficSignal,kinds={arm:'arms',head:'heads',detector:'detectors',ped:'peds'},v=part&&c[kinds[part.kind]]?.find(v=>v.id===part.id);if(!v||part.kind==='ped'&&!M.features.pedestrians)return;
    const sec=section('Selected equipment',true),set=(key,value)=>{v[key]=value;commit();};
    el('h4',{arm:'Mast arm',head:'Signal head',detector:'Detector',ped:'Pedestrian head'}[part.kind],sec);
    if(part.kind==='arm'){
      dimensions(sec,'Arm length (ft)',v.length,10,150,x=>set('length',x));dimensions(sec,'Arm rotation (deg)',v.angle,-180,180,x=>set('angle',x));
    }else if(part.kind==='head'){
      field(sec,'Head type',v.design?'custom':v.type==='up'?'ball':v.type,x=>{if(x==='custom')return;delete v.design;set('type',x);},{choices:v.design?[['custom','Custom indications and layout'],...headTypes]:headTypes});
      explain(action(actions(sec),'Edit indications and layout',()=>{headSelection=v.id;renderHeadPanel(item);}), 'Open the SignalMaker indication and layout editor on the right.');
      field(sec,'Drag links to',linkBank,x=>{linkBank=x;},{choices:[['main','Head movement'],['circular','Circular movement']]});
      field(sec,'Head movement',v.movement??'',x=>set('movement',x),{choices:[['','Unassigned'],...paths(item).map(m=>[M.key(m),nameFor(item,m)])]});
      if(v.type==='doghouse'||v.design)field(sec,'Circular movement',v.secondaryMovement??'',x=>set('secondaryMovement',x),{choices:[['','Unassigned'],...paths(item).map(m=>[M.key(m),nameFor(item,m)])]});
      for(const bank of v.type==='doghouse'||v.design?['main','circular']:['main']){
        el('h4',bank==='circular'?'Share circular indications with':'Share main indications with',sec);
        const source=bank==='circular'?v.secondaryMovement:v.movement;
        for(const m of paths(item).filter(m=>M.key(m)!==source)){
          const key=M.key(m),label=el('label',null,sec,'fieldRow'),box=el('input',null,label);box.type='checkbox';box.checked=M.headMovements(v,bank).includes(key);box.disabled=running;label.append(nameFor(item,m));
          explain(box,'Share these indications with this movement. The source movement controls the displayed lamps; keep shared phase settings aligned. A doghouse can display its arrow and circular sources independently.');
          box.onchange=()=>{M.assignHeadMovement(v,key,box.checked?bank:'');commit();};
        }
      }
      field(sec,'Face movement automatically',v.auto!==false,x=>{if(!x&&v.auto!==false)v.angle=M.mod(headRotation(item,v)-(item.rotation??0)+180,360)-180;set('auto',x);},{type:'checkbox'});
      dimensions(sec,'Head rotation (deg)',v.auto!==false?M.mod(headRotation(item,v)-(item.rotation??0)+180,360)-180:v.angle??0,-180,180,x=>{v.auto=false;set('angle',x);});
      const arm=c.arms.find(a=>a.id===v.arm);if(arm)dimensions(sec,'Position on arm (ft)',v.at,0,arm.length,x=>set('at',x));
    }else if(part.kind==='detector'){
      dimensions(sec,'Detector rotation (deg)',v.angle,-360,360,x=>set('angle',x));
      dimensions(sec,'Detector length (ft)',v.length,1,300,x=>set('length',x));dimensions(sec,'Detector width (ft)',v.width,1,300,x=>set('width',x));
      el('h4','Detector phases',sec);
      for(const p of c.phases){
        const assigned=M.detectorPhases(v),input=field(sec,`Detector phase ${p.id}`,assigned.includes(p.id),checked=>{
          v.phases=checked?[...assigned,p.id].sort((a,b)=>a-b):assigned.filter(n=>n!==p.id);v.phase=v.phases[0];commit();
        },{type:'checkbox'});
        input.disabled=running||assigned.length===1&&assigned.includes(p.id);
        explain(input,explanations['Detector phases']+(p.enabled?'':' This phase is currently omitted; enable it to serve its calls.'));
        input.closest('.fieldRow').querySelector('label').dataset.help=input.dataset.help;
      }
      field(sec,'Detection mode',v.mode??'presence',x=>set('mode',x),{choices:[['presence','Presence'],['pulse','Pulse (entry)']]});
      field(sec,'Detector delay (sec)',v.delay??0,x=>set('delay',x));field(sec,'Detector extension (sec)',v.extend??0,x=>set('extend',x));
      field(sec,'Lock detector call',v.memory!==false,x=>set('memory',x),{type:'checkbox'});
    }else {field(sec,'Countdown display',v.countdown!==false,x=>set('countdown',x),{type:'checkbox'});field(sec,'Pedestrian phase',v.phase,x=>set('phase',Number(x)),{choices:c.phases.map(p=>[p.id,`Phase ${p.id}`])});action(actions(sec),'Push pedestrian button',()=>{controller(item)?.requestPed(v.phase);tick(true);},true);}
    action(actions(sec),'Delete selected equipment',()=>{c[kinds[part.kind]]=c[kinds[part.kind]].filter(x=>x!==v);if(part.kind==='arm')c.heads=c.heads.filter(h=>h.arm!==v.id);part=null;commit('Signal equipment removed.');});
  }
  function renderHeadPanel(item){
    const v=item.trafficSignal.heads.find(h=>h.id===headSelection);if(!mastHeadsEnabled()||!active()||!v){A.signalHeadEditor.hide();return;}
    const seed=v.design??A.signalHeadEditor.pickDesign(lampHead(v,'red',0,'red',M.movementType(pathFor(item,v.movement))));
    A.signalHeadEditor.render({head:v,design:structuredClone(seed),disabled:running,onChange:design=>{v.design=design;commit('Signal indications updated.');},onClose:()=>{headSelection=null;if(part?.kind==='head')part=null;A.signalHeadEditor.hide();}});
  }
  function customLampHead(v,aspect,time,secondary){
    const h={...H.createHead('Signal'),...structuredClone(v.design)},flash=Math.floor(time*2)%2===0;
    const normalize=a=>a.replace('-ball','');aspect=normalize(aspect);secondary=normalize(secondary);
    for(const lamp of h.indications){
      const circular=lamp.source==='circular'||(!lamp.source||lamp.source==='auto')&&lamp.symbol==='ball'&&Boolean(v.secondaryMovement);
      const state=circular?secondary:aspect,service=lamp.service??'auto',flashing=['permissive','flash-yellow','flash-red'].includes(state);
      if(service==='off'){lamp.lit=false;continue;}
      if(service!=='auto'){lamp.lit=service===state&&(!flashing||flash);continue;}
      const color=state==='permissive'?'yellow':state.replace('flash-','');
      const automaticColor=lamp.color==='white'?(lamp.symbol==='bus-stop'?'red':'green'):lamp.color;
      lamp.lit=automaticColor===color&&(!flashing||flash);
      if(lamp.color==='yellow'){
        const siblings=h.indications.filter(other=>other.color==='yellow'&&(other.source??'auto')===(lamp.source??'auto')&&other.symbol===lamp.symbol&&(!other.service||other.service==='auto'));
        if(siblings.length>1)lamp.lit&&=lamp===(flashing?siblings.at(-1):siblings[0]);
      }
      if(h.hawk&&state==='flash-red'&&lamp.color==='red')lamp.lit=h.indications.indexOf(lamp)===(flash?0:1);
    }
    return h;
  }
  function lampHead(v,aspect,time,secondary=aspect,direction='through'){
    if(v.design){const head=customLampHead(v,aspect,time,secondary);for(const lamp of head.indications)if(lamp.symbol==='up')lamp.symbol='ball';return head;}
    const ball=['green-ball','yellow-ball'].includes(aspect);if(ball)aspect=aspect.replace('-ball','');
    const h=H.createHead('Signal');if(v.type==='doghouse')H.setCluster(h,true);
    else if(v.type?.startsWith('fya')){const symbol=v.type.endsWith('right')?'right':'left';h.indications=['red','yellow','yellow','green'].map(color=>H.createIndication(color,symbol));}
    else if(v.type!=='ball')for(const i of h.indications)i.symbol=v.type??'ball';
    if(v.type==='doghouse'){
      // SignalMaker's shared red, arrow pair and circular pair are independent.
      // A permissive arrow must not extinguish a simultaneously green circle.
      const flash=Math.floor(time*2)%2===0,red=a=>['red','flash-red'].includes(a);
      const lit=[red(aspect)&&red(secondary)&&(![aspect,secondary].includes('flash-red')||flash),
        aspect==='yellow'&&!ball||['permissive','flash-yellow'].includes(aspect)&&flash,
        secondary==='yellow'||aspect==='yellow'&&ball||['permissive','flash-yellow'].includes(secondary)&&flash,
        aspect==='green'&&!ball,secondary==='green'||aspect==='green'&&ball];
      h.indications.forEach((lamp,i)=>{lamp.lit=lit[i];if(lamp.symbol!=='ball')lamp.symbol=['left','right'].includes(direction)?direction:direction==='uturn'?'u-turn':'ball';});
      if(direction==='right'){[h.indications[1],h.indications[2]]=[h.indications[2],h.indications[1]];[h.indications[3],h.indications[4]]=[h.indications[4],h.indications[3]];}
      return h;
    }
    for(const [i,lamp] of h.indications.entries())lamp.lit=aspect.startsWith('flash-')?lamp.color===aspect.slice(6)&&Math.floor(time*2)%2===0:aspect==='green'?lamp.color==='green':aspect==='yellow'?lamp.color==='yellow'&&(!v.type?.startsWith('fya')||i===1):aspect==='permissive'?(v.type?.startsWith('fya')?i===2&&Math.floor(time*2)%2===0:v.type==='doghouse'?i===4:lamp.color==='green'):lamp.color==='red';
    if(ball){for(const lamp of h.indications)if(lamp.color===aspect)lamp.symbol='ball';}
    else if(aspect==='green'&&v.type==='ball')for(const lamp of h.indications)if(lamp.color==='green')lamp.symbol=['left','right'].includes(direction)?direction:direction==='uturn'?'u-turn':'ball';
    // Flashing permissive service uses the requested color and movement glyph
    // even on a three-section housing; duplicate yellow sections stay dark.
    if(aspect==='permissive')h.indications.forEach((lamp,i)=>{lamp.lit=lamp.color==='yellow'&&i===(v.type?.startsWith('fya')?2:1)&&Math.floor(time*2)%2===0;if(lamp.lit)lamp.symbol=['left','right'].includes(direction)?direction:direction==='uturn'?'u-turn':'ball';});
    // Direction belongs to the assigned movement, including inactive arrow lenses.
    if(direction!=='unknown')for(const lamp of h.indications)if(lamp.symbol!=='ball')lamp.symbol=['left','right'].includes(direction)?direction:direction==='uturn'?'u-turn':'ball';
    return h;
  }
  function headRotation(item,v){const m=pathFor(item,v.movement);
    const a=m?.points?.[0],b=m?.points?.[1],approach=item.approaches.find(a=>a.id===v.approach);return v.auto!==false?(a&&b?Math.atan2(b.y-a.y,b.x-a.x)*180/Math.PI+90:approach?approach.angle+(item.rotation??0)+270:(v.angle??0)+(item.rotation??0)):(v.angle??0)+(item.rotation??0);
  }
  function indicationIcon(mode,direction='through'){
    const color=['green','protected'].includes(mode)?'green':mode==='permissive'?'yellow':'red',symbol=['protected','permissive','flash-red-arrow'].includes(mode)?(['left','right'].includes(direction)?direction:direction==='uturn'?'u-turn':'ball'):'ball';
    const flashing=['permissive','flash-red-arrow'].includes(mode);
    return `<svg class="signalIndicationIcon" viewBox="-8 -8 16 16" aria-hidden="true"><circle r="8" fill="#111719"/><g class="${flashing?'signalFlashingLamp':''}">${H.symbol({size:12,color,symbol,lit:true},0,0)}</g></svg>`;
  }
  function drawHead(parent,item,v,arm){
    const u=vector(arm.angle),at=world(item,{x:arm.x+u.x*Math.min(v.at,arm.length),y:arm.y+u.y*Math.min(v.at,arm.length)}),m=pathFor(item,v.movement);
    const angle=headRotation(item,v);
    const ctl=controller(item),state=ctl&&m?M.movementState(ctl,m):{aspect:'red'},aspect=state.aspect,head=lampHead(v,state.greenBall?`${aspect}-ball`:aspect,engine?.time??0,ctl?M.indication(ctl,item.trafficSignal.assignments[v.secondaryMovement??(v.type==='doghouse'?'':v.movement)]):'red',M.movementType(m)),g=H.headGeometry(head),s=1/S.selected.inchesPerPixel;
    const redArrow=aspect==='flash-red';
    if(redArrow&&!v.design)for(const lamp of head.indications)if(lamp.color==='red')lamp.symbol=['left','right'].includes(M.movementType(m))?M.movementType(m):M.movementType(m)==='uturn'?'u-turn':'ball';
    const group=svg('g',{transform:`translate(${at.x} ${at.y}) rotate(${angle}) scale(${s}) translate(${-g.width/2} ${-g.height/2})`,'data-signal-part':'head','data-id':v.id,'data-intersection':item.id,role:'button',tabindex:0,'aria-label':`Signal head: ${aspect}${state.greenBall?' ball; turns yield':redArrow?' arrow; stop, then yield':''}. Drag to a movement to link; Shift-drag to share, or drag along the mast arm to reposition.`},parent);
    group.innerHTML=H.headMarkup(head,g);group.classList.add('signalEquipment');
    if(active()&&part?.id===v.id&&item===current())svg('rect',{x:-2,y:-2,width:g.width+4,height:g.height+4,fill:'none',stroke:'#ffdf00','stroke-width':1.5},group);
  }
  function draw(){
    overlay.hidden=!S.selected?.inchesPerPixel;if(overlay.hidden)return;overlay.classList.toggle('signalPassive',!active());const focused=document.activeElement?.closest('[data-signal-part]')?.dataset.id;overlay.replaceChildren();const sheet=S.selected,root=svg('svg',{},overlay),group=svg('g',{transform:`translate(${sheet.view.x} ${sheet.view.y}) scale(${sheet.view.scale})`},root);
    for(const item of sheet.intersections??[]){if(!item.trafficSignal?.version||(item.level??1)>(A.settings.get('hideLevelsAbove')||Infinity))continue;const c=item.trafficSignal;
      if(running||active()&&item===current()){const ctl=controller(item);for(const m of paths(item)){const k=M.key(m),mode=running&&ctl?M.movementState(ctl,m).aspect:M.phaseMode(c,m,selectedPhase),color=['green','protected'].includes(mode)?'#00d47d':['yellow','permissive','flash-yellow'].includes(mode)?'#ffd43b':'#ee5059';
        const flashing=['permissive','flash-yellow','flash-red','flash-red-arrow'].includes(mode);
        const line=svg('path',{d:'M'+m.points.map(p=>`${p.x},${p.y}`).join('L'),fill:'none',stroke:color,'stroke-width':(drag?.targetMovement===k?7:movement===k?5:2)/sheet.view.scale,opacity:movement===k||drag?.targetMovement===k?1:.65,'pointer-events':'none',class:'signalMovementPreview','data-phase':selectedPhase,'data-state':mode,'data-movement':k,'data-intersection':item.id},group);
        if(flashing){
          if(running)line.setAttribute('stroke-opacity',Math.floor((engine?.time??0)*2)%2===0?1:.08);
          else {line.classList.add('signalMovementFlashing');line.style.animationDelay=`-${performance.now()%1000}ms`;}
        }
        if(!running)svg('path',{d:'M'+m.points.map(p=>`${p.x},${p.y}`).join('L'),fill:'none',stroke:'transparent','stroke-width':14/sheet.view.scale,'data-signal-movement':k,role:'button',tabindex:0,'aria-label':`Assign phases: ${nameFor(item,m)}`,class:'signalMovementHit'},group);
      }}
      if(mastHeadsEnabled()&&item===current()&&drag?.kind==='head'&&drag.linking&&drag.end){
        const v=drag.before,arm=c.arms.find(a=>a.id===v.arm),u=vector(arm.angle),from=world(item,{x:arm.x+u.x*v.at,y:arm.y+u.y*v.at}),to=world(item,drag.end);
        svg('path',{d:`M${from.x} ${from.y} L${to.x} ${to.y}`,fill:'none',stroke:drag.targetMovement?'#00df99':'#fff','stroke-width':2/sheet.view.scale,'stroke-dasharray':`${6/sheet.view.scale} ${4/sheet.view.scale}`,class:'signalHeadLink'},group);
      }
      for(const arm of mastHeadsEnabled()?c.arms:[]){const start=world(item,arm),u=vector(arm.angle+(item.rotation??0)),n={x:-u.y,y:u.x},tip={x:start.x+u.x*arm.length*ppf(),y:start.y+u.y*arm.length*ppf()};
        const profile=H.dimensions.mast.profiles.find(p=>p.length>=arm.length*12)??H.dimensions.mast.profiles.at(-1),base=profile.armDiameter/S.selected.inchesPerPixel/2,end=Math.max(3,profile.armDiameter-arm.length*H.dimensions.mast.taperPerFoot)/S.selected.inchesPerPixel/2;
        const g=svg('g',{'data-signal-part':'arm','data-id':arm.id,'data-intersection':item.id,class:'signalEquipment',role:'button',tabindex:0,'aria-label':'Mast arm. Drag to move.'},group);
        svg('path',{d:`M${start.x+n.x*base},${start.y+n.y*base} L${tip.x+n.x*end},${tip.y+n.y*end} L${tip.x-n.x*end},${tip.y-n.y*end} L${start.x-n.x*base},${start.y-n.y*base}Z`,fill:'#a9a9a9',stroke:'#51555a','stroke-width':.1*ppf()},g);
        svg('circle',{cx:start.x,cy:start.y,r:profile.poleDiameter/S.selected.inchesPerPixel/2,fill:'#aaa',stroke:'#555','stroke-width':.1*ppf()},g);
        svg('path',{d:`M${start.x},${start.y}L${tip.x},${tip.y}`,stroke:'transparent','stroke-width':12/sheet.view.scale,fill:'none'},g);
        if(active()&&item===current()&&part?.id===arm.id&&!running)svg('circle',{cx:tip.x,cy:tip.y,r:6/sheet.view.scale,fill:'#ffdf00',stroke:'#665900','stroke-width':1/sheet.view.scale,'data-signal-part':'arm-tip','data-id':arm.id,'data-intersection':item.id,class:'signalEquipment',role:'button',tabindex:0,'aria-label':'Mast arm tip. Drag to rotate and resize.'},group);
        for(const h of c.heads.filter(h=>h.arm===arm.id))drawHead(group,item,h,arm);
      }
      for(const d of !running||mastHeadsEnabled()?c.detectors:[]){const p=detectorWorld(item,d),on=controller(item)?.detectorStates.get(d.id)?.call;svg('rect',{x:-d.length*ppf()/2,y:-d.width*ppf()/2,width:d.length*ppf(),height:d.width*ppf(),transform:`translate(${p.x} ${p.y}) rotate(${p.angle})`,fill:on?'#ffdf0030':'none',stroke:active()&&item===current()&&part?.id===d.id?'#ffdf00':'#aaa','stroke-width':1/sheet.view.scale,'data-signal-part':'detector','data-id':d.id,'data-intersection':item.id,class:'signalEquipment',role:'button',tabindex:0,'aria-label':`Detector phases ${M.detectorPhases(d).join('/')}: ${on?'occupied':'clear'}`},group);
        const size=Math.min(18/sheet.view.scale,Math.min(d.length,d.width)*ppf()*.7/Math.max(1,M.detectorPhases(d).join('/').length*.6)),label=svg('text',{x:p.x,y:p.y,'text-anchor':'middle','dominant-baseline':'central',fill:'#fff',stroke:'#333','stroke-width':size*.12,'paint-order':'stroke','font-size':size,'font-weight':800,'font-family':'Overpass, sans-serif','pointer-events':'none',class:'signalDetectorPhase','data-detector':d.id,'aria-hidden':'true'},group);label.textContent=M.detectorPhases(d).join('/');
      }
      for(const ped of M.features.pedestrians&&(!running||mastHeadsEnabled())?c.peds:[]){const marking=sheet.markings.find(m=>m.id===ped.marking),p=marking&&crosswalkEnds(marking)[ped.end];if(!p)continue;const state=controller(item)?.pedestrian(ped.phase)??'hand',h=H.createHead('Pedestrian');h.pedestrian=true;h.pedestrianDisplay=state==='walk'?'walk':'hand';
        const g=svg('g',{transform:`translate(${p.x} ${p.y}) scale(${1/sheet.inchesPerPixel}) translate(-10 -9)`,'data-signal-part':'ped','data-id':ped.id,'data-intersection':item.id,class:'signalEquipment',role:'button',tabindex:0,'aria-label':`Pedestrian phase ${ped.phase}: ${state}. Push button.`},group);g.innerHTML=H.headMarkup(h,H.headGeometry(h));
        if(state==='clearance'){const r=controller(item)?.rings.find(r=>r.phase===ped.phase),ph=controller(item)?.config.phases[ped.phase-1];if(Math.floor((engine?.time??0)*2)%2)g.querySelector('g')?.setAttribute('opacity','0.15');if(ped.countdown!==false&&r){const text=svg('text',{x:17.5,y:12,'text-anchor':'middle',fill:'#f7921e','font-size':7,'font-family':'Overpass, sans-serif'},g);text.textContent=Math.max(0,Math.ceil(r.walkEnd+ph.pedClear-r.elapsed));}}if(controller(item)?.pedCalls.has(ped.phase))svg('circle',{cx:20,cy:0,r:3,fill:'#ffdf00'},g);
      }
      if(!running||mastHeadsEnabled())drawPhaseLabels(group,item);
    }
    if(!active())for(const node of overlay.querySelectorAll('[data-signal-part]')){node.removeAttribute('tabindex');node.setAttribute('role','img');}
    if(drag?.kind==='new-detector'){const d=detectorDragGeometry(drag);svg('rect',{x:-d.length*ppf()/2,y:-d.width*ppf()/2,width:d.length*ppf(),height:d.width*ppf(),transform:`translate(${d.center.x} ${d.center.y}) rotate(${drag.lane.angle})`,fill:'none',stroke:'#aaa','stroke-width':1/sheet.view.scale},group);}
    if(focused)overlay.querySelector(`[data-id="${CSS.escape(focused)}"]`)?.focus({preventScroll:true});
    if(drag?.kind==='new-arm'){const a=world(current(),drag.start),b=world(current(),drag.end??drag.start);svg('path',{d:`M${a.x},${a.y}L${b.x},${b.y}`,stroke:'#ffdf00','stroke-width':2/sheet.view.scale},group);}
  }
  function drawPhaseLabels(parent,item){
    const scale=S.selected.view.scale,movements=paths(item),c=item.trafficSignal;
    for(const approach of item.approaches){
      const lanes=approach.inLanes.map((input,index)=>({input,index,phases:[...new Set(movements.filter(m=>m.input===input).flatMap(m=>{const a=c.assignments[M.key(m)];return a?[...M.greenPhases(a),...(a.permissive??[]),...(a.flashingRed??[]),...(a.flashingRedArrows??[])].filter(Boolean):[];}))].sort((a,b)=>a-b)}));
      // At overview zoom, combine lane labels into one approach label so the
      // white phase numbers remain legible instead of overlapping each other.
      const compact=lanes.some(l=>A.intersectionGeometry.width(approach,true,l.index)*ppf()*scale<38);
      const groups=compact?[{indices:lanes.map(l=>l.index),phases:[...new Set(lanes.flatMap(l=>l.phases))].sort((a,b)=>a-b)}]:lanes.map(l=>({indices:[l.index],phases:l.phases}));
      for(const lane of groups){if(!lane.phases.length||!lane.indices.length)continue;const points=lane.indices.map(i=>A.intersectionGeometry.ridingLane(approach,true,i)),u=vector(approach.angle+180),point=world(item,{x:points.reduce((s,p)=>s+p.x,0)/points.length+u.x*16,y:points.reduce((s,p)=>s+p.y,0)/points.length+u.y*16});
        const text=svg('text',{x:point.x,y:point.y,'text-anchor':'middle','dominant-baseline':'central',fill:'#fff',stroke:'#222','stroke-width':3/scale,'paint-order':'stroke','font-size':26/scale,'font-weight':800,'font-family':'Overpass, sans-serif','pointer-events':'none',class:'signalPhaseLabel','data-approach':approach.id,'aria-label':`Assigned phases ${lane.phases.join(', ')}`},parent);text.textContent=lane.phases.join('/');
      }
    }
  }
  function snapHead(item,arm,p){
    const u=vector(arm.angle),at=(p.x-arm.x)*u.x+(p.y-arm.y)*u.y;let best={at:Math.max(0,Math.min(arm.length,at)),distance:Infinity,movement:null};
    for(const approach of item.approaches)for(let lane=0;lane<approach.inLanes.length;lane++){
      const a=A.intersectionGeometry.ridingLane(approach,true,lane),uIn=vector(approach.angle+180),v=uIn,n={x:-v.y,y:v.x},half=A.intersectionGeometry.width(approach,true,lane)/2;
      const m=paths(item).find(m=>m.input===approach.inLanes[lane]);
      for(const offset of [0,-half,half]){const q={x:a.x+n.x*offset,y:a.y+n.y*offset},den=u.x*v.y-u.y*v.x;if(Math.abs(den)<1e-6)continue;const t=((q.x-arm.x)*v.y-(q.y-arm.y)*v.x)/den,distance=Math.abs(t-at);if(t>=0&&t<=arm.length&&distance<best.distance&&distance*ppf()*S.selected.view.scale<16)best={at:t,distance,movement:m?M.key(m):null,approach:approach.id};}
    }return best;
  }
  function approachLanes(item){return item.approaches.flatMap(a=>a.inLanes.map((input,index)=>{
    const p=A.intersectionGeometry.ridingLane(a,true,index),u=vector(a.angle+180),m=paths(item).find(m=>m.input===input);
    return {input,output:m?.output??'',points:[{...world(item,p),laneWidth:A.intersectionGeometry.width(a,true,index)*ppf(),junction:{entry:a.id}},world(item,{x:p.x+u.x,y:p.y+u.y})]};
  }));}
  function nearestLane(item,p){let best=null;
    for(const m of approachLanes(item)){const a=m.points[0],b=m.points[1],length=Math.hypot(b.x-a.x,b.y-a.y),u={x:(b.x-a.x)/length,y:(b.y-a.y)/length};
      const t=Math.max(-500*ppf(),Math.min(20*ppf(),(p.x-a.x)*u.x+(p.y-a.y)*u.y)),q={x:a.x+u.x*t,y:a.y+u.y*t},distance=Math.hypot(p.x-q.x,p.y-q.y);
      if(!best||distance<best.distance)best={point:q,u,distance,m,angle:Math.atan2(u.y,u.x)*180/Math.PI,width:(a.laneWidth??12*ppf())/ppf()};
    }return best;
  }
  function detectorDragGeometry(d){
      const end=d.end??d.start,u=d.lane.u,along=(end.x-d.start.x)*u.x+(end.y-d.start.y)*u.y,center={x:d.start.x+u.x*along/2,y:d.start.y+u.y*along/2};
      let width=Math.max(1,d.lane.width-2);if(d.shift){const m=d.lane.m,ports=approachLanes(current()).filter(v=>v.points[0].junction.entry===m.points[0].junction.entry),n={x:-u.y,y:u.x},values=ports.flatMap(v=>{const p=v.points[0],x=(p.x-d.start.x)*n.x+(p.y-d.start.y)*n.y,w=(p.laneWidth??12*ppf())/2;return [x-w,x+w];}),lo=Math.min(...values),hi=Math.max(...values);width=(hi-lo)/ppf();center.x+=n.x*(hi+lo)/2;center.y+=n.y*(hi+lo)/2;}
    return {center,width,length:Math.max(1,Math.abs(along)/ppf())};
  }
  function selectMovementFromDrawing(key){
    movement=key;part=null;renderFields(false);draw();
    // Wait for the shared select picker and focus restoration to finish before
    // revealing this movement, including when the matrix was collapsed.
    queueMicrotask(()=>{
      if(!active()||movement!==key)return;
      const row=[...fields.querySelectorAll('[data-movement-row]')].find(row=>row.dataset.movementRow===key);
      if(!row)return;
      row.closest('details').open=true;
      const cell=row.querySelector('.signalSelectedCell')??row;
      cell.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
      cell.querySelector('.nativeSelectTrigger')?.focus({preventScroll:true});
    });
  }
  function pointerDown(event){
    if(!active()||event.button!==0||event.target.closest('.editor'))return false;
    const hit=event.target.closest('[data-signal-part]'),path=event.target.closest('[data-signal-movement]');
    if(!hit&&!path&&!placing)return false;
    if(running)return false;
    const stop=()=>{event.preventDefault();event.stopImmediatePropagation();};stop();
    const point=S.toImage(event.clientX,event.clientY);let item=current();
    if(hit){const target=S.selected.intersections.find(i=>String(i.id)===hit.dataset.intersection);if(target!==item){select(target);item=target;}}
    if(!item)return true;
    const c=item.trafficSignal,p=local(item,point);
    if(path&&!placing){selectMovementFromDrawing(path.dataset.signalMovement);return true;}
    if(placing==='arm'){
      if(drag?.kind==='new-detector'){const d=detectorDragGeometry(drag);svg('rect',{x:-d.length*ppf()/2,y:-d.width*ppf()/2,width:d.length*ppf(),height:d.width*ppf(),transform:`translate(${d.center.x} ${d.center.y}) rotate(${drag.lane.angle})`,fill:'none',stroke:'#aaa','stroke-width':1/sheet.view.scale},group);}
    if(drag?.kind==='new-arm'){const dx=p.x-drag.start.x,dy=p.y-drag.start.y,arm={id:uid(),...drag.start,length:Math.max(10,Math.min(150,Math.hypot(dx,dy))),angle:Math.atan2(dy,dx)*180/Math.PI};c.arms.push(arm);part={kind:'arm',id:arm.id};drag=null;placing=null;commit('Mast arm placed.');}
      else {drag={kind:'new-arm',start:p};draw();}return true;
    }
    if(placing==='head'){
      const arm=c.arms.find(a=>a.id===hit?.dataset.id||a.id===c.heads.find(h=>h.id===hit?.dataset.id)?.arm);if(!arm){status.textContent='Place heads on a mast arm.';return true;}
      const snap=snapHead(item,arm,p),h={id:uid(),arm:arm.id,at:snap.at,type:newHeadType,auto:true,angle:arm.angle,approach:snap.approach??null,movement:placingMovement??snap.movement??movement??M.key(paths(item)[0]??{})};c.heads.push(h);part={kind:'head',id:h.id};commit('Signal head placed. Click the arm to add another.');return true;
    }
    if(placing==='ped'&&M.features.pedestrians){
      let best=null;for(const m of S.selected.markings.filter(m=>A.markingCatalog?.find?.(m.type)?.kind==='crosswalk'||m.type.toLowerCase().includes('crosswalk')))for(const [end,q] of crosswalkEnds(m).entries()){const distance=Math.hypot(q.x-point.x,q.y-point.y);if(!best||distance<best.distance)best={marking:m.id,end,distance};}
      if(!best||best.distance*S.selected.view.scale>30){status.textContent='Choose an end of a crosswalk.';return true;}
      const ped={id:uid(),marking:best.marking,end:best.end,phase:selectedPhase,countdown:true};c.peds.push(ped);part={kind:'ped',id:ped.id};placing=null;commit('Pedestrian head placed. Click it to call the pedestrian phase.');return true;
    }
    if(placing==='detector'){
      const lane=nearestLane(item,point);if(!lane||lane.distance*S.selected.view.scale>30){status.textContent='Start the detector on an incoming lane.';return true;}
      drag={kind:'new-detector',start:lane.point,lane,pointer:event.pointerId,shift:event.shiftKey};get('workspace').setPointerCapture(event.pointerId);return true;
    }
    if(hit){part={kind:hit.dataset.signalPart==='arm-tip'?'arm':hit.dataset.signalPart,id:hit.dataset.id};
      if(part.kind==='ped'){controller(item)?.requestPed(c.peds.find(v=>v.id===part.id).phase);renderFields();draw();return true;}
      const collection={arm:'arms',head:'heads',detector:'detectors'}[part.kind],v=c[collection]?.find(v=>v.id===part.id);
      if(v){drag={kind:hit.dataset.signalPart,id:v.id,start:p,before:structuredClone(v),pointer:event.pointerId};get('workspace').setPointerCapture(event.pointerId);if(part.kind==='head')status.textContent='Drag to a movement line to link. Hold Shift to share; drag along the mast arm to reposition.';}renderFields();draw();return true;
    }return true;
  }
  get('workspace').addEventListener('pointermove',event=>{
    if(!drag||!current())return;const item=current(),p=local(item,S.toImage(event.clientX,event.clientY)),c=item.trafficSignal;
    if(drag.kind==='new-arm'){drag.end=p;draw();return;}if(drag.pointer!==event.pointerId)return;
    event.preventDefault();event.stopImmediatePropagation();
    if(drag.kind==='new-detector'){drag.end=S.toImage(event.clientX,event.clientY);drag.shift=event.shiftKey;draw();return;}
    const key=drag.kind.startsWith('arm')?'arms':drag.kind==='head'?'heads':'detectors',v=c[key].find(v=>v.id===drag.id);if(!v)return;
    if(drag.kind==='arm-tip'){v.length=Math.max(10,Math.min(150,Math.hypot(p.x-v.x,p.y-v.y)));v.angle=Math.atan2(p.y-v.y,p.x-v.x)*180/Math.PI;}
    else if(drag.kind==='head'){
      const arm=c.arms.find(a=>a.id===v.arm),u=vector(arm.angle),distance=Math.abs((p.x-arm.x)*-u.y+(p.y-arm.y)*u.x)*ppf()*S.selected.view.scale;
      const path=document.elementFromPoint(event.clientX,event.clientY)?.closest('[data-signal-movement]');
      drag.targetMovement=path?.dataset.signalMovement??null;drag.linking=Boolean(path)||distance>18;drag.end=p;drag.share=event.shiftKey;
      Object.assign(v,structuredClone(drag.before));
      if(!drag.linking)v.at=snapHead(item,arm,p).at;
    }
    else {v.x=drag.before.x+p.x-drag.start.x;v.y=drag.before.y+p.y-drag.start.y;}
    draw();
  },true);
  get('workspace').addEventListener('pointerup',event=>{
    if(!drag||drag.kind==='new-arm'||drag.pointer!==event.pointerId)return;event.preventDefault();event.stopImmediatePropagation();
    const d=drag;drag=null;get('workspace').releasePointerCapture(event.pointerId);
    if(d.kind==='head'){
      const v=config().heads.find(h=>h.id===d.id);if(!v)return;
      if(d.linking){Object.assign(v,d.before);if(d.targetMovement){
        if(event.shiftKey||d.share)M.assignHeadMovement(v,d.targetMovement,linkBank);
        else {const source=linkBank==='circular'?'secondaryMovement':'movement',shared=linkBank==='circular'?'sharedCircularMovements':'sharedMovements';v[source]=d.targetMovement;v[shared]=(v[shared]??[]).filter(k=>k!==d.targetMovement);}
        movement=d.targetMovement;headSelection=v.id;commit('Signal head linked to movement.');return;
      }}
      if(JSON.stringify(v)===JSON.stringify(d.before)){renderFields();draw();return;}
    }
    if(d.kind==='new-detector'){
      const {center,width,length}=detectorDragGeometry(d);
      const detector={id:uid(),...local(current(),center),angle:d.lane.angle-(current().rotation??0),width,length,phase:config().assignments[M.key(d.lane.m)]?.phase||selectedPhase,mode:'presence',memory:true,delay:0,extend:0};config().detectors.push(detector);part={kind:'detector',id:detector.id};placing=null;
    }
    commit('Signal equipment updated.');
  },true);
  function cancelDrag(){if(drag?.before&&current()){const key=drag.kind.startsWith('arm')?'arms':drag.kind==='head'?'heads':'detectors',v=config()[key].find(v=>v.id===drag.id);if(v)Object.assign(v,drag.before);}drag=null;placing=null;draw();}
  get('workspace').addEventListener('pointercancel',cancelDrag,true);
  overlay.addEventListener('click',event=>{const hit=event.target.closest('[data-signal-part="ped"]');if(hit&&(running||event.detail===0)){const item=S.selected.intersections.find(i=>String(i.id)===hit.dataset.intersection),ped=item?.trafficSignal.peds.find(p=>p.id===hit.dataset.id);if(ped){controller(item)?.requestPed(ped.phase);tick(true);}}});
  overlay.addEventListener('keydown',event=>{
    if(!active())return;
    const target=event.target.closest('[data-signal-part]');
    if(target&&!running&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Delete','Backspace'].includes(event.key)){
      event.preventDefault();event.stopImmediatePropagation();const item=S.selected.intersections.find(i=>String(i.id)===target.dataset.intersection);if(item!==current())select(item);
      const kind=target.dataset.signalPart.replace('-tip',''),key={arm:'arms',head:'heads',detector:'detectors',ped:'peds'}[kind],v=config()[key].find(v=>v.id===target.dataset.id);if(!v)return;part={kind,id:v.id};
      if(['Delete','Backspace'].includes(event.key)){config()[key]=config()[key].filter(x=>x!==v);if(kind==='arm')config().heads=config().heads.filter(h=>h.arm!==v.id);part=null;}
      else {const step=event.shiftKey?10:1;if(kind==='head'){const arm=config().arms.find(a=>a.id===v.arm);v.at=Math.max(0,Math.min(arm.length,v.at+(['ArrowLeft','ArrowDown'].includes(event.key)?-step:step)));}else if(kind!=='ped'){if(event.key==='ArrowLeft')v.x-=step;if(event.key==='ArrowRight')v.x+=step;if(event.key==='ArrowUp')v.y-=step;if(event.key==='ArrowDown')v.y+=step;}}
      commit('Signal equipment updated.');overlay.querySelector(`[data-id="${v.id}"]`)?.focus();return;
    }
    if(!['Enter',' '].includes(event.key))return;const path=event.target.closest('[data-signal-movement]'),hit=event.target.closest('[data-signal-part]');if(!path&&!hit)return;event.preventDefault();
    if(path){event.stopPropagation();selectMovementFromDrawing(path.dataset.signalMovement);return;}
    const item=S.selected.intersections.find(i=>String(i.id)===hit.dataset.intersection);if(!item)return;
    if(hit.dataset.signalPart==='ped'){const ped=item.trafficSignal.peds.find(p=>p.id===hit.dataset.id);controller(item)?.requestPed(ped.phase);tick(true);}else if(!running){if(item!==current())select(item);part={kind:hit.dataset.signalPart.replace('-tip',''),id:hit.dataset.id};renderFields();draw();}
  });
  document.addEventListener('keydown',event=>{if(!active()||event.target.closest('input,select,textarea,[role="combobox"]'))return;if(event.key==='Escape'&&(placing||drag)){event.preventDefault();event.stopImmediatePropagation();cancelDrag();status.textContent='Signal placement canceled.';}},true);
  function tick(force=false){if(!running&&!active())return;const now=performance.now();if(!force&&now-lastPaint<100)return;lastPaint=now;draw();const item=current(),ctl=item&&controller(item),label=get('signalLiveStatus');
    if(label&&ctl)label.textContent=ctl.errors.length?'Controller held red:\n'+ctl.errors.join('\n'):ctl.rings.map(r=>`Ring ${r.ring}: ${r.phase?'P'+r.phase:'—'} ${r.state} · ${r.elapsed.toFixed(1)} s · ${r.reason}`).join(' | ')+(ctl.calls.size?' · Calls '+[...ctl.calls].join(', '):'');
  }
  function refresh(){geometry=null;if(!current()&&selected){selected=null;renderFields();}draw();}
  for(const event of ['sheetchange','sheethistory'])document.addEventListener(event,()=>{cancelDrag();geometry=null;if(selectedSheet!==S.selected)selected=null;renderFields();draw();});
  document.addEventListener('sheetview',()=>draw());new MutationObserver(()=>{if(panel.hidden){cancelDrag();A.signalHeadEditor.hide();}else if(current())renderHeadPanel(current());draw();}).observe(panel,{attributes:true,attributeFilter:['hidden']});
  A.signalEditor={editing:()=>Boolean(active()&&current()),select,refresh,configure,setRunning,pointerDown,tick,diagnostics:()=>({selected,part,placing,controllers:engine?.signals?.snapshot()??[]})};
 });
})();
