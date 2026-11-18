import { BackSide, Mesh, PMREMGenerator, Scene, ShaderMaterial, SphereGeometry, type WebGLRenderer } from 'three';
import { SUN_DIR } from './environment';
import { SKY_FRAG, SKY_VERT } from './shaders';

function skyMaterial(stars: number): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    uniforms: { uSunDir: { value: SUN_DIR }, uStars: { value: stars } },
    side: BackSide,
    depthWrite: false,
    depthTest: false,
  });
}

/** Sky dome that follows the camera, drawn first, behind everything. */
export function createSky() {
  const geometry = new SphereGeometry(40_000, 48, 24);
  const material = skyMaterial(1);
  const mesh = new Mesh(geometry, material);
  mesh.renderOrder = -1;
  mesh.frustumCulled = false;
  return {
    mesh,
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

/**
 * Pre-filtered environment map of the same sky, so the aircraft's metal reflects
 * the dusk it's flying through. Rendered once at start-up.
 */
export function createSkyEnvironment(renderer: WebGLRenderer) {
  const scene = new Scene();
  const geometry = new SphereGeometry(100, 32, 16);
  const material = skyMaterial(0);
  scene.add(new Mesh(geometry, material));
  const pmrem = new PMREMGenerator(renderer);
  const target = pmrem.fromScene(scene, 0, 0.1, 1000);
  pmrem.dispose();
  geometry.dispose();
  material.dispose();
  return target;
}
