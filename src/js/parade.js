// Parade: every humanoid from sim/characters.js walking together on a gray ground grid, each on its own
// simulated stride, with the same skeleton, muscle paths, cross-sectional areas and activation as the atlas.
// Standalone page (parade.html); reads only the humanoid body packs.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CHARACTERS } from '../../sim/characters.js';
import { skeletonParts } from './skeleton-parts.js';
import { musclePathSegments, muscleActivationAt } from './muscle-display.js';

const packFiles = import.meta.glob('../data/*.json', { eager: true, import: 'default' });
const packs = Object.entries(CHARACTERS).map(([key, c]) => ({ key, c, pack: packFiles[`../data/${c.file}`] })).filter((p) => p.pack);

// ---------- scene
const wrapEl = document.getElementById('scene'), canvas = document.getElementById('parade');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene(), BACKGROUND = new THREE.Color('#d7d9dd');
scene.background = BACKGROUND;
scene.fog = new THREE.Fog(BACKGROUND, 7, 48);
const camera = new THREE.PerspectiveCamera(34, 16 / 9, 0.1, 300);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true; controls.maxPolarAngle = 1.52; controls.minDistance = 3; controls.maxDistance = 45;

const standard = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.7, ...extra });

scene.add(new THREE.HemisphereLight('#ffffff', '#8a8a8a', 0.55));
const sun = new THREE.DirectionalLight('#ffffff', 0.62);
sun.position.set(-6, 14, 9); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0006; sun.shadow.radius = 4;
Object.assign(sun.shadow.camera, { left: -26, right: 26, top: 16, bottom: -16, near: 1, far: 60 });
sun.target.position.set(-8, 0, 0); scene.add(sun, sun.target);

const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), standard('#c7c9cc'));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);

// One-metre grid with stronger lines every five metres, just above the shadow-receiving ground.
const GRID_MAJOR_SPACING = 5, groundGrid = new THREE.Group();
for (const [divisions, color, opacity, height] of [[200, '#9da1a7', 0.55, 0.006], [40, '#7e838b', 0.65, 0.008]]) {
  const grid = new THREE.GridHelper(200, divisions, color, color);
  grid.position.y = height; grid.material.transparent = true; grid.material.opacity = opacity;
  groundGrid.add(grid);
}
scene.add(groundGrid);

const rand = (() => { let s = 7; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; })();

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
  walkers.push({ key, label: c.label, model, sol, idx, parts: skeletonParts(model), z, T: sol.summary.T, speed: sol.summary.speed, S: sol.summary.stride_length,
    x0: -4 + (FORMATION[key] ?? -2 - i * 0.7), t0: rand() * sol.summary.T });
});
const zMid = (walkers[0].z + walkers[walkers.length - 1].z) / 2; walkers.forEach((w) => { w.z -= zMid; });

const counts = { ball: 0, tube: 0 };
walkers.forEach((w) => w.parts.forEach((p) => { counts[p.kind]++; if (p.kind === 'tube') counts.ball += 2; }));
const mat = standard('#ffffff');
const meshes = {
  ball: new THREE.InstancedMesh(new THREE.SphereGeometry(1, 14, 10), mat, counts.ball),
  tube: new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 10, 1, true), mat, counts.tube),
};
const configureInstances = (mesh) => { mesh.castShadow = true; mesh.receiveShadow = true; mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.frustumCulled = false; scene.add(mesh); };
Object.values(meshes).forEach(configureInstances);
// Fixed instance slots and bone colours.
const slot = { ball: 0, tube: 0 }, color = new THREE.Color();
walkers.forEach((w) => w.parts.forEach((p) => { color.set(p.color);
  if (p.kind === 'tube') { p.slots = [slot.tube++, slot.ball++, slot.ball++]; meshes.tube.setColorAt(p.slots[0], color); meshes.ball.setColorAt(p.slots[1], color); meshes.ball.setColorAt(p.slots[2], color); }
  else { p.slots = [slot.ball++]; meshes.ball.setColorAt(p.slots[0], color); } }));

// Each path edge has a fibre and tendon slot: their shared boundary moves with the pose.
let muscleSlots = 0;
walkers.forEach((w) => { w.muscles = w.model.muscles.map((muscle, i) => ({ muscle, i, slots: muscle.path.slice(1).map(() => muscleSlots++) })); });
const muscleMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 10), standard('#ffffff', { transparent: true, opacity: 0.7, depthWrite: false }), muscleSlots);
const tendonMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 6), standard('#c5bdab'), muscleSlots);
configureInstances(muscleMesh); configureInstances(tendonMesh);
const muscleRamp = ['#f1dfdc', '#e6aca7', '#d6716f', '#b83342', '#7e0c22'].map((c) => new THREE.Color(c));
const muscleColor = new THREE.Color(), muscleA = new THREE.Vector3(), muscleB = new THREE.Vector3(), hiddenMatrix = new THREE.Matrix4().makeScale(0, 0, 0);

// ---------- pose playback (as the atlas viewer: blend neighbouring frames; the next stride starts one stride length on)
function poseAt(w, time) {
  const local = time + w.t0, cycles = Math.floor(local / w.T), phase = local / w.T - cycles, frames = w.sol.poses, n = frames.length;
  const x = phase * n, f = Math.floor(x) % n, blend = x - Math.floor(x), g = (f + 1) % n, wrap = g === 0 ? w.S : 0;
  const rows = frames[f].map((row, b) => { const next = frames[g][b]; return row.map((v, i) => v * (1 - blend) + (next[i] + (i === 9 ? wrap : 0)) * blend); });
  // place on the route, which loops around the travelling camera; x0 is the place in the crowd at time 0
  const shift = cycles * w.S - w.speed * w.t0 + w.x0, rootX = rows[w.idx[w.model.root]][9] + shift, lap = Math.floor((rootX - CRUISE * time - X_MIN) / TRACK);
  return { rows, dx: shift - lap * TRACK, frame: f, nextFrame: g, blend };
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
    const { rows, dx, frame, nextFrame, blend } = poseAt(w, time);
    for (const p of w.parts) {
      if (p.kind === 'tube') { const A = world(rows, w, p.bone, p.a, dx), B = world(rows, w, p.bone, p.b, dx);
        setSegment(meshes.tube, p.slots[0], A, B, p.r); meshes.ball.setMatrixAt(p.slots[1], tmpM.compose(A, quat.identity(), scl.set(p.r, p.r, p.r))); meshes.ball.setMatrixAt(p.slots[2], tmpM.compose(B, quat.identity(), scl.set(p.r, p.r, p.r))); }
      else setBall(meshes.ball, p.slots[0], rows, w, p, dx);
    }
    for (const { muscle, i, slots } of w.muscles) {
      const points = muscle.path.map(([bone, point]) => world(rows, w, bone, point, dx).toArray());
      const activation = Math.min(1, Math.max(0, muscleActivationAt(w.sol, i, frame, nextFrame, blend))), rampPos = activation * (muscleRamp.length - 1), rampIdx = Math.min(muscleRamp.length - 2, Math.floor(rampPos));
      muscleColor.copy(muscleRamp[rampIdx]).lerp(muscleRamp[rampIdx + 1], rampPos - rampIdx);
      for (const id of slots) { muscleMesh.setMatrixAt(id, hiddenMatrix); tendonMesh.setMatrixAt(id, hiddenMatrix); muscleMesh.setColorAt(id, muscleColor); }
      for (const segment of musclePathSegments(muscle, points)) {
        const radius = segment.tendon ? Math.max(0.0015, 0.002 * w.model.height / 1.32) : Math.sqrt(muscle.pcsa / Math.PI);
        setSegment(segment.tendon ? tendonMesh : muscleMesh, slots[segment.index], muscleA.fromArray(segment.from), muscleB.fromArray(segment.to), radius);
      }
    }
    const hc = w.model.head_circle; headTops[wi] = world(rows, w, 'head', [hc.center[0], hc.center[1] + hc.radius * 1.7, hc.center[2]], dx);
  });
  [...Object.values(meshes), muscleMesh, tendonMesh].forEach((m) => { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; });
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
  `<li><b>${w.label}</b> <span class="mono">${w.model.height.toFixed(2)} m · ${w.speed.toFixed(1)} m/s · ${w.T.toFixed(2)} s stride</span></li>`).join('');

// ---------- loop
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let playing = !reduceMotion, rate = 1, simTime = 0, last = performance.now();
const playBtn = document.getElementById('play'), rateInput = document.getElementById('rate'), rateOut = document.getElementById('rate-v');
const setPlaying = (p) => { playing = p; playBtn.textContent = p ? 'Pause' : 'Play'; playBtn.setAttribute('aria-pressed', String(p)); };
setPlaying(playing); playBtn.addEventListener('click', () => setPlaying(!playing));
const restartBtn = document.getElementById('restart');
// reset the playback clock (and the travelling camera with it) back to the start
const restart = () => { simTime = 0; setPlaying(true); draw(); };
restartBtn.addEventListener('click', restart);
rateInput.addEventListener('input', () => { rate = +rateInput.value; rateOut.textContent = `${rate.toFixed(2)}×`; });
namesInput.addEventListener('change', placeTags);
function resize() { const w = wrapEl.clientWidth, h = wrapEl.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
new ResizeObserver(resize).observe(wrapEl); resize();
let visible = true; new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(wrapEl);
// the camera, its orbit target, the sun (and its shadow box) and the ground travel with the crowd
function travel(time) {
  const x = CRUISE * time, d = x - camX; camX = x;
  camera.position.x += d; controls.target.x += d; sun.position.x += d; sun.target.position.x += d; ground.position.x = x;
  // Recenter on whole major cells so the grid stays fixed in world space as the crowd travels.
  groundGrid.position.x = Math.floor(x / GRID_MAJOR_SPACING) * GRID_MAJOR_SPACING;
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
window.__parade = { walkers: walkers.map((w) => w.key), setTime: (t) => { simTime = t; draw(); }, restart, setView };
