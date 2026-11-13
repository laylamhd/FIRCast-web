// =====================================================================
// FIRCast · js/shared/nav.js
// Used on: every page.
//
// The navigation bar sits at the top of the page (position: absolute, so
// it scrolls away with the page). This script watches the scroll position
// and adds the class .is-compact once you scroll down, which base.css uses
// to shrink the bar to just the logo in the top-left corner. Scrolling back
// to the top removes the class and the bar grows back.
//
// Two thresholds (48 px to shrink, 8 px to grow) stop it flickering when the
// page sits near the top. requestAnimationFrame limits the work to once per
// screen refresh, however fast scroll events arrive.
// =====================================================================


(() => {
  'use strict';
  const nav = document.querySelector('.nav');
  let compact = false, queued = false;
  // Decide whether the bar should be full or compact, from how far the page is scrolled.
  function update() {
    queued = false;
    const y = window.scrollY;
    // two thresholds, so the bar does not flicker near the top
    const next = compact ? y > 8 : y > 48;
    if (next !== compact) { compact = next; nav.classList.toggle('is-compact', compact); }
  }
  // On scroll, ask for one update on the next screen refresh (queued stops repeats).
  window.addEventListener('scroll', () => {
    if (!queued) { queued = true; requestAnimationFrame(update); }
  }, { passive: true });
  update();
})();
