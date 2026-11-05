/* Saved feedback sheet, actual temperature and continuous traffic; no watchdog. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const P=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const webkit=process.env.BROWSER==='webkit',executablePath=webkit?process.env.WEBKIT_PATH:process.env.CHROME_PATH;
 const browser=await P[webkit?'webkit':'chromium'].launch({headless:true,...(executablePath?{executablePath}:{})});
 try{
  const page=await browser.newPage({viewport:{width:1400,height:1000}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',message=>{if(message.text().startsWith('STUCK-RUN'))console.log(message.text());});
  await page.goto(process.env.STRIPEMAKER_URL||pathToFileURL(path.resolve(__dirname,'../index.html')).href);
  await page.waitForFunction(()=>StripeMaker.sheets.ready);
  await page.click('button[aria-controls="sheetsMenu"]');await page.click('#blankSheet');
  await page.waitForFunction(()=>StripeMaker.sheets.selected);
  const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/simulator-intersection-abrupt-stop.json')));
  await page.evaluate(data=>{
   const A=StripeMaker,s=A.sheets.selected;StripeMaker.settings.set('simulationTemperature',data.settings.simulationTemperature);Object.assign(s,data.data);Object.assign(A.sheets.selected,{speedZones:A.sheets.selected.roads.map(road=>({id:'test-speed-'+road.id,road:road.id,from:0,to:1,mph:data.settings.simulationSpeed}))});
   s.view={x:120,y:100,scale:.65};A.sheets.zoomBy(1);A.roadEditor.render();A.showEditor('simulatorEditor');
   const advance=A.simulatorVehicles.Engine.prototype.advance;
   A.simulatorVehicles.Engine.prototype.advance=function(seconds){window.testEngine=this;return advance.call(this,seconds);};
  },fixture);
  await page.clock.install();await page.click('#playSimulation');
  const report=await page.evaluate(()=>{
   const A=StripeMaker,g=A.simulator.network(A.sheets.selected),e=testEngine,V=A.simulatorVehicles,C=A.simulatorCollisions;
   const available=[...g.search({road:1,lane:2,e:0}).values()];
   const target=(exit,factor=1)=>{
    const route=available.filter(p=>p.exit.road===exit).sort((a,b)=>a.laneChanges.length-b.laneChanges.length)[0];if(!route)throw Error('Missing legal exit '+exit);
    const path=V.preparePath(route.points),m=path.movements[0],profile={...A.simulatorDrivers.BASELINE,roundaboutFactor:factor};let mph=Infinity;
    for(let d=m.start;d<m.end;d+=2*e.pixelsPerFoot){const car={path,pathDistance:d,speed:10*e.pixelsPerFoot,driver:profile,...V.position(path,d)};mph=Math.min(mph,C.desiredSpeed(car,88*e.pixelsPerFoot,1.67*e.pixelsPerFoot/.3048,e.pixelsPerFoot)/e.pixelsPerFoot*3600/5280);}
    return mph;
   };return {right:target(14),through:target(5),quicker:target(14,1.3),slower:target(14,.8)};
  });
  console.log(JSON.stringify(report));assert(report.right>0&&report.right<25);assert(report.through>report.right+10);assert(report.quicker>report.right);assert(report.slower<report.right);assert.deepEqual(errors,[]);
  console.log(`PASS ${webkit?'WebKit':'Chromium'} actual intersection right-turn versus through speeds and personal temperature preferences.`);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
