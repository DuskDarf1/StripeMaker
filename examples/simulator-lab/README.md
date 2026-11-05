# Personal simulator stress playground

Agent development tools, reusable across sessions. Run from the StripeMaker repo.
These scripts use disposable browser contexts and never replace saved projects.

## Quick loop

1. Read root `AGENTS.md`, especially simulator behavior and evidence requirements.
2. Run `node examples/simulator-lab/bench.cjs` before and after a change.
   `CARS=2000 STEPS=80 node examples/simulator-lab/bench.cjs` increases load.
3. Run `node --test tests/simulator-*.test.cjs` for seeded model and routing checks.
4. Run `node examples/simulator-lab/live.cjs` for actual Chromium frames and DOM
   rendering. It uses Playwright: set `PLAYWRIGHT_MODULE` to its installed module
   and optionally `CHROME_PATH` to Chromium. `STRIPEMAKER_URL` overrides the default
   local file URL. `DURATION_MS=30000` increases traffic and measurement time.
   Reports and screenshots default to `/tmp/stripemaker-simulator-live.json` and
   `.png`; set `REPORT=/tmp/another-run.json` to retain a comparison.
5. Run the relevant browser scenarios below with the same Playwright variables.

## Saved scenario inventory

- `tests/simulator-control-unlink.browser.cjs`: forced standalone STOP/YIELD
  association, Automatic/manual reconnection, road and intersection-lane
  placement, undo/redo, reload, JSON import and playback locking. Uses the
  all-way STOP fixture in an isolated browser; run Chromium and WebKit.
- `tests/simulator-all-way-stop.browser.cjs`: supplied `allwaystop.json`, with
  manually linked minor STOP bars and unlinked major-road STOP bars exactly at
  attached intersection mouths. Baseline seed 7: no minor trips in 180 seconds;
  both minor heads waited about 170 seconds. Checks automatic mouth association,
  the connection-panel explanation, no automatic association for set-back,
  detached, transformed or different-level lines, and individual lane coverage.
  Default 480 simulated seconds, original temperature 18 and continuous demand
  (20/min per major entrance, 2/min per minor), watchdog disabled. Both minor
  streams must complete trips while major demand remains active. Run Chromium
  seed 7 and WebKit `SEED=23`; use `SECONDS`, `REPORT`, `RECORD=1` for diagnostics.
  After the fix, Chromium seed 7 completed 14 trips from each minor entrance
  during eight minutes; longest served-stop wait was 21.03 seconds, with zero
  missed stops, overlaps, collision interventions or watchdog removals.
  Reports: `/tmp/allway-before.json`, `/tmp/allway-final-chromium.json` and
  `/tmp/allway-final-webkit.json`. These test outcomes do not establish capacity
  or calibrated real-world intersection performance.
- `tests/simulator-weaving.browser.cjs`: supplied `weaving.json`, retaining its
  two entrance demands, lane/exit shares, 70 mph mainline zones, temperature 100
  and 5× playback. Default: seed 7, 1,500 simulated seconds, watchdog disabled.
  `SEED=23 SECONDS=0 LIVE_MS=300000` runs five actual minutes of animation;
  reports frame p95/max and actual simulated time separately from requested 5×.
  `REPORT`, `RECORD=1`, `DEBUG=1`, `TRACE_IDS=...`, and `STOP_AT_STALL=1` support
  diagnostics. Never use the early-stop option as the endurance acceptance run.
  Checks legal passing choices, completed trips, sustained queue clearance,
  body overlaps and emergency collision interventions. A transient traffic queue
  is distinct from a permanent steering/gap deadlock.
- `tests/simulator-volumes.browser.cjs`: all five demand units, mixed destination
  units, summed versus fixed entrance output, engine configuration, locking,
  history, JSON validation, reload and narrow layout. Run Chromium and WebKit.
- `tests/simulator-controls.test.cjs`: per-car full-stop timestamps across eight
  lanes in four multi-lane approaches and eight separately divided mouths;
  first-stopped conflicting arrivals, simultaneous right-hand priority,
  accepted turns across wide approaches, partial control and queue progress.
- `bench.cjs`: 500 cars, parallel three-lane corridors, connected-path observations;
  measures physics only. Configurable count/steps, no browser dependencies.
- `live.cjs`: eight three-lane roads, 600 cars/min per entrance, seeded profiles,
  queued arrivals; measures real animation frames, long tasks, active cars,
  backlog, simulation time and JavaScript errors. Includes setup/startup frames;
  compare p95 and maximum separately. Headless results are machine dependent.
- `tests/simulator-lane-changes.browser.cjs`: upcoming restricted exit, personal
  lane-change plans, actual keyhole crossing, separated bike track, zero speed,
  pause, route colors and thin road-following arrows.
- `tests/simulator-linked-roundabouts.browser.cjs`: saved two-roundabout network,
  implicit aligned lane attachments, false exit detection, branch occupancy,
  road-following arrow geometry, and 5/30/67.7 mph routing.
- `tests/simulator-routes.browser.cjs`: restricted intersection movements and six
  roundabout layouts. Preserves explicit movement restrictions.
- `tests/simulator-roundabout-exit.browser.cjs`: supplied spiral roundabout
  with four spawn points, three fixed seeds × 180 simulated seconds at 35 mph,
  measuring completed vehicles, stationary time in the ring and exit stream,
  and actual body overlaps at every physics step. Entry queues are checked
  separately from circulation; the old rectangular exit area also covered an
  entering lane.
  Covers shared-connector following, real downstream gaps and overlap deadlocks.
  Supports the same Chromium/WebKit environment variables as the reload test.
- `tests/simulator-six-minute-stuck.browser.cjs`: supplied `stuck.json` geometry
  and settings (61.7 mph, temperature 0); two seven-minute runs with the watchdog
  disabled. Checks physical overlaps, ring/exit stalls and continued departures.
- `tests/simulator-temperature.browser.cjs`: exact baseline at zero, bounded
  high-temperature population, aggressive tail, variable real speed targets,
  locked controls, settings/import/reload and collision-free stress playback.
- `tests/simulator-reload.browser.cjs`: direct `file://` reloads while playing,
  orphaned IndexedDB records, damaged blank thumbnails, failed aerial backgrounds,
  retained sheet IDs and recovery after repairing a source. Uses a disposable
  profile; never run fault injection against the user’s browser storage.
- `tests/simulator-playback.browser.cjs`: emissions, route/lane distributions,
  random colors, speed, locking, visibility, persistence and narrow viewport.
- `tests/simulator-drivers.test.cjs`: profile moments, unsafe rear gap, slower
  leader, queues, seeded timestep invariance, personalized changes and waiting.

## Interpretation and extension

Keep seeds fixed for comparisons; normal app playback remains unseeded. Separate
network construction, route personalization, physics, and rendering costs. Do
not replace traffic observations with randomness to make a benchmark pass.
Real-time playback caps elapsed advancement to 100 ms per animation frame to
avoid unlimited catch-up after stalls; offline Engine.advance processes the full
requested fixed-step interval. Compare simulated seconds with wall time too.

Initial measurements on this development machine (Node 26.4.0): 500-car physics
median 4.58 ms before corridor indexing, 0.88 ms afterward (40 steps). First live
15 s run: 109 cars, p95 frame 16.7 ms, maximum 316.5 ms including startup, two long
tasks. These are observations, not portable performance guarantees or thresholds.

Add durable regression scenarios here or in tests, with a small reproduction,
expected legal behavior, seed, load and command. Store throwaway reports in /tmp.
Human behavior parameters require cited primary evidence, with distribution and
numerical assumptions identified separately. Current highway baselines are not
calibrated urban behavior, signal compliance, occlusion or cyclist yielding.

### Weaving regression measurements (2026-11-03)

Original saved demand, seed 7, first 400 simulated seconds: 70 completed trips,
maximum continuous stop 225 seconds, 4,481 emergency collision interventions.
After destination-aware merge cooperation and retaining acceleration room:
1,500 simulated seconds, 1,034 trips (746 mainline, 288 ramp), maximum stop
14.03 seconds, zero sampled body overlaps and zero emergency interventions.
Both streams continued completing trips; temporary demand queues cleared without
watchdog removal. Reports: `/tmp/weaving-before.json` and
`/tmp/weaving-room-full.json`. Long-run acceptance permits temporary queues but
requires stops shorter than the user's 30-second recovery policy, sustained
departures and safe bodies. This is regression evidence, not capacity calibration.

Separate WebKit seed 23 live playback: 300.66 wall seconds, 972.60 simulated
seconds, 675 trips, maximum stop 13 seconds, zero overlaps/interventions, frame
p95 56 ms and maximum 71 ms. Report: `/tmp/weaving-final-live.json`. Requested
5× averaged about 3.23× during this development-machine run (other test processes
were active); do not report it as maintaining 5× or 60 fps. The offline 1,500-second
run separately covers the full intended simulation duration. Watchdog recovery
was disabled in both runs.

## Reload recovery regression

`tests/simulator-reload.browser.cjs` defaults to the local index.html URL, matching
file-based use. Run with the usual Playwright/Chromium environment variables.
Normal playback reloads are tested separately from deliberately injected storage
failures: the test does not establish why an actual user's first decode failed.
The old restore loop could omit a failed sheet from meta.order and reuse its ID.
Recovery now scans all drawing records, retains failed IDs, and regenerates blank
background pixels. Actual aerial images are never replaced by blank imagery.
The repaired app must open the same index.html path in the same browser/profile
to reach that local file's storage. Clearing storage can destroy recoverable data.

New image records use ArrayBuffer bytes and filename/type/timestamp metadata,
not IndexedDB Blob/File values. The WebKit test originally failed its synthetic
File write with "Error preparing Blob/File data to be stored". Byte records pass
in both tested engines; old readable File records migrate on restore. Read image
records one at a time to avoid loading all sheet backgrounds into startup memory.
Use `BROWSER=webkit WEBKIT_PATH=/path/to/pw_run.sh` for the installed WebKit runner
(the version must be compatible with the Playwright module).

## Roundabout exit following

Fixture: `tests/fixtures/simulator-roundabout-exit-stop.json` (geometry only).
Previously, connector-to-road samples with no station interval projected every
exit-road car onto the mouth. Coincident sample deduplication also lost the exit
road's first station. Cars inside connectors were not observed at all. The saved
project reproduced sudden stops and overlaps at the southwest exit.

Keep station metadata at shared endpoints. Road station interpolation is valid
only when both segment endpoints belong to that road. Connector points carry an
intersection ID; shared-stream matching uses geometric projection, forward
headings and quarter-lane lateral tolerance, excluding adjacent lanes, crossing
paths and unrelated intersections. These tolerances are numerical geometry
policies, not verified driver-perception parameters. Near-overlapping curves
need symmetric forward ordering (stable ID ties) to avoid mutual-leader deadlocks.
Do not change IDM/MOBIL constants to conceal invalid gap geometry.

## Collision-aware driving

See `DRIVER-MODEL.md` for source provenance and explicit numerical assumptions.
`tests/simulator-collisions.test.cjs` covers oriented rectangles, swept crossings,
high-speed tunnelling, path knots, elevations, occupied spawns, stopped-leader
braking/recovery, safe passing and entry queue order. Collision state stays out
of saved plan data. Current driver state is included in exported diagnostics.

The 500-car benchmark separates independent corridors spatially and initializes
actual poses; overlapping unrelated roads at identical coordinates would now be
real same-level collisions rather than a useful free-flow load case. Final live
stress run with collision behavior: p95 frame 16.7 ms, 91 active cars, 15.05 s
simulated in 15.23 wall seconds; two startup long tasks. Machine-specific only.

## 60 Hz physics and yield admission

Physics uses a fixed 1/60 s step; driver decisions retain their independent 0.2 s
cadence. Rendering uses requestAnimationFrame. The 0.1 s per-frame catch-up cap
allows up to six physics steps per animation frame at every playback rate. Frame-rate independence is tested at 30/60/120 Hz.
A same-machine isolated 15 s corridor comparison measured p95 frames of 16.7 ms
at 20 Hz physics and 16.8 ms at 60 Hz, with 15.05/15.067 simulated seconds in
15.240/15.223 wall seconds. Both had two startup long tasks. Physics-only 500-car
median step time was 2.26/2.16 ms respectively; the 60 Hz model runs more steps
per elapsed second. These are measurements of this scenario, not universal FPS.

Denied entrants must not claim future crossing space against another entrance.
`simulator-collisions.test.cjs` includes a waiting entrant whose eventual route
crosses a clear entrance; the clear entrance must proceed. Actual queue leaders
still hold their followers and admitted conflicting bodies still need clearance.
Acceleration and comfortable braking are independently sampled over the full
user temperature envelope; other ordinary profile variables use its central half.
Temperature 0 retains exact baselines for every modeled human variable.

## Local roundabout gap acceptance

Roundabout entry observes only the immediately upstream circulating section and
its current body footprint. The immediate merge compares actual per-driver
acceleration, local speed target and headway with an approaching car's earliest
arrival. Occupied space must physically clear; a queued leader cannot be assumed
free-flowing. Ordinary intersections keep their conservative admission policy.
`simulator-collisions.test.cjs` covers local/remote sectors and differing driver
acceleration; `simulator-routing.test.cjs` covers reversed entry gate metadata.
Retain stopping-distance commitment and both seven-minute traffic seeds. The
region/timing policies are described with their limitations in DRIVER-MODEL.md.

`live-roundabout.cjs` warms the saved roundabout for 120 simulated seconds with
seed 123, then measures real animation frames and simulation-clock progress.
Run with the same PLAYWRIGHT_MODULE/CHROME_PATH variables as live.cjs. DURATION_MS
and REPORT override the default 15 s and /tmp/stripemaker-roundabout-live.json.
The verified seeded local-entry measurement: 39 active cars, p95 16.8 ms, 14.983
simulated seconds in 15.004 wall seconds. This checks the actual admission/geometry workload,
not only separate straight corridors; machine/scenario-specific only.

## Playback multiplier

The Simulator panel's Playback (×) control scales elapsed wall time by 1–5
(default 1, step 0.1); it can change while running. All physics, spawning and
recovery still use simulated seconds and fixed 1/60 s steps. Model inputs remain
locked during playback. The rate is a browser setting and optional settings import.
`tests/simulator-playback-rate.browser.cjs` verifies real UI clock scaling at
1/2.5/5x, live updates, pause/resume, spawn timing, bounds, reload and project import.
`PLAYBACK_RATE=5 node examples/simulator-lab/live-roundabout.cjs` profiles the
populated roundabout at the faster rate; actual speed depends on available CPU.

The initial 5× roundabout run had p95 frames 183.4 ms and only 47 simulated seconds
in 15.081 wall seconds. Profiling identified connector leader searches as the main
cost. Candidate cars are now spatially indexed per observation, with shared segment
queries; all original tangent, lateral, stream-continuity and forward-order checks
remain. Conflict samples are indexed by station to inspect only the local merge.
Catch-up stays capped at six physics steps per animation frame. After optimization,
the same seeded 5× run measured p95 16.7 ms and 75 simulated seconds in 15.002 wall
seconds at 50 active cars. These are machine-specific measurements, not an FPS
promise for all populations. Curved-stream indexed/unindexed equivalence is covered
in simulator-drivers.test.cjs.

Final 5× sorted-window run: 74.917 simulated seconds in 15.003 wall seconds,
p95 frames 16.7 ms at 50 active cars. The watchdog-disabled seven-minute Chromium
seeds 123/7 retained exactly 170/188 completed trips, 0 ring/exit stalls/overlaps,
and 2/21 interventions; WebKit seed 123 matched 170/0/0/2. The final sorted-window
Chromium seed 123 repeated the same result. All 250 unit tests passed.

## Two-lane southwest yield regression

`tests/fixtures/simulator-two-lane-yield.json` retains geometry and settings only
from the supplied StripeMaker-project.json. Run
`tests/simulator-two-lane-yield.browser.cjs` with the standard Chromium/WebKit vars.
It reproduces a clear admission decision using both lane heads and an upstream
permission at another approach, then runs eight simulated minutes at 46.4 mph and
temperature 38, watchdog disabled. Check both lanes make progress and keep their
configured demand/routes; do not enforce artificial equal throughput. Commitment
uses per-driver safe braking rather than comfortable preference. Keep the established
full-body conflict margins and collision checks while correcting commitment.

Committed local merges remain visible to circulating/exiting drivers. Entry
reservations must not hide actual crossing bodies. Protect a committed car's
clearance within two body lengths of entry, and never make a leader yield back
to its follower. The unit test covers both commitment fairness and one-way merge
observation; keep the earlier seven-minute seeds as well as the new eight-minute
46.4 mph / temperature 38 run, always with recovery disabled.

Final two-lane verification: both Chromium and WebKit seed 123 ran eight minutes
at the saved settings, recovery disabled, with 37 entries from each southwest lane,
209 completed trips overall, and zero circulation stalls/overlaps/removals. The
clear-head admission probe fails with the old comfortable-braking commitment.
The two earlier seven-minute seeds also passed (160/180 trips, no ring/exit stalls
or overlaps). All 252 unit tests pass; high-temperature playback had zero overlaps
or removals. Populated 5× playback: p95 16.8 ms and 75.017 simulated seconds in
15.014 wall seconds, 49 cars, on this machine.

## Traffic signals, placement step

`tests/simulator-signals.browser.cjs` checks Add Traffic Signal, intersection-only
picking, one marker per intersection, keyboard targets/Escape, undo/redo, view
updates, project import, IndexedDB reload and playback locking in Chromium/WebKit.
Signal placement is saved on the intersection as `trafficSignal: {}`. It is a
configuration marker only: no phases, timings or vehicle signal response yet.
Clear Simulation retains it; deleting its intersection removes it naturally.

## STOP/YIELD placement and simulator views

`tests/simulator-controls.browser.cjs` covers placing STOP on stopLine and YIELD on
yieldLine, red octagon/downward triangle indicators, nearby same-level intersection
links, unlinks, undo/redo, road movement, deletion cleanup, copy/paste ID remapping,
project import/reload and playback locking. This is still the placement/configuration
step: signals and line controls do not yet drive stopping or phases.
Controls are saved on their marking as `trafficControl: { type, intersection? }`.
The 250 ft association radius is a UI choice, measured to intersection pavement,
not a traffic-engineering standard. A link can remain optional.

`tests/simulator-overlays.browser.cjs` checks selected-spawn-only route diagrams
(full overview when unselected), the live Density picker, translucent green/red
colors, clear/reload/import and preserving model inputs. `simulator-density.test.cjs`
checks curved/short cells, scaling and lane-change density without double counting.
Density is a view-only index in 100 ft lane sections: allocated vehicle body plus
modeled standstill-gap space over available lane length, clamped to [0,1]. It is
not a calibrated capacity prediction. Geometry is cached; color updates are capped
at 5 Hz wall time, with pan/zoom transforms applied immediately. The layer has
28% opacity and stays out of road/marking export artwork. Cars inside intersection
connectors are not assigned to a road-lane density cell.

`OVERLAY=density PLAYBACK_RATE=5 node examples/simulator-lab/live-roundabout.cjs`
profiles actual frames with the layer enabled. Measured on this machine: p95
16.7 ms, 74.933 simulated seconds in 15.002 wall seconds at 49 cars. The density
setting is browser-wide (`simulationOverlay`, none/density), not an undo step;
optional project settings import includes it. Chromium and WebKit browser checks
passed, and all 256 unit tests passed.

## Controlled-intersection priority

Run `node tests/simulator-stop-priority.browser.cjs` with the browser variables
above; WebKit uses `BROWSER=webkit WEBKIT_PATH=.../pw_run.sh`. The durable
`simulator-stop-priority.json` fixture retains the supplied feedback sheet and
its saved STOP bars. Eight simulated minutes, seed 123, watchdog disabled:
check no STOP violations or body overlaps, main-road flow, then release minor
queues by ending major-road emissions after five minutes. This distinguishes
legitimate waiting for a gap from a retained phantom reservation. Run
`node --test tests/simulator-controls.test.cjs` for statutory priority, exact bar
geometry, safe-gap and coincident semantic-join checks. See DRIVER-MODEL.md for
Florida statute links and the distinction between law and model assumptions.

## Downstream leaders and combined overlays

`tests/simulator-outer-lane-priority.browser.cjs` uses the feedback sheet's saved
60 mph and temperature 30 with continuous traffic, three seeds × six minutes,
watchdog disabled. A leader that has cleared/replanned past the junction must
not hold the entrance as an unadmitted queue head; retain IDM at its real gap.
The earlier zero-temperature/clearing-stream test missed this case. The new
scenario checks downstream phantom holds, actual body overlaps, departures,
and traversal of the outermost approach lanes. `SEEDS=123` runs a shorter check.

`tests/simulator-speed-overlay.browser.cjs` checks one-decimal MPH labels, each
car's own unconstrained target (including local speed limits), red-to-green
relative speed, combined Speed/Density display, live toggles, view tracking,
car removal, clear, project import and reload. Display selections are a set in
`simulationOverlays`; import/migrate the former single `simulationOverlay`
setting. `tests/simulator-overlay-settings.test.cjs` covers migration and value
validation. Overlays never change driver state or traffic configuration.

## High-demand junction and stopped-time overlay

`tests/simulator-intersection-abrupt-stop.browser.cjs` retains feedbackNew.json:
16 explicit movements and 150 cars/min from each major entrance. The default
batch is 24 seeds × 120 seconds, watchdog disabled, inspecting all 60 Hz physics
steps for an eastbound/westbound vehicle abruptly dropping from over 3.4 mph to
zero inside the junction. `SEEDS=1,2 SECONDS=180 TEMPERATURE=75` customizes the
batch. Reports retain the observed leader/collision partner and situation.
The earlier sheet had only 12 cars/min and did not reproduce this failure.

The captured defect was an exit-road lane change overlooking a target-lane rear
vehicle still inside the intersection connector. Future road-entry stations are
cached on prepared paths; target-lane safety uses negative stations for vehicles
approaching the mouth. Never omit them merely because they lack the exit road's
current road/lane identity. Keep exact body safeguards and MOBIL braking limits.

Time stopped is an independent overlay (`stopped`), combinable with Density and
Speed. It shows the current continuous stationary interval in simulated seconds,
resets on movement, pauses with physics, and follows playback speed. A numerical
1e-6 ft/s tolerance treats floating-point standstill residuals as zero; this is
not a rolling-stop behavior. Stacked labels remain upright and noninteractive.
Driver unit tests verify timing; the speed-overlay browser regression verifies
stacking, independent toggles, removal, import and persistence of all three.

## Curve context regression

`simulator-curves.test.cjs` verifies the unbanked published side-friction relation,
straight roads, several radii, two sheet scales, intersection turns, advance
braking, post-curve acceleration and personal temperature preferences.
`simulator-curves.browser.cjs` uses feedbackNew's actual legal right-turn/through
movements: baseline targets measured about 11.8/60 mph, with 1.3×/.8× curve
preferences producing about 15.4/9.5 mph for that same right turn. These are model
outputs, not measured site speeds. The circulation regression must still pass:
spiral routing bends are not standalone road curves. Cache numeric geometry;
straight-only samples cannot constrain speed and are removed except for guards
beside curved runs. A 50,000-call CPU microbenchmark reduced target-query cost
from ~.26/.33 us (straight/mixed) to ~.08/.08 us, with identical constraints.

Turning-gap audit (saved high-demand major/minor intersection, watchdog off):

```sh
SEEDS=1,2,3,7 SECONDS=120 node tests/simulator-turn-gaps.browser.cjs
BROWSER=webkit SEEDS=1 TEMPERATURE=75 node tests/simulator-turn-gaps.browser.cjs
```

Use the same Playwright/browser environment variables as above. This checks
upstream hard braking as well as abrupt stops inside the junction; the older
inside-only check did not cover the turning-gap symptom. JSON reports default to
`/tmp/stripemaker-turn-gaps-{chromium,webkit}.json`; override with `REPORT`.

- `tests/simulator-zones.test.cjs`: sparse/reversed boundary sampling, overlapping
  sections, road splits, playback speed recovery, and a queued candidate whose
  entry speed must recover when the source clears.
- `tests/simulator-zones.browser.cjs`: drag creation, section boxes, MPH fields,
  playback lock, removal, history, portable JSON export and reload. Supports
  Chromium and WebKit with the environment variables above.

- `tests/simulator-highway-merge.browser.cjs`: supplied highwaymerge.json lane
  add/drop, no marked control, mainline 50 cars/min plus ramp default demand.
  Watchdog disabled; record merge speeds/neighbor flow, ramp stops, trips and
  physical overlaps. Default explicit local zones are 70 mph; MPH=30 checks
  local defaults. TEMPERATURE=0/20/75 and SECONDS vary the reproducible run.
  Reports use REPORT or /tmp/stripemaker-highway-merge-{chromium,webkit}.json.

Highway crawl follow-up: use `SEED`, `SECONDS`, `MPH`, and `TEMPERATURE` with
`simulator-highway-merge.browser.cjs`. Reports now include sub-5-mph samples,
actual leaders, curve targets, rolling replan geometry, false crawl holds and
stale joint-maneuver markers. The seeded light-demand scenario asserts no false
crawl holds or stale markers in addition to collision-free completion; a count
of fully stationary cars alone missed the original 2–3 mph problem. Driver unit
checks cover attainable maneuver length, reverse travel, bicycle restrictions,
temperature and an imminent gap closing between scheduled decisions. The control
browser regression checks paint without an action and mismatched actions; the
clear-YIELD unit regression requires no slowing at four temperatures.

Crawl-fix verification (seed 7, watchdog off): final Chromium 70 mph / temperature
75 / 120 simulated seconds completed 69 trips (10 ramp); WebKit 70 mph /
temperature 20 / 90 seconds completed 39 trips (5 ramp). Both had zero sampled
sub-5-mph vehicles, false crawl holds, pinned joint replans, and body overlaps.
Chromium 30 mph / temperature 0 / 60 seconds also passed with actual merges and
zero crawl/overlap samples; the long complete route had not finished by 60 seconds.
Sampling is every 50 ms, physics remains 60 Hz. These are scenario-specific
regression results, not a calibrated capacity or guaranteed minimum-speed claim.
308 unit tests, WebKit explicit-action controls and the Chromium seed-3 60-second
major/minor turning-gap regression passed. Reports: /tmp/highway-verified-*.json.

Acceleration-first follow-up: the driver regression places faster mainline traffic
alongside a slower merging car, at temperatures 0/20/75/100 and both sheet scales.
It checks actual positive acceleration while steering into that occupied gap
remains forbidden. This failed before the stream-speed target bound. The highway
browser report now counts slower-driver merge observations and rejects a
slot-positioning command to slow below current speed when both the observed
stream and local contextual target allow acceleration.
The present-gap driver regression checks that a required merge begins in an
available gap and that a blocked boundary keeps the car in its original lane.
Run the temperature-75 highway scenario beyond 120 seconds: acceleration alone
previously exposed a late queue when drivers passed up gaps before their planned
steering station. The current run must exercise both speed matching and actual
present-gap admission while retaining the no-crawl/overlap assertions.
The rolling-extension unit also covers a required maneuver beyond the current
speed-matching observation window. A missing nearby observation must retain
rolling lane continuation, rather than reviving a stationary planned-point hold.

Distinguish an early virtual stop from exhausting actual merge room. The highway
report now retains lane-end crawling separately when the pending maneuver is on
that same road and the remaining lane is shorter than one personal maneuver at
the contextual target speed. Ramp-road ends before the receiving merge lane do
not qualify. This is a numerical diagnostic boundary, not a driver threshold.
Keep front/rear clearance, speeds and predicted braking in slow samples so a
physical lack of gap can be checked rather than hidden by a no-braking rule.
The early false-hold, stale-marker, acceleration-target and overlap assertions
remain; lane-end events remain visible in the report.

Final acceleration/gap follow-up: 310 unit tests passed. Seed-7, 150-second,
70-mph runs: WebKit temperature 20 completed 101 trips (16 ramp), with zero crawl
samples/overlaps. Chromium temperature 75 completed 97 trips (17 ramp), with zero
early false holds, stale markers, braking targets against faster traffic, or
body overlaps. A late taper-end event remains: at 138.05 seconds the ramp car had
114.27 ft of lane left and a 56.58-mph mainline car alongside (projected rear
clearance -3.33 ft); the gap was unsafe. At 139.05 seconds the following gap was
154.70 ft but the modeled rear braking demand still exceeded its safe threshold.
Do not remove collision/gap protection to force an all-speeds-never-decrease test.
The report retains 55 lane-end hold samples and 141 total sub-5-mph samples,
including affected followers, instead of calling these zero-crawl results.
Reports: /tmp/ramp-final-webkit20.json and /tmp/ramp-final-gap-audit.json. The
final controlled-intersection seed-3 regression passed with zero overlaps or
hard through-traffic braking. These are model/scenario observations, not field
capacity measurements or a guarantee of monotonic ramp speeds.

Cooperative merge follow-up: `tests/simulator-cooperative-merge.test.cjs` adds
speed preparation and receiving-driver cooperation, including a 30-to-70-mph
straight entry with a blocked or available adjacent mainline lane. The actual
highway fixture reports courtesy requests, safe move-away changes, seconds of
courtesy braking, requested/attainable entry speed and actual steering speed.
`rampSpeedSamples` retains one-second observations below 25 mph to distinguish
real leader/curve constraints from disappearance of the sub-5-mph symptom.

Initial cooperative verification: 320 unit tests passed. Seed-7, 150-second,
70-mph local-zone runs at temperature 75 in Chromium and 20 in WebKit had zero
sampled sub-5-mph vehicles or body overlaps, with the watchdog disabled. They
completed 88/99 trips (12/17 ramp), with 29/28 cooperative lane changes and
87.88/85.88 vehicle-seconds of courtesy braking. Reports are
`/tmp/cooperative-final-75.json` and `/tmp/cooperative-final-webkit20.json`.
These supersede the earlier taper-end crawl observation for this tested run,
but are not claims that every merge reaches 70 mph: entry speeds varied with
traffic, geometry and available acceleration room. The seed-3, 120-second
controlled-intersection audit also passed with 118 completed trips and zero
abrupt stops, hard through-traffic braking or overlaps (`/tmp/cooperative-city.json`).

Final gap-preservation update: speed preparation must not discard a safe gap
when the desired traffic speed cannot be attained in the remaining lane. Use the
attainable speed to size the complete maneuver, continue accelerating through
it, and keep the same legal destination. The 150-second Chromium temperature-75
run now completes 105 trips (17 ramp), with zero sub-5-mph samples, virtual-bar
speed drops, stale joint replans or overlaps; 18 mainline drivers change lanes
cooperatively and courtesy braking totals 45.10 vehicle-seconds. Report:
`/tmp/cooperative-attainable-75.json`. The final 320-unit suite passes.

The highway test rejects a loss above 2 mph in one 50-ms observation when caused
by a provisional gap barrier rather than an actual leader. This diagnostic
threshold is not a human deceleration calibration. Its report retains speed
losses with real traffic/conflict causes too, including downstream passing after
leaving the ramp; do not claim those events are absent merely because the merge
assertion passes. Minimum merge speed is not guaranteed to equal the local
limit: in this run entry speeds range from 13.32 to 44.76 mph (median 39.85),
with actual geometry, traffic and temperature still constraining individual cars.

Closing-gap follow-up: a nearly ready driver also checks whether a currently
safe gap will close during its remaining short speed-preparation wait. It may
use that gap immediately, while stable gaps retain preparation and unsafe gaps
remain forbidden. Forward/reversed, 1/6-pixels-per-foot regressions pass; the
complete suite now has 321 passing tests. The final 150-second WebKit run at
30 mph / temperature 20 completes 40 trips (7 ramp), with zero sub-5-mph samples,
virtual-bar speed drops or overlaps, 12 cooperative lane changes, and 30.03
vehicle-seconds of courtesy braking (`/tmp/cooperative-closing-safari30.json`).
The fixture test now explicitly rejects sub-5-mph queues at this light demand,
in addition to abrupt virtual-bar braking and overlap.

Final rolling-forecast validation (321 unit tests passing): both 150-second,
seed-7 browser runs pass with recovery disabled, zero sub-5-mph queue samples,
zero abrupt virtual-bar braking, zero stale joint replans, and zero body overlaps.
Chromium, 70-mph zones / temperature 75: 99 completed trips (17 ramp), 25
cooperative lane changes, 40.20 vehicle-seconds of courtesy braking. WebKit,
30-mph zones / temperature 20: 40 completed trips (7 ramp), 7 cooperative lane
changes, 42.83 vehicle-seconds of courtesy braking. Final reports:
`/tmp/cooperative-rolling-chrome75.json` and
`/tmp/cooperative-rolling-safari30.json`. These results supersede intermediate
cooperative-run figures above; they verify this saved scenario and do not imply
all vehicles attain the posted limit irrespective of traffic or geometry.


## 30 Hz and speed-zone lookup performance

Current physics uses 30 fixed updates per simulated second (requested to reduce
lag); rendering remains on requestAnimationFrame and decisions retain their
0.2-second simulated-time cadence. Elapsed advancement stays capped at 0.1 s per
rendered frame, now at most three physics steps. Crossing commitment reserves
one actual timestep of travel; swept-body collision detection stays enabled.
Historical 60-Hz results above describe their original runs.

`live-highway.cjs` loads the saved merge fixture in disposable storage, warms
80 simulated seconds with seed 7, then measures 15 real seconds at 5×. Defaults:
70-mph local zones, temperature 75. It saves a deterministic warm-state snapshot
and SHA-256 fingerprint beside its report. `PROFILE=1` also writes a Chromium
CPU profile; `BROWSER=webkit` uses the existing WebKit environment variables.
`WARM_SECONDS`, `DURATION_MS`, `PLAYBACK_RATE`, `TEMPERATURE`, `MPH`, `SEED`,
`OVERLAYS` (comma-separated), and `REPORT` override those defaults. Keep live
benchmarks isolated from other CPU-intensive tests when comparing performance.

The 60-Hz baseline's CPU profile spent roughly three quarters of runtime inside
route replanning, dominated by repeated speed-zone projection over all road
segments. Moving to 30 Hz alone did not resolve that cost. Whole-road zones now
avoid projection entirely; partial zones use an exact bounding hierarchy over
immutable geometry, preserving the original projection arithmetic and earliest
segment tie. Geometry edits invalidate the containing road snapshot. Tests
compare indexed/exhaustive results on curved, folded, duplicate-point and scaled
roads and verify complete decorated paths, including boundary/maneuver metadata.

Same-machine 30-Hz optimization comparison, same seed/load and 80-second warmup:
- Before: warmup 94.50 s wall time; live frame p95 283.3 ms; only 8.50 simulated
  seconds advanced in 15.08 real seconds at requested 5×; 84 long tasks.
- After: warmup 9.37 s; live frame p95 16.7 ms; 74.93 simulated seconds in 15.01
  real seconds; zero long tasks. The entire saved warm-state JSON matches exactly
  (fingerprint 8c61b3286682d077b463bdeb69a0bd45a9634efa658179ad5810abf64831ca80).
Reports: /tmp/simulator-lag-30hz-before-opt.json and
/tmp/simulator-lag-30hz-after-opt.json. The 60-Hz profile/baseline is
/tmp/simulator-lag-before-highway.json (and .cpuprofile). These are measurements
of the projection optimization, not portable frame-rate guarantees. The existing physics-only corridor benchmark is retained.

Use `SPEED_TRACE=1` with `tests/simulator-highway-merge.browser.cjs` to retain
per-second ramp speed, contextual target, receiving limit and adjacent traffic
speeds/gaps. This distinguishes curve limits, acceleration time and actual queues
from a merge target erroneously set below the stream.


The original paired comparison above used the same legacy viewport offset,
which put the merge outside the visible area. It isolates physics/route cost but
understates visible rendering work. The harness now focuses the actual merge,
asserts visible traffic, records visibleCar count, and writes a screenshot.
Final visible WebKit run with all three overlays at 5×: 50 active cars, 23 visible;
frame median 21 ms / p95 25 ms / maximum 30 ms; 69.87 simulated seconds in 15.02
real seconds (about 4.65× achieved under this load), zero JavaScript errors.
Report and screenshot: /tmp/simulator-lag-visible-webkit.json and .png.
Long-task API support is recorded explicitly; an unsupported API is not evidence
of zero long tasks. Do not compare the visible all-overlay run directly with the
old viewport as if rendering load were identical.

30-Hz verification: 324 unit tests passed, including exact projection equivalence
and fixed steps across 15/30/60/120/144-Hz render schedules. Three 180-second
roundabout seeds passed with zero stops, overlaps or collision interventions;
the 120-second controlled-intersection audit passed with 123 completed trips,
zero abrupt stops, hard through-traffic braking or overlaps. Safari speed-zone
creation/editing, undo/reload and playback 1×/2.5×/5× tests also passed. The saved
70-mph / temperature-75 highway regression passed 150 seconds with no crawling,
virtual-bar hard braking or overlaps (/tmp/simulator-30hz-speed-trace.json).

The follow-up speed trace identifies roughly 30–35 mph on the saved ramp's real
bend, followed by acceleration on the straight receiving section. Per user
clarification, retain that curve behavior. Raising a local zone permits a higher
straight-section target; it does not remove curve, traffic or collision limits.
No new blanket freeway-ramp curve exemption is introduced.

## Traffic signal controller regression

- `node --test tests/simulator-signals.test.cjs`: two-ring barriers, demand/recall,
  gap/max termination, delayed pulse and presence detectors, pedestrian service,
  rest-in-walk, LPI, exclusive service, buffer, soft recall, dual entry,
  simultaneous gap, flashing red/yellow, coordinated offsets, conflict checking,
  schema/remapping, full stops and three minutes of four-stream signal operation.
- `node tests/signal-editor.browser.cjs`: use the Playwright/Chromium or WebKit
  environment variables above. Disposable blank sheet; tests physical mast/head
  placement, lane snapping, FYA heads, phase grid, pedestrian modes and recall,
  Shift detector placement, pedestrian calls, portable JSON, reload
  and narrow panel geometry. Screenshots: `/tmp/stripemaker-signal-editor.png`
  and `/tmp/stripemaker-signal-editor-mobile.png`.
- `tests/simulator-signals.browser.cjs` retains the original placement regression;
  placed markers are now accessible editor buttons.
- Signal timing defaults are editable demonstration values. Passing these tests
  does not establish real-world controller certification or traffic capacity.

## Ordinary green turning permission and flashing indications

`tests/signal-green-ball.browser.cjs` builds a three-movement intersection with
ordinary left/right greens and opposing through green. It checks Yield labels,
protected-arrow conflict errors, SignalMaker circular/arrow artwork, actual
yellow/red on-off cycles during playback, and project round-trip. Run in
Chromium and WebKit with the standard environment variables above. Screenshot:
`/tmp/stripemaker-green-ball-and-flash.png`.

Model regressions in `simulator-signals.test.cjs` cover both turn types,
pedestrian gates, protected compatibility, legacy arrow-head migration,
phase-specific flashing red and stop-bar-neutral priority. The gap-acceptance
fixture tests ordinary green with close opposing traffic and with a clear gap.

Validation: 188 model/project tests pass. The standard 500-car, 40-step dense
corridor benchmark measured p50/p95 2.55/4.18 ms before and 2.60/4.03 ms after
(Node v26.4.0). These short runs show no material change at that load; they do
not measure signalized-intersection capacity. The isolated 15-second Chromium
live run recorded 905 frames, p95 16.7 ms, two long tasks, and no JavaScript
errors (`/tmp/stripemaker-signal-live.json`).

Flashing-red follow-up: the matrix offers flashing red arrows only; legacy
ball assignments retain their stop/yield service as arrows.
`signal-green-ball.browser.cjs` checks left/right matrix and live arrow directions,
yellow/red flashing, and round-trips the arrow phase assignments. The focused signal/project suite
passes 39 tests, including full-stop gating for flashing red arrows.


Shared-head follow-up: `tests/signal-shared-heads.browser.cjs` exercises setup
selection from a movement, placement preserving that movement, multiple movements
on one doghouse, independent circular green and flashing arrows in both directions,
undo/redo, and project round-trip. Model coverage validates/remaps shared movement
references without changing phase assignments. Use the same Chromium/WebKit
commands above; screenshot: `/tmp/stripemaker-shared-heads.png`.


Movement-line flashing: `tests/signal-green-ball.browser.cjs` now checks yellow
and red line flashes in the phase preview and live playback, synchronizing live
line on/off states with the physical head. Preview hit targets remain available
through the dark interval; live paths are noninteractive. Steady greens remain
steady, and reduced-motion preferences disable the preview animation.


Continuous grid greens: `tests/signal-continuous-green.browser.cjs` checks that
setting a second green leaves the first intact, each cell retains its glyph,
red changes just that cell, and undo/redo and project round-trip preserve them.
Live samples verify both the head and movement line stay green through the first
parent's yellow/red and clear after the final green parent. Model regressions
cover fixed, actuated and coordinated operation, barrier waits, cycle wrap,
skipped phases, detector call loss, pedestrian leads/exclusivity, and protected conflict detection for every green column.
Screenshot: `/tmp/stripemaker-continuous-green.png`.


Right-side head editor: `tests/signal-head-editor.browser.cjs` covers the
SignalMaker indication/layout-only controls, fixed housing/backplate,
reordering, lens sizes, exact custom symbols during live flashing, drag links,
Shift-drag shared links, cancel, undo/redo, project persistence and mobile bounds.
Reports: `/tmp/stripemaker-head-editor-right.png` and
`/tmp/stripemaker-head-editor-mobile.png`. Custom design validation is covered
by `tests/simulator-signals.test.cjs`.


Movement-only playback and minimization: mast/head equipment is disabled by
`StripeMaker.signalFeatures.mastHeads` (default false), retaining saved data and
source. Equipment-specific browser fixtures opt into the retained implementation.
`tests/signal-movement-playback.browser.cjs` checks the default UI, multiple
signalized intersections, green/yellow/red transitions and flashing, continuous
updates while minimized, restore/pause, mobile bounds, and preservation of saved
equipment. Screenshot: `/tmp/stripemaker-simulator-minimized.png`.


Phase drag reorder: `tests/signal-phase-reorder.browser.cjs` checks pointer and
keyboard reordering, cross-ring/barrier rejection, Escape, focused header,
unchanged timings/assignments, actual playback order, undo/redo and project
persistence. The synthetic touch event check exercises the same drop logic;
native pointer capture is verified by mouse drags in Chromium and WebKit.
Screenshot: `/tmp/stripemaker-phase-reorder.png`.

Signal feature isolation: preemption has been removed from UI, runtime, and
validation. Legacy saved preemption fields are ignored. Pedestrian features
are temporarily off (`simulatorSignals.features.pedestrians = false`); saved
heads and timings are retained but do not call phases, hold greens, or block
validation. `tests/signal-disabled-features.test.cjs` covers actuated/fixed/
coordinated service and continuous greens. The retained pedestrian tests opt
in explicitly.

`tests/signal-opposing-lefts.browser.cjs` uses
`tests/fixtures/signal-opposing-lefts.json`, extracted from the saved offset
intersection that reported movements 3 and 4 as conflicting protected turns.
Both are ordinary opposing left greens in phase 3; their paths cross twice.
The fixture verifies the yielding assignment is accepted, playback reaches
phase 3, preemption controls are absent, and disabled pedestrian settings
survive project JSON without affecting service. Run with the browser variables
above. Screenshot: `/tmp/stripemaker-opposing-lefts.png`.

Multi-phase detectors and help: `tests/simulator-signals.test.cjs` exercises
phases 1/4 extending either active green, maximum-green termination, delayed
calls, extension, independent locking and shared-detector call aggregation.
`tests/signal-help-detectors.browser.cjs` checks phase checkboxes, diagram
numbers, undo/redo, portable JSON, and top-right descriptions for mouse,
keyboard and narrow screens. Screenshot:
`/tmp/stripemaker-signal-help-detectors.png`.

Whole-signal flashing operation is removed. Operation offers actuated, fixed
time and coordinated only; legacy `mode: "flash"` normalizes to actuated.
Per-phase flash-color settings are ignored. Per-movement flashing yellow and
flashing red remain matrix indications; `signal-movement-playback.browser.cjs`
now exercises both through ordinary phase service. Model regression covers
legacy-mode fallback without losing matrix flashing assignments.

## Signal queues and movement-aware lane choices

- `tests/fixtures/simulator-signal-queues.json` preserves geometry, speed zones,
  signal settings and demand from the supplied `signal.json` (three mainline
  through lanes). No sheet image or user browser storage is used.
- Run `tests/simulator-signal-queues.browser.cjs` with the usual Chromium/WebKit
  variables. Default: seed 7, 180 simulated seconds, saved temperature/demand,
  recovery disabled. `SEED`, `SECONDS` and `REPORT` select additional runs.
  It checks an actual low-speed plan 100 ft before the signal, rejects the
  turn-only lane for a through trip, records low-speed changes during playback,
  and checks overlaps, interventions, completed trips and controller errors.
- Baseline seed 7 rejected every adjacent target in that low-speed probe and
  recorded zero lane changes initiated below 5 mph. Unit regressions also
  reproduce a driver stopped at 97% of a lane change: it must release its old
  lane after its full oriented body clears the edge, while retaining the target
  lane reservation. A still-angled/straddling body must remain visible.
- `tests/simulator-double-turn-queues.browser.cjs` uses real lane and intersection
  geometry for double left/right turns followed by either next turn. The short
  connecting road cannot fit a weave. A wrong-lane driver can prepare before
  the first intersection; a correctly positioned driver must not switch away
  from the lane needed afterward. Run Chromium and WebKit.
- Intersection approaches rank safe alternatives by the existing MOBIL score,
  use the existing personal acceleration/duration forecast for queue moves,
  and preserve the remaining sequence of intersection entrances/exits. Lane
  IDs may change for parallel turn paths. No new gap/headway/acceleration tuning
  or equal-throughput assumption is introduced. Cruising pass geometry and
  lane reservations away from intersection queues retain their existing policy.
- Keep `tests/simulator-highway-merge.browser.cjs` (seed 7, 60 mph, temperature 20)
  and `tests/simulator-lane-changes.browser.cjs` in this regression set. The
  former rejects new virtual-stop braking; the latter preserves keyhole and
  separated-track crossing restrictions.

Verified queue-fix run (2026-11-03): Chromium seed 7 recorded 6 low-speed lane
changes in 180 seconds (baseline: 0); WebKit seed 23 recorded 7. Both had zero
body overlaps, collision interventions and watchdog removals, and completed
47/62 trips respectively. These are seeded regression observations, not a
capacity claim (the original seed-7 run completed 49 trips). Both browsers pass
the double-turn route probes; 203 simulator model tests and the existing lane-
change/keyhole and freeway-merge browser regressions pass. Final reports:
`/tmp/signal-queues-verified-{chromium,webkit}.json`,
`/tmp/signal-queue-highway-scoped.json`, and `/tmp/signal-queue-stopped-probe.json`.
The separate stopped probe confirms a legal move from zero speed and rejects
the turn-only alternative for a through driver.

Same live corridor scenario before/after: p95 frame time 16.7/16.7 ms, 95 active
cars, 15.067 simulated seconds in 15.234/15.237 wall seconds; no script errors.
Reports: `/tmp/signal-queue-live-{before,after}.json`. The 500-car numerical
benchmark median was 2.68/3.26 ms and p95 4.31/5.35 ms; the final numerical run
shared the machine with browser regressions, so it is not an isolated performance
comparison. Live results are machine/scenario-specific, not a universal FPS claim.

### Long red queues and yellow-to-red braking (2026-11-04)

- Fixture: `tests/fixtures/simulator-red-queues.json`, the updated user
  `signal.json`, without its image or transient playback diagnostics. Preserve
  its demand, speed zones, temperature 18 and signal timings (including the
  100-second phase-1 minimum and four-second yellow).
- Run `tests/simulator-red-queues.browser.cjs` with the standard browser
  variables. Defaults: 360 seconds, seed 7; recovery disabled. Use seed 23 in
  WebKit as a second traffic population. Reports include yellow acceleration,
  stale signal references, first-red speed drops, physical overlaps and trips.
- A separate controlled check on the same geometry holds red and starts six
  stopped through cars 100 ft apart in one lane. It must fill all three legal
  through lanes, retain the planned turn, finish without straddling, and record
  no overlaps, collision interventions or red crossings. It does not assume a
  bumper-to-bumper queue can slide sideways without steering room.
- Original seed-7 reproduction: 578 acceleration samples on steady yellow,
  319 stale signal references after route changes, and four large first-red
  speed drops. One car fell from 52.2 to 30.6 mph in a single physics step.
  `/tmp/red-queues-before.json` holds that baseline.
- Raw `largeGaps` measures the route's origin-lane leader; a car partly in its
  target lane can correctly follow a different leader. Do not interpret this
  count as unused storage or capacity without inspecting the actual body and
  limiting leader. The controlled packing check is the queue regression.
- Keep the unit signal/driver tests, double-turn browser probes, freeway-merge
  (60 mph, temperature 20, seed 7), and lane-change/keyhole regressions passing.
  Numerical safeguards and calibration limits are recorded in DRIVER-MODEL.md.

Verified final runs: Chromium seed 7 and WebKit seed 23, each 360 simulated
seconds, recorded zero body overlaps, collision interventions, watchdog removals,
steady-yellow acceleration samples, stale signal references and large first-red
control speed drops. Both controlled packing checks filled all three through
lanes with all six cars stopped, fully clear of their old lanes, preserving
turns and staying behind red. Reports:
`/tmp/red-queues-verified-chromium.json` and
`/tmp/red-queues-verified-webkit.json`. All 210 simulator model tests pass, as do
both browsers' double-turn probes and the existing freeway/keyhole regressions.
These checks establish the tested behaviors; they do not promise equal lane
queues or calibrated capacity, and ordinary following/merging waits remain.

### Flashing-yellow continuity and arriving red queues

- `tests/signal-continuous-flashing-yellow.browser.cjs` checks matrix assignment,
  live head/path flashing across consecutive parents, full steady-yellow arrow
  clearance, red clearance, circular through-movement symbols and persistence.
  Run Chromium and WebKit. Unit cases cover actuated, fixed and coordinated
  operation, isolated parents, barrier/cycle continuation, lost detector calls,
  parallel-ring protected priority, and the driver's yellow permission.
- `tests/simulator-red-queue-flow.browser.cjs` uses the saved roadway geometry
  with red held constant: 20 through vehicles/minute for two minutes, followed
  by one minute to settle. Recovery is disabled. This complements the earlier
  six-car packing probe with a continuously arriving queue. It checks full
  maneuver room, every lane reaching the line, no unfinished changes or large
  interior gaps, and no overlaps, collision interventions or red crossings.
- Before the fix, 41 vehicles left ten unfinished lane changes and a largely
  unused middle lane; the queue reached about 463 ft upstream. A 150-second
  diagnostic of the fix leaves no unfinished maneuvers, continuous standstill
  gaps and a longest queue near 390 ft. These are seeded observations, not an
  equal-lane-use guarantee or a calibrated capacity result. Keep the six-minute
  mixed-turn run and double-turn/freeway regressions in the verification set.

Final verification: 217 simulator model tests passed. Chromium and WebKit pass
both the flashing-yellow UI regression and the 180-second arriving-red-queue
regression (41 cars, all three stop-line positions occupied, no unfinished
maneuvers, maximum interior gap about 6.81 ft, zero overlaps/interventions).
The six-minute mixed-turn replay passes with no stale signal observations,
steady-yellow acceleration or abrupt first-red control speed drops. Continuous
green, turn-aware flashing symbols, retained head editing, double-turn routing,
disabled pedestrian/equipment features and freeway merging also pass their
regressions. Reports: `/tmp/red-queue-flow-verified.json`,
`/tmp/red-queue-flow-webkit.json`, `/tmp/signal-followup-mixed-queues.json`.

### Intersection rates and short-road route preparation (2026-11-04)

- `tests/simulator-intersection-temperature.test.cjs`: actual green departures
  and red approaches at temperatures 0/40/75/100, 1 and 6 px/ft. Confirms existing
  independent personal acceleration/braking samples, immediate startup on the
  first permitted step, exact stops and no collision interventions. No extra
  multiplier or reaction delay was introduced. Temperature help now explains
  intersection starts, red-light approaches and turns.
- `tests/fixtures/simulator-minor-road-uturn.json`: the road data/settings from
  the supplied `simulatorothingy.json`, without its image/diagnostic payload.
  Entrance 25 was connected but topology planning at a fixed speed rejected the
  necessary cross-lane preparation for U-turn road 23. Only exit 21 was reachable.
  A lazy slower preparation fallback now retains legal paths to exits 5/14/15
  too, while keeping normal-speed paths preferred and preserving all gap checks.
- `tests/simulator-minor-road-uturn.browser.cjs`: ten simulated minutes with
  temperature 18, seed 7, source 25 at 3 vehicles/min across four destinations,
  original geometry/signals/speed zones, watchdog disabled. Chromium and WebKit complete all four destinations with actual U-turn trips,
  zero physical overlaps or collision interventions. `MIXED=1` retains the sheet's other
  entrance demand; `REPORT=/tmp/...json` selects the artifact path.
  Default artifacts: `/tmp/minor-road-uturn-{chromium,webkit}.json`.

The existing 60 mph / temperature 20 highway merge and three-lane arriving-red
queue browser regressions pass after this routing change. These route fitting
and timing choices are numerical policies, not new measured driver parameters.

Final full-demand result: `/tmp/minor-road-mixed-admission.json` retains the
sheet's original main-road demand and adds source 25 at 3 vehicles/min. Ten
simulated minutes, seed 7, temperature 18, watchdog disabled: source 25 completed
`{5:4,14:1,15:3,21:3}`, 14 vehicles traversed the U-turn, zero physical overlaps,
zero watchdog removals and no sustained collision-avoidance stalls. One transient
safety correction occurred in the final minute. The mixed test treats physical
overlaps, missing completed destinations and sustained guard stalls as failures;
correction counts remain diagnostic. Isolated clearance still requires zero
corrections. The final isolated WebKit replay completed
`{5:8,14:4,15:5,21:8}`, with 20 U-turn vehicles and zero corrections.

235 simulator/project model tests pass, including explicit-road-merge topology,
priority and preservation of an admitted path. The final signal-queue regression
passes with zero overlaps or guard interventions; the highway regression passes.

## Whole-sheet load harness and exact optimisation workflow (2026-11-04)

`live-sheet.cjs` loads any saved fixture (`FIXTURE`, default the minor-road U-turn
signal sheet), multiplies every entrance (`DEMAND`, default 4: about 200 cars),
warms a seeded run (`WARM_SECONDS`, `SEED`), writes a SHA-256 fingerprint of the
final state, then measures live frames over the whole sheet. `PROFILE=1` profiles
the warm-up (physics only); `PROFILE=live` profiles the animated phase including
rendering and `OVERLAYS=speed,density,stopped`.

Optimise without changing vehicle behaviour: the warm fingerprint must stay
identical. Build a pre-change copy, run both with the same options, compare
`warm.fingerprint` on several fixtures (U-turn sheet with another seed, signal,
weaving, highway merge via `live-highway.cjs`, six-minute roundabout, all-way
STOP). Equal-gap ties are order sensitive: keep candidate iteration order.

Measured (this machine, Chromium, U-turn sheet, DEMAND=4, seed 7, 240 s warm):

| | before | after |
|---|---|---|
| warm wall time (206 cars) | 160 s | 57 s |
| live physics step p50 / p95 | 49 / 75 ms | 17 / 41 ms |
| live frames p50 | 167 ms | 16.7 ms |
| simulated / wall time | 0.61 | 1.00 |

Other fixtures (150 s warm): U-turn seed 3 2.2x, signal 1.9x, weaving 3.1x,
highway 2.6x, roundabout 2.0x, all-way STOP 2.0x; every fingerprint identical.

What changed (all exact equivalents):
- `leader()`: binary search to the car's path position; a cached per-path
  segment plan (connector segments, monotonic lane-station runs); each lane run
  scans its corridor once and locates cars by station; candidates are applied
  in the original segment/corridor order.
- `indexCars()`: connector spatial grid and segment candidates are reused while
  no car inside an intersection has moved (lane-change reindexing), numeric tiles.
- Collision broad phase: per-car cached bounds (path, distance, travel, ppf,
  width), a streamed knot walk without pose objects, numeric scene tiles.
- `threat()`: the car's own forecast samples and swept padding are shared by all
  candidates; `conflicts()` uses a pose grid prefilter and the precomputed boxes.

Invariants these caches rely on: a prepared path (`preparePath`) is never
mutated in its points/lengths (replace the path instead); bounds depend only on
path, path distance, travel, ppf and fallback lane width. Remaining hot spots at
200 cars: `leader` connector projections, forecast bounds over 8 s of path
knots, and new-path `conflicts` after reroutes.
