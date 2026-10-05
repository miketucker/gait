// 2D stage canvas: stick-figure skeleton, muscles, paws, ground forces,
// orbit/zoom controls and the anatomy-mode toggle.
import { modelFor, theme, readCssVar, orbitCam, VIEW_PRESETS, current, stridePhase, playing, playRate, lastTickMs, setLastTick, setStridePhase, anatomyOn, setAnatomyOn, legCodeOf, legLabel, isRight, activationColor } from './state.js';
import { poseAtPhase, applyBonePose, strideMaxHeight, makeProjector, boneIndex } from './pose.js';
import { AnatomyRenderer, anatomyOptions } from './anatomy.js';
import { drawHeatCursor } from './panels.js';
import { musclePathSegments, muscleActivationAt } from './muscle-display.js';

export const stageCanvas = document.getElementById('stage'), stageCtx = stageCanvas.getContext('2d');
export let devicePx = 1;
export function fitCanvasToElement(canvas) { const rect = canvas.getBoundingClientRect(); devicePx = window.devicePixelRatio || 1; canvas.width = Math.round(rect.width * devicePx); canvas.height = Math.round(rect.height * devicePx); }
fitCanvasToElement(stageCanvas);

// ---------- 2D stage: stick-figure skeleton, muscles, paws and ground forces
export function drawStage() {
  const widthPx = stageCanvas.width, heightPx = stageCanvas.height;
  const useAnatomy = anatomyOn && AnatomyRenderer && modelFor(current).anatomy;
  stageCtx.setTransform(1, 0, 0, 1, 0, 0);
  if (useAnatomy) stageCtx.clearRect(0, 0, widthPx, heightPx); else { stageCtx.fillStyle = theme.surface; stageCtx.fillRect(0, 0, widthPx, heightPx); }
  const pose = poseAtPhase(current, stridePhase);
  const model = modelFor(current);
  const hasHead = model.bones.some((b) => b.name === 'head');
  const rootPose = pose[boneIndex[model.root]];
  const target = [rootPose[9] + 0.05, Math.max(0.32, 0.42 * strideMaxHeight(current)), 0];
  const project = makeProjector(stageCanvas, orbitCam, target);
  const frameCount = current.a[0].length, x = stridePhase * frameCount, frame = Math.floor(x) % frameCount, blend = x - Math.floor(x), nextFrame = (frame + 1) % frameCount;
  if (useAnatomy) { const info = AnatomyRenderer.draw(model, current, pose, frame, nextFrame, blend, target, anatomyOptions(), widthPx, heightPx, devicePx);
    const infoEl = document.getElementById('an-info'); if (info && infoEl._m !== model) { infoEl._m = model; infoEl.textContent = `skin encloses ${info.volume_l} L · fat ${info.fat_kg} kg · skin ${info.skin_kg} kg (drawn only; not in the dynamics)`; } }
  else if (anatomyOn) { const infoEl = document.getElementById('an-info'); if (infoEl._m !== model) { infoEl._m = model; infoEl.textContent = 'This body has no anatomy layers yet; showing its skeleton and muscle lines.'; } }
  // ground grid, fixed to the world; wider under tall bodies
  stageCtx.lineWidth = 1 * devicePx; stageCtx.strokeStyle = useAnatomy ? 'rgba(0,0,0,0)' : theme.grid;
  const gridReach = Math.max(1.6, 1.1 * strideMaxHeight(current)), gridSide = Math.max(0.6, Math.ceil(3 * strideMaxHeight(current)) / 10);
  const gridStart = Math.floor((target[0] - gridReach) * 10) / 10;
  for (let gx = gridStart; gx < target[0] + gridReach; gx += 0.1) { const a = project([gx, 0, -gridSide]), b = project([gx, 0, gridSide]); if (a[2] > 0.05 && b[2] > 0.05) { stageCtx.beginPath(); stageCtx.moveTo(a[0], a[1]); stageCtx.lineTo(b[0], b[1]); stageCtx.stroke(); } }
  for (let gz = -gridSide; gz <= gridSide + 0.01; gz += 0.1) { const a = project([target[0] - gridReach, 0, gz]), b = project([target[0] + gridReach, 0, gz]); if (a[2] > 0.05 && b[2] > 0.05) { stageCtx.beginPath(); stageCtx.moveTo(a[0], a[1]); stageCtx.lineTo(b[0], b[1]); stageCtx.stroke(); } }
  if (!useAnatomy && model.outline && document.getElementById('show-outline').checked) drawOutline(model, pose, project);
  const prims = [];
  // muscles: fibre in activation colour, tendon in pale; right side dimmed
  if (!useAnatomy) model.muscles.forEach((muscle, i) => {
    const centerline = muscle.path.map(([bone, point]) => applyBonePose(pose, bone, point));
    const activation = muscleActivationAt(current, i, frame, nextFrame, blend);
    const side = legCodeOf(muscle.path[muscle.path.length - 1][0]) || legCodeOf(muscle.path[0][0]) || (/_R$/.test(muscle.name) ? 'R' : 'L');
    const isFar = side[0] === 'R';
    for (const { from, to, tendon } of musclePathSegments(muscle, centerline)) {
      if (tendon) prims.push({ kind: 'seg', from, to, widthPx: 1, color: theme.boneFar, alpha: isFar ? 0.4 : 0.9 });
      else prims.push(muscle.pcsa ? { kind: 'seg', from, to, widthWorld: 2 * Math.sqrt(muscle.pcsa / Math.PI), color: activationColor(activation), alpha: isFar ? 0.3 : 0.62 }
        : { kind: 'seg', from, to, widthPx: Math.max(1.5, Math.sqrt(muscle.F0) * 0.12), color: activationColor(activation), alpha: isFar ? 0.4 : 0.9 });
    }
  });
  // bones
  if (!useAnatomy) model.bones.forEach((bone) => {
    const boneStart = applyBonePose(pose, bone.name, [0, 0, 0]), boneEnd = applyBonePose(pose, bone.name, [bone.length, 0, 0]);
    const isTrunk = !legCodeOf(bone.name); const isFar = legCodeOf(bone.name)[0] === 'R';
    const width = bone.name === 'head' ? 9 : /^neck/.test(bone.name) ? 5.5 : /^tail/.test(bone.name) ? 2.8 : isTrunk ? 7 : 4.5;
    prims.push({ kind: 'seg', from: boneStart, to: boneEnd, widthPx: width, color: isFar ? theme.boneFar : theme.bone, alpha: 1 });
    if (bone.name === 'head' && model.head_circle) { const eyePos = applyBonePose(pose, 'head', model.eye ? model.eye[1] : [0.09, 0.03, 0]);   // a rounded skull (humanoid)
      prims.push({ kind: 'dot', point: applyBonePose(pose, 'head', model.head_circle.center), radius: model.head_circle.radius, world: true, color: theme.bone }, { kind: 'dot', point: eyePos, radius: 3, color: theme.accent }); }
    else if (bone.name === 'head') { const skullTop = applyBonePose(pose, 'head', [0.02, 0.05, 0]), eyePos = applyBonePose(pose, 'head', model.eye ? model.eye[1] : [0.09, 0.03, 0]);
      prims.push({ kind: 'seg', from: boneStart, to: skullTop, widthPx: 6, color: theme.bone, alpha: 1 }, { kind: 'seg', from: skullTop, to: boneEnd, widthPx: 4, color: theme.bone, alpha: 1 }, { kind: 'dot', point: eyePos, radius: 3, color: theme.accent }); }
    prims.push({ kind: 'dot', point: boneStart, radius: 2.4, color: theme.surface, stroke: isFar ? theme.boneFar : theme.bone });
  });
  // ribs / pelvis hints
  const ribScale = (model.bones.find((x) => x.name === 'thorax') || { length: 0.42 }).length / 0.42;   // ribs along the whole ribcage
  if (!useAnatomy) for (let u = 0.08 * ribScale; u <= 0.40 * ribScale + 1e-9; u += 0.05 * ribScale) for (const sideSign of [1, -1]) { const ribA = applyBonePose(pose, 'thorax', [u, 0, 0]), ribB = applyBonePose(pose, 'thorax', model.rib_depth   // an upright chest: ribs slope down toward the front, near-even depth
    ? [u - 0.3 * model.rib_depth, -model.rib_depth * (1 - 0.35 * ((u - 0.24 * ribScale) / (0.16 * ribScale)) ** 2), sideSign * 0.9 * model.rib_half_width]
    : [u + 0.04, -0.17 + Math.abs(u - 0.24 * ribScale) * 0.4 / ribScale, sideSign * 0.9 * (model.rib_half_width || 0.11)]); prims.push({ kind: 'seg', from: ribA, to: ribB, widthPx: 1.2, color: theme.boneFar, alpha: 0.7 }); }
  if (!hasHead && !useAnatomy) { const neckBase = applyBonePose(pose, 'thorax', [0.42, 0, 0]), headPt = applyBonePose(pose, 'thorax', [0.56, 0.10, 0]), snoutPt = applyBonePose(pose, 'thorax', [0.70, 0.04, 0]);
    prims.push({ kind: 'seg', from: neckBase, to: headPt, widthPx: 3, color: theme.bone, alpha: 1 }, { kind: 'seg', from: headPt, to: snoutPt, widthPx: 2, color: theme.bone, alpha: 1 }); }
  // paws + ground-reaction forces
  const showForces = document.getElementById('show-grf').checked;
  model.contacts.forEach((contact, contactIdx) => {
    const paw = applyBonePose(pose, contact.bone, contact.point); const isFar = contact.name[0] === 'R';
    if (!useAnatomy) prims.push({ kind: 'dot', point: paw, radius: contact.radius, world: true, color: isFar ? theme.boneFar : theme.paw });
    if (showForces) { const force = [0, 1, 2].map((d) => current.grf[d][contactIdx][frame] * (1 - blend) + current.grf[d][contactIdx][nextFrame] * blend);
      if (force[1] > 0.02) { const arrowScale = 0.25, base = [paw[0], 0, paw[2]], tip = [paw[0] + force[0] * arrowScale, force[1] * arrowScale, paw[2] + force[2] * arrowScale]; prims.push({ kind: 'arrow', from: base, to: tip, color: theme.grf, alpha: isFar ? 0.55 : 1 }); } }
  });
  // project + sort far to near
  prims.forEach((prim) => { if (prim.kind === 'dot') { prim.proj = project(prim.point); prim.depth = prim.proj[2]; } else { prim.projA = project(prim.from); prim.projB = project(prim.to); prim.depth = 0.5 * (prim.projA[2] + prim.projB[2]); } });
  prims.sort((a, b) => b.depth - a.depth);
  stageCtx.lineCap = 'round';
  for (const prim of prims) {
    if (prim.depth < 0.05) continue;
    stageCtx.globalAlpha = prim.alpha ?? 1;
    if (prim.kind === 'seg') { stageCtx.strokeStyle = prim.color; stageCtx.lineWidth = prim.widthWorld ? Math.max(1, prim.widthWorld * 0.5 * (prim.projA[3] + prim.projB[3])) : prim.widthPx * devicePx * (prim.projA[3] / (stageCanvas.height * 0.6)); stageCtx.beginPath(); stageCtx.moveTo(prim.projA[0], prim.projA[1]); stageCtx.lineTo(prim.projB[0], prim.projB[1]); stageCtx.stroke(); }
    else if (prim.kind === 'dot') { const radius = prim.world ? prim.radius * prim.proj[3] : prim.radius * devicePx; stageCtx.fillStyle = prim.color; stageCtx.beginPath(); stageCtx.arc(prim.proj[0], prim.proj[1], Math.max(radius, 1), 0, 7); stageCtx.fill(); if (prim.stroke) { stageCtx.strokeStyle = prim.stroke; stageCtx.lineWidth = 1.3 * devicePx; stageCtx.stroke(); } }
    else if (prim.kind === 'arrow') { stageCtx.strokeStyle = prim.color; stageCtx.fillStyle = prim.color; stageCtx.lineWidth = 2 * devicePx; stageCtx.beginPath(); stageCtx.moveTo(prim.projA[0], prim.projA[1]); stageCtx.lineTo(prim.projB[0], prim.projB[1]); stageCtx.stroke(); const ang = Math.atan2(prim.projB[1] - prim.projA[1], prim.projB[0] - prim.projA[0]), headLen = 7 * devicePx; stageCtx.beginPath(); stageCtx.moveTo(prim.projB[0], prim.projB[1]); stageCtx.lineTo(prim.projB[0] - headLen * Math.cos(ang - 0.4), prim.projB[1] - headLen * Math.sin(ang - 0.4)); stageCtx.lineTo(prim.projB[0] - headLen * Math.cos(ang + 0.4), prim.projB[1] - headLen * Math.sin(ang + 0.4)); stageCtx.closePath(); stageCtx.fill(); }
  }
  stageCtx.globalAlpha = 1; stageCtx.fillStyle = theme.muted; stageCtx.font = `${11 * devicePx}px ${readCssVar('--font-mono')}`;
  stageCtx.fillText(`t = ${(stridePhase * current.summary.T).toFixed(3)} s of ${current.summary.T.toFixed(3)} s`, 12 * devicePx, 20 * devicePx);
  stageCtx.fillText('grid 10 cm · arrows 1 BW = 25 cm · drag to orbit, scroll to zoom', 12 * devicePx, heightPx - 10 * devicePx);
  const footfallCursor = document.getElementById('ff-cursor'); if (footfallCursor) { const cursorX = 34 + (320 - 34 - 4) / 2 * stridePhase; /* same x0 and width as renderFootfall */ footfallCursor.setAttribute('x1', cursorX); footfallCursor.setAttribute('x2', cursorX); }
  drawHeatCursor();
}
// skin and fat around a humanoid's skeleton: every capsule drawn opaque on a scratch canvas, then laid down
// translucent in one pass, so overlapping capsules read as one silhouette
const outlineCanvas = document.createElement('canvas'), outlineCtx = outlineCanvas.getContext('2d');
function drawOutline(model, pose, project) {
  if (outlineCanvas.width !== stageCanvas.width || outlineCanvas.height !== stageCanvas.height) { outlineCanvas.width = stageCanvas.width; outlineCanvas.height = stageCanvas.height; }
  outlineCtx.clearRect(0, 0, outlineCanvas.width, outlineCanvas.height); outlineCtx.strokeStyle = outlineCtx.fillStyle = theme.bone; outlineCtx.lineCap = 'round';
  for (const [bone, from, to, radius] of model.outline) { const a = project(applyBonePose(pose, bone, from)), b = project(applyBonePose(pose, bone, to)); if (a[2] < 0.05 || b[2] < 0.05) continue;
    if (from === to || (from[0] === to[0] && from[1] === to[1] && from[2] === to[2])) { outlineCtx.beginPath(); outlineCtx.arc(a[0], a[1], radius * a[3], 0, 7); outlineCtx.fill(); continue; }
    outlineCtx.lineWidth = radius * (a[3] + b[3]); outlineCtx.beginPath(); outlineCtx.moveTo(a[0], a[1]); outlineCtx.lineTo(b[0], b[1]); outlineCtx.stroke(); }
  stageCtx.globalAlpha = 0.14; stageCtx.drawImage(outlineCanvas, 0, 0); stageCtx.globalAlpha = 1;
}
export function animationTick(now) { const dt = Math.min(0.05, (now - lastTickMs) / 1000); setLastTick(now); if (playing) setStridePhase((stridePhase + dt * playRate / current.summary.T) % 1); drawStage(); requestAnimationFrame(animationTick); }
// orbit / zoom
export let dragState = null;
stageCanvas.addEventListener('pointerdown', (e) => { dragState = [e.clientX, e.clientY, orbitCam.az, orbitCam.el]; stageCanvas.setPointerCapture(e.pointerId); });
stageCanvas.addEventListener('pointermove', (e) => { if (!dragState) return; orbitCam.az = dragState[2] - (e.clientX - dragState[0]) * 0.008; orbitCam.el = Math.max(-0.05, Math.min(1.5, dragState[3] + (e.clientY - dragState[1]) * 0.006)); applyCameraView(null); });
stageCanvas.addEventListener('pointerup', () => { dragState = null; });
stageCanvas.addEventListener('wheel', (e) => { e.preventDefault(); orbitCam.dist = Math.max(0.9, Math.min(Math.max(5, 4 * strideMaxHeight(current)), orbitCam.dist * Math.exp(e.deltaY * 0.001))); }, { passive: false });

export function applyCameraView(preset) { document.querySelectorAll('[data-view]').forEach((btn) => btn.setAttribute('aria-pressed', String(btn.dataset.view === preset))); if (preset) [orbitCam.az, orbitCam.el] = VIEW_PRESETS[preset]; }

export function setAnatomyMode(on) {
  setAnatomyOn(!!on && !!AnatomyRenderer); document.querySelectorAll('[data-anat]').forEach((btn) => btn.setAttribute('aria-pressed', String((btn.dataset.anat === '1') === anatomyOn)));
  document.getElementById('anat-controls').hidden = !anatomyOn; document.getElementById('stage3').hidden = !anatomyOn;
  document.querySelector('.stage-wrap').classList.toggle('anat', anatomyOn);
}
