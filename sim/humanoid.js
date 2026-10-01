// Test biped: a humanoid body. Geometry is authored for an adult 1.75 m tall
// (segment lengths, masses and centres of mass after de Leva 1996) and scaled
// to the requested height; muscle strengths come from adult lower-limb
// (Rajagopal et al. 2016) and upper-limb (Holzbaur et al. 2005) models,
// scaled by mass / height (muscle volume scales with body mass). Shape options
// (see buildHumanoid) change proportions, breadth, fat and muscle per region,
// for the test biped's variants (sim/characters.js).
//
// Frames: every segment's body frame is world-aligned in the standing reference
// posture (x forward, y up, z left); coordinates below are for the LEFT side and
// are mirrored (z -> -z) for the right. Joint-angle signs, left side:
//   hip/shoulder rz + flexion, rx + adduction, ry + internal rotation
//   knee rz + extension (flexion is negative), elbow/wrist rz + flexion
//   ankle rz + dorsiflexion, rx + inversion; spine/neck rz + extension, rx + left bend, ry + turn right
import { Body, ellipsoidInertia, cylinderInertiaY } from './body.js';

const H_REF = 1.75, M_REF = 75;
const SPINE = ['rz', 'rx', 'ry'];

// adult reference joint ranges (deg, left side) and passive stiffness (Nm/rad, adult)
const JOINTS = {
  lumbar: { axes: SPINE, lo: [-20, -10, -5], hi: [15, 10, 5], K: 150, notes: 'lumbosacral + lower lumbar; rz + extension' },
  thoracolumbar: { axes: SPINE, lo: [-25, -15, -15], hi: [15, 15, 15], K: 120, notes: 'upper lumbar + thoracic; rz + extension' },
  neck_base: { axes: SPINE, lo: [-40, -30, -45], hi: [40, 30, 45], K: 10, notes: 'lower cervical (C7/T1)' },
  atlas: { axes: SPINE, lo: [-25, -10, -40], hi: [20, 10, 40], K: 5, notes: 'atlanto-occipital + atlanto-axial' },
  shoulder: { axes: ['rz', 'rx', 'ry'], lo: [-60, -120, -60], hi: [170, 20, 70], K: 4, notes: 'glenohumeral; scapula moves with the thorax' },
  elbow: { axes: ['rz'], lo: [-5], hi: [145], K: 3, notes: '' },
  wrist: { axes: ['rz'], lo: [-70], hi: [80], K: 2, notes: '' },
  hip: { axes: ['rz', 'rx', 'ry'], lo: [-20, -45, -45], hi: [120, 25, 40], K: 8, couple: { axes: ['rz', 'rx'], p: 4 }, notes: 'flexion x adduction is one rounded range (superellipse, p = 4)' },
  knee: { axes: ['rz'], lo: [-140], hi: [5], K: 3, notes: 'hinge; flexion negative' },
  ankle: { axes: ['rz', 'rx'], lo: [-50, -20], hi: [25, 30], K: 5, notes: 'talocrural (rz) + subtalar (rx)' },
  mtp: { axes: ['rz'], lo: [-30], hi: [70], K: 1, notes: 'toes follow the ground (kinematic); ground load is carried by the foot' },
};

// adult reference muscles, left side: path points are [segment, [x, y, z]] in body frames (m).
// F0 (N), rf = fibre share of the muscle-tendon length when standing, pen (deg), ft = fast-twitch fraction
const MUSCLES = [
  // ---- trunk (pelvis -> lumbar -> thorax)
  ['erector_spinae', 'spine', 2500, 0.7, 0, 0.5, [['pelvis', [-0.09, 0.08, 0.03]], ['lumbar', [-0.06, 0.09, 0.03]], ['thorax', [-0.065, 0.10, 0.035]]]],
  ['rectus_abdominis', 'spine', 600, 0.9, 0, 0.5, [['pelvis', [0.055, -0.03, 0.02]], ['lumbar', [0.13, 0.08, 0.035]], ['thorax', [0.12, 0.07, 0.05]]]],
  ['ext_oblique', 'spine', 900, 0.7, 0, 0.5, [['thorax', [0.03, 0.06, 0.135]], ['lumbar', [0.09, 0.13, 0.09]], ['pelvis', [0.07, 0.03, 0.03]]]],
  ['int_oblique', 'spine', 800, 0.7, 0, 0.5, [['pelvis', [0.0, 0.10, 0.13]], ['lumbar', [0.08, 0.10, 0.09]], ['thorax', [0.10, 0.03, 0.05]]]],
  ['quadratus_lumborum', 'spine', 450, 0.7, 0, 0.5, [['pelvis', [-0.05, 0.10, 0.075]], ['lumbar', [-0.02, 0.10, 0.06]], ['thorax', [-0.03, 0.02, 0.06]]]],
  // ---- neck (thorax -> neck -> head)
  ['splenius', 'neck', 170, 0.8, 0, 0.5, [['thorax', [-0.08, 0.27, 0.0]], ['neck', [-0.04, 0.06, 0.02]], ['head', [-0.05, 0.02, 0.045]]]],
  ['semispinalis', 'neck', 230, 0.8, 0, 0.5, [['thorax', [-0.07, 0.25, 0.02]], ['neck', [-0.05, 0.05, 0.015]], ['head', [-0.065, 0.03, 0.02]]]],
  // deep cervical extensor (semispinalis cervicis / longissimus cervicis): extends the neck without tipping the head back
  ['semispinalis_cervicis', 'neck', 200, 0.8, 0, 0.5, [['thorax', [-0.075, 0.24, 0.015]], ['neck', [-0.045, 0.075, 0.01]]]],
  ['sternocleidomastoid', 'neck', 150, 0.8, 0, 0.5, [['thorax', [0.11, 0.265, 0.025]], ['head', [-0.03, 0.01, 0.05]]]],
  ['longus_colli', 'neck', 90, 0.8, 0, 0.5, [['thorax', [0.02, 0.25, 0.01]], ['neck', [0.035, 0.08, 0.01]]]],
  ['longus_capitis', 'neck', 150, 0.8, 0, 0.5, [['neck', [0.035, 0.03, 0.01]], ['head', [0.045, -0.005, 0.01]]]],
  // ---- arm (thorax -> humerus -> antebrachium -> manus); the scapula is part of the thorax
  ['LF_deltoid_ant', 'fore-prox', 800, 0.5, 22, 0.5, [['thorax', [0.05, 0.26, 0.15]], ['thorax', [0.05, 0.24, 0.19]], ['LF_humerus', [0.012, -0.13, 0.012]]]],
  ['LF_deltoid_mid', 'fore-prox', 1100, 0.5, 15, 0.5, [['thorax', [0.01, 0.265, 0.19]], ['thorax', [0.01, 0.235, 0.215]], ['LF_humerus', [0.0, -0.13, 0.016]]]],
  ['LF_deltoid_post', 'fore-prox', 600, 0.7, 18, 0.5, [['thorax', [-0.06, 0.25, 0.14]], ['thorax', [-0.03, 0.24, 0.19]], ['LF_humerus', [-0.01, -0.13, 0.012]]]],
  ['LF_pectoralis', 'fore-prox', 1270, 0.6, 17, 0.5, [['thorax', [0.13, 0.17, 0.02]], ['thorax', [0.08, 0.20, 0.13]], ['LF_humerus', [0.015, -0.06, 0.005]]]],
  ['LF_latissimus', 'fore-prox', 1060, 0.6, 25, 0.5, [['thorax', [-0.09, 0.02, 0.05]], ['thorax', [-0.04, 0.13, 0.145]], ['LF_humerus', [0.012, -0.06, -0.005]]]],
  ['LF_infraspinatus', 'fore-prox', 1200, 0.5, 18, 0.5, [['thorax', [-0.08, 0.19, 0.12]], ['LF_humerus', [-0.015, -0.005, 0.02]]]],
  ['LF_subscapularis', 'fore-prox', 1380, 0.5, 20, 0.5, [['thorax', [-0.05, 0.18, 0.10]], ['thorax', [0.0, 0.20, 0.14]], ['LF_humerus', [0.02, -0.01, -0.005]]]],
  ['LF_biceps', 'fore-dist', 1060, 0.35, 0, 0.5, [['thorax', [0.03, 0.245, 0.16]], ['LF_humerus', [0.025, -0.02, 0.0]], ['LF_humerus', [0.025, -0.25, 0.0]], ['LF_antebrachium', [0.015, -0.035, 0.0]]]],
  ['LF_triceps_long', 'fore-dist', 800, 0.5, 10, 0.5, [['thorax', [-0.015, 0.21, 0.165]], ['LF_humerus', [-0.028, -0.22, 0.0]], ['LF_antebrachium', [-0.022, 0.02, 0.0]]]],
  ['LF_triceps_lat', 'fore-dist', 1250, 0.5, 9, 0.5, [['LF_humerus', [-0.012, -0.10, 0.008]], ['LF_humerus', [-0.028, -0.22, 0.0]], ['LF_antebrachium', [-0.022, 0.02, 0.0]]]],
  ['LF_brachialis', 'fore-dist', 990, 0.6, 0, 0.5, [['LF_humerus', [0.012, -0.17, 0.0]], ['LF_humerus', [0.022, -0.25, 0.0]], ['LF_antebrachium', [0.012, -0.03, 0.0]]]],
  ['LF_wrist_flexors', 'fore-dist', 890, 0.25, 3, 0.5, [['LF_antebrachium', [0.012, -0.02, -0.01]], ['LF_antebrachium', [0.012, -0.25, 0.0]], ['LF_manus', [0.01, -0.03, 0.0]]]],
  ['LF_wrist_extensors', 'fore-dist', 600, 0.3, 3, 0.5, [['LF_antebrachium', [-0.012, -0.02, 0.01]], ['LF_antebrachium', [-0.012, -0.25, 0.0]], ['LF_manus', [-0.01, -0.03, 0.0]]]],
  // ---- leg (pelvis -> femur -> tibia -> pes)
  ['LH_gluteus_maximus', 'hind-prox', 3300, 0.6, 20, 0.5, [['pelvis', [-0.10, 0.06, 0.04]], ['pelvis', [-0.085, -0.03, 0.10]], ['LH_femur', [-0.02, -0.08, 0.035]]]],
  ['LH_gluteus_medius_ant', 'hind-prox', 1350, 0.5, 19, 0.5, [['pelvis', [0.03, 0.09, 0.12]], ['LH_femur', [-0.01, -0.03, 0.065]]]],
  ['LH_gluteus_medius_post', 'hind-prox', 1350, 0.5, 19, 0.5, [['pelvis', [-0.06, 0.08, 0.125]], ['LH_femur', [-0.01, -0.03, 0.065]]]],
  ['LH_iliopsoas', 'hind-prox', 2400, 0.5, 12, 0.5, [['pelvis', [0.02, 0.07, 0.07]], ['pelvis', [0.045, -0.01, 0.075]], ['LH_femur', [-0.005, -0.06, -0.01]]]],
  ['LH_adductor_longus', 'hind-prox', 1000, 0.6, 7, 0.5, [['pelvis', [0.035, -0.035, 0.025]], ['LH_femur', [-0.015, -0.22, 0.0]]]],
  ['LH_adductor_magnus', 'hind-prox', 3000, 0.55, 12, 0.5, [['pelvis', [-0.03, -0.07, 0.03]], ['LH_femur', [-0.01, -0.39, -0.025]]]],
  ['LH_tensor_fasciae_latae', 'hind-prox', 400, 0.2, 3, 0.5, [['pelvis', [0.05, 0.075, 0.115]], ['LH_femur', [0.01, -0.05, 0.075]], ['LH_femur', [0.0, -0.40, 0.04]]]],
  ['LH_piriformis', 'hind-prox', 450, 0.25, 10, 0.5, [['pelvis', [-0.09, 0.03, 0.02]], ['LH_femur', [-0.005, -0.02, 0.06]]]],
  ['LH_hamstrings', 'hind-prox', 3500, 0.18, 12, 0.55, [['pelvis', [-0.06, -0.06, 0.065]], ['LH_femur', [-0.04, -0.37, 0.0]], ['LH_tibia', [-0.03, -0.05, 0.0]]]],
  ['LH_rectus_femoris', 'hind-prox', 1200, 0.10, 12, 0.6, [['pelvis', [0.04, 0.035, 0.10]], ['LH_femur', [0.045, -0.38, 0.0]], ['LH_tibia', [0.05, 0.02, 0.0]], ['LH_tibia', [0.035, -0.06, 0.0]]]],
  ['LH_biceps_femoris_sh', 'hind-dist', 550, 0.6, 23, 0.5, [['LH_femur', [-0.025, -0.25, 0.015]], ['LH_tibia', [-0.03, -0.045, 0.03]]]],
  ['LH_vasti', 'hind-dist', 8000, 0.22, 5, 0.5, [['LH_femur', [0.03, -0.20, 0.01]], ['LH_femur', [0.045, -0.38, 0.0]], ['LH_tibia', [0.05, 0.02, 0.0]], ['LH_tibia', [0.035, -0.06, 0.0]]]],
  ['LH_gastrocnemius', 'hind-dist', 4700, 0.11, 12, 0.5, [['LH_femur', [-0.025, -0.40, 0.0]], ['LH_tibia', [-0.03, -0.06, 0.0]], ['LH_pes', [-0.055, -0.03, -0.005]]]],
  ['LH_soleus', 'hind-dist', 6000, 0.10, 25, 0.2, [['LH_tibia', [-0.02, -0.12, 0.0]], ['LH_pes', [-0.055, -0.03, -0.005]]]],
  ['LH_tibialis_anterior', 'hind-dist', 1200, 0.26, 10, 0.27, [['LH_tibia', [0.02, -0.12, 0.01]], ['LH_tibia', [0.035, -0.40, -0.005]], ['LH_pes', [0.07, -0.03, -0.02]]]],
  ['LH_tibialis_posterior', 'hind-dist', 1800, 0.1, 14, 0.4, [['LH_tibia', [-0.01, -0.15, 0.0]], ['LH_tibia', [-0.02, -0.42, -0.025]], ['LH_pes', [0.04, -0.05, -0.025]]]],
  ['LH_peroneus', 'hind-dist', 1500, 0.14, 12, 0.4, [['LH_tibia', [-0.005, -0.12, 0.03]], ['LH_tibia', [-0.02, -0.425, 0.03]], ['LH_pes', [0.06, -0.055, 0.03]]]],
];

// normalized fibre length (l / lopt) when standing; 1 unless listed. Knee extensors are short with the
// knee straight and reach their optimum part-way into flexion; hip extensors and soleus sit a little short.
const STANDING_FIBRE_LENGTH = { LH_vasti: 0.65, LH_rectus_femoris: 0.7, LH_hamstrings: 0.85, LH_gluteus_maximus: 0.85, LH_soleus: 0.8, LH_gastrocnemius: 0.95 };

const SPECIFIC_TENSION = 0.6e6;     // Pa (Rajagopal et al. 2016)
const MUSCLE_DENSITY = 1060;        // kg/m^3

// reference segments (adult, left side; the right side mirrors them): name, parent, joint [JOINTS key, joint name,
// position in the parent frame], de Leva mass fraction, centre of mass, inertia ['ell', semi-axes] or ['cyl', radius,
// length], drawn bones [name, from, to, radius]
const SEGMENTS = [
  ['pelvis', null, null, 0.1117, [-0.02, 0.05, 0], ['ell', [0.08, 0.07, 0.14]], [
    ['pelvis', [-0.06, 0.0, 0], [-0.035, 0.095, 0], 0.02],
    ['LH_ilium', [-0.05, 0.06, 0], [0, 0, 0.085], 0.012], ['RH_ilium', [-0.05, 0.06, 0], [0, 0, -0.085], 0.012],
    ['LH_pubis', [0, 0, 0.085], [0.05, -0.035, 0], 0.01], ['RH_pubis', [0, 0, -0.085], [0.05, -0.035, 0], 0.01]]],
  ['lumbar', 'pelvis', ['lumbar', 'lumbar', [-0.035, 0.095, 0]], 0.1633, [0.03, 0.09, 0], ['ell', [0.10, 0.10, 0.14]], [['lumbar', [0, 0, 0], [0.01, 0.175, 0], 0.018]]],
  ['thorax', 'lumbar', ['thoracolumbar', 'thoracolumbar', [0.01, 0.175, 0]], 0.1596, [0.04, 0.15, 0], ['ell', [0.10, 0.15, 0.15]], [
    ['thorax', [0, 0, 0], [-0.02, 0.29, 0], 0.018],
    ['LF_clavicle', [0.11, 0.265, 0.02], [0.01, 0.26, 0.17], 0.008], ['RF_clavicle', [0.11, 0.265, -0.02], [0.01, 0.26, -0.17], 0.008]]],
  ['neck', 'thorax', ['neck_base', 'neck_base', [-0.02, 0.29, 0]], 0.012, [0.015, 0.055, 0], ['cyl', 0.05, 0.11], [['neck', [0, 0, 0], [0.03, 0.11, 0], 0.012]]],
  ['head', 'neck', ['atlas', 'atlas', [0.03, 0.11, 0]], 0.0574, [0.02, 0.07, 0], ['ell', [0.095, 0.11, 0.08]], [['head', [0, 0, 0], [0.11, 0.02, 0], 0.02]]],
  ['LF_humerus', 'thorax', ['shoulder', 'LF_shoulder', [0.01, 0.23, 0.175]], 0.0271, [0, -0.163, 0], ['cyl', 0.045, 0.2817], [['LF_humerus', [0, 0, 0], [0, -0.2817, 0], 0.012]]],
  ['LF_antebrachium', 'LF_humerus', ['elbow', 'LF_elbow', [0, -0.2817, 0]], 0.0162, [0, -0.123, 0], ['cyl', 0.035, 0.2689], [['LF_antebrachium', [0, 0, 0], [0, -0.2689, 0], 0.01]]],
  ['LF_manus', 'LF_antebrachium', ['wrist', 'LF_wrist', [0, -0.2689, 0]], 0.0061, [0, -0.07, 0], ['ell', [0.02, 0.07, 0.04]], [['LF_manus', [0, 0, 0], [0, -0.17, 0], 0.008]]],
  ['LH_femur', 'pelvis', ['hip', 'LH_hip', [0, 0, 0.085]], 0.1416, [0, -0.173, 0], ['cyl', 0.075, 0.4222], [['LH_femur', [0, 0, 0], [0, -0.4222, 0], 0.014]]],
  ['LH_tibia', 'LH_femur', ['knee', 'LH_knee', [0, -0.4222, 0]], 0.0433, [0, -0.194, 0], ['cyl', 0.05, 0.434], [['LH_tibia', [0, 0, 0], [0, -0.434, 0], 0.013]]],
  ['LH_pes', 'LH_tibia', ['ankle', 'LH_ankle', [0, -0.434, 0]], 0.0125, [0.05, -0.045, 0], ['ell', [0.11, 0.03, 0.045]], [
    [`LH_pes`, [0, 0, 0], [0.145, -0.052, 0], 0.01], ['LH_calcaneus', [0, 0, 0], [-0.045, -0.05, 0], 0.01]]],
  ['LH_digits', 'LH_pes', ['mtp', 'LH_mtp', [0.145, -0.052, 0]], 0.0012, [0.025, -0.006, 0], ['ell', [0.03, 0.008, 0.04]], [['LH_digits', [0, 0, 0], [0.055, -0.006, 0], 0.007]]],
];
const SOLE_Y = -0.065, SKULL = { center: [0.015, 0.075, 0], radius: 0.092 };

// drawn outline: skin and fat as capsules [from, to, radius] per segment (left side; not in the dynamics)
const OUTLINE = {
  pelvis: [[[-0.02, 0.03, 0.07], [-0.02, 0.03, -0.07], 0.1]],
  lumbar: [[[0.035, 0.0, 0.05], [0.035, 0.16, 0.055], 0.09], [[0.035, 0.0, -0.05], [0.035, 0.16, -0.055], 0.09]],
  thorax: [[[0.035, 0.02, 0.06], [0.015, 0.22, 0.075], 0.1], [[0.035, 0.02, -0.06], [0.015, 0.22, -0.075], 0.1]],
  neck: [[[0, 0, 0], [0.03, 0.11, 0], 0.05]],
  head: [[SKULL.center, SKULL.center, SKULL.radius + 0.008]],
  LF_humerus: [[[0, -0.02, 0], [0, -0.26, 0], 0.043]],
  LF_antebrachium: [[[0, -0.02, 0], [0, -0.12, 0], 0.037], [[0, -0.12, 0], [0, -0.25, 0], 0.027]],
  LF_manus: [[[0, -0.02, 0], [0, -0.12, 0], 0.027]],
  LH_femur: [[[0, -0.03, 0], [0, -0.2, 0], 0.075], [[0, -0.2, 0], [0, -0.39, 0], 0.058]],
  LH_tibia: [[[0, -0.03, 0], [0, -0.2, 0], 0.05], [[0, -0.2, 0], [0, -0.40, 0], 0.035]],
  LH_pes: [[[-0.03, -0.035, 0], [0.13, -0.045, 0], 0.03]],
  LH_digits: [[[0, -0.006, 0], [0.045, -0.006, 0], 0.02]],
};
const FAT_DENSITY = 900;            // kg/m^3
// the stride-parameter bounds in gait.js were set for the default test body; other bodies scale them by leg length
const GAIT_REFERENCE_HEIGHT = 1.32;

const limbName = (name, side) => (side === 'R' ? name.replace(/^L([FH]_)/, 'R$1') : name);
const baseName = (name) => name.replace(/^R([FH]_)/, 'L$1');
// body region of a segment: which length option scales it, and which fat and girth options apply
const regionOf = (name) => { const b = baseName(name);
  return /^(pelvis|lumbar|thorax)$/.test(b) ? 'trunk' : b === 'neck' ? 'neck' : b === 'head' ? 'head' : /^LF_/.test(b) ? 'arms' : /femur|tibia/.test(b) ? 'legs' : 'feet'; };
const FAT_REGION = { pelvis: 'hips', lumbar: 'belly', thorax: 'chest', LF_humerus: 'arms', LF_antebrachium: 'arms', LF_manus: 'arms', LH_femur: 'legs', LH_tibia: 'legs' };
const TRUNK_GIRTH = { pelvis: 'hips', lumbar: 'waist', thorax: 'chest' };
const MUSCLE_REGION = { spine: 'spine', neck: 'neck', fore: 'arms', hind: 'legs' };

// Shape options (1 = the adult reference; defaults give the reference shape exactly):
//   legs, arms, trunk, neck, head   segment lengths of each region relative to the reference proportions
//   feet                            foot length and breadth
//   width                           breadth and depth of trunk and limbs (hips, shoulders, moment arms, flesh)
//   girth                           extra breadth per region: { hips, waist, chest (or trunk for all three), neck, arms, legs }
//   shoulders                       shoulder joints and girdle: { width (x), height, forward (reference m) }
//   neckBase                        where the neck leaves the ribcage: { height, forward (reference m) }
//   spineRange, neckRange           range of motion of the spine and neck joints (x)
//   fat                             extra mass per region as a multiple of its lean mass: { hips, belly, chest, arms, legs };
//                                   belly fat hangs in front of the abdomen and moves the trunk's centre of mass forward
//   muscle                          muscle volume per kg of lean mass: a number, or per region { spine, neck, arms, legs }
//   armAbduction                    how far the arms are held out from the sides (deg)
//   softPairs                       extra soft-tissue pairs that must not interpenetrate [segA, radiusA, segB, radiusB] (reference m)
// The overall scale is set so the standing height is `height`; `mass` is the total body mass. `style` is how the
// character moves (parameter ranges and constants for the stride; see familyBounds and generateGait in gait.js).
export function buildHumanoid({ mass = 30, height = 1.32, name = 'biped', legs = 1, arms = 1, trunk = 1, neck = 1, head = 1, feet: feetSize = 1, width = 1, girth = {},
  shoulders = {}, neckBase = {}, spineRange = 1, neckRange = 1, fat = {}, muscle = 1, armAbduction = null, softPairs = [], style = null } = {}) {
  const shape = { legs, arms, trunk, neck, head, feet: feetSize, width, girth, shoulders, neckBase, spineRange, neckRange, fat, muscle, armAbduction, softPairs };
  // per-segment scale [fore-aft, up, lateral] for an overall scale s
  const factors = (lens) => (seg) => { const r = regionOf(seg), b = baseName(seg), g = lens.girth || {};
    const W = lens.width * (r === 'trunk' ? g[TRUNK_GIRTH[b]] ?? g.trunk ?? 1 : g[r] ?? 1);
    return r === 'trunk' ? [W, lens.trunk, W] : r === 'neck' ? [W, lens.neck, W] : r === 'head' ? [lens.head, lens.head, lens.head] : r === 'arms' ? [W, lens.arms, W] : r === 'legs' ? [W, lens.legs, W] : [lens.feet, 1, W * lens.feet]; };
  const scaler = (lens, s, fac = factors) => { const f = fac(lens); return (seg) => { const k = f(seg).map((v) => s * v); return (v) => [v[0] * k[0], v[1] * k[1], v[2] * k[2]]; }; };
  // muscle attachments on the limbs scale with limb length, not girth or foot size: girth is soft tissue, and this
  // keeps each limb muscle's moment arms in proportion to its fibre length (otherwise a short, thick limb stretches
  // its muscles far past their working range for small joint turns)
  const muscleFactors = (lens) => (seg) => { const r = regionOf(seg); return r === 'arms' ? [lens.arms, lens.arms, lens.arms] : r === 'legs' || r === 'feet' ? [lens.legs, lens.legs, lens.legs] : factors(lens)(seg); };
  const NEUTRAL = { legs: 1, arms: 1, trunk: 1, neck: 1, head: 1, feet: 1, width: 1 };
  // points on the ribcage that move with the shoulders (joints, clavicles, arm-muscle attachments out to the side)
  // or with the neck base (neck joint, top of the thoracic spine, neck-muscle attachments), in reference coordinates
  const sh = { width: 1, height: 0, forward: 0, ...shoulders }, nb = { height: 0, forward: 0, ...neckBase };
  const remap = (kind, v) => (kind === 'girdle' ? [v[0] + sh.forward, v[1] + sh.height, v[2] * sh.width] : kind === 'neck' ? [v[0] + nb.forward, v[1] + nb.height, v[2]] : v);
  const same = (kind, v) => v;
  const mirror = (v) => [v[0], v[1], -v[2]];
  const allSegments = (fn) => { SEGMENTS.slice(0, 5).forEach((row) => fn(row, '')); for (const side of ['L', 'R']) SEGMENTS.slice(5).forEach((row) => fn(row, side)); };
  const jointKind = (segName) => (/humerus/.test(segName) ? 'girdle' : segName === 'neck' ? 'neck' : null);
  const jointAt = (P, rm, [segName, parent, joint], side) => P(limbName(parent, side))(rm(jointKind(segName), side === 'R' && !/^L[FH]_/.test(parent) ? mirror(joint[2]) : joint[2]));
  // standing reference posture: every frame world-aligned, so a segment's origin is the sum of the joint offsets above it
  const origins = (P, rm) => { const o = {};
    allSegments((row, side) => { const n = limbName(row[0], side);
      if (!row[1]) { o[n] = [0, 0, 0]; return; }
      const par = limbName(row[1], side), at = jointAt(P, rm, row, side);
      o[n] = [o[par][0] + at[0], o[par][1] + at[1], o[par][2] + at[2]]; });
    return o; };
  const standingHeight = (P, rm) => { const o = origins(P, rm), top = o.head[1] + P('head')([0, SKULL.center[1] + SKULL.radius, 0])[1];
    return top - (o.LH_pes[1] + P('LH_pes')([0, SOLE_Y, 0])[1]); };
  const s = (height / H_REF) * (standingHeight(scaler(NEUTRAL, 1), same) / standingHeight(scaler(shape, 1), remap));
  const P = scaler(shape, s);
  const strength = (mass / M_REF) / s, stiff = (mass / M_REF) * s;     // F0 ~ M/L, joint torque ~ M*L
  const fatOf = (seg) => fat[FAT_REGION[baseName(seg)]] || 1;
  const muscleOf = (region) => (typeof muscle === 'number' ? muscle : muscle[MUSCLE_REGION[region]] ?? 1);

  // segment masses: de Leva fractions weighted by each segment's volume change (length x breadth x depth) and its fat
  const volume = (seg) => { const f = factors(shape)(seg); return f[0] * f[1] * f[2]; };
  const lean = {}, total = {}; let sumTotal = 0;
  allSegments(([segName, , , fr], side) => { const n = limbName(segName, side); lean[n] = fr * volume(n); total[n] = lean[n] * fatOf(n); sumTotal += total[n]; });
  const massOf = (seg) => mass * total[seg] / sumTotal;
  // muscle volume per region follows the region's lean mass
  const REGION_SEGS = { spine: ['pelvis', 'lumbar', 'thorax'], neck: ['neck', 'head'], fore: ['LF_humerus', 'LF_antebrachium', 'LF_manus'], hind: ['LH_femur', 'LH_tibia', 'LH_pes', 'LH_digits'] };
  const deLeva = Object.fromEntries(SEGMENTS.map((row) => [row[0], row[3]]));
  const leanRatio = Object.fromEntries(Object.entries(REGION_SEGS).map(([r, segs]) => [r, (segs.reduce((a, n) => a + lean[n], 0) / sumTotal) / segs.reduce((a, n) => a + deLeva[n], 0)]));

  const jointOf = (key, side, name, at) => {
    const j = JOINTS[key], sgn = side === 'R' ? -1 : 1, k = /lumbar/.test(key) ? spineRange : /neck_base|atlas/.test(key) ? neckRange : 1;
    // right side: roll and yaw ranges mirror
    const lo = j.axes.map((a, i) => (sgn < 0 && a !== 'rz' ? -j.hi[i] : j.lo[i]) * k), hi = j.axes.map((a, i) => (sgn < 0 && a !== 'rz' ? -j.lo[i] : j.hi[i]) * k);
    return { name, at, axes: j.axes, lo, hi, K: j.axes.map(() => j.K * stiff), rest: j.axes.map(() => 0), couple: j.couple, notes: j.notes };
  };
  // belly fat: a ball holding the lumbar segment's fat, sunk into the front of the abdomen
  const bellyFat = massOf('lumbar') * (1 - 1 / fatOf('lumbar')), bellyR = Math.cbrt(3 * bellyFat / FAT_DENSITY / (4 * Math.PI));
  const belly = bellyFat > 0 ? [P('lumbar')([0.125, 0, 0])[0] - 0.25 * bellyR, P('lumbar')([0, 0.07, 0])[1], 0] : null;
  const boneKind = (bn) => (bn === 'thorax' ? 'neck' : /clavicle/.test(bn) ? 'girdle' : null);
  const segments = [];
  allSegments((row, side) => {
    const [segName, parent, joint, , com, inertia, bones] = row;
    const n = limbName(segName, side), Ps = P(n), m = massOf(n), f = factors(shape)(n), radial = Math.sqrt(fatOf(n));
    const cm = belly && n === 'lumbar' ? Ps(com).map((v, d) => v + (belly[d] - v) * bellyFat / m) : Ps(com);
    const I = inertia[0] === 'ell' ? ellipsoidInertia(m, Ps(inertia[1]).map((v, d) => (d === 1 ? v : v * radial))) : cylinderInertiaY(m, inertia[1] * s * f[0] * radial, inertia[2] * s * f[1]);
    const jt = joint && jointOf(joint[0], side, limbName(joint[1], side), jointAt(P, remap, row, side));
    segments.push({ name: n, parent: parent && limbName(parent, side), joint: jt, mass: m, com: cm, inertia: I,
      bones: bones.map(([bn, from, to, r]) => ({ name: limbName(bn, side), from: Ps(from), to: Ps(remap(boneKind(bn), to)), radius: r * s * f[2] })) });
  });

  // feet: sole geometry in the foot (pes) body frame, and the leg chain for IK
  const contactR = 0.012;
  const feet = {}, contacts = [];
  for (const side of ['L', 'R']) {
    const Hh = `${side}H_`, zs = side === 'L' ? 1 : -1, Pf = P(`${Hh}pes`);
    // sole points on the foot (heel, ball) and the toe tip on the digits segment (its frame starts at the MTP joint)
    feet[side] = { seg: `${Hh}pes`, toeSeg: `${Hh}digits`, thigh: `${Hh}femur`, shank: `${Hh}tibia`, hipAt: P('pelvis')([0, 0, 0.085 * zs]),
      L1: 0.4222 * s * legs, L2: 0.434 * s * legs, heel: Pf([-0.05, SOLE_Y, 0]), ball: Pf([0.145, SOLE_Y, 0]), toe: Pf([0.20, SOLE_Y, 0]), toeTip: P(`${Hh}digits`)([0.055, SOLE_Y + 0.052, 0]), halfWidth: 0.04 * s * width * feetSize, side: zs,
      dofs: { hip: `${Hh}hip`, knee: `${Hh}knee`, ankle: `${Hh}ankle`, mtp: `${Hh}mtp` } };
    contacts.push({ name: `${Hh}heel`, seg: `${Hh}pes`, point: Pf([-0.045, SOLE_Y + contactR, 0]), radius: contactR * s, foot: side, where: 'heel' },
      { name: `${Hh}ball`, seg: `${Hh}pes`, point: Pf([0.145, SOLE_Y + contactR, 0]), radius: contactR * s, foot: side, where: 'ball' });
  }

  // muscles: left from the table, right mirrored. Strength ~ muscle volume / fibre length: volume from the region's
  // lean mass, fibre length from how much the shape stretches the muscle's standing path
  const pointKind = (base, group, seg, pt) => (seg !== 'thorax' ? null : group === 'neck' ? 'neck' : /^LF_/.test(base) && Math.abs(pt[2]) >= 0.1 ? 'girdle' : null);
  const Pm = scaler(shape, s, muscleFactors);
  const standing = (Pq, Pmq, rm) => { const o = origins(Pq, rm); return (seg, pt, kind) => { const v = Pmq(seg)(rm(kind, pt)); return [o[seg][0] + v[0], o[seg][1] + v[1], o[seg][2] + v[2]]; }; };
  const shaped = standing(P, Pm, remap), neutral = standing(scaler(NEUTRAL, s), scaler(NEUTRAL, s, muscleFactors), same);
  const pathLength = (at, path) => path.slice(1).reduce((L, [seg, pt, kind], j) => { const a = at(...path[j]), b = at(seg, pt, kind); return L + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]); }, 0);
  const muscles = [];
  for (const side of ['L', 'R']) for (const [base, group, F0, rf, pen, ft, path] of MUSCLES) {
    const limb = /^L[FH]_/.test(base), name = limb ? base.replace(/^L/, side) : `${base}_${side}`;
    const segName = (seg) => (side === 'R' ? seg.replace(/^L([FH]_)/, 'R$1') : seg);
    const sided = path.map(([seg, pt]) => [segName(seg), side === 'R' ? mirror(pt) : pt, pointKind(base, group, seg, pt)]);
    const stretch = pathLength(shaped, sided) / pathLength(neutral, sided), region = group.split('-')[0];
    muscles.push({ name, group, F0: F0 * (strength * leanRatio[region] * muscleOf(region) / stretch), rf, pen: pen * Math.PI / 180, ft, standingLength: STANDING_FIBRE_LENGTH[base] || 1,
      path: sided.map(([seg, pt, kind]) => [seg, Pm(seg)(remap(kind, pt))]) });
  }

  // drawn outline, scaled so its volume matches the body mass; shoulder caps join the ribcage to the arms
  const refMass = M_REF * s * s * s * sumTotal, bulk = Math.sqrt(mass / refMass);
  const outline = [];
  allSegments(([segName], side) => { const n = limbName(segName, side), f = factors(shape)(n), Ps = P(n);
    const fatR = belly && n === 'lumbar' ? 1 : Math.sqrt(fatOf(n));    // the belly ball carries the lumbar fat
    for (const [from, to, r] of OUTLINE[segName] || []) outline.push([n, Ps(from), Ps(to), r * s * (n === 'head' ? head : f[2] * fatR * bulk)]); });
  for (const zs of [1, -1]) outline.push(['thorax', P('thorax')(remap('neck', [-0.01, 0.25, 0.04 * zs])), P('thorax')(remap('girdle', [0.01, 0.235, 0.16 * zs])), 0.05 * s * factors(shape)('thorax')[2] * Math.sqrt(fatOf('thorax')) * bulk]);
  if (belly) outline.push(['lumbar', belly, belly, bellyR]);

  const legLengthAt = (sc, lg) => 0.4222 * sc * lg + 0.434 * sc * lg - SOLE_Y * sc;
  const zScale = (seg) => factors(shape)(seg)[2];
  const spec = { name, height, segments, feet, contacts, muscles, shape, outline, style,
    arms: { L: { shoulder: 'LF_shoulder', elbow: 'LF_elbow', wrist: 'LF_wrist', side: 1 }, R: { shoulder: 'RF_shoulder', elbow: 'RF_elbow', wrist: 'RF_wrist', side: -1 } },
    spine: ['lumbar', 'thoracolumbar'], neck: ['neck_base', 'atlas'], head: 'head', thorax: 'thorax', eye: P('head')([0.09, 0.055, 0]), skull: { center: P('head')(SKULL.center), radius: SKULL.radius * s * head },
    wallStiffness: 200 * stiff, ribHalfWidth: 0.13 * s * zScale('thorax'), ribDepth: 0.14 * s * factors(shape)('thorax')[0], specificTension: SPECIFIC_TENSION, muscleDensity: MUSCLE_DENSITY,
    // leg length relative to the body the gait bounds were set for (gait.js scales stride lengths and frequencies by it)
    legScale: legLengthAt(s, legs) / legLengthAt(GAIT_REFERENCE_HEIGHT / H_REF, 1),
    armAbduction: armAbduction == null ? null : armAbduction * Math.PI / 180,
    // soft-tissue capsules that must not interpenetrate: [segA, radiusA, segB, radiusB] along each segment's first bone
    softPairs: [['LH_tibia', 0.04, 'RH_tibia', 0.04], ['LH_pes', 0.035, 'RH_pes', 0.035], ['LH_pes', 0.035, 'RH_tibia', 0.04], ['RH_pes', 0.035, 'LH_tibia', 0.04],
      ['LF_manus', 0.025, 'LH_femur', 0.07], ['RF_manus', 0.025, 'RH_femur', 0.07], ['LF_antebrachium', 0.03, 'LH_femur', 0.07], ['RF_antebrachium', 0.03, 'RH_femur', 0.07], ...softPairs]
      .map(([a, ra, b, rb]) => [a, ra * s * zScale(a) * Math.sqrt(fatOf(a)), b, rb * s * zScale(b) * Math.sqrt(fatOf(b))]),
  };
  return new Body(spec);
}

export const MUSCLE_TABLE = MUSCLES;
