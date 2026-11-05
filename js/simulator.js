/* Simulator overlays follow SignalMaker's editor actions (GPL-3.0).
   Saved lane references are resolved again after edits; route geometry is never
   saved or exported as plan markings. Invalidated routes are not drawn. */
(() => {
  document.addEventListener('DOMContentLoaded', () => {
    const app = window.StripeMaker, sheets = app.sheets;
    const get = id => document.getElementById(id);
    const panel = get('simulatorEditor'), button = get('createVehicleSpawnPoint');
    const signalButton = get('addTrafficSignal');
    const controlButtons={stop:get('addStopControl'),yield:get('addYieldControl')};
    const removeSpawn = get('removeVehicleSpawnPoint'), removeRoute = get('removeVehicleExitRoute');
    const status = get('simulatorStatus'), workspace = get('workspace');
    const densityOverlay=document.createElement('div');densityOverlay.className='markingOverlay simulatorDensity';densityOverlay.hidden=true;sheets.addOverlay(densityOverlay);
    const overlay = document.createElement('div');
    overlay.className = 'markingOverlay simulatorOverlay'; sheets.addOverlay(overlay);
    const SVG = 'http://www.w3.org/2000/svg';
    let placing = false, placingSignal = false, placingControl = null, selectedControl = null, hover = null, selected = null, selectedRoute = null;
    let linking = false, drag = null, preview = null, network = null;
    const active = () => !panel.hidden;
    const playButton = get('playSimulation'), pauseButton = get('pauseSimulation'), clearButton = get('clearSimulation');
    const rateInput = get('vehicleSpawnRate'), rateUnit = get('vehicleSpawnRateUnit'), volumeMode = get('simulatorRouteVolumeMode'), spawnFields = get('simulatorSpawnFields');
    const volumes=app.simulatorVolumes;
    const vehicles = app.simulatorVehicles, drivers = app.simulatorDrivers, engine = new vehicles.Engine({behavior:drivers});
    const carsOverlay = document.createElement('div');
    carsOverlay.className = 'markingOverlay simulatorCars'; sheets.addOverlay(carsOverlay);
    const speedOverlay=document.createElement('div');speedOverlay.className='markingOverlay simulatorSpeeds';speedOverlay.hidden=true;sheets.addOverlay(speedOverlay);
    const speedElements=new Map();
    const stoppedOverlay=document.createElement('div');stoppedOverlay.className='markingOverlay simulatorStoppedTimes';stoppedOverlay.hidden=true;sheets.addOverlay(stoppedOverlay);
    const stoppedElements=new Map();
    const carElements = new Map();
    let densityGraph=null,densityGrid=null,densityGroup=null,densityNodes=[],densityUpdatedAt=-Infinity;
    let running = false, frame = null, previousTime = null, simulationSheet = null, updatingRouteList = false, updatingLaneList = false, preservePlaybackPaths = false;
    const same = (a, b) => a && b && a.road === b.road && a.lane === b.lane && (a.e ?? 0) === (b.e ?? 0);
    const spawnOf = ref => (sheets.selected?.vehicleSpawns ?? []).find(s => s.road === ref?.road && (s.e ?? 0) === (ref?.e ?? 0));
    const hasSpawn = ref => Boolean(spawnOf(ref));
    const spawnRate = spawn => volumes.rate(spawn);
    const routeShares = spawn => volumes.mode(spawn)==='percent'?vehicles.distribution(spawn?.routes??[]):volumes.shares(spawn);
    const controlKind=marking=>marking?.type==='stopLine'?'stop':marking?.type==='yieldLine'?'yield':null;
    const hasControl=marking=>controlKind(marking)&&marking.trafficControl?.type===controlKind(marking);
    const currentControl=()=>sheets.selected?.markings?.find(m=>m.id===selectedControl&&hasControl(m));
    function controlGeometry(marking){
      const rings=app.markings?.outlines(marking.id)??[],points=rings.flat();if(!points.length)return null;
      const x0=Math.min(...points.map(p=>p.x)),x1=Math.max(...points.map(p=>p.x)),y0=Math.min(...points.map(p=>p.y)),y1=Math.max(...points.map(p=>p.y));
      return {rings,points,center:{x:(x0+x1)/2,y:(y0+y1)/2},edge:{x:x1,y:(y0+y1)/2}};
    }
    function controlIntersections(marking){
      const sheet=sheets.selected,geometry=controlGeometry(marking);if(!geometry)return [];
      const level=marking.on?.intersection!=null?(sheet.intersections.find(i=>i.id===marking.on.intersection)?.level??1):app.levels.levelAt(sheet,geometry.center,marking.on?.road);
      const points=[...geometry.points,geometry.center],G=app.intersectionGeometry;
      // A UI association radius, not a traffic-design or driver-perception standard.
      const limit=250*12/sheet.inchesPerPixel;
      return (sheet.intersections??[]).filter(item=>(item.level??1)===level).map(item=>{
        const polygon=app.intersections.outlineOf(sheet,item);let distance=Infinity;
        for(const p of points){
          if(G.contains(p,polygon)){distance=0;break;}
          for(let i=0;i<polygon.length;i++){
            const a=polygon[i],b=polygon[(i+1)%polygon.length],dx=b.x-a.x,dy=b.y-a.y,f=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1)));
            distance=Math.min(distance,Math.hypot(p.x-a.x-dx*f,p.y-a.y-dy*f));
          }
        }return {item,distance};
      }).filter(({item,distance})=>distance<=limit||item.id===marking.trafficControl?.intersection).sort((a,b)=>a.distance-b.distance);
    }
    let controlFieldsKey='';
    function updateControlFields(){
      const marking=currentControl(),fields=get('simulatorControlFields');fields.hidden=!marking;
      if(!marking){controlFieldsKey='';return;}
      get('simulatorControlTitle').textContent=`${controlKind(marking).toUpperCase()} control`;
      const choices=controlIntersections(marking),select=get('simulatorControlIntersection'),unlinked=marking.trafficControl.unlinked===true,linked=marking.trafficControl.intersection??'';
      const resolved=app.markings.simulatorControls(sheets.selected).find(c=>c.marking===marking.id&&c.intersection!=null);
      const automatic=!unlinked&&!linked?resolved:null;
      const name=automatic&&sheets.selected.intersections.find(i=>i.id===automatic.intersection)?.name||'Intersection';
      const key=JSON.stringify([marking.id,linked,unlinked,automatic?.intersection,choices.map(({item})=>[item.id,item.name])]);
      if(key!==controlFieldsKey){
        select.replaceChildren(new Option(automatic?`Automatic: ${name}`:'Automatic',''),new Option('Not linked','none'),...choices.map(({item})=>new Option(item.name||'Intersection',item.id)));
        select.value=unlinked?'none':linked;controlFieldsKey=key;
      }
      select.disabled=running;get('removeSimulatorControl').disabled=running;
      get('simulatorControlHint').textContent=unlinked?'Automatic linking is disabled for this control. Vehicles still obey the line, but it does not set intersection priority.':
        automatic?`Automatically controls ${name} because this line is ${automatic.inferred?'at its connected road entrance':'on its approach'}.`:
        linked?'This control participates in the selected intersection’s right-of-way rules.':
        choices.length?'Not linked: vehicles obey this line, but it does not set intersection priority. Choose a nearby intersection to include it in turn-taking.':'No nearby intersections. Vehicles obey this line as a standalone control.';
    }
    function drawControls(root){
      const controls=app.markings.simulatorControls(sheets.selected);
      for(const marking of sheets.selected.markings??[]){
        const kind=controlKind(marking),placed=hasControl(marking);if(!placed&&placingControl!==kind||!kind)continue;
        const geometry=controlGeometry(marking);if(!geometry)continue;
        if(selectedControl===marking.id)for(const ring of geometry.rings)svg('path',{d:`M${ring.map(p=>{const s=sheets.toScreen(p);return `${s.x},${s.y}`;}).join('L')}Z`,class:'markingSelected'},root);
        const at=sheets.toScreen(geometry.edge),marker=document.createElement('button');marker.type='button';marker.className='simulatorControl'+(placed?'':' simulatorControlTarget');marker.dataset.marking=marking.id;
        marker.style.left=`${at.x+12}px`;marker.style.top=`${at.y}px`;marker.disabled=running;
        const association=controls.find(c=>c.marking===marking.id&&c.intersection!=null);
        marker.setAttribute('aria-label',`${placed?'Select':'Add'} ${kind.toUpperCase()} control${association?' '+(association.inferred?'automatically connected':'linked')+' to '+(sheets.selected.intersections.find(i=>i.id===association.intersection)?.name||'intersection'):''}`);
        marker.setAttribute('aria-pressed',String(marking.id===selectedControl));
        const icon=svg('svg',{viewBox:'0 0 20 20','aria-hidden':'true'},marker);
        if(kind==='stop')svg('polygon',{points:'6,1 14,1 19,6 19,14 14,19 6,19 1,14 1,6',fill:'#d00000',stroke:'#fff','stroke-width':1},icon);
        else {svg('polygon',{points:'1,2 19,2 10,19',fill:'#d00000',stroke:'#fff','stroke-width':.7},icon);svg('polygon',{points:'5,4.5 15,4.5 10,14',fill:'#fff'},icon);}
        overlay.append(marker);
      }
    }
    function chooseControl(marking){
      if(running||!hasControl(marking))return;
      cancelDrag();selected=null;selectedRoute=null;linking=false;preview=null;placing=false;placingSignal=false;placingControl=null;selectedControl=marking.id;
      refreshOverlay(false);status.textContent=`${controlKind(marking).toUpperCase()} control selected. ${get('simulatorControlHint').textContent}`;
    }
    function placeControl(marking){
      if(running||!placingControl||controlKind(marking)!==placingControl)return;
      if(!hasControl(marking)){marking.trafficControl={type:placingControl};selectedControl=marking.id;placingControl=null;changed('Traffic control placed.');}
      chooseControl(marking);(get('simulatorControlIntersection-button')??get('simulatorControlIntersection')).focus({preventScroll:true});
    }
    function groups(refs) {
      const result = new Map();
      for (const ref of refs) {
        const key = `${ref.road}:${ref.e}`, group = result.get(key) ?? { road: ref.road, e: ref.e, lane: ref.lane, lanes: [] };
        group.lanes.push(ref); result.set(key, group);
      }
      return [...result.values()].map(group => ({ ...group, point: {
        x: group.lanes.reduce((sum, ref) => sum + ref.point.x, 0) / group.lanes.length,
        y: group.lanes.reduce((sum, ref) => sum + ref.point.y, 0) / group.lanes.length,
      } }));
    }
    const entranceGroups = graph => groups(graph.entrances);
    function lanesFor(ref, graph = currentNetwork()) { return graph.entrances.filter(lane => lane.road === ref?.road && lane.e === (ref?.e ?? 0)); }
    function laneShares(ref, graph = currentNetwork()) {
      const spawn = spawnOf(ref);
      return vehicles.distribution(lanesFor(ref, graph).map(lane => ({ ...lane,
        percent: spawn?.laneShares?.[lane.lane] ?? ((spawn?.excludedLanes ?? []).includes(lane.lane) ? 0 : 1),
      })));
    }
    const sameRoute = (route, ref) => sameExit(route.exit, ref) && route.lane === ref?.fromLane;
    function routePaths(ref, route, graph = currentNetwork()) {
      // A graph is immutable until the next edit. Share the lane searches and
      // resolved paths between route drawing, playback setup and pointer previews.
      const cache = graph.simulatorPaths ??= new Map();
      const key = JSON.stringify([ref.road, ref.e ?? 0, route.lane, route.exit]);
      if (cache.has(key)) return cache.get(key);
      const paths = lanesFor(ref, graph).filter(lane => route.lane == null || route.lane === lane.lane).flatMap(source => {
        const candidates = [...graph.search(source).values()].filter(path => path.exit.road === route.exit.road
          && (route.exit.lane == null || path.exit.lane === route.exit.lane)
          && path.exit.e === (route.exit.e ?? 1));
        // Road-wide destinations do not make drivers change lanes needlessly.
        // Only prepare for a turn/drop when staying in lane cannot reach it.
        const fewest = Math.min(...candidates.map(path => path.laneChanges?.length ?? 0));
        return candidates.filter(path => (path.laneChanges?.length ?? 0) === fewest).map(path => ({ ...path, source }));
      });
      cache.set(key, paths); return paths;
    }
    const makeNetwork = sheet => app.simulatorRouting.build(sheet, app.roadEditor.simulatorNetwork(sheet),
      app.intersections.simulatorNetwork(sheet), app.traffic.reversed, app.roadEditor.pairOf, {
        pixelsPerFoot: 12 / sheet.inchesPerPixel,
        allowSlowLaneChanges:true,
        // Initial routing seed; personalized playback uses the local zone.
        // Zero-speed zones do not erase legal topology.
        speed: app.speedZones.planningSpeed(sheet) * 5280 / 3600 * 12 / sheet.inchesPerPixel,
      });
    function currentNetwork() { return network ??= makeNetwork(sheets.selected); }
    function entrances(sheet) {
      return [...new Set(makeNetwork(sheet).entrances.map(ref => ref.road))].map(id => sheet.roads.find(r => r.id === id));
    }
    const sameExit = (a, b) => a && b && a.road === b.road && a.lane === b.lane && (a.e ?? 1) === (b.e ?? 1);
    function playbackPlan(graph,path,anyLane=false) {
      const zoned=points=>app.speedZones.decoratePlayback(graph.decorateMerges(points));
      const mergePaths=new WeakMap();
      const personalize=(record,{driver,random,cars,speed,reserveSpeed=0})=>{
        const start=zoned(record.points)?.[0],local=Math.min(speed||graph.speed,(start?.zoneLimit??Infinity)*(driver.speedFactor??1));
        return zoned(graph.personalize(record,driver,random,
          context=>drivers.assess(context,cars,driver,local,graph.pixelsPerFoot),local,Math.min(reserveSpeed,(start?.zoneLimit??Infinity)*(driver.speedFactor??1))));
      };
      return {
        plan:options=>personalize(path,options),
        mergeContext:car=>{
          const m=car.path.maneuvers.find(m=>m.end>car.pathDistance+1e-6);
          if(!m)return null;
          const C=app.simulatorLaneChanges,from=graph.laneRecords.get(`r:${m.road}:${m.from}`),to=graph.laneRecords.get(`r:${m.road}:${m.to}`);
          if(!from||!to||!graph.continues(m.road,m.to))return null;
          if(graph.continues(m.road,m.from)&&
            (graph.continuesTo(m.road,m.from,path.exit,{anyLane})||!graph.continuesTo(m.road,m.to,path.exit,{anyLane})))return null;
          const first=car.path.points.findIndex(p=>p.road===m.road&&p.lane===m.from);
          if(first<0||car.path.points.slice(0,first).some((p,i)=>i>0&&car.path.lengths[i]>car.pathDistance&&p.intersection!=null))return null;
          const direction=car.path.points[first].direction??1,total=C.stationsOf(from).at(-1);
          const station=car.road===m.road?car.station:car.path.points[first].station-direction*Math.max(0,car.path.lengths[first]-car.pathDistance);
          const remaining=direction>0?total-station:station;
          let approachPath=mergePaths.get(car.path);
          if(!approachPath){
            const prefix=car.path.points.slice(0,first).map(({maneuver,...p})=>p);
            const start=car.path.points[first].station,a=C.sample(from,start),b=C.sample(to,start);
            // Curve preference follows the continuing roadway alignment.
            // Lateral packing in a disappearing lane is merge geometry, not
            // a new low-speed road bend. Translate only this curvature
            // reference to meet the real ramp mouth; vehicle paths stay put.
            const alignment=C.slice(to,start,direction>0?total:0).map(p=>({...p,x:p.x+a.x-b.x,y:p.y+a.y-b.y}));
            approachPath=vehicles.preparePath([...prefix,...alignment]);
            mergePaths.set(car.path,approachPath);
          }
          const entry=zoned([C.sample(to,Math.max(0,Math.min(total,station)))])[0];
          const origin=C.sample(from,Math.max(0,Math.min(total,station))),durationFactor=Math.max(1,Math.hypot(entry.x-origin.x,entry.y-origin.y)/(12*graph.pixelsPerFoot));
          const approachDistance=car.road===m.road?0:Math.max(0,car.path.lengths[first]-car.pathDistance);
          return {road:m.road,from:m.from,to:m.to,direction,station,remaining,approachDistance,approachPath,durationFactor,limit:entry.zoneLimit??Infinity};
        },
        // A lane change takes time (NHTSA DOT HS 809 702 durations, see
        // simulator-lane-changes.js), not a fixed stretch of road. A car that
        // slows while straddling (approaching a queue) finishes its remaining
        // lateral move within its remaining personal time at current speed,
        // so it does not stop across two queues. The rebuilt curve continues
        // the current lateral rate and is no sharper than an S-curve on the
        // AASHTO P design vehicle's 24-ft minimum design turning radius
        // (Green Book, Table 2-2a). Steering geometry only: following, gap
        // admission and swept-body collision checks are unchanged.
        compress:({car,driver,cars=[]})=>{
          const m=car.laneChange,t=m?.progress??0;
          if(!m||!(t>1e-6&&t<1-1e-6)||car.road!==m.road)return null;
          // Arriving sooner needs clear bodies ahead and behind in the target
          // lane, and a follower that can respond within its safe braking
          // (the rear half of the admission test; following a queue ahead
          // is normal IDM and is not a reason to stay across two lanes).
          const check=drivers.safe({...car,lane:m.from},cars,m.to,car.desiredSpeed??car.speed,graph.pixelsPerFoot);
          if(!(check.frontGap>0&&check.rearGap>0&&check.follower>=-drivers.parameter(check.neighbors.rear?.car.driver,'safeBraking')*graph.pixelsPerFoot/.3048))return null;
          const man=car.path.maneuvers.find(x=>x.road===m.road&&x.from===m.from&&x.to===m.to&&x.start<=car.pathDistance+1e-6&&x.end>car.pathDistance);
          const C=app.simulatorLaneChanges,from=graph.laneRecords.get(`r:${m.road}:${m.from}`),to=graph.laneRecords.get(`r:${m.road}:${m.to}`);
          if(!man||!from||!to||!Number.isFinite(car.station))return null;
          const ppf=graph.pixelsPerFoot,direction=car.direction??1,total=C.stationsOf(to).at(-1),remaining=man.end-car.pathDistance;
          const a=C.sample(from,car.station),b=C.sample(to,car.station),separation=Math.hypot(b.x-a.x,b.y-a.y);
          const u=t*t*t*(10+t*(-15+6*t)),rate=30*t*t*(1-t)*(1-t)/Math.max(1e-9,man.end-man.start),lateral=separation*(1-u);
          const R=24*ppf,cos=Math.max(-1,1-lateral/(2*R)),geometric=2*R*Math.sqrt(Math.max(0,1-cos*cos));
          const time=driver.duration*Math.max(1,separation/(12*ppf))*(1-t);let span=Math.max(geometric,car.speed*time,ppf);
          // A turn bay still tapering open: finish where it fits the body
          // (12-ft-lane body, simulator-collisions.js), never sooner.
          const full=car.path.points.find((p,i)=>car.path.lengths[i]>=man.end-1e-6)?.laneWidth??12*ppf,body=Math.min(full,12*ppf)-2*ppf;
          while(span<remaining*.8&&C.sample(to,car.station+direction*span).laneWidth<body+ppf)span+=2*ppf;
          if(span>remaining*.8)return null;
          const endStation=car.station+direction*span;
          if(endStation<0||endStation>total)return null;
          const k=Math.max(0,Math.min(3,rate*span/Math.max(1e-9,1-u))),limit=car.path.points.find((p,i)=>car.path.lengths[i]>=car.pathDistance)?.maneuverLimit;
          const curve=[];
          for(let i=0;i<=24;i++){
            const s=i/24,station=car.station+direction*span*s,A=C.sample(from,station),B=C.sample(to,station);
            const h=(k-2)*s*s*s+(3-2*k)*s*s+k*s,v=u+(1-u)*h;
            curve.push({x:A.x+(B.x-A.x)*v,y:A.y+(B.y-A.y)*v,lateral:A.lateral+(B.lateral-A.lateral)*v,laneWidth:Math.min(A.laneWidth,B.laneWidth),level:A.level,
              road:m.road,lane:i<24?m.from:m.to,direction,station,...(limit!=null?{maneuverLimit:limit}:{}),
              maneuver:{road:m.road,from:m.from,to:m.to,progress:t+(1-t)*s,acrossBike:Boolean(m.acrossBike),fromX:A.x,fromY:A.y,toX:B.x,toY:B.y,fromWidth:A.laneWidth,toWidth:B.laneWidth}});
          }
          const last=car.path.lengths.findIndex(d=>d>man.end+1e-6);if(last<0)return null;
          const resume=car.path.points[last-1]?.station;if(!Number.isFinite(resume))return null;
          const bridge=C.slice(to,endStation,resume).slice(1,-1).map(p=>({...p,direction,...(limit!=null?{maneuverLimit:limit}:{})}));
          const {maneuver,...joined}=car.path.points[last-1];
          return [...zoned([...curve,...bridge]),joined,...car.path.points.slice(last)];
        },
        passing:car=>graph.pairs.filter(pair=>pair.road===car.road&&!pair.crossings?.length&&[pair.from,pair.to].includes(car.lane))
          .map(pair=>pair.from===car.lane?pair.to:pair.from),
        replan:options=>{
          const {car,target,driver,speed}=options;
          if(car.road==null||car.laneChange?.progress>1e-6)return null;
          if(target==null){
            if(options.mergeDelay>0){
              const C=app.simulatorLaneChanges,next=car.path.maneuvers.find(m=>!car.committed.has(m)&&m.end>car.pathDistance);
              if(!next)return null;
              let state=car,prefix=[];
              if(next.road!==car.road){
                const entry=car.path.points.findIndex((p,i)=>p.road===next.road&&p.lane===next.from&&car.path.lengths[i]>=car.pathDistance);
                if(entry<0)return null;
                const first=car.path.lengths.findIndex(d=>d>car.pathDistance);
                // The old mouth sample may mark maneuver progress zero.
                // Keeping that marker would pin the new maneuver's start to
                // the joint even after moving its actual steering farther on.
                prefix=[vehicles.position(car.path,car.pathDistance),...car.path.points.slice(first,entry+1)].map(({maneuver,...point})=>point);
                state={...car,...car.path.points[entry],lane:next.from};
              }
              const lane=graph.laneRecords.get(`r:${state.road}:${state.lane}`),total=lane&&C.stationsOf(lane).at(-1);
              const at=state.station+state.direction*Math.max(car.speed,options.mergeSpeed??0)*options.mergeDelay;
              if(!lane)return null;
              const rest=at>=0&&at<=total&&graph.continueFrom({...state,station:at},path.exit,{anyLane}),tail=rest&&personalize(rest,{...options,speed:Math.max(car.speed,options.mergeSpeed??0),reserveSpeed:options.speed});
              if(tail)return zoned([...prefix,...C.slice(lane,state.station,at),...tail]);
              // The static graph reserves a full-speed maneuver. A slower car
              // can still use the remaining acceleration lane: forecast its
              // personal acceleration over its full lane-change duration,
              // then reconnect to the same legal destination from that lane.
              if(next.from!==state.lane)return null;
              const to=graph.laneRecords.get(`r:${state.road}:${next.to}`),pair=graph.pairs.find(p=>p.road===state.road&&[p.from,p.to].includes(state.lane)&&[p.from,p.to].includes(next.to));
              if(!to||!pair)return null;
              const forecast={station:state.station,direction:state.direction,speed:car.speed,target:options.mergeSpeed??speed,
                acceleration:drivers.parameter(driver,'acceleration')*graph.pixelsPerFoot/.3048,duration:driver.duration,delay:options.mergeDelay,pixelsPerFoot:graph.pixelsPerFoot,reserveSpeed:Math.min(speed,(zoned([C.sample(lane,state.station)])[0]?.zoneLimit??Infinity)*(driver.speedFactor??1))};
              // An acceleration forecast may exceed the usable lane while a
              // full maneuver at the present rolling speed still fits. Retain
              // that legal opportunity and reevaluate as speed changes, rather
              // than restoring a virtual stop far before the lane actually ends.
              const rolling=C.rollingTransition(lane,to,pair,forecast)??C.rollingTransition(lane,to,pair,{...forecast,target:car.speed});
              if(!rolling)return null;
              const after=graph.continueFrom({...state,lane:next.to,station:rolling.station},path.exit,{anyLane}),end=after&&personalize(after,options);
              return end?zoned([...prefix,...rolling.points,...end]):null;
            }
            const rest=graph.continueFrom(car,path.exit,{anyLane});return rest?personalize(rest,options):null;
          }
          const C=app.simulatorLaneChanges,from=graph.laneRecords.get(`r:${car.road}:${car.lane}`),to=graph.laneRecords.get(`r:${car.road}:${target}`);
          const pair=graph.pairs.find(pair=>pair.road===car.road&&[pair.from,pair.to].includes(car.lane)&&[pair.from,pair.to].includes(target));
          if(!from||!to||!pair||pair.crossings?.length&&!options.required)return null;
          // A discretionary pass/courtesy move must not add a mandatory
          // return weave to the same exit (for example, passing in an exit-only
          // lane and cutting back). Mandatory route changes are handled below.
          const remaining=car.path.maneuvers.filter(m=>m.end>car.pathDistance&&!car.committed.has(m)).length;
          const turns=car.path.movements.filter(m=>m.end>car.pathDistance+1e-6);
          const useful=rest=>rest&&app.simulatorRouting.sameTurns(rest.points,turns)&&(options.required||rest.laneChanges.length<=remaining);
          const approach=car.path.movements.some(m=>m.junction&&!m.circle&&m.start>car.pathDistance);
          if(!options.required&&!options.cooperative&&!approach){
            // Retain the existing cruising pass geometry away from junction queues.
            const total=C.stationsOf(from).at(-1),a=C.sample(from,car.station),b=C.sample(to,car.station);
            const span=(speed||graph.speed)*driver.duration*Math.max(1,Math.hypot(a.x-b.x,a.y-b.y)/(12*graph.pixelsPerFoot)),end=car.station+car.direction*span;
            if(end<0||end>total)return null;
            const crossing=C.transition(from,to,car.station,end,pair,total);if(!crossing)return null;
            const rest=graph.continueFrom({...car,lane:target,station:end},path.exit,{anyLane}),tail=useful(rest)&&personalize(rest,options);
            return tail?zoned([...crossing,...tail]):null;
          }
          // Use the same personal-duration acceleration forecast for queue
          // changes as for required merges. Cruise speed × duration rejected
          // almost every low-speed opportunity near a signal. This is a
          // numerical path forecast; IDM, safe gaps and swept bodies still
          // determine actual motion. Keep lane boundaries and the full route.
          const crossing=C.rollingTransition(from,to,pair,{station:car.station,direction:car.direction,speed:car.speed,target:speed,
            acceleration:drivers.parameter(driver,'acceleration')*graph.pixelsPerFoot/.3048,duration:driver.duration,delay:0,pixelsPerFoot:graph.pixelsPerFoot});
          if(!crossing)return null;
          if(approach&&car.signalControl?.aspect==='red'&&!car.signalControl.allowed&&!options.required){
            // A safe initial target gap is insufficient if either queue stops
            // the car before it finishes steering. Keep the full maneuver and
            // wait for room; do not shorten its curve to squeeze into storage.
            // Moving leaders contribute only their modeled stopping travel,
            // capped at their red line. This is a numerical forecast.
            const ppf=graph.pixelsPerFoot,jam=drivers.parameter(driver,'jamGap')*ppf/.3048,span=Math.abs(crossing.station-car.station);
            for(const lane of [car.lane,target]){
              const front=drivers.neighbors(car,options.cars??[],lane).front;
              if(front){
                const stopping=front.car.speed**2/(2*drivers.parameter(front.car.driver,'deceleration')*ppf/.3048);
                const advance=Math.min(stopping,front.car.signalControl?.remaining??0);
                if(span>drivers.gap(car,front,ppf)-jam+advance)return null;
              }
            }
          }
          const rest=graph.continueFrom({...car,lane:target,station:crossing.station},path.exit,{anyLane}),tail=useful(rest)&&personalize(rest,options);
          return tail?zoned([...crossing.points,...tail]):null;
        },
      };
    }
    function sourcesFor(graph) {
      const sources = [];
      for (const ref of entranceGroups(graph)) if (hasSpawn(ref)) {
        const spawn = spawnOf(ref), routes = [];
        for (const lane of laneShares(ref, graph)) {
          if (!lane.percent) continue;
          const available = routeShares(spawn).map(route => ({ route,
            paths: routePaths(ref, route, graph).filter(path => path.source.lane === lane.lane) })).filter(item => item.paths.length);
          const total = available.reduce((sum, item) => sum + (item.route.percent ?? 1), 0);
          if (!total) continue;
          for (const { route, paths } of available) for (const path of paths) routes.push({
            key: `lane:${lane.lane}:${path.exit.road}:${path.exit.lane}:${path.exit.e}`,
            points: app.speedZones.decoratePlayback(graph.decorateMerges(path.points)), ...playbackPlan(graph,path,route.exit.lane==null), weight: lane.percent * (route.percent ?? 1) / total / paths.length,
          });
        }
        if (routes.length) sources.push({ key: `${ref.road}:${ref.e}`, rate: spawnRate(spawn), routes });
      }
      return sources;
    }
    function renderDensity(force=false){
      const sheet=sheets.selected,visible=active()&&sheet?.inchesPerPixel&&app.settings.get('simulationOverlays').includes('density');
      densityOverlay.hidden=!visible;if(!visible)return;
      const graph=currentNetwork();
      if(graph!==densityGraph){
        densityGraph=graph;densityGrid=app.simulatorDensity.build(graph.laneRecords.values(),12/sheet.inchesPerPixel);densityOverlay.replaceChildren();densityNodes=[];
        const root=svg('svg',{'aria-label':'Road density overlay',role:'img'},densityOverlay);densityGroup=svg('g',{opacity:.28},root);
        for(const cell of [...densityGrid.cells].sort((a,b)=>a.level-b.level))densityNodes[cell.index]=svg('path',{d:cell.d,'data-road':cell.road,'data-lane':cell.lane,'data-start':cell.start,fill:app.simulatorDensity.color(0)},densityGroup);
        densityUpdatedAt=-Infinity;
      }
      densityGroup.setAttribute('transform',`translate(${sheet.view.x} ${sheet.view.y}) scale(${sheet.view.scale})`);
      const now=performance.now();if(!force&&now-densityUpdatedAt<200)return;densityUpdatedAt=now;
      const values=app.simulatorDensity.values(densityGrid,simulationSheet===sheet?engine.cars:[]),shown=app.settings.get('hideLevelsAbove')||Infinity;
      for(const cell of densityGrid.cells){const node=densityNodes[cell.index],value=values[cell.index];node.setAttribute('fill',app.simulatorDensity.color(value));node.setAttribute('data-density',value.toFixed(3));node.style.display=cell.level>shown?'none':'';}
    }
    function renderCars() {
      renderDensity();
      const sheet = sheets.selected, seen = new Set();
      carsOverlay.hidden = !active() || simulationSheet !== sheet;
      speedOverlay.hidden=carsOverlay.hidden||!app.settings.get('simulationOverlays').includes('speed');
      stoppedOverlay.hidden=carsOverlay.hidden||!app.settings.get('simulationOverlays').includes('stopped');
      if (carsOverlay.hidden || !sheet) return;
      const pixelsPerFoot = 12 / sheet.inchesPerPixel * sheet.view.scale;
      for (const car of engine.cars) {
        seen.add(car.id);
        let image = carElements.get(car.id);
        if (!image) {
          image = document.createElement('img'); image.src = 'assets/simulator/simulatorVehicle_standard.svg';
          image.alt = ''; image.draggable = false; image.className = 'simulatorCar'; image.dataset.car = car.id;
          image.style.filter = `hue-rotate(${car.hue}deg)`;
          carsOverlay.append(image); carElements.set(car.id, image);
        }
        const at = sheets.toScreen(car);
        // Leave one foot clear on each side of the current lane, never larger
        // than on a 12 ft lane (cars keep their size on wider lanes). Keep the
        // supplied sprite's visible 214:381 proportions instead of stretching the car.
        const lane = Math.min(car.laneWidth ?? Infinity, 12 * 12 / sheet.inchesPerPixel);
        const width = Math.max(pixelsPerFoot, lane * sheet.view.scale - 2 * pixelsPerFoot);
        image.style.width = `${width}px`; image.style.height = `${width * 381 / 214}px`;
        // The supplied sprite's front (mirrors/windshield) faces down (+y).
        image.style.transform = `translate(${at.x}px,${at.y}px) translate(-50%,-50%) rotate(${car.angle - 90}deg)`;
        if(!speedOverlay.hidden){
          let label=speedElements.get(car.id);
          if(!label){label=document.createElement('span');label.className='simulatorSpeed';label.dataset.car=car.id;speedOverlay.append(label);speedElements.set(car.id,label);}
          const free=engine.speed*(car.driver?.speedFactor??1),target=drivers.collisions.desiredSpeed(car,free,drivers.parameter(car.driver,'deceleration')*engine.pixelsPerFoot/.3048,engine.pixelsPerFoot);
          const mph=Math.max(0,car.speed)/engine.pixelsPerFoot*3600/5280;
          const ratio=target>0?Math.min(1,Math.max(0,car.speed)/target):car.speed===0?1:0;
          const text=mph.toFixed(1);if(label.textContent!==text){label.textContent=text;label.setAttribute('aria-label',`Vehicle ${car.id}: ${text} MPH`);}
          label.style.color=`hsl(${(ratio*120).toFixed(1)} 85% 50%)`;
          label.style.transform=`translate(${at.x}px,${at.y}px) translate(-50%,-50%)`;
        }
        if(!stoppedOverlay.hidden){
          let label=stoppedElements.get(car.id);
          if(!label){label=document.createElement('span');label.className='simulatorStoppedTime';label.dataset.car=car.id;stoppedOverlay.append(label);stoppedElements.set(car.id,label);}
          const text=`${(car.stoppedSeconds??0).toFixed(1)} s`;
          if(label.textContent!==text){label.textContent=text;label.setAttribute('aria-label',`Vehicle ${car.id}: stopped for ${text}`);}
          label.style.transform=`translate(${at.x}px,${at.y+(speedOverlay.hidden?0:14)}px) translate(-50%,-50%)`;
        }
      }
      for (const [id, image] of carElements) if (!seen.has(id)) { image.remove(); carElements.delete(id); }
      for (const [id,label] of speedElements)if(!seen.has(id)||speedOverlay.hidden){label.remove();speedElements.delete(id);}
      for (const [id,label] of stoppedElements)if(!seen.has(id)||stoppedOverlay.hidden){label.remove();stoppedElements.delete(id);}
    }
    function pause(redraw = true) {
      running = false; if (frame !== null) cancelAnimationFrame(frame);
      frame = null; previousTime = null; updateButtons();
      overlay.querySelectorAll('.simulatorSpawn').forEach(point => { point.disabled = false; });
      if (redraw && active() && sheets.selected) refreshOverlay(false);
    }
    function tick(now) {
      frame = null;
      if (!running) return;
      // Advance at most three fixed 30 Hz physics steps per animation frame. Long
      // frames slow simulation time instead of creating a catch-up spiral.
      engine.advance(previousTime === null ? 0 : Math.min(.1, (now - previousTime) / 1000 * app.settings.get('simulationPlaybackRate')));
      previousTime = now; renderCars();app.signalEditor?.tick();
      if (engine.signals?.records.size || engine.cars.length || [...engine.sources.values()].some(source => source.rate > 0 && source.routes.some(route => route.weight > 0))) frame = requestAnimationFrame(tick);
      else pause();
    }
    function syncPlayback(graph) {
      const sheet = sheets.selected;
      if (simulationSheet !== sheet) { pause(false); engine.reset(); simulationSheet = sheet; }
      engine.pixelsPerFoot=12/sheet.inchesPerPixel;
      engine.temperature=app.settings.get('simulationTemperature');
      // Finite numerical envelope for observations/planning, never a local cap.
      engine.speed = app.speedZones.envelope(sheet) * 5280 / 3600 * 12 / sheet.inchesPerPixel;
      engine.setControls([...app.markings.simulatorControls(sheet),...app.markings.simulatorControls(sheet,{signalStops:true})]);
      app.signalEditor?.configure(engine);
      engine.configure(sourcesFor(graph), { preservePaths: preservePlaybackPaths }); preservePlaybackPaths = false; renderCars(); updateButtons();
    }
    function changed(message) {
      sheets.save(sheets.selected); app.history.record(); status.textContent = message;
      network = null; refreshOverlay();
    }
    function updateButtons() {
      app.signalEditor?.setRunning(running);
      removeSpawn.disabled = running || !selected || !hasSpawn(selected);
      removeRoute.disabled = running || !selected || !selectedRoute || !spawnOf(selected)?.routes?.some(r => sameRoute(r, selectedRoute));
      spawnFields.hidden = !selected || !hasSpawn(selected);
      if (!spawnFields.hidden) {
        const spawn=spawnOf(selected),unit=volumes.unit(spawn.rateUnit),mode=volumes.mode(spawn);
        rateUnit.value=unit;volumeMode.value=mode;rateInput.max=volumes.amount(vehicles.MAX_RATE,unit);
        if(document.activeElement!==rateInput)rateInput.value=+volumes.amount(spawnRate(spawn),unit).toFixed(8);
        rateInput.readOnly=mode==='total';
        const hint=get('simulatorVolumeHint');hint.hidden=false;
        hint.textContent=(mode==='total'?'Entrance output is the sum of destination volumes. ':mode==='weights'?'Destination volumes set relative shares; entrance output stays fixed. ':'')+
          'AADT is average daily traffic, spread evenly over 24 hours here.';
      }
      playButton.disabled = running || !sheets.selected || (!engine.signals?.records.size && !engine.cars.length && ![...engine.sources.values()].some(source => source.rate > 0 && source.routes.some(route => route.weight > 0)));
      pauseButton.disabled = !running;
      clearButton.disabled = !sheets.selected || !(running || engine.time > 0 || engine.cars.length);
      button.disabled = running;
      signalButton.disabled = running || !sheets.selected?.inchesPerPixel || !sheets.selected?.intersections?.length;
      signalButton.setAttribute('aria-pressed', String(placingSignal));
      for(const [kind,button] of Object.entries(controlButtons)){
        button.disabled=running||!sheets.selected?.inchesPerPixel;
        button.setAttribute('aria-pressed',String(placingControl===kind));
      }
      updateControlFields();
      for (const id of ['simulationTemperature', 'simulationTemperatureValue', 'vehicleSpawnRate', 'vehicleSpawnRateUnit', 'simulatorRouteVolumeMode']) get(id).disabled = running;
      updateLaneList(); updateRouteList();
      button.setAttribute('aria-pressed', String(placing));
    }
    const routeName = route => route.name ?? `Exit road ${route.exit.road}${route.exit.lane == null ? '' : `, lane ${route.exit.lane + 1}`}`;
    function updateLaneList() {
      if (updatingLaneList) return;
      updatingLaneList = true;
      try {
      const list = get('simulatorLanes');
      const shares = selected && hasSpawn(selected) && sheets.selected ? laneShares(selected) : [];
      list.hidden = shares.length < 2;
      const key = JSON.stringify([selected?.road, selected?.e, shares.map(lane => lane.lane)]);
      if (list.dataset.key !== key) {
        list.dataset.key = key; list.replaceChildren();
        for (const lane of shares) {
          const row = document.createElement('div'); row.className = 'fieldRow'; row.dataset.lane = lane.lane;
          const label = document.createElement('label'); label.htmlFor = `spawn-lane-${lane.lane}-share`; label.textContent = `Lane ${lane.lane + 1} (%)`;
          const pair = document.createElement('div'); pair.className = 'dimensionInputs';
          for (const type of ['range', 'number']) {
            const input = document.createElement('input'); input.type = type; input.min = 0; input.max = 100; input.step = .1;
            if (type === 'range') input.id = label.htmlFor;
            input.setAttribute('aria-label', `Lane ${lane.lane + 1} ${type === 'range' ? 'share' : 'percentage'}`);
            pair.append(input);
          }
          row.append(label, pair); list.append(row);
        }
      }
      for (const row of list.children) {
        const share = shares.find(lane => lane.lane === Number(row.dataset.lane));
        row.querySelectorAll('input').forEach(input => { input.disabled = running; if (document.activeElement !== input) input.value = share.percent; });
      }
      } finally { updatingLaneList = false; }
    }
    function updateRouteList() {
      if (updatingRouteList) return;
      updatingRouteList = true;
      try {
      const list = get('simulatorRoutes');
      const routes = hasSpawn(selected) ? (spawnOf(selected)?.routes ?? []) : [];
      const key = JSON.stringify([selected?.road, selected?.lane, selected?.e, routes.map(route => [route.lane, route.exit])]);
      if (list.dataset.key !== key) {
        list.dataset.key = key; list.replaceChildren();
        routes.forEach((route, index) => {
          // SignalMaker's indication fieldsets, field rows, name input and
          // range/number pairs; each route remains editable in one panel.
          const row = document.createElement('fieldset'); row.className = 'simulatorRouteRow'; row.exit = { ...route.exit, fromLane: route.lane };
          const legend = document.createElement('legend'); legend.textContent = `Route ${index + 1}`; row.append(legend);
          const nameRow = document.createElement('div'); nameRow.className = 'fieldRow';
          const label = document.createElement('label'); label.htmlFor = `simulator-route-${index}-name`; label.textContent = 'Name';
          const name = document.createElement('input'); name.id = label.htmlFor; name.type = 'text'; name.maxLength = 80; name.dataset.routeField = 'name';
          nameRow.append(label, name); row.append(nameRow);
          const shareRow = document.createElement('div'); shareRow.className = 'fieldRow';
          const shareLabel = document.createElement('label'); shareLabel.htmlFor = `simulator-route-${index}-share`; shareLabel.textContent = 'Share (%)';
          const pair = document.createElement('div'); pair.className = 'dimensionInputs';
          for (const type of ['range', 'number']) {
            const input = document.createElement('input'); input.type = type; input.min = 0; input.max = 100; input.step = .1;
            input.dataset.routeField = type === 'range' ? 'share' : 'shareValue';
            if (type === 'range') input.id = shareLabel.htmlFor;
            pair.append(input);
          }
          shareRow.append(shareLabel, pair); row.append(shareRow);
          shareRow.dataset.routeRow='share';
          const volumeRow=document.createElement('div');volumeRow.className='fieldRow simulatorVolumeRow';volumeRow.dataset.routeRow='volume';
          const volumeLabel=document.createElement('label');volumeLabel.htmlFor=`simulator-route-${index}-volume`;volumeLabel.textContent='Volume (vehicles)';
          const inputs=document.createElement('div');inputs.className='dimensionInputs simulatorVolumeInputs';
          const amount=document.createElement('input');amount.id=volumeLabel.htmlFor;amount.type='number';amount.min=0;amount.step='any';amount.dataset.routeField='volume';
          const per=document.createElement('span');per.textContent='per';
          const unit=document.createElement('select');unit.id=`simulator-route-${index}-unit`;unit.dataset.routeField='unit';
          for(const [value,label] of [['seconds','second'],['minutes','minute'],['hours','hour'],['days','day'],['AADT','AADT']])unit.add(new Option(label,value));
          inputs.append(amount,per,unit);volumeRow.append(volumeLabel,inputs);row.append(volumeRow);
          const actions = document.createElement('div'); actions.className = 'headActions';
          const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Remove Route';
          remove.addEventListener('click', () => { if (!running) { selectedRoute = row.exit; updateButtons(); removeRoute.click(); } });
          actions.append(remove); row.append(actions); list.append(row);
        });
      }
      const spawn=spawnOf(selected),mode=volumes.mode(spawn),shares = routeShares(spawn);
      [...list.children].forEach((row, index) => {
        const route = routes[index], name = routeName(route);
        row.querySelectorAll('input,select,button').forEach(input => { input.disabled = running; });
        row.querySelector('[data-route-row="share"]').hidden=mode!=='percent';
        row.querySelector('[data-route-row="volume"]').hidden=mode==='percent';
        const volume=route.volume??{amount:0,unit:'minutes'},amount=row.querySelector('[data-route-field="volume"]'),unit=row.querySelector('[data-route-field="unit"]');
        if(document.activeElement!==amount)amount.value=+volume.amount.toFixed(8);
        amount.max=volumes.amount(vehicles.MAX_RATE,volume.unit);amount.setAttribute('aria-label',`${name} volume`);
        unit.value=volume.unit;unit.setAttribute('aria-label',`${name} volume unit`);
        const nameInput = row.querySelector('[data-route-field="name"]');
        if (document.activeElement !== nameInput) nameInput.value = name;
        nameInput.setAttribute('aria-label', `Route ${index + 1} name`);
        for (const field of ['share', 'shareValue']) {
          const input = row.querySelector(`[data-route-field="${field}"]`);
          if (document.activeElement !== input) input.value = shares[index].percent;
          input.disabled = running || routes.length === 1;
          input.setAttribute('aria-label', `${name} ${field === 'share' ? 'share' : 'percentage'}`);
        }
        row.querySelector('.headActions button').setAttribute('aria-label', `Remove route ${name}`);
      });
      } finally { updatingRouteList = false; }
    }
    function svg(tag, attrs, parent) {
      const element = document.createElementNS(SVG, tag);
      for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
      parent.append(element); return element;
    }
    function arrow(root, points, ref, temporary = false) {
      if (points.length < 2) return;
      const screen = points.map(p => sheets.toScreen(p));
      const d = `M${screen.map(p => `${p.x},${p.y}`).join('L')}`;
      const percent = ref.percent ?? 100, color = vehicles.routeColor(percent);
      const group = svg('g', { class: temporary ? 'simulatorRoutePreview' : 'simulatorRoute', opacity: temporary ? .35 : .55, 'data-percent': percent, 'data-color': color }, root);
      for (const [stroke, width] of [['#fff', 5], [color, 2.5]]) svg('path', { d, fill: 'none', stroke, 'stroke-width': width, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, group);
      const end = screen.at(-1);
      let before = screen.at(-2);
      for (let i = screen.length - 2; i >= 0; i--) if (Math.hypot(end.x - screen[i].x, end.y - screen[i].y) >= 14) { before = screen[i]; break; }
      const angle = Math.atan2(end.y - before.y, end.x - before.x), c = Math.cos(angle), s = Math.sin(angle);
      const p = { x: end.x - c * 12 - s * 6, y: end.y - s * 12 + c * 6 };
      const q = { x: end.x - c * 12 + s * 6, y: end.y - s * 12 - c * 6 };
      svg('path', { d: `M${p.x},${p.y}L${end.x},${end.y}L${q.x},${q.y}`, fill: 'none', stroke: '#fff', 'stroke-width': 5, 'stroke-linejoin': 'round' }, group);
      svg('path', { d: `M${p.x},${p.y}L${end.x},${end.y}L${q.x},${q.y}`, fill: 'none', stroke: color, 'stroke-width': 2.5, 'stroke-linejoin': 'round' }, group);
      if (temporary) return;
      const hit = svg('path', { d, class: 'simulatorRouteHit', fill: 'none', stroke: 'transparent', 'stroke-width': 20,
        tabindex: 0, role: 'button', 'aria-label': `Exit route from road ${ref.road} entrance to road ${ref.exit.road}${ref.exit.lane == null ? '' : `, lane ${ref.exit.lane + 1}`}` }, group);
      const choose = event => { event.stopPropagation(); if(placing||placingSignal||placingControl)return; selectedControl=null;placingControl=null;placingSignal=false;selected = ref; selectedRoute = { ...ref.exit, fromLane: ref.fromLane }; linking = false; preview = null; refreshOverlay(false); status.textContent = 'Exit route selected. Press Delete or Remove Exit Route to remove it.'; };
      hit.addEventListener('click', choose);
      hit.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(event); } });
    }
    function pointButton(ref, kind, text) {
      const p = sheets.toScreen(ref.point), b = document.createElement('button');
      b.type = 'button'; b.className = kind === 'spawn' ? 'simulatorSpawn' : 'simulatorExit';
      b.style.left = `${p.x}px`; b.style.top = `${p.y}px`;
      b.dataset.road = ref.road; b.dataset.lane = ref.lane; b.dataset.end = ref.e;
      b.setAttribute('aria-label', text);
      if (kind === 'spawn') {
        b.setAttribute('aria-pressed', String(same(selected, ref)));
        const image = document.createElement('img'); image.src = 'assets/simulator/vehicleSpawnPoint.png';
        image.alt = ''; image.draggable = false; b.append(image);
      } else { b.textContent = '↗'; b.addEventListener('click', event => { event.stopPropagation(); commit(ref); }); }
      overlay.append(b); return b;
    }
    function refreshOverlay(invalidate = true) {
      app.speedZones?.refresh?.();app.signalEditor?.refresh();
      workspace.classList.toggle('simulatorActive', active());
      workspace.classList.toggle('simulatorSignalPlacing', active() && placingSignal);
      workspace.classList.toggle('simulatorControlPlacing', active() && Boolean(placingControl));
      if (invalidate) network = null;
      overlay.replaceChildren(); updateButtons();
      const sheet = sheets.selected;
      if (!active() || !sheet?.inchesPerPixel) { renderCars(); return; }
      if(app.speedZones?.editing?.()){renderCars();return;}
      const graph = currentNetwork(), root = svg('svg', { 'aria-label': 'Vehicle exit routes' }, overlay);
      drawControls(root);
      for(const item of sheet.intersections??[]){
        if(running&&!app.signalFeatures?.mastHeads)continue;
        if(!item.trafficSignal&&!placingSignal)continue;
        const target=placingSignal&&!item.trafficSignal,marker=document.createElement('button'),p=sheets.toScreen(item);
        marker.className='simulatorSignal'+(target?' simulatorSignalTarget':'');marker.dataset.intersection=item.id;
        marker.style.left=`${p.x}px`;marker.style.top=`${p.y}px`;
        const name=item.name||'Intersection';
        marker.setAttribute('aria-label',target?`Add traffic signal to ${name}`:`Traffic signal at ${name}`);
        if(target){marker.type='button';marker.addEventListener('click',event=>{event.stopPropagation();placeSignal(item);});}
        else {marker.type='button';marker.setAttribute('aria-label',`Edit traffic signal at ${name}`);marker.addEventListener('click',event=>{event.stopPropagation();app.signalEditor?.select(item);});}
        const icon=document.createElement('span');icon.className='material-symbols-outlined';icon.textContent='traffic';icon.setAttribute('aria-hidden','true');marker.append(icon);overlay.append(marker);
      }
      if (invalidate || simulationSheet !== sheet) syncPlayback(graph);
      if (!running && !placingControl && !app.signalEditor?.editing()) for (const ref of entranceGroups(graph)) if (hasSpawn(ref) && (!selected || ref.road===selected.road && ref.e===selected.e)) {
        const exits = groups(graph.exits), saved = routeShares(spawnOf(ref));
        for (const route of saved) {
          const exit = exits.find(exit => exit.road === route.exit.road && exit.e === (route.exit.e ?? 1));
          // One road-following diagram per destination, without lane weaving.
          const path = routePaths(ref, route, graph)[0];
          if (exit && path) arrow(root, graph.displayPath(path),
            { ...ref, exit: route.exit, fromLane: route.lane, percent: route.percent });
        }
      }
      if (preview && selected && !running && !app.signalEditor?.editing()) {
        const entrance = entranceGroups(graph).find(ref => ref.road === selected.road && ref.e === selected.e);
        const exit = groups(graph.exits).find(ref => ref.road === preview.exit.road && ref.e === preview.exit.e);
        if (entrance && exit) arrow(root, graph.displayPath(preview), selected, true);
      }
      for (const ref of entranceGroups(graph)) {
        const placed = hasSpawn(ref), ghost = placing && hover === ref.road && !placed;
        if (!placed && !ghost) continue;
        const b = pointButton(ref, 'spawn', `Vehicle spawn point, road ${ref.road} entrance`);
        b.disabled = running;
        if (ghost) { b.classList.add('simulatorGhost'); b.tabIndex = -1; }
      }
      if (selected && hasSpawn(selected) && linking && !app.signalEditor?.editing()) {
        const reachable = new Set(lanesFor(selected, graph).flatMap(lane => [...graph.search(lane).values()].map(path => path.exit.road)));
        for (const exit of groups(graph.exits).filter(exit => reachable.has(exit.road))) pointButton(exit, 'exit', `Exit road ${exit.road}`);
      }
      renderDensity(true);
    }
    function nearest(event, refs) {
      const p = sheets.toImage(event.clientX, event.clientY);
      let closest = null, distance = 24 / sheets.selected.view.scale;
      for (const ref of refs) {
        const d = Math.min(...[ref.point, ...(ref.lanes ?? []).map(lane => lane.point)].map(point => Math.hypot(p.x - point.x, p.y - point.y)));
        if (d < distance) { distance = d; closest = ref; }
      }
      return closest;
    }
    function cancelDrag() {
      if (drag && workspace.hasPointerCapture(drag.pointer)) workspace.releasePointerCapture(drag.pointer);
      drag = null; preview = null;
    }
    function stop() {
      cancelDrag(); placing = false; placingSignal = false; placingControl = null; hover = null; linking = false;
      refreshOverlay();
    }
    function commit(exit) {
      if (running || !selected || !hasSpawn(selected)) return;
      // Always resolve again on release; restrictions may have changed mid-drag.
      network = null;
      const target = { road: exit.road, e: exit.e };
      const path = routePaths(selected, { exit: target })[0];
      if (!path) { status.textContent = 'No permitted lane route to that exit.'; preview = null; refreshOverlay(false); return; }
      const spawn = spawnOf(selected);
      spawn.routes ??= [];
      if (!spawn.routes.some(r => r.lane == null && sameExit(r.exit, target))) {
        const added = { exit: target };
        if(volumes.mode(spawn)==='percent')spawn.routes = vehicles.distribution([...spawn.routes, added], spawn.routes.length, 100 / (spawn.routes.length + 1));
        else {added.volume={amount:0,unit:volumes.unit(spawn.rateUnit)};spawn.routes.push(added);volumes.sync(spawn);}
      }
      linking = false; preview = null; selectedRoute = target;
      changed('Exit route added. Drag this spawn point again to add another exit.');
    }
    playButton.addEventListener('click', () => {
      if (!sheets.selected?.inchesPerPixel) return;
      network = null; syncPlayback(currentNetwork());
      if (playButton.disabled) return;
      cancelDrag(); placing = false; placingSignal = false; placingControl = null; linking = false; running = true; previousTime = null;
      engine.advance(0); refreshOverlay(false); renderCars(); updateButtons();
      frame = requestAnimationFrame(tick); status.textContent = 'Simulation playing.';
    });
    pauseButton.addEventListener('click', () => { pause(); status.textContent = 'Simulation paused.'; });
    clearButton.addEventListener('click', () => {
      pause(false); engine.reset();
      if(sheets.selected?.inchesPerPixel)syncPlayback(currentNetwork());
      refreshOverlay(false); renderCars(); updateButtons();
      status.textContent = 'Simulation cleared.';
    });
    rateInput.addEventListener('input', () => {
      const value = rateInput.valueAsNumber, spawn = spawnOf(selected);
      const volume={amount:value,unit:rateUnit.value};
      if (running || !spawn || volumes.mode(spawn)==='total' || !volumes.valid(volume)) return;
      spawn.rate = volumes.perMinute(volume);spawn.rateUnit=volume.unit;
      changed('Spawn output updated.');
    });
    rateInput.addEventListener('blur',updateButtons);
    rateUnit.addEventListener('change',()=>{
      const spawn=spawnOf(selected);if(running||!spawn)return;
      spawn.rateUnit=volumes.unit(rateUnit.value);rateInput.value=+volumes.amount(spawnRate(spawn),spawn.rateUnit).toFixed(8);changed('Volume unit updated.');
    });
    volumeMode.addEventListener('change',()=>{
      const spawn=spawnOf(selected);if(running||!spawn)return;
      if(volumeMode.value==='total'&&volumes.mode(spawn)!=='percent'&&(spawn.routes??[]).reduce((sum,r)=>sum+(r.volume?volumes.perMinute(r.volume):0),0)>vehicles.MAX_RATE+1e-9){status.textContent='Destination volumes must total no more than 600 vehicles per minute.';updateButtons();return;}
      volumes.setMode(spawn,volumeMode.value);changed('Destination demand updated.');
    });
    for(const id of ['simulationTemperature','simulationTemperatureValue'])get(id).addEventListener('input',event=>{
      if(running||event.target.value==='')return;
      const value=Number(event.target.value);if(!Number.isInteger(value)||value<0||value>100)return;
      app.settings.set('simulationTemperature',value);
    });
    function updateTemperature(event){
      const value=app.settings.get('simulationTemperature');engine.temperature=value;
      get('simulationTemperature').value=value;
      if(document.activeElement!==get('simulationTemperatureValue'))get('simulationTemperatureValue').value=value;
      const model=drivers.temperatureModel(value);
      get('simulationTemperatureHint').textContent=(value===0?'Baseline acceleration and braking':'Acceleration and braking vary between drivers')+` for intersection starts, red-light approaches and turns. Other variation: ±${value*.5}%; quick drivers: ${(model.quickProbability*100).toFixed(1)}% (~${model.quickResponse.toFixed(1)}× acceleration/braking).`;
      // A new temperature describes a new population; paused edits reset the
      // transient cars/queued candidates instead of mixing old and new profiles.
      if(event?.detail?.key==='simulationTemperature'&&!running){engine.reset();carElements.forEach(image=>image.remove());carElements.clear();if(active()&&sheets.selected?.inchesPerPixel){refreshOverlay(false);syncPlayback(currentNetwork());}}
    }
    document.addEventListener('settingschange',updateTemperature);updateTemperature();
    get('simulationTemperatureValue').addEventListener('blur',()=>{get('simulationTemperatureValue').value=app.settings.get('simulationTemperature');});
    for(const id of ['simulationPlaybackRate','simulationPlaybackRateValue'])get(id).addEventListener('input',event=>{
      if(event.target.value===''||!event.target.checkValidity())return;
      app.settings.set('simulationPlaybackRate',event.target.valueAsNumber);
    });
    function updatePlaybackRate(){
      const rate=app.settings.get('simulationPlaybackRate');
      get('simulationPlaybackRate').value=rate;
      if(document.activeElement!==get('simulationPlaybackRateValue'))get('simulationPlaybackRateValue').value=rate.toFixed(1);
    }
    document.addEventListener('settingschange',updatePlaybackRate);updatePlaybackRate();
    get('simulationPlaybackRateValue').addEventListener('blur',()=>{get('simulationPlaybackRateValue').value=app.settings.get('simulationPlaybackRate').toFixed(1);});
    for(const [name,id] of [['density','simulationDensityOverlay'],['speed','simulationSpeedOverlay'],['stopped','simulationStoppedOverlay']])get(id).addEventListener('change',event=>{
      const enabled=new Set(app.settings.get('simulationOverlays'));
      if(event.target.checked)enabled.add(name);else enabled.delete(name);
      app.settings.set('simulationOverlays',[...enabled]);
    });
    function updateOverlaySetting(){
      const enabled=app.settings.get('simulationOverlays');get('simulationDensityOverlay').checked=enabled.includes('density');get('simulationSpeedOverlay').checked=enabled.includes('speed');get('simulationStoppedOverlay').checked=enabled.includes('stopped');
      get('simulationDensityLegend').hidden=!enabled.includes('density');get('simulationSpeedLegend').hidden=!enabled.includes('speed');renderDensity(true);renderCars();
    }
    document.addEventListener('settingschange',updateOverlaySetting);updateOverlaySetting();
    rateInput.addEventListener('blur', () => updateButtons());
    document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
    get('simulatorLanes').addEventListener('input', event => {
      const row = event.target.closest('[data-lane]'), spawn = spawnOf(selected), value = Number(event.target.value);
      if (running || !spawn || !row || event.target.value === '' || !Number.isFinite(value) || value < 0 || value > 100) return;
      const shares = laneShares(selected), index = shares.findIndex(lane => lane.lane === Number(row.dataset.lane));
      if (index < 0) return;
      spawn.laneShares = Object.fromEntries(vehicles.distribution(shares, index, value).map(lane => [lane.lane, lane.percent]));
      delete spawn.excludedLanes;
      changed('Lane distribution updated.');
    });
    get('simulatorLanes').addEventListener('focusout', updateButtons);
    get('simulatorRoutes').addEventListener('input', event => {
      const field = event.target.dataset.routeField, row = event.target.closest('.simulatorRouteRow'), spawn = spawnOf(selected);
      if (running || !field || !row || !spawn) return;
      const siblings = spawn.routes;
      const index = siblings.findIndex(route => sameRoute(route, row.exit));
      if (index < 0) return;
      if (field === 'name') {
        siblings[index].name = event.target.value.slice(0, 80); changed('Route renamed.'); return;
      }
      if(field==='volume'){
        if(volumes.mode(spawn)==='percent')return;
        const volume={amount:Number(event.target.value),unit:siblings[index].volume?.unit??'minutes'};
        if(event.target.value===''||!volumes.valid(volume))return;
        if(volumes.mode(spawn)==='total'&&siblings.reduce((sum,r,i)=>sum+volumes.perMinute(i===index?volume:r.volume),0)>vehicles.MAX_RATE+1e-9){status.textContent='Destination volumes must total no more than 600 vehicles per minute.';return;}
        siblings[index].volume=volume;volumes.sync(spawn);changed('Destination volume updated.');return;
      }
      if(field==='unit')return;
      if(volumes.mode(spawn)!=='percent')return;
      const value = Number(event.target.value);
      if (event.target.value === '' || !Number.isFinite(value) || value < 0 || value > 100) return;
      spawn.routes = vehicles.distribution(siblings, index, value);
      changed('Route distribution updated.');
    });
    get('simulatorRoutes').addEventListener('focusout', updateButtons);
    get('simulatorRoutes').addEventListener('change',event=>{
      if(event.target.dataset.routeField!=='unit'||running)return;
      const spawn=spawnOf(selected),row=event.target.closest('.simulatorRouteRow'),route=spawn?.routes?.find(r=>sameRoute(r,row?.exit));
      if(!route?.volume)return;
      const unit=volumes.unit(event.target.value);route.volume={amount:volumes.amount(volumes.perMinute(route.volume),unit),unit};volumes.sync(spawn);changed('Destination volume unit updated.');
    });
    button.addEventListener('click', () => {
      if (running) return;
      if (placing) { stop(); return; }
      if (!sheets.selected) { status.textContent = 'Upload or create a sheet first.'; return; }
      cancelDrag(); placing = true; placingSignal = false; placingControl = null; selectedControl = null; linking = false; selected = null; selectedRoute = null;
      status.textContent = 'Move to an unconnected road entrance and click to place one spawn point for the entrance. Escape cancels.';
      refreshOverlay();
    });
    function placeSignal(item){
      if(running||!placingSignal||!sheets.selected?.intersections?.includes(item))return;
      if(item.trafficSignal){status.textContent='This intersection already has a traffic signal. Choose another intersection.';return;}
      item.trafficSignal=app.simulatorSignals.normalize();placingSignal=false;
      changed('Traffic signal placed.');app.signalEditor?.select(item);signalButton.focus({preventScroll:true});
    }
    signalButton.addEventListener('click',()=>{
      if(running||!sheets.selected?.inchesPerPixel)return;
      if(placingSignal){stop();status.textContent='Traffic signal placement canceled.';return;}
      cancelDrag();placing=false;hover=null;placingSignal=true;placingControl=null;selectedControl=null;linking=false;selected=null;selectedRoute=null;
      status.textContent='Click an intersection to add a traffic signal. Escape cancels.';refreshOverlay(false);
    });
    for(const [kind,controlButton] of Object.entries(controlButtons))controlButton.addEventListener('click',()=>{
      if(running||!sheets.selected?.inchesPerPixel)return;
      if(placingControl===kind){stop();status.textContent='Traffic control placement canceled.';return;}
      cancelDrag();placing=false;placingSignal=false;placingControl=kind;selectedControl=null;selected=null;selectedRoute=null;hover=null;linking=false;
      status.textContent=`Click a ${kind==='stop'?'stop':'yield'} line marking to add ${kind.toUpperCase()} control. Escape cancels.`;refreshOverlay(false);
    });
    get('simulatorControlIntersection').addEventListener('change',event=>{
      const marking=currentControl(),value=event.target.value;if(running||!marking||value===(marking.trafficControl.unlinked===true?'none':String(marking.trafficControl.intersection??'')))return;
      const choice=value&&value!=='none'&&controlIntersections(marking).find(({item})=>String(item.id)===value);
      if(value&&value!=='none'&&!choice)return;
      delete marking.trafficControl.intersection;delete marking.trafficControl.unlinked;
      if(value==='none')marking.trafficControl.unlinked=true;
      else if(choice)marking.trafficControl.intersection=choice.item.id;
      changed(value==='none'?'Traffic control unlinked; automatic linking disabled.':choice?'Traffic control linked to intersection.':'Automatic traffic control linking enabled.');
    });
    get('removeSimulatorControl').addEventListener('click',()=>{
      const marking=currentControl();if(running||!marking)return;
      delete marking.trafficControl;selectedControl=null;changed('Traffic control removed.');
    });
    removeSpawn.addEventListener('click', () => {
      const spawn = spawnOf(selected);
      if (running || !spawn || !selected) return;
      sheets.selected.vehicleSpawns = sheets.selected.vehicleSpawns.filter(item => item !== spawn);
      selected = null; selectedRoute = null; linking = false; cancelDrag(); changed('Spawn point and its exit routes removed.');
    });
    removeRoute.addEventListener('click', () => {
      const spawn = spawnOf(selected);
      if (running || !spawn) return;
      const remaining = (spawn.routes ?? []).filter(route => !sameRoute(route, selectedRoute));
      spawn.routes = volumes.mode(spawn)==='percent'?vehicles.distribution(remaining):remaining;volumes.sync(spawn);
      selectedRoute = null; linking = false; cancelDrag(); changed('Exit route removed.');
    });
    workspace.addEventListener('pointerdown', event => {
      if (running || !active() || !sheets.selected || event.button !== 0) return;
      if(app.signalEditor?.pointerDown(event))return;
      if(event.target.closest('.simulatorSignal:not(.simulatorSignalTarget)')){event.stopImmediatePropagation();app.signalEditor?.select(sheets.selected.intersections.find(i=>String(i.id)===event.target.closest('.simulatorSignal').dataset.intersection));return;}
      const controlTarget=event.target.closest('.simulatorControl');
      if(controlTarget){
        const marking=sheets.selected.markings.find(m=>String(m.id)===controlTarget.dataset.marking);if(!marking)return;
        event.preventDefault();event.stopImmediatePropagation();
        if(placingControl)placeControl(marking);else chooseControl(marking);return;
      }
      if(placingControl){
        if(event.target.closest('.editor'))return;
        const id=app.markings.hitAt(sheets.toImage(event.clientX,event.clientY)),marking=sheets.selected.markings.find(m=>m.id===id);
        if(!marking)return;
        event.preventDefault();event.stopImmediatePropagation();
        if(controlKind(marking)!==placingControl){status.textContent=`Choose a ${placingControl==='stop'?'stop':'yield'} line marking.`;return;}
        placeControl(marking);return;
      }
      if(placingSignal){
        if(event.target.closest('.editor'))return;
        const target=event.target.closest('.simulatorSignalTarget');
        const item=target?sheets.selected.intersections.find(item=>String(item.id)===target.dataset.intersection):app.intersections.hitAt(sheets.toImage(event.clientX,event.clientY));
        if(!item)return;
        event.preventDefault();event.stopImmediatePropagation();placeSignal(item);return;
      }
      if (placing) {
        const ref = nearest(event, entranceGroups(currentNetwork()));
        if (!ref) return;
        event.preventDefault(); event.stopImmediatePropagation();
        const sheet = sheets.selected;
        sheet.vehicleSpawns ??= [];
        let spawn = spawnOf(ref);
        if (!spawn) { spawn = { road: ref.road, ...(ref.e ? { e: ref.e } : {}) }; sheet.vehicleSpawns.push(spawn); }
        delete spawn.excludedLanes;
        placing = false; hover = null; changed('Vehicle spawn point placed at the road entrance.');
        return;
      }
      const b = event.target.closest('.simulatorSpawn:not(.simulatorGhost)');
      if (!b) return;
      event.preventDefault(); event.stopImmediatePropagation();
      selectedControl=null;placingControl=null;placingSignal=false;
      selected = { road: Number(b.dataset.road), lane: Number(b.dataset.lane), e: Number(b.dataset.end) };
      selectedRoute = null; linking = true; preview = null;
      drag = { pointer: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
      workspace.setPointerCapture(event.pointerId);
      status.textContent = 'Drag to a shown exit, or click an exit. Only permitted lane routes are offered.';
      refreshOverlay(false);
    }, true);
    overlay.addEventListener('pointerdown', event => {
      if (event.target.closest('.simulatorExit, .simulatorRouteHit')) event.stopPropagation();
    });
    workspace.addEventListener('pointermove', event => {
      if (!active() || !sheets.selected) return;
      if (placing) {
        const next = nearest(event, entranceGroups(currentNetwork()))?.road ?? null;
        if (next !== hover) { hover = next; refreshOverlay(false); }
      } else if (drag && event.pointerId === drag.pointer) {
        if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 5) drag.moved = true;
        const exit = nearest(event, groups(currentNetwork().exits));
        const path = exit && routePaths(selected, { exit: { road: exit.road, e: exit.e } })[0];
        preview = path ?? null;
        status.textContent = path ? 'Release to set this exit route.' : 'Drag to a shown exit. Other exits have no permitted lane route.';
        refreshOverlay(false);
      }
    }, true);
    workspace.addEventListener('pointerup', event => {
      if (!drag || drag.pointer !== event.pointerId) return;
      event.preventDefault(); event.stopImmediatePropagation();
      const moved = drag.moved, exit = nearest(event, groups(currentNetwork().exits));
      cancelDrag();
      if (moved && exit) commit(exit);
      else { refreshOverlay(false); if (moved) status.textContent = 'Route not set. Drop on an exit with a permitted lane route.'; }
    }, true);
    workspace.addEventListener('pointercancel', () => { cancelDrag(); linking = false; refreshOverlay(false); });
    workspace.addEventListener('lostpointercapture', () => { if (drag) { drag = null; preview = null; linking = false; refreshOverlay(false); } });
    overlay.addEventListener('click', event => {
      const control=event.target.closest('.simulatorControl');
      if(control){
        event.stopPropagation();
        if(event.detail===0&&!running){const marking=sheets.selected.markings.find(m=>String(m.id)===control.dataset.marking);if(marking){if(placingControl)placeControl(marking);else chooseControl(marking);}}
        return;
      }
      if (!event.target.closest('.simulatorSpawn')) return;
      event.stopPropagation();
      // Keyboard and assistive technology activation has no pointerdown.
      if (event.detail === 0 && !running) {
        const b = event.target.closest('.simulatorSpawn');
        selectedControl=null;placingControl=null;placingSignal=false;
        selected = { road: Number(b.dataset.road), lane: Number(b.dataset.lane), e: Number(b.dataset.end) };
        selectedRoute = null; linking = true; refreshOverlay(false);
        overlay.querySelector('.simulatorExit')?.focus({ preventScroll: true });
      }
    });
    workspace.addEventListener('pointerleave', () => { if (placing) { hover = null; refreshOverlay(false); } });
    document.addEventListener('keydown', event => {
      if (running || !active() || event.target.closest('input,select,textarea,dialog,[role="combobox"]')) return;
      if (event.key === 'Escape' && (placing || placingSignal || placingControl || selectedControl || linking || selected)) {
        const focus=placingSignal?signalButton:placingControl?controlButtons[placingControl]:button;
        event.preventDefault(); event.stopImmediatePropagation(); selected = null; selectedRoute = null; selectedControl=null;stop(); focus.focus();
        status.textContent = 'Simulator selection canceled.';
      } else if ((event.key === 'Delete' || event.key === 'Backspace') && selectedControl) {
        event.preventDefault();event.stopImmediatePropagation();get('removeSimulatorControl').click();
      } else if ((event.key === 'Delete' || event.key === 'Backspace') && selected) {
        event.preventDefault(); event.stopImmediatePropagation();
        (selectedRoute ? removeRoute : removeSpawn).click(); button.focus();
      }
    }, true);
    new MutationObserver(() => { if (!active()) { pause(false); selected = null; selectedRoute = null;selectedControl=null; stop(); } else refreshOverlay(); })
      .observe(panel, { attributes: true, attributeFilter: ['hidden'] });
    document.addEventListener('sheetview', () => { refreshOverlay(false); renderCars(); });
    for (const event of ['sheetchange', 'sheethistory']) document.addEventListener(event, () => {
      pause(false);
      if (simulationSheet !== sheets.selected) { engine.reset(); simulationSheet = sheets.selected; carElements.forEach(image => image.remove()); carElements.clear(); }
      selected = null; selectedRoute = null;selectedControl=null; stop();
    });
    app.simulator = { refreshOverlay, signalEngine:()=>engine, editSignal:message=>changed(message), cancelPlacement:stop, entrances, network: makeNetwork,
      diagnostics: () => ({ running, time: engine.time, signals:engine.signals?.snapshot()??[], collisionInterventions:engine.collisionInterventions??0, temperature:engine.temperature, watchdogRemovals:engine.watchdogRemovals??0,watchdogEvents:(engine.watchdogEvents??[]).map(event=>({...event})), cars: engine.cars.map(({ id, source, route, distance, x, y, angle, hue, laneChange, driver, speed, desiredSpeed, situation, path, bornAt, road, lane, station, intersection, level, roundaboutPhase, reservation, entryCommitted, entryHold, entryConflictLine, stoppedSeconds }) => ({ id, source, route: route.key, distance, x, y, angle, hue, laneChange, driver, speed, desiredSpeed, situation, bornAt, road, lane, station, intersection, level, roundaboutPhase, reservation: Boolean(reservation),entryCommitted:Boolean(entryCommitted),entryHold,entryConflictLine,stoppedSeconds:stoppedSeconds??0,
        plan:path?{length:path.length,changes:path.maneuvers.map(({road,from,to,start,end,acrossBike})=>({road,from,to,start,end,acrossBike}))}:null })), queued:[...engine.sources.values()].reduce((sum,source)=>sum+(source.pending??0),0) }),
    };
  });
})();
