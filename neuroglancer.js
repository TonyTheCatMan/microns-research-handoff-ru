/* Public MICrONS viewer states use physical coordinates, with no registration offset. */
(() => {
  'use strict';
  const HOST = new URL('neuroglancer/?v=20260918-tpoints',window.location.href).href;
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
    const annotations = [];
    for (const contact of currentCase.contacts) {
      for (const [key, label] of [['ctr_nm', 'центр'], ['pre_nm', 'пре'], ['post_nm', 'пост']]) {
        if (!contact[key]) continue;
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
      // Opening Neuroglancer shows the findings even if the main viewer's overlay was hidden.
      return [{type:'annotation',name:'Мои метки · '+label,visible:true,
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
        {type: 'image', name: 'ЭМ MICrONS', source: EM, shaderControls: {normalized: {range: [0, 255]}}},
        {type: 'segmentation', name: 'Объекты · v1300', source: SEG, segments: objects.map(o => o.segment), segmentColors: Object.fromEntries(objects.map(o => [o.segment, o.color])), selectedAlpha: 0.2, notSelectedAlpha: 0, objectAlpha: records.length ? 0.3 : 1},
        {type: 'annotation', name: `Границы ${volume.volume_id}`, source: {url: 'local://annotations', transform: {outputDimensions: dimensions}}, annotationColor: '#48d4f2', annotations: [{type: 'axis_aligned_bounding_box', id: 'volume-bounds', pointA: begin, pointB: volume.end_vox_xyz_exclusive, description: volume.volume_id}]},
        {type: 'annotation', name: 'Заданные точки · не проверены', source: {url: 'local://annotations', transform: {outputDimensions: dimensions}}, annotationColor: '#ffca64',
          // The shared high-DPI overlay draws the real center/pre/post symbols and labels.
          shader:'void main(){setPointMarkerSize(0.0);setPointMarkerBorderWidth(0.0);}', annotations},
        ...userLayers
      ],
      showSlices: true,
      selectedLayer: {visible: false},
      layout: {type: 'xy-3d', orthographicProjection: true}
    };
  }
  const urlFor = state => HOST + '#!' + encodeURIComponent(JSON.stringify(state));
  window.NeuroglancerLink = {buildState, urlFor};

  const $ = id => document.getElementById(id);
  const frame = $('neuroglancerFrame'), external = $('neuroglancerExternal'), reset = $('neuroglancerReset');
  const markerSelect=$('neuroglancerMarker'),markerGo=$('neuroglancerMarkerGo');
  let segmentIndex = null, indexPromise = null, currentUrl = '', loadedUrl = '';
  let currentPoints='',loadedPoints='';
  let currentCaseId='',loadedCaseId='';
  let focusedMarkerId=null;
  const active = () => location.hash === '#neuroglancer';

  function clearLink() {
    currentUrl = ''; loadedUrl = '';currentPoints='';loadedPoints='';loadedCaseId='';
    external.removeAttribute('href'); external.setAttribute('aria-disabled', 'true');
    frame.hidden = true; frame.removeAttribute('src'); reset.disabled = true;
  }
  function loadFrame(force = false) {
    if (!active() || !currentUrl || (!force && loadedUrl === currentUrl)) return;
    loadedUrl = currentUrl;
    loadedPoints=currentPoints;
    loadedCaseId=currentCaseId;
    $('neuroglancerStatus').textContent = 'Открываем Neuroglancer. Изображения и 3D загружаются из MICrONS…';
    frame.hidden = false; frame.src = currentUrl;
  }
  function update({refreshFrame=true}={}) {
    const viewer = window.ReviewViewer, c = viewer?.currentCase;
    const records=(window.HandoffAnnotations?.records||[]).filter(r=>r.case_id===c?.case_id).sort((a,b)=>a.number-b.number);
    const focused=records.find(r=>r.id===focusedMarkerId);
    const v=focused?c.volumes.find(v=>v.volume_id===focused.volume_id):viewer?.volume;
    const localZ=focused?Math.max(0,Math.min(v.shape_xyz[2]-1,Math.floor(focused.point_nm[2]/v.resolution_nm[2]-v.begin_vox_xyz[2]))):viewer?.z;
    const chosen=markerSelect.value||window.HandoffAnnotations?.selectedId;
    markerSelect.replaceChildren(...records.map(r=>new Option(`№${r.number} · ${{contact:'Контакт',point:'Особенность',object:'Объект',region:'Область'}[r.kind]}${c.volumes.length>1?' · '+r.volume_id:''}`,r.id)));
    if(records.some(r=>r.id===chosen))markerSelect.value=chosen;
    $('neuroglancerMarkers').hidden=!records.length;
    $('neuroglancerTabCase').textContent = c ? '· ' + c.case_id : '· текущий случай';
    $('neuroglancerHeading').textContent = c ? '· ' + c.case_id : '';
    if (!c || !v || !viewer.ready) {
      clearLink();
      $('neuroglancerLocation').textContent = v ? `${v.volume_id} · ожидаем загрузку текущего среза…` : 'Выберите случай в основном просмотрщике.';
      $('neuroglancerStatus').textContent = 'Подготовка ссылки…';
      return;
    }
    if(!window.HandoffAnnotations?.store){clearLink();$('neuroglancerStatus').textContent='Открываем сохранённые отметки…';return;}
    if (!segmentIndex) return;
    try {
      const fallback = segmentIndex.volumes[v.volume_id];
      if (!Array.isArray(fallback) || !fallback.length) throw new Error('Нет сопоставления объектов для этого объёма.');
      const surface=viewer.surface,matches=surface?.caseId===c.case_id&&surface?.volume?.volume_id===v.volume_id;
      // null means not ready. An empty array means the researcher deliberately hid every object.
      const visible=matches?surface.visibleSegments(fallback):null,objects=[...new Map((visible??fallback).map(o=>[o.segment,o])).values()];
      if(objects.some(o=>typeof o.segment!=='string'||!/^[1-9]\d*$/.test(o.segment)))throw new Error('Идентификаторы видимых объектов ещё загружаются.');
      const focus=matches&&surface.contextFocus?surface.nearbyCenter():null;
      const findings=window.HandoffAnnotations;
      const state = buildState(c, v, localZ, focused?null:viewer.target, objects, focus,{records:findings.records,focusId:focused?.id});
      currentPoints=JSON.stringify(state.layers.filter(l=>l.name.startsWith('Мои метки')).map(l=>({name:l.name,annotations:l.annotations.map(a=>({id:a.id,point:a.point}))})));
      currentUrl = urlFor(state);
      currentCaseId=c.case_id;
      frame.title=`Neuroglancer — ${v.volume_id}`;
      external.href = currentUrl; external.removeAttribute('aria-disabled'); reset.disabled = false;
      const target = focused ? ` · метка №${focused.number}` : viewer.target ? ` · ${viewer.target.id}: ${viewer.target.label.toLowerCase()}` : '';
      const nearby=objects.filter(o=>o.context).length;
      const count=state.layers.filter(l=>l.name.startsWith('Мои метки')).reduce((n,l)=>n+l.annotations.length,0);
      $('neuroglancerLocation').textContent = `${v.volume_id} · локальный Z ${localZ}${target} · объектов ${objects.length}${nearby?' (соседних '+nearby+')':''} · моих меток ${count}`;
      if (!active()) $('neuroglancerStatus').textContent = 'Ссылка на текущий срез готова.';
      else if(!refreshFrame&&loadedUrl&&loadedUrl!==currentUrl)$('neuroglancerStatus').textContent='Метки или заметки обновлены. Нажмите «К текущему срезу 2D / 3D», чтобы обновить Neuroglancer.';
      if(refreshFrame||!loadedUrl||loadedPoints!==currentPoints)loadFrame();
    } catch (error) {
      clearLink();
      $('neuroglancerStatus').textContent = error.message;
    }
  }
  async function loadIndex() {
    if (indexPromise) return indexPromise;
    indexPromise = (async () => {
      try {
        const data = JSON.parse(await HandoffAssets.read('neuroglancer-segments.json', true));
        if (data.source_version !== 1300 || !data.volumes) throw new Error('Неверная версия сегментации.');
        for (const objects of Object.values(data.volumes)) {
          if (!Array.isArray(objects) || objects.some(o => !/^[1-9]\d*$/.test(o.segment) || typeof o.segment !== 'string' || !/^#[0-9a-f]{6}$/i.test(o.color))) throw new Error('Неверные идентификаторы объектов.');
        }
        segmentIndex = data; update();
      } catch (error) {
        clearLink(); reset.disabled = false;
        $('neuroglancerStatus').textContent = error.message + ' Нажмите «К текущему срезу 2D / 3D», чтобы повторить.';
      } finally { indexPromise = null; }
    })();
    return indexPromise;
  }
  frame.addEventListener('load', () => {
    if (!loadedUrl || frame.hidden) return;
    // A cross-origin load event confirms the page load, not successful data/mesh rendering.
    $('neuroglancerStatus').textContent = loadedUrl!==currentUrl?'Метки или заметки обновлены. Нажмите «К текущему срезу 2D / 3D», чтобы обновить Neuroglancer.':'Neuroglancer открыт. Дождитесь загрузки ЭМ и 3D; при ошибке воспользуйтесь отдельным окном.';
  });
  window.addEventListener('review:volume',()=>{focusedMarkerId=null;update();});
  window.addEventListener('review:position',()=>{focusedMarkerId=null;update();});
  window.addEventListener('annotations:surface-ready', update);
  window.addEventListener('annotations:ready',()=>update());
  window.addEventListener('annotations:changed',()=>update({refreshFrame:false}));
  window.addEventListener('surface:visibility', event => {
    if(event.detail.volume_id===window.ReviewViewer?.volume?.volume_id&&event.detail.case_id===window.ReviewViewer?.currentCase?.case_id)update();
  });
  let entryGeneration=0;
  async function openCurrent(){const generation=++entryGeneration;focusedMarkerId=null;await window.HandoffAnnotations?.whenSettled();await window.HandoffAnnotations?.refresh();if(generation!==entryGeneration||!active())return;if(!segmentIndex)await loadIndex();if(generation!==entryGeneration||!active())return;loadedUrl='';update();}
  window.addEventListener('hashchange', () => {if(active())openCurrent();else entryGeneration++;});
  reset.addEventListener('click',openCurrent);
  markerGo.addEventListener('click',async()=>{const id=markerSelect.value;await window.HandoffAnnotations?.whenSettled();if(!active())return;focusedMarkerId=id;loadedUrl='';update();});
  external.addEventListener('click',async event=>{
    if(event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey||!currentUrl)return;
    event.preventDefault();
    // Open during the click so the browser permits the window; finish pending saves before handing off.
    const opened=window.open('about:blank','_blank');if(!opened){$('neuroglancerStatus').textContent='Разрешите всплывающее окно и повторите открытие.';return;}
    opened.opener=null;
    try{await window.HandoffAnnotations?.whenSettled();await window.HandoffAnnotations?.refresh();update({refreshFrame:false});if(!currentUrl)throw new Error('Ссылка ещё не готова.');opened.location.replace(currentUrl);}
    catch(error){opened.close();$('neuroglancerStatus').textContent=error.message;}
  });
  window.NeuroglancerLink.captureFrame=caseId=>loadedUrl&&loadedCaseId===caseId&&!frame.hidden?frame:null;
  loadIndex();
})();
