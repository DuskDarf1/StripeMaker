/* Signs editor and thumbnail selector, adapted from SignalMaker's regulatory
   sign picker (GPL-3.0). Artwork and names: FHWA 2024 Standard Highway Signs;
   see assets/signs/SOURCES.md. Callout sizes are schematic, not installation
   dimensions. Stored coordinates are sheet pixels and don't require scale. */
(() => {
  const SVG = 'http://www.w3.org/2000/svg';
  const assetBase = new URL('../', document.currentScript.src);
  document.addEventListener('DOMContentLoaded', () => {
    const app = window.StripeMaker, sheets = app.sheets, D = app.signDesigns, L = app.signLayout;
    const get = id => document.getElementById(id);
    const panel = get('signsEditor'), picker = get('signPicker'), grid = get('signGrid');
    const workspace = get('workspace'), overlay = document.createElement('div');
    overlay.className = 'signOverlay'; sheets.addOverlay(overlay);
    const designs = new Map(), artwork = new Map(), requests = new Map(), scripts = new Map();
    const invalidFields = new Set();
    let groups = [], choiceValues = {}, choiceSize = 100, fieldsFor = null;
    let catalog = [], loading, selected = null, selectedSheet = null, choice = null;
    let choiceImage=null, choicePanels=[], choiceRotation=0, choicePanelScale=100, partIndex=0, appendPanel=false, pasteRequest=0, candidate=null, assemblyDrag=null, suppressAssemblyClick=false;
    let placement = null, dragging = null, choosingFor = null;
    const current = () => sheets.selected?.signs?.find(s => s.id === selected);
    const part = () => current() ? L.parts(current())[partIndex] ?? current() : null;
    const entryFor = sign => sign?.image ? { id:'image', code:'Image', name:sign.image.name??'Pasted image', box:[sign.image.width,sign.image.height], src:sign.image.src } : designs.get(sign?.design);
    const draft = () => ({design:choice,image:choiceImage,panels:choicePanels,values:choiceValues,size:choiceSize,scale:choicePanelScale,rotation:choiceRotation});
    const assemblyPanel=get('signAssemblyEditor');
    const active = () => !panel.hidden || !assemblyPanel.hidden;
    const tell = text => { get('signStatus').textContent = text; get('assemblyStatus').textContent=text; };
    const normalize = text => text.toLowerCase().replace(/\bpeds\b/g, 'pedestrians').replace(/([a-z]|-)0+(?=\d)/g, '$1').replace(/[^a-z0-9]+/g, ' ').trim();
    const label = entry => entry.code==='Image' ? entry.name : `${entry.code} — ${entry.name}`;
    const svg = (tag, attrs, parent) => {
      const node = document.createElementNS(SVG, tag);
      for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
      parent.append(node); return node;
    };
    // Classic local scripts work from file:// too; fetch(file://…) is blocked
    // by browsers. Only bundled generated data is loaded, never remote code.
    async function loadScript(path) {
      if (scripts.has(path)) return scripts.get(path);
      const request = new Promise((resolve,reject) => {
        const script=document.createElement('script');
        script.src=new URL(path,assetBase).href;
        const timer=setTimeout(()=>finish(new Error(`Loading timed out: ${path}`)),15000);
        const finish=error=>{clearTimeout(timer);script.remove();error?reject(error):resolve();};
        script.onload=()=>finish();
        script.onerror=()=>finish(new Error(`Could not load ${path}. Check that the assets/signs folder is beside index.html, then retry.`));
        document.head.append(script);
      });
      scripts.set(path,request);
      try { await request; } catch(error) { scripts.delete(path); throw error; }
    }
    async function loadCatalog() {
      if (catalog.length) return;
      if (!loading) loading = (async () => {
        await Promise.all([loadScript('assets/signs/catalog.js'),loadScript('assets/signs/florida.js')]);
        if (!Array.isArray(app.signCatalog?.signs)) throw Error('Could not read the sign catalog.');
        catalog=[...app.signCatalog.signs,...app.floridaSigns];
        for (const entry of catalog) {
          const variantCode=entry.variant.split(' ')[0];
          entry.search=normalize(`${entry.code} ${entry.name} ${entry.variant} ${entry.category} ${entry.aliases??''} ${variantCode===entry.code+'L'?'left':variantCode===entry.code+'R'?'right':''}`);
          if(entry.code.startsWith('M1-'))entry.search+=' '+normalize('route marker shield '+(/U\.S\./.test(entry.name)?'US United States highway':''));
          designs.set(entry.id,entry);
        }
        groups=D.families(catalog.filter(D.standalone));
        choice ??= groups.find(g=>g.entries[0].code==='R1-1')?.entries[0].id ?? groups[0]?.entries[0].id;
        updatePanel();
      })().catch(error=>{loading=null;throw error;});
      return loading;
    }
    async function loadArt(id) {
      if (artwork.has(id)) return artwork.get(id);
      if (requests.has(id)) return requests.get(id);
      const request=(async()=>{
        await loadCatalog();
        const entry=designs.get(id);if(!entry)throw Error(`Unknown sign: ${id}`);
        await loadScript(`assets/signs/data/${entry.code}.js`);
        const data=app.signArtwork?.[id];
        if(!data?.paths?.length)throw Error(`Missing artwork for ${entry.code}.`);
        if(data.fields?.length)await loadScript('assets/signs/lettering.js');
        artwork.set(id,data.paths);return data.paths;
      })();
      requests.set(id,request);
      try{return await request;}finally{requests.delete(id);}
    }
    const fields = id => app.signArtwork?.[id]?.fields ?? [];
    const values = () => part() ? part().values??{} : choiceValues;
    const drawnPaths = sign => D.compose(artwork.get(sign.design)??[],fields(sign.design),sign.values,app.signAlphabets,designs.get(sign.design)?.box);
    function updateLegendFields(entry, sign) {
      const specs=fields(entry?.id), target=get('signLegendFields');
      const key=`${sign?.id??"draft"}:${partIndex}:${entry&&D.routeFamily(entry)?D.familyKey(entry):entry?.id}:${specs.length}`;
      if(fieldsFor!==key){
        fieldsFor=key;invalidFields.clear();target.replaceChildren();
        for(const field of specs){
          const row=document.createElement('div');row.className='fieldRow';
          const label=document.createElement('label');label.htmlFor=`signValue-${field.key}`;label.textContent=field.label;
          const input=document.createElement('input');input.id=label.htmlFor;input.type=field.type??'text';
          input.required=true;
          for(const attr of ['min','max','step','pattern','maxLength'])if(field[attr]!=null)input[attr]=field[attr];
          if(field.key==='route'&&D.routeFamily(entry))input.max=entry.routeMax??999;
          input.addEventListener('input',async()=>{
            const value=field.uppercase?input.value.toUpperCase():input.value;
            const selectedSign=part(),oldEntry=entryFor(selectedSign??draft());
            let target=oldEntry,live=fields(oldEntry?.id).find(f=>f.key===field.key)??field;
            if(field.key==='route'&&oldEntry&&D.routeFamily(oldEntry)&&/^\d{1,4}$/.test(value)&&+value>=1){
              const group=groups.find(g=>g.key===D.familyKey(oldEntry));
              target=group?.entries.find(e=>e.digits ? e.digits===Math.max(2,value.length) : /\b3 digits\b/.test(e.variant)===(value.length===3))??oldEntry;
              try{await loadArt(target.id);}catch(error){tell(error.message);return;}
              if(input.value!==value||part()!==selectedSign||entryFor(selectedSign??draft())?.id!==oldEntry.id)return;
              live=fields(target.id).find(f=>f.key===field.key)??live;
            }
            const error=D.validate(value,live,app.signAlphabets);
            input.setCustomValidity(error);input.setAttribute('aria-invalid',String(Boolean(error)));
            if(error){invalidFields.add(field.key);tell(error);get('addSign').disabled=true;return;}
            invalidFields.delete(field.key);
            if(target?.id!==oldEntry?.id){
              const previous=fields(oldEntry.id),saved=selectedSign?(selectedSign.values??={}):choiceValues;
              for(const spec of previous)if(spec.key!==field.key)saved[spec.key]??=spec.default;
              const ratio=(target.box[0]/target.box[1])/(oldEntry.box[0]/oldEntry.box[1]);
              if(selectedSign){selectedSign.design=target.id;selectedSign.scale=(selectedSign.scale??100)*ratio;}
              else{choice=target.id;choicePanelScale*=ratio;}
            }
            if(selectedSign){(selectedSign.values??={})[field.key]=value;changed();}
            else{choiceValues[field.key]=value;updatePanel();refreshOverlay();}
            tell('');
          });
          input.addEventListener('change',()=>{if(!input.checkValidity())input.reportValidity();});
          row.append(label,input);target.append(row);
          if(field.hint){const hint=document.createElement('p');hint.className='signInstructions';hint.id=`${input.id}-hint`;hint.textContent=field.hint;input.setAttribute('aria-describedby',hint.id);target.append(hint);}
        }
      }
      for(const field of specs){
        const input=get(`signValue-${field.key}`);
        if(document.activeElement!==input)input.value=(sign ? sign.values??{} : choiceValues)[field.key]??field.default;
      }
    }
    function updatePanel() {
      const root=current(),sign=part(),entry=entryFor(sign??draft());
      updateLegendFields(entry,sign);
      get('addSign').disabled=!sheets.selected || !entry || invalidFields.size>0;
      get('addSign').setAttribute('aria-pressed',String(Boolean(placement)));
      get('deleteSign').disabled=!sign;get('openAssemblyEditor').disabled=!root;
      get('signSize').disabled=!entry;
      if(document.activeElement!==get('signSize'))get('signSize').value=root?.size??choiceSize;
      get('signName').textContent=entry?label(entry):'Choose a sign to begin.';
      get('signPreview').hidden=!entry;
      if(entry){
        const model=sign??draft();
        if(model.image)get('signPreview').src=model.image.src;
        else if(artwork.has(entry.id)){
          const preview=document.createElementNS(SVG,'svg');preview.setAttribute('xmlns',SVG);preview.setAttribute('viewBox',`0 0 ${entry.box[0]+D.expansion(fields(entry.id),model.values,app.signAlphabets)} ${entry.box[1]}`);
          for(const attrs of drawnPaths(model))svg('path',attrs,preview);
          get('signPreview').src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(new XMLSerializer().serializeToString(preview));
        }else get('signPreview').src=new URL(entry.src,assetBase).href;
      }
      for(const [id,key,fallback] of [['signRotation','rotation',choiceRotation]]){
        for(const suffix of ['', 'Value']){const input=get(id+suffix);input.disabled=!entry;if(document.activeElement!==input)input.value=root?.[key]??fallback;}
      }
      const list=get('assemblyPart');list.replaceChildren();
      for(const [i,p] of (root?L.parts(root):[draft()]).entries()){
        const option=document.createElement('option');option.value=i;option.textContent=`${i+1}. ${entryFor(p)?label(entryFor(p)):'Sign'}`;list.append(option);
      }
      list.value=partIndex;list.disabled=!root;
      get('addAssemblySign').disabled=!root;get('removeAssemblySign').disabled=!root?.panels?.length;
      get('assemblyPosition').hidden=!root?.panels?.length;
      for(const [id,key,fallback] of [['assemblyRow','row',partIndex],['assemblyColumn','column',0],['assemblyScale','scale',100]]){
        if(document.activeElement!==get(id))get(id).value=(sign?.[key]??fallback)+(key==='scale'?0:1);
      }
      renderAssembly();
      if(!sheets.selected)tell('Upload a sheet first.');
    }
    function changed() { app.roadEditor.render(); updatePanel(); sheets.save(sheets.selected); app.history.record(); }
    function measure(part,root) {
      const entry=entryFor(part),base=root.width*(root.size??100)/100*(part.scale??100)/100;
      const widen=part.image?0:D.expansion(fields(part.design),part.values,app.signAlphabets);
      return {width:base*((entry?.box[0]??100)+widen)/(entry?.box[0]??100),height:base*(entry?.box[1]??100)/(entry?.box[0]??100)};
    }
    const dimensions = sign => L.layout(sign,measure);
    function drawOne(sign, parent, preview = false) {
      if (!entryFor(sign)) return;
      const group=svg('g',{class:preview?'preview':'signCallout','data-sign':sign.id??'preview'},parent);
      const {width,height,items}=dimensions(sign),angle=sign.rotation??0;
      const dx=sign.postX-sign.x,dy=sign.postY-sign.y,distance=Math.hypot(dx,dy);
      if(distance>0){
        const u={x:dx/distance,y:dy/distance},v={x:-u.y,y:u.x},local=L.rotate(u.x,u.y,-angle);
        const start=Math.min(width/2/Math.max(Math.abs(local.x),1e-6),height/2/Math.max(Math.abs(local.y),1e-6));
        if(distance>start){
          // Every leader on a sheet has the same weight, whatever its sign's size,
          // and the line stops inside the arrowhead so it never shows past the tip.
          // Thickness: a fixed share of the sheet, scaled by the Settings percentage.
          const sheet=sheets.selected,weight=(app.settings?.get('signArrowWeight')??100)/100;
          const stroke=(sheet?Math.hypot(sheet.width,sheet.height)/900:Math.max(.5,width/55))*weight;
          const a=Math.min(stroke*7,(distance-start)*.6);
          const base={x:sign.postX-u.x*a*.8,y:sign.postY-u.y*a*.8};
          const d=`M${sign.x} ${sign.y} L${base.x} ${base.y}`;
          svg('path',{d,fill:'none',stroke:'#ffffff','stroke-width':stroke*2.5},group);
          svg('path',{d,fill:'none',stroke:'#000000','stroke-width':stroke},group);
          svg('path',{d:`M${sign.postX} ${sign.postY} L${sign.postX-u.x*a+v.x*a*.45} ${sign.postY-u.y*a+v.y*a*.45} L${sign.postX-u.x*a-v.x*a*.45} ${sign.postY-u.y*a-v.y*a*.45} Z`,fill:'#000000',stroke:'#ffffff','stroke-width':stroke*.75,'stroke-linejoin':'round'},group);

        }
      }
      for(const item of items){
        const part=item.part,entry=entryFor(part);if(!entry)continue;
        const left=item.x-item.width/2,top=item.y-item.height/2;
        if(part.image){
          const c=L.rotate(1,0,angle),origin=L.rotate(left,top,angle);
          // Matrix maps the unit image rectangle to sheet pixels. PDF uses the
          // same matrix, preserving rotation, alpha and assembly position.
          const matrix=[c.x*item.width,c.y*item.width,-c.y*item.height,c.x*item.height,sign.x+origin.x,sign.y+origin.y];
          svg('image',{href:part.image.src,width:1,height:1,preserveAspectRatio:'none',transform:`matrix(${matrix.join(' ')})`},group);
        }else if(artwork.has(part.design)){
          const k=item.width/(entry.box[0]+D.expansion(fields(part.design),part.values,app.signAlphabets));
          for(const original of drawnPaths(part)){
            const attrs={...original,d:L.path(original.d,k,left,top,angle,sign.x,sign.y)};
            if(attrs['stroke-width'])attrs['stroke-width']=+attrs['stroke-width']*k;
            svg('path',attrs,group);
          }
        }
      }
    }
    function draw(sheet, parent) {
      for (const sign of sheet.signs ?? []) drawOne(sign, parent);
    }
    function focusHandle(id, part) { overlay.querySelector(`[data-sign="${id}"][data-part="${part}"]`)?.focus({ preventScroll:true }); }
    function refreshOverlay() {
      if (dragging) return; // Keep the capturing element alive throughout a drag.
      overlay.replaceChildren(); overlay.classList.toggle('drawing', Boolean(placement));
      const sheet = sheets.selected; if (!sheet) return;
      for (const sign of sheet.signs ?? []) {
        const entry = entryFor(sign); if (!entry) continue;
        const { width, height } = dimensions(sign), face = sheets.toScreen(sign), post = sheets.toScreen({x:sign.postX,y:sign.postY});
        const button = document.createElement('button'); button.type = 'button';
        button.className = `signHit${active() && sign.id === selected ? ' selected' : ''}`;
        button.dataset.sign = sign.id; button.dataset.part = 'face';
        button.setAttribute('aria-label', `${label(entry)} callout. Drag to move sign face.`);
        button.title = label(entry);
        Object.assign(button.style, {transform:`rotate(${sign.rotation??0}deg)`,left:`${face.x-width*sheet.view.scale/2}px`,top:`${face.y-height*sheet.view.scale/2}px`,width:`${width*sheet.view.scale}px`,height:`${height*sheet.view.scale}px`});
        overlay.append(button);
        if (active() && selected === sign.id) {
          const handle = document.createElement('button'); handle.type='button';handle.className='signPost';
          handle.dataset.sign=sign.id;handle.dataset.part='post';handle.setAttribute('aria-label',`${entry.code} arrow tip location`);
          Object.assign(handle.style,{left:`${post.x}px`,top:`${post.y}px`});overlay.append(handle);
        }
      }
      if (placement?.post && placement.cursor) {
        const screenSVG = svg('svg', {}, overlay);
        const s = { ...draft(), x:placement.cursor.x,y:placement.cursor.y,postX:placement.post.x,postY:placement.post.y,width:80/sheet.view.scale,size:choiceSize,values:choiceValues };
        const preview = svg('g',{transform:`translate(${sheet.view.x} ${sheet.view.y}) scale(${sheet.view.scale})`},screenSVG);
        drawOne(s,preview,true);
      }
    }
    let pickerMatches=[],pickerCount=0;
    function populate() {
      const raw = get('signSearch').value;
      const codeQuery = raw.match(/\b[A-Z]{1,3}0*\d+-0*\d+[a-z]*/i)?.[0];
      const exactCode = codeQuery?.toLowerCase().replace(/([a-z]|-)0+(?=\d)/g, '$1');
      const query = normalize(codeQuery ? raw.replace(codeQuery, '') : raw).split(' ').filter(Boolean), category = get('signCategory').value;
      const matches = groups.filter(g => g.entries.some(e => (!category || e.category === category) && (!exactCode || e.code.toLowerCase() === exactCode || e.code.toLowerCase() === exactCode+'p' || e.variant.split(' ')[0].toLowerCase() === exactCode) && query.every(word => e.search.includes(word))));
      pickerMatches=matches;pickerCount=0;grid.replaceChildren();grid.scrollTop=0;
      appendPickerTiles();
      get('signSearchStatus').textContent=matches.length ? `${matches.length} matching designs` : 'No matching signs. Try another code or name.';
    }
    function appendPickerTiles(){
      const batch=document.createDocumentFragment();
      for (const group of pickerMatches.slice(pickerCount,pickerCount+48)) {
        pickerCount++;
        const entry=group.entries[0];
        const button = document.createElement('button');button.type='button';button.className='iconGridItem';button.dataset.design=entry.id;
        button.setAttribute('aria-label',`${label(entry)} — ${group.label}`);button.title=button.getAttribute('aria-label');
        button.setAttribute('aria-pressed',String(group.entries.some(e => e.id === (current()?.design ?? choice))));
        const img = document.createElement('img');img.src=new URL(entry.src,assetBase).href;img.alt='';img.loading='lazy';img.decoding='async';button.append(img);
        const caption = document.createElement('span');caption.textContent=label(entry);button.append(caption);
        button.addEventListener('click',async () => {
          const target = choosingFor;
          get('signSearchStatus').textContent=`Loading ${entry.code}…`;
          try {
            await loadArt(entry.id);
            if (!picker.open || choosingFor !== target) return;
            choice=entry.id;choiceImage=null;choicePanelScale=100;
            const sign = target?.sheet === sheets.selected && sheets.selected.signs?.find(s => s.id === target.id);
            if(sign){
              if(appendPanel){candidate={design:choice,values:{},scale:100};}
              else{const targetPart=L.parts(sign)[partIndex]??sign;targetPart.values={};targetPart.design=choice;delete targetPart.image;changed();}
            }else{choiceValues={};choicePanels=[];partIndex=0;}
            appendPanel=false;
            placement=null;updatePanel();picker.close();tell(!assemblyPanel.hidden ? 'Drag the sign to a row or column, or click its preview to add below.' : sign ? 'Sign changed.' : 'Click Add Sign to place it on the sheet.');
          } catch(error) {get('signSearchStatus').textContent=error.message;}
        });
        batch.append(button);
      }
      grid.append(batch);
    }
    grid.addEventListener('scroll',()=>{if(grid.scrollTop+grid.clientHeight>=grid.scrollHeight-250)appendPickerTiles();},{passive:true});
    grid.addEventListener('focusin',event=>{if(event.target===grid.lastElementChild)appendPickerTiles();});
    async function openPicker(add=false) {
      appendPanel=add;
      try {await loadCatalog();} catch(error) {tell(error.message);return;}
      placement=null;refreshOverlay();updatePanel();
      choosingFor=current() ? {sheet:sheets.selected,id:selected} : null;
      get('signSearch').value='';get('signCategory').value='';populate();picker.showModal();get('signSearch').focus();grid.scrollTop=0;
    }
    get('chooseSign').addEventListener('click',()=>openPicker());
    get('addAssemblySign').addEventListener('click',()=>openPicker(true));
    get('signSearch').addEventListener('input',populate);get('signCategory').addEventListener('change',populate);
    get('closeSignPicker').addEventListener('click',() => picker.close());
    picker.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); picker.close(); }
    });
    picker.addEventListener('close',() => {choosingFor=null;get('chooseSign').focus({preventScroll:true});});
    get('addSign').addEventListener('click',async () => {
      if (placement) {placement=null;refreshOverlay();updatePanel();tell('Placement canceled.');return;}
      const sheet=sheets.selected, model=current()??draft(),design=model.design;if (!sheet || (!design&&!model.image))return;
      try {await loadParts(model);} catch(error) {tell(error.message);return;}
      if (sheets.selected !== sheet || !active())return;
      choice=design;choiceImage=model.image??null;choicePanels=structuredClone(model.panels??[]);choiceValues=structuredClone(model.values??{});choiceSize=model.size??choiceSize;choicePanelScale=model.scale??100;choiceRotation=model.rotation??0;selected=null;partIndex=0;placement={};refreshOverlay();updatePanel();tell('Click the arrow tip location.');
    });
    function remove() {
      if (!current())return;
      sheets.selected.signs=sheets.selected.signs.filter(s=>s.id!==selected);selected=null;changed();tell('Sign deleted.');
    }
    get('deleteSign').addEventListener('click',remove);
    get('signSize').addEventListener('input',event=>{
      const sign=current(),value=event.target.valueAsNumber;if(!Number.isFinite(value))return;
      const size=Math.max(25,Math.min(2000,value));
      if(sign){sign.size=size;changed();}else{choiceSize=size;refreshOverlay();}
    });
    get('signSize').addEventListener('change',()=>{get('signSize').value=current()?.size ?? choiceSize;});
    for(const [id,key] of [['signRotation','rotation']]){
      for(const suffix of ['', 'Value'])get(id+suffix).addEventListener('input',event=>{
        const value=event.target.valueAsNumber;if(!Number.isFinite(value)||value<0||value>360)return;
        if(current()){current()[key]=value;changed();}
        else{choiceRotation=value;updatePanel();refreshOverlay();}
      });
    }
    get('assemblyPart').addEventListener('change',event=>{partIndex=+event.target.value;updatePanel();});
    for(const [id,key] of [['assemblyRow','row'],['assemblyColumn','column'],['assemblyScale','scale']]){
      get(id).addEventListener('input',event=>{
        const p=part(),value=event.target.valueAsNumber;if(!p||!event.target.checkValidity()||!Number.isFinite(value))return;
        const next=key==='scale'?value:value-1;
        if(key!=='scale' && L.parts(current()).some((q,i)=>q!==p && (key==='row'?(q.row??i)===next&&(q.column??0)===(p.column??0):(q.column??0)===next&&(q.row??i)===(p.row??partIndex)))){
          tell('That assembly position is occupied. Choose another row or column.');return;
        }
        p[key]=next;changed();tell('');
      });
    }
    function removeAssemblyPart(){
      const sign=current();if(!sign?.panels?.length)return;
      if(partIndex)sign.panels.splice(partIndex-1,1);
      else{const first=sign.panels.shift();for(const key of ['design','image','values','row','column','scale']){delete sign[key];if(first[key]!=null)sign[key]=first[key];}}
      partIndex=0;changed();
    }
    get('removeAssemblySign').addEventListener('click',removeAssemblyPart);
    function thumbnail(p){
      const entry=entryFor(p);if(!entry)return '';
      if(p.image)return p.image.src;
      if(!artwork.has(p.design))return new URL(entry.src,assetBase).href;
      const preview=document.createElementNS(SVG,'svg');preview.setAttribute('xmlns',SVG);
      preview.setAttribute('viewBox',`0 0 ${entry.box[0]+D.expansion(fields(p.design),p.values,app.signAlphabets)} ${entry.box[1]}`);
      for(const attrs of drawnPaths(p))svg('path',attrs,preview);
      return 'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(new XMLSerializer().serializeToString(preview));
    }
    function renderAssembly(){
      if(assemblyPanel.hidden||assemblyDrag)return;
      const root=current(),grid=get('assemblyGrid');grid.replaceChildren();
      const palette=get('assemblyCandidate');palette.replaceChildren();palette.disabled=!root;
      get('assemblyRemoveDrop').disabled=!root?.panels?.length;
      if(!root)return;
      candidate??={design:root.design,image:root.image,values:structuredClone(root.values??{}),scale:100};
      const image=document.createElement('img');image.src=thumbnail(candidate);image.alt='Sign to add';palette.append(image);
      const layout=dimensions(root),columns=[...new Set(layout.items.map(p=>p.column))].sort((a,b)=>a-b),rows=[...new Set(layout.items.map(p=>p.row))].sort((a,b)=>a-b);
      const allColumns=[...new Set(columns.flatMap(c=>[c-1,c,c+1]))].sort((a,b)=>a-b);
      const allRows=[...new Set(rows.flatMap(r=>[r-1,r,r+1]))].sort((a,b)=>a-b);
      const adjacent=new Set(layout.items.flatMap(p=>[[p.row-1,p.column],[p.row+1,p.column],[p.row,p.column-1],[p.row,p.column+1]].map(([r,c])=>`${r}:${c}`)));
      const extent=(value,axis,size)=>{
        const distance=Math.min(...layout.items.map(p=>Math.abs(p[axis]-value)));
        return Math.max(...layout.items.filter(p=>Math.abs(p[axis]-value)===distance).map(p=>p[size]));
      };
      const widths=allColumns.map(c=>extent(c,'column','width')),heights=allRows.map(r=>extent(r,'row','height'));
      const factor=Math.min(3,350/widths.reduce((a,b)=>a+b,0),270/heights.reduce((a,b)=>a+b,0));
      grid.style.gridTemplateColumns=widths.map(w=>`${w*factor}px`).join(' ');
      grid.style.gridTemplateRows=heights.map(h=>`${h*factor}px`).join(' ');
      for(const r of allRows)for(const c of allColumns){
        const i=layout.items.findIndex(p=>p.row===r&&p.column===c),item=layout.items[i];
        if(!item&&!adjacent.has(`${r}:${c}`)){const spacer=document.createElement('div');spacer.setAttribute('aria-hidden','true');grid.append(spacer);continue;}
        const button=document.createElement('button');button.type='button';button.dataset.row=r;button.dataset.column=c;button.dataset.assemblyIndex=i;
        button.setAttribute('aria-label',item?`${label(entryFor(item.part))}, row ${r+1}, column ${c+1}`:r<0?'Add above this column':c<0?'Add left of this row':`Add at row ${r+1}, column ${c+1}`);
        if(item){
          const img=document.createElement('img');img.src=thumbnail(item.part);img.alt='';img.style.width=`${item.width*factor}px`;img.style.height=`${item.height*factor}px`;button.append(img);
          button.setAttribute('aria-pressed',String(i===partIndex));
          button.onclick=()=>{if(assemblyDrag)return;partIndex=i;updatePanel();};
        }else{button.className='assemblyEmpty';button.textContent='+';button.onclick=()=>placeAssemblyPart('candidate',r,c);}
        grid.append(button);
      }
    }
    function placeAssemblyPart(from,row,column){
      const root=current();if(!root)return;
      const parts=L.parts(root),occupied=parts.findIndex((p,i)=>(p.row??i)===row&&(p.column??0)===column);
      if(from==='candidate'){
        if(!candidate)return;
        if(occupied>=0){tell('Drop the new sign on a + cell.');return;}
        (root.panels??=[]).push({...structuredClone(candidate),row,column,scale:100});partIndex=root.panels.length;
      }else{
        const index=+from,p=parts[index];if(!p)return;
        const old={row:p.row??index,column:p.column??0};
        if(occupied>=0&&occupied!==index)Object.assign(parts[occupied],old);
        Object.assign(p,{row,column});partIndex=index;
      }
      // Adding above/left shifts logical coordinates, preserving relative layout
      // and keeping the one-based numeric controls valid.
      const added=L.parts(root),minRow=Math.min(0,...added.map((p,i)=>p.row??i)),minColumn=Math.min(0,...added.map(p=>p.column??0));
      added.forEach((p,i)=>{p.row=(p.row??i)-minRow;p.column=(p.column??0)-minColumn;});
      changed();tell('Assembly updated.');
    }
    get('assemblyCandidate').onclick=()=>{
      if(assemblyDrag||!current())return;
      placeAssemblyPart('candidate',Math.max(...L.parts(current()).map((p,i)=>p.row??i))+1,0);
    };
    get('assemblyRemoveDrop').onclick=removeAssemblyPart;
    assemblyPanel.addEventListener('pointerdown',event=>{
      const source=event.target.closest('#assemblyCandidate, [data-assembly-index]');
      if(!source||source.disabled||event.button!==0||source.dataset.assemblyIndex==='-1')return;
      assemblyDrag={source,from:source.id==='assemblyCandidate'?'candidate':source.dataset.assemblyIndex,x:event.clientX,y:event.clientY,pointer:event.pointerId,moved:false};
      source.setPointerCapture(event.pointerId);
    });
    assemblyPanel.addEventListener('pointermove',event=>{
      const d=assemblyDrag;if(!d||d.pointer!==event.pointerId)return;
      if(Math.hypot(event.clientX-d.x,event.clientY-d.y)>5)d.moved=true;
      if(!d.moved)return;event.preventDefault();d.source.classList.add('dragging');
      assemblyPanel.querySelectorAll('.dragOver').forEach(n=>n.classList.remove('dragOver'));
      document.elementFromPoint(event.clientX,event.clientY)?.closest('[data-row],#assemblyRemoveDrop')?.classList.add('dragOver');
    });
    function finishAssemblyDrag(event){
      const d=assemblyDrag;if(!d||d.pointer!==event.pointerId)return;
      const target=document.elementFromPoint(event.clientX,event.clientY)?.closest('[data-row],#assemblyRemoveDrop');
      assemblyDrag=null;if(d.source.hasPointerCapture(event.pointerId))d.source.releasePointerCapture(event.pointerId);
      if(event.type!=='pointercancel'&&d.moved){
        suppressAssemblyClick=true;setTimeout(()=>{suppressAssemblyClick=false;},0);
        if(target?.id==='assemblyRemoveDrop'&&d.from!=='candidate'){partIndex=+d.from;removeAssemblyPart();}
        else if(target?.dataset.row!=null)placeAssemblyPart(d.from,+target.dataset.row,+target.dataset.column);
        event.preventDefault();
      }
      if(d.moved||event.type==='pointercancel')renderAssembly();
    }
    assemblyPanel.addEventListener('click',event=>{if(suppressAssemblyClick){event.preventDefault();event.stopImmediatePropagation();}},true);
    assemblyPanel.addEventListener('pointerup',finishAssemblyDrag);assemblyPanel.addEventListener('pointercancel',finishAssemblyDrag);
    get('openAssemblyEditor').onclick=()=>{if(!current())return;candidate=null;app.showEditor('signAssemblyEditor');syncEditor();get('signAssemblyTitle').focus();};
    get('closeAssemblyEditor').onclick=()=>{partIndex=0;app.showEditor('signsEditor');syncEditor();};
    function syncEditor(){
      const destination=get(assemblyPanel.hidden?'signDetailsHome':'assemblyDetails');
      for(const id of ['chooseSign','signCurrent','signLegendFields'])destination.append(get(id));
      if(!active())placement=null;
      updatePanel();refreshOverlay();
    }
    new MutationObserver(syncEditor).observe(assemblyPanel,{attributes:true,attributeFilter:['hidden']});
    async function importSignImage(file, pasted=false){
      const sheet=sheets.selected,token=++pasteRequest;
      const assembly=!pasted&&!assemblyPanel.hidden&&current(),target=assembly?.id;
      if(!sheet){tell('Upload a sheet before adding a sign.');return;}
      if(file.size>20*1024*1024){tell('Choose an image smaller than 20 MB.');return;}
      if(!assembly)app.showEditor('signsEditor');
      const url=URL.createObjectURL(file);
      tell('Loading sign…');
      try{
        const image=new Image();image.src=url;await image.decode();
        if(!image.naturalWidth||!image.naturalHeight)throw Error('Empty image');
        const ratio=Math.min(1,1024/Math.max(image.naturalWidth,image.naturalHeight));
        const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.naturalWidth*ratio));canvas.height=Math.max(1,Math.round(image.naturalHeight*ratio));
        canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
        if(token!==pasteRequest||sheet!==sheets.selected||!active()||(target&&current()?.id!==target))return;
        const custom={src:canvas.toDataURL('image/png'),width:canvas.width,height:canvas.height,name:pasted?'Pasted image':file.name};
        if(assembly){candidate={image:custom,values:{},scale:100};updatePanel();tell('Drag the uploaded sign into a cell, or click its preview to add below.');return;}
        choicePanelScale=100;choiceImage=custom;
        choice=null;choiceValues={};choicePanels=[];choiceRotation=0;selected=null;partIndex=0;placement={};
        updatePanel();refreshOverlay();tell((pasted?'Image pasted. ':'')+'Click the arrow tip location, then the sign face location.');
      }catch(error){tell(`Could not load that image: ${error.message}`);}finally{URL.revokeObjectURL(url);}
    }
    for(const id of ['uploadSign','uploadAssemblySign','uploadSignPicker'])get(id).addEventListener('click',()=>get('signImageFile').click());
    get('signImageFile').addEventListener('change',event=>{
      const file=event.target.files[0];event.target.value='';if(!file)return;
      picker.close();importSignImage(file);
    });
    document.addEventListener('paste',event=>{
      if(picker.open)return;
      const file=[...(event.clipboardData?.items??[])].find(item=>item.kind==='file'&&item.type.startsWith('image/'))?.getAsFile();
      if(file){event.preventDefault();importSignImage(file,true);}
    });
    workspace.addEventListener('pointerdown',event=>{
      if (!active() || !placement || event.button!==0 || !event.isPrimary)return;
      event.preventDefault();event.stopImmediatePropagation();
      const sheet=sheets.selected,point=sheets.toImage(event.clientX,event.clientY);
      if(point.x<0 || point.y<0 || point.x>sheet.width || point.y>sheet.height){tell('Place the sign on the sheet.');return;}
      if(!placement.post){placement.post=point;tell('Click where to show the sign face.');return;}
      const sign={...structuredClone(draft()),id:crypto.randomUUID(),design:choice,x:point.x,y:point.y,postX:placement.post.x,postY:placement.post.y,width:80/sheet.view.scale,size:choiceSize,values:structuredClone(choiceValues)};
      (sheet.signs??=[]).push(sign);selected=sign.id;selectedSheet=sheet;placement=null;changed();tell('Drag the sign face or its arrow tip to adjust the callout.');
    },true);
    workspace.addEventListener('pointermove',event=>{
      if(!placement?.post)return;placement.cursor=sheets.toImage(event.clientX,event.clientY);refreshOverlay();
    });
    workspace.addEventListener('dblclick',event=>{if(placement || event.target.closest('.signOverlay')){event.preventDefault();event.stopImmediatePropagation();}},true);
    overlay.addEventListener('pointerdown',event=>{
      const handle=event.target.closest('button[data-sign]');if(!handle || placement || event.button!==0)return;
      event.preventDefault();event.stopPropagation();if(selected!==handle.dataset.sign)partIndex=0;selected=handle.dataset.sign;selectedSheet=sheets.selected;
      const sign=current();if(!sign)return;
      dragging={id:sign.id,part:handle.dataset.part,sheet:sheets.selected,pointer:event.pointerId,start:sheets.toImage(event.clientX,event.clientY),before:{...sign},handle};
      handle.setPointerCapture(event.pointerId);handle.focus({preventScroll:true});app.showEditor(assemblyPanel.hidden?'signsEditor':'signAssemblyEditor');updatePanel();
    });
    overlay.addEventListener('pointermove',event=>{
      if(!dragging || event.pointerId!==dragging.pointer)return;
      const {before,part,start}=dragging,p=sheets.toImage(event.clientX,event.clientY),sign=current();if(!sign)return;
      if(part==='post'){sign.postX=before.postX+p.x-start.x;sign.postY=before.postY+p.y-start.y;}
      else {sign.x=before.x+p.x-start.x;sign.y=before.y+p.y-start.y;}
      app.roadEditor.render();
      // The hit target follows the drag without replacing the capture owner.
      const at=sheets.toScreen(part==='post'?{x:sign.postX,y:sign.postY}:sign),size=dimensions(sign);
      dragging.handle.style.left=`${at.x-(part==='face'?size.width*sheets.selected.view.scale/2:0)}px`;
      dragging.handle.style.top=`${at.y-(part==='face'?size.height*sheets.selected.view.scale/2:0)}px`;
    });
    function endDrag(event) {
      if(!dragging || event.pointerId!==dragging.pointer)return;
      const d=dragging;
      if(event.type==='pointercancel' && current())Object.assign(current(),d.before);
      dragging=null;
      if(d.handle.hasPointerCapture(event.pointerId))d.handle.releasePointerCapture(event.pointerId);
      changed();focusHandle(d.id,d.part);
    }
    overlay.addEventListener('pointerup',endDrag);overlay.addEventListener('pointercancel',endDrag);
    overlay.addEventListener('click',event=>event.stopPropagation());
    const arrows={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};
    overlay.addEventListener('keydown',event=>{
      const handle=event.target.closest('button[data-sign]');if(!handle)return;
      if(selected!==handle.dataset.sign)partIndex=0;selected=handle.dataset.sign;selectedSheet=sheets.selected;
      if(event.key==='Enter' || event.key===' '){event.preventDefault();app.showEditor(assemblyPanel.hidden?'signsEditor':'signAssemblyEditor');updatePanel();refreshOverlay();focusHandle(selected,handle.dataset.part);return;}
      if(!arrows[event.key])return;event.preventDefault();event.stopPropagation();
      const sign=current(),step=(event.shiftKey?10:1)/sheets.selected.view.scale,[dx,dy]=arrows[event.key],part=handle.dataset.part;
      if(part==='post'){sign.postX+=dx*step;sign.postY+=dy*step;}else{sign.x+=dx*step;sign.y+=dy*step;}
      changed();focusHandle(selected,part);
    });
    document.addEventListener('keydown',event=>{
      if(!active() || picker.open || event.target.closest('input,select,textarea,[contenteditable="true"]'))return;
      if(event.key==='Escape' && placement){event.preventDefault();event.stopImmediatePropagation();placement=null;refreshOverlay();updatePanel();tell('Placement canceled.');}
      // One level at a time: an assembly panel, then the sign, then the panel closes.
      else if(event.key==='Escape' && selected && !event.target.closest?.('input,select,textarea,dialog')){event.preventDefault();event.stopImmediatePropagation();if(partIndex>0)partIndex=0;else selected=null;refreshOverlay();updatePanel();}
      else if((event.key==='Delete' || event.key==='Backspace') && current()){event.preventDefault();if(!assemblyPanel.hidden)removeAssemblyPart();else remove();}
    },true);
    new MutationObserver(()=>{if(!active())placement=null;updatePanel();refreshOverlay();}).observe(panel,{attributes:true,attributeFilter:['hidden']});
    document.addEventListener('sheetview',refreshOverlay);
    async function loadParts(sign){await Promise.all(L.parts(sign).filter(p=>!p.image).map(p=>loadArt(p.design)));}
    async function ready(sheet) {
      await loadCatalog();await Promise.all((sheet.signs??[]).map(loadParts));app.roadEditor.render();
    }
    for(const event of ['sheetchange','sheethistory'])document.addEventListener(event,()=>{
      placement=null;dragging=null;partIndex=0;fieldsFor=null;invalidFields.clear();if(selectedSheet!==sheets.selected)selected=null;
      updatePanel();refreshOverlay();if(sheets.selected) { tell('Choose a sign, then click Add Sign.'); } if(sheets.selected)ready(sheets.selected).catch(error=>tell(error.message));
    });
    // For selection: a sign's face, centered on its x, y.
    const box = sign => { const { width, height } = dimensions(sign); return { x: sign.x, y: sign.y, width, height, rotation: sign.rotation ?? 0 }; };
    // Opens a sign in the Signs panel, selected (right-click Edit).
    const focus = id => { app.showEditor?.('signsEditor'); selected=id; selectedSheet=sheets.selected; partIndex=0; refreshOverlay(); updatePanel(); };
    app.signs={diagnostics:()=>structuredClone({selected,draft:draft(),partIndex,appendPanel}),draw,refreshOverlay,ready,box,focus};
    loadCatalog().then(async()=>{await loadArt(choice);updatePanel();if(sheets.selected)return ready(sheets.selected);}).catch(error=>tell(error.message));
    updatePanel();
  });
})();
