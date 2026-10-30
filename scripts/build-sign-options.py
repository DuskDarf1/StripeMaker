#!/usr/bin/env python3
"""Build file://-safe sign data and editable legends from official FHWA artwork.
Needs the import-signs.py tool dependencies; no browser/runtime dependencies.
Usage: python scripts/build-sign-options.py /tmp/stripemaker-alphabets.pdf
"""
import importlib.util,json,pathlib,re,sys,collections,statistics,xml.etree.ElementTree as ET
import numpy as np
from scipy.spatial import cKDTree
import pymupdf
from svgpathtools import parse_path
ROOT=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('import_signs',ROOT/'scripts/import-signs.py');imp=importlib.util.module_from_spec(spec);spec.loader.exec_module(imp)
SVG='{http://www.w3.org/2000/svg}';XLINK='{http://www.w3.org/1999/xlink}'

def alphabets(pdf):
    doc=pymupdf.open(pdf);out={}
    for series,table,start,end in [('B',5,6,11),('C',11,12,18),('D',18,19,26),('E',26,27,34),('EM',34,35,43),('F',43,44,52)]:
        lines=doc[table].get_text().splitlines();metrics={}
        for i in range(len(lines)-3):
            if lines[i] in list('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789&!"#$/¢()*.,:-@=+?')+['aster','period','comma / apos','colon','hyphen']:
                try: metrics[{'aster':'*','period':'.','comma / apos':',','colon':':','hyphen':'-'}.get(lines[i],lines[i])]=[float(x)/4 for x in lines[i+1:i+4]]
                except ValueError:pass
        raw={}
        for page in doc.pages(start,end):
            root=ET.fromstring(page.get_svg_image());defs={e.get('id'):e.get('d') for e in root.iter(SVG+'path') if e.get('id')}
            for use in root.iter(SVG+'use'):
                if use.get('fill')!='#1f1a17':continue
                c=use.get('data-text');d=defs.get(use.get(XLINK+'href','')[1:])
                if c and d:raw[c]=d
        cap=parse_path(raw['H']).bbox()[3];glyphs={}
        for c,d in raw.items():
            box=parse_path(d).bbox();left,width,right=metrics.get(c,[.1,(box[1]-box[0])/cap,.1])
            root=ET.Element('svg',xmlns=SVG[1:-1],viewBox='0 0 100 100')
            ET.SubElement(root,'path',d=d,transform=f'matrix({100/cap} 0 0 {-100/cap} {-box[0]*100/cap} 100)')
            svg,_=imp.flatten(ET.tostring(root));path=ET.fromstring(svg)[0].get('d')
            glyphs[c]={'d':path,'left':left*100,'width':width*100,'right':right*100}
        if ',' in glyphs:
            g=glyphs[','];glyphs["'"]={**g,'d':move(g['d'],0,-72)}
        out[series]=glyphs
    return out

def move(d,x,y,scale=1):
    i=0
    def repl(m):
        nonlocal i
        offset=x if i%2==0 else y;i+=1
        return f'{float(m[0])*scale+offset:.3f}'
    return re.sub(r'-?\d*\.?\d+(?:e[-+]?\d+)?',repl,d,flags=re.I)

def bbox(d):
    values=[float(x) for x in re.findall(r'-?\d*\.?\d+',d)]
    return (min(values[::2]),max(values[::2]),min(values[1::2]),max(values[1::2]))

def cloud(d):
    parts=re.findall(r'[MLZ]|-?\d*\.?\d+',d);p=None;start=None;edges=[];i=0
    while i<len(parts):
        t=parts[i];i+=1
        if t in ['M','L']:
            q=np.array([float(parts[i]),float(parts[i+1])]);i+=2
            if t=='M':start=q
            elif p is not None:edges.append((p,q))
            p=q
        elif t=='Z' and p is not None:edges.append((p,start));p=start
    if not edges:return None
    a=np.array([p for p,q in edges]);b=np.array([q for p,q in edges]);length=np.linalg.norm(b-a,axis=1);length[length==0]=1e-12
    c=np.cumsum(length);t=np.linspace(0,c[-1]-1e-9,128);idx=np.searchsorted(c,t);rel=(t-np.r_[0,c[:-1]][idx])/length[idx];points=a[idx]+(b-a)[idx]*rel[:,None]
    lo=np.minimum(a.min(axis=0),b.min(axis=0));hi=np.maximum(a.max(axis=0),b.max(axis=0));h=hi[1]-lo[1]
    if h<1e-6:return None
    return (points-lo)/h,(hi[0]-lo[0])/h

def split_paths(paths):
    # A compound path can contain several letters. Split disjoint outlines,
    # retaining every enclosed counter with its enclosing outline.
    result=[]
    for p in paths:
        subs=[d for d in re.split(r'(?=M)',p['d']) if d.strip()]
        boxes=[bbox(d) for d in subs]
        parents=[]
        for i,b in enumerate(boxes):
            candidates=[j for j,a in enumerate(boxes) if i!=j and a[0]<=b[0] and a[1]>=b[1] and a[2]<=b[2] and a[3]>=b[3] and a!=b]
            parents.append(min(candidates,key=lambda j:(boxes[j][1]-boxes[j][0])*(boxes[j][3]-boxes[j][2])) if candidates else None)
        groups={}
        for i,d in enumerate(subs):
            root=i
            while parents[root] is not None:root=parents[root]
            groups.setdefault(root,[]).append(d)
        result.extend({**p,'d':' '.join(group)} for group in groups.values())
    return result

def build_fields(entry,paths,specs,font,refs):
    fields=[];w,h=entry['box']
    for spec in specs:
        lo,hi,top,bottom=spec['roi'];region=(lo*w,hi*w,top*h,bottom*h)
        selected=[];recognized=[]
        for i,p in enumerate(paths):
            b=bbox(p['d'])
            if p.get('fill')=='none' or not (b[0]>=region[0]-.05 and b[1]<=region[1]+.05 and b[2]>=region[2]-.05 and b[3]<=region[3]+.05):continue
            if spec.get('type')=='text':selected.append(i)
            cl=cloud(p['d'])
            if cl is None:continue
            points,aspect=cl;tree=cKDTree(points);best=(1,None,None)
            for series,char,q,t,a in refs:
                if spec.get('series') and series!=spec['series']:continue
                if char not in '0123456789X'+spec.get('anchor',''):continue
                if abs(a-aspect)>.1:continue
                score=(t.query(points)[0].mean()+tree.query(q)[0].mean())/2
                if score<best[0]:best=(float(score),series,char)
            if best[0]<.035:
                recognized.append((i,best[1],best[2],b,best[0]))
                if spec.get('type')!='text':selected.append(i)
        if not selected:raise ValueError(f"No field outlines: {entry['variant']} {spec['key']}")
        recognized.sort(key=lambda r:r[3][0])
        series=spec.get('series') or collections.Counter(r[1] for r in recognized).most_common(1)[0][0]
        anchors=[r for r in recognized if r[2]==spec.get('anchor')] if spec.get('anchor') else recognized
        if not anchors:raise ValueError(f"No height reference: {entry['variant']} {spec['key']}")
        heights=[];tops=[]
        for _,_,char,b,_ in anchors:
            gb=bbox(font[series][char]['d']);k=(b[3]-b[2])/(gb[3]-gb[2]);heights.append(k*100);tops.append(b[2]-gb[2]*k)
        boxes=[bbox(paths[i]['d']) for i in selected];left=min(b[0] for b in boxes);right=max(b[1] for b in boxes)
        original=spec.get('original',spec.get('default',''.join(r[2] for r in recognized)))
        default=spec.get('default',original)
        if spec.get('type')!='text' and not str(default).isdigit():raise ValueError(f"Unrecognized numeric legend: {entry['variant']} {spec['key']}={default}")
        cx=(left+right)/2
        maxwidth=max(right-left,min(cx-region[0],region[1]-cx)*2)
        field={k:v for k,v in spec.items() if k not in ['roi','anchor','heightInches']}
        field.update(series=series,type=spec.get('type','number'),default=default,original=original,paths=selected,cx=round(cx,4),top=round(statistics.median(tops),4),height=round(statistics.median(heights),4),maxWidth=round(maxwidth,4),fill=paths[selected[0]]['fill'])
        physical=spec.get('heightInches',{}).get('x'.join(f'{n:g}' for n in entry['size'] if n is not None))
        if physical:field['height']=physical*100/max(entry['size'])
        if field['type']=='number':field.setdefault('step',1)
        if field.get('step')==5:field['hint']='Use 5 mph increments. Letter height and spacing follow this sign layout.'
        fields.append(field)
    return fields

def main():
    font=alphabets(sys.argv[1]);dest=ROOT/'assets/signs';pack=dest/'data';pack.mkdir(exist_ok=True)
    (dest/'alphabets.json').write_text(json.dumps(font,separators=(',',':'))+'\n')
    (dest/'lettering.js').write_text('/* FHWA Standard Alphabets; see SOURCES.md. */\n(window.StripeMaker ??= {}).signAlphabets='+json.dumps(font,separators=(',',':'))+';\n')
    catalog=json.loads((dest/'catalog.json').read_text())
    (dest/'catalog.js').write_text('/* Generated from catalog.json by scripts/build-sign-options.py. */\n(window.StripeMaker ??= {}).signCatalog='+json.dumps(catalog,separators=(',',':'),ensure_ascii=False)+';\n')
    specs=json.loads((ROOT/'scripts/sign-legend-specs.json').read_text())['specs']
    refs=[]
    for series,chars in font.items():
        for char,g in chars.items():
            cl=cloud(g['d'])
            if cl is not None:refs.append((series,char,cl[0],cKDTree(cl[0]),cl[1]))
    bycode={};coverage={};errors=[]
    for entry in catalog['signs']:
        paths=[dict(e.attrib) for e in ET.parse(ROOT/entry['src']).getroot()]
        fields=[]
        if entry['code'] in specs and not (entry['code'].startswith('W13-20') and 'blank' in entry['variant'].lower()):
            paths=split_paths(paths)
            try:fields=build_fields(entry,paths,specs[entry['code']],font,refs)
            except ValueError as error:errors.append(str(error))
            coverage[entry['id']]=[(f['key'],f['default'],f['series'],f['height']) for f in fields]
        bycode.setdefault(entry['code'],{})[entry['id']]={'paths':paths,'fields':fields}
    for code,data in bycode.items():
        (pack/(code+'.js')).write_text('/* Generated FHWA artwork; see ../SOURCES.md. */\nObject.assign((window.StripeMaker ??= {}).signArtwork ??= {},'+json.dumps(data,separators=(',',':'))+');\n')
    (dest/'options-coverage.json').write_text(json.dumps({'codes':len(specs),'layouts':len(coverage),'fields':sum(len(v) for v in coverage.values()),'errors':errors,'layoutsWithFields':coverage},indent=2)+'\n')
    print('Fields',len(specs),len(coverage),'errors',len(errors));print('\n'.join(errors))
if __name__=='__main__':main()
