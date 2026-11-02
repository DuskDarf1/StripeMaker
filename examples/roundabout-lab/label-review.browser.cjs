/* Optional on-sheet titles for the focused review project. Run after generate.
   Uses only a local canvas in an isolated browser; geometry remains editable. */
const fs = require('node:fs'), path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const file = path.join(__dirname, 'Roundabout Inspection Library.json'), project = JSON.parse(fs.readFileSync(file));
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  try {
    const page = await browser.newPage();
    for (const sheet of project.sheets) {
      // Keep decoded backgrounds small even for long high-speed approaches.
      // Change sheet pixels and scale together; all physical feet stay exact.
      const factor = 1600 / sheet.width;
      sheet.width = sheet.height = sheet.data.width = sheet.data.height = 1600;
      sheet.data.inchesPerPixel /= factor;
      for (const point of [...sheet.data.intersections, ...sheet.data.joints]) { point.x *= factor; point.y *= factor; }
      sheet.file.base64 = await page.evaluate(sheet => {
        const canvas = document.createElement('canvas'); canvas.width = sheet.width; canvas.height = sheet.height;
        const c = canvas.getContext('2d'), unit = sheet.width / 2200;
        c.fillStyle = '#f4f6f9'; c.fillRect(0, 0, canvas.width, canvas.height);
        c.scale(unit, unit); c.fillStyle = '#14263d'; c.font = 'bold 38px sans-serif';
        c.fillText(sheet.data.name, 65, 80); c.font = '26px sans-serif';
        let line = '', y = 128;
        for (const word of sheet.labCase.note.split(' ')) {
          if (c.measureText(line + word).width > 2050) { c.fillText(line, 65, y); y += 35; line = ''; }
          line += word + ' ';
        }
        c.fillText(line, 65, y);
        c.font = '23px sans-serif';
        c.fillText('Double-click to edit. Export the selected sheet with its case ID when reporting a defect.', 65, 2135);
        return canvas.toDataURL('image/png').split(',')[1];
      }, sheet);
      sheet.data.blank = false;
    }
    fs.writeFileSync(file, JSON.stringify(project, null, 2) + '\n');
    console.log(`Labeled ${project.sheets.length} review sheets.`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
