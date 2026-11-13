// =====================================================================
// FIRCast · js/home/problem-timeline.js
// Used on: index.html, section 3 ("Busy now is too late").
//
// A canvas chart of one sector's workload over a day. The scroll position
// inside the section moves a time marker along the chart, and three story
// steps light up in turn. The workload curve is illustrative, not real data.
// =====================================================================


// =========================================================
// Section 3: the problem (scroll-driven timeline)
// =========================================================
(() => {
  'use strict';

  const section = document.getElementById('section-3');
  const canvas = document.getElementById('timeline');
  const ctx = canvas.getContext('2d');
  const stepText = document.getElementById('step-text');
  const dots = document.querySelectorAll('.step-dots i');

  const INK = '19, 35, 58';
  const ORANGE = '#DD110A';
  const CORN = '#FBF4DB';

  // ---------- 1. Made-up workload curve for one sector ----------
  // m = minutes after 13:00 (0 to 120). Returns workload 0 to 100.
  // Built from two S-curves: a rise that crosses the overload line
  // (70) at about 14:00, then a fall after 14:40.
  function workload(m) {
    const rise = 63 / (1 + Math.exp(-(m - 52) / 7));
    const fall = 40 / (1 + Math.exp(-(m - 100) / 8));
    return 22 + rise - fall;
  }
  const BUSY = 40, OVER = 70;          // band limits
  const WARN_AT = 30, PEAK_AT = 60;    // 13:30 forecast, 14:00 overload

  // ---------- 2. The three story steps ----------
  const STEPS = [
    '<b>13:00</b> Sector S6 is calm. Traffic is light.',
    '<b>13:30</b> FIRCast forecasts S6 will overload at 14:00 and suggests splitting it.',
    '<b>14:00</b> Traffic peaks, but the split is already in place. Without a forecast, this is when the problem would first show.'
  ];
  let currentStep = 0;

  // Highlight story step i (0, 1 or 2): its dot and text light up, the others dim.
  function setStep(i) {
    if (i === currentStep) return;
    currentStep = i;
    stepText.innerHTML = STEPS[i];
    stepText.classList.remove('swap');
    void stepText.offsetWidth;          // restart the CSS animation
    stepText.classList.add('swap');
    dots.forEach((d, k) => d.classList.toggle('on', k === i));
  }

  // ---------- 3. Canvas sizing ----------
  let W = 0, H = 0;
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    update();
  }

  // ---------- 4. Drawing ----------
  function draw(m) {
    const small = W < 500;
    const pad = { l: 8, r: 8, t: 36, b: 28 };
    // Helpers that turn data into canvas pixels:
    // x(minutes) -> horizontal position, y(workload 0-100) -> vertical position.
    const x = mm => pad.l + (mm / 120) * (W - pad.l - pad.r);
    const y = v => pad.t + (1 - v / 100) * (H - pad.t - pad.b);
    // Builds a canvas font string, e.g. "600 12px Manrope, ...".
    const font = (weight, size) => `${weight} ${size}px Manrope, system-ui, sans-serif`;

    ctx.clearRect(0, 0, W, H);

    // background bands: normal / busy / overloaded
    const bands = [
      [0, BUSY, 'rgba(132, 180, 230, 0.45)', 'Normal'],
      [BUSY, OVER, 'rgba(243, 198, 63, 0.45)', 'Busy'],
      [OVER, 100, 'rgba(221, 17, 10, 0.34)', 'Overloaded']
    ];
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.font = font(600, small ? 10 : 12);
    for (const [lo, hi, fill, label] of bands) {
      ctx.fillStyle = fill;
      ctx.fillRect(x(0), y(hi), x(120) - x(0), y(lo) - y(hi));
      ctx.fillStyle = `rgba(${INK}, 0.7)`;
      ctx.fillText(label, x(0) + 8, y(hi) + 6);
    }

    // time axis
    ctx.textAlign = 'center';
    ctx.font = font(500, small ? 10 : 12);
    for (let mm = 0; mm <= 120; mm += 30) {
      ctx.strokeStyle = `rgba(${INK}, 0.08)`;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x(mm), y(100)); ctx.lineTo(x(mm), y(0)); ctx.stroke();
      const h = 13 + Math.floor(mm / 60), min = mm % 60;
      ctx.fillStyle = `rgba(${INK}, 0.75)`;
      ctx.textAlign = mm === 0 ? 'left' : mm === 120 ? 'right' : 'center';
      ctx.fillText(`${h}:${String(min).padStart(2, '0')}`, x(mm), y(0) + 8);
    }

    // helper: draw the curve between two times
    function curve(from, to) {
      ctx.beginPath();
      for (let mm = from; mm <= to; mm += 0.5) {
        mm === from ? ctx.moveTo(x(mm), y(workload(mm))) : ctx.lineTo(x(mm), y(workload(mm)));
      }
      ctx.stroke();
    }

    // forecast: dashed line up to 60 minutes ahead, fades in from 13:30
    if (m >= WARN_AT) {
      const alpha = Math.min(1, (m - WARN_AT) / 4);
      ctx.save();
      ctx.setLineDash([6, 6]);
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = `rgba(${INK}, ${0.55 * alpha})`;
      curve(m, Math.min(120, m + 60));
      ctx.restore();

      // predicted overload point (hollow ring) until it actually happens
      if (m < PEAK_AT) {
        ctx.lineWidth = 3;
        ctx.strokeStyle = ORANGE;
        ctx.globalAlpha = alpha;
        ctx.beginPath(); ctx.arc(x(PEAK_AT), y(OVER), 7, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = `rgb(${INK})`;
        ctx.font = font(700, small ? 10 : 12);
        ctx.textAlign = 'left'; ctx.textBaseline = 'top';   // below and right: empty space
        ctx.fillText('Forecast: overload', x(PEAK_AT) + 12, y(OVER) + 8);
        ctx.globalAlpha = 1;
      }
    }

    // actual workload so far: solid line
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.strokeStyle = `rgb(${INK})`;
    curve(0, m);

    // overload reached (filled dot)
    if (m >= PEAK_AT) {
      ctx.fillStyle = ORANGE;
      ctx.strokeStyle = CORN; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x(PEAK_AT), y(workload(PEAK_AT)), 7, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();

      // "30 min to act" bracket between the warning and the overload
      const alpha = Math.min(1, (m - PEAK_AT) / 5);
      const by = y(6);
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = `rgb(${INK})`; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x(WARN_AT), by - 6); ctx.lineTo(x(WARN_AT), by);
      ctx.lineTo(x(PEAK_AT), by); ctx.lineTo(x(PEAK_AT), by - 6);
      ctx.stroke();
      ctx.fillStyle = `rgb(${INK})`;
      ctx.font = font(700, small ? 10 : 12);
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillText('30 min to act', (x(WARN_AT) + x(PEAK_AT)) / 2, by - 6);
      ctx.globalAlpha = 1;
    }

    // forecast moment marker (where the warning was issued)
    if (m >= WARN_AT) {
      ctx.fillStyle = `rgb(${INK})`;
      ctx.beginPath(); ctx.arc(x(WARN_AT), y(workload(WARN_AT)), 5, 0, Math.PI * 2); ctx.fill();
    }

    // "Now" playhead
    ctx.strokeStyle = `rgb(${INK})`; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x(m), y(100) - 4); ctx.lineTo(x(m), y(0)); ctx.stroke();

    const h = 13 + Math.floor(m / 60), min = Math.floor(m % 60);
    const label = `Now ${h}:${String(min).padStart(2, '0')}`;
    ctx.font = font(700, small ? 10 : 12);
    const tw = ctx.measureText(label).width + 16;
    const lx = Math.max(pad.l, Math.min(W - pad.r - tw, x(m) - tw / 2));  // keep pill on screen
    ctx.fillStyle = `rgb(${INK})`;
    ctx.beginPath(); ctx.roundRect(lx, 4, tw, 24, 12); ctx.fill();
    ctx.fillStyle = CORN;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(label, lx + 8, 16);
  }

  // ---------- 5. Scroll position -> time on the timeline ----------
  function update() {
    const rect = section.getBoundingClientRect();
    const scrollable = rect.height - window.innerHeight;
    const progress = Math.min(1, Math.max(0, -rect.top / scrollable)); // 0 at top, 1 at end
    const m = progress * 80;                                           // 13:00 to 14:20

    setStep(m < WARN_AT ? 0 : m < PEAK_AT ? 1 : 2);
    draw(m);
  }

  // One scroll listener, throttled with requestAnimationFrame
  let queued = false;
  window.addEventListener('scroll', () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; update(); });
  }, { passive: true });

  new ResizeObserver(resize).observe(canvas);
  resize();
})();
