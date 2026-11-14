# seal_science: SEAL's science core

Pure Rust, no I/O, no dependencies. Implements `docs/SEAL_SCIENCE_SPEC.md`.
The axum server / data layer feeds it terrain + Sun/Earth positions and gets numbers back.

## How the server uses it

```rust
use seal_science::*;

// 1. Terrain: implement this trait on top of the LOLA COG reader.
struct Lola { /* GeoTIFF handle */ }
impl Terrain for Lola {
    fn height_m(&self, lat: f64, lon: f64) -> Option<f64> {
        let (x, y) = south_polar_stereo(lat, lon); // metres; verify vs the TIFF metadata
        /* bilinear sample of the DEM at (x, y) */
        todo!()
    }
}

// 2. Horizon mask, once per site (cache it).
let mask = horizon_mask(&lola, -84.7906, 29.1957, 2.0, &MaskConfig::default());

// 3. Per time step: Sun/Earth positions (Moon-fixed MOON_ME, km) from ANISE.
let site = site_vector(lat, lon, ground_m + 2.0);
let frame = local_frame(site);
let (sun_az, sun_el, sun_d) = az_el(&frame, site, sun_pos_km);
let sun_frac = visible_fraction(sun_el, mask.at(sun_az), angular_radius_deg(R_SUN_KM, sun_d));
let (earth_az, earth_el, earth_d) = az_el(&frame, site, earth_pos_km);
let earth_frac = visible_fraction(earth_el, mask.at(earth_az), angular_radius_deg(R_EARTH_KM, earth_d));

// 4. Metrics over the series.
let m = metrics(&samples); // Vec<Sample { t, sun_frac, earth_frac }>
```

## Tests
`cargo test`, includes spec tests T1 (flat-sphere horizon dip), T2 (ring wall), T4 (visible fraction),
plus azimuth/elevation and metrics checks. T3 (vs JPL Horizons) and T5 (IM-2) run once real data is wired in.

AI-assisted (Claude), specified and validated by Siddhant Jacob.

## Rebuilding the Sun and Earth table

`science/ephemeris/build_ephemeris.py` (Python standard library only):

```
python science/ephemeris/build_ephemeris.py build      # downloads 2025 to 2028 from NASA JPL Horizons, writes ephemeris.json
python science/ephemeris/build_ephemeris.py validate   # compares the table with fresh Horizons answers for real sites
```

Copy the new `ephemeris.json` into `frontend/data/`. Spot check (IM-2 site, 6 to 7 March 2025): the table matches fresh Horizons answers to better than 0.000001 deg.
