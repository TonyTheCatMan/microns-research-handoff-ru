(() => {
  'use strict';
  const $=id=>document.getElementById(id),data=window.REVIEW_CONTENT,pilots=data.package.pilot_ids;
  const el=(tag,text,className)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(className)n.className=className;return n;};
  let selected='R001';
  function route(){const page=['viewer','neuroglancer','sources'].includes(location.hash.slice(1))?location.hash.slice(1):'viewer';document.querySelectorAll('.page').forEach(n=>n.hidden=n.id!=='page-'+page);document.querySelectorAll('.main-nav a').forEach(a=>{if(a.hash==='#'+page)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});window.dispatchEvent(new Event('resize'));}
  window.addEventListener('hashchange',route);route();
  function updateCases(keep=selected){const list=$('caseGroup').value==='pilot'?pilots:data.case_metadata.cases.map(c=>c.case_id);$('caseSelect').replaceChildren(...list.map(id=>new Option(id,id)));$('caseSelect').value=list.includes(keep)?keep:list[0];return $('caseSelect').value;}
  function choose(id){if(!pilots.includes(id))$('caseGroup').value='all';updateCases(id);window.ReviewViewer?.select(id);location.hash='viewer';}
  for(const id of pilots){const button=el('button',id);button.addEventListener('click',()=>choose(id));button.dataset.caseId=id;$('pilotLinks').append(button);}
  function reflect(id){selected=id;$('caseBadge').textContent=pilots.includes(id)?'Пилот':'Полный набор';document.querySelectorAll('#pilotLinks button').forEach(b=>b.classList.toggle('active',b.dataset.caseId===id));const ids=Array.from($('caseSelect').options).map(o=>o.value),pos=ids.indexOf(id);$('prevCase').disabled=pos<=0;$('nextCase').disabled=pos<0||pos===ids.length-1;const url=new URL(location.href);url.searchParams.set('case',id);const vol=$('volumeSelect').value;if(vol)url.searchParams.set('volume',vol);url.searchParams.delete('z');history.replaceState(null,'',url);}
  window.addEventListener('review:ready',()=>{const initial=$('caseSelect').value;if(!pilots.includes(initial))$('caseGroup').value='all';updateCases(initial);});
  window.addEventListener('review:volume',e=>reflect(e.detail.caseId));
  $('caseGroup').addEventListener('change',()=>{const id=updateCases();window.ReviewViewer?.select(id);});
  for(const [button,delta] of [['prevCase',-1],['nextCase',1]])$(button).addEventListener('click',()=>{const options=$('caseSelect').options,i=$('caseSelect').selectedIndex+delta;if(i>=0&&i<options.length)choose(options[i].value);});
  const card=(title,body)=>{const n=el('article',undefined,'content-card');n.append(el('h2',title));if(body)n.append(el('p',body));return n;};
  const list=(items,tag='ul')=>{const n=el(tag);items.forEach(s=>n.append(el('li',s)));return n;};
  const source=data.source_attribution,sc=card(source.title,source.source);for(const item of [source.dataset_citation,source.infrastructure_citation,source.license]){const p=el('p'),a=el('a',item.text);a.href=item.url;a.target='_blank';a.rel='noopener noreferrer';p.append(a);sc.append(p);}sc.append(el('p',source.license_note));for(const item of source.links){const p=el('p'),a=el('a',item.label);a.href=item.url;a.target='_blank';a.rel='noopener noreferrer';p.append(a);sc.append(p);}$('sourceContent').append(sc);
  const limits=card('Границы интерпретации');limits.append(list(data.scientific_caveats));$('sourceContent').append(limits);
  const coords=card(data.coordinates.title,data.coordinates.voxel_label);coords.append(list([data.coordinates.local_z,data.coordinates.tiff_page,data.coordinates.global,data.coordinates.evidence]));$('sourceContent').append(coords);
  const provenance=card('Подготовка материалов',source.conversion);provenance.append(el('p','Исходная серийная ЭМ и двоичные файлы 3D-поверхностей сохранены без изменений. Интерфейс переведён на русский язык; подписи объектов нейтральны. Координаты, идентификаторы и исходные значения форм сохранены.'));$('sourceContent').append(provenance);
  window.HandoffUI={el,choose,data,get selected(){return selected;}};
})();
