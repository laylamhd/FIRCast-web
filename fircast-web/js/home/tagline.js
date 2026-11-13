// =====================================================================
// FIRCast · js/home/tagline.js
// Used on: index.html, section 4 (the tagline and runway).
//
// Scroll progress through the section lights the words one by one, then the
// runway edge lights in pairs, then a plane touches down. Mouse only: the
// lines drift at different depths, lit words get a marker stroke on hover,
// and a white strobe runs along the runway lights.
// =====================================================================


// =========================================================
// Section 4: tagline. Scroll position lights the words one by one,
// then the runway lights run in pairs and a plane touches down.
// =========================================================
(() => {
  'use strict';
  const section = document.getElementById('section-4');
  const title = document.getElementById('tagline-title');
  const runway = document.getElementById('runway');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const SVG = 'http://www.w3.org/2000/svg';
  const el = (name, attrs, parent) => {
    const n = document.createElementNS(SVG, name);
    Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, v));
    parent.appendChild(n);
    return n;
  };

  // split each line into word spans (screen readers still read the sentence)
  title.setAttribute('aria-label', [...title.querySelectorAll('.tag-line')].map(l => l.textContent).join(' '));
  const words = [];
  title.querySelectorAll('.tag-line').forEach(line => {
    const parts = line.textContent.split(' ');
    line.textContent = '';
    parts.forEach((w, i) => {
      const s = document.createElement('span');
      s.className = 'tw' + (w === 'calm.' ? ' calm' : '');
      s.textContent = w;
      s.setAttribute('aria-hidden', 'true');
      line.appendChild(s);
      if (i < parts.length - 1) line.appendChild(document.createTextNode(' '));
      words.push(s);
    });
  });

  // runway: pairs of edge lights that get smaller towards the far end
  el('path', { class: 'centre', d: 'M320 158 L320 40' }, runway);
  const PAIRS = 9, pairs = [];
  for (let k = 0; k < PAIRS; k++) {
    const t = k / (PAIRS - 1), y = 150 - t * 110, spread = 150 - t * 120, r = 6 - t * 3.8;
    const g = el('g', {}, runway);
    [320 - spread, 320 + spread].forEach(x => {
      el('circle', { class: 'glow', cx: x, cy: y, r: r * 2.6 }, g);
      el('circle', { class: 'bulb', cx: x, cy: y, r }, g);
    });
    pairs.push(g);
  }
  const plane = el('path', {
    class: 'plane',
    d: 'M1 0 L0.8 0.09 L0.2 0.11 L-0.15 0.9 L-0.35 0.9 L-0.2 0.11 L-0.65 0.09 L-0.85 0.42 L-1 0.42 L-0.92 0 L-1 -0.42 L-0.85 -0.42 L-0.65 -0.09 L-0.2 -0.11 L-0.35 -0.9 L-0.15 -0.9 L0.2 -0.11 L0.8 -0.09 Z',
    'stroke-width': 0.12, opacity: 0
  }, runway);

  // Keep a number between 0 and 1.
  const clamp01 = v => Math.min(1, Math.max(0, v));
  // Ease-out curve: quick at first, gentle at the end (used for the landing).
  const ease = t => 1 - Math.pow(1 - t, 3);

  // p: 0 when the section pins, 1 when it lets go
  function render(p) {
    // words: 5% to 50% of the scroll
    const lit = Math.floor(clamp01((p - 0.05) / 0.45) * (words.length + 0.999));
    words.forEach((w, i) => w.classList.toggle('on', i < lit));
    // runway lights: 52% to 80%, from the near end to the far end
    const run = clamp01((p - 0.52) / 0.28);
    pairs.forEach((g, k) => g.classList.toggle('lit', run > 0 && k / (PAIRS - 1) <= run));
    // plane: comes in over the near end and touches down far along (60% to 95%)
    const land = ease(clamp01((p - 0.6) / 0.35));
    const y = 185 - land * 125, size = 34 - land * 20;
    plane.setAttribute('transform', `translate(320 ${y.toFixed(1)}) rotate(-90) scale(${size.toFixed(2)})`);
    plane.setAttribute('opacity', p > 0.6 ? Math.min(1, (p - 0.6) * 12).toFixed(2) : 0);
    plane.setAttribute('stroke-width', (2 / size).toFixed(3));
  }

  if (reduceMotion) { render(1); return; }           // everything shown, nothing moves

  // ---- hover (mouse only): depth drift and the runway "rabbit" ----
  const panel = section.querySelector('.tagline-panel');
  if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
    let rabbit = null, step = 0;
    // Mouse position across the panel, from -0.5 to 0.5, stored as CSS variables.
    // home.css uses --px and --py to shift each line by a different amount (depth).
    panel.addEventListener('pointermove', e => {
      const r = panel.getBoundingClientRect();
      panel.style.setProperty('--px', ((e.clientX - r.left) / r.width - 0.5).toFixed(3));   // -0.5 .. 0.5
      panel.style.setProperty('--py', ((e.clientY - r.top) / r.height - 0.5).toFixed(3));
    });
    // Mouse enters: start the runway strobe.
    panel.addEventListener('pointerenter', () => {
      // a strobe runs from the near end to the far end, over and over,
      // once the runway lights are on
      rabbit = setInterval(() => {
        pairs.forEach(g => g.classList.remove('flash'));
        if (!pairs[0].classList.contains('lit')) return;
        const k = step % (PAIRS + 4);                    // a short pause after each run
        if (k < PAIRS) pairs[k].classList.add('flash');
        step++;
      }, 90);
    });
    // Mouse leaves: stop the strobe and let the layers drift back to the centre.
    panel.addEventListener('pointerleave', () => {
      clearInterval(rabbit);
      pairs.forEach(g => g.classList.remove('flash'));
      panel.style.setProperty('--px', 0);
      panel.style.setProperty('--py', 0);
    });
  }
  let queued = false;
  // Work out how far the visitor has scrolled through the section (0 to 1) and redraw.
  function onScroll() {
    queued = false;
    const r = section.getBoundingClientRect(), vh = window.innerHeight;
    render(clamp01(-r.top / Math.max(1, r.height - vh)));
  }
  // Recalculate on scroll (once per screen refresh) and when the window resizes.
  window.addEventListener('scroll', () => { if (!queued) { queued = true; requestAnimationFrame(onScroll); } }, { passive: true });
  window.addEventListener('resize', onScroll);
  onScroll();
})();
