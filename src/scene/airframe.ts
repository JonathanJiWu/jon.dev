import { Vector3 } from 'three';

/**
 * The airframe's shape, shared by the exterior model and the cockpit interior so the two
 * always agree: fuselage cross-sections along the body, and the window layout (the livery
 * paints the windows from this list; the cockpit cuts its openings from the same list).
 *
 * Local axes: forward −Z, up +Y, right +X; origin at the centre of gravity.
 */

export interface Station {
  z: number;
  /** Width, height, centre height [m] and superellipse exponent (2 = ellipse). */
  w: number;
  h: number;
  cy: number;
  n: number;
}

export const STATIONS: readonly Station[] = [
  // The nose drops away ahead of the windshield, for a view of the ground over it.
  { z: -15.3, w: 0.02, h: 0.02, cy: -0.86, n: 2 },
  { z: -15.12, w: 0.95, h: 0.86, cy: -0.86, n: 2 },
  { z: -14.6, w: 2.05, h: 1.8, cy: -0.84, n: 2.1 },
  { z: -13.7, w: 3.05, h: 2.55, cy: -0.74, n: 2.2 },
  { z: -12.8, w: 3.7, h: 3.42, cy: -0.42, n: 2.3 },
  { z: -11.9, w: 4.1, h: 4.08, cy: -0.12, n: 2.4 },
  { z: -10.8, w: 4.38, h: 4.45, cy: 0, n: 2.5 },
  { z: -9.2, w: 4.5, h: 4.6, cy: 0, n: 2.6 },
  { z: 4.8, w: 4.5, h: 4.6, cy: 0, n: 2.6 },
  { z: 6.6, w: 4.42, h: 4.2, cy: 0.28, n: 2.5 },
  { z: 8.6, w: 4.15, h: 3.45, cy: 0.72, n: 2.4 },
  { z: 10.6, w: 3.55, h: 2.7, cy: 1.1, n: 2.3 },
  { z: 12.5, w: 2.7, h: 1.95, cy: 1.42, n: 2.2 },
  { z: 14.1, w: 1.7, h: 1.25, cy: 1.68, n: 2.1 },
  { z: 15.1, w: 0.85, h: 0.7, cy: 1.86, n: 2 },
  { z: 15.55, w: 0.02, h: 0.02, cy: 1.95, n: 2 },
];
export const Z0 = STATIONS[0]!.z;
export const Z1 = STATIONS[STATIONS.length - 1]!.z;

/** Ring point at angle t (0 = belly, π/2 = right, π = top, 3π/2 = left). */
export function ringPoint(s: Station, t: number, out: Vector3): Vector3 {
  const e = 2 / s.n;
  const sx = Math.sin(t);
  const cx = Math.cos(t);
  return out.set((s.w / 2) * Math.sign(sx) * Math.pow(Math.abs(sx), e), s.cy - (s.h / 2) * Math.sign(cx) * Math.pow(Math.abs(cx), e), s.z);
}

/** The cross-section at any z, smoothly interpolated between stations. */
export function stationAt(z: number): Station {
  let i = 0;
  while (i < STATIONS.length - 2 && STATIONS[i + 1]!.z < z) i++;
  const a = STATIONS[i]!;
  const b = STATIONS[i + 1]!;
  const t = Math.min(Math.max((z - a.z) / (b.z - a.z), 0), 1);
  const u = t * t * (3 - 2 * t);
  const m = (p: number, q: number) => p + (q - p) * u;
  const s = { z, w: m(a.w, b.w), h: m(a.h, b.h), cy: m(a.cy, b.cy), n: m(a.n, b.n) };
  // Round off the very tips of the nose and tail cone.
  const cap = (d: number) => (d < 0.6 ? Math.sqrt(Math.max(0, 1 - Math.pow(1 - d / 0.6, 2))) : 1);
  const k = Math.min(cap(z - Z0), cap(Z1 - z));
  s.w *= k;
  s.h *= k;
  return s;
}

/** A window: from z0 to z1 along the body, and from angle t0 to t1 around it [× π]. */
export interface WindowShape {
  z0: number;
  z1: number;
  t0: number;
  t1: number;
  /** Corner radius on the livery canvas [px]. */
  radius: number;
}

const PANES = [0.62, 0.79, 1.21, 1.38];

/**
 * The flight deck's windows. The windshield reaches far enough forward and down the nose
 * that the captain, seated at the eye point, sees about 15° below the horizon over the
 * glareshield, as in a real transport.
 */
export const WINDOWS: readonly WindowShape[] = [
  // Windshield: a wide centre pane and a side pane each side, with thin pillars between.
  ...PANES.slice(0, -1).map((t0, i) => ({ z0: -14.08, z1: -12.46, t0: t0 + 0.004, t1: PANES[i + 1]! - 0.004, radius: 4 })),
  // Side windows, two each side, then the eyebrow windows above the windshield.
  { z0: -12.4, z1: -11.5, t0: 0.53, t1: 0.67, radius: 5 },
  { z0: -11.42, z1: -10.62, t0: 0.54, t1: 0.67, radius: 5 },
  { z0: -12.4, z1: -11.5, t0: 1.33, t1: 1.47, radius: 5 },
  { z0: -11.42, z1: -10.62, t0: 1.33, t1: 1.46, radius: 5 },
  { z0: -12.4, z1: -12.02, t0: 0.84, t1: 0.97, radius: 3 },
  { z0: -12.4, z1: -12.02, t0: 1.03, t1: 1.16, radius: 3 },
];

/** Small round cabin windows, a few each side. */
export const CABIN_WINDOWS: readonly WindowShape[] = [-8.4, -4.6, 0.8, 5.6].flatMap((z) => [
  { z0: z - 0.18, z1: z + 0.18, t0: 0.52, t1: 0.58, radius: 12 },
  { z0: z - 0.18, z1: z + 0.18, t0: 1.42, t1: 1.48, radius: 12 },
]);

/** Where a fuselage loft maps a point to its texture: u along the body, v around it. */
export const uvOf = (z: number, t: number) => ({ u: (z - Z0) / (Z1 - Z0), v: t / (Math.PI * 2) });

export const point = new Vector3();
