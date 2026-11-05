const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
function load(saved={}) {
 let persisted;const context={window:{},document:{addEventListener(){},dispatchEvent(){}},CustomEvent:class{},localStorage:{getItem:()=>JSON.stringify(saved),setItem:(_,value)=>persisted=JSON.parse(value)}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../js/settings.js'),'utf8'),context);
 return {settings:context.window.StripeMaker.settings,persisted:()=>persisted};
}
const names=s=>Array.from(s.get('simulationOverlays'));
test('overlay settings migrate old preferences and persist independent selections',()=>{
 const {settings:s,persisted}=load({simulationOverlay:'density'});assert.deepEqual(names(s),['density']);s.set('simulationOverlays',['density','speed']);assert.deepEqual(names(s),['density','speed']);
 assert.deepEqual(names(load(persisted()).settings),['density','speed']);s.set('simulationOverlays',['speed']);assert.deepEqual(names(s),['speed']);
 s.set('simulationOverlay','none');assert.deepEqual(names(s),[]);s.set('simulationOverlay','density');assert.deepEqual(names(s),['density']);
});
test('overlay values reject unknown selections, remove duplicates, and cannot mutate settings by reference',()=>{
 const {settings:s}=load({simulationOverlays:['speed']});s.set('simulationOverlays',['density','unexpected']);assert.deepEqual(names(s),['speed']);s.set('simulationOverlays',['speed','speed','density']);assert.deepEqual(names(s),['speed','density']);
 s.get('simulationOverlays').pop();s.snapshot().simulationOverlays.pop();assert.deepEqual(names(s),['speed','density']);
});
