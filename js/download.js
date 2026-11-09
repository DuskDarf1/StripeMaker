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
  const TITLE_SLANT = 0.21;            // about 12°, like slanted plan-sheet lettering
  const asphalt = () => window.StripeMaker.settings.pavementColor();
  const BAND_EDGE = 0.6;               // pavement outline width, sheet pixels
  const roadStyles = () => `.roadBand{fill:${asphalt()};stroke:${asphalt()};stroke-width:${BAND_EDGE}px}
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
    const selectArea = document.getElementById("downloadSelectArea");
    const wholeSheet = document.getElementById("downloadWholeSheet");
    const areaStatus = document.getElementById("downloadAreaStatus");
    const areas = new WeakMap();
    const overlay = document.createElement("div");
    overlay.className = "downloadAreaOverlay";
    overlay.tabIndex = -1;
    overlay.setAttribute("aria-label", "Export area. Drag a box, or use arrow keys and Enter to set two corners. Escape cancels.");
    sheets.addOverlay(overlay);
    let selection = null;
    const areaHint = "Drag a box to export. Arrow keys and Enter also set corners. Escape cancels.";
    let format = "png";
    let width = DEFAULT_WIDTH;
    let busy = false;

    const headerHeight = w => Math.max(40, Math.round(w * HEADER_SHARE));
    const imageHeightFor = (area,w) => Math.max(1,Math.round(area.height*w/area.width));
    // The widest output that fits the canvas limits, never larger than the sheet.
    const exportArea = sheet => areas.get(sheet) ?? { x:0, y:0, width:sheet.width, height:sheet.height };
    function maxWidth(area) {
      const aspect = area.height / area.width;
      const byArea = Math.floor(Math.sqrt(MAX_AREA / (aspect + HEADER_SHARE)));
      let max = Math.max(1,Math.floor(Math.min(area.width, MAX_SIDE, MAX_SIDE / (aspect + HEADER_SHARE), byArea)));
      while(max>1 && (Math.round(aspect*max)+headerHeight(max)>MAX_SIDE || max*(Math.round(aspect*max)+headerHeight(max))>MAX_AREA))max--;
      return max;
    }
    function update() {
      const sheet = sheets.selected;
      button.disabled = !sheet || busy;
      range.disabled = number.disabled = selectArea.disabled = !sheet || busy;
      wholeSheet.disabled = !sheet || !areas.has(sheet) || busy;
      formatButtons.forEach(choice=>{choice.disabled=busy;});
      if (!sheet) {
        name.textContent = "Upload a sheet first.";
        size.textContent = "";
        areaStatus.textContent = "Whole sheet";
        drawArea();
        return;
      }
      const area = exportArea(sheet), cropped = areas.has(sheet);
      const max = maxWidth(area);
      const min = Math.min(MIN_WIDTH, max);
      for (const input of [range, number]) {
        input.min = min;
        input.max = max;
      }
      width = Math.min(Math.max(width, min), max);
      if (document.activeElement !== range) range.value = width;
      if (document.activeElement !== number) number.value = width;
      const height = imageHeightFor(area,width) + headerHeight(width);
      name.textContent = sheet.name;
      areaStatus.textContent = cropped ? `Selected area: ${area.width} × ${area.height} sheet px` : "Whole sheet";
      button.textContent = cropped ? "Download Area" : "Download Sheet";
      selectArea.textContent = cropped ? "Reselect Area" : "Select Area";
      size.textContent = format === "pdf"
        ? `${width} × ${height} px, ${(width / PDF_PIXELS_PER_INCH).toFixed(1)} × ${(height / PDF_PIXELS_PER_INCH).toFixed(1)} in page`
        : `${width} × ${height} px`;
      drawArea();
    }
    function box(a,b) {
      const x=Math.floor(Math.min(a.x,b.x)),y=Math.floor(Math.min(a.y,b.y));
      return {x,y,width:Math.ceil(Math.max(a.x,b.x))-x,height:Math.ceil(Math.max(a.y,b.y))-y};
    }
    function clamp(point) {
      const sheet=sheets.selected;
      return {x:Math.max(0,Math.min(sheet.width,point.x)),y:Math.max(0,Math.min(sheet.height,point.y))};
    }
    function drawArea() {
      overlay.replaceChildren();
      overlay.classList.toggle("drawing",Boolean(selection));
      const sheet=sheets.selected,area=selection?.start?box(selection.start,selection.point):sheet&&areas.get(sheet);
      overlay.hidden=!sheet || (!selection && (menu.hidden || !area));
      if(overlay.hidden)return;
      const svg=document.createElementNS("http://www.w3.org/2000/svg","svg");svg.setAttribute("aria-hidden","true");overlay.append(svg);
      if(area){
        const p=sheets.toScreen(area),rect=document.createElementNS(svg.namespaceURI,"rect");
        for(const [key,value] of Object.entries({x:p.x,y:p.y,width:area.width*sheet.view.scale,height:area.height*sheet.view.scale,class:"selectionBox"}))rect.setAttribute(key,value);
        svg.append(rect);
      }
      if(selection){
        const p=sheets.toScreen(selection.point),cross=document.createElementNS(svg.namespaceURI,"path");
        cross.setAttribute("d",`M ${p.x-7} ${p.y} L ${p.x+7} ${p.y} M ${p.x} ${p.y-7} L ${p.x} ${p.y+7}`);
        cross.setAttribute("stroke","#ffdf00");svg.append(cross);
      }
    }
    function endSelection(openMenu=true) {
      if(selection?.pointer!=null && overlay.hasPointerCapture(selection.pointer))overlay.releasePointerCapture(selection.pointer);
      selection=null;
      const hint=document.getElementById("actionStatus");if(hint.textContent===areaHint)hint.textContent="";
      if(openMenu){window.StripeMaker.showEditor("downloadMenu");button.focus({preventScroll:true});}
      update();
    }
    function applySelection() {
      const area=box(selection.start,selection.point);
      if(area.width<1 || area.height<1)return false;
      areas.set(sheets.selected,area);endSelection();return true;
    }
    selectArea.addEventListener("click",()=>{
      if(!sheets.selected || busy)return;
      window.StripeMaker.showEditor(null);
      const stage=document.getElementById("previewStage").getBoundingClientRect();
      selection={point:clamp(sheets.toImage(stage.left+stage.width/2,stage.top+stage.height/2)),start:null,pointer:null};
      document.getElementById("actionStatus").textContent=areaHint;
      drawArea();overlay.focus({preventScroll:true});
    });
    wholeSheet.addEventListener("click",()=>{if(sheets.selected)areas.delete(sheets.selected);update();});
    overlay.addEventListener("pointerdown",event=>{
      if(!selection || event.button!==0 || !event.isPrimary)return;
      event.preventDefault();event.stopPropagation();
      selection.start=selection.point=clamp(sheets.toImage(event.clientX,event.clientY));selection.pointer=event.pointerId;
      overlay.setPointerCapture(event.pointerId);drawArea();
    });
    overlay.addEventListener("pointermove",event=>{
      if(!selection || selection.pointer!==event.pointerId)return;
      event.preventDefault();event.stopPropagation();selection.point=clamp(sheets.toImage(event.clientX,event.clientY));drawArea();
    });
    overlay.addEventListener("pointerup",event=>{
      if(!selection || selection.pointer!==event.pointerId)return;
      event.preventDefault();event.stopPropagation();selection.point=clamp(sheets.toImage(event.clientX,event.clientY));
      if(!applySelection()){overlay.releasePointerCapture(event.pointerId);selection.pointer=null;selection.start=null;drawArea();}
    });
    overlay.addEventListener("pointercancel",event=>{if(selection){event.stopPropagation();endSelection();}});
    overlay.addEventListener("click",event=>event.stopPropagation());
    document.addEventListener("keydown",event=>{
      if(!selection)return;
      const moves={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};
      if(event.key==="Escape"){event.preventDefault();event.stopImmediatePropagation();endSelection();}
      else if(event.key==="Enter" || event.key===" "){
        event.preventDefault();event.stopImmediatePropagation();
        if(selection.start)applySelection();else {selection.start={...selection.point};drawArea();}
      }else if(moves[event.key]){
        event.preventDefault();event.stopImmediatePropagation();const [x,y]=moves[event.key],step=(event.shiftKey?10:1)/sheets.selected.view.scale;
        selection.point=clamp({x:selection.point.x+x*step,y:selection.point.y+y*step});drawArea();
      }
    },true);
    document.getElementById("configBar").addEventListener("click",()=>{if(selection)endSelection(false);});
    document.addEventListener("sheetview",drawArea);
    window.addEventListener("resize",drawArea);
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

    function roadsImage(sheet, area, outputWidth) {
      if (!sheet.roadLayer) return Promise.resolve(null);
      const svg = sheet.roadLayer.cloneNode(true);
      svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      svg.setAttribute("viewBox",`${area.x} ${area.y} ${area.width} ${area.height}`);
      svg.setAttribute("width", outputWidth);
      svg.setAttribute("height", area.height*outputWidth/area.width);
      svg.setAttribute("preserveAspectRatio","none");
      svg.querySelector(".roadSelection")?.remove();
      const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
      style.textContent = roadStyles();
      svg.prepend(style);
      const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: "image/svg+xml" }));
      const image = new Image();
      image.src = url;
      return image.decode().then(() => image).finally(() => URL.revokeObjectURL(url));
    }

    // The sheet itself: GeoTIFF tiles or a single image.
    function drawSheet(context, sheet, scale, top, area) {
      context.imageSmoothingQuality = "high";
      context.save();context.beginPath();context.rect(0,top,area.width*scale,area.height*scale);context.clip();
      for (const part of sheet.content.querySelectorAll("canvas, img")) {
        const x = parseFloat(part.style.left) || 0;
        const y = parseFloat(part.style.top) || 0;
        const w = part.width || part.naturalWidth;
        const h = part.height || part.naturalHeight;
        if(x+w<area.x || y+h<area.y || x>area.x+area.width || y>area.y+area.height)continue;
        context.drawImage(part, (x-area.x) * scale, top + (y-area.y) * scale, w * scale, h * scale);
      }
      context.restore();
    }
    const titleSize = header => Math.round(header * 0.5);
    const ruleSize = header => Math.max(1, Math.round(header / 30));

    async function render(sheet, area, width) {
      await window.StripeMaker.signs?.ready(sheet);
      const scale = width / area.width;
      const header = headerHeight(width);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = imageHeightFor(area,width) + header;
      const context = canvas.getContext("2d");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      drawSheet(context, sheet, scale, header, area);
      const roads = await roadsImage(sheet, area, width);
      if (roads) context.drawImage(roads, 0, header, width, area.height*scale);
      // Title header: osifont lettering, slanted like plan-sheet text, over a rule.
      await document.fonts.load(`italic ${header}px osifont`);
      context.fillStyle = "#000000";
      context.font = `italic ${titleSize(header)}px osifont, sans-serif`;
      context.textBaseline = "middle";
      context.fillText(sheet.name.toUpperCase(), header * 0.4, header / 2, width - header * 0.8);
      context.fillRect(0, header - ruleSize(header), width, ruleSize(header));
      return canvas;
    }

    const toBlob = (canvas, type, quality) => new Promise((resolve, reject) => canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error("The image was too large to save."))), type, quality));
    async function deflate(bytes) {
      const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate"));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    }
    const n = value => (Math.round(value * 100) / 100).toString();
    const rgb = hex => {
      const value = parseInt(hex.replace("#", "").replace(/^(.)(.)(.)$/, "$1$1$2$2$3$3"), 16);
      return [value >> 16, (value >> 8) & 255, value & 255].map(c => n(c / 255)).join(" ");
    };
    // SVG path data as drawn by the road layer (M, L, and Z only) to PDF path ops.
    const pathOps = d => d.match(/[MLZ]|-?\d*\.?\d+(?:e-?\d+)?/gi).reduce((ops, token, i, tokens) => {
      if (token === "Z" || token === "z") ops.push("h");
      else if (/[ML]/i.test(token)) {
        for (let j = i + 1; j + 1 < tokens.length && !/[MLZ]/i.test(tokens[j]); j += 2) {
          ops.push(`${n(+tokens[j])} ${n(+tokens[j + 1])} ${token.toUpperCase() === "M" && j === i + 1 ? "m" : "l"}`);
        }
      }
      return ops;
    }, []).join("\n");
    // The road layer as PDF vector drawing, in sheet pixels: pavement, markings,
    // gore stripes clipped to their gores, and each road's lines clipped away from
    // the roads joined to it (the SVG mask, as one even-odd clip per hole).
    function roadOps(svg, images = new Map()) {
      const out = [];
      const byId = id => svg.querySelector(`[id="${id.replace(/^url\(#|\)$/g, "")}"]`);
      const walk = node => {
        if (!(node instanceof SVGElement)) return;
        const name = node.tagName.toLowerCase();
        const classes = node.classList;
        if (["mask", "clippath", "style", "defs"].includes(name)
          || classes.contains("roadSelection") || classes.contains("roadOutline") || classes.contains("preview")) return;
        if (name === "g") {
          out.push("q");
          const mask = node.getAttribute("mask") && byId(node.getAttribute("mask"));
          if (mask) {
            const all = mask.querySelector("rect");
            const box = ["x", "y", "width", "height"].map(key => n(+all.getAttribute(key))).join(" ");
            for (const hole of mask.querySelectorAll("path")) out.push(`${box} re\n${pathOps(hole.getAttribute("d"))}\nW* n`);
          }
          const clip = node.getAttribute("clip-path") && byId(node.getAttribute("clip-path"));
          if (clip) for (const shape of clip.querySelectorAll("path")) {
            const evenOdd=(shape.getAttribute('clip-rule')??clip.getAttribute('clip-rule'))==='evenodd';
            out.push(`${pathOps(shape.getAttribute("d"))}\n${evenOdd?'W*':'W'} n`);
          }
          [...node.children].forEach(walk);
          out.push("Q");
          return;
        }
        if (name === "image") {
          const image=images.get(node.getAttribute('href'));
          if(image){
            const matrix=node.getAttribute('transform').match(/matrix\(([^)]+)\)/)[1].trim().split(/\s+/).map(Number);
            const [a,b,c,d,e,f]=matrix;
            out.push(`q ${[a,b,-c,-d,e+c,f+d].map(n).join(' ')} cm /${image.name} Do Q`);
          }
          return;
        }
        if (name !== "path") return;
        const band = classes.contains("roadBand");
        const fill = node.getAttribute("fill") ?? (band ? asphalt() : null);
        const stroke = node.getAttribute("stroke") ?? (band ? asphalt() : null);
        const ops = [pathOps(node.getAttribute("d"))];
        if (stroke) {
          // Miter joins with SVG's miter limit, or round joins (contrast borders).
          ops.unshift(`${rgb(stroke)} RG ${n(+(node.getAttribute("stroke-width") ?? BAND_EDGE))} w ${node.getAttribute("stroke-linejoin") === "round" ? "1 j" : "0 j 4 M"}`);
          const dash = node.getAttribute("stroke-dasharray");
          ops.unshift(dash ? `[${dash.split(/[\s,]+/).map(v => n(+v)).join(" ")}] ${n(+(node.getAttribute("stroke-dashoffset") ?? 0))} d` : "[] 0 d");
        }
        if (fill && fill !== "none") ops.unshift(`${rgb(fill)} rg`);
        const evenOdd = node.getAttribute("fill-rule") === "evenodd";
        ops.push(fill && fill !== "none" ? (stroke ? (evenOdd ? "B*" : "B") : (evenOdd ? "f*" : "f")) : "S");
        out.push(ops.join("\n"));
      };
      [...svg.children].forEach(walk);
      return out.join("\n");
    }
    // WinAnsi codes for the title, since the embedded font uses that encoding.
    const WIN_ANSI_EXTRA = "€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ";
    const winAnsi = char => {
      const code = char.charCodeAt(0);
      if ((code >= 32 && code < 127) || (code >= 160 && code <= 255)) return code;
      const extra = WIN_ANSI_EXTRA.indexOf(char);
      return extra >= 0 ? 128 + extra : 63;
    };
    // A one-page PDF: the sheet image under vector roads and markings, with the
    // title in embedded osifont. The page prints the chosen width at 150 ppi
    // (smaller if that would pass the 200 in page limit).
    async function pdfBlob(sheet, area, width) {
      await window.StripeMaker.signs?.ready(sheet);
      const header = headerHeight(width);
      const imageHeight = imageHeightFor(area,width);
      const fit = Math.min(72 / PDF_PIXELS_PER_INCH, PDF_MAX_POINTS / width, PDF_MAX_POINTS / (imageHeight + header));
      const pageWidth = width * fit;
      const pageHeight = (imageHeight + header) * fit;
      const headerPoints = header * fit;
      // The sheet image alone, at the chosen width.
      const photo = document.createElement("canvas");
      photo.width = width;
      photo.height = imageHeight;
      const context = photo.getContext("2d");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, imageHeight);
      drawSheet(context, sheet, width / area.width, 0, area);
      const jpeg = new Uint8Array(await (await toBlob(photo, "image/jpeg", PDF_JPEG_QUALITY)).arrayBuffer());
      // Title widths come from the loaded font, in thousandths of an em.
      await document.fonts.load("italic 100px osifont");
      const measure = document.createElement("canvas").getContext("2d");
      measure.font = "1000px osifont";
      const widths = Array.from({ length: 224 }, (_, i) => {
        const code = i + 32;
        const char = code >= 128 && code < 160 ? WIN_ANSI_EXTRA[code - 128] : String.fromCharCode(code);
        return Math.round(measure.measureText(char).width);
      });
      const title = [...sheet.name.toUpperCase()].map(winAnsi);
      const size = titleSize(header) * fit;
      const textWidth = title.reduce((sum, code) => sum + widths[code - 32], 0) / 1000 * size;
      const room = (width - header * 0.8) * fit;
      const squeeze = textWidth > room ? (room / textWidth) * 100 : 100;
      const literal = `(${title.map(code => (code === 40 || code === 41 || code === 92 ? `\\${String.fromCharCode(code)}`
        : code < 127 ? String.fromCharCode(code) : `\\${code.toString(8).padStart(3, "0")}`)).join("")})`;
      const k = pageWidth / area.width;
      const signImages=new Map(),imageObjects=[];
      for(const node of sheet.roadLayer?.querySelectorAll('image')??[]){
        const src=node.getAttribute('href');if(signImages.has(src))continue;
        const image=new Image();image.src=src;await image.decode();
        const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
        const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);
        const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;
        const color=new Uint8Array(pixels.length/4*3),alpha=new Uint8Array(pixels.length/4);
        for(let i=0;i<alpha.length;i++){color.set(pixels.subarray(i*4,i*4+3),i*3);alpha[i]=pixels[i*4+3];}
        const [rgbBytes,alphaBytes]=await Promise.all([deflate(color),deflate(alpha)]);
        const object=10+imageObjects.length,name=`Sign${signImages.size}`;
        signImages.set(src,{object,name});
        const stream=(bytes,space,extra='')=>[`<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} /ColorSpace /${space} /BitsPerComponent 8 /Filter /FlateDecode ${extra} /Length ${bytes.length} >>\nstream\n`,bytes,'\nendstream'];
        imageObjects.push(stream(rgbBytes,'DeviceRGB',`/SMask ${object+1} 0 R`),stream(alphaBytes,'DeviceGray'));
      }
      const content = [
        "1 1 1 rg", `0 0 ${n(pageWidth)} ${n(pageHeight)} re f`,
        // Preserve sheet coordinates for all vector paths, and clip/translate
        // the selected area into the page below its unchanged title header.
        "q", `${+k.toFixed(8)} 0 0 ${+(-k).toFixed(8)} ${n(-area.x*k)} ${n(pageHeight - headerPoints + area.y*k)} cm`,
        `${area.x} ${area.y} ${area.width} ${area.height} re W n`,
        "q", `${area.width} 0 0 ${-area.height} ${area.x} ${area.y+area.height} cm`, "/Im0 Do", "Q",
        sheet.roadLayer ? roadOps(sheet.roadLayer, signImages) : "",
        "Q",
        // Header rule and slanted title.
        "0 0 0 rg", `0 ${n(pageHeight - headerPoints)} ${n(pageWidth)} ${n(ruleSize(header) * fit)} re f`,
        "BT", `/F1 1 Tf ${n(squeeze)} Tz`,
        `${n(size)} 0 ${n(size * TITLE_SLANT)} ${n(size)} ${n(header * 0.4 * fit)} ${n(pageHeight - headerPoints / 2 - size * 0.35)} Tm`,
        `${literal} Tj`, "ET",
      ].join("\n");
      const encoder = new TextEncoder();
      const contentBytes = await deflate(encoder.encode(content));
      let fontFile;
      if (location.protocol === "file:") {
        if (!window.StripeMaker.pdfFontBase64) await new Promise((resolve, reject) => {
          const script = document.createElement("script");
          script.src = "fonts/osifont-data.js";
          script.onload = () => { script.remove(); resolve(); };
          script.onerror = () => { script.remove(); reject(new Error("Could not load the PDF title font.")); };
          document.head.append(script);
        });
        fontFile = Uint8Array.from(atob(window.StripeMaker.pdfFontBase64), char => char.charCodeAt(0));
      } else fontFile = new Uint8Array(await (await fetch("fonts/osifont.ttf")).arrayBuffer());
      const fontBytes = await deflate(fontFile);
      // The title as a UTF-16BE text string, so any characters survive.
      const info = `<FEFF${sheet.name.split("").map(c => c.charCodeAt(0).toString(16).padStart(4, "0")).join("").toUpperCase()}>`;
      const objects = [
        ["<< /Type /Catalog /Pages 2 0 R >>"],
        ["<< /Type /Pages /Kids [3 0 R] /Count 1 >>"],
        [`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(pageWidth)} ${n(pageHeight)}] /Resources << /XObject << /Im0 4 0 R ${[...signImages.values()].map(i=>`/${i.name} ${i.object} 0 R`).join(' ')} >> /Font << /F1 7 0 R >> >> /Contents 5 0 R >>`],
        [`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${imageHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`, jpeg, "\nendstream"],
        [`<< /Length ${contentBytes.length} /Filter /FlateDecode >>\nstream\n`, contentBytes, "\nendstream"],
        [`<< /Title ${info} /Producer (StripeMaker) >>`],
        [`<< /Type /Font /Subtype /TrueType /BaseFont /Osifont /FirstChar 32 /LastChar 255 /Widths [${widths.join(" ")}] /Encoding /WinAnsiEncoding /FontDescriptor 8 0 R >>`],
        ["<< /Type /FontDescriptor /FontName /Osifont /Flags 32 /FontBBox [-200 -250 1200 1000] /ItalicAngle 0 /Ascent 800 /Descent -200 /CapHeight 700 /StemV 80 /FontFile2 9 0 R >>"],
        [`<< /Length ${fontBytes.length} /Length1 ${fontFile.length} /Filter /FlateDecode >>\nstream\n`, fontBytes, "\nendstream"],
      ];
      objects.push(...imageObjects);
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
      const area={...exportArea(sheet)},outputWidth=width,outputFormat=format;
      busy = true;
      status.textContent = "Preparing download…";
      update();
      // Roads left for the after-drag refresh are brought up to date first, and
      // every level is drawn, even ones hidden in Settings.
      window.StripeMaker.roadEditor?.flush();
      const allLevels = window.StripeMaker.levels?.showingAll ?? (run => run());
      try {
        const blob = await allLevels(async () => outputFormat === "pdf" ? await pdfBlob(sheet,area,outputWidth) : await toBlob(await render(sheet,area,outputWidth), "image/png"));
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = `${sheet.name}.${outputFormat}`;
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
    document.addEventListener("sheetchange", ()=>{if(selection)endSelection(false);else update();});
    update();
  });
})();
