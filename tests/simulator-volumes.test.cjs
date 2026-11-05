const {test}=require('node:test'),assert=require('node:assert/strict');
const V=require('../js/simulator-volumes.js');
test('seconds, minutes, hours, days and AADT express the same demand without rounding',()=>{
 for(const unit of Object.keys(V.units)){
  const volume={amount:V.amount(.125,unit),unit};assert(V.valid(volume));assert.equal(V.perMinute(volume),.125);
  assert(V.valid({amount:V.amount(600,unit),unit}));assert(!V.valid({amount:V.amount(601,unit),unit}));
 }
 assert.equal(V.perMinute({amount:1440,unit:'AADT'}),1);
 for(const volume of [null,{},[],{amount:-1,unit:'hours'},{amount:Infinity,unit:'days'},{amount:2,unit:'year'}])assert(!V.valid(volume));
});
test('demand mode conversions preserve existing output and route shares',()=>{
 const s={rate:12,rateUnit:'hours',routes:[{percent:75},{percent:25}]};
 V.setMode(s,'total');assert.deepEqual(s.routes.map(r=>r.volume),[{amount:540,unit:'hours'},{amount:180,unit:'hours'}]);assert.equal(V.rate(s),12);
 s.routes[0].volume={amount:720,unit:'hours'};V.sync(s);assert.equal(V.rate(s),15);assert.deepEqual(V.shares(s).map(r=>r.percent),[80,20]);
 V.setMode(s,'weights');s.routes[1].volume={amount:17280,unit:'AADT'};V.sync(s);assert.equal(V.rate(s),15);assert.deepEqual(V.shares(s).map(r=>r.percent),[50,50]);
 V.setMode(s,'percent');assert.equal(V.rate(s),15);assert.deepEqual(s.routes.map(r=>r.percent),[50,50]);
 s.routes[0].percent=20;s.routes[1].percent=80;V.setMode(s,'total');assert.deepEqual(s.routes.map(r=>V.perMinute(r.volume)),[3,12],'re-entering volume mode uses current percentages');
});
test('empty entrances, legacy rates and zero destination volumes are defined',()=>{
 const s={};V.setMode(s,'weights');assert.equal(V.rate(s),12);assert.deepEqual(V.shares(s),[]);V.setMode(s,'total');assert.equal(V.rate(s),0);
 assert.equal(V.rate({outputs:{0:12,1:6}}),18);
 const zero={rate:20,routeVolumeMode:'weights',routes:[{volume:{amount:0,unit:'hours'}},{volume:{amount:0,unit:'AADT'}}]};
 assert.deepEqual(V.shares(zero).map(r=>r.percent),[0,0],'zero demand never silently becomes equal demand');
 V.setMode(zero,'total');assert.equal(V.rate(zero),0);
});
