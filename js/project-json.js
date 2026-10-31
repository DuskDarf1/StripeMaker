/* Portable editable projects. Original sheet files are embedded, never fetched.
   Uses the existing SignalMaker-derived buttons/fields (GPL-3.0). */
(() => {
  const FORMAT='StripeMakerProject', VERSION=1;
  const COLLECTIONS=['roads','joints','gores','medians','intersections','signs','markings','lines','bridges','surfaces'];
  const DATA_KEYS=new Set(['name','inchesPerPixel','view','autoTapers','blank','width','height',...COLLECTIONS]);
  const RUNTIME_KEYS=new Set(['content','file','url','roadLayer','id','projectArchive']);
  const pick=(value,predicate)=>Object.fromEntries(Object.entries(value).filter(([key])=>predicate(key)));
  const fail=message=>{throw Error(message);};
  const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
  const finite=v=>typeof v==='number'&&Number.isFinite(v);
  const id=v=>Number.isSafeInteger(v)&&v>0;
  function inspect(value,depth=0) {
    if(depth>100)fail('Project nesting is too deep.');
    if(typeof value==='number'&&!Number.isFinite(value))fail('Project contains a non-finite coordinate or number.');
    if(value&&typeof value==='object')for(const [key,item] of Object.entries(value)) {
      if(['__proto__','constructor','prototype'].includes(key))fail('Unsupported object property.');
      if(key==='src'&&typeof item==='string'&&!/^data:image\/(png|jpeg|webp);base64,/i.test(item))fail('Imported images must be embedded PNG, JPEG, or WebP data.');
      inspect(item,depth+1);
    }
  }
  function validate(project) {
    inspect(project);
    if(!object(project)||project.format!==FORMAT)fail('This is not a StripeMaker project JSON file.');
    if(!id(project.version)||!id(project.minReaderVersion??project.version)||(project.minReaderVersion??project.version)>project.version||(project.minReaderVersion??project.version)>VERSION)fail('Unsupported project version. This app supports reader version '+VERSION+'.');
    if(!Array.isArray(project.sheets)||!project.sheets.length)fail('The project has no sheets.');
    const sheetIds=new Set();
    for(const sheet of project.sheets) {
      if(!object(sheet)||!id(sheet.id)||sheetIds.has(sheet.id))fail('Invalid or duplicate sheet ID.');
      sheetIds.add(sheet.id);
      const d=sheet.data;
      if(!object(d)||Object.keys(d).some(k=>RUNTIME_KEYS.has(k)))fail('Unsupported runtime sheet fields.');
      if(typeof d.name!=='string'||!finite(sheet.width)||!finite(sheet.height)||sheet.width<=0||sheet.height<=0)fail('Invalid sheet name or dimensions.');
      if(d.inchesPerPixel!=null&&(!finite(d.inchesPerPixel)||d.inchesPerPixel<=0))fail('Invalid sheet scale.');
      if(d.view!=null&&(!object(d.view)||!finite(d.view.x)||!finite(d.view.y)||!finite(d.view.scale)||d.view.scale<=0))fail('Invalid sheet view.');
      if(d.blank&&(!finite(d.width)||!finite(d.height)||d.width<=0||d.height<=0||d.width!==sheet.width||d.height!==sheet.height))fail('Invalid blank sheet dimensions.');
      const file=sheet.file;
      if(!object(file)||typeof file.name!=='string'||!(/\.(png|jpe?g|tiff?)$/i.test(file.name))||typeof file.base64!=='string'||!file.base64.length||file.base64.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(file.base64))fail('Missing or invalid embedded sheet image.');
      for(const key of COLLECTIONS)if(!Array.isArray(d[key])||d[key].some(item=>!object(item)))fail('Invalid '+key+' collection.');
      const roads=new Map(),joints=new Map();
      for(const r of d.roads) {
        if(!id(r.id)||roads.has(r.id)||!Number.isInteger(r.lanes)||r.lanes<1||r.lanes>999||!finite(r.laneWidth)||r.laneWidth<=0||!Array.isArray(r.ends)||r.ends.length!==2)fail('Invalid road or lane count.');
        if(r.ends.some(e=>!object(e)||!id(e.joint)||![1,-1].includes(e.sign)))fail('Invalid road end.');
        roads.set(r.id,r);
      }
      for(const j of d.joints) {
        if(!id(j.id)||joints.has(j.id)||!finite(j.x)||!finite(j.y)||!Array.isArray(j.links))fail('Invalid joint.');
        joints.set(j.id,j);
      }
      for(const r of roads.values())for(const end of r.ends)if(!joints.has(end.joint))fail('Road refers to a missing joint.');
      for(const j of joints.values())for(const link of j.links) {
        if(!object(link))fail('Invalid lane link.');
        for(const [ref,lane] of [[link.a,link.ai],[link.b,link.bi]]) {
          const road=roads.get(ref);
          if(!road||!road.ends.some(e=>e.joint===j.id))fail('Lane link refers to a missing road or wrong joint.');
          if(!['L','R'].includes(lane)&&(!Number.isInteger(lane)||lane<0||lane>=road.lanes))fail('Lane link refers to a missing lane.');
        }
      }
      for(const median of d.medians)if(!Array.isArray(median.points)||median.points.some(p=>!finite(p.x)||!finite(p.y)))fail('Invalid median points.');
      for(const item of d.intersections)if(!Array.isArray(item.approaches)||item.approaches.length<2||item.approaches.some(a=>!object(a)||!finite(a.x)||!finite(a.y)||!finite(a.angle)))fail('Invalid intersection approaches.');
      for(const surface of d.surfaces) {
        const road=roads.get(surface.on?.road);
        if(!road||!Number.isInteger(surface.on.lane)||surface.on.lane<0||surface.on.lane>=road.lanes||!finite(surface.from)||!finite(surface.to)||surface.from<0||surface.to>1||surface.from>=surface.to)fail('Invalid colored pavement placement.');
      }
    }
    if(!sheetIds.has(project.selectedSheet))fail('Selected sheet is missing.');
    if(project.settings!=null&&!object(project.settings))fail('Invalid settings.');
    if(project.shortcuts!=null&&(!object(project.shortcuts)||Object.values(project.shortcuts).some(v=>typeof v!=='string')))fail('Invalid shortcuts.');
    return project;
  }
  if(typeof module!=='undefined')module.exports={validate,FORMAT,VERSION};
  if(typeof document==='undefined')return;
  // Bounded session evidence; never read cookies, arbitrary storage, or file paths.
  const errors=[];
  const clean=text=>String(text??'').replace(/https?:\/\/[^\s)]+/g,url=>url.split(/[?#]/)[0]);
  const errorRecord=(kind,error)=>{errors.push({at:new Date().toISOString(),kind,message:clean(error?.message??error),stack:clean(error?.stack)});if(errors.length>50)errors.shift();};
  window.addEventListener('error',event=>errorRecord('error',event.error??event.message));
  window.addEventListener('unhandledrejection',event=>errorRecord('unhandledrejection',event.reason));
  document.addEventListener('DOMContentLoaded',()=>{ 
    const app=window.StripeMaker,exportButton=document.getElementById('exportProject'),importButton=document.getElementById('importProject');
    const input=document.getElementById('projectFile'),exportStatus=document.getElementById('projectExportStatus'),importStatus=document.getElementById('projectImportStatus');
    const encode=file=>new Promise((resolve,reject)=>{
      const reader=new FileReader();reader.onerror=()=>reject(reader.error);reader.onload=()=>resolve(reader.result.split(',')[1]);reader.readAsDataURL(file);
    });
    function diagnostics(sheets) {
      const attempt=fn=>{try{return fn();}catch(error){return {error:clean(error.message)};}};
      return {
        userAgent:navigator.userAgent,language:navigator.language,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,
        theme:document.documentElement.dataset.theme,systemDark:matchMedia('(prefers-color-scheme: dark)').matches,
        viewport:{width:innerWidth,height:innerHeight,pixelRatio:devicePixelRatio},
        controls:[...document.querySelectorAll('input:not([type=file]):not([type=password]),select,textarea')].filter(el=>el.id).map(el=>({id:el.id,value:el.value,...(['checkbox','radio'].includes(el.type)?{checked:el.checked}:{}),disabled:el.disabled})),
        openPanels:[...document.querySelectorAll('.editor,[role=dialog],dialog')].filter(el=>el.getClientRects().length).map(el=>el.id),
        editors:Object.fromEntries(['roadEditor','markings','intersections','signs','selection','longitudinal','levels'].map(key=>[key,attempt(()=>app[key]?.diagnostics?.())])),
        errors:structuredClone(errors),history:app.history?.diagnostics?.(sheets.map(s=>s.id)),
        sheets:sheets.map(sheet=>({id:sheet.id,counts:Object.fromEntries(COLLECTIONS.map(key=>[key,sheet[key]?.length??0])),
          laneTracks:attempt(()=>app.roadEditor.laneTracks(sheet)),intersectionTracks:attempt(()=>app.intersections.laneTracks(sheet)),
          // Exact existing render, if this sheet has been displayed; never rerender to collect evidence.
          renderedSVG:sheet.roadLayer?.outerHTML??null}))
      };
    }
    async function snapshot(scope='all') {
      if(!app.sheets.ready)throw Error('Sheets are still loading. Try again in a moment.');
      const sheets=scope==='selected'?[app.sheets.selected].filter(Boolean):app.sheets.all;
      if(!sheets.length)throw Error('Add a sheet first.');
      // Freeze mutable geometry before awaiting image encoding.
      const records=sheets.map(sheet=>({id:sheet.id,width:sheet.width,height:sheet.height,data:{...sheet.projectArchive?.unknownData,...app.sheets.snapshot(sheet)},source:sheet.file,archive:sheet.projectArchive?structuredClone(sheet.projectArchive):undefined}));
      const project={format:FORMAT,version:VERSION,minReaderVersion:VERSION,producer:{name:'StripeMaker',exporterRevision:'2026-10-31.2'},exportedAt:new Date().toISOString(),selectedSheet:app.sheets.selected?.id??records[0].id,
        settings:app.settings.snapshot(),shortcuts:app.shortcuts.snapshot(),
        diagnostics:diagnostics(sheets),sheets:[]};
      for(const record of records) {
        const {source,archive,...data}=record;
        project.sheets.push({...archive?.sheet,...data,...(archive?{source:archive}:{}),file:{...archive?.file,name:source.name,type:source.type,lastModified:source.lastModified,base64:await encode(source)}});
      }
      // JSON cannot represent NaN/Infinity. Keep their exact location/value as evidence.
      const invalidNumbers=[];
      const scan=(value,path)=>{if(typeof value==='number'&&!Number.isFinite(value))invalidNumbers.push({path,value:String(value)});
        else if(value&&typeof value==='object')for(const [key,item] of Object.entries(value))scan(item,[...path,key]);};
      for(const sheet of project.sheets)scan(sheet.data,['sheets',String(sheet.id),'data']);
      project.diagnostics.invalidNumbers=invalidNumbers;
      return project;
    }
    async function load(project,{applySettings=false}={}) {
      validate(project);
      const entries=project.sheets.map(s=>{
        const binary=atob(s.file.base64),bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
        const archive=structuredClone({project:pick(project,key=>key!=='sheets'),sheet:pick(s,key=>!['data','file','source'].includes(key)),
          file:pick(s.file,key=>!['name','type','lastModified','base64'].includes(key)),
          unknownData:pick(s.data,key=>!DATA_KEYS.has(key)),originalData:structuredClone(s.data),
          ...(s.source?{previous:s.source}: {})});
        return {...s,data:structuredClone(pick(s.data,key=>DATA_KEYS.has(key))),projectArchive:archive,file:new File([bytes],s.file.name,{type:s.file.type||'',lastModified:s.file.lastModified??0})};
      });
      const added=await app.sheets.importProject(entries,project.selectedSheet);
      if(applySettings) {
        const s=project.settings??{};
        if(finite(s.signArrowWeight)&&s.signArrowWeight>=25&&s.signArrowWeight<=400)app.settings.set('signArrowWeight',s.signArrowWeight);
        if(Number.isInteger(s.hideLevelsAbove)&&s.hideLevelsAbove>=0&&s.hideLevelsAbove<=9)app.settings.set('hideLevelsAbove',s.hideLevelsAbove);
        if(typeof s.autoContrast==='boolean')app.settings.set('autoContrast',s.autoContrast);
        if(['all','undo-redo','none'].includes(s.keybindMode))app.settings.set('keybindMode',s.keybindMode);
        app.shortcuts.restore(project.shortcuts??{});
      }
      return added;
    }
    exportButton.addEventListener('click',async()=>{
      exportButton.disabled=true;exportStatus.textContent='Preparing project JSON…';
      try {
        const project=await snapshot(document.getElementById('projectExportScope').value);
        const blob=new Blob([JSON.stringify(project,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob);
        const link=document.createElement('a');link.href=url;link.download='StripeMaker-project.json';link.click();
        setTimeout(()=>URL.revokeObjectURL(url),30000);
        exportStatus.textContent=`Exported ${project.sheets.length} sheet${project.sheets.length===1?'':'s'}.`;
      } catch(error) {exportStatus.textContent='Could not export: '+error.message;}
      finally {exportButton.disabled=false;}
    });
    importButton.addEventListener('click',()=>input.click());
    input.addEventListener('change',async()=>{
      const file=input.files[0];if(!file)return;
      importButton.disabled=true;importStatus.textContent='Reading project JSON…';
      try {
        const project=JSON.parse(await file.text());
        const added=await load(project,{applySettings:document.getElementById('projectImportSettings').checked});
        importStatus.textContent=`Imported ${added.length} sheet${added.length===1?'':'s'}. Existing sheets preserved.`;
        if(project.version>VERSION||project.sheets.some(s=>Object.keys(s.data).some(key=>!DATA_KEYS.has(key))))importStatus.textContent+=' Additional data retained for re-export; newer features may not be editable here.';
      } catch(error) {importStatus.textContent='Could not import: '+error.message;}
      finally {input.value='';importButton.disabled=false;}
    });
    app.projectJSON={snapshot,load,validate};
  });
})();
