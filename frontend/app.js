// SEAL frontend, interactive south-pole map + analysis panel. Plain JS, no build.
// All maths runs in the browser (engine.js): NASA JPL Horizons Sun/Earth table + LOLA terrain horizon.

const R_MOON_M = 1737400;
const SUN_R_DEG = 0.267, EARTH_R_DEG = 0.95;

const SNAP_HALF = 320003;          // LOLA snapshot covers ±320 km
const LIGHT_HALF = 640000;         // shadow overlay reaches ~±640 km (about 69°S)

const state = { sites: [], current: null, compare: [], last: null, charts: [], markers: {}, customMarker: null, map: null, online: false };
const $ = (id) => document.getElementById(id);

// ---------- projection: south polar stereographic on a 1737.4 km sphere ----------
function toXY(lat, lon) {
  const rho = 2 * R_MOON_M * Math.tan(Math.PI / 4 + (lat * Math.PI) / 360);
  const L = (lon * Math.PI) / 180;
  return [rho * Math.sin(L), rho * Math.cos(L)];
}
function toLatLon(x, y) {
  const rho = Math.hypot(x, y);
  const lat = (2 * Math.atan(rho / (2 * R_MOON_M)) - Math.PI / 2) * 180 / Math.PI;
  const lon = (Math.atan2(x, y) * 180) / Math.PI;
  return [lat, lon];
}
const distKm = (a, b) => { // great-circle distance on the Moon
  const r = Math.PI / 180, d = Math.sin(a[0] * r) * Math.sin(b[0] * r) + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.cos((a[1] - b[1]) * r);
  return Math.acos(Math.min(1, Math.max(-1, d))) * 1737.4;
};

// ---------- query ----------
function queryBody() {
  const iso = (v) => (v ? new Date(v + "Z").toISOString().replace(".000", "") : null);
  return { start: iso($("start").value), end: iso($("end").value), step_minutes: Number($("step").value), observer_height_m: Number($("height").value) || 2 };
}

// ---------- 3D Moon globe ----------
function initMap() {
  Globe.init($("map"), { globalTex: "moon_global.jpg", poleTex: "south_pole_wac.jpg", poleHalf: SNAP_HALF, overlayHalf: LIGHT_HALF });
  Globe.setSites(state.sites);
  Globe.on("site", (s) => selectSite(s, true));
  Globe.on("pick", ([lat, lon]) => selectCustom(lat, lon));
  Globe.on("hover", (p) => {
    $("cursor").textContent = p ? `${fmtLat(p[0])}, ${fmtLon(p[1])}${p[0] < -79 ? ` · ${distKm(p, [-90, 0]).toFixed(1)} km from pole` : ""}` : "Drag to rotate · scroll to zoom";
  });
  state.map = true;
  // real Sun right now (clamped to the data range) lights the globe and the polar shadows
  const r = SEAL.range(), now = Math.min(Math.max(Date.now(), Date.parse(r.start)), Date.parse(r.end));
  drawLightAt(now);
}
function setPinSelected(id) { Globe.select(id); }

// ---------- selection & info panel ----------
const fmtLat = (v) => `${Math.abs(v).toFixed(3)}°${v < 0 ? "S" : "N"}`;
const fmtLon = (v) => `${Math.abs(v).toFixed(3)}°${v < 0 ? "W" : "E"}`;
const GROUPS = [["artemis", "Artemis III candidate regions"], ["history", "Past landings"]];
function emptyInfoHTML() {
  return `<h2>Choose a landing site</h2>
    <p class="muted">Pick a site below, click anywhere on the Moon, or type coordinates.</p>
    <form id="coord-form" class="coord-form" autocomplete="off">
      <label><span class="lab">Latitude<button type="button" class="tip" aria-label="What is this?" data-tip="Degrees north or south of the equator. Use a minus sign or S for south, for example -85.2 or 85.2S.">i</button></span><input id="in-lat" inputmode="decimal" placeholder="-85.2"></label>
      <label><span class="lab">Longitude<button type="button" class="tip" aria-label="What is this?" data-tip="Degrees east or west. Use a minus sign or W for west, for example 31.5 or 31.5E.">i</button></span><input id="in-lon" inputmode="decimal" placeholder="31.5"></label>
      <button class="secondary" type="submit">Go</button>
    </form>
    <p id="coord-err" class="status" hidden></p>
    <div id="site-list" class="site-list"></div>`;
}
function parseCoord(txt, pos, neg) {
  const m = String(txt).trim().toUpperCase().match(/^([+-]?\d+(?:\.\d+)?)\s*°?\s*([NSEW])?$/);
  if (!m) return NaN;
  let v = parseFloat(m[1]);
  if (m[2] === neg) v = -Math.abs(v); else if (m[2] === pos) v = Math.abs(v);
  return v;
}
function renderSiteList() {
  const box = $("site-list"); box.innerHTML = "";
  for (const [g, title] of GROUPS) {
    const sites = state.sites.filter((s) => (s.group || "artemis") === g); if (!sites.length) continue;
    const h = document.createElement("h3"); h.className = "group-title"; h.textContent = title; box.appendChild(h);
    for (const s of sites) {
      const b = document.createElement("button");
      b.innerHTML = `<strong>${s.name}</strong><small>${fmtLat(s.lat)}, ${fmtLon(s.lon)}${s.landed ? ` · landed ${s.landed.slice(0, 4)}` : ""}</small>`;
      b.onclick = () => selectSite(s, true);
      box.appendChild(b);
    }
  }
  const f = $("coord-form");
  if (f) f.onsubmit = (e) => {
    e.preventDefault();
    const lat = parseCoord($("in-lat").value, "N", "S"), lon = parseCoord($("in-lon").value, "E", "W");
    const err = !isFinite(lat) || lat < -90 || lat > 90 ? "Latitude must be a number from -90 to 90." : !isFinite(lon) || lon < -180 || lon > 360 ? "Longitude must be a number from -180 to 180." : "";
    $("coord-err").hidden = !err; $("coord-err").textContent = err;
    if (err) return;
    const L = lon > 180 ? lon - 360 : lon;
    selectCustom(lat, L); Globe.flyTo(lat, L, lat < -80 ? 1.3 : 1.6, 1400);
  };
}

// Region pins sit at the centre of NASA's ~15 km regions. With real terrain some centres are in crater shadow,
// so point people to the best lit spot within 5 km (precomputed for 2025, 2 m above the ground).
function bestSpotHTML(site) {
  const L = site.light; if (!L || !L.best || !SEAL.terrain) return "";
  const b = L.best, gain = b.sun - L.centre_sun;
  if (gain < 15) return `<p class="muted small-print">In 2025 this pin gets Sun ${L.centre_sun}% of the time and Earth ${L.centre_earth}% (LOLA terrain).</p>`;
  return `<div class="best-spot">
      <p><strong>${L.centre_sun < 5 ? "This pin sits in crater shadow." : "A better lit spot is close by."}</strong> The pin marks the centre of NASA's region. In 2025 it gets Sun ${L.centre_sun}% of the time and Earth ${L.centre_earth}%.</p>
      <p>${b.km} km away, at ${fmtLat(b.lat)}, ${fmtLon(b.lon)}, a ridge gets Sun ${b.sun}% and Earth ${b.earth}%. Where exactly you land inside a region decides whether the mission works.</p>
      <button type="button" id="use-best" class="secondary">Go to the best lit spot</button>
    </div>`;
}
function showInfo(site, extraRows) {
  const pole = distKm([site.lat, site.lon], [-90, 0]);
  $("info").classList.remove("empty");
  $("info").innerHTML = `<button class="back" id="back-list">← All sites</button>
    <div class="info-card">
      <h2>${site.name} ${site.region === "Custom" ? '<span class="tag">your pin</span>' : site.group === "history" ? `<span class="tag">landed ${site.landed.slice(0, 10)}</span>` : '<span class="tag">Artemis III region</span>'}</h2>
      ${site.note ? `<p class="muted" style="margin:6px 0 0">${site.note}</p>` : ""}
      <dl class="kv">
        <dt>Latitude</dt><dd>${fmtLat(site.lat)}</dd>
        <dt>Longitude</dt><dd>${fmtLon(site.lon)}</dd>
        ${site.lat < -60 ? `<dt>From south pole</dt><dd>${pole.toFixed(1)} km</dd>` : ""}
        ${extraRows || ""}
      </dl>
      ${site.landed && site.landed < "2025" ? `<p class="muted small-print">SEAL's Sun and Earth data covers 2025 to 2028, so this shows what landing here on those dates would be like.</p>` : ""}
      ${site.lat > -79 ? `<p class="muted small-print">Away from the south pole the horizon is treated as smooth (no hill data here yet).</p>` : ""}
      ${bestSpotHTML(site)}
    </div>`;
  $("back-list").onclick = resetPanel;
  const bs = $("use-best");
  if (bs) bs.onclick = () => { const b = site.light.best; selectCustom(b.lat, b.lon, `Best lit spot near ${site.name.split(" (")[0]}`); Globe.flyTo(b.lat, b.lon, 1.3, 1200); };
  $("query").hidden = false;
  $("results").hidden = true;
}

function selectSite(site, fly) {
  state.current = site;
  Globe.setPin(null);
  setPinSelected(site.id);
  if (fly) Globe.flyTo(site.lat, site.lon, 1.3, 1200);
  showInfo(site);
  setDefaultDates(); renderCompare();
  $("status").textContent = "";
  openCalendar(site);
}

function selectCustom(lat, lon, name) {
  const site = { id: `custom_${lat.toFixed(4)}_${lon.toFixed(4)}`, name: name || "Dropped pin", region: "Custom", lat, lon, note: "", source: "" };
  state.current = site;
  setPinSelected(null);
  Globe.setPin(lat, lon);
  const nearest = state.sites.map((s) => [s, distKm([lat, lon], [s.lat, s.lon])]).sort((a, b) => a[1] - b[1])[0];
  showInfo(site, nearest ? `<dt>Nearest site</dt><dd>${nearest[0].name.split(" (")[0]} · ${nearest[1].toFixed(1)} km</dd>` : "");
  setDefaultDates(); renderCompare();
  $("status").textContent = "";
  setTimeout(() => openCalendar(site), 50);
}

function resetPanel() {
  state.current = null; setPinSelected(null);
  $("info").classList.add("empty");
  $("info").innerHTML = emptyInfoHTML();
  renderSiteList(); $("query").hidden = true; $("results").hidden = true;
}

function setDefaultDates() {
  if ($("start").value) return;
  const fmt = (d) => d.toISOString().slice(0, 16), r = SEAL.range();
  let t = new Date(); t.setUTCMinutes(0, 0, 0);
  if (t.toISOString() < r.start || t.getTime() + 30 * 864e5 > Date.parse(r.end)) t = new Date(r.start);
  $("start").value = fmt(t); $("end").value = fmt(new Date(t.getTime() + 30 * 864e5));
  $("start").min = $("end").min = r.start.slice(0, 16); $("start").max = $("end").max = r.end.slice(0, 16);
}

// ---------- compare ----------
function renderCompare() {
  const n = state.compare.length, here = state.current && state.compare.some((s) => s.id === state.current.id);
  $("compare-bar").hidden = n === 0;
  $("add-compare").textContent = here ? "✓ In compare list" : "+ Compare";
  $("run-compare").disabled = n < 2;
  $("run-compare").className = n >= 2 ? "primary small" : "secondary small";
  $("compare-hint").textContent = n === 1 ? "Now pick another site (list or Moon) and press + Compare again." : n >= 2 ? `${n} sites ready. Press Compare now to see them side by side.` : "";
  $("compare-chips").innerHTML = state.compare.map((s, i) => `<span class="chip" data-i="${i}" title="Remove">${s.name.split(" (")[0]} ✕</span>`).join(" ");
  $("compare-chips").querySelectorAll(".chip").forEach((c) => (c.onclick = () => { state.compare.splice(+c.dataset.i, 1); renderCompare(); }));
}

// ---------- run ----------
async function run(sites) {
  const q = queryBody();
  $("status").textContent = SEAL.terrain ? "Tracing the skyline from LOLA terrain and computing…" : "Computing…";
  await new Promise((r) => setTimeout(r, 30)); // let the status paint
  try {
    const results = sites.map((s) => SEAL.compute(s, q));
    $("status").textContent = "";
    state.last = results;
    renderResults(results);
  } catch (e) { $("status").textContent = e.message; }
}

// ---------- results ----------
const fmtT = (iso) => (iso ? iso.replace("T", " ").slice(0, 16) + " UTC" : "-");
const fmtN = (v, d = 1) => (v == null ? "-" : Number(v).toFixed(d));
const stat = (k, v, unit = "", cls = "") => `<div class="stat ${cls}"><div class="k">${k}</div><div class="v">${v}${unit ? ` <small>${unit}</small>` : ""}</div></div>`;

function bestWindow(series) {
  const ok = (s) => s.sun_frac > 0 && s.earth_frac >= 0.5;
  let best = null, start = null;
  series.forEach((s, i) => {
    if (ok(s) && start === null) start = i;
    if ((!ok(s) || i === series.length - 1) && start !== null) {
      const endI = i, days = (Date.parse(series[endI].t) - Date.parse(series[start].t)) / 864e5;
      if (!best || days > best.days) best = { days, from: series[start].t, to: series[endI].t };
      start = null;
    }
  });
  return best;
}
function verdict(m, series, site) {
  const b = SEAL.batteryPlan(site, series[0].t, power()), p = power();
  if (!b || !b.landed_in_sun) {
    const bw = bestWindow(series);
    return ["bad", `No sunlight if you land at ${fmtT(series[0].t)}`, bw ? `Next landing with Sun + Earth in your range: ${fmtT(bw.from)}. Open the landing calendar to pick a good day.` : "Open the landing calendar to pick a good day."];
  }
  const days = p.battery_wh > 0 ? b.yours_days : b.solar_days, capped = p.battery_wh > 0 ? b.yours_capped : b.solar_capped;
  const cls = days >= 10 ? "good" : days >= 5 ? "warn" : "bad", icon = "";
  const how = p.battery_wh > 0 ? `solar + your ${p.battery_wh / 1000} kWh battery` : "solar only";
  const earth = m.next_earthset ? `Earth (radio) sets ${fmtT(m.next_earthset)}.` : "Earth stays in view for your whole range.";
  return [cls, `${dfmt(days, capped)} days of operation`, `On ${how}. ${earth} Earth is in view ${b.earth_pct.toFixed(0)}% of the mission.`];
}

function renderResults(results) {
  state.charts.forEach((c) => c.destroy()); state.charts = [];
  $("results").hidden = false; $("csv-card").hidden = true;
  const multi = results.length > 1;
  if (!multi) {
    const m = results[0].summary, [cls, title, sub] = verdict(m, results[0].series, results[0].site);
    $("verdict").className = `verdict ${cls}`; $("verdict").hidden = false;
    $("verdict").innerHTML = `<strong>${title}</strong><span class="muted">${sub}</span>`;
    const ser = results[0].series, t0 = Date.parse(ser[0].t), maxSun = Math.max(...ser.map((p) => p.sun_el));
    const left = (iso) => { if (!iso) return "not in range"; const h = (Date.parse(iso) - t0) / 3.6e6; return `${Math.floor(h / 24)} d ${Math.round(h % 24)} h`; };
    $("summary").innerHTML = `<div class="plan-card"><h4>Power plan</h4>${planHTML(results[0].site, ser[0].t)}</div>` +
      stat('<i class="disc sun"></i>Sunset in', left(m.next_sunset), "", "sun big") + stat('<i class="disc earth"></i>Earthset in', left(m.next_earthset), "", "earth big") +
      `<p class="muted small-note">${m.next_sunset ? "Sunset " + fmtT(m.next_sunset) : ""}${m.next_sunset && m.next_earthset ? " · " : ""}${m.next_earthset ? "Earthset " + fmtT(m.next_earthset) : ""}</p>` +
      stat("Sun height at start", fmtN(ser[0].sun_el, 1), "°", "sun") + stat("Highest Sun", fmtN(maxSun, 1), "°", "sun") +
      stat("Sunlit", fmtN(m.sunlit_pct, 0), "%", "sun") + stat("Earth in view", fmtN(m.earth_visible_pct, 0), "%", "earth") +
      stat("Longest dark", fmtN(m.longest_dark_hours, 0), "h") + stat("Longest comms gap", fmtN(m.longest_blackout_hours, 0), "h");
  } else {
    $("verdict").hidden = true;
    $("summary").innerHTML = `<table class="cmp"><thead><tr><th>Site</th><th>Operating days</th><th>Earthset in</th><th>Sunlit %</th><th>Earth %</th><th>First night</th><th>Battery to survive</th></tr></thead><tbody>${
      results.map((r) => `<tr><td>${r.site.name.split(" (")[0]}</td><td>${(() => { const b = SEAL.batteryPlan(r.site, r.series[0].t, power()); if (!b || !b.landed_in_sun) return "dark at landing"; const pw = power(); return pw.battery_wh > 0 ? dfmt(b.yours_days, b.yours_capped) : dfmt(b.solar_days, b.solar_capped); })()}</td><td>${r.summary.next_earthset ? fmtN((Date.parse(r.summary.next_earthset) - Date.parse(r.series[0].t)) / 864e5) + " d" : "-"}</td><td>${fmtN(r.summary.sunlit_pct, 0)}</td><td>${fmtN(r.summary.earth_visible_pct, 0)}</td>${(() => { const b = SEAL.batteryPlan(r.site, r.series[0].t, power()); return b && b.landed_in_sun && b.first_night_h ? `<td>${b.first_night_h} h</td><td>${(b.need_wh / 1000).toFixed(1)} kWh</td>` : "<td>-</td><td>-</td>"; })()}</tr>`).join("")}</tbody></table>`;
  }

  const pal = ["#ffbf47", "#4da8ff", "#3ccf8e", "#ff6b5a", "#b98cff", "#e6e6e6"];
  const pts = (r, k) => { const t0 = Date.parse(r.series[0].t); return r.series.map((s) => ({ x: (Date.parse(s.t) - t0) / 864e5, y: 100 * s[k] })); };
  const ds = [];
  results.forEach((r, i) => {
    const n = multi ? `${r.site.name.split(" (")[0]} · ` : "";
    ds.push({ label: `${n}Sun`, data: pts(r, "sun_frac"), borderColor: multi ? pal[i] : "#ffbf47", backgroundColor: multi ? "transparent" : "rgba(255,191,71,.12)", fill: !multi, stepped: true, pointRadius: 0, borderWidth: 2 });
    ds.push({ label: `${n}Earth`, data: pts(r, "earth_frac"), borderColor: multi ? pal[i] : "#4da8ff", borderDash: [6, 4], stepped: true, pointRadius: 0, borderWidth: 2 });
  });
  const ax = { ticks: { color: "#9b9b9b" }, grid: { color: "rgba(255,255,255,.08)" } };
  state.charts.push(new Chart($("chart"), { type: "line", data: { datasets: ds },
    options: { responsive: true, maintainAspectRatio: false, interaction: { mode: "nearest", intersect: false },
      scales: { x: { ...ax, type: "linear", title: { display: true, text: "days from start", color: "#9b9b9b" } }, y: { ...ax, min: 0, max: 100, title: { display: true, text: "% visible", color: "#9b9b9b" } } },
      plugins: { legend: { labels: { color: "#e6e6e6", boxWidth: 12 } } } } }));
  $("chart-title").textContent = multi ? "Compare: Sun (solid) vs Earth (dashed)" : "Sun & Earth visibility";

  $("elev-card").hidden = multi; $("sky-card").hidden = multi;
  if (!multi) {
    const r = results[0], hz = r.horizon.elevation_deg, st = r.horizon.az_step_deg;
    const sky = (k) => r.series.map((p, i) => ({ x: p[k + "_az"], y: p[k + "_el"], i })).filter((p) => p.y > -5);
    state.charts.push(new Chart($("chart-sky"), { type: "scatter", data: { datasets: [
      { label: "Skyline (terrain)", type: "line", data: hz.map((v, i) => ({ x: i * st, y: v })).concat([{ x: 360, y: hz[0] }]), borderColor: "#9b9b9b", backgroundColor: "rgba(170,170,170,.28)", fill: "start", pointRadius: 0, borderWidth: 1.5, order: 3 },
      { label: "Sun path", legendColor: "#ffbf47", data: sky("sun"), backgroundColor: "#ffbf47", pointRadius: 1.6, order: 1 },
      { label: "Earth path", legendColor: "#4da8ff", data: sky("earth"), backgroundColor: "#4da8ff", pointRadius: 1.6, order: 2 },
      { label: "Sun now", legendColor: "#ffbf47", data: [], backgroundColor: "#ffbf47", borderColor: "#fff", borderWidth: 2, pointRadius: 8, order: 0 },
      { label: "Earth now", legendColor: "#4da8ff", data: [], backgroundColor: "#4da8ff", borderColor: "#fff", borderWidth: 2, pointRadius: 7, order: 0 },
    ] }, options: { responsive: true, maintainAspectRatio: false, animation: false,
      scales: { x: { ...ax, type: "linear", min: 0, max: 360, ticks: { color: "#9b9b9b", stepSize: 45, callback: (v) => ({ 0: "N", 90: "E", 180: "S", 270: "W", 360: "N" })[v] ?? v + "°" }, title: { display: true, text: "direction (azimuth)", color: "#9b9b9b" } },
        y: { ...ax, min: -5, suggestedMax: 15, title: { display: true, text: "degrees above horizontal", color: "#9b9b9b" } } },
      plugins: { legend: { labels: { color: "#e6e6e6", boxWidth: 12 } } } } }));
  }
  if (!multi) {
    const s = results[0].series, t0 = Date.parse(s[0].t), X = (r) => (Date.parse(r.t) - t0) / 864e5;
    state.charts.push(new Chart($("chart-elev"), { type: "line", data: { datasets: [
      { label: "Sun", data: s.map((r) => ({ x: X(r), y: r.sun_el })), borderColor: "#ffbf47", pointRadius: 0, borderWidth: 2 },
      { label: "Earth", data: s.map((r) => ({ x: X(r), y: r.earth_el })), borderColor: "#4da8ff", pointRadius: 0, borderWidth: 2 },
      { label: "Terrain horizon", data: s.map((r) => ({ x: X(r), y: r.horizon_at_sun })), borderColor: "#9b9b9b", borderDash: [3, 3], pointRadius: 0, borderWidth: 1.5 },
      { label: "Now", data: [], borderColor: "rgba(255,255,255,.7)", borderWidth: 1.5, pointRadius: 0, borderDash: [4, 3] },
      { label: "Sun now", legendColor: "#ffbf47", data: [], type: "scatter", backgroundColor: "#ffbf47", borderColor: "#fff", borderWidth: 2, pointRadius: 6 },
      { label: "Earth now", legendColor: "#4da8ff", data: [], type: "scatter", backgroundColor: "#4da8ff", borderColor: "#fff", borderWidth: 2, pointRadius: 6 },
    ] }, options: { responsive: true, maintainAspectRatio: false, interaction: { mode: "nearest", intersect: false },
      scales: { x: { ...ax, type: "linear", title: { display: true, text: "days from start", color: "#9b9b9b" } }, y: { ...ax, title: { display: true, text: "degrees", color: "#9b9b9b" } } },
      plugins: { legend: { labels: { color: "#e6e6e6", boxWidth: 12, filter: (l) => !/now|Now/.test(l.text) } } } } }));
  }
  setupTimeline(results);
  $("finder-card").hidden = multi;
  if (!multi) renderFinder(results[0].site);
  const panel = $("panel"); panel.scrollTo({ top: $("results").offsetTop - panel.offsetTop - 8, behavior: "smooth" });
}

// ---------- power plan ----------
const power = () => ({ night_w: Math.max(1, Number($("night-w").value) || 100), battery_wh: Math.max(0, Number($("battery-kwh").value) || 0) * 1000, observer_height_m: Number($("height").value) || 2 });
const dfmt = (d, capped) => (capped ? `${Math.floor(d)}+` : d.toFixed(1));
function planHTML(site, landISO, short) {
  const p = power(), b = SEAL.batteryPlan(site, landISO, p);
  if (!b) return "";
  if (!b.landed_in_sun) return `<p>The Sun is hidden at this moment, so solar panels can't charge after landing.</p>`;
  const nightD = b.first_night_h ? (b.first_night_h / 24).toFixed(1) : null;
  const yours = p.battery_wh > 0
    ? (b.yours_nights > 0 || b.yours_capped
        ? `<i class="disc batt"></i><b>Your ${p.battery_wh / 1000} kWh battery</b> survives ${b.yours_capped ? "every" : b.yours_nights} night${b.yours_nights === 1 && !b.yours_capped ? "" : "s"}${b.yours_killer ? `, then a ${b.yours_killer.len} h night drains it` : ""}: <b>${dfmt(b.yours_days, b.yours_capped)} days</b> of operation.`
        : `<i class="disc batt"></i><b>Your ${p.battery_wh / 1000} kWh battery</b> keeps you running ${((b.yours_days - b.solar_days) * 24).toFixed(0)} h into the first night, then runs out: <b>${dfmt(b.yours_days, b.yours_capped)} days</b> total.`)
    : "";
  return `<p><i class="disc sun"></i><b>Solar only: ${dfmt(b.solar_days, b.solar_capped)} days</b> of operation${b.solar_capped ? "" : ", until sunset"}. Earth in view ${b.earth_pct.toFixed(0)}% of the time.</p>
    ${nightD ? `<p><i class="disc night"></i>Then <b>${b.first_night_h} h (${nightD} days) of darkness</b>.</p>
    <p><i class="disc batt"></i>To survive that night at ${p.night_w} W you need <b>≈${(b.need_wh / 1000).toFixed(1)} kWh</b> (≈${Math.round(b.need_wh / 150)} kg of Li-ion, 80% usable). The panels recharge it every sunrise, so it keeps going ${b.with_need_killer ? `until a <b>longer night (${b.with_need_killer.len} h, ${(b.with_need_killer.len / 24).toFixed(1)} days)</b> arrives on day ${(b.with_need_killer.startH / 24).toFixed(0)}: <b>${dfmt(b.with_need_days, b.with_need_capped)} days</b> total` : `for <b>${dfmt(b.with_need_days, b.with_need_capped)} days</b> or more`}.</p>` : `<p>No sunset in the next 120 days here.</p>`}
    ${b.year_longest_night_h ? `<p><b>To survive every night for a full year,</b> the longest night is ${b.year_longest_night_h} h (${(b.year_longest_night_h / 24).toFixed(1)} days, around day ${b.year_longest_night_day.toFixed(0)}), so you need <b>≈${(b.need_year_wh / 1000).toFixed(1)} kWh</b> (≈${Math.round(b.need_year_wh / 150)} kg). With a battery that big, darkness stops being the limit; battery wear and cold become the limits instead (only ~13 charge cycles a year, which is gentle for Li-ion).${b.year_full ? "" : " (Data ends before a full year.)"}</p>` : ""}
    ${yours ? `<p>${yours}</p>` : ""}`;
}

// ---------- landing calendar (Google-Flights style) ----------
const cal = { site: null, month: null, sel: null, days: new Map() };
const colOp = (d) => (d == null ? "" : d >= 10 ? "g" : d >= 5 ? "y" : d >= 1 ? "o" : "r");
function openCalendar(site) {
  cal.site = site; cal.sel = null;
  const r = SEAL.range(), base = $("start").value ? new Date($("start").value + "Z") : new Date();
  const b = base < new Date(r.start) || base > new Date(r.end) ? new Date(r.start) : base;
  cal.month = new Date(Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), 1));
  $("cal-title").textContent = site.name.split(" (")[0];
  $("cal-modal").hidden = false; renderCalendar();
}
function renderCalendar() {
  const p = power(), r = SEAL.range(), m0 = cal.month, m2 = new Date(Date.UTC(m0.getUTCFullYear(), m0.getUTCMonth() + 2, 0));
  const days = SEAL.missionCalendar(cal.site, { from: m0.toISOString(), to: m2.toISOString(), ...p });
  cal.days = new Map(days.map((d) => [d.day, d]));
  const best = days.filter((d) => d.ok).reduce((a, d) => (!a || d.op_days > a.op_days ? d : a), null);
  const month = (mDate) => {
    const y = mDate.getUTCFullYear(), mo = mDate.getUTCMonth(), first = (new Date(Date.UTC(y, mo, 1)).getUTCDay() + 6) % 7, n = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
    let h = `<div class="cal-month"><h4>${mDate.toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })}</h4><div class="cal-grid">${["Mo","Tu","We","Th","Fr","Sa","Su"].map((w) => `<span class="wd">${w}</span>`).join("")}`;
    for (let i = 0; i < first; i++) h += `<span></span>`;
    for (let d = 1; d <= n; d++) {
      const key = `${y}-${String(mo + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`, x = cal.days.get(key);
      if (!x) { h += `<span class="cd off">${d}</span>`; continue; }
      const isBest = best && key === best.day, c = x.ok ? colOp(x.op_days) : "n";
      h += `<button class="cd ${c}${isBest ? " best" : ""}${cal.sel === key ? " sel" : ""}" data-day="${key}"><span class="dn">${d}</span><span class="dv">${x.ok ? dfmt(x.op_days, x.capped) + "d" : "-"}</span>${isBest ? '<span class="star"></span>' : ""}</button>`;
    }
    return h + "</div></div>";
  };
  $("cal-months").innerHTML = month(m0) + month(new Date(Date.UTC(m0.getUTCFullYear(), m0.getUTCMonth() + 1, 1)));
  const tr = SEAL.missionTrack(cal.site, p.observer_height_m), neverEarth = !tr.earth.some((v) => v);
  $("cal-best").innerHTML = best ? `Best in these two months: <b>${best.day}</b>, <b>${dfmt(best.op_days, best.capped)} days</b> of operation`
    : neverEarth ? "Earth is never in view from here (far side). A lander needs a relay satellite to talk home, like Chang'e 4 used."
    : "No landing with Sun and Earth both up in these two months";
  $("cal-prev").disabled = m0 <= new Date(r.start); $("cal-next").disabled = new Date(Date.UTC(m0.getUTCFullYear(), m0.getUTCMonth() + 2, 1)) > new Date(r.end);
  renderTradeoffs();
  $("cal-months").querySelectorAll("button.cd").forEach((b) => (b.onclick = () => { cal.sel = b.dataset.day; renderCalendar(); }));
  const x = cal.sel && cal.days.get(cal.sel);
  if (!x) { $("cal-detail").innerHTML = `<p class="muted">Click a date to see the power plan. Numbers = days the lander keeps working if it lands that day (best landing hour), with your battery setting.</p>`; $("cal-go").disabled = true; return; }
  if (!x.ok) { $("cal-detail").innerHTML = `<p><b>${x.day}</b>: no hour that day has both the Sun up (power) and Earth in view (radio for landing). Pick a coloured date.</p>`; $("cal-go").disabled = true; return; }
  $("cal-detail").innerHTML = `<p class="land">Land <b>${fmtT(x.land)}</b>${x.earthset_days != null ? `. First Earthset after ${x.earthset_days.toFixed(1)} days.` : ""}</p>` + planHTML(cal.site, x.land);
  $("cal-go").disabled = false;
  $("cal-go").onclick = () => {
    const t = Date.parse(x.land), endT = Math.min(t + Math.min(Math.max(x.op_days + 3, 20), 60) * 864e5, Date.parse(SEAL.range().end));
    $("start").value = x.land.slice(0, 16); $("end").value = new Date(endT).toISOString().slice(0, 16);
    $("cal-modal").hidden = true; run([cal.site]);
  };
}

function renderTradeoffs() {
  const p = power(), m0 = cal.month, to = new Date(Date.UTC(m0.getUTCFullYear(), m0.getUTCMonth() + 6, 0));
  const list = SEAL.tradeoffs(cal.site, { from: m0.toISOString(), to: to.toISOString(), ...p });
  if (!list.length) { $("cal-trade").innerHTML = ""; return; }
  const most = list.reduce((a, b) => (b.solar_days > a.solar_days ? b : a));
  const withNight = list.filter((d) => d.first_night_h);
  const least = withNight.length ? withNight.reduce((a, b) => (b.need_wh < a.need_wh ? b : a)) : null;
  const pareto = list.filter((d) => d.pareto && d.first_night_h);
  const bal = pareto.length ? pareto.reduce((a, b) => (b.solar_days / (b.need_wh + 1e3) > a.solar_days / (a.need_wh + 1e3) ? b : a)) : null;
  const tag = (d) => [d === most ? '<span class="tag gold">Most days</span>' : "", d === least ? '<span class="tag blue">Smallest battery</span>' : "", d === bal && d !== most && d !== least ? '<span class="tag green">Best balance</span>' : ""].join(" ");
  $("cal-trade").innerHTML = `<h4>Trade-offs: next 6 months <span class="muted">(best landing in each lunar day, at ${p.night_w} W night power)</span></h4>
    <table class="cmp trade"><thead><tr><th>Land</th><th>Days on solar</th><th>First night</th><th>Battery to survive it</th><th>Days with that battery</th><th></th></tr></thead><tbody>${
    list.map((d) => `<tr data-day="${d.day}" data-month="${d.day.slice(0, 7)}" class="${d.pareto ? "pareto" : ""}">
      <td>${d.land.replace("T", " ").slice(0, 16)}</td><td><b>${dfmt(d.solar_days, d.solar_capped)}</b></td>
      <td>${d.first_night_h ? `${d.first_night_h} h (${(d.first_night_h / 24).toFixed(1)} d)` : "none ahead"}</td>
      <td>${d.first_night_h ? `${(d.need_wh / 1000).toFixed(1)} kWh · ≈${Math.round(d.need_wh / 150)} kg` : "-"}</td>
      <td>${d.first_night_h ? dfmt(d.with_need_days, d.with_need_capped) : "-"}</td><td>${tag(d)}</td></tr>`).join("")}</tbody></table>
    <p class="muted" style="font-size:.72rem;margin:4px 0 0">Shorter days often mean shorter nights, so a lighter battery. Bold rows can't be beaten on both days and battery at once. Li-ion assumed at 150 Wh/kg, 80% usable.</p>`;
  $("cal-trade").querySelectorAll("tr[data-day]").forEach((tr) => (tr.onclick = () => {
    const [y, m] = tr.dataset.month.split("-").map(Number);
    if (new Date(Date.UTC(y, m - 1, 1)) > new Date(Date.UTC(cal.month.getUTCFullYear(), cal.month.getUTCMonth() + 1, 1))) cal.month = new Date(Date.UTC(y, m - 1, 1));
    cal.sel = tr.dataset.day; renderCalendar(); $("cal-detail").scrollIntoView({ behavior: "smooth", block: "nearest" });
  }));
}

// ---------- landing-date finder ----------
function renderFinder(site) {
  const q = queryBody(), p = power(), from = new Date(Math.max(Date.parse(q.start) - 15 * 864e5, Date.parse(SEAL.range().start))).toISOString();
  const to = new Date(Date.parse(from) + 89 * 864e5).toISOString(), chosen = q.start.slice(0, 10);
  const scan = SEAL.missionCalendar(site, { from, to, ...p });
  if (!scan.length) { $("finder").innerHTML = '<p class="muted">Out of the data range.</p>'; return; }
  const best = scan.filter((d) => d.ok).reduce((a, d) => (!a || d.op_days > a.op_days ? d : a), null);
  $("finder").innerHTML = `<div class="strip">${scan.map((d) => `<button class="cell ${d.ok ? colOp(d.op_days) : "n"}${d.day === chosen ? " chosen" : ""}" data-t="${d.land || ""}"
      title="${d.day}: ${d.ok ? `land ${d.land.slice(11, 16)} UTC: ${dfmt(d.op_days, d.capped)} days of operation` : "no landing with Sun + Earth"}"></button>`).join("")}</div>
    <div class="strip-axis"><span>${scan[0].day}</span><span>${scan[Math.floor(scan.length / 2)].day}</span><span>${scan[scan.length - 1].day}</span></div>
    <p class="finder-best">${best ? `Best: <strong>${fmtT(best.land)}</strong>, <strong>${dfmt(best.op_days, best.capped)} days</strong>` : "No good landing in this window."}
    <button class="secondary small" id="open-cal2">Open calendar</button></p>`;
  $("finder").querySelectorAll(".cell").forEach((c) => (c.onclick = () => { if (!c.dataset.t) return; $("start").value = c.dataset.t.slice(0, 16); $("end").value = new Date(Math.min(Date.parse(c.dataset.t) + 30 * 864e5, Date.parse(SEAL.range().end))).toISOString().slice(0, 16); run([state.current]); }));
  $("open-cal2").onclick = () => openCalendar(site);
}

// ---------- timeline slider + map lighting ----------
const tl = { results: null, idx: 0, timer: null, overlay: null, pending: false };
function setupTimeline(results) {
  tl.results = results; tl.idx = 0; stopPlay();
  const n = results[0].series.length;
  $("tl-range").max = n - 1; $("tl-range").value = 0;
  $("timeline").hidden = false;
  if ($("light-mode").value === "off") $("light-mode").value = "sun";
  updateTimeline();
}
function updateTimeline() {
  const r = tl.results?.[0]; if (!r) return;
  const p = r.series[tl.idx], t0 = Date.parse(r.series[0].t), d = (Date.parse(p.t) - t0) / 864e5;
  const sunUp = p.sun_frac > 0, earthUp = p.earth_frac >= 0.5;
  $("tl-read").innerHTML = `<strong>${fmtT(p.t)}</strong> <span class="muted">(day ${d.toFixed(1)})</span><br>
    <span class="${sunUp ? "ok" : "no"}"><i class="disc sun"></i>Sun ${p.sun_el.toFixed(1)}° ${sunUp ? (p.sun_frac < 1 ? "partly visible" : "up") : "hidden"}</span> ·
    <span class="${earthUp ? "ok" : "no"}"><i class="disc earth"></i>Earth ${p.earth_el.toFixed(1)}° ${earthUp ? "in view" : "hidden"}</span>`;
  const sky = state.charts.find((c) => c.canvas.id === "chart-sky");
  if (sky) {
    const ds = sky.data.datasets;
    ds[3].data = [{ x: p.sun_az, y: p.sun_el }]; ds[4].data = [{ x: p.earth_az, y: p.earth_el }];
    // path already travelled = bright, still to come = faint
    ds[1].backgroundColor = ds[1].data.map((q) => (q.i <= tl.idx ? "#ffbf47" : "rgba(255,191,71,.18)"));
    ds[2].backgroundColor = ds[2].data.map((q) => (q.i <= tl.idx ? "#4da8ff" : "rgba(77,168,255,.18)"));
    sky.update("none");
  }
  const vis = state.charts.find((c) => c.canvas.id === "chart");
  if (vis && tl.results.length === 1) {
    let nd = vis.data.datasets.find((x) => x.label === "Now");
    if (!nd) { nd = { label: "Now", data: [], borderColor: "rgba(255,255,255,.7)", borderWidth: 1.5, pointRadius: 0, borderDash: [4, 3] }; vis.data.datasets.push(nd); vis.options.plugins.legend.labels.filter = (l) => l.text !== "Now"; }
    nd.data = [{ x: d, y: 0 }, { x: d, y: 100 }]; vis.update("none");
  }
  const elev = state.charts.find((c) => c.canvas.id === "chart-elev");
  if (elev) {
    const ds = elev.data.datasets, lo = elev.scales.y.min, hi = elev.scales.y.max;
    ds[3].data = [{ x: d, y: lo }, { x: d, y: hi }];
    ds[4].data = [{ x: d, y: p.sun_el }]; ds[5].data = [{ x: d, y: p.earth_el }];
    elev.update("none");
  }
  drawLight(Date.parse(p.t));
}
function drawLight(t) { drawLightAt(t); }
const relief = { t: null, pending: false, canvas: null };
function drawRelief(t) {
  if (!SEAL.terrain) return;
  relief.t = t; if (relief.pending) return; relief.pending = true;
  requestAnimationFrame(() => {
    relief.pending = false;
    const N = 1024, px = SEAL.reliefImage(relief.t, { N, half_m: SNAP_HALF }); if (!px) return;
    if (!relief.canvas) { relief.canvas = document.createElement("canvas"); relief.canvas.width = relief.canvas.height = N; }
    relief.canvas.getContext("2d").putImageData(new ImageData(px, N, N), 0, 0);
    Globe.setRelief(relief.canvas);
  });
}
function drawLightAt(t) {
  if (!state.map) return;
  Globe.setSun(SEAL._vecAt(SEAL.eph.sun, t)); drawRelief(t);
  const mode = $("light-mode").value;
  for (const m of Globe._G.shaded || []) m.uniforms.ambient.value = mode === "off" ? 1 : 0.45;
  if (mode === "off" || (mode === "sun" && !SEAL.terrain)) {
    // day/night is drawn by the globe itself; the overlay is only needed for terrain shadows or Earth visibility
    Globe.setOverlay(null);
    $("light-legend").hidden = mode === "off";
    $("light-legend").innerHTML = `Dark = Sun below the horizon · ${fmtT(new Date(t).toISOString())}${SEAL.terrain ? "" : " · crater shadows appear when LOLA terrain is added"}`;
    tl.lastT = t; return;
  }
  tl.lastT = t;
  if (tl.pending) return; tl.pending = true;
  requestAnimationFrame(() => {
    tl.pending = false;
    const N = tl.timer || $("tl-range").matches(":active") ? 220 : 440, half = LIGHT_HALF;
    const f = SEAL.lightField(tl.lastT, { body: mode, N, half_m: half, extra: mode === "sun" });
    if (!tl.canvas || tl.canvas.width !== N) { tl.canvas = document.createElement("canvas"); tl.canvas.width = tl.canvas.height = N; }
    const ctx = tl.canvas.getContext("2d"), img = ctx.createImageData(N, N);
    for (let i = 0; i < f.length; i++) {
      const lit = f[i], j = i * 4;
      if (mode === "sun") { img.data[j] = 2; img.data[j + 1] = 4; img.data[j + 2] = 14; img.data[j + 3] = Math.round(lit * 180); } // lit = extra terrain shadow
      else { img.data[j] = lit ? 77 : 140; img.data[j + 1] = lit ? 168 : 20; img.data[j + 2] = lit ? 255 : 30; img.data[j + 3] = lit ? 45 : 130; }
    }
    ctx.putImageData(img, 0, 0);
    Globe.setOverlay(tl.canvas);
    $("light-legend").hidden = false;
    $("light-legend").innerHTML = mode === "sun"
      ? `Dark = Sun below the horizon · <i style="background:#02040e"></i> crater/mountain shadow (LOLA) · ${fmtT(new Date(tl.lastT).toISOString())}`
      : `<i style="background:#8c141e"></i> Earth hidden · <i style="background:#4da8ff"></i> Earth in view · ${fmtT(new Date(tl.lastT).toISOString())}`;
  });
}
function stopPlay() { if (tl.timer) clearInterval(tl.timer); tl.timer = null; $("tl-play").textContent = "▶ Play"; }
function togglePlay() {
  if (tl.timer) return stopPlay();
  const n = tl.results[0].series.length, stepPerTick = Math.max(1, Math.round(n / 240));
  $("tl-play").textContent = "⏸ Pause";
  tl.timer = setInterval(() => {
    tl.idx = (tl.idx + stepPerTick) % n; $("tl-range").value = tl.idx; updateTimeline();
    if (tl.idx + stepPerTick >= n) stopPlay();
  }, 90);
}

// ---------- export ----------
function exportCsv() {
  if (!state.last) return;
  const head = "site,time_utc,sun_az,sun_el,horizon_el_at_sun_az,sun_visible_frac,earth_az,earth_el,horizon_el_at_earth_az,earth_visible_frac,earth_contact";
  const rows = state.last.flatMap((r) => r.series.map((s) => [r.site.id, s.t, s.sun_az, s.sun_el, (+s.horizon_at_sun).toFixed(4), (+s.sun_frac).toFixed(4), s.earth_az, s.earth_el, (+s.horizon_at_earth).toFixed(4), (+s.earth_frac).toFixed(4), s.earth_frac >= 0.5].join(",")));
  const csv = [head, ...rows].join("\n");
  $("csv-out").value = csv; $("csv-card").hidden = false;
  try { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = "seal.csv"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); } catch {}
}
async function copyCsv() {
  try { await navigator.clipboard.writeText($("csv-out").value); $("copy-csv").textContent = "Copied"; } catch { $("csv-out").select(); $("copy-csv").textContent = "Ctrl+C"; }
  setTimeout(() => ($("copy-csv").textContent = "Copy"), 1500);
}

// ---------- boot ----------
function setupSplitter() {
  const sp = $("splitter"), ex = $("explorer"); let drag = false;
  const stacked = () => window.matchMedia("(max-width: 600px)").matches;
  const apply = () => {
    const cs = getComputedStyle(ex);
    if (document.body.classList.contains("is-landing")) return Globe.setInset({ left: window.innerWidth > 760 ? ex.clientWidth * 0.42 : 0, bottom: window.innerWidth > 760 ? 0 : ex.clientHeight * 0.45 });
    if (stacked()) Globe.setInset({ left: 0, bottom: (parseFloat(cs.getPropertyValue("--sheet-h")) || ex.clientHeight * 0.52) + 8 });
    else Globe.setInset({ left: $("panel").getBoundingClientRect().width + 14, bottom: 0 });
  };
  state.applyInset = apply;
  sp.addEventListener("pointerdown", (e) => { drag = true; sp.classList.add("drag"); sp.setPointerCapture(e.pointerId); e.preventDefault(); });
  sp.addEventListener("pointermove", (e) => {
    if (!drag) return; const r = ex.getBoundingClientRect();
    if (stacked()) ex.style.setProperty("--sheet-h", Math.max(140, Math.min(r.height - 120, r.bottom - e.clientY - 8)) + "px");
    else ex.style.setProperty("--panel-w", Math.max(300, Math.min(r.width - 260, e.clientX - r.left - 14)) + "px");
    apply();
  });
  const end = () => { drag = false; sp.classList.remove("drag"); state.charts.forEach((c) => c.resize()); };
  sp.addEventListener("pointerup", end); sp.addEventListener("pointercancel", end);
  window.addEventListener("resize", () => state.map && apply());
}
async function openExplorer() {
  document.body.classList.remove("is-landing");
  state.applyInset && state.applyInset();
  Globe.toPole();
}
// Chart legends: clean solid colour keys (dashed lines made the Earth key look broken)
function tidyLegends() {
  if (!window.Chart || Chart.__tidy) return; Chart.__tidy = true;
  const orig = Chart.defaults.plugins.legend.labels.generateLabels;
  const solid = (v) => (typeof v === "string" && v !== "transparent" ? v : null);
  Chart.defaults.plugins.legend.labels.generateLabels = (c) => orig(c).map((l) => {
    const d = c.data.datasets[l.datasetIndex] || {};
    const col = d.legendColor || solid(d.borderColor) || solid(d.backgroundColor) || "#bbb";
    return { ...l, lineDash: [], lineWidth: 0, fillStyle: col, strokeStyle: col };
  });
  Chart.defaults.plugins.legend.labels.boxWidth = 10; Chart.defaults.plugins.legend.labels.boxHeight = 10;
}
// Info tips: one floating box, positioned next to the hovered/focused "i" and kept on screen
function setupTips() {
  const box = $("tipbox");
  const show = (el) => {
    box.textContent = el.dataset.tip; box.hidden = false;
    const r = el.getBoundingClientRect(), bw = box.offsetWidth, bh = box.offsetHeight;
    let x = r.left + r.width / 2 - bw / 2, y = r.bottom + 8;
    if (y + bh > innerHeight - 8) y = r.top - bh - 8;
    box.style.left = Math.max(8, Math.min(innerWidth - bw - 8, x)) + "px"; box.style.top = y + "px";
  };
  const hide = () => (box.hidden = true);
  document.addEventListener("mouseover", (e) => { const t = e.target.closest?.(".tip"); if (t) show(t); });
  document.addEventListener("mouseout", (e) => { if (e.target.closest?.(".tip")) hide(); });
  document.addEventListener("focusin", (e) => { if (e.target.classList?.contains("tip")) show(e.target); });
  document.addEventListener("focusout", (e) => { if (e.target.classList?.contains("tip")) hide(); });
  document.addEventListener("click", (e) => { const t = e.target.closest?.(".tip"); if (t) { e.preventDefault(); e.stopPropagation(); show(t); } else hide(); }, true);
  document.addEventListener("scroll", hide, true);
}
async function boot() {
  setupTips();
  tidyLegends();
  const j = async (u) => { const r = await fetch(u); if (!r.ok) throw new Error(u + " " + r.status); return r; };
  try {
    const [sites, eph] = await Promise.all([j("data/sites.json").then((r) => r.json()), j("data/ephemeris.json").then((r) => r.json())]);
    state.sites = sites; SEAL.setEphemeris(eph);
  } catch (e) { $("lead-error").hidden = false; $("lead-error").textContent = "Could not load SEAL data: " + e.message; return; }
  try { // optional terrain from lmaoxd's LOLA reader
    const meta = await (await j("data/terrain.json")).json();
    const f = meta.file || "terrain.bin";
    let buf;
    if (f.endsWith(".json")) { // same heights, base64 text (for hosts that only serve text files)
      const b64 = (await (await j("data/" + f)).json()).b64, bin = atob(b64), u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      buf = u8.buffer;
    } else buf = await (await j("data/" + f)).arrayBuffer();
    SEAL.setTerrain(meta, new Int16Array(buf));
  } catch { /* flat horizon until terrain is added */ }
  $("mode-badge").textContent = SEAL.terrain ? "Terrain: LRO LOLA" : "Terrain: flat (LOLA coming)";
  $("mode-badge").title = SEAL.terrain ? "Horizons traced from NASA LRO LOLA heights" : "Hills not included yet: horizon treated as flat";
  $("mode-badge").hidden = false;
  $("info").innerHTML = emptyInfoHTML(); renderSiteList(); setDefaultDates();
  $("locate").onclick = openExplorer;
  setupSplitter(); initMap(); state.applyInset();
  const r0 = SEAL.range(), now0 = Math.min(Math.max(Date.now(), Date.parse(r0.start)), Date.parse(r0.end));
  Globe.showcase(SEAL._vecAt(SEAL.eph.sun, now0)); drawRelief(now0);
  for (const src of ["moon_global.jpg", "south_pole_wac.jpg"]) { const im = new Image(); im.src = src; } // warm the cache
  $("home-link").onclick = (e) => {
    e.preventDefault(); document.body.classList.add("is-landing"); $("cal-modal").hidden = true; state.applyInset();
    const r = SEAL.range(), now = Math.min(Math.max(Date.now(), Date.parse(r.start)), Date.parse(r.end));
    Globe.showcase(SEAL._vecAt(SEAL.eph.sun, now));
  };
  $("run").onclick = () => state.current && run([state.current]);
  $("add-compare").onclick = () => { if (state.current && !state.compare.some((s) => s.id === state.current.id)) { state.compare.push(state.current); renderCompare(); } };
  $("run-compare").onclick = () => state.compare.length && run(state.compare);
  $("export").onclick = exportCsv;
  $("open-cal").onclick = () => state.current && openCalendar(state.current);
  $("cal-close").onclick = () => ($("cal-modal").hidden = true);
  $("cal-modal").onclick = (e) => { if (e.target.id === "cal-modal") $("cal-modal").hidden = true; };
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") $("cal-modal").hidden = true; });
  $("cal-prev").onclick = () => { cal.month = new Date(Date.UTC(cal.month.getUTCFullYear(), cal.month.getUTCMonth() - 1, 1)); renderCalendar(); };
  $("cal-next").onclick = () => { cal.month = new Date(Date.UTC(cal.month.getUTCFullYear(), cal.month.getUTCMonth() + 1, 1)); renderCalendar(); };
  for (const id of ["cal-battery", "cal-night"]) $(id).oninput = () => { $(id === "cal-battery" ? "battery-kwh" : "night-w").value = $(id).value; renderCalendar(); };
  for (const id of ["battery-kwh", "night-w"]) $(id).onchange = () => { $(id === "battery-kwh" ? "cal-battery" : "cal-night").value = $(id).value; };
  $("tl-range").oninput = () => { tl.idx = +$("tl-range").value; updateTimeline(); };
  $("tl-range").onchange = () => updateTimeline();
  $("tl-play").onclick = togglePlay;
  $("light-mode").onchange = () => (tl.results ? updateTimeline() : drawLightAt(tl.lastT || Date.now()));
  $("reset-view").onclick = () => Globe.flyTo(-89.5, 0, 1.62, 1200);
  $("copy-csv").onclick = copyCsv;
}
boot();
