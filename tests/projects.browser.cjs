/* Isolated browser: project switching never changes the portable JSON envelope. */
const assert=require('node:assert/strict'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const playwright=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const webkit=process.env.BROWSER==='webkit';
(async()=>{
 const executablePath=webkit?process.env.WEBKIT_PATH:process.env.CHROME_PATH;
 const browser=await playwright[webkit?'webkit':'chromium'].launch({headless:true,...(executablePath?{executablePath}:{})});
 try{
  const page=await browser.newPage({viewport:{width:1400,height:1100}}),errors=[];
  page.on('pageerror',e=>{errors.push(e.message);console.error(e.message);});
  await page.goto(pathToFileURL(path.resolve(__dirname,'../index.html')).href);
  await page.waitForFunction(()=>StripeMaker.sheets.ready&&document.querySelector('#projectSelect').options.length);
  await page.locator('#blankSheet').evaluate(b=>b.click());await page.waitForFunction(()=>StripeMaker.sheets.all.length===1);
  const original=await page.evaluate(async()=>{
    const A=StripeMaker,s=A.sheets.selected;s.name='Original sheet';s.autoTapers=true;A.history.record();A.sheets.save(s);
    await A.projects.rename('First project');return {project:A.projects.active.id,sheet:s.id,json:await A.projectJSON.snapshot()};
  });
  const second=await page.evaluate(()=>StripeMaker.projects.create('Second project'));
  assert.equal(await page.evaluate(()=>StripeMaker.sheets.all.length),0);
  assert(await page.locator('#undoButton').isDisabled());
  await page.locator('#blankSheet').evaluate(b=>b.click());await page.waitForFunction(()=>StripeMaker.sheets.all.length===1);
  await page.evaluate(()=>{const A=StripeMaker,s=A.sheets.selected;s.name='Second sheet';s.autoTapers=true;A.history.record();A.sheets.save(s);});
  await page.evaluate(id=>StripeMaker.projects.switch(id),original.project);
  assert.equal(await page.evaluate(()=>StripeMaker.sheets.selected.name),'Original sheet');
  await page.locator('#undoButton').click();assert.equal(await page.evaluate(()=>StripeMaker.sheets.selected.autoTapers),false);
  await page.locator('#redoButton').click();assert.equal(await page.evaluate(()=>StripeMaker.sheets.selected.autoTapers),true);
  await page.evaluate(id=>StripeMaker.projects.switch(id),second);
  assert.equal(await page.evaluate(()=>StripeMaker.sheets.selected.autoTapers),true);
  const exported=await page.evaluate(()=>StripeMaker.projectJSON.snapshot());
  assert.equal(exported.version,1);assert.equal(exported.format,'StripeMakerProject');assert.equal(exported.sheets.length,1);
  assert.equal(exported.sheets[0].data.name,'Second sheet');assert(!('projects' in exported));
  const third=await page.evaluate(p=>StripeMaker.projects.openJSON(p,'Imported project'),original.json);
  assert.equal(await page.evaluate(()=>StripeMaker.sheets.all.length),1);
  assert.equal(await page.evaluate(()=>StripeMaker.sheets.selected.name),'Original sheet');
  await page.evaluate(p=>StripeMaker.projectJSON.load(p),original.json);
  assert.equal(await page.evaluate(()=>StripeMaker.sheets.all.length),2,'legacy import still appends to current project');
  const bad=structuredClone(original.json);bad.sheets[0].file.base64='AAAA';
  await page.evaluate(async p=>{try{await StripeMaker.projects.openJSON(p,'Bad project');throw Error('unexpected success');}catch(e){if(e.message==='unexpected success')throw e;}},bad);
  assert.equal(await page.evaluate(()=>StripeMaker.projects.active.id),third,'failed open restores previous project');
  assert.equal(await page.evaluate(()=>StripeMaker.sheets.all.length),2);
  // Incoming storage failure must not strand the user in an empty new project.
  await page.evaluate(async project=>{
    const put=IDBObjectStore.prototype.put;let injected=false;
    IDBObjectStore.prototype.put=function(...args){if(this.name==='files'&&!injected){injected=true;throw new DOMException('Test storage failure','QuotaExceededError');}return put.apply(this,args);};
    try{await StripeMaker.projects.openJSON(project,'Failed storage');throw Error('unexpected success');}
    catch(error){if(error.message==='unexpected success')throw error;}
    finally{IDBObjectStore.prototype.put=put;}
    if(!injected)throw Error('storage fault not exercised');
  },original.json);
  assert.equal(await page.evaluate(()=>StripeMaker.projects.active.id),third);
  assert.equal(await page.evaluate(()=>StripeMaker.sheets.all.length),2);
  await page.evaluate(()=>StripeMaker.projects.close());
  assert.equal(await page.evaluate(id=>StripeMaker.projects.all.find(p=>p.id===id).open,third),false);
  await page.evaluate(id=>StripeMaker.projects.switch(id),third);
  assert.equal(await page.evaluate(()=>StripeMaker.sheets.all.length),2,'closed project reopens intact');
  await page.evaluate(()=>StripeMaker.sheets.flush());await page.reload();
  await page.waitForFunction(()=>StripeMaker.sheets.ready&&document.querySelector('#projectSelect').options.length===3);
  assert.equal(await page.evaluate(()=>StripeMaker.projects.active.id),third);
  assert.equal(await page.evaluate(()=>StripeMaker.sheets.all.length),2);
  assert(await page.locator('#undoButton').isDisabled(),'undo is session-only');
  await page.evaluate(id=>StripeMaker.projects.switch(id),second);
  assert.equal(await page.evaluate(()=>StripeMaker.sheets.selected.name),'Second sheet');
  await page.locator('[data-editor="sheetsMenu"]').click();await page.screenshot({path:'/tmp/stripemaker-projects.png'});
  await page.setViewportSize({width:390,height:844});
  assert(await page.locator('#projectSelect-button').isVisible());
  const choose=require('./select-choice.cjs');
  await choose(page.locator('#projectSelect'),original.project);
  await page.waitForFunction(id=>!StripeMaker.projects.busy&&StripeMaker.projects.active.id===id,original.project);
  assert.equal(await page.evaluate(()=>StripeMaker.sheets.selected.name),'Original sheet');
  await page.locator('[data-editor="sheetsMenu"]').click();
  assert(await page.locator('#sheetsMenu').evaluate(menu=>menu.scrollWidth<=menu.clientWidth+1),'project controls fit narrow menu');
  await page.screenshot({path:'/tmp/stripemaker-projects-narrow.png'});
  await page.locator('#newProject').click();
  await page.waitForFunction(()=>!StripeMaker.projects.busy&&StripeMaker.projects.all.length===4);
  assert.equal(await page.evaluate(()=>StripeMaker.sheets.all.length),0,'New Project button creates an empty set');
  await page.locator('#openProjectFile').setInputFiles(['One','Two'].map(name=>({name:name+'.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(original.json))})));
  await page.waitForFunction(()=>!StripeMaker.projects.busy&&StripeMaker.projects.all.length===6);
  assert.equal(await page.evaluate(()=>StripeMaker.projects.active.name),'Two');
  assert.equal(await page.evaluate(()=>StripeMaker.sheets.all.length),1,'each opened JSON gets its own sheets');

  assert.deepEqual(errors,[]);console.log('Projects: isolated sheets/history, JSON compatibility, failed open, close/reopen and reload passed.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
