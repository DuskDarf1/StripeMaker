/* Simulator overlays follow SignalMaker's editor actions (GPL-3.0).
   Saved lane references are resolved again after edits; route geometry is never
   saved or exported as plan markings. Invalidated routes are not drawn. */
(() => {
  document.addEventListener('DOMContentLoaded', () => {
    const app = window.StripeMaker, sheets = app.sheets;
    const get = id => document.getElementById(id);
    const panel = get('simulatorEditor'), button = get('createVehicleSpawnPoint');
    const removeSpawn = get('removeVehicleSpawnPoint'), removeRoute = get('removeVehicleExitRoute');
    const status = get('simulatorStatus'), workspace = get('workspace');
    const overlay = document.createElement('div');
    overlay.className = 'markingOverlay simulatorOverlay'; sheets.addOverlay(overlay);
    const SVG = 'http://www.w3.org/2000/svg';
    let placing = false, hover = null, selected = null, selectedRoute = null;
    let linking = false, drag = null, preview = null, network = null;
    const active = () => !panel.hidden;
    const playButton = get('playSimulation'), pauseButton = get('pauseSimulation');
    const rateInput = get('vehicleSpawnRate'), spawnFields = get('simulatorSpawnFields');
    const vehicles = app.simulatorVehicles, drivers = app.simulatorDrivers, engine = new vehicles.Engine({behavior:drivers});
    let planningMph = app.settings.get('simulationSpeed') || 30;
    const carsOverlay = document.createElement('div');
    carsOverlay.className = 'markingOverlay simulatorCars'; sheets.addOverlay(carsOverlay);
    const carElements = new Map();
    let running = false, frame = null, previousTime = null, simulationSheet = null, updatingRouteList = false, updatingLaneList = false, preservePlaybackPaths = false;
    const same = (a, b) => a && b && a.road === b.road && a.lane === b.lane && (a.e ?? 0) === (b.e ?? 0);
    const spawnOf = ref => (sheets.selected?.vehicleSpawns ?? []).find(s => s.road === ref?.road && (s.e ?? 0) === (ref?.e ?? 0));
    const hasSpawn = ref => Boolean(spawnOf(ref));
    const spawnRate = spawn => spawn?.rate ?? (spawn?.outputs ? Math.min(vehicles.MAX_RATE, Object.values(spawn.outputs).reduce((sum, rate) => sum + rate, 0)) : vehicles.DEFAULT_RATE);
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
        // At zero speed preserve the last positive planning speed (initially
        // 30 mph), so stopping does not invalidate a lane-changing route.
        speed: planningMph * 5280 / 3600 * 12 / sheet.inchesPerPixel,
      });
    function currentNetwork() { return network ??= makeNetwork(sheets.selected); }
    function entrances(sheet) {
      return [...new Set(makeNetwork(sheet).entrances.map(ref => ref.road))].map(id => sheet.roads.find(r => r.id === id));
    }
    const sameExit = (a, b) => a && b && a.road === b.road && a.lane === b.lane && (a.e ?? 1) === (b.e ?? 1);
    function playbackPlan(graph,path) {
      const personalize=(record,{driver,random,cars,speed})=>graph.personalize(record,driver,random,
        context=>drivers.assess(context,cars,driver,speed||graph.speed,graph.pixelsPerFoot),speed||graph.speed);
      return {
        plan:options=>personalize(path,options),
        passing:car=>graph.pairs.filter(pair=>pair.road===car.road&&!pair.crossings?.length&&[pair.from,pair.to].includes(car.lane))
          .map(pair=>pair.from===car.lane?pair.to:pair.from),
        replan:options=>{
          const {car,target,driver,speed}=options;
          if(car.road==null||car.laneChange)return null;
          if(target==null){const rest=graph.continueFrom(car,path.exit);return rest?personalize(rest,options):null;}
          const C=app.simulatorLaneChanges,from=graph.laneRecords.get(`r:${car.road}:${car.lane}`),to=graph.laneRecords.get(`r:${car.road}:${target}`);
          const pair=graph.pairs.find(pair=>pair.road===car.road&&[pair.from,pair.to].includes(car.lane)&&[pair.from,pair.to].includes(target));
          if(!from||!to||!pair||pair.crossings?.length)return null;
          const total=C.stationsOf(from).at(-1),a=C.sample(from,car.station),b=C.sample(to,car.station);
          const span=(speed||graph.speed)*driver.duration*Math.max(1,Math.hypot(a.x-b.x,a.y-b.y)/(12*graph.pixelsPerFoot));
          const end=car.station+car.direction*span;
          if(end<0||end>total)return null;
          const crossing=C.transition(from,to,car.station,end,pair,total);
          if(!crossing)return null;
          const rest=graph.continueFrom({...car,lane:target,station:end},path.exit);
          const tail=rest&&personalize(rest,options);
          return tail?[...crossing,...tail]:null;
        },
      };
    }
    function sourcesFor(graph) {
      const sources = [];
      for (const ref of entranceGroups(graph)) if (hasSpawn(ref)) {
        const spawn = spawnOf(ref), routes = [];
        for (const lane of laneShares(ref, graph)) {
          if (!lane.percent) continue;
          const available = (spawn.routes ?? []).map(route => ({ route,
            paths: routePaths(ref, route, graph).filter(path => path.source.lane === lane.lane) })).filter(item => item.paths.length);
          const total = available.reduce((sum, item) => sum + (item.route.percent ?? 1), 0);
          if (!total) continue;
          for (const { route, paths } of available) for (const path of paths) routes.push({
            key: `lane:${lane.lane}:${path.exit.road}:${path.exit.lane}:${path.exit.e}`,
            points: path.points, ...playbackPlan(graph,path), weight: lane.percent * (route.percent ?? 1) / total / paths.length,
          });
        }
        if (routes.length) sources.push({ key: `${ref.road}:${ref.e}`, rate: spawnRate(spawn), routes });
      }
      return sources;
    }
    function renderCars() {
      const sheet = sheets.selected, seen = new Set();
      carsOverlay.hidden = !active() || simulationSheet !== sheet;
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
        // Leave one foot clear on each side of the current lane. Keep the
        // supplied sprite's visible 214:381 proportions instead of stretching the car.
        const width = Math.max(pixelsPerFoot, (car.laneWidth ?? 12 * 12 / sheet.inchesPerPixel) * sheet.view.scale - 2 * pixelsPerFoot);
        image.style.width = `${width}px`; image.style.height = `${width * 381 / 214}px`;
        // The supplied sprite's front (mirrors/windshield) faces down (+y).
        image.style.transform = `translate(${at.x}px,${at.y}px) translate(-50%,-50%) rotate(${car.angle - 90}deg)`;
      }
      for (const [id, image] of carElements) if (!seen.has(id)) { image.remove(); carElements.delete(id); }
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
      // Advance at most two fixed physics steps per animation frame. Long
      // frames slow simulation time instead of creating a catch-up spiral.
      engine.advance(previousTime === null ? 0 : Math.min(.1, (now - previousTime) / 1000));
      previousTime = now; renderCars();
      if (engine.cars.length || [...engine.sources.values()].some(source => source.rate > 0 && source.routes.some(route => route.weight > 0))) frame = requestAnimationFrame(tick);
      else pause();
    }
    function syncPlayback(graph) {
      const sheet = sheets.selected;
      if (simulationSheet !== sheet) { pause(false); engine.reset(); simulationSheet = sheet; }
      engine.pixelsPerFoot=12/sheet.inchesPerPixel;
      engine.speed = (app.settings.get('simulationSpeed') * 5280 / 3600) * 12 / sheet.inchesPerPixel;
      engine.configure(sourcesFor(graph), { preservePaths: preservePlaybackPaths }); preservePlaybackPaths = false; renderCars(); updateButtons();
    }
    function changed(message) {
      sheets.save(sheets.selected); app.history.record(); status.textContent = message;
      network = null; refreshOverlay();
    }
    function updateButtons() {
      removeSpawn.disabled = running || !selected || !hasSpawn(selected);
      removeRoute.disabled = running || !selected || !selectedRoute || !spawnOf(selected)?.routes?.some(r => sameRoute(r, selectedRoute));
      spawnFields.hidden = !selected || !hasSpawn(selected);
      if (!spawnFields.hidden && document.activeElement !== rateInput) rateInput.value = spawnRate(spawnOf(selected));
      playButton.disabled = running || !sheets.selected || (!engine.cars.length && ![...engine.sources.values()].some(source => source.rate > 0 && source.routes.some(route => route.weight > 0)));
      pauseButton.disabled = !running;
      button.disabled = running;
      for (const id of ['simulationSpeed', 'simulationSpeedValue', 'vehicleSpawnRate']) get(id).disabled = running;
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
          const actions = document.createElement('div'); actions.className = 'headActions';
          const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Remove Route';
          remove.addEventListener('click', () => { if (!running) { selectedRoute = row.exit; updateButtons(); removeRoute.click(); } });
          actions.append(remove); row.append(actions); list.append(row);
        });
      }
      const shares = vehicles.distribution(routes);
      [...list.children].forEach((row, index) => {
        const route = routes[index], name = routeName(route);
        row.querySelectorAll('input,button').forEach(input => { input.disabled = running; });
        const nameInput = row.querySelector('[data-route-field="name"]');
        if (document.activeElement !== nameInput) nameInput.value = name;
        nameInput.setAttribute('aria-label', `Route ${index + 1} name`);
        for (const field of ['share', 'shareValue']) {
          const input = row.querySelector(`[data-route-field="${field}"]`);
          if (document.activeElement !== input) input.value = shares[index].percent;
          input.disabled = running || routes.length === 1;
          input.setAttribute('aria-label', `${name} ${field === 'share' ? 'share' : 'percentage'}`);
        }
        row.querySelector('button').setAttribute('aria-label', `Remove route ${name}`);
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
      const choose = event => { event.stopPropagation(); selected = ref; selectedRoute = { ...ref.exit, fromLane: ref.fromLane }; linking = false; preview = null; updateButtons(); status.textContent = 'Exit route selected. Press Delete or Remove Exit Route to remove it.'; };
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
      workspace.classList.toggle('simulatorActive', active());
      if (invalidate) network = null;
      overlay.replaceChildren(); updateButtons();
      const sheet = sheets.selected;
      if (!active() || !sheet?.inchesPerPixel) { renderCars(); return; }
      const graph = currentNetwork(), root = svg('svg', { 'aria-label': 'Vehicle exit routes' }, overlay);
      if (invalidate || simulationSheet !== sheet) syncPlayback(graph);
      if (!running) for (const ref of entranceGroups(graph)) if (hasSpawn(ref)) {
        const exits = groups(graph.exits), saved = vehicles.distribution(spawnOf(ref)?.routes ?? []);
        for (const route of saved) {
          const exit = exits.find(exit => exit.road === route.exit.road && exit.e === (route.exit.e ?? 1));
          // One road-following diagram per destination, without lane weaving.
          const path = routePaths(ref, route, graph)[0];
          if (exit && path) arrow(root, graph.displayPath(path),
            { ...ref, exit: route.exit, fromLane: route.lane, percent: route.percent });
        }
      }
      if (preview && selected && !running) {
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
      if (selected && hasSpawn(selected) && linking) {
        const reachable = new Set(lanesFor(selected, graph).flatMap(lane => [...graph.search(lane).values()].map(path => path.exit.road)));
        for (const exit of groups(graph.exits).filter(exit => reachable.has(exit.road))) pointButton(exit, 'exit', `Exit road ${exit.road}`);
      }
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
      cancelDrag(); placing = false; hover = null; linking = false;
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
        spawn.routes = vehicles.distribution([...spawn.routes, added], spawn.routes.length, 100 / (spawn.routes.length + 1));
      }
      linking = false; preview = null; selectedRoute = target;
      changed('Exit route added. Drag this spawn point again to add another exit.');
    }
    playButton.addEventListener('click', () => {
      if (!sheets.selected?.inchesPerPixel) return;
      network = null; syncPlayback(currentNetwork());
      if (playButton.disabled) return;
      cancelDrag(); placing = false; linking = false; running = true; previousTime = null;
      engine.advance(0); refreshOverlay(false); renderCars(); updateButtons();
      frame = requestAnimationFrame(tick); status.textContent = 'Simulation playing.';
    });
    pauseButton.addEventListener('click', () => { pause(); status.textContent = 'Simulation paused.'; });
    rateInput.addEventListener('input', () => {
      const value = rateInput.valueAsNumber, spawn = spawnOf(selected);
      if (running || !spawn || !Number.isInteger(value) || value < 0 || value > vehicles.MAX_RATE) return;
      spawn.rate = value;
      changed('Spawn output updated.');
    });
    for (const id of ['simulationSpeed', 'simulationSpeedValue']) get(id).addEventListener('input', event => {
      if (running || event.target.value === '') return;
      const value = Number(event.target.value);
      if (!Number.isFinite(value) || value < 0 || value > 999) return;
      app.settings.set('simulationSpeed', value);
    });
    function updateSpeed(event) {
      const speed = app.settings.get('simulationSpeed');
      if (speed > 0) planningMph = speed;
      get('simulationSpeed').value = speed;
      if (document.activeElement !== get('simulationSpeedValue')) get('simulationSpeedValue').value = speed.toFixed(1);
      if (sheets.selected?.inchesPerPixel) engine.speed = speed * 5280 / 3600 * 12 / sheets.selected.inchesPerPixel;
      if (event?.detail?.key === 'simulationSpeed' && active() && sheets.selected?.inchesPerPixel) {
        preservePlaybackPaths = true; refreshOverlay();
      }
    }
    get('simulationSpeedValue').addEventListener('blur', () => { get('simulationSpeedValue').value = app.settings.get('simulationSpeed').toFixed(1); });
    rateInput.addEventListener('blur', () => updateButtons());
    document.addEventListener('settingschange', updateSpeed);
    document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
    updateSpeed();
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
      const value = Number(event.target.value);
      if (event.target.value === '' || !Number.isFinite(value) || value < 0 || value > 100) return;
      spawn.routes = vehicles.distribution(siblings, index, value);
      changed('Route distribution updated.');
    });
    get('simulatorRoutes').addEventListener('focusout', updateButtons);
    button.addEventListener('click', () => {
      if (running) return;
      if (placing) { stop(); return; }
      if (!sheets.selected) { status.textContent = 'Upload or create a sheet first.'; return; }
      cancelDrag(); placing = true; linking = false; selected = null; selectedRoute = null;
      status.textContent = 'Move to an unconnected road entrance and click to place one spawn point for the entrance. Escape cancels.';
      refreshOverlay();
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
      spawn.routes = vehicles.distribution(remaining);
      selectedRoute = null; linking = false; cancelDrag(); changed('Exit route removed.');
    });
    workspace.addEventListener('pointerdown', event => {
      if (running || !active() || !sheets.selected || event.button !== 0) return;
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
      if (!event.target.closest('.simulatorSpawn')) return;
      event.stopPropagation();
      // Keyboard and assistive technology activation has no pointerdown.
      if (event.detail === 0 && !running) {
        const b = event.target.closest('.simulatorSpawn');
        selected = { road: Number(b.dataset.road), lane: Number(b.dataset.lane), e: Number(b.dataset.end) };
        selectedRoute = null; linking = true; refreshOverlay(false);
        overlay.querySelector('.simulatorExit')?.focus({ preventScroll: true });
      }
    });
    workspace.addEventListener('pointerleave', () => { if (placing) { hover = null; refreshOverlay(false); } });
    document.addEventListener('keydown', event => {
      if (running || !active() || event.target.closest('input,select,textarea,dialog')) return;
      if (event.key === 'Escape' && (placing || linking || selected)) {
        event.preventDefault(); event.stopImmediatePropagation(); selected = null; selectedRoute = null; stop(); button.focus();
        status.textContent = 'Simulator selection canceled.';
      } else if ((event.key === 'Delete' || event.key === 'Backspace') && selected) {
        event.preventDefault(); event.stopImmediatePropagation();
        (selectedRoute ? removeRoute : removeSpawn).click(); button.focus();
      }
    }, true);
    new MutationObserver(() => { if (!active()) { pause(false); selected = null; selectedRoute = null; stop(); } else refreshOverlay(); })
      .observe(panel, { attributes: true, attributeFilter: ['hidden'] });
    document.addEventListener('sheetview', () => { refreshOverlay(false); renderCars(); });
    for (const event of ['sheetchange', 'sheethistory']) document.addEventListener(event, () => {
      pause(false);
      if (simulationSheet !== sheets.selected) { engine.reset(); simulationSheet = sheets.selected; carElements.forEach(image => image.remove()); carElements.clear(); }
      selected = null; selectedRoute = null; stop();
    });
    app.simulator = { refreshOverlay, entrances, network: makeNetwork,
      diagnostics: () => ({ running, time: engine.time, cars: engine.cars.map(({ id, source, route, distance, x, y, angle, hue, laneChange, driver, speed, situation, path, bornAt }) => ({ id, source, route: route.key, distance, x, y, angle, hue, laneChange, driver, speed, situation, bornAt,
        plan:path?{length:path.length,changes:path.maneuvers.map(({road,from,to,start,end,acrossBike})=>({road,from,to,start,end,acrossBike}))}:null })), queued:[...engine.sources.values()].reduce((sum,source)=>sum+(source.pending??0),0) }),
    };
  });
})();
