/* Actuated two-ring controller for simulation, not a cabinet firmware emulator.
   Semantics: FHWA Signal Timing Manual, chapters 4–6 and 9:
   https://ops.fhwa.dot.gov/publications/fhwahop08024/chapter5.htm
   https://ops.fhwa.dot.gov/publications/fhwahop08024/chapter6.htm
   https://ops.fhwa.dot.gov/publications/fhwahop08024/chapter9.htm
   Numeric defaults below are editable example timing, NOT site design values.
   Pedestrian WALK / buffer defaults: MUTCD 11th ed., section 4I.06
   (7 s WALK, 3 s steady-hand buffer); https://mutcd.fhwa.dot.gov/kno_11th_Editionr1.htm
   Leading pedestrian interval: https://highways.dot.gov/safety/proven-safety-countermeasures/leading-pedestrian-interval
   No new calibrated driver parameters: stopping uses the existing driver's
   deceleration. Florida red turns: https://www.flsenate.gov/Laws/Statutes/2026/316.075 */
(() => {
  // Temporarily disabled. Retain saved pedestrian settings for later activation.
  const features={pedestrians:false};
  const number=(v,d,min=0,max=999)=>Number.isFinite(v)?Math.min(max,Math.max(min,v)):d;
  const mod=(a,b)=>((a%b)+b)%b;
  const phaseNumbers=value=>[...new Set((Array.isArray(value)?value:[]).filter(n=>Number.isInteger(n)&&n>=1&&n<=8))];
  const detectorPhases=d=>phaseNumbers(Array.isArray(d.phases)?d.phases:[d.phase]);
  const key=m=>`${m.input}>${m.output}`;
  function reorderPhase(config,id,targetId,after=false){
    const phase=config.phases.find(p=>p.id===id),target=config.phases.find(p=>p.id===targetId);
    if(!phase?.enabled||!target?.enabled||phase.ring!==target.ring||phase.barrier!==target.barrier)return false;
    const group=config.phases.filter(p=>p.ring===phase.ring&&p.barrier===phase.barrier).sort((a,b)=>a.order-b.order||a.id-b.id);
    const from=group.indexOf(phase),drop=group.indexOf(target)+(after?1:0),to=drop-(from<drop?1:0);
    if(from===to)return false;group.splice(from,1);group.splice(to,0,phase);group.forEach((p,index)=>p.order=index);return true;
  }
  const greenPhases=a=>phaseNumbers([a?.phase,...(a?.overlap??[]),...Object.keys(a?.greens??{}).map(Number)]);
  const greenCell=(a,n)=>a?.greens?.[n]??(a?.overlap?.includes(n)?'protected':a?.phase===n?(a.greenMode==='protected'?'protected':'green'):null);
  const serviceCell=(a,n)=>greenCell(a,n)??(a?.permissive?.includes(n)?'permissive':null);
  function setPhaseMode(config,k,n,mode) {
    const a=config.assignments[k]??={phase:0,greenMode:'auto',permissive:[],overlap:[],noTurnOnRed:false};
    if(a.phase===n)a.phase=0;
    for(const field of ['overlap','permissive','flashingRed','flashingRedArrows'])a[field]=(a[field]??[]).filter(id=>id!==n);
    a.greens={...a.greens};delete a.greens[n];
    if(['green','protected'].includes(mode)){
      if(!a.phase){a.phase=n;a.greenMode=mode==='protected'?'protected':'auto';}
      else a.greens[n]=mode;
    }else if(mode==='permissive')a.permissive.push(n);
    else if(mode==='flash-red-arrow')a.flashingRedArrows.push(n);
  }
  // Shared heads link display equipment only; movement timings stay independent.
  const headMovements=(head,bank='main')=>[...new Set((bank==='circular'?[head.secondaryMovement,...(head.sharedCircularMovements??[])]:[head.movement,...(head.sharedMovements??[])]).filter(Boolean))];
  function assignHeadMovement(head,movement,bank) {
    if(bank&&headMovements(head,bank).includes(movement))return;
    for(const [name,primary,shared] of [['main','movement','sharedMovements'],['circular','secondaryMovement','sharedCircularMovements']]){
      const members=headMovements(head,name).filter(k=>k!==movement);
      if(bank===name)members.push(movement);
      head[primary]=members.shift()??'';head[shared]=members;
    }
  }
  const phase=n=>({id:n,enabled:true,ring:n<=4?1:2,barrier:mod(n-1,4)<2?1:2,order:mod(n-1,2),minGreen:5,maxGreen:30,passage:3,minGap:1,timeBeforeReduction:10,timeToReduce:10,yellow:3,red:1,walk:7,pedClear:15,recall:'min',pedRecall:false,pedMode:'actuated',pedLead:0,pedBuffer:3,pedExclusive:false,addedInitial:0,maxInitial:20,split:n%2?15:30});
  function normalize(value={}) {
    const phases=Array.from({length:8},(_,i)=>{
      const p=phase(i+1),v=value.phases?.find(p=>p.id===i+1)??{};
      for(const f of ['minGreen','maxGreen','passage','minGap','timeBeforeReduction','timeToReduce','yellow','red','walk','pedClear','pedLead','pedBuffer','addedInitial','maxInitial','split'])p[f]=number(v[f],p[f],['yellow','split'].includes(f)?.1:0);
      p.maxGreen=Math.max(p.minGreen,p.maxGreen);p.minGap=Math.min(p.passage,p.minGap);
      p.enabled=v.enabled!==false;p.recall=['none','min','max','soft'].includes(v.recall)?v.recall:'min';p.pedRecall=v.pedRecall===true;p.pedMode=['actuated','rest','omit'].includes(v.pedMode)?v.pedMode:'actuated';p.pedExclusive=v.pedExclusive===true;p.order=number(v.order,p.order,0,1);
      return p;
    });
    const c=value.coordination??{};
    return {version:1,mode:['actuated','fixed','coordinated'].includes(value.mode)?value.mode:'actuated',dualEntry:value.dualEntry===true,simultaneousGap:value.simultaneousGap===true,phases,
      assignments:Object.fromEntries(Object.entries(value.assignments??{}).filter(([,a])=>a&&typeof a==='object').map(([k,a])=>[k,{phase:number(a.phase,0,0,8),greens:Object.fromEntries(Object.entries(a.greens??{}).filter(([n,mode])=>phaseNumbers([Number(n)]).length&&['green','protected'].includes(mode))),permissive:phaseNumbers(a.permissive),overlap:phaseNumbers(a.overlap),greenMode:greenMode(value,k),flashingRed:[],flashingRedArrows:phaseNumbers([...phaseNumbers(a.flashingRedArrows),...phaseNumbers(a.flashingRed)]),noTurnOnRed:a.noTurnOnRed===true}])),
      arms:Array.isArray(value.arms)?value.arms:[],heads:Array.isArray(value.heads)?value.heads:[],detectors:Array.isArray(value.detectors)?value.detectors:[],peds:Array.isArray(value.peds)?value.peds:[],
      coordination:{group:typeof c.group==='string'?c.group.slice(0,80):'',cycle:number(c.cycle,90,10,999),offset:number(c.offset,0,0,999),speed:number(c.speed,30,1,85),reference:c.reference??null,distance:number(c.distance,0,0,100000)}};
  }
  function validate(c) {
    const errors=[];
    for(const p of c.phases.filter(p=>p.enabled)) {
      if(features.pedestrians&&p.pedExclusive&&c.phases.some(o=>o.enabled&&o.ring!==p.ring&&o.barrier===p.barrier&&!o.pedExclusive))errors.push(`Exclusive pedestrian phase ${p.id}: omit vehicle phases in the other ring on this side of the barrier.`);
      if(['fixed','coordinated'].includes(c.mode)&&p.split<p.minGreen+p.yellow+p.red)errors.push(`Phase ${p.id}: split must cover minimum green, yellow and red clearance.`);
      if(features.pedestrians&&['fixed','coordinated'].includes(c.mode)&&p.pedMode!=='omit'&&(p.pedRecall||c.peds.some(d=>d.phase===p.id))&&p.split<Math.max(p.minGreen+p.pedLead,p.walk+p.pedClear+p.pedBuffer)+p.yellow+p.red)errors.push(`Phase ${p.id}: split must cover pedestrian service and vehicular clearances, or omit pedestrian service.`);
    }
    if(c.mode==='coordinated') {
      for(const barrier of [1,2]){
        const sum=r=>c.phases.filter(p=>p.enabled&&p.ring===r&&p.barrier===barrier).reduce((s,p)=>s+p.split,0);
        if(Math.abs(sum(1)-sum(2))>.01)errors.push(`Barrier ${barrier}: both rings must have equal total splits.`);
      }
      const total=c.phases.filter(p=>p.enabled&&p.ring===1).reduce((s,p)=>s+p.split,0);
      if(Math.abs(total-c.coordination.cycle)>.01)errors.push('Ring splits must add up to the cycle length.');
    }
    return errors;
  }
  class Controller {
    constructor(config) {
      this.config=normalize(config);
      // Apply the temporary omission only to the runtime copy, never saved data.
      if(!features.pedestrians){
        this.config.peds=[];
        for(const p of this.config.phases)Object.assign(p,{pedMode:'omit',pedRecall:false,pedExclusive:false,pedLead:0,pedBuffer:0});
      }
      this.reset();
    }
    reset() {this.time=0;this.barrier=1;this.calls=new Set();this.holds=new Set();this.forceOffs=new Set();this.actuations=new Map();this.pedCalls=new Set();this.detectorStates=new Map();this.rings=[1,2].map(ring=>({ring,phase:0,state:'red',elapsed:0,lastDetection:0,done:true,reason:'Startup'}));this.served=new Set();this.errors=validate(this.config);this.started=false;}
    sequence(ring,barrier=this.barrier) {return this.config.phases.filter(p=>p.enabled&&p.ring===ring&&p.barrier===barrier).sort((a,b)=>a.order-b.order||a.id-b.id);}
    requestPed(n) {
      const p=this.config.phases[n-1];if(!p?.enabled||p.pedMode==='omit')return;
      this.pedCalls.add(n);const r=this.rings.find(r=>r.phase===n);
      if(this.config.mode==='actuated'&&r?.state==='green'&&(!r.ped||r.elapsed>=this.pedMinimum(r,p))){
        if(p.pedLead||p.pedExclusive)this.forceOffs.add(n);
        else {r.ped=true;r.walkEnd=r.elapsed+p.walk;this.pedCalls.delete(n);}
      }
    }
    demanded(p) {return p&&p.enabled&&(this.rings.some(r=>r.continuation?.next===p.id)||(['min','max'].includes(p.recall)||p.recall==='soft'&&!this.config.phases.some(o=>o.id!==p.id&&o.enabled&&(this.calls.has(o.id)||this.pedCalls.has(o.id))))||p.pedRecall&&p.pedMode!=='omit'||this.calls.has(p.id)||this.pedCalls.has(p.id)||this.config.mode==='fixed');}
    start(r,p) {
      Object.assign(r,{phase:p.id,state:'green',elapsed:0,lastDetection:0,done:false,gapReady:false,continuation:null,reason:'Green',maxStarted:null,ped:p.pedMode!=='omit'&&(this.pedCalls.has(p.id)||p.pedRecall),walkEnd:p.walk,initial:Math.max(p.minGreen,Math.min(p.maxInitial,p.minGreen+(this.actuations.get(p.id)??0)*p.addedInitial))});
      this.calls.delete(p.id);this.pedCalls.delete(p.id);this.actuations.delete(p.id);this.forceOffs.delete(p.id);this.served.add(p.id);
    }
    beginBarrier() {
      this.served.clear();const barrierDemand=this.config.phases.some(p=>p.barrier===this.barrier&&this.demanded(p));
      for(const r of this.rings) {const p=this.sequence(r.ring).find(p=>p.id===r.continuation?.next)??this.sequence(r.ring).find(p=>this.demanded(p))??(this.config.dualEntry&&barrierDemand?this.sequence(r.ring).at(-1):null);if(p)this.start(r,p);else Object.assign(r,{phase:0,state:'red',elapsed:0,done:true,ped:false,continuation:null,reason:'No call'});}
    }
    aspect(n) {const p=this.config.phases[n-1];if(this.rings.some(r=>r.state==='green'&&r.ped&&this.config.phases[r.phase-1]?.pedExclusive&&r.elapsed<this.pedMinimum(r,this.config.phases[r.phase-1])))return 'red';const r=this.rings.find(r=>r.phase===n);if(r?.state==='green'&&r.ped&&(r.elapsed<p.pedLead||p.pedExclusive))return 'red';return r?.state??'red';}
    pedestrian(n) {const r=this.rings.find(r=>r.phase===n),p=this.config.phases[n-1];if(!r?.ped||r.state!=='green')return 'hand';return r.elapsed<r.walkEnd?'walk':r.elapsed<r.walkEnd+p.pedClear?'clearance':'hand';}
    pedMinimum(r,p) {return r.ped?r.walkEnd+p.pedClear+p.pedBuffer:0;}
    restWalk(r,p,dt,demand) {if(r.ped&&p.pedMode==='rest'&&!demand&&r.elapsed<=r.walkEnd+dt)r.walkEnd=Math.max(r.walkEnd,r.elapsed+dt);}
    detect(dt,occupied) {
      const active=new Set(),requests=new Map();
      for(const d of this.config.detectors) {
        let s=this.detectorStates.get(d.id);if(!s){s={occupied:false,seconds:0,extend:0};this.detectorStates.set(d.id,s);}
        const on=occupied.has(d.id),pulse=on&&!s.occupied;s.seconds=on?s.seconds+dt:0;
        const qualified=on&&s.seconds+1e-8>=(d.delay??0),trigger=d.mode==='pulse'?qualified&&!s.qualified:qualified;
        if(trigger)s.extend=d.extend??0;else s.extend=Math.max(0,s.extend-dt);
        const call=trigger||s.extend>0;s.qualified=qualified;
        s.occupied=on;s.call=call;
        s.latched??=new Set();
        for(const phase of detectorPhases(d)){
          const serving=this.rings.some(r=>r.phase===phase&&r.state==='green');
          if(pulse&&!serving)this.actuations.set(phase,(this.actuations.get(phase)??0)+1);
          if(serving||d.memory===false)s.latched.delete(phase);
          else if(call)s.latched.add(phase);
          const request=requests.get(phase)??{active:false,latched:false,unlocked:false};
          request.active||=call;request.latched||=s.latched.has(phase);request.unlocked||=d.memory===false;requests.set(phase,request);
        }
      }
      // Aggregate after all detectors update so one idle rectangle cannot erase
      // another detector's active or remembered request for the same phase.
      for(const [phase,r] of requests){
        if(r.active)active.add(phase);
        if(r.active||r.latched)this.calls.add(phase);
        else if(r.unlocked)this.calls.delete(phase);
      }
      return active;
    }
    nextForContinuation(r) {
      // An overlap may stay green through its parent phases' change intervals:
      // https://epg.modot.org/index.php?title=902.23_Traffic_Signal_Phasing_and_Operation
      const source=this.config.phases[r.phase-1];let next;
      if(this.config.mode==='coordinated'){
        const seq=[...this.sequence(r.ring,1),...this.sequence(r.ring,2)];next=seq[(seq.findIndex(p=>p.id===r.phase)+1)%seq.length];
        if(!this.demanded(next))return null;
      }else{
        next=this.sequence(r.ring).find(p=>!this.served.has(p.id)&&p.order>source.order&&this.demanded(p));
        if(!next){const opposite=this.barrier===1?2:1,reserved=this.rings.find(r=>r.continuation?.cycle)?.continuation.next;
          const barrier=reserved?this.config.phases[reserved-1].barrier:this.config.phases.some(p=>p.barrier===opposite&&this.demanded(p))?opposite:this.barrier;
          next=this.sequence(r.ring,barrier).find(p=>this.demanded(p))??(this.config.dualEntry?this.sequence(r.ring,barrier).at(-1):null);
        }
      }
      // A pedestrian lead/exclusive interval must begin with vehicle red.
      if(!next||next.id===r.phase||next.pedLead||this.config.phases.some(p=>p.enabled&&p.pedExclusive&&[source.barrier,next.barrier].includes(p.barrier)))return null;
      return next;
    }
    heldService(a) {
      let held=null;
      for(const r of this.rings)if(r.continuation){const mode=serviceCell(a,r.phase);if(mode&&mode===serviceCell(a,r.continuation.next)){if(mode!=='permissive')return mode;held=mode;}}
      return held;
    }
    heldGreen(a) {const mode=this.heldService(a);return mode==='permissive'?null:mode;}
    clear(r,reason) {if(r.state==='green'){
      const next=this.nextForContinuation(r);
      if(next&&this.aspect(r.phase)==='green'&&Object.values(this.config.assignments).some(a=>serviceCell(a,r.phase)&&serviceCell(a,r.phase)===serviceCell(a,next.id))){const source=this.config.phases[r.phase-1];r.continuation={next:next.id,cycle:next.barrier!==source.barrier||next.order<=source.order};}
      r.state='yellow';r.elapsed=0;r.reason=reason;r.ped=false;
    }}
    clearance(r,dt) {
      const p=this.config.phases[r.phase-1];if(!p||r.done)return;
      r.elapsed+=dt;
      if(r.state==='yellow'&&r.elapsed+1e-8>=p.yellow){r.state='red';r.elapsed=0;}
      else if(r.state==='red'&&r.elapsed+1e-8>=p.red)r.done=true;
    }
    step(dt,occupied=new Set(),time=this.time+dt) {
      this.time=time;if(this.errors.length)return;
      const detected=this.detect(dt,occupied);
      if(!this.started){this.started=true;if(this.config.mode!=='coordinated')this.beginBarrier();}
      if(this.config.mode==='coordinated'){this.stepCoordinated(dt,detected);return;}
      const otherDemand=this.config.phases.some(p=>this.demanded(p)&&!this.rings.some(r=>r.phase===p.id&&!r.done));
      for(const r of this.rings) {
        const p=this.config.phases[r.phase-1];if(!p||r.done)continue;
        if(r.state!=='green'){this.clearance(r,dt);continue;}
        r.elapsed+=dt;r.gapReady=false;
        if(detected.has(p.id)){r.lastDetection=r.elapsed;this.calls.delete(p.id);}
        this.restWalk(r,p,dt,otherDemand||this.forceOffs.has(p.id));
        const pedMinimum=this.pedMinimum(r,p);
        if(otherDemand&&r.maxStarted==null)r.maxStarted=r.elapsed;
        const gap=p.passage-(p.passage-p.minGap)*Math.min(1,Math.max(0,r.elapsed-p.timeBeforeReduction)/(p.timeToReduce||.001));
        const minimum=Math.max(r.initial+(r.ped?p.pedLead:0),pedMinimum);
        if(r.elapsed+1e-8<minimum)continue;
        if(this.forceOffs.has(p.id)){this.clear(r,'Manual force-off');continue;}
        if(this.holds.has(p.id))continue;
        if(this.config.mode==='fixed'){if(r.elapsed+1e-8>=Math.max(minimum,p.split-p.yellow-p.red))this.clear(r,'Fixed split');}
        else if(otherDemand&&r.maxStarted!=null&&r.elapsed-r.maxStarted+1e-8>=p.maxGreen)this.clear(r,'Max-out');
        else if(otherDemand&&p.recall!=='max'&&r.elapsed-r.lastDetection+1e-8>=gap)r.gapReady=true;else r.gapReady=false;
      }
      for(const r of this.rings)if(r.state==='green'&&r.gapReady){const other=this.rings.find(o=>o!==r),last=this.sequence(r.ring).at(-1)?.id===r.phase,otherLast=this.sequence(other.ring).at(-1)?.id===other.phase;if(!this.config.simultaneousGap||!last||other.done||otherLast&&other.gapReady)this.clear(r,'Gap-out');}
      for(const r of this.rings)if(r.done){
        if(r.continuation?.cycle)continue;
        const next=r.continuation?this.sequence(r.ring).find(p=>p.id===r.continuation.next):this.sequence(r.ring).find(p=>!this.served.has(p.id)&&(!r.phase||p.order>this.config.phases[r.phase-1].order)&&this.demanded(p));if(next)this.start(r,next);
      }
      if(this.rings.every(r=>r.done)) {
        const opposite=this.barrier===1?2:1;
        const reserved=this.rings.find(r=>r.continuation?.cycle)?.continuation.next;
        if(reserved)this.barrier=this.config.phases[reserved-1].barrier;
        else if(this.config.phases.some(p=>p.barrier===opposite&&this.demanded(p)))this.barrier=opposite;
        this.beginBarrier();
      }
    }
    stepCoordinated(dt,detected) {
      // Fixed force-off reference: beginning of ring 1 phase 1 (first enabled).
      // Uncalled slots stay red; an actuated slot can gap out early. No shortened
      // yellow/red to recover an offset; wait for the next slot.
      const c=this.config,cycleTime=mod(this.time-c.coordination.offset,c.coordination.cycle);
      for(const r of this.rings) {
        const seq=[...this.sequence(r.ring,1),...this.sequence(r.ring,2)];let end=0;
        const p=seq.find(p=>{end+=p.split;return cycleTime<end;});if(!p)continue;
        const age=cycleTime-(end-p.split),startAllowed=age+Math.max(p.minGreen,this.pedCalls.has(p.id)||p.pedRecall?p.walk+p.pedClear+p.pedBuffer:0)<=p.split-p.yellow-p.red+dt;
        if(r.continuation&&p.id!==r.phase&&(p.id!==r.continuation.next||!startAllowed)){
          Object.assign(r,{continuation:null,state:'yellow',elapsed:0,done:false,ped:false,reason:'Missed continuation clearance'});continue;
        }
        if(r.phase!==p.id||r.done&&r.slot!==Math.floor((this.time-c.coordination.offset)/c.coordination.cycle)+':'+p.id) {
          if(!r.done&&r.state!=='green'){this.clearance(r,dt);continue;}
          if(!r.done&&r.phase&&r.state==='green'){this.clear(r,'Force-off');continue;}
          r.slot=Math.floor((this.time-c.coordination.offset)/c.coordination.cycle)+':'+p.id;
          if(this.demanded(p)&&startAllowed){this.start(r,p);}
          else {Object.assign(r,{phase:p.id,state:'red',done:true,ped:false,reason:'Waiting for coordinated slot'});continue;}
        }
        if(r.done)continue;
        if(r.state!=='green'){this.clearance(r,dt);continue;}
        r.elapsed+=dt;if(detected.has(p.id)){r.lastDetection=r.elapsed;this.calls.delete(p.id);}
        const demand=this.config.phases.some(o=>o.id!==p.id&&this.demanded(o));this.restWalk(r,p,dt,demand||age+dt>=p.split-p.yellow-p.red-p.pedClear-p.pedBuffer);
        const min=Math.max(r.initial+(r.ped?p.pedLead:0),this.pedMinimum(r,p)),force=age+dt>=p.split-p.yellow-p.red;
        if(r.elapsed>=min&&(force||this.forceOffs.has(p.id)||!this.holds.has(p.id)&&demand&&p.recall!=='max'&&r.elapsed-r.lastDetection>=p.passage))this.clear(r,force?'Force-off':'Gap-out');
      }
    }
    snapshot() {return {time:this.time,rings:this.rings.map(r=>({...r})),calls:[...this.calls],pedCalls:[...this.pedCalls],errors:this.errors};}
  }
  function indication(controller,assignment) {
    if(!assignment)return 'red';
    const protectedPhases=greenPhases(assignment);
    if(controller.heldGreen?.(assignment)||protectedPhases.some(n=>controller.aspect(n)==='green'))return 'green';
    if(controller.heldService?.(assignment)==='permissive')return 'permissive';
    if(protectedPhases.some(n=>controller.aspect(n)==='yellow'))return 'yellow';
    if((assignment.permissive??[]).some(n=>controller.aspect(n)==='green'))return 'permissive';
    // End permissive flashing service with the parent's steady yellow interval.
    // MUTCD 11th ed. Part 4, 4F.04 / 4F.08:
    // https://mutcd.fhwa.dot.gov/pdfs/11th_Edition/part4.pdf
    if((assignment.permissive??[]).some(n=>controller.aspect(n)==='yellow'))return 'yellow';
    if([...(assignment.flashingRed??[]),...(assignment.flashingRedArrows??[])].some(n=>controller.aspect(n)==='green'))return 'flash-red';
    return 'red';
  }
  function crosses(a,b) {
    for(let i=1;i<a.length;i++)for(let j=1;j<b.length;j++){
      const p=a[i-1],q=b[j-1],u={x:a[i].x-p.x,y:a[i].y-p.y},v={x:b[j].x-q.x,y:b[j].y-q.y},den=u.x*v.y-u.y*v.x;
      if(Math.abs(den)<1e-9)continue;
      const t=((q.x-p.x)*v.y-(q.y-p.y)*v.x)/den,s=((q.x-p.x)*u.y-(q.y-p.y)*u.x)/den;
      if(t>=0&&t<=1&&s>=0&&s<=1)return true;
    }return false;
  }
  // Circular green permits turns while yielding. A green arrow retains
  // protected service. FHWA Signal Timing Manual §§4.3.1, 4.3.2 and 4.6:
  // https://ops.fhwa.dot.gov/publications/fhwahop08024/chapter4.htm
  function greenMode(config,k) {
    const a=config.assignments?.[k];if(['auto','protected'].includes(a?.greenMode))return a.greenMode;
    // Older projects used one green state: preserve dedicated arrow heads;
    // circular heads and movements without equipment use ordinary green.
    return (config.heads??[]).some(h=>h.movement===k&&h.type&&h.type!=='ball')?'protected':'auto';
  }
  const junctionOf=m=>m?.junction??m?.points?.find(p=>p.junction)?.junction;
  function movementType(m) {
    const j=junctionOf(m);if(!Number.isFinite(j?.angle)||!Number.isFinite(j?.exitAngle))return 'unknown';
    const turn=mod(j.exitAngle-j.angle,360)-180;
    return Math.abs(turn)<=30?'through':turn>30&&turn<150?'right':turn< -30&&turn> -150?'left':'uturn';
  }
  function phaseMode(config,m,n) {
    const a=config.assignments[key(m)]??{};
    if(a.greens?.[n])return a.greens[n];
    if(a.overlap?.includes(n))return 'protected';
    if(a.phase===n)return greenMode(config,key(m))==='protected'?'protected':'green';
    if(a.permissive?.includes(n))return 'permissive';
    // Older circular flash assignments retain their service with the arrow glyph.
    if(a.flashingRedArrows?.includes(n)||a.flashingRed?.includes(n))return 'flash-red-arrow';
    return 'red';
  }
  function canYieldTo(config,a,b,n,m) {
    if(phaseMode(config,a,n)!=='green')return false;
    const type=movementType(a),other=movementType(b);if(!['left','right'].includes(type))return false;
    if(phaseMode(config,b,m)==='protected')return true;
    const aj=junctionOf(a),bj=junctionOf(b),opposed=aj&&bj&&Math.abs(mod(aj.angle-bj.angle+180,360)-180)>135;
    // Opposing ordinary left turns can have intersecting paths in an offset
    // layout. Both still use the vehicle gap checks; neither is a protected arrow.
    return other==='through'&&(type==='right'||opposed)||type==='left'&&['left','right'].includes(other)&&opposed;
  }
  function movementState(controller,m) {
    const a=controller.config.assignments[key(m)],aspect=indication(controller,a);
    const protectedArrow=controller.heldGreen?.(a)==='protected'||greenPhases(a).some(n=>controller.aspect(n)===aspect&&phaseMode(controller.config,m,n)==='protected');
    const permissiveYellow=aspect==='yellow'&&(a?.permissive??[]).some(n=>controller.aspect(n)==='yellow')&&!greenPhases(a).some(n=>controller.aspect(n)==='yellow');
    const greenBall=['green','yellow'].includes(aspect)&&a&&!protectedArrow&&!permissiveYellow;
    return {aspect,greenBall:Boolean(greenBall),yielding:Boolean(aspect==='permissive'||permissiveYellow||greenBall&&['left','right'].includes(movementType(m)))};
  }
  function conflictErrors(config,movements=[]) {
    const errors=[],active=a=>greenPhases(a).filter(n=>config.phases[n-1]?.enabled);
    for(let i=0;i<movements.length;i++)for(let j=i+1;j<movements.length;j++){
      const a=movements[i],b=movements[j];if(a.input===b.input||a.output===b.output||!crosses(a.points,b.points))continue;
      const conflict=active(config.assignments[key(a)]).some(n=>active(config.assignments[key(b)]).some(m=>(n===m||config.phases[n-1].ring!==config.phases[m-1].ring&&config.phases[n-1].barrier===config.phases[m-1].barrier)&&!canYieldTo(config,a,b,n,m)&&!canYieldTo(config,b,a,m,n)));
      if(conflict)errors.push(`Conflicting protected movements ${i+1} and ${j+1}. Separate their phases, or use a yielding green ball / flashing indication for a permitted turn.`);
    }return errors;
  }
  function validateSaved(c) {
    if(!c||typeof c!=='object'||Array.isArray(c))return false;
    if(!Object.keys(c).length)return true;
    if(c.version!==1||!Array.isArray(c.phases)||c.phases.length!==8||!c.assignments||typeof c.assignments!=='object'||Array.isArray(c.assignments))return false;
    const finite=(n,min=-100000,max=100000)=>typeof n==='number'&&Number.isFinite(n)&&n>=min&&n<=max;
    const ids=a=>Array.isArray(a)&&a.every(n=>Number.isInteger(n)&&n>=1&&n<=8);
    if(c.phases.some(p=>['pedLead','pedBuffer','addedInitial','maxInitial'].some(k=>p?.[k]!=null&&!finite(p[k],0,999))))return false;
    if(c.phases.some((p,i)=>p?.id!==i+1||['minGreen','maxGreen','passage','minGap','timeBeforeReduction','timeToReduce','yellow','red','walk','pedClear','split'].some(k=>!finite(p[k],0,999))))return false;
    if(Object.entries(c.assignments).some(([k,a])=>!k.includes('>')||!a||!Number.isInteger(a.phase)||a.phase<0||a.phase>8||!ids(a.permissive)||!ids(a.overlap)||(a.greenMode!=null&&!['auto','protected'].includes(a.greenMode))||(a.flashingRed!=null&&!ids(a.flashingRed))||(a.flashingRedArrows!=null&&!ids(a.flashingRedArrows))))return false;
    if(Object.values(c.assignments).some(a=>a.greens!=null&&(typeof a.greens!=='object'||Array.isArray(a.greens)||Object.entries(a.greens).some(([n,mode])=>!ids([Number(n)])||!['green','protected'].includes(mode)))))return false;
    for(const kind of ['arms','heads','detectors','peds'])if(!Array.isArray(c[kind])||c[kind].length>1000||c[kind].some(v=>!v||typeof v.id!=='string')||new Set(c[kind].map(v=>v.id)).size!==c[kind].length)return false;
    if(c.arms.some(a=>!finite(a.x)||!finite(a.y)||!finite(a.angle,-360,360)||!finite(a.length,10,150)))return false;
    if(c.heads.some(h=>!c.arms.some(a=>a.id===h.arm)||!finite(h.at,0,150)||!finite(h.angle,-360,360)||!['ball','left','right','up','fya-left','fya-right','doghouse'].includes(h.type)))return false;
    if(c.heads.some(h=>h.design!=null&&!validHeadDesign(h.design)))return false;
    if(c.heads.some(h=>['sharedMovements','sharedCircularMovements'].some(k=>h[k]!=null&&(!Array.isArray(h[k])||h[k].length>1000||h[k].some(m=>typeof m!=='string'||!m.includes('>'))))))return false;
    if(c.detectors.some(d=>!finite(d.x)||!finite(d.y)||!finite(d.angle,-720,720)||!finite(d.length,1,1000)||!finite(d.width,1,20000)||(d.phases!=null?(!ids(d.phases)||!d.phases.length):!ids([d.phase]))||!finite(d.delay,0,999)||!finite(d.extend,0,999)))return false;
    if(c.peds.some(p=>typeof p.marking!=='string'||![0,1].includes(p.end)||!ids([p.phase])))return false;
    if(!c.coordination||!finite(c.coordination.cycle,10,999)||!finite(c.coordination.offset,0,999)||!finite(c.coordination.speed,1,85)||!finite(c.coordination.distance,0,100000))return false;
    return true;
  }
  function validHeadDesign(d){
    if(!d||typeof d!=='object'||Array.isArray(d)||!['vertical','horizontal'].includes(d.orientation)||!Array.isArray(d.indications)||d.indications.length<1||d.indications.length>5)return false;
    if(Object.keys(d).some(k=>!['orientation','cluster','fourCluster','dad','hawk','indications'].includes(k)))return false;
    if(['cluster','dad','hawk'].some(k=>typeof d[k]!=='boolean')||![null,'above','below'].includes(d.fourCluster))return false;
    if([d.cluster,!!d.fourCluster,d.dad,d.hawk].filter(Boolean).length>1)return false;
    if((d.cluster||d.fourCluster||d.dad||d.hawk)&&d.orientation!=='vertical')return false;
    if(d.cluster&&d.indications.length!==5||d.fourCluster&&d.indications.length!==4||(d.dad||d.hawk)&&d.indications.length!==3)return false;
    const symbols=['ball','left','right','up','down','up-left','up-right','u-turn','bicycle','bus-stop','bus-straight','bus-left','bus-right','triangle'];
    return new Set(d.indications.map(i=>i?.id)).size===d.indications.length&&d.indications.every(i=>i&&typeof i.id==='string'&&[8,12].includes(i.size)&&['red','yellow','green','white'].includes(i.color)&&symbols.includes(i.symbol)&&(i.service==null||['auto','red','yellow','green','permissive','flash-red','flash-yellow','off'].includes(i.service))&&(i.source==null||['auto','main','circular'].includes(i.source)));
  }
  function remap(config,map) {
    if(!config?.version)return;
    const mapped=k=>k?.split('>').map(id=>map.get(id)??id).join('>');
    config.assignments=Object.fromEntries(Object.entries(config.assignments).map(([k,a])=>[mapped(k),a]));
    for(const head of config.heads){if(head.approach)head.approach=map.get(head.approach)??head.approach;head.movement=mapped(head.movement);if(head.secondaryMovement)head.secondaryMovement=mapped(head.secondaryMovement);for(const k of ['sharedMovements','sharedCircularMovements'])if(head[k])head[k]=head[k].map(mapped);}
  }
  function detectorContains(d,car,ppf) {
    const a=d.angle*Math.PI/180,dx=car.x-d.x,dy=car.y-d.y;
    if((car.level??1)!==(d.level??1))return false;
    // Rectangles are oriented along travel; include the vehicle footprint.
    const half=Math.max(ppf,Math.min(car.laneWidth??12*ppf,12*ppf)-2*ppf)*381/214/2;
    const along=dx*Math.cos(a)+dy*Math.sin(a),across=-dx*Math.sin(a)+dy*Math.cos(a);
    return Math.abs(along)<=d.length*ppf/2+half&&Math.abs(across)<=d.width*ppf/2;
  }
  class System {
    constructor(records=[],ppf=1) {this.records=new Map(records.map(r=>{const controller=new Controller(r.config);controller.errors.push(...conflictErrors(controller.config,r.movements));return [r.id,{...r,controller}];}));this.ppf=ppf;}
    reset(){for(const r of this.records.values()){r.controller.reset();r.controller.errors.push(...conflictErrors(r.controller.config,r.movements));}}
    step(dt,cars,time) {
      for(const r of this.records.values()) {const occupied=new Set();for(const d of r.detectors??[])if(cars.some(car=>detectorContains(d,car,this.ppf)))occupied.add(d.id);r.controller.step(dt,occupied,time);}
      for(const car of cars)this.observe(car);
    }
    observe(car) {
      delete car.signalControl;
      const half=Math.max(this.ppf,Math.min(car.laneWidth??12*this.ppf,12*this.ppf)-2*this.ppf)*381/214/2;
      for(const m of car.path.movements) {
        const record=this.records.get(m.intersection);if(!record||m.end<car.pathDistance)continue;
        const k=key(m.junction??{}),assignment=record.controller.config.assignments[k];
        // Empty legacy markers are configured only after opening the editor.
        if(!record.config.version)continue;
        const distance=m.control?.distance??m.start,remaining=distance-car.pathDistance-half;
        const crossed=remaining<-.001*this.ppf; // admitted vehicles keep clearing on a later red
        const stateOfSignal=movementState(record.controller,{...m.junction,input:m.junction?.input,output:m.junction?.output,junction:m.junction}),aspect=stateOfSignal.aspect,token=`${m.intersection}:${k}:${m.control?.marking??'mouth'}`;
        const state=car.signalMemory??={};
        if(state.token!==token)Object.assign(state,{token,stopped:false,stoppedAt:null,yellowPass:false,braking:null,last:null});
        if(aspect==='flash-red'&&state.last!=='flash-red'){state.stopped=false;state.stoppedAt=null;}
        if(remaining<=.001*this.ppf&&car.speed===0){state.stopped=true;state.stoppedAt??=record.controller.time;}
        if(aspect==='yellow'&&(state.last!=='yellow'||state.yellowPass)){
          const preferred=car.driver?.deceleration??2,safe=Math.max(preferred,car.driver?.safeBraking??4),ppm=this.ppf/.3048;
          const needed=car.speed*car.speed/(2*Math.max(.001*this.ppf,remaining))/ppm;
          const parents=phaseNumbers([...greenPhases(assignment),...(assignment?.permissive??[])]),left=Math.max(0,...record.controller.rings.filter(r=>r.state==='yellow'&&parents.includes(r.phase)).map(r=>record.controller.config.phases.find(p=>p.id===r.phase).yellow-r.elapsed));
          const approachSpeed=Math.min(car.speed,car.desiredSpeed??car.speed),clears=remaining<=approachSpeed*left;
          // Steady yellow warns of red (F.S. 316.075(1)(b)). Prefer a stop;
          // when comfortable braking is insufficient, continue only if the
          // line is reachable during yellow or no modeled safe stop remains.
          // Forecast uses the current/local speed, never acceleration to beat
          // red. This is a numerical decision policy, not a measured response.
          // https://www.flsenate.gov/Laws/Statutes/2026/316.075
          state.yellowPass=needed>preferred&&(clears||needed>safe);
          if(!state.yellowPass)state.braking=Math.max(preferred,Math.min(safe,needed));
        }
        if(aspect!=='yellow')state.yellowPass=false;if(['green','permissive'].includes(aspect))state.braking=null;state.last=aspect;
        const j=m.junction??{},delta=mod((j.exitAngle??0)-(j.angle??0)-180+180,360)-180;
        const entry=j.approachLanes?.find(a=>a.id===j.entry),exit=j.approachLanes?.find(a=>a.id===j.exit);
        const redTurn=assignment&&!assignment.noTurnOnRed&&(delta>30||delta< -30&&!entry?.outgoing?.length&&!exit?.incoming?.length);
        const pedActive=record.controller.rings.some(r=>record.controller.pedestrian(r.phase)!=='hand');
        const pedBlocked=(record.pedConflicts?.[k]??[]).some(n=>record.controller.pedestrian(n)!=='hand');
        const permitted=!pedBlocked&&(aspect==='flash-yellow'||aspect==='flash-red'&&state.stopped||aspect==='green'||aspect==='permissive'||aspect==='yellow'&&state.yellowPass||aspect==='red'&&redTurn&&state.stopped&&!pedActive);
        // Stop-then-yield permission ranks below moving green-ball / flashing-
        // yellow traffic; protected/through green keeps the existing rank 2.
        const priority=crossed?state.priority??1:!permitted?0:['red','flash-red'].includes(aspect)?.5:['green','flash-yellow'].includes(aspect)&&!stateOfSignal.yielding?2:1;if(!crossed)state.priority=priority;
        car.signalControl={movement:m,aspect,yielding:stateOfSignal.yielding,distance,remaining:Math.max(0,remaining),allowed:crossed||Boolean(permitted),priority,token,braking:state.braking};break;
      }
    }
    snapshot(){return [...this.records].map(([id,r])=>({id,...r.controller.snapshot()}));}
  }
  const api={features,normalize,validate,phase,key,reorderPhase,greenPhases,setPhaseMode,headMovements,assignHeadMovement,Controller,System,indication,greenMode,movementType,phaseMode,movementState,canYieldTo,detectorPhases,detectorContains,mod,crosses,conflictErrors,validateSaved,remap};
  if(typeof module!=='undefined')module.exports=api;else (globalThis.StripeMaker??={}).simulatorSignals=api;
})();
