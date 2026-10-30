/* Pure sign design/legend helpers. FHWA sources: assets/signs/SOURCES.md.
   Published artwork IDs remain stable so existing saved sheets still open. */
(() => {
  const app = globalThis.StripeMaker ??= {};
  const sizeName = e => e.size.map(n => n == null ? 'Variable' : n).join(' × ') + ' in';
  // Triangles have three published edge lengths; other panels have two.
  // Keep direction, color, and legend variants, but never a size-only variant.
  const designLabel = e => e.variant
    .replace(/\b(?:VAR|\d+(?:\.\d+)?)(?:\s*[x×]\s*(?:VAR|\d+(?:\.\d+)?)){1,}\b/gi, '')
    .replace(/\b2024\b/g, '').replace(/\s+/g, ' ').trim();
  const routeFamily = e => e.routeFamily || /^M1-(?:1a?|4|5)$/.test(e.code);
  // StripeMaker offers standalone assembly components. Large guide-board and
  // overhead layouts belong in SignMaker (FHWA MUTCD Chapters 2D/2E/2G).
  const standalone = e => {
    if(/overhead/i.test(e.name+' '+e.variant))return false;
    if(/^E\d/.test(e.code))return /^E5-|^E8-(?:1a?|2a|4)$/.test(e.code);
    if(/^D\d/.test(e.code)){
      if(/P$/.test(e.code))return true;
      if(/^D(?:1|2|3|4|10|11|12|13|17)-/.test(e.code))return true;
      if(/^D9-/.test(e.code))return !/^D9-(?:16[b-e]|17a|18[a-c]?)$/.test(e.code);
      return false;
    }
    return true;
  };
  const familyKey = e => routeFamily(e)
    ? `${e.code}|${/independent assembly/i.test(e.variant)?'independent':/guide sign use/i.test(e.variant)?'guide':'route'}`
    : e.code + '|' + designLabel(e).toLowerCase();
  function families(catalog) {
    const map = new Map();
    for (const entry of catalog) {
      const key = familyKey(entry);
      if (!map.has(key)) map.set(key, { key, entries:[], label:designLabel(entry) });
      map.get(key).entries.push(entry);
    }
    for (const group of map.values()) group.entries.sort((a,b) => (a.size[0]??0)*(a.size[1]??0)-(b.size[0]??0)*(b.size[1]??0));
    return [...map.values()];
  }
  function transformPath(path, x, y, scale) {
    let coordinate = 0;
    return path.replace(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi, v => (+v*scale+(coordinate++%2 ? y:x)).toFixed(4));
  }
  const glyphInk=new WeakMap();
  function inkBounds(glyph){
    if(!glyphInk.has(glyph)){
      const coords=glyph.d.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi).map(Number).filter((_,i)=>i%2===0);
      glyphInk.set(glyph,[Math.min(...coords),Math.max(...coords)]);
    }
    return glyphInk.get(glyph);
  }
  function legend(value, field, alphabets) {
    const chars = [...String(value)], alphabet = alphabets[field.series];
    let cursor=0; const letters=[];
    for (const char of chars) {
      if (char===' ') { cursor += 50; continue; }
      const glyph=alphabet?.[char];
      if (!glyph) return {error:'Use the characters available in the standard alphabet.'};
      if (letters.length) cursor += glyph.left;
      letters.push({glyph,x:cursor}); cursor += glyph.width+glyph.right;
    }
    if (letters.length) cursor -= letters.at(-1).glyph.right;
    const k=field.height/100;let width=cursor*k;
    // FHWA M1-1/M1-4 drawings call for numerals optically spaced about the
    // vertical centerline. Tighten spacing, never the numeral outlines/height,
    // when a three-digit legend exceeds the generic alphabet side bearings.
    if(field.key==='route'&&!field.fitWidth&&letters.length>1&&width>field.maxWidth){
      const ink=letters.reduce((sum,item)=>sum+item.glyph.width,0),gap=(field.maxWidth/k-ink)/(letters.length-1);
      if(gap>0){let x=0;for(const item of letters){item.x=x;x+=item.glyph.width+gap;}width=field.maxWidth;}
    }
    if (!field.flexWidth && !field.fitWidth && width>field.maxWidth+.02) return {error:'This legend does not fit at the specified letter height. Use a shorter value or a larger sign size.'};
    let inkLeft=Math.min(...letters.map(({glyph,x})=>x+inkBounds(glyph)[0]));
    let inkRight=Math.max(...letters.map(({glyph,x})=>x+inkBounds(glyph)[1]));
    let horizontal=1;
    if(field.fitWidth && (inkRight-inkLeft)*k>field.maxWidth){
      // Ported from SignMaker v2.2 Control.js fitOfficialRouteInk (GPL-3.0).
      // Keep 8% of cap height between adjacent glyph ink bounds before scaleX.
      // Use our vector glyph metrics in place of its Roadgeek canvas metrics.
      let minimumSpacing=-Infinity;
      for(let i=0;i<letters.length-1;i++){
        const a=letters[i],b=letters[i+1];
        minimumSpacing=Math.max(minimumSpacing,8-(b.x+inkBounds(b.glyph)[0]-a.x-inkBounds(a.glyph)[1]));
      }
      if(letters.length>1){
        const spacing=Math.min(0,Math.max(minimumSpacing,(field.maxWidth/k-(inkRight-inkLeft))/(letters.length-1)));
        letters.forEach((letter,i)=>letter.x+=i*spacing);
        inkLeft=Math.min(...letters.map(({glyph,x})=>x+inkBounds(glyph)[0]));
        inkRight=Math.max(...letters.map(({glyph,x})=>x+inkBounds(glyph)[1]));
      }
      horizontal=Math.min(1,field.maxWidth/((inkRight-inkLeft)*k));
      width=(inkRight-inkLeft)*k;
    }
    const origin=field.cx-(inkLeft+inkRight)*k*horizontal/2;
    return {paths:letters.map(({glyph,x})=>{
      let coordinate=0;
      const d=glyph.d.replace(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi,v=>(coordinate++%2?+v*k+field.top:(+v+x)*k*horizontal+origin).toFixed(4));
      return {d,fill:field.fill};
    }),width:width*horizontal};
  }
  function validate(value, field, alphabets) {
    const text=String(value).trim();
    if (!text) return `${field.label} is required.`;
    if (field.type==='number') {
      const number=Number(text);
      if (!Number.isFinite(number) || number<field.min || number>field.max || Math.abs(number/(field.step??1)-Math.round(number/(field.step??1)))>1e-6)
        return `${field.label}: use ${field.min}–${field.max}${field.step>1 ? ` in steps of ${field.step}`:''}.`;
    }
    if (field.pattern && !new RegExp(field.pattern).test(text)) return field.hint || 'Check the legend format.';
    if(text===String(field.original??field.default)) return '';
    return legend(text,field,alphabets).error ?? '';
  }
  function expansion(fields, values, alphabets) {
    return Math.max(0,...(fields??[]).filter(f=>f.flexWidth).map(f=>{
      const value=values?.[f.key]??f.default;
      if(String(value)===String(f.original??f.default))return 0;
      return Math.max(0,(legend(value,f,alphabets).width??0)-f.maxWidth);
    }));
  }
  function compose(paths, fields, values, alphabets, box) {
    const removed=new Set(), extra=[], widen=expansion(fields,values,alphabets);
    const legendPaths=new Set((fields??[]).flatMap(f=>f.paths));
    const background=paths.map((path,i)=>{
      if(!widen)return path;
      if(legendPaths.has(i))return {...path,d:transformPath(path.d,widen/2,0,1)};
      let coordinate=0;
      return {...path,d:path.d.replace(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi,v=>{
        const x=coordinate++%2===0;return x&&+v>box[0]/2?(+v+widen).toFixed(4):v;
      })};
    });
    for (const field of fields ?? []) {
      const value=values?.[field.key] ?? field.default;
      if (field.key!=='route' && String(value)===String(field.original ?? field.default)) continue;
      if (validate(value,field,alphabets)) continue;
      field.paths.forEach(i=>removed.add(i));extra.push(...legend(value,{...field,cx:field.cx+widen/2,maxWidth:field.maxWidth+widen},alphabets).paths);
    }
    return [...background.filter((_,i)=>!removed.has(i)),...extra];
  }
  app.signDesigns = { standalone, routeFamily, families, familyKey, sizeName, transformPath, legend, validate, expansion, compose };
  if (typeof module!=='undefined') module.exports=app.signDesigns;
})();
