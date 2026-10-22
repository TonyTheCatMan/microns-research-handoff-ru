/* Deliberate, case-scoped selections of exact seg_m1300 voxel identities. */
(() => {
  'use strict';
  const $=id=>document.getElementById(id),source='seg_m1300',cases=new Map(),palette=['#e85d75','#4da3ff','#73c66a','#b28cf5','#f4a340','#35bcb5'];
  const clone=value=>structuredClone(value),currentCase=()=>window.ReviewViewer?.currentCase?.case_id||null;
  let picking=false,pointer=null,previousCase=null,applying=false;
  const defaults=case_id=>({schema_version:1,source_version:source,case_id,structures:[],scope:'selected',fill:false,borders:false,opacity:.25});
  function normalizePreferences(value){
    const s=value;
    if(!s||s.schema_version!==1||s.source_version!==source||!/^R\d{3}$/.test(s.case_id)||!Array.isArray(s.structures)||s.structures.length>256||!['selected','nearby','all'].includes(s.scope)||typeof s.fill!=='boolean'||typeof s.borders!=='boolean'||!Number.isFinite(s.opacity)||s.opacity<0||s.opacity>.7)throw new Error('Неверные настройки выбранных структур seg_m1300.');
    const seen=new Set(),structures=s.structures.map(o=>{
      if(!o||typeof o.segment_id!=='string'||!/^[1-9]\d{0,19}$/.test(o.segment_id)||BigInt(o.segment_id)>18446744073709551615n||seen.has(o.segment_id)||typeof o.visible!=='boolean'||typeof o.color!=='string'||!/^#[\da-f]{6}$/i.test(o.color))throw new Error('Неверные настройки выбранных структур seg_m1300.');
      seen.add(o.segment_id);return{segment_id:o.segment_id,color:o.color.toLowerCase(),visible:o.visible};
    });
    return{schema_version:1,source_version:source,case_id:s.case_id,structures,scope:s.scope,fill:s.fill,borders:s.borders,opacity:s.opacity};
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
    return clone(s);
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
  function message(text,error=false){const node=$('structureSelectionStatus');if(node){node.textContent=text;node.classList.toggle('save-failed',error);}}
  function setPicking(value){
    picking=!!value;pointer=null;const button=$('structurePick');if(button){button.setAttribute('aria-pressed',String(picking));button.classList.toggle('active',picking);button.textContent=picking?'Завершить выбор':'Выбрать на срезе';}
    $('viewport')?.classList.toggle('structure-picking',picking);
    if(picking)message('Нажмите или коснитесь структуры на ЭМ-срезе. Можно выбрать несколько. Esc: завершить.');
  }
  function addSegment(segmentId){
    const id=String(segmentId),s=getPreferences(),availability=window.SliceSegmentation?.availability(id);
    if(!window.HandoffAnnotations?.store)return false;
    if(!s||!availability?.ready||!availability.present_in_volume||id==='0'){message('В этой точке нет доступного сегмента seg_m1300.',true);return false;}
    const existing=s.structures.find(o=>o.segment_id===id);
    if(existing){existing.visible=true;message('Структура уже выбрана.');}
    else{
      const used=new Set(s.structures.map(o=>o.color));s.structures.push({segment_id:id,color:palette.find(color=>!used.has(color))||palette[s.structures.length%palette.length],visible:true});message('Структура выбрана. Цвет сохраняется при смене среза.');
    }
    s.scope='selected';s.fill=true;commit(s);return true;
  }
  function element(tag,className,text){const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;}
  function render(){
    const host=$('structureSelectionControls');if(!host)return;
    const s=getPreferences(),ready=!!window.SliceSegmentation?.current.ready&&!!window.HandoffAnnotations?.store;
    if(!$('structurePick')){
      const actions=element('div','structure-selection-actions'),pick=element('button','','Выбрать на срезе');pick.type='button';pick.id='structurePick';pick.setAttribute('aria-pressed','false');pick.addEventListener('click',()=>setPicking(!picking));actions.append(pick);
      const scopeHint=element('span','hint','Только выбранные: получатель и нужные аксоны выбираются вручную.');actions.append(scopeHint);
      const hint=element('p','hint structure-source-note','Источник: seg_m1300. Один ID сохраняется на всех срезах этого случая. Назначение структуры проверяет исследователь.');
      const seeds=element('div','structure-seed-controls');seeds.id='structureSeeds';
      const rows=element('div','structure-selection-list');rows.id='structureSelectionList';
      const status=element('div','hint');status.id='structureSelectionStatus';status.setAttribute('role','status');
      host.append(actions,seeds,rows,hint,status);
    }
    $('structurePick').disabled=!ready||!s;
    const seeds=$('structureSeeds');seeds.replaceChildren();
    const originals=window.SliceSegmentation?.seedObjects||[];
    if(originals.length){seeds.append(element('span','hint','Исходные объекты:'));for(const object of originals){
      const button=element('button','structure-seed',object.id);button.type='button';button.dataset.segmentId=object.segment_id;button.title=`${source}: ${object.segment_id}`;button.disabled=!ready;button.addEventListener('click',()=>addSegment(object.segment_id));seeds.append(button);
    }}
    const rows=$('structureSelectionList');rows.replaceChildren();
    if(!s?.structures.length)rows.append(element('p','hint structure-selection-empty','Ничего не выбрано. Нажмите «Выбрать на срезе» или выберите исходный объект.'));
    for(const object of s?.structures||[]){
      const row=element('div','structure-selection-row');row.dataset.segmentId=object.segment_id;
      const visibility=element('label','structure-visibility'),checkbox=element('input');checkbox.type='checkbox';checkbox.checked=object.visible;checkbox.setAttribute('aria-label','Показать структуру');checkbox.addEventListener('change',()=>{const next=getPreferences();next.structures.find(o=>o.segment_id===object.segment_id).visible=checkbox.checked;commit(next,{rerender:false});});visibility.append(checkbox);
      const color=element('input','structure-color');color.type='color';color.value=object.color;color.setAttribute('aria-label','Цвет структуры');color.addEventListener('input',()=>{const next=getPreferences();next.structures.find(o=>o.segment_id===object.segment_id).color=color.value;commit(next,{rerender:false});});
      const identity=element('div','structure-identity'),seed=originals.find(o=>o.segment_id===object.segment_id);identity.append(element('code','',`${seed?seed.id+' · ':''}${object.segment_id}`));
      const availability=window.SliceSegmentation?.availability(object.segment_id),state=!availability?.ready?'Срез загружается':!availability.present_in_volume?'Нет в этом объёме seg_m1300':availability.present_in_slice?'Есть на этом срезе':'Нет на этом срезе';identity.append(element('span','hint structure-availability',state));
      const remove=element('button','structure-remove','Убрать');remove.type='button';remove.setAttribute('aria-label','Убрать структуру из выбранных');remove.addEventListener('click',()=>{const next=getPreferences();next.structures=next.structures.filter(o=>o.segment_id!==object.segment_id);commit(next);});
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
  window.StructureSelection={getPreferences,getAllPreferences:()=>[...cases.keys()].map(getPreferences),applyPreferences,normalizePreferences,replaceAllPreferences,clearAllPreferences:options=>replaceAllPreferences([],options),addSegment,setPicking,get picking(){return picking;}};
  window.addEventListener('review:volume',()=>{setPicking(false);previousCase=currentCase();if(previousCase)setControls(cases.get(previousCase)||defaults(previousCase));render();});
  window.addEventListener('segmentation:slice',()=>{if(!applying&&!pointer)render();});
  window.addEventListener('annotations:ready',render);
  window.addEventListener('handoff:languagechange',render);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
