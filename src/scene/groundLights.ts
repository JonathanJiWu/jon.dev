import { AdditiveBlending, BufferAttribute, BufferGeometry, Points, ShaderMaterial } from 'three';
import { terrainHeight } from '../world/terrain';
import { AIRPORT_LAYOUTS, ALL_RUNWAYS, onRunway, type PhysicalRunway } from './airportLayout';
import { FOG_DENSITY } from './environment';
import { LIGHTS_FRAG, LIGHTS_VERT } from './shaders';

/** Small deterministic PRNG (mulberry32), so every visit sees the same towns. */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type RGB = readonly [number, number, number];
const WARM: RGB = [1.0, 0.72, 0.42];
const SODIUM: RGB = [1.0, 0.55, 0.22];
const WHITE: RGB = [1.0, 0.93, 0.8];
const EDGE: RGB = [1.0, 0.9, 0.7];
const GREEN: RGB = [0.3, 1.0, 0.45];
const RED: RGB = [1.0, 0.18, 0.12];
const BLUE: RGB = [0.18, 0.38, 1.0];

const OMNI = [0, 0, 0, 0] as const;
const DEG = Math.PI / 180;

/**
 * Every light on the ground, as one point cloud (one draw call):
 *
 * - runways: white edge lights, green threshold and red end lights (each seen only
 *   from its own side), a simplified MALSR approach light system with sequenced
 *   flashers on the instrument runways, REILs on the others, and a PAPI at each end
 *   (four units whose colour depends on the angle they're seen from);
 * - taxiways (blue edge lights), apron floodlights, the airport beacons, terminal windows;
 * - towns, a road, and farms.
 *
 * The layout follows FAA practice in spirit (spacings, colours, PAPI angles) but is
 * simplified and not to any real airport's plan.
 */
export function createGroundLights() {
  const pos: number[] = [];
  const col: number[] = [];
  const size: number[] = [];
  const phase: number[] = [];
  const dir: number[] = [];
  const rand = rng(20_261_118);

  const add = (x: number, y: number, z: number, c: RGB, s: number, ph: number, d: readonly number[] = OMNI, gain = 2.2) => {
    pos.push(x, y, z);
    col.push(c[0] * gain, c[1] * gain, c[2] * gain);
    size.push(s);
    phase.push(ph);
    dir.push(d[0]!, d[1]!, d[2]!, d[3]!);
  };
  const onGround = (x: number, z: number, c: RGB, s: number, lift = 2, gain = 2.2) => add(x, terrainHeight(x, z) + lift, z, c, s, rand(), OMNI, gain);

  for (const r of ALL_RUNWAYS) runwayLights(r, add, rand);

  for (const a of AIRPORT_LAYOUTS) {
    const y = a.elevation;
    for (const t of a.taxiways) {
      for (let u = -t.halfLength; u <= t.halfLength; u += 50) {
        for (const side of [-1, 1]) {
          const p = onRunway(t, u, side * (t.halfWidth + 1));
          add(p.x, y + 0.4, p.z, BLUE, 1.5, rand(), OMNI, 1.8);
        }
      }
    }
    for (const ap of a.aprons) {
      for (const [u, v] of [[-1, -1], [-1, 1], [1, -1], [1, 1], [0, -1], [0, 1]] as const) {
        const p = onRunway(ap, u * (ap.halfLength - 10), v * (ap.halfWidth - 6));
        add(p.x, y + 24, p.z, SODIUM, 6, rand(), OMNI, 2.6);
      }
    }
    for (const b of a.buildings) {
      if (b.kind === 'terminal') {
        // Two rows of lit windows along the airside face.
        for (let u = -b.width / 2 + 3; u <= b.width / 2 - 3; u += 4) {
          for (const h of [4, 9]) {
            if (rand() < 0.25) continue;
            const p = onRunway(b, u, -b.depth / 2 - 0.5);
            add(p.x, y + h, p.z, rand() < 0.7 ? WARM : WHITE, 1.4, rand(), OMNI, 1.6);
          }
        }
      } else if (b.kind === 'tower') {
        // The cab, and the rotating beacon on top (white and green flashes alternating).
        for (let k = 0; k < 8; k++) {
          const ang = (k / 8) * Math.PI * 2;
          add(b.x + Math.cos(ang) * 5, y + b.height - 2, b.z + Math.sin(ang) * 5, [0.6, 1.0, 0.8], 1.6, rand(), OMNI, 1.4);
        }
        add(b.x, y + b.height + 5, b.z, WHITE, 6, 0, [0, 0, 0, 3], 3);
        add(b.x, y + b.height + 5, b.z, GREEN, 6, 0.5, [0, 0, 0, 3], 3);
      }
    }
  }

  // Towns: gaussian-ish clusters of warm windows and streetlights.
  const towns = [
    { x: 19_500, z: 6800, r: 900, n: 280 },
    { x: 9300, z: 5600, r: 700, n: 190 },
    { x: 3500, z: 1400, r: 650, n: 160 },
    { x: -2600, z: -3600, r: 700, n: 180 },
    { x: -9500, z: 3800, r: 600, n: 140 },
    { x: -18_500, z: -5800, r: 850, n: 240 },
    { x: 13_000, z: -5600, r: 500, n: 110 },
    { x: 30_500, z: -3800, r: 500, n: 100 },
    { x: -30_500, z: 3400, r: 600, n: 130 },
  ];
  const clearOfRunways = (x: number, z: number) =>
    ALL_RUNWAYS.every((r) => Math.hypot(x - r.x, z - r.z) > r.length / 2 + 500);
  for (const t of towns) {
    for (let i = 0; i < t.n; i++) {
      const a = rand() * Math.PI * 2;
      const d = t.r * Math.sqrt(-2 * Math.log(1 - rand() * 0.95)) * 0.6;
      const x = t.x + Math.cos(a) * d;
      const z = t.z + Math.sin(a) * d;
      if (clearOfRunways(x, z)) onGround(x, z, rand() < 0.8 ? WARM : WHITE, 3 + rand() * 3);
    }
  }
  // A road between the towns and the airports, with streetlights.
  const road: [number, number][] = [
    [-34_000, 1500], [-30_500, 3400], [-25_500, 1200], [-18_500, -5800], [-9500, -4200], [-2600, -3600],
    [3500, 1400], [9300, 5600], [19_500, 6800], [25_000, 5200], [30_500, -3800], [36_000, -6000],
  ];
  for (let i = 0; i + 1 < road.length; i++) {
    const [x0, z0] = road[i]!;
    const [x1, z1] = road[i + 1]!;
    const len = Math.hypot(x1 - x0, z1 - z0);
    for (let s = 0; s < len; s += 120) {
      const x = x0 + ((x1 - x0) * s) / len + (rand() - 0.5) * 8;
      const z = z0 + ((z1 - z0) * s) / len + (rand() - 0.5) * 8;
      if (clearOfRunways(x, z)) onGround(x, z, SODIUM, 3, 7, 1.8);
    }
  }
  // Farms: sparse single lights in the valleys.
  for (let i = 0; i < 700; i++) {
    const x = -46_000 + rand() * 92_000;
    const z = -18_000 + rand() * 36_000;
    if (terrainHeight(x, z) < 320 && clearOfRunways(x, z)) onGround(x, z, WARM, 3.5);
  }

  const n = size.length;
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
  geometry.setAttribute('size', new BufferAttribute(new Float32Array(size), 1));
  geometry.setAttribute('phase', new BufferAttribute(new Float32Array(phase), 1));
  geometry.setAttribute('dir', new BufferAttribute(new Float32Array(dir), 4));
  geometry.computeBoundingSphere();

  const material = new ShaderMaterial({
    vertexShader: LIGHTS_VERT,
    fragmentShader: LIGHTS_FRAG,
    uniforms: {
      uScale: { value: 1000 },
      uPixelRatio: { value: 1 },
      uFogDensity: { value: FOG_DENSITY },
      uTime: { value: 0 },
    },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });

  const points = new Points(geometry, material);
  points.matrixAutoUpdate = false;
  points.frustumCulled = false;
  return {
    points,
    material,
    count: n,
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

type Add = (x: number, y: number, z: number, c: RGB, s: number, ph: number, d?: readonly number[], gain?: number) => void;

/** Edge, threshold/end, approach lights and PAPI for one physical runway. */
function runwayLights(r: PhysicalRunway, add: Add, rand: () => number): void {
  const half = r.length / 2;
  const hw = r.width / 2;
  const y = r.elevation;
  const fx = Math.sin(r.heading);
  const fz = -Math.cos(r.heading);

  // Edge lights every 60 m, both sides.
  for (let u = -half; u <= half + 0.1; u += 60) {
    for (const side of [-1, 1]) {
      const p = onRunway(r, u, side * (hw + 1.5));
      add(p.x, y + 0.6, p.z, EDGE, 2.2, rand());
    }
  }

  r.ends.forEach((mark, e) => {
    // End 0 lands along the runway heading (threshold at u = −half); end 1 the other way.
    const sign = e === 0 ? 1 : -1;
    const at = (d: number, s: number) => onRunway(r, sign * (d - half), sign * s);
    const toApproach = [-sign * fx, -sign * fz];
    const toRunway = [sign * fx, sign * fz];

    // Threshold (green, toward the approach) and runway end (red, toward the runway).
    for (let s = -hw - 2; s <= hw + 2.01; s += 3) {
      const p = at(-3, s);
      add(p.x, y + 0.5, p.z, GREEN, 2.4, rand(), [toApproach[0]!, toApproach[1]!, 0.3, 0]);
      add(p.x, y + 0.5, p.z, RED, 2.2, rand(), [toRunway[0]!, toRunway[1]!, 0.3, 0]);
    }

    const toward = [toApproach[0]!, toApproach[1]!, 0.15, 0] as const;
    if (mark.lighting === 'malsr') {
      // Steady light bars every 200 ft to 1,400 ft, a crossbar at 1,000 ft, then
      // sequenced flashers out to 2,400 ft that run toward the runway twice a second.
      for (let k = 1; k <= 7; k++) {
        const d = -61 * k;
        for (let s = -2; s <= 2; s++) {
          const p = at(d, s * 1.1);
          add(p.x, Math.max(terrainHeight(p.x, p.z), y) + 1.5, p.z, WHITE, 2.6, rand(), toward, 2.6);
        }
        if (k === 5) {
          for (const side of [-1, 1]) {
            for (let s = 5; s <= 14; s += 1.5) {
              const p = at(d, side * s);
              add(p.x, Math.max(terrainHeight(p.x, p.z), y) + 1.5, p.z, WHITE, 2.6, rand(), toward, 2.6);
            }
          }
        }
      }
      for (let k = 0; k < 5; k++) {
        const p = at(-732 + 61 * k, 0);
        add(p.x, Math.max(terrainHeight(p.x, p.z), y) + 2, p.z, WHITE, 4.5, k * 0.05, [toApproach[0]!, toApproach[1]!, 0.15, 1], 3);
      }
    } else {
      // Runway end identifier lights: a synchronized pair of flashers either side.
      for (const side of [-1, 1]) {
        const p = at(-2, side * (hw + 12));
        add(p.x, y + 1.5, p.z, WHITE, 4, 0, [toApproach[0]!, toApproach[1]!, 0.15, 3], 3);
      }
    }

    // PAPI: four units on the pilot's left at the aiming point. The unit nearest the
    // runway switches at 3.5°, the farthest at 2.5°: "two white, two red" on a 3° path.
    const angles = [3.5, 3.17, 2.83, 2.5];
    angles.forEach((angle, k) => {
      const p = at(300, -(hw + 15 + 9 * k));
      add(p.x, y + 1, p.z, WHITE, 3.6, angle * DEG, [toApproach[0]!, toApproach[1]!, 0.5, 2], 1);
    });
  });
}
