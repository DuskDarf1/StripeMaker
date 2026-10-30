# MUTCD sign artwork and catalog

Source: [FHWA Standard Highway Signs, 2024 edition, release tables and vector archives](https://mutcd.fhwa.dot.gov/kno-shs_2024-release-status/), retrieved October 29, 2026.

The catalog covers **all 739 distinct codes** listed under Regulatory Signs, Warning Signs and Object Markers, Temporary Traffic Control Signs, and School Signs. It excludes the Guide Signs table, miscellaneous drawing details, and discontinued signs. Detour signs listed in the Temporary Traffic Control table remain included. The official table supplies each sign's name and code; archive filenames supply published legend, direction, color, and size variants. Size is in inches; `null` means FHWA specifies a variable dimension. The catalog includes 1,962 published layouts. The selector groups physical sizes under each design; direction, color, and legend variants remain distinct. Published dimensions are selected in the editor before placement.

Artwork comes directly from the linked releases 1, 2, 3 (both archives), 4, and 6. Release 5 contains guide signs. Each catalog record retains its archive and member filename for traceability. Release numbers in the official table select the current version of each sign. `coverage.json` records the coverage audit.

Run `scripts/import-signs.py INDEX_HTML ARCHIVE_DIRECTORY` using Python with `svgpathtools` and `pymupdf` installed to rebuild. Inputs are a saved copy of the source index and its linked ZIP archives. No Python package is used by the web app. The importer normalizes SVG outlines into M/L/Z paths, with a 0.025-unit curve subdivision tolerance on a 100-unit face, to share StripeMaker's vector PDF export path. PDF-only R3-45a and R6-3a faces are extracted from the official undimensioned PDFs. Dimensioned fabrication drawings are excluded; red/cyan construction measurements embedded in the R6-3a face PDFs are removed. Editorial text and custom pictograph instructions are omitted; variable-message template pattern areas are left unfilled. No fonts, scripts, external images, or Adobe metadata remain in the output SVGs.

The federal FHWA drawings are United States government works (public domain under 17 USC §105). Their inclusion does not imply FHWA endorsement. The selector implementation and styling reuse SignalMaker / SignMaker conventions under the repository's inherited GPL-3.0 license.

Callouts are schematic plan annotations: the arrow points from the sign face to the post location. Display size is independent of the published sign's physical dimensions and the sheet scale.

## Variable legends and direct-file loading

`catalog.js` and lazy `data/<code>.js` packs load as local classic scripts, so opening `index.html` via `file://` needs neither a server nor cross-origin fetch. The SVG files remain the picker thumbnails. `fonts/osifont-data.js` provides the existing licensed export font for direct-file PDF downloads.

Run `scripts/build-sign-options.py PATH_TO_ALPHABETS_PDF` after the catalog import (Python dependencies: `pymupdf`, `svgpathtools`, `numpy`, `scipy`). This extracts Series B/C/D/E/EM/F glyph outlines and spacing from [FHWA Standard Alphabets](https://mutcd.fhwa.dot.gov/SHSe/Alphabets.pdf). `scripts/sign-legend-specs.json` identifies editable regions and validation; `options-coverage.json` audits every generated field. Current customization covers 54 codes / 161 layouts: speeds, clearances, weights, distances, grades, street names, selected parking/school times, fines, and passing/following values. Other catalog signs retain their published legends.

Speed values use 5 mph increments (MUTCD 11th Edition §2B.21; advisory-speed plaques §2C.59). Numeric limits also reflect the available legend area; they do not prescribe a legal speed, engineering value, or installation. R2-1 uses the published Series E numeral heights (8, 10, 12, 14, and 16 inches for the five published panel sizes). Replacements retain measured lettering heights and layout margins; values that cannot fit are rejected. Variable-width W16-8P / W16-8aP panels expand to fit their lettering. All substituted glyphs remain vector paths in PDF exports.
