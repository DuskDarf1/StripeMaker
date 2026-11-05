# Connected editor stress playground

Open [dense-connected.json](dense-connected.json) through the app's project import.
This is a disposable blank sheet containing **228 roads, 36 intersections,
264 markings, 36 signs, and 36 custom intersection islands: 600 objects**.
The roads and intersections form one connected network, with 198 joints and
576 approach lane links. The deterministic generator also includes divided
roads, curved split segments, explicit intersection movements, crosswalks and
grass/concrete islands. Its explicit movements are fixture data, not a change
to how the editor creates intersections. No simulator runs during these tests.

The smaller 4 × 4 version has 104 roads, 16 intersections, 120 markings,
16 signs and 16 islands: 272 objects, with 256 approach lane links.
The benchmark verifies connectivity and that each gesture actually edits the
intended object. It uses an isolated browser context; existing saved projects
are never opened or modified.

## Measurements

Measured November 4, 2026, macOS 27.2 arm64, headless Chromium 153.0.8010.12,
1500 × 1100 viewport. Browser runs are sequential. These are local measurements,
not a guarantee for every browser, machine, sheet or elevated/bicycle layout.

The baseline is a copy of the working JavaScript from before this performance
pass, including earlier editor features. It is not the repository's older HEAD.
Matched eight-move gestures on the 272-object sheet produced these p95 frame
intervals:

| Drag | Before | After |
| --- | ---: | ---: |
| Sign | 2583.3 ms | 16.7 ms |
| Marking | 2516.6 ms | 16.7 ms |
| Road node | 100.1 ms | 16.7 ms |
| Intersection | 2633.1 ms | 33.4 ms |

A longer 60-move run had p95 frame intervals of 16.8 / 16.8 / 16.7 / 33.4 ms
respectively. One intersection frame reached 50.1 ms. Browser automation pointer
round-trip p95 was 17.7 / 18.3 / 36.3 / 54.1 ms. Frame measurements include idle
frames between inputs; they do not imply every object updates on every frame.
Input round trips include automation and scheduling, so are recorded separately.

The larger 600-object sheet still exceeds the 33 ms target for structural edits:

| Drag, 30 moves | Frame interval p95 | Pointer round trip p95 |
| --- | ---: | ---: |
| Sign | 16.8 ms | 19.6 ms |
| Marking | 16.7 ms | 17.8 ms |
| Road node | 50.0 ms | 75.6 ms |
| Intersection | 66.8 ms | 100.8 ms |

Cold layout normalization and first render are about 1.1 s for 272 objects and
2.4 s for 600. Large-sheet road/intersection release can still take roughly
60–110 ms. The dense layout contains no bridges or bike facilities; those keep
conservative rendering fallbacks and need their own performance measurements.

Road, marking, crosswalk and sign placement previews on the 600-object layout
have p95 frame intervals of 16.7 / 16.7 / 16.8 / 16.8 ms over 30 moves. A separate
Chromium trace of structural drags shows remaining main-thread animation
callback p95 costs of 43.6 ms for road nodes and 74.6 ms for intersections.
Pointer handlers themselves take 5.3 ms and 0.2 ms respectively. Full drawing
and overlay work, rather than pointer handling, remains the next large-sheet
bottleneck; the trace run is diagnostic and excluded from the timing tables.

## Optimizations and safeguards

- Index width and attachment lookups within synchronous reads, preserving link
  order, recursive feed behavior and invalidating after structural changes.
- Solve an attached road's connected component instead of every road, and skip
  unchanged ordinary intersection mouths. Split medians and independent
  roundabout mouths retain broader invalidation.
- Reuse exact solved shapes, road/intersection SVG and sign paths when their
  inputs match. Undo/import replacement identities invalidate attachment caches.
- Paint sign/marking drags and placement previews once per frame. Update changed
  paths in place and flush or cancel queued work on release/cancel.
- Update road preview paths in their existing layer position without repainting
  the sheet. Snapping still runs on every pointer event.
- Index lane hit tests and longitudinal phase candidates, reuse crosswalk edges,
  and prepare polygon edge arithmetic during trimming. Sampling resolution,
  clipping rules, dash phases and geometry arithmetic remain unchanged.

The matched baseline gestures have byte-identical final SVG. Model comparisons
preserve all fields, ordering and links; the largest numeric difference was
2.3e-13 from skipping redundant no-op rotations. No model rounding is applied.
The larger-sheet shape-cache comparison is exact for both model and SVG.

Regression coverage includes 2,080 component/full-sheet endpoint comparisons,
fresh versus retained lane shapes after edits, 36 warm/uncached alignment passes,
more than 1,000 exact trimming comparisons, cache replacement/invalidation,
pointer batching and cancellation, undo/redo, branch snapping, independent lane
widths, left-hand traffic, roundabouts, median edits and PNG/vector-PDF/full-JSON
exports. Preview verification compares retained preview SVG against a complete
render, separately from timing.

## Rerun

Serve the repository with `python3 -m http.server 8884 --bind 127.0.0.1`.
Use an installed Playwright module and Chromium executable; `PLAYWRIGHT_MODULE`
and `CHROME_PATH` can point to existing installations. Run only one browser
benchmark at a time.

```sh
export STRIPEMAKER_URL=http://127.0.0.1:8884
GRID_SIZE=4 MOVES=60 REPORT=/tmp/dense-272.json node tests/dense-editor.bench.cjs
GRID_SIZE=6 MOVES=30 REPORT=/tmp/dense-600.json node tests/dense-editor.bench.cjs
GRID_SIZE=6 MOVES=30 REPORT=/tmp/dense-placement.json node tests/dense-placement.bench.cjs
GRID_SIZE=6 MOVES=8 VERIFY=1 node tests/dense-placement.bench.cjs
```

`PROFILE=1` writes per-gesture CPU profiles. `TRACE=1` writes Chromium timelines
and animation callback/pointer handler durations. Run diagnostics separately
from timing. `SAVE_FIXTURE=/path/project.json` saves the normalized editable
project, and `OVERVIEW=/path/overview.png` captures the complete network.

For an exact before/after replay, copy the pre-edit `js/` directory somewhere
outside the working tree, then set `BASELINE_JS_DIR` for the baseline run and
`COMPARE_WITH` for the optimized run. Use identical `GRID_SIZE`, `MOVES`, and
scenario ordering: selection state persists between scenarios. Reports include
frame/input statistics, setup/release costs, object counts, errors and hashes;
model/SVG artifacts are written alongside them.

Saved measurement reports are in [reports](reports/). Larger CPU profiles,
timelines and screenshots remain in `/tmp/dense-*` on the measurement machine.
