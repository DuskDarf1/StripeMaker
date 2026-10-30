#!/usr/bin/env python3
"""Import official FHWA SHS layouts. Run with svgpathtools and pymupdf installed:
python scripts/import-signs.py /tmp/stripemaker-shs.html /tmp/stripemaker-shs
The downloaded index and release ZIPs are inputs; no runtime dependencies.
"""
import collections, hashlib, html, json, math, pathlib, re, sys, zipfile
import xml.etree.ElementTree as ET
from svgpathtools import parse_path, Line, CubicBezier, QuadraticBezier, Arc
ROOT = pathlib.Path(__file__).resolve().parents[1]
SOURCE = 'https://mutcd.fhwa.dot.gov/kno-shs_2024-release-status/'
PALETTE = json.loads((ROOT/'assets/signs/palette.json').read_text())
def sign_color(value):
    color=value.lower()
    return PALETTE['colors'].get(PALETTE['aliases'].get(color),value)

def clean(s): return re.sub(r'\s+', ' ', html.unescape(re.sub('<[^>]+>', '', s))).strip()
def code(s): return re.sub(r'(?<=[A-Z-])0+(?=\d)', '', s)
def catalog(source):
    out = {}
    for section, category in [('reg','Regulatory'),('ws','Warning and object markers'),('ttcz','Temporary traffic control'),('sas','School'),('gss','Guide and route signs')]:
        table = source.split(f'id="{section}"')[1].split('</table>')[0]
        for tr in re.findall(r'<tr[^>]*>(.*?)</tr>', table, re.S):
            cells = [clean(x) for x in re.findall(r'<(?:td|th)[^>]*>(.*?)</(?:td|th)>',tr,re.S)]
            if cells and re.match(r'^[A-Z]+\d', cells[0]):
                for c in re.split(r',\s*',cells[0]):
                    out[c] = dict(code=c,name=cells[1],category=category,release=cells[-1])
    return out

def inventory(index, folder):
    found = []; unknown = []
    for archive in sorted(folder.glob('*.zip')):
        release = re.search(r'Release_(\d)',archive.name)[1]
        with zipfile.ZipFile(archive) as z:
            for member in z.namelist():
                filename = member.split('/')[-1]
                is_pdf = filename.lower().endswith(".pdf") and any(c in member for c in ["R03-45a", "R06-03a", "D03-01"])
                if not filename.lower().endswith(".svg") and not is_pdf: continue
                size = re.search(r'(VAR|\d+(?:\.\d+)?)[xX](VAR|\d+(?:\.\d+)?)', filename)
                if not size: continue # Dimensioned publication pages aren't sign faces.
                tokens = [code(p.split(' ')[0]) for p in member.split('/')]
                matches = [c for c in index if any(t == c or t in [c+'L',c+'R'] for t in tokens)]
                if not matches:
                    if re.match(r'(R|W|S|OM)\d',filename):unknown.append(member)
                    continue
                # A specific filename code wins over a shared parent directory.
                exact = [c for c in matches if tokens[-1] == c]
                c = (exact or sorted(matches,key=len,reverse=True))[0]
                if index[c]['release'] and int(float(index[c]['release'])) > int(release):continue
                variant = clean(filename[:-4])
                variant = code(variant.split(' ')[0]) + ' ' + variant.split(' ',1)[-1]
                id = c + '--' + hashlib.sha256(variant.encode()).hexdigest()[:12]
                data=z.read(member)
                if is_pdf:
                    import pymupdf
                    data=pymupdf.open(stream=data,filetype="pdf")[0].get_svg_image().encode()
                    if c == 'R6-3a':
                        # FHWA's PDF puts the black/white face and red/cyan
                        # dimension construction lines in the same OCG layer.
                        # Remove only those measurement colors; text notes are
                        # omitted by the generic outline-only conversion below.
                        root=ET.fromstring(data)
                        for parent in root.iter():
                            for child in list(parent):
                                if any(child.get(a) in ['#bf301a','#00aeef'] for a in ['fill','stroke']):parent.remove(child)
                        data=ET.tostring(root)
                found.append((dict(index[c],id=id,variant=variant,size=[float(v) if v != 'VAR' else None for v in [size[1],size[2]]],source=archive.name,member=member),data))
    return found,unknown

# Compose affine transforms and flatten Bezier outlines at <= 0.025 units on a
# 100-unit face. This keeps the app's M/L/Z-only vector PDF contract, including
# compound paths (holes in letters) and avoids runtime external SVG resources.
def multiply(a,b):
    x,y,u,v,e,f=a; X,Y,U,V,E,F=b
    return (x*X+u*Y,y*X+v*Y,x*U+u*V,y*U+v*V,x*E+u*F+e,y*E+v*F+f)
I=(1,0,0,1,0,0)
def transform(s):
    m=I
    for op,args in re.findall(r'(\w+)\(([^)]*)\)',s):
        n=[float(v) for v in re.findall(r'-?\d*\.?\d+(?:[eE][-+]?\d+)?',args)];t=I
        if op=='matrix':t=tuple(n)
        elif op=='translate':t=(1,0,0,1,n[0],n[1] if len(n)>1 else 0)
        elif op=='scale':t=(n[0],0,0,n[1] if len(n)>1 else n[0],0,0)
        elif op=='rotate':
            r=math.radians(n[0]);t=(math.cos(r),math.sin(r),-math.sin(r),math.cos(r),0,0)
            if len(n)>1:t=multiply(multiply((1,0,0,1,n[1],n[2]),t),(1,0,0,1,-n[1],-n[2]))
        elif op=='skewX':t=(1,0,math.tan(math.radians(n[0])),1,0,0)
        elif op=='skewY':t=(1,math.tan(math.radians(n[0])),0,1,0,0)
        else:raise ValueError('Unknown transform '+op)
        m=multiply(m,t)
    return m

def shape(e):
    tag=e.tag.split('}')[-1];a=e.attrib
    v=lambda k,d=0:float(a.get(k,d))
    if tag=='path':return a.get('d','')
    if tag in ['polyline','polygon']:
        n=re.findall(r'-?\d*\.?\d+(?:[eE][-+]?\d+)?',a.get('points',''));return 'M'+' L'.join(' '.join(n[i:i+2]) for i in range(0,len(n),2))+(' Z' if tag=='polygon' else '')
    if tag=='line':return f'M{v("x1")} {v("y1")} L{v("x2")} {v("y2")}'
    if tag=='rect':
        x,y,w,h=v('x'),v('y'),v('width'),v('height');rx=min(v('rx',a.get('ry',0)),w/2);ry=min(v('ry',rx),h/2)
        if not rx or not ry:return f'M{x} {y} h{w} v{h} h{-w} Z'
        return f'M{x+rx} {y} H{x+w-rx} A{rx} {ry} 0 0 1 {x+w} {y+ry} V{y+h-ry} A{rx} {ry} 0 0 1 {x+w-rx} {y+h} H{x+rx} A{rx} {ry} 0 0 1 {x} {y+h-ry} V{y+ry} A{rx} {ry} 0 0 1 {x+rx} {y} Z'
    if tag in ['circle','ellipse']:
        x,y=v('cx'),v('cy');rx=v('r') if tag=='circle' else v('rx');ry=v('r') if tag=='circle' else v('ry')
        return f'M{x-rx} {y} A{rx} {ry} 0 1 0 {x+rx} {y} A{rx} {ry} 0 1 0 {x-rx} {y} Z'
    return ''

def flatten(data, resolve_uses=False):
    root=ET.fromstring(data);box=[float(x) for x in root.get('viewBox').split()];k=100/max(box[2:]);matrix=(k,0,0,k,-box[0]*k,-box[1]*k)
    rules={}
    for e in root.iter():
        if e.tag.endswith('}style'):
            for selectors,body in re.findall(r'([^{}]+)\{([^}]+)\}',e.text or ''):
                props=dict(re.findall(r'([\w-]+)\s*:\s*([^;]+)',body))
                for sel in selectors.split(','):rules[sel.strip()]=props
    paths=[]
    references={e.get('id'):e for e in root.iter() if e.get('id')}
    def walk(e,parent,style):
        tag=e.tag.split('}')[-1]
        if tag in ['defs','metadata','foreignObject','style','pattern','clipPath','text']:return
        st=dict(style)
        for cls in e.get('class','').split():st.update(rules.get('.'+cls,{}))
        st.update({k:v for k,v in e.attrib.items() if k in ['fill','stroke','stroke-width','fill-rule','display','opacity','visibility']})
        st.update(dict(re.findall(r'([\w-]+)\s*:\s*([^;]+)',e.get('style',''))))
        if st.get('display')=='none' or st.get('visibility')=='hidden' or st.get('opacity')=='0':return
        m=multiply(parent,transform(e.get('transform','')))
        def pt(z):return complex(m[0]*z.real+m[2]*z.imag+m[4],m[1]*z.real+m[3]*z.imag+m[5])
        def fmt(z):return f'{z.real:.3f} {z.imag:.3f}'
        if tag=='use':
            reference=references.get((e.get('href') or e.get('{http://www.w3.org/1999/xlink}href') or '').lstrip('#'))
            if resolve_uses and reference is not None:walk(reference,multiply(m,(1,0,0,1,float(e.get('x',0)),float(e.get('y',0)))),st)
            return
        d=shape(e)
        if d:
            out=[]
            for sub in parse_path(d).continuous_subpaths():
                if not len(sub):continue
                out.append('M'+fmt(pt(sub.start)))
                def sample(seg,t0,t1,p0,p1,depth=0):
                    t=(t0+t1)/2;mid=pt(seg.point(t))
                    error=max(abs(pt(seg.point(t0+(t1-t0)*q))-(p0+(p1-p0)*q)) for q in [.25,.5,.75])
                    if error>.025 and depth<16:sample(seg,t0,t,p0,mid,depth+1);sample(seg,t,t1,mid,p1,depth+1)
                    else:out.append('L'+fmt(p1))
                for seg in sub:
                    if isinstance(seg,Line):out.append('L'+fmt(pt(seg.end)))
                    else:sample(seg,0,1,pt(seg.start),pt(seg.end))
                if sub.isclosed():out.append('Z')
            if out:
                fill=st.get('fill','#000').strip();stroke=st.get('stroke','none').strip()
                if 'url(' in fill:fill='none' # Unfilled variable-message template areas.
                a={'d':' '.join(out),'fill':fill}
                if stroke!='none':a.update(stroke=stroke,**{'stroke-width':str(float(st.get('stroke-width','1').replace('px',''))*math.hypot(m[0],m[1]))})
                if st.get('fill-rule')=='evenodd':a['fill-rule']='evenodd'
                if fill in PALETTE['constructionColors'] or stroke in PALETTE['constructionColors']:return
                for key in ['fill','stroke']:
                    if key in a:a[key]=sign_color(a[key])
                if fill!='none' or stroke!='none':paths.append(a)
        for child in e:walk(child,m,st)
    walk(root,matrix,{})
    if not paths:raise ValueError('No artwork')
    svg=ET.Element('svg',xmlns='http://www.w3.org/2000/svg',viewBox=f'0 0 {box[2]*k:.4f} {box[3]*k:.4f}')
    for a in paths:ET.SubElement(svg,'path',a)
    return ET.tostring(svg,encoding='unicode'),[round(box[2]*k,4),round(box[3]*k,4)]

def main():
    index=catalog(pathlib.Path(sys.argv[1]).read_text());items,unknown=inventory(index,pathlib.Path(sys.argv[2]))
    dest=ROOT/'assets/signs';dest.mkdir(exist_ok=True,parents=True)
    result=[]; failures=[]
    for i,(entry,data) in enumerate(items):
        entry['src']='assets/signs/'+entry['id']+'.svg'
        try:
            svg,box=flatten(data,entry['code']=='D3-1')
        except ValueError as error:
            failures.append({'member':entry['member'],'error':str(error)})
            print('FAILED',entry['member'],str(error),flush=True);continue
        entry['box']=box;(ROOT/entry['src']).write_text(svg)
        result.append(entry)
        if i%100==0:print(i,len(items),flush=True)
    result=list({e['id']:e for e in result}.values());result.sort(key=lambda e:(e['category'],e['code'],e['variant']))
    missing=[e for c,e in index.items() if not any(x['code']==c for x in result)]
    (dest/'catalog.json').write_text(json.dumps({'source':SOURCE,'edition':'2024 SHS; releases 1–6','signs':result},ensure_ascii=False,separators=(',',':'))+'\n')
    (dest/'coverage.json').write_text(json.dumps({'officialCodes':len(index),'codesWithArtwork':len({e['code'] for e in result}),'layouts':len(result),'missing':missing,'unmatchedFiles':unknown,'failedLayouts':failures},indent=2)+'\n')
    print('RESULT',len(index),len(result),'MISSING',missing,'UNKNOWN',unknown,flush=True)
if __name__=='__main__':main()
