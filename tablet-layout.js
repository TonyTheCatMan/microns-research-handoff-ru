/* Compact settings on tablets without moving or hiding slice navigation. */
(() => {
  'use strict';
  const compact = matchMedia('(max-width: 1180px), (pointer: coarse)');
  const sections = [...document.querySelectorAll('[data-tablet-collapse]')];
  const chosen = new WeakSet();
  function applyDefault() {
    for (const section of sections) if (!chosen.has(section)) section.open = !compact.matches;
  }
  for (const section of sections) {
    // Only a deliberate activation overrides responsive defaults for this visit.
    section.querySelector('summary')?.addEventListener('click', () => chosen.add(section));
  }
  applyDefault();
  compact.addEventListener('change', applyDefault);

  const mode = document.getElementById('annotationMode');
  const current = document.getElementById('drawingCollapsedTool');
  function updateTool() {
    if (!mode || !current) return;
    const button = [...document.querySelectorAll('[data-drawing-tool]')].find(item => item.dataset.drawingTool === mode.value);
    current.textContent = button?.querySelector('span')?.textContent || button?.textContent || mode.selectedOptions[0]?.textContent || '';
  }
  mode?.addEventListener('change', updateTool);
  updateTool();

  // Keep a fitted image fully visible after rotating a tablet. Manual zoom is
  // intentionally retained by the viewer's existing resize handler.
  const viewport = document.getElementById('viewport');
  let lastSize = '', frame = 0;
  function scheduleFit() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      if (!viewport.clientWidth || !viewport.clientHeight || document.getElementById('page-viewer')?.hidden) return;
      if (document.getElementById('zoomSelect')?.selectedOptions[0]?.dataset.fit) document.getElementById('fitButton')?.click();
    });
  }
  let awaitingVolumeImage = false;
  window.addEventListener('review:volume', () => { awaitingVolumeImage = true; });
  window.addEventListener('review:position', () => {
    if (!awaitingVolumeImage) return;
    awaitingVolumeImage = false;
    scheduleFit();
  });
  if (viewport && typeof ResizeObserver === 'function') new ResizeObserver(() => {
    const size = `${viewport.clientWidth}:${viewport.clientHeight}`;
    if (size === lastSize) return;
    lastSize = size;
    scheduleFit();
  }).observe(viewport);
})();
