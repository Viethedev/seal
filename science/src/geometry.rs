//! Step 2: vectors, the local sky frame, and azimuth/elevation.

use crate::R_MOON_KM;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Vec3 {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

impl Vec3 {
    pub const fn new(x: f64, y: f64, z: f64) -> Self {
        Self { x, y, z }
    }
    pub fn dot(self, o: Vec3) -> f64 {
        self.x * o.x + self.y * o.y + self.z * o.z
    }
    pub fn cross(self, o: Vec3) -> Vec3 {
        Vec3::new(
            self.y * o.z - self.z * o.y,
            self.z * o.x - self.x * o.z,
            self.x * o.y - self.y * o.x,
        )
    }
    pub fn norm(self) -> f64 {
        self.dot(self).sqrt()
    }
    pub fn unit(self) -> Vec3 {
        self.scale(1.0 / self.norm())
    }
    pub fn scale(self, k: f64) -> Vec3 {
        Vec3::new(self.x * k, self.y * k, self.z * k)
    }
    pub fn sub(self, o: Vec3) -> Vec3 {
        Vec3::new(self.x - o.x, self.y - o.y, self.z - o.z)
    }
}

/// Unit vector pointing from the Moon's centre towards (lat, lon).
pub fn unit_from_latlon(lat_deg: f64, lon_deg: f64) -> Vec3 {
    let (lat, lon) = (lat_deg.to_radians(), lon_deg.to_radians());
    Vec3::new(lat.cos() * lon.cos(), lat.cos() * lon.sin(), lat.sin())
}

/// Moon-fixed position (km) of a point at (lat, lon) whose height above the
/// 1737.4 km sphere is `height_m` metres (terrain height + observer height).
pub fn site_vector(lat_deg: f64, lon_deg: f64, height_m: f64) -> Vec3 {
    unit_from_latlon(lat_deg, lon_deg).scale(R_MOON_KM + height_m / 1000.0)
}

/// Local sky axes at a site: `up` (zenith), `east`, `north`.
#[derive(Debug, Clone, Copy)]
pub struct LocalFrame {
    pub up: Vec3,
    pub east: Vec3,
    pub north: Vec3,
}

/// Build the local frame at `site`. North points towards the lunar north
/// pole (+Z). Undefined exactly at a pole; no Artemis site is exactly there.
pub fn local_frame(site: Vec3) -> LocalFrame {
    let up = site.unit();
    let east = Vec3::new(0.0, 0.0, 1.0).cross(up).unit();
    let north = up.cross(east);
    LocalFrame { up, east, north }
}

/// Azimuth (deg, from north clockwise, 0..360), elevation (deg) and distance
/// (km) of `target` (Moon-fixed position, km) as seen from `site`.
pub fn az_el(frame: &LocalFrame, site: Vec3, target: Vec3) -> (f64, f64, f64) {
    let v = target.sub(site);
    let d = v.norm();
    let u = v.scale(1.0 / d);
    let (e, n, z) = (u.dot(frame.east), u.dot(frame.north), u.dot(frame.up));
    // atan2 form stays accurate near the zenith, where asin loses precision.
    let el = z.atan2((e * e + n * n).sqrt()).to_degrees();
    let az = e.atan2(n).to_degrees();
    (az.rem_euclid(360.0), el, d)
}

/// South polar stereographic projection on the 1737.4 km sphere, as used by
/// the PGDA/LOLA polar products: returns (x, y) in metres.
/// VERIFY against the GeoTIFF's own metadata with one known point before use.
pub fn south_polar_stereo(lat_deg: f64, lon_deg: f64) -> (f64, f64) {
    let rho = 2.0
        * R_MOON_KM
        * 1000.0
        * (std::f64::consts::FRAC_PI_4 + lat_deg.to_radians() / 2.0).tan();
    let lon = lon_deg.to_radians();
    (rho * lon.sin(), rho * lon.cos())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn overhead_target_is_at_zenith() {
        let s = site_vector(-85.0, 30.0, 0.0);
        let f = local_frame(s);
        let target = s.unit().scale(400_000.0);
        let (_, el, _) = az_el(&f, s, target);
        assert!((el - 90.0).abs() < 1e-9);
    }

    #[test]
    fn north_and_east_azimuths() {
        let s = site_vector(-85.0, 30.0, 0.0);
        let f = local_frame(s);
        let far = 1.0e6;
        let (az_n, el_n, _) = az_el(&f, s, s.sub(f.north.scale(-far)));
        let (az_e, _, _) = az_el(&f, s, s.sub(f.east.scale(-far)));
        assert!(az_n.abs() < 1e-6 || (az_n - 360.0).abs() < 1e-6);
        assert!(el_n.abs() < 1e-6);
        assert!((az_e - 90.0).abs() < 1e-6);
    }

    #[test]
    fn stereo_pole_is_origin() {
        let (x, y) = south_polar_stereo(-90.0, 123.0);
        assert!(x.abs() < 1e-6 && y.abs() < 1e-6);
    }
}
