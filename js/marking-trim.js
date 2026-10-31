// Geometrically trim marking centerlines against joined traveled-way polygons.
// Boundary-coincident lines remain visible; only strictly interior spans disappear.
(() => {
  const EPS = 1e-7;
  const cross = (a,b) => a.x*b.y-a.y*b.x;
  const sub = (a,b) => ({x:a.x-b.x,y:a.y-b.y});
  const at = (a,b,t) => ({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
  function inside(p, polygon) {
    let hit=false;
    for(let i=0,j=polygon.length-1;i<polygon.length;j=i++) {
      const a=polygon[j],b=polygon[i],d=sub(b,a),v=sub(p,a);
      if(Math.abs(cross(d,v)) <= EPS*Math.max(1,Math.hypot(d.x,d.y)) &&
        v.x*d.x+v.y*d.y >= -EPS && v.x*d.x+v.y*d.y <= d.x*d.x+d.y*d.y+EPS) return false;
      if((a.y>p.y)!==(b.y>p.y) && p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x) hit=!hit;
    }
    return hit;
  }
  // Bounding boxes, cached per polygon: a segment only tests the polygons it can touch.
  const boxes=new WeakMap();
  function box(polygon) {
    let b=boxes.get(polygon);
    if(!b) {
      b={x0:Infinity,y0:Infinity,x1:-Infinity,y1:-Infinity};
      for(const p of polygon) {b.x0=Math.min(b.x0,p.x);b.y0=Math.min(b.y0,p.y);b.x1=Math.max(b.x1,p.x);b.y1=Math.max(b.y1,p.y);}
      boxes.set(polygon,b);
    }
    return b;
  }
  function trim(points, polygons) {
    const result=[];let walked=0,current=null;
    for(let i=1;i<points.length;i++) {
      const a=points[i-1],b=points[i],d=sub(b,a),length=Math.hypot(d.x,d.y);
      if(length<EPS) continue;
      const cuts=[0,1],pad=EPS*Math.max(1,length);
      const x0=Math.min(a.x,b.x)-pad,x1=Math.max(a.x,b.x)+pad,y0=Math.min(a.y,b.y)-pad,y1=Math.max(a.y,b.y)+pad;
      const near=polygons.filter(polygon=>{const q=box(polygon);return q.x0<=x1&&q.x1>=x0&&q.y0<=y1&&q.y1>=y0;});
      for(const polygon of near) for(let j=0;j<polygon.length;j++) {
        const p=polygon[j],q=polygon[(j+1)%polygon.length],edge=sub(q,p),v=sub(p,a),den=cross(d,edge);
        if(Math.abs(den)<EPS) {
          if(Math.abs(cross(v,d))<EPS) for(const point of [p,q]) {
            const t=((point.x-a.x)*d.x+(point.y-a.y)*d.y)/(length*length);
            if(t>0&&t<1) cuts.push(t);
          }
          continue;
        }
        const t=cross(v,edge)/den,u=cross(v,d)/den;
        if(t>0&&t<1&&u>=-EPS&&u<=1+EPS) cuts.push(t);
      }
      cuts.sort((a,b)=>a-b);
      for(let j=1;j<cuts.length;j++) {
        const lo=cuts[j-1],hi=cuts[j];if(hi-lo<EPS) continue;
        if(near.some(p=>inside(at(a,b,(lo+hi)/2),p))) {current=null;continue;}
        if(!current) {current={points:[at(a,b,lo)],distance:walked+lo*length};result.push(current);}
        current.points.push(at(a,b,hi));
      }
      walked+=length;
    }
    return result;
  }
  const api={trim};
  if(typeof module!=='undefined') module.exports=api;
  else (window.StripeMaker??={}).markingTrim=api;
})();
