import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  LatheGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
  Vector2,
  Vector3,
  type Texture,
} from 'three';
import type { RenderState } from '../sim/simulation';

/*
 * A generic high-wing, four-turboprop transport, modelled in code (no asset to load).
 * Local axes: forward −Z, up +Y, right +X. Dimensions in metres.
 */

/** A tapered panel (wing, stabilizer, fin) from root and tip outlines. */
function panel(
  root: { le: Vector3; chord: number; thick: number },
  tip: { le: Vector3; chord: number; thick: number },
  vertical = false,
): BufferGeometry {
  // Chord runs aft (+Z). Thickness is across the panel's plane (y for wings, x for fins).
  const t = (s: { thick: number }, sign: number) =>
    vertical ? new Vector3((sign * s.thick) / 2, 0, 0) : new Vector3(0, (sign * s.thick) / 2, 0);
  const corners = [
    root.le.clone().add(t(root, 1)), // 0 root LE top
    root.le.clone().add(new Vector3(0, 0, root.chord)).add(t(root, 0.3)), // 1 root TE top (thin trailing edge)
    tip.le.clone().add(t(tip, 1)), // 2 tip LE top
    tip.le.clone().add(new Vector3(0, 0, tip.chord)).add(t(tip, 0.3)), // 3 tip TE top
    root.le.clone().add(t(root, -1)), // 4 root LE bottom
    root.le.clone().add(new Vector3(0, 0, root.chord)).add(t(root, -0.3)), // 5
    tip.le.clone().add(t(tip, -1)), // 6
    tip.le.clone().add(new Vector3(0, 0, tip.chord)).add(t(tip, -0.3)), // 7
  ];
  const faces = [
    [0, 2, 1], [1, 2, 3], // top
    [4, 5, 6], [5, 7, 6], // bottom
    [0, 4, 2], [2, 4, 6], // leading edge
    [1, 3, 5], [3, 7, 5], // trailing edge
    [2, 6, 3], [3, 6, 7], // tip
    [0, 1, 4], [1, 5, 4], // root
  ];
  const pos: number[] = [];
  for (const f of faces) for (const i of f) pos.push(corners[i]!.x, corners[i]!.y, corners[i]!.z);
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.computeVertexNormals();
  return g;
}

/** Mirror a geometry across the YZ plane (left ↔ right). */
function mirrored(g: BufferGeometry): BufferGeometry {
  const m = g.clone();
  m.scale(-1, 1, 1);
  // Scaling by −1 flips winding; swap two vertices per triangle to restore it.
  const p = m.getAttribute('position') as BufferAttribute;
  for (let i = 0; i < p.count; i += 3) {
    const x = p.getX(i + 1), y = p.getY(i + 1), z = p.getZ(i + 1);
    p.setXYZ(i + 1, p.getX(i + 2), p.getY(i + 2), p.getZ(i + 2));
    p.setXYZ(i + 2, x, y, z);
  }
  m.computeVertexNormals();
  return m;
}

function fuselage(): BufferGeometry {
  // Profile along the lathe's Y axis (tail at −Y, nose at +Y), then rotated so +Y → −Z.
  const profile: [number, number][] = [
    [0.0, -15.2], [0.45, -15.0], [1.0, -13.0], [1.6, -10.5], [2.05, -7.5], [2.2, -4.5],
    [2.25, 0], [2.25, 6.5], [2.15, 9.5], [1.85, 11.8], [1.35, 13.4], [0.7, 14.5], [0.25, 15.0], [0.0, 15.15],
  ];
  const g = new LatheGeometry(profile.map(([r, y]) => new Vector2(r, y)), 28);
  // Upswept tail: raise the aft fuselage (lathe +Z becomes "up" after rotation).
  const p = g.getAttribute('position') as BufferAttribute;
  const colors = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const lift = y < -5 ? Math.pow((-5 - y) / 10.2, 1.6) * 1.7 : 0;
    p.setZ(i, p.getZ(i) + lift);
    // Paint the cockpit windows dark: upper, forward ring band near the nose.
    const r = Math.hypot(p.getX(i), p.getZ(i) - lift);
    const up = r > 0 ? (p.getZ(i) - lift) / r : 0;
    const window = y > 12.1 && y < 13.8 && up > 0.25;
    const c = window ? 0.08 : 1;
    colors.set([c, c, c * 1.05], i * 3);
  }
  g.setAttribute('color', new BufferAttribute(colors, 3));
  g.rotateX(-Math.PI / 2);
  g.computeVertexNormals();
  return g;
}

function glowTexture(): Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.18, 'rgba(255,255,255,0.85)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.18)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** A soft disc with faint blade streaks: reads as a spinning propeller. */
function propTexture(): Texture {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d')!;
  ctx.translate(s / 2, s / 2);
  for (let i = 0; i < 6; i++) {
    ctx.rotate(Math.PI / 3);
    const grad = ctx.createLinearGradient(0, -s / 2, 0, 0);
    grad.addColorStop(0, 'rgba(200,210,225,0.05)');
    grad.addColorStop(1, 'rgba(200,210,225,0.28)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(-3, 0);
    ctx.lineTo(-7, -s / 2 + 4);
    ctx.lineTo(7, -s / 2 + 4);
    ctx.lineTo(3, 0);
    ctx.fill();
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const halo = ctx.createRadialGradient(s / 2, s / 2, 4, s / 2, s / 2, s / 2);
  halo.addColorStop(0, 'rgba(210,220,235,0.18)');
  halo.addColorStop(0.92, 'rgba(210,220,235,0.07)');
  halo.addColorStop(1, 'rgba(210,220,235,0)');
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, s, s);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

interface NavLight {
  sprite: Sprite;
  /** null = steady; otherwise a flash pattern */
  pattern: 'beacon' | 'strobe' | null;
  base: number;
}

const yawQ = new Quaternion();
const pitchQ = new Quaternion();
const rollQ = new Quaternion();
const aoaQ = new Quaternion();
const X = new Vector3(1, 0, 0);
const Y = new Vector3(0, 1, 0);
const Z = new Vector3(0, 0, 1);

export function createAircraft() {
  const group = new Group();
  const disposables: { dispose(): void }[] = [];
  const track = <T extends { dispose(): void }>(x: T) => (disposables.push(x), x);

  const skin = track(
    new MeshStandardMaterial({ color: new Color('#d6dbe2'), roughness: 0.52, metalness: 0.18, vertexColors: true }),
  );
  // Double-sided: the hand-built panels don't need consistent winding, and three.js flips
  // the normal for back faces, so lighting stays correct either way.
  const plain = track(
    new MeshStandardMaterial({ color: new Color('#d6dbe2'), roughness: 0.52, metalness: 0.18, side: DoubleSide }),
  );
  const dark = track(new MeshStandardMaterial({ color: new Color('#242b36'), roughness: 0.5, metalness: 0.3, side: DoubleSide }));

  const add = (g: BufferGeometry, m: MeshStandardMaterial) => {
    const mesh = new Mesh(track(g), m);
    group.add(mesh);
    return mesh;
  };

  add(fuselage(), skin);

  // High wing, slight dihedral, mounted on top of the fuselage.
  const wing = panel(
    { le: new Vector3(0, 2.05, -1.6), chord: 4.4, thick: 0.62 },
    { le: new Vector3(20, 2.55, -0.4), chord: 2.3, thick: 0.26 },
  );
  add(wing, plain);
  add(mirrored(wing), plain);

  // Tailplane and fin.
  const tailplane = panel(
    { le: new Vector3(0, 1.75, 11.6), chord: 3.4, thick: 0.34 },
    { le: new Vector3(7.8, 1.9, 13.4), chord: 1.6, thick: 0.16 },
  );
  add(tailplane, plain);
  add(mirrored(tailplane), plain);
  add(
    panel(
      { le: new Vector3(0, 2.2, 9.4), chord: 5.6, thick: 0.42 },
      { le: new Vector3(0, 9.6, 12.6), chord: 2.6, thick: 0.2 },
      true,
    ),
    plain,
  );

  // Four nacelles with spinners and propeller discs.
  const props: Mesh[] = [];
  const propMat = track(
    new MeshBasicMaterial({
      map: track(propTexture()),
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      opacity: 0.85,
    }),
  );
  const nacelleGeo = track(new CylinderGeometry(0.72, 0.62, 5.4, 16));
  nacelleGeo.rotateX(Math.PI / 2);
  const spinnerGeo = track(new ConeGeometry(0.42, 1.1, 16));
  spinnerGeo.rotateX(-Math.PI / 2);
  const discGeo = track(new CircleGeometry(2.05, 32));
  for (const x of [-11.2, -5.6, 5.6, 11.2]) {
    const yWing = 2.05 + (Math.abs(x) / 20) * 0.5;
    const nacelle = new Mesh(nacelleGeo, plain);
    nacelle.position.set(x, yWing - 0.55, -2.3);
    group.add(nacelle);
    const spinner = new Mesh(spinnerGeo, dark);
    spinner.position.set(x, yWing - 0.55, -5.55);
    group.add(spinner);
    const disc = new Mesh(discGeo, propMat);
    disc.position.set(x, yWing - 0.55, -5.25);
    group.add(disc);
    props.push(disc);
  }

  // Navigation and anti-collision lights.
  const glow = track(glowTexture());
  const nav: NavLight[] = [];
  const light = (pos: Vector3, color: string, scale: number, pattern: NavLight['pattern']) => {
    const m = track(new SpriteMaterial({ map: glow, color, blending: AdditiveBlending, depthWrite: false, transparent: true }));
    const s = new Sprite(m);
    s.position.copy(pos);
    s.scale.setScalar(scale);
    group.add(s);
    nav.push({ sprite: s, pattern, base: scale });
  };
  light(new Vector3(-20.1, 2.6, 0.2), '#ff3b30', 2.2, null); // port: red
  light(new Vector3(20.1, 2.6, 0.2), '#34ff6a', 2.2, null); // starboard: green
  light(new Vector3(0, 3.3, 15.4), '#ffffff', 1.6, null); // tail: white
  light(new Vector3(0, 2.6, 3.0), '#ff2a1a', 2.6, 'beacon');
  light(new Vector3(0, -2.3, 1.0), '#ff2a1a', 2.6, 'beacon');
  light(new Vector3(-20.1, 2.6, 0.6), '#f4f7ff', 3.2, 'strobe');
  light(new Vector3(20.1, 2.6, 0.6), '#f4f7ff', 3.2, 'strobe');

  let propAngle = 0;

  return {
    group,
    /** Pose the model from the (interpolated) simulation state. */
    update(pose: RenderState, time: number, dt: number) {
      group.position.set(pose.x, pose.y, pose.z);
      // Wind axes → body: yaw by heading, pitch by flight-path angle, roll by bank about the
      // velocity vector, then pitch up by angle of attack. Exact, not a small-angle shortcut.
      yawQ.setFromAxisAngle(Y, -pose.psi);
      pitchQ.setFromAxisAngle(X, pose.gamma);
      rollQ.setFromAxisAngle(Z, -pose.phi);
      aoaQ.setFromAxisAngle(X, pose.alpha);
      group.quaternion.copy(yawQ).multiply(pitchQ).multiply(rollQ).multiply(aoaQ);

      // Props: fast enough to blur, slower with less power. (Spun on the disc's own axis.)
      propAngle += dt * (14 + 10 * pose.thrust);
      for (let i = 0; i < props.length; i++) props[i]!.rotation.z = propAngle * (i % 2 ? 1 : -1);

      for (const l of nav) {
        if (!l.pattern) continue;
        let on: number;
        if (l.pattern === 'beacon') {
          const ph = (time * 1.1) % 1;
          on = ph < 0.12 ? 1 : 0;
        } else {
          // double flash every 1.3 s
          const ph = time % 1.3;
          on = ph < 0.05 || (ph > 0.16 && ph < 0.21) ? 1 : 0;
        }
        l.sprite.visible = on > 0;
        l.sprite.scale.setScalar(l.base * (l.pattern === 'strobe' ? 2.4 : 1.4));
      }
    },
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}
