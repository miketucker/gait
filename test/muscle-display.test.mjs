import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CHARACTERS } from '../sim/characters.js';
import { musclePathSegments, muscleActivationAt } from '../src/js/muscle-display.js';
import { skeletonParts } from '../src/js/skeleton-parts.js';

const distance = (a, b) => Math.hypot(...a.map((v, axis) => v - b[axis]));

test('fibres and tendons stay connected across a bent muscle path', () => {
  const segments = musclePathSegments({ lopt: 1, lts: 1 }, [[0, 0, 0], [3, 0, 0], [3, 4, 0]]);
  assert.deepEqual(segments.map((s) => [s.index, s.tendon]), [[0, false], [1, false], [1, true]]);
  assert.deepEqual(segments[1].to, [3, 0.5, 0]);
  assert.deepEqual(segments[1].to, segments[2].from);
  assert.equal(segments.filter((s) => !s.tendon).reduce((sum, s) => sum + distance(s.from, s.to), 0), 3.5);
  assert.equal(segments.reduce((sum, s) => sum + distance(s.from, s.to), 0), 7);
});

test('coincident attachment points produce no invalid or zero-length segments', () => {
  const segments = musclePathSegments({ lopt: 1, lts: 0 }, [[0, 0, 0], [0, 0, 0], [0, 1, 0]]);
  assert.deepEqual(segments, [{ index: 1, tendon: false, from: [0, 0, 0], to: [0, 1, 0] }]);
});

test('activation blends smoothly across the end of a stride', () => {
  const solution = { a: [[0.1, 0.8, 0.3]] };
  assert.equal(muscleActivationAt(solution, 0, 2, 0, 0), 0.3);
  assert.equal(muscleActivationAt(solution, 0, 2, 0, 1), 0.1);
  assert.ok(Math.abs(muscleActivationAt(solution, 0, 2, 0, 0.5) - 0.2) < 1e-12);
});

for (const [key, character] of Object.entries(CHARACTERS)) {
  test(`${key}: every bone and muscle renders from the exported body pack`, () => {
    const { model, solution } = JSON.parse(readFileSync(new URL(`../src/data/${character.file}`, import.meta.url), 'utf8'));
    const boneIdx = Object.fromEntries(model.bones.map((bone, i) => [bone.name, i]));
    const parts = skeletonParts(model);
    for (const bone of model.bones) assert.ok(parts.some((p) => p.kind === 'tube' && p.bone === bone.name && p.b[0] === bone.length));
    for (const part of parts) {
      assert.ok(part.bone in boneIdx);
      assert.ok((part.kind === 'ball' ? [...part.c, ...part.s] : [...part.a, ...part.b, part.r]).every(Number.isFinite));
    }
    for (const frame of [0, Math.floor(solution.poses.length / 2), solution.poses.length - 1]) {
      const pose = solution.poses[frame];
      model.muscles.forEach((muscle, i) => {
        assert.ok(muscle.pcsa > 0, `${muscle.name} has a cross-sectional area`);
        const points = muscle.path.map(([bone, p]) => {
          const r = pose[boneIdx[bone]];
          return [r[9] + r[0] * p[0] + r[3] * p[1] + r[6] * p[2], r[10] + r[1] * p[0] + r[4] * p[1] + r[7] * p[2], r[11] + r[2] * p[0] + r[5] * p[1] + r[8] * p[2]];
        });
        const pathLength = points.slice(1).reduce((sum, point, j) => sum + distance(point, points[j]), 0);
        const segments = musclePathSegments(muscle, points);
        assert.ok(segments.every((s) => [...s.from, ...s.to].every(Number.isFinite)));
        assert.ok(Math.abs(segments.reduce((sum, s) => sum + distance(s.from, s.to), 0) - pathLength) < 1e-10, `${muscle.name} preserves its attachment path`);
        assert.ok(Number.isFinite(muscleActivationAt(solution, i, frame, (frame + 1) % solution.poses.length, 0.5)));
      });
    }
  });
}
