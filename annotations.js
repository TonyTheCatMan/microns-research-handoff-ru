/* Researcher annotations are private to this browser; export backups are portable. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id), viewer = () => window.ReviewViewer;
  const params = new URLSearchParams(location.search), notesWindow = params.get('panel') === 'annotations';
  if (notesWindow) { document.body.classList.add('notes-window'); document.querySelector('#page-viewer h1').textContent = 'Отметки и свойства'; }
  const PREFS = 'microns-annotation-preferences-v1', JOURNAL = 'microns-annotation-pending-v1:';
  const labels = {contact:'Контакт', point:'Особенность', object:'Объект', uncertain:'Не разрешено', supported:'Поддержано', rejected:'Не подтверждено', note:'Заметка'};
  let store, metadata, records = [], caseNotes = [], selectedId = params.get('annotation'), currentCase = '', pending = 0;
  let saveChain = Promise.resolve(), failures = [], deleted = null, refreshGeneration = 0, lastEditorId = null, refreshNeeded = false;
  let channel; try { channel = new BroadcastChannel('microns-researcher-annotations-v1'); } catch {}
  const now = previous => new Date(Math.max(Date.now(),Date.parse(previous||'')+1||0)).toISOString(), byId = id => records.find(r => r.id === id);
  const changed = () => window.dispatchEvent(new Event('annotations:changed'));
  const caseRecords = () => records.filter(r => r.case_id === currentCase).sort((a,b)=>a.number-b.number);
  const mode = () => $('annotationMode').value;
  const visible = () => $('annotationsVisible').checked;
  const fmt = a => a.map(n=>Number(n.toFixed(2))).join(', ');
  function prefsSave() { try { localStorage.setItem(PREFS,JSON.stringify(Object.fromEntries(['overlayToggle','tCenter','tPre','tPost','annotationsVisible','surfaceContext'].map(id=>[id,$(id).checked])))); } catch {} }
  try { const preferences=JSON.parse(localStorage.getItem(PREFS)||'{}'); for(const [id,value] of Object.entries(preferences))if($(id)&&typeof value==='boolean')$(id).checked=value; } catch {}
  const recoveryKey = (type,id) => JOURNAL + type + ':' + id;
  function journal(type,record) {
    const value = JSON.stringify({type,record,stamp:crypto.randomUUID()});
    try { localStorage.setItem(recoveryKey(type,type==='annotation'?record.id:record.case_id),value); } catch {}
    return value;
  }
  function forgetJournal(type,id,value) { try { const key=recoveryKey(type,id);if(localStorage.getItem(key)===value)localStorage.removeItem(key); } catch {} }
  function saveStatus() {
    const target=$('annotationSaveStatus');target.classList.toggle('save-failed',failures.length>0);
    target.textContent=failures.length?'Не все изменения сохранены. Экспортируйте резервную копию или повторите сохранение.':pending?'Сохраняем изменения…':store?'Все изменения сохранены в этом браузере.':'Открываем сохранённые отметки…';
    let retry=$('annotationRetry');if(failures.length&&!retry){retry=document.createElement('button');retry.id='annotationRetry';retry.textContent='Повторить сохранение';retry.addEventListener('click',()=>{const jobs=failures;failures=[];jobs.forEach(enqueue);});target.after(retry);}if(retry)retry.hidden=!failures.length;
  }
  function enqueue(job) {
    pending++;saveStatus();
    saveChain=saveChain.then(async()=>{try{await job();}catch(error){failures.push(job);$('annotationModeHelp').textContent='Ошибка сохранения: '+error.message;}finally{pending--;saveStatus();if(!pending&&!failures.length&&refreshNeeded){refreshNeeded=false;queueMicrotask(()=>refresh());}}});
    return saveChain;
  }
  function broadcast(data) { channel?.postMessage(data); }
  function updateLocal(record) { const i=records.findIndex(r=>r.id===record.id);if(i<0)records.push(record);else records[i]=record; }
  function updateLocalCase(record) { const i=caseNotes.findIndex(r=>r.case_id===record.case_id);if(i<0)caseNotes.push(record);else caseNotes[i]=record; }
  async function refresh() {
    if(!store)return;if(pending||failures.length){refreshNeeded=true;return;}
    const generation=++refreshGeneration;
    const [nextRecords,nextCases]=await Promise.all([store.getAll(),store.getCases()]);
    if(generation!==refreshGeneration||pending||failures.length)return;
    records=nextRecords;caseNotes=nextCases;renderList();renderEditor();renderCaseNotes();draw();changed();
  }
  function locationInVolume(record,volume=viewer()?.volume) {
    if(!volume||record.case_id!==viewer()?.currentCase?.case_id)return null;
    const p=record.point_nm.map((n,i)=>n/volume.resolution_nm[i]-volume.begin_vox_xyz[i]);
    return p.every((n,i)=>n>=0&&n<volume.shape_xyz[i])?p:null;
  }
  function sectionRecords() { const z=viewer()?.z;return caseRecords().filter(r=>{const p=locationInVolume(r);return p&&Math.floor(p[2])===z;}); }
  function drawOn(canvas,force=false,scale=viewer()?.zoom||1) {
    const v=viewer();if(!v?.ready)return;
    const ctx=canvas.getContext('2d');ctx.clearRect(0,0,canvas.width,canvas.height);if(!force&&!visible())return;
    for(const record of sectionRecords()){
      const [x,y]=locationInVolume(record),selected=record.id===selectedId;
      MarkerStyles.draw(ctx,x,y,10/scale,record.kind,record.number,selected,1/scale);
    }
  }
  function draw() {
    const v=viewer(), canvas=$('annotationCanvas');
    if(!v?.ready){canvas.getContext('2d').clearRect(0,0,canvas.width,canvas.height);return;}
    const image=$('imageCanvas');if(canvas.width!==image.width)canvas.width=image.width;if(canvas.height!==image.height)canvas.height=image.height;
    canvas.style.width=image.style.width;canvas.style.height=image.style.height;drawOn(canvas);
    v.surface?.setAnnotations(caseRecords(),visible(),selectedId);
  }
  function renderList() {
    if(!store)return;
    $('annotationCaseLabel').textContent=currentCase?'· '+currentCase:'';
    const items=caseRecords(),contacts=items.filter(r=>r.kind==='contact'),counts={supported:0,uncertain:0,rejected:0,note:0};contacts.forEach(r=>counts[r.status]++);
    $('annotationCounter').textContent=`Контакты: ${contacts.length}`;
    const nodes=items.map(record=>{
      const button=document.createElement('button');button.className='annotation-row';button.setAttribute('aria-pressed',String(record.id===selectedId));
      const title=document.createElement('strong'),chip=document.createElement('i');chip.className='marker-chip '+record.kind;title.append(chip,document.createTextNode(` ${record.number} · ${labels[record.kind]}`));
      const hint=document.createElement('small');hint.textContent=record.notes||record.properties||'Без заметки';
      button.append(title,hint);button.addEventListener('click',()=>select(record.id,true));return button;
    });
    if(!nodes.length){const empty=document.createElement('p');empty.className='hint';empty.textContent='Пока нет отметок. Выберите инструмент над изображениями и нажмите на нужное место.';nodes.push(empty);}
    $('annotationList').replaceChildren(...nodes);
  }
  const fields={annotationKind:'kind',annotationVerdict:'status',annotationLocation:'location',annotationLabel:'label',annotationProperties:'properties',annotationNotes:'notes'};
  function renderEditor(force=false) {
    const record=byId(selectedId),valid=record?.case_id===currentCase;
    $('annotationEditor').hidden=!valid;$('annotationEditor').disabled=!valid;
    if(!valid){$('annotationSelection').textContent='Выберите отметку в списке или добавьте её в 2D / 3D.';lastEditorId=null;return;}
    $('annotationSelection').textContent=`N${record.number} · ${record.volume_id}${record.object_id?' · '+record.object_id:''}`;
    const editing=$('annotationEditor').contains(document.activeElement);
    if(force||lastEditorId!==record.id||!editing)for(const [id,key] of Object.entries(fields))$(id).value=record[key]||'';
    $('annotationCoordinates').textContent='Глобальные XYZ (нм): '+fmt(record.point_nm)+(record.segment_id?'\nСегмент v1300: '+record.segment_id:'');lastEditorId=record.id;
    $('previousMarkerProperties').hidden=!record.properties;
  }
  function select(id,go=false,announce=true) {
    const record=byId(id);if(!record)return;
    selectedId=id;renderList();renderEditor(true);draw();viewer()?.surface?.setSelectedAnnotation(id);viewer()?.surface?.focusAnnotation(record);
    if(go&&!notesWindow)goToSelected();
    if(announce)broadcast({type:'focus',case_id:record.case_id,id});
  }
  async function goToSelected() {
    const record=byId(selectedId);if(!record)return;
    const volume=locationInVolume(record)?viewer().volume.volume_id:record.volume_id;
    await viewer().gotoPoint(record.case_id,volume,record.point_nm);draw();
  }
  for(const [id,key] of Object.entries(fields))$(id).addEventListener('input',()=>{
    const record=byId(selectedId);if(!record||!store)return;
    record[key]=$(id).value;record.updated_at=now(record.updated_at);const snapshot=structuredClone(record),token=journal('annotation',snapshot);
    renderList();draw();changed();
    enqueue(async()=>{const current=byId(snapshot.id);if(!current)return;const saved=await store.update(snapshot.id,{[key]:current[key]});if(current.updated_at<=saved.updated_at)current.updated_at=saved.updated_at;forgetJournal('annotation',snapshot.id,token);broadcast({type:'changed'});});
  });
  const caseFields={caseNotes:'notes',caseCoverage:'coverage',caseInspected:'inspected_regions',caseExtraExtent:'extra_extent'};
  function renderCaseNotes(force=false) {
    const data=caseNotes.find(r=>r.case_id===currentCase)||{};
    for(const [id,key] of Object.entries(caseFields)){if(force||document.activeElement!==$(id))$(id).value=data[key]||(key==='coverage'?'uncertain':'');$(id).disabled=!store||!currentCase;}
  }
  for(const [id,key] of Object.entries(caseFields))$(id).addEventListener('input',()=>{
    if(!store||!currentCase)return;
    const previous=caseNotes.find(r=>r.case_id===currentCase)||{case_id:currentCase,notes:'',coverage:'uncertain',inspected_regions:'',extra_extent:'',created_at:now()};
    const record={...previous,[key]:$(id).value,updated_at:now(previous.updated_at)};updateLocalCase(record);const token=journal('case',record);changed();
    enqueue(async()=>{const current=caseNotes.find(r=>r.case_id===record.case_id);if(!current)return;await store.putCase({case_id:record.case_id,[key]:current[key]});forgetJournal('case',record.case_id,token);broadcast({type:'changed'});});
  });
  async function addPoint(detail,kind) {
    if(!store||!viewer()?.ready)return;
    if(kind==='object'){
      const existing=caseRecords().find(r=>r.kind==='object'&&(detail.segment_id?r.segment_id===detail.segment_id:r.object_id===detail.object_id&&r.volume_id===detail.volume_id));
      if(existing){select(existing.id);return;}
    }
    await enqueue(async()=>{const record=await store.add({...detail,kind,status:kind==='contact'?'uncertain':'note',location:'uncertain'});updateLocal(record);select(record.id);changed();broadcast({type:'changed'});});
  }
  function setMode() {
    const value=mode();viewer()?.surface?.setAnnotationMode(value==='point3d'?'point':value==='object3d'?'object':'off');
    $('viewport').classList.toggle('marking-2d',value.endsWith('2d'));
    $('annotationModeHelp').textContent={navigate:'Перетаскивайте изображения и модели. Нажмите на свою метку, чтобы открыть её свойства.',contact2d:'Нажмите на контакт в 2D: появится следующий номер. При необходимости добавьте заметку ниже.',point2d:'Нажмите на особенность в 2D и заполните её свойства в панели ниже.',point3d:'Нажмите на видимую поверхность в 3D. Перетаскивание по-прежнему вращает модель.',object3d:'Нажмите на объект в 3D для выбора и записи его свойств. При необходимости скройте плоскость XY.'}[value];
  }
  $('annotationMode').addEventListener('change',setMode);
  $('annotationsVisible').addEventListener('change',()=>{prefsSave();draw();});
  for(const id of ['overlayToggle','tCenter','tPre','tPost'])$(id).addEventListener('change',prefsSave);
  $('surfaceContext').addEventListener('change',()=>{prefsSave();viewer()?.surface?.setContextVisible($('surfaceContext').checked);});
  $('contextLimit').addEventListener('change',()=>{viewer()?.surface?.setContextLimit(Number($('contextLimit').value));try{localStorage.setItem('microns-nearby-count',$('contextLimit').value);}catch{}});
  try{const limit=localStorage.getItem('microns-nearby-count');if(['3','5','10'].includes(limit))$('contextLimit').value=limit;}catch{}
  window.addEventListener('annotations:contextstatus',event=>{if(event.detail.volume_id!==viewer()?.volume?.volume_id)return;const node=$('contextLoadStatus');node.textContent=event.detail.message+(event.detail.status==='error'?' Снимите и снова включите флажок, чтобы повторить.':'');node.classList.toggle('save-failed',event.detail.status==='error');});
  $('annotationGo').addEventListener('click',()=>notesWindow?broadcast({type:'go',id:selectedId}):goToSelected());
  $('annotationDelete').addEventListener('click',()=>{
    const record=byId(selectedId);if(!record)return;
    enqueue(async()=>{deleted=await store.remove(record.id);viewer()?.surface?.forgetAnnotationFocus(record.number);records=records.filter(r=>r.id!==record.id);selectedId=null;$('annotationUndo').hidden=false;renderList();renderEditor();draw();changed();broadcast({type:'changed'});});
  });
  $('annotationUndo').addEventListener('click',()=>{if(!deleted)return;const record=deleted;enqueue(async()=>{const restored=await store.restore(record);updateLocal(restored);deleted=null;$('annotationUndo').hidden=true;select(restored.id);changed();broadcast({type:'changed'});});});
  let pointer;
  $('viewport').addEventListener('pointerdown',event=>{if(event.button===0&&viewer()?.ready)pointer={x:event.clientX,y:event.clientY};});
  $('viewport').addEventListener('pointercancel',()=>pointer=null);
  $('viewport').addEventListener('pointerup',event=>{
    const start=pointer;pointer=null;if(!start||Math.hypot(event.clientX-start.x,event.clientY-start.y)>5||!viewer()?.ready||!store)return;
    const v=viewer(),image=$('imageCanvas'),rect=image.getBoundingClientRect(),x=(event.clientX-rect.left)/rect.width*image.width,y=(event.clientY-rect.top)/rect.height*image.height;
    if(x<0||y<0||x>=image.width||y>=image.height)return;
    const near=visible()?sectionRecords().find(r=>{const p=locationInVolume(r);return Math.hypot(p[0]-x,p[1]-y)*v.zoom<12;}):null;
    if(near){select(near.id);return;}if(!['contact2d','point2d'].includes(mode()))return;
    const point=[Math.floor(x)+.5,Math.floor(y)+.5,v.z+.5].map((n,i)=>(n+v.volume.begin_vox_xyz[i])*v.volume.resolution_nm[i]);
    addPoint({case_id:v.currentCase.case_id,volume_id:v.volume.volume_id,point_nm:point,source_view:'2d',segment_id:null,object_id:null},mode()==='contact2d'?'contact':'point');
  });
  window.addEventListener('annotations:pick3d',event=>addPoint({...event.detail,source_view:'3d'},mode()==='object3d'?'object':'point'));
  window.addEventListener('annotations:select3d',event=>select(event.detail.id));
  window.addEventListener('annotations:pick3d-miss',event=>$('annotationModeHelp').textContent=event.detail?.message||'Нажмите на видимую поверхность. При необходимости скройте плоскость XY.');
  window.addEventListener('annotations:surface-ready',()=>{setMode();draw();viewer()?.surface?.setContextLimit(Number($('contextLimit').value));viewer()?.surface?.setContextVisible($('surfaceContext').checked);});
  function syncCase() {
    const id=viewer()?.currentCase?.case_id||'';
    if(currentCase!==id){currentCase=id;if(byId(selectedId)?.case_id!==id)selectedId=null;lastEditorId=null;renderList();renderEditor(true);renderCaseNotes(true);}
    $('annotationMode').disabled=!store||!viewer()?.ready;
    $('annotationsExportImage').disabled=!store||!viewer()?.ready;
    $('annotationsExportCase').disabled=!store||!viewer()?.ready;
    draw();
  }
  window.addEventListener('review:volume',syncCase);
  window.addEventListener('review:position',()=>{
    syncCase();setMode();
    if(!notesWindow)try{localStorage.setItem('microns-last-view-v1',JSON.stringify({case_id:currentCase,volume_id:viewer().volume.volume_id,z:viewer().z}));}catch{}
  });
  window.addEventListener('review:display',draw);
  $('annotationPopout').addEventListener('click',()=>{
    const url=new URL(location.href);url.searchParams.set('panel','annotations');url.searchParams.set('case',currentCase);url.searchParams.delete('z');if(selectedId)url.searchParams.set('annotation',selectedId);url.hash='viewer';
    const opened=window.open(url.href,'microns-annotation-properties','width=680,height=900');if(!opened)$('annotationModeHelp').textContent='Разрешите всплывающее окно для свойств или используйте панель ниже.';
  });
  channel?.addEventListener('message',async event=>{
    const message=event.data;if(message?.type==='changed')await refresh();
    if(message?.type==='focus'&&notesWindow){if(viewer()?.currentCase?.case_id!==message.case_id)window.HandoffUI.choose(message.case_id);await refresh();select(message.id,false,false);}
    if(message?.type==='go'&&!notesWindow){await refresh();const r=byId(message.id);if(r){if(currentCase!==r.case_id)window.HandoffUI.choose(r.case_id);select(r.id,false,false);await goToSelected();}}
  });
  window.addEventListener('focus',()=>refresh());
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
  function download(blob,name) { const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000); }
  async function backup(filter={}) {
    let chain;do{chain=saveChain;await chain;}while(chain!==saveChain);
    if(!failures.length)await refresh();
    const saved=await store.exportData(),draft=window.HandoffAssessment?.snapshot?.();
    if(draft){const rows=new Map(saved.review_records.map(r=>[r.id,r]));for(const row of draft.review_records)if(!rows.has(row.id)||row.updated_at>rows.get(row.id).updated_at)rows.set(row.id,row);saved.review_records=[...rows.values()];if(draft.reviewer_updated_at&&(!saved.reviewer_updated_at||draft.reviewer_updated_at>=saved.reviewer_updated_at)){saved.reviewer={...saved.reviewer,...draft.reviewer};saved.reviewer_updated_at=draft.reviewer_updated_at;}}
    return AnnotationsCore.makeBackup(metadata,records,caseNotes,filter,saved);
  }
  async function imageBlob(withAnnotations=true) {
    const v=viewer(),image=$('imageCanvas'),scale=2,canvas=document.createElement('canvas');canvas.width=Math.max(1100,image.width*scale+32);canvas.height=image.height*scale+170;
    const ctx=canvas.getContext('2d'),left=Math.round((canvas.width-image.width*scale)/2),top=65;ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#18344b';ctx.font='bold 18px system-ui';ctx.fillText(`${currentCase} · ${v.volume.volume_id} · Z ${v.z}`,16,28);ctx.font='14px system-ui';ctx.fillText(`Глобальный Z ${v.volume.begin_vox_xyz[2]+v.z} · шаг XYZ ${v.volume.resolution_nm.join(' × ')} нм · яркость ${v.displayWindow.join('–')}`,16,50);
    ctx.imageSmoothingEnabled=false;ctx.drawImage(image,left,top,image.width*scale,image.height*scale);
    if(withAnnotations&&$('overlayToggle').checked)ctx.drawImage($('overlayCanvas'),left,top,image.width*scale,image.height*scale);
    if(withAnnotations){const marks=document.createElement('canvas');marks.width=image.width;marks.height=image.height;drawOn(marks,true,scale);ctx.drawImage(marks,left,top,image.width*scale,image.height*scale);}
    const y=top+image.height*scale+25,bar=500/v.volume.resolution_nm[0]*scale;ctx.strokeStyle='#18344b';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(16,y);ctx.lineTo(16+bar,y);ctx.stroke();ctx.fillText('500 нм',26+bar,y+5);ctx.fillText(withAnnotations?'Метки: '+sectionRecords().map(r=>'N'+r.number).join(', ').slice(0,110):'Изображение без навигационных и пользовательских меток',16,y+27);ctx.font='12px system-ui';ctx.fillText('MICrONS Consortium (2025) · CC BY 4.0 · doi:10.1038/s41586-025-08790-w',16,y+50);ctx.fillText('Точные координаты, свойства и наблюдения приложены в JSON и CSV. Исходные пиксели TIFF сохранены.',16,y+70);
    return new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('Не удалось создать PNG.')),'image/png'));
  }
  async function exportFindings(scope) {
    if(!store)return;
    try{
      const v=viewer(),frozenCase=currentCase,isCase=scope!=='all',filter=isCase?{case_id:frozenCase}:{};
      const frozenRecords=structuredClone(records),captured=[];
      // Capture BOTH views before awaiting storage, so navigating cannot change this case export.
      if(isCase){
        if(!v?.ready||!v.surface?.modelReady)throw new Error('Дождитесь загрузки 2D и 3D.');
        const shot=v.surface.snapshotEvidence(),volume=structuredClone(v.volume),time=now(),z=v.z;
        const base={case_id:frozenCase,volume_id:volume.volume_id,local_z:z,global_z:volume.begin_vox_xyz[2]+z,created_at:time,updated_at:time,display_window:[...v.displayWindow],resolution_nm:[...volume.resolution_nm],linked_to_slice:true,caption:'',annotation_ids:frozenRecords.filter(r=>r.case_id===frozenCase).map(r=>r.id)};
        captured.push({meta:{...base,id:crypto.randomUUID(),source_view:'2d'},annotated:imageBlob(true),raw:imageBlob(false)});
        captured.push({meta:{...base,id:crypto.randomUUID(),source_view:'3d',view_settings:shot.view},annotated:shot.blob,raw:Promise.resolve(null)});
      }
      const settings={preferences:Object.fromEntries(['overlayToggle','tCenter','tPre','tPost','annotationsVisible','surfaceContext'].map(id=>[id,$(id).checked])),annotation_mode:mode()};
      if(v?.ready){settings.last_view={case_id:frozenCase,volume_id:v.volume.volume_id,z:v.z};settings.display={zoom:v.zoom,black:v.displayWindow[0],white:v.displayWindow[1]};if(v.surface?.modelReady&&!v.surface.contextLoading)settings.surface_view=v.surface.getViewState();}
      $('restoreResult').classList.remove('save-failed');$('restoreResult').textContent='Сохраняем результаты'+(isCase?' и оба изображения':'')+'…';
      try{await store.putSettings(settings);}catch{}
      const full=await backup();full.settings=settings;full.settings_updated_at=now();
      const data=AnnotationsCore.makeBackup(metadata,isCase?frozenRecords:full.annotations,full.cases,filter,full),extraEvidence=[];
      for(const item of captured){const [annotated,raw]=await Promise.all([item.annotated,item.raw]);data.evidence.push(item.meta);extraEvidence.push({...item.meta,annotated,raw});}
      const files=await store.exportFiles(filter,{backup:data,extraEvidence});
      download(AnnotationsCore.zip(files),'MICrONS-'+(isCase?frozenCase:'all-results')+'-'+new Date().toISOString().slice(0,10)+'.zip');
      $('restoreResult').textContent=isCase?'Случай сохранён: заметки, текущий срез 2D и текущий вид 3D.':'Результаты сохранены. ZIP можно загрузить целиком для продолжения работы.';
    }catch(error){$('restoreResult').textContent='Не удалось сохранить: '+error.message;$('restoreResult').classList.add('save-failed');}
  }
  $('annotationsExportAll').addEventListener('click',()=>exportFindings('all'));
  $('annotationsExportCase').addEventListener('click',()=>exportFindings('case'));
  $('annotationsExportImage').addEventListener('click',()=>exportFindings('image'));
  $('annotationsImport').addEventListener('change',async event=>{
    const file=event.target.files[0];if(!file||!store)return;
    async function restore(policy){
      const target=$('restoreResult');target.classList.remove('save-failed');target.textContent='Восстанавливаем сохранённые результаты…';
      try{
        let chain;do{chain=saveChain;await chain;}while(chain!==saveChain);if(failures.length)throw new Error('Сначала повторите сохранение текущих изменений.');
        const result=/\.zip$/i.test(file.name)?await store.importZIP(file,{policy}):await store.importData(JSON.parse(await file.text()),{policy});
        await refresh();await window.HandoffAssessment?.refresh();await window.HandoffEvidence?.refresh();broadcast({type:'changed'});
        target.textContent=`Восстановление завершено: новых меток ${result.added||0}, снимков ${result.evidence_added||0}. Можно продолжать работу.`+(result.missingEvidence?' Для восстановления снимков загрузите исходный ZIP.':'');
        if(result.settings_updated)try{await applySettings(await store.getSettings());}catch(error){const note=document.createElement('p');note.textContent='Результаты восстановлены. Не удалось открыть сохранённый вид: '+error.message;target.append(note);}
        if(result.conflicts?.length){const warning=document.createElement('p');warning.textContent=`Сохранено существующих отличающихся записей: ${result.conflicts.length}. Можно применить только более новые записи из этой копии.`;target.append(warning);const button=document.createElement('button');button.textContent='Применить более новые записи из этой копии';button.addEventListener('click',()=>restore('newer'));target.append(button);}
      }catch(error){target.textContent='Файл не восстановлен: '+error.message;target.classList.add('save-failed');}
    }
    await restore('keep-existing');event.target.value='';
  });
  async function applySettings(settings){
    if(settings.preferences){for(const [id,value]of Object.entries(settings.preferences))if($(id)){$(id).checked=value;$(id).dispatchEvent(new Event('change'));}prefsSave();}
    if(settings.last_view){localStorage.setItem('microns-last-view-v1',JSON.stringify(settings.last_view));if(!notesWindow)await viewer().select(settings.last_view.case_id,settings.last_view.volume_id,settings.last_view.z);}
    if(settings.annotation_mode){$('annotationMode').value=settings.annotation_mode;setMode();}
    if(settings.display&&!notesWindow){const zoom=String(settings.display.zoom);if(![...$('zoomSelect').options].some(o=>o.value===zoom))$('zoomSelect').add(new Option('Сохранённый масштаб · '+Math.round(settings.display.zoom*100)+'%',zoom));$('zoomSelect').value=zoom;$('zoomSelect').dispatchEvent(new Event('change'));$('blackInput').value=settings.display.black;$('whiteInput').value=settings.display.white;$('blackInput').dispatchEvent(new Event('change'));}
    if(settings.surface_view&&!notesWindow&&viewer()?.ready&&settings.surface_view.case_id===viewer().currentCase.case_id&&settings.surface_view.volume_id===viewer().volume.volume_id&&settings.surface_view.local_z===viewer().z)await viewer().surface.restoreEvidence(settings.surface_view);
  }
  async function recoverPending() {
    const keys=[];try{for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(key.startsWith(JOURNAL))keys.push(key);}}catch{return;}
    for(const key of keys){try{const text=localStorage.getItem(key),entry=JSON.parse(text);const draft=AnnotationsCore.makeBackup(metadata,entry.type==='annotation'?[entry.record]:[],entry.type==='case'?[entry.record]:[]);await store.importData(draft,{policy:'newer'});if(localStorage.getItem(key)===text)localStorage.removeItem(key);}catch(error){$('annotationModeHelp').textContent='Некоторые несохранённые изменения требуют восстановления: '+error.message;}}
  }
  async function boot(data) {
    metadata=data;
    try{store=await AnnotationsCore.open(data);await recoverPending();await refresh();currentCase=viewer()?.currentCase?.case_id||'';if(params.get('annotation')&&byId(params.get('annotation'))?.case_id===currentCase)selectedId=params.get('annotation');for(const id of ['annotationsExportAll','annotationsExportCase','annotationsImport'])$(id).disabled=false;syncCase();renderList();renderEditor(true);renderCaseNotes(true);saveStatus();window.dispatchEvent(new Event("annotations:ready"));}catch(error){$('annotationSaveStatus').textContent='Локальное сохранение недоступно: '+error.message+'. Разрешите хранение данных сайта и обновите страницу.';$('annotationSaveStatus').classList.add('save-failed');}
  }
  window.addEventListener('review:ready',event=>boot(event.detail),{once:true});
  if(viewer()?.metadata)boot(viewer().metadata);
  window.HandoffAnnotations={get visible(){return visible();},get captures2D(){return !!store&&['contact2d','point2d'].includes(mode());},get store(){return store;},get records(){return records;},get cases(){return caseNotes;},get currentCase(){return currentCase;},get selectedId(){return selectedId;},enqueue,exportFindings,imageBlob,select,refresh};
})();
