#!/usr/bin/env node
// Simulates the test biped and its variants (sim/characters.js) and writes one viewer body pack per
// character (src/data/<file>).
//
//   node sim/build-biped.mjs                  every character, full search (a few minutes each)
//   node sim/build-biped.mjs --body ogre      one character (repeat --body for several)
//   node sim/build-biped.mjs --quick          small budgets, for checking the pipeline end to end
//   node sim/build-biped.mjs --body kid --out path.json
//   node sim/build-biped.mjs --from src/data/ogre.json   re-export a saved stride without searching
//
// For each gait family (walk, run, two-footed hop) the stride parameters are searched for the
// lowest metabolic cost of transport at the character's speed; the cheapest family is polished at
// the export resolution and exported. Deterministic: the same code always produces the same files.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildHumanoid } from './humanoid.js';
import { MuscleSet } from './muscles.js';
import { evaluate, optimizeGait } from './simulate.js';
import { exportPack } from './export.js';
import { CHARACTERS } from './characters.js';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2), flag = (name) => args.includes(name), value = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const values = (name) => args.flatMap((a, i) => (a === name ? [args[i + 1]] : []));
const quick = flag('--quick'), from = value('--from', null);
const EXPORT = { samples: 200, frames: 50 };
// evaluations per gait family (the walk, which every character ends up using, gets more restart rounds)
const budgets = quick ? { walk: 240, run: 120, hop: 120, polish: 60 } : { walk: 5000, run: 1500, hop: 1500, polish: 400 };
const rounds = { walk: quick ? 1 : 4, run: 1, hop: 1 };

// page text shared by every pack: the viewer keeps the last pack's lede, so each carries the same one
const humanoids = Object.values(CHARACTERS), list = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : xs.join(''));
const NUMBERS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
const GROUPS = { humanoid: 'humanoids', comic: 'comic bipeds' }, UPSTREAM_BODIES = 5;
const groups = Object.keys(GROUPS).map((g) => humanoids.filter((c) => c.group === g)).filter((cs) => cs.length)
  .map((cs) => `${NUMBERS[cs.length]} ${GROUPS[cs[0].group]} (${list(cs.map((c) => c.short))})`);
const slow = humanoids.filter((c) => c.speed !== 1);
const LEDE = `A muscle-driven 3D animal walks on the gait that minimizes its metabolic cost, with its bones kept apart and its head held steady and level. Switch between ${NUMBERS[UPSTREAM_BODIES + humanoids.length]} bodies: the quadruped, the same body with long forelimbs and broad shoulders, that body with ten legs, a three-legged walker, a six-legged one, ${list(groups)}; everything below follows the selected body. All walk at 1 m/s${slow.length ? ` except ${list(slow.map((c) => `the ${c.label.toLowerCase()} at ${c.speed} m/s`))}` : ''}.`;
// the humanoids' mode cards share a scale (the tallest fills its card) so they show relative size; each comic
// biped fills its own card, to show its proportions
const REF_HEIGHT = Math.max(...humanoids.filter((c) => c.group === 'humanoid').map((c) => c.shape.height));

const keys = from ? [JSON.parse(readFileSync(resolve(from), 'utf8')).key] : values('--body').length ? values('--body') : Object.keys(CHARACTERS);
for (const key of keys) if (!CHARACTERS[key]) throw new Error(`unknown body "${key}" (known: ${Object.keys(CHARACTERS).join(', ')})`);
if (value('--out', null) && keys.length > 1) throw new Error('--out needs a single --body');

const t0 = performance.now(), log = (msg) => console.log(`[${((performance.now() - t0) / 1000).toFixed(0).padStart(4)} s] ${msg}`);
for (const key of keys) {
  const c = CHARACTERS[key], speed = c.speed, out = resolve(value('--out', resolve(here, '../src/data', c.file)));
  const body = buildHumanoid({ ...c.shape, style: c.style || null, name: key }), ms = new MuscleSet(body);
  log(`${key}: ${body.mass.toFixed(1)} kg, ${body.spec.height} m, ${body.nq} DOF, ${ms.list.length} muscles, ${speed} m/s`);
  const styleNote = c.style ? `. Its stride is held to ${c.style.note}; the search finds the cheapest walk in that style` : '';
  const text = { key, label: c.label, group: c.group, note: `${c.what} with ${c.traits}${speed !== 1 ? `, walking slowly at ${speed} m/s` : ''}${styleNote}`, lede: LEDE, refHeight: c.group === 'humanoid' ? REF_HEIGHT : 0,
    compareSub: key === 'biped'
      ? `The biped is a ${body.mass.toFixed(1)} kg, ${c.shape.height.toFixed(2)} m humanoid simulated with a simpler pipeline (a searched stride, inverse dynamics and static optimization rather than full trajectory optimization), so its numbers are indicative rather than strictly comparable; its back pitch is near 90° because it stands upright, and its wrist and ankle ranges fill the carpus and hock rows.`
      : `The ${c.label.toLowerCase()} (${body.mass.toFixed(1)} kg, ${c.shape.height.toFixed(2)} m${speed !== 1 ? `, at ${speed} m/s` : ''}) is the biped reshaped: ${c.traits}.` };

  // --from pack.json: skip the search and re-export the stride saved in an earlier pack
  if (from) {
    const prev = JSON.parse(readFileSync(resolve(from), 'utf8')), s0 = prev.solution.summary;
    const final = evaluate(body, ms, s0.gait_params, { speed, family: s0.gait_family, ...EXPORT, full: true });
    const pack = exportPack(body, ms, final, { ...text, evals: s0.iterations, alternatives: s0.alternatives });
    writeFileSync(out, JSON.stringify(pack));
    log(`${key}: re-exported ${s0.gait_family} from ${from} to ${out}: COT ${pack.solution.summary.cot.toFixed(3)}`);
    continue;
  }

  let evals = 0;
  const families = {};
  for (const family of ['walk', 'run', 'hop']) {
    const res = optimizeGait(body, ms, { speed, family, maxEvals: budgets[family], restarts: rounds[family], log: (m) => log(`${key} ${m}`) });
    evals += res.evals;
    const full = evaluate(body, ms, res.params, { speed, family, ...EXPORT });
    families[family] = { params: res.params, cost: full.cost, cot: full.cot, residual: full.residual.momentRmsNm };
    log(`${key} ${family}: COT ${full.cot.toFixed(3)} (cost with penalties ${full.cost.toFixed(3)}, unexplained pelvis moment ${full.residual.momentRmsNm.toFixed(1)} Nm RMS)`);
  }
  // a style describes a walk, so a styled character walks; the others take the cheapest family
  const bestFamily = c.style ? 'walk' : Object.keys(families).reduce((a, b) => (families[b].cost < families[a].cost ? b : a));
  log(`${key}: exporting ${bestFamily}; polishing at export resolution`);
  const polished = optimizeGait(body, ms, { speed, family: bestFamily, start: families[bestFamily].params, maxEvals: budgets.polish, restarts: 0, step: 0.08, ...EXPORT, log: (m) => log(`${key} ${m}`) });
  evals += polished.evals;
  const params = polished.cost < families[bestFamily].cost ? polished.params : families[bestFamily].params;
  const final = evaluate(body, ms, params, { speed, family: bestFamily, ...EXPORT, full: true });
  families[bestFamily].cot = final.cot; families[bestFamily].residual = final.residual.momentRmsNm;

  const alternatives = Object.entries(families).map(([family, f]) => ({ family, cot: +f.cot.toFixed(4), residual_moment_nm: +f.residual.toFixed(2) }));
  const pack = exportPack(body, ms, final, { ...text, evals, alternatives });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(pack));
  const s = pack.solution.summary;
  log(`${key}: wrote ${out} (${(JSON.stringify(pack).length / 1024).toFixed(0)} KB): ${s.gait}, COT ${s.cot.toFixed(3)}, ${s.metabolic_power.toFixed(0)} W, ` +
    `residual ${s.root_residual.moment_nm_rms.toFixed(1)} Nm RMS, reserves ${s.reserve_rms.toFixed(2)} Nm RMS, soft-tissue overlap ${(final.softOverlap * 1000).toFixed(0)} mm, ${evals} evaluations`);
}
