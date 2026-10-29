(() => {
  // Downloads the selected sheet as a PNG: the sheet image with its roads and
  // markings, under a white header with the sheet's title lettered in osifont (an
  // ISO 3098 CAD font, like engineering plan sheets and roll plots).
  const MAX_SIDE = 16384;              // browsers cap a canvas side here
  const MAX_AREA = 16384 * 16384 / 2;  // and keep total pixels well under their limits
  const MIN_WIDTH = 500;
  const DEFAULT_WIDTH = 4096;
  const HEADER_SHARE = 0.05;           // header height as a share of the width
  const ROAD_STYLES = `.roadBand{fill:#3a3b3d;stroke:#3a3b3d;stroke-width:0.6px}
    .roadMarking{fill:none}.roadOutline,.preview{display:none}`;

  document.addEventListener("DOMContentLoaded", () => {
    const sheets = window.StripeMaker.sheets;
    const menu = document.getElementById("downloadMenu");
    const name = document.getElementById("downloadSheetName");
    const range = document.getElementById("downloadWidth");
    const number = document.getElementById("downloadWidthValue");
    const size = document.getElementById("downloadSize");
    const button = document.getElementById("downloadSheet");
    const status = document.getElementById("downloadStatus");
    let width = DEFAULT_WIDTH;
    let busy = false;

    const headerHeight = w => Math.max(40, Math.round(w * HEADER_SHARE));
    // The widest output that fits the canvas limits, never larger than the sheet.
    function maxWidth(sheet) {
      const aspect = sheet.height / sheet.width;
      const byArea = Math.floor(Math.sqrt(MAX_AREA / (aspect + HEADER_SHARE)));
      return Math.max(MIN_WIDTH, Math.min(sheet.width, MAX_SIDE, Math.floor(MAX_SIDE / (aspect + HEADER_SHARE)), byArea));
    }
    function update() {
      const sheet = sheets.selected;
      button.disabled = !sheet || busy;
      range.disabled = number.disabled = !sheet;
      if (!sheet) {
        name.textContent = "Upload a sheet first.";
        size.textContent = "";
        return;
      }
      const max = maxWidth(sheet);
      const min = Math.min(MIN_WIDTH, max);
      for (const input of [range, number]) {
        input.min = min;
        input.max = max;
      }
      width = Math.min(Math.max(width, min), max);
      if (document.activeElement !== range) range.value = width;
      if (document.activeElement !== number) number.value = width;
      const height = Math.round(sheet.height * width / sheet.width) + headerHeight(width);
      name.textContent = sheet.name;
      size.textContent = `${width} × ${height} px`;
    }
    for (const input of [range, number]) {
      input.addEventListener("input", () => {
        const value = Math.round(Number(input.value));
        if (!(value >= Number(input.min) && value <= Number(input.max))) return;
        width = value;
        update();
      });
      input.addEventListener("change", update);
    }

    function roadsImage(sheet) {
      if (!sheet.roadLayer) return Promise.resolve(null);
      const svg = sheet.roadLayer.cloneNode(true);
      svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      svg.setAttribute("width", sheet.width);
      svg.setAttribute("height", sheet.height);
      svg.querySelector(".roadSelection")?.remove();
      const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
      style.textContent = ROAD_STYLES;
      svg.prepend(style);
      const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: "image/svg+xml" }));
      const image = new Image();
      image.src = url;
      return image.decode().then(() => image).finally(() => URL.revokeObjectURL(url));
    }

    async function render(sheet) {
      const scale = width / sheet.width;
      const header = headerHeight(width);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = Math.round(sheet.height * scale) + header;
      const context = canvas.getContext("2d");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      // The sheet: GeoTIFF tiles or a single image.
      context.imageSmoothingQuality = "high";
      for (const part of sheet.content.querySelectorAll("canvas, img")) {
        const x = parseFloat(part.style.left) || 0;
        const y = parseFloat(part.style.top) || 0;
        const w = part.width || part.naturalWidth;
        const h = part.height || part.naturalHeight;
        context.drawImage(part, x * scale, header + y * scale, w * scale, h * scale);
      }
      const roads = await roadsImage(sheet);
      if (roads) context.drawImage(roads, 0, header, width, canvas.height - header);
      // Title header: osifont lettering, slanted like plan-sheet text, over a rule.
      await document.fonts.load(`italic ${header}px osifont`);
      const fontSize = Math.round(header * 0.5);
      context.fillStyle = "#000000";
      context.font = `italic ${fontSize}px osifont, sans-serif`;
      context.textBaseline = "middle";
      context.fillText(sheet.name.toUpperCase(), header * 0.4, header / 2, width - header * 0.8);
      context.fillRect(0, header - Math.max(1, Math.round(header / 30)), width, Math.max(1, Math.round(header / 30)));
      return canvas;
    }

    button.addEventListener("click", async () => {
      const sheet = sheets.selected;
      if (!sheet || busy) return;
      busy = true;
      status.textContent = "Preparing download…";
      update();
      try {
        const canvas = await render(sheet);
        const blob = await new Promise((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error("The image was too large to save."))), "image/png"));
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = `${sheet.name}.png`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 1000);
        status.textContent = "";
      } catch (error) {
        status.textContent = `Couldn't download: ${error?.message || "unknown error"}.`;
      } finally {
        busy = false;
        update();
      }
    });

    new MutationObserver(update).observe(menu, { attributes: true, attributeFilter: ["hidden"] });
    document.addEventListener("sheetchange", update);
    update();
  });
})();
