/* Shared Russian confirmation for deleting a saved researcher mark. */
(() => {
  'use strict';
  let active=false;
  async function confirmDelete({number}){
    if(active||!Number.isSafeInteger(number)||number<1)return false;
    active=true;
    const previous=document.activeElement,dialog=document.createElement('dialog');
    dialog.id='pointDeleteDialog';dialog.lang='ru';dialog.setAttribute('aria-labelledby','pointDeleteTitle');dialog.setAttribute('aria-describedby','pointDeleteQuestion');
    const title=document.createElement('h2');title.id='pointDeleteTitle';title.textContent='Удалить метку?';
    const question=document.createElement('p');question.id='pointDeleteQuestion';question.textContent=`Вы уверены, что хотите удалить метку №${number}?`;
    const actions=document.createElement('div');actions.className='point-delete-actions';
    const yes=document.createElement('button'),no=document.createElement('button');
    yes.id='pointDeleteYes';yes.type='button';yes.textContent='Да';yes.autofocus=true;
    no.id='pointDeleteNo';no.type='button';no.textContent='Нет';
    const hint=document.createElement('small');hint.textContent='Enter - подтвердить выбор · Esc - нет';
    actions.append(yes,no);dialog.append(title,question,actions,hint);document.body.append(dialog);
    return new Promise(resolve=>{
      let done=false;
      const finish=answer=>{
        if(done)return;done=true;document.removeEventListener('keydown',keys,true);
        dialog.close();dialog.remove();active=false;
        if(previous?.isConnected&&!previous.disabled)previous.focus({preventScroll:true});resolve(answer);
      };
      const keys=event=>{
        if(!['Enter','Escape','Delete'].includes(event.key))return;
        event.preventDefault();event.stopImmediatePropagation();
        if(event.repeat||event.isComposing)return;
        if(event.key==='Enter')finish(document.activeElement!==no);else if(event.key==='Escape')finish(false);
      };
      yes.addEventListener('click',()=>finish(true));no.addEventListener('click',()=>finish(false));
      dialog.addEventListener('cancel',event=>{event.preventDefault();finish(false);});
      document.addEventListener('keydown',keys,true);
      try{dialog.showModal();yes.focus({preventScroll:true});}catch{finish(false);}
    });
  }
  const style=document.createElement('style');style.textContent=`
    #pointDeleteDialog{box-sizing:border-box;width:min(420px,calc(100vw - 32px));max-height:calc(100vh - 32px);padding:24px;border:1px solid #b7cbd7;border-radius:12px;background:#fff;color:#173342;font:16px/1.5 system-ui,sans-serif;box-shadow:0 16px 60px #0005}
    #pointDeleteDialog::backdrop{background:#10263588}
    #pointDeleteDialog h2{margin:0 0 12px;font:700 21px/1.3 system-ui,sans-serif;color:#173342}
    #pointDeleteDialog p{margin:0 0 20px;white-space:normal}
    #pointDeleteDialog .point-delete-actions{display:flex;gap:12px;justify-content:flex-end}
    #pointDeleteDialog button{min-width:86px;padding:9px 18px;border:1px solid #a9bfcb;border-radius:7px;background:#fff;color:#173342;font:600 16px/1.4 system-ui,sans-serif;cursor:pointer}
    #pointDeleteDialog #pointDeleteYes{background:#ad3933;border-color:#ad3933;color:#fff}
    #pointDeleteDialog button:focus-visible{outline:3px solid #198cba;outline-offset:3px}
    #pointDeleteDialog small{display:block;margin-top:14px;text-align:right;color:#536b78;font:12px/1.5 system-ui,sans-serif}
  `;document.head.append(style);
  window.PointActions={confirmDelete,get isOpen(){return active;}};
})();
