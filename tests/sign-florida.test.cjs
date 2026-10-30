const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
global.window=global;
const D=require('../js/sign-designs.js');require('../assets/signs/lettering.js');
const entries=require('../assets/signs/florida.json').signs;
for(const code of new Set(entries.map(e=>e.code)))require('../assets/signs/data/'+code+'.js');
test('Florida shields have one selector entry per standalone design',()=>{
 assert.equal(D.families(entries).length,5);
 assert(entries.every(D.standalone));
 assert.deepEqual(entries.filter(e=>e.code==='FTP-612-25').map(e=>e.digits),[2,3,4]);
 for(const e of entries)assert(fs.existsSync(require('node:path').resolve(__dirname,'..',e.src)));
});
test('Florida route fields accept every supported digit count at specified letter heights',()=>{
 for(const e of entries){
  const art=StripeMaker.signArtwork[e.id];
  for(const f of art.fields){
   const numbers=e.digits===4?['1000','4444','5054','9999']:e.digits===2?['1','44','99']:['1','23','408','444','999'];
   for(const n of numbers){assert.equal(D.validate(n,f,StripeMaker.signAlphabets),'',e.id+' '+n);assert(!D.legend(n,f,StripeMaker.signAlphabets).error,e.id+' '+n);}
   assert(D.validate(String(f.max+1),f,StripeMaker.signAlphabets));
  }
  assert(art.paths.every(p=>!/[CQAHV]/i.test(p.d)),e.id+' uses exportable vector paths');
 }
});

test('wide CFX numerals fit inside the clear area without reducing their height',()=>{
 const f=StripeMaker.signArtwork['CFX-TM--standard'].fields[0];
 const paths=D.legend('444',f,StripeMaker.signAlphabets).paths;
 const xs=paths.flatMap(p=>p.d.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi).map(Number).filter((_,i)=>i%2===0));
 assert(Math.max(...xs)-Math.min(...xs)<=f.maxWidth+.001);
 assert(Math.abs((Math.max(...xs)+Math.min(...xs))/2-f.cx)<.001);
});

test('CFX port reserves SignMaker’s 8% ink gap before horizontal compression for all route numbers',()=>{
 const f=StripeMaker.signArtwork['CFX-TM--standard'].fields[0],alphabet=StripeMaker.signAlphabets[f.series];
 const bounds=d=>{const xs=d.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi).map(Number).filter((_,i)=>i%2===0);return [Math.min(...xs),Math.max(...xs)];};
 assert.equal(f.maxWidth,22.84*100/48);
 for(let number=1;number<=999;number++){
  const text=String(number),paths=D.legend(text,f,StripeMaker.signAlphabets).paths,boxes=paths.map(p=>bounds(p.d));
  const original=bounds(alphabet[text[0]].d),scale=(boxes[0][1]-boxes[0][0])/((original[1]-original[0])*f.height/100);
  assert(boxes.at(-1)[1]-boxes[0][0]<=f.maxWidth+.001,text+' fits');
  for(let i=1;i<boxes.length;i++)assert(boxes[i][0]-boxes[i-1][1]>=.08*f.height*scale-.001,text+' separated ink');
 }
});
test('FDOT uses the latest dimensioned independent route-marker artwork and Series D numerals',()=>{
 const entry=entries.find(e=>e.code==='FTP-611-25'),art=StripeMaker.signArtwork[entry.id],f=art.fields[0];
 assert(entry.source.includes('FY 2027–28'));
 assert.deepEqual(entry.size,[24,30]);assert.equal(f.series,'D');assert.equal(f.height,20);assert.equal(f.top,160/3);
 assert.equal(art.paths.length,9);
});
