// =====================================================================
// FIRCast · js/home/story-scene.js
// Used on: index.html (the animated background behind every section).
//
// Each <section> has data-story="start end" and data-theme="blue|corn".
// As you scroll, the script turns the scroll position into a single story
// time T (0 calm, 1 traffic builds, 2 tension rises, 3 forecast, 4 split)
// and draws that moment of the story on a fixed full-screen canvas.
// The background colour blends between powder blue and sweet corn to match
// the section on screen. Nothing moves if "reduce motion" is on.
// =====================================================================


// =========================================================
// Background story scene (plays as you scroll the page)
// =========================================================
// Each <section> has:
//   data-theme="blue" or "corn"  -> scene colours behind that section
//   data-story="start end"       -> story time while it is on screen
// Story time T:  0 calm | 1 traffic builds | 2 tension rises |
//                2.8 forecast appears | 3.65 overload, sector splits | 4.2+ calm
(() => {
  'use strict';

  const canvas = document.getElementById('scene');
  const ctx = canvas.getContext('2d');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- 1. Colours ----------
  const BLUE = [132, 180, 230], CORN = [251, 244, 219];
  const INK = [19, 35, 58], ORANGE = [221, 17, 10], PEACH = [238, 149, 131];
  // Blend two colours: mix(a, b, 0) is a, mix(a, b, 1) is b, 0.5 is half way.
  const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
  // [r, g, b] plus opacity -> a CSS colour string the canvas understands.
  const rgba = (c, a) => `rgba(${c[0] | 0}, ${c[1] | 0}, ${c[2] | 0}, ${a})`;

  // ---------- 2. Story curves ----------
  const clamp01 = v => Math.min(1, Math.max(0, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  // smooth 0 -> 1 as story time T goes from a to b
  const ramp = (T, a, b) => { const t = clamp01((T - a) / (b - a)); return t * t * (3 - 2 * t); };

  const DENSITY = [7, 16, 24, 26, 16, 10];   // planes on screen at T = 0..5
  function beats(T) {
    const i = Math.min(4, Math.floor(T));
    return {
      planes:   lerp(DENSITY[i], DENSITY[i + 1], T - i),
      tension:  ramp(T, 2.8, 3.5) * (1 - ramp(T, 3.85, 4.4)),  // builds 13:30 to 14:00, then eases
      forecast: ramp(T, 2.8, 3.0) * (1 - ramp(T, 3.95, 4.3)),  // 13:30 on the section 3 chart
      split:    ramp(T, 3.65, 4.0)                             // 14:00 on the section 3 chart
    };
  }

  // ---------- 3. Scene layout ----------
  // Ambient routes and sector edges use fractions of the whole screen.
  // The story itself (busy sector, split, converging pair, radar) uses
  // fractions of a "stage" box: the left part of the screen on wide
  // displays, where section 3's panel leaves room (see stageBox()).
  const FOCUS = [[0.00, 0.26], [0.62, 0.18], [1.00, 0.50], [0.70, 0.84], [0.00, 0.78]]; // the sector that overloads
  const SPLIT_A = [0.00, 0.52], SPLIT_B = [1.00, 0.50];                                  // where it gets cut
  const BOUNDARIES = [                                                                   // other sector edges
    [[0.48, 0.00], [0.55, 0.30], [0.80, 0.36], [1.00, 0.32]],
    [[0.55, 0.30], [0.50, 0.62], [0.72, 0.80], [1.00, 0.78]],
    [[0.50, 0.62], [0.42, 1.00]], [[0.72, 0.80], [0.80, 1.00]],
    [[0.80, 0.36], [0.86, 0.00]], [[0.80, 0.36], [0.72, 0.80]]
  ];
  const RADAR = [0.45, 0.48];                                                            // stage coordinates
  const ROUTES = [
    [[-0.05, 0.40], [1.05, 0.55]], [[0.10, -0.05], [0.55, 1.05]], [[1.05, 0.15], [-0.05, 0.65]],
    [[0.35, -0.05], [0.95, 1.05]], [[-0.05, 0.85], [1.05, 0.25]], [[0.65, -0.05], [0.25, 1.05]],
    [[-0.05, 0.15], [0.75, 1.05]], [[1.05, 0.85], [0.20, -0.05]], [[0.00, 0.55], [0.50, -0.05]],
    [[0.50, 1.05], [1.05, 0.35]]
  ];
  // Two flights on crossing paths inside the busy sector. Their position is
  // tied to the story, not the clock, so they always converge at the same
  // point in the scroll: A reaches the crossing at T = 3.65, B a little later.
  const CROSS = [0.45, 0.64];
  const PAIR = [{ start: [0.95, 0.08], arriveT: 3.65 }, { start: [0.00, 0.40], arriveT: 3.90 }];

  // ---------- 4. Canvas sizing ----------
  let W = 0, H = 0;
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);   // capped for smooth scrolling
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    stageBox();
  }
  // Scene points are stored as fractions of the screen (0-1); this turns them into pixels.
  const px = ([fx, fy]) => [fx * W, fy * H];

  // Stage box: on wide screens, the strip left of section 3's panel
  // (panel is 800px wide, pinned right). On narrow screens, the full width.
  let stageL = 0, stageR = 0;
  function stageBox() {
    if (W >= 1100) { stageL = 0.02 * W; stageR = Math.max(0.30 * W, W - 880); }
    else { stageL = 0.04 * W; stageR = 0.96 * W; }
  }
  const sp = ([fx, fy]) => [stageL + fx * (stageR - stageL), fy * H];   // stage -> pixels

  // ---------- 5. Reading the scroll position ----------
  const sections = [...document.querySelectorAll('[data-story]')];
  const themeOf = s => (s.dataset.theme === 'corn' ? 1 : 0);   // 0 = blue scene, 1 = cream scene

  function readScroll() {
    const vh = window.innerHeight, c = vh / 2;   // middle of the screen
    for (let i = 0; i < sections.length; i++) {
      const s = sections[i], r = s.getBoundingClientRect();
      const last = i === sections.length - 1;
      if (!(c >= r.top && c < r.bottom) && !(last && c >= r.bottom)) continue;

      // story time inside this section
      const [s0, s1] = s.dataset.story.split(' ').map(Number);
      let f;
      if (s.dataset.storyMode === 'sticky') f = -r.top / (r.height - vh);           // pinned: its own progress
      else if (last) f = (c - r.top) / Math.max(1, r.height - vh / 2);              // last: finish at page bottom
      else f = (c - r.top) / r.height;
      const T = lerp(s0, s1, clamp01(f));

      // colour theme, blended near the edge with the next / previous section
      const band = vh * 0.35;
      let k = themeOf(s);
      if (r.bottom - c < band && sections[i + 1]) {
        k = lerp(k, themeOf(sections[i + 1]), 0.5 * (1 - (r.bottom - c) / band));
      } else if (c - r.top < band && sections[i - 1]) {
        k = lerp(k, themeOf(sections[i - 1]), 0.5 * (1 - (c - r.top) / band));
      }
      return { T, k };
    }
    return { T: 0, k: 0 };
  }

  // ---------- 6. Ambient traffic ----------
  let planes = [];
  let spawnTimer = 0;
  // Add one background plane on a random route, flying either way.
  // `anywhere` starts it part-way along (used at load so the sky is not empty).
  function spawn(anywhere) {
    const r = ROUTES[Math.floor(Math.random() * ROUTES.length)];
    const fwd = Math.random() < 0.5;
    planes.push({
      a: fwd ? r[0] : r[1], b: fwd ? r[1] : r[0],
      s: anywhere ? Math.random() : 0,               // progress along the route, 0 to 1
      v: (1 / 45) * (0.75 + Math.random() * 0.5),    // crosses the screen in about 45 s
      fade: anywhere ? 1 : 0, leaving: false,
      trail: [], trailTimer: 0
    });
  }

  // Move every background plane and keep their number close to `target`,
  // which rises and falls with the story (more traffic = more planes).
  function updatePlanes(dt, target) {
    target = Math.round(target);
    // too few: add planes (all at once if motion is reduced)
    if (reduceMotion) { while (planes.length < target) spawn(true); }
    else {
      spawnTimer -= dt;
      if (planes.length < target && spawnTimer <= 0) {
        spawn(true);                     // a new blip appears somewhere on its route...
        planes[planes.length - 1].fade = 0;   // ...and fades in, like a radar contact
        spawnTimer = 0.15 + Math.random() * 0.25;
      }
    }
    // too many: fade out the oldest ones
    let excess = planes.filter(p => !p.leaving).length - target;
    for (const p of planes) { if (excess <= 0) break; if (!p.leaving) { p.leaving = true; excess--; } }

    for (const p of planes) {
      p.s += p.v * dt;
      p.fade = clamp01(p.fade + (p.leaving ? -dt : dt) * (reduceMotion ? 99 : 0.7));
      p.trailTimer -= dt;
      if (p.trailTimer <= 0) {
        p.trail.push([lerp(p.a[0], p.b[0], p.s), lerp(p.a[1], p.b[1], p.s)]);
        if (p.trail.length > 4) p.trail.shift();
        p.trailTimer = 0.5;
      }
    }
    planes = planes.filter(p => p.s < 1 && !(p.leaving && (p.fade <= 0 || reduceMotion)));
  }

  // ---------- 7. Drawing helpers ----------
  const PLANE_HALF = [[1, 0], [0.8, 0.09], [0.2, 0.11], [-0.15, 0.9], [-0.35, 0.9],
                      [-0.2, 0.11], [-0.65, 0.09], [-0.85, 0.42], [-1, 0.42], [-0.92, 0]];
  const PLANE = new Path2D();
  [...PLANE_HALF, ...PLANE_HALF.slice(1, -1).reverse().map(([x, y]) => [x, -y])]
    .forEach(([x, y], i) => (i ? PLANE.lineTo(x, y) : PLANE.moveTo(x, y)));
  PLANE.closePath();

  // Draw the plane icon at (x, y), pointing along `heading` (radians).
  function drawPlane(x, y, heading, size, alpha) {
    ctx.save();
    ctx.translate(x, y); ctx.rotate(heading); ctx.scale(size, size);
    ctx.fillStyle = rgba(INK, alpha);
    ctx.fill(PLANE);
    ctx.restore();
  }
  // Trace a closed shape through `points`, after `map` turns each into pixels.
  function poly(points, map) {
    ctx.beginPath();
    points.forEach((p, i) => { const [x, y] = map(p); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.closePath();
  }
  // Direction from point a to point b on screen, in radians (for pointing planes).
  const heading = (a, b) => Math.atan2((b[1] - a[1]) * H, (b[0] - a[0]) * W);
  // The same, for points inside the left "stage" box used on wide screens.
  const stageHeading = (a, b) => { const [ax, ay] = sp(a), [bx, by] = sp(b); return Math.atan2(by - ay, bx - ax); };

  // small dark label drawn on the scene ("Overload forecast · 14:00")
  function chip(text, x, y, alpha) {
    if (alpha <= 0.01) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = '600 12px Manrope, system-ui, sans-serif';
    const w = ctx.measureText(text).width + 20;
    ctx.fillStyle = rgba(INK, 0.92);
    ctx.beginPath(); ctx.roundRect(x - w / 2, y - 14, w, 28, 14); ctx.fill();
    ctx.fillStyle = rgba(CORN, 1);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y + 0.5);
    ctx.restore();
  }
  const TAU = Math.PI * 2;

  // ---------- 8. Draw one frame ----------
  let clock = 0;
  function draw(T, k) {
    const B = beats(T);
    const bg = mix(BLUE, CORN, k);
    const line = mix(CORN, BLUE, k);              // cream lines on blue, blue lines on cream
    const unit = Math.min(W, H);
    const planeSize = W < 640 ? 7 : 9;

    ctx.fillStyle = rgba(bg, 1);
    ctx.fillRect(0, 0, W, H);

    // radar: range rings, cross hairs, and the rotating sweep
    const [rx, ry] = sp(RADAR);
    const R = 0.16 * Math.max(W, H);
    ctx.lineWidth = 1;
    ctx.strokeStyle = rgba(line, 0.45);
    for (let n = 1; n <= 6; n++) { ctx.beginPath(); ctx.arc(rx, ry, R * n, 0, TAU); ctx.stroke(); }
    ctx.strokeStyle = rgba(line, 0.25);
    ctx.beginPath(); ctx.moveTo(rx - 6 * R, ry); ctx.lineTo(rx + 6 * R, ry);
    ctx.moveTo(rx, ry - 6 * R); ctx.lineTo(rx, ry + 6 * R); ctx.stroke();

    const sweep = clock * 0.6;                     // one turn about every 10 s
    for (let n = 0; n < 14; n++) {                 // fading wedge behind the sweep line
      ctx.beginPath(); ctx.moveTo(rx, ry);
      ctx.arc(rx, ry, R * 6, sweep - (n + 1) * 0.05, sweep - n * 0.05);
      ctx.closePath();
      ctx.fillStyle = rgba(line, 0.24 * (1 - n / 14));
      ctx.fill();
    }
    ctx.strokeStyle = rgba(line, 0.75); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(rx, ry);
    ctx.lineTo(rx + Math.cos(sweep) * R * 6, ry + Math.sin(sweep) * R * 6); ctx.stroke();

    // sector edges
    ctx.strokeStyle = rgba(line, 0.55); ctx.lineWidth = 1.25;
    for (const b of BOUNDARIES) {
      ctx.beginPath();
      b.forEach((p, i) => { const [x, y] = px(p); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.stroke();
    }

    // the busy sector: glows orange as it overloads, then gets split in two
    const overload = B.tension * (1 - B.split);
    poly(FOCUS, sp);
    ctx.fillStyle = rgba(ORANGE, 0.3 * overload); ctx.fill();
    ctx.strokeStyle = overload > 0.02 ? rgba(mix(line, ORANGE, overload), 0.55 + 0.35 * overload)
                                      : rgba(line, 0.55);
    ctx.lineWidth = 1.25 + 1.5 * overload; ctx.stroke();

    if (B.split > 0) {
      const [ax, ay] = sp(SPLIT_A), [bx, by] = sp(SPLIT_B);
      ctx.strokeStyle = rgba(INK, 0.8); ctx.lineWidth = 3; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(ax, ay);
      ctx.lineTo(lerp(ax, bx, B.split), lerp(ay, by, B.split));   // the cut draws itself
      ctx.stroke(); ctx.lineCap = 'butt';
    }

    // routes
    ctx.save(); ctx.setLineDash([3, 7]);
    ctx.strokeStyle = rgba(line, 0.35); ctx.lineWidth = 1;
    for (const [a, b] of ROUTES) {
      const [ax, ay] = px(a), [bx, by] = px(b);
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    }
    ctx.restore();

    // ambient planes: brighter just after the radar sweep passes them
    for (const p of planes) {
      const [x, y] = px([lerp(p.a[0], p.b[0], p.s), lerp(p.a[1], p.b[1], p.s)]);
      // How long ago (as an angle) the radar sweep passed this plane: planes glow
      // brightly right after the sweep passes, then fade until the next pass.
      const since = ((sweep - Math.atan2(y - ry, x - rx)) % TAU + TAU) % TAU;
      const glow = Math.exp(-since * 1.3);
      const alpha = p.fade * (0.5 + 0.5 * glow);
      p.trail.forEach((t, i) => {
        const [tx, ty] = px(t);
        ctx.fillStyle = rgba(INK, alpha * (0.1 + i * 0.07));
        ctx.beginPath(); ctx.arc(tx, ty, 1.3, 0, TAU); ctx.fill();
      });
      // forecast: dashed line showing where planes in the busy sector are heading
      if (B.forecast > 0 && x > stageL && x < stageR) {
        const h = heading(p.a, p.b), L = B.forecast * 0.12 * unit;
        ctx.save(); ctx.setLineDash([4, 5]);
        ctx.strokeStyle = rgba(INK, 0.35 * B.forecast * p.fade); ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(h) * L, y + Math.sin(h) * L); ctx.stroke();
        ctx.restore();
      }
      drawPlane(x, y, heading(p.a, p.b), planeSize, alpha);
    }

    // the converging pair
    const visible = ramp(T, 1.6, 2.0) * (1 - ramp(T, 4.6, 4.95));
    if (visible > 0) {
      const alert = B.tension * (1 - B.split) * visible;
      const pos = PAIR.map(f => {
        const s = (T - (f.arriveT - 2.2)) / 2.2;      // 1 = at the crossing point
        return [lerp(f.start[0], CROSS[0], s), lerp(f.start[1], CROSS[1], s)];
      });
      const [cx, cy] = sp(CROSS);

      // forecast: both paths projected to the crossing, with a predicted conflict mark
      if (B.forecast > 0) {
        ctx.save(); ctx.setLineDash([6, 6]); ctx.lineWidth = 2;
        ctx.strokeStyle = rgba(INK, 0.5 * B.forecast * visible);
        pos.forEach(p => { const [x, y] = sp(p); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(cx, cy); ctx.stroke(); });
        ctx.strokeStyle = rgba(ORANGE, 0.9 * B.forecast * (1 - B.split) * visible);
        ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(cx, cy, 0.035 * unit, 0, TAU); ctx.stroke();
        ctx.restore();
      }

      // warning: dashed link between the two and pulsing rings around each
      if (alert > 0.01) {
        const [ax, ay] = sp(pos[0]), [bx, by] = sp(pos[1]);
        ctx.save(); ctx.setLineDash([2, 5]);
        ctx.strokeStyle = rgba(ORANGE, 0.8 * alert); ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
        ctx.restore();
        const pulse = reduceMotion ? 0 : Math.sin(clock * 4) * 0.5 + 0.5;
        pos.forEach(p => {
          const [x, y] = sp(p);
          ctx.strokeStyle = rgba(mix(PEACH, ORANGE, B.tension), alert * (0.9 - 0.4 * pulse));
          ctx.lineWidth = 2.5;
          ctx.beginPath(); ctx.arc(x, y, 18 + 8 * pulse, 0, TAU); ctx.stroke();
        });
      }
      // after the split: a calm ring shows the pair is being handled
      const managed = B.split * (1 - ramp(T, 4.3, 4.6)) * visible;
      if (managed > 0.01) {
        pos.forEach(p => {
          const [x, y] = sp(p);
          ctx.strokeStyle = rgba(INK, 0.35 * managed); ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.arc(x, y, 18, 0, TAU); ctx.stroke();
        });
      }
      PAIR.forEach((f, i) => {
        const [x, y] = sp(pos[i]);
        drawPlane(x, y, stageHeading(f.start, CROSS), planeSize * 1.4, visible);
      });
    }

    // on-scene labels that tell the story without reading the panels
    const [lx, ly] = sp([0.5, 0.13]);
    chip('Overload forecast · 14:00', lx, ly, B.forecast * (1 - B.split));
    const [sx2, sy2] = sp([0.5, 0.43]);
    chip('Sector split · +1 controller', sx2, sy2, B.split * (1 - ramp(T, 4.4, 4.7)));

    // vignette: edges darken as tension rises
    const vg = ctx.createRadialGradient(W / 2, H / 2, unit * 0.35, W / 2, H / 2, Math.hypot(W, H) * 0.6);
    vg.addColorStop(0, rgba(INK, 0));
    vg.addColorStop(1, rgba(INK, 0.05 + 0.2 * B.tension));
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);
  }

  // ---------- 9. Animation loop ----------
  resize();
  let { T: shownT, k: shownK } = readScroll();
  for (let n = 0; n < beats(shownT).planes; n++) spawn(true);   // start with traffic already flying

  let last = performance.now();
  // Animation loop: advance the planes, read the story time from the scroll
  // position and draw the scene for that moment.
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const { T, k } = readScroll();
    // ease toward the scroll position so fast scrolling still looks smooth
    const ease = Math.min(1, dt * 6);
    shownT += (T - shownT) * ease;
    shownK += (k - shownK) * ease;
    clock += dt;
    updatePlanes(dt, beats(shownT).planes);
    draw(shownT, shownK);
    requestAnimationFrame(frame);
  }

  function still() {                               // reduced motion: redraw only on scroll
    const { T, k } = readScroll();
    updatePlanes(0, beats(T).planes);
    draw(T, k);
  }

  // Resize: refit the canvas. With reduced motion, redraw the still picture.
  window.addEventListener('resize', () => { resize(); if (reduceMotion) still(); });
  if (reduceMotion) {
    let queued = false;
    // Reduced motion: no animation loop, so redraw the still scene when the page scrolls.
    window.addEventListener('scroll', () => {
      if (queued) return; queued = true;
      requestAnimationFrame(() => { queued = false; still(); });
    }, { passive: true });
    still();
  } else {
    requestAnimationFrame(frame);
  }
})();
