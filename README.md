# SEAL: Sun-Earth Analysis for Landing

NASA Space Apps 2026, Lunar Landing Site Navigator challenge.

Pick a landing site at the Moon's south pole and a landing date. SEAL shows when the **Sun** lights the lander (power), when **Earth** is in view (radio), how many days the mission keeps working, and what battery it needs to survive the lunar night.

**Live app:** https://viethedev.github.io/seal/ (runs in any browser, nothing to install)

## What it does

- **3D Moon** with NASA LRO imagery. Near the south pole the surface is lit live from NASA LOLA terrain heights and the real Sun position, so crater shadows move as time passes.
- **Landing calendar**: every landing date coloured by how many days the lander would work, Google Flights style.
- **Power plan**: days on solar only, the first night, the battery needed to survive it, and the battery needed for a full year.
- **Time machine**: drag through time and watch shadows, the Sun and Earth move together on the Moon and on the charts.
- **Best lit spot**: some Artemis region centres sit in permanent crater shadow. SEAL points to the best lit ridge within 5 km (for example Nobile Rim 1: 0% sunlight at the centre, 76% on the ridge 5 km away).
- **Sites**: reference points in 6 of NASA's 9 Artemis III candidate regions (October 2024 update: Haworth, Malapert Massif, Mons Mouton, Nobile Rim 1, Nobile Rim 2, de Gerlache Rim 2; not yet included: Peak near Cabeus B, Mons Mouton Plateau, Slater Plain). Regions are areas of roughly 15 km, so each pin is one reference point inside it.
- **Any site on the Moon**: type coordinates or click anywhere. Past landings included as benchmarks (IM-1, IM-2, Chandrayaan-3, SLIM, Blue Ghost 1, Chang'e 4, Apollo 11, 15, 17).
- **Compare** sites side by side and **export** results as CSV.

## How it works

All maths runs in the visitor's browser (`frontend/engine.js`). No server.

| Input | Source | File |
|---|---|---|
| Sun and Earth positions, every 6 h, 2025 to 2028 | NASA JPL Horizons API (DE441), converted to Moon-fixed vectors | `frontend/data/ephemeris.json` |
| South pole terrain, 240 m grid, 80 to 90°S | NASA LRO LOLA LDEM_80S_80MPP_ADJ | `frontend/data/terrain.bin` + `terrain.json` |
| Moon imagery | NASA LRO WAC mosaics via NASA Moon Trek | `frontend/*.jpg` |
| Sites | NASA Artemis III candidate regions, published landing coordinates | `frontend/data/sites.json` |

For each site and time SEAL works out the Sun's and Earth's direction in the local sky, traces the terrain skyline (720 directions, out to 150 km, Moon curvature included), and checks how much of the Sun's disc and of Earth is above it.

Terrain coverage: LOLA terrain is used from 80 to 90°S. Anywhere else (and in skyline directions that leave the grid) SEAL uses smooth-Moon geometry, so results there include the Moon's curvature but not local hills. Each site shows its own coverage: full LOLA skyline, partial (share of directions), or smooth Moon only. Points within about 300 m of the exact pole are analysed at 89.99°S, because directions are undefined at the pole itself. The 240 m grid suits screening; it cannot resolve features smaller than a few hundred metres, so a ridge's predicted sunlight is a screening result, not a certified landing study.

## Validation

| Check | Conditions | Reference | SEAL result |
|---|---|---|---|
| Sun and Earth directions, IM-2 site | -84.7906, 29.1957E, ground level, 57 times, 6 to 20 Mar 2025 | JPL Horizons answer key `docs/validation/im2_horizons_6h.csv` | worst 0.0000021° |
| Sun and Earth directions, Haworth reference point | -86.72621, 338.36131E, 59 times, Jan 2027 | `docs/validation/haworth_horizons_12h.csv` | worst 0.0000021° |
| Sun and Earth directions, Nobile Rim 1 reference point | -85.45638, 36.36065E, 59 times, Jan 2027 | `docs/validation/nobile_rim_1_horizons_12h.csv` | worst 0.0000026° |
| Sunlight at the Shackleton rim lit spot | -89.45, 222.69E, 2 m above ground, all of 2025, 6 h steps, 240 m LOLA | Published polar illumination studies (e.g. Mazarico et al. 2011, Gläser et al. 2014) report roughly 80 to 90% for the best rim points | 91% |

Rerun the direction checks: `python scripts/validate_answer_keys.py`. Rebuild the Sun and Earth table from JPL: `python science/ephemeris/build_ephemeris.py build` (see `science/README.md`).

The Shackleton row is a plausibility check, not an exact comparison: the studies use different terrain resolution, observer height and time period.

## Power model assumptions

An ideal-recharge screening model for comparing dates and sites, not a power system design. Battery numbers are the capacity needed to survive a dark period at the chosen load, assuming the battery is full at sunset:

1. Landing needs the Sun up and Earth in view (terrain included).
2. While any part of the Sun is up, the solar panels run the lander and fully refill the battery.
3. In the dark the lander draws a constant night load (default 100 W, editable).
4. Battery usable to 80% depth of discharge; mass at 150 Wh/kg.
5. The mission ends at the first dark spell longer than the battery lasts.

Not modelled: panel size, angle and efficiency, partial sunlight, heater power versus temperature, battery ageing. Direct radio contact with Earth is reported separately and does not end the mission. Power plans use 1 hour steps from the landing hour.

## Repository

| Folder | What |
|---|---|
| `frontend/` | The website (HTML, CSS, JS, data). Published to GitHub Pages by `.github/workflows/pages.yml`. |
| `science/` | Rust reference implementation of the maths (`cargo test`), the Horizons table builder (`science/ephemeris/`) and the LOLA terrain exporter (`science/terrain_export/`). |
| `server/` | Earlier Rust (axum) server version, kept for development and validation. Not needed for the website. |
| `docs/` | Science spec, data notes, terrain format, sites, validation answer keys. |
| `scripts/` | Horizons answer-key download script, `validate_answer_keys.py` and `test_engine.js` (regression tests: `node scripts/test_engine.js`). |

Run locally: `cd frontend && python3 -m http.server 8000`, then open http://localhost:8000

## Team and contributions

- **Aksshara Venkateswaran:** Built the terrain grid that the browser app uses to work out horizons and shadows. Converted NASA's LOLA south-pole elevation model (7600 × 7600 px) into a 240 m/px, 12.8 MB grid, with a terrain.json file describing its origin, pixel size and axis directions. Built in Python (rasterio, numpy). Checked the projection and axis directions against the file's own metadata, and compared spot heights in the export against the source. AI use: Claude helped write the Python export script.
- **Siddhant Jacob:** Science and validation lead. Defined what SEAL computes (sunlight, Earth contact, battery survival), the power model and its assumptions, and the validation (JPL Horizons answer keys, Shackleton check, regression tests). Directed and reviewed the code and fixed issues from two external reviews. AI use: Claude wrote most of the code and text to his specification; he checked results against NASA data.
- **Viethedev:** Created the team and repository. Built the new landing page and interface, site icon, globe loading and speed fixes, and set up GitHub Pages hosting; usability testing. Also designed the SEAL mascot for the website. AI use:.
- **Jeevika:** SEAL mascot in the demo video, demo video and presentation; tested the app as a first-time user. AI use: Kling AI, Google Flow (mascot), Artlist (intro clip), Claude (text); edited in Canva.

## Use of AI

AI-assisted (Claude, ChatGPT); specified, reviewed and validated by the team. Each member's AI use is listed above.

## Data and credits

NASA JPL Horizons, NASA LRO LOLA, NASA LRO WAC (via NASA Moon Trek), NASA Artemis III candidate landing regions. three.js and Chart.js (cdnjs). Fonts: Archivo (Google Fonts).
