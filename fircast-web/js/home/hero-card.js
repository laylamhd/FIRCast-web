// =====================================================================
// FIRCast · js/home/hero-card.js
// Used on: index.html (the first card, "See busy skies before they happen").
//
// 1. Splits the headline into one <span> per word so each word can rise in
//    on its own (the delay comes from the CSS variable --i).
// 2. Builds the curved flight path for the little plane that crosses the card.
// 3. Mouse only: tilts the card in 3D and moves a soft spotlight with the cursor
//    by setting the CSS variables --rx, --ry, --mx and --my.
// =====================================================================


// =========================================================
// Hero card effects: word reveal, flight path, tilt + spotlight
// (the highlighter, corners and button shine are pure CSS)
// =========================================================
(() => {
  'use strict';
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const card = document.getElementById('hero-card');

  // ---------- 1. Split the headline into words ----------
  // Each word becomes <span class="w" style="--i: n">, and CSS delays
  // each one by n x 80ms, so they rise in one after another.
  const title = document.getElementById('hero-title');
  const parts = [...title.querySelectorAll('.line, .hl')];
  title.setAttribute('aria-label', parts.map(p => p.textContent.trim()).join(' '));   // read as one sentence
  let index = 0;
  parts.forEach(part => {
    const words = part.textContent.trim().split(/\s+/);
    part.innerHTML = words
      .map(word => `<span class="w" aria-hidden="true" style="--i: ${index++}">${word}</span>`)
      .join(' ');
  });

  // ---------- 2. Fit the plane's flight path to the card ----------
  // A gentle dip across the top padding: in near the top-left edge,
  // down to about 22px in the middle, out near the top-right edge.
  // Starting and ending high keeps the plane above the corner brackets.
  const pathEls = card.querySelectorAll('.flight path');
  const plane = card.querySelector('.flight-plane');

  // Build the plane's flight path to fit the card's current width: an SVG curve
  // that starts just off the left edge, dips slightly, and leaves past the right edge.
  function buildRoute() {
    const w = card.clientWidth;
    const d = `M -40 0 C ${w * 0.3} 30, ${w * 0.7} 30, ${w + 40} 2`;
    pathEls.forEach(p => p.setAttribute('d', d));
    plane.style.offsetPath = `path("${d}")`;        // CSS offset-path uses the same curve
  }
  new ResizeObserver(buildRoute).observe(card);
  buildRoute();

  // ---------- 3. 3D tilt and spotlight (mouse only) ----------
  const hasMouse = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  if (hasMouse && !reduceMotion) {
    // Mouse moves over the card: work out where it is (0 to 1 across and down)
    // and turn that into a small tilt plus the spotlight position.
    card.addEventListener('pointermove', e => {
      const r = card.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width;     // 0 at the left edge, 1 at the right
      const py = (e.clientY - r.top) / r.height;     // 0 at the top, 1 at the bottom
      card.style.setProperty('--mx', `${px * 100}%`); // spotlight position
      card.style.setProperty('--my', `${py * 100}%`);
      // tilt toward the pointer: at most about 4 degrees each way
      card.style.transform = `perspective(900px) rotateX(${(0.5 - py) * 6}deg) rotateY(${(px - 0.5) * 8}deg)`;
      card.classList.add('is-tilting');
    });
    // Mouse leaves: clear the tilt so the card settles back flat.
    card.addEventListener('pointerleave', () => {
      card.style.transform = '';                    // eases back flat (CSS transition)
      card.classList.remove('is-tilting');
    });
  }
})();
