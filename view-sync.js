/* Private, same-origin communication between the open research views. */
(() => {
  'use strict';
  const base=new URL('.',document.currentScript.src).href,params=new URLSearchParams(location.search);
  const role=location.pathname.startsWith(new URL('neuroglancer/',base).pathname)?'neuroglancer':params.get('panel')==='annotations'?'notes':'main';
  const id=crypto.randomUUID(),listeners=new Set(),seen=new Map();let clock=0,channel;
  const name='microns-live-views-v1:'+base,key=name+':message';
  function receive(message){
    if(!message||message.protocol!==1||message.source===id||typeof message.source!=='string'||!Number.isSafeInteger(message.clock)||message.clock<=0||typeof message.type!=='string')return;
    clock=Math.max(clock,message.clock);
    if(message.target&&message.target!==id)return;
    if((seen.get(message.source)||0)>=message.clock)return;seen.set(message.source,message.clock);
    for(const listener of listeners)try{listener(message);}catch(error){console.error('View synchronization:',error);}
  }
  try{channel=new BroadcastChannel(name);channel.addEventListener('message',event=>receive(event.data));}catch{}
  if(!channel)window.addEventListener('storage',event=>{if(event.key===key&&event.newValue)try{receive(JSON.parse(event.newValue));}catch{}});
  const newer=(a,b)=>!!a&&(!b||a.clock>b.clock||a.clock===b.clock&&a.source>b.source);
  window.HandoffSync={id,role,base,newer,subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);},send(type,payload,target){
    const message={protocol:1,source:id,role,clock:++clock,type,payload,...(target?{target}:{})};
    if(channel)channel.postMessage(message);else try{localStorage.setItem(key,JSON.stringify(message));}catch{}
    return message;
  }};
})();
