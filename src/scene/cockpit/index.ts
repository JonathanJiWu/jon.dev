import {
  AmbientLight,
  BackSide,
  BoxGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  type Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  Quaternion,
  Raycaster,
  Scene,
  SRGBColorSpace,
  TorusGeometry,
  Vector2,
  Vector3,
  type WebGLRenderer,
} from 'three';
import type { FlightData } from '../../sim/flightData';
import type { FlightSimulation } from '../../sim/simulation';
import { fuselageGeometry } from '../aircraftModel';
import { WINDOWS, Z0, Z1 } from '../airframe';
import type { FocusTarget } from '../cameraRig';
import { SUN_DIR } from '../environment';
import { C, Cdu, type Display, Eicas, FONT, Mcp, Mfd, Nd, Pfd } from './displays';

export type ClickResult =
  | { action: 'focus'; id: string; target: FocusTarget }
  | { action: 'press'; id: string }
  | { action: 'unfocus' };

const DEG = Math.PI / 180;

/** The window openings: an alpha mask in the fuselage's texture space (see airframe.ts). */
function windowMask(): CanvasTexture {
  const W = 2048;
  const H = 512;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff';
  g.fillRect(0, 0, W, H);
  const X = (z: number) => ((z - Z0) / (Z1 - Z0)) * W;
  const Y = (t: number) => (1 - t / 2) * H;
  g.fillStyle = '#000';
  for (const w of WINDOWS) {
    g.beginPath();
    g.roundRect(X(w.z0), Y(w.t1), X(w.z1) - X(w.z0), Y(w.t0) - Y(w.t1), w.radius);
    g.fill();
  }
  return new CanvasTexture(c);
}

/** A static overhead panel: rows of switches and annunciators (decorative). */
function overheadTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 384;
  const g = c.getContext('2d')!;
  g.fillStyle = '#2a313b';
  g.fillRect(0, 0, 512, 384);
  const groups = ['ELEC', 'HYD', 'FUEL', 'BLEED', 'PRESS', 'ANTI-ICE', 'LIGHTS', 'ENGINE START'];
  groups.forEach((name, i) => {
    const x = 16 + (i % 4) * 124;
    const y = 16 + Math.floor(i / 4) * 184;
    g.strokeStyle = '#4a5463';
    g.lineWidth = 2;
    g.strokeRect(x, y, 112, 168);
    g.fillStyle = '#c9d1dc';
    g.font = `700 13px ${FONT}`;
    g.textAlign = 'center';
    g.fillText(name, x + 56, y + 18);
    for (let r = 0; r < 3; r++) {
      for (let k = 0; k < 3; k++) {
        const sx = x + 22 + k * 34;
        const sy = y + 46 + r * 42;
        g.fillStyle = '#11151b';
        g.fillRect(sx - 9, sy - 9, 18, 18);
        g.fillStyle = (i + r + k) % 5 === 0 ? '#2f6f4a' : '#1d232b';
        g.fillRect(sx - 7, sy - 7, 14, 14);
      }
    }
  });
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

function placardTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 48;
  const g = c.getContext('2d')!;
  g.fillStyle = '#1c2129';
  g.fillRect(0, 0, 512, 48);
  g.fillStyle = '#c9d1dc';
  g.font = `700 20px ${FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('SIMULATED · NOT FOR NAVIGATION', 256, 25);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

interface Surface {
  display: Display;
  mesh: Mesh;
  /** Where it is and which way it faces, in the aircraft frame, for leaning in to it. */
  target: FocusTarget;
}

/**
 * The flight deck, rendered in the aircraft's own frame in a second pass (so the
 * millimetre-scale interior and the 100 km world each get the depth precision they
 * need). Two seats, yokes and thrust levers that move with the flight, a glareshield with
 * the mode control panel, and six live displays: captain's and first officer's PFD and
 * ND, the engine display and the multifunction display, two CDUs and an overhead panel.
 */
export function createCockpit(renderer: WebGLRenderer) {
  const scene = new Scene();
  const camera = new PerspectiveCamera(64, 1, 0.02, 40);
  const root = new Group();
  scene.add(root);
  const disposables: { dispose(): void }[] = [];
  const track = <T extends { dispose(): void }>(x: T) => (disposables.push(x), x);

  // ---- Lighting, in the aircraft's frame (updated each frame from the world). Dusk: the
  // panel is lit by its own flood lights and the displays' glow, the rest by the sky.
  const ambient = new AmbientLight(0x9aa5bb, 2.4);
  const hemi = new HemisphereLight(0xa8b9e4, 0x3a3028, 2.2);
  const sun = new DirectionalLight(0xffb27a, 1.6);
  const flood = new PointLight(0xffd7a0, 4.5, 3.6, 1.2);
  flood.position.set(0, 1.25, -12.0);
  const pedestalFlood = new PointLight(0xffd7a0, 2.0, 1.8, 1.2);
  pedestalFlood.position.set(0, 0.6, -11.6);
  scene.add(ambient, hemi, sun, sun.target, flood, pedestalFlood);

  // ---- Materials
  const interior = track(new MeshStandardMaterial({ color: new Color('#5f6774'), roughness: 0.88, metalness: 0.05 }));
  const panelMat = track(new MeshStandardMaterial({ color: new Color('#454c57'), roughness: 0.75, metalness: 0.1 }));
  const seatMat = track(new MeshStandardMaterial({ color: new Color('#68707c'), roughness: 0.95, metalness: 0 }));
  const metal = track(new MeshStandardMaterial({ color: new Color('#a7afba'), roughness: 0.35, metalness: 0.8 }));
  const knob = track(new MeshStandardMaterial({ color: new Color('#e3e6ea'), roughness: 0.5, metalness: 0.1 }));
  const mask = track(windowMask());
  const shellMat = track(new MeshStandardMaterial({ color: new Color('#58606c'), roughness: 0.9, metalness: 0.05, side: BackSide, alphaMap: mask, alphaTest: 0.5 }));

  // ---- Shell: the inside of the nose, with the windows cut out of the same layout the
  // livery paints on the outside.
  const shell = new Mesh(track(fuselageGeometry(-14.6, -10.2, 44, 64, 0.05)), shellMat);
  root.add(shell);

  const box = (w: number, h: number, d: number, mat: MeshStandardMaterial, x: number, y: number, z: number, rx = 0, parent: Object3D = root) => {
    const m = new Mesh(track(new BoxGeometry(w, h, d)), mat);
    m.position.set(x, y, z);
    m.rotation.x = rx;
    parent.add(m);
    return m;
  };

  // Floor, the bulkhead behind the seats, side consoles
  box(3.4, 0.06, 3.9, interior, 0, -0.64, -11.9);
  box(3.8, 2.6, 0.06, interior, 0, 0.5, -10.25);
  for (const s of [-1, 1]) box(0.34, 0.52, 1.5, panelMat, s * 1.3, -0.3, -11.3);

  // Main instrument panel, ~0.85 m ahead of the eye and tilted back, under a glareshield
  // hood that carries the mode control panel. The displays sit about 25° below eye level.
  const PANEL = { z: -12.56, y: 0.2, tilt: -12 * DEG };
  const panel = new Group();
  panel.position.set(0, PANEL.y, PANEL.z);
  panel.rotation.x = PANEL.tilt;
  root.add(panel);
  box(2.4, 0.8, 0.08, panelMat, 0, 0, -0.04, 0, panel);
  // The glareshield is matte black, so it doesn't reflect in the windshield.
  const glareMat = track(new MeshStandardMaterial({ color: new Color('#22262d'), roughness: 0.95, metalness: 0 }));
  box(2.5, 0.05, 0.32, glareMat, 0, 0.625, -12.46);
  box(2.5, 0.14, 0.04, glareMat, 0, 0.56, -12.31);

  // Pedestal between the seats: CDUs up front, then the power and flap levers.
  box(0.56, 0.6, 1.55, panelMat, 0, -0.36, -11.7);
  const pedTop = new Group();
  pedTop.position.set(0, -0.05, -11.85);
  pedTop.rotation.x = -6 * DEG;
  root.add(pedTop);
  box(0.56, 0.04, 1.3, panelMat, 0, 0, 0, 0, pedTop);

  // Seats
  for (const x of [-0.55, 0.55]) {
    box(0.52, 0.12, 0.52, seatMat, x, -0.12, -11.3);
    box(0.52, 0.92, 0.12, seatMat, x, 0.4, -10.98, -12 * DEG);
    box(0.3, 0.2, 0.1, seatMat, x, 0.98, -10.9, -12 * DEG);
    box(0.07, 0.06, 0.42, seatMat, x - 0.29, 0.1, -11.3);
    box(0.07, 0.06, 0.42, seatMat, x + 0.29, 0.1, -11.3);
  }

  // Control columns and yokes
  const yokes: Group[] = [];
  const columnGeo = track(new CylinderGeometry(0.03, 0.035, 0.74, 10));
  const yokeGeo = track(new TorusGeometry(0.16, 0.018, 8, 24, Math.PI * 1.25));
  const YOKE_Z = -12.12;
  for (const x of [-0.55, 0.55]) {
    const column = new Group();
    column.position.set(x, -0.62, YOKE_Z);
    const shaft = new Mesh(columnGeo, metal);
    shaft.position.y = 0.37;
    column.add(shaft);
    const yoke = new Group();
    yoke.position.y = 0.78;
    const wheel = new Mesh(yokeGeo, panelMat);
    wheel.rotation.z = Math.PI * 1.125;
    yoke.add(wheel);
    yoke.rotation.x = -18 * DEG;
    column.add(yoke);
    root.add(column);
    yokes.push(column);
  }

  // Power levers (four) and the flap lever, on the pedestal
  const levers: Group[] = [];
  const leverGeo = track(new BoxGeometry(0.018, 0.2, 0.018));
  const knobGeo = track(new BoxGeometry(0.04, 0.03, 0.03));
  for (let i = 0; i < 4; i++) {
    const g = new Group();
    g.position.set(-0.105 + i * 0.07, -0.03, -11.62);
    const lever = new Mesh(leverGeo, metal);
    lever.position.y = 0.1;
    g.add(lever);
    const k = new Mesh(knobGeo, knob);
    k.position.y = 0.2;
    g.add(k);
    root.add(g);
    levers.push(g);
  }
  const flapLever = new Group();
  flapLever.position.set(0.22, -0.04, -11.4);
  const fl = new Mesh(leverGeo, metal);
  fl.position.y = 0.08;
  flapLever.add(fl);
  const flk = new Mesh(knobGeo, knob);
  flk.position.y = 0.17;
  flk.scale.set(1.3, 1.2, 1.6);
  flapLever.add(flk);
  root.add(flapLever);

  // ---- Displays
  const pfd = new Pfd();
  const nd = new Nd();
  const eicas = new Eicas();
  const mfd = new Mfd();
  const cdu = new Cdu();
  const mcp = new Mcp();
  const displays: Display[] = [pfd, nd, eicas, mfd, cdu, mcp];
  const surfaces: Surface[] = [];
  const addSurface = (display: Display, w: number, h: number, parent: Object3D, x: number, y: number, z: number, rx = 0, id = display.id) => {
    const mat = track(new MeshBasicMaterial({ map: display.texture, toneMapped: false }));
    const mesh = new Mesh(track(new PlaneGeometry(w, h)), mat);
    mesh.position.set(x, y, z);
    mesh.rotation.x = rx;
    mesh.name = id;
    parent.add(mesh);
    root.updateMatrixWorld(true);
    const center = new Vector3();
    mesh.getWorldPosition(center);
    const normal = new Vector3(0, 0, 1).transformDirection(mesh.matrixWorld);
    const up = new Vector3(0, 1, 0).transformDirection(mesh.matrixWorld);
    surfaces.push({ display, mesh, target: { center, normal, up, width: w, height: h } });
  };
  const S = 0.3;
  addSurface(pfd, S, S, panel, -0.78, 0.15, 0.006, 0, 'pfd-l');
  addSurface(nd, S, S, panel, -0.43, 0.15, 0.006, 0, 'nd-l');
  addSurface(eicas, S, S, panel, 0, 0.15, 0.006);
  addSurface(mfd, S, S, panel, 0, -0.2, 0.006);
  addSurface(nd, S, S, panel, 0.43, 0.15, 0.006, 0, 'nd-r');
  addSurface(pfd, S, S, panel, 0.78, 0.15, 0.006, 0, 'pfd-r');
  addSurface(mcp, 0.64, 0.1, root, 0, 0.565, -12.287, 0);
  for (const x of [-0.135, 0.135]) addSurface(cdu, 0.2, 0.25, pedTop, x, 0.024, -0.32, -Math.PI / 2 + 40 * DEG, `cdu-${x < 0 ? 'l' : 'r'}`);

  // Overhead panel and the simulation placard
  const overhead = new Mesh(track(new PlaneGeometry(1.3, 0.95)), track(new MeshStandardMaterial({ map: track(overheadTexture()), roughness: 0.8 })));
  overhead.position.set(0, 1.62, -11.5);
  overhead.rotation.x = Math.PI / 2 - 22 * DEG;
  root.add(overhead);
  const placard = new Mesh(track(new PlaneGeometry(0.52, 0.05)), track(new MeshBasicMaterial({ map: track(placardTexture()), toneMapped: false })));
  placard.position.set(-0.6, -0.36, 0.004);
  panel.add(placard);

  // Fonts: the displays draw in B612 Mono (designed for cockpit displays). Redraw once loaded.
  void document.fonts?.load(`20px ${FONT}`).then(() => displays.forEach((d) => d.invalidate()));

  const ray = new Raycaster();
  const ndc = new Vector2();
  const inv = new Quaternion();
  const v = new Vector3();
  const pickable = surfaces.map((s) => s.mesh);

  return {
    scene,
    camera,
    resize(w: number, h: number) {
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    },
    /** Pose the cockpit camera like the world camera, in the aircraft's frame; animate; redraw. */
    update(d: FlightData, sim: FlightSimulation, worldCamera: PerspectiveCamera, aircraftPos: Vector3, body: Quaternion, dt: number, now: number) {
      inv.copy(body).invert();
      camera.position.copy(worldCamera.position).sub(aircraftPos).applyQuaternion(inv);
      camera.quaternion.copy(inv).multiply(worldCamera.quaternion);
      if (camera.fov !== worldCamera.fov) {
        camera.fov = worldCamera.fov;
        camera.updateProjectionMatrix();
      }
      // Sun and sky in the aircraft's frame
      sun.position.copy(SUN_DIR).applyQuaternion(inv).multiplyScalar(10);
      hemi.position.set(0, 1, 0).applyQuaternion(inv);

      // Levers follow the engines' power setting; the flap lever the flap command; the
      // yokes the autopilot's roll and pitch activity.
      const lever = d.powerSetting >= 0 ? -22 + 52 * d.powerSetting : -22 + 30 * d.powerSetting;
      for (const l of levers) l.rotation.x = -lever * DEG;
      flapLever.rotation.x = (20 - 48 * d.flapsCmd) * DEG;
      const roll = Math.max(-1, Math.min(1, (d.fdBank - d.bank) / 15));
      for (const y of yokes) {
        y.rotation.z = -roll * 0.5;
        y.position.z = YOKE_Z - Math.max(-0.06, Math.min(0.06, (d.fdPitch - d.pitch) * 0.01));
      }
      void dt;
      for (const disp of displays) disp.update(d, sim, now);
    },
    /** A click at normalized device coordinates: press a key, focus a display, or let go. */
    click(x: number, y: number, sim: FlightSimulation, focused: string | null): ClickResult | null {
      ndc.set(x, y);
      ray.setFromCamera(ndc, camera);
      const hit = ray.intersectObjects(pickable, false)[0];
      if (!hit || !hit.uv) return focused ? { action: 'unfocus' } : null;
      const s = surfaces.find((q) => q.mesh === hit.object)!;
      const disp = s.display;
      const key = disp.press(hit.uv.x * disp.width, (1 - hit.uv.y) * disp.height);
      if (key) {
        if (disp instanceof Nd || disp instanceof Mfd) disp.pressKey(key);
        else if (disp instanceof Cdu) disp.pressKey(key, sim);
        return { action: 'press', id: key };
      }
      if (focused === s.mesh.name) return { action: 'unfocus' };
      return { action: 'focus', id: s.mesh.name, target: s.target };
    },
    /** Where a display is, for focusing it from the keyboard. */
    surface(id: string): FocusTarget | null {
      return surfaces.find((q) => q.mesh.name === id || q.display.id === id)?.target ?? null;
    },
    dispose() {
      for (const d of displays) d.dispose();
      for (const d of disposables) d.dispose();
      void v;
      void renderer;
      void C;
    },
  };
}
