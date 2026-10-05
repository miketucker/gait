// Shared by the atlas and parade: divide each simulated muscle path into
// activated fibre and pale tendon, using the exported optimal/slack lengths.
export function musclePathSegments(muscle, points) {
  const lengths = points.slice(1).map((point, j) => Math.hypot(...point.map((v, axis) => v - points[j][axis])));
  const total = lengths.reduce((sum, length) => sum + length, 0);
  const fibreEnd = total * (1 - Math.min(0.95, muscle.lts / (muscle.lts + muscle.lopt) || 0));
  const segments = [];
  let arc = 0;
  lengths.forEach((length, index) => {
    if (length > 1e-12) {
      const end = arc + length;
      const at = (distance) => points[index].map((v, axis) => v + (points[index + 1][axis] - v) * (distance - arc) / length);
      if (fibreEnd > arc) segments.push({ index, tendon: false, from: points[index], to: at(Math.min(fibreEnd, end)) });
      if (end > fibreEnd) segments.push({ index, tendon: true, from: at(Math.max(fibreEnd, arc)), to: points[index + 1] });
    }
    arc += length;
  });
  return segments;
}

export const muscleActivationAt = (solution, muscle, frame, nextFrame, blend) =>
  solution.a[muscle][frame] * (1 - blend) + solution.a[muscle][nextFrame] * blend;
