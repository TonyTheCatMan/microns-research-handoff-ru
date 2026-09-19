/* Exact native-voxel XY boundaries shared by the main viewer. Never substitute filled labels. */
(() => {
  'use strict';
  const bus=window.HandoffSync,canvases=new Map();let packet=null,overlay=null,bitmap=null,generation=0,queued=false;
  function receive(message){
    if(message.type==='state-reply'){if(message.payload?.message)receive(message.payload.message);return;}
    if(message.type!=='host-state'||!bus.newer(message,packet))return;
    packet=message;const next=message.payload?.main?.boundaryOverlay;
    if(next?.dataUrl===overlay?.dataUrl&&JSON.stringify(next?.begin_vox_xyz)===JSON.stringify(overlay?.begin_vox_xyz)&&next?.local_z===overlay?.local_z){overlay=next;schedule();return;}
    overlay=next;bitmap=null;const token=++generation;
    if(!next?.dataUrl?.startsWith('data:image/png;base64,')){schedule();return;}
    const image=new Image();image.onload=()=>{if(token===generation){bitmap=image;schedule();}};image.src=next.dataUrl;schedule();
  }
  function project(matrix,point,width,height){
    const p=[0,0,0,0];for(let row=0;row<4;row++)p[row]=matrix[row]*point[0]+matrix[row+4]*point[1]+matrix[row+8]*point[2]+matrix[row+12];
    if(p[3]<=0)return null;return[(p[0]/p[3]+1)*width/2,(1-p[1]/p[3])*height/2];
  }
  function draw(){
    queued=false;if(!window.viewer?.display)return;
    const seen=new Set(),state=viewer.state.toJSON(),q=state.crossSectionOrientation||[0,0,0,1];
    const xy=Math.abs(q[0])<1e-5&&Math.abs(q[1])<1e-5;
    for(const panel of viewer.display.panels){
      if(!panel.sliceView||!panel.visible||!panel.element.isConnected)continue;
      seen.add(panel);let canvas=canvases.get(panel);
      if(!canvas){canvas=document.createElement('canvas');canvas.className='microns-segmentation-borders';Object.assign(canvas.style,{position:'absolute',left:0,top:0,width:'100%',height:'100%',pointerEvents:'none',zIndex:4});panel.element.append(canvas);canvases.set(panel,canvas);}
      const w=panel.element.clientWidth,h=panel.element.clientHeight,dpr=devicePixelRatio||1;
      if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);}
      const ctx=canvas.getContext('2d');ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,canvas.width,canvas.height);
      if(!bitmap||!overlay||!xy||!w||!h||Math.floor(viewer.position.value[2])!==overlay.begin_vox_xyz[2]+overlay.local_z)continue;
      const [x,y,z0]=overlay.begin_vox_xyz,[sx,sy]=overlay.shape_xyz,z=z0+overlay.local_z+.5,matrix=panel.sliceView.projectionParameters.value.viewProjectionMat;
      const a=project(matrix,[x,y,z],w,h),b=project(matrix,[x+sx,y,z],w,h),c=project(matrix,[x,y+sy,z],w,h);if(!a||!b||!c)continue;
      ctx.setTransform(dpr*(b[0]-a[0])/bitmap.width,dpr*(b[1]-a[1])/bitmap.width,dpr*(c[0]-a[0])/bitmap.height,dpr*(c[1]-a[1])/bitmap.height,dpr*a[0],dpr*a[1]);ctx.imageSmoothingEnabled=false;ctx.drawImage(bitmap,0,0);
    }
    for(const [panel,canvas]of canvases)if(!seen.has(panel)){canvas.remove();canvases.delete(panel);}
  }
  function schedule(){if(!queued){queued=true;requestAnimationFrame(draw);}}
  bus.subscribe(receive);
  function start(){if(!window.viewer?.display){setTimeout(start,50);return;}viewer.display.updateFinished.add(draw);viewer.state.changed.add(schedule);window.addEventListener('resize',schedule);if(window.MicronsViewSync?.latest)receive(MicronsViewSync.latest);schedule();}
  start();
})();
