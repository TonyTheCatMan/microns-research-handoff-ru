/* Plain-data import/export helpers. Canonical CSV headers and enum values are preserved. */
(() => {
  'use strict';
  const encoder=new TextEncoder();
  const crcTable=Uint32Array.from({length:256},(_,i)=>{let n=i;for(let j=0;j<8;j++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
  function crc32(bytes){let crc=0xffffffff;for(const byte of bytes)crc=crcTable[(crc^byte)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;}
  function zip(files){
    const chunks=[],directory=[];let offset=0,size=0;
    for(const file of files){const name=encoder.encode(file.name),bytes=encoder.encode(file.text),crc=crc32(bytes),header=new Uint8Array(30+name.length),v=new DataView(header.buffer);v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(6,0x800,true);v.setUint16(12,0x21,true);v.setUint32(14,crc,true);v.setUint32(18,bytes.length,true);v.setUint32(22,bytes.length,true);v.setUint16(26,name.length,true);header.set(name,30);chunks.push(header,bytes);
      const central=new Uint8Array(46+name.length),c=new DataView(central.buffer);c.setUint32(0,0x02014b50,true);c.setUint16(4,20,true);c.setUint16(6,20,true);c.setUint16(8,0x800,true);c.setUint16(14,0x21,true);c.setUint32(16,crc,true);c.setUint32(20,bytes.length,true);c.setUint32(24,bytes.length,true);c.setUint16(28,name.length,true);c.setUint32(42,offset,true);central.set(name,46);directory.push(central);offset+=header.length+bytes.length;size+=central.length;
    }
    const end=new Uint8Array(22),e=new DataView(end.buffer);e.setUint32(0,0x06054b50,true);e.setUint16(8,files.length,true);e.setUint16(10,files.length,true);e.setUint32(12,size,true);e.setUint32(16,offset,true);return new Blob([...chunks,...directory,end],{type:'application/zip'});
  }
  function csv(headers,rows){const escape=value=>{let s=String(value??'');if(/^\s*[=+@]/.test(s)||/^\s*-/.test(s)&&!/^\s*-\d+(?:\.\d+)?\s*$/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};return '\ufeff'+[headers,...rows.map(row=>headers.map(key=>row[key]??''))].map(row=>row.map(escape).join(',')).join('\r\n')+'\r\n';}
  function validateDraft(value,data){
    if(!value||value.schema_version!==1||value.package_id!==data.case_metadata.package_id||!value.forms||!value.reviewer||typeof value.reviewer!=='object'||Array.isArray(value.reviewer))throw new Error('Этот файл не является черновиком данного пакета MICrONS.');
    const cases=new Map(data.case_metadata.cases.map(c=>[c.case_id,c]));
    for(const [name,keys] of Object.entries(data.form_fields)){
      const rows=value.forms[name];if(!Array.isArray(rows)||rows.length>10000)throw new Error('Неверная форма: '+name);
      const seen=new Set();
      for(const row of rows){
        if(!row||Object.keys(row).some(k=>!keys.includes(k))||keys.some(k=>typeof row[k]!=='string'||row[k].length>100000))throw new Error('Неверные поля в форме '+name);
        const c=cases.get(row.case_id);if(!c)throw new Error('Неизвестный случай в черновике.');
        for(const key of keys){const group=data.field_choice_groups[key];if(group&&row[key]&&!data.choice_groups[group].includes(row[key]))throw new Error('Неизвестный вариант ответа: '+key);}
        if('volume_id'in row&&!c.volumes.some(v=>v.volume_id===row.volume_id))throw new Error('Объём не соответствует случаю '+c.case_id);
        if(name==='CASE_REVIEW'){if(seen.has(row.case_id))throw new Error('Повторная оценка случая.');seen.add(row.case_id);}
        if(name==='CONTACT_REVIEW'){if(!c.contacts.some(t=>t.contact_id===row.contact_id)||seen.has(row.case_id+row.contact_id))throw new Error('Неверный или повторный заданный контакт.');seen.add(row.case_id+row.contact_id);}
        if(name==='ADDITIONAL_CONTACTS'){if(!/^N[1-9]\d*$/.test(row.new_contact_id)||seen.has(row.case_id+row.new_contact_id))throw new Error('Неверный или повторный новый контакт.');seen.add(row.case_id+row.new_contact_id);}
      }
      if(name==='CASE_REVIEW'&&rows.length!==cases.size||name==='CONTACT_REVIEW'&&rows.length!==[...cases.values()].reduce((s,c)=>s+c.contacts.length,0))throw new Error('В черновике отсутствуют обязательные строки.');
    }
    for(const [key,val] of Object.entries(value.reviewer))if(!data.reviewer_fields.some(f=>f.key===key)||typeof val!=='string'||val.length>100000)throw new Error('Неверные сведения об исследователе.');
    return value;
  }
  const api={zip,csv,validateDraft};if(typeof module!=='undefined'&&module.exports)module.exports=api;else window.ReviewCore=api;
})();
