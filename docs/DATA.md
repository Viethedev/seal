# SEAL data sources & setup

## 1. Terrain — LOLA south-pole DEMs (NASA PGDA product 90)
https://pgda.gsfc.nasa.gov/products/90 — all files are **Cloud-Optimized GeoTIFFs**,
south polar stereographic X/Y in metres, MOON_ME frame (DE421), heights in metres above the 1737.4 km sphere.

| Use | File | Pixel | Size |
|---|---|---|---|
| **Development / tests** | `LDEM_80S_80MPP_ADJ.TIF` | 80 m | ~181 MB |
| Middle ground | `LDEM_80S_40MPP_ADJ.TIF` | 40 m | ~685 MB |
| **Final app** | `LDEM_80S_20MPP_ADJ.TIF` | 20 m | ~2.6 GB (stream via HTTP range requests) |
| Reaches Chandrayaan-3 (69.4°S) | `LDEM_60S_120MPP_ADJ.TIF` | 120 m | ~785 MB |

Optional near-field detail: 5 m site DEMs (product 78), incl. Nobile Rim 1/2, Malapert Massif,
de Gerlache Rim, Haworth, Leibnitz Beta plateau (= Mons Mouton). Small patches only — the
horizon mask needs ~150 km of reach, so product 90 stays the main source.

**Projection:** `seal_science::south_polar_stereo(lat, lon)` gives (x, y) in metres using
ρ = 2R·tan(π/4 + lat/2), x = ρ·sin(lon), y = ρ·cos(lon), R = 1737.4 km.
➡ **Verify once** against the GeoTIFF's own geotransform/CRS (read with gdalinfo) using a known point,
e.g. the IM-2 site (−84.7906, 29.1957). If x/y signs are swapped in the file, fix it in the `Terrain` impl.

## 2. Ephemerides — Sun & Earth positions (Moon-fixed frame)
**Primary: ANISE (local, offline).** NAIF kernels — names **verified on
https://naif.jpl.nasa.gov/pub/naif/generic_kernels/ on 2026-11-14**:
- Planetary ephemeris: `spk/planets/de440s.bsp` (1900–2050) — `de442s.bsp` also exists (newer)
- Lunar orientation (high precision): `pck/moon_pa_de440_200625.bpc`
- Lunar frame definitions (MOON_ME / MOON_PA): `fk/satellites/moon_de440_250416.tf`
  → ANISE needs text kernels (.tf/.tpc) converted to its own format (see ANISE docs)
- Body constants: `pck/pck00011.tpc`
- Leap seconds: `lsk/naif0012.tls` (ANISE handles time via hifitime)

Query: position of Sun (10) and Earth (399) relative to Moon (301), expressed in **MOON_ME**,
with light-time + stellar aberration correction, in km → pass to `az_el`.

**Fallback / validation: JPL Horizons API** (no key; best-effort service):
```
https://ssd.jpl.nasa.gov/api/horizons.api?format=json
  &COMMAND='10'            (Sun; '399' = Earth)
  &EPHEM_TYPE='OBSERVER'
  &CENTER='coord@301'
  &COORD_TYPE='GEODETIC'
  &SITE_COORD='29.1957,-84.7906,0'   (east-lon, lat, altitude km)
  &START_TIME='2025-03-06' &STOP_TIME='2025-04-06' &STEP_SIZE='1h'
  &QUANTITIES='4'          (apparent azimuth & elevation)
  &ANG_FORMAT='DEG' &CSV_FORMAT='YES' &MAKE_EPHEM='YES'
```
`scripts/horizons_check.py` wraps this and writes a CSV. Query **tested 2026-11-14**: works, returns
"Airless apparent azimuth and elevation", centre frame MEAN_ME, source DE441.
First answer key saved: `docs/validation/im2_horizons_6h.csv`.

**Flat-horizon result at the IM-2 site (landing 2025-03-06 17:31 UTC), from Horizons alone:**
- Earth centre drops below 0° ≈ 2025-03-17 18:30 UTC → ~11.0 days after landing
- Sun centre drops below 0° ≈ 2025-03-19 11:20 UTC → ~12.7 days after landing
→ with a flat horizon, **Earthset comes before sunset** at this site; terrain can only make both earlier.
IM-2's planned surface mission was ~10 days. SEAL's terrain result should land at or below these numbers.

## 3. Frames note
LOLA products are in MOON_ME (DE421). ANISE/DE440 MOON_ME differs from DE421 MOON_ME by metres —
negligible for horizon angles. Keep everything in MOON_ME; do not mix MOON_PA and MOON_ME.

## 4. Sites
`docs/sites.json` — Artemis-only presets with sources. Two entries are marked TODO (placeholder
points) and still need a proper point picked in Quickmap: de Gerlache Rim 2 and Malapert Massif.
Missing regions to add later: Peak near Cabeus B, Slater Plain.
