# SEAL website (fully online, no server needed)

Plain HTML/CSS/JS. Published to GitHub Pages by `.github/workflows/pages.yml`; works on any static web host.
Three.js r128 (3D Moon) is bundled in `vendor/three.min.js` with its MIT license. Chart.js loads from cdnjs only when the first analysis is run.

The landing page opens over the rotating Moon, then scrolls through a white mission-context section and a black goal section. NASA's Artemis II Vavilov Crater image and Marshall Artemis operations-room photo are stored in `images/` and credited in their captions.

Flow: landing page → pick a site or drop a pin → **landing calendar pops up** (Google-Flights style: each date shows days of operation, green/yellow/orange; battery + night-power inputs; click a date for the power plan; **trade-off table** of the best landing per lunar day vs battery needed to survive the first night) →
then: landing page → **Locate the place** → interactive map of the lunar south pole.
Click a site marker or **anywhere** → info panel → dates → **Analyse** → verdict, sunset/Earthset countdown, Sun height, **Time machine** slider (moves Sun/Earth on the sky view and redraws Sun shadows / Earth visibility on the map), **Landing-date finder** (90-day strip coloured by days of power + radio), charts, Compare, Export CSV.

All maths runs in the visitor's browser (`engine.js`, a JS mirror of `science/`):
- `data/ephemeris.json`, Sun & Earth Moon-fixed positions every 6 h, 2025-2028, built from NASA JPL Horizons
  (DE441, MEAN_ME). Interpolated values match fresh Horizons az/el to < 0.00001° (IM-2, Haworth, de Gerlache, hourly, Mar 2025).
- `data/terrain.json` + `data/terrain.bin`, LOLA height grid, 240 m, 80 to 90°S (from lmaoxd's exporter, `science/terrain_export/`,
  format in `docs/TERRAIN_FORMAT.md`). SEAL traces the real skyline (720 directions, 150 km); outside the grid the horizon is flat.
- `data/sites.json`, 7 Artemis presets plus past landings (copy of `docs/sites.json`). Artemis presets carry their 2025 sunlight and the best lit spot within 5 km (`light`).

Moon: 3D globe (Three.js, `globe.js`) with `moon_global.jpg` (LRO WAC global mosaic, NASA Moon Trek) and `south_pole_wac.jpg`
(LRO WAC south-pole mosaic, ±320 km) blended into the south-pole cap. `south_pole_lola.jpg` is the landing-page background. The globe and polar cap appear as their own textures finish loading. Optional LOLA terrain loads in parallel with the interface; coarse relief appears first, then `reliefImageAsync` refines it in idle-time chunks. Near the pole the photo is replaced by relief lit live from the LOLA slopes and the real Sun, plus cast shadows, so all shadows move together.
Layout: drag the divider between Moon and results; the Time machine stays pinned while the charts scroll.
Test locally: `python3 -m http.server 8000` in this folder → http://localhost:8000

Power model (`batteryPlan`, `missionCalendar`, `tradeoffs` in engine.js): hourly Sun/Earth flags; landing needs Sun up + Earth in view.
Sun charges the battery to full; in darkness the lander draws the night power (default 100 W). Operation ends in the first dark spell
the battery can't cover. Battery needed = night power × night hours ÷ 0.8 usable; mass at 150 Wh/kg (assumptions, editable power).
