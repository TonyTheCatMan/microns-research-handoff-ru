/* Durable, case-scoped researcher findings. Coordinates are global physical nm. */
(() => {
  'use strict';
  const SCHEMA_VERSION=3, FORMAT='microns-researcher-findings', MAX_RECORDS=100000;
  const FORM_FIELDS={CASE_REVIEW:['case_id','reviewer_name','review_date','minutes_spent','common_head','neck_to_shaft','unitary_spine','at_least_two_contacts_same_spine','bounded_no_additional_contact','confidence','evidence_refs','limitations','prior_verdicts_seen','functional_results_seen','exposure_notes'],CONTACT_REVIEW:['case_id','contact_id','synaptic_junction','belongs_to_target_spine','location_head_neck_shaft','evidence_refs','reason_or_uncertainty'],ADDITIONAL_CONTACTS:['case_id','new_contact_id','volume_id','x_nm','y_nm','z_nm','synaptic_junction','belongs_to_target_spine','location_head_neck_shaft','evidence_refs','reason_or_uncertainty'],COVERAGE_LOG:['case_id','volume_id','inspected_local_z_inclusive','inspected_global_z_inclusive','inspected_xy_global_bounds','head_fully_included','neck_to_shaft_fully_included','all_relevant_available_sections_inspected','complete_membrane_inspected','continuous_boundary_resolved','missing_regions_or_defects','extra_crop_request_nm_bounds','evidence_refs']};
  const EXTRA_FIELDS={CASE_REVIEW:['combined_head_included','combined_neck_included','combined_all_sections_inspected','combined_complete_membrane','combined_boundary_resolved'],CONTACT_REVIEW:['junction_morphology','presynaptic_ownership','postsynaptic_ownership','ownership_notes'],ADDITIONAL_CONTACTS:['annotation_id','junction_morphology','presynaptic_ownership','postsynaptic_ownership','ownership_notes'],COVERAGE_LOG:[]};
  const REVIEWER_FIELDS=['package_id','reviewer_name','affiliation','professional_contact','relevant_serial_EM_experience','review_dates','software_and_version','assigned_cases','completed_cases','prior_verdicts_seen','functional_results_seen','exposure_notes','independent_initial_assessment','consultation_or_reconciliation','limitations_and_next_steps','signed_or_confirmed_by','confirmation_date'];
  const ENUM_FIELDS={};
  for(const key of ['common_head','neck_to_shaft','unitary_spine','at_least_two_contacts_same_spine','bounded_no_additional_contact'])ENUM_FIELDS[key]=['','support','uncertain','contradiction','not_applicable'];
  for(const key of ['synaptic_junction','belongs_to_target_spine','presynaptic_ownership','postsynaptic_ownership'])ENUM_FIELDS[key]=['','support','uncertain','contradiction'];
  for(const key of ['head_fully_included','neck_to_shaft_fully_included','all_relevant_available_sections_inspected','complete_membrane_inspected','continuous_boundary_resolved',...EXTRA_FIELDS.CASE_REVIEW])ENUM_FIELDS[key]=['','yes','no','uncertain'];
  for(const key of ['prior_verdicts_seen','functional_results_seen','independent_initial_assessment'])ENUM_FIELDS[key]=['','yes','no'];
  ENUM_FIELDS.location_head_neck_shaft=['','head','neck','shaft','other','uncertain'];ENUM_FIELDS.confidence=['','high','moderate','low'];
  const kinds=['contact','point','object','region'], statuses=['uncertain','supported','rejected','note'], locations=['head','neck','shaft','other','uncertain'];
  const observationCategories=['unclassified','suspected_synapse','possible_adhesion','unresolved_other'];
  const encoder=new TextEncoder();
  const clone=value=>JSON.parse(JSON.stringify(value));
  const now=previous=>new Date(Math.max(Date.now(),previous?Date.parse(previous)+1:0)).toISOString();
  const fail=message=>{throw new Error(message);};
  const uuid=()=>globalThis.crypto.randomUUID();
  const request=req=>new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
  const point=value=>Array.isArray(value)&&value.length===3&&value.every(v=>typeof v==='number'&&Number.isFinite(v));
  function plain(value,name,max=100000){if(typeof value!=='string'||value.length>max)fail('Неверное текстовое поле: '+name);return value;}
  function timestamp(value){if(typeof value!=='string'||!/^\d{4}-\d\d-\d\dT/.test(value)||!Number.isFinite(Date.parse(value)))fail('Неверная дата записи.');return value;}
  function choice(value,values,name){if(!values.includes(value))fail('Неверное значение: '+name);return value;}
  function context(metadata){
    const source=metadata.case_metadata||metadata;
    if(!source.package_id||!Array.isArray(source.cases))fail('Не найдены сведения о пакете.');
    return {package_id:source.package_id,cases:new Map(source.cases.map(c=>[c.case_id,c])),resolution_nm:source.resolution_nm};
  }
  function volumeInfo(ctx,case_id,volume_id){
    const c=ctx.cases.get(case_id);if(!c)fail('Неизвестный случай: '+case_id);
    const v=c.volumes.find(v=>v.volume_id===volume_id);if(!v)fail('Объём не соответствует случаю '+case_id);
    const res=v.resolution_nm||ctx.resolution_nm;
    const min=v.begin_vox_xyz.map((v,i)=>v*res[i]);
    const max=(v.end_vox_xyz_exclusive||v.begin_vox_xyz.map((b,i)=>b+v.shape_xyz[i])).map((v,i)=>v*res[i]);
    return {v,res,min,max};
  }
  function validateRecord(value,ctx){
    if(!value||typeof value!=='object'||Array.isArray(value))fail('Неверная запись аннотации.');
    if(typeof value.id!=='string'||! /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.id))fail('Неверный уникальный ID аннотации.');
    if(!Number.isSafeInteger(value.number)||value.number<1)fail('Неверный номер аннотации.');
    const {min,max}=volumeInfo(ctx,value.case_id,value.volume_id);
    if(!point(value.point_nm)||value.point_nm.some((v,i)=>v<min[i]||v>=max[i]))fail('Точка находится вне указанного объёма.');
    const result={id:value.id,number:value.number,case_id:value.case_id,volume_id:value.volume_id,point_nm:[...value.point_nm],
      kind:choice(value.kind,kinds,'тип'),label:plain(value.label??'','название',1000),
      segment_id:value.segment_id??null,object_id:value.object_id??null,
      status:choice(value.status,statuses,'статус'),location:choice(value.location,locations,'часть структуры'),
      observation_category:choice(value.observation_category??'unclassified',observationCategories,'категория наблюдения'),
      evidence_refs:plain(value.evidence_refs??'','ссылки на доказательства'),
      properties:plain(value.properties??'','свойства'),notes:plain(value.notes??'','заметки'),
      source_view:choice(value.source_view||'2d',['2d','3d'],'источник точки'),
      created_at:timestamp(value.created_at),updated_at:timestamp(value.updated_at)};
    if(result.segment_id!==null&&(typeof result.segment_id!=='string'||!/^\d{1,20}$/.test(result.segment_id)||BigInt(result.segment_id)>18446744073709551615n))fail('ID сегмента должен быть строкой целых цифр, без потери точности.');
    if(result.object_id!==null)plain(result.object_id,'ID объекта',1000);
    if(Date.parse(result.updated_at)<Date.parse(result.created_at))fail('Дата изменения предшествует созданию.');
    if(value.bounds_nm!==undefined&&value.bounds_nm!==null){
      const b=value.bounds_nm;
      if(!b||!point(b.min)||!point(b.max)||b.min.some((n,i)=>n>=b.max[i]||n<min[i]||b.max[i]>max[i]||result.point_nm[i]<n||result.point_nm[i]>b.max[i]))fail('Неверные границы области.');
      result.bounds_nm={min:[...b.min],max:[...b.max]};
    }
    return result;
  }
  function validateCase(value,ctx){
    if(!value||!ctx.cases.has(value.case_id))fail('Неизвестный случай в заметках.');
    return {case_id:value.case_id,notes:plain(value.notes??'','заметки случая'),coverage:choice(value.coverage||'uncertain',['uncertain','incomplete','complete'],'полнота просмотра'),
      inspected_regions:plain(value.inspected_regions??'','просмотренные области'),extra_extent:plain(value.extra_extent??'','нужное расширение'),updated_at:timestamp(value.updated_at)};
  }
  function validateCounter(value,ctx){
    if(!value||!ctx.cases.has(value.case_id)||!Number.isSafeInteger(value.last_number)||value.last_number<0)fail('Неверный счётчик аннотаций.');
    return {case_id:value.case_id,last_number:value.last_number};
  }
  function validateDeleted(value,ctx){
    if(!value||!ctx.cases.has(value.case_id)||typeof value.id!=='string'||! /^[0-9a-f-]{36}$/i.test(value.id)||!Number.isSafeInteger(value.number)||value.number<1)fail('Неверная запись удаления.');
    return {id:value.id,case_id:value.case_id,number:value.number,deleted_at:timestamp(value.deleted_at)};
  }
  function validateReview(value,ctx){
    if(!value||!FORM_FIELDS[value.table]||!ctx.cases.has(value.case_id)||!value.data||typeof value.data!=='object'||Array.isArray(value.data))fail('Неверная запись анатомической проверки.');
    const allowed=[...FORM_FIELDS[value.table],...EXTRA_FIELDS[value.table]],data={};
    for(const [key,val] of Object.entries(value.data)){if(!allowed.includes(key))fail('Неизвестное поле проверки: '+key);data[key]=plain(val,key);if(ENUM_FIELDS[key])choice(val,ENUM_FIELDS[key],key);}
    if(data.case_id!==value.case_id)fail('Случай формы не соответствует записи.');
    if(data.volume_id)volumeInfo(ctx,value.case_id,data.volume_id);
    const c=ctx.cases.get(value.case_id);
    let id;
    if(value.table==='CASE_REVIEW')id=value.table+':'+value.case_id;
    if(value.table==='CONTACT_REVIEW'){if(!c.contacts.some(r=>r.contact_id===data.contact_id))fail('Неизвестный заданный контакт.');id=value.table+':'+value.case_id+':'+data.contact_id;}
    if(value.table==='COVERAGE_LOG'){if(!data.volume_id)fail('Не указан объём журнала покрытия.');id=value.table+':'+value.case_id+':'+data.volume_id;}
    if(value.table==='ADDITIONAL_CONTACTS'){
      if(typeof data.annotation_id!=='string'||!/^[0-9a-f-]{36}$/i.test(data.annotation_id))fail('Не указан ID нового контакта.');id=value.table+':'+data.annotation_id;
      if(data.new_contact_id&&!/^N[1-9]\d*$/.test(data.new_contact_id))fail('Неверный номер нового контакта.');
      const coordKeys=['x_nm','y_nm','z_nm'];if(coordKeys.some(k=>data[k])){if(!data.volume_id||coordKeys.some(k=>!data[k]||!Number.isFinite(Number(data[k]))))fail('Неверные координаты нового контакта.');const {min,max}=volumeInfo(ctx,value.case_id,data.volume_id);if(coordKeys.some((k,i)=>Number(data[k])<min[i]||Number(data[k])>=max[i]))fail('Контакт вне объёма.');}
    }
    if(value.id!==id)fail('Неверный ID формы.');
    return {id,table:value.table,case_id:value.case_id,data,updated_at:timestamp(value.updated_at)};
  }
  function validateReviewer(value){
    if(!value||typeof value!=='object'||Array.isArray(value))fail('Неверные сведения об исследователе.');const result={};
    for(const [key,val] of Object.entries(value)){if(!REVIEWER_FIELDS.includes(key))fail('Неизвестное поле исследователя: '+key);result[key]=plain(val,key);if(ENUM_FIELDS[key])choice(val,ENUM_FIELDS[key],key);}return result;
  }
  function safeJSON(value){
    let nodes=0;const check=(v,depth)=>{if(++nodes>10000||depth>12)fail('Слишком сложные настройки вида.');if(v===null||typeof v==='boolean'||typeof v==='string'&&v.length<=10000||typeof v==='number'&&Number.isFinite(v))return;if(Array.isArray(v)){v.forEach(x=>check(x,depth+1));return;}if(v&&typeof v==='object'&&Object.getPrototypeOf(v)===Object.prototype){for(const [k,x] of Object.entries(v)){if(['__proto__','constructor','prototype'].includes(k))fail('Неверное поле настроек вида.');check(x,depth+1);}return;}fail('Неверные настройки вида.');};check(value,0);return clone(value);
  }
  function validateCameraBasis(view){
    const basis=view.camera?.basis;if(basis===undefined)return;
    if(!basis||typeof basis!=='object'||Array.isArray(basis))fail('Неверный базис сохранённой камеры.');
    const vectors=[basis.right,basis.up,basis.eye_direction],dot=(a,b)=>a.reduce((s,n,i)=>s+n*b[i],0);
    if(vectors.some(v=>!point(v)||Math.abs(Math.hypot(...v)-1)>.001)||Math.abs(dot(vectors[0],vectors[1]))>.001||Math.abs(dot(vectors[0],vectors[2]))>.001||Math.abs(dot(vectors[1],vectors[2]))>.001)fail('Неверный базис сохранённой камеры.');
    const [right,up,eye]=vectors,cross=[right[1]*up[2]-right[2]*up[1],right[2]*up[0]-right[0]*up[2],right[0]*up[1]-right[1]*up[0]];
    if(dot(cross,eye)<.999)fail('Неверное направление сохранённой камеры.');
  }
  function validateSettings(value,ctx){
    if(!value||typeof value!=='object'||Array.isArray(value))fail('Неверные настройки интерфейса.');
    const allowed=['preferences','last_view','annotation_mode','display','surface_view'],result={};
    if(Object.keys(value).some(k=>!allowed.includes(k)))fail('Неизвестный раздел настроек.');
    if(value.preferences!==undefined){
      const prefs=value.preferences,keys=['overlayToggle','tCenter','tPre','tPost','annotationsVisible','surfaceContext','segmentation2D','segmentationBorders','surfaceSegmentation'],numbers={segmentationOpacity:70,surfaceContextOpacity:100,surfaceSegmentationOpacity:100};
      if(!prefs||typeof prefs!=='object'||Array.isArray(prefs)||Object.entries(prefs).some(([k,v])=>keys.includes(k)?typeof v!=='boolean':Object.hasOwn(numbers,k)?typeof v!=='number'||!Number.isFinite(v)||v<0||v>numbers[k]:k==='surfaceContextMode'?!['slice','full'].includes(v):k==='segmentationScope'?!['nearby','all'].includes(v):k==='segmentationLimit'?!Number.isSafeInteger(v)||v<1||v>30:true))fail('Неверные настройки видимости.');result.preferences={...prefs};
    }
    if(value.last_view!==undefined){const v=value.last_view;if(!v||typeof v!=='object')fail('Неверный последний вид.');const {v:volume}=volumeInfo(ctx,v.case_id,v.volume_id);if(!Number.isSafeInteger(v.z)||v.z<0||v.z>=volume.shape_xyz[2])fail('Последний срез вне объёма.');result.last_view={case_id:v.case_id,volume_id:v.volume_id,z:v.z};}
    if(value.annotation_mode!==undefined)result.annotation_mode=choice(value.annotation_mode,['navigate','contact2d','point2d','point3d','object3d'],'инструмент');
    if(value.display!==undefined){const d=value.display;if(!d||typeof d!=='object'||Object.keys(d).some(k=>!['zoom','black','white'].includes(k))||Object.values(d).some(n=>typeof n!=='number'||!Number.isFinite(n)))fail('Неверные настройки изображения.');if(d.zoom!==undefined&&(d.zoom<=0||d.zoom>128)||d.black!==undefined&&(d.black<0||d.black>255)||d.white!==undefined&&(d.white<0||d.white>255)||d.black!==undefined&&d.white!==undefined&&d.black>=d.white)fail('Настройки изображения вне диапазона.');result.display={...d};}
    if(value.surface_view!==undefined){const view=safeJSON(value.surface_view);if(!view||typeof view!=='object'||Array.isArray(view))fail('Неверный сохранённый 3D-вид.');const {v}=volumeInfo(ctx,view.case_id,view.volume_id);if(view.local_z!==undefined&&(!Number.isSafeInteger(view.local_z)||view.local_z<0||view.local_z>=v.shape_xyz[2]))fail('Срез 3D-вида вне объёма.');validateCameraBasis(view);result.surface_view=view;}
    if(result.last_view&&result.surface_view){const last=result.last_view,view=result.surface_view;if(view.case_id!==last.case_id||view.volume_id!==last.volume_id||view.local_z!==undefined&&view.local_z!==last.z)delete result.surface_view;}
    return result;
  }
  function validateEvidence(value,ctx){
    if(!value||typeof value.id!=='string'||!/^[0-9a-f-]{36}$/i.test(value.id))fail('Неверный ID изображения-доказательства.');
    const {v,res,min,max}=volumeInfo(ctx,value.case_id,value.volume_id);
    if(!Number.isSafeInteger(value.local_z)||value.local_z<0||value.local_z>=v.shape_xyz[2]||value.global_z!==v.begin_vox_xyz[2]+value.local_z)fail('Срез доказательства не соответствует объёму.');
    const source_view=choice(value.source_view||'2d',['2d','3d'],'вид доказательства');
    if(value.point_nm!==undefined&&value.point_nm!==null&&(!point(value.point_nm)||value.point_nm.some((n,i)=>n<min[i]||n>=max[i])||source_view==='2d'&&Math.floor(value.point_nm[2]/res[2])-v.begin_vox_xyz[2]!==value.local_z))fail('Точка доказательства не соответствует срезу.');
    const result={id:value.id,case_id:value.case_id,volume_id:value.volume_id,annotation_id:value.annotation_id??null,contact_id:value.contact_id??null,local_z:value.local_z,global_z:value.global_z,point_nm:value.point_nm?[...value.point_nm]:null,caption:plain(value.caption??'','подпись доказательства'),created_at:timestamp(value.created_at),updated_at:timestamp(value.updated_at),source_view,capture_origin:choice(value.capture_origin??'legacy_unknown',['manual','current_export','legacy_unknown'],'происхождение снимка'),linked_to_slice:source_view==='2d'||value.linked_to_slice===true,annotated_file:'evidence/'+value.id+(source_view==='3d'?'/3d-navigation.png':'/annotated.png'),raw_file:source_view==='3d'?null:'evidence/'+value.id+'/raw.png'};
    if(value.annotated_file?.startsWith('images/')){if(!/^images\/[A-Za-z0-9_.-]+\.png$/.test(value.annotated_file))fail('Неверное имя снимка.');result.annotated_file=value.annotated_file;}
    if(value.capture_signature!==undefined){if(!/^[0-9a-f]{64}$/.test(value.capture_signature))fail('Неверная подпись снимка.');result.capture_signature=value.capture_signature;}
    if(result.annotation_id!==null&&(typeof result.annotation_id!=='string'||!/^[0-9a-f-]{36}$/i.test(result.annotation_id)))fail('Неверная ссылка на аннотацию.');
    if(result.contact_id!==null&&!ctx.cases.get(value.case_id).contacts.some(r=>r.contact_id===result.contact_id)&&!/^N[1-9]\d*$/.test(result.contact_id))fail('Неверная ссылка на контакт.');
    if(value.display_window!==undefined){if(!Array.isArray(value.display_window)||value.display_window.length!==2||!value.display_window.every(Number.isFinite)||value.display_window[0]>=value.display_window[1])fail('Неверная яркость доказательства.');result.display_window=[...value.display_window];}
    if(value.segmentation2d!==undefined){
      const s=value.segmentation2d,keys=['included','source_version','volume_id','local_z','fill','borders','opacity','boundary_method','scope','nearby_limit','segment_ids','focus_local_nm'];
      if(source_view!=='2d'||!s||typeof s!=='object'||Array.isArray(s)||Object.keys(s).some(k=>!keys.includes(k))||typeof s.included!=='boolean'||s.volume_id!==value.volume_id||s.local_z!==value.local_z||s.source_version!=='seg_m1300')fail('Настройки сегментации не соответствуют снимку.');
      if(s.included&&(typeof s.fill!=='boolean'||typeof s.borders!=='boolean'||typeof s.opacity!=='number'||!Number.isFinite(s.opacity)||s.opacity<0||s.opacity>1||s.boundary_method!=='native_xy_label_transition_pixels'))fail('Неверные настройки слоя сегментации.');
      if(s.scope!==undefined&&!['nearby','all'].includes(s.scope)||s.nearby_limit!==undefined&&(!Number.isSafeInteger(s.nearby_limit)||s.nearby_limit<1||s.nearby_limit>30)||s.segment_ids!==undefined&&(!Array.isArray(s.segment_ids)||s.segment_ids.length>MAX_RECORDS||s.segment_ids.some(id=>typeof id!=='string'||!/^\d+$/.test(id)||/^0+$/.test(id))||new Set(s.segment_ids).size!==s.segment_ids.length)||s.focus_local_nm!==undefined&&!point(s.focus_local_nm))fail('Неверные настройки выбора ближайших сегментов.');
      result.segmentation2d=clone(s);
    }
    if(value.t_points_visible!==undefined)result.t_points_visible=!!value.t_points_visible;
    if(value.annotation_numbers!==undefined){if(!Array.isArray(value.annotation_numbers)||!value.annotation_numbers.every(n=>Number.isSafeInteger(n)&&n>0))fail('Неверные номера меток.');result.annotation_numbers=[...value.annotation_numbers];}
    if(value.review_id!==undefined&&value.review_id!==null)result.review_id=plain(value.review_id,'ID формы',1000);
    if(value.table!==undefined&&value.table!==null)result.table=choice(value.table,Object.keys(FORM_FIELDS),'форма доказательства');
    if(value.resolution_nm!==undefined){if(!point(value.resolution_nm)||value.resolution_nm.some((n,i)=>n!==res[i]))fail('Размер вокселя доказательства не соответствует объёму.');result.resolution_nm=[...res];}
    if(value.tiff_sha256!==undefined){if(typeof value.tiff_sha256!=='string'||value.tiff_sha256!==v.tiff_sha256)fail('Контрольная сумма TIFF не соответствует объёму.');result.tiff_sha256=value.tiff_sha256;}
    if(value.annotation_ids!==undefined){if(!Array.isArray(value.annotation_ids)||value.annotation_ids.length>MAX_RECORDS||value.annotation_ids.some(id=>typeof id!=='string'||!/^[0-9a-f-]{36}$/i.test(id)))fail('Неверный список связанных отметок.');result.annotation_ids=[...new Set(value.annotation_ids)];}
    if(value.linked_evidence_id!==undefined&&value.linked_evidence_id!==null){if(typeof value.linked_evidence_id!=='string'||!/^[0-9a-f-]{36}$/i.test(value.linked_evidence_id))fail('Неверная ссылка на парное доказательство.');result.linked_evidence_id=value.linked_evidence_id;}
    if(value.view_settings!==undefined){
      const view=safeJSON(value.view_settings);if(!view||typeof view!=='object'||Array.isArray(view))fail('Неверные настройки вида.');
      if(view.case_id&&view.case_id!==value.case_id||view.volume_id&&view.volume_id!==value.volume_id)fail('Настройки вида не соответствуют случаю и объёму.');validateCameraBasis(view);result.view_settings=view;
    }
    return result;
  }
  const evidenceMatches=(r,filter)=>!filter.section||(r.source_view!=='3d'||r.linked_to_slice)&&filter.section.axis==='z'&&filter.section.index===r.local_z;
  function validatePackage(value,ctx){
    if(!value||value.format!==FORMAT||![1,2,SCHEMA_VERSION].includes(value.schema_version)||value.package_id!==ctx.package_id)fail('Этот файл не является резервной копией аннотаций данного пакета MICrONS.');
    for(const key of ['annotations','cases','counters','deleted'])if(!Array.isArray(value[key])||value[key].length>MAX_RECORDS)fail('Неверный список: '+key);
    for(const key of ['review_records','evidence'])if(value[key]!==undefined&&(!Array.isArray(value[key])||value[key].length>MAX_RECORDS))fail('Неверный список: '+key);
    const result={...value,annotations:value.annotations.map(v=>validateRecord(v,ctx)),cases:value.cases.map(v=>validateCase(v,ctx)),counters:value.counters.map(v=>validateCounter(v,ctx)),deleted:value.deleted.map(v=>validateDeleted(v,ctx)),review_records:(value.review_records||[]).map(v=>validateReview(v,ctx)),reviewer:validateReviewer(value.reviewer||{}),reviewer_updated_at:value.reviewer_updated_at?timestamp(value.reviewer_updated_at):null,evidence:(value.evidence||[]).map(v=>validateEvidence(v,ctx)),settings:validateSettings(value.settings||{},ctx),settings_updated_at:value.settings_updated_at?timestamp(value.settings_updated_at):null};
    const seen=new Set(),numbers=new Set();
    for(const a of result.annotations){if(seen.has(a.id)||numbers.has(a.case_id+':'+a.number))fail('Повторяющийся ID или номер аннотации.');seen.add(a.id);numbers.add(a.case_id+':'+a.number);}
    for(const d of result.deleted){if(seen.has(d.id))fail('Повторяющийся ID удалённой аннотации.');seen.add(d.id);}
    for(const name of ['cases','counters']){const ids=new Set();for(const r of result[name]){if(ids.has(r.case_id))fail('Повторяющаяся запись случая.');ids.add(r.case_id);}}
    for(const name of ['review_records','evidence']){const ids=new Set();for(const r of result[name]){if(ids.has(r.id))fail('Повторяющийся ID записи проверки.');ids.add(r.id);}}
    return result;
  }
  function transaction(db,names,mode,operation){
    return new Promise((resolve,reject)=>{
      let tx,result,failure;
      try{tx=db.transaction(names,mode);}catch(error){reject(error);return;}
      tx.oncomplete=()=>resolve(result);
      tx.onabort=()=>reject(failure||tx.error||new Error('Сохранение прервано. Повторите действие.'));
      tx.onerror=()=>{};
      Promise.resolve().then(()=>operation(tx)).then(value=>{result=value;},error=>{failure=error;try{tx.abort();}catch(_){reject(error);}});
    });
  }
  function match(record,filter,ctx){
    if(filter.case_id&&record.case_id!==filter.case_id)return false;
    if(filter.volume_id){if(!ctx.cases.get(record.case_id)?.volumes.some(v=>v.volume_id===filter.volume_id))return false;const {min,max}=volumeInfo(ctx,record.case_id,filter.volume_id);if(record.point_nm.some((n,i)=>n<min[i]||n>=max[i]))return false;}
    if(filter.section){
      if(!filter.volume_id)fail('Для среза необходимо указать объём.');
      const {v,res}=volumeInfo(ctx,record.case_id,filter.volume_id),axis=['x','y','z'].indexOf(filter.section.axis);
      if(axis<0||!Number.isSafeInteger(filter.section.index)||filter.section.index<0||filter.section.index>=v.shape_xyz[axis])fail('Неверный индекс среза.');
      if(Math.floor(record.point_nm[axis]/res[axis])-v.begin_vox_xyz[axis]!==filter.section.index)return false;
    }
    return true;
  }
  class Store {
    constructor(db,ctx){this.db=db;this.context=ctx;this.storagePersistent=null;}
    close(){this.db.close();}
    async getAll(filter={}){const rows=await transaction(this.db,['annotations'],'readonly',tx=>request(tx.objectStore('annotations').getAll()));return rows.filter(row=>match(row,filter,this.context)).map(row=>validateRecord(row,this.context)).sort((a,b)=>a.case_id.localeCompare(b.case_id)||a.number-b.number);}
    async getCases(filter={}){return (await transaction(this.db,['cases'],'readonly',tx=>request(tx.objectStore('cases').getAll()))).filter(row=>!filter.case_id||row.case_id===filter.case_id);}
    async add(input){
      return transaction(this.db,['annotations','counters'],'readwrite',async tx=>{
        if(!this.context.cases.has(input.case_id))fail('Неизвестный случай.');
        const counters=tx.objectStore('counters'),active=await request(tx.objectStore('annotations').getAll()),number=active.filter(r=>r.case_id===input.case_id).reduce((n,r)=>Math.max(n,r.number),0)+1,t=now();
        const row=validateRecord({...input,id:uuid(),number,label:input.label||'',segment_id:input.segment_id??null,object_id:input.object_id??null,status:input.status||'uncertain',location:input.location||'uncertain',properties:input.properties||'',notes:input.notes||'',kind:input.kind||'contact',created_at:t,updated_at:t},this.context);
        await request(tx.objectStore('annotations').add(row));await request(counters.put({case_id:row.case_id,last_number:number}));return row;
      });
    }
    async update(id,patch,options={}){
      return transaction(this.db,['annotations'],'readwrite',async tx=>{
        const records=tx.objectStore('annotations'),old=await request(records.get(id));if(!old)fail('Аннотация уже удалена. Обновите список.');
        if(options.expected_updated_at&&old.updated_at!==options.expected_updated_at)fail('Аннотация изменена в другом окне. Обновите список перед редактированием.');
        for(const key of ['id','number','case_id','created_at'])if(key in patch&&patch[key]!==old[key])fail('Нельзя изменить идентификатор существующей аннотации.');
        const row=validateRecord({...old,...patch,updated_at:now(old.updated_at)},this.context);await request(records.put(row));return row;
      });
    }
    async remove(id){
      return transaction(this.db,['annotations','deleted'],'readwrite',async tx=>{const records=tx.objectStore('annotations'),row=await request(records.get(id));if(!row)return null;await request(records.delete(id));await request(tx.objectStore('deleted').put({id,case_id:row.case_id,number:row.number,deleted_at:now(row.updated_at)}));return row;});
    }
    async restore(record){
      const validated=validateRecord(record,this.context);
      return transaction(this.db,['annotations','deleted','counters'],'readwrite',async tx=>{
        const records=tx.objectStore('annotations'),existing=await request(records.get(validated.id));if(existing)fail('Аннотация уже существует.');
        const all=await request(records.getAll());if(all.some(r=>r.case_id===validated.case_id&&r.number===validated.number))validated.number=all.filter(r=>r.case_id===validated.case_id).reduce((n,r)=>Math.max(n,r.number),0)+1;
        const deleted=await request(tx.objectStore('deleted').get(validated.id));
        const row={...validated,updated_at:now(deleted?.deleted_at||validated.updated_at)};
        await request(records.add(row));await request(tx.objectStore('deleted').delete(row.id));
        const counters=tx.objectStore('counters'),c=await request(counters.get(row.case_id));await request(counters.put({case_id:row.case_id,last_number:Math.max(c?.last_number||0,row.number)}));return row;
      });
    }
    async putCase(input){
      return transaction(this.db,['cases'],'readwrite',async tx=>{const records=tx.objectStore('cases'),old=await request(records.get(input.case_id));const row=validateCase({...old,...input,updated_at:now(old?.updated_at)},this.context);await request(records.put(row));return row;});
    }
    async getReviews(filter={}){return (await transaction(this.db,['reviews'],'readonly',tx=>request(tx.objectStore('reviews').getAll()))).filter(r=>(!filter.case_id||r.case_id===filter.case_id)&&(!filter.table||r.table===filter.table));}
    async putReview(input){
      return transaction(this.db,['reviews'],'readwrite',async tx=>{const s=tx.objectStore('reviews'),old=await request(s.get(input.id));if(old&&(old.table!==input.table||old.case_id!==input.case_id))fail('Нельзя изменить принадлежность формы.');const row=validateReview({...old,...input,data:{...old?.data,...input.data},updated_at:now(old?.updated_at)},this.context);await request(s.put(row));return row;});
    }
    async removeReview(id){return transaction(this.db,['reviews'],'readwrite',tx=>request(tx.objectStore('reviews').delete(id)));}
    async getReviewer(){const row=await transaction(this.db,['meta'],'readonly',tx=>request(tx.objectStore('meta').get('reviewer')));return row?.value||{};}
    async putReviewer(patch){
      validateReviewer(patch);return transaction(this.db,['meta'],'readwrite',async tx=>{const s=tx.objectStore('meta'),old=await request(s.get('reviewer')),value=validateReviewer({...old?.value,...patch});await request(s.put({key:'reviewer',value,updated_at:now(old?.updated_at)}));return value;});
    }
    async getSettings(){const row=await transaction(this.db,['meta'],'readonly',tx=>request(tx.objectStore('meta').get('settings')));return row?.value||{};}
    async putSettings(patch){
      validateSettings(patch,this.context);return transaction(this.db,['meta'],'readwrite',async tx=>{const s=tx.objectStore('meta'),old=await request(s.get('settings')),merged={...old?.value,...patch};for(const key of ['preferences','display'])if(patch[key])merged[key]={...old?.value?.[key],...patch[key]};const value=validateSettings(merged,this.context);await request(s.put({key:'settings',value,updated_at:now(old?.updated_at)}));return value;});
    }
    async getEvidence(filter={}, {blobs=false}={}){
      const rows=await transaction(this.db,['evidence'],'readonly',tx=>request(tx.objectStore('evidence').getAll()));
      return rows.filter(r=>(!filter.case_id||r.case_id===filter.case_id)&&(!filter.volume_id||r.volume_id===filter.volume_id)&&(!filter.annotation_id||r.annotation_id===filter.annotation_id)&&evidenceMatches(r,filter)).map(r=>blobs?{...validateEvidence(r,this.context),annotated:r.annotated,raw:r.raw}:validateEvidence(r,this.context));
    }
    async addEvidence(input,{annotated,raw}){
      const created_at=now(),row=validateEvidence({...input,id:input.id||uuid(),created_at,updated_at:created_at},this.context);
      await validatePNG(annotated);if(row.source_view==='2d')await validatePNG(raw);else raw=null;
      return transaction(this.db,['evidence','annotations'],'readwrite',async tx=>{
        if(row.capture_signature){
          const comparable=value=>{const normalized=validateEvidence(value,this.context);for(const key of ['id','created_at','updated_at','annotated_file','raw_file'])delete normalized[key];return JSON.stringify(normalized);};
          const signature=comparable(row),existing=(await request(tx.objectStore('evidence').getAll())).find(e=>e.capture_signature===row.capture_signature&&comparable(e)===signature);
          if(existing)return validateEvidence(existing,this.context);
        }
        if(row.annotation_id){const a=await request(tx.objectStore('annotations').get(row.annotation_id));if(!a||a.case_id!==row.case_id)fail('Доказательство не связано с существующей аннотацией этого случая.');}
        await request(tx.objectStore('evidence').add({...row,annotated,raw}));return row;
      });
    }
    async updateEvidence(id,patch){
      return transaction(this.db,['evidence'],'readwrite',async tx=>{const s=tx.objectStore('evidence'),old=await request(s.get(id));if(!old)fail('Изображение уже удалено.');const normalized=validateEvidence(old,this.context),immutable=['id','case_id','volume_id','source_view','capture_origin','segmentation2d','local_z','global_z','created_at','view_settings','display_window','point_nm','resolution_nm'];for(const key of immutable)if(key in patch&&JSON.stringify(patch[key])!==JSON.stringify(normalized[key]))fail('Нельзя изменить исходный вид доказательства.');const row=validateEvidence({...old,...patch,updated_at:now(old.updated_at)},this.context);await request(s.put({...row,annotated:old.annotated,raw:old.raw}));return row;});
    }
    async removeEvidence(id){return transaction(this.db,['evidence'],'readwrite',tx=>request(tx.objectStore('evidence').delete(id)));}
    async exportData(filter={}){
      return transaction(this.db,['annotations','cases','counters','deleted','reviews','evidence','meta'],'readonly',async tx=>{
        const annotations=(await request(tx.objectStore('annotations').getAll())).filter(row=>match(row,filter,this.context)).map(row=>validateRecord(row,this.context)).sort((a,b)=>a.case_id.localeCompare(b.case_id)||a.number-b.number);
        const belongs=row=>!filter.case_id||row.case_id===filter.case_id;
        const cases=(await request(tx.objectStore('cases').getAll())).filter(belongs),counters=(await request(tx.objectStore('counters').getAll())).filter(belongs),deleted=filter.volume_id?[]:(await request(tx.objectStore('deleted').getAll())).filter(belongs);
        const review_records=(await request(tx.objectStore('reviews').getAll())).filter(belongs),reviewerRecord=await request(tx.objectStore('meta').get('reviewer'));
        const settingsRecord=await request(tx.objectStore('meta').get('settings'));
        const evidence=(await request(tx.objectStore('evidence').getAll())).filter(r=>belongs(r)&&(!filter.volume_id||r.volume_id===filter.volume_id)&&evidenceMatches(r,filter)).map(r=>validateEvidence(r,this.context));
        return {format:FORMAT,schema_version:SCHEMA_VERSION,package_id:this.context.package_id,exported_at:now(),coordinate_system:'global_nm',scope:clone(filter),annotations,cases,counters,deleted,review_records,reviewer:reviewerRecord?.value||{},reviewer_updated_at:reviewerRecord?.updated_at||null,evidence,settings:settingsRecord?.value||{},settings_updated_at:settingsRecord?.updated_at||null};
      });
    }
    async backupJSON(filter={}){return JSON.stringify(await this.exportData(filter),null,2);}
    async importData(input,{policy='keep-existing',evidenceFiles=new Map(),caseOnly=false}={}){
      if(!['keep-existing','newer','restore'].includes(policy))fail('Неизвестный режим объединения.');
      const data=validatePackage(typeof input==='string'?JSON.parse(input):input,this.context);
      let importCaseId=null;
      if(caseOnly){
        const ids=new Set([data.scope?.case_id,...['annotations','cases','counters','deleted','review_records','evidence'].flatMap(key=>data[key].map(r=>r.case_id))].filter(Boolean));
        if(ids.size!==1||!this.context.cases.has([...ids][0]))fail('Выберите файл одного случая. Для общего архива используйте «Загрузить все результаты».');
        importCaseId=[...ids][0];data.reviewer={};data.reviewer_updated_at=null;
        const settings=data.settings;
        data.settings=settings.last_view?.case_id===importCaseId?Object.fromEntries(['last_view','display','surface_view'].filter(k=>settings[k]!==undefined&&(k!=='surface_view'||settings[k].case_id===importCaseId)).map(k=>[k,settings[k]])):{};
      }
      for(const row of data.evidence){const blobs=evidenceFiles.get(row.id);if(blobs){await validatePNG(blobs.annotated);if(row.source_view==='2d')await validatePNG(blobs.raw);}}
      return transaction(this.db,['annotations','cases','counters','deleted','reviews','evidence','meta'],'readwrite',async tx=>{
        const records=tx.objectStore('annotations'),cases=tx.objectStore('cases'),counterStore=tx.objectStore('counters'),deleted=tx.objectStore('deleted');
        const snapshot=async()=>{const value={};for(const name of ['annotations','cases','counters','deleted','reviews','evidence','meta'])value[name]=(await request(tx.objectStore(name).getAll())).filter(r=>name!=='meta'||r.key!=='before-restore');return value;};
        const before=policy==='restore'?await snapshot():null;
        const current=new Map((await request(records.getAll())).map(r=>[r.id,r]));
        const tombstones=new Map((await request(deleted.getAll())).map(r=>[r.id,r]));
        const counts=new Map((await request(counterStore.getAll())).map(r=>[r.case_id,r.last_number]));
        const report={evidence_total:data.evidence.length,annotations_total:data.annotations.length,notes_total:data.annotations.filter(r=>r.notes||r.properties).length,case_ids:caseOnly?[importCaseId]:[...new Set([...data.annotations,...data.cases].map(r=>r.case_id))],settings:data.settings,added:0,updated:0,skipped:0,deleted:0,cases_added:0,cases_updated:0,reviews_added:0,reviews_updated:0,evidence_added:0,evidence_updated:0,settings_updated:0,missingEvidence:0,conflicts:[],renumbered:[]};
        for(const c of data.counters)counts.set(c.case_id,Math.max(counts.get(c.case_id)||0,c.last_number));
        for(const row of [...data.annotations,...data.deleted])counts.set(row.case_id,Math.max(counts.get(row.case_id)||0,row.number));
        const identical=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
        for(const incoming of data.annotations){
          const old=current.get(incoming.id),tomb=tombstones.get(incoming.id);
          if(old&&old.case_id!==incoming.case_id||tomb&&tomb.case_id!==incoming.case_id)fail('Один ID используется для разных случаев. Импорт отменён.');
          if(old&&identical(old,{...incoming,number:old.number})){report.skipped++;continue;}
          if(old||tomb){
            const previous=old?.updated_at||tomb.deleted_at;
            if(policy!=='restore'&&(policy!=='newer'||Date.parse(incoming.updated_at)<=Date.parse(previous))){report.skipped++;report.conflicts.push({id:incoming.id,case_id:incoming.case_id,reason:tomb?'previously_deleted':'existing_kept'});continue;}
          }
          const row=clone(incoming);
          if(old)row.number=old.number;
          else if(tomb)row.number=tomb.number;
          if([...current.values()].some(r=>r.id!==row.id&&r.case_id===row.case_id&&r.number===row.number)){
            const previous=row.number;row.number=[...current.values()].filter(r=>r.case_id===row.case_id).reduce((n,r)=>Math.max(n,r.number),0)+1;counts.set(row.case_id,row.number);report.renumbered.push({id:row.id,case_id:row.case_id,from:previous,to:row.number});
          }
          await request(records.put(row));await request(deleted.delete(row.id));current.set(row.id,row);tombstones.delete(row.id);
          if(old){report.updated++;report.conflicts.push({id:row.id,case_id:row.case_id,reason:policy==='restore'?'backup_used':'newer_import_used'});}else report.added++;
        }
        for(const row of (policy==='restore'?[]:data.deleted)){
          const old=current.get(row.id),tomb=tombstones.get(row.id);
          if(old&&old.case_id!==row.case_id||tomb&&tomb.case_id!==row.case_id)fail('ID удаления не соответствует случаю.');
          if(old&&(policy!=='newer'||Date.parse(row.deleted_at)<=Date.parse(old.updated_at))){report.conflicts.push({id:row.id,case_id:row.case_id,reason:'deletion_skipped'});continue;}
          if(tomb&&Date.parse(tomb.deleted_at)>=Date.parse(row.deleted_at))continue;
          if(old){await request(records.delete(row.id));current.delete(row.id);report.deleted++;}
          await request(deleted.put(row));tombstones.set(row.id,row);
        }
        for(const row of data.cases){
          const old=await request(cases.get(row.case_id));if(old&&identical(old,row))continue;
          if(old&&policy!=='restore'&&(policy!=='newer'||Date.parse(row.updated_at)<=Date.parse(old.updated_at))){report.conflicts.push({case_id:row.case_id,reason:'case_notes_kept'});continue;}
          await request(cases.put(row));if(old){report.cases_updated++;report.conflicts.push({case_id:row.case_id,reason:'newer_case_notes_used'});}else report.cases_added++;
        }
        for(const [case_id,last_number] of counts)await request(counterStore.put({case_id,last_number}));
        const reviews=tx.objectStore('reviews');
        for(const row of data.review_records){
          if(row.table==='ADDITIONAL_CONTACTS'){const linked=current.get(row.data.annotation_id);if(linked&&linked.case_id!==row.case_id)fail('Форма дополнительного контакта связана с другим случаем.');}
          const old=await request(reviews.get(row.id));
          if(old&&identical(old,row))continue;
          if(old&&policy!=='restore'&&(policy!=='newer'||Date.parse(old.updated_at)>=Date.parse(row.updated_at))){report.conflicts.push({id:row.id,case_id:row.case_id,reason:'review_kept'});continue;}
          await request(reviews.put(row));if(old)report.reviews_updated++;else report.reviews_added++;
        }
        if(Object.keys(data.reviewer).length){const s=tx.objectStore('meta'),old=await request(s.get('reviewer'));
          const incomingIsNewer=policy==='restore'||policy==='newer'&&data.reviewer_updated_at&&(!old?.updated_at||Date.parse(data.reviewer_updated_at)>Date.parse(old.updated_at));
          const value=incomingIsNewer?{...old?.value,...data.reviewer}:{...data.reviewer,...old?.value};
          await request(s.put({key:'reviewer',value,updated_at:incomingIsNewer?data.reviewer_updated_at:old?.updated_at||data.reviewer_updated_at||now()}));
          if(old&&Object.keys(data.reviewer).some(k=>k in old.value&&old.value[k]!==data.reviewer[k]))report.conflicts.push({reason:incomingIsNewer?'newer_reviewer_used':'reviewer_kept'});
        }
        if(Object.keys(data.settings).length){const s=tx.objectStore('meta'),old=await request(s.get('settings'));
          if(!old||!Object.keys(old.value||{}).length){await request(s.put({key:'settings',value:data.settings,updated_at:data.settings_updated_at||now()}));report.settings_updated++;}
          else if(!identical(old.value,data.settings)){
            if(policy==='restore'||policy==='newer'&&data.settings_updated_at&&Date.parse(data.settings_updated_at)>Date.parse(old.updated_at)){await request(s.put({key:'settings',value:caseOnly?{...old.value,...data.settings}:data.settings,updated_at:data.settings_updated_at}));report.settings_updated++;report.conflicts.push({reason:'newer_settings_used'});}
            else report.conflicts.push({reason:'settings_kept'});
          }
        }
        const evidence=tx.objectStore('evidence');
        for(const row of data.evidence){
          const old=await request(evidence.get(row.id)),blobs=evidenceFiles.get(row.id);
          if(old&&(old.case_id!==row.case_id||old.volume_id!==row.volume_id||old.local_z!==row.local_z||old.source_view!==row.source_view))fail('ID доказательства относится к другому виду или срезу.');
          for(const id of [row.annotation_id,...row.annotation_ids||[]].filter(Boolean)){const linked=current.get(id);if(linked&&linked.case_id!==row.case_id)fail('Доказательство связано с аннотацией другого случая.');}
          if(old&&identical(validateEvidence(old,this.context),row))continue;
          if(old&&policy!=='restore'&&(policy!=='newer'||Date.parse(old.updated_at)>=Date.parse(row.updated_at))){report.conflicts.push({id:row.id,reason:'evidence_kept'});continue;}
          if(!old&&!blobs){report.missingEvidence++;continue;}
          await request(evidence.put({...row,annotated:blobs?.annotated||old.annotated,raw:row.source_view==='3d'?null:blobs?.raw||old.raw}));if(old)report.evidence_updated++;else report.evidence_added++;
        }
        if(before)await request(tx.objectStore('meta').put({key:'before-restore',before,after:await snapshot()}));
        return report;
      });
    }
    async undoImport(){
      return transaction(this.db,['annotations','cases','counters','deleted','reviews','evidence','meta'],'readwrite',async tx=>{
        const meta=tx.objectStore('meta'),checkpoint=await request(meta.get('before-restore'));
        if(!checkpoint)fail('Нет загрузки для отмены.');
        for(const [name,rows] of Object.entries(checkpoint.after)){
          const current=(await request(tx.objectStore(name).getAll())).filter(r=>name!=='meta'||r.key!=='before-restore');
          if(JSON.stringify(current)!==JSON.stringify(rows))fail('После загрузки появились новые изменения. Отмена недоступна, чтобы сохранить их.');
        }
        for(const [name,rows] of Object.entries(checkpoint.before)){const s=tx.objectStore(name);await request(s.clear());for(const row of rows)await request(s.put(row));}
      });
    }
    async exportFiles(filter={}, {backup,extraEvidence=[],includeImages=true}={}){
      const data=backup?validatePackage(backup,this.context):await this.exportData(filter);
      const headers=['Случай','Метка','Тип метки','Категория наблюдения','Уверенность в синаптической природе','Часть структуры','Ссылки на доказательства','Заметка','Объём','Срез Z','X нм','Y нм','Z нм'],types={contact:'Контакт',point:'Особенность',object:'Объект',region:'Область'},categories={unclassified:'Не классифицировано',suspected_synapse:'Предполагаемый синапс',possible_adhesion:'Возможная адгезия',unresolved_other:'Другое / не разрешено'},certainty={supported:'Признаки синапса поддержаны',uncertain:'Неопределённо',rejected:'Признаки против синапса',note:'Не оценено'},locations={head:'Головка',neck:'Шейка',shaft:'Ствол дендрита',other:'Другое',uncertain:'Не определено'};
      const rows=data.annotations.map(r=>{const {v,res}=volumeInfo(this.context,r.case_id,r.volume_id);return{'Случай':r.case_id,'Метка':r.number,'Тип метки':types[r.kind],'Категория наблюдения':categories[r.observation_category],'Уверенность в синаптической природе':certainty[r.status],'Часть структуры':locations[r.location],'Ссылки на доказательства':r.evidence_refs,'Заметка':[r.properties,r.notes].filter(Boolean).join('\n'),'Объём':r.volume_id,'Срез Z':Math.floor(r.point_nm[2]/res[2])-v.begin_vox_xyz[2],'X нм':r.point_nm[0],'Y нм':r.point_nm[1],'Z нм':r.point_nm[2]};});
      const files=[{name:'results.csv',text:makeCSV(headers,rows)}];
      if(!includeImages){data.evidence=[];delete data.raw_images;files.push({name:'backup.json',text:JSON.stringify(data)});return files;}
      const all=new Map((await this.getEvidence({}, {blobs:true})).map(r=>[r.id,r]));
      for(const item of extraEvidence)all.set(item.id,item);
      data.raw_images={};let index=0;
      for(const meta of data.evidence){const e=all.get(meta.id);if(!e)fail('Снимок удалён во время экспорта. Повторите сохранение.');meta.annotated_file=`images/${meta.volume_id}-Z${meta.local_z}-${meta.source_view.toUpperCase()}-${++index}.png`;files.push({name:meta.annotated_file,bytes:new Uint8Array(await e.annotated.arrayBuffer())});if(meta.raw_file){const bytes=new Uint8Array(await e.raw.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));data.raw_images[meta.id]=btoa(binary);}}
      files.splice(1,0,{name:'backup.json',text:JSON.stringify(data)});
      return files;
    }
    async importZIP(file,{policy='keep-existing',caseOnly=false}={}){
      const entries=await unzipStored(file),text=entries.get('backup.json')||entries.get('findings.json');if(!text)fail('В архиве нет резервной копии.');
      if(entries.has('backup.json')&&entries.has('findings.json'))fail('В архиве две резервные копии. Загрузите исходный ZIP сайта.');
      const data=validatePackage(JSON.parse(new TextDecoder().decode(text)),this.context),evidenceFiles=new Map();
      for(const row of data.evidence){const annotated=entries.get(row.annotated_file);let raw=row.raw_file?entries.get(row.raw_file):null;if(row.raw_file&&!raw&&data.raw_images?.[row.id]){const encoded=data.raw_images[row.id];if(typeof encoded!=='string'||encoded.length>35*1024*1024||!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded))fail('Повреждено исходное изображение.');raw=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));}if(!annotated||row.raw_file&&!raw)fail('В архиве отсутствует изображение: '+row.id);evidenceFiles.set(row.id,{annotated:new Blob([annotated],{type:'image/png'}),raw:raw?new Blob([raw],{type:'image/png'}):null});}
      return this.importData(data,{policy,evidenceFiles,caseOnly});
    }
  }
  async function open(metadata,{dbName,indexedDB=globalThis.indexedDB}={}){
    if(!indexedDB)fail('Браузер не поддерживает локальное сохранение аннотаций.');
    const ctx=context(metadata),name=dbName||'microns-findings:'+ctx.package_id;
    const db=await new Promise((resolve,reject)=>{
      const req=indexedDB.open(name,2);let blocked=false;
      req.onupgradeneeded=()=>{for(const [store,keyPath] of [['annotations','id'],['cases','case_id'],['counters','case_id'],['deleted','id'],['meta','key'],['reviews','id'],['evidence','id']])if(!req.result.objectStoreNames.contains(store))req.result.createObjectStore(store,{keyPath});};
      req.onerror=()=>reject(req.error);req.onblocked=()=>{blocked=true;reject(new Error('Закройте другие вкладки этого сайта и повторите открытие.'));};
      req.onsuccess=()=>{if(blocked)req.result.close();else resolve(req.result);};
    });
    db.onversionchange=()=>db.close();
    try{await transaction(db,['meta'],'readwrite',async tx=>{const s=tx.objectStore('meta'),old=await request(s.get('package_id'));if(old&&old.value!==ctx.package_id)fail('Локальное хранилище принадлежит другому пакету.');if(!old)await request(s.put({key:'package_id',value:ctx.package_id}));});}catch(error){db.close();throw error;}
    const store=new Store(db,ctx);
    if(globalThis.navigator?.storage?.persist){try{store.storagePersistent=await globalThis.navigator.storage.persist();}catch(_){store.storagePersistent=false;}}
    return store;
  }
  function makeCSV(headers,rows){
    const cell=value=>{let text=String(value??'');if(/^[\s\u0000-\u001f]*[=+@-]/.test(text))text="'"+text;return '"'+text.replace(/"/g,'""')+'"';};
    return '\ufeff'+[headers,...rows.map(r=>headers.map(h=>r[h]??''))].map(row=>row.map(cell).join(',')).join('\r\n')+'\r\n';
  }
  function csv(records){
    const headers=['id','number','case_id','volume_id','x_nm','y_nm','z_nm','kind','observation_category','status','location','evidence_refs','label','segment_id','object_id','properties','notes','source_view','bounds_nm','created_at','updated_at'];
    return makeCSV(headers,records.map(r=>({...r,number:'N'+r.number,x_nm:r.point_nm[0],y_nm:r.point_nm[1],z_nm:r.point_nm[2],bounds_nm:r.bounds_nm?JSON.stringify(r.bounds_nm):'',segment_id:r.segment_id===null?'':"'"+r.segment_id})));
  }
  const casesCSV=records=>makeCSV(['case_id','coverage','notes','inspected_regions','extra_extent','updated_at'],records);
  function makeBackup(metadata,records,cases,filter={},extra={}){
    const ctx=context(metadata),annotations=records.map(r=>validateRecord(r,ctx)).filter(r=>match(r,filter,ctx));
    const belongs=r=>!filter.case_id||r.case_id===filter.case_id;
    const counts=new Map((extra.counters||[]).map(r=>{const c=validateCounter(r,ctx);return [c.case_id,c.last_number];}));
    for(const r of records)counts.set(r.case_id,Math.max(counts.get(r.case_id)||0,r.number));
    const value={format:FORMAT,schema_version:SCHEMA_VERSION,package_id:ctx.package_id,exported_at:now(),coordinate_system:'global_nm',scope:clone(filter),annotations,cases:cases.map(r=>validateCase(r,ctx)).filter(belongs),counters:[...counts].map(([case_id,last_number])=>({case_id,last_number})).filter(belongs),deleted:filter.volume_id?[]:(extra.deleted||[]).map(r=>validateDeleted(r,ctx)).filter(belongs),review_records:(extra.review_records||[]).map(r=>validateReview(r,ctx)).filter(belongs),reviewer:validateReviewer(extra.reviewer||{}),reviewer_updated_at:extra.reviewer_updated_at||null,evidence:(extra.evidence||[]).map(r=>validateEvidence(r,ctx)).filter(r=>belongs(r)&&(!filter.volume_id||r.volume_id===filter.volume_id)&&evidenceMatches(r,filter)),settings:validateSettings(extra.settings||{},ctx),settings_updated_at:extra.settings_updated_at||null};
    return validatePackage(value,ctx);
  }
  async function validatePNG(blob){
    if(!(blob instanceof Blob)||blob.size<33||blob.size>25*1024*1024)fail('Неверное или слишком большое PNG-доказательство (предел 25 МБ).');
    const bytes=new Uint8Array(await blob.slice(0,33).arrayBuffer()),sig=[137,80,78,71,13,10,26,10];
    if(sig.some((n,i)=>bytes[i]!==n)||new TextDecoder().decode(bytes.slice(12,16))!=='IHDR')fail('Файл доказательства не является PNG.');
    const v=new DataView(bytes.buffer),width=v.getUint32(16),height=v.getUint32(20);if(!width||!height||width>16384||height>16384)fail('Неверный размер PNG-доказательства.');return {width,height};
  }
  async function unzipStored(file){
    const max=512*1024*1024;
    if(file instanceof Blob&&file.size>max)fail('Архив превышает 512 МБ.');
    const bytes=file instanceof Uint8Array?file:new Uint8Array(file instanceof Blob?await file.arrayBuffer():file);
    if(bytes.length<22||bytes.length>max)fail('Неверный размер архива.');
    const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),end=bytes.length-22;
    if(view.getUint32(end,true)!==0x06054b50||view.getUint16(end+4,true)!==0||view.getUint16(end+6,true)!==0||view.getUint16(end+20,true)!==0)fail('Нужен исходный ZIP-архив экспорта сайта без повторного сжатия.');
    const count=view.getUint16(end+10,true),directorySize=view.getUint32(end+12,true),directoryOffset=view.getUint32(end+16,true);
    if(view.getUint16(end+8,true)!==count||directoryOffset+directorySize!==end)fail('Повреждён каталог архива.');
    const entries=new Map(),decoder=new TextDecoder('utf-8',{fatal:true});let offset=0,central=directoryOffset;
    for(let i=0;i<count;i++){
      if(offset+30>directoryOffset||central+46>end||view.getUint32(offset,true)!==0x04034b50||view.getUint32(central,true)!==0x02014b50)fail('Повреждён заголовок архива.');
      const nameLength=view.getUint16(offset+26,true),extra=view.getUint16(offset+28,true),flags=view.getUint16(offset+6,true),method=view.getUint16(offset+8,true),crc=view.getUint32(offset+14,true),size=view.getUint32(offset+18,true),rawSize=view.getUint32(offset+22,true),start=offset+30+nameLength+extra;
      const centralNameLength=view.getUint16(central+28,true),centralExtra=view.getUint16(central+30,true),comment=view.getUint16(central+32,true);
      if(flags!==0x800||method!==0||size!==rawSize||start+size>directoryOffset||central+46+centralNameLength+centralExtra+comment>end||view.getUint32(central+42,true)!==offset||view.getUint32(central+16,true)!==crc||view.getUint32(central+20,true)!==size||view.getUint32(central+24,true)!==size)fail('Поддерживается только неизменённый архив экспорта сайта.');
      const name=decoder.decode(bytes.slice(offset+30,offset+30+nameLength));
      if(!name||name.startsWith('/')||name.includes('\\')||name.split('/').some(p=>p==='..'||p==='.')||name.includes('\0')||entries.has(name)||decoder.decode(bytes.slice(central+46,central+46+centralNameLength))!==name)fail('Неверное или повторное имя в архиве.');
      const content=bytes.slice(start,start+size);if(crc32(content)!==crc)fail('Контрольная сумма файла не совпадает: '+name);entries.set(name,content);
      offset=start+size;central+=46+centralNameLength+centralExtra+comment;
    }
    if(offset!==directoryOffset||central!==end)fail('Повреждены границы архива.');return entries;
  }
  const crcTable=Uint32Array.from({length:256},(_,i)=>{let n=i;for(let j=0;j<8;j++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
  function crc32(bytes){let crc=0xffffffff;for(const byte of bytes)crc=crcTable[(crc^byte)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;}
  function zip(files){
    if(files.length>65535)fail('Слишком много файлов для архива.');
    const chunks=[],directory=[],names=new Set();let offset=0,size=0;
    for(const file of files){
      if(typeof file.name!=='string'||!file.name||file.name.startsWith('/')||file.name.includes('\\')||file.name.split('/').includes('..')||names.has(file.name))fail('Неверное или повторное имя файла в архиве.');names.add(file.name);
      const name=encoder.encode(file.name),bytes=file.bytes instanceof Uint8Array?file.bytes:file.bytes instanceof ArrayBuffer?new Uint8Array(file.bytes):encoder.encode(file.text??''),crc=crc32(bytes);
      if(name.length>65535||bytes.length>0xffffffff||offset+bytes.length+name.length+30>0xffffffff)fail('Архив превышает допустимый размер.');
      const header=new Uint8Array(30+name.length),v=new DataView(header.buffer);v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(6,0x800,true);v.setUint16(12,0x21,true);v.setUint32(14,crc,true);v.setUint32(18,bytes.length,true);v.setUint32(22,bytes.length,true);v.setUint16(26,name.length,true);header.set(name,30);chunks.push(header,bytes);
      const central=new Uint8Array(46+name.length),c=new DataView(central.buffer);c.setUint32(0,0x02014b50,true);c.setUint16(4,20,true);c.setUint16(6,20,true);c.setUint16(8,0x800,true);c.setUint16(14,0x21,true);c.setUint32(16,crc,true);c.setUint32(20,bytes.length,true);c.setUint32(24,bytes.length,true);c.setUint16(28,name.length,true);c.setUint32(42,offset,true);central.set(name,46);directory.push(central);offset+=header.length+bytes.length;size+=central.length;
    }
    const end=new Uint8Array(22),e=new DataView(end.buffer);e.setUint32(0,0x06054b50,true);e.setUint16(8,files.length,true);e.setUint16(10,files.length,true);e.setUint32(12,size,true);e.setUint32(16,offset,true);return new Blob([...chunks,...directory,end],{type:'application/zip'});
  }
  const api={open,csv,casesCSV,zip,makeBackup,SCHEMA_VERSION,FORMAT,validatePackage:(value,metadata)=>validatePackage(value,context(metadata))};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else window.AnnotationsCore=api;
})();
