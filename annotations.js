/* Researcher annotations are private to this browser; export backups are portable. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id), viewer = () => window.ReviewViewer;
  const params = new URLSearchParams(location.search), notesWindow = params.get('panel') === 'annotations';
  if (notesWindow) { document.body.classList.add('notes-window'); document.querySelector('#page-viewer h1').textContent = 'Отметки и свойства'; }
  const PREFS = 'microns-annotation-preferences-v1', JOURNAL = 'microns-annotation-pending-v1:';
  const labels = {contact:'Контакт', point:'Особенность', object:'Объект', uncertain:'Неопределённо', supported:'Признаки синапса поддержаны', rejected:'Признаки против синапса', note:'Не оценено'};
  const categories={unclassified:'Не классифицировано',suspected_synapse:'Предполагаемый синапс',possible_adhesion:'Возможная адгезия',unresolved_other:'Другое / не разрешено'};
  const exportButtonIds=['annotationsExportAll','annotationsExportAllImages','annotationsExportCase','annotationsExportComplete','annotationsExportCaseComplete'];
  let store, metadata, records = [], caseNotes = [], selectedId = params.get('annotation'), currentCase = '', pending = 0;
  let saveChain = Promise.resolve(), failures = [], deleted = null, refreshGeneration = 0, lastEditorId = null, refreshNeeded = false;
  let exportBusy=false;
  let notesPeer=null,followingMain=false,followAgain=false,undoImportAction=null;
  let channel; try { channel = new BroadcastChannel('microns-researcher-annotations-v1'); } catch {}
  const now = previous => new Date(Math.max(Date.now(),Date.parse(previous||'')+1||0)).toISOString(), byId = id => records.find(r => r.id === id);
  const changed = () => window.dispatchEvent(new Event('annotations:changed'));
  const caseRecords = () => records.filter(r => r.case_id === currentCase).sort((a,b)=>a.number-b.number);
  const mode = () => $('annotationMode').value;
  const visible = () => $('annotationsVisible').checked;
  const fmt = a => a.map(n=>Number(n.toFixed(2))).join(', ');
  const booleanPreferences=['overlayToggle','tCenter','tPre','tPost','annotationsVisible','surfaceContext','segmentation2D','segmentationBorders','surfaceSegmentation'];
  const numberPreferences={segmentationOpacity:70,surfaceContextOpacity:100,surfaceSegmentationOpacity:100};
  function readPreferences(){
    const result=Object.fromEntries(booleanPreferences.filter(id=>$(id)).map(id=>[id,$(id).checked]));
    for(const [id,max] of Object.entries(numberPreferences))if($(id))result[id]=Math.max(0,Math.min(max,Number($(id).value)));
    if($('surfaceContextMode'))result.surfaceContextMode=$('surfaceContextMode').value;
    return result;
  }
  function prefsSave() { try { localStorage.setItem(PREFS,JSON.stringify(readPreferences())); } catch {} }
  try { const preferences=JSON.parse(localStorage.getItem(PREFS)||'{}'); for(const [id,value] of Object.entries(preferences))if($(id)){if(booleanPreferences.includes(id)&&typeof value==='boolean')$(id).checked=value;else if(id in numberPreferences&&typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=numberPreferences[id])$(id).value=value;else if(id==='surfaceContextMode'&&['slice','full'].includes(value))$(id).value=value;} } catch {}
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
  function mainWindow(){
    try{const main=window.opener;return notesWindow&&main&&!main.closed&&main.location.origin===location.origin&&main.location.pathname===location.pathname&&!main.HandoffAnnotations?.isNotesWindow?main:null;}catch{return null;}
  }
  async function whenSettled(){let chain;do{chain=saveChain;await chain;}while(chain!==saveChain);}
  async function settleForAction(){await whenSettled();if(failures.length)throw new Error('Сначала повторите сохранение текущих изменений.');}
  function notifyNotes(){if(!notesWindow&&notesPeer&&!notesPeer.closed)try{notesPeer.HandoffAnnotations?.syncFromMain();}catch{}}
  function attachNotes(peer){if(!notesWindow&&peer?.opener===window&&notesPeer!==peer){notesPeer=peer;notifyNotes();}}
  async function syncFromMain(){
    if(!notesWindow||!store)return;
    if(followingMain){followAgain=true;return;}followingMain=true;
    try{do{
      followAgain=false;const main=mainWindow(),source=main?.HandoffAnnotations;if(!source?.store)break;
      main.HandoffAnnotations.attachNotes(window);await whenSettled();await source.whenSettled();
      const different=currentCase!==source.currentCase||selectedId!==source.selectedId;
      currentCase=source.currentCase;selectedId=source.selectedId;
      await refresh();renderEditor(different);renderCaseNotes(different);
      const view=main.ReviewViewer,description=`Основной вид: ${currentCase} · ${view.volume?.volume_id||''}`+(view.ready?` · Z ${view.z}`:' · загрузка…');
      let hint=$('notesMainView');if(!hint){hint=document.createElement('p');hint.id='notesMainView';hint.className='annotation-storage-note';document.querySelector('.annotation-savebar').before(hint);}hint.textContent=description;
      for(const id of exportButtonIds)if($(id))$(id).disabled=exportBusy||source.isExporting||(['annotationsExportAllImages','annotationsExportCase'].includes(id)&&!view.ready)||(id==='annotationsExportCaseComplete'&&!currentCase);
      const url=new URL(location.href);url.searchParams.set('case',currentCase);if(view.volume)url.searchParams.set('volume',view.volume.volume_id);history.replaceState(null,'',url);
    }while(followAgain);}catch(error){$('annotationSaveStatus').textContent='Не удалось обновить основную страницу: '+error.message;}finally{followingMain=false;}
  }
  async function runOnMain(action){
    if(exportBusy)return;
    const target=$('restoreResult'),main=mainWindow();
    if(!main?.HandoffAnnotations?.store){target.textContent='Откройте основную страницу и нажмите «Заметки в отдельном окне», чтобы сохранить её текущий вид.';target.classList.add('save-failed');return;}
    const buttons=[...exportButtonIds,'annotationsImport','annotationsImportCase'].map($).filter(Boolean);
    const source=main.document.getElementById('restoreResult');
    const mirror=()=>{
      target.classList.toggle('save-failed',source.classList.contains('save-failed'));target.textContent=[...source.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent).join('');
      const undo=main.document.getElementById('annotationsUndoImport');if(undo){const button=document.createElement('button');button.id='annotationsUndoImport';button.textContent=undo.textContent;button.disabled=undo.disabled;button.addEventListener('click',()=>runOnMain(api=>api.undoImport()));target.append(button);}
    };
    let observer;
    try{
      if(main.HandoffAnnotations.isExporting)throw new Error('Сохранение на основной странице ещё выполняется.');
      exportBusy=true;buttons.forEach(b=>b.disabled=true);target.classList.remove('save-failed');target.textContent='Синхронизируем с основной страницей…';
      await settleForAction();await main.HandoffAnnotations.settleForAction();await main.HandoffAnnotations.refresh();
      observer=new MutationObserver(mirror);observer.observe(source,{childList:true,subtree:true,characterData:true,attributes:true});
      await action(main.HandoffAnnotations);mirror();await syncFromMain();
    }catch(error){target.textContent='Не удалось выполнить действие: '+error.message;target.classList.add('save-failed');}
    finally{observer?.disconnect();exportBusy=false;buttons.forEach(b=>b.disabled=false);await syncFromMain();}
  }
  function updateLocal(record) { const i=records.findIndex(r=>r.id===record.id);if(i<0)records.push(record);else records[i]=record; }
  function updateLocalCase(record) { const i=caseNotes.findIndex(r=>r.case_id===record.case_id);if(i<0)caseNotes.push(record);else caseNotes[i]=record; }
  async function refresh() {
    if(!store)return;if(pending||failures.length){refreshNeeded=true;return;}
    const generation=++refreshGeneration;
    const [nextRecords,nextCases]=await Promise.all([store.getAll(),store.getCases()]);
    if(generation!==refreshGeneration||pending||failures.length)return;
    records=nextRecords;caseNotes=nextCases;renderList();renderEditor();renderCaseNotes();draw();changed();notifyNotes();
  }
  function locationInVolume(record,volume=viewer()?.volume) {
    if(!volume||record.case_id!==viewer()?.currentCase?.case_id)return null;
    const p=record.point_nm.map((n,i)=>n/volume.resolution_nm[i]-volume.begin_vox_xyz[i]);
    return p.every((n,i)=>n>=0&&n<volume.shape_xyz[i])?p:null;
  }
  function sectionRecords() { const z=viewer()?.z;return caseRecords().filter(r=>{const p=locationInVolume(r);return p&&Math.floor(p[2])===z;}); }
  function drawOn(canvas) {
    const v=viewer(),ctx=canvas.getContext('2d');
    ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,canvas.width,canvas.height);if(!v?.ready)return;
    const image=$('imageCanvas'),width=image.width*v.zoom,height=image.height*v.zoom,ratio=window.devicePixelRatio||1;
    const pixelsWide=Math.max(1,Math.round(width*ratio)),pixelsHigh=Math.max(1,Math.round(height*ratio));
    if(canvas.width!==pixelsWide)canvas.width=pixelsWide;if(canvas.height!==pixelsHigh)canvas.height=pixelsHigh;
    canvas.style.width=width+'px';canvas.style.height=height+'px';if(!visible())return;
    // Render labels at display resolution, independently of the enlarged EM pixels.
    ctx.save();ctx.setTransform(canvas.width/width,0,0,canvas.height/height,0,0);
    for(const record of sectionRecords()){
      const [x,y]=locationInVolume(record),selected=record.id===selectedId;
      MarkerStyles.draw(ctx,x*v.zoom,y*v.zoom,10,record.kind,record.number,selected);
    }
    ctx.restore();
  }
  function draw() {
    const v=viewer(), canvas=$('annotationCanvas');
    drawOn(canvas);
    if(v?.ready)v.surface?.setAnnotations(caseRecords(),visible(),selectedId);
  }
  function renderList() {
    if(!store)return;
    $('annotationCaseLabel').textContent=currentCase?'· '+currentCase:'';
    const items=caseRecords(),counts={supported:0,unresolved:0,adhesion:0,rejected:0,unclassified:0};
    for(const r of items){const category=r.observation_category||'unclassified';if(category==='unclassified')counts.unclassified++;else if(category==='possible_adhesion')counts.adhesion++;else if(category==='suspected_synapse'&&r.status==='supported')counts.supported++;else if(category==='suspected_synapse'&&r.status==='rejected')counts.rejected++;else counts.unresolved++;}
    const unresolved=counts.unresolved+counts.unclassified+items.filter(r=>r.observation_category==='possible_adhesion'&&['uncertain','note'].includes(r.status)).length;
    $('annotationCounter').textContent=`Меток: ${items.length} · признаки синапса поддержаны: ${counts.supported} · не разрешено: ${unresolved}`;
    $('annotationCounter').title=`Возможная адгезия: ${counts.adhesion}; признаки против синапса: ${counts.rejected}; без категории: ${counts.unclassified}. Форма метки сама по себе не подтверждает синапс.`;
    const nodes=items.map(record=>{
      const button=document.createElement('button');button.className='annotation-row';button.setAttribute('aria-pressed',String(record.id===selectedId));
      const title=document.createElement('strong'),chip=document.createElement('i');chip.className='marker-chip '+record.kind;title.append(chip,document.createTextNode(` ${record.number} · ${labels[record.kind]}`));
      const classification=document.createElement('small');classification.textContent=categories[record.observation_category||'unclassified']+' · '+labels[record.status];
      const hint=document.createElement('small');hint.textContent=record.notes||record.properties||'Без заметки';
      button.append(title,classification,hint);button.addEventListener('click',()=>select(record.id));return button;
    });
    if(!nodes.length){const empty=document.createElement('p');empty.className='hint';empty.textContent='Пока нет отметок. Выберите инструмент над изображениями и нажмите на нужное место.';nodes.push(empty);}
    $('annotationList').replaceChildren(...nodes);
  }
  const fields={annotationKind:'kind',annotationCategory:'observation_category',annotationVerdict:'status',annotationLocation:'location',annotationEvidenceRefs:'evidence_refs',annotationLabel:'label',annotationProperties:'properties',annotationNotes:'notes'};
  function renderEditor(force=false) {
    const record=byId(selectedId),valid=record?.case_id===currentCase;
    $('annotationEditor').hidden=!valid;$('annotationEditor').disabled=!valid;
    if(!valid){$('annotationSelection').textContent='Выберите отметку в списке или добавьте её в 2D / 3D.';lastEditorId=null;return;}
    $('annotationSelection').textContent=`N${record.number} · ${record.volume_id}${record.object_id?' · '+record.object_id:''}`;
    for(const [id,key] of Object.entries(fields))if($(id)&&(force||lastEditorId!==record.id||document.activeElement!==$(id)))$(id).value=record[key]||(key==='observation_category'?'unclassified':'');
    $('annotationCoordinates').textContent='Глобальные XYZ (нм): '+fmt(record.point_nm)+(record.segment_id?'\nСегмент v1300: '+record.segment_id:'');lastEditorId=record.id;
    $('previousMarkerProperties').hidden=!record.properties;
  }
  function select(id,go=false,announce=true) {
    const record=byId(id);if(!record)return;
    selectedId=id;renderList();renderEditor(true);draw();viewer()?.surface?.setSelectedAnnotation(id);viewer()?.surface?.focusAnnotation(record);
    if(go&&!notesWindow)goToSelected();
    if(announce&&notesWindow){const main=mainWindow()?.HandoffAnnotations;if(main?.currentCase===record.case_id)main.select(id,false,false);else syncFromMain();}
    notifyNotes();
  }
  async function goToSelected() {
    const record=byId(selectedId);if(!record)return;
    try{
      location.hash='viewer';
      const volume=locationInVolume(record)?viewer().volume.volume_id:record.volume_id;
      await viewer().gotoPoint(record.case_id,volume,record.point_nm);if(selectedId!==record.id)return;
      $('annotationsVisible').checked=true;prefsSave();viewer()?.surface?.focusAnnotation(record,true);draw();
      $('workspace').scrollIntoView({block:'start',behavior:'smooth'});
      $('annotationModeHelp').textContent=`Метка ${record.number} · ${viewer().volume.volume_id} · срез Z ${viewer().z}`;
    }catch(error){$('annotationSelection').textContent='Не удалось перейти: '+error.message;}
  }
  for(const [id,key] of Object.entries(fields))$(id)?.addEventListener('input',()=>{
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
    await enqueue(async()=>{const record=await store.add({...detail,kind,status:'uncertain',observation_category:'unclassified',location:'uncertain'});updateLocal(record);select(record.id);changed();broadcast({type:'changed'});});
  }
  function setMode() {
    const value=mode();viewer()?.surface?.setAnnotationMode(value==='point3d'?'point':value==='object3d'?'object':'off');
    $('viewport').classList.toggle('marking-2d',value.endsWith('2d'));
    $('annotationModeHelp').textContent={navigate:'Перетаскивайте изображения и модели. Нажмите на свою метку, чтобы открыть её свойства.',contact2d:'Нажмите на контакт в 2D: появится следующий номер. При необходимости добавьте заметку ниже.',point2d:'Нажмите на особенность в 2D и заполните её свойства в панели ниже.',point3d:'Нажмите на видимую поверхность в 3D. Перетаскивание по-прежнему вращает модель.',object3d:'Нажмите на объект в 3D для выбора и записи его свойств. При необходимости скройте плоскость XY.'}[value];
  }
  $('annotationMode').addEventListener('change',setMode);
  $('annotationsVisible').addEventListener('change',()=>{prefsSave();draw();});
  for(const id of ['overlayToggle','tCenter','tPre','tPost'])$(id).addEventListener('change',prefsSave);
  for(const id of ['segmentation2D','segmentationBorders','segmentationOpacity','surfaceContextMode','surfaceContextOpacity','surfaceSegmentation','surfaceSegmentationOpacity'])for(const event of ['change','input'])$(id)?.addEventListener(event,prefsSave);
  $('surfaceContext').addEventListener('change',()=>{prefsSave();viewer()?.surface?.setContextVisible($('surfaceContext').checked);});
  $('contextLimit').addEventListener('change',()=>{viewer()?.surface?.setContextLimit(Number($('contextLimit').value));try{localStorage.setItem('microns-nearby-count',$('contextLimit').value);}catch{}});
  try{const limit=localStorage.getItem('microns-nearby-count');if(['3','5','10'].includes(limit))$('contextLimit').value=limit;}catch{}
  window.addEventListener('annotations:contextstatus',event=>{if(event.detail.volume_id!==viewer()?.volume?.volume_id)return;const node=$('contextLoadStatus');node.textContent=event.detail.message+(event.detail.status==='error'?' Снимите и снова включите флажок, чтобы повторить.':'');node.classList.toggle('save-failed',event.detail.status==='error');});
  $('annotationGo').addEventListener('click',()=>notesWindow?runOnMain(main=>main.goTo(selectedId)):goToSelected());
  $('annotationDelete').addEventListener('click',()=>{
    const record=byId(selectedId);if(!record)return;
    enqueue(async()=>{deleted=await store.remove(record.id);viewer()?.surface?.forgetAnnotationFocus(record.number);records=records.filter(r=>r.id!==record.id);selectedId=null;$('annotationUndo').hidden=false;renderList();renderEditor();draw();changed();broadcast({type:'changed'});});
  });
  $('annotationUndo').addEventListener('click',()=>{if(!deleted)return;const record=deleted;enqueue(async()=>{const restored=await store.restore(record);updateLocal(restored);deleted=null;$('annotationUndo').hidden=true;select(restored.id);changed();broadcast({type:'changed'});});});
  let pointer;
  $('viewport').addEventListener('pointerdown',event=>{if(event.button===0&&viewer()?.ready)pointer={x:event.clientX,y:event.clientY,moved:false};});
  $('viewport').addEventListener('pointermove',event=>{if(pointer&&Math.hypot(event.clientX-pointer.x,event.clientY-pointer.y)>5)pointer.moved=true;});
  $('viewport').addEventListener('pointercancel',()=>pointer=null);
  $('viewport').addEventListener('pointerup',event=>{
    const start=pointer;pointer=null;if(!start||start.moved||Math.hypot(event.clientX-start.x,event.clientY-start.y)>5||!viewer()?.ready||!store)return;
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
    if(notesWindow&&mainWindow()?.HandoffAnnotations?.store){syncFromMain();return;}
    const id=viewer()?.currentCase?.case_id||'';
    if(currentCase!==id){currentCase=id;if(byId(selectedId)?.case_id!==id)selectedId=null;lastEditorId=null;renderList();renderEditor(true);renderCaseNotes(true);}
    $('annotationMode').disabled=!store||!viewer()?.ready;
    $('annotationsExportImage').disabled=!store||!viewer()?.ready;
    $('annotationsExportCase').disabled=!store||!viewer()?.ready;
    if($('annotationsExportComplete'))$('annotationsExportComplete').disabled=!store||exportBusy;
    if($('annotationsExportCaseComplete'))$('annotationsExportCaseComplete').disabled=!store||!currentCase||exportBusy;
    draw();notifyNotes();
  }
  window.addEventListener('review:volume',syncCase);
  window.addEventListener('review:position',()=>{
    syncCase();setMode();
    if(!notesWindow)try{localStorage.setItem('microns-last-view-v1',JSON.stringify({case_id:currentCase,volume_id:viewer().volume.volume_id,z:viewer().z}));}catch{}
  });
  window.addEventListener('review:display',draw);
  window.addEventListener('resize',() => drawOn($('annotationCanvas')));
  function watchPixelDensity(){
    matchMedia(`(resolution: ${window.devicePixelRatio||1}dppx)`).addEventListener('change',()=>{drawOn($('annotationCanvas'));watchPixelDensity();},{once:true});
  }
  watchPixelDensity();
  $('annotationPopout').addEventListener('click',()=>{
    const url=new URL(location.href);url.searchParams.set('panel','annotations');url.searchParams.set('case',currentCase);url.searchParams.delete('z');if(selectedId)url.searchParams.set('annotation',selectedId);url.hash='viewer';
    const opened=notesPeer&&!notesPeer.closed?notesPeer:window.open(url.href,'microns-annotation-properties-'+crypto.randomUUID(),'width=680,height=900');if(!opened)$('annotationModeHelp').textContent='Разрешите всплывающее окно для свойств или используйте панель ниже.';
    if(opened){attachNotes(opened);notifyNotes();opened.focus();}
  });
  channel?.addEventListener('message',async event=>{
    const message=event.data;if(message?.type==='changed')await refresh();
    if(message?.type==='main-ready'&&notesWindow)syncFromMain();
  });
  window.addEventListener('focus',()=>{refresh();syncFromMain();});
  window.addEventListener('annotations:ready',()=>{if(notesWindow)syncFromMain();else broadcast({type:'main-ready'});});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden){refresh();syncFromMain();}});
  $('annotationEditor').addEventListener('focusout',()=>setTimeout(async()=>{await whenSettled();await refresh();},0));
  function download(blob,name) { const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000); }
  async function backup(filter={}) {
    let chain;do{chain=saveChain;await chain;}while(chain!==saveChain);
    if(!failures.length)await refresh();
    const saved=await store.exportData(),draft=window.HandoffAssessment?.snapshot?.();
    if(draft){const rows=new Map(saved.review_records.map(r=>[r.id,r]));for(const row of draft.review_records)if(!rows.has(row.id)||row.updated_at>rows.get(row.id).updated_at)rows.set(row.id,row);saved.review_records=[...rows.values()];if(draft.reviewer_updated_at&&(!saved.reviewer_updated_at||draft.reviewer_updated_at>=saved.reviewer_updated_at)){saved.reviewer={...saved.reviewer,...draft.reviewer};saved.reviewer_updated_at=draft.reviewer_updated_at;}}
    return AnnotationsCore.makeBackup(metadata,records,caseNotes,filter,saved);
  }
  function completeEvidence(data){
    // A user may have imported earlier current-view exports. Every stored image is
    // part of a complete backup; origin is provenance, never an exclusion rule.
    return [...data.evidence];
  }
  async function imageBlob(withAnnotations=true,options={}) {
    const v=viewer(),image=$('imageCanvas');if(!v?.ready)throw new Error('Дождитесь загрузки 2D.');
    const segmentation=withAnnotations?('segmentation' in options?options.segmentation:window.SliceSegmentation?.captureFor(v.volume.volume_id,v.z)):null;
    const scale=Math.max(1,Math.floor(3072/Math.max(image.width,image.height))),left=32,top=120,canvas=document.createElement('canvas');
    canvas.width=image.width*scale+left*2;canvas.height=image.height*scale+top+150;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#18344b';ctx.font='bold 34px system-ui';ctx.fillText(`${currentCase} · ${v.volume.volume_id} · Z ${v.z}`,left,45);ctx.font='26px system-ui';ctx.fillText(`Глобальный Z ${v.volume.begin_vox_xyz[2]+v.z} · шаг XYZ ${v.volume.resolution_nm.join(' × ')} нм · яркость ${v.displayWindow.join('–')}`,left,85);
    ctx.imageSmoothingEnabled=false;ctx.drawImage(image,left,top,image.width*scale,image.height*scale);
    if(segmentation?.canvas&&segmentation.settings.volume_id===v.volume.volume_id&&segmentation.settings.local_z===v.z)ctx.drawImage(segmentation.canvas,left,top,image.width*scale,image.height*scale);
    // Draw vector symbols directly into the export, without enlarging the screen overlay.
    const unit=Math.max(1,Math.max(image.width,image.height)*scale/1200);
    if(withAnnotations&&$('overlayToggle').checked)for(const contact of v.currentCase.contacts)for(const [key,filter,suffix] of [['ctr_nm','tCenter',''],['pre_nm','tPre',' пре'],['post_nm','tPost',' пост']]){
      if(!contact[key]||!$(filter).checked)continue;
      const p=contact[key].map((n,i)=>Math.floor(n/v.volume.resolution_nm[i])-v.volume.begin_vox_xyz[i]);
      if(p[2]!==v.z||p.some((n,i)=>n<0||n>=v.volume.shape_xyz[i]))continue;
      const x=left+(p[0]+.5)*scale,y=top+(p[1]+.5)*scale;MarkerStyles.draw(ctx,x,y,6*unit,key,'',false,unit);
      ctx.font='bold '+13*unit+'px system-ui';ctx.lineWidth=3*unit;ctx.strokeStyle='#172632';ctx.strokeText(contact.contact_id+suffix,x+10*unit,y-10*unit);ctx.fillStyle=MarkerStyles.styles[key].color;ctx.fillText(contact.contact_id+suffix,x+10*unit,y-10*unit);
    }
    if(withAnnotations&&visible())for(const record of sectionRecords()){const [x,y]=locationInVolume(record);MarkerStyles.draw(ctx,left+x*scale,top+y*scale,10*unit,record.kind,record.number,record.id===selectedId,unit);}
    const y=top+image.height*scale+38,bar=500/v.volume.resolution_nm[0]*scale;ctx.strokeStyle='#18344b';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(left+bar,y);ctx.stroke();ctx.fillStyle='#18344b';ctx.font='26px system-ui';ctx.fillText('500 нм',left+bar+16,y+8);
    ctx.fillText(`Исходное изображение: ${image.width} × ${image.height} пикселей · без потери исходных пикселей`,left,y+43);ctx.font='24px system-ui';ctx.fillText('MICrONS Consortium (2025) · CC BY 4.0 · doi:10.1038/s41586-025-08790-w',left,y+82);
    return new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('Не удалось создать PNG.')),'image/png'));
  }
  async function exportFindings(scope,{includeImages=scope!=='all',complete=false}={}) {
    if(complete)includeImages=true;
    if(notesWindow)return runOnMain(main=>main.exportFindings(scope,{includeImages,complete}));
    if(!store||exportBusy)return;
    exportBusy=true;
    notifyNotes();
    const exportButtons=[...exportButtonIds,'neuroglancerExportAll','neuroglancerExportCase'].map($).filter(Boolean);
    exportButtons.forEach(button=>button.disabled=true);
    try{
      await settleForAction();if(notesPeer&&!notesPeer.closed)await notesPeer.HandoffAnnotations?.settleForAction();await refresh();
      const v=viewer(),frozenCase=currentCase,isCase=scope!=='all',filter=isCase?{case_id:frozenCase}:{};
      const frozenRecords=structuredClone(records),captured=[];
      // Current-view exports stay small. Complete exports also retain explicitly saved evidence.
      const currentReady=v?.ready&&v.surface?.modelReady&&!v.surface.contextLoading;
      if(includeImages&&(!complete||currentReady)){
        if(!v?.ready||!v.surface?.modelReady)throw new Error('Дождитесь загрузки 2D и 3D.');
        const panel=$('page-viewer'),wasHidden=panel.hidden;let shot;
        try{panel.hidden=false;shot=v.surface.snapshotEvidence();}catch(error){if(!complete)throw error;}finally{panel.hidden=wasHidden;}
        if(shot){
        const volume=structuredClone(v.volume),time=now(),z=v.z;
        const base={case_id:frozenCase,volume_id:volume.volume_id,local_z:z,global_z:volume.begin_vox_xyz[2]+z,created_at:time,updated_at:time,display_window:[...v.displayWindow],resolution_nm:[...volume.resolution_nm],capture_origin:'current_export',linked_to_slice:true,caption:''};
        if(shot.view.case_id!==frozenCase||shot.view.volume_id!==volume.volume_id||shot.view.local_z!==z)throw new Error('Дождитесь синхронизации 2D и 3D.');
        const sectionIds=frozenRecords.filter(r=>r.case_id===frozenCase&&r.point_nm.every((n,i)=>n>=volume.begin_vox_xyz[i]*volume.resolution_nm[i]&&n<volume.end_vox_xyz_exclusive[i]*volume.resolution_nm[i])&&Math.floor(r.point_nm[2]/volume.resolution_nm[2])-volume.begin_vox_xyz[2]===z).map(r=>r.id);
        const segmentation=window.SliceSegmentation?.captureFor(volume.volume_id,z)||null,segmentation2d=segmentation?{...segmentation.settings,included:true}:{included:false,source_version:'seg_m1300',volume_id:volume.volume_id,local_z:z};
        captured.push({meta:{...base,id:crypto.randomUUID(),source_view:'2d',annotation_ids:sectionIds,segmentation2d},annotated:imageBlob(true,{segmentation}),raw:imageBlob(false)});
        captured.push({meta:{...base,id:crypto.randomUUID(),source_view:'3d',annotation_ids:shot.view.annotation_ids,view_settings:shot.view},annotated:shot.blob,raw:Promise.resolve(null)});
        }
      }
      const neuroglancer=includeImages&&!complete&&scope==='all'?window.NeuroglancerLink?.captureCurrent(frozenCase):Promise.resolve(null);
      neuroglancer?.catch(()=>{});
      const pixels=Promise.all(captured.map(async item=>{const [annotated,raw]=await Promise.all([item.annotated,item.raw]);return{...item,annotated,raw};}));pixels.catch(()=>{});
      const settings={preferences:readPreferences(),annotation_mode:mode()};
      if(v?.ready){settings.last_view={case_id:frozenCase,volume_id:v.volume.volume_id,z:v.z};settings.display={zoom:v.zoom,black:v.displayWindow[0],white:v.displayWindow[1]};if(v.surface?.modelReady&&!v.surface.contextLoading)try{settings.surface_view=v.surface.getViewState();}catch{}}
      $('restoreResult').classList.remove('save-failed');$('restoreResult').textContent=complete?'Сохраняем все результаты и выбранные ранее доказательства…':includeImages?'Сохраняем результаты и изображения…':'Сохраняем точки и заметки…';
      try{await store.putSettings(settings);}catch{}
      const extraEvidence=[];
      for(const item of await pixels){
        if(item.meta.source_view==='3d'&&extraEvidence[0])item.meta.linked_evidence_id=extraEvidence[0].id;
        extraEvidence.push({...item.meta,annotated:item.annotated,raw:item.raw});
      }
      const full=await backup();full.settings=settings;full.settings_updated_at=now();
      const data=AnnotationsCore.makeBackup(metadata,full.annotations,full.cases,filter,full);
      const savedEvidence=complete?completeEvidence(data):[],images=new Map(savedEvidence.map(row=>[row.id,row]));
      for(const {annotated,raw,...meta} of extraEvidence)images.set(meta.id,meta);
      data.evidence=[...images.values()];
      if(complete)data.export_contents={mode:'complete_saved_evidence',saved_evidence_count:savedEvidence.length,current_evidence_count:extraEvidence.length,legacy_origin_count:savedEvidence.filter(r=>r.capture_origin==='legacy_unknown').length};
      const files=await store.exportFiles(filter,{backup:data,extraEvidence,includeImages});
      const ngShot=await neuroglancer;
      if(ngShot)files.push({name:`images/${frozenCase}-Neuroglancer-current.png`,bytes:new Uint8Array(await ngShot.arrayBuffer())});
      download(AnnotationsCore.zip(files),'MICrONS-'+(isCase?frozenCase:includeImages?'all-results-with-images':'all-results')+(complete?'-complete':'')+'-'+new Date().toISOString().slice(0,10)+'.zip');
      $('restoreResult').textContent=complete?`${isCase?'Полный архив случая сохранён':'Полный архив всех случаев сохранён'}: сохранённых доказательств ${savedEvidence.length}, текущих видов ${extraEvidence.length}. Сохранённые снимки из всех объёмов ${isCase?'этого случая':'всех случаев'} включены. Снимки и ссылки восстанавливаются из ZIP.`+(!extraEvidence.length?' Текущий просмотрщик ещё загружается; сохранены ранее выбранные доказательства.':'')+(data.export_contents.legacy_origin_count?' Снимки из прежних версий включены без изменения.':''):!includeImages?'Все точки и заметки сохранены. ZIP можно загрузить для продолжения работы.':(isCase?'Случай сохранён':'Все результаты сохранены')+`: снимков ${data.evidence.length+(ngShot?1:0)}. Только текущие 2D / 3D`+(ngShot?' и Neuroglancer.':isCase?'.':'. Откройте Neuroglancer перед сохранением, чтобы включить его текущий вид.');
    }catch(error){$('restoreResult').textContent='Не удалось сохранить: '+error.message;$('restoreResult').classList.add('save-failed');}
    finally{exportBusy=false;exportButtons.forEach(button=>button.disabled=false);notifyNotes();}
  }
  $('annotationsExportAll').addEventListener('click',()=>exportFindings('all'));
  $('annotationsExportAllImages').addEventListener('click',()=>exportFindings('all',{includeImages:true}));
  $('annotationsExportCase').addEventListener('click',()=>exportFindings('case'));
  $('annotationsExportImage').addEventListener('click',()=>exportFindings('image'));
  $('annotationsExportComplete')?.addEventListener('click',()=>exportFindings('all',{complete:true}));
  $('annotationsExportCaseComplete')?.addEventListener('click',()=>exportFindings('case',{complete:true}));
  async function importFindings(event,caseOnly=false){
    if(notesWindow)return runOnMain(main=>main.importFindings(event,caseOnly));
    const input=event.target;let file=input.files[0];if(!file||!store)return;
    const target=$('restoreResult');input.disabled=true;target.classList.remove('save-failed');target.textContent='Загружаем все метки и заметки…';
    const previousSettings={preferences:readPreferences(),annotation_mode:mode()};
    if(viewer()?.ready){const v=viewer();previousSettings.last_view={case_id:currentCase,volume_id:v.volume.volume_id,z:v.z};previousSettings.display={zoom:v.zoom,black:v.displayWindow[0],white:v.displayWindow[1]};if(v.surface?.modelReady&&!v.surface.contextLoading)try{previousSettings.surface_view=v.surface.getViewState();}catch{}}
    try{
      await settleForAction();if(notesPeer&&!notesPeer.closed)await notesPeer.HandoffAnnotations?.settleForAction();
      // File objects selected in the notes window belong to a different JavaScript realm.
      if(!(file instanceof Blob))file=new File([await file.arrayBuffer()],file.name,{type:file.type});
      const result=/\.zip$/i.test(file.name)?await store.importZIP(file,{policy:'restore',caseOnly}):await store.importData(JSON.parse(await file.text()),{policy:'restore',caseOnly});
      selectedId=null;lastEditorId=null;await refresh();await window.HandoffAssessment?.refresh();await window.HandoffEvidence?.refresh();broadcast({type:'changed'});
      const settings=result.settings||{},first=result.case_ids[0];
      if(!settings.last_view&&first){const c=metadata.cases.find(c=>c.case_id===first);settings.last_view={case_id:first,volume_id:c.volumes[0].volume_id,z:0};}
      let viewError='';try{await applySettings(settings);}catch(error){viewError=' Не удалось открыть сохранённый вид: '+error.message;}
      $('annotationsVisible').checked=true;prefsSave();draw();renderEditor(true);renderCaseNotes(true);
      const firstPoint=caseRecords().find(r=>r.id===settings.surface_view?.selected_annotation_id)||caseRecords()[0];if(firstPoint)select(firstPoint.id,false);
      location.hash='viewer';
      target.textContent=`Восстановление завершено: меток ${result.annotations_total}, с заметками ${result.notes_total}, снимков ${result.evidence_total-result.missingEvidence}. Все точки и заметки из файла загружены.`+(result.missingEvidence?' Для восстановления снимков загрузите исходный ZIP.':'')+viewError;
      const undo=document.createElement('button');undo.id='annotationsUndoImport';undo.textContent='Отменить загрузку';target.append(document.createTextNode(' '),undo);
      undoImportAction=async()=>{undo.disabled=true;try{await settleForAction();await store.undoImport();selectedId=null;lastEditorId=null;await refresh();await window.HandoffEvidence?.refresh();await applySettings(previousSettings);renderEditor(true);renderCaseNotes(true);broadcast({type:'changed'});target.textContent='Загрузка отменена. Восстановлены предыдущие точки и заметки.';}catch(error){target.textContent=error.message;target.classList.add('save-failed');}};undo.addEventListener('click',undoImportAction);
      target.scrollIntoView({block:'center',behavior:'smooth'});
    }catch(error){target.textContent='Файл не восстановлен: '+error.message;target.classList.add('save-failed');target.scrollIntoView({block:'center',behavior:'smooth'});}
    finally{input.disabled=false;input.value='';}
  }
  $('annotationsImport').addEventListener('change',event=>importFindings(event));
  $('annotationsImportCase').addEventListener('change',event=>importFindings(event,true));
  $('neuroglancerImportCase').addEventListener('click',()=>$('annotationsImportCase').click());
  async function applySettings(settings){
    if(settings.preferences){for(const [id,value]of Object.entries(settings.preferences))if($(id)){if(typeof value==='boolean')$(id).checked=value;else $(id).value=String(value);$(id).dispatchEvent(new Event('change'));}prefsSave();}
    if(settings.last_view){localStorage.setItem('microns-last-view-v1',JSON.stringify(settings.last_view));await viewer().select(settings.last_view.case_id,settings.last_view.volume_id,settings.last_view.z);}
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
    try{store=await AnnotationsCore.open(data);await recoverPending();await refresh();currentCase=viewer()?.currentCase?.case_id||'';if(params.get('annotation')&&byId(params.get('annotation'))?.case_id===currentCase)selectedId=params.get('annotation');for(const id of [...exportButtonIds,'annotationsImport','annotationsImportCase'])if($(id))$(id).disabled=false;syncCase();renderList();renderEditor(true);renderCaseNotes(true);saveStatus();window.dispatchEvent(new Event("annotations:ready"));}catch(error){$('annotationSaveStatus').textContent='Локальное сохранение недоступно: '+error.message+'. Разрешите хранение данных сайта и обновите страницу.';$('annotationSaveStatus').classList.add('save-failed');}
  }
  window.addEventListener('review:ready',event=>boot(event.detail),{once:true});
  if(viewer()?.metadata)boot(viewer().metadata);
  window.HandoffAnnotations={get visible(){return visible();},get captures2D(){return !!store&&['contact2d','point2d'].includes(mode());},get store(){return store;},get records(){return records;},get cases(){return caseNotes;},get currentCase(){return currentCase;},get selectedId(){return selectedId;},get isExporting(){return exportBusy;},isNotesWindow:notesWindow,enqueue,exportFindings,importFindings,imageBlob,select,refresh,whenSettled,settleForAction,attachNotes,syncFromMain,undoImport:()=>undoImportAction?.(),goTo:async id=>{select(id,false,false);await goToSelected();window.focus();}};
})();
