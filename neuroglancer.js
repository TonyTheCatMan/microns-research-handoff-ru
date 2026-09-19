/* Public MICrONS viewer states use physical coordinates, with no registration offset. */
(() => {
  'use strict';
  const HOST = new URL('neuroglancer/?v=20260919-sync1',window.location.href).href;
  const EM = 'precomputed://https://bossdb-open-data.s3.amazonaws.com/iarpa_microns/minnie/minnie65/em';
  const SEG = 'precomputed://https://storage.googleapis.com/iarpa_microns/minnie/minnie65/seg_m1300';

  function buildState(currentCase, volume, localZ, target, objects, focus = null, findings = {}) {
    if (!currentCase.volumes.some(v => v.volume_id === volume.volume_id)) throw new Error('Случай и объём не совпадают.');
    if (!Number.isInteger(localZ) || localZ < 0 || localZ >= volume.shape_xyz[2]) throw new Error('Срез вне выбранного объёма.');
    const resolution = volume.resolution_nm;
    const dimensions = Object.fromEntries(['x', 'y', 'z'].map((axis, i) => [axis, [resolution[i] * 1e-9, 'm']]));
    const begin = volume.begin_vox_xyz;
    // Match the local TIFF/3D voxel center. Contact annotations retain their exact supplied coordinates.
    let position = begin.map((n, i) => n + (i === 2 ? localZ + 0.5 : focus ? focus[i] / resolution[i] : target ? target.local[i] + 0.5 : volume.shape_xyz[i] / 2));
    const settings=findings.settings||{},enabled=(key,fallback=true)=>settings[key]??fallback;
    const annotations = [];
    for (const contact of currentCase.contacts) {
      for (const [key, label] of [['ctr_nm', 'центр'], ['pre_nm', 'пре'], ['post_nm', 'пост']]) {
        if (!contact[key]||!enabled({ctr_nm:'tCenter',pre_nm:'tPre',post_nm:'tPost'}[key])) continue;
        annotations.push({type: 'point', id: `${contact.contact_id}-${key}`, point: contact[key].map((n, i) => n / resolution[i]), description: `${currentCase.case_id} · ${contact.contact_id} · ${label} · не проверено`});
      }
    }
    const kinds=[['contact','Контакты','#166ac7'],['point','Особенности','#8844bd'],['object','Объекты','#c86b06'],['region','Области','#8844bd']];
    const categories={unclassified:'Не классифицировано',suspected_synapse:'Предполагаемый синаптический контакт',possible_adhesion:'Возможная несинаптическая адгезия',unresolved_other:'Неясный контакт / другая особенность'};
    const certainty={note:'Не оценено',uncertain:'Недостаточно / неясно',supported:'Поддерживают синапс',rejected:'Свидетельства против синапса'};
    const records=(findings.records||[]).filter(r=>r.case_id===currentCase.case_id).sort((a,b)=>a.number-b.number);
    const selected=records.find(r=>r.id===findings.focusId);
    if(selected)position=selected.point_nm.map((n,i)=>n/resolution[i]);
    const userLayers=kinds.flatMap(([kind,label,color])=>{
      const points=records.filter(r=>r.kind===kind);if(!points.length)return [];
      return [{type:'annotation',name:'Мои метки · '+label,visible:enabled('annotationsVisible'),
        source:{url:'local://annotations',transform:{outputDimensions:dimensions}},annotationColor:color,
        annotationProperties:[{id:'number',type:'uint32',description:'Номер метки',default:0}],
        shader:'void main(){setColor(defaultColor());setPointMarkerSize(16.0);setPointMarkerBorderColor(vec4(1.0));setPointMarkerBorderWidth(2.0);}',
        annotations:points.map(r=>({type:'point',id:r.id,point:r.point_nm.map((n,i)=>n/resolution[i]),props:[r.number],
          description:[`№${r.number} · ${label} · ${r.case_id} · ${r.volume_id}`,
            'Наблюдение: '+(categories[r.observation_category]||categories.unclassified),
            'Свидетельства синапса: '+(certainty[r.status]||certainty.note),r.notes,r.properties,
            r.evidence_refs?'Свидетельства: '+r.evidence_refs:''].filter(Boolean).join('\n')}))}];
    });
    return {
      title: `MICrONS · ${volume.volume_id} · Z ${localZ}`,
      dimensions,
      position,
      crossSectionScale: 1,
      projectionScale: records.length ? Math.max(...volume.shape_xyz.map((n,i)=>n*resolution[i]))/Math.min(...resolution)*1.6 : 1800,
      projectionOrientation: records.length ? [0.2,0.3,0,Math.sqrt(0.87)] : [0,0,0,1],
      layers: [
        {type: 'image', name: 'ЭМ MICrONS', source: EM, shaderControls: {normalized: {range: [settings.blackInput??0, settings.whiteInput??255]}}},
        ...[['Объекты · v1300',objects.filter(o=>!o.context),settings.surfaceOpacity??80],['Соседние структуры · v1300',objects.filter(o=>o.context),settings.surfaceContextMode==='slice'?0:settings.surfaceContextOpacity??25]].map(([name,items,alpha])=>({type:'segmentation',name,source:SEG,segments:items.map(o=>o.segment),segmentColors:Object.fromEntries(items.map(o=>[o.segment,o.color])),selectedAlpha:0,notSelectedAlpha:0,objectAlpha:alpha/100})),
        ...(findings.sectionLayers||[]),
        {type: 'annotation', name: `Границы ${volume.volume_id}`,visible:enabled('surfaceBox'), source: {url: 'local://annotations', transform: {outputDimensions: dimensions}}, annotationColor: '#48d4f2', annotations: [{type: 'axis_aligned_bounding_box', id: 'volume-bounds', pointA: begin, pointB: volume.end_vox_xyz_exclusive, description: volume.volume_id}]},
        {type: 'annotation', name: 'Заданные точки · не проверены', source: {url: 'local://annotations', transform: {outputDimensions: dimensions}}, annotationColor: '#ffca64',
          // The shared high-DPI overlay draws the real center/pre/post symbols and labels.
          shader:'void main(){setPointMarkerSize(0.0);setPointMarkerBorderWidth(0.0);}',visible:enabled('overlayToggle'), annotations},
        ...userLayers
      ],
      showSlices: enabled('surfacePlane'),
      selectedLayer: {visible: false},
      layout: {type: 'xy-3d', orthographicProjection: true}
    };
  }
  const urlFor = state => {
    const url=new URL(HOST),volume=state.title?.split(' · ')[1];
    if(volume){url.searchParams.set('case',volume.split('-')[0]);url.searchParams.set('volume',volume);}
    url.hash='!'+encodeURIComponent(JSON.stringify(state));return url.href;
  };
  window.NeuroglancerLink = {buildState, urlFor};

  const $=id=>document.getElementById(id),bus=window.HandoffSync;
  if(bus?.role==='notes'){window.NeuroglancerLink.captureFrame=()=>null;return;}
  const frame=$('neuroglancerFrame'),external=$('neuroglancerExternal'),reset=$('neuroglancerReset'),markerSelect=$('neuroglancerMarker');
  const controlIds=['overlayToggle','tCenter','tPre','tPost','annotationsVisible','surfaceContext','surfaceContextMode','contextLimit','surfaceOpacity','surfaceContextOpacity','surfacePlane','surfaceBox','surfaceSegmentation','surfaceSegmentationOpacity','segmentation2D','segmentationBorders','segmentationOpacity','segmentationScope','segmentationLimit','blackInput','whiteInput'];
  let segmentIndex,indexPromise,currentState,currentUrl='',loadedCaseId='',latest=null,pending=null,applying=false,timer=null,started=false,booting=false;
  let navigationPending=false,navigationSource='all',focusPending=null,reasonPending='settings',lastFingerprint='',lastNavigation=null;
  let navigationRevision=crypto.randomUUID(),appliedNavigationRevision=null,navigationFocus=null;
  let localControls={},localNavigation=null,localFocus=null,normalizeNative=false;
  let boundaryCache=null;
  const active=()=>location.hash==='#neuroglancer';
  const status=text=>$('neuroglancerStatus').textContent=text;
  const controls=()=>Object.fromEntries(controlIds.map(id=>{const input=$(id);return[id,input.type==='checkbox'?input.checked:input.type==='number'||input.type==='range'?Number(input.value):input.value];}));
  const valid3=p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite);
  const color=id=>'#'+(window.SliceSegmentation?.colorForSegment(id)||[128,184,196]).map(v=>v.toString(16).padStart(2,'0')).join('');
  function sectionLayers(settings){
    const data=window.SliceSegmentation?.current,selection=window.SliceSegmentation?.selection;
    if(!data?.ready||data.volume_id!==ReviewViewer.volume?.volume_id||data.local_z!==ReviewViewer.z)return[];
    const make=(name,ids,alpha,visible)=>({type:'segmentation',name,source:SEG,segments:ids,segmentColors:Object.fromEntries(ids.map(id=>[id,color(id)])),selectedAlpha:alpha/100,notSelectedAlpha:0,objectAlpha:0,visible});
    const surface=ReviewViewer.surface,nearby=surface.meshes.filter(m=>m.context&&m.visible&&surface.contextShown.has(m.id)).map(m=>m.segment_id);
    return[
      make('Сегментация 2D · v1300',selection?.segment_ids||[],settings.segmentationOpacity,settings.segmentation2D),
      make('Сегментация среза 3D · v1300',data.objects.map(o=>o.segment_id),settings.surfaceSegmentationOpacity,settings.surfaceSegmentation),
      make('Соседние на срезе 3D · v1300',nearby,settings.surfaceContextOpacity,settings.surfaceContext&&settings.surfaceContextMode==='slice')
    ];
  }
  function boundaryOverlay(settings){
    const data=window.SliceSegmentation?.current,selection=window.SliceSegmentation?.selection;
    if(!settings.segmentationBorders||!data?.ready||data.volume_id!==ReviewViewer.volume.volume_id||data.local_z!==ReviewViewer.z)return null;
    const key=JSON.stringify([data.volume_id,data.local_z,selection?.segment_ids,settings.segmentationOpacity]);
    if(boundaryCache?.source!==data.canvas||boundaryCache.key!==key){
      const canvas=SliceSegmentation.render({segment_ids:selection?.segment_ids||[],fill:false,borders:true,opacity:Math.max(.4,settings.segmentationOpacity/100)});
      boundaryCache={source:data.canvas,key,value:{dataUrl:canvas.toDataURL('image/png'),begin_vox_xyz:[...ReviewViewer.volume.begin_vox_xyz],shape_xyz:[...ReviewViewer.volume.shape_xyz],local_z:ReviewViewer.z}};
    }
    return boundaryCache.value;
  }
  function snapshot(){
    const v=window.ReviewViewer,c=v?.currentCase,volume=v?.volume,findings=window.HandoffAnnotations;
    if(!v?.ready||!c||!volume||!findings?.store||!segmentIndex||!v.surface?.modelReady)return null;
    const fallback=segmentIndex.volumes[volume.volume_id];if(!fallback)return null;
    const surface=v.surface,objects=surface?.caseId===c.case_id&&surface.volume?.volume_id===volume.volume_id?surface.visibleSegments(fallback)??fallback:fallback;
    const settings=controls(),navigation=v.getNavigationState?.(),selection=findings.selectedId;
    const state=buildState(c,volume,v.z,v.target,objects,null,{records:findings.records,settings,sectionLayers:sectionLayers(settings)});
    if(navigation?.position_nm)state.position=navigation.position_nm.map((n,i)=>n/volume.resolution_nm[i]);
    state.crossSectionScale=1/v.zoom;
    if(navigationFocus?.point_nm)state.position=navigationFocus.point_nm.map((n,i)=>n/volume.resolution_nm[i]);
    return{caseId:c.case_id,volumeId:volume.volume_id,state,main:{navigation,controls:settings,selectedId:selection,objects:surface.meshes.map(m=>({id:m.id,segment_id:m.segment_id,visible:m.visible})),contextFocus:surface.contextFocus,contextFocusLabel:surface.contextFocusLabel,target:v.target,boundaryOverlay:boundaryOverlay(settings)},navigate:navigationPending,navigationSource,navigationRevision,focus:navigationFocus,reason:reasonPending};
  }
  function showLink(payload){
    currentState=payload.state;currentUrl=urlFor(currentState);external.href=currentUrl;external.removeAttribute('aria-disabled');reset.disabled=false;
    $('neuroglancerTabCase').textContent='· '+payload.caseId;$('neuroglancerHeading').textContent='· '+payload.caseId;
    frame.title='Neuroglancer — '+payload.volumeId;
    const records=(window.HandoffAnnotations?.records||[]).filter(r=>r.case_id===payload.caseId),selected=payload.main?.selectedId||markerSelect.value;
    markerSelect.replaceChildren(...records.map(r=>new Option(`№${r.number} · ${r.volume_id}`,r.id)));
    if(records.some(r=>r.id===selected))markerSelect.value=selected;
    $('neuroglancerMarkers').hidden=!records.length;
    $('neuroglancerLocation').textContent=`${payload.volumeId} · локальный Z ${ReviewViewer.z} · моих меток ${records.length} · открытые окна синхронизированы`;
    if(frame.hasAttribute('src'))loadedCaseId=payload.caseId;
  }
  function ensureFrame(){
    if(!currentUrl)return;
    if(!frame.hasAttribute('src')){frame.src=currentUrl;loadedCaseId=ReviewViewer.currentCase.case_id;}
    frame.hidden=false;
  }
  function schedule(reason='settings',navigate=false,focus=null){
    if(applying)return;
    if(navigate){if(!navigationPending)navigationRevision=crypto.randomUUID();if(focus)navigationFocus=focus;else if(!focusPending)navigationFocus=null;}
    navigationPending ||= navigate;focusPending=focus||focusPending;reasonPending=reason;
    if(timer!==null)return;timer=setTimeout(publish,45);
  }
  function publish(force=false){
    clearTimeout(timer);timer=null;
    if(applying||!started)return;
    const payload=snapshot();if(!payload)return;
    if(focusPending?.point_nm)payload.state.position=focusPending.point_nm.map((n,i)=>n/ReviewViewer.volume.resolution_nm[i]);
    const fingerprint=JSON.stringify({state:payload.state,main:payload.main});
    showLink(payload);if(active()||focusPending)ensureFrame();
    if(force||focusPending||navigationPending||fingerprint!==lastFingerprint){lastFingerprint=fingerprint;latest=bus.send('host-state',payload);appliedNavigationRevision=navigationRevision;}
    lastNavigation=payload.main.navigation;navigationPending=false;focusPending=null;reasonPending='settings';
    status('Случай, навигация, метки и настройки синхронизируются с открытыми окнами.');
  }
  function applyControls(values){
    for(const id of controlIds){if(!(id in (values||{})))continue;const input=$(id),value=values[id];
      if(input.type==='checkbox'){if(typeof value!=='boolean'||input.checked===value)continue;input.checked=value;}
      else{if(String(input.value)===String(value))continue;if(input.tagName==='SELECT'&&![...input.options].some(o=>o.value===String(value)))continue;if((input.type==='number'||input.type==='range')&&(!Number.isFinite(value)||value<Number(input.min)||value>Number(input.max)))continue;input.value=String(value);}
      input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));
    }
  }
  function applyObjects(rows){
    if(!Array.isArray(rows))return;const surface=ReviewViewer.surface;
    for(const mesh of surface.meshes){const value=rows.find(r=>r.id===mesh.id||r.segment_id&&r.segment_id===mesh.segment_id);if(!value||typeof value.visible!=='boolean')continue;mesh.visible=value.visible;const input=mesh.control?.querySelector('input');if(input)input.checked=mesh.visible;}
    surface.updateNearby();surface.schedule();surface.visibilityChanged();
  }
  async function applyHost(payload){
    const main=payload.main;if(!main?.navigation)return;
    if(!lastNavigation||payload.navigate||payload.navigationRevision!==appliedNavigationRevision||ReviewViewer.currentCase?.case_id!==payload.caseId||ReviewViewer.volume?.volume_id!==payload.volumeId)await ReviewViewer.applyNavigationState(main.navigation,{emit:false});
    ReviewViewer.applyTarget?.(main.target?.id||null,main.target?.key);
    applyControls(main.controls);applyObjects(main.objects);
    await HandoffAnnotations.refresh();await HandoffAnnotations.applySelection(main.selectedId||null,{focus:false});
    if(valid3(main.contextFocus))ReviewViewer.surface.setContextFocus(main.contextFocus,main.contextFocusLabel||'выбранная точка');
    else if(main.contextFocus===null){ReviewViewer.surface.contextFocus=null;ReviewViewer.surface.contextFocusLabel=main.contextFocusLabel||'центр среза';ReviewViewer.surface.updateNearby();ReviewViewer.surface.visibilityChanged();}
    appliedNavigationRevision=payload.navigationRevision;
    showLink(payload);if(active())ensureFrame();
  }
  function nativeControls(state){
    const layers=state.layers||[],named=name=>layers.find(l=>l.name===name),range=named('ЭМ MICrONS')?.shaderControls?.normalized?.range,result={};
    if(Array.isArray(range)&&range.length===2){result.blackInput=Math.round(range[0]);result.whiteInput=Math.round(range[1]);}
    if(typeof state.showSlices==='boolean')result.surfacePlane=state.showSlices;
    const bounds=layers.find(l=>l.name?.startsWith('Границы '));if(bounds)result.surfaceBox=bounds.visible!==false;
    const seed=named('Заданные точки · не проверены');if(seed)result.overlayToggle=seed.visible!==false;
    const user=layers.filter(l=>l.name?.startsWith('Мои метки · '));if(user.length)result.annotationsVisible=user.some(l=>l.visible!==false);
    for(const [name,opacity]of [['Объекты · v1300','surfaceOpacity'],['Соседние структуры · v1300','surfaceContextOpacity']]){const layer=named(name);if(layer&&Number.isFinite(layer.objectAlpha)&&(name==='Объекты · v1300'||$('surfaceContextMode').value==='full'))result[opacity]=Math.round(layer.objectAlpha*100);}
    for(const [name,visible,opacity]of [['Сегментация 2D · v1300','segmentation2D','segmentationOpacity'],['Сегментация среза 3D · v1300','surfaceSegmentation','surfaceSegmentationOpacity']]){const layer=named(name);if(layer){result[visible]=layer.visible!==false;if(Number.isFinite(layer.selectedAlpha))result[opacity]=Math.round(layer.selectedAlpha*100);}}
    return result;
  }
  async function applyNative(payload,type){
    const c=ReviewViewer.metadata?.cases.find(c=>c.case_id===payload.caseId);if(!c)return;
    const expected=c.volumes.find(v=>v.volume_id===payload.volumeId);if(!expected)return;
    const state=payload.state||{},point=type==='ng-focus'?payload.point:state.position;
    const nm=valid3(point)?point.map((n,i)=>n*expected.resolution_nm[i]):null;
    const contains=v=>nm&&nm.every((n,i)=>n>=v.begin_vox_xyz[i]*v.resolution_nm[i]&&n<v.end_vox_xyz_exclusive[i]*v.resolution_nm[i]);
    const volume=contains(expected)?expected:c.volumes.find(contains);
    if(nm&&!volume){status('Точка Neuroglancer находится за пределами доступных 2D / 3D фрагментов.');return;}
    const dest=volume||expected;
    normalizeNative=dest.volume_id!==payload.volumeId?'volume':'derived';
    if(ReviewViewer.currentCase?.case_id!==c.case_id||ReviewViewer.volume?.volume_id!==dest.volume_id)await ReviewViewer.select(c.case_id,dest.volume_id);
    const navigation=ReviewViewer.getNavigationState();
    if(nm){navigation.position_nm=nm;navigation.local_z=Math.floor(nm[2]/dest.resolution_nm[2]-dest.begin_vox_xyz[2]);}
    if(Number.isFinite(state.crossSectionScale)&&state.crossSectionScale>0)navigation.zoom=1/state.crossSectionScale;
    if(payload.navigationCamera)navigation.surface={...navigation.surface,...payload.navigationCamera};
    if(nm&&navigation.surface)navigation.surface.center_nm=nm.map((n,i)=>n-dest.begin_vox_xyz[i]*dest.resolution_nm[i]);
    await ReviewViewer.applyNavigationState(navigation,{emit:false});
    if(type==='ng-focus'){
      if(!payload.seed){await HandoffAnnotations.refresh();await HandoffAnnotations.applySelection(payload.id,{focus:false});}
      else{const target=/^(.+)-(ctr_nm|pre_nm|post_nm)$/.exec(payload.id);if(target)ReviewViewer.applyTarget?.(target[1],target[2]);}
      ReviewViewer.surface.setContextFocus(nm.map((n,i)=>n-dest.begin_vox_xyz[i]*dest.resolution_nm[i]),payload.seed?payload.id:'выбранная метка');
    }else{
      applyControls(nativeControls(state));
      for(const [name,context]of [['Объекты · v1300',false],['Соседние структуры · v1300',true]]){const layer=state.layers?.find(l=>l.name===name);if(!layer)continue;const ids=new Set((layer.segments||[]).map(String));applyObjects(ReviewViewer.surface.meshes.filter(m=>!!m.context===context).map(m=>({id:m.id,visible:layer.visible!==false&&ids.has(m.segment_id)})));}
    }
    const nextState={...(currentState||snapshot()?.state||{}),...state};
    if(nm)nextState.position=nm.map((n,i)=>n/dest.resolution_nm[i]);nextState.title=`MICrONS · ${dest.volume_id} · Z ${ReviewViewer.z}`;
    showLink({caseId:c.case_id,volumeId:dest.volume_id,state:nextState,main:{selectedId:HandoffAnnotations.selectedId}});if(active())ensureFrame();
  }
  async function drain(){
    if(applying||!started||!window.HandoffAnnotations?.store)return;
    applying=true;
    try{while(pending){const message=pending;pending=null;
      if(message.type==='host-state')await applyHost(message.payload);else await applyNative(message.payload,message.type);
      lastNavigation=ReviewViewer.getNavigationState?.();
      const baseline=snapshot();if(baseline)lastFingerprint=JSON.stringify({state:baseline.state,main:baseline.main});
    }}catch(error){status('Синхронизация: '+error.message);}finally{applying=false;}
    if(Object.keys(localControls).length||localNavigation||localFocus){
      const values=localControls,nav=localNavigation,focus=localFocus;localControls={};localNavigation=null;localFocus=null;
      if(nav)await ReviewViewer.applyNavigationState(nav,{emit:false});applyControls(values);schedule('local',!!nav||!!focus,focus);
    }else if(normalizeNative){const reason=normalizeNative;normalizeNative=false;schedule(reason,reason==='volume');}
  }
  function receive(message){
    if(message.type==='hello'){if(latest)bus.send('state-reply',{message:latest},message.source);return;}
    if(message.type==='state-reply'){const nested=message.payload?.message;if(nested)receive(nested);return;}
    if(!['host-state','ng-state','ng-focus'].includes(message.type)||message.source===bus.id||!bus.newer(message,latest))return;
    latest=message;pending=message;
    navigationRevision=message.payload.navigationRevision||`${message.source}:${message.clock}`;
    navigationFocus=message.type==='host-state'?message.payload.focus||null:null;
    clearTimeout(timer);timer=null;navigationPending=false;focusPending=null;drain();
  }
  bus.subscribe(receive);bus.send('hello');
  async function loadIndex(){
    if(indexPromise)return indexPromise;
    indexPromise=(async()=>{try{const data=JSON.parse(await HandoffAssets.read('neuroglancer-segments.json',true));if(data.source_version!==1300||!data.volumes)throw new Error('Нет данных объектов Neuroglancer.');segmentIndex=data;await begin();}catch(error){status(error.message);}finally{indexPromise=null;}})();return indexPromise;
  }
  async function begin(){
    if(started||booting||!segmentIndex||!window.HandoffAnnotations?.store||!ReviewViewer.ready)return;
    booting=true;await new Promise(resolve=>setTimeout(resolve,120));started=true;booting=false;
    if(pending)await drain();else publish(true);
    if(active())ensureFrame();
  }
  for(const event of ['annotations:ready','review:position','annotations:surface-ready'])window.addEventListener(event,()=>{begin();if(started&&!applying)schedule('data');});
  window.addEventListener('review:view',event=>{if(applying&&!event.detail?.remote)localNavigation=event.detail;else{navigationSource=event.detail?.source||'all';schedule(event.detail?.reason||'navigation',true);}});
  window.addEventListener('review:focus',event=>{if(applying)localFocus=event.detail;else schedule('focus',true,event.detail);});
  window.addEventListener('annotations:selection',event=>{if(applying&&event.detail.intent==='focus')localFocus=event.detail;else schedule(event.detail.intent,event.detail.intent==='focus',event.detail.intent==='focus'?event.detail:null);});
  for(const event of ['annotations:changed','surface:visibility','segmentation:slice'])window.addEventListener(event,()=>schedule('settings'));
  for(const id of controlIds)for(const event of ['input','change'])$(id).addEventListener(event,e=>{if(applying&&e.isTrusted)localControls[id]=controls()[id];else schedule('settings');});
  async function openCurrent(force=false){await window.HandoffAnnotations?.whenSettled();await begin();if(!currentUrl)publish(true);ensureFrame();if(force){navigationPending=true;publish(true);}else if(latest)bus.send('state-reply',{message:latest});}
  window.addEventListener('hashchange',()=>{if(active())openCurrent();});
  reset.addEventListener('click',()=>openCurrent(true));
  $('neuroglancerMarkerGo').addEventListener('click',async()=>{
    const record=HandoffAnnotations.records.find(r=>r.id===markerSelect.value);if(!record)return;
    try{if(record.volume_id!==ReviewViewer.volume.volume_id){const v=ReviewViewer.currentCase.volumes.find(v=>v.volume_id===record.volume_id);await ReviewViewer.applyNavigationState({case_id:record.case_id,volume_id:v.volume_id,position_nm:record.point_nm,local_z:Math.floor(record.point_nm[2]/v.resolution_nm[2]-v.begin_vox_xyz[2])},{emit:false});}
      await HandoffAnnotations.applySelection(record.id,{focus:false});schedule('focus',true,{id:record.id,case_id:record.case_id,volume_id:ReviewViewer.volume.volume_id,point_nm:record.point_nm});
    }catch(error){status(error.message);}
  });
  external.addEventListener('click',event=>{if(!currentUrl)return;if(event.button===0&&!event.ctrlKey&&!event.metaKey&&!event.shiftKey&&!event.altKey){event.preventDefault();const opened=window.open(currentUrl,'_blank','noopener');/* BroadcastChannel also reaches tabs opened with Ctrl/Cmd-click. */}});
  frame.addEventListener('load',()=>{if(latest)bus.send('state-reply',{message:latest});});
  window.NeuroglancerLink.captureFrame=caseId=>frame.hasAttribute('src')&&loadedCaseId===caseId&&!frame.hidden?frame:null;
  window.NeuroglancerLink.sync={get latest(){return latest;},get applying(){return applying;},publish:()=>publish(true)};
  loadIndex();
})();
