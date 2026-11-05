const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {test}=require('node:test');
const source=fs.readFileSync('js/signs.js','utf8');
class Node {
 constructor(value){this.value=value;this.children=[];this.parentNode=null;}
 append(child){if(child.parentNode)child.parentNode.children.splice(child.parentNode.children.indexOf(child),1);this.children.push(child);child.parentNode=this;}
}
function harness(){
 const designs=new Map([['stop',{box:[100,100]}]]),artwork=new Map(),sheet={width:1000,height:800};
 const app={engineeringText:{},engineeringGlyphs:{},signArtwork:{},traffic:{reversed:false},settings:{get:()=>100}};
 let draws=0;
 const context={L:{parts:s=>[s,...s.panels??[]]},app,designs,artwork,sheets:{selected:sheet},
  drawOne:(sign,parent)=>{draws++;const node=new Node(JSON.stringify(sign));parent.append(node);return node;}};
 vm.createContext(context);
 vm.runInContext(source.slice(source.indexOf('    const signDrawings='),source.indexOf('    function updateDrawing(')),context);
 return {sheet,app,designs,artwork,draw:(s=sheet)=>{const parent=new Node();context.draw(s,parent);return parent;},draws:()=>draws};
}
test('unchanged callout nodes move between full-render parents without redrawing paths',()=>{
 const H=harness(),s=H.sheet;s.signs=[{id:'a',text:'ROAD'},{id:'b',design:'stop',panels:[{image:{src:'data:image/png;base64,abc',width:30,height:20}}]}];
 const first=H.draw(),nodes=[...first.children],second=H.draw();
 assert.equal(H.draws(),2);assert.deepEqual(second.children,nodes);assert.equal(first.children.length,0);
 s.signs[0].text='NEW ROAD';const third=H.draw();
 assert.equal(H.draws(),3);assert.notEqual(third.children[0],nodes[0]);assert.equal(third.children[1],nodes[1]);
 s.signs.reverse();const reordered=H.draw();
 assert.deepEqual(reordered.children.map(n=>JSON.parse(n.value).id),['b','a']);
 const fresh=H.draw({...s,signs:structuredClone(s.signs)});
 assert.deepEqual(reordered.children.map(n=>n.value),fresh.children.map(n=>n.value));
});
test('late artwork, nested panel assets, catalog dimensions, lettering and global style invalidate callouts',()=>{
 const H=harness(),s=H.sheet;s.signs=[{id:'a',design:'stop',panels:[{design:'future'}]}];
 let previous=H.draw().children[0];
 const check=change=>{change();const next=H.draw().children[0];assert.notEqual(next,previous);previous=next;};
 check(()=>H.artwork.set('stop',[{d:'M0 0 L10 10'}]));
 check(()=>H.designs.set('future',{box:[200,100]}));
 check(()=>{H.app.signArtwork.future={fields:[{key:'speed'}]};});
 check(()=>{H.app.signAlphabets={B:{}};H.artwork.set('future',[{d:'M1 1 L2 2'}]);});
 check(()=>{H.designs.get('future').box[0]=250;});
 check(()=>{H.app.signArtwork.future.fields=[{key:'updated'}];});
 check(()=>{H.app.traffic.reversed=true;});
 check(()=>{s.width=1200;});
 check(()=>{H.app.settings.get=()=>200;});
 check(()=>{s.signs[0].panels[0]={text:'TEXT'};});
 check(()=>{H.app.engineeringText={};});
 check(()=>{s.signs[0].panels[0]={image:{src:'data:image/png;base64,new',width:10,height:20}};});
 check(()=>{s.signs[0].panels[0].image.src='data:image/png;base64,replaced';});
 assert.equal(H.draw().children[0],previous,'unchanged loaded assets reuse the finished drawing');
});
