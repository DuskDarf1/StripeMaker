const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname,'..');
const { signs } = JSON.parse(fs.readFileSync(path.join(root,'assets/signs/catalog.json')));
const coverage = JSON.parse(fs.readFileSync(path.join(root,'assets/signs/coverage.json')));
test('every official non-guide code has local artwork; IDs and variants are unique',()=>{
 assert.equal(coverage.officialCodes,739);assert.deepEqual(coverage.missing,[]);assert.deepEqual(coverage.unmatchedFiles,[]);
 assert.equal(new Set(signs.map(e=>e.code)).size,coverage.officialCodes);
 assert.equal(new Set(signs.map(e=>e.id)).size,signs.length);assert.equal(signs.length,coverage.layouts);
 assert(signs.some(e=>e.code==='R6-3a' && e.member.endsWith('.pdf')));
 assert(signs.some(e=>e.code==='W16-8P' && e.size.includes(null)));
 for(const entry of signs){
  assert(['Regulatory','Warning and object markers','Temporary traffic control','School'].includes(entry.category));
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
 assert(!signs.some(e=>/^D\d|^E\d|^I\d/.test(e.code)));
});
