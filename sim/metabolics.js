// Muscle energy rate after Umberger, Gerritsen & Martin (2003): activation and
// maintenance heat, shortening/lengthening heat, and fibre work. Excitation is
// taken equal to activation (static optimization has no activation dynamics),
// and a muscle's total rate is not allowed below zero (Uchida et al. 2016).
import { activeForceLength, forceVelocity } from './muscles.js';

const S_AEROBIC = 1.5;
const VMAX_FT = 12, VMAX_ST = VMAX_FT / 2.5;                 // optimal fibre lengths per second
const ALPHA_ST = 100 / VMAX_ST, ALPHA_FT = 153 / VMAX_FT, ALPHA_L = 4 * ALPHA_ST;

// muscle m (lopt, ft, mass, F0, vmax), activation a, fibre length lm (m), fibre velocity vm (m/s, + lengthening)
export function muscleEnergyRate(m, a, lm, vm) {
  if (a <= 0 && vm <= 0) return 0;
  const lt = lm / m.lopt, fIso = activeForceLength(lt), vt = vm / m.lopt, ftPct = 100 * m.ft;
  const hAM = (lt <= 1 ? 1 : 0.4 + 0.6 * fIso) * (1.28 * ftPct + 25) * Math.pow(a, 0.6);
  const hSL = vt <= 0 ? (ALPHA_ST * (1 - m.ft) + ALPHA_FT * m.ft) * (-vt) * a * a * (lt > 1 ? fIso : 1) : ALPHA_L * vt * a;
  const activeForce = m.F0 * a * fIso * forceVelocity(vm / m.vmax);
  const work = -activeForce * vm / m.mass;                    // W/kg, positive when shortening
  return Math.max(0, m.mass * (S_AEROBIC * (hAM + hSL) + work));
}

export const BASAL_W_PER_KG = 1.2;
