// DOM panels: speed strip, picker, readout, footfall, cost chart, ROM usage,
// hip plot, activation heatmap, co-design / sensitivity / fit / joints /
// findings / muscle-mass / variant / 6-axis sections, and the mode switch.
// Imports state only; selection changes go through requestSelect(),
// which main.js wires to selectSolution.
import { DATA, solutions, modelFor, isSpecialSolution, theme, readCssVar, GAIT_FAMILIES, familyIndex, familyColor, titleCase, speeds, bestSolutionAtSpeed, legLabel, isRight, legCodeOf, activationColor, current, stridePhase, requestSelect, setCurrent } from './state.js';

// ---------- strip / select / readout
export function renderSpeedStrip() { const strip = document.getElementById('strip'); strip.innerHTML = '';
  speeds.forEach((v) => { const sol = bestSolutionAtSpeed[v]; const btn = document.createElement('button'); btn.setAttribute('aria-pressed', String(current.summary.speed === v));
    btn.innerHTML = `<span class="v">${v.toFixed(1)} m/s</span><span class="g"><span class="key" style="background:${familyColor(sol.fam)}"></span>${GAIT_FAMILIES[familyIndex[sol.fam]][1]}</span><span class="c">COT ${sol.summary.cot.toFixed(3)}</span>`;
    btn.title = titleCase(sol.summary.gait); btn.addEventListener('click', () => requestSelect(sol)); strip.appendChild(btn); }); }
export const solutionPicker = document.getElementById('sel');
export function renderSolutionPicker() { solutionPicker.innerHTML = ''; solutions.filter((sol) => sol.summary.speed === current.summary.speed).sort((a, b) => a.summary.cot - b.summary.cot).forEach((sol) => {
  const opt = document.createElement('option'); opt.value = sol.id; opt.textContent = `${titleCase(sol.summary.gait)} · COT ${sol.summary.cot.toFixed(3)}${sol.summary.codesign ? ' · co-designed body' : ''}${sol.summary.dof6 ? ' · joints free in 6 axes' : ''}${sol.summary.variant ? ' · ' + sol.summary.variant_label : ''}${sol === bestSolutionAtSpeed[sol.summary.speed] ? ' · best' : ''}`; if (sol === current) opt.selected = true; solutionPicker.appendChild(opt); }); }
solutionPicker.addEventListener('change', () => requestSelect(solutions[+solutionPicker.value]));
export function renderReadout() {
  const summary = current.summary; document.getElementById('r-gait').textContent = titleCase(summary.gait); document.getElementById('r-key').style.background = familyColor(current.fam);
  const best = bestSolutionAtSpeed[summary.speed];
  const sameGaitBest = solutions.filter((x) => !isSpecialSolution(x) && x.fam === current.fam && x.summary.speed === summary.speed).reduce((a, b) => (!a || b.summary.cot < a.summary.cot ? b : a), null);
  const mode = DATA.modes && DATA.modes.find((x) => solutions[x.sol] === current);
  document.getElementById('r-note').innerHTML = mode ? `<span class="pill ok">${mode.label}</span> ${mode.note || ''}` : summary.variant ? `<span class="pill ok">${summary.variant_label}</span>${sameGaitBest ? ` ${(summary.cot / sameGaitBest.summary.cot - 1) * 100 >= 0 ? '+' : ''}${((summary.cot / sameGaitBest.summary.cot - 1) * 100).toFixed(0)}% per kg vs the default body` : ''}` : summary.dof6 ? `<span class="pill ok">joints free in all 6 axes</span>${sameGaitBest ? ` ${((summary.cot / sameGaitBest.summary.cot - 1) * 100).toFixed(0) > 0 ? '+' : ''}${((summary.cot / sameGaitBest.summary.cot - 1) * 100).toFixed(0)}% vs the same gait with hinge and ball joints` : ''}` : summary.codesign ? `<span class="pill ok">co-designed joints</span> same speed, optimized body` : (current === best ? `<span class="pill ok">lowest cost at ${summary.speed.toFixed(1)} m/s</span> default body` : `<span class="pill">${((summary.cot / best.summary.cot - 1) * 100).toFixed(0)}% above best</span> default body`);
  const dutyOf = (leg) => summary.footfalls[leg] ? summary.footfalls[leg].duty : 0, model = modelFor(current), biped = !!model.biped;
  const facts = [['Speed', `${summary.speed.toFixed(2)} <small>m/s</small>`], ['Froude number', summary.froude.toFixed(2)], ['Cost of transport', summary.cot.toFixed(3)], ['Metabolic energy', `${summary.cot_J_per_kg_m.toFixed(2)} <small>J/kg/m</small>`],
    ['Stride frequency', `${summary.stride_frequency.toFixed(2)} <small>Hz</small>`], ['Stride length', `${summary.stride_length.toFixed(2)} <small>m</small>`], biped ? ['Duty factor', `${summary.duty_mean.toFixed(2)} <small>each foot</small>`] : ['Duty fore / hind', (() => { const station = model.leg_station || { LF: 0, RF: 0, LH: 1, RH: 1 }, lastStation = Math.max(...Object.values(station)), mean = (legs) => legs.reduce((sum, leg) => sum + dutyOf(leg), 0) / legs.length;
      return `${mean(Object.keys(station).filter((leg) => station[leg] === 0)).toFixed(2)} / ${mean(Object.keys(station).filter((leg) => station[leg] === lastStation)).toFixed(2)}`; })()], ['Aerial phase', `${(summary.flight_fraction * 100).toFixed(0)}<small>%</small>`],
    [biped ? 'Pelvis roll · yaw' : 'Roll · yaw range', `${summary.roll_range_deg.toFixed(1)}° · ${summary.yaw_range_deg.toFixed(1)}°`], ['Lateral sway', `${(summary.lateral_sway_m * 100).toFixed(1)} <small>cm</small>`], [`Peak ${model.foot_label || 'paw'} force`, `${summary.peak_grf_bw.toFixed(2)} <small>BW</small>`], ['Reserve torque', `${(summary.reserve_rel * 100).toFixed(2)}<small>% of muscle</small>`]];
  if (summary.double_support_fraction != null) facts.splice(8, 0, ['Double support', `${(summary.double_support_fraction * 100).toFixed(0)}<small>% of the stride</small>`]);
  if (summary.root_residual) facts.push(['Unexplained pelvis moment', `${summary.root_residual.moment_nm_rms.toFixed(1)} Nm <small>RMS, ${(summary.root_residual.moment_rel_rms * 100).toFixed(1)}% of weight × leg</small>`]);
  if (summary.head_omega_rms_deg_s != null) facts.push(['Head steadiness', `${summary.head_omega_rms_deg_s.toFixed(0)}°/s · ${summary.eye_acc_rms_g.toFixed(2)} g <small>RMS rotation · eye accel.</small>`]);
  if (summary.head_pitch_rms_deg != null) facts.push(['Head level', `${summary.head_pitch_rms_deg.toFixed(1)}° · ${summary.head_roll_rms_deg.toFixed(1)}° <small>RMS pitch · roll off level</small>`]);
  if (summary.bone_clearance_mm != null) facts.push(['Closest bones', `${summary.bone_clearance_mm >= 0 ? '' : '<span style="color:var(--up)">'}${summary.bone_clearance_mm.toFixed(0)} mm${summary.bone_clearance_mm >= 0 ? '' : '</span>'} <small>${summary.bone_clearance_pair.replace(/_/g, ' ')}</small>`]);
  if (summary.verify) facts.push(['Re-simulation error', `${summary.verify.interval_q_err_deg.toFixed(2)}° <small>max per step</small>`]);
  if (summary.verify && summary.verify.quasi_static_offset_mm != null) facts.push(['Joint play between nodes', `${summary.verify.quasi_static_offset_mm_median.toFixed(1)} mm · ${summary.verify.quasi_static_offset_deg_median.toFixed(1)}° <small>median off equilibrium</small>`]);
  document.getElementById('facts').innerHTML = facts.map(([key, val]) => `<div><dt>${key}</dt><dd>${val}</dd></div>`).join('');
}
// rows: left side hind to fore, then right side fore to hind (LH LF RF RH for four legs)
export const footfallLegOrder = (model) => { const station = model.leg_station; if (!station) return ['LH', 'LF', 'RF', 'RH'];
  const left = Object.keys(station).filter((leg) => leg[0] === 'L').sort((a, b) => station[b] - station[a]), right = Object.keys(station).filter((leg) => leg[0] === 'R').sort((a, b) => station[a] - station[b]);
  return [...left, ...Object.keys(station).filter((leg) => leg[0] === 'C'), ...right]; };
export const footfallLegName = (leg, model) => (model && model.biped ? leg[0] : leg.replace(/^([LR])([1-9])$/, '$1M$2'));
export function renderFootfall() { const svg = document.getElementById('footfall'), model = modelFor(current); const order = footfallLegOrder(model), rowCount = order.length; const width = 320, x0 = 34, w = width - x0 - 4, rowH = rowCount > 4 ? 16 : 22, barH = rowCount > 4 ? 11 : 14, y0 = 6; let html = '';
  for (let grid = 0; grid <= 2; grid++) { const x = x0 + (w * grid) / 2; html += `<line x1="${x}" x2="${x}" y1="${y0}" y2="${y0 + rowH * rowCount}" stroke="${theme.rule}"/><text x="${x}" y="${y0 + rowH * rowCount + 14}" text-anchor="middle">${grid}</text>`; }
  order.forEach((leg, row) => { const stance = current.stance[leg]; const frames = stance.length; const y = y0 + row * rowH + 4; html += `<text x="0" y="${y + barH - 3}">${footfallLegName(leg, model)}</text>`;
    for (let rep = 0; rep < 2; rep++) { let k = 0; while (k < frames) { if (stance[k]) { let j = k; while (j < frames && stance[j]) j++; const xa = x0 + (w / 2) * (rep + k / frames), xb = x0 + (w / 2) * (rep + j / frames); html += `<rect x="${xa.toFixed(1)}" y="${y}" width="${Math.max(1, xb - xa - 1).toFixed(1)}" height="${barH}" rx="3" fill="${familyColor(current.fam)}"/>`; k = j; } else k++; } } });
  html += `<line id="ff-cursor" x1="0" x2="0" y1="${y0 - 2}" y2="${y0 + rowH * rowCount + 2}" stroke="${theme.ink}" stroke-width="1.5"/><text x="${x0 + w / 2}" y="${y0 + rowH * rowCount + 26}" text-anchor="middle" class="axis-label" style="font-size:10px">stride</text>`;
  svg.setAttribute('viewBox', `0 0 ${width} ${y0 + rowH * rowCount + 30}`); svg.innerHTML = html; }

// ---------- cost chart
export const tooltip = document.getElementById('tip');
export function showTooltip(e, html) { tooltip.innerHTML = html; tooltip.hidden = false; tooltip.style.left = Math.min(window.innerWidth - 310, e.clientX + 14) + 'px'; tooltip.style.top = (e.clientY + 14) + 'px'; }
export const hideTooltip = () => { tooltip.hidden = true; };
export function markerShape(kind, x, y, radius, fillColor) { const fill = `fill="${fillColor}" stroke="${theme.surface}" stroke-width="2"`;
  switch (kind) { case 'square': return `<rect x="${x - radius}" y="${y - radius}" width="${2 * radius}" height="${2 * radius}" rx="1.5" ${fill}/>`; case 'diamond': return `<path d="M${x} ${y - radius * 1.3}L${x + radius * 1.3} ${y}L${x} ${y + radius * 1.3}L${x - radius * 1.3} ${y}Z" ${fill}/>`;
    case 'triangle': return `<path d="M${x} ${y - radius * 1.3}L${x + radius * 1.2} ${y + radius}L${x - radius * 1.2} ${y + radius}Z" ${fill}/>`; case 'tri-down': return `<path d="M${x} ${y + radius * 1.3}L${x + radius * 1.2} ${y - radius}L${x - radius * 1.2} ${y - radius}Z" ${fill}/>`;
    case 'cross': return `<path d="M${x - radius} ${y - radius}L${x + radius} ${y + radius}M${x + radius} ${y - radius}L${x - radius} ${y + radius}" stroke="${fillColor}" stroke-width="3" stroke-linecap="round"/>`; case 'star': return `<path d="M${x} ${y - radius * 1.4}L${x + radius * .4} ${y - radius * .4}L${x + radius * 1.4} ${y}L${x + radius * .4} ${y + radius * .4}L${x} ${y + radius * 1.4}L${x - radius * .4} ${y + radius * .4}L${x - radius * 1.4} ${y}L${x - radius * .4} ${y - radius * .4}Z" ${fill}/>`;
    case 'circle-open': return `<circle cx="${x}" cy="${y}" r="${radius}" fill="${theme.surface}" stroke="${fillColor}" stroke-width="2"/>`; default: return `<circle cx="${x}" cy="${y}" r="${radius}" ${fill}/>`; } }
export function renderCostChart() {
  const svg = document.getElementById('cot'); const width = Math.max(560, Math.round(svg.parentElement.clientWidth || 1100)), height = 360, marginL = 64, marginR = 110, marginT = 16, marginB = 48; svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  const main = solutions.filter((sol) => !isSpecialSolution(sol));
  const allCot = main.map((sol) => sol.summary.cot).concat((DATA.explored || []).map((e) => e.cot)).concat((DATA.planar || []).map((p) => p.cot));
  const allSpeeds = main.map((sol) => sol.summary.speed);
  const xMin = 0.4, xMax = Math.ceil(Math.max(...allSpeeds) + 0.4), yMax = Math.min(1.2, Math.ceil(Math.max(...allCot) * 10) / 10 + 0.05);
  const scaleX = (v) => marginL + (v - xMin) / (xMax - xMin) * (width - marginL - marginR), scaleY = (v) => height - marginB - Math.min(v, yMax) / yMax * (height - marginT - marginB);
  let html = ''; for (let v = 0; v <= yMax + 1e-9; v += 0.1) html += `<line x1="${marginL}" x2="${width - marginR}" y1="${scaleY(v)}" y2="${scaleY(v)}" stroke="${theme.rule}"/><text x="${marginL - 8}" y="${scaleY(v) + 4}" text-anchor="end">${v.toFixed(1)}</text>`;
  for (let v = 1; v <= xMax; v++) html += `<text x="${scaleX(v)}" y="${height - marginB + 18}" text-anchor="middle">${v}</text>`;
  html += `<text class="axis-label" x="${(marginL + width - marginR) / 2}" y="${height - 8}" text-anchor="middle">speed (m/s)</text><text class="axis-label" transform="translate(16 ${(marginT + height - marginB) / 2}) rotate(-90)" text-anchor="middle">metabolic cost of transport</text>`;
  (DATA.explored || []).forEach((pt) => { html += `<circle cx="${scaleX(pt.speed).toFixed(1)}" cy="${scaleY(pt.cot).toFixed(1)}" r="2.6" fill="${theme.muted}" opacity=".3"/>`; });
  if ((DATA.planar || []).length) html += `<polyline fill="none" stroke="${theme.muted}" stroke-width="1.5" stroke-dasharray="5 4" points="${DATA.planar.map((p) => `${scaleX(p.speed)},${scaleY(p.cot)}`).join(' ')}"/>`;
  const presentFams = [...new Set(main.map((sol) => sol.fam))].sort((a, b) => familyIndex[a] - familyIndex[b]); const lineEnds = [];
  presentFams.forEach((fam) => { const gaitBest = speeds.map((v) => { const atSpeed = main.filter((sol) => sol.fam === fam && sol.summary.speed === v); return atSpeed.length ? atSpeed.reduce((a, b) => (b.summary.cot < a.summary.cot ? b : a)) : null; }).filter(Boolean);
    if (gaitBest.length > 1) html += `<polyline fill="none" stroke="${familyColor(fam)}" stroke-width="2" stroke-linejoin="round" points="${gaitBest.map((sol) => `${scaleX(sol.summary.speed)},${scaleY(sol.summary.cot)}`).join(' ')}"/>`;
    if (gaitBest.length) { const end = gaitBest[gaitBest.length - 1]; lineEnds.push({ fam, x: scaleX(end.summary.speed), y: scaleY(end.summary.cot) }); } });
  lineEnds.sort((a, b) => a.y - b.y); lineEnds.forEach((end, i) => { end.ly = end.y; if (i && end.ly - lineEnds[i - 1].ly < 14 && Math.abs(end.x - lineEnds[i - 1].x) < 60) end.ly = lineEnds[i - 1].ly + 14; });
  lineEnds.forEach((end) => { if (Math.abs(end.ly - end.y) > 1) html += `<line x1="${end.x + 5}" y1="${end.y}" x2="${end.x + 16}" y2="${end.ly}" stroke="${theme.muted}"/>`; html += `<text x="${end.x + 19}" y="${end.ly + 4}">${GAIT_FAMILIES[familyIndex[end.fam]][1]}</text>`; });
  main.forEach((sol) => { const fam = GAIT_FAMILIES[familyIndex[sol.fam]]; html += `<g class="pt" data-id="${sol.id}" style="cursor:pointer">${markerShape(fam[3], scaleX(sol.summary.speed), scaleY(sol.summary.cot), sol === bestSolutionAtSpeed[sol.summary.speed] ? 6 : 4.5, familyColor(sol.fam))}<circle cx="${scaleX(sol.summary.speed)}" cy="${scaleY(sol.summary.cot)}" r="11" fill="transparent"/></g>`; });
  solutions.filter((sol) => sol.summary.codesign).forEach((sol) => { html += `<g class="pt" data-id="${sol.id}" style="cursor:pointer"><circle cx="${scaleX(sol.summary.speed)}" cy="${scaleY(sol.summary.cot)}" r="6" fill="none" stroke="${theme.accent}" stroke-width="2.5"/><circle cx="${scaleX(sol.summary.speed)}" cy="${scaleY(sol.summary.cot)}" r="11" fill="transparent"/></g>`; });
  solutions.filter((sol) => sol.summary.variant).forEach((sol) => { const x = scaleX(sol.summary.speed), y = scaleY(sol.summary.cot); html += `<g class="pt" data-id="${sol.id}" style="cursor:pointer"><path d="M${x} ${y - 8}L${x + 8} ${y + 6}L${x - 8} ${y + 6}Z" fill="${theme.surface}" stroke="${theme.accent}" stroke-width="2"/><circle cx="${x}" cy="${y}" r="11" fill="transparent"/></g>`; });
  solutions.filter((sol) => sol.summary.dof6).forEach((sol) => { const x = scaleX(sol.summary.speed), y = scaleY(sol.summary.cot); html += `<g class="pt" data-id="${sol.id}" style="cursor:pointer"><path d="M${x} ${y - 8}L${x + 8} ${y}L${x} ${y + 8}L${x - 8} ${y}Z" fill="${theme.surface}" stroke="${theme.ink}" stroke-width="2"/><circle cx="${x}" cy="${y}" r="11" fill="transparent"/></g>`; });
  html += `<circle r="10" fill="none" stroke="${theme.ink}" stroke-width="1.5" cx="${scaleX(current.summary.speed)}" cy="${scaleY(current.summary.cot)}"/>`;
  svg.innerHTML = html;
  svg.querySelectorAll('.pt').forEach((group) => { const sol = solutions[+group.dataset.id]; group.addEventListener('mousemove', (e) => showTooltip(e, `<b>${titleCase(sol.summary.gait)}</b>${sol.summary.codesign ? ' (co-designed)' : ''}${sol.summary.dof6 ? ' (joints free in 6 axes)' : ''}${sol.summary.variant ? ' (' + sol.summary.variant_label + ')' : ''}<br>${sol.summary.speed.toFixed(1)} m/s · COT ${sol.summary.cot.toFixed(3)}<br>${sol.summary.stride_frequency.toFixed(2)} Hz · roll ${sol.summary.roll_range_deg.toFixed(1)}°`)); group.addEventListener('mouseleave', hideTooltip); group.addEventListener('click', () => requestSelect(sol)); });
  document.getElementById('legend').innerHTML = `<span><svg width="10" height="10" aria-hidden="true"><circle cx="5" cy="5" r="3" fill="${theme.muted}" opacity=".4"/></svg>explored optimum</span>` + presentFams.map((fam) => `<span><svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">${markerShape(GAIT_FAMILIES[familyIndex[fam]][3], 7, 7, 4.5, familyColor(fam))}</svg>${GAIT_FAMILIES[familyIndex[fam]][1]}</span>`).join('') + ((DATA.planar || []).length ? `<span><svg width="20" height="10" aria-hidden="true"><line x1="0" x2="20" y1="5" y2="5" stroke="${theme.muted}" stroke-width="1.5" stroke-dasharray="5 4"/></svg>planar model, best</span>` : '') + (solutions.some((sol) => sol.summary.codesign) ? `<span><svg width="14" height="14" aria-hidden="true"><circle cx="7" cy="7" r="5" fill="none" stroke="${theme.accent}" stroke-width="2.5"/></svg>co-designed body</span>` : '') + (solutions.some((sol) => sol.summary.variant) ? `<span><svg width="16" height="16" aria-hidden="true"><path d="M8 2L14 13L2 13Z" fill="${theme.surface}" stroke="${theme.accent}" stroke-width="2"/></svg>other body</span>` : '') + (solutions.some((sol) => sol.summary.dof6) ? `<span><svg width="16" height="16" aria-hidden="true"><path d="M8 2L14 8L8 14L2 8Z" fill="${theme.surface}" stroke="${theme.ink}" stroke-width="2"/></svg>joints free in 6 axes</span>` : '');
}

// ---------- range-of-motion usage
export const formatAxisValue = (v, axis) => v.toFixed(axis.unit === 'mm' && Math.abs(axis.hi - axis.lo) < 12 ? 1 : 0);
export function renderRomUsage() {
  const grid = document.getElementById('romgrid'), model = modelFor(current); let html = '';
  model.joints.filter((joint) => !isRight(joint.name)).forEach((joint) => joint.axes.forEach((axis) => {
    const scale = axis.unit === 'deg' ? 180 / Math.PI : 1000; const used = current.q[axis.q].map((v) => v * scale);
    const lo = Math.min(axis.lo, ...used), hi = Math.max(axis.hi, ...used), pad = 0.05 * (hi - lo), spanLo = lo - pad, spanHi = hi + pad;
    const pct = (v) => ((v - spanLo) / (spanHi - spanLo) * 100).toFixed(2);
    const usedMin = Math.min(...used), usedMax = Math.max(...used);
    const axisNames = { rx: 'roll/abd', ry: 'yaw/axial', rz: 'flex/ext', ty: 'vertical', tx: 'fore-aft', tz: 'lateral' };
    html += `<div class="rom-row"><div class="lab" title="${joint.name}.${axis.axis}">${legLabel(joint.name, model)} ${axisNames[axis.axis] || axis.axis}</div>
      <svg viewBox="0 0 100 12" preserveAspectRatio="none" width="100%" height="12"><rect x="${pct(axis.lo)}" y="3" width="${(pct(axis.hi) - pct(axis.lo)).toFixed(2)}" height="6" rx="3" fill="${theme.surface2}" stroke="${theme.rule}" stroke-width=".4" vector-effect="non-scaling-stroke"/><rect x="${pct(usedMin)}" y="3" width="${Math.max(0.6, pct(usedMax) - pct(usedMin)).toFixed(2)}" height="6" rx="3" fill="${familyColor(current.fam)}"/><line x1="${pct(0)}" x2="${pct(0)}" y1="0" y2="12" stroke="${theme.ink}" stroke-width="1" vector-effect="non-scaling-stroke"/></svg>
      <div class="val">${formatAxisValue(usedMin, axis)}…${formatAxisValue(usedMax, axis)} / ${formatAxisValue(axis.lo, axis)}…${formatAxisValue(axis.hi, axis)}${axis.unit === 'deg' ? '°' : ' mm'}</div></div>`; }));
  grid.innerHTML = html;
}
export function renderHipPlot() {
  const range = modelFor(current).hip_rom; const svg = document.getElementById('hipsvg'); if (!range) return;
  const strideFlex = current.q[range.q_rz].map((v) => v * 180 / Math.PI), strideAbd = current.q[range.q_rx].map((v) => v * 180 / Math.PI);
  const allFlex = range.rz.concat(strideFlex), allAbd = range.rx.concat(strideAbd);
  const x0 = Math.floor(Math.min(...allFlex) / 10) * 10 - 10, x1 = Math.ceil(Math.max(...allFlex) / 10) * 10 + 10, y0 = Math.floor(Math.min(...allAbd) / 10) * 10 - 5, y1 = Math.ceil(Math.max(...allAbd) / 10) * 10 + 5;
  const width = 420, height = 330, marginL = 44, marginB = 36, marginT = 10, marginR = 10; const scaleX = (v) => marginL + (v - x0) / (x1 - x0) * (width - marginL - marginR), scaleY = (v) => height - marginB - (v - y0) / (y1 - y0) * (height - marginT - marginB);
  let html = '';
  for (let v = Math.ceil(x0 / 20) * 20; v <= x1; v += 20) html += `<line x1="${scaleX(v)}" x2="${scaleX(v)}" y1="${marginT}" y2="${height - marginB}" stroke="${theme.rule}"/><text x="${scaleX(v)}" y="${height - marginB + 14}" text-anchor="middle">${v}</text>`;
  for (let v = Math.ceil(y0 / 10) * 10; v <= y1; v += 10) html += `<line x1="${marginL}" x2="${width - marginR}" y1="${scaleY(v)}" y2="${scaleY(v)}" stroke="${theme.rule}"/><text x="${marginL - 6}" y="${scaleY(v) + 4}" text-anchor="end">${v}</text>`;
  html += `<polygon points="${range.rz.map((v, i) => `${scaleX(v)},${scaleY(range.rx[i])}`).join(' ')}" fill="${theme.accent}" fill-opacity=".10" stroke="${theme.accent}" stroke-width="2"/>`;
  html += `<polyline points="${strideFlex.concat(strideFlex[0]).map((v, i) => `${scaleX(v)},${scaleY(strideAbd.concat(strideAbd[0])[i])}`).join(' ')}" fill="none" stroke="${familyColor(current.fam)}" stroke-width="2.5"/>`;
  html += `<circle cx="${scaleX(0)}" cy="${scaleY(0)}" r="3.5" fill="${theme.ink}"/><text x="${scaleX(0) + 6}" y="${scaleY(0) - 6}">stand</text>`;
  html += `<text class="axis-label" x="${(marginL + width - marginR) / 2}" y="${height - 4}" text-anchor="middle">flexion (+) / extension (−), deg from standing</text><text class="axis-label" transform="translate(12 ${(marginT + height - marginB) / 2}) rotate(-90)" text-anchor="middle">adduction (+) / abduction (−)</text>`;
  svg.innerHTML = html;
}

// ---------- muscle-activation heatmap
export const heatmapCanvas = document.getElementById('heat'), heatmapCtx = heatmapCanvas.getContext('2d', { willReadFrequently: true });   // read back every frame to draw the cursor
export let shownMuscles = [];
// left side, grouped leg by leg from fore to hind (trunk muscles first, neck and tail last)
export const muscleSortRank = (model, muscle) => { const leg = legCodeOf(muscle.path[muscle.path.length - 1][0]) || legCodeOf(muscle.path[0][0]); return leg ? ((model.limb_rank || model.leg_station || { LF: 0, LH: 1 })[leg] ?? 0) : /neck|tail/.test(muscle.group) ? 99 : -1; };
export const leftSideMuscles = (model) => model.muscles.map((muscle, i) => [muscle, i]).filter(([muscle]) => !isRight(muscle.name) && !/_R$/.test(muscle.name))
  .sort((a, b) => muscleSortRank(model, a[0]) - muscleSortRank(model, b[0]) || a[1] - b[1]);
export const muscleShortLabel = (model, name) => (model.legs && model.legs.length > 4) ? legLabel(name).replace(/_L$/, '') : name.replace(/^[LC][FH]_/, '').replace(/_L$/, '');
export let heatmapGeom = null, heatmapBaseImage = null;
export function renderHeatmap() { shownMuscles = leftSideMuscles(modelFor(current)); const px = window.devicePixelRatio || 1, rowH = 11, labelW = 180, top = 4, bottom = 24; const cssW = heatmapCanvas.getBoundingClientRect().width || 900, cssH = top + bottom + rowH * shownMuscles.length;
  heatmapCanvas.style.height = cssH + 'px'; heatmapCanvas.width = Math.round(cssW * px); heatmapCanvas.height = Math.round(cssH * px); heatmapCtx.setTransform(px, 0, 0, px, 0, 0); heatmapCtx.fillStyle = theme.surface; heatmapCtx.fillRect(0, 0, cssW, cssH);
  const frames = current.a[0].length, cellW = (cssW - labelW - 8) / frames; heatmapCtx.font = `10px ${readCssVar('--font-mono')}`; heatmapCtx.textBaseline = 'middle'; let lastGroup = null;
  shownMuscles.forEach(([muscle, i], row) => { const y = top + row * rowH; if (muscle.group !== lastGroup && row) { heatmapCtx.fillStyle = theme.rule; heatmapCtx.fillRect(0, y - 0.5, cssW, 1); } lastGroup = muscle.group; heatmapCtx.fillStyle = theme.ink2; heatmapCtx.fillText(muscleShortLabel(modelFor(current), muscle.name), 4, y + rowH / 2);
    for (let k = 0; k < frames; k++) { heatmapCtx.fillStyle = activationColor(current.a[i][k]); heatmapCtx.fillRect(labelW + k * cellW, y + 1, Math.ceil(cellW), rowH - 2); } });
  heatmapCtx.fillStyle = theme.muted; [0, 0.5, 1].forEach((f) => { heatmapCtx.textAlign = f === 0 ? 'left' : f === 1 ? 'right' : 'center'; heatmapCtx.fillText(`${f}`, labelW + f * frames * cellW, cssH - 9); }); heatmapCtx.textAlign = 'left';
  heatmapGeom = { labelW, top, rowH, cw: cellW, N: frames }; heatmapBaseImage = heatmapCtx.getImageData(0, 0, heatmapCanvas.width, heatmapCanvas.height); }
export function drawHeatCursor() { if (!heatmapGeom || !heatmapBaseImage) return; heatmapCtx.putImageData(heatmapBaseImage, 0, 0); heatmapCtx.fillStyle = theme.ink; heatmapCtx.fillRect(heatmapGeom.labelW + stridePhase * heatmapGeom.N * heatmapGeom.cw - 0.75, heatmapGeom.top, 1.5, heatmapGeom.rowH * shownMuscles.length); }
heatmapCanvas.addEventListener('mousemove', (e) => { if (!heatmapGeom) return; const rect = heatmapCanvas.getBoundingClientRect(); const row = Math.floor((e.clientY - rect.top - heatmapGeom.top) / heatmapGeom.rowH), frame = Math.floor((e.clientX - rect.left - heatmapGeom.labelW) / heatmapGeom.cw); if (row < 0 || row >= shownMuscles.length || frame < 0 || frame >= heatmapGeom.N) { hideTooltip(); return; } const [muscle, i] = shownMuscles[row]; showTooltip(e, `<b>${muscle.name}</b><br>stride ${(frame / heatmapGeom.N).toFixed(2)} · activation ${current.a[i][frame].toFixed(2)}<br>tendon force ${current.force[i][frame].toFixed(0)} N of ${muscle.F0} N${muscle.mass ? `<br>mass ${(muscle.mass * 1000).toFixed(0)} g · fibres ${(muscle.lopt * 100).toFixed(1)} cm` : ''}`); });
heatmapCanvas.addEventListener('mouseleave', hideTooltip);
export function renderRampLegend() { const canvas = document.getElementById('ramp'), gfx = canvas.getContext('2d'); for (let x = 0; x < canvas.width; x++) { gfx.fillStyle = activationColor(x / (canvas.width - 1)); gfx.fillRect(x, 0, 1, canvas.height); } }

// ---------- co-design, sensitivities, fit, joints
export function renderCodesign() {
  const design = DATA.codesign; const section = document.getElementById('cd-section'); if (!design) { section.hidden = true; return; }
  if (design.design && design.design.length && design.design[0].before !== undefined) { renderCodesign6(design); return; }
  document.getElementById('cd-sub').textContent = `Computed before the stride-period gradient fix and not yet re-run, so treat these numbers as provisional. ${design.design.length} joint parameters (spine springs, carpus and hock springs and ranges, the scapular sling), shared by left and right limbs, optimized for one body at ${design.speeds.map((v) => v.toFixed(1)).join(' and ')} m/s. Outer loop: bounded L-BFGS over the design, using the gait optimizer's exact sensitivities as the gradient; ${design.evaluations} evaluations, each re-solving both gaits, until the design stopped improving. Baseline: the default body re-solved with the same settings.`;
  let html = '<tr><th>Speed</th><th>Default body</th><th class="n">COT</th><th>Co-designed body</th><th class="n">COT</th><th class="n">Change</th></tr>';
  design.speeds.forEach((v) => { const before = design.before[v] || design.before[v.toFixed(1)] || design.before[String(v)], after = design.after[v] || design.after[v.toFixed(1)] || design.after[String(v)]; const change = (after.cot / before.cot - 1) * 100;
    html += `<tr><td class="n" style="text-align:left">${v.toFixed(1)} m/s</td><td>${before.gait}</td><td class="n">${before.cot.toFixed(3)}</td><td>${after.gait}</td><td class="n">${after.cot.toFixed(3)}</td><td class="n ${change < 0 ? 'delta-down' : 'delta-up'}">${change > 0 ? '+' : ''}${change.toFixed(1)}%</td></tr>`; });
  document.getElementById('t-cd-cot').innerHTML = html;
  const physBefore = design.physical_before, physAfter = design.physical_after; const rows = [];
  const spineBefore = physBefore['spine_K_Nm_per_rad (twist, lateral, flexion)'], spineAfter = physAfter['spine_K_Nm_per_rad (twist, lateral, flexion)'];
  ['twist', 'lateral bending', 'flexion'].forEach((axis, i) => rows.push([`Spine stiffness, ${axis} (Nm/rad)`, spineBefore[i][i].toFixed(0), spineAfter[i][i].toFixed(0)]));
  const maxCoupling = (K) => Math.max(Math.abs(K[0][1]), Math.abs(K[0][2]), Math.abs(K[1][2])).toFixed(1);
  rows.push(['Spine cross-axis coupling, largest (Nm/rad)', maxCoupling(spineBefore), maxCoupling(spineAfter)]);
  rows.push(['Spine rest angles (deg)', physBefore.spine_rest_deg.join(', '), physAfter.spine_rest_deg.join(', ')]);
  for (const joint of ['LF_carpus', 'LH_hock']) { const name = joint.includes('carpus') ? 'Carpus' : 'Hock';
    rows.push([`${name} spring (Nm/rad)`, physBefore[joint].K_Nm_per_rad.toFixed(1), physAfter[joint].K_Nm_per_rad.toFixed(1)]); rows.push([`${name} spring rest (deg)`, physBefore[joint].rest_deg.toFixed(1), physAfter[joint].rest_deg.toFixed(1)]); rows.push([`${name} range of motion (deg)`, physBefore[joint].rom_deg.join(' … '), physAfter[joint].rom_deg.join(' … ')]); }
  const slingKey = 'sling_K [[Nm/rad, N/rad],[N/rad, N/m]]'; rows.push(['Sling lift stiffness (N/m)', physBefore[slingKey][1][1].toFixed(0), physAfter[slingKey][1][1].toFixed(0)]); rows.push(['Sling rotation stiffness (Nm/rad)', physBefore[slingKey][0][0].toFixed(1), physAfter[slingKey][0][0].toFixed(1)]); rows.push(['Sling rest height (mm)', physBefore.sling_rest_mm.toFixed(1), physAfter.sling_rest_mm.toFixed(1)]);
  document.getElementById('t-cd-phys').innerHTML = '<tr><th>Property</th><th class="n">Default</th><th class="n">Co-designed</th></tr>' + rows.map((row) => `<tr><td>${row[0]}</td><td class="n">${row[1]}</td><td class="n">${row[2]}</td></tr>`).join('');
}
export function renderCodesign6(design) {
  const lookup = (dict, v) => dict[v] || dict[(+v).toFixed(1)] || dict[String(v)];
  const history = design.history || [], converged = history.filter((h) => h.statuses.every((x) => /^Solve/.test(x)));
  document.getElementById('cd-sub').textContent = `${design.n_design} joint parameters on the six-axis body: springs on every axis, rest angles, range and laxity envelopes (size and centre per axis), wall stiffness and envelope shape of every joint; left and right tied. Optimized together with the gait at ${design.speeds.map((v) => (+v).toFixed(1)).join(' and ')} m/s by an outer L-BFGS-B over the design, using the gait optimizer's exact sensitivities as the gradient; ${design.evaluations} evaluations, each re-solving the gait with bones kept apart and the head kept steady. A small prior keeps parameters near their defaults unless moving them pays.`;
  let html = '<tr><th>Speed</th><th>Default joints</th><th class="n">COT</th><th>Co-designed joints</th><th class="n">COT</th><th class="n">Change</th></tr>';
  design.speeds.forEach((v) => { const before = lookup(design.before, v), after = lookup(design.after, v); const change = (after.cot / before.cot - 1) * 100;
    html += `<tr><td class="n" style="text-align:left">${(+v).toFixed(1)} m/s</td><td>${before.gait || ''}</td><td class="n">${before.cot.toFixed(3)}</td><td>${after.gait}</td><td class="n">${after.cot.toFixed(3)}</td><td class="n ${change < 0 ? 'delta-down' : 'delta-up'}">${change > 0 ? '+' : ''}${change.toFixed(1)}%</td></tr>`; });
  if (converged.length > 1) html += `<tr><td colspan="6" class="muted" style="white-space:normal">Design objective ${converged[0].J.toFixed(4)} → ${Math.min(...converged.map((x) => x.J)).toFixed(4)} over ${history.length} evaluations.</td></tr>`;
  document.getElementById('t-cd-cot').innerHTML = html;
  const changes = (design.largest_changes || []).slice(0, 14);
  document.getElementById('t-cd-phys').innerHTML = '<tr><th>Largest design changes</th><th class="n">Default</th><th class="n">Co-designed</th><th>Unit</th></tr>' + changes.map((row) => `<tr><td>${row.label.replace(/_/g, ' ')}</td><td class="n">${(+row.before).toPrecision(3)}</td><td class="n">${(+row.after).toPrecision(3)}</td><td class="muted">${row.unit}</td></tr>`).join('');
}
export function renderSensitivities() {
  const sens = DATA.sensitivity || {}; const table = document.getElementById('t-sens'); const speedKeys = Object.keys(sens); if (!speedKeys.length) { table.innerHTML = ''; return; }
  let html = '<tr><th>Speed</th><th>Parameter</th><th class="n">ΔCOT for +10%</th></tr>';
  const keep = new Set([speedKeys[0], ...((DATA.codesign && DATA.codesign.speeds) || []).map((x) => speedKeys.find((k) => Math.abs(+k - x) < 1e-6)).filter(Boolean)]);
  speedKeys.filter((v) => keep.has(v)).forEach((v) => sens[v].slice(0, 5).forEach((row, i) => { html += `<tr><td class="n" style="text-align:left">${i === 0 ? (+v).toFixed(1) + ' m/s' : ''}</td><td>${row.label}</td><td class="n ${row.dcot < 0 ? 'delta-down' : 'delta-up'}">${row.dcot > 0 ? '+' : ''}${row.dcot.toFixed(4)}</td></tr>`; }));
  table.innerHTML = html;
}
export function renderFitPlot() {
  const fit = DATA.fit; const section = document.getElementById('fit-section'); if (!fit) { section.hidden = true; return; }
  const svg = document.getElementById('fitsvg'); const all = fit.true.concat(fit.fit, fit.initial, fit.data); const xs = all.map((p) => p[0]), ys = all.map((p) => p[1]);
  const x0 = Math.floor(Math.min(...xs) / 10) * 10 - 5, x1 = Math.ceil(Math.max(...xs) / 10) * 10 + 5, y0 = Math.floor(Math.min(...ys) / 10) * 10 - 5, y1 = Math.ceil(Math.max(...ys) / 10) * 10 + 5;
  const width = 440, height = 340, marginL = 44, marginB = 36, marginT = 10, marginR = 10; const scaleX = (v) => marginL + (v - x0) / (x1 - x0) * (width - marginL - marginR), scaleY = (v) => height - marginB - (v - y0) / (y1 - y0) * (height - marginT - marginB);
  let html = ''; for (let v = Math.ceil(x0 / 20) * 20; v <= x1; v += 20) html += `<line x1="${scaleX(v)}" x2="${scaleX(v)}" y1="${marginT}" y2="${height - marginB}" stroke="${theme.rule}"/><text x="${scaleX(v)}" y="${height - marginB + 14}" text-anchor="middle">${v}</text>`;
  for (let v = Math.ceil(y0 / 10) * 10; v <= y1; v += 10) html += `<line x1="${marginL}" x2="${width - marginR}" y1="${scaleY(v)}" y2="${scaleY(v)}" stroke="${theme.rule}"/><text x="${marginL - 6}" y="${scaleY(v) + 4}" text-anchor="end">${v}</text>`;
  const poly = (points, style) => `<polygon points="${points.map((p) => `${scaleX(p[0])},${scaleY(p[1])}`).join(' ')}" ${style}/>`;
  html += poly(fit.initial, `fill="none" stroke="${theme.muted}" stroke-width="1.5" stroke-dasharray="3 4"`) + poly(fit.true, `fill="none" stroke="${theme.ink}" stroke-width="2.5"`) + poly(fit.fit, `fill="none" stroke="${theme.accent}" stroke-width="2" stroke-dasharray="7 4"`);
  fit.data.forEach((p) => { html += `<circle cx="${scaleX(p[0])}" cy="${scaleY(p[1])}" r="2.6" fill="${theme.up}"/>`; });
  html += `<text class="axis-label" x="${(marginL + width - marginR) / 2}" y="${height - 4}" text-anchor="middle">flexion rz (deg)</text><text class="axis-label" transform="translate(12 ${(marginT + height - marginB) / 2}) rotate(-90)" text-anchor="middle">abduction rx (deg)</text>`;
  const legend = [['true range', theme.ink, ''], ['fitted', theme.accent, '7 4'], ['starting guess', theme.muted, '3 4']]; legend.forEach((entry, i) => { const y = marginT + 12 + i * 16; html += `<line x1="${width - 150}" x2="${width - 126}" y1="${y}" y2="${y}" stroke="${entry[1]}" stroke-width="2" stroke-dasharray="${entry[2]}"/><text x="${width - 120}" y="${y + 4}">${entry[0]}</text>`; });
  html += `<circle cx="${width - 138}" cy="${marginT + 60}" r="2.6" fill="${theme.up}"/><text x="${width - 120}" y="${marginT + 64}">boundary data</text>`;
  svg.innerHTML = html;
  const report = fit.report; document.getElementById('fitfacts').innerHTML = [['ROM boundary error', `${report.boundary_error_deg.mean.toFixed(2)}° <small>mean, ${report.boundary_error_deg.max.toFixed(2)}° max</small>`], ['Data noise', '1° <small>boundary</small>, 0.2 Nm, 0.2 mm'], ['Stiffness matrix true', report.stiffness_true.map((row) => row.map((v) => v.toFixed(2)).join(', ')).join(' | ')], ['Stiffness matrix fitted', report.stiffness_fit.map((row) => row.map((v) => v.toFixed(2)).join(', ')).join(' | ')], ['Passive torque error', `${report.passive_torque_rms_error_Nm.toFixed(2)} <small>Nm RMS</small>`], ['Centre-glide error', `${report.glide_error_mm.mean.toFixed(2)} <small>mm mean</small>`]].map(([key, val]) => `<div><dt>${key}</dt><dd>${val}</dd></div>`).join('');
}
export function renderJointTable() {
  const model = modelFor(current), joints = model.joints.filter((joint) => !isRight(joint.name));
  let html = '<tr><th>Joint</th><th>Free axes</th><th>Range of motion</th><th class="n">Spring (diag)</th><th>Coupled</th><th>Notes</th></tr>';
  joints.forEach((joint) => { html += `<tr><td>${legLabel(joint.name, model)}</td><td class="mono">${joint.free.join(' ')}</td><td class="mono">${joint.axes.map((axis) => `${axis.quasi_static ? '<span class="muted">' : ''}${axis.axis} ${formatAxisValue(axis.lo, axis)}…${formatAxisValue(axis.hi, axis)}${axis.unit === 'deg' ? '°' : ' mm'}${axis.quasi_static ? ' ·massless</span>' : ''}`).join('<br>')}</td><td class="n">${joint.axes.map((axis) => axis.K.toFixed(axis.unit === 'mm' ? 0 : 1) + (axis.unit === 'mm' ? ' N/m' : ' Nm/rad')).join('<br>')}</td><td class="mono">${(joint.coupled || []).join(' ') || '—'}${joint.offdiag ? '<br>cross-axis spring' : ''}</td><td style="white-space:normal; max-width:34ch" class="muted">${joint.notes || ''}</td></tr>`; });
  document.getElementById('t-joints').innerHTML = html;
  const hasJointPlay = model.joints.some((joint) => joint.axes.some((axis) => axis.quasi_static));
  document.getElementById('model-sum').textContent = `Model of the selected gait: ${model.bones.length} bones, ${model.nq} degrees of freedom (6 for the floating ${model.biped ? 'pelvis' : 'trunk'}), ${model.nm} muscles, ${model.ntheta} ${model.ntheta_label || 'optimizable joint parameters'}. Body mass ${model.mass} kg. Right limbs mirror the left.${hasJointPlay ? ' Massless axes are the quasi-static joint play.' : ''}`;
}
export function renderFindings() {
  const perSpeed = speeds.map((v) => [v, GAIT_FAMILIES[familyIndex[bestSolutionAtSpeed[v].fam]][1]]); const runs = [];
  perSpeed.forEach(([v, gait]) => { if (runs.length && runs[runs.length - 1].gait === gait) runs[runs.length - 1].end = v; else runs.push({ gait, start: v, end: v }); });
  const text = runs.map((run) => run.start === run.end ? `<b>${run.gait.toLowerCase()}</b> at ${run.start.toFixed(1)} m/s` : `<b>${run.gait.toLowerCase()}</b> from ${run.start.toFixed(1)} to ${run.end.toFixed(1)} m/s`).join(', ');
  document.getElementById('finding').innerHTML = `In 3D, with lateral balance to pay for, the cheapest gaits found were ${text}. ${DATA.finding_extra || ''}`;
}
// ---------- muscle mass vs strength + segment masses
export function renderMuscleMassPanel() {
  const model = modelFor(current), section = document.getElementById('mus-section');
  if (!model.segments || !model.muscles[0].mass) { section.hidden = true; return; } section.hidden = false;
  const regionOf = (muscle) => /^[LR]F_/.test(muscle.name) ? 0 : /^[LR]H_/.test(muscle.name) ? 1 : /^[LR][1-9]_/.test(muscle.name) ? 3 : 2;
  const limbNames = model.limb_names || { fore: 'forelimb', hind: 'hindlimb' }, hasTail = model.bones.some((b) => /^tail/.test(b.name));
  const REGION_GROUPS = [[limbNames.fore, '--s1'], [limbNames.hind, '--s2'], [hasTail ? 'spine, neck, tail' : 'spine, neck', '--s3'], ['middle legs', '--s4']];
  const leftMuscles = model.muscles.filter((muscle) => !isRight(muscle.name) && !/_R$/.test(muscle.name));
  const width = 460, height = 330, marginL = 52, marginR = 12, marginT = 10, marginB = 40;
  const forceMax = Math.max(3000, ...leftMuscles.map((mu) => mu.F0 * 1.15)), massMax = Math.max(2000, ...leftMuscles.map((mu) => mu.mass * 1150));
  const log10 = (v) => Math.log10(v), xDomain = [log10(40), log10(forceMax)], yDomain = [log10(5), log10(massMax)];
  const scaleX = (force) => marginL + (log10(force) - xDomain[0]) / (xDomain[1] - xDomain[0]) * (width - marginL - marginR), scaleY = (grams) => height - marginB - (log10(grams) - yDomain[0]) / (yDomain[1] - yDomain[0]) * (height - marginT - marginB);
  let html = '';
  [50, 100, 200, 500, 1000, 2000, 5000].filter((v) => v <= forceMax).forEach((v) => { html += `<line x1="${scaleX(v)}" x2="${scaleX(v)}" y1="${marginT}" y2="${height - marginB}" stroke="${theme.rule}"/><text x="${scaleX(v)}" y="${height - marginB + 14}" text-anchor="middle">${v}</text>`; });
  [10, 30, 100, 300, 1000].forEach((v) => { html += `<line x1="${marginL}" x2="${width - marginR}" y1="${scaleY(v)}" y2="${scaleY(v)}" stroke="${theme.rule}"/><text x="${marginL - 6}" y="${scaleY(v) + 4}" text-anchor="end">${v}</text>`; });
  const specificTension = model.muscles[0].F0 / model.muscles[0].pcsa;               // specific tension (Pa)
  document.getElementById('mus-sigma').textContent = (specificTension / 1e6).toFixed(2);
  [0.03, 0.1, 0.3].forEach((fibreLen) => { const massOf = (force) => 1060 * force / specificTension * fibreLen * 1000; const start = [40, massOf(40)], end = [forceMax, massOf(forceMax)];
    html += `<line x1="${scaleX(start[0])}" y1="${scaleY(Math.max(start[1], 5))}" x2="${scaleX(end[0])}" y2="${scaleY(Math.min(end[1], massMax))}" stroke="${theme.muted}" stroke-dasharray="4 4" stroke-width="1"/><text x="${scaleX(1400)}" y="${scaleY(massOf(1400)) - 6}" style="font-size:10px">${Math.round(fibreLen * 100)} cm fibres</text>`; });
  leftMuscles.forEach((muscle) => { const c = readCssVar(REGION_GROUPS[regionOf(muscle)][1]); html += `<circle class="mpt" data-n="${muscle.name}" cx="${scaleX(muscle.F0)}" cy="${scaleY(muscle.mass * 1000)}" r="5" fill="${c}" stroke="${theme.surface}" stroke-width="1.5"/>`; });
  html += `<text class="axis-label" x="${(marginL + width - marginR) / 2}" y="${height - 6}" text-anchor="middle">strength, max isometric force (N)</text><text class="axis-label" transform="translate(12 ${(marginT + height - marginB) / 2}) rotate(-90)" text-anchor="middle">muscle mass (g)</text>`;
  const scatter = document.getElementById('massvs'); scatter.innerHTML = html;
  scatter.querySelectorAll('.mpt').forEach((dot) => { const muscle = leftMuscles.find((x) => x.name === dot.dataset.n); dot.addEventListener('mousemove', (e) => showTooltip(e, `<b>${muscle.name.replace(/^L[FH]_|_L$/g, '').replace(/^L([1-9])_/, 'M$1 ')}</b><br>${muscle.F0} N · ${(muscle.mass * 1000).toFixed(0)} g<br>fibres ${(muscle.lopt * 100).toFixed(1)} cm · cross-section ${(muscle.pcsa * 1e4).toFixed(1)} cm²`)); dot.addEventListener('mouseleave', hideTooltip); });
  document.getElementById('mus-legend').innerHTML = REGION_GROUPS.filter((group, k) => leftMuscles.some((muscle) => regionOf(muscle) === k)).map(([name, cssVar]) => `<span><svg width="10" height="10" aria-hidden="true"><circle cx="5" cy="5" r="4" fill="${readCssVar(cssVar)}"/></svg>${name}</span>`).join('');
  // segment bars
  const segments = model.segments.filter((x) => !isRight(x.name)); const maxMass = Math.max(...segments.map((x) => x.mass));
  const barH = Math.min(22, (330 - 20) / segments.length), labelW = 110, barW = 460 - labelW - 60; let bars = '';
  segments.forEach((seg, i) => { const y = 6 + i * barH, muscleW = barW * seg.muscle / maxMass, totalW = barW * seg.mass / maxMass;
    bars += `<text x="0" y="${y + barH * 0.62}">${legLabel(seg.name, model).replace('_', ' ')}</text><rect x="${labelW}" y="${y + 2}" width="${Math.max(0, totalW).toFixed(1)}" height="${barH - 5}" rx="3" fill="${theme.surface2}" stroke="${theme.rule}"/><rect x="${labelW}" y="${y + 2}" width="${Math.max(0, muscleW).toFixed(1)}" height="${barH - 5}" rx="3" fill="${theme.accent}"/><text x="${labelW + totalW + 6}" y="${y + barH * 0.62}">${seg.mass.toFixed(2)} kg</text>`; });
  const barSvg = document.getElementById('segbars'); barSvg.setAttribute('viewBox', `0 0 460 ${Math.ceil(10 + segments.length * barH)}`); barSvg.innerHTML = bars;
  const totalMuscle = model.segments.reduce((sum, x) => sum + x.muscle, 0);
  document.getElementById('seg-sub').innerHTML = `Segment masses used by the dynamics. <span style="color:var(--accent); font-weight:600">Muscle</span> (${totalMuscle.toFixed(1)} kg, ${(100 * totalMuscle / model.mass).toFixed(0)}% of body mass) sits on the bone its belly lies along; bone, skin, organs and pads make up the rest of the ${model.mass} kg. Left side and the axial skeleton.`;
}
// ---------- body variants / multi-body comparison
export function renderVariants() {
  if (DATA.compare) return renderCompareTable(DATA.compare);
  const variant = (DATA.variants || [])[0], section = document.getElementById('var-section'); if (!variant || !variant.default) { section.hidden = true; return; }
  const variantSol = solutions.find((sol) => sol.summary.variant === variant.name);
  document.getElementById('var-h').textContent = DATA.variantTitle || `Same dog, ${variant.label}`;
  document.getElementById('var-sub').textContent = `Scapula, humerus, forearm and paw each twice as long; everything else as the default body. Longer muscles are heavier (mass scales with fibre length) and longer bones carry more bone and skin, so the body weighs ${variant.variant.mass} kg instead of ${variant.default.mass} kg; its trunk, organs and head are unchanged. Cold-started walk at ${variant.speed.toFixed(1)} m/s, bones kept apart, head kept steady.`;
  const before = variant.default, after = variant.variant;
  const rows = [['Body mass', `${before.mass} kg`, `${after.mass} kg`], ['Cost of transport (per kg)', before.cot.toFixed(3), after.cot.toFixed(3)], ['Metabolic power', `${before.power} W`, `${after.power} W`],
    ['Gait', before.gait, after.gait], ['Stride period · length', `${before.T.toFixed(2)} s · ${before.stride.toFixed(2)} m`, `${after.T.toFixed(2)} s · ${after.stride.toFixed(2)} m`], ['Duty factor fore / hind', `${before.duty_fore} / ${before.duty_hind}`, `${after.duty_fore} / ${after.duty_hind}`],
    ['Mean back pitch (nose up +)', `${before.pitch.toFixed(0)}°`, `${after.pitch.toFixed(0)}°`], ['Head height', `${before.head_height} m`, `${after.head_height} m`], ['Head rotation (RMS)', `${before.head_rot.toFixed(0)}°/s`, `${after.head_rot.toFixed(0)}°/s`],
    ...['LF_shoulder', 'LF_elbow', 'LF_carpus', 'LH_hip', 'LH_knee', 'LH_hock'].map((joint) => [`${joint.slice(3)} flexion range`, `${before.rom[joint].toFixed(0)}°`, `${after.rom[joint].toFixed(0)}°`])];
  document.getElementById('t-var').innerHTML = '<tr><th></th><th class="n">Default body</th><th class="n">Forelimbs ×2</th></tr>' + rows.map((row) => `<tr><td>${row[0]}</td><td class="n">${row[1]}</td><td class="n">${row[2]}</td></tr>`).join('');
  const showBtn = document.getElementById('var-show'); if (variantSol) showBtn.addEventListener('click', () => { requestSelect(variantSol); document.querySelector('.main').scrollIntoView({ behavior: 'smooth', block: 'start' }); }); else showBtn.hidden = true;
}
export function renderCompareTable(compare) {
  document.getElementById('var-h').textContent = compare.title;
  document.getElementById('var-sub').textContent = compare.sub;
  const cols = compare.cols, hasManyLegs = cols.some((c) => c.legs > 4);
  // a column without a speed takes it from its body's solution (the mode with the same label)
  const speedOf = (c) => { if (c.speed != null) return c.speed; const mode = (DATA.modes || []).find((m) => m.label === c.label); return mode ? solutions[mode.sol].summary.speed : null; };
  const speedRow = new Set(cols.map(speedOf)).size > 1 ? [['Speed', (c) => (speedOf(c) == null ? '—' : `${speedOf(c).toFixed(1)} m/s`)]] : [];
  const rows = [['Body mass', (c) => `${c.mass} kg`], ['Legs', (c) => c.legs], ...speedRow, ['Cost of transport (per kg)', (c) => c.cot.toFixed(3)], ['Metabolic power', (c) => `${c.power} W`],
    ['Gait', (c) => c.gait], ['Stride period · length', (c) => `${c.T.toFixed(2)} s · ${c.stride.toFixed(2)} m`], [hasManyLegs ? 'Duty factor fore / (middle) / hind' : 'Duty factor fore / hind', (c) => c.duty],
    ['Mean back pitch (nose up +)', (c) => `${c.pitch.toFixed(0)}°`], ['Head height', (c) => `${c.head_height} m`], ['Head rotation (RMS)', (c) => `${c.head_rot.toFixed(0)}°/s`], ['Closest bones', (c) => `${c.clearance} mm`],
    ...['shoulder', 'elbow', 'carpus', 'hip', 'knee', 'hock'].map((joint) => [`${{ carpus: 'Carpus (wrist)', hock: 'Hock (ankle)' }[joint] || joint[0].toUpperCase() + joint.slice(1)} flexion range`, (c) => `${c.rom[joint].toFixed(0)}°`])];
  document.getElementById('t-var').innerHTML = '<tr><th></th>' + cols.map((c) => `<th class="n">${c.label}</th>`).join('') + '</tr>' +
    rows.map(([label, format]) => `<tr><td>${label}</td>${cols.map((c) => `<td class="n">${format(c)}</td>`).join('')}</tr>`).join('');
  document.getElementById('var-show').hidden = true;
}
// ---------- joints free in all six axes
export function renderDof6Panel() {
  const dof6 = DATA.dof6, section = document.getElementById('d6-section'); if (!dof6) { section.hidden = true; return; }
  const freeSol = solutions.find((sol) => sol.summary.dof6);
  document.getElementById('d6-sub').textContent = `The same dog with every joint free in all six axes (${dof6.nq} degrees of freedom): each pair of bone ends can take any relative position and orientation, pushed back by passive forces that depend on the whole relative pose and velocity. Joint play (${dof6.n_quasi} axes: millimetre translations, few-degree off-axis rotations) is quasi-static. Trot at ${dof6.speed.toFixed(1)} m/s; excursion over one stride, and the peak passive force along each translation axis.`;
  const axes = ['rx', 'ry', 'rz', 'tx', 'ty', 'tz'], axisLabels = { rx: 'roll / abd', ry: 'yaw / axial', rz: 'flex / ext', tx: 'fore-aft', ty: 'along limb', tz: 'lateral' };
  let html = `<tr><th>Joint</th>${axes.map((a) => `<th class="n">${axisLabels[a]}</th>`).join('')}<th class="n">Peak force fore-aft · along · lateral</th></tr>`;
  dof6.rows.forEach((row) => { html += `<tr><td>${legLabel(row.joint)}</td>${axes.map((a) => { const v = row.axes[a]; return v ? `<td class="n${v.quasi_static ? ' muted' : ''}">${v.range.toFixed(v.unit === 'deg' ? 1 : 2)}${v.unit === 'deg' ? '°' : ' mm'}</td>` : '<td class="n muted">—</td>'; }).join('')}<td class="n">${['tx', 'ty', 'tz'].map((a) => row.peak_force_bw[a] != null ? row.peak_force_bw[a].toFixed(1) : '—').join(' · ')} <span class="muted">BW</span></td></tr>`; });
  document.getElementById('t-d6').innerHTML = html;
  const verify = dof6.verify || {};
  document.getElementById('d6-note').innerHTML = `Cost of transport ${dof6.cot.toFixed(3)} vs ${dof6.cot29.toFixed(3)} for the same gait with hinge and ball joints (${dof6.cot > dof6.cot29 ? '+' : ''}${((dof6.cot / dof6.cot29 - 1) * 100).toFixed(0)}%). Grey values are massless axes. Re-simulated with a stiff integrator, the dynamic joints stay within ${(verify.interval_q_err_deg || 0).toFixed(2)}° per step (median ${(verify.interval_q_err_deg_median || 0).toFixed(2)}°). The joint play is exact at the 50 nodes; between nodes its interpolated position is within ${(verify.quasi_static_offset_mm_median || 0).toFixed(1)} mm and ${(verify.quasi_static_offset_deg_median || 0).toFixed(1)}° of the position that balances the loads (median; worst ${(verify.quasi_static_offset_mm || 0).toFixed(1)} mm, ${(verify.quasi_static_offset_deg || 0).toFixed(1)}°), because play inside an envelope is loose until a wall engages. Joint-play stiffnesses and ranges are order-of-magnitude assumptions, not dog measurements.`;
  const showBtn = document.getElementById('d6-show'); if (freeSol) showBtn.addEventListener('click', () => { requestSelect(freeSol); document.querySelector('.main').scrollIntoView({ behavior: 'smooth', block: 'start' }); }); else showBtn.hidden = true;
}

export function setupModeSwitch() {
  const modeDefs = DATA.modes; if (!modeDefs) return false;
  ['best-section', 'cot-section', 'cd-section', 'd6-section', 'fit-section', 'sel-label', 'var-show'].forEach((id) => { const el = document.getElementById(id); if (el) el.hidden = true; });
  if (DATA.lede) document.querySelector('.lede').textContent = DATA.lede;
  const updateNote = document.getElementById('update-note'); if (DATA.note) updateNote.innerHTML = DATA.note; else updateNote.hidden = true;
  document.getElementById('eyebrow').textContent = DATA.eyebrow || document.getElementById('eyebrow').textContent;
  const section = document.getElementById('mode-section'), switchEl = document.getElementById('mode-switch'); section.hidden = false;
  // bodies of one kind (e.g. the humanoids) start a new row
  modeDefs.forEach((mode, i) => { if (i && mode.group !== modeDefs[i - 1].group) { const rowBreak = document.createElement('span'); rowBreak.className = 'mode-break'; rowBreak.setAttribute('aria-hidden', 'true'); switchEl.appendChild(rowBreak); }
    const btn = document.createElement('button'); btn.setAttribute('role', 'radio'); btn.dataset.i = i;
    btn.innerHTML = `${mode.thumb ? `<img class="mode-img" src="${mode.thumb}" alt="">` : ''}<span class="mode-k">${mode.kicker}</span><span class="mode-l">${mode.label}</span><span class="mode-s">${mode.sub}</span>`;
    btn.addEventListener('click', () => requestSelect(solutions[mode.sol])); switchEl.appendChild(btn); });
  switchEl.addEventListener('keydown', (e) => { if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return; e.preventDefault();
    const i = modeDefs.findIndex((mode) => solutions[mode.sol] === current), j = (i + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : modeDefs.length - 1)) % modeDefs.length; requestSelect(solutions[modeDefs[j].sol]); switchEl.querySelectorAll('button')[j].focus(); });
  setCurrent(solutions[modeDefs[0].sol]);
  return true;
}
export function markActiveMode() { if (!DATA.modes) return; document.getElementById('mode-switch').querySelectorAll('button').forEach((btn, i) => { const on = solutions[DATA.modes[i].sol] === current; btn.setAttribute('aria-checked', String(on)); btn.tabIndex = on ? 0 : -1; }); }
