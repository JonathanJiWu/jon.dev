import { BoxGeometry, type BufferGeometry, Color, CylinderGeometry, Mesh, MeshStandardMaterial } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { AIRPORT_LAYOUTS } from './airportLayout';

/**
 * Airport buildings as plain massing: terminal, hangars and a control tower with a glass
 * cab. One merged mesh for all of them; their lit windows are in the ground lights.
 */
export function createAirportBuildings() {
  const solid: BufferGeometry[] = [];
  const glass: BufferGeometry[] = [];

  for (const a of AIRPORT_LAYOUTS) {
    for (const b of a.buildings) {
      if (b.kind === 'tower') {
        const shaft = new CylinderGeometry(2.6, 3.2, b.height - 5, 10);
        shaft.translate(b.x, a.elevation + (b.height - 5) / 2, b.z);
        solid.push(shaft);
        const cab = new CylinderGeometry(5.4, 4.6, 4.5, 8);
        cab.translate(b.x, a.elevation + b.height - 2.3, b.z);
        glass.push(cab);
        const roof = new CylinderGeometry(5.9, 5.9, 0.6, 8);
        roof.translate(b.x, a.elevation + b.height + 0.2, b.z);
        solid.push(roof);
        continue;
      }
      const box = new BoxGeometry(b.width, b.height, b.depth);
      box.rotateY(-b.heading + Math.PI / 2);
      box.translate(b.x, a.elevation + b.height / 2, b.z);
      solid.push(box);
    }
  }

  const solidGeo = mergeGeometries(solid)!;
  const glassGeo = mergeGeometries(glass)!;
  for (const g of [...solid, ...glass]) g.dispose();
  const solidMat = new MeshStandardMaterial({ color: new Color('#3a4150'), roughness: 0.85, metalness: 0.05 });
  const glassMat = new MeshStandardMaterial({
    color: new Color('#16302c'),
    emissive: new Color('#3d8f78'),
    emissiveIntensity: 0.6,
    roughness: 0.2,
    metalness: 0.4,
  });
  const buildings = new Mesh(solidGeo, solidMat);
  const cabs = new Mesh(glassGeo, glassMat);
  buildings.add(cabs);
  buildings.matrixAutoUpdate = false;
  cabs.matrixAutoUpdate = false;
  return {
    mesh: buildings,
    dispose() {
      solidGeo.dispose();
      glassGeo.dispose();
      solidMat.dispose();
      glassMat.dispose();
    },
  };
}
