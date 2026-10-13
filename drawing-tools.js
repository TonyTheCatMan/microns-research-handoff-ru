/* Familiar drawing interactions from the second-paper review, adapted to case records. */
(() => {
  'use strict';
  const $=id=>document.getElementById(id),api=()=>window.HandoffAnnotations,v=()=>window.ReviewViewer,G=window.HandoffDrawingGeometry;
  const clone=value=>structuredClone(value),viewport=$('viewport'),draftKey='microns-drawing-draft-v1',histories=new Map();
  const hints={select:'Нажмите на рисунок. Перетащите его целиком или за белые узлы. E: заметка; Delete: удалить.',trace:'Щёлкайте вдоль структуры. Enter: завершить. Первая точка или «Замкнуть трассу»: замкнуть. Точки сохраняются по мере добавления.',freehand:'Удерживайте кнопку мыши и обведите участок. Отпустите, чтобы сохранить.',arrow:'Протяните стрелку к интересующему участку. Отпустите, чтобы сохранить.',ellipse:'Протяните от одного угла области к противоположному. Shift после начала рисования: круг.',roi:'Протяните рамку вокруг интересующей области.',distance:'Протяните между двумя точками. Длина показана в микрометрах.'};
  const shortcuts={h:'navigate',v:'select',a:'arrow',p:'point2d',t:'trace',f:'freehand',b:'roi',o:'ellipse',d:'distance'};
  let gesture=null,draft=null,preview=null,work=Promise.resolve(),lastScope='',lastMode='navigate',replaying=false,restoredScope='',intent=0;
  const mode=()=>$('annotationMode').value,scope=()=>v()?.volume?[v().currentCase.case_id,v().volume.volume_id,v().z].join(':'):'';
  const isDrawing=record=>!!record?.geometry;
  const selected=()=>api()?.records.find(r=>r.id===api().selectedId);
  const ownMarks=()=>api()?.visible?api().records.filter(r=>r.geometry&&r.case_id===v()?.currentCase?.case_id&&r.volume_id===v()?.volume?.volume_id&&r.geometry.slice_index===v().volume.begin_vox_xyz[2]+v().z):[];
  const rectangle=()=>{const r=$('imageCanvas').getBoundingClientRect();return {x:r.left,y:r.top,w:r.width,h:r.height};};
  function mainDrawing(){try{return api()?.isNotesWindow&&window.opener&&!window.opener.closed&&window.HandoffCaseSelection?.includes(window.opener.HandoffAnnotations?.currentCase)?window.opener.HandoffDrawings:null;}catch{return null;}}
  function message(text,error=false){$('drawingStatus').textContent=text;$('drawingStatus').classList.toggle('save-failed',error);}
  function redraw(){api()?.draw();}
  function queue(job){work=work.then(job).catch(error=>message(error.message,true));return work;}
  async function whenSettled(){let previous;do{previous=work;await previous;}while(previous!==work);await api()?.whenSettled();}
  function history(){const key=api()?.currentCase||'';if(!histories.has(key))histories.set(key,{undo:[],redo:[]});return histories.get(key);}
  function recordMutation(entry){
    if(mainDrawing()){mainDrawing().recordMutation(entry);return;}
    if(replaying||!entry.before?.geometry&&!entry.after?.geometry)return;
    if(!entry.after&&entry.before?.id===draft?.id){draft=null;saveDraft();}
    const key=(entry.after||entry.before).case_id;if(!histories.has(key))histories.set(key,{undo:[],redo:[]});const h=histories.get(key);
    h.undo.push(clone(entry));if(h.undo.length>80)h.undo.shift();h.redo=[];refresh();
  }
  window.addEventListener('annotations:mutation',event=>recordMutation(event.detail));
  function restoreHistory(direction){
    if(mainDrawing())return mainDrawing().restoreHistory(direction);
    return queue(async()=>{
    await api()?.whenSettled();endTrace();const h=history(),from=h[direction],to=h[direction==='undo'?'redo':'undo'];if(!from.length)return;
    const entry=from.at(-1);replaying=true;
    try{const result=await api().applyDrawingHistory(entry,direction==='undo');from.pop();if(result){if(direction==='undo')entry.before=clone(result);else entry.after=clone(result);}to.push(entry);message(direction==='undo'?'Изменение отменено.':'Изменение повторено.');}
    catch(error){message(error.message,true);}finally{replaying=false;refresh();redraw();}
    });
  }
  function resetHistory(){intent++;histories.clear();draft=null;gesture=null;preview=null;try{localStorage.removeItem(draftKey);}catch{}refresh();}
  const canClose=points=>new Set(points.map(p=>p.join(','))).size>=3;
  function saveDraft(){try{if(draft)localStorage.setItem(draftKey,JSON.stringify(draft));else localStorage.removeItem(draftKey);}catch{}}
  function restoreDraft(){
    if(restoredScope===scope()||!v()?.ready||!api()?.store||api().isNotesWindow)return;restoredScope=scope();
    try{const saved=JSON.parse(localStorage.getItem(draftKey)||'null');if(saved?.scope!==scope()||saved.kind!=='trace'||!Array.isArray(saved.geometry?.points_nm)||!saved.geometry.points_nm.length||saved.geometry.points_nm.length>4096)return;
      if(saved.geometry.points_nm.some(p=>!Array.isArray(p)||p.length!==3||p.some((n,i)=>!Number.isFinite(n)||n<v().volume.begin_vox_xyz[i]*v().volume.resolution_nm[i]||n>=v().volume.end_vox_xyz_exclusive[i]*v().volume.resolution_nm[i])))return;
      const record=saved.id?api().records.find(r=>r.id===saved.id):null;
      if(saved.id&&!record)return;
      if(record&&JSON.stringify(record.geometry.points_nm)!==JSON.stringify(saved.geometry.points_nm))return;
      draft=record?{...saved,geometry:clone(record.geometry)}:saved;
      $('annotationMode').value='trace';lastMode='trace';message('Незавершённая трасса восстановлена. Enter: закончить.');
    }catch{}
  }
  function refresh(){
    if(lastScope!==scope()){gesture=null;preview=null;draft=null;lastScope=scope();}
    if(draft?.id&&!api()?.records.some(record=>record.id===draft.id)){draft=null;saveDraft();}
    if(gesture?.record?.id&&!api()?.records.some(record=>record.id===gesture.record.id)){gesture=null;preview=null;}
    restoreDraft();
    const disabled=!api()?.store||!v()?.ready||api().isExporting;
    document.querySelectorAll('[data-drawing-tool]').forEach(button=>{button.disabled=disabled;const active=button.dataset.drawingTool===mode();button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));});
    const count=draft?.geometry.points_nm.length||0;
    $('drawingFinish').disabled=count<2||disabled;$('drawingClose').disabled=!draft||!canClose(draft.geometry.points_nm)||disabled;$('drawingCancel').disabled=!draft||disabled;
    const h=mainDrawing()?.historyState()||history();$('drawingUndo').disabled=!h.undo.length||api()?.isExporting;$('drawingRedo').disabled=!h.redo.length||api()?.isExporting;
    viewport.classList.toggle('drawing-active',G.kinds.has(mode())||mode()==='select');
  }
  function toolChanged(){if(mode()!==lastMode){intent++;endTrace();gesture=null;preview=null;lastMode=mode();}refresh();}
  function setTool(value){intent++;$('annotationMode').value=value;$('annotationMode').dispatchEvent(new Event('change'));viewport.focus({preventScroll:true});redraw();}
  for(const button of document.querySelectorAll('[data-drawing-tool]')){const shortcut=Object.entries(shortcuts).find(([,tool])=>tool===button.dataset.drawingTool)?.[0];button.title=button.textContent+(shortcut?' · '+shortcut.toUpperCase():'');button.addEventListener('click',()=>setTool(button.dataset.drawingTool));}
  function pointAt(event,rect=rectangle(),plan=G.plan(v().volume,v().z)){return G.pixelToNm(plan,(event.clientX-rect.x)/rect.w*plan.width,(event.clientY-rect.y)/rect.h*plan.height);}
  function geometry(points,kind){return {points_nm:clone(points),plane:'xy',slice_index:v().volume.begin_vox_xyz[2]+v().z,closed:['ellipse','roi'].includes(kind),color:$('drawingColor').value,stroke_width:Number($('drawingWidth').value)};}
  function newRecord(kind,points){return {kind,case_id:v().currentCase.case_id,volume_id:v().volume.volume_id,point_nm:[...points[0]],geometry:geometry(points,kind)};}
  function currentGesture(){return gesture&&gesture.scope===scope()&&v()?.ready;}
  function consume(event){event.preventDefault();event.stopImmediatePropagation();}
  function startCapture(event){viewport.focus({preventScroll:true});viewport.setPointerCapture(event.pointerId);consume(event);}
  viewport.addEventListener('pointerdown',event=>{
    if(!v()?.ready||!api()?.store||api().isExporting||api().isNotesWindow||![0,1].includes(event.button))return;
    const rect=rectangle(),inside=event.clientX>=rect.x&&event.clientY>=rect.y&&event.clientX<rect.x+rect.w&&event.clientY<rect.y+rect.h;
    const plan=G.plan(v().volume,v().z),point=pointAt(event,rect,plan),common={scope:scope(),pointer:event.pointerId,start:[event.clientX,event.clientY],point,plan,rect,moved:false};
    if(event.shiftKey||event.button===1){gesture={...common,type:'pan',left:viewport.scrollLeft,top:viewport.scrollTop};startCapture(event);return;}
    if(!inside)return;
    const hit=['navigate','select'].includes(mode())?G.hitAnnotation(ownMarks().map(G.toMark),plan,rect,[event.clientX,event.clientY],{activeId:mode()==='select'?api().selectedId:null}):null;
    if(hit){const record=api().records.find(r=>r.id===hit.mark.id);api().select(record.id,false,true,'drawing');gesture={...common,type:mode()==='select'?'edit':'pick',record:clone(record),index:hit.index,left:viewport.scrollLeft,top:viewport.scrollTop};startCapture(event);return;}
    if(!G.kinds.has(mode()))return;
    gesture={...common,type:mode()==='trace'?'trace':'draw',kind:mode(),record:newRecord(mode(),[point,point])};
    if(mode()==='freehand')gesture.record.geometry.points_nm=[point];preview=gesture.type==='draw'?gesture.record:null;
    startCapture(event);redraw();
  },true);
  function boundedMove(record,start,end,index,plan){
    const mark=G.toMark(record),points=G.moveAnnotation(mark,plan,start,end,index);
    if(index===null)for(const axis of [0,1]){const min=(plan.begin[axis]+.5)*plan.resolutionNm[axis],max=(plan.begin[axis]+(axis?plan.height:plan.width)-.5)*plan.resolutionNm[axis],lo=Math.min(...points.map(p=>p[axis])),hi=Math.max(...points.map(p=>p[axis])),delta=lo<min?min-lo:hi>max?max-hi:0;for(const p of points)p[axis]+=delta;}
    return points;
  }
  viewport.addEventListener('pointermove',event=>{
    if(!gesture)return;if(!currentGesture()){gesture=null;preview=null;return;}
    consume(event);const g=gesture;g.moved||=Math.hypot(event.clientX-g.start[0],event.clientY-g.start[1])>3;
    if(g.type==='pan'||g.type==='pick'&&g.moved){viewport.scrollLeft=g.left-(event.clientX-g.start[0]);viewport.scrollTop=g.top-(event.clientY-g.start[1]);return;}
    if(!g.moved)return;const end=pointAt(event,g.rect,g.plan);
    if(g.type==='edit'){preview=clone(g.record);preview.geometry.points_nm=boundedMove(g.record,g.point,end,g.index,g.plan);preview.point_nm=[...preview.geometry.points_nm[0]];}
    if(g.type==='draw'){
      if(g.kind==='freehand'){const p=g.record.geometry.points_nm;if(p.length<4096&&p.at(-1).some((n,i)=>n!==end[i]))p.push(end);}
      else {if(event.shiftKey&&['ellipse','roi'].includes(g.kind)){const side=Math.min(Math.abs(end[0]-g.point[0]),Math.abs(end[1]-g.point[1]));end[0]=g.point[0]+Math.sign(end[0]-g.point[0])*side;end[1]=g.point[1]+Math.sign(end[1]-g.point[1])*side;}g.record.geometry.points_nm=[g.point,end];}preview=g.record;
    }redraw();
  },true);
  function valid(record,plan){return G.validDraw(record.kind,record.geometry.points_nm,plan)&&(!record.geometry.closed||record.kind!=='trace'||canClose(record.geometry.points_nm));}
  function persistTrace(target){
    const next=clone(target.geometry);if(next.points_nm.length<2)return;
    queue(async()=>{try{const result=target.id?await api().changeDrawing(target.id,{geometry:next},{expected:target.updated_at}):await api().createDrawing({...target,point_nm:next.points_nm[0],geometry:next});if(result){target.id=result.id;target.number=result.number;target.updated_at=result.updated_at;if(draft===target)saveDraft();}redraw();}catch(error){if(draft===target){draft=null;saveDraft();}redraw();throw error;}});
  }
  function tracePoint(point,event){
    if(!draft)draft={...newRecord('trace',[point]),scope:scope(),number:0};
    else {const points=draft.geometry.points_nm,first=G.markScreenPoints(G.toMark(draft),G.plan(v().volume,v().z),rectangle())[0];if(canClose(points)&&Math.hypot(event.clientX-first[0],event.clientY-first[1])<9){finishTrace(true);return;}if(points.at(-1).every((n,i)=>n===point[i]))return;if(points.length>=4096){message('Достигнут предел трассы: 4096 точек. Завершите её и начните новую.');return;}points.push(point);}
    saveDraft();persistTrace(draft);message(draft.geometry.points_nm.length<2?'Добавьте вторую точку, чтобы сохранить трассу.':'Трасса сохраняется. Enter: завершить.');redraw();
  }
  viewport.addEventListener('pointerup',event=>{
    if(!gesture)return;consume(event);const g=gesture,validScope=currentGesture();gesture=null;const savedPreview=preview;preview=null;
    if(viewport.hasPointerCapture(event.pointerId))viewport.releasePointerCapture(event.pointerId);
    if(!validScope){redraw();return;}
    if(['pick','edit'].includes(g.type)&&!g.moved)api().select(g.record.id,false,true,'2d');
    if(g.type==='trace'&&!g.moved)tracePoint(g.point,event);
    if(g.type==='draw'&&g.moved&&valid(g.record,g.plan)){const record=clone(g.record);queue(async()=>{await api().createDrawing(record);message('Рисунок сохранён. Заметка: E или панель «Мои отметки».');redraw();});}
    if(g.type==='edit'&&g.moved&&savedPreview&&valid(savedPreview,g.plan)){const record=clone(savedPreview);queue(async()=>{await api().changeDrawing(record.id,{geometry:record.geometry},{expected:g.record.updated_at});message('Геометрия сохранена.');redraw();});}
    redraw();
  },true);
  const cancelGesture=event=>{if(!gesture)return;consume(event);gesture=null;preview=null;redraw();};
  viewport.addEventListener('pointercancel',cancelGesture,true);viewport.addEventListener('lostpointercapture',cancelGesture,true);
  viewport.addEventListener('wheel',()=>{if(gesture){gesture=null;preview=null;redraw();}},true);
  function endTrace(){if(draft){draft=null;saveDraft();}refresh();}
  function finishTrace(closed=false){if(!draft||draft.geometry.points_nm.length<2||closed&&!canClose(draft.geometry.points_nm))return;if(closed){draft.geometry.closed=true;persistTrace(draft);}endTrace();message(closed?'Замкнутая трасса сохранена.':'Трасса сохранена.');redraw();}
  $('drawingFinish').addEventListener('click',()=>finishTrace(false));$('drawingClose').addEventListener('click',()=>finishTrace(true));$('drawingCancel').addEventListener('click',()=>{const saved=draft?.geometry.points_nm.length>=2;endTrace();message(saved?'Добавленные точки сохранены.':'Трасса с одной точкой отменена.');redraw();});
  $('drawingUndo').addEventListener('click',()=>restoreHistory('undo'));$('drawingRedo').addEventListener('click',()=>restoreHistory('redo'));
  function renderProperties(record){
    $('drawingProperties').hidden=!record?.geometry;if(!record?.geometry)return;
    if(document.activeElement!==$('drawingEditColor'))$('drawingEditColor').value=record.geometry.color;
    if(document.activeElement!==$('drawingEditWidth'))$('drawingEditWidth').value=record.geometry.stroke_width;
    $('drawingContinue').hidden=$('drawingToggleClosed').hidden=record.kind!=='trace';
    $('drawingToggleClosed').textContent=record.geometry.closed?'Разомкнуть трассу':'Замкнуть трассу';$('drawingToggleClosed').disabled=!record.geometry.closed&&!canClose(record.geometry.points_nm);
  }
  for(const [id,key] of [['drawingEditColor','color'],['drawingEditWidth','stroke_width']])$(id).addEventListener('change',()=>{const record=clone(selected());if(!record?.geometry)return;const value=key==='stroke_width'?Math.max(1,Math.min(12,Math.round(Number($(id).value)||2))):$(id).value;queue(async()=>{await api().changeDrawing(record.id,{geometry:{...record.geometry,[key]:value}},{expected:record.updated_at});redraw();});});
  $('drawingToggleClosed').addEventListener('click',()=>{const record=clone(selected());if(record?.kind!=='trace')return;queue(async()=>{await api().changeDrawing(record.id,{geometry:{...record.geometry,closed:!record.geometry.closed}},{expected:record.updated_at});redraw();});});
  $('drawingContinue').addEventListener('click',()=>{
    if(mainDrawing()){window.opener.document.getElementById('drawingContinue').click();return;}
    const record=selected();if(record?.kind!=='trace')return;const requestIntent=++intent;
    queue(async()=>{if(intent!==requestIntent)return;await api().goTo(record.id);if(intent!==requestIntent||api().currentCase!==record.case_id||v().volume?.volume_id!==record.volume_id)return;setTool('trace');const latest=api().records.find(r=>r.id===record.id);if(!latest)return;draft={...clone(latest),scope:scope()};draft.geometry.closed=false;saveDraft();redraw();});
  });
  function focusNote(){if(!selected())return;$('annotationNotes').scrollIntoView({block:'center'});$('annotationNotes').focus();}
  document.addEventListener('keydown',event=>{
    if(event.defaultPrevented||event.isComposing||event.target.closest('input,textarea,select,[contenteditable="true"],dialog')||window.PointActions?.isOpen||$('page-viewer').hidden)return;
    const key=event.key.toLowerCase();
    if((event.ctrlKey||event.metaKey)&&key==='z'){consume(event);restoreHistory(event.shiftKey?'redo':'undo');return;}
    if(event.ctrlKey||event.metaKey||event.altKey)return;
    if(event.key==='Escape'&&(gesture||draft)){consume(event);gesture=null;preview=null;endTrace();redraw();return;}
    if(event.key==='Enter'&&draft){consume(event);finishTrace();return;}
    if(key==='e'&&selected()){consume(event);focusNote();return;}
    if(shortcuts[key]&&!api()?.isNotesWindow){consume(event);setTool(shortcuts[key]);}
  },true);
  function renderOverlay(ctx){
    const record=preview||draft;if(!record||record.scope&&record.scope!==scope()||record.volume_id!==v()?.volume?.volume_id)return;
    G.drawRecord(ctx,record,v().volume,v().z,{zoom:v().zoom,selected:true,handles:true});
  }
  window.HandoffDrawings={whenSettled,refresh,toolChanged,toolHint:tool=>hints[tool],renderProperties,renderOverlay,isPreviewed:id=>preview?.id===id||draft?.id===id,endTrace,restoreHistory,recordMutation,historyState:history,resetHistory};
  window.addEventListener('annotations:ready',()=>{refresh();redraw();});window.addEventListener('annotations:changed',refresh);window.addEventListener('review:volume',refresh);window.addEventListener('review:position',refresh);
  refresh();
})();
