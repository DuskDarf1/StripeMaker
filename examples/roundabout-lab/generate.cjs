/* node examples/roundabout-lab/generate.cjs
   No dependency, network, browser profile or user project is needed. */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { validate } = require('../../js/project-json.js');
const { reviewCases, structuralCases, movementCases } = require('./cases.cjs');
const root = __dirname;
function png() {
  const crc = bytes => {
    let n = 0xffffffff;
    for (const byte of bytes) { n ^= byte; for (let k = 0; k < 8; k++) n = (n >>> 1) ^ (n & 1 ? 0xedb88320 : 0); }
    return (n ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const name = Buffer.from(type), length = Buffer.alloc(4), sum = Buffer.alloc(4);
    length.writeUInt32BE(data.length); sum.writeUInt32BE(crc(Buffer.concat([name, data])));
    return Buffer.concat([length, name, data, sum]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(1, 0); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(Buffer.from([0, 255, 255, 255, 255]))), chunk('IEND', Buffer.alloc(0))]).toString('base64');
}
const background = png(), cases = [...reviewCases(), ...structuralCases(), ...movementCases()], files = [];
function write(relative, list) {
  const project = { format: 'StripeMakerProject', version: 1, minReaderVersion: 1,
    producer: { name: 'StripeMaker', exporterRevision: 'roundabout-lab-1' }, selectedSheet: 1,
    settings: {}, shortcuts: {}, sheets: list.map((c, i) => ({ id: i + 1, width: c.size, height: c.size,
      labCase: { id: c.id, family: c.family, note: c.note, inputs: c.inputs }, data: c.data,
      file: { name: `${c.id}.png`, type: 'image/png', lastModified: 0, base64: background } })) };
  validate(project);
  fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
  fs.writeFileSync(path.join(root, relative), JSON.stringify(project, null, 2) + '\n');
  files.push({ file: relative, count: list.length, cases: list.map(c => c.id) });
}
write('Roundabout Inspection Library.json', cases.filter(c => c.family === 'review'));
for (const family of ['lane-counts', 'movements']) {
  const list = cases.filter(c => c.family === family);
  for (let i = 0; i < list.length; i += 64) {
    const batch = list.slice(i, i + 64);
    write(`${family}/${batch[0].id}-${batch.at(-1).id}.json`, batch);
  }
}
write('Two-way Lane Count Matrix.json', cases.filter(c => c.family === 'lane-counts' && c.inputs.every(a => a.incoming && a.outgoing)));
const manifest = {
  version: 1, uniqueCases: cases.length, files,
  coverage: {
    laneCounts: 'All 8^4 = 4,096 labeled E/S/W/N combinations of 0–2 entry lanes and 0–2 exit lanes, excluding a 0/0 leg. Automatic circulating lanes stay within 1–2.',
    movements: 'All 16^2 = 256 destination-subset pairs for one two-lane entry, repeated at E/S/W/N: 1,024 cases. Other approaches retain two-lane defaults.',
    review: 'Saved reports; all subsets of spiral entries and gore locations; lane widths; gore widths; medians; diameters; speeds; skew; 2/3/5/6 legs; oval/peanut shapes; attached roads; custom markings; 3/4-lane stress cases.',
    limits: 'Continuous angles, dimensions and arbitrary numbers of approaches have no finite exhaustive set. This is not the Cartesian product of every setting or every destination choice on all eight entry lanes simultaneously (16^8 = 4,294,967,296 assignments). Out-of-range and conflicting cases are intentionally retained.',
  },
  cases: cases.map(({ id, title, note, family, inputs }) => ({ id, title, note, family, inputs })),
};
fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
fs.writeFileSync(path.join(root, 'Inspection Guide.txt'), [
  `ROUNDABOUT INSPECTION LIBRARY — ${cases.length} UNIQUE EDITABLE CASES`, '',
  'IMPORT', 'Sheets > Import Project JSON. Keep imported app settings unchecked. Imports append sheets; they do not replace your existing work.',
  'Start with Roundabout Inspection Library.json. Each sheet and roundabout has a stable R/L/M case ID. Double-click the roundabout to open its movement editor.',
  'Use Two-way Lane Count Matrix.json for the 256 ordinary four-leg one/two-lane count combinations. These are also included in lane-counts; importing both duplicates those examples.',
  'lane-counts/ and movements/ are split into 64-sheet files so you can work through a batch at a time. E/S/W/N identify the actual approach locations, not traffic headings. Counts are entry/exit.', '',
  'WHAT TO INSPECT',
  '1. Spiral tips must open the intended lane, with no line crossing the apron.',
  '2. Lane width is perpendicular to travel. Check the assigned inside/outside widths through curves and the surviving width after a lane drops.',
  '3. Change approach destinations: inspect entry arrows, arrows inside the circle, dotted guides, exit connections and visible movement paths.',
  '4. Gores separate existing lanes. Inspect their tips, width, chevron direction and gaps in YIELD.',
  '5. Check every approach orientation, the wrap around north, and each interacting spiral.',
  '6. Review Design checks. Empty destinations, all-entry/all-exit networks, crossed movements, narrow diameters and out-of-range widths are intentional negative cases.',
  '7. Test custom markings, attached roads, undo/redo, save/reload and vector export on the labeled integration cases.', '',
  'REPORT A CASE', 'Export the selected sheet as Project JSON and include its R/L/M case ID plus what you expected. Keep the inputs that expose the defect; do not repair the fixture to make a failing rendering disappear.', '',
  'COVERAGE', ...Object.values(manifest.coverage), '',
  'GENERATION AND VERIFICATION',
  'Run node examples/roundabout-lab/generate.cjs to regenerate deterministic inputs. Run label-review.browser.cjs for on-sheet review titles, audit.cjs for geometry observations, and verify.browser.cjs for actual import/render/persistence checks.',
  'These are inspection inputs, not approved designs. Validation results belong in audit.json and browser-audit.json; a finite render does not establish correct geometry.', '',
  'REVIEW CASES', ...cases.filter(c => c.family === 'review').flatMap(c => [`${c.id} ${c.title}`, c.note, '']),
].join('\n') + '\n');
console.log(`Generated ${cases.length} unique cases in ${files.length} importable projects (${cases.filter(c => c.family === 'review').length} review cases).`);
