/* Physical-coordinate oblique section helpers. Pixel centers are (index + 0.5) * resolution. */
(function(root){
  'use strict';
  const finite3=a=>Array.isArray(a)&&a.length===3&&[0,1,2].every(i=>Number.isFinite(a[i]));
  const dot=(a,b)=>a.reduce((s,n,i)=>s+n*b[i],0);
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  function normalizeQuaternion(q){
    if(!Array.isArray(q)||q.length!==4||![0,1,2,3].every(i=>Number.isFinite(q[i])))throw new Error('Invalid slice quaternion');
    const length=Math.hypot(...q);if(length<1e-12)throw new Error('Invalid slice quaternion');
    // Scale first for huge finite inputs. Preserve already-unit wire values to avoid rounding echoes.
    const largest=Math.max(...q.map(Math.abs)),scaled=q.map(n=>n/largest),scaledLength=Math.hypot(...scaled),unit=Math.abs(length-1)<1e-12?[...q]:scaled.map(n=>n/scaledLength),sign=Math.abs(unit[3])>1e-12?Math.sign(unit[3]):Math.sign(unit.find(n=>Math.abs(n)>1e-12)||1);
    return unit.map(n=>n*sign);
  }
  function multiplyQuaternion(a,b){
    const [x,y,z,w]=a,[X,Y,Z,W]=b;
    return normalizeQuaternion([w*X+x*W+y*Z-z*Y,w*Y-x*Z+y*W+z*X,w*Z+x*Y-y*X+z*W,w*W-x*X-y*Y-z*Z]);
  }
  function quaternionFromAngles(angles){
    if(!finite3(angles))throw new Error('Invalid slice angles');
    const [x,y,z]=angles.map(n=>n*Math.PI/360),sx=Math.sin(x),cx=Math.cos(x),sy=Math.sin(y),cy=Math.cos(y),sz=Math.sin(z),cz=Math.cos(z);
    return normalizeQuaternion([sx*cy*cz-cx*sy*sz,cx*sy*cz+sx*cy*sz,cx*cy*sz-sx*sy*cz,cx*cy*cz+sx*sy*sz]);
  }
  function basisFromQuaternion(value){
    const [x,y,z,w]=normalizeQuaternion(value);
    return {u:[1-2*(y*y+z*z),2*(x*y+w*z),2*(x*z-w*y)],v:[2*(x*y-w*z),1-2*(x*x+z*z),2*(y*z+w*x)],normal:[2*(x*z+w*y),2*(y*z-w*x),1-2*(x*x+y*y)]};
  }
  function anglesFromQuaternion(q){
    const {u,v,normal:n}=basisFromQuaternion(q),sine=Math.max(-1,Math.min(1,-u[2])),y=1-Math.abs(sine)<1e-14?Math.sign(sine)*Math.PI/2:Math.asin(sine),regular=Math.abs(Math.cos(y))>1e-7;
    return [regular?Math.atan2(v[2],n[2]):Math.atan2(-n[1],v[1]),y,regular?Math.atan2(u[1],u[0]):0].map(a=>a*180/Math.PI);
  }
  function planeBasis(plane){return plane.orientation_quat?basisFromQuaternion(plane.orientation_quat):basis(plane.angles_deg);}
  // A virtual sphere in CSS pixels: center drags tilt, drags around its rim roll.
  function trackballVector(x,y,cx,cy,radius){
    const u=(x-cx)/Math.max(1,radius),v=(cy-y)/Math.max(1,radius),r2=u*u+v*v;
    if(r2<=1)return [u,v,Math.sqrt(1-r2)];const r=Math.sqrt(r2);return [u/r,v/r,0];
  }
  function trackballRotation(start,end,camera){
    const world=a=>camera.right.map((n,i)=>n*a[0]+camera.up[i]*a[1]+camera.eye_direction[i]*a[2]),a=world(start),b=world(end),axis=cross(a,b),w=1+Math.max(-1,Math.min(1,dot(a,b)));
    if(w<1e-10){const alternate=cross(a,Math.abs(a[0])<.8?[1,0,0]:[0,1,0]);return normalizeQuaternion([...alternate,0]);}
    return normalizeQuaternion([...axis,w]);
  }
  // Intrinsic X, then Y, then Z rotations; matrix = Rz * Ry * Rx, in physical nm axes.
  function basis(angles){
    if(!finite3(angles))throw new Error('Invalid slice angles');
    const [x,y,z]=angles.map(v=>v*Math.PI/180),cx=Math.cos(x),sx=Math.sin(x),cy=Math.cos(y),sy=Math.sin(y),cz=Math.cos(z),sz=Math.sin(z);
    return {u:[cz*cy,sz*cy,-sy],v:[cz*sy*sx-sz*cx,sz*sy*sx+cz*cx,cy*sx],normal:[cz*sy*cx+sz*sx,sz*sy*cx-cz*sx,cy*cx]};
  }
  function normalize(value){
    if(!value||typeof value.enabled!=='boolean'||!finite3(value.angles_deg)||!finite3(value.center_global_nm))throw new Error('Invalid slice plane');
    const q=value.orientation_quat===undefined?null:normalizeQuaternion(value.orientation_quat);
    return {enabled:value.enabled,angles_deg:q?anglesFromQuaternion(q):value.angles_deg.map(a=>a>=-180&&a<=180?a:((a+180)%360+360)%360-180),center_global_nm:[...value.center_global_nm],...(q?{orientation_quat:q}:{})};
  }
  // The bounding rectangle covers the whole plane/box intersection. Fragment sampling clips at the box.
  function rectangle(bounds,center,angles,orientationQuaternion){
    const axes=orientationQuaternion?basisFromQuaternion(orientationQuaternion):basis(angles),lo=[Infinity,Infinity],hi=[-Infinity,-Infinity];
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
  const api=Object.freeze({basis,normalize,rectangle,intersect,sampleTrilinear,normalizeQuaternion,multiplyQuaternion,quaternionFromAngles,basisFromQuaternion,anglesFromQuaternion,planeBasis,trackballVector,trackballRotation});
  if(typeof module!=='undefined'&&module.exports)module.exports=api;root.HandoffSlicePlane=api;
})(typeof globalThis!=='undefined'?globalThis:this);
