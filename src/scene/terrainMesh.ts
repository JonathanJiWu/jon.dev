import { BufferAttribute, BufferGeometry, Mesh, ShaderMaterial, Vector2 } from 'three';
import { AIRFIELD, terrainHeight } from '../world/terrain';
import { CONTOUR_INTERVAL, FOG_DENSITY, SUN_DIR } from './environment';
import { TERRAIN_FRAG, TERRAIN_VERT } from './shaders';

const CENTER = { x: 400, z: -1200 };
const HALF_SIZE = 42_000;
/** Grid warp: x = H·(A·u + (1−A)·u³). Dense where the route is flown, coarse at the horizon. */
const A = 0.35;

const warp = (u: number): number => HALF_SIZE * (A * u + (1 - A) * u * u * u);

/**
 * Terrain as one indexed mesh, heights from the same pure function the flight model uses.
 * Vertices are packed toward the centre: ~65 m spacing under the route, ~400 m on the
 * distant mountains, for the cost of a single draw call.
 */
export function createTerrain(segments: number) {
  const n = segments + 1;
  const positions = new Float32Array(n * n * 3);
  const xs = new Float64Array(n);
  for (let i = 0; i < n; i++) xs[i] = warp((i / segments) * 2 - 1);

  for (let j = 0; j < n; j++) {
    const z = CENTER.z + xs[j]!;
    for (let i = 0; i < n; i++) {
      const x = CENTER.x + xs[i]!;
      const k = (j * n + i) * 3;
      positions[k] = x;
      positions[k + 1] = terrainHeight(x, z);
      positions[k + 2] = z;
    }
  }

  const index = new Uint32Array(segments * segments * 6);
  let p = 0;
  for (let j = 0; j < segments; j++) {
    for (let i = 0; i < segments; i++) {
      const a = j * n + i;
      const b = a + 1;
      const c = a + n;
      const d = c + 1;
      // Counter-clockwise seen from above (+y), so the faces point up.
      index[p++] = a;
      index[p++] = c;
      index[p++] = b;
      index[p++] = b;
      index[p++] = c;
      index[p++] = d;
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setIndex(new BufferAttribute(index, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  const material = new ShaderMaterial({
    vertexShader: TERRAIN_VERT,
    fragmentShader: TERRAIN_FRAG,
    uniforms: {
      uSunDir: { value: SUN_DIR },
      uFogDensity: { value: FOG_DENSITY },
      uContour: { value: CONTOUR_INTERVAL },
      uEngineering: { value: 0 },
      uRunway: { value: new Vector2(AIRFIELD.x, AIRFIELD.z) },
      uRunwayAxis: { value: new Vector2(Math.sin(AIRFIELD.heading), -Math.cos(AIRFIELD.heading)) },
      uRunwayHalf: { value: new Vector2(AIRFIELD.length / 2, AIRFIELD.width / 2) },
    },
  });

  const mesh = new Mesh(geometry, material);
  mesh.matrixAutoUpdate = false;

  return {
    mesh,
    material,
    triangles: segments * segments * 2,
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
