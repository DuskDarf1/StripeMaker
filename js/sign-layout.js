/* Schematic sign assemblies, in sheet pixels. Artwork remains vector paths. */
(() => {
  const parts = sign => [sign, ...(sign.panels ?? [])];
  function layout(sign, measure) {
    const items=parts(sign).map((part,i)=>({part,row:part.row??i,column:part.column??0,...measure(part,sign)}));
    const columns=[...new Set(items.map(p=>p.column))].sort((a,b)=>a-b);
    const rows=[...new Set(items.map(p=>p.row))].sort((a,b)=>a-b);
    const widths=columns.map(c=>Math.max(...items.filter(p=>p.column===c).map(p=>p.width)));
    const heights=rows.map(r=>Math.max(...items.filter(p=>p.row===r).map(p=>p.height)));
    const gap=0;
    const width=widths.reduce((a,b)=>a+b,0)+gap*(columns.length-1),height=heights.reduce((a,b)=>a+b,0)+gap*(rows.length-1);
    for(const item of items){
      const c=columns.indexOf(item.column),r=rows.indexOf(item.row);
      item.x=-width/2+widths.slice(0,c).reduce((a,b)=>a+b,0)+gap*c+widths[c]/2;
      item.y=-height/2+heights.slice(0,r).reduce((a,b)=>a+b,0)+gap*r+heights[r]/2;
    }
    return {width,height,items};
  }
  function rotate(x,y,angle){const a=angle*Math.PI/180;return {x:x*Math.cos(a)-y*Math.sin(a),y:x*Math.sin(a)+y*Math.cos(a)};}
  function path(d,scale,x,y,angle,cx,cy){
    return d.replace(/(-?\d*\.?\d+(?:e[-+]?\d+)?)\s+(-?\d*\.?\d+(?:e[-+]?\d+)?)/gi,(_,a,b)=>{
      const p=rotate(+a*scale+x,+b*scale+y,angle);return `${(p.x+cx).toFixed(4)} ${(p.y+cy).toFixed(4)}`;
    });
  }
  const api={parts,layout,rotate,path};
  if(typeof module!=='undefined')module.exports=api;else(window.StripeMaker??={}).signLayout=api;
})();
