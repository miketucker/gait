// Math kernels, body kinematics and leg inverse kinematics of the biped simulator.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eulerCompose, eulerDecompose, jointAngles, postRotate, matMul, ROT, solveBoxQP, periodicDerivative, transpose } from '../sim/math.js';
import { buildHumanoid } from '../sim/humanoid.js';
import { legIK, standingPose, familyBounds, FAMILIES, initialParams, generateGait } from '../sim/gait.js';
import { DEG } from '../sim/math.js';
import { MuscleSet } from '../sim/muscles.js';
import { CHARACTERS } from '../sim/characters.js';

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (tol ${tol})`);
// small deterministic generator
const rng = (seed) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };

test('Euler decomposition inverts composition for every joint order used', () => {
  const rand = rng(1);
  for (const order of [['rz', 'rx', 'ry'], ['rx', 'ry', 'rz'], ['rx', 'rz', 'ry']]) for (let i = 0; i < 200; i++) {
    const angles = [(rand() - 0.5) * 2.5, (rand() - 0.5) * 2.5, (rand() - 0.5) * 2.5];
    const back = eulerDecompose(eulerCompose(order, angles), order);
    angles.forEach((a, k) => close(back[k], a, 1e-9, `${order.join('')} angle ${k}`));
  }
  const two = jointAngles(eulerCompose(['rz', 'rx'], [0.3, -0.2]), ['rz', 'rx']);
  close(two[0], 0.3, 1e-12, 'two-axis rz'); close(two[1], -0.2, 1e-12, 'two-axis rx');
  for (const axis of ['rx', 'ry', 'rz']) close(jointAngles(ROT[axis](0.7), [axis])[0], 0.7, 1e-12, `single ${axis}`);
});

test('postRotate equals multiplying by the axis rotation', () => {
  const R = eulerCompose(['rz', 'rx', 'ry'], [0.4, -0.3, 1.1]);
  for (const axis of ['rx', 'ry', 'rz']) postRotate(R, axis, 0.83).forEach((v, i) => close(v, matMul(R, ROT[axis](0.83))[i], 1e-14, axis));
});

test('box QP satisfies the KKT conditions, including stiff-penalty (badly scaled) problems', () => {
  const rand = rng(7);
  const kkt = (H, g, x, n, tol) => { for (let i = 0; i < n; i++) { let grad = g[i]; for (let j = 0; j < n; j++) grad += H[i * n + j] * x[j];
    if (x[i] > 1e-9 && x[i] < 1 - 1e-9) close(grad, 0, tol, 'free gradient');
    else if (x[i] <= 1e-9) assert.ok(grad >= -tol, `lower bound held with gradient ${grad}`);
    else assert.ok(grad <= tol, `upper bound held with gradient ${grad}`); } };
  for (let trial = 0; trial < 50; trial++) {            // well scaled
    const n = 8, B = Array.from({ length: n * n }, () => rand() - 0.5), H = new Float64Array(n * n);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { let s = 0; for (let k = 0; k < n; k++) s += B[i * n + k] * B[j * n + k]; H[i * n + j] = s + (i === j ? 0.1 : 0); }
    const g = Float64Array.from({ length: n }, () => (rand() - 0.5) * 4);
    kkt(H, g, solveBoxQP(H, g, new Float64Array(n), new Float64Array(n).fill(1)).x, n, 1e-7);
  }
  for (let trial = 0; trial < 200; trial++) {           // like static optimization: a^2 + 1e5 * (torque error)^2, warm-started
    const nb = 17, nd = 6, w = 1e5, A = Float64Array.from({ length: nd * nb }, () => (rand() < 0.5 ? 0 : (rand() - 0.5) * 300)), tau = Float64Array.from({ length: nd }, () => (rand() - 0.5) * 60);
    const H = new Float64Array(nb * nb), g = new Float64Array(nb);
    for (let c = 0; c < nb; c++) { H[c * nb + c] = 2 * (0.2 + rand()); for (let e = 0; e < nb; e++) { let s = 0; for (let d = 0; d < nd; d++) s += A[d * nb + c] * A[d * nb + e]; H[c * nb + e] += 2 * w * s; }
      let s = 0; for (let d = 0; d < nd; d++) s += A[d * nb + c] * tau[d]; g[c] = -2 * w * s + 12 * rand(); }
    const x0 = Float64Array.from({ length: nb }, () => rand() * 0.3), scale = Math.max(...g.map(Math.abs));
    kkt(H, g, solveBoxQP(H, g, new Float64Array(nb), new Float64Array(nb).fill(1), x0).x, nb, 1e-8 * scale);
  }
});

test('periodic derivative is fourth-order accurate', () => {
  const N = 64, T = 2, h = T / N, f = Float64Array.from({ length: N }, (_, k) => Math.sin(2 * Math.PI * k * h / T));
  const d = periodicDerivative(f, h);
  d.forEach((v, k) => close(v, (2 * Math.PI / T) * Math.cos(2 * Math.PI * k * h / T), 2e-4, 'derivative'));
});

const standingHeight = (body) => { const pose = body.fk(standingPose(body)), skull = body.spec.skull;
  let top = body.pointWorld(pose, body.segIndex[body.spec.head], skull.center)[1] + skull.radius;
  body.boneRows(pose).forEach((r, b) => { top = Math.max(top, r[10], r[10] + r[1] * body.bones[b].length); });
  return top; };

test('humanoid: mass, height, reference posture and bone frames', () => {
  const body = buildHumanoid();
  close(body.mass, 30, 1e-9, 'mass');
  const q = standingPose(body), pose = body.fk(q);
  const rows = body.boneRows(pose); let top = 0;
  rows.forEach((r, b) => { top = Math.max(top, r[10], r[10] + r[1] * body.bones[b].length);
    const X = r.slice(0, 3), Y = r.slice(3, 6), Z = r.slice(6, 9), dot = (a, c) => a[0] * c[0] + a[1] * c[1] + a[2] * c[2];
    close(dot(X, X), 1, 1e-12, 'unit X'); close(dot(X, Y), 0, 1e-12, 'X.Y'); close(dot(Y, Z), 0, 1e-12, 'Y.Z');
    const XxY = [X[1] * Y[2] - X[2] * Y[1], X[2] * Y[0] - X[0] * Y[2], X[0] * Y[1] - X[1] * Y[0]]; XxY.forEach((v, i) => close(v, Z[i], 1e-12, 'right-handed')); });
  const skull = body.spec.skull, head = body.pointWorld(pose, body.segIndex[body.spec.head], skull.center);   // the head is drawn as a round skull
  close(Math.max(top, head[1] + skull.radius), 1.32, 0.03, 'standing height');
  const f = body.spec.feet.L; close(body.pointWorld(pose, body.segIndex[f.seg], f.heel)[1], 0, 1e-12, 'heel on the ground');
  // left is +z, and every segment frame is world-aligned when standing
  assert.ok(pose.p[body.segIndex.LH_femur][2] > 0 && pose.p[body.segIndex.RH_femur][2] < 0);
  pose.R.forEach((R) => R.forEach((v, i) => close(v, [1, 0, 0, 0, 1, 0, 0, 0, 1][i], 1e-12, 'aligned')));
});

test('shape options: the defaults are the reference body, and every character reaches its height and mass', () => {
  const ref = buildHumanoid(), same = buildHumanoid({ mass: 30, height: 1.32, legs: 1, arms: 1, trunk: 1, neck: 1, head: 1, width: 1, fat: {}, muscle: 1 });
  const strip = (body) => JSON.stringify({ segments: body.segments.map(({ children, ...seg }) => seg), muscles: body.spec.muscles, feet: body.spec.feet, softPairs: body.spec.softPairs, legScale: body.spec.legScale });
  assert.equal(strip(same), strip(ref), 'neutral options change nothing');
  assert.equal(ref.spec.legScale, 1, 'the gait bounds were set for the default body');
  for (const [key, c] of Object.entries(CHARACTERS)) {
    const body = buildHumanoid(c.shape), pose = body.fk(standingPose(body)), f = body.spec.feet.L;
    close(body.mass, c.shape.mass, 1e-9, `${key} mass`);
    close(standingHeight(body) / c.shape.height, 1, 0.01, `${key} standing height`);
    close(body.pointWorld(pose, body.segIndex[f.seg], f.heel)[1], 0, 1e-12, `${key} heel on the ground`);
    assert.ok(Math.abs(body.comWorld(pose)[2]) < 1e-9, `${key} is left-right symmetric`);
    body.segments.forEach((seg) => assert.ok(seg.mass > 0 && seg.inertia.every((v) => v > 0), `${key} ${seg.name} mass and inertia`));
  }
});

test('shape options change proportions, fat and strength the way they say', () => {
  const [ref, kid, ogre, giant] = ['biped', 'kid', 'ogre', 'giant'].map((k) => buildHumanoid(CHARACTERS[k].shape));
  const legShare = (b) => (b.spec.feet.L.L1 + b.spec.feet.L.L2) / standingHeight(b), headShare = (b) => b.spec.skull.radius / standingHeight(b);
  const hipWidth = (b) => b.spec.feet.L.hipAt[2] / standingHeight(b), segMass = (b, n) => b.segments[b.segIndex[n]].mass / b.mass;
  assert.ok(headShare(kid) > 1.3 * headShare(ref) && segMass(kid, 'head') > 1.8 * segMass(ref, 'head'), 'the kid has a big, heavy head');
  assert.ok(legShare(kid) < legShare(ref) && legShare(giant) > 1.05 * legShare(ref), 'short legs on the kid, long legs on the giant');
  assert.ok(hipWidth(giant) < hipWidth(ref) && hipWidth(ogre) > hipWidth(ref), 'narrow giant, broad ogre');
  assert.ok(segMass(ogre, 'lumbar') > 1.3 * segMass(ref, 'lumbar'), 'the ogre carries its fat on the belly');
  assert.ok(ogre.segments[ogre.segIndex.lumbar].com[0] > 2 * ref.segments[ref.segIndex.lumbar].com[0] * ogre.spec.height / ref.spec.height, 'belly fat moves the trunk mass forward');
  // muscle volume follows lean mass: fat adds mass but no muscle, and the kid has less muscle per kg
  const muscleShare = (b) => new MuscleSet(b).list.reduce((a, m) => a + m.mass, 0) / b.mass, refShare = muscleShare(ref);
  assert.ok(muscleShare(buildHumanoid({ ...CHARACTERS.ogre.shape, fat: {} })) > 1.2 * muscleShare(ogre), 'fat dilutes the muscle share');
  assert.ok(muscleShare(kid) < 0.9 * refShare && Math.abs(muscleShare(giant) / refShare - 1) < 0.1, 'muscle share of body mass');
  assert.ok(ogre.spec.softPairs.length === ref.spec.softPairs.length + 1, "the ogre's thighs must stay apart");
});

test('comic shape options: girth, shoulders, neck base, feet, joint ranges and muscle per region', () => {
  const [ref, hood, brute, pear, ogre] = ['biped', 'hood', 'brute', 'pear', 'ogre'].map((k) => buildHumanoid(CHARACTERS[k].shape)), H = (b) => standingHeight(b);
  const seg = (b, n) => b.segments[b.segIndex[n]], at = (b, n) => seg(b, n).joint.at.map((v) => v / H(b));
  // the brute's shoulders sit wider and higher on the ribcage, and its clavicles reach them
  assert.ok(at(brute, 'LF_humerus')[2] > 1.4 * at(ref, 'LF_humerus')[2] && at(brute, 'LF_humerus')[1] > at(ref, 'LF_humerus')[1], 'broad, high shoulders');
  const clav = (b) => b.bones.find((x) => x.name === 'LF_clavicle'), tip = (b) => clav(b).from.map((v, i) => v + b.bones.find((x) => x.name === 'LF_clavicle').C[i * 3] * clav(b).length);
  assert.ok(Math.hypot(...tip(brute).map((v, i) => v - seg(brute, 'LF_humerus').joint.at[i])) < 0.1 * H(brute), 'clavicle ends near the shoulder joint');
  // the pear's shoulders are narrow over broad hips
  assert.ok(at(pear, 'LF_humerus')[2] < at(ref, 'LF_humerus')[2] && pear.spec.feet.L.hipAt[2] / H(pear) > 1.3 * ref.spec.feet.L.hipAt[2] / H(ref), 'narrow shoulders, wide hips');
  // the hood's neck leaves the ribcage further forward, and the top of its spine follows
  assert.ok(at(hood, 'neck')[0] > at(ref, 'neck')[0] + 0.02, 'neck base forward');
  const thoraxBone = hood.bones.find((x) => x.name === 'thorax'), top = thoraxBone.from.map((v, i) => v + thoraxBone.C[i * 3] * thoraxBone.length);
  top.forEach((v, i) => close(v, seg(hood, 'neck').joint.at[i], 1e-9, 'thoracic spine ends at the neck'));
  close(seg(hood, 'thorax').joint.lo[0], 1.8 * seg(ref, 'thorax').joint.lo[0], 1e-9, 'flexible spine');
  // thick arms carry more mass and push the soft-tissue clearance out; big feet widen the sole
  const armShare = (b) => ['LF_humerus', 'LF_antebrachium', 'LF_manus'].reduce((a, n) => a + seg(b, n).mass, 0) / b.mass;
  assert.ok(armShare(brute) > 2 * armShare(ref), 'heavy arms');
  assert.ok(brute.spec.softPairs.find((p) => p[0] === 'LF_manus')[1] / H(brute) > 1.4 * ref.spec.softPairs.find((p) => p[0] === 'LF_manus')[1] / H(ref), 'thick hands keep further from the thighs');
  const footLength = (b) => b.spec.feet.L.toe[0] - b.spec.feet.L.heel[0], stilts = buildHumanoid(CHARACTERS.stilts.shape), flat = buildHumanoid({ ...CHARACTERS.stilts.shape, feet: 1 });
  close(footLength(stilts) / footLength(flat), CHARACTERS.stilts.shape.feet, 1e-12, 'big feet');
  close(stilts.spec.feet.L.halfWidth / flat.spec.feet.L.halfWidth, CHARACTERS.stilts.shape.feet, 1e-12, 'broad soles');
  // muscle per region scales only that region's muscles
  const bm = CHARACTERS.brute.shape.muscle, plainBack = buildHumanoid({ ...CHARACTERS.brute.shape, muscle: { ...bm, spine: 1 } }), F = (b, name) => b.spec.muscles.find((m) => m.name === name).F0;
  close(F(brute, 'erector_spinae_L') / F(plainBack, 'erector_spinae_L'), bm.spine, 1e-12, 'stronger back');
  close(F(brute, 'LH_vasti') / F(plainBack, 'LH_vasti'), 1, 1e-12, 'legs unchanged');
});

test('gait bounds scale with leg length at a constant Froude number', () => {
  const giant = buildHumanoid(CHARACTERS.giant.shape), lam = giant.spec.legScale, b = familyBounds(giant, 'walk'), ref = FAMILIES.walk.bounds;
  assert.ok(lam > 2);
  b.freq.forEach((v, i) => close(v * Math.sqrt(lam), ref.freq[i], 1e-12, 'frequency ~ 1/sqrt(leg)'));
  b.width.forEach((v, i) => close(v / lam, ref.width[i], 1e-12, 'step width ~ leg'));
  assert.deepEqual(b.duty, ref.duty, 'dimensionless bounds unchanged');
  assert.deepEqual(familyBounds(buildHumanoid(), 'walk'), ref);
});

test('a style holds the search inside its ranges and shapes the stride: hunch, trunk sway, hanging arms', () => {
  const c = CHARACTERS.giant, body = buildHumanoid({ ...c.shape, style: c.style }), walk = familyBounds(body, 'walk'), hop = familyBounds(body, 'hop');
  for (const [k, [lo, hi]] of Object.entries(c.style.bounds)) { const u = k === 'height' ? 1 : DEG; close(walk[k][0], lo * u, 1e-12, `${k} lo`); close(walk[k][1], hi * u, 1e-12, `${k} hi`); assert.ok(walk[k][2] >= walk[k][0] && walk[k][2] <= walk[k][1], `${k} start`); }
  for (const k of ['pelvisYaw', 'pelvisRoll', 'trunkCounter', 'trunkSway']) assert.deepEqual(hop[k], [0, 0, 0], `a hop stays left-right symmetric: ${k}`);
  assert.deepEqual(familyBounds(buildHumanoid(c.shape), 'walk').hunch, [0, 0, 0], 'no style, no hunch');
  const p = { ...initialParams('walk', body), pelvisRoll: 0, pelvisYaw: 0, trunkCounter: 0, lean: 0, hunch: 20 * DEG, trunkSway: 5 * DEG };
  const gait = generateGait(body, p, { speed: 1, family: 'walk', samples: 40 }), head = body.segIndex.head, thorax = body.segIndex.thorax;
  gait.q.forEach((q, k) => { const pose = body.fk(q), ph = k / 40;
    pose.R[head].forEach((v, i) => close(v, [1, 0, 0, 0, 1, 0, 0, 0, 1][i], 1e-9, 'head level and facing forward'));
    const up = [pose.R[thorax][1], pose.R[thorax][4], pose.R[thorax][7]];                  // thorax y axis in the world
    close(Math.asin(up[0]), 20 * DEG, 0.02, 'upper trunk pitched forward by the hunch');
    close(Math.asin(up[2]), 5 * DEG * Math.cos(2 * Math.PI * (ph - p.duty / 2)), 0.02, 'trunk rocks over the stance foot');
    // arms hang near plumb despite the hunch (they swing about the vertical)
    const arm = body.segIndex.LF_humerus, down = [-pose.R[arm][1], -pose.R[arm][4], -pose.R[arm][7]];
    assert.ok(Math.abs(Math.atan2(down[0], -down[1])) <= p.armSwing + 2 * DEG, 'arm swing about the vertical'); });
});

test('style constants: a craned neck carries the head forward and down, the gaze pitches it, arms swing outward', () => {
  const c = CHARACTERS.hood, style = { ...c.style, armOut: 12 }, body = buildHumanoid({ ...c.shape, style }), plain = buildHumanoid({ ...c.shape, style: { ...c.style, neckCrane: 0, gaze: 0, armOut: 0 } });
  const p = { ...initialParams('walk', body), hunch: 30 * DEG, lean: 12 * DEG, armSwing: 20 * DEG }, head = body.segIndex.head;
  const [a, b] = [body, plain].map((bd) => generateGait(bd, p, { speed: 0.6, family: 'walk', samples: 20 }));
  a.q.forEach((q, k) => { const pa = body.fk(q), pb = plain.fk(b.q[k]);
    close(Math.atan2(pa.R[head][3], pa.R[head][0]), -c.style.gaze * DEG, 1e-9, 'head pitched down by the gaze');
    const ha = body.pointWorld(pa, head, body.spec.skull.center), hb = plain.pointWorld(pb, head, plain.spec.skull.center);
    assert.ok(ha[0] - pa.p[0][0] > hb[0] - pb.p[0][0] && ha[1] < hb[1], 'craned head further forward and lower'); });
  const abd = (bd, g) => Math.max(...g.q.map((q) => -q[bd.dofIndex['LF_shoulder.rx']]));
  close(abd(body, a) - abd(plain, b), style.armOut * DEG, 0.002, 'arms swing out by armOut');       // peak between samples
});

test('DOF axes match finite differences of forward kinematics', () => {
  const body = buildHumanoid(), rand = rng(3), q = body.zeroPose();
  for (let i = 0; i < body.nq; i++) q[i] = i < 3 ? rand() : (rand() - 0.5) * 0.8;
  const pose = body.fk(q), axes = body.dofAxes(q, pose), eps = 1e-6;
  body.dofs.forEach((d, k) => { if (d.root) return;
    const q2 = Float64Array.from(q); q2[k] += eps; const pose2 = body.fk(q2);
    const s = d.seg, W = matMul(pose2.R[s], transpose(pose.R[s]));      // small rotation about the DOF axis
    const w = [(W[7] - W[5]) / 2 / eps, (W[2] - W[6]) / 2 / eps, (W[3] - W[1]) / 2 / eps];
    w.forEach((v, i) => close(v, axes[k].u[i], 1e-5, `${d.name} axis`)); });
});

test('leg inverse kinematics reproduces a foot pose reached by forward kinematics, for every body shape', () => {
  const rand = rng(11);
  for (const body of Object.values(CHARACTERS).map((c) => buildHumanoid(c.shape))) for (const side of ['L', 'R']) for (let trial = 0; trial < 50; trial++) {
    const f = body.spec.feet[side], q = standingPose(body);
    q[3] = (rand() - 0.5) * 0.2; q[4] = (rand() - 0.5) * 0.3;
    const set = (name, v) => { q[body.dofIndex[name]] = v; };
    set(`${side}H_hip.rz`, (rand() - 0.3) * 1.0); set(`${side}H_hip.rx`, (rand() - 0.5) * 0.4); set(`${side}H_hip.ry`, (rand() - 0.5) * 0.5);
    set(`${side}H_knee.rz`, -rand() * 1.4 - 0.05); set(`${side}H_ankle.rz`, (rand() - 0.5) * 0.8); set(`${side}H_ankle.rx`, (rand() - 0.5) * 0.4);
    const pose = body.fk(q), foot = body.segIndex[f.seg], Rp = pose.R[0];
    const ik = legIK({ ...f }, Rp, pose.p[0], pose.p[foot], pose.R[foot]);
    close(ik.shortfall, 0, 1e-12, 'reachable');
    const q2 = Float64Array.from(q); ik.hip.forEach((v, i) => { q2[body.dofIndex[`${side}H_hip.${['rz', 'rx', 'ry'][i]}`]] = v; });
    q2[body.dofIndex[`${side}H_knee.rz`]] = ik.knee; ik.ankle.forEach((v, i) => { q2[body.dofIndex[`${side}H_ankle.${['rz', 'rx'][i]}`]] = v; });
    const pose2 = body.fk(q2);
    pose2.p[foot].forEach((v, i) => close(v, pose.p[foot][i], 1e-9, 'ankle position'));
    pose2.R[foot].forEach((v, i) => close(v, pose.R[foot][i], 1e-9, 'foot rotation'));
  }
});

test('an out-of-reach target straightens the knee and reports the shortfall', () => {
  const body = buildHumanoid(), f = body.spec.feet.L, q = standingPose(body), pose = body.fk(q);
  const ankle = pose.p[body.segIndex[f.seg]].slice(); ankle[1] -= 0.02;
  const ik = legIK(f, pose.R[0], pose.p[0], ankle, pose.R[body.segIndex[f.seg]]);
  close(ik.knee, 0, 1e-9, 'straight knee'); close(ik.shortfall, 0.02, 1e-6, 'shortfall');
});
