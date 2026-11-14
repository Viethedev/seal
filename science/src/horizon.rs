//! Step 1 — horizon mask: the highest terrain elevation angle in every
//! azimuth, seen from an observer standing at the site.

use crate::geometry::{local_frame, site_vector, unit_from_latlon, Vec3};
use crate::R_MOON_KM;

/// Anything that can answer "how high is the ground here?".
/// The data layer implements this on top of the LOLA COG.
pub trait Terrain {
    /// Terrain height (m) above the 1737.4 km sphere, or `None` if outside
    /// the dataset.
    fn height_m(&self, lat_deg: f64, lon_deg: f64) -> Option<f64>;
}

/// How the outward walk is sampled.
#[derive(Debug, Clone)]
pub struct MaskConfig {
    /// Azimuth step (deg). 0.5 gives 720 directions.
    pub az_step_deg: f64,
    /// Sample spacing near the site (km) and the range it applies to (km).
    pub near_step_km: f64,
    pub near_range_km: f64,
    /// Sample spacing beyond the near range (km).
    pub far_step_km: f64,
    /// How far to look (km).
    pub max_range_km: f64,
}

impl Default for MaskConfig {
    fn default() -> Self {
        Self {
            az_step_deg: 0.5,
            near_step_km: 0.02,
            near_range_km: 10.0,
            far_step_km: 0.1,
            max_range_km: 150.0,
        }
    }
}

/// Horizon elevation (deg) for evenly spaced azimuths starting at 0.
#[derive(Debug, Clone)]
pub struct HorizonMask {
    pub az_step_deg: f64,
    pub elevation_deg: Vec<f64>,
}

impl HorizonMask {
    /// Horizon elevation at any azimuth (linear interpolation, wraps at 360).
    pub fn at(&self, az_deg: f64) -> f64 {
        let n = self.elevation_deg.len();
        let pos = az_deg.rem_euclid(360.0) / self.az_step_deg;
        let i = pos.floor() as usize % n;
        let j = (i + 1) % n;
        let t = pos - pos.floor();
        self.elevation_deg[i] * (1.0 - t) + self.elevation_deg[j] * t
    }
}

/// Point reached by walking `dist_km` along the surface from (lat, lon) in
/// direction `bearing_deg` (great-circle "destination point").
fn destination(lat_deg: f64, lon_deg: f64, bearing_deg: f64, dist_km: f64) -> (f64, f64) {
    let (lat1, lon1, brg) = (
        lat_deg.to_radians(),
        lon_deg.to_radians(),
        bearing_deg.to_radians(),
    );
    let d = dist_km / R_MOON_KM;
    let lat2 = (lat1.sin() * d.cos() + lat1.cos() * d.sin() * brg.cos()).asin();
    let lon2 = lon1
        + (brg.sin() * d.sin() * lat1.cos()).atan2(d.cos() - lat1.sin() * lat2.sin());
    (lat2.to_degrees(), lon2.to_degrees())
}

/// Sample distances for the outward walk.
fn walk_distances(cfg: &MaskConfig) -> Vec<f64> {
    let mut out = Vec::new();
    let mut d = cfg.near_step_km;
    while d <= cfg.near_range_km.min(cfg.max_range_km) + 1e-9 {
        out.push(d);
        d += cfg.near_step_km;
    }
    let mut d = cfg.near_range_km + cfg.far_step_km;
    while d <= cfg.max_range_km + 1e-9 {
        out.push(d);
        d += cfg.far_step_km;
    }
    out
}

/// Compute the horizon mask at (lat, lon) for an observer `observer_height_m`
/// metres above the ground. Samples outside the terrain dataset are skipped.
pub fn horizon_mask<T: Terrain>(
    terrain: &T,
    lat_deg: f64,
    lon_deg: f64,
    observer_height_m: f64,
    cfg: &MaskConfig,
) -> HorizonMask {
    let ground = terrain.height_m(lat_deg, lon_deg).unwrap_or(0.0);
    let s: Vec3 = site_vector(lat_deg, lon_deg, ground + observer_height_m);
    let frame = local_frame(s);
    let dists = walk_distances(cfg);
    let n = (360.0 / cfg.az_step_deg).round() as usize;

    let elevation_deg = (0..n)
        .map(|k| {
            let az = k as f64 * cfg.az_step_deg;
            let mut best = -90.0_f64;
            for &d in &dists {
                let (la, lo) = destination(lat_deg, lon_deg, az, d);
                if let Some(z) = terrain.height_m(la, lo) {
                    let p = unit_from_latlon(la, lo).scale(R_MOON_KM + z / 1000.0);
                    let e = p.sub(s).unit().dot(frame.up).clamp(-1.0, 1.0).asin();
                    best = best.max(e.to_degrees());
                }
            }
            best
        })
        .collect();

    HorizonMask {
        az_step_deg: cfg.az_step_deg,
        elevation_deg,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Flat;
    impl Terrain for Flat {
        fn height_m(&self, _: f64, _: f64) -> Option<f64> {
            Some(0.0)
        }
    }

    /// Flat ground, plus a wall of height `wall_m` everywhere at least
    /// `dist_km` away from the site.
    struct Ring {
        lat: f64,
        lon: f64,
        dist_km: f64,
        wall_m: f64,
    }
    impl Terrain for Ring {
        fn height_m(&self, la: f64, lo: f64) -> Option<f64> {
            let a = unit_from_latlon(self.lat, self.lon);
            let b = unit_from_latlon(la, lo);
            let d = a.dot(b).clamp(-1.0, 1.0).acos() * R_MOON_KM;
            Some(if d >= self.dist_km - 1e-6 { self.wall_m } else { 0.0 })
        }
    }

    fn quick_cfg() -> MaskConfig {
        MaskConfig {
            az_step_deg: 10.0,
            ..MaskConfig::default()
        }
    }

    // Spec test T1: horizon dip on a smooth sphere = -acos(R / (R + h)).
    #[test]
    fn t1_flat_sphere_dip() {
        let h = 2.0;
        let m = horizon_mask(&Flat, -85.0, 30.0, h, &quick_cfg());
        let expected = -(R_MOON_KM / (R_MOON_KM + h / 1000.0)).acos().to_degrees();
        for e in &m.elevation_deg {
            assert!((e - expected).abs() < 0.005, "got {e}, expected {expected}");
        }
    }

    // Spec test T2: a ring wall at distance D, height W.
    #[test]
    fn t2_ring_wall() {
        let (h, w, d) = (2.0, 2000.0, 20.0);
        let ring = Ring { lat: -85.0, lon: 30.0, dist_km: d, wall_m: w };
        let m = horizon_mask(&ring, -85.0, 30.0, h, &quick_cfg());
        // Exact geometry: wall top at central angle theta from the observer.
        let theta = d / R_MOON_KM;
        let (rw, ro) = (R_MOON_KM + w / 1000.0, R_MOON_KM + h / 1000.0);
        let expected = (rw * theta.cos() - ro).atan2(rw * theta.sin()).to_degrees();
        for e in &m.elevation_deg {
            assert!((e - expected).abs() < 0.02, "got {e}, expected {expected}");
        }
    }

    #[test]
    fn mask_interpolates_and_wraps() {
        let m = HorizonMask { az_step_deg: 90.0, elevation_deg: vec![0.0, 1.0, 2.0, 3.0] };
        assert!((m.at(45.0) - 0.5).abs() < 1e-12);
        assert!((m.at(315.0) - 1.5).abs() < 1e-12);
        assert!((m.at(360.0) - 0.0).abs() < 1e-12);
    }
}
