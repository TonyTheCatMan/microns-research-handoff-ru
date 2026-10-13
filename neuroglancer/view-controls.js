/* Independent physical sampling-plane controls for the native 3D pane. */
(() => {
  'use strict';
  const IDENTITY=[0,0,0,1];
  let ready=false,busy=false,constraining=false,toolbar,reset2D,reset3D,planeInput,planeText,planeLabel,axes,hint,status;
  const sliders=[],outputs=[];
  const language=()=>window.HandoffI18n?.getLanguage()==='en'?'en':'ru';
  const text={
    ru:{region:'Управление видом Neuroglancer',reset2D:'↶ 2D: вписать',reset3D:'↶ 3D: сбросить',plane:'Вращать плоскость среза',
      title2D:'Вернуть срез XY, центрировать фрагмент и вписать его в окно. Текущий срез Z сохраняется.',
      title3D:'Вернуть исходный вид 3D, срез XY и выключить вращение плоскости. Центрировать фрагмент и вписать его в окно. Метки сохраняются.',
      titlePlane:'Наклонять настоящий срез объёма только в 3D. Отдельное окно 2D остаётся в плоскости XY.',
      hint:'Только 3D: наклон среза - X/Y/Z. Вращение камеры - перетаскивание. 2D остаётся XY.',
      axis:'Наклон плоскости вокруг оси ',loading:'Загрузка просмотрщика…',saving:'Возвращаем вид…',done2D:'Срез XY центрирован и вписан.',done3D:'Вид 3D и срез XY восстановлены.'},
    en:{region:'Neuroglancer view controls',reset2D:'↶ Fit 2D',reset3D:'↶ Reset 3D',plane:'Rotate slice plane',
      title2D:'Restore the XY section, center the crop and fit it to the window. The current Z section is preserved.',
      title3D:'Restore the default 3D view and XY slice, and turn slice rotation off. Center the crop and fit it to the window. Annotations are preserved.',
      titlePlane:'Tilt the actual volume cross-section only in 3D. The separate 2D pane stays in acquired XY.',
      hint:'3D only: tilt the slice with X/Y/Z. Drag to orbit the camera. 2D stays XY.',
      axis:'Rotate the sampling plane around ',loading:'Loading viewer…',saving:'Resetting view…',done2D:'XY section centered and fitted.',done3D:'3D view and XY slice restored.'}
  };
  let statusKey='loading',statusError='';
  const getSlicePlane=()=>window.MicronsViewSync?.getSlicePlane()||{enabled:false,angles_deg:[0,0,0],center_global_nm:[0,0,0]};
  function setSlicePlane(value,options){const result=window.MicronsViewSync?.setSlicePlane(value,options);render();return result;}
  function constrainOrientation(){
    if(constraining||!window.viewer?.state)return false;
    const child=viewer.state.children.get('crossSectionOrientation'),value=child?.toJSON();
    if(!value||value.every((n,i)=>Math.abs(n-IDENTITY[i])<1e-7))return false;
    constraining=true;try{child.restoreState(IDENTITY);return true;}finally{constraining=false;}
  }
  function rotationAction(event){
    const target=event.target;if(!target||target.closest?.('#micronsViewControls'))return;
    const panel=Array.from(window.viewer?.display?.panels||[]).find(panel=>panel.element?.contains(target));
    if(!panel?.sliceView)return;
    // Keep acquired XY safe for drawings. Native perspective gestures remain
    // untouched; only these sliders rotate its independent sampling plane.
    event.preventDefault();event.stopImmediatePropagation();
    if(event.type==='action:rotate-via-mouse-drag')target.dispatchEvent(new CustomEvent('action:translate-via-mouse-drag',{bubbles:true,cancelable:true,detail:event.detail}));
  }
  function render(){
    if(!toolbar)return;const t=text[language()],plane=getSlicePlane(),blocked=!ready||busy||!!window.MicronsViewSync?.applying;
    toolbar.setAttribute('aria-label',t.region);reset2D.textContent=t.reset2D;reset2D.title=t.title2D;reset3D.textContent=t.reset3D;reset3D.title=t.title3D;
    planeText.textContent=t.plane;planeLabel.title=t.titlePlane;planeInput.checked=plane.enabled;planeInput.disabled=blocked;
    reset2D.disabled=reset3D.disabled=!ready||busy||!window.MicronsViewSync?.canReset;
    axes.hidden=!plane.enabled;hint.hidden=!plane.enabled;hint.textContent=t.hint;
    sliders.forEach((input,index)=>{input.value=String(plane.angles_deg[index]);input.disabled=blocked||!plane.enabled;input.setAttribute('aria-label',t.axis+'XYZ'[index]);outputs[index].textContent=Math.round(plane.angles_deg[index])+'°';});
    status.textContent=statusError?(window.HandoffI18n?.translate(statusError)||statusError):(statusKey?t[statusKey]:'');status.classList.toggle('failed',!!statusError);
  }
  async function reset(kind){
    if(!ready||busy||!window.MicronsViewSync?.canReset)return false;busy=true;statusKey='saving';statusError='';render();
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
      #micronsViewControls button:disabled,#micronsViewControls input:disabled{opacity:.5;cursor:default}#micronsViewControls label{display:flex;align-items:center;gap:5px;white-space:nowrap;cursor:pointer}#micronsViewControls input{accent-color:#79caff;margin:0}
      #micronsRotateSlicePlane{width:18px;height:18px}#micronsSlicePlaneLabel{padding:5px 8px;border:1px solid #65b8e8;border-radius:4px;background:#233b4c;font-weight:600}
      #micronsSlicePlaneAxes{display:flex;align-items:center;flex-wrap:wrap;gap:10px}#micronsSlicePlaneAxes[hidden],#micronsSlicePlaneHint[hidden]{display:none}#micronsSlicePlaneAxes input{width:100px}#micronsSlicePlaneAxes output{min-width:34px;text-align:right}
      #micronsSlicePlaneHint{flex-basis:100%;color:#d1e5f0;font-size:11px}#micronsViewControlStatus{max-width:420px;font-size:11px;color:#d2e0e8}#micronsViewControlStatus:empty{display:none}#micronsViewControlStatus.failed{color:#ffd0c9}
      @media(max-width:500px){#micronsViewControls{gap:5px;padding:5px}#micronsViewControls button{padding:5px 6px}#micronsViewControlStatus{max-width:100%;font-size:10px}}
    `;document.head.append(style);
    toolbar=document.createElement('div');toolbar.id='micronsViewControls';toolbar.setAttribute('role','group');toolbar.setAttribute('data-no-i18n','');
    reset2D=document.createElement('button');reset2D.type='button';reset2D.id='micronsReset2D';reset2D.addEventListener('click',()=>reset('2d'));
    reset3D=document.createElement('button');reset3D.type='button';reset3D.id='micronsReset3D';reset3D.addEventListener('click',()=>reset('3d'));
    planeLabel=document.createElement('label');planeLabel.id='micronsSlicePlaneLabel';planeInput=document.createElement('input');planeInput.type='checkbox';planeInput.id='micronsRotateSlicePlane';planeInput.addEventListener('change',()=>setSlicePlane({...getSlicePlane(),enabled:planeInput.checked}));planeText=document.createElement('span');planeLabel.append(planeInput,planeText);
    axes=document.createElement('div');axes.id='micronsSlicePlaneAxes';
    for(const [index,axis]of [...'XYZ'].entries()){
      const label=document.createElement('label'),input=document.createElement('input'),output=document.createElement('output');
      input.type='range';input.min='-180';input.max='180';input.step='1';input.value='0';input.id='micronsSlicePlane'+axis;output.htmlFor=input.id;
      input.addEventListener('input',()=>{const plane=getSlicePlane();plane.angles_deg[index]=Number(input.value);setSlicePlane({...plane,enabled:true});});
      label.append(axis,input,output);axes.append(label);sliders.push(input);outputs.push(output);
    }
    hint=document.createElement('div');hint.id='micronsSlicePlaneHint';
    status=document.createElement('span');status.id='micronsViewControlStatus';status.setAttribute('role','status');status.setAttribute('aria-live','polite');toolbar.append(reset2D,reset3D,planeLabel,axes,status,hint);document.body.prepend(toolbar);render();
    for(const action of ['rotate-via-mouse-drag','rotate-in-plane-via-touchrotate','rotate-out-of-plane-via-touchtranslate',...['x','y','z'].flatMap(axis=>['-','+'].map(sign=>'rotate-relative-'+axis+sign))])document.addEventListener('action:'+action,rotationAction,true);
    window.addEventListener('handoff:languagechange',render);window.addEventListener('microns:view-sync-status',render);window.addEventListener('microns:slice-plane-rendered',render);start();
  }
  function start(){
    if(!window.viewer?.state||!window.MicronsViewSync?.resetView){setTimeout(start,100);return;}
    ready=true;statusKey='';constrainOrientation();render();
    window.viewer.state.changed.add(()=>{if(!window.MicronsViewSync?.applying)constrainOrientation();});
  }
  window.MicronsViewControls=Object.freeze({get ready(){return ready;},getSlicePlane,setSlicePlane,constrainOrientation,reset,render});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();
