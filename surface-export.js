/* Export unchanged selected meshes as glTF 2.0, using meters for physical scale. */
(() => {
  'use strict';
  const fail=message=>{throw new Error(message);};
  const finite3=value=>Array.isArray(value)&&value.length===3&&value.every(Number.isFinite);
  const linear=value=>value<=.04045?value/12.92:((value+.055)/1.055)**2.4;
  function buildGLB(meshes,metadata={}) {
    if(!Array.isArray(meshes)||!meshes.length)fail('Нет видимых поверхностей для экспорта.');
    if(!finite3(metadata.origin_global_nm))fail('Не определены физические координаты объёма.');
    const json={asset:{version:'2.0',generator:'MICrONS researcher handoff',copyright:'MICrONS Consortium (2025), CC BY 4.0'},scene:0,scenes:[{name:String(metadata.volume_id||'MICrONS'),nodes:[]}],nodes:[],meshes:[],materials:[],buffers:[{byteLength:0}],bufferViews:[],accessors:[],extras:{...metadata,coordinate_system:'local_m',meters_per_source_unit:1e-9,source_coordinate_system:'local_nm',source_axes_preserved:true,mesh_only:true,geometry_modified:false,limitations:'Finite source crop. Open boundaries and disconnected components are preserved. No EM plane, drawings, contact markers or inferred continuity.'}};
    const chunks=[];let byteLength=0;
    function accessor(array,type,componentType,target,min,max){
      const bytes=new Uint8Array(array.buffer,array.byteOffset,array.byteLength),view=json.bufferViews.length;
      chunks.push(bytes);json.bufferViews.push({buffer:0,byteOffset:byteLength,byteLength:bytes.byteLength,target});byteLength+=bytes.byteLength;
      const entry={bufferView:view,componentType,count:array.length/(type==='VEC3'?3:1),type};if(min)entry.min=min;if(max)entry.max=max;
      json.accessors.push(entry);return json.accessors.length-1;
    }
    const ids=new Set();
    for(const mesh of meshes){
      if(!mesh||typeof mesh.id!=='string'||!mesh.id||ids.has(mesh.id))fail('Неверные или повторяющиеся имена поверхностей.');ids.add(mesh.id);
      const vertices=mesh.vertices,indices=mesh.triangles;
      if(!vertices||!indices||!vertices.length||vertices.length%3||!indices.length||indices.length%3)fail(mesh.id+': нет полной геометрии поверхности.');
      if(!/^#[0-9a-f]{6}$/i.test(mesh.cssColor))fail(mesh.id+': неверный цвет поверхности.');
      const alpha=mesh.opacity??1;if(!Number.isFinite(alpha)||alpha<=0||alpha>1)fail(mesh.id+': неверная непрозрачность поверхности.');
      const count=vertices.length/3,positions=new Float32Array(vertices.length),normals=new Float32Array(vertices.length),faces=new Uint32Array(indices.length),min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
      for(let i=0;i<vertices.length;i++){
        if(!Number.isFinite(vertices[i]))fail(mesh.id+': неверная координата вершины.');
        positions[i]=vertices[i]*1e-9;if(!Number.isFinite(positions[i]))fail(mesh.id+': координата вне диапазона GLB.');
        min[i%3]=Math.min(min[i%3],positions[i]);max[i%3]=Math.max(max[i%3],positions[i]);
      }
      for(let i=0;i<indices.length;i++){if(!Number.isInteger(indices[i])||indices[i]<0||indices[i]>=count)fail(mesh.id+': неверный индекс треугольника.');faces[i]=indices[i];}
      // Normals affect shading only. All source vertices and triangles remain in their original order.
      for(let i=0;i<faces.length;i+=3){
        const a=faces[i]*3,b=faces[i+1]*3,c=faces[i+2]*3,x=vertices[b]-vertices[a],y=vertices[b+1]-vertices[a+1],z=vertices[b+2]-vertices[a+2],u=vertices[c]-vertices[a],v=vertices[c+1]-vertices[a+1],w=vertices[c+2]-vertices[a+2],normal=[y*w-z*v,z*u-x*w,x*v-y*u];
        for(const index of [a,b,c])for(let axis=0;axis<3;axis++)normals[index+axis]+=normal[axis];
      }
      for(let i=0;i<normals.length;i+=3){const length=Math.hypot(normals[i],normals[i+1],normals[i+2]);if(length)for(let a=0;a<3;a++)normals[i+a]/=length;else normals[i+2]=1;}
      const position=accessor(positions,'VEC3',5126,34962,min,max),normal=accessor(normals,'VEC3',5126,34962),index=accessor(faces,'SCALAR',5125,34963),rgb=[1,3,5].map(i=>linear(parseInt(mesh.cssColor.slice(i,i+2),16)/255)),name=mesh.id+' · '+String(mesh.label||mesh.id),extra={object_id:mesh.id,segment_id:mesh.segment_id||null,color_srgb:mesh.cssColor,opacity:alpha,context:!!mesh.context,crop_faces:Array.isArray(mesh.clipped)?[...mesh.clipped]:[],source_vertex_count:count,source_triangle_count:indices.length/3,...(mesh.identity?{identity:mesh.identity}:{})};
      const material=json.materials.length;json.materials.push({name,pbrMetallicRoughness:{baseColorFactor:[...rgb,alpha],metallicFactor:0,roughnessFactor:.8},doubleSided:true,alphaMode:alpha<1?'BLEND':'OPAQUE',extras:{color_srgb:mesh.cssColor}});
      const n=json.meshes.length;json.meshes.push({name,primitives:[{attributes:{POSITION:position,NORMAL:normal},indices:index,material,mode:4}],extras:extra});json.nodes.push({name,mesh:n,extras:extra});json.scenes[0].nodes.push(n);
    }
    json.buffers[0].byteLength=byteLength;
    const raw=new TextEncoder().encode(JSON.stringify(json)),jsonLength=(raw.length+3)&~3,total=12+8+jsonLength+8+byteLength,buffer=new ArrayBuffer(total),view=new DataView(buffer),bytes=new Uint8Array(buffer);
    view.setUint32(0,0x46546c67,true);view.setUint32(4,2,true);view.setUint32(8,total,true);view.setUint32(12,jsonLength,true);view.setUint32(16,0x4e4f534a,true);bytes.fill(32,20,20+jsonLength);bytes.set(raw,20);
    const bin=20+jsonLength;view.setUint32(bin,byteLength,true);view.setUint32(bin+4,0x004e4942,true);let offset=bin+8;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    return {buffer,manifest:json};
  }
  function download(blob,filename){const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=filename.replace(/[^a-zA-Z0-9_.-]/g,'_');link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}
  window.HandoffSurfaceExport=Object.freeze({buildGLB,download});
})();
