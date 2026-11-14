//! End-to-end example of the call chain the axum server will use, with a
//! fake flat terrain and a fake Sun/Earth circling the horizon.
//! Run: `cargo run --example pipeline`

use seal_science::*;

struct Flat;
impl Terrain for Flat {
    fn height_m(&self, _: f64, _: f64) -> Option<f64> {
        Some(0.0)
    }
}

fn main() {
    let (lat, lon, h) = (-84.7906, 29.1957, 2.0);
    let mask = horizon_mask(&Flat, lat, lon, h, &MaskConfig { az_step_deg: 5.0, ..Default::default() });

    let site = site_vector(lat, lon, h);
    let frame = local_frame(site);

    // Fake ephemeris: Sun 1 AU away, Earth 384,400 km away, both circling the
    // horizon once per 29.5 days with a small up/down wobble.
    let period = 29.53 * 86_400.0;
    let samples: Vec<Sample> = (0..(30 * 24))
        .map(|i| {
            let t = i as f64 * 3600.0;
            let ang = 2.0 * std::f64::consts::PI * t / period;
            let dir = |dist: f64, el_deg: f64, phase: f64| {
                let az = ang + phase;
                let el = el_deg.to_radians();
                let local = frame.north.scale(az.cos() * el.cos())
                    .sub(frame.east.scale(-(az.sin() * el.cos())))
                    .sub(frame.up.scale(-el.sin()));
                site.sub(local.scale(-dist))
            };
            let sun = dir(1.496e8, 1.5 * ang.sin(), 0.0);
            let earth = dir(384_400.0, 5.0 * (ang * 1.08).cos(), 1.0);

            let (saz, sel, sd) = az_el(&frame, site, sun);
            let (eaz, eel, ed) = az_el(&frame, site, earth);
            Sample {
                t,
                sun_frac: visible_fraction(sel, mask.at(saz), angular_radius_deg(R_SUN_KM, sd)),
                earth_frac: visible_fraction(eel, mask.at(eaz), angular_radius_deg(R_EARTH_KM, ed)),
            }
        })
        .collect();

    let m = metrics(&samples);
    println!("{m:#?}");
}
