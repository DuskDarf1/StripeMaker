(() => {
  // Downloads the selected sheet as a PNG or PDF: the sheet image with its roads
  // and markings, under a white header with the sheet's title lettered in osifont
  // (an ISO 3098 CAD font, like engineering plan sheets and roll plots).
  const MAX_SIDE = 16384;              // browsers cap a canvas side here
  const MAX_AREA = 16384 * 16384 / 2;  // and keep total pixels well under their limits
  const MIN_WIDTH = 500;
  const DEFAULT_WIDTH = 4096;
  const HEADER_SHARE = 0.05;           // header height as a share of the width
  const PDF_PIXELS_PER_INCH = 150;     // PDF page size: the image printed at 150 ppi
  const PDF_MAX_POINTS = 14400;        // PDF pages are at most 200 in on a side
  const PDF_JPEG_QUALITY = 0.92;
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
    const formatHint = document.getElementById("downloadFormatHint");
    const formatButtons = [...menu.querySelectorAll("[data-format]")];
    let format = "png";
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
      size.textContent = format === "pdf"
        ? `${width} × ${height} px, ${(width / PDF_PIXELS_PER_INCH).toFixed(1)} × ${(height / PDF_PIXELS_PER_INCH).toFixed(1)} in page`
        : `${width} × ${height} px`;
    }
    formatButtons.forEach(choice => choice.addEventListener("click", () => {
      format = choice.dataset.format;
      formatButtons.forEach(other => other.setAttribute("aria-pressed", String(other === choice)));
      formatHint.textContent = format.toUpperCase();
      update();
    }));
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

    const toBlob = (canvas, type, quality) => new Promise((resolve, reject) => canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error("The image was too large to save."))), type, quality));
    // A one-page PDF holding the image as a JPEG, the page sized to print it at
    // 150 ppi (smaller if that would pass the 200 in page limit).
    async function pdfBlob(canvas, title) {
      const jpeg = new Uint8Array(await (await toBlob(canvas, "image/jpeg", PDF_JPEG_QUALITY)).arrayBuffer());
      const fit = Math.min(72 / PDF_PIXELS_PER_INCH, PDF_MAX_POINTS / canvas.width, PDF_MAX_POINTS / canvas.height);
      const pageWidth = (canvas.width * fit).toFixed(2);
      const pageHeight = (canvas.height * fit).toFixed(2);
      const drawing = `q ${pageWidth} 0 0 ${pageHeight} 0 0 cm /Im0 Do Q`;
      // The title as a UTF-16BE text string, so any characters survive.
      const text = `<FEFF${title.split("").map(c => c.charCodeAt(0).toString(16).padStart(4, "0")).join("").toUpperCase()}>`;
      const objects = [
        ["<< /Type /Catalog /Pages 2 0 R >>"],
        ["<< /Type /Pages /Kids [3 0 R] /Count 1 >>"],
        [`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`],
        [`<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`, jpeg, "\nendstream"],
        [`<< /Length ${drawing.length} >>\nstream\n${drawing}\nendstream`],
        [`<< /Title ${text} /Producer (StripeMaker) >>`],
      ];
      const encoder = new TextEncoder();
      const parts = [encoder.encode("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n")];
      let length = parts[0].length;
      const offsets = [];
      objects.forEach((pieces, i) => {
        offsets.push(length);
        for (const piece of [`${i + 1} 0 obj\n`, ...pieces, "\nendobj\n"]) {
          const bytes = typeof piece === "string" ? encoder.encode(piece) : piece;
          parts.push(bytes);
          length += bytes.length;
        }
      });
      const xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(at => `${String(at).padStart(10, "0")} 00000 n \n`).join("")}`;
      parts.push(encoder.encode(`${xref}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${length}\n%%EOF\n`));
      return new Blob(parts, { type: "application/pdf" });
    }

    button.addEventListener("click", async () => {
      const sheet = sheets.selected;
      if (!sheet || busy) return;
      busy = true;
      status.textContent = "Preparing download…";
      update();
      try {
        const canvas = await render(sheet);
        const blob = format === "pdf" ? await pdfBlob(canvas, sheet.name) : await toBlob(canvas, "image/png");
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = `${sheet.name}.${format}`;
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
