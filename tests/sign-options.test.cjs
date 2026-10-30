const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const D=require('../js/sign-designs.js');
const {signs}=require('../assets/signs/catalog.json');
const alphabets=require('../assets/signs/alphabets.json');
function art(code){const context={window:{StripeMaker:{}}};vm.runInNewContext(fs.readFileSync(require.resolve(`../assets/signs/data/${code}.js`),'utf8'),context);return context.window.StripeMaker.signArtwork;}
test('size variants collapse but direction variants remain distinct',()=>{
 assert.equal(D.families(signs.filter(e=>e.code==='R2-1')).length,1);
 assert.equal(D.families(signs.filter(e=>e.code==='W1-1')).length,2);
});
test('speed legends use published Series E numeral heights and five mph increments',()=>{
 const heights={18:8,24:10,30:12,36:14,48:16};
 for(const e of signs.filter(e=>e.code==='R2-1')){
 const a=art(e.code)[e.id],f=a.fields[0];
 assert.equal(f.series,'E');assert(Math.abs(f.height*e.size[0]/e.box[0]-heights[e.size[0]])<.001);
 assert.equal(D.validate('35',f,alphabets),'');assert(D.validate('37',f,alphabets));
 const result=D.compose(a.paths,a.fields,{speed:'35'},alphabets,e.box);
 assert(result.length);assert(result.every(p=>/^[MLZ\d.\s-]+$/.test(p.d)));
 }
});
test('variable-width street signs grow instead of squeezing lettering',()=>{
 const e=signs.find(e=>e.code==='W16-8P'),a=art(e.code)[e.id];
 const f=a.fields[0],values={[f.key]:'University Avenue'};
 assert.equal(D.validate(values[f.key],f,alphabets),'');assert(D.expansion(a.fields,values,alphabets)>0);
});
test('all configured parameter layouts were extracted without errors',()=>{
 const coverage=require('../assets/signs/options-coverage.json');
 assert.deepEqual(coverage.errors,[]);assert(coverage.codes>=54);assert(coverage.layouts>=161);
});

test('triangular sign sizes collapse and no catalog family retains dimensions',()=>{
 for(const code of ['R1-2','W14-3']) assert.equal(D.families(signs.filter(e=>e.code===code)).length,1,code);
 for(const group of D.families(signs)) assert(!/\b(?:VAR|\d+(?:\.\d+)?)\s*[x×]\s*(?:VAR|\d)/i.test(group.label),group.label);
});

test('standalone selector excludes overhead and guide-board D/E layouts',()=>{
 for(const code of ['E1-1','E4-1','E6-1','E8-2','E11-1','D15-1','D9-18']) assert(!D.standalone(signs.find(e=>e.code===code)),code);
 for(const code of ['E5-1','E8-2a','D1-1','D3-1','D9-1','D11-1']) assert(D.standalone(signs.find(e=>e.code===code)),code);
});
test('route-number digit counts are one design family per shield style',()=>{
 assert.equal(D.families(signs.filter(e=>e.code==='M1-1')).length,1);
 assert.equal(D.families(signs.filter(e=>e.code==='M1-4')).length,2);
 for(const code of ['M1-1','M1-1a','M1-4','M1-5'])for(const group of D.families(signs.filter(e=>e.code===code)))assert(group.entries.some(e=>/3 digits/.test(e.variant)),group.key);
});
test('three-digit route legends fit without shrinking published numeral heights',()=>{
 for(const code of ['M1-1','M1-4']){
  const entries=signs.filter(e=>e.code===code&&/3 digits/.test(e.variant));
  const artwork=art(code);
  for(const e of entries){
   const field=artwork[e.id].fields.find(f=>f.key==='route');
   for(const number of ['100','395','888','999']){
    assert.equal(D.validate(number,field,alphabets),'',`${e.variant}: ${number}`);
    assert(D.legend(number,field,alphabets).width<=field.maxWidth+.02);
   }
  }
 }
});
test('route numeral outlines center on the shield centerline for every digit count',()=>{
 for(const code of ['M1-1','M1-1a','M1-4','M1-5','M1-6']){
  const artwork=art(code);
  for(const e of signs.filter(e=>e.code===code)){
   const field=artwork[e.id].fields.find(f=>f.key==='route');
   assert(Math.abs(field.cx-e.box[0]/2)<.0001,e.variant);
   for(const number of ['1','11','20','95',...(field.max>99?['101','395','888']:[])]){
    if(D.validate(number,field,alphabets))continue;
    const paths=D.legend(number,field,alphabets).paths;
    const xs=paths.flatMap(p=>p.d.match(/-?\d*\.?\d+/g).map(Number).filter((_,i)=>i%2===0));
    assert(Math.abs((Math.min(...xs)+Math.max(...xs))/2-e.box[0]/2)<.001,`${e.variant}: ${number}`);
   }
  }
 }
});
