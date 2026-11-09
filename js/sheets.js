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
    const blankButton = document.getElementById("blankSheet");
    const nameInput = document.getElementById("sheetName");
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
      // Wheel and pointer events can come several to a frame; the overlays
      // only need to follow once per frame.
      if (sheet === selected) viewFrame ||= requestAnimationFrame(viewChanged);
    }
    let viewFrame = 0;
    function viewChanged() {
      viewFrame = 0;
      drawScaleLine();
      document.dispatchEvent(new CustomEvent("sheetview"));
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
      nameInput.disabled = !selected;
      if (document.activeElement !== nameInput) nameInput.value = selected?.name ?? "";
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
    let database = null, databaseName='StripeMaker', switching=false, fileOperations=0, storageError=null;
    const projectContexts=new Map(), writes=new Set();
    const pendingSaves = new Set();
    let saveTimer = 0;
    let restoring = true;
    const unrestored = new Set(), restoreErrors = [];
    let savedSelection = null;
    const appRecord = () => ({
      // Failed records still belong to the project. Keep them discoverable and
      // reserve their IDs even when only part of a project could be opened.
      order: [...sheets.map(sheet => sheet.id), ...unrestored],
      selected: selected?.id ?? (unrestored.has(savedSelection) ? savedSelection : null),
    });
    function openDatabase() {
      database ??= new Promise((resolve, reject) => {
        const request = indexedDB.open(databaseName, 1);
        request.onupgradeneeded = () => {
          for (const store of ["files", "sheets", "meta"]) request.result.createObjectStore(store);
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      return database;
    }
    function transact(mode, work) {
      const opening=openDatabase(); // Capture the database before any project switch.
      const task=opening.then(db=>new Promise((resolve,reject)=>{
        const transaction=db.transaction(["files","sheets","meta"],mode);let result;
        transaction.oncomplete=()=>resolve(result);
        transaction.onerror=transaction.onabort=event=>reject(event.target.error??transaction.error);
        try{result=work(transaction);}catch(error){transaction.abort();reject(error);}
      }));
      if(mode==='readwrite'){
        writes.add(task);task.then(()=>writes.delete(task),error=>{writes.delete(task);storageError=error;});
      }
      return task;
    }
    const record = sheet => ({
      name: sheet.name, inchesPerPixel: sheet.inchesPerPixel, view: sheet.view,
      roads: sheet.roads ?? [], joints: sheet.joints ?? [], gores: sheet.gores ?? [], medians: sheet.medians ?? [],
      autoTapers: Boolean(sheet.autoTapers), intersections: sheet.intersections ?? [], signs: sheet.signs ?? [], matchLines: sheet.matchLines ?? [],
      markings: sheet.markings ?? [], lines: sheet.lines ?? [], bridges: sheet.bridges ?? [], surfaces: sheet.surfaces ?? [], speedZones: sheet.speedZones ?? [], vehicleSpawns: sheet.vehicleSpawns ?? [], blank: Boolean(sheet.blank),
      ...(sheet.projectArchive ? { projectArchive: sheet.projectArchive } : {}),
      ...(sheet.blank ? { width: sheet.width, height: sheet.height } : {}),
    });
    function saveFailed(error) {
      status.textContent = `Couldn't save sheets for next time: ${error?.message || "storage unavailable"}.`;
    }
    function scheduleSave(sheet) {
      if (sheet) pendingSaves.add(sheet);
      clearTimeout(saveTimer);
      saveTimer = setTimeout(flushSaves, SAVE_DELAY);
    }
    function flushSaves(strict=false) {
      clearTimeout(saveTimer);
      const saving=(strict?sheets:[...pendingSaves]).filter(sheet=>sheets.includes(sheet)).map(sheet=>({id:sheet.id,data:record(sheet)}));
      pendingSaves.clear();
      const meta=restoring?null:appRecord();
      const task=transact("readwrite",transaction=>{
        const store=transaction.objectStore("sheets");saving.forEach(sheet=>store.put(sheet.data,sheet.id));
        if(meta)transaction.objectStore("meta").put(meta,"app");
      });
      if(strict)return task;
      return task.catch(saveFailed);
    }
    async function flushProject(){
      await Promise.allSettled([...writes]);
      if(storageError){
        // Retry a failed file write too, not merely its small drawing record.
        // This path only runs after a storage failure; ordinary switches never
        // rewrite large background images.
        const retry=await Promise.all(sheets.map(async sheet=>({id:sheet.id,data:record(sheet),file:await fileRecord(sheet.file)})));
        const meta=appRecord();
        await transact('readwrite',transaction=>{
          for(const sheet of retry){transaction.objectStore('files').put(sheet.file,sheet.id);transaction.objectStore('sheets').put(sheet.data,sheet.id);}
          transaction.objectStore('meta').put(meta,'app');
        });
        storageError=null;
      }
      await flushSaves(true);
    }
    // Safari/WebKit can fail IndexedDB Blob/File preparation. Store immutable
    // bytes plus metadata instead; runtime/export still receive ordinary Files.
    // Legacy File records remain readable, without a database version change.
    const fileRecord = async file => ({ name: file.name, type: file.type,
      lastModified: file.lastModified, bytes: await file.arrayBuffer() });
    const fileFromRecord = stored => stored?.bytes instanceof ArrayBuffer
      ? new File([stored.bytes], stored.name, { type: stored.type, lastModified: stored.lastModified }) : stored;
    function saveFile(sheet, storedFile) {
      // File, drawing and list entry become durable together. Reloading between
      // separate transactions must not leave a new sheet unlisted or file-only.
      transact("readwrite", transaction => {
        transaction.objectStore("files").put(storedFile, sheet.id);
        transaction.objectStore("sheets").put(record(sheet), sheet.id);
        if (!restoring) transaction.objectStore("meta").put(appRecord(), "app");
      }).catch(saveFailed);
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
          // Read large source images one at a time below. Loading every byte
          // record here would multiply startup memory for multi-sheet TIFFs.
          const fileKeys = transaction.objectStore("files").getAllKeys();
          fileKeys.onsuccess = () => { found.fileKeys = fileKeys.result; };
          const keys = transaction.objectStore("sheets").getAllKeys();
          const values = transaction.objectStore("sheets").getAll();
          values.onsuccess = () => { found.sheets = new Map(keys.result.map((key, i) => [key, values.result[i]])); };
          return found;
        });
      } catch (error) {
        restoring = false;
        saveFailed(error);
        throw error;
      }
      // Old failed restores could save an incomplete order. Records, rather
      // than that index alone, are the source of truth for recoverable sheets.
      const order = [...new Set([...(saved.meta?.order ?? []), ...saved.sheets.keys()])];
      savedSelection = saved.meta?.selected ?? null;
      for (const id of [...saved.fileKeys, ...saved.sheets.keys(), ...order])
        if (Number.isSafeInteger(id)) nextId = Math.max(nextId, id + 1);
      for (const id of order) {
        let file, storedFile;
        const data = saved.sheets.get(id);
        // A completed Delete may precede its delayed list save. A stale index
        // with neither drawing nor image is not a recoverable failed sheet.
        if (!data && !saved.fileKeys.includes(id)) continue;
        unrestored.add(id);
        status.textContent = `Restoring ${data?.name ?? 'sheet'}…`;
        try {
          if (!data) throw Error('The saved drawing record is missing.');
          // Blank sheets contain no source imagery. Recreate their disposable
          // white pixel instead of making the drawing depend on its decoding.
          if (data.blank) file = await blankFile(data.name);
          else {
            const request = await transact("readonly", transaction => transaction.objectStore("files").get(id));
            storedFile = request.result;
            file = fileFromRecord(storedFile);
          }
          if (!file) throw Error('The saved background image is missing.');
          const decoded = await decode(file);
          const view = data.view?.fitted ? null : data.view;
          const sheet = { ...decoded, ...data, id, file, view, content: decoded.content };
          blankSize(sheet);
          const repairedFile = data.blank ? await fileRecord(file) : null;
          nextId = Math.max(nextId, id + 1);
          sheets.push(sheet);
          renderList();
          if (id === saved.meta?.selected || !selected) select(sheet);
          unrestored.delete(id);
          if (data.blank) saveFile(sheet, repairedFile);
          else if (!(storedFile?.bytes instanceof ArrayBuffer))
            fileRecord(file).then(stored => { if (sheets.includes(sheet)) saveFile(sheet, stored); }).catch(saveFailed);
        } catch (error) {
          const message = `Couldn't restore ${data?.name ?? 'sheet'}: ${error?.message || error?.name || "unknown error"}.`;
          restoreErrors.push({ id, name: data?.name, message });
          console.warn(message, error);
        }
      }
      status.textContent = restoreErrors.map(error => error.message).join(' ');
      restoring = false;
      scheduleSave();
      history.rebase();
    }

    // A blank sheet's stretched pixel takes the sheet's own (saved) size.
    function blankSize(sheet) {
      sheet.content.classList.toggle("blankSheet", Boolean(sheet.blank));
      if (!sheet.blank) return;
      sheet.content.style.width = `${sheet.width}px`;
      sheet.content.style.height = `${sheet.height}px`;
    }
    async function decode(file) {
      const decoded = /\.tiff?$/i.test(file.name) ? await decodeTiff(file) : await decodeImage(file);
      decoded.content.className = "sheetImage";
      decoded.content.style.width = `${decoded.width}px`;
      decoded.content.style.height = `${decoded.height}px`;
      return decoded;
    }

    // `extra` overrides what's read from the file (a blank sheet's name and scale).
    async function addFiles(files,extra={}) {
      if(restoring||switching){status.textContent='Wait for the project to finish opening.';return;}
      fileOperations++;
      try{return await addFilesImpl(files,extra);}finally{fileOperations--;}
    }
    async function addFilesImpl(files, extra = {}) {
      for (const file of files) {
        if (!SUPPORTED.test(file.name)) {
          status.textContent = `${file.name} isn't supported. Use GeoTIFF, JPEG, or PNG.`;
          continue;
        }
        status.textContent = `Loading ${file.name}…`;
        uploadButton.disabled = true;
        try {
          const decoded = await decode(file);
          const storedFile = await fileRecord(file);
          const sheet = { id: nextId++, name: file.name.replace(/\.[^.]+$/, ""), file, ...decoded, ...extra };
          blankSize(sheet);
          sheets.push(sheet);
          renderList();
          select(sheet);
          saveFile(sheet, storedFile);
          history.rebase();
          status.textContent = "";
        } catch (error) {
          status.textContent = `Couldn't read ${file.name}: ${error?.message || "unknown error"}.`;
        } finally {
          uploadButton.disabled = false;
        }
      }
    }

    // Decode every background before changing the open project. Import adds
    // sheets with new sheet IDs; all geometry IDs stay local to each sheet.
    async function importProject(entries,selectedId) {
      if(restoring||switching)throw Error('Wait for the project to finish opening.');
      fileOperations++;
      try{return await importProjectImpl(entries,selectedId);}finally{fileOperations--;}
    }
    async function importProjectImpl(entries, selectedId) {
      if(restoring)throw Error("Sheets are still loading. Try again in a moment.");
      const prepared=[];
      try {
        for(const entry of entries) {
          const decoded=await decode(entry.file);
          const sheet={...decoded,...entry.data,projectArchive:entry.projectArchive,file:entry.file,content:decoded.content};
          prepared.push(sheet);
          if(!sheet.blank&&(decoded.width!==entry.width||decoded.height!==entry.height))throw Error("Background dimensions do not match the sheet.");
          blankSize(sheet);
        }
        const storedFiles = await Promise.all(prepared.map(sheet => fileRecord(sheet.file)));
        // Reserve IDs after decoding so concurrent image uploads cannot collide.
        for(const sheet of prepared)sheet.id=nextId++;
        const sheetIds=new Map(entries.map((entry,index)=>[entry.id,prepared[index].id]));
        for(const sheet of prepared)for(const line of sheet.matchLines??[])line.peerSheet=sheetIds.get(line.peerSheet)??null;
        // One IndexedDB transaction: a storage failure cannot leave half an import.
        await transact("readwrite",transaction=>{
          for(const [index,sheet] of prepared.entries()) {
            transaction.objectStore("files").put(storedFiles[index],sheet.id);
            transaction.objectStore("sheets").put(record(sheet),sheet.id);
          }
          const index=Math.max(0,entries.findIndex(e=>e.id===selectedId));
          transaction.objectStore("meta").put({order:[...sheets,...prepared].map(s=>s.id).concat([...unrestored]),selected:prepared[index].id},"app");
        });
      } catch(error) {
        for(const sheet of prepared)if(sheet.url)URL.revokeObjectURL(sheet.url);
        throw error;
      }
      sheets.push(...prepared);renderList();
      select(prepared[Math.max(0,entries.findIndex(e=>e.id===selectedId))]);
      history.rebase();
      return prepared;
    }

    uploadButton.addEventListener("click", () => fileInput.click());
    // A blank sheet for scratch work and demos: 30000 px square at 2 in/px
    // (5,000 ft, about a mile each way), so roads draw true size right away (Set
    // Scale still applies). Its image is a single white pixel stretched to that
    // size, so it costs nothing to keep; it's saved like an upload, with its size.
    const BLANK = { width: 30000, height: 30000, inchesPerPixel: 2 };
    async function blankFile(name) {
      const canvas = Object.assign(document.createElement("canvas"), { width: 1, height: 1 });
      const context = canvas.getContext("2d");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, 1, 1);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
      return new File([blob], `${name}.png`, { type: "image/png" });
    }
    blankButton.addEventListener("click", async () => {
      if(restoring||switching)return;
      const destination=databaseName;
      const used = sheets.map(sheet => Number(sheet.name.match(/^Blank sheet (\d+)$/)?.[1] ?? 0));
      const name = `Blank sheet ${Math.max(0, ...used) + 1}`;
      fileOperations++;let file;try{file=await blankFile(name);}finally{fileOperations--;}
      if(destination!==databaseName)return;
      await addFiles([file], { name, inchesPerPixel: BLANK.inchesPerPixel, blank: true, width: BLANK.width, height: BLANK.height });
    });
    // Renaming: the list, downloads, and saved sheets take the new name. Not an undo step.
    nameInput.addEventListener("input", () => {
      const name = nameInput.value.trim();
      if (!selected || !name) return;
      selected.name = name;
      renderList();
      scheduleSave(selected);
    });
    nameInput.addEventListener("change", () => { nameInput.value = selected?.name ?? ""; });
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
      document.getElementById("scaleWarning").hidden=!(inches>0&&inches<100);
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
    let trackpadScrollUntil=0;
    workspace.addEventListener("wheel", event => {
      if (!selected) return;
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? stage.clientHeight : 1;
      const dx = event.deltaX * unit;
      const dy = event.deltaY * unit;
      const mode=window.StripeMaker.settings.get('scrollWheelMode');
      // Explicit modes bypass all device guessing and any previous pan burst.
      if(event.ctrlKey){zoomAt(selected,Math.exp(-dy*.01),event.clientX,event.clientY);return;}
      if(mode==='zoom'){zoomAt(selected,Math.exp(-dy*.002),event.clientX,event.clientY);return;}
      if(mode==='pan'){panBy(selected,-dx,-dy);return;}
      const legacy=event.wheelDeltaY;
      // WheelEvent has no device-type flag. A 120-unit notch is mouse evidence
      // even when deltaY is 40 (the same 3:1 ratio some trackpads report), or
      // fractional because of OS scaling. Without legacy notch information,
      // recognize large integral vertical steps. Small/diagonal smooth scrolls
      // begin a pan burst; its momentum stays panning until the burst ends.
      const pixel=event.deltaMode===0,now=performance.now();
      const notch=Number.isFinite(legacy)&&Math.abs(legacy)>=120&&Math.abs(legacy)%120===0;
      const verticalStep=Number.isInteger(event.deltaY)&&Math.abs(event.deltaY)>=40;
      const trackpad=pixel&&(now<trackpadScrollUntil||dx!==0||!(notch||verticalStep));
      if(trackpad)trackpadScrollUntil=now+300;
      if (trackpad) panBy(selected, -dx, -dy);
      else zoomAt(selected, Math.exp(-dy * 0.002), event.clientX, event.clientY);
    }, { passive: false });
    document.addEventListener('settingschange',event=>{if(event.detail?.key==='scrollWheelMode')trackpadScrollUntil=0;});
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
    window.addEventListener("resize", () => { if (selected?.view.fitted) fitSheet(selected); });

    function captureProject(){
      return {sheets:[...sheets],selected,database,unrestored:[...unrestored],restoreErrors:structuredClone(restoreErrors),savedSelection,storageError,history:history.capture()};
    }
    function resumeProject(context){
      sheets.splice(0,sheets.length,...context.sheets);unrestored.clear();context.unrestored.forEach(id=>unrestored.add(id));
      restoreErrors.splice(0,restoreErrors.length,...context.restoreErrors);savedSelection=context.savedSelection;database=context.database;storageError=context.storageError;
      restoring=false;renderList();select(context.selected);history.resume(context.history);
      status.textContent=restoreErrors.map(error=>error.message).join(' ');
    }
    async function activateProject(name,{discardCurrent=false}={}){
      if(name===databaseName)return;
      if(restoring||switching||fileOperations)throw Error('Wait for the current sheet operation to finish.');
      switching=true;workspace.inert=true;
      const previousName=databaseName;
      try{
        document.activeElement?.blur();
        window.StripeMaker.showEditor?.(null);
        // Stop previews/simulation and finish number-field edits before saving.
        history.capture();
        if(!discardCurrent)await flushProject();
        const previous=captureProject();projectContexts.set(previousName,previous);
        clearTimeout(saveTimer);pendingSaves.clear();
        databaseName=name;
        // New sheet IDs never collide with previously visited projects' IDs.
        nextId=Math.max(nextId,Date.now());
        const cached=projectContexts.get(name);
        if(cached)resumeProject(cached);
        else{
          database=null;storageError=null;sheets.splice(0);unrestored.clear();restoreErrors.splice(0);savedSelection=null;
          restoring=true;select(null);renderList();history.resume();
          try{await restore();}catch(error){databaseName=previousName;resumeProject(previous);throw error;}
        }
      }finally{switching=false;workspace.inert=false;}
    }

    // Other tools draw on the selected sheet through this API and the sheetview
    // (pan/zoom) and sheetchange (selection or scale) events.
    const overlays = [];
    (window.StripeMaker ??= {}).sheets = {
      get selected() { return selected; },
      recenter() { if (selected) fitSheet(selected); },
      // Zooms about the middle of the stage (the Zoom In/Out shortcuts).
      zoomBy(factor) {
        if (!selected) return;
        const box = stage.getBoundingClientRect();
        zoomAt(selected, factor, box.left + box.width / 2, box.top + box.height / 2);
      },
      get all() { return sheets; },
      select,
      save: scheduleSave,
      snapshot: sheet => { const {projectArchive,...data}=record(sheet);return structuredClone(data); },
      importProject,activateProject,flush:flushProject,
      get initialized() { return initialized; },
      get ready() { return !restoring&&!switching; },
      diagnostics: () => ({ restoring, unrestored: [...unrestored], restoreErrors: structuredClone(restoreErrors) }),
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
      if (!window.confirm(`Clear all roads, medians, gores, intersections, signs, text, match lines, and markings on “${selected.name}”? You can undo this.`)) return;
      window.StripeMaker.showEditor?.(null);
      // A match line is one paired annotation, including when cleared from either sheet.
      for(const line of selected.matchLines??[]){
        const other=sheets.find(s=>s.id===line.peerSheet);
        if(other){other.matchLines=(other.matchLines??[]).filter(l=>l.id!==line.peerId);scheduleSave(other);}
      }
      Object.assign(selected, { roads: [], joints: [], gores: [], medians: [], intersections: [], signs: [], matchLines: [], markings: [], lines: [], bridges: [], surfaces: [], speedZones: [], vehicleSpawns: [] });
      scheduleSave(selected);
      history.record();
      document.dispatchEvent(new CustomEvent("sheethistory"));
      report("Sheet cleared.");
    });
    const initialized=(window.StripeMaker.projectWorkspace?.ready??Promise.resolve('StripeMaker')).then(name=>{databaseName=name;return restore();}).catch(error=>{saveFailed(error);});
    document.dispatchEvent(new CustomEvent('sheetsinitialized'));
  });
})();
