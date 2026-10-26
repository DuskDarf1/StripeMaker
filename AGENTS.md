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
  Copy, Download, Dark/light mode, and Clear all.
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
  item 710-11-131).
- Edge lines: 6 in solid; yellow on the left edge, white on the right edge, for
  one-way and two-way roads alike. A two-way road's centerline is a double
  yellow: two 6 in solid lines with a 4 in gap (711-001 "Double Solid Lines").
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
- Two-way roads are two one-way roads side by side: joining a road whose travel
  is opposite places it left edge to left edge, forming the double yellow. Each
  side keeps its own lane count.
- Option/Alt-drag pulls a road end off its joint. Curve handles turn the whole
  joint, keeping joined roads lined up.
- Roads are 100% opaque asphalt. Lane nodes are small yellow steering wheels,
  shown for every lane of every road while the Elements tab is open.
- Not yet designed: per-road marking edits.

## Current scope

- Elements (editor panel): Add Road, then click a start and end point to draw a
  one-lane, one-way road. Lanes (1–8) and lane width (default 12 ft, 8–20 ft)
  apply to the selected road, or to the next road when none is selected. Lanes
  are separated by FDOT white skip lane lines, with FDOT edge lines. Clicking
  a lane node while drawing joins the new road to it. Click a road to select
  it; drag a lane node to move that road end. Double-click a lane node to show
  that end's Bézier handle and drag it to curve the road; double-click a
  handle to return that end to its default pull. Arrow keys nudge a focused
  node or handle; Delete removes the selected road; Escape cancels drawing or
  deselects. Roads belong to the sheet they were drawn on.
- Persistence: sheets (original files), their order, selection, scale, view,
  roads, and joints are saved to IndexedDB (`StripeMaker` database) and restored
  on reload. Files are written once; small records save shortly after changes.

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
  all are placeholders and do nothing yet. Dark/light mode is functional.

## Implementation

- Use plain HTML, CSS, and JavaScript. No framework or build step is needed.
  Third-party libraries are vendored in `js/vendor/` with their licenses
  (geotiff.js 3.0.5, MIT).
- Only modify StripeMaker. Leave SignalMaker and the SignMaker projects untouched.
- Preserve the inherited GPL license and attribution when reusing their UI.
