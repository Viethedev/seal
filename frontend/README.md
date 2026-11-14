# SEAL website (fully online, no server needed)

Plain HTML/CSS/JS. Upload this whole folder to any static web host (e.g. the free Space Apps domain + hosting).
Leaflet (map) and Chart.js (charts) load from cdnjs.

Flow: landing page → pick a site or drop a pin → **landing calendar pops up** (Google-Flights style: each date shows days of operation, green/yellow/orange; battery + night-power inputs; click a date for the power plan; **trade-off table** of the best landing per lunar day vs battery needed to survive the first night) →
then: landing page → **Locate the place** → interactive map of the lunar south pole.
Click a site marker or **anywhere** → info panel → dates → **Analyse** → verdict, sunset/Earthset countdown, Sun height, **Time machine** slider (moves Sun/Earth on the sky view and redraws Sun shadows / Earth visibility on the map), **Landing-date finder** (90-day strip coloured by days of power + radio), charts, Compare, Export CSV.

All maths runs in the visitor's browser (`engine.js`, a JS mirror of `science/`):
- `data/ephemeris.json`, Sun & Earth Moon-fixed positions every 6 h, 2025-2028, built from NASA JPL Horizons
  (DE441, MEAN_ME). Interpolated values match fresh Horizons az/el to < 0.00001° (IM-2, Haworth, de Gerlache, hourly, Mar 2025).
- `data/terrain.json` + `data/terrain.bin`, *optional* LOLA height grid (from lmaoxd's terrain reader, format in
  `docs/TERRAIN_FORMAT.md`). Without it the horizon is flat; with it SEAL traces the real skyline (720 directions, 150 km).
- `data/sites.json`, the 7 Artemis presets (copy of `docs/sites.json`).

Moon: 3D globe (three.js, `globe.js`) with `moon_global.jpg` (LRO WAC global mosaic, NASA Moon Trek) and `south_pole_wac.jpg`
(LRO WAC south-pole mosaic, ±320 km) blended into the south-pole cap. `south_pole_lola.jpg` is the landing-page background. Lit by the real Sun at the chosen time; Sun-shadow / Earth-visibility overlay on the cap.
Layout: drag the divider between Moon and results; the Time machine stays pinned while the charts scroll.
Test locally: `python3 -m http.server 8000` in this folder → http://localhost:8000

Power model (`batteryPlan`, `missionCalendar`, `tradeoffs` in engine.js): hourly Sun/Earth flags; landing needs Sun up + Earth in view.
Sun charges the battery to full; in darkness the lander draws the night power (default 100 W). Operation ends in the first dark spell
the battery can't cover. Battery needed = night power × night hours ÷ 0.8 usable; mass at 150 Wh/kg (assumptions, editable power).
