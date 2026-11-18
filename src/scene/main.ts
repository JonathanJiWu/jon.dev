import {
  ACESFilmicToneMapping,
  DirectionalLight,
  HemisphereLight,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
} from 'three';
import { S } from '../sim/dynamics';
import { createRenderState, FlightSimulation } from '../sim/simulation';
import { damp } from '../sim/math';
import { ROUTE } from '../world/route';
import { terrainHeight } from '../world/terrain';
import { createAircraft } from './aircraftModel';
import { CameraRig } from './cameraRig';
import { EngineeringView } from './engineering';
import { SUN_DIR } from './environment';
import { createGroundLights } from './groundLights';
import { FixLabels } from './labels';
import { AdaptiveResolution, chooseProfile } from './quality';
import { createRouteViz } from './routeViz';
import { createSky, createSkyEnvironment } from './sky';
import { createTerrain } from './terrainMesh';
import type { FlightReadout, SceneController, SceneOptions } from './types';

/**
 * Build the scene and start the render loop.
 *
 * Per frame: advance the simulation by the frame's wall-clock time (it runs fixed 120 Hz
 * steps internally), interpolate a pose between the last two physics states, then draw.
 * The scene only reads the simulation, apart from handing it a new target.
 */
export async function startScene(opts: SceneOptions): Promise<SceneController> {
  const profile = chooseProfile();
  const renderer = new WebGLRenderer({
    canvas: opts.canvas,
    antialias: profile.antialias,
    powerPreference: 'high-performance',
    stencil: false,
  });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  const resolution = new AdaptiveResolution(opts.poster ? 1 : profile.maxPixelRatio);

  const scene = new Scene();
  const camera = new PerspectiveCamera(38, 1, 5, 90_000);

  const sim = new FlightSimulation({ waypoints: ROUTE, start: 'home', terrainHeight });
  const pose = createRenderState();

  const sky = createSky();
  scene.add(sky.mesh);
  const env = createSkyEnvironment(renderer);
  scene.environment = env.texture;

  const terrain = createTerrain(profile.terrainSegments);
  scene.add(terrain.mesh);
  const ground = createGroundLights();
  scene.add(ground.points);
  const aircraft = createAircraft();
  scene.add(aircraft.group);
  const routeViz = createRouteViz(ROUTE);
  scene.add(routeViz.group);

  const sun = new DirectionalLight(0xffb27a, 2.6);
  sun.position.copy(SUN_DIR).multiplyScalar(1000);
  scene.add(sun);
  scene.add(new HemisphereLight(0x6f78b0, 0x0b1214, 0.9));
  // A soft fill from the camera's side, as an air-to-air photographer would use: it shows the
  // airframe's shape when the sun is behind it.
  const fill = new DirectionalLight(0xa9bce0, 0.9);
  fill.target = aircraft.group;
  scene.add(fill);

  const labels = new FixLabels(opts.labels, ROUTE);
  const rig = new CameraRig(camera);
  const engineering = new EngineeringView(opts.panel);
  scene.add(engineering.group);

  if (opts.initialTarget !== 'home') sim.setTarget(opts.initialTarget);
  // Poster: a fixed moment a few seconds into the hold, identical on every capture.
  if (opts.poster) for (let i = 0; i < 120 * 6; i++) sim.step();

  // --- sizing & composition
  let width = 1;
  let height = 1;
  function resize(): void {
    width = Math.max(1, opts.canvas.clientWidth);
    height = Math.max(1, opts.canvas.clientHeight);
    renderer.setPixelRatio(resolution.pixelRatio);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    // Portrait screens get a wider lens, or the aircraft fills the narrow frame.
    camera.fov = height > width ? 54 : 38;
    // Wide layouts read on the left, so frame the aircraft right of centre. Narrow ones stack
    // the text below, so put it in the band near the top.
    const wide = width >= 1080;
    camera.setViewOffset(width, height, wide ? -width * 0.17 : 0, wide ? height * 0.12 : height * 0.32, width, height);
    camera.updateProjectionMatrix();
    routeViz.setResolution(width, height);
    const u = ground.material.uniforms;
    u.uScale!.value = (camera.projectionMatrix.elements[5]! * height) / 2;
    u.uPixelRatio!.value = resolution.pixelRatio;
  }
  const ro = new ResizeObserver(resize);
  ro.observe(opts.canvas);
  resize();

  // --- loop
  let raf = 0;
  let last = performance.now();
  let time = 0;
  let drawn = false;
  let disposed = false;
  let engTarget = 0;
  const engUniform = terrain.material.uniforms.uEngineering!;
  const stats = { stepsPerFrame: 0, frameMs: 16.7, pixelRatio: resolution.pixelRatio };

  function frame(now: number): void {
    raf = requestAnimationFrame(frame);
    const frameMs = now - last;
    last = now;
    const dt = Math.min(frameMs / 1000, 0.1);
    time += dt;

    const before = sim.steps;
    const alpha = opts.poster ? 0 : sim.advance(frameMs / 1000);
    sim.interpolate(alpha, pose);

    aircraft.update(pose, time, dt);
    rig.update(pose, dt, opts.poster);
    fill.position.copy(camera.position);
    sky.mesh.position.copy(camera.position);
    routeViz.update(sim, pose);
    labels.setActive(sim.targetWaypoint.id);
    labels.update(camera, width, height);
    ground.material.uniforms.uTime!.value = time;
    engUniform.value = damp(engUniform.value as number, engTarget, 8, dt);

    stats.stepsPerFrame = sim.steps - before;
    stats.frameMs = resolution.averageFrameMs;
    stats.pixelRatio = resolution.pixelRatio;
    engineering.update(sim, pose, renderer, stats, now);

    renderer.render(scene, camera);

    if (!opts.poster && resolution.sample(frameMs)) resize();
    if (!drawn) {
      drawn = true;
      opts.onFirstFrame?.();
    }
  }

  // Don't burn battery in a background tab; on return, don't "catch up" the gap.
  function onVisibility(): void {
    if (document.hidden) {
      cancelAnimationFrame(raf);
    } else if (!disposed) {
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }
  }
  document.addEventListener('visibilitychange', onVisibility);

  function onContextLost(e: Event): void {
    e.preventDefault();
    cancelAnimationFrame(raf);
    opts.onContextLost?.();
  }
  opts.canvas.addEventListener('webglcontextlost', onContextLost);

  raf = requestAnimationFrame(frame);

  return {
    setTarget(id) {
      sim.setTarget(id);
    },
    setEngineering(on) {
      engTarget = on ? 1 : 0;
      engineering.setEnabled(on);
      routeViz.setEngineering(on);
    },
    setSimRate(rate) {
      sim.timeScale = Math.min(Math.max(rate, 0.25), 8);
    },
    readout(): FlightReadout {
      const s = sim.state;
      const distances: Record<string, number> = {};
      for (const stop of ROUTE) distances[stop.id] = Math.hypot(stop.x - s[S.X]!, stop.z - s[S.Z]!);
      return {
        mode: sim.mode,
        target: sim.targetWaypoint.id,
        distances,
        groundSpeed: s[S.V]! * Math.cos(s[S.GAMMA]!),
        altitude: s[S.Y]!,
        heading: s[S.PSI]!,
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      opts.canvas.removeEventListener('webglcontextlost', onContextLost);
      labels.dispose();
      sky.dispose();
      terrain.dispose();
      ground.dispose();
      aircraft.dispose();
      routeViz.dispose();
      env.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
