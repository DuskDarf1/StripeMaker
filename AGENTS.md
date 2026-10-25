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
  Heads tab), Markings, Intersections, Signs, Simulator, Levels, then Copy, Download, Dark/light
  mode, and Clear all.
- Follow SignalMaker's automatic theme behavior: use the system theme at startup
  and respond to system changes live. Manual toggles are session overrides;
  resume following the system when it matches the override. Do not persist theme
  overrides across reloads.
- Keep narrow-screen behavior usable and retain accessible control names and
  visible keyboard focus.

## Current scope

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
