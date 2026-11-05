/* osifont engineering lettering, GPL-3.0 with font exception (fonts/osifont.LICENSE).
   Vector M/L/Z outlines keep sheet annotations sharp in both PNG and PDF exports. */
(() => {
 const A=window.StripeMaker??={},cache=new Map();
 function layout(text){
  text=String(text??'').slice(0,2000);if(cache.has(text))return cache.get(text);
  const f=A.engineeringGlyphs,lines=text.split('\n'),polys=[];let y=0;
  for(const line of lines){let x=0;for(const char of line){const g=f.glyphs[char.codePointAt(0)]??f.glyphs[63];if(!g)continue;
   for(const contour of g.contours)if(contour.length)polys.push(contour.map(([a,b])=>({x:x+a-b*.21256,y:y+b})));
   x+=g.advance;
  }y+=f.units*1.25;}
  let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;
  for(const poly of polys)for(const p of poly){left=Math.min(left,p.x);top=Math.min(top,p.y);right=Math.max(right,p.x);bottom=Math.max(bottom,p.y);}
  if(!Number.isFinite(left)){left=top=0;right=f.units/2;bottom=f.units;}
  const width=Math.max(1,right-left),height=Math.max(1,bottom-top);
  const paths=polys.map(poly=>'M'+poly.map(p=>`${+(p.x-left).toFixed(3)} ${+(p.y-top).toFixed(3)}`).join(' L')+' Z').join(' ');
  const result={width,height,paths};if(cache.size>100)cache.clear();cache.set(text,result);return result;
 }
 function paths(text){const l=layout(text);return [{d:`M0 0 L${l.width} 0 L${l.width} ${l.height} L0 ${l.height} Z`,fill:'#ffffff'},{d:l.paths,fill:'#000000','fill-rule':'nonzero'}];}
 A.engineeringText={layout,paths};
})();
