# SEAL: Sun-Earth Analysis for Landing

NASA Space Apps 2026 · Lunar Landing Site Navigator.
Pick an Artemis III landing site and a date → SEAL shows when the **Sun** lights it (power) and when **Earth** is in view (comms), using JPL ephemerides and LOLA terrain.

## How the pieces fit

```
 frontend/  (web page: pick site → Compute / Compare → charts → CSV)
     │  HTTP JSON  (docs/API.md)
     ▼
 server     (axum: /api/sites, /api/compute, /api/compare, /api/export.csv)
     │ calls
     ▼
 science/   (Rust crate seal_science: horizon mask, Sun/Earth az-el,
             visible fraction, mission metrics)                              ← DONE, tests pass
     ▲                         ▲
     │ terrain heights          │ Sun & Earth positions (MOON_ME, km)
 LOLA COG reader  ← TODO      ANISE / Horizons ephemeris  ← TODO
 (implements Terrain trait)
```

## Status

| Part | Folder | Status | Owner |
|---|---|---|---|
| Science core | `science/` | ✅ done, `cargo test` passes | Jacob |
| Frontend (landing + interactive Moon map, click anywhere) | `frontend/` | ✅ done, demo mode without the server | Jacob |
| Docs: API, data, spec, sites | `docs/` | ✅ done | Jacob |
| Validation answer keys (Horizons) | `docs/validation/` | ✅ 3 sites | Jacob |
| LOLA terrain reader | `server/` | ⏳ | lmaoxd |
| Ephemeris (JPL Horizons API, cached; ANISE later) | `server/src/horizons.rs` | ✅ | Jacob |
| axum server (glue) | `server/` | ✅ (flat horizon until terrain plugs in) | Jacob |

## Start here

- **Online version (no server):** the `frontend/` folder is the whole website. All maths runs in the browser (`frontend/engine.js`) using a NASA Horizons Sun/Earth table and, once added, the LOLA terrain file (`docs/TERRAIN_FORMAT.md`). Upload `frontend/` to any static host.
- **Rust server (optional, for development/validation):** install Rust, then from the repo root `cargo run --release --manifest-path server/Cargo.toml` → http://localhost:8080 (needs internet for NASA Horizons + Moon Trek map tiles).
- **See the app without the server:** `cd frontend && python3 -m http.server 8000` → http://localhost:8000 (demo data, flat horizon).
- **Run the science tests:** `cd science && cargo test`
- **What the server must return:** `docs/API.md`
- **Which data files to download:** `docs/DATA.md`
- **The maths:** `docs/SEAL_SCIENCE_SPEC.md`

AI-assisted (Claude, ChatGPT); specified, reviewed and validated by the team.
