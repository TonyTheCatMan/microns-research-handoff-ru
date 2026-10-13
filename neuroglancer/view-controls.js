/* Controls for the pinned native viewer. Navigation only: this module never edits
 * layers, annotation records or image data. The default orbit keeps XY upright;
 * full 3D rotation is an explicit session opt-in. New sessions start with it off;
 * another native window joining that session adopts its explicit current choice. */
(() => {
  'use strict';
  const LIMIT=1.48,DRAG_RADIANS=Math.PI/720,IDENTITY=[0,0,0,1];
  let fullRotation=false,constraining=false,ready=false,busy=false,cancelDrag=null;
  let toolbar,reset2D,reset3D,fullInput,fullText,fullLabel,status;
  const copy=value=>Array.from(value||IDENTITY);
  const clamp=value=>Math.max(-LIMIT,Math.min(LIMIT,value));
  const language=()=>window.HandoffI18n?.getLanguage()==='en'?'en':'ru';
  const text={
    ru:{region:'Управление видом Neuroglancer',reset2D:'↶ 2D: вписать',reset3D:'↶ 3D: сбросить',full:'Полное вращение',
      title2D:'Вернуть срез XY, центрировать фрагмент и вписать его в окно. Текущий срез Z сохраняется.',
      title3D:'Вернуть 3D без наклона вбок, центрировать фрагмент и вписать его в окно. Метки и видимость объектов сохраняются.',
      titleFull:'Разрешить свободное вращение 3D, включая наклон и переворот. По умолчанию выключено. 2D остаётся в плоскости XY.',
      loading:'Загрузка просмотрщика…',saving:'Возвращаем вид…',done2D:'Срез XY центрирован и вписан.',done3D:'Вид 3D сброшен.',upright:'3D удерживается без наклона вбок.',free:'Свободное вращение 3D включено.'},
    en:{region:'Neuroglancer view controls',reset2D:'↶ Fit 2D',reset3D:'↶ Reset 3D',full:'Full rotation',
      title2D:'Restore the XY section, center the crop and fit it to the window. The current Z section is preserved.',
      title3D:'Restore upright 3D, center the crop and fit it to the window. Annotations and object visibility are preserved.',
      titleFull:'Allow free 3D rotation, including roll and inversion. Off by default. 2D remains in the XY plane.',
      loading:'Loading viewer…',saving:'Resetting view…',done2D:'XY section centered and fitted.',done3D:'3D view reset.',upright:'3D stays upright.',free:'Free 3D rotation enabled.'}
  };
  let statusKey='loading',statusError='';
  function unitQuaternion(input){
    if(!input||input.length!==4||Array.from(input).some(n=>!Number.isFinite(n)))return [...IDENTITY];
    const length=Math.hypot(...input);return length>1e-12?Array.from(input,n=>n/length):[...IDENTITY];
  }
  function angles(input){
    const [x,y,z,w]=unitQuaternion(input);
    // Camera +Z in world coordinates. A Y-yaw/X-pitch orbit retains this look
    // direction while rebuilding camera up with a positive world-Y component.
    const eyeX=2*(x*z+y*w),eyeY=2*(y*z-x*w),eyeZ=1-2*(x*x+y*y);
    const yaw=Math.hypot(eyeX,eyeZ)>1e-9?Math.atan2(eyeX,eyeZ):0;
    return {yaw,pitch:clamp(Math.asin(Math.max(-1,Math.min(1,-eyeY))))};
  }
  function orbitQuaternion(yaw,pitch){
    const sy=Math.sin(yaw/2),cy=Math.cos(yaw/2),sp=Math.sin(clamp(pitch)/2),cp=Math.cos(clamp(pitch)/2);
    return [cy*sp,sy*cp,-sy*sp,cy*cp];
  }
  function constrainQuaternion(input){const a=angles(input);return orbitQuaternion(a.yaw,a.pitch);}
  function equivalent(a,b){
    a=unitQuaternion(a);b=unitQuaternion(b);
    return Math.min(Math.hypot(...a.map((n,i)=>n-b[i])),Math.hypot(...a.map((n,i)=>n+b[i])))<1e-6;
  }
  function orientation(key){
    const child=window.viewer?.state?.children?.get(key);
    return child?{child,value:child.toJSON()||IDENTITY}:null;
  }
  function writeOrientation(key,value){
    const entry=orientation(key);if(!entry||equivalent(entry.value,value))return false;
    entry.child.restoreState(copy(value));return true;
  }
  function constrainOrientation(){
    if(constraining||!window.viewer?.state)return false;
    constraining=true;let changed=false;
    try{
      changed=writeOrientation('crossSectionOrientation',IDENTITY)||changed;
      if(!fullRotation){const entry=orientation('projectionOrientation');if(entry)changed=writeOrientation('projectionOrientation',constrainQuaternion(entry.value))||changed;}
      return changed;
    }finally{constraining=false;}
  }
  function rotate(dx,dy){
    const entry=orientation('projectionOrientation');if(!entry)return;
    const a=angles(entry.value);
    writeOrientation('projectionOrientation',orbitQuaternion(a.yaw+dx,a.pitch+dy));
    window.viewer?.display?.flagContinuousCameraMotion?.();
  }
  function panelFor(event){
    const target=event.target;
    if(!target||target.closest?.('#micronsViewControls'))return null;
    return Array.from(window.viewer?.display?.panels||[]).find(panel=>panel.element?.contains(target))||null;
  }
  function stop(event){event.preventDefault();event.stopImmediatePropagation();}
  function startDrag(original){
    cancelDrag?.();if(!original||!Number.isFinite(original.clientX)||!Number.isFinite(original.clientY))return;
    let x=original.clientX,y=original.clientY;
    const move=event=>{
      if(fullRotation){finish();return;}
      const dx=event.clientX-x,dy=event.clientY-y;x=event.clientX;y=event.clientY;
      if(Number.isFinite(dx)&&Number.isFinite(dy))rotate(dx*DRAG_RADIANS,-dy*DRAG_RADIANS);
    };
    const up=event=>{if(event.button===original.button)finish();};
    const finish=()=>{document.removeEventListener('pointermove',move,true);document.removeEventListener('pointerup',up);document.removeEventListener('pointercancel',finish);window.removeEventListener('blur',finish);if(cancelDrag===finish)cancelDrag=null;};
    cancelDrag=finish;document.addEventListener('pointermove',move,true);document.addEventListener('pointerup',up);document.addEventListener('pointercancel',finish);window.addEventListener('blur',finish);
  }
  function rotationAction(event){
    const panel=panelFor(event);if(!panel)return;
    const action=event.type.slice('action:'.length);
    if(panel.sliceView){
      // Oblique sections would invalidate the XY-only drawing overlay. Shift-drag
      // becomes ordinary panning rather than an accidental section rotation.
      stop(event);
      if(action==='rotate-via-mouse-drag')event.target.dispatchEvent(new CustomEvent('action:translate-via-mouse-drag',{bubbles:true,cancelable:true,detail:event.detail}));
      return;
    }
    if(fullRotation)return;
    stop(event);
    if(action==='rotate-via-mouse-drag')startDrag(event.detail);
    else if(action==='rotate-out-of-plane-via-touchtranslate')rotate((event.detail?.deltaX||0)*DRAG_RADIANS,-(event.detail?.deltaY||0)*DRAG_RADIANS);
    else if(action.startsWith('rotate-relative-')){
      const axis=action.at(-2),delta=action.endsWith('+')?.1:-.1;
      if(axis==='x')rotate(0,delta);else if(axis==='y')rotate(delta,0);
      // Roll (Z) is intentionally disabled in upright mode.
    }
  }
  function render(){
    if(!toolbar)return;const t=text[language()];toolbar.setAttribute('aria-label',t.region);
    reset2D.textContent=t.reset2D;reset2D.title=t.title2D;reset3D.textContent=t.reset3D;reset3D.title=t.title3D;
    fullText.textContent=t.full;fullLabel.title=t.titleFull;fullInput.checked=fullRotation;
    reset2D.disabled=reset3D.disabled=!ready||busy||!window.MicronsViewSync?.canReset;fullInput.disabled=!ready||busy||!!window.MicronsViewSync?.applying;
    status.textContent=statusError?(window.HandoffI18n?.translate(statusError)||statusError):(statusKey?t[statusKey]:'');status.classList.toggle('failed',!!statusError);
  }
  function setFullRotation(value,{announce=true}={}){
    const modeChanged=fullRotation!==(value===true);
    fullRotation=value===true;if(modeChanged)cancelDrag?.();const changed=constrainOrientation();statusKey=fullRotation?'free':'upright';statusError='';render();
    if(announce)window.dispatchEvent(new CustomEvent('microns:rotation-mode',{detail:{fullRotation,changed}}));return fullRotation;
  }
  async function reset(kind){
    if(!ready||busy||!window.MicronsViewSync?.canReset)return false;cancelDrag?.();busy=true;statusKey='saving';statusError='';render();
    try{await window.MicronsViewSync.resetView(kind);constrainOrientation();statusKey=kind==='2d'?'done2D':'done3D';return true;}
    catch(error){statusKey='';statusError=error?.message||String(error);return false;}
    finally{busy=false;render();}
  }
  function install(){
    const style=document.createElement('style');style.textContent=`
      #micronsViewControls{position:relative;z-index:32;box-sizing:border-box;flex:0 0 auto;display:flex;flex-wrap:wrap;align-items:center;gap:7px;padding:6px 8px;border-bottom:1px solid #8294a4;background:#1b2935;color:#fff;font:12px/1.3 system-ui}
      #neuroglancer-container{min-height:0}
      #micronsViewControls button{padding:5px 9px;border:1px solid #8195a7;border-radius:4px;background:#314859;color:#fff;font:inherit;cursor:pointer;white-space:nowrap}
      #micronsViewControls button:hover:not(:disabled){background:#425f75}#micronsViewControls button:focus-visible,#micronsViewControls input:focus-visible{outline:2px solid #80d4ff;outline-offset:2px}
      #micronsViewControls button:disabled,#micronsViewControls input:disabled{opacity:.5;cursor:default}#micronsViewControls label{display:flex;align-items:center;gap:4px;white-space:nowrap;cursor:pointer}#micronsViewControls input{accent-color:#79caff;margin:0}
      #micronsViewControlStatus{max-width:420px;font-size:11px;color:#d2e0e8}#micronsViewControlStatus:empty{display:none}#micronsViewControlStatus.failed{color:#ffd0c9}
      @media(max-width:500px){#micronsViewControls{gap:5px;padding:5px}#micronsViewControls button{padding:5px 6px}#micronsViewControlStatus{max-width:100%;font-size:10px}}
    `;document.head.append(style);
    toolbar=document.createElement('div');toolbar.id='micronsViewControls';toolbar.setAttribute('role','group');toolbar.setAttribute('data-no-i18n','');
    reset2D=document.createElement('button');reset2D.type='button';reset2D.id='micronsReset2D';reset2D.addEventListener('click',()=>reset('2d'));
    reset3D=document.createElement('button');reset3D.type='button';reset3D.id='micronsReset3D';reset3D.addEventListener('click',()=>reset('3d'));
    fullLabel=document.createElement('label');fullInput=document.createElement('input');fullInput.type='checkbox';fullInput.id='micronsFullRotation';fullInput.addEventListener('change',()=>setFullRotation(fullInput.checked));fullText=document.createElement('span');fullLabel.append(fullInput,fullText);
    status=document.createElement('span');status.id='micronsViewControlStatus';status.setAttribute('role','status');status.setAttribute('aria-live','polite');toolbar.append(reset2D,reset3D,fullLabel,status);document.body.prepend(toolbar);render();
    for(const action of ['rotate-via-mouse-drag','rotate-in-plane-via-touchrotate','rotate-out-of-plane-via-touchtranslate',...['x','y','z'].flatMap(axis=>['-','+'].map(sign=>'rotate-relative-'+axis+sign))])document.addEventListener('action:'+action,rotationAction,true);
    window.addEventListener('handoff:languagechange',render);
    window.addEventListener('microns:view-sync-status',render);
    start();
  }
  function start(){
    if(!window.viewer?.state||!window.MicronsViewSync?.resetView){setTimeout(start,100);return;}
    // The host may deliver its session mode before this module is ready. Adopt
    // that mode before applying the default guard to avoid peers fighting roll.
    setFullRotation(window.MicronsViewSync.fullRotation,{announce:false});
    ready=true;statusKey='';constrainOrientation();render();
    window.viewer.state.changed.add(()=>{if(!window.MicronsViewSync?.applying)constrainOrientation();});
  }
  window.MicronsViewControls=Object.freeze({get fullRotation(){return fullRotation;},get ready(){return ready;},setFullRotation,constrainOrientation,constrainQuaternion,reset});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();
