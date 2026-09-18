/* Exact current-section segmentation from the bundled native seg_m1300 voxel labels. */
(() => {
  'use strict';
  const $=id=>document.getElementById(id),base=new URL('.',document.currentScript.src);
  let manifestPromise,worker,entry,labels,colorTable,volumeId=null,generation=0,requestId=0,wantedZ=null,current={ready:false,canvas:null,bordersCanvas:null};
  const waiters=[],volumeColors=new Map();
  let selectionCache=null,displayCache=null;
  function colorForSegment(id){
    const override=volumeColors.get(volumeId)?.[String(id)];if(override)return [...override];
    let hash=2166136261;for(const ch of String(id)){hash^=ch.charCodeAt(0);hash=Math.imul(hash,16777619);}
    const hue=(hash>>>0)%360,s=.63,l=.55,c=(1-Math.abs(2*l-1))*s,x=c*(1-Math.abs((hue/60)%2-1)),m=l-c/2;
    const rgb=hue<60?[c,x,0]:hue<120?[x,c,0]:hue<180?[0,c,x]:hue<240?[0,x,c]:hue<300?[x,0,c]:[c,0,x];return rgb.map(n=>Math.round((n+m)*255));
  }
  function canvas(width,height){const c=document.createElement('canvas');c.width=width;c.height=height;return c;}
  function announce(){window.dispatchEvent(new CustomEvent('segmentation:slice',{detail:current}));}
  function status(text,error=false){const target=$('segmentationStatus');if(target){target.textContent=text;target.classList.toggle('save-failed',error);}}
  function overlay(){
    let c=$('segmentationCanvas');if(!c&&$('canvasWrap')){c=canvas(1,1);c.id='segmentationCanvas';c.setAttribute('aria-hidden','true');$('canvasWrap').insertBefore(c,$('overlayCanvas'));}
    if(c)Object.assign(c.style,{position:'absolute',left:'0',top:'0',pointerEvents:'none',imageRendering:'pixelated'});return c;
  }
  function opacityValue(){const input=$('segmentationOpacity'),n=Number(input?.value??.18);return Math.max(0,Math.min(1,Number(input?.max)>1?n/100:n));}
  function limitValue(){
    const value=Number($('segmentationLimit')?.value??5),limit=Number.isFinite(value)?Math.max(1,Math.min(30,Math.round(value))):5;
    if($('segmentationLimit'))$('segmentationLimit').value=String(limit);if($('segmentationLimitReadout'))$('segmentationLimitReadout').textContent=String(limit);return limit;
  }
  function selection2D(){
    if(!current.ready||!entry)return null;
    const scope=$('segmentationScope')?.value==='all'?'all':'nearby',limit=limitValue(),surface=window.ReviewViewer?.surface;
    const matches=surface?.caseId===entry.case_id&&surface?.volume?.volume_id===entry.volume_id,point=matches&&surface.contextFocus;
    const focus=Array.isArray(point)&&point.length===3&&point.every(Number.isFinite)?[...point]:[entry.shape_xyz[0]*entry.resolution_nm[0]/2,entry.shape_xyz[1]*entry.resolution_nm[1]/2,(wantedZ+.5)*entry.resolution_nm[2]];
    const key=JSON.stringify([scope,limit,focus]);
    // Zoom and brightness updates reuse the native selection and its painted canvases.
    if(!selectionCache||selectionCache.labels!==labels||selectionCache.key!==key){
      const present=new Set(current.objects.map(o=>o.segment_id)),seeds=entry.seed_objects.map(o=>o.segment_id).filter(id=>present.has(id));
      const neighbors=scope==='nearby'?nearest({point_local_nm:focus,limit,exclude_segment_ids:entry.seed_objects.map(o=>o.segment_id)}):current.objects.filter(o=>!seeds.includes(o.segment_id));
      const ids=scope==='all'?current.objects.map(o=>o.segment_id):[...seeds,...neighbors.map(o=>o.segment_id)];
      selectionCache={labels,key,settings:{scope,nearby_limit:limit,segment_ids:ids,focus_local_nm:focus},neighborCount:neighbors.length,seedCount:seeds.length,source:null,fillCanvas:null,bordersCanvas:null};
    }
    if(selectionCache.source!==current.canvas){
      const ids=selectionCache.settings.segment_ids;selectionCache.source=current.canvas;
      selectionCache.fillCanvas=scope==='all'?current.canvas:paint({segment_ids:ids});
      selectionCache.bordersCanvas=scope==='all'?current.bordersCanvas:paint({segment_ids:ids,fill:false,borders:true});
    }
    const focusLabel=point?(surface.contextFocusLabel||'выбранная точка'):'центр среза';
    status(scope==='all'?`Все: ${selectionCache.settings.segment_ids.length} · Z ${wantedZ}`:`Рядом: ${selectionCache.neighborCount} · основных: ${selectionCache.seedCount} · ${focusLabel} · Z ${wantedZ}`);
    return selectionCache;
  }
  function display(){
    const c=overlay(),image=$('imageCanvas');if(!c||!image)return;
    c.style.width=image.style.width;c.style.height=image.style.height;
    limitValue();const all=$('segmentationScope')?.value==='all';if($('segmentationLimitControl'))$('segmentationLimitControl').hidden=all;if($('segmentationLimit'))$('segmentationLimit').disabled=all;const selection=selection2D();
    const fill=!!$('segmentation2D')?.checked,borders=!!$('segmentationBorders')?.checked;
    c.hidden=!current.ready||(!fill&&!borders);if(c.hidden)return;
    if(c.width!==image.width){c.width=image.width;displayCache=null;}if(c.height!==image.height){c.height=image.height;displayCache=null;}
    const opacity=opacityValue(),key=JSON.stringify([fill,borders,opacity]);
    if(displayCache?.selection===selection&&displayCache.source===selection.source&&displayCache.key===key)return;
    const ctx=c.getContext('2d');ctx.clearRect(0,0,c.width,c.height);
    if(fill){ctx.globalAlpha=opacity;ctx.drawImage(selection.fillCanvas,0,0);}
    if(borders){ctx.globalAlpha=Math.max(.4,opacity);ctx.drawImage(selection.bordersCanvas,0,0);}ctx.globalAlpha=1;
    displayCache={selection,source:selection.source,key};
  }
  function invalidate(detail={}){
    labels=null;colorTable=null;selectionCache=null;displayCache=null;current={...detail,ready:false,canvas:null,bordersCanvas:null};display();announce();
  }
  function boundaryAt(data,x,y,width,height){
    const at=y*width+x,id=data[at];return id!==0&&((x>0&&data[at-1]!==id)||(x+1<width&&data[at+1]!==id)||(y>0&&data[at-width]!==id)||(y+1<height&&data[at+width]!==id));
  }
  function parseColor(value,fallback){
    if(typeof value==='string'&&/^#[\da-f]{6}$/i.test(value))return[1,3,5].map(i=>parseInt(value.slice(i,i+2),16));
    if(Array.isArray(value)&&value.length>=3&&value.slice(0,3).every(Number.isFinite)){const k=value.slice(0,3).every(n=>n>=0&&n<=1)?255:1;return value.slice(0,3).map(n=>Math.max(0,Math.min(255,Math.round(n*k))));}return fallback;
  }
  function paint({segment_ids=null,fill=true,borders=false,opacity=1,borderOpacity=opacity,colors=null}={}){
    if(!labels||!entry)return null;
    const [width,height]=entry.shape_xyz,c=canvas(width,height),ctx=c.getContext('2d'),pixels=ctx.createImageData(width,height),wanted=segment_ids===null?null:new Set(segment_ids.map(String)),rgb=colorTable.map((color,i)=>parseColor(colors instanceof Map?colors.get(entry.palette[i]):colors?.[entry.palette[i]],color));
    const alpha=Math.round(Math.max(0,Math.min(1,Number(opacity)))*255),edgeAlpha=Math.round(Math.max(0,Math.min(1,Number(borderOpacity)))*255);
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const i=y*width+x,id=labels[i];if(!id||wanted&&!wanted.has(entry.palette[id]))continue;
      const at=i*4,edge=borders&&boundaryAt(labels,x,y,width,height);if(!fill&&!edge)continue;
      const color=edge?[28,48,58]:rgb[id];pixels.data.set(color,at);pixels.data[at+3]=edge?edgeAlpha:alpha;
    }
    ctx.putImageData(pixels,0,0);return c;
  }
  function objectsInSlice(){
    const [width,height]=entry.shape_xyz,res=entry.resolution_nm,stats=new Map(),descriptors=new Map([...entry.objects,...entry.seed_objects].map(o=>[o.segment_id,o]));
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const id=labels[y*width+x];if(!id)continue;
      let stat=stats.get(id);if(!stat){const segment_id=entry.palette[id];stat={...descriptors.get(segment_id),segment_id,palette_index:id,voxel_count:0,sum:[0,0],bounds:[[x,y],[x+1,y+1]]};stats.set(id,stat);}
      stat.voxel_count++;stat.sum[0]+=x+.5;stat.sum[1]+=y+.5;stat.bounds[0][0]=Math.min(stat.bounds[0][0],x);stat.bounds[0][1]=Math.min(stat.bounds[0][1],y);stat.bounds[1][0]=Math.max(stat.bounds[1][0],x+1);stat.bounds[1][1]=Math.max(stat.bounds[1][1],y+1);
    }
    return [...stats.values()].map(({sum,bounds,...object})=>({...object,centroid_local_nm:[sum[0]/object.voxel_count*res[0],sum[1]/object.voxel_count*res[1],(wantedZ+.5)*res[2]],bounds_local_nm:[[bounds[0][0]*res[0],bounds[0][1]*res[1],wantedZ*res[2]],[bounds[1][0]*res[0],bounds[1][1]*res[1],(wantedZ+1)*res[2]]]}));
  }
  function nearest({point_local_nm,limit=5,exclude_segment_ids=[]}={}){
    if(!current.ready||!Array.isArray(point_local_nm)||point_local_nm.length!==3||!point_local_nm.every(Number.isFinite))return[];
    const [width,height]=entry.shape_xyz,[rx,ry,rz]=entry.resolution_nm,[px,py,pz]=point_local_nm,excluded=new Set(exclude_segment_ids.map(String)),best=new Float64Array(entry.palette.length);best.fill(Infinity);
    const dz=(wantedZ+.5)*rz-pz;
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const id=labels[y*width+x];if(!id||excluded.has(entry.palette[id]))continue;
      // Distance to the actual occupied XY voxel rectangle, never to a mesh projection or bounding box.
      const dx=Math.max(x*rx-px,0,px-(x+1)*rx),dy=Math.max(y*ry-py,0,py-(y+1)*ry),distance=dx*dx+dy*dy+dz*dz;if(distance<best[id])best[id]=distance;
    }
    return current.objects.filter(o=>Number.isFinite(best[o.palette_index])).map(o=>({...o,distance_nm:Math.sqrt(best[o.palette_index])})).sort((a,b)=>a.distance_nm-b.distance_nm||a.segment_id.localeCompare(b.segment_id)).slice(0,Math.max(0,Math.floor(limit)));
  }
  function receive(message,token){
    if(token!==generation||message.token!==generation)return;
    if(message.type==='error'){invalidate({case_id:entry?.case_id,volume_id:volumeId,local_z:wantedZ,error:message.message});status(message.message,true);for(const waiter of waiters.splice(0))waiter.reject(new Error(message.message));return;}
    if(message.type!=='slice'||message.request_id!==requestId||message.local_z!==wantedZ)return;
    labels=message.labels;colorTable=entry.palette.map(colorForSegment);
    current={ready:true,case_id:entry.case_id,volume_id:entry.volume_id,local_z:message.local_z,global_z_center_vox:entry.begin_vox_xyz[2]+message.local_z+.5,shape_xyz:[...entry.shape_xyz],resolution_nm:[...entry.resolution_nm],begin_vox_xyz:[...entry.begin_vox_xyz],source_version:'seg_m1300',canvas:paint(),bordersCanvas:paint({fill:false,borders:true}),objects:objectsInSlice()};
    const count=new Set(labels);count.delete(0);status(`Сегментация · ${count.size} сегментов · ${entry.volume_id} · Z ${message.local_z}`);display();announce();for(const waiter of waiters.splice(0))waiter.resolve(current);
  }
  function manifest(){return manifestPromise||(manifestPromise=fetch(new URL('context_index.json',base)).then(r=>{if(!r.ok)throw new Error('Не удалось открыть индекс сегментации.');return r.json();}).then(data=>{if(data.schema_version!==1||!Array.isArray(data.volumes))throw new Error('Неверный индекс сегментации.');return new Map(data.volumes.map(v=>[v.volume_id,v]));}).catch(error=>{manifestPromise=null;throw error;}));}
  async function load(volume,caseId,z){
    worker?.terminate();worker=null;entry=null;volumeId=volume.volume_id;wantedZ=z;const token=++generation;requestId++;
    invalidate({case_id:caseId,volume_id:volumeId,local_z:z});status('Загружаем сегментацию текущего объёма…');
    try{
      const index=await manifest();if(token!==generation)return;const found=index.get(volumeId);
      if(!found||found.case_id!==caseId||['shape_xyz','resolution_nm','begin_vox_xyz'].some(key=>found[key].join(',')!==volume[key].join(',')))throw new Error('Сетка сегментации не совпадает с текущим ЭМ-объёмом.');
      entry=found;worker=new Worker(new URL('slice-segmentation-worker.js',base));worker.onmessage=e=>receive(e.data,token);worker.onerror=()=>receive({type:'error',token,message:'Не удалось прочитать сегментацию текущего объёма.'},token);
      worker.postMessage({type:'load',token,volume:entry,url:new URL(entry.data_path,base).href,local_z:wantedZ,request_id:requestId});
    }catch(error){receive({type:'error',token,message:error.message},token);}
  }
  function sync(){
    const v=window.ReviewViewer;if(!v?.ready)return;
    if(volumeId!==v.volume.volume_id){load(v.volume,v.currentCase.case_id,v.z);return;}
    if(wantedZ===v.z){display();return;}wantedZ=v.z;requestId++;invalidate({case_id:v.currentCase.case_id,volume_id:volumeId,local_z:wantedZ});
    worker?.postMessage({type:'slice',token:generation,request_id:requestId,local_z:wantedZ});
  }
  function ensure(){const v=window.ReviewViewer;if(current.error&&v?.ready)load(v.volume,v.currentCase.case_id,v.z);else sync();return current.ready?Promise.resolve(current):new Promise((resolve,reject)=>waiters.push({resolve,reject}));}
  const segmentAt=(x,y)=>current.ready&&Number.isInteger(x)&&Number.isInteger(y)&&x>=0&&y>=0&&x<entry.shape_xyz[0]&&y<entry.shape_xyz[1]?entry.palette[labels[y*entry.shape_xyz[0]+x]]:null;
  function captureFor(volume_id,local_z){
    const fill=!!$('segmentation2D')?.checked,borders=!!$('segmentationBorders')?.checked;
    if(!current.ready||current.volume_id!==volume_id||current.local_z!==local_z||(!fill&&!borders))return null;
    display();const source=$('segmentationCanvas'),copy=canvas(source.width,source.height);copy.getContext('2d').drawImage(source,0,0);
    const selected=selection2D().settings;
    return{canvas:copy,settings:{source_version:'seg_m1300',volume_id,local_z,fill,borders,opacity:opacityValue(),boundary_method:'native_xy_label_transition_pixels',scope:selected.scope,nearby_limit:selected.nearby_limit,segment_ids:[...selected.segment_ids],focus_local_nm:[...selected.focus_local_nm]}};
  }
  async function restore(settings){
    const data=await ensure(),s=settings;
    if(!s||data.volume_id!==s.volume_id||data.local_z!==s.local_z||s.source_version!=='seg_m1300')throw new Error('Сегментация не соответствует сохранённому срезу.');
    const scope=s.scope??'all',limit=s.nearby_limit??5;
    if(!['nearby','all'].includes(scope)||!Number.isInteger(limit)||limit<1||limit>30||s.focus_local_nm!==undefined&&(!Array.isArray(s.focus_local_nm)||s.focus_local_nm.length!==3||!s.focus_local_nm.every(Number.isFinite)))throw new Error('Неверные настройки сохранённой сегментации.');
    if($('segmentationScope'))$('segmentationScope').value=scope;if($('segmentationLimit'))$('segmentationLimit').value=String(limit);
    for(const [id,value]of [['segmentation2D',s.fill],['segmentationBorders',s.borders]])if($(id))$(id).checked=!!value;
    if($('segmentationOpacity')&&Number.isFinite(s.opacity))$('segmentationOpacity').value=String(s.opacity*100);
    if(s.focus_local_nm)window.ReviewViewer?.surface?.setContextFocus(s.focus_local_nm,'сохранённый вид');
    selectionCache=null;displayCache=null;display();
    const actual=selection2D().settings.segment_ids;
    if(s.segment_ids!==undefined&&(!Array.isArray(s.segment_ids)||JSON.stringify([...s.segment_ids].sort())!==JSON.stringify([...actual].sort())))throw new Error('Сохранённый набор сегментов не совпадает с текущим срезом.');
    for(const id of ['segmentationScope','segmentationLimit','segmentation2D','segmentationBorders','segmentationOpacity'])$(id)?.dispatchEvent(new Event('change'));
    return captureFor(s.volume_id,s.local_z);
  }
  function setColors(colors,forVolume=volumeId){
    if(typeof forVolume!=='string'||!colors)return;
    const entries=colors instanceof Map?[...colors]:Object.entries(colors),next={};
    for(const [id,value]of entries.sort(([a],[b])=>String(a).localeCompare(String(b))))if(/^\d+$/.test(String(id))){const parsed=parseColor(value,null);if(parsed)next[String(id)]=parsed;}
    if(JSON.stringify(volumeColors.get(forVolume)||{})===JSON.stringify(next))return;volumeColors.set(forVolume,next);
    if(current.ready&&forVolume===volumeId){colorTable=entry.palette.map(colorForSegment);current={...current,canvas:paint(),bordersCanvas:paint({fill:false,borders:true})};display();announce();}
  }
  window.SliceSegmentation={get current(){return current;},get selection(){return selection2D()?.settings||null;},ensure,render:paint,captureFor,restore,setColors,colorForSegment,segmentAt,lookup:segmentAt,nearest};
  window.addEventListener('review:volume',()=>{worker?.terminate();worker=null;volumeId=null;generation++;for(const waiter of waiters.splice(0))waiter.reject(new Error('Выбран другой объём.'));invalidate();status('Подготавливаем сегментацию…');});
  window.addEventListener('review:position',sync);window.addEventListener('review:display',display);window.addEventListener('resize',display);
  window.addEventListener('surface:visibility',event=>{if(event.detail?.volume_id===volumeId)display();});
  function start(){for(const id of ['segmentation2D','segmentationBorders','segmentationOpacity','segmentationScope','segmentationLimit'])for(const event of ['change','input'])$(id)?.addEventListener(event,display);sync();}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
