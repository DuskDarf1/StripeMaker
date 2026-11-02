const assert = require('node:assert/strict');
const {pathToFileURL} = require('node:url');
const path = require('node:path');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const browser = await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
  try {
    const page = await browser.newPage({viewport:{width:1400,height:1000}}), errors=[];
    page.on('pageerror', e=>errors.push(e.message));
    await page.goto(pathToFileURL(path.resolve(__dirname,'../index.html')).href);
    const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=1600;c.height=1200;return c.toDataURL().split(',')[1];});
    await page.locator('#sheetFile').setInputFiles({name:'Spawn test.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
    await page.waitForFunction(()=>StripeMaker.sheets.selected);
    await page.evaluate(()=>{
      const s=StripeMaker.sheets.selected;s.inchesPerPixel=2;
      s.roads=[1,2].map(id=>({id,lanes:3,laneWidth:12,ends:[{joint:id,sign:1,length:null},{joint:id+1,sign:1,length:null}]}));
      s.joints=[1,2,3].map(id=>({id,x:400+(id-1)*400,y:650,dir:{x:1,y:0},root:Math.min(id,2),links:id===2?[{a:1,ai:0,b:2,bi:0}]:[]}));
      StripeMaker.roadEditor.render();StripeMaker.history.rebase();StripeMaker.showEditor('simulatorEditor');
    });
    assert.deepEqual(await page.evaluate(()=>StripeMaker.simulator.entrances(StripeMaker.sheets.selected).map(r=>r.id)),[1]);
    await page.click('#createVehicleSpawnPoint');
    const point=await page.evaluate(()=>{
      const s=StripeMaker.sheets.selected,p=StripeMaker.roadEditor.lanePoint(s,s.roads[0],0,1,StripeMaker.roadEditor.solve(s));
      const q=StripeMaker.sheets.toScreen(p),b=document.getElementById('previewStage').getBoundingClientRect();return {x:q.x+b.left,y:q.y+b.top};
    });
    await page.mouse.move(point.x,point.y);
    assert.equal(await page.locator('.simulatorOverlay img').count(),1);
    await page.mouse.click(point.x,point.y);
    assert.deepEqual(await page.evaluate(()=>StripeMaker.sheets.selected.vehicleSpawns),[{road:1}]);
    assert.equal(await page.locator('.simulatorOverlay img').count(),1);
    assert(await page.locator('.simulatorOverlay img').first().evaluate(i=>i.complete&&i.naturalWidth>0));
    await page.click('#undoButton');assert.equal(await page.locator('.simulatorOverlay img').count(),0);
    await page.click('#redoButton');assert.equal(await page.locator('.simulatorOverlay img').count(),1);
    await page.click('#createVehicleSpawnPoint');await page.mouse.click(point.x,point.y);
    assert.equal(await page.evaluate(()=>StripeMaker.sheets.selected.vehicleSpawns.length),1);
    await page.waitForTimeout(900);await page.reload();await page.waitForFunction(()=>StripeMaker.sheets.selected);
    await page.evaluate(()=>StripeMaker.showEditor('simulatorEditor'));
    assert.equal(await page.locator('.simulatorOverlay img').count(),1);
    await page.locator('.simulatorSpawn').click();
    assert.equal(await page.locator('#simulatorLanes input[type=number]').count(),3,'one spawn controls all three lane shares');
    await page.locator('#simulatorLanes input[type=number]').first().fill('50');
    await page.locator('#simulatorLanes input[type=number]').first().blur();
    assert.deepEqual(await page.locator('#simulatorLanes input[type=number]').evaluateAll(inputs=>inputs.map(i=>Number(i.value))),[50,25,25]);
    await page.click('#removeVehicleSpawnPoint');
    assert.equal(await page.locator('.simulatorSpawn').count(),0,'remove the entrance spawn');
    await page.click('#undoButton');assert.equal(await page.locator('.simulatorSpawn').count(),1);
    await page.click('#redoButton');assert.equal(await page.locator('.simulatorSpawn').count(),0);
    await page.waitForTimeout(900);await page.reload();await page.waitForFunction(()=>StripeMaker.sheets.selected);
    await page.evaluate(()=>StripeMaker.showEditor('simulatorEditor'));
    assert.equal(await page.locator('.simulatorSpawn').count(),0,'entrance removal persists');
    await page.click('#createVehicleSpawnPoint');await page.mouse.click(point.x,point.y);
    assert.equal(await page.locator('.simulatorSpawn').count(),1,'one marker restored for the entrance');
    await page.screenshot({path:'/tmp/stripemaker-simulator.png'});
    assert.deepEqual(errors,[]);console.log('Simulator placement, preview, eligibility, undo/redo, deduplication and persistence passed.');
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
