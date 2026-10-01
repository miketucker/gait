// Inverse dynamics, muscle geometry / sharing, and the gait generator's dynamic consistency.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildHumanoid } from '../sim/humanoid.js';
import { strideKinematics, newtonEuler, solveContacts, GRAVITY } from '../sim/dynamics.js';
import { MuscleSet, staticOptimization, passiveJointTorque, activeForceLength, forceVelocity, passiveForceLength } from '../sim/muscles.js';
import { generateGait, standingPose } from '../sim/gait.js';
import { periodicDerivative, matVec, transpose, sub, dot } from '../sim/math.js';

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (tol ${tol})`);
const body = buildHumanoid(), ms = new MuscleSet(body);
// a reachable walk found by the optimizer (the initial guesses are deliberately rough and can over-reach)
const WALK = { freq: 1.3721, duty: 0.5816, shape: 0.51, height: 0.9817, width: 0.0963, heelOff: 0.7131, tdPitch: 0.1615, toPitch: -0.5935, pelvisYaw: 0.0727, pelvisRoll: 0.0263, trunkCounter: 0.4562, lean: -0.0612, armSwing: 0.2538 };

// a smooth periodic motion of every DOF (no forward drift)
function wiggle(M, T) {
  const qs = [], base = standingPose(body);
  for (let k = 0; k < M; k++) { const t = k * T / M, q = Float64Array.from(base);
    body.dofs.forEach((d, i) => { const w = 2 * Math.PI * t / T + 0.7 * i; q[i] += (i < 3 ? 0.05 : d.root ? 0.08 : 0.25) * Math.sin(w) + (i >= 6 ? 0.05 * Math.sin(2 * w) : 0); });
    qs.push(q); }
  return qs;
}

test('energy balance: joint and root power equal the rate of change of mechanical energy', () => {
  const M = 400, T = 1.2, qs = wiggle(M, T), kin = strideKinematics(body, qs, T, 0);
  const qd = body.dofs.map((_, i) => periodicDerivative(Float64Array.from(qs, (q) => q[i]), kin.h));
  const rootV = [0, 1, 2].map((d) => periodicDerivative(Float64Array.from(kin.poses, (p) => p.p[0][d]), kin.h));
  const E = new Float64Array(M), P = new Float64Array(M);
  for (let k = 0; k < M; k++) {
    const ne = newtonEuler(body, kin, k, []);
    let power = dot(ne.rootForce, [rootV[0][k], rootV[1][k], rootV[2][k]]) + dot(ne.rootMoment, kin.omega[k][0]);
    body.dofs.forEach((d, i) => { if (!d.root) power += ne.tau[i] * qd[i][k]; });
    P[k] = power;
  }
  const comV = body.segments.map((s) => [0, 1, 2].map((d) => periodicDerivative(Float64Array.from(kin.com, (c) => c[s.index][d]), kin.h)));
  for (let k = 0; k < M; k++) { let e = 0;
    body.segments.forEach((s) => { const i = s.index, v = [comV[i][0][k], comV[i][1][k], comV[i][2][k]], w = kin.omega[k][i], R = kin.poses[k].R[i], b = matVec(transpose(R), w);
      e += 0.5 * s.mass * dot(v, v) + 0.5 * (s.inertia[0] * b[0] ** 2 + s.inertia[1] * b[1] ** 2 + s.inertia[2] * b[2] ** 2) - s.mass * dot(GRAVITY, kin.com[k][i]); });
    E[k] = e; }
  const dE = periodicDerivative(E, kin.h), scale = Math.max(...P.map(Math.abs));
  for (let k = 0; k < M; k++) close(P[k], dE[k], 0.01 * scale, `power at sample ${k}`);
});

test('standing still: ground forces under the feet leave (almost) no residual on the pelvis', () => {
  const M = 20, T = 1, q = standingPose(body), kin = strideKinematics(body, Array.from({ length: M }, () => Float64Array.from(q)), T, 0);
  const W = body.mass * 9.81, feet = ['L', 'R'].map((side) => body.spec.feet[side]);
  const contacts = feet.map((f) => { const heel = body.pointWorld(kin.poses[0], body.segIndex[f.seg], f.heel), toe = body.pointWorld(kin.poses[0], body.segIndex[f.seg], f.toe);
    return { seg: body.segIndex[f.seg], pivot: [heel[0], 0, heel[2]], force: [0, W / 2, 0], bounds: { x: [heel[0], toe[0]], z: [heel[2] - f.halfWidth, heel[2] + f.halfWidth] }, freeMax: 1 }; });
  const r = solveContacts(body, kin, 0, contacts);
  r.rootForce.forEach((v) => close(v, 0, 1e-6, 'root force'));
  r.rootMoment.forEach((v) => close(v, 0, 0.05, 'root moment'));     // the small preference for the nominal pivot leaves millinewton-metres
  // both centres of pressure straddle the COM fore-aft position
  const com = body.comWorld(kin.poses[0]); close(r.cops.reduce((s, c) => s + c[0], 0) / 2, com[0], 0.01, 'mean COP under the COM');
});

test('muscle moment arms: analytic value matches the path-length derivative, with anatomical signs', () => {
  const q = standingPose(body); q[body.dofIndex['LH_hip.rz']] = 0.3; q[body.dofIndex['LH_knee.rz']] = -0.6; q[body.dofIndex['LF_elbow.rz']] = 0.4;
  const pose = body.fk(q), axes = body.dofAxes(q, pose), eps = 1e-6;
  ms.list.forEach((m, i) => { const { arms } = ms.lengthAndMomentArms(pose, axes, i);
    for (const [k, r] of arms) { const qa = Float64Array.from(q), qb = Float64Array.from(q); qa[k] += eps; qb[k] -= eps;
      close(r, -(ms.length(body.fk(qa), m) - ms.length(body.fk(qb), m)) / (2 * eps), 1e-7, `${m.name} about ${body.dofs[k].name}`); } });
  const arm = (muscle, dof) => { const i = ms.list.findIndex((m) => m.name === muscle); return ms.lengthAndMomentArms(pose, axes, i).arms.get(body.dofIndex[dof]) || 0; };
  // sign conventions (left side): hip/shoulder rz + flexion, rx + adduction; knee rz + extension; ankle rz + dorsiflexion; spine rz + extension
  const expect = [['LH_vasti', 'LH_knee.rz', 1], ['LH_hamstrings', 'LH_knee.rz', -1], ['LH_hamstrings', 'LH_hip.rz', -1], ['LH_iliopsoas', 'LH_hip.rz', 1], ['LH_gluteus_maximus', 'LH_hip.rz', -1],
    ['LH_gluteus_medius_ant', 'LH_hip.rx', -1], ['LH_adductor_longus', 'LH_hip.rx', 1], ['LH_soleus', 'LH_ankle.rz', -1], ['LH_gastrocnemius', 'LH_knee.rz', -1], ['LH_tibialis_anterior', 'LH_ankle.rz', 1],
    ['LH_tibialis_posterior', 'LH_ankle.rx', 1], ['LH_peroneus', 'LH_ankle.rx', -1], ['LH_rectus_femoris', 'LH_knee.rz', 1], ['LH_rectus_femoris', 'LH_hip.rz', 1],
    ['LF_deltoid_mid', 'LF_shoulder.rx', -1], ['LF_deltoid_ant', 'LF_shoulder.rz', 1], ['LF_latissimus', 'LF_shoulder.rz', -1], ['LF_biceps', 'LF_elbow.rz', 1], ['LF_triceps_lat', 'LF_elbow.rz', -1],
    ['erector_spinae_L', 'lumbar.rz', 1], ['rectus_abdominis_L', 'lumbar.rz', -1], ['ext_oblique_L', 'thoracolumbar.ry', 1], ['int_oblique_L', 'thoracolumbar.ry', -1],
    ['RH_gluteus_medius_ant', 'RH_hip.rx', 1], ['RH_vasti', 'RH_knee.rz', 1]];
  for (const [muscle, dof, sign] of expect) assert.ok(Math.sign(arm(muscle, dof)) === sign && Math.abs(arm(muscle, dof)) > 0.005, `${muscle} about ${dof}: ${arm(muscle, dof)}`);
});

test('every muscle-actuated DOF can be driven both ways', () => {
  const pose = body.fk(standingPose(body)), axes = body.dofAxes(standingPose(body), pose), cap = new Map();
  ms.list.forEach((m, i) => { for (const [k, r] of ms.lengthAndMomentArms(pose, axes, i).arms) { const c = cap.get(k) || [0, 0]; c[r > 0 ? 0 : 1] += Math.abs(r) * m.F0; cap.set(k, c); } });
  body.dofs.forEach((d, k) => { if (d.root || /mtp/.test(d.name)) return; const [pos, neg] = cap.get(k) || [0, 0];
    assert.ok(pos > 1 && neg > 1, `${d.name}: +${pos.toFixed(1)} / -${neg.toFixed(1)} Nm`); });
});

test('Hill curves: optimum at l = lopt and v = 0, no passive force when slack', () => {
  close(activeForceLength(1), 1, 0.02, 'f_l(1)'); close(forceVelocity(0), 1, 0.01, 'f_v(0)'); close(passiveForceLength(1), 0, 1e-12, 'f_p(1)');
  assert.ok(forceVelocity(-0.5) < 0.3 && forceVelocity(0.5) > 1.3, 'concentric weaker, eccentric stronger');
});

test('gait generator: vertical impulse, COM dynamics and foot contact are consistent', () => {
  const g = generateGait(body, WALK, { speed: 1, family: 'walk', samples: 200 });
  const m = body.mass, M = g.samples, h = g.T / M;
  // stride impulse equals weight x period; horizontal impulses vanish
  const F = [0, 1, 2].map((d) => g.contacts.reduce((s, cs) => s + cs.reduce((t, c) => t + (c ? c.force[d] : 0), 0), 0) * h);
  close(F[1], m * 9.81 * g.T, 0.01 * m * 9.81 * g.T, 'vertical impulse'); close(F[0], 0, 0.02 * m * g.T, 'fore-aft impulse'); close(F[2], 0, 0.02 * m * g.T, 'lateral impulse');
  // COM acceleration (finite differences of the COM path) equals the ground force over mass, minus gravity
  const com = (j) => { const jj = ((j % M) + M) % M, c = g.com[jj].slice(); c[0] += Math.floor(j / M) * g.S; return c; };
  let worst = 0;
  for (let k = 0; k < M; k++) { const sum = g.contacts[k].reduce((s, c) => (c ? s.map((v, d) => v + c.force[d]) : s), [0, 0, 0]);
    const acc = [0, 1, 2].map((d) => (com(k + 1)[d] - 2 * com(k)[d] + com(k - 1)[d]) / (h * h)), want = [sum[0] / m, sum[1] / m - 9.81, sum[2] / m];
    worst = Math.max(worst, Math.hypot(...sub(acc, want))); }
  assert.ok(worst < 0.3, `COM acceleration mismatch ${worst.toFixed(3)} m/s^2`);
  // the whole-body COM of the posed skeleton follows the planned COM path
  g.q.forEach((q, k) => { assert.equal(g.shortfall[k], 0, 'legs reach the footprints'); body.comWorld(body.fk(q)).forEach((v, d) => close(v, g.com[k][d], 1e-4, `COM tracking at ${k}`)); });
  // each loaded foot's pivot lies on the ground under that foot's sole
  g.contacts.forEach((cs, k) => cs.forEach((c) => { if (!c) return; assert.equal(c.pivot[1], 0); assert.ok(c.pivot[0] >= c.bounds.x[0] - 1e-9 && c.pivot[0] <= c.bounds.x[1] + 1e-9, `pivot in sole at ${k}`); }));
});

test('static optimization reproduces the joint torques of a walking stride', () => {
  const g = generateGait(body, WALK, { speed: 1, family: 'walk', samples: 100 });
  const kin = strideKinematics(body, g.q, g.T, g.S), frames = [];
  for (let k = 0; k < 100; k += 4) { const id = solveContacts(body, kin, k, g.contacts[k].filter(Boolean)), pas = passiveJointTorque(body, g.q[k]);
    frames.push({ pose: kin.poses[k], axes: kin.axes[k], tau: id.tau.map((t, i) => t - pas[i]) }); }
  const so = staticOptimization(ms, frames, g.T);
  so.a.forEach((row) => row.forEach((a) => assert.ok(a >= 0 && a <= 1)));
  // muscles supply every torque: reserves stay within 1% of each DOF's peak (or 0.02 Nm on the smallest);
  // the toe joints carry no muscles by design
  body.dofs.forEach((d, k) => { if (d.root || /mtp/.test(d.name)) return; const peak = Math.max(...frames.map((f) => Math.abs(f.tau[k])));
    so.reserve[k].forEach((r) => assert.ok(Math.abs(r) <= Math.max(0.02, 0.01 * peak), `${d.name}: reserve ${r.toFixed(3)} Nm of peak ${peak.toFixed(2)} Nm`)); });
});
