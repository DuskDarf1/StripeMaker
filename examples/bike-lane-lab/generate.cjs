/* Build inspection fixtures through the running app's import, normalization,
   render, and export paths. Uses an isolated browser, never the user's storage. */
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const out=__dirname;
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
 try {
  const page=await browser.newPage({viewport:{width:1500,height:1100}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/js/elements.js',async route=>{
   const response=await route.fetch();
   const body=(await response.text()).replace('window.StripeMaker.roadEditor = {',`window.StripeMaker.roadEditor = {
    auditLab: sheet => { const solved=solve(sheet); return {
      conflicts:sheet.roads.map(road=>({road:road.id,feet:polylineLength(shapeOf(sheet,road,solved).line)*sheet.inchesPerPixel/12,ranges:[...bikeConflicts(sheet,road,shapeOf(sheet,road,solved),solved)]})),
      transitions:bikeTransitions(sheet,solved).map(t=>({road:t.road.id,entering:t.entering,feet:t.total*sheet.inchesPerPixel/12,
       edgeMismatch:Math.max(...[0,1].map(side=>{const a=boundary(t.shape,t.lane+side);const other=t.entering?t.from:t.to, lane=t.entering?t.fromLane:t.toLane;
        const b=boundary(shapeOf(sheet,other,solved),lane+side);const p=a[t.entering?0:a.length-1],q=b[t.entering?b.length-1:0];return Math.hypot(p.x-q.x,p.y-q.y);} ))}))
    }; },`);
   await route.fulfill({response,body});
  });
  await page.goto(process.env.STRIPEMAKER_URL||'http://127.0.0.1:8878');
  await page.waitForFunction(()=>StripeMaker.sheets.ready&&StripeMaker.projectJSON);
  const cases=await page.evaluate(async()=>{
   const app=StripeMaker;
   const specs=[
    ['baseline','Straight bike lane','Two travel lanes plus a bike lane. No crossing or dotted conflict is expected.'],
    ['chain','Three connected segments','Bike lane continues through two joints. Follow lane 3 across both nodes; phase should not restart.'],
    ['keyhole','Outside turn lane - no taper','The downstream road adds lane 4 OUTSIDE bike lane 3. The bike lane is linked across the joint; crossing length defaults to 150 ft.'],
    ['separate','Separate right-turn lane - 45 mph','Select the downstream road: Separate right-turn lane, design speed 45. Outside lane 4 has an 85-ft start taper.'],
    ['drop','Right-turn drop - 3 to 2','Three travel lanes become two. The right travel lane exits. Bike lane 4 connects to downstream bike lane 3; the move-over belongs before the joint.'],
    ['entry','Free-flow ramp ENTERS','Two travel lanes become three. Incoming ramp feeds lane 3; bike lane 3 connects to lane 4. Inspect the 200-ft receiving transition.'],
    ['exit','Free-flow ramp EXITS','Three travel lanes become two. Ramp splits off from travel lane 3; bike lane 4 connects to lane 3. Compare with the drop case.'],
    ['cross-exit','Crossing ramp - no lane drop','Through road keeps two travel lanes and its bike lane. A branch leaves travel lane 2 and crosses the bike lane. Dots follow pavement overlap.'],
    ['cross-entry','Crossing ramp - no lane add','Main road stays two travel lanes plus bike. Ramp merges into travel lane 2 across the bike lane; no new through lane.'],
    ['beside','Ramp starts beside bike lane','Ramp attaches edge-to-edge OUTSIDE the bike lane. Compare with a head-on lane feed; these links are different.'],
    ['bus','Bus bay - entry and exit tapers','Outside lane 4 has 80-ft tapers at BOTH ends. Bike lane stays straight; dotted crossings at both tapers, solid between.'],
    ['approach','Attached intersection approach','Bike lane reaches an attached intersection mouth. Inspect the last 150 ft of its inside line/buffer. No intersection movements are assigned.'],
    ['crosswalk','Crosswalk - bike emphasis bars','Bike lane lies between two vehicle lanes. Inspect the 12-inch bike boundary bars, 24-inch vehicle bars, and clear bike riding space.'],
    ['crosswalk-skew','Skew crosswalk - bike emphasis bars','Same crosswalk at an angle. Bike-boundary bars stay 12 inches wide measured across the lane; buffered lines stop inside the crosswalk.'],
    ['green-entry','Manual green at ramp entry','Explicit green pavement spans the connected bike lanes across a ramp entry. It follows the white dotted phase and leaves the weaving gap unpainted.'],
    ['paint','Manual green across three nodes','One manually placed colored-pavement span covers connected bike lanes. This is explicit marking-tool data, never automatic green.'],
    ['curve','Drop with skew and width change','Drop geometry with an independently turned receiving end and wider receiving bike lane. Check both white boundaries at the joint.'],
    ['unjoined','NEGATIVE - ramp not joined','Ramp visually touches the joint but uses a DIFFERENT joint ID. It is not connected. Matching position alone does not create a conflict.'],
    ['short','NEGATIVE - drop approach too short','Only 70 ft before the drop, less than the 100-ft move-over treatment. Select the approach and read the length warning.'],
    ['two-way','Two-way road with bike lanes','Opposite three-lane road groups paired at both ends: two travel lanes and one bike lane in each direction.']
   ];
   for(const speed of [35,40,50,55,60,65])specs.push(['speed-'+speed,'Separate turn - '+speed+' mph','Outside turn-lane start taper follows the design-speed table. Compare with the 45 mph case.']);
   specs.push(['track','Two-way bike track','A 12-ft two-way track beside travel lanes. It has a broken yellow centerline and is excluded from ordinary keyhole conflict logic.']);
   const result=[];
   for(const [kind,title,note] of specs)for(const type of (kind.startsWith('speed-')||kind==='track'?['bufferedBike']:['bike','bufferedBike'])) {
    const index=result.length+1,style=kind==='track'?'track':type==='bike'?'plain':'buffered';
    const name=String(index).padStart(2,'0')+' '+title+' ['+style+']';
    const data={name,inchesPerPixel:6,view:null,blank:false,autoTapers:false,roads:[],joints:[],gores:[],medians:[],intersections:[],signs:[],markings:[],lines:[],bridges:[],surfaces:[]};
    const bike=(conflict='auto')=>({type,width:type==='bike'?5:7,conflict,inherited:false});
    const joint=(id,x,y,root,dir={x:0,y:-1},links=[])=>({id,x,y,root,dir,links});
    const road=(id,lanes,a,b,lane=null,conflict='auto')=>({id,lanes,laneWidth:12,ends:[{joint:a,sign:1,length:null},{joint:b,sign:1,length:null}],tapers:{},...(lane==null?{}:{laneTypes:{[lane]:bike(conflict)}})});
    const link=(a,ai,b,bi,extra={})=>({a,ai,b,bi,...extra});
    data.roads=[road(1,3,1,2,2)];data.joints=[joint(1,650,1900,1),joint(2,650,350,1)];
    function chain() {
     data.joints=[joint(1,650,1900,1),joint(2,650,1400,1,{x:0,y:-1},[0,1,2].map(k=>link(1,k,2,k))),joint(3,650,900,2,{x:0,y:-1},[0,1,2].map(k=>link(2,k,3,k))),joint(4,650,350,3)];
     data.roads=[road(1,3,1,2,2),road(2,3,2,3,2),road(3,3,3,4,2)];
    }
    if(['chain','paint'].includes(kind))chain();
    if(kind==='paint')data.surfaces=data.roads.map((r,order)=>({id:'green-'+r.id,span:'manual-green-span',order,on:{road:r.id,lane:2},from:0,to:1,color:'green',pattern:'conflict'}));
    if(kind==='keyhole'||kind==='separate'||kind.startsWith('speed-')) {
     const speed=kind.startsWith('speed-')?Number(kind.split('-')[1]):45;
     const length={35:70,40:80,45:85,50:105,55:125,60:145,65:170}[speed];
     data.joints=[joint(1,650,1900,1),joint(2,650,1450,1,{x:0,y:-1},[0,1,2].map(k=>link(1,k,2,k))),joint(3,650,350,2)];
     data.roads=[road(1,3,1,2,2),road(2,4,2,3,2,kind==='keyhole'?'auto':'separate')];
     if(kind!=='keyhole'){data.roads[1].laneTypes[2].designSpeed=speed;data.roads[1].tapers={'0:3':{mode:'taper',length}};}
    }
    if(['drop','entry','green-entry','exit','cross-exit','cross-entry','beside','curve','unjoined','short'].includes(kind)) {
     const entering=['entry','green-entry','cross-entry'].includes(kind),drop=['drop','exit','curve','short'].includes(kind);
     const conflict=kind==='drop'||kind==='curve'||kind==='short'?'drop':kind.startsWith('cross-')?'channelized':kind==='unjoined'?'auto':'freeflow';
     data.joints=[joint(1,650,1900,1),joint(2,650,1200,1),joint(3,650,350,2),joint(4,1250,entering?1750:550,3,{x:entering?-.7:.7,y:-.7})];
     data.roads=[road(1,drop?4:3,1,2,drop?3:2,conflict),road(2,entering&&['entry','green-entry'].includes(kind)?4:3,2,3,['entry','green-entry'].includes(kind)?3:2,conflict),road(3,1,entering?4:2,entering?2:4)];
     data.roads[2].ends[entering?1:0].length=180;
     const links=[link(1,0,2,0),link(1,1,2,1),link(1,drop?3:2,2,['entry','green-entry'].includes(kind)?3:2)];
     if(entering)links.push(link(3,0,2,['entry','green-entry'].includes(kind)?2:1,{feed:true}));
     else if(kind==='beside')links.push(link(2,'R',3,'L'));
     else links.push(link(1,drop?2:1,3,0,{feed:true}));
     data.joints[1].links=links;
     if(kind==='curve'){data.roads[1].ends[0].dir={x:.08,y:-Math.sqrt(1-.08*.08)};data.roads[1].laneTypes[2].width=type==='bike'?6:9;data.joints[2].x=680;}
     if(kind==='short')data.joints[0].y=1340;
     if(kind==='unjoined'){data.joints[1].links=links.slice(0,3);data.joints.push(joint(5,650,1200,3));data.roads[2].ends[0].joint=5;}
    }
    if(kind==='green-entry')data.surfaces=[{id:'green-up',span:'manual-crossing',order:0,on:{road:1,lane:2},from:0,to:1,color:'green',pattern:'conflict'},{id:'green-down',span:'manual-crossing',order:1,on:{road:2,lane:3},from:0,to:1,color:'green',pattern:'conflict'}];
    if(kind.startsWith('crosswalk')){
     data.roads[0].laneTypes={1:bike()};
     const half=24+(type==='bike'?5:7)+4/3;
     data.markings=[{id:'crosswalk',type:'crosswalkSpecial',width:10,contrast:true,a:{x:650-half,y:1100},b:{x:650+half,y:kind==='crosswalk-skew'?1140:1100}}];
    }
    if(kind==='bus'){data.roads[0].lanes=4;data.roads[0].tapers={'0:3':{mode:'taper',length:80},'1:3':{mode:'taper',length:80}};}
    if(kind==='two-way'){
     data.roads.push(road(2,3,2,1,2));data.roads[1].ends.forEach(e=>e.sign=-1);
     for(const j of data.joints)j.links=[link(1,0,2,0,{pair:true,median:0})];
    }
    if(kind==='track')data.roads[0].laneTypes[2]={type:'twoWayBike',width:12};
    if(kind==='approach') {
     data.joints[1].y=850;
     data.roads.push(road(2,2,3,4),road(3,2,5,6),road(4,2,7,8));
     data.joints.push(joint(3,650,550,2),joint(4,650,300,2),joint(5,350,700,3,{x:1,y:0}),joint(6,500,700,3,{x:1,y:0}),joint(7,800,700,4,{x:1,y:0}),joint(8,1100,700,4,{x:1,y:0}));
    }
    // Text lives on the background, leaving every pavement marking editable.
    const canvas=document.createElement('canvas');canvas.width=2200;canvas.height=2200;
    const c=canvas.getContext('2d');c.fillStyle='#f4f6f9';c.fillRect(0,0,2200,2200);c.fillStyle='#14263d';c.font='bold 42px sans-serif';c.fillText(name,70,90);
    c.font='28px sans-serif';
    function wrap(text,x,y,max){let line='';for(const word of text.split(' ')){if(c.measureText(line+word).width>max){c.fillText(line,x,y);y+=40;line='';}line+=word+' ';}c.fillText(line,x,y);return y;}
    wrap(note,1350,500,750);
    wrap('Traffic on the main road flows UP. Travel lanes: 12 ft. Bike lane: '+(kind==='track'?12:type==='bike'?5:7)+' ft. Auto tapers OFF.',1350,900,750);
    wrap('Select a road in Elements to inspect Bike Lane Setup. Lane numbers in these notes count from the left, starting at 1.',1350,1180,750);
    wrap(['paint','green-entry'].includes(kind)?'GREEN IS MANUALLY PLACED in this example.':'NO AUTOMATIC GREEN. Add colored pavement yourself with Markings.',1350,1500,750);
    c.font='24px sans-serif';c.fillText('Editable inspection fixture; not a construction plan or a compliance certification.',70,2120);
    const project={format:'StripeMakerProject',version:1,minReaderVersion:1,selectedSheet:index,settings:{},shortcuts:{},sheets:[{id:index,width:2200,height:2200,data,file:{name:name.replaceAll('/','-')+'.png',type:'image/png',lastModified:0,base64:canvas.toDataURL('image/png').split(',')[1]}}]};
    const [sheet]=await app.projectJSON.load(project);
    if(kind==='approach'){app.intersections.makeAt(sheet,{x:650,y:700},[2,3,6,7]);document.dispatchEvent(new Event('sheetchange'));}
    app.roadEditor.render();
    const first=JSON.stringify([sheet.roads,sheet.joints]);document.dispatchEvent(new Event('sheetchange'));
    if(first!==JSON.stringify([sheet.roads,sheet.joints]))throw Error(name+': non-idempotent upkeep');
    const audit=app.roadEditor.auditLab(sheet);
    if(sheet.roadLayer.outerHTML.includes('NaN'))throw Error(name+': NaN render');
    if(audit.transitions.some(t=>t.edgeMismatch>.05))throw Error(name+': disconnected edges '+JSON.stringify(audit.transitions));
    const ranges=audit.conflicts.flatMap(r=>r.ranges.flatMap(([k,ranges])=>ranges));
    const negative=['baseline','chain','paint','unjoined','two-way','track','crosswalk','crosswalk-skew'].includes(kind);
    if(!negative&&!ranges.length)throw Error(name+': no conflict markings activated');
    if(negative&&ranges.length)throw Error(name+': unexpected conflict markings');
    app.sheets.save(sheet);
    result.push({id:sheet.id,name,kind,type,note,audit});
   }
   // Start at the first example after import; preserve a fitted view for each.
   document.querySelector('button.headListButton[data-sheet-id="'+result[0].id+'"]').click();
   return result;
  });
  assert.equal(errors.length,0,errors.join('\n'));
  const project=await page.evaluate(()=>StripeMaker.projectJSON.snapshot());
  await fs.writeFile(path.join(out,'Bike Lane Inspection Library.json'),JSON.stringify(project,null,2));
  await fs.writeFile(path.join(out,'audit.json'),JSON.stringify(cases,null,2));
  // Re-import the final delivered bytes into a second empty browser context.
  const verify=await browser.newPage({viewport:{width:1500,height:1100}});
  verify.on('pageerror',e=>errors.push(e.message));
  await verify.goto(process.env.STRIPEMAKER_URL||'http://127.0.0.1:8878');
  await verify.waitForFunction(()=>StripeMaker.sheets.ready&&StripeMaker.projectJSON);
  await verify.evaluate(p=>StripeMaker.projectJSON.load(p),project);
  assert.equal(await verify.evaluate(()=>StripeMaker.sheets.all.length),cases.length);
  for(const c of cases) {
   const state=await verify.evaluate(id=>{
    document.querySelector('button.headListButton[data-sheet-id="'+id+'"]').click();
    const s=StripeMaker.sheets.selected;StripeMaker.roadEditor.render();return {data:StripeMaker.sheets.snapshot(s),bad:s.roadLayer.outerHTML.includes('NaN')};
   },c.id);
   if(['drop','entry','separate','cross-exit','approach','crosswalk-skew','green-entry'].includes(c.kind)&&c.type==='bufferedBike')await verify.screenshot({path:'/tmp/bike-lab-'+c.kind+'.png'});
   const expected=project.sheets.find(s=>s.id===c.id).data;
   // Fitted viewport coordinates can change, but editable design data must not.
   delete state.data.view;const {view,...design}=expected;assert.deepEqual(state.data,design,c.name);assert(!state.bad,c.name);
  }
  assert.deepEqual(errors,[]);
  console.log('PASS: '+cases.length+' labeled sheets, active conflict ranges, finite geometry, matched transition edges, idempotent upkeep, and exact final-file re-import.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
