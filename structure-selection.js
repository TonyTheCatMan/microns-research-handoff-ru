/* Deliberate, case-scoped selections of exact seg_m1300 voxel identities. */
(() => {
  'use strict';
  const $=id=>document.getElementById(id),source='seg_m1300',cases=new Map(),neutral='#9aa0a6';
  const clone=value=>structuredClone(value),currentCase=()=>window.ReviewViewer?.currentCase?.case_id||null;
  let picking=false,pointer=null,previousCase=null,applying=false,renderSignature='',annotationsReady=false;
  const defaults=case_id=>({schema_version:1,source_version:source,case_id,structures:[],scope:'selected',fill:false,borders:false,opacity:.25});
  function normalizePreferences(value){
    const s=value;
    if(!s||s.schema_version!==1||s.source_version!==source||!/^R\d{3}$/.test(s.case_id)||!Array.isArray(s.structures)||s.structures.length>256||!['selected','nearby','all'].includes(s.scope)||typeof s.fill!=='boolean'||typeof s.borders!=='boolean'||!Number.isFinite(s.opacity)||s.opacity<0||s.opacity>.7)throw new Error('Неверные настройки выбранных структур seg_m1300.');
    const seen=new Set(),structures=s.structures.map(o=>{
      if(!o||typeof o.segment_id!=='string'||!/^[1-9]\d{0,19}$/.test(o.segment_id)||BigInt(o.segment_id)>18446744073709551615n||seen.has(o.segment_id)||typeof o.visible!=='boolean'||typeof o.color!=='string'||!/^#[\da-f]{6}$/i.test(o.color))throw new Error('Неверные настройки выбранных структур seg_m1300.');
      if(o.color_mode!==undefined&&!['role','individual'].includes(o.color_mode))throw new Error('Неверные настройки выбранных структур seg_m1300.');
      seen.add(o.segment_id);return{segment_id:o.segment_id,color:o.color.toLowerCase(),visible:o.visible,color_mode:o.color_mode??'individual'};
    });
    let overrides;
    if(s.color_overrides!==undefined){
      if(!s.color_overrides||typeof s.color_overrides!=='object'||Array.isArray(s.color_overrides)||Object.keys(s.color_overrides).length>256)throw new Error('Неверные настройки выбранных структур seg_m1300.');
      overrides={};for(const [id,color]of Object.entries(s.color_overrides)){
        if(!/^[1-9]\d{0,19}$/.test(id)||BigInt(id)>18446744073709551615n||typeof color!=='string'||!/^#[\da-f]{6}$/i.test(color))throw new Error('Неверные настройки выбранных структур seg_m1300.');
        overrides[id]=color.toLowerCase();
      }
    }
    let names;
    if(s.name_overrides!==undefined){
      if(!s.name_overrides||typeof s.name_overrides!=='object'||Array.isArray(s.name_overrides)||Object.keys(s.name_overrides).length>256)throw new Error('Неверные названия структур.');
      names={};for(const [id,name]of Object.entries(s.name_overrides)){
        if(!/^[1-9]\d{0,19}$/.test(id)||BigInt(id)>18446744073709551615n||typeof name!=='string'||!name.trim()||name.length>120||/[\u0000-\u001f\u007f]/.test(name))throw new Error('Неверные названия структур.');
        names[id]=name.trim();
      }
    }
    return{schema_version:1,source_version:source,case_id:s.case_id,structures,scope:s.scope,fill:s.fill,borders:s.borders,opacity:s.opacity,...(overrides?{color_overrides:overrides}:{}),...(names?{name_overrides:names}:{})};
  }
  function readControls(s){
    if($('segmentationScope')&&['selected','nearby','all'].includes($('segmentationScope').value))s.scope=$('segmentationScope').value;
    if($('segmentation2D'))s.fill=$('segmentation2D').checked;
    if($('segmentationBorders'))s.borders=$('segmentationBorders').checked;
    if($('segmentationOpacity'))s.opacity=Math.max(0,Math.min(.7,Number($('segmentationOpacity').value)/100));
    return s;
  }
  function getPreferences(caseId=currentCase()){
    if(!caseId)return null;
    const s=cases.get(caseId)||defaults(caseId);
    if(caseId===previousCase&&caseId===currentCase())readControls(s);
    const result=clone(s);for(const object of result.structures)object.color=window.HandoffRoles?.colorFor(caseId,null,object.segment_id,object.color,object)||object.color;return result;
  }
  function setControls(s){
    if($('segmentationScope'))$('segmentationScope').value=s.scope;
    if($('segmentation2D'))$('segmentation2D').checked=s.fill;
    if($('segmentationBorders'))$('segmentationBorders').checked=s.borders;
    if($('segmentationOpacity'))$('segmentationOpacity').value=String(Math.round(s.opacity*100));
  }
  function announce(s){window.dispatchEvent(new CustomEvent('structures:changed',{detail:{case_id:s.case_id,preferences:clone(s)}}));}
  function applyPreferences(value,{emit=false}={}){
    const s=normalizePreferences(value),changed=previousCase!==s.case_id||JSON.stringify(getPreferences(s.case_id))!==JSON.stringify(s);cases.set(s.case_id,s);
    if(s.case_id===currentCase()&&changed){
      applying=true;previousCase=s.case_id;setControls(s);render();window.SliceSegmentation?.refresh();applying=false;
    }
    if(emit)announce(s);return clone(s);
  }
  function replaceAllPreferences(values,{emit=false}={}){
    if(!Array.isArray(values))throw new Error('Неверные настройки выбранных структур seg_m1300.');
    const normalized=values.map(normalizePreferences);if(new Set(normalized.map(s=>s.case_id)).size!==normalized.length)throw new Error('Неверные настройки выбранных структур seg_m1300.');
    const id=currentCase(),before=id?getPreferences(id):null,next=id?(normalized.find(s=>s.case_id===id)||defaults(id)):null,changed=id&&(previousCase!==id||JSON.stringify(before)!==JSON.stringify(next));
    cases.clear();for(const s of normalized)cases.set(s.case_id,s);previousCase=id;
    if(changed){applying=true;setControls(next);render();window.SliceSegmentation?.refresh();applying=false;}
    if(emit)for(const s of normalized)announce(s);
  }
  function commit(s,{rerender=true}={}){
    const normalized=normalizePreferences(s);cases.set(s.case_id,normalized);setControls(normalized);
    if(rerender)render();applying=true;window.SliceSegmentation?.refresh();applying=false;announce(normalized);return normalized;
  }
  function seedDefaults(){
    const caseId=currentCase(),viewer=window.ReviewViewer,roles=window.HandoffRoles,slice=window.SliceSegmentation?.current;
    // An open store is not yet hydrated. Never replace a saved choice, including an empty list.
    if(!annotationsReady||!window.HandoffAnnotations?.store||!caseId||cases.has(caseId)||!roles?.manifest||!slice?.ready||slice.case_id!==caseId||slice.volume_id!==viewer?.volume?.volume_id||$('annotationsImport')?.disabled||$('annotationsImportCase')?.disabled)return false;
    // Selections belong to the case: starting in an extension must not omit its main-volume roles.
    const ids=[...new Set(Object.values(roles.manifest.volumes).filter(v=>v.case_id===caseId).flatMap(v=>Object.values(v.objects||{}).map(o=>o.segment_id)))].filter(id=>roles.identifyInCase(caseId,id));
    if(!ids.length)return false;
    const order={excitatory:0,inhibitory:1,recipient:2};ids.sort((a,b)=>order[roles.identifyInCase(caseId,a).palette_role]-order[roles.identifyInCase(caseId,b).palette_role]);
    const preferences=defaults(caseId);preferences.fill=true;
    preferences.structures=ids.map(segment_id=>({segment_id,color:roles.colorFor(caseId,null,segment_id),visible:true,color_mode:'role'}));
    commit(preferences);return true;
  }
  function message(text,error=false){const node=$('structureSelectionStatus');if(node){node.textContent=text;node.classList.toggle('save-failed',error);}}
  function setPicking(value){
    picking=!!value;pointer=null;const button=$('structurePick');if(button){button.setAttribute('aria-pressed',String(picking));button.classList.toggle('active',picking);button.textContent=picking?'Завершить выбор':'Выбрать любую структуру';}
    $('viewport')?.classList.toggle('structure-picking',picking);
    if(picking)message('Нажмите на структуру. Esc - завершить.');
  }
  function rememberColor(s,object){
    if(object.color_mode==='role')return;
    s.color_overrides??={};delete s.color_overrides[object.segment_id];s.color_overrides[object.segment_id]=object.color;
    // Selected objects already retain their own color, so reserve the bounded history for removed objects.
    while(Object.keys(s.color_overrides).length>256){const keys=Object.keys(s.color_overrides),redundant=keys.find(id=>id!==object.segment_id&&s.structures.some(o=>o.segment_id===id));delete s.color_overrides[redundant||keys[0]];}
  }
  function removeSegment(segmentId){
    const s=getPreferences(),object=s?.structures.find(o=>o.segment_id===String(segmentId));if(!object)return false;
    rememberColor(s,object);s.structures=s.structures.filter(o=>o.segment_id!==object.segment_id);commit(s);return true;
  }
  function addSegment(segmentId){
    const id=String(segmentId),s=getPreferences(),availability=window.SliceSegmentation?.availability(id);
    if(!window.HandoffAnnotations?.store)return false;
    if(!s||!availability?.ready||!availability.present_in_volume||id==='0'){message('В этой точке нет доступного сегмента seg_m1300.',true);return false;}
    const existing=s.structures.find(o=>o.segment_id===id);
    if(existing){existing.visible=true;message('Структура уже выбрана.');}
    else{
      const saved=s.color_overrides?.[id];
      s.structures.push({segment_id:id,color:saved||window.HandoffRoles?.colorFor(s.case_id,null,id)||neutral,visible:true,color_mode:saved?'individual':'role'});message('Структура выбрана.');
    }
    s.scope='selected';s.fill=true;commit(s);return true;
  }
  function element(tag,className,text){const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;}
  function renameSegment(segmentId,name,caseId=currentCase()){
    const s=getPreferences(caseId),id=String(segmentId);if(!s||typeof name!=='string')return false;
    if(!/^[1-9]\d{0,19}$/.test(id)||BigInt(id)>18446744073709551615n||name.length>120||/[\u0000-\u001f\u007f]/.test(name))throw new Error('Неверные названия структур.');
    s.name_overrides??={};if(name.trim())s.name_overrides[id]=name.trim();else delete s.name_overrides[id];
    // Reuse the case preferences path so names share save/load and cross-window synchronization.
    if(caseId===currentCase())commit(s);else applyPreferences(s,{emit:true});return true;
  }
  function nameControl(object,caseId,info){
    const line=element('div','structure-name-line'),name=element('span','structure-name',(!info&&getPreferences(caseId)?.name_overrides?.[object.segment_id])||window.HandoffRoles?.shortLabel(info)||'Неизвестная структура');
    name.dataset.noI18n='';line.append(name);
    if(info)return line;
    const edit=element('button','structure-rename','✎');edit.type='button';edit.title='Переименовать структуру';edit.setAttribute('aria-label','Переименовать структуру');line.append(edit);
    edit.addEventListener('click',()=>{
      const form=element('form','structure-name-editor'),input=element('input');input.type='text';input.maxLength=120;input.value=getPreferences(caseId)?.name_overrides?.[object.segment_id]||'';input.placeholder='Название структуры';input.setAttribute('aria-label','Название структуры');
      const save=element('button','','✓'),cancel=element('button','','×');save.type='submit';save.title='Сохранить название';save.setAttribute('aria-label','Сохранить название');cancel.type='button';cancel.title='Отмена';cancel.setAttribute('aria-label','Отмена');
      const close=()=>{line.replaceChildren(name,edit);edit.focus({preventScroll:true});};
      form.addEventListener('submit',event=>{event.preventDefault();try{renameSegment(object.segment_id,input.value,caseId);if(line.isConnected){name.textContent=getPreferences(caseId)?.name_overrides?.[object.segment_id]||window.HandoffRoles?.shortLabel(info)||'Неизвестная структура';close();}else $('structureSelectionList')?.querySelector(`[data-segment-id="${object.segment_id}"] .structure-rename`)?.focus({preventScroll:true});}catch(error){message(error.message,true);}});
      cancel.addEventListener('click',close);input.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();}});
      form.append(input,save,cancel);line.replaceChildren(form);window.HandoffI18n?.refresh(line);input.focus({preventScroll:true});input.select();
    });return line;
  }
  function render(){
    const host=$('structureSelectionControls');if(!host)return;
    const s=getPreferences(),ready=!!window.SliceSegmentation?.current.ready&&!!window.HandoffAnnotations?.store;
    const signature=JSON.stringify([s?.case_id,s?.scope,s?.name_overrides,ready,window.HandoffI18n?.language,window.SliceSegmentation?.seedObjects,s?.structures.map(o=>[o.segment_id,o.visible,window.SliceSegmentation?.availability(o.segment_id),window.HandoffRoles?.label(window.HandoffRoles?.identifyInCase(s.case_id,o.segment_id))])]);
    if(signature===renderSignature&&$('structureSelectionList')){for(const row of $('structureSelectionList').children){const object=s.structures.find(o=>o.segment_id===row.dataset.segmentId);if(object&&row.querySelector('input[type=color]').value!==object.color)row.querySelector('input[type=color]').value=object.color;}return;}
    renderSignature=signature;
    if(!$('structurePick')){
      const actions=element('div','structure-selection-actions'),pick=element('button','','Выбрать любую структуру');pick.type='button';pick.id='structurePick';pick.setAttribute('aria-pressed','false');pick.addEventListener('click',()=>setPicking(!picking));actions.append(pick);
      const seeds=element('div','structure-seed-controls');seeds.id='structureSeeds';actions.append(seeds);
      const rows=element('div','structure-selection-list');rows.id='structureSelectionList';
      const status=element('div','hint');status.id='structureSelectionStatus';status.setAttribute('role','status');
      host.append(actions,rows,status);
    }
    $('structurePick').disabled=!ready||!s;
    const seeds=$('structureSeeds');seeds.replaceChildren();
    const originals=window.SliceSegmentation?.seedObjects||[];
    if(originals.length){for(const object of originals){
      const info=window.HandoffRoles?.identifyInCase(s?.case_id,object.segment_id),button=element('button','structure-seed',window.HandoffRoles?.shortLabel(info)||'Неизвестная структура');button.type='button';button.dataset.segmentId=object.segment_id;button.title=[window.HandoffRoles?.label(info),window.HandoffRoles?.details(info),`${object.id} · ${source}: ${object.segment_id}`].filter(Boolean).join('\n');button.disabled=!ready;button.addEventListener('click',()=>addSegment(object.segment_id));seeds.append(button);
    }}
    const rows=$('structureSelectionList');rows.replaceChildren();
    for(const object of s?.structures||[]){
      const row=element('div','structure-selection-row');row.dataset.segmentId=object.segment_id;
      const visibility=element('label','structure-visibility'),checkbox=element('input');checkbox.type='checkbox';checkbox.checked=object.visible;checkbox.setAttribute('aria-label','Показать структуру');checkbox.addEventListener('change',()=>{const next=getPreferences();next.structures.find(o=>o.segment_id===object.segment_id).visible=checkbox.checked;commit(next,{rerender:false});});visibility.append(checkbox);
      const color=element('input','structure-color');color.type='color';color.value=object.color;color.setAttribute('aria-label','Цвет структуры');color.addEventListener('input',()=>{const next=getPreferences(),selected=next.structures.find(o=>o.segment_id===object.segment_id);selected.color=color.value;selected.color_mode='individual';rememberColor(next,selected);commit(next,{rerender:false});});
      const identity=element('div','structure-identity'),seed=originals.find(o=>o.segment_id===object.segment_id),info=window.HandoffRoles?.identifyInCase(s.case_id,object.segment_id);
      identity.append(nameControl(object,s.case_id,info));
      if(info&&!info.identity_verified)identity.append(element('span','structure-unresolved','Объект не подтверждён'));
      const technical=element('details','structure-provenance');technical.append(element('summary','',seed?seed.id+' · источник':'ID / источник'));technical.append(element('code','',`${source}: ${object.segment_id}`),element('span','',window.HandoffRoles?.details(info)||''));identity.append(technical);
      const availability=window.SliceSegmentation?.availability(object.segment_id),state=!availability?.ready?'Срез загружается':!availability.present_in_volume?'Нет в этом объёме seg_m1300':availability.present_in_slice?'Есть на этом срезе':'Нет на этом срезе';identity.append(element('span','hint structure-availability',state));
      const remove=element('button','structure-remove','Убрать');remove.type='button';remove.setAttribute('aria-label','Убрать структуру из выбранных');remove.addEventListener('click',()=>removeSegment(object.segment_id));
      row.append(visibility,color,identity,remove);rows.append(row);
    }
    host.classList.toggle('structure-scope-inactive',s?.scope!=='selected');
    window.HandoffI18n?.refresh(host);
  }
  function changedControls(){
    if(applying||!currentCase())return;
    const s=readControls(getPreferences());cases.set(s.case_id,s);render();window.SliceSegmentation?.refresh();announce(s);
  }
  function consume(event){event.preventDefault();event.stopImmediatePropagation();}
  function start(){
    const viewport=$('viewport');
    viewport?.addEventListener('pointerdown',event=>{
      if(!picking||event.button!==0||event.shiftKey||event.altKey||!window.SliceSegmentation?.current.ready)return;
      const r=$('imageCanvas').getBoundingClientRect();if(event.clientX<r.left||event.clientY<r.top||event.clientX>=r.right||event.clientY>=r.bottom)return;
      pointer={id:event.pointerId,x:event.clientX,y:event.clientY,moved:false,case_id:currentCase(),volume_id:window.SliceSegmentation.current.volume_id,z:window.SliceSegmentation.current.local_z};viewport.setPointerCapture(event.pointerId);viewport.focus({preventScroll:true});consume(event);
    },true);
    viewport?.addEventListener('pointermove',event=>{if(!pointer||event.pointerId!==pointer.id)return;pointer.moved||=Math.hypot(event.clientX-pointer.x,event.clientY-pointer.y)>6;consume(event);},true);
    viewport?.addEventListener('pointerup',event=>{
      if(!pointer||event.pointerId!==pointer.id)return;const p=pointer;pointer=null;consume(event);if(viewport.hasPointerCapture(event.pointerId))viewport.releasePointerCapture(event.pointerId);
      const data=window.SliceSegmentation.current;if(p.moved||p.case_id!==currentCase()||p.volume_id!==data.volume_id||p.z!==data.local_z||!data.ready)return;
      const r=$('imageCanvas').getBoundingClientRect(),x=Math.floor((event.clientX-r.left)/r.width*data.shape_xyz[0]),y=Math.floor((event.clientY-r.top)/r.height*data.shape_xyz[1]);addSegment(window.SliceSegmentation.segmentAt(x,y));
    },true);
    for(const name of ['pointercancel','lostpointercapture'])viewport?.addEventListener(name,()=>{pointer=null;},true);
    viewport?.addEventListener('click',event=>{if(picking)consume(event);},true);
    document.addEventListener('keydown',event=>{if(picking&&event.key==='Escape'&&!window.PointActions?.isOpen&&!event.target.closest('input,textarea,select,dialog,[role="dialog"]')){setPicking(false);consume(event);}},true);
    $('annotationMode')?.addEventListener('change',()=>setPicking(false));
    for(const id of ['segmentation2D','segmentationBorders','segmentationOpacity','segmentationScope'])for(const name of ['input','change'])$(id)?.addEventListener(name,changedControls);
    previousCase=currentCase();if(previousCase)setControls(cases.get(previousCase)||defaults(previousCase));render();
  }
  function setVisibility(segmentId,visible){const s=getPreferences(),object=s?.structures.find(o=>o.segment_id===segmentId);if(object){object.visible=!!visible;commit(s);return true;}return false;}
  window.StructureSelection={getPreferences,getAllPreferences:()=>[...cases.keys()].map(getPreferences),applyPreferences,normalizePreferences,replaceAllPreferences,clearAllPreferences:options=>replaceAllPreferences([],options),addSegment,removeSegment,renameSegment,setPicking,setVisibility,get picking(){return picking;}};
  window.addEventListener('review:volume',()=>{setPicking(false);previousCase=currentCase();if(seedDefaults())return;if(previousCase)setControls(cases.get(previousCase)||defaults(previousCase));render();});
  window.addEventListener('segmentation:slice',()=>{if(!applying&&!pointer&&!seedDefaults())render();});
  window.addEventListener('annotations:ready',()=>{annotationsReady=true;if(!seedDefaults())render();});
  window.addEventListener('handoff:languagechange',render);
  for(const event of ['roles:ready','roles:changed'])window.addEventListener(event,()=>{if(event==='roles:ready')renderSignature='';if(seedDefaults())return;render();window.SliceSegmentation?.refresh();});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
