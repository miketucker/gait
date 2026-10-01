// Small linear-algebra kit for the biped simulator.
// Vectors are [x, y, z]; 3x3 matrices are flat row-major arrays of 9.
// World frame matches the viewer: x forward, y up, z to the body's left.

export const DEG = Math.PI / 180;

export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const norm = (a) => Math.hypot(a[0], a[1], a[2]);
export const normalize = (a) => { const n = norm(a) || 1; return [a[0] / n, a[1] / n, a[2] / n]; };
export const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export const IDENTITY = Object.freeze([1, 0, 0, 0, 1, 0, 0, 0, 1]);

export function matMul(a, b) {
  const out = new Array(9);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) out[3 * r + c] = a[3 * r] * b[c] + a[3 * r + 1] * b[3 + c] + a[3 * r + 2] * b[6 + c];
  return out;
}
export const matVec = (m, v) => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
export const matTVec = (m, v) => [m[0] * v[0] + m[3] * v[1] + m[6] * v[2], m[1] * v[0] + m[4] * v[1] + m[7] * v[2], m[2] * v[0] + m[5] * v[1] + m[8] * v[2]];
export const transpose = (m) => [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
export const column = (m, c) => [m[c], m[3 + c], m[6 + c]];
export const fromColumns = (x, y, z) => [x[0], y[0], z[0], x[1], y[1], z[1], x[2], y[2], z[2]];

export function rotX(t) { const c = Math.cos(t), s = Math.sin(t); return [1, 0, 0, 0, c, -s, 0, s, c]; }
export function rotY(t) { const c = Math.cos(t), s = Math.sin(t); return [c, 0, s, 0, 1, 0, -s, 0, c]; }
export function rotZ(t) { const c = Math.cos(t), s = Math.sin(t); return [c, -s, 0, s, c, 0, 0, 0, 1]; }
export const ROT = { rx: rotX, ry: rotY, rz: rotZ };
// R * R_axis(t) without a full product: a principal-axis rotation mixes only two columns
const COLS = { rx: [1, 2, 1], ry: [2, 0, 1], rz: [0, 1, 1] };
export function postRotate(R, axis, t) {
  const [a, b] = COLS[axis], c = Math.cos(t), s = Math.sin(t), out = R.slice();
  for (let r = 0; r < 3; r++) { const ca = R[3 * r + a], cb = R[3 * r + b]; out[3 * r + a] = c * ca + s * cb; out[3 * r + b] = -s * ca + c * cb; }
  return out;
}
export const AXIS = { rx: [1, 0, 0], ry: [0, 1, 0], rz: [0, 0, 1] };

// rotation vector (axis * angle) -> matrix, and back
export function expSO3(w) {
  const t = norm(w); if (t < 1e-12) return [1, -w[2], w[1], w[2], 1, -w[0], -w[1], w[0], 1];
  const [x, y, z] = [w[0] / t, w[1] / t, w[2] / t], c = Math.cos(t), s = Math.sin(t), C = 1 - c;
  return [c + x * x * C, x * y * C - z * s, x * z * C + y * s, y * x * C + z * s, c + y * y * C, y * z * C - x * s, z * x * C - y * s, z * y * C + x * s, c + z * z * C];
}
export function logSO3(m) {
  const cosT = clamp((m[0] + m[4] + m[8] - 1) / 2, -1, 1), t = Math.acos(cosT);
  const v = [m[7] - m[5], m[2] - m[6], m[3] - m[1]];
  if (t < 1e-9) return scale(v, 0.5);
  if (Math.PI - t < 1e-6) {                               // near 180 deg: axis from the symmetric part
    const d = [m[0], m[4], m[8]], k = d.indexOf(Math.max(...d)), axis = [0, 0, 0];
    axis[k] = Math.sqrt(Math.max(0, (d[k] + 1) / 2)); for (let j = 0; j < 3; j++) if (j !== k) axis[j] = (m[3 * k + j] + m[3 * j + k]) / (4 * axis[k]);
    return scale(normalize(axis), t);
  }
  return scale(v, t / (2 * Math.sin(t)));
}
// half of a rotation, about the same axis (used to share a relative rotation between two joints)
export const halfRotation = (m) => expSO3(scale(logSO3(m), 0.5));

// Euler decomposition for a joint rotation R = R_a1(q1) R_a2(q2) R_a3(q3) with the
// three axes all different (the orders the body uses: rz-rx-ry and rz-rx).
export function eulerDecompose(R, order) {
  const idx = { rx: 0, ry: 1, rz: 2 }, [i, j, k] = order.map((a) => idx[a]);
  // parity of the permutation (i, j, k): +1 for cyclic (x y z), -1 otherwise
  const sign = ((j - i + 3) % 3 === 1) ? 1 : -1;
  const at = (r, c) => R[3 * r + c];
  const q2 = Math.asin(clamp(sign * at(i, k), -1, 1));
  const q1 = Math.atan2(-sign * at(j, k), at(k, k));
  const q3 = Math.atan2(-sign * at(i, j), at(i, i));
  return [q1, q2, q3];
}
// any one- to three-axis joint: pads to three distinct axes, decomposes, keeps the joint's own
export function jointAngles(R, axes) {
  if (axes.length === 1) { const a = axes[0], [i, j] = a === 'rx' ? [1, 2] : a === 'ry' ? [2, 0] : [0, 1]; return [Math.atan2(R[3 * j + i], R[3 * i + i])]; }
  const full = axes.concat(['rx', 'ry', 'rz'].filter((a) => !axes.includes(a))).slice(0, 3);
  return eulerDecompose(R, full).slice(0, axes.length);
}
export function eulerCompose(order, angles) { let R = IDENTITY.slice(); order.forEach((a, n) => { R = matMul(R, ROT[a](angles[n])); }); return R; }

// Periodic 4th-order central differences on uniformly sampled data.
// samples: array of numbers over one period (the value at t = T equals the value at 0).
export function periodicDerivative(samples, h) {
  const n = samples.length, out = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const p1 = samples[(k + 1) % n], p2 = samples[(k + 2) % n], m1 = samples[(k - 1 + n) % n], m2 = samples[(k - 2 + n) % n];
    out[k] = (-p2 + 8 * p1 - 8 * m1 + m2) / (12 * h);
  }
  return out;
}

// Cubic Hermite on [0, 1]: value and slope (per unit of the local parameter) at both ends.
export function hermite(p0, m0, p1, m1, u) {
  const u2 = u * u, u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * p0 + (u3 - 2 * u2 + u) * m0 + (-2 * u3 + 3 * u2) * p1 + (u3 - u2) * m1;
}
export const smoothstep = (u) => { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); };

// Dense symmetric positive-definite solve (Cholesky). A is row-major n*n, modified copy.
export function choleskySolve(A, b, n) {
  const L = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = A[i * n + j];
      for (let k = 0; k < j; k++) s -= L[i * n + k] * L[j * n + k];
      if (i === j) { if (s <= 1e-14) s = 1e-14; L[i * n + i] = Math.sqrt(s); } else L[i * n + j] = s / L[j * n + j];
    }
  }
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) { let s = b[i]; for (let k = 0; k < i; k++) s -= L[i * n + k] * y[k]; y[i] = s / L[i * n + i]; }
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) { let s = y[i]; for (let k = i + 1; k < n; k++) s -= L[k * n + i] * x[k]; x[i] = s / L[i * n + i]; }
  return x;
}

// Box-constrained strictly convex QP: minimize 0.5 x'Hx + g'x, lo <= x <= hi.
// Primal active-set method: minimize exactly over the free variables with the others held at
// their bounds; step toward that minimizer until a bound blocks (then hold it), and once the
// free minimizer is feasible release the held variable whose multiplier has the wrong sign.
// Finite termination, and robust to the poor scaling that stiff penalty terms give H. Warm-startable.
export function solveBoxQP(H, g, lo, hi, x0, { maxIter = 400 } = {}) {
  const n = g.length, x = new Float64Array(n), held = new Int8Array(n);   // held: -1 at lo, +1 at hi, 0 free
  for (let i = 0; i < n; i++) { x[i] = clamp(x0 ? x0[i] : 0, lo[i], hi[i]); held[i] = x[i] <= lo[i] ? -1 : x[i] >= hi[i] ? 1 : 0; }
  let gScale = 1; for (let i = 0; i < n; i++) gScale = Math.max(gScale, Math.abs(g[i]), Math.abs(H[i * n + i]));
  const tol = 1e-11 * gScale;
  let iterations = 0;
  for (; iterations < maxIter; iterations++) {
    const free = []; for (let i = 0; i < n; i++) if (!held[i]) free.push(i);
    const m = free.length;
    if (m) {
      const Hf = new Float64Array(m * m), rhs = new Float64Array(m);
      for (let a = 0; a < m; a++) { const i = free[a]; let s = -g[i]; for (let j = 0; j < n; j++) if (held[j]) s -= H[i * n + j] * x[j]; rhs[a] = s; for (let b = 0; b < m; b++) Hf[a * m + b] = H[i * n + free[b]]; }
      const target = choleskySolve(Hf, rhs, m);
      let alpha = 1, block = -1, side = 0;
      for (let a = 0; a < m; a++) { const i = free[a], d = target[a] - x[i];
        if (target[a] < lo[i] && d < 0) { const t = (lo[i] - x[i]) / d; if (t < alpha) { alpha = t; block = i; side = -1; } }
        else if (target[a] > hi[i] && d > 0) { const t = (hi[i] - x[i]) / d; if (t < alpha) { alpha = t; block = i; side = 1; } } }
      for (let a = 0; a < m; a++) { const i = free[a]; x[i] = clamp(x[i] + alpha * (target[a] - x[i]), lo[i], hi[i]); }
      if (block >= 0) { x[block] = side < 0 ? lo[block] : hi[block]; held[block] = side; continue; }
    }
    // free variables are at their minimizer: release the held variable with the most wrong-signed multiplier
    let worst = tol, release = -1;
    for (let i = 0; i < n; i++) { if (!held[i] || lo[i] === hi[i]) continue; let gr = g[i]; for (let j = 0; j < n; j++) gr += H[i * n + j] * x[j];
      const pull = held[i] < 0 ? -gr : gr; if (pull > worst) { worst = pull; release = i; } }
    if (release < 0) break;
    held[release] = 0;
  }
  return { x, iterations };
}
