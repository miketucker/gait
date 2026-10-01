// Nelder-Mead simplex minimization (Lagarias et al. 1998 coefficients), deterministic.
export function nelderMead(f, x0, { step = 0.3, maxEvals = 2000, tol = 1e-7 } = {}) {
  const n = x0.length;
  if (!n) return { x: [], fx: f([]), evals: 1 };
  let simplex = [Array.from(x0)];
  for (let i = 0; i < n; i++) { const x = Array.from(x0); x[i] += Array.isArray(step) ? step[i] : step; simplex.push(x); }
  let values = simplex.map((x) => f(x)), evals = n + 1;
  const combine = (a, b, t) => a.map((v, i) => v + t * (b[i] - v));        // a + t (b - a)
  while (evals < maxEvals) {
    const order = values.map((v, i) => i).sort((a, b) => values[a] - values[b]);
    simplex = order.map((i) => simplex[i]); values = order.map((i) => values[i]);
    if (Math.abs(values[n] - values[0]) <= tol * (Math.abs(values[0]) + 1e-12)) break;
    const centroid = simplex[0].map((_, j) => simplex.slice(0, n).reduce((s, x) => s + x[j], 0) / n);
    const worst = simplex[n];
    const xr = combine(centroid, worst, -1), fr = f(xr); evals++;
    if (fr < values[0]) {
      const xe = combine(centroid, worst, -2), fe = f(xe); evals++;
      if (fe < fr) { simplex[n] = xe; values[n] = fe; } else { simplex[n] = xr; values[n] = fr; }
    } else if (fr < values[n - 1]) { simplex[n] = xr; values[n] = fr; }
    else {
      const outside = fr < values[n], xc = combine(centroid, outside ? xr : worst, 0.5), fc = f(xc); evals++;
      if (fc < (outside ? fr : values[n])) { simplex[n] = xc; values[n] = fc; }
      else { for (let i = 1; i <= n; i++) { simplex[i] = combine(simplex[0], simplex[i], 0.5); values[i] = f(simplex[i]); evals++; } }
    }
  }
  const bestIdx = values.indexOf(Math.min(...values));
  return { x: simplex[bestIdx], fx: values[bestIdx], evals };
}
