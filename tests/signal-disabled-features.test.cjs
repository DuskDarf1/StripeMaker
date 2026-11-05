const {test}=require('node:test'),assert=require('node:assert/strict'),M=require('../js/simulator-signals.js');
test('pedestrian omission preserves saved settings and removes calls, timing, and validation effects',()=>{
 assert.equal(M.features.pedestrians,false);
 for(const mode of ['actuated','fixed','coordinated']){
  const c=M.normalize();c.mode=mode;c.coordination.cycle=12;
  for(const p of c.phases)Object.assign(p,{enabled:[1,3,5,7].includes(p.id),minGreen:1,maxGreen:2,yellow:1,red:1,split:6,recall:'min',pedRecall:true,pedMode:'rest',pedLead:20,pedBuffer:30,walk:90,pedClear:90,pedExclusive:p.id===1});
  c.peds=[{id:'ped',marking:'walk',end:0,phase:1}];const saved=JSON.stringify(c);
  assert.deepEqual(M.validate(c),[]);const ctl=new M.Controller(c);assert.deepEqual(ctl.errors,[]);
  ctl.requestPed(1);assert.equal(ctl.pedCalls.size,0);
  const served=new Set();for(let t=0;t<300;t++){ctl.step(.1);for(const p of c.phases){if(ctl.aspect(p.id)==='green')served.add(p.id);assert.equal(ctl.pedestrian(p.id),'hand');}assert(ctl.rings.every(r=>!r.ped));}
  assert.deepEqual([...served].sort(),[1,3,5,7],mode);assert.equal(JSON.stringify(c),saved);assert.equal(JSON.stringify(M.normalize(c)),saved);
 }
});
test('disabled pedestrian recall cannot call an otherwise idle phase',()=>{
 const c=M.normalize();for(const p of c.phases)Object.assign(p,{recall:'none',pedRecall:true});
 const ctl=new M.Controller(c);ctl.requestPed(1);for(let i=0;i<100;i++)ctl.step(.1);
 assert(ctl.rings.every(r=>r.state==='red'));assert.equal(ctl.pedCalls.size,0);
});
test('disabled pedestrian leads and exclusive settings do not break continuous greens',()=>{
 const c=M.normalize();c.mode='fixed';for(const p of c.phases)Object.assign(p,{enabled:[1,2,3].includes(p.id),minGreen:1,yellow:1,red:1,split:4,pedLead:40,pedExclusive:true,pedRecall:true});
 M.setPhaseMode(c,'in>out',1,'green');M.setPhaseMode(c,'in>out',2,'green');const ctl=new M.Controller(c);let carried=false;
 for(let t=0;t<75;t++){ctl.step(.1);if(ctl.rings[0].continuation){carried=true;assert.equal(M.indication(ctl,ctl.config.assignments['in>out']),'green');}}
 assert(carried);
});
