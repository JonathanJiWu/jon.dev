/**
 * The terrain mesh's vertex grid, as plain arrays (no three.js), so it can be built in a
 * Web Worker. A separable grid: fine spacing over the strip where flights are flown,
 * spacing that grows geometrically toward the horizon.
 */

export interface AxisSpec {
  center: number;
  /** Half-width of the evenly spaced, fine region [m]. */
  fineHalf: number;
  /** Half-width of the whole grid [m]. */
  half: number;
  /** Spacing in the fine region [m], and how much each step grows beyond it. */
  step: number;
  growth: number;
}

export interface GridSpec {
  x: AxisSpec;
  z: AxisSpec;
}

export interface TerrainArrays {
  nx: number;
  nz: number;
  positions: Float32Array;
  normals: Float32Array;
  index: Uint32Array;
}

/** Grid coordinates along one axis. */
export function axisCoords(a: AxisSpec): Float64Array {
  const right: number[] = [0];
  const n = Math.ceil(a.fineHalf / a.step);
  for (let i = 1; i <= n; i++) right.push(i * a.step);
  let step = a.step;
  let x = right[right.length - 1]!;
  while (x < a.half - 1e-6) {
    step *= a.growth;
    x = Math.min(a.half, x + step);
    right.push(x);
  }
  const out = new Float64Array(right.length * 2 - 1);
  for (let i = 0; i < right.length; i++) {
    out[right.length - 1 - i] = a.center - right[i]!;
    out[right.length - 1 + i] = a.center + right[i]!;
  }
  return out;
}

/** Heights, normals (central differences) and triangle indices for the grid. */
export function buildTerrainArrays(spec: GridSpec, height: (x: number, z: number) => number): TerrainArrays {
  const xs = axisCoords(spec.x);
  const zs = axisCoords(spec.z);
  const nx = xs.length;
  const nz = zs.length;
  const h = new Float64Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) h[j * nx + i] = height(xs[i]!, zs[j]!);

  const positions = new Float32Array(nx * nz * 3);
  const normals = new Float32Array(nx * nz * 3);
  for (let j = 0; j < nz; j++) {
    const j0 = Math.max(j - 1, 0);
    const j1 = Math.min(j + 1, nz - 1);
    for (let i = 0; i < nx; i++) {
      const i0 = Math.max(i - 1, 0);
      const i1 = Math.min(i + 1, nx - 1);
      const k = j * nx + i;
      positions[k * 3] = xs[i]!;
      positions[k * 3 + 1] = h[k]!;
      positions[k * 3 + 2] = zs[j]!;
      const dhdx = (h[j * nx + i1]! - h[j * nx + i0]!) / (xs[i1]! - xs[i0]!);
      const dhdz = (h[j1 * nx + i]! - h[j0 * nx + i]!) / (zs[j1]! - zs[j0]!);
      const inv = 1 / Math.hypot(dhdx, 1, dhdz);
      normals[k * 3] = -dhdx * inv;
      normals[k * 3 + 1] = inv;
      normals[k * 3 + 2] = -dhdz * inv;
    }
  }

  const index = new Uint32Array((nx - 1) * (nz - 1) * 6);
  let p = 0;
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i;
      const b = a + 1;
      const c = a + nx;
      const d = c + 1;
      // Counter-clockwise seen from above (+y), so the faces point up. Split along the
      // diagonal that follows the terrain better (the shorter one in height).
      if (Math.abs(h[a]! - h[d]!) < Math.abs(h[b]! - h[c]!)) {
        index[p++] = a; index[p++] = c; index[p++] = d;
        index[p++] = a; index[p++] = d; index[p++] = b;
      } else {
        index[p++] = a; index[p++] = c; index[p++] = b;
        index[p++] = b; index[p++] = c; index[p++] = d;
      }
    }
  }
  return { nx, nz, positions, normals, index };
}

/** The grid used by the scene, for a fine or a modest quality profile. */
export function terrainSpec(fine: boolean): GridSpec {
  const step = fine ? 140 : 230;
  return {
    // East–west: both airports and their approaches (to ±40 km), then the mountains.
    x: { center: 0, fineHalf: 42_000, half: 82_000, step, growth: 1.05 },
    // North–south: the route and the base legs (±12 km), then the mountains.
    z: { center: 0, fineHalf: 13_000, half: 82_000, step, growth: 1.05 },
  };
}
