/* Intersection editor. UI conventions are reused from SignalMaker (GPL-3.0).
   Intersections are created and edited on the sheet with a side panel.
   Pavement is exportable SVG; movement guides and controls are screen overlays. */
(() => {
  const SVG = "http://www.w3.org/2000/svg";
  document.addEventListener("DOMContentLoaded", () => {
    const app = window.StripeMaker,
      G = app.intersectionGeometry,
      RB = app.roundaboutGeometry,
      sheets = app.sheets,
      roads = app.roadEditor;
    const get = (id) => document.getElementById(id);
    const menu = get("intersectionsEditor"),
      status = get("intersectionStatus");
    const panel = get("intersectionEditor"),
      fields = get("intersectionSheetFields"),
      panelMessage = get("intersectionSheetMessage"),
      nameInput = get("intersectionSheetName"),
      title = get("intersectionEditorTitle");
    const overlay = document.createElement("div");
    overlay.className = "intersectionOverlay";
    const guides = document.createElementNS(SVG, "svg");
    overlay.append(guides);
    sheets.addOverlay(overlay);
    let selected = null,
      selectedSheet = null,
      chosen = null,
      inputLane = null,
      chosenMovement = null;
    let dragging = null,
      snap = null;
    let bezierApproach = null;
    let bezierSide = "whole";
    let bendTap = null;
    let approachCurveTap = null;
    const margin = roads.pavementMarginFeet;
    // New medians start at this width (ft); it is editable starting geometry.
    const NEW_MEDIAN_FEET = 6;
    const scale = (sheet) => 12 / sheet.inchesPerPixel;
    const svg = (tag, attrs, parent) => {
      const e = document.createElementNS(SVG, tag);
      for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
      parent.append(e);
      return e;
    };
    const path = (points) =>
      points.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(4)} ${p.y.toFixed(4)}`).join(" ") + "Z";
    const line = (points) => points.map((p, i) => `${i ? "L" : "M"}${p.x} ${p.y}`).join(" ");
    const world = (sheet, item, p) => G.add(item, G.mul(p, scale(sheet)));
    const local = (sheet, item, p) => G.mul(G.sub(p, item), 1 / scale(sheet));
    const screen = (sheet, item, p) => sheets.toScreen(world(sheet, item, p));
    const current = () => sheets.selected?.intersections?.find((x) => x.id === selected);
    // Roundabouts are intersections with `kind: "roundabout"`, laid out by
    // js/roundabout-geometry.js; everything else is the general junction.
    const round = (item) => item?.kind === "roundabout";
    const notchPair=(a,b)=>((a.incoming&&!a.outgoing&&b.incoming&&!b.outgoing)||(!a.incoming&&a.outgoing&&!b.incoming&&b.outgoing))&&G.dot(G.axes(a).u,G.axes(b).u)>.25;
    const outline = (item, m = 0) => (round(item) ? RB.outline(item, m) : G.outline(item, m));
    const normalize = (item) => (round(item) ? RB.normalize(item) : G.normalize(item));
    const validate = (item) => (round(item) ? RB.validate(item) : G.validate(item));
    const active = () => !menu.hidden || !panel.hidden;
    const arrowKeys = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    function tell(text) {
      status.textContent = text;
      panelMessage.textContent = text;
    }
    function button(label, action, parent, disabled = false) {
      const e = document.createElement("button");
      e.type = "button";
      e.textContent = label;
      e.disabled = disabled;
      e.onclick = action;
      parent.append(e);
      return e;
    }
    function heading(text) {
      const e = document.createElement("h3");
      e.textContent = text;
      fields.append(e);
    }
    function hint(text) {
      const p = document.createElement("p");
      p.className = "headPopoverHint";
      p.textContent = text;
      fields.append(p);
    }
    function field(label, value, change, options = {}) {
      const row = document.createElement("div");
      row.className = "fieldRow";
      const name = document.createElement("label");
      const input = document.createElement(options.choices ? "select" : "input");
      input.id = `intersection-${options.key ?? label.replace(/[^a-z]/gi, "")}`;
      name.htmlFor = input.id;
      name.textContent = label;
      if (options.choices)
        for (const [v, t] of options.choices) {
          const o = document.createElement("option");
          o.value = v;
          o.textContent = t;
          input.append(o);
        }
      else {
        input.type = "number";
        input.min = options.min ?? 0;
        input.max = options.max ?? 500;
        input.step = options.step ?? 1;
      }
      input.value = value;
      input.disabled = Boolean(options.disabled);
      input.onchange = () => {
        if (!options.choices && !input.checkValidity()) {
          input.reportValidity();
          return;
        }
        change(options.choices ? input.value : Number(input.value));
      };
      row.append(name, input);
      fields.append(row);
      return input;
    }
    // Each accepted change is one undo step and moves attached road ends.
    function change(action, rebuild = true) {
      const item = current();
      if (!item) return;
      const before = structuredClone(item);
      action(item);
      normalize(item);
      const error = validate(item);
      if (error) {
        for (const key of Object.keys(item)) delete item[key];
        Object.assign(item, before);
        tell(error);
      } else {
        tell("");
        moveBindings(sheets.selected, item);
        separateMedianRoads(sheets.selected,item);
        moveBindings(sheets.selected,item);
        roads.tidyGores(sheets.selected);
        sheets.save(sheets.selected);
        app.history.record();
        refreshList();
      }
      roads.render();
      if (rebuild || error) renderFields();
    }
    function chooseApproach(id) {
      chosen = id;
      inputLane = null;
      chosenMovement = null;
      renderFields();
      refreshOverlay();
    }
    function chooseInput(a, id) {
      chosen = a.id;
      inputLane = id;
      chosenMovement = null;
      renderFields();
      refreshOverlay();
    }
    function toggleMovement(b, output) {
      change((item) => {
        const a = item.approaches.find((a) => a.id === chosen);
        if (!a || !inputLane) return;
        const reversed=app.traffic.reversed,input=reversed?output:inputLane,out=reversed?inputLane:output;
        const from=reversed?b:a,to=reversed?a:b;
        const m = item.movements.find(m=>m.input===input&&m.output===out);
        if (m) {
          item.movements = item.movements.filter((x) => x !== m);
          chosenMovement = null;
        } else {
          const made = G.movement(from,from.inLanes.indexOf(input),to,to.outLanes.indexOf(out));
          item.movements.push(made);
          chosenMovement = made.id;
        }
      });
    }
    function addApproach() {
      change((item) => {
        const sorted = [...item.approaches].sort((a, b) => G.degrees(a.angle) - G.degrees(b.angle));
        let best = 0,
          angle = 0;
        for (let i = 0; i < sorted.length; i++) {
          const a = G.degrees(sorted[i].angle),
            b = G.degrees(sorted[(i + 1) % sorted.length].angle) + (i === sorted.length - 1 ? 360 : 0);
          if (b - a > best) {
            best = b - a;
            angle = (a + b) / 2;
          }
        }
        const a = round(item) ? RB.approach(G.degrees(angle)) : G.approach(G.degrees(angle));
        const reach = Math.max(G.REACH, ...item.approaches.map(G.length), round(item) ? RB.requiredReach(item, a) : 0);
        Object.assign(a, G.mul(G.axes(a).u, reach));
        item.approaches.push(a);
        chosen = a.id;
        inputLane = null;
        chosenMovement = null;
      });
    }
    // Medians: the center one between the two directions, and splits between
    // lanes going the same way. `where` is "center" or { incoming, after }.
    const freeBoundaries = (a) => {
      const list = [];
      if (a.incoming && a.outgoing && !(a.median > 0)) list.push("center");
      for (const incoming of [true, false])
        for (let after = 1; after < (incoming ? a.incoming : a.outgoing); after++)
          if (!(a.splits ?? []).some((s) => s.incoming === incoming && s.after === after))
            list.push({ incoming, after });
      return list;
    };
    const boundaryName = (where) =>
      where === "center"
        ? "the two directions"
        : `${where.incoming ? "incoming" : "outgoing"} lanes ${where.after} and ${where.after + 1}`;
    const boundaryKey = (where) =>
      where === "center" ? "center" : `${where.incoming ? "in" : "out"}-${where.after}`;
    // Start new islands at the approach throat, outside the crossing lanes.
    // This is an editable geometric default, not a prescribed design length.
    const initialMedianNose=(item,a,width)=>Math.max(width/2,Math.min(G.length(a)-5,G.dot(a,G.axes(a).u)-G.throat(item,a)));
    const connectedApproach = a => Boolean(a.binding || a.links?.length);
    function setMedianWidth(a,width) {
      delete a.gap;delete a.medianInset;delete a.medianMouth;
      if(a.binding)a.medianOverride=true;
      a.median=width;
    }
    function syncBoundMedian(sheet,a){
      if(!a.binding||!a.medianOverride)return;
      const road=sheet.roads.find(r=>r.id===a.binding.road);if(!road)return;
      for(const joint of sheet.joints)for(const link of joint.links)if(link.pair&&(link.a===road.id||link.b===road.id))link.median=a.median;
    }
    function addMedian(approachId, where) {
      change((item) => {
        const a = item.approaches.find((a) => a.id === approachId);
        if (!a || !where) return;
        if (where === "center") {
          setMedianWidth(a, NEW_MEDIAN_FEET);
          if(connectedApproach(a))a.nose=initialMedianNose(item,a,NEW_MEDIAN_FEET);
        } else
          (a.splits ??= []).push({
            id: G.id(),
            incoming: where.incoming,
            after: where.after,
            width: NEW_MEDIAN_FEET,
            nose: connectedApproach(a)?initialMedianNose(item,a,NEW_MEDIAN_FEET):50,
            surface: "concrete",
          });
        chosen = a.id;
      });
    }
    function removeSplit(approachId, splitId) {
      change((item) => {
        const a = item.approaches.find((a) => a.id === approachId);
        if (a?.splits) a.splits = a.splits.filter((s) => s.id !== splitId);
      });
    }
    document.addEventListener('settingschange',event=>{
      if(event.detail?.key==='leftHandTraffic'){inputLane=null;chosenMovement=null;if(!panel.hidden)renderFields();refreshOverlay();}
    });
    function renderFields() {
      const item = current();
      fields.replaceChildren();
      nameInput.value = item?.name ?? "";
      nameInput.disabled = !item;
      get("intersectionSheetAdd").disabled = !item;
      get("intersectionSheetDelete").disabled = !item;
      if (!item) {
        const p = document.createElement("p");
        p.textContent = "Select an intersection on the sheet.";
        fields.append(p);
        return;
      }
      if (!item.approaches.some((a) => a.id === chosen)) {
        chosen = item.approaches[0].id;
        inputLane = null;
      }
      title.lastChild.textContent = round(item) ? " Roundabout " : " Intersection ";
      if (round(item)) return renderRoundabout(item);
      field("Approach", chosen, chooseApproach, {
        key: "approach",
        choices: item.approaches.map((a, i) => [a.id, `Approach ${i + 1}`]),
      });
      const a = item.approaches.find((a) => a.id === chosen);
      const bound = Boolean(a.binding);
      heading(bound ? "Connected approach" : "Approach settings");
      if (bound) {
        hint("Lane dimensions follow the connected road. Detach to change them here.");
        button(
          "Detach Approach",
          () =>
            change(() => {
              delete a.binding;
              delete a.gap;
            }),
          fields,
        );
      }
      if(connectedApproach(a))hint("Adding a median splits the connected road into separate, independently editable roads. Lane widths stay unchanged.");
      field(
        "Angle (°)",
        G.degrees(a.angle),
        (v) =>
          change(() => {
            const delta = ((v - a.angle) * Math.PI) / 180,
              c = Math.cos(delta),
              s = Math.sin(delta);
            if(a.approachCurve)a.approachCurve.axis=G.degrees(a.approachCurve.axis+v-a.angle);
            Object.assign(a, { x: a.x * c - a.y * s, y: a.x * s + a.y * c, angle: v });
          }),
        { max: 359, step: 0.5 },
      );
      field(
        "Length (ft)",
        +G.length(a).toFixed(1),
        (v) => change(() => Object.assign(a, G.mul(G.unit(a), v))),
        { min: 20, max: 2000, step: 0.5 },
      );
      for (const [key, label] of [
        ["incoming", app.traffic.reversed ? "Outgoing lanes" : "Incoming lanes"],
        ["outgoing", app.traffic.reversed ? "Incoming lanes" : "Outgoing lanes"],
      ])
        field(
          label,
          a[key],
          (v) =>
            change(() => {
              a[key] = v;
              if (!a.incoming || !a.outgoing) {
                a.median = 0;
                delete a.gap;
              }
            }),
          { max: 999, disabled: bound },
        );
      field(
        app.traffic.reversed?"Outgoing width (ft)":"Incoming width (ft)",
        a.width,
        (v) =>
          change(() => {
            a.width = v;
            for(const id of a.inLanes)if(a.laneDetails?.[id])a.laneDetails[id].width=v;
          }),
        { min: 8, max: 20, step: 0.5, disabled: bound },
      );
      field(app.traffic.reversed?"Incoming width (ft)":"Outgoing width (ft)", a.outWidth, v => change(() => { a.outWidth = v; for(const id of a.outLanes)if(a.laneDetails?.[id])a.laneDetails[id].width=v; }), { min: 8, max: 20, step: 0.5, disabled: bound });
      hint('Drag the square Bézier handle to curve this whole approach. Double-click it to straighten.');
      if(a.approachCurve)button('Straighten Whole Approach',()=>change(()=>G.straightenApproach(a)),fields);
      field("Corner radius (ft)", a.radius, (v) => change(() => (a.radius = v)), { max: 200, step: 0.5 });
      hint(
        "Radius rounds the corner clockwise from this approach; it is limited by the available space. Zero is square.",
      );
      button(
        "Delete Approach",
        () =>
          change(() => {
            item.approaches = item.approaches.filter((x) => x !== a);
            chosen = item.approaches[0].id;
            inputLane = null;
            chosenMovement = null;
          }),
        fields,
        item.approaches.length <= 2,
      );
      field(
        "Rotate intersection (°)",
        +G.degrees(item.rotation).toFixed(1),
        (v) => change(() => rotate(item, v - item.rotation)),
        { max: 359, step: 0.5 },
      );
      renderMedians(a, bound);
      renderMovements(item, a);
    }
    // ---- Roundabouts -------------------------------------------------------
    // Every opening keeps its distance outside the circle when the circle's size
    // or shape changes, so splitter islands keep their lengths.
    function keepReach(before, item) {
      const old = RB.layout(before).outer, now = RB.layout(item).outer;
      for (const a of item.approaches) {
        const b = before.approaches.find((x) => x.id === a.id);
        if (!b) continue;
        const oldAngle = Math.atan2(b.y, b.x), newAngle = Math.atan2(a.y, a.x);
        const shift = now.radius(newAngle) - old.radius(oldAngle);
        // Apply only the circle's size change to the edited opening. A bend
        // or rotation may already have moved it and its connected road end.
        Object.assign(a, G.add({ x: a.x, y: a.y }, G.mul(RB.approachAxes(a).u, shift)));
      }
    }
    function changeRound(edit, rebuild = true) {
      change((item) => {
        const before = structuredClone(item);
        edit(item);
        RB.normalize(item);
        const old = RB.settings(before), now = RB.settings(item);
        // Resize the legs only when the circle itself is resized/reshaped.
        // Editing an angle or curve must not push a traced road connection
        // away from its location to satisfy a recommended approach length.
        if (RB.diameter(before) !== RB.diameter(item) || old.shape !== now.shape || old.ratio !== now.ratio || old.turn !== now.turn)
          keepReach(before, item);
      }, rebuild);
    }
    function toggleDestination(item, a, laneId, exitId) {
      const list = new Set(RB.destinations(item, a, laneId));
      if (list.has(exitId)) list.delete(exitId);
      else list.add(exitId);
      const before = structuredClone(item);
      (a.dest ??= {})[laneId] = [...list];
      RB.normalize(item);
      keepReach(before, item);
    }
    const turnName = { right: "right turn", through: "through", left: "left turn", u: "U-turn" };
    function checkbox(label, checked, onchange, parent = fields, disabled = false) {
      const row = document.createElement("label");
      row.className = "intersectionDestination";
      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = checked;
      box.disabled = disabled;
      box.onchange = () => onchange(box.checked);
      row.append(box, label);
      parent.append(row);
      return box;
    }
    function renderRoundabout(item) {
      const s = RB.settings(item), Lt = RB.layout(item), C = Lt.C, sh = RB.shape(item);
      heading("Roundabout");
      field("Roundabout type", s.mini ? "mini" : "regular", (v) => changeRound(() => { s.mini = v === "mini"; }), {
        key: "rb-type", choices: [["regular", "Raised central island"], ["mini", "Mini-roundabout"]],
      });
      field("Shape", sh.kind, (v) => changeRound(() => {
        s.shape = v;
        const [lo, hi] = RB.RATIO_RANGE[v];
        s.ratio = v === "circle" ? 1 : G.clamp(s.ratio > 1 ? s.ratio : v === "peanut" ? 1.6 : 1.3, lo, hi);
      }), { key: "rb-shape", choices: [["circle", "Circle"], ["oval", "Oval"], ["peanut", "Peanut"]] });
      if (sh.kind !== "circle") {
        const [lo, hi] = RB.RATIO_RANGE[sh.kind];
        field(sh.kind === "peanut" ? "Length (× lobe diameter)" : "Length (× diameter)", +sh.ratio.toFixed(2),
          (v) => changeRound(() => (s.ratio = v)), { key: "rb-ratio", min: lo, max: hi, step: 0.05 });
        field("Long axis angle (°)", +G.degrees(s.turn).toFixed(1), (v) => changeRound(() => (s.turn = v)), { key: "rb-turn", max: 359, step: 0.5 });
      }
      const auto = RB.laneCount({ ...structuredClone(item), roundabout: { ...s, lanes: "auto" } });
      field("Circulating lanes", String(s.lanes), (v) => changeRound(() => { s.lanes = v === "auto" ? "auto" : Number(v); }), {
        key: "rb-lanes",
        choices: [["auto", `Automatic (${auto})`], ...Array.from({ length: s.mini ? 1 : RB.MAX_LANES }, (_, i) => [String(i + 1), String(i + 1)])],
      });
      hint(s.lanes === "auto"
        ? "Edit lane destinations to change the automatic circulating lanes."
        : "Choose Automatic to size circulating lanes from lane destinations.");
      field(sh.kind === "peanut" ? "Lobe diameter (ft)" : "Inscribed diameter (ft)", RB.diameter(item), (v) => changeRound(() => (s.icd = v)), { key: "rb-icd", min: RB.MINI_DIAMETER[0], max: 1200, step: 1 });
      hint("Drag the circle's square handle to resize it.");
      if (s.icd != null) button("Use Automatic Diameter", () => changeRound(() => (s.icd = null)), fields);
      if (item.approaches.some(a => a.inLanes.slice(1).some((_, j) => RB.entryGoreWidth(a, j + 1) > 0)))
        hint("Automatic diameter includes extra room for the entry gores.");
      field("Circulating lane width (ft)", Lt.widths[0],
        (v) => changeRound(() => { s.laneWidth = v; s.widths = null; }),
        { key: "rb-width", min: s.mini ? 8 : C === 1 ? RB.SINGLE_WIDTH_RANGE[0] : RB.CIRC_LANE_RANGE[0], max: C === 1 ? RB.SINGLE_WIDTH_RANGE[1] : RB.CIRC_LANE_RANGE[1], step: 0.5 });
      if (!s.mini) {
        field("Truck apron (ft)", s.apron, (v) => changeRound(() => (s.apron = v)), { key: "rb-apron", min: 0, max: 40, step: 0.5 });
      }
      field(app.traffic.reversed?"Exit curb radius (ft)":"Entry curb radius (ft)", s.entryRadius, (v) => changeRound(() => (s.entryRadius = v)), { key: "rb-entry", min: 5, max: 400, step: 1 });
      field(app.traffic.reversed?"Entry curb radius (ft)":"Exit curb radius (ft)", s.exitRadius, (v) => changeRound(() => (s.exitRadius = v)), { key: "rb-exit", min: 5, max: 600, step: 1 });
      hint("Select an approach to edit its whole curve or its entry and exit curves separately.");
      if (!s.mini) {
        field("Spiral island", s.spiral, (v) => changeRound(() => (s.spiral = v)), {
          key: "rb-spiral", choices: [["auto", `Automatic (${RB.spiralWanted({ ...structuredClone(item), roundabout: { ...s, spiral: "auto" } }) ? "on" : "off"})`], ["on", "On"], ["off", "Off"]],
        });
        hint("Edit lane destinations to change the automatic spiral and its markings.");
      }
      field("Rotate roundabout (°)", +G.degrees(item.rotation).toFixed(1), (v) => changeRound(() => { const by = v - item.rotation; rotate(item, by); s.turn = G.degrees(s.turn + by); }), { key: "rb-rotate", max: 359, step: 0.5 });

      field("Approach", chosen, chooseApproach, { key: "approach", choices: item.approaches.map((a, i) => [a.id, `Approach ${i + 1}`]) });
      const a = item.approaches.find((x) => x.id === chosen), bound = Boolean(a.binding);
      heading(bound ? "Connected approach" : "Approach settings");
      hint("Moving or curving this approach keeps its through, left, and right destinations.");
      if (bound) {
        hint("Lane dimensions follow the connected road. Detach to change them here.");
        button("Detach Approach", () => change(() => { delete a.binding; delete a.gap; }), fields);
      }
      field("Angle (°)", +G.degrees(a.angle).toFixed(1), (v) => changeRound(() => {
        const t = ((v - a.angle) * Math.PI) / 180, c = Math.cos(t), sn = Math.sin(t);
        if (a.bezier) a.bezier.axis = G.degrees(a.bezier.axis + v - a.angle);
        Object.assign(a, { x: a.x * c - a.y * sn, y: a.x * sn + a.y * c, angle: v });
      }), { max: 359, step: 0.5 });
      field("Distance from center (ft)", +G.length(a).toFixed(1), (v) => change(() => Object.assign(a, G.mul(G.unit(a), v))), { min: 20, max: 3000, step: 0.5 });
      for (const [key, label] of [["incoming", app.traffic.reversed?"Exit lanes":"Entry lanes"], ["outgoing", app.traffic.reversed?"Entry lanes":"Exit lanes"]])
        field(label, a[key], (v) => changeRound(() => { a[key] = v; }), { max: s.mini ? 1 : 999, disabled: bound });
      field(app.traffic.reversed?"Exit lane width (ft)":"Entry lane width (ft)", a.width, (v) => changeRound(() => { a.width = v; for (const id of a.inLanes) if (a.laneDetails?.[id]) a.laneDetails[id].width = v; }), { min: 8, max: 20, step: 0.5, disabled: bound });
      field(app.traffic.reversed?"Entry lane width (ft)":"Exit lane width (ft)", a.outWidth, (v) => changeRound(() => { a.outWidth = v; for (const id of a.outLanes) if (a.laneDetails?.[id]) a.laneDetails[id].width = v; }), { min: 8, max: 20, step: 0.5, disabled: bound });
      if (a.incoming) {
        field("Yield line setback (ft)", a.yieldSetback, v => change(() => { a.yieldSetback = v; }), { key: "rb-yield", min: 0, max: 3000, step: 0.5 });
        hint("Drag the square on the yield line toward the road to move it outside the circle. Set setback to 0 to return it to the circle.");
      }
      field("Design speed (mph)", a.speed, (v) => changeRound(() => { a.speed = v; a.splitter = null; }), {
        key: "rb-speed", choices: [25, 30, 35, 40, 45, 50, 55, 60, 65].map((x) => [x, `${x} mph`]),
      });
      const length = a.splitter ?? RB.splitterLength(a.speed);
      field("Splitter island length (ft)", length, (v) => changeRound(() => (a.splitter = v)), { key: "rb-splitter", min: 0, max: 1000, step: 1 });
      field("Splitter island edge", a.curb, (v) => changeRound(() => (a.curb = v)), { key: "rb-curb", choices: [["E", "Curb"], ["separator", "Traffic separator"]] });
      field("Entry curve AR3 (ft)", a.ar3, (v) => changeRound(() => (a.ar3 = v)), { key: "rb-ar3", min: 20, max: 1200, step: 1 });
      field(app.traffic.reversed?"Entry lane curve (ft)":"Exit lane curve (ft)", a.exitCurve, (v) => changeRound(() => (a.exitCurve = v)), { key: "rb-exit-curve", min: 20, max: 1200, step: 1 });
      hint("A larger radius makes a flatter entrance or exit curve.");
      field("Whole approach bend (ft)", a.bend, (v) => changeRound(() => RB.setApproachBend(a, v)), { key: "rb-bend", min: -500, max: 500, step: 0.5 });
      hint("Drag the handle at the median's outer end to move the connection. Double-click it to show Bézier handles for both ends of the whole approach. Connected roads follow the connection and its direction. Lengthen the approach for a stronger bend.");
      if (a.incoming && a.outgoing) hint("Drag a median corner to move that entry or exit with its lanes. Circle corners follow the circle. Bézier handles shape the curves between them.");
      button(bezierApproach === a.id && bezierSide === "whole" ? "Hide Bézier Handles" : "Edit Whole Approach Curve", () => toggleBezier(item, a), fields);
      for (const [side, count, label] of [["entry", a.incoming, "Entry"], ["exit", a.outgoing, "Exit"]]) if (count) {
        if (a.bezierSides?.[side]) button(`Reset ${label} Curve`, () => changeRound(() => {
          delete a.bezierSides[side];
          if (!Object.keys(a.bezierSides).length) delete a.bezierSides;
        }), fields);
      }
      hint("Select an approach to show its four square Bézier handles: entry and exit, at the road connection and at the circle. Drag a handle to curve that side. Connected roads follow its angle.");
      if (a.bend || a.bezier || a.bezierSides) button("Straighten Whole Approach", () => changeRound(() => RB.straightenApproach(a)), fields);
      if (a.incoming && a.outgoing) {
        const custom = Object.values(a.bezierSides ?? {}).some(edit => edit.connection || edit.corner != null);
        field(custom ? "Median starting width (ft)" : "Median at mouth (ft)", +(a.median ?? 0).toFixed(1), (v) => changeRound(() => { setMedianWidth(a, v); }), { key: "rb-median", min: 0, max: 200, step: 0.5 });
        hint("A divided approach: its median becomes the splitter island, starting at the mouth and widening toward the circle.");
        if (custom) button("Reset Median Corners", () => changeRound(() => {
          for (const edit of Object.values(a.bezierSides)) { delete edit.connection; delete edit.corner; delete edit.cornerAt; }
        }), fields);
      }
      hint("For a right-turn bypass lane, draw it as a road in Elements: branch it off this approach's road and end it on the next exit's road.");
      if (RB.circulatingIn(item, a) > 1) {
        hint("Click a + near YIELD to add a gore. Drag its square to adjust width or its tip to adjust length. Set its width to 0 to remove it.");
        for (let k = 1; k < a.incoming; k++) {
          field(`Gore between entry lanes ${k} and ${k + 1} (ft)`, +RB.entryGoreWidth(a, k).toFixed(1),
            (v) => changeRound(() => ((a.entryGores ??= {})[a.inLanes[k]] = v)),
            { key: `rb-gore-${a.inLanes[k]}`, min: 0, max: 20, step: 0.5 });
          if (RB.entryGoreWidth(a, k) > 0)
            field(`Gore type, entry lanes ${k} and ${k + 1}`, RB.entryGoreType(a, k),
              v => changeRound(() => ((a.entryGoreTypes ??= {})[a.inLanes[k]] = v)),
              { key: `rb-gore-type-${a.inLanes[k]}`, choices: [["painted", "Painted"], ["curbed", "Curbed island"]] });
        }
      }
      button("Delete Approach", () => change(() => {
        item.approaches = item.approaches.filter((x) => x !== a);
        chosen = item.approaches[0].id;
        inputLane = null;
      }), fields, item.approaches.length <= 2);

      heading("Lane destinations");
      if(app.traffic.reversed) {
        if(!a.outgoing){hint('This approach has exit lanes only.');return;}
        hint('Choose the exits served by this entry. The existing lane paths run in the opposite direction.');
        for(const b of item.approaches)for(const [j,input] of b.inLanes.entries()) {
          const now=RB.destinations(item,b,input);
          checkbox(`Approach ${item.approaches.indexOf(b)+1} · Lane ${j+1}`,now.includes(a.id),
            ()=>change(x=>toggleDestination(x,x.approaches.find(y=>y.id===b.id),input,a.id)),fields);
        }
        return;
      }
      if (!a.incoming) {
        hint("This approach has exit lanes only.");
        return;
      }
      hint("Check the exits each entry lane serves. Arrows, circulating lanes and lane lines follow. On the sheet, drag from an entry lane's arrow to an exit to add or remove it.");
      const exits = item.approaches.filter((b) => b.outgoing);
      for (const [j, id] of a.inLanes.entries()) {
        const group = document.createElement("fieldset"), legend = document.createElement("legend");
        legend.textContent = `Lane ${j + 1}${a.incoming > 1 ? (j === 0 ? " (inside)" : j === a.incoming - 1 ? " (outside)" : "") : ""}`;
        group.append(legend);
        fields.append(group);
        const now = RB.destinations(item, a, id);
        for (const b of exits)
          checkbox(`Approach ${item.approaches.indexOf(b) + 1} · ${turnName[RB.turnOf(item, a, b)]}`, now.includes(b.id),
            () => change((x) => toggleDestination(x, x.approaches.find((y) => y.id === a.id), id, b.id)), group);
      }
      if (Object.keys(a.dest ?? {}).length) button("Reset Lane Destinations", () => changeRound(() => (a.dest = {})), fields);
    }
    // Asphalt, then the truck apron, central island and splitter islands with
    // their curbs (the median renderer's inside-clipped curb stroke).
    let clipCount = 0;
    function drawRoundaboutPavement(item, parent, convert, concrete) {
      svg("path", concrete ? { d: path(outline(item, margin).map(convert)), fill: concrete, stroke: concrete, "stroke-width": 1.5 }
        : { d: path(outline(item, margin).map(convert)), class: "roadBand" }, parent);
      const curbWidth = G.length(G.sub(convert({ x: roads.medianStyle.curbFeet * 2, y: 0 }), convert({ x: 0, y: 0 })));
      for (const surface of RB.surfaces(item, margin)) {
        const d = path(surface.points.map(convert));
        const fill = surface.fill === "grass" ? roads.medianStyle.grass : surface.fill === "concrete" ? roads.medianStyle.concrete : surface.fill;
        svg("path", { d, fill }, parent);
        if (!surface.curb) continue;
        const id = `roundabout-curb-${item.id}-${clipCount++}`;
        const clip = svg("clipPath", { id }, parent);
        svg("path", { d }, clip);
        const group = svg("g", { "clip-path": `url(#${id})` }, parent);
        svg("path", { d: surface.open ? d.slice(0, -1) : d, fill: "none", stroke: roads.medianStyle.curb, "stroke-width": curbWidth }, group);
      }
    }
    // Geometry arrays are immutable for a solved roundabout. Keep their SVG
    // coordinates while its transform stays the same (including export scale).
    const roundaboutPaths = new WeakMap();
    function drawRoundaboutMarkings(item, parent, convert, cuts = []) {
      const k = G.length(G.sub(convert({ x: 1, y: 0 }), convert({ x: 0, y: 0 })));
      const m = RB.markings(item, app.markingCatalog);
      const origin = convert({ x: 0, y: 0 }), x = convert({ x: 1, y: 0 }), y = convert({ x: 0, y: 1 });
      const transform = [origin.x, origin.y, x.x, x.y, y.x, y.y].join(":");
      const coordinates = (points, closed = false) => {
        const key = transform + ":" + closed, hit = roundaboutPaths.get(points);
        if (hit?.key === key) return hit.d;
        const d = (closed ? path : line)(points.map(convert));
        roundaboutPaths.set(points, { key, d });
        return d;
      };
      const stroke = (l, into) => {
        const parts = cuts.length ? app.markingTrim.trim(l.points.map(convert), cuts) : [{ distance: 0 }];
        for (const part of parts) {
          const attrs = { d: part.points ? line(part.points) : coordinates(l.points), class: "roadMarking", fill: "none", stroke: l.color, "stroke-width": l.width * k };
          if (l.dash) {
            attrs["stroke-dasharray"] = l.dash.map((x) => (x * k).toFixed(3)).join(" ");
            attrs["stroke-dashoffset"] = ((l.phase ?? 0) * k - part.distance).toFixed(3);
          }
          svg("path", attrs, into);
        }
      };
      for (const l of m.lines) stroke(l, parent);
      for (const c of m.clips) {
        const id = `roundabout-clip-${item.id}-${clipCount++}`;
        const clip = svg("clipPath", { id }, parent);
        svg("path", { d: coordinates(c.clip, true) }, clip);
        const group = svg("g", { "clip-path": `url(#${id})` }, parent);
        for (const l of c.lines) stroke(l, group);
      }
      for (const part of m.symbols)
        svg("path", { d: part.rings.map(r => coordinates(r, true)).join(""), fill: part.fill, "fill-rule": part.rule }, parent);
    }
    // Only the chosen approach's destinations: showing every roundabout
    // entry at once obscures both the lane assignments and pavement markings.
    function drawRoundaboutGuides(item, convert) {
      if(app.traffic.reversed) {
        const destination=item.approaches.find(a=>a.id===chosen);
        if(!destination)return;
        for(const source of item.approaches)for(const [j,input] of source.inLanes.entries())if(RB.destinations(item,source,input).includes(destination.id)) {
          const points=RB.path(item,source,j,destination,0,{from:RB.handle(item,source,true,j).sp+ARROW_FEET,to:RB.handle(item,destination,false,0).sp+ARROW_FEET}).slice().reverse().map(convert);
          svg('path',{d:line(points),class:'intersectionMovement',stroke:approachColor(item,destination.id),'stroke-width':1.4},guides);
        }
        return;
      }
      for (const a of item.approaches.filter(a => a.id === chosen))
        for (const [j, id] of a.inLanes.entries())
          for (const exit of RB.destinations(item, a, id)) {
            const b = item.approaches.find((x) => x.id === exit);
            if (!b) continue;
            // From the entry lane's handle round to just outside the exit.
            const points = RB.path(item, a, j, b, 0, { from: RB.handle(item, a, true, j).sp + ARROW_FEET, to: RB.handle(item, b, false, 0).sp + ARROW_FEET }).map(convert);
            const picked = id === inputLane;
            svg("path", { d: line(points), class: "intersectionMovement", "data-approach": a.id, stroke: approachColor(item, a.id), "stroke-width": picked ? 2.2 : 1.2, opacity: inputLane && !picked ? 0.35 : 1 }, guides);
          }
    }
    // A screen point 18 px out past an edge handle and 14 px beyond the mouth,
    // clear of the handle itself.
    function beside(p, outward, beyond, mouth) {
      const o = G.unit(G.sub(outward, p)), b = G.unit(G.sub(beyond, mouth));
      return G.add(p, G.add(G.mul(o, 6), G.mul(b, 16)));
    }
    function toggleBezier(item, a, side = "whole") {
      bezierApproach = bezierApproach === a.id && bezierSide === side ? null : a.id;
      bezierSide = side;
      select(item.id, a.id);
      showPanel();
      refresh();
    }
    function drawApproachCurveControl(item,a,i,convert) {
      let h=round(item)?RB.approachBezierHandles(item,a).mouth:G.approachBezierHandle(item,a);
      if(round(item)) {
        const center=G.mul(G.add(RB.approachEdge(item,a,true),RB.approachEdge(item,a,false)),.5),shift=G.sub(center,h.from);
        h={from:center,p:G.add(h.p,shift)};
      }
      const from=convert(h.from),p=convert(h.p);
      svg('path',{d:`M${from.x} ${from.y}L${p.x} ${p.y}`,class:'intersectionControlLine'},guides);
      const handle=control(p,`Approach ${i+1} Bézier curve`,`approach-curve-${a.id}`,
        ()=>{select(item.id,a.id);showPanel();},{type:'approachCurve',approach:a.id},'rect');
      const tip='Drag to curve the whole approach. Both directions stay together. Arrow keys adjust the curve; double-click to straighten.';
      handle.setAttribute('aria-description',tip);svg('title',{},handle).textContent=tip;
    }
    function drawRoundaboutControls(item, convert) {
      for (const [i, a] of item.approaches.entries()) {
        drawApproachCurveControl(item,a,i,convert);
        const pick = () => (select(item.id, a.id), showPanel());
        if (chosen === a.id && (app.traffic.reversed?a.outgoing:a.incoming)) {
          const h = RB.yieldLineHandle(item, a);
          const handle = control(convert(h.p), `Approach ${i + 1} yield line position`, `yield-line-${a.id}`, pick,
            { type: "yieldLine", approach: a.id }, "rect");
          const hint = "Drag toward the road to move the yield line outside the circle. Arrow keys adjust its position.";
          handle.setAttribute("aria-description", hint);
          svg("title", {}, handle).textContent = hint;
        }
        const mouth = RB.approachBendHandle(item, a);
        const whole = control(convert(mouth.p), `Approach ${i + 1} whole approach curve`, `approach-bend-${a.id}`, pick, { type: "approachBend", approach: a.id });
        const wholeHint = "Drag to move this connection and curve the whole approach. Double-click to show Bézier handles. Connected roads follow it. Arrow keys move the connection.";
        whole.setAttribute("aria-description", wholeHint);
        svg("title", {}, whole).textContent = wholeHint;
        const sides = bezierApproach === a.id && bezierSide === "whole" ? ["whole"]
          : [a.incoming && "entry", a.outgoing && "exit"].filter(Boolean);
        if (chosen === a.id) for (const side of sides) {
          const controls = side === "whole" ? RB.approachBezierHandles(item, a) : RB.approachSideBezierHandles(item, a, side);
          for (const [end, h] of Object.entries(controls)) {
            const from = convert(h.from), p = convert(h.p);
            svg("path", { d: `M${from.x} ${from.y}L${p.x} ${p.y}`, class: "intersectionControlLine" }, guides);
            const location = end === "mouth" ? "connection" : "circle";
            const handle = control(p, `Approach ${i + 1} ${side === "whole" ? "" : `${side} `}${location} Bézier handle`,
              `approach-bezier-${a.id}-${side}-${end}`, pick, { type: "approachBezier", approach: a.id, end, side }, "rect");
            const hint = side === "whole" ? "Drag to change the whole approach curve's direction and pull. Arrow keys adjust the curve."
              : `Drag to change this ${side}'s angle and pull at the ${location}. The other side stays in place. Arrow keys adjust the curve.`;
            handle.setAttribute("aria-description", hint);
            svg("title", {}, handle).textContent = hint;
          }
        }
        for (const incoming of [true, false]) {
          const handle = control(convert(RB.approachEdge(item, a, incoming, margin)), `Approach ${i + 1} ${incoming ? "entry" : "exit"} outer edge`, `edge-${a.id}-${incoming}`, pick, { type: "mouth", approach: a.id, incoming });
          const tip = "Drag to turn the opening around the circle; Shift-drag to slide it without turning.";
          handle.setAttribute("aria-description", tip);
          svg("title", {}, handle).textContent = tip;
        }
      }
      // A + just outside each mouth edge adds an entry or exit lane there.
      for (const [i, a] of item.approaches.entries())
        for (const incoming of [true, false])
          if (!a.binding && !RB.settings(item).mini) addControl(beside(convert(RB.approachEdge(item, a, incoming, margin)), convert(RB.approachEdge(item, a, incoming, margin + 1)), convert(G.local(a, 0, 1)), convert(G.local(a, 0, 0))), `Add ${incoming ? "an entry" : "an exit"} lane to approach ${i + 1}`,
            `add-lane-${a.id}-${incoming}`, () => changeRound(() => { if (incoming) a.incoming += 1; else a.outgoing += 1; }));
      // Direct corner handles use the same square controls as the existing
      // median/Bézier editors. Each side carries its adjacent lanes with it.
      for (const [i, a] of item.approaches.entries()) {
        if (!a.incoming || !a.outgoing) continue;
        if (!(a.median > 0) && !a.binding)
          addControl(beside(convert(G.local(a, 0, 0)), convert(G.local(a, 0, 0)), convert(G.local(a, 0, 1)), convert(G.local(a, 0, 0))),
            `Add a median to approach ${i + 1}`, `add-median-${a.id}`, () => changeRound(() => setMedianWidth(a, NEW_MEDIAN_FEET)));
        if (chosen !== a.id) continue;
        const corners = RB.splitterCorners(item, a);
        if (!corners) continue;
        for (const side of ["entry", "exit"]) for (const end of ["mouth", "circle"]) {
          if (end === "mouth" && !(a.median > 0)) continue;
          const location = end === "mouth" ? "connection" : "circle";
          const handle = control(convert(corners[side][end]), `Approach ${i + 1} median ${side} ${location} corner`,
            `median-corner-${a.id}-${side}-${end}`, () => (select(item.id, a.id), showPanel()),
            { type: "splitterCorner", approach: a.id, side, end }, "rect");
          const hint = end === "mouth" ? "Drag to move this median corner and its connected entry or exit lanes. Arrow keys move the corner."
            : "Drag along the circle to position this median corner and its adjacent lanes. Arrow keys move the corner.";
          handle.setAttribute("aria-description", hint);
          svg("title", {}, handle).textContent = hint;
        }
      }
      // Add a gore at an existing entry-lane boundary just upstream of YIELD.
      // Reuse the accessible + control used for intersection medians/lanes.
      const Lt = RB.layout(item);
      for (const [i, a] of item.approaches.entries()) {
        const L = Lt.legs.get(a.id);
        for (let k = 1; k < a.incoming; k++) {
          if (RB.entryGoreWidth(a, k) > 0) {
            if (chosen === a.id) {
              const handles = RB.entryGoreHandles(item, a, k);
              for (const end of ["width", "tip"]) {
                const label = end === "tip" ? "length" : "width";
                const handle = control(convert(handles[end]), `Approach ${i + 1} gore between entry lanes ${k} and ${k + 1} ${label}`,
                  `gore-size-${a.id}-${a.inLanes[k]}-${end}`, () => (select(item.id, a.id), showPanel()),
                  { type: "goreSize", approach: a.id, lane: k, end }, end === "tip" ? "circle" : "rect");
                const hint = end === "tip" ? "Drag the tip along the approach to lengthen or shorten this gore. Arrow keys adjust it."
                  : "Drag across the gore to change its width. Arrow keys adjust it.";
                handle.setAttribute("aria-description", hint);
                svg("title", {}, handle).textContent = hint;
              }
            }
            continue;
          }
          const sp = Math.max(0, L.entryMeet(s => L.entryOff(k, s)) - 4);
          addControl(convert(L.P(L.entryOff(k, sp), sp)),
            `Add a gore between entry lanes ${k} and ${k + 1} of approach ${i + 1}`,
            `add-gore-${a.id}-${a.inLanes[k]}`, () => {
              select(item.id, a.id);
              changeRound(() => ((a.entryGores ??= {})[a.inLanes[k]] = RB.STAY_IN_LANE_GORE[0]));
              showPanel();
            });
        }
      }
      // The circle's size handle sits on its edge in the widest gap between legs.
      const angles = Lt.flow.map((a) => Lt.legs.get(a.id).phi).sort((x, y) => x - y);
      let best = 0, at = 0;
      angles.forEach((t, i) => {
        const next = i === angles.length - 1 ? angles[0] + 2 * Math.PI : angles[i + 1];
        if (next - t > best) { best = next - t; at = t + (next - t) / 2; }
      });
      const p = Lt.outer.at(at);
      const handle = control(convert(p), "Roundabout diameter", `diameter-${item.id}`, () => showPanel(), { type: "diameter", origin: p }, "rect");
      svg("title", {}, handle).textContent = "Drag to resize the circle.";
    }
    function paintedMedianFields(model, key, defaultColor, parent = fields) {
      const chevrons=(model.color??defaultColor)==='white';
      const choices = [
        field("Color", model.color ?? defaultColor, (v) => change(() => (model.color = v)), {
          key: `${key}-color`, choices: [["yellow", "Yellow (opposing traffic)"], ["white", "White (same direction)"]],
        }),
        field(chevrons?'Chevron direction':"Stripe direction", model.lean ?? "right", (v) => change(() => (model.lean = v)), {
          key: `${key}-lean`, choices: chevrons?[["right","Point right"],["left","Point left"]]:[["right", "╱ Lean right"], ["left", "╲ Lean left"]],
        }),
      ];
      for (const input of choices) parent.append(input.parentElement);
      // SignalMaker's dimensionInputs slider/number pair, also used by
      // Elements' painted medians. History coalesces continuous input events.
      const number = field("Stripe spacing (ft)", model.spacing ?? 20, () => {}, {
        key: `${key}-spacing`, min: 10, max: 40, step: 5,
      });
      const row = number.parentElement, inputs = document.createElement("div"), slider = document.createElement("input");
      inputs.className = "dimensionInputs";
      slider.type = "range";
      slider.id = `${number.id}-range`;
      for (const prop of ["min", "max", "step", "value"]) slider[prop] = number[prop];
      row.querySelector("label").htmlFor = slider.id;
      number.setAttribute("aria-label", "Stripe spacing in feet");
      row.append(inputs);
      inputs.append(slider, number);
      parent.append(row);
      for (const input of [number, slider]) {
        input.oninput = () => {
          if (!input.checkValidity() || input.value === "") return;
          number.value = slider.value = input.value;
          change(() => (model.spacing = Number(input.value)), false);
        };
        input.onchange = input.oninput;
      }
    }
    function renderMedians(a, bound) {
      heading("Medians");
      hint(
        bound
          ? "Medians split the connected road into separate roads. Width and nose settings remain editable."
          : "Click a + at the approach opening to add a median between those lanes. Drag a median's edge to widen it, or to zero to remove it; drag its nose to lengthen it.",
      );
      const surface = (value, set, key) =>
        field("Surface", value, set, {
          key,
          choices: [
            ["grass", "Grass"],
            ["concrete", "Concrete"],
            ["painted", "Painted"],
          ],
        });
      if (a.incoming && a.outgoing) {
        field(
          "Center median (ft)",
          a.median,
          (v) =>
            change(() => {
              setMedianWidth(a,v);
            }),
          { key: "median", max: 200, step: 0.5 },
        );
        if (a.median > 0) {
          surface(a.surface, (v) => change(() => (a.surface = v)), "median-surface");
          if (a.surface === "painted") paintedMedianFields(a, "median", "yellow");
          field("Nose setback (ft)", +a.nose.toFixed(1), (v) => change(() => (a.nose = v)), {
            key: "median-nose",
            min: 1,
            max: Math.max(1, Math.floor(G.length(a) - 5)),
            step: 0.5,
          });
        }
      }
      for (const incoming of [true, false])
        for (const s of G.splits(a, incoming)) {
          const group = document.createElement("fieldset"),
            legend = document.createElement("legend");
          legend.textContent = `Median between ${boundaryName(s)}`;
          group.append(legend);
          fields.append(group);
          const rows = [
            field("Width (ft)", s.width, (v) => change(() => (s.width = v)), {
              key: `split-width-${s.id}`,
              min: 0.5,
              max: 100,
              step: 0.5,
            }),
            field("Nose setback (ft)", s.nose, (v) => change(() => (s.nose = v)), {
              key: `split-nose-${s.id}`,
              min: 1,
              max: Math.max(1, Math.floor(G.length(a) - 5)),
              step: 0.5,
            }),
            surface(s.surface, (v) => change(() => (s.surface = v)), `split-surface-${s.id}`),
          ];
          for (const input of rows) group.append(input.parentElement);
          if (s.surface === "painted") paintedMedianFields(s, `split-${s.id}`, "white", group);
          button("Remove Median", () => removeSplit(a.id, s.id), group);
        }
      const free = freeBoundaries(a);
      if (free.length) {
        const where = field("Add median between", boundaryKey(free[0]), () => {}, {
          key: "median-add",
          choices: free.map((w) => [boundaryKey(w), boundaryName(w)]),
        });
        button(
          "Add Median",
          () =>
            addMedian(
              a.id,
              free.find((w) => boundaryKey(w) === where.value),
            ),
          fields,
        );
      }
    }
    function renderMovements(item, a) {
      heading("Lane movements");
      const reversed=app.traffic.reversed,inputs=reversed?a.outLanes:a.inLanes;
      if (!inputs.length) {
        const p = document.createElement("p");
        p.textContent = "This approach has outgoing lanes only.";
        fields.append(p);
        return;
      }
      if (!inputs.includes(inputLane)) inputLane = inputs[0];
      field("Incoming lane", inputLane, (v) => chooseInput(a, v), {
        key: "input-lane",
        choices: inputs.map((id, i) => [id, `Lane ${i + 1} (from median outward)`]),
      });
      const destinations = document.createElement("fieldset"),
        legend = document.createElement("legend");
      legend.textContent = "Outgoing lanes";
      destinations.append(legend);
      fields.append(destinations);
      for (const b of item.approaches)
        for (const [j, id] of (reversed?b.inLanes:b.outLanes).entries()) {
          const row = document.createElement("label");
          row.className = "intersectionDestination";
          const box = document.createElement("input");
          box.type = "checkbox";
          box.checked = item.movements.some((m) => (reversed?m.output:m.input) === inputLane && (reversed?m.input:m.output) === id);
          box.onchange = () => toggleMovement(b, id);
          row.append(
            box,
            `Approach ${item.approaches.indexOf(b) + 1} · Lane ${j + 1}${a === b ? " (U-turn)" : ""}`,
          );
          destinations.append(row);
        }
      const movements = item.movements.filter((m) => (reversed?m.output:m.input) === inputLane);
      if (!movements.length) return;
      // A curve is edited only once its connection is picked, so the approach
      // handles stay visible otherwise.
      if (!movements.some((m) => m.id === chosenMovement)) chosenMovement = null;
      field(
        "Edit curve",
        chosenMovement ?? "",
        (v) => {
          chosenMovement = v || null;
          renderFields();
          refreshOverlay();
          refreshList();
        },
        {
          key: "movement",
          choices: [
            ["", "None"],
            ...movements.map((m) => {
              const b = item.approaches.find((a) => a.id === (reversed?m.from:m.to));
              return [
                m.id,
                `To approach ${item.approaches.indexOf(b) + 1}, lane ${(reversed?b.inLanes:b.outLanes).indexOf(reversed?m.input:m.output) + 1}`,
              ];
            }),
          ],
        },
      );
      const m = movements.find((m) => m.id === chosenMovement);
      if (!m) return;
      for (const [key, label] of [
        ["pullIn", reversed?"Exit pull (ft)":"Entry pull (ft)"],
        ["pullOut", reversed?"Entry pull (ft)":"Exit pull (ft)"],
      ])
        field(
          label,
          +G.pulls(item, m)[key === "pullIn" ? 0 : 1].toFixed(1),
          (v) =>
            change(() => {
              [m.pullIn, m.pullOut] = G.pulls(item, m);
              m.autoCurve = false;
              m[key] = v;
            }, false),
          { min: 1, max: 1000, step: 0.5 },
        );
      button("Reset Curve", () => change(() => (m.autoCurve = true)), fields);
      button(
        "Delete Movement",
        () =>
          change(() => {
            item.movements = item.movements.filter((x) => x !== m);
            chosenMovement = null;
          }),
        fields,
      );
    }
    // An intersection on an elevated level (Levels) has a concrete deck.
    function drawPavement(item, parent, convert, concrete = null) {
      if (round(item)) return drawRoundaboutPavement(item, parent, convert, concrete);
      svg("path", concrete ? { d: path(outline(item, margin).map(convert)), fill: concrete, stroke: concrete, "stroke-width": 1.5 }
        : { d: path(outline(item, margin).map(convert)), class: "roadBand" }, parent);
      for (const a of item.approaches)
        for (const median of G.medians(a)) {
          if (median.surface === "painted") continue; // flush pavement, no turf or raised curb
          const d = path(G.medianSurface(a, median, margin).map(convert));
          svg("path", { d, fill: roads.medianStyle[median.surface] ?? roads.medianStyle.grass }, parent);
          if (median.surface !== "concrete") continue;
          // Reuse the existing median renderer's cited curb dimension and its
          // inside-clipped stroke, including in vector PDF output.
          const id = `intersection-curb-${a.id}-${median.key}`;
          const clip = svg("clipPath", { id }, parent);
          svg("path", { d }, clip);
          const group = svg("g", { "clip-path": `url(#${id})` }, parent);
          const curbWidth = G.length(
            G.sub(convert({ x: roads.medianStyle.curbFeet * 2, y: 0 }), convert({ x: 0, y: 0 })),
          );
          svg(
            "path",
            { d: d.slice(0, -1), fill: "none", stroke: roads.medianStyle.curb, "stroke-width": curbWidth },
            group,
          );
        }
    }
    // Intersection lines use the road's 6" solid line (FDOT 711-001) and colors.
    // White rides the right side of traffic: each curb from one approach's
    // outgoing edge around the corner to the next approach's incoming edge, and
    // both sides of medians splitting lanes going the same way. Yellow marks the
    // opposite-direction side: the double yellow up to where the curbs start
    // curving, or both sides of a center median out to its nose. Lines are open
    // M/L stroked paths, so they export to PDF as vectors.
    function drawMarkings(item, parent, convert, cuts = []) {
      if (round(item)) return drawRoundaboutMarkings(item, parent, convert, cuts);
      const style = roads.markingStyle;
      const width = G.length(G.sub(convert({ x: style.lineFeet, y: 0 }), convert({ x: 0, y: 0 })));
      const stroke = (points, color, lineWidth = width) =>
        svg(
          "path",
          {
            d: line(points.map(convert)),
            class: "roadMarking",
            fill: "none",
            stroke: color,
            "stroke-width": lineWidth,
          },
          parent,
        );
      // Each corner joins one approach's outgoing-side edge to the next one's
      // incoming-side edge. An edge with lanes beside it is white (right of
      // traffic); a one-way approach's other edge is its traffic's left edge,
      // yellow. Edge lines always run on round the corner: where the two colors
      // differ, each runs until it meets the other halfway.
      const halves = (points) => {
        const along = [0];
        for (let i = 1; i < points.length; i++) along.push(along[i - 1] + G.length(G.sub(points[i], points[i - 1])));
        const half = along.at(-1) / 2;
        let i = 1;
        while (i < points.length - 1 && along[i] < half) i++;
        const f = (half - along[i - 1]) / (along[i] - along[i - 1] || 1);
        const mid = G.add(points[i - 1], G.mul(G.sub(points[i], points[i - 1]), f));
        return [[...points.slice(0, i), mid], [mid, ...points.slice(i)]];
      };
      const ordered = G.ordered(item);
      for (const [i, a] of ordered.entries()) {
        const b = ordered[(i + 1) % ordered.length];
        const from = a.outgoing ? style.white : style.yellow,
          to = b.incoming ? style.white : style.yellow,
          points = G.corner(a, b).points;
        if (from === to) stroke(points, from);
        else {
          const [first, second] = halves(points);
          stroke(first, from);
          stroke(second, to);
        }
      }
      // A median's line wraps its rounded nose: up one side from the mouth, around
      // the nose on the island's own center, and back down the other side.
      // `center` is the island's center offset, `half` its half width, `ring` the
      // line's distance from that center.
      const around = (a, center, half, nose, ring, mouthRing=ring) => {
        const tip = G.reach(a, half, nose) - half,bend=Math.min(tip/2,Math.max(half,6)),
          coordinates = [[center-mouthRing,0]];
        if(mouthRing!==ring)coordinates.push([center-ring,-bend]);
        coordinates.push([center-ring,-tip]);
        for(let i=0;i<=24;i++){const t=Math.PI*i/24;coordinates.push([center-Math.cos(t)*ring,-tip-Math.sin(t)*ring]);}
        if(mouthRing!==ring)coordinates.push([center+ring,-bend]);
        coordinates.push([center+mouthRing,0]);
        const points=G.localLine(a,coordinates);
        return points;
      };
      const painted = (a, model, center, half, nose, ring, mouthRing, key, defaultColor) => {
        const paint = { ...model, color: model.color ?? defaultColor };
        const color = paint.color === "white" ? style.white : style.yellow;
        const ppf = width / style.lineFeet, paintStyle = roads.paintedMedianStyle;
        const outer = around(a, center, half, nose, ring, mouthRing);
        const inset = paint.color === "white" ? 0 : paintStyle.doubleOffsetFeet;
        stroke(outer, color, paint.color === "white" ? ppf * paintStyle.whiteLineFeet : width);
        // Both boundaries stay open at the approach mouth. Clip hatching to
        // the inner marking centerline, following the same rounded nose.
        if (ring <= inset) return;
        const inner = around(a, center, half, nose, ring - inset, Math.max(0, mouthRing - inset));
        if (inset) stroke(inner, color);
        roads.drawMedianHatching(outer.map(convert), outer.map(convert), inner.map(convert), paint, parent, ppf,
          `intersection-painted-${item.id}-${a.id}-${key}`);
      };
      for (const a of item.approaches) {
        if (a.incoming && a.outgoing) {
          if (a.median > 0) {
            const ring = a.medianInset ? a.median / 2 + 5 / 12 : G.gap(a) / 2;
            if (a.surface === "painted") painted(a, a, 0, a.median / 2, a.nose, ring, G.gap(a) / 2, "median", "yellow");
            else stroke(around(a, 0, a.median / 2, a.nose, ring, G.gap(a) / 2), style.yellow);
          }
          else {
            const reach = G.dot(a, G.axes({angle:a.approachCurve?.axis??a.angle}).u) - G.throat(item, a);
            if (reach > 0)
              for (const side of [-1, 1])
                stroke(
                  G.approachLine(a,(side*G.gap(a))/2,0,-reach),
                  style.yellow,
                );
          }
        }
        for (const incoming of [true, false])
          for (const s of G.splits(a, incoming)) {
            if (s.surface === "painted") painted(a, s, G.splitCenter(a, s), s.width / 2, s.nose, s.width / 2, s.inset ? 0 : s.width / 2, s.id, "white");
            else stroke(around(a, G.splitCenter(a, s), s.width / 2, s.nose, s.width / 2, s.inset ? 0 : s.width / 2), style.white);
          }
      }
    }

    const routeCache = new WeakMap();
    function movementRoutes(item) {
      const key = JSON.stringify([item.approaches, item.movements]);
      let cached = routeCache.get(item);
      if (cached?.key !== key) {
        cached = { key, paths: G.routes(item, G.routing(item, margin)) };
        routeCache.set(item, cached);
      }
      return cached.paths;
    }
    // Lane arrows fill the last ARROW_FEET of each lane at the mouth; where they
    // are shown, movement paths stop short of them so the arrows stay readable.
    const ARROW_FEET = 20;
    function trim(points, feet) {
      const total = points.reduce((sum, p, i) => (i ? sum + G.length(G.sub(p, points[i - 1])) : 0), 0);
      const cut = Math.min(feet, total / 3);
      const at = (distance) => {
        let walked = 0;
        for (let i = 1; i < points.length; i++) {
          const step = G.length(G.sub(points[i], points[i - 1]));
          if (walked + step >= distance)
            return {
              i,
              p: G.add(
                points[i - 1],
                G.mul(G.sub(points[i], points[i - 1]), (distance - walked) / (step || 1)),
              ),
            };
          walked += step;
        }
        return { i: points.length - 1, p: points.at(-1) };
      };
      if (points.length < 2 || cut <= 0) return points;
      const start = at(cut),
        end = at(total - cut);
      return [start.p, ...points.slice(start.i, end.i), end.p];
    }
    // Each approach's movements share a color, like Cities: Skylines' lane
    // routing: red for the first approach, the rest spread around the hues.
    const approachColor = (item, id) => {
      const i = Math.max(0, item.approaches.findIndex((a) => a.id === id));
      return `hsl(${Math.round((i * 360) / Math.max(item.approaches.length, 3))} 95% 60%)`;
    };
    function drawGuides(item, convert, arrows) {
      if (round(item)) return drawRoundaboutGuides(item, convert);
      const paths = movementRoutes(item);
      for (const m of item.movements) {
        if (!G.curve(item, m)) continue;
        const route = paths.get(m.id) ?? [];
        const points = app.traffic.path(arrows ? trim(route, ARROW_FEET) : route).map(convert);
        const focused = selected === item.id && m.id === chosenMovement;
        const color = approachColor(item, app.traffic.reversed ? m.to : m.from);
        // The chosen movement: thicker, with a white edge.
        if (focused) svg("path", { d: line(points), class: "intersectionMovement", stroke: "#ffffff", "stroke-width": 4 }, guides);
        svg(
          "path",
          {
            d: line(points),
            class: "intersectionMovement",
            stroke: color,
            "stroke-width": focused ? 2.2 : 1.4,
          },
          guides,
        );
        let walked = 0,
          next = 35;
        for (let i = 1; i < points.length; i++) {
          const delta = G.sub(points[i], points[i - 1]),
            distance = G.length(delta);
          while (distance > 0 && walked + distance >= next) {
            const at = G.add(points[i - 1], G.mul(delta, (next - walked) / distance)),
              u = G.unit(delta),
              n = { x: -u.y, y: u.x };
            const p = G.add(G.sub(at, G.mul(u, 5)), G.mul(n, 2.5)),
              q = G.sub(G.sub(at, G.mul(u, 5)), G.mul(n, 2.5));
            svg(
              "path",
              {
                d: `M${p.x} ${p.y}L${at.x} ${at.y}L${q.x} ${q.y}`,
                class: "intersectionMovement",
                stroke: color,
                "stroke-width": focused ? 2.2 : 1.4,
              },
              guides,
            );
            next += 60;
          }
          walked += distance;
        }
        if (!active() || points.length <= 2) continue;
        const hit = svg(
          "path",
          {
            d: line(points),
            class: "intersectionConnectionHit",
            tabindex: 0,
            role: "button",
            "aria-label": `Movement from approach ${item.approaches.findIndex((a) => a.id === (app.traffic.reversed?m.to:m.from)) + 1} to approach ${item.approaches.findIndex((a) => a.id === (app.traffic.reversed?m.from:m.to)) + 1}`,
            "data-key": `connection-${m.id}`,
          },
          guides,
        );
        const choose = () => {
          if (selected !== item.id) select(item.id);
          chosen = app.traffic.reversed?m.to:m.from;
          inputLane = app.traffic.reversed?m.output:m.input;
          chosenMovement = m.id;
          showPanel();
          refresh();
        };
        // Pressing a connection selects it; dragging it bends the curve.
        hit.onpointerdown = (e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          e.stopPropagation();
          choose();
          startDrag(e, { type: "bend", movement: m.id });
        };
        hit.onclick = (e) => {
          e.stopPropagation();
          choose();
        };
        hit.onkeydown = (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            choose();
          }
        };
      }
    }
    // A persistent SVG owns capture; rebuilding the handles during a drag cannot
    // lose capture or turn an edit into a workspace pan.
    function control(p, label, key, activate, dragInfo, shape = "circle") {
      if(app.traffic.reversed)label=label.replace(/entry|exit|incoming|outgoing/gi,word=>({entry:'exit',exit:'entry',incoming:'outgoing',outgoing:'incoming'})[word.toLowerCase()]);
      const e = svg(
        shape,
        shape === "circle" ? { cx: p.x, cy: p.y, r: 5 } : { x: p.x - 4, y: p.y - 4, width: 8, height: 8 },
        guides,
      );
      e.classList.add("intersectionHandle");
      e.setAttribute("tabindex", "0");
      e.setAttribute("role", "button");
      e.setAttribute("aria-label", label);
      e.dataset.key = key;
      if (dragInfo?.remove) e.dataset.removable = "true";
      e.onclick = (event) => {
        event.stopPropagation();
        if (!dragging) activate?.();
      };
      e.onpointerdown = (event) => {
        if (event.button !== 0 || !dragInfo) return;
        event.preventDefault();
        event.stopPropagation();
        showPanel();
        startDrag(event, dragInfo);
      };
      e.onkeydown = (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          activate?.();
          return;
        }
        if ((event.key === "Delete" || event.key === "Backspace") && dragInfo?.remove) {
          event.preventDefault();
          dragInfo.remove();
          return;
        }
        const move = arrowKeys[event.key];
        if (!move || !dragInfo) return;
        event.preventDefault();
        event.stopPropagation();
        nudge(dragInfo, move, event.shiftKey);
      };
      return e;
    }
    // A small + at a lane boundary in the opening adds a median there.
    function addControl(p, label, key, action) {
      const g = svg(
        "g",
        { class: "intersectionAdd", tabindex: 0, role: "button", "aria-label": label, "data-key": key },
        guides,
      );
      svg("circle", { cx: p.x, cy: p.y, r: 6 }, g);
      svg("path", { d: `M${p.x - 3} ${p.y}H${p.x + 3}M${p.x} ${p.y - 3}V${p.y + 3}` }, g);
      g.onpointerdown = (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
      };
      g.onclick = (e) => {
        e.stopPropagation();
        action();
      };
      g.onkeydown = (e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        action();
      };
    }
    function rememberFocus() {
      return guides.contains(document.activeElement) ? document.activeElement?.dataset.key : null;
    }
    function restoreFocus(key) {
      if (key && !dragging)
        [...guides.querySelectorAll("[data-key]")]
          .find((e) => e.dataset.key === key)
          ?.focus({ preventScroll: true });
    }
    // Schematic lane guides and arrows are never painted or exported. They are
    // drawn in intersection feet inside one transformed group.
    function feetGroup(convert) {
      const o = convert({ x: 0, y: 0 }),
        x = convert({ x: 1, y: 0 }),
        y = convert({ x: 0, y: 1 });
      return svg(
        "g",
        {
          transform: `matrix(${x.x - o.x} ${x.y - o.y} ${y.x - o.x} ${y.y - o.y} ${o.x} ${o.y})`,
          class: "intersectionFeet",
        },
        guides,
      );
    }
    function drawLanes(item, convert) {
      const parent = feetGroup(convert);
      for (const [i, a] of item.approaches.entries()) {
        for (const incoming of [true, false]) {
          const lanes = incoming ? a.inLanes : a.outLanes;
          const effectiveIncoming=app.traffic.incoming(incoming);
          for (const [j, id] of lanes.entries()) {
            // A roundabout's lane handles sit by YIELD (entries) and the circle
            // (exits), where movements are made.
            const pose = round(item) ? RB.handle(item, a, incoming, j) : { p: G.ridingLane(a, incoming, j), u: G.axes(a).u };
            const p = pose.p,
              u = pose.u,
              q = G.sub(p, G.mul(u, ARROW_FEET));
            const picked = effectiveIncoming && id === inputLane;
            // The lane's drag strip shows only while a movement is dragged from
            // its incoming lane to an outgoing lane.
            const linking = dragging?.type === "link" && dragging.item === item;
            if (linking && (effectiveIncoming ? id === dragging.input : id === dragging.target?.output))
              svg(
                "path",
                {
                  d: `M${p.x} ${p.y}L${q.x} ${q.y}`,
                  class: "intersectionMovement",
                  stroke: "#ffc72c",
                  "stroke-width": 0.7,
                },
                parent,
              );
            const laneOffset=G.dot(G.sub(p,a),G.axes(a).n);
            const at = !round(item)&&a.approachCurve?G.local(a,laneOffset,-9):G.sub(p,G.mul(u,9)),
              direction = G.mul(!round(item)&&a.approachCurve?G.approachFrame(a,-9).u:u, (effectiveIncoming ? -1 : 1)),
              right = { x: -direction.y, y: direction.x };
            const targets=effectiveIncoming ? (round(item)
              ? (app.traffic.reversed
                ? item.approaches.filter(b=>b.inLanes.some(input=>RB.destinations(item,b,input).includes(a.id)))
                : RB.destinations(item,a,id).map(to=>item.approaches.find(b=>b.id===to)))
              : item.movements.filter(m=>app.traffic.reversed?m.output===id:m.input===id)
                .map(m=>item.approaches.find(b=>b.id===(app.traffic.reversed?m.from:m.to)))) : [];
            const types=new Set(effectiveIncoming?targets.filter(Boolean).map(b=>{
              if(b===a)return 'u';const turn=G.degrees(b.angle-a.angle-180);
              return turn<45||turn>315?'through':turn>180?'left':'right';
            }):['through']);
            if (effectiveIncoming && !types.size) {
              const mark = svg(
                "text",
                {
                  x: at.x,
                  y: at.y,
                  "text-anchor": "middle",
                  "dominant-baseline": "central",
                  class: "intersectionLaneUnknown",
                },
                parent,
              );
              mark.textContent = "?";
            }
            if (types.size) {
              const base = G.sub(at, G.mul(direction, 5));
              svg(
                "path",
                {
                  d: `M${base.x} ${base.y}L${at.x} ${at.y}`,
                  class: "intersectionMovement",
                  stroke: picked ? "#ffc72c" : "white",
                  "stroke-width": 1,
                },
                parent,
              );
            }
            for (const type of types) {
              const turn = type === "left" || type === "u" ? -1 : 1;
              const toward = type === "through" ? direction : G.mul(right, turn);
              const tip = G.add(at, G.mul(toward, 4));
              const points = [at, tip];
              let heading = toward;
              if (type === "u") {
                heading = G.mul(direction, -1);
                points.push(G.add(tip, G.mul(heading, 4)));
              }
              const end = points.at(-1),
                normal = { x: -heading.y, y: heading.x };
              const l = G.add(G.sub(end, G.mul(heading, 2)), G.mul(normal, 1.5)),
                r = G.sub(G.sub(end, G.mul(heading, 2)), G.mul(normal, 1.5));
              svg(
                "path",
                {
                  d: line(points) + `M${l.x} ${l.y}L${end.x} ${end.y}L${r.x} ${r.y}`,
                  class: "intersectionMovement",
                  stroke: picked ? "#ffc72c" : "white",
                  "stroke-width": 1,
                },
                parent,
              );
            }
            const hit = svg(
              "path",
              {
                d: `M${p.x} ${p.y}L${q.x} ${q.y}`,
                class: "intersectionLaneHit",
                tabindex: 0,
                role: "button",
                "aria-label": `${effectiveIncoming ? "Incoming" : "Outgoing"} lane ${j + 1}, approach ${i + 1}`,
                "data-key": `lane-${id}`,
              },
              parent,
            );
            if (dragging?.type === "link" && dragging.target?.output === id) hit.classList.add("dropTarget");
            // An outgoing arrow only takes presses as the selected movement's end,
            // so the pavement around it still drags the intersection.
            if (!effectiveIncoming && !item.movements.some((m) => m.id === chosenMovement && (app.traffic.reversed?m.input:m.output) === id))
              hit.style.pointerEvents = "none";
            hit.onpointerdown = (event) => {
              if (event.button !== 0) return;
              event.preventDefault();
              event.stopPropagation();
              const reversed=app.traffic.reversed;
              const existing=!effectiveIncoming&&item.movements.find(m=>m.id===chosenMovement&&(reversed?m.input:m.output)===id);
              if(!effectiveIncoming&&!existing)return;
              chosen=effectiveIncoming?a.id:(reversed?existing.to:existing.from);
              inputLane=effectiveIncoming?id:(reversed?existing.output:existing.input);
              startDrag(event,{type:'link',approach:chosen,input:inputLane,replace:existing?.id,reversed});
              renderFields();
              refreshOverlay();
            };
            hit.onkeydown = (event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              effectiveIncoming ? chooseInput(a, id) : toggleMovement(a, id);
            };
          }
        }
        const label = G.local(a, 0, 18);
        const text = svg(
          "text",
          { x: label.x, y: label.y, "text-anchor": "middle", class: "intersectionApproachLabel",
            role: "button", tabindex: 0, "aria-label": `Select approach ${i + 1}`, "aria-pressed": chosen === a.id,
            "data-key": `approach-label-${a.id}` },
          parent,
        );
        text.textContent = i + 1;
        text.onpointerdown = event => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.stopPropagation();
          text.focus({ preventScroll: true });
        };
        const pick = () => { select(item.id, a.id); showPanel(); };
        text.onclick = event => { event.stopPropagation(); pick(); };
        text.onkeydown = event => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          event.stopPropagation();
          pick();
        };
      }
    }
    function drawLinkPreview(item, convert) {
      if (dragging?.type !== "link" || dragging.item !== item || !dragging.cursor) return;
      const parent = feetGroup(convert);
      const a = item.approaches.find((a) => a.id === dragging.approach),
        j = (dragging.reversed?a.outLanes:a.inLanes).indexOf(dragging.input),
        p = round(item) ? RB.handle(item, a, !dragging.reversed, j).p : G.ridingLane(a, !dragging.reversed, j);
      let points = [p, dragging.cursor];
      if(dragging.target&&dragging.reversed) {
        const b=item.approaches.find(a=>a.id===dragging.target.approach),index=b.inLanes.indexOf(dragging.target.output);
        points=round(item)?RB.path(item,b,index,a,j).slice().reverse():G.route(item,G.movement(b,index,a,j),G.routing(item,margin)).slice().reverse();
      } else if (dragging.target && round(item)) {
        // The preview follows the roundabout: round the circle in its lane.
        const b = item.approaches.find((x) => x.id === dragging.target.approach);
        points = RB.path(item, a, j, b, 0, { from: RB.handle(item, a, true, j).sp, to: RB.handle(item, b, false, 0).sp });
      } else if (dragging.target) {
        const b = item.approaches.find((a) => a.id === dragging.target.approach),
          m = G.movement(a, a.inLanes.indexOf(dragging.input), b, b.outLanes.indexOf(dragging.target.output));
        points = G.route(item, m, G.routing(item, margin));
      }
      svg(
        "path",
        {
          d: line(points),
          class: "intersectionMovement",
          stroke: "#ffc72c",
          "stroke-width": 2,
          "stroke-dasharray": dragging.target ? "none" : "4 3",
        },
        parent,
      );
    }
    function drawControls(item, convert) {
      if (round(item)) return drawRoundaboutControls(item, convert);
      const ordered = G.ordered(item);
      for (const [i, a] of item.approaches.entries()) {
        drawApproachCurveControl(item,a,i,convert);
        const pick = () => (select(item.id, a.id), showPanel());
        for (const incoming of [true, false]) {
          const handle = control(
            convert(G.edge(a, incoming, margin)),
            `Approach ${i + 1} ${incoming ? "incoming" : "outgoing"} outer edge`,
            `edge-${a.id}-${incoming}`,
            pick,
            { type: "mouth", approach: a.id, incoming },
          );
          const hint = "Drag to turn the opening; Shift-drag to slide it without turning.";
          handle.setAttribute("aria-description", hint);
          svg("title", {}, handle).textContent = hint;
        }
        if (a.median > 0 && a.incoming && a.outgoing) {
          for (const incoming of [true, false])
            control(
              convert(G.local(a, ((incoming ? -1 : 1) * a.median) / 2,a.medianInset?-Math.min((G.reach(a,a.median/2,a.nose)-a.median/2)/2,Math.max(a.median/2,6)):0)),
              `Approach ${i + 1} median ${incoming ? "incoming" : "outgoing"} edge`,
              `median-${a.id}-${incoming}`,
              pick,
              { type: "median", approach: a.id, incoming },
              "rect",
            );
          control(convert(G.local(a, 0, -a.nose)), `Approach ${i + 1} median nose`, `nose-${a.id}`, pick, {
            type: "nose",
            approach: a.id,
          });
        }
        for (const incoming of [true, false])
          for (const s of G.splits(a, incoming)) {
            const remove = () => removeSplit(a.id, s.id);
            const outer = G.splitCenter(a, s) + ((incoming ? -1 : 1) * s.width) / 2;
            control(
              convert(G.local(a, outer,s.inset?-Math.min((G.reach(a,s.width/2,s.nose)-s.width/2)/2,Math.max(s.width/2,6)):0)),
              `Approach ${i + 1} median between ${boundaryName(s)}, outer edge`,
              `split-${s.id}`,
              pick,
              { type: "split", approach: a.id, split: s.id, remove },
              "rect",
            );
            control(
              convert(G.local(a, G.splitCenter(a, s), -s.nose)),
              `Approach ${i + 1} median between ${boundaryName(s)}, nose`,
              `split-nose-${s.id}`,
              pick,
              { type: "splitNose", approach: a.id, split: s.id, remove },
            );
          }
        for (const where of freeBoundaries(a)) {
            const offset = where === "center" ? 0 : G.boundary(a, where.incoming, where.after);
            addControl(
              convert(G.local(a, offset, 6)),
              `Add a median to approach ${i + 1} between ${boundaryName(where)}`,
              `add-${a.id}-${boundaryKey(where)}`,
              () => addMedian(a.id, where),
            );
          }
        const next = ordered[(ordered.indexOf(a) + 1) % ordered.length],
          corner = G.corner(a, next, margin);
        control(
          convert(corner.center),
          `Approach ${i + 1} corner radius`,
          `radius-${a.id}`,
          pick,
          { type: "radius", approach: a.id },
          "rect",
        );
      }
    }
    function rotate(item, degrees) {
      const t = (degrees * Math.PI) / 180,
        c = Math.cos(t),
        s = Math.sin(t);
      for (const a of item.approaches) {
        const x = a.x,
          y = a.y;
        a.x = x * c - y * s;
        a.y = x * s + y * c;
        a.angle = G.degrees(a.angle + degrees);
        if (a.bezier) a.bezier.axis = G.degrees(a.bezier.axis + degrees);
        if (a.approachCurve) {
          a.approachCurve.axis=G.degrees(a.approachCurve.axis+degrees);
          if(a.approachCurve.endAngle!=null)a.approachCurve.endAngle=G.degrees(a.approachCurve.endAngle+degrees);
          if(a.approachCurve.end){const p=a.approachCurve.end;a.approachCurve.end={x:p.x*c-p.y*s,y:p.x*s+p.y*c};}
        }
      }
      item.rotation = G.degrees(item.rotation + degrees);
    }
    // A road's cross section has no lane-splitting medians, so adopting one
    // drops them.
    function adopt(sheet, item, a, end, preserveMedians=false) {
      const medians=preserveMedians?{splits:a.splits,...(a.medianOverride?{median:a.median,medianOverride:true}: {})}:{};
      if (a.bezier) a.bezier.axis = G.degrees(a.bezier.axis + end.angle - a.angle);
      Object.assign(a, {
        ...local(sheet, item, end),
        angle: G.degrees(end.angle),
        incoming: end.incoming,
        outgoing: end.outgoing,
        width: end.width,
        outWidth: end.outWidth,
        median: end.median,
        gap: end.gap,
        binding: end.binding,
      });
      delete a.splits;
      if(preserveMedians)Object.assign(a,medians);
      else {delete a.medianInset;delete a.medianMouth;}
      G.normalize(item);
      G.normalize({...item,approaches:[a],movements:[]});
      a.laneDetails={};
      for(const [ids,details] of [[a.inLanes,end.inDetails],[a.outLanes,end.outDetails]])
        ids.forEach((id,i)=>{if(details?.[i])a.laneDetails[id]={...details[i]};});
    }
    function reconcile(sheet, item, solved) {
      normalize(item);
      if (dragging?.item === item) return;
      for (const a of item.approaches) {
        // Upgrade earlier inset islands to actual lane separators.
        for(const split of a.splits??[])delete split.inset;
        if(a.medianInset)setMedianWidth(a,a.median);
        syncBoundMedian(sheet,a);
        if (!a.binding) continue;
        const end = roads.intersectionEnd(sheet, a.binding, solved);
        if (!end?.terminal) {
          delete a.binding;
          continue;
        }
        adopt(sheet, item, a, end,true);
      }
      for (const a of item.approaches) {
        if (!a.links) continue;
        a.links = a.links.filter((link) => {
          const end = roads.intersectionEnd(sheet, link, solved);
          return end?.freeLanes[link.lane] && !a.binding && laneOf(a, link) >= 0 && link.lane < roadLanes(sheet, link);
        });
        if (!a.links.length) delete a.links;
        for(const link of a.links??[]) {
          const end=roads.intersectionEnd(sheet,link,solved),detail=(link.e?end?.inDetails:end?.outDetails)?.[link.lane];
          if(detail)(a.laneDetails??={})[link.to]={...detail};
        }
      }
    }
    // Lane links pin one lane of a road end to one lane of an approach without
    // changing the approach: { road, e, lane (road lane index), to (approach lane id) }.
    // A road end arriving at the intersection (e = 1) feeds an incoming lane.
    const laneOf = (a, link) => (link.e ? a.inLanes : a.outLanes).indexOf(link.to);
    const mouthPose = (item, a, incoming, j) => round(item) ? RB.approachLane(item, a, incoming, j)
      : { p: G.lane(a, incoming, j), angle: a.angle };
    const roadLanes = (sheet, link) => sheet.roads.find((r) => r.id === link.road)?.lanes ?? 0;
    const sameEnd = (link, end) => end && link.road === end.road && link.e === end.e;
    // `self` is a road end being moved, whose own lane link doesn't count.
    function occupied(sheet, joint, own, self = null) {
      return (sheet.intersections ?? []).some((item) =>
        item.approaches.some(
          (a) =>
            (a !== own && a.binding && roads.intersectionEnd(sheet, a.binding)?.joint === joint) ||
            a.links?.some(
              (link) => !sameEnd(link, self) && roads.intersectionEnd(sheet, link)?.joint === joint,
            ),
        ),
      );
    }
    function nearest(sheet, item, a, p, incoming) {
      let best = null,
        distance = 14 / sheet.view.scale;
      for (const end of roads.intersectionEnds(sheet)) {
        if (occupied(sheet, end.joint, a)) continue;
        const at = G.edge({ ...end, x: 0, y: 0 }, incoming, margin);
        const point = G.add(end, G.mul(at, scale(sheet)));
        const d = G.length(G.sub(p, point));
        if (d <= distance) {
          best = { end, point };
          distance = d;
        }
      }
      return best;
    }
    function boundToLaneLinks(sheet,a){
      if(!a.binding)return;
      const end=roads.intersectionEnd(sheet,a.binding);if(!end)return;
      a.links=end.ends.flatMap(ref=>{
        const road=sheet.roads.find(r=>r.id===ref.road),ids=ref.e?a.inLanes:a.outLanes;
        return Array.from({length:Math.min(road.lanes,ids.length)},(_,lane)=>({...ref,lane,to:ids[lane]}));
      });
      delete a.binding;delete a.medianOverride;
    }
    function separateMedianRoads(sheet,item){
      sheet.medians=(sheet.medians??[]).filter(m=>{
        const owner=m.intersectionMedian;if(owner?.intersection!==item.id)return true;
        const split=item.approaches.find(a=>a.id===owner.approach)?.splits?.find(s=>s.id===owner.split);
        if(!split||m.points.some(p=>p.on?.road&&!sheet.roads.some(r=>r.id===p.on.road)))return false;
        m.type=split.surface??'concrete';
        if(m.type==='painted')Object.assign(m,{color:split.color??'white',lean:split.lean??'right',spacing:split.spacing??20});
        return true;
      });
      for(const a of item.approaches){
        if(!a.splits?.length)continue;
        boundToLaneLinks(sheet,a);
        const requests=new Map();
        for(const split of a.splits){
          const e=split.incoming?1:0,ids=e?a.inLanes:a.outLanes;
          for(const link of a.links??[]){
            if(link.e!==e)continue;
            const road=sheet.roads.find(r=>r.id===link.road);if(!road)continue;
            const base=ids.indexOf(link.to)-link.lane,at=split.after-base;
            if(at<=0||at>=road.lanes)continue;
            const cuts=requests.get(road)??new Map();cuts.set(at,{surface:split.surface??'concrete',color:split.color??'white',lean:split.lean??'right',spacing:split.spacing??20,owner:{intersection:item.id,approach:a.id,split:split.id}});requests.set(road,cuts);
          }
        }
        for(const [road,cuts] of requests){
          // Convert attachments at either end before remapping the lane IDs.
          for(const other of sheet.intersections??[])for(const approach of other.approaches){
            const end=approach.binding&&roads.intersectionEnd(sheet,approach.binding);
            if(end?.ends.some(ref=>ref.road===road.id))boundToLaneLinks(sheet,approach);
          }
          roads.splitLaneGroups(sheet,road,[...cuts].map(([at,details])=>({at,...details})));
        }
      }
    }
    function prepareIndependentMouths(sheet, item) {
      if (!round(item)) return;
      for (const a of item.approaches) {
        const independent = [true, false].some(incoming => {
          const edit = a.bezierSides?.[incoming ? "entry" : "exit"];
          return a[incoming ? "incoming" : "outgoing"] && edit &&
            (Math.hypot(edit.connection?.along ?? 0, edit.connection?.across ?? 0) > 1e-7 ||
              (edit.mouth && Math.abs(((RB.approachLane(item, a, incoming, 0).angle - a.angle + 540) % 360) - 180) > 1e-7));
        });
        if (!independent) continue;
        boundToLaneLinks(sheet, a);
        for (const link of a.links ?? []) {
          const road = sheet.roads.find(r => r.id === link.road), partner = roads.pairOf(sheet, road);
          if (!partner) continue;
          // A paired road shares one tangent. Independent mouths need two
          // road ends; keep both roads and their far-end attachments in place.
          for (const other of sheet.intersections ?? []) for (const approach of other.approaches)
            if ([road.id, partner.id].includes(approach.binding?.road)) boundToLaneLinks(sheet, approach);
          roads.splitOppositeRoads(sheet, road, true);
        }
      }
    }
    function moveBindings(sheet, item) {
      prepareIndependentMouths(sheet, item);
      const seen = new Set();
      for (const a of item.approaches) {
        syncBoundMedian(sheet,a);
        if (!a.binding) continue;
        const end = roads.intersectionEnd(sheet, a.binding);
        if (!end || seen.has(end.joint)) continue;
        seen.add(end.joint);
        roads.moveIntersectionEnd(sheet, a.binding, world(sheet, item, a), a.angle);
      }
      for (const a of item.approaches)
        for (const link of a.links ?? []) {
          const j = laneOf(a, link);
          if (j >= 0) {
            const pose = mouthPose(item, a, link.e === 1, j);
            roads.alignLaneEnd(
              sheet,
              link,
              link.lane,
              world(sheet, item, pose.p),
              pose.angle,
            );
          }
        }
    }
    function snapshot(sheet) {
      return structuredClone({
        roads: sheet.roads,
        joints: sheet.joints,
        intersections: sheet.intersections ?? [],
      });
    }
    function startDrag(event, info) {
      const item = current();
      if (!item) return;
      const sheet = sheets.selected;
      dragging = {
        ...info,
        item,
        start: local(sheet, item, sheets.toImage(event.clientX, event.clientY)),
        before: round(item) ? RB.snapshot(item) : structuredClone(item),
        saved: snapshot(sheet),
        sheet,
        alt: event.altKey,
        slide: event.shiftKey,
        focusKey: event.target.dataset?.key,
        changed: false,
      };
      if (info.approach) {
        if (chosen !== info.approach) { chosen = info.approach; inputLane = null; }
        const a = item.approaches.find((a) => a.id === info.approach);
        if (event.altKey && a.binding) delete a.binding;
      }
      guides.setPointerCapture(event.pointerId);
    }
    function applyDrag(point) {
      const d = dragging,
        item = d.item,
        before = d.before;
      const delta = G.sub(point, d.start);
      if (d.type === "link") {
        d.cursor = point;
        d.target = null;
        d.changed = G.length(delta) > 2;
        for (const a of item.approaches)
          for (const [i, output] of (d.reversed?a.inLanes:a.outLanes).entries()) {
            const pose = round(item) ? RB.handle(item, a, Boolean(d.reversed), i) : null;
            const p = pose ? pose.p : G.ridingLane(a, Boolean(d.reversed), i),
              v = G.sub(point, p),
              axes = pose ? { u: pose.u, n: { x: -pose.u.y, y: pose.u.x } } : G.axes(a);
            // A roundabout's exit handle runs from the circle out to p.
            const lo = pose ? -8 : -35, hi = pose ? ARROW_FEET + 8 : 8, along = pose ? -G.dot(v, axes.u) : G.dot(v, axes.u);
            if (Math.abs(G.dot(v, axes.n)) <= G.width(a, false) / 2 && (pose ? along >= lo && along <= hi : along <= hi && along >= lo))
              d.target = { approach: a.id, output };
          }
        const exists =
          d.target &&
          !d.replace &&
          (round(item)
            ? (d.reversed?RB.destinations(item,item.approaches.find(a=>a.id===d.target.approach),d.target.output).includes(d.approach):RB.destinations(item, item.approaches.find((a) => a.id === d.approach), d.input).includes(d.target.approach))
            : item.movements.some((m) => d.reversed ? m.output === d.input && m.input === d.target.output : m.input === d.input && m.output === d.target.output));
        tell(
          !d.target
            ? "Drag onto an outgoing lane arrow. Escape cancels."
            : exists
              ? "Release to remove this movement."
              : "Release to connect this outgoing lane.",
        );
        refreshOverlay();
        return;
      }
      const a = item.approaches.find((a) => a.id === d.approach),
        old = before.approaches.find((a) => a.id === d.approach);
      const validBefore = structuredClone(item);
      snap = null;
      if (d.type === "body") {
        item.x = before.x + delta.x * scale(d.sheet);
        item.y = before.y + delta.y * scale(d.sheet);
      } else if (d.type === "diameter") {
        // Drag the circle's edge: the diameter follows, and every opening keeps
        // its distance outside the circle.
        const old = RB.diameter(before), o = d.origin;
        // Pointer delta and diameter are measured from drag start. Restore
        // that same starting cross section before shifting the mouths;
        // otherwise keepReach adds the full size change again on every move,
        // stretching the approaches (and their connected roads) indefinitely.
        item.approaches = structuredClone(before.approaches);
        item.roundabout.icd = Math.round(G.clamp((old * G.dot(G.add(o, delta), G.unit(o))) / (G.length(o) || 1), RB.MINI_DIAMETER[0], 1200) * 2) / 2;
        keepReach(before, item);
      } else if (d.type === "approachBend") {
        const { u, n } = RB.approachAxes(old), along = G.dot(delta, u);
        Object.assign(a, G.add(old, G.mul(u, along)), { bend: old.bend });
        RB.setApproachBend(a, Math.round(G.clamp(old.bend + G.dot(delta, n), -500, 500) * 2) / 2);
      } else if (d.type === "approachCurve") {
        if(round(item))RB.setApproachBezier(before,a,'mouth',delta);
        else G.setApproachBezier(before,a,delta);
      } else if (d.type === "approachBezier") {
        if (d.side && d.side !== "whole") RB.setApproachSideBezier(before, a, d.side, delta, d.end);
        else RB.setApproachBezier(before, a, d.end, delta);
      } else if (d.type === "splitterCorner") {
        RB.setSplitterCorner(before, a, d.side, d.end, delta);
      } else if (d.type === "yieldLine") {
        RB.moveYieldLine(before, a, delta);
      } else if (d.type === "goreSize") {
        RB.resizeEntryGore(before, a, d.lane, d.end, delta);
      } else if (d.type === "mouth") {
        if (!old.binding || d.alt) {
          Object.assign(a, structuredClone(old));
          delete a.binding;
        }
        const edge = round(item) ? RB.approachEdge(before, old, d.incoming, margin) : G.edge(old, d.incoming, margin),
          wanted = G.add(edge, delta);
        if (d.slide) {
          // Shift-drag slides the whole opening without turning it.
          Object.assign(a, G.add({ x: old.x, y: old.y }, delta));
          a.angle = old.angle;
        } else {
          // Rotate an opening around the intersection center, keeping its cross section
          // rigid. The grabbed pavement corner remains under the pointer.
          const angleDelta = Math.atan2(wanted.y, wanted.x) - Math.atan2(edge.y, edge.x);
          a.angle = G.degrees(old.angle + (angleDelta * 180) / Math.PI);
          if (a.bezier) a.bezier.axis = G.degrees(old.bezier.axis + (angleDelta * 180) / Math.PI);
          if (a.approachCurve) a.approachCurve.axis = G.degrees(old.approachCurve.axis + (angleDelta * 180) / Math.PI);
          const previousOffset = G.sub(edge, old), c = Math.cos(angleDelta), s = Math.sin(angleDelta);
          const offset = round(item) ? { x: previousOffset.x * c - previousOffset.y * s, y: previousOffset.x * s + previousOffset.y * c }
            : G.mul(G.axes(a).n, G.side(a, d.incoming, margin));
          Object.assign(a, G.sub(wanted, offset));
        }
        if (!a.binding) {
          const candidate = nearest(d.sheet, item, a, world(d.sheet, item, wanted), d.incoming);
          if (candidate) {
            adopt(d.sheet, item, a, candidate.end);
            snap = candidate.point;
          }
        }
      } else if (d.type === "median") {
        const oldEdge = G.local(old, ((d.incoming ? -1 : 1) * old.median) / 2),
          wanted = G.add(oldEdge, delta);
        setMedianWidth(a,G.clamp(2 * Math.abs(G.dot(G.sub(wanted, a), G.axes(a).n)), 0, 200));
      } else if (d.type === "nose")
        a.nose = G.clamp(old.nose - G.dot(delta, G.axes(a).u), 1, Math.max(1, G.length(a) - 5));
      else if (d.type === "split" || d.type === "splitNose") {
        const s = a.splits.find((s) => s.id === d.split),
          oldS = old.splits.find((s) => s.id === d.split);
        if (d.type === "splitNose")
          s.nose = G.clamp(oldS.nose - G.dot(delta, G.axes(a).u), 1, Math.max(1, G.length(a) - 5));
        else {
          // The inner edge stays on its lane boundary; the outer edge follows.
          const inner = G.boundary(old, oldS.incoming, oldS.after),
            outer = inner + (oldS.incoming ? -1 : 1) * oldS.width/(oldS.inset?2:1),
            wanted = outer + G.dot(delta, G.axes(a).n);
          s.width = G.clamp((oldS.incoming ? -1 : 1) * (wanted - inner)*(oldS.inset?2:1), 0, 100);
        }
      } else if (d.type === "radius") {
        const next = G.ordered(item),
          b = next[(next.indexOf(a) + 1) % next.length];
        const direction = G.unit(G.add(G.axes(a).u, G.axes(b).u));
        a.radius = G.clamp(old.radius + G.dot(delta, direction) * 2, 0, 200);
      } else if (d.type === "bend") {
        const m = item.movements.find((m) => m.id === d.movement),
          oldM = before.movements.find((m) => m.id === d.movement),
          a = item.approaches.find((a) => a.id === m.from),
          b = item.approaches.find((a) => a.id === m.to),
          u = G.axes(a).u,
          v = G.axes(b).u;
        const den = u.x * v.y - u.y * v.x,
          values = G.pulls(before, oldM);
        const entry =
          Math.abs(den) > 0.01 ? -(delta.x * v.y - delta.y * v.x) / (0.375 * den) : -G.dot(delta, u) / 0.75;
        const exit =
          Math.abs(den) > 0.01 ? -(u.x * delta.y - u.y * delta.x) / (0.375 * den) : -G.dot(delta, v) / 0.75;
        m.pullIn = G.clamp(values[0] + entry, 1, 1000);
        m.pullOut = G.clamp(values[1] + exit, 1, 1000);
        m.autoCurve = false;
      } else if (d.type === "curve") {
        const m = item.movements.find((m) => m.id === d.movement),
          oldM = before.movements.find((m) => m.id === d.movement),
          end = item.approaches.find((a) => a.id === (d.key === "pullIn" ? m.from : m.to));
        const values = G.pulls(before, oldM);
        [m.pullIn, m.pullOut] = values;
        m.autoCurve = false;
        m[d.key] = G.clamp(values[d.key === "pullIn" ? 0 : 1] - G.dot(delta, G.axes(end).u), 1, 1000);
      }
      const error = validate(item);
      if (error) {
        for (const key of Object.keys(item)) delete item[key];
        Object.assign(item, validBefore);
        snap = null;
        tell(error);
        return;
      }
      tell(snap ? "Release to connect to this road end." : "");
      d.changed = true;
      if (!snap) moveBindings(d.sheet, item);
      roads.render();
    }
    // Pointer events can arrive faster than frames. Keep just the latest
    // position, and do geometry, connected roads and rendering together once.
    // Keyboard nudges remain synchronous; release flushes any pending move.
    let dragFrame = null, dragPoint = null;
    function flushDrag(cancel = false) {
      if (dragFrame != null) cancelAnimationFrame(dragFrame);
      dragFrame = null;
      const point = dragPoint;
      dragPoint = null;
      if (!cancel && point && dragging) applyDrag(point);
    }
    function finishDrag(cancel = false) {
      flushDrag(cancel);
      const d = dragging;
      if (!d) return;
      // Pointer capture and rebuilding the SVG on release suppress native
      // click/dblclick events on these handles. Recognize a double tap here;
      // an actual drag never opens or closes the curve controls.
      const tap = !cancel && !d.changed && d.type === "approachBend";
      const showBezier = tap && bendTap?.id === d.approach && performance.now() - bendTap.at < 500;
      bendTap = tap && !showBezier ? { id: d.approach, at: performance.now() } : null;
      const curveTap=!cancel&&!d.changed&&d.type==='approachCurve';
      const straighten=curveTap&&approachCurveTap?.id===d.approach&&performance.now()-approachCurveTap.at<500;
      approachCurveTap=curveTap&&!straighten?{id:d.approach,at:performance.now()}:null;
      dragging = null;
      snap = null;
      if (!cancel && d.type === "link" && d.changed && d.target && round(d.item)) {
        // On a roundabout a lane's destinations are exits, not exit lanes.
        const a = d.item.approaches.find(a=>a.id===(d.reversed?d.target.approach:d.approach));
        toggleDestination(d.item,a,d.reversed?d.target.output:d.input,d.reversed?d.approach:d.target.approach);
      } else if (!cancel && d.type === "link" && d.changed && d.target) {
        const a = d.item.approaches.find((a) => a.id === d.approach),
          b = d.item.approaches.find((a) => a.id === d.target.approach);
        const input=d.reversed?d.target.output:d.input,output=d.reversed?d.input:d.target.output;
        const from=d.reversed?b:a,to=d.reversed?a:b;
        const existing = d.item.movements.find(m=>m.input===input&&m.output===output);
        if (existing && !d.replace) {
          // Dragging from an arrow onto a lane it already reaches removes that movement.
          d.item.movements = d.item.movements.filter((m) => m !== existing);
          chosenMovement = null;
        } else if (existing) {
          // Reconnecting onto a lane this input already reaches merges into it.
          if (existing.id !== d.replace)
            d.item.movements = d.item.movements.filter((m) => m.id !== d.replace);
          chosenMovement = existing.id;
        } else {
          if (d.replace) d.item.movements = d.item.movements.filter((m) => m.id !== d.replace);
          const made = G.movement(from,from.inLanes.indexOf(input),to,to.outLanes.indexOf(output));
          d.item.movements.push(made);
          chosenMovement = made.id;
        }
      }
      // A split median dragged down to (nearly) nothing is removed.
      if (!cancel && d.type === "split") {
        const a = d.item.approaches.find((a) => a.id === d.approach);
        a.splits = a.splits.filter((s) => s.width >= 0.5);
        normalize(d.item);
        moveBindings(d.sheet, d.item);
      }
      if (cancel) Object.assign(d.sheet, d.saved);
      if (!cancel && d.changed) commit();
      else { roads.render(); refresh(); }
      if(straighten) {
        const a=d.item.approaches.find(a=>a.id===d.approach);
        if(round(d.item))changeRound(()=>RB.straightenApproach(a));
        else change(()=>G.straightenApproach(a));
      }
      if (showBezier) toggleBezier(d.item, d.item.approaches.find(a => a.id === d.approach));
      restoreFocus(d.focusKey);
    }
    guides.addEventListener("click", (event) => event.stopPropagation());
    guides.addEventListener("pointermove", (e) => {
      if (!dragging || !guides.hasPointerCapture(e.pointerId)) return;
      dragPoint = local(dragging.sheet, dragging.before, sheets.toImage(e.clientX, e.clientY));
      if (dragFrame == null) dragFrame = requestAnimationFrame(() => flushDrag());
    });
    guides.addEventListener("pointerup", (e) => {
      if (!dragging) return;
      guides.releasePointerCapture(e.pointerId);
      finishDrag();
    });
    guides.addEventListener("pointercancel", () => finishDrag(true));
    function nudge(info, move, large) {
      const item = current();
      if (!item) return;
      const sheet = sheets.selected;
      const step = (large ? 10 : 1) / (sheet.view.scale * scale(sheet));
      dragging = {
        ...info,
        item,
        start: { x: 0, y: 0 },
        before: round(item) ? RB.snapshot(item) : structuredClone(item),
        saved: snapshot(sheet),
        sheet,
        focusKey: document.activeElement?.dataset.key,
        changed: false,
      };
      applyDrag({ x: move[0] * step, y: move[1] * step });
      finishDrag();
    }
    // The list keeps the popover open; picking an intersection on the sheet opens
    // its editor panel, which stays open while panning and editing.
    function select(id, approach = null) {
      if (selected !== id) chosen = null;
      selected = id;
      chosenMovement = null;
      selectedSheet = sheets.selected;
      if (approach) {
        chosen = approach;
        inputLane = null;
      }
      refresh();
    }
    function showPanel() {
      if (panel.hidden) app.showEditor("intersectionEditor");
    }
    function edit(item, focusName = false) {
      select(item.id);
      showPanel();
      app.selection?.editorChanged();
      if (focusName) nameInput.focus();
    }
    function refreshOverlay() {
      const focus = rememberFocus();
      guides.replaceChildren();
      const sheet = sheets.selected;
      if (!sheet?.inchesPerPixel) return;
      for (const item of sheet.intersections ?? []) {
        const convert = (p) => screen(sheet, item, p);
        // Movement guides and arrows show only on the intersection you've clicked.
        if (!active()) continue;
        const hit = svg(
          "path",
          {
            d: path(outline(item, margin).map(convert)),
            class: "intersectionHit",
            "aria-label": item.name,
            tabindex: 0,
            role: "button",
            "data-key": `body-${item.id}`,
          },
          guides,
        );
        hit.onpointerdown = (e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          e.stopPropagation();
          if (selected !== item.id) select(item.id);
          else chosenMovement = null;
          showPanel();
          startDrag(e, { type: "body" });
          refresh();
        };
        hit.onclick = (e) => e.stopPropagation();
        hit.ondblclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          edit(item, true);
        };
        hit.onkeydown = (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            edit(item, true);
            return;
          }
          const move = arrowKeys[e.key];
          if (move) {
            e.preventDefault();
            e.stopPropagation();
            selected = item.id;
            nudge({ type: "body" }, move, e.shiftKey);
          }
        };
        if (selected !== item.id) continue;
        drawGuides(item, convert, true);
        svg("path", { d: path(outline(item, margin).map(convert)), class: "intersectionOutline" }, guides);
        drawLanes(item, convert);
        drawLinkPreview(item, convert);
        drawControls(item, convert);
        // A selected connection's curve handles sit above the approach handles.
        const movement = item.movements.find((m) => m.id === chosenMovement);
        if (movement) {
          const curve = G.curve(item, movement);
          for (const [index, key] of [
            [1, "pullIn"],
            [2, "pullOut"],
          ]) {
            const end = convert(curve[index === 1 ? 0 : 3]),
              point = convert(curve[index]);
            svg(
              "path",
              { d: `M${end.x} ${end.y}L${point.x} ${point.y}`, class: "intersectionControlLine" },
              guides,
            );
            control(
              point,
              index === 1 ? "Entry curve handle" : "Exit curve handle",
              `curve-${movement.id}-${key}`,
              () => {},
              { type: "curve", movement: movement.id, key },
              "rect",
            );
          }
        }
      }
      if (snap) {
        const p = sheets.toScreen(snap);
        svg("circle", { cx: p.x, cy: p.y, r: 14, class: "roadSnap" }, guides);
      }
      restoreFocus(focus);
    }
    function refreshList() {
      const sheet = sheets.selected;
      get("newIntersection").disabled = !sheet?.inchesPerPixel;
      get("newRoundabout").disabled = !sheet?.inchesPerPixel;
      const list = get("intersectionList");
      list.replaceChildren();
      for (const item of sheet?.intersections ?? []) {
        const li = document.createElement("li");
        const b = button(item.name, () => select(item.id), li);
        b.className = "headListButton";
        b.classList.toggle("active", selected === item.id);
        b.setAttribute("aria-current", String(selected === item.id));
        b.ondblclick = () => edit(item, true);
        list.append(li);
      }
      for (const id of ["editIntersection", "duplicateIntersection", "deleteIntersection"])
        get(id).disabled = !current();
      if (!sheet) tell("Upload a sheet first.");
      else if (!sheet.inchesPerPixel) tell("Set this sheet’s scale first (Sheets › Set Scale).");
      else if (!dragging)
        tell(
          current()
            ? round(current())
              ? "Select an approach to drag its median corners and entry/exit Bézier handles. The circle's square resizes it. Drag an entry arrow to an exit to change destinations. Click a + near YIELD to add a gore."
              : chosenMovement
              ? "Connection selected. Drag it or its two square handles to adjust the curve. Delete removes this movement."
              : "Drag outer-edge handles to road ends, or drag a road’s lane node onto an approach. Drag from an incoming lane arrow to an outgoing lane to add a movement. Click a + to add a median. Option/Alt-drag detaches."
            : "Create an intersection or select one on the sheet.",
        );
    }
    function refresh() {
      if (selectedSheet !== sheets.selected) {
        selected = null;
        selectedSheet = sheets.selected;
      }
      if (!current()) selected = null;
      if (!current()?.movements.some((m) => m.id === chosenMovement)) chosenMovement = null;
      refreshList();
      refreshOverlay();
      if (!panel.hidden) renderFields();
    }
    function commit() {
      roads.tidyGores(sheets.selected);
      roads.render();
      sheets.save(sheets.selected);
      app.history.record();
      refresh();
    }
    // New Intersection places the default layout at the center of the view and
    // opens it in the panel.
    get("newIntersection").onclick = () => {
      const sheet = sheets.selected;
      if (!sheet?.inchesPerPixel) return;
      const item = G.create();
      const names = new Set((sheet.intersections ?? []).map((x) => x.name));
      let n = 1;
      while (names.has(`Intersection ${n}`)) n++;
      item.name = `Intersection ${n}`;
      const r = get("previewStage").getBoundingClientRect();
      Object.assign(item, sheets.toImage(r.left + r.width / 2, r.top + r.height / 2));
      (sheet.intersections ??= []).push(item);
      selected = item.id;
      selectedSheet = sheet;
      chosen = null;
      showPanel();
      commit();
      nameInput.focus();
      nameInput.select();
    };
    // New Roundabout: a single-lane, four-leg roundabout at the center of the view.
    get("newRoundabout").onclick = () => {
      const sheet = sheets.selected;
      if (!sheet?.inchesPerPixel) return;
      const item = RB.create();
      const names = new Set((sheet.intersections ?? []).map((x) => x.name));
      let n = 1;
      while (names.has(`Roundabout ${n}`)) n++;
      item.name = `Roundabout ${n}`;
      const r = get("previewStage").getBoundingClientRect();
      Object.assign(item, sheets.toImage(r.left + r.width / 2, r.top + r.height / 2));
      (sheet.intersections ??= []).push(item);
      selected = item.id;
      selectedSheet = sheet;
      chosen = null;
      showPanel();
      commit();
      nameInput.focus();
      nameInput.select();
    };
    get("editIntersection").onclick = () => current() && edit(current(), true);
    get("intersectionSheetAdd").onclick = addApproach;
    get("intersectionSheetDelete").onclick = () => remove();
    nameInput.onchange = () => {
      const name = nameInput.value.trim();
      if (!name) {
        nameInput.value = current()?.name ?? "";
        return;
      }
      change((item) => (item.name = name), false);
    };
    function remove() {
      const sheet = sheets.selected;
      if (!current() || !window.confirm(`Delete the intersection “${current().name}”? You can undo this.`))
        return;
      sheet.intersections = sheet.intersections.filter((x) => x.id !== selected);
      selected = null;
      commit();
    }
    get("deleteIntersection").onclick = remove;
    get("duplicateIntersection").onclick = () => {
      const item = current();
      if (!item) return;
      const copy = structuredClone(item);
      copy.id = G.id();
      copy.name = `${item.name} copy`;
      copy.x += 30 / sheets.selected.view.scale;
      copy.y += 30 / sheets.selected.view.scale;
      const map = new Map();
      for (const a of copy.approaches) {
        const old = a.id;
        a.id = G.id();
        map.set(old, a.id);
        delete a.binding;
        delete a.links;
        for (const s of a.splits ?? []) s.id = G.id();
        for (const key of ["inLanes", "outLanes"])
          a[key] = a[key].map((id) => {
            const next = G.id();
            map.set(id, next);
            if(a.laneDetails?.[id]){a.laneDetails[next]=a.laneDetails[id];delete a.laneDetails[id];}
            return next;
          });
      }
      for (const a of copy.approaches) {
        if (a.dest)
          a.dest = Object.fromEntries(Object.entries(a.dest).map(([lane, exits]) => [map.get(lane), exits.map((x) => map.get(x))]));
        if (a.entryGores)
          a.entryGores = Object.fromEntries(Object.entries(a.entryGores).map(([lane, width]) => [map.get(lane), width]));
        if (a.entryGoreTypes)
          a.entryGoreTypes = Object.fromEntries(Object.entries(a.entryGoreTypes).map(([lane, type]) => [map.get(lane), type]));
        if (a.entryGoreLengths)
          a.entryGoreLengths = Object.fromEntries(Object.entries(a.entryGoreLengths).map(([lane, length]) => [map.get(lane), length]));
      }
      for (const m of copy.movements) {
        m.id = G.id();
        m.from = map.get(m.from);
        m.to = map.get(m.to);
        m.input = map.get(m.input);
        m.output = map.get(m.output);
      }
      sheets.selected.intersections.push(copy);
      selected = copy.id;
      commit();
    };
    window.addEventListener(
      "keydown",
      (e) => {
        if (e.key === "Escape" && dragging) {
          e.preventDefault();
          e.stopImmediatePropagation();
          finishDrag(true);
          return;
        }
        if (!active() || e.target.closest?.("input,textarea,select") || e.target.dataset?.removable) return;
        // Escape steps out one level at a time: the movement, then the approach,
        // and only then the intersection (the panel closes as usual).
        if (e.key === "Escape" && current() && (chosenMovement || chosen)) {
          e.preventDefault();
          e.stopImmediatePropagation();
          if (chosenMovement) chosenMovement = null;
          else chosen = null;
          refresh();
          return;
        }
        if ((e.key === "Delete" || e.key === "Backspace") && current()) {
          e.preventDefault();
          if (chosenMovement) {
            current().movements = current().movements.filter((m) => m.id !== chosenMovement);
            chosenMovement = null;
            commit();
          } else remove();
        }
      },
      true,
    );
    const visibility = new MutationObserver(() => {
      if (!active() && dragging) finishDrag(true);
      refresh();
    });
    for (const e of [menu, panel]) visibility.observe(e, { attributes: true, attributeFilter: ["hidden"] });
    for (const event of ["sheetchange", "sheethistory"])
      document.addEventListener(event, () => {
        if (dragging) {
          if (event === "sheethistory") {
            dragging = null;
            snap = null;
          } else finishDrag(true);
        }
        refresh();
      });
    document.addEventListener("sheetview", refreshOverlay);
    window.addEventListener("resize", refreshOverlay);
    app.intersections = {
      selectedItem:()=>active()&&selected?{kind:"intersections",id:selected}:null,
      rotateGeometry:rotate,
      diagnostics: () => structuredClone({selected,chosen,inputLane,chosenMovement}),
      // For selection: an intersection's pavement outline (sheet pixels).
      outlineOf(sheet, item) {
        return outline(item, margin).map((p) => world(sheet, item, p));
      },
      // An intersection on free road ends (right-click Make Intersection): one
      // approach per end, each adopting that road's cross section.
      makeAt(sheet, point, joints, { combineDivided = false } = {}) {
        const ends = roads.intersectionEnds(sheet).filter((end) => joints.includes(end.joint));
        if (ends.length < 2) return null;
        const item = G.create();
        const names = new Set((sheet.intersections ?? []).map((x) => x.name));
        let n = 1;
        while (names.has(`Intersection ${n}`)) n++;
        Object.assign(item, { name: `Intersection ${n}`, x: point.x, y: point.y });
        item.approaches = ends.map((end) => {
          const a = G.approach(0);
          adopt(sheet, item, a, end);
          return a;
        });
        G.normalize(item);
        if(combineDivided) {
          // Separate one-way carriageways from a grouped crossing belong to
          // one divided approach. Their facing left edges define the median;
          // use explicit lane links rather than pairing the external roads.
          // Nearby mouths are aligned to their common approach during creation. The existing median renderer supplies
          // the rounded nose; grass is editable starting geometry.
          const used=new Set(),merged=[];
          for(const incoming of item.approaches) {
            if(used.has(incoming.id))continue;
            if(!incoming.incoming||incoming.outgoing){continue;}
            const {u,n}=G.axes(incoming);
            const candidates=item.approaches.filter(a=>!used.has(a.id)&&a.outgoing&&!a.incoming).map(a=>({a,
              gap:G.dot(G.sub(a,incoming),n),along:Math.abs(G.dot(G.sub(a,incoming),u)),
              parallel:G.dot(G.axes(a).u,u)}))
              // Hand-drawn divided roads are rarely mathematically parallel.
              // Allow up to 5 degrees and one lane width of mouth stagger;
              // choose the nearest facing carriageway, never a crossing arm.
              .filter(c=>c.gap>1&&c.gap<=200&&c.along<=Math.max(incoming.width,c.a.outWidth)&&c.parallel>=Math.cos(5*Math.PI/180)).sort((a,b)=>a.gap-b.gap);
            const match=candidates[0];if(!match)continue;
            const outgoing=match.a, direction=G.unit(G.add(u,G.axes(outgoing).u));
            const angle=G.degrees(Math.atan2(direction.y,direction.x)*180/Math.PI);
            const gap=G.dot(G.sub(outgoing,incoming),{x:-direction.y,y:direction.x});
            const a={...incoming,x:(incoming.x+outgoing.x)/2,y:(incoming.y+outgoing.y)/2,angle,
              outgoing:outgoing.outgoing,outWidth:outgoing.outWidth,outLanes:[...outgoing.outLanes],laneDetails:{...incoming.laneDetails,...outgoing.laneDetails},
              gap,median:Math.max(0,gap-10/12),surface:"grass"};
            // 10 inches is the double-yellow centerline spacing already used
            // by G.gap and road pairing (FDOT 711-001, double solid lines).
            a.links=[...incoming.inLanes.map((to,lane)=>({road:incoming.binding.road,e:1,lane,to})),
              ...outgoing.outLanes.map((to,lane)=>({road:outgoing.binding.road,e:0,lane,to}))];
            delete a.binding;
            used.add(incoming.id);used.add(outgoing.id);merged.push(a);
          }
          item.approaches=[...item.approaches.filter(a=>!used.has(a.id)),...merged];
          G.normalize(item);
        }
        for(const a of item.approaches)if(a.median>0){a.surface="grass";a.nose=initialMedianNose(item,a,a.median);}
        (sheet.intersections ??= []).push(item);
        selected = item.id;
        selectedSheet = sheet;
        chosen = null;
        return item;
      },
      // Gaps between two merging or diverging one-way approaches are gores
      // too, even when no external roads or lane joints exist at their tip.
      goreNotches(sheet) {
        const result=[];
        for(const item of sheet.intersections??[]) {
          if(round(item))continue;
          G.normalize(item);const ordered=G.ordered(item);
          for(const [i,a]of ordered.entries()) {
            const b=ordered[(i+1)%ordered.length];if(!notchPair(a,b))continue;
            const corner=G.corner(a,b);if(corner.points.length<3)continue;
            let index=0;
            corner.points.forEach((p,n)=>{if(G.length(G.sub(p,corner.center))<G.length(G.sub(corner.points[index],corner.center)))index=n;});
            if(!index||index===corner.points.length-1)continue;
            const approaches=[a.id,b.id].sort();
            result.push({key:`i:${item.id}:${approaches.join(':')}`,intersection:item.id,approaches,split:!a.incoming,
              e1:corner.points.slice(0,index+1).reverse().map(p=>world(sheet,item,p)),e2:corner.points.slice(index).map(p=>world(sheet,item,p))});
          }
        }
        return result;
      },
      // Marking centerlines continuing into a lane-linked approach. A branch
      // can share the road joint while the through lanes enter the intersection.
      goreContinuationEdges(sheet, binding, solved) {
        const result=[];
        for (const item of sheet.intersections??[]) {
          if (round(item)) continue;
          const matches=a=>[a.binding,...a.links??[]].some(link=>link?.road===binding.road && link.e===binding.e);
          if(!item.approaches.some(matches))continue;
          reconcile(sheet,item,solved);
          const ordered=G.ordered(item);
          for (const a of ordered) {
            if (!matches(a)) continue;
            const i=ordered.indexOf(a), previous=ordered[(i+ordered.length-1)%ordered.length], next=ordered[(i+1)%ordered.length];
            result.push(G.corner(a,next).points.map(p=>world(sheet,item,p)),
              G.corner(previous,a).points.slice().reverse().map(p=>world(sheet,item,p)));
          }
        }
        return result;
      },
      // Pavement edges and corners, plus the paved areas (each intersection's
      // outline, less its medians) for telling outer edges from buried ones.
      boundaries(sheet, solved) {
        const edges = [],
          corners = [],
          paved = [],
          holes = [];
        if (!sheet.inchesPerPixel) return { edges, corners, paved, holes };
        for (const item of sheet.intersections ?? []) {
          reconcile(sheet, item, solved);
          paved.push(outline(item, margin).map((p) => world(sheet, item, p)));
          if (round(item)) {
            // Curbs round each corner, the openings, and the islands' edges.
            const add = (points, approach, side) => {
              const edge = points.map((p) => world(sheet, item, p));
              edge.on = { intersection: item.id, approach, side };
              edges.push(edge);
              if (edge.length) corners.push({ ...edge[0], on: { ...edge.on, f: 0 } }, { ...edge.at(-1), on: { ...edge.on, f: 1 } });
            };
            for (const a of item.approaches) {
              add([G.edge(a, true, margin), G.edge(a, false, margin)], a.id, "mouth");
              add(RB.cornerPoints(item, a, margin), a.id, "corner");
            }
            for (const [i, surface] of RB.surfaces(item, margin).entries()) {
              if (surface.kind === "island") continue;
              holes.push(surface.points.map((p) => world(sheet, item, p)));
              add([...surface.points, surface.points[0]], surface.approach ?? item.approaches[0].id, `${surface.kind}-${surface.key ?? i}`);
            }
            continue;
          }
          for (const a of item.approaches) for (const median of G.medians(a)) holes.push(G.medianSurface(a,median,margin).map((p) => world(sheet, item, p)));
          const ordered = G.ordered(item);
          for (const a of item.approaches) {
            const b = ordered[(ordered.indexOf(a) + 1) % ordered.length];
            const sides = {
              mouth: [G.edge(a, true, margin), G.edge(a, false, margin)],
              corner: G.corner(a, b, margin).points,
            };
            if(notchPair(a,b)) {
              const corner=G.corner(a,b);
              if(corner.points.length>=3) {
                // The visible marking tip is an intentional snap target even
                // when the small pavement overhang surrounds an acute notch.
                const edge=corner.points.map(p=>world(sheet,item,p));
                edge.on={intersection:item.id,approach:a.id,side:'cornerLine'};edges.push(edge);
                const lengths=[0];for(let j=1;j<edge.length;j++)lengths.push(lengths[j-1]+G.length(G.sub(edge[j],edge[j-1])));
                let index=0;corner.points.forEach((p,j)=>{if(G.length(G.sub(p,corner.center))<G.length(G.sub(corner.points[index],corner.center)))index=j;});
                corners.push({...edge[index],tip:true,on:{...edge.on,tip:true,f:lengths[index]/(lengths.at(-1)||1)}});
              }
            }
            for (const median of G.medians(a)) sides[median.key] = G.medianSurface(a,median,margin);
            for (const [side, points] of Object.entries(sides)) {
              const edge = points.map((p) => world(sheet, item, p));
              edge.on = { intersection: item.id, approach: a.id, side };
              edges.push(edge);
              if (edge.length)
                corners.push(
                  { ...edge[0], on: { ...edge.on, f: 0 } },
                  { ...edge.at(-1), on: { ...edge.on, f: 1 } },
                );
            }
          }
        }
        return { edges, corners, paved, holes };
      },
      // Ground-level intersections; `slot(level)` gives the group for an elevated
      // one (null when its level is hidden), drawn later over lower levels.
      draw(sheet, layers, solved, only = (item) => (item.level ?? 1) === 1) {
        const cuts = solved?.crosswalkCuts ?? app.markings?.crosswalkCuts(sheet, solved) ?? [];
        for (const item of sheet.intersections ?? []) {
          if (!only(item)) continue;
          reconcile(sheet, item, solved);
          const convert = (p) => world(sheet, item, p);
          drawPavement(item, layers.pavement, convert);
          drawMarkings(item, layers.markings, convert, cuts);
          roads.drawIntersectionGores(sheet,item,layers,solved,cuts);
        }
      },
      drawElevated(sheet, slot, solved) {
        const cuts = solved?.crosswalkCuts ?? app.markings?.crosswalkCuts(sheet, solved) ?? [];
        for (const item of sheet.intersections ?? []) {
          const level = item.level ?? 1, parent = level > 1 && slot(level);
          if (!parent) continue;
          reconcile(sheet, item, solved);
          const convert = (p) => world(sheet, item, p);
          drawPavement(item, parent, convert, roads.medianStyle.concrete);
          drawMarkings(item, parent, convert, cuts);
          roads.drawIntersectionGores(sheet,item,{pavement:parent,markings:parent,selection:parent},solved,cuts);
        }
      },
      refreshOverlay,
      // Double-clicking an intersection's pavement opens it in the panel.
      focusAt(point) {
        const sheet = sheets.selected;
        const item = [...(sheet?.intersections ?? [])].reverse().find((x) => G.contains(local(sheet, x, point), outline(x)));
        if (!item) return false;
        edit(item);
        return true;
      },
      // Simulator consumes exactly the editor's legal movements, in canonical
      // traffic direction. Roundabout paths determine their physical exit lane;
      // never fan a destination out into every outgoing lane.
      simulatorNetwork(sheet) {
        const ports = [], movements = [], solved = roads.solve(sheet);
        for (const item of sheet.intersections ?? []) {
          const links = new Map();
          for (const a of item.approaches) {
            for (const link of a.links ?? []) {
              const ids = link.e ? a.inLanes : a.outLanes;
              if (ids?.includes(link.to)) {
                const list = links.get(link.to) ?? [];
                list.push({ road: link.road, lane: link.lane, e: link.e }); links.set(link.to, list);
              }
            }
            if (a.binding) {
              const end = roads.intersectionEnd(sheet, a.binding);
              for (const ref of end?.ends ?? []) {
                const road = sheet.roads.find(r => r.id === ref.road), ids = ref.e ? a.inLanes : a.outLanes;
                for (let lane = 0; lane < Math.min(road.lanes, ids.length); lane++) {
                  const list = links.get(ids[lane]) ?? [];
                  list.push({ ...ref, lane }); links.set(ids[lane], list);
                }
              }
            }
          }
          // A lane link aligns the whole road end. Include its other free lanes
          // only where they actually meet this same approach's lane mouths.
          // Never infer connectivity merely from nearby, unconnected pavement.
          for (const a of item.approaches) {
            const attached = new Map((a.links ?? []).map(link => [`${link.road}:${link.e}`, link]));
            for (const ref of attached.values()) {
              const road = sheet.roads.find(road => road.id === ref.road);
              const end = roads.intersectionEnd(sheet, ref, solved), ids = ref.e ? a.inLanes : a.outLanes;
              if (!road || !end) continue;
              for (let lane = 0; lane < road.lanes; lane++) {
                if (!end.freeLanes[lane] || [...links.values()].some(list => list.some(link => link.road === ref.road && link.e === ref.e && link.lane === lane))) continue;
                const point = roads.lanePoint(sheet, road, ref.e, lane, solved);
                for (let j = 0; j < ids.length; j++) {
                  const pose = mouthPose(item, a, Boolean(ref.e), j), target = world(sheet, item, pose.p);
                  const angle = ((end.angle - pose.angle + 540) % 360) - 180;
                  if (Math.abs(angle) > .1 || Math.hypot(point.x - target.x, point.y - target.y) > scale(sheet) / 12) continue;
                  const list = links.get(ids[j]) ?? [];
                  list.push({ road: ref.road, e: ref.e, lane }); links.set(ids[j], list); break;
                }
              }
            }
          }
          for (const [lane, ends] of links) ports.push({ intersection: item.id, lane, ends });
          const add = (input, output, points) => {
            if (points?.length > 1 && points.every(p => Number.isFinite(p.x) && Number.isFinite(p.y)))
            {
              const a = item.approaches.find(a => a.inLanes.includes(input)), b = item.approaches.find(a => a.outLanes.includes(output));
              if (!a || !b) return;
              const start = G.width(a, true, a.inLanes.indexOf(input)), end = G.width(b, false, b.outLanes.indexOf(output));
              const ringWidth = round(item) ? Math.min(start, end, ...RB.layout(item).widths) : null;
              const lengths = [0];
              for (let i = 1; i < points.length; i++) lengths.push(lengths.at(-1) + G.length(G.sub(points[i], points[i - 1])));
              movements.push({ intersection: item.id, input, output, points: points.map((p, i) => ({ ...world(sheet, item, p),
                laneWidth: (ringWidth ?? start + (end - start) * lengths[i] / (lengths.at(-1) || 1)) * scale(sheet),
              })) });
            }
          };
          if (round(item)) {
            for (const a of item.approaches) for (let j = 0; j < a.incoming; j++) {
              if (["bike", "bufferedBike", "twoWayBike"].includes(a.laneDetails?.[a.inLanes[j]]?.type)) continue;
              for (const destination of RB.destinations(item, a, a.inLanes[j])) {
                const b = item.approaches.find(b => b.id === destination);
                if (!b?.outgoing) continue;
                const points = RB.path(item, a, j, b);
                const last = points.at(-1);
                let index = -1, distance = 0.01;
                for (let k = 0; k < b.outgoing; k++) {
                  const p = RB.approachLane(item, b, false, k).p, d = Math.hypot(p.x - last.x, p.y - last.y);
                  if (d < distance) { distance = d; index = k; }
                }
                if (index >= 0) add(a.inLanes[j], b.outLanes[index], points);
              }
            }
          } else {
            const paths = movementRoutes(item);
            for (const m of item.movements ?? []) add(m.input, m.output, paths.get(m.id));
          }
        }
        return { ports, movements };
      },
      // Both edges of every movement's path through the intersection, for lane
      // lines that continue through it (sheet pixels, in the direction of travel).
      // A movement's width runs from its incoming lane's to its outgoing lane's.
      lineTargets(sheet, solved) {
        const targets = [];
        for (const item of sheet.intersections ?? []) {
          reconcile(sheet, item, solved);
          if (round(item)) {
            for (const track of RB.tracks(item)) {
              for (let k = 0; k <= track.ids.length; k++) {
                const points = track.line.map((p, i) => {
                  const last = track.line.length - 1;
                  const prev = track.line[track.circulatory && i === 0 ? last - 1 : Math.max(0, i - 1)];
                  const next = track.line[track.circulatory && i === last ? 1 : Math.min(last, i + 1)];
                  const tangent = G.unit(G.sub(next, prev)), right = { x: -tangent.y, y: tangent.x };
                  const offset = k === track.ids.length ? track.bounds[i][k - 1][1] : track.bounds[i][k][0];
                  return world(sheet, item, G.add(p, G.mul(right, offset)));
                });
                const on = { intersection: item.id, roundabout: true, approach: track.approach.id, incoming: track.incoming, k };
                targets.push({ key: app.longitudinal.keyOf(on), points, on });
              }
            }
            continue;
          }
          const paths = movementRoutes(item);
          for (const m of item.movements) {
            const route = paths.get(m.id),
              a = item.approaches.find((x) => x.id === m.from),
              b = item.approaches.find((x) => x.id === m.to);
            if (!route || route.length < 2 || !a || !b) continue;
            const along = [0];
            for (let i = 1; i < route.length; i++) along.push(along[i - 1] + G.length(G.sub(route[i], route[i - 1])));
            const total = along.at(-1) || 1;
            const startShift=a.laneDetails?.[m.input]?.centerShift??0,endShift=b.laneDetails?.[m.output]?.centerShift??0;
            for (const side of ["L", "R"]) {
              const points = route.map((p, i) => {
                const prev = route[Math.max(0, i - 1)],
                  next = route[Math.min(route.length - 1, i + 1)],
                  t = G.unit(G.sub(next, prev)),
                  half = (G.width(a, true,a.inLanes.indexOf(m.input)) + (G.width(b, false,b.outLanes.indexOf(m.output)) - G.width(a, true,a.inLanes.indexOf(m.input))) * (along[i] / total)) / 2 +
                    (side==="R"?-1:1)*(startShift+(endShift-startShift)*(along[i]/total)),
                  // Right of travel on the sheet (y down) is (-t.y, t.x).
                  n = side === "R" ? { x: -t.y, y: t.x } : { x: t.y, y: -t.x };
                return world(sheet, item, G.add(p, G.mul(n, half)));
              });
              targets.push({ key: `m:${item.id}:${m.id}:${side}`, points, on: { intersection: item.id, movement: m.id, side } });
            }
          }
        }
        return targets;
      },
      // Each approach direction's lanes follow its curve from where traffic
      // enters it to where it leaves (incoming: mouth to throat; outgoing: throat
      // to mouth), with lane edges in sheet pixels right of travel.
      laneTracks(sheet) {
        const tracks = [];
        for (const item of sheet.intersections ?? []) {
          normalize(item);
          if (round(item)) {
            // Roundabout approach lanes follow the splitter island's curve.
            const k = scale(sheet);
            for (const t of RB.tracks(item))
              tracks.push({
                key: `i:${item.id}:${t.approach.id}:${t.incoming ? "in" : "out"}`,
                on: { intersection: item.id, approach: t.approach.id, incoming: t.incoming },
                lanes: t.ids,
                laneDetails: t.ids.map((id) => t.approach.laneDetails?.[id] ?? {}),
                bikeLanes: t.ids.map((id) => ["bike", "bufferedBike", "twoWayBike"].includes(t.approach.laneDetails?.[id]?.type)),
                paintedGoreBoundaries: t.paintedGoreBoundaries,
                markingLaneEdges: t.markingLaneEdges?.map(edges => edges.map(points => points.map(p => world(sheet, item, p)))),
                line: t.line.map((p) => world(sheet, item, p)),
                bounds: t.bounds.map((lanes) => lanes.map(([l, r]) => [l * k, r * k])),
              });
            continue;
          }
          for (const a of item.approaches) {
            const u = G.axes({angle:a.approachCurve?.axis??a.angle}).u,
              length = Math.max(1, G.dot(a, u) - G.throat(item, a)),
              k = scale(sheet);
            for (const incoming of [true, false]) {
              const ids = incoming ? a.inLanes : a.outLanes;
              if (!ids?.length) continue;
              const edges = ids.map((_, j) => {
                const left = incoming ? -G.boundary(a, true, j) : G.boundary(a, false, j);
                return [left * k, (left + G.width(a,incoming,j)) * k];
              });
              const ends = G.approachLine(a,0,incoming?0:-length,incoming?-length:0).map(p=>({...world(sheet,item,p),tangent:p.tangent}));
              tracks.push({
                key: `i:${item.id}:${a.id}:${incoming ? "in" : "out"}`,
                on: { intersection: item.id, approach: a.id, incoming },
                lanes: ids,
                laneDetails:ids.map(id=>a.laneDetails?.[id]??{}),
                bikeLanes:ids.map(id=>["bike","bufferedBike","twoWayBike"].includes(a.laneDetails?.[id]?.type)),
                paintedGoreBoundaries: ids.map((_, j) => (a.splits ?? []).some(split => split.incoming === incoming && split.after === j && split.surface === "painted")),
                line: ends,
                bounds: ends.map(()=>edges),
              });
            }
          }
        }
        return tracks;
      },
      alignLinks(sheet) {
        for (const item of sheet.intersections ?? []) {
          if (dragging?.item === item) continue;
          prepareIndependentMouths(sheet, item);
          reconcile(sheet, item);
          for (const a of item.approaches) for (const link of a.links ?? []) {
            const j = laneOf(a, link);
            if (j >= 0) {
              const pose = mouthPose(item, a, link.e === 1, j);
              roads.alignLaneEnd(sheet, link, link.lane, world(sheet, item, pose.p), pose.angle);
            }
          }
          separateMedianRoads(sheet,item);
        }
      },
      releaseRoad(sheet, road, e) {
        for (const item of sheet.intersections ?? [])
          for (const a of item.approaches) {
            if (!a.binding) continue;
            const end = roads.intersectionEnd(sheet, a.binding);
            if (end?.ends.some((b) => b.road === road && b.e === e)) delete a.binding;
          }
        app.intersections.releaseLanes(sheet, road, e);
      },
      // A dragged road lane snaps to the mouth of any free approach lane going its
      // way; dropping it links the two lanes. The approach keeps its own size.
      laneAt(sheet, binding, point) {
        if (!sheet.inchesPerPixel) return null;
        const end = binding.road == null ? null : roads.intersectionEnd(sheet, binding);
        if (binding.road != null && (!end?.freeLanes[binding.lane ?? 0] || occupied(sheet, end.joint, null, binding))) return null;
        let best = null,
          distance = Infinity;
        for (const item of sheet.intersections ?? [])
          for (const a of item.approaches) {
            if (a.binding) continue;
            const incoming = binding.e === 1,
              lanes = incoming ? a.inLanes : a.outLanes,
              reach = Math.max(((incoming ? a.width : a.outWidth) / 2) * scale(sheet), 16 / sheet.view.scale);
            for (const [j, id] of lanes.entries()) {
              if (a.links?.some((link) => link.to === id && !sameEnd(link, binding))) continue;
              const pose = mouthPose(item, a, incoming, j), at = world(sheet, item, pose.p),
                d = G.length(G.sub(point, at));
              if (d <= reach && d < distance) {
                distance = d;
                best = { intersection: item.id, approach: a.id, to: id, point: at, angle: pose.angle };
              }
            }
          }
        return best;
      },
      linkLane(sheet, target, binding, lane) {
        const item = sheet.intersections?.find((x) => x.id === target.intersection),
          a = item?.approaches.find((a) => a.id === target.approach);
        if (!a || a.binding) return false;
        if (!roads.intersectionEnd(sheet, binding)?.freeLanes[lane]) return false;
        app.intersections.releaseLanes(sheet, binding.road, binding.e);
        (a.links ??= []).push({ road: binding.road, e: binding.e, lane, to: target.to });
        moveBindings(sheet, item);
        return true;
      },
      releaseLanes(sheet, road, e) {
        for (const item of sheet.intersections ?? [])
          for (const a of item.approaches) {
            if (!a.links) continue;
            a.links = a.links.filter((link) => link.road !== road || link.e !== e);
            if (!a.links.length) delete a.links;
            for (const link of a.links ?? []) {
              const end = roads.intersectionEnd(sheet, link), detail = (link.e ? end?.inDetails : end?.outDetails)?.[link.lane];
              if (detail) (a.laneDetails ??= {})[link.to] = { ...detail };
            }
          }
      },
      rehomeRoad(sheet, from, e, to, f) {
        for (const item of sheet.intersections ?? [])
          for (const a of item.approaches) {
            if (a.binding?.road === from && a.binding.e === e) a.binding = { ...a.binding, road: to, e: f };
            for (const link of a.links ?? [])
              if (link.road === from && link.e === e) Object.assign(link, { road: to, e: f });
          }
      },
    };
    refresh();
    roads.render();
  });
})();
