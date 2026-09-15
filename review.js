(() => {
  'use strict';
  const {el,data}=window.HandoffUI,$=id=>document.getElementById(id),storeKey='microns-russian-review-20260915-v2',core=window.ReviewCore;
  const readonly=new Set(['case_id','contact_id','new_contact_id']);
  const longFields=new Set(['evidence_refs','limitations','exposure_notes','reason_or_uncertainty','missing_regions_or_defects','extra_crop_request_nm_bounds','relevant_serial_EM_experience','consultation_or_reconciliation_notes','overall_summary','pilot_feedback']);
  data.reviewer_fields.push({key:'pilot_feedback',label:'Итоги пилота и оценка дальнейшей работы',help:'Укажите фактическое время (включая настройку), достаточность материалов, затруднения и оценку трудоёмкости всех 42 случаев с допущениями и неопределённостью.'});
  let draft={schema_version:1,package_id:data.case_metadata.package_id,base_package_id:data.case_metadata.base_package_id,updated_at:null,reviewer:Object.fromEntries(data.reviewer_fields.map(f=>[f.key,f.key==='package_id'?data.case_metadata.base_package_id:''])),forms:JSON.parse(JSON.stringify(data.templates))};
  let storageAvailable=true;
  function announce(message,error=false){$('saveStatus').textContent=message;$('saveStatus').classList.toggle('save-error',error);}
  try{const saved=localStorage.getItem(storeKey);if(saved)draft=core.validateDraft(JSON.parse(saved),data);}catch(error){announce('Сохранённый черновик недоступен. Можно открыть файл JSON или заполнить новые формы.',true);}
  function save(){draft.updated_at=new Date().toISOString();try{localStorage.setItem(storeKey,JSON.stringify(draft));storageAvailable=true;announce('Черновик сохранён в этом браузере · '+new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}));}catch(error){storageAvailable=false;announce('Браузер не сохранил черновик. Скачайте результаты перед закрытием страницы.',true);}progress();}
  const numeric=new Set(['minutes_spent','x_nm','y_nm','z_nm']);
  function field(key,row,label,help,caseId){
    const wrapper=el('label',undefined,'form-field'+(longFields.has(key)?' wide':''));wrapper.append(el('span',label||data.field_labels[key]||key));let input;
    const group=data.field_choice_groups[key];
    if(group){input=el('select');for(const value of ['',...data.choice_groups[group]])input.add(new Option(data.choice_mapping[value],value));}
    else if(key==='volume_id'){input=el('select');for(const v of data.case_metadata.cases.find(c=>c.case_id===caseId).volumes)input.add(new Option(v.volume_id.replace('-main',' · основной').replace('-extension-',' · расширение '),v.volume_id));}
    else if(longFields.has(key)){input=el('textarea');input.rows=3;}
    else{input=el('input');input.type=key==='review_date'?'date':numeric.has(key)?'number':'text';if(numeric.has(key)){input.step=key==='minutes_spent'?'0.1':'any';if(key==='minutes_spent')input.min=0;}}
    input.value=row[key]??'';input.name=key;
    if(readonly.has(key)||key==='package_id')input.readOnly=true;
    input.addEventListener('input',()=>{row[key]=input.value;save();});wrapper.append(input);
    const tip=help||data.field_help[key];if(tip)wrapper.append(el('small',tip));return wrapper;
  }
  function reviewer(){const container=$('reviewerFields');container.replaceChildren();for(const spec of data.reviewer_fields)container.append(field(spec.key,draft.reviewer,spec.label,spec.help));}
  function progress(){const id=$('reviewCase').value;let filled=0,total=0;for(const [name,keys] of Object.entries(data.form_fields)){for(const row of draft.forms[name].filter(r=>r.case_id===id)){for(const key of keys.filter(k=>!readonly.has(k)&&k!=='volume_id')){total++;if(row[key])filled++;}}}$('caseProgress').textContent=filled+' из '+total+' полей заполнено · это не показатель полноты проверки';}
  function blank(name,caseId){return Object.fromEntries(data.form_fields[name].map(key=>[key,key==='case_id'?caseId:key==='volume_id'?data.case_metadata.cases.find(c=>c.case_id===caseId).volumes[0].volume_id:'']));}
  function render(caseId=$('reviewCase').value){
    const current=$('reviewForms'),open=new Set([...current.querySelectorAll('details[open]')].map(n=>n.dataset.form));current.replaceChildren();
    for(const [name,definition] of Object.entries(data.forms)){
      const section=el('details',undefined,'form-section');section.dataset.form=name;section.open=open.size?open.has(name):name==='CASE_REVIEW';section.append(el('summary',definition.title),el('p',definition.description,'section-help'));
      if(name==='CASE_REVIEW')section.append(el('p',data.field_help.bounded_no_additional_contact,'section-help'));
      const rows=draft.forms[name].filter(r=>r.case_id===caseId);
      if(!rows.length)section.append(el('p','Дополнительные кандидаты пока не записаны. Это не означает, что их нет.','hint'));
      rows.forEach((row,index)=>{
        const record=el('div',undefined,'form-record');const title=name==='CONTACT_REVIEW'?row.contact_id:name==='ADDITIONAL_CONTACTS'?row.new_contact_id:name==='COVERAGE_LOG'?'Область '+(index+1):caseId;
        record.append(el('h3',title));const grid=el('div',undefined,'form-grid');for(const key of data.form_fields[name])if(!readonly.has(key))grid.append(field(key,row,null,null,caseId));record.append(grid);
        if(name==='ADDITIONAL_CONTACTS'||name==='COVERAGE_LOG'&&rows.length>1){const remove=el('button','Удалить пустую строку');remove.disabled=data.form_fields[name].some(k=>!readonly.has(k)&&k!=='volume_id'&&row[k]);record.append(remove);record.addEventListener('input',()=>remove.disabled=data.form_fields[name].some(k=>!readonly.has(k)&&k!=='volume_id'&&row[k]));remove.addEventListener('click',()=>{draft.forms[name].splice(draft.forms[name].indexOf(row),1);save();render(caseId);});}
        section.append(record);
      });
      const actions=el('div',undefined,'form-actions');
      if(['ADDITIONAL_CONTACTS','COVERAGE_LOG'].includes(name)){const button=el('button',name==='ADDITIONAL_CONTACTS'?'Добавить кандидата':'Добавить область');button.addEventListener('click',()=>{const row=blank(name,caseId);if(name==='ADDITIONAL_CONTACTS')row.new_contact_id='N'+(Math.max(0,...rows.map(r=>Number(r.new_contact_id.slice(1))))+1);draft.forms[name].push(row);section.open=true;save();render(caseId);});actions.append(button);}
      const download=el('button','Скачать эту форму CSV');download.addEventListener('click',()=>downloadFile(core.csv(data.form_fields[name],draft.forms[name]),name+'.csv','text/csv;charset=utf-8'));actions.append(download);section.append(actions);current.append(section);
    }
    progress();
  }
  function downloadFile(content,name,type){const blob=content instanceof Blob?content:new Blob([content],{type}),url=URL.createObjectURL(blob),a=el('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),5000);}
  $('exportAll').addEventListener('click',()=>{save();const files=Object.keys(data.forms).map(name=>({name:name+'.csv',text:core.csv(data.form_fields[name],draft.forms[name])}));files.push({name:'REVIEWER_INFO.csv',text:core.csv(['field','value'],data.reviewer_fields.map(f=>({field:f.key,value:draft.reviewer[f.key]||''})))});files.push({name:'MICRONS_REVIEW_DRAFT.json',text:JSON.stringify(draft,null,2)});downloadFile(core.zip(files),'MICrONS_review_'+new Date().toISOString().slice(0,10)+'.zip');announce('Результаты подготовлены к скачиванию. Приложите сохранённые PNG отдельно.',!storageAvailable);});
  $('importReview').addEventListener('change',async event=>{const file=event.target.files[0];if(!file)return;try{if(file.size>10*1024*1024)throw new Error('Файл черновика слишком большой.');const value=core.validateDraft(JSON.parse(await file.text()),data);draft=value;reviewer();render();save();announce('Сохранённый черновик открыт.');}catch(error){announce('Не удалось открыть черновик: '+error.message,true);}event.target.value='';});
  window.addEventListener('beforeunload',event=>{if(!storageAvailable&&draft.updated_at){event.preventDefault();event.returnValue='';}});
  window.renderReviewCase=render;reviewer();render();
})();
