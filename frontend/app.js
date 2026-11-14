// SEAL frontend — plain JS, no build step.
// Talks to the axum API in docs/API.md. If the API is not reachable it falls
// back to demo data (JPL Horizons angles, flat horizon) so the UI still works.

const SUN_R_DEG = 0.267;   // Sun angular radius seen from the Moon
const EARTH_R_DEG = 0.95;  // Earth angular radius seen from the Moon

const state = {
  demo: false,
  sites: [],
  selected: [],          // site ids
  mode: "compute",       // "compute" | "compare"
  last: null,            // last results, for export
  charts: [],
};

const $ = (id) => document.getElementById(id);

// ---------- science helpers (mirror of seal_science, used in demo mode) ----------
function visibleFraction(el, horizon, r) {
  const x = Math.max(-1, Math.min(1, (el - horizon) / r));
  return 1 - (Math.acos(x) - x * Math.sqrt(1 - x * x)) / Math.PI;
}

function metrics(series) {
  const n = series.length;
  const dtH = n > 1 ? (Date.parse(series[1].t) - Date.parse(series[0].t)) / 3.6e6 : 0;
  const lit = (s) => s.sun_frac > 0;
  const contact = (s) => s.earth_frac >= 0.5;
  const longest = (pred) => { let b = 0, c = 0; for (const s of series) { if (pred(s)) { c++; b = Math.max(b, c); } else c = 0; } return b; };
  const firstFall = (pred) => { for (let i = 1; i < n; i++) if (pred(series[i - 1]) && !pred(series[i])) return series[i].t; return null; };
  const sunset = firstFall(lit), earthset = firstFall(contact);
  let usable = 0, past = false;
  if (n && lit(series[0]) && contact(series[0])) {
    const ends = [sunset, earthset].filter(Boolean).map(Date.parse);
    const t0 = Date.parse(series[0].t);
    if (ends.length) usable = (Math.min(...ends) - t0) / 864e5;
    else { usable = (Date.parse(series[n - 1].t) - t0) / 864e5; past = true; }
  }
  const nLit = series.filter(lit).length, nEarth = series.filter(contact).length;
  return {
    sunlit_pct: 100 * nLit / n, sunlit_hours: nLit * dtH,
    longest_dark_hours: longest((s) => !lit(s)) * dtH,
    earth_visible_pct: 100 * nEarth / n, earth_visible_hours: nEarth * dtH,
    longest_blackout_hours: longest((s) => !contact(s)) * dtH,
    next_sunset: sunset, next_earthset: earthset,
    usable_mission_days: usable, mission_runs_past_range: past,
  };
}

function demoCompute(siteId, start, end) {
  const raw = (window.SEAL_DEMO.series[siteId] || []);
  let rows = raw.filter(([t]) => (!start || t >= start) && (!end || t <= end));
  let ownWindow = false;
  // Demo data covers a fixed window per site; fall back to it if the request misses it.
  if (rows.length < 2 && raw.length >= 2) { rows = raw; ownWindow = true; }
  const series = rows.map(([t, saz, sel, eaz, eel]) => ({
    t, sun_az: saz, sun_el: sel, horizon_at_sun: 0, sun_frac: visibleFraction(sel, 0, SUN_R_DEG),
    earth_az: eaz, earth_el: eel, horizon_at_earth: 0, earth_frac: visibleFraction(eel, 0, EARTH_R_DEG),
  }));
  const site = state.sites.find((s) => s.id === siteId);
  return { site, summary: series.length > 1 ? metrics(series) : null, series, ownWindow };
}

// ---------- API ----------
async function api(path, body) {
  const res = await fetch(path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {});
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res;
}

function queryBody() {
  const toIso = (v) => (v ? new Date(v + "Z").toISOString().replace(".000", "") : null);
  return {
    start: toIso($("start").value),
    end: toIso($("end").value),
    step_minutes: Number($("step").value),
    observer_height_m: Number($("height").value) || 2,
  };
}

// ---------- home ----------
function renderPresets() {
  const ul = $("preset-list");
  ul.innerHTML = "";
  for (const s of state.sites) {
    const hasDemo = !!window.SEAL_DEMO?.series[s.id];
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.innerHTML = `<strong>${s.name}</strong>${state.demo && hasDemo ? '<span class="demo">● demo data</span>' : ""}
      <span class="coords">${s.lat.toFixed(3)}°, ${s.lon.toFixed(3)}°E · ${s.region}</span>`;
    b.onclick = () => openSite(s.id);
    li.appendChild(b);
    ul.appendChild(li);
  }
}

function openSite(id) {
  state.selected = [id];
  $("home").hidden = true;
  $("main").hidden = false;
  setDefaultDates();
  renderMap();
  renderSelection();
}

function setDefaultDates() {
  const id = state.selected[0];
  const raw = window.SEAL_DEMO?.series[id];
  const fmt = (iso) => iso.slice(0, 16);
  if (state.demo && raw) {
    $("start").value = fmt(raw[0][0]);
    $("end").value = fmt(raw[raw.length - 1][0]);
  } else if (!$("start").value) {
    const now = new Date(); now.setUTCMinutes(0, 0, 0);
    const end = new Date(now.getTime() + 30 * 864e5);
    $("start").value = fmt(now.toISOString());
    $("end").value = fmt(end.toISOString());
  }
}

// ---------- map (south polar stereographic, 80–90°S) ----------
function project(lat, lon) {
  const rho = Math.tan(Math.PI / 4 + (lat * Math.PI / 180) / 2); // 0 at pole
  const rMax = Math.tan(Math.PI / 4 + (-80 * Math.PI / 180) / 2);
  const k = 180 / rMax, L = lon * Math.PI / 180;
  return [200 + k * rho * Math.sin(L), 200 - k * rho * Math.cos(L)];
}

function renderMap() {
  const svg = $("map");
  const ns = "http://www.w3.org/2000/svg";
  svg.innerHTML = "";
  const add = (tag, attrs, parent = svg) => { const e = document.createElementNS(ns, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); parent.appendChild(e); return e; };
  for (const lat of [-80, -82, -84, -86, -88]) {
    const [, y] = project(lat, 0);
    add("circle", { cx: 200, cy: 200, r: 200 - y, class: "grid" });
    add("text", { x: 214, y: y + 12, class: "label" }).textContent = `${lat}°`;
  }
  for (let lon = 0; lon < 360; lon += 30) {
    const [x, y] = project(-80, lon);
    add("line", { x1: 200, y1: 200, x2: x, y2: y, class: "grid" });
    const [lx, ly] = project(-79.6, lon);
    const t = add("text", { x: lx, y: ly, class: "label", "text-anchor": "middle" });
    t.textContent = lon <= 180 ? `${lon}°E` : `${360 - lon}°W`;
  }
  for (const s of state.sites) {
    const [x, y] = project(s.lat, s.lon);
    const cls = ["site"];
    if (state.demo && window.SEAL_DEMO?.series[s.id]) cls.push("demo");
    if (state.selected.includes(s.id)) cls.push("sel");
    const g = add("g", { class: cls.join(" "), tabindex: 0, role: "button", "aria-label": s.name });
    add("title", {}, g).textContent = `${s.name} (${s.lat.toFixed(2)}°, ${s.lon.toFixed(2)}°E)`;
    add("circle", { cx: x, cy: y, r: 6 }, g);
    // Names only for selected sites, so close-together sites don't overlap.
    if (state.selected.includes(s.id)) add("text", { x: x + 9, y: y + 3 }, g).textContent = s.name.split(" (")[0];
    const pick = (e) => {
      if (state.mode === "compare" || e.shiftKey) {
        state.selected = state.selected.includes(s.id) ? state.selected.filter((i) => i !== s.id) : [...state.selected, s.id];
        if (!state.selected.length) state.selected = [s.id];
      } else state.selected = [s.id];
      setDefaultDates(); renderMap(); renderSelection();
    };
    g.addEventListener("click", pick);
    g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(e); } });
  }
}

function renderSelection() {
  $("selected-names").textContent = state.selected.map((id) => state.sites.find((s) => s.id === id)?.name).join(", ");
}

// ---------- tabs ----------
function setMode(mode) {
  state.mode = mode;
  $("tab-compute").classList.toggle("active", mode === "compute");
  $("tab-compare").classList.toggle("active", mode === "compare");
  $("tab-compute").setAttribute("aria-selected", mode === "compute");
  $("tab-compare").setAttribute("aria-selected", mode === "compare");
  $("run").textContent = mode === "compute" ? "Compute" : "Compare";
  if (mode === "compute" && state.selected.length > 1) state.selected = [state.selected[0]];
  $("status").textContent = mode === "compare" ? "Click several markers on the map to compare them." : "";
  renderMap(); renderSelection();
}

// ---------- run ----------
async function run() {
  const q = queryBody();
  $("status").textContent = "Computing…";
  $("export").disabled = true;
  try {
    let results;
    if (state.demo) {
      results = state.selected.map((id) => demoCompute(id, q.start, q.end));
      const missing = results.filter((r) => r.series.length < 2).map((r) => r.site.name);
      if (missing.length) $("status").textContent = `No demo data for: ${missing.join(", ")} (needs the backend).`;
      results = results.filter((r) => r.series.length >= 2);
    } else if (state.mode === "compute") {
      results = [await (await api("/api/compute", { site_id: state.selected[0], ...q })).json()];
    } else {
      results = (await (await api("/api/compare", { site_ids: state.selected, ...q })).json()).results;
    }
    if (!results.length) { $("results").hidden = true; return; }
    if (!$("status").textContent.startsWith("No demo")) {
      const own = results.filter((r) => r.ownWindow).map((r) => r.site.name.split(" (")[0]);
      $("status").textContent = own.length ? `Demo data: ${own.join(", ")} shown for their own sample dates.` : "";
    }
    state.last = results;
    renderResults(results);
    $("export").disabled = false;
  } catch (err) {
    $("status").textContent = `Error: ${err.message}`;
  }
}

// ---------- results ----------
const fmtT = (iso) => (iso ? iso.replace("T", " ").slice(0, 16) + " UTC" : "—");
const fmtN = (v, d = 1) => (v == null ? "—" : Number(v).toFixed(d));

function stat(k, v, unit = "", hi = false) {
  return `<div class="stat${hi ? " highlight" : ""}"><div class="k">${k}</div><div class="v">${v}${unit ? ` <small>${unit}</small>` : ""}</div></div>`;
}

function renderResults(results) {
  state.charts.forEach((c) => c.destroy());
  state.charts = [];
  $("results").hidden = false;
  $("csv-card").hidden = true;

  if (results.length === 1) {
    const m = results[0].summary;
    $("summary").innerHTML =
      stat("Usable mission", fmtN(m.usable_mission_days), m.mission_runs_past_range ? "days+" : "days", true) +
      stat("Next sunset", fmtT(m.next_sunset)) +
      stat("Next Earthset", fmtT(m.next_earthset)) +
      stat("Sunlit", fmtN(m.sunlit_pct, 0), "%") +
      stat("Earth in view", fmtN(m.earth_visible_pct, 0), "%") +
      stat("Longest dark", fmtN(m.longest_dark_hours, 0), "h") +
      stat("Longest comms blackout", fmtN(m.longest_blackout_hours, 0), "h");
  } else {
    $("summary").innerHTML = `<div class="card" style="grid-column:1/-1"><table class="cmp"><thead><tr>
      <th>Site</th><th>Usable mission (days)</th><th>Sunlit %</th><th>Earth in view %</th><th>Longest dark (h)</th><th>Next sunset</th><th>Next Earthset</th></tr></thead><tbody>
      ${results.map((r) => `<tr><td>${r.site.name}</td><td>${fmtN(r.summary.usable_mission_days)}</td><td>${fmtN(r.summary.sunlit_pct, 0)}</td>
      <td>${fmtN(r.summary.earth_visible_pct, 0)}</td><td>${fmtN(r.summary.longest_dark_hours, 0)}</td><td>${fmtT(r.summary.next_sunset)}</td><td>${fmtT(r.summary.next_earthset)}</td></tr>`).join("")}
      </tbody></table></div>`;
  }

  const palette = ["#f5b942", "#4aa3ff", "#3fbf7f", "#e5604d", "#b07cf0", "#e6e6e6"];
  const labels = results[0].series.map((s) => s.t.slice(5, 16).replace("T", " "));
  const axes = { x: { ticks: { color: "#8b95a8", maxTicksLimit: 10 }, grid: { color: "#2a3346" } }, y: { ticks: { color: "#8b95a8" }, grid: { color: "#2a3346" } } };
  const multi = results.length > 1;
  // Plot against "days from start" so sites with different sample dates line up.
  const pts = (r, key) => { const t0 = Date.parse(r.series[0].t); return r.series.map((s) => ({ x: (Date.parse(s.t) - t0) / 864e5, y: 100 * s[key] })); };
  const datasets = [];
  results.forEach((r, i) => {
    const name = multi ? `${r.site.name.split(" (")[0]} · ` : "";
    datasets.push({ label: `${name}Sun visible %`, data: pts(r, "sun_frac"), borderColor: multi ? palette[i] : "#f5b942", stepped: true, pointRadius: 0, borderWidth: 2 });
    datasets.push({ label: `${name}Earth visible %`, data: pts(r, "earth_frac"), borderColor: multi ? palette[i] : "#4aa3ff", borderDash: [6, 4], stepped: true, pointRadius: 0, borderWidth: 2 });
  });
  state.charts.push(new Chart($("chart"), {
    type: "line", data: { datasets },
    options: { responsive: true, maintainAspectRatio: false, interaction: { mode: "nearest", intersect: false },
      scales: { x: { ...axes.x, type: "linear", title: { display: true, text: `days from ${multi ? "start of each window" : fmtT(results[0].series[0].t)}`, color: "#8b95a8" } },
        y: { ...axes.y, min: 0, max: 100, title: { display: true, text: "% of disk visible", color: "#8b95a8" } } },
      plugins: { legend: { labels: { color: "#e7ebf3" } } } },
  }));

  $("elev-card").hidden = results.length !== 1;
  if (results.length === 1) {
    const s = results[0].series;
    state.charts.push(new Chart($("chart-elev"), {
      type: "line",
      data: { labels, datasets: [
        { label: "Sun elevation", data: s.map((x) => x.sun_el), borderColor: "#f5b942", pointRadius: 0, borderWidth: 2 },
        { label: "Horizon toward Sun", data: s.map((x) => x.horizon_at_sun), borderColor: "#8b6a2a", borderDash: [3, 3], pointRadius: 0, borderWidth: 1.5 },
        { label: "Earth elevation", data: s.map((x) => x.earth_el), borderColor: "#4aa3ff", pointRadius: 0, borderWidth: 2 },
        { label: "Horizon toward Earth", data: s.map((x) => x.horizon_at_earth), borderColor: "#2a5a8b", borderDash: [3, 3], pointRadius: 0, borderWidth: 1.5 },
      ] },
      options: { responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
        scales: { ...axes, y: { ...axes.y, title: { display: true, text: "degrees", color: "#8b95a8" } } },
        plugins: { legend: { labels: { color: "#e7ebf3" } } } },
    }));
  }
  $("chart-title").textContent = results.length > 1 ? "Compare: Sun (solid) and Earth (dashed) visibility" : "Visibility over time";
}

// ---------- export ----------
async function exportCsv() {
  let csv;
  if (!state.demo && state.mode === "compute") {
    csv = await (await api("/api/export.csv", { site_id: state.selected[0], ...queryBody() })).text();
  } else {
    const head = "site,time_utc,sun_az,sun_el,horizon_el_at_sun_az,sun_visible_frac,earth_az,earth_el,horizon_el_at_earth_az,earth_visible_frac,earth_contact";
    const rows = state.last.flatMap((r) => r.series.map((s) =>
      [r.site.id, s.t, s.sun_az, s.sun_el, s.horizon_at_sun, s.sun_frac.toFixed(4), s.earth_az, s.earth_el, s.horizon_at_earth, s.earth_frac.toFixed(4), s.earth_frac >= 0.5].join(",")));
    csv = [head, ...rows].join("\n");
  }
  // Show it (some hosts block downloads), and also try a download.
  $("csv-out").value = csv;
  $("csv-card").hidden = false;
  try {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `seal_${state.selected.join("_")}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  } catch { /* download blocked: the text box above still has the CSV */ }
}

async function copyCsv() {
  try { await navigator.clipboard.writeText($("csv-out").value); $("copy-csv").textContent = "Copied"; }
  catch { $("csv-out").select(); $("copy-csv").textContent = "Press Ctrl+C"; }
  setTimeout(() => ($("copy-csv").textContent = "Copy"), 1500);
}

// ---------- boot ----------
async function boot() {
  try {
    state.sites = await (await api("/api/sites")).json();
  } catch {
    state.demo = true;
    state.sites = window.SEAL_DEMO.sites;
    $("mode-badge").hidden = false;
  }
  renderPresets();
  $("back").onclick = () => { $("main").hidden = true; $("home").hidden = false; $("results").hidden = true; };
  $("tab-compute").onclick = () => setMode("compute");
  $("tab-compare").onclick = () => setMode("compare");
  $("run").onclick = run;
  $("export").onclick = exportCsv;
  $("copy-csv").onclick = copyCsv;
}
boot();
