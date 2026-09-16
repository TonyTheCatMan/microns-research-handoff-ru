/* Structured human anatomical review, using the same durable store as annotations. */
(() => {
  'use strict';
  const host=document.getElementById('assessmentWorkspace'), data=window.REVIEW_CONTENT;
  if(!host||!data)return;
  const api=()=>window.HandoffAnnotations, viewer=()=>window.ReviewViewer;
  const JOURNAL='microns-assessment-pending-v1:';
  const combined=['combined_head_included','combined_neck_included','combined_all_sections_inspected','combined_complete_membrane','combined_boundary_resolved'];
  const extras={junction_morphology:'Наблюдаемая морфология соединения',presynaptic_ownership:'Принадлежность пресинаптического профиля',postsynaptic_ownership:'Принадлежность постсинаптического профиля',ownership_notes:'Наблюдения о принадлежности мембран',combined_head_included:'Вся головка включена в совокупность изученных объёмов',combined_neck_included:'Вся шейка до ствола включена в изученную область',combined_all_sections_inspected:'Все необходимые исходные срезы фактически просмотрены',combined_complete_membrane:'Вся поверхность головки и шейки фактически просмотрена',combined_boundary_resolved:'Принадлежность мембраны непрерывно разрешена'};
  const multiline=new Set(['evidence_refs','reason_or_uncertainty','junction_morphology','ownership_notes','limitations','exposure_notes','missing_regions_or_defects','extra_crop_request_nm_bounds','relevant_serial_EM_experience','consultation_or_reconciliation','limitations_and_next_steps']);
  let store,rows=[],reviewer={},annotations=[],caseId='',pending=0,refreshToken=0,initialized=false,deferredRefresh=false,reviewerUpdatedAt=null,channel;
  try{channel=new BroadcastChannel('microns-researcher-annotations-v1');}catch{}
  const el=(tag,text,className)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(className)n.className=className;return n;};
  const getCase=id=>data.case_metadata.cases.find(c=>c.case_id===id);
  const rowId=(table,id)=>table+':'+id;
  const tableRow=(table,id,identity={})=>{
    const idValue=rowId(table,id);let row=rows.find(r=>r.id===idValue);
    if(!row){row={id:idValue,table,case_id:identity.case_id||caseId,data:{...Object.fromEntries(data.form_fields[table].map(k=>[k,''])),...identity}};rows.push(row);}
    return row;
  };
  const currentCase=()=>api()?.currentCase||viewer()?.currentCase?.case_id||caseId;
  const markStatus=(message,error=false)=>{const n=document.getElementById('assessmentSaveStatus');if(n){n.textContent=message;n.classList.toggle('assessment-warning',error);}};
  function journal(id,entry){
    const key=JOURNAL+id;
    try{const old=JSON.parse(localStorage.getItem(key)||'null');entry.patch={...(old?.patch||{}),...entry.patch};entry.stamp=crypto.randomUUID();const text=JSON.stringify(entry);localStorage.setItem(key,text);return {key,text};}catch{return null;}
  }
  function removeJournal(saved){try{if(saved&&localStorage.getItem(saved.key)===saved.text)localStorage.removeItem(saved.key);}catch{}}
  function notify(){channel?.postMessage({type:'changed',source:'assessment'});window.dispatchEvent(new CustomEvent('assessment:changed'));}
  function writeRow(row,patch){
    Object.assign(row.data,patch);row.updated_at=new Date(Math.max(Date.now(),Date.parse(row.updated_at||'')+1||0)).toISOString();
    const identity=Object.fromEntries(['case_id','contact_id','new_contact_id','annotation_id','volume_id','x_nm','y_nm','z_nm'].filter(k=>row.data[k]!==undefined&&row.data[k]!=='').map(k=>[k,row.data[k]]));
    const input={id:row.id,table:row.table,case_id:row.case_id,data:{...identity,...patch}};
    const saved=journal(row.id,{type:'review',id:row.id,table:row.table,case_id:row.case_id,patch:input.data});
    const ticket={pending:true};pending++;markStatus('Сохраняем анатомическую оценку…');
    api().enqueue(async()=>{
      try{const latest=rows.find(r=>r.id===input.id)||row;await store.putReview({...input,data:Object.fromEntries(Object.keys(input.data).map(k=>[k,latest.data[k]??input.data[k]]))});removeJournal(saved);notify();}
      catch(error){markStatus('Оценка не сохранена: '+error.message+'. Повторите сохранение в панели отметок.',true);throw error;}
      finally{if(ticket.pending){pending--;ticket.pending=false;}if(!pending&&!localPending())markStatus('Анатомическая оценка сохранена в этом браузере.');if(!pending&&deferredRefresh)refresh().catch(()=>{});}
    });
    updateGate();
  }
  function writeReviewer(key,value){
    reviewer[key]=value;reviewerUpdatedAt=new Date().toISOString();const saved=journal('reviewer',{type:'reviewer',patch:{[key]:value}});
    const ticket={pending:true};pending++;markStatus('Сохраняем сведения о рецензенте…');
    api().enqueue(async()=>{
      try{await store.putReviewer({[key]:reviewer[key]??value});removeJournal(saved);notify();}
      catch(error){markStatus('Сведения не сохранены: '+error.message,true);throw error;}
      finally{if(ticket.pending){pending--;ticket.pending=false;}if(!pending&&!localPending())markStatus('Сведения сохранены в этом браузере.');if(!pending&&deferredRefresh)refresh().catch(()=>{});}
    });
  }
  function localPending(){try{for(let i=0;i<localStorage.length;i++)if(localStorage.key(i)?.startsWith(JOURNAL))return true;}catch{}return false;}
  function pendingEntries(){const entries=[];try{for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(key.startsWith(JOURNAL))entries.push({key,text:localStorage.getItem(key)});}}catch{}return entries;}
  function overlayPending(nextRows,nextReviewer){
    for(const entry of pendingEntries())try{const value=JSON.parse(entry.text);
      if(value.type==='reviewer')Object.assign(nextReviewer,value.patch);
      else{let row=nextRows.find(r=>r.id===value.id);if(!row){row={id:value.id,table:value.table,case_id:value.case_id,data:{},updated_at:rows.find(r=>r.id===value.id)?.updated_at||new Date().toISOString()};nextRows.push(row);}Object.assign(row.data,value.patch);}
    }catch{}
  }
  function choiceGroup(key){if(combined.includes(key))return'coverage';if(key.endsWith('_ownership'))return'contact_assessment';return data.field_choice_groups[key];}
  function field(key,value,onChange,options={}){
    const wrapper=el('label',undefined,'assessment-field'+(multiline.has(key)||options.wide?' assessment-wide':''));
    wrapper.append(el('span',options.label||extras[key]||data.field_labels[key]||key));
    const group=choiceGroup(key);let input;
    if(group){input=el('select');let choices=data.choice_groups[group];if(options.singleTarget)choices=['not_applicable'];for(const val of ['',...choices])input.add(new Option(data.choice_mapping[val]||val,val));
      if(options.singleTarget&&value&&value!=='not_applicable'){const previous=new Option((data.choice_mapping[value]||value)+' · ранее записано, проверьте',value);previous.disabled=true;input.add(previous);}}
    else if(multiline.has(key)){input=el('textarea');input.rows=key==='reason_or_uncertainty'||key==='evidence_refs'?2:3;input.maxLength=50000;}
    else{input=el('input');input.type=['review_date','confirmation_date'].includes(key)?'date':key==='minutes_spent'?'number':'text';if(key==='minutes_spent'){input.min='0';input.step='0.1';}input.maxLength=20000;}
    input.value=value||'';input.dataset.field=key;if(options.row)input.dataset.reviewId=options.row.id;
    if(options.placeholder)input.placeholder=options.placeholder;
    input.addEventListener('input',()=>onChange(input.value,input));wrapper.append(input);
    const help=options.help===false?'':options.help||data.field_help[key];if(help)wrapper.append(el('small',help));
    return wrapper;
  }
  function rowFields(row,keys,grid,options={}){for(const key of keys)grid.append(field(key,row.data[key],value=>writeRow(row,{[key]:value}),{row,...options[key]}));}
  function details(title,key,open=false){const node=el('details',undefined,'assessment-section');node.dataset.assessmentSection=key;node.open=open;node.append(el('summary',title));return node;}
  function sectionBody(node,text){const body=el('div',undefined,'assessment-section-body');if(text)body.append(el('p',text,'assessment-help'));node.append(body);return body;}
  function evidenceButton(row,contactId=null,annotationId=null){
    const button=el('button','Сохранить текущий срез как доказательство','assessment-evidence-button');button.type='button';
    button.addEventListener('click',()=>{
      const v=viewer();if(!v?.ready||v.currentCase?.case_id!==row.case_id){markStatus('Сначала откройте нужный срез этого случая в основном просмотрщике.',true);return;}
      if(row.table==='COVERAGE_LOG'&&row.data.volume_id!==v.volume.volume_id){markStatus('Для этой строки журнала сначала откройте объём '+row.data.volume_id+'.',true);return;}
      window.dispatchEvent(new CustomEvent('assessment:evidence',{detail:{case_id:row.case_id,volume_id:v.volume.volume_id,contact_id:contactId,annotation_id:annotationId,review_id:row.id,table:row.table}}));
    });return button;
  }
  function goContact(contact){const button=el('button','К '+contact.contact_id+' в 2D / 3D');button.type='button';button.addEventListener('click',async()=>{
    const c=getCase(caseId),volume=c.volumes.find(v=>contact.ctr_nm.every((n,i)=>n>=v.begin_vox_xyz[i]*v.resolution_nm[i]&&n<v.end_vox_xyz_exclusive[i]*v.resolution_nm[i]))||c.volumes[0];
    await viewer()?.gotoPoint(caseId,volume.volume_id,contact.ctr_nm);document.getElementById('viewerShell')?.scrollIntoView({block:'start',behavior:'smooth'});
  });return button;}
  function contactCard(contact,annotation){
    const isNew=!!annotation,id=isNew?'N'+annotation.number:contact.contact_id;
    const row=isNew?tableRow('ADDITIONAL_CONTACTS',annotation.id,{case_id:caseId,new_contact_id:id,annotation_id:annotation.id,volume_id:annotation.volume_id,x_nm:String(annotation.point_nm[0]),y_nm:String(annotation.point_nm[1]),z_nm:String(annotation.point_nm[2])}):tableRow('CONTACT_REVIEW',caseId+':'+id,{case_id:caseId,contact_id:id});
    const card=el('article',undefined,'assessment-contact'),heading=el('div',undefined,'assessment-row-heading');heading.append(el('h4',id+(isNew?' · новый кандидат':' · заданная цель')));
    if(isNew){const button=el('button','Перейти к отметке');button.type='button';button.addEventListener('click',()=>viewer()?.gotoPoint(caseId,annotation.volume_id,annotation.point_nm));heading.append(button);}else heading.append(goContact(contact));card.append(heading);
    if(isNew){
      card.append(el('p',annotation.volume_id+' · XYZ: '+annotation.point_nm.map(n=>Number(n.toFixed(2))).join(', ')+' нм. Номер и координаты берутся из существующей отметки.','assessment-help'));
      if(annotation.properties||annotation.notes){const previous=el('div',undefined,'assessment-linked-notes');previous.append(el('strong','Наблюдения из этой же отметки'));
        if(annotation.properties)previous.append(el('p',annotation.properties));if(annotation.notes)previous.append(el('p',annotation.notes));previous.append(el('small','Сохраняются и экспортируются вместе с записью. Повторно вводить их не нужно.'));card.append(previous);}
    }
    const grid=el('div',undefined,'assessment-grid');
    rowFields(row,['synaptic_junction','belongs_to_target_spine','location_head_neck_shaft','presynaptic_ownership','postsynaptic_ownership','junction_morphology','ownership_notes','reason_or_uncertainty','evidence_refs'],grid,{
      synaptic_junction:{help:'Оценка соединения по серийной ЭМ; простое соприкосновение мембран не равнозначно синапсу.'},
      presynaptic_ownership:{help:'Подтверждается ли принадлежность мембраны прослеженному пресинаптическому профилю?'},
      postsynaptic_ownership:{help:'Подтверждается ли принадлежность мембраны прослеженному постсинаптическому профилю?'},
      junction_morphology:{help:'Опишите сопоставленные мембраны, везикулы и видимые специализации; наблюдения отделяйте от вывода.'},
      ownership_notes:{help:'Укажите профиль/объект, серийную непрерывность и неоднозначность. Цвет или точка базы не подтверждают принадлежность.'},
    });
    if(isNew){const location=grid.querySelector('[data-field="location_head_neck_shaft"]');if(!row.data.location_head_neck_shaft&&annotation.location)location.value=annotation.location;
      const reason=grid.querySelector('[data-field="reason_or_uncertainty"]');if(!row.data.reason_or_uncertainty&&annotation.notes)reason.placeholder='Используются заметки из отметки выше. Здесь можно записать уточнение.';
    }
    card.append(grid,evidenceButton(row,isNew?null:id,isNew?annotation.id:null));return card;
  }
  function renderContacts(container){
    const c=getCase(caseId),targetBody=sectionBody(container,'Оцените морфологию и принадлежность мембран независимо. Пустое поле означает, что оценка ещё не внесена.');
    for(const contact of c.contacts)targetBody.append(contactCard(contact));
    targetBody.append(el('h3','Новые контакты из моих отметок'));
    const additional=annotations.filter(a=>a.case_id===caseId&&a.kind==='contact').sort((a,b)=>a.number-b.number);
    if(!additional.length)targetBody.append(el('p','Новых кандидатов пока не отмечено. Это не доказательство их отсутствия. Добавьте контакт инструментом над изображением; здесь появится та же запись N.','assessment-help'));
    for(const annotation of additional)targetBody.append(contactCard(null,annotation));
    const live=new Set(additional.map(a=>a.id));
    for(const row of rows.filter(r=>r.case_id===caseId&&r.table==='ADDITIONAL_CONTACTS'&&!live.has(r.data.annotation_id))){
      const card=el('article',undefined,'assessment-contact');card.append(el('h4',(row.data.new_contact_id||'Новый контакт')+' · сохранённая оценка'));
      card.append(el('p','Исходная отметка удалена или её тип изменён. Анатомическая оценка сохранена; уточните её здесь. Неразрешённый кандидат по-прежнему учитывается при проверке отрицательного вывода.','assessment-warning assessment-orphan-note'));
      const grid=el('div',undefined,'assessment-grid');rowFields(row,['synaptic_junction','belongs_to_target_spine','location_head_neck_shaft','presynaptic_ownership','postsynaptic_ownership','junction_morphology','ownership_notes','reason_or_uncertainty','evidence_refs'],grid);card.append(grid,evidenceButton(row));targetBody.append(card);
    }
  }
  function renderCase(container){
    const c=getCase(caseId),row=tableRow('CASE_REVIEW',caseId,{case_id:caseId}),body=sectionBody(container,'Заключение относится к прослеженной головке и шейке до соединения со стволом. Не определяйте E/I-класс по локальному виду контакта.');
    const previous=(api()?.cases||[]).find(r=>r.case_id===caseId);
    if(previous&&(previous.notes||previous.inspected_regions||previous.extra_extent)){const saved=el('div',undefined,'assessment-linked-notes');saved.append(el('strong','Ранее сохранённые общие записи'));
      for(const [key,label] of [['notes','Наблюдения'],['inspected_regions','Записанная область просмотра'],['extra_extent','Запрошенное расширение']])if(previous[key])saved.append(el('p',label+': '+previous[key]));saved.append(el('small','Сохранены в резервной копии. Они не заполняют анатомические выводы автоматически.'));body.append(saved);}
    const grid=el('div',undefined,'assessment-grid');rowFields(row,['common_head','neck_to_shaft','unitary_spine','at_least_two_contacts_same_spine','bounded_no_additional_contact','confidence'],grid,{
      common_head:{singleTarget:c.contacts.length===1,help:c.contacts.length===1?'В этом случае одна заданная цель: сравнение общей головки между заданными целями неприменимо. Выберите «Неприменимо» вручную. Наличие второго нового контакта оцените отдельно ниже.':data.field_help.common_head},
      bounded_no_additional_contact:{help:'«Поддержано» доступно только после полного документированного осмотра и разрешения всех дополнительных кандидатов.'},
    });body.append(grid);
    const gate=el('div',undefined,'assessment-gate');gate.id='assessmentNegativeGate';gate.setAttribute('role','status');body.append(gate);
    body.append(el('p','Положительный вывод о двух отдельных подтверждённых контактах на одном прослеженном шипике допустим при неполном учёте всей поверхности.','assessment-positive-note'));
    const remaining=el('div',undefined,'assessment-grid');rowFields(row,['evidence_refs','limitations','reviewer_name','review_date','minutes_spent','prior_verdicts_seen','functional_results_seen','exposure_notes'],remaining);body.append(remaining,evidenceButton(row));
  }
  function renderCoverage(container){
    const c=getCase(caseId),caseRow=tableRow('CASE_REVIEW',caseId,{case_id:caseId}),body=sectionBody(container,'Записывайте фактически изученные срезы и области. Наличие файла и простое перемещение по срезам не подтверждают осмотр всей мембраны.');
    const combinedBox=el('fieldset',undefined,'assessment-combined');combinedBox.append(el('legend','Совокупная область: все использованные объёмы этого случая'));
    const combinedGrid=el('div',undefined,'assessment-grid');rowFields(caseRow,combined,combinedGrid,Object.fromEntries(combined.map(k=>[k,{help:false}])));combinedBox.append(combinedGrid,el('p','Ответы относятся к объединённой изученной области: отдельный фрагмент или расширение может не включать всю структуру.','assessment-help'));body.append(combinedBox);
    for(const volume of c.volumes){
      const row=tableRow('COVERAGE_LOG',caseId+':'+volume.volume_id,{case_id:caseId,volume_id:volume.volume_id}),card=el('article',undefined,'assessment-volume');card.append(el('h4',volume.volume_id));
      card.append(el('p',`Доступны локальные Z 0–${volume.shape_xyz[2]-1} (TIFF: страницы 1–${volume.shape_xyz[2]}); глобальные Z ${volume.begin_vox_xyz[2]}–${volume.end_vox_xyz_exclusive[2]-1}. Это доступный диапазон, не запись о просмотре.`,'assessment-help'));
      const grid=el('div',undefined,'assessment-grid');rowFields(row,['inspected_local_z_inclusive','inspected_global_z_inclusive','inspected_xy_global_bounds','head_fully_included','neck_to_shaft_fully_included','all_relevant_available_sections_inspected','complete_membrane_inspected','continuous_boundary_resolved','missing_regions_or_defects','extra_crop_request_nm_bounds','evidence_refs'],grid,{
        inspected_local_z_inclusive:{placeholder:'Например: 21–29, 35–41; индексы с 0'},
        inspected_global_z_inclusive:{placeholder:'Например: 20521–20529, 20535–20541; индексы'},
        inspected_xy_global_bounds:{placeholder:'XYZ: единицы и включение границ обязательно'},
        head_fully_included:{help:'Включена ли вся головка именно в этот объём?'},neck_to_shaft_fully_included:{help:'Включена ли вся шейка до ствола именно в этот объём?'},
        complete_membrane_inspected:{help:'Вся соответствующая мембрана в указанной изученной области.'},
        continuous_boundary_resolved:{help:'Принадлежность границ в указанной изученной области.'},
        missing_regions_or_defects:{help:'Перечислите оставшиеся пробелы и дефекты. Если их нет, оставьте пустым.'},
        extra_crop_request_nm_bounds:{help:'Если расширение требуется, задайте границы XYZ в нм и объясните причину. Если не требуется, оставьте пустым. Запрос не является просмотром.'},
      });card.append(grid,evidenceButton(row));body.append(card);
    }
  }
  function renderReviewer(container){
    const body=sectionBody(container,'Сведения сохраняются вместе с наблюдениями и входят в экспорт. Первоначальную оценку отделяйте от последующих обсуждений.');
    const grid=el('div',undefined,'assessment-grid');
    for(const spec of data.reviewer_fields){if(spec.key==='package_id'){body.append(el('p','Код исходного пакета: '+data.case_metadata.base_package_id,'assessment-help'));continue;}grid.append(field(spec.key,reviewer[spec.key],value=>writeReviewer(spec.key,value),{label:spec.label,help:spec.help}));}
    body.append(grid);
  }
  function parseRanges(text,min,max){
    if(typeof text!=='string'||!text.trim())return null;const values=new Set();
    for(const part of text.trim().replace(/[–—−]/g,'-').split(/[,;]/)){
      const found=part.trim().match(/^(\d+)\s*(?:-\s*(\d+))?$/);if(!found)return null;
      const lo=Number(found[1]),hi=Number(found[2]??found[1]);if(lo<min||hi>max||lo>hi)return null;for(let n=lo;n<=hi;n++)values.add(n);
    }return values;
  }
  function negativeGate(targetCase=caseId,reviewRows=rows,marks=annotations){
    const c=getCase(targetCase);if(!c)return{allowed:false,reasons:['Выберите случай.']};
    const row=reviewRows.find(r=>r.table==='CASE_REVIEW'&&r.case_id===targetCase)?.data||{},reasons=[];
    if(!combined.every(k=>row[k]==='yes'))reasons.push('Не подтверждены все пять условий для совокупной изученной области.');
    for(const v of c.volumes){const r=reviewRows.find(r=>r.table==='COVERAGE_LOG'&&r.case_id===targetCase&&r.data.volume_id===v.volume_id)?.data||{};
      if(!['inspected_local_z_inclusive','inspected_global_z_inclusive','inspected_xy_global_bounds'].every(k=>String(r[k]||'').trim()))reasons.push(v.volume_id+': не указаны фактически просмотренные Z и XY.');
      const local=parseRanges(r.inspected_local_z_inclusive,0,v.shape_xyz[2]-1),global=parseRanges(r.inspected_global_z_inclusive,v.begin_vox_xyz[2],v.end_vox_xyz_exclusive[2]-1);
      if(!local||!global)reasons.push(v.volume_id+': Z должен содержать допустимые индексы или диапазоны через запятую (например, 21–29, 35–41).');
      else if(local.size!==global.size||[...local].some(z=>!global.has(z+v.begin_vox_xyz[2])))reasons.push(v.volume_id+': локальные и глобальные диапазоны Z не соответствуют друг другу.');
      if(!['all_relevant_available_sections_inspected','complete_membrane_inspected','continuous_boundary_resolved'].every(k=>r[k]==='yes'))reasons.push(v.volume_id+': просмотр или принадлежность мембраны остаются неполными / неразрешёнными.');
      if(String(r.missing_regions_or_defects||'').trim()||String(r.extra_crop_request_nm_bounds||'').trim())reasons.push(v.volume_id+': указаны ограничения или требуется дополнительный объём.');
    }
    const candidates=new Map(marks.filter(a=>a.case_id===targetCase&&a.kind==='contact').map(a=>[a.id,'N'+a.number]));
    for(const r of reviewRows.filter(r=>r.table==='ADDITIONAL_CONTACTS'&&r.case_id===targetCase))candidates.set(r.data.annotation_id,r.data.new_contact_id||'Новый контакт');
    for(const [id,label] of candidates){const r=reviewRows.find(r=>r.table==='ADDITIONAL_CONTACTS'&&r.case_id===targetCase&&r.data.annotation_id===id)?.data||{};
      if(r.synaptic_junction!=='contradiction'&&r.belongs_to_target_spine!=='contradiction')reasons.push(label+': дополнительный кандидат поддержан, не разрешён или ещё не оценён.');
    }
    return{allowed:reasons.length===0,reasons};
  }
  function updateGate(){
    const node=document.getElementById('assessmentNegativeGate');if(!node)return;
    const gate=negativeGate(),select=host.querySelector('[data-field="bounded_no_additional_contact"]'),option=select?.querySelector('option[value="support"]');if(option)option.disabled=!gate.allowed;
    node.classList.toggle('assessment-warning',!gate.allowed);node.replaceChildren(el('strong',gate.allowed?'Условия полноты записаны. Отрицательный вывод всё равно выбирает рецензент.':'Полный вывод «нет дополнительных контактов» пока недоступен.'));
    if(!gate.allowed){const list=el('ul');for(const reason of gate.reasons)list.append(el('li',reason));node.append(list);if(select?.value==='support')node.append(el('p','Ранее внесённое «Поддержано» теперь противоречит заполненности данных. Исправьте оценку или документируйте недостающую проверку; запись не изменена автоматически.','assessment-invalid'));}
  }
  function render(){
    if(!store)return;const next=currentCase();if(next)caseId=next;
    const hadSections=host.querySelectorAll('details[data-assessment-section]').length>0,open=new Set([...host.querySelectorAll('details[open]')].map(n=>n.dataset.assessmentSection));
    host.replaceChildren();const head=el('div',undefined,'assessment-heading');head.append(el('h2','Анатомическая оценка'+(caseId?' · '+caseId:'')));
    const status=el('p','Все поля сохраняются в этом браузере и входят в общий экспорт.','assessment-help');status.id='assessmentSaveStatus';status.setAttribute('role','status');head.append(status);host.append(head);
    if(!getCase(caseId)){host.append(el('p','Выберите случай в просмотрщике.'));return;}
    const sections=[['contacts','Контакты: заданные T и новые N',renderContacts],['case','Анатомическое заключение',renderCase],['coverage','Фактическое покрытие и ограничения',renderCoverage],['reviewer','Рецензент и независимость оценки',renderReviewer]];
    for(const [key,title,builder] of sections){const section=details(title,key,hadSections?open.has(key):key==='contacts');builder(section);host.append(section);}updateGate();
  }
  async function refresh(force=false){
    if(!store)return;if(pending){deferredRefresh=true;return;}const token=++refreshToken;
    const result=await Promise.all([store.getReviews(),store.getReviewer(),store.getAll()]);
    if(token!==refreshToken||pending)return;
    if(!force&&host.contains(document.activeElement)&&/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)){annotations=result[2];deferredRefresh=true;updateGate();return;}
    deferredRefresh=false;
    overlayPending(result[0],result[1]);[rows,reviewer,annotations]=result;render();
    if(localPending())markStatus('Часть полей ожидает сохранения. Они сохранены как локальный черновик; можно экспортировать резервную копию.',true);
  }
  async function recover(){
    for(const entry of pendingEntries()){
      const replay=async()=>{const latest=localStorage.getItem(entry.key);if(!latest)return;const value=JSON.parse(latest);if(value.type==='reviewer')await store.putReviewer(value.patch);else await store.putReview({id:value.id,table:value.table,case_id:value.case_id,data:value.patch});removeJournal({key:entry.key,text:latest});};
      try{await replay();}catch{api().enqueue(replay);}
    }
  }
  async function boot(){
    if(initialized||!api()?.store?.getReviews)return;initialized=true;store=api().store;
    try{await recover();await refresh(true);if(!reviewer.package_id)writeReviewer('package_id',data.case_metadata.base_package_id||data.case_metadata.package_id);}catch(error){host.replaceChildren(el('p','Не удалось открыть анатомическую оценку: '+error.message,'assessment-warning'));initialized=false;}
  }
  window.addEventListener('annotations:ready',boot);
  window.addEventListener('annotations:changed',()=>{boot();refresh().catch(error=>markStatus(error.message,true));});
  window.addEventListener('review:volume',()=>{caseId=currentCase();if(pending)render();else refresh(true).catch(error=>markStatus(error.message,true));});
  host.addEventListener('focusout',event=>{if(deferredRefresh&&!host.contains(event.relatedTarget))setTimeout(()=>refresh(true).catch(error=>markStatus(error.message,true)),0);});
  if(channel)channel.onmessage=event=>{if(event.data?.type==='changed')refresh().catch(error=>markStatus(error.message,true));};
  window.HandoffAssessment={
    refresh:()=>refresh(true),negativeGate:(...args)=>negativeGate(...args),
    snapshot:()=>({review_records:structuredClone(rows.filter(r=>r.updated_at)),reviewer:structuredClone(reviewer),reviewer_updated_at:reviewerUpdatedAt}),
    async attachEvidence(id,reference){
      let row=rows.find(r=>r.id===id);
      const persisted=(await store.getReviews()).find(r=>r.id===id);
      if(!row&&persisted){row=persisted;rows.push(row);}
      if(!row){const parts=id.split(':'),table=parts[0];
        if(table==='CASE_REVIEW'&&getCase(parts[1]))row=tableRow(table,parts[1],{case_id:parts[1]});
        else if(table==='CONTACT_REVIEW'&&getCase(parts[1])?.contacts.some(c=>c.contact_id===parts[2]))row=tableRow(table,parts[1]+':'+parts[2],{case_id:parts[1],contact_id:parts[2]});
        else if(table==='COVERAGE_LOG'&&getCase(parts[1])?.volumes.some(v=>v.volume_id===parts[2]))row=tableRow(table,parts[1]+':'+parts[2],{case_id:parts[1],volume_id:parts[2]});
        else if(table==='ADDITIONAL_CONTACTS'){const a=(await store.getAll()).find(a=>a.id===parts[1]);if(a)row=tableRow(table,a.id,{case_id:a.case_id,new_contact_id:'N'+a.number,annotation_id:a.id,volume_id:a.volume_id,x_nm:String(a.point_nm[0]),y_nm:String(a.point_nm[1]),z_nm:String(a.point_nm[2])});}
      }
      if(!row)throw new Error('Не найдена строка анатомической оценки.');const refs=new Set([persisted?.data.evidence_refs||'',row.data.evidence_refs||'',reference].flatMap(s=>s.split('\n')).filter(Boolean));writeRow(row,{evidence_refs:[...refs].join('\n')});const input=host.querySelector('[data-review-id="'+CSS.escape(id)+'"][data-field="evidence_refs"]');if(input)input.value=row.data.evidence_refs;
    },
  };
  window.StructuredReview={negativeGate:(...args)=>negativeGate(...args),exportGuard:backup=>{
    const values=backup?.review_records||rows,marks=backup?.annotations||annotations,issues=[];
    for(const row of values.filter(r=>r.table==='CASE_REVIEW'&&r.data.bounded_no_additional_contact==='support')){
      const gate=negativeGate(row.case_id,values,marks);if(!gate.allowed)issues.push({case_id:row.case_id,reasons:gate.reasons});
    }
    return{allowed:issues.length===0,issues};
  }};
  boot();
})();
