// Hill-type muscle-tendon units on via-point paths, their moment arms, and
// static optimization of activations against inverse-dynamics joint torques.
// Force-length / force-velocity / passive curves after De Groote et al. (2016).
import { sub, dot, cross, norm, solveBoxQP, periodicDerivative } from './math.js';

const MAX_CONTRACTION_VELOCITY = 10;     // optimal fibre lengths per second
export const TENDON_STRAIN_AT_F0 = 0.04;

// ---- curves (normalized fibre length lt = l / lopt, normalized velocity vt = v / (vmax lopt))
const FL = [[0.815, 1.055, 0.162, 0.063], [0.433, 0.717, -0.030, 0.200], [0.100, 1.000, 0.354, 0.000]];
export function activeForceLength(lt) { let f = 0; for (const [b1, b2, b3, b4] of FL) { const d = b3 + b4 * lt; f += b1 * Math.exp(-0.5 * (lt - b2) ** 2 / (d * d)); } return f; }
export function passiveForceLength(lt) { const kpe = 4, e0 = 0.6; return lt <= 1 ? 0 : (Math.exp(kpe * (lt - 1) / e0) - 1) / (Math.exp(kpe) - 1); }
export function forceVelocity(vt) { vt = Math.max(-1, Math.min(1, vt)); const d1 = -0.318, d2 = -8.149, d3 = -0.374, d4 = 0.886, x = d2 * vt + d3; return d1 * Math.log(x + Math.sqrt(x * x + 1)) + d4; }

// ---- geometry
export class MuscleSet {
  constructor(body) {
    this.body = body;
    const spec = body.spec;
    this.list = spec.muscles.map((m) => ({ ...m, pts: m.path.map(([seg, local]) => ({ seg: body.segIndex[seg], local })) }));
    // DOFs each muscle can move: a joint between the first and last path segment
    this.crossed = this.list.map((m) => {
      const out = [];
      body.dofs.forEach((d, k) => { if (d.root) return; const segs = m.pts.map((p) => body.ancestors[p.seg].has(d.seg)); if (segs.some(Boolean) && !segs.every(Boolean)) out.push(k); });
      return out;
    });
    // fibre and tendon lengths from the standing reference posture: the fibres take their share rf of the
    // muscle-tendon length at normalized length standingLength, and the tendon is just taut
    const q0 = body.zeroPose(), pose0 = body.fk(q0);
    this.list.forEach((m) => {
      const L = this.length(pose0, m), fibre = m.rf * L;
      m.lopt = fibre / (m.standingLength || 1);
      m.lts = L - fibre * Math.cos(m.pen);
      m.pcsa = m.F0 / spec.specificTension;
      m.mass = spec.muscleDensity * m.pcsa * m.lopt;
      m.vmax = MAX_CONTRACTION_VELOCITY * m.lopt;
    });
    const meanMass = this.list.reduce((s, m) => s + m.mass, 0) / this.list.length;
    this.volumeWeights = this.list.map((m) => m.mass / meanMass);
    // independent blocks for static optimization: connected components of muscles <-> DOFs
    const parent = new Map(), find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
    const union = (a, b) => { if (!parent.has(a)) parent.set(a, a); if (!parent.has(b)) parent.set(b, b); parent.set(find(a), find(b)); };
    this.list.forEach((m, i) => { union(`m${i}`, `m${i}`); this.crossed[i].forEach((k) => union(`m${i}`, `d${k}`)); });
    body.dofs.forEach((d, k) => { if (!d.root) union(`d${k}`, `d${k}`); });
    const groups = new Map();
    for (const key of parent.keys()) { const r = find(key); if (!groups.has(r)) groups.set(r, { muscles: [], dofs: [] }); const g = groups.get(r); if (key[0] === 'm') g.muscles.push(+key.slice(1)); else g.dofs.push(+key.slice(1)); }
    this.blocks = [...groups.values()].map((g) => ({ muscles: g.muscles.sort((a, b) => a - b), dofs: g.dofs.sort((a, b) => a - b) }));
  }

  worldPoints(pose, m) { return m.pts.map((p) => this.body.pointWorld(pose, p.seg, p.local)); }
  length(pose, m) { const w = this.worldPoints(pose, m); let L = 0; for (let j = 0; j + 1 < w.length; j++) L += norm(sub(w[j + 1], w[j])); return L; }

  // path length and moment arms r_k = -dL/dq_k for one pose (analytic: points distal to DOF k turn about its axis)
  lengthAndMomentArms(pose, axes, i) {
    const m = this.list[i], w = this.worldPoints(pose, m), dirs = [];
    let L = 0; for (let j = 0; j + 1 < w.length; j++) { const d = sub(w[j + 1], w[j]), l = norm(d); L += l; dirs.push(d.map((v) => v / (l || 1))); }
    const arms = new Map();
    for (const k of this.crossed[i]) {
      const { u, c } = axes[k], segK = this.body.dofs[k].seg;
      const vel = w.map((pt, j) => (this.body.ancestors[m.pts[j].seg].has(segK) ? cross(u, sub(pt, c)) : [0, 0, 0]));
      let dL = 0; for (let j = 0; j + 1 < w.length; j++) dL += dot(dirs[j], sub(vel[j + 1], vel[j]));
      arms.set(k, -dL);
    }
    return { L, arms };
  }
}

// ---- static optimization over one periodic stride
// frames: [{ pose, axes, tau (joint torques needed, Float64Array nq) }]; T: stride period
// At every frame minimize  sum_i v_i (LINEAR_SHARE a_i + a_i^2) + w sum_k (reserve_k / 1 Nm)^2,
// v_i = muscle volume / mean volume. The linear term (total active muscle volume) dominates: it is
// a convex stand-in for the metabolic rate, whose activation heat grows like a^0.6 and so rewards
// recruiting few muscles well rather than many a little (sum a^2 alone overstates the cost by ~30%).
// Tendons stretch with force (quasi-static compliance, iterated) so fibre lengths and velocities follow the loads.
export const LINEAR_SHARE = 3;
export function staticOptimization(ms, frames, T, { reserveWeight = 1e5, iterations = 3, warm = null, weights = ms.volumeWeights, linear = ms.volumeWeights.map((v) => LINEAR_SHARE * v) } = {}) {
  const N = frames.length, nm = ms.list.length, h = T / N;
  const geom = frames.map((f) => ms.list.map((_, i) => ms.lengthAndMomentArms(f.pose, f.axes, i)));
  const a = warm ? warm.map((row) => Float64Array.from(row)) : Array.from({ length: nm }, () => new Float64Array(N).fill(0.02));
  const force = Array.from({ length: nm }, () => new Float64Array(N)), lt = Array.from({ length: nm }, () => new Float64Array(N));
  const lm = Array.from({ length: nm }, () => new Float64Array(N)), vm = Array.from({ length: nm }, () => new Float64Array(N));
  const cosPen = Array.from({ length: nm }, () => new Float64Array(N));
  const reserve = Array.from({ length: frames[0].tau.length }, () => new Float64Array(N));
  const muscleTorque = Array.from({ length: frames[0].tau.length }, () => new Float64Array(N));
  for (let i = 0; i < nm; i++) for (let n = 0; n < N; n++) lt[i][n] = ms.list[i].lts;
  let gains = null, passive = null;
  for (let it = 0; it < iterations; it++) {
    // fibre kinematics from path length minus tendon length (constant-thickness pennation)
    for (let i = 0; i < nm; i++) {
      const m = ms.list[i], thick = m.lopt * Math.sin(m.pen);
      for (let n = 0; n < N; n++) { const along = Math.max(0.2 * m.lopt, geom[n][i].L - lt[i][n]); lm[i][n] = Math.hypot(along, thick); cosPen[i][n] = along / lm[i][n]; }
      vm[i].set(periodicDerivative(lm[i], h));
    }
    gains = Array.from({ length: nm }, () => new Float64Array(N)); passive = Array.from({ length: nm }, () => new Float64Array(N));
    for (let i = 0; i < nm; i++) { const m = ms.list[i]; for (let n = 0; n < N; n++) { const l = lm[i][n] / m.lopt;
      gains[i][n] = m.F0 * activeForceLength(l) * forceVelocity(vm[i][n] / m.vmax) * cosPen[i][n]; passive[i][n] = m.F0 * passiveForceLength(l) * cosPen[i][n]; } }
    for (const block of ms.blocks) {
      const bm = block.muscles, bd = block.dofs, nb = bm.length, nd = bd.length;
      if (!nd) continue;
      for (let n = 0; n < N; n++) {
        const tau = bd.map((k) => { let t = frames[n].tau[k]; for (const i of bm) { const r = geom[n][i].arms.get(k); if (r) t -= r * passive[i][n]; } return t; });
        if (!nb) { bd.forEach((k, d) => { reserve[k][n] = tau[d]; }); continue; }
        const A = new Float64Array(nd * nb);           // torque per unit activation
        bd.forEach((k, d) => bm.forEach((i, c) => { A[d * nb + c] = (geom[n][i].arms.get(k) || 0) * gains[i][n]; }));
        const H = new Float64Array(nb * nb), g = new Float64Array(nb);
        for (let c = 0; c < nb; c++) { H[c * nb + c] = 2 * (weights ? weights[bm[c]] : 1); for (let e = 0; e < nb; e++) { let s = 0; for (let d = 0; d < nd; d++) s += A[d * nb + c] * A[d * nb + e]; H[c * nb + e] += 2 * reserveWeight * s; }
          let s = 0; for (let d = 0; d < nd; d++) s += A[d * nb + c] * tau[d]; g[c] = -2 * reserveWeight * s + (linear ? linear[bm[c]] : 0); }
        const lo = new Float64Array(nb), hi = new Float64Array(nb).fill(1), x0 = bm.map((i) => a[i][n]);
        const { x } = solveBoxQP(H, g, lo, hi, x0);
        bm.forEach((i, c) => { a[i][n] = x[c]; });
        bd.forEach((k, d) => { let t = 0; for (let c = 0; c < nb; c++) t += A[d * nb + c] * x[c]; reserve[k][n] = tau[d] - t; });
      }
    }
    // tendon force and (linear) tendon stretch for the next pass
    for (let i = 0; i < nm; i++) { const m = ms.list[i]; for (let n = 0; n < N; n++) { const F = Math.max(0, gains[i][n] * a[i][n] + passive[i][n]); force[i][n] = F; lt[i][n] = m.lts * (1 + TENDON_STRAIN_AT_F0 * F / m.F0); } }
  }
  for (let n = 0; n < N; n++) for (let i = 0; i < nm; i++) for (const [k, r] of geom[n][i].arms) muscleTorque[k][n] += r * force[i][n];
  return { a, force, lt, lm, vm, cosPen, reserve, muscleTorque, geom };
}

// ---- passive joint torques: linear spring about rest plus quadratic walls past the range.
// A joint with `couple` has one rounded (superellipse) range over two of its axes
// instead of two independent limits, so the corners of the box are out of reach.
export const superellipseRadius = (u, v, p) => (Math.abs(u) ** p + Math.abs(v) ** p) ** (1 / p);
export function passiveJointTorque(body, q) {
  const tau = new Float64Array(body.nq), wall = body.spec.wallStiffness, D2R = Math.PI / 180;
  for (const s of body.segments) {
    if (!s.joint) continue;
    const coupled = s.joint.couple ? s.joint.couple.axes.map((a) => s.joint.axes.indexOf(a)) : [];
    s.joint.axes.forEach((axis, k) => {
      const i = s.dofStart + k, v = q[i], lo = s.joint.lo[k] * D2R, hi = s.joint.hi[k] * D2R;
      tau[i] = -s.joint.K[k] * (v - s.joint.rest[k]);
      if (!coupled.includes(k)) tau[i] += -wall * Math.max(0, v - hi) ** 2 + wall * Math.max(0, lo - v) ** 2;
    });
    if (coupled.length === 2) {
      const p = s.joint.couple.p, [ka, kb] = coupled;
      const half = (k) => (s.joint.hi[k] - s.joint.lo[k]) * D2R / 2, mid = (k) => (s.joint.hi[k] + s.joint.lo[k]) * D2R / 2;
      const u = (q[s.dofStart + ka] - mid(ka)) / half(ka), w = (q[s.dofStart + kb] - mid(kb)) / half(kb), rho = superellipseRadius(u, w, p);
      if (rho > 1) {
        const scale = rho ** (1 - p), gu = scale * Math.sign(u) * Math.abs(u) ** (p - 1) / half(ka), gw = scale * Math.sign(w) * Math.abs(w) ** (p - 1) / half(kb);
        const gn = Math.hypot(gu, gw), excess = (rho - 1) / gn;     // distance past the boundary (rad), and the outward normal
        tau[s.dofStart + ka] -= wall * excess * excess * gu / gn; tau[s.dofStart + kb] -= wall * excess * excess * gw / gn;
      }
    }
  }
  return tau;
}
