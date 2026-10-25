(() => {
  // Sheets are uploaded aerial images. GeoTIFFs decode with the vendored geotiff.js
  // into 4096 px canvas tiles (browsers cap single canvases); JPEG and PNG use <img>.
  const TILE = 4096;
  const SUPPORTED = /\.(tiff?|jpe?g|png)$/i;
  // GeoTIFF ProjLinearUnitsGeoKey codes: metre, international foot, US survey foot.
  const INCHES_PER_UNIT = { 9001: 1 / 0.0254, 9002: 12, 9003: 1200 / 3937 / 0.0254 };

  document.addEventListener("DOMContentLoaded", () => {
    const workspace = document.getElementById("workspace");
    const stage = document.getElementById("previewStage");
    const fileInput = document.getElementById("sheetFile");
    const uploadButton = document.getElementById("uploadSheet");
    const removeButton = document.getElementById("removeSheet");
    const list = document.getElementById("sheetList");
    const empty = document.getElementById("sheetsEmpty");
    const status = document.getElementById("sheetStatus");
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
    function fitSheet(sheet) {
      const box = stage.getBoundingClientRect();
      const scale = Math.min(box.width / sheet.width, box.height / sheet.height);
      sheet.view = { scale, x: (box.width - sheet.width * scale) / 2, y: (box.height - sheet.height * scale) / 2, fitted: true };
      applyView(sheet);
    }
    function applyView(sheet) {
      const { scale, x, y } = sheet.view;
      sheet.content.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
    }
    function zoomAt(sheet, factor, clientX, clientY) {
      const box = stage.getBoundingClientRect();
      const view = sheet.view;
      const fit = Math.min(box.width / sheet.width, box.height / sheet.height);
      const scale = Math.min(8, Math.max(fit / 2, view.scale * factor));
      const px = clientX - box.left;
      const py = clientY - box.top;
      view.x = px - (px - view.x) * (scale / view.scale);
      view.y = py - (py - view.y) * (scale / view.scale);
      view.scale = scale;
      view.fitted = false;
      applyView(sheet);
    }

    function formatScale(inches) {
      if (!inches) return "No scale";
      return `${inches < 10 ? inches.toFixed(1) : Math.round(inches)} in/px`;
    }

    function renderList() {
      list.replaceChildren(...sheets.map(sheet => {
        const item = document.createElement("li");
        const button = document.createElement("button");
        button.type = "button";
        button.className = "headListButton";
        button.dataset.sheetId = sheet.id;
        const name = document.createElement("span");
        name.textContent = sheet.name;
        const scale = document.createElement("span");
        scale.className = "sheetScale";
        scale.textContent = formatScale(sheet.inchesPerPixel);
        button.append(name, scale);
        button.title = `${sheet.name} (${sheet.width} × ${sheet.height} px)`;
        item.append(button);
        return item;
      }));
      empty.hidden = sheets.length > 0;
      updateSelection();
    }
    function updateSelection() {
      list.querySelectorAll(".headListButton").forEach(button => {
        const active = Number(button.dataset.sheetId) === selected?.id;
        button.classList.toggle("active", active);
        button.setAttribute("aria-pressed", String(active));
      });
      removeButton.disabled = !selected;
    }

    function select(sheet) {
      selected = sheet;
      stage.replaceChildren(...(sheet ? [sheet.content] : []));
      workspace.classList.toggle("hasSheet", Boolean(sheet));
      if (sheet && !sheet.view) fitSheet(sheet);
      updateSelection();
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
          const decoded = /\.tiff?$/i.test(file.name) ? await decodeTiff(file) : await decodeImage(file);
          decoded.content.className = "sheetImage";
          decoded.content.style.width = `${decoded.width}px`;
          decoded.content.style.height = `${decoded.height}px`;
          const sheet = { id: nextId++, name: file.name.replace(/\.[^.]+$/, ""), ...decoded };
          sheets.push(sheet);
          renderList();
          select(sheet);
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
    list.addEventListener("click", event => {
      const button = event.target.closest(".headListButton");
      if (button) select(sheets.find(sheet => sheet.id === Number(button.dataset.sheetId)));
    });
    removeButton.addEventListener("click", () => {
      const index = sheets.indexOf(selected);
      if (index < 0) return;
      const [removed] = sheets.splice(index, 1);
      if (removed.url) URL.revokeObjectURL(removed.url);
      select(sheets[Math.min(index, sheets.length - 1)] ?? null);
      renderList();
    });

    workspace.addEventListener("wheel", event => {
      if (!selected) return;
      event.preventDefault();
      zoomAt(selected, Math.exp(-event.deltaY * 0.0015), event.clientX, event.clientY);
    }, { passive: false });

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
        selected.view.x += current.x - last.x;
        selected.view.y += current.y - last.y;
        selected.view.fitted = false;
        applyView(selected);
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
    workspace.addEventListener("dblclick", () => { if (selected) fitSheet(selected); });
    window.addEventListener("resize", () => { if (selected?.view.fitted) fitSheet(selected); });
  });
})();
