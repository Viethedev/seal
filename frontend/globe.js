// SEAL 3D Moon globe (three.js r128). Global LRO WAC colour map + detailed LOLA south-pole cap,
// site markers, click-to-pin, real Sun lighting, and a shadow/visibility overlay draped on the polar cap.
(function (root) {
  const D = Math.PI / 180, R_M = 1737400;
  // Moon (lat, lon) -> three.js position. Matches SphereGeometry's equirect UVs (lon 0 = +X, north = +Y).
  function pos(lat, lon, r = 1) {
    const phi = (lon + 180) * D, la = lat * D;
    return new THREE.Vector3(-Math.cos(phi) * Math.cos(la) * r, Math.sin(la) * r, Math.sin(phi) * Math.cos(la) * r);
  }
  function latLonOf(v) {
    const n = v.clone().normalize(), lat = Math.asin(n.y) / D;
    let lon = Math.atan2(-n.z, n.x) / D; // inverse of pos()
    return [lat, lon];
  }
  // Moon-fixed (x, y, z) vector -> three.js direction
  const fromMoonFixed = (v) => new THREE.Vector3(v[0], v[2], -v[1]).normalize();
  const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

  const G = {
    cam: { lat: 15, lon: -20, dist: 4.2 }, anim: null, sites: [], markers: [], labels: [], selected: null, pin: null, pinLabel: null,
    handlers: { site: () => {}, pick: () => {}, hover: () => {} },
  };

  const DOTS = {};
  function dotTexture(color) {
    if (DOTS[color]) return DOTS[color];
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><circle cx="32" cy="32" r="29" fill="#fff"/><circle cx="32" cy="32" r="20" fill="${color}"/></svg>`;
    return (DOTS[color] = new THREE.TextureLoader().load(`data:image/svg+xml,${encodeURIComponent(svg)}`));
  }
  function makeDot(color, size) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTexture(color), depthTest: true, depthWrite: false, transparent: true }));
    s.scale.set(size, size, 1); return s;
  }
  function siteColor(site) { return site.group === "history" ? "#d97732" : "#4da8ff"; }

  function featherMask(inner = 0.72) {
    const c = document.createElement("canvas"); c.width = c.height = 256;
    const x = c.getContext("2d"), gr = x.createRadialGradient(128, 128, 128 * inner, 128, 128, 126);
    gr.addColorStop(0, "#fff"); gr.addColorStop(1, "#000"); x.fillStyle = "#000"; x.fillRect(0, 0, 256, 256);
    x.fillStyle = gr; x.beginPath(); x.arc(128, 128, 127, 0, 2 * Math.PI); x.fill();
    return new THREE.CanvasTexture(c);
  }
  // Day/night shading: a point is lit when the Sun is above its (smooth-Moon) horizon. Same rule as SEAL's maths,
  // so the terminator is continuous over the whole globe (ordinary lighting is nearly flat at the grazing polar Sun).
  function dayNightMaterial(alphaMap, exposure = 1.0, gamma = 1.0) {
    return new THREE.ShaderMaterial({
      uniforms: { map: { value: null }, relief: { value: null }, useRelief: { value: false }, alphaMap: { value: alphaMap || null }, useAlpha: { value: !!alphaMap }, sunDir: { value: new THREE.Vector3(1, 0, 0) }, ambient: { value: 0.45 },
        exposure: { value: exposure }, gamma: { value: gamma } },
      vertexShader: "varying vec2 vUv; varying vec3 vN; void main(){ vUv = uv; vN = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
      fragmentShader: `uniform sampler2D map; uniform sampler2D relief; uniform bool useRelief; uniform sampler2D alphaMap; uniform bool useAlpha; uniform vec3 sunDir; uniform float ambient; uniform float exposure; uniform float gamma;
        varying vec2 vUv; varying vec3 vN;
        void main(){
          vec4 c = texture2D(map, vUv);
          c.rgb = min(vec3(1.0), pow(c.rgb, vec3(gamma)) * exposure);   // lift dark polar shadows
          if (useRelief) { vec4 rl = texture2D(relief, vUv); c.rgb = mix(c.rgb, rl.rgb, rl.a); } // live LOLA relief replaces the photo's frozen shadows
          float d = dot(normalize(vN), sunDir);                 // sine of the Sun's elevation (smooth Moon)
          float day = smoothstep(-0.0047, 0.0047, d);           // Sun disc ~0.27 deg: soft terminator
          float shade = ambient + (1.0 - ambient) * day * (0.92 + 0.08 * clamp(d * 4.0, 0.0, 1.0));
          float a = useAlpha ? texture2D(alphaMap, vUv).g : 1.0;
          gl_FragColor = vec4(c.rgb * shade, a);
        }`,
      transparent: !!alphaMap, depthWrite: !alphaMap, side: THREE.DoubleSide,
    });
  }
  // Disc-shaped cap mesh in south polar stereographic space; UV follows the polar image (row 0 = +y = lon 0).
  function capGeometry(half_m, r, rings = 48, segs = 160) {
    const P = [], UV = [], I = [], rmax = half_m * 0.985;
    for (let i = 0; i <= rings; i++) {
      const rho = (rmax * i) / rings;
      for (let j = 0; j <= segs; j++) {
        const a = (j / segs) * 2 * Math.PI, x = rho * Math.sin(a), y = rho * Math.cos(a);
        const lat = (2 * Math.atan(rho / (2 * R_M)) - Math.PI / 2) / D, lon = Math.atan2(x, y) / D;
        const p = pos(lat, lon, r); P.push(p.x, p.y, p.z);
        UV.push((x + half_m) / (2 * half_m), (y + half_m) / (2 * half_m));
      }
    }
    for (let i = 0; i < rings; i++) for (let j = 0; j < segs; j++) {
      const a = i * (segs + 1) + j, b = a + segs + 1;
      I.push(a, b, a + 1, b, b + 1, a + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(UV, 2));
    g.setIndex(I); g.computeVertexNormals(); return g;
  }

  function renderPixelRatio() {
    return (window.devicePixelRatio || 1) >= 1.5 ? 1.5 : 1;
  }

  function init(el, { globalTex, poleTex, poleHalf, overlayHalf }) {
    G.el = el; G.poleHalf = poleHalf; G.overlayHalf = overlayHalf || poleHalf;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(renderPixelRatio());
    renderer.setClearColor(0x03050a);
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(35, 1, 0.001, 100);
    G.renderer = renderer; G.scene = scene; G.camera = camera;

    // stars
    const sg = new THREE.BufferGeometry(), sp = [];
    for (let i = 0; i < 2500; i++) { const v = new THREE.Vector3().randomDirection ? new THREE.Vector3().randomDirection() : new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize(); sp.push(v.x * 40, v.y * 40, v.z * 40); }
    sg.setAttribute("position", new THREE.Float32BufferAttribute(sp, 3));
    scene.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0x9aa4b8, size: 0.06, sizeAttenuation: true })));

    const loader = new THREE.TextureLoader();
    let pending = 2; G.ready = new Promise((res) => (G._ready = res));
    const loaded = () => { if (--pending === 0) { G.globe.visible = G.cap.visible = true; G._ready(); } };
    G.ambient = new THREE.AmbientLight(0xffffff, 0.5); scene.add(G.ambient);
    G.sun = new THREE.DirectionalLight(0xfff4e0, 1.05); G.sun.position.set(2, 0.3, 1); scene.add(G.sun);
    const globeMat = dayNightMaterial(null, 1.12, 0.9); G.shaded = [globeMat];
    G.globe = new THREE.Mesh(new THREE.SphereGeometry(1, 192, 96), globeMat); G.globe.visible = false; scene.add(G.globe);
    loader.load(globalTex, (t) => { t.anisotropy = 4; globeMat.uniforms.map.value = t; loaded(); }, undefined, loaded);

    // same kind of image (LRO WAC camera mosaic) and same lighting as the globe, feathered into it
    const capMat = dayNightMaterial(featherMask(0.62), 1.18, 0.8); G.shaded.push(capMat); G.capMat = capMat;
    G.cap = new THREE.Mesh(capGeometry(poleHalf, 1.0006), capMat); G.cap.visible = false; scene.add(G.cap);
    loader.load(poleTex, (t) => { t.anisotropy = 8; capMat.uniforms.map.value = t; loaded(); }, undefined, loaded);

    // lighting overlay covers a wider area than the cap, also feathered, so shadows blend into the globe
    G.overlayMat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, opacity: 1, side: THREE.DoubleSide, alphaMap: featherMask(0.8) });
    G.overlay = new THREE.Mesh(capGeometry(G.overlayHalf, 1.0011), G.overlayMat); G.overlay.visible = false; scene.add(G.overlay);

    // graticule around the pole
    const lineMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18 });
    for (const lat of [-80, -82, -84, -86, -88]) {
      const pts = []; for (let lo = -180; lo <= 180; lo += 2) pts.push(pos(lat, lo, 1.0015));
      scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lineMat));
    }
    for (let lo = 0; lo < 360; lo += 30) {
      const pts = []; for (let la = -90; la <= -79; la += 0.5) pts.push(pos(la, lo, 1.0015));
      scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lineMat));
    }
    G.labelLayer = document.createElement("div"); G.labelLayer.className = "globe-labels"; el.appendChild(G.labelLayer);
    for (const [lat, txt] of [[-80, "80°S"], [-85, "85°S"]]) addLabel(pos(lat, 0, 1.002), txt, "grid");
    for (const [lo, txt] of [[0, "0°"], [90, "90°E"], [180, "180°"], [-90, "90°W"]]) addLabel(pos(-79.2, lo, 1.002), txt, "grid");

    // interaction
    const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
    let down = null, moved = 0;
    const toNdc = (e) => { const r = el.getBoundingClientRect(); ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); };
    el.addEventListener("pointerdown", (e) => { G.dragging = true; down = { x: e.clientX, y: e.clientY, lat: G.cam.lat, lon: G.cam.lon }; moved = 0; G.anim = null; el.setPointerCapture(e.pointerId); });
    el.addEventListener("pointermove", (e) => {
      if (down) {
        const dx = e.clientX - down.x, dy = e.clientY - down.y; moved = Math.max(moved, Math.hypot(dx, dy));
        const k = (G.cam.dist - 1) * 0.25 + 0.02;
        G.cam.lon = down.lon - dx * k; G.cam.lat = Math.max(-89.9, Math.min(89.9, down.lat + dy * k));
      }
      toNdc(e); ray.setFromCamera(ndc, camera);
      const hit = ray.intersectObject(G.globe)[0];
      G.handlers.hover(hit ? latLonOf(hit.point) : null);
    });
    el.addEventListener("pointerup", (e) => {
      if (down && moved < 5) {
        toNdc(e); ray.setFromCamera(ndc, camera);
        const mh = ray.intersectObjects(G.markers.map((m) => m.sprite))[0];
        if (mh) { const m = G.markers.find((x) => x.sprite === mh.object); G.handlers.site(m.site); }
        else { const hit = ray.intersectObject(G.globe)[0]; if (hit) G.handlers.pick(latLonOf(hit.point)); }
      }
      down = null; G.dragging = false;
    });
    el.addEventListener("wheel", (e) => {
      if (e.ctrlKey || e.metaKey) return;
      e.preventDefault(); G.anim = null; G.cam.dist = Math.max(1.04, Math.min(6, 1 + (G.cam.dist - 1) * Math.exp(e.deltaY * 0.0012)));
    }, { passive: false });

    new ResizeObserver(resize).observe(el); resize();
    const loop = () => { step(); renderer.render(scene, camera); placeLabels(); requestAnimationFrame(loop); };
    loop();
  }

  function addLabel(p, text, cls) { const d = document.createElement("div"); d.className = "glabel " + cls; d.textContent = text; G.labelLayer.appendChild(d); const L = { p, d }; G.labels.push(L); return L; }
  function placeLabels() {
    const w = G.el.clientWidth, h = G.el.clientHeight, camDir = G.camera.position.clone().normalize(), boxes = [];
    const order = [...G.labels].sort((a, b) => (b.d.classList.contains("sel") ? 1 : 0) - (a.d.classList.contains("sel") ? 1 : 0));
    for (const L of order) {
      const facing = L.p.clone().normalize().dot(camDir) > 0.15, v = L.p.clone().project(G.camera);
      const show = facing && !L.hidden && v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
      const sx = ((v.x + 1) / 2) * w, sy = ((1 - v.y) / 2) * h;
      let ok = show;
      if (ok && L.d.classList.contains("site")) {
        const bw = L.d.offsetWidth || 80, b = [sx + 12, sy - 9, sx + 12 + bw, sy + 9];
        ok = !boxes.some((o) => b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1]);
        if (ok) boxes.push(b);
      }
      L.d.style.display = ok ? "" : "none";
      if (ok) L.d.style.transform = `translate(${sx}px, ${sy}px)`;
    }
  }
  // Keep the Moon centred in the space not covered by the floating panel (left) or bottom sheet.
  G.inset = { left: 0, bottom: 0 };
  function setInset(i) { G.inset = { left: i.left || 0, bottom: i.bottom || 0 }; resize(); }
  function resize() {
    const pixelRatio = renderPixelRatio();
    const w = G.el.clientWidth || 1, h = G.el.clientHeight || 1;
    const canvas = G.renderer.domElement;
    const pixelRatioChanged = G.renderer.getPixelRatio() !== pixelRatio;
    const sizeChanged = canvas.style.width !== w + "px" || canvas.style.height !== h + "px";
    if (pixelRatioChanged) G.renderer.setPixelRatio(pixelRatio);
    if (sizeChanged) {
      G.renderer.setSize(w, h, false);
      canvas.style.width = w + "px"; canvas.style.height = h + "px";
    }
    G.camera.aspect = w / h;
    G.camera.setViewOffset(w, h, -G.inset.left / 2, G.inset.bottom / 2, w, h);
    G.camera.updateProjectionMatrix();
  }
  window.addEventListener("resize", resize);
  function step() {
    if (G.spin && !G.anim && !G.dragging) G.cam.lon += 0.025;
    if (G.anim) {
      const a = G.anim, t = Math.min(1, (performance.now() - a.t0) / a.ms), k = easeInOut(t);
      let dl = a.to.lon - a.from.lon; dl = ((dl + 540) % 360) - 180;
      G.cam.lat = a.from.lat + (a.to.lat - a.from.lat) * k; G.cam.lon = a.from.lon + dl * k;
      G.cam.dist = a.from.dist + (a.to.dist - a.from.dist) * k + Math.sin(Math.PI * k) * (a.arc || 0);
      if (t >= 1) { G.anim = null; a.done && a.done(); }
    }
    const { lat, lon, dist } = G.cam, p = pos(lat, lon, dist);
    // "up" on screen = local north at the camera's sub-point (stable even over the pole)
    const north = pos(Math.min(lat + 0.5, 89.99), lon, 1).sub(pos(lat, lon, 1)).normalize();
    G.camera.position.copy(p); G.camera.up.copy(north); G.camera.lookAt(0, 0, 0);
    const near = Math.max(0.0005, (dist - 1) * 0.2); if (Math.abs(G.camera.near - near) > 1e-4) { G.camera.near = near; G.camera.updateProjectionMatrix(); }
    for (const m of G.markers) { const s = markerWorldSize(m.sprite, m.site.id === G.selected ? 12 : 10); m.sprite.scale.set(s, s, 1); }
    if (G.pin) { const s = markerWorldSize(G.pin, 11); G.pin.scale.set(s, s, 1); }
  }

  function flyTo(lat, lon, dist = G.cam.dist, ms = 1400, arc = 0, done) { G.anim = { t0: performance.now(), ms, from: { ...G.cam }, to: { lat: Math.max(-89.9, Math.min(89.9, lat)), lon, dist }, arc, done }; }
  // Camera position that puts (lat, lon) in the middle of the screen with the pole "above" it.
  function focus(lat, lon, dist = 1.35) { flyTo(lat - 2, lon, dist); }
  function markerWorldSize(sprite, pixels) {
    return 2 * G.camera.position.distanceTo(sprite.position) * Math.tan(G.camera.fov * D / 2) * pixels / (G.el.clientHeight || 1);
  }
  function setSites(sites) {
    for (const s of sites) {
      const sprite = makeDot(siteColor(s), 0.012); sprite.position.copy(pos(s.lat, s.lon, 1.003)); G.scene.add(sprite);
      const label = addLabel(pos(s.lat, s.lon, 1.003), s.name.split(" (")[0], "site");
      label.d.onclick = () => G.handlers.site(s);
      G.markers.push({ site: s, sprite, label });
    }
  }
  function select(id) {
    G.selected = id;
    for (const m of G.markers) { m.sprite.material.map = dotTexture(siteColor(m.site)); m.sprite.material.needsUpdate = true; m.label.d.classList.toggle("sel", m.site.id === id); }
  }
  function setPin(lat, lon, name) {
    if (G.pin) { G.scene.remove(G.pin); G.pin = null; }
    if (G.pinLabel) {
      const i = G.labels.indexOf(G.pinLabel); if (i >= 0) G.labels.splice(i, 1);
      G.pinLabel.d.remove(); G.pinLabel = null;
    }
    if (lat == null) return;
    G.pin = makeDot("#ff4d4d", 0.009); G.pin.position.copy(pos(lat, lon, 1.004)); G.scene.add(G.pin);
    G.pinLabel = addLabel(pos(lat, lon, 1.004), name || "", "site custom-site-label");
  }
  function setPinName(name) { if (G.pinLabel) G.pinLabel.d.textContent = name; }
  function setOverlay(canvas) {
    if (!canvas) { G.overlay.visible = false; return; }
    if (!G.overlayMat.map || G.overlayMat.map.image !== canvas) { if (G.overlayMat.map) G.overlayMat.map.dispose(); G.overlayMat.map = new THREE.CanvasTexture(canvas); G.overlayMat.needsUpdate = true; }
    else G.overlayMat.map.needsUpdate = true;
    G.overlay.visible = true;
  }
  function setRelief(canvas) {
    const u = G.capMat && G.capMat.uniforms; if (!u) return;
    if (!canvas) { u.useRelief.value = false; return; }
    if (!u.relief.value || u.relief.value.image !== canvas) { u.relief.value = new THREE.CanvasTexture(canvas); u.relief.value.anisotropy = 8; }
    else u.relief.value.needsUpdate = true;
    u.useRelief.value = true;
  }
  function setSun(vMoonFixed) {
    if (!vMoonFixed) return;
    const d = fromMoonFixed(vMoonFixed); G.sun.position.copy(d.clone().multiplyScalar(5));
    for (const m of G.shaded || []) m.uniforms.sunDir.value.copy(d);
  }
  function intro(sunMoonFixed) {
    // start over the sunlit side (sub-solar longitude) so the Moon looks bright, then glide to the pole
    const lon0 = sunMoonFixed ? Math.atan2(sunMoonFixed[1], sunMoonFixed[0]) / D - 25 : -35;
    G.cam = { lat: 12, lon: lon0, dist: 4.4 };
    G.ready.then(() => setTimeout(() => flyTo(-89.5, 0, 1.62, 3800, 0.4), 350));
  }
  // Opening view: whole Moon over today's sunlit side, turning slowly
  function showcase(sunMoonFixed) {
    const lon0 = sunMoonFixed ? Math.atan2(sunMoonFixed[1], sunMoonFixed[0]) / D - 20 : -35;
    G.anim = null; G.spin = true;
    if (G.cam.dist < 2.5) flyTo(-18, lon0, 3.1, 1600); else G.cam = { lat: -18, lon: lon0, dist: 3.1 };
  }
  function toPole() { G.spin = false; G.ready.then(() => flyTo(-89.5, 0, 1.62, 3200, 0.35)); }
  root.Globe = { setRelief, showcase, toPole, setInset, init, setSites, select, setPin, setPinName, setOverlay, setSun, flyTo, focus, intro, resize, whenReady: () => G.ready, on: (k, f) => (G.handlers[k] = f), _G: G };
})(window);
