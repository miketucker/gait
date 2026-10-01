// Three.js anatomy renderer: bones, muscles, organs, skin, fur.
// Imports state + pose only. Keeps the original `{ draw }` interface;
// layer-checkbox state comes from anatomyOptions().
import * as THREE from 'three';
import { theme, orbitCam, boneIndexFor } from './state.js';
import { boneIndex, applyBonePose } from './pose.js';

// ---------- anatomy layers (three.js): bones, muscles and tendons, organs, skin (see gaitlab3d/anatomy.py)
export const AnatomyRenderer = (() => {
  // three is an imported module here (the upstream single-file page used a window.THREE global)
  const canvas3d = document.getElementById('stage3');
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas: canvas3d, antialias: true }); } catch (err) { return null; }
  renderer.localClippingEnabled = true;
  const scene = new THREE.Scene(), camera3d = new THREE.PerspectiveCamera(2 * Math.atan(0.5 / 1.35) * 180 / Math.PI, 1.6, 0.02, 30);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x3a3a3a, 0.8));
  const sun = new THREE.DirectionalLight(0xffffff, 0.75); sun.position.set(1.2, 3, 2.2); scene.add(sun);
  const fill = new THREE.DirectionalLight(0xffffff, 0.3); fill.position.set(-2, 1, -1.5); scene.add(fill);
  let grid = null, gridColor = '';
  const clipPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);
  const PALETTE = { bone: 0xe8e0cc, tendon: 0xe9dfc7, chest: 0xc4707e, abdomen: 0xb98a58, skin: 0xd8b08a, fat: [0xf6e7a0, 0xe39a3b] };
  const decodeBase64 = (str, ArrayType) => { const bin = atob(str), bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); return new ArrayType(bytes.buffer); };
  const poseRowToMatrix4 = (row) => new THREE.Matrix4().set(row[0], row[3], row[6], row[9], row[1], row[4], row[7], row[10], row[2], row[5], row[8], row[11], 0, 0, 0, 1);
  const standardMaterial = (color, opts = {}) => new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.65, metalness: 0 }, opts));
  const Mats = { bone: standardMaterial(PALETTE.bone, { roughness: 0.5 }), chest: standardMaterial(PALETTE.chest, { transparent: true, opacity: 0.55, depthWrite: false }),
    abdomen: standardMaterial(PALETTE.abdomen, { transparent: true, opacity: 0.5, depthWrite: false }), muscle: standardMaterial(0xffffff, { vertexColors: true, roughness: 0.55 }),
    skin: standardMaterial(PALETTE.skin, { transparent: true, opacity: 0.35, roughness: 0.75, side: THREE.FrontSide }) };
  // a bone shaft with swollen, rounded ends along +x (lathe about y, then turned onto x)
  function latheBoneShaft(length, shaftRadius, endRadius, radialSeg = 12) {
    const profile = [], rings = 18, capSteps = 5;
    for (let i = 0; i <= capSteps; i++) { const a = -Math.PI / 2 + (i / capSteps) * Math.PI / 2; profile.push(new THREE.Vector2(Math.max(1e-4, Math.cos(a) * endRadius), Math.sin(a) * endRadius)); }
    for (let i = 1; i < rings; i++) { const t = i / rings; profile.push(new THREE.Vector2(shaftRadius + (endRadius - shaftRadius) * (Math.exp(-((t / 0.13) ** 2)) + Math.exp(-(((1 - t) / 0.13) ** 2))), t * length)); }
    for (let i = 0; i <= capSteps; i++) { const a = (i / capSteps) * Math.PI / 2; profile.push(new THREE.Vector2(Math.max(1e-4, Math.cos(a) * endRadius), length + Math.sin(a) * endRadius)); }
    const geom = new THREE.LatheGeometry(profile, radialSeg); geom.rotateZ(-Math.PI / 2); return geom;
  }
  function taperedBone(length, radius0, radius1, radialSeg = 14) {  // a rounded cone along +x
    const profile = [new THREE.Vector2(1e-4, -0.5 * radius0)];
    for (let i = 0; i <= 16; i++) { const t = i / 16; profile.push(new THREE.Vector2(radius0 + (radius1 - radius0) * t, t * length)); }
    profile.push(new THREE.Vector2(1e-4, length + 0.6 * radius1));
    const geom = new THREE.LatheGeometry(profile, radialSeg); geom.rotateZ(-Math.PI / 2); return geom;
  }
  const unitSphere = new THREE.SphereGeometry(1, 20, 14), unitCylinderX = new THREE.CylinderGeometry(1, 1, 1, 10).rotateZ(Math.PI / 2), unitBox = new THREE.BoxGeometry(1, 1, 1);
  const placeUnitMesh = (geom, mat, pos, scale) => { const mesh = new THREE.Mesh(geom, mat); mesh.position.set(...pos); mesh.scale.set(...scale); return mesh; };
  class RibCurve extends THREE.Curve {
    constructor(xPos, halfHeight, halfWidth, side) { super(); Object.assign(this, { x: xPos, hh: halfHeight, hw: halfWidth, sgn: side }); }
    getPoint(t, v = new THREE.Vector3()) { const angle = Math.PI * t; return v.set(this.x + 0.035 * Math.sin(angle / 2), -this.hh * (1 - Math.cos(angle)), this.sgn * this.hw * Math.sin(angle)); }
  }
  // a canid-like skull in the head frame (x forward along the head, y up), scaled by head length
  const tubeAlongPoints = (points, radius, mat = Mats.bone) => new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p))), 16, radius, 6), mat);
  const TOOTH_MAT = standardMaterial(0xf6f2e6, { roughness: 0.3 });
  const unitCone = new THREE.ConeGeometry(1, 1, 8);
  function buildSkull(headLength, model) {
    const group = new THREE.Group(), scaled = (x, y, z) => [x * headLength, y * headLength, z * headLength];
    group.add(placeUnitMesh(unitSphere, Mats.bone, scaled(0.27, 0.05, 0), [0.29 * headLength, 0.21 * headLength, 0.22 * headLength]));            // braincase
    group.add(placeUnitMesh(unitSphere, Mats.bone, scaled(0.03, 0.02, 0), [0.1 * headLength, 0.12 * headLength, 0.13 * headLength]));             // occiput
    group.add(placeUnitMesh(unitBox, Mats.bone, scaled(0.2, 0.24, 0), [0.3 * headLength, 0.05 * headLength, 0.012 * headLength]));                // sagittal crest
    const muzzle = new THREE.Mesh(taperedBone(0.6 * headLength, 0.125 * headLength, 0.055 * headLength), Mats.bone);                    // muzzle: maxilla and nasals
    muzzle.position.set(0.42 * headLength, -0.03 * headLength, 0); muzzle.scale.set(1, 0.85, 1); muzzle.rotation.z = -0.05; group.add(muzzle);
    group.add(placeUnitMesh(unitSphere, Mats.bone, scaled(0.43, 0.02, 0), [0.1 * headLength, 0.12 * headLength, 0.15 * headLength]));             // brow between the orbits
    for (const side of [1, -1]) {
      group.add(tubeAlongPoints([scaled(0.58, -0.06, side * 0.1), scaled(0.42, -0.03, side * 0.21), scaled(0.26, -0.02, side * 0.2), scaled(0.16, 0.0, side * 0.14)], 0.022 * headLength));   // zygomatic arch
      group.add(tubeAlongPoints([scaled(0.14, -0.06, side * 0.13), scaled(0.2, -0.17, side * 0.12), scaled(0.55, -0.18, side * 0.075), scaled(0.96, -0.14, side * 0.02)], 0.032 * headLength)); // mandible
      group.add(tubeAlongPoints([scaled(0.2, -0.13, side * 0.12), scaled(0.23, -0.03, side * 0.13), scaled(0.25, 0.06, side * 0.12)], 0.02 * headLength));                          // coronoid process
      const eye = model.eye ? model.eye[1] : [0.09, 0.03, 0];
      group.add(placeUnitMesh(unitSphere, standardMaterial(0x1b1410, { roughness: 0.2 }), [eye[0], eye[1], side * 0.17 * headLength], [0.055 * headLength, 0.055 * headLength, 0.05 * headLength]));    // eye in its orbit
      const placeTooth = (x, y, zz, len, radius, pointsUp) => { const tooth = placeUnitMesh(unitCone, TOOTH_MAT, scaled(x, y, zz), [radius * headLength, len * headLength, radius * headLength]); tooth.rotation.z = pointsUp ? 0 : Math.PI; group.add(tooth); };
      placeTooth(0.88, -0.12, side * 0.055, 0.08, 0.018, false);                                            // upper canine
      placeTooth(0.91, -0.115, side * 0.035, 0.065, 0.015, true);                                           // lower canine
      for (let i = 0; i < 5; i++) placeTooth(0.5 + 0.075 * i, -0.115, side * (0.085 - 0.006 * i), 0.035, 0.016, false);   // cheek teeth
      for (let i = 0; i < 3; i++) placeTooth(0.99, -0.1, side * (0.01 + 0.012 * i), 0.03, 0.007, false);      // incisors
    }
    return group;
  }
  // bones from the exported parts (gaitlab3d/skeleton_parts.py), merged per material; the head gets the skull
  const CART_MAT = standardMaterial(0xc6dbe3, { roughness: 0.35 }), LIG_MAT = standardMaterial(0xf0f1ec, { roughness: 0.3 }),
    CAPSULE_MAT = standardMaterial(0xb4d0dc, { transparent: true, opacity: 0.3, depthWrite: false, roughness: 0.3 });
  const PART_MATS = { bone: Mats.bone, cart: CART_MAT, lig: LIG_MAT, tooth: TOOTH_MAT, capsule: CAPSULE_MAT };
  const toVec3 = (a) => new THREE.Vector3(a[0], a[1], a[2]), Y_UP = new THREE.Vector3(0, 1, 0), UNIT_SCALE = new THREE.Vector3(1, 1, 1), IDENTITY_QUAT = new THREE.Quaternion();
  function partGeometries(part) {                 // [geometry, matrix] pairs for one part, in its bone's frame
    const pairs = [];
    if (part.t === 'shaft') pairs.push([latheBoneShaft(part.L, part.rs, part.re), new THREE.Matrix4()]);
    else if (part.t === 'ell') pairs.push([unitSphere, new THREE.Matrix4().compose(toVec3(part.c), IDENTITY_QUAT, toVec3(part.s))]);
    else if (part.t === 'cap') {
      const start = toVec3(part.a), end = toVec3(part.b), delta = end.clone().sub(start), len = delta.length();
      if (len > 1e-6) pairs.push([new THREE.CylinderGeometry(part.rb, part.ra, len, 10, 1, true), new THREE.Matrix4().compose(start.clone().add(end).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(Y_UP, delta.normalize()), UNIT_SCALE)]);
      pairs.push([unitSphere, new THREE.Matrix4().compose(toVec3(part.a), IDENTITY_QUAT, new THREE.Vector3(part.ra, part.ra, part.ra))], [unitSphere, new THREE.Matrix4().compose(toVec3(part.b), IDENTITY_QUAT, new THREE.Vector3(part.rb, part.rb, part.rb))]);
    } else if (part.t === 'tube') pairs.push([new THREE.TubeGeometry(new THREE.CatmullRomCurve3(part.p.map(toVec3)), Math.max(6, 3 * part.p.length), part.r, 6), new THREE.Matrix4()]);
    else if (part.t === 'plate') {
      const corners = part.p.map(toVec3), center = corners.reduce((sum, q) => sum.add(q), new THREE.Vector3()).multiplyScalar(1 / corners.length), normal = new THREE.Vector3();
      for (let i = 0; i < corners.length; i++) normal.add(corners[i].clone().sub(center).cross(corners[(i + 1) % corners.length].clone().sub(center)));
      if (normal.length() < 1e-12) return pairs;
      normal.normalize();
      const axisU = corners[0].clone().sub(center); axisU.sub(normal.clone().multiplyScalar(axisU.dot(normal))); if (axisU.length() < 1e-9) return pairs;
      axisU.normalize(); const axisV = normal.clone().cross(axisU);
      const geom = new THREE.ExtrudeGeometry(new THREE.Shape(corners.map((q) => new THREE.Vector2(q.clone().sub(center).dot(axisU), q.clone().sub(center).dot(axisV)))),
        { depth: part.th, bevelEnabled: true, bevelThickness: 0.3 * part.th, bevelSize: 0.3 * part.th, bevelSegments: 2, curveSegments: 4 });
      geom.translate(0, 0, -0.5 * part.th);
      pairs.push([geom, new THREE.Matrix4().makeBasis(axisU, axisV, normal).setPosition(center)]);
    }
    return pairs;
  }
  function mergeGeometries(list) {             // one mesh per material and bone keeps the draw calls down
    let vertCount = 0;
    const flat = list.map(([geom, matrix]) => { const expanded = geom.index ? geom.toNonIndexed() : geom.clone(); expanded.applyMatrix4(matrix); if (!expanded.attributes.normal) expanded.computeVertexNormals(); vertCount += expanded.attributes.position.count; return expanded; });
    const positions = new Float32Array(3 * vertCount), normals = new Float32Array(3 * vertCount); let offset = 0;
    for (const expanded of flat) { positions.set(expanded.attributes.position.array, 3 * offset); normals.set(expanded.attributes.normal.array, 3 * offset); offset += expanded.attributes.position.count; expanded.dispose(); }
    const merged = new THREE.BufferGeometry(); merged.setAttribute('position', new THREE.BufferAttribute(positions, 3)); merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    return merged;
  }
  function buildBoneMeshes(boneName, anatomy, model) {
    const group = new THREE.Group(), softGroup = new THREE.Group(); group.add(softGroup);
    if (boneName === 'head') group.add(buildSkull(model.bones[boneIndexFor(model)[boneName]].length, model));
    const geomsByMat = {};
    for (const part of anatomy.parts[boneName] || []) for (const pair of partGeometries(part)) (geomsByMat[part.m] = geomsByMat[part.m] || []).push(pair);
    for (const [matName, pairs] of Object.entries(geomsByMat)) (matName === 'cart' || matName === 'lig' ? softGroup : group).add(new THREE.Mesh(mergeGeometries(pairs), PART_MATS[matName] || Mats.bone));
    group.matrixAutoUpdate = false;
    return { g: group, soft: softGroup };
  }
  function pushPointOutOfBone(point, clearance, capsule) {         // mirror of anatomy.push_out: keep point at least boneRadius + clearance from a shaft axis
    const [segA, segB, boneRadius] = capsule, axis = [segB[0] - segA[0], segB[1] - segA[1], segB[2] - segA[2]], axisLen2 = axis[0] ** 2 + axis[1] ** 2 + axis[2] ** 2 || 1e-12;
    const t = Math.min(1, Math.max(0, ((point[0] - segA[0]) * axis[0] + (point[1] - segA[1]) * axis[1] + (point[2] - segA[2]) * axis[2]) / axisLen2));
    const closest = [segA[0] + t * axis[0], segA[1] + t * axis[1], segA[2] + t * axis[2]], delta = [point[0] - closest[0], point[1] - closest[1], point[2] - closest[2]], dist = Math.hypot(delta[0], delta[1], delta[2]), want = boneRadius + clearance;
    if (dist < want && dist > 1e-6) { const f = want / dist; point[0] = closest[0] + delta[0] * f; point[1] = closest[1] + delta[1] * f; point[2] = closest[2] + delta[2] * f; }
  }
  // muscle-tendon unit: mirror of anatomy.muscle_rings
  const shaftRadiusAt = (compartment, x) => { const t = Math.min(1, Math.max(0, x / compartment.L)); return compartment.rs + (compartment.re - compartment.rs) * (Math.exp(-((t / 0.13) ** 2)) + Math.exp(-(((1 - t) / 0.13) ** 2))); };
  // planes compartments stay inside: mirror of anatomy.seg_closest / sector_clips
  const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], clamp01 = (v) => Math.min(1, Math.max(0, v));
  function closestPointsOnSegments(a0, a1, b0, b1) {
    const dirU = [a1[0] - a0[0], a1[1] - a0[1], a1[2] - a0[2]], dirV = [b1[0] - b0[0], b1[1] - b0[1], b1[2] - b0[2]], diffW = [a0[0] - b0[0], a0[1] - b0[1], a0[2] - b0[2]];
    const uu = dot3(dirU, dirU), uv = dot3(dirU, dirV), vv = dot3(dirV, dirV), uw = dot3(dirU, diffW), vw = dot3(dirV, diffW), denom = uu * vv - uv * uv;
    let sParam = denom > 1e-12 ? clamp01((uv * vw - vv * uw) / denom) : 0;
    const tParam = vv > 1e-12 ? clamp01((uv * sParam + vw) / vv) : 0;
    sParam = uu > 1e-12 ? clamp01((uv * tParam - uw) / uu) : 0;
    return [[a0[0] + sParam * dirU[0], a0[1] + sParam * dirU[1], a0[2] + sParam * dirU[2]], [b0[0] + tParam * dirV[0], b0[1] + tParam * dirV[1], b0[2] + tParam * dirV[2]]];
  }
  const NEAR_REACH = 0.2;                       // anatomy.NEAR_REACH
  function compartmentClipPlanes(compartment, bonePose, getBonePose) {      // planes a compartment's bellies stay inside: the other leg, the joint creases
    const planes = [], axisOf = (pose) => [pose[0], pose[1], pose[2]], originOf = (pose) => [pose[9], pose[10], pose[11]];
    const origin = originOf(bonePose), xAxis = axisOf(bonePose);
    const boneEnd = [origin[0] + compartment.L * xAxis[0], origin[1] + compartment.L * xAxis[1], origin[2] + compartment.L * xAxis[2]];
    for (const [otherBone, otherLen] of compartment.near || []) {     // every other leg's bone in reach: the plane bisecting the two
      const otherPose = getBonePose(otherBone), otherOrigin = originOf(otherPose), otherAxis = axisOf(otherPose);
      const [pointA, pointB] = closestPointsOnSegments(origin, boneEnd, otherOrigin, [otherOrigin[0] + otherLen * otherAxis[0], otherOrigin[1] + otherLen * otherAxis[1], otherOrigin[2] + otherLen * otherAxis[2]]);
      const delta = [pointA[0] - pointB[0], pointA[1] - pointB[1], pointA[2] - pointB[2]], gap = Math.hypot(...delta);
      if (gap > 1e-9 && gap < 2 * NEAR_REACH) planes.push([[delta[0] / gap, delta[1] / gap, delta[2] / gap], [0.5 * (pointA[0] + pointB[0]), 0.5 * (pointA[1] + pointB[1]), 0.5 * (pointA[2] + pointB[2])]]);
    }
    for (const [otherBone, creaseHint] of compartment.joints || []) {
      const otherPose = getBonePose(otherBone), [jointPoint, dirA, dirB, sign] = creaseHint > 0 ? [originOf(bonePose), axisOf(bonePose), axisOf(otherPose).map((v) => -v), 1] : [originOf(otherPose), axisOf(otherPose), axisOf(bonePose).map((v) => -v), -1];
      const delta = [dirA[0] - dirB[0], dirA[1] - dirB[1], dirA[2] - dirB[2]], dist = Math.hypot(...delta);
      if (dist > 1e-6) planes.push([[sign * delta[0] / dist, sign * delta[1] / dist, sign * delta[2] / dist], jointPoint]);
    }
    return planes;
  }
  // merged compartment bands: mirror of anatomy.comp_profile / band_at / band_point / compartment_rings
  const bandKernel = (dist, width) => (Math.abs(dist) < width ? (1 + Math.cos(Math.PI * dist / width)) / (2 * width) : 0);   // anatomy._kern
  function interpOrZero(x, xs, fs) {              // np.interp inside [xs[0], xs[n-1]] (to rounding), 0 outside
    const n = xs.length; if (!n || x < xs[0] - 1e-9 || x > xs[n - 1] + 1e-9) return 0; if (n === 1) return fs[0];
    x = Math.min(xs[n - 1], Math.max(xs[0], x));
    let j = 0; while (j < n - 2 && xs[j + 1] < x) j++;
    return fs[j] + (fs[j + 1] - fs[j]) * (x - xs[j]) / ((xs[j + 1] - xs[j]) || 1e-12);
  }
  function compartmentProfile(ringData, compartment, bonePose, constants) {       // stations over the attachment span, areas keeping the volume
    const [lo, hi] = constants.clear[compartment.kind], stations = [], areas = [], bellyIdx = [];
    for (let k = 0; k < ringData.c.length; k++) {
      const delta = [ringData.c[k][0] - bonePose[9], ringData.c[k][1] - bonePose[10], ringData.c[k][2] - bonePose[11]];
      stations.push(Math.min(hi * compartment.L, Math.max(lo * compartment.L, bonePose[0] * delta[0] + bonePose[1] * delta[1] + bonePose[2] * delta[2]))); areas.push(Math.PI * ringData.r[k] ** 2);
      if (ringData.belly[k]) bellyIdx.push(k);
    }
    if (bellyIdx.length > 1) {
      const cumLen = [0];
      for (let q = 1; q < bellyIdx.length; q++) { const a = ringData.c[bellyIdx[q - 1]], b = ringData.c[bellyIdx[q]]; cumLen.push(cumLen[q - 1] + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])); }
      const span = compartment.x1 - compartment.x0, arc = cumLen[cumLen.length - 1];
      bellyIdx.forEach((k, q) => { stations[k] = compartment.x0 + span * cumLen[q] / Math.max(arc, 1e-12); areas[k] *= arc / span; });
    }
    return { x: stations, xb: bellyIdx.map((k) => stations[k]), Ab: bellyIdx.map((k) => areas[k]) };
  }
  function muscleBandRadii(muscleIdx, anatomy, profiles, bonePose, clipPlanes, x, fibreU, gap) {   // [inner, outer] of the muscle's band at x, fibre fibreU
    const compartment = anatomy.muscles[muscleIdx].comp, isRound = compartment.kind === 'round', angle = (isRound ? compartment.phi : compartment.y) + fibreU * compartment.W;
    let belowDensity = 0, totalDensity = 0, ownDensity = 0;
    for (const mateIdx of compartment.mates) {
      const mate = anatomy.muscles[mateIdx].comp; let angleDiff = angle - (isRound ? mate.phi : mate.y);
      if (isRound) angleDiff = (((angleDiff + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
      const kernel = bandKernel(angleDiff, mate.W); if (!kernel) continue;
      const density = kernel * interpOrZero(x, profiles[mateIdx].xb, profiles[mateIdx].Ab);
      totalDensity += density; if (mateIdx === muscleIdx) ownDensity = density; else if (mate.depth < compartment.depth) belowDensity += density;
    }
    const boneRadius = isRound ? shaftRadiusAt(compartment, x) : 0; let squash = 1;
    if (clipPlanes.length) {                      // squashed, all layers in proportion, short of each plane
      let rayDir, base;
      if (isRound) { const cosA = Math.cos(angle), sinA = compartment.zs * Math.sin(angle); rayDir = [bonePose[3] * cosA + bonePose[6] * sinA, bonePose[4] * cosA + bonePose[7] * sinA, bonePose[5] * cosA + bonePose[8] * sinA];
        base = [bonePose[9] + bonePose[0] * x + boneRadius * rayDir[0], bonePose[10] + bonePose[1] * x + boneRadius * rayDir[1], bonePose[11] + bonePose[2] * x + boneRadius * rayDir[2]]; }
      else { const zOff = compartment.zs * 0.5 * compartment.th; rayDir = [compartment.zs * bonePose[6], compartment.zs * bonePose[7], compartment.zs * bonePose[8]];
        base = [bonePose[9] + bonePose[0] * x + bonePose[3] * angle + bonePose[6] * zOff, bonePose[10] + bonePose[1] * x + bonePose[4] * angle + bonePose[7] * zOff, bonePose[11] + bonePose[2] * x + bonePose[5] * angle + bonePose[8] * zOff]; }
      let room = Infinity;
      for (const [normal, point] of clipPlanes) {
        const normalDist = dot3(rayDir, normal), height = (base[0] - point[0]) * normal[0] + (base[1] - point[1]) * normal[1] + (base[2] - point[2]) * normal[2] - gap;
        room = Math.min(room, normalDist < -1e-9 ? height / -normalDist : (height < 0 ? 0 : Infinity));
      }
      room = Math.max(room, 0);
      const cap = isRound ? room * (boneRadius + 0.5 * room) : room;
      if (totalDensity > cap) squash = cap / Math.max(totalDensity, 1e-15);
    }
    if (isRound) return [Math.sqrt(boneRadius * boneRadius + 2 * squash * belowDensity), Math.sqrt(boneRadius * boneRadius + 2 * squash * (belowDensity + ownDensity))];
    const inner = 0.5 * compartment.th + squash * belowDensity; return [inner, inner + squash * ownDensity];
  }
  function bandSurfacePoint(compartment, bonePose, x, fibreU, radius) {
    let local;
    if (compartment.kind === 'round') { const a = compartment.phi + fibreU * compartment.W; local = [x, radius * Math.cos(a), compartment.zs * radius * Math.sin(a)]; }
    else local = [x, compartment.y + fibreU * compartment.W, compartment.zs * radius];
    return [bonePose[9] + bonePose[0] * local[0] + bonePose[3] * local[1] + bonePose[6] * local[2], bonePose[10] + bonePose[1] * local[0] + bonePose[4] * local[1] + bonePose[7] * local[2], bonePose[11] + bonePose[2] * local[0] + bonePose[5] * local[1] + bonePose[8] * local[2]];
  }
  function layoutCompartmentBands(anatomy, baseRingsFor, getBonePose) {         // every compartment muscle's rings in its band, for one pose
    const constants = anatomy.const, bands = {}, profiles = {}, midU = (constants.bu.length - 1) >> 1;
    anatomy.muscles.forEach((spec, i) => { if (!spec.comp) return; const ringData = baseRingsFor(i), profile = compartmentProfile(ringData, spec.comp, getBonePose(spec.comp.bone), constants); ringData.xk = profile.x; profiles[i] = profile; bands[i] = ringData; });
    for (const key of Object.keys(bands)) {
      const i = +key, compartment = anatomy.muscles[i].comp, ringData = bands[i], bonePose = getBonePose(compartment.bone), clips = compartmentClipPlanes(compartment, bonePose, getBonePose);
      Object.assign(ringData, { inn: [], out: [], sector: compartment, fr: bonePose, clips, band: true });
      for (let k = 0; k < ringData.c.length; k++) {
        const inner = [], outer = [];
        if (ringData.belly[k]) for (const u of constants.bu) { const [lo, hi] = muscleBandRadii(i, anatomy, profiles, bonePose, clips, ringData.xk[k], u, constants.gap); inner.push(lo); outer.push(hi); }
        ringData.inn.push(inner); ringData.out.push(outer);
        if (ringData.belly[k]) { ringData.c[k] = bandSurfacePoint(compartment, bonePose, ringData.xk[k], 0, 0.5 * (inner[midU] + outer[midU])); ringData.r[k] = 0.5 * (outer[midU] - inner[midU]); }
      }
    }
    return bands;
  }
  // muscles give way to the skin: every muscle vertex stays PRESS_MARGIN under the skin as drawn this frame
  const PRESS_MARGIN = 0.0035, PRESS_CELL = 0.03, PRESS_EVERY = 10, PRESS_GRID_BUF = {}, PRESS_NEAREST = new WeakMap();
  let pressFrame = 0;
  function facesAroundEachVertex(faceArray, vertCount) {             // the faces around each skin vertex (compressed rows)
    const offsets = new Int32Array(vertCount + 1); for (let k = 0; k < faceArray.length; k++) offsets[faceArray[k] + 1]++;
    for (let v = 0; v < vertCount; v++) offsets[v + 1] += offsets[v];
    const faceIdx = new Int32Array(faceArray.length), cursor = offsets.slice(0, vertCount);
    for (let f = 0; f < faceArray.length / 3; f++) for (let k = 0; k < 3; k++) faceIdx[cursor[faceArray[3 * f + k]]++] = f;
    return { off: offsets, idx: faceIdx };
  }
  const tmpSkinNormal = [0, 0, 0];
  function signedDistanceToSkin(x, y, z, vertIdx, skinPos, faces, vertFaces) { // signed distance to the skin at its closest point among the faces around
    let bestDist2 = Infinity, signed = 0; tmpSkinNormal[0] = tmpSkinNormal[1] = tmpSkinNormal[2] = 0;   // vertex vertIdx; ties (edges, corners) average their normals
    for (let t = vertFaces.off[vertIdx]; t < vertFaces.off[vertIdx + 1]; t++) {
      const f = vertFaces.idx[t], ia = 3 * faces[3 * f], ib = 3 * faces[3 * f + 1], ic = 3 * faces[3 * f + 2];
      const ax = skinPos[ia], ay = skinPos[ia + 1], az = skinPos[ia + 2], abx = skinPos[ib] - ax, aby = skinPos[ib + 1] - ay, abz = skinPos[ib + 2] - az, acx = skinPos[ic] - ax, acy = skinPos[ic + 1] - ay, acz = skinPos[ic + 2] - az;
      const apx = x - ax, apy = y - ay, apz = z - az, d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
      const bpx = x - skinPos[ib], bpy = y - skinPos[ib + 1], bpz = z - skinPos[ib + 2], d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
      const cpx = x - skinPos[ic], cpy = y - skinPos[ic + 1], cpz = z - skinPos[ic + 2], d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
      let u, w;                              // closest point a + u ab + w ac (Ericson, Real-Time Collision Detection 5.1.5)
      const vc = d1 * d4 - d3 * d2, vb = d5 * d2 - d1 * d6, va = d3 * d6 - d5 * d4;
      if (d1 <= 0 && d2 <= 0) { u = 0; w = 0; }
      else if (d3 >= 0 && d4 <= d3) { u = 1; w = 0; }
      else if (vc <= 0 && d1 >= 0 && d3 <= 0) { u = d1 / (d1 - d3); w = 0; }
      else if (d6 >= 0 && d5 <= d6) { u = 0; w = 1; }
      else if (vb <= 0 && d2 >= 0 && d6 <= 0) { u = 0; w = d2 / (d2 - d6); }
      else if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); u = 1 - w; }
      else { const denom = 1 / (va + vb + vc); u = vb * denom; w = vc * denom; }
      const cx = ax + u * abx + w * acx, cy = ay + u * aby + w * acy, cz = az + u * abz + w * acz, dist2 = (x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2;
      let nx = aby * acz - abz * acy, ny = abz * acx - abx * acz, nz = abx * acy - aby * acx; const nLen = Math.hypot(nx, ny, nz) || 1; nx /= nLen; ny /= nLen; nz /= nLen;
      if (dist2 < bestDist2 - 1e-12) { bestDist2 = dist2; tmpSkinNormal[0] = nx; tmpSkinNormal[1] = ny; tmpSkinNormal[2] = nz; signed = (x - cx) * nx + (y - cy) * ny + (z - cz) * nz; }
      else if (dist2 <= bestDist2 + 1e-12) { tmpSkinNormal[0] += nx; tmpSkinNormal[1] += ny; tmpSkinNormal[2] += nz; const l = Math.hypot(tmpSkinNormal[0], tmpSkinNormal[1], tmpSkinNormal[2]) || 1; signed = Math.sign((x - cx) * tmpSkinNormal[0] + (y - cy) * tmpSkinNormal[1] + (z - cz) * tmpSkinNormal[2]) * Math.sqrt(dist2); tmpSkinNormal[0] /= l; tmpSkinNormal[1] /= l; tmpSkinNormal[2] /= l; }
    }
    return signed;
  }
  function pressMusclesBeneathSkin(meshItems, skinPos, skinNormals, vertCount, faces, vertFaces) {   // items: [geometry, normals computed from the shape?]
    // each muscle vertex keeps the skin vertex nearest it (or -1: deep inside), found afresh every PRESS_EVERY
    // frames; the side it is on comes from the closest point of the faces around that vertex, so it is exact
    // on ridges and where two skin surfaces face each other
    const refresh = pressFrame++ % PRESS_EVERY === 0 || meshItems.some(([geom]) => !PRESS_NEAREST.has(geom));
    let grid = null;
    if (refresh) {
      const cell = PRESS_CELL, lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      for (let v = 0; v < vertCount; v++) for (let t = 0; t < 3; t++) { const x = skinPos[3 * v + t]; if (x < lo[t]) lo[t] = x; if (x > hi[t]) hi[t] = x; }
      const nx = Math.ceil((hi[0] - lo[0]) / cell) + 1, ny = Math.ceil((hi[1] - lo[1]) / cell) + 1, nz = Math.ceil((hi[2] - lo[2]) / cell) + 1, cellCount = nx * ny * nz;
      if (!PRESS_GRID_BUF.head || PRESS_GRID_BUF.head.length < cellCount) Object.assign(PRESS_GRID_BUF, { head: new Int32Array(cellCount), near: new Uint8Array(cellCount) });
      // the grid holds the skin vertices and every face's centroid (as one of its corners), so a big
      // flat face is found even where its corners are far away
      const faceCount = faces.length / 3, pointCount = vertCount + faceCount;
      if (!PRESS_GRID_BUF.next || PRESS_GRID_BUF.next.length < pointCount) Object.assign(PRESS_GRID_BUF, { next: new Int32Array(pointCount), px: new Float32Array(3 * pointCount), pv: new Int32Array(pointCount) });
      const { head, near, next, px, pv } = PRESS_GRID_BUF;
      head.fill(-1, 0, cellCount); near.fill(0, 0, cellCount);
      for (let v = 0; v < vertCount; v++) { px[3 * v] = skinPos[3 * v]; px[3 * v + 1] = skinPos[3 * v + 1]; px[3 * v + 2] = skinPos[3 * v + 2]; pv[v] = v; }
      for (let f = 0; f < faceCount; f++) { const a = 3 * faces[3 * f], b = 3 * faces[3 * f + 1], c = 3 * faces[3 * f + 2], k = 3 * (vertCount + f);
        px[k] = (skinPos[a] + skinPos[b] + skinPos[c]) / 3; px[k + 1] = (skinPos[a + 1] + skinPos[b + 1] + skinPos[c + 1]) / 3; px[k + 2] = (skinPos[a + 2] + skinPos[b + 2] + skinPos[c + 2]) / 3; pv[vertCount + f] = faces[3 * f]; }
      for (let v = 0; v < pointCount; v++) { const q = ((Math.floor((px[3 * v] - lo[0]) / cell) * ny) + Math.floor((px[3 * v + 1] - lo[1]) / cell)) * nz + Math.floor((px[3 * v + 2] - lo[2]) / cell); next[v] = head[q]; head[q] = v; }
      for (let q = 0; q < cellCount; q++) if (head[q] >= 0) {  // cells within one cell of the skin
        const i = Math.floor(q / (ny * nz)), j = Math.floor(q / nz) % ny, k = q % nz;
        for (let di = Math.max(0, i - 1); di <= Math.min(nx - 1, i + 1); di++) for (let dj = Math.max(0, j - 1); dj <= Math.min(ny - 1, j + 1); dj++)
          for (let dk = Math.max(0, k - 1); dk <= Math.min(nz - 1, k + 1); dk++) near[(di * ny + dj) * nz + dk] = 1;
      }
      grid = { c: cell, lo, nx, ny, nz, head, near, next, px, pv };
    }
    for (const [geom, shapedFromGeometry] of meshItems) {
      const positions = geom.attributes.position.array; let moved = false;
      let nearest = PRESS_NEAREST.get(geom); if (!nearest || nearest.length !== positions.length / 3) { nearest = new Int32Array(positions.length / 3).fill(-1); PRESS_NEAREST.set(geom, nearest); }
      for (let v = 0, vertIdx = 0; v < positions.length; v += 3, vertIdx++) {
        const x = positions[v], y = positions[v + 1], z = positions[v + 2];
        if (grid) {                             // refresh: the nearest skin vertex within two cells
          nearest[vertIdx] = -1;
          const { c: cell, lo, nx, ny, nz, head, near, next, px, pv } = grid, i = Math.floor((x - lo[0]) / cell), j = Math.floor((y - lo[1]) / cell), k = Math.floor((z - lo[2]) / cell);
          if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz || !near[(i * ny + j) * nz + k]) continue;   // deep inside
          let bestDist2 = 4 * cell * cell;
          for (let di = Math.max(0, i - 1); di <= Math.min(nx - 1, i + 1); di++) for (let dj = Math.max(0, j - 1); dj <= Math.min(ny - 1, j + 1); dj++)
            for (let dk = Math.max(0, k - 1); dk <= Math.min(nz - 1, k + 1); dk++)
              for (let q = head[(di * ny + dj) * nz + dk]; q >= 0; q = next[q]) {
                const dx = px[3 * q] - x, dy = px[3 * q + 1] - y, dz = px[3 * q + 2] - z, dist2 = dx * dx + dy * dy + dz * dz;
                if (dist2 < bestDist2) { bestDist2 = dist2; nearest[vertIdx] = pv[q]; }
              }
        }
        const skinVert = nearest[vertIdx]; if (skinVert < 0) continue;
        const qx = x - skinPos[3 * skinVert], qy = y - skinPos[3 * skinVert + 1], qz = z - skinPos[3 * skinVert + 2];
        if (qx * qx + qy * qy + qz * qz < 4e-4 && qx * skinNormals[3 * skinVert] + qy * skinNormals[3 * skinVert + 1] + qz * skinNormals[3 * skinVert + 2] < -0.012) continue;   // well inside
        const clearance = signedDistanceToSkin(x, y, z, skinVert, skinPos, faces, vertFaces) + PRESS_MARGIN;
        if (clearance > 0) { positions[v] -= clearance * tmpSkinNormal[0]; positions[v + 1] -= clearance * tmpSkinNormal[1]; positions[v + 2] -= clearance * tmpSkinNormal[2]; moved = true; }
      }
      if (moved) geom.attributes.position.needsUpdate = true;
      if (shapedFromGeometry || moved) geom.computeVertexNormals();
    }
  }
  // bone parts in their bone's frame, for the skin's depth over bone: mirror of skeleton_parts.part_sdf
  function prepareSkinAnchorPart(packed) {
    const part = { b: packed[0], k: packed[1] }, collectPoints = (i0) => { const pts = []; for (let i = i0; i + 2 < packed.length; i += 3) pts.push([packed[i], packed[i + 1], packed[i + 2]]); return pts; };
    if (part.k === 0) { part.a = packed.slice(2, 5); part.e = packed.slice(5, 8); part.r = packed[8]; }
    else if (part.k === 1) { part.c = packed.slice(2, 5); part.s = packed.slice(5, 8); }
    else if (part.k === 2) { part.r = packed[2]; part.p = collectPoints(3); }
    else if (part.k === 3) { part.L = packed[2]; part.rs = packed[3]; part.re = packed[4]; }
    else {                                     // a planar convex polygon of thickness th
      part.th = packed[2]; const corners = collectPoints(3), n = corners.length, center = [0, 1, 2].map((q) => corners.reduce((sum, p) => sum + p[q], 0) / n), rawNormal = [0, 0, 0];
      for (let i = 0; i < n; i++) { const a = corners[i], b = corners[(i + 1) % n];            // Newell's normal
        rawNormal[0] += (a[1] - b[1]) * (a[2] + b[2]); rawNormal[1] += (a[2] - b[2]) * (a[0] + b[0]); rawNormal[2] += (a[0] - b[0]) * (a[1] + b[1]); }
      const rawLen = Math.hypot(...rawNormal) || 1, normal = rawNormal.map((x) => x / rawLen), toFirst = [corners[0][0] - center[0], corners[0][1] - center[1], corners[0][2] - center[2]], along = dot3(toFirst, normal);
      let axisU = [toFirst[0] - along * normal[0], toFirst[1] - along * normal[1], toFirst[2] - along * normal[2]]; const axisLen = Math.hypot(...axisU) || 1; axisU = axisU.map((x) => x / axisLen);
      const axisV = [normal[1] * axisU[2] - normal[2] * axisU[1], normal[2] * axisU[0] - normal[0] * axisU[2], normal[0] * axisU[1] - normal[1] * axisU[0]];
      Object.assign(part, { c: center, n: normal, e1: axisU, e2: axisV, q: corners.map((p) => { const d = [p[0] - center[0], p[1] - center[1], p[2] - center[2]]; return [dot3(d, axisU), dot3(d, axisV)]; }) });
    }
    return part;
  }
  const segmentSignedDistance = (point, segA, segB, radius) => { const axis = [segB[0] - segA[0], segB[1] - segA[1], segB[2] - segA[2]], t = Math.min(1, Math.max(0, ((point[0] - segA[0]) * axis[0] + (point[1] - segA[1]) * axis[1] + (point[2] - segA[2]) * axis[2]) / ((axis[0] ** 2 + axis[1] ** 2 + axis[2] ** 2) || 1e-12)));
    return Math.hypot(point[0] - segA[0] - t * axis[0], point[1] - segA[1] - t * axis[1], point[2] - segA[2] - t * axis[2]) - radius; };
  function partSignedDistance(part, local) {                      // signed distance (m) from bone-frame point to part
    if (part.k === 0) return segmentSignedDistance(local, part.a, part.e, part.r);
    if (part.k === 1) return (Math.hypot((local[0] - part.c[0]) / part.s[0], (local[1] - part.c[1]) / part.s[1], (local[2] - part.c[2]) / part.s[2]) - 1) * Math.min(part.s[0], part.s[1], part.s[2]);
    if (part.k === 2) { let d = Infinity; for (let i = 0; i + 1 < part.p.length; i++) d = Math.min(d, segmentSignedDistance(local, part.p[i], part.p[i + 1], part.r)); return d; }
    if (part.k === 3) { const x = Math.min(part.L, Math.max(0, local[0])), t = x / part.L, shaftR = part.rs + (part.re - part.rs) * (Math.exp(-((t / 0.13) ** 2)) + Math.exp(-(((1 - t) / 0.13) ** 2))), rho = Math.hypot(local[1], local[2]);
      return local[0] === x ? rho - shaftR : Math.hypot(local[0] - x, Math.max(rho - shaftR, 0)); }
    const d = [local[0] - part.c[0], local[1] - part.c[1], local[2] - part.c[2]], w = dot3(d, part.n), u = dot3(d, part.e1), v = dot3(d, part.e2), corners = part.q, n = corners.length;
    let edgeDist = Infinity, allPos = true, allNeg = true;
    for (let i = 0; i < n; i++) { const a = corners[i], b = corners[(i + 1) % n], ex = b[0] - a[0], ey = b[1] - a[1], t = Math.min(1, Math.max(0, ((u - a[0]) * ex + (v - a[1]) * ey) / ((ex * ex + ey * ey) || 1e-12)));
      edgeDist = Math.min(edgeDist, Math.hypot(u - a[0] - t * ex, v - a[1] - t * ey)); const cross = ex * (v - a[1]) - ey * (u - a[0]); if (cross < 0) allPos = false; if (cross > 0) allNeg = false; }
    const halfThick = Math.abs(w) - 0.5 * part.th;
    return allPos || allNeg ? halfThick : Math.hypot(edgeDist, Math.max(halfThick, 0));
  }
  function bandCenterAndHalf(ringData, arcPos, fibreCoord) {               // a band's mid-surface point and half-thickness at arc fraction, fibre coord
    const stations = ringData.s; let j = 0; while (j < stations.length - 2 && stations[j + 1] < arcPos) j++;
    if (!ringData.inn[j].length || !ringData.inn[j + 1].length) return null;
    const f = Math.min(1, Math.max(0, (arcPos - stations[j]) / ((stations[j + 1] - stations[j]) || 1))), acrossCount = ringData.inn[j].length;
    const q = Math.min(acrossCount - 1.000001, Math.max(0, (fibreCoord + 1) / 2 * (acrossCount - 1))), q0 = Math.floor(q), frac = q - q0;
    const atStation = (k) => { const lo = ringData.inn[k][q0] * (1 - frac) + ringData.inn[k][q0 + 1] * frac, hi = ringData.out[k][q0] * (1 - frac) + ringData.out[k][q0 + 1] * frac;
      return [bandSurfacePoint(ringData.sector, ringData.fr, ringData.xk[k], fibreCoord, 0.5 * (lo + hi)), 0.5 * (hi - lo)]; };
    const [point0, half0] = atStation(j), [point1, half1] = atStation(j + 1);
    return [[0, 1, 2].map((t) => point0[t] * (1 - f) + point1[t] * f), half0 * (1 - f) + half1 * f];
  }
  function muscleBellyRings(centerline, tendonLen, muscleSpec, constants, capsules, isCompartment) {
    const n = centerline.length, segLens = [], cumLen = [0];
    for (let j = 0; j + 1 < n; j++) { const d = Math.hypot(centerline[j + 1][0] - centerline[j][0], centerline[j + 1][1] - centerline[j][1], centerline[j + 1][2] - centerline[j][2]); segLens.push(d); cumLen.push(cumLen[j] + d); }
    const totalLen = cumLen[n - 1], bellyLen = Math.min(Math.max((totalLen - tendonLen) * (1 + 2 * Math.sin(muscleSpec.pen)), 0.45 * totalLen), 0.9 * totalLen), tendonPrefix = 0.25 * (totalLen - bellyLen);
    const maxRadius = Math.sqrt(muscleSpec.vol / (Math.PI * bellyLen * constants.C)), [ringsBefore, ringsBelly, ringsAfter] = constants.n, stations = [];
    for (let i = 0; i < ringsBefore; i++) stations.push(tendonPrefix * i / ringsBefore);
    for (let i = 0; i < ringsBelly; i++) stations.push(tendonPrefix + bellyLen * i / (ringsBelly - 1));
    for (let i = 0; i < ringsAfter; i++) stations.push(tendonPrefix + bellyLen + (totalLen - tendonPrefix - bellyLen) * (i + 1) / ringsAfter);
    const rings = { c: [], r: [], s: [], belly: [] };
    let j = 0;
    for (const station of stations) {
      while (j < segLens.length - 1 && cumLen[j + 1] <= station) j++;
      const f = (station - cumLen[j]) / (segLens[j] || 1e-12), u = Math.min(1, Math.max(0, (station - tendonPrefix) / bellyLen)), isBelly = station >= tendonPrefix - 1e-12 && station <= tendonPrefix + bellyLen + 1e-12;
      rings.c.push([0, 1, 2].map((t) => centerline[j][t] + (centerline[j + 1][t] - centerline[j][t]) * f));
      rings.r.push(isBelly ? Math.max(muscleSpec.rt, maxRadius * Math.sin(Math.PI * u) ** constants.exp) : muscleSpec.rt); rings.s.push(station / totalLen); rings.belly.push(isBelly);
    }
    const lastIdx = rings.r.length - 1;
    if (!rings.belly[0]) rings.r[0] = 1.5 * muscleSpec.rt;                  // entheses: tendons flare into the bone
    if (!rings.belly[lastIdx]) rings.r[lastIdx] = 1.5 * muscleSpec.rt;
    if (capsules && !isCompartment) for (const capsule of capsules) for (let k = 0; k <= lastIdx; k++) if (rings.belly[k]) pushPointOutOfBone(rings.c[k], 0.45 * rings.r[k], capsule);
    return rings;
  }
  // sheet muscle: mirror of anatomy.sheet_rings (half-width E(s) from origin to insertion extent, lens thickness t(s))
  function sheetMuscleRings(centerline, tendonLen, muscleSpec, constants, extentOrigin, extentInsert, capsules, anchorOrigin, anchorInsert) {   // anchors: the fibres' anchors on bone (world), or none
    const base = muscleBellyRings(centerline, tendonLen, muscleSpec, constants), n = base.c.length;
    let totalLen = 0; for (let j = 0; j + 1 < centerline.length; j++) totalLen += Math.hypot(centerline[j + 1][0] - centerline[j][0], centerline[j + 1][1] - centerline[j][1], centerline[j + 1][2] - centerline[j][2]);
    const arc = base.s.map((x) => x * totalLen), seg = arc.map((_, i) => (i === 0 ? arc[1] - arc[0] : i === n - 1 ? arc[n - 1] - arc[n - 2] : 0.5 * (arc[i + 1] - arc[i - 1])));
    let bellyLen = 0, bellyStart = Infinity; for (let i = 0; i < n; i++) if (base.belly[i]) { bellyLen += seg[i]; bellyStart = Math.min(bellyStart, arc[i]); }
    const halfExtents = [], halfWidths = [], profiles = []; let weightedSum = 0;
    for (let i = 0; i < n; i++) {
      const f = base.s[i], extent = [0, 1, 2].map((q) => (1 - f) * extentOrigin[q] + f * extentInsert[q]), extentLen = Math.hypot(...extent), halfW = Math.max(extentLen, base.belly[i] ? 0.6 * base.r[i] : muscleSpec.rt);
      let dir;
      if (extentLen > 1e-9) dir = extent.map((v) => v / extentLen);
      else { const a = base.c[Math.max(0, i - 1)], b = base.c[Math.min(n - 1, i + 1)], tangent = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]; let perp = [-tangent[2], 0, tangent[0]]; if (Math.hypot(...perp) < 1e-9) perp = [0, tangent[2], -tangent[1]]; const perpLen = Math.hypot(...perp) || 1; dir = perp.map((v) => v / perpLen); }
      halfExtents.push(dir.map((v) => v * halfW)); halfWidths.push(halfW);
      const prof = base.belly[i] ? Math.sin(Math.PI * Math.min(1, Math.max(0, (arc[i] - bellyStart) / (bellyLen || 1e-9)))) ** constants.exp : 0; profiles.push(prof); weightedSum += halfW * prof * seg[i];
    }
    const thicknessScale = muscleSpec.vol / Math.max(Math.PI / 2 * weightedSum, 1e-12);
    base.t = halfWidths.map((halfW, i) => Math.max(constants.apo, base.belly[i] ? Math.min(Math.max(thicknessScale * profiles[i], halfW <= muscleSpec.rt * 1.01 ? 2 * muscleSpec.rt : 0), 2 * halfW) : (halfW > 1.5 * muscleSpec.rt ? constants.apo : 2 * muscleSpec.rt)));
    if (capsules) for (const capsule of capsules) for (let k = 0; k < n; k++) if (base.belly[k]) pushPointOutOfBone(base.c[k], 0.4 * base.t[k], capsule);   // the sheet lies on the bone
    base.E = halfExtents; base.r = base.t.map((x) => 0.5 * x);
    if (anchorOrigin && anchorInsert) {                          // mirror of anatomy.anchor_offsets: each fibre starts and ends on bone
      const anchorCount = anchorOrigin.length, anchorU = anchorOrigin.map((_, k) => -1 + 2 * k / (anchorCount - 1)), firstCenter = base.c[0], lastCenter = base.c[n - 1], firstExtent = halfExtents[0], lastExtent = halfExtents[n - 1];
      base.dO = anchorOrigin.map((p, k) => [0, 1, 2].map((q) => p[q] - (firstCenter[q] + anchorU[k] * firstExtent[q])));
      base.dI = anchorInsert.map((p, k) => [0, 1, 2].map((q) => p[q] - (lastCenter[q] + anchorU[k] * lastExtent[q])));
    }
    return base;
  }
  const anchorOffsetCorrection = (ringData, arcPos, fibreIdx) => (ringData.dO ? [0, 1, 2].map((q) => (1 - arcPos) * ringData.dO[fibreIdx][q] + arcPos * ringData.dI[fibreIdx][q]) : [0, 0, 0]);
  const rotateVectorByPose = (poseRow, vec) => [poseRow[0] * vec[0] + poseRow[3] * vec[1] + poseRow[6] * vec[2], poseRow[1] * vec[0] + poseRow[4] * vec[1] + poseRow[7] * vec[2], poseRow[2] * vec[0] + poseRow[5] * vec[1] + poseRow[8] * vec[2]];
  function wrapPointOntoShell(point, margin, shellEllipsoids, snapBand = 0) {       // onto the ribcage / belly shell (+ margin); within snapBand: snap
    for (const ell of shellEllipsoids) {
      const delta = [point[0] - ell.c[0], point[1] - ell.c[1], point[2] - ell.c[2]], rows = ell.r;
      const q = [(rows[0] * delta[0] + rows[1] * delta[1] + rows[2] * delta[2]) / ell.a[0], (rows[3] * delta[0] + rows[4] * delta[1] + rows[5] * delta[2]) / ell.a[1], (rows[6] * delta[0] + rows[7] * delta[1] + rows[8] * delta[2]) / ell.a[2]];
      const norm = Math.hypot(...q), target = 1 + margin / Math.min(...ell.a);
      if (norm < target || (norm - target) * Math.min(...ell.a) < snapBand) { const f = target / Math.max(norm, 1e-9), scaled = [q[0] * f * ell.a[0], q[1] * f * ell.a[1], q[2] * f * ell.a[2]]; const world = rotateVectorByPose(rows, scaled); point = [ell.c[0] + world[0], ell.c[1] + world[1], ell.c[2] + world[2]]; }
    }
    return point;
  }
  const SHEET_MAT = standardMaterial(0xffffff, { vertexColors: true, roughness: 0.55, side: THREE.DoubleSide });
  function createSheetMesh(numRings, numAcross) {
    const geom = new THREE.BufferGeometry(), vertCount = 2 * numRings * numAcross;
    for (const [attr, size] of [['position', 3], ['color', 3]]) geom.setAttribute(attr, new THREE.BufferAttribute(new Float32Array(vertCount * size), size).setUsage(THREE.DynamicDrawUsage));
    const vertId = (side, i, j) => (side * numRings + i) * numAcross + j, faces = [];
    for (let i = 0; i + 1 < numRings; i++) for (let j = 0; j + 1 < numAcross; j++) {
      const a = vertId(0, i, j), b = vertId(0, i + 1, j), c = vertId(0, i + 1, j + 1), d = vertId(0, i, j + 1); faces.push(a, b, d, b, c, d);
      const topA = vertId(1, i, j), topB = vertId(1, i + 1, j), topC = vertId(1, i + 1, j + 1), topD = vertId(1, i, j + 1); faces.push(topA, topD, topB, topB, topD, topC);
    }
    geom.setIndex(faces); return new THREE.Mesh(geom, SHEET_MAT);
  }
  function createSectorMesh(numBelly, numAcross) {             // a compartment belly: lens-sector surface over its bone
    const geom = new THREE.BufferGeometry(), vertCount = numBelly * numAcross;
    for (const [attr, size] of [['position', 3], ['color', 3]]) geom.setAttribute(attr, new THREE.BufferAttribute(new Float32Array(vertCount * size), size).setUsage(THREE.DynamicDrawUsage));
    const faces = []; for (let i = 0; i + 1 < numBelly; i++) for (let j = 0; j + 1 < numAcross; j++) { const a = i * numAcross + j, b = a + numAcross; faces.push(a, b, a + 1, a + 1, b, b + 1); }
    geom.setIndex(faces); return new THREE.Mesh(geom, SHEET_MAT);
  }
  const RING_SIDES = 10;
  function createMuscleMesh(numRings) {
    const geom = new THREE.BufferGeometry(), vertCount = numRings * RING_SIDES;
    for (const [attr, size] of [['position', 3], ['normal', 3], ['color', 3]]) geom.setAttribute(attr, new THREE.BufferAttribute(new Float32Array(vertCount * size), size).setUsage(THREE.DynamicDrawUsage));
    const faces = []; for (let i = 0; i + 1 < numRings; i++) for (let j = 0; j < RING_SIDES; j++) { const a = i * RING_SIDES + j, b = i * RING_SIDES + (j + 1) % RING_SIDES, c = a + RING_SIDES, d = b + RING_SIDES; faces.push(a, c, b, b, c, d); }
    geom.setIndex(faces); return new THREE.Mesh(geom, Mats.muscle);
  }
  function buildAnatomyScene(model) {
    const anatomy = model.anatomy, root = new THREE.Group(), layers = { bones: new THREE.Group(), muscles: new THREE.Group(), organs: new THREE.Group() };
    Object.values(layers).forEach((group) => root.add(group));
    const boneIdx = Object.fromEntries(model.bones.map((b, i) => [b.name, i]));
    const bones = model.bones.map((b, i) => { const meshes = buildBoneMeshes(b.name, anatomy, model); layers.bones.add(meshes.g); return { g: meshes.g, soft: meshes.soft, i }; });
    // connective tissue spanning joints: capsules, ligaments and ligament chains, stretched between two bones each frame
    const linkGroup = new THREE.Group(), unitCylinder = new THREE.CylinderGeometry(1, 1, 1, 8, 1, false), links = []; root.add(linkGroup);
    for (const link of anatomy.links || []) for (const [endA, endB] of (link.t === 'chain' ? link.p.slice(0, -1).map((q, i) => [q, link.p[i + 1]]) : [[link.a, link.b]])) {
      const mesh = new THREE.Mesh(unitCylinder, link.m === 'capsule' ? CAPSULE_MAT : LIG_MAT); mesh.matrixAutoUpdate = false; linkGroup.add(mesh); links.push({ mesh, a: endA, b: endB, r: link.r }); }
    const organs = anatomy.organs.map((organ) => { const group = new THREE.Group(); group.matrixAutoUpdate = false; group.add(placeUnitMesh(unitSphere, Mats[organ.name] || Mats.chest, organ.c, organ.a)); layers.organs.add(group); return { g: group, i: boneIdx[organ.bone] }; });
    const ringCount = anatomy.const.n[0] + anatomy.const.n[1] + anatomy.const.n[2];
    const muscles = model.muscles.map((muscle, i) => { const compartment = anatomy.muscles[i].comp, mesh = muscle.sheet && !compartment ? createSheetMesh(ringCount, anatomy.const.na) : createMuscleMesh(ringCount); layers.muscles.add(mesh);
      const sector = compartment ? createSectorMesh(anatomy.const.n[1], anatomy.const.bu.length) : null; if (sector) layers.muscles.add(sector);
      return { m: mesh, sec: sector, comp: compartment, layer: anatomy.muscles[i].layer, mu: muscle, sp: anatomy.muscles[i], root: muscle.path[0][0], sheet: compartment ? null : muscle.sheet }; });
    const drawOrder = model.muscles.map((_, i) => i).filter((i) => anatomy.muscles[i].layer == null)
      .concat(model.muscles.map((_, i) => i).filter((i) => anatomy.muscles[i].layer != null).sort((a, b) => anatomy.muscles[a].layer - anatomy.muscles[b].layer || a - b));
    // skin
    const skin = anatomy.skin, quantized = decodeBase64(skin.pos, Uint16Array), vertCount = skin.n, rest = new Float32Array(vertCount * 3);
    for (let v = 0; v < vertCount; v++) for (let t = 0; t < 3; t++) rest[3 * v + t] = skin.lo[t] + quantized[3 * v + t] / 65535 * (skin.hi[t] - skin.lo[t]);
    const faces = vertCount < 65536 ? decodeBase64(skin.faces, Uint16Array) : decodeBase64(skin.faces, Uint32Array);
    const skinGeom = new THREE.BufferGeometry(); skinGeom.setAttribute('position', new THREE.BufferAttribute(rest.slice(), 3).setUsage(THREE.DynamicDrawUsage));
    skinGeom.setIndex(new THREE.BufferAttribute(faces, 1)); skinGeom.computeVertexNormals();
    const restNormals = skinGeom.attributes.normal.array.slice();
    const fatBytes = decodeBase64(skin.fat, Uint8Array), fatColors = new Float32Array(vertCount * 3), leanColor = new THREE.Color(PALETTE.fat[0]), fatColor = new THREE.Color(PALETTE.fat[1]), skinColor = new THREE.Color(PALETTE.skin);
    for (let v = 0; v < vertCount; v++) { const x = Math.min(1, fatBytes[v] / 255 * 0.02 / 0.008), c = fatBytes[v] ? leanColor.clone().lerp(fatColor, x) : skinColor; fatColors[3 * v] = c.r; fatColors[3 * v + 1] = c.g; fatColors[3 * v + 2] = c.b; }
    skinGeom.setAttribute('color', new THREE.BufferAttribute(fatColors, 3));
    const skinMesh = new THREE.Mesh(skinGeom, Mats.skin); skinMesh.renderOrder = 2; root.add(skinMesh);
    // fur: per-vertex length from the bone the skin moves with; the rest position and normal anchor the strands
    const boneOfVert = decodeBase64(skin.bi, Uint8Array), furLens = new Float32Array(vertCount);
    for (let v = 0; v < vertCount; v++) furLens[v] = FUR_LEN[boneKindName(model.bones[boneOfVert[4 * v]].name)] ?? 0.012;
    skinGeom.setAttribute('furLen', new THREE.BufferAttribute(furLens, 1)); skinGeom.setAttribute('restPos', new THREE.BufferAttribute(rest, 3)); skinGeom.setAttribute('restNrm', new THREE.BufferAttribute(restNormals, 3));
    const fur = new THREE.Group(); FUR_MATERIALS.forEach((mat, i) => { const layer = new THREE.Mesh(skinGeom, mat); layer.renderOrder = 3 + i; layer.frustumCulled = false; fur.add(layer); }); root.add(fur);
    const restInverse = skin.rest.map((poseRow) => poseRowToMatrix4(poseRow).invert());
    // the skin over bone: for each tracked part under a skin vertex, the part's point nearest the vertex at rest and
    // the direction from it to the vertex (bone frame). Each frame the vertex stays on that side of that point by
    // KEEP of its rest depth -- one-sided, so skin that slides past a rib to the inside is put back outside it
    const anchorParts = skin.hp ? skin.hp.map(prepareSkinAnchorPart) : null, anchorPartIdx = skin.kp ? decodeBase64(skin.kp, Uint16Array) : null, anchorDepth = skin.kd ? decodeBase64(skin.kd, Uint8Array) : null, anchorsPerVert = skin.nk || 3;
    let anchorTable = null;
    if (anchorParts && anchorPartIdx) {
      anchorTable = new Float32Array(vertCount * anchorsPerVert * 6);
      for (let v = 0; v < vertCount; v++) for (let j = 0; j < anchorsPerVert; j++) {
        const partIdx = anchorPartIdx[anchorsPerVert * v + j]; if (partIdx === 65535) continue;
        const part = anchorParts[partIdx], frame = skin.rest[part.b], delta = [rest[3 * v] - frame[9], rest[3 * v + 1] - frame[10], rest[3 * v + 2] - frame[11]];
        const local = [frame[0] * delta[0] + frame[1] * delta[1] + frame[2] * delta[2], frame[3] * delta[0] + frame[4] * delta[1] + frame[5] * delta[2], frame[6] * delta[0] + frame[7] * delta[1] + frame[8] * delta[2]];
        const dist = partSignedDistance(part, local), eps = 1e-4, grad = [0, 1, 2].map((t) => { const up = local.slice(), down = local.slice(); up[t] += eps; down[t] -= eps; return partSignedDistance(part, up) - partSignedDistance(part, down); });
        const gradLen = Math.hypot(...grad) || 1e-12, dir = grad.map((x) => x / gradLen), dirWorld = [frame[0] * dir[0] + frame[3] * dir[1] + frame[6] * dir[2], frame[1] * dir[0] + frame[4] * dir[1] + frame[7] * dir[2], frame[2] * dir[0] + frame[5] * dir[1] + frame[8] * dir[2]];
        if (dirWorld[0] * restNormals[3 * v] + dirWorld[1] * restNormals[3 * v + 1] + dirWorld[2] * restNormals[3 * v + 2] < 0.5) { anchorPartIdx[anchorsPerVert * v + j] = 65535; continue; }   // not under this skin
        const slot = 6 * (anchorsPerVert * v + j); anchorTable[slot] = local[0] - dist * dir[0]; anchorTable[slot + 1] = local[1] - dist * dir[1]; anchorTable[slot + 2] = local[2] - dist * dir[2]; anchorTable[slot + 3] = dir[0]; anchorTable[slot + 4] = dir[1]; anchorTable[slot + 5] = dir[2];
      }
    }
    const applyRestPose = (boneName, point) => { const poseRow = skin.rest[boneIdx[boneName]]; return [poseRow[9] + poseRow[0] * point[0] + poseRow[3] * point[1] + poseRow[6] * point[2], poseRow[10] + poseRow[1] * point[0] + poseRow[4] * point[1] + poseRow[7] * point[2], poseRow[11] + poseRow[2] * point[0] + poseRow[5] * point[1] + poseRow[8] * point[2]]; };
    const restCompartments = layoutCompartmentBands(anatomy, (i) => muscleBellyRings(model.muscles[i].path.map(([bone, point]) => applyRestPose(bone, point)), model.muscles[i].lts, anatomy.muscles[i], anatomy.const), (bone) => skin.rest[boneIdx[bone]]);
    const restRings = model.muscles.map((muscle, i) => { const centerline = muscle.path.map(([bone, point]) => applyRestPose(bone, point));
      const capsules = [...new Set(muscle.path.map((seg) => seg[0]))].filter((bone) => anatomy.shafts[bone]).map((bone) => [applyRestPose(bone, [0, 0, 0]), applyRestPose(bone, [anatomy.shafts[bone][0], 0, 0]), anatomy.shafts[bone][1]]);
      if (anatomy.muscles[i].comp) return restCompartments[i];
      const anchors = anatomy.muscles[i].anch;
      return muscle.sheet ? sheetMuscleRings(centerline, muscle.lts, anatomy.muscles[i], anatomy.const, rotateVectorByPose(skin.rest[boneIdx[muscle.path[0][0]]], muscle.sheet.o), rotateVectorByPose(skin.rest[boneIdx[muscle.path[muscle.path.length - 1][0]]], muscle.sheet.i), capsules,
                                   anchors && anchors[0].map(([bone, point]) => applyRestPose(bone, point)), anchors && anchors[1].map(([bone, point]) => applyRestPose(bone, point)))
        : muscleBellyRings(centerline, muscle.lts, anatomy.muscles[i], anatomy.const, capsules); });
    return { root, L: layers, bones, organs, muscles, order: drawOrder, skin: skinMesh, fur, linkG: linkGroup, links, hpBone: anchorParts ? anchorParts.map((part) => part.b) : null, sk: { rest, restN: restNormals, restInv: restInverse, restRings, bi: decodeBase64(skin.bi, Uint8Array),
      ka: anchorTable, kp: anchorPartIdx, kd: anchorDepth, keep: skin.keep || 0.85, nk: anchorsPerVert, bw: decodeBase64(skin.bw, Uint8Array), mi: decodeBase64(skin.mi, Uint16Array), mw: decodeBase64(skin.mw, Uint8Array), ms: decodeBase64(skin.ms, Uint8Array), mr: decodeBase64(skin.mr, Uint16Array), ma: decodeBase64(skin.ma, Uint8Array), nv: vertCount }, C: anatomy.const, info: skin };
  }
  // shell fur: the skin drawn again, offset along its normals, strands anchored to the rest position
  const FUR_SHELLS = 14;
  const FUR_LEN = { thorax: 0.022, lumbar: 0.024, pelvis: 0.022, neck: 0.026, head: 0.007, tail: 0.035, scapula: 0.02, humerus: 0.016,
    femur: 0.018, antebrachium: 0.009, tibia: 0.01, manus: 0.005, pes: 0.005 };
  const boneKindName = (name) => { const stripped = name.replace(/^[LRC][FH1-9]_/, ''); return /^(neck|tail|lumbar)/.test(stripped) ? stripped.split('_')[0] : stripped; };
  const COAT = { top: new THREE.Color(0x5a3c24), side: new THREE.Color(0xa47448), belly: new THREE.Color(0xe2c9a4) };
  function makeFurMaterial(shellFraction) {
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 });
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, { uH: { value: shellFraction }, uDens: { value: 520 }, uComb: { value: new THREE.Vector3(-0.55, -0.35, 0) },
        uTop: { value: COAT.top }, uSide: { value: COAT.side }, uBelly: { value: COAT.belly } });
      shader.vertexShader = 'attribute float furLen; attribute vec3 restPos; attribute vec3 restNrm; varying vec3 vRest; varying float vUp; uniform float uH; uniform vec3 uComb;\n' +
        shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
          vec3 fdir = normalize(normal + uComb * (uH * uH * 1.6));
          transformed += fdir * furLen * uH; vRest = restPos; vUp = restNrm.y;`);
      shader.fragmentShader = `varying vec3 vRest; varying float vUp; uniform float uH; uniform float uDens; uniform vec3 uTop; uniform vec3 uSide; uniform vec3 uBelly;
        float hash13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }\n` +
        shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
          vec3 q = vRest * uDens, cell = floor(q); float r = hash13(cell);
          vec3 f = fract(q) - 0.5;
          if (uH > 0.0 && (r < uH * 0.92 || length(f) > 0.62 * (1.0 - uH) + 0.18)) discard;   // strands of random length, tapering
          vec3 coat = mix(uBelly, uSide, smoothstep(-0.55, -0.05, vUp)); coat = mix(coat, uTop, smoothstep(0.25, 0.8, vUp));
          diffuseColor.rgb = coat * (0.5 + 0.5 * uH) * (0.85 + 0.3 * hash13(cell + 17.0));`);
    };
    return mat;
  }
  const FUR_MATERIALS = Array.from({ length: FUR_SHELLS }, (_, i) => makeFurMaterial((i + 1) / FUR_SHELLS));
  const UNDERCOAT_MAT = makeFurMaterial(0.0);          // the skin under the fur: coat-coloured undercoat
  const builtByModel = new Map();
  let shownBuild = null;
  const tmpMatrix = new THREE.Matrix4(), muscleColor = new THREE.Color(), tendonColor = new THREE.Color(PALETTE.tendon), muscleLowColor = new THREE.Color(0x9a4a44), muscleHighColor = new THREE.Color(0xff5a2e);
  function sheetSurfacePoint(ringData, arcPos, acrossCoord) { const center = centerlinePoint(ringData, arcPos); if (!ringData.E) return center; const stations = ringData.s; let j = 0; while (j < stations.length - 2 && stations[j + 1] < arcPos) j++; const f = Math.min(1, Math.max(0, (arcPos - stations[j]) / ((stations[j + 1] - stations[j]) || 1)));
    let offset = [0, 0, 0];
    if (ringData.dO) { const anchorCount = ringData.dO.length, x = Math.min(anchorCount - 1.000001, Math.max(0, (acrossCoord + 1) / 2 * (anchorCount - 1))), k = Math.floor(x), frac = x - k, corr0 = anchorOffsetCorrection(ringData, arcPos, k), corr1 = anchorOffsetCorrection(ringData, arcPos, k + 1); offset = [0, 1, 2].map((q) => corr0[q] * (1 - frac) + corr1[q] * frac); }
    return [0, 1, 2].map((q) => center[q] + acrossCoord * (ringData.E[j][q] * (1 - f) + ringData.E[j + 1][q] * f) + offset[q]); }
  function centerlinePoint(ringData, arcPos) { const stations = ringData.s; let j = 0; while (j < stations.length - 2 && stations[j + 1] < arcPos) j++; const f = Math.min(1, Math.max(0, (arcPos - stations[j]) / ((stations[j + 1] - stations[j]) || 1))), a = ringData.c[j], b = ringData.c[j + 1]; return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]; }
  function centerlineRadius(ringData, arcPos) { const stations = ringData.s; let j = 0; while (j < stations.length - 2 && stations[j + 1] < arcPos) j++; const f = Math.min(1, Math.max(0, (arcPos - stations[j]) / ((stations[j + 1] - stations[j]) || 1))); return ringData.r[j] * (1 - f) + ringData.r[j + 1] * f; }
  function drawAnatomyFrame(model, sol, pose, frameA, frameB, blend, target, options, widthPx, heightPx, pixelRatio) {
    if (!model.anatomy) return false;
    if (!builtByModel.has(model)) builtByModel.set(model, buildAnatomyScene(model));
    const build = builtByModel.get(model);
    if (shownBuild !== build) { if (shownBuild) scene.remove(shownBuild.root); scene.add(build.root); shownBuild = build; }
    if (gridColor !== theme.grid) { if (grid) scene.remove(grid); grid = new THREE.GridHelper(3.2, 32, theme.grid, theme.grid); scene.add(grid); gridColor = theme.grid; }
    grid.position.set(Math.round(target[0] * 10) / 10, 0, 0);
    renderer.setClearColor(theme.surface);
    build.L.bones.visible = options.bones; build.L.muscles.visible = options.muscles; build.L.organs.visible = options.organs; build.skin.visible = options.skin; if (!options.skin) build.fur.visible = false;
    const boneMatrices = pose.map((poseRow) => poseRowToMatrix4(poseRow));
    build.bones.forEach((bone) => { bone.g.matrix.copy(boneMatrices[bone.i]); bone.g.matrixWorldNeedsUpdate = true; bone.soft.visible = options.lig; });
    build.linkG.visible = options.lig;
    if (options.lig) for (const link of build.links) {
      const endA = toVec3(applyBonePose(pose, link.a[0], link.a[1])), endB = toVec3(applyBonePose(pose, link.b[0], link.b[1])), delta = endB.clone().sub(endA), len = delta.length() || 1e-6;
      link.mesh.matrix.compose(endA.add(endB).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(Y_UP, delta.multiplyScalar(1 / len)), new THREE.Vector3(link.r, len, link.r)); link.mesh.matrixWorldNeedsUpdate = true;
    }
    build.organs.forEach((organ) => { organ.g.matrix.copy(boneMatrices[organ.i]); organ.g.matrixWorldNeedsUpdate = true; });
    // muscles: rings from this frame's path and tendon length
    const wrapEllipsoids = (model.anatomy.wrap || []).map((ell) => ({ c: applyBonePose(pose, ell.bone, ell.c), r: pose[boneIndex[ell.bone]], a: ell.a }));
    let placedStack = [], layerStack = [], layerDepth = null, placedCells = null;
    const hashPlacedStack = (placed, cellSize) => { const cells = new Map(); for (const entry of placed) { const key = `${Math.floor(entry[0][0] / cellSize)},${Math.floor(entry[0][1] / cellSize)},${Math.floor(entry[0][2] / cellSize)}`; (cells.get(key) || cells.set(key, []).get(key)).push(entry); } return cells; };
    const kernel = build.C.kernel || 0.025, snapBand = build.C.band || 0;
    const layoutMuscle = (entry, i) => {
      const centerline = entry.mu.path.map(([bone, point]) => applyBonePose(pose, bone, point));
      const capsules = [...new Set(entry.mu.path.map((seg) => seg[0]))].filter((bone) => model.anatomy.shafts[bone]).map((bone) => [applyBonePose(pose, bone, [0, 0, 0]), applyBonePose(pose, bone, [model.anatomy.shafts[bone][0], 0, 0]), model.anatomy.shafts[bone][1]]);
      const tendonLen = sol.lt ? sol.lt[i][frameA] * (1 - blend) + sol.lt[i][frameB] * blend : entry.mu.lts;
      if (entry.sheet) {
        const path = entry.mu.path, anchors = entry.sp.anch;
        const ringData = sheetMuscleRings(centerline, tendonLen, entry.sp, build.C, rotateVectorByPose(pose[boneIndex[path[0][0]]], entry.sheet.o), rotateVectorByPose(pose[boneIndex[path[path.length - 1][0]]], entry.sheet.i), capsules,
                             anchors && anchors[0].map(([bone, point]) => applyBonePose(pose, bone, point)), anchors && anchors[1].map(([bone, point]) => applyBonePose(pose, bone, point)));
        if (!options.muscles) return ringData;
        const positions = entry.m.geometry.attributes.position.array, colors = entry.m.geometry.attributes.color.array, numRings = ringData.c.length, numAcross = build.C.na;
        const activation = sol.a[i][frameA] * (1 - blend) + sol.a[i][frameB] * blend; muscleColor.copy(muscleLowColor).lerp(muscleHighColor, Math.min(1, activation * 1.6));
        for (let ring = 0; ring < numRings; ring++) {
          const prev = ringData.c[Math.max(0, ring - 1)], next = ringData.c[Math.min(numRings - 1, ring + 1)], tangent = [next[0] - prev[0], next[1] - prev[1], next[2] - prev[2]], extent = ringData.E[ring];
          let normal = [tangent[1] * extent[2] - tangent[2] * extent[1], tangent[2] * extent[0] - tangent[0] * extent[2], tangent[0] * extent[1] - tangent[1] * extent[0]]; const normalLen = Math.hypot(...normal) || 1; normal = normal.map((v) => v / normalLen);
          const faceColor = ringData.belly[ring] ? muscleColor : tendonColor, halfThick = 0.5 * ringData.t[ring];
          for (let across = 0; across < numAcross; across++) {
            const acrossCoord = -1 + 2 * across / (numAcross - 1), halfW = halfThick * Math.sqrt(Math.max(0, 1 - acrossCoord * acrossCoord));
            const anchorShift = anchorOffsetCorrection(ringData, ringData.s[ring], across);
            let surf = [ringData.c[ring][0] + acrossCoord * extent[0] + anchorShift[0], ringData.c[ring][1] + acrossCoord * extent[1] + anchorShift[1], ringData.c[ring][2] + acrossCoord * extent[2] + anchorShift[2]];
            if (entry.layer != null) {                  // rests on the deeper layers (mirror of anatomy.stack_sheet)
              const base = wrapPointOntoShell(surf, 0, wrapEllipsoids, snapBand); let need = 0;
              const cellI = Math.floor(base[0] / kernel), cellJ = Math.floor(base[1] / kernel), cellK = Math.floor(base[2] / kernel);
              for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) for (let dk = -1; dk <= 1; dk++)
                for (const [belowPoint, belowTop] of placedCells.get(`${cellI + di},${cellJ + dj},${cellK + dk}`) || []) if (belowTop > need && Math.hypot(base[0] - belowPoint[0], base[1] - belowPoint[1], base[2] - belowPoint[2]) < kernel) need = belowTop;
              surf = wrapPointOntoShell(surf, need + halfW, wrapEllipsoids, snapBand); layerStack.push([base, need + 2 * halfW]);
            } else if (entry.sheet.wrap) surf = wrapPointOntoShell(surf, halfW, wrapEllipsoids);
            for (let side = 0; side < 2; side++) { const sign = side ? -1 : 1, v = 3 * ((side * numRings + ring) * numAcross + across);
              positions[v] = surf[0] + sign * halfW * normal[0]; positions[v + 1] = surf[1] + sign * halfW * normal[1]; positions[v + 2] = surf[2] + sign * halfW * normal[2]; colors[v] = faceColor.r; colors[v + 1] = faceColor.g; colors[v + 2] = faceColor.b; }
          }
        }
        const geom = entry.m.geometry; geom.attributes.position.needsUpdate = geom.attributes.color.needsUpdate = true; geom.computeBoundingSphere();   // normals after the press
        return ringData;
      }
      const ringData = entry.comp ? compartmentRings[i] : muscleBellyRings(centerline, tendonLen, entry.sp, build.C, capsules);
      if (entry.sec) entry.sec.visible = options.muscles;
      if (!options.muscles) return ringData;
      if (entry.comp) {                                 // the muscle's outer surface over its band (deeper ones lie under it)
        const positions = entry.sec.geometry.attributes.position.array, colors = entry.sec.geometry.attributes.color.array, compartment = entry.comp, numAcross = build.C.bu.length;
        const activation = sol.a[i][frameA] * (1 - blend) + sol.a[i][frameB] * blend; muscleColor.copy(muscleLowColor).lerp(muscleHighColor, Math.min(1, activation * 1.6));
        let bellyRow = 0;
        for (let ring = 0; ring < ringData.c.length; ring++) {
          if (!ringData.belly[ring]) continue;
          for (let across = 0; across < numAcross; across++) {
            const surf = bandSurfacePoint(compartment, ringData.fr, ringData.xk[ring], build.C.bu[across], ringData.out[ring][across] + 3e-4 * compartment.depth), v = 3 * (bellyRow * numAcross + across);   // superficial wins ties
            positions[v] = surf[0]; positions[v + 1] = surf[1]; positions[v + 2] = surf[2]; colors[v] = muscleColor.r; colors[v + 1] = muscleColor.g; colors[v + 2] = muscleColor.b;
          }
          bellyRow++;
        }
        const sectorGeom = entry.sec.geometry; sectorGeom.attributes.position.needsUpdate = sectorGeom.attributes.color.needsUpdate = true; sectorGeom.computeBoundingSphere();   // normals after the press
      }
      const positions = entry.m.geometry.attributes.position.array, normals = entry.m.geometry.attributes.normal.array, colors = entry.m.geometry.attributes.color.array;
      const activation = sol.a[i][frameA] * (1 - blend) + sol.a[i][frameB] * blend; muscleColor.copy(muscleLowColor).lerp(muscleHighColor, Math.min(1, activation * 1.6));
      const numRings = ringData.c.length, flat = entry.sp.flat, squash = Math.sqrt(flat);
      // reference for the cross-section's thin axis: away from the root bone's axis (sheet muscles lie flat on it)
      const rootA = applyBonePose(pose, entry.root, [0, 0, 0]), rootB = applyBonePose(pose, entry.root, [model.bones[boneIndex[entry.root]].length, 0, 0]), midCenter = ringData.c[numRings >> 1];
      const rootAxis = [rootB[0] - rootA[0], rootB[1] - rootA[1], rootB[2] - rootA[2]], rootAxisLen2 = rootAxis[0] ** 2 + rootAxis[1] ** 2 + rootAxis[2] ** 2 || 1;
      const projT = Math.max(0, Math.min(1, ((midCenter[0] - rootA[0]) * rootAxis[0] + (midCenter[1] - rootA[1]) * rootAxis[1] + (midCenter[2] - rootA[2]) * rootAxis[2]) / rootAxisLen2));
      let thinAxis = [midCenter[0] - rootA[0] - projT * rootAxis[0], midCenter[1] - rootA[1] - projT * rootAxis[1], midCenter[2] - rootA[2] - projT * rootAxis[2]];
      if (Math.hypot(...thinAxis) < 1e-6) thinAxis = [0, 1, 0];
      for (let ring = 0; ring < numRings; ring++) {
        const prev = ringData.c[Math.max(0, ring - 1)], next = ringData.c[Math.min(numRings - 1, ring + 1)];
        let tangent = [next[0] - prev[0], next[1] - prev[1], next[2] - prev[2]]; const tangentLen = Math.hypot(...tangent) || 1; tangent = tangent.map((v) => v / tangentLen);
        const along = thinAxis[0] * tangent[0] + thinAxis[1] * tangent[1] + thinAxis[2] * tangent[2]; thinAxis = [thinAxis[0] - along * tangent[0], thinAxis[1] - along * tangent[1], thinAxis[2] - along * tangent[2]];
        const thinLen = Math.hypot(...thinAxis) || 1; thinAxis = thinAxis.map((v) => v / thinLen);
        const wideAxis = [tangent[1] * thinAxis[2] - tangent[2] * thinAxis[1], tangent[2] * thinAxis[0] - tangent[0] * thinAxis[2], tangent[0] * thinAxis[1] - tangent[1] * thinAxis[0]];
        const ringRadius = entry.comp && ringData.belly[ring] ? entry.sp.rt : ringData.r[ring], squashHere = entry.comp ? 1 : squash;
        const wide = ringData.belly[ring] ? ringRadius * squashHere : ringRadius, thin = ringData.belly[ring] ? ringRadius / squashHere : ringRadius;
        const faceColor = ringData.belly[ring] ? muscleColor : tendonColor;
        for (let side = 0; side < RING_SIDES; side++) {
          const phase = 2 * Math.PI * side / RING_SIDES, cosP = Math.cos(phase), sinP = Math.sin(phase), v = 3 * (ring * RING_SIDES + side);
          for (let q = 0; q < 3; q++) { positions[v + q] = ringData.c[ring][q] + wide * cosP * wideAxis[q] + thin * sinP * thinAxis[q]; normals[v + q] = cosP / wide * wideAxis[q] + sinP / thin * thinAxis[q]; }
          const normalLen = Math.hypot(normals[v], normals[v + 1], normals[v + 2]) || 1; normals[v] /= normalLen; normals[v + 1] /= normalLen; normals[v + 2] /= normalLen;
          colors[v] = faceColor.r; colors[v + 1] = faceColor.g; colors[v + 2] = faceColor.b;
        }
      }
      const geom = entry.m.geometry; geom.attributes.position.needsUpdate = geom.attributes.normal.needsUpdate = geom.attributes.color.needsUpdate = true; geom.computeBoundingSphere();
      return ringData;
    };
    const compartmentRings = layoutCompartmentBands(model.anatomy, (i) => {         // compartment muscles: all of a bone's bands at once
      const entry = build.muscles[i], tendonLen = sol.lt ? sol.lt[i][frameA] * (1 - blend) + sol.lt[i][frameB] * blend : entry.mu.lts;
      return muscleBellyRings(entry.mu.path.map(([bone, point]) => applyBonePose(pose, bone, point)), tendonLen, entry.sp, build.C);
    }, (bone) => pose[boneIndex[bone]]);
    const frameRings = new Array(build.muscles.length);
    for (const i of build.order) {                      // deeper layers first: the sheets above rest on them
      const entry = build.muscles[i];
      if (entry.layer != null && entry.layer !== layerDepth) { placedStack = placedStack.concat(layerStack); layerStack = []; layerDepth = entry.layer; placedCells = hashPlacedStack(placedStack, kernel); }
      frameRings[i] = layoutMuscle(entry, i);
    }
    // skin: bones' motion blended by the tissue under each vertex, plus the bulge of the belly under it
    if (options.skin || options.muscles) {                 // (the muscles are pressed under it even when it is hidden)
      const skinData = build.sk, skinPositions = build.skin.geometry.attributes.position.array, skinNormals = build.skin.geometry.attributes.normal.array, anchorBones = build.hpBone;
      const boneRelative = boneMatrices.map((mat, b) => tmpMatrix.multiplyMatrices(mat, skinData.restInv[b]).elements.slice());
      for (let v = 0; v < skinData.nv; v++) {
        const restX = skinData.rest[3 * v], restY = skinData.rest[3 * v + 1], restZ = skinData.rest[3 * v + 2], restNx = skinData.restN[3 * v], restNy = skinData.restN[3 * v + 1], restNz = skinData.restN[3 * v + 2];
        let px = 0, py = 0, pz = 0, nx = 0, ny = 0, nz = 0, weightSum = 0;
        for (let j = 0; j < 4; j++) {
          const weight = skinData.bw[4 * v + j]; if (!weight) continue; const rel = boneRelative[skinData.bi[4 * v + j]]; weightSum += weight;
          px += weight * (rel[0] * restX + rel[4] * restY + rel[8] * restZ + rel[12]); py += weight * (rel[1] * restX + rel[5] * restY + rel[9] * restZ + rel[13]); pz += weight * (rel[2] * restX + rel[6] * restY + rel[10] * restZ + rel[14]);
          nx += weight * (rel[0] * restNx + rel[4] * restNy + rel[8] * restNz); ny += weight * (rel[1] * restNx + rel[5] * restNy + rel[9] * restNz); nz += weight * (rel[2] * restNx + rel[6] * restNy + rel[10] * restNz);
        }
        weightSum = weightSum || 1; px /= weightSum; py /= weightSum; pz /= weightSum;
        const normalLen = Math.hypot(nx, ny, nz) || 1; nx /= normalLen; ny /= normalLen; nz /= normalLen;
        const muscleIdx = skinData.mi[v];
        if (muscleIdx !== 65535 && skinData.mw[v]) {
          // follow the muscle under the vertex: its centreline's motion beyond what the bones' blend gives,
          // plus the belly's change in thickness along the normal
          const arcPos = skinData.ms[v] / 255, muscleWeight = skinData.mw[v] / 255, acrossCoord = skinData.ma[v] / 255 * 2 - 1;
          const bandNow = frameRings[muscleIdx].band ? bandCenterAndHalf(frameRings[muscleIdx], arcPos, acrossCoord) : null, bandRest = bandNow ? bandCenterAndHalf(skinData.restRings[muscleIdx], arcPos, acrossCoord) : null;
          const centerRest = bandRest ? bandRest[0] : sheetSurfacePoint(skinData.restRings[muscleIdx], arcPos, acrossCoord), centerNow = bandNow && bandRest ? bandNow[0] : sheetSurfacePoint(frameRings[muscleIdx], arcPos, acrossCoord);
          let blendCx = 0, blendCy = 0, blendCz = 0;
          for (let j = 0; j < 4; j++) { const weight = skinData.bw[4 * v + j]; if (!weight) continue; const rel = boneRelative[skinData.bi[4 * v + j]];
            blendCx += weight * (rel[0] * centerRest[0] + rel[4] * centerRest[1] + rel[8] * centerRest[2] + rel[12]); blendCy += weight * (rel[1] * centerRest[0] + rel[5] * centerRest[1] + rel[9] * centerRest[2] + rel[13]); blendCz += weight * (rel[2] * centerRest[0] + rel[6] * centerRest[1] + rel[10] * centerRest[2] + rel[14]); }
          const thickening = (bandNow && bandRest ? bandNow[1] - bandRest[1] : centerlineRadius(frameRings[muscleIdx], arcPos) * (frameRings[muscleIdx].E ? Math.sqrt(Math.max(0, 1 - acrossCoord * acrossCoord)) : 1) - skinData.mr[v] / 1e4) * muscleWeight;
          px += muscleWeight * (centerNow[0] - blendCx / weightSum) + nx * thickening; py += muscleWeight * (centerNow[1] - blendCy / weightSum) + ny * thickening; pz += muscleWeight * (centerNow[2] - blendCz / weightSum) + nz * thickening;
        }
        if (skinData.ka) for (let j = 0; j < skinData.nk; j++) {   // keeps its depth over the bones under it, on their outer side
          const partIdx = skinData.kp[skinData.nk * v + j]; if (partIdx === 65535) continue;
          const frame = pose[anchorBones[partIdx]], slot = 6 * (skinData.nk * v + j), delta = [px - frame[9], py - frame[10], pz - frame[11]];
          const height = (frame[0] * delta[0] + frame[1] * delta[1] + frame[2] * delta[2] - skinData.ka[slot]) * skinData.ka[slot + 3] + (frame[3] * delta[0] + frame[4] * delta[1] + frame[5] * delta[2] - skinData.ka[slot + 1]) * skinData.ka[slot + 4] + (frame[6] * delta[0] + frame[7] * delta[1] + frame[8] * delta[2] - skinData.ka[slot + 2]) * skinData.ka[slot + 5];
          const want = skinData.keep * skinData.kd[skinData.nk * v + j] / 5e3;
          if (height < want) { const push = want - height, dir = [skinData.ka[slot + 3], skinData.ka[slot + 4], skinData.ka[slot + 5]];
            px += push * (frame[0] * dir[0] + frame[3] * dir[1] + frame[6] * dir[2]); py += push * (frame[1] * dir[0] + frame[4] * dir[1] + frame[7] * dir[2]); pz += push * (frame[2] * dir[0] + frame[5] * dir[1] + frame[8] * dir[2]); }
        }
        skinPositions[3 * v] = px; skinPositions[3 * v + 1] = py; skinPositions[3 * v + 2] = pz; skinNormals[3 * v] = nx; skinNormals[3 * v + 1] = ny; skinNormals[3 * v + 2] = nz;
      }
      const skinGeom = build.skin.geometry; skinGeom.attributes.position.needsUpdate = skinGeom.attributes.normal.needsUpdate = true; skinGeom.computeBoundingSphere();
      if (options.muscles) pressMusclesBeneathSkin(build.muscles.flatMap((entry) => (entry.sec ? [[entry.m.geometry, false], [entry.sec.geometry, true]] : [[entry.m.geometry, !!entry.sheet]])), skinPositions, skinNormals, skinData.nv,
                                     build.skin.geometry.index.array, build.skinVertFaces || (build.skinVertFaces = facesAroundEachVertex(build.skin.geometry.index.array, skinData.nv)));
      const useTransparent = options.opacity < 0.999; if (Mats.skin.transparent !== useTransparent) { Mats.skin.transparent = useTransparent; Mats.skin.needsUpdate = true; } Mats.skin.opacity = options.opacity; Mats.skin.depthWrite = !useTransparent;
      const furOn = options.fur && !useTransparent; build.fur.visible = furOn; build.skin.material = furOn ? UNDERCOAT_MAT : Mats.skin;
      if (Mats.skin.vertexColors !== options.fat) { Mats.skin.vertexColors = options.fat; Mats.skin.color.set(options.fat ? 0xffffff : PALETTE.skin); Mats.skin.needsUpdate = true; }
    }
    // cutaway: drop the half of the shells nearest the camera
    const viewDir = [Math.sin(orbitCam.az), 0, Math.cos(orbitCam.az)], rootPose = pose[boneIndex[model.root || 'thorax']] || pose[0];
    clipPlane.normal.set(-viewDir[0], 0, -viewDir[2]); clipPlane.constant = viewDir[0] * rootPose[9] + viewDir[2] * rootPose[11];
    const clipPlanes = options.cut ? [clipPlane] : [];
    [Mats.skin, Mats.chest, Mats.abdomen, UNDERCOAT_MAT, ...FUR_MATERIALS].forEach((mat) => { if ((mat.clippingPlanes || []).length !== clipPlanes.length) { mat.clippingPlanes = clipPlanes; mat.side = options.cut ? THREE.DoubleSide : THREE.FrontSide; mat.needsUpdate = true; } });   // inside of the far half shows
    // camera: the same orbit and framing as the 2D view
    renderer.setPixelRatio(pixelRatio); if (canvas3d.width !== widthPx || canvas3d.height !== heightPx) renderer.setSize(widthPx / pixelRatio, heightPx / pixelRatio, false);
    const cosEl = Math.cos(orbitCam.el);
    camera3d.position.set(target[0] + orbitCam.dist * cosEl * Math.sin(orbitCam.az), target[1] + orbitCam.dist * Math.sin(orbitCam.el), target[2] + orbitCam.dist * cosEl * Math.cos(orbitCam.az));
    camera3d.up.set(0, 1, 0); camera3d.lookAt(target[0], target[1], target[2]); camera3d.aspect = widthPx / heightPx;
    camera3d.setViewOffset(widthPx, heightPx, 0, -0.05 * heightPx, widthPx, heightPx); camera3d.updateProjectionMatrix();
    renderer.render(scene, camera3d);
    return build.info;
  }
  return { draw: drawAnatomyFrame };
})();

export const anatomyOptions = () => ({ bones: document.getElementById('an-bones').checked, muscles: document.getElementById('an-mus').checked,
  organs: document.getElementById('an-org').checked, lig: document.getElementById('an-lig').checked, skin: document.getElementById('an-skin').checked, opacity: +document.getElementById('an-op').value,
  cut: document.getElementById('an-cut').checked, fat: document.getElementById('an-fat').checked, fur: document.getElementById('an-fur').checked });
