import { AIRPORTS } from '../world/navdata';
import { AIRPORT_SITES, FIELD_ELEVATION, type RunwaySite } from '../world/terrain';

/**
 * What the airports look like: runways (from the world data), plus taxiways, aprons and
 * buildings, which only the renderer cares about. All of it sits inside the flattened
 * runway pads (within ~380 m of each centreline), so nothing floats or sinks.
 */

/** An oriented rectangle on the ground: centre, heading of its long axis, half sizes. */
export interface GroundRect {
  x: number;
  z: number;
  heading: number;
  halfLength: number;
  halfWidth: number;
}

export interface Building {
  x: number;
  z: number;
  heading: number;
  width: number;
  depth: number;
  height: number;
  kind: 'terminal' | 'hangar' | 'tower';
}

export interface RunwayEndMark {
  /** Index into the runway atlas (designator numbers). */
  cell: number;
  ident: string;
  /** Approach lights: a simplified MALSR on instrument runways, REILs otherwise. */
  lighting: 'malsr' | 'reil';
}

export interface PhysicalRunway extends RunwaySite {
  elevation: number;
  /** The two ends: [the end of the lower-numbered heading, the reciprocal]. */
  ends: [RunwayEndMark, RunwayEndMark];
}

export interface AirportLayout {
  ident: string;
  name: string;
  x: number;
  z: number;
  elevation: number;
  runways: PhysicalRunway[];
  taxiways: GroundRect[];
  aprons: GroundRect[];
  buildings: Building[];
}

/** Which side of each runway the taxiway and apron are on (+1 = right of its heading). */
const SIDES: Record<string, { side: number; apron: boolean }[]> = {
  KJWU: [{ side: -1, apron: true }],
  KHLO: [{ side: 1, apron: true }, { side: -1, apron: false }],
};

const TAXIWAY_OFFSET = 175;
const TAXIWAY_HALF_WIDTH = 11.5;

/** Point at (u along, v right of) a runway's centre. */
export function onRunway(r: { x: number; z: number; heading: number }, u: number, v: number): { x: number; z: number } {
  const fx = Math.sin(r.heading);
  const fz = -Math.cos(r.heading);
  // right = (cos h, sin h)
  return { x: r.x + fx * u + Math.cos(r.heading) * v, z: r.z + fz * u + Math.sin(r.heading) * v };
}

let atlasCell = 0;
export const RUNWAY_DESIGNATORS: string[] = [];

export const AIRPORT_LAYOUTS: readonly AirportLayout[] = AIRPORT_SITES.map((site) => {
  const airport = AIRPORTS.find((a) => a.ident === site.ident)!;
  const elevation = FIELD_ELEVATION[site.ident]!;
  const taxiways: GroundRect[] = [];
  const aprons: GroundRect[] = [];
  const buildings: Building[] = [];

  const runways: PhysicalRunway[] = site.runways.map((r, i) => {
    const { side, apron } = SIDES[site.ident]?.[i] ?? { side: 1, apron: false };
    // The two RunwayEnds of this physical runway, matched by heading.
    const fwd = airport.runways.find((e) => Math.abs(Math.cos(e.heading - r.heading) - 1) < 1e-6 && near(e, r))!;
    const back = airport.runways.find((e) => Math.abs(Math.cos(e.heading - r.heading) + 1) < 1e-6 && near(e, r))!;
    const instrument = i === 0;
    const mark = (ident: string): RunwayEndMark => {
      RUNWAY_DESIGNATORS.push(ident);
      return { cell: atlasCell++, ident, lighting: instrument ? 'malsr' : 'reil' };
    };
    const ends: [RunwayEndMark, RunwayEndMark] = [mark(fwd.ident), mark(back.ident)];

    // Parallel taxiway with a connector at each end and one in the middle.
    const half = r.length / 2;
    const tw = onRunway(r, 0, side * TAXIWAY_OFFSET);
    taxiways.push({ x: tw.x, z: tw.z, heading: r.heading, halfLength: half, halfWidth: TAXIWAY_HALF_WIDTH });
    for (const u of [-half + 15, 0, half - 15]) {
      const c = onRunway(r, u, (side * TAXIWAY_OFFSET) / 2);
      taxiways.push({ x: c.x, z: c.z, heading: r.heading + Math.PI / 2, halfLength: TAXIWAY_OFFSET / 2, halfWidth: TAXIWAY_HALF_WIDTH });
    }
    if (apron) {
      const ap = onRunway(r, 0, side * (TAXIWAY_OFFSET + 75));
      aprons.push({ x: ap.x, z: ap.z, heading: r.heading, halfLength: 230, halfWidth: 60 });
      const at = (u: number, v: number) => onRunway(r, u, side * v);
      const t = at(-60, TAXIWAY_OFFSET + 160);
      buildings.push({ ...t, heading: r.heading, width: 180, depth: 34, height: 13, kind: 'terminal' });
      const h = at(170, TAXIWAY_OFFSET + 165);
      buildings.push({ ...h, heading: r.heading, width: 70, depth: 52, height: 19, kind: 'hangar' });
      const h2 = at(250, TAXIWAY_OFFSET + 165);
      buildings.push({ ...h2, heading: r.heading, width: 70, depth: 52, height: 19, kind: 'hangar' });
      const tower = at(80, TAXIWAY_OFFSET + 150);
      buildings.push({ ...tower, heading: r.heading, width: 9, depth: 9, height: 34, kind: 'tower' });
    }
    return { ...r, elevation, ends };
  });

  return { ident: site.ident, name: site.name, x: site.x, z: site.z, elevation, runways, taxiways, aprons, buildings };
});

function near(e: { threshold: { x: number; z: number }; end: { x: number; z: number } }, r: RunwaySite): boolean {
  const cx = (e.threshold.x + e.end.x) / 2;
  const cz = (e.threshold.z + e.end.z) / 2;
  return Math.hypot(cx - r.x, cz - r.z) < 1;
}

export const ALL_RUNWAYS: readonly PhysicalRunway[] = AIRPORT_LAYOUTS.flatMap((a) => a.runways);
export const ALL_PAVEMENT: readonly (GroundRect & { kind: 'taxiway' | 'apron' })[] = AIRPORT_LAYOUTS.flatMap((a) => [
  ...a.taxiways.map((t) => ({ ...t, kind: 'taxiway' as const })),
  ...a.aprons.map((t) => ({ ...t, kind: 'apron' as const })),
]);
