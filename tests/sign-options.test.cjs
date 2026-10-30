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
