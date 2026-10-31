/* Intersection editor. UI conventions are reused from SignalMaker (GPL-3.0).
   Intersections are created and edited on the sheet with a side panel.
   Pavement is exportable SVG; movement guides and controls are screen overlays. */
(() => {
  const SVG = "http://www.w3.org/2000/svg";
  document.addEventListener("DOMContentLoaded", () => {
    const app = window.StripeMaker,
      G = app.intersectionGeometry,
      sheets = app.sheets,
      roads = app.roadEditor;
    const get = (id) => document.getElementById(id);
    const menu = get("intersectionsEditor"),
      status = get("intersectionStatus");
    const panel = get("intersectionEditor"),
      fields = get("intersectionSheetFields"),
      panelMessage = get("intersectionSheetMessage"),
      nameInput = get("intersectionSheetName");
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
      G.normalize(item);
      const error = G.validate(item);
      if (error) {
        for (const key of Object.keys(item)) delete item[key];
        Object.assign(item, before);
        tell(error);
      } else {
        tell("");
        moveBindings(sheets.selected, item);
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
        const m = item.movements.find((m) => m.input === inputLane && m.output === output);
        if (m) {
          item.movements = item.movements.filter((x) => x !== m);
          chosenMovement = null;
        } else {
          const made = G.movement(a, a.inLanes.indexOf(inputLane), b, b.outLanes.indexOf(output));
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
        const a = G.approach(G.degrees(angle));
        const reach = Math.max(G.REACH, ...item.approaches.map(G.length));
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
    function addMedian(approachId, where) {
      change((item) => {
        const a = item.approaches.find((a) => a.id === approachId);
        if (!a || a.binding) return;
        if (where === "center") {
          a.median = NEW_MEDIAN_FEET;
          delete a.gap;
        } else
          (a.splits ??= []).push({
            id: G.id(),
            incoming: where.incoming,
            after: where.after,
            width: NEW_MEDIAN_FEET,
            nose: 50,
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
      field(
        "Angle (°)",
        G.degrees(a.angle),
        (v) =>
          change(() => {
            const delta = ((v - a.angle) * Math.PI) / 180,
              c = Math.cos(delta),
              s = Math.sin(delta);
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
        ["incoming", "Incoming lanes"],
        ["outgoing", "Outgoing lanes"],
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
        "Incoming width (ft)",
        a.width,
        (v) =>
          change(() => {
            a.width = v;
          }),
        { min: 8, max: 20, step: 0.5, disabled: bound },
      );
      field("Outgoing width (ft)", a.outWidth, v => change(() => { a.outWidth = v; }), { min: 8, max: 20, step: 0.5, disabled: bound });
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
    function renderMedians(a, bound) {
      heading("Medians");
      hint(
        bound
          ? "The center median follows the connected road."
          : "Click a + at the approach opening to add a median between those lanes. Drag a median's edge to widen it, or to zero to remove it; drag its nose to lengthen it.",
      );
      const surface = (value, set, key) =>
        field("Surface", value, set, {
          key,
          choices: [
            ["grass", "Grass"],
            ["concrete", "Concrete"],
          ],
        });
      if (a.incoming && a.outgoing) {
        field(
          "Center median (ft)",
          a.median,
          (v) =>
            change(() => {
              a.median = v;
              delete a.gap;
            }),
          { key: "median", max: 200, step: 0.5, disabled: bound },
        );
        if (a.median > 0) {
          surface(a.surface, (v) => change(() => (a.surface = v)), "median-surface");
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
          button("Remove Median", () => removeSplit(a.id, s.id), group);
        }
      const free = bound ? [] : freeBoundaries(a);
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
      if (!a.incoming) {
        const p = document.createElement("p");
        p.textContent = "This approach has outgoing lanes only.";
        fields.append(p);
        return;
      }
      if (!a.inLanes.includes(inputLane)) inputLane = a.inLanes[0];
      field("Incoming lane", inputLane, (v) => chooseInput(a, v), {
        key: "input-lane",
        choices: a.inLanes.map((id, i) => [id, `Lane ${i + 1} (from median outward)`]),
      });
      const destinations = document.createElement("fieldset"),
        legend = document.createElement("legend");
      legend.textContent = "Outgoing lanes";
      destinations.append(legend);
      fields.append(destinations);
      for (const b of item.approaches)
        for (const [j, id] of b.outLanes.entries()) {
          const row = document.createElement("label");
          row.className = "intersectionDestination";
          const box = document.createElement("input");
          box.type = "checkbox";
          box.checked = item.movements.some((m) => m.input === inputLane && m.output === id);
          box.onchange = () => toggleMovement(b, id);
          row.append(
            box,
            `Approach ${item.approaches.indexOf(b) + 1} · Lane ${j + 1}${a === b ? " (U-turn)" : ""}`,
          );
          destinations.append(row);
        }
      const movements = item.movements.filter((m) => m.input === inputLane);
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
              const b = item.approaches.find((a) => a.id === m.to);
              return [
                m.id,
                `To approach ${item.approaches.indexOf(b) + 1}, lane ${b.outLanes.indexOf(m.output) + 1}`,
              ];
            }),
          ],
        },
      );
      const m = movements.find((m) => m.id === chosenMovement);
      if (!m) return;
      for (const [key, label] of [
        ["pullIn", "Entry pull (ft)"],
        ["pullOut", "Exit pull (ft)"],
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
      svg("path", concrete ? { d: path(G.outline(item, margin).map(convert)), fill: concrete, stroke: concrete, "stroke-width": 1.5 }
        : { d: path(G.outline(item, margin).map(convert)), class: "roadBand" }, parent);
      for (const a of item.approaches)
        for (const median of G.medians(a)) {
          const d = path(median.points.map(convert));
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
    function drawMarkings(item, parent, convert) {
      const style = roads.markingStyle;
      const width = G.length(G.sub(convert({ x: style.lineFeet, y: 0 }), convert({ x: 0, y: 0 })));
      const stroke = (points, color) =>
        svg(
          "path",
          {
            d: line(points.map(convert)),
            class: "roadMarking",
            fill: "none",
            stroke: color,
            "stroke-width": width,
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
      const around = (a, center, half, nose, ring) => {
        const tip = G.reach(a, half, nose) - half,
          points = [G.local(a, center - ring), G.local(a, center - ring, -tip)];
        for (let i = 0; i <= 24; i++) {
          const t = (Math.PI * i) / 24;
          points.push(G.local(a, center - Math.cos(t) * ring, -tip - Math.sin(t) * ring));
        }
        points.push(G.local(a, center + ring));
        return points;
      };
      for (const a of item.approaches) {
        if (a.incoming && a.outgoing) {
          if (a.median > 0) stroke(around(a, 0, a.median / 2, a.nose, G.gap(a) / 2), style.yellow);
          else {
            const reach = G.dot(a, G.axes(a).u) - G.throat(item, a);
            if (reach > 0)
              for (const side of [-1, 1])
                stroke(
                  [G.local(a, (side * G.gap(a)) / 2), G.local(a, (side * G.gap(a)) / 2, -reach)],
                  style.yellow,
                );
          }
        }
        for (const incoming of [true, false])
          for (const s of G.splits(a, incoming))
            stroke(around(a, G.splitCenter(a, s), s.width / 2, s.nose, s.width / 2), style.white);
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
      const paths = movementRoutes(item);
      for (const m of item.movements) {
        if (!G.curve(item, m)) continue;
        const route = paths.get(m.id) ?? [];
        const points = (arrows ? trim(route, ARROW_FEET) : route).map(convert);
        const focused = selected === item.id && m.id === chosenMovement;
        const color = approachColor(item, m.from);
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
            "aria-label": `Movement from approach ${item.approaches.findIndex((a) => a.id === m.from) + 1} to approach ${item.approaches.findIndex((a) => a.id === m.to) + 1}`,
            "data-key": `connection-${m.id}`,
          },
          guides,
        );
        const choose = () => {
          if (selected !== item.id) select(item.id);
          chosen = m.from;
          inputLane = m.input;
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
          for (const [j, id] of lanes.entries()) {
            const p = G.lane(a, incoming, j),
              u = G.axes(a).u,
              q = G.sub(p, G.mul(u, ARROW_FEET));
            const picked = incoming && id === inputLane;
            // The lane's drag strip shows only while a movement is dragged from
            // its incoming lane to an outgoing lane.
            const linking = dragging?.type === "link" && dragging.item === item;
            if (linking && (incoming ? id === dragging.input : id === dragging.target?.output))
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
            const at = G.sub(p, G.mul(u, 9)),
              direction = G.mul(u, incoming ? -1 : 1),
              right = { x: -direction.y, y: direction.x };
            const types = new Set(
              incoming
                ? item.movements
                    .filter((m) => m.input === id)
                    .map((m) => {
                      const b = item.approaches.find((b) => b.id === m.to);
                      if (b === a) return "u";
                      const turn = G.degrees(b.angle - a.angle - 180);
                      return turn < 45 || turn > 315 ? "through" : turn > 180 ? "left" : "right";
                    })
                : ["through"],
            );
            if (incoming && !types.size) {
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
                "aria-label": `${incoming ? "Incoming" : "Outgoing"} lane ${j + 1}, approach ${i + 1}`,
                "data-key": `lane-${id}`,
              },
              parent,
            );
            if (dragging?.type === "link" && dragging.target?.output === id) hit.classList.add("dropTarget");
            // An outgoing arrow only takes presses as the selected movement's end,
            // so the pavement around it still drags the intersection.
            if (!incoming && !item.movements.some((m) => m.id === chosenMovement && m.output === id))
              hit.style.pointerEvents = "none";
            hit.onpointerdown = (event) => {
              if (event.button !== 0) return;
              event.preventDefault();
              event.stopPropagation();
              const existing =
                !incoming && item.movements.find((m) => m.id === chosenMovement && m.output === id);
              if (!incoming && !existing) return;
              chosen = incoming ? a.id : existing.from;
              inputLane = incoming ? id : existing.input;
              startDrag(event, { type: "link", approach: chosen, input: inputLane, replace: existing?.id });
              renderFields();
              refreshOverlay();
            };
            hit.onkeydown = (event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              incoming ? chooseInput(a, id) : toggleMovement(a, id);
            };
          }
        }
        const label = G.local(a, 0, 18);
        const text = svg(
          "text",
          { x: label.x, y: label.y, "text-anchor": "middle", class: "intersectionApproachLabel" },
          parent,
        );
        text.textContent = i + 1;
      }
    }
    function drawLinkPreview(item, convert) {
      if (dragging?.type !== "link" || dragging.item !== item || !dragging.cursor) return;
      const parent = feetGroup(convert);
      const a = item.approaches.find((a) => a.id === dragging.approach),
        p = G.lane(a, true, a.inLanes.indexOf(dragging.input));
      let points = [p, dragging.cursor];
      if (dragging.target) {
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
      const ordered = G.ordered(item);
      for (const [i, a] of item.approaches.entries()) {
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
              convert(G.local(a, ((incoming ? -1 : 1) * a.median) / 2)),
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
              convert(G.local(a, outer)),
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
        if (!a.binding)
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
      }
      item.rotation = G.degrees(item.rotation + degrees);
    }
    // A road's cross section has no lane-splitting medians, so adopting one
    // drops them.
    function adopt(sheet, item, a, end) {
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
      G.normalize(item);
    }
    function reconcile(sheet, item, solved) {
      G.normalize(item);
      if (dragging?.item === item) return;
      for (const a of item.approaches) {
        if (!a.binding) continue;
        const end = roads.intersectionEnd(sheet, a.binding, solved);
        if (!end?.terminal) {
          delete a.binding;
          continue;
        }
        adopt(sheet, item, a, end);
      }
      for (const a of item.approaches) {
        if (!a.links) continue;
        a.links = a.links.filter((link) => {
          const end = roads.intersectionEnd(sheet, link, solved);
          return end?.terminal && !a.binding && laneOf(a, link) >= 0 && link.lane < roadLanes(sheet, link);
        });
        if (!a.links.length) delete a.links;
      }
    }
    // Lane links pin one lane of a road end to one lane of an approach without
    // changing the approach: { road, e, lane (road lane index), to (approach lane id) }.
    // A road end arriving at the intersection (e = 1) feeds an incoming lane.
    const laneOf = (a, link) => (link.e ? a.inLanes : a.outLanes).indexOf(link.to);
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
    function moveBindings(sheet, item) {
      const seen = new Set();
      for (const a of item.approaches) {
        if (!a.binding) continue;
        const end = roads.intersectionEnd(sheet, a.binding);
        if (!end || seen.has(end.joint)) continue;
        seen.add(end.joint);
        roads.moveIntersectionEnd(sheet, a.binding, world(sheet, item, a), a.angle);
      }
      for (const a of item.approaches)
        for (const link of a.links ?? []) {
          const j = laneOf(a, link);
          if (j >= 0)
            roads.alignLaneEnd(
              sheet,
              link,
              link.lane,
              world(sheet, item, G.lane(a, link.e === 1, j)),
              a.angle,
            );
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
        before: structuredClone(item),
        saved: snapshot(sheet),
        sheet,
        alt: event.altKey,
        slide: event.shiftKey,
        focusKey: event.target.dataset?.key,
        changed: false,
      };
      if (info.approach) {
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
          for (const [i, output] of a.outLanes.entries()) {
            const p = G.lane(a, false, i),
              v = G.sub(point, p),
              axes = G.axes(a);
            if (
              Math.abs(G.dot(v, axes.n)) <= G.width(a, false) / 2 &&
              G.dot(v, axes.u) <= 8 &&
              G.dot(v, axes.u) >= -35
            )
              d.target = { approach: a.id, output };
          }
        const exists =
          d.target &&
          !d.replace &&
          item.movements.some((m) => m.input === d.input && m.output === d.target.output);
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
      } else if (d.type === "mouth") {
        if (!old.binding || d.alt) {
          Object.assign(a, structuredClone(old));
          delete a.binding;
        }
        const edge = G.edge(old, d.incoming, margin),
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
          const offset = G.mul(G.axes(a).n, G.side(a, d.incoming, margin));
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
        if (a.binding) {
          tell("Detach the approach to change its median width.");
          return;
        }
        const oldEdge = G.local(old, ((d.incoming ? -1 : 1) * old.median) / 2),
          wanted = G.add(oldEdge, delta);
        a.median = G.clamp(2 * Math.abs(G.dot(G.sub(wanted, a), G.axes(a).n)), 0, 200);
        delete a.gap;
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
            outer = inner + (oldS.incoming ? -1 : 1) * oldS.width,
            wanted = outer + G.dot(delta, G.axes(a).n);
          s.width = G.clamp((oldS.incoming ? -1 : 1) * (wanted - inner), 0, 100);
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
      const error = G.validate(item);
      if (error) {
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
    function finishDrag(cancel = false) {
      const d = dragging;
      if (!d) return;
      dragging = null;
      snap = null;
      if (!cancel && d.type === "link" && d.changed && d.target) {
        const a = d.item.approaches.find((a) => a.id === d.approach),
          b = d.item.approaches.find((a) => a.id === d.target.approach);
        const existing = d.item.movements.find((m) => m.input === d.input && m.output === d.target.output);
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
          const made = G.movement(a, a.inLanes.indexOf(d.input), b, b.outLanes.indexOf(d.target.output));
          d.item.movements.push(made);
          chosenMovement = made.id;
        }
      }
      // A split median dragged down to (nearly) nothing is removed.
      if (!cancel && d.type === "split") {
        const a = d.item.approaches.find((a) => a.id === d.approach);
        a.splits = a.splits.filter((s) => s.width >= 0.5);
        G.normalize(d.item);
        moveBindings(d.sheet, d.item);
      }
      if (cancel) Object.assign(d.sheet, d.saved);
      roads.render();
      if (!cancel && d.changed) commit();
      else refresh();
      restoreFocus(d.focusKey);
    }
    guides.addEventListener("click", (event) => event.stopPropagation());
    guides.addEventListener("pointermove", (e) => {
      if (!dragging || !guides.hasPointerCapture(e.pointerId)) return;
      applyDrag(local(dragging.sheet, dragging.before, sheets.toImage(e.clientX, e.clientY)));
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
        before: structuredClone(item),
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
            d: path(G.outline(item, margin).map(convert)),
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
        svg("path", { d: path(G.outline(item, margin).map(convert)), class: "intersectionOutline" }, guides);
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
            ? chosenMovement
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
            return next;
          });
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
      // For selection: an intersection's pavement outline (sheet pixels).
      outlineOf(sheet, item) {
        return G.outline(item, margin).map((p) => world(sheet, item, p));
      },
      // An intersection on free road ends (right-click Make Intersection): one
      // approach per end, each adopting that road's cross section.
      makeAt(sheet, point, joints) {
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
        (sheet.intersections ??= []).push(item);
        selected = item.id;
        selectedSheet = sheet;
        chosen = null;
        return item;
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
          paved.push(G.outline(item, margin).map((p) => world(sheet, item, p)));
          for (const a of item.approaches) for (const median of G.medians(a)) holes.push(median.points.map((p) => world(sheet, item, p)));
          const ordered = G.ordered(item);
          for (const a of item.approaches) {
            const b = ordered[(ordered.indexOf(a) + 1) % ordered.length];
            const sides = {
              mouth: [G.edge(a, true, margin), G.edge(a, false, margin)],
              corner: G.corner(a, b, margin).points,
            };
            for (const median of G.medians(a)) sides[median.key] = median.points;
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
        for (const item of sheet.intersections ?? []) {
          if (!only(item)) continue;
          reconcile(sheet, item, solved);
          const convert = (p) => world(sheet, item, p);
          drawPavement(item, layers.pavement, convert);
          drawMarkings(item, layers.markings, convert);
        }
      },
      drawElevated(sheet, slot, solved) {
        for (const item of sheet.intersections ?? []) {
          const level = item.level ?? 1, parent = level > 1 && slot(level);
          if (!parent) continue;
          reconcile(sheet, item, solved);
          const convert = (p) => world(sheet, item, p);
          drawPavement(item, parent, convert, roads.medianStyle.concrete);
          drawMarkings(item, parent, convert);
        }
      },
      refreshOverlay,
      // Double-clicking an intersection's pavement opens it in the panel.
      focusAt(point) {
        const sheet = sheets.selected;
        const item = [...(sheet?.intersections ?? [])].reverse().find((x) => G.contains(local(sheet, x, point), G.outline(x)));
        if (!item) return false;
        edit(item);
        return true;
      },
      // Both edges of every movement's path through the intersection, for lane
      // lines that continue through it (sheet pixels, in the direction of travel).
      // A movement's width runs from its incoming lane's to its outgoing lane's.
      lineTargets(sheet, solved) {
        const targets = [];
        for (const item of sheet.intersections ?? []) {
          reconcile(sheet, item, solved);
          const paths = movementRoutes(item);
          for (const m of item.movements) {
            const route = paths.get(m.id),
              a = item.approaches.find((x) => x.id === m.from),
              b = item.approaches.find((x) => x.id === m.to);
            if (!route || route.length < 2 || !a || !b) continue;
            const along = [0];
            for (let i = 1; i < route.length; i++) along.push(along[i - 1] + G.length(G.sub(route[i], route[i - 1])));
            const total = along.at(-1) || 1;
            for (const side of ["L", "R"]) {
              const points = route.map((p, i) => {
                const prev = route[Math.max(0, i - 1)],
                  next = route[Math.min(route.length - 1, i + 1)],
                  t = G.unit(G.sub(next, prev)),
                  half = (G.width(a, true) + (G.width(b, false) - G.width(a, true)) * (along[i] / total)) / 2,
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
      // Each approach direction's lanes as a straight track from where traffic
      // enters it to where it leaves (incoming: mouth to throat; outgoing: throat
      // to mouth), with lane edges in sheet pixels right of travel.
      laneTracks(sheet) {
        const tracks = [];
        for (const item of sheet.intersections ?? []) {
          G.normalize(item);
          for (const a of item.approaches) {
            const u = G.axes(a).u,
              length = Math.max(1, G.dot(a, u) - G.throat(item, a)),
              k = scale(sheet);
            for (const incoming of [true, false]) {
              const ids = incoming ? a.inLanes : a.outLanes;
              if (!ids?.length) continue;
              const width = G.width(a, incoming);
              const edges = ids.map((_, j) => {
                const left = incoming ? -G.boundary(a, true, j) : G.boundary(a, false, j);
                return [left * k, (left + width) * k];
              });
              const ends = [world(sheet, item, G.local(a, 0, 0)), world(sheet, item, G.local(a, 0, -length))];
              tracks.push({
                key: `i:${item.id}:${a.id}:${incoming ? "in" : "out"}`,
                on: { intersection: item.id, approach: a.id, incoming },
                lanes: ids,
                line: incoming ? ends : ends.reverse(),
                bounds: [edges, edges],
              });
            }
          }
        }
        return tracks;
      },
      alignLinks(sheet) {
        for (const item of sheet.intersections ?? []) {
          if (dragging?.item === item) continue;
          reconcile(sheet, item);
          for (const a of item.approaches) for (const link of a.links ?? []) {
            const j = laneOf(a, link);
            if (j >= 0) roads.alignLaneEnd(sheet, link, link.lane,
              world(sheet, item, G.lane(a, link.e === 1, j)), a.angle);
          }
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
        if (binding.road != null && (!end?.terminal || occupied(sheet, end.joint, null, binding))) return null;
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
              const at = world(sheet, item, G.lane(a, incoming, j)),
                d = G.length(G.sub(point, at));
              if (d <= reach && d < distance) {
                distance = d;
                best = { intersection: item.id, approach: a.id, to: id, point: at, angle: a.angle };
              }
            }
          }
        return best;
      },
      linkLane(sheet, target, binding, lane) {
        const item = sheet.intersections?.find((x) => x.id === target.intersection),
          a = item?.approaches.find((a) => a.id === target.approach);
        if (!a || a.binding) return false;
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
