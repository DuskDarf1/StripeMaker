"""Flatten the bundled GPL-3-with-font-exception osifont into exportable M/L/Z outlines.
No third-party dependency. Source and license: fonts/osifont.ttf, fonts/osifont.LICENSE.
"""
import struct,json,math
from pathlib import Path
root=Path(__file__).resolve().parents[1];data=(root/'fonts/osifont.ttf').read_bytes()
def u(o):return struct.unpack_from('>H',data,o)[0]
def h(o):return struct.unpack_from('>h',data,o)[0]
def U(o):return struct.unpack_from('>I',data,o)[0]
tables={data[o:o+4].decode():U(o+8) for o in range(12,12+u(4)*16,16)}
head=tables['head'];units=u(head+18);count=u(tables['maxp']+4);loc=tables['loca'];long=h(head+50)
off=[U(loc+4*i) if long else u(loc+2*i)*2 for i in range(count+1)]
metrics=u(tables['hhea']+34);adv=[u(tables['hmtx']+4*min(i,metrics-1)) for i in range(count)]
cmap=tables['cmap'];mapping={}
for i in range(u(cmap+2)):
 at=cmap+4+i*8;sub=cmap+U(at+4)
 if u(sub)!=4:continue
 n=u(sub+6)//2;ends=sub+14;starts=ends+2*n+2;deltas=starts+2*n;ranges=deltas+2*n
 for j in range(n):
  for c in range(u(starts+2*j),u(ends+2*j)+1):
   if c==65535:continue
   ro=u(ranges+2*j);g=u(ranges+2*j+ro+2*(c-u(starts+2*j))) if ro else c
   if g:g=(g+h(deltas+2*j))%65536
   if g<count:mapping[c]=g
cache={}
def contours(g,depth=0):
 if g in cache:return cache[g]
 if depth>12 or off[g]==off[g+1]:return []
 pos=tables['glyf']+off[g];n=h(pos);p=pos+10;out=[]
 if n>=0:
  ends=[u(p+2*i) for i in range(n)];p+=2*n;ins=u(p);p+=2+ins;total=ends[-1]+1 if ends else 0;flags=[]
  while len(flags)<total:
   f=data[p];p+=1;flags.append(f)
   if f&8:flags.extend([f]*data[p]);p+=1
  coords=[]
  for short,same in [(2,16),(4,32)]:
   vals=[];v=0
   for f in flags:
    if f&short:delta=data[p]*(1 if f&same else -1);p+=1
    elif f&same:delta=0
    else:delta=h(p);p+=2
    v+=delta;vals.append(v)
   coords.append(vals)
  start=0
  for end in ends:out.append([(coords[0][i],coords[1][i],bool(flags[i]&1)) for i in range(start,end+1)]);start=end+1
 else:
  while True:
   flags=u(p);child=u(p+2);p+=4
   if flags&1:a,b=h(p),h(p+2);p+=4
   else:a,b=struct.unpack_from('>bb',data,p);p+=2
   if not flags&2:raise ValueError('Unsupported point-matched composite')
   xx=yy=1;xy=yx=0
   if flags&8:xx=yy=h(p)/16384;p+=2
   elif flags&64:xx=h(p)/16384;yy=h(p+2)/16384;p+=4
   elif flags&128:xx=h(p)/16384;xy=h(p+2)/16384;yx=h(p+4)/16384;yy=h(p+6)/16384;p+=8
   out += [[(xx*x+xy*y+a,yx*x+yy*y+b,on) for x,y,on in contour] for contour in contours(child,depth+1)]
   if not flags&32:break
 cache[g]=out;return out
def flatten(contour):
 pts=[]
 for i,a in enumerate(contour):
  pts.append(a);b=contour[(i+1)%len(contour)]
  if not a[2] and not b[2]:pts.append(((a[0]+b[0])/2,(a[1]+b[1])/2,True))
 start=next((i for i,p in enumerate(pts) if p[2]),None)
 if start is None:return []
 pts=pts[start:]+pts[:start];result=[pts[0][:2]];i=1
 while i<=len(pts):
  p=pts[i%len(pts)]
  if p[2]:result.append(p[:2]);i+=1
  else:
   a=result[-1];b=pts[(i+1)%len(pts)];steps=max(4,math.ceil((math.dist(a,p[:2])+math.dist(p[:2],b[:2]))/35))
   for k in range(1,steps+1):
    t=k/steps;result.append(((1-t)**2*a[0]+2*t*(1-t)*p[0]+t*t*b[0],(1-t)**2*a[1]+2*t*(1-t)*p[1]+t*t*b[1]))
   i+=2
 return [[round(x,2),round(-y,2)] for x,y in result]
glyphs={str(c):{'advance':adv[g],'contours':[flatten(p) for p in contours(g)]} for c,g in mapping.items() if c>=32}
out='/* Generated from osifont.ttf; GPL-3.0 with font exception. See osifont.LICENSE.\n   Rebuild: python3 scripts/build-engineering-font.py */\n(window.StripeMaker??={}).engineeringGlyphs='+json.dumps({'units':units,'glyphs':glyphs},separators=(',',':'))+';\n'
(root/'fonts/osifont-outlines.js').write_text(out)
print(len(glyphs),'glyphs;',len(out),'bytes')
