/* Capture the actual cross-origin viewer only through the browser's explicit tab picker. */
(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  let busy=false;
  async function captureCurrent(caseId){
    const frame=window.NeuroglancerLink.captureFrame(caseId);
    if(!frame)return null;
    const source=frame.src;
    if(busy)throw new Error('Дождитесь завершения снимка Neuroglancer.');
    if(!navigator.mediaDevices?.getDisplayMedia||!window.CropTarget)throw new Error('Для снимка Neuroglancer откройте сайт в Chrome или Edge.');
    busy=true;
    const pages=[...document.querySelectorAll('.page')].map(node=>({node,hidden:node.hidden})),scroll=[scrollX,scrollY];
    let stream,video;
    try{
      pages.forEach(({node})=>node.hidden=node.id!=='page-neuroglancer');
      frame.scrollIntoView({block:'center',behavior:'instant'});
      $('neuroglancerStatus').textContent='Для снимка выберите эту вкладку MICrONS в окне браузера. Сохраняется только область Neuroglancer.';
      // This must run before the first await, while the export click still has user activation.
      stream=await navigator.mediaDevices.getDisplayMedia({video:{displaySurface:'browser',frameRate:{ideal:5,max:5}},audio:false,preferCurrentTab:true,selfBrowserSurface:'include',surfaceSwitching:'exclude',monitorTypeSurfaces:'exclude'});
      const track=stream.getVideoTracks()[0];
      if(window.NeuroglancerLink.captureFrame(caseId)!==frame||frame.src!==source)throw new Error('Случай или метки изменились во время снимка. Повторите сохранение.');
      if(track.getSettings().displaySurface!=='browser'||typeof track.cropTo!=='function')throw new Error('Выберите эту вкладку MICrONS, а не окно или весь экран.');
      // cropTo rejects a different tab. Never save another app, tab, or the surrounding desktop.
      try{await track.cropTo(await CropTarget.fromElement(frame));}catch{throw new Error('Выбрана другая вкладка. Повторите и выберите эту вкладку MICrONS.');}
      video=document.createElement('video');video.muted=true;video.srcObject=stream;
      await video.play();
      await new Promise((resolve,reject)=>{
        const timeout=setTimeout(()=>reject(new Error('Браузер не передал снимок. Повторите сохранение.')),10000);
        // Cropping/hi-DPI capture can resize the source WebGL buffer. Allow the source to repaint.
        const started=performance.now();
        const painted=()=>{if(performance.now()-started<1200)video.requestVideoFrameCallback(painted);else{clearTimeout(timeout);resolve();}};
        video.requestVideoFrameCallback(painted);
      });
      if(!video.videoWidth||!video.videoHeight)throw new Error('Neuroglancer ещё не виден. Дождитесь загрузки и повторите сохранение.');
      if(window.NeuroglancerLink.captureFrame(caseId)!==frame||frame.src!==source)throw new Error('Случай или метки изменились во время снимка. Повторите сохранение.');
      const canvas=document.createElement('canvas');canvas.width=video.videoWidth;canvas.height=video.videoHeight;
      canvas.getContext('2d').drawImage(video,0,0);
      return await new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('Не удалось получить снимок Neuroglancer.')),'image/png'));
    }catch(error){
      if(error.name==='NotAllowedError'||error.name==='AbortError')throw new Error('Снимок Neuroglancer отменён. Для ZIP с ним разрешите снимок этой вкладки. Все точки и заметки остаются в браузере.');
      throw error;
    }finally{
      stream?.getTracks().forEach(track=>track.stop());
      if(video){video.pause();video.srcObject=null;}
      pages.forEach(({node,hidden})=>node.hidden=hidden);window.scrollTo({left:scroll[0],top:scroll[1],behavior:'instant'});busy=false;
    }
  }
  window.NeuroglancerLink.captureCurrent=captureCurrent;
  for(const [id,scope] of [['neuroglancerExportCase','case'],['neuroglancerExportAll','all']])$(id).addEventListener('click',async()=>{
    if(!window.HandoffAnnotations?.store)return;
    await HandoffAnnotations.exportFindings(scope,{includeImages:true});
    $('neuroglancerStatus').textContent=$('restoreResult').textContent;
  });
})();
