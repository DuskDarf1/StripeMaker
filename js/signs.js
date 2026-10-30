/* Signs editor and thumbnail selector, adapted from SignalMaker's regulatory
   sign picker (GPL-3.0). Artwork and names: FHWA 2024 Standard Highway Signs;
   see assets/signs/SOURCES.md. Callout sizes are schematic, not installation
   dimensions. Stored coordinates are sheet pixels and don't require scale. */
(() => {
  const SVG = 'http://www.w3.org/2000/svg';
  const assetBase = new URL('../', document.currentScript.src);
  document.addEventListener('DOMContentLoaded', () => {
    const app = window.StripeMaker, sheets = app.sheets, D = app.signDesigns;
    const get = id => document.getElementById(id);
    const panel = get('signsEditor'), picker = get('signPicker'), grid = get('signGrid');
    const workspace = get('workspace'), overlay = document.createElement('div');
    overlay.className = 'signOverlay'; sheets.addOverlay(overlay);
    const designs = new Map(), artwork = new Map(), requests = new Map(), scripts = new Map();
    const invalidFields = new Set();
    let groups = [], choiceValues = {}, choiceSize = 100, fieldsFor = null, sizeRequest = 0;
    let catalog = [], loading, selected = null, selectedSheet = null, choice = null;
    let placement = null, dragging = null, choosingFor = null;
    const current = () => sheets.selected?.signs?.find(s => s.id === selected);
    const active = () => !panel.hidden;
    const tell = text => { get('signStatus').textContent = text; };
    const normalize = text => text.toLowerCase().replace(/\bpeds\b/g, 'pedestrians').replace(/([a-z]|-)0+(?=\d)/g, '$1').replace(/[^a-z0-9]+/g, ' ').trim();
    const label = entry => `${entry.code} — ${entry.name}`;
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
        await loadScript('assets/signs/catalog.js');
        if (!Array.isArray(app.signCatalog?.signs)) throw Error('Could not read the sign catalog.');
        catalog=app.signCatalog.signs;
        for (const entry of catalog) {
          const variantCode=entry.variant.split(' ')[0];
          entry.search=normalize(`${entry.code} ${entry.name} ${entry.variant} ${entry.category} ${variantCode===entry.code+'L'?'left':variantCode===entry.code+'R'?'right':''}`);
          designs.set(entry.id,entry);
        }
        groups=D.families(catalog);
        choice ??= catalog.find(e=>e.code==='R1-1')?.id ?? catalog[0]?.id;
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
    const values = () => current() ? current().values??{} : choiceValues;
    const drawnPaths = sign => D.compose(artwork.get(sign.design)??[],fields(sign.design),sign.values,app.signAlphabets,designs.get(sign.design)?.box);
    function updateLegendFields(entry, sign) {
      const specs=fields(entry?.id), target=get('signLegendFields');
      const key=`${sign?.id??"draft"}:${entry?.id}:${specs.length}`;
      if(fieldsFor!==key){
        fieldsFor=key;invalidFields.clear();target.replaceChildren();
        for(const field of specs){
          const row=document.createElement('div');row.className='fieldRow';
          const label=document.createElement('label');label.htmlFor=`signValue-${field.key}`;label.textContent=field.label;
          const input=document.createElement('input');input.id=label.htmlFor;input.type=field.type??'text';
          input.required=true;
          for(const attr of ['min','max','step','pattern','maxLength'])if(field[attr]!=null)input[attr]=field[attr];
          input.addEventListener('input',()=>{
            const value=field.uppercase?input.value.toUpperCase():input.value;
            const error=D.validate(value,field,app.signAlphabets);
            input.setCustomValidity(error);input.setAttribute('aria-invalid',String(Boolean(error)));
            if(error){invalidFields.add(field.key);tell(error);get('addSign').disabled=true;return;}
            invalidFields.delete(field.key);
            const selectedSign=current();
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
      const sign=current(),entry=designs.get(sign?.design??choice);
      updateLegendFields(entry,sign);
      get('addSign').disabled=!sheets.selected || !entry || invalidFields.size>0;
      get('addSign').setAttribute('aria-pressed',String(Boolean(placement)));
      get('deleteSign').disabled=!sign;
      get('signSize').disabled=!entry;
      if(document.activeElement!==get('signSize'))get('signSize').value=sign?.size??choiceSize;
      const group=entry && groups.find(g=>g.key===D.familyKey(entry));
      const sizes=get('signPhysicalSize');
      if(sizes.dataset.family!==group?.key){
        sizes.replaceChildren();sizes.dataset.family=group?.key??'';
        for(const option of group?.entries??[]){const node=document.createElement('option');node.value=option.id;node.textContent=D.sizeName(option);sizes.append(node);}
      }
      sizes.value=entry?.id??'';sizes.disabled=!entry;
      get('signName').textContent=entry?label(entry):'Choose a sign to begin.';
      get('signPreview').hidden=!entry;
      if(entry){
        const model=sign??{design:choice,values:choiceValues};
        if(artwork.has(entry.id)){
          const preview=document.createElementNS(SVG,'svg');preview.setAttribute('xmlns',SVG);preview.setAttribute('viewBox',`0 0 ${entry.box[0]+D.expansion(fields(entry.id),model.values,app.signAlphabets)} ${entry.box[1]}`);
          for(const attrs of drawnPaths(model))svg('path',attrs,preview);
          get('signPreview').src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(new XMLSerializer().serializeToString(preview));
        }else get('signPreview').src=new URL(entry.src,assetBase).href;
      }
      if(!sheets.selected)tell('Upload a sheet first.');
    }
    function changed() { app.roadEditor.render(); updatePanel(); sheets.save(sheets.selected); app.history.record(); }
    function dimensions(sign) {
      const entry=designs.get(sign.design), base=sign.width*(sign.size??100)/100;
      const widen=D.expansion(fields(sign.design),sign.values,app.signAlphabets);
      return {width:base*((entry?.box[0]??100)+widen)/(entry?.box[0]??100),height:base*(entry?.box[1]??100)/(entry?.box[0]??100)};
    }
    function drawOne(sign, parent, preview = false) {
      const entry = designs.get(sign.design), paths = artwork.has(sign.design) && drawnPaths(sign);
      if (!entry || !paths) return;
      const group = svg('g', { class: preview ? 'preview' : 'signCallout', 'data-sign': sign.id ?? 'preview' }, parent);
      const { width, height } = dimensions(sign), k = width / (entry.box[0]+D.expansion(fields(sign.design),sign.values,app.signAlphabets));
      const left = sign.x - width / 2, top = sign.y - height / 2;
      const dx = sign.postX - sign.x, dy = sign.postY - sign.y, distance = Math.hypot(dx, dy);
      // The face paints over the leader so it meets the actual silhouette. A short
      // transverse bar marks the post. White halo keeps it visible on imagery.
      if (distance > 0) {
        const u = { x: dx / distance, y: dy / distance }, v = { x: -u.y, y: u.x };
        const start = Math.min(width / 2 / Math.max(Math.abs(u.x), 1e-6), height / 2 / Math.max(Math.abs(u.y), 1e-6));
        if (distance > start) {
          const a = Math.min(width * .12, (distance - start) * .4), stroke = Math.max(.5, width / 55);
          const d = `M${sign.x} ${sign.y} L${sign.postX} ${sign.postY}`;
          svg('path', { d, fill:'none', stroke:'#ffffff', 'stroke-width':stroke*2.5 }, group);
          svg('path', { d, fill:'none', stroke:'#000000', 'stroke-width':stroke }, group);
          svg('path', { d:`M${sign.postX} ${sign.postY} L${sign.postX-u.x*a+v.x*a*.45} ${sign.postY-u.y*a+v.y*a*.45} L${sign.postX-u.x*a-v.x*a*.45} ${sign.postY-u.y*a-v.y*a*.45} Z`, fill:'#000000', stroke:'#ffffff', 'stroke-width':stroke*.3 }, group);
          const bar = `M${sign.postX-v.x*width*.055} ${sign.postY-v.y*width*.055} L${sign.postX+v.x*width*.055} ${sign.postY+v.y*width*.055}`;
          svg('path', { d:bar, fill:'none', stroke:'#ffffff', 'stroke-width':stroke*2.5 }, group);
          svg('path', { d:bar, fill:'none', stroke:'#000000', 'stroke-width':stroke }, group);
        }
      }
      for (const original of paths) {
        let coordinate = 0;
        const attrs = { ...original, d: original.d.replace(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi, value => {
          const offset = coordinate++ % 2 ? top : left;
          return (+value * k + offset).toFixed(4);
        }) };
        if (attrs['stroke-width']) attrs['stroke-width'] = +attrs['stroke-width'] * k;
        svg('path', attrs, group);
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
        const entry = designs.get(sign.design); if (!entry) continue;
        const { width, height } = dimensions(sign), face = sheets.toScreen(sign), post = sheets.toScreen({x:sign.postX,y:sign.postY});
        const button = document.createElement('button'); button.type = 'button';
        button.className = `signHit${active() && sign.id === selected ? ' selected' : ''}`;
        button.dataset.sign = sign.id; button.dataset.part = 'face';
        button.setAttribute('aria-label', `${label(entry)} callout. Drag to move sign face.`);
        button.title = `${label(entry)} — ${entry.variant}`;
        Object.assign(button.style, {left:`${face.x-width*sheet.view.scale/2}px`,top:`${face.y-height*sheet.view.scale/2}px`,width:`${width*sheet.view.scale}px`,height:`${height*sheet.view.scale}px`});
        overlay.append(button);
        if (active() && selected === sign.id) {
          const handle = document.createElement('button'); handle.type='button';handle.className='signPost';
          handle.dataset.sign=sign.id;handle.dataset.part='post';handle.setAttribute('aria-label',`${entry.code} signpost location`);
          Object.assign(handle.style,{left:`${post.x}px`,top:`${post.y}px`});overlay.append(handle);
        }
      }
      if (placement?.post && placement.cursor) {
        const screenSVG = svg('svg', {}, overlay);
        const s = { design:choice, x:placement.cursor.x,y:placement.cursor.y,postX:placement.post.x,postY:placement.post.y,width:80/sheet.view.scale,size:choiceSize,values:choiceValues };
        const preview = svg('g',{transform:`translate(${sheet.view.x} ${sheet.view.y}) scale(${sheet.view.scale})`},screenSVG);
        drawOne(s,preview,true);
      }
    }
    function populate() {
      const raw = get('signSearch').value;
      const codeQuery = raw.match(/\b(?:OM|[RWSGM])0*\d+-0*\d+[a-z]*/i)?.[0];
      const exactCode = codeQuery?.toLowerCase().replace(/([a-z]|-)0+(?=\d)/g, '$1');
      const query = normalize(codeQuery ? raw.replace(codeQuery, '') : raw).split(' ').filter(Boolean), category = get('signCategory').value;
      const matches = groups.filter(g => g.entries.some(e => (!category || e.category === category) && (!exactCode || e.code.toLowerCase() === exactCode || e.variant.split(' ')[0].toLowerCase() === exactCode) && query.every(word => e.search.includes(word))));
      grid.replaceChildren();
      for (const group of matches) {
        const entry=group.entries.find(e=>e.id===(current()?.design??choice)) ?? group.entries[0];
        const button = document.createElement('button');button.type='button';button.className='iconGridItem';button.dataset.design=entry.id;
        button.setAttribute('aria-label',`${label(entry)} — ${group.label}`);button.title=button.getAttribute('aria-label');
        button.setAttribute('aria-pressed',String(entry.id === (current()?.design ?? choice)));
        const img = document.createElement('img');img.src=new URL(entry.src,assetBase).href;img.alt='';img.loading='lazy';button.append(img);
        const caption = document.createElement('span');caption.textContent=label(entry);button.append(caption);
        const variant = document.createElement('span');variant.className='signVariant';variant.textContent=group.label;button.append(variant);
        button.addEventListener('click',async () => {
          const target = choosingFor;
          get('signSearchStatus').textContent=`Loading ${entry.code}…`;
          try {
            await loadArt(entry.id);
            if (!picker.open || choosingFor !== target) return;
            choice=entry.id;
            const sign = target?.sheet === sheets.selected && sheets.selected.signs?.find(s => s.id === target.id);
            if (sign) {if(D.familyKey(designs.get(sign.design))!==group.key)sign.values={};sign.design=choice;changed();}
            else choiceValues={};
            placement=null;updatePanel();picker.close();tell(sign ? 'Sign changed.' : 'Click Add Sign to place it on the sheet.');
          } catch(error) {get('signSearchStatus').textContent=error.message;}
        });
        grid.append(button);
      }
      get('signSearchStatus').textContent=matches.length ? `${matches.length} matching designs` : 'No matching signs. Try another code or name.';
    }
    get('chooseSign').addEventListener('click', async () => {
      try {await loadCatalog();} catch(error) {tell(error.message);return;}
      placement=null;refreshOverlay();updatePanel();
      choosingFor=current() ? {sheet:sheets.selected,id:selected} : null;
      get('signSearch').value='';get('signCategory').value='';populate();picker.showModal();get('signSearch').focus();grid.scrollTop=0;
    });
    get('signSearch').addEventListener('input',populate);get('signCategory').addEventListener('change',populate);
    get('closeSignPicker').addEventListener('click',() => picker.close());
    picker.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); picker.close(); }
    });
    picker.addEventListener('close',() => {choosingFor=null;get('chooseSign').focus({preventScroll:true});});
    get('addSign').addEventListener('click',async () => {
      if (placement) {placement=null;refreshOverlay();updatePanel();tell('Placement canceled.');return;}
      const sheet=sheets.selected, design=current()?.design ?? choice;if (!sheet || !design)return;
      try {await loadArt(design);} catch(error) {tell(error.message);return;}
      if (sheets.selected !== sheet || !active())return;
      choice=design;choiceValues=structuredClone(values());choiceSize=current()?.size??choiceSize;selected=null;placement={};refreshOverlay();updatePanel();tell('Click the signpost location.');
    });
    get('signPhysicalSize').addEventListener('change',async event=>{
      const id=event.target.value,token=++sizeRequest,sign=current(),sheet=sheets.selected,before=sign?.design??choice;
      try{
        await loadArt(id);
        if(token!==sizeRequest || sheet!==sheets.selected || sign!==current() || before!==(current()?.design??choice))return;
        for(const field of fields(id)){
          const value=values()[field.key]??field.default,error=D.validate(value,field,app.signAlphabets);
          if(error){updatePanel();tell(error);return;}
        }
        choice=id;if(sign){sign.design=id;changed();}else{updatePanel();refreshOverlay();}
        tell('');
      }catch(error){updatePanel();tell(error.message);}
    });
    function remove() {
      if (!current())return;
      sheets.selected.signs=sheets.selected.signs.filter(s=>s.id!==selected);selected=null;changed();tell('Sign deleted.');
    }
    get('deleteSign').addEventListener('click',remove);
    get('signSize').addEventListener('input',event=>{
      const sign=current(),value=event.target.valueAsNumber;if(!Number.isFinite(value))return;
      const size=Math.max(25,Math.min(400,value));
      if(sign){sign.size=size;changed();}else{choiceSize=size;refreshOverlay();}
    });
    get('signSize').addEventListener('change',()=>{get('signSize').value=current()?.size ?? choiceSize;});
    workspace.addEventListener('pointerdown',event=>{
      if (!active() || !placement || event.button!==0 || !event.isPrimary)return;
      event.preventDefault();event.stopImmediatePropagation();
      const sheet=sheets.selected,point=sheets.toImage(event.clientX,event.clientY);
      if(point.x<0 || point.y<0 || point.x>sheet.width || point.y>sheet.height){tell('Place the sign on the sheet.');return;}
      if(!placement.post){placement.post=point;tell('Click where to show the sign face.');return;}
      const sign={id:crypto.randomUUID(),design:choice,x:point.x,y:point.y,postX:placement.post.x,postY:placement.post.y,width:80/sheet.view.scale,size:choiceSize,values:structuredClone(choiceValues)};
      (sheet.signs??=[]).push(sign);selected=sign.id;selectedSheet=sheet;placement=null;changed();tell('Drag the sign face or its yellow post handle to adjust the callout.');
    },true);
    workspace.addEventListener('pointermove',event=>{
      if(!placement?.post)return;placement.cursor=sheets.toImage(event.clientX,event.clientY);refreshOverlay();
    });
    workspace.addEventListener('dblclick',event=>{if(placement || event.target.closest('.signOverlay')){event.preventDefault();event.stopImmediatePropagation();}},true);
    overlay.addEventListener('pointerdown',event=>{
      const handle=event.target.closest('button[data-sign]');if(!handle || placement || event.button!==0)return;
      event.preventDefault();event.stopPropagation();selected=handle.dataset.sign;selectedSheet=sheets.selected;
      const sign=current();if(!sign)return;
      dragging={id:sign.id,part:handle.dataset.part,sheet:sheets.selected,pointer:event.pointerId,start:sheets.toImage(event.clientX,event.clientY),before:{...sign},handle};
      handle.setPointerCapture(event.pointerId);handle.focus({preventScroll:true});app.showEditor('signsEditor');updatePanel();
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
      selected=handle.dataset.sign;selectedSheet=sheets.selected;
      if(event.key==='Enter' || event.key===' '){event.preventDefault();app.showEditor('signsEditor');updatePanel();refreshOverlay();focusHandle(selected,handle.dataset.part);return;}
      if(!arrows[event.key])return;event.preventDefault();event.stopPropagation();
      const sign=current(),step=(event.shiftKey?10:1)/sheets.selected.view.scale,[dx,dy]=arrows[event.key],part=handle.dataset.part;
      if(part==='post'){sign.postX+=dx*step;sign.postY+=dy*step;}else{sign.x+=dx*step;sign.y+=dy*step;}
      changed();focusHandle(selected,part);
    });
    document.addEventListener('keydown',event=>{
      if(!active() || picker.open || event.target.closest('input,select,textarea,[contenteditable="true"]'))return;
      if(event.key==='Escape' && placement){event.preventDefault();event.stopImmediatePropagation();placement=null;refreshOverlay();updatePanel();tell('Placement canceled.');}
      else if((event.key==='Delete' || event.key==='Backspace') && current()){event.preventDefault();remove();}
    },true);
    new MutationObserver(()=>{if(!active())placement=null;updatePanel();refreshOverlay();}).observe(panel,{attributes:true,attributeFilter:['hidden']});
    document.addEventListener('sheetview',refreshOverlay);
    async function ready(sheet) {
      await loadCatalog();await Promise.all((sheet.signs??[]).map(s=>loadArt(s.design)));app.roadEditor.render();
    }
    for(const event of ['sheetchange','sheethistory'])document.addEventListener(event,()=>{
      placement=null;dragging=null;fieldsFor=null;invalidFields.clear();if(selectedSheet!==sheets.selected)selected=null;
      updatePanel();refreshOverlay();if(sheets.selected) { tell('Choose a sign, then click Add Sign.'); } if(sheets.selected)ready(sheets.selected).catch(error=>tell(error.message));
    });
    app.signs={draw,refreshOverlay,ready};
    loadCatalog().then(async()=>{await loadArt(choice);updatePanel();if(sheets.selected)return ready(sheets.selected);}).catch(error=>tell(error.message));
    updatePanel();
  });
})();
