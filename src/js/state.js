// Shared data + viewer state. Imports only the data (with the character list it merges by) and the pure body merge (bodies.js);
// every other module reads from here.
// Mutable cross-module state is reassigned only through the setters below
// (ESM live bindings are read-only to importers).

import dataset from '../data.json';
import { CHARACTERS } from '../../sim/characters.js';
import { addBody } from './bodies.js';
// the humanoid body packs from sim/build-biped.mjs (src/data/<file>), merged in the order of sim/characters.js
const packFiles = import.meta.glob('../data/*.json', { eager: true, import: 'default' });
export const DATA = Object.values(CHARACTERS).reduce((data, c) => addBody(data, packFiles[`../data/${c.file}`]), dataset);
export const defaultModel = DATA.model, solutions = DATA.solutions;
export const modelFor = (sol) => (sol && DATA.models && DATA.models[sol.summary.model]) || DATA.model;
export const isSpecialSolution = (sol) => sol.summary.codesign || sol.summary.dof6 || sol.summary.variant;
const rootComputedStyle = getComputedStyle(document.documentElement);
export const readCssVar = (name) => rootComputedStyle.getPropertyValue(name).trim();
export let theme = {};
export function readTheme() { const get = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  theme = { surface: get('--surface'), surface2: get('--surface-2'), ink: get('--ink'), ink2: get('--ink-2'), muted: get('--muted'), rule: get('--rule'), accent: get('--accent'), bone: get('--bone'), boneFar: get('--bone-far'), grf: get('--grf'), paw: get('--paw'), grid: get('--grid'), up: get('--up'), down: get('--down'),
    ramp: [get('--m0'), get('--m1'), get('--m2'), get('--m3'), get('--m4')] }; }
readTheme();
export const GAIT_FAMILIES = [['walk', 'Walk', '--s1', 'circle'], ['trot', 'Trot', '--s2', 'square'], ['pace', 'Pace', '--s3', 'diamond'], ['canter', 'Canter', '--s4', 'triangle'], ['gallop', 'Gallop', '--s5', 'tri-down'], ['bound', 'Bound', '--s6', 'cross'], ['pronk', 'Pronk', '--s7', 'star'], ['other', 'Irregular', '--s8', 'circle-open']];
export const familyIndex = Object.fromEntries(GAIT_FAMILIES.map((fam, i) => [fam[0], i]));
export const classifyGaitFamily = (gait) => { gait = (gait || '').toLowerCase(); for (const key of ['gallop', 'canter', 'bound', 'pronk', 'trot', 'pace', 'walk']) if (gait.includes(key)) return key; return 'other'; };
export const familyColor = (fam) => readCssVar(GAIT_FAMILIES[familyIndex[fam]][2]);
export const titleCase = (text) => text.replace(/(^|\s)\S/g, (s) => s.toUpperCase());
solutions.forEach((sol, i) => { sol.id = i; sol.fam = classifyGaitFamily(sol.summary.gait); });
export const speeds = [...new Set(solutions.map((sol) => sol.summary.speed))].sort((a, b) => a - b);
export const bestSolutionAtSpeed = {};
speeds.forEach((v) => { bestSolutionAtSpeed[v] = solutions.filter((sol) => sol.summary.speed === v && !isSpecialSolution(sol)).reduce((a, b) => (b.summary.cot < a.summary.cot ? b : a), solutions.find((sol) => sol.summary.speed === v && !isSpecialSolution(sol)) || solutions.find((sol) => sol.summary.speed === v)); });
const boneIndexCache = new Map();
export const boneIndexFor = (model) => { if (!boneIndexCache.has(model)) boneIndexCache.set(model, Object.fromEntries(model.bones.map((b, i) => [b.name, i]))); return boneIndexCache.get(model); };
export const legCodeOf = (name) => (/^([LRC][FH1-9])_/.exec(name) || [])[1] || '';
// left-side labels: F / H for the corner legs, M1.. for the middle pairs of a many-legged body;
// a biped's limbs are unambiguous (arm or leg), so its labels drop the code
export const legLabel = (name, model) => (model && model.biped ? name.replace(/^[LC][FH]_/, '')
  : name.replace(/^[LC]([FH])_/, '$1 ').replace(/^L([1-9])_/, 'M$1 '));
export const isRight = (name) => /^R[FH1-9]_/.test(name);

export function hexToRgb(hex) { hex = hex.replace('#', ''); if (hex.length === 3) hex = hex.split('').map((c) => c + c).join(''); const num = parseInt(hex, 16); return [num >> 16 & 255, num >> 8 & 255, num & 255]; }
export function activationColor(a) { a = Math.max(0, Math.min(1, a)); const stops = theme.ramp.map(hexToRgb); const x = a * (stops.length - 1); const k = Math.min(Math.floor(x), stops.length - 2); const w = x - k; const c = stops[k].map((v, j) => Math.round(v + (stops[k + 1][j] - v) * w)); return `rgb(${c[0]},${c[1]},${c[2]})`; }

// ---------- mutable viewer state (reassigned via setters)
export let current = bestSolutionAtSpeed[speeds[Math.min(1, speeds.length - 1)]];
export function setCurrent(sol) { current = sol; }
export let playing = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
export function setPlayingFlag(p) { playing = p; }
export let playRate = 0.35;
export function setPlayRate(r) { playRate = r; }
export let stridePhase = 0;
export function setStridePhase(p) { stridePhase = p; }
export let lastTickMs = performance.now();
export function setLastTick(t) { lastTickMs = t; }
export const orbitCam = { az: 0.62, el: 0.24, dist: 1.75 };
export const VIEW_PRESETS = { three: [0.62, 0.28], side: [0.0, 0.08], front: [1.5708, 0.12], top: [0.0, 1.45] };
export let anatomyOn = false;
export function setAnatomyOn(on) { anatomyOn = on; }

// ---------- selection hub (avoids a main <-> panels import cycle)
let selectHandler = null;
export function onSelectRequest(fn) { selectHandler = fn; }
export function requestSelect(sol) { if (selectHandler) selectHandler(sol); }
