# How FIRCast works

A guide for the team. It explains the ideas behind the code; the comments in each file explain the details line by line. If you only read one thing before editing, read the colour section, because almost everything visual depends on it.

## Colours and fonts

The palette is defined once, at the top of `css/base.css`, as CSS custom properties:

| Token | Value | Used for |
|---|---|---|
| `--powder-blue` | `#84B4E6` | Main background, calm sectors |
| `--sweet-corn` | `#FBF4DB` | Second background, cards, light text on navy |
| `--spicy-orange` | `#DD110A` | Overloaded sectors, warnings, the one strong accent |
| `--busy` | `#F3C63F` | Busy sectors (butter yellow) |
| `--ink` | `#13233A` | Text, the navy nav pill, buttons |
| `--muted` | `#2B4566` | Secondary text |

Any CSS rule that needs a colour reads it with `var(--ink)` and so on. Canvas drawing can't read CSS variables cheaply every frame, so the scripts copy the same values as constants near the top (for example `LEVEL_RGB` in `hero-map.js` and `map.js`). If you change a token, search the JS for its hex value too.

Headlines and big numbers use Bricolage Grotesque; everything else uses Manrope. Both come from Google Fonts in the `<head>` of each page.

`--ease` is the one easing curve used almost everywhere: `cubic-bezier(0.22, 1, 0.36, 1)`. It starts fast and settles slowly, which is why things on the site seem to glide into place rather than slide at a constant speed. `--lift` holds the soft shadows under cards.

## The navigation bar

The bar is `position: absolute`, not fixed, so it scrolls away with the page. `js/shared/nav.js` watches the scroll position and adds the class `.is-compact` after 48 px; `base.css` then shrinks the bar to just the logo. It only grows back once you are within 8 px of the top. Using two different thresholds stops it flickering when you hover near the top.

The current page is marked in the HTML with `aria-current="page"`. CSS selects that attribute and draws the navy pill, and screen readers announce "current page" from the same attribute, so one attribute does both jobs. On the home page the pill is the FIRCast logo; the logo image is turned cream with a CSS `filter` instead of needing a second image file.

## Home page

### The background story (`story-scene.js`)

There is one canvas fixed behind the whole page. Every `<section>` carries two attributes:

- `data-story="start end"`: which stretch of the story plays while that section scrolls past;
- `data-theme="blue"` or `"corn"`: which background colour it wants.

On each frame the script works out how far you have scrolled through the section on screen and turns that into a single number, the story time `T`. Roughly, 0 is calm sky, 1 is traffic building, 2 is tension, 3 is the forecast, and 4 is the sector splitting. The `draw(T)` function paints that moment: how many planes there are (`DENSITY`), where two converging aircraft are, and so on. Scrolling back simply plays it backwards, because the picture depends only on `T`, not on what was drawn before.

The background colour is blended between powder blue and sweet corn in the same way, so it changes smoothly as one section hands over to the next.

### Glass panels

The text panels sit on top of the moving scene, so they use `backdrop-filter: blur(16px) saturate(1.15)` with a semi-transparent fill (the `.glass` class in `home.css`). The blur hides detail behind the text and keeps it readable without hiding the scene completely.

### The hero card (`hero-card.js`)

- **Word reveal.** The script wraps each headline word in a `<span>` and gives it a CSS variable `--i` (its index). A CSS keyframe animation moves each word up from below with `animation-delay` based on `--i`, so the words rise one after another.
- **Flight path.** A curved SVG path is built across the top of the card and a small plane follows it along a dotted line.
- **Tilt and spotlight.** On mouse movement the script sets `--rx` and `--ry` (rotation) and `--mx` and `--my` (pointer position). CSS uses them in `transform: perspective(...) rotateX(...) rotateY(...)` and in a radial gradient, so the card leans toward the cursor and a soft light follows it. This only runs for a real mouse, not touch.

### The live map card (`hero-map.js`)

This is a small simulation, written with four classes:

- `Sector` knows its outline and counts the aircraft inside it with a ray-casting test (`contains`). Its busy level uses *hysteresis*: it takes 3 aircraft to become Busy and 5 to become Overloaded, but it only drops back at 3 and 1. Without that gap, a sector sitting on a threshold would flash between colours.
- `Route` is a path through map space with the distance to each point precomputed, so an aircraft can be placed by "distance travelled".
- `Aircraft` moves along a route.
- `Airspace` owns all of the above and runs one simulation step.

Sector colours never jump. Each frame, `fadeColour` moves the current RGB a fraction of the way toward the target colour, which gives a fade of about half a second.

The Map / Table switch shows one of two panels. The table is rebuilt from the same sector objects once a second; clicking a column header sorts it, and rows that change position slide there using the Web Animations API (`element.animate`). The "last 10 s" column compares each sector's count now with its count ten seconds ago.

The clock uses `setInterval` and the `Date` object, with a `<select>` to switch between UTC and local time. Under a mouse, a "radar lens" (a radial gradient ring) follows the pointer over the map.

### Sections 2, 3 and 4

- **Section 2 (`scale.js`).** Elements with `.on-scroll` start transparent and slightly lower. An `IntersectionObserver` adds `.is-visible` when they come on screen, and a CSS transition does the rest. The big number counts up to 1,000,000 using tabular digits so it doesn't wobble. The live counter adds one flight every 31.6 s on average: 366 days in 2024 divided by about a million movements.
- **Section 3 (`problem-timeline.js`).** The section is much taller than the screen and its panel is `position: sticky`, so the panel stays put while you scroll through it. Scroll progress moves a marker across a canvas chart and lights up the three steps. The workload curve is illustrative.
- **Section 4 (`tagline.js`).** The same sticky trick. As you scroll, the words light up one by one, then the runway edge lights come on in pairs, then a plane touches down.

## Map page

### One camera for 2D and 3D (`map.js`, section 6)

The map does not have separate 2D and 3D renderers. Every point goes through `project(lon, lat, feet)`, which acts like a camera with two angles:

- `tilt`: 0 looks straight down (that is the 2D view); about 0.95 radians tips the camera back for 3D;
- `yaw`: turns the camera around the map.

Switching views just animates `tilt` and `yaw` between `VIEW_2D` and `VIEW_3D`, which is why the map seems to fold up into 3D rather than cutting. `projectG` does the actual rotation maths; `unprojectGround` goes the other way, from a mouse position back to a longitude and latitude, which is how clicks find planes and waypoints.

Heights in 3D are drawn 8 times taller than real (`EXAG = 8`). Without that, FL400 above a 300 km wide FIR would look almost flat. The 3D view prints "Height ×8" next to its scale so nobody is misled.

### Flights

Flight plans are precomputed and stored in `data/airspace.js`. They were found with Dijkstra's shortest-path algorithm over the real eAIP route network, with three rules: respect one-way routes, never turn more than 100° at a waypoint, and end at a UAE airport or a FIR exit. Each plan is an overflight, an arrival or a departure.

In the browser, a `Flight` moves along its plan in real seconds × `TIME_SCALE` (30), so traffic moves fast enough to watch. Altitude comes from distance: arrivals descend at roughly 3 NM per 1,000 ft (a common rule of thumb), departures climb a little more slowly, and overflights stay at cruise. Speed is 250 kt below FL100 and builds to cruise speed by FL300. Before the page appears, the simulation quietly runs for two minutes so the sky is already full.

Plane colour shows altitude. `ALT_STOPS` lists five colours from green at the ground to plum at FL400, and `altRGB` blends between the two nearest stops. The "Flight level" key at the bottom is generated from the same list, so the key and the planes can't disagree.

### Sectors

Sectors use the same three levels and colours as the home page. In 2D every sector is flat. In 3D the selected sector rises as a block between its floor and ceiling and the others stay flat, so the view doesn't turn into a pile of overlapping boxes. **The sectors are placeholders drawn by the team, not real Emirates ACC sectors.**

### The dropdown

The dropdown is a real `<form>`. Radio buttons pick one sector; checkboxes switch layers (planes, airways, waypoints, FIR). One `change` listener on the form reads its state and redraws, so adding a new layer means adding one checkbox and one `if` in the drawing code.

### Radar background (`radar-background.js`)

The rings and bearing ticks never change, so they are drawn once to an off-screen canvas. Each frame copies that image and then draws the sweep: a 60° wedge made of thin slices whose opacity drops off behind the leading edge, which gives the fading-trail look. A few echoes brighten as the sweep passes them and then fade.

### The opening air show

On each page load a navy 3D plane flies a curved path with a smoke trail and lands on Dubai International, shrinking to the size of the map's planes as it touches down. It is drawn on its own canvas over the page with `pointer-events: none`, so clicks pass straight through to the map. The plane is a handful of flat panels; each panel's brightness comes from a dot product between its normal and a fixed light direction (`SHOW_LIGHT`), which is the simplest form of 3D shading. "Skip intro" ends it early.

## Reduced motion

Both pages check `prefers-reduced-motion`. When a visitor has asked their system for less motion, the background story stops moving, the air show is removed, the radar is still, and reveals become simple fades. Please keep this working if you add new animation: give it a calm fallback in the `@media (prefers-reduced-motion: reduce)` block at the end of the CSS file, and check `reduceMotion` in JavaScript.
