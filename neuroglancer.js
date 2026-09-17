/* Public MICrONS viewer states use physical coordinates, with no registration offset. */
(() => {
  'use strict';
  const HOST = 'https://ngl.microns-explorer.org/';
  const EM = 'precomputed://https://bossdb-open-data.s3.amazonaws.com/iarpa_microns/minnie/minnie65/em';
  const SEG = 'precomputed://https://storage.googleapis.com/iarpa_microns/minnie/minnie65/seg_m1300';

  function buildState(currentCase, volume, localZ, target, objects, focus = null, findings = {}) {
    if (!currentCase.volumes.some(v => v.volume_id === volume.volume_id)) throw new Error('Случай и объём не совпадают.');
    if (!Number.isInteger(localZ) || localZ < 0 || localZ >= volume.shape_xyz[2]) throw new Error('Срез вне выбранного объёма.');
    const resolution = volume.resolution_nm;
    const dimensions = Object.fromEntries(['x', 'y', 'z'].map((axis, i) => [axis, [resolution[i] * 1e-9, 'm']]));
    const begin = volume.begin_vox_xyz;
    // Match the local TIFF/3D voxel center. Contact annotations retain their exact supplied coordinates.
    const position = begin.map((n, i) => n + (i === 2 ? localZ + 0.5 : focus ? focus[i] / resolution[i] : target ? target.local[i] + 0.5 : volume.shape_xyz[i] / 2));
    const annotations = [];
    for (const contact of currentCase.contacts) {
      for (const [key, label] of [['ctr_nm', 'центр'], ['pre_nm', 'пре'], ['post_nm', 'пост']]) {
        if (!contact[key]) continue;
        annotations.push({type: 'point', id: `${contact.contact_id}-${key}`, point: contact[key].map((n, i) => n / resolution[i]), description: `${currentCase.case_id} · ${contact.contact_id} · ${label} · не проверено`});
      }
    }
    const kinds=[['contact','Контакты','#166ac7'],['point','Особенности','#8844bd'],['object','Объекты','#c86b06'],['region','Области','#8844bd']];
    const records=(findings.records||[]).filter(r=>r.case_id===currentCase.case_id).sort((a,b)=>a.number-b.number);
    const userLayers=kinds.flatMap(([kind,label,color])=>{
      const points=records.filter(r=>r.kind===kind);if(!points.length)return [];
      return [{type:'annotation',name:'Мои метки · '+label,visible:findings.visible!==false,
        source:{url:'local://annotations',transform:{outputDimensions:dimensions}},annotationColor:color,
        shader:'void main(){setColor(defaultColor());setPointMarkerSize(10.0);setPointMarkerBorderColor(vec4(1.0));setPointMarkerBorderWidth(1.0);}',
        annotations:points.map(r=>({type:'point',id:r.id,point:r.point_nm.map((n,i)=>n/resolution[i]),
          description:[`№${r.number} · ${label} · ${r.case_id} · ${r.volume_id}`,r.notes,r.properties].filter(Boolean).join('\n')}))}];
    });
    return {
      title: `MICrONS · ${volume.volume_id} · Z ${localZ}`,
      dimensions,
      position,
      crossSectionScale: 1,
      projectionScale: 1800,
      projectionOrientation: [0, 0, 0, 1],
      layers: [
        {type: 'image', name: 'ЭМ MICrONS', source: EM, shaderControls: {normalized: {range: [0, 255]}}},
        {type: 'segmentation', name: 'Объекты · v1300', source: SEG, segments: objects.map(o => o.segment), segmentColors: Object.fromEntries(objects.map(o => [o.segment, o.color])), selectedAlpha: 0.2, notSelectedAlpha: 0, objectAlpha: 1},
        {type: 'annotation', name: `Границы ${volume.volume_id}`, source: {url: 'local://annotations', transform: {outputDimensions: dimensions}}, annotationColor: '#48d4f2', annotations: [{type: 'axis_aligned_bounding_box', id: 'volume-bounds', pointA: begin, pointB: volume.end_vox_xyz_exclusive, description: volume.volume_id}]},
        {type: 'annotation', name: 'Заданные точки · не проверены', source: {url: 'local://annotations', transform: {outputDimensions: dimensions}}, annotationColor: '#ffca64', annotations},
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
  let segmentIndex = null, indexPromise = null, currentUrl = '', loadedUrl = '';
  const active = () => location.hash === '#neuroglancer';

  function clearLink() {
    currentUrl = ''; loadedUrl = '';
    external.removeAttribute('href'); external.setAttribute('aria-disabled', 'true');
    frame.hidden = true; frame.removeAttribute('src'); reset.disabled = true;
  }
  function loadFrame(force = false) {
    if (!active() || !currentUrl || (!force && loadedUrl === currentUrl)) return;
    loadedUrl = currentUrl;
    $('neuroglancerStatus').textContent = 'Открываем Neuroglancer. Изображения и 3D загружаются из MICrONS…';
    frame.title = `Neuroglancer — ${window.ReviewViewer.volume.volume_id}`;
    frame.hidden = false; frame.src = currentUrl;
  }
  function update({refreshFrame=true}={}) {
    const viewer = window.ReviewViewer, c = viewer?.currentCase, v = viewer?.volume;
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
      const state = buildState(c, v, viewer.z, viewer.target, objects, focus,findings);
      currentUrl = urlFor(state);
      external.href = currentUrl; external.removeAttribute('aria-disabled'); reset.disabled = false;
      const target = viewer.target ? ` · ${viewer.target.id}: ${viewer.target.label.toLowerCase()}` : '';
      const nearby=objects.filter(o=>o.context).length;
      const count=state.layers.filter(l=>l.name.startsWith('Мои метки')).reduce((n,l)=>n+l.annotations.length,0);
      $('neuroglancerLocation').textContent = `${v.volume_id} · локальный Z ${viewer.z}${target} · объектов ${objects.length}${nearby?' (соседних '+nearby+')':''} · моих меток ${count}${count&&!findings.visible?' (скрыты)':''}`;
      if (!active()) $('neuroglancerStatus').textContent = 'Ссылка на текущий срез готова.';
      else if(!refreshFrame&&loadedUrl&&loadedUrl!==currentUrl)$('neuroglancerStatus').textContent='Метки или заметки обновлены. Нажмите «К текущему срезу 2D / 3D», чтобы обновить Neuroglancer.';
      if(refreshFrame||!loadedUrl)loadFrame();
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
  window.addEventListener('review:volume', update);
  window.addEventListener('review:position', update);
  window.addEventListener('annotations:surface-ready', update);
  window.addEventListener('annotations:ready',()=>update());
  window.addEventListener('annotations:changed',()=>update({refreshFrame:false}));
  $('annotationsVisible').addEventListener('change',()=>update({refreshFrame:false}));
  window.addEventListener('surface:visibility', event => {
    if(event.detail.volume_id===window.ReviewViewer?.volume?.volume_id&&event.detail.case_id===window.ReviewViewer?.currentCase?.case_id)update();
  });
  let entryGeneration=0;
  async function openCurrent(){const generation=++entryGeneration;await window.HandoffAnnotations?.whenSettled();if(generation!==entryGeneration||!active())return;if(!segmentIndex)await loadIndex();if(generation!==entryGeneration||!active())return;loadedUrl='';update();}
  window.addEventListener('hashchange', () => {if(active())openCurrent();else entryGeneration++;});
  reset.addEventListener('click',openCurrent);
  loadIndex();
})();
