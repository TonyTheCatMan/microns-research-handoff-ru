/* Public MICrONS viewer states use physical coordinates, with no registration offset. */
(() => {
  'use strict';
  const HOST = 'https://ngl.microns-explorer.org/';
  const EM = 'precomputed://https://bossdb-open-data.s3.amazonaws.com/iarpa_microns/minnie/minnie65/em';
  const SEG = 'precomputed://https://storage.googleapis.com/iarpa_microns/minnie/minnie65/seg_m1300';

  function buildState(currentCase, volume, localZ, target, objects) {
    if (!currentCase.volumes.some(v => v.volume_id === volume.volume_id)) throw new Error('Случай и объём не совпадают.');
    if (!Number.isInteger(localZ) || localZ < 0 || localZ >= volume.shape_xyz[2]) throw new Error('Срез вне выбранного объёма.');
    const resolution = volume.resolution_nm;
    const dimensions = Object.fromEntries(['x', 'y', 'z'].map((axis, i) => [axis, [resolution[i] * 1e-9, 'm']]));
    const begin = volume.begin_vox_xyz;
    // Match the local TIFF/3D voxel center. Contact annotations retain their exact supplied coordinates.
    const position = begin.map((n, i) => n + (i === 2 ? localZ + 0.5 : target ? target.local[i] + 0.5 : volume.shape_xyz[i] / 2));
    const annotations = [];
    for (const contact of currentCase.contacts) {
      for (const [key, label] of [['ctr_nm', 'центр'], ['pre_nm', 'пре'], ['post_nm', 'пост']]) {
        if (!contact[key]) continue;
        annotations.push({type: 'point', id: `${contact.contact_id}-${key}`, point: contact[key].map((n, i) => n / resolution[i]), description: `${currentCase.case_id} · ${contact.contact_id} · ${label} · не проверено`});
      }
    }
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
        {type: 'annotation', name: 'Заданные точки · не проверены', source: {url: 'local://annotations', transform: {outputDimensions: dimensions}}, annotationColor: '#ffca64', annotations}
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
  function update() {
    const viewer = window.ReviewViewer, c = viewer?.currentCase, v = viewer?.volume;
    $('neuroglancerTabCase').textContent = c ? '· ' + c.case_id : '· текущий случай';
    $('neuroglancerHeading').textContent = c ? '· ' + c.case_id : '';
    if (!c || !v || !viewer.ready) {
      clearLink();
      $('neuroglancerLocation').textContent = v ? `${v.volume_id} · ожидаем загрузку текущего среза…` : 'Выберите случай в основном просмотрщике.';
      $('neuroglancerStatus').textContent = 'Подготовка ссылки…';
      return;
    }
    if (!segmentIndex) return;
    try {
      const objects = segmentIndex.volumes[v.volume_id];
      if (!Array.isArray(objects) || !objects.length) throw new Error('Нет сопоставления объектов для этого объёма.');
      const state = buildState(c, v, viewer.z, viewer.target, objects);
      currentUrl = urlFor(state);
      external.href = currentUrl; external.removeAttribute('aria-disabled'); reset.disabled = false;
      const target = viewer.target ? ` · ${viewer.target.id}: ${viewer.target.label.toLowerCase()}` : '';
      $('neuroglancerLocation').textContent = `${v.volume_id} · локальный Z ${viewer.z} · глобальный Z ${v.begin_vox_xyz[2] + viewer.z}${target}`;
      if (!active()) $('neuroglancerStatus').textContent = 'Ссылка на текущий срез готова.';
      loadFrame();
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
    $('neuroglancerStatus').textContent = 'Neuroglancer открыт. Дождитесь загрузки ЭМ и 3D; при ошибке воспользуйтесь отдельным окном.';
  });
  window.addEventListener('review:volume', update);
  window.addEventListener('review:position', update);
  window.addEventListener('hashchange', () => { if (active()) { loadedUrl = ''; update(); } });
  reset.addEventListener('click', async () => { if (!segmentIndex) await loadIndex(); loadedUrl = ''; update(); });
  loadIndex();
})();
