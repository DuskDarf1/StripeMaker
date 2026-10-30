/* Pure sign design/legend helpers. FHWA sources: assets/signs/SOURCES.md.
   Published artwork IDs remain stable so existing saved sheets still open. */
(() => {
  const app = globalThis.StripeMaker ??= {};
  const sizeName = e => e.size.map(n => n == null ? 'Variable' : n).join(' × ') + ' in';
  const familyKey = e => e.code + '|' + e.variant
    .replace(/\b(?:VAR|\d+(?:\.\d+)?)[x×](?:VAR|\d+(?:\.\d+)?)\b/gi, '')
    .replace(/\b2024\b/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  function families(catalog) {
    const map = new Map();
    for (const entry of catalog) {
      const key = familyKey(entry);
      if (!map.has(key)) map.set(key, { key, entries:[], label:entry.variant.replace(/\b(?:VAR|\d+(?:\.\d+)?)[x×](?:VAR|\d+(?:\.\d+)?)\b/gi, '').replace(/\b2024\b/g, '').replace(/\s+/g,' ').trim() });
      map.get(key).entries.push(entry);
    }
    for (const group of map.values()) group.entries.sort((a,b) => (a.size[0]??0)*(a.size[1]??0)-(b.size[0]??0)*(b.size[1]??0));
    return [...map.values()];
  }
  function transformPath(path, x, y, scale) {
    let coordinate = 0;
    return path.replace(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi, v => (+v*scale+(coordinate++%2 ? y:x)).toFixed(4));
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
    const k=field.height/100, width=cursor*k;
    if (!field.flexWidth && width>field.maxWidth+.02) return {error:'This legend does not fit at the specified letter height. Use a shorter value or a larger sign size.'};
    return {paths:letters.map(({glyph,x})=>({d:transformPath(glyph.d,field.cx-width/2+x*k,field.top,k),fill:field.fill})),width};
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
      if (String(value)===String(field.original ?? field.default)) continue;
      if (validate(value,field,alphabets)) continue;
      field.paths.forEach(i=>removed.add(i));extra.push(...legend(value,{...field,cx:field.cx+widen/2,maxWidth:field.maxWidth+widen},alphabets).paths);
    }
    return [...background.filter((_,i)=>!removed.has(i)),...extra];
  }
  app.signDesigns = { families, familyKey, sizeName, transformPath, legend, validate, expansion, compose };
  if (typeof module!=='undefined') module.exports=app.signDesigns;
})();
