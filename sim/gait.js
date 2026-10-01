// Periodic biped gait from a small parameter vector.
//
// Dynamics first: each stance foot's vertical ground force follows Alexander &
// Jayes's (1978) shape family, scaled so the stride's vertical impulse equals
// body weight x period. The centre of mass (COM) path is integrated from those
// forces. Horizontal forces point from each foot's nominal pivot (heel, then
// along the sole, then the ball) to a virtual pivot point just above or below
// the COM (Maus et al. 2010; its height is a parameter), which makes the horizontal
// COM motion a linear ODE with periodic coefficients; its unique periodic solution
// (monodromy) fixes where the COM travels relative to the footprints. The body
// then follows: pelvis placed so the whole-body COM tracks that path, legs by
// analytic 6-DOF inverse kinematics from footprints and foot rockers, trunk,
// head and arms by the posture parameters. Inverse dynamics later checks how
// much of the motion the ground forces cannot explain (the root residual).
import { DEG, add, sub, matMul, matVec, matTVec, transpose, rotX, rotY, rotZ, halfRotation, jointAngles, hermite } from './math.js';

const G = 9.81;
const mod1 = (x) => x - Math.floor(x);

// parameters searched by the optimizer: [lo, hi, initial] per gait family
// trunkSway (the thorax rocking over each stance foot) and hunch (upper back rounded forward) are off unless a
// character's style opens them (see familyBounds)
export const PARAMS = ['freq', 'duty', 'shape', 'height', 'width', 'heelOff', 'tdPitch', 'toPitch', 'pelvisYaw', 'pelvisRoll', 'trunkCounter', 'lean', 'armSwing', 'vpp', 'trunkSway', 'hunch'];
const OFF = { trunkSway: [0, 0, 0], hunch: [0, 0, 0] };
export const FAMILIES = {
  walk: { phaseR: 0.5, label: 'walk', bounds: {
    freq: [0.6, 1.6, 1.0], duty: [0.52, 0.75, 0.6], shape: [-0.1, 0.6, 0.25], height: [0.85, 1.02, 0.97], width: [0.02, 0.18, 0.07], heelOff: [0.3, 0.9, 0.6],
    tdPitch: [0, 30 * DEG, 12 * DEG], toPitch: [-60 * DEG, -5 * DEG, -30 * DEG], pelvisYaw: [0, 15 * DEG, 5 * DEG], pelvisRoll: [0, 10 * DEG, 3 * DEG],
    trunkCounter: [0, 1.5, 0.5], lean: [-5 * DEG, 15 * DEG, 3 * DEG], armSwing: [0, 45 * DEG, 15 * DEG], vpp: [-0.15, 0.5, 0.1], ...OFF } },
  run: { phaseR: 0.5, label: 'run', bounds: {
    freq: [1.0, 2.2, 1.45], duty: [0.22, 0.48, 0.38], shape: [-0.3, 0.25, 0.0], height: [0.8, 1.0, 0.93], width: [0.0, 0.15, 0.05], heelOff: [0.15, 0.8, 0.4],
    tdPitch: [0, 20 * DEG, 5 * DEG], toPitch: [-60 * DEG, -5 * DEG, -35 * DEG], pelvisYaw: [0, 15 * DEG, 5 * DEG], pelvisRoll: [0, 10 * DEG, 2 * DEG],
    trunkCounter: [0, 1.5, 0.6], lean: [-5 * DEG, 20 * DEG, 5 * DEG], armSwing: [0, 60 * DEG, 25 * DEG], vpp: [-0.15, 0.5, 0.1], ...OFF } },
  hop: { phaseR: 0.0, label: 'two-footed hop', bounds: {
    freq: [1.0, 3.0, 1.8], duty: [0.25, 0.65, 0.45], shape: [-0.3, 0.3, 0.0], height: [0.78, 1.0, 0.92], width: [0.08, 0.25, 0.13], heelOff: [0.15, 0.8, 0.5],
    tdPitch: [0, 20 * DEG, 3 * DEG], toPitch: [-60 * DEG, -5 * DEG, -30 * DEG], pelvisYaw: [0, 0, 0], pelvisRoll: [0, 0, 0],
    trunkCounter: [0, 0, 0], lean: [-5 * DEG, 20 * DEG, 5 * DEG], armSwing: [0, 45 * DEG, 10 * DEG], vpp: [-0.15, 0.5, 0.1], ...OFF } },
};
export const FIXED = { footFlat: 0.12, clearance: 0.02, elbowFlex: 15 * DEG, shoulderAbduction: 6 * DEG };
// The bounds above (and FIXED.clearance) are for the 1.32 m test biped. Other bodies scale lengths by their leg
// length relative to it (spec.legScale) and frequencies by 1 / sqrt(that), so a stride keeps its Froude number.
// A character's style (spec.style.bounds: [lo, hi], angles in degrees, step width in metres) then narrows or
// opens parameters, so the search finds the cheapest stride that moves the way the character should; a hop
// keeps its left-right symmetry.
const ANGLES = new Set(['tdPitch', 'toPitch', 'pelvisYaw', 'pelvisRoll', 'lean', 'armSwing', 'trunkSway', 'hunch']);
const SIDE_TO_SIDE = ['pelvisYaw', 'pelvisRoll', 'trunkCounter', 'trunkSway'];
export function familyBounds(body, family) {
  const fam = FAMILIES[family], b = fam.bounds, lam = body ? body.spec.legScale || 1 : 1, f = 1 / Math.sqrt(lam);
  const out = { ...b, freq: b.freq.map((v) => v * f), width: b.width.map((v) => v * lam) };
  const style = body && body.spec.style ? body.spec.style.bounds || {} : {};
  for (const [k, [lo, hi]] of Object.entries(style)) {
    if (fam.phaseR === 0 && SIDE_TO_SIDE.includes(k)) continue;
    const u = ANGLES.has(k) ? DEG : 1;
    out[k] = [lo * u, hi * u, Math.min(hi * u, Math.max(lo * u, out[k][2]))];
  }
  return out;
}
export const initialParams = (family, body = null) => { const b = familyBounds(body, family); return Object.fromEntries(PARAMS.map((k) => [k, b[k][2]])); };

// standing COM height with the soles on the ground
export function standingPose(body) {
  const q = body.zeroPose(), f = body.spec.feet.L; q[1] = f.L1 + f.L2 - f.heel[1];
  return q;
}

// solve x'' = k(t) x - u(t) for the periodic solution on a uniform grid of K points over [0, T)
function periodicLinearODE(k, u, T, K) {
  const dt = T / K;
  const step = (x, v, j, withForcing) => {         // RK4 over one grid step; coefficients on a half-step grid
    const f = (x_, v_, i2) => [v_, k(i2) * x_ - (withForcing ? u(i2) : 0)];
    const [a1, b1] = f(x, v, 2 * j), [a2, b2] = f(x + 0.5 * dt * a1, v + 0.5 * dt * b1, 2 * j + 1), [a3, b3] = f(x + 0.5 * dt * a2, v + 0.5 * dt * b2, 2 * j + 1), [a4, b4] = f(x + dt * a3, v + dt * b3, 2 * j + 2);
    return [x + dt / 6 * (a1 + 2 * a2 + 2 * a3 + a4), v + dt / 6 * (b1 + 2 * b2 + 2 * b3 + b4)];
  };
  const run = (x0, v0, forcing, store) => { let x = x0, v = v0; for (let j = 0; j < K; j++) { if (store) { store.x[j] = x; store.v[j] = v; } [x, v] = step(x, v, j, forcing); } return [x, v]; };
  const c1 = run(1, 0, false), c2 = run(0, 1, false), p = run(0, 0, true);
  // (I - Phi) s0 = psi
  const m00 = 1 - c1[0], m01 = -c2[0], m10 = -c1[1], m11 = 1 - c2[1], det = m00 * m11 - m01 * m10;
  const x0 = (p[0] * m11 - m01 * p[1]) / det, v0 = (m00 * p[1] - m10 * p[0]) / det;
  const store = { x: new Float64Array(K), v: new Float64Array(K) }; run(x0, v0, true, store);
  return store;
}

// periodic double integral of a zero-mean acceleration on a uniform grid; returns zero-mean position and velocity
function integratePeriodic(acc, dt) {
  const K = acc.length, v = new Float64Array(K), x = new Float64Array(K);
  for (let j = 1; j < K; j++) v[j] = v[j - 1] + 0.5 * (acc[j - 1] + acc[j]) * dt;
  let vm = 0; for (let j = 0; j < K; j++) vm += v[j] / K; for (let j = 0; j < K; j++) v[j] -= vm;
  for (let j = 1; j < K; j++) x[j] = x[j - 1] + 0.5 * (v[j - 1] + v[j]) * dt;
  let xm = 0; for (let j = 0; j < K; j++) xm += x[j] / K; for (let j = 0; j < K; j++) x[j] -= xm;
  return { x, v };
}

// analytic inverse kinematics for a hip(3)-knee(1)-ankle(2) leg: foot pose (ankle position, rotation) -> joint angles
export function legIK(foot, Rp, pp, ankle, Rf) {
  const h = add(pp, matVec(Rp, foot.hipAt));
  const r = matTVec(Rf, sub(h, ankle));                         // hip relative to the ankle, in the foot frame
  const ai = Math.atan2(-r[2], r[1]), vx = r[0], vy = Math.hypot(r[1], r[2]), d = Math.hypot(r[0], r[1], r[2]);
  const { L1, L2 } = foot;
  let c = (d * d - L1 * L1 - L2 * L2) / (2 * L1 * L2), shortfall = 0;
  if (c > 1) { shortfall = d - (L1 + L2); c = 1; }
  if (c < -1) { shortfall = Math.abs(L1 - L2) - d; c = -1; }
  const qk = -Math.acos(c), rs = [L1 * Math.sin(qk), L2 + L1 * Math.cos(qk)];
  const af = Math.atan2(rs[1], rs[0]) - Math.atan2(vy, vx);
  const Rshank = matMul(matMul(Rf, rotX(-ai)), rotZ(-af)), Rthigh = matMul(Rshank, rotZ(-qk));
  return { hip: jointAngles(matMul(transpose(Rp), Rthigh), ['rz', 'rx', 'ry']), knee: qk, ankle: [af, ai], shortfall };
}

export function generateGait(body, params, { speed, family = 'walk', samples = 200, oversample = 8 } = {}) {
  const fam = FAMILIES[family], spec = body.spec, m = body.mass, p = params;
  // style constants: swing-foot lift (times the default clearance), how far the arms trail the legs (stride fraction),
  // arms swinging outward as they swing forward, elbow bend, neck craned forward, and the head pitched down (deg)
  const style = spec.style || {}, lift = style.lift || 1, armLag = style.armLag || 0, armOut = (style.armOut || 0) * DEG;
  const elbowFlex = style.elbow != null ? style.elbow * DEG : FIXED.elbowFlex, crane = (style.neckCrane || 0) * DEG, gaze = (style.gaze || 0) * DEG;
  const T = 1 / p.freq, S = speed * T, beta = p.duty;
  const sFF = FIXED.footFlat, sHO = Math.max(sFF + 0.05, Math.min(0.97, p.heelOff));
  const feet = ['L', 'R'].map((side) => { const f = spec.feet[side]; return { ...f, key: side, seg: body.segIndex[f.seg], phase: side === 'L' ? 0 : fam.phaseR, z: f.side * p.width / 2,
    heelToBall: f.ball[0] - f.heel[0], footLen: f.toe[0] - f.heel[0] }; });

  // ---- vertical ground force per foot: Alexander & Jayes shape over its stance, scaled to body weight
  const shapeG = (s) => Math.max(0, Math.cos(Math.PI * (s - 0.5)) - p.shape * Math.cos(3 * Math.PI * (s - 0.5)));
  const phaseSinceTouchdown = (f, t) => mod1(t / T - f.phase);
  const K = samples * oversample, dt = T / K;
  let impulse = 0; for (let j = 0; j < 2 * K; j++) for (const f of feet) { const u = phaseSinceTouchdown(f, j * dt / 2); if (u < beta) impulse += shapeG(u / beta); }
  impulse *= dt / 2;
  const amp = m * G * T / impulse;
  const Fy = (f, t) => { const u = phaseSinceTouchdown(f, t); return u < beta ? amp * shapeG(u / beta) : 0; };

  // ---- vertical COM: y'' = sum Fy / m - g, periodic, mean height from the parameter
  const qStand = standingPose(body), comStand = body.comWorld(body.fk(qStand));
  const accY = Float64Array.from({ length: 2 * K }, (_, j) => feet.reduce((sum, f) => sum + Fy(f, j * dt / 2), 0) / m - G);
  const vert = integratePeriodic(accY, dt / 2), yMean = p.height * comStand[1];
  const comY = (i2) => yMean + vert.x[((i2 % (2 * K)) + 2 * K) % (2 * K)];         // on the half-step grid
  const comVy = (i2) => vert.v[((i2 % (2 * K)) + 2 * K) % (2 * K)];

  // ---- nominal pivot of each stance foot (relative to where its heel landed), as a fraction of stance
  const stanceState = (s) => (s < sFF ? 'heel' : s < sHO ? 'flat' : 'toe');
  const pivotOffset = (f, s) => (s < sFF ? 0 : s < sHO ? f.heelToBall * (s - sFF) / (sHO - sFF) : f.heelToBall);
  // horizontal COM relative to the mean forward motion: x~'' = sum k_i (x~ - e_i), e_i = pivot - speed t
  // forces aim at a virtual pivot point a height vpp * (mean COM height) above the COM (Maus et al. 2010)
  const vppHeight = (p.vpp || 0) * yMean, aimY = (i2) => comY(i2) + vppHeight;
  const kOf = (i2) => { const t = i2 * dt / 2; return feet.reduce((sum, f) => sum + Fy(f, t), 0) / (m * aimY(i2)); };
  const uX = (i2) => { const t = i2 * dt / 2; let s = 0; for (const f of feet) { const u = phaseSinceTouchdown(f, t); if (u < beta) s += Fy(f, t) * (pivotOffset(f, u / beta) - speed * u * T); } return s / (m * aimY(i2)); };
  const uZ = (i2) => { const t = i2 * dt / 2; let s = 0; for (const f of feet) s += Fy(f, t) * f.z; return s / (m * aimY(i2)); };
  const horX = periodicLinearODE(kOf, uX, T, K), horZ = periodicLinearODE(kOf, uZ, T, K);

  // ---- foot pitch (toes up +) and ankle path: heel rocker, foot flat, toe rocker, then a swing Hermite
  const tdPitch = p.tdPitch, toPitch = p.toPitch, stanceT = beta * T, swingT = (1 - beta) * T;
  const wTD = sFF > 0 ? -1.2 * tdPitch / (sFF * stanceT) : 0, wTO = 1.6 * toPitch / ((1 - sHO) * stanceT);
  const stancePitch = (s) => (s < sFF ? hermite(tdPitch, wTD * sFF * stanceT, 0, 0, s / sFF) : s < sHO ? 0 : hermite(0, 0, toPitch, wTO * (1 - sHO) * stanceT, (s - sHO) / (1 - sHO)));
  const rollAbout = (pivot, local, pitch) => sub(pivot, matVec(rotZ(pitch), local));
  const spin = (w, r) => [-w * r[1], w * r[0], 0];
  function footAt(f, t) {
    const u = phaseSinceTouchdown(f, t), tTD = t - u * T, heelX = speed * tTD;
    const H = [heelX, 0, f.z], B = [heelX + f.heelToBall, 0, f.z];
    if (u < beta) {
      const s = u / beta, pitch = stancePitch(s), state = stanceState(s);
      const ankle = state === 'toe' ? rollAbout(B, f.ball, pitch) : rollAbout(H, f.heel, pitch);
      return { stance: true, s, state, pitch, ankle, H, B, pivot: [heelX + pivotOffset(f, s), 0, f.z] };
    }
    const tau = (u - beta) / (1 - beta), H2 = [H[0] + S, 0, f.z];
    const aTO = rollAbout(B, f.ball, toPitch), vTO = spin(wTO, sub(aTO, B)), aTD = rollAbout(H2, f.heel, tdPitch), vTD = spin(wTD, sub(aTD, H2));
    const ankle = [0, 1, 2].map((d) => hermite(aTO[d], vTO[d] * swingT, aTD[d], vTD[d] * swingT, tau));
    ankle[1] += FIXED.clearance * (spec.legScale || 1) * lift * 16 * tau * tau * (1 - tau) * (1 - tau);
    return { stance: false, s: tau, state: 'swing', pitch: hermite(toPitch, wTO * swingT, tdPitch, wTD * swingT, tau), ankle };
  }

  // ---- posture: pelvis turns and lists, thorax counter-rotates, leans and rocks, upper back hunches, head level
  // and forward, arms swing
  const pelvisYaw = (ph) => p.pelvisYaw * Math.cos(2 * Math.PI * ph);                 // left hip forward at left touchdown
  const pelvisRoll = (ph) => -p.pelvisRoll * Math.sin(2 * Math.PI * (ph + 0.1));      // swing side drops after touchdown
  const trunkSway = (ph) => p.trunkSway * Math.cos(2 * Math.PI * (ph - beta / 2));    // over the left foot at mid left stance
  const hunch = p.hunch || 0;
  const arms = ['L', 'R'].map((side) => ({ ...spec.arms[side], phase: side === 'L' || fam.phaseR === 0 ? 0 : 0.5 })), abduction = spec.armAbduction ?? FIXED.shoulderAbduction;

  const dofI = body.dofIndex, hipAxes = ['rz', 'rx', 'ry'];
  const setJoint = (q, joint, axes, vals) => axes.forEach((a, k) => { q[dofI[`${joint}.${a}`]] = vals[k]; });
  const out = { T, S, speed, family, params: { ...p }, samples, K, dt, amp, feet, q: [], com: [], contacts: [], footPoses: [], shortfall: new Float64Array(samples), comVel: [] };
  let offset = sub(comStand, [qStand[0], qStand[1], qStand[2]]);
  for (let k = 0; k < samples; k++) {
    const t = k * T / samples, ph = k / samples, i2 = 2 * k * oversample;
    const comDes = [horX.x[k * oversample] + speed * t, comY(i2), horZ.x[k * oversample]];
    out.comVel.push([horX.v[k * oversample] + speed, comVy(i2), horZ.v[k * oversample]]);
    const q = body.zeroPose();
    const Rp = matMul(rotY(pelvisYaw(ph)), rotX(fam.phaseR === 0 ? 0 : pelvisRoll(ph)));
    q[3] = fam.phaseR === 0 ? 0 : pelvisRoll(ph); q[4] = pelvisYaw(ph); q[5] = 0;
    let Rth = matMul(rotY(-p.trunkCounter * pelvisYaw(ph)), rotZ(-p.lean));
    if (p.trunkSway) Rth = matMul(rotX(trunkSway(ph)), Rth);
    // lower and upper spine share the turn, lean and rock; the hunch is extra flexion of the upper spine
    const spineHalf = halfRotation(matMul(transpose(Rp), Rth));
    setJoint(q, spec.spine[0], hipAxes, jointAngles(spineHalf, hipAxes));
    setJoint(q, spec.spine[1], hipAxes, jointAngles(hunch ? matMul(spineHalf, rotZ(-hunch)) : spineHalf, hipAxes));
    // head level and facing forward (or pitched down by the gaze); a craned neck bends forward at its base and
    // back at the skull by the same angle, which carries the head forward and down
    const Rhead = gaze ? rotZ(-gaze) : null, Rthorax = hunch ? matMul(Rth, rotZ(-hunch)) : Rth;
    const neckHalf = halfRotation(Rhead ? matMul(transpose(Rthorax), Rhead) : transpose(Rthorax));
    setJoint(q, spec.neck[0], hipAxes, jointAngles(crane ? matMul(neckHalf, rotZ(-crane)) : neckHalf, hipAxes));
    setJoint(q, spec.neck[1], hipAxes, jointAngles(crane ? matMul(rotZ(crane), neckHalf) : neckHalf, hipAxes));
    // arms swing about where they hang: a hunched back would carry them backward, so the shoulders flex by the hunch
    for (const a of arms) { const swing = -Math.cos(2 * Math.PI * (ph - a.phase - armLag));
      setJoint(q, a.shoulder, ['rz', 'rx', 'ry'], [p.armSwing * swing + hunch, -a.side * (armOut ? abduction + armOut * (1 + swing) / 2 : abduction), 0]);
      setJoint(q, a.elbow, ['rz'], [elbowFlex + 0.4 * p.armSwing * (1 + swing) / 2]); setJoint(q, a.wrist, ['rz'], [0]); }
    const footState = feet.map((f) => footAt(f, t));
    // toes stay level with the ground whenever the foot pitches toes-down (heel up in stance, early swing)
    feet.forEach((f, i) => { q[dofI[`${f.dofs.mtp}.rz`]] = Math.max(0, -footState[i].pitch); });
    let pp = sub(comDes, offset), shortfall = 0;
    for (let it = 0; it < 8; it++) {
      q[0] = pp[0]; q[1] = pp[1]; q[2] = pp[2]; shortfall = 0;
      feet.forEach((f, i) => { const st = footState[i], ik = legIK(f, Rp, pp, st.ankle, rotZ(st.pitch));
        setJoint(q, f.dofs.hip, hipAxes, ik.hip); setJoint(q, f.dofs.knee, ['rz'], [ik.knee]); setJoint(q, f.dofs.ankle, ['rz', 'rx'], ik.ankle); shortfall = Math.max(shortfall, ik.shortfall); });
      const com = body.comWorld(body.fk(q)), err = sub(comDes, com);
      pp = add(pp, err); offset = sub(com, [q[0], q[1], q[2]]);
      if (Math.hypot(...err) < 1e-7) break;
    }
    out.shortfall[k] = shortfall; out.q.push(q); out.com.push(comDes); out.footPoses.push(footState);
    // ground forces: vertical from the shape, horizontal pointing from the nominal pivot to the virtual pivot point
    out.contacts.push(feet.map((f, i) => { const st = footState[i], fy = Fy(f, t); if (!st.stance || fy <= 0) return null;
      const aim = comDes[1] + vppHeight, force = [fy * (comDes[0] - st.pivot[0]) / aim, fy, fy * (comDes[2] - st.pivot[2]) / aim];
      const hx = st.H[0], bx = st.B[0], xb = st.state === 'heel' ? [hx, hx + 0.15 * f.footLen] : st.state === 'flat' ? [hx, hx + f.footLen] : [bx - 0.05 * f.footLen, hx + f.footLen];
      return { foot: f.key, seg: f.seg, pivot: st.pivot, force, state: st.state, bounds: { x: xb, z: [f.z - f.halfWidth, f.z + f.halfWidth] }, freeMax: 0.2 * fy * f.halfWidth }; }));
  }
  return out;
}

// heights of the sole points (heel, ball, toe tip) of every foot at every sample, for ground-penetration checks
export function soleHeights(body, gait, poses = gait.q.map((q) => body.fk(q))) {
  return poses.map((pose) => gait.feet.map((f) => [body.pointWorld(pose, f.seg, f.heel)[1], body.pointWorld(pose, f.seg, f.ball)[1], body.pointWorld(pose, body.segIndex[f.toeSeg], f.toeTip)[1]]));
}
