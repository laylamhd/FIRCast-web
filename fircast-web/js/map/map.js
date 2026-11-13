// =====================================================================
// FIRCast · js/map/map.js
// Used on: map.html.
// Needs (load first): data/airspace.js (AIRSPACE_DATA), data/land-region.js (LAND_REGION).
//
// The full interactive map, drawn on one <canvas>:
//   - real FIR outline, ATS routes and waypoints (UAE eAIP), placeholder sectors;
//   - simulated flights that follow the route network (Flight class);
//   - one projection for both views: 2D is a 3D camera looking straight down,
//     3D tilts and turns the same camera (project / unproject functions);
//   - drawing order: sea and land, grid, routes, sectors (as flat shapes or
//     3D blocks), radar sweep, aircraft, scales and north arrow;
//   - mouse, touch and keyboard controls, the dropdown, the plane panel;
//   - the opening air show (a 3D plane with a smoke trail that lands at Dubai).
// =====================================================================


(() => {
  'use strict';
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // =======================================================
  // 1. Map data and units
  // =======================================================
  // Country outlines (Natural Earth, public domain): lists of rings,
  // each ring a list of [longitude, latitude] points.
  const LAND = LAND_REGION;   // from data/land-region.js
  // Only the larger countries are labelled, to keep the map uncluttered.
  // 'near' labels show when zoomed in on the UAE, 'far' ones when zoomed out.
  const COUNTRY_LABELS = [
    ['Oman', 57.2, 22.2, 'near'], ['Saudi Arabia', 50.9, 22.4, 'near'], ['Qatar', 51.2, 25.35, 'near'], ['Iran', 55.5, 27.7, 'near'],
    ['Oman', 56.8, 20.5, 'far'], ['Saudi Arabia', 44.5, 24.5, 'far'], ['Iran', 54.0, 32.5, 'far'], ['Iraq', 43.5, 33.0, 'far'],
    ['Egypt', 29.8, 26.5, 'far'], ['Türkiye', 35.0, 39.0, 'far'], ['Yemen', 47.5, 15.7, 'far'], ['Pakistan', 67.5, 27.8, 'far']
  ];

  const K = Math.cos((24.6 * Math.PI) / 180);   // squeeze longitude so shapes keep proportion at 24.6°N
  const NM_PER_DEG = 60;                         // 1° of latitude = 60 nautical miles
  const FT_PER_NM = 6076.12;
  const EXAG = 8;                                // 3D only: heights drawn 8x taller so layers are visible
  const TIME_SCALE = 30;                         // simulated time runs 30x faster than real time
  const altUnits = ft => (ft / FT_PER_NM / NM_PER_DEG) * EXAG;   // feet -> map units (degrees of latitude)
  const nmBetween = ([lon1, lat1], [lon2, lat2]) => Math.hypot((lon2 - lon1) * K, lat2 - lat1) * NM_PER_DEG;
  const pick = list => list[Math.floor(Math.random() * list.length)];
  // A random number between a and b.
  const rand = (a, b) => a + Math.random() * (b - a);
  // Flight level for display: 0 -> "GND", 350 -> "FL350", 50 -> "FL050".
  const fmtFL = fl => (fl < 1 ? 'GND' : 'FL' + String(Math.round(fl)).padStart(3, '0'));

  // =======================================================
  // 2. Airspace data from the UAE eAIP
  // =======================================================
  // FIR outline, ATS routes and their points: UAE eAIP, AIRAC AMDT 09/2026
  // (effective 03 SEP 2026), ENR 2.1 / 3.2 / 4.4. Along the Saudi border the
  // FIR is approximated with straight lines through TANSU, PEKEM and MUXIT.
  // The seven sectors are NOT real: they are the FIR split into seven
  // placeholder areas, because the real sectorisation is not published.
  const GCAA = AIRSPACE_DATA;   // from data/airspace.js
  const FIR = GCAA.fir;                                      // [[lon, lat], ...]
  const WAYPOINTS = GCAA.waypoints;                          // { name: [lon, lat] } (points on ATS routes)
  const AIRWAYS = GCAA.routes;                               // { name, fixes, dir, lower, upper, traffic }

  // Assumed vertical limits in flight levels (hundreds of feet): [floor, ceiling]
  const BANDS = {
    S1: [100, 460], S2: [195, 460], S3: [195, 460], S4: [150, 460],
    S5: [100, 460], S6: [0, 460],   S7: [50, 460]
  };

  const LEVEL_NAMES = ['Normal', 'Busy', 'Overloaded'];
  const LEVEL_RGB = [[132, 180, 230], [243, 198, 63], [221, 17, 10]];   // powder blue, butter yellow, spicy orange

  class Sector {
    // id: "S1".."S7"; poly: outline as [lon, lat] points; floor/ceiling: flight levels.
    constructor(id, poly, [floor, ceiling]) {
      this.id = id;
      this.poly = poly;                                       // [[lon, lat], ...]
      this.lon = this.poly.reduce((s, p) => s + p[0], 0) / this.poly.length;
      this.lat = this.poly.reduce((s, p) => s + p[1], 0) / this.poly.length;
      this.floor = floor;
      this.ceiling = ceiling;
      this.count = 0;
      this.level = 0;
      this.rgb = [...LEVEL_RGB[0]];
      this.rise = 0;                                          // 0 flat on the ground, 1 full 3D block
    }
    contains(lon, lat) {                                     // ray casting, sideways only
      let hit = false;
      for (let i = 0, j = this.poly.length - 1; i < this.poly.length; j = i++) {
        const [xi, yi] = this.poly[i], [xj, yj] = this.poly[j];
        if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) hit = !hit;
      }
      return hit;
    }
    holds(f) { return this.contains(f.lon, f.lat) && f.fl >= this.floor && f.fl <= this.ceiling; }
    updateLevel() {                                          // hysteresis, as on the home page
      const c = this.count;
      if (this.level === 0 && c >= 4) this.level = 1;
      else if (this.level === 1 && c >= 6) this.level = 2;
      else if (this.level === 2 && c <= 4) this.level = 1;
      else if (this.level === 1 && c <= 2) this.level = 0;
    }
    // Glide the sector's drawn colour towards the colour of its level, so changes
    // fade over about a quarter of a second instead of jumping.
    fadeColour(dt) {
      const target = LEVEL_RGB[this.level], k = Math.min(1, dt * 4);
      this.rgb = this.rgb.map((v, i) => v + (target[i] - v) * k);
    }
    get band() { return `${fmtFL(this.floor)}–${fmtFL(this.ceiling)}`; }
    get status() { return LEVEL_NAMES[this.level]; }
    // The sector's bounding box (used to zoom to it from the dropdown).
    get bounds() {
      const lons = this.poly.map(p => p[0]), lats = this.poly.map(p => p[1]);
      return { minLon: Math.min(...lons), maxLon: Math.max(...lons), minLat: Math.min(...lats), maxLat: Math.max(...lats) };
    }
  }
  const sectors = Object.entries(GCAA.sectors).map(([id, poly]) => new Sector(id, poly, BANDS[id]));

  // =======================================================
  // 3. Airports (for the simulated flights)
  // =======================================================
  // Real airports (ICAO code and name). UAE positions are approximate and
  // only used to decide whether a route leads to or from one of them.
  const UAE_AIRPORTS = {
    OMDB: [55.364, 25.253], OMAA: [54.651, 24.433], OMSJ: [55.517, 25.329], OMDW: [55.161, 24.896],
    OMRK: [55.939, 25.614], OMFJ: [56.324, 25.112], OMAL: [55.609, 24.262]
  };
  const AIRPORTS = {
    EGLL: 'London Heathrow', EDDF: 'Frankfurt', LTFM: 'Istanbul', HECA: 'Cairo',
    OBBI: 'Bahrain', OTHH: 'Doha Hamad', OKKK: 'Kuwait', VABB: 'Mumbai', VIDP: 'Delhi',
    WSSS: 'Singapore Changi', VHHH: 'Hong Kong', OOMS: 'Muscat', OPKC: 'Karachi',
    OERK: 'Riyadh', OEJN: 'Jeddah', OMDB: 'Dubai International', OMDW: 'Al Maktoum',
    OMSJ: 'Sharjah', OMAA: 'Zayed International', OMRK: 'Ras Al Khaimah', OMFJ: 'Fujairah', OMAL: 'Al Ain'
  };
  const FROM_WEST = ['EGLL', 'EDDF', 'LTFM', 'HECA', 'OTHH', 'OBBI', 'OKKK', 'OERK', 'OEJN'];
  const FROM_EAST = ['VABB', 'VIDP', 'WSSS', 'VHHH', 'OOMS', 'OPKC'];
  const LONG_HAUL = ['A388', 'B77W', 'B789', 'A359', 'A35K'];
  const SHORT_HAUL = ['A320', 'A21N', 'B38M', 'B738'];
  // The UAE airport closest to point p, as [code, distance in NM].
  const nearestUAE = p => Object.entries(UAE_AIRPORTS).map(([c, q]) => [c, nmBetween(p, q)]).sort((a, b) => a[1] - b[1])[0];

  // =======================================================
  // 4. Flights (simulated, flying the real ATS route network)
  // =======================================================
  // Each flight follows a flight plan worked out from the eAIP routes:
  // overflights enter at a FIR boundary point and leave at another,
  // arrivals follow the routes towards a UAE airport and land, departures
  // take off and follow the routes out. One-way routes are only flown the
  // allowed way, and plans avoid sharp turns. Flights start 30 NM outside
  // the FIR, so they fly in rather than appear inside it.
  const PLANS = GCAA.plans;                                  // { k: 'o' | 'a' | 'd', p: [fixes], ap, top, wt }
  const ROUTE_OF = {};                                       // "FIXA>FIXB" -> route name
  AIRWAYS.forEach(r => r.fixes.forEach((n, i) => {
    if (i) { ROUTE_OF[`${r.fixes[i - 1]}>${n}`] = r.name; ROUTE_OF[`${n}>${r.fixes[i - 1]}`] = r.name; }
  }));
  const KINDS = { o: 'overflight', a: 'arrival', d: 'departure' };

  // a point `dist` NM beyond `b`, continuing the line from `a` to `b`
  function beyond(a, b, dist) {
    const d = nmBetween(a, b) || 1;
    return [b[0] + ((b[0] - a[0]) * dist) / d, b[1] + ((b[1] - a[1]) * dist) / d];
  }

  // Flight: one simulated aircraft following a flight plan from data/airspace.js.
  // It knows its path, how far along it is, and works out its position, heading,
  // altitude and speed from that distance.
  class Flight {
    static made = 0;

    // Turn a plan (a list of route points) into a path the flight can fly.
    constructor(plan) {
      this.kind = KINDS[plan.k];
      const fixes = [...plan.p];
      const pts = fixes.map(n => WAYPOINTS[n]);
      const ap = plan.ap ? UAE_AIRPORTS[plan.ap] : null;
      if (this.kind === 'arrival') { pts.push(ap); fixes.push(plan.ap); }
      if (this.kind === 'departure') { pts.unshift(ap); fixes.unshift(plan.ap); }
      if (this.kind !== 'departure') { pts.unshift(beyond(pts[1], pts[0], 30)); fixes.unshift(''); }   // fly in from outside
      if (this.kind !== 'arrival') { pts.push(beyond(pts[pts.length - 2], pts[pts.length - 1], 30)); fixes.push(''); }
      this.fixNames = fixes;
      this.path = pts;
      this.cum = [0];                                         // distance to each point (NM)
      for (let i = 1; i < pts.length; i++) this.cum.push(this.cum[i - 1] + nmBetween(pts[i - 1], pts[i]));
      this.len = this.cum[this.cum.length - 1];

      const eastbound = pts[pts.length - 1][0] >= pts[0][0];
      const far = eastbound ? [FROM_WEST, FROM_EAST] : [FROM_EAST, FROM_WEST];
      this.from = this.kind === 'departure' ? plan.ap : pick(far[0]);
      this.to = this.kind === 'arrival' ? plan.ap : pick(far[1]);
      this.type = pick(Math.random() < 0.7 ? LONG_HAUL : SHORT_HAUL);
      Flight.made++;
      this.callsign = 'FC' + (100 + ((Flight.made * 53) % 900));   // "FC" is made up
      do { this.squawk = Array.from({ length: 4 }, () => Math.floor(Math.random() * 8)).join(''); }
      while (['7500', '7600', '7700'].includes(this.squawk));   // skip the emergency codes

      // cruising level, kept under the lowest upper limit of the routes it uses
      const top = Math.floor(plan.top / 1000) * 10;
      const lo = this.kind === 'overflight' ? 300 : 320;
      this.cruise = Math.min(top, lo + 10 * Math.floor(rand(0, 9)));
      this.cruiseGs = rand(440, 490);
      this.dist = 0;
      this.trail = [];
      this.trailTimer = 0;
      this.fade = 0;                                            // fades in when it appears
      this.place();
    }

    // altitude from the distance flown: about 3 NM per 1,000 ft when
    // descending (the usual rule of thumb) and a little more when climbing
    flAt(d) {
      if (this.kind === 'arrival') return Math.max(0, Math.min(this.cruise, ((this.len - d) * 10) / 3));
      if (this.kind === 'departure') return Math.min(this.cruise, (d * 10) / 3.3);
      return this.cruise;
    }
    get fl() { return this.flAt(this.dist); }
    // 250 kt below FL100, building up to cruising speed by FL300
    get gs() { const f = this.fl; return f <= 100 ? 250 : 250 + (this.cruiseGs - 250) * Math.min(1, (f - 100) / 200); }
    get vertical() { return Math.sign(Math.round(this.flAt(this.dist + 2) - this.fl)); }
    get phase() { return ['Descending', 'Cruise', 'Climbing'][this.vertical + 1]; }
    get progress() { return Math.min(1, this.dist / this.len); }
    get done() { return this.dist >= this.len; }
    get nextFix() { return this.fixNames[this.seg + 1] || 'FIR exit'; }
    // The ATS route the flight is on right now (shown in the plane panel).
    get airway() {
      const a = this.fixNames[this.seg], b = this.fixNames[this.seg + 1];
      return ROUTE_OF[`${a}>${b}`] || (this.kind === 'arrival' && b === this.to ? 'Approach' : this.kind === 'departure' && a === this.from ? 'Departure' : '—');
    }

    place() {                                                   // position from distance flown
      let i = 0;
      while (i < this.cum.length - 2 && this.cum[i + 1] < this.dist) i++;
      this.seg = i;
      const [a, b] = [this.path[i], this.path[i + 1]];
      const t = Math.min(1, (this.dist - this.cum[i]) / ((this.cum[i + 1] - this.cum[i]) || 1));
      this.lon = a[0] + (b[0] - a[0]) * t;
      this.lat = a[1] + (b[1] - a[1]) * t;
      // aviation heading: degrees clockwise from north
      const deg = (Math.atan2((b[0] - a[0]) * K, b[1] - a[1]) * 180) / Math.PI;
      this.heading = Math.round((deg + 360) % 360);
    }

    // Move forward for dtReal seconds of real time (times TIME_SCALE simulated),
    // then update the position, the fade and the trail dots.
    update(dtReal) {
      this.dist += (this.gs / 3600) * dtReal * TIME_SCALE;      // knots = NM per hour
      this.place();
      const toGo = this.len - this.dist;
      this.fade = this.kind === 'arrival' && toGo < 6 ? Math.max(0, toGo / 6) : Math.min(1, this.fade + dtReal * 1.5);   // fades out on landing
      this.trailTimer -= dtReal;
      if (this.trailTimer <= 0) {
        this.trail.push([this.lon, this.lat, this.fl]);
        if (this.trail.length > 5) this.trail.shift();
        this.trailTimer = 0.7;
      }
    }
  }

  // =======================================================
  // 5. Simulation
  // =======================================================
  // A new flight starts every 1.3-2.2 seconds: about 45% overflights,
  // 30% arrivals and 25% departures, busier airports chosen more often.
  const MIX = [['o', 0.45], ['a', 0.3], ['d', 0.25]];
  function pickPlan() {
    let r = Math.random(), k = 'o';
    for (const [kind, share] of MIX) { if (r < share) { k = kind; break; } r -= share; }
    const list = PLANS.filter(p => p.k === k), total = list.reduce((s, p) => s + p.wt, 0);
    let x = Math.random() * total;
    return list.find(p => (x -= p.wt) < 0) || list[0];
  }
  let spawnTimer = 0;
  let flights = [];

  // One simulation step: maybe start a new flight, move all flights, remove
  // finished ones, then recount every sector and update its level and colour.
  function step(dt) {
    spawnTimer -= dt;
    if (spawnTimer <= 0) { flights.push(new Flight(pickPlan())); spawnTimer = rand(1.3, 2.2); }
    flights.forEach(f => f.update(dt));
    flights = flights.filter(f => !f.done);
    sectors.forEach(s => {
      s.count = flights.filter(f => s.holds(f)).length;
      s.updateLevel();
      s.fadeColour(dt);
    });
  }
  // which sector is a flight in, and which will it enter next?
  const sectorOf = f => sectors.find(s => s.holds(f)) || null;
  function nextSector(f) {
    const here = sectorOf(f);
    const ghost = Object.create(f);                            // same flight, looked at further ahead
    for (let d = f.dist + 3; d < f.len; d += 3) {
      ghost.dist = d; ghost.place();
      const s = sectors.find(sec => sec.contains(ghost.lon, ghost.lat)) || null;
      if (s !== here) return s;
    }
    return null;
  }
  // warm up: 2 minutes of traffic before the page shows
  for (let i = 0; i < 240; i++) step(0.5);
  flights.forEach(f => { f.fade = 1; });

  // =======================================================
  // 6. Camera: 2D and 3D share one projection
  // =======================================================
  // Ground point (lon, lat) and height (feet) -> screen pixels.
  // tilt 0 = looking straight down (2D). In 3D the camera tilts back
  // (tilt) and turns around the map (yaw).
  const canvas = document.getElementById('geo-map');
  const ctx = canvas.getContext('2d');
  const $ = id => document.getElementById(id);
  // the map stops at the edges of the Middle East
  const DATA = { minLon: 24.0, maxLon: 72.0, minLat: 8.0, maxLat: 43.0 };
  const HOME = { minLon: 51.4, maxLon: 57.2, minLat: 22.4, maxLat: 26.9 };   // the FIR with a little margin
  const VIEW_2D = { tilt: 0, yaw: 0 };
  const VIEW_3D = { tilt: 0.95, yaw: -0.35 };                  // about 54° tilt, turned 20°

  let W = 0, H = 0, fitScale = 100;
  let view = { lon: 54.2, lat: 24.45, scale: 100, tilt: 0, yaw: 0 };
  let anim = null;                                             // camera animation in progress
  let mode = '2d';

  const centreY = () => H / 2 + Math.min(1, view.tilt) * H * 0.08;   // ground sits lower when tilted
  function project(lon, lat, ft = 0) {
    return projectG((lon - view.lon) * K, lat - view.lat, altUnits(ft));
  }
  // the same, for a point already in map units (east, north, up) from the view centre
  function projectG(gx, gy, gz) {
    const c = Math.cos(view.yaw), s = Math.sin(view.yaw);
    const xr = gx * c - gy * s, yr = gx * s + gy * c;
    const ct = Math.cos(view.tilt), st = Math.sin(view.tilt);
    return [W / 2 + xr * view.scale, centreY() - (yr * ct + gz * st) * view.scale, yr * st - gz * ct];  // x, y, depth
  }
  function unprojectGround(px, py) {                          // screen -> ground (height 0)
    const xr = (px - W / 2) / view.scale;
    const yr = -(py - centreY()) / view.scale / Math.max(0.15, Math.cos(view.tilt));
    const c = Math.cos(view.yaw), s = Math.sin(view.yaw);
    return [view.lon + (xr * c + yr * s) / K, view.lat + (-xr * s + yr * c)];
  }

  // The starting view: the whole FIR with a little margin. Also sets fitScale,
  // the zoom at which the FIR just fits (other zoom limits are relative to it).
  function homeView() {
    fitScale = Math.min(W / ((HOME.maxLon - HOME.minLon) * K), H / (HOME.maxLat - HOME.minLat));
    return { lon: (HOME.minLon + HOME.maxLon) / 2, lat: (HOME.minLat + HOME.maxLat) / 2, scale: fitScale };
  }
  // smallest zoom: the whole Middle East fills the map
  const dataScale = () => Math.max(W / ((DATA.maxLon - DATA.minLon) * K), H / (DATA.maxLat - DATA.minLat));
  function clampView() {
    const flat = view.tilt < 0.02 && Math.abs(view.yaw) < 0.01;
    view.scale = Math.min(fitScale * 14, Math.max(dataScale() * (flat ? 1 : 0.8), view.scale));
    if (flat) {                                                // keep the view's edges inside the data
      const halfLon = W / 2 / (K * view.scale), halfLat = H / 2 / view.scale;
      view.lon = Math.min(DATA.maxLon - halfLon, Math.max(DATA.minLon + halfLon, view.lon));
      view.lat = Math.min(DATA.maxLat - halfLat, Math.max(DATA.minLat + halfLat, view.lat));
    } else {                                                   // 3D: keep the centre inside the data
      view.lon = Math.min(DATA.maxLon, Math.max(DATA.minLon, view.lon));
      view.lat = Math.min(DATA.maxLat, Math.max(DATA.minLat, view.lat));
    }
  }
  // smoothly move the camera to a new view (or jump, with reduced motion)
  function flyTo(target, ms = 800) {
    if (reduceMotion) { Object.assign(view, target); clampView(); return; }
    anim = { from: { ...view }, to: { ...view, ...target }, t0: performance.now(), ms };
  }
  // Advance a camera animation started by flyTo (eased, so it slows at the end).
  function runAnim(now) {
    if (!anim) return;
    const t = Math.min(1, (now - anim.t0) / anim.ms);
    const e = 1 - Math.pow(1 - t, 3);                          // ease out
    for (const key of ['lon', 'lat', 'scale', 'tilt', 'yaw']) {
      view[key] = anim.from[key] + (anim.to[key] - anim.from[key]) * e;
    }
    if (t === 1) { anim = null; clampView(); }
  }

  // Fit the canvas to its box, at the screen's pixel density for sharp lines.
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const first = W === 0;
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const home = homeView();
    if (first) Object.assign(view, home);
    clampView();
  }

  // =======================================================
  // 7. Drawing
  // =======================================================
  const INK = '19, 35, 58';
  const CORN = '#FBF4DB';
  const SEA = '#BCD3E6';
  const PLANE = new Path2D('M1 0 L0.8 0.09 L0.2 0.11 L-0.15 0.9 L-0.35 0.9 L-0.2 0.11 L-0.65 0.09 L-0.85 0.42 L-1 0.42 L-0.92 0 L-1 -0.42 L-0.85 -0.42 L-0.65 -0.09 L-0.2 -0.11 L-0.35 -0.9 L-0.15 -0.9 L0.2 -0.11 L0.8 -0.09 Z');

  // Plane colour by altitude: green low, through teal and blue, to plum high.
  const ALT_STOPS = [
    [0,   [30, 140, 78]],    // GND    #1E8C4E
    [100, [15, 138, 138]],   // FL100  #0F8A8A
    [200, [42, 92, 170]],    // FL200  #2A5CAA
    [300, [90, 58, 160]],    // FL300  #5A3AA0
    [400, [155, 45, 134]]    // FL400+ #9B2D86
  ];
  function altRGB(fl) {
    let i = 0;
    while (i < ALT_STOPS.length - 2 && fl > ALT_STOPS[i + 1][0]) i++;
    const [f0, c0] = ALT_STOPS[i], [f1, c1] = ALT_STOPS[i + 1];
    const t = Math.min(1, Math.max(0, (fl - f0) / (f1 - f0)));
    return c0.map((v, k) => Math.round(v + (c1[k] - v) * t)).join(', ');
  }
  // build the colour key from the same stops
  const topFL = ALT_STOPS[ALT_STOPS.length - 1][0];
  $('alt-bar').style.background = `linear-gradient(90deg, ${ALT_STOPS.map(([fl, c]) => `rgb(${c.join(', ')}) ${(fl / topFL) * 100}%`).join(', ')})`;
  ALT_STOPS.forEach(([fl], i) => {
    const tick = document.createElement('span');
    tick.textContent = fl === 0 ? 'GND' : i === ALT_STOPS.length - 1 ? `${fl}+` : String(fl);
    tick.style.left = `${(fl / topFL) * 100}%`;
    $('alt-ticks').appendChild(tick);
  });

  // layers switched on and off from the dropdown
  const layers = { traffic: true, airways: true, waypoints: true, fir: true };
  let hoveredSector = null, hoveredFlight = null, openFlight = null, selected = null;
  let openWaypoint = null;                                     // waypoint whose name is shown

  function path(points, ft = 0, close = true) {
    ctx.beginPath();
    points.forEach(([lon, lat], i) => {
      const [x, y] = project(lon, lat, ft);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    if (close) ctx.closePath();
  }

  // Sea, the latitude/longitude grid, land and country labels, the FIR outline
  // and (in 3D) a cream cover over everything outside the Middle East.
  function drawGround() {
    ctx.fillStyle = SEA;
    ctx.fillRect(0, 0, W, H);
    const flat = view.tilt < 0.02;

    // grid: 1° when close, 2° or 5° when zoomed out
    const pxPerDeg = view.scale * K;
    const step = pxPerDeg < 40 ? 5 : pxPerDeg < 90 ? 2 : 1;
    const lons = [], lats = [];
    for (let lon = Math.ceil(DATA.minLon / step) * step; lon <= DATA.maxLon; lon += step) lons.push(lon);
    for (let lat = Math.ceil(DATA.minLat / step) * step; lat <= DATA.maxLat; lat += step) lats.push(lat);
    ctx.strokeStyle = `rgba(${INK}, 0.09)`; ctx.lineWidth = 1;
    lons.forEach(lon => { path([[lon, DATA.minLat], [lon, DATA.maxLat]], 0, false); ctx.stroke(); });
    lats.forEach(lat => { path([[DATA.minLon, lat], [DATA.maxLon, lat]], 0, false); ctx.stroke(); });

    // land: every country the same colour
    ctx.lineJoin = 'round';
    Object.values(LAND).forEach(rings => rings.forEach(ring => {
      path(ring);
      ctx.fillStyle = CORN; ctx.fill();
      ctx.strokeStyle = `rgba(${INK}, 0.4)`; ctx.lineWidth = 1; ctx.stroke();
    }));
    if (!flat) {                                               // 3D: cover everything outside the Middle East
      const box = [[DATA.minLon, DATA.minLat], [DATA.maxLon, DATA.minLat], [DATA.maxLon, DATA.maxLat], [DATA.minLon, DATA.maxLat]];
      ctx.beginPath(); ctx.rect(0, 0, W, H);
      box.forEach(([lon, lat], i) => { const [x, y] = project(lon, lat); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.closePath();
      ctx.fillStyle = CORN; ctx.fill('evenodd');
      path(box); ctx.strokeStyle = `rgba(${INK}, 0.25)`; ctx.lineWidth = 1; ctx.stroke();
    }
    if (flat) {                                                // grid labels in 2D only
      ctx.fillStyle = `rgba(${INK}, 0.55)`; ctx.font = '600 11px Manrope, system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      lons.forEach(lon => ctx.fillText(`${lon}°E`, project(lon, 0)[0], H - 6));
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      lats.forEach(lat => ctx.fillText(`${lat}°N`, W - 6, project(0, lat)[1]));
    }
    ctx.font = '600 13px Manrope, system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = `rgba(${INK}, 0.4)`;
    const zoomedIn = view.scale >= fitScale * 0.55 ? 'near' : 'far';
    COUNTRY_LABELS.forEach(([name, lon, lat, when]) => {
      if (when !== zoomedIn) return;
      const [x, y] = project(lon, lat); ctx.fillText(name, x, y);
    });

    if (layers.fir) {                                          // dotted FIR boundary
      ctx.save();
      ctx.setLineDash([8, 6]); ctx.strokeStyle = `rgb(${INK})`; ctx.lineWidth = 2;
      path(FIR); ctx.stroke();
      ctx.restore();
    }
  }

  function drawAirways() {                                     // ATS routes: thin lines
    if (!layers.airways) return;
    ctx.strokeStyle = `rgba(${INK}, 0.38)`; ctx.lineWidth = 1;
    AIRWAYS.forEach(a => { path(a.fixes.map(n => WAYPOINTS[n]), 0, false); ctx.stroke(); });
  }

  // Waypoints as small triangles; the clicked one is filled navy.
  function drawWaypoints() {
    if (!layers.waypoints || view.scale < fitScale * 0.4) return;
    const tri = view.scale > fitScale * 1.6 ? 5 : 3;          // small when zoomed out: there are ~200 points
    ctx.lineWidth = 1.2;
    Object.entries(WAYPOINTS).forEach(([name, [lon, lat]]) => {
      const [x, y] = project(lon, lat);
      const r = name === openWaypoint ? 6 : tri;
      ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x + r * 0.92, y + r * 0.66); ctx.lineTo(x - r * 0.92, y + r * 0.66); ctx.closePath();
      ctx.fillStyle = name === openWaypoint ? `rgb(${INK})` : CORN; ctx.fill();   // the clicked one is filled
      ctx.strokeStyle = `rgb(${INK})`; ctx.stroke();
    });
  }
  // the name of the clicked waypoint, in a small dark label above it
  function drawWaypointLabel() {
    if (!openWaypoint || !layers.waypoints) return;
    const [x, y] = project(...WAYPOINTS[openWaypoint]);
    ctx.font = '700 11px Manrope, system-ui, sans-serif';
    const w = ctx.measureText(openWaypoint).width + 16;
    ctx.fillStyle = `rgb(${INK})`;
    ctx.beginPath(); ctx.roundRect(x - w / 2, y - 32, w, 20, 6); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x - 5, y - 12); ctx.lineTo(x + 5, y - 12); ctx.lineTo(x, y - 8); ctx.closePath(); ctx.fill();
    ctx.fillStyle = CORN; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(openWaypoint, x, y - 22);
  }
  // The waypoint under screen point (x, y), if any (used for clicks and the cursor).
  function waypointAt(x, y) {
    if (!layers.waypoints || view.scale < fitScale * 0.4) return null;
    let best = null, bestD = 10;
    Object.entries(WAYPOINTS).forEach(([name, [lon, lat]]) => {
      const [px, py] = project(lon, lat);
      const d = Math.hypot(px - x, py - y);
      if (d < bestD) { best = name; bestD = d; }
    });
    return best;
  }

  // Sectors. Each one has a "rise" from 0 (flat on the ground) to 1 (a full
  // block at its altitude band). In 2D every sector is flat. In 3D every
  // sector rises, or only the selected one if a sector is picked.
  const floorFt = s => s.floor * 100 * s.rise;
  const ceilFt = s => s.ceiling * 100 * s.rise;

  // Sectors: flat coloured shapes in 2D. In 3D each one rises into a block between
  // its floor and ceiling: walls are drawn far-to-near so nearer ones cover farther ones.
  function drawSectors() {
    // When one sector is selected in the dropdown, the others are drawn faded.
    const alphaOf = s => (selected && s !== selected ? 0.35 : 1);
    const blocks = view.tilt >= 0.02 ? sectors.filter(s => s.rise > 0.01) : [];

    // floors: faint outline at the bottom of each block
    blocks.forEach(s => {
      path(s.poly, floorFt(s));
      ctx.strokeStyle = `rgba(${INK}, ${0.25 * alphaOf(s)})`; ctx.lineWidth = 1; ctx.stroke();
    });
    // walls: farthest first so nearer ones paint over them
    const walls = [];
    blocks.forEach(s => {
      // Depth of each wall at mid-height, used to sort walls far-to-near.
      const mid = (floorFt(s) + ceilFt(s)) / 2, n = s.poly.length;
      for (let i = 0; i < n; i++) {
        const a = s.poly[i], b = s.poly[(i + 1) % n];
        walls.push({ s, a, b, depth: (project(a[0], a[1], mid)[2] + project(b[0], b[1], mid)[2]) / 2 });
      }
    });
    walls.sort((p, q) => q.depth - p.depth).forEach(({ s, a, b }) => {
      const [r, g, bl] = s.rgb.map(Math.round);
      ctx.beginPath();
      [[a, floorFt(s)], [b, floorFt(s)], [b, ceilFt(s)], [a, ceilFt(s)]].forEach(([[lon, lat], ft], i) => {
        const [x, y] = project(lon, lat, ft);
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      });
      ctx.closePath();
      ctx.fillStyle = `rgba(${r}, ${g}, ${bl}, ${0.22 * alphaOf(s)})`; ctx.fill();
      ctx.strokeStyle = `rgba(${INK}, ${0.35 * alphaOf(s)})`; ctx.lineWidth = 1; ctx.stroke();
    });
    // corner posts
    blocks.forEach(s => s.poly.forEach(([lon, lat]) => {
      const [x1, y1] = project(lon, lat, floorFt(s)), [x2, y2] = project(lon, lat, ceilFt(s));
      ctx.strokeStyle = `rgba(${INK}, ${0.5 * alphaOf(s)})`; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }));

    // roofs (for a flat sector this is its shape on the ground)
    const roofs = [...sectors].sort((p, q) => project(q.lon, q.lat, ceilFt(q))[2] - project(p.lon, p.lat, ceilFt(p))[2]);
    roofs.forEach(s => {
      const [r, g, b] = s.rgb.map(Math.round);
      path(s.poly, ceilFt(s));
      if (!blocks.includes(s)) { ctx.fillStyle = `rgba(251, 244, 219, ${0.5 * alphaOf(s)})`; ctx.fill(); }
      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${(blocks.includes(s) ? 0.4 : 0.55) * alphaOf(s)})`; ctx.fill();
      const strong = s === selected || s === hoveredSector;
      ctx.strokeStyle = `rgba(${INK}, ${(strong ? 1 : 0.7) * alphaOf(s)})`;
      ctx.lineWidth = strong ? 2.5 : 1.5; ctx.stroke();
    });

    // labels: name and altitude band
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    sectors.forEach(s => {
      const [x, y] = project(s.lon, s.lat, ceilFt(s));
      ctx.globalAlpha = alphaOf(s);
      ctx.fillStyle = `rgb(${INK})`;
      ctx.font = '800 13px Manrope, system-ui, sans-serif'; ctx.fillText(s.id, x, y);
      ctx.globalAlpha = 1;
    });
  }

  // ---- Aircraft drawing ----
  // 2D: the flat plane icon, turned to the heading.
  function drawIcon(f, rgb, alpha, size) {
    const h = (f.heading * Math.PI) / 180;
    const ahead = project(f.lon + (Math.sin(h) * 0.05) / K, f.lat + Math.cos(h) * 0.05, f.fl * 100);
    const angle = Math.atan2(ahead[1] - f.sy, ahead[0] - f.sx);
    ctx.save();
    ctx.translate(f.sx, f.sy); ctx.rotate(angle); ctx.scale(size, size);
    ctx.globalAlpha = alpha;
    ctx.lineWidth = 2.4 / size; ctx.strokeStyle = CORN; ctx.stroke(PLANE);
    ctx.fillStyle = `rgb(${rgb})`; ctx.fill(PLANE);
    ctx.restore();
  }

  // 3D: a small low-poly aircraft. Points are in the plane's own frame:
  // [forward, right, up], with the nose at +1 and the tail at -1.
  // Each face is one flat panel, shaded by how much it faces the light.
  const MODEL = (() => {
    const ring = f => [[f, 0, 0.11], [f, 0.1, 0], [f, 0, -0.09], [f, -0.1, 0]];   // top, right, bottom, left
    const front = ring(0.55), rear = ring(-0.65);
    const nose = [1, 0, 0], tail = [-1, 0, 0.06];
    const faces = [];
    for (let i = 0; i < 4; i++) {                                 // fuselage: nose cone, body, tail cone
      const j = (i + 1) % 4;
      faces.push([nose, front[i], front[j]]);
      faces.push([front[i], rear[i], rear[j], front[j]]);
      faces.push([rear[i], tail, rear[j]]);
    }
    for (const side of [1, -1]) {                                 // swept wings and tailplane
      faces.push([[0.28, 0.08 * side, -0.02], [-0.2, 0.95 * side, 0.05], [-0.36, 0.95 * side, 0.05], [-0.22, 0.08 * side, -0.02]]);
      faces.push([[-0.7, 0.05 * side, 0.04], [-0.9, 0.38 * side, 0.06], [-0.99, 0.38 * side, 0.06], [-0.93, 0.05 * side, 0.04]]);
    }
    faces.push([[-0.6, 0, 0.1], [-0.92, 0, 0.46], [-1.0, 0, 0.46], [-0.98, 0, 0.07]]);   // tail fin
    return faces;
  })();
  // the outline seen from above, used for the shadow on the ground
  const SHADOW = [
    [[1, 0, 0], [0.55, 0.1, 0], [-0.65, 0.1, 0], [-1, 0, 0], [-0.65, -0.1, 0], [0.55, -0.1, 0]],
    ...MODEL.slice(12, 16)
  ];
  // Direction the light comes from for the 3D planes (normalised to length 1).
  const LIGHT = (() => { const v = [-0.35, 0.45, 0.82], n = Math.hypot(...v); return v.map(x => x / n); })();

  // Draw flight f as a small 3D aircraft: its shadow on the ground, then each panel
  // of the model, farthest first, shaded by how directly it faces the light.
  function drawModel(f, rgb, alpha, size) {
    const L = (size * 1.35) / view.scale;                        // half length, in map units
    const h = (f.heading * Math.PI) / 180;
    const F = [Math.sin(h), Math.cos(h)], R = [Math.cos(h), -Math.sin(h)];   // forward and right, on the ground
    const pitch = 0.12 * f.vertical;                             // nose up when climbing, down when descending
    const cx = (f.lon - view.lon) * K, cy = f.lat - view.lat, cz = altUnits(f.fl * 100);
    // Model point (forward, right, up) -> world position, scaled to the plane's size.
    const world = ([a, b, c]) => [cx + L * (a * F[0] + b * R[0]), cy + L * (a * F[1] + b * R[1]), cz + L * (c + a * pitch)];
    // Trace a closed shape through screen points.
    const trace = pts => { ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); };

    // shadow on the ground, straight below the plane
    ctx.fillStyle = `rgba(${INK}, ${0.16 * alpha})`;
    SHADOW.forEach(face => { trace(face.map(p => { const [x, y] = world(p); return projectG(x, y, 0); })); ctx.fill(); });

    // panels, farthest first, each shaded by its angle to the light
    const base = rgb.split(', ').map(Number);
    MODEL.map(face => {
      const w = face.map(world);
      const u = [w[1][0] - w[0][0], w[1][1] - w[0][1], w[1][2] - w[0][2]];
      const v = [w[2][0] - w[0][0], w[2][1] - w[0][1], w[2][2] - w[0][2]];
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const len = Math.hypot(...n) || 1;
      const light = Math.abs((n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]) / len);
      const pts = w.map(p => projectG(...p));
      return { pts, light, depth: pts.reduce((s, p) => s + p[2], 0) / pts.length };
    }).sort((p, q) => q.depth - p.depth).forEach(({ pts, light }) => {
      const k = 0.5 + 0.75 * light;                             // below 1 darkens, above 1 lightens
      const c = base.map(x => Math.round(k <= 1 ? x * k : x + (255 - x) * (k - 1) * 0.8));
      trace(pts);
      ctx.fillStyle = `rgba(${c.join(', ')}, ${alpha})`; ctx.fill();
      ctx.strokeStyle = `rgba(${base.map(x => Math.round(x * 0.55)).join(', ')}, ${0.9 * alpha})`;
      ctx.lineWidth = 0.6; ctx.lineJoin = 'round'; ctx.stroke();   // thin dark edge gives each panel definition
    });
  }

  // All aircraft: trails, drop lines to the ground (3D), the icon or 3D model,
  // the highlight ring for the hovered/open flight and the small data tags.
  function drawFlights() {
    if (!layers.traffic) return;
    const flat = view.tilt < 0.02;
    const showTags = view.scale > fitScale * 1.8;
    const size = Math.min(8.5, Math.max(4, 8.5 * Math.sqrt(view.scale / fitScale)));   // icons shrink when zoomed out
    const size3d = Math.min(26, Math.max(5, 11 * Math.sqrt(view.scale / fitScale)));   // 3D models also grow when zoomed in
    // project every flight, nearest drawn last
    flights.forEach(f => {
      [f.sx, f.sy, f.depth] = project(f.lon, f.lat, f.fl * 100);
    });
    [...flights].sort((p, q) => q.depth - p.depth).forEach(f => {
      const dim = selected && !selected.holds(f) ? 0.3 : 1;
      const a = f.fade * dim;
      const rgb = altRGB(f.fl);
      if (!flat) {                                              // drop line to the ground
        const [gx, gy] = project(f.lon, f.lat, 0);
        ctx.save(); ctx.setLineDash([2, 3]);
        ctx.strokeStyle = `rgba(${rgb}, ${0.5 * a})`; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(f.sx, f.sy); ctx.stroke(); ctx.restore();
      }
      f.trail.forEach(([lon, lat, fl], i) => {                   // fading trail
        const [x, y] = project(lon, lat, fl * 100);
        ctx.fillStyle = `rgba(${altRGB(fl)}, ${(0.15 + i * 0.1) * a})`;
        ctx.beginPath(); ctx.arc(x, y, 1.5, 0, Math.PI * 2); ctx.fill();
      });
      if (flat) drawIcon(f, rgb, a, size);                      // 2D: flat icon
      else drawModel(f, rgb, a, size3d);                          // 3D: solid aircraft with a shadow

      const focus = f === hoveredFlight || f === openFlight;
      if (focus) {
        ctx.strokeStyle = `rgb(${INK})`; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(f.sx, f.sy, 14, 0, Math.PI * 2); ctx.stroke();
      }
      if (showTags || focus) {                                  // small data tag, like a radar label
        ctx.globalAlpha = a;
        ctx.font = '700 10px Manrope, system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
        ctx.fillStyle = `rgb(${INK})`; ctx.fillText(f.callsign, f.sx + 12, f.sy - 4);
        ctx.font = '600 10px Manrope, system-ui, sans-serif'; ctx.textBaseline = 'top';
        ctx.fillText(`${fmtFL(f.fl)} ${['↓', '', '↑'][f.vertical + 1]}`, f.sx + 12, f.sy - 2);
        ctx.globalAlpha = 1;
      }
    });
  }

  function card(x, y, w, h) {                                  // small cream box behind scales
    ctx.fillStyle = 'rgba(251, 244, 219, 0.92)';
    ctx.beginPath(); ctx.roundRect(x, y, w, h, 10); ctx.fill();
  }

  // 3D: a vertical scale for altitude. The 3D view has no perspective, so
  // one foot is the same number of pixels everywhere on screen.
  function drawAltitudeScale() {
    if (view.tilt < 0.2) return;
    const pxPerFt = altUnits(1) * Math.sin(view.tilt) * view.scale;
    const top = [46000, 30000, 20000, 10000, 5000, 2000].find(ft => ft * pxPerFt <= 190) || 2000;
    if (top * pxPerFt < 24) return;                           // too far out to read
    const step = top > 20000 ? 10000 : top > 5000 ? 5000 : 1000;
    const len = top * pxPerFt, x = 72, y0 = H - 30;
    const ticks = [];
    for (let ft = 0; ft < top; ft += step) ticks.push(ft);
    if (top - ticks[ticks.length - 1] > step * 0.3) ticks.push(top); else ticks[ticks.length - 1] = top;
    card(12, y0 - len - 34, 92, len + 52);
    ctx.fillStyle = `rgb(${INK})`; ctx.font = '700 11px Manrope, system-ui, sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    ctx.fillText('Altitude', 22, y0 - len - 14);
    // colour strip: the same colours as the planes
    const g = ctx.createLinearGradient(0, y0, 0, y0 - len);
    ALT_STOPS.forEach(([fl, c]) => g.addColorStop(Math.min(1, (fl * 100) / top), `rgb(${c.join(', ')})`));
    ctx.fillStyle = g; ctx.fillRect(x + 4, y0 - len, 5, len);
    ctx.strokeStyle = `rgb(${INK})`; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y0 - len); ctx.stroke();
    ctx.fillStyle = `rgb(${INK})`;
    ctx.font = '600 10px Manrope, system-ui, sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    const roomy = len / (ticks.length - 1) >= 14;               // label every tick only if they fit
    ticks.forEach((ft, i) => {
      const y = y0 - ft * pxPerFt;
      ctx.beginPath(); ctx.moveTo(x - 5, y); ctx.lineTo(x, y); ctx.stroke();
      if (roomy || i === 0 || i === ticks.length - 1) ctx.fillText(fmtFL(ft / 100), x - 8, y);
    });
    ctx.fillStyle = `rgba(${INK}, 0.7)`; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText(`Height ×${EXAG}`, 22, y0 + 6);
  }

  // 3D: soft haze toward the horizon (drawn under the planes, so they stay crisp)
  function drawHaze() {
    if (view.tilt < 0.02) return;
    const g = ctx.createLinearGradient(0, 0, 0, H * 0.45);
    g.addColorStop(0, `rgba(251, 244, 219, ${0.9 * Math.min(1, view.tilt)})`);
    g.addColorStop(1, 'rgba(251, 244, 219, 0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H * 0.45);
  }

  // On top of the map: the 3D haze, the altitude scale (3D) or the distance
  // scale (2D), and the north arrow.
  function drawOverlays() {
    const flat = view.tilt < 0.02;
    if (!flat) {
      drawAltitudeScale();
    } else {                                                   // 2D: scale bar in nautical miles
      const pxPerNM = view.scale / NM_PER_DEG;
      const nm = [10, 25, 50, 100, 200, 500].filter(n => n * pxPerNM <= 160).pop() || 10;
      const len = nm * pxPerNM, x = 24, y = H - 30;
      card(x - 10, y - 24, len + 20, 34);
      ctx.strokeStyle = `rgb(${INK})`; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x, y - 4); ctx.lineTo(x, y); ctx.lineTo(x + len, y); ctx.lineTo(x + len, y - 4); ctx.stroke();
      ctx.fillStyle = `rgb(${INK})`; ctx.font = '600 11px Manrope, system-ui, sans-serif';
      ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.fillText(`${nm} NM`, x, y - 6);
    }
    // north arrow (bottom right): points wherever north is on screen
    const [cx, cy] = project(view.lon, view.lat);
    const [nx, ny] = project(view.lon, view.lat + 1);
    const ang = Math.atan2(ny - cy, nx - cx) + Math.PI / 2;
    ctx.save();
    ctx.translate(W - 34, H - 36);
    card(-18, -24, 36, 44);
    ctx.rotate(ang);
    ctx.fillStyle = `rgb(${INK})`;
    ctx.beginPath(); ctx.moveTo(0, -10); ctx.lineTo(6, 8); ctx.lineTo(0, 4); ctx.lineTo(-6, 8); ctx.closePath(); ctx.fill();
    ctx.font = '700 10px Manrope, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText('N', 0, -11);
    ctx.restore();
  }

  // A faint radar over the map: range rings every 50 NM around the FIR's
  // centre and a slow sweep, drawn on the ground so it tilts in 3D too.
  const RADAR_C = [54.3, 24.6], RADAR_PERIOD = 9;
  const radarPoint = (nm, ang) => [RADAR_C[0] + (Math.sin(ang) * nm) / NM_PER_DEG / K, RADAR_C[1] + (Math.cos(ang) * nm) / NM_PER_DEG];
  // The faint radar on the map: range rings every 50 NM and a sweep that turns
  // once every RADAR_PERIOD seconds.
  function drawRadar(seconds) {
    ctx.save();
    ctx.strokeStyle = `rgba(${INK}, 0.12)`; ctx.lineWidth = 1;
    for (let nm = 50; nm <= 300; nm += 50) {
      path(Array.from({ length: 73 }, (_, i) => radarPoint(nm, (i / 72) * Math.PI * 2)), 0, false); ctx.stroke();
    }
    if (reduceMotion) { ctx.restore(); return; }
    const sweep = ((seconds / RADAR_PERIOD) % 1) * Math.PI * 2;   // clockwise from north, like a real scope
    const slices = 30, trail = Math.PI / 3, reach = 300;
    for (let i = 0; i < slices; i++) {
      const a1 = sweep - (trail * i) / slices, a0 = sweep - (trail * (i + 1)) / slices;
      path([RADAR_C, radarPoint(reach, a0), radarPoint(reach, (a0 + a1) / 2), radarPoint(reach, a1)]);
      ctx.fillStyle = `rgba(${INK}, ${0.08 * (1 - i / slices) ** 2})`; ctx.fill();
    }
    path([RADAR_C, radarPoint(reach, sweep)], 0, false);
    ctx.strokeStyle = `rgba(${INK}, 0.22)`; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.restore();
  }

  // Draw one whole frame, back to front. The order is what makes layers overlap correctly.
  function draw() {
    if (!W || !H) return;
    const flat = view.tilt < 0.02;
    drawGround();
    if (!flat) { drawAirways(); drawWaypoints(); }             // 3D: on the ground, under the blocks
    drawSectors();
    if (flat) drawAirways();                                   // 2D: on top of the sector colours
    drawRadar(performance.now() / 1000);                       // sweep passes over the sectors, under the planes
    if (flat) drawWaypoints();                                 // 2D: on top, so they stay readable
    drawHaze();
    drawFlights();
    drawWaypointLabel();
    drawOverlays();
  }

  // =======================================================
  // 8. Plane panel and sector chip
  // =======================================================
  const panel = $('plane-panel');

  // Open the plane panel for flight f.
  function openPanel(f) {
    openFlight = f;
    panel.classList.add('open');
    panel.setAttribute('aria-hidden', 'false');
    fillPanel();
  }
  // Close the plane panel.
  function closePanel() {
    openFlight = null;
    panel.classList.remove('open');
    panel.setAttribute('aria-hidden', 'true');
  }
  // Fill the plane panel with flight f's current details; runs 4 times a second
  // while it is open, so the numbers stay live.
  function fillPanel() {
    const f = openFlight;
    if (!f) return;
    if (!flights.includes(f)) { closePanel(); return; }        // it has left the map
    $('pp-call').textContent = f.callsign;
    $('pp-type').textContent = f.type;
    $('pp-from').textContent = f.from;  $('pp-from-name').textContent = AIRPORTS[f.from];
    $('pp-to').textContent = f.to;      $('pp-to-name').textContent = AIRPORTS[f.to];
    const pct = Math.round(f.progress * 100);
    $('pp-progress-text').textContent = `Through the FIR: ${pct}%`;
    $('pp-bar').style.width = `${pct}%`;
    $('pp-alt').textContent = `${fmtFL(f.fl)} ${['↓', '', '↑'][f.vertical + 1]}`;
    $('pp-alt').style.color = `rgb(${altRGB(f.fl)})`;
    $('pp-phase').textContent = f.phase;
    $('pp-gs').textContent = `${Math.round(f.gs)} kt`;
    $('pp-hdg').textContent = `${String(f.heading).padStart(3, '0')}°`;
    $('pp-sqk').textContent = f.squawk;
    const now = sectorOf(f), next = nextSector(f);
    $('pp-sector').textContent = now || next ? `${now ? now.id : 'Outside'} → ${next ? next.id : 'Exit'}` : 'Outside the FIR';
    $('pp-next').textContent = f.nextFix;
    $('pp-airway').textContent = f.airway;
  }
  $('pp-close').addEventListener('click', closePanel);

  const chip = $('sector-chip');
  // The chip at the top of the map that describes the selected sector.
  function updateChip() {
    if (!selected) { chip.hidden = true; return; }
    chip.hidden = false;
    chip.textContent = `${selected.id} · ${selected.band} · ${selected.count} aircraft · ${selected.status}`;
  }

  // =======================================================
  // 9. Mouse, touch and keyboard
  // =======================================================
  const tip = $('geo-tip');
  let pointer = null, drag = null, pinch = null;
  const touches = new Map();                                   // active pointers, for pinch zoom
  const local = e => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };

  function insideScreen(pts, x, y) {                           // ray casting on screen points
    let hit = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i], [xj, yj] = pts[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
    }
    return hit;
  }
  // the sector under the cursor: its roof (or its ground shape if it is flat)
  function sectorAt(x, y) {
    const roofs = sectors.map(s => ({
      s, pts: s.poly.map(([a, b]) => project(a, b, ceilFt(s))), d: project(s.lon, s.lat, ceilFt(s))[2]
    }));
    roofs.sort((p, q) => p.d - q.d);                            // nearest first
    const hit = roofs.find(r => insideScreen(r.pts, x, y));
    return hit ? hit.s : null;
  }
  // The flight nearest to screen point (x, y), within `radius` pixels.
  function flightAt(x, y, radius = 14) {
    if (!layers.traffic) return null;
    let best = null, bestD = radius;
    flights.forEach(f => { const d = Math.hypot(f.sx - x, f.sy - y); if (d < bestD) { best = f; bestD = d; } });
    return best;
  }

  // Mouse hover: find the plane or sector under the pointer, set the cursor and
  // show the sector tooltip.
  function updateHover() {
    if (!pointer || drag || pinch) return;
    const [x, y] = pointer;

    hoveredFlight = flightAt(x, y);
    hoveredSector = hoveredFlight ? null : sectorAt(x, y);
    canvas.classList.toggle('on-plane', !!hoveredFlight || !!waypointAt(x, y));   // pointer cursor on things you can click
    if (hoveredSector) {
      const s = hoveredSector;
      tip.textContent = `${s.band} · ${s.count} aircraft · ${s.status}`;   // name is on the map
      tip.style.left = Math.min(W - 110, Math.max(110, x)) + 'px';
      tip.style.top = Math.max(40, y) + 'px';
      tip.hidden = false;
    } else tip.hidden = true;
  }

  // Zoom by `factor` around screen point (x, y), keeping that point still.
  function zoomAt(factor, x = W / 2, y = H / 2) {
    anim = null;
    const [lon0, lat0] = unprojectGround(x, y);               // keep the point under the cursor fixed
    view.scale *= factor; clampView();
    const [lon1, lat1] = unprojectGround(x, y);
    view.lon += lon0 - lon1; view.lat += lat0 - lat1; clampView();
  }
  // Two-finger pinch: distance between the fingers and the point between them.
  const pinchInfo = () => {
    const [a, b] = [...touches.values()];
    return { d: Math.hypot(a[0] - b[0], a[1] - b[1]), x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2 };
  };

  // Pointer pressed: start a drag (one finger/mouse) or a pinch (two fingers).
  canvas.addEventListener('pointerdown', e => {
    anim = null;
    const [x, y] = local(e);
    touches.set(e.pointerId, [x, y]);
    canvas.setPointerCapture(e.pointerId);
    tip.hidden = true;
    if (touches.size === 2) { drag = null; pinch = pinchInfo(); return; }   // two fingers: pinch to zoom
    drag = { x, y, lon: view.lon, lat: view.lat, tilt: view.tilt, yaw: view.yaw, moved: false, touch: e.pointerType !== 'mouse' };
    canvas.classList.add('dragging');
  });
  // Pointer moves: pinch-zoom, drag (pan in 2D, rotate/tilt in 3D) or just hover.
  canvas.addEventListener('pointermove', e => {
    const [x, y] = local(e);
    if (touches.has(e.pointerId)) touches.set(e.pointerId, [x, y]);
    if (pinch && touches.size === 2) {
      const now = pinchInfo();
      zoomAt(now.d / pinch.d, now.x, now.y);
      pinch = now;
      return;
    }
    pointer = [x, y];
    if (drag) {
      const dx = x - drag.x, dy = y - drag.y;
      if (Math.hypot(dx, dy) > 4) drag.moved = true;
      if (mode === '3d') {                                     // 3D: drag turns and tilts the camera
        view.yaw = drag.yaw + dx * 0.006;
        view.tilt = Math.min(1.25, Math.max(0.35, drag.tilt - dy * 0.004));
      } else {                                                 // 2D: drag moves the map
        view.lon = drag.lon - dx / (K * view.scale);
        view.lat = drag.lat + dy / view.scale;
        clampView();
      }
    } else if (e.pointerType === 'mouse') updateHover();
  });
  // Pointer released: if it barely moved, treat it as a click on a plane or waypoint.
  function endPointer(e) {
    touches.delete(e.pointerId);
    if (touches.size < 2) pinch = null;
    const wasClick = drag && !drag.moved;
    const radius = drag && drag.touch ? 24 : 14;               // fingers need a bigger target
    drag = null; canvas.classList.remove('dragging');
    if (!wasClick || e.type === 'pointercancel') return;
    const [x, y] = local(e);
    const f = flightAt(x, y, radius);                          // click a plane: open its details
    if (f) { openPanel(f); return; }
    closePanel();
    const wp = waypointAt(x, y);                               // click a waypoint: show its name (click again to hide)
    openWaypoint = wp && wp !== openWaypoint ? wp : null;
  }
  // Finish a drag, pinch or click.
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  // Pointer leaves the map: clear the hover state and tooltip.
  canvas.addEventListener('pointerleave', () => {
    if (drag) return;
    pointer = null; hoveredFlight = null; hoveredSector = null;
    tip.hidden = true;
  });

  // Mouse wheel / trackpad zooms around the pointer (preventDefault stops the page scrolling).
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    zoomAt(Math.exp(-e.deltaY * 0.0015), ...local(e));
  }, { passive: false });
  // Double-click zooms in.
  canvas.addEventListener('dblclick', e => zoomAt(1.6, ...local(e)));

  // Keyboard: arrows move the map, + and - zoom, 0 resets, Escape closes things.
  canvas.addEventListener('keydown', e => {
    const step = 60 / view.scale;
    const moves = { ArrowLeft: [-step / K, 0], ArrowRight: [step / K, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    if (moves[e.key]) { anim = null; view.lon += moves[e.key][0]; view.lat += moves[e.key][1]; clampView(); e.preventDefault(); }
    else if (e.key === '+' || e.key === '=') { zoomAt(1.4); e.preventDefault(); }
    else if (e.key === '-') { zoomAt(1 / 1.4); e.preventDefault(); }
    else if (e.key === '0') { selectSector('all'); }
  });

  // ---- 2D / 3D switch ----
  // the starting view for the current mode (3D starts closer on phones)
  function defaultView() {
    const home = homeView();
    if (mode === '2d') return { ...home, ...VIEW_2D };
    return { ...home, ...VIEW_3D, scale: W < 640 ? fitScale * 1.5 : home.scale };
  }
  // Switch between the 2D and 3D views, animating the camera between them.
  function setMode(next) {
    mode = next;
    $('view-2d').setAttribute('aria-pressed', String(mode === '2d'));
    $('view-3d').setAttribute('aria-pressed', String(mode === '3d'));
    $('hint-3d').hidden = mode !== '3d';
    flyTo(selected ? (mode === '3d' ? VIEW_3D : VIEW_2D) : defaultView(), 900);
    if (selected) frameSelected(900);
  }
  $('view-2d').addEventListener('click', () => setMode('2d'));
  $('view-3d').addEventListener('click', () => setMode('3d'));

  // ---- Dropdown: sector + layers ----
  const menuBtn = $('menu-btn'), menuPanel = $('menu-panel');
  function setMenu(open) {
    menuPanel.hidden = !open;
    menuBtn.setAttribute('aria-expanded', String(open));
  }
  // The stack button opens and closes the sector/layers menu.
  menuBtn.addEventListener('click', () => setMenu(menuPanel.hidden));
  document.addEventListener('pointerdown', e => {              // click outside closes it
    if (!menuPanel.hidden && !$('menu').contains(e.target)) setMenu(false);
  });
  // Escape closes the menu first, then the plane panel.
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (!menuPanel.hidden) { setMenu(false); menuBtn.focus(); }
    else closePanel();
  });

  // Fly the camera so the selected sector fills most of the map.
  function frameSelected(ms = 800) {
    const b = selected.bounds;
    const fit = mode === '3d' ? 0.42 : 0.6;                    // 3D needs room for the block's height
    const scale = Math.min((W * fit) / ((b.maxLon - b.minLon) * K), (H * fit) / (b.maxLat - b.minLat));
    const target = { lon: (b.minLon + b.maxLon) / 2, lat: (b.minLat + b.maxLat) / 2, scale };
    if (anim) Object.assign(anim.to, target); else flyTo(target, ms);   // merge with a running 2D/3D switch
  }
  function selectSector(id) {
    selected = sectors.find(s => s.id === id) || null;
    menuPanel.elements.sector.value = selected ? selected.id : 'all';
    updateChip();
    if (selected) frameSelected(); else flyTo(defaultView());
  }
  // Menu changes: a sector radio button selects that sector; a switch turns a layer on or off.
  menuPanel.addEventListener('change', e => {
    const input = e.target;
    if (input.name === 'sector') selectSector(input.value);
    if (input.name === 'layer') {
      layers[input.value] = input.checked;
      if (input.value === 'traffic' && !input.checked) closePanel();
      if (input.value === 'waypoints' && !input.checked) openWaypoint = null;
    }
  });
  // The menu is a <form>, but it never submits: everything happens on change.
  menuPanel.addEventListener('submit', e => e.preventDefault());

  // ---- Simulation speed slider ----
  // Slider positions 0..5 are mapped to these speeds; 1x sits in the middle.
  const SPEEDS = [0, 0.25, 0.5, 1, 2, 4];
  const speedInput = $('sim-speed'), speedOut = $('sim-speed-out');
  let simSpeed = 1;
  // Speed slider: positions 0-5 map to Paused, 0.25x, 0.5x, 1x, 2x and 4x.
  speedInput.addEventListener('input', () => {
    simSpeed = SPEEDS[Number(speedInput.value)];
    const text = simSpeed === 0 ? 'Paused' : `${simSpeed}×`;
    speedOut.textContent = text;
    speedInput.setAttribute('aria-valuetext', text);   // screen readers say "2×", not "4"
  });

  // =======================================================
  // 10. Animation loop
  // =======================================================
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!reduceMotion && simSpeed > 0) step(dt * simSpeed);
    sectors.forEach(s => {                                     // blocks grow up or settle down
      const target = mode === '3d' && (!selected || s === selected) ? 1 : 0;
      s.rise = reduceMotion ? target : s.rise + (target - s.rise) * Math.min(1, dt * 5);
    });
    runAnim(now);
    updateHover();
    draw();
    requestAnimationFrame(frame);
  }
  setInterval(() => { fillPanel(); updateChip(); }, 250);  // panel and chip refresh 4x a second

  new ResizeObserver(resize).observe(canvas);
  resize();
  requestAnimationFrame(frame);

  // =======================================================
  // 11. Opening air show
  // =======================================================
  // Each time the page loads, a 3D plane flies in from the bottom-right
  // corner, does a short display with a white smoke trail, then comes
  // down and lands at Dubai International on the map.
  (function airShow() {
    const show = $('show'), skipBtn = $('skip-show');
    if (reduceMotion) { show.remove(); skipBtn.remove(); return; }
    const sctx = show.getContext('2d');

    const DUBAI = [55.364, 25.253];    // Dubai International (OMDB)
    const FOCAL = 900;                 // camera focal length, in px
    const HALF = 130;                  // half the plane's length, in world px
    const LAND_SIZE = 9;               // half length on screen when it lands (like the map planes)
    const DURATION = 10;               // seconds
    const SMOKE_LIFE = 2.6;            // seconds a smoke puff lasts
    const BODY = [44, 68, 102];                 // navy, lit from one side
    const SHOW_LIGHT = (() => { const v = [-0.4, 0.7, -0.6], n = Math.hypot(...v); return v.map(x => x / n); })();

    let VW = 0, VH = 0, path = [], plannedEnd = [0, 0];
    let start = null, puffs = [], lastPuff = 0, finished = false, landedAt = null;

    // ---- small vector helpers ----
    const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
    const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    // Multiply a 3D vector by a number.
    const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
    // Dot product: how much two directions point the same way (used for lighting).
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    // Cross product: a vector at right angles to both (used for panel normals and the plane's axes).
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    // Scale a vector to length 1.
    const norm = a => mul(a, 1 / (Math.hypot(...a) || 1));
    // Smoothstep: 0 before a, 1 after b, and an S-shaped ease in between.
    const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

    // world: x right, y up, z away from the viewer (px). Perspective: far = small.
    const toScreen = ([X, Y, Z]) => { const k = FOCAL / (FOCAL + Z); return [VW / 2 + X * k, VH / 2 - Y * k, k]; };
    const toWorld = (px, py, z) => { const k = FOCAL / (FOCAL + z); return [(px - VW / 2) / k, (VH / 2 - py) / k, z]; };
    // Where Dubai International is on the screen right now (the landing target).
    function dubaiOnScreen() {
      const r = canvas.getBoundingClientRect();
      const [x, y] = project(...DUBAI);
      return [r.left + x, r.top + y];
    }

    // The flight path: points as [share of width, share of height, depth].
    // It starts far away (small), swoops close to the screen (big),
    // climbs away, then descends onto Dubai.
    function buildPath() {
      const zLand = (FOCAL * HALF) / LAND_SIZE - FOCAL;          // depth where it matches the map planes
      const [lx, ly] = dubaiOnScreen();
      plannedEnd = [lx, ly];
      const keys = [
        [1.15, 1.1, 2400], [0.9, 0.82, 1500], [0.66, 0.62, 700], [0.4, 0.42, 220],
        [0.17, 0.5, 120], [0.2, 0.8, 300], [0.46, 0.8, 90], [0.72, 0.56, 40],
        [0.86, 0.28, 380], [0.66, 0.12, 1300], [0.42, 0.26, 2800]
      ].map(([fx, fy, z]) => toWorld(fx * VW, fy * VH, z));
      keys.push(toWorld(lx - 0.08 * VW, ly - 0.1 * VH, zLand * 0.55));   // final approach
      keys.push(toWorld(lx, ly, zLand));                                 // touchdown

      // Centripetal Catmull-Rom spline through the points: smooth curves
      // with no sudden kinks or loops between points, sampled finely.
      const first = add(keys[0], sub(keys[0], keys[1])), last = add(keys[keys.length - 1], sub(keys[keys.length - 1], keys[keys.length - 2]));
      const pts = [first, ...keys, last];
      // Straight-line blend between points a and b, for x between ta and tb.
      const lerp = (a, b, ta, tb, x) => add(mul(a, (tb - x) / (tb - ta)), mul(b, (x - ta) / (tb - ta)));
      // Centripetal spacing between two points (square root of the distance):
      // this is what keeps the curve from looping or kinking.
      const knot = (a, b) => Math.sqrt(Math.hypot(...sub(b, a))) || 1e-3;
      const raw = [];
      for (let i = 1; i < pts.length - 2; i++) {
        const [p0, p1, p2, p3] = [pts[i - 1], pts[i], pts[i + 1], pts[i + 2]];
        const t0 = 0, t1 = knot(p0, p1), t2 = t1 + knot(p1, p2), t3 = t2 + knot(p2, p3);
        for (let s = 0; s < 1; s += 0.01) {
          const x = t1 + (t2 - t1) * s;
          const a1 = lerp(p0, p1, t0, t1, x), a2 = lerp(p1, p2, t1, t2, x), a3 = lerp(p2, p3, t2, t3, x);
          const b1 = lerp(a1, a2, t0, t2, x), b2 = lerp(a2, a3, t1, t3, x);
          raw.push(lerp(b1, b2, t1, t2, x));
        }
      }
      raw.push(keys[keys.length - 1]);
      // even spacing along the path (depth counts less, so far-away parts don't rush)
      const len = [0];
      for (let i = 1; i < raw.length; i++) {
        const d = sub(raw[i], raw[i - 1]);
        len.push(len[i - 1] + Math.hypot(d[0], d[1], d[2] * 0.35));
      }
      const total = len[len.length - 1], N = 3000;
      path = [];
      for (let i = 0, j = 0; i <= N; i++) {
        // Distance along the path for sample i.
        const target = (i / N) * total;
        while (j < raw.length - 2 && len[j + 1] < target) j++;
        // How far between the two neighbouring raw points this sample falls.
        const t = (target - len[j]) / ((len[j + 1] - len[j]) || 1);
        path.push(add(raw[j], mul(sub(raw[j + 1], raw[j]), t)));
      }
    }
    const at = f => {                                             // position at 0..1 along the path
      const x = Math.min(1, Math.max(0, f)) * (path.length - 1), i = Math.floor(x), t = x - i;
      const a = path[i], b = path[Math.min(path.length - 1, i + 1)];
      return add(a, mul(sub(b, a), t));
    };

    // Fit the show canvas to the window and rebuild the flight path for that size.
    function resizeShow() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      VW = window.innerWidth; VH = window.innerHeight;
      show.width = Math.round(VW * dpr); show.height = Math.round(VH * dpr);
      sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      buildPath();
    }

    // The plane's frame at a point: forward along the path, banked into
    // turns (like a real coordinated turn), plus one barrel roll.
    let bankUp = [0, 1, 0], lastFrame = null;
    function frameAt(f, t, dt) {
      const p = at(f);
      const F = norm(sub(at(f + 0.01), at(f - 0.01)));            // direction, looked at over a wide span
      const e = 0.03, p1 = at(f + e), p0 = at(f - e);
      const step = Math.max(1, Math.hypot(...sub(p1, p)));
      const acc = mul(sub(add(p1, p0), mul(p, 2)), 1 / (step * step));   // curvature
      const lateral = sub(acc, mul(F, dot(acc, F)));
      const target = norm(add([0, 1, 0], mul(lateral, 420)));
      bankUp = norm(add(bankUp, mul(sub(target, bankUp), 1 - Math.exp(-dt * 4))));   // ease into banks
      let U = bankUp;
      let R = norm(cross(U, F));
      U = norm(cross(F, R));
      const roll = Math.PI * 2 * smooth(0.6, 0.7, t);             // barrel roll after the swoop
      const c = Math.cos(roll), s = Math.sin(roll);
      [R, U] = [add(mul(R, c), mul(U, s)), sub(mul(U, c), mul(R, s))];
      return { p, F, R, U };
    }

    // Draw the navy 3D plane at position p, oriented by its forward (F), right (R)
    // and up (U) directions, panel by panel from farthest to nearest.
    function drawPlane({ p, F, R, U }, alpha) {
      const world = ([a, b, c]) => add(p, mul(add(add(mul(F, a), mul(R, b)), mul(U, c)), HALF));
      MODEL.map(face => {
        const w = face.map(world);
        const n = norm(cross(sub(w[1], w[0]), sub(w[2], w[0])));
        const light = Math.abs(dot(n, SHOW_LIGHT));
        return { pts: w.map(toScreen), depth: w.reduce((s, q) => s + q[2], 0) / w.length, light };
      }).sort((a, b) => b.depth - a.depth).forEach(({ pts, light }) => {
        const k = 0.45 + 0.85 * light;
        const c = BODY.map(x => Math.round(k <= 1 ? x * k : x + (255 - x) * (k - 1) * 0.9));
        sctx.beginPath();
        pts.forEach(([x, y], j) => (j ? sctx.lineTo(x, y) : sctx.moveTo(x, y)));
        sctx.closePath();
        sctx.fillStyle = `rgba(${c.join(', ')}, ${alpha})`; sctx.fill();
        sctx.strokeStyle = `rgba(${c.map(x => Math.round(x * 0.6)).join(', ')}, ${alpha})`;
        sctx.lineWidth = 1; sctx.lineJoin = 'round'; sctx.stroke();
      });
    }

    // The white smoke trail: each puff grows and fades over SMOKE_LIFE seconds.
    function drawSmoke(now) {
      puffs = puffs.filter(q => now - q.born < SMOKE_LIFE);
      puffs.forEach(q => {
        const age = now - q.born;
        const r = q.k * (6 + age * 34);                            // puffs spread out as they age
        sctx.fillStyle = `rgba(255, 255, 255, ${0.42 * (1 - age / SMOKE_LIFE) ** 1.5})`;
        sctx.beginPath(); sctx.arc(q.x, q.y - age * 10 * q.k, r, 0, Math.PI * 2); sctx.fill();
      });
    }

    // End the show: remove its canvas and the Skip button.
    function finish() {
      finished = true;
      show.remove(); skipBtn.remove();
    }
    // "Skip intro" ends the show at once.
    skipBtn.addEventListener('click', finish);

    // One frame of the show: move along the path, bank into turns, add smoke,
    // then land, fade into the map and pulse a ring at Dubai.
    function tick(ms) {
      if (finished) return;
      const now = ms / 1000;
      if (start === null) start = now;
      const t = Math.min(1, (now - start) / DURATION);
      const f = t * t * (3 - 2 * t) * 0.15 + t * 0.85;            // gentle start, steady middle
      sctx.clearRect(0, 0, VW, VH);

      const dt = lastFrame === null ? 0.016 : Math.min(0.05, now - lastFrame);
      lastFrame = now;
      const fr = frameAt(f, t, dt);
      // if the map moved during the show, steer the landing to Dubai's new spot
      const [lx, ly] = dubaiOnScreen();
      const w = smooth(0.82, 1, t);
      const shift = [(lx - plannedEnd[0]) * w, (ly - plannedEnd[1]) * w];
      const k = FOCAL / (FOCAL + fr.p[2]);
      fr.p = add(fr.p, [shift[0] / k, -shift[1] / k, 0]);

      // smoke from the tail, until the final approach
      if (t < 0.84 && now - lastPuff > 0.016) {
        const [x, y, kk] = toScreen(sub(fr.p, mul(fr.F, HALF)));
        puffs.push({ x, y, k: kk, born: now });
        lastPuff = now;
      }
      drawSmoke(now);

      if (t < 1) drawPlane(fr, 1);
      else {
        if (landedAt === null) landedAt = now;
        const since = now - landedAt;
        drawPlane(fr, Math.max(0, 1 - since / 0.6));              // the show plane fades into the map
        const ring = Math.min(1, since / 1.1);                    // touchdown pulse at Dubai
        sctx.strokeStyle = `rgba(19, 35, 58, ${0.8 * (1 - ring)})`; sctx.lineWidth = 2;
        sctx.beginPath(); sctx.arc(lx, ly, 6 + ring * 30, 0, Math.PI * 2); sctx.stroke();
        if (since > 1.2 && puffs.length === 0) { finish(); return; }
      }
      requestAnimationFrame(tick);
    }

    // If the window resizes during the show, refit the path to the new size.
    window.addEventListener('resize', () => { if (!finished) resizeShow(); });
    requestAnimationFrame(() => { resizeShow(); requestAnimationFrame(tick); });   // after the map has its size
  })();
})();
