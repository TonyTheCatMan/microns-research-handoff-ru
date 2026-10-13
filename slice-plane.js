/* Physical-coordinate oblique section helpers. Pixel centers are (index + 0.5) * resolution. */
(function(root){
  'use strict';
  const finite3=a=>Array.isArray(a)&&a.length===3&&a.every(Number.isFinite);
  const dot=(a,b)=>a.reduce((s,n,i)=>s+n*b[i],0);
  // Intrinsic X, then Y, then Z rotations; matrix = Rz * Ry * Rx, in physical nm axes.
  function basis(angles){
    if(!finite3(angles))throw new Error('Invalid slice angles');
    const [x,y,z]=angles.map(v=>v*Math.PI/180),cx=Math.cos(x),sx=Math.sin(x),cy=Math.cos(y),sy=Math.sin(y),cz=Math.cos(z),sz=Math.sin(z);
    return {u:[cz*cy,sz*cy,-sy],v:[cz*sy*sx-sz*cx,sz*sy*sx+cz*cx,cy*sx],normal:[cz*sy*cx+sz*sx,sz*sy*cx-cz*sx,cy*cx]};
  }
  function normalize(value){
    if(!value||typeof value.enabled!=='boolean'||!finite3(value.angles_deg)||!finite3(value.center_global_nm))throw new Error('Invalid slice plane');
    return {enabled:value.enabled,angles_deg:value.angles_deg.map(a=>a>=-180&&a<=180?a:((a+180)%360+360)%360-180),center_global_nm:[...value.center_global_nm]};
  }
  // The bounding rectangle covers the whole plane/box intersection. Fragment sampling clips at the box.
  function rectangle(bounds,center,angles){
    const axes=basis(angles),lo=[Infinity,Infinity],hi=[-Infinity,-Infinity];
    for(let mask=0;mask<8;mask++){
      const p=bounds.map((n,i)=>(mask&(1<<i)?n:0)-center[i]);
      for(const [i,axis]of [axes.u,axes.v].entries()){const v=dot(p,axis);lo[i]=Math.min(lo[i],v);hi[i]=Math.max(hi[i],v);}
    }
    const corners=[[lo[0],lo[1]],[hi[0],lo[1]],[hi[0],hi[1]],[lo[0],hi[1]]].map(([u,v])=>center.map((n,i)=>n+u*axes.u[i]+v*axes.v[i]));
    return {...axes,vertices:new Float32Array(corners.flat()),lo,hi};
  }
  function intersect(origin,direction,center,normal,bounds){
    const denominator=dot(direction,normal);if(Math.abs(denominator)<1e-10)return null;
    const t=dot(center.map((n,i)=>n-origin[i]),normal)/denominator;if(t<0)return null;
    const point=origin.map((n,i)=>n+t*direction[i]);
    return point.every((n,i)=>n>=0&&n<bounds[i])?{point,t}:null;
  }
  // Reference implementation for shader verification and scientific coordinate tests.
  // The GPU uses identical edge-clamped trilinear interpolation over raw TIFF uint8 voxels.
  function sampleTrilinear(data,shape,resolution,point){
    if(!point.every((n,i)=>n>=0&&n<shape[i]*resolution[i]))return null;
    const p=point.map((n,i)=>Math.max(0,Math.min(shape[i]-1,n/resolution[i]-.5))),lo=p.map(Math.floor),hi=lo.map((n,i)=>Math.min(n+1,shape[i]-1)),f=p.map((n,i)=>n-lo[i]);
    let value=0;
    for(let mask=0;mask<8;mask++){
      const at=lo.map((n,i)=>mask&(1<<i)?hi[i]:n),weight=f.reduce((v,n,i)=>v*(mask&(1<<i)?n:1-n),1);
      value+=data[(at[2]*shape[1]+at[1])*shape[0]+at[0]]*weight;
    }
    return value;
  }
  const api=Object.freeze({basis,normalize,rectangle,intersect,sampleTrilinear});
  if(typeof module!=='undefined'&&module.exports)module.exports=api;root.HandoffSlicePlane=api;
})(typeof globalThis!=='undefined'?globalThis:this);
