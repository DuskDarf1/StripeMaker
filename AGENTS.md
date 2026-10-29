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
  Copy, Download, Dark/light mode, Undo, Redo, and Clear all.
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
  Design Manual, and cite the source in code next to the constant.
- Lane lines: 6 in white skip line, 10 ft stripe / 30 ft gap (FDOT 711-001; pay
  item 710-11-131). A lane line that continues across a joint keeps its 10'-30'
  cycle going from the road before it rather than restarting at the joint.
- Edge lines: 6 in solid; yellow on the left edge, white on the right edge, for
  one-way and two-way roads alike. A two-way road's centerline is a double
  yellow: two 6 in solid lines with a 4 in gap (711-001 "Double Solid Lines").
- Gores and painted medians (711-001 sheet 8). "Traffic Channelization at
  Gore" for same-direction splits and merges: 8" white gore lines, 18" white
  chevrons at 45° pointing back at approaching traffic, 20 ft apart. "Markings
  for Traffic Separation" for opposite directions: 18" yellow diagonals at 45°,
  spaced Y by posted speed (10 ft at 30 mph or less, 20 ft at 35–40, 30 ft at 45,
  40 ft at 50 or more). The island's 6" double yellow approach lines are not
  drawn yet; the roads' 6" yellow edges outline it.
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
  pack against it. Each lane end's taper is Auto (tapers only when the lane
  doesn't continue across a joint into a road going the same way), Taper, or
  None, with a length in feet (default 300 ft, capped at the road's length).
  Taper markings are the default lane and edge lines for now; FDOT taper
  markings come later.
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
- Not yet designed: per-road marking edits.

## Current scope

- Elements (editor panel): Add Road, then click a start and end point to draw a
  one-lane, one-way road. Lanes (1–8) and lane width (default 12 ft, 8–20 ft)
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
- Markings, Intersections, Signs, Simulator, Levels, Copy, Download, and Clear
  all are placeholders and do nothing yet. Dark/light mode, Undo, and Redo are
  functional.

## Implementation

- Use plain HTML, CSS, and JavaScript. No framework or build step is needed.
  Third-party libraries are vendored in `js/vendor/` with their licenses
  (geotiff.js 3.0.5, MIT).
- Only modify StripeMaker. Leave SignalMaker and the SignMaker projects untouched.
- Preserve the inherited GPL license and attribution when reusing their UI.
