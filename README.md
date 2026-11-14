# SEAL — Sun–Earth Analysis for Landing

NASA Space Apps 2026 · Lunar Landing Site Navigator.
Pick an Artemis III landing site and a date → SEAL shows when the **Sun** lights it (power) and when **Earth** is in view (comms), using JPL ephemerides and LOLA terrain.

## How the pieces fit

```
 frontend/  (web page: pick site → Compute / Compare → charts → CSV)
     │  HTTP JSON  (docs/API.md)
     ▼
 server     (axum: /api/sites, /api/compute, /api/compare, /api/export.csv)   ← TODO
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
| Frontend | `frontend/` | ✅ done, runs in demo mode without the server | Jacob |
| Docs: API, data, spec, sites | `docs/` | ✅ done | Jacob |
| Validation answer keys (Horizons) | `docs/validation/` | ✅ 3 sites | Jacob |
| LOLA terrain reader | `server/` | ⏳ | lmaoxd |
| Ephemeris (ANISE, or Horizons API fallback) | `server/` | ⏳ | Viethedev? |
| axum server (glue) | `server/` | ⏳ | Jacob (with Claude) |

## Start here

- **See the app now:** `cd frontend && python3 -m http.server 8000` → http://localhost:8000 (demo data, flat horizon).
- **Run the science tests:** `cd science && cargo test`
- **What the server must return:** `docs/API.md`
- **Which data files to download:** `docs/DATA.md`
- **The maths:** `docs/SEAL_SCIENCE_SPEC.md`

AI-assisted (Claude, ChatGPT); specified, reviewed and validated by the team.
