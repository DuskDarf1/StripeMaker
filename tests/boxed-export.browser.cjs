const assert=require('node:assert/strict'),fs=require('node:fs/promises'),{execFileSync}=require('node:child_process');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
 try {
  const page=await browser.newPage({viewport:{width:1600,height:1100}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.STRIPEMAKER_URL||'http://127.0.0.1:8883');await page.waitForFunction(()=>StripeMaker.sheets.ready);
  const png=await page.evaluate(()=>{
   const c=document.createElement('canvas');c.width=1200;c.height=900;const x=c.getContext('2d');
   for(const [color,left,top]of [['#c82828',0,0],['#2848c8',600,0],['#28b850',0,450],['#e0c838',600,450]]){x.fillStyle=color;x.fillRect(left,top,600,450);}
   return c.toDataURL().split(',')[1];
  });
  await page.locator('#sheetFile').setInputFiles({name:'Boxed export.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
  await page.waitForFunction(()=>StripeMaker.sheets.selected?.name==='Boxed export');
  const before=await page.evaluate(()=>{
   const A=StripeMaker,s=A.sheets.selected;s.inchesPerPixel=12;
   s.roads=[{id:1,lanes:1,laneWidth:12,ends:[{joint:1,sign:1},{joint:2,sign:1}]}];
   s.joints=[{id:1,x:100,y:400,links:[]},{id:2,x:1100,y:400,links:[]}];
   s.view={scale:1,x:80,y:20,fitted:false};A.sheets.zoomBy(1);A.roadEditor.render();A.history.rebase();
   return {roads:structuredClone(s.roads),joints:structuredClone(s.joints),view:structuredClone(s.view),id:s.id};
  });
  const client=point=>page.evaluate(p=>{const A=StripeMaker,q=A.sheets.toScreen(p),r=document.querySelector('#previewStage').getBoundingClientRect();return{x:q.x+r.left,y:q.y+r.top};},point);
  const drag=async(a,b)=>{const p=await client(a),q=await client(b);await page.mouse.move(p.x,p.y);await page.mouse.down();await page.mouse.move(q.x,q.y,{steps:5});await page.mouse.up();};
  await page.locator('#download').click();await page.locator('#downloadSelectArea').click();
  await drag({x:900,y:600},{x:300,y:200});
  assert.equal(await page.locator('#downloadMenu').isVisible(),true,'finishing the box reopens Download');
  assert.equal(await page.locator('#downloadAreaStatus').innerText(),'Selected area: 600 × 400 sheet px');
  assert.equal(await page.locator('#downloadSize').innerText(),'600 × 440 px');
  assert.equal(await page.locator('#downloadWidth').getAttribute('max'),'600');
  assert.equal(await page.locator('#downloadSheet').innerText(),'Download Area');
  assert.deepEqual(await page.evaluate(()=>StripeMaker.sheets.selected.view),before.view,'drawing a box does not pan');
  await page.screenshot({path:'/tmp/boxed-export-selection.png'});
  const download=async(format)=>{
   await page.locator(`[data-format="${format}"]`).click();
   const pending=page.waitForEvent('download');await page.locator('#downloadSheet').click();
   const file=await pending,path=`/tmp/boxed-export.${format}`;await file.saveAs(path);
   await page.waitForFunction(()=>!document.getElementById('downloadSheet').disabled);
   return fs.readFile(path);
  };
  const pixels=async(bytes,positions)=>page.evaluate(async({data,positions})=>{
   const i=new Image();i.src=`data:image/png;base64,${data}`;await i.decode();
   const c=document.createElement('canvas');c.width=i.naturalWidth;c.height=i.naturalHeight;const x=c.getContext('2d');x.drawImage(i,0,0);
   return {width:c.width,height:c.height,colors:positions.map(([px,py])=>[...x.getImageData(px,py,1,1).data])};
  },{data:bytes.toString('base64'),positions});
  const samples=[[20,60],[580,60],[20,420],[580,420],[300,240],[590,10]];
  const expected=[[200,40,40],[40,72,200],[40,184,80],[224,200,56],[58,59,61],[255,255,255]];
  const checkColors=(actual,tolerance)=>actual.forEach((rgb,i)=>expected[i].forEach((v,k)=>assert(Math.abs(rgb[k]-v)<=tolerance,`sample ${i}, channel ${k}: ${rgb[k]} vs ${v}`)));
  const raster=await pixels(await download('png'),samples);
  assert.deepEqual([raster.width,raster.height],[600,440]);checkColors(raster.colors,1);
  const pdf=await download('pdf'),text=pdf.toString('latin1');
  assert.match(text,/\/MediaBox \[0 0 288 211\.2\]/);
  const header=/5 0 obj\s*<< \/Length (\d+) \/Filter \/FlateDecode >>\s*stream\n/.exec(text);assert(header);
  const start=header.index+header[0].length,content=require('node:zlib').inflateSync(pdf.subarray(start,start+Number(header[1]))).toString();
  assert(content.includes('300 200 600 400 re W n'),'PDF clips to the exact sheet box');
  assert(content.includes('0.48 0 0 -0.48 -144 288 cm'),'PDF uses the crop origin');
  assert(content.includes(' RG ')&&(content.match(/\bl\n/g)||[]).length>2,'road markings remain vector paths');
  execFileSync(process.env.PDFTOPPM||'pdftoppm',['-r','150','-singlefile','-png','/tmp/boxed-export.pdf','/tmp/boxed-export-pdf']);
  const pdfRaster=await pixels(await fs.readFile('/tmp/boxed-export-pdf.png'),samples);
  assert.deepEqual([pdfRaster.width,pdfRaster.height],[600,440]);checkColors(pdfRaster.colors,8);
  // An editable project export still contains the complete original sheet.
  const jsonDownload=page.waitForEvent('download');await page.locator('#exportProject').click();
  const json=JSON.parse(await fs.readFile(await(await jsonDownload).path(),'utf8')),record=json.sheets[0].data;
  assert.deepEqual([json.sheets[0].width,json.sheets[0].height],[1200,900]);
  assert.equal(json.sheets[0].file.base64,png,'JSON retains the complete original imagery');
  assert.deepEqual(record.roads,before.roads);assert.deepEqual(record.joints,before.joints);
  await page.locator('#downloadSelectArea').click();await page.keyboard.press('Escape');
  assert.equal(await page.locator('#downloadAreaStatus').innerText(),'Selected area: 600 × 400 sheet px','cancel retains the previous box');
  // Keyboard selection uses the same region and export controls.
  await page.locator('#downloadSelectArea').click();await page.keyboard.press('Enter');
  await page.keyboard.press('Shift+ArrowRight');await page.keyboard.press('Shift+ArrowDown');await page.keyboard.press('Enter');
  assert.equal(await page.locator('#downloadAreaStatus').innerText(),'Selected area: 10 × 10 sheet px');
  await page.locator('#downloadSelectArea').click();await drag({x:100,y:100},{x:1400,y:1000});
  assert.equal(await page.locator('#downloadAreaStatus').innerText(),'Selected area: 1100 × 800 sheet px','box stays within sheet bounds');
  // Crop settings belong only to their sheet and do not alter drawing history.
  await page.locator('#blankSheet').evaluate(b=>b.click());await page.waitForFunction(()=>StripeMaker.sheets.selected?.blank);
  await page.locator('#download').click();assert.equal(await page.locator('#downloadAreaStatus').innerText(),'Whole sheet');
  await page.evaluate(id=>StripeMaker.sheets.select(StripeMaker.sheets.all.find(s=>s.id===id)),before.id);
  assert.equal(await page.locator('#downloadAreaStatus').innerText(),'Selected area: 1100 × 800 sheet px');
  if(!await page.locator('#downloadMenu').isVisible())await page.locator('#download').click();
  await page.locator('#downloadWholeSheet').click();assert.equal(await page.locator('#downloadAreaStatus').innerText(),'Whole sheet');
  await page.locator('#downloadWidthValue').fill('1200');await page.locator('#downloadWidthValue').dispatchEvent('input');
  const full=await pixels(await download('png'),[[100,160],[1100,860]]);
  assert.deepEqual([full.width,full.height],[1200,960]);assert.deepEqual(full.colors.map(c=>c.slice(0,3)),[expected[0],expected[3]]);
  assert.deepEqual(await page.evaluate(()=>({roads:StripeMaker.sheets.selected.roads,joints:StripeMaker.sheets.selected.joints})),{roads:before.roads,joints:before.joints});
  assert.deepEqual(errors,[]);
  console.log('PASS: box selection, PNG pixels, raster-checked vector PDF, full JSON, cancel, keyboard selection, sheet bounds, per-sheet areas and whole-sheet export.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
