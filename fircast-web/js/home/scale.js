// =====================================================================
// FIRCast · js/home/scale.js
// Used on: index.html, section 2 ("the scale").
//
// 1. Scroll reveal: elements with .on-scroll fade and rise in once, when
//    they first come on screen (IntersectionObserver).
// 2. The big number counts up to 1,000,000 when it is visible, with every digit
//    the same width so the number does not wobble.
// 3. The live line: one flight every 31.6 s on average (seconds in a year divided
//    by about 1,000,000 movements); the ring fills in step with the count.
// =====================================================================


// =========================================================
// Section 2: the scale
// =========================================================
(() => {
  'use strict';
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- 1. Scroll reveal (runs once per element) ----------
  const revealer = new IntersectionObserver(entries => {
    for (const e of entries) {
      if (e.isIntersecting) {
        e.target.classList.add('is-visible');
        revealer.unobserve(e.target);
      }
    }
  }, { threshold: 0.2 });
  document.querySelectorAll('.on-scroll').forEach(el => revealer.observe(el));

  // ---------- 2. Count up to 1,000,000 when the number is on screen ----------
  const moves = document.getElementById('moves');
  const TARGET = 1000000;
  // 1000000 -> "1,000,000" (US-style thousands separators).
  const format = n => n.toLocaleString('en-US');

  // The display font's digits are different widths ("1" is narrow, "0" is wide), so the
  // number would wobble while counting. Measure the widest digit and put every
  // digit in a box that wide.
  function equalDigitWidth(el) {
    const probe = document.createElement('span');
    probe.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap';
    el.appendChild(probe);
    let widest = 0;
    for (const d of '0123456789') {
      probe.textContent = d;
      widest = Math.max(widest, probe.getBoundingClientRect().width);
    }
    probe.remove();
    el.style.setProperty('--dw', widest / parseFloat(getComputedStyle(el).fontSize) + 'em');
  }
  // Wrap every digit in <span class="dg"> so CSS can give all digits the same width.
  const boxed = s => s.replace(/\d/g, d => `<span class="dg">${d}</span>`);

  // Animate the number in `el` from 0 up to `target` over `ms` milliseconds.
  function countUp(el, target, ms) {
    equalDigitWidth(el);
    const start = performance.now();
    // One animation frame: work out how far through we are and show that value.
    function tick(now) {
      const t = Math.min(1, (now - start) / ms);
      const eased = 1 - Math.pow(1 - t, 3);          // fast start, slow finish
      if (t < 1) {
        el.innerHTML = boxed(format(Math.round(target * eased)));
        requestAnimationFrame(tick);
      } else {
        el.textContent = format(target) + '+';         // final: natural spacing
      }
    }
    requestAnimationFrame(tick);
  }

  if (!reduceMotion) {
    moves.textContent = '0';
    const counter = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) {
        countUp(moves, TARGET, 2000);
        counter.disconnect();                          // only count once
      }
    }, { threshold: 0.6 });
    counter.observe(moves);
  }

  // ---------- 3. Live estimate: movements since the page opened ----------
  // 2024 had 366 days = 31,622,400 seconds.
  // 31,622,400 s / 1,000,000 movements = about one every 31.6 seconds.
  // The count goes up by one every 31.6 s, the ring fills over the same
  // 31.6 s, and "next in" counts down, so the tile visibly ticks.
  const SECONDS_PER_MOVE = 31.6;
  const RING = 100.53;                                  // circumference of the ring (r = 16)
  const opened = performance.now();
  const since = document.getElementById('since');
  const nextIn = document.getElementById('since-next');
  const ringFill = document.querySelector('.scale .ring-fill');
  const stillRing = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let shown = 0;
  // Every frame: update the live count, the countdown text and the ring.
  function tickLive(now) {
    // Seconds since the page opened.
    const s = (now - opened) / 1000;
    const n = Math.floor(s / SECONDS_PER_MOVE);
    const part = (s % SECONDS_PER_MOVE) / SECONDS_PER_MOVE;   // 0..1 through the current interval
    if (!stillRing) ringFill.style.strokeDashoffset = (RING * (1 - part)).toFixed(2);
    if (n !== shown) {
      shown = n;
      since.textContent = n;
      since.classList.remove('bump'); void since.offsetWidth; since.classList.add('bump');
    }
    nextIn.textContent = `Next one in ${Math.ceil(SECONDS_PER_MOVE * (1 - part))} s`;
    requestAnimationFrame(tickLive);
  }
  requestAnimationFrame(tickLive);
})();
