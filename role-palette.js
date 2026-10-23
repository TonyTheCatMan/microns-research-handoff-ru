/* Source-contact roles are navigation aids, never certification of a v1300 mesh. */
(() => {
  'use strict';
  const key='microns-role-palette-v1',clone=value=>structuredClone(value),$=id=>document.getElementById(id);
  const defaults={schema_version:1,enabled:false,colors:{excitatory:'#e69f00',inhibitory:'#0072b2',recipient:'#009e73'}};
  let palette=clone(defaults),manifest=null,error='',rendering=false,annotationsReady=false,readinessObserver=null;
  const tr=text=>window.HandoffI18n?.translate(text)??text;
  function annotationsLoaded(){
    // The store opens before saved selections hydrate. This input is enabled only after boot completes.
    if(!annotationsReady&&window.HandoffAnnotations?.store&&$('annotationsImport')?.disabled===false)annotationsReady=true;
    return annotationsReady&&!!window.HandoffAnnotations?.store;
  }
  function watchReadiness(){
    if(annotationsLoaded()){readinessObserver?.disconnect();readinessObserver=null;return;}
    const input=$('annotationsImport');if(!input||readinessObserver||typeof MutationObserver!=='function')return;
    readinessObserver=new MutationObserver(()=>{if(annotationsLoaded()){readinessObserver.disconnect();readinessObserver=null;render();}});
    readinessObserver.observe(input,{attributes:true,attributeFilter:['disabled']});
  }
  function normalize(value){
    if(!value||Object.keys(value).some(k=>!['schema_version','enabled','colors'].includes(k))||value.schema_version!==1||typeof value.enabled!=='boolean'||!value.colors||Object.keys(value.colors).sort().join(',')!=='excitatory,inhibitory,recipient'||Object.values(value.colors).some(c=>typeof c!=='string'||!/^#[0-9a-f]{6}$/i.test(c)))throw new Error('Неверная палитра ролей.');
    return {schema_version:1,enabled:value.enabled,colors:Object.fromEntries(Object.entries(value.colors).map(([r,c])=>[r,c.toLowerCase()]))};
  }
  function identify(caseId,volumeId,segmentId){
    const volume=manifest?.volumes?.[volumeId];
    if(!volume||volume.case_id!==caseId)return null;
    return Object.values(volume.objects||{}).find(o=>o.segment_id===String(segmentId))||null;
  }
  function identifyInCase(caseId,segmentId){
    const matches=Object.values(manifest?.volumes||{}).filter(v=>v.case_id===caseId).flatMap(v=>Object.values(v.objects||{})).filter(o=>o.segment_id===String(segmentId));
    return matches.length&&new Set(matches.map(o=>o.palette_role)).size===1?matches[0]:null;
  }
  function label(info){return info?.labels?.[window.HandoffI18n?.language==='en'?'en':'ru']||tr('Неизвестная структура');}
  function details(info){
    if(!info)return tr('Биологическая роль не установлена.');
    const lang=window.HandoffI18n?.language==='en'?'en':'ru',refs=(info.contact_refs||[]).map(c=>typeof c==='string'?c:[c.contact_id,c.point,'synapse '+c.synapse_id].join(' · ')).join('; ');
    return [info.limitation?.[lang],info.nucleus_id?'nucleus '+info.nucleus_id:'',refs].filter(Boolean).join(' ');
  }
  function colorFor(caseId,volumeId,segmentId,fallback,selection){
    if(selection&&selection.color_mode!=='role')return selection.color;
    const info=volumeId?identify(caseId,volumeId,segmentId):identifyInCase(caseId,segmentId);
    return palette.enabled&&info?.palette_role&&palette.colors[info.palette_role]||selection?.color||fallback;
  }
  function applyPalette(value,{persist=true}={}){
    palette=normalize(value);if(persist)localStorage.setItem(key,JSON.stringify(palette));
    render();window.dispatchEvent(new CustomEvent('roles:changed',{detail:clone(palette)}));return clone(palette);
  }
  function applyCommon(){
    if(!manifest||error||!annotationsLoaded())return false;
    applyPalette({...palette,enabled:true});
    for(const preferences of window.StructureSelection?.getAllPreferences()||[]){
      let changed=false;for(const object of preferences.structures){const info=identifyInCase(preferences.case_id,object.segment_id);if(info?.palette_role){object.color_mode='role';object.color=palette.colors[info.palette_role];changed=true;}}
      if(changed)window.StructureSelection.applyPreferences(preferences,{emit:true});
    }
    render();return true;
  }
  function render(){
    if(rendering)return;const host=$('rolePalette');if(!host)return;rendering=true;
    if(!host.firstChild){
      const summary=document.createElement('summary');summary.textContent='Цвета ролей';host.append(summary);
      const controls=document.createElement('div');controls.className='role-palette-colors';
      for(const [role,name]of [['excitatory','Возбуждающий аксон'],['inhibitory','Тормозный аксон'],['recipient','Шипик / дендрит']]){
        const label=document.createElement('label'),input=document.createElement('input'),span=document.createElement('span');span.textContent=name;input.type='color';input.id='roleColor-'+role;input.setAttribute('aria-label',name);input.addEventListener('input',()=>applyPalette({...palette,colors:{...palette.colors,[role]:input.value}}));label.append(input,span);controls.append(label);
      }
      const button=document.createElement('button');button.id='rolePaletteApply';button.type='button';button.textContent='Применить ко всем случаям';button.addEventListener('click',applyCommon);controls.append(button);host.append(controls);
      const hint=document.createElement('p');hint.className='hint';hint.textContent='По аннотациям контактов. Кнопка заменит индивидуальные цвета этих ролей во всех случаях.';host.append(hint);
    }
    for(const role of Object.keys(palette.colors))if($('roleColor-'+role)?.value!==palette.colors[role])$('roleColor-'+role).value=palette.colors[role];
    $('rolePaletteApply').disabled=!manifest||!!error||!annotationsLoaded();host.dataset.enabled=String(palette.enabled);
    const note=$('roleIdentityNote');if(note)note.textContent=error?'Не удалось загрузить аннотации ролей.':manifest?'Роли: по контактам v1822. Принадлежность объектов v1300 не подтверждена.':'Загружаем аннотации ролей…';
    window.HandoffI18n?.refresh(host);if(note)window.HandoffI18n?.refresh(note);rendering=false;
  }
  try{const saved=JSON.parse(localStorage.getItem(key)||'null');if(saved)palette=normalize(saved);}catch{}
  const ready=fetch(new URL('role-identities.json',document.currentScript.src)).then(response=>{if(!response.ok)throw new Error(String(response.status));return response.json();}).then(value=>{
    if(value.schema_version!==1||!value.volumes)throw new Error('schema');manifest=value;render();window.dispatchEvent(new Event('roles:ready'));return value;
  }).catch(reason=>{error=reason.message;render();return null;});
  window.HandoffRoles={ready,identify,identifyInCase,label,details,colorFor,normalize,getPalette:()=>clone(palette),applyPalette,applyCommon,get manifest(){return manifest;}};
  window.addEventListener('storage',event=>{if(event.key===key&&event.newValue)try{applyPalette(JSON.parse(event.newValue),{persist:false});}catch{}});
  window.addEventListener('annotations:ready',()=>{annotationsReady=true;readinessObserver?.disconnect();readinessObserver=null;render();});
  window.addEventListener('handoff:languagechange',render);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{render();watchReadiness();},{once:true});else{render();watchReadiness();}
})();
