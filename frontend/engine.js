// SEAL in-browser engine: Sun/Earth position for any south-pole point + terrain horizon + metrics.
// Mirrors science/ (Rust). Sun/Earth come from a NASA JPL Horizons table (data/ephemeris.json),
// verified against fresh Horizons queries to < 0.00001 deg. Runs in the browser or Node.
(function (root) {
  const R_KM = 1737.4, R_SUN = 696000, R_EARTH = 6371.0, D = Math.PI / 180;
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

  // ---------- ephemeris ----------
  let EPH = null;
  function decode(arr, scale) {
    const out = new Float64Array(arr.length); let p0 = 0, p1 = 0, p2 = 0;
    for (let i = 0; i < arr.length; i += 3) { p0 += arr[i]; p1 += arr[i + 1]; p2 += arr[i + 2]; out[i] = p0 / scale; out[i + 1] = p1 / scale; out[i + 2] = p2 / scale; }
    return out;
  }
  function setEphemeris(j) {
    EPH = { t0: Date.parse(j.t0), step: j.step_hours * 3600e3, n: j.n, sun: decode(j.sun, j.sun_scale), earth: decode(j.earth, j.earth_scale), source: j.source };
    EPH.tEnd = EPH.t0 + (EPH.n - 1) * EPH.step;
    return EPH;
  }
  // cubic Lagrange interpolation of a Moon-fixed vector (km)
  function vecAt(arr, t) {
    const x = (t - EPH.t0) / EPH.step; let i = Math.floor(x) - 1; i = Math.max(0, Math.min(EPH.n - 4, i));
    const u = x - i, L = [(u - 1) * (u - 2) * (u - 3) / -6, u * (u - 2) * (u - 3) / 2, u * (u - 1) * (u - 3) / -2, u * (u - 1) * (u - 2) / 6];
    const v = [0, 0, 0];
    for (let j = 0; j < 4; j++) for (let k = 0; k < 3; k++) v[k] += L[j] * arr[3 * (i + j) + k];
    return v;
  }
  const range = () => EPH && { start: new Date(EPH.t0).toISOString(), end: new Date(EPH.tEnd).toISOString() };

  // ---------- local frame ----------
  function frame(lat, lon, hKm) {
    const la = lat * D, lo = lon * D;
    const up = [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
    const r = R_KM + hKm;
    return { s: up.map((v) => v * r), up, e: [-Math.sin(lo), Math.cos(lo), 0], n: [-Math.sin(la) * Math.cos(lo), -Math.sin(la) * Math.sin(lo), Math.cos(la)] };
  }
  function azEl(f, target) {
    const r = sub(target, f.s), z = dot(r, f.up), e = dot(r, f.e), n = dot(r, f.n);
    let az = Math.atan2(e, n) / D; if (az < 0) az += 360;
    return { az, el: Math.atan2(z, Math.hypot(e, n)) / D, dist: Math.hypot(r[0], r[1], r[2]) };
  }

  // ---------- terrain ----------
  // meta: { pixel_m, width, height, x0_m, y0_m (centre of top-left pixel), x_axis_lon, y_axis_lon, nodata }
  // Grid x = rho*cos(lon - x_axis_lon), y = rho*cos(lon - y_axis_lon); rows go down (-y), columns right (+x).
  let TERRAIN = null;
  function setTerrain(meta, int16) { TERRAIN = { ...meta, data: int16 }; MASKS.clear(); RELIEF = null; return TERRAIN; }
  function stereo(lat, lon) { // metres, south polar stereographic on the 1737.4 km sphere
    const rho = 2 * R_KM * 1000 * Math.tan(Math.PI / 4 + (lat * D) / 2);
    return rho;
  }
  function heightM(lat, lon) {
    if (!TERRAIN) return 0;
    const T = TERRAIN, rho = stereo(lat, lon);
    const x = rho * Math.cos((lon - T.x_axis_lon) * D), y = rho * Math.cos((lon - T.y_axis_lon) * D);
    const c = (x - T.x0_m) / T.pixel_m, r = (T.y0_m - y) / T.pixel_m;
    const c0 = Math.floor(c), r0 = Math.floor(r);
    if (c0 < 0 || r0 < 0 || c0 + 1 >= T.width || r0 + 1 >= T.height) return null;
    const g = (rr, cc) => T.data[rr * T.width + cc];
    const a = g(r0, c0), b = g(r0, c0 + 1), cc = g(r0 + 1, c0), d = g(r0 + 1, c0 + 1);
    if ([a, b, cc, d].includes(T.nodata)) return null;
    const fx = c - c0, fy = r - r0;
    return (a * (1 - fx) + b * fx) * (1 - fy) + (cc * (1 - fx) + d * fx) * fy;
  }
  // point at surface distance sKm along azimuth az from (lat, lon)
  function destination(lat, lon, azDeg, sKm) {
    const d = sKm / R_KM, la = lat * D, lo = lon * D, az = azDeg * D;
    const la2 = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(az));
    const lo2 = lo + Math.atan2(Math.sin(az) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(la2));
    return [la2 / D, ((lo2 / D + 540) % 360) - 180];
  }
  const MASKS = new Map();
  // Horizon mask: highest terrain elevation angle for 720 azimuths (0.5 deg), out to 150 km.
  function horizonMask(lat, lon, obsHeightM) {
    const key = `${lat.toFixed(5)},${lon.toFixed(5)},${obsHeightM}`;
    if (MASKS.has(key)) return MASKS.get(key);
    const N = 720, mask = new Float64Array(N);
    if (!TERRAIN) { const m = { step: 0.5, el: mask, flat: true, ground_m: 0, coverage: 0 }; MASKS.set(key, m); return m; }
    // Where we have no terrain, assume the ground continues smooth at the observer's own level:
    // the horizon is then the dip of a sphere seen from obsHeightM up (about -0.09 deg for 2 m).
    const g0 = heightM(lat, lon), g = g0 ?? 0, Rg = R_KM * 1000 + g;
    const dip = -Math.acos(Rg / (Rg + Math.max(0, obsHeightM))) / D;
    if (g0 == null) { // site outside the LOLA grid: smooth Moon
      const m = { step: 0.5, el: mask.fill(dip), flat: true, ground_m: 0, coverage: 0 }; MASKS.set(key, m); return m;
    }
    // Azimuths and the local frame are undefined exactly at the pole, so points within ~300 m of it
    // are analysed at 89.99 S (same as the Rust reference).
    const la0 = Math.max(lat, -89.99);
    const f = frame(la0, lon, (g + obsHeightM) / 1000), steps = [];
    let complete = 0;
    for (let s = 0.12; s <= 10; s += 0.12) steps.push(s);
    for (let s = 10.25; s <= 150; s += 0.25) steps.push(s);
    for (let i = 0; i < N; i++) {
      let best = dip, whole = true;
      for (const s of steps) {
        const [la2, lo2] = destination(la0, lon, i * 0.5, s);
        if (la2 > -79.9) { whole = false; break; }
        const h = heightM(la2, lo2); if (h == null) { whole = false; continue; }
        const p = frame(la2, lo2, h / 1000).s, r = sub(p, f.s);
        const el = Math.atan2(dot(r, f.up), Math.hypot(dot(r, f.e), dot(r, f.n))) / D;
        if (el > best) best = el;
      }
      mask[i] = best; if (whole) complete++;
    }
    // coverage: share of skyline directions traced on LOLA terrain all the way out to 150 km
    const m = { step: 0.5, el: mask, flat: false, ground_m: g, coverage: complete / N };
    MASKS.set(key, m); return m;
  }
  function maskAt(m, az) {
    const x = (((az % 360) + 360) % 360) / m.step, i = Math.floor(x) % m.el.length, j = (i + 1) % m.el.length, f = x - Math.floor(x);
    return m.el[i] * (1 - f) + m.el[j] * f;
  }

  // ---------- visibility + metrics ----------
  function visibleFraction(el, horizon, rDeg) {
    const x = Math.max(-1, Math.min(1, (el - horizon) / rDeg));
    return 1 - (Math.acos(x) - x * Math.sqrt(1 - x * x)) / Math.PI;
  }
  function metrics(series) {
    // Sample i stands for the time until sample i+1 (the last step may be shorter than the others).
    const n = series.length, T = series.map((s) => Date.parse(s.t));
    const dur = n > 1 ? T.slice(0, n - 1).map((t, i) => (T[i + 1] - t) / 3.6e6) : [0];
    const iv = n > 1 ? series.slice(0, n - 1) : series, totalH = dur.reduce((a, b) => a + b, 0) || 1;
    const lit = (s) => s.sun_frac > 0, contact = (s) => s.earth_frac >= 0.5;
    const hours = (p) => iv.reduce((a, s, i) => a + (p(s) ? dur[i] : 0), 0);
    const longest = (p) => { let b = 0, c = 0; iv.forEach((s, i) => { if (p(s)) { c += dur[i]; b = Math.max(b, c); } else c = 0; }); return b; };
    const fall = (p) => { for (let i = 1; i < n; i++) if (p(series[i - 1]) && !p(series[i])) return series[i].t; return null; };
    const sunset = fall(lit), earthset = fall(contact);
    let usable = 0, past = false;
    if (lit(series[0]) && contact(series[0])) {
      const ends = [sunset, earthset].filter(Boolean).map(Date.parse), t0 = Date.parse(series[0].t);
      if (ends.length) usable = (Math.min(...ends) - t0) / 864e5; else { usable = (Date.parse(series[n - 1].t) - t0) / 864e5; past = true; }
    }
    const hl = hours(lit), he = hours(contact);
    return { sunlit_pct: 100 * hl / totalH, sunlit_hours: hl, longest_dark_hours: longest((s) => !lit(s)),
      earth_visible_pct: 100 * he / totalH, earth_visible_hours: he, longest_blackout_hours: longest((s) => !contact(s)),
      next_sunset: sunset, next_earthset: earthset, usable_mission_days: usable, mission_runs_past_range: past };
  }

  function compute(site, { start, end, step_minutes = 60, observer_height_m = 2 }) {
    if (!EPH) throw new Error("ephemeris not loaded");
    let t0 = Date.parse(start), t1 = Date.parse(end);
    if (!(t1 > t0)) throw new Error("end must be after start");
    if (t0 < EPH.t0 || t1 > EPH.tEnd) throw new Error(`dates must be between ${range().start.slice(0, 10)} and ${range().end.slice(0, 10)}`);
    const step = Math.max(10, step_minutes) * 60e3;
    if ((t1 - t0) / step > 20000) throw new Error("too many time steps, use a larger step or shorter range");
    const mask = horizonMask(site.lat, site.lon, observer_height_m);
    const f = frame(Math.max(site.lat, -89.99), site.lon, (mask.ground_m + observer_height_m) / 1000);
    const series = [], times = [];
    for (let t = t0; t < t1; t += step) times.push(t);
    times.push(t1); // always end exactly at the requested end, so a final short step is counted
    for (const t of times) {
      const s = azEl(f, vecAt(EPH.sun, t)), e = azEl(f, vecAt(EPH.earth, t));
      const hs = maskAt(mask, s.az), he = maskAt(mask, e.az);
      series.push({ t: new Date(t).toISOString().replace(".000", ""),
        sun_az: +s.az.toFixed(4), sun_el: +s.el.toFixed(4), horizon_at_sun: +hs.toFixed(4), sun_frac: visibleFraction(s.el, hs, Math.asin(R_SUN / s.dist) / D),
        earth_az: +e.az.toFixed(4), earth_el: +e.el.toFixed(4), horizon_at_earth: +he.toFixed(4), earth_frac: visibleFraction(e.el, he, Math.asin(R_EARTH / e.dist) / D) });
    }
    return { site, terrain_model: mask.flat ? "smooth Moon (no LOLA terrain here)" : mask.coverage >= 0.99 ? "LRO LOLA" : "LRO LOLA, partial", terrain_coverage: mask.coverage, horizon: { az_step_deg: mask.step, elevation_deg: Array.from(mask.el, (v) => +v.toFixed(3)), ground_m: mask.ground_m },
      summary: metrics(series), series };
  }

  // ---------- landing-date finder ----------
  // For every candidate landing time (hourly) in [from, from+days): how many days of continuous Sun + Earth follow?
  function landingScan(site, { from, days = 90, observer_height_m = 2, lookahead_days = 40 }) {
    const t0 = Math.max(Date.parse(from), EPH.t0), H = 3600e3;
    const t1 = Math.min(t0 + (days + lookahead_days) * 864e5, EPH.tEnd);
    const mask = horizonMask(site.lat, site.lon, observer_height_m);
    const f = frame(site.lat, site.lon, (mask.ground_m + observer_height_m) / 1000);
    const ok = [], times = [];
    for (let t = t0; t <= t1; t += H) {
      const s = azEl(f, vecAt(EPH.sun, t)), e = azEl(f, vecAt(EPH.earth, t));
      const sf = visibleFraction(s.el, maskAt(mask, s.az), Math.asin(R_SUN / s.dist) / D);
      const ef = visibleFraction(e.el, maskAt(mask, e.az), Math.asin(R_EARTH / e.dist) / D);
      ok.push(sf > 0 && ef >= 0.5); times.push(t);
    }
    const run = new Array(ok.length).fill(0); // hours of continuous ok starting here
    for (let i = ok.length - 1; i >= 0; i--) run[i] = ok[i] ? 1 + (i + 1 < ok.length ? run[i + 1] : 0) : 0;
    const nDays = Math.floor(Math.min(days * 24, ok.length) / 24), out = [];
    for (let d = 0; d < nDays; d++) {
      let best = 0, bestI = d * 24;
      for (let h = 0; h < 24; h++) { const i = d * 24 + h; if (run[i] > best) { best = run[i]; bestI = i; } }
      const capped = bestI + best >= ok.length; // window runs past the scanned range
      out.push({ day: new Date(times[d * 24]).toISOString().slice(0, 10), best_time: new Date(times[bestI]).toISOString().replace(".000", ""), usable_days: best / 24, capped });
    }
    return out;
  }

  // ---------- mission power model: operating time + battery night survival ----------
  // Hourly Sun/Earth flags over the whole ephemeris for one site (cached).
  const TRACKS = new Map();
  function missionTrack(site, observer_height_m = 2) {
    const key = `${site.lat.toFixed(5)},${site.lon.toFixed(5)},${observer_height_m},${TERRAIN ? 1 : 0}`;
    if (TRACKS.has(key)) return TRACKS.get(key);
    const mask = horizonMask(site.lat, site.lon, observer_height_m);
    const f = frame(site.lat, site.lon, (mask.ground_m + observer_height_m) / 1000), H = 3600e3;
    const n = Math.floor((EPH.tEnd - EPH.t0) / H) + 1, lit = new Uint8Array(n), earth = new Uint8Array(n), sunEl = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = EPH.t0 + i * H, s = azEl(f, vecAt(EPH.sun, t)), e = azEl(f, vecAt(EPH.earth, t));
      lit[i] = visibleFraction(s.el, maskAt(mask, s.az), Math.asin(R_SUN / s.dist) / D) > 0 ? 1 : 0;
      earth[i] = visibleFraction(e.el, maskAt(mask, e.az), Math.asin(R_EARTH / e.dist) / D) >= 0.5 ? 1 : 0;
      sunEl[i] = s.el;
    }
    const runs = []; // dark spells [start, length] in hours
    for (let i = 0; i < n; i++) if (!lit[i] && (i === 0 || lit[i - 1])) { let j = i; while (j < n && !lit[j]) j++; runs.push([i, j - i]); }
    const nextRun = new Int32Array(n + 1); // index of first dark run starting at or after i
    for (let i = n, k = runs.length; i >= 0; i--) { while (k > 0 && runs[k - 1][0] >= i) k--; nextRun[i] = k; }
    const earthPre = new Int32Array(n + 1); for (let i = 0; i < n; i++) earthPre[i + 1] = earthPre[i] + earth[i];
    const tr = { t0: EPH.t0, n, lit, earth, sunEl, runs, nextRun, earthPre };
    TRACKS.set(key, tr); return tr;
  }
  // Operate from landing hour i: Sun charges the battery to full; in the dark the lander draws nightW.
  // Ends in the first dark spell the battery can't cover. capH = hours the battery lasts (Infinity = unlimited).
  function operateFrom(tr, i, capH, lookaheadH) {
    const limit = Math.min(tr.n, i + lookaheadH);
    let k = tr.nextRun[i + 1], firstNight = k < tr.runs.length ? tr.runs[k] : null, end = null, nightsSurvived = 0, killer = null;
    for (; k < tr.runs.length && tr.runs[k][0] < limit; k++) {
      const [st, len] = tr.runs[k];
      if (len > capH) { end = st + Math.max(0, Math.floor(capH)); killer = { startH: st - i, len }; break; }
      nightsSurvived++;
    }
    const capped = end == null; if (capped) end = limit;
    let earthset = null; for (let j = i; j < end; j++) if (!tr.earth[j]) { earthset = j; break; }
    return { hours: end - i, capped, firstNightStart: firstNight ? firstNight[0] : null, firstNightH: firstNight ? firstNight[1] : null,
      nightsSurvived, killer, earthPct: end > i ? (100 * (tr.earthPre[end] - tr.earthPre[i])) / (end - i) : 0, earthsetH: earthset == null ? null : earthset - i };
  }
  // Per-day best landing (needs Sun up + Earth in view at touchdown) for a calendar.
  function missionCalendar(site, { from, to, observer_height_m = 2, battery_wh = 0, night_w = 100, dod = 0.8, lookahead_days = 120 }) {
    const tr = missionTrack(site, observer_height_m), H = 3600e3;
    const capH = night_w > 0 ? (battery_wh * dod) / night_w : Infinity, look = lookahead_days * 24;
    const d0 = Math.max(0, Math.floor((Date.parse(from) - tr.t0) / 864e5)), d1 = Math.min(Math.floor((tr.n - 1) / 24), Math.floor((Date.parse(to) - tr.t0) / 864e5));
    const out = [];
    for (let d = d0; d <= d1; d++) {
      let best = null;
      for (let h = 0; h < 24; h++) {
        const i = d * 24 + h; if (i >= tr.n || !tr.lit[i] || !tr.earth[i]) continue;
        const r = operateFrom(tr, i, capH, look);
        if (!best || r.hours > best.r.hours) best = { i, r };
      }
      const day = new Date(tr.t0 + d * 864e5).toISOString().slice(0, 10);
      if (!best) { out.push({ day, ok: false }); continue; }
      const solar = operateFrom(tr, best.i, 0, look);
      const withNeed = solar.firstNightH ? operateFrom(tr, best.i, solar.firstNightH, look) : solar;
      out.push({ night_start: solar.firstNightStart, need_wh: solar.firstNightH ? (night_w * solar.firstNightH) / dod : 0,
        with_need_days: withNeed.hours / 24, with_need_capped: withNeed.capped, day, ok: true, land: new Date(tr.t0 + best.i * H).toISOString().replace(".000", ""), op_days: best.r.hours / 24, capped: best.r.capped,
        solar_days: solar.hours / 24, solar_capped: solar.capped, first_night_h: solar.firstNightH, nights_survived: best.r.nightsSurvived,
        earth_pct: best.r.earthPct, earthset_days: best.r.earthsetH == null ? null : best.r.earthsetH / 24 });
    }
    return out;
  }
  // Trade-offs: best landing in each lunar day (grouped by the night that follows), with battery needed for that night.
  function tradeoffs(site, opts) {
    const days = missionCalendar(site, { ...opts, battery_wh: 0 }), groups = new Map();
    for (const d of days) {
      if (!d.ok || d.solar_days < 2) continue; // skip landings at the very end of a lunar day
      const k = d.night_start ?? "none", g = groups.get(k);
      if (!g || d.solar_days > g.solar_days) groups.set(k, d);
    }
    const list = [...groups.values()].sort((a, b) => a.land.localeCompare(b.land));
    for (const a of list) a.pareto = !list.some((b) => b !== a && b.solar_days >= a.solar_days && b.need_wh <= a.need_wh && (b.solar_days > a.solar_days || b.need_wh < a.need_wh));
    return list;
  }

  // Battery story for one landing time: solar-only life, battery needed for the first night, life with that battery.
  function batteryPlan(site, landISO, { observer_height_m = 2, night_w = 100, battery_wh = 0, dod = 0.8, lookahead_days = 120 } = {}) {
    const tr = missionTrack(site, observer_height_m), i = Math.round((Date.parse(landISO) - tr.t0) / 3600e3), look = lookahead_days * 24;
    if (i < 0 || i >= tr.n) return null;
    const solar = operateFrom(tr, i, 0, look);
    const yours = operateFrom(tr, i, night_w > 0 ? (battery_wh * dod) / night_w : Infinity, look);
    const needWh = solar.firstNightH ? (night_w * solar.firstNightH) / dod : 0;
    const withNeed = solar.firstNightH ? operateFrom(tr, i, solar.firstNightH, look) : solar;
    // battery that survives EVERY night for a full year after landing
    const yearEnd = Math.min(tr.n, i + 365 * 24); let longest = 0, longestStart = null;
    for (let k = tr.nextRun[i + 1]; k < tr.runs.length && tr.runs[k][0] < yearEnd; k++) if (tr.runs[k][1] > longest) { longest = tr.runs[k][1]; longestStart = tr.runs[k][0]; }
    const yearFull = yearEnd - i >= 365 * 24;
    return { year_longest_night_h: longest, year_longest_night_day: longestStart == null ? null : (longestStart - i) / 24, need_year_wh: (night_w * longest) / dod, year_full: yearFull,
      with_need_killer: withNeed.killer, yours_killer: yours.killer, landed_in_sun: !!tr.lit[i], solar_days: solar.hours / 24, solar_capped: solar.capped, first_night_h: solar.firstNightH,
      need_wh: needWh, with_need_days: withNeed.hours / 24, with_need_capped: withNeed.capped, with_need_nights: withNeed.nightsSurvived,
      yours_days: yours.hours / 24, yours_capped: yours.capped, yours_nights: yours.nightsSurvived, earth_pct: yours.earthPct };
  }

  // ---------- shadow / visibility field for the map ----------
  function bodyHat(body, t) { const v = vecAt(body === "earth" ? EPH.earth : EPH.sun, t), n = Math.hypot(v[0], v[1], v[2]); return { hat: [v[0] / n, v[1] / n, v[2] / n], v }; }
  function heightXY(x, y) { // metres, x/y in Moon Trek orientation (+x = 90E, +y = 0E)
    if (!TERRAIN) return 0;
    const rho = Math.hypot(x, y), lon = Math.atan2(x, y);
    const T = TERRAIN, gx = rho * Math.cos(lon - T.x_axis_lon * D), gy = rho * Math.cos(lon - T.y_axis_lon * D);
    const c = (gx - T.x0_m) / T.pixel_m, r = (T.y0_m - gy) / T.pixel_m, c0 = Math.floor(c), r0 = Math.floor(r);
    if (c0 < 0 || r0 < 0 || c0 + 1 >= T.width || r0 + 1 >= T.height) return null;
    const w = T.width, a = T.data[r0 * w + c0], b = T.data[r0 * w + c0 + 1], cc = T.data[(r0 + 1) * w + c0], d = T.data[(r0 + 1) * w + c0 + 1];
    if (a === T.nodata || b === T.nodata || cc === T.nodata || d === T.nodata) return null;
    const fx = c - c0, fy = r - r0;
    return (a * (1 - fx) + b * fx) * (1 - fy) + (cc * (1 - fx) + d * fx) * fy;
  }
  // Returns Float32Array N*N of visible fraction (0..1) of the Sun (or Earth) for each map pixel; row 0 = +y.
  // extra: return only the shadow that terrain adds on top of the smooth-Moon day/night (for drawing over a shaded globe)

  // Sun-lit relief of the terrain on a polar grid (row 0 = +y). Slopes facing the Sun brighten, slopes facing away darken.
  // Returns RGBA bytes; alpha 0 where there is no terrain. Slopes are computed once per grid and cached.
  let RELIEF = null;
  function reliefGrid(N, half_m) {
    if (RELIEF && RELIEF.N === N && RELIEF.half === half_m && RELIEF.T === TERRAIN) return RELIEF;
    RELIEF = {
      N, half: half_m, T: TERRAIN, preparedRows: 0,
      ge: new Float32Array(N * N), gn: new Float32Array(N * N),
      ok: new Uint8Array(N * N), trig: new Float32Array(N * N * 4),
      out: new Uint8ClampedArray(N * N * 4), job: Promise.resolve()
    };
    return RELIEF;
  }
  function prepareReliefRows(grid, start, end) {
    const { N, half, T, ge, gn, ok, trig } = grid, Rm = R_KM * 1000, px = (2 * half) / N;
    const xmin = T.x0_m, xmax = T.x0_m + (T.width - 1) * T.pixel_m, ymax = T.y0_m, ymin = T.y0_m - (T.height - 1) * T.pixel_m;
    for (let r = start; r < end; r++) for (let c = 0; c < N; c++) {
      const i = r * N + c, x = -half + (c + 0.5) * px, y = half - (r + 0.5) * px;
      const hx1 = heightXY(x + px, y), hx0 = heightXY(x - px, y), hy1 = heightXY(x, y + px), hy0 = heightXY(x, y - px);
      if (hx1 == null || hx0 == null || hy1 == null || hy0 == null) continue;
      const gx = (hx1 - hx0) / (2 * px), gy = (hy1 - hy0) / (2 * px), lon = Math.atan2(x, y), rho = Math.hypot(x, y);
      const lat = 2 * Math.atan(rho / (2 * Rm)) - Math.PI / 2, cl = Math.cos(lon), sl = Math.sin(lon);
      ge[i] = gx * cl - gy * sl; gn[i] = gx * sl + gy * cl;
      ok[i] = Math.max(1, Math.min(255, Math.round(255 * Math.min(x - xmin, xmax - x, y - ymin, ymax - y) / 30000)));
      trig.set([Math.sin(lat), Math.cos(lat), sl, cl], i * 4);
    }
    grid.preparedRows = end;
  }
  function shadeReliefRows(grid, hat, start, end) {
    const { N, ge, gn, ok, trig, out } = grid;
    for (let r = start; r < end; r++) for (let c = 0; c < N; c++) {
      const i = r * N + c, j = i * 4;
      if (!ok[i]) { out[j + 3] = 0; continue; }
      const sla = trig[j], cla = trig[j + 1], sl = trig[j + 2], cl = trig[j + 3];
      const se = -sl * hat[0] + cl * hat[1], sn = -sla * cl * hat[0] - sla * sl * hat[1] + cla * hat[2], su = cla * cl * hat[0] + cla * sl * hat[1] + sla * hat[2];
      const sh = Math.hypot(se, sn) || 1e-6, nn = Math.sqrt(1 + ge[i] * ge[i] + gn[i] * gn[i]);
      const lam = (-ge[i] * se - gn[i] * sn + su) / nn;
      const k = (-ge[i] * se - gn[i] * sn) / sh;
      const v = lam <= 0 ? 0.07 : Math.min(1, Math.max(0.1, 0.56 + 1.7 * k));
      out[j] = out[j + 1] = out[j + 2] = v * 236; out[j + 3] = ok[i];
    }
  }
  function reliefYield() {
    return new Promise((resolve) => {
      if (typeof root.requestIdleCallback === "function") root.requestIdleCallback(resolve, { timeout: 50 });
      else if (typeof root.requestAnimationFrame === "function") root.requestAnimationFrame(resolve);
      else setTimeout(resolve, 0);
    });
  }
  function reliefImage(t, { N = 1024, half_m = 320003 } = {}) {
    if (!TERRAIN) return null;
    const grid = reliefGrid(N, half_m);
    if (grid.preparedRows < N) prepareReliefRows(grid, grid.preparedRows, N);
    shadeReliefRows(grid, bodyHat("sun", t).hat, 0, N);
    return grid.out;
  }
  function reliefImageAsync(t, { N = 1024, half_m = 320003 } = {}) {
    if (!TERRAIN) return Promise.resolve(null);
    const grid = reliefGrid(N, half_m);
    const render = async () => {
      // One-time slope preparation runs in ~12 ms slices so the page stays responsive;
      // shading for a new Sun position is fast (tens of ms), so it runs in one go.
      while (grid.preparedRows < N) {
        const t0 = Date.now();
        while (grid.preparedRows < N && Date.now() - t0 < 12) prepareReliefRows(grid, grid.preparedRows, Math.min(N, grid.preparedRows + 8));
        if (grid.preparedRows < N) await new Promise((resolve) => setTimeout(resolve, 0));
      }
      shadeReliefRows(grid, bodyHat("sun", t).hat, 0, N);
      return grid.out;
    };
    const job = grid.job.then(render, render);
    grid.job = job.then(() => undefined, () => undefined);
    return job;
  }
  function lightField(t, { body = "sun", N = 300, half_m = 304000, max_km = 120, extra = false } = {}) {
    const { hat, v } = bodyHat(body, t), dist = Math.hypot(v[0], v[1], v[2]);
    const rDeg = Math.asin((body === "earth" ? R_EARTH : R_SUN) / dist) / D, need = body === "earth" ? 0.5 : 0;
    const out = new Float32Array(N * N), px = (2 * half_m) / N, Rm = R_KM * 1000;
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      const x = -half_m + (c + 0.5) * px, y = half_m - (r + 0.5) * px, rho = Math.hypot(x, y);
      const lat = 2 * Math.atan(rho / (2 * Rm)) - Math.PI / 2, lon = Math.atan2(x, y);
      const up = [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
      const el = Math.asin(Math.max(-1, Math.min(1, dot(up, hat)))) / D; // body is far: direction ~ same everywhere
      let hz = 0;
      if (TERRAIN && el > -rDeg && el < 25) {
        const h0 = heightXY(x, y);
        if (h0 != null) {
          const e = [-Math.sin(lon), Math.cos(lon), 0], n = [-Math.sin(lat) * Math.cos(lon), -Math.sin(lat) * Math.sin(lon), Math.cos(lat)];
          const se = dot(hat, e), sn = dot(hat, n), m = Math.hypot(se, sn) || 1;
          // horizontal direction toward the body, converted to map x/y (east = (cos lon, -sin lon), north = (sin lon, cos lon))
          const dx = (se * Math.cos(lon) + sn * Math.sin(lon)) / m, dy = (-se * Math.sin(lon) + sn * Math.cos(lon)) / m;
          const tanEl = Math.tan(el * D) ; let best = -1e9;
          for (let s = px * 0.5; s <= max_km * 1000; s += s < 10000 ? px * 0.5 : px) {
            const h = heightXY(x + dx * s, y + dy * s); if (h == null) break;
            const a = (h - h0 - (s * s) / (2 * Rm)) / s; if (a > best) best = a;
            if (best > tanEl + 0.02) break;
          }
          hz = Math.atan(best) / D;
        }
      }
      if (extra) {
        let fade = 1;
        if (TERRAIN) { const T = TERRAIN, e = Math.min(x - T.x0_m, T.x0_m + (T.width - 1) * T.pixel_m - x, y - (T.y0_m - (T.height - 1) * T.pixel_m), T.y0_m - y); fade = Math.max(0, Math.min(1, e / 30000)); }
        out[r * N + c] = fade * Math.max(0, visibleFraction(el, 0, rDeg) - visibleFraction(el, hz, rDeg)); continue;
      }
      out[r * N + c] = need ? (visibleFraction(el, hz, rDeg) >= need ? 1 : 0) : visibleFraction(el, hz, rDeg);
    }
    return out;
  }
  function sunEarthAt(site, t, observer_height_m = 2) {
    const mask = horizonMask(site.lat, site.lon, observer_height_m), f = frame(site.lat, site.lon, (mask.ground_m + observer_height_m) / 1000);
    const s = azEl(f, vecAt(EPH.sun, t)), e = azEl(f, vecAt(EPH.earth, t));
    return { sun: { ...s, horizon: maskAt(mask, s.az) }, earth: { ...e, horizon: maskAt(mask, e.az) } };
  }

  root.SEAL = { reliefImage, reliefImageAsync, tradeoffs, missionCalendar, batteryPlan, missionTrack, landingScan, lightField, sunEarthAt, heightXY, setEphemeris, setTerrain, compute, horizonMask, heightM, range, metrics, visibleFraction, _vecAt: vecAt, _azEl: azEl, _frame: frame, get eph() { return EPH; }, get terrain() { return TERRAIN; } };
})(typeof window !== "undefined" ? window : globalThis);
