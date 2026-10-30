# MUTCD sign artwork and catalog

Source: [FHWA Standard Highway Signs, 2024 edition, release tables and vector archives](https://mutcd.fhwa.dot.gov/kno-shs_2024-release-status/), retrieved October 29–30, 2026.

The catalog covers **all 1,059 distinct codes** listed under Regulatory Signs, Warning Signs and Object Markers, Temporary Traffic Control Signs, School Signs, and Guide Signs (including M-series route markers and D/E-series guide signs). It excludes miscellaneous drawing details and discontinued signs. Detour signs listed in the Temporary Traffic Control table remain included. The official table supplies each sign's name and code; archive filenames supply published legend, direction, color, and size variants. Size is in inches; `null` means FHWA specifies a variable dimension. The catalog includes 3,137 published layouts. The selector groups physical sizes under each design; direction, color, and legend variants remain distinct. Each design defaults to its smallest published layout; there is no physical-size control. Other layouts remain bundled so existing saved signs continue to render.

Artwork comes directly from the linked releases 1, 2, 3 (both archives), 4, 5, and 6. Each catalog record retains its archive and member filename for traceability. Release numbers in the official table select the current version of each sign. `coverage.json` records the coverage audit.

Run `scripts/import-signs.py INDEX_HTML ARCHIVE_DIRECTORY` using Python with `svgpathtools` and `pymupdf` installed to rebuild. Inputs are a saved copy of the source index and its linked ZIP archives. No Python package is used by the web app. The importer normalizes SVG outlines into M/L/Z paths, with a 0.025-unit curve subdivision tolerance on a 100-unit face, to share StripeMaker's vector PDF export path. PDF-only D3-1, R3-45a and R6-3a faces are extracted from the official undimensioned PDFs. Dimensioned fabrication drawings are excluded; red/cyan construction measurements embedded in the R6-3a face PDFs are removed. Editorial text and custom pictograph instructions are omitted; variable-message template pattern areas are left unfilled. No fonts, scripts, external images, or Adobe metadata remain in the output SVGs.

The federal FHWA drawings are United States government works (public domain under 17 USC §105). Their inclusion does not imply FHWA endorsement. The selector implementation and styling reuse SignalMaker / SignMaker conventions under the repository's inherited GPL-3.0 license.

Callouts are schematic plan annotations: the arrow points from the sign face to the post location. Display size is independent of the published sign's physical dimensions and the sheet scale.

## Variable legends and direct-file loading

`catalog.js` and lazy `data/<code>.js` packs load as local classic scripts, so opening `index.html` via `file://` needs neither a server nor cross-origin fetch. The SVG files remain the picker thumbnails. `fonts/osifont-data.js` provides the existing licensed export font for direct-file PDF downloads.

Run `scripts/build-sign-options.py PATH_TO_ALPHABETS_PDF` after the catalog import (Python dependencies: `pymupdf`, `svgpathtools`, `numpy`, `scipy`). This extracts Series B/C/D/E/EM/F glyph outlines and spacing from [FHWA Standard Alphabets](https://mutcd.fhwa.dot.gov/SHSe/Alphabets.pdf). `scripts/sign-legend-specs.json` identifies editable regions and validation; `options-coverage.json` audits every generated field. Current customization covers 59 codes / 199 layouts: speeds, clearances, weights, distances, grades, street names, selected parking/school times, fines, passing/following values, and Interstate/U.S./state/county route numbers and selected state/county names. Other catalog signs retain their published legends.

Speed values use 5 mph increments (MUTCD 11th Edition §2B.21; advisory-speed plaques §2C.59). Numeric limits also reflect the available legend area; they do not prescribe a legal speed, engineering value, or installation. R2-1 uses the published Series E numeral heights (8, 10, 12, 14, and 16 inches for the five published panel sizes). Replacements retain measured lettering heights and layout margins; values that cannot fit are rejected. Variable-width W16-8P / W16-8aP panels expand to fit their lettering. All substituted glyphs remain vector paths in PDF exports.

Two official 102×84 guide SVG files (D9-18a and D9-18c) contain only Illustrator metadata and no displayable artwork. Those empty layouts are recorded in `coverage.json`; other published sizes provide both codes in the selector.

Assemblies combine individual signs in a gap-free grid under a single leader and post. Their arrangement is schematic, not a determination of permissible combinations or installation spacing. Face rotation is baked into vector path coordinates. Callouts use a simple arrow without a post marker. Pasted images are normalized to PNG at up to 1024 pixels per side with transparency preserved; their PDF image objects use alpha masks while all official signs and leaders stay vector.

The selector's D/E scope is narrower than the bundled source catalog: standalone assembly components are offered; overhead and large guide-board layouts are reserved for SignMaker. The explicit product filter is `signDesigns.standalone` (based on the sign families in MUTCD Chapters 2D/2E/2G). Excluded artwork is retained to open existing sheets. Interstate/U.S./state shield digit-count variants are grouped, and the Route number field automatically selects the published three-digit face for values 100–999 without shrinking the face height.

## Sign-face colors and numeral alignment

`palette.json` defines the shared screen/print palette from the principal swatches in the official FHWA SHS drawings, with pure black/white for those specified colors. Source swatch aliases are normalized at import; cyan construction and dimension marks are excluded. This applies to all built-in SVG thumbnails, loaded vector artwork, substituted legends and exports. Pasted images retain their own pixels. `color-coverage.json` records the palette audit.

[FHWA color specifications](https://mutcd.fhwa.dot.gov/kno-colorspec.htm) define fabrication colors using chromaticity/luminance and provide separate printing guidance; they do not define a single universally compliant RGB palette. The RGB values here are the official artwork's display approximations, not fabrication specifications.

Editable route numerals are centered on the shield's vertical centerline using the actual glyph outlines, rather than carrying forward the example number's optical offset or unused advance width. Their published vertical position and cap height are preserved.

## Florida standalone route markers

The supplemental `florida.json` / `florida.js` catalog is separate from the FHWA
coverage audit. It contains Florida Route Marker (FTP-612-25), Toll Route Marker
(FTP-611-25), Florida’s Turnpike (FTP-610-25), and CFX TM / TM-ALT. Physical size
alternatives are not picker entries. The state marker switches between its
published two-, three-, and four-digit numeral layouts automatically.

- [FDOT Standard Plans 700-102, FY 2025–26](https://fdotwww.blob.core.windows.net/sitefinity/docs/default-source/design/standardplans/2026/idx/700-102.pdf), sheets 2, 3 and 9: imported state-marker outline and Turnpike lettering; published panel and numeral dimensions. Legacy identifiers FTP-16-10, FTP-17-06 and FTP-81-06 remain searchable.
- [FDOT 2026 Traffic Engineering Manual](https://www.fdot.gov/traffic/trafficservices/traffic-engineering-manual) and [2026 Turnpike trailblazing details](https://floridasturnpike.com/wp-content/uploads/2026/03/Typical-Trailblazing-Signs.pdf): current FTP identifiers and standalone assembly usage. FDM §230.6.8 identifies the numbered-route shield and directs designers to the sign library. Assembly illustrations are not used as fabrication artwork.
- [Latest posted FDOT 700-102, FY 2027–28](https://fdotwww.blob.core.windows.net/sitefinity/docs/default-source/design/standardplans/2028/idx/700-102.pdf), sheet 15 (revision 11/01/26): the FTP-611-25 24 × 30 route marker supplies the exact panel, border, divider, Florida outline and TOLL paths. Top corners have the dimensioned 1.5-inch radius; numerals are six-inch Series D at 16 inches from the top. This replaces the previous inaccurate trailblazer-derived illustration. The [2026 FDM §230.6.8](https://fdotwww.blob.core.windows.net/sitefinity/docs/default-source/roadway/fdm/2026/2026fdm230spavtmarkings.pdf) is the manual currently linked by FDOT; the 2027–28 drawing is the latest posted detail, with a future revision date relative to this update.
- [CFX 2026 Sign & Pavement Marking Design Details](https://www.cfxway.com/wp-content/uploads/2026/03/2026-CFX-SPM-Design-Details.pdf), sheets 5–6: TM orange outline and TM-ALT black outline (state jurisdiction), black-on-yellow TOLL, white face, and 12-inch Series D route legend on the 36 × 48 panel. CFX calls for optical numeral spacing to avoid the outline and border. Fitting is ported from sibling SignMaker v2.2 `public/js/Control.js`, `fitOfficialRouteInk` (GPL-3.0): tighten tracking only as far as an 8%-of-cap-height gap between adjacent ink bounds, then apply horizontal compression if still too wide. Height is unchanged. Its `Shield.js` 36 × 48 settings are used verbatim: top 22.53 in, center 15.64 in, maximum ink width 22.84 in, height 12 in. StripeMaker supplies vector-glyph ink bounds instead of browser font metrics. This fallback is SignMaker’s display-fitting choice, not a separate CFX fabrication requirement. TOLL uses the specified six-inch FHWA Series E alphabet. Orange/yellow screen swatches use the shared sign palette; fabrication material specifications remain those of CFX.

Rebuild with `scripts/import-florida-signs.py <FDOT-PDF> <CFX-PDF> <LATEST-FDOT-700-102-PDF>`, then
`node scripts/compose-florida-thumbnails.cjs`. Source PDF geometry becomes local
M/L/Z vector paths; editable legends use the bundled FHWA alphabets. No network
request is made when opening the picker, including from `file://`. These sources
are agency standards; this app is not endorsed by FDOT, FTE, or CFX.
