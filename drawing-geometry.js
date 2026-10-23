/* Drawing primitives adapted from the second-paper viewer/mark-drawing.js and
 * viewer/annotation-interaction.js. Preserve this site's voxel-center convention. */
(() => {
  'use strict';
  const PLANES={xy:[0,1,2]};
  const kinds=new Set(['trace','freehand','vesicle','arrow','roi','ellipse','distance']);
  function plan(volume,z){return {plane:'xy',axes:PLANES.xy,begin:volume.begin_vox_xyz,width:volume.shape_xyz[0],height:volume.shape_xyz[1],resolutionNm:volume.resolution_nm,depthNm:(volume.begin_vox_xyz[2]+z+.5)*volume.resolution_nm[2]};}
  function projectPoint(plan,point){return {x:point[0]/plan.resolutionNm[0]-plan.begin[0]-.5,y:point[1]/plan.resolutionNm[1]-plan.begin[1]-.5,onPlane:Math.abs(point[2]-plan.depthNm)<1e-5};}
  function pixelToNm(plan,x,y){return [(plan.begin[0]+Math.max(0,Math.min(plan.width-1,Math.floor(x)))+.5)*plan.resolutionNm[0],(plan.begin[1]+Math.max(0,Math.min(plan.height-1,Math.floor(y)))+.5)*plan.resolutionNm[1],plan.depthNm];}
  function opacityFor(geometry){
    const value=geometry?.opacity_override===false?(window.HandoffDrawings?.getStyle().opacity??geometry.opacity):geometry?.opacity;
    return Number.isFinite(value)&&value>=0&&value<=1?value:1;
  }
  function colorFor(record){return (record?.kind==='vesicle'?window.HandoffDrawings?.getVesicleColor?.():null)||record?.geometry?.color||'#ffd166';}
  function toMark(record){return {...record,pointsNm:record.geometry?.points_nm||[record.point_nm],plane:record.geometry?.plane||'xy',closed:record.geometry?.closed||false,color:colorFor(record),strokeWidth:record.geometry?.stroke_width||2,opacity:opacityFor(record.geometry)};}

// Adapted from donor mark-drawing.js
const escapeSvg = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[char]));
const markPoints = mark => mark.pointsNm || mark.points || (mark.pointNm ? [mark.pointNm] : []);
const markPlane = mark => {const value=typeof mark.plane === 'string' ? mark.plane : mark.plane?.plane ?? {x:'yz',y:'xz',z:'xy'}[mark.plane?.axis];return typeof value === 'string' ? value.toLowerCase() : undefined;};
// Stored widths are validated separately (1-12); rendered export widths may
// exceed 12 after multiplying by the output resolution.
const markStyle = mark => ({color:/^#[0-9a-f]{6}$/i.test(mark.color || '') ? mark.color : '#ffd166', strokeWidth:Number.isFinite(mark.strokeWidth) && mark.strokeWidth > 0 ? mark.strokeWidth : 2});
const markOpacity = mark => Number.isFinite(mark.opacity)&&mark.opacity>=0&&mark.opacity<=1?mark.opacity:1;
function visibleMarks(marks, plan) {
  return marks.filter(mark => mark.visible !== false && (!mark.plane || markPlane(mark) === plan.plane.toLowerCase()))
    .map(mark => ({...mark, projected:markPoints(mark).map(point => projectPoint(plan, point))}));
}
const finiteOnPlane = point => point?.onPlane && Number.isFinite(point.x) && Number.isFinite(point.y);

// One silhouette keeps the tip sharp at every width. Very short arrows shrink
// proportionally instead of letting a thick shaft swallow the arrowhead.
function arrowPolygon(a,b,width,headLength=14,headWidth=10){
  const dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy);if(!length)return [];
  const ux=dx/length,uy=dy/length,head=Math.min(Math.max(headLength,width*3.5),length*.45);
  const shaft=Math.min(width/2,head*.22),wing=Math.min(Math.max(headWidth/2,width*.95),head*.4);
  const base=[b[0]-ux*head,b[1]-uy*head],side=(p,w)=>[p[0]-uy*w,p[1]+ux*w];
  return [side(a,shaft),side(base,shaft),side(base,wing),b,side(base,-wing),side(base,-shaft),side(a,-shaft)];
}

/** The adapter projects voxel centers to sample indices; this offset restores their image centers. */
function markGeometry(mark, projectedPoints, {x=0, y=0, sx=1, sy=1, offset=.5, pointRadius=5, headLength=14, headWidth=10,outlineColor='none',outlineWidth=0}={}) {
  const points = projectedPoints || [], kind = mark.kind || mark.type;
  const position = point => [x + (point.x + offset) * sx, y + (point.y + offset) * sy];
  const polyline = vertices => ({tag:'polyline', attrs:{points:vertices.map(point => point.join(',')).join(' ')}, points:vertices});
  if (points.length === 1 && finiteOnPlane(points[0])) {
    const [cx,cy] = position(points[0]);
    // Vesicles and one-vertex freehand marks share the tested filled brush dab.
    const dot=['freehand','vesicle'].includes(kind);
    return [{tag:'circle',attrs:{cx,cy,r:dot?markStyle(mark).strokeWidth/2:pointRadius,...(dot?{fill:markStyle(mark).color,stroke:'none'}:{})}}];
  }
  if (['roi','ellipse','arrow'].includes(kind)) {
    if (points.length < 2 || !finiteOnPlane(points[0]) || !finiteOnPlane(points.at(-1))) return [];
    const a = position(points[0]), b = position(points.at(-1));
    if (kind === 'roi') return [{tag:'rect',attrs:{x:Math.min(a[0],b[0]),y:Math.min(a[1],b[1]),width:Math.abs(b[0]-a[0]),height:Math.abs(b[1]-a[1])}}];
    if (kind === 'ellipse') return [{tag:'ellipse',attrs:{cx:(a[0]+b[0])/2,cy:(a[1]+b[1])/2,rx:Math.abs(b[0]-a[0])/2,ry:Math.abs(b[1]-a[1])/2}}];
    const vertices=arrowPolygon(a,b,markStyle(mark).strokeWidth,headLength,headWidth);
    return vertices.length?[{tag:'polygon',points:vertices,attrs:{points:vertices.map(point=>point.join(',')).join(' '),fill:markStyle(mark).color,stroke:outlineColor,'stroke-width':outlineWidth,'stroke-linejoin':'miter','stroke-miterlimit':5}}]:[];
  }
  // Break paths at off-plane points rather than joining across unreviewed sections.
  const geometry=[];let run=[];
  const finish=()=>{if(run.length>1)geometry.push(polyline(run));run=[];};
  for(const point of points){if(finiteOnPlane(point))run.push(position(point));else finish();}
  // Closure is explicit and does not connect vertices across different sections.
  if(kind==='trace'&&mark.closed===true&&points.length>=3&&points.every(finiteOnPlane))run.push(position(points[0]));
  finish();
  return geometry;
}
function markSvg(mark, projectedPoints, options={}) {
  return markGeometry(mark, projectedPoints, options).map(({tag,attrs})=>`<${tag} ${Object.entries({...attrs,...(markOpacity(mark)<1?{opacity:markOpacity(mark)}:{})}).map(([key,value])=>`${key}="${escapeSvg(value)}"`).join(' ')}/>`).join('');
}
/** Canvas and SVG use identical geometry, with no smoothing of freehand vertices. */
function drawMark(ctx, mark, projectedPoints, options={}) {
  const geometry=markGeometry(mark,projectedPoints,options),style=markStyle(mark);
  ctx.save();ctx.globalAlpha*=markOpacity(mark);ctx.strokeStyle=style.color;ctx.lineWidth=style.strokeWidth;ctx.lineCap='round';ctx.lineJoin='round';ctx.beginPath();
  for(const {tag,attrs:a,points} of geometry){
    if(tag==='polygon'){
      ctx.moveTo(...points[0]);for(const point of points.slice(1))ctx.lineTo(...point);ctx.closePath();
      ctx.fillStyle=a.fill;ctx.fill();
      if(a.stroke!=='none'&&a['stroke-width']>0){ctx.strokeStyle=a.stroke;ctx.lineWidth=a['stroke-width'];ctx.lineJoin='miter';ctx.miterLimit=5;ctx.stroke();}
      ctx.restore();return geometry;
    }
    if(tag==='circle'){ctx.moveTo(a.cx+a.r,a.cy);ctx.arc(a.cx,a.cy,a.r,0,Math.PI*2);}
    else if(tag==='ellipse'){ctx.moveTo(a.cx+a.rx,a.cy);ctx.ellipse(a.cx,a.cy,a.rx,a.ry,0,0,Math.PI*2);}
    else if(tag==='rect')ctx.rect(a.x,a.y,a.width,a.height);
    else if(tag==='line'){ctx.moveTo(a.x1,a.y1);ctx.lineTo(a.x2,a.y2);}
    else if(tag==='polyline'){ctx.moveTo(...points[0]);for(const point of points.slice(1))ctx.lineTo(...point);}
  }
  if(['freehand','vesicle'].includes(mark.kind)&&projectedPoints.length===1){ctx.fillStyle=style.color;ctx.fill();}else ctx.stroke();ctx.restore();return geometry;
}
/** Sample only the requested ellipse overlay for 3D annotation transports. */
function ellipsePointsNm(mark, steps=64) {
  const points=markPoints(mark),axes=PLANES[markPlane(mark)];if(points.length<2||!axes)return [];
  const [u,v]=axes,a=points[0],b=points.at(-1),center=a.map((n,i)=>(n+b[i])/2),ru=Math.abs(b[u]-a[u])/2,rv=Math.abs(b[v]-a[v])/2;
  const ring=Array.from({length:steps},(_,i)=>{const point=[...center],angle=i/steps*Math.PI*2;point[u]+=ru*Math.cos(angle);point[v]+=rv*Math.sin(angle);return point;});
  return [...ring,[...ring[0]]];
}

// Adapted from donor annotation-interaction.js
const DRAG_TOOLS=new Set(['arrow','roi','ellipse','distance','freehand']);
const pointsOf=mark=>mark.pointsNm||mark.points||(mark.pointNm?[mark.pointNm]:[]);
const kindOf=mark=>mark.kind||mark.type;
function annotationPlane(mark){return (typeof mark.plane==='string'?mark.plane:mark.plane?.plane||({x:'yz',y:'xz',z:'xy'}[mark.plane?.axis]))?.toLowerCase();}
function editableOnPlane(mark,plan){
  const points=pointsOf(mark),plane=annotationPlane(mark);
  return mark.visible!==false&&(!plane||plane===plan.plane)&&points.length>0&&points.every(p=>projectPoint(plan,p).onPlane);
}
function markScreenPoints(mark,plan,rect){return pointsOf(mark).map(p=>{const q=projectPoint(plan,p);return [rect.x+(q.x+.5)*rect.w/plan.width,rect.y+(q.y+.5)*rect.h/plan.height];});}
function handleIndices(mark,max=64){const count=pointsOf(mark).length;if(count<=max)return Array.from({length:count},(_,i)=>i);return Array.from({length:max},(_,i)=>Math.round(i*(count-1)/(max-1)));}
const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
function lineDistance(p,a,b){const dx=b[0]-a[0],dy=b[1]-a[1],squared=dx*dx+dy*dy,t=squared?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/squared)):0;return distance(p,[a[0]+t*dx,a[1]+t*dy]);}
function hitsBody(mark,pts,p,tolerance){
  if(pts.length===1)return distance(p,pts[0])<=tolerance;
  const kind=kindOf(mark),a=pts[0],b=pts.at(-1);
  if(kind==='arrow'){
    const polygon=arrowPolygon(a,b,markStyle(mark).strokeWidth);let inside=false;
    for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
      const q=polygon[i],r=polygon[j];if(lineDistance(p,q,r)<=tolerance)return true;
      if((q[1]>p[1])!==(r[1]>p[1])&&p[0]<(r[0]-q[0])*(p[1]-q[1])/(r[1]-q[1])+q[0])inside=!inside;
    }
    return inside;
  }
  if(kind==='roi')return p[0]>=Math.min(a[0],b[0])-tolerance&&p[0]<=Math.max(a[0],b[0])+tolerance&&p[1]>=Math.min(a[1],b[1])-tolerance&&p[1]<=Math.max(a[1],b[1])+tolerance;
  if(kind==='ellipse'){const rx=Math.abs(a[0]-b[0])/2,ry=Math.abs(a[1]-b[1])/2,cx=(a[0]+b[0])/2,cy=(a[1]+b[1])/2;return ((p[0]-cx)/(rx+tolerance))**2+((p[1]-cy)/(ry+tolerance))**2<=1;}
  return pts.slice(1).some((q,i)=>lineDistance(p,pts[i],q)<=tolerance)||(kind==='trace'&&mark.closed===true&&pts.length>=3&&lineDistance(p,b,a)<=tolerance);
}
/** CSS-pixel hit testing is independent of native XY/XZ/YZ anisotropy. */
function hitAnnotation(marks,plan,rect,point,{activeId=null,tolerance=9}={}){
  const active=marks.find(m=>m.id===activeId&&editableOnPlane(m,plan));
  if(active){const pts=markScreenPoints(active,plan,rect);for(const index of handleIndices(active))if(distance(point,pts[index])<=tolerance)return {mark:active,index};}
  for(const mark of [...marks].reverse())if(editableOnPlane(mark,plan)&&hitsBody(mark,markScreenPoints(mark,plan,rect),point,tolerance))return {mark,index:null};
  return null;
}
/** Quantize pointer locations to this site's acquired voxel centers. */
function samplePoint(plan,pixel){return pixelToNm(plan,pixel.x,pixel.y);}
function moveAnnotation(mark,plan,startNm,endNm,index=null){
  const points=pointsOf(mark).map(p=>[...p]),[u,v]=plan.axes;
  if(index!==null){points[index][u]=endNm[u];points[index][v]=endNm[v];return points;}
  const delta=[0,0,0];delta[u]=endNm[u]-startNm[u];delta[v]=endNm[v]-startNm[v];
  return points.map(p=>p.map((n,i)=>n+delta[i]));
}
function validDraw(kind,points,plan){
  if(kind==='vesicle'&&points.length!==1)return false;
  if(['freehand','vesicle'].includes(kind)&&points.length===1)return points[0].length===3&&points[0].every(Number.isFinite)&&projectPoint(plan,points[0]).onPlane;
  if(points.length<2)return false;const [u,v]=plan.axes,a=points[0],b=points.at(-1);
  if(kind==='roi'||kind==='ellipse')return a[u]!==b[u]&&a[v]!==b[v];
  return points.some(p=>p[u]!==a[u]||p[v]!==a[v]);
}

  function pathsNm(record){
    if(!record.geometry)return [];
    const m=toMark(record),p=m.pointsNm,a=p[0],b=p.at(-1),z=a[2];
    if(m.kind==='ellipse')return [ellipsePointsNm(m)];
    if(m.kind==='roi')return [[a,[b[0],a[1],z],b,[a[0],b[1],z],a]];
    if(m.kind==='arrow'){
      const dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy);if(!length)return [];
      const head=Math.min(100,length*.3),half=head*.5,ux=dx/length,uy=dy/length;
      return [[a,b],[[b[0]-ux*head-uy*half,b[1]-uy*head+ux*half,z],b,[b[0]-ux*head+uy*half,b[1]-uy*head-ux*half,z]]];
    }
    return [m.closed?[...p,p[0]]:p];
  }
  function drawRecord(ctx,record,volume,z,{zoom=1,selected=false,x=0,y=0,unit=1,handles=false,showNumbers=false}={}){
    if(!record.geometry||record.volume_id!==volume.volume_id||record.geometry.slice_index!==volume.begin_vox_xyz[2]+z)return;
    const mark=toMark(record),p=plan(volume,z),projected=mark.pointsNm.map(point=>projectPoint(p,point)),opts={x,y,sx:zoom,sy:zoom,headLength:14*unit,headWidth:10*unit};
    // Translucent paths are painted once: stacked outline/color passes would
    // compound its opacity and darken the EM beneath the selected color.
    if(mark.kind==='arrow')drawMark(ctx,{...mark,strokeWidth:mark.strokeWidth*unit},projected,{...opts,outlineColor:'#10202d',outlineWidth:unit});
    else{
      if(markOpacity(mark)===1)drawMark(ctx,{...mark,color:'#10202d',strokeWidth:(mark.strokeWidth+2)*unit},projected,opts);
      drawMark(ctx,{...mark,strokeWidth:mark.strokeWidth*unit},projected,opts);
    }
    const first=projected[0],cx=x+(first.x+.5)*zoom,cy=y+(first.y+.5)*zoom;
    ctx.save();ctx.font=`bold ${13*unit}px system-ui`;ctx.lineWidth=3*unit;ctx.strokeStyle='#10202d';ctx.fillStyle=mark.color;
    let label=showNumbers&&record.number?'№'+record.number:'';
    if(mark.kind==='distance')label+=(label?' · ':'')+(Math.hypot(...mark.pointsNm[0].map((n,i)=>n-mark.pointsNm.at(-1)[i]))/1000).toFixed(3)+' мкм';
    if(label){ctx.save();ctx.globalAlpha*=markOpacity(mark);ctx.strokeText(label,cx+9*unit,cy-9*unit);ctx.fillText(label,cx+9*unit,cy-9*unit);ctx.restore();}
    if(selected&&handles){for(const index of handleIndices(mark)){const point=projected[index],hx=x+(point.x+.5)*zoom,hy=y+(point.y+.5)*zoom;ctx.fillStyle='#fff';ctx.strokeStyle='#126395';ctx.lineWidth=1.5*unit;ctx.beginPath();ctx.rect(hx-4*unit,hy-4*unit,8*unit,8*unit);ctx.fill();ctx.stroke();}}
    ctx.restore();
  }
  window.HandoffDrawingGeometry={kinds,plan,projectPoint,pixelToNm,toMark,opacityFor,colorFor,pathsNm,drawRecord,drawMark,markGeometry,markSvg,hitAnnotation,moveAnnotation,validDraw,handleIndices,markScreenPoints,editableOnPlane};
})();
