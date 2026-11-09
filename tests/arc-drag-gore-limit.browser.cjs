const assert=require('node:assert/strict'),path=require('node:path'),{pathToFileURL}=require('node:url'),fs=require('node:fs/promises'),zlib=require('node:zlib');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fixture=require('./fixtures/arc-fit-disabled.json');
const near=(a,b,tolerance=1e-7)=>assert.ok(Math.hypot(a.x-b.x,a.y-b.y)<tolerance,`points differ: ${JSON.stringify(a)} / ${JSON.stringify(b)}`);
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
 try{
  const page=await browser.newPage({viewport:{width:1600,height:1100}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(pathToFileURL(path.resolve(__dirname,'../index.html')).href);await page.waitForFunction(()=>StripeMaker.sheets.ready);
  await page.locator('#blankSheet').evaluate(b=>b.click());await page.waitForFunction(()=>StripeMaker.sheets.selected);
  const setup=async(road=22)=>page.evaluate(({f,road})=>{
   const A=StripeMaker,s=A.sheets.selected;Object.assign(s,structuredClone(f));
   for(const id of [22,23])s.roads.find(r=>r.id===id).arcJoinFit=true;
   s.gores=[];s.view={scale:10,x:-2500,y:-2500};A.sheets.zoomBy(1);
   A.roadEditor.focusRoad(s.roads.find(r=>r.id===road));A.history.rebase();
  },{f:fixture,road});
  await setup();
  // Compare the actual rasterized drawing inside the through lanes, before
  // and after a fully painted gore. Its chevrons used to reach into this road.
  const raster=()=>page.evaluate(async()=>{
   const A=StripeMaker,s=A.sheets.selected,svg=s.roadLayer.cloneNode(true);
   svg.setAttribute('xmlns','http://www.w3.org/2000/svg');svg.setAttribute('viewBox','295 290 85 85');svg.setAttribute('width','850');svg.setAttribute('height','850');
   svg.querySelector('.roadSelection')?.remove();
   const style=document.createElementNS(svg.namespaceURI,'style');style.textContent=`.roadBand{fill:${A.settings.pavementColor()};stroke:${A.settings.pavementColor()};stroke-width:.6px}.roadMarking{fill:none}.roadOutline,.preview{display:none}`;svg.prepend(style);
   const url=URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)],{type:'image/svg+xml'}));
   try{
    const image=new Image();image.src=url;await image.decode();const canvas=document.createElement('canvas');canvas.width=canvas.height=850;
    const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);
    const track=A.roadEditor.laneTracks(s).find(t=>t.road===7),polygon=[...track.markingEdges[0],...track.markingEdges.at(-1).slice().reverse()];
    const distance=p=>Math.min(...polygon.map((a,i)=>{const b=polygon[(i+1)%polygon.length],x=b.x-a.x,y=b.y-a.y,f=Math.max(0,Math.min(1,((p.x-a.x)*x+(p.y-a.y)*y)/(x*x+y*y||1)));return Math.hypot(p.x-a.x-x*f,p.y-a.y-y*f)}));
    const inside=p=>{let yes=false;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++) {const a=polygon[i],b=polygon[j];if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)yes=!yes;}return yes;};
    const samples=[];
    for(let y=343;y<351;y+=.25)for(let x=314;x<335;x+=.25)if(inside({x,y})&&distance({x,y})>.5)
     samples.push([...ctx.getImageData(Math.round((x-295)*10),Math.round((y-290)*10),1,1).data]);
    return {samples,png:canvas.toDataURL().split(',')[1]};
   }finally{URL.revokeObjectURL(url);}
  });
  const unpainted=await raster();
  await page.evaluate(()=>{const A=StripeMaker,s=A.sheets.selected;s.gores=[{key:'22:0|23:0',length:10000,spacing:20}];A.roadEditor.render();});
  const painted=await raster();
  assert.ok(painted.samples.length>100);assert.deepEqual(painted.samples,unpainted.samples,'the gore adds no pavement or paint inside the receiving through lanes');
  await fs.writeFile('/tmp/stripemaker-gore-at-receiving-road.png',Buffer.from(painted.png,'base64'));
  const boundary=await page.evaluate(()=>{
   const A=StripeMaker,s=A.sheets.selected,edges=A.roadEditor.paintedGoreEdges(s),tracks=A.roadEditor.laneTracks(s).filter(t=>[7,21].includes(t.road));
   return {edges,receiving:tracks.map(t=>[...t.markingEdges[0],...t.markingEdges.at(-1).slice().reverse()])};
  });
  assert.equal(boundary.edges.length,2);
  for(const edge of boundary.edges){
   const p=edge.at(-1),distance=Math.min(...boundary.receiving.flatMap(ring=>ring.map((a,i)=>{const b=ring[(i+1)%ring.length],x=b.x-a.x,y=b.y-a.y,f=Math.max(0,Math.min(1,((p.x-a.x)*x+(p.y-a.y)*y)/(x*x+y*y||1)));return Math.hypot(p.x-a.x-x*f,p.y-a.y-y*f)})));
   assert.ok(distance<1e-7,'gore edge ends exactly at the receiving road edge');
  }
  assert.ok(Math.hypot(boundary.edges[0].at(-1).x-boundary.edges[1].at(-1).x,boundary.edges[0].at(-1).y-boundary.edges[1].at(-1).y)>5,'stop at the open meeting edge, before the arcs close inside the through lanes');
  await page.locator('.goreHandle[data-gore="22:0|23:0"]').focus();await page.keyboard.press('Shift+ArrowUp');
  const limited=await page.evaluate(()=>({length:StripeMaker.sheets.selected.gores[0].length,max:Number(document.getElementById('goreLength').max)}));
  assert.ok(limited.length<1000&&limited.length<=limited.max+1,'the handle/keyboard share the shortened maximum length');

  const state=()=>page.evaluate(async()=>{
   await new Promise(requestAnimationFrame);
   const A=StripeMaker,s=A.sheets.selected,solved=A.roadEditor.solve(s);
   return {roads:s.roads,joints:s.joints,gores:s.gores,fits:[...solved.arcFits].map(([id,f])=>({id,start:f.start,end:f.end,radius:f.radius})),svg:s.roadLayer.innerHTML};
  });
  for(const id of [22,23,8,9]){
   await setup(id);
   // Center the chosen start arrow away from the editor panel.
   await page.evaluate(id=>{const A=StripeMaker,s=A.sheets.selected,r=s.roads.find(r=>r.id===id),p=A.roadEditor.lanePoint(s,r,0,0,A.roadEditor.solve(s));s.view={scale:10,x:900-p.x*10,y:400-p.y*10};A.sheets.zoomBy(1);A.roadEditor.render();},id);
   const before=await state(),road=before.roads.find(r=>r.id===id),joint=before.joints.find(j=>j.id===road.ends[0].joint);
   const node=page.locator(`.roadNode[data-road="${id}"][data-end="0"][data-lane="0"]`),box=await node.boundingBox(),x=box.x+box.width/2,y=box.y+box.height/2;
   await page.mouse.move(x,y);await page.mouse.down();
   await page.mouse.move(x+30,y+20);const moved=await state();
   near(moved.joints.find(j=>j.id===joint.id),{x:joint.x+3,y:joint.y+2});
   for(let i=0;i<4;i++){await page.mouse.move(x+30,y+20);assert.deepEqual(await state(),moved,'stationary pointer events must not move geometry or leave stale SVG artifacts');}
   // Following the same position by a different route produces the same result.
   for(const [dx,dy]of [[60,-40],[-30,-20],[30,20]]){await page.mouse.move(x+dx,y+dy);await state();}
   assert.deepEqual(await state(),moved,'geometry depends on displacement, not the number or route of mouse events');
   await page.mouse.move(x,y);const restored=await state();
   for(const j of before.joints)near(restored.joints.find(p=>p.id===j.id),j);
   assert.deepEqual(restored.fits,before.fits,'returning the arrow to its starting point restores all fitted arcs');
   await page.mouse.move(x+30,y+20);await page.mouse.up();const committed=await state();
   assert.deepEqual(committed.fits,moved.fits);
   await page.locator('#undoButton').click();assert.deepEqual((await state()).fits,before.fits);
   await page.locator('#redoButton').click();assert.deepEqual((await state()).fits,committed.fits);
   const stable=await state();await page.evaluate(()=>{for(let i=0;i<4;i++)StripeMaker.roadEditor.render();});assert.deepEqual(await state(),stable,'full refresh matches the released drag');
  }
  // Export the actual clipped gore; PDF must retain even-odd road cutouts.
  await setup();await page.evaluate(()=>{const A=StripeMaker,s=A.sheets.selected;s.gores=[{key:'22:0|23:0',length:10000,spacing:20}];s.view={scale:6,x:-1150,y:-1500};A.sheets.zoomBy(1);A.roadEditor.render();});
  await page.locator('#download').click();await page.locator('#downloadSelectArea').click();
  const client=point=>page.evaluate(p=>{const q=StripeMaker.sheets.toScreen(p),r=document.getElementById('previewStage').getBoundingClientRect();return {x:q.x+r.left,y:q.y+r.top}},point);
  const a=await client({x:295,y:290}),b=await client({x:380,y:375});
  await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:3});await page.mouse.up();
  await page.locator('[data-format="pdf"]').click();const pending=page.waitForEvent('download');await page.locator('#downloadSheet').click();
  const download=await pending;await download.saveAs('/tmp/stripemaker-gore-at-receiving-road.pdf');
  const pdf=await fs.readFile('/tmp/stripemaker-gore-at-receiving-road.pdf'),text=pdf.toString('latin1');
  const match=/5 0 obj\s*<< \/Length (\d+) \/Filter \/FlateDecode >>\s*stream\n/.exec(text);assert.ok(match);
  const start=match.index+match[0].length,content=zlib.inflateSync(pdf.subarray(start,start+Number(match[1]))).toString();
  assert.ok((content.match(/W\* n/g)||[]).length>=2,'PDF applies the receiving-road holes to both pavement and markings');
  assert.ok(content.includes(' RG ')&&(content.match(/\bl\n/g)||[]).length>100,'gore and roads stay vector paths');
  assert.deepEqual(errors,[]);
  console.log('PASS: gore stops at receiving pavement with no paint in through lanes; all four fitted start arrows drag without drift, path dependence, stale rendering or undo errors; vector PDF preserves the cutouts.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
