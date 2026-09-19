/* Private, same-origin communication between the open research views. */
(() => {
  'use strict';
  const base=new URL('.',document.currentScript.src).href,params=new URLSearchParams(location.search);
  const role=location.pathname.startsWith(new URL('neuroglancer/',base).pathname)?'neuroglancer':params.get('panel')==='annotations'?'notes':'main';
  const id=crypto.randomUUID(),listeners=new Set(),seen=new Map(),peers=new Map();let clock=0,channel;
  const name='microns-live-views-v1:'+base,key=name+':message',modeKey=name+':sync-mode';
  const synchronizedTypes=new Set(['host-state','ng-state','ng-focus','ng-deselect','hello','state-reply']);
  let mode={enabled:true,revision:'initial',source:null,clock:0},storedRevision=null;
  function validMode(value){return value&&typeof value.enabled==='boolean'&&typeof value.revision==='string'&&value.revision.length>0&&Number.isSafeInteger(value.clock)&&value.clock>=0;}
  function readMode(){try{const value=JSON.parse(localStorage.getItem(modeKey));return validMode(value)?value:null;}catch{return null;}}
  function adoptMode(value,local=false){
    if(!validMode(value)||value.revision===mode.revision)return;
    mode=value;clock=Math.max(clock,value.clock);
    window.dispatchEvent(new CustomEvent('handoff:sync-mode',{detail:{enabled:mode.enabled,local,source:mode.source,revision:mode.revision}}));
  }
  function refreshMode(){const stored=readMode();if(stored&&stored.revision!==storedRevision){storedRevision=stored.revision;adoptMode(stored);}return mode;}
  const initialMode=readMode();if(initialMode){mode=initialMode;storedRevision=initialMode.revision;}clock=Math.max(clock,mode.clock);
  function crossesNative(message,sending=false){
    if(!synchronizedTypes.has(message.type))return false;
    return role==='neuroglancer'||message.role==='neuroglancer'||sending&&peers.get(message.target)==='neuroglancer'||message.type.startsWith('ng-')||message.type==='state-reply'&&crossesNative(message.payload?.message||{},sending);
  }
  function allowed(message,sending=false){
    if(!crossesNative(message,sending))return true;
    if(!mode.enabled||message.syncRevision!==mode.revision)return false;
    // Replies wrap earlier snapshots: a fresh envelope must not revive a snapshot
    // captured before synchronization was disabled or enabled again.
    if(message.type==='state-reply'&&message.payload?.message){
      const nested=message.payload.message;
      if(synchronizedTypes.has(nested.type)&&nested.syncRevision!==mode.revision)return false;
      return allowed(nested,sending);
    }
    return true;
  }
  function post(message){if(channel)channel.postMessage(message);else try{localStorage.setItem(key,JSON.stringify(message));}catch{}}
  function receive(message){
    if(!message||message.protocol!==1||message.source===id||typeof message.source!=='string'||!Number.isSafeInteger(message.clock)||message.clock<=0||typeof message.type!=='string')return;
    clock=Math.max(clock,message.clock);
    if(message.target&&message.target!==id)return;
    if((seen.get(message.source)||0)>=message.clock)return;seen.set(message.source,message.clock);peers.set(message.source,message.role);
    refreshMode();
    if(message.type==='sync-mode'){
      const value=message.payload?.mode,stored=readMode();
      // Reading the current value (rather than an old storage event's value)
      // gives every window the same final preference during rapid toggles.
      if(message.payload?.persisted&&stored)refreshMode();
      else if(validMode(value)&&(value.clock>mode.clock||value.clock===mode.clock&&String(value.source)>String(mode.source)))adoptMode(value);
      return;
    }
    if(!allowed(message))return;
    for(const listener of listeners)try{listener(message);}catch(error){console.error('View synchronization:',error);}
  }
  try{channel=new BroadcastChannel(name);channel.addEventListener('message',event=>receive(event.data));}catch{}
  window.addEventListener('storage',event=>{
    if(event.key===modeKey)refreshMode();
    else if(!channel&&event.key===key&&event.newValue)try{receive(JSON.parse(event.newValue));}catch{}
  });
  const newer=(a,b)=>!!a&&(!b||a.clock>b.clock||a.clock===b.clock&&a.source>b.source);
  window.HandoffSync={id,role,base,newer,get enabled(){return refreshMode().enabled;},get syncRevision(){return refreshMode().revision;},setEnabled(enabled){
    refreshMode();enabled=!!enabled;if(enabled===mode.enabled)return mode.enabled;
    const value={enabled,revision:crypto.randomUUID(),source:id,clock:++clock};let persisted=false;
    try{localStorage.setItem(modeKey,JSON.stringify(value));persisted=true;storedRevision=value.revision;}catch{}
    adoptMode(value,true);
    post({protocol:1,source:id,role,clock:++clock,type:'sync-mode',payload:{mode:value,persisted},syncRevision:value.revision});
    return enabled;
  },subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);},send(type,payload,target){
    refreshMode();
    const message={protocol:1,source:id,role,clock:++clock,type,payload,syncRevision:mode.revision,...(target?{target}:{})};
    if(allowed(message,true))post(message);
    return message;
  }};
})();
