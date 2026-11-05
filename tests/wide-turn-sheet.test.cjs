const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');const src=fs.readFileSync('js/elements.js','utf8');const cut=(a,b)=>src.slice(src.indexOf(a),src.indexOf(b));
const ctx=vm.createContext({window:{StripeMaker:{roadWidths:require(process.cwd()+'/js/road-widths.js')}},console});
let code=cut('  const LINE_INCHES','  document.addEventListener')+cut('    const inchesToPixels','    function layerFor')+'function layerFor(){}\n'+cut('    function solve(','    // Where a lane node is drawn')+cut('    const shapeOffset=','    function lanePoint')+cut('    function wideTurnHosts(','    function joinedPolygons(')+cut('    function laneLinks(','    // Bike lane keyholes')+'const polylineLength=p=>p.slice(1).reduce((a,v,i)=>a+Math.hypot(v.x-p[i].x,v.y-p[i].y),0);';
vm.runInContext(code,ctx);ctx.sheet=JSON.parse(fs.readFileSync('tests/fixtures/kinkcurve-roads.json'));

const result=vm.runInContext(`(()=>{
 const solved=solve(sheet),road=sheet.roads.find(r=>r.id===12),host=sheet.roads.find(r=>r.id===15);
 const turn=shapeOf(sheet,road,solved),main=shapeOf(sheet,host,solved);
 const left=boundary(turn,0),right=boundary(turn,1);
 const before=JSON.stringify(right);
 // Neighbor clipping and polygon construction traverse the right edge in
 // reverse. This must never reverse the cached curve used by later drawing.
 boundary(turn,1).reverse();
 if(JSON.stringify(boundary(turn,1))!==before)throw new Error('Polygon traversal mutated the white-edge cache');
 return {whiteHosts:wideTurnHosts(sheet,road).map(h=>boundary(shapeOf(sheet,h,solved),h.lanes)),left,right,line:turn.line,normal:turn.widthNormal,target:boundary(main,2)[0],tangent:turn.line[0].tangent,host:wideTurnHosts(sheet,road).map(h=>{const sh=shapeOf(sheet,h,solved);return [...boundary(sh,0),...boundary(sh,h.lanes).reverse()];}),scale:sheet.inchesPerPixel/12};
})()`,ctx);
const {left,right,host,scale,line,normal,target,tangent}=result;
for(let i=0;i<left.length;i++) {
 assert(Math.abs(left[i].x-(line[i].x-normal.x*10/scale))<1e-8,'yellow edge must remain unchanged');
 assert(Math.abs(left[i].y-(line[i].y-normal.y*10/scale))<1e-8,'yellow edge must remain unchanged');
}
let gap=Infinity;
for(const points of result.whiteHosts)for(let i=1;i<points.length;i++){
 const a=points[i-1],b=points[i],dx=b.x-a.x,dy=b.y-a.y;
 const f=Math.max(0,Math.min(1,((right[0].x-a.x)*dx+(right[0].y-a.y)*dy)/(dx*dx+dy*dy)));
 gap=Math.min(gap,Math.hypot(right[0].x-a.x-f*dx,right[0].y-a.y-f*dy));
}
assert(gap<1e-8,'white join lies on the receiving white line');
for(let i=0;i<left.length;i++)assert(Math.abs(((right[i].x-left[i].x)*normal.x+(right[i].y-left[i].y)*normal.y)*scale-20)<1e-8,'white blend retains the full 20 ft cross-section throughout');
const dx=right[1].x-right[0].x,dy=right[1].y-right[0].y;
assert((dx*tangent.x+dy*tangent.y)/Math.hypot(dx,dy)>.999,'white join tangent matches host');
assert(Math.abs(Math.hypot(right.at(-1).x-left.at(-1).x,right.at(-1).y-left.at(-1).y)*scale-20)<1e-8,'free end retains full width');
const {trim}=require('../js/marking-trim.js');
assert(trim(left,host)[0].distance>0,'yellow still ends at mainline boundary');
console.log('PASS: white edge joins smoothly; yellow curve and cutoff stay unchanged; driveway retains its free-end width.');
