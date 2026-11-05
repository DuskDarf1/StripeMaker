const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
 try {
  const page=await browser.newPage({viewport:{width:1400,height:1000}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.STRIPEMAKER_URL||'http://127.0.0.1:8876');await page.waitForFunction(()=>StripeMaker.sheets.ready);
  await page.locator('#blankSheet').evaluate(b=>b.click());await page.waitForFunction(()=>StripeMaker.sheets.selected);
  for(const curved of [false,true]) {
   const result=await page.evaluate(curved=>{
    const A=StripeMaker,s=A.sheets.selected;
    s.inchesPerPixel=12;s.intersections=[];s.medians=[];s.lines=[];s.markings=[];s.gores=[];s.bridges=[];
    s.roads=[{id:1,lanes:1,laneWidth:12,laneTypes:{0:{type:'bike',width:5}},ends:[{joint:1,sign:1,length:curved?130:null},{joint:2,sign:1,length:curved?130:null}]},
      {id:2,lanes:1,laneWidth:12,ends:[{joint:3,sign:1},{joint:4,sign:1}]}];
    s.joints=[{id:1,x:500,y:100,links:[],dir:curved?{x:.3,y:Math.sqrt(.91)}:{x:0,y:1}},
      {id:2,x:500,y:500,links:[],dir:curved?{x:-.3,y:Math.sqrt(.91)}:{x:0,y:1}},
      {id:3,x:400,y:300,links:[],dir:{x:1,y:0}},{id:4,x:600,y:300,links:[],dir:{x:1,y:0}}];
    s.surfaces=[{id:'green',on:{road:1,lane:0},color:'green',pattern:'solid',from:0,to:1}];
    s.view={scale:8,x:900-500*8,y:500-300*8};A.sheets.zoomBy(1);
    const draw=A.longitudinal.drawTarget,groups=new Map();
    A.longitudinal.drawTarget=function(sheet,key,points,base,parent,...rest){if(key?.startsWith('r:1:'))groups.set(key,parent);return draw.call(this,sheet,key,points,base,parent,...rest);};
    try{A.roadEditor.render();}finally{A.longitudinal.drawTarget=draw;}
    const track=A.roadEditor.laneTracks(s)[0],edges=track.markingEdges;
    const strokes=[...groups.get('r:1:0').querySelectorAll('path.roadMarking[stroke="#ffffff"]')].map(path=>{
      const n=path.getAttribute('d').match(/-?\d*\.?\d+/g).map(Number);return Array.from({length:n.length/2},(_,i)=>({x:n[i*2],y:n[i*2+1]}));
    });
    const distance=(p,edge)=>Math.min(...edge.slice(1).map((b,i)=>{const a=edge[i],dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1)));return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);}));
    const sides=edges.map(edge=>strokes.filter(points=>points.every(p=>distance(p,edge)<.02)));
    const targets=edges.map(edge=>A.longitudinal.targetAt(edge[Math.floor(edge.length/4)])?.on);
    return {strokes,sides,edges,targets,placement:track.placementBounds};
   },curved);
   assert(result.strokes.length>2,'actual crossing keeps dotted edges');
   assert.equal(result.sides.flat().length,result.strokes.length,'every solid and dotted stroke follows the same editable edge path');
   for(const side of result.sides) {
    const lengths=side.map(p=>p.slice(1).reduce((sum,q,i)=>sum+Math.hypot(q.x-p[i].x,q.y-p[i].y),0));
    assert(lengths.every(n=>n<3),'outer edges have only conflict dashes, with no solid approaches');
    assert(lengths.some(n=>n<3),'dashes lie on that same edge at the crossing');
   }
   assert.deepEqual(result.targets.map(on=>[on.road,on.k]),[[1,0],[1,1]],'Markings picks the visible white edges');
   for(const bounds of result.placement)assert(Math.abs(bounds[0][1]-bounds[0][0]-5)<1e-8,'riding space remains 5 ft');
   if(!curved) {
    const rows=result.sides.map(side=>side.map(p=>[Math.min(...p.map(q=>q.y)),Math.max(...p.map(q=>q.y))]).sort((a,b)=>a[0]-b[0]));
    assert.deepEqual(rows[0],rows[1],'left and right conflict dashes keep the same phase');
    assert(Math.abs(result.edges[0][0].x-(500+2.5+8/12))<1e-8);
    assert(Math.abs(result.edges[1][0].x-(500-2.5-8/12))<1e-8);
   }
   await page.screenshot({path:`/tmp/standalone-bike-edges-${curved?'curved':'straight'}.png`});
  }
  assert.deepEqual(errors,[]);
  const widths=await page.evaluate(()=>{
   const A=StripeMaker,s=A.sheets.selected;s.roads=s.roads.slice(0,1);s.surfaces=[];
   s.roads[0].ends.forEach(e=>{delete e.length;});s.joints[0].dir=s.joints[1].dir={x:0,y:1};
   s.markings=[{id:'stop',type:'stopLine',on:{road:1,lane:0},back:30}];
   return ['bike','bufferedBike'].map(type=>{
    s.roads[0].laneTypes[0]={type,width:type==='bike'?5:7};A.roadEditor.render();
    const paths=[...s.roadLayer.querySelectorAll('.laneMarkings path')].filter(p=>p.getAttribute('fill')==='#ffffff');
    const xs=paths.flatMap(p=>p.getAttribute('d').match(/-?\d*\.?\d+/g).map(Number).filter((_,i)=>i%2===0));
    return Math.max(...xs)-Math.min(...xs);
   });
  });
  for(const [i,width]of widths.entries())assert(Math.abs(width-([5,7][i]+16/12))<.02,'stop bar fills the entire standalone pavement width, including buffer and aprons');
  console.log('PASS: standalone edges unmarked outside conflicts, aligned conflict dashes, editable targets, and full-width plain/buffered stop bars.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
