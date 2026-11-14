//! Terrain sources for the horizon mask.
//!
//! `Flat` is the stand-in until the LOLA COG reader is ready. To plug the real
//! reader in, add a variant (or a new type implementing
//! `seal_science::Terrain`) and pick it in `main.rs`, nothing else changes.

use seal_science::{horizon_mask, HorizonMask, MaskConfig, Terrain};
use std::collections::HashMap;
use std::sync::Mutex;

/// Smooth Moon (height 0 everywhere).
pub struct Flat;
impl Terrain for Flat {
    fn height_m(&self, _lat: f64, _lon: f64) -> Option<f64> {
        Some(0.0)
    }
}

/// Holds the active terrain model and caches horizon masks per site.
pub struct TerrainService {
    pub model: Box<dyn Terrain + Send + Sync>,
    pub name: String,
    cache: Mutex<HashMap<String, HorizonMask>>,
}

impl TerrainService {
    pub fn new(model: Box<dyn Terrain + Send + Sync>, name: &str) -> Self {
        Self { model, name: name.into(), cache: Mutex::new(HashMap::new()) }
    }

    pub fn mask(&self, lat: f64, lon: f64, h: f64) -> HorizonMask {
        let key = format!("{lat:.5}_{lon:.5}_{h:.2}");
        if let Some(m) = self.cache.lock().unwrap().get(&key) {
            return m.clone();
        }
        let m = horizon_mask(&DynTerrain(&*self.model), lat, lon, h, &MaskConfig::default());
        self.cache.lock().unwrap().insert(key, m.clone());
        m
    }
}

/// Adapter so a boxed trait object can be passed to the generic function.
struct DynTerrain<'a>(&'a (dyn Terrain + Send + Sync));
impl Terrain for DynTerrain<'_> {
    fn height_m(&self, lat: f64, lon: f64) -> Option<f64> {
        self.0.height_m(lat, lon)
    }
}
