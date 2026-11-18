import { lerp, smoothstep } from '../sim/math';
import { fbm, ridged } from './noise';

/**
 * The ground, as a pure function of position. The flight model samples it for
 * terrain clearance and the renderer samples it to build the mesh, so the two can
 * never disagree about where the hills are.
 *
 * Layout: low rolling hills where the route is flown, a ring of ridged mountains
 * on the horizon, and a flattened pad for the airfield.
 */

export const WORLD_SEED = 1971;

/** Centre of the mountain ring, roughly the middle of the route. */
const RING = { x: 400, z: -1200, inner: 11_000, outer: 17_500 };

/** Runway 09/27, centred on the home waypoint. */
export const AIRFIELD = {
  x: 8200,
  z: 0,
  /** Runway direction [rad from north]: 090°, so the runway runs east–west along x. */
  heading: Math.PI / 2,
  length: 2600,
  width: 45,
  /** Flattened pad around the runway (half extents) and its blend distance [m]. */
  padHalfLength: 1700,
  padHalfWidth: 380,
  padBlend: 650,
};

function hills(x: number, z: number): number {
  return (
    130 +
    230 * fbm(x / 5200, z / 5200, 4, WORLD_SEED) +
    85 * fbm(x / 1500, z / 1500, 3, WORLD_SEED + 7) +
    70 * ridged(x / 2600, z / 2600, 3, WORLD_SEED + 13)
  );
}

function mountains(x: number, z: number): number {
  const r = Math.hypot(x - RING.x, z - RING.z);
  const w = smoothstep(RING.inner, RING.outer, r);
  if (w === 0) return 0;
  return w * (250 + 1750 * ridged(x / 7000, z / 7000, 5, WORLD_SEED + 31));
}

/** Coordinates in the runway frame: u along the runway, v across it [m]. */
export function runwayFrame(x: number, z: number): { u: number; v: number } {
  const ex = Math.sin(AIRFIELD.heading);
  const ez = -Math.cos(AIRFIELD.heading);
  const dx = x - AIRFIELD.x;
  const dz = z - AIRFIELD.z;
  return { u: dx * ex + dz * ez, v: -dx * ez + dz * ex };
}

/** 1 on the airfield pad, 0 away from it, smooth in between. */
export function airfieldMask(x: number, z: number): number {
  const { u, v } = runwayFrame(x, z);
  const a = 1 - smoothstep(AIRFIELD.padHalfLength, AIRFIELD.padHalfLength + AIRFIELD.padBlend, Math.abs(u));
  const b = 1 - smoothstep(AIRFIELD.padHalfWidth, AIRFIELD.padHalfWidth + AIRFIELD.padBlend, Math.abs(v));
  return a * b;
}

/** Field elevation: the natural ground height at the runway's centre [m]. */
export const FIELD_ELEVATION = hills(AIRFIELD.x, AIRFIELD.z);

/** Ground height above sea level at (x, z) [m]. */
export function terrainHeight(x: number, z: number): number {
  const natural = hills(x, z) + mountains(x, z);
  return lerp(natural, FIELD_ELEVATION, airfieldMask(x, z));
}
