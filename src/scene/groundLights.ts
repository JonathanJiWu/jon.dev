import { AdditiveBlending, BufferAttribute, BufferGeometry, Points, ShaderMaterial } from 'three';
import { AIRFIELD, FIELD_ELEVATION, terrainHeight } from '../world/terrain';
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

interface Light {
  x: number;
  y: number;
  z: number;
  r: number;
  g: number;
  b: number;
  size: number;
}

const WARM = [1.0, 0.72, 0.42] as const;
const WHITE = [1.0, 0.93, 0.8] as const;

/** Runway edge and threshold lights, a few towns, and scattered farm lights. */
export function createGroundLights() {
  const lights: Light[] = [];
  const add = (x: number, z: number, c: readonly number[], size: number, lift = 2) =>
    lights.push({ x, y: terrainHeight(x, z) + lift, z, r: c[0]!, g: c[1]!, b: c[2]!, size });

  // Runway: edge lights every 60 m, green/red threshold bars at each end.
  const ex = Math.sin(AIRFIELD.heading);
  const ez = -Math.cos(AIRFIELD.heading);
  const half = AIRFIELD.length / 2;
  const w = AIRFIELD.width / 2 + 2;
  for (let u = -half; u <= half; u += 60) {
    for (const side of [-1, 1]) {
      lights.push({
        x: AIRFIELD.x + ex * u - ez * side * w,
        y: FIELD_ELEVATION + 1,
        z: AIRFIELD.z + ez * u + ex * side * w,
        r: WHITE[0],
        g: WHITE[1],
        b: WHITE[2],
        size: 2.4,
      });
    }
  }
  for (const end of [-1, 1]) {
    for (let v = -w; v <= w; v += 6) {
      lights.push({
        x: AIRFIELD.x + ex * end * (half + 4) - ez * v,
        y: FIELD_ELEVATION + 1,
        z: AIRFIELD.z + ez * end * (half + 4) + ex * v,
        r: end < 0 ? 0.35 : 1.0,
        g: end < 0 ? 1.0 : 0.25,
        b: end < 0 ? 0.5 : 0.2,
        size: 2.6,
      });
    }
  }

  // Towns: gaussian-ish clusters of warm windows and streetlights.
  const rand = rng(20_261_118);
  const towns = [
    { x: 9300, z: 1600, r: 900, n: 260 },
    { x: 3500, z: 1400, r: 650, n: 160 },
    { x: -2600, z: 700, r: 700, n: 180 },
    { x: -6200, z: -4200, r: 500, n: 110 },
    { x: 1200, z: -4300, r: 450, n: 90 },
  ];
  for (const t of towns) {
    for (let i = 0; i < t.n; i++) {
      const a = rand() * Math.PI * 2;
      const d = t.r * Math.sqrt(-2 * Math.log(1 - rand() * 0.95)) * 0.6;
      add(t.x + Math.cos(a) * d, t.z + Math.sin(a) * d, rand() < 0.8 ? WARM : WHITE, 3 + rand() * 3);
    }
  }
  // Farms: sparse single lights in the valleys.
  for (let i = 0; i < 260; i++) {
    const x = -12_000 + rand() * 24_000;
    const z = -10_000 + rand() * 18_000;
    if (terrainHeight(x, z) < 260) add(x, z, WARM, 3.5);
  }

  const n = lights.length;
  const position = new Float32Array(n * 3);
  const color = new Float32Array(n * 3);
  const size = new Float32Array(n);
  const phase = new Float32Array(n);
  lights.forEach((l, i) => {
    position.set([l.x, l.y, l.z], i * 3);
    color.set([l.r * 2.2, l.g * 2.2, l.b * 2.2], i * 3);
    size[i] = l.size;
    phase[i] = rand();
  });

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(position, 3));
  geometry.setAttribute('color', new BufferAttribute(color, 3));
  geometry.setAttribute('size', new BufferAttribute(size, 1));
  geometry.setAttribute('phase', new BufferAttribute(phase, 1));
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
