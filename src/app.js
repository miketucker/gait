
(function () {
  const D = JSON.parse(document.getElementById('data').textContent);
  const M = D.model, SOL = D.solutions;
  const MOD = (s) => (s && D.models && D.models[s.summary.model]) || D.model;
  const special = (s) => s.summary.codesign || s.summary.dof6 || s.summary.variant;
  const css = getComputedStyle(document.documentElement);
  const tok = (n) => css.getPropertyValue(n).trim();
  let T = {};
  function readTokens() { const g = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
    T = { surface: g('--surface'), surface2: g('--surface-2'), ink: g('--ink'), ink2: g('--ink-2'), muted: g('--muted'), rule: g('--rule'), accent: g('--accent'), bone: g('--bone'), boneFar: g('--bone-far'), grf: g('--grf'), paw: g('--paw'), grid: g('--grid'), up: g('--up'), down: g('--down'),
      ramp: [g('--m0'), g('--m1'), g('--m2'), g('--m3'), g('--m4')] }; }
  readTokens();
  const FAM = [['walk', 'Walk', '--s1', 'circle'], ['trot', 'Trot', '--s2', 'square'], ['pace', 'Pace', '--s3', 'diamond'], ['canter', 'Canter', '--s4', 'triangle'], ['gallop', 'Gallop', '--s5', 'tri-down'], ['bound', 'Bound', '--s6', 'cross'], ['pronk', 'Pronk', '--s7', 'star'], ['other', 'Irregular', '--s8', 'circle-open']];
  const famIndex = Object.fromEntries(FAM.map((f, i) => [f[0], i]));
  const family = (g) => { g = (g || '').toLowerCase(); for (const k of ['gallop', 'canter', 'bound', 'pronk', 'trot', 'pace', 'walk']) if (g.includes(k)) return k; return 'other'; };
  const famColor = (f) => tok(FAM[famIndex[f]][2]);
  const pretty = (g) => g.replace(/(^|\s)\S/g, (s) => s.toUpperCase());
  SOL.forEach((s, i) => { s.id = i; s.fam = family(s.summary.gait); });
  const speeds = [...new Set(SOL.map((s) => s.summary.speed))].sort((a, b) => a - b);
  const bestAt = {};
  speeds.forEach((v) => { bestAt[v] = SOL.filter((s) => s.summary.speed === v && !special(s)).reduce((a, b) => (b.summary.cot < a.summary.cot ? b : a), SOL.find((s) => s.summary.speed === v && !special(s)) || SOL.find((s) => s.summary.speed === v)); });
  const bidxOf = new Map();
  const bidxFor = (MM) => { if (!bidxOf.has(MM)) bidxOf.set(MM, Object.fromEntries(MM.bones.map((b, i) => [b.name, i]))); return bidxOf.get(MM); };
  let bidx = bidxFor(M);
  const legOf = (name) => (/^([LRC][FH1-9])_/.exec(name) || [])[1] || '';
  // left-side labels: F / H for the corner legs, M1.. for the middle pairs of a many-legged body
  const legLabel = (name) => name.replace(/^[LC]([FH])_/, '$1 ').replace(/^L([1-9])_/, 'M$1 ');
  const isRight = (name) => /^R[FH1-9]_/.test(name);

  function hexToRgb(h) { h = h.replace('#', ''); if (h.length === 3) h = h.split('').map((c) => c + c).join(''); const n = parseInt(h, 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
  function rampColor(a) { a = Math.max(0, Math.min(1, a)); const r = T.ramp.map(hexToRgb); const x = a * (r.length - 1); const k = Math.min(Math.floor(x), r.length - 2); const w = x - k; const c = r[k].map((v, j) => Math.round(v + (r[k + 1][j] - v) * w)); return `rgb(${c[0]},${c[1]},${c[2]})`; }

  let cur = bestAt[speeds[Math.min(1, speeds.length - 1)]];
  let playing = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let rate = 0.35, phase = 0, last = performance.now();
  const cam = { az: 0.62, el: 0.24, dist: 1.75 };
  const VIEWS = { three: [0.62, 0.28], side: [0.0, 0.08], front: [1.5708, 0.12], top: [0.0, 1.45] };

  // ---------- pose interpolation
  function poseAt(s, ph) {
    bidx = bidxFor(MOD(s));
    const P = s.poses, N = P.length, x = ph * N, k = Math.floor(x) % N, w = x - Math.floor(x), k1 = (k + 1) % N;
    const shift = k1 === 0 ? s.summary.speed * s.summary.T : 0;
    return P[k].map((a, b) => { const c = P[k1][b]; const o = a.map((v, i) => v * (1 - w) + (c[i] + (i === 9 ? shift : 0)) * w); return o; });
  }
  const apply = (pose, bone, p) => { const r = pose[bidx[bone]]; return [r[9] + r[0] * p[0] + r[3] * p[1] + r[6] * p[2], r[10] + r[1] * p[0] + r[4] * p[1] + r[7] * p[2], r[11] + r[2] * p[0] + r[5] * p[1] + r[8] * p[2]]; };

  // tallest point over the stride (bone ends), so the camera frames tall bodies too
  function heightOf(s) {
    if (s._ymax == null) { let y = 0; const bs = MOD(s).bones; s.poses.forEach((P) => P.forEach((r, b) => { const L = bs[b].length; y = Math.max(y, r[10], r[10] + r[1] * L); })); s._ymax = y; }
    return s._ymax;
  }
  // ---------- camera
  const cv = document.getElementById('stage'), ctx = cv.getContext('2d');
  let dpr = 1;
  function resize(c) { const r = c.getBoundingClientRect(); dpr = window.devicePixelRatio || 1; c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr); }
  resize(cv);
  function makeCam(target) {
    const ce = Math.cos(cam.el), C = [target[0] + cam.dist * ce * Math.sin(cam.az), target[1] + cam.dist * Math.sin(cam.el), target[2] + cam.dist * ce * Math.cos(cam.az)];
    let f = [target[0] - C[0], target[1] - C[1], target[2] - C[2]]; const fn = Math.hypot(...f); f = f.map((v) => v / fn);
    let r = [f[1] * 0 - f[2] * 1, f[2] * 0 - f[0] * 0, f[0] * 1 - f[1] * 0]; // f x up(0,1,0)
    const rn = Math.hypot(...r) || 1; r = r.map((v) => v / rn);
    const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
    const F = cv.height * 1.35;
    return (p) => { const d = [p[0] - C[0], p[1] - C[1], p[2] - C[2]]; const z = d[0] * f[0] + d[1] * f[1] + d[2] * f[2];
      const x = d[0] * r[0] + d[1] * r[1] + d[2] * r[2], y = d[0] * u[0] + d[1] * u[1] + d[2] * u[2];
      return [cv.width / 2 + F * x / z, cv.height * 0.55 - F * y / z, z, F / z]; };
  }
  // ---------- anatomy layers (three.js): bones, muscles and tendons, organs, skin (see gaitlab3d/anatomy.py)
  const Anat = (() => {
    if (!window.THREE) return null;
    const cv3 = document.getElementById('stage3');
    let renderer;
    try { renderer = new THREE.WebGLRenderer({ canvas: cv3, antialias: true }); } catch (e) { return null; }
    renderer.localClippingEnabled = true;
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(2 * Math.atan(0.5 / 1.35) * 180 / Math.PI, 1.6, 0.02, 30);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x3a3a3a, 0.8));
    const sun = new THREE.DirectionalLight(0xffffff, 0.75); sun.position.set(1.2, 3, 2.2); scene.add(sun);
    const fill = new THREE.DirectionalLight(0xffffff, 0.3); fill.position.set(-2, 1, -1.5); scene.add(fill);
    let grid = null, gridColor = '';
    const clip = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);
    const PAL = { bone: 0xe8e0cc, tendon: 0xe9dfc7, chest: 0xc4707e, abdomen: 0xb98a58, skin: 0xd8b08a, fat: [0xf6e7a0, 0xe39a3b] };
    const b64 = (s, Ty) => { const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new Ty(u.buffer); };
    const mat4 = (r) => new THREE.Matrix4().set(r[0], r[3], r[6], r[9], r[1], r[4], r[7], r[10], r[2], r[5], r[8], r[11], 0, 0, 0, 1);
    const std = (c, o = {}) => new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.65, metalness: 0 }, o));
    const MAT = { bone: std(PAL.bone, { roughness: 0.5 }), chest: std(PAL.chest, { transparent: true, opacity: 0.55, depthWrite: false }),
      abdomen: std(PAL.abdomen, { transparent: true, opacity: 0.5, depthWrite: false }), muscle: std(0xffffff, { vertexColors: true, roughness: 0.55 }),
      skin: std(PAL.skin, { transparent: true, opacity: 0.35, roughness: 0.75, side: THREE.FrontSide }) };
    // a bone shaft with swollen, rounded ends along +x (lathe about y, then turned onto x)
    function lathe(L, rs, re, seg = 12) {
      const pts = [], n = 18, cap = 5;
      for (let i = 0; i <= cap; i++) { const a = -Math.PI / 2 + (i / cap) * Math.PI / 2; pts.push(new THREE.Vector2(Math.max(1e-4, Math.cos(a) * re), Math.sin(a) * re)); }
      for (let i = 1; i < n; i++) { const t = i / n; pts.push(new THREE.Vector2(rs + (re - rs) * (Math.exp(-((t / 0.13) ** 2)) + Math.exp(-(((1 - t) / 0.13) ** 2))), t * L)); }
      for (let i = 0; i <= cap; i++) { const a = (i / cap) * Math.PI / 2; pts.push(new THREE.Vector2(Math.max(1e-4, Math.cos(a) * re), L + Math.sin(a) * re)); }
      const g = new THREE.LatheGeometry(pts, seg); g.rotateZ(-Math.PI / 2); return g;
    }
    function taper(L, r0, r1, seg = 14) {  // a rounded cone along +x
      const pts = [new THREE.Vector2(1e-4, -0.5 * r0)];
      for (let i = 0; i <= 16; i++) { const t = i / 16; pts.push(new THREE.Vector2(r0 + (r1 - r0) * t, t * L)); }
      pts.push(new THREE.Vector2(1e-4, L + 0.6 * r1));
      const g = new THREE.LatheGeometry(pts, seg); g.rotateZ(-Math.PI / 2); return g;
    }
    const sphere = new THREE.SphereGeometry(1, 20, 14), cyl = new THREE.CylinderGeometry(1, 1, 1, 10).rotateZ(Math.PI / 2), box = new THREE.BoxGeometry(1, 1, 1);
    const place = (g, m, pos, scl) => { const o = new THREE.Mesh(g, m); o.position.set(...pos); o.scale.set(...scl); return o; };
    class RibCurve extends THREE.Curve {
      constructor(x, hh, hw, sgn) { super(); Object.assign(this, { x, hh, hw, sgn }); }
      getPoint(t, v = new THREE.Vector3()) { const th = Math.PI * t; return v.set(this.x + 0.035 * Math.sin(th / 2), -this.hh * (1 - Math.cos(th)), this.sgn * this.hw * Math.sin(th)); }
    }
    // a canid-like skull in the head frame (x forward along the head, y up), scaled by head length L
    const tube = (pts, r, m = MAT.bone) => new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p))), 16, r, 6), m);
    const MAT_TOOTH = std(0xf6f2e6, { roughness: 0.3 });
    const cone = new THREE.ConeGeometry(1, 1, 8);
    function skull(L, MM) {
      const g = new THREE.Group(), P = (x, y, z) => [x * L, y * L, z * L];
      g.add(place(sphere, MAT.bone, P(0.27, 0.05, 0), [0.29 * L, 0.21 * L, 0.22 * L]));            // braincase
      g.add(place(sphere, MAT.bone, P(0.03, 0.02, 0), [0.1 * L, 0.12 * L, 0.13 * L]));             // occiput
      g.add(place(box, MAT.bone, P(0.2, 0.24, 0), [0.3 * L, 0.05 * L, 0.012 * L]));                // sagittal crest
      const mz = new THREE.Mesh(taper(0.6 * L, 0.125 * L, 0.055 * L), MAT.bone);                    // muzzle: maxilla and nasals
      mz.position.set(0.42 * L, -0.03 * L, 0); mz.scale.set(1, 0.85, 1); mz.rotation.z = -0.05; g.add(mz);
      g.add(place(sphere, MAT.bone, P(0.43, 0.02, 0), [0.1 * L, 0.12 * L, 0.15 * L]));             // brow between the orbits
      for (const z of [1, -1]) {
        g.add(tube([P(0.58, -0.06, z * 0.1), P(0.42, -0.03, z * 0.21), P(0.26, -0.02, z * 0.2), P(0.16, 0.0, z * 0.14)], 0.022 * L));   // zygomatic arch
        g.add(tube([P(0.14, -0.06, z * 0.13), P(0.2, -0.17, z * 0.12), P(0.55, -0.18, z * 0.075), P(0.96, -0.14, z * 0.02)], 0.032 * L)); // mandible
        g.add(tube([P(0.2, -0.13, z * 0.12), P(0.23, -0.03, z * 0.13), P(0.25, 0.06, z * 0.12)], 0.02 * L));                          // coronoid process
        const eye = MM.eye ? MM.eye[1] : [0.09, 0.03, 0];
        g.add(place(sphere, std(0x1b1410, { roughness: 0.2 }), [eye[0], eye[1], z * 0.17 * L], [0.055 * L, 0.055 * L, 0.05 * L]));    // eye in its orbit
        const t = (x, y, zz, len, r, up) => { const o = place(cone, MAT_TOOTH, P(x, y, zz), [r * L, len * L, r * L]); o.rotation.z = up ? 0 : Math.PI; g.add(o); };
        t(0.88, -0.12, z * 0.055, 0.08, 0.018, false);                                            // upper canine
        t(0.91, -0.115, z * 0.035, 0.065, 0.015, true);                                           // lower canine
        for (let i = 0; i < 5; i++) t(0.5 + 0.075 * i, -0.115, z * (0.085 - 0.006 * i), 0.035, 0.016, false);   // cheek teeth
        for (let i = 0; i < 3; i++) t(0.99, -0.1, z * (0.01 + 0.012 * i), 0.03, 0.007, false);      // incisors
      }
      return g;
    }
    // bones from the exported parts (gaitlab3d/skeleton_parts.py), merged per material; the head gets the skull
    const MAT_CART = std(0xc6dbe3, { roughness: 0.35 }), MAT_LIG = std(0xf0f1ec, { roughness: 0.3 }),
      MAT_CAPS = std(0xb4d0dc, { transparent: true, opacity: 0.3, depthWrite: false, roughness: 0.3 });
    const PMAT = { bone: MAT.bone, cart: MAT_CART, lig: MAT_LIG, tooth: MAT_TOOTH, capsule: MAT_CAPS };
    const V3 = (a) => new THREE.Vector3(a[0], a[1], a[2]), YUP = new THREE.Vector3(0, 1, 0), ONE = new THREE.Vector3(1, 1, 1), Q0 = new THREE.Quaternion();
    function partGeoms(p) {                 // [geometry, matrix] pairs for one part, in its bone's frame
      const out = [];
      if (p.t === 'shaft') out.push([lathe(p.L, p.rs, p.re), new THREE.Matrix4()]);
      else if (p.t === 'ell') out.push([sphere, new THREE.Matrix4().compose(V3(p.c), Q0, V3(p.s))]);
      else if (p.t === 'cap') {
        const a = V3(p.a), b = V3(p.b), d = b.clone().sub(a), len = d.length();
        if (len > 1e-6) out.push([new THREE.CylinderGeometry(p.rb, p.ra, len, 10, 1, true), new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(YUP, d.normalize()), ONE)]);
        out.push([sphere, new THREE.Matrix4().compose(V3(p.a), Q0, new THREE.Vector3(p.ra, p.ra, p.ra))], [sphere, new THREE.Matrix4().compose(V3(p.b), Q0, new THREE.Vector3(p.rb, p.rb, p.rb))]);
      } else if (p.t === 'tube') out.push([new THREE.TubeGeometry(new THREE.CatmullRomCurve3(p.p.map(V3)), Math.max(6, 3 * p.p.length), p.r, 6), new THREE.Matrix4()]);
      else if (p.t === 'plate') {
        const P = p.p.map(V3), c = P.reduce((s, q) => s.add(q), new THREE.Vector3()).multiplyScalar(1 / P.length), n = new THREE.Vector3();
        for (let i = 0; i < P.length; i++) n.add(P[i].clone().sub(c).cross(P[(i + 1) % P.length].clone().sub(c)));
        if (n.length() < 1e-12) return out;
        n.normalize();
        const u = P[0].clone().sub(c); u.sub(n.clone().multiplyScalar(u.dot(n))); if (u.length() < 1e-9) return out;
        u.normalize(); const v = n.clone().cross(u);
        const g = new THREE.ExtrudeGeometry(new THREE.Shape(P.map((q) => new THREE.Vector2(q.clone().sub(c).dot(u), q.clone().sub(c).dot(v)))),
          { depth: p.th, bevelEnabled: true, bevelThickness: 0.3 * p.th, bevelSize: 0.3 * p.th, bevelSegments: 2, curveSegments: 4 });
        g.translate(0, 0, -0.5 * p.th);
        out.push([g, new THREE.Matrix4().makeBasis(u, v, n).setPosition(c)]);
      }
      return out;
    }
    function mergeGeoms(list) {             // one mesh per material and bone keeps the draw calls down
      let n = 0;
      const G = list.map(([g, m]) => { const q = g.index ? g.toNonIndexed() : g.clone(); q.applyMatrix4(m); if (!q.attributes.normal) q.computeVertexNormals(); n += q.attributes.position.count; return q; });
      const P = new Float32Array(3 * n), N = new Float32Array(3 * n); let o = 0;
      for (const q of G) { P.set(q.attributes.position.array, 3 * o); N.set(q.attributes.normal.array, 3 * o); o += q.attributes.position.count; q.dispose(); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
      return g;
    }
    function boneGroup(name, AN, MM) {
      const g = new THREE.Group(), soft = new THREE.Group(); g.add(soft);
      if (name === 'head') g.add(skull(MM.bones[bidxFor(MM)[name]].length, MM));
      const byM = {};
      for (const p of AN.parts[name] || []) for (const gm of partGeoms(p)) (byM[p.m] = byM[p.m] || []).push(gm);
      for (const [m, list] of Object.entries(byM)) (m === 'cart' || m === 'lig' ? soft : g).add(new THREE.Mesh(mergeGeoms(list), PMAT[m] || MAT.bone));
      g.matrixAutoUpdate = false;
      return { g, soft };
    }
    function pushOne(c, need, cp) {         // mirror of anatomy.push_out: keep c at least rb + need from a shaft axis
      const [a, b, rb] = cp, ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ab2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2 || 1e-12;
      const t = Math.min(1, Math.max(0, ((c[0] - a[0]) * ab[0] + (c[1] - a[1]) * ab[1] + (c[2] - a[2]) * ab[2]) / ab2));
      const q = [a[0] + t * ab[0], a[1] + t * ab[1], a[2] + t * ab[2]], d = [c[0] - q[0], c[1] - q[1], c[2] - q[2]], dn = Math.hypot(d[0], d[1], d[2]), want = rb + need;
      if (dn < want && dn > 1e-6) { const f = want / dn; c[0] = q[0] + d[0] * f; c[1] = q[1] + d[1] * f; c[2] = q[2] + d[2] * f; }
    }
    // muscle-tendon unit: mirror of anatomy.muscle_rings
    const boneR = (cm, x) => { const t = Math.min(1, Math.max(0, x / cm.L)); return cm.rs + (cm.re - cm.rs) * (Math.exp(-((t / 0.13) ** 2)) + Math.exp(-(((1 - t) / 0.13) ** 2))); };
    // planes compartments stay inside: mirror of anatomy.seg_closest / sector_clips
    const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], cl01 = (v) => Math.min(1, Math.max(0, v));
    function segClosest(a0, a1, b0, b1) {
      const u = [a1[0] - a0[0], a1[1] - a0[1], a1[2] - a0[2]], v = [b1[0] - b0[0], b1[1] - b0[1], b1[2] - b0[2]], w = [a0[0] - b0[0], a0[1] - b0[1], a0[2] - b0[2]];
      const A = dot3(u, u), B = dot3(u, v), Cc = dot3(v, v), D = dot3(u, w), E = dot3(v, w), den = A * Cc - B * B;
      let s = den > 1e-12 ? cl01((B * E - Cc * D) / den) : 0;
      const t = Cc > 1e-12 ? cl01((B * s + E) / Cc) : 0;
      s = A > 1e-12 ? cl01((B * t - D) / A) : 0;
      return [[a0[0] + s * u[0], a0[1] + s * u[1], a0[2] + s * u[2]], [b0[0] + t * v[0], b0[1] + t * v[1], b0[2] + t * v[2]]];
    }
    const C_REACH = 0.2;                       // anatomy.NEAR_REACH
    function sectorClips(cm, fr, getF) {      // planes a compartment's bellies stay inside: the other leg, the joint creases
      const out = [], X = (f) => [f[0], f[1], f[2]], O = (f) => [f[9], f[10], f[11]];
      const o = O(fr), x = X(fr), e = [o[0] + cm.L * x[0], o[1] + cm.L * x[1], o[2] + cm.L * x[2]];
      for (const [b, PL] of cm.near || []) {     // every other leg's bone in reach: the plane bisecting the two
        const pf = getF(b), po = O(pf), px = X(pf);
        const [pa, pb] = segClosest(o, e, po, [po[0] + PL * px[0], po[1] + PL * px[1], po[2] + PL * px[2]]);
        const d = [pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]], g = Math.hypot(...d);
        if (g > 1e-9 && g < 2 * C_REACH) out.push([[d[0] / g, d[1] / g, d[2] / g], [0.5 * (pa[0] + pb[0]), 0.5 * (pa[1] + pb[1]), 0.5 * (pa[2] + pb[2])]]);
      }
      for (const [b, ch] of cm.joints || []) {
        const of = getF(b), [J, r2, r1, sg] = ch > 0 ? [O(fr), X(fr), X(of).map((v) => -v), 1] : [O(of), X(of), X(fr).map((v) => -v), -1];
        const d = [r2[0] - r1[0], r2[1] - r1[1], r2[2] - r1[2]], dn = Math.hypot(...d);
        if (dn > 1e-6) out.push([[sg * d[0] / dn, sg * d[1] / dn, sg * d[2] / dn], J]);
      }
      return out;
    }
    // merged compartment bands: mirror of anatomy.comp_profile / band_at / band_point / compartment_rings
    const bandK = (d, W) => (Math.abs(d) < W ? (1 + Math.cos(Math.PI * d / W)) / (2 * W) : 0);   // anatomy._kern
    function interp0(x, xa, fa) {              // np.interp inside [xa[0], xa[n-1]] (to rounding), 0 outside
      const n = xa.length; if (!n || x < xa[0] - 1e-9 || x > xa[n - 1] + 1e-9) return 0; if (n === 1) return fa[0];
      x = Math.min(xa[n - 1], Math.max(xa[0], x));
      let j = 0; while (j < n - 2 && xa[j + 1] < x) j++;
      return fa[j] + (fa[j + 1] - fa[j]) * (x - xa[j]) / ((xa[j + 1] - xa[j]) || 1e-12);
    }
    function compProfile(R, cm, fr, C) {       // stations over the attachment span, areas keeping the volume
      const [lo, hi] = C.clear[cm.kind], x = [], A = [], bk = [];
      for (let k = 0; k < R.c.length; k++) {
        const d = [R.c[k][0] - fr[9], R.c[k][1] - fr[10], R.c[k][2] - fr[11]];
        x.push(Math.min(hi * cm.L, Math.max(lo * cm.L, fr[0] * d[0] + fr[1] * d[1] + fr[2] * d[2]))); A.push(Math.PI * R.r[k] ** 2);
        if (R.belly[k]) bk.push(k);
      }
      if (bk.length > 1) {
        const cum = [0];
        for (let q = 1; q < bk.length; q++) { const a = R.c[bk[q - 1]], b = R.c[bk[q]]; cum.push(cum[q - 1] + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])); }
        const span = cm.x1 - cm.x0, arc = cum[cum.length - 1];
        bk.forEach((k, q) => { x[k] = cm.x0 + span * cum[q] / Math.max(arc, 1e-12); A[k] *= arc / span; });
      }
      return { x, xb: bk.map((k) => x[k]), Ab: bk.map((k) => A[k]) };
    }
    function bandAt(i, AN, profs, fr, clips, x, u, gap) {   // [inner, outer] of muscle i's band at x, fibre u
      const cm = AN.muscles[i].comp, rnd = cm.kind === 'round', ang = (rnd ? cm.phi : cm.y) + u * cm.W;
      let S = 0, Ct = 0, ci = 0;
      for (const j of cm.mates) {
        const cj = AN.muscles[j].comp; let d = ang - (rnd ? cj.phi : cj.y);
        if (rnd) d = (((d + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
        const kk = bandK(d, cj.W); if (!kk) continue;
        const dens = kk * interp0(x, profs[j].xb, profs[j].Ab);
        Ct += dens; if (j === i) ci = dens; else if (cj.depth < cm.depth) S += dens;
      }
      const Rb = rnd ? boneR(cm, x) : 0; let f = 1;
      if (clips.length) {                      // squashed, all layers in proportion, short of each plane
        let dr, base;
        if (rnd) { const ly = Math.cos(ang), lz = cm.zs * Math.sin(ang); dr = [fr[3] * ly + fr[6] * lz, fr[4] * ly + fr[7] * lz, fr[5] * ly + fr[8] * lz];
          base = [fr[9] + fr[0] * x + Rb * dr[0], fr[10] + fr[1] * x + Rb * dr[1], fr[11] + fr[2] * x + Rb * dr[2]]; }
        else { const z = cm.zs * 0.5 * cm.th; dr = [cm.zs * fr[6], cm.zs * fr[7], cm.zs * fr[8]];
          base = [fr[9] + fr[0] * x + fr[3] * ang + fr[6] * z, fr[10] + fr[1] * x + fr[4] * ang + fr[7] * z, fr[11] + fr[2] * x + fr[5] * ang + fr[8] * z]; }
        let room = Infinity;
        for (const [n, m] of clips) {
          const nd = dot3(dr, n), h = (base[0] - m[0]) * n[0] + (base[1] - m[1]) * n[1] + (base[2] - m[2]) * n[2] - gap;
          room = Math.min(room, nd < -1e-9 ? h / -nd : (h < 0 ? 0 : Infinity));
        }
        room = Math.max(room, 0);
        const cap = rnd ? room * (Rb + 0.5 * room) : room;
        if (Ct > cap) f = cap / Math.max(Ct, 1e-15);
      }
      if (rnd) return [Math.sqrt(Rb * Rb + 2 * f * S), Math.sqrt(Rb * Rb + 2 * f * (S + ci))];
      const inner = 0.5 * cm.th + f * S; return [inner, inner + f * ci];
    }
    function bandPoint(cm, fr, x, u, rho) {
      let l;
      if (cm.kind === 'round') { const a = cm.phi + u * cm.W; l = [x, rho * Math.cos(a), cm.zs * rho * Math.sin(a)]; }
      else l = [x, cm.y + u * cm.W, cm.zs * rho];
      return [fr[9] + fr[0] * l[0] + fr[3] * l[1] + fr[6] * l[2], fr[10] + fr[1] * l[0] + fr[4] * l[1] + fr[7] * l[2], fr[11] + fr[2] * l[0] + fr[5] * l[1] + fr[8] * l[2]];
    }
    function compAll(AN, base, getF) {         // every compartment muscle's rings in its band, for one pose
      const C = AN.const, out = {}, profs = {}, mid = (C.bu.length - 1) >> 1;
      AN.muscles.forEach((m, i) => { if (!m.comp) return; const R = base(i), P = compProfile(R, m.comp, getF(m.comp.bone), C); R.xk = P.x; profs[i] = P; out[i] = R; });
      for (const key of Object.keys(out)) {
        const i = +key, cm = AN.muscles[i].comp, R = out[i], fr = getF(cm.bone), clips = sectorClips(cm, fr, getF);
        Object.assign(R, { inn: [], out: [], sector: cm, fr, clips, band: true });
        for (let k = 0; k < R.c.length; k++) {
          const a = [], b = [];
          if (R.belly[k]) for (const u of C.bu) { const [p, q] = bandAt(i, AN, profs, fr, clips, R.xk[k], u, C.gap); a.push(p); b.push(q); }
          R.inn.push(a); R.out.push(b);
          if (R.belly[k]) { R.c[k] = bandPoint(cm, fr, R.xk[k], 0, 0.5 * (a[mid] + b[mid])); R.r[k] = 0.5 * (b[mid] - a[mid]); }
        }
      }
      return out;
    }
    // muscles give way to the skin: every muscle vertex stays PRESS_MARGIN under the skin as drawn this frame
    const PRESS_MARGIN = 0.0035, PRESS_CELL = 0.03, PRESS_EVERY = 10, PRESS_BUF = {}, PRESS_NEAR = new WeakMap();
    let pressFrame = 0;
    function vertexFaces(F, nv) {             // the faces around each skin vertex (compressed rows)
      const off = new Int32Array(nv + 1); for (let k = 0; k < F.length; k++) off[F[k] + 1]++;
      for (let v = 0; v < nv; v++) off[v + 1] += off[v];
      const idx = new Int32Array(F.length), at = off.slice(0, nv);
      for (let f = 0; f < F.length / 3; f++) for (let k = 0; k < 3; k++) idx[at[F[3 * f + k]]++] = f;
      return { off, idx };
    }
    const PN = [0, 0, 0];
    function skinSide(x, y, z, q, Sm, F, VF) { // signed distance to the skin at its closest point among the faces around
      let best = Infinity, e = 0; PN[0] = PN[1] = PN[2] = 0;   // vertex q; ties (edges, corners) average their normals
      for (let t = VF.off[q]; t < VF.off[q + 1]; t++) {
        const f = VF.idx[t], ia = 3 * F[3 * f], ib = 3 * F[3 * f + 1], ic = 3 * F[3 * f + 2];
        const ax = Sm[ia], ay = Sm[ia + 1], az = Sm[ia + 2], abx = Sm[ib] - ax, aby = Sm[ib + 1] - ay, abz = Sm[ib + 2] - az, acx = Sm[ic] - ax, acy = Sm[ic + 1] - ay, acz = Sm[ic + 2] - az;
        const apx = x - ax, apy = y - ay, apz = z - az, d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
        const bpx = x - Sm[ib], bpy = y - Sm[ib + 1], bpz = z - Sm[ib + 2], d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
        const cpx = x - Sm[ic], cpy = y - Sm[ic + 1], cpz = z - Sm[ic + 2], d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
        let u, w;                              // closest point a + u ab + w ac (Ericson, Real-Time Collision Detection 5.1.5)
        const vc = d1 * d4 - d3 * d2, vb = d5 * d2 - d1 * d6, va = d3 * d6 - d5 * d4;
        if (d1 <= 0 && d2 <= 0) { u = 0; w = 0; }
        else if (d3 >= 0 && d4 <= d3) { u = 1; w = 0; }
        else if (vc <= 0 && d1 >= 0 && d3 <= 0) { u = d1 / (d1 - d3); w = 0; }
        else if (d6 >= 0 && d5 <= d6) { u = 0; w = 1; }
        else if (vb <= 0 && d2 >= 0 && d6 <= 0) { u = 0; w = d2 / (d2 - d6); }
        else if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); u = 1 - w; }
        else { const dn = 1 / (va + vb + vc); u = vb * dn; w = vc * dn; }
        const cx = ax + u * abx + w * acx, cy = ay + u * aby + w * acy, cz = az + u * abz + w * acz, dd = (x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2;
        let nx = aby * acz - abz * acy, ny = abz * acx - abx * acz, nz = abx * acy - aby * acx; const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
        if (dd < best - 1e-12) { best = dd; PN[0] = nx; PN[1] = ny; PN[2] = nz; e = (x - cx) * nx + (y - cy) * ny + (z - cz) * nz; }
        else if (dd <= best + 1e-12) { PN[0] += nx; PN[1] += ny; PN[2] += nz; const l = Math.hypot(PN[0], PN[1], PN[2]) || 1; e = Math.sign((x - cx) * PN[0] + (y - cy) * PN[1] + (z - cz) * PN[2]) * Math.sqrt(dd); PN[0] /= l; PN[1] /= l; PN[2] /= l; }
      }
      return e;
    }
    function pressIntoSkin(items, Sm, Sn, nv, F, VF) {   // items: [geometry, normals computed from the shape?]
      // each muscle vertex keeps the skin vertex nearest it (or -1: deep inside), found afresh every PRESS_EVERY
      // frames; the side it is on comes from the closest point of the faces around that vertex, so it is exact
      // on ridges and where two skin surfaces face each other
      const fresh = pressFrame++ % PRESS_EVERY === 0 || items.some(([g]) => !PRESS_NEAR.has(g));
      let grid = null;
      if (fresh) {
        const c = PRESS_CELL, lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
        for (let v = 0; v < nv; v++) for (let t = 0; t < 3; t++) { const x = Sm[3 * v + t]; if (x < lo[t]) lo[t] = x; if (x > hi[t]) hi[t] = x; }
        const nx = Math.ceil((hi[0] - lo[0]) / c) + 1, ny = Math.ceil((hi[1] - lo[1]) / c) + 1, nz = Math.ceil((hi[2] - lo[2]) / c) + 1, N = nx * ny * nz;
        if (!PRESS_BUF.head || PRESS_BUF.head.length < N) Object.assign(PRESS_BUF, { head: new Int32Array(N), near: new Uint8Array(N) });
        // the grid holds the skin vertices and every face's centroid (as one of its corners), so a big
        // flat face is found even where its corners are far away
        const nf = F.length / 3, np_ = nv + nf;
        if (!PRESS_BUF.next || PRESS_BUF.next.length < np_) Object.assign(PRESS_BUF, { next: new Int32Array(np_), px: new Float32Array(3 * np_), pv: new Int32Array(np_) });
        const { head, near, next, px, pv } = PRESS_BUF;
        head.fill(-1, 0, N); near.fill(0, 0, N);
        for (let v = 0; v < nv; v++) { px[3 * v] = Sm[3 * v]; px[3 * v + 1] = Sm[3 * v + 1]; px[3 * v + 2] = Sm[3 * v + 2]; pv[v] = v; }
        for (let f = 0; f < nf; f++) { const a = 3 * F[3 * f], b = 3 * F[3 * f + 1], cc = 3 * F[3 * f + 2], k = 3 * (nv + f);
          px[k] = (Sm[a] + Sm[b] + Sm[cc]) / 3; px[k + 1] = (Sm[a + 1] + Sm[b + 1] + Sm[cc + 1]) / 3; px[k + 2] = (Sm[a + 2] + Sm[b + 2] + Sm[cc + 2]) / 3; pv[nv + f] = F[3 * f]; }
        for (let v = 0; v < np_; v++) { const q = ((Math.floor((px[3 * v] - lo[0]) / c) * ny) + Math.floor((px[3 * v + 1] - lo[1]) / c)) * nz + Math.floor((px[3 * v + 2] - lo[2]) / c); next[v] = head[q]; head[q] = v; }
        for (let q = 0; q < N; q++) if (head[q] >= 0) {  // cells within one cell of the skin
          const i = Math.floor(q / (ny * nz)), j = Math.floor(q / nz) % ny, k = q % nz;
          for (let a = Math.max(0, i - 1); a <= Math.min(nx - 1, i + 1); a++) for (let b = Math.max(0, j - 1); b <= Math.min(ny - 1, j + 1); b++)
            for (let d = Math.max(0, k - 1); d <= Math.min(nz - 1, k + 1); d++) near[(a * ny + b) * nz + d] = 1;
        }
        grid = { c, lo, nx, ny, nz, head, near, next, px, pv };
      }
      for (const [g, shaped] of items) {
        const P = g.attributes.position.array; let moved = false;
        let A = PRESS_NEAR.get(g); if (!A || A.length !== P.length / 3) { A = new Int32Array(P.length / 3).fill(-1); PRESS_NEAR.set(g, A); }
        for (let v = 0, w = 0; v < P.length; v += 3, w++) {
          const x = P[v], y = P[v + 1], z = P[v + 2];
          if (grid) {                             // refresh: the nearest skin vertex within two cells
            A[w] = -1;
            const { c, lo, nx, ny, nz, head, near, next, px, pv } = grid, i = Math.floor((x - lo[0]) / c), j = Math.floor((y - lo[1]) / c), k = Math.floor((z - lo[2]) / c);
            if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz || !near[(i * ny + j) * nz + k]) continue;   // deep inside
            let bd = 4 * c * c;
            for (let a = Math.max(0, i - 1); a <= Math.min(nx - 1, i + 1); a++) for (let b = Math.max(0, j - 1); b <= Math.min(ny - 1, j + 1); b++)
              for (let d = Math.max(0, k - 1); d <= Math.min(nz - 1, k + 1); d++)
                for (let q = head[(a * ny + b) * nz + d]; q >= 0; q = next[q]) {
                  const dx = px[3 * q] - x, dy = px[3 * q + 1] - y, dz = px[3 * q + 2] - z, d2 = dx * dx + dy * dy + dz * dz;
                  if (d2 < bd) { bd = d2; A[w] = pv[q]; }
                }
          }
          const q = A[w]; if (q < 0) continue;
          const qx = x - Sm[3 * q], qy = y - Sm[3 * q + 1], qz = z - Sm[3 * q + 2];
          if (qx * qx + qy * qy + qz * qz < 4e-4 && qx * Sn[3 * q] + qy * Sn[3 * q + 1] + qz * Sn[3 * q + 2] < -0.012) continue;   // well inside
          const e = skinSide(x, y, z, q, Sm, F, VF) + PRESS_MARGIN;
          if (e > 0) { P[v] -= e * PN[0]; P[v + 1] -= e * PN[1]; P[v + 2] -= e * PN[2]; moved = true; }
        }
        if (moved) g.attributes.position.needsUpdate = true;
        if (shaped || moved) g.computeVertexNormals();
      }
    }
    // bone parts in their bone's frame, for the skin's depth over bone: mirror of skeleton_parts.part_sdf
    function prepPart(h) {
      const o = { b: h[0], k: h[1] }, pts = (i0) => { const P = []; for (let i = i0; i + 2 < h.length; i += 3) P.push([h[i], h[i + 1], h[i + 2]]); return P; };
      if (o.k === 0) { o.a = h.slice(2, 5); o.e = h.slice(5, 8); o.r = h[8]; }
      else if (o.k === 1) { o.c = h.slice(2, 5); o.s = h.slice(5, 8); }
      else if (o.k === 2) { o.r = h[2]; o.p = pts(3); }
      else if (o.k === 3) { o.L = h[2]; o.rs = h[3]; o.re = h[4]; }
      else {                                     // a planar convex polygon of thickness th
        o.th = h[2]; const P = pts(3), n = P.length, c = [0, 1, 2].map((q) => P.reduce((a, p) => a + p[q], 0) / n), nn = [0, 0, 0];
        for (let i = 0; i < n; i++) { const a = P[i], b = P[(i + 1) % n];            // Newell's normal
          nn[0] += (a[1] - b[1]) * (a[2] + b[2]); nn[1] += (a[2] - b[2]) * (a[0] + b[0]); nn[2] += (a[0] - b[0]) * (a[1] + b[1]); }
        const nl = Math.hypot(...nn) || 1, N = nn.map((x) => x / nl), d0 = [P[0][0] - c[0], P[0][1] - c[1], P[0][2] - c[2]], dd = dot3(d0, N);
        let e1 = [d0[0] - dd * N[0], d0[1] - dd * N[1], d0[2] - dd * N[2]]; const el = Math.hypot(...e1) || 1; e1 = e1.map((x) => x / el);
        const e2 = [N[1] * e1[2] - N[2] * e1[1], N[2] * e1[0] - N[0] * e1[2], N[0] * e1[1] - N[1] * e1[0]];
        Object.assign(o, { c, n: N, e1, e2, q: P.map((p) => { const d = [p[0] - c[0], p[1] - c[1], p[2] - c[2]]; return [dot3(d, e1), dot3(d, e2)]; }) });
      }
      return o;
    }
    const segSD = (l, a, b, r) => { const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], t = Math.min(1, Math.max(0, ((l[0] - a[0]) * ab[0] + (l[1] - a[1]) * ab[1] + (l[2] - a[2]) * ab[2]) / ((ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2) || 1e-12)));
      return Math.hypot(l[0] - a[0] - t * ab[0], l[1] - a[1] - t * ab[1], l[2] - a[2] - t * ab[2]) - r; };
    function partSD(o, l) {                      // signed distance (m) from bone-frame point l to part o
      if (o.k === 0) return segSD(l, o.a, o.e, o.r);
      if (o.k === 1) return (Math.hypot((l[0] - o.c[0]) / o.s[0], (l[1] - o.c[1]) / o.s[1], (l[2] - o.c[2]) / o.s[2]) - 1) * Math.min(o.s[0], o.s[1], o.s[2]);
      if (o.k === 2) { let d = Infinity; for (let i = 0; i + 1 < o.p.length; i++) d = Math.min(d, segSD(l, o.p[i], o.p[i + 1], o.r)); return d; }
      if (o.k === 3) { const x = Math.min(o.L, Math.max(0, l[0])), t = x / o.L, R = o.rs + (o.re - o.rs) * (Math.exp(-((t / 0.13) ** 2)) + Math.exp(-(((1 - t) / 0.13) ** 2))), rho = Math.hypot(l[1], l[2]);
        return l[0] === x ? rho - R : Math.hypot(l[0] - x, Math.max(rho - R, 0)); }
      const d = [l[0] - o.c[0], l[1] - o.c[1], l[2] - o.c[2]], w = dot3(d, o.n), u = dot3(d, o.e1), v = dot3(d, o.e2), q = o.q, n = q.length;
      let de = Infinity, pos = true, neg = true;
      for (let i = 0; i < n; i++) { const a = q[i], b = q[(i + 1) % n], abx = b[0] - a[0], aby = b[1] - a[1], t = Math.min(1, Math.max(0, ((u - a[0]) * abx + (v - a[1]) * aby) / ((abx * abx + aby * aby) || 1e-12)));
        de = Math.min(de, Math.hypot(u - a[0] - t * abx, v - a[1] - t * aby)); const cr = abx * (v - a[1]) - aby * (u - a[0]); if (cr < 0) pos = false; if (cr > 0) neg = false; }
      const hw = Math.abs(w) - 0.5 * o.th;
      return pos || neg ? hw : Math.hypot(de, Math.max(hw, 0));
    }
    function bandHalf(R, s, a) {               // a band's mid-surface point and half-thickness at arc fraction s, fibre a
      const S = R.s; let j = 0; while (j < S.length - 2 && S[j + 1] < s) j++;
      if (!R.inn[j].length || !R.inn[j + 1].length) return null;
      const f = Math.min(1, Math.max(0, (s - S[j]) / ((S[j + 1] - S[j]) || 1))), nb = R.inn[j].length;
      const q = Math.min(nb - 1.000001, Math.max(0, (a + 1) / 2 * (nb - 1))), q0 = Math.floor(q), g = q - q0;
      const at = (k) => { const lo = R.inn[k][q0] * (1 - g) + R.inn[k][q0 + 1] * g, hi = R.out[k][q0] * (1 - g) + R.out[k][q0 + 1] * g;
        return [bandPoint(R.sector, R.fr, R.xk[k], a, 0.5 * (lo + hi)), 0.5 * (hi - lo)]; };
      const [p0, h0] = at(j), [p1, h1] = at(j + 1);
      return [[0, 1, 2].map((t) => p0[t] * (1 - f) + p1[t] * f), h0 * (1 - f) + h1 * f];
    }
    function rings(pts, lt, sp, C, caps, comp) {
      const n = pts.length, ls = [], cum = [0];
      for (let j = 0; j + 1 < n; j++) { const d = Math.hypot(pts[j + 1][0] - pts[j][0], pts[j + 1][1] - pts[j][1], pts[j + 1][2] - pts[j][2]); ls.push(d); cum.push(cum[j] + d); }
      const L = cum[n - 1], lb = Math.min(Math.max((L - lt) * (1 + 2 * Math.sin(sp.pen)), 0.45 * L), 0.9 * L), tp = 0.25 * (L - lb);
      const rmax = Math.sqrt(sp.vol / (Math.PI * lb * C.C)), [n0, n1, n2] = C.n, S = [];
      for (let i = 0; i < n0; i++) S.push(tp * i / n0);
      for (let i = 0; i < n1; i++) S.push(tp + lb * i / (n1 - 1));
      for (let i = 0; i < n2; i++) S.push(tp + lb + (L - tp - lb) * (i + 1) / n2);
      const out = { c: [], r: [], s: [], belly: [] };
      let j = 0;
      for (const s of S) {
        while (j < ls.length - 1 && cum[j + 1] <= s) j++;
        const f = (s - cum[j]) / (ls[j] || 1e-12), u = Math.min(1, Math.max(0, (s - tp) / lb)), bl = s >= tp - 1e-12 && s <= tp + lb + 1e-12;
        out.c.push([0, 1, 2].map((t) => pts[j][t] + (pts[j + 1][t] - pts[j][t]) * f));
        out.r.push(bl ? Math.max(sp.rt, rmax * Math.sin(Math.PI * u) ** C.exp) : sp.rt); out.s.push(s / L); out.belly.push(bl);
      }
      const nl = out.r.length - 1;
      if (!out.belly[0]) out.r[0] = 1.5 * sp.rt;                  // entheses: tendons flare into the bone
      if (!out.belly[nl]) out.r[nl] = 1.5 * sp.rt;
      if (caps && !comp) for (const cp of caps) for (let k = 0; k <= nl; k++) if (out.belly[k]) pushOne(out.c[k], 0.45 * out.r[k], cp);
      return out;
    }
    // sheet muscle: mirror of anatomy.sheet_rings (half-width E(s) from origin to insertion extent, lens thickness t(s))
    function sheetRings(pts, lt, sp, C, eo, ei, caps, AO, AI) {   // AO, AI: the fibres' anchors on bone (world), or none
      const R = rings(pts, lt, sp, C), n = R.c.length;
      let L = 0; for (let j = 0; j + 1 < pts.length; j++) L += Math.hypot(pts[j + 1][0] - pts[j][0], pts[j + 1][1] - pts[j][1], pts[j + 1][2] - pts[j][2]);
      const s = R.s.map((x) => x * L), ds = s.map((_, i) => (i === 0 ? s[1] - s[0] : i === n - 1 ? s[n - 1] - s[n - 2] : 0.5 * (s[i + 1] - s[i - 1])));
      let lb = 0, tp = Infinity; for (let i = 0; i < n; i++) if (R.belly[i]) { lb += ds[i]; tp = Math.min(tp, s[i]); }
      const E = [], Hs = [], prof = []; let sum = 0;
      for (let i = 0; i < n; i++) {
        const f = R.s[i], e = [0, 1, 2].map((q) => (1 - f) * eo[q] + f * ei[q]), H = Math.hypot(...e), hs = Math.max(H, R.belly[i] ? 0.6 * R.r[i] : sp.rt);
        let dir;
        if (H > 1e-9) dir = e.map((v) => v / H);
        else { const a = R.c[Math.max(0, i - 1)], b = R.c[Math.min(n - 1, i + 1)], t = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]; let p = [-t[2], 0, t[0]]; if (Math.hypot(...p) < 1e-9) p = [0, t[2], -t[1]]; const pl = Math.hypot(...p) || 1; dir = p.map((v) => v / pl); }
        E.push(dir.map((v) => v * hs)); Hs.push(hs);
        const pr = R.belly[i] ? Math.sin(Math.PI * Math.min(1, Math.max(0, (s[i] - tp) / (lb || 1e-9)))) ** C.exp : 0; prof.push(pr); sum += hs * pr * ds[i];
      }
      const t0 = sp.vol / Math.max(Math.PI / 2 * sum, 1e-12);
      R.t = Hs.map((hs, i) => Math.max(C.apo, R.belly[i] ? Math.min(Math.max(t0 * prof[i], hs <= sp.rt * 1.01 ? 2 * sp.rt : 0), 2 * hs) : (hs > 1.5 * sp.rt ? C.apo : 2 * sp.rt)));
      if (caps) for (const cp of caps) for (let k = 0; k < n; k++) if (R.belly[k]) pushOne(R.c[k], 0.4 * R.t[k], cp);   // the sheet lies on the bone
      R.E = E; R.r = R.t.map((x) => 0.5 * x);
      if (AO && AI) {                          // mirror of anatomy.anchor_offsets: each fibre starts and ends on bone
        const na = AO.length, U = AO.map((_, k) => -1 + 2 * k / (na - 1)), c0 = R.c[0], c1 = R.c[n - 1], e0 = E[0], e1 = E[n - 1];
        R.dO = AO.map((p, k) => [0, 1, 2].map((q) => p[q] - (c0[q] + U[k] * e0[q])));
        R.dI = AI.map((p, k) => [0, 1, 2].map((q) => p[q] - (c1[q] + U[k] * e1[q])));
      }
      return R;
    }
    const anchorCorr = (R, f, k) => (R.dO ? [0, 1, 2].map((q) => (1 - f) * R.dO[k][q] + f * R.dI[k][q]) : [0, 0, 0]);
    const rotv = (r, v) => [r[0] * v[0] + r[3] * v[1] + r[6] * v[2], r[1] * v[0] + r[4] * v[1] + r[7] * v[2], r[2] * v[0] + r[5] * v[1] + r[8] * v[2]];
    function wrapOut(p, margin, wE, band = 0) {       // onto the ribcage / belly shell (+ margin); within band: snap
      for (const e of wE) {
        const d = [p[0] - e.c[0], p[1] - e.c[1], p[2] - e.c[2]], r = e.r;
        const q = [(r[0] * d[0] + r[1] * d[1] + r[2] * d[2]) / e.a[0], (r[3] * d[0] + r[4] * d[1] + r[5] * d[2]) / e.a[1], (r[6] * d[0] + r[7] * d[1] + r[8] * d[2]) / e.a[2]];
        const k = Math.hypot(...q), tg = 1 + margin / Math.min(...e.a);
        if (k < tg || (k - tg) * Math.min(...e.a) < band) { const f = tg / Math.max(k, 1e-9), qq = [q[0] * f * e.a[0], q[1] * f * e.a[1], q[2] * f * e.a[2]]; const w = rotv(r, qq); p = [e.c[0] + w[0], e.c[1] + w[1], e.c[2] + w[2]]; }
      }
      return p;
    }
    const MAT_SHEET = std(0xffffff, { vertexColors: true, roughness: 0.55, side: THREE.DoubleSide });
    function sheetMesh(nr, na) {
      const g = new THREE.BufferGeometry(), nv = 2 * nr * na;
      for (const [k, n] of [['position', 3], ['color', 3]]) g.setAttribute(k, new THREE.BufferAttribute(new Float32Array(nv * n), n).setUsage(THREE.DynamicDrawUsage));
      const id = (side, i, j) => (side * nr + i) * na + j, idx = [];
      for (let i = 0; i + 1 < nr; i++) for (let j = 0; j + 1 < na; j++) {
        const a = id(0, i, j), b = id(0, i + 1, j), c = id(0, i + 1, j + 1), d = id(0, i, j + 1); idx.push(a, b, d, b, c, d);
        const A = id(1, i, j), B = id(1, i + 1, j), Cc = id(1, i + 1, j + 1), Dd = id(1, i, j + 1); idx.push(A, Dd, B, B, Dd, Cc);
      }
      g.setIndex(idx); return new THREE.Mesh(g, MAT_SHEET);
    }
    function sectorMesh(nb, na) {             // a compartment belly: lens-sector surface over its bone
      const g = new THREE.BufferGeometry(), nv = nb * na;
      for (const [k, n] of [['position', 3], ['color', 3]]) g.setAttribute(k, new THREE.BufferAttribute(new Float32Array(nv * n), n).setUsage(THREE.DynamicDrawUsage));
      const idx = []; for (let i = 0; i + 1 < nb; i++) for (let j = 0; j + 1 < na; j++) { const a = i * na + j, b = a + na; idx.push(a, b, a + 1, a + 1, b, b + 1); }
      g.setIndex(idx); return new THREE.Mesh(g, MAT_SHEET);
    }
    const NS = 10;
    function muscleMesh(nr) {
      const g = new THREE.BufferGeometry(), nv = nr * NS;
      for (const [k, n] of [['position', 3], ['normal', 3], ['color', 3]]) g.setAttribute(k, new THREE.BufferAttribute(new Float32Array(nv * n), n).setUsage(THREE.DynamicDrawUsage));
      const idx = []; for (let i = 0; i + 1 < nr; i++) for (let j = 0; j < NS; j++) { const a = i * NS + j, b = i * NS + (j + 1) % NS, c = a + NS, d = b + NS; idx.push(a, c, b, b, c, d); }
      g.setIndex(idx); return new THREE.Mesh(g, MAT.muscle);
    }
    function build(MM) {
      const AN = MM.anatomy, root = new THREE.Group(), L = { bones: new THREE.Group(), muscles: new THREE.Group(), organs: new THREE.Group() };
      Object.values(L).forEach((g) => root.add(g));
      const bi = Object.fromEntries(MM.bones.map((b, i) => [b.name, i]));
      const bones = MM.bones.map((b, i) => { const o = boneGroup(b.name, AN, MM); L.bones.add(o.g); return { g: o.g, soft: o.soft, i }; });
      // connective tissue spanning joints: capsules, ligaments and ligament chains, stretched between two bones each frame
      const linkG = new THREE.Group(), unitCyl = new THREE.CylinderGeometry(1, 1, 1, 8, 1, false), links = []; root.add(linkG);
      for (const l of AN.links || []) for (const [a, b] of (l.t === 'chain' ? l.p.slice(0, -1).map((q, i) => [q, l.p[i + 1]]) : [[l.a, l.b]])) {
        const mesh = new THREE.Mesh(unitCyl, l.m === 'capsule' ? MAT_CAPS : MAT_LIG); mesh.matrixAutoUpdate = false; linkG.add(mesh); links.push({ mesh, a, b, r: l.r }); }
      const organs = AN.organs.map((o) => { const g = new THREE.Group(); g.matrixAutoUpdate = false; g.add(place(sphere, MAT[o.name] || MAT.chest, o.c, o.a)); L.organs.add(g); return { g, i: bi[o.bone] }; });
      const nr = AN.const.n[0] + AN.const.n[1] + AN.const.n[2];
      const muscles = MM.muscles.map((mu, i) => { const comp = AN.muscles[i].comp, m = mu.sheet && !comp ? sheetMesh(nr, AN.const.na) : muscleMesh(nr); L.muscles.add(m);
        const sec = comp ? sectorMesh(AN.const.n[1], AN.const.bu.length) : null; if (sec) L.muscles.add(sec);
        return { m, sec, comp, layer: AN.muscles[i].layer, mu, sp: AN.muscles[i], root: mu.path[0][0], sheet: comp ? null : mu.sheet }; });
      const order = MM.muscles.map((_, i) => i).filter((i) => AN.muscles[i].layer == null)
        .concat(MM.muscles.map((_, i) => i).filter((i) => AN.muscles[i].layer != null).sort((a, b) => AN.muscles[a].layer - AN.muscles[b].layer || a - b));
      // skin
      const S = AN.skin, q = b64(S.pos, Uint16Array), nv = S.n, rest = new Float32Array(nv * 3);
      for (let v = 0; v < nv; v++) for (let t = 0; t < 3; t++) rest[3 * v + t] = S.lo[t] + q[3 * v + t] / 65535 * (S.hi[t] - S.lo[t]);
      const faces = nv < 65536 ? b64(S.faces, Uint16Array) : b64(S.faces, Uint32Array);
      const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(rest.slice(), 3).setUsage(THREE.DynamicDrawUsage));
      sg.setIndex(new THREE.BufferAttribute(faces, 1)); sg.computeVertexNormals();
      const restN = sg.attributes.normal.array.slice();
      const fat = b64(S.fat, Uint8Array), fc = new Float32Array(nv * 3), c0 = new THREE.Color(PAL.fat[0]), c1 = new THREE.Color(PAL.fat[1]), cs = new THREE.Color(PAL.skin);
      for (let v = 0; v < nv; v++) { const x = Math.min(1, fat[v] / 255 * 0.02 / 0.008), c = fat[v] ? c0.clone().lerp(c1, x) : cs; fc[3 * v] = c.r; fc[3 * v + 1] = c.g; fc[3 * v + 2] = c.b; }
      sg.setAttribute('color', new THREE.BufferAttribute(fc, 3));
      const skin = new THREE.Mesh(sg, MAT.skin); skin.renderOrder = 2; root.add(skin);
      // fur: per-vertex length from the bone the skin moves with; the rest position and normal anchor the strands
      const bi0 = b64(S.bi, Uint8Array), fl = new Float32Array(nv);
      for (let v = 0; v < nv; v++) fl[v] = FUR_LEN[kindOf(MM.bones[bi0[4 * v]].name)] ?? 0.012;
      sg.setAttribute('furLen', new THREE.BufferAttribute(fl, 1)); sg.setAttribute('restPos', new THREE.BufferAttribute(rest, 3)); sg.setAttribute('restNrm', new THREE.BufferAttribute(restN, 3));
      const fur = new THREE.Group(); FURMAT.forEach((m, i) => { const o = new THREE.Mesh(sg, m); o.renderOrder = 3 + i; o.frustumCulled = false; fur.add(o); }); root.add(fur);
      const restInv = S.rest.map((r) => mat4(r).invert());
      // the skin over bone: for each tracked part under a skin vertex, the part's point nearest the vertex at rest and
      // the direction from it to the vertex (bone frame). Each frame the vertex stays on that side of that point by
      // KEEP of its rest depth -- one-sided, so skin that slides past a rib to the inside is put back outside it
      const HP = S.hp ? S.hp.map(prepPart) : null, KP = S.kp ? b64(S.kp, Uint16Array) : null, KD = S.kd ? b64(S.kd, Uint8Array) : null, NK = S.nk || 3;
      let KA = null;
      if (HP && KP) {
        KA = new Float32Array(nv * NK * 6);
        for (let v = 0; v < nv; v++) for (let j = 0; j < NK; j++) {
          const q = KP[NK * v + j]; if (q === 65535) continue;
          const o = HP[q], f = S.rest[o.b], d = [rest[3 * v] - f[9], rest[3 * v + 1] - f[10], rest[3 * v + 2] - f[11]];
          const l = [f[0] * d[0] + f[1] * d[1] + f[2] * d[2], f[3] * d[0] + f[4] * d[1] + f[5] * d[2], f[6] * d[0] + f[7] * d[1] + f[8] * d[2]];
          const sd = partSD(o, l), e = 1e-4, g = [0, 1, 2].map((t) => { const a = l.slice(), b = l.slice(); a[t] += e; b[t] -= e; return partSD(o, a) - partSD(o, b); });
          const gn = Math.hypot(...g) || 1e-12, u = g.map((x) => x / gn), uw = [f[0] * u[0] + f[3] * u[1] + f[6] * u[2], f[1] * u[0] + f[4] * u[1] + f[7] * u[2], f[2] * u[0] + f[5] * u[1] + f[8] * u[2]];
          if (uw[0] * restN[3 * v] + uw[1] * restN[3 * v + 1] + uw[2] * restN[3 * v + 2] < 0.5) { KP[NK * v + j] = 65535; continue; }   // not under this skin
          const k = 6 * (NK * v + j); KA[k] = l[0] - sd * u[0]; KA[k + 1] = l[1] - sd * u[1]; KA[k + 2] = l[2] - sd * u[2]; KA[k + 3] = u[0]; KA[k + 4] = u[1]; KA[k + 5] = u[2];
        }
      }
      const applyR = (b, p) => { const r = S.rest[bi[b]]; return [r[9] + r[0] * p[0] + r[3] * p[1] + r[6] * p[2], r[10] + r[1] * p[0] + r[4] * p[1] + r[7] * p[2], r[11] + r[2] * p[0] + r[5] * p[1] + r[8] * p[2]]; };
      const restComp = compAll(AN, (i) => rings(MM.muscles[i].path.map(([b, p]) => applyR(b, p)), MM.muscles[i].lts, AN.muscles[i], AN.const), (b) => S.rest[bi[b]]);
      const restRings = MM.muscles.map((mu, i) => { const pts = mu.path.map(([b, p]) => applyR(b, p));
        const caps = [...new Set(mu.path.map((q) => q[0]))].filter((b) => AN.shafts[b]).map((b) => [applyR(b, [0, 0, 0]), applyR(b, [AN.shafts[b][0], 0, 0]), AN.shafts[b][1]]);
        if (AN.muscles[i].comp) return restComp[i];
        const an = AN.muscles[i].anch;
        return mu.sheet ? sheetRings(pts, mu.lts, AN.muscles[i], AN.const, rotv(S.rest[bi[mu.path[0][0]]], mu.sheet.o), rotv(S.rest[bi[mu.path[mu.path.length - 1][0]]], mu.sheet.i), caps,
                                     an && an[0].map(([b, p]) => applyR(b, p)), an && an[1].map(([b, p]) => applyR(b, p)))
          : rings(pts, mu.lts, AN.muscles[i], AN.const, caps); });
      return { root, L, bones, organs, muscles, order, skin, fur, linkG, links, hpBone: HP ? HP.map((o) => o.b) : null, sk: { rest, restN, restInv, restRings, bi: b64(S.bi, Uint8Array),
        ka: KA, kp: KP, kd: KD, keep: S.keep || 0.85, nk: NK, bw: b64(S.bw, Uint8Array), mi: b64(S.mi, Uint16Array), mw: b64(S.mw, Uint8Array), ms: b64(S.ms, Uint8Array), mr: b64(S.mr, Uint16Array), ma: b64(S.ma, Uint8Array), nv }, C: AN.const, info: S };
    }
    // shell fur: the skin drawn again, offset along its normals, strands anchored to the rest position
    const NSHELL = 14;
    const FUR_LEN = { thorax: 0.022, lumbar: 0.024, pelvis: 0.022, neck: 0.026, head: 0.007, tail: 0.035, scapula: 0.02, humerus: 0.016,
      femur: 0.018, antebrachium: 0.009, tibia: 0.01, manus: 0.005, pes: 0.005 };
    const kindOf = (name) => { const b = name.replace(/^[LRC][FH1-9]_/, ''); return /^(neck|tail|lumbar)/.test(b) ? b.split('_')[0] : b; };
    const COAT = { top: new THREE.Color(0x5a3c24), side: new THREE.Color(0xa47448), belly: new THREE.Color(0xe2c9a4) };
    function furMaterial(h) {
      const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 });
      m.onBeforeCompile = (sh) => {
        Object.assign(sh.uniforms, { uH: { value: h }, uDens: { value: 520 }, uComb: { value: new THREE.Vector3(-0.55, -0.35, 0) },
          uTop: { value: COAT.top }, uSide: { value: COAT.side }, uBelly: { value: COAT.belly } });
        sh.vertexShader = 'attribute float furLen; attribute vec3 restPos; attribute vec3 restNrm; varying vec3 vRest; varying float vUp; uniform float uH; uniform vec3 uComb;\n' +
          sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
            vec3 fdir = normalize(normal + uComb * (uH * uH * 1.6));
            transformed += fdir * furLen * uH; vRest = restPos; vUp = restNrm.y;`);
        sh.fragmentShader = `varying vec3 vRest; varying float vUp; uniform float uH; uniform float uDens; uniform vec3 uTop; uniform vec3 uSide; uniform vec3 uBelly;
          float hash13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }\n` +
          sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
            vec3 q = vRest * uDens, cell = floor(q); float r = hash13(cell);
            vec3 f = fract(q) - 0.5;
            if (uH > 0.0 && (r < uH * 0.92 || length(f) > 0.62 * (1.0 - uH) + 0.18)) discard;   // strands of random length, tapering
            vec3 coat = mix(uBelly, uSide, smoothstep(-0.55, -0.05, vUp)); coat = mix(coat, uTop, smoothstep(0.25, 0.8, vUp));
            diffuseColor.rgb = coat * (0.5 + 0.5 * uH) * (0.85 + 0.3 * hash13(cell + 17.0));`);
      };
      return m;
    }
    const FURMAT = Array.from({ length: NSHELL }, (_, i) => furMaterial((i + 1) / NSHELL));
    const SKIN_FUR = furMaterial(0.0);          // the skin under the fur: coat-coloured undercoat
    const built = new Map();
    let shown = null;
    const tmpM = new THREE.Matrix4(), col = new THREE.Color(), tcol = new THREE.Color(PAL.tendon), mLo = new THREE.Color(0x9a4a44), mHi = new THREE.Color(0xff5a2e);
    function pointAtA(R, s, a) { const p = pointAt(R, s); if (!R.E) return p; const S = R.s; let j = 0; while (j < S.length - 2 && S[j + 1] < s) j++; const f = Math.min(1, Math.max(0, (s - S[j]) / ((S[j + 1] - S[j]) || 1)));
      let d = [0, 0, 0];
      if (R.dO) { const na = R.dO.length, x = Math.min(na - 1.000001, Math.max(0, (a + 1) / 2 * (na - 1))), k = Math.floor(x), g = x - k, c0 = anchorCorr(R, s, k), c1 = anchorCorr(R, s, k + 1); d = [0, 1, 2].map((q) => c0[q] * (1 - g) + c1[q] * g); }
      return [0, 1, 2].map((q) => p[q] + a * (R.E[j][q] * (1 - f) + R.E[j + 1][q] * f) + d[q]); }
    function pointAt(R, s) { const S = R.s; let j = 0; while (j < S.length - 2 && S[j + 1] < s) j++; const f = Math.min(1, Math.max(0, (s - S[j]) / ((S[j + 1] - S[j]) || 1))), a = R.c[j], b = R.c[j + 1]; return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]; }
    function radiusAt(R, s) { const S = R.s; let j = 0; while (j < S.length - 2 && S[j + 1] < s) j++; const f = Math.min(1, Math.max(0, (s - S[j]) / ((S[j + 1] - S[j]) || 1))); return R.r[j] * (1 - f) + R.r[j + 1] * f; }
    function draw(MM, s, pose, k, k1, w, target, opt, W, H, dpr) {
      if (!MM.anatomy) return false;
      if (!built.has(MM)) built.set(MM, build(MM));
      const B = built.get(MM);
      if (shown !== B) { if (shown) scene.remove(shown.root); scene.add(B.root); shown = B; }
      if (gridColor !== T.grid) { if (grid) scene.remove(grid); grid = new THREE.GridHelper(3.2, 32, T.grid, T.grid); scene.add(grid); gridColor = T.grid; }
      grid.position.set(Math.round(target[0] * 10) / 10, 0, 0);
      renderer.setClearColor(T.surface);
      B.L.bones.visible = opt.bones; B.L.muscles.visible = opt.muscles; B.L.organs.visible = opt.organs; B.skin.visible = opt.skin; if (!opt.skin) B.fur.visible = false;
      const mats = pose.map((r) => mat4(r));
      B.bones.forEach((o) => { o.g.matrix.copy(mats[o.i]); o.g.matrixWorldNeedsUpdate = true; o.soft.visible = opt.lig; });
      B.linkG.visible = opt.lig;
      if (opt.lig) for (const k of B.links) {
        const a = V3(apply(pose, k.a[0], k.a[1])), b = V3(apply(pose, k.b[0], k.b[1])), d = b.clone().sub(a), len = d.length() || 1e-6;
        k.mesh.matrix.compose(a.add(b).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(YUP, d.multiplyScalar(1 / len)), new THREE.Vector3(k.r, len, k.r)); k.mesh.matrixWorldNeedsUpdate = true;
      }
      B.organs.forEach((o) => { o.g.matrix.copy(mats[o.i]); o.g.matrixWorldNeedsUpdate = true; });
      // muscles: rings from this frame's path and tendon length
      const wE = (MM.anatomy.wrap || []).map((e) => ({ c: apply(pose, e.bone, e.c), r: pose[bidx[e.bone]], a: e.a }));
      let placed = [], thisL = [], curL = null, placedHash = null;
      const hashPlaced = (pl, c) => { const m = new Map(); for (const e of pl) { const k = `${Math.floor(e[0][0] / c)},${Math.floor(e[0][1] / c)},${Math.floor(e[0][2] / c)}`; (m.get(k) || m.set(k, []).get(k)).push(e); } return m; };
      const kern = B.C.kernel || 0.025, band = B.C.band || 0;
      const step = (o, i) => {
        const pts = o.mu.path.map(([b, p]) => apply(pose, b, p));
        const caps = [...new Set(o.mu.path.map((q) => q[0]))].filter((b) => MM.anatomy.shafts[b]).map((b) => [apply(pose, b, [0, 0, 0]), apply(pose, b, [MM.anatomy.shafts[b][0], 0, 0]), MM.anatomy.shafts[b][1]]);
        const lt = s.lt ? s.lt[i][k] * (1 - w) + s.lt[i][k1] * w : o.mu.lts;
        if (o.sheet) {
          const path = o.mu.path, an = o.sp.anch;
          const R = sheetRings(pts, lt, o.sp, B.C, rotv(pose[bidx[path[0][0]]], o.sheet.o), rotv(pose[bidx[path[path.length - 1][0]]], o.sheet.i), caps,
                               an && an[0].map(([b, p]) => apply(pose, b, p)), an && an[1].map(([b, p]) => apply(pose, b, p)));
          if (!opt.muscles) return R;
          const P = o.m.geometry.attributes.position.array, Cc = o.m.geometry.attributes.color.array, nr = R.c.length, na = B.C.na;
          const a = s.a[i][k] * (1 - w) + s.a[i][k1] * w; col.copy(mLo).lerp(mHi, Math.min(1, a * 1.6));
          for (let r = 0; r < nr; r++) {
            const p0 = R.c[Math.max(0, r - 1)], p1 = R.c[Math.min(nr - 1, r + 1)], T = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]], E = R.E[r];
            let n = [T[1] * E[2] - T[2] * E[1], T[2] * E[0] - T[0] * E[2], T[0] * E[1] - T[1] * E[0]]; const nl = Math.hypot(...n) || 1; n = n.map((v) => v / nl);
            const cc = R.belly[r] ? col : tcol, ht = 0.5 * R.t[r];
            for (let jj = 0; jj < na; jj++) {
              const aa = -1 + 2 * jj / (na - 1), h = ht * Math.sqrt(Math.max(0, 1 - aa * aa));
              const dc = anchorCorr(R, R.s[r], jj);
              let q = [R.c[r][0] + aa * E[0] + dc[0], R.c[r][1] + aa * E[1] + dc[1], R.c[r][2] + aa * E[2] + dc[2]];
              if (o.layer != null) {                  // rests on the deeper layers (mirror of anatomy.stack_sheet)
                const base = wrapOut(q, 0, wE, band); let need = 0;
                const ci = Math.floor(base[0] / kern), cj = Math.floor(base[1] / kern), ck = Math.floor(base[2] / kern);
                for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) for (let dk = -1; dk <= 1; dk++)
                  for (const [bp, top] of placedHash.get(`${ci + di},${cj + dj},${ck + dk}`) || []) if (top > need && Math.hypot(base[0] - bp[0], base[1] - bp[1], base[2] - bp[2]) < kern) need = top;
                q = wrapOut(q, need + h, wE, band); thisL.push([base, need + 2 * h]);
              } else if (o.sheet.wrap) q = wrapOut(q, h, wE);
              for (let side = 0; side < 2; side++) { const sg = side ? -1 : 1, v = 3 * ((side * nr + r) * na + jj);
                P[v] = q[0] + sg * h * n[0]; P[v + 1] = q[1] + sg * h * n[1]; P[v + 2] = q[2] + sg * h * n[2]; Cc[v] = cc.r; Cc[v + 1] = cc.g; Cc[v + 2] = cc.b; }
            }
          }
          const gg = o.m.geometry; gg.attributes.position.needsUpdate = gg.attributes.color.needsUpdate = true; gg.computeBoundingSphere();   // normals after the press
          return R;
        }
        const R = o.comp ? CR[i] : rings(pts, lt, o.sp, B.C, caps);
        if (o.sec) o.sec.visible = opt.muscles;
        if (!opt.muscles) return R;
        if (o.comp) {                                 // the muscle's outer surface over its band (deeper ones lie under it)
          const P = o.sec.geometry.attributes.position.array, Cc = o.sec.geometry.attributes.color.array, cm = o.comp, na = B.C.bu.length;
          const a0 = s.a[i][k] * (1 - w) + s.a[i][k1] * w; col.copy(mLo).lerp(mHi, Math.min(1, a0 * 1.6));
          let bi_ = 0;
          for (let r = 0; r < R.c.length; r++) {
            if (!R.belly[r]) continue;
            for (let jj = 0; jj < na; jj++) {
              const q = bandPoint(cm, R.fr, R.xk[r], B.C.bu[jj], R.out[r][jj] + 3e-4 * cm.depth), v = 3 * (bi_ * na + jj);   // superficial wins ties
              P[v] = q[0]; P[v + 1] = q[1]; P[v + 2] = q[2]; Cc[v] = col.r; Cc[v + 1] = col.g; Cc[v + 2] = col.b;
            }
            bi_++;
          }
          const gg = o.sec.geometry; gg.attributes.position.needsUpdate = gg.attributes.color.needsUpdate = true; gg.computeBoundingSphere();   // normals after the press
        }
        const P = o.m.geometry.attributes.position.array, N = o.m.geometry.attributes.normal.array, Cc = o.m.geometry.attributes.color.array;
        const a = s.a[i][k] * (1 - w) + s.a[i][k1] * w; col.copy(mLo).lerp(mHi, Math.min(1, a * 1.6));
        const nr = R.c.length, flat = o.sp.flat, sq = Math.sqrt(flat);
        // reference for the cross-section's thin axis: away from the root bone's axis (sheet muscles lie flat on it)
        const ra = apply(pose, o.root, [0, 0, 0]), rb = apply(pose, o.root, [MM.bones[bidx[o.root]].length, 0, 0]), mid = R.c[nr >> 1];
        const ab = [rb[0] - ra[0], rb[1] - ra[1], rb[2] - ra[2]], ab2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2 || 1;
        const tt = Math.max(0, Math.min(1, ((mid[0] - ra[0]) * ab[0] + (mid[1] - ra[1]) * ab[1] + (mid[2] - ra[2]) * ab[2]) / ab2));
        let nrm = [mid[0] - ra[0] - tt * ab[0], mid[1] - ra[1] - tt * ab[1], mid[2] - ra[2] - tt * ab[2]];
        if (Math.hypot(...nrm) < 1e-6) nrm = [0, 1, 0];
        for (let r = 0; r < nr; r++) {
          const p0 = R.c[Math.max(0, r - 1)], p1 = R.c[Math.min(nr - 1, r + 1)];
          let t = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]]; const tl = Math.hypot(...t) || 1; t = t.map((v) => v / tl);
          const dd = nrm[0] * t[0] + nrm[1] * t[1] + nrm[2] * t[2]; nrm = [nrm[0] - dd * t[0], nrm[1] - dd * t[1], nrm[2] - dd * t[2]];
          const nl = Math.hypot(...nrm) || 1; nrm = nrm.map((v) => v / nl);
          const bv = [t[1] * nrm[2] - t[2] * nrm[1], t[2] * nrm[0] - t[0] * nrm[2], t[0] * nrm[1] - t[1] * nrm[0]];
          const rr = o.comp && R.belly[r] ? o.sp.rt : R.r[r], sq2 = o.comp ? 1 : sq;
          const wide = R.belly[r] ? rr * sq2 : rr, thin = R.belly[r] ? rr / sq2 : rr;
          const cc = R.belly[r] ? col : tcol;
          for (let j = 0; j < NS; j++) {
            const ph = 2 * Math.PI * j / NS, cp = Math.cos(ph), sp = Math.sin(ph), v = 3 * (r * NS + j);
            for (let q = 0; q < 3; q++) { P[v + q] = R.c[r][q] + wide * cp * bv[q] + thin * sp * nrm[q]; N[v + q] = cp / wide * bv[q] + sp / thin * nrm[q]; }
            const nn = Math.hypot(N[v], N[v + 1], N[v + 2]) || 1; N[v] /= nn; N[v + 1] /= nn; N[v + 2] /= nn;
            Cc[v] = cc.r; Cc[v + 1] = cc.g; Cc[v + 2] = cc.b;
          }
        }
        const gg = o.m.geometry; gg.attributes.position.needsUpdate = gg.attributes.normal.needsUpdate = gg.attributes.color.needsUpdate = true; gg.computeBoundingSphere();
        return R;
      };
      const CR = compAll(MM.anatomy, (i) => {         // compartment muscles: all of a bone's bands at once
        const o = B.muscles[i], lt = s.lt ? s.lt[i][k] * (1 - w) + s.lt[i][k1] * w : o.mu.lts;
        return rings(o.mu.path.map(([b, p]) => apply(pose, b, p)), lt, o.sp, B.C);
      }, (b) => pose[bidx[b]]);
      const RR = new Array(B.muscles.length);
      for (const i of B.order) {                      // deeper layers first: the sheets above rest on them
        const o = B.muscles[i];
        if (o.layer != null && o.layer !== curL) { placed = placed.concat(thisL); thisL = []; curL = o.layer; placedHash = hashPlaced(placed, kern); }
        RR[i] = step(o, i);
      }
      // skin: bones' motion blended by the tissue under each vertex, plus the bulge of the belly under it
      if (opt.skin || opt.muscles) {                 // (the muscles are pressed under it even when it is hidden)
        const K = B.sk, Sm = B.skin.geometry.attributes.position.array, Sn = B.skin.geometry.attributes.normal.array, HPB = B.hpBone;
        const A = mats.map((m, b) => tmpM.multiplyMatrices(m, K.restInv[b]).elements.slice());
        for (let v = 0; v < K.nv; v++) {
          const x = K.rest[3 * v], y = K.rest[3 * v + 1], z = K.rest[3 * v + 2], nx0 = K.restN[3 * v], ny0 = K.restN[3 * v + 1], nz0 = K.restN[3 * v + 2];
          let px = 0, py = 0, pz = 0, nx = 0, ny = 0, nz = 0, ws = 0;
          for (let j = 0; j < 4; j++) {
            const wt = K.bw[4 * v + j]; if (!wt) continue; const e = A[K.bi[4 * v + j]]; ws += wt;
            px += wt * (e[0] * x + e[4] * y + e[8] * z + e[12]); py += wt * (e[1] * x + e[5] * y + e[9] * z + e[13]); pz += wt * (e[2] * x + e[6] * y + e[10] * z + e[14]);
            nx += wt * (e[0] * nx0 + e[4] * ny0 + e[8] * nz0); ny += wt * (e[1] * nx0 + e[5] * ny0 + e[9] * nz0); nz += wt * (e[2] * nx0 + e[6] * ny0 + e[10] * nz0);
          }
          ws = ws || 1; px /= ws; py /= ws; pz /= ws;
          const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
          const mi = K.mi[v];
          if (mi !== 65535 && K.mw[v]) {
            // follow the muscle under the vertex: its centreline's motion beyond what the bones' blend gives,
            // plus the belly's change in thickness along the normal
            const s = K.ms[v] / 255, mw = K.mw[v] / 255, aa = K.ma[v] / 255 * 2 - 1;
            const bh = RR[mi].band ? bandHalf(RR[mi], s, aa) : null, bh0 = bh ? bandHalf(K.restRings[mi], s, aa) : null;
            const c0 = bh0 ? bh0[0] : pointAtA(K.restRings[mi], s, aa), c = bh && bh0 ? bh[0] : pointAtA(RR[mi], s, aa);
            let cx = 0, cy = 0, cz = 0;
            for (let j = 0; j < 4; j++) { const wt = K.bw[4 * v + j]; if (!wt) continue; const e = A[K.bi[4 * v + j]];
              cx += wt * (e[0] * c0[0] + e[4] * c0[1] + e[8] * c0[2] + e[12]); cy += wt * (e[1] * c0[0] + e[5] * c0[1] + e[9] * c0[2] + e[13]); cz += wt * (e[2] * c0[0] + e[6] * c0[1] + e[10] * c0[2] + e[14]); }
            const d = (bh && bh0 ? bh[1] - bh0[1] : radiusAt(RR[mi], s) * (RR[mi].E ? Math.sqrt(Math.max(0, 1 - aa * aa)) : 1) - K.mr[v] / 1e4) * mw;
            px += mw * (c[0] - cx / ws) + nx * d; py += mw * (c[1] - cy / ws) + ny * d; pz += mw * (c[2] - cz / ws) + nz * d;
          }
          if (K.ka) for (let j = 0; j < K.nk; j++) {   // keeps its depth over the bones under it, on their outer side
            const q = K.kp[K.nk * v + j]; if (q === 65535) continue;
            const f = pose[HPB[q]], k = 6 * (K.nk * v + j), d = [px - f[9], py - f[10], pz - f[11]];
            const hgt = (f[0] * d[0] + f[1] * d[1] + f[2] * d[2] - K.ka[k]) * K.ka[k + 3] + (f[3] * d[0] + f[4] * d[1] + f[5] * d[2] - K.ka[k + 1]) * K.ka[k + 4] + (f[6] * d[0] + f[7] * d[1] + f[8] * d[2] - K.ka[k + 2]) * K.ka[k + 5];
            const want = K.keep * K.kd[K.nk * v + j] / 5e3;
            if (hgt < want) { const pu = want - hgt, u = [K.ka[k + 3], K.ka[k + 4], K.ka[k + 5]];
              px += pu * (f[0] * u[0] + f[3] * u[1] + f[6] * u[2]); py += pu * (f[1] * u[0] + f[4] * u[1] + f[7] * u[2]); pz += pu * (f[2] * u[0] + f[5] * u[1] + f[8] * u[2]); }
          }
          Sm[3 * v] = px; Sm[3 * v + 1] = py; Sm[3 * v + 2] = pz; Sn[3 * v] = nx; Sn[3 * v + 1] = ny; Sn[3 * v + 2] = nz;
        }
        const gg = B.skin.geometry; gg.attributes.position.needsUpdate = gg.attributes.normal.needsUpdate = true; gg.computeBoundingSphere();
        if (opt.muscles) pressIntoSkin(B.muscles.flatMap((o) => (o.sec ? [[o.m.geometry, false], [o.sec.geometry, true]] : [[o.m.geometry, !!o.sheet]])), Sm, Sn, K.nv,
                                       B.skin.geometry.index.array, B.skinVF || (B.skinVF = vertexFaces(B.skin.geometry.index.array, K.nv)));
        const tr = opt.opacity < 0.999; if (MAT.skin.transparent !== tr) { MAT.skin.transparent = tr; MAT.skin.needsUpdate = true; } MAT.skin.opacity = opt.opacity; MAT.skin.depthWrite = !tr;
        const furOn = opt.fur && !tr; B.fur.visible = furOn; B.skin.material = furOn ? SKIN_FUR : MAT.skin;
        if (MAT.skin.vertexColors !== opt.fat) { MAT.skin.vertexColors = opt.fat; MAT.skin.color.set(opt.fat ? 0xffffff : PAL.skin); MAT.skin.needsUpdate = true; }
      }
      // cutaway: drop the half of the shells nearest the camera
      const d = [Math.sin(cam.az), 0, Math.cos(cam.az)], rt = pose[bidx[MM.root || 'thorax']] || pose[0];
      clip.normal.set(-d[0], 0, -d[2]); clip.constant = d[0] * rt[9] + d[2] * rt[11];
      const cp = opt.cut ? [clip] : [];
      [MAT.skin, MAT.chest, MAT.abdomen, SKIN_FUR, ...FURMAT].forEach((m) => { if ((m.clippingPlanes || []).length !== cp.length) { m.clippingPlanes = cp; m.side = opt.cut ? THREE.DoubleSide : THREE.FrontSide; m.needsUpdate = true; } });   // inside of the far half shows
      // camera: the same orbit and framing as the 2D view
      renderer.setPixelRatio(dpr); if (cv3.width !== W || cv3.height !== H) renderer.setSize(W / dpr, H / dpr, false);
      const ce = Math.cos(cam.el);
      camera.position.set(target[0] + cam.dist * ce * Math.sin(cam.az), target[1] + cam.dist * Math.sin(cam.el), target[2] + cam.dist * ce * Math.cos(cam.az));
      camera.up.set(0, 1, 0); camera.lookAt(target[0], target[1], target[2]); camera.aspect = W / H;
      camera.setViewOffset(W, H, 0, -0.05 * H, W, H); camera.updateProjectionMatrix();
      renderer.render(scene, camera);
      return B.info;
    }
    return { draw };
  })();
  let anatOn = false;
  const anatOpt = () => ({ bones: document.getElementById('an-bones').checked, muscles: document.getElementById('an-mus').checked,
    organs: document.getElementById('an-org').checked, lig: document.getElementById('an-lig').checked, skin: document.getElementById('an-skin').checked, opacity: +document.getElementById('an-op').value,
    cut: document.getElementById('an-cut').checked, fat: document.getElementById('an-fat').checked, fur: document.getElementById('an-fur').checked });
  function draw() {
    const W = cv.width, H = cv.height;
    const anat = anatOn && Anat && MOD(cur).anatomy;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (anat) ctx.clearRect(0, 0, W, H); else { ctx.fillStyle = T.surface; ctx.fillRect(0, 0, W, H); }
    const pose = poseAt(cur, phase);
    const MB = MOD(cur);
    const hasHead = MB.bones.some((b) => b.name === 'head');
    const root = pose[bidx[M.root]];
    const target = [root[9] + 0.05, Math.max(0.32, 0.42 * heightOf(cur)), 0];
    const P = makeCam(target);
    const N = cur.a[0].length, x = phase * N, k = Math.floor(x) % N, w = x - Math.floor(x), k1 = (k + 1) % N;
    if (anat) { const info = Anat.draw(MB, cur, pose, k, k1, w, target, anatOpt(), W, H, dpr);
      const el = document.getElementById('an-info'); if (info && el._m !== MB) { el._m = MB; el.textContent = `skin encloses ${info.volume_l} L · fat ${info.fat_kg} kg · skin ${info.skin_kg} kg (drawn only; not in the dynamics)`; } }
    // ground grid, fixed to the world
    ctx.lineWidth = 1 * dpr; ctx.strokeStyle = anat ? 'rgba(0,0,0,0)' : T.grid;
    const x0 = Math.floor((target[0] - 1.6) * 10) / 10;
    for (let x = x0; x < target[0] + 1.6; x += 0.1) { const a = P([x, 0, -0.6]), b = P([x, 0, 0.6]); if (a[2] > 0.05 && b[2] > 0.05) { ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); } }
    for (let z = -0.6; z <= 0.61; z += 0.1) { const a = P([target[0] - 1.6, 0, z]), b = P([target[0] + 1.6, 0, z]); if (a[2] > 0.05 && b[2] > 0.05) { ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); } }
    const prims = [];
    // muscles
    if (!anat) MB.muscles.forEach((mu, i) => {
      const pts = mu.path.map(([b, p]) => apply(pose, b, p));
      const a = cur.a[i][k] * (1 - w) + cur.a[i][k1] * w;
      const side = legOf(mu.path[mu.path.length - 1][0]) || legOf(mu.path[0][0]) || (/_R$/.test(mu.name) ? 'R' : 'L');
      const far = side[0] === 'R';
      let L = 0; const seg = []; for (let j = 0; j + 1 < pts.length; j++) { const d = Math.hypot(pts[j + 1][0] - pts[j][0], pts[j + 1][1] - pts[j][1], pts[j + 1][2] - pts[j][2]); seg.push(d); L += d; }
      const fibreEnd = L - Math.min(0.95, mu.lts / (mu.lts + mu.lopt)) * L;
      let acc = 0;
      for (let j = 0; j + 1 < pts.length; j++) {
        const a0 = acc, a1 = acc + seg[j], lerp = (s) => { const u = (s - a0) / (seg[j] || 1); return pts[j].map((v, t) => v + (pts[j + 1][t] - v) * u); };
        if (fibreEnd > a0) prims.push(mu.pcsa ? { t: 'seg', a: pts[j], b: lerp(Math.min(fibreEnd, a1)), ww: 2 * Math.sqrt(mu.pcsa / Math.PI), c: rampColor(a), al: far ? 0.3 : 0.62 }
          : { t: 'seg', a: pts[j], b: lerp(Math.min(fibreEnd, a1)), w: Math.max(1.5, Math.sqrt(mu.F0) * 0.12), c: rampColor(a), al: far ? 0.4 : 0.9 });
        if (a1 > fibreEnd) prims.push({ t: 'seg', a: lerp(Math.max(fibreEnd, a0)), b: pts[j + 1], w: 1, c: T.boneFar, al: far ? 0.4 : 0.9 });
        acc = a1;
      }
    });
    // bones
    if (!anat) MB.bones.forEach((b) => {
      const pa = apply(pose, b.name, [0, 0, 0]), pb = apply(pose, b.name, [b.length, 0, 0]);
      const trunk = !legOf(b.name); const far = legOf(b.name)[0] === 'R';
      const w = b.name === 'head' ? 9 : /^neck/.test(b.name) ? 5.5 : /^tail/.test(b.name) ? 2.8 : trunk ? 7 : 4.5;
      prims.push({ t: 'seg', a: pa, b: pb, w, c: far ? T.boneFar : T.bone, al: 1 });
      if (b.name === 'head') { const top = apply(pose, 'head', [0.02, 0.05, 0]), eye = apply(pose, 'head', MB.eye ? MB.eye[1] : [0.09, 0.03, 0]);
        prims.push({ t: 'seg', a: pa, b: top, w: 6, c: T.bone, al: 1 }, { t: 'seg', a: top, b: pb, w: 4, c: T.bone, al: 1 }, { t: 'dot', p: eye, r: 3, c: T.accent }); }
      prims.push({ t: 'dot', p: pa, r: 2.4, c: T.surface, s: far ? T.boneFar : T.bone });
    });
    // ribs / pelvis hints
    const ribL = (MB.bones.find((x) => x.name === 'thorax') || { length: 0.42 }).length / 0.42;   // ribs along the whole ribcage
    if (!anat) for (let u = 0.08 * ribL; u <= 0.40 * ribL + 1e-9; u += 0.05 * ribL) for (const sgn of [1, -1]) { const a = apply(pose, 'thorax', [u, 0, 0]), b = apply(pose, 'thorax', [u + 0.04, -0.17 + Math.abs(u - 0.24 * ribL) * 0.4 / ribL, sgn * 0.9 * (MB.rib_half_width || 0.11)]); prims.push({ t: 'seg', a, b, w: 1.2, c: T.boneFar, al: 0.7 }); }
    if (!hasHead && !anat) { const nk = apply(pose, 'thorax', [0.42, 0, 0]), hd = apply(pose, 'thorax', [0.56, 0.10, 0]), sn = apply(pose, 'thorax', [0.70, 0.04, 0]);
      prims.push({ t: 'seg', a: nk, b: hd, w: 3, c: T.bone, al: 1 }, { t: 'seg', a: hd, b: sn, w: 2, c: T.bone, al: 1 }); }
    // paws + GRF
    const showG = document.getElementById('show-grf').checked;
    MB.contacts.forEach((c, ic) => {
      const p = apply(pose, c.bone, c.point); const far = c.name[0] === 'R';
      if (!anat) prims.push({ t: 'dot', p, r: c.radius, world: true, c: far ? T.boneFar : T.paw });
      if (showG) { const g = [0, 1, 2].map((d) => cur.grf[d][ic][k] * (1 - w) + cur.grf[d][ic][k1] * w);
        if (g[1] > 0.02) { const s = 0.25, base = [p[0], 0, p[2]], tip = [p[0] + g[0] * s, g[1] * s, p[2] + g[2] * s]; prims.push({ t: 'arrow', a: base, b: tip, c: T.grf, al: far ? 0.55 : 1 }); } }
    });
    // project + sort far to near
    prims.forEach((q) => { if (q.t === 'dot') { q.P = P(q.p); q.z = q.P[2]; } else { q.A = P(q.a); q.B = P(q.b); q.z = 0.5 * (q.A[2] + q.B[2]); } });
    prims.sort((a, b) => b.z - a.z);
    ctx.lineCap = 'round';
    for (const q of prims) {
      if (q.z < 0.05) continue;
      ctx.globalAlpha = q.al ?? 1;
      if (q.t === 'seg') { ctx.strokeStyle = q.c; ctx.lineWidth = q.ww ? Math.max(1, q.ww * 0.5 * (q.A[3] + q.B[3])) : q.w * dpr * (q.A[3] / (cv.height * 0.6)); ctx.beginPath(); ctx.moveTo(q.A[0], q.A[1]); ctx.lineTo(q.B[0], q.B[1]); ctx.stroke(); }
      else if (q.t === 'dot') { const r = q.world ? q.r * q.P[3] : q.r * dpr; ctx.fillStyle = q.c; ctx.beginPath(); ctx.arc(q.P[0], q.P[1], Math.max(r, 1), 0, 7); ctx.fill(); if (q.s) { ctx.strokeStyle = q.s; ctx.lineWidth = 1.3 * dpr; ctx.stroke(); } }
      else if (q.t === 'arrow') { ctx.strokeStyle = q.c; ctx.fillStyle = q.c; ctx.lineWidth = 2 * dpr; ctx.beginPath(); ctx.moveTo(q.A[0], q.A[1]); ctx.lineTo(q.B[0], q.B[1]); ctx.stroke(); const ang = Math.atan2(q.B[1] - q.A[1], q.B[0] - q.A[0]), hl = 7 * dpr; ctx.beginPath(); ctx.moveTo(q.B[0], q.B[1]); ctx.lineTo(q.B[0] - hl * Math.cos(ang - 0.4), q.B[1] - hl * Math.sin(ang - 0.4)); ctx.lineTo(q.B[0] - hl * Math.cos(ang + 0.4), q.B[1] - hl * Math.sin(ang + 0.4)); ctx.closePath(); ctx.fill(); }
    }
    ctx.globalAlpha = 1; ctx.fillStyle = T.muted; ctx.font = `${11 * dpr}px ${tok('--font-mono')}`;
    ctx.fillText(`t = ${(phase * cur.summary.T).toFixed(3)} s of ${cur.summary.T.toFixed(3)} s`, 12 * dpr, 20 * dpr);
    ctx.fillText('grid 10 cm · arrows 1 BW = 25 cm · drag to orbit, scroll to zoom', 12 * dpr, H - 10 * dpr);
    const fc = document.getElementById('ff-cursor'); if (fc) { const xx = 30 + (320 - 34) / 2 * phase; fc.setAttribute('x1', xx); fc.setAttribute('x2', xx); }
    heatCursor();
  }
  function tick(now) { const dt = Math.min(0.05, (now - last) / 1000); last = now; if (playing) phase = (phase + dt * rate / cur.summary.T) % 1; draw(); requestAnimationFrame(tick); }
  // orbit / zoom
  let drag = null;
  cv.addEventListener('pointerdown', (e) => { drag = [e.clientX, e.clientY, cam.az, cam.el]; cv.setPointerCapture(e.pointerId); });
  cv.addEventListener('pointermove', (e) => { if (!drag) return; cam.az = drag[2] - (e.clientX - drag[0]) * 0.008; cam.el = Math.max(-0.05, Math.min(1.5, drag[3] + (e.clientY - drag[1]) * 0.006)); setView(null); });
  cv.addEventListener('pointerup', () => { drag = null; });
  cv.addEventListener('wheel', (e) => { e.preventDefault(); cam.dist = Math.max(0.9, Math.min(5, cam.dist * Math.exp(e.deltaY * 0.001))); }, { passive: false });
  function setView(v) { document.querySelectorAll('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === v))); if (v) [cam.az, cam.el] = VIEWS[v]; }
  document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
  function setAnat(on) {
    anatOn = !!on && !!Anat; document.querySelectorAll('[data-anat]').forEach((b) => b.setAttribute('aria-pressed', String((b.dataset.anat === '1') === anatOn)));
    document.getElementById('anat-controls').hidden = !anatOn; document.getElementById('stage3').hidden = !anatOn;
    document.querySelector('.stage-wrap').classList.toggle('anat', anatOn);
  }
  document.querySelectorAll('[data-anat]').forEach((b) => b.addEventListener('click', () => setAnat(b.dataset.anat === '1')));
  if (Anat && (D.model.anatomy || Object.values(D.models || {}).some((m) => m.anatomy))) document.getElementById('mode-anat-group').hidden = false;
  const playBtn = document.getElementById('play');
  function setPlay(p) { playing = p; playBtn.textContent = p ? 'Pause' : 'Play'; playBtn.setAttribute('aria-pressed', String(p)); }
  setPlay(playing); playBtn.addEventListener('click', () => setPlay(!playing));
  const rateEl = document.getElementById('rate'); rateEl.addEventListener('input', () => { rate = +rateEl.value; document.getElementById('rate-v').textContent = rate.toFixed(2) + '×'; });

  // ---------- strip / select / readout
  function buildStrip() { const el = document.getElementById('strip'); el.innerHTML = '';
    speeds.forEach((v) => { const s = bestAt[v]; const b = document.createElement('button'); b.setAttribute('aria-pressed', String(cur.summary.speed === v));
      b.innerHTML = `<span class="v">${v.toFixed(1)} m/s</span><span class="g"><span class="key" style="background:${famColor(s.fam)}"></span>${FAM[famIndex[s.fam]][1]}</span><span class="c">COT ${s.summary.cot.toFixed(3)}</span>`;
      b.title = pretty(s.summary.gait); b.addEventListener('click', () => select(s)); el.appendChild(b); }); }
  const sel = document.getElementById('sel');
  function buildSelect() { sel.innerHTML = ''; SOL.filter((s) => s.summary.speed === cur.summary.speed).sort((a, b) => a.summary.cot - b.summary.cot).forEach((s) => {
    const o = document.createElement('option'); o.value = s.id; o.textContent = `${pretty(s.summary.gait)} · COT ${s.summary.cot.toFixed(3)}${s.summary.codesign ? ' · co-designed body' : ''}${s.summary.dof6 ? ' · joints free in 6 axes' : ''}${s.summary.variant ? ' · ' + s.summary.variant_label : ''}${s === bestAt[s.summary.speed] ? ' · best' : ''}`; if (s === cur) o.selected = true; sel.appendChild(o); }); }
  sel.addEventListener('change', () => select(SOL[+sel.value]));
  function readout() {
    const s = cur.summary; document.getElementById('r-gait').textContent = pretty(s.gait); document.getElementById('r-key').style.background = famColor(cur.fam);
    const best = bestAt[s.speed];
    const twin = SOL.filter((x) => !special(x) && x.fam === cur.fam && x.summary.speed === s.speed).reduce((a, b) => (!a || b.summary.cot < a.summary.cot ? b : a), null);
    const md = D.modes && D.modes.find((x) => SOL[x.sol] === cur);
    document.getElementById('r-note').innerHTML = md ? `<span class="pill ok">${md.label}</span> ${md.note || ''}` : s.variant ? `<span class="pill ok">${s.variant_label}</span>${twin ? ` ${(s.cot / twin.summary.cot - 1) * 100 >= 0 ? '+' : ''}${((s.cot / twin.summary.cot - 1) * 100).toFixed(0)}% per kg vs the default body` : ''}` : s.dof6 ? `<span class="pill ok">joints free in all 6 axes</span>${twin ? ` ${((s.cot / twin.summary.cot - 1) * 100).toFixed(0) > 0 ? '+' : ''}${((s.cot / twin.summary.cot - 1) * 100).toFixed(0)}% vs the same gait with hinge and ball joints` : ''}` : s.codesign ? `<span class="pill ok">co-designed joints</span> same speed, optimized body` : (cur === best ? `<span class="pill ok">lowest cost at ${s.speed.toFixed(1)} m/s</span> default body` : `<span class="pill">${((s.cot / best.summary.cot - 1) * 100).toFixed(0)}% above best</span> default body`);
    const duty = (l) => s.footfalls[l] ? s.footfalls[l].duty : 0;
    const f = [['Speed', `${s.speed.toFixed(2)} <small>m/s</small>`], ['Froude number', s.froude.toFixed(2)], ['Cost of transport', s.cot.toFixed(3)], ['Metabolic energy', `${s.cot_J_per_kg_m.toFixed(2)} <small>J/kg/m</small>`],
      ['Stride frequency', `${s.stride_frequency.toFixed(2)} <small>Hz</small>`], ['Stride length', `${s.stride_length.toFixed(2)} <small>m</small>`], ['Duty fore / hind', (() => { const st = MOD(cur).leg_station || { LF: 0, RF: 0, LH: 1, RH: 1 }, last = Math.max(...Object.values(st)), mean = (ls) => ls.reduce((a, l) => a + duty(l), 0) / ls.length;
        return `${mean(Object.keys(st).filter((l) => st[l] === 0)).toFixed(2)} / ${mean(Object.keys(st).filter((l) => st[l] === last)).toFixed(2)}`; })()], ['Aerial phase', `${(s.flight_fraction * 100).toFixed(0)}<small>%</small>`],
      ['Roll · yaw range', `${s.roll_range_deg.toFixed(1)}° · ${s.yaw_range_deg.toFixed(1)}°`], ['Lateral sway', `${(s.lateral_sway_m * 100).toFixed(1)} <small>cm</small>`], ['Peak paw force', `${s.peak_grf_bw.toFixed(2)} <small>BW</small>`], ['Reserve torque', `${(s.reserve_rel * 100).toFixed(2)}<small>% of muscle</small>`]];
    if (s.head_omega_rms_deg_s != null) f.push(['Head steadiness', `${s.head_omega_rms_deg_s.toFixed(0)}°/s · ${s.eye_acc_rms_g.toFixed(2)} g <small>RMS rotation · eye accel.</small>`]);
    if (s.head_pitch_rms_deg != null) f.push(['Head level', `${s.head_pitch_rms_deg.toFixed(1)}° · ${s.head_roll_rms_deg.toFixed(1)}° <small>RMS pitch · roll off level</small>`]);
    if (s.bone_clearance_mm != null) f.push(['Closest bones', `${s.bone_clearance_mm >= 0 ? '' : '<span style="color:var(--up)">'}${s.bone_clearance_mm.toFixed(0)} mm${s.bone_clearance_mm >= 0 ? '' : '</span>'} <small>${s.bone_clearance_pair.replace(/_/g, ' ')}</small>`]);
    if (s.verify) f.push(['Re-simulation error', `${s.verify.interval_q_err_deg.toFixed(2)}° <small>max per step</small>`]);
    if (s.verify && s.verify.quasi_static_offset_mm != null) f.push(['Joint play between nodes', `${s.verify.quasi_static_offset_mm_median.toFixed(1)} mm · ${s.verify.quasi_static_offset_deg_median.toFixed(1)}° <small>median off equilibrium</small>`]);
    document.getElementById('facts').innerHTML = f.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
  }
  // rows: left side hind to fore, then right side fore to hind (LH LF RF RH for four legs)
  const ffOrder = (MM) => { const st = MM.leg_station; if (!st) return ['LH', 'LF', 'RF', 'RH'];
    const L = Object.keys(st).filter((l) => l[0] === 'L').sort((a, b) => st[b] - st[a]), R = Object.keys(st).filter((l) => l[0] === 'R').sort((a, b) => st[a] - st[b]);
    return [...L, ...Object.keys(st).filter((l) => l[0] === 'C'), ...R]; };
  const ffName = (leg) => leg.replace(/^([LR])([1-9])$/, '$1M$2');
  function footfall() { const svg = document.getElementById('footfall'); const order = ffOrder(MOD(cur)), nr = order.length; const W = 320, x0 = 34, w = W - x0 - 4, rowH = nr > 4 ? 16 : 22, bh = nr > 4 ? 11 : 14, y0 = 6; let h = '';
    for (let k = 0; k <= 2; k++) { const x = x0 + (w * k) / 2; h += `<line x1="${x}" x2="${x}" y1="${y0}" y2="${y0 + rowH * nr}" stroke="${T.rule}"/><text x="${x}" y="${y0 + rowH * nr + 14}" text-anchor="middle">${k}</text>`; }
    order.forEach((leg, r) => { const st = cur.stance[leg]; const N = st.length; const y = y0 + r * rowH + 4; h += `<text x="0" y="${y + bh - 3}">${ffName(leg)}</text>`;
      for (let rep = 0; rep < 2; rep++) { let k = 0; while (k < N) { if (st[k]) { let j = k; while (j < N && st[j]) j++; const xa = x0 + (w / 2) * (rep + k / N), xb = x0 + (w / 2) * (rep + j / N); h += `<rect x="${xa.toFixed(1)}" y="${y}" width="${Math.max(1, xb - xa - 1).toFixed(1)}" height="${bh}" rx="3" fill="${famColor(cur.fam)}"/>`; k = j; } else k++; } } });
    h += `<line id="ff-cursor" x1="0" x2="0" y1="${y0 - 2}" y2="${y0 + rowH * nr + 2}" stroke="${T.ink}" stroke-width="1.5"/><text x="${x0 + w / 2}" y="${y0 + rowH * nr + 26}" text-anchor="middle" class="axis-label" style="font-size:10px">stride</text>`;
    svg.setAttribute('viewBox', `0 0 ${W} ${y0 + rowH * nr + 30}`); svg.innerHTML = h; }

  // ---------- cost chart
  const tip = document.getElementById('tip');
  function showTip(e, html) { tip.innerHTML = html; tip.hidden = false; tip.style.left = Math.min(window.innerWidth - 310, e.clientX + 14) + 'px'; tip.style.top = (e.clientY + 14) + 'px'; }
  const hideTip = () => { tip.hidden = true; };
  function shape(kind, x, y, r, fill) { const f = `fill="${fill}" stroke="${T.surface}" stroke-width="2"`;
    switch (kind) { case 'square': return `<rect x="${x - r}" y="${y - r}" width="${2 * r}" height="${2 * r}" rx="1.5" ${f}/>`; case 'diamond': return `<path d="M${x} ${y - r * 1.3}L${x + r * 1.3} ${y}L${x} ${y + r * 1.3}L${x - r * 1.3} ${y}Z" ${f}/>`;
      case 'triangle': return `<path d="M${x} ${y - r * 1.3}L${x + r * 1.2} ${y + r}L${x - r * 1.2} ${y + r}Z" ${f}/>`; case 'tri-down': return `<path d="M${x} ${y + r * 1.3}L${x + r * 1.2} ${y - r}L${x - r * 1.2} ${y - r}Z" ${f}/>`;
      case 'cross': return `<path d="M${x - r} ${y - r}L${x + r} ${y + r}M${x + r} ${y - r}L${x - r} ${y + r}" stroke="${fill}" stroke-width="3" stroke-linecap="round"/>`; case 'star': return `<path d="M${x} ${y - r * 1.4}L${x + r * .4} ${y - r * .4}L${x + r * 1.4} ${y}L${x + r * .4} ${y + r * .4}L${x} ${y + r * 1.4}L${x - r * .4} ${y + r * .4}L${x - r * 1.4} ${y}L${x - r * .4} ${y - r * .4}Z" ${f}/>`;
      case 'circle-open': return `<circle cx="${x}" cy="${y}" r="${r}" fill="${T.surface}" stroke="${fill}" stroke-width="2"/>`; default: return `<circle cx="${x}" cy="${y}" r="${r}" ${f}/>`; } }
  function cotChart() {
    const svg = document.getElementById('cot'); const W = Math.max(560, Math.round(svg.parentElement.clientWidth || 1100)), H = 360, ml = 64, mr = 110, mt = 16, mb = 48; svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const main = SOL.filter((s) => !special(s));
    const ys = main.map((s) => s.summary.cot).concat((D.explored || []).map((e) => e.cot)).concat((D.planar || []).map((p) => p.cot));
    const xs = main.map((s) => s.summary.speed);
    const xmin = 0.4, xmax = Math.ceil(Math.max(...xs) + 0.4), ymax = Math.min(1.2, Math.ceil(Math.max(...ys) * 10) / 10 + 0.05);
    const X = (v) => ml + (v - xmin) / (xmax - xmin) * (W - ml - mr), Y = (v) => H - mb - Math.min(v, ymax) / ymax * (H - mt - mb);
    let h = ''; for (let v = 0; v <= ymax + 1e-9; v += 0.1) h += `<line x1="${ml}" x2="${W - mr}" y1="${Y(v)}" y2="${Y(v)}" stroke="${T.rule}"/><text x="${ml - 8}" y="${Y(v) + 4}" text-anchor="end">${v.toFixed(1)}</text>`;
    for (let v = 1; v <= xmax; v++) h += `<text x="${X(v)}" y="${H - mb + 18}" text-anchor="middle">${v}</text>`;
    h += `<text class="axis-label" x="${(ml + W - mr) / 2}" y="${H - 8}" text-anchor="middle">speed (m/s)</text><text class="axis-label" transform="translate(16 ${(mt + H - mb) / 2}) rotate(-90)" text-anchor="middle">metabolic cost of transport</text>`;
    (D.explored || []).forEach((e) => { h += `<circle cx="${X(e.speed).toFixed(1)}" cy="${Y(e.cot).toFixed(1)}" r="2.6" fill="${T.muted}" opacity=".3"/>`; });
    if ((D.planar || []).length) h += `<polyline fill="none" stroke="${T.muted}" stroke-width="1.5" stroke-dasharray="5 4" points="${D.planar.map((p) => `${X(p.speed)},${Y(p.cot)}`).join(' ')}"/>`;
    const fams = [...new Set(main.map((s) => s.fam))].sort((a, b) => famIndex[a] - famIndex[b]); const ends = [];
    fams.forEach((f) => { const pts = speeds.map((v) => { const c = main.filter((s) => s.fam === f && s.summary.speed === v); return c.length ? c.reduce((a, b) => (b.summary.cot < a.summary.cot ? b : a)) : null; }).filter(Boolean);
      if (pts.length > 1) h += `<polyline fill="none" stroke="${famColor(f)}" stroke-width="2" stroke-linejoin="round" points="${pts.map((s) => `${X(s.summary.speed)},${Y(s.summary.cot)}`).join(' ')}"/>`;
      if (pts.length) { const e = pts[pts.length - 1]; ends.push({ f, x: X(e.summary.speed), y: Y(e.summary.cot) }); } });
    ends.sort((a, b) => a.y - b.y); ends.forEach((e, i) => { e.ly = e.y; if (i && e.ly - ends[i - 1].ly < 14 && Math.abs(e.x - ends[i - 1].x) < 60) e.ly = ends[i - 1].ly + 14; });
    ends.forEach((e) => { if (Math.abs(e.ly - e.y) > 1) h += `<line x1="${e.x + 5}" y1="${e.y}" x2="${e.x + 16}" y2="${e.ly}" stroke="${T.muted}"/>`; h += `<text x="${e.x + 19}" y="${e.ly + 4}">${FAM[famIndex[e.f]][1]}</text>`; });
    main.forEach((s) => { const f = FAM[famIndex[s.fam]]; h += `<g class="pt" data-id="${s.id}" style="cursor:pointer">${shape(f[3], X(s.summary.speed), Y(s.summary.cot), s === bestAt[s.summary.speed] ? 6 : 4.5, famColor(s.fam))}<circle cx="${X(s.summary.speed)}" cy="${Y(s.summary.cot)}" r="11" fill="transparent"/></g>`; });
    SOL.filter((s) => s.summary.codesign).forEach((s) => { h += `<g class="pt" data-id="${s.id}" style="cursor:pointer"><circle cx="${X(s.summary.speed)}" cy="${Y(s.summary.cot)}" r="6" fill="none" stroke="${T.accent}" stroke-width="2.5"/><circle cx="${X(s.summary.speed)}" cy="${Y(s.summary.cot)}" r="11" fill="transparent"/></g>`; });
    SOL.filter((s) => s.summary.variant).forEach((s) => { const x = X(s.summary.speed), y = Y(s.summary.cot); h += `<g class="pt" data-id="${s.id}" style="cursor:pointer"><path d="M${x} ${y - 8}L${x + 8} ${y + 6}L${x - 8} ${y + 6}Z" fill="${T.surface}" stroke="${T.accent}" stroke-width="2"/><circle cx="${x}" cy="${y}" r="11" fill="transparent"/></g>`; });
    SOL.filter((s) => s.summary.dof6).forEach((s) => { const x = X(s.summary.speed), y = Y(s.summary.cot); h += `<g class="pt" data-id="${s.id}" style="cursor:pointer"><path d="M${x} ${y - 8}L${x + 8} ${y}L${x} ${y + 8}L${x - 8} ${y}Z" fill="${T.surface}" stroke="${T.ink}" stroke-width="2"/><circle cx="${x}" cy="${y}" r="11" fill="transparent"/></g>`; });
    h += `<circle r="10" fill="none" stroke="${T.ink}" stroke-width="1.5" cx="${X(cur.summary.speed)}" cy="${Y(cur.summary.cot)}"/>`;
    svg.innerHTML = h;
    svg.querySelectorAll('.pt').forEach((g) => { const s = SOL[+g.dataset.id]; g.addEventListener('mousemove', (e) => showTip(e, `<b>${pretty(s.summary.gait)}</b>${s.summary.codesign ? ' (co-designed)' : ''}${s.summary.dof6 ? ' (joints free in 6 axes)' : ''}${s.summary.variant ? ' (' + s.summary.variant_label + ')' : ''}<br>${s.summary.speed.toFixed(1)} m/s · COT ${s.summary.cot.toFixed(3)}<br>${s.summary.stride_frequency.toFixed(2)} Hz · roll ${s.summary.roll_range_deg.toFixed(1)}°`)); g.addEventListener('mouseleave', hideTip); g.addEventListener('click', () => select(s)); });
    document.getElementById('legend').innerHTML = `<span><svg width="10" height="10" aria-hidden="true"><circle cx="5" cy="5" r="3" fill="${T.muted}" opacity=".4"/></svg>explored optimum</span>` + fams.map((f) => `<span><svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">${shape(FAM[famIndex[f]][3], 7, 7, 4.5, famColor(f))}</svg>${FAM[famIndex[f]][1]}</span>`).join('') + ((D.planar || []).length ? `<span><svg width="20" height="10" aria-hidden="true"><line x1="0" x2="20" y1="5" y2="5" stroke="${T.muted}" stroke-width="1.5" stroke-dasharray="5 4"/></svg>planar model, best</span>` : '') + (SOL.some((s) => s.summary.codesign) ? `<span><svg width="14" height="14" aria-hidden="true"><circle cx="7" cy="7" r="5" fill="none" stroke="${T.accent}" stroke-width="2.5"/></svg>co-designed body</span>` : '') + (SOL.some((s) => s.summary.variant) ? `<span><svg width="16" height="16" aria-hidden="true"><path d="M8 2L14 13L2 13Z" fill="${T.surface}" stroke="${T.accent}" stroke-width="2"/></svg>other body</span>` : '') + (SOL.some((s) => s.summary.dof6) ? `<span><svg width="16" height="16" aria-hidden="true"><path d="M8 2L14 8L8 14L2 8Z" fill="${T.surface}" stroke="${T.ink}" stroke-width="2"/></svg>joints free in 6 axes</span>` : '');
  }

  // ---------- ROM usage
  const fmt = (v, ax) => v.toFixed(ax.unit === 'mm' && Math.abs(ax.hi - ax.lo) < 12 ? 1 : 0);
  function romUsage() {
    const el = document.getElementById('romgrid'); let h = '';
    MOD(cur).joints.filter((j) => !isRight(j.name)).forEach((j) => j.axes.forEach((ax) => {
      const sc = ax.unit === 'deg' ? 180 / Math.PI : 1000; const qs = cur.q[ax.q].map((v) => v * sc);
      const lo = Math.min(ax.lo, ...qs), hi = Math.max(ax.hi, ...qs), pad = 0.05 * (hi - lo), A = lo - pad, B = hi + pad;
      const pct = (v) => ((v - A) / (B - A) * 100).toFixed(2);
      const umin = Math.min(...qs), umax = Math.max(...qs);
      const names = { rx: 'roll/abd', ry: 'yaw/axial', rz: 'flex/ext', ty: 'vertical', tx: 'fore-aft', tz: 'lateral' };
      h += `<div class="rom-row"><div class="lab" title="${j.name}.${ax.axis}">${legLabel(j.name)} ${names[ax.axis] || ax.axis}</div>
        <svg viewBox="0 0 100 12" preserveAspectRatio="none" width="100%" height="12"><rect x="${pct(ax.lo)}" y="3" width="${(pct(ax.hi) - pct(ax.lo)).toFixed(2)}" height="6" rx="3" fill="${T.surface2}" stroke="${T.rule}" stroke-width=".4" vector-effect="non-scaling-stroke"/><rect x="${pct(umin)}" y="3" width="${Math.max(0.6, pct(umax) - pct(umin)).toFixed(2)}" height="6" rx="3" fill="${famColor(cur.fam)}"/><line x1="${pct(0)}" x2="${pct(0)}" y1="0" y2="12" stroke="${T.ink}" stroke-width="1" vector-effect="non-scaling-stroke"/></svg>
        <div class="val">${fmt(umin, ax)}…${fmt(umax, ax)} / ${fmt(ax.lo, ax)}…${fmt(ax.hi, ax)}${ax.unit === 'deg' ? '°' : ' mm'}</div></div>`; }));
    el.innerHTML = h;
  }
  function hipPlot() {
    const R = MOD(cur).hip_rom; const svg = document.getElementById('hipsvg'); if (!R) return;
    const qz = cur.q[R.q_rz].map((v) => v * 180 / Math.PI), qx = cur.q[R.q_rx].map((v) => v * 180 / Math.PI);
    const allx = R.rz.concat(qz), ally = R.rx.concat(qx);
    const x0 = Math.floor(Math.min(...allx) / 10) * 10 - 10, x1 = Math.ceil(Math.max(...allx) / 10) * 10 + 10, y0 = Math.floor(Math.min(...ally) / 10) * 10 - 5, y1 = Math.ceil(Math.max(...ally) / 10) * 10 + 5;
    const W = 420, H = 330, ml = 44, mb = 36, mt = 10, mr = 10; const X = (v) => ml + (v - x0) / (x1 - x0) * (W - ml - mr), Y = (v) => H - mb - (v - y0) / (y1 - y0) * (H - mt - mb);
    let h = '';
    for (let v = Math.ceil(x0 / 20) * 20; v <= x1; v += 20) h += `<line x1="${X(v)}" x2="${X(v)}" y1="${mt}" y2="${H - mb}" stroke="${T.rule}"/><text x="${X(v)}" y="${H - mb + 14}" text-anchor="middle">${v}</text>`;
    for (let v = Math.ceil(y0 / 10) * 10; v <= y1; v += 10) h += `<line x1="${ml}" x2="${W - mr}" y1="${Y(v)}" y2="${Y(v)}" stroke="${T.rule}"/><text x="${ml - 6}" y="${Y(v) + 4}" text-anchor="end">${v}</text>`;
    h += `<polygon points="${R.rz.map((v, i) => `${X(v)},${Y(R.rx[i])}`).join(' ')}" fill="${T.accent}" fill-opacity=".10" stroke="${T.accent}" stroke-width="2"/>`;
    h += `<polyline points="${qz.concat(qz[0]).map((v, i) => `${X(v)},${Y(qx.concat(qx[0])[i])}`).join(' ')}" fill="none" stroke="${famColor(cur.fam)}" stroke-width="2.5"/>`;
    h += `<circle cx="${X(0)}" cy="${Y(0)}" r="3.5" fill="${T.ink}"/><text x="${X(0) + 6}" y="${Y(0) - 6}">stand</text>`;
    h += `<text class="axis-label" x="${(ml + W - mr) / 2}" y="${H - 4}" text-anchor="middle">flexion (+) / extension (−), deg from standing</text><text class="axis-label" transform="translate(12 ${(mt + H - mb) / 2}) rotate(-90)" text-anchor="middle">adduction (+) / abduction (−)</text>`;
    svg.innerHTML = h;
  }

  // ---------- heatmap
  const heat = document.getElementById('heat'), hctx = heat.getContext('2d');
  let shownMuscles = [];
  // left side, grouped leg by leg from fore to hind (trunk muscles first, neck and tail last)
  const musRank = (MM, m) => { const l = legOf(m.path[m.path.length - 1][0]) || legOf(m.path[0][0]); return l ? ((MM.leg_station || { LF: 0, LH: 1 })[l] ?? 0) : /neck|tail/.test(m.group) ? 99 : -1; };
  const musclesOf = (MM) => MM.muscles.map((m, i) => [m, i]).filter(([m]) => !isRight(m.name) && !/_R$/.test(m.name))
    .sort((a, b) => musRank(MM, a[0]) - musRank(MM, b[0]) || a[1] - b[1]);
  const musLabel = (MM, n) => (MM.legs && MM.legs.length > 4) ? legLabel(n).replace(/_L$/, '') : n.replace(/^[LC][FH]_/, '').replace(/_L$/, '');
  let hg = null, hbase = null;
  function heatmap() { shownMuscles = musclesOf(MOD(cur)); const d = window.devicePixelRatio || 1, rowH = 11, labelW = 180, top = 4, bottom = 24; const cssW = heat.getBoundingClientRect().width || 900, cssH = top + bottom + rowH * shownMuscles.length;
    heat.style.height = cssH + 'px'; heat.width = Math.round(cssW * d); heat.height = Math.round(cssH * d); hctx.setTransform(d, 0, 0, d, 0, 0); hctx.fillStyle = T.surface; hctx.fillRect(0, 0, cssW, cssH);
    const N = cur.a[0].length, cw = (cssW - labelW - 8) / N; hctx.font = `10px ${tok('--font-mono')}`; hctx.textBaseline = 'middle'; let lg = null;
    shownMuscles.forEach(([mu, i], r) => { const y = top + r * rowH; if (mu.group !== lg && r) { hctx.fillStyle = T.rule; hctx.fillRect(0, y - 0.5, cssW, 1); } lg = mu.group; hctx.fillStyle = T.ink2; hctx.fillText(musLabel(MOD(cur), mu.name), 4, y + rowH / 2);
      for (let k = 0; k < N; k++) { hctx.fillStyle = rampColor(cur.a[i][k]); hctx.fillRect(labelW + k * cw, y + 1, Math.ceil(cw), rowH - 2); } });
    hctx.fillStyle = T.muted; [0, 0.5, 1].forEach((f) => { hctx.textAlign = f === 0 ? 'left' : f === 1 ? 'right' : 'center'; hctx.fillText(`${f}`, labelW + f * N * cw, cssH - 9); }); hctx.textAlign = 'left';
    hg = { labelW, top, rowH, cw, N }; hbase = hctx.getImageData(0, 0, heat.width, heat.height); }
  function heatCursor() { if (!hg || !hbase) return; hctx.putImageData(hbase, 0, 0); hctx.fillStyle = T.ink; hctx.fillRect(hg.labelW + phase * hg.N * hg.cw - 0.75, hg.top, 1.5, hg.rowH * shownMuscles.length); }
  heat.addEventListener('mousemove', (e) => { if (!hg) return; const r = heat.getBoundingClientRect(); const row = Math.floor((e.clientY - r.top - hg.top) / hg.rowH), k = Math.floor((e.clientX - r.left - hg.labelW) / hg.cw); if (row < 0 || row >= shownMuscles.length || k < 0 || k >= hg.N) { hideTip(); return; } const [mu, i] = shownMuscles[row]; showTip(e, `<b>${mu.name}</b><br>stride ${(k / hg.N).toFixed(2)} · activation ${cur.a[i][k].toFixed(2)}<br>tendon force ${cur.force[i][k].toFixed(0)} N of ${mu.F0} N${mu.mass ? `<br>mass ${(mu.mass * 1000).toFixed(0)} g · fibres ${(mu.lopt * 100).toFixed(1)} cm` : ''}`); });
  heat.addEventListener('mouseleave', hideTip);
  function rampLegend() { const c = document.getElementById('ramp'), g = c.getContext('2d'); for (let x = 0; x < c.width; x++) { g.fillStyle = rampColor(x / (c.width - 1)); g.fillRect(x, 0, 1, c.height); } }

  // ---------- co-design, sensitivities, fit, joints
  function codesign() {
    const C = D.codesign; const sec = document.getElementById('cd-section'); if (!C) { sec.hidden = true; return; }
    if (C.design && C.design.length && C.design[0].before !== undefined) { codesign6(C); return; }
    document.getElementById('cd-sub').textContent = `Computed before the stride-period gradient fix and not yet re-run, so treat these numbers as provisional. ${C.design.length} joint parameters (spine springs, carpus and hock springs and ranges, the scapular sling), shared by left and right limbs, optimized for one body at ${C.speeds.map((v) => v.toFixed(1)).join(' and ')} m/s. Outer loop: bounded L-BFGS over the design, using the gait optimizer's exact sensitivities as the gradient; ${C.evaluations} evaluations, each re-solving both gaits, until the design stopped improving. Baseline: the default body re-solved with the same settings.`;
    let h = '<tr><th>Speed</th><th>Default body</th><th class="n">COT</th><th>Co-designed body</th><th class="n">COT</th><th class="n">Change</th></tr>';
    C.speeds.forEach((v) => { const b = C.before[v] || C.before[v.toFixed(1)] || C.before[String(v)], a = C.after[v] || C.after[v.toFixed(1)] || C.after[String(v)]; const ch = (a.cot / b.cot - 1) * 100;
      h += `<tr><td class="n" style="text-align:left">${v.toFixed(1)} m/s</td><td>${b.gait}</td><td class="n">${b.cot.toFixed(3)}</td><td>${a.gait}</td><td class="n">${a.cot.toFixed(3)}</td><td class="n ${ch < 0 ? 'delta-down' : 'delta-up'}">${ch > 0 ? '+' : ''}${ch.toFixed(1)}%</td></tr>`; });
    document.getElementById('t-cd-cot').innerHTML = h;
    const pb = C.physical_before, pa = C.physical_after; const rows = [];
    const kb = pb['spine_K_Nm_per_rad (twist, lateral, flexion)'], ka = pa['spine_K_Nm_per_rad (twist, lateral, flexion)'];
    ['twist', 'lateral bending', 'flexion'].forEach((ax, i) => rows.push([`Spine stiffness, ${ax} (Nm/rad)`, kb[i][i].toFixed(0), ka[i][i].toFixed(0)]));
    const off = (K) => Math.max(Math.abs(K[0][1]), Math.abs(K[0][2]), Math.abs(K[1][2])).toFixed(1);
    rows.push(['Spine cross-axis coupling, largest (Nm/rad)', off(kb), off(ka)]);
    rows.push(['Spine rest angles (deg)', pb.spine_rest_deg.join(', '), pa.spine_rest_deg.join(', ')]);
    for (const j of ['LF_carpus', 'LH_hock']) { const nm = j.includes('carpus') ? 'Carpus' : 'Hock';
      rows.push([`${nm} spring (Nm/rad)`, pb[j].K_Nm_per_rad.toFixed(1), pa[j].K_Nm_per_rad.toFixed(1)]); rows.push([`${nm} spring rest (deg)`, pb[j].rest_deg.toFixed(1), pa[j].rest_deg.toFixed(1)]); rows.push([`${nm} range of motion (deg)`, pb[j].rom_deg.join(' … '), pa[j].rom_deg.join(' … ')]); }
    const sk = 'sling_K [[Nm/rad, N/rad],[N/rad, N/m]]'; rows.push(['Sling lift stiffness (N/m)', pb[sk][1][1].toFixed(0), pa[sk][1][1].toFixed(0)]); rows.push(['Sling rotation stiffness (Nm/rad)', pb[sk][0][0].toFixed(1), pa[sk][0][0].toFixed(1)]); rows.push(['Sling rest height (mm)', pb.sling_rest_mm.toFixed(1), pa.sling_rest_mm.toFixed(1)]);
    document.getElementById('t-cd-phys').innerHTML = '<tr><th>Property</th><th class="n">Default</th><th class="n">Co-designed</th></tr>' + rows.map((r) => `<tr><td>${r[0]}</td><td class="n">${r[1]}</td><td class="n">${r[2]}</td></tr>`).join('');
  }
  function codesign6(C) {
    const key = (d, v) => d[v] || d[(+v).toFixed(1)] || d[String(v)];
    const H = C.history || [], okH = H.filter((h) => h.statuses.every((x) => /^Solve/.test(x)));
    document.getElementById('cd-sub').textContent = `${C.n_design} joint parameters on the six-axis body: springs on every axis, rest angles, range and laxity envelopes (size and centre per axis), wall stiffness and envelope shape of every joint; left and right tied. Optimized together with the gait at ${C.speeds.map((v) => (+v).toFixed(1)).join(' and ')} m/s by an outer L-BFGS-B over the design, using the gait optimizer's exact sensitivities as the gradient; ${C.evaluations} evaluations, each re-solving the gait with bones kept apart and the head kept steady. A small prior keeps parameters near their defaults unless moving them pays.`;
    let h = '<tr><th>Speed</th><th>Default joints</th><th class="n">COT</th><th>Co-designed joints</th><th class="n">COT</th><th class="n">Change</th></tr>';
    C.speeds.forEach((v) => { const b = key(C.before, v), a = key(C.after, v); const ch = (a.cot / b.cot - 1) * 100;
      h += `<tr><td class="n" style="text-align:left">${(+v).toFixed(1)} m/s</td><td>${b.gait || ''}</td><td class="n">${b.cot.toFixed(3)}</td><td>${a.gait}</td><td class="n">${a.cot.toFixed(3)}</td><td class="n ${ch < 0 ? 'delta-down' : 'delta-up'}">${ch > 0 ? '+' : ''}${ch.toFixed(1)}%</td></tr>`; });
    if (okH.length > 1) h += `<tr><td colspan="6" class="muted" style="white-space:normal">Design objective ${okH[0].J.toFixed(4)} → ${Math.min(...okH.map((x) => x.J)).toFixed(4)} over ${H.length} evaluations.</td></tr>`;
    document.getElementById('t-cd-cot').innerHTML = h;
    const rows = (C.largest_changes || []).slice(0, 14);
    document.getElementById('t-cd-phys').innerHTML = '<tr><th>Largest design changes</th><th class="n">Default</th><th class="n">Co-designed</th><th>Unit</th></tr>' + rows.map((r) => `<tr><td>${r.label.replace(/_/g, ' ')}</td><td class="n">${(+r.before).toPrecision(3)}</td><td class="n">${(+r.after).toPrecision(3)}</td><td class="muted">${r.unit}</td></tr>`).join('');
  }
  function sensitivities() {
    const S = D.sensitivity || {}; const el = document.getElementById('t-sens'); const vs = Object.keys(S); if (!vs.length) { el.innerHTML = ''; return; }
    let h = '<tr><th>Speed</th><th>Parameter</th><th class="n">ΔCOT for +10%</th></tr>';
    const keep = new Set([vs[0], ...((D.codesign && D.codesign.speeds) || []).map((x) => vs.find((k) => Math.abs(+k - x) < 1e-6)).filter(Boolean)]);
    vs.filter((v) => keep.has(v)).forEach((v) => S[v].slice(0, 5).forEach((r, i) => { h += `<tr><td class="n" style="text-align:left">${i === 0 ? (+v).toFixed(1) + ' m/s' : ''}</td><td>${r.label}</td><td class="n ${r.dcot < 0 ? 'delta-down' : 'delta-up'}">${r.dcot > 0 ? '+' : ''}${r.dcot.toFixed(4)}</td></tr>`; }));
    el.innerHTML = h;
  }
  function fitPlot() {
    const F = D.fit; const sec = document.getElementById('fit-section'); if (!F) { sec.hidden = true; return; }
    const svg = document.getElementById('fitsvg'); const all = F.true.concat(F.fit, F.initial, F.data); const xs = all.map((p) => p[0]), ys = all.map((p) => p[1]);
    const x0 = Math.floor(Math.min(...xs) / 10) * 10 - 5, x1 = Math.ceil(Math.max(...xs) / 10) * 10 + 5, y0 = Math.floor(Math.min(...ys) / 10) * 10 - 5, y1 = Math.ceil(Math.max(...ys) / 10) * 10 + 5;
    const W = 440, H = 340, ml = 44, mb = 36, mt = 10, mr = 10; const X = (v) => ml + (v - x0) / (x1 - x0) * (W - ml - mr), Y = (v) => H - mb - (v - y0) / (y1 - y0) * (H - mt - mb);
    let h = ''; for (let v = Math.ceil(x0 / 20) * 20; v <= x1; v += 20) h += `<line x1="${X(v)}" x2="${X(v)}" y1="${mt}" y2="${H - mb}" stroke="${T.rule}"/><text x="${X(v)}" y="${H - mb + 14}" text-anchor="middle">${v}</text>`;
    for (let v = Math.ceil(y0 / 10) * 10; v <= y1; v += 10) h += `<line x1="${ml}" x2="${W - mr}" y1="${Y(v)}" y2="${Y(v)}" stroke="${T.rule}"/><text x="${ml - 6}" y="${Y(v) + 4}" text-anchor="end">${v}</text>`;
    const poly = (P, st) => `<polygon points="${P.map((p) => `${X(p[0])},${Y(p[1])}`).join(' ')}" ${st}/>`;
    h += poly(F.initial, `fill="none" stroke="${T.muted}" stroke-width="1.5" stroke-dasharray="3 4"`) + poly(F.true, `fill="none" stroke="${T.ink}" stroke-width="2.5"`) + poly(F.fit, `fill="none" stroke="${T.accent}" stroke-width="2" stroke-dasharray="7 4"`);
    F.data.forEach((p) => { h += `<circle cx="${X(p[0])}" cy="${Y(p[1])}" r="2.6" fill="${T.up}"/>`; });
    h += `<text class="axis-label" x="${(ml + W - mr) / 2}" y="${H - 4}" text-anchor="middle">flexion rz (deg)</text><text class="axis-label" transform="translate(12 ${(mt + H - mb) / 2}) rotate(-90)" text-anchor="middle">abduction rx (deg)</text>`;
    const lg = [['true range', T.ink, ''], ['fitted', T.accent, '7 4'], ['starting guess', T.muted, '3 4']]; lg.forEach((l, i) => { const y = mt + 12 + i * 16; h += `<line x1="${W - 150}" x2="${W - 126}" y1="${y}" y2="${y}" stroke="${l[1]}" stroke-width="2" stroke-dasharray="${l[2]}"/><text x="${W - 120}" y="${y + 4}">${l[0]}</text>`; });
    h += `<circle cx="${W - 138}" cy="${mt + 60}" r="2.6" fill="${T.up}"/><text x="${W - 120}" y="${mt + 64}">boundary data</text>`;
    svg.innerHTML = h;
    const r = F.report; document.getElementById('fitfacts').innerHTML = [['ROM boundary error', `${r.boundary_error_deg.mean.toFixed(2)}° <small>mean, ${r.boundary_error_deg.max.toFixed(2)}° max</small>`], ['Data noise', '1° <small>boundary</small>, 0.2 Nm, 0.2 mm'], ['Stiffness matrix true', r.stiffness_true.map((row) => row.map((v) => v.toFixed(2)).join(', ')).join(' | ')], ['Stiffness matrix fitted', r.stiffness_fit.map((row) => row.map((v) => v.toFixed(2)).join(', ')).join(' | ')], ['Passive torque error', `${r.passive_torque_rms_error_Nm.toFixed(2)} <small>Nm RMS</small>`], ['Centre-glide error', `${r.glide_error_mm.mean.toFixed(2)} <small>mm mean</small>`]].map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
  }
  function jointTable() {
    const MM = MOD(cur), J = MM.joints.filter((j) => !isRight(j.name));
    let h = '<tr><th>Joint</th><th>Free axes</th><th>Range of motion</th><th class="n">Spring (diag)</th><th>Coupled</th><th>Notes</th></tr>';
    J.forEach((j) => { h += `<tr><td>${legLabel(j.name)}</td><td class="mono">${j.free.join(' ')}</td><td class="mono">${j.axes.map((a) => `${a.quasi_static ? '<span class="muted">' : ''}${a.axis} ${fmt(a.lo, a)}…${fmt(a.hi, a)}${a.unit === 'deg' ? '°' : ' mm'}${a.quasi_static ? ' ·massless</span>' : ''}`).join('<br>')}</td><td class="n">${j.axes.map((a) => a.K.toFixed(a.unit === 'mm' ? 0 : 1) + (a.unit === 'mm' ? ' N/m' : ' Nm/rad')).join('<br>')}</td><td class="mono">${(j.coupled || []).join(' ') || '—'}${j.offdiag ? '<br>cross-axis spring' : ''}</td><td style="white-space:normal; max-width:34ch" class="muted">${j.notes || ''}</td></tr>`; });
    document.getElementById('t-joints').innerHTML = h;
    document.getElementById('model-sum').textContent = `Model of the selected gait: ${MM.bones.length} bones, ${MM.nq} degrees of freedom (6 for the floating trunk), ${MM.nm} muscles, ${MM.ntheta} optimizable joint parameters. Body mass ${MM.mass} kg. Right limbs mirror the left.${MM.nq > 29 ? ' Massless axes are the quasi-static joint play.' : ''}`;
  }
  function findings() {
    const seq = speeds.map((v) => [v, FAM[famIndex[bestAt[v].fam]][1]]); const runs = [];
    seq.forEach(([v, g]) => { if (runs.length && runs[runs.length - 1].g === g) runs[runs.length - 1].b = v; else runs.push({ g, a: v, b: v }); });
    const txt = runs.map((r) => r.a === r.b ? `<b>${r.g.toLowerCase()}</b> at ${r.a.toFixed(1)} m/s` : `<b>${r.g.toLowerCase()}</b> from ${r.a.toFixed(1)} to ${r.b.toFixed(1)} m/s`).join(', ');
    document.getElementById('finding').innerHTML = `In 3D, with lateral balance to pay for, the cheapest gaits found were ${txt}. ${D.finding_extra || ''}`;
  }
  function muscles() {
    const MM = MOD(cur), sec = document.getElementById('mus-section');
    if (!MM.segments || !MM.muscles[0].mass) { sec.hidden = true; return; } sec.hidden = false;
    const region = (mu) => /^[LR]F_/.test(mu.name) ? 0 : /^[LR]H_/.test(mu.name) ? 1 : /^[LR][1-9]_/.test(mu.name) ? 3 : 2;
    const RG = [['forelimb', '--s1'], ['hindlimb', '--s2'], ['spine, neck, tail', '--s3'], ['middle legs', '--s4']];
    const ms = MM.muscles.filter((mu) => !isRight(mu.name) && !/_R$/.test(mu.name));
    const W = 460, H = 330, ml = 52, mr = 12, mt = 10, mb = 40;
    const lx = (v) => Math.log10(v), fx = [lx(40), lx(3000)], fy = [lx(5), lx(2000)];
    const X = (F) => ml + (lx(F) - fx[0]) / (fx[1] - fx[0]) * (W - ml - mr), Y = (g) => H - mb - (lx(g) - fy[0]) / (fy[1] - fy[0]) * (H - mt - mb);
    let h = '';
    [50, 100, 200, 500, 1000, 2000].forEach((v) => { h += `<line x1="${X(v)}" x2="${X(v)}" y1="${mt}" y2="${H - mb}" stroke="${T.rule}"/><text x="${X(v)}" y="${H - mb + 14}" text-anchor="middle">${v}</text>`; });
    [10, 30, 100, 300, 1000].forEach((v) => { h += `<line x1="${ml}" x2="${W - mr}" y1="${Y(v)}" y2="${Y(v)}" stroke="${T.rule}"/><text x="${ml - 6}" y="${Y(v) + 4}" text-anchor="end">${v}</text>`; });
    const sig = MM.muscles[0].F0 / MM.muscles[0].pcsa;               // specific tension (Pa)
    document.getElementById('mus-sigma').textContent = (sig / 1e6).toFixed(2);
    [0.03, 0.1, 0.3].forEach((L) => { const g = (F) => 1060 * F / sig * L * 1000; const a = [40, g(40)], b = [3000, g(3000)];
      h += `<line x1="${X(a[0])}" y1="${Y(Math.max(a[1], 5))}" x2="${X(b[0])}" y2="${Y(Math.min(b[1], 2000))}" stroke="${T.muted}" stroke-dasharray="4 4" stroke-width="1"/><text x="${X(1400)}" y="${Y(g(1400)) - 6}" style="font-size:10px">${Math.round(L * 100)} cm fibres</text>`; });
    ms.forEach((mu) => { const c = tok(RG[region(mu)][1]); h += `<circle class="mpt" data-n="${mu.name}" cx="${X(mu.F0)}" cy="${Y(mu.mass * 1000)}" r="5" fill="${c}" stroke="${T.surface}" stroke-width="1.5"/>`; });
    h += `<text class="axis-label" x="${(ml + W - mr) / 2}" y="${H - 6}" text-anchor="middle">strength, max isometric force (N)</text><text class="axis-label" transform="translate(12 ${(mt + H - mb) / 2}) rotate(-90)" text-anchor="middle">muscle mass (g)</text>`;
    const svg = document.getElementById('massvs'); svg.innerHTML = h;
    svg.querySelectorAll('.mpt').forEach((el) => { const mu = ms.find((x) => x.name === el.dataset.n); el.addEventListener('mousemove', (e) => showTip(e, `<b>${mu.name.replace(/^L[FH]_|_L$/g, '').replace(/^L([1-9])_/, 'M$1 ')}</b><br>${mu.F0} N · ${(mu.mass * 1000).toFixed(0)} g<br>fibres ${(mu.lopt * 100).toFixed(1)} cm · cross-section ${(mu.pcsa * 1e4).toFixed(1)} cm²`)); el.addEventListener('mouseleave', hideTip); });
    document.getElementById('mus-legend').innerHTML = RG.filter((r, k) => ms.some((mu) => region(mu) === k)).map(([n, c]) => `<span><svg width="10" height="10" aria-hidden="true"><circle cx="5" cy="5" r="4" fill="${tok(c)}"/></svg>${n}</span>`).join('');
    // segment bars
    const seg = MM.segments.filter((x) => !isRight(x.name)); const mx = Math.max(...seg.map((x) => x.mass));
    const rowH = Math.min(22, (330 - 20) / seg.length), lab = 110, bw = 460 - lab - 60; let g = '';
    seg.forEach((x, i) => { const y = 6 + i * rowH, wm = bw * x.muscle / mx, wt = bw * x.mass / mx;
      g += `<text x="0" y="${y + rowH * 0.62}">${legLabel(x.name).replace('_', ' ')}</text><rect x="${lab}" y="${y + 2}" width="${Math.max(0, wt).toFixed(1)}" height="${rowH - 5}" rx="3" fill="${T.surface2}" stroke="${T.rule}"/><rect x="${lab}" y="${y + 2}" width="${Math.max(0, wm).toFixed(1)}" height="${rowH - 5}" rx="3" fill="${T.accent}"/><text x="${lab + wt + 6}" y="${y + rowH * 0.62}">${x.mass.toFixed(2)} kg</text>`; });
    const svg2 = document.getElementById('segbars'); svg2.setAttribute('viewBox', `0 0 460 ${Math.ceil(10 + seg.length * rowH)}`); svg2.innerHTML = g;
    const tot = MM.segments.reduce((a, x) => a + x.muscle, 0);
    document.getElementById('seg-sub').innerHTML = `Segment masses used by the dynamics. <span style="color:var(--accent); font-weight:600">Muscle</span> (${tot.toFixed(1)} kg, ${(100 * tot / MM.mass).toFixed(0)}% of body mass) sits on the bone its belly lies along; bone, skin, organs and pads make up the rest of the ${MM.mass} kg. Left side and the axial skeleton.`;
  }
  function variants() {
    if (D.compare) return compareTable(D.compare);
    const V = (D.variants || [])[0], sec = document.getElementById('var-section'); if (!V || !V.default) { sec.hidden = true; return; }
    const sv = SOL.find((s) => s.summary.variant === V.name);
    document.getElementById('var-h').textContent = D.variantTitle || `Same dog, ${V.label}`;
    document.getElementById('var-sub').textContent = `Scapula, humerus, forearm and paw each twice as long; everything else as the default body. Longer muscles are heavier (mass scales with fibre length) and longer bones carry more bone and skin, so the body weighs ${V.variant.mass} kg instead of ${V.default.mass} kg; its trunk, organs and head are unchanged. Cold-started walk at ${V.speed.toFixed(1)} m/s, bones kept apart, head kept steady.`;
    const a = V.default, b = V.variant;
    const rows = [['Body mass', `${a.mass} kg`, `${b.mass} kg`], ['Cost of transport (per kg)', a.cot.toFixed(3), b.cot.toFixed(3)], ['Metabolic power', `${a.power} W`, `${b.power} W`],
      ['Gait', a.gait, b.gait], ['Stride period · length', `${a.T.toFixed(2)} s · ${a.stride.toFixed(2)} m`, `${b.T.toFixed(2)} s · ${b.stride.toFixed(2)} m`], ['Duty factor fore / hind', `${a.duty_fore} / ${a.duty_hind}`, `${b.duty_fore} / ${b.duty_hind}`],
      ['Mean back pitch (nose up +)', `${a.pitch.toFixed(0)}°`, `${b.pitch.toFixed(0)}°`], ['Head height', `${a.head_height} m`, `${b.head_height} m`], ['Head rotation (RMS)', `${a.head_rot.toFixed(0)}°/s`, `${b.head_rot.toFixed(0)}°/s`],
      ...['LF_shoulder', 'LF_elbow', 'LF_carpus', 'LH_hip', 'LH_knee', 'LH_hock'].map((j) => [`${j.slice(3)} flexion range`, `${a.rom[j].toFixed(0)}°`, `${b.rom[j].toFixed(0)}°`])];
    document.getElementById('t-var').innerHTML = '<tr><th></th><th class="n">Default body</th><th class="n">Forelimbs ×2</th></tr>' + rows.map((r) => `<tr><td>${r[0]}</td><td class="n">${r[1]}</td><td class="n">${r[2]}</td></tr>`).join('');
    const btn = document.getElementById('var-show'); if (sv) btn.addEventListener('click', () => { select(sv); document.querySelector('.main').scrollIntoView({ behavior: 'smooth', block: 'start' }); }); else btn.hidden = true;
  }
  function compareTable(C) {
    document.getElementById('var-h').textContent = C.title;
    document.getElementById('var-sub').textContent = C.sub;
    const cols = C.cols, many = cols.some((c) => c.legs > 4);
    const rows = [['Body mass', (c) => `${c.mass} kg`], ['Legs', (c) => c.legs], ['Cost of transport (per kg)', (c) => c.cot.toFixed(3)], ['Metabolic power', (c) => `${c.power} W`],
      ['Gait', (c) => c.gait], ['Stride period · length', (c) => `${c.T.toFixed(2)} s · ${c.stride.toFixed(2)} m`], [many ? 'Duty factor fore / (middle) / hind' : 'Duty factor fore / hind', (c) => c.duty],
      ['Mean back pitch (nose up +)', (c) => `${c.pitch.toFixed(0)}°`], ['Head height', (c) => `${c.head_height} m`], ['Head rotation (RMS)', (c) => `${c.head_rot.toFixed(0)}°/s`], ['Closest bones', (c) => `${c.clearance} mm`],
      ...['shoulder', 'elbow', 'carpus', 'hip', 'knee', 'hock'].map((j) => [`${j[0].toUpperCase() + j.slice(1)} flexion range`, (c) => `${c.rom[j].toFixed(0)}°`])];
    document.getElementById('t-var').innerHTML = '<tr><th></th>' + cols.map((c) => `<th class="n">${c.label}</th>`).join('') + '</tr>' +
      rows.map(([k, f]) => `<tr><td>${k}</td>${cols.map((c) => `<td class="n">${f(c)}</td>`).join('')}</tr>`).join('');
    document.getElementById('var-show').hidden = true;
  }
  function dof6() {
    const X = D.dof6, sec = document.getElementById('d6-section'); if (!X) { sec.hidden = true; return; }
    const s6 = SOL.find((s) => s.summary.dof6);
    document.getElementById('d6-sub').textContent = `The same dog with every joint free in all six axes (${X.nq} degrees of freedom): each pair of bone ends can take any relative position and orientation, pushed back by passive forces that depend on the whole relative pose and velocity. Joint play (${X.n_quasi} axes: millimetre translations, few-degree off-axis rotations) is quasi-static. Trot at ${X.speed.toFixed(1)} m/s; excursion over one stride, and the peak passive force along each translation axis.`;
    const ax = ['rx', 'ry', 'rz', 'tx', 'ty', 'tz'], lab = { rx: 'roll / abd', ry: 'yaw / axial', rz: 'flex / ext', tx: 'fore-aft', ty: 'along limb', tz: 'lateral' };
    let h = `<tr><th>Joint</th>${ax.map((a) => `<th class="n">${lab[a]}</th>`).join('')}<th class="n">Peak force fore-aft · along · lateral</th></tr>`;
    X.rows.forEach((r) => { h += `<tr><td>${legLabel(r.joint)}</td>${ax.map((a) => { const v = r.axes[a]; return v ? `<td class="n${v.quasi_static ? ' muted' : ''}">${v.range.toFixed(v.unit === 'deg' ? 1 : 2)}${v.unit === 'deg' ? '°' : ' mm'}</td>` : '<td class="n muted">—</td>'; }).join('')}<td class="n">${['tx', 'ty', 'tz'].map((a) => r.peak_force_bw[a] != null ? r.peak_force_bw[a].toFixed(1) : '—').join(' · ')} <span class="muted">BW</span></td></tr>`; });
    document.getElementById('t-d6').innerHTML = h;
    const v = X.verify || {};
    document.getElementById('d6-note').innerHTML = `Cost of transport ${X.cot.toFixed(3)} vs ${X.cot29.toFixed(3)} for the same gait with hinge and ball joints (${X.cot > X.cot29 ? '+' : ''}${((X.cot / X.cot29 - 1) * 100).toFixed(0)}%). Grey values are massless axes. Re-simulated with a stiff integrator, the dynamic joints stay within ${(v.interval_q_err_deg || 0).toFixed(2)}° per step (median ${(v.interval_q_err_deg_median || 0).toFixed(2)}°). The joint play is exact at the 50 nodes; between nodes its interpolated position is within ${(v.quasi_static_offset_mm_median || 0).toFixed(1)} mm and ${(v.quasi_static_offset_deg_median || 0).toFixed(1)}° of the position that balances the loads (median; worst ${(v.quasi_static_offset_mm || 0).toFixed(1)} mm, ${(v.quasi_static_offset_deg || 0).toFixed(1)}°), because play inside an envelope is loose until a wall engages. Joint-play stiffnesses and ranges are order-of-magnitude assumptions, not dog measurements.`;
    const b = document.getElementById('d6-show'); if (s6) b.addEventListener('click', () => { select(s6); document.querySelector('.main').scrollIntoView({ behavior: 'smooth', block: 'start' }); }); else b.hidden = true;
  }
  function select(s) { cur = s; phase = 0; cam.dist = 1.75 * Math.max(1, heightOf(s) / 0.85); markMode(); buildStrip(); buildSelect(); readout(); footfall(); heatmap(); cotChart(); romUsage(); hipPlot(); jointTable();
    document.getElementById('act-sub').textContent = `Left limbs and the left side of the trunk, neck and tail, ${pretty(s.summary.gait).toLowerCase()} at ${s.summary.speed.toFixed(1)} m/s. Colour is activation, 0 to 1.`; muscles(); }
  function redraw() { readTokens(); resize(cv); rampLegend(); select(cur); codesign(); fitPlot(); }
  window.addEventListener('resize', () => { resize(cv); heatmap(); cotChart(); });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', redraw);
  new MutationObserver(redraw).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  function modes() {
    const MD = D.modes; if (!MD) return false;
    ['best-section', 'cot-section', 'cd-section', 'd6-section', 'fit-section', 'sel-label', 'var-show'].forEach((id) => { const el = document.getElementById(id); if (el) el.hidden = true; });
    if (D.lede) document.querySelector('.lede').textContent = D.lede;
    const un = document.getElementById('update-note'); if (D.note) un.innerHTML = D.note; else un.hidden = true;
    document.getElementById('eyebrow').textContent = D.eyebrow || document.getElementById('eyebrow').textContent;
    const sec = document.getElementById('mode-section'), sw = document.getElementById('mode-switch'); sec.hidden = false;
    MD.forEach((md, i) => { const b = document.createElement('button'); b.setAttribute('role', 'radio'); b.dataset.i = i;
      b.innerHTML = `${md.thumb ? `<img class="mode-img" src="${md.thumb}" alt="">` : ''}<span class="mode-k">${md.kicker}</span><span class="mode-l">${md.label}</span><span class="mode-s">${md.sub}</span>`;
      b.addEventListener('click', () => select(SOL[md.sol])); sw.appendChild(b); });
    sw.addEventListener('keydown', (e) => { if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return; e.preventDefault();
      const i = MD.findIndex((md) => SOL[md.sol] === cur), j = (i + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : MD.length - 1)) % MD.length; select(SOL[MD[j].sol]); sw.children[j].focus(); });
    cur = SOL[MD[0].sol];
    return true;
  }
  function markMode() { if (!D.modes) return; [...document.getElementById('mode-switch').children].forEach((b, i) => { const on = SOL[D.modes[i].sol] === cur; b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; }); }
  const focusMode = modes();
  rampLegend(); if (!focusMode) { findings(); codesign(); sensitivities(); fitPlot(); dof6(); } variants(); select(cur);
  requestAnimationFrame((t) => { last = t; tick(t); });
})();
