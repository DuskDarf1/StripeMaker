#!/usr/bin/env python3
"""Import lateral pavement marking outlines. Run with fonttools and shapely installed:
python scripts/import-markings.py PATH_TO_711-001.pdf PATH_TO_MUTCD_11th_part3.pdf PATH_TO_FHWA-Pavement-Derived.ttf
Needs poppler's pdftocairo on PATH. Writes assets/markings/symbols.js and
assets/markings/font.js; no runtime dependencies. See assets/markings/SOURCES.md.
"""
import json, pathlib, re, subprocess, sys, tempfile
from fontTools.ttLib import TTFont
from fontTools.pens.recordingPen import RecordingPen
from shapely.geometry import MultiPoint, Point, Polygon
from shapely.ops import unary_union
ROOT = pathlib.Path(__file__).resolve().parents[1]
CURVE_STEPS = 12  # line segments per Bézier, about 0.1" on a 3 ft arrow radius

def flatten_svg(d):
    """Absolute M/L/C/Z path data (pdftocairo output) to closed polylines."""
    tokens = re.findall(r'[MLCZ]|-?\d*\.?\d+(?:e[-+]?\d+)?', d)
    rings, ring, i, at = [], [], 0, None
    while i < len(tokens):
        t = tokens[i]; i += 1
        if t == 'M':
            if len(ring) > 2: rings.append(ring)
            at = (float(tokens[i]), float(tokens[i + 1])); i += 2; ring = [at]
        elif t == 'L':
            at = (float(tokens[i]), float(tokens[i + 1])); i += 2; ring.append(at)
        elif t == 'C':
            c = [float(v) for v in tokens[i:i + 6]]; i += 6
            p0, p1, p2, p3 = at, (c[0], c[1]), (c[2], c[3]), (c[4], c[5])
            for k in range(1, CURVE_STEPS + 1):
                s = k / CURVE_STEPS; u = 1 - s
                ring.append(tuple(u*u*u*a + 3*u*u*s*b + 3*u*s*s*e + s*s*s*f for a, b, e, f in zip(p0, p1, p2, p3)))
            at = p3
        elif t == 'Z':
            if len(ring) > 2: rings.append(ring)
            ring = [at] if at else []
    if len(ring) > 2: rings.append(ring)
    # Drop repeated closing points.
    return [r[:-1] if r[0] == r[-1] else r for r in rings]

def color(attrs):
    m = re.search(r'fill="rgb\(([\d.]+)%, ([\d.]+)%, ([\d.]+)%\)"', attrs)
    return m and '#' + ''.join(f'{round(float(v) * 2.55):02x}' for v in m.groups())

def fills(pdf, page, black=True):
    with tempfile.TemporaryDirectory() as folder:
        out = pathlib.Path(folder) / 'page.svg'
        subprocess.run(['pdftocairo', '-svg', '-f', str(page), '-l', str(page), str(pdf), str(out)], check=True)
        source = out.read_text()
    found, grid = [], []
    for m in re.finditer(r'<path ([^>]*?)/>', source):
        attrs = m.group(1)
        if black and 'fill="rgb(0%, 0%, 0%)"' not in attrs: continue
        if not color(attrs) or ' d="' not in attrs: continue
        rings = flatten_svg(re.search(r' d="([^"]*)"', attrs).group(1))
        xs = [p[0] for r in rings for p in r]; ys = [p[1] for r in rings for p in r]
        if not xs: continue
        found.append({'rings': rings, 'box': (min(xs), min(ys), max(xs), max(ys)),
                      'evenodd': 'evenodd' in attrs, 'fill': color(attrs)})
    # The details' gray 4" x 4" grids: vertical lines placed by their transforms.
    for m in re.finditer(r'<path ([^>]*?stroke="rgb\(58\.79[^>]*?)/>', source):
        t = re.search(r'transform="matrix\(1, 0, 0, -1, ([-\d.]+), ([-\d.]+)\)"', m.group(1))
        d = re.search(r' d="M (-?[\d.]+) (-?[\d.]+) L (-?[\d.]+) (-?[\d.]+)', m.group(1))
        if t and d and abs(float(d[1]) - float(d[3])) < 0.01:
            tx, ty = float(t[1]), float(t[2])
            grid.append((tx + float(d[1]), ty - max(float(d[2]), float(d[4])), ty - min(float(d[2]), float(d[4]))))
    return {'shapes': found, 'grid': grid}

def feet_per_point(page, box):
    """Scale from a detail's 4" grid ("All grids are 4" x 4"", 711-001 sheet 1 note 3)."""
    x0, y0, x1, y1 = box
    xs = sorted({round(x, 3) for x, top, bottom in page['grid'] if x0 - 20 <= x <= x1 + 20 and top < y1 and bottom > y0})
    pitches = sorted(b - a for a, b in zip(xs, xs[1:]) if 0.5 < b - a < 10)
    return (4 / 12) / pitches[len(pitches) // 2]

def pick(page, box):
    """Shapes whose bounds fall inside a page region (points)."""
    x0, y0, x1, y1 = box
    return [s for s in page['shapes'] if s['box'][0] >= x0 and s['box'][1] >= y0 and s['box'][2] <= x1 and s['box'][3] <= y1
            and max(s['box'][2] - s['box'][0], s['box'][3] - s['box'][1]) > 4]

def extent(shapes):
    xs = [p[0] for s in shapes for r in s['rings'] for p in r]; ys = [p[1] for s in shapes for r in s['rings'] for p in r]
    return min(xs), min(ys), max(xs), max(ys)

def symbol(shapes, feet_per_point, source, center=None, solid=False):
    """Feet, x right of travel centered on the symbol, y forward from its back."""
    # Dimension text and arrowheads are under 0.8 ft; the smallest marking part
    # (the roundabout arrow's 1'-3" by 1'-6" dot) is larger.
    shapes = [s for s in shapes if max(s['box'][2] - s['box'][0], s['box'][3] - s['box'][1]) * feet_per_point > 0.9]
    x0, y0, x1, y1 = extent(shapes)
    cx = (x0 + x1) / 2 if center is None else center
    convert = lambda p: ((p[0] - cx) * feet_per_point, (y1 - p[1]) * feet_per_point)
    pieces = []
    for s in shapes:
        rings = [Polygon([convert(p) for p in r]).buffer(0) for r in s['rings']]
        if s['evenodd'] and len(rings) > 1:
            outer = max(rings, key=lambda g: g.area)
            pieces.append(outer.difference(unary_union([g for g in rings if g is not outer])))
        else:
            pieces.extend(rings)
    # Arrows are painted solid. The drawings break a curved arrow's stem from its
    # head with a 5-6" stencil gap; bridge it with the quadrilateral between the
    # facing corners so the outline stays exactly as drawn.
    if solid:
        bridges = []
        for i, a in enumerate(pieces):
            for b in pieces[i + 1:]:
                gap = a.distance(b)
                if not 0 < gap < 8 / 12: continue
                # The slit's four corners: each piece's two vertices nearest the other.
                near = [q for g, other in ((a, b), (b, a))
                        for q in sorted(set(g.exterior.coords), key=lambda q: Point(q).distance(other))[:2]]
                bridges.append(MultiPoint(near).convex_hull)
        pieces += bridges
    polygons = list(getattr(unary_union(pieces), 'geoms', [unary_union(pieces)]))
    ring = lambda r: [[round(x, 4), round(y, 4)] for x, y in list(r.coords)[:-1]]
    return {'source': source, 'width': round((x1 - x0) * feet_per_point, 3), 'length': round((y1 - y0) * feet_per_point, 3),
            'shapes': [{'rule': 'evenodd', 'rings': [ring(g.exterior)] + [ring(h) for h in g.interiors]}
                       for g in polygons if g.area > 0.05]}

def shield(page, box, source):
    """A Figure 3B-18 shield in feet (15 ft long, MUTCD 2009 Figure 3B-25), without
    its sample numerals or the figure's gray pavement, and where its numerals go."""
    gray = lambda c: all(0x60 <= int(c[i:i + 2], 16) <= 0xf0 for i in (1, 3, 5))
    shapes = [s for s in pick(page, box) if not gray(s['fill'])]
    digits = [s for s in shapes if s['box'][2] - s['box'][0] < 14 and 55 < s['box'][3] - s['box'][1] < 80]
    shapes = [s for s in shapes if s not in digits]
    x0, y0, x1, y1 = extent(shapes)
    k = 15 / (y1 - y0); cx = (x0 + x1) / 2
    convert = lambda p: [round((p[0] - cx) * k, 4), round((y1 - p[1]) * k, 4)]
    d = extent(digits)
    return {'source': source, 'width': round((x1 - x0) * k, 3), 'length': 15,
            'numerals': {'x': round(((d[0] + d[2]) / 2 - cx) * k, 3), 'y': round((y1 - (d[1] + d[3]) / 2) * k, 3),
                         'fill': digits[0]['fill']},
            'shapes': [{'fill': s['fill'], 'rule': 'evenodd' if s['evenodd'] else 'nonzero',
                        'rings': [[convert(p) for p in r] for r in s['rings']]} for s in shapes]}

def florida(code, variant, source):
    """An FDOT route marker's face (assets/signs, from FDOT 700-102) in sign units:
    x centered, y up from the bottom, every part a fill (strokes become bands),
    plus its route number field. The catalog stretches it lengthwise for pavement."""
    text = (ROOT / f'assets/signs/data/{code}.js').read_text()
    art = json.loads(text[text.index('{', text.index('signArtwork,')):text.rindex(')')])[f'{code}--{variant}']
    entry = next(e for e in json.loads((ROOT / 'assets/signs/florida.json').read_text())['signs'] if e['id'] == f'{code}--{variant}')
    w, h = entry['box']
    convert = lambda p: [round(p[0] - w / 2, 4), round(h - p[1], 4)]
    hexes = {'white': '#ffffff', 'black': '#000000'}
    shapes = []
    for path in art['paths']:
        rings = [[(float(a), float(b)) for a, b in re.findall(r'(-?[\d.]+) (-?[\d.]+)', part)]
                 for part in re.split(r'(?=M)', path['d']) if part.strip()]
        if path.get('fill', 'none') == 'none':
            width = float(path['stroke-width'])
            band = unary_union([Polygon(r).exterior.buffer(width / 2, join_style='mitre') for r in rings if len(r) > 2])
            for g in getattr(band, 'geoms', [band]):
                shapes.append({'fill': hexes.get(path['stroke'], path['stroke']), 'rule': 'evenodd',
                               'rings': [[convert(q) for q in list(g.exterior.coords)[:-1]]] + [[convert(q) for q in list(i.coords)[:-1]] for i in g.interiors]})
            continue
        shapes.append({'fill': hexes.get(path['fill'], path['fill']), 'rule': path.get('fill-rule', 'nonzero'), 'rings': [[convert(q) for q in r] for r in rings if len(r) > 2]})
    field = (art.get('fields') or [None])[0]
    numerals = field and {'x': round(field['cx'] - w / 2, 4), 'y': round(h - field['top'] - field['height'] / 2, 4),
                          'height': round(field['height'], 4), 'maxWidth': round(field['maxWidth'], 4), 'fill': field['fill']}
    return {'source': source, 'box': [w, h], 'numerals': numerals, 'shapes': shapes}

def polygons_of(sym):
    return unary_union([Polygon(sh['rings'][0], sh['rings'][1:]).buffer(0) for sh in sym['shapes']])

def stem(sym):
    """Center x of an arrow's 1'-0" stem at its back end."""
    ring = max(sym['shapes'], key=lambda sh: Polygon(sh['rings'][0]).area)['rings'][0]
    low = min(p[1] for p in ring)
    # The longest edge along the bottom (a head's tip is a point, not an edge).
    edges = [(p, q) for p, q in zip(ring, ring[1:] + ring[:1]) if p[1] < low + 0.02 and q[1] < low + 0.02]
    p, q = max(edges, key=lambda e: abs(e[1][0] - e[0][0]))
    return (p[0] + q[0]) / 2, abs(q[0] - p[0])

def as_symbol(geometry, source, base):
    polygons = list(getattr(geometry, 'geoms', [geometry]))
    ring = lambda r: [[round(x, 4), round(y, 4)] for x, y in list(r.coords)[:-1]]
    xs = [x for g in polygons for x, _ in g.exterior.coords]; ys = [y for g in polygons for _, y in g.exterior.coords]
    return {'source': source, 'width': round(max(xs) - min(xs), 3), 'length': round(max(ys) - min(ys), 3),
            'shapes': [{'rule': 'evenodd', 'rings': [ring(g.exterior)] + [ring(h) for h in g.interiors]} for g in polygons]}

def compose_arrows(out):
    """Lane-use arrows without a published detail, built from 711-001 sheet 1 parts
    (neither FDOT, the MUTCD, nor the SHS Pavement Markings chapter gives a
    dimensioned left-and-right or through-left-right pavement arrow): the Turn and
    Through arrow mirrored about its through stem, and the Turn arrow mirrored
    about its own stem. And the Roundabout Approach Arrow's dot, as an add-on
    placed from the stem the way sheet 1 places it."""
    from shapely.affinity import scale, translate
    from shapely.validation import make_valid
    ttl = out['turnThroughLeft']
    x_s, w = stem(ttl)
    shape = make_valid(polygons_of(ttl))
    mirror = lambda g: make_valid(scale(g, xfact=-1, yfact=1, origin=(x_s, 0)))
    src = 'Composed from FDOT Standard Plans Index 711-001 sheet 1, Turn and Through Lane-Use Arrow (mirrored turn branch)'
    # A hair of overlap welds the mirrored halves along the stem.
    weld = lambda parts: unary_union([make_valid(g).buffer(1e-4, join_style='mitre') for g in parts]).buffer(-1e-4, join_style='mitre')
    out['turnThroughLeftRight'] = as_symbol(translate(weld([shape, mirror(shape)]), xoff=-x_s), src, ttl)
    # Left and right: the Turn Lane-Use Arrow and its mirror image on one stem.
    turn = make_valid(polygons_of(out['turnLeft']))
    t_s, _ = stem(out['turnLeft'])
    both = weld([turn, make_valid(scale(turn, xfact=-1, yfact=1, origin=(t_s, 0)))])
    out['turnLeftRight'] = as_symbol(translate(both, xoff=-t_s),
        'Composed from FDOT Standard Plans Index 711-001 sheet 1, Turn Lane-Use Arrow and its mirror image on one stem', ttl)
    # Roundabout dot: its position from the roundabout arrow's stem.
    ra = out['roundaboutLeft']
    pieces = sorted(ra['shapes'], key=lambda sh: Polygon(sh['rings'][0]).area)
    dot = Polygon(pieces[0]['rings'][0])
    arrow = {**ra, 'shapes': pieces[1:]}
    sx, _ = stem(arrow)
    # Relative to the stem's back end (x from its center, y from its bottom).
    sy = min(p[1] for sh in pieces[1:] for p in sh['rings'][0])
    out['roundaboutDot'] = {'source': ra['source'] + ' (dot)', 'shapes': [{'rule': 'evenodd', 'rings': [[[round(x - sx, 4), round(y - sy, 4)] for x, y in list(dot.exterior.coords)[:-1]]]}]}
    for key in ('through', 'turnLeft', 'turnThroughLeft', 'uTurn', 'turnLeftRight', 'turnThroughLeftRight'):
        out[key]['stem'] = round(stem(out[key])[0], 4)

def main(pdf, mutcd, font):
    out = {}
    # Sheet 1: Pavement Message and Arrow Details, each detail scaled by its own
    # 4" grid. Checked against dimensions (within 1", sheet 1 note 2) below.
    sheet1 = fills(pdf, 1)
    s = 'FDOT Standard Plans Index 711-001 sheet 1, '
    for key, box, name in [
        ('through', (640, 385, 690, 495), 'Through Lane-Use Arrow'),
        ('turnLeft', (755, 390, 835, 488), 'Turn Lane-Use Arrow (left shown)'),
        ('turnThroughLeft', (282, 366, 370, 512), 'Turn and Through Lane-Use Arrow'),
        ('uTurn', (468, 352, 552, 470), 'U Turn Lane-Use Arrow'),
        ('roundaboutLeft', (922, 366, 1000, 478), 'Roundabout Approach Arrow'),
        ('wrongWay', (80, 350, 155, 612), 'Wrong-Way Arrow'),
        ('preferential', (1090, 365, 1140, 515), 'Preferential Lane Symbol'),
    ]:
        out[key] = symbol(pick(sheet1, box), feet_per_point(sheet1, box), s + name, solid=key != 'preferential')
    # The In Pavement Warning Marking's figure: scaled by its dimensioned 6'-0" body.
    figure = pick(sheet1, (1090, 150, 1125, 232))
    body = max(figure, key=lambda f: f['box'][3] - f['box'][1])
    out['pedestrian'] = symbol(figure, 6 / (body['box'][3] - body['box'][1]), s + 'In Pavement Warning Marking (figure)')
    for key, feet in [('through', 9.5), ('preferential', 13), ('turnLeft', 8), ('uTurn', 10), ('turnThroughLeft', 12.75)]:
        assert abs(out[key]['length'] - feet) < 2 / 12 + 0.01, (key, out[key]['length'], feet)
    compose_arrows(out)
    # Sheet 2: Markings for Merge.
    sheet2 = fills(pdf, 2)
    out['merge'] = symbol(pick(sheet2, (865, 62, 945, 140)), feet_per_point(sheet2, (865, 62, 945, 140)),
                          'FDOT Standard Plans Index 711-001 sheet 2, Markings for Merge')
    # Sheet 13: Railroad Crossing Pavement Message (no grid): 20'-0" by 8'-0" X with 6'-0" R.
    sheet13 = fills(pdf, 13)
    rxr = pick(sheet13, (325, 330, 455, 640))
    x = [s for s in rxr if s['box'][3] - s['box'][1] > 200]
    k13 = 20 / (extent(x)[3] - extent(x)[1])
    e = extent(x); assert abs((e[2] - e[0]) * k13 - 8) < 0.1
    out['railroad'] = symbol(rxr, k13, 'FDOT Standard Plans Index 711-001 sheet 13, Railroad Crossing Pavement Message')
    # MUTCD 11th Edition Figure 3B-18, Elongated Route Shields and Markers Applied
    # as Pavement Markings (FDOT 711-001 shows only the Interstate shield).
    figure = fills(mutcd, 40, black=False)
    m = 'MUTCD 11th Edition Figure 3B-18, '
    out['shieldInterstate'] = shield(figure, (46, 590, 101, 719), m + 'A, Interstate Shield')
    out['shieldUSDark'] = shield(figure, (145, 590, 200, 719), m + 'B, U.S. Route Shield on dark pavement')
    out['shieldUSLight'] = shield(figure, (243, 590, 306, 719), m + 'C, U.S. Route Shield on light pavement')
    out['shieldStateDark'] = shield(figure, (352, 590, 407, 719), m + 'D, State Route Marker on dark pavement')
    out['shieldStateLight'] = shield(figure, (461, 590, 516, 719), m + 'E, State Route Marker on light pavement')
    # FDOT route markers, stretched lengthwise as MUTCD Section 3B.22 paragraph 03
    # allows ("elongated for proper proportioning when viewed as a marking").
    f = 'FDOT Standard Plans Index 700-102 '
    for digits in (2, 3, 4):
        out[f'floridaState{digits}'] = florida('FTP-612-25', str(digits), f + 'FTP-612-25 Florida Route Marker')
    out['floridaTurnpike'] = florida('FTP-610-25', 'standard', f + 'FTP-610-25 Florida\'s Turnpike')
    out['floridaToll'] = florida('FTP-611-25', 'standard', f + 'FTP-611-25 Toll Route Marker')
    (ROOT / 'assets/markings').mkdir(exist_ok=True)
    (ROOT / 'assets/markings/symbols.js').write_text(
        '/* Generated by scripts/import-markings.py from FDOT Standard Plans Index 711-001 and MUTCD Figure 3B-18; see SOURCES.md. */\n'
        'Object.assign((window.StripeMaker ??= {}).markingSymbols ??= {},' + json.dumps(out, separators=(',', ':')) + ');\n')

    # Word message glyphs: cap height 1 (8'-0" letters, 711-001 sheet 1).
    f = TTFont(font); glyphs = f.getGlyphSet(); upm = f['head'].unitsPerEm
    chars = {}
    for code, name in f.getBestCmap().items():
        pen = RecordingPen(); glyphs[name].draw(pen)
        rings, ring, at = [], [], None
        for op, args in pen.value:
            if op == 'moveTo': ring = [args[0]]; at = args[0]
            elif op == 'lineTo': ring.append(args[0]); at = args[0]
            elif op == 'qCurveTo':
                # TrueType implied on-curve points between consecutive controls.
                points = list(args); controls, end = points[:-1], points[-1]
                segments = []
                for i, c in enumerate(controls):
                    nxt = end if i == len(controls) - 1 else ((c[0] + controls[i + 1][0]) / 2, (c[1] + controls[i + 1][1]) / 2)
                    segments.append((c, nxt))
                for c, nxt in segments:
                    for k in range(1, 9):
                        s = k / 8; u = 1 - s
                        ring.append((u*u*at[0] + 2*u*s*c[0] + s*s*nxt[0], u*u*at[1] + 2*u*s*c[1] + s*s*nxt[1]))
                    at = nxt
            elif op == 'curveTo':
                c1, c2, end = args
                for k in range(1, CURVE_STEPS + 1):
                    s = k / CURVE_STEPS; u = 1 - s
                    ring.append(tuple(u*u*u*a + 3*u*u*s*b + 3*u*s*s*c + s*s*s*d for a, b, c, d in zip(at, c1, c2, end)))
                at = end
            elif op in ('closePath', 'endPath'):
                if len(ring) > 2: rings.append(ring)
                ring = []
        chars[chr(code)] = {'advance': round(f['hmtx'][name][0] / upm, 4),
                            'rings': [[[round(x / upm, 4), round(y / upm, 4)] for x, y in r] for r in rings]}
    (ROOT / 'assets/markings/font.js').write_text(
        '/* Generated by scripts/import-markings.py from fonts/FHWA-Pavement-Derived.ttf; see SOURCES.md. */\n'
        'Object.assign(window.StripeMaker ??= {},{markingFont:' + json.dumps(chars, separators=(',', ':')) + '});\n')

if __name__ == '__main__':
    main(*sys.argv[1:4])
