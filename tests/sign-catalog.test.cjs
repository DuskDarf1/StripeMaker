const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname,'..');
const { signs } = JSON.parse(fs.readFileSync(path.join(root,'assets/signs/catalog.json')));
const coverage = JSON.parse(fs.readFileSync(path.join(root,'assets/signs/coverage.json')));
test('every official sign code has local artwork; IDs and variants are unique',()=>{
 assert.equal(coverage.officialCodes,1059);assert.deepEqual(coverage.missing,[]);assert.deepEqual(coverage.unmatchedFiles,[]);
 assert.equal(new Set(signs.map(e=>e.code)).size,coverage.officialCodes);
 assert.equal(new Set(signs.map(e=>e.id)).size,signs.length);assert.equal(signs.length,coverage.layouts);
 assert(signs.some(e=>e.code==='R6-3a' && e.member.endsWith('.pdf')));
 assert(signs.some(e=>e.code==='W16-8P' && e.size.includes(null)));
 for(const entry of signs){
  assert(['Regulatory','Warning and object markers','Temporary traffic control','School','Guide and route signs'].includes(entry.category));
  assert(entry.name && entry.variant && entry.member && entry.source);
  assert(entry.box.every(n=>Number.isFinite(n) && n>0));
  const svg=fs.readFileSync(path.join(root,entry.src),'utf8');
  assert(svg.includes('<path '),entry.id);
  assert(!/<(?:image|text|script|use|foreignObject)\b|\b(?:transform|style|class)=/.test(svg),entry.id);
  for(const [,d] of svg.matchAll(/\bd="([^"]+)"/g))assert(/^[MLZ\d.\s-]+$/.test(d),entry.id);
 }
});
test('official names and directional variants survive import',()=>{
 assert(signs.some(e=>e.code==='R1-1' && e.name==='Stop'));
 assert(signs.some(e=>e.code==='R2-1' && e.name==='Speed Limit'));
 const turns=signs.filter(e=>e.code==='W1-1');
 assert(turns.some(e=>/Left|W1-1L/i.test(e.variant)));
 assert(turns.some(e=>/Right|W1-1R/i.test(e.variant)));
 assert(signs.some(e=>e.category==='School'));

});

test('route markers and D/E guide signs are included',()=>{
 for(const code of ['M1-1','M1-1a','M1-4','M1-5','M1-6','M3-1P','M6-1P','D1-1','D3-1','E1-1']) assert(signs.some(e=>e.code===code),code);
});
test('every built-in face uses the shared FHWA artwork palette, without cyan construction marks',()=>{
 const palette=require('../assets/signs/palette.json');const allowed=new Set([...Object.values(palette.colors),'none']);
 for(const e of signs){
  const svg=fs.readFileSync(path.join(root,e.src),'utf8');
  for(const [,color] of svg.matchAll(/(?:fill|stroke)="([^"]+)"/g))assert(allowed.has(color),`${e.id}: ${color}`);
 }
});
