/* Explicit, immutable reviewer captures; browsing never creates evidence. */
(() => {
  'use strict';
  const $=id=>document.getElementById(id), api=()=>window.HandoffAnnotations, viewer=()=>window.ReviewViewer;
  let rows=[],generation=0,urls=[];
  const status=(text,error=false)=>{$('evidenceSaveStatus').textContent=text;$('evidenceSaveStatus').classList.toggle('save-failed',error);};
  const button=(text,action)=>{const n=document.createElement('button');n.type='button';n.textContent=text;n.addEventListener('click',()=>Promise.resolve().then(action).catch(e=>status(e.message,true)));return n;};
  const option=(select,value,text)=>select.add(new Option(text,value));
  const download=(blob,name)=>{const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);};
  function sync(){
    const v=viewer(),old=$('evidenceLink').value,pair=$('evidencePair').value;
    $('evidenceSave2D').disabled=!api()?.store||!v?.ready;
    $('evidenceSave3D').disabled=!api()?.store||!v?.ready||!v.surface?.modelReady;
    $('evidenceLink').replaceChildren();option($('evidenceLink'),'case','Случаем целиком');
    for(const t of v?.currentCase?.contacts||[])option($('evidenceLink'),'T:'+t.contact_id,t.contact_id+' · заданный контакт');
    for(const r of api()?.records.filter(r=>r.case_id===v?.currentCase?.case_id)||[])option($('evidenceLink'),'N:'+r.id,'N'+r.number+' · '+(r.label||'моя отметка'));
    if([...$('evidenceLink').options].some(o=>o.value===old))$('evidenceLink').value=old;
    $('evidencePair').replaceChildren();option($('evidencePair'),'','Не выбрано');
    for(const r of rows.filter(r=>r.case_id===v?.currentCase?.case_id&&r.source_view==='2d'))option($('evidencePair'),r.id,r.volume_id+' · Z '+r.local_z+' · '+(r.caption||r.id.slice(0,8)));
    if([...$('evidencePair').options].some(o=>o.value===pair))$('evidencePair').value=pair;
  }
  function association(){
    const r=api().records.find(r=>r.id===api().selectedId&&r.case_id===viewer().currentCase.case_id);
    return r?{annotation_id:r.id}:{};
  }
  async function capture(source,link){
    const v=viewer();if(!api()?.store||!v?.ready)return;
    try{
      // Freeze both pixels and labels before the first await, even if the user navigates next.
      const volume=structuredClone(v.volume),local_z=v.z,case_id=v.currentCase.case_id;
      const currentMarks=api().records.filter(r=>r.case_id===case_id&&r.point_nm.every((n,i)=>n>=volume.begin_vox_xyz[i]*volume.resolution_nm[i]&&n<volume.end_vox_xyz_exclusive[i]*volume.resolution_nm[i])&&(source==='3d'||Math.floor(r.point_nm[2]/volume.resolution_nm[2])-volume.begin_vox_xyz[2]===local_z));
      const snapshot=source==='3d'?v.surface.snapshotEvidence():null;
      const segmentation=source==='2d'?window.SliceSegmentation?.captureFor(volume.volume_id,local_z)||null:null;
      const annotated=snapshot?.blob||api().imageBlob(true,{segmentation}),raw=source==='2d'?api().imageBlob(false):Promise.resolve(null);
      const meta={id:crypto.randomUUID(),case_id,volume_id:volume.volume_id,local_z,global_z:volume.begin_vox_xyz[2]+local_z,source_view:source,capture_origin:'manual',
        ...(link||association()),caption:$('evidenceCaption').value,display_window:[...v.displayWindow],resolution_nm:[...volume.resolution_nm],
        annotation_ids:currentMarks.map(r=>r.id),annotation_numbers:currentMarks.map(r=>r.number),t_points_visible:$('overlayToggle').checked,
        linked_to_slice:source==='2d'||$('evidenceLinkSlice').checked,...(snapshot?{view_settings:snapshot.view}:{}),
        ...(source==='3d'&&$('evidencePair').value?{linked_evidence_id:$('evidencePair').value}:{})};
      if(source==='2d')meta.segmentation2d=segmentation?{...segmentation.settings,included:true}:{included:false,source_version:'seg_m1300',volume_id:volume.volume_id,local_z};
      if(volume.tiff_sha256)meta.tiff_sha256=volume.tiff_sha256;
      status('Сохраняем выбранное изображение…');
      const pixels=Promise.all([annotated,raw]);pixels.catch(()=>{});
      await api().enqueue(async()=>{
        const [marked,clean]=await pixels;
        const saved=(await api().store.getEvidence({case_id})).find(r=>r.id===meta.id)||await api().store.addEvidence(meta,{annotated:marked,raw:clean});
        if(saved.review_id)await window.HandoffAssessment?.attachEvidence(saved.review_id,`E:${saved.id} · ${source.toUpperCase()} · ${saved.volume_id} · Z ${saved.local_z}`);
        status('Изображение сохранено · '+saved.volume_id+' · Z '+saved.local_z);
        window.dispatchEvent(new Event('annotations:changed'));notify();
      });
    }catch(error){status('Изображение не сохранено: '+error.message,true);}
  }
  let channel;try{channel=new BroadcastChannel('microns-researcher-annotations-v1');}catch{}
  function notify(){channel?.postMessage({type:'changed',source:'evidence'});}
  async function get(id){const found=(await api().store.getEvidence({}, {blobs:true})).find(r=>r.id===id);if(!found)throw new Error('Изображение уже удалено.');return found;}
  async function restoreView(row){
    const v=viewer(),settings=row.view_settings;
    await v.select(row.case_id,row.volume_id,row.local_z);
    if(!v.ready||v.currentCase.case_id!==row.case_id||v.volume.volume_id!==row.volume_id)throw new Error('Не удалось загрузить сохранённый объём. Повторите переход.');
    if(row.display_window){$('blackInput').value=row.display_window[0];$('whiteInput').value=row.display_window[1];$('blackInput').dispatchEvent(new Event('change'));}
    if(settings){
      const controls={overlayToggle:settings.seed_points_visible,tCenter:settings.seed_filters?.center,tPre:settings.seed_filters?.pre,tPost:settings.seed_filters?.post,annotationsVisible:settings.annotations_visible,surfaceContext:settings.context_visible};
      for(const [id,value]of Object.entries(controls))if(typeof value==='boolean'){$(id).checked=value;$(id).dispatchEvent(new Event('change'));}
      if(settings.selected_annotation_id)api().select(settings.selected_annotation_id,false);
      await v.surface.restoreEvidence(settings);
    }
    location.hash='viewer';$('workspace').scrollIntoView({block:'start',behavior:'smooth'});status('Открыт сохранённый вид. Само изображение осталось неизменным.');
  }
  async function refresh(){
    if(!api()?.store)return;const token=++generation,result=await api().store.getEvidence();if(token!==generation)return;rows=result;sync();
    for(const url of urls)URL.revokeObjectURL(url);urls=[];
    const current=rows.filter(r=>r.case_id===viewer()?.currentCase?.case_id).sort((a,b)=>a.created_at.localeCompare(b.created_at));
    const nodes=current.map(row=>{
      const article=document.createElement('article');article.className='evidence-row';article.dataset.evidenceId=row.id;
      const linked=api().records.find(r=>r.id===row.annotation_id),origin=row.capture_origin==='manual'?'выбрано исследователем':row.capture_origin==='current_export'?'из экспорта текущего вида':'снимок прежней версии';
      const label=document.createElement('span'),small=document.createElement('small');label.textContent=(row.source_view==='3d'?'3D · ':'2D · ')+row.volume_id+' · Z '+row.local_z+(row.caption?' · '+row.caption:'');small.textContent=new Date(row.created_at).toLocaleString('ru-RU')+' · '+origin+(linked?' · связано с N'+linked.number:row.contact_id?' · '+row.contact_id:'')+' · E:'+row.id;label.append(small);article.append(label);
      article.append(button('Посмотреть',async()=>{const old=article.querySelector('img');if(old){old.remove();return;}const e=await get(row.id),url=URL.createObjectURL(e.annotated);urls.push(url);const img=document.createElement('img');img.className='evidence-preview';img.alt=row.caption||'Сохранённый вид '+row.volume_id;img.src=url;article.append(img);}),
        button('Скачать PNG',async()=>download((await get(row.id)).annotated,row.volume_id+'-'+row.source_view+'-'+row.id.slice(0,8)+'.png')),
        button(row.source_view==='3d'?'Восстановить вид 3D':'Перейти к срезу',()=>restoreView(row)));
      if(row.source_view==='2d')article.append(button('Без меток PNG',async()=>download((await get(row.id)).raw,row.volume_id+'-raw-'+row.id.slice(0,8)+'.png')));
      article.append(button('Удалить изображение',async()=>{await api().enqueue(async()=>{await api().store.removeEvidence(row.id);await refresh();notify();status('Снимок удалён. Заметки сохранены.');});}));
      return article;
    });
    if(!nodes.length){const p=document.createElement('p');p.className='hint';p.textContent='В этом случае ещё нет сохранённых изображений. Выберите нужный срез или ракурс и нажмите «Сохранить». ';nodes.push(p);}
    $('evidenceList').replaceChildren(...nodes);
  }
  $('evidenceSave2D').addEventListener('click',()=>capture('2d'));
  $('evidenceSave3D').addEventListener('click',()=>capture('3d'));
  window.addEventListener('assessment:evidence',event=>capture('2d',event.detail));
  for(const event of ['annotations:ready','annotations:changed','review:volume'])window.addEventListener(event,()=>refresh().catch(e=>status(e.message,true)));
  for(const event of ['review:position','annotations:surface-ready','annotations:contextstatus'])window.addEventListener(event,sync);
  channel?.addEventListener('message',event=>{if(event.data?.type==='changed')refresh().catch(e=>status(e.message,true));});
  window.HandoffEvidence={refresh,capture,restoreView};
})();
