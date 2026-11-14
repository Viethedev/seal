//! SEAL science core, pure functions, no I/O.
//!
//! Implements `SEAL_SCIENCE_SPEC.md`:
//!   Step 1  horizon mask from a terrain model
//!   Step 2  Sun / Earth azimuth & elevation at a site
//!   Step 3  visible fraction of a disk above the terrain horizon
//!   Step 4  mission metrics over a time series
//!
//! Conventions: latitude/longitude in degrees (longitude east-positive),
//! azimuth from local north clockwise (0..360), elevation above the local
//! horizontal, distances in km, heights in metres, time in UNIX seconds (UTC).
//! Positions are Moon-fixed Cartesian (MOON_ME), km.

pub mod geometry;
pub mod horizon;
pub mod metrics;
pub mod visibility;

pub use geometry::{az_el, local_frame, site_vector, south_polar_stereo, LocalFrame, Vec3};
pub use horizon::{horizon_mask, HorizonMask, MaskConfig, Terrain};
pub use metrics::{metrics, Metrics, Sample};
pub use visibility::{angular_radius_deg, visible_fraction};

/// Mean lunar radius used by LOLA products (km).
pub const R_MOON_KM: f64 = 1737.4;
/// Solar radius (km).
pub const R_SUN_KM: f64 = 696_000.0;
/// Earth equatorial radius (km).
pub const R_EARTH_KM: f64 = 6_371.0;
