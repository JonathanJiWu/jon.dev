import { AdditiveBlending, Color, CylinderGeometry, Group, Mesh, ShaderMaterial, Vector2 } from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import type { FlightSimulation, RenderState } from '../sim/simulation';
import type { RouteStop } from '../world/route';
import { terrainHeight } from '../world/terrain';
import { FOG_DENSITY } from './environment';
import { BEAM_FRAG, BEAM_VERT } from './shaders';

const MAGENTA = new Color('#ff5fd6');
const IDLE = new Color('#9fdcf0');
const HOLD_SEGMENTS = 96;

/**
 * The flight plan drawn in the world, as on a navigation display: the planned route,
 * the active "direct to" leg in magenta, the hold being flown, and a beam at each fix.
 */
export function createRouteViz(route: readonly RouteStop[]) {
  const group = new Group();
  const resolution = new Vector2(1, 1);

  // The planned route, stop to stop, at each stop's altitude.
  const routeGeo = new LineGeometry();
  routeGeo.setPositions(route.flatMap((s) => [s.x, s.altitude, s.z]));
  const routeMat = new LineMaterial({
    color: 0xc8d6ea,
    linewidth: 1.4,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
    dashed: true,
    dashSize: 140,
    gapSize: 90,
  });
  const routeLine = new Line2(routeGeo, routeMat);
  routeLine.computeLineDistances();
  group.add(routeLine);

  // Active leg: present position at the time of "direct to" → the fix.
  const activeGeo = new LineGeometry();
  activeGeo.setPositions([0, 0, 0, 0, 0, 1]);
  const activeMat = new LineMaterial({ color: MAGENTA.getHex(), linewidth: 2.4, transparent: true, opacity: 0.95, depthWrite: false });
  const activeLine = new Line2(activeGeo, activeMat);
  activeLine.frustumCulled = false;
  group.add(activeLine);

  // The hold (orbit) at the active fix.
  const holdGeo = new LineGeometry();
  holdGeo.setPositions(new Array((HOLD_SEGMENTS + 1) * 3).fill(0));
  const holdMat = new LineMaterial({ color: MAGENTA.getHex(), linewidth: 1.8, transparent: true, opacity: 0.75, depthWrite: false });
  const holdLine = new Line2(holdGeo, holdMat);
  holdLine.frustumCulled = false;
  group.add(holdLine);

  // A column of light at each fix.
  const beams = route.map((stop) => {
    const ground = terrainHeight(stop.x, stop.z);
    const height = stop.altitude - ground + 420;
    const geo = new CylinderGeometry(5, 5, height, 12, 1, true);
    geo.translate(0, height / 2, 0);
    const mat = new ShaderMaterial({
      vertexShader: BEAM_VERT,
      fragmentShader: BEAM_FRAG,
      uniforms: {
        uColor: { value: IDLE.clone() },
        uOpacity: { value: 0.35 },
        uFogDensity: { value: FOG_DENSITY },
      },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    const mesh = new Mesh(geo, mat);
    mesh.position.set(stop.x, ground, stop.z);
    group.add(mesh);
    return { stop, mesh, mat, geo };
  });

  let lastPathKey = '';

  return {
    group,
    setResolution(w: number, h: number) {
      resolution.set(w, h);
      routeMat.resolution.copy(resolution);
      activeMat.resolution.copy(resolution);
      holdMat.resolution.copy(resolution);
    },
    setEngineering(on: boolean) {
      routeMat.opacity = on ? 0.6 : 0.35;
    },
    update(sim: FlightSimulation, pose: RenderState) {
      const target = sim.targetWaypoint;
      const path = sim.path;
      const key = `${target.id}:${path.kind}:${path.kind === 'line' ? `${path.ox},${path.oz}` : ''}`;

      if (key !== lastPathKey) {
        lastPathKey = key;
        if (path.kind === 'line') {
          activeGeo.setPositions([path.ox, pose.y, path.oz, target.x, target.altitude, target.z]);
          activeLine.computeLineDistances();
          activeLine.visible = true;
        } else {
          activeLine.visible = false;
        }
        const pts: number[] = [];
        for (let i = 0; i <= HOLD_SEGMENTS; i++) {
          const a = (i / HOLD_SEGMENTS) * Math.PI * 2;
          pts.push(target.x + target.orbitRadius * Math.sin(a), sim.altitudeCmd, target.z - target.orbitRadius * Math.cos(a));
        }
        holdGeo.setPositions(pts);
        for (const b of beams) {
          const active = b.stop.id === target.id;
          b.mat.uniforms.uColor!.value.copy(active ? MAGENTA : IDLE);
          b.mat.uniforms.uOpacity!.value = active ? 0.9 : 0.3;
        }
      }
      // The hold is drawn only once it's being flown (or nearly).
      holdMat.opacity = path.kind === 'orbit' ? 0.75 : 0.25;
    },
    dispose() {
      routeGeo.dispose();
      routeMat.dispose();
      activeGeo.dispose();
      activeMat.dispose();
      holdGeo.dispose();
      holdMat.dispose();
      for (const b of beams) {
        b.geo.dispose();
        b.mat.dispose();
      }
    },
  };
}
