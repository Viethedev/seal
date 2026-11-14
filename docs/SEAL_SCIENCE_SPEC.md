# SEAL – Science Core Spec (v1)

Owner: Jacob · For: Viethedev (integration) + AI code generation
Scope: Artemis III candidate regions only (all inside the LOLA 80–90°S tile).

---

## 0. Conventions (everyone uses these)

| Quantity | Convention |
|---|---|
| Latitude | degrees, south = negative |
| Longitude | degrees **east-positive**, −180 … 180 |
| Azimuth | degrees from **local north, clockwise** (east = 90°), 0 … 360 |
| Elevation | degrees above the **local horizontal** (negative = below) |
| Time | **UTC**, ISO 8601 (`2026-11-14T12:00:00Z`) |
| Distances | km · Heights: m |
| Moon radius R | 1737.4 km (sphere) |
| Moon-fixed frame | MOON_ME (same frame as the LOLA product) |

---

## 1. Inputs

**Per query**
- `site`: name, lat, lon (from the preset list)
- `h`: observer height above ground (m), default **2.0**
- `t_start`, `t_end` (UTC), `step` (default **10 min**; 1 h is fine for long ranges)

**Data (provided by the data layer)**
- DEM: LOLA `LDEM_80S_20MPP_ADJ.TIF` (20 m/px, polar stereographic, height in m relative to the 1737.4 km sphere)
- Sun and Earth position vectors in the Moon-fixed frame (km) for each time step, from ANISE (DE440 + lunar PA/ME kernels) or the Horizons API. Use light-time + aberration corrected ("apparent") positions if available.

---

## 2. Algorithm

### Step 1 – Horizon mask (once per site)
"How high does the land rise in every direction?"

1. Site position S = (R + z_site/1000 + h/1000) × unit vector(lat, lon) — 3D Moon-fixed, km.
2. Local axes at S: up = unit(S); east = unit(Ẑ × up); north = up × east.
3. For each azimuth a = 0°, 0.5°, … 359.5°:
   - Walk outward along the surface in direction a, from 0.1 km to **150 km**, step ≈ 20 m near the site (can grow to 100 m beyond 10 km).
   - At each sample point: get terrain height z from the DEM (bilinear), build the 3D point P = (R + z/1000) × unit(lat, lon).
   - Elevation angle of that point: e = asin( dot(unit(P − S), up) ).
   - mask(a) = max of e over the walk.
4. Output: `mask[720]` in degrees.

(Using 3D vectors automatically includes the Moon's curvature – no separate correction needed.)

### Step 2 – Sun & Earth direction in the sky (per time step)
For body B (Sun or Earth): v = B_pos − S
- el = asin( dot(unit(v), up) )
- az = atan2( dot(v, east), dot(v, north) ), wrapped to 0–360°

### Step 3 – How much is visible
- Angular radius ρ = asin(R_body / |v|) with R_sun = 696,000 km, R_earth = 6,371 km (≈ 0.27° Sun, ≈ 0.95° Earth).
- Horizon at that azimuth: H = mask(az) (linear interpolation).
- x = (el − H) / ρ, clamp to [−1, 1]
- **Visible fraction** f = 1 − (acos(x) − x·√(1 − x²)) / π
  (x = 1 → fully visible, x = 0 → half, x = −1 → hidden)
- Sun lit = f_sun > 0 · Fully lit = f_sun = 1
- **Earth contact** = f_earth ≥ 0.5 (Earth's centre above the terrain)

### Step 4 – Metrics (over the time series)
| Metric | Definition |
|---|---|
| Sunlit % | share of time steps with f_sun > 0 |
| Sunlit hours | sum of lit time in the range |
| **Longest dark period** | longest continuous run with f_sun = 0 (hours) |
| Earth-visible % / hours | same, with Earth contact |
| Longest comms blackout | longest continuous run without Earth contact (hours) |
| Next sunset | first time after t_start where f_sun goes >0 → 0 |
| Next Earthset | first time after t_start where Earth contact true → false |
| **Usable mission length** | from t_start: min(time to next sunset, time to next Earthset). 0 if Sun or Earth not available at t_start |

### Step 5 – Optional: Windows view (stretch goal)
For each landing day in a range (e.g. next 90 days, 1-day step): run Step 4 with t_start = that day → usable mission length.
Colour: green ≥ 10 days · yellow 3–10 days · red < 3 days.

### Step 6 – Optional: power & battery (stretch goal)
- Vertical panel facing the Sun: P(t) = η·A·1361 W/m² · f_sun · cos(el_sun)
- Battery needed (Wh) = P_load (W) × longest dark period (h)
- Defaults (editable, label as assumptions): η·A = 1 m² effective, P_load = 50 W.

---

## 3. Outputs

**Time-series CSV (Export button)**
`site, time_utc, sun_az, sun_el, horizon_el_at_sun_az, sun_visible_frac, earth_az, earth_el, horizon_el_at_earth_az, earth_visible_frac, earth_contact`

**Summary per site (Compute / Compare)**
`site, t_start, t_end, sunlit_pct, sunlit_hours, longest_dark_h, earth_visible_pct, longest_blackout_h, next_sunset_utc, next_earthset_utc, usable_mission_days`

---

## 4. Tests (must pass before merge)

| # | Test | Expected |
|---|---|---|
| T1 | Flat sphere DEM (z = 0 everywhere), h = 2 m | mask ≈ −0.087° in every direction (horizon dip) |
| T2 | Synthetic ring wall height W at distance D | mask ≈ atan((W − h)/D) minus curvature D/(2R), within 0.05° |
| T3 | Sun/Earth az/el vs JPL Horizons, 3 sites × 3 times | difference ≤ 0.1° |
| T4 | Visible fraction formula | x = 1 → 1, x = 0 → 0.5, x = −1 → 0 |
| T5 | IM-2 Athena site (−84.7906, 29.1957), landed 2025-03-06 | predicted next sunset ≈ the ~10-day planned surface mission (mission planned to end at local sunset) |

Note on T5: Athena tipped over on landing, so its *actual* end was early – compare against the *planned* sunset-limited duration and say so honestly.

---

## 5. Known limitations (say these in the pitch)
- Terrain resolution 20 m/px; features smaller than that are missed.
- Bare terrain only (no lander shadowing itself, no dust).
- No relay satellites; "comms" = direct-to-Earth line of sight.
- Power/battery numbers are first-order estimates with stated assumptions.
