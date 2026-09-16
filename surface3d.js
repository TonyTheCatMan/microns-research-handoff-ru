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
      this.modelReady=false;
      this.controls=['surfaceReset','surfaceXY','surfacePlane','surfaceBox','surfaceOpacity','surfaceExport'];
      this.yaw=-.65;this.pitch=.4;this.zoom=1;this.alpha=.8;
      this.canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();this.gl=null;this.setStatus('Контекст 3D-графики потерян. Перезагрузите страницу, чтобы восстановить 3D. Просмотр TIFF в 2D остаётся доступен.','error');this.enable(false);});
      try {this.initGL();} catch(error) {this.gl=null;this.setStatus('3D недоступно в этом браузере: '+error.message+'. Просмотр TIFF в 2D остаётся доступен.','error');}
      this.bind();this.enable(false);this.resize();
      if(this.gl)this.setStatus('Поверхности загружаются с выбранным объёмом.');
      this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(this.stage);
    }
    setStatus(text,kind='') {this.note.textContent=text;this.note.className='surface-status '+kind;$('surfaceRetry').hidden=!(kind==='error'&&this.volume&&this.gl);}
    enable(yes) {for(const id of this.controls)$(id).disabled=!yes;}
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
      this.cancelContext();this.contextLoaded=false;this.contextEntry=null;this.selectedObjectId=null;this.annotationHits=[];this.targets=[];this.modelReady=false;
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
      const input=document.createElement('input');input.type='checkbox';input.checked=mesh.visible&&!!mesh.geometry;input.disabled=!mesh.geometry;input.dataset.objectId=mesh.id;
      input.addEventListener('change',()=>{mesh.visible=input.checked;this.schedule();});
      const swatch=document.createElement('span');swatch.className='object-swatch';swatch.style.backgroundColor=/^#[0-9a-f]{6}$/i.test(mesh.cssColor)?mesh.cssColor:'#80b8c4';
      const text=document.createElement('span');text.textContent=mesh.id+' · '+mesh.label+(mesh.geometry?(mesh.clipped.length?' · ограничен границами фрагмента':''):' · отсутствует в этом объёме');
      label.append(input,swatch,text);label.title=mesh.clipped.length?'Касается граней фрагмента: '+mesh.clipped.join(', '):'Нейтральное обозначение объекта; цвет не указывает на класс клетки.';label.dataset.objectId=mesh.id;
      if(mesh.context){label.dataset.context='true';label.hidden=!this.contextVisible;label.title+=' Сегмент окружения; класс клетки не установлен.';}
      mesh.control=label;this.objectsUI.append(label);
    }
    contextStatus(status,message,count=0) {
      window.dispatchEvent(new CustomEvent('annotations:contextstatus',{detail:{case_id:this.caseId,volume_id:this.volume?.volume_id,status,message,count}}));
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
      this.contextEntry=entry;for(const seed of entry.seed_objects){const mesh=this.meshes.find(m=>!m.context&&m.id===seed.id);if(mesh&&typeof seed.segment_id==='string')mesh.segment_id=seed.segment_id;}this.refreshSelectedObject();return entry;
    }
    async setContextVisible(visible) {
      this.contextVisible=!!visible;const volumeToken=this.token;
      if(!visible){
        if(this.contextLoading){this.cancelContext();for(const mesh of this.meshes.filter(m=>m.context)){this.deleteGeometry(mesh.geometry);mesh.control?.remove();}this.meshes=this.meshes.filter(m=>!m.context);}
        for(const mesh of this.meshes)if(mesh.context&&mesh.control)mesh.control.hidden=true;
        this.contextStatus('hidden','Окружающие сегменты скрыты.');this.schedule();return;
      }
      for(const mesh of this.meshes)if(mesh.context&&mesh.control)mesh.control.hidden=false;
      this.schedule();if(!this.gl||!this.volume)return;
      if(this.contextLoaded){this.contextStatus('ready','Окружающие сегменты показаны. Их класс не установлен; проверяйте мембраны по ЭМ.',this.meshes.filter(m=>m.context).length);return;}
      if(this.contextLoading)return;this.contextLoading=true;const workerToken=++this.contextToken;this.contextStatus('loading','Загрузка окружающих сегментов…');
      try {
        const entry=await this.loadContextEntry(volumeToken);
        if(volumeToken!==this.token||workerToken!==this.contextToken||!this.contextVisible||!entry)return;
        const worker=new Worker('context-worker.js');this.contextWorker=worker;
        const fail=message=>{
          if(volumeToken!==this.token||workerToken!==this.contextToken)return;
          this.cancelContext();this.contextLoaded=false;for(const mesh of this.meshes.filter(m=>m.context)){this.deleteGeometry(mesh.geometry);mesh.control?.remove();}this.meshes=this.meshes.filter(m=>!m.context);this.contextStatus('error',message);this.schedule();
        };
        worker.onerror=event=>fail('Не удалось построить окружающие поверхности: '+event.message);
        worker.onmessage=event=>{
          if(volumeToken!==this.token||workerToken!==this.contextToken||event.data.token!==workerToken)return;
          const data=event.data;
          if(data.type==='progress'){this.contextStatus('loading',data.message);return;}
          if(data.type==='error'){fail(data.message);return;}
          if(data.type==='done'){
            this.contextLoading=false;this.contextLoaded=true;worker.terminate();this.contextWorker=null;
            const count=this.meshes.filter(m=>m.context).length;this.canvas.dataset.contextCount=String(count);this.contextStatus('ready',count+' сегментов окружения · класс клетки не установлен. Проверяйте мембраны по ЭМ.',count);this.schedule();return;
          }
          if(data.type!=='mesh')return;
          try {
            const object=data.object,vertices=object.vertices,faces=object.faces,expected=entry.objects.find(o=>o.id===object.id);
            if(!expected||expected.segment_id!==object.segment_id||this.meshes.some(m=>m.id===object.id)||!(vertices instanceof Float32Array)||!(faces instanceof Uint32Array)||vertices.length%3||faces.length%3)throw new Error('Неверная сетка сегмента окружения.');
            const bounds=vertexBounds(vertices);if(!bounds.every(a=>a.every(Number.isFinite))||bounds[0].some(n=>n<-.1)||bounds[1].some((n,i)=>n>this.bounds[i]+.1))throw new Error('Сегмент окружения находится вне границ изображения.');
            for(let i=0;i<faces.length;i++)if(faces[i]>=vertices.length/3)throw new Error('Неверные треугольники сегмента окружения.');
            const cssColor=PALETTE[this.meshes.filter(m=>m.context).length%PALETTE.length],mesh={id:object.id,segment_id:object.segment_id,label:'Сегмент окружения',color:color(cssColor),cssColor,visible:true,context:true,clipped:object.clipped_faces||[],vertices,triangles:faces,bounds,geometry:this.geometry(vertices,faces),faces:faces.length/3};
            this.meshes.push(mesh);this.objectControl(mesh);this.refreshSelectedObject();this.schedule();
          }catch(error){fail(error.message);}
        };
        worker.postMessage({type:'load',token:workerToken,volume:entry,url:new URL(entry.data_path,location.href).href});
      }catch(error){if(volumeToken===this.token&&workerToken===this.contextToken){this.contextLoading=false;this.contextStatus('error',error.message);}}
    }
    setAnnotationMode(mode) {
      this.annotationMode=['point','object'].includes(mode)?mode:'off';this.stage.style.cursor=this.annotationMode==='off'?'grab':'crosshair';this.stage.dataset.annotationMode=this.annotationMode;
    }
    setAnnotations(items,visible=true,selectedId=null) {
      this.annotations=Array.isArray(items)?items.filter(a=>finite3(a.point_nm)):[];this.annotationsVisible=!!visible;this.selectedAnnotationId=selectedId;
      this.refreshSelectedObject();this.schedule();
    }
    setSelectedAnnotation(id) {
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
    visibleMesh(mesh) {return mesh.visible&&mesh.geometry&&(!mesh.context||this.contextVisible);}
    pickAt(clientX,clientY) {
      if(!this.volume||!this.gl)return null;const rect=this.stage.getBoundingClientRect(),x=(clientX-rect.left)/rect.width,y=(clientY-rect.top)/rect.height;
      if(x<0||x>1||y<0||y>1)return null;
      const camera=this.camera(),width=camera.height*this.stage.clientWidth/Math.max(1,this.stage.clientHeight),direction=vec.norm(vec.sub(this.center,camera.eye)),origin=vec.add(camera.eye,vec.add(vec.mul(camera.right,(x-.5)*width),vec.mul(camera.up,(.5-y)*camera.height)));
      let closest=null,distance=Infinity;
      for(const mesh of this.meshes){
        if(!this.visibleMesh(mesh)||!mesh.vertices||!rayBox(origin,direction,mesh.bounds,distance))continue;
        const triangles=mesh.triangles;
        for(let i=0;i<triangles.length;i+=3){const t=rayTriangle(origin,direction,mesh.vertices,triangles[i]*3,triangles[i+1]*3,triangles[i+2]*3);if(t!==null&&t<distance){distance=t;closest=mesh;}}
      }
      if(!closest)return null;
      // The opaque image plane can hide a mesh even if the mesh itself is translucent.
      if(this.slice&&$('surfacePlane').checked&&Math.abs(direction[2])>1e-12){
        const planeZ=(this.slice.z+.5)*this.volume.resolution_nm[2],t=(planeZ-origin[2])/direction[2],p=vec.add(origin,vec.mul(direction,t));
        if(t>.01&&t<distance-.001&&p[0]>=0&&p[0]<=this.bounds[0]&&p[1]>=0&&p[1]<=this.bounds[1])return null;
      }
      const pointLocal=vec.add(origin,vec.mul(direction,distance)),sourceOrigin=this.volume.begin_vox_xyz.map((n,i)=>n*this.volume.resolution_nm[i]);
      return {case_id:this.caseId,volume_id:this.volume.volume_id,point_nm:vec.add(pointLocal,sourceOrigin),point_local_nm:pointLocal,object_id:closest.id,segment_id:closest.segment_id||null,mode:this.annotationMode,source:'seg_m1300'};
    }
    annotationClick(event) {
      const rect=this.stage.getBoundingClientRect(),x=(event.clientX-rect.left)*this.stage.clientWidth/rect.width,y=(event.clientY-rect.top)*this.stage.clientHeight/rect.height;
      if(this.annotationsVisible){const hit=this.annotationHits.find(p=>Math.hypot(p.x-x,p.y-y)<=13);if(hit){this.setSelectedAnnotation(hit.id);window.dispatchEvent(new CustomEvent('annotations:select3d',{detail:{id:hit.id,case_id:this.caseId,volume_id:this.volume.volume_id}}));return;}}
      if(this.annotationMode==='off')return;const hit=this.pickAt(event.clientX,event.clientY);
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
          if(uMode==2){frag=texture(uTexture,vUV);return;}
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
      this.schedule();
    }
    setTarget(target,show) {
      this.showMarker=show;this.target=target&&this.volume?{...target,position:target.local.map((n,i)=>(n+.5)*this.volume.resolution_nm[i])}:null;
      this.canvas.dataset.targetLocalNm=this.target?this.target.position.join(','):'';this.schedule();
    }
    setTargets(items,visible=true) {
      this.targetsVisible=!!visible;this.targets=Array.isArray(items)&&this.volume?items.filter(item=>finite3(item.local)).map(item=>({...item,position:item.local.map((n,i)=>(n+.5)*this.volume.resolution_nm[i])})).filter(item=>item.position.every((n,i)=>n>=0&&n<=this.bounds[i])):[];this.schedule();
    }
    reset(front=false) {
      if(!this.bounds)return;this.center=this.bounds.map(n=>n/2);this.yaw=front?0:-.65;this.pitch=front?0:.4;this.zoom=1;
      this.frameHeight=Math.hypot(...this.bounds)*1.12;this.radius=Math.hypot(...this.bounds)*3;this.schedule();
    }
    camera() {
      const cp=Math.cos(this.pitch),direction=[Math.sin(this.yaw)*cp,-Math.sin(this.pitch),-Math.cos(this.yaw)*cp],eye=vec.add(this.center,vec.mul(direction,this.radius)),view=lookAt(eye,this.center),height=this.frameHeight*this.zoom,width=height*this.stage.clientWidth/Math.max(1,this.stage.clientHeight);
      return {...view,eye,height,mvp:multiply(ortho(-width/2,width/2,-height/2,height/2,.01,this.radius*20),view.matrix)};
    }
    bind() {
      $('surfaceReset').addEventListener('click',()=>this.reset());$('surfaceXY').addEventListener('click',()=>this.reset(true));
      for(const id of ['surfacePlane','surfaceBox'])$(id).addEventListener('change',()=>this.schedule());
      $('surfaceOpacity').addEventListener('input',e=>{this.alpha=Number(e.target.value)/100;$('surfaceOpacityReadout').textContent=e.target.value+'%';this.schedule();});
      $('surfaceExport').addEventListener('click',()=>this.exportPNG());
      let drag=null;
      this.stage.addEventListener('contextmenu',e=>e.preventDefault());
      this.stage.addEventListener('pointerdown',e=>{if(!this.volume||!this.gl||drag)return;e.preventDefault();this.stage.focus({preventScroll:true});drag={x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY,pointerId:e.pointerId,moved:false,button:e.button,pan:e.button===2||e.button===1||e.shiftKey};this.stage.setPointerCapture(e.pointerId);});
      this.stage.addEventListener('pointermove',e=>{if(!drag||drag.pointerId!==e.pointerId)return;if(!drag.moved&&Math.hypot(e.clientX-drag.startX,e.clientY-drag.startY)<5)return;drag.moved=true;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;drag.x=e.clientX;drag.y=e.clientY;
        if(drag.pan){const camera=this.camera(),scale=camera.height/Math.max(1,this.stage.clientHeight);this.center=vec.add(this.center,vec.add(vec.mul(camera.right,-dx*scale),vec.mul(camera.up,dy*scale)));}
        else{this.yaw-=dx*.007;this.pitch=Math.max(-1.48,Math.min(1.48,this.pitch+dy*.007));}this.schedule();});
      this.stage.addEventListener('pointerup',e=>{if(!drag||drag.pointerId!==e.pointerId)return;const click=!drag.moved&&!drag.pan&&drag.button===0;drag=null;if(this.stage.hasPointerCapture(e.pointerId))this.stage.releasePointerCapture(e.pointerId);if(click)this.annotationClick(e);});
      for(const event of ['pointercancel','lostpointercapture'])this.stage.addEventListener(event,()=>{drag=null;});
      this.stage.addEventListener('wheel',e=>{if(!this.volume||!this.gl)return;e.preventDefault();this.zoom=Math.max(.08,Math.min(12,this.zoom*Math.exp(Math.max(-150,Math.min(150,e.deltaY))*.002)));this.schedule();},{passive:false});
      this.stage.addEventListener('keydown',e=>{if(!this.volume||!this.gl)return;if(e.key==='r'||e.key==='R'){e.preventDefault();e.stopPropagation();this.reset();}if(e.key==='+'||e.key==='='||e.key==='-'){e.preventDefault();e.stopPropagation();this.zoom=Math.max(.08,Math.min(12,this.zoom*(e.key==='-'?1.15:1/1.15)));this.schedule();}});
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
      if(this.alpha<1){gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.depthMask(false);}else gl.depthMask(true);
      for(const mesh of this.meshes)if(this.visibleMesh(mesh))this.drawGeometry(mesh.geometry,[...(mesh.id===this.selectedObjectId?[1,.5,.24]:mesh.color),this.alpha]);
      gl.depthMask(true);gl.disable(gl.BLEND);gl.disable(gl.DEPTH_TEST);
      if($('surfaceBox').checked){this.drawGeometry(this.boxGeometry,[.39,.56,.62,1],1,gl.LINES);this.drawGeometry(this.axisGeometry,[.86,.91,.94,1],1,gl.LINES);}
      const targets=this.targetsVisible?[...this.targets]:[];if(this.target&&this.showMarker)targets.push(this.target);
      if(targets.length){const r=camera.height/Math.max(1,this.stage.clientHeight)*8,lines=[];for(const target of targets)for(let axis=0;axis<3;axis++){const a=[...target.position],b=[...target.position];a[axis]-=r;b[axis]+=r;lines.push(...a,...b);}gl.bindBuffer(gl.ARRAY_BUFFER,this.markerGeometry.positions);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(lines),gl.DYNAMIC_DRAW);this.markerGeometry.count=lines.length/3;this.drawGeometry(this.markerGeometry,[1,.91,.39,1],1,gl.LINES);}
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
      for(const target of targets){const [x,y]=this.project(target.position,camera);if(x<0||y<0||x>this.stage.clientWidth||y>this.stage.clientHeight)continue;ctx.fillStyle='#ffed75';text(target.label||target.id,x+11,y-10);}
      this.annotationHits=[];
      if(this.annotationsVisible)for(const annotation of this.annotations){
        const position=this.annotationPosition(annotation);if(!position)continue;const [x,y]=this.project(position,camera);if(x<0||y<0||x>this.stage.clientWidth||y>this.stage.clientHeight)continue;
        const selected=annotation.id===this.selectedAnnotationId;ctx.beginPath();ctx.arc(x,y,selected?12:10,0,Math.PI*2);ctx.fillStyle=selected?'#ff784a':'#0b6478';ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=selected?3:2;ctx.stroke();ctx.fillStyle='#fff';ctx.font='bold 11px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(String(annotation.number??'?'),x,y);ctx.textAlign='start';ctx.textBaseline='alphabetic';this.annotationHits.push({id:annotation.id,x,y});
      }
      const pixelsPerNm=this.stage.clientHeight/camera.height,options=[20,50,100,200,500,1000,2000,5000],length=options.reduce((best,n)=>Math.abs(n*pixelsPerNm-90)<Math.abs(best*pixelsPerNm-90)?n:best,500),bar=length*pixelsPerNm,y=this.stage.clientHeight-27;
      ctx.strokeStyle='#dbe8ed';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(15,y);ctx.lineTo(15+bar,y);ctx.moveTo(15,y-4);ctx.lineTo(15,y+4);ctx.moveTo(15+bar,y-4);ctx.lineTo(15+bar,y+4);ctx.stroke();ctx.fillStyle='#dbe8ed';ctx.font='11px system-ui';ctx.fillText(length+' нм · плоскость вида',15,y+18);ctx.restore();
    }
    getViewState() {
      if(!this.volume||!this.gl||!this.modelReady)throw new Error('Дождитесь загрузки 3D-поверхностей.');
      if(this.contextLoading)throw new Error('Дождитесь загрузки окружающих сегментов или скройте их перед сохранением.');
      return {schema_version:1,source_view:'3d',source:'seg_m1300',case_id:this.caseId,volume_id:this.volume.volume_id,local_z:this.slice?.z??null,
        camera:{yaw:this.yaw,pitch:this.pitch,zoom:this.zoom,center_nm:[...this.center],frame_height_nm:this.frameHeight,radius_nm:this.radius},opacity:this.alpha,
        plane_visible:$('surfacePlane').checked,box_visible:$('surfaceBox').checked,context_visible:this.contextVisible,
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
      const token=this.token;
      const waitFor=predicate=>new Promise((resolve,reject)=>{
        let timer;const cleanup=()=>{clearTimeout(timer);window.removeEventListener('annotations:surface-ready',check);window.removeEventListener('annotations:surface-error',check);window.removeEventListener('annotations:contextstatus',check);window.removeEventListener('review:volume',check);};
        const check=event=>{if(token!==this.token){cleanup();reject(new Error('Объём изменился во время восстановления 3D-вида.'));}else if(event?.type==='annotations:surface-error'||event?.type==='annotations:contextstatus'&&event.detail.status==='error'){cleanup();reject(new Error(event.detail.message));}else if(predicate()){cleanup();resolve();}};
        timer=setTimeout(()=>{cleanup();reject(new Error('Время ожидания 3D-поверхностей истекло. Повторите восстановление.'));},60000);
        window.addEventListener('annotations:surface-ready',check);window.addEventListener('annotations:surface-error',check);window.addEventListener('annotations:contextstatus',check);window.addEventListener('review:volume',check);check();
      });
      if(!this.modelReady)await waitFor(()=>this.modelReady);
      if(view.context_visible&&!this.contextLoaded){const ready=waitFor(()=>this.contextLoaded);this.setContextVisible(true);await ready;}else await this.setContextVisible(!!view.context_visible);
      if(token!==this.token)throw new Error('Объём изменился во время восстановления 3D-вида.');
      for(const mesh of this.meshes){const setting=view.objects.find(o=>o.segment_id&&mesh.segment_id?o.segment_id===mesh.segment_id:o.object_id===mesh.id);mesh.visible=setting?.visible??false;if(mesh.control){const input=mesh.control.querySelector('input');if(input)input.checked=mesh.visible;}}
      this.yaw=cam.yaw;this.pitch=cam.pitch;this.zoom=cam.zoom;this.center=[...cam.center_nm];this.frameHeight=cam.frame_height_nm;this.radius=cam.radius_nm;this.alpha=view.opacity;
      $('surfaceOpacity').value=String(Math.round(view.opacity*100));$('surfaceOpacityReadout').textContent=Math.round(view.opacity*100)+'%';$('surfacePlane').checked=!!view.plane_visible;$('surfaceBox').checked=!!view.box_visible;
      this.annotationsVisible=!!view.annotations_visible;this.targetsVisible=!!view.seed_points_visible;this.selectedAnnotationId=view.selected_annotation_id||null;this.refreshSelectedObject();this.draw();return this.getViewState();
    }
    snapshotEvidence() {
      const view=this.getViewState();this.draw();
      // Copy WebGL and labels into a separate canvas before any asynchronous encoding.
      const canvas=document.createElement('canvas'),w=Math.max(1500,this.canvas.width),h=this.canvas.height+190;canvas.width=w;canvas.height=h;const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,w,h);ctx.fillStyle='#17313d';ctx.font='bold 20px system-ui';ctx.fillText(this.caseId+' · '+this.volume.volume_id+' · 3D-вид для навигации',18,30);
      ctx.font='14px system-ui';ctx.fillText('Статическая сегментация v1300 · анатомия не прошла независимую проверку · цвета — нейтральные метки объектов',18,56);
      const x=(w-this.canvas.width)/2;ctx.drawImage(this.canvas,x,76);ctx.drawImage(this.labels,x,76);let y=76+this.canvas.height+25;
      ctx.fillText(this.slice?'XY, локальная Z '+this.slice.z+' · срез через центр соответствующего вокселя · отображение '+this.slice.black+'–'+this.slice.white:'Срез TIFF не загружен',18,y);y+=22;
      const seedIds=this.meshes.filter(m=>!m.context&&this.visibleMesh(m)).map(m=>m.id).join(', ')||'нет',contextCount=this.meshes.filter(m=>m.context&&this.visibleMesh(m)).length;
      ctx.fillText('Объекты: '+seedIds+' · сегменты окружения: '+contextCount+' · непрозрачность '+Math.round(this.alpha*100)+'% · метки: '+(this.annotationsVisible?this.annotationHits.length:0)+' · точки T: '+(this.targetsVisible?this.targets.length:0),18,y);y+=22;
      ctx.fillText('MICrONS Consortium (2025) · doi:10.1038/s41586-025-08790-w · CC BY 4.0',18,y);
      return {view,blob:new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('Не удалось создать PNG 3D-вида.')),'image/png'))};
    }
    async exportPNG() {
      try {const capture=this.snapshotEvidence(),blob=await capture.blob,filename=(capture.view.volume_id+'_3d_local-z'+(capture.view.local_z??'none')+'_seg1300_navigation.png').replace(/[^a-zA-Z0-9_.-]/g,'_'),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);}
      catch(error){this.setStatus(error.message,'error');}
    }
  }
  window.LocalSurfaceView=LocalSurfaceView;
})();
