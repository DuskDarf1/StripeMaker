(() => {
  // Sheets are uploaded aerial images. GeoTIFFs decode with the vendored geotiff.js
  // into 4096 px canvas tiles (browsers cap single canvases); JPEG and PNG use <img>.
  const TILE = 4096;
  const SUPPORTED = /\.(tiff?|jpe?g|png)$/i;
  // GeoTIFF ProjLinearUnitsGeoKey codes: metre, international foot, US survey foot.
  const INCHES_PER_UNIT = { 9001: 1 / 0.0254, 9002: 12, 9003: 1200 / 3937 / 0.0254 };
  const MAX_ZOOM = 16;
  const SAVE_DELAY = 400;

  document.addEventListener("DOMContentLoaded", () => {
    const workspace = document.getElementById("workspace");
    const stage = document.getElementById("previewStage");
    const fileInput = document.getElementById("sheetFile");
    const uploadButton = document.getElementById("uploadSheet");
    const scaleButton = document.getElementById("setScale");
    const removeButton = document.getElementById("removeSheet");
    const list = document.getElementById("sheetList");
    const empty = document.getElementById("sheetsEmpty");
    const status = document.getElementById("sheetStatus");
    const guide = document.getElementById("sheetGuide");
    const scaleEditor = document.getElementById("scaleEditor");
    const scalePixels = document.getElementById("scalePixels");
    const scaleInches = document.getElementById("scaleInches");
    const scaleResult = document.getElementById("scaleResult");
    const sheets = [];
    let selected = null;
    let nextId = 1;

    function tiffInchesPerPixel(image) {
      const keys = image.getGeoKeys?.() ?? {};
      const perUnit = INCHES_PER_UNIT[keys.ProjLinearUnitsGeoKey];
      if (keys.GTModelTypeGeoKey !== 1 || !perUnit) return null;
      try { return Math.abs(image.getResolution()[0]) * perUnit; } catch { return null; }
    }

    async function decodeTiff(file) {
      const tiff = await window.GeoTIFF.fromBlob(file);
      const image = await tiff.getImage();
      const width = image.getWidth();
      const height = image.getHeight();
      const content = document.createElement("div");
      for (let y = 0; y < height; y += TILE) {
        for (let x = 0; x < width; x += TILE) {
          const w = Math.min(TILE, width - x);
          const h = Math.min(TILE, height - y);
          const rgb = await image.readRGB({ window: [x, y, x + w, y + h], interleave: true });
          const rgba = new Uint8ClampedArray(w * h * 4);
          for (let i = 0, j = 0; i < rgb.length; i += 3, j += 4) {
            rgba[j] = rgb[i];
            rgba[j + 1] = rgb[i + 1];
            rgba[j + 2] = rgb[i + 2];
            rgba[j + 3] = 255;
          }
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          canvas.getContext("2d").putImageData(new ImageData(rgba, w, h), 0, 0);
          canvas.style.left = `${x}px`;
          canvas.style.top = `${y}px`;
          content.append(canvas);
        }
      }
      return { content, width, height, inchesPerPixel: tiffInchesPerPixel(image) };
    }

    async function decodeImage(file) {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.alt = "";
      image.src = url;
      try { await image.decode(); } catch (error) { URL.revokeObjectURL(url); throw error; }
      const content = document.createElement("div");
      content.append(image);
      return { content, width: image.naturalWidth, height: image.naturalHeight, inchesPerPixel: null, url };
    }

    // Pan/zoom view: translate + scale on one layer, anchored at the stage's top-left.
    function fitScale(sheet) {
      const box = stage.getBoundingClientRect();
      return Math.min(box.width / sheet.width, box.height / sheet.height);
    }
    function fitSheet(sheet) {
      const box = stage.getBoundingClientRect();
      const scale = fitScale(sheet);
      sheet.view = { scale, x: (box.width - sheet.width * scale) / 2, y: (box.height - sheet.height * scale) / 2, fitted: true };
      applyView(sheet);
    }
    function applyView(sheet) {
      const { scale, x, y } = sheet.view;
      sheet.content.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
      sheet.content.style.setProperty("--zoom", scale);
      scheduleSave(sheet);
      if (sheet === selected) {
        drawScaleLine();
        document.dispatchEvent(new CustomEvent("sheetview"));
      }
    }
    function zoomAt(sheet, factor, clientX, clientY) {
      const box = stage.getBoundingClientRect();
      const view = sheet.view;
      const scale = Math.min(MAX_ZOOM, Math.max(fitScale(sheet) / 2, view.scale * factor));
      const px = clientX - box.left;
      const py = clientY - box.top;
      view.x = px - (px - view.x) * (scale / view.scale);
      view.y = py - (py - view.y) * (scale / view.scale);
      view.scale = scale;
      view.fitted = false;
      applyView(sheet);
    }
    function panBy(sheet, dx, dy) {
      sheet.view.x += dx;
      sheet.view.y += dy;
      sheet.view.fitted = false;
      applyView(sheet);
    }

    function formatScale(inches) {
      if (!inches) return "No scale";
      return `${inches < 10 ? inches.toFixed(1) : Math.round(inches)} in/px`;
    }

    // Rows are reused and moved, never rebuilt, so focus and click targets stay attached.
    function renderList() {
      const rows = new Map([...list.children].map(item => [Number(item.dataset.sheetId), item]));
      for (const sheet of sheets) {
        let item = rows.get(sheet.id);
        if (!item) {
          item = document.createElement("li");
          item.dataset.sheetId = sheet.id;
          const button = document.createElement("button");
          button.type = "button";
          button.className = "headListButton";
          button.dataset.sheetId = sheet.id;
          button.setAttribute("aria-keyshortcuts", "ArrowUp ArrowDown");
          button.innerHTML = '<span class="sheetName"></span><span class="sheetScale"></span>';
          item.append(button);
        }
        const button = item.firstChild;
        button.querySelector(".sheetName").textContent = sheet.name;
        button.querySelector(".sheetScale").textContent = formatScale(sheet.inchesPerPixel);
        button.draggable = sheets.length > 1;
        button.title = `${sheet.name} (${sheet.width} × ${sheet.height} px). Drag to reorder; arrow keys also move this sheet`;
        list.append(item);
        rows.delete(sheet.id);
      }
      rows.forEach(item => item.remove());
      empty.hidden = sheets.length > 0;
      updateSelection();
    }
    function updateSelection() {
      list.querySelectorAll(".headListButton").forEach(button => {
        const active = Number(button.dataset.sheetId) === selected?.id;
        button.classList.toggle("active", active);
        button.setAttribute("aria-current", String(active));
      });
      removeButton.disabled = !selected;
      scaleButton.disabled = !selected;
    }

    function select(sheet) {
      if (sheet !== selected) endScale();
      selected = sheet;
      stage.replaceChildren(...(sheet ? [sheet.content, overlay, ...overlays] : []));
      workspace.classList.toggle("hasSheet", Boolean(sheet));
      if (sheet && !sheet.view) fitSheet(sheet);
      else if (sheet) applyView(sheet);
      updateSelection();
      scheduleSave();
      document.dispatchEvent(new CustomEvent("sheetchange"));
    }

    // Sheets persist across reloads in IndexedDB. Original files are written once;
    // scale, view, and roads are small records saved shortly after each change.
    let database = null;
    const pendingSaves = new Set();
    let saveTimer = 0;
    let restoring = true;
    function openDatabase() {
      database ??= new Promise((resolve, reject) => {
        const request = indexedDB.open("StripeMaker", 1);
        request.onupgradeneeded = () => {
          for (const store of ["files", "sheets", "meta"]) request.result.createObjectStore(store);
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      return database;
    }
    async function transact(mode, work) {
      const db = await openDatabase();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(["files", "sheets", "meta"], mode);
        const result = work(transaction);
        transaction.oncomplete = () => resolve(result);
        transaction.onerror = transaction.onabort = () => reject(transaction.error);
      });
    }
    const record = sheet => ({
      name: sheet.name, inchesPerPixel: sheet.inchesPerPixel, view: sheet.view,
      roads: sheet.roads ?? [], joints: sheet.joints ?? [], gores: sheet.gores ?? [], medians: sheet.medians ?? [],
      autoTapers: Boolean(sheet.autoTapers), intersections: sheet.intersections ?? [], signs: sheet.signs ?? [],
    });
    function saveFailed(error) {
      status.textContent = `Couldn't save sheets for next time: ${error?.message || "storage unavailable"}.`;
    }
    function scheduleSave(sheet) {
      if (sheet) pendingSaves.add(sheet);
      clearTimeout(saveTimer);
      saveTimer = setTimeout(flushSaves, SAVE_DELAY);
    }
    function flushSaves() {
      const saving = [...pendingSaves].filter(sheet => sheets.includes(sheet));
      pendingSaves.clear();
      transact("readwrite", transaction => {
        const store = transaction.objectStore("sheets");
        saving.forEach(sheet => store.put(record(sheet), sheet.id));
        // Until restore finishes, the list is partial; keep the saved order intact.
        if (!restoring) transaction.objectStore("meta").put({ order: sheets.map(sheet => sheet.id), selected: selected?.id ?? null }, "app");
      }).catch(saveFailed);
    }
    function saveFile(sheet) {
      transact("readwrite", transaction => transaction.objectStore("files").put(sheet.file, sheet.id)).catch(saveFailed);
      scheduleSave(sheet);
    }
    function forget(sheet) {
      transact("readwrite", transaction => {
        transaction.objectStore("files").delete(sheet.id);
        transaction.objectStore("sheets").delete(sheet.id);
      }).catch(saveFailed);
      scheduleSave();
    }
    async function restore() {
      let saved;
      try {
        saved = await transact("readonly", transaction => {
          const found = {};
          const meta = transaction.objectStore("meta").get("app");
          meta.onsuccess = () => { found.meta = meta.result; };
          for (const name of ["files", "sheets"]) {
            const keys = transaction.objectStore(name).getAllKeys();
            const values = transaction.objectStore(name).getAll();
            values.onsuccess = () => { found[name] = new Map(keys.result.map((key, i) => [key, values.result[i]])); };
          }
          return found;
        });
      } catch (error) {
        restoring = false;
        saveFailed(error);
        return;
      }
      const order = saved.meta?.order ?? [...saved.sheets.keys()];
      for (const id of order) {
        const file = saved.files.get(id);
        const data = saved.sheets.get(id);
        if (!file || !data) continue;
        status.textContent = `Restoring ${data.name}…`;
        try {
          const decoded = await decode(file);
          const view = data.view?.fitted ? null : data.view;
          const sheet = { ...decoded, ...data, id, file, view, content: decoded.content };
          nextId = Math.max(nextId, id + 1);
          sheets.push(sheet);
          renderList();
          if (id === saved.meta?.selected || !selected) select(sheet);
        } catch (error) {
          status.textContent = `Couldn't restore ${data.name}: ${error?.message || "unknown error"}.`;
          continue;
        }
        status.textContent = "";
      }
      restoring = false;
      scheduleSave();
      history.rebase();
    }

    async function decode(file) {
      const decoded = /\.tiff?$/i.test(file.name) ? await decodeTiff(file) : await decodeImage(file);
      decoded.content.className = "sheetImage";
      decoded.content.style.width = `${decoded.width}px`;
      decoded.content.style.height = `${decoded.height}px`;
      return decoded;
    }

    async function addFiles(files) {
      for (const file of files) {
        if (!SUPPORTED.test(file.name)) {
          status.textContent = `${file.name} isn't supported. Use GeoTIFF, JPEG, or PNG.`;
          continue;
        }
        status.textContent = `Loading ${file.name}…`;
        uploadButton.disabled = true;
        try {
          const decoded = await decode(file);
          const sheet = { id: nextId++, name: file.name.replace(/\.[^.]+$/, ""), file, ...decoded };
          sheets.push(sheet);
          renderList();
          select(sheet);
          saveFile(sheet);
          history.rebase();
          status.textContent = "";
        } catch (error) {
          status.textContent = `Couldn't read ${file.name}: ${error?.message || "unknown error"}.`;
        } finally {
          uploadButton.disabled = false;
        }
      }
    }

    uploadButton.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", () => {
      const files = [...fileInput.files];
      fileInput.value = "";
      addFiles(files);
    });
    removeButton.addEventListener("click", () => {
      const index = sheets.indexOf(selected);
      if (index < 0) return;
      const [removed] = sheets.splice(index, 1);
      if (removed.url) URL.revokeObjectURL(removed.url);
      forget(removed);
      select(sheets[Math.min(index, sheets.length - 1)] ?? null);
      renderList();
      history.rebase();
    });
    document.getElementById("openSheetGuide").addEventListener("click", () => guide.showModal());
    document.getElementById("closeSheetGuide").addEventListener("click", () => guide.close());

    // Reordering follows SignalMaker's Heads list: wiggle, faded source, insertion
    // markers, mouse drag-and-drop, touch dragging with a ghost, and up/down arrow keys.
    let listDrag = null;
    let touchDrag = null;
    let suppressClickUntil = 0;
    const listButtons = () => [...list.querySelectorAll(".headListButton")];

    function moveSheet(from, insertAt) {
      if (from < 0 || insertAt < 0 || insertAt > sheets.length) return;
      const [sheet] = sheets.splice(from, 1);
      sheets.splice(insertAt > from ? insertAt - 1 : insertAt, 0, sheet);
      renderList();
      scheduleSave();
    }
    function dropIndex(clientY) {
      const buttons = listButtons();
      buttons.forEach(button => button.classList.remove("dropBefore", "dropAfter"));
      let index = buttons.findIndex(button => {
        const rect = button.getBoundingClientRect();
        return clientY < rect.top + rect.height / 2;
      });
      if (index < 0) index = buttons.length;
      const target = buttons[Math.min(index, buttons.length - 1)];
      if (target && !target.classList.contains("dragging")) target.classList.add(index < buttons.length ? "dropBefore" : "dropAfter");
      return index;
    }
    function scrollList(clientY) {
      const rect = list.getBoundingClientRect();
      if (clientY < rect.top + 20) list.scrollTop -= 12;
      else if (clientY > rect.bottom - 20) list.scrollTop += 12;
    }
    function beginListDrag(button) {
      listDrag = { from: sheets.findIndex(sheet => sheet.id === Number(button.dataset.sheetId)) };
      listButtons().forEach(row => {
        row.classList.add("panelWiggle");
        row.style.setProperty("--wiggle-delay", `${Math.random() * 0.12}s`);
      });
      button.classList.add("dragging");
    }
    function endListDrag() {
      listButtons().forEach(row => {
        row.classList.remove("panelWiggle", "dragging", "dropBefore", "dropAfter");
        row.style.removeProperty("--wiggle-delay");
      });
      listDrag = null;
    }

    list.addEventListener("click", event => {
      const button = event.target.closest(".headListButton");
      if (!button || Date.now() < suppressClickUntil) return;
      select(sheets.find(sheet => sheet.id === Number(button.dataset.sheetId)));
    });
    list.addEventListener("dragstart", event => {
      const button = event.target.closest(".headListButton");
      if (!button || sheets.length < 2) return;
      beginListDrag(button);
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", String(listDrag.from));
    });
    list.addEventListener("dragover", event => {
      if (!listDrag) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      scrollList(event.clientY);
      dropIndex(event.clientY);
    });
    list.addEventListener("drop", event => {
      if (!listDrag) return;
      event.preventDefault();
      const { from } = listDrag;
      const to = dropIndex(event.clientY);
      endListDrag();
      moveSheet(from, to);
    });
    list.addEventListener("dragleave", event => {
      if (!list.contains(event.relatedTarget)) listButtons().forEach(row => row.classList.remove("dropBefore", "dropAfter"));
    });
    list.addEventListener("dragend", () => {
      suppressClickUntil = Date.now() + 250;
      endListDrag();
    });
    list.addEventListener("keydown", event => {
      const button = event.target.closest(".headListButton");
      if (!button || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
      event.preventDefault();
      const index = sheets.findIndex(sheet => sheet.id === Number(button.dataset.sheetId));
      moveSheet(index, event.key === "ArrowUp" ? index - 1 : index + 2);
      button.focus();
    });
    list.addEventListener("pointerdown", event => {
      if (event.pointerType === "mouse" || !event.isPrimary || sheets.length < 2) return;
      const button = event.target.closest(".headListButton");
      if (!button) return;
      touchDrag = { button, pointerId: event.pointerId, x: event.clientX, y: event.clientY, ghost: null };
      list.setPointerCapture(event.pointerId);
    });
    list.addEventListener("pointermove", event => {
      const drag = touchDrag;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const dy = event.clientY - drag.y;
      if (!drag.ghost && Math.hypot(event.clientX - drag.x, dy) < 6) return;
      event.preventDefault();
      if (!drag.ghost) {
        const rect = drag.button.getBoundingClientRect();
        drag.left = rect.left;
        drag.top = rect.top;
        drag.ghost = drag.button.cloneNode(true);
        drag.ghost.className = "dragGhost headListButton";
        drag.ghost.inert = true;
        drag.ghost.setAttribute("aria-hidden", "true");
        Object.assign(drag.ghost.style, { width: `${rect.width}px`, height: `${rect.height}px`, left: `${rect.left}px` });
        document.body.append(drag.ghost);
        beginListDrag(drag.button);
      }
      drag.ghost.style.top = `${drag.top + dy}px`;
      scrollList(event.clientY);
      dropIndex(event.clientY);
    });
    function endTouchDrag(event, cancelled = false) {
      const drag = touchDrag;
      if (!drag || drag.pointerId !== event.pointerId) return;
      touchDrag = null;
      if (list.hasPointerCapture(event.pointerId)) list.releasePointerCapture(event.pointerId);
      if (!drag.ghost) return;
      drag.ghost.remove();
      suppressClickUntil = Date.now() + 250;
      const { from } = listDrag;
      const to = dropIndex(event.clientY);
      endListDrag();
      if (!cancelled) moveSheet(from, to);
    }
    list.addEventListener("pointerup", event => endTouchDrag(event));
    list.addEventListener("pointercancel", event => endTouchDrag(event, true));

    // Set Scale: two handles in image pixels joined by a straight line. The readout
    // converts their pixel distance to the inches the user enters.
    const overlay = document.createElement("div");
    overlay.className = "scaleOverlay";
    overlay.hidden = true;
    overlay.innerHTML = `<svg aria-hidden="true"><line class="scaleLineShadow"/><line class="scaleLine"/></svg>
      <button type="button" class="scaleHandle" data-handle="a" aria-label="Scale start point" aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown"></button>
      <button type="button" class="scaleHandle" data-handle="b" aria-label="Scale end point" aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown"></button>`;
    const handles = { a: overlay.querySelector('[data-handle="a"]'), b: overlay.querySelector('[data-handle="b"]') };
    let scale = null;

    const pixelDistance = () => Math.hypot(scale.b.x - scale.a.x, scale.b.y - scale.a.y);
    function toImage(sheet, clientX, clientY) {
      const box = stage.getBoundingClientRect();
      return {
        x: Math.min(sheet.width, Math.max(0, (clientX - box.left - sheet.view.x) / sheet.view.scale)),
        y: Math.min(sheet.height, Math.max(0, (clientY - box.top - sheet.view.y) / sheet.view.scale)),
      };
    }
    function drawScaleLine() {
      if (!scale || !selected) return;
      const { x, y, scale: zoom } = selected.view;
      const points = { a: { x: x + scale.a.x * zoom, y: y + scale.a.y * zoom }, b: { x: x + scale.b.x * zoom, y: y + scale.b.y * zoom } };
      overlay.querySelectorAll("line").forEach(line => {
        line.setAttribute("x1", points.a.x);
        line.setAttribute("y1", points.a.y);
        line.setAttribute("x2", points.b.x);
        line.setAttribute("y2", points.b.y);
      });
      for (const key of ["a", "b"]) {
        handles[key].style.left = `${points[key].x}px`;
        handles[key].style.top = `${points[key].y}px`;
      }
      updateReadout();
    }
    function updateReadout() {
      const pixels = pixelDistance();
      const inches = Number(scaleInches.value);
      scalePixels.textContent = `${pixels.toFixed(1)} px`;
      const valid = pixels >= 1 && inches > 0;
      document.getElementById("applyScale").disabled = !valid;
      scaleResult.textContent = valid ? `= ${formatScale(inches / pixels)}` : "Drag the points apart and enter a distance.";
    }
    function startScale() {
      if (!selected) return;
      window.StripeMaker?.showEditor(null);
      const box = stage.getBoundingClientRect();
      const center = toImage(selected, box.left + box.width / 2, box.top + box.height / 2);
      const half = Math.min(100 / selected.view.scale, selected.width / 4);
      scale = {
        a: { x: Math.max(0, center.x - half), y: center.y },
        b: { x: Math.min(selected.width, center.x + half), y: center.y },
      };
      overlay.hidden = false;
      scaleEditor.hidden = false;
      drawScaleLine();
      handles.a.focus({ preventScroll: true });
    }
    function endScale() {
      scale = null;
      overlay.hidden = true;
      scaleEditor.hidden = true;
    }

    scaleButton.addEventListener("click", startScale);
    scaleInches.addEventListener("input", updateReadout);
    document.getElementById("cancelScale").addEventListener("click", endScale);
    document.getElementById("applyScale").addEventListener("click", () => {
      const pixels = pixelDistance();
      const inches = Number(scaleInches.value);
      if (!selected || pixels < 1 || !(inches > 0)) return;
      selected.inchesPerPixel = inches / pixels;
      scheduleSave(selected);
      history.record();
      endScale();
      renderList();
      document.dispatchEvent(new CustomEvent("sheetchange"));
    });
    document.getElementById("configBar").addEventListener("click", event => {
      if (event.target.closest("[data-editor]")) endScale();
    });
    document.addEventListener("keydown", event => {
      if (event.key === "Escape" && scale && !document.querySelector("dialog[open]")) endScale();
    });
    for (const [key, handle] of Object.entries(handles)) {
      handle.addEventListener("pointerdown", event => {
        event.stopPropagation();
        handle.setPointerCapture(event.pointerId);
      });
      handle.addEventListener("pointermove", event => {
        if (!handle.hasPointerCapture(event.pointerId) || !scale) return;
        scale[key] = toImage(selected, event.clientX, event.clientY);
        drawScaleLine();
      });
      // Arrow keys nudge one screen pixel at the current zoom; Shift moves ten.
      handle.addEventListener("keydown", event => {
        const moves = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
        if (!moves[event.key] || !scale) return;
        event.preventDefault();
        const step = (event.shiftKey ? 10 : 1) / selected.view.scale;
        const point = scale[key];
        point.x = Math.min(selected.width, Math.max(0, point.x + moves[event.key][0] * step));
        point.y = Math.min(selected.height, Math.max(0, point.y + moves[event.key][1] * step));
        drawScaleLine();
      });
    }

    // Trackpad pinches arrive as ctrl+wheel (Chrome, Firefox) or gesture events (Safari)
    // and zoom smoothly; two-finger scrolls pan; mouse wheels zoom in steps.
    workspace.addEventListener("wheel", event => {
      if (!selected) return;
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? stage.clientHeight : 1;
      const dx = event.deltaX * unit;
      const dy = event.deltaY * unit;
      const trackpad = event.wheelDeltaY ? event.wheelDeltaY === -3 * event.deltaY : event.deltaMode === 0;
      if (event.ctrlKey) zoomAt(selected, Math.exp(-dy * 0.01), event.clientX, event.clientY);
      else if (trackpad) panBy(selected, -dx, -dy);
      else zoomAt(selected, Math.exp(-dy * 0.002), event.clientX, event.clientY);
    }, { passive: false });
    let gestureScale = 1;
    workspace.addEventListener("gesturestart", event => { event.preventDefault(); gestureScale = 1; });
    workspace.addEventListener("gesturechange", event => {
      event.preventDefault();
      if (!selected) return;
      zoomAt(selected, event.scale / gestureScale, event.clientX, event.clientY);
      gestureScale = event.scale;
    });
    workspace.addEventListener("gestureend", event => event.preventDefault());

    // One pointer pans; two pointers pinch-zoom around their midpoint.
    const pointers = new Map();
    let pinchDistance = 0;
    workspace.addEventListener("pointerdown", event => {
      if (!selected || event.button !== 0) return;
      workspace.setPointerCapture(event.pointerId);
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      workspace.classList.add("panning");
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchDistance = Math.hypot(a.x - b.x, a.y - b.y);
      }
    });
    workspace.addEventListener("pointermove", event => {
      const last = pointers.get(event.pointerId);
      if (!last || !selected) return;
      const current = { x: event.clientX, y: event.clientY };
      pointers.set(event.pointerId, current);
      if (pointers.size === 1) {
        panBy(selected, current.x - last.x, current.y - last.y);
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchDistance) zoomAt(selected, distance / pinchDistance, (a.x + b.x) / 2, (a.y + b.y) / 2);
        pinchDistance = distance;
      }
    });
    function endPointer(event) {
      pointers.delete(event.pointerId);
      pinchDistance = 0;
      if (!pointers.size) workspace.classList.remove("panning");
    }
    workspace.addEventListener("pointerup", endPointer);
    workspace.addEventListener("pointercancel", endPointer);
    workspace.addEventListener("dblclick", event => {
      if (selected && !event.defaultPrevented && !event.target.closest(".scaleHandle, .roadNode, .roadControl, .medianPoint")) fitSheet(selected);
    });
    window.addEventListener("resize", () => { if (selected?.view.fitted) fitSheet(selected); });

    // Other tools draw on the selected sheet through this API and the sheetview
    // (pan/zoom) and sheetchange (selection or scale) events.
    const overlays = [];
    (window.StripeMaker ??= {}).sheets = {
      get selected() { return selected; },
      get all() { return sheets; },
      save: scheduleSave,
      addOverlay(element) {
        overlays.push(element);
        if (selected) stage.append(element);
      },
      toImage(clientX, clientY) {
        const box = stage.getBoundingClientRect();
        return { x: (clientX - box.left - selected.view.x) / selected.view.scale, y: (clientY - box.top - selected.view.y) / selected.view.scale };
      },
      toScreen(point) {
        return { x: selected.view.x + point.x * selected.view.scale, y: selected.view.y + point.y * selected.view.scale };
      },
    };

    // Undo and redo cover each sheet's scale, roads, and joints.
    const actionStatus = document.getElementById("actionStatus");
    let statusTimeout = null;
    function report(message) {
      clearTimeout(statusTimeout);
      actionStatus.textContent = message;
      statusTimeout = setTimeout(() => { actionStatus.textContent = ""; }, 5000);
    }
    const history = window.StripeMaker.history = window.StripeMaker.startHistory({
      sheets: window.StripeMaker.sheets,
      report,
      onRestore(changed) {
        changed.forEach(scheduleSave);
        renderList();
        document.dispatchEvent(new CustomEvent("sheethistory"));
      },
    });

    // Clear all (SignalMaker's toolbar action) erases the selected sheet's drawing
    // after a confirmation; the sheet image and its scale stay, and it is undoable.
    const clearAll = document.getElementById("clearAll");
    clearAll.addEventListener("click", () => {
      if (!selected) {
        report("Upload a sheet first.");
        return;
      }
      if (!window.confirm(`Clear all roads, medians, gores, intersections, and signs on “${selected.name}”? You can undo this.`)) return;
      window.StripeMaker.showEditor?.(null);
      Object.assign(selected, { roads: [], joints: [], gores: [], medians: [], intersections: [], signs: [] });
      scheduleSave(selected);
      history.record();
      document.dispatchEvent(new CustomEvent("sheethistory"));
      report("Sheet cleared.");
    });
    restore();
  });
})();
