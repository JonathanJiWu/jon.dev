import { lerp, smoothstep } from '../sim/math';
import { fbm, ridged } from './noise';

/**
 * The ground, as a pure function of position. The flight model samples it for terrain
 * clearance and touchdown, the planner for minimum altitudes, and the renderer to
 * build the mesh, so none of them can disagree about where the hills are.
 *
 * Layout: rolling hills where the route is flown, a ring of ridged mountains on the
 * horizon, two airports with flattened runway pads, and approach corridors kept below
 * half the 3° glide-path height off each runway end.
 */

export const WORLD_SEED = 1971;

const RING = { x: 0, z: -500, inner: 44_000, outer: 62_000 };

/** Magnetic variation, east positive: 10° W. (Simulated; Boston's is about 14° W.) */
export const MAGNETIC_VARIATION = (-10 * Math.PI) / 180;

export interface RunwaySite {
  /** Runway centre. */
  x: number;
  z: number;
  /** True heading of the lower-numbered end [rad]. */
  heading: number;
  length: number;
  width: number;
}

export interface AirportSite {
  ident: string;
  name: string;
  x: number;
  z: number;
  runways: RunwaySite[];
}

const T = (magDeg: number) => ((magDeg * Math.PI) / 180 + MAGNETIC_VARIATION + 2 * Math.PI) % (2 * Math.PI);

/** Two fictional airports. Runway headings are given magnetic, as on a chart. */
export const AIRPORT_SITES: readonly AirportSite[] = [
  {
    ident: 'KJWU',
    name: 'Wu Field',
    x: 24_000,
    z: 3000,
    runways: [{ x: 24_000, z: 3000, heading: T(90), length: 2600, width: 45 }],
  },
  {
    ident: 'KHLO',
    name: 'Hello Regional',
    x: -24_000,
    z: -2000,
    runways: [
      { x: -24_000, z: -2000, heading: T(90), length: 2500, width: 45 },
      { x: -23_500, z: -1200, heading: T(180), length: 1800, width: 45 },
    ],
  },
];

const PAD = { halfWidth: 380, extra: 600, blend: 650 };
const CORRIDOR = { length: 16_000, halfWidth: 1500, blend: 1400 };

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
  return w * (250 + 1750 * ridged(x / 9000, z / 9000, 5, WORLD_SEED + 31));
}

/** Coordinates in a runway's frame: u along the runway (toward its heading), v across [m]. */
export function runwayFrame(r: RunwaySite, x: number, z: number): { u: number; v: number } {
  const ex = Math.sin(r.heading);
  const ez = -Math.cos(r.heading);
  const dx = x - r.x;
  const dz = z - r.z;
  return { u: dx * ex + dz * ez, v: -dx * ez + dz * ex };
}

/** Field elevation: the natural ground height at the airport reference point [m]. */
export const FIELD_ELEVATION: Record<string, number> = Object.fromEntries(
  AIRPORT_SITES.map((a) => [a.ident, Math.round(hills(a.x, a.z))]),
);

const TAN3 = Math.tan((3 * Math.PI) / 180);

/** Ground height above sea level at (x, z) [m]. */
export function terrainHeight(x: number, z: number): number {
  let h = hills(x, z) + mountains(x, z);
  for (const a of AIRPORT_SITES) {
    if (Math.abs(x - a.x) > 22_000 || Math.abs(z - a.z) > 22_000) continue;
    const field = FIELD_ELEVATION[a.ident]!;
    for (const r of a.runways) {
      const { u, v } = runwayFrame(r, x, z);
      const half = r.length / 2;
      const beyond = Math.abs(u) - half;
      // Approach corridors: off either end, keep the ground under half the glide path.
      if (beyond > 0 && beyond < CORRIDOR.length + CORRIDOR.blend) {
        const w =
          (1 - smoothstep(CORRIDOR.halfWidth, CORRIDOR.halfWidth + CORRIDOR.blend, Math.abs(v))) *
          (1 - smoothstep(CORRIDOR.length, CORRIDOR.length + CORRIDOR.blend, beyond));
        const cap = field + Math.min(0.45 * beyond * TAN3, 150);
        if (w > 0 && h > cap) h -= w * (h - cap);
      }
      // The runway pad itself, perfectly flat.
      const pad =
        (1 - smoothstep(half + PAD.extra, half + PAD.extra + PAD.blend, Math.abs(u))) *
        (1 - smoothstep(PAD.halfWidth, PAD.halfWidth + PAD.blend, Math.abs(v)));
      if (pad > 0) h = lerp(h, field, pad);
    }
  }
  return h;
}
