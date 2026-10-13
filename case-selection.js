/* Active figure-annotation workspace. The full 42-case evidence and backups stay intact.
 * Selection: GUIDE_REVIEW_METHODS positive same-head/traceable-neck group plus
 * R021, R009's original matched control (GUIDE_FIGURES_TABLES). No new adjudication.
 * Change this list to change the workspace; do not trim case_index.json or stored records.
 */
(() => {
  'use strict';
  const ids=Object.freeze(['R002','R004','R009','R017','R021','R024','R032','R036','R037']);
  const selected=new Set(ids);
  const positive=new Set(['R002','R004','R009','R017','R024','R032','R036','R037']);
  window.HandoffCaseSelection=Object.freeze({
    ids,defaultId:ids[0],includes:id=>selected.has(id),
    assessmentLabel:id=>id==='R021'?'Контроль':positive.has(id)?'Подтверждено: два контакта на одной головке; шейка прослеживается до дендрита':'',
    cases(metadata){
      const cases=ids.map(id=>metadata.cases.find(c=>c.case_id===id));
      if(cases.some(c=>!c))throw new Error('В материалах отсутствует выбранный случай.');
      return cases;
    }
  });
})();
