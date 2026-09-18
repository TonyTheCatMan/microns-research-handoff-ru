/* Lossless native labels for one EM volume. X varies fastest; slices are never resampled. */
'use strict';
let current=null,pending=null;

function decode(buffer,volume){
  const view=new DataView(buffer);
  if(buffer.byteLength<24||view.getUint32(0,true)!==0x3158434d)throw new Error('Неверный формат сегментации.');
  const shape=[4,8,12].map(n=>view.getUint32(n,true)),runs=view.getUint32(16,true),count=view.getUint32(20,true);
  if(shape.some((n,i)=>n!==volume.shape_xyz[i]||n<1)||count!==volume.palette.length||count>65535||buffer.byteLength!==24+runs*8)throw new Error('Размеры сегментации не совпадают с изображением.');
  if(volume.palette[0]!=='0'||!volume.palette.every(id=>typeof id==='string'&&/^\d+$/.test(id)))throw new Error('Неверная палитра сегментации.');
  const size=shape.reduce((a,b)=>a*b,1);if(!Number.isSafeInteger(size)||size>128*1024*1024)throw new Error('Слишком большой объём сегментации.');
  const labels=new Uint16Array(size);let offset=0;
  for(let at=24;at<buffer.byteLength;at+=8){const id=view.getUint32(at,true),length=view.getUint32(at+4,true);if(id>=count||length<1||offset+length>size)throw new Error('Повреждены данные сегментации.');labels.fill(id,offset,offset+length);offset+=length;}
  if(offset!==size)throw new Error('Сегментация не покрывает весь объём.');
  return labels;
}
function slice(request){
  pending=request;if(!current||request.token!==current.token)return;
  const z=request.local_z,[width,height,depth]=current.volume.shape_xyz;
  if(!Number.isInteger(z)||z<0||z>=depth)throw new Error('Срез вне объёма сегментации.');
  const labels=current.labels.slice(z*width*height,(z+1)*width*height);
  postMessage({type:'slice',token:current.token,request_id:request.request_id,local_z:z,labels},[labels.buffer]);
}
async function load(request){
  pending={token:request.token,request_id:request.request_id,local_z:request.local_z};
  const volume=request.volume;
  if(!volume||!Array.isArray(volume.shape_xyz)||volume.resolution_nm?.join(',')!=='8,8,40')throw new Error('Неверная сетка сегментации.');
  const response=await fetch(request.url);if(!response.ok)throw new Error('Не удалось загрузить сегментацию: HTTP '+response.status);
  let bytes=await response.arrayBuffer();if(bytes.byteLength!==volume.data_bytes)throw new Error('Размер файла сегментации не совпадает с индексом.');
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
  if(hash!==volume.data_sha256)throw new Error('Не пройдена проверка целостности сегментации.');
  if(typeof DecompressionStream!=='function')throw new Error('Сегментация требует современной версии браузера.');
  bytes=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  current={token:request.token,volume,labels:decode(bytes,volume)};bytes=null;slice(pending);
}
self.onmessage=event=>{
  const message=event.data;
  if(message?.type==='load')load(message).catch(error=>postMessage({type:'error',token:message.token,message:error.message||String(error)}));
  else if(message?.type==='slice')try{slice(message);}catch(error){postMessage({type:'error',token:message.token,message:error.message||String(error)});}
};
