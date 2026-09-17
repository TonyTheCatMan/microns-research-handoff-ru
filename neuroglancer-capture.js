/* Capture the current scene of the pinned, same-origin Neuroglancer viewer. */
(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  let busy=false;
  async function captureCurrent(caseId){
    const frame=window.NeuroglancerLink.captureFrame(caseId);
    if(!frame)return null;
    const source=frame.src;
    if(busy)throw new Error('Дождитесь завершения снимка Neuroglancer.');
    busy=true;
    const pages=[...document.querySelectorAll('.page')].map(node=>({node,hidden:node.hidden})),scroll=[scrollX,scrollY];
    const unchanged=()=>{
      if(window.NeuroglancerLink.captureFrame(caseId)!==frame||frame.src!==source)throw new Error('Случай или метки изменились во время снимка. Повторите сохранение.');
    };
    try{
      pages.forEach(({node})=>node.hidden=node.id!=='page-neuroglancer');
      frame.scrollIntoView({block:'center',behavior:'instant'});
      $('neuroglancerStatus').textContent='Сохраняем текущий вид Neuroglancer с метками…';
      let sourceWindow,renderer,display;
      try{sourceWindow=frame.contentWindow;renderer=sourceWindow.viewer;display=renderer?.display;}catch{throw new Error('Не удалось прочитать текущий вид Neuroglancer. Обновите сайт и откройте Neuroglancer снова.');}
      const started=performance.now();let readyOnce=false;
      // A hidden iframe needs a layout pass before the native drawing buffer is resized.
      // Wait for the existing renderer; never reload or reconstruct its camera state.
      while(true){
        unchanged();renderer=sourceWindow.viewer;display=renderer?.display;
        const sourceCanvas=display?.canvas;
        if(sourceCanvas?.offsetWidth&&sourceCanvas.offsetHeight&&sourceWindow.MicronsMarkers){
          display.resizeCallback();display.draw();
          if(renderer.isReady()&&sourceCanvas.width&&sourceCanvas.height){if(readyOnce)break;readyOnce=true;}else readyOnce=false;
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
      for(const overlay of sourceWindow.document.querySelectorAll('.microns-numbered-marks')){
        const box=overlay.getBoundingClientRect();
        if(!overlay.width||!overlay.height||!box.width||!box.height||!overlay.checkVisibility())continue;
        ctx.drawImage(overlay,(box.left-rect.left)*scaleX,(box.top-rect.top)*scaleY,box.width*scaleX,box.height*scaleY);
      }
      unchanged();
      return await new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('Не удалось получить снимок Neuroglancer.')),'image/png'));
    }finally{
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
