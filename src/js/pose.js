// Pose interpolation + software camera. Imports state only.
import { defaultModel, modelFor, boneIndexFor } from './state.js';

export let boneIndex = boneIndexFor(defaultModel);

// ---------- pose interpolation
// A pose is one frame of bone rows; each row holds a 3x3 basis (r[0..8])
// plus the bone origin (r[9..11]). Index 9 is the forward position, which
// wraps by one stride length when the stride loops.
export function poseAtPhase(sol, phase) {
  boneIndex = boneIndexFor(modelFor(sol));
  const frames = sol.poses, frameCount = frames.length, x = phase * frameCount, frame = Math.floor(x) % frameCount, blend = x - Math.floor(x), nextFrame = (frame + 1) % frameCount;
  const strideShift = nextFrame === 0 ? sol.summary.speed * sol.summary.T : 0;
  return frames[frame].map((row, b) => { const next = frames[nextFrame][b]; return row.map((v, i) => v * (1 - blend) + (next[i] + (i === 9 ? strideShift : 0)) * blend); });
}
export const applyBonePose = (pose, bone, point) => { const row = pose[boneIndex[bone]]; return [row[9] + row[0] * point[0] + row[3] * point[1] + row[6] * point[2], row[10] + row[1] * point[0] + row[4] * point[1] + row[7] * point[2], row[11] + row[2] * point[0] + row[5] * point[1] + row[8] * point[2]]; };

// tallest point over the stride (bone ends), so the camera frames tall bodies too
export function strideMaxHeight(sol) {
  if (sol._maxHeight == null) { let top = 0; const bones = modelFor(sol).bones; sol.poses.forEach((pose) => pose.forEach((row, b) => { const len = bones[b].length; top = Math.max(top, row[10], row[10] + row[1] * len); })); sol._maxHeight = top; }
  return sol._maxHeight;
}

// ---------- software projector for the 2D canvas (orbit camera)
export function makeProjector(canvas, orbitCam, target) {
  const cosEl = Math.cos(orbitCam.el), camPos = [target[0] + orbitCam.dist * cosEl * Math.sin(orbitCam.az), target[1] + orbitCam.dist * Math.sin(orbitCam.el), target[2] + orbitCam.dist * cosEl * Math.cos(orbitCam.az)];
  let forward = [target[0] - camPos[0], target[1] - camPos[1], target[2] - camPos[2]]; const forwardLen = Math.hypot(...forward); forward = forward.map((v) => v / forwardLen);
  let right = [forward[1] * 0 - forward[2] * 1, forward[2] * 0 - forward[0] * 0, forward[0] * 1 - forward[1] * 0]; // forward x up(0,1,0)
  const rightLen = Math.hypot(...right) || 1; right = right.map((v) => v / rightLen);
  const up = [right[1] * forward[2] - right[2] * forward[1], right[2] * forward[0] - right[0] * forward[2], right[0] * forward[1] - right[1] * forward[0]];
  const focal = canvas.height * 1.35;
  return (point) => { const d = [point[0] - camPos[0], point[1] - camPos[1], point[2] - camPos[2]]; const depth = d[0] * forward[0] + d[1] * forward[1] + d[2] * forward[2];
    const x = d[0] * right[0] + d[1] * right[1] + d[2] * right[2], y = d[0] * up[0] + d[1] * up[1] + d[2] * up[2];
    return [canvas.width / 2 + focal * x / depth, canvas.height * 0.55 - focal * y / depth, depth, focal / depth]; };
}
