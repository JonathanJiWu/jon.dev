import { BufferAttribute, BufferGeometry, CanvasTexture, Mesh, ShaderMaterial, Vector3, Vector4 } from 'three';
import { terrainHeight } from '../world/terrain';
import { AIRPORT_LAYOUTS, ALL_PAVEMENT, ALL_RUNWAYS, RUNWAY_DESIGNATORS } from './airportLayout';
import { CONTOUR_INTERVAL, FOG_DENSITY, SUN_DIR } from './environment';
import { PAVE_SLOTS, RUNWAY_SLOTS, TERRAIN_FRAG, TERRAIN_VERT } from './shaders';
import { buildTerrainArrays, terrainSpec, type TerrainArrays } from './terrainGrid';

/** Runway numbers, white on black, one 256×256 cell per runway end. */
function designatorAtlas(): CanvasTexture {
  const cell = 256;
  const c = document.createElement('canvas');
  c.width = cell * RUNWAY_DESIGNATORS.length;
  c.height = cell;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // Tall, narrow numerals, as painted on runways.
  RUNWAY_DESIGNATORS.forEach((ident, i) => {
    ctx.save();
    ctx.translate(i * cell + cell / 2, cell / 2);
    ctx.scale(0.85, 1.5);
    ctx.font = '700 150px "B612", "Arial Narrow", system-ui, sans-serif';
    ctx.fillText(ident, 0, 6);
    ctx.restore();
  });
  const t = new CanvasTexture(c);
  t.anisotropy = 4;
  return t;
}

async function buildArrays(fine: boolean): Promise<TerrainArrays> {
  const spec = terrainSpec(fine);
  try {
    const worker = new Worker(new URL('./terrain.worker.ts', import.meta.url), { type: 'module' });
    return await new Promise<TerrainArrays>((resolve, reject) => {
      worker.onmessage = (e: MessageEvent<TerrainArrays>) => {
        worker.terminate();
        resolve(e.data);
      };
      worker.onerror = (e) => {
        worker.terminate();
        reject(e);
      };
      worker.postMessage(spec);
    });
  } catch {
    // No module workers here: build on the main thread instead (a short pause, once).
    return buildTerrainArrays(spec, terrainHeight);
  }
}

/**
 * Terrain as one indexed mesh, heights from the same pure function the flight model uses,
 * with runways, taxiways and aprons painted on in the shader (crisp at any distance).
 */
export async function createTerrain(fine: boolean) {
  const arrays = await buildArrays(fine);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(arrays.positions, 3));
  geometry.setAttribute('normal', new BufferAttribute(arrays.normals, 3));
  geometry.setIndex(new BufferAttribute(arrays.index, 1));
  geometry.computeBoundingSphere();

  const rwy = Array.from({ length: RUNWAY_SLOTS }, () => new Vector4());
  const rwySize = Array.from({ length: RUNWAY_SLOTS }, () => new Vector4());
  ALL_RUNWAYS.slice(0, RUNWAY_SLOTS).forEach((r, i) => {
    rwy[i]!.set(r.x, r.z, Math.sin(r.heading), Math.cos(r.heading));
    rwySize[i]!.set(r.length / 2, r.width / 2, r.ends[0].cell, r.ends[1].cell);
  });
  const pave = Array.from({ length: PAVE_SLOTS }, () => new Vector4());
  const paveSize = Array.from({ length: PAVE_SLOTS }, () => new Vector4());
  ALL_PAVEMENT.slice(0, PAVE_SLOTS).forEach((p, i) => {
    pave[i]!.set(p.x, p.z, Math.sin(p.heading), Math.cos(p.heading));
    paveSize[i]!.set(p.halfLength, p.halfWidth, p.kind === 'apron' ? 1 : 0, 0);
  });
  const airports = [0, 1].map((i) => {
    const a = AIRPORT_LAYOUTS[i];
    return a ? new Vector4(a.x, a.z, 3500, 0) : new Vector4(0, 0, 0, 0);
  });
  const atlas = designatorAtlas();

  const material = new ShaderMaterial({
    vertexShader: TERRAIN_VERT,
    fragmentShader: TERRAIN_FRAG,
    uniforms: {
      uSunDir: { value: SUN_DIR },
      uFogDensity: { value: FOG_DENSITY },
      uContour: { value: CONTOUR_INTERVAL },
      uEngineering: { value: 0 },
      uRwy: { value: rwy },
      uRwySize: { value: rwySize },
      uRwyCount: { value: Math.min(ALL_RUNWAYS.length, RUNWAY_SLOTS) },
      uPave: { value: pave },
      uPaveSize: { value: paveSize },
      uPaveCount: { value: Math.min(ALL_PAVEMENT.length, PAVE_SLOTS) },
      uAirports: { value: airports },
      uAtlas: { value: atlas },
      uAtlasCells: { value: RUNWAY_DESIGNATORS.length },
      uLandingLightPos: { value: new Vector3() },
      uLandingLightDir: { value: new Vector3(0, -0.1, -1).normalize() },
      uLandingLight: { value: 0 },
    },
  });

  const mesh = new Mesh(geometry, material);
  mesh.matrixAutoUpdate = false;

  return {
    mesh,
    material,
    triangles: arrays.index.length / 3,
    dispose() {
      geometry.dispose();
      material.dispose();
      atlas.dispose();
    },
  };
}
