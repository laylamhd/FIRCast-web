// =====================================================================
// FIRCast · js/home/hero-map.js
// Used on: index.html (the live map card under the hero).
// Needs (load first): data/airspace.js (AIRSPACE_DATA), data/land-home.js (LAND_HOME).
//
// A small, fixed snapshot of the UAE with simulated traffic:
//   - classes: Sector (an area that counts its aircraft and changes colour),
//     Route (a path through map space), Aircraft (one simulated flight),
//     Airspace (owns everything and runs one simulation step);
//   - drawing on a <canvas> every frame (requestAnimationFrame);
//   - the depth / radar-lens effect under the mouse;
//   - hover tooltips, the sortable sector table, the Map/Table switch,
//     the UTC / local clock and the speed slider.
// Colours: sectors fade between blue (normal), butter yellow (busy) and
// orange-red (overloaded); the same values as the CSS tokens in base.css.
// =====================================================================


// =========================================================
// Hero: live airspace map and sector table
// The simulation is built from classes: Sector, Route, Aircraft and
// Airspace (which runs everything). The map and the table both read
// from the same Airspace object, so they always agree.
// =========================================================
(() => {
  'use strict';

  // ---------- 1. Setup ----------
  const canvas = document.getElementById('airspace');
  const ctx = canvas.getContext('2d');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // "Map space": longitude and latitude turned into flat units (100 per
  // degree of latitude), then scaled to fit the canvas. The card shows a
  // fixed snapshot of the UAE and its neighbours; the full map is on map.html.
  const K = Math.cos((24.6 * Math.PI) / 180);       // keeps shapes in proportion at 24.6°N
  const BOX = { west: 49.6, east: 58.8, north: 26.95, south: 22.05 };
  const toMap = ([lon, lat]) => [(lon - BOX.west) * K * 100, (BOX.north - lat) * 100];
  const VIEW = { x: 0, y: 0, w: (BOX.east - BOX.west) * K * 100, h: (BOX.north - BOX.south) * 100 };

  const LEVEL_NAMES = ['Normal', 'Busy', 'Overloaded'];
  const LEVEL_RGB = [
    [132, 180, 230], // 0 normal      Powder Blue  #84B4E6
    [243, 198, 63],  // 1 busy        butter yellow #F3C63F
    [221, 17, 10]    // 2 overloaded  Spicy Orange #DD110A
  ];
  const INK = '19, 35, 58';         // #13233A as "r, g, b"
  const CORN = '#FBF4DB';           // Sweet Corn

  // ---------- 2. Classes ----------
  class Sector {
    constructor(id, poly) {
      this.id = id;
      this.poly = poly;                                                  // corners: [[x, y], ...]
      this.cx = poly.reduce((sum, p) => sum + p[0], 0) / poly.length;   // label position
      this.cy = poly.reduce((sum, p) => sum + p[1], 0) / poly.length;
      this.count = 0;                     // aircraft inside right now
      this.level = 0;                     // 0 normal, 1 busy, 2 overloaded
      this.rgb = [...LEVEL_RGB[0]];       // colour currently shown on the map
      this.history = [];                  // aircraft count, sampled once a second
    }

    // Ray casting: is the point (x, y) inside this sector?
    contains(x, y) {
      let hit = false;
      for (let i = 0, j = this.poly.length - 1; i < this.poly.length; j = i++) {
        const [xi, yi] = this.poly[i], [xj, yj] = this.poly[j];
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
      }
      return hit;
    }

    // Busy level with "hysteresis": it takes more aircraft to go UP a level
    // than to come back DOWN, so colours don't flicker around a threshold.
    updateLevel() {
      const c = this.count;
      if (this.level === 0 && c >= 3) this.level = 1;
      else if (this.level === 1 && c >= 5) this.level = 2;
      else if (this.level === 2 && c <= 3) this.level = 1;
      else if (this.level === 1 && c <= 1) this.level = 0;
    }

    // Fade the map colour toward this level's colour (about half a second,
    // kept quick because the halfway mix of blue and orange looks muddy).
    fadeColour(dt) {
      const target = LEVEL_RGB[this.level];
      const k = Math.min(1, dt * 5);
      this.rgb = this.rgb.map((v, i) => v + (target[i] - v) * k);
    }

    record() {                             // called once a second
      this.history.push(this.count);
      if (this.history.length > 11) this.history.shift();   // keep the last 10 seconds
    }

    get status() { return LEVEL_NAMES[this.level]; }

    // Compared with 10 seconds ago: 1 rising, -1 falling, 0 steady
    get trend() {
      return this.history.length < 2 ? 0 : Math.sign(this.count - this.history[0]);
    }
  }

  // A flight's path in map space, and how far along each point is.
  class Route {
    constructor(pts) {
      this.pts = pts;
      this.cum = [0];
      for (let i = 1; i < pts.length; i++) {
        this.cum.push(this.cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
      }
      this.len = this.cum[this.cum.length - 1];
    }

    // point and direction at distance d along the path
    at(d) {
      let i = 0;
      while (i < this.cum.length - 2 && this.cum[i + 1] < d) i++;
      const [a, b] = [this.pts[i], this.pts[i + 1]];
      const t = Math.min(1, Math.max(0, (d - this.cum[i]) / ((this.cum[i + 1] - this.cum[i]) || 1)));
      return { x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t, dx: b[0] - a[0], dy: b[1] - a[1] };
    }
  }

  // a point `units` beyond b, continuing the line from a to b
  function beyond(a, b, units) {
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [b[0] + ((b[0] - a[0]) * units) / d, b[1] + ((b[1] - a[1]) * units) / d];
  }
  const NM_PER_UNIT = 0.6;                           // 100 map units = 1° of latitude = 60 NM

  class Aircraft {
    static count = 0;                                // used to give each flight a callsign

    // plan: { k: 'o' overflight | 'a' arrival | 'd' departure, p: [fixes], ap, top }
    // Flights start 30 NM outside the FIR so they fly in; arrivals end at the
    // airport and departures start there.
    constructor(plan) {
      this.kind = plan.k;
      const pts = plan.p.map(n => toMap(AIRSPACE.waypoints[n]));
      if (plan.k === 'a') pts.push(toMap(AIRSPACE.airports[plan.ap]));
      if (plan.k === 'd') pts.unshift(toMap(AIRSPACE.airports[plan.ap]));
      if (plan.k !== 'd') pts.unshift(beyond(pts[1], pts[0], 50));
      if (plan.k !== 'a') pts.push(beyond(pts[pts.length - 2], pts[pts.length - 1], 50));
      this.route = new Route(pts);
      this.len = this.route.len;
      this.dist = 0;
      this.cruiseGs = 440 + Math.random() * 50;
      const top = Math.floor(plan.top / 1000) * 10;
      this.cruise = Math.min(top, (plan.k === 'o' ? 300 : 320) + 10 * Math.floor(Math.random() * 9));
      this.trail = [];
      this.trailTimer = 0;
      this.place();

      // Simulated flight data for the hover label (not real flights).
      // "FC" is a made-up prefix so no real airline appears.
      Aircraft.count++;
      this.callsign = 'FC' + (100 + ((Aircraft.count * 37) % 900));
    }

    // altitude from distance: about 3 NM per 1,000 ft descending, 3.3 climbing
    levelAt(d) {
      const nm = d * NM_PER_UNIT, toGo = (this.len - d) * NM_PER_UNIT;
      if (this.kind === 'a') return Math.max(0, Math.min(this.cruise, (toGo * 10) / 3));
      if (this.kind === 'd') return Math.min(this.cruise, (nm * 10) / 3.3);
      return this.cruise;
    }
    get flightLevel() { return this.levelAt(this.dist); }
    get vertical() { return Math.sign(Math.round(this.levelAt(this.dist + 3) - this.flightLevel)); }

    // 250 kt below FL100, building to cruising speed by FL300
    get groundSpeed() {
      const f = this.flightLevel;
      return Math.round(f <= 100 ? 250 : 250 + (this.cruiseGs - 250) * Math.min(1, (f - 100) / 200));
    }
    get speed() { return (this.groundSpeed / 460) * 30; }   // map units per second on screen

    place() {
      const p = this.route.at(this.dist);
      this.x = p.x; this.y = p.y;
      this.heading = Math.atan2(p.dy, p.dx);
    }

    // aviation heading: degrees clockwise from north (map y points down = south)
    get headingDeg() {
      const deg = (Math.atan2(Math.cos(this.heading), -Math.sin(this.heading)) * 180) / Math.PI;
      return Math.round((deg + 360) % 360);
    }

    // e.g. "FL350 ↑"
    get levelText() {
      const arrow = this.vertical === 1 ? ' ↑' : this.vertical === -1 ? ' ↓' : '';
      return 'FL' + String(Math.round(this.flightLevel)).padStart(3, '0') + arrow;
    }

    // fades in at the start, and out as an arrival lands
    get alpha() {
      const toGo = this.len - this.dist;
      return Math.min(1, this.dist / 20, this.kind === 'a' ? toGo / 12 : 1);
    }

    // Move the aircraft forward for dt seconds and drop a trail dot every 0.35 s.
    update(dt) {
      this.dist += this.speed * dt;
      this.place();
      this.trailTimer -= dt;
      if (this.trailTimer <= 0) {
        this.trail.push([this.x, this.y]);
        if (this.trail.length > 5) this.trail.shift();
        this.trailTimer = 0.35;
      }
    }

    get arrived() { return this.dist >= this.len; }
  }

  // Airspace: owns all sectors and aircraft, starts new flights and runs one
  // simulation step at a time. The map, the table and the tooltips all read from it.
  class Airspace {
    // sectors: Sector objects; plans: flight plans from data/airspace.js.
    constructor(sectors, plans) {
      this.sectors = sectors;
      this.plans = plans;
      this.aircraft = [];
      this.time = 0;
      this.timer = 0;
    }

    // Traffic rises and falls over about a minute, so sectors fill and empty.
    demand() { return 0.6 + 0.8 * (0.5 + 0.5 * Math.sin((this.time / 55) * Math.PI * 2)); }

    // about 45% overflights, 30% arrivals, 25% departures; busier airports more often
    pickPlan() {
      const r = Math.random(), k = r < 0.45 ? 'o' : r < 0.75 ? 'a' : 'd';
      const list = this.plans.filter(p => p.k === k);
      let x = Math.random() * list.reduce((s, p) => s + p.wt, 0);
      return list.find(p => (x -= p.wt) < 0) || list[0];
    }

    // One simulation step of dt seconds: maybe start a flight, move every aircraft,
    // remove finished ones, then recount each sector and update its colour.
    update(dt) {
      this.time += dt;

      // a new flight starts now and then, more often when demand is high
      this.timer -= dt;
      if (this.timer <= 0) {
        this.aircraft.push(new Aircraft(this.pickPlan()));
        this.timer = (0.55 / this.demand()) * (0.6 + Math.random() * 0.8);
      }

      // move everyone, then drop aircraft that have left the map
      this.aircraft.forEach(ac => ac.update(dt));
      this.aircraft = this.aircraft.filter(ac => !ac.arrived);

      // count aircraft in each sector and update its busy level
      this.sectors.forEach(s => {
        s.count = this.aircraft.filter(ac => s.contains(ac.x, ac.y)).length;
        s.updateLevel();
        s.fadeColour(dt);
      });
    }

    recordHistory() { this.sectors.forEach(s => s.record()); }

    sectorAt(x, y) { return this.sectors.find(s => s.contains(x, y)) || null; }

    // Which sector will this aircraft enter next? Step forward along its
    // route until the sector changes. null means it leaves the map.
    nextSector(ac) {
      const here = this.sectorAt(ac.x, ac.y);
      for (let d = ac.dist + 5; d < ac.len; d += 5) {
        const p = ac.route.at(d);
        const s = this.sectorAt(p.x, p.y);
        if (s !== here) return s;
      }
      return null;
    }

    // the aircraft nearest to (x, y) within a radius, if any
    aircraftNear(x, y, radius) {
      let best = null, bestDist = radius;
      this.aircraft.forEach(ac => {
        const d = Math.hypot(ac.x - x, ac.y - y);
        if (d < bestDist) { best = ac; bestDist = d; }
      });
      return best;
    }
  }

  // ---------- 3. Airspace ----------
  // FIR outline, ATS routes and their points: UAE eAIP, AIRAC AMDT 09/2026
  // (effective 03 SEP 2026), ENR 2.1 / 3.2 / 4.4. The seven sectors are
  // placeholders (the FIR split into seven areas), not the real sectorisation.
  // Land: Natural Earth (public domain), cropped and simplified.
  const AIRSPACE = AIRSPACE_DATA;   // from data/airspace.js
  const LAND = LAND_HOME;           // from data/land-home.js

  // Flights follow plans worked out from the eAIP route network: one-way
  // routes are flown the allowed way only, with no sharp turns.
  const airspace = new Airspace(
    Object.entries(AIRSPACE.sectors).map(([id, poly]) => new Sector(id, poly.map(toMap))),
    AIRSPACE.plans
  );
  const FIR = AIRSPACE.fir.map(toMap);
  const ALL_ROUTES = AIRSPACE.routes.map(r => r.fixes.map(n => toMap(AIRSPACE.waypoints[n])));
  const WAYPOINT_PTS = Object.values(AIRSPACE.waypoints).map(toMap);
  const LAND_RINGS = LAND.map(ring => ring.map(toMap));
  const COUNTRY_LABELS = [['Qatar', 51.2, 25.3], ['Oman', 57.4, 22.4], ['Saudi Arabia', 50.6, 22.4], ['Iran', 55.0, 27.25]]
    .map(([name, lon, lat]) => [name, ...toMap([lon, lat])]);

  // ---------- 4. Drawing the map ----------
  let view = { scale: 1, ox: 0, oy: 0 };
  let hovered = null;                         // sector under the mouse, if any
  let hoveredPlane = null;                    // aircraft under the mouse, if any

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;                     // hidden while the Table view is open
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // fit the visible part of the map inside the canvas, centred
    const scale = Math.min(w / VIEW.w, h / VIEW.h);
    view = {
      scale,
      ox: (w - VIEW.w * scale) / 2 - VIEW.x * scale,
      oy: (h - VIEW.h * scale) / 2 - VIEW.y * scale
    };
    draw();
  }

  const sx = x => view.ox + x * view.scale;   // map space -> canvas pixels
  const sy = y => view.oy + y * view.scale;

  // Plane icon seen from above, nose pointing right (+x). Only the right
  // half is listed; the left half is the mirror image (y -> -y).
  const PLANE_HALF = [
    [1.00, 0.00], [0.80, 0.09], [0.20, 0.11], [-0.15, 0.90], [-0.35, 0.90],
    [-0.20, 0.11], [-0.65, 0.09], [-0.85, 0.42], [-1.00, 0.42], [-0.92, 0.00]
  ];
  const PLANE_SHAPE = new Path2D();
  [...PLANE_HALF, ...PLANE_HALF.slice(1, -1).reverse().map(([x, y]) => [x, -y])]
    .forEach(([x, y], i) => (i ? PLANE_SHAPE.lineTo(x, y) : PLANE_SHAPE.moveTo(x, y)));
  PLANE_SHAPE.closePath();

  // Draw the plane icon at canvas point (x, y), rotated to `heading` (radians)
  // and scaled to `size` pixels, with a thin cream outline so it shows on any colour.
  function drawPlane(x, y, heading, size) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(heading);
    ctx.scale(size, size);
    ctx.lineWidth = 2 / size;              // 2px outline whatever the size
    ctx.lineJoin = 'round';
    ctx.strokeStyle = CORN;                // thin cream edge keeps it visible on orange
    ctx.stroke(PLANE_SHAPE);
    ctx.fillStyle = `rgb(${INK})`;
    ctx.fill(PLANE_SHAPE);
    ctx.restore();
  }

  // Trace a closed shape through map-space points (converted to canvas pixels).
  function pathPoly(poly) {
    ctx.beginPath();
    poly.forEach(([x, y], i) => (i ? ctx.lineTo(sx(x), sy(y)) : ctx.moveTo(sx(x), sy(y))));
    ctx.closePath();
  }

  // ---------- Depth and radar lens (mouse only) ----------
  // The card itself stays flat (so planes are easy to point at). Instead,
  // its layers shift by different amounts as the mouse moves: sectors the
  // least, planes the most. That difference reads as depth, like looking
  // into a radar scope.
  const hasMouse = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const depthOn = hasMouse && !reduceMotion;
  const DEPTH = { sectors: 3, routes: 5, planes: 9 };   // how far each layer can move (px)
  const tilt = { x: 0, y: 0, tx: 0, ty: 0 };            // current and target, -1 to 1
  const lens = { x: 0, y: 0, a: 0 };                    // lens position and visibility (0 to 1)
  let mouseIn = false;
  const LENS_R = 44;                                    // lens ring radius (px)

  // pixel offset of a layer: layers move away from the mouse
  const shift = layer => [-tilt.x * DEPTH[layer], -tilt.y * DEPTH[layer]];

  function drawLensGlow() {                 // brightens the map around the mouse
    const R = LENS_R * 2.2;
    const g = ctx.createRadialGradient(lens.x, lens.y, 0, lens.x, lens.y, R);
    g.addColorStop(0, `rgba(255, 255, 255, ${0.4 * lens.a})`);
    g.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(lens.x - R, lens.y - R, R * 2, R * 2);
  }

  function drawLensRing() {                 // range ring, crosshair ticks and a turning sweep
    const a = lens.a * (hoveredPlane ? 0.3 : 1);       // fades back when a plane is picked
    ctx.save();
    ctx.translate(lens.x, lens.y);
    ctx.strokeStyle = `rgba(${INK}, ${0.55 * a})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(0, 0, LENS_R, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([2, 4]);
    ctx.beginPath(); ctx.arc(0, 0, LENS_R * 0.5, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    for (let k = 0; k < 4; k++) {                      // ticks at north, east, south, west
      const ang = (k * Math.PI) / 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(ang) * (LENS_R - 6), Math.sin(ang) * (LENS_R - 6));
      ctx.lineTo(Math.cos(ang) * (LENS_R + 6), Math.sin(ang) * (LENS_R + 6));
      ctx.stroke();
    }
    const sweep = (performance.now() / 1000) * 2;      // a short arc turning around the ring
    ctx.strokeStyle = `rgba(${INK}, ${0.85 * a})`;
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(0, 0, LENS_R, sweep, sweep + 0.7); ctx.stroke();
    ctx.restore();
  }

  // Draw one frame of the map card: sea and land, sectors, routes and waypoints,
  // the FIR outline, aircraft and trails, then the radar lens under the mouse.
  function draw() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    ctx.clearRect(0, 0, w, h);

    // --- layer 0: sea and land ---
    ctx.save();
    ctx.translate(...shift('sectors'));
    ctx.fillStyle = '#BCD3E6';
    ctx.fillRect(-20, -20, w + 40, h + 40);
    LAND_RINGS.forEach(ring => {
      pathPoly(ring);
      ctx.fillStyle = CORN; ctx.fill();
      ctx.strokeStyle = `rgba(${INK}, 0.35)`; ctx.lineWidth = 1; ctx.stroke();
    });
    ctx.font = `600 ${view.scale < 0.6 ? 10 : 12}px Manrope, system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = `rgba(${INK}, 0.4)`;
    COUNTRY_LABELS.forEach(([name, x, y]) => ctx.fillText(name, sx(x), sy(y)));
    ctx.restore();

    // --- layer 1: sectors (deepest, moves least) ---
    ctx.save();
    ctx.translate(...shift('sectors'));
    airspace.sectors.forEach(s => {           // solid fills separated by Sweet Corn gaps
      const [r, g, b] = s.rgb.map(Math.round);
      pathPoly(s.poly);
      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.88)`;
      ctx.fill();
      ctx.strokeStyle = CORN;
      ctx.lineWidth = 3;
      ctx.lineJoin = 'round';
      ctx.stroke();
    });
    if (hovered) {                            // hovered sector gets a navy outline
      pathPoly(hovered.poly);
      ctx.strokeStyle = `rgb(${INK})`;
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }
    ctx.restore();

    if (lens.a > 0.01) drawLensGlow();

    // --- layer 2: FIR boundary, ATS routes and waypoints ---
    ctx.save();
    ctx.translate(...shift('routes'));
    ctx.strokeStyle = `rgba(${INK}, 0.22)`;
    ctx.lineWidth = 1;
    ALL_ROUTES.forEach(pts => {
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(sx(x), sy(y)) : ctx.moveTo(sx(x), sy(y))));
      ctx.stroke();
    });
    ctx.fillStyle = `rgba(${INK}, 0.45)`;
    WAYPOINT_PTS.forEach(([x, y]) => {        // waypoints as tiny triangles
      const px = sx(x), py = sy(y), r = 2.4;
      ctx.beginPath(); ctx.moveTo(px, py - r); ctx.lineTo(px + r, py + r * 0.7); ctx.lineTo(px - r, py + r * 0.7); ctx.closePath(); ctx.fill();
    });
    ctx.setLineDash([7, 5]);
    ctx.strokeStyle = `rgb(${INK})`;
    ctx.lineWidth = 1.8;
    pathPoly(FIR);
    ctx.stroke();
    ctx.restore();

    // sector labels move with the sectors: cream on deep orange, navy on lighter fills
    ctx.save();
    ctx.translate(...shift('sectors'));
    ctx.font = `600 ${view.scale < 0.6 ? 10 : 12}px Manrope, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    airspace.sectors.forEach(s => {
      ctx.fillStyle = s.level === 2 ? CORN : `rgba(${INK}, 0.75)`;
      ctx.fillText(s.id, sx(s.cx), sy(s.cy));
    });
    ctx.restore();

    // --- layer 3: aircraft (nearest, moves most) ---
    ctx.save();
    ctx.translate(...shift('planes'));
    const planeSize = view.scale < 0.6 ? 5 : 8;   // half-length in pixels
    airspace.aircraft.forEach(ac => {
      ctx.globalAlpha = ac.alpha;                 // fades in, and out when an arrival lands
      ac.trail.forEach(([x, y], i) => {           // fading trail dots
        ctx.fillStyle = `rgba(${INK}, ${0.10 + i * 0.08})`;
        ctx.beginPath();
        ctx.arc(sx(x), sy(y), 1.3, 0, Math.PI * 2);
        ctx.fill();
      });
      drawPlane(sx(ac.x), sy(ac.y), ac.heading, planeSize);
      ctx.globalAlpha = 1;
    });
    if (hoveredPlane) {                           // hovered plane gets a navy ring
      ctx.beginPath();
      ctx.arc(sx(hoveredPlane.x), sy(hoveredPlane.y), planeSize + 6, 0, Math.PI * 2);
      ctx.strokeStyle = `rgb(${INK})`;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.restore();

    if (lens.a > 0.01) drawLensRing();
  }

  // ---------- 5. Hover tooltips (mouse and touch) ----------
  // A plane under the pointer shows its flight data. Otherwise the
  // sector under the pointer shows its aircraft count and status.
  const tip = document.getElementById('map-tip');
  let pointer = null;                         // last pointer position, in canvas pixels

  function pick() {
    if (!pointer) { hovered = null; hoveredPlane = null; return; }
    // canvas pixels -> map space (the reverse of sx / sy), undoing each
    // layer's depth shift so we test against where things are drawn
    const toMap = ([ox, oy]) => [(pointer.x - ox - view.ox) / view.scale, (pointer.y - oy - view.oy) / view.scale];
    const [pmx, pmy] = toMap(shift('planes'));
    const [smx, smy] = toMap(shift('sectors'));
    // once a plane is picked, keep following it while the pointer stays near,
    // so there is time to read the label while it flies
    const stillNear = hoveredPlane && airspace.aircraft.includes(hoveredPlane) &&
      Math.hypot(hoveredPlane.x - pmx, hoveredPlane.y - pmy) < 40 / view.scale;
    hoveredPlane = stillNear ? hoveredPlane : airspace.aircraftNear(pmx, pmy, 14 / view.scale);
    hovered = hoveredPlane ? null : airspace.sectorAt(smx, smy);
  }

  function place(x, y) {                      // keep the tooltip inside the card
    tip.style.left = Math.min(canvas.clientWidth - 100, Math.max(100, x)) + 'px';
    tip.style.top = y + 'px';
  }

  // Find what is under the pointer (a plane or a sector) and show or hide the tooltip.
  function updateTip() {
    pick();
    canvas.style.cursor = hoveredPlane ? 'pointer' : (depthOn ? 'crosshair' : '');

    if (hoveredPlane) {
      const ac = hoveredPlane;
      const now = airspace.sectorAt(ac.x, ac.y);
      const next = airspace.nextSector(ac);
      const where = now ? `${now.id} → ${next ? next.id : 'exit'}` : (next ? `→ ${next.id}` : 'Outside FIR');
      const hdg = String(ac.headingDeg).padStart(3, '0');
      tip.innerHTML = `<b>${ac.callsign}</b> · ${ac.levelText}<br>${ac.groundSpeed} kt · ${hdg}° · ${where}`;
      const [ox, oy] = shift('planes');
      place(sx(ac.x) + ox, sy(ac.y) + oy - 6);  // label sits above the plane and follows it
    } else if (hovered) {
      tip.textContent = `${hovered.count} aircraft · ${hovered.status}`;   // name is already on the map
      place(pointer.x, pointer.y);
    } else {
      tip.hidden = true;
      return;
    }
    tip.hidden = false;
  }

  // Remember where the pointer is (in canvas pixels) and refresh the tooltip.
  function onPointer(e) {
    const rect = canvas.getBoundingClientRect();
    pointer = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    if (depthOn && e.pointerType === 'mouse') {
      if (!mouseIn) { lens.x = pointer.x; lens.y = pointer.y; }   // lens starts under the mouse
      mouseIn = true;
      tilt.tx = (pointer.x / rect.width - 0.5) * 2;               // -1 at the left edge, 1 at the right
      tilt.ty = (pointer.y / rect.height - 0.5) * 2;
    }
    updateTip();
    if (reduceMotion) draw();
  }
  // Pointer events work for mouse, pen and touch alike.
  canvas.addEventListener('pointermove', onPointer);
  canvas.addEventListener('pointerdown', onPointer);
  // Pointer leaves the map: forget it, hide the tooltip and the lens.
  canvas.addEventListener('pointerleave', () => {
    pointer = null;
    mouseIn = false;
    tilt.tx = 0; tilt.ty = 0;                 // layers drift back to centre
    updateTip();
    if (reduceMotion) draw();
  });

  // Edge glow: the card's border brightens at the point nearest the mouse
  const mapCard = document.querySelector('.map-card');
  if (depthOn) {
    // Edge glow: --gx / --gy tell home.css where the mouse is, so the border
    // lights up nearest to it (a masked radial gradient on ::before).
    mapCard.addEventListener('pointermove', e => {
      const r = mapCard.getBoundingClientRect();
      mapCard.style.setProperty('--gx', `${e.clientX - r.left}px`);
      mapCard.style.setProperty('--gy', `${e.clientY - r.top}px`);
      mapCard.classList.add('is-glowing');
    });
    // Mouse leaves the card: fade the glow out.
    mapCard.addEventListener('pointerleave', () => mapCard.classList.remove('is-glowing'));
  }

  // ---------- 6. Live sector table ----------
  // Plain ruled table. Aircraft are shown as plane icons coloured by the
  // sector's status. "Change" compares the count now with 10 seconds ago.
  const tbody = document.getElementById('sector-rows');
  const headers = [...document.querySelectorAll('.sector-table thead th')];
  const TREND = {
    '1':  ['↗', 'Filling up', 'trend-up'],
    '0':  ['→', 'Steady', 'trend-flat'],
    '-1': ['↘', 'Emptying', 'trend-down']
  };
  // assumed altitude bands, the same as on the full map (placeholders)
  const BANDS = { S1: 'FL100–FL460', S2: 'FL195–FL460', S3: 'FL195–FL460', S4: 'FL150–FL460',
                  S5: 'FL100–FL460', S6: 'GND–FL460', S7: 'FL050–FL460' };
  const PLANE_D = 'M1 0 L0.8 0.09 L0.2 0.11 L-0.15 0.9 L-0.35 0.9 L-0.2 0.11 L-0.65 0.09 L-0.85 0.42 L-1 0.42 L-0.92 0 L-1 -0.42 L-0.85 -0.42 L-0.65 -0.09 L-0.2 -0.11 L-0.35 -0.9 L-0.15 -0.9 L0.2 -0.11 L0.8 -0.09 Z';
  const SLOTS = 8;                            // planes shown even when the sector is empty
  let sortKey = 'count';                      // busiest first
  let sortDir = -1;                           // 1 ascending, -1 descending

  // one row per sector, created once and updated in place
  const rows = new Map();
  airspace.sectors.forEach(s => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<th scope="row" class="sid">${s.id}<small>${BANDS[s.id] || ''}</small></th>
                    <td><span class="sr-only"></span><span class="planes" aria-hidden="true"></span></td>
                    <td><span class="status"></span></td><td class="trend"></td>`;
    tr.dataset.count = '-1';
    rows.set(s, tr);
  });

  // One small plane icon (inline SVG) for the table; `cls` sets its colour in home.css.
  function planeIcon(cls) {
    return `<svg class="${cls}" viewBox="-1 -1 2 2"><path transform="rotate(-90)" d="${PLANE_D}"/></svg>`;
  }

  // The value a sector is sorted by, for the column chosen in sortKey.
  const sortValue = s => (sortKey === 'id' ? s.id : sortKey === 'trend' ? s.trend : s[sortKey]);

  // Rebuild the order and contents of the table rows from the live sectors.
  // Rows are reused, not recreated, so the slide animation can track them.
  function renderTable() {
    const sorted = [...airspace.sectors].sort((a, b) => {
      const va = sortValue(a), vb = sortValue(b);
      const diff = typeof va === 'string' ? va.localeCompare(vb) : va - vb;
      return diff ? diff * sortDir : a.id.localeCompare(b.id);  // ties: always by sector name
    });

    // rows glide to their new place (measure, reorder, then animate the difference)
    const before = new Map([...rows.values()].map(tr => [tr, tr.getBoundingClientRect().top]));

    sorted.forEach(s => {
      const tr = rows.get(s);
      const [planeCell, statusCell, trendCell] = tr.querySelectorAll('td');
      const prev = Number(tr.dataset.count), prevLevel = tr.dataset.level;

      // planes: redrawn only when the count or the status changes
      if (prev !== s.count || prevLevel !== String(s.level)) {
        const icons = [];
        for (let i = 0; i < Math.max(SLOTS, s.count); i++) {
          const isNew = prev >= 0 && i >= prev && i < s.count;       // a plane that just arrived
          icons.push(planeIcon(i < s.count ? `lvl-${s.level}${isNew ? ' new' : ''}` : 'room'));
        }
        planeCell.lastElementChild.innerHTML = icons.join('');
        planeCell.firstElementChild.textContent = `${s.count} aircraft`;   // for screen readers
        tr.dataset.count = s.count;
        tr.dataset.level = s.level;
      }

      const status = statusCell.firstElementChild;
      status.textContent = s.status;
      status.className = `status status-${s.level}`;
      tr.classList.toggle('is-over', s.level === 2);

      const [arrow, word, cls] = TREND[String(s.trend)];
      trendCell.className = `trend ${cls}`;
      trendCell.innerHTML = `<span class="trend-word">${word}</span><b aria-hidden="true">${arrow}</b>`;

      tbody.appendChild(tr);                   // appending in sorted order moves the row
    });

    if (!reduceMotion && !document.getElementById('panel-table').hidden) {
      rows.forEach(tr => {
        const dy = before.get(tr) - tr.getBoundingClientRect().top;
        if (!dy) return;
        tr.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 500, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
      });
    }
  }

  // click a column heading to sort; click again to reverse
  headers.forEach(th => {
    const button = th.querySelector('button');
    // Clicking a heading sorts by that column; clicking it again reverses the order.
    button.addEventListener('click', () => {
      const key = button.dataset.sort;
      sortDir = key === sortKey ? -sortDir : (key === 'id' ? 1 : -1);   // numbers: biggest first
      sortKey = key;
      headers.forEach(h => h.removeAttribute('aria-sort'));
      th.setAttribute('aria-sort', sortDir === 1 ? 'ascending' : 'descending');
      renderTable();
    });
  });

  // ---------- 7. Map / Table switch ----------
  const tabs = [...document.querySelectorAll('.tabs [role="tab"]')];

  // Show the Map or the Table panel and mark the chosen tab (role="tab", aria-selected).
  function selectTab(tab) {
    // keep the card the same height in both views, so the page doesn't jump
    const mapPanel = document.getElementById('panel-map');
    if (!mapPanel.hidden) {
      document.getElementById('panel-table').style.minHeight = mapPanel.offsetHeight + 'px';
    }
    tabs.forEach(t => {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
    });
    if (tab.id === 'tab-table') renderTable();
  }

  tabs.forEach((tab, i) => {
    // Click a tab to switch view.
    tab.addEventListener('click', () => selectTab(tab));
    // left / right arrow keys move between tabs
    tab.addEventListener('keydown', e => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
      selectTab(next);
      next.focus();
    });
  });

  // ---------- 8. Live clock: UTC (aviation's time) or the visitor's local time ----------
  const clock = document.getElementById('utc-clock');
  const zone = document.getElementById('time-zone');
  // 7 -> "07" (two-digit clock parts).
  const two = n => String(n).padStart(2, '0');
  // hovering the dropdown shows the visitor's offset, e.g. "Local time is GMT+4"
  const offset = new Intl.DateTimeFormat('en', { timeZoneName: 'short' }).formatToParts(new Date())
    .find(p => p.type === 'timeZoneName');
  if (offset) zone.title = `Local time is ${offset.value}`;
  // Switching between UTC and Local updates the clock straight away.
  zone.addEventListener('change', () => tickClock());

  // Write the current time (UTC or local) into the clock; runs every second.
  function tickClock() {
    const now = new Date(), utc = zone.value === 'utc';
    const h = utc ? now.getUTCHours() : now.getHours();
    const m = utc ? now.getUTCMinutes() : now.getMinutes();
    const s = utc ? now.getUTCSeconds() : now.getSeconds();
    clock.textContent = `${two(h)}:${two(m)}:${two(s)}`;
    clock.dateTime = now.toISOString();
    clock.setAttribute('aria-label', `Current time, ${utc ? 'UTC' : 'local time'}`);
  }

  // ---------- 9. Simulation speed slider ----------
  // Slider positions 0..5 are mapped to these speeds; 1x sits in the middle.
  const SPEEDS = [0, 0.25, 0.5, 1, 2, 4];
  const speedInput = document.getElementById('sim-speed');
  const speedOut = document.getElementById('sim-speed-out');
  let simSpeed = 1;

  // Slider moved: pick the matching speed and update its label (and the text
  // screen readers announce).
  speedInput.addEventListener('input', () => {
    simSpeed = SPEEDS[Number(speedInput.value)];
    const text = simSpeed === 0 ? 'Paused' : `${simSpeed}×`;
    speedOut.textContent = text;
    speedInput.setAttribute('aria-valuetext', text);   // screen readers say "2×", not "4"
  });

  // ---------- 10. Animation loop ----------
  // Fast forward 40 seconds so the map is already busy on load
  for (let i = 1; i <= 400; i++) {
    airspace.update(0.1);
    if (i % 10 === 0) airspace.recordHistory();
  }

  let running = true;
  let last = performance.now();

  // Animation loop, once per screen refresh: run the simulation for the time
  // that passed (times the chosen speed), then redraw the map.
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);   // cap big jumps (e.g. after a tab switch)
    last = now;
    if (running) {
      if (simSpeed > 0) airspace.update(dt * simSpeed);   // slider scales simulated time
      if (depthOn) {
        // ease the layers and the lens toward the mouse (same feel as the hero card)
        const k = Math.min(1, dt * 6);
        tilt.x += (tilt.tx - tilt.x) * k;
        tilt.y += (tilt.ty - tilt.y) * k;
        if (pointer) {
          const kl = Math.min(1, dt * 14);
          lens.x += (pointer.x - lens.x) * kl;
          lens.y += (pointer.y - lens.y) * kl;
        }
        lens.a += ((mouseIn ? 1 : 0) - lens.a) * Math.min(1, dt * 8);
      }
      draw();
      if (pointer) updateTip();                       // keep tooltips live as planes move
    }
    requestAnimationFrame(frame);
  }

  // once a second: clock, sector history, and the table if it is showing
  setInterval(() => {
    tickClock();                                       // real time, even when paused
    if (!running || simSpeed === 0) return;
    airspace.recordHistory();
    if (!document.getElementById('panel-table').hidden) renderTable();
  }, 1000);
  tickClock();

  // pause the simulation when the card is scrolled out of view (saves battery)
  new IntersectionObserver(entries => {
    running = entries[0].isIntersecting;
    last = performance.now();
  }).observe(document.querySelector('.map-card'));

  new ResizeObserver(resize).observe(canvas);
  resize();

  if (!reduceMotion) requestAnimationFrame(frame);   // reduced motion: one still frame

  // ---------- 11. Scroll cue ----------
  document.getElementById('cue').addEventListener('click', () => {
    document.getElementById('next').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' });
  });
})();
