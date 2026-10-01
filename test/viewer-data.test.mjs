// The humanoid body packs (src/data/<file> from sim/build-biped.mjs, one per sim/characters.js entry)
// against the viewer's data contract, and their merge into the dataset.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { addBody } from '../src/js/bodies.js';
import { CHARACTERS } from '../sim/characters.js';

const load = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const dataset = load('../src/data.json'), reference = dataset.models.hunter;
const packs = Object.entries(CHARACTERS).map(([key, character]) => ({ key, character, pack: load(`../src/data/${character.file}`) }));
const finite = (v) => typeof v === 'number' && Number.isFinite(v);

for (const { key, character, pack } of packs) {
  const model = pack.model, sol = pack.solution;

  test(`${key}: model has every field the viewer reads from the other bodies (anatomy layers are optional)`, () => {
    assert.equal(pack.key, key);
    for (const k of Object.keys(reference)) if (k !== 'anatomy') assert.ok(k in model, `model.${k}`);
    assert.equal(model.dof_names.length, model.nq); assert.equal(model.muscles.length, model.nm);
    const bones = new Set(model.bones.map((b) => b.name));
    assert.equal(bones.size, model.bones.length, 'bone names unique');
    model.bones.forEach((b) => assert.ok(b.length > 0 && b.radius > 0, b.name));
    model.muscles.forEach((m) => { m.path.forEach(([bone, pt]) => { assert.ok(bones.has(bone), `${m.name} path bone ${bone}`); assert.equal(pt.length, 3); });
      for (const k of ['F0', 'lopt', 'lts', 'mass', 'pcsa']) assert.ok(m[k] > 0, `${m.name}.${k}`);
      assert.ok(['spine', 'neck', 'fore-prox', 'fore-dist', 'hind-prox', 'hind-dist'].includes(m.group), m.group); });
    model.contacts.forEach((c) => assert.ok(bones.has(c.bone), c.name));
    assert.ok(bones.has(model.eye[0]), 'eye bone'); assert.ok(bones.has('thorax') && bones.has('head'), 'thorax and head bones are drawn specially');
    model.joints.forEach((j) => j.axes.forEach((a) => { assert.ok(a.q >= 6 && a.q < model.nq, `${j.name}.${a.axis} dof index`); assert.ok(a.lo < a.hi, `${j.name}.${a.axis} range`); assert.equal(model.dof_names[a.q], `${j.name}.${a.axis}`); }));
    model.segments.forEach((s) => assert.ok(bones.has(s.name) && s.mass > 0 && s.muscle >= 0 && s.muscle <= s.mass, s.name));
    assert.deepEqual(Object.keys(model.leg_station).sort(), [...model.legs].sort());
    assert.equal(model.hip_rom.rz.length, model.hip_rom.rx.length);
    assert.equal(model.dof_names[model.hip_rom.q_rz], 'LH_hip.rz'); assert.equal(model.dof_names[model.hip_rom.q_rx], 'LH_hip.rx');
    close(model.segments.reduce((s, x) => s + x.mass, 0), model.mass, 0.05, 'segment masses add up to body mass');
    close(model.mass, character.shape.mass, 0.01, 'mass from sim/characters.js'); assert.equal(model.height, character.shape.height);
    assert.ok(model.outline.length > 20); model.outline.forEach(([bone, a, b, r]) => { assert.ok(bones.has(bone), `outline bone ${bone}`); assert.ok(a.length === 3 && b.length === 3 && r > 0); });
  });

  test(`${key}: solution arrays have the shapes the viewer indexes`, () => {
    const N = sol.poses.length, nb = model.bones.length;
    assert.ok(N >= 20);
    sol.poses.forEach((frame) => { assert.equal(frame.length, nb); frame.forEach((row) => { assert.equal(row.length, 12); assert.ok(row.every(finite));
      const X = row.slice(0, 3), Y = row.slice(3, 6); close(X[0] ** 2 + X[1] ** 2 + X[2] ** 2, 1, 1e-3, 'unit axis'); close(X[0] * Y[0] + X[1] * Y[1] + X[2] * Y[2], 0, 1e-3, 'orthogonal axes'); }); });
    assert.equal(sol.q.length, model.nq); sol.q.forEach((row) => assert.equal(row.length, N));
    for (const k of ['a', 'force', 'lt']) { assert.equal(sol[k].length, model.nm, k); sol[k].forEach((row) => { assert.equal(row.length, N); assert.ok(row.every(finite)); }); }
    sol.a.forEach((row) => row.forEach((a) => assert.ok(a >= 0 && a <= 1)));
    assert.equal(sol.grf.length, 3); sol.grf.forEach((d) => { assert.equal(d.length, model.contacts.length); d.forEach((row) => assert.equal(row.length, N)); });
    assert.deepEqual(Object.keys(sol.stance).sort(), [...model.legs].sort()); Object.values(sol.stance).forEach((row) => { assert.equal(row.length, N); assert.ok(row.every((v) => v === 0 || v === 1)); });
  });

  test(`${key}: summary carries every readout field, all finite, and the stride is dynamically consistent`, () => {
    const s = sol.summary;
    for (const k of ['speed', 'T', 'stride_frequency', 'stride_length', 'froude', 'flight_fraction', 'duty_mean', 'metabolic_power', 'cot', 'cot_J_per_kg_m', 'cot_with_basal', 'reserve_rel', 'peak_grf_bw',
      'lateral_sway_m', 'roll_range_deg', 'yaw_range_deg', 'head_omega_rms_deg_s', 'eye_acc_rms_g', 'head_pitch_rms_deg', 'head_roll_rms_deg', 'bone_clearance_mm', 'double_support_fraction']) assert.ok(finite(s[k]), k);
    assert.equal(typeof s.gait, 'string'); assert.ok(/walk|run|hop/.test(s.gait));
    assert.equal(s.speed, character.speed, 'speed from sim/characters.js');
    model.legs.forEach((leg) => assert.ok(finite(s.footfalls[leg].duty) && finite(s.footfalls[leg].touchdown), leg));
    close(s.T * s.stride_frequency, 1, 1e-9, 'period x frequency'); close(s.stride_length, s.speed * s.T, 1e-6, 'stride length');
    close(s.cot, s.metabolic_power / (model.mass * 9.81 * s.speed), 1e-6, 'COT definition');
    // small unexplained pelvis moment, and muscles supply the joint torques. The comic bipeds' exaggerated styles
    // are imposed on the search, and the stride model's ground forces cannot quite produce them, so their bar is looser
    const bar = character.group === 'comic' ? { residual: 0.05, reserve: 0.03 } : { residual: 0.03, reserve: 0.02 };
    assert.ok(s.root_residual.moment_rel_rms < bar.residual, `pelvis residual ${(s.root_residual.moment_rel_rms * 100).toFixed(1)}% of weight x leg`);
    assert.ok(s.reserve_rel < bar.reserve, `reserve torque ${(s.reserve_rel * 100).toFixed(1)}% of joint torque`);
    assert.ok(s.bone_clearance_mm > 0, 'bones kept apart');
    assert.ok(Object.values(s.power_by_group).every(finite));
  });

  test(`${key}: feet stay on or above the ground, and loaded contacts sit near it`, () => {
    const idx = Object.fromEntries(model.bones.map((b, i) => [b.name, i])), tol = 0.004 * model.height / 1.32;
    sol.poses.forEach((frame, n) => model.contacts.forEach((c, ci) => { const r = frame[idx[c.bone]], p = c.point;
      const y = r[10] + r[1] * p[0] + r[4] * p[1] + r[7] * p[2];
      assert.ok(y - c.radius > -tol, `${c.name} below ground at frame ${n}: ${(y - c.radius).toFixed(4)}`);
      if (sol.grf[1][ci][n] > 0.2) assert.ok(y - c.radius < 2.5 * tol, `${c.name} loaded but ${((y - c.radius) * 1000).toFixed(0)} mm up at frame ${n}`); }));
  });

  test(`${key}: mode card and comparison column match the other bodies`, () => {
    assert.ok(pack.mode.label === character.label && pack.mode.sub && pack.mode.note);
    assert.equal(pack.mode.group, character.group, 'mode cards of one group share a row');
    assert.match(pack.mode.thumb, /^data:image\/svg\+xml;base64,/);
    assert.match(Buffer.from(pack.mode.thumb.split(',')[1], 'base64').toString(), /^<svg[^>]*viewBox/);
    const col = dataset.compare.cols[0];
    for (const k of Object.keys(col)) assert.ok(k in pack.compare, `compare.${k}`);
    for (const k of Object.keys(col.rom)) assert.ok(finite(pack.compare.rom[k]), `compare.rom.${k}`);
    assert.equal(pack.compare.legs, 2); assert.equal(pack.compare.speed, character.speed);
    // an upright back pitches up near 90 degrees; a hunched style tips it forward
    const hunched = character.style && character.style.bounds.hunch;
    assert.ok(pack.compare.pitch > (hunched ? 30 : 60), `back pitch ${pack.compare.pitch}°`);
  });
}

test('addBody merges every humanoid pack as the next modes, solutions and comparison columns, in order', () => {
  const data = structuredClone({ model: dataset.model, models: dataset.models, solutions: dataset.solutions.map((s) => ({ summary: s.summary })), modes: dataset.modes.map(({ thumb, ...m }) => m), compare: dataset.compare, lede: dataset.lede });
  const nSol = data.solutions.length, nModes = data.modes.length, nCols = data.compare.cols.length;
  for (const { pack } of packs) addBody(data, pack);
  assert.equal(data.solutions.length, nSol + packs.length); assert.equal(data.modes.length, nModes + packs.length); assert.equal(data.compare.cols.length, nCols + packs.length);
  packs.forEach(({ key, pack }, i) => {
    const mode = data.modes[nModes + i], merged = data.solutions[mode.sol];
    assert.equal(mode.kicker, `Mode ${nModes + i + 1}`); assert.equal(mode.sol, nSol + i); assert.equal(mode.label, pack.mode.label);
    assert.equal(merged.summary.model, key); assert.equal(data.models[key], pack.model);
    assert.equal(merged.summary.variant, key, 'a variant, like the other non-default bodies'); assert.equal(merged.summary.variant_label, pack.mode.label);
    assert.ok(data.compare.sub.includes(pack.compareSub)); assert.equal(data.compare.cols[nCols + i].label, pack.mode.label);
  });
  // every pack carries the same lede, so the page text does not depend on which is merged last
  packs.forEach(({ pack }) => assert.equal(pack.lede, data.lede));
  assert.match(data.lede, /fourteen bodies/);
  assert.throws(() => addBody(data, packs[0].pack), /already/);
});

function close(a, b, tol, msg) { assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`); }
