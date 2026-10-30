# StripeMaker

StripeMaker is a web app where people upload sheets (plans, aerials, or other
images) of roads, highways, and streets they want to redesign, then overlay new
MUTCD-compliant pavement markings onto them.

## UI convention

- **The UI is taken from the sibling `SignalMaker` project.** SignalMaker MUST be
  used as the reference for every UI similarity. Inspect its actual HTML, CSS,
  and interaction code (`../SignalMaker`) before implementing or changing a
  matching control. Reuse those conventions directly; do not approximate them
  from memory or introduce a replacement design.
- Keep SignalMaker's blue light/dark palettes, Inter and Overpass typography,
  square controls, compact bottom toolbar, top-left editor panels, and
  up-opening popover menus. Do not introduce a new design system, decorative
  cards, or custom UI controls.
- Bottom toolbar, in order: Sheets (an up-opening popover like SignalMaker's
  Heads tab), Elements, Markings, Intersections, Signs, Simulator, Levels, then
  Copy, Download (an up-opening popover), Dark/light mode, Undo, Redo, and Clear
  all.
- Follow SignalMaker's automatic theme behavior: use the system theme at startup
  and respond to system changes live. Manual toggles are session overrides;
  resume following the system when it matches the override. Do not persist theme
  overrides across reloads.
- Keep narrow-screen behavior usable and retain accessible control names and
  visible keyboard focus.

## Pavement marking standard

- **Pavement markings follow FDOT** (Florida Department of Transportation), not
  generic MUTCD defaults. Take every marking dimension, pattern, and color from
  the current FDOT Standard Plans (Index 711-001, Pavement Markings) and the FDOT
  Design Manual, and cite the source in code next to the constant. Don't say
  "FDOT" in user-facing strings; describe the marking itself.
- Lane lines: 6 in white skip line, 10 ft stripe / 30 ft gap (FDOT 711-001; pay
  item 710-11-131). A lane line that continues across a joint keeps its 10'-30'
  cycle going from the road before it rather than restarting at the joint.
- Edge lines: 6 in solid; yellow on the left edge, white on the right edge, for
  one-way and two-way roads alike. A two-way road's centerline is a double
  yellow: two 6 in solid lines with a 4 in gap (711-001 "Double Solid Lines").
- Gores and painted medians (711-001 sheet 8). "Traffic Channelization at
  Gore" for same-direction splits and merges: 8" white gore lines, 18" white
  chevrons at 45° pointing back at approaching traffic, 20 ft apart. "Markings
  for Traffic Separation" for opposite directions: 18" yellow diagonals at 45°
  (moving away from the tip, each runs from the arriving side toward the
  departing side),
  spaced Y by posted speed (10 ft at 30 mph or less, 20 ft at 35–40, 30 ft at 45,
  40 ft at 50 or more), edged in 6" double yellow on both sides (each road's
  yellow edge plus a second line 10" inside it, meeting at the tip).
- Dimensions are to the centerline of markings (711-001). Pavement extends 8 in
  past the edge of traveled way.
- Markings are drawn true size in sheet pixels using the sheet's inches per
  pixel, so a road can only be drawn on a sheet that has a scale.

## Road model

- A road is a one-way group of parallel lanes; traffic flows from start to end.
  **Every lane has its own line with a node at each end**, and all of a road's
  lanes act together: dragging any lane node moves that whole road end.
- Roads join **lane to lane**: one lane's end node joins another lane's start
  node (ends only join starts). Each road end sits on a joint, a point plus a
  direction of travel shared by everything joined there. Lane links fix each
  road's sideways position, so joined ends line up (the joining road turns to
  match) and then move together. Joints can hold several roads for splits,
  merges, lane adds, and lane drops.
- Two-way roads are two one-way roads side by side, left edge to left edge,
  forming the double yellow (or a median between them). They're edited as one
  road: **Opposite lanes** (0 = one-way) draws both sides in one click-click
  with the clicked line as the centerline, adds the other side to a selected
  one-way road in place, or removes it at 0. **Median (ft)** separates the two
  sides while they still move together (0 = double yellow). **Split into
  One-Way Roads** unpairs them in place so each side moves on its own.
  Selecting either side outlines both; lane width and Delete apply to both
  sides; Lanes applies to the clicked side. A two-way road's joints sit on its
  centerline, so changing lanes grows outward and the centerline stays put.
  Both sides are drawn as offsets of one shared centerline curve, so the double
  yellow (or median) stays parallel through curves.
  Dragging a road's lane node onto an opposite road's node also pairs them.
- A road joined to a lane that another road already continues from (or ends
  into) goes **beside** that road, edge to edge on the side it heads toward,
  instead of on top of it: an added lane at a split (or a dropped lane at a
  merge). It starts full width unless tapered; a beside road's tapers hold the
  edge it shares with its neighbor, so it widens away from that road. The two
  roads' facing edges form a gore candidate. Stored as a joint link with
  `beside: ±1` (the side of road a that road b is on).
- Structural changes (split, detach, delete) keep every remaining road where it
  was; a road end left alone without a set curve goes back to pulling straight.
- Option/Alt-drag pulls a road end off its joint. Curve handles turn the whole
  joint, keeping joined roads lined up.
- Roads are 100% opaque asphalt. Lane nodes are small yellow steering wheels,
  shown for every lane of every road while the Elements tab is open. Each
  node has a small yellow flow arrow just inside the road pointing the lane's
  direction of travel, and a tapered lane end adds a round wedge badge past the
  arrow, narrowing toward the lane's zero-width end.
- Tapers belong to one lane at one road end. At an end, the lane narrows from
  full width to zero over the taper length (lane drop); at a start, it widens
  from zero (lane add). The first untapered lane holds its place and the rest
  pack against it. Each lane end's taper is Auto (tapers only when the sheet's
  **Auto tapers** setting is on and the lane doesn't continue across a joint
  into a road going the same way), Taper, or None, with a length in feet (default 300 ft, capped at the road's length).
  Taper markings are the default lane and edge lines for now; FDOT taper
  markings come later.
- Auto tapers (Elements panel checkbox) is a per-sheet setting, **off by
  default**, saved and undoable with the sheet. When off, lanes that start or
  end at a joint stay full width unless their end is set to Taper.
- **Keep lane editing simple.** Roads join only by dragging a lane node onto
  another lane's node (ends line up and move together). There is no separate
  lane-connection tool; Cities: Skylines-style Connect Lanes was tried and
  removed as too complicated.
- **Right-click a lane node** (or Control-click, the Context Menu key, or
  Shift+F10) for a popover of common actions for that road end: Curve This End
  / Hide Curve Handle, Straighten (when curved), Continue Road From Here (ends)
  or Draw Road Into Here (starts), Pull End Free (when joined to another road),
  the lane's taper (Auto, Taper, No Taper), Make Two-Way / Make One-Way, Split
  Into One-Way Roads, and Delete. It uses SignalMaker's copy context-menu look
  with a pointer aimed at the node like a macOS popover, opens to the node's
  right (left if there's no room), follows the node while panning or zooming,
  and supports arrow keys, Home/End, Escape, and Tab. New common node actions
  belong in this menu rather than new panel tools.
- **Branching off an edge line:** while drawing, a road's start or end also
  snaps to any other road's edge line (away from its ends; only the outer edges
  of a two-way road; not while Opposite lanes is set). The road is cut there
  into two joined roads (shape kept exactly; a two-way road is cut on both
  sides) and the new road sits beside it, edge line on edge line, so its lanes
  split off (start) or merge in (end) with any lane count and no taper unless
  Auto tapers is on. Links may name a road's "L" or "R" edge instead of a lane
  to join roads edge to edge. A gore icon appears between the roads.
- **Dragging onto an edge line** is different: a dragged lane node (and
  everything joined at that end) snaps to the center of the lane along the edge,
  and dropping it cuts the road there and joins the dragged lane head-on to that
  outermost lane, so a ramp feeds straight into (or out of) the edge lane rather
  than adding a lane beside it.
- Gores are only offered between edges that face each other across the gap.
- A road's lines are never painted on the travel lanes of a road joined to it
  (an SVG mask per road, shrunk by a line width so lines along a shared edge
  stay). Where a ramp overlaps the lane it feeds, its edge line stops at the
  other road's edge and that road's edge line stops where the ramp crosses it,
  leaving a clean merge or diverge tip. Unjoined crossing roads keep all lines.
- Lane nodes are drawn slightly inside their road's end so joined roads' nodes
  don't cover each other; snapping accepts either the drawn node or the true
  lane end.
- **Gores:** wherever two road ends leave the same joint on the same side and
  their facing edges spread apart (a split, merge, or a two-way road dividing
  into one-way roads), a gore icon appears at the gore point. Dragging it along
  the gore's center paves and marks the gore from the point to the icon; drag
  it back to the point to remove it. Same-direction roads get gore chevrons,
  opposite directions get traffic separation diagonals. Clicking the icon or
  the marked area selects it: the panel shows the marked length, a stripe
  spacing slider (10–40 ft, SignalMaker's slider + number pair) with the FDOT
  spacing for posted speeds, and Remove Marking. Arrow keys on a focused icon
  change the length (Shift for larger steps); Delete removes it. Gores are
  stored per sheet as `{ key, length, spacing }` (feet), keyed by their two road
  ends, saved, undoable, and dropped when their roads no longer form a gore.
- **Medians** (Elements panel **Add Median**): click the median's corners; points
  snap to road pavement corners and edges, marked gore corners and edges, and
  other medians' points and edges. Three or more points close it: click the first
  point, double-click, or press Escape or Enter (fewer points cancel). Points snapped
  to a road edge are anchored there (`on: { road, side: L|R|S|E, f }`, arc-length
  fraction) and move with the road; cutting a road re-anchors them to the piece
  they lie on; a nudged point drops its anchor. Between two points on the same
  pavement edge the outline follows that edge (curves included). Medians draw
  under road pavement. Surfaces: Grass (turf), Concrete (raised, 6" curb at its
  edge), or Painted: Yellow (opposing traffic: second 6" yellow line 10" inside
  the road's edge line, 18" diagonals) or White (same direction: 8" white
  outline, 18" diagonals), with stripe direction (╱ or ╲ relative to the
  median's longest side) and spacing (10–40 ft). Medians can share points; a
  selected median shows square point handles, and dragging a shared point moves
  every median that shares it. Delete on a focused point removes it (at least 3
  remain). Stored per sheet as `{ id, type, color, lean, spacing, points }`,
  saved and undoable.
- Not yet designed: per-road marking edits.

## Current scope

- Elements (editor panel): Add Road, then click a start point and then each
  next node (like Cities: Skylines): each click adds a segment joined to the
  last, and a double-click or Escape finishes (selecting the last segment).
  Ending on a lane node or edge line also finishes. Lanes (1–999) and lane width (default 12 ft, 8–20 ft)
  apply to the selected road, or to the next road when none is selected. Lanes
  are separated by FDOT white skip lane lines, with FDOT edge lines. Clicking a
  lane node selects that lane end and shows its Taper setting and length.
  Clicking
  a lane node while drawing joins the new road to it. Click a road to select
  it; drag a lane node to move that road end. Double-click a lane node to show
  that end's Bézier handle and drag it to curve the road; double-click a
  handle to return that end to its default pull. Arrow keys nudge a focused
  node or handle; Delete removes the selected road; Escape cancels drawing or
  deselects. Roads belong to the sheet they were drawn on.
- Persistence: sheets (original files), their order, selection, scale, view,
  roads, joints, and gore markings are saved to IndexedDB (`StripeMaker` database) and restored
  on reload. Files are written once; small records save shortly after changes.

- Undo/redo follows SignalMaker's `js/history.js` (`js/history.js` here):
  Ctrl/Cmd+Z undoes; Ctrl/Cmd+Shift+Z (and Ctrl+Y off the Mac) redoes; toolbar
  Undo and Redo buttons show their shortcut; "Undone." / "Redone." appear in the
  action status above the toolbar; up to 100 steps. A step is a snapshot of
  every sheet's scale, roads, and joints. Each Elements edit and Set Scale apply
  records one step (call `StripeMaker.history.record()` after an edit); typing
  in an editor number field is one step until the field is left. Uploading,
  removing, or reordering sheets, panning, zooming, and selection are not undo
  steps, and history isn't kept across reloads.
- Sheets: users upload aerial imagery of the roads they are redesigning. Accept
  GeoTIFF (`.tif`/`.tiff`, the standard ortho download), JPEG, and PNG; several
  sheets may be uploaded. Read GeoTIFF georeferencing to get true inches per
  pixel; JPEG/PNG have no scale until set. Do not fetch imagery from map
  providers; the popover's "How to get sheets" dialog tells users how to
  download sheets themselves. Large GeoTIFFs render as 4096 px canvas tiles.
- Each displayed sheet has a constant 3 px white border at any zoom.
- The Sheets list reorders like SignalMaker's Heads list: drag-and-drop with
  wiggle, faded source, and insertion markers; touch dragging; up/down arrows.
  The popover stays open while reordering or selecting.
- Set Scale (Sheets popover) shows two yellow point handles joined by a straight
  line. Users zoom in and drag them across one 12 ft (144 in) travel lane. The
  readout shows `XX px → XX in`; only inches are editable (default 144). Apply
  stores inches per pixel on the sheet, overriding GeoTIFF scale. Arrow keys
  nudge a focused handle; Escape or Cancel exits. Scale is required for
  true-size pavement markings later.
- Workspace navigation: trackpad pinch (ctrl+wheel or Safari gestures) zooms
  smoothly, two-finger scroll pans, a mouse wheel zooms, drag pans, touch
  pinch zooms, and double-click refits.
- Download (`js/download.js`) saves the selected sheet as a PNG or PDF (PNG/PDF
  choice buttons like SignalMaker's): the sheet
  image with its roads and markings (no selection outlines or previews), under
  a white header with the sheet's title in capitals and a rule below it. A width
  slider (SignalMaker's slider + number pair) sets the output size, up to the
  sheet's own width and the browser's canvas limits; the readout shows the full
  size including the header. The header lettering is osifont (an ISO 3098 CAD
  font, `fonts/osifont.woff`, GPL-3 with font exception, see
  `fonts/osifont.LICENSE`), slanted like engineering plan-sheet text.
- **PDFs are vector.** The PDF is written directly (no library): only the sheet
  image is raster (a JPEG at the chosen width); every road and marking is
  converted from the road layer's SVG into PDF vector paths (fills, strokes,
  dash patterns and phase, clip paths, and each road's joined-road mask as
  successive even-odd clips), and the title is real text in embedded osifont
  (`fonts/osifont.ttf`, WinAnsi encoding). Draw new markings into the road
  layer as SVG paths (M/L/Z path data, fill/stroke attributes or the roadBand
  class, `clip-path`/`mask` on groups) so they export to PDF as vectors too.
  The page prints the chosen width at 150 ppi (capped at the 200 in PDF page
  limit); the document title is the sheet's name.
- Markings, Simulator, Levels, and Copy are placeholders and do nothing
  yet. Dark/light mode, Undo, Redo, Download, and Clear all are functional.
- Clear all asks for confirmation (`window.confirm`, as SignalMaker does for
  destructive replacements), then erases the selected sheet's roads, joints,
  gores, medians, and intersections as one undo step; the sheet image and its
  scale stay. Deleting an intersection (panel, popover, or Delete key) also asks
  first.
- Intersection movement paths stop short of the lane arrows at both mouths
  wherever the arrows are shown, and a lane's drag strip appears only while a
  movement is being dragged from its incoming lane to an outgoing lane.

## Implementation

- Use plain HTML, CSS, and JavaScript. No framework or build step is needed.
  Third-party libraries are vendored in `js/vendor/` with their licenses
  (geotiff.js 3.0.5, MIT). Fonts are vendored in `fonts/` with their licenses.
- Only modify StripeMaker. Leave SignalMaker and the SignMaker projects untouched.
- Preserve the inherited GPL license and attribution when reusing their UI.

## Intersections

- Intersections is an up-opening popover following SignalMaker's Heads menu. Its
  list contains the current sheet's intersections, with New Intersection, Edit,
  Duplicate, and Delete. There is **no intersection dialog**: everything is
  created and edited on the sheet. New Intersection places the default layout
  at the center of the view (named "Intersection N"), selects it, and opens the
  side panel with its name ready to type; Edit (or double-clicking the list
  entry or the intersection) opens the panel.
- Default: two 2-lane two-way roads crossing: four approaches, one incoming and
  one outgoing 12 ft lane per approach (Add Approach adds the same), openings
  55 ft from the center (`G.REACH`), 20 ft corner radii, and **no movements**.
  Movements are only ever drawn by the user: adding approaches or lanes, or
  attaching a road, never adds movements. An incoming lane without a movement
  shows a yellow **?** where its arrow would be. These are editable starting
  geometry, not prescribed engineering dimensions. Approaches
  support arbitrary angles, additional legs, 0–999 lanes per direction (at least
  one direction), and 8–20 ft lane widths. Keep at least two approaches.
- Picking an intersection on the sheet (its pavement, a handle, or a
  connection) opens a top-left **Intersection** editor panel (SignalMaker's Head
  Editor pattern; it has no toolbar button of its own and lights the
  Intersections button). It has Name, Add Approach, Delete, the chosen
  approach's settings, its medians, and its lane movements; each change is one
  undo step. Unlike the popover it stays open while panning or clicking
  empty sheet, so the intersection stays selected; the Intersections button
  returns to the list popover. The selected intersection shows lane arrows on
  the sheet: drag from an incoming arrow to an outgoing lane to add a movement,
  and drag a connection to bend it. Outgoing arrows take presses only as the
  selected movement's end, so the pavement around them still drags.
- Dragging a road's lane node (Elements) onto any approach lane going its way
  (a road end arriving at the intersection onto an incoming lane, a departing
  start onto an outgoing lane) snaps that lane's end to the lane's mouth, turned
  to the approach's direction. Dropping links the two lanes and does **not**
  resize the approach. While drawing a road, clicking a free incoming approach
  lane mouth also aligns and links the new road and finishes drawing; a road
  can start from a free outgoing mouth. Creation and linking are one undo step.
  Links are stored on the approach as `links: [{ road, e,
  lane, to }]` (road lane index, approach lane id); linked road ends follow the
  intersection's moves and edits, and dragging the road end away unlinks it.
  Links drop when their lane, road end, or terminal status disappears.
- Each approach has two outer-edge handles. Dragging moves/turns its opening
  without changing lane widths; snap to terminal road pavement corners to adopt
  that road's cross section and tangent. Only road ends attach; intersections
  never cut through-roads. Occupied, nonterminal, and tapered ends are excluded.
- Attached approaches follow road edits; moving an attached opening moves its
  road joint. Moving/rotating an intersection transforms its attached joints once
  each. Lane dimensions follow the road until Detach Approach or Option/Alt-drag.
  Deletion leaves external roads in place. Road cuts rehome endpoint references;
  deleted or incompatible endpoints release their intersection attachments.
- A two-way approach keeps the same centerline spacing as a two-way road: its
  lanes start 5" either side of the centerline (the 10" between the centers of
  the double yellow lines, 711-001), plus any median width. That spacing is not
  a median; a median is drawn only when its width is above zero. This keeps a
  two-way road joined lane to lane flush with the approach's pavement.
- Corner-radius handles round the pavement between approaches; zero is square.
  Divided approaches have median inner-edge handles and a nose handle, with grass
  or concrete surfaces.
- **Several medians per approach.** Besides the center median between the two
  directions, an approach can have medians between lanes going the same way
  (channelizing islands), stored as `splits: [{ id, incoming, after, width,
  nose, surface }]` (between lane `after - 1` and `after` of that side, counted
  from the center); they push the outer lanes outward. A selected unattached
  approach shows a small **+** just outside its opening at every free lane
  boundary (and at the center when it has no median); clicking it adds a 6 ft
  concrete median (editable starting geometry). A split median has an
  outer-edge square (drag to widen; drag to zero to remove; Delete key removes)
  and a nose dot. The panel lists each median with width, nose, surface, and
  Remove Median, plus an Add Median choice. Attaching an approach to a road
  (adopting its cross section) drops its splits.
- **Intersection markings** (`drawMarkings` in `js/intersections.js`) are only
  6" solid lines (711-001) in the road layer's markings group, so they export to
  PDF as vectors. White rides the right side of traffic: each curb from one
  approach's outgoing outer edge around the corner to the next approach's
  incoming outer edge (where both have lanes), and around every
  same-direction (split) median. Yellow marks the
  opposite-direction side: a two-way approach's double yellow runs from the
  mouth to where the curbs start curving (`G.throat`), or, with a center
  median, one yellow line runs up one side of it, wraps its rounded nose (same
  center as the island, at the double yellow's 5" offset), and back down the
  other side. A split's white line traces its island edge the same way.
  No lane lines, stop bars, crosswalks, or painted treatments are drawn yet.
  Existing external roads keep their markings.
- Drag from an incoming lane arrow to an outgoing lane to create a movement;
  dragging onto a lane that movement already reaches removes it instead (the
  status reads "Release to remove this movement."). Drag an existing
  movement's outgoing end to reconnect it. Lane dots are
  deliberately absent. Drag a connection directly to bend it, or use the
  destination list and numeric pulls as keyboard alternatives. Click a
  connection to reveal its two square tangent handles; they appear only for
  that connection.
  Moving an intersection or a handle keeps the selection. Delete Movement and Reset Curve are available.
  Several movements and U-turns are supported; schematic lane arrows derive from
  their destinations. Keep the square handles for actual pavement corners.
- Movement paths fit the actual curved pavement and avoid median noses; they are
  rerouted continuously instead of clipped at edges. A turn's arc starts and ends
  no farther out than where the curbs start curving into the neighboring
  approaches (`G.throat`), so turns happen inside the intersection like real
  ones rather than sweeping from the openings. Automatic movements between
  the same two approaches (two or three throughs, dual turns) never cross or
  crowd each other: when they would, `G.routes` redraws them as offsets of the
  innermost route of the turn (the middle one for throughs), so they run
  parallel. Manually curved movements keep their own curve. Thin white guides with
  repeated arrowheads remain visible with the Intersections popover closed.
- Standalone median points snap to intersection mouths, curved pavement edges,
  and median noses. Anchors use `{ intersection, approach, side, f }`, with an
  arc-length fraction, follow intersection edits, and detach in place when the
  referenced boundary disappears. Outlines follow a shared curved boundary.
- `js/intersection-geometry.js` contains pure feet-based geometry. Per-sheet
  `intersections` records store sheet-pixel origins, stable approach/lane IDs,
  dimensions, road-end bindings, and movement references/pulls. Save and undo
  include these records; one panel edit or completed drag is one history step.
  Duplicate regenerates IDs and creates an unattached independent copy.
- `js/intersections.js` integrates with `StripeMaker.roadEditor` for solved road
  endpoint geometry, joint movement, and rendering. Pavement and median surfaces
  use M/L/Z paths in the road SVG, preserving vector PDF export. Guides and
  interactive handles are a separate overlay and never appear in downloads.
- Validation: `node --test tests/intersection-geometry.test.cjs`. Browser regression
  instructions are at the top of `tests/intersections.browser.cjs`; use an isolated
  profile and a local server. No production framework/build dependency is added.


## Signs

- Signs uses SignalMaker's searchable regulatory/icon selector. Official names and
  codes come from FHWA's 2024 SHS release tables, excluding the Guide Signs,
  miscellaneous details, and discontinued tables. All 739 included codes have
  local vector artwork; 1,962 published direction, legend, color, and size layouts
  are searchable. TTC detour signs remain in the TTC category.
- Choose Sign selects a design (or replaces the selected sign). Add Sign places
  the post on the first click and the face on the second. A leader arrow points
  from the face to a transverse post marker. Drag the face or post separately;
  arrow keys nudge focused controls, Shift increases the step, Delete removes,
  and Escape cancels placement. Callout size is schematic and requires no sheet
  scale; physical sign sizes in the selector are the published layout dimensions.
- Sheet `signs` records store `{ id, design, x, y, postX, postY, width, size, values }`.
  They persist, participate in undo/redo and Clear all, and export as vector
  M/L/Z paths in the road layer. Selection handles and previews never export.
- `assets/signs/SOURCES.md` documents provenance and rebuild instructions;
  `scripts/import-signs.py` imports downloaded official archives using isolated
  Python tools, with no production dependency. `coverage.json` audits coverage.
- Validate with `node --test tests/sign-catalog.test.cjs` and
  `tests/signs.browser.cjs` (isolated profile, same setup as intersections tests).

- Sign sizes are grouped under each design and chosen in the editor before adding.
  Variable legend inputs use the local FHWA alphabet outlines and checked field
  specifications; see `assets/signs/options-coverage.json` for supported layouts.
  Classic-script catalog/artwork packs support direct `file://` opening.
- Road and intersection lane counts support up to 999. Incoming and outgoing
  intersection widths are independently editable unless the whole mouth inherits
  an attached road's dimensions. Lane-linked roads match the appropriate width
  at that end, including the opposite side of a paired road.
- `js/road-widths.js` derives endpoint widths from lane connections. Continuing
  roads share the mean of their chosen lane widths at a joint; beside/pair links
  do not average widths. Each road smoothly blends from these endpoint widths
  to its chosen width at mid-length. Intersection mouths override endpoint width.
  Both sides of a two-way road remain offsets of their shared centerline.
- Additional checks: `tests/road-widths.test.cjs`, `tests/sign-options.test.cjs`,
  and `tests/sign-options.browser.cjs` (direct-file loading and downloads).
