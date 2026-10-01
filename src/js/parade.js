// Parade: every humanoid from sim/characters.js walking together across a hazy desert, each on its own
// simulated stride (bone poses, stride period and speed from its body pack), drawn as cel-shaded primitives:
// tubes with ball joints around the skeleton (the pack's outline capsules), ball heads, eyes and a few
// accessories. Standalone page (parade.html); reads only the body packs.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CHARACTERS } from '../../sim/characters.js';

const packFiles = import.meta.glob('../data/*.json', { eager: true, import: 'default' });
const packs = Object.entries(CHARACTERS).map(([key, c]) => ({ key, c, pack: packFiles[`../data/${c.file}`] })).filter((p) => p.pack);

// ---------- looks: colours per body region, face and accessories (pastel, after the reference art)
const LOOKS = {
  biped: { skin: '#f2ae90', top: '#8fd6b8', bottom: '#8c84c4', shoes: '#4f4a66', cheeks: true },
  kid: { skin: '#f5c7a6', top: '#e2654f', bottom: '#f5e6c8', shoes: '#b86a50', cheeks: true, beanie: '#e2654f' },
  ogre: { skin: '#9fae72', top: '#7d5540', bottom: '#b8906a', shoes: '#5a4032', nose: true, ears: true },
  giant: { skin: '#b7aee0', top: '#5f76a6', bottom: '#465a86', shoes: '#3a3f5c', nose: true },
  bobble: { skin: '#6b5ea8', top: '#7f6fb8', bottom: '#ea8a72', shoes: '#b86a50', bigEyes: '#f4d268', fins: '#8c84c4' },
  hood: { skin: '#f2ae90', top: '#4f9486', bottom: '#7d5540', shoes: '#3e5f52', hood: '#4f9486' },
  stilts: { skin: '#f5e6c8', top: '#b86a50', bottom: '#f5e6c8', shoes: '#7d5540', topHat: '#3e3a4a', cheeks: true },
  pear: { skin: '#f2ae90', top: '#5f76a6', bottom: '#5f76a6', shoes: '#465a86', hood: '#5f76a6' },
  brute: { skin: '#e8a07a', top: '#6f9c7c', bottom: '#8a6448', shoes: '#5a4032', ears: true },
};
const DEFAULT_LOOK = { skin: '#f2ae90', top: '#8fd6b8', bottom: '#8c84c4', shoes: '#4f4a66' };
const regionColor = (bone, look) => (/head|neck|manus|antebrachium/.test(bone) ? look.skin : /pes|digits/.test(bone) ? look.shoes : /femur|tibia|pelvis/.test(bone) ? look.bottom : look.top);

// parts in bone frames: tube (capsule a-b, radius r), ball (centre c, radii s along the bone axes), cone (base a, tip b, radius r)
function buildParts(key, model) {
  const look = LOOKS[key] || DEFAULT_LOOK, parts = [];
  for (const [bone, a, b, r] of model.outline) {
    if (bone === 'head') continue;                                            // the head is drawn below, with its face
    const color = regionColor(bone, look);
    if (a[0] === b[0] && a[1] === b[1] && a[2] === b[2]) parts.push({ kind: 'ball', bone, c: a, s: [r, r, r], color });
    else parts.push({ kind: 'tube', bone, a, b, r, color });
  }
  const { center: c, radius: R } = model.head_circle, at = (el, az, d = 1) => [c[0] + R * d * Math.cos(el) * Math.cos(az), c[1] + R * d * Math.sin(el), c[2] + R * d * Math.cos(el) * Math.sin(az)];
  parts.push({ kind: 'ball', bone: 'head', c, s: [R, R, R], color: look.skin, head: true });
  for (const side of [1, -1]) {
    if (look.bigEyes) { parts.push({ kind: 'ball', bone: 'head', c: at(0.18, side * 0.42, 0.93), s: [0.1 * R, 0.3 * R, 0.3 * R], color: look.bigEyes, detail: 8 });
      parts.push({ kind: 'ball', bone: 'head', c: at(0.18, side * 0.42, 1.02), s: [0.05 * R, 0.12 * R, 0.12 * R], color: '#2c2838' }); }
    else parts.push({ kind: 'ball', bone: 'head', c: at(0.12, side * 0.36, 0.96), s: [0.07 * R, 0.19 * R, 0.14 * R], color: '#2c2838' });
    if (look.cheeks) parts.push({ kind: 'ball', bone: 'head', c: at(-0.22, side * 0.62, 0.93), s: [0.05 * R, 0.13 * R, 0.17 * R], color: '#ef9a9a' });
    if (look.ears) parts.push({ kind: 'ball', bone: 'head', c: at(0.05, side * 1.45, 0.95), s: [0.14 * R, 0.26 * R, 0.1 * R], color: look.skin });
    if (look.fins) parts.push({ kind: 'cone', bone: 'head', a: at(0.1, side * 1.4, 0.8), b: at(0.45, side * 2.0, 1.7), r: 0.28 * R, color: look.fins });
  }
  if (look.nose) parts.push({ kind: key === 'giant' ? 'cone' : 'ball', bone: 'head', a: at(-0.05, 0, 0.9), b: at(-0.15, 0, 1.45), c: at(-0.05, 0, 1.0), s: [0.22 * R, 0.2 * R, 0.2 * R], r: 0.13 * R, color: look.skin });
  if (look.beanie) { parts.push({ kind: 'ball', bone: 'head', c: [c[0] - 0.05 * R, c[1] + 0.3 * R, c[2]], s: [1.04 * R, 0.85 * R, 1.04 * R], color: look.beanie });
    parts.push({ kind: 'ball', bone: 'head', c: [c[0] - 0.1 * R, c[1] + 1.2 * R, c[2]], s: [0.3 * R, 0.3 * R, 0.3 * R], color: '#f5e6c8' }); }
  if (look.hood) parts.push({ kind: 'ball', bone: 'head', c: [c[0] - 0.5 * R, c[1] + 0.15 * R, c[2]], s: [1.4 * R, 1.45 * R, 1.3 * R], color: look.hood });
  if (look.topHat) { parts.push({ kind: 'cyl', bone: 'head', a: [c[0], c[1] + 0.75 * R, c[2]], b: [c[0], c[1] + 0.85 * R, c[2]], r: 1.25 * R, color: look.topHat });
    parts.push({ kind: 'cyl', bone: 'head', a: [c[0], c[1] + 0.8 * R, c[2]], b: [c[0], c[1] + 2.3 * R, c[2]], r: 0.8 * R, color: look.topHat }); }
  return parts;
}

// ---------- scene
const wrapEl = document.getElementById('scene'), canvas = document.getElementById('parade');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene(), HAZE = new THREE.Color('#f3d9a4');
scene.fog = new THREE.Fog(HAZE, 7, 48);
const camera = new THREE.PerspectiveCamera(34, 16 / 9, 0.1, 300);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true; controls.maxPolarAngle = 1.52; controls.minDistance = 3; controls.maxDistance = 45;

// cel shading: three flat tones
const ramp = new THREE.DataTexture(new Uint8Array([120, 190, 255]), 3, 1, THREE.LuminanceFormat);
ramp.minFilter = ramp.magFilter = THREE.NearestFilter; ramp.generateMipmaps = false; ramp.needsUpdate = true;
const toon = (color, extra = {}) => new THREE.MeshToonMaterial({ color, gradientMap: ramp, ...extra });

scene.add(new THREE.HemisphereLight('#e2f5cf', '#e8b878', 0.55));
const sun = new THREE.DirectionalLight('#fff0d6', 0.62);
sun.position.set(-6, 14, 9); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0006; sun.shadow.radius = 4;
Object.assign(sun.shadow.camera, { left: -26, right: 26, top: 16, bottom: -16, near: 1, far: 60 });
sun.target.position.set(-8, 0, 0); scene.add(sun, sun.target);

const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), toon('#ecc59a'));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);

// scenery: faceted mesas and pyramids in the haze, standing stones, a few rocks by the track
const rand = (() => { let s = 7; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; })();
// far scenery (mesas, pillars) is a backdrop that travels with the camera; rocks by the route repeat along it
const props = new THREE.Group(), backdrop = new THREE.Group(); scene.add(props, backdrop);
const PROP_MIN = -110, PROP_SPAN = 170;
// faceted: non-indexed geometry gets one normal per face
const addProp = (geo, color, x, z, rotY = 0, shadow = false, group = props) => { const flat = geo.index ? geo.toNonIndexed() : geo; flat.computeVertexNormals(); const m = new THREE.Mesh(flat, toon(color)); m.userData.x = x; m.position.set(x, 0, z); m.rotation.y = rotY; m.castShadow = shadow; m.receiveShadow = true; group.add(m); return m; };
[[-70, -34, 22, 28], [-58, 30, 16, 20], [-95, 6, 30, 40], [-40, -48, 14, 18], [-30, 46, 18, 24], [-120, -30, 36, 46], [15, -50, 20, 26]].forEach(([x, z, h, r], i) => {
  const g = new THREE.ConeGeometry(r, h, 4 + (i % 2), 1); g.translate(0, h / 2, 0); addProp(g, ['#dd9a72', '#cf8a66', '#e4ab80'][i % 3], x, z, rand() * 3, false, backdrop); });
[[-48, 14, 11, 3.2], [-40, -22, 8, 2.4], [-64, -8, 14, 3.8]].forEach(([x, z, h, r]) => { const g = new THREE.CylinderGeometry(r * 0.7, r, h, 6, 1); g.translate(0, h / 2, 0); addProp(g, '#b98a7a', x, z, rand() * 3, false, backdrop); });
for (let i = 0; i < 40; i++) { const r = 0.2 + rand() * 0.6, g = new THREE.DodecahedronGeometry(r, 0); g.translate(0, r * 0.5, 0);
  addProp(g, ['#d9a47a', '#c99373', '#e3b58c'][i % 3], PROP_MIN + rand() * PROP_SPAN, (rand() < 0.5 ? -1 : 1) * (5.5 + rand() * 12), rand() * 3, true); }
const placeProps = (camX) => props.children.forEach((m) => { m.position.x = camX + PROP_MIN + ((((m.userData.x - PROP_MIN - camX) % PROP_SPAN) + PROP_SPAN) % PROP_SPAN); });

// ---------- walkers: instanced primitives, one instance per part
const walkers = [];
// the camera travels with the crowd at CRUISE; walkers at that speed keep their place in the formation, slower ones
// drift back through it into the haze and come round again from behind the camera (the route loops around the camera)
const CRUISE = 1.0, X_MIN = -30, X_MAX = 12, TRACK = X_MAX - X_MIN;
// starting place in the crowd, metres ahead (+) or behind (-) of its middle; tall walkers further back
const FORMATION = { kid: 2.2, bobble: 0.8, biped: -0.8, hood: 0.2, pear: -2.4, brute: -1.6, ogre: -4.2, stilts: -3.2, giant: -5.6 };
let laneZ = -4.2;
// tall bodies walk in the far lanes; each lane is as wide as its walker's widest reach
const order = [...packs].sort((a, b) => b.pack.model.height - a.pack.model.height);
order.forEach(({ key, c, pack }, i) => {
  const model = pack.model, sol = pack.solution, idx = Object.fromEntries(model.bones.map((b, j) => [b.name, j]));
  let half = 0.2; sol.poses.forEach((rows) => model.outline.forEach(([bone, a, b, r]) => { const row = rows[idx[bone]], root = rows[idx[model.root]];
    for (const p of [a, b]) half = Math.max(half, Math.abs(row[11] + row[2] * p[0] + row[5] * p[1] + row[8] * p[2] - root[11]) + r); }));
  laneZ += half; const z = laneZ; laneZ += half + 0.12;
  walkers.push({ key, label: c.label, model, sol, idx, parts: buildParts(key, model), z, T: sol.summary.T, speed: sol.summary.speed, S: sol.summary.stride_length,
    x0: -4 + (FORMATION[key] ?? -2 - i * 0.7), t0: rand() * sol.summary.T, look: LOOKS[key] || DEFAULT_LOOK });
});
const zMid = (walkers[0].z + walkers[walkers.length - 1].z) / 2; walkers.forEach((w) => { w.z -= zMid; });

const counts = { ball: 0, tube: 0, cone: 0, cyl: 0 };
walkers.forEach((w) => w.parts.forEach((p) => { counts[p.kind]++; if (p.kind === 'tube') counts.ball += 2; }));
const mat = toon('#ffffff');
const meshes = {
  ball: new THREE.InstancedMesh(new THREE.SphereGeometry(1, 14, 10), mat, counts.ball),
  tube: new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 12, 1, true), mat, counts.tube),
  cone: new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 8, 1), mat, Math.max(1, counts.cone)),
  cyl: new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 16, 1), mat, Math.max(1, counts.cyl)),
};
Object.entries(meshes).forEach(([kind, m]) => { m.count = counts[kind]; m.castShadow = true; m.receiveShadow = true; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.frustumCulled = false; scene.add(m); });
// low-poly eyes (the reference's octagons) come from a separate 8-sided ball
const eyeBall = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), mat, Math.max(1, walkers.reduce((n, w) => n + w.parts.filter((p) => p.detail).length, 0)));
eyeBall.frustumCulled = false; scene.add(eyeBall);
// fixed instance slots and colours
const slot = { ball: 0, tube: 0, cone: 0, cyl: 0, eye: 0 }, color = new THREE.Color();
walkers.forEach((w) => w.parts.forEach((p) => { color.set(p.color);
  if (p.kind === 'tube') { p.slots = [slot.tube++, slot.ball++, slot.ball++]; meshes.tube.setColorAt(p.slots[0], color); meshes.ball.setColorAt(p.slots[1], color); meshes.ball.setColorAt(p.slots[2], color); }
  else if (p.detail) { p.slots = [slot.eye++]; eyeBall.setColorAt(p.slots[0], color); }
  else { p.slots = [slot[p.kind]++]; meshes[p.kind].setColorAt(p.slots[0], color); } }));

// ---------- pose playback (as the atlas viewer: blend neighbouring frames; the next stride starts one stride length on)
function poseAt(w, time) {
  const local = time + w.t0, cycles = Math.floor(local / w.T), phase = local / w.T - cycles, frames = w.sol.poses, n = frames.length;
  const x = phase * n, f = Math.floor(x) % n, blend = x - Math.floor(x), g = (f + 1) % n, wrap = g === 0 ? w.S : 0;
  const rows = frames[f].map((row, b) => { const next = frames[g][b]; return row.map((v, i) => v * (1 - blend) + (next[i] + (i === 9 ? wrap : 0)) * blend); });
  // place on the route, which loops around the travelling camera; x0 is the place in the crowd at time 0
  const shift = cycles * w.S - w.speed * w.t0 + w.x0, rootX = rows[w.idx[w.model.root]][9] + shift, lap = Math.floor((rootX - CRUISE * time - X_MIN) / TRACK);
  return { rows, dx: shift - lap * TRACK };
}
const tmpM = new THREE.Matrix4(), basis = new THREE.Matrix4(), pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scl = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), dir = new THREE.Vector3();
const world = (rows, w, bone, p, dx) => { const r = rows[w.idx[bone]]; return new THREE.Vector3(r[9] + r[0] * p[0] + r[3] * p[1] + r[6] * p[2] + dx, r[10] + r[1] * p[0] + r[4] * p[1] + r[7] * p[2], r[11] + r[2] * p[0] + r[5] * p[1] + r[8] * p[2] + w.z); };
function setSegment(mesh, i, A, B, r) {
  dir.subVectors(B, A); const len = dir.length() || 1e-6; dir.divideScalar(len);
  quat.setFromUnitVectors(up, dir); pos.addVectors(A, B).multiplyScalar(0.5); scl.set(r, len, r);
  mesh.setMatrixAt(i, tmpM.compose(pos, quat, scl));
}
function setBall(mesh, i, rows, w, part, dx) {
  const r = rows[w.idx[part.bone]], C = world(rows, w, part.bone, part.c, dx);
  basis.set(r[0], r[3], r[6], 0, r[1], r[4], r[7], 0, r[2], r[5], r[8], 0, 0, 0, 0, 1);  // columns: the bone's X, Y, Z in the world
  quat.setFromRotationMatrix(basis); scl.set(...part.s);
  mesh.setMatrixAt(i, tmpM.compose(C, quat, scl));
}
const headTops = [];
function updateWalkers(time) {
  walkers.forEach((w, wi) => {
    const { rows, dx } = poseAt(w, time);
    for (const p of w.parts) {
      if (p.kind === 'tube') { const A = world(rows, w, p.bone, p.a, dx), B = world(rows, w, p.bone, p.b, dx);
        setSegment(meshes.tube, p.slots[0], A, B, p.r); meshes.ball.setMatrixAt(p.slots[1], tmpM.compose(A, quat.identity(), scl.set(p.r, p.r, p.r))); meshes.ball.setMatrixAt(p.slots[2], tmpM.compose(B, quat.identity(), scl.set(p.r, p.r, p.r))); }
      else if (p.kind === 'cone' || p.kind === 'cyl') { const A = world(rows, w, p.bone, p.a, dx), B = world(rows, w, p.bone, p.b, dx); setSegment(meshes[p.kind], p.slots[0], A, B, p.r); }
      else setBall(p.detail ? eyeBall : meshes.ball, p.slots[0], rows, w, p, dx);
    }
    const hc = w.model.head_circle; headTops[wi] = world(rows, w, 'head', [hc.center[0], hc.center[1] + hc.radius * (w.look.topHat ? 2.7 : 1.7), hc.center[2]], dx);
  });
  [...Object.values(meshes), eyeBall].forEach((m) => { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; });
}

// ---------- name tags
const tagLayer = document.getElementById('tags');
const tags = walkers.map((w) => { const el = document.createElement('span'); el.className = 'tag'; el.textContent = w.label; tagLayer.appendChild(el); return el; });
const namesInput = document.getElementById('names');
function placeTags() {
  tagLayer.hidden = !namesInput.checked; if (tagLayer.hidden) return;
  const wpx = canvas.clientWidth, hpx = canvas.clientHeight, v = new THREE.Vector3();
  headTops.forEach((p, i) => { v.copy(p).project(camera); const d = camera.position.distanceTo(p);
    const show = v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05 && d < 40;
    tags[i].style.display = show ? '' : 'none'; if (show) { tags[i].style.transform = `translate(${((v.x + 1) / 2 * wpx).toFixed(1)}px, ${((1 - v.y) / 2 * hpx).toFixed(1)}px) translate(-50%, -100%)`; tags[i].style.opacity = String(Math.max(0.25, Math.min(1, (40 - d) / 18))); } });
}

// ---------- camera views
// camera views, relative to the travelling camera's origin (camX)
const VIEWS = {
  approach: { pos: [5.2, 1.7, 3.8], target: [-3.6, 1.2, 0.2] },
  side: { pos: [-5.5, 2.2, 13.5], target: [-5.5, 1.2, 0] },
  low: { pos: [4.2, 0.45, 2.4], target: [-4, 1.9, 0] },
  high: { pos: [4, 11, 10], target: [-4, 0, 0] },
};
let camX = 0;
function setView(name) { const v = VIEWS[name]; camera.position.set(v.pos[0] + camX, v.pos[1], v.pos[2]); controls.target.set(v.target[0] + camX, v.target[1], v.target[2]); controls.update();
  document.querySelectorAll('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === name))); }
document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
controls.addEventListener('start', () => document.querySelectorAll('[data-view]').forEach((b) => b.setAttribute('aria-pressed', 'false')));
setView('approach');

// ---------- legend
document.getElementById('legend').innerHTML = [...walkers].sort((a, b) => Object.keys(CHARACTERS).indexOf(a.key) - Object.keys(CHARACTERS).indexOf(b.key)).map((w) =>
  `<li><span class="swatch" style="background:${w.look.top}"></span><span class="swatch" style="background:${w.look.skin}"></span><b>${w.label}</b> <span class="mono">${w.model.height.toFixed(2)} m · ${w.speed.toFixed(1)} m/s · ${w.T.toFixed(2)} s stride</span></li>`).join('');

// ---------- loop
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let playing = !reduceMotion, rate = 1, simTime = 0, last = performance.now();
const playBtn = document.getElementById('play'), rateInput = document.getElementById('rate'), rateOut = document.getElementById('rate-v');
const setPlaying = (p) => { playing = p; playBtn.textContent = p ? 'Pause' : 'Play'; playBtn.setAttribute('aria-pressed', String(p)); };
setPlaying(playing); playBtn.addEventListener('click', () => setPlaying(!playing));
rateInput.addEventListener('input', () => { rate = +rateInput.value; rateOut.textContent = `${rate.toFixed(2)}×`; });
namesInput.addEventListener('change', placeTags);
function resize() { const w = wrapEl.clientWidth, h = wrapEl.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
new ResizeObserver(resize).observe(wrapEl); resize();
let visible = true; new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(wrapEl);
// the camera, its orbit target, the sun (and its shadow box) and the ground travel with the crowd
function travel(time) {
  const x = CRUISE * time, d = x - camX; camX = x;
  camera.position.x += d; controls.target.x += d; sun.position.x += d; sun.target.position.x += d; ground.position.x = x; backdrop.position.x = x; placeProps(x);
}
function draw() { travel(simTime); updateWalkers(simTime); controls.update(); renderer.render(scene, camera); placeTags(); }
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (playing) simTime += dt * rate;
  if (visible) draw();
  requestAnimationFrame(frame);
}
draw(); requestAnimationFrame(frame);
// for automated checks: jump the parade to a given time
window.__parade = { walkers: walkers.map((w) => w.key), setTime: (t) => { simTime = t; draw(); }, setView };
