//! SEAL server: serves the frontend and the API in docs/API.md.
//!
//! Run from the repo root:   cargo run --release --manifest-path server/Cargo.toml
//! Then open:                http://localhost:8080
//!
//! Environment (all optional):
//!   PORT=8080
//!   FRONTEND_DIR=frontend
//!   SITES_FILE=docs/sites.json
//!   CACHE_DIR=cache            (Horizons responses are cached here)
//!   HORIZONS_URL=https://ssd.jpl.nasa.gov/api/horizons.api

mod api;
mod horizons;
mod terrain;

use axum::routing::{get, post};
use axum::Router;
use std::sync::Arc;
use tower_http::cors::CorsLayer;
use tower_http::services::ServeDir;

fn env(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_string())
}

pub fn app(state: api::Shared, frontend_dir: &str) -> Router {
    Router::new()
        .route("/api/sites", get(api::sites))
        .route("/api/compute", post(api::compute))
        .route("/api/compare", post(api::compare))
        .route("/api/export.csv", post(api::export_csv))
        .fallback_service(ServeDir::new(frontend_dir))
        .layer(CorsLayer::permissive())
        .with_state(state)
}

#[tokio::main(flavor = "multi_thread")]
async fn main() {
    let port = env("PORT", "8080");
    let frontend = env("FRONTEND_DIR", "frontend");
    let sites_file = env("SITES_FILE", "docs/sites.json");

    let sites: Vec<api::Site> = serde_json::from_str(
        &std::fs::read_to_string(&sites_file).unwrap_or_else(|e| panic!("cannot read {sites_file}: {e}")),
    )
    .expect("sites.json is not valid");

    // Swap `terrain::Flat` for the LOLA reader when it is ready.
    let state = Arc::new(api::AppState {
        sites,
        horizons: horizons::Horizons::new(
            env("HORIZONS_URL", "https://ssd.jpl.nasa.gov/api/horizons.api"),
            env("CACHE_DIR", "cache").into(),
        ),
        terrain: terrain::TerrainService::new(Box::new(terrain::Flat), "flat (LOLA terrain pending)"),
    });

    let addr = format!("0.0.0.0:{port}");
    let listener = tokio::net::TcpListener::bind(&addr).await.expect("bind");
    println!("SEAL running on http://localhost:{port}  (frontend: {frontend})");
    axum::serve(listener, app(state, &frontend)).await.expect("server");
}
