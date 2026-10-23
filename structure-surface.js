/* Selected structures keep their exact v1300 geometry and shared 2D/3D colors. */
(() => {
  'use strict';
  let pending=null,queued=false,applying=false;
  const surface=()=>window.ReviewViewer?.surface,selection=view=>window.StructureSelection?.getPreferences(view.caseId)?.structures||[];
  const rgb=color=>[1,3,5].map(i=>parseInt(color.slice(i,i+2),16)/255);
  function cancel(){if(pending){pending.worker.terminate();pending.view.canvas.dataset.selectionLoading='false';pending.reject(Object.assign(new Error('Выбран другой объём или набор структур.'),{cancelled:true}));pending=null;}}
  function apply(view=surface()){
    if(applying||!view?.modelReady)return;applying=true;
    try{
      const preferences=window.StructureSelection?.getPreferences(view.caseId)||{},selected=new Map((preferences.structures||[]).map(o=>[o.segment_id,o]));let changed=false,colorChanged=false;
      for(const mesh of view.meshes){
        mesh.originalColor??=mesh.cssColor;mesh.originalLabel??=mesh.label;
        const item=selected.get(mesh.segment_id),override=preferences.color_overrides?.[mesh.segment_id],colorChoice=item||(override?{color:override,color_mode:'individual'}:undefined),info=window.HandoffRoles?.identify(view.caseId,view.volume.volume_id,mesh.segment_id),next=window.HandoffRoles?.colorFor(view.caseId,view.volume.volume_id,mesh.segment_id,mesh.originalColor,colorChoice)||colorChoice?.color||mesh.originalColor;
        if(mesh.selectionVisible!==item?.visible){mesh.selectionVisible=item?.visible;changed=true;}
        if(mesh.cssColor!==next){mesh.cssColor=next;mesh.color=rgb(next);colorChanged=changed=true;}
        mesh.identity=info?{role:info.role,status:info.status,identity_verified:info.identity_verified,nucleus_id:info.nucleus_id,source_version:'seg_m1300',limitation:info.limitation}:undefined;
        const sourceName=info?(window.HandoffRoles.shortLabel?.(info)||window.HandoffRoles.label(info)):(window.HandoffI18n?.translate('Неизвестная структура')||'Неизвестная структура'),customName=!info&&preferences.name_overrides?.[mesh.segment_id],name=customName||sourceName;
        mesh.sourceLabel=info?window.HandoffRoles.label(info):sourceName;
        if(mesh.label!==name){mesh.label=name;changed=true;}
        const control=mesh.control;if(control){
          const swatch=control.querySelector('.object-swatch');if(swatch)swatch.style.backgroundColor=next;
          const input=control.querySelector('input');if(input){input.checked=item?item.visible:mesh.visible&&(mesh.context||!!mesh.geometry);input.disabled=!mesh.geometry&&!mesh.context;}
          const text=control.querySelector('[data-object-label]');if(text){text.toggleAttribute('data-no-i18n',!!customName);if(text.textContent!==name)text.textContent=name;}
          const technical=control.querySelector('[data-object-technical]');if(technical)technical.textContent=mesh.id;
          const status=control.querySelector('[data-object-status]');if(status){status.hidden=!info||info.identity_verified;status.textContent=window.HandoffI18n?.translate('Объект не подтверждён')||'Объект не подтверждён';}
          control.title=[mesh.sourceLabel,window.HandoffRoles?.details(info),mesh.id+' · seg_m1300: '+(mesh.segment_id||''),mesh.clipped.length?'Касается граней фрагмента: '+mesh.clipped.join(', '):''].filter(Boolean).join('\n');
          if(mesh.context)control.hidden=!item&&(!view.contextVisible||!view.contextShown.has(mesh.id));
        }
      }
      if(colorChanged)window.SliceSegmentation?.setColors(Object.fromEntries(view.meshes.filter(m=>m.segment_id).map(m=>[m.segment_id,m.cssColor])),view.volume.volume_id);
      if(changed){view.updateSliceTextures();view.schedule();view.visibilityChanged();}
      window.HandoffI18n?.refresh(view.objectsUI);
    }finally{applying=false;}
  }
  async function ensure(view=surface()){
    if(!view?.modelReady||!view.volume)return;const token=view.token;
    const entry=await view.loadContextEntry(token);if(token!==view.token||!entry)throw Object.assign(new Error('Выбран другой объём.'),{cancelled:true});apply(view);
    const selected=new Set(selection(view).filter(o=>o.visible).map(o=>o.segment_id)),wanted=entry.objects.filter(o=>selected.has(o.segment_id)&&!view.meshes.find(m=>m.id===o.id)?.geometry);
    if(!wanted.length)return;
    const key=entry.volume_id+':'+wanted.map(o=>o.id).sort().join(',');if(pending?.key===key&&pending.view===view&&pending.token===token)return pending.promise;
    cancel();let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;}),job={key,view,token,promise,resolve,reject,worker:new Worker('context-worker.js')};pending=job;view.canvas.dataset.selectionLoading='true';
    const finish=error=>{job.worker.terminate();if(pending===job)pending=null;view.canvas.dataset.selectionLoading='false';apply(view);view.schedule();error?reject(error):resolve();};
    job.worker.onerror=event=>finish(new Error(event.message||'Не удалось построить выбранные структуры.'));
    job.worker.onmessage=event=>{
      if(pending!==job||view.token!==token)return;const data=event.data;if(data.token!==token)return;
      if(data.type==='error'){finish(new Error(data.message));return;}if(data.type==='done'){finish(wanted.some(o=>!view.meshes.find(m=>m.id===o.id)?.geometry)?new Error('Не все выбранные поверхности загружены. Повторите сохранение.'):null);return;}if(data.type!=='mesh')return;
      try{
        const object=data.object,expected=wanted.find(o=>o.id===object.id),mesh=view.meshes.find(m=>m.id===object.id),vertices=object.vertices,faces=object.faces;
        if(!mesh||!expected||expected.segment_id!==object.segment_id||!(vertices instanceof Float32Array)||!(faces instanceof Uint32Array)||vertices.length<9||faces.length<3||vertices.length%3||faces.length%3)throw new Error('Неверная сетка выбранной структуры.');
        const bounds=[[Infinity,Infinity,Infinity],[-Infinity,-Infinity,-Infinity]];
        for(let i=0;i<vertices.length;i++){const n=vertices[i],axis=i%3;if(!Number.isFinite(n)||n<-.1||n>view.bounds[axis]+.1)throw new Error('Структура выходит за границы объёма.');bounds[0][axis]=Math.min(bounds[0][axis],n);bounds[1][axis]=Math.max(bounds[1][axis],n);}
        for(const index of faces)if(index>=vertices.length/3)throw new Error('Неверный треугольник выбранной структуры.');
        view.deleteGeometry(mesh.geometry);Object.assign(mesh,{vertices,triangles:faces,bounds,geometry:view.geometry(vertices,faces),faces:faces.length/3});apply(view);view.schedule();view.visibilityChanged();
      }catch(error){finish(error);}
    };
    job.worker.postMessage({type:'load',token,volume:{...entry,objects:wanted},url:new URL(entry.data_path,location.href).href});return promise;
  }
  function refresh(){if(queued)return;queued=true;queueMicrotask(()=>{queued=false;const view=surface();apply(view);ensure(view).catch(error=>{if(!error.cancelled&&view?.modelReady){const node=document.getElementById('structureSelectionStatus');if(node){node.textContent=error.message;node.classList.add('save-failed');}}});});}
  window.StructureSurface={apply,ensure};
  for(const event of ['structures:changed','roles:changed','roles:ready','annotations:surface-ready','annotations:ready','annotations:changed'])window.addEventListener(event,refresh);
  window.addEventListener('surface:visibility',()=>apply());
  window.addEventListener('annotations:contextstatus',event=>{if(event.detail.status!=='loading')refresh();});
  window.addEventListener('handoff:languagechange',()=>apply());
  window.addEventListener('review:volume',()=>{cancel();refresh();});
})();
