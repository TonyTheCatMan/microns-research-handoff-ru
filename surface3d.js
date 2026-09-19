/* Russian online adaptation of the supplied MICrONS mesh viewer. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const vec = {
    add:(a,b)=>a.map((n,i)=>n+b[i]), sub:(a,b)=>a.map((n,i)=>n-b[i]),
    mul:(a,s)=>a.map(n=>n*s), dot:(a,b)=>a.reduce((s,n,i)=>s+n*b[i],0),
    cross:(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],
    norm:a=>{const d=Math.hypot(...a);return d?a.map(n=>n/d):[0,0,0];}
  };
  function multiply(a,b) {
    const out=new Float32Array(16);
    for(let col=0;col<4;col++)for(let row=0;row<4;row++)for(let k=0;k<4;k++)out[col*4+row]+=a[k*4+row]*b[col*4+k];
    return out;
  }
  function lookAt(eye,target) {
    const z=vec.norm(vec.sub(eye,target)),x=vec.norm(vec.cross([0,-1,0],z)),y=vec.cross(z,x);
    return {matrix:new Float32Array([x[0],y[0],z[0],0,x[1],y[1],z[1],0,x[2],y[2],z[2],0,-vec.dot(x,eye),-vec.dot(y,eye),-vec.dot(z,eye),1]),right:x,up:y};
  }
  function ortho(left,right,bottom,top,near,far) {
    return new Float32Array([2/(right-left),0,0,0,0,2/(top-bottom),0,0,0,0,-2/(far-near),0,-(right+left)/(right-left),-(top+bottom)/(top-bottom),-(far+near)/(far-near),1]);
  }
  function read(file,text=false) { return HandoffAssets.read(file.onlinePath,text); }
  const normPath=p=>String(p).replace(/\\/g,'/').replace(/^\.\//,'');
  const finite3=a=>Array.isArray(a)&&a.length===3&&a.every(Number.isFinite);
  const equal3=(a,b,tol=.0001)=>finite3(a)&&finite3(b)&&a.every((n,i)=>Math.abs(n-b[i])<=tol);
  function cameraBasis(value){
    if(!value)return null;const right=value.right,up=value.up,eye=value.eye_direction||value.eyeDirection||(finite3(value.direction)?vec.mul(value.direction,-1):null);
    if(![right,up,eye].every(finite3)||[right,up,eye].some(v=>Math.abs(Math.hypot(...v)-1)>.001)||Math.abs(vec.dot(right,up))>.001||Math.abs(vec.dot(right,eye))>.001||Math.abs(vec.dot(up,eye))>.001||vec.dot(vec.cross(right,up),eye)<.999)throw new Error('Неверные оси синхронизированной 3D-камеры.');
    return {right:vec.norm(right),up:vec.norm(up),eye_direction:vec.norm(eye)};
  }
  function rotateVector(value,axis,angle){const c=Math.cos(angle),s=Math.sin(angle);return vec.add(vec.add(vec.mul(value,c),vec.mul(vec.cross(axis,value),s)),vec.mul(axis,vec.dot(axis,value)*(1-c)));}
  // CPU intersection uses the same orthographic camera and actual triangles as WebGL.
  function rayTriangle(origin,direction,v,a,b,c) {
    const e1x=v[b]-v[a],e1y=v[b+1]-v[a+1],e1z=v[b+2]-v[a+2],e2x=v[c]-v[a],e2y=v[c+1]-v[a+1],e2z=v[c+2]-v[a+2];
    const px=direction[1]*e2z-direction[2]*e2y,py=direction[2]*e2x-direction[0]*e2z,pz=direction[0]*e2y-direction[1]*e2x,det=e1x*px+e1y*py+e1z*pz;
    if(Math.abs(det)<1e-10)return null;
    const inv=1/det,tx=origin[0]-v[a],ty=origin[1]-v[a+1],tz=origin[2]-v[a+2],u=(tx*px+ty*py+tz*pz)*inv;
    if(u< -1e-7||u>1+1e-7)return null;
    const qx=ty*e1z-tz*e1y,qy=tz*e1x-tx*e1z,qz=tx*e1y-ty*e1x,w=(direction[0]*qx+direction[1]*qy+direction[2]*qz)*inv;
    if(w< -1e-7||u+w>1+1e-7)return null;
    const t=(e2x*qx+e2y*qy+e2z*qz)*inv;return t>=.01?t:null;
  }
  function rayBox(origin,direction,bounds,maxDistance=Infinity) {
    let near=0,far=maxDistance;
    for(let i=0;i<3;i++){
      if(Math.abs(direction[i])<1e-12){if(origin[i]<bounds[0][i]||origin[i]>bounds[1][i])return false;continue;}
      let a=(bounds[0][i]-origin[i])/direction[i],b=(bounds[1][i]-origin[i])/direction[i];if(a>b)[a,b]=[b,a];
      near=Math.max(near,a);far=Math.min(far,b);if(far<near)return false;
    }
    return true;
  }
  function vertexBounds(vertices) {
    const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
    for(let i=0;i<vertices.length;i++){const axis=i%3;lo[axis]=Math.min(lo[axis],vertices[i]);hi[axis]=Math.max(hi[axis],vertices[i]);}return [lo,hi];
  }
  const PALETTE=['#80b8c4','#d4ae77','#adb4d8','#95baa1','#c2a0ae','#bbbd81'];
  const color=s=>{
    const c=/^#[0-9a-f]{6}$/i.test(s)?s:'#80b8c4';
    return [1,3,5].map(i=>parseInt(c.slice(i,i+2),16)/255);
  };

  class LocalSurfaceView {
    constructor() {
      this.canvas=$('surfaceCanvas');this.labels=$('surfaceLabels');this.stage=$('surfaceStage');
      this.note=$('surfaceStatus');this.objectsUI=$('surfaceObjects');this.files=[];this.token=0;
      this.meshes=[];this.volume=null;this.slice=null;this.target=null;this.showMarker=false;this.frame=null;this.pending=false;
      this.annotations=[];this.annotationMode='off';this.annotationsVisible=true;this.selectedAnnotationId=null;this.selectedObjectId=null;this.annotationHits=[];this.targets=[];this.targetsVisible=false;
      this.contextVisible=false;this.contextLoaded=false;this.contextWorker=null;this.contextToken=0;
      this.contextMode='slice';this.contextAlpha=.25;this.segmentationVisible=false;this.segmentationAlpha=.25;this.sliceSegmentation=null;this.contextSliceReady=false;this.segmentationReady=false;
      this.contextLimit=5;this.contextFocus=null;this.contextFocusLabel='центр среза';this.contextShown=new Set();this.visibilityPending=false;
      this.modelReady=false;this.targetHits=[];this.navigationSignature='';this.cameraBasis=null;
      this.controls=['surfaceReset','surfaceXY','surfacePlane','surfaceBox','surfaceOpacity','surfaceExport'];
      this.yaw=-.65;this.pitch=.4;this.zoom=1;this.alpha=.8;
      this.canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();this.gl=null;this.setStatus('Контекст 3D-графики потерян. Перезагрузите страницу, чтобы восстановить 3D. Просмотр TIFF в 2D остаётся доступен.','error');this.enable(false);});
      try {this.initGL();} catch(error) {this.gl=null;this.setStatus('3D недоступно в этом браузере: '+error.message+'. Просмотр TIFF в 2D остаётся доступен.','error');}
      this.bind();this.enable(false);this.resize();
      if(this.gl)this.setStatus('Поверхности загружаются с выбранным объёмом.');
      this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(this.stage);
    }
    setStatus(text,kind='') {this.note.textContent=text;this.note.className='surface-status '+kind;if(kind==='error'&&this.note.closest('details'))this.note.closest('details').open=true;$('surfaceRetry').hidden=!(kind==='error'&&this.volume&&this.gl);}
    enable(yes) {for(const id of this.controls)if($(id))$(id).disabled=!yes;}
    find(path) { return HandoffAssets.file(path); }
    setFiles(files) {
      this.files=files;this.indexPromise=null;this.contextIndexPromise=null;this.clear();
    }
    async index() {
      if(!this.indexPromise)this.indexPromise=(async()=>{
        const metadata=JSON.parse(await read(this.find('model_index.json'),true));
        if(!metadata||!Array.isArray(metadata.cases))throw new Error('В файле model_index.json отсутствуют случаи.');
        if(metadata.schema_version!==1||metadata.source_version!=='seg_m1300')throw new Error('Для просмотра требуется предоставленный индекс статической сегментации v1300 со схемой версии 1.');
        const seen=new Set();
        for(const c of metadata.cases)for(const v of c.volumes||[]){if(seen.has(v.volume_id))throw new Error('Повторяется объём модели '+v.volume_id);seen.add(v.volume_id);}
        return metadata;
      })();
      try{return await this.indexPromise;}catch(error){this.indexPromise=null;throw error;}
    }
    clear() {
      this.cancelContext();this.contextLoaded=false;this.contextEntry=null;this.selectedObjectId=null;this.annotationHits=[];this.targetHits=[];this.targets=[];this.modelReady=false;
      this.contextFocus=null;this.contextFocusLabel='центр среза';this.contextShown=new Set();
      this.sliceSegmentation=null;this.contextSliceReady=false;this.segmentationReady=false;
      ++this.token;this.volume=null;this.slice=null;this.target=null;this.meshes.forEach(m=>this.deleteGeometry(m.geometry));this.meshes=[];
      if(this.boxGeometry)this.deleteGeometry(this.boxGeometry);if(this.axisGeometry)this.deleteGeometry(this.axisGeometry);
      this.boxGeometry=this.axisGeometry=null;this.objectsUI.replaceChildren();this.enable(false);
      $('surfaceReadout').textContent='Объём не загружен.';
      this.canvas.dataset.volume='';this.canvas.dataset.triangleCount='0';this.canvas.dataset.planeLocalNm='';this.canvas.dataset.targetLocalNm='';
      this.canvas.dataset.contextCount='0';
      if(this.gl)this.setStatus('3D-поверхности загрузятся вместе с выбранной стопкой изображений.');this.schedule();
    }
    async setVolume(volume,caseId) {
      this.clear();const token=this.token;this.volume=volume;this.caseId=caseId;
      this.bounds=volume.shape_xyz.map((n,i)=>n*volume.resolution_nm[i]);this.reset();
      if(!this.gl)return;
      this.makeFrame();this.enable(true);this.canvas.dataset.volume=volume.volume_id;
      this.setStatus('Загрузка '+volume.volume_id+' — 3D-поверхности…');
      try {
        const index=await this.index();if(token!==this.token)return;
        const c=index.cases.find(c=>c.case_id===caseId),model=c?.volumes?.find(v=>v.volume_id===volume.volume_id);
        if(!model)throw new Error('Модель поверхности не предоставлена для '+volume.volume_id+'.');
        const expectedOrigin=volume.begin_vox_xyz.map((n,i)=>n*volume.resolution_nm[i]);
        if(model.coordinate_system!=='local_nm'||!equal3(model.origin_global_nm,expectedOrigin)||!equal3(model.shape_xyz,volume.shape_xyz)||!equal3(model.resolution_nm,volume.resolution_nm)||!equal3(model.bounds_local_nm?.[0],[0,0,0])||!equal3(model.bounds_local_nm?.[1],this.bounds))throw new Error('Координаты поверхностей и TIFF не совпадают. Поверхности не показаны; проверьте TIFF в 2D.');
        if(!Array.isArray(model.objects)||model.objects.length>100)throw new Error('Неверный список объектов модели.');
        const seen=new Set();
        for(const object of model.objects) {
          if(token!==this.token)return;
          if(typeof object.id!=='string'||seen.has(object.id))throw new Error('Идентификаторы объектов модели должны быть уникальными.');seen.add(object.id);
          const mesh={id:object.id,segment_id:object.segment_id||null,label:object.label||object.id,color:color(object.color||PALETTE[this.meshes.length%PALETTE.length]),cssColor:object.color||PALETTE[this.meshes.length%PALETTE.length],visible:object.present!==false,clipped:object.clipped_faces||[],geometry:null,faces:0};
          if(object.present!==false&&object.face_count!==0) {
            const [vb,fb]=await Promise.all([read(this.find(object.vertices_path)),read(this.find(object.faces_path))]);
            if(token!==this.token)return;
            if(vb.byteLength%12||fb.byteLength%12)throw new Error(object.id+': неверная длина двоичных данных сетки.');
            const vertices=new Float32Array(vb),faces=new Uint32Array(fb),n=vertices.length/3;
            if(n!==object.vertex_count||faces.length/3!==object.face_count)throw new Error(object.id+': число вершин или граней сетки не соответствует индексу.');
            for(let i=0;i<vertices.length;i++)if(!Number.isFinite(vertices[i])||vertices[i]<-.1||vertices[i]>this.bounds[i%3]+.1)throw new Error(object.id+': вершина находится вне заявленных границ фрагмента.');
            for(let i=0;i<faces.length;i++)if(faces[i]>=n)throw new Error(object.id+': неверный индекс вершины треугольника.');
            mesh.geometry=this.geometry(vertices,faces);mesh.faces=faces.length/3;mesh.vertices=vertices;mesh.triangles=faces;mesh.bounds=vertexBounds(vertices);
          }
          this.meshes.push(mesh);this.objectControl(mesh);this.schedule();
        }
        if(token!==this.token)return;
        const count=this.meshes.reduce((s,m)=>s+m.faces,0),clipped=this.meshes.filter(m=>m.clipped.length).length;
        this.canvas.dataset.triangleCount=String(count);
        this.modelReady=true;
        this.setStatus(this.meshes.filter(m=>m.geometry).length+' объектов · '+count.toLocaleString()+' треугольников · '+(clipped?clipped+' объектов достигают границы фрагмента; открытые концы соответствуют границам обрезки.':'Ни один из предоставленных объектов не отмечен как касающийся границы фрагмента.')+' Статическая сегментация v1300; только для навигации.');
        this.schedule();
        window.dispatchEvent(new CustomEvent('annotations:surface-ready',{detail:{case_id:caseId,volume_id:volume.volume_id}}));
        this.loadContextEntry(token).then(()=>{if(token===this.token&&this.contextVisible)this.setContextVisible(true);}).catch(error=>{if(token===this.token&&this.contextVisible)this.contextStatus('error',error.message);});
      } catch(error) {
        if(token!==this.token)return;
        this.meshes.forEach(m=>this.deleteGeometry(m.geometry));this.meshes=[];this.objectsUI.replaceChildren();this.canvas.dataset.triangleCount='0';
        this.setStatus('3D-поверхности недоступны: '+error.message+' Синхронизированный срез исходного изображения и просмотр в 2D остаются доступны.','error');this.schedule();
        window.dispatchEvent(new CustomEvent('annotations:surface-error',{detail:{case_id:caseId,volume_id:volume.volume_id,message:error.message}}));
      }
    }
    objectControl(mesh) {
      const label=document.createElement('label');label.className='surface-object';
      const input=document.createElement('input');input.type='checkbox';input.checked=mesh.visible&&(mesh.context||!!mesh.geometry);input.disabled=!mesh.context&&!mesh.geometry;input.dataset.objectId=mesh.id;
      input.addEventListener('change',()=>{mesh.visible=input.checked;if(mesh.context)this.updateNearby();else this.updateSliceTextures();this.visibilityChanged();this.schedule();});
      const swatch=document.createElement('span');swatch.className='object-swatch';swatch.style.backgroundColor=/^#[0-9a-f]{6}$/i.test(mesh.cssColor)?mesh.cssColor:'#80b8c4';
      const text=document.createElement('span');text.textContent=mesh.id+' · '+mesh.label+(mesh.context?'':mesh.geometry?(mesh.clipped.length?' · ограничен границами фрагмента':''):' · отсутствует в этом объёме');
      label.append(input,swatch,text);label.title=mesh.clipped.length?'Касается граней фрагмента: '+mesh.clipped.join(', '):'Нейтральное обозначение объекта; цвет не указывает на класс клетки.';label.dataset.objectId=mesh.id;
      if(mesh.context){label.dataset.context='true';label.hidden=!this.contextVisible||!this.contextShown.has(mesh.id);label.title+=' Сегмент окружения; класс клетки не установлен.';}
      mesh.control=label;this.objectsUI.append(label);
    }
    contextStatus(status,message,count=0) {
      window.dispatchEvent(new CustomEvent('annotations:contextstatus',{detail:{case_id:this.caseId,volume_id:this.volume?.volume_id,status,message,count}}));
      if(status!=='loading')this.visibilityChanged();
    }
    visibilityChanged(){if(this.visibilityPending)return;this.visibilityPending=true;queueMicrotask(()=>{this.visibilityPending=false;window.dispatchEvent(new CustomEvent('surface:visibility',{detail:{case_id:this.caseId,volume_id:this.volume?.volume_id}}));});}
    visibleSegments(fallback=[]){
      if(!this.modelReady)return null;
      return this.meshes.filter(m=>m.context?m.visible&&this.contextVisible&&this.contextShown.has(m.id):this.visibleMesh(m)).map(m=>({id:m.id,segment:m.segment_id||fallback.find(o=>o.id===m.id)?.segment,color:m.cssColor,context:!!m.context}));
    }
    cancelContext() {
      ++this.contextToken;if(this.contextWorker)this.contextWorker.terminate();this.contextWorker=null;this.contextLoading=false;
    }
    async loadContextEntry(token=this.token) {
      if(this.contextEntry)return this.contextEntry;
      if(!this.contextIndexPromise)this.contextIndexPromise=fetch('context_index.json').then(async response=>{
        if(!response.ok)throw new Error('Не удалось загрузить индекс окружающих сегментов.');
        const index=await response.json();if(index.schema_version!==1||index.source_version!=='seg_m1300'||!Array.isArray(index.volumes))throw new Error('Неизвестный формат окружающей сегментации.');return index;
      }).catch(error=>{this.contextIndexPromise=null;throw error;});
      const index=await this.contextIndexPromise;if(token!==this.token||!this.volume)return null;
      const entry=index.volumes.find(v=>v.volume_id===this.volume.volume_id&&v.case_id===this.caseId);
      if(!entry)throw new Error('Для этого объёма окружающие сегменты не предоставлены.');
      const origin=this.volume.begin_vox_xyz.map((n,i)=>n*this.volume.resolution_nm[i]);
      if(!equal3(entry.origin_global_nm,origin)||!equal3(entry.shape_xyz,this.volume.shape_xyz)||!equal3(entry.resolution_nm,this.volume.resolution_nm)||!equal3(entry.bounds_local_nm?.[0],[0,0,0])||!equal3(entry.bounds_local_nm?.[1],this.bounds))throw new Error('Координаты окружающей сегментации не совпадают с изображением.');
      if(!Array.isArray(entry.objects)||!Array.isArray(entry.seed_objects)||typeof entry.data_path!=='string'||!/^context-data\/[a-zA-Z0-9_./-]+$/.test(entry.data_path)||entry.data_path.includes('..'))throw new Error('Неверное описание окружающих сегментов.');
      this.contextEntry=entry;for(const seed of entry.seed_objects){const mesh=this.meshes.find(m=>!m.context&&m.id===seed.id);if(mesh&&typeof seed.segment_id==='string')mesh.segment_id=seed.segment_id;}
      // Descriptors also represent exact section footprints, without loading full 3D meshes.
      for(const object of entry.objects)if(!this.meshes.some(m=>m.id===object.id)){
        const rgb=window.SliceSegmentation?.colorForSegment?.(object.segment_id),cssColor=rgb?'#'+rgb.map(n=>n.toString(16).padStart(2,'0')).join(''):PALETTE[Number(object.id.slice(1))%PALETTE.length];
        const mesh={id:object.id,segment_id:object.segment_id,label:'Сегмент окружения',color:color(cssColor),cssColor,visible:true,context:true,clipped:object.clipped_faces||[],geometry:null,faces:0};
        this.meshes.push(mesh);this.objectControl(mesh);
      }
      window.SliceSegmentation?.setColors?.(Object.fromEntries(this.meshes.filter(m=>m.segment_id).map(m=>[m.segment_id,m.cssColor])),this.volume.volume_id);
      this.refreshSelectedObject();this.updateNearby();this.updateSliceTextures();this.visibilityChanged();return entry;
    }
    async setContextVisible(visible) {
      this.contextVisible=!!visible;const volumeToken=this.token;
      if(!visible){
        if(this.contextLoading)this.cancelContext();
        for(const mesh of this.meshes)if(mesh.context&&mesh.control)mesh.control.hidden=true;
        this.contextStatus('hidden','Окружающие сегменты скрыты.');this.updateSliceTextures();this.schedule();return;
      }
      this.schedule();if(!this.gl||!this.volume)return;
      if(this.contextMode==='slice'){
        this.cancelContext();
        try{await this.loadContextEntry(volumeToken);if(volumeToken===this.token&&this.contextVisible)this.updateNearby();}
        catch(error){if(volumeToken===this.token)this.contextStatus('error',error.message);}return;
      }
      if(this.contextLoaded){this.updateNearby();return;}
      if(this.contextLoading)return;this.contextLoading=true;const workerToken=++this.contextToken;this.contextStatus('loading','Загрузка окружающих сегментов…');
      try {
        const entry=await this.loadContextEntry(volumeToken);
        if(volumeToken!==this.token||workerToken!==this.contextToken||!this.contextVisible||!entry)return;
        const worker=new Worker('context-worker.js');this.contextWorker=worker;
        const fail=message=>{
          if(volumeToken!==this.token||workerToken!==this.contextToken)return;
          this.cancelContext();this.contextLoaded=false;for(const mesh of this.meshes.filter(m=>m.context)){this.deleteGeometry(mesh.geometry);mesh.geometry=null;mesh.vertices=null;mesh.triangles=null;}this.contextStatus('error',message);this.schedule();
        };
        worker.onerror=event=>fail('Не удалось построить окружающие поверхности: '+event.message);
        worker.onmessage=event=>{
          if(volumeToken!==this.token||workerToken!==this.contextToken||event.data.token!==workerToken)return;
          const data=event.data;
          if(data.type==='progress'){this.contextStatus('loading',data.message);return;}
          if(data.type==='error'){fail(data.message);return;}
          if(data.type==='done'){
            this.contextLoading=false;this.contextLoaded=true;worker.terminate();this.contextWorker=null;
            const count=this.meshes.filter(m=>m.context).length;this.canvas.dataset.contextCount=String(count);this.updateNearby();this.schedule();return;
          }
          if(data.type!=='mesh')return;
          try {
            const object=data.object,vertices=object.vertices,faces=object.faces,expected=entry.objects.find(o=>o.id===object.id);
            if(!expected||expected.segment_id!==object.segment_id||!(vertices instanceof Float32Array)||!(faces instanceof Uint32Array)||vertices.length%3||faces.length%3)throw new Error('Неверная сетка сегмента окружения.');
            const bounds=vertexBounds(vertices);if(!bounds.every(a=>a.every(Number.isFinite))||bounds[0].some(n=>n<-.1)||bounds[1].some((n,i)=>n>this.bounds[i]+.1))throw new Error('Сегмент окружения находится вне границ изображения.');
            for(let i=0;i<faces.length;i++)if(faces[i]>=vertices.length/3)throw new Error('Неверные треугольники сегмента окружения.');
            const mesh=this.meshes.find(m=>m.context&&m.id===object.id);if(!mesh)throw new Error('Неизвестный сегмент окружения.');
            this.deleteGeometry(mesh.geometry);Object.assign(mesh,{vertices,triangles:faces,bounds,geometry:this.geometry(vertices,faces),faces:faces.length/3});this.refreshSelectedObject();this.schedule();
          }catch(error){fail(error.message);}
        };
        worker.postMessage({type:'load',token:workerToken,volume:entry,url:new URL(entry.data_path,location.href).href});
      }catch(error){if(volumeToken===this.token&&workerToken===this.contextToken){this.contextLoading=false;this.contextStatus('error',error.message);}}
    }
    setAnnotationMode(mode) {
      this.annotationMode=['point','object'].includes(mode)?mode:'off';this.stage.style.cursor=this.annotationMode==='off'?'grab':'crosshair';this.stage.dataset.annotationMode=this.annotationMode;
    }
    setContextLimit(number){this.contextLimit=Number.isFinite(number)?Math.max(1,Math.min(30,Math.round(number))):5;if($('contextLimit'))$('contextLimit').value=String(this.contextLimit);if($('contextLimitReadout'))$('contextLimitReadout').textContent=String(this.contextLimit);this.updateNearby();}
    setContextMode(mode){this.contextMode=mode==='full'?'full':'slice';if($('surfaceContextMode'))$('surfaceContextMode').value=this.contextMode;this.contextShown.clear();this.updateSliceTextures();this.setContextVisible(this.contextVisible);this.visibilityChanged();this.schedule();}
    focusAnnotation(annotation,centerView=false){const point=this.annotationPosition(annotation);if(point){this.setContextFocus(point,'метка '+annotation.number);if(centerView){this.center=[...point];this.zoom=Math.min(this.zoom,.55);this.navigationChanged('go');this.schedule();}}}
    clearContextFocus(){if(!this.contextFocus&&this.contextFocusLabel==='центр среза')return;this.contextFocus=null;this.contextFocusLabel='центр среза';this.updateNearby();this.visibilityChanged();this.schedule();}
    clearPointFocus(){this.selectedAnnotationId=null;this.selectedObjectId=null;this.target=null;this.showMarker=false;this.canvas.dataset.targetLocalNm='';this.clearContextFocus();this.schedule();}
    forgetAnnotationFocus(number){if(this.contextFocusLabel==='метка '+number)this.clearContextFocus();}
    nearbyCenter(){return this.contextFocus||[this.bounds[0]/2,this.bounds[1]/2,((this.slice?.z??this.volume.shape_xyz[2]/2)+.5)*this.volume.resolution_nm[2]];}
    setContextFocus(point,label){if(!finite3(point))return;if(this.contextFocus&&equal3(point,this.contextFocus)&&label===this.contextFocusLabel)return;this.contextFocus=[...point];this.contextFocusLabel=label;this.updateNearby();this.visibilityChanged();}
    updateNearby(){
      if(!this.volume||!this.contextVisible)return;
      if(this.contextMode==='slice'){
        if(!this.validSliceSegmentation()||!this.contextEntry){this.contextShown.clear();for(const mesh of this.meshes)if(mesh.context&&mesh.control)mesh.control.hidden=true;this.updateSliceTextures();const error=this.sliceSegmentation?.volume_id===this.volume.volume_id&&this.sliceSegmentation?.error;this.contextStatus(error?'error':'loading',error||'Загрузка сегментов текущего среза…');return;}
        const nearest=window.SliceSegmentation.nearest({point_local_nm:this.nearbyCenter(),limit:this.contextLimit,exclude_segment_ids:this.contextEntry.seed_objects.map(o=>o.segment_id)});
        const ids=new Set(nearest.map(o=>typeof o==='string'?o:o.segment_id));this.contextShown=new Set(this.meshes.filter(m=>m.context&&ids.has(m.segment_id)).map(m=>m.id));
        for(const mesh of this.meshes)if(mesh.context&&mesh.control)mesh.control.hidden=!this.contextShown.has(mesh.id);
        const count=this.meshes.filter(m=>m.context&&m.visible&&this.contextShown.has(m.id)).length;this.canvas.dataset.contextVisibleCount=String(count);
        this.updateSliceTextures();this.contextStatus('ready',`На срезе: ${count} · ${this.contextFocusLabel} · Z ${this.slice.z}.`,count);this.schedule();return;
      }
      if(!this.contextLoaded)return;
      const point=this.nearbyCenter();
      // Mesh vertices are measured in physical nanometers; no voxel-aspect approximation.
      const ranked=this.meshes.filter(m=>m.context).map(mesh=>{let distance=Infinity;const a=mesh.vertices;for(let i=0;i<a.length;i+=3){const d=(a[i]-point[0])**2+(a[i+1]-point[1])**2+(a[i+2]-point[2])**2;if(d<distance)distance=d;}return{mesh,distance};}).sort((a,b)=>a.distance-b.distance||a.mesh.id.localeCompare(b.mesh.id));
      this.contextShown=new Set(ranked.slice(0,this.contextLimit).map(r=>r.mesh.id));
      for(const {mesh}of ranked)if(mesh.control)mesh.control.hidden=!this.contextShown.has(mesh.id);
      const count=this.meshes.filter(m=>m.context&&this.visibleMesh(m)).length;this.canvas.dataset.contextVisibleCount=String(count);
      this.updateSliceTextures();this.contextStatus('ready',`Рядом: ${count} · ${this.contextFocusLabel}. Поверхности показаны целиком в пределах объёма.`,count);this.schedule();
    }
    setAnnotations(items,visible=true,selectedId=null) {
      if(this.selectedAnnotationId&&!selectedId&&this.contextFocusLabel.startsWith('метка '))this.clearContextFocus();
      this.annotations=Array.isArray(items)?items.filter(a=>finite3(a.point_nm)):[];this.annotationsVisible=!!visible;this.selectedAnnotationId=selectedId;
      this.refreshSelectedObject();this.schedule();
    }
    setSelectedAnnotation(id) {
      if(this.selectedAnnotationId&&!id&&this.contextFocusLabel.startsWith('метка '))this.clearContextFocus();
      this.selectedAnnotationId=id;this.refreshSelectedObject();this.schedule();
    }
    refreshSelectedObject() {
      const selected=this.annotations.find(a=>a.id===this.selectedAnnotationId);
      this.selectedObjectId=selected?.segment_id?this.meshes.find(m=>m.segment_id===selected.segment_id)?.id||null:selected?.volume_id===this.volume?.volume_id?selected?.object_id||null:null;
    }
    annotationPosition(annotation) {
      if(!this.volume||!finite3(annotation.point_nm)||(annotation.case_id&&annotation.case_id!==this.caseId))return null;
      const origin=this.volume.begin_vox_xyz.map((n,i)=>n*this.volume.resolution_nm[i]),point=vec.sub(annotation.point_nm,origin);
      return point.every((n,i)=>n>=0&&n<=this.bounds[i])?point:null;
    }
    visibleMesh(mesh) {return mesh.visible&&mesh.geometry&&(!mesh.context||this.contextVisible&&this.contextMode==='full'&&this.contextShown.has(mesh.id));}
    pickAt(clientX,clientY) {
      if(!this.volume||!this.gl)return null;const rect=this.stage.getBoundingClientRect(),x=(clientX-rect.left)/rect.width,y=(clientY-rect.top)/rect.height;
      if(x<0||x>1||y<0||y>1)return null;
      const camera=this.camera(),width=camera.height*this.stage.clientWidth/Math.max(1,this.stage.clientHeight),direction=vec.norm(vec.sub(this.center,camera.eye)),origin=vec.add(camera.eye,vec.add(vec.mul(camera.right,(x-.5)*width),vec.mul(camera.up,(.5-y)*camera.height)));
      let closest=null,distance=Infinity;
      for(const mesh of this.meshes){
        if(!this.visibleMesh(mesh)||(mesh.context?this.contextAlpha:this.alpha)<=0||!mesh.vertices||!rayBox(origin,direction,mesh.bounds,distance))continue;
        const triangles=mesh.triangles;
        for(let i=0;i<triangles.length;i+=3){const t=rayTriangle(origin,direction,mesh.vertices,triangles[i]*3,triangles[i+1]*3,triangles[i+2]*3);if(t!==null&&t<distance){distance=t;closest=mesh;}}
      }
      // The opaque image plane can hide a mesh even if the mesh itself is translucent.
      if(this.slice&&Math.abs(direction[2])>1e-12){
        const planeZ=(this.slice.z+.5)*this.volume.resolution_nm[2],t=(planeZ-origin[2])/direction[2],p=vec.add(origin,vec.mul(direction,t));
        if(t>.01&&t<=distance+.001&&p[0]>=0&&p[0]<this.bounds[0]&&p[1]>=0&&p[1]<this.bounds[1]){
          const id=this.validSliceSegmentation()?window.SliceSegmentation.lookup(Math.floor(p[0]/this.volume.resolution_nm[0]),Math.floor(p[1]/this.volume.resolution_nm[1])):null,object=id&&this.meshes.find(m=>m.segment_id===id);
          const allVisible=this.segmentationVisible&&this.segmentationReady&&this.segmentationAlpha>0,nearVisible=this.contextVisible&&this.contextMode==='slice'&&this.contextSliceReady&&this.contextAlpha>0&&object?.context&&object.visible&&this.contextShown.has(object.id);
          if(object&&(allVisible||nearVisible)){closest=object;distance=t;}
          else if($('surfacePlane').checked)return null;
        }
      }
      if(!closest)return null;
      const pointLocal=vec.add(origin,vec.mul(direction,distance)),sourceOrigin=this.volume.begin_vox_xyz.map((n,i)=>n*this.volume.resolution_nm[i]);
      return {case_id:this.caseId,volume_id:this.volume.volume_id,point_nm:vec.add(pointLocal,sourceOrigin),point_local_nm:pointLocal,object_id:closest.id,segment_id:closest.segment_id||null,mode:this.annotationMode,source:'seg_m1300'};
    }
    annotationClick(event) {
      const rect=this.stage.getBoundingClientRect(),x=(event.clientX-rect.left)*this.stage.clientWidth/rect.width,y=(event.clientY-rect.top)*this.stage.clientHeight/rect.height;
      if(this.annotationsVisible){const hit=this.annotationHits.find(p=>Math.hypot(p.x-x,p.y-y)<=13);if(hit){this.setSelectedAnnotation(hit.id);window.dispatchEvent(new CustomEvent('annotations:select3d',{detail:{id:hit.id,case_id:this.caseId,volume_id:this.volume.volume_id}}));return;}}
      const target=this.targetHits.find(p=>Math.hypot(p.x-x,p.y-y)<=12);if(target){window.dispatchEvent(new CustomEvent('surface:targetclick',{detail:{case_id:this.caseId,volume_id:this.volume.volume_id,target_id:target.id,target_key:target.key,point_nm:[...target.nm]}}));return;}
      if(this.annotationMode==='off'){window.dispatchEvent(new CustomEvent('review:deselect',{detail:{source:'surface-background',case_id:this.caseId,volume_id:this.volume.volume_id}}));return;}const hit=this.pickAt(event.clientX,event.clientY);
      if(hit){this.selectedObjectId=hit.object_id;this.schedule();window.dispatchEvent(new CustomEvent('annotations:pick3d',{detail:hit}));}
      else window.dispatchEvent(new CustomEvent('annotations:pick3d-miss',{detail:{case_id:this.caseId,volume_id:this.volume.volume_id,message:'Нажмите на видимую поверхность. При необходимости скройте плоскость среза или мешающие объекты.'}}));
    }
    initGL() {
      const gl=this.canvas.getContext('webgl2',{alpha:false,antialias:true,preserveDrawingBuffer:true});
      if(!gl)throw new Error('WebGL 2 не поддерживается или отключён');this.gl=gl;
      const vs=`#version 300 es
        in vec3 aPosition; in vec2 aUV; uniform mat4 uMVP;
        out vec3 vPosition; out vec2 vUV;
        void main(){vPosition=aPosition;vUV=aUV;gl_Position=uMVP*vec4(aPosition,1.0);}`;
      const fs=`#version 300 es
        precision highp float;
        in vec3 vPosition;in vec2 vUV;uniform vec4 uColor;uniform int uMode;uniform sampler2D uTexture;
        out vec4 frag;
        void main(){
          if(uMode==2){frag=texture(uTexture,vUV)*uColor;if(frag.a<=0.0)discard;return;}
          if(uMode==1){frag=uColor;return;}
          vec3 n=normalize(cross(dFdx(vPosition),dFdy(vPosition)));
          float light=0.44+0.56*abs(dot(n,normalize(vec3(-0.4,-0.65,-1.0))));
          frag=vec4(uColor.rgb*light,uColor.a);
        }`;
      const compile=(type,code)=>{const s=gl.createShader(type);gl.shaderSource(s,code);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s));return s;};
      const v=compile(gl.VERTEX_SHADER,vs),f=compile(gl.FRAGMENT_SHADER,fs),p=gl.createProgram();gl.attachShader(p,v);gl.attachShader(p,f);gl.linkProgram(p);gl.deleteShader(v);gl.deleteShader(f);
      if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(p));
      this.program=p;this.position=gl.getAttribLocation(p,'aPosition');this.uv=gl.getAttribLocation(p,'aUV');
      this.uniforms=Object.fromEntries(['uMVP','uColor','uMode','uTexture'].map(n=>[n,gl.getUniformLocation(p,n)]));
      this.texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,this.texture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      for(const name of ['segmentationTexture','contextSliceTexture']){this[name]=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,this[name]);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);}
      this.planeGeometry=this.geometry(new Float32Array(12),new Uint32Array([0,1,2,0,2,3]),new Float32Array([0,0,1,0,1,1,0,1]));
      this.markerGeometry=this.geometry(new Float32Array(18));
      gl.clearColor(.075,.105,.135,1);gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);gl.disable(gl.CULL_FACE);
    }
    geometry(vertices,indices=null,uv=null) {
      const gl=this.gl,g={positions:gl.createBuffer(),count:indices?indices.length:vertices.length/3,indices:null,uv:null};
      gl.bindBuffer(gl.ARRAY_BUFFER,g.positions);gl.bufferData(gl.ARRAY_BUFFER,vertices,gl.STATIC_DRAW);
      if(indices){g.indices=gl.createBuffer();gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,g.indices);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,indices,gl.STATIC_DRAW);}
      if(uv){g.uv=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,g.uv);gl.bufferData(gl.ARRAY_BUFFER,uv,gl.STATIC_DRAW);}return g;
    }
    deleteGeometry(g) {if(!g||!this.gl)return;for(const key of ['positions','indices','uv'])if(g[key])this.gl.deleteBuffer(g[key]);}
    makeFrame() {
      const [x,y,z]=this.bounds,points=[[0,0,0],[x,0,0],[x,y,0],[0,y,0],[0,0,z],[x,0,z],[x,y,z],[0,y,z]],pairs=[[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];
      this.boxGeometry=this.geometry(new Float32Array(pairs.flatMap(p=>[...points[p[0]],...points[p[1]]])));
      this.axisLength=Math.min(1000,Math.max(...this.bounds)*.27);const a=this.axisLength;
      this.axisGeometry=this.geometry(new Float32Array([0,0,0,a,0,0,0,0,0,0,a,0,0,0,0,0,0,a]));
    }
    setSlice(canvas,z,black,white) {
      if(!this.volume)return;this.slice={z,black,white};
      const [x,y]=this.bounds,zn=(z+.5)*this.volume.resolution_nm[2];
      this.canvas.dataset.planeLocalNm=String(zn);
      $('surfaceReadout').textContent='Срез XY: локальная Z '+z+' · '+zn+' нм от начала фрагмента (центр вокселя).';
      if(this.gl){const gl=this.gl;gl.bindBuffer(gl.ARRAY_BUFFER,this.planeGeometry.positions);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([0,0,zn,x,0,zn,x,y,zn,0,y,zn]),gl.DYNAMIC_DRAW);gl.bindTexture(gl.TEXTURE_2D,this.texture);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,canvas);}
      this.sliceSegmentation=window.SliceSegmentation?.current||this.sliceSegmentation;
      if(this.contextVisible&&(!this.contextFocus||this.contextMode==='slice'))this.updateNearby();else this.updateSliceTextures();this.schedule();
    }
    validSliceSegmentation(){
      const data=this.sliceSegmentation,v=this.volume;
      return !!(data?.ready&&v&&this.slice&&data.volume_id===v.volume_id&&data.case_id===this.caseId&&data.local_z===this.slice.z&&equal3(data.shape_xyz,v.shape_xyz)&&equal3(data.resolution_nm,v.resolution_nm)&&equal3(data.begin_vox_xyz,v.begin_vox_xyz)&&data.canvas?.width===v.shape_xyz[0]&&data.canvas?.height===v.shape_xyz[1]);
    }
    setSliceSegmentation(data){
      // Reject stale asynchronous section results; never color a different EM plane.
      this.sliceSegmentation=data||null;this.contextSliceReady=false;this.segmentationReady=false;
      if(this.contextMode==='slice'&&this.contextVisible)this.updateNearby();else this.updateSliceTextures();this.schedule();
    }
    updateSliceTextures(){
      this.segmentationReady=false;this.contextSliceReady=false;
      this.canvas.dataset.segmentationLocalZ='';
      if(!this.gl||!this.validSliceSegmentation()||!window.SliceSegmentation?.render)return;
      const colors=Object.fromEntries(this.meshes.filter(m=>m.segment_id).map(m=>[m.segment_id,m.cssColor])),gl=this.gl;
      const upload=(texture,canvas)=>{if(!canvas)return false;gl.bindTexture(gl.TEXTURE_2D,texture);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,canvas);return true;};
      if(this.segmentationVisible)this.segmentationReady=upload(this.segmentationTexture,window.SliceSegmentation.render({segment_ids:null,fill:true,borders:false,opacity:1,colors}));
      if(this.contextVisible&&this.contextMode==='slice'){
        const ids=this.meshes.filter(m=>m.context&&m.visible&&this.contextShown.has(m.id)).map(m=>m.segment_id);
        if(ids.length)this.contextSliceReady=upload(this.contextSliceTexture,window.SliceSegmentation.render({segment_ids:ids,fill:true,borders:false,opacity:1,colors}));
      }
      this.canvas.dataset.segmentationLocalZ=this.segmentationReady||this.contextSliceReady?String(this.slice.z):'';
    }
    setSegmentationVisible(visible){this.segmentationVisible=!!visible;if($('surfaceSegmentation'))$('surfaceSegmentation').checked=this.segmentationVisible;this.updateSliceTextures();this.schedule();}
    scaleBar(camera=this.camera()){
      // Orthographic projection: one screen-plane nanometer has the same scale at every depth.
      const pixelsPerNm=Math.max(1,this.stage.clientHeight)/camera.height,target=Math.min(100,Math.max(50,this.stage.clientWidth*.2)),ideal=target/pixelsPerNm,power=10**Math.floor(Math.log10(ideal));
      const options=[.5,1,2,5,10].map(n=>n*power),nm=options.reduce((best,n)=>Math.abs(n*pixelsPerNm-target)<Math.abs(best*pixelsPerNm-target)?n:best);
      return {projection:'orthographic',reference:'screen_plane',reference_center_local_nm:[...this.center],nm,pixels:nm*pixelsPerNm,pixels_per_nm:pixelsPerNm,label:nm>=1000?(nm/1000).toLocaleString('ru-RU',{maximumFractionDigits:3})+' мкм':nm.toLocaleString('ru-RU',{maximumFractionDigits:3})+' нм'};
    }
    setTarget(target,show) {
      const previous=this.target;
      this.showMarker=show;this.target=target&&this.volume?{...target,position:target.local.map((n,i)=>(n+.5)*this.volume.resolution_nm[i])}:null;
      if(previous&&!this.target&&this.contextFocusLabel===previous.id+' '+(MarkerStyles.styles[previous.key]?.label||''))this.clearContextFocus();
      if(this.target&&(!previous||previous.id!==target.id||previous.key!==target.key))this.setContextFocus(this.target.position,target.id+' '+(MarkerStyles.styles[target.key]?.label||''));
      this.canvas.dataset.targetLocalNm=this.target?this.target.position.join(','):'';this.schedule();
    }
    setTargets(items,visible=true) {
      this.targetsVisible=!!visible;this.targets=Array.isArray(items)&&this.volume?items.filter(item=>finite3(item.local)).map(item=>({...item,position:item.local.map((n,i)=>(n+.5)*this.volume.resolution_nm[i])})).filter(item=>item.position.every((n,i)=>n>=0&&n<=this.bounds[i])):[];this.schedule();
    }
    reset(front=false) {
      if(!this.bounds)return;this.center=this.bounds.map(n=>n/2);this.yaw=front?0:-.65;this.pitch=front?0:.4;this.zoom=1;this.cameraBasis=null;
      this.frameHeight=Math.hypot(...this.bounds)*1.12;this.radius=Math.hypot(...this.bounds)*3;this.navigationChanged('reset');this.schedule();
    }
    camera() {
      const cp=Math.cos(this.pitch),direction=this.cameraBasis?.eye_direction||[Math.sin(this.yaw)*cp,-Math.sin(this.pitch),-Math.cos(this.yaw)*cp],eye=vec.add(this.center,vec.mul(direction,this.radius)),height=this.frameHeight*this.zoom,width=height*this.stage.clientWidth/Math.max(1,this.stage.clientHeight);
      let view;if(this.cameraBasis){const {right:x,up:y,eye_direction:z}=this.cameraBasis;view={right:x,up:y,matrix:new Float32Array([x[0],y[0],z[0],0,x[1],y[1],z[1],0,x[2],y[2],z[2],0,-vec.dot(x,eye),-vec.dot(y,eye),-vec.dot(z,eye),1])};}else view=lookAt(eye,this.center);
      return {...view,eye,height,mvp:multiply(ortho(-width/2,width/2,-height/2,height/2,.01,this.radius*20),view.matrix)};
    }
    getNavigationState(){
      if(!this.volume||!this.center)return null;const camera=this.camera();
      return {yaw:this.yaw,pitch:this.pitch,zoom:this.zoom,center_nm:[...this.center],frame_height_nm:this.frameHeight,radius_nm:this.radius,right:[...camera.right],up:[...camera.up],eye_direction:vec.norm(vec.sub(camera.eye,this.center)),direction:vec.norm(vec.sub(this.center,camera.eye)),physical_height_nm:camera.height,projection:'orthographic'};
    }
    navigationChanged(reason,emit=true){
      const state=this.getNavigationState();if(!state)return;
      const signature=JSON.stringify([state.yaw,state.pitch,state.zoom,state.center_nm,state.frame_height_nm,state.radius_nm,state.right,state.up,state.eye_direction]);if(signature===this.navigationSignature)return;this.navigationSignature=signature;
      if(emit)window.dispatchEvent(new CustomEvent('surface:view',{detail:{case_id:this.caseId,volume_id:this.volume.volume_id,reason,navigation:state}}));
    }
    applyNavigationState(camera,{emit=false}={}){
      if(!this.volume||!camera||typeof camera!=='object')throw new Error('Нет объёма для синхронизации 3D-вида.');
      const current=this.getNavigationState(),next={...current,...camera};
      const basis=camera.right||camera.up||camera.eye_direction||camera.eyeDirection||camera.direction?cameraBasis(camera):null;
      if(camera.physical_height_nm!==undefined){if(!Number.isFinite(camera.physical_height_nm)||camera.physical_height_nm<=0)throw new Error('Неверный физический масштаб 3D-вида.');next.zoom=camera.physical_height_nm/next.frame_height_nm;if(next.zoom<.08||next.zoom>12){next.frame_height_nm=camera.physical_height_nm;next.zoom=1;}}
      if(!finite3(next.center_nm)||!['yaw','pitch','zoom','frame_height_nm','radius_nm'].every(k=>Number.isFinite(next[k]))||Math.abs(next.pitch)>1.48||next.zoom<.08||next.zoom>12||next.frame_height_nm<=0||next.radius_nm<=0)throw new Error('Неверные координаты синхронизированного 3D-вида.');
      this.yaw=next.yaw;this.pitch=next.pitch;this.zoom=next.zoom;this.center=[...next.center_nm];this.frameHeight=next.frame_height_nm;this.radius=next.radius_nm;if(basis)this.cameraBasis=basis;else if(camera.yaw!==undefined||camera.pitch!==undefined)this.cameraBasis=null;this.navigationChanged('remote',emit);this.schedule();return this.getNavigationState();
    }
    bind() {
      $('surfaceReset').addEventListener('click',()=>this.reset());$('surfaceXY').addEventListener('click',()=>this.reset(true));
      for(const id of ['surfacePlane','surfaceBox'])$(id).addEventListener('change',()=>this.schedule());
      $('surfaceOpacity').addEventListener('input',e=>{this.alpha=Number(e.target.value)/100;$('surfaceOpacityReadout').textContent=e.target.value+'%';this.schedule();});
      $('surfaceContextMode')?.addEventListener('change',e=>this.setContextMode(e.target.value));
      $('surfaceSegmentation')?.addEventListener('change',e=>this.setSegmentationVisible(e.target.checked));
      for(const [id,key]of [['surfaceContextOpacity','contextAlpha'],['surfaceSegmentationOpacity','segmentationAlpha']])for(const event of ['input','change'])$(id)?.addEventListener(event,e=>{this[key]=Math.max(0,Math.min(1,Number(e.target.value)/100));if($(id+'Readout'))$(id+'Readout').textContent=Math.round(this[key]*100)+'%';this.schedule();});
      window.addEventListener('annotations:surface-ready',()=>{this.contextMode=$('surfaceContextMode')?.value==='full'?'full':'slice';this.contextAlpha=Number($('surfaceContextOpacity')?.value??25)/100;this.segmentationAlpha=Number($('surfaceSegmentationOpacity')?.value??25)/100;this.setSegmentationVisible(!!$('surfaceSegmentation')?.checked);});
      window.addEventListener('segmentation:slice',e=>this.setSliceSegmentation(e.detail));
      $('surfaceExport').addEventListener('click',()=>this.exportPNG());
      let drag=null;
      this.stage.addEventListener('contextmenu',e=>e.preventDefault());
      this.stage.addEventListener('pointerdown',e=>{if(!this.volume||!this.gl||drag)return;e.preventDefault();this.stage.focus({preventScroll:true});drag={x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY,pointerId:e.pointerId,moved:false,button:e.button,pan:e.button===2||e.button===1||e.shiftKey};this.stage.setPointerCapture(e.pointerId);});
      this.stage.addEventListener('pointermove',e=>{if(!drag||drag.pointerId!==e.pointerId)return;if(!drag.moved&&Math.hypot(e.clientX-drag.startX,e.clientY-drag.startY)<5)return;drag.moved=true;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;drag.x=e.clientX;drag.y=e.clientY;
        if(drag.pan){const camera=this.camera(),scale=camera.height/Math.max(1,this.stage.clientHeight);this.center=vec.add(this.center,vec.add(vec.mul(camera.right,-dx*scale),vec.mul(camera.up,dy*scale)));}
        else if(this.cameraBasis){let basis=this.cameraBasis;for(const [axis,angle]of [[basis.up,-dx*.007]])basis={right:rotateVector(basis.right,axis,angle),up:basis.up,eye_direction:rotateVector(basis.eye_direction,axis,angle)};const axis=basis.right,angle=-dy*.007;this.cameraBasis=cameraBasis({right:basis.right,up:rotateVector(basis.up,axis,angle),eye_direction:rotateVector(basis.eye_direction,axis,angle)});}
        else{this.yaw-=dx*.007;this.pitch=Math.max(-1.48,Math.min(1.48,this.pitch+dy*.007));}this.navigationChanged(drag.pan?'pan':'rotate');this.schedule();});
      this.stage.addEventListener('pointerup',e=>{if(!drag||drag.pointerId!==e.pointerId)return;const click=!drag.moved&&!drag.pan&&drag.button===0;drag=null;if(this.stage.hasPointerCapture(e.pointerId))this.stage.releasePointerCapture(e.pointerId);if(click)this.annotationClick(e);});
      for(const event of ['pointercancel','lostpointercapture'])this.stage.addEventListener(event,()=>{drag=null;});
      this.stage.addEventListener('wheel',e=>{if(!this.volume||!this.gl)return;e.preventDefault();this.zoom=Math.max(.08,Math.min(12,this.zoom*Math.exp(Math.max(-150,Math.min(150,e.deltaY))*.002)));this.navigationChanged('zoom');this.schedule();},{passive:false});
      this.stage.addEventListener('keydown',e=>{if(!this.volume||!this.gl)return;if(e.key==='r'||e.key==='R'){e.preventDefault();e.stopPropagation();this.reset();}if(e.key==='+'||e.key==='='||e.key==='-'){e.preventDefault();e.stopPropagation();this.zoom=Math.max(.08,Math.min(12,this.zoom*(e.key==='-'?1.15:1/1.15)));this.navigationChanged('zoom');this.schedule();}});
    }
    resize() {
      const ratio=Math.min(2,window.devicePixelRatio||1),w=Math.max(1,this.stage.clientWidth),h=Math.max(1,this.stage.clientHeight);
      for(const canvas of [this.canvas,this.labels]){canvas.width=Math.round(w*ratio);canvas.height=Math.round(h*ratio);canvas.style.width=w+'px';canvas.style.height=h+'px';}this.ratio=ratio;this.schedule();
    }
    schedule() {if(this.pending)return;this.pending=true;requestAnimationFrame(()=>{this.pending=false;this.draw();});}
    drawGeometry(g,c,mode=0,primitive=null) {
      if(!g)return;const gl=this.gl;gl.bindBuffer(gl.ARRAY_BUFFER,g.positions);gl.enableVertexAttribArray(this.position);gl.vertexAttribPointer(this.position,3,gl.FLOAT,false,0,0);
      if(g.uv){gl.bindBuffer(gl.ARRAY_BUFFER,g.uv);gl.enableVertexAttribArray(this.uv);gl.vertexAttribPointer(this.uv,2,gl.FLOAT,false,0,0);}else{gl.disableVertexAttribArray(this.uv);gl.vertexAttrib2f(this.uv,0,0);}
      gl.uniform4fv(this.uniforms.uColor,c);gl.uniform1i(this.uniforms.uMode,mode);
      if(g.indices){gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,g.indices);gl.drawElements(primitive||gl.TRIANGLES,g.count,gl.UNSIGNED_INT,0);}else gl.drawArrays(primitive||gl.LINES,0,g.count);
    }
    draw() {
      const ctx=this.labels.getContext('2d');ctx.clearRect(0,0,this.labels.width,this.labels.height);
      if(!this.gl)return;const gl=this.gl;gl.viewport(0,0,this.canvas.width,this.canvas.height);gl.depthMask(true);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
      if(!this.volume)return;const camera=this.camera();this.frame=camera;gl.useProgram(this.program);gl.uniformMatrix4fv(this.uniforms.uMVP,false,camera.mvp);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.texture);gl.uniform1i(this.uniforms.uTexture,0);gl.enable(gl.DEPTH_TEST);gl.disable(gl.BLEND);
      if(this.slice&&$('surfacePlane').checked)this.drawGeometry(this.planeGeometry,[1,1,1,1],2);
      gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.depthMask(false);
      for(const [ready,texture,alpha]of [[this.segmentationVisible&&this.segmentationReady,this.segmentationTexture,this.segmentationAlpha],[this.contextVisible&&this.contextMode==='slice'&&this.contextSliceReady,this.contextSliceTexture,this.contextAlpha]])if(ready&&alpha>0){gl.bindTexture(gl.TEXTURE_2D,texture);this.drawGeometry(this.planeGeometry,[1,1,1,alpha],2);}
      // Opaque meshes first, then independently translucent target and neighboring meshes.
      const visible=this.meshes.filter(m=>this.visibleMesh(m));
      for(const opaque of [true,false])for(const mesh of visible){const alpha=mesh.context?this.contextAlpha:this.alpha;if(alpha<=0||(alpha===1)!==opaque)continue;gl.depthMask(opaque);this.drawGeometry(mesh.geometry,[...(mesh.id===this.selectedObjectId?[1,.5,.24]:mesh.color),alpha]);}
      gl.depthMask(true);gl.disable(gl.BLEND);gl.disable(gl.DEPTH_TEST);
      if($('surfaceBox').checked){this.drawGeometry(this.boxGeometry,[.39,.56,.62,1],1,gl.LINES);this.drawGeometry(this.axisGeometry,[.86,.91,.94,1],1,gl.LINES);}
      const targets=this.targetsVisible?[...this.targets]:[];if(this.target&&this.showMarker)targets.push(this.target);
      // T markers use the same distinct canvas symbols as the 2D view.
      this.drawLabels(ctx,camera);
      this.canvas.dataset.camera=[this.yaw,this.pitch,this.zoom,...this.center].map(n=>n.toFixed(5)).join(',');
    }
    project(position,camera=this.frame) {
      const m=camera.mvp,x=position[0],y=position[1],z=position[2],w=m[3]*x+m[7]*y+m[11]*z+m[15];
      return [(m[0]*x+m[4]*y+m[8]*z+m[12])/w*.5+.5,1-((m[1]*x+m[5]*y+m[9]*z+m[13])/w*.5+.5)].map((n,i)=>n*(i?this.stage.clientHeight:this.stage.clientWidth));
    }
    drawLabels(ctx,camera) {
      ctx.save();ctx.scale(this.ratio,this.ratio);ctx.font='12px system-ui';ctx.lineJoin='round';ctx.lineWidth=4;ctx.strokeStyle='#13212c';ctx.fillStyle='#e4edf0';
      const text=(s,x,y)=>{ctx.strokeText(s,x,y);ctx.fillText(s,x,y);};
      if($('surfaceBox').checked)for(const [label,p] of [['X',[this.axisLength,0,0]],['Y',[0,this.axisLength,0]],['Z',[0,0,this.axisLength]]]){const [x,y]=this.project(p,camera);text(label,x+5,y-5);}
      const targets=this.targetsVisible?[...this.targets]:[];if(this.target&&this.showMarker)targets.push(this.target);
      this.targetHits=[];for(const target of targets){const [x,y]=this.project(target.position,camera);if(x<0||y<0||x>this.stage.clientWidth||y>this.stage.clientHeight)continue;MarkerStyles.draw(ctx,x,y,6,target.key);if(finite3(target.nm))this.targetHits.push({id:target.id,key:target.key,nm:[...target.nm],x,y});ctx.fillStyle=MarkerStyles.styles[target.key]?.color||'#edc229';ctx.strokeStyle='#13212c';ctx.lineWidth=4;ctx.font='12px system-ui';text(target.label||target.id,x+11,y-10);}
      this.annotationHits=[];
      if(this.annotationsVisible)for(const annotation of this.annotations){
        const position=this.annotationPosition(annotation);if(!position)continue;const [x,y]=this.project(position,camera);if(x<0||y<0||x>this.stage.clientWidth||y>this.stage.clientHeight)continue;
        const selected=annotation.id===this.selectedAnnotationId;MarkerStyles.draw(ctx,x,y,10,annotation.kind,annotation.number??'?',selected);this.annotationHits.push({id:annotation.id,x,y});
      }
      const scale=this.scaleBar(camera),bar=scale.pixels,y=this.stage.clientHeight-34,x=19;
      ctx.font='11px system-ui';const caption=scale.label+' · плоскость экрана',boxWidth=Math.max(bar,ctx.measureText(caption).width)+20;
      ctx.fillStyle='rgba(10,22,31,.87)';ctx.fillRect(9,y-14,boxWidth,42);ctx.strokeStyle='#eef6fa';ctx.lineWidth=2;
      ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+bar,y);ctx.moveTo(x,y-4);ctx.lineTo(x,y+4);ctx.moveTo(x+bar,y-4);ctx.lineTo(x+bar,y+4);ctx.stroke();ctx.fillStyle='#eef6fa';ctx.fillText(caption,x,y+20);ctx.restore();
      this.canvas.dataset.scaleNm=String(scale.nm);this.canvas.dataset.scalePixels=String(scale.pixels);
    }
    getViewState() {
      if(!this.volume||!this.gl||!this.modelReady)throw new Error('Дождитесь загрузки 3D-поверхностей.');
      if(this.contextLoading)throw new Error('Дождитесь загрузки окружающих сегментов или скройте их перед сохранением.');
      if((this.segmentationVisible||this.contextVisible&&this.contextMode==='slice')&&!this.validSliceSegmentation())throw new Error('Дождитесь сегментации текущего среза или скройте её перед сохранением.');
      return {schema_version:1,source_view:'3d',source:'seg_m1300',case_id:this.caseId,volume_id:this.volume.volume_id,local_z:this.slice?.z??null,
        camera:{yaw:this.yaw,pitch:this.pitch,zoom:this.zoom,center_nm:[...this.center],frame_height_nm:this.frameHeight,radius_nm:this.radius,...(this.cameraBasis?{basis:structuredClone(this.cameraBasis)}:{})},opacity:this.alpha,
        plane_visible:$('surfacePlane').checked,box_visible:$('surfaceBox').checked,context_visible:this.contextVisible,
        context_mode:this.contextMode,context_opacity:this.contextAlpha,segmentation_visible:this.segmentationVisible,segmentation_opacity:this.segmentationAlpha,scale_bar:this.scaleBar(),
        context_limit:this.contextLimit,context_focus:this.contextFocus?[...this.contextFocus]:null,context_focus_label:this.contextFocusLabel,context_shown:[...this.contextShown],
        objects:this.meshes.map(m=>({object_id:m.id,segment_id:m.segment_id||null,visible:!!m.visible})),annotations_visible:this.annotationsVisible,selected_annotation_id:this.selectedAnnotationId,
        seed_points_visible:this.targetsVisible,seed_filters:{center:!!$('tCenter')?.checked,pre:!!$('tPre')?.checked,post:!!$('tPost')?.checked},
        viewport_css_px:[this.stage.clientWidth,this.stage.clientHeight],annotation_ids:this.annotationsVisible?this.annotations.filter(a=>this.annotationPosition(a)).map(a=>a.id):[],
        display_window:this.slice?[this.slice.black,this.slice.white]:null};
    }
    async restoreEvidence(view) {
      const cam=view?.camera;
      if(view?.schema_version!==1||view.source_view!=='3d'||view.source!=='seg_m1300'||!cam||!finite3(cam.center_nm)||!['yaw','pitch','zoom','frame_height_nm','radius_nm'].every(k=>Number.isFinite(cam[k]))||Math.abs(cam.pitch)>1.48||cam.zoom<.08||cam.zoom>12||cam.frame_height_nm<=0||cam.radius_nm<=0||!Number.isFinite(view.opacity)||view.opacity<0||view.opacity>1||!['plane_visible','box_visible','context_visible','annotations_visible','seed_points_visible'].every(k=>typeof view[k]==='boolean')||!Array.isArray(view.objects)||view.objects.length>10000||view.objects.some(o=>!o||typeof o.object_id!=='string'||typeof o.visible!=='boolean'||!(o.segment_id===null||typeof o.segment_id==='string')))throw new Error('Сохранённые настройки 3D-вида повреждены.');
      if(!this.volume||view.case_id!==this.caseId||view.volume_id!==this.volume.volume_id)throw new Error('Сначала откройте объём, указанный в сохранённом 3D-виде.');
      if(!this.gl)throw new Error('В этом браузере 3D-восстановление недоступно. Сохранённый PNG можно открыть отдельно.');
      if(view.context_mode!==undefined&&!['slice','full'].includes(view.context_mode)||['context_opacity','segmentation_opacity'].some(k=>view[k]!==undefined&&(!Number.isFinite(view[k])||view[k]<0||view[k]>1))||view.segmentation_visible!==undefined&&typeof view.segmentation_visible!=='boolean')throw new Error('Сохранённые настройки слоёв 3D-вида повреждены.');
      const token=this.token;
      const waitFor=predicate=>new Promise((resolve,reject)=>{
        let timer;const cleanup=()=>{clearTimeout(timer);window.removeEventListener('annotations:surface-ready',check);window.removeEventListener('annotations:surface-error',check);window.removeEventListener('annotations:contextstatus',check);window.removeEventListener('review:volume',check);};
        const check=event=>{if(token!==this.token){cleanup();reject(new Error('Объём изменился во время восстановления 3D-вида.'));}else if(event?.type==='annotations:surface-error'||event?.type==='annotations:contextstatus'&&event.detail.status==='error'){cleanup();reject(new Error(event.detail.message));}else if(predicate()){cleanup();resolve();}};
        timer=setTimeout(()=>{cleanup();reject(new Error('Время ожидания 3D-поверхностей истекло. Повторите восстановление.'));},60000);
        window.addEventListener('annotations:surface-ready',check);window.addEventListener('annotations:surface-error',check);window.addEventListener('annotations:contextstatus',check);window.addEventListener('review:volume',check);check();
      });
      if(!this.modelReady)await waitFor(()=>this.modelReady);
      this.contextMode=view.context_mode||'full';this.contextAlpha=view.context_opacity??view.opacity;this.segmentationAlpha=view.segmentation_opacity??.25;this.segmentationVisible=view.segmentation_visible??false;
      if($('surfaceContextMode'))$('surfaceContextMode').value=this.contextMode;if($('surfaceSegmentation'))$('surfaceSegmentation').checked=this.segmentationVisible;
      for(const [id,value]of [['surfaceContextOpacity',this.contextAlpha],['surfaceSegmentationOpacity',this.segmentationAlpha]]){if($(id))$(id).value=String(Math.round(value*100));if($(id+'Readout'))$(id+'Readout').textContent=Math.round(value*100)+'%';}
      await this.loadContextEntry(token);
      if(this.segmentationVisible||view.context_visible&&this.contextMode==='slice'){const data=await window.SliceSegmentation.ensure();if(token!==this.token)throw new Error('Объём изменился во время восстановления 3D-вида.');this.setSliceSegmentation(data);if(!this.validSliceSegmentation())throw new Error('Сегментация не соответствует сохранённому срезу.');}
      if(view.context_visible&&this.contextMode==='full'&&!this.contextLoaded){const ready=waitFor(()=>this.contextLoaded);this.setContextVisible(true);await ready;}else await this.setContextVisible(!!view.context_visible);
      if(token!==this.token)throw new Error('Объём изменился во время восстановления 3D-вида.');
      this.contextFocus=finite3(view.context_focus)?[...view.context_focus]:null;this.contextFocusLabel=typeof view.context_focus_label==='string'?view.context_focus_label:'центр среза';this.setContextLimit(view.context_limit);
      if(Array.isArray(view.context_shown)){this.contextShown=new Set(view.context_shown.filter(id=>this.meshes.some(m=>m.context&&m.id===id)));for(const m of this.meshes)if(m.context&&m.control)m.control.hidden=!this.contextVisible||!this.contextShown.has(m.id);}
      for(const mesh of this.meshes){const setting=view.objects.find(o=>o.segment_id&&mesh.segment_id?o.segment_id===mesh.segment_id:o.object_id===mesh.id);mesh.visible=setting?.visible??(mesh.context&&view.context_mode===undefined);if(mesh.control){const input=mesh.control.querySelector('input');if(input)input.checked=mesh.visible;}}
      this.yaw=cam.yaw;this.pitch=cam.pitch;this.zoom=cam.zoom;this.center=[...cam.center_nm];this.frameHeight=cam.frame_height_nm;this.radius=cam.radius_nm;this.cameraBasis=cameraBasis(cam.basis);this.alpha=view.opacity;
      $('surfaceOpacity').value=String(Math.round(view.opacity*100));$('surfaceOpacityReadout').textContent=Math.round(view.opacity*100)+'%';$('surfacePlane').checked=!!view.plane_visible;$('surfaceBox').checked=!!view.box_visible;
      this.annotationsVisible=!!view.annotations_visible;this.targetsVisible=!!view.seed_points_visible;this.selectedAnnotationId=view.selected_annotation_id||null;this.refreshSelectedObject();this.updateSliceTextures();this.draw();this.navigationChanged('restore');this.visibilityChanged();return this.getViewState();
    }
    snapshotEvidence() {
      const view=this.getViewState(),cssWidth=this.stage.clientWidth,cssHeight=this.stage.clientHeight;
      if(!cssWidth||!cssHeight)throw new Error('Откройте просмотр 2D / 3D перед сохранением изображения.');
      const gl=this.gl,limits=gl.getParameter(gl.MAX_VIEWPORT_DIMS),maximum=gl.getParameter(gl.MAX_RENDERBUFFER_SIZE);
      const ratio=Math.min(3072/Math.max(cssWidth,cssHeight),maximum/cssWidth,maximum/cssHeight,limits[0]/cssWidth,limits[1]/cssHeight);
      const width=Math.floor(cssWidth*ratio),height=Math.floor(cssHeight*ratio),canvas=document.createElement('canvas');
      const old={width:this.canvas.width,height:this.canvas.height,labelWidth:this.labels.width,labelHeight:this.labels.height,ratio:this.ratio};
      canvas.width=width;canvas.height=height+250;const ctx=canvas.getContext('2d');
      try{
        // Re-render geometry and vector labels at export resolution; never stretch a screen capture.
        this.canvas.width=this.labels.width=width;this.canvas.height=this.labels.height=height;this.ratio=ratio;
        if(gl.isContextLost()||gl.drawingBufferWidth!==width||gl.drawingBufferHeight!==height)throw new Error('Не удалось создать изображение высокого разрешения.');
        this.draw();ctx.drawImage(this.canvas,0,0);ctx.drawImage(this.labels,0,0);
      }finally{
        this.canvas.width=old.width;this.canvas.height=old.height;this.labels.width=old.labelWidth;this.labels.height=old.labelHeight;this.ratio=old.ratio;this.draw();
      }
      ctx.fillStyle='#fff';ctx.fillRect(0,height,width,250);ctx.fillStyle='#17313d';ctx.font='bold 34px system-ui';ctx.fillText(this.caseId+' · '+this.volume.volume_id+' · 3D',28,height+48);
      ctx.font='26px system-ui';ctx.fillText('Локальный Z '+(this.slice?.z??'—')+' · сегментация v1300 · цвета — метки объектов',28,height+91);
      const seedIds=this.meshes.filter(m=>!m.context&&this.visibleMesh(m)).map(m=>m.id).join(', ')||'нет',contextCount=this.contextVisible?this.meshes.filter(m=>m.context&&m.visible&&this.contextShown.has(m.id)).length:0;
      ctx.fillText('Объекты: '+seedIds+' · соседних структур: '+contextCount+(this.contextVisible?(this.contextMode==='slice'?' (срез)':' (объём)'):'')+' · меток: '+(this.annotationsVisible?this.annotationHits.length:0),28,height+134);
      ctx.font='24px system-ui';ctx.fillText('3D для навигации. Анатомию проверяйте по серийной ЭМ.',28,height+177);ctx.fillText('MICrONS Consortium (2025) · doi:10.1038/s41586-025-08790-w · CC BY 4.0',28,height+216);
      return {view,blob:new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('Не удалось создать PNG 3D-вида.')),'image/png'))};
    }
    async exportPNG() {
      try {const capture=this.snapshotEvidence(),blob=await capture.blob,filename=(capture.view.volume_id+'_3d_local-z'+(capture.view.local_z??'none')+'_seg1300_navigation.png').replace(/[^a-zA-Z0-9_.-]/g,'_'),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);}
      catch(error){this.setStatus(error.message,'error');}
    }
  }
  window.LocalSurfaceView=LocalSurfaceView;
})();
