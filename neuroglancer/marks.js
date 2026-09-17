/* Screen-facing researcher symbols; pinned Neuroglancer handles all image, mesh, and camera rendering. */
(() => {
  'use strict';
  const kinds=new Map([['Мои метки · Контакты','contact'],['Мои метки · Особенности','point'],['Мои метки · Объекты','object'],['Мои метки · Области','point']]);
  const canvases=new Map();let queued=false,painted=[],hits=[],press=null;
  function project(matrix,point){
    const clip=[0,0,0,0];
    for(let row=0;row<4;row++)clip[row]=matrix[row]*point[0]+matrix[4+row]*point[1]+matrix[8+row]*point[2]+matrix[12+row];
    return clip[3]>0?clip.slice(0,3).map(n=>n/clip[3]):null;
  }
  function findings(viewer){
    const result=[];
    for(const managed of viewer.layerManager.managedLayers){
      const kind=kinds.get(managed.name);if(!kind||!managed.visible||managed.archived)continue;
      for(const annotation of managed.layer?.localAnnotations?.annotationMap?.values()||[]){
        if(!annotation.point)continue;
        const number=Number(annotation.properties?.[0]||annotation.description?.match(/^№(\d+)/)?.[1]);
        if(!Number.isSafeInteger(number)||number<1)continue;
        result.push({id:annotation.id,number,kind,point:annotation.point,managed});
      }
    }
    return result;
  }
  function draw(){
    queued=false;const viewer=window.viewer;if(!viewer?.display)return;
    const rows=findings(viewer),seen=new Set();painted=[];hits=[];
    for(const panel of viewer.display.panels){
      if(!panel.visible||!panel.element.isConnected)continue;
      const isSlice=!!panel.sliceView,projection=(isSlice?panel.sliceView.projectionParameters:panel.projectionParameters)?.value;
      if(!projection?.viewProjectionMat)continue;
      const element=panel.element,width=element.clientWidth,height=element.clientHeight;
      if(!width||!height)continue;
      seen.add(panel);
      let canvas=canvases.get(panel);
      if(!canvas){
        canvas=document.createElement('canvas');canvas.className='microns-numbered-marks';canvas.setAttribute('aria-hidden','true');
        Object.assign(canvas.style,{position:'absolute',left:'0',top:'0',width:'100%',height:'100%',pointerEvents:'none',zIndex:'5'});
        if(getComputedStyle(element).position==='static')element.style.position='relative';
        element.append(canvas);canvases.set(panel,canvas);
      }
      const ratio=window.devicePixelRatio||1,w=Math.round(width*ratio),h=Math.round(height*ratio);
      if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
      const ctx=canvas.getContext('2d');ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,width,height);
      // The pinned renderer's matrix already includes voxel anisotropy, slice rotation and camera zoom.
      for(const record of rows){
        const ndc=project(projection.viewProjectionMat,record.point);
        if(!ndc||ndc.some(n=>!Number.isFinite(n)||Math.abs(n)>1))continue;
        const x=(ndc[0]+1)*width/2,y=(1-ndc[1])*height/2,alpha=isSlice?Math.max(0,1-Math.abs(ndc[2])):1;
        if(alpha<.02)continue;
        ctx.globalAlpha=alpha;
        MarkerStyles.draw(ctx,x,y,Math.max(11,String(record.number).length*3.5+5),record.kind,record.number);
        painted.push({id:record.id,number:record.number,kind:record.kind,panel:isSlice?'2d':'3d',x,y,alpha});
        hits.push({canvas,x,y,record});
      }
      ctx.globalAlpha=1;
    }
    for(const [panel,canvas] of canvases)if(!seen.has(panel)){canvas.remove();canvases.delete(panel);}
  }
  function hit(event){
    let nearest=null,distance=18;
    for(const h of hits){if(!h.canvas.parentElement.contains(event.target))continue;const r=h.canvas.getBoundingClientRect(),d=Math.hypot(event.clientX-r.left-h.x,event.clientY-r.top-h.y);if(d<distance){nearest=h;distance=d;}}
    return nearest;
  }
  function select(h,event){
    const layer=h.record.managed.layer,state=layer.annotationStates.states.find(s=>s.source.get(h.record.id));
    if(!state)return;
    event.preventDefault();event.stopImmediatePropagation();
    layer.selectAnnotation(state,h.record.id,true);
  }
  function schedule(){if(!queued){queued=true;requestAnimationFrame(draw);}}
  function start(){
    if(!window.viewer?.display||!window.MarkerStyles){setTimeout(start,50);return;}
    viewer.display.updateFinished.add(draw);
    viewer.state.changed.add(schedule);
    window.addEventListener('resize',schedule);
    new ResizeObserver(schedule).observe(viewer.display.container);
    document.addEventListener('mousedown',event=>{
      press={x:event.clientX,y:event.clientY,moved:false};
      if(event.button===2&&event.ctrlKey){const h=hit(event);if(h)select(h,event);}
    },true);
    document.addEventListener('mousemove',event=>{if(press&&Math.hypot(event.clientX-press.x,event.clientY-press.y)>3)press.moved=true;},true);
    document.addEventListener('click',event=>{if(event.button===0&&!event.ctrlKey&&!event.altKey&&!event.shiftKey&&!press?.moved){const h=hit(event);if(h)select(h,event);}press=null;},true);
    document.addEventListener('contextmenu',event=>{if(event.ctrlKey&&hit(event)){event.preventDefault();event.stopImmediatePropagation();}},true);
    window.MicronsMarkers={get rendered(){return painted.map(p=>({...p}));},redraw:schedule};
    schedule();
  }
  start();
})();
