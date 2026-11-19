import {
  ACESFilmicToneMapping,
  DirectionalLight,
  HemisphereLight,
  PerspectiveCamera,
  Quaternion,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import { FlightDataBus } from '../sim/flightData';
import { damp } from '../sim/math';
import { createRenderState, FlightSimulation } from '../sim/simulation';
import { WORLD } from '../world/navdata';
import { ROUTE } from '../world/route';
import { terrainHeight } from '../world/terrain';
import { createAircraft } from './aircraftModel';
import { createAirportBuildings } from './airportModels';
import { CameraRig, type CameraMode } from './cameraRig';
import { createCockpit } from './cockpit/index';
import { EngineeringView } from './engineering';
import { SUN_DIR } from './environment';
import { createGroundLights } from './groundLights';
import { Hud } from './hud';
import { FixLabels } from './labels';
import { bodyQuaternion } from './pose';
import { AdaptiveResolution, chooseProfile } from './quality';
import { createRouteViz } from './routeViz';
import { createSky, createSkyEnvironment } from './sky';
import { createTerrain } from './terrainMesh';
import type { SceneController, SceneOptions, ViewMode } from './types';

const CAMERA_MODES: CameraMode[] = ['chase', 'orbit', 'cockpit'];

/**
 * Build the scene and start the render loop.
 *
 * Per frame: advance the simulation by the frame's wall-clock time (it runs fixed 120 Hz
 * steps internally), interpolate a pose between the last two physics states, build the
 * flight data every instrument reads, then draw: the world, and, when the camera is in
 * the cockpit, the cockpit interior in a second pass with its own near plane.
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
  const camera = new PerspectiveCamera(38, 1, 3, 125_000);

  // The poster is a fixed moment of the climb-out; a visit starts just after lift-off.
  const sim = new FlightSimulation({ world: WORLD, warmup: opts.startAt ?? (opts.poster ? 150 : 36) });
  const bus = new FlightDataBus(sim);
  const pose = createRenderState();
  const body = new Quaternion();
  const aircraftPos = new Vector3();

  const sky = createSky();
  scene.add(sky.mesh);
  const env = createSkyEnvironment(renderer);
  scene.environment = env.texture;

  const terrain = await createTerrain(profile.terrainSegments > 260);
  scene.add(terrain.mesh);
  const buildings = createAirportBuildings();
  scene.add(buildings.mesh);
  const ground = createGroundLights();
  scene.add(ground.points);
  const aircraft = createAircraft();
  scene.add(aircraft.group);
  const routeViz = createRouteViz();
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

  const labels = new FixLabels(opts.labels);
  labels.setPlan(sim.plan);
  const rig = new CameraRig(camera);
  rig.reducedMotion = !!opts.reducedMotion;
  const engineering = new EngineeringView(opts.panel);
  scene.add(engineering.group);
  const cockpit = createCockpit(renderer);
  const hud = opts.hud ? new Hud(opts.hud) : null;

  let view: ViewMode = opts.view;
  let paused = !!opts.reducedMotion && !opts.poster;
  let simRate = 1;
  sim.timeScale = paused ? 0 : 1;

  function followSection(id: string): void {
    if (id === 'home' || id === 'top') {
      sim.resume();
      return;
    }
    const stop = ROUTE.find((s) => s.id === id);
    if (stop) sim.holdAt(stop.fix);
  }
  if (view === 'read' && opts.initialSection !== 'home') followSection(opts.initialSection);

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
    rig.baseFov = height > width ? 54 : view === 'fly' ? 42 : 38;
    if (view === 'read') {
      // Wide layouts read on the left, so frame the aircraft right of centre. Narrow ones
      // stack the text below, so put it in the band near the top.
      const wide = width >= 1080;
      camera.setViewOffset(width, height, wide ? -width * 0.17 : 0, wide ? height * 0.12 : height * 0.32, width, height);
    } else {
      camera.clearViewOffset();
    }
    camera.updateProjectionMatrix();
    cockpit.resize(width, height);
    routeViz.setResolution(width, height);
    const u = ground.material.uniforms;
    u.uScale!.value = (camera.projectionMatrix.elements[5]! * height) / 2;
    u.uPixelRatio!.value = resolution.pixelRatio;
  }
  const ro = new ResizeObserver(resize);
  ro.observe(opts.canvas);
  resize();

  // --- input (Fly mode): drag to look, wheel or pinch to zoom, keys for the rest
  const pointers = new Map<number, { x: number; y: number }>();
  /** The cockpit display the camera is focused on, if any. */
  let focused: string | null = null;
  let pinch = 0;
  let downAt = { x: 0, y: 0, t: 0 };
  const canvas = opts.canvas;
  const flying = () => view === 'fly';

  function onPointerDown(e: PointerEvent): void {
    if (!flying()) return;
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = Math.hypot(a!.x - b!.x, a!.y - b!.y);
    }
  }
  function onPointerMove(e: PointerEvent): void {
    const p = pointers.get(e.pointerId);
    if (!p || !flying()) return;
    if (pointers.size === 1) {
      rig.drag(e.clientX - p.x, e.clientY - p.y);
    } else if (pointers.size === 2) {
      p.x = e.clientX;
      p.y = e.clientY;
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      if (pinch > 0 && d > 0) rig.zoom(pinch / d);
      pinch = d;
      return;
    }
    p.x = e.clientX;
    p.y = e.clientY;
  }
  function onPointerUp(e: PointerEvent): void {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    pinch = 0;
    // A click (not a drag) in the cockpit presses whatever is under it.
    const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
    if (flying() && moved < 6 && performance.now() - downAt.t < 500 && rig.mode === 'cockpit') {
      const rect = canvas.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      const hit = cockpit.click(x, y, sim, focused);
      if (hit?.action === 'focus') {
        rig.focusOn(hit.target);
        focused = hit.id;
      } else if (hit?.action === 'unfocus') {
        rig.clearFocus();
        focused = null;
      }
    }
  }
  function onWheel(e: WheelEvent): void {
    if (!flying()) return;
    e.preventDefault();
    rig.zoom(Math.exp(Math.max(-100, Math.min(100, e.deltaY)) * 0.0015));
  }
  function onKey(e: KeyboardEvent): void {
    if (!flying() || e.altKey || e.ctrlKey || e.metaKey) return;
    const target = e.target as HTMLElement;
    if (target.closest('input, textarea, select, [contenteditable]')) return;
    const step = 24;
    switch (e.key) {
      case 'ArrowLeft': rig.drag(-step, 0); break;
      case 'ArrowRight': rig.drag(step, 0); break;
      case 'ArrowUp': rig.drag(0, -step); break;
      case 'ArrowDown': rig.drag(0, step); break;
      case '+': case '=': rig.zoom(1 / 1.15); break;
      case '-': case '_': rig.zoom(1.15); break;
      case 'c': case 'C': {
        const next = CAMERA_MODES[(CAMERA_MODES.indexOf(rig.mode) + 1) % CAMERA_MODES.length]!;
        controller.setCamera(next);
        opts.onCameraChange?.(next);
        break;
      }
      case 'r': case 'R': rig.reset(); focused = null; break;
      case 'Escape':
        if (!rig.focused) return;
        rig.clearFocus();
        focused = null;
        break;
      default: return;
    }
    if (e.target === canvas) e.preventDefault();
  }
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('keydown', onKey);

  // --- loop
  let raf = 0;
  let last = performance.now();
  let time = 0;
  let drawn = false;
  let disposed = false;
  let engTarget = 0;
  let lastFlight = sim.flight;
  let lastHud = 0;
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
    bodyQuaternion(pose, body);
    aircraftPos.set(pose.x, pose.y, pose.z);
    const data = bus.update();
    if (sim.flight !== lastFlight) {
      lastFlight = sim.flight;
      labels.setPlan(sim.plan);
    }

    aircraft.update(pose, body, time, dt);
    // The landing lights' pool on the ground: ahead of the wing roots, aimed a little down.
    const tu = terrain.material.uniforms;
    tu.uLandingLightPos!.value.set(0, 2.2, -2.5).applyQuaternion(body).add(aircraftPos);
    tu.uLandingLightDir!.value.set(0, -0.09, -1).normalize().applyQuaternion(body);
    tu.uLandingLight!.value = damp(tu.uLandingLight!.value as number, pose.landingLights && rig.inside < 0.99 ? 1 : pose.landingLights ? 0.8 : 0, 3, dt);
    rig.update(pose, aircraftPos, body, dt, terrainHeight, opts.poster);
    const inside = rig.inside;
    aircraft.group.visible = inside < 0.6;
    fill.position.copy(camera.position);
    sky.mesh.position.copy(camera.position);
    routeViz.update(sim);
    // From the flight deck the route isn't painted on the sky.
    routeViz.group.visible = inside < 0.5;
    labels.setActive(sim.fms.hold ? sim.fms.hold.fix.ident : data.activeIdent);
    labels.update(camera, width, height);
    ground.material.uniforms.uTime!.value = time;
    engUniform.value = damp(engUniform.value as number, engTarget, 8, dt);

    stats.stepsPerFrame = sim.steps - before;
    stats.frameMs = resolution.averageFrameMs;
    stats.pixelRatio = resolution.pixelRatio;
    engineering.update(sim, data, pose, renderer, stats, now);
    if (hud && view === 'fly' && now - lastHud > 100) {
      lastHud = now;
      hud.update(data, sim);
    }

    renderer.autoClear = true;
    renderer.render(scene, camera);
    if (inside > 0.02) {
      cockpit.update(data, sim, camera, aircraftPos, body, dt, now);
      renderer.autoClear = false;
      renderer.clearDepth();
      renderer.render(cockpit.scene, cockpit.camera);
    }

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
  canvas.addEventListener('webglcontextlost', onContextLost);

  const controller: SceneController = {
    followSection,
    directTo(ident) {
      return sim.directTo(ident);
    },
    toggleHold() {
      if (sim.fms.hold || sim.fms.pendingHold) sim.resume();
      else sim.holdAt(sim.plan.legs[sim.fms.legIndex]!.ident) || sim.holdAt(sim.plan.destination.ident);
    },
    setView(next) {
      if (next === view) return;
      view = next;
      if (view === 'read' && rig.mode !== 'chase') rig.setMode('chase', aircraftPos, body);
      if (view === 'read') rig.reset();
      resize();
    },
    setCamera(mode) {
      rig.setMode(mode, aircraftPos, body);
      focused = null;
    },
    focusDisplay(id) {
      if (rig.mode !== 'cockpit') rig.setMode('cockpit', aircraftPos, body);
      const s = id ? cockpit.surface(id) : null;
      if (s && id) {
        rig.focusOn(s);
        focused = id;
      } else {
        rig.clearFocus();
        focused = null;
      }
    },
    get cameraMode() {
      return rig.mode;
    },
    resetCamera() {
      rig.reset();
    },
    setEngineering(on) {
      engTarget = on ? 1 : 0;
      engineering.setEnabled(on);
      routeViz.setEngineering(on);
    },
    setSimRate(rate) {
      simRate = Math.min(Math.max(rate, 0.25), 8);
      if (!paused) sim.timeScale = simRate;
    },
    setPaused(p) {
      paused = p;
      sim.timeScale = p ? 0 : simRate;
    },
    get paused() {
      return paused;
    },
    data() {
      return bus.data;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKey);
      hud?.dispose();
      labels.dispose();
      sky.dispose();
      terrain.dispose();
      buildings.dispose();
      ground.dispose();
      aircraft.dispose();
      routeViz.dispose();
      cockpit.dispose();
      env.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
  hud?.bind(controller, sim);

  raf = requestAnimationFrame(frame);
  return controller;
}
