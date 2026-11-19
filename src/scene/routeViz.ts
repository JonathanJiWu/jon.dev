import { AdditiveBlending, Color, CylinderGeometry, Group, Mesh, ShaderMaterial, Vector2 } from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import type { FlightPlan } from '../sim/planner';
import type { FlightSimulation } from '../sim/simulation';
import { ROUTE_FIXES } from '../world/navdata';
import { terrainHeight } from '../world/terrain';
import { FOG_DENSITY } from './environment';
import { BEAM_FRAG, BEAM_VERT } from './shaders';

const MAGENTA = new Color('#ff5fd6');
const IDLE = new Color('#9fdcf0');
const HOLD_SEGMENTS = 96;

/** Planned altitude along the route: through each leg end, and the top of climb and descent. */
function routePoints(plan: FlightPlan, fromLeg: number): number[] {
  const pts: { d: number; x: number; y: number; z: number }[] = [];
  const legs = plan.legs;
  const start = Math.max(fromLeg - 1, 0);
  const first = legs[start]!;
  if (start === 0) {
    const t = plan.departure.runway.threshold;
    pts.push({ d: 0, x: t.x, y: plan.departure.runway.elevation, z: t.z });
  }
  for (let i = start; i < legs.length; i++) {
    const l = legs[i]!;
    pts.push({ d: l.cumDistance, x: l.x, y: l.altitude, z: l.z });
  }
  for (const m of [plan.toc, plan.tod]) {
    if (m.distance > first.cumDistance) pts.push({ d: m.distance, x: m.point.x, y: plan.cruiseAltitude, z: m.point.z });
  }
  pts.sort((a, b) => a.d - b.d);
  return pts.flatMap((p) => [p.x, p.y, p.z]);
}

/**
 * The flight plan drawn in the world, as on a navigation display: the route ahead at its
 * planned altitudes (climb, cruise, descent, approach), the active leg in magenta, a
 * hold when one is being flown, and a column of light at each of the page's fixes.
 */
export function createRouteViz() {
  const group = new Group();
  const resolution = new Vector2(1, 1);

  const routeGeo = new LineGeometry();
  routeGeo.setPositions([0, 0, 0, 0, 0, 1]);
  const routeMat = new LineMaterial({
    color: 0xc8d6ea,
    linewidth: 1.4,
    transparent: true,
    opacity: 0.4,
    depthWrite: false,
    dashed: true,
    dashSize: 160,
    gapSize: 100,
  });
  const routeLine = new Line2(routeGeo, routeMat);
  routeLine.frustumCulled = false;
  group.add(routeLine);

  const activeGeo = new LineGeometry();
  activeGeo.setPositions([0, 0, 0, 0, 0, 1]);
  const activeMat = new LineMaterial({ color: MAGENTA.getHex(), linewidth: 2.6, transparent: true, opacity: 0.95, depthWrite: false });
  const activeLine = new Line2(activeGeo, activeMat);
  activeLine.frustumCulled = false;
  group.add(activeLine);

  const holdGeo = new LineGeometry();
  holdGeo.setPositions(new Array((HOLD_SEGMENTS + 1) * 3).fill(0));
  const holdMat = new LineMaterial({ color: MAGENTA.getHex(), linewidth: 2, transparent: true, opacity: 0.8, depthWrite: false });
  const holdLine = new Line2(holdGeo, holdMat);
  holdLine.frustumCulled = false;
  holdLine.visible = false;
  group.add(holdLine);

  // A column of light at each fix that stands for a page section.
  const beams = ROUTE_FIXES.map((fix) => {
    const ground = terrainHeight(fix.x, fix.z);
    const height = 1700 - ground;
    const geo = new CylinderGeometry(6, 6, height, 12, 1, true);
    geo.translate(0, height / 2, 0);
    const mat = new ShaderMaterial({
      vertexShader: BEAM_VERT,
      fragmentShader: BEAM_FRAG,
      uniforms: {
        uColor: { value: IDLE.clone() },
        uOpacity: { value: 0.3 },
        uFogDensity: { value: FOG_DENSITY },
      },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    const mesh = new Mesh(geo, mat);
    mesh.position.set(fix.x, ground, fix.z);
    group.add(mesh);
    return { ident: fix.ident, mesh, mat, geo };
  });

  let key = '';

  return {
    group,
    setResolution(w: number, h: number) {
      resolution.set(w, h);
      for (const m of [routeMat, activeMat, holdMat]) m.resolution.copy(resolution);
    },
    setEngineering(on: boolean) {
      routeMat.opacity = on ? 0.7 : 0.4;
    },
    update(sim: FlightSimulation) {
      const fms = sim.fms;
      const plan = sim.plan;
      const hold = fms.hold;
      const leg = plan.legs[fms.legIndex]!;
      const k = `${plan.id}:${fms.legIndex}:${fms.legStart.x.toFixed(0)},${fms.legStart.z.toFixed(0)}:${hold ? hold.fix.ident + hold.radius.toFixed(0) : ''}`;
      if (k === key) return;
      key = k;

      // The route from the active leg on.
      routeGeo.setPositions(routePoints(plan, fms.legIndex));
      routeLine.computeLineDistances();

      // The active leg: from where it starts (the last fix, or the point of a direct-to).
      const prev = fms.legIndex > 0 ? plan.legs[fms.legIndex - 1]! : null;
      const startY = prev ? prev.altitude : plan.departure.runway.elevation;
      activeGeo.setPositions([fms.legStart.x, startY, fms.legStart.z, leg.x, leg.altitude, leg.z]);
      activeLine.computeLineDistances();
      activeLine.visible = !hold && fms.phase !== 'landing' && fms.phase !== 'parked';
      routeLine.visible = fms.phase !== 'landing' && fms.phase !== 'parked';

      holdLine.visible = !!hold;
      if (hold) {
        const r = Math.max(hold.radius, 1500);
        const pts: number[] = [];
        for (let i = 0; i <= HOLD_SEGMENTS; i++) {
          const a = (i / HOLD_SEGMENTS) * Math.PI * 2;
          pts.push(hold.fix.x + r * Math.sin(a), hold.altitude, hold.fix.z - r * Math.cos(a));
        }
        holdGeo.setPositions(pts);
      }

      const activeIdent = hold ? hold.fix.ident : leg.ident;
      for (const b of beams) {
        const active = b.ident === activeIdent;
        b.mat.uniforms.uColor!.value.copy(active ? MAGENTA : IDLE);
        b.mat.uniforms.uOpacity!.value = active ? 0.85 : 0.28;
      }
    },
    dispose() {
      for (const g of [routeGeo, activeGeo, holdGeo]) g.dispose();
      for (const m of [routeMat, activeMat, holdMat]) m.dispose();
      for (const b of beams) {
        b.geo.dispose();
        b.mat.dispose();
      }
    },
  };
}
