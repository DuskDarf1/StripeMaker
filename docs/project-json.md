# Editable project JSON

Download → Export Project JSON writes all sheets or the selected sheet. Sheets →
Import Project JSON appends new sheets with new sheet IDs. Road, joint, marking,
and other object IDs remain local to their sheet, preserving references. Import
validates and decodes every background before committing one IndexedDB transaction.
Existing sheets are not replaced. Applying app settings and shortcuts is opt-in.

## Version contract

`format` is `StripeMakerProject`. `version` identifies the writer's data format;
`minReaderVersion` identifies the oldest reader that can safely edit its core
model. Both are positive integers, and minimum reader cannot exceed version.
Legacy version 1 files without a minimum reader remain supported. A future writer
may declare minimum reader 1 only for additive changes that do not alter existing
geometry semantics. Breaking changes must raise the minimum reader. Unsupported
minimum readers fail before adding sheets; do not silently downgrade them.

Unknown sheet-data fields are quarantined instead of applied to runtime objects,
persisted, and restored to `data` on export. Unknown nested model fields are copied
with the model. Every imported sheet also has a persisted `source` archive on
re-export: original editable data, original project metadata/settings/diagnostics,
and extra sheet/file metadata. Prior source archives remain available under
`previous`. This preserves evidence even if normal app cleanup changes a model.
Runtime DOM/file/cache fields and unsafe object properties are rejected. Unknown
features may be preserved without being editable or rendered in this version.
Project-wide extension fields remain in `source.project`, avoiding collisions when
several projects are combined. The new root describes the current workspace.

## Export coverage

Each sheet includes its original image bytes (base64, filename, MIME type,
last-modified timestamp), dimensions, name, scale, pan/zoom, blank-sheet status,
Auto tapers, and the full nested records for roads, joints, gores, medians,
intersections, signs (including pasted images and assemblies), markings,
longitudinal lines, bridges, and colored pavement. This includes lane types,
widths, tapers, independent end directions, pair/beside/feed links, anchors,
intersection movements, and all other properties within these records. No
geometry is rebuilt or rounded for export. Sheet order and selection are explicit.
Global app settings and keyboard overrides are included.

Diagnostics additionally capture browser/language/timezone, viewport/pixel ratio,
actual and system theme, named editor control values, editor selections/defaults,
open panels, bounded runtime errors since page load, undo/redo/pending snapshots
(filtered to exported sheet IDs), per-sheet object counts, resolved road and
intersection lane tracks, and the existing rendered road SVG when available.
Geometry diagnostic failures are recorded without preventing the raw model export.
Non-finite model numbers, which JSON cannot represent, have their locations and
values recorded in `diagnostics.invalidNumbers` (JSON data itself becomes null).
`producer.exporterRevision` identifies the diagnostic exporter implementation,
not a claim about the entire application's Git revision.

Diagnostics and source archives are evidence, not executable input: imported SVG
is never injected into the page, histories are not installed as undo stacks,
and in-progress gestures, editor controls, selections, theme overrides, and
runtime errors are not replayed. The current saved design is restored through the
normal app path; source data remains available before any migration/cleanup.
No cookies, unrelated localStorage, system clipboard, or filesystem paths are read.

Regression checks: `node --test tests/project-json.test.cjs` and
`tests/project-json.browser.cjs` (Playwright). The browser test covers real image
bytes, nested geometry/links, compatible future fields at several levels,
settings opt-in, malformed-file rejection without partial import, reload,
selected-sheet export, and narrow-screen controls.
