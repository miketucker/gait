// Wiring + init: defines selectSolution, connects controls, boots the viewer.
// Imports every module; nothing imports main (acyclic).
import { DATA, current, playing, playRate, orbitCam, readTheme, onSelectRequest, setCurrent, setStridePhase, setPlayingFlag, setPlayRate, setLastTick, modelFor } from './state.js';
import { strideMaxHeight } from './pose.js';
import { AnatomyRenderer } from './anatomy.js';
import { stageCanvas, fitCanvasToElement, animationTick, applyCameraView, setAnatomyMode } from './stage.js';
import { markActiveMode, renderSpeedStrip, renderSolutionPicker, renderReadout, renderFootfall, renderHeatmap, renderCostChart, renderRomUsage, renderHipPlot, renderJointTable, renderMuscleMassPanel, renderRampLegend, renderFindings, renderCodesign, renderSensitivities, renderFitPlot, renderDof6Panel, renderVariants, setupModeSwitch } from './panels.js';

// ---------- selection
function selectSolution(sol) { setCurrent(sol); setStridePhase(0); orbitCam.dist = 1.75 * Math.max(1, strideMaxHeight(sol) / 0.85); markActiveMode(); renderSpeedStrip(); renderSolutionPicker(); renderReadout(); renderFootfall(); renderHeatmap(); renderCostChart(); renderRomUsage(); renderHipPlot(); renderJointTable();
  document.getElementById('outline-label').hidden = !modelFor(sol).outline;
  document.getElementById('act-sub').textContent = `Left limbs and the left side of the trunk${modelFor(sol).bones.some((b) => /^tail/.test(b.name)) ? ', neck and tail' : ' and neck'}, ${sol.summary.gait.toLowerCase()} at ${sol.summary.speed.toFixed(1)} m/s. Colour is activation, 0 to 1.`; renderMuscleMassPanel(); }
onSelectRequest(selectSolution);
function redrawAll() { readTheme(); fitCanvasToElement(stageCanvas); renderRampLegend(); selectSolution(current); renderCodesign(); renderFitPlot(); }
window.addEventListener('resize', () => { fitCanvasToElement(stageCanvas); renderHeatmap(); renderCostChart(); });
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', redrawAll);
new MutationObserver(redrawAll).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

// ---------- controls
document.querySelectorAll('[data-view]').forEach((btn) => btn.addEventListener('click', () => applyCameraView(btn.dataset.view)));
document.querySelectorAll('[data-anat]').forEach((btn) => btn.addEventListener('click', () => setAnatomyMode(btn.dataset.anat === '1')));
if (AnatomyRenderer && (DATA.model.anatomy || Object.values(DATA.models || {}).some((m) => m.anatomy))) document.getElementById('mode-anat-group').hidden = false;
const playButton = document.getElementById('play');
function setPlaying(shouldPlay) { setPlayingFlag(shouldPlay); playButton.textContent = shouldPlay ? 'Pause' : 'Play'; playButton.setAttribute('aria-pressed', String(shouldPlay)); }
setPlaying(playing); playButton.addEventListener('click', () => setPlaying(!playing));
const rateInput = document.getElementById('rate'); rateInput.addEventListener('input', () => { setPlayRate(+rateInput.value); document.getElementById('rate-v').textContent = playRate.toFixed(2) + '×'; });

// ---------- init
const modeSwitchActive = setupModeSwitch();
renderRampLegend(); if (!modeSwitchActive) { renderFindings(); renderCodesign(); renderSensitivities(); renderFitPlot(); renderDof6Panel(); } renderVariants(); selectSolution(current);
requestAnimationFrame((t) => { setLastTick(t); animationTick(t); });
