# SEAL API contract (proposal for the axum server)

All JSON. Angles in degrees, longitude east-positive (−180..180), time in UTC ISO 8601.
Science numbers come from the `seal_science` crate (`science/`).

---

## `GET /api/sites`
Preset Artemis III sites for the home page and map. Served from `docs/sites.json`.

```json
[
  { "id": "mons-mouton-im2", "name": "IM-2 Athena (Mons Mouton)", "lat": -84.7906, "lon": 29.1957,
    "region": "Mons Mouton", "point_type": "exact landing point", "source": "https://lroc.im-ldi.com/images/1408" }
]
```

---

## `POST /api/compute` : one site, full detail

**Request**
```json
{
  "site_id": "mons-mouton-im2",
  "start": "2025-03-06T17:31:00Z",
  "end":   "2025-04-05T17:31:00Z",
  "step_minutes": 60,
  "observer_height_m": 2.0
}
```

**Response**
```json
{
  "site": { "id": "mons-mouton-im2", "name": "IM-2 Athena (Mons Mouton)", "lat": -84.7906, "lon": 29.1957 },
  "horizon": { "az_step_deg": 0.5, "elevation_deg": [0.41, 0.43, "... 720 values"] },
  "summary": {
    "sunlit_pct": 63.2,
    "sunlit_hours": 455.0,
    "longest_dark_hours": 210.0,
    "earth_visible_pct": 48.1,
    "earth_visible_hours": 346.0,
    "longest_blackout_hours": 300.0,
    "next_sunset": "2025-03-16T04:00:00Z",
    "next_earthset": "2025-03-12T09:00:00Z",
    "usable_mission_days": 5.6,
    "mission_runs_past_range": false
  },
  "series": [
    { "t": "2025-03-06T17:31:00Z",
      "sun_az": 101.2, "sun_el": 1.1, "horizon_at_sun": 0.4, "sun_frac": 1.0,
      "earth_az": 28.9, "earth_el": 3.2, "horizon_at_earth": 0.6, "earth_frac": 1.0 }
  ]
}
```
(Numbers above are placeholders, not results.)

**Rust mapping**
- `horizon` ← `horizon_mask(&terrain, lat, lon, h, &MaskConfig::default())` (cache per site + height)
- each `series` row ← `az_el` + `visible_fraction` for Sun and Earth
- `summary` ← `metrics(&samples)`

---

## `POST /api/compare`: several sites, same dates

**Request**
```json
{ "site_ids": ["mons-mouton-im2", "nobile-rim-1", "haworth"],
  "start": "2027-01-01T00:00:00Z", "end": "2027-01-31T00:00:00Z",
  "step_minutes": 60, "observer_height_m": 2.0 }
```

**Response**: `{ "results": [ { "site": {...}, "summary": {...}, "series": [ {t, sun_frac, earth_frac} ] } ] }`
Frontend plots `sun_frac` and `earth_frac` vs time per site, plus a summary table.

---

## `POST /api/export.csv`
Same body as `/api/compute`. Returns `text/csv`:

```
site,time_utc,sun_az,sun_el,horizon_el_at_sun_az,sun_visible_frac,earth_az,earth_el,horizon_el_at_earth_az,earth_visible_frac,earth_contact
```
`earth_contact` = `earth_visible_frac >= 0.5`.

---

## Later (stretch): `POST /api/windows`
`{ "site_ids": [...], "first_landing": "...", "days": 90, "observer_height_m": 2.0 }`
→ for each site and each landing day: `usable_mission_days` (green ≥ 10, yellow 3-10, red < 3).
Implementation = run `/api/compute` logic with `start` = each landing day.

---

## Errors
`400` bad input (unknown site, end ≤ start, step < 1 min) · `422` site outside terrain coverage · `502` ephemeris source failed (ANISE/Horizons).
