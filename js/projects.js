/* Open-project workspace. SignalMaker's standard fieldRow/headActions controls
   and browser storage conventions (GPL-3.0). Portable JSON stays version 1;
   workspace names and separate databases are local application metadata only. */
(() => {
  const app=window.StripeMaker??={},DEFAULT={active:'default',items:[{id:'default',name:'Project 1',open:true}]};
  const databaseFor=id=>id==='default'?'StripeMaker':`StripeMaker-project-${id}`;
  const database=new Promise((resolve,reject)=>{
    const request=indexedDB.open('StripeMaker',1);
    request.onupgradeneeded=()=>{for(const name of ['files','sheets','meta'])request.result.createObjectStore(name);};
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
  });
  async function storage(mode,value){
    const db=await database;
    return new Promise((resolve,reject)=>{
      const tx=db.transaction('meta',mode),store=tx.objectStore('meta');
      const request=value?store.put(value,'projects'):store.get('projects');
      tx.oncomplete=()=>resolve(request.result);tx.onerror=tx.onabort=()=>reject(tx.error??Error('Project storage unavailable.'));
    });
  }
  let registry=structuredClone(DEFAULT),startupError=null,busy=false;
  const ready=storage('readonly').then(saved=>{
    if(saved?.items?.length&&saved.items.every(p=>typeof p.id==='string'&&/^[\w-]+$/.test(p.id)&&typeof p.name==='string')){
      registry=saved;
      if(!registry.items.some(p=>p.id===registry.active&&p.open))registry.active=registry.items.find(p=>p.open)?.id??registry.items[0].id;
      registry.items.find(p=>p.id===registry.active).open=true;
    }
    return databaseFor(registry.active);
  }).catch(error=>{startupError=error;return 'StripeMaker';});
  // Available before sheets.js starts restoring the active database.
  app.projectWorkspace={ready,databaseFor};
  document.addEventListener('DOMContentLoaded',()=>{
    const get=id=>document.getElementById(id),status=get('projectStatus');
    const active=()=>registry.items.find(p=>p.id===registry.active);
    const notify=()=>{render();document.dispatchEvent(new CustomEvent('projectchange'));};
    function render(){
      for(const [id,open] of [['projectSelect',true],['closedProjectSelect',false]]){
        const select=get(id);select.replaceChildren();
        if(!open)select.add(new Option('Choose a closed project…',''));
        for(const p of registry.items.filter(p=>Boolean(p.open)===open))select.add(new Option(p.name,p.id));
        if(open)select.value=registry.active;
        select.disabled=busy;
      }
      get('sheetsMenu').inert=busy;
      get('closedProjectsRow').hidden=!registry.items.some(p=>!p.open);
      if(document.activeElement!==get('projectName'))get('projectName').value=active()?.name??'';
      for(const id of ['newProject','openProject','closeProject','projectName','importProject','uploadSheet','blankSheet'])get(id).disabled=busy;
      get('closeProject').disabled=busy||registry.items.filter(p=>p.open).length<2;
    }
    async function run(work){
      if(busy)throw Error('A project is already opening.');
      if(!app.sheets.ready)throw Error('Sheets are still loading. Try again in a moment.');
      busy=true;render();status.textContent='Saving and opening project…';
      try {const result=await work();status.textContent='';return result;}
      catch(error){status.textContent=`Could not change project: ${error.message}`;throw error;}
      finally{busy=false;notify();}
    }
    async function activate(id){
      const target=registry.items.find(p=>p.id===id);if(!target)throw Error('Project not found.');
      const previous=registry.active,next=structuredClone(registry);next.active=id;next.items.find(p=>p.id===id).open=true;
      await app.sheets.activateProject(databaseFor(id));
      try{await storage('readwrite',next);registry=next;}
      catch(error){await app.sheets.activateProject(databaseFor(previous),{discardCurrent:true});throw error;}
    }
    async function create(name,project,options){
      const id=crypto.randomUUID(),previous=registry.active;
      const item={id,name:String(name||`Project ${registry.items.length+1}`).trim().slice(0,80)||'Untitled project',open:true};
      await app.sheets.activateProject(databaseFor(id));
      try{
        if(project)await app.projectJSON.load(project,options);
        await app.sheets.flush();
        const next={active:id,items:[...registry.items,item]};await storage('readwrite',next);registry=next;
      }catch(error){await app.sheets.activateProject(databaseFor(previous),{discardCurrent:true});throw error;}
      return id;
    }
    const api=app.projects={
      get active(){return {...active()};},get all(){return structuredClone(registry.items);},get busy(){return busy;},
      switch:id=>run(()=>activate(id)),
      create:name=>run(()=>create(name)),
      openJSON:(project,name,options={})=>{app.projectJSON.validate(project);return run(()=>create(name,project,options));},
      rename:name=>run(async()=>{name=String(name).trim().slice(0,80);if(!name)throw Error('Enter a project name.');const next=structuredClone(registry);next.items.find(p=>p.id===next.active).name=name;await storage('readwrite',next);registry=next;}),
      close:()=>run(async()=>{
        const closing=registry.active,other=registry.items.find(p=>p.open&&p.id!==closing);
        if(!other)throw Error('Keep at least one project open.');
        await activate(other.id);const next=structuredClone(registry);next.items.find(p=>p.id===closing).open=false;await storage('readwrite',next);registry=next;
      }),
    };
    const handle=action=>Promise.resolve().then(action).catch(error=>{status.textContent=error.message;});
    get('projectSelect').addEventListener('change',e=>handle(()=>api.switch(e.target.value)));
    get('closedProjectSelect').addEventListener('change',e=>{if(e.target.value)handle(()=>api.switch(e.target.value));});
    get('newProject').onclick=()=>handle(()=>api.create());
    get('closeProject').onclick=()=>handle(()=>api.close());
    get('projectName').addEventListener('change',e=>handle(()=>api.rename(e.target.value)));
    get('openProject').onclick=()=>get('openProjectFile').click();
    get('openProjectFile').addEventListener('change',async e=>{
      const files=[...e.target.files];e.target.value='';
      for(const file of files){try{await api.openJSON(JSON.parse(await file.text()),file.name.replace(/\.json$/i,''),{applySettings:get('projectImportSettings').checked});}catch(error){status.textContent=`Could not open ${file.name}: ${error.message}`;break;}}
    });
    document.addEventListener('sheetsinitialized',()=>app.sheets.initialized.then(()=>{notify();if(startupError)status.textContent=`Project list unavailable: ${startupError.message}`;}),{once:true});
  });
})();
