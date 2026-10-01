// Inverse dynamics of a periodic motion: segment accelerations by periodic
// finite differences, Newton-Euler from the leaves to the root, joint torques
// as the transmitted moment projected on each DOF axis. Whatever the contact
// forces cannot explain is left as a residual wrench on the root.
import { add, sub, scale, cross, dot, matMul, matVec, transpose, periodicDerivative, solveBoxQP } from './math.js';

export const GRAVITY = [0, -9.81, 0];

// kinematics over one stride: q samples (M rows), stride period T, forward travel S per stride
export function strideKinematics(body, qs, T, S) {
  const M = qs.length, h = T / M, nseg = body.segments.length;
  const poses = qs.map((q) => body.fk(q)), axes = qs.map((q, k) => body.dofAxes(q, poses[k]));
  const com = poses.map((pose) => body.segments.map((s) => body.pointWorld(pose, s.index, s.com)));
  const acc = poses.map(() => new Array(nseg)), omega = poses.map(() => new Array(nseg)), alpha = poses.map(() => new Array(nseg));
  for (let s = 0; s < nseg; s++) {
    for (let d = 0; d < 3; d++) {           // COM acceleration (x drifts by S per stride)
      const x = Float64Array.from(com, (row, k) => row[s][d] - (d === 0 ? S * k / M : 0));
      const a = periodicDerivative(periodicDerivative(x, h), h);
      for (let k = 0; k < M; k++) { if (!acc[k][s]) acc[k][s] = [0, 0, 0]; acc[k][s][d] = a[k]; }
    }
    const Rdot = []; for (let e = 0; e < 9; e++) Rdot.push(periodicDerivative(Float64Array.from(poses, (p) => p.R[s][e]), h));
    for (let k = 0; k < M; k++) {           // omega^ = Rdot R^T
      const W = matMul(Array.from({ length: 9 }, (_, e) => Rdot[e][k]), transpose(poses[k].R[s]));
      omega[k][s] = [(W[7] - W[5]) / 2, (W[2] - W[6]) / 2, (W[3] - W[1]) / 2];
    }
    for (let d = 0; d < 3; d++) { const w = periodicDerivative(Float64Array.from(omega, (row) => row[s][d]), h); for (let k = 0; k < M; k++) { if (!alpha[k][s]) alpha[k][s] = [0, 0, 0]; alpha[k][s][d] = w[k]; } }
  }
  return { M, h, T, S, qs, poses, axes, com, acc, omega, alpha };
}

// one backward Newton-Euler pass at sample k. externals: [{ seg, point, force, moment }]
// returns joint forces/moments per segment (exerted by the parent), torques per DOF, root residual
export function newtonEuler(body, kin, k, externals) {
  const nseg = body.segments.length, f = new Array(nseg), n = new Array(nseg);
  const pose = kin.poses[k];
  const extBySeg = new Map(); for (const e of externals) { if (!extBySeg.has(e.seg)) extBySeg.set(e.seg, []); extBySeg.get(e.seg).push(e); }
  for (let s = nseg - 1; s >= 0; s--) {
    const seg = body.segments[s], R = pose.R[s], c = kin.com[k][s], p = pose.p[s], w = kin.omega[k][s], al = kin.alpha[k][s];
    const Rt = transpose(R), Iw = (v) => { const b = matVec(Rt, v); return matVec(R, [seg.inertia[0] * b[0], seg.inertia[1] * b[1], seg.inertia[2] * b[2]]); };
    let fs = sub(scale(kin.acc[k][s], seg.mass), scale(GRAVITY, seg.mass));
    let ns = add(Iw(al), cross(w, Iw(w)));
    for (const e of extBySeg.get(s) || []) { fs = sub(fs, e.force); ns = sub(ns, add(cross(sub(e.point, c), e.force), e.moment || [0, 0, 0])); }
    for (const ci of seg.children) { fs = add(fs, f[ci]); ns = add(ns, add(n[ci], cross(sub(pose.p[ci], c), f[ci]))); }
    ns = sub(ns, cross(sub(p, c), fs));
    f[s] = fs; n[s] = ns;
  }
  const tau = new Float64Array(body.nq);
  body.dofs.forEach((d, i) => { if (!d.root) tau[i] = dot(n[d.seg], kin.axes[k][i].u); });
  return { f, n, tau, rootForce: f[0], rootMoment: n[0] };
}

// Contacts at sample k: [{ foot, seg, pivot (world, on the ground), force, bounds: { x: [lo, hi], z: [lo, hi] }, freeMax }]
// Chooses each stance foot's centre of pressure inside its support region, and a free
// moment about the vertical, to cancel as much of the root residual moment as possible.
export function solveContacts(body, kin, k, contacts, { regularization = 1e-3 } = {}) {
  const base = newtonEuler(body, kin, k, contacts.map((c) => ({ seg: c.seg, point: c.pivot, force: c.force })));
  if (!contacts.length) return { ...base, cops: [], free: [] };
  const n0 = base.rootMoment, nv = 3 * contacts.length;
  // residual moment = n0 - sum_i (delta_i x F_i + tau_i y)
  const B = Array.from({ length: 3 }, () => new Float64Array(nv));
  contacts.forEach((c, i) => { const F = c.force;
    B[0][3 * i] = 0; B[1][3 * i] = -F[2]; B[2][3 * i] = F[1];             // d/d(delta x)
    B[0][3 * i + 1] = -F[1]; B[1][3 * i + 1] = F[0]; B[2][3 * i + 1] = 0; // d/d(delta z)
    B[1][3 * i + 2] = 1; });                                               // d/d(free moment)
  const weight = Math.max(1, ...contacts.map((c) => Math.abs(c.force[1])));
  const H = new Float64Array(nv * nv), g = new Float64Array(nv), lo = new Float64Array(nv), hi = new Float64Array(nv);
  for (let a = 0; a < nv; a++) { for (let b = 0; b < nv; b++) { let s = 0; for (let r = 0; r < 3; r++) s += B[r][a] * B[r][b]; H[a * nv + b] = 2 * s; }
    // small preference for the nominal pivot (N^2 * m^2 per m^2) and for no free moment (per N^2 m^2)
    let s = 0; for (let r = 0; r < 3; r++) s += B[r][a] * n0[r]; g[a] = -2 * s; H[a * nv + a] += 2 * regularization * (a % 3 === 2 ? 10 : weight * weight); }
  contacts.forEach((c, i) => { lo[3 * i] = c.bounds.x[0] - c.pivot[0]; hi[3 * i] = c.bounds.x[1] - c.pivot[0]; lo[3 * i + 1] = c.bounds.z[0] - c.pivot[2]; hi[3 * i + 1] = c.bounds.z[1] - c.pivot[2]; lo[3 * i + 2] = -c.freeMax; hi[3 * i + 2] = c.freeMax;
    for (let j = 0; j < 3; j++) if (lo[3 * i + j] > hi[3 * i + j]) { const m = 0.5 * (lo[3 * i + j] + hi[3 * i + j]); lo[3 * i + j] = hi[3 * i + j] = m; } });
  const x0 = new Float64Array(nv); for (let a = 0; a < nv; a++) x0[a] = Math.min(hi[a], Math.max(lo[a], 0));
  const { x } = solveBoxQP(H, g, lo, hi, x0);
  const cops = contacts.map((c, i) => [c.pivot[0] + x[3 * i], 0, c.pivot[2] + x[3 * i + 1]]), free = contacts.map((c, i) => x[3 * i + 2]);
  const final = newtonEuler(body, kin, k, contacts.map((c, i) => ({ seg: c.seg, point: cops[i], force: c.force, moment: [0, free[i], 0] })));
  return { ...final, cops, free };
}
