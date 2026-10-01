// End-to-end evaluation of one gait candidate, and the search for the cheapest one.
//   parameters -> periodic kinematics + ground forces (gait.js)
//   -> inverse dynamics with centre-of-pressure choice (dynamics.js)
//   -> muscle activations by static optimization (muscles.js)
//   -> metabolic energy (metabolics.js) -> cost of transport + penalties
import { sub, add, scale, dot, norm, matVec, DEG } from './math.js';
import { generateGait, soleHeights, PARAMS, familyBounds, initialParams } from './gait.js';
import { strideKinematics, solveContacts } from './dynamics.js';
import { staticOptimization, passiveJointTorque } from './muscles.js';
import { muscleEnergyRate } from './metabolics.js';
import { nelderMead } from './optimize.js';

const G = 9.81;
const rms = (arr) => Math.sqrt(arr.reduce((s, v) => s + v * v, 0) / Math.max(1, arr.length));

// closest distance between segments [a0, a1] and [b0, b1]
export function segmentDistance(a0, a1, b0, b1) {
  const u = sub(a1, a0), v = sub(b1, b0), w = sub(a0, b0), uu = dot(u, u), uv = dot(u, v), vv = dot(v, v), uw = dot(u, w), vw = dot(v, w), den = uu * vv - uv * uv;
  const c01 = (x) => Math.min(1, Math.max(0, x));
  let s = den > 1e-12 ? c01((uv * vw - vv * uw) / den) : 0; const t = vv > 1e-12 ? c01((uv * s + vw) / vv) : 0; s = uu > 1e-12 ? c01((uv * t - uw) / uu) : 0;
  return norm(sub(add(a0, scale(u, s)), add(b0, scale(v, t))));
}
const boneEnds = (body, pose, b) => { const bone = body.bones[b]; return [body.pointWorld(pose, bone.seg, bone.from), body.pointWorld(pose, bone.seg, add(bone.from, matVec(bone.C, [bone.length, 0, 0])))]; };

// bone pairs that must stay apart: left leg vs right leg, and each arm vs the legs and pelvis
export function clearancePairs(body) {
  const side = (n) => (/^L[FH]_/.test(n) ? 'L' : /^R[FH]_/.test(n) ? 'R' : ''), limb = (n) => (/^[LR]F_/.test(n) ? 'arm' : /^[LR]H_/.test(n) ? 'leg' : 'trunk');
  const legBone = (b) => limb(b.name) === 'leg' && !/ilium|pubis/.test(b.name), pairs = [];
  body.bones.forEach((a, i) => body.bones.forEach((b, j) => { if (j <= i) return;
    if (legBone(a) && legBone(b) && side(a.name) !== side(b.name)) pairs.push([i, j]);
    else if ((limb(a.name) === 'arm' && !/clavicle/.test(a.name) && (legBone(b) || /ilium|pubis/.test(b.name))) || (limb(b.name) === 'arm' && !/clavicle/.test(b.name) && (legBone(a) || /ilium|pubis/.test(a.name)))) pairs.push([i, j]);
  }));
  return pairs;
}

export function evaluate(body, ms, params, { speed = 1, family = 'walk', samples = 150, frames = 50, full = false } = {}) {
  if (samples % frames) throw new Error(`samples (${samples}) must be a multiple of frames (${frames})`);
  const m = body.mass, legLength = body.spec.feet.L.L1 + body.spec.feet.L.L2 - body.spec.feet.L.heel[1];
  const gait = generateGait(body, params, { speed, family, samples });
  const kin = strideKinematics(body, gait.q, gait.T, gait.S);

  // inverse dynamics with the centre of pressure chosen inside each foot
  const id = gait.contacts.map((cs, k) => solveContacts(body, kin, k, cs.filter(Boolean)));
  const every = samples / frames;
  const frameIdx = Array.from({ length: frames }, (_, n) => n * every);
  const soFrames = frameIdx.map((k) => { const passive = passiveJointTorque(body, gait.q[k]); return { pose: kin.poses[k], axes: kin.axes[k], tau: id[k].tau.map((t, i) => t - passive[i]) }; });
  const so = staticOptimization(ms, soFrames, gait.T);

  // metabolic power, by muscle group
  const powerByGroup = {}; let power = 0;
  ms.list.forEach((mu, i) => { let e = 0; for (let n = 0; n < frames; n++) e += muscleEnergyRate(mu, so.a[i][n], so.lm[i][n], so.vm[i][n]); e /= frames; power += e; powerByGroup[mu.group] = (powerByGroup[mu.group] || 0) + e; });
  const cot = power / (m * G * speed);

  // dynamic consistency: residual wrench on the pelvis, reserve torques, friction
  const resF = id.map((r) => norm(r.rootForce)), resM = id.map((r) => norm(r.rootMoment));
  const reserves = [], jointTorques = [];
  body.dofs.forEach((d, k) => { if (d.root) return; for (let n = 0; n < frames; n++) { reserves.push(so.reserve[k][n]); jointTorques.push(soFrames[n].tau[k]); } });
  let frictionExcess = 0, peakGrf = 0;
  gait.contacts.forEach((cs) => cs.forEach((c) => { if (!c) return; const mu = Math.hypot(c.force[0], c.force[2]) / c.force[1]; frictionExcess += Math.max(0, mu - 0.6) ** 2; peakGrf = Math.max(peakGrf, norm(c.force) / (m * G)); }));
  frictionExcess /= samples;

  // geometry checks: legs reach the footprints, soles stay above ground, limbs stay apart, joints in range
  const shortfall = Math.max(...gait.shortfall);
  const soles = soleHeights(body, gait, kin.poses); let penetration = 0;
  soles.forEach((row) => row.forEach((pts) => pts.forEach((y) => { penetration = Math.max(penetration, -y - 0.001); })));
  const softPairs = body.spec.softPairs.map(([a, ra, b, rb]) => [body.primaryBone[body.segIndex[a]], ra, body.primaryBone[body.segIndex[b]], rb]);
  let softOverlap = 0;
  for (const k of frameIdx) { const pose = kin.poses[k]; for (const [a, ra, b, rb] of softPairs) { const [a0, a1] = boneEnds(body, pose, a), [b0, b1] = boneEnds(body, pose, b); softOverlap = Math.max(softOverlap, ra + rb - segmentDistance(a0, a1, b0, b1)); } }
  let limitExcess = 0;
  for (const k of frameIdx) body.segments.forEach((s) => { if (!s.joint) return; s.joint.axes.forEach((a, j) => { const v = gait.q[k][s.dofStart + j], lo = s.joint.lo[j] * DEG, hi = s.joint.hi[j] * DEG; limitExcess += Math.max(0, v - hi, lo - v) ** 2; }); });
  limitExcess /= frames;

  const scaleM = m * G * legLength;
  const penalties = {
    reach: 1e4 * shortfall ** 2, ground: 1e4 * penetration ** 2, soft: 1e4 * Math.max(0, softOverlap) ** 2, friction: 10 * frictionExcess,
    // reserves (torque the muscles cannot make) as a share of the joint torque, so heavy bodies cannot lean on them
    residualMoment: 50 * (rms(resM) / scaleM) ** 2, residualForce: 50 * (rms(resF) / (m * G)) ** 2, reserve: 200 * (rms(reserves) / Math.max(1e-9, rms(jointTorques))) ** 2, limits: 10 * limitExcess };
  const cost = cot + Object.values(penalties).reduce((s, v) => s + v, 0);
  const result = { cost, cot, power, powerByGroup, penalties, gait, params, family, speed,
    residual: { forceRmsBW: rms(resF) / (m * G), momentRmsNm: rms(resM), momentRmsRel: rms(resM) / scaleM },
    reserveRms: rms(reserves), reserveRel: rms(reserves) / Math.max(1e-9, rms(jointTorques)), peakGrf, shortfall, penetration, softOverlap, legLength };
  if (full) Object.assign(result, { kin, id, so, frameIdx, soFrames });
  return result;
}

// search the gait parameters of one family for the lowest cost
export function optimizeGait(body, ms, { speed = 1, family = 'walk', start = null, maxEvals = 2500, restarts = 2, samples = 150, frames = 50, step = 0.35, log = null } = {}) {
  const bounds = familyBounds(body, family), free = PARAMS.filter((k) => bounds[k][1] > bounds[k][0]);
  const base = start ? { ...start } : initialParams(family, body);
  const toParams = (z) => { const p = { ...base }; free.forEach((k, i) => { const [lo, hi] = bounds[k]; p[k] = lo + (hi - lo) * (0.5 + 0.5 * Math.sin(z[i])); }); return p; };
  const toZ = (p) => free.map((k) => { const [lo, hi] = bounds[k]; return Math.asin(Math.max(-1, Math.min(1, 2 * (p[k] - lo) / (hi - lo) - 1))); });
  let evals = 0, best = { cost: Infinity };
  const f = (z) => { evals++; let r; try { r = evaluate(body, ms, toParams(z), { speed, family, samples, frames }); } catch (err) { return 1e6; }
    if (!(r.cost < best.cost)) return Number.isFinite(r.cost) ? r.cost : 1e6;
    best = { cost: r.cost, cot: r.cot, params: r.params }; if (log && evals % 50 === 0) log(`${family}: ${evals} evals, cost ${r.cost.toFixed(4)}, COT ${r.cot.toFixed(4)}`); return r.cost; };
  let z = toZ(base);
  for (let round = 0; round <= restarts; round++) {
    const out = nelderMead(f, z, { step: step / (1 + round), maxEvals: Math.round(maxEvals / (restarts + 1)), tol: 1e-6 });
    z = out.x;
    if (log) log(`${family}: round ${round + 1} done, cost ${out.fx.toFixed(4)} after ${evals} evals`);
  }
  return { family, params: best.params, cost: best.cost, cot: best.cot, evals };
}
