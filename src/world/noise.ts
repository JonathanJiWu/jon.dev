/**
 * Deterministic 2D gradient noise and fractal sums.
 *
 * The terrain must be identical everywhere it is evaluated: in the flight model
 * (terrain clearance), when the mesh is built, and in tests. So: integer hashing
 * with a fixed seed, no Math.random, no platform-dependent state.
 */

const GRADIENTS = (() => {
  const n = 256;
  const g = new Float64Array(n * 2);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    g[i * 2] = Math.cos(a);
    g[i * 2 + 1] = Math.sin(a);
  }
  return g;
})();

/** 32-bit integer hash of a lattice point (a murmur3-style finaliser). */
function hash(ix: number, iz: number, seed: number): number {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iz, 0x165667b1) ^ Math.imul(seed, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

function dotGrad(ix: number, iz: number, seed: number, fx: number, fz: number): number {
  const k = (hash(ix, iz, seed) & 255) * 2;
  return GRADIENTS[k]! * fx + GRADIENTS[k + 1]! * fz;
}

/** Quintic fade: C2-continuous, so terrain normals don't crease at cell borders. */
function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** Gradient noise in roughly [-1, 1]. */
export function gradientNoise(x: number, z: number, seed = 0): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const u = fade(fx);
  const v = fade(fz);
  const n00 = dotGrad(ix, iz, seed, fx, fz);
  const n10 = dotGrad(ix + 1, iz, seed, fx - 1, fz);
  const n01 = dotGrad(ix, iz + 1, seed, fx, fz - 1);
  const n11 = dotGrad(ix + 1, iz + 1, seed, fx - 1, fz - 1);
  const nx0 = n00 + (n10 - n00) * u;
  const nx1 = n01 + (n11 - n01) * u;
  return (nx0 + (nx1 - nx0) * v) * 1.414;
}

// Each octave is rotated ~37° so the lattice never lines up across octaves.
const ROT_C = Math.cos(0.65);
const ROT_S = Math.sin(0.65);

/** Fractional Brownian motion: octaves of noise, each twice the frequency and half the amplitude. */
export function fbm(x: number, z: number, octaves: number, seed = 0): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * gradientNoise(x, z, seed + o * 101);
    norm += amp;
    const nx = (x * ROT_C - z * ROT_S) * 2.03;
    z = (x * ROT_S + z * ROT_C) * 2.03;
    x = nx;
    amp *= 0.5;
  }
  return sum / norm;
}

/** Ridged multifractal in [0, 1]: sharp crests, for mountains. */
export function ridged(x: number, z: number, octaves: number, seed = 0): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let weight = 1;
  for (let o = 0; o < octaves; o++) {
    let n = 1 - Math.abs(gradientNoise(x, z, seed + o * 131));
    n *= n * weight;
    weight = Math.min(Math.max(n * 1.6, 0), 1);
    sum += amp * n;
    norm += amp;
    const nx = (x * ROT_C - z * ROT_S) * 2.07;
    z = (x * ROT_S + z * ROT_C) * 2.07;
    x = nx;
    amp *= 0.5;
  }
  return sum / norm;
}
