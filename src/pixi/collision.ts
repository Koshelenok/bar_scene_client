import type { Mesh3D } from "pixi3d/pixi7";

export type Vec3Data = { x: number; y: number; z: number };

export type Triangle = {
  ax: number;
  ay: number;
  az: number;
  e1x: number;
  e1y: number;
  e1z: number;
  e2x: number;
  e2y: number;
  e2z: number;
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
};

/** Bakes a mesh into world-space triangles for horizontal raycasts. */
export function createCollisionTriangles(mesh: Mesh3D): Triangle[] {
  const positions = mesh.geometry.positions?.buffer as Float32Array | undefined;
  const indices = mesh.geometry.indices?.buffer as Uint16Array | Uint32Array | undefined;
  if (!positions || !indices) return [];

  mesh.updateTransform();
  const matrix = mesh.worldTransform.array;
  const points: Vec3Data[] = [];

  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const y = positions[i + 1];
    const z = positions[i + 2];
    points.push({
      x: matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
      y: matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
      z: matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14],
    });
  }

  const triangles: Triangle[] = [];
  for (let i = 0; i + 2 < indices.length; i += 3) {
    const a = points[indices[i]];
    const b = points[indices[i + 1]];
    const c = points[indices[i + 2]];
    if (!a || !b || !c) continue;

    triangles.push({
      ax: a.x,
      ay: a.y,
      az: a.z,
      e1x: b.x - a.x,
      e1y: b.y - a.y,
      e1z: b.z - a.z,
      e2x: c.x - a.x,
      e2y: c.y - a.y,
      e2z: c.z - a.z,
      minX: Math.min(a.x, b.x, c.x),
      minY: Math.min(a.y, b.y, c.y),
      minZ: Math.min(a.z, b.z, c.z),
      maxX: Math.max(a.x, b.x, c.x),
      maxY: Math.max(a.y, b.y, c.y),
      maxZ: Math.max(a.z, b.z, c.z),
    });
  }

  return triangles;
}

/** Möller–Trumbore ray/triangle test with a cheap AABB pre-pass. */
function intersects(origin: Vec3Data, direction: Vec3Data, maxDistance: number, t: Triangle): boolean {
  for (const axis of ["x", "y", "z"] as const) {
    const component = axis as keyof Vec3Data;
    const o = origin[component];
    const d = direction[component];
    const min = t[`min${axis.toUpperCase()}` as keyof Triangle] as number;
    const max = t[`max${axis.toUpperCase()}` as keyof Triangle] as number;

    if (Math.abs(d) < 1e-8) {
      if (o < min || o > max) return false;
      continue;
    }

    const first = (min - o) / d;
    const second = (max - o) / d;
    const near = Math.max(Math.min(first, second), 0);
    const far = Math.min(Math.max(first, second), maxDistance);
    if (near > far) return false;
  }

  const pX = direction.y * t.e2z - direction.z * t.e2y;
  const pY = direction.z * t.e2x - direction.x * t.e2z;
  const pZ = direction.x * t.e2y - direction.y * t.e2x;
  const determinant = t.e1x * pX + t.e1y * pY + t.e1z * pZ;
  if (Math.abs(determinant) < 1e-8) return false;

  const inverse = 1 / determinant;
  const tx = origin.x - t.ax;
  const ty = origin.y - t.ay;
  const tz = origin.z - t.az;
  const u = (tx * pX + ty * pY + tz * pZ) * inverse;
  if (u < 0 || u > 1) return false;

  const qX = ty * t.e1z - tz * t.e1y;
  const qY = tz * t.e1x - tx * t.e1z;
  const qZ = tx * t.e1y - ty * t.e1x;
  const v = (direction.x * qX + direction.y * qY + direction.z * qZ) * inverse;
  if (v < 0 || u + v > 1) return false;

  const distance = (t.e2x * qX + t.e2y * qY + t.e2z * qZ) * inverse;
  return distance > 1e-6 && distance <= maxDistance;
}

export function rayHitsTriangles(
  origin: Vec3Data,
  direction: Vec3Data,
  maxDistance: number,
  triangles: Triangle[]
): boolean {
  for (const triangle of triangles) {
    if (intersects(origin, direction, maxDistance, triangle)) return true;
  }
  return false;
}
