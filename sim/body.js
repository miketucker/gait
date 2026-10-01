// Articulated body: a tree of rigid segments joined by 1-3 axis rotational joints,
// with a 6-DOF floating root. Every segment's body frame is aligned with the world
// (x forward, y up, z left) in the reference posture, where all joint angles are 0,
// so a joint angle reads the same way on every segment: rz flexion, rx roll/abduction,
// ry yaw/axial rotation.
//
// Joint rotation: R_child = R_parent * R_a1(q1) * R_a2(q2) * ... (axes in listed order).
// Root rotation:  R_root  = Ry(yaw) * Rz(pitch) * Rx(roll), stored as root_rx/ry/rz.
import { AXIS, postRotate, add, sub, cross, normalize, matMul, matVec, matTVec, fromColumns, rotX, rotY, rotZ } from './math.js';

export const ROOT_DOFS = ['root_px', 'root_py', 'root_pz', 'root_rx', 'root_ry', 'root_rz'];

export class Body {
  constructor(spec) {
    this.spec = spec;
    this.name = spec.name;
    const byName = new Map(spec.segments.map((s) => [s.name, s]));
    // parents before children
    const order = [], seen = new Set();
    const visit = (s) => { if (seen.has(s.name)) return; if (s.parent) visit(byName.get(s.parent)); seen.add(s.name); order.push(s); };
    spec.segments.forEach(visit);
    this.segments = order.map((s) => ({ ...s, index: 0, parentIndex: -1, children: [] }));
    this.segIndex = Object.fromEntries(this.segments.map((s, i) => [s.name, i]));
    this.segments.forEach((s, i) => { s.index = i; s.parentIndex = s.parent ? this.segIndex[s.parent] : -1; if (s.parentIndex >= 0) this.segments[s.parentIndex].children.push(i); });
    if (this.segments.filter((s) => s.parentIndex < 0).length !== 1) throw new Error('body needs exactly one root segment');
    this.root = this.segments[0].name;
    this.mass = this.segments.reduce((sum, s) => sum + s.mass, 0);

    // degrees of freedom: root first, then each joint's axes in tree order
    this.dofs = ROOT_DOFS.map((name) => ({ name, root: true }));
    this.segments.forEach((s) => { if (!s.joint) return; s.dofStart = this.dofs.length;
      s.joint.axes.forEach((axis, k) => this.dofs.push({ name: `${s.joint.name}.${axis}`, joint: s.joint.name, axis, k, seg: s.index })); });
    this.nq = this.dofs.length;
    this.dofIndex = Object.fromEntries(this.dofs.map((d, i) => [d.name, i]));

    // ancestors (inclusive) of each segment: DOF k moves segment s iff dofs[k].seg is an ancestor of s
    this.ancestors = this.segments.map((s) => { const set = new Set(); let i = s.index; while (i >= 0) { set.add(i); i = this.segments[i].parentIndex; } return set; });

    // drawn bones: frame X along the bone, Z lateral where possible, Y = Z x X
    this.bones = [];
    this.segments.forEach((s) => (s.bones || []).forEach((b) => {
      const X = normalize(sub(b.to, b.from));
      let Z = [0, 0, 1];
      if (Math.abs(X[2]) > 0.9) { const Y = normalize(sub([0, 1, 0], X.map((v) => v * X[1]))); Z = cross(X, Y); }
      else Z = normalize(sub(Z, X.map((v) => v * X[2])));
      const Y = cross(Z, X);
      this.bones.push({ name: b.name, seg: s.index, from: b.from, length: Math.hypot(...sub(b.to, b.from)), radius: b.radius, C: fromColumns(X, Y, Z) });
    }));
    this.boneIndex = Object.fromEntries(this.bones.map((b, i) => [b.name, i]));
    this.primaryBone = this.segments.map((s) => this.bones.findIndex((b) => b.seg === s.index));
  }

  rootRotation(q) { return matMul(matMul(rotY(q[4]), rotZ(q[5])), rotX(q[3])); }

  // world pose of every segment: rotation R (row-major 9) and joint origin p
  fk(q) {
    const n = this.segments.length, R = new Array(n), p = new Array(n);
    for (const s of this.segments) {
      if (s.parentIndex < 0) { R[s.index] = this.rootRotation(q); p[s.index] = [q[0], q[1], q[2]]; continue; }
      let Rs = R[s.parentIndex];
      p[s.index] = add(p[s.parentIndex], matVec(Rs, s.joint.at));
      s.joint.axes.forEach((axis, k) => { Rs = postRotate(Rs, axis, q[s.dofStart + k]); });
      R[s.index] = Rs;
    }
    return { R, p };
  }

  // world axis and centre of every non-root DOF, for a pose from fk()
  dofAxes(q, pose) {
    const axes = new Array(this.nq).fill(null);
    for (const s of this.segments) {
      if (!s.joint) continue;
      let Rk = pose.R[s.parentIndex];
      s.joint.axes.forEach((axis, k) => { axes[s.dofStart + k] = { u: matVec(Rk, AXIS[axis]), c: pose.p[s.index] }; Rk = postRotate(Rk, axis, q[s.dofStart + k]); });
    }
    return axes;
  }

  pointWorld(pose, seg, local) { return add(pose.p[seg], matVec(pose.R[seg], local)); }
  comWorld(pose) {
    const c = [0, 0, 0];
    this.segments.forEach((s) => { const w = this.pointWorld(pose, s.index, s.com); c[0] += s.mass * w[0]; c[1] += s.mass * w[1]; c[2] += s.mass * w[2]; });
    return c.map((v) => v / this.mass);
  }

  // viewer bone rows: [X(3), Y(3), Z(3), origin(3)] with X, Y, Z the bone axes in world
  boneRows(pose) {
    return this.bones.map((b) => { const R = matMul(pose.R[b.seg], b.C), o = this.pointWorld(pose, b.seg, b.from);
      return [R[0], R[3], R[6], R[1], R[4], R[7], R[2], R[5], R[8], o[0], o[1], o[2]]; });
  }
  // a point on a segment, re-expressed in the frame of that segment's first drawn bone
  toBoneFrame(segName, local) {
    const seg = this.segIndex[segName], b = this.bones[this.primaryBone[seg]];
    return { bone: b.name, point: matTVec(b.C, sub(local, b.from)) };
  }

  zeroPose() { return new Float64Array(this.nq); }
}

// segment inertia helpers (principal moments about the COM, body axes)
export const ellipsoidInertia = (m, [a, b, c]) => [m / 5 * (b * b + c * c), m / 5 * (a * a + c * c), m / 5 * (a * a + b * b)];
// a cylinder whose long axis is the body y axis (limb segments hang along y)
export const cylinderInertiaY = (m, r, L) => { const t = m * (3 * r * r + L * L) / 12; return [t, m * r * r / 2, t]; };
