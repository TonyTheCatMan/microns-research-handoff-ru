/* Live same-origin bridge for the pinned native viewer. Coordinates remain global voxels. */
(() => {
  'use strict';
  const bus=window.HandoffSync;if(!bus)return;
  const NAV=['position','crossSectionOrientation','crossSectionScale','crossSectionDepth','projectionOrientation','projectionScale','projectionDepth'];
  const SETTINGS=['showSlices','showAxisLines','showScaleBar','crossSectionBackgroundColor','projectionBackgroundColor'];
  const ownLayer=name=>name==='ЭМ MICrONS'||name==='Объекты · v1300'||name==='Соседние структуры · v1300'||name==='Заданные точки · не проверены'||name?.startsWith('Границы ')||name?.startsWith('Мои метки · ')||['Сегментация 2D · v1300','Сегментация среза 3D · v1300','Соседние на срезе 3D · v1300'].includes(name);
  const params=new URLSearchParams(location.search),waiters=[];
  let caseId=params.get('case')||'',volumeId=params.get('volume')||'',latest=null,applied=null,pending=null,applying=false,started=false,timer=null,lastNative='',lastNav='',hostPayload=null,lastNavigationRevision=null;
  const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b),clone=value=>value===undefined?undefined:structuredClone(value),valid3=v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite);
  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const units={m:1e9,cm:1e7,mm:1e6,um:1e3,'µm':1e3,nm:1};
  function resolution(state=viewer.state.toJSON()){
    return Object.values(state.dimensions||{}).slice(0,3).map(([value,unit])=>value*(units[unit]||1));
  }
  function volumeBegin(){
    const bounds=viewer.layerManager.managedLayers.find(l=>l.name==='Границы '+volumeId)?.layer?.localAnnotations?.annotationMap?.get('volume-bounds');
    return bounds?.pointA?[...bounds.pointA]:[0,0,0];
  }
  function navigationCamera(){
    const panel=[...viewer.display.panels].find(p=>p.visible&&!p.sliceView),p=panel?.projectionParameters?.value;if(!p||!panel.element.clientWidth||!panel.element.clientHeight)return null;
    const res=resolution(),m=p.invViewMatrix,indices=p.displayDimensionRenderInfo?.displayDimensionIndices||[0,1,2];
    if(res.length!==3||res.some(n=>!Number.isFinite(n)||n<=0))return null;
    const column=index=>{const vector=[0,0,0];for(let i=0;i<3;i++)vector[indices[i]]=m[index*4+i]*res[indices[i]];return vector;};
    const normalize=v=>{const n=Math.hypot(...v);return n?v.map(x=>x/n):v;},up=column(1),begin=volumeBegin(),position=[...viewer.position.value];
    const camera={right:normalize(column(0)),up:normalize(up),eye_direction:normalize(column(2)),physical_height_nm:2*Math.hypot(...up)/Math.abs(p.projectionMat[5]),center_nm:position.map((n,i)=>(n-begin[i])*res[i]),orthographic:panel.viewer.orthographicProjection.value};
    return [camera.right,camera.up,camera.eye_direction,camera.center_nm].every(valid3)&&Number.isFinite(camera.physical_height_nm)&&camera.physical_height_nm>0?camera:null;
  }
  function quaternion(camera){
    const right=camera.right,up=camera.up,eye=camera.eye_direction;if(![right,up,eye].every(valid3))return null;
    const norm=v=>{const n=Math.hypot(...v);return n>0?v.map(x=>x/n):null;},r=norm(right),u=norm(up),e=norm(eye);if(!r||!u||!e)return null;
    const m=[r[0],-u[0],-e[0],r[1],-u[1],-e[1],r[2],-u[2],-e[2]],trace=m[0]+m[4]+m[8];let q,s;
    if(trace>0){s=Math.sqrt(trace+1)*2;q=[(m[7]-m[5])/s,(m[2]-m[6])/s,(m[3]-m[1])/s,s/4];}
    else if(m[0]>m[4]&&m[0]>m[8]){s=Math.sqrt(1+m[0]-m[4]-m[8])*2;q=[s/4,(m[1]+m[3])/s,(m[2]+m[6])/s,(m[7]-m[5])/s];}
    else if(m[4]>m[8]){s=Math.sqrt(1+m[4]-m[0]-m[8])*2;q=[(m[1]+m[3])/s,s/4,(m[5]+m[7])/s,(m[2]-m[6])/s];}
    else{s=Math.sqrt(1+m[8]-m[0]-m[4])*2;q=[(m[2]+m[6])/s,(m[5]+m[7])/s,s/4,(m[3]-m[1])/s];}
    const n=Math.hypot(...q);return q.map(x=>x/n);
  }
  function restore(key,value){const child=viewer.state.children.get(key);if(!child||same(child.toJSON(),value))return;if(value===undefined)child.reset();else child.restoreState(clone(value));}
  function stateSnapshot(){
    const native=viewer.state.toJSON(),state={title:native.title,dimensions:clone(native.dimensions)};
    for(const key of [...NAV,...SETTINGS])state[key]=clone(native[key]);
    state.showSlices=viewer.showPerspectiveSliceViews.value;
    state.layers=viewer.layerManager.managedLayers.filter(l=>ownLayer(l.name)).map(l=>clone(l.toJSON()));
    return state;
  }
  function markBaseline(){const state=stateSnapshot();lastNative=JSON.stringify(state);lastNav=JSON.stringify(NAV.map(key=>state[key]));}
  function applyLayer(managed,spec){
    const layer=managed.layer,before=managed.toJSON();
    managed.archived=!!spec.archived;managed.visible=spec.visible!==false&&!managed.archived;
    if(spec.type==='annotation'&&layer.localAnnotations){
      if(!same(layer.localAnnotations.toJSON(),spec.annotations||[]))layer.localAnnotations.restoreState(clone(spec.annotations||[]));
      if('annotationColor'in spec&&!same(before.annotationColor,spec.annotationColor))layer.annotationDisplayState.color.restoreState(spec.annotationColor);
      if('shader'in spec&&!same(before.shader,spec.shader))layer.annotationDisplayState.shader.restoreState(spec.shader);
      if('shaderControls'in spec&&!same(before.shaderControls,spec.shaderControls))layer.annotationDisplayState.shaderControls.restoreState(spec.shaderControls);
    }else if(spec.type==='segmentation'){
      const d=layer.displayState,g=d.segmentationGroupState.value,c=d.segmentationColorGroupState.value;
      for(const key of ['selectedAlpha','notSelectedAlpha','objectAlpha','saturation','hoverHighlight','ignoreNullVisibleSet'])if(key in spec&&!same(before[key],spec[key]))d[key]?.restoreState(spec[key]);
      if('segments'in spec&&!same(before.segments||[],spec.segments)){g.selectedSegments.clear();g.visibleSegments.clear();g.restoreState({segments:spec.segments});}
      if('segmentColors'in spec&&!same(before.segmentColors||{},spec.segmentColors)){c.segmentStatedColors.clear();c.restoreState({segmentColors:spec.segmentColors});}
    }else if(spec.type==='image'){
      if('opacity'in spec&&!same(before.opacity,spec.opacity))layer.opacity.restoreState(spec.opacity);
      if('shader'in spec&&!same(before.shader,spec.shader))layer.fragmentMain.restoreState(spec.shader);
      if('shaderControls'in spec&&!same(before.shaderControls,spec.shaderControls))layer.shaderControlState.restoreState(spec.shaderControls);
    }
  }
  function createLayer(spec){
    const template=viewer.layerManager.managedLayers.find(l=>l.layer&&l.toJSON()?.type===spec.type);
    if(!template)throw new Error('Нет нативного типа слоя '+spec.type);
    // Same construction sequence as the pinned native makeLayer/initializeLayerFromSpec.
    const managed=new template.constructor(spec.name,viewer.layerSpecification);
    managed.archived=!!spec.archived;managed.visible=spec.visible!==false&&!managed.archived;
    managed.layer=new template.layer.constructor(managed);viewer.layerManager.addManagedLayer(managed);
    try{managed.layer.restoreState(clone(spec));managed.layer.initializationDone();}catch(error){viewer.layerManager.removeManagedLayer(managed);throw error;}
    return managed;
  }
  async function applyLayers(specs){
    if(!Array.isArray(specs))return;
    const desired=new Set(specs.filter(s=>ownLayer(s.name)).map(s=>s.name));
    // Add new layer types before removing obsolete layers, retaining a constructor template.
    for(const spec of specs){if(!ownLayer(spec.name))continue;let managed=viewer.layerManager.managedLayers.find(l=>l.name===spec.name);
      if(managed&&managed.toJSON().type!==spec.type){viewer.layerManager.removeManagedLayer(managed);managed=null;}
      if(!managed)managed=createLayer(spec);else applyLayer(managed,spec);
    }
    for(const managed of [...viewer.layerManager.managedLayers])if(ownLayer(managed.name)&&!desired.has(managed.name))viewer.layerManager.removeManagedLayer(managed);
    const start=performance.now();while(specs.some(s=>s.type==='annotation'&&ownLayer(s.name)&&!viewer.layerManager.managedLayers.find(l=>l.name===s.name)?.layer?.localAnnotations)){
      if(performance.now()-start>10000)throw new Error('Слой меток ещё загружается.');await pause(20);
    }
    viewer.layerManager.layersChanged.dispatch();window.MicronsMarkers?.redraw();
  }
  async function applyMessage(message){
    const p=message.payload;if(!p||!p.caseId||!p.volumeId)return;
    const changedCase=caseId!==p.caseId||volumeId!==p.volumeId;caseId=p.caseId;volumeId=p.volumeId;
    if(changedCase){const url=new URL(location.href);url.searchParams.set('case',caseId);url.searchParams.set('volume',volumeId);history.replaceState(history.state,'',url.href);}
    if(message.type==='ng-focus'){
      if(valid3(p.point))restore('position',p.point);return;
    }
    const state=p.state;if(!state)return;
    if(state.title)restore('title',state.title);
    if(message.type==='host-state')hostPayload=p;
    if(state.dimensions)restore('dimensions',state.dimensions);
    await applyLayers(state.layers);
    for(const key of SETTINGS)if(key in state)restore(key,state[key]);
    const applyNavigation=message.type==='ng-state'||p.navigate||changedCase||!applied||p.navigationRevision&&p.navigationRevision!==lastNavigationRevision;
    if(applyNavigation){
      const source=changedCase||!applied?'all':p.navigationSource||'all';
      for(const key of NAV)if(key in state&&(message.type==='ng-state'||key==='position'||source==='all'||source==='2d'&&key.startsWith('crossSection')||source==='3d'&&key.startsWith('projection')))restore(key,state[key]);
      if(message.type==='host-state'){
        const camera=p.main?.navigation?.surface,q=camera&&quaternion(camera),res=resolution(state);
        if(source!=='2d'&&q)restore('projectionOrientation',q);
        if(source!=='2d'&&Number.isFinite(camera?.physical_height_nm)&&camera.physical_height_nm>0&&res.length===3)restore('projectionScale',camera.physical_height_nm/Math.min(...res));
        if(source==='3d'&&valid3(camera?.center_nm)){const begin=volumeBegin();restore('position',camera.center_nm.map((n,i)=>begin[i]+n/res[i]));}
      }
    }
    if(applyNavigation&&p.focus?.point_nm&&valid3(p.focus.point_nm))restore('position',p.focus.point_nm.map((n,i)=>n/resolution(state)[i]));
    if(message.type==='host-state'&&applyNavigation)lastNavigationRevision=p.navigationRevision||null;
    if(message.type==='ng-state')lastNavigationRevision=message.source+':'+message.clock;
    syncSectionPanels();
  }
  function finishWaiters(){if(!applying&&!pending)while(waiters.length)waiters.shift()(applied);}
  async function drain(){
    if(!started||applying)return;applying=true;clearTimeout(timer);timer=null;
    try{while(pending){const message=pending;pending=null;await applyMessage(message);const display=viewer.display;if(display.canvas.offsetWidth&&display.canvas.offsetHeight){display.resizeCallback();display.draw();}applied=message;markBaseline();}}
    catch(error){window.dispatchEvent(new CustomEvent('microns:sync-error',{detail:{message:error.message}}));console.error('Neuroglancer synchronization:',error);}
    finally{markBaseline();applying=false;finishWaiters();}
  }
  function receive(message){
    if(message.type==='hello'){if(latest)bus.send('state-reply',{message:latest},message.source);return;}
    if(message.type==='state-reply'){const nested=message.payload?.message;if(nested)receive(nested);return;}
    if(!['host-state','ng-state','ng-focus'].includes(message.type)||message.source===bus.id||!bus.newer(message,latest))return;
    latest=message;pending=message;drain();
  }
  function publish(){
    timer=null;if(applying||pending||!caseId||!volumeId)return;
    const state=stateSnapshot(),fingerprint=JSON.stringify(state);if(fingerprint===lastNative)return;
    const nav=JSON.stringify(NAV.map(key=>state[key])),reason=nav!==lastNav?'navigation':'settings';lastNative=fingerprint;lastNav=nav;
    latest=bus.send('ng-state',{caseId,volumeId,state,navigationCamera:navigationCamera(),reason});applied=latest;
  }
  function schedule(){if(applying||!started)return;if(timer!==null)clearTimeout(timer);timer=setTimeout(publish,90);}
  // Native xy-3d normally shares a single section texture. The two section renderers below
  // share navigation and data chunks, but each asks for its own named segmentation layers.
  const splitSlices=new Map();
  function filteredManager(root,threeD){
    const proxy=Object.create(root);proxy.readyRenderLayers=function*(){
      for(const managed of root.managedLayers){if(!managed.visible||!managed.layer)continue;
        if(threeD?managed.name==='Сегментация 2D · v1300':['Сегментация среза 3D · v1300','Соседние на срезе 3D · v1300'].includes(managed.name))continue;
        yield*managed.layer.renderLayers;
      }
    };return proxy;
  }
  function syncSectionPanels(){
    const panels=[...viewer.display.panels],slices=panels.filter(p=>p.sliceView),perspectives=panels.filter(p=>!p.sliceView&&p.sliceViews);
    for(const panel of slices){const original=panel.sliceView;if(original.micronsFiltered)continue;original.layerManager=filteredManager(original.layerManager,false);original.micronsFiltered=true;original.updateVisibleLayers();}
    for(const panel of perspectives){if(splitSlices.has(panel))continue;
      const original=[...panel.sliceViews.keys()].find(s=>slices.some(p=>p.sliceView===s));if(!original)continue;
      const initial=original.projectionParameters.value;if(![initial.logicalWidth,initial.logicalHeight].every(n=>Number.isFinite(n)&&n>0))continue;
      const slice=new original.constructor(original.chunkManager,filteredManager(viewer.layerManager,true),original.navigationState.addRef(),original.wireFrame);
      const matchViewport=()=>{const p=original.projectionParameters.value;if(![p.logicalWidth,p.logicalHeight].every(n=>Number.isFinite(n)&&n>0))return;const width=Math.round(p.logicalWidth),height=Math.round(p.logicalHeight);slice.projectionParameters.setViewport({width,height,logicalWidth:width,logicalHeight:height,visibleLeftFraction:0,visibleTopFraction:0,visibleWidthFraction:1,visibleHeightFraction:1});slice.flushBackendProjectionParameters();};
      const dispose=original.projectionParameters.changed.add(matchViewport);matchViewport();
      panel.sliceViews.delete(original);panel.sliceViews.set(slice,false);splitSlices.set(panel,{slice,dispose});panel.scheduleRedraw();
    }
    for(const [panel,entry]of splitSlices)if(!panels.includes(panel)){entry.dispose();splitSlices.delete(panel);}
  }
  function start(){
    if(!window.viewer?.display||!window.MicronsMarkers){setTimeout(start,50);return;}
    started=true;syncSectionPanels();markBaseline();viewer.state.changed.add(schedule);viewer.display.updateFinished.add(syncSectionPanels);
    window.addEventListener('microns:focus',event=>{
      const d=event.detail;if(applying||!d?.id||!valid3(d.point)||!caseId||!volumeId)return;
      restore('position',d.point);markBaseline();latest=bus.send('ng-focus',{caseId,volumeId,id:d.id,point:d.point,seed:!!d.seed,navigationCamera:navigationCamera()});applied=latest;
    });
    bus.subscribe(receive);bus.send('hello');drain();
    window.MicronsViewSync={get latest(){return latest;},get applied(){return applied;},get applying(){return applying||!!pending;},get caseId(){return caseId;},get volumeId(){return volumeId;},navigationCamera,whenSettled(){return applying||pending?new Promise(resolve=>waiters.push(resolve)):Promise.resolve(applied);}};
  }
  start();
})();
