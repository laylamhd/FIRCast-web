// =====================================================================
// FIRCast · js/map/radar-background.js
// Used on: map.html (the faint radar behind the page).
//
// Range rings and bearing ticks are drawn once to an off-screen canvas, then
// each frame copies them and adds the sweep (a fading 60° wedge drawn as thin
// slices) and a few echoes that light up as the sweep passes them.
// With "reduce motion" on, only the still rings are drawn.
// =====================================================================


(() => {
  'use strict';
  const cv = document.getElementById('radar');
  const ctx = cv.getContext('2d');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const INK = '19, 35, 58';
  const PERIOD = 9;                        // seconds for one full sweep
  const TRAIL = Math.PI / 3;               // the fading wedge behind the sweep line (60°)
  let W = 0, H = 0, cx = 0, cy = 0, R = 0, dpr = 1;
  let rings = null;                        // rings are drawn once, then copied each frame
  let blips = [];

  // Size the canvas to the window (sharp on high-density screens) and draw the
  // still parts (rings, cross lines, ticks) once into an off-screen canvas.
  function setup() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    cx = W / 2; cy = H * 0.55;
    R = Math.hypot(Math.max(cx, W - cx), Math.max(cy, H - cy));

    // static layer: range rings, cross lines and bearing ticks
    rings = document.createElement('canvas');
    rings.width = cv.width; rings.height = cv.height;
    const r = rings.getContext('2d');
    r.setTransform(dpr, 0, 0, dpr, 0, 0);
    r.strokeStyle = `rgba(${INK}, 0.11)`; r.lineWidth = 1;
    const gap = Math.max(90, Math.min(W, H) / 6);
    for (let d = gap; d < R; d += gap) { r.beginPath(); r.arc(cx, cy, d, 0, Math.PI * 2); r.stroke(); }
    r.beginPath();
    r.moveTo(cx - R, cy); r.lineTo(cx + R, cy); r.moveTo(cx, cy - R); r.lineTo(cx, cy + R);
    r.stroke();
    for (let deg = 0; deg < 360; deg += 10) {                  // small ticks every 10°, longer every 30°
      const a = (deg * Math.PI) / 180, d = gap * 3, len = deg % 30 ? 6 : 14;
      r.beginPath();
      r.moveTo(cx + Math.cos(a) * d, cy + Math.sin(a) * d);
      r.lineTo(cx + Math.cos(a) * (d + len), cy + Math.sin(a) * (d + len));
      r.stroke();
    }

    // a few faint echoes that light up as the sweep passes them
    blips = Array.from({ length: 22 }, () => {
      const a = Math.random() * Math.PI * 2, d = gap * (0.6 + Math.random() * 5);
      return { a, x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d };
    });
  }

  // Draw one frame: copy the still rings, then add the sweep and the echoes.
  function draw(seconds) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.drawImage(rings, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (reduceMotion) return;                                  // still rings only

    const sweep = ((seconds / PERIOD) % 1) * Math.PI * 2;      // angle of the sweep line
    // fading wedge behind the line (drawn as thin slices, so no special support is needed)
    const slices = 40;
    for (let i = 0; i < slices; i++) {
      const a1 = sweep - (TRAIL * i) / slices, a0 = sweep - (TRAIL * (i + 1)) / slices;
      ctx.fillStyle = `rgba(${INK}, ${0.09 * (1 - i / slices) ** 2})`;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, R, a0, a1); ctx.closePath(); ctx.fill();
    }
    ctx.strokeStyle = `rgba(${INK}, 0.16)`; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(sweep) * R, cy + Math.sin(sweep) * R); ctx.stroke();

    blips.forEach(b => {
      const since = (((sweep - b.a) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);   // how long ago the sweep passed
      const age = (since / (Math.PI * 2)) * PERIOD;
      const alpha = 0.32 * Math.exp(-age / 2.2);
      if (alpha < 0.01) return;
      ctx.fillStyle = `rgba(${INK}, ${alpha})`;
      ctx.beginPath(); ctx.arc(b.x, b.y, 2.5, 0, Math.PI * 2); ctx.fill();
    });
  }

  // Animation loop: draw, then ask the browser for the next frame (unless motion is reduced).
  function frame(ms) { draw(ms / 1000); if (!reduceMotion) requestAnimationFrame(frame); }
  // When the window changes size, rebuild the rings to fit.
  window.addEventListener('resize', () => { setup(); if (reduceMotion) draw(0); });
  setup();
  requestAnimationFrame(frame);
})();
