/* Indication/layout editor adapted from SignalMaker's head-editor.js and
   index.html under GPL-3.0. Uses its model, symbol picker and fieldset layout. */
(() => {
  const A=window.StripeMaker??={},H=window.StripeMakerSignalAssets;
  // Temporarily disabled. Keep saved equipment and its editor implementation
  // intact; flip this development flag to restore mast/head editing later.
  A.signalFeatures??={mastHeads:false};
  let panel,content,closeAction;
  const el=(tag,text,parent,cls)=>{const e=document.createElement(tag);if(text!=null)e.textContent=text;if(cls)e.className=cls;parent?.append(e);return e;};
  function ensure(){if(panel)return;panel=el('section',null,document.body,'editor');panel.id='signalHeadEditor';panel.hidden=true;panel.setAttribute('aria-labelledby','signalHeadTitle');
    const bar=el('div',null,panel,'editorBar');el('h2','Head Editor',bar,'editorTitle').id='signalHeadTitle';const close=el('button','×',bar);close.type='button';close.setAttribute('aria-label','Close head editor');close.onclick=()=>closeAction?.();
    content=el('div',null,panel,'editorContent');panel.addEventListener('keydown',e=>{if(e.key==='Escape'&&!document.querySelector('.symbolPickerMenu.open')){e.preventDefault();e.stopPropagation();closeAction?.();}});
  }
  function render({head,design,disabled,onChange,onClose}){
    if(!A.signalFeatures.mastHeads){hide();return;}
    ensure();closeAction=onClose;const focus=panel.contains(document.activeElement)?document.activeElement.id:null,scroll=content.scrollTop;panel.hidden=false;document.body.classList.add('signalHeadEditorOpen');content.replaceChildren();
    const change=fn=>{fn();onChange(design);};
    const button=(parent,label,fn,title=label)=>{const b=el('button',label,parent);b.type='button';b.disabled=disabled;b.title=title;b.onclick=fn;return b;};
    function select(parent,id,label,value,choices,set){const row=el('div',null,parent,'fieldRow');el('label',label,row).htmlFor=id;const input=el('select',null,row);input.id=id;input.title=label;input.disabled=disabled;for(const [v,text] of choices)input.add(new Option(text,v));input.value=value;input.onchange=()=>change(()=>set(input.value));return input;}
    function choices(label,value,values,set,locked=false){const row=el('div',null,content,'fieldRow'),title=el('span',label,row,'fieldLabel');title.id='signal-head-'+label.toLowerCase();const group=el('div',null,row,'headChoiceButtons');group.setAttribute('role','group');group.setAttribute('aria-labelledby',title.id);
      for(const [v,text] of values){const b=button(group,text,()=>change(()=>set(v)));b.setAttribute('aria-pressed',String(value===v));b.classList.toggle('selected',value===v);b.disabled ||= locked;}}
    const model={...H.createHead('Signal'),...structuredClone(design)},layout=design.dad?'dad':design.hawk?'hawk':design.fourCluster?'cluster-'+design.fourCluster:design.cluster?'cluster':'linear';
    const preview=el('div',null,content,'signalHeadDesignPreview'),geometry=H.headGeometry(model);for(const lamp of model.indications){lamp.lit=true;if(lamp.symbol==='up')lamp.symbol='ball';}
    preview.innerHTML=`<svg viewBox="-2 -2 ${geometry.width+4} ${geometry.height+4}" role="img" aria-label="Head layout preview, all indications illuminated">${H.headMarkup(model,geometry)}</svg>`;
    el('p','Edit the indications and their layout. The phase grid controls when they light. Drag the head to a movement line to link it; Shift-drag adds a shared movement.',content,'fieldHint');
    choices('Orientation',design.orientation,[['vertical','Vertical'],['horizontal','Horizontal']],v=>design.orientation=v,layout!=='linear');
    choices('Layout',layout,[['linear','Linear'],['cluster','Doghouse'],['cluster-below','4 section cluster below'],['cluster-above','4 section cluster above'],['dad','DAD'],['hawk','HAWK']],v=>{const next={...H.createHead('Signal'),...design};H.setHeadLayout(next,v);Object.assign(design,pickDesign(next));});
    const heading=el('div',null,content,'indicationHeading');el('h3','Indications',heading);const fixed=layout!=='linear',special=design.hawk||design.dad;
    const add=button(heading,'Add Indication',()=>change(()=>design.indications.push(H.createIndication('green'))),'Add an indication, up to five in a linear head.');add.id='signalAddIndication';add.disabled ||= fixed||design.indications.length>=5;
    const positions=design.fourCluster==='below'?['Top','Middle','Bottom left','Bottom right']:design.fourCluster==='above'?['Top left','Top right','Middle','Bottom']:design.dad?['Top','Bottom left','Bottom right']:design.hawk?['Upper left','Upper right','Bottom']:['Top','Upper left','Upper right','Lower left','Lower right'];
    const list=el('div',null,content);list.id='signalIndicationList';
    function reorder(from,to){if(from===to||to<0||to>=design.indications.length)return;change(()=>{const [lamp]=design.indications.splice(from,1);design.indications.splice(to,0,lamp);});}
    for(const [index,lamp] of design.indications.entries()){
      const block=el('fieldset',null,list,'aplArrowEditorBlock');block.dataset.indicationId=lamp.id;block.dataset.index=index;el('legend',`Indication ${index+1}${fixed?' - '+positions[index]:''}`,block);
      const row=el('div',null,block,'aplArrowListItem'),move=button(row,'Move',()=>{},'Drag to reorder; arrow keys also move this indication.');move.className='aplArrowDragHandle';move.id='signal-lens-move-'+lamp.id;move.setAttribute('aria-label',`Move indication ${index+1}`);move.setAttribute('aria-keyshortcuts','ArrowUp ArrowDown');move.disabled ||= special;
      move.onkeydown=e=>{if(['ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();reorder(index,index+(e.key==='ArrowUp'?-1:1));}};
      let moving=null;move.onpointerdown=e=>{if(e.button!==0||move.disabled)return;e.preventDefault();moving={id:e.pointerId,index,y:e.clientY};move.setPointerCapture(e.pointerId);};
      move.onpointermove=e=>{if(!moving)return;const target=document.elementFromPoint(e.clientX,e.clientY)?.closest('[data-indication-id]');list.querySelectorAll('.dropBefore,.dropAfter').forEach(e=>e.classList.remove('dropBefore','dropAfter'));if(target&&list.contains(target))target.classList.add(Number(target.dataset.index)>index?'dropAfter':'dropBefore');};
      move.onpointerup=e=>{if(!moving)return;const target=document.elementFromPoint(e.clientX,e.clientY)?.closest('[data-indication-id]');moving=null;list.querySelectorAll('.dropBefore,.dropAfter').forEach(e=>e.classList.remove('dropBefore','dropAfter'));if(target&&list.contains(target))reorder(index,Number(target.dataset.index));};move.onpointercancel=()=>{moving=null;list.querySelectorAll('.dropBefore,.dropAfter').forEach(e=>e.classList.remove('dropBefore','dropAfter'));};
      const symbol=select(row,'signal-lens-symbol-'+lamp.id,`Indication ${index+1} symbol`,lamp.symbol==='up'?'ball':lamp.symbol,Object.entries(H.symbols).filter(([value])=>value!=='up'),value=>H.setIndicationSymbol(lamp,value));symbol.parentElement.classList.add('signalLensInline');symbol.disabled ||= special;
      symbol.pickerIconForValue=value=>`<svg class="signalIndicationIcon" viewBox="-8 -8 16 16" aria-hidden="true">${H.symbol({size:12,color:lamp.color,symbol:value,lit:true},0,0)}</svg>`;
      const size=select(row,'signal-lens-size-'+lamp.id,`Indication ${index+1} lens size`,lamp.size,[[8,'8 in'],[12,'12 in']],v=>lamp.size=Number(v));size.parentElement.classList.add('signalLensInline');
      const remove=button(row,'Delete',()=>change(()=>design.indications.splice(index,1)),`Delete indication ${index+1}`);remove.className='aplArrowDeleteButton';remove.setAttribute('aria-label',`Delete indication ${index+1}`);remove.disabled ||= fixed||design.indications.length===1;
      const color=select(block,'signal-lens-color-'+lamp.id,'Color:',lamp.color,Object.entries(H.indicationColors(lamp.symbol)),v=>lamp.color=v);color.setAttribute('aria-label',`Indication ${index+1} color`);color.disabled ||= special;
      const service=select(block,'signal-lens-service-'+lamp.id,'Display during:',lamp.service??'auto',[['auto','Automatic by color'],['red','Steady red'],['yellow','Yellow clearance'],['green','Green'],['permissive','Flashing yellow / yield'],['flash-red','Flashing red'],['flash-yellow','Flashing yellow operation'],['off','Unlit']],v=>lamp.service=v);service.title='Choose which movement indication illuminates this lens. Automatic uses its color (white bus symbols follow stop/go); repeated yellow lenses separate steady clearance from flashing yellow. This does not change vehicle permissions.';
      const source=select(block,'signal-lens-source-'+lamp.id,'Movement source:',lamp.source??'auto',[['auto','Automatic'],['main','Head movement'],['circular','Circular movement']],v=>lamp.source=v);source.title='Automatic uses the circular movement for circular lenses when linked; other lenses follow the head movement. Assign sources in the signal panel or drag the head to a movement.';
    }
    content.scrollTop=scroll;if(focus)queueMicrotask(()=>document.getElementById(focus)?.focus({preventScroll:true}));
  }
  function pickDesign(head){return {orientation:head.orientation,cluster:!!head.cluster,fourCluster:head.fourCluster??null,dad:!!head.dad,hawk:!!head.hawk,indications:head.indications.map(({lit,...lamp})=>lamp)};}
  function hide(){if(panel)panel.hidden=true;document.body.classList.remove('signalHeadEditorOpen');}
  A.signalHeadEditor={render,hide,pickDesign};
})();
