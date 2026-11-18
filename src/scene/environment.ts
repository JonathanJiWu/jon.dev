import { Vector3 } from 'three';
import { SUN } from '../world/route';

/** Unit vector toward the sun, in the scene frame (x east, y up, z south). */
export const SUN_DIR = new Vector3(
  Math.sin(SUN.azimuth) * Math.cos(SUN.elevation),
  Math.sin(SUN.elevation),
  -Math.cos(SUN.azimuth) * Math.cos(SUN.elevation),
).normalize();

/** Exponential-squared fog: ~50% at 15 km; the mountain ring stays as silhouettes, the world's edge vanishes. */
export const FOG_DENSITY = 5.4e-5;

/** Contour interval for the terrain shader [m]. */
export const CONTOUR_INTERVAL = 25;
