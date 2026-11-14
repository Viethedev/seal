//! JPL Horizons client: apparent azimuth/elevation (and range) of the Sun or
//! Earth seen from a site on the Moon. Results are cached on disk so a demo
//! never waits for (or depends on) the network twice.

use chrono::{DateTime, NaiveDateTime, Utc};
use std::path::PathBuf;

pub const SUN: &str = "10";
pub const EARTH: &str = "399";
const AU_KM: f64 = 149_597_870.7;

#[derive(Debug, Clone)]
pub struct Row {
    /// ISO 8601 UTC, e.g. 2025-03-06T18:00:00Z
    pub t: String,
    pub az: f64,
    pub el: f64,
    pub dist_km: f64,
}

#[derive(Clone)]
pub struct Horizons {
    pub base_url: String,
    pub cache_dir: PathBuf,
    client: reqwest::Client,
}

impl Horizons {
    pub fn new(base_url: String, cache_dir: PathBuf) -> Self {
        let _ = std::fs::create_dir_all(&cache_dir);
        Self {
            base_url,
            cache_dir,
            client: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(90))
                .build()
                .expect("http client"),
        }
    }

    /// Azimuth/elevation series for `body` at (lat, lon east-positive).
    pub async fn az_el(
        &self,
        body: &str,
        lat: f64,
        lon: f64,
        start: DateTime<Utc>,
        stop: DateTime<Utc>,
        step_min: u32,
    ) -> Result<Vec<Row>, String> {
        let lon360 = lon.rem_euclid(360.0);
        let fmt = |t: DateTime<Utc>| t.format("%Y-%m-%d %H:%M").to_string();
        let key = format!(
            "{body}_{lat:.5}_{lon360:.5}_{}_{}_{step_min}",
            start.format("%Y%m%dT%H%M"),
            stop.format("%Y%m%dT%H%M")
        );
        let path = self.cache_dir.join(format!("{key}.txt"));

        let text = match std::fs::read_to_string(&path) {
            Ok(t) => t,
            Err(_) => {
                let params = [
                    ("format", "text".to_string()),
                    ("COMMAND", format!("'{body}'")),
                    ("EPHEM_TYPE", "'OBSERVER'".into()),
                    ("CENTER", "'coord@301'".into()),
                    ("COORD_TYPE", "'GEODETIC'".into()),
                    ("SITE_COORD", format!("'{lon360},{lat},0'")),
                    ("START_TIME", format!("'{}'", fmt(start))),
                    ("STOP_TIME", format!("'{}'", fmt(stop))),
                    ("STEP_SIZE", format!("'{step_min}m'")),
                    ("QUANTITIES", "'4,20'".into()),
                    ("ANG_FORMAT", "'DEG'".into()),
                    ("CSV_FORMAT", "'YES'".into()),
                    ("MAKE_EPHEM", "'YES'".into()),
                    ("OBJ_DATA", "'NO'".into()),
                ];
                let res = self
                    .client
                    .get(&self.base_url)
                    .query(&params)
                    .send()
                    .await
                    .map_err(|e| format!("Horizons request failed: {e}"))?;
                if !res.status().is_success() {
                    return Err(format!("Horizons returned HTTP {}", res.status()));
                }
                let t = res.text().await.map_err(|e| format!("Horizons read failed: {e}"))?;
                if t.contains("$$SOE") {
                    let _ = std::fs::write(&path, &t);
                }
                t
            }
        };
        parse(&text)
    }
}

/// Parse a Horizons text-format observer table with QUANTITIES='4,20'.
pub fn parse(text: &str) -> Result<Vec<Row>, String> {
    let body = text
        .split("$$SOE")
        .nth(1)
        .and_then(|s| s.split("$$EOE").next())
        .ok_or_else(|| {
            let snippet: String = text.chars().take(400).collect();
            format!("Horizons returned no ephemeris: {snippet}")
        })?;
    let mut rows = Vec::new();
    for line in body.lines().map(str::trim).filter(|l| !l.is_empty()) {
        let cols: Vec<&str> = line.split(',').map(str::trim).collect();
        let nums: Vec<f64> = cols[1..].iter().filter_map(|c| c.parse::<f64>().ok()).collect();
        if nums.len() < 2 {
            continue;
        }
        let t = NaiveDateTime::parse_from_str(cols[0], "%Y-%b-%d %H:%M")
            .map(|d| d.format("%Y-%m-%dT%H:%M:00Z").to_string())
            .map_err(|e| format!("bad time '{}': {e}", cols[0]))?;
        // Quantity 20 gives range in au as the 3rd number (if present).
        let dist_km = nums.get(2).map(|au| au * AU_KM).unwrap_or(f64::NAN);
        rows.push(Row { t, az: nums[0], el: nums[1], dist_km });
    }
    if rows.is_empty() {
        return Err("Horizons table was empty".into());
    }
    Ok(rows)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_observer_table() {
        let txt = "header\n$$SOE\n 2025-Mar-06 18:00,*,i,  65.417375,     2.485788, 0.98831, 0.1,\n 2025-Mar-06 19:00, , ,  64.9, -1.0, 0.98832, 0.1,\n$$EOE\nfooter";
        let r = parse(txt).unwrap();
        assert_eq!(r.len(), 2);
        assert_eq!(r[0].t, "2025-03-06T18:00:00Z");
        assert!((r[0].az - 65.417375).abs() < 1e-9);
        assert!((r[1].el + 1.0).abs() < 1e-9);
        assert!((r[0].dist_km - 0.98831 * AU_KM).abs() < 1.0);
    }

    #[test]
    fn error_without_ephemeris() {
        assert!(parse("No ephemeris for target").is_err());
    }
}
