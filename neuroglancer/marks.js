/* Screen-facing researcher and T-point symbols; Neuroglancer supplies the projection matrices. */
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
      const kind=kinds.get(managed.name),seed=managed.name==='Заданные точки · не проверены';if((!kind&&!seed)||!managed.visible||managed.archived)continue;
      for(const annotation of managed.layer?.localAnnotations?.annotationMap?.values()||[]){
        if(!annotation.point)continue;
        if(seed){
          const match=/^(.+)-(ctr_nm|pre_nm|post_nm)$/.exec(annotation.id);if(!match)continue;
          const suffix={ctr_nm:'',pre_nm:' пре',post_nm:' пост'}[match[2]];
          result.push({id:annotation.id,kind:match[2],label:match[1]+suffix,seed:true,point:annotation.point,managed});continue;
        }
        const number=Number(annotation.properties?.[0]||annotation.description?.match(/^№(\d+)/)?.[1]);
        if(!Number.isSafeInteger(number)||number<1)continue;
        result.push({id:annotation.id,number,kind,point:annotation.point,managed});
      }
    }
    return result;
  }
  function drawTargetLabels(ctx,labels,obstacles,width,height){
    const placed=[],overlaps=(a,b)=>a.left<b.right+3&&a.right>b.left-3&&a.top<b.bottom+3&&a.bottom>b.top-3;
    ctx.font='bold 13px system-ui';ctx.textAlign='left';ctx.textBaseline='alphabetic';ctx.lineJoin='round';
    for(const item of labels){
      const {x,y,record,alpha,rendered,hit}=item,w=ctx.measureText(record.label).width,choices=[];
      for(const dx of [11,-11-w])for(const dy of [-10,-28,22,-46,40,-64,58,-82,76,-100,94,-118,112])choices.push({x:x+dx,y:y+dy});
      const box=p=>({left:p.x-2,right:p.x+w+2,top:p.y-13,bottom:p.y+3});
      const fits=p=>{const r=box(p);return r.left>=2&&r.right<=width-2&&r.top>=2&&r.bottom<=height-2;};
      const p=choices.find(p=>fits(p)&&![...placed,...obstacles].some(r=>overlaps(box(p),r)))||choices.find(fits)||{x:Math.max(4,Math.min(width-w-4,x+11)),y:Math.max(16,Math.min(height-5,y-10))};
      const bounds=box(p);placed.push(bounds);hit.labelBox=bounds;Object.assign(rendered,{labelX:p.x,labelY:p.y,labelBox:bounds});
      ctx.globalAlpha=alpha;const color=MarkerStyles.styles[record.kind].color;
      if(p.x!==x+11||p.y!==y-10){const endX=Math.max(bounds.left,Math.min(bounds.right,x)),endY=Math.max(bounds.top,Math.min(bounds.bottom,y));ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(endX,endY);ctx.strokeStyle='#13212c';ctx.lineWidth=3;ctx.stroke();ctx.strokeStyle=color;ctx.lineWidth=1;ctx.stroke();MarkerStyles.draw(ctx,x,y,6,record.kind);}
      ctx.lineWidth=3;ctx.strokeStyle='#13212c';ctx.fillStyle=color;ctx.strokeText(record.label,p.x,p.y);ctx.fillText(record.label,p.x,p.y);
    }
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
      const targetLabels=[],obstacles=[];
      // The pinned renderer's matrix already includes voxel anisotropy, slice rotation and camera zoom.
      for(const record of rows){
        const ndc=project(projection.viewProjectionMat,record.point);
        if(!ndc||ndc.some(n=>!Number.isFinite(n)||Math.abs(n)>1))continue;
        const x=(ndc[0]+1)*width/2,y=(1-ndc[1])*height/2,alpha=isSlice?Math.max(0,1-Math.abs(ndc[2])):1;
        if(alpha<.02)continue;
        ctx.globalAlpha=alpha;
        const radius=record.seed?6:Math.max(11,String(record.number).length*3.5+5);
        MarkerStyles.draw(ctx,x,y,radius,record.kind,record.seed?'':record.number);
        const rendered={id:record.id,number:record.number,kind:record.kind,label:record.label,seed:!!record.seed,panel:isSlice?'2d':'3d',x,y,alpha},hit={canvas,x,y,record};
        painted.push(rendered);hits.push(hit);obstacles.push({left:x-radius,right:x+radius,top:y-radius,bottom:y+radius});
        if(record.seed)targetLabels.push({x,y,record,alpha,rendered,hit});
      }
      drawTargetLabels(ctx,targetLabels,obstacles,width,height);
      ctx.globalAlpha=1;
    }
    for(const [panel,canvas] of canvases)if(!seen.has(panel)){canvas.remove();canvases.delete(panel);}
  }
  function hit(event){
    let nearest=null,distance=18;
    for(const h of hits){if(!h.canvas.parentElement.contains(event.target))continue;const r=h.canvas.getBoundingClientRect(),x=event.clientX-r.left,y=event.clientY-r.top,b=h.labelBox,d=b&&x>=b.left&&x<=b.right&&y>=b.top&&y<=b.bottom?0:Math.hypot(x-h.x,y-h.y);if(d<=distance){nearest=h;distance=d;}}
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
    window.MicronsMarkers={get rendered(){return painted.filter(p=>!p.seed).map(p=>({...p}));},get targets(){return painted.filter(p=>p.seed).map(p=>({...p}));},redraw:schedule};
    schedule();
  }
  start();
})();
