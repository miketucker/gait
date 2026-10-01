// Converts a simulated biped stride into the viewer's data format: a "body pack"
// holding a model (like DATA.models[key]), one solution, a mode card and a
// comparison column. src/js/bodies.js merges packs into the dataset at load time.
import { add, sub, matVec, norm, periodicDerivative, DEG } from './math.js';
import { clearancePairs, segmentDistance } from './simulate.js';
import { superellipseRadius } from './muscles.js';
import { PARAMS, familyBounds } from './gait.js';
import { BASAL_W_PER_KG } from './metabolics.js';

const G = 9.81;
const round = (v, d = 4) => { const f = 10 ** d; return Math.round(v * f) / f; };
const roundArr = (arr, d) => Array.from(arr, (v) => round(v, d));
const legCode = (name) => (/^([LR][FH])_/.exec(name) || [])[1] || '';
const GAIT_NAMES = { walk: 'bipedal walk', run: 'bipedal run', hop: 'two-footed hop (pronk)' };

export function exportModel(body, ms, { key, label, gaitParamCount }) {
  const spec = body.spec, m = body.mass;
  const joints = body.segments.filter((s) => s.joint).map((s) => ({ name: s.joint.name, free: s.joint.axes.slice(),
    axes: s.joint.axes.map((axis, k) => ({ axis, unit: 'deg', lo: round(s.joint.lo[k], 2), hi: round(s.joint.hi[k], 2), K: round(s.joint.K[k], 3), q: s.dofStart + k, quasi_static: false })),
    coupled: [], offdiag: false, notes: s.joint.notes || '' }));
  // left hip: the rounded flexion x adduction range the passive wall enforces
  const hip = body.segments.find((s) => s.joint && s.joint.name === 'LH_hip').joint, kz = hip.axes.indexOf('rz'), kx = hip.axes.indexOf('rx'), p = hip.couple.p;
  const hipRom = { rz: [], rx: [], q_rz: body.dofIndex['LH_hip.rz'], q_rx: body.dofIndex['LH_hip.rx'] };
  for (let i = 0; i < 72; i++) { const a = 2 * Math.PI * i / 72, c = Math.cos(a), s = Math.sin(a), r = 1 / superellipseRadius(c, s, p);
    hipRom.rz.push(round((hip.lo[kz] + hip.hi[kz]) / 2 + r * c * (hip.hi[kz] - hip.lo[kz]) / 2, 2)); hipRom.rx.push(round((hip.lo[kx] + hip.hi[kx]) / 2 + r * s * (hip.hi[kx] - hip.lo[kx]) / 2, 2)); }
  // muscle mass sits in the segment holding the midpoint of the muscle's path (standing)
  const pose0 = body.fk(body.zeroPose()), muscleBySeg = new Array(body.segments.length).fill(0);
  ms.list.forEach((mu) => { const w = ms.worldPoints(pose0, mu), lens = w.slice(1).map((pt, j) => norm(sub(pt, w[j]))), half = lens.reduce((s, v) => s + v, 0) / 2;
    let acc = 0, j = 0; while (j < lens.length - 1 && acc + lens[j] < half) acc += lens[j++];
    const seg = (acc + lens[j] - half) > lens[j] / 2 ? mu.pts[j].seg : mu.pts[j + 1].seg; muscleBySeg[seg] += mu.mass; });
  const toBone = ([seg, local]) => { const r = body.toBoneFrame(seg, local); return [r.bone, roundArr(r.point, 4)]; };
  return {
    name: `${key}${Math.round(m)}_3d`, label, root: body.root, mass: round(m, 2), biped: true, dof_names: body.dofs.map((d) => d.name),
    bones: body.bones.map((b) => ({ name: b.name, length: round(b.length, 4), radius: round(b.radius, 4), side: legCode(b.name) })),
    muscles: ms.list.map((mu) => ({ name: mu.name, group: mu.group, path: mu.path.map(toBone), F0: round(mu.F0, 1), lopt: round(mu.lopt, 4), lts: round(mu.lts, 4),
      strain: 0.04, penn: round(mu.pen / DEG, 1), mass: round(mu.mass, 4), pcsa: round(mu.pcsa, 6), ft: mu.ft })),
    contacts: spec.contacts.map((c) => { const r = body.toBoneFrame(c.seg, c.point); return { name: c.name, bone: r.bone, point: roundArr(r.point, 4), radius: round(c.radius, 4) }; }),
    joints, hip_rom: hipRom, muscle_mass: round(ms.list.reduce((s, mu) => s + mu.mass, 0), 2),
    ntheta: gaitParamCount, ntheta_label: 'stride parameters searched', nq: body.nq, nm: ms.list.length,
    segments: body.segments.map((s) => ({ name: body.bones[body.primaryBone[s.index]].name, mass: round(s.mass, 3), muscle: round(Math.min(muscleBySeg[s.index], s.mass), 3) })),
    eye: (() => { const r = body.toBoneFrame(spec.head, spec.eye); return [r.bone, roundArr(r.point, 4)]; })(),
    legs: ['LH', 'RH'], leg_station: { LH: 0, RH: 0 }, limb_rank: { LF: 0, LH: 1 }, limb_names: { fore: 'arm', hind: 'leg' },
    rib_half_width: round(spec.ribHalfWidth, 4), rib_depth: round(spec.ribDepth, 4), foot_label: 'foot',
    head_circle: { center: roundArr(body.toBoneFrame(spec.head, spec.skull.center).point, 4), radius: round(spec.skull.radius, 4) },
    height: round(spec.height, 3),
    // skin and fat drawn around the skeleton: capsules [bone, from, to, radius] in bone frames (a ball when from = to)
    outline: spec.outline.map(([seg, a, b, r]) => { const A = body.toBoneFrame(seg, a), B = body.toBoneFrame(seg, b); return [A.bone, roundArr(A.point, 4), roundArr(B.point, 4), round(r, 4)]; }),
  };
}

// r: evaluate(..., { full: true }) at export resolution
export function exportSolution(body, ms, r, { key, evals, alternatives = [] }) {
  const { gait, kin, so, frameIdx, id } = r, N = frameIdx.length, m = body.mass, T = gait.T;
  const spec = body.spec, legs = ['LH', 'RH'];
  const poses = frameIdx.map((k) => body.boneRows(kin.poses[k]).map((row) => roundArr(row, 4)));
  const q = body.dofs.map((d, i) => frameIdx.map((k) => round(gait.q[k][i], 5)));
  // ground forces per contact point (heel, ball), in body weights: each foot's force split by where its COP sits
  const grf = [0, 1, 2].map(() => spec.contacts.map(() => new Array(N).fill(0)));
  const stance = { LH: new Array(N).fill(0), RH: new Array(N).fill(0) };
  frameIdx.forEach((k, n) => { const cs = gait.contacts[k].filter(Boolean);
    cs.forEach((c, j) => { const st = gait.footPoses[k][c.foot === 'L' ? 0 : 1], cop = id[k].cops[j];
      const rho = Math.min(1, Math.max(0, (cop[0] - st.H[0]) / Math.max(1e-6, st.B[0] - st.H[0])));
      spec.contacts.forEach((ct, ci) => { if (ct.foot !== c.foot) return; const w = ct.where === 'heel' ? 1 - rho : rho; for (let d = 0; d < 3; d++) grf[d][ci][n] = round(w * c.force[d] / (m * G), 4); });
      stance[`${c.foot}H`][n] = 1; }); });
  const inStance = gait.contacts.map((cs) => cs.filter(Boolean).length), M = inStance.length;
  // head and eye
  const headSeg = body.segIndex[spec.head], thorax = body.segIndex[spec.thorax], spineBone = body.bones[body.primaryBone[thorax]];
  const headOmega = kin.omega.map((w) => norm(w[headSeg]) / DEG);
  const eye = kin.poses.map((pose) => body.pointWorld(pose, headSeg, spec.eye));
  const eyeAcc = [0, 1, 2].map((d) => periodicDerivative(periodicDerivative(Float64Array.from(eye, (e, k) => e[d] - (d === 0 ? gait.S * k / M : 0)), kin.h), kin.h));
  const eyeAccMag = eye.map((_, k) => Math.hypot(eyeAcc[0][k], eyeAcc[1][k], eyeAcc[2][k]) / G);
  const headPitch = kin.poses.map((pose) => { const R = pose.R[headSeg]; return Math.atan2(R[3], R[0]) / DEG; }), headRoll = kin.poses.map((pose) => { const R = pose.R[headSeg]; return Math.atan2(R[7], R[8]) / DEG; });
  const rmsOf = (a) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length), mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  // bone clearance over the stride
  let clearance = { mm: Infinity, pair: '' };
  const pairs = clearancePairs(body), ends = (pose, b) => { const bone = body.bones[b]; return [body.pointWorld(pose, bone.seg, bone.from), add(body.pointWorld(pose, bone.seg, bone.from), matVec(pose.R[bone.seg], matVec(bone.C, [bone.length, 0, 0])))]; };
  for (const k of frameIdx) for (const [a, b] of pairs) { const [a0, a1] = ends(kin.poses[k], a), [b0, b1] = ends(kin.poses[k], b), d = segmentDistance(a0, a1, b0, b1) - body.bones[a].radius - body.bones[b].radius;
    if (d * 1000 < clearance.mm) clearance = { mm: d * 1000, pair: `${body.bones[a].name}–${body.bones[b].name}` }; }
  const range = (arr) => Math.max(...arr) - Math.min(...arr);
  const pelvisRoll = gait.q.map((qq) => qq[3] / DEG), pelvisYaw = gait.q.map((qq) => qq[4] / DEG);
  const beta = gait.params.duty, phaseR = gait.feet[1].phase;
  const summary = {
    model: key, speed: gait.speed, T, stride_frequency: 1 / T, stride_length: gait.S, froude: gait.speed ** 2 / (G * r.legLength), gait: GAIT_NAMES[gait.family],
    flight_fraction: inStance.filter((c) => c === 0).length / M, double_support_fraction: inStance.filter((c) => c === 2).length / M, duty_mean: round(beta, 3),
    metabolic_power: r.power, cot: r.cot, cot_muscle: r.cot, cot_with_basal: (r.power + BASAL_W_PER_KG * m) / (m * G * gait.speed), cot_J_per_kg_m: r.power / (m * gait.speed),
    power_by_group: Object.fromEntries(Object.entries(r.powerByGroup).map(([g, v]) => [g, round(v, 3)])),
    reserve_rms: r.reserveRms, reserve_rel: r.reserveRel, peak_grf_bw: r.peakGrf,
    root_residual: { force_bw_rms: r.residual.forceRmsBW, moment_nm_rms: r.residual.momentRmsNm, moment_rel_rms: r.residual.momentRmsRel },
    lateral_sway_m: range(gait.com.map((c) => c[2])), roll_range_deg: range(pelvisRoll), yaw_range_deg: range(pelvisYaw),
    head_omega_rms_deg_s: rmsOf(headOmega), eye_acc_rms_g: rmsOf(eyeAccMag), head_pitch_rms_deg: rmsOf(headPitch), head_roll_rms_deg: rmsOf(headRoll), head_pitch_mean_deg: mean(headPitch),
    bone_clearance_mm: round(clearance.mm, 1), bone_clearance_pair: clearance.pair,
    footfalls: { LH: { duty: round(beta, 2), touchdown: 0 }, RH: { duty: round(beta, 2), touchdown: phaseR } },
    status: 'Converged', converged: true, iterations: evals, source: 'sim/build-biped.mjs',
    method: 'searched stride + inverse dynamics + static optimization', gait_family: gait.family, gait_params: Object.fromEntries(PARAMS.map((k) => [k, gait.params[k]])),
    alternatives,
  };
  return { summary, poses, q, a: so.a.map((row) => roundArr(row, 4)), force: so.force.map((row) => roundArr(row, 2)), lt: so.lt.map((row) => roundArr(row, 5)), grf, stance,
    // back pitch: elevation of the thoracic spine (the thorax bone's long axis), as for the other bodies
    _derived: { thoraxPitchDeg: mean(kin.poses.map((pose) => Math.asin(matVec(pose.R[thorax], matVec(spineBone.C, [1, 0, 0]))[1]) / DEG)), eyeHeight: mean(eye.map((e) => e[1])) } };
}

// a side view of the body at one frame for the mode card: a skin-toned mannequin drawn from the model's
// outline, like the other cards' renders. Every humanoid card uses the same scale (refHeight fills the
// card's height), so the cards show how big the bodies are next to each other.
export function thumbnailSVG(model, poseRows, { refHeight = 0 } = {}) {
  const W = 600, Hh = 400, idx = Object.fromEntries(model.bones.map((b, i) => [b.name, i]));
  const at = (bone, p) => { const r = poseRows[idx[bone]]; return [r[9] + r[0] * p[0] + r[3] * p[1] + r[6] * p[2], r[10] + r[1] * p[0] + r[4] * p[1] + r[7] * p[2]]; };
  const caps = model.outline.map(([bone, a, b, r]) => ({ bone, a: at(bone, a), b: at(bone, b), r }));
  const x0 = Math.min(...caps.map((c) => Math.min(c.a[0], c.b[0]) - c.r)), x1 = Math.max(...caps.map((c) => Math.max(c.a[0], c.b[0]) + c.r)), y1 = Math.max(...caps.map((c) => Math.max(c.a[1], c.b[1]) + c.r));
  const sc = (Hh - 40) / Math.max(refHeight, y1, (x1 - x0) * Hh / W), ox = (W - (x1 - x0) * sc) / 2;
  const P = ([x, y]) => [(ox + (x - x0) * sc).toFixed(1), (Hh - 20 - y * sc).toFixed(1)];
  const line = (c, w, color) => { const [ax, ay] = P(c.a), [bx, by] = P(c.b); return `<line x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}" stroke="${color}" stroke-width="${w.toFixed(1)}" stroke-linecap="round"/>`; };
  // each group is drawn as one shape: every edge first, then every fill, so only its silhouette is outlined
  const group = (test, fill, edge) => { const g = caps.filter((c) => test(c.bone)); return g.map((c) => line(c, 2 * c.r * sc + 4, edge)).join('') + g.map((c) => line(c, 2 * c.r * sc, fill)).join(''); };
  const side = (bone) => (/^[LR][FH]_/.test(bone) ? bone[0] : '');
  // right side behind the body, left side in front
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${Hh}">${group((b) => side(b) === 'R', '#b98d69', '#8a6446')}${group((b) => !side(b), '#dcb28b', '#9c7250')}${group((b) => side(b) === 'L', '#dcb28b', '#9c7250')}</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

// note: what the body is, for the mode card; group: the row of mode cards it joins; lede, compareSub: page text
// (see build-biped.mjs); refHeight: thumbnail scale
export function exportPack(body, ms, r, { key = 'biped', label = 'Biped', group = 'humanoid', evals = 0, alternatives = [], note = '', lede = '', compareSub = '', refHeight = 0 } = {}) {
  const bounds = familyBounds(body, r.family), model = exportModel(body, ms, { key, label, gaitParamCount: PARAMS.filter((k) => bounds[k][1] > bounds[k][0]).length });
  const { _derived, ...solution } = exportSolution(body, ms, r, { key, evals, alternatives });
  const s = solution.summary, mass = body.mass.toFixed(1), height = body.spec.height.toFixed(2);
  const gaitName = s.gait.replace(/^./, (c) => c.toUpperCase());
  const others = alternatives.filter((a) => a.family !== r.family), pct = (a) => (a.cot >= s.cot ? `+${((a.cot / s.cot - 1) * 100).toFixed(0)}%` : `${((1 - a.cot / s.cot) * 100).toFixed(0)}% less`);
  // gaits with a flight phase are represented less faithfully (no angular-momentum conservation in the air), so say so
  const alt = others.length ? `the best ${others.map((a) => `${GAIT_NAMES[a.family].replace(/ \(pronk\)/, '')} found costs ${pct(a)}`).join(' and the best ')}${others.some((a) => a.residual_moment_nm > 2 * s.root_residual.moment_nm_rms) ? ', though this model is less faithful for gaits with a flight phase' : ''}` : '';
  const midStance = Math.round(r.gait.params.duty / 2 * r.frameIdx.length) % r.frameIdx.length;
  const mode = { label, group, sub: `${mass} kg · ${height} m · COT ${s.cot.toFixed(3)}`, thumb: thumbnailSVG(model, solution.poses[midStance], { refHeight }),
    note: `${mass} kg; ${note}. Simulated with a simpler pipeline than the other bodies (a searched stride, inverse dynamics and static optimization; see How it works). ${gaitName}${alt ? `; ${alt}` : ''}.` };
  const rom = (j) => { const row = solution.q[body.dofIndex[`${j}.rz`]].map((v) => v / DEG); return round(Math.max(...row) - Math.min(...row), 1); };
  const compare = { label, mass: round(body.mass, 1), height: round(body.spec.height, 2), speed: s.speed, legs: 2, cot: round(s.cot, 3), power: Math.round(s.metabolic_power), T: round(s.T, 3), stride: round(s.stride_length, 2), gait: s.gait,
    duty: `— / ${s.duty_mean.toFixed(2)}`, pitch: round(_derived.thoraxPitchDeg, 1), head_height: round(_derived.eyeHeight, 2), head_rot: round(s.head_omega_rms_deg_s, 1), clearance: s.bone_clearance_mm,
    rom: { shoulder: rom('LF_shoulder'), elbow: rom('LF_elbow'), carpus: rom('LF_wrist'), hip: rom('LH_hip'), knee: rom('LH_knee'), hock: rom('LH_ankle') } };
  return { key, model, solution, mode, compare, ...(lede ? { lede } : {}), ...(compareSub ? { compareSub } : {}) };
}
