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
  GeoTIFF (`.tif`/`.tiff`, the standard ortho download), JPEG, and PNG. Read
  GeoTIFF georeferencing to get true inches per pixel; JPEG/PNG have no scale.
  Do not fetch imagery from map providers; users download sheets themselves.
  Large GeoTIFFs render as 4096 px canvas tiles. The workspace pans by drag,
  zooms by wheel/pinch, and refits on double-click.
- Markings, Intersections, Signs, Simulator, Levels, Copy, Download, and Clear
  all are placeholders and do nothing yet. Dark/light mode is functional.

## Implementation

- Use plain HTML, CSS, and JavaScript. No framework or build step is needed.
  Third-party libraries are vendored in `js/vendor/` with their licenses
  (geotiff.js 3.0.5, MIT).
- Only modify StripeMaker. Leave SignalMaker and the SignMaker projects untouched.
- Preserve the inherited GPL license and attribution when reusing their UI.
