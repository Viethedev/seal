//! HTTP API, matches docs/API.md.

use crate::horizons::{self, Horizons, Row};
use crate::terrain::TerrainService;
use axum::extract::State;
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use chrono::{DateTime, Utc};
use seal_science::{angular_radius_deg, metrics, visible_fraction, Sample, R_EARTH_KM, R_SUN_KM};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

const MAX_POINTS: i64 = 20_000;
const SUN_R_DEFAULT: f64 = 0.2666;
const EARTH_R_DEFAULT: f64 = 0.95;

#[derive(Clone, Serialize, Deserialize)]
pub struct Site {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub region: String,
    pub lat: f64,
    pub lon: f64,
    #[serde(default)]
    pub point_type: String,
    #[serde(default)]
    pub source: String,
    #[serde(default)]
    pub note: String,
}

pub struct AppState {
    pub sites: Vec<Site>,
    pub horizons: Horizons,
    pub terrain: TerrainService,
}
pub type Shared = Arc<AppState>;

pub struct ApiError(StatusCode, String);
impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.0, Json(serde_json::json!({ "error": self.1 }))).into_response()
    }
}
fn bad(msg: impl Into<String>) -> ApiError {
    ApiError(StatusCode::BAD_REQUEST, msg.into())
}

#[derive(Deserialize)]
pub struct Query {
    /// Either a preset id …
    pub site_id: Option<String>,
    /// … or a custom point (clicked on the map).
    pub lat: Option<f64>,
    pub lon: Option<f64>,
    pub start: DateTime<Utc>,
    pub end: DateTime<Utc>,
    #[serde(default = "default_step")]
    pub step_minutes: u32,
    #[serde(default = "default_height")]
    pub observer_height_m: f64,
}
fn default_step() -> u32 {
    60
}
fn default_height() -> f64 {
    2.0
}

#[derive(Deserialize)]
pub struct CompareQuery {
    pub site_ids: Vec<String>,
    pub start: DateTime<Utc>,
    pub end: DateTime<Utc>,
    #[serde(default = "default_step")]
    pub step_minutes: u32,
    #[serde(default = "default_height")]
    pub observer_height_m: f64,
}

#[derive(Serialize)]
pub struct SeriesRow {
    pub t: String,
    pub sun_az: f64,
    pub sun_el: f64,
    pub horizon_at_sun: f64,
    pub sun_frac: f64,
    pub earth_az: f64,
    pub earth_el: f64,
    pub horizon_at_earth: f64,
    pub earth_frac: f64,
}

#[derive(Serialize)]
pub struct Summary {
    pub sunlit_pct: f64,
    pub sunlit_hours: f64,
    pub longest_dark_hours: f64,
    pub earth_visible_pct: f64,
    pub earth_visible_hours: f64,
    pub longest_blackout_hours: f64,
    pub next_sunset: Option<String>,
    pub next_earthset: Option<String>,
    pub usable_mission_days: f64,
    pub mission_runs_past_range: bool,
}

#[derive(Serialize)]
pub struct Horizon {
    pub az_step_deg: f64,
    pub elevation_deg: Vec<f64>,
}

#[derive(Serialize)]
pub struct ComputeResult {
    pub site: Site,
    pub terrain_model: String,
    pub horizon: Horizon,
    pub summary: Summary,
    pub series: Vec<SeriesRow>,
}

fn check_range(start: DateTime<Utc>, end: DateTime<Utc>, step: u32) -> Result<(), ApiError> {
    if end <= start {
        return Err(bad("end must be after start"));
    }
    if step < 10 {
        return Err(bad("step_minutes must be at least 10"));
    }
    let points = (end - start).num_minutes() / step as i64;
    if points > MAX_POINTS {
        return Err(bad(format!("too many time steps ({points}); use a bigger step or shorter range")));
    }
    Ok(())
}

fn resolve_site(st: &AppState, q: &Query) -> Result<Site, ApiError> {
    if let Some(id) = &q.site_id {
        return st.sites.iter().find(|s| &s.id == id).cloned().ok_or_else(|| bad(format!("unknown site '{id}'")));
    }
    match (q.lat, q.lon) {
        (Some(lat), Some(lon)) if (-90.0..=90.0).contains(&lat) => Ok(Site {
            id: format!("custom_{lat:.4}_{lon:.4}"),
            name: format!("Custom point ({lat:.3}°, {lon:.3}°E)"),
            region: "Custom".into(),
            lat,
            lon: ((lon + 180.0).rem_euclid(360.0)) - 180.0,
            point_type: "user-selected point".into(),
            source: String::new(),
            note: String::new(),
        }),
        _ => Err(bad("give site_id, or lat and lon")),
    }
}

async fn compute_site(
    st: &AppState,
    site: Site,
    start: DateTime<Utc>,
    end: DateTime<Utc>,
    step: u32,
    h: f64,
) -> Result<ComputeResult, ApiError> {
    let upstream = |e: String| ApiError(StatusCode::BAD_GATEWAY, e);
    let (sun, earth) = tokio::try_join!(
        st.horizons.az_el(horizons::SUN, site.lat, site.lon, start, end, step),
        st.horizons.az_el(horizons::EARTH, site.lat, site.lon, start, end, step),
    )
    .map_err(upstream)?;

    let mask = {
        let (lat, lon) = (site.lat, site.lon);
        // Mask computation is CPU work; keep it off the async threads.
        let terrain = &st.terrain;
        tokio::task::block_in_place(|| terrain.mask(lat, lon, h))
    };

    let n = sun.len().min(earth.len());
    let radius = |r: &Row, body_km: f64, default: f64| {
        if r.dist_km.is_finite() { angular_radius_deg(body_km, r.dist_km) } else { default }
    };
    let mut series = Vec::with_capacity(n);
    let mut samples = Vec::with_capacity(n);
    for i in 0..n {
        let (s, e) = (&sun[i], &earth[i]);
        let hs = mask.at(s.az);
        let he = mask.at(e.az);
        let sf = visible_fraction(s.el, hs, radius(s, R_SUN_KM, SUN_R_DEFAULT));
        let ef = visible_fraction(e.el, he, radius(e, R_EARTH_KM, EARTH_R_DEFAULT));
        let t = DateTime::parse_from_rfc3339(&s.t).map(|d| d.timestamp() as f64).unwrap_or(0.0);
        samples.push(Sample { t, sun_frac: sf, earth_frac: ef });
        series.push(SeriesRow {
            t: s.t.clone(),
            sun_az: s.az,
            sun_el: s.el,
            horizon_at_sun: hs,
            sun_frac: sf,
            earth_az: e.az,
            earth_el: e.el,
            horizon_at_earth: he,
            earth_frac: ef,
        });
    }
    if samples.len() < 2 {
        return Err(bad("time range too short for the chosen step"));
    }
    let m = metrics(&samples);
    let iso = |t: f64| DateTime::from_timestamp(t as i64, 0).map(|d| d.format("%Y-%m-%dT%H:%M:%SZ").to_string());
    Ok(ComputeResult {
        site,
        terrain_model: st.terrain.name.clone(),
        horizon: Horizon { az_step_deg: mask.az_step_deg, elevation_deg: mask.elevation_deg.clone() },
        summary: Summary {
            sunlit_pct: m.sunlit_pct,
            sunlit_hours: m.sunlit_hours,
            longest_dark_hours: m.longest_dark_hours,
            earth_visible_pct: m.earth_visible_pct,
            earth_visible_hours: m.earth_visible_hours,
            longest_blackout_hours: m.longest_blackout_hours,
            next_sunset: m.next_sunset.and_then(iso),
            next_earthset: m.next_earthset.and_then(iso),
            usable_mission_days: m.usable_mission_days,
            mission_runs_past_range: m.mission_runs_past_range,
        },
        series,
    })
}

pub async fn sites(State(st): State<Shared>) -> Json<Vec<Site>> {
    Json(st.sites.clone())
}

pub async fn compute(State(st): State<Shared>, Json(q): Json<Query>) -> Result<Json<ComputeResult>, ApiError> {
    check_range(q.start, q.end, q.step_minutes)?;
    let site = resolve_site(&st, &q)?;
    Ok(Json(compute_site(&st, site, q.start, q.end, q.step_minutes, q.observer_height_m).await?))
}

#[derive(Serialize)]
pub struct CompareResult {
    pub results: Vec<ComputeResult>,
}

pub async fn compare(State(st): State<Shared>, Json(q): Json<CompareQuery>) -> Result<Json<CompareResult>, ApiError> {
    check_range(q.start, q.end, q.step_minutes)?;
    if q.site_ids.is_empty() || q.site_ids.len() > 6 {
        return Err(bad("compare needs 1 to 6 sites"));
    }
    let mut results = Vec::new();
    for id in &q.site_ids {
        let site = st.sites.iter().find(|s| &s.id == id).cloned().ok_or_else(|| bad(format!("unknown site '{id}'")))?;
        results.push(compute_site(&st, site, q.start, q.end, q.step_minutes, q.observer_height_m).await?);
    }
    Ok(Json(CompareResult { results }))
}

pub async fn export_csv(State(st): State<Shared>, Json(q): Json<Query>) -> Result<Response, ApiError> {
    check_range(q.start, q.end, q.step_minutes)?;
    let site = resolve_site(&st, &q)?;
    let r = compute_site(&st, site, q.start, q.end, q.step_minutes, q.observer_height_m).await?;
    let mut csv = String::from(
        "site,time_utc,sun_az,sun_el,horizon_el_at_sun_az,sun_visible_frac,earth_az,earth_el,horizon_el_at_earth_az,earth_visible_frac,earth_contact\n",
    );
    for s in &r.series {
        csv.push_str(&format!(
            "{},{},{:.6},{:.6},{:.4},{:.4},{:.6},{:.6},{:.4},{:.4},{}\n",
            r.site.id, s.t, s.sun_az, s.sun_el, s.horizon_at_sun, s.sun_frac, s.earth_az, s.earth_el,
            s.horizon_at_earth, s.earth_frac, s.earth_frac >= 0.5
        ));
    }
    Ok((
        [(header::CONTENT_TYPE, "text/csv"), (header::CONTENT_DISPOSITION, "attachment; filename=\"seal.csv\"")],
        csv,
    )
        .into_response())
}
