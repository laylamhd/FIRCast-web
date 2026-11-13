# FIRCast

FIRCast is a website for our senior project idea: forecasting how complex each air traffic control sector in the Emirates FIR will get, early enough to split or merge sectors before controllers are overloaded. The site has two pages. The home page tells the story of the problem, and the map page lets you explore the UAE airspace with simulated traffic in 2D and 3D.

It was also built for our Web Programming course, so it uses only plain HTML, CSS and JavaScript. There are no libraries, frameworks or build tools.

## Running it

Download or clone the repository and open `index.html` in a browser. That's all. No server is needed, because the data files are loaded as ordinary `<script>` tags instead of being fetched.

We tested it in Chromium (the engine behind Chrome and Edge). Give it a quick look in Firefox and Safari before a demo.

## Folder structure

```
fircast-web/
├── index.html                 Home page
├── map.html                   Full interactive map
├── assets/
│   └── images/                Logo and favicon
├── css/
│   ├── base.css               Shared: colour and font tokens, reset, nav bar, buttons
│   ├── home.css               Home page only
│   └── map.css                Map page only
├── data/
│   ├── airspace.js            FIR, routes, waypoints, sectors and flight plans
│   ├── land-home.js           Coastlines for the small map on the home page
│   └── land-region.js         Coastlines for the full map (Middle East)
├── js/
│   ├── shared/
│   │   └── nav.js             Shrinks the nav bar on scroll (both pages)
│   ├── home/
│   │   ├── story-scene.js     Animated background that follows the scroll
│   │   ├── hero-card.js       Headline word reveal, card tilt and spotlight
│   │   ├── hero-map.js        Live airspace card, sector table, clock, speed slider
│   │   ├── scale.js           Scroll reveal, counting number, live flight counter
│   │   ├── problem-timeline.js  Section 3 chart driven by scrolling
│   │   └── tagline.js         Section 4 words, runway lights and landing plane
│   └── map/
│       ├── map.js             The full map: projection, 2D/3D, traffic, controls, air show
│       └── radar-background.js  Faint radar sweep behind the page
└── docs/
    └── HOW-IT-WORKS.md        Colours, animations and the map explained for the team
```

The layout follows a common convention: one folder per file type, then one file per page or feature inside it. Shared code lives in `css/base.css` and `js/shared/`, and each page loads only the files it needs. Every file starts with a header comment saying what it does, which page uses it and what must be loaded before it.

## How the code is organised

Each HTML page loads `css/base.css` first and then its own stylesheet, so page styles can build on the shared tokens. Scripts are loaded at the bottom of `<body>` in this order: data first, then the page's scripts, then `nav.js`. The page scripts expect the data globals (`AIRSPACE_DATA`, `LAND_HOME`, `LAND_REGION`) to exist already, so keep that order if you add files.

All colours, fonts, shadows and the main easing curve are CSS custom properties defined once in `:root` in `base.css`. Change a colour there and it changes everywhere. Where JavaScript draws on a canvas it uses the same hex values; those are listed at the top of each script.

For a walk-through of the animations, the background story and the map projection, read [docs/HOW-IT-WORKS.md](docs/HOW-IT-WORKS.md).

## Course topics covered

| Topic | Where to look |
|---|---|
| Semantic HTML and accessibility | Landmarks, skip link, `aria-*` attributes in both pages |
| Forms and inputs | Sector and layer dropdown (`map.html`), time zone `<select>`, speed sliders |
| Tables | Sortable sector table in the home map card (`hero-map.js`) |
| CSS layout and responsive design | Grid and flexbox throughout; phone sizes at the end of each CSS file |
| CSS transitions and keyframe animations | `home.css` (word reveal, glass panels, runway lights) |
| DOM manipulation and events | Every script; for example click, change, pointermove, keydown, scroll |
| Classes, arrays and objects | `Sector`, `Route`, `Aircraft`, `Airspace` in `hero-map.js`; `Sector` and `Flight` in `map.js` |
| Canvas and SVG | All maps and charts are canvas; icons and the flight path are SVG |
| Timers and the Date object | Live UTC/local clock, the live flight counter, `requestAnimationFrame` loops |

## Data sources

| Data | Source | Notes |
|---|---|---|
| Emirates FIR boundary, ATS routes, waypoints | UAE eAIP, AIRAC AMDT 09/2026 (effective 3 Sep 2026): ENR 2.1, ENR 3.2, ENR 4.4 | Converted to JSON by the team. The FIR edge along the Saudi border is simplified to straight lines. |
| Coastlines and borders | [Natural Earth](https://www.naturalearthdata.com/) 4.1.0, 1:10m countries | Public domain. Cropped and simplified. |
| 1,000,000+ movements in 2024 | GCAA via [WAM](https://www.wam.ae/en/article/15csky7-uae-sets-historic-record-aviation-sector-with-over), 6 Jan 2025 | |
| +10.3% growth on 2023 | GCAA figures reported by [Gulf News](https://gulfnews.com/business/aviation/uae-records-over-1-million-air-movements-in-2024-gcaa-1.500011290), Jan 2025 | |

**What is not real.** The seven sectors (S1 to S7) are placeholders we drew by dividing the FIR; they are not the real Emirates ACC sectors. All aircraft, flight plans, callsigns and workload numbers are simulated. The flights follow real routes, but the traffic is not live and not based on recorded data. The "one flight every ~32 seconds" figure is our own arithmetic from the yearly total. The section 3 chart is illustrative.

## Contributing

- Keep the folder layout: page-specific code goes in that page's CSS file and JS folder, shared code in `base.css` or `js/shared/`.
- Use the tokens in `base.css` rather than new hex values.
- Start every new file with a header comment like the existing ones, and comment each function and CSS block.
- `.editorconfig` sets two-space indentation and UTF-8; most editors pick it up automatically.
- Respect `prefers-reduced-motion`. Every animation in the project has a calmer fallback.

## Team

FIRCast senior project team. Add names here.
