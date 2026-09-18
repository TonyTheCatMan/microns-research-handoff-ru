/* Russian online adaptation of the supplied TIFF viewer. Scientific coordinate mapping is preserved. */
(() => {
  'use strict';
  const byId = id => document.getElementById(id);
  const ui = Object.fromEntries(['status','caseSelect','volumeSelect','volumeDetails','contacts','targetStatus','overlayToggle','prevButton','nextButton','zSlider','zInput','zReadout','zoomSelect','fitButton','blackInput','whiteInput','rawButton','windowButton','exportButton','viewport','emptyState','canvasWrap','imageCanvas','overlayCanvas','scaleCanvas','scaleNote','cursorReadout'].map(id => [id, byId(id)]));
  const state = { files:[], metadata:null, currentCase:null, volume:null, tiff:null, pixels:null, z:0, zoom:2, black:0, white:255, target:null, generation:0, viewCenter:null };
  const MIN_ZOOM = .1, MAX_ZOOM = 8;
  const surface = new LocalSurfaceView();
  const fmt = values => values.map(v => Number.isInteger(v) ? String(v) : Number(v.toFixed(3))).join(', ');
  const triple = (a, predicate) => Array.isArray(a) && a.length === 3 && a.every(predicate);
  const finite = x => typeof x === 'number' && Number.isFinite(x);
  const integer = x => Number.isSafeInteger(x);
  const normalPath = s => String(s).replace(/\\/g, '/').replace(/^\.\//, '');
  const filePath = f => normalPath(f.webkitRelativePath || f.name);
  function status(message, kind='') { ui.status.textContent = message; ui.status.className = 'status ' + kind; }
  async function readFile(file, asText=false) {
    return HandoffAssets.read(file.onlinePath, asText, state.controller?.signal);
  }
  function validateMetadata(data) {
    if (!data || !Array.isArray(data.cases) || !data.cases.length || data.cases.length > 1000) throw new Error('Файл case_index.json должен содержать непустой массив cases.');
    const caseIds = new Set(), volumeIds = new Set();
    for (const c of data.cases) {
      if (typeof c.case_id !== 'string' || caseIds.has(c.case_id)) throw new Error('Идентификаторы случаев должны быть уникальными строками.');
      caseIds.add(c.case_id);
      if (!Array.isArray(c.volumes) || !c.volumes.length || !Array.isArray(c.contacts)) throw new Error(c.case_id + ': отсутствуют объёмы или контакты.');
      for (const v of c.volumes) {
        if (typeof v.volume_id !== 'string' || volumeIds.has(v.volume_id)) throw new Error('Идентификаторы объёмов должны быть уникальными строками.');
        volumeIds.add(v.volume_id);
        if (typeof v.path !== 'string' || !v.path || /(^|\/)\.\.(\/|$)/.test(normalPath(v.path))) throw new Error(c.case_id + ': неверный путь к TIFF.');
        if (!triple(v.shape_xyz, x => integer(x) && x > 0) || !triple(v.begin_vox_xyz, integer) || !triple(v.end_vox_xyz_exclusive, integer)) throw new Error(v.volume_id + ': неверные размеры XYZ или границы фрагмента.');
        if (!v.shape_xyz.every((n,i) => v.end_vox_xyz_exclusive[i] - v.begin_vox_xyz[i] === n)) throw new Error(v.volume_id + ': конечная граница фрагмента (не включается) не соответствует его размерам.');
        v.resolution_nm = v.resolution_nm || data.resolution_nm;
        if (!triple(v.resolution_nm, x => finite(x) && x > 0)) throw new Error(v.volume_id + ': неверный размер вокселя.');
      }
      const contactIds = new Set();
      for (const contact of c.contacts) {
        if (typeof contact.contact_id !== 'string' || contactIds.has(contact.contact_id)) throw new Error(c.case_id + ': идентификаторы контактов должны быть уникальными.');
        contactIds.add(contact.contact_id);
        for (const key of ['ctr_nm','pre_nm','post_nm']) if (contact[key] != null && !triple(contact[key], finite)) throw new Error(c.case_id + ': неверная ' + key + ' координата.');
      }
    }
    return data;
  }
  function findFile(relative) { return HandoffAssets.file(relative); }
  async function start() {
    byId('retryLoad').hidden=true;
    status('Загрузка списка случаев…');
    try {
      state.metadata=validateMetadata(JSON.parse(await HandoffAssets.read('case_index.json',true)));
      ui.caseSelect.replaceChildren(...state.metadata.cases.map(c=>new Option(c.case_id,c.case_id)));
      ui.caseSelect.disabled=false;
      const params=new URLSearchParams(location.search);
      if(!params.has('case')&&!params.has('panel'))try{const saved=JSON.parse(localStorage.getItem('microns-last-view-v1')||'null');if(saved&&state.metadata.cases.some(c=>c.case_id===saved.case_id)){params.set('case',saved.case_id);params.set('volume',saved.volume_id);params.set('z',String(saved.z));}}catch{}
      const wanted=params.get('case');
      if(state.metadata.cases.some(c=>c.case_id===wanted))ui.caseSelect.value=wanted;
      window.dispatchEvent(new CustomEvent('review:ready',{detail:state.metadata}));
      selectCase(params.get('volume'),params.get('z'));
    } catch(error) { status(error.message,'error');byId('retryLoad').hidden=false; }
  }
  function clearImage() {
    surface.clear();
    for(const id of ['orthoToggle','orthoX','orthoY','orthoTarget'])byId(id).disabled=true;
    byId('orthoPanel').hidden=true;
    state.tiff = null; state.pixels = null; state.target = null; state.viewCenter = null;
    for (const name of ['prevButton','nextButton','zSlider','zInput','zoomSelect','fitButton','blackInput','whiteInput','rawButton','windowButton','exportButton','overlayToggle']) ui[name].disabled = true;
    ui.canvasWrap.hidden = true; ui.emptyState.hidden = false;
    ui.contacts.replaceChildren();
    ui.targetStatus.textContent = 'Изображение не загружено.';
    ui.emptyState.querySelector('h2').textContent='Подготавливаем изображения';ui.emptyState.querySelector('p').textContent='Выбранный объём загружается с сайта.';
    ui.scaleNote.textContent = '';
    byId('sliceScale').hidden = true;
    ui.zReadout.textContent = '—';
    ui.cursorReadout.textContent = 'Наведите указатель на изображение, чтобы увидеть значение пикселя и координаты.';
    ui.scaleCanvas.getContext('2d').clearRect(0,0,ui.scaleCanvas.width,ui.scaleCanvas.height);
  }
  function selectCase(wantedVolume, wantedZ) {
    state.currentCase=state.metadata.cases.find(c=>c.case_id===ui.caseSelect.value);
    if(!state.currentCase)return;
    ui.volumeSelect.replaceChildren(...state.currentCase.volumes.map(v=>new Option(v.volume_id.replace('-main',' · основной').replace('-extension-',' · расширение '),v.volume_id)));
    if(state.currentCase.volumes.some(v=>v.volume_id===wantedVolume))ui.volumeSelect.value=wantedVolume;
    ui.volumeSelect.disabled=false;
    return loadVolume(wantedZ);
  }
  async function loadVolume(wantedZ) {
    state.controller?.abort();state.controller=new AbortController();
    byId('retryLoad').hidden=true;
    const generation = ++state.generation;
    clearImage();
    state.volume = state.currentCase.volumes.find(v => v.volume_id === ui.volumeSelect.value);
    const volume = state.volume;
    byId('downloadTiff').href=volume.path;
    byId('downloadTiff').download=volume.path.split('/').pop();
    window.dispatchEvent(new CustomEvent('review:volume',{detail:{caseId:state.currentCase.case_id,volumeId:volume.volume_id}}));
    ui.volumeDetails.textContent = 'Размеры XYZ: ' + fmt(volume.shape_xyz) + '\nРазмер вокселя (нм): ' + fmt(volume.resolution_nm) + '\nНачало в глобальных координатах: ' + fmt(volume.begin_vox_xyz) + '\nКонец в глобальных координатах (не включается): ' + fmt(volume.end_vox_xyz_exclusive);
    ui.volumeDetails.style.whiteSpace = 'pre-line';
    if(new URLSearchParams(location.search).get('panel')==='annotations'){status('Свойства и отметки · '+volume.volume_id);return;}
    try {
      const file = findFile(volume.path);
      if (!file) throw new Error('TIFF не выбран: ' + volume.path + '. Добавьте файл или выберите папку с полным пакетом.');
      status('Чтение ' + volume.volume_id + '…');
      const buffer = await readFile(file);
      if (generation !== state.generation) return;
      const tiff = new GrayTiff(buffer);
      const actual = [tiff.width,tiff.height,tiff.depth];
      if (!actual.every((n,i) => n === volume.shape_xyz[i])) throw new Error('Размеры в метаданных и TIFF не совпадают: ожидаемые XYZ ' + fmt(volume.shape_xyz) + ', получены ' + fmt(actual) + '. Не используйте эти координаты для проверки.');
      state.tiff = tiff; state.z = wantedZ!==null && wantedZ!==undefined && Number.isFinite(Number(wantedZ)) ? Math.max(0,Math.min(tiff.depth-1,Math.floor(Number(wantedZ)))) : Math.floor(tiff.depth / 2); state.target = null;
      surface.setVolume(volume,state.currentCase.case_id);
      resetOrthos();
      state.black = 0; state.white = 255; ui.blackInput.value = '0'; ui.whiteInput.value = '255';

      for (const name of ['zSlider','zInput','zoomSelect','fitButton','blackInput','whiteInput','rawButton','windowButton','exportButton','overlayToggle']) ui[name].disabled = false;
      ui.zSlider.max = ui.zInput.max = String(tiff.depth - 1);
      ui.imageCanvas.width = ui.overlayCanvas.width = tiff.width;
      ui.imageCanvas.height = ui.overlayCanvas.height = tiff.height;
      ui.canvasWrap.hidden = false; ui.emptyState.hidden = true;
      renderContacts(); render(); state.needsFit=true;if(!byId('page-viewer').hidden){ui.fitButton.click();state.needsFit=false;}
      status('MICrONS · ' + state.metadata.cases.length + ' случаев · ' + volume.volume_id + ' · ' + tiff.depth + ' срезов TIFF · исходный диапазон яркости 0–255', 'success');
    } catch (error) { if (generation === state.generation && error.name!=='AbortError') {status(error.message,'error');byId('retryLoad').hidden=false;ui.emptyState.querySelector('h2').textContent='Объём не загружен';ui.emptyState.querySelector('p').textContent='Проверьте соединение и нажмите «Повторить загрузку».';} }
  }
  function toLocal(nm) { return nm.map((value,i) => Math.floor(value / state.volume.resolution_nm[i]) - state.volume.begin_vox_xyz[i]); }
  function inBounds(local) { return local.every((n,i) => n >= 0 && n < state.volume.shape_xyz[i]); }
  function renderContacts() {
    ui.contacts.replaceChildren();
    for (const contact of state.currentCase.contacts) {
      const card = document.createElement('div'); card.className = 'contact';
      const title = document.createElement('div'); title.className = 'contact-title'; title.textContent = contact.contact_id;
      const buttons = document.createElement('div'); buttons.className = 'contact-buttons';
      for (const [key,label] of [['ctr_nm','Центр'],['pre_nm','Пре'],['post_nm','Пост']]) {
        if (!contact[key]) continue;
        const local = toLocal(contact[key]), valid = inBounds(local);
        const button = document.createElement('button'); button.textContent = label; button.disabled = !valid;
        button.dataset.target = contact.contact_id + ':' + key;
        button.title = (valid ? 'Перейти к' : 'За границами этого фрагмента:') + ' локальным XYZ ' + fmt(local) + '; глобальные координаты (нм) ' + fmt(contact[key]);
        button.addEventListener('click', () => {
          state.target = {id:contact.contact_id,key,label,nm:contact[key],local};
          ui.contacts.querySelectorAll('button').forEach(b => b.classList.toggle('active', b === button));
          setZ(local[2]);
        });
        buttons.append(button);
      }
      card.append(title,buttons); ui.contacts.append(card);
    }
    if (!state.currentCase.contacts.length) { const p = document.createElement('p'); p.textContent = 'Стартовые точки не предоставлены.'; ui.contacts.append(p); }
  }
  function setZ(value) {
    if (!state.tiff || !Number.isFinite(Number(value))) return;
    state.z = Math.max(0, Math.min(state.tiff.depth - 1, Math.floor(Number(value))));
    render();
  }
  function render() {
    if (!state.tiff) return;
    state.pixels = state.tiff.plane(state.z);
    const context = ui.imageCanvas.getContext('2d'), output = context.createImageData(state.tiff.width,state.tiff.height);
    const invert = state.tiff.pages[state.z].whiteIsZero;
    for (let i = 0; i < state.pixels.length; i++) {
      const displayed = Math.max(0,Math.min(255,Math.round((state.pixels[i] - state.black) * 255 / (state.white - state.black))));
      const gray = invert ? 255 - displayed : displayed;
      output.data[4*i] = output.data[4*i+1] = output.data[4*i+2] = gray; output.data[4*i+3] = 255;
    }
    context.putImageData(output,0,0);
    surface.setSlice(ui.imageCanvas,state.z,state.black,state.white);
    ui.zSlider.value = ui.zInput.value = String(state.z);
    ui.prevButton.disabled = state.z === 0; ui.nextButton.disabled = state.z === state.tiff.depth - 1;
    const globalZ = state.volume.begin_vox_xyz[2] + state.z;
    ui.zReadout.textContent = 'из ' + (state.tiff.depth - 1) + ' · глобальная Z ' + globalZ + ' · ' + (globalZ * state.volume.resolution_nm[2]) + ' нм';
    resizeView();
    renderOrthos();
    window.dispatchEvent(new CustomEvent('review:position'));
  }
  function resizeView() {
    if (!state.tiff) return;
    const width = state.tiff.width * state.zoom, height = state.tiff.height * state.zoom;
    ui.canvasWrap.style.width = width + 'px'; ui.canvasWrap.style.height = height + 'px';
    // Keep room to pan and hold the cursor's image point fixed, including at small scales.
    if (ui.viewport.clientWidth && ui.viewport.clientHeight) ui.canvasWrap.style.margin = (ui.viewport.clientHeight / 2) + 'px ' + (ui.viewport.clientWidth / 2) + 'px';
    for (const canvas of [ui.imageCanvas,ui.overlayCanvas]) { canvas.style.width = width + 'px'; canvas.style.height = height + 'px'; }
    drawOverlay(); drawScale();
  }
  function viewportCenter() {
    const rect = ui.viewport.getBoundingClientRect();
    return {x:rect.left + ui.viewport.clientLeft + ui.viewport.clientWidth / 2, y:rect.top + ui.viewport.clientTop + ui.viewport.clientHeight / 2};
  }
  function imagePointAt(anchor) {
    const rect = ui.imageCanvas.getBoundingClientRect();
    return {x:(anchor.x - rect.left) / state.zoom, y:(anchor.y - rect.top) / state.zoom};
  }
  function placeImagePoint(point, anchor) {
    const rect = ui.imageCanvas.getBoundingClientRect();
    ui.viewport.scrollLeft += rect.left + point.x * state.zoom - anchor.x;
    ui.viewport.scrollTop += rect.top + point.y * state.zoom - anchor.y;
    rememberViewCenter();
  }
  function rememberViewCenter() {
    if (state.tiff && !byId('page-viewer').hidden && ui.viewport.clientWidth && ui.viewport.clientHeight) state.viewCenter = imagePointAt(viewportCenter());
  }
  function syncZoomOption(fit=false) {
    const preset = !fit && [...ui.zoomSelect.options].find(option => !option.dataset.fit && !option.dataset.custom && Math.abs(Number(option.value) - state.zoom) < 1e-8);
    if (preset) { ui.zoomSelect.value = preset.value; return; }
    const kind = fit ? 'fit' : 'custom';
    let option = ui.zoomSelect.querySelector('[data-' + kind + ']');
    if (!option) { option = new Option(); option.dataset[kind] = 'true'; ui.zoomSelect.append(option); }
    option.value = String(state.zoom);
    option.textContent = (fit ? 'По размеру окна · ' : '') + Math.round(state.zoom * 100) + '%';
    ui.zoomSelect.value = option.value;
  }
  function setZoom(value, anchor=viewportCenter(), fit=false) {
    if (!state.tiff || !Number.isFinite(value)) return;
    const point = fit ? {x:state.tiff.width / 2,y:state.tiff.height / 2} : imagePointAt(anchor);
    state.zoom = Math.max(MIN_ZOOM,Math.min(MAX_ZOOM,value));
    syncZoomOption(fit); resizeView(); placeImagePoint(point,anchor);
    if (drag) { drag.left = ui.viewport.scrollLeft; drag.top = ui.viewport.scrollTop; drag.x = drag.currentX; drag.y = drag.currentY; }
  }
  function drawOverlay() {
    surface.setTarget(state.target,false);
    byId('orthoTarget').disabled=!state.target;
    const canvas=ui.overlayCanvas,ctx=canvas.getContext('2d');
    ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,canvas.width,canvas.height);
    const width=ui.imageCanvas.width*state.zoom,height=ui.imageCanvas.height*state.zoom,ratio=window.devicePixelRatio||1;
    const pixelsWide=Math.max(1,Math.round(width*ratio)),pixelsHigh=Math.max(1,Math.round(height*ratio));
    if(canvas.width!==pixelsWide)canvas.width=pixelsWide;if(canvas.height!==pixelsHigh)canvas.height=pixelsHigh;
    canvas.style.width=width+'px';canvas.style.height=height+'px';
    // Draw symbols and text at screen resolution, independently of the EM pixel grid.
    ctx.save();ctx.setTransform(canvas.width/width,0,0,canvas.height/height,0,0);
    const points=[];
    if(state.currentCase&&state.volume)for(const contact of state.currentCase.contacts)for(const [key,filter,suffix] of [['ctr_nm','tCenter',''],['pre_nm','tPre',' пре'],['post_nm','tPost',' пост']]){
      if(!contact[key]||!byId(filter).checked)continue;
      const local=toLocal(contact[key]);if(!inBounds(local))continue;
      const point={id:contact.contact_id,key,label:contact.contact_id+suffix,nm:contact[key],local};points.push(point);
      if(!ui.overlayToggle.checked||local[2]!==state.z)continue;
      const x=(local[0]+.5)*state.zoom,y=(local[1]+.5)*state.zoom;
      MarkerStyles.draw(ctx,x,y,5,key);
      ctx.font='bold 13px system-ui';ctx.lineWidth=3;ctx.strokeStyle='#172632';ctx.strokeText(point.label,x+8,y-8);ctx.fillStyle=MarkerStyles.styles[key].color;ctx.fillText(point.label,x+8,y-8);
    }
    ctx.restore();
    surface.setTargets?.(points,ui.overlayToggle.checked);
    const target=state.target;
    ui.targetStatus.textContent=(target?target.id+' '+target.label.toLowerCase()+': локальные XYZ '+fmt(target.local)+'. ':'')+(ui.overlayToggle.checked?'Все включённые T-точки показаны на своих срезах; в 3D — вместе.':'Точки T скрыты. Кнопки контактов по-прежнему перемещают к их срезам.');
    window.dispatchEvent(new Event('review:display'));
  }
  function watchPixelDensity(){
    matchMedia(`(resolution: ${window.devicePixelRatio||1}dppx)`).addEventListener('change',()=>{if(state.tiff){drawOverlay();drawScale();}watchPixelDensity();},{once:true});
  }
  watchPixelDensity();
  function drawScale() {
    const pixelsPerNm=state.zoom/state.volume.resolution_nm[0],target=Math.min(100,Math.max(50,ui.viewport.clientWidth*.2));
    const power=10**Math.floor(Math.log10(target/pixelsPerNm)),options=[.5,1,2,5,10].map(n=>n*power);
    const nm=options.reduce((best,n)=>Math.abs(n*pixelsPerNm-target)<Math.abs(best*pixelsPerNm-target)?n:best),cssLength=nm*pixelsPerNm;
    const label=nm>=1000?(nm/1000).toLocaleString('ru-RU',{maximumFractionDigits:3})+' мкм':nm.toLocaleString('ru-RU',{maximumFractionDigits:3})+' нм';
    const cssWidth = Math.max(100, Math.ceil(cssLength + 20));
    const ratio = window.devicePixelRatio || 1;
    ui.scaleCanvas.width = Math.round(cssWidth * ratio); ui.scaleCanvas.height = Math.round(44 * ratio); ui.scaleCanvas.style.width = cssWidth + 'px';ui.scaleCanvas.style.height='44px';
    const ctx = ui.scaleCanvas.getContext('2d'); ctx.scale(ratio,ratio);ctx.strokeStyle='#e4edf0';ctx.lineWidth=2;
    ctx.beginPath();ctx.moveTo(10,14);ctx.lineTo(10+cssLength,14);ctx.moveTo(10,10);ctx.lineTo(10,18);ctx.moveTo(10+cssLength,10);ctx.lineTo(10+cssLength,18);ctx.stroke();
    ctx.fillStyle='#e4edf0';ctx.font='11px system-ui';ctx.fillText(label,10,35);
    ui.scaleCanvas.setAttribute('aria-label','Масштаб '+label);ui.scaleCanvas.dataset.scaleNm=String(nm);ui.scaleCanvas.dataset.scalePixels=String(cssLength);
    byId('sliceScale').hidden=false;
    ui.scaleNote.textContent = '1 исходный пиксель = '+state.volume.resolution_nm[0]+' нм · масштаб ' + Math.round(state.zoom*100) + '%';
  }
  function setWindow(black,white) {
    if (!integer(black) || !integer(white) || black < 0 || white > 255 || black >= white) { status('Диапазон яркости должен соответствовать условию 0 ≤ чёрный < белый ≤ 255. Значения пикселей не изменены.', 'error'); return; }
    state.black=black;state.white=white;ui.blackInput.value=String(black);ui.whiteInput.value=String(white);render();
    status(state.volume.volume_id + ' · диапазон отображения ' + black + '–' + white + ' · исходные значения пикселей файла не изменены', 'success');
  }
  function exportSection() {
    if (!state.tiff) return;
    const scale = 2, imageWidth = state.tiff.width * scale, imageHeight = state.tiff.height * scale;
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1500,imageWidth + 32); canvas.height = imageHeight + 250;
    const ctx = canvas.getContext('2d'), left = Math.floor((canvas.width-imageWidth)/2), top = 66;
    const globalZ = state.volume.begin_vox_xyz[2]+state.z;
    const markerIncluded = ui.overlayToggle.checked;
    ctx.fillStyle='#ffffff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#17313d';ctx.font='bold 18px system-ui';
    ctx.fillText(state.currentCase.case_id+' · '+state.volume.volume_id,16,27);
    ctx.font='14px system-ui';ctx.fillText('Локальная Z '+state.z+' / '+(state.tiff.depth-1)+' · глобальная Z '+globalZ+' · '+globalZ*state.volume.resolution_nm[2]+' нм',16,49);
    ctx.imageSmoothingEnabled=false;ctx.drawImage(ui.imageCanvas,left,top,imageWidth,imageHeight);
    const segmentation=window.SliceSegmentation?.captureFor(state.volume.volume_id,state.z);
    if(segmentation)ctx.drawImage(segmentation.canvas,left,top,imageWidth,imageHeight);
    if(markerIncluded)ctx.drawImage(ui.overlayCanvas,left,top,imageWidth,imageHeight);
    if(window.HandoffAnnotations?.visible)ctx.drawImage(byId('annotationCanvas'),left,top,imageWidth,imageHeight);
    let y=top+imageHeight+20;
    const bar=500/state.volume.resolution_nm[0]*scale;ctx.strokeStyle='#17313d';ctx.lineWidth=2;
    ctx.beginPath();ctx.moveTo(16,y);ctx.lineTo(16+bar,y);ctx.moveTo(16,y-4);ctx.lineTo(16,y+4);ctx.moveTo(16+bar,y-4);ctx.lineTo(16+bar,y+4);ctx.stroke();ctx.fillText('500 нм',25+bar,y+5);
    y+=28;ctx.fillText('Отображение: '+state.black+'–'+state.white+' · ближайший сосед, 2× · выбранная метка '+(markerIncluded?'включена':'не включена'),16,y);
    y+=22;const target=state.target;ctx.fillText(target?'Стартовая точка '+target.id+' '+target.label+': локальные XYZ '+fmt(target.local)+'; floor(нм / размер вокселя) − начало.':'Точка контакта не выбрана. Координаты: floor(нм / размер вокселя) − начало.',16,y);
    y+=22;ctx.fillText('Стартовая анатомическая точка не проверена. '+(segmentation?'Цвета seg_m1300 — для навигации. ':'')+'Исходные пиксели TIFF не изменены.',16,y);
    y+=22;ctx.font='12px system-ui';ctx.fillText('MICrONS Consortium (2025) · doi:10.1038/s41586-025-08790-w · CC BY 4.0',16,y);
    y+=19;ctx.fillText('Условия: https://www.microns-explorer.org/terms-and-conditions',16,y);
    const name=(state.volume.volume_id+'_local-z'+state.z+'_global-z'+globalZ+'_window-'+state.black+'-'+state.white+(markerIncluded?'_pointer':'_no-pointer')+'.png').replace(/[^a-zA-Z0-9_.-]/g,'_');
    canvas.toBlob(blob=>{
      if(!blob){status('Не удалось экспортировать PNG. Файл TIFF не изменён.','error');return;}
      const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);
    },'image/png');
  }
  ui.caseSelect.addEventListener('change',()=>selectCase());
  ui.volumeSelect.addEventListener('change',()=>loadVolume());
  byId('retryLoad').addEventListener('click',()=>state.metadata?loadVolume():start());
  byId('surfaceRetry').addEventListener('click',()=>{if(state.tiff){surface.setVolume(state.volume,state.currentCase.case_id);render();}});
  ui.zSlider.addEventListener('input',e=>setZ(e.target.value));
  ui.zInput.addEventListener('input',e=>{if(e.target.value!=='')setZ(e.target.value);});
  ui.zInput.addEventListener('change',e=>setZ(e.target.value));
  ui.prevButton.addEventListener('click',()=>setZ(state.z-1));ui.nextButton.addEventListener('click',()=>setZ(state.z+1));
  ui.zoomSelect.addEventListener('change',e=>setZoom(Number(e.target.value)));
  ui.fitButton.addEventListener('click',()=>{
    if (!state.tiff) return;
    setZoom(Math.min((ui.viewport.clientWidth-20)/state.tiff.width,(ui.viewport.clientHeight-20)/state.tiff.height,4),viewportCenter(),true);
  });
  ui.viewport.addEventListener('wheel',event=>{
    if (!state.tiff || ui.canvasWrap.hidden || byId('page-viewer').hidden || !ui.viewport.clientWidth || !ui.viewport.clientHeight || !Number.isFinite(event.deltaY) || event.deltaY === 0) return;
    event.preventDefault();
    const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? ui.viewport.clientHeight : 1;
    const delta = Math.max(-240,Math.min(240,event.deltaY * unit));
    setZoom(state.zoom * Math.exp(-delta * .002),{x:event.clientX,y:event.clientY});
  },{passive:false});
  for(const input of [ui.blackInput,ui.whiteInput])input.addEventListener('change',()=>setWindow(Number(ui.blackInput.value),Number(ui.whiteInput.value)));
  ui.rawButton.addEventListener('click',()=>setWindow(0,255));ui.windowButton.addEventListener('click',()=>setWindow(110,160));
  ui.exportButton.addEventListener('click',exportSection);
  ui.overlayToggle.addEventListener('change',drawOverlay);
  for(const id of ['tCenter','tPre','tPost'])byId(id).addEventListener('change',drawOverlay);
  const ortho={x:0,y:0,key:'',rawXZ:null,rawYZ:null};
  function resetOrthos(){
    ortho.x=Math.floor(state.tiff.width/2);ortho.y=Math.floor(state.tiff.height/2);ortho.key='';
    byId('orthoToggle').disabled=false;byId('orthoTarget').disabled=true;
    for(const [id,maximum,value] of [['orthoX',state.tiff.width-1,ortho.x],['orthoY',state.tiff.height-1,ortho.y]]){byId(id).disabled=false;byId(id).max=String(maximum);byId(id).value=String(value);}
  }
  function renderOrthos(){
    const panel=byId('orthoPanel');panel.hidden=!state.tiff||!byId('orthoToggle').checked;if(panel.hidden)return;
    const tiff=state.tiff,key=[state.generation,ortho.x,ortho.y,state.black,state.white].join(':');
    if(key!==ortho.key){
      ortho.rawXZ=new Uint8Array(tiff.width*tiff.depth);ortho.rawYZ=new Uint8Array(tiff.height*tiff.depth);
      for(let z=0;z<tiff.depth;z++){const plane=tiff.plane(z);ortho.rawXZ.set(plane.subarray(ortho.y*tiff.width,(ortho.y+1)*tiff.width),z*tiff.width);for(let y=0;y<tiff.height;y++)ortho.rawYZ[z*tiff.height+y]=plane[y*tiff.width+ortho.x];}
      for(const [id,pixels,width] of [['xzCanvas',ortho.rawXZ,tiff.width],['yzCanvas',ortho.rawYZ,tiff.height]]){
        const canvas=byId(id);canvas.width=width;canvas.height=tiff.depth;const context=canvas.getContext('2d'),image=context.createImageData(width,tiff.depth),invert=tiff.pages[0].whiteIsZero;
        for(let i=0;i<pixels.length;i++){const displayed=Math.max(0,Math.min(255,Math.round((pixels[i]-state.black)*255/(state.white-state.black)))),gray=invert?255-displayed:displayed;image.data[4*i]=image.data[4*i+1]=image.data[4*i+2]=gray;image.data[4*i+3]=255;}context.putImageData(image,0,0);
      }
      ortho.key=key;
    }
    byId('xzTitle').textContent='XZ при локальной Y '+ortho.y+' · X →, Z ↓';byId('yzTitle').textContent='YZ при локальной X '+ortho.x+' · Y →, Z ↓';
    for(const [name,width,resHorizontal] of [['xz',tiff.width,state.volume.resolution_nm[0]],['yz',tiff.height,state.volume.resolution_nm[1]]]){
      const canvas=byId(name+'Canvas'),overlay=byId(name+'Overlay'),wrap=canvas.parentElement,physicalAspect=tiff.depth*state.volume.resolution_nm[2]/(width*resHorizontal),cssWidth=Math.max(50,Math.min(wrap.parentElement.clientWidth,470/physicalAspect)),cssHeight=cssWidth*physicalAspect;
      wrap.style.width=cssWidth+'px';wrap.style.height=cssHeight+'px';for(const c of [canvas,overlay]){c.style.width=cssWidth+'px';c.style.height=cssHeight+'px';}
      overlay.width=Math.ceil(cssWidth);overlay.height=Math.ceil(cssHeight);const ctx=overlay.getContext('2d');ctx.strokeStyle='#49c7f3';ctx.lineWidth=1.5;const yy=(state.z+.5)/tiff.depth*cssHeight;ctx.beginPath();ctx.moveTo(0,yy);ctx.lineTo(cssWidth,yy);ctx.stroke();
      const scalePixels=500/(width*resHorizontal)*cssWidth;ctx.strokeStyle='#101c25';ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(10,cssHeight-23);ctx.lineTo(10+scalePixels,cssHeight-23);ctx.stroke();ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.stroke();ctx.font='11px system-ui';ctx.lineWidth=3;ctx.strokeStyle='#101c25';ctx.strokeText('500 нм',10,cssHeight-8);ctx.fillStyle='#fff';ctx.fillText('500 нм',10,cssHeight-8);
    }
    byId('orthoReadout').textContent='Точка пересечения в локальных XYZ: '+fmt([ortho.x,ortho.y,state.z])+' · глобальные координаты вокселя: '+fmt([ortho.x,ortho.y,state.z].map((n,i)=>n+state.volume.begin_vox_xyz[i]))+'. Эти положения не изменяют предоставленные координаты контактов.';
  }
  byId('orthoToggle').addEventListener('change',renderOrthos);
  for(const [id,key,dimension] of [['orthoX','x','width'],['orthoY','y','height']])byId(id).addEventListener('change',e=>{if(!state.tiff)return;const value=Number(e.target.value);if(!Number.isFinite(value)){e.target.value=String(ortho[key]);return;}ortho[key]=Math.max(0,Math.min(state.tiff[dimension]-1,Math.floor(value)));e.target.value=String(ortho[key]);renderOrthos();});
  byId('orthoTarget').addEventListener('click',()=>{if(!state.target)return;[ortho.x,ortho.y]=state.target.local;byId('orthoX').value=String(ortho.x);byId('orthoY').value=String(ortho.y);setZ(state.target.local[2]);});
  for(const [name,key,dimension] of [['xz','x','width'],['yz','y','height']])byId(name+'Canvas').addEventListener('click',e=>{if(!state.tiff)return;const rect=e.target.getBoundingClientRect();ortho[key]=Math.max(0,Math.min(state.tiff[dimension]-1,Math.floor((e.clientX-rect.left)/rect.width*state.tiff[dimension])));byId(key==='x'?'orthoX':'orthoY').value=String(ortho[key]);setZ(Math.floor((e.clientY-rect.top)/rect.height*state.tiff.depth));});
  document.addEventListener('keydown',event=>{
    if (byId('page-viewer').hidden || !state.tiff || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.target.closest('input,select,textarea,button,[contenteditable="true"],summary')) return;
    if(['ArrowLeft','ArrowDown','ArrowRight','ArrowUp'].includes(event.key)){event.preventDefault();setZ(state.z+(['ArrowRight','ArrowUp'].includes(event.key)?1:-1));}
  });
  let drag=null;
  ui.viewport.addEventListener('pointerdown',e=>{if(!state.tiff || e.button!==0)return;ui.viewport.focus({preventScroll:true});drag={x:e.clientX,y:e.clientY,currentX:e.clientX,currentY:e.clientY,left:ui.viewport.scrollLeft,top:ui.viewport.scrollTop,moved:false};ui.viewport.setPointerCapture(e.pointerId);});
  ui.viewport.addEventListener('pointerup',()=>{drag=null;});ui.viewport.addEventListener('pointercancel',()=>{drag=null;});ui.viewport.addEventListener('lostpointercapture',()=>{drag=null;});
  ui.viewport.addEventListener('pointermove',event=>{
    if(!state.tiff)return;
    if(drag){drag.currentX=event.clientX;drag.currentY=event.clientY;if(drag.moved||Math.hypot(event.clientX-drag.x,event.clientY-drag.y)>5){drag.moved=true;ui.viewport.scrollLeft=drag.left-(event.clientX-drag.x);ui.viewport.scrollTop=drag.top-(event.clientY-drag.y);rememberViewCenter();}}
    const rect=ui.imageCanvas.getBoundingClientRect(),x=Math.floor((event.clientX-rect.left)/rect.width*state.tiff.width),y=Math.floor((event.clientY-rect.top)/rect.height*state.tiff.height);
    if(x<0||y<0||x>=state.tiff.width||y>=state.tiff.height)return;
    const local=[x,y,state.z],global=local.map((v,i)=>v+state.volume.begin_vox_xyz[i]),nm=global.map((v,i)=>v*state.volume.resolution_nm[i]);
    ui.cursorReadout.textContent='Исходное значение пикселя: '+state.pixels[y*state.tiff.width+x]+' / 255\nЛокальные XYZ: '+fmt(local)+' · глобальные координаты вокселя: '+fmt(global)+'\nНачало вокселя (нм): '+fmt(nm);
  });
  ui.viewport.addEventListener('scroll',rememberViewCenter,{passive:true});
  window.addEventListener('resize',()=>{if(state.tiff&&!byId('page-viewer').hidden&&ui.viewport.clientWidth&&ui.viewport.clientHeight){if(state.needsFit){ui.fitButton.click();state.needsFit=false;}else{const anchor=viewportCenter(),point=state.viewCenter||imagePointAt(anchor);resizeView();placeImagePoint(point,anchor);}renderOrthos();}});
  window.ReviewViewer={
    get metadata(){return state.metadata;},get currentCase(){return state.currentCase;},get volume(){return state.volume;},
    get ready(){return Boolean(state.tiff);},get z(){return state.z;},get target(){return state.target;},get zoom(){return state.zoom;},get surface(){return surface;},get displayWindow(){return [state.black,state.white];},
    setZ,
    async gotoPoint(caseId,volumeId,pointNm){
      const requested=state.metadata?.cases.find(c=>c.case_id===caseId),volume=requested?.volumes.find(v=>v.volume_id===volumeId);
      if(!volume)throw new Error('Не найден объём для этой метки.');
      if(!state.tiff||state.currentCase?.case_id!==caseId||state.volume?.volume_id!==volumeId)await window.ReviewViewer.select(caseId,volumeId);
      if(!state.tiff||state.currentCase?.case_id!==caseId||state.volume?.volume_id!==volumeId)throw new Error('Не удалось открыть объём метки. Повторите переход.');
      const local=toLocal(pointNm);if(!inBounds(local))throw new Error('Метка находится вне выбранного объёма.');
      setZoom(Math.max(2,state.zoom));setZ(local[2]);
      placeImagePoint({x:local[0]+.5,y:local[1]+.5},viewportCenter());
      return local;
    },
    async select(id,volumeId,z){
      const requested=state.metadata?.cases.find(c=>c.case_id===id);if(!requested)return;
      if(volumeId&&!requested.volumes.some(v=>v.volume_id===volumeId))throw new Error('Указанный объём не принадлежит случаю '+id+'.');
      // Saved evidence may belong to a case outside the currently displayed pilot group.
      if(!Array.from(ui.caseSelect.options).some(option=>option.value===id)){
        const group=byId('caseGroup');if(group)group.value='all';
        ui.caseSelect.replaceChildren(...state.metadata.cases.map(c=>new Option(c.case_id,c.case_id)));
      }
      ui.caseSelect.value=id;return await selectCase(volumeId,z);
    }
  };
  if(document.readyState!=='complete')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
