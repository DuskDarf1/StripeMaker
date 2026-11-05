const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } }), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(process.env.STRIPEMAKER_URL || 'http://127.0.0.1:8876');
    await page.waitForFunction(() => StripeMaker.sheets.ready);
    await page.locator('#blankSheet').evaluate(b => b.click()); await page.waitForFunction(() => StripeMaker.sheets.selected);
    await page.evaluate(() => {
      const A=StripeMaker,s=A.sheets.selected;
      s.roads=[{id:1,lanes:2,laneWidth:12,ends:[{joint:1,sign:1},{joint:2,sign:1}]}];
      s.joints=[{id:1,x:100,y:500,links:[]},{id:2,x:1500,y:500,links:[]}];
      s.markings=[{id:'arrow',type:'through',on:{road:1,lane:0},back:70},{id:'still',type:'through',on:{road:1,lane:1},back:110}];
      s.view={scale:.5,x:500,y:200};A.sheets.zoomBy(1);A.roadEditor.render();A.history.rebase();
      const ring=A.markings.outlines('arrow')[0],p=ring.reduce((p,q)=>({x:p.x+q.x/ring.length,y:p.y+q.y/ring.length}),{x:0,y:0});
      if(!A.markings.focusAt(p))throw Error('Missing arrow');
    });
    for(const endType of ['pointerup','pointercancel']) {
      const handle=page.locator('.markingOverlay button[data-part="move"]'),box=await handle.boundingBox(),x=box.x+box.width/2,y=box.y+box.height/2;
      await page.evaluate(()=>document.addEventListener('pointerdown',e=>window.testPointer=e.pointerId,{once:true,capture:true}));
      await page.mouse.move(x,y);await page.mouse.down();
      const result=await handle.evaluate((button,{x,y,endType})=>{
        const A=StripeMaker,s=A.sheets.selected,m=s.markings[0],before=structuredClone(m),raf=window.requestAnimationFrame,cancel=window.cancelAnimationFrame,renderKey=A.roadEditor.renderMarkings?'renderMarkings':'render',render=A.roadEditor[renderKey];
        const road=s.roadLayer.querySelector('.roadBand'),group=s.roadLayer.querySelector('.laneMarkings'),still=group.lastChild;
        const pending=new Map(),positions=[];let next=1000000,renders=0;
        window.requestAnimationFrame=callback=>{const id=next++;pending.set(id,callback);return id;};
        window.cancelAnimationFrame=id=>{if(!pending.delete(id))cancel.call(window,id);};
        A.roadEditor[renderKey]=function(...args){renders++;return render.apply(this,args);};
        const move=dx=>{button.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:testPointer,buttons:1,isPrimary:true,clientX:x+dx,clientY:y}));positions.push(m.back);};
        try {
          move(10);move(20);move(30);const queued={count:pending.size,renders};
          for(const[id,f]of[...pending]){pending.delete(id);f(performance.now());}
          const flushed={count:pending.size,renders};
          const retained=road.isConnected&&group.isConnected&&still.isConnected;
          move(40);button.dispatchEvent(new PointerEvent(endType,{bubbles:true,pointerId:testPointer,buttons:0,isPrimary:true,clientX:x+40,clientY:y}));
          const finished={renders,marking:structuredClone(m)};
          for(const[id,f]of[...pending]){pending.delete(id);f(performance.now());}
          const incremental=s.roadLayer.outerHTML;A.roadEditor.render();const fresh=s.roadLayer.outerHTML;
          return {before,positions,queued,flushed,finished,lateRenders:renders,retained,sameSVG:incremental===fresh};
        }finally{window.requestAnimationFrame=raf;window.cancelAnimationFrame=cancel;A.roadEditor[renderKey]=render;}
      },{x,y,endType});
      await page.mouse.up();
      assert.deepEqual(result.queued,{count:1,renders:0});assert.deepEqual(result.flushed,{count:0,renders:1});
      assert.equal(result.finished.renders,2);assert.equal(result.lateRenders,2);
      assert(result.retained,'moving one arrow retains road, group and other marking paths');assert(result.sameSVG,'incremental marking drawing matches full SVG');
      assert(result.positions.every((p,i)=>i===0||p<result.positions[i-1]),'every event updates placement before drawing');
      if(endType==='pointercancel')assert.deepEqual(result.finished.marking,result.before);
      else {
        await page.locator('#undoButton').click();assert.deepEqual(await page.evaluate(()=>StripeMaker.sheets.selected.markings[0]),result.before);
        await page.locator('#redoButton').click();assert.deepEqual(await page.evaluate(()=>StripeMaker.sheets.selected.markings[0]),result.finished.marking);
      }
    }
    const incrementalChecks=await page.evaluate(()=>{
      const A=StripeMaker,s=A.sheets.selected,results=[];
      for(const change of [m=>m.all=true,m=>m.repeat={length:60,spacing:20},m=>m.contrast='border',m=>m.placementTransform={angle:15,x:0,y:0,tx:0,ty:0}]) {
        change(s.markings[0]);const updated=A.markings.updateDrawing(s),incremental=s.roadLayer.outerHTML;A.roadEditor.render();results.push(updated&&incremental===s.roadLayer.outerHTML);
      }
      delete s.markings[0].placementTransform;A.roadEditor.render();
      s.markings.push({id:'crossing',type:'crosswalk',a:{x:800,y:400},b:{x:800,y:600},width:10});A.roadEditor.render();
      s.markings.at(-1).a.x+=20;const crosswalk=!A.markings.updateDrawing(s);A.roadEditor.render();
      s.joints[0].x+=10;const geometry=!A.markings.updateDrawing(s);A.roadEditor.render();
      s.markings.reverse();const order=!A.markings.updateDrawing(s);s.markings.reverse();A.roadEditor.render();
      return {results,crosswalk,geometry,order};
    });
    assert(incrementalChecks.results.every(Boolean),'repeat, all-lanes, contrast and transforms retain exact paint order');
    assert(incrementalChecks.crosswalk&&incrementalChecks.geometry&&incrementalChecks.order,'coupled geometry and ordering edits use the full renderer');
    await page.evaluate(()=>{
      const A=StripeMaker,s=A.sheets.selected;
      s.lines=[{id:'edge',style:'solid',color:'white',on:{road:1,k:0},from:.2,to:.8}];
      A.roadEditor.render();A.history.rebase();A.longitudinal.focus('edge');
    });
    const lineHandle=page.locator('.lineOverlay button[data-end="from"]'),box=await lineHandle.boundingBox(),x=box.x+box.width/2,y=box.y+box.height/2;
    await page.evaluate(()=>document.addEventListener('pointerdown',e=>window.testPointer=e.pointerId,{once:true,capture:true}));
    await page.mouse.move(x,y);await page.mouse.down();
    const lineResult=await lineHandle.evaluate((button,{x,y})=>{
      const A=StripeMaker,s=A.sheets.selected,line=s.lines[0],before=structuredClone(line),raf=window.requestAnimationFrame,cancel=window.cancelAnimationFrame,render=A.roadEditor.render;
      const pending=new Map(),positions=[];let next=1000000,renders=0;
      window.requestAnimationFrame=f=>{const id=next++;pending.set(id,f);return id;};
      window.cancelAnimationFrame=id=>{if(!pending.delete(id))cancel.call(window,id);};
      A.roadEditor.render=function(...args){renders++;return render.apply(this,args);};
      try {
        for(const dx of [10,20,30]){button.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:testPointer,buttons:1,isPrimary:true,clientX:x+dx,clientY:y}));positions.push(line.from);}
        const queued={count:pending.size,renders};
        for(const[id,f]of[...pending]){pending.delete(id);f(performance.now());}
        const flushed=renders;
        button.dispatchEvent(new PointerEvent('pointercancel',{bubbles:true,pointerId:testPointer,isPrimary:true,clientX:x+30,clientY:y}));
        for(const[id,f]of[...pending]){pending.delete(id);f(performance.now());}
        return {before,after:structuredClone(line),positions,queued,flushed,renders};
      }finally{window.requestAnimationFrame=raf;window.cancelAnimationFrame=cancel;A.roadEditor.render=render;}
    },{x,y});
    await page.mouse.up();
    assert.deepEqual(lineResult.queued,{count:1,renders:0});assert.equal(lineResult.flushed,1);assert.equal(lineResult.renders,2);
    assert(lineResult.positions.every((p,i)=>i===0||p>lineResult.positions[i-1]));assert.deepEqual(lineResult.after,lineResult.before);
    assert.deepEqual(errors,[]);
    console.log('PASS: lateral markings and line handles preserve every edit, draw once per frame, flush release/cancel, and undo as one gesture.');
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
