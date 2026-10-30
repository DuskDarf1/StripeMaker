#!/usr/bin/env python3
"""Build Florida standalone shields from FDOT 700-102 (2025–26) and CFX 2026.
Usage: python scripts/import-florida-signs.py /tmp/fdot-final.pdf /tmp/cfx-2026.pdf /tmp/fdot-700-current.pdf
Requires the same pymupdf/svgpathtools environment as import-signs.py.
Current FTP identifiers follow FDOT's 2026 TEM / 2026 Turnpike trailblazers.
"""
import importlib.util,json,pathlib,sys,xml.etree.ElementTree as ET
import pymupdf as fitz
ROOT=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('importer',ROOT/'scripts/import-signs.py');imp=importlib.util.module_from_spec(spec);spec.loader.exec_module(imp)
fdot=fitz.open(sys.argv[1]);cfx=fitz.open(sys.argv[2]);latest=fitz.open(sys.argv[3]);dest=ROOT/'assets/signs'
colors=imp.PALETTE['colors'];entries=[];packs={}
def path(d):
 out=[];last=None
 for item in d['items']:
  kind,*pts=item
  if kind=='re':
   r=pts[0];out.append(f'M{r.x0} {r.y0} H{r.x1} V{r.y1} H{r.x0} Z');last=None;continue
  if kind=='qu':pts=[pts[0].ul,pts[0].ur,pts[0].lr,pts[0].ll,pts[0].ul];kind='l'
  if last is None or abs(last-pts[0])>.001:out.append(f'M{pts[0].x} {pts[0].y}')
  out.append(('C' if kind=='c' else 'L')+' '.join(f'{p.x} {p.y}' for p in pts[1:]));last=pts[-1]
 if d.get('closePath'):out.append('Z')
 return ' '.join(out)
def extracted(page,area,fill):
 seen=set();out=[]
 for d in page.get_drawings():
  if d['fill'] is not None and fitz.Rect(area).contains(d['rect']):
   s=path(d)
   if s not in seen:out.append(f'<path d="{s}" fill="{fill}" fill-rule="evenodd"/>');seen.add(s)
 return ''.join(out)
def rect(w,h,color,r=1.5):return f'<rect width="{w}" height="{h}" rx="{r}" fill="{color}"/>'
def panel(w,h):return rect(w,h,'white')+f'<rect x=".35" y=".35" width="{w-.7}" height="{h-.7}" rx="1.15" fill="black"/>'+f'<rect x=".85" y=".85" width="{w-1.7}" height="{h-1.7}" rx=".65" fill="white"/>'
def transformed(s,x,y,k):return f'<g transform="scale({k}) translate({-x} {-y})">{s}</g>'
def shield(w,h):
 # Rounded top corners and semicircular base from the published route-marker detail.
 return f'M3 0 H{w-3} Q{w} 0 {w} 3 V{h-w/2} A{w/2} {w/2} 0 0 1 0 {h-w/2} V3 Q0 0 3 0 Z'
def route(default,cx,top,height,maxwidth,series='D',maximum=999):return dict(key='route',label='Route number',type='number',min=1,max=maximum,step=1,series=series,default=str(default),original=str(default),paths=[],cx=cx,top=top,height=height,maxWidth=maxwidth,fill='#000000')
def add(code,name,suffix,w,h,body,field=None,digits=None,aliases=''):
 id=code+'--'+suffix
 svg,box=imp.flatten(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}">{body}</svg>'.encode())
 fields=[]
 if field:
  k=100/max(w,h)
  for key in ['cx','top','height','maxWidth']:field[key]*=k
  fields=[field]
 paths=[e.attrib for e in ET.fromstring(svg)]
 packs.setdefault(code,{})[id]=dict(paths=paths,fields=fields)
 e=dict(id=id,code=code,name=name,category='Florida route signs',variant=name,size=[w,h],box=box,src='assets/signs/'+id+'.svg',aliases=aliases,source='FDOT 700-102 / CFX 2026')
 if digits:e.update(routeFamily=True,digits=digits,routeMax=9999)
 entries.append(e)
 (dest/(id+'.svg')).write_text(svg)
# State outline is the actual filled vector in FDOT's standalone drawing.
state=extracted(fdot[2],(755,60,857,160),'black')
for digits,w,height,top,series,default in [(2,24,10,9,'D',44),(3,30,8,10.5,'D',408),(4,30,8,10.5,'C',5054)]:
 offset=0 if digits==2 else 6
 body=panel(w,24)+f'<g transform="translate({offset} 0)">'+transformed(state,748,54.1,24/116.3)+'</g>'
 add('FTP-612-25','Florida Route Marker',str(digits),w,24,body,route(default,10.5+offset/2,top,height,17.5+offset,series,9999),digits,'Florida state road SR shield FTP-17-06')
# Turnpike lettering and Florida silhouette are imported, not recreated with a UI font.
turnpike=extracted(fdot[1],(218,537,304,651),'white')
body=rect(30,36,colors['green'])+f'<rect x=".375" y=".375" width="29.25" height="35.25" rx="1.125" fill="none" stroke="white" stroke-width=".75"/>'+transformed(turnpike,205.5,527.9,30/111.2)
add('FTP-610-25',"Florida’s Turnpike",'standard',30,36,body,aliases='Florida turnpike shield FTP-16-10')
# Latest posted FDOT 700-102, FY 2027–28, sheet 15, FTP-611-25.
# Import the dimensioned 24×30 route marker, not a trailblazer illustration or
# either larger guide construction. Its updated top corner radius is 1.5 in.
# Colors follow the drawing's notes (gray drafting fill denotes yellow).
body='';drawings=latest[14].get_drawings()
for i in [456,457,458,466,468,1255,1259,1262,1265]:
 color='#ffffff' if i==456 else colors['yellow'] if i==458 else '#000000'
 body+=f'<path d="{path(drawings[i])}" fill="{color}" fill-rule="evenodd"/>'
body=transformed(body,115.4,300,0.25)
add('FTP-611-25','Toll Route Marker','standard',24,30,body,route(417,10.588,16,6,16.5,'D'),aliases='Florida toll road shield independent use route marker FTP-81-06')
entries[-1]['source']='FDOT 700-102 FY 2027–28, sheet 15, FTP-611-25 (24 × 30)'
# CFX linework forms one closed state-outline polygon. Join its unordered CAD segments.
segments=[list(d['items'][0][1:]) for d in cfx[5].get_drawings()[468:512]]
points=list(segments.pop(0))
while segments:
 for i,(a,b) in enumerate(segments):
  if abs(points[-1]-a)<.01:points.append(b);segments.pop(i);break
  if abs(points[-1]-b)<.01:points.append(a);segments.pop(i);break
 else:raise ValueError('CFX state outline is not connected')
statepath='M'+' L'.join(f'{p.x} {p.y}' for p in points)+' Z'
for code,color,name in [('CFX-TM',colors['orange'],'CFX Toll Route Shield'),('CFX-TM-ALT','#000000','CFX Toll Route Shield — State Jurisdiction')]:
 body=f'<path d="{shield(36,48)}" fill="white" stroke="black" stroke-width=".12"/>'+f'<path d="{shield(36,48)}" transform="translate(.75 .75) scale(.958333 .96875)" fill="black"/>'+f'<path d="{shield(36,48)}" transform="translate(1.75 1.75) scale(.902778 .927083)" fill="white"/>'
 body+=f'<path d="M3 1.75 H33 Q34.25 1.75 34.25 3 V10.75 H1.75 V3 Q1.75 1.75 3 1.75 Z" fill="{colors["yellow"]}"/>'

 body+=f'<path d="M1.75 11 H34.25 V12 H1.75 Z" fill="black"/>'
 body+=transformed(f'<path d="{statepath}" fill="{color}"/>',340.3,232.6,36/179.8)
 add(code,name,'standard',36,48,body,route(408,15.64,22.53,12,22.84),aliases='Florida Central Florida Expressway Authority toll road shield '+('TM ALT black' if code.endswith('ALT') else 'TM orange'))
 packs[code][code+'--standard']['fields'][0]['fitWidth']=True
 packs[code][code+'--standard']['staticLegend']=dict(value='TOLL',series='E',cx=37.5,top=3.1*100/48,height=6*100/48,maxWidth=30*100/48,fill='#000000')
(dest/'florida.json').write_text(json.dumps(dict(signs=entries),indent=2)+'\n')
(dest/'florida.js').write_text('window.StripeMaker ??= {}; window.StripeMaker.floridaSigns = '+json.dumps(entries,separators=(',',':'))+';\n')
for code,data in packs.items():(dest/'data'/f'{code}.js').write_text('window.StripeMaker ??= {}; window.StripeMaker.signArtwork ??= {}; Object.assign(window.StripeMaker.signArtwork,'+json.dumps(data,separators=(',',':'))+');\n')
print('Imported',len(entries),'layouts in',len(packs),'Florida shield families. Run thumbnail composition to add default route legends.')
