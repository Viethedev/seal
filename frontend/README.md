# SEAL frontend

Plain HTML/CSS/JS — no build step. Implements the flow Viethedev described:
home (pick a preset site) → main view (south polar map + Compute / Compare) → charts → Export CSV.

- Talks to the axum API in `docs/API.md` (`/api/sites`, `/api/compute`, `/api/compare`, `/api/export.csv`).
- **If the API isn't running, it switches to demo mode** (badge "Demo data · flat horizon") using real
  JPL Horizons angles for 3 sites (IM-2 / Mons Mouton, Nobile Rim 1, Haworth) with a flat horizon.
- Serve it from axum with `tower_http::services::ServeDir::new("frontend")`, or locally:
  `cd frontend && python3 -m http.server 8000` → open http://localhost:8000
- Custom coordinates / pick-on-map are shown but disabled ("coming soon"), as agreed for the demo.

Files: `index.html`, `style.css`, `app.js`, `demo-data.js` (generated from `docs/validation/*.csv`).
