# Driver inputs, scope and numerical safeguards

Production playback uses IDM following and braking, the simplified MOBIL incentive
and rear-gap criterion for legal road-lane changes, and per-driver lane-change
and headway profiles. It follows permitted movements; it does not invent turns
or drive along bike lanes. Following/gap observation includes connected roads
and matching streams within an intersection. Actual body collision prevention
also checks crossing trajectories and lane changes, excluding other elevations.

## Evidence ledger

| Input | Value | Evidence and applicability |
| --- | --- | --- |
| Lane-change duration | mean 6.28 s, SD 2.0 s | [NHTSA DOT HS 809 702](https://www.nhtsa.gov/sites/nhtsa.gov/files/documents/lane_change_final.pdf), Table 3.38, 7,196 single changes; highway observations. |
| Following headway | mean 1.6 s, SD 0.8 s | Same report, Table 1.1, Fancher field sample. Baseline headway is retained. The SD is evidence only; the temperature distribution below does not fit these measured moments. |
| IDM acceleration / comfortable deceleration | 0.73 / 1.67 m/s² | [Treiber, Hennecke & Helbing (2000)](https://arxiv.org/abs/cond-mat/0002177), Table I; published highway model defaults. |
| IDM minimum gap / exponent | 2 m / 4 | Same paper. Desired free speed comes from the local road speed zone. Stops do not produce reverse motion; ballistic integration follows the [author's IDM notes](https://mtreiber.de/MicroApplet/IDM.html). |
| MOBIL safe target-follower braking / incentive | 4 m/s² / 0.2 m/s² | [Author's MOBIL reference](https://mtreiber.de/MicroApplet/MOBIL.html). Politeness 0.3 is selected within its typical 0–0.5 range, not a measured distribution. |
| Roundabout speed / priority | cap 15 mph, yield at entry | [FDOT driver guidance](https://www.fdot.gov/agencyresources/roundabouts/faq.shtm) gives 10–15 mph on approach and priority to circulating traffic. We select the upper bound as a default and retain a lower user speed cap. Not a site-calibrated speed distribution. |

## Explicit numerical policies

- Physics step: 1/30 s (30 Hz; user-requested performance tradeoff). Driver decisions: 0.2 s. Crossing forecast: up to 8 s
  sampled every 0.25 s with rotational padding. These are computation policies,
  not measured perception/reaction times. No occlusion model is claimed.
- Vehicle bodies match the supplied sprite: lane width minus 2 ft, aspect 381/214.
  This is the requested display geometry, not a measured fleet-width distribution.
- Oriented rectangle SAT detects contacts; continuous swept SAT on each polyline
  piece prevents tunnelling even at extreme slider speeds. Spatial hashing
  reduces candidate pairs. Same-level crossings conflict; elevated traffic does not.
- Roundabout admission observes the immediately upstream leg, defined by adjacent
  lane-entry bearings about the roundabout center, including bodies straddling
  either boundary. Other sectors do not reserve the ring against an entrance.
  Reversed traffic uses exit bearings and reversed circulation/entry identities.
- Within the immediate merge (two vehicle lengths past the yield line), compare
  the entering driver's acceleration/desired speed plus sampled headway with the
  approaching driver's earliest accelerated arrival. A gentler accelerator needs
  a larger gap. Do not assume occupied crossing space clears on a forecast; wait
  for actual clearance. A constrained queue leader also prevents assuming free
  acceleration. The local sector and merge length are explicit user/numerical
  policies, not measured perception limits or fitted critical-gap values. The
  [FHWA roundabout guide](https://www.fhwa.dot.gov/publications/research/safety/00067/00067.pdf)
  describes entry gap acceptance; this implementation is not a calibrated capacity
  prediction for the user's site.
- Entry permissions remain provisional only while the vehicle can still stop at
  its normal hold point (the driver’s modeled safe-braking distance, standstill gap,
  half body and one integration step of response distance). Closer grants commit: cancelling would leave a car obstructing circulation.
  Respect actual queue leaders. Denied entrants reserve no future crossing space.
  Ordinary intersections retain conservative incompatible-movement admission;
  the local-leg policy applies only to roundabouts.
- The hold point uses the actual lane-specific roundabout yield line, including
  spiral flares and setback. An ideal circle radius can put a stopped entrant
  in a circulating vehicle's path.
- Collision resolution checks simultaneous trajectories. It must not assume
  unprocessed moving cars are parked. Contact constraints reduce travel; a
  numerical emergency stop is a safeguard, not a physical crash/impact model.
- Stored projects contain configuration only. Cars, entry permissions and
  collision counts are transient. Project diagnostics include current driver
  reasons, leaders, levels, entry permissions and collision interventions.

These inputs support a reproducible traffic model, not a validated prediction
for a specific location. [FHWA microsimulation calibration guidance](https://ops-dr.fhwa.dot.gov/trafficanalysistools/tat_vol3/sect5.htm)
requires comparison with local traffic observations. Signals, sign compliance,
cyclist/pedestrian behavior and visibility occlusion remain separate work.

## Global temperature and bounded driver population

Temperature is an app-wide 0–100 integer, saved with settings and optional project
settings import, and locked during playback. A paused edit starts a fresh driver
population. Default **40** is a deliberate moderate modeling choice, not a
measured or government-prescribed population temperature.

Each driver receives one stable profile at creation. Zero means the exact
baseline without any profile randomness. For inputs other than acceleration and
comfortable braking, the envelope remains `temperature × 0.005` (±0.5% per degree).
Ordinary profiles use its central half; quick-response profiles use 80–100% of
its envelope in correlated risk directions (shorter headway/gap/duration and
higher speed targets). The quick-response probability is now `temperature / 300`:
13.3% at the unchanged default 40, 25% at 75, 33.3% at 100. These are independent
population draws, not a quota scheduled every fourth car.

Acceleration and braking have the wider user-requested distribution. Ordinary
profiles independently draw multipliers uniformly from `1 ± temperature × .008`.
Quick-response profiles independently draw around `1 + temperature × .016`, with
half-width `temperature / 750`. At 75 this means 25% of profiles have 2.1–2.3×
acceleration/braking, centered on 2.2×; ordinary profiles span 0.4–1.6×. At 100 the
ranges are 2.467–2.733× and 0.2–1.8×. MOBIL's safe-braking limit is never lower than
comfortable braking. These mixtures implement the user's experiment control;
they are not an empirically fitted national driver distribution. The 0.73/1.67
m/s² baselines remain the cited IDM highway model defaults, not national averages.

All modeled behavioral inputs vary: duration, headway, IDM acceleration,
comfortable deceleration, jam gap and exponent; MOBIL safe braking, politeness
and incentive; road desired-speed factor and roundabout speed factor. Actual
velocity still responds to traffic. Positive bounds, legal routes and body
collision prevention apply at every temperature. A dedicated measured human
reaction-delay model is not added by this control; the numerical decision cadence
remains fixed. Many baselines are research/model inputs, not legal mandates.

Geometry, body dimensions, lane/route percentages, emissions, physics timestep,
forecast cadence, route permissions and collision guards do not vary. At zero,
route-opportunity placement uses a fixed midpoint policy as well; configured
weighted demand choices and colors are still sampled independently.

## Stuck-blocker recovery

After 30 **simulation** seconds with less than one foot of cumulative progress,
follow stationary blocking dependencies. A deadlock cycle, or a stranded root
inside an intersection, can remove one culprit. Prefer an entry vehicle physically
blocking circulation when identifying a cycle culprit. Preserve its followers and
reset their progress timers so a single incident does not cascade through the
queue. Ordinary entry queues with a moving blocker and zero target speeds are exempt.
The timeout is the user's explicit recovery policy, not a calibrated driver trait;
it never changes with temperature. Removals and IDs appear in simulator/project
diagnostics and never alter saved spawn or route configuration.

## Six-minute stuck.json regression

The supplied export captured circulating/entering pairs (150/168 and 160/166)
mutually blocked by collision prevention. Reconstructing those actors and running
seven more simulated minutes without recovery left them stuck, confirming a
prevention defect. Previously, a permission granted upstream stayed active even
when its predicted crossing clearance became invalid. Revalidate before entry,
and use actual clearance of incompatible movement footprints. This intentionally
prefers a queue before the yield line to a crossing deadlock inside the ring;
it is not a site-calibrated capacity or gap-acceptance model.

`tests/simulator-six-minute-stuck.browser.cjs` uses the exported geometry/settings
(61.7 mph, temperature 0), runs seven simulated minutes per seed, and disables
`recoverStuck` throughout. Verify zero body overlaps, no stationary circulating
or exit vehicles, and continued departures. A watchdog despawn cannot make this
test pass.

Earlier conservative admission check (20 Hz): Chromium and WebKit seeds 123 and 7
each completed 420 simulated seconds
at the saved settings with recovery disabled: zero body overlaps, zero stationary
time in circulation/the tested exit, and 56/55 completed trips respectively.

The 60 Hz yield-line regression also exposed late cancellation at time 311 s:
entering car 81 was held beyond its normal stopping position, physically blocking
circulating car 63, which it was yielding to. Commitment must use stopping distance,
not wait until the nose reaches the yield line. The later two-lane regression
refines this to the modeled safe-braking bound rather than comfortable preference. A focused test gives another
entrant older arbitration priority and verifies it cannot revoke this committed
clearance. Denied cars still claim no future movement space.

With stopping-distance commitment and denied-car reservations removed, the 60 Hz
Chromium seed 123 completed seven minutes with 82 trips, zero ring/exit stationary
time, zero body overlaps and zero emergency collision interventions; watchdog
recovery was disabled. Retain both the empty-crossing and late-cancellation unit
regressions: throughput alone did not catch the latter defect.

The second 60 Hz Chromium seed (7) completed 77 trips with zero ring/exit stationary
time and body overlaps, with recovery disabled; 128 collision safeguards occurred
outside the circulating/exit stall checks. The high-temperature browser scenario
also passed with zero overlaps and zero watchdog removals.

WebKit seed 123 matched the final 60 Hz Chromium result: 420 simulated seconds,
82 completed trips, zero ring/exit stationary time, zero overlaps and zero
emergency collision interventions, with watchdog recovery disabled.

## Local upstream-leg admission regression

The user's follow-up rejects yielding to cars elsewhere in the roundabout. The
focused collision test covers a near upstream car, a remote-sector car whose
future route crosses the entrance, an occupied crossing and a gap accepted by a
normal accelerator but rejected by a gentler one. Routing tests check reversal of
entry/exit identities and gate geometry. The seven-minute saved-sheet test remains
watchdog-disabled, so increased flow cannot conceal stuck vehicles by removal.
Chromium seed 123: 170 completed trips, zero ring/exit stationary time and body
overlaps; two numerical collision interventions. Earlier whole-route admission
completed 82 trips on the same sequence. Neither count is a calibrated capacity.

Chromium seed 7 also passed seven minutes: 188 completed trips, zero ring/exit
stationary time and overlaps, 21 numerical collision interventions, recovery
disabled. High-temperature playback passed with 80 drivers, zero overlaps and
zero watchdog removals. The reusable seeded live-roundabout benchmark measured
p95 frames 16.8 ms and 14.983 simulated seconds in 15.004 wall seconds at 39 cars.

WebKit seed 123 matched the local-entry Chromium run: 170 completed trips over
420 simulated seconds, zero ring/exit stationary time or overlaps, two numerical
collision interventions, watchdog disabled. All 249 unit tests pass.

## Two-lane southwest entry / premature commitment

The supplied StripeMaker-project.json uses 46.4 mph, temperature 38 and 5× playback.
Cars entering quickly could be marked irrevocably committed almost at their spawn
when the commitment calculation used comfortable deceleration. That prevented an
older waiting car from contesting a clear gap. Use the existing per-driver MOBIL
safe-braking bound (never below comfortable braking) plus one actual physics step of travel
for the numerical commitment boundary. This is an arbitration policy, not a new
empirical deceleration measurement or a change to IDM acceleration preferences.

Keep the established conservative crossing margins, actual body occupancy checks
and collision safeguards. This correction changes admission commitment, not the
driver acceleration preferences or the site’s gap-acceptance calibration.

`simulator-two-lane-yield.browser.cjs` checks the real approach's two stopped heads
against a fast, safely revocable grant at another approach: both clear lanes must
receive permission. The old commitment/margin calculation fails that case. The
same fixture then runs eight minutes at the saved mph/temperature with recovery
disabled, checking both lanes continue entering and actual body separation.

Once an admitted car is physically in the immediate merge (within two body lengths
of its yield line), circulating/exiting drivers must still forecast its body.
Previously the common intersection ID hid all such conflicts behind reservations.
Protect clearance of the committed merge, then restore ordinary circulation
priority; unadmitted queues get no such protection. A driver must never yield
back to its own observed follower. These are numerical arbitration/observation
policies; they are not a new legal right-of-way rule or fitted driver variables.
The focused unit case covers the committed body, ordinary queued yield and the
leader/follower feedback exclusion. The extra conservative crossing margins remain.

Final verification on the supplied two-lane fixture (seed 123): Chromium and
WebKit each ran 480 simulated seconds at 46.4 mph / temperature 38, with recovery
disabled. Southwest entries: 37 left and 37 right, 209 completed trips across the
network, zero stationary time in circulation, zero body overlaps or removals.
The original stuck.json seeds 123/7 also passed seven minutes with no ring/exit
stalls or overlaps (160/180 completed trips). The high-temperature scenario passed
with 83 drivers, zero overlaps and zero watchdog removals. All 252 unit tests pass.
The populated 5× live run measured p95 frames 16.8 ms, 75.017 simulated seconds in
15.014 wall seconds at 49 active cars. These are scenario-specific measurements.

## STOP/YIELD and Florida right of way

`simulator-controls.js` maps the painted upstream edge of each controlled bar
onto the personalized legal path, respecting lane, direction, level and placement
transforms. Black contrast and intersection mouth offsets do not move the stop.
A STOP requires a zero-speed physics sample with the front bumper at the line;
there is no invented legally mandated dwell time. The final millimetre snapping
is a numerical tolerance. Temperature changes the driver profile, never the STOP
obligation. Served stops survive route replanning.

The rule sources are Florida Statutes
[316.123](https://www.flsenate.gov/Laws/Statutes/2026/316.123),
[316.121](https://www.flsenate.gov/Laws/Statutes/2026/316.121), and
[316.122](https://www.flsenate.gov/Laws/Statutes/2026/316.122).
Controlled entrants yield to conflicting uncontrolled traffic; left turns yield
to opposing traffic; all-way STOPs use full-stop order and yield right for
simultaneous stops. All-way classification requires STOP coverage for every
incoming travel lane. A YIELD does not impose a full stop in a clear gap.
Already committed crossing space and continuous body collision safeguards remain
in effect. Gap acceptance estimates body clearance with each driver's acceleration
and desired speed, plus their modeled headway. These numerical estimates implement
“immediate hazard”; they are not statutory seconds or a calibrated Florida
intersection gap-acceptance distribution. Paved/unpaved or state-maintained-road
priority cannot be inferred from lane count: the editor currently has no ownership
or unpaved-road metadata. Signal phases and pedestrian agents remain future work.

`simulator-stop-priority.browser.cjs` retains the supplied `feedback.json` geometry
with its exact missing right-turn restrictions. It runs eight simulated minutes,
watchdog disabled, including five minutes of competing traffic and a clearing
major stream. It checks STOP compliance, departures from both minor approaches,
major-road drainage, actual body separation and semantic-join stalls. Unit
regressions separately check exact bumper positioning at two sheet scales, clear
YIELD passage, safe/unsafe crossing gaps, left-turn/stop-order/right-side rules,
and floating-point joins that previously manufactured diagonal vehicle bodies.

A complete circular yield-right tie at simultaneous all-way STOP arrivals uses
one repeatable courtesy acceptance to release the cycle. This ID tie-break is
an explicit numerical policy, not an additional statutory priority, and cannot
override already admitted traffic or body collision protection.

Road-wide exit choices remain flexible during traffic-aware replanning. MOBIL
checks the incentive and safe front/rear gaps before passing; continuation then
prefers the fewest remaining legal lane changes to any lane of that exit road.
An explicitly lane-specific destination retains its lane constraint. This avoids
requiring a return change solely because an earlier route sample happened to
end in a particular lane, while preserving required turns, lane drops and legal
intersection movements. It does not introduce new empirically calibrated lane
choice probabilities.

## Contextual curve targets

`simulator-curves.js` estimates road/intersection path curvature at 5-ft stations
and uses the unbanked FHWA relationship `V² = 15 R f` (mph, feet), with published
speed-dependent comfort side-friction values. Source links are next to the table.
Banking is assumed zero because the editor does not model superelevation. This is
a geometry-based simulation preference, not an engineering determination of a
posted advisory speed or a fitted operating-speed distribution. Straights keep
the personal desired speed. Curvature ahead is read using the driver's headway
and comfortable braking so speed drops before the turn and recovers afterward.
New entrants start at their contextual speed when a curve is close to the spawn.

The existing personal roundaboutFactor also multiplies general curve targets:
temperature zero uses the baseline, and wider profiles include faster/slower
curve-taking preferences. Entry-clearance estimates also include the turning
movement's curve target. STOP/YIELD obligations and swept-body guards still apply.
Circulating roundabout paths retain their existing driver-guidance target rather
than treating their spiral lane-routing/weaving bends as road-alignment curves;
entry and exit curves outside circulation are analyzed normally.

Drivers continue observing a leading body currently occupying their corridor,
even when its route diverges ahead. Requiring identical future body-length paths
hid slower turning cars from following observations. Lateral position, tangent,
level/intersection identity and symmetric forward-order checks still separate
adjacent/crossing streams and prevent mutual-leader loops.

## Turning-gap audit

Ordinary junctions compare predicted body occupancy intervals, including personal
acceleration, curve targets and an observed receiving queue. A shared receiving
lane also needs acceleration room: a turn must not demand more than the rear
priority driver's comfortable braking. Forecast integration (0.125 s), its
60-second bound, and the 95% cruise recovery cutoff are numerical policies, not
measured critical-gap distributions. An unreachable clearance is infinite.

Cars sharing an incoming lane follow their turning leader with IDM; turn
permission must not manufacture a stationary barrier for that whole stream.
Both participants use the larger personal headway in crossing checks, so a turn
cannot accept a gap that the priority driver immediately rejects. Waiting at
the exact conflict boundary is not commitment. Ordinary junction
commitment begins after passing that boundary; roundabouts retain their local
braking-bound entry policy. Conflict geometry comes from the configured movement
catalog so a waiting position does not jump as different cars arrive.

Lane-change intention is visible to later decisions within the same physics step,
but an unstarted intention is not physical occupancy in the neighboring lane.
Replanning must retain safe braking room, and source admission adapts initial
speed to an observed queue. Collision fallback contains unresolved contact
locally rather than freezing unrelated vehicles on the sheet.

`simulator-turn-gaps.browser.cjs` checks the high-demand saved feedback geometry
with the watchdog disabled. It measures upstream as well as inside-junction
abrupt stops, braking above the personal safety bound, same-input virtual
barriers, actual overlaps and completed trips. A previous inside-only abrupt-stop
check could miss the user's upstream braking symptom.

During a lane change, observations in both occupied lanes are compared by their
IDM braking demand. Choosing only the closest of those two leaders hid a slower
car behind a nearer fast leader until late in the maneuver. The old lane is
released on completion; no new empirical braking parameter is introduced.

Speed zones set the local personal target; there is no global MPH setting. Their boundaries
are inserted into playback paths; comfortable braking anticipates lower limits,
then the target follows the next section. Unassigned sections start at an
editable local 30 mph. Yellow boxes identify all sections in creation mode. They use the personal speedFactor;
curve targets independently use curve preference. These user-entered limits do
not introduce a calibrated speed-limit compliance distribution. Queued source
candidates recalculate their target before each attempt; a blocked zero-room
entry waits outside the active traffic rather than inserting a stopped car.

## Rolling freeway merges

The supplied highwaymerge.json has an added acceleration lane followed by a
lane drop, with no STOP/YIELD marking. A required lane change's initially chosen
station is not itself a yield line. Drivers observe the target-lane front/rear
traffic, predict a slot over their personal lane-change duration, and adjust
speed while searching farther along usable lane. When a gap is unsafe, they can move their attempt farther along the usable lane
while adapting speed. A currently safe gap is not rejected solely to chase an
exact speed match. An unstarted (zero-progress) maneuver may
be replanned; active steering retains collision/following protection.

[FHWA's merge task analysis](https://www.fhwa.dot.gov/publications/research/safety/humanfac/01103/ch2.cfm)
separates initial acceleration to reduce speed differential, gap search, and
merge steering. The implementation uses that sequence and the existing cited
IDM/MOBIL parameters. Slot midpoint prediction, a headway response window and a rolling extension
that reserves comfortable stopping distance are
explicit numerical policies, not coefficients fitted to the published merge
studies. Target-lane traffic is extrapolated at its observed speed and rechecked.

Temperature acts through each driver's existing duration, headway, acceleration,
braking and safety preferences. Speed matching is bounded by personal comfortable
acceleration/braking; actual leader/control/collision braking remains independent.
It does not override local speed zones or grant permission through an unsafe gap.
A rejected gap can still require stopping when no further legal maneuver fits.
Travel is bounded at an unaccepted steering start; an extended moving approach
cannot bypass the actual safety check.

`simulator-highway-merge.browser.cjs` preserves the supplied geometry and rates;
the watchdog is disabled. It supports MPH (local zones), TEMPERATURE and SECONDS,
records actual ramp-to-highway maneuvers, stopped samples, completed trips and
body overlap. The default test explicitly uses the file's legacy 70 mph as local
road zones to exercise highway speeds; MPH=30 exercises the new local defaults.
No retired global speed setting is reintroduced. Its original fixture retains
no speed zones, exactly as supplied.

Rolling-merge crawl regression: the full-speed static route graph could reject a
later merge while a slower vehicle still had hundreds of feet of usable lane.
The operational fallback forecasts travel with the existing personal acceleration,
contextual speed target and full personal lane-change duration, then rejoins the
legal route graph. This is a numerical forecast, not a new measured distribution.
An obsolete progress-zero marker in a retained road-joint prefix must be stripped
when the maneuver is moved. A newly closed imminent gap prompts a decision before
the normal decision timer, but repeated unchanged rejection stays on that timer.
Temperature still varies duration, headway, acceleration, braking and speed
preferences; it cannot authorize an unsafe gap or forbidden boundary crossing.

STOP/YIELD paint only acquires control through its matching attached action.
The clear-road YIELD regression now requires unchanged personal target speed,
not just a speed greater than zero, at temperatures 0/20/75/100.

Acceleration before gap positioning: slot-midpoint tracking could command a
ramp driver to decelerate while the observed mainline vehicles were all faster.
The merge target now has a lower bound at the slower observed front/rear speed,
then the existing local speed/curve target bounds it above. This is an explicit
numerical interpretation of FHWA's initial-acceleration-before-gap-search sequence,
not a measured critical-gap coefficient. It allows acceleration alongside a gap
that is not yet safe to enter; admission, receiving queues, genuine hazards and
finite remaining lane room still govern steering/braking. Each driver's existing
temperature-dependent acceleration, duration and headway remain in effect.

A required lane change may start in a safe present gap before its originally
sampled start station. The route callback must validate the whole maneuver and
legal continuation, including actual bicycle-boundary crossing ranges; an open
gap alone cannot permit a forbidden crossing. Use attainable personal travel over
the full maneuver duration. This avoids repeatedly moving a merge farther ahead
while driving past usable gaps, eventually exhausting the acceleration lane.

Rolling continuation is independent of whether target-lane traffic is currently
inside the speed-matching observation window. If none is observed, use the local
contextual target and the existing personal headway/braking room for continuation;
absence of an observation must not switch back to a stationary planned-point
barrier. Actual control/queue/collision and lane-end checks are unchanged.


## Cooperative acceleration-lane merges

The previous rolling-gap implementation put almost all adaptation on the ramp
car. The receiving driver now participates before the ramp reaches its merge
station. A route qualifies only when its current lane ends and the neighboring
lane continues. Future intersections interrupt this anticipation. The observed
receiving driver may change one lane away from the ramp when the complete legal
maneuver and gap are available; otherwise a comfortable speed adjustment can
open a following gap. Actual lane occupancy, control obligations, route legality
and collision checks still apply. An unserved STOP before the merge prevents
courtesy requests from granting premature priority.

[Kang and Rakha (2020)](https://doi.org/10.3390/s20061554) describe human cooperative
merge interaction and validate their model with NGSIM. This implementation uses
that cooperative principle, **not their fitted game coefficients**. Its forecast
uses personal lane-change duration, headway, body lengths and acceleration;
MOBIL politeness scales the response. Comfortable deceleration and a speed floor
one personal braking-response interval below the ramp target bound that response.
The horizon, gap forecast and courtesy rule are explicit numerical policies.

[FHWA's interchange task model](https://www.fhwa.dot.gov/publications/research/safety/humanfac/01103/ch2.cfm)
uses 1.5 m/s² for its acceleration-lane example. We use this context baseline,
scaled by the driver's already sampled acceleration factor, while preparing for
and performing the required merge. It is a model input, **not a measured national
mean**. Ordinary cruising restores the existing 0.73 m/s² baseline and the same
personal sample. Temperature still varies acceleration, braking, headway,
steering duration, speed preference and politeness; cooperation draws no extra
per-step driver randomness.

Preparation targets the local traffic/zone speed, bounded by reachable speed
while reserving the full lateral maneuver. For available distance D, acceleration
a and maneuver duration T, the planning ceiling is
`-a*T + sqrt((a*T)^2 + v^2 + 2*a*D)`, never below current speed. This constant-a
forecast is a numerical planning estimate, not exact IDM integration. A car
prepares to accelerate until within one personal acceleration-response interval
of that goal; it does not require exact equality from an asymptotic model.
Longer crossings reserve proportionally more maneuver time. Actual traffic can
still lower attainable speed, and the driver must recheck the current gap.

Before steering, curvature preference uses the continuing road alignment,
translated to meet the acceleration-lane mouth. This avoids treating taper
packing as a new low-speed bend. Vehicles still follow their actual lane paths;
active steering retains physical curvature checks, and current/downstream speed
zones always come from the actual route. A rejected provisional steering station
is a center-path station, not a painted stop bar: gap checks already account for
both bodies, so no extra front-bumper setback belongs there.

The cooperative regression includes a straight 30-to-70-mph entry, with either
an available mainline lane change or a blocked boundary requiring speed
cooperation. The entrant must approach highway speed before steering without
first slowing below its entry speed. Separate cases cover temperature, occupied
adjacent lanes, upcoming STOP controls, approaching requests across road joints,
and restoring the ordinary driver profile after the merge.

If the requested traffic speed is physically unattainable in the remaining lane,
a presently safe gap takes precedence over further speed preparation. The car
continues accelerating through the maneuver. Rejecting that gap to chase an
unreachable target consumes the remaining merge room and creates a slow queue.

For a driver already within one personal response window of the preparation
threshold, project that same receiving gap through the remaining preparation
wait. If it is safe now but would close during that wait, use the current gap
and keep accelerating. This avoids a fraction-of-a-second speed-preparation
wait followed by abrupt braking at a newly unsafe steering point. The forecast
uses existing constant-speed neighbor projection and personal acceleration;
it is a numerical decision policy, not a new measured reaction-time value.
Current admission safety is always rechecked. Tests cover both directions and
two sheet scales, with stable, closing and already-unsafe gaps.

Rolling forecasts use the lower of the attainable preparation target and the
observed traffic-matching target. If an accelerating approach plus the complete
maneuver does not fit, also test a full maneuver at the present rolling speed.
A legal current-speed continuation remains useful while the driver searches and
speed/gaps are reevaluated; it must not become an early stop simply because an
optimistic acceleration forecast overruns the lane. Both candidates retain the
personal maneuver duration, actual crossing restrictions and legal destination.
These are planning forecasts; actual longitudinal response still comes from the
driver/traffic model, with immediate gap and collision protection.

### Weaving and destination-aware merging

A physically continuing lane may still require merging to reach the selected
exit. Those maneuvers participate in speed preparation and courtesy requests.
Discretionary passes may not add a return weave from an exit-only lane. Drivers
requesting opposite changes use longitudinal order to open a gap; the forward
driver can accelerate into clear space while the rear driver makes room. These
are numerical coordination policies using the existing acceleration, braking,
headway and politeness samples, not newly calibrated empirical distributions.

Repeated rejected gap searches must retain enough maneuver distance to accelerate
from rest over the driver's full steering duration. Otherwise slowing drivers
repeatedly shorten their trajectory until it is almost sideways at the fork.
The lower bound integrates the existing personal constant acceleration up to the
local target; legal crossing restrictions and actual gap admission still apply.
Forecasts stop at another vehicle's unaccepted steering start. Accepting that
gap invalidates its cached hold immediately; active maneuvers and swept-body
collision protection remain observable.

### Individual STOP ordering

[Florida §316.123](https://www.leg.state.fl.us/Statutes/index.cfm?App_mode=Display_Statute&URL=0300-0399/0316/Sections/0316.123.html)
supplies first-stop ordering at four-way stops and right-hand priority for
simultaneous arrivals. The simulator applies this to all-way STOP networks,
including multiple lanes and separate divided mouths. Each car must register
its own complete stop at its painted bar. A later conflicting stop cannot jump
that order because its crossing lies closer. Disjoint movements may proceed
together. Once admitted beyond the STOP bar, the driver retains the accepted
turn while crossing the approach; ordinary permissive turns retain their
separate conflict-line logic. Partially controlled intersections still give
uncontrolled traffic priority. No randomized temperament overrides these rules.

A STOP/YIELD action on a road marking exactly at an attached incoming mouth
automatically associates with that intersection at runtime. Require a unique
connection, equal levels, and the transformed paint's front edge at the road
end (1 mm geometry tolerance, not a driver parameter). This recognizes the
supplied allwaystop.json without adding or moving paint or changing its saved
manual links. Set-back and standalone lines still need an explicit intersection
link to participate in its turn-taking. Mere proximity never establishes priority.
The panel names automatic connections and explains the effect of an unlinked
control. Road-lane coverage remains per painted lane, including implicit aligned
lanes on adopted intersection approaches.

The explicit Not linked choice stores `trafficControl.unlinked: true`. It
overrides both automatic mouth recognition and association from placement on
an intersection lane. The local STOP/YIELD action and its physical level remain
intact. Automatic or an explicit intersection selection clears the override;
history, reload and project imports preserve it until changed by the user.

### Demand units

Demand is scheduled in vehicles per minute; seconds, hours, days and AADT are
input/display conversions, preserving fractional rates. Destination volumes can
sum to the entrance output or act as relative weights for a fixed entrance
output. AADT denotes average daily volume ([FHWA TMG glossary](https://www.fhwa.dot.gov/policyinformation/tmguide/tmg_2022/tmg-glossary.cfm));
uniform demand over 24 hours is an explicit simulation assumption. No seasonal,
hourly or peak-direction factors are inferred.

### Intersection queue lane choices

Queue approaches use the existing MOBIL advantage to rank both adjacent legal
lanes rather than accepting the first adequate lane. The existing safety and
incentive thresholds remain unchanged. The low-speed path forecast integrates
personal acceleration over the driver's full maneuver duration; using cruising
speed times duration would reject maneuvers that fit at the actual lower speed.
This is a numerical planning policy, not an urban lane-change calibration of the
highway duration sample. Actual IDM, controls, legal lane boundaries and swept
body checks still constrain travel.

A discretionary queue choice must preserve all remaining intersection
entry/exit pairs and must not increase required downstream lane changes. The
lane identities may differ, allowing a driver to use either member of a double
turn when the following turn remains reachable. When an intersection queue
stops a maneuver short of 100%, the old lane is released only after the entire
oriented vehicle rectangle clears its edge. The target lane remains reserved;
a straddling or angled body still occupies the original lane. Cruising lane
reservations away from junction queues retain their existing policy.

Red queues also compare usable storage in adjacent legal lanes, including the
standstill gap behind each queue leader. A gain of one complete vehicle slot
can prompt an early change even when MOBIL's instantaneous acceleration gain is
small. The same 0.001 ft geometry tolerance as the stop-line check accounts for
sampled curved-path versus lane-station distances. Compare storage while the
leader is still approaching red; waiting until it is almost stopped leaves
too little steering room. This is a geometric queue policy, not a calibrated
distribution or equal-lane-use target.

Before a discretionary red-queue move, check room for its full rolling maneuver
in both lanes. A moving leader contributes its comfortable stopping distance,
capped at its remaining distance to the red line. A stopped leader contributes
none. Reject a move that would halt partway across the queues; retain the full
curve and personal duration. This is a numerical planning forecast, with actual
IDM, legal routes, gap checks and swept-body safety still enforced.

A barely started lane change reserves its
target for other lane-change admissions but becomes a leader for that lane's
existing traffic only when its oriented body reaches the lane. A maneuver not
yet started may reconsider its target on an intersection approach.

### Steady-yellow decisions

Steady yellow warns of the impending red under [Florida §316.075](https://www.flsenate.gov/Laws/Statutes/2026/316.075).
Drivers prefer a stop within their comfortable braking rate. If that is
insufficient, the model checks whether the front can reach the line within the
remaining yellow at its current/local speed. If it cannot, but stopping is still
within the existing modeled safe-braking bound, braking begins during yellow
and that decision/rate persists into red. A driver too close for that bounded
stop may continue; a vehicle already across the line keeps clearing.

Steady yellow does not induce acceleration to beat red. A continuing driver
slowed by traffic rechecks the stop decision; a stop decision stays latched.
Route-distance changes cannot reset the decision for the same movement, and
replanning immediately refreshes the observed signal/movement reference. These
are explicit numerical decision policies using existing driver bounds, not
measured yellow-response behavior or signal-timing recommendations.

### Flashing-yellow phase runs

Matching permissive assignments continue flashing through consecutive served
parents, including their change intervals, barrier waits, skipped uncalled
phases and cycle wrap. The next parent is reserved when continuation starts,
as for continuous green. An intervening served red cell ends the run. At its
end, the terminating parent supplies the full steady-yellow interval before
red; vehicle observations use that parent's remaining yellow time. Permissive
clearance remains yielding and retains its turn arrow. See MUTCD 11th edition
Part 4, Sections 4F.04/4F.08 for steady-yellow termination of permissive flashing
yellow. Matrix symbols, retained head lamps and movement lines share the state.

### Rate-only intersection response and short-road preparation

Temperature's existing personal acceleration and comfortable braking samples
already govern intersection starts/stops and turn approaches. Actual-engine
regressions now isolate those rates at temperatures 0, 40, 75 and 100 and two
sheet scales. The user chose no added startup hesitation; do not double-apply
variation at intersections.

Topology planning first keeps its existing normal-speed routes. If a destination
is missing, the simulator may try lower-speed preparation on short roads. It
still walks each legal adjacent-lane pair, road link and intersection movement.
Personalization uses the existing sampled maneuver duration and available road
length to set a lower speed target when all required crossings would otherwise
not fit. The target uses personal comfortable braking ahead, applies without a
second temperature factor, and releases after the preparation road. Gap admission,
car following and collision safeguards still control actual progression. This is
an explicit route-feasibility policy, not a newly calibrated duration or permission
to jump directly across occupied lanes. See the saved minor-road/U-turn fixture.

The full-demand minor-road replay also exposed missing admission at explicit
road-to-road merges. Geometry-only collision forecasts allowed a feeder and
through car to park against each other. Runtime merge metadata now reuses the
existing conflict/receiving-gap machinery on all affected lanes of such joints.
The envelope uses four full-lane-width vehicle lengths on each side; a feeder
holds a body length clear of the sampled conflict. The more curved feeder yields
to the continuing stream, subject to already-entered traffic. This is a numerical
join policy, not an inferred user STOP/YIELD marking. Unjoined crossings and
reversed divergences are excluded. Preserve an admitted merge's path until clear:
replanning in that envelope discarded its claim and moved the hold onto the car.

Yield lines, direct merge turns and timed lane changes (2026-11-04). A YIELD or
STOP line on a road lane feeding an explicit road merge now carries its legal
obligation into that merge (F.S. 316.123); the earlier bend-only rule let a
U-turn feeder commit at ~8 mph ahead of 54-mph through traffic, which then
braked for it. Yielding feeders also forecast through cars beyond the merge
envelope that are already leaving an upstream junction. Side roads may turn
directly into a farther lane at a merge when ordinary changes cannot reach the
exit; the entry curve length (merge envelope or 3 x lateral shift) is a
numerical geometric policy. Lane changes in progress are rebuilt to the driver's
remaining NHTSA-based duration at current speed when the car slows, bounded by
the AASHTO P design vehicle's 24-ft minimum turning radius (Green Book 2018,
Table 2-2a). Also capping it to the old lane's queue room was tried and made
stalls worse (barely started changes committed to curves that still did not
fit), so it was removed. Before this, planned
350-450 ft crossings stalled half-finished behind red queues with open storage
in the target lane. These are geometric/timing policies, not calibrated data.
