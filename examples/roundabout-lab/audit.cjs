/* Observe all generated inputs without rewriting or rejecting failing cases. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const R = require('../../js/roundabout-geometry.js');
const G = require('../../js/intersection-geometry.js');
const root = __dirname, manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json')));
const seen = new Set(), results = [];
function finite(value) {
  if (typeof value === 'number') return Number.isFinite(value);
  return !value || typeof value !== 'object' || Object.values(value).every(finite);
}
for (const file of manifest.files) {
  const project = JSON.parse(fs.readFileSync(path.join(root, file.file)));
  for (const sheet of project.sheets) {
    const id = sheet.labCase.id;
    if (seen.has(id)) continue;
    seen.add(id);
    const item = sheet.data.intersections[0], result = { id };
    try {
      const L = R.layout(item), paint = R.markings(item, null);
      Object.assign(result, { lanes: L.C, spirals: L.spiralPlan?.transitions.length ?? 0, demand: R.demand(item),
        validation: R.validate(item), designChecks: R.checks(item),
        finite: finite([R.outline(item), R.surfaces(item), paint, R.tracks(item)]),
        arrows: item.approaches.map(a => R.circulatingArrows(item, a).map(v => v?.type ?? null)) });
      if (sheet.labCase.family === 'review') {
        let minClearance = Infinity, pathCount = 0;
        for (const a of item.approaches) for (const [j, lane] of a.inLanes.entries()) for (const id of R.destinations(item, a, lane)) {
          const points = R.path(item, a, j, item.approaches.find(b => b.id === id));
          result.finite &&= finite(points); pathCount++;
          minClearance = Math.min(minClearance, ...points.map(p => G.length(p) - L.inner.radius(Math.atan2(p.y, p.x))));
        }
        result.movementPaths = pathCount;
        result.minimumRadialApronClearance = Number.isFinite(minClearance) ? +minClearance.toFixed(3) : null;
      }
    } catch (error) { result.error = error.message; result.finite = false; }
    results.push(result);
  }
  console.log(`${results.length}/${manifest.uniqueCases}: ${file.file}`);
}
const report = {
  observedAt: new Date().toISOString(), cases: results.length,
  geometrySHA256: crypto.createHash('sha256').update(fs.readFileSync(path.join(root, '../../js/roundabout-geometry.js'))).digest('hex'),
  summary: { exceptions: results.filter(r => r.error).length, nonfinite: results.filter(r => !r.finite).length,
    validationMessages: results.filter(r => r.validation).length, casesWithDesignChecks: results.filter(r => r.designChecks?.length).length },
  interpretation: 'Validation and design-check messages are observations, including intentional negative cases. Finite geometry is not an assertion that markings, lane assignments, or widths are correct.',
  results,
};
fs.writeFileSync(path.join(root, 'audit.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report.summary));
