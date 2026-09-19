/* Capture the current scene of the pinned, same-origin Neuroglancer viewer. */
(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  let busy=false;
  async function captureCurrent(caseId){
    const frame=window.NeuroglancerLink.captureFrame(caseId);
    if(!frame)return null;
    const source=frame.src,modeRevision=window.HandoffSync?.syncRevision;let requestedSync=null;
    if(busy)throw new Error('Дождитесь завершения снимка Neuroglancer.');
    busy=true;
    const pages=[...document.querySelectorAll('.page')].map(node=>({node,hidden:node.hidden})),scroll=[scrollX,scrollY],initialHash=location.hash;
    const unchanged=()=>{
      if(window.HandoffSync?.syncRevision!==modeRevision)throw new Error('Синхронизация изменилась во время снимка. Повторите сохранение.');
      if(location.hash!==initialHash)throw new Error('Вкладка изменилась во время снимка. Повторите сохранение в Neuroglancer.');
      if(window.NeuroglancerLink.captureFrame(caseId)!==frame||frame.src!==source)throw new Error('Случай или метки изменились во время снимка. Повторите сохранение.');
      if(requestedSync&&window.NeuroglancerLink.sync?.latest!==requestedSync)throw new Error('Вид изменился во время синхронизации. Повторите сохранение снимка.');
    };
    try{
      pages.forEach(({node})=>node.hidden=node.id!=='page-neuroglancer');
      frame.scrollIntoView({block:'center',behavior:'instant'});
      $('neuroglancerStatus').textContent='Сохраняем текущий вид Neuroglancer с метками…';
      let sourceWindow,renderer,display;
      try{sourceWindow=frame.contentWindow;renderer=sourceWindow.viewer;display=renderer?.display;}catch{throw new Error('Не удалось прочитать текущий вид Neuroglancer. Обновите сайт и откройте Neuroglancer снова.');}
      const started=performance.now();let readyOnce=false,previousSync=null;
      // A hidden iframe needs a layout pass before the native drawing buffer is resized.
      // Wait for the existing renderer; never reload or reconstruct its camera state.
      while(true){
        unchanged();renderer=sourceWindow.viewer;display=renderer?.display;
        const sourceCanvas=display?.canvas;
        if(sourceCanvas?.offsetWidth&&sourceCanvas.offsetHeight&&sourceWindow.MicronsMarkers){
          display.resizeCallback();display.draw();
          const sync=sourceWindow.MicronsViewSync,applied=sync?.applied,expected=window.NeuroglancerLink.sync?.latest;
          const synchronized=!expected||!!sync&&!sync.applying&&sync.caseId===caseId&&applied&&(applied.source===expected.source&&applied.clock===expected.clock||window.HandoffSync.newer(applied,expected));
          if(synchronized&&renderer.isReady()&&sourceCanvas.width&&sourceCanvas.height){if(readyOnce&&previousSync===expected){requestedSync=expected;break;}readyOnce=true;previousSync=expected;}else readyOnce=false;
        }
        if(performance.now()-started>15000)throw new Error('Neuroglancer ещё загружает изображения или 3D. Дождитесь загрузки и повторите сохранение.');
        await new Promise(resolve=>setTimeout(resolve,100));
      }
      unchanged();
      // Native screenshots use draw() followed immediately by copying this canvas.
      // updateFinished redraws the numbered symbols synchronously inside draw().
      display.draw();
      const sourceCanvas=display.canvas,rect=sourceCanvas.getBoundingClientRect();
      if(!rect.width||!rect.height||!sourceCanvas.width||!sourceCanvas.height)throw new Error('Neuroglancer ещё не виден. Повторите сохранение.');
      const canvas=document.createElement('canvas');canvas.width=sourceCanvas.width;canvas.height=sourceCanvas.height;
      const ctx=canvas.getContext('2d');ctx.drawImage(sourceCanvas,0,0);
      const scaleX=canvas.width/rect.width,scaleY=canvas.height/rect.height;
      const overlays=[...sourceWindow.document.querySelectorAll('.microns-segmentation-borders,.microns-numbered-marks')].sort((a,b)=>Number(a.classList.contains('microns-numbered-marks'))-Number(b.classList.contains('microns-numbered-marks')));
      for(const overlay of overlays){
        const box=overlay.getBoundingClientRect();
        if(!overlay.width||!overlay.height||!box.width||!box.height||!overlay.checkVisibility())continue;
        ctx.drawImage(overlay,(box.left-rect.left)*scaleX,(box.top-rect.top)*scaleY,box.width*scaleX,box.height*scaleY);
      }
      unchanged();
      return await new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('Не удалось получить снимок Neuroglancer.')),'image/png'));
    }finally{
      if(location.hash===initialHash){pages.forEach(({node,hidden})=>node.hidden=hidden);window.scrollTo({left:scroll[0],top:scroll[1],behavior:'instant'});}busy=false;
    }
  }
  window.NeuroglancerLink.captureCurrent=captureCurrent;
  const screenshotButton=$('neuroglancerScreenshot');
  screenshotButton.addEventListener('click',async()=>{
    if(busy||window.HandoffAnnotations?.isExporting){$('neuroglancerStatus').textContent='Дождитесь завершения текущего сохранения.';return;}
    screenshotButton.disabled=true;
    try{
      const caseId=window.HandoffSync?.enabled?window.ReviewViewer?.currentCase?.case_id:window.NeuroglancerLink.frameCaseId?.();
      const blob=await captureCurrent(caseId);
      if(!blob)throw new Error('Откройте текущий случай в Neuroglancer и дождитесь загрузки.');
      const url=URL.createObjectURL(blob),link=document.createElement('a');
      link.href=url;link.download=`MICrONS-${caseId}-Neuroglancer-${new Date().toISOString().slice(0,19).replace(/:/g,'-')}.png`;
      document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
      $('neuroglancerStatus').textContent='Снимок текущего вида Neuroglancer с видимыми метками сохранён в PNG.';
    }catch(error){$('neuroglancerStatus').textContent=error.message;}
    finally{screenshotButton.disabled=false;}
  });
  for(const [id,scope] of [['neuroglancerExportCase','case'],['neuroglancerExportAll','all']])$(id).addEventListener('click',async()=>{
    if(!window.HandoffAnnotations?.store)return;
    await HandoffAnnotations.exportFindings(scope,{includeImages:true});
    $('neuroglancerStatus').textContent=$('restoreResult').textContent;
  });
})();
