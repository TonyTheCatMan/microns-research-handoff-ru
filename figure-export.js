/* Annotated and clean stills from one frozen XY viewport. */
(() => {
  'use strict';
  const $=id=>document.getElementById(id),tr=text=>window.HandoffI18n?.translate(text)??text;
  let busy=false;
  const png=canvas=>new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error(tr('Не удалось создать PNG.'))),'image/png'));
  function copy(source){const canvas=document.createElement('canvas');canvas.width=source.width;canvas.height=source.height;canvas.getContext('2d').drawImage(source,0,0);return canvas;}
  function freeze(){
    const v=window.ReviewViewer,viewport=$('viewport'),image=$('imageCanvas');
    if(!v?.ready||$('page-viewer').hidden||!viewport.clientWidth)throw new Error(tr('Откройте нужный срез в 2D.'));
    const bounds=image.getBoundingClientRect(),view=viewport.getBoundingClientRect(),zx=bounds.width/image.width,zy=bounds.height/image.height;
    const x=Math.max(0,(view.left+viewport.clientLeft-bounds.left)/zx),y=Math.max(0,(view.top+viewport.clientTop-bounds.top)/zy);
    const right=Math.min(image.width,(view.left+viewport.clientLeft+viewport.clientWidth-bounds.left)/zx),bottom=Math.min(image.height,(view.top+viewport.clientTop+viewport.clientHeight-bounds.top)/zy);
    if(right<=x||bottom<=y)throw new Error(tr('Изображение не видно в окне 2D.'));
    const volume=structuredClone(v.volume),z=v.z,case_id=v.currentCase.case_id;
    // The color variant explicitly paints the visible selected structures, without
    // changing the viewer's fill toggle, selected IDs, colors or opacity.
    const segmentation=window.SliceSegmentation?.captureFor(volume.volume_id,z,{fill:true});
    if(!segmentation)throw new Error(tr('Дождитесь загрузки сегментации текущего среза.'));
    const marks=window.HandoffAnnotations;
    const records=marks?.visible?marks.records.filter(r=>r.case_id===case_id&&(!r.geometry||r.volume_id===volume.volume_id)&&r.point_nm.every((n,i)=>n>=volume.begin_vox_xyz[i]*volume.resolution_nm[i]&&n<volume.end_vox_xyz_exclusive[i]*volume.resolution_nm[i])&&Math.floor(r.point_nm[2]/volume.resolution_nm[2])-volume.begin_vox_xyz[2]===z):[];
    return {image:copy(image),segmentation,volume,z,case_id,crop:{x,y,width:right-x,height:bottom-y},zoom:zx,
      records:structuredClone(records),selectedId:marks?.selectedId,contacts:structuredClone(v.currentCase.contacts),
      showT:!!$('overlayToggle')?.checked,tFlags:Object.fromEntries(['tCenter','tPre','tPost'].map(id=>[id,!!$(id)?.checked])),display:[...v.displayWindow]};
  }
  function render(snapshot,colored){
    const s=snapshot,crop=s.crop,scale=3072/Math.max(crop.width,crop.height),unit=scale/s.zoom,pad=32,top=92;
    const width=Math.max(1,Math.round(crop.width*scale)),height=Math.max(1,Math.round(crop.height*scale));
    const canvas=document.createElement('canvas');canvas.width=width+pad*2;canvas.height=height+top+112;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#18344b';ctx.font='bold 30px system-ui';ctx.fillText(`${s.case_id} · ${s.volume.volume_id} · Z ${s.z}`,pad,36);
    ctx.font='22px system-ui';ctx.fillText(tr('Текущий вид 2D')+` · XY · ${tr('Глобальный Z')} ${s.volume.begin_vox_xyz[2]+s.z} · ${s.volume.resolution_nm.join(' × ')} nm/voxel`,pad,70);
    ctx.save();ctx.beginPath();ctx.rect(pad,top,width,height);ctx.clip();ctx.imageSmoothingEnabled=false;
    ctx.drawImage(s.image,crop.x,crop.y,crop.width,crop.height,pad,top,width,height);
    if(colored)ctx.drawImage(s.segmentation.canvas,crop.x,crop.y,crop.width,crop.height,pad,top,width,height);
    const ox=pad-crop.x*scale,oy=top-crop.y*scale;
    if(colored&&s.showT)for(const contact of s.contacts)for(const [key,flag,suffix] of [['ctr_nm','tCenter',''],['pre_nm','tPre',' пре'],['post_nm','tPost',' пост']]){
      if(!contact[key]||!s.tFlags[flag])continue;
      const p=contact[key].map((n,i)=>Math.floor(n/s.volume.resolution_nm[i])-s.volume.begin_vox_xyz[i]);
      if(p[2]!==s.z||p.some((n,i)=>n<0||n>=s.volume.shape_xyz[i]))continue;
      const x=ox+(p[0]+.5)*scale,y=oy+(p[1]+.5)*scale;
      MarkerStyles.draw(ctx,x,y,6*unit,key,'',false,unit);ctx.font='bold '+13*unit+'px system-ui';ctx.lineWidth=3*unit;ctx.strokeStyle='#172632';ctx.strokeText(contact.contact_id+tr(suffix),x+10*unit,y-10*unit);ctx.fillStyle=MarkerStyles.styles[key].color;ctx.fillText(contact.contact_id+tr(suffix),x+10*unit,y-10*unit);
    }
    if(colored)for(const record of s.records){
      if(record.geometry){HandoffDrawingGeometry.drawRecord(ctx,record,s.volume,s.z,{zoom:scale,x:ox,y:oy,unit});continue;}
      const p=record.point_nm.map((n,i)=>n/s.volume.resolution_nm[i]-s.volume.begin_vox_xyz[i]);
      MarkerStyles.draw(ctx,ox+p[0]*scale,oy+p[1]*scale,10*unit,record.kind,record.number,record.id===s.selectedId,unit);
    }
    ctx.restore();
    const target=crop.width*s.volume.resolution_nm[0]*.2,power=10**Math.floor(Math.log10(target));
    const length=([5,2,1].find(n=>n*power<=target)||1)*power,bar=length/s.volume.resolution_nm[0]*scale,y=top+height+34;
    ctx.strokeStyle='#18344b';ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(pad,y);ctx.lineTo(pad+bar,y);ctx.stroke();ctx.fillStyle='#18344b';ctx.font='22px system-ui';ctx.fillText(length>=1000?(length/1000)+' µm':length+' nm',pad+bar+14,y+7);
    ctx.font='19px system-ui';ctx.fillText('MICrONS Consortium (2025) · CC BY 4.0 · doi:10.1038/s41586-025-08790-w',pad,y+46);
    return canvas;
  }
  async function capturePair(){
    await window.HandoffDrawings?.whenSettled();await window.HandoffAnnotations?.settleForAction();await window.SliceSegmentation?.ensure();
    // Freeze image, crop, IDs, colors, marks and toggles together before PNG encoding.
    const snapshot=freeze(),coloredCanvas=render(snapshot,true),plainCanvas=render(snapshot,false);
    const [colored,plain]=await Promise.all([png(coloredCanvas),png(plainCanvas)]);
    return {colored,plain,metadata:{case_id:snapshot.case_id,volume_id:snapshot.volume.volume_id,local_z:snapshot.z,crop:snapshot.crop,zoom:snapshot.zoom,width:coloredCanvas.width,height:coloredCanvas.height,segmentation:structuredClone(snapshot.segmentation.settings),annotation_ids:snapshot.records.map(r=>r.id),t_points_visible:snapshot.showT,t_flags:snapshot.tFlags},coloredCanvas,plainCanvas};
  }
  async function downloadPair(){
    if(busy)return;busy=true;update();const status=$('figurePairStatus');status.textContent=tr('Готовим PNG с разметкой и чистый PNG…');
    try{
      const pair=await capturePair(),base=`MICrONS-${pair.metadata.case_id}-${pair.metadata.volume_id}-Z${pair.metadata.local_z}`;
      const files=[{name:base+'-colored.png',bytes:new Uint8Array(await pair.colored.arrayBuffer())},{name:base+'-plain.png',bytes:new Uint8Array(await pair.plain.arrayBuffer())}];
      const url=URL.createObjectURL(AnnotationsCore.zip(files)),link=document.createElement('a');link.href=url;link.download=base+'-paired-PNG.zip';link.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
      status.textContent=tr('Сохранены PNG с разметкой и чистый PNG: одинаковый срез и кадр.')+(!pair.metadata.segmentation.segment_ids.length||pair.metadata.segmentation.opacity===0?' '+tr('Нет видимой цветной заливки: проверьте выбор структур и прозрачность.'):'');
    }catch(error){status.textContent=tr('Не удалось сохранить: ')+error.message;}finally{busy=false;update();}
  }
  function update(){const button=$('figurePairExport');if(button)button.disabled=busy||!window.ReviewViewer?.ready;}
  function start(){
    const original=$('exportButton');if(!original)return;
    const button=document.createElement('button');button.id='figurePairExport';button.type='button';button.textContent='Два PNG: с разметкой / чистый';button.title='Текущий срез и видимая область: с цветами и отметками, затем чистая ЭМ без наложений.';button.addEventListener('click',downloadPair);original.after(button);
    const status=document.createElement('span');status.id='figurePairStatus';status.className='hint';status.setAttribute('role','status');button.after(status);window.HandoffI18n?.refresh(button.parentElement);update();
  }
  window.FigureExport={capturePair,downloadPair};window.addEventListener('review:position',update);window.addEventListener('review:volume',update);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
