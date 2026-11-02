// A branch occupies one lane, not the whole endpoint shared by four lanes.
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const browser = await chromium.launch({headless:true, ...(process.env.CHROME_PATH ? {executablePath:process.env.CHROME_PATH} : {})});
  try {
    const page = await browser.newPage({viewport:{width:1500,height:1000}}), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(process.env.STRIPEMAKER_URL || 'http://127.0.0.1:8876');
    await page.waitForFunction(() => StripeMaker.sheets.ready);
    await page.locator('#blankSheet').evaluate(b => b.click());
    await page.waitForFunction(() => StripeMaker.sheets.selected);
    for (const e of [1, 0]) {
      const before = await page.evaluate(e => {
        const app=StripeMaker, s=app.sheets.selected, G=app.intersectionGeometry;
        s.inchesPerPixel=4; s.autoTapers=false;
        const x=G.create(); Object.assign(x,{x:15000,y:15000});
        const a=x.approaches.find(a=>a.angle===180);
        Object.assign(a,{incoming:e?3:0,outgoing:e?0:3});G.normalize(x);s.intersections=[x];
        s.roads=[
          {id:100,lanes:4,laneWidth:12,ends:[{joint:e?100:101,sign:1,length:null},{joint:e?101:100,sign:1,length:null}]},
          {id:101,lanes:1,laneWidth:12,ends:[{joint:e?101:102,sign:1,length:120},{joint:e?102:101,sign:1,length:null}]}
        ];
        s.joints=[
          {id:100,x:14200,y:15072,dir:{x:e?1:-1,y:0},root:100,links:[]},
          {id:101,x:14500,y:15072,dir:{x:e?1:-1,y:0},root:100,links:[{a:100,ai:0,b:101,bi:0}]},
          {id:102,x:14800,y:14700,dir:{x:0,y:e?-1:1},root:101,links:[]}
        ];
        s.view={scale:1,x:-14000,y:-14500,fitted:false};app.sheets.zoomBy(1);
        document.dispatchEvent(new Event('sheetchange'));
        app.roadEditor.focusRoad(s.roads[0]);app.history.rebase();
        const end=app.roadEditor.intersectionEnd(s,{road:100,e});
        const track=app.roadEditor.laneTracks(s).find(t=>t.road===100), n=e?track.line.length-1:0;
        const p=track.line[n], d=(track.laneBounds[n][1][0]+track.laneBounds[n][1][1])/2;
        const actual={x:p.x-p.tangent.y*d,y:p.y+p.tangent.x*d};
        const target=G.add(x,G.mul(G.lane(a,Boolean(e),0),3)), stage=document.getElementById('previewStage').getBoundingClientRect();
        const screen=p=>{const q=app.sheets.toScreen(p);return{x:q.x+stage.left,y:q.y+stage.top};};
        const blocked=app.intersections.laneAt(s,{road:100,e,lane:0},target);
        return {free:end.freeLanes,terminal:end.terminal,blocked,delta:G.sub(screen(target),screen(actual)),
          branch:structuredClone(s.joints[2]),links:structuredClone(s.joints[1].links),approach:structuredClone(a)};
      }, e);
      assert.deepEqual(before.free,[false,true,true,true]);
      assert.equal(before.terminal,false,'whole-mouth adoption still requires a terminal end');
      assert.equal(before.blocked,null,'branch lane cannot also attach to an intersection');
      const node=page.locator(`.roadNode[data-road="100"][data-end="${e}"][data-lane="1"]`), box=await node.boundingBox();
      assert.ok(box);const p={x:box.x+box.width/2,y:box.y+box.height/2};
      await page.mouse.move(p.x,p.y);await page.mouse.down();
      await page.mouse.move(p.x+before.delta.x,p.y+before.delta.y,{steps:12});await page.mouse.up();
      const check = () => page.evaluate(e => {
        const app=StripeMaker,s=app.sheets.selected,G=app.intersectionGeometry,x=s.intersections[0],a=x.approaches.find(a=>a.angle===180);
        const track=app.roadEditor.laneTracks(s).find(t=>t.road===100),n=e?track.line.length-1:0,p=track.line[n];
        const errors=[1,2,3].map(j=>{const d=(track.laneBounds[n][j][0]+track.laneBounds[n][j][1])/2,q=G.add(x,G.mul(G.lane(a,Boolean(e),j-1),3));return Math.hypot(q.x-p.x+p.tangent.y*d,q.y-p.y-p.tangent.x*d);});
        return {links:a.links,errors,branch:s.joints.find(j=>j.id===102),jointLinks:s.joints.find(j=>j.id===101).links,free:app.roadEditor.intersectionEnd(s,{road:100,e}).freeLanes};
      },e);
      let result=await check();
      assert.deepEqual(result.links,[{road:100,e,lane:1,to:(e?before.approach.inLanes:before.approach.outLanes)[0]}]);
      assert.ok(result.errors.every(d=>d<1e-5),JSON.stringify(result));
      assert.deepEqual(result.branch,before.branch,'remote branch end stays in place');
      assert.deepEqual(result.jointLinks,before.links,'branch remains joined');
      assert.deepEqual(result.free,[false,true,true,true]);
      await page.locator('#undoButton').click();assert.equal((await check()).links,undefined);
      await page.locator('#redoButton').click();assert.deepEqual((await check()).links,result.links);
      await page.evaluate(async()=>{await StripeMaker.projectJSON.load(await StripeMaker.projectJSON.snapshot('selected'));});
      result=await check();assert.ok(result.errors.every(d=>d<1e-5));assert.equal(result.links.length,1,'link survives project JSON');
      const safeguards=await page.evaluate(e=>{
        const s=StripeMaker.sheets.selected,r=s.roads.find(r=>r.id===100),b=s.roads.find(r=>r.id===101),editor=StripeMaker.roadEditor;
        // Three lanes implicitly continue through one alignment link.
        b.lanes=3;delete s.intersections[0].approaches.find(a=>a.angle===180).links;
        const occupied=editor.intersectionEnd(s,{road:100,e}).freeLanes;
        b.lanes=1;r.tapers={[`${e}:2`]:{mode:'taper',length:50}};
        const tapered=editor.intersectionEnd(s,{road:100,e}).freeLanes;
        return {occupied,tapered};
      },e);
      assert.deepEqual(safeguards.occupied,[false,false,false,true]);
      assert.equal(safeguards.tapered[2],false,'a tapered lane cannot snap');
    }
    assert.deepEqual(errors,[]);
    console.log('PASS: free lanes at branched road ends snap in both directions, keep lane alignment and branches, undo/redo and JSON; occupied and tapered lanes stay excluded.');
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
