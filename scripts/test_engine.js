// Regression tests for frontend/engine.js. Run from the repo root: node scripts/test_engine.js
const fs = require("fs"), path = require("path"), assert = require("assert");
const F = (p) => path.join(__dirname, "..", "frontend", p);
require(F("engine.js"));
SEAL.setEphemeris(JSON.parse(fs.readFileSync(F("data/ephemeris.json"))));
const meta = JSON.parse(fs.readFileSync(F("data/terrain.json"))), bin = fs.readFileSync(F("data/terrain.bin"));
SEAL.setTerrain(meta, new Int16Array(bin.buffer, bin.byteOffset, bin.length / 2));
const q = (start, end, step = 60) => ({ start, end, step_minutes: step, observer_height_m: 2 });
const ok = (name, fn) => { fn(); console.log("ok  " + name); };

ok("off-grid site uses a smooth Moon, not a -90 deg horizon", () => {
  const r = SEAL.compute({ lat: 0.674, lon: 23.473 }, q("2025-01-01T00:00:00Z", "2025-03-01T00:00:00Z"));
  assert.strictEqual(r.terrain_coverage, 0);
  assert(r.summary.sunlit_pct > 45 && r.summary.sunlit_pct < 55, "Apollo 11 should be lit about half the time");
  assert(Math.min(...r.horizon.elevation_deg) > -1, "horizon must not be -90");
});
ok("far side never sees Earth", () => {
  const r = SEAL.compute({ lat: -45.44, lon: 177.6 }, q("2025-01-01T00:00:00Z", "2025-03-01T00:00:00Z"));
  assert.strictEqual(r.summary.earth_visible_pct, 0);
});
ok("exact pole gives finite results", () => {
  const r = SEAL.compute({ lat: -90, lon: 0 }, q("2025-01-01T00:00:00Z", "2025-02-01T00:00:00Z"));
  assert(Number.isFinite(r.summary.sunlit_pct));
});
ok("hours add up to the requested range, including a short last step", () => {
  const r = SEAL.compute({ lat: -85, lon: 0 }, q("2025-01-01T00:00:00Z", "2025-01-01T02:30:00Z"));
  const s = r.summary, lit = s.sunlit_hours, total = 2.5;
  assert(Math.abs(s.sunlit_pct / 100 * total - lit) < 1e-9);
  const r2 = SEAL.compute({ lat: -85, lon: 0 }, q("2025-01-01T00:00:00Z", "2025-01-03T00:00:00Z"));
  assert(r2.summary.sunlit_hours <= 48 && r2.summary.longest_dark_hours <= 48);
});
ok("range shorter than one step still has two samples", () => {
  const r = SEAL.compute({ lat: -85, lon: 0 }, q("2025-01-01T00:00:00Z", "2025-01-01T00:30:00Z"));
  assert.strictEqual(r.series.length, 2);
  assert(r.summary.sunlit_hours <= 0.5);
});
ok("partial terrain coverage is reported near 80 S", () => {
  const c = SEAL.horizonMask(-80.13, 1.44, 2).coverage;
  assert(c > 0 && c < 1);
});
console.log("all tests passed");
