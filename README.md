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
- **Any site on the Moon**: type coordinates or click anywhere. Past landings included (IM-1, IM-2, Chandrayaan-3, SLIM, Blue Ghost 1, Chang'e 4, Apollo 11, 15, 17).
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

Outside the south pole terrain grid the horizon is treated as flat.

## Validation

- Sun and Earth directions match fresh JPL Horizons answers to **0.000004°** at the pole and 0.00004° anywhere on the Moon (IM-2, Haworth, de Gerlache, Apollo 11, Blue Ghost 1, SLIM, Chang'e 4). Answer keys in `docs/validation/`.
- Terrain check: the Shackleton rim lit spot gets **91%** sunlight in SEAL, in line with published illumination studies (about 90%).
- Rebuild and re-check the Sun and Earth table yourself: `python science/ephemeris/build_ephemeris.py build` and `... validate` (see `science/README.md`).

## Power model assumptions

A simple energy budget for screening dates and sites, not a power system design:

1. Landing needs the Sun up and Earth in view (terrain included).
2. While the Sun is up, the solar panels run the lander and refill the battery.
3. In the dark the lander draws a constant night load (default 100 W, editable).
4. Battery usable to 80% depth of discharge; mass at 150 Wh/kg.
5. The mission ends at the first dark spell longer than the battery lasts.

Not modelled: panel size, angle and efficiency, partial sunlight, heater power versus temperature, battery ageing.

## Repository

| Folder | What |
|---|---|
| `frontend/` | The website (HTML, CSS, JS, data). Published to GitHub Pages by `.github/workflows/pages.yml`. |
| `science/` | Rust reference implementation of the maths (`cargo test`), the Horizons table builder (`science/ephemeris/`) and the LOLA terrain exporter (`science/terrain_export/`). |
| `server/` | Earlier Rust (axum) server version, kept for development and validation. Not needed for the website. |
| `docs/` | Science spec, data notes, terrain format, sites, validation answer keys. |
| `scripts/` | Horizons answer-key download script. |

Run locally: `cd frontend && python3 -m http.server 8000`, then open http://localhost:8000

## Team and contributions

- **Aksshara Venkateswaran (lmaoxd):** Built the terrain grid that the browser app uses to work out horizons and shadows. Converted NASA's LOLA south-pole elevation model (7600 × 7600 px) into a 240 m/px, 12.8 MB grid, with a terrain.json file describing its origin, pixel size and axis directions. Built in Python (rasterio, numpy). Checked the projection and axis directions against the file's own metadata, and compared spot heights in the export against the source. AI use: Claude helped write the Python export script.
- **Siddhant Jacob:** to be added.
- **Viethedev:** to be added.
- **Jeevika:** to be added.

## Use of AI

AI-assisted (Claude, ChatGPT); specified, reviewed and validated by the team. Each member's AI use is listed above.

## Data and credits

NASA JPL Horizons, NASA LRO LOLA, NASA LRO WAC (via NASA Moon Trek), NASA Artemis III candidate landing regions. three.js and Chart.js (cdnjs). Fonts: Archivo (Google Fonts).
