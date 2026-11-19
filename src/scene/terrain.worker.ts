/// <reference lib="webworker" />
/**
 * Builds the terrain grid off the main thread: ~200k height samples would otherwise
 * freeze the page for most of a second. The arrays are transferred back, not copied.
 */
import { terrainHeight } from '../world/terrain';
import { buildTerrainArrays, type GridSpec } from './terrainGrid';

self.onmessage = (e: MessageEvent<GridSpec>) => {
  const t = buildTerrainArrays(e.data, terrainHeight);
  (self as DedicatedWorkerGlobalScope).postMessage(t, [t.positions.buffer, t.normals.buffer, t.index.buffer]);
};
