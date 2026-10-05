// The humanoid skeleton shown in the atlas: exported bones, round skull,
// joints, rib hints and foot contacts, all expressed in their bone frames.
export function skeletonParts(model) {
  const parts = [], boneColor = '#343c40', ribColor = '#68737a', jointColor = '#e8e0cc';
  const ball = (bone, c, r, color) => parts.push({ kind: 'ball', bone, c, s: [r, r, r], color });
  for (const bone of model.bones) {
    parts.push({ kind: 'tube', bone: bone.name, a: [0, 0, 0], b: [bone.length, 0, 0], r: bone.radius, color: boneColor });
    ball(bone.name, [0, 0, 0], bone.radius * 1.25, jointColor);
  }
  const head = model.head_circle;
  ball('head', head.center, head.radius, boneColor);
  if (model.eye) ball(model.eye[0], model.eye[1], head.radius * 0.08, '#0b6e6a');
  const ribScale = model.bones.find((bone) => bone.name === 'thorax').length / 0.42;
  for (let u = 0.08 * ribScale; u <= 0.40 * ribScale + 1e-9; u += 0.05 * ribScale) {
    for (const side of [1, -1]) {
      const end = model.rib_depth
        ? [u - 0.3 * model.rib_depth, -model.rib_depth * (1 - 0.35 * ((u - 0.24 * ribScale) / (0.16 * ribScale)) ** 2), side * 0.9 * model.rib_half_width]
        : [u + 0.04, -0.17 + Math.abs(u - 0.24 * ribScale) * 0.4 / ribScale, side * 0.9 * (model.rib_half_width || 0.11)];
      parts.push({ kind: 'tube', bone: 'thorax', a: [u, 0, 0], b: end, r: 0.003 * ribScale, color: ribColor });
    }
  }
  for (const contact of model.contacts) ball(contact.bone, contact.point, contact.radius, boneColor);
  return parts;
}
