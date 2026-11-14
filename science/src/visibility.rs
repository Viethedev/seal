//! Step 3 — how much of the Sun / Earth disk is above the terrain.

/// Angular radius (deg) of a body of radius `radius_km` seen from `dist_km`.
pub fn angular_radius_deg(radius_km: f64, dist_km: f64) -> f64 {
    (radius_km / dist_km).clamp(-1.0, 1.0).asin().to_degrees()
}

/// Fraction (0..1) of a disk of angular radius `radius_deg`, centred at
/// elevation `el_deg`, that lies above a horizon at `horizon_deg`
/// (horizon treated as a straight line across the small disk).
pub fn visible_fraction(el_deg: f64, horizon_deg: f64, radius_deg: f64) -> f64 {
    let x = ((el_deg - horizon_deg) / radius_deg).clamp(-1.0, 1.0);
    1.0 - (x.acos() - x * (1.0 - x * x).sqrt()) / std::f64::consts::PI
}

#[cfg(test)]
mod tests {
    use super::*;

    // Spec test T4
    #[test]
    fn t4_fraction_endpoints() {
        assert!((visible_fraction(10.0, 0.0, 0.27) - 1.0).abs() < 1e-12);
        assert!((visible_fraction(0.0, 0.0, 0.27) - 0.5).abs() < 1e-12);
        assert!(visible_fraction(-10.0, 0.0, 0.27).abs() < 1e-12);
    }

    #[test]
    fn fraction_is_monotonic() {
        let mut prev = -1.0;
        for i in 0..=100 {
            let el = -0.3 + 0.006 * i as f64;
            let f = visible_fraction(el, 0.0, 0.27);
            assert!(f >= prev);
            prev = f;
        }
    }

    #[test]
    fn sun_angular_radius_about_quarter_degree() {
        let r = angular_radius_deg(crate::R_SUN_KM, 1.496e8);
        assert!((r - 0.2666).abs() < 0.002);
    }
}
