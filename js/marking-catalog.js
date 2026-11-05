/* Lateral pavement markings (across the lane): their catalog and true-size
   geometry in feet. Pure functions, shared by js/markings.js and the tests.

   Local coordinates: x is feet right of the lane's center (right of travel), y is
   feet forward along the lane from the marking's back (upstream) edge. A part's
   `unit` is the y it turns about: each unit (an arrow, a line of a message) is
   placed rigidly, square to the lane at that point, so markings never stretch. Outlines
   come from assets/markings/symbols.js (FDOT Standard Plans Index 711-001 and
   MUTCD Figure 3B-18) and word letters from assets/markings/font.js; see
   assets/markings/SOURCES.md. */
(() => {
  const app = globalThis.StripeMaker ??= {};
  const IN = 1 / 12;
  const WHITE = '#ffffff', YELLOW = '#ffc72c', BLACK = '#000000';
  // FDOT Standard Plans Index 711-001 (FY 2025-26).
  const STOP_LINE = 24 * IN;                   // sheet 2, 24" Solid Stop Line
  const YIELD = { count: 5, base: 18 * IN, height: 27 * IN };  // sheet 2, five 18" x 27" triangles per lane
  const LETTER = 8;                            // sheet 1, 8'-0" letters
  const SCHOOL_CLEAR = 8;                      // sheet 12, 8'-0" between SCHOOL and its 24" lines
  const SHIELD = {                             // sheet 1, route shields (note 5: wider for three digits)
    limited: { label: 'Limited access (8 × 20 ft)', width: 8, length: 20, numerals: 10 + 8 / 12 },
    arterial: { label: 'Arterial or collector (6 × 15 ft)', width: 6, length: 15, numerals: 8 },
  };
  const THREE_DIGIT_WIDTH = 7 / 6;            // MUTCD Figure 3B-18 C: 7 ft three-digit shield vs 6 ft
  // Central Florida Expressway Authority, 2026 Sign & Pavement Marking Design
  // Details (CFX SPM), preformed horizontal signing and option lane arrows.
  const CFX_TOLL = {                           // sheet 47, toll route shield marking (8' x 20')
    width: 8, length: 20, corner: 9 * IN,      // 9"R top corners
    tip: { a: 4, b: 7.75 },                    // Detail A: outside edge half-ellipse, primary radius 4', secondary 7'-9"
    edge: 2 * IN, border: 4 * IN,              // 2" white outside edge, 4" black border
    panel: 48 * IN, bar: 4 * IN,               // 4'-0" yellow TOLL panel, 4" black bar under it
    toll: { height: 37.5 * IN, width: 33 * IN }, // TOLL letters (Detail B)
    florida: 4 * IN,                           // 4" orange Florida outline
    numerals: { height: 75 * IN, width: 48 * IN }, // 6'-3" numerals, 48" for three digits
  };
  const CFX_OPTION = {                         // sheet 46, option lane directional arrow (asphalt)
    length: 105, line: 8 * IN, tail: 15,       // 105' overall; 8" lines; 15' of line before the point of diverge
    head: { length: 25, width: 3.5 },          // Arrow Details A and B: 25' heads, 1.75' each side
    rampTip: 20, rampOffset: 8,                // ramp head tip 20' short of the mainline tip; 8' over (scaled, not dimensioned)
  };
  const ORANGE = '#f7921e', TOLL_YELLOW = '#ffd046';  // the CFX TM face's orange and yellow
  const BIKE_GAP = 6;
  // Colored pavement, full lane width under the lane's markings. Green bike lane
  // (FDOT Design Manual 223.5.3): solid, the 2 ft / 4 ft dotted pattern of the
  // lane extension through a conflict area, or 50 ft solid ahead of the conflict,
  // dotted through it, and 50 ft solid after. Red transit lane (FDOT has none,
  // so MUTCD 11th Edition Section 3H.07): solid, or broken where general traffic
  // may enter, here matching the 2 ft / 4 ft dotted line.
  const SURFACE = { green: '#3c9a4a', red: '#b53a2f', dot: 2, gap: 4, lead: 50 };                          // 711-002 sheet 2: 6' between the bicyclist symbol and the bike lane arrow
  const TWLTL_GAP = 12;                        // sheet 8, 8'-12'-8' two-way left turn arrows
  const ARROW_SPACING = 100;                   // sheet 10, one more arrow per 100' of turn lane
  const TWLTL_SPACING = 300;                   // sheet 8, 300' max. intervals between double arrows
  const MESSAGE_BACK = 25;                     // sheet 1 note 1 / sheet 10: 25' back from the stop line
  const PEDESTRIAN = { width: 6, length: 15, border: 3 * IN, feet: 4 + 8 / 12 };  // sheet 1, In Pavement Warning Marking
  // Crosswalks, sheet 9: 12" white transverse lines; special emphasis adds 24"
  // bars centered on each lane line and lane center (1/2 W), parallel to the lane
  // lines even when the crosswalk is skewed (note 2).
  // Width is measured inside
  // the transverse lines: at least 6' at intersections, 10' midblock (note 1).
  const CROSSWALK = { line: 12 * IN, bar: 24 * IN, width: 10, min: 6, max: 30 };
  // Manual parallel bars use sheet 9's 1/2 W spacing with a nominal 12 ft
  // lane when no lane geometry is available. This is an editor layout default.
  const CROSSWALK_PARALLEL_SPACING = 12 / 2;
  // MUTCD 11th Edition Figure 3B-20, Yield Ahead Triangle Symbols.
  const YIELD_AHEAD = {
    fast: { label: '45 mph or greater', width: 6, length: 20, bar: 36 * IN, side: 8 * IN },
    slow: { label: 'Less than 45 mph', width: 6, length: 13, bar: 30 * IN, side: 8 * IN },
  };
  // MUTCD 11th Edition Section 3B.20 paragraphs 06-07: at most three lines, spaced
  // 4 to 10 times the character height apart.
  const LINE_GAP = { min: 4 * LETTER, max: 10 * LETTER, lines: 3 };
  // FDOT Design Manual 230.3.1.3 (2026), black contrast for markings other than
  // longitudinal lines.
  // Crosswalk bars: 4" on both sides (FDM 230.3.1.3). The FDM names no treatment
  // for 12" transverse lines; they get the stop line's 4" on both sides.
  const CONTRAST = { border: 1.5 * IN, block: 1.5 * IN, stopLine: 4 * IN, bar: 4 * IN };

  // MUTCD 11th Edition, Revision 1 (December 2025), §§3B.26–3B.30,
  // Figures 3B-24–28 and §3H.03/Figure 3H-1. These treatments have no
  // corresponding detail in 711-001; lettering uses the existing SHS artwork.
  // https://mutcd.fhwa.dot.gov/pdfs/11th_Editionr1/mutcd11theditionr1hl.pdf
  const BLOCK = { outline: 12 * IN, hatch: 6 * IN, spacing: 10, length: 40, wordGap: 2 };
  // 12" is twice the normal 6" line (wide line, §3A.04); hatching is 4–6".
  // Box length, hatch spacing and compact word gaps are editable starting
  // geometry, not mandated dimensions. §3B.20 ¶07 exempts these word messages
  // from the usual four-character-height longitudinal gap.
  const TICKS = { width: 12 * IN, reach: 18 * IN, count: 12, length: 150 };
  // Figure 3B-25 gives maximum 12" × 18" ticks. Count and length are editor
  // defaults; §3B.28 requires progressively reduced spacing, not a fixed rate.
  const HUMP = { width: 6, length: 12, stripe: 12 * IN, gap: 12 * IN, wide: 9.5, tip: 10.4 * IN,
    advance: [0, 20, 38, 54, 68, 80, 90, 98], table: 10 };
  // MUTCD 11th ed. Rev. 1, Figs. 3B-26/27 (pp. 585–586): each 6 ft ×
  // 6 ft ramp pattern has an outer 12-inch chevron AND an inner triangle,
  // separated by a 12-inch clear band. C has two chevrons and a separately
  // dimensioned 10.4-inch terminal triangle within its 9.5 ft × 12 ft footprint.
  // https://mutcd.fhwa.dot.gov/pdfs/11th_Editionr1/mutcd11theditionr1hl.pdf#page=626
  // Figure 3B-28: centers 100,80,62,46,32,20,10,2 ft before the leading
  // edge, lengths 1…8 ft. Twelve-inch bars; the last bar leaves 1.5 ft clear.
  const VARIANTS = {
    doNotBlock: [['outline', 'A · Outline'], ['outlineWords', 'B · Outline and message'], ['crosshatch', 'C · Outline and crosshatch'], ['cross', 'C · Outline and X'], ['words', 'D · Message only']],
    speedHump: [['humpA', 'Hump · Option A'], ['humpB', 'Hump · Option B'], ['humpC', 'Hump · Option C'], ['tableA', 'Table · Option A'], ['tableB', 'Table · Option B'], ['advance', 'Advance warning bars']],
    crosswalkAesthetic: [['brick', 'Brick'], ['stone', 'Stone'], ['paver', 'Paver'], ['lattice', 'Lattice'], ['mesh', 'Mesh'], ['grid', 'Grid'], ['polygon', 'Polygon'], ['solid', 'Solid color'], ['image', 'Custom image']],
  };
  // Figure 3H-1 illustrates materials/patterns, not fabrication dimensions.
  // These colors depict its earth-tone examples; they are screen previews.
  const AESTHETIC = { gap: 6 * IN, colors: { brick: '#873f32', rust: '#995735', brown: '#735237', burgundy: '#713c46', clay: '#ae7254', tan: '#b8a583' } };

  const symbol = id => app.markingSymbols?.[id];
  const entry = (id, name, group, kind, extra = {}) => ({ id, name, group, kind, ...extra });
  const catalog = [
    entry('stopLine', 'Stop line', 'Lines', 'line', { note: '24 in solid white', source: '711-001 sheet 2' }),
    entry('yieldLine', 'Yield line', 'Lines', 'line', { note: "Five 18 × 27 in triangles per lane", source: '711-001 sheet 2' }),
    entry('school', 'School zone', 'Lines', 'line', { note: 'SCHOOL between 24 in lines', source: '711-001 sheet 12' }),
    entry('crosswalk', 'Crosswalk', 'Crosswalks', 'crosswalk', { note: 'Two 12 in transverse lines', source: '711-001 sheet 9' }),
    entry('doNotBlock', 'Do not block', 'Traffic calming and areas', 'area', { note: 'Outline, message, or crosshatch', source: 'MUTCD Figure 3B-24' }),
    entry('speedReduction', 'Speed reduction ticks', 'Traffic calming and areas', 'treatment', { note: 'Progressively closer 12 × 18 in white edge ticks', source: 'MUTCD Figure 3B-25' }),
    entry('speedHump', 'Speed hump / bump / table', 'Traffic calming and areas', 'treatment', { note: 'Hump, table and advance warning patterns', source: 'MUTCD Figures 3B-26–28' }),
    entry('through', 'Through arrow', 'Arrows', 'symbol', { art: 'through', repeat: ARROW_SPACING }),
    entry('turnLeft', 'Left turn arrow', 'Arrows', 'symbol', { art: 'turnLeft', repeat: ARROW_SPACING }),
    entry('turnRight', 'Right turn arrow', 'Arrows', 'symbol', { art: 'turnLeft', mirror: true, repeat: ARROW_SPACING }),
    entry('throughLeft', 'Left turn and through arrow', 'Arrows', 'symbol', { art: 'turnThroughLeft', repeat: ARROW_SPACING }),
    entry('throughRight', 'Right turn and through arrow', 'Arrows', 'symbol', { art: 'turnThroughLeft', mirror: true, repeat: ARROW_SPACING }),
    entry('leftRight', 'Left and right turn arrow', 'Arrows', 'symbol', { art: 'turnLeftRight', fit: true, repeat: ARROW_SPACING }),
    entry('throughLeftRight', 'Left, right and through arrow', 'Arrows', 'symbol', { art: 'turnThroughLeftRight', fit: true, repeat: ARROW_SPACING }),
    entry('uTurn', 'U-turn arrow', 'Arrows', 'symbol', { art: 'uTurn', repeat: ARROW_SPACING }),
    entry('twoWayLeft', 'Two-way left turn arrows', 'Arrows', 'symbol', { repeat: TWLTL_SPACING, source: '711-001 sheet 8' }),
    entry('mergeLeft', 'Merge arrow (lane ends, merge left)', 'Arrows', 'symbol', { art: 'merge', repeat: ARROW_SPACING }),
    entry('mergeRight', 'Merge arrow (lane ends, merge right)', 'Arrows', 'symbol', { art: 'merge', mirror: true, repeat: ARROW_SPACING }),
    entry('wrongWay', 'Wrong-way arrow', 'Arrows', 'symbol', { art: 'wrongWay', repeat: ARROW_SPACING }),
    entry('cfxOptionRight', 'Option lane arrow, exit right (CFX)', 'Arrows', 'symbol', { source: 'CFX SPM sheet 46', note: '105 ft, at the point of diverge' }),
    entry('cfxOptionLeft', 'Option lane arrow, exit left (CFX)', 'Arrows', 'symbol', { mirror: true, source: 'CFX SPM sheet 46', note: '105 ft, at the point of diverge' }),
    entry('preferential', 'Preferential lane diamond', 'Symbols', 'symbol', { art: 'preferential', repeat: ARROW_SPACING }),
    entry('pedestrian', 'Pedestrian warning', 'Symbols', 'symbol', { repeat: ARROW_SPACING, source: '711-001 sheet 1' }),
    entry('railroad', 'Railroad crossing (RXR)', 'Symbols', 'symbol', { art: 'railroad', repeat: ARROW_SPACING }),
    entry('yieldAhead', 'Yield ahead triangle', 'Symbols', 'symbol', { repeat: ARROW_SPACING, source: 'MUTCD Figure 3B-20' }),
    entry('cfxYield', 'Yield symbol (CFX, red and white)', 'Symbols', 'symbol', { repeat: ARROW_SPACING, source: 'CFX SPM sheet 48', note: 'Preformed, 6 × 13 ft' }),
    entry('shieldInterstate', 'Interstate route shield', 'Route shields', 'shield', { route: true, repeat: ARROW_SPACING }),
    entry('shieldUS', 'U.S. route shield', 'Route shields', 'shield', { route: true, repeat: ARROW_SPACING }),
    entry('shieldState', 'Florida State Road shield', 'Route shields', 'shield', { route: true, digits: 4, repeat: ARROW_SPACING }),
    entry('shieldToll', 'Florida toll route shield', 'Route shields', 'shield', { route: true, repeat: ARROW_SPACING }),
    entry('shieldTurnpike', 'Florida’s Turnpike shield', 'Route shields', 'shield', { repeat: ARROW_SPACING }),
    entry('cfxToll', 'CFX toll route shield', 'Route shields', 'shield', { route: true, repeat: ARROW_SPACING, source: 'CFX SPM sheet 47', note: 'Preformed, 8 × 20 ft' }),
    entry('word', 'Word marking', 'Words', 'word', { repeat: ARROW_SPACING }),
    entry('greenSolid', 'Green bike lane (solid)', 'Colored pavement', 'surface', { color: 'green', pattern: 'solid', source: 'FDM 223.5.3', note: 'Click the start and end along a lane' }),
    entry('greenDotted', 'Green bike lane, dotted (2 ft / 4 ft)', 'Colored pavement', 'surface', { color: 'green', pattern: 'dotted', source: 'FDM 223.5.3', note: 'Through a conflict area' }),
    entry('greenConflict', 'Green bike lane across a conflict', 'Colored pavement', 'surface', { color: 'green', pattern: 'conflict', source: 'FDM 223.5.3', note: 'Follows bike lane conflict striping, with solid approaches and unpainted weaving gaps' }),
    entry('redSolid', 'Red bus lane (solid)', 'Colored pavement', 'surface', { color: 'red', pattern: 'solid', source: 'MUTCD 3H.07', note: 'Transit-only lane, full width' }),
    entry('redBroken', 'Red bus lane, broken (2 ft / 4 ft)', 'Colored pavement', 'surface', { color: 'red', pattern: 'dotted', source: 'MUTCD 3H.07', note: 'Where general traffic may enter' }),
    entry('bikeLane', 'Bicyclist symbol and bike lane arrow', 'Bicycle', 'symbol', { source: '711-002 sheets 1–2', note: 'Symbol, 6 ft, then arrow' }),
    entry('bicyclist', 'Helmeted bicyclist symbol', 'Bicycle', 'symbol', { art: 'bicyclist', source: '711-002 sheet 1' }),
    entry('bikeArrow', 'Bike lane arrow', 'Bicycle', 'symbol', { art: 'bikeArrow', source: '711-002 sheet 1' }),
    entry('sharrow', 'Shared lane marking (sharrow)', 'Bicycle', 'symbol', { art: 'sharrow', source: '711-002 sheet 1', note: 'Centered in the travel lane (FDM 223.2.6)' }),
  ];
  // Arrows that can take the roundabout dot: the ones with a stem at their back.
  for (const item of catalog) if (['through', 'turnLeft', 'turnThroughLeft', 'uTurn', 'turnLeftRight', 'turnThroughLeftRight'].includes(item.art)) item.dot = true;
  const byId = new Map(catalog.map(item => [item.id, item]));
  // Saved roundabout approach arrows are left turn arrows with the dot.
  const find = type => byId.get(type === 'roundabout' ? 'turnLeft' : ['crosswalkAesthetic', 'crosswalkSpecial'].includes(type) ? 'crosswalk' : type) ?? null;

  // Keep older saved aesthetic crossings readable; new ones are ordinary
  // crosswalks with a surface treatment switched on.
  const isAesthetic = m => m.type === 'crosswalkAesthetic' || (find(m.type)?.kind === 'crosswalk' && Boolean(m.aesthetic));
  const variantsFor = m => isAesthetic(m) ? VARIANTS.crosswalkAesthetic : VARIANTS[m.type];
  const aestheticColor = m => m.tone === 'custom' && /^#[0-9a-f]{6}$/i.test(m.aestheticColor)
    ? m.aestheticColor : AESTHETIC.colors[m.tone] ?? AESTHETIC.colors.brick;

  // Ring helpers.
  const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  const move = (rings, dx, dy, flip = false) => rings.map(r => r.map(([x, y]) => [(flip ? -x : x) + dx, y + dy]));
  const turn = (rings, length) => rings.map(r => r.map(([x, y]) => [-x, length - y]));
  function bounds(parts) {
    const points = parts.flatMap(p => p.rings.flat());
    const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
    return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
  }
  function art(id, { flip = false, dx = 0, dy = 0, fill = WHITE } = {}) {
    const s = symbol(id);
    if (!s) return [];
    // Mirroring reverses ring winding; even-odd keeps holes either way.
    return s.shapes.map(shape => ({ fill: shape.fill ?? fill, rule: 'evenodd', rings: move(shape.rings, dx, dy, flip) }));
  }

  // Word messages: letters 8 ft tall; lines read in the direction of travel, the
  // first nearest the driver (MUTCD Section 3B.21 paragraph 02).
  function textLines(text) {
    return String(text ?? '').toUpperCase().split('\n').map(line => line.trim()).filter(Boolean);
  }
  function unsupported(text) {
    const font = app.markingFont ?? {};
    return [...new Set([...String(text ?? '').toUpperCase()].filter(c => c !== '\n' && !font[c]))];
  }
  function lettering(line, height, fill = WHITE) {
    const font = app.markingFont ?? {};
    const glyphs = [...line].map(c => font[c]).filter(Boolean);
    let cursor = 0;
    const placed = glyphs.map(g => { const x = cursor; cursor += g.advance; return { g, x }; });
    // Trim the last letter's right side bearing so the line centers on its ink.
    const last = placed.at(-1);
    const ink = last ? (last.g.rings.length ? Math.max(...last.g.rings.flat().map(p => p[0])) : last.g.advance) : 0;
    const width = last ? (last.x + ink) * height : 0;
    const parts = placed.filter(({ g }) => g.rings.length).map(({ g, x }) => ({
      fill, rule: 'nonzero', rings: g.rings.map(r => r.map(([gx, gy]) => [(x + gx) * height - width / 2, gy * height])),
    }));
    return { parts, width };
  }
  function words(text, gap) {
    const lines = textLines(text);
    const parts = [];
    lines.forEach((line, i) => {
      const y = i * (LETTER + gap);
      for (const part of lettering(line, LETTER).parts) parts.push({ ...part, rings: move(part.rings, 0, y), unit: y + LETTER / 2 });
    });
    return { parts, length: lines.length ? lines.length * LETTER + (lines.length - 1) * gap : 0 };
  }

  // Route shields at the 711-001 sheet 1 sizes with pavement lettering numerals.
  // Interstate and U.S.: MUTCD Figure 3B-18 outlines (the U.S. shield on its
  // black panel, C) with 10'-8" or 8'-0" numerals. FDOT's own markers (FDOT
  // 700-102): their faces stretched lengthwise (MUTCD Section 3B.22 paragraph
  // 03), with the route number filling the stretched legend area.
  function shield(marking) {
    const size = SHIELD[marking.size] ?? SHIELD.arterial;
    const item = find(marking.type);
    const route = item.route ? String(marking.route ?? '').replace(/\D/g, '').slice(0, item.digits ?? 3) : '';
    if (marking.type === 'shieldInterstate' || marking.type === 'shieldUS') {
      const s = symbol(marking.type === 'shieldUS' ? 'shieldUSLight' : 'shieldInterstate');
      if (!s) return { parts: [], length: size.length };
      const width = size.width * (route.length > 2 ? THREE_DIGIT_WIDTH : 1);
      const sx = width / s.width, sy = size.length / s.length;
      const parts = s.shapes.map(shape => ({ fill: shape.fill, rule: 'evenodd', rings: shape.rings.map(r => r.map(([x, y]) => [x * sx, y * sy])) }));
      const numerals = lettering(route, size.numerals, s.numerals.fill);
      const k = Math.min(1, (width * 0.9) / (numerals.width || 1));  // keep wide numbers inside the shield
      for (const part of numerals.parts) {
        parts.push({ ...part, rings: part.rings.map(r => r.map(([x, y]) => [s.numerals.x * sx + x * k, s.numerals.y * sy + y - size.numerals / 2])) });
      }
      return { parts, length: size.length };
    }
    const id = marking.type === 'shieldTurnpike' ? 'floridaTurnpike' : marking.type === 'shieldToll' ? 'floridaToll'
      : `floridaState${Math.min(4, Math.max(2, route.length))}`;
    const s = symbol(id);
    if (!s) return { parts: [], length: size.length };
    // A square face is the 711-001 width; other faces keep their proportions.
    const [bw, bh] = s.box, sy = size.length / bh, sx = size.width / bh;
    const parts = s.shapes.map(shape => ({ fill: shape.fill, rule: shape.rule, rings: shape.rings.map(r => r.map(([x, y]) => [x * sx, y * sy])) }));
    const field = s.numerals;
    if (field && route) {
      const height = field.height * sy, numerals = lettering(route, height, field.fill);
      const k = Math.min(1, (field.maxWidth * sx) / (numerals.width || 1));
      for (const part of numerals.parts) {
        parts.push({ ...part, rings: part.rings.map(r => r.map(([x, y]) => [field.x * sx + x * k, field.y * sy + y - height / 2])) });
      }
    }
    return { parts, length: size.length, width: bw * sx };
  }

  // CFX toll route shield marking (CFX SPM sheet 47): built from its dimensions;
  // the Florida outline and numeral position come from the CFX TM face
  // (assets/markings/cfx.js). The far end is the face's top.
  function cfxToll(marking) {
    const d = CFX_TOLL, h = d.width / 2, L = d.length;
    // The outside edge, inset by `i`: straight sides with rounded top corners,
    // and the half-ellipse tip (an inset ellipse, close to a true offset here).
    const outline = i => {
      const w = h - i, top = L - i, r = Math.max(0.01, d.corner - i), a = d.tip.a - i, b = d.tip.b - i, ring = [];
      for (let k = 0; k <= 32; k++) {           // tip, from the left side round to the right
        const t = Math.PI + (k / 32) * Math.PI;
        ring.push([a * Math.cos(t), d.tip.b + b * Math.sin(t)]);
      }
      for (const [cx, start] of [[w - r, 0], [-(w - r), Math.PI / 2]]) {
        for (let k = 0; k <= 8; k++) {
          const t = start + (k / 8) * (Math.PI / 2);
          ring.push([cx + r * Math.cos(t), top - r + r * Math.sin(t)]);
        }
      }
      return ring;
    };
    const fieldTop = L - d.edge - d.border - d.panel - d.bar, panelTop = L - d.edge - d.border;
    const fw = h - d.edge - d.border;
    const parts = [
      { fill: WHITE, rule: 'evenodd', rings: [outline(0)] },
      { fill: BLACK, rule: 'evenodd', rings: [outline(d.edge)] },
      { fill: WHITE, rule: 'evenodd', rings: [outline(d.edge + d.border)] },
      { fill: TOLL_YELLOW, rule: 'nonzero', rings: [rect(-fw, fieldTop + d.bar, fw, panelTop)] },
      { fill: BLACK, rule: 'nonzero', rings: [rect(-fw, fieldTop, fw, fieldTop + d.bar)] },
    ];
    const fit = (text, height, width, x, y) => {
      const t = lettering(text, height, BLACK), k = Math.min(1, width / (t.width || 1));
      for (const part of t.parts) parts.push({ ...part, rings: part.rings.map(r => r.map(([gx, gy]) => [x + gx * k, y + gy - height / 2])) });
    };
    fit('TOLL', d.toll.height, d.toll.width, 0, fieldTop + d.bar + d.panel / 2);
    const art = symbol('cfxFlorida');
    if (art) parts.push({ fill: 'none', stroke: d.florida, strokeColor: ORANGE, rule: 'nonzero', rings: art.rings });
    const route = String(marking.route ?? '').replace(/\D/g, '').slice(0, 3);
    if (route && art) fit(route, d.numerals.height, d.numerals.width, art.numerals.x, art.numerals.y);
    return { parts, length: L };
  }
  // CFX colored Yield (CFX SPM sheet 48): the R1-2 face stretched to 6' x 13',
  // pointing at approaching traffic.
  function cfxYield() {
    const art = symbol('cfxYield');
    if (!art) return { parts: [], length: 13 };
    return { parts: art.shapes.map(shape => ({ fill: shape.fill, rule: 'evenodd', rings: shape.rings })), length: art.length };
  }
  // CFX option lane directional arrow (CFX SPM sheet 46, asphalt): 15' of 8" line
  // to the point of diverge, then one branch straight on to the mainline head
  // and one angling off to the exit side's head, its tip 20' short.
  function cfxOption(item) {
    const d = CFX_OPTION, w = d.line / 2, side = item.mirror ? -1 : 1;
    const diverge = [0, d.tail], tip = [side * d.rampOffset, d.length - d.rampTip];
    const head = (from, to) => {
      const len = Math.hypot(to[0] - from[0], to[1] - from[1]), u = [(to[0] - from[0]) / len, (to[1] - from[1]) / len], n = [-u[1], u[0]];
      const back = [to[0] - u[0] * d.head.length, to[1] - u[1] * d.head.length];
      const at = (p, o) => [p[0] + n[0] * o, p[1] + n[1] * o];
      return [[at(from, -w), at(back, -w), at(back, w), at(from, w)],
        [at(back, -d.head.width / 2), to, at(back, d.head.width / 2)]];
    };
    const rings = [rect(-w, 0, w, d.tail), ...head(diverge, [0, d.length]), ...head(diverge, tip)];
    return { parts: rings.map(ring => ({ fill: WHITE, rule: 'nonzero', rings: [ring] })), length: d.length };
  }

  function yieldAhead(speed) {
    const d = YIELD_AHEAD[speed] ?? YIELD_AHEAD.fast;
    const h = d.width / 2, L = d.length;
    // The apex points back at approaching traffic; the bar is at the front.
    const outer = [[0, 0], [h, L], [-h, L]];
    // Inner hole: the two sides moved in by their 8" width, the base by the bar.
    const slope = h / L, along = Math.hypot(1, slope);
    const yTop = L - d.bar;
    const apex = d.side * along / slope;           // the sides' offset lines meet on the center
    const halfAt = y => (y - apex) * slope;
    const inner = [[0, apex], [halfAt(yTop), yTop], [-halfAt(yTop), yTop]];
    return { parts: [{ fill: WHITE, rule: 'evenodd', rings: [outer, inner] }], length: L };
  }

  function pedestrian() {
    const d = PEDESTRIAN, h = d.width / 2, L = d.length;
    const diamond = [[0, 0], [h, L / 2], [0, L], [-h, L / 2]];
    // The yellow field sits inside the 3" black border, measured square to each side.
    const slope = Math.hypot(h, L / 2);
    const inset = d.border * slope / h, side = d.border * slope / (L / 2);
    const field = [[0, inset], [h - side, L / 2], [0, L - inset], [-(h - side), L / 2]];
    const figure = symbol('pedestrian');
    const parts = [{ fill: BLACK, rule: 'evenodd', rings: [diamond] }, { fill: YELLOW, rule: 'evenodd', rings: [field] }];
    if (figure) parts.push(...figure.shapes.map(shape => ({ fill: BLACK, rule: 'evenodd', rings: move(shape.rings, 0, d.feet) })));
    return { parts, length: L };
  }

  function twoWayLeft() {
    const s = symbol('turnLeft');
    if (!s) return { parts: [], length: 0 };
    const near = art('turnLeft').map(part => ({ ...part, unit: s.length / 2 }));
    const far = s.shapes.map(shape => ({ fill: WHITE, rule: 'evenodd', rings: move(turn(shape.rings, s.length), 0, s.length + TWLTL_GAP), unit: s.length * 1.5 + TWLTL_GAP }));
    return { parts: [...near, ...far], length: 2 * s.length + TWLTL_GAP };
  }

  // Arrows and symbols from the drawings. The roundabout dot (711-001 sheet 1,
  // Roundabout Approach Arrow) sits where that drawing puts it from the stem, on
  // the left (the central island's side) even for right turns. Composed arrows
  // wider than their lane scale down to fit it (MUTCD Section 3B.20 paragraph 09).
  function arrow(item, marking, lanes) {
    const s = symbol(item.art);
    if (!s) return { parts: [], length: 0 };
    let parts = art(item.art, { flip: item.mirror });
    if (item.dot && (marking.dot || marking.type === 'roundabout') && symbol('roundaboutDot')) {
      const stem = item.mirror ? -s.stem : s.stem;
      parts.push(...art('roundaboutDot', { dx: stem }));
    }
    const lane = lanes?.[0] ? lanes[0].right - lanes[0].left : 12;
    const b = bounds(parts), width = b.x1 - b.x0, room = lane - 1;  // clear of the 6" lines
    const k = item.fit && width > room ? room / width : 1;
    if (k !== 1 || b.y0 < 0) parts = parts.map(p => ({ ...p, rings: p.rings.map(r => r.map(([x, y]) => [x * k, (y - b.y0) * k])) }));
    return { parts, length: (b.y1 - b.y0) * k };
  }

  // A crosswalk between road edge points a and b (feet, sheet axes), with bars
  // at the given points on its centerline, each running along its lane's
  // direction of travel t. An end with the pavement edge's direction (a.t, b.t)
  // is cut along that edge, so a skewed crosswalk stops at the curb. Black
  // contrast parts come first.
  // Clip vector polygons to a convex quadrilateral (also used for skewed
  // crosswalk ends). No SVG patterns or raster textures: PDF stays vector.
  function clipPolygon(points, boundary) {
    const area = boundary.reduce((sum, p, i) => { const q = boundary[(i + 1) % boundary.length]; return sum + p[0] * q[1] - q[0] * p[1]; }, 0);
    const sign = Math.sign(area) || 1;
    for (let i = 0; i < boundary.length && points.length; i++) {
      const a = boundary[i], b = boundary[(i + 1) % boundary.length];
      const cross = p => sign * ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]));
      const next = [];
      for (let j = 0; j < points.length; j++) {
        const p = points[j], q = points[(j + 1) % points.length], u = cross(p), v = cross(q);
        if (u >= -1e-9) next.push(p);
        if ((u < 0) !== (v < 0)) { const f = u / (u - v); next.push([p[0] + f * (q[0] - p[0]), p[1] + f * (q[1] - p[1])]); }
      }
      points = next;
    }
    return points;
  }
  function strokePolygon(a, b, width) {
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, x = (b[1] - a[1]) * width / (2 * d), y = (a[0] - b[0]) * width / (2 * d);
    return [[a[0] + x, a[1] + y], [b[0] + x, b[1] + y], [b[0] - x, b[1] - y], [a[0] - x, a[1] - y]];
  }
  function aesthetic(marking, boundary) {
    const fill = aestheticColor(marking);
    if(marking.variant==='image')return [{fill:'none',rule:'nonzero',rings:[boundary],image:marking.aestheticImage??null,imageFit:marking.imageFit??'cover'}];
    const parts = [{ fill, rule: 'nonzero', rings: [boundary] }], style = marking.variant ?? 'brick';
    if (style === 'solid') return parts;
    const b = bounds(parts), rings = [], add = p => { const r = clipPolygon(p, boundary); if (r.length >= 3) rings.push(r); };
    const line = (a, b) => add(strokePolygon(a, b, 0.06));
    if (style === 'polygon') {
      const h = Math.sqrt(3);
      for (let col = Math.floor(b.x0 / 1.5) - 1; col <= Math.ceil(b.x1 / 1.5) + 1; col++)
        for (let row = Math.floor(b.y0 / h) - 1; row <= Math.ceil(b.y1 / h) + 1; row++) {
          const cx = col * 1.5, cy = (row + (Math.abs(col % 2) ? 0.5 : 0)) * h;
          const p = Array.from({length: 6}, (_, i) => [cx + Math.cos(i * Math.PI / 3), cy + Math.sin(i * Math.PI / 3)]);
          for (let i = 0; i < 6; i++) line(p[i], p[(i + 1) % 6]);
        }
    } else if (style === 'stone') {
      const vertex = (x, y) => [x + 0.35 * Math.sin(x * 3 + y * 7), y + 0.3 * Math.cos(x * 7 - y * 2)];
      for (let y = Math.floor(b.y0 / 2) * 2 - 2; y <= b.y1 + 2; y += 2)
        for (let x = Math.floor(b.x0 / 2) * 2 - 2; x <= b.x1 + 2; x += 2) {
          line(vertex(x, y), vertex(x + 2, y)); line(vertex(x, y), vertex(x, y + 2));
        }
    } else if (['paver', 'mesh'].includes(style)) {
      for (let y = Math.floor(b.y0 / 2) * 2; y <= b.y1 + 2; y += 2)
        for (let x = Math.floor(b.x0 / 2) * 2; x <= b.x1 + 2; x += 2) {
          line([x, y], [x + 2, y]); line([x, y], [x, y + 2]);
          for (const offset of style === 'mesh' ? [0.65, 1.35] : [1]) {
            if ((Math.round((x + y) / 2) % 2) === 0) line([x + offset, y], [x + offset, y + 2]);
            else line([x, y + offset], [x + 2, y + offset]);
          }
        }
    } else for (let y = Math.floor(b.y0); y <= b.y1 + 1; y++) {
      if (style !== 'lattice') {
        line([b.x0, y], [b.x1, y]);
        for (let x = Math.floor(b.x0 / 2) * 2 - 2; x <= b.x1 + 2; x += style === 'grid' ? 1 : 2) {
          const offset = style === 'brick' ? Math.round(y) % 2 : 0;
          line([x + offset, y], [x + offset, y + 1]);
        }
      }
    }
    if (style === 'lattice') {
      const h = b.y1 - b.y0;
      for (let x = b.x0 - h; x <= b.x1 + h; x += 1.5) for (const direction of [-1, 1]) line([x, b.y0], [x + direction * h, b.y1]);
    }
    parts.push({ fill: '#483b32', rule: 'nonzero', rings });
    return parts;
  }

  function crosswalk(marking, a, b, bars = []) {
    const width = Math.max(CROSSWALK.min, Math.min(CROSSWALK.max, marking.width ?? CROSSWALK.width));
    const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const u = { x: (b.x - a.x) / length, y: (b.y - a.y) / length }, n = { x: -u.y, y: u.x };
    const at = (s, o) => [a.x + u.x * s + n.x * o, a.y + u.y * s + n.y * o];
    // Where the line `o` feet off the centerline meets an end's pavement edge.
    const cut = (end, o, base) => {
      const t = end.t, across = t && u.x * t.y - u.y * t.x;
      return !t || Math.abs(across) < 0.2 ? base : base - o * (n.x * t.y - n.y * t.x) / across;
    };
    const band = (o0, o1) => [at(cut(a, o0, 0), o0), at(cut(b, o0, length), o0), at(cut(b, o1, length), o1), at(cut(a, o1, 0), o1)];
    const half = width / 2, contrast = Boolean(marking.contrast), black = [], white = [], surface = [];
    if (isAesthetic(marking)) {
      const inner = half;
      const boundary = [[cut(a, -inner, 0), -inner], [cut(b, -inner, length), -inner], [cut(b, inner, length), inner], [cut(a, inner, 0), inner]];
      surface.push(...aesthetic(marking, boundary).map(part => ({ ...part, imageAngle:Math.atan2(u.y,u.x), rings: part.rings.map(r => r.map(([s, o]) => at(s, o))) })));
    }
    for (const side of [1, -1]) {
      const [o0, o1] = [side * half, side * (half + CROSSWALK.line)];
      white.push({ fill: WHITE, rule: 'nonzero', rings: [band(o0, o1)] });
      if (contrast) black.push({ fill: BLACK, rule: 'nonzero', contrast: true, rings: [band(o0 - side * CONTRAST.stopLine, o1 + side * CONTRAST.stopLine)] });
    }
    if (marking.enhanced || marking.type === 'crosswalkSpecial') {
      const forced = marking.forceBars ?? (marking.barDirection === 'perpendicular');
      if (forced) {
        // Rotate full vector stripes, then clip them to the crossing. This
        // stays finite and visible even at ±90° (parallel to the crossing).
        const angle = (Number.isFinite(marking.barAngle) ? Math.max(-90,Math.min(90,marking.barAngle)) : 0) * Math.PI / 180;
        const t = {x:n.x*Math.cos(angle)-n.y*Math.sin(angle),y:n.x*Math.sin(angle)+n.y*Math.cos(angle)};
        const p = {x:-t.y,y:t.x}, center = {x:(a.x+b.x)/2,y:(a.y+b.y)/2}, boundary = band(-half,half);
        const project = axis => boundary.map(([x,y])=>(x-center.x)*axis.x+(y-center.y)*axis.y);
        const across = project(p), along = project(t), lo = Math.min(...along), hi = Math.max(...along);
        const first = Math.ceil((Math.min(...across)-CROSSWALK.bar/2+1e-9)/CROSSWALK_PARALLEL_SPACING);
        const last = Math.floor((Math.max(...across)+CROSSWALK.bar/2-1e-9)/CROSSWALK_PARALLEL_SPACING);
        const point = (s,d) => [center.x+p.x*s+t.x*d,center.y+p.y*s+t.y*d];
        for(let i=first;i<=last;i++) {
          const s=i*CROSSWALK_PARALLEL_SPACING;
          const ring = halfWidth => clipPolygon([point(s-halfWidth,lo),point(s-halfWidth,hi),point(s+halfWidth,hi),point(s+halfWidth,lo)],boundary);
          const outline = ring(CROSSWALK.bar/2);
          if(outline.length<3)continue;
          white.push({fill:WHITE,rule:'nonzero',rings:[outline]});
          if(contrast)black.push({fill:BLACK,rule:'nonzero',contrast:true,rings:[ring(CROSSWALK.bar/2+CONTRAST.bar)]});
        }
      } else for (const bar of bars) {
        const t = bar.t, along = t.x * n.x + t.y * n.y;
        if (Math.abs(along) < 0.2) continue;  // nearly parallel to the crosswalk
        const p = { x: -t.y, y: t.x };
        // A bar's ends lie on the transverse lines' inner edges.
        const corners = e => [half, -half].map(o => {
          const q = { x: bar.x + p.x * e, y: bar.y + p.y * e };
          const l = (o - ((q.x - a.x) * n.x + (q.y - a.y) * n.y)) / along;
          return [q.x + t.x * l, q.y + t.y * l];
        });
        const ring = e => {
          const [p0, p1] = corners(-e), [q0, q1] = corners(e), points = [p0, p1, q1, q0];
          return points;
        };
        const barWidth=bar.width??CROSSWALK.bar;
        const outline = ring(barWidth / 2);
        if (outline.length < 3) continue;
        white.push({ fill: WHITE, rule: 'nonzero', rings: [outline] });
        if (contrast) black.push({ fill: BLACK, rule: 'nonzero', contrast: true, rings: [ring(barWidth / 2 + CONTRAST.bar)] });
      }
    }
    return { parts: [...surface, ...black, ...white], length: width + 2 * CROSSWALK.line };
  }

  function doNotBlock(marking, lanes) {
    const left = Math.min(...lanes.map(l => l.left)), right = Math.max(...lanes.map(l => l.right));
    const variant = marking.variant ?? 'outline', hasWords = ['outlineWords', 'words'].includes(variant);
    const message = words(marking.message === 'keepClear' ? 'KEEP\nCLEAR' : 'DO\nNOT\nBLOCK', BLOCK.wordGap);
    const length = Math.max(4, Math.min(1000, Number(marking.extent) || BLOCK.length)), parts = [];
    const add = rings => parts.push({ fill: WHITE, rule: 'evenodd', rings });
    const w = BLOCK.outline, box = rect(left + w, w, right - w, length - w);
    if (variant !== 'words') add([rect(left, 0, right, length), box]);
    if (['crosshatch', 'cross'].includes(variant)) {
      const rings = [], line = (a, b) => { const p = clipPolygon(strokePolygon(a, b, BLOCK.hatch), box); if (p.length > 2) rings.push(p); };
      if (variant === 'cross') { line([left, 0], [right, length]); line([right, 0], [left, length]); }
      else for (let y = -(right - left); y < length + right - left; y += BLOCK.spacing) for (const sign of [-1, 1]) line([left, y], [right, y + sign * (right - left)]);
      for (const ring of rings) add([ring]);
    }
    if (hasWords) for (const lane of lanes) {
      const b = bounds(message.parts), scale = Math.min(1, (lane.right - lane.left - 2) / (b.x1 - b.x0)), cx = (lane.left + lane.right) / 2;
      // Fit the complete message to the editable box interior. This is an
      // editor sizing behavior, not a prescribed MUTCD word-height dimension.
      const inset = variant === 'words' ? 0 : w, along = (length - 2 * inset) / (b.y1 - b.y0);
      for (const p of message.parts) parts.push({ ...p, unit: undefined, rings: p.rings.map(r => r.map(([x, y]) => [cx + x * scale, inset + (y - b.y0) * along])) });
    }
    return { parts, length };
  }
  function speedReduction(marking, lanes) {
    const count = Math.max(2, Math.min(100, Math.round(Number(marking.count) || TICKS.count))), length = Math.max(count * 2, Math.min(2000, Number(marking.extent) || TICKS.length));
    const weights = Array.from({ length: count - 1 }, (_, i) => 1 - 0.75 * i / Math.max(1, count - 2)), sum = weights.reduce((a, b) => a + b, 0);
    const parts = []; let y = 0;
    for (let i = 0; i < count; i++) {
      for (const l of lanes) parts.push({ fill: WHITE, rule: 'nonzero', unit: y + TICKS.width / 2,
        rings: [rect(l.left, y, l.left + TICKS.reach, y + TICKS.width), rect(l.right - TICKS.reach, y, l.right, y + TICKS.width)] });
      y += (weights[i] ?? 0) / sum * (length - TICKS.width);
    }
    return { parts, length };
  }
  function speedHump(marking) {
    const variant = marking.variant ?? 'humpA', parts = [];
    // Keep older saved records readable; these duplicates are no longer offered
    // in the speed-hump menu. New messages/crosswalks use their existing tools.
    if (['bump', 'hump'].includes(variant)) return words(variant.toUpperCase(), 0);
    if (variant === 'advance') return { parts: HUMP.advance.map((y, i) => ({ fill: WHITE, rule: 'nonzero', unit: y + 0.5, rings: [rect(-(i + 1) / 2, y, (i + 1) / 2, y + 1)] })), length: 100.5 };
    const table = variant.startsWith('table') || variant.startsWith('crosswalk'), crossed = variant.startsWith('crosswalk');
    const middle = Math.max(CROSSWALK.min, Math.min(CROSSWALK.max, Number(marking.tableWidth) || HUMP.table));
    const length = table ? 12 + middle + (crossed ? 2 * CROSSWALK.line : 0) : HUMP.length;
    const add = (ring, unit) => parts.push({ fill: WHITE, rule: 'nonzero', rings: [ring], ...(unit == null ? {} : { unit }) });
    const chevron = (width, height, y) => {
      const m = 2 * height / width, inset = HUMP.stripe * Math.hypot(1, m), x = width / 2;
      return [[-x, y], [0, y + height], [x, y], [x - inset / m, y], [0, y + height - inset], [-x + inset / m, y]];
    };
    if (variant === 'humpC') {
      const width = HUMP.wide, height = HUMP.length, slope = 2 * height / width;
      const pitch = (HUMP.stripe + HUMP.gap) * Math.hypot(1, slope);
      for (const y of [0, -pitch]) add(clipPolygon(chevron(width, height, y), rect(-width / 2, 0, width / 2, height)));
      add([[-HUMP.tip / 2, 0], [0, HUMP.tip / 2 * slope], [HUMP.tip / 2, 0]]);
    } else {
      const ramp = y => {
        const height = 6, slope = 2 * height / HUMP.width;
        const innerTip = height - (HUMP.stripe + HUMP.gap) * Math.hypot(1, slope);
        add(chevron(HUMP.width, height, y), y + height / 2);
        add([[-innerTip / slope, y], [0, y + innerTip], [innerTip / slope, y]], y + height / 2);
      };
      ramp(0);
      if (variant.endsWith('B')) ramp(length - 6);
    }
    if (crossed) {
      add(rect(-6, 6, 6, 6 + CROSSWALK.line));
      add(rect(-6, 6 + CROSSWALK.line + middle, 6, length - 6));
    }
    return { parts, length };
  }

  // A marking's paint, before contrast: { parts, length } in local feet. Lines need
  // the lanes they cross: [{ left, right }] in feet right of the lane's center.
  function geometry(marking, lanes = [{ left: -6, right: 6 }]) {
    const item = find(marking.type);
    if (!item) return { parts: [], length: 0 };
    const left = Math.min(...lanes.map(l => l.left)), right = Math.max(...lanes.map(l => l.right));
    if (item.kind === 'word') return words(marking.text, marking.gap ?? LINE_GAP.min);
    if (item.kind === 'crosswalk') {
      // A sample across the lanes, for previews: x across, y along the lane.
      const centers = lanes.flatMap(l => [(l.left + l.right) / 2]).concat(lanes.slice(1).map(l => l.left));
      const half = (marking.width ?? CROSSWALK.width) / 2 + CROSSWALK.line;
      const g = crosswalk(marking, { x: left, y: half }, { x: right, y: half }, centers.map(x => ({ x, y: half, t: { x: 0, y: 1 } })));
      return { ...g, parts: g.parts.map(p => ({ ...p, unit: half })) };
    }
    switch (item.id) {
      case 'doNotBlock': return doNotBlock(marking, lanes);
      case 'speedReduction': return speedReduction(marking, lanes);
      case 'speedHump': {
        const g = speedHump(marking);
        if ((marking.variant ?? '').startsWith('crosswalk')) for (const part of g.parts.slice(-2)) {
          const b = bounds([part]); part.rings = [rect(left, b.y0, right, b.y1)];
        }
        return g;
      }
      case 'stopLine':
        return { parts: [{ fill: WHITE, rule: 'nonzero', rings: [rect(left, 0, right, STOP_LINE)] }], length: STOP_LINE };
      case 'yieldLine': {
        const parts = [];
        for (const lane of lanes) {
          // A bike lane gets one triangle, centered (711-001 sheet 2, Yield Lines).
          const count = lane.bike ? 1 : YIELD.count;
          const w = lane.right - lane.left, gap = (w - count * YIELD.base) / (count + 1);
          for (let i = 0; i < count; i++) {
            const cx = lane.left + gap * (i + 1) + YIELD.base * (i + 0.5);
            // Each triangle's point faces approaching traffic.
            parts.push({ fill: WHITE, rule: 'nonzero', rings: [[[cx, 0], [cx + YIELD.base / 2, YIELD.height], [cx - YIELD.base / 2, YIELD.height]]] });
          }
        }
        return { parts, length: YIELD.height };
      }
      case 'school': {
        const word = lettering('SCHOOL', LETTER);
        const top = STOP_LINE + SCHOOL_CLEAR * 2 + LETTER;
        const parts = [{ fill: WHITE, rule: 'nonzero', rings: [rect(left, 0, right, STOP_LINE)], unit: STOP_LINE / 2 },
          { fill: WHITE, rule: 'nonzero', rings: [rect(left, top, right, top + STOP_LINE)], unit: top + STOP_LINE / 2 }];
        for (const lane of lanes) {
          const cx = (lane.left + lane.right) / 2;
          for (const part of word.parts) parts.push({ ...part, rings: move(part.rings, cx, STOP_LINE + SCHOOL_CLEAR), unit: STOP_LINE + SCHOOL_CLEAR + LETTER / 2 });
        }
        return { parts, length: top + STOP_LINE };
      }
      case 'twoWayLeft': return twoWayLeft();
      case 'yieldAhead': return yieldAhead(marking.speed);
      case 'pedestrian': return pedestrian();
      case 'shieldInterstate': case 'shieldUS': case 'shieldState': case 'shieldToll': case 'shieldTurnpike': return shield(marking);
      case 'cfxToll': return cfxToll(marking);
      case 'greenSolid': case 'greenDotted': case 'greenConflict': case 'redSolid': case 'redBroken': {
        // A sample stretch for the picker; on the sheet it covers the lane.
        const L = 20, rings = [];
        for (const [a, b] of stretches(item.pattern, L)) rings.push(rect(-3, a, 3, b));
        return { parts: rings.map(ring => ({ fill: SURFACE[item.color], rule: 'nonzero', rings: [ring] })), length: L };
      }
      case 'bicyclist': case 'bikeArrow': case 'sharrow': return { parts: art(item.art), length: symbol(item.art)?.length ?? 6 };
      case 'bikeLane': {
        // 711-002 sheet 2: the bicyclist symbol, 6', then the bike lane arrow ahead of it.
        const rider = symbol('bicyclist')?.length ?? 6, arrowLength = symbol('bikeArrow')?.length ?? 6;
        const parts = [...art('bicyclist').map(p => ({ ...p, unit: rider / 2 })),
          ...art('bikeArrow', { dy: rider + BIKE_GAP }).map(p => ({ ...p, unit: rider + BIKE_GAP + arrowLength / 2 }))];
        return { parts, length: rider + BIKE_GAP + arrowLength };
      }
      case 'cfxYield': return cfxYield();
      case 'cfxOptionRight': case 'cfxOptionLeft': return cfxOption(item);
      default: return arrow(item, marking, lanes);
    }
  }

  // Black contrast (FDOT Design Manual 230.3.1.3) under the paint: a border along
  // each outline (45 mph or less) or a block around the marking (over 45 mph);
  // 4" borders on both sides of a stop line; a block around each yield triangle.
  function contrast(marking, painted) {
    if (!marking.contrast || !painted.parts.length) return [];
    const item = find(marking.type);
    const block = (rings, unit) => {
      const b = bounds([{ rings }]);
      return { fill: BLACK, rule: 'nonzero', contrast: true, unit, rings: [rect(b.x0 - CONTRAST.block, b.y0 - CONTRAST.block, b.x1 + CONTRAST.block, b.y1 + CONTRAST.block)] };
    };
    const bar = p => {
      const b = bounds([p]);
      return { fill: BLACK, rule: 'nonzero', contrast: true, unit: p.unit, rings: [rect(b.x0, b.y0 - CONTRAST.stopLine, b.x1, b.y1 + CONTRAST.stopLine)] };
    };
    // A border is the outline stroked twice its width under the paint.
    const outline = parts => parts.map(p => ({ ...p, fill: BLACK, contrast: true, stroke: CONTRAST.border * 2 }));
    // A block per unit (each line of a message, each arrow of a pair).
    const message = parts => {
      if (marking.contrast !== 'block') return outline(parts);
      const units = new Map();
      for (const p of parts) units.set(p.unit, [...(units.get(p.unit) ?? []), ...p.rings]);
      return [...units].map(([unit, rings]) => block(rings, unit));
    };
    if (item.id === 'stopLine') return painted.parts.map(bar);
    if (item.id === 'school') return [bar(painted.parts[0]), bar(painted.parts[1]), ...message(painted.parts.slice(2))];
    if (item.id === 'yieldLine') return painted.parts.map(p => block(p.rings, p.unit));
    return message(painted.parts);
  }

  // Everything drawn for one marking (contrast first, then paint), plus its length.
  function build(marking, lanes) {
    const painted = geometry(marking, lanes);
    if (find(marking.type)?.kind === 'crosswalk') return painted;  // contrast included
    return { parts: [...contrast(marking, painted), ...painted.parts], length: painted.length };
  }

  // A colored pavement pattern over `length` ft: the [start, end] stretches painted.
  function stretches(pattern, length, phase = 0) {
    const dotted = (a, b) => {
      const out = [];
      for (let s = Math.floor((a + phase) / (SURFACE.dot + SURFACE.gap)) * (SURFACE.dot + SURFACE.gap) - phase; s < b; s += SURFACE.dot + SURFACE.gap) {
        const lo = Math.max(a, s), hi = Math.min(b, s + SURFACE.dot);
        if (hi > lo) out.push([lo, hi]);
      }
      return out;
    };
    if (pattern === 'dotted') return dotted(0, length);
    if (pattern === 'conflict' && length > 2 * SURFACE.lead + SURFACE.dot) {
      return [[0, SURFACE.lead], ...dotted(SURFACE.lead + SURFACE.gap, length - SURFACE.lead - SURFACE.gap), [length - SURFACE.lead, length]];
    }
    return [[0, length]];
  }

  // Repeats run upstream from the first marking: offsets (ft, back from it) of each copy.
  function repeats(marking) {
    const r = marking.repeat;
    if (!r?.length || !(r.spacing > 0)) return [0];
    const out = [];
    for (let s = 0; s <= r.length + 1e-6 && out.length < 500; s += r.spacing) out.push(s);
    return out;
  }

  const api = {
    catalog, find, geometry, build, repeats, bounds, textLines, unsupported, lettering, crosswalk, isAesthetic, variantsFor, aestheticColor, VARIANTS, BLOCK, TICKS, HUMP, AESTHETIC,
    SHIELD, CFX_TOLL, CFX_OPTION, SURFACE, stretches, CROSSWALK, YIELD_AHEAD, LINE_GAP, CONTRAST, MESSAGE_BACK, ARROW_SPACING, TWLTL_SPACING, STOP_LINE, LETTER,
  };
  app.markingCatalog = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
