#!/usr/bin/env python3
"""Port SignMaker v2.2 Florida guide shields (GPL-3.0) into vector sign packs.
Usage: python3 scripts/import-state-route-signs.py [SignMaker repository]
Uses only the Python standard library; run compose-florida-thumbnails.cjs after.
"""
import json, math, pathlib, re, sys, xml.etree.ElementTree as ET
ROOT = pathlib.Path(__file__).resolve().parents[1]
SOURCE = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT.parent / 'SignMaker v2.2'
DEST = ROOT / 'assets/signs'
folder = SOURCE / 'public/img/shields/United States/Florida/FDOT'
catalog = json.loads((DEST / 'florida.json').read_text())
pack = {}
# Reuse our dependency-free TrueType contour reader for SignMaker's exact numerals.
parser = (ROOT/'scripts/build-engineering-font.py').read_text().split('glyphs={')[0]
parser = parser.replace("(root/'fonts/osifont.ttf').read_bytes()", "font_path.read_bytes()")
namespace = {'__file__': str(ROOT/'scripts/build-engineering-font.py'),
             'font_path': SOURCE/'public/fonts/Roadgeek2014SeriesD.ttf'}
exec(parser, namespace)
alphabet = {}
font_scale = 100 / (namespace['units'] * 4 / 7)
for char in '0123456789':
    glyph = namespace['mapping'][ord(char)]
    contours = [namespace['flatten'](c) for c in namespace['contours'](glyph)]
    d = ' '.join('M'+' L'.join(f'{x*font_scale:.4f} {100+y*font_scale:.4f}' for x,y in c)+' Z' for c in contours)
    alphabet[char] = dict(d=d,width=namespace['adv'][glyph]*font_scale,left=0,right=0)

for digits, width, filename, default in [
    (2, 42, 'Florida-Guide-42x36-1to2.svg', '44'),
    (3, 48, 'Florida-Guide-48x36-3plus.svg', '408'),
    (4, 48, 'Florida-Guide-48x36-3plus.svg', '5054'),
]:
    k = 100 / width
    paths = []
    for el in ET.parse(folder / filename).getroot():
        tag = el.tag.split('}')[-1]
        if tag not in ('rect', 'path'): continue
        attrs = {key: el.attrib[key] for key in ('fill', 'stroke', 'fill-rule') if key in el.attrib}
        if 'stroke-width' in el.attrib: attrs['stroke-width'] = str(float(el.attrib['stroke-width']) * k)
        if tag == 'rect':
            x, y, w, h, r = [float(el.attrib[key]) for key in ('x', 'y', 'width', 'height', 'rx')]
            points = []
            for cx, cy, start in [(x+w-r,y+r,-90),(x+w-r,y+h-r,0),(x+r,y+h-r,90),(x+r,y+r,180)]:
                for step in range(17):
                    angle = math.radians(start + step * 90 / 16)
                    points.append((cx+r*math.cos(angle),cy+r*math.sin(angle)))
            d = 'M' + ' L'.join(f'{a*k:.4f} {b*k:.4f}' for a,b in points) + ' Z'
        else:
            # Source ribbon is already exclusively M/L/Z, including both contours.
            d = re.sub(r'-?\d*\.?\d+', lambda m: f'{float(m[0])*k:.4f}', el.attrib['d'])
        paths.append(dict(d=d, **attrs))
    id = f'FTP-612-25--{digits}'
    # SignMaker Shield.js automatic defaults: 15-inch Roadgeek Series D,
    # top 14.75; right ink edge 31 / panel width minus 11 inches.
    field = dict(key='route',label='Route number',type='number',min=1,max=9999,step=1,
                 series='D',default=default,original=default,paths=[],cx=0,
                 top=14.75*k,height=15*k,maxWidth=(width-12.25)*k,alphabet=alphabet,
                 right=(width-11)*k,fill='#000000',fitWidth=True)
    if digits > 2:
        field['guidePanel'] = dict(maxExpansion=10*k, outlinePath=2)
    pack[id] = dict(paths=paths, fields=[field])
    entry = next(e for e in catalog['signs'] if e['id'] == id)
    entry.update(size=[width,36],box=[100,36*k],source=f'SignMaker v2.2 {filename}; FDOT 700-102 FY 2026–27 sheet 16')
(DEST/'florida.json').write_text(json.dumps(catalog,indent=2)+'\n')
(DEST/'florida.js').write_text('window.StripeMaker ??= {}; window.StripeMaker.floridaSigns = '+json.dumps(catalog['signs'],separators=(',',':'))+';\n')
(DEST/'data/FTP-612-25.js').write_text('window.StripeMaker ??= {}; window.StripeMaker.signArtwork ??= {}; Object.assign(window.StripeMaker.signArtwork,'+json.dumps(pack,separators=(',',':'))+');\n')
