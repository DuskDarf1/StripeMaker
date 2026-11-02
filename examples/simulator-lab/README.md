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
