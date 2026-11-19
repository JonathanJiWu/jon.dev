import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  LatheGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  type Object3D,
  type Quaternion,
  SphereGeometry,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
  type Texture,
  Vector2,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { RenderState } from '../sim/simulation';
import { CABIN_WINDOWS, ringPoint, stationAt, uvOf, WINDOWS, Z0, Z1 } from './airframe';

/*
 * A generic high-wing, four-turboprop transport, modelled in code (no asset to load):
 * a lofted fuselage with an upswept tail and a painted livery, cambered wings with real
 * airfoil sections, hinged flaps, ailerons, elevators and rudder that move with the
 * simulation, retracting main gear in sponsons, and working lights.
 *
 * Local axes: forward −Z, up +Y, right +X; the origin is the centre of gravity, 3.2 m
 * above the wheels' contact point with the gear down (the flight model's gear height).
 */

// ---------------------------------------------------------------------------
// Fuselage: superellipse cross-sections lofted along the body (shape in airframe.ts)

export function fuselageGeometry(z0 = Z0, z1 = Z1, rings = 72, around = 40, inset = 0): BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const p = new Vector3();
  const full = z0 === Z0 && z1 === Z1;
  for (let i = 0; i <= rings; i++) {
    // Denser rings at the nose and tail, where the shape changes fastest.
    const s = i / rings;
    const k = full ? 0.5 - 0.5 * Math.cos(Math.PI * s) : s;
    const z = z0 + (z1 - z0) * (full ? 0.35 * s + 0.65 * k : s);
    const st = stationAt(z);
    st.w = Math.max(st.w - 2 * inset, 0.01);
    st.h = Math.max(st.h - 2 * inset, 0.01);
    for (let j = 0; j <= around; j++) {
      const t = (j / around) * Math.PI * 2;
      ringPoint(st, t, p);
      pos.push(p.x, p.y, p.z);
      const q = uvOf(z, t);
      uv.push(q.u, q.v);
    }
  }
  const index: number[] = [];
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < around; j++) {
      const a = i * (around + 1) + j;
      const b = a + around + 1;
      // Outward-facing: rings run nose → tail, angle belly → right → top.
      index.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

/** The livery, painted on a canvas: u runs nose → tail, v around from the belly. */
function liveryTextures(): { map: Texture; rough: Texture } {
  const W = 2048;
  const H = 512;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const r = document.createElement('canvas');
  r.width = W;
  r.height = H;
  const rg = r.getContext('2d')!;
  const X = (z: number) => ((z - Z0) / (Z1 - Z0)) * W;
  // v = t/2π from the belly; flipY puts v = 0 at the canvas bottom.
  const Y = (t: number) => (1 - t / (Math.PI * 2)) * H;
  const T = Math.PI;

  // Base: light grey, a darker belly, a dark blue cheatline and a thin pinstripe.
  g.fillStyle = '#d5d9df';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#9aa1ab';
  g.fillRect(0, Y(0.26 * T), W, Y(-0.26 * T) - Y(0.26 * T));
  g.fillRect(0, Y(2 * T), W, Y(1.74 * T) - Y(2 * T));
  for (const [t0, t1, color] of [
    [0.36, 0.42, '#1d2b4a'],
    [0.43, 0.445, '#ff5fd6'],
    [1.555, 1.57, '#ff5fd6'],
    [1.58, 1.64, '#1d2b4a'],
  ] as const) {
    g.fillStyle = color;
    g.fillRect(X(-13.2), Y(t1 * T), X(12.5) - X(-13.2), Y(t0 * T) - Y(t1 * T));
  }
  rg.fillStyle = '#7f7f7f';
  rg.fillRect(0, 0, W, H);

  // Anti-glare panel ahead of the windshield.
  g.fillStyle = '#20252d';
  g.beginPath();
  g.ellipse(X(-13.8), Y(T), X(-13.05) - X(-13.8), Y(0.72 * T) - Y(T), 0, 0, Math.PI * 2);
  g.fill();

  // Windows: dark, glossy glass (low roughness), from the shared layout.
  for (const w of [...WINDOWS, ...CABIN_WINDOWS]) {
    for (const [ctx, color] of [[g, '#0b1016'], [rg, '#101010']] as const) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.roundRect(X(w.z0), Y(w.t1 * T), X(w.z1) - X(w.z0), Y(w.t0 * T) - Y(w.t1 * T), w.radius);
      ctx.fill();
    }
  }

  // Panel lines: crew door (left, forward), the ramp and cargo door aft, access panels.
  g.strokeStyle = 'rgba(40, 46, 56, 0.55)';
  g.lineWidth = 2;
  g.strokeRect(X(-10.25), Y(1.68 * T), X(-9.3) - X(-10.25), Y(1.45 * T) - Y(1.68 * T));
  g.strokeRect(X(6.4), Y(0.18 * T), X(12.2) - X(6.4), Y(-0.18 * T) - Y(0.18 * T));
  g.strokeRect(X(6.4), Y(2 * T), X(12.2) - X(6.4), Y(1.82 * T) - Y(2 * T));
  for (const z of [-7, -2, 3]) {
    g.beginPath();
    g.moveTo(X(z), Y(0.2 * T));
    g.lineTo(X(z), Y(0.33 * T));
    g.stroke();
  }

  // Titles along the upper fuselage: the site's concept, and a fictional registration.
  g.fillStyle = '#1d2b4a';
  g.font = '700 30px "B612", system-ui, sans-serif';
  g.textBaseline = 'middle';
  g.textAlign = 'center';
  // Seen from outside, the right side runs tail → nose left to right (mirror the text),
  // and the left side runs top → bottom down the canvas (flip it).
  const title = (text: string, z: number, t: number, side: 'right' | 'left') => {
    g.save();
    g.translate(X(z), Y(t * T));
    if (side === 'right') g.scale(-1, 1);
    else g.scale(1, -1);
    g.fillText(text, 0, 0);
    g.restore();
  };
  title('FLIGHT TEST', -5.0, 0.68, 'right');
  title('FLIGHT TEST', -5.0, 1.32, 'left');
  g.font = '700 22px "B612 Mono", monospace';
  title('JW-001', 9.6, 0.56, 'right');
  title('JW-001', 9.6, 1.44, 'left');

  const map = new CanvasTexture(c);
  map.colorSpace = SRGBColorSpace;
  map.anisotropy = 8;
  const rough = new CanvasTexture(r);
  return { map, rough };
}

// ---------------------------------------------------------------------------
// Lifting surfaces: airfoil sections lofted along the span

/** NACA 4-digit camber line and thickness at chord fraction x. */
function naca(x: number, thickness: number, camber: number, camberPos = 0.4): { yc: number; yt: number; theta: number } {
  const yt = 5 * thickness * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
  const p = camberPos;
  const yc = x < p ? (camber / (p * p)) * (2 * p * x - x * x) : (camber / ((1 - p) * (1 - p))) * (1 - 2 * p + 2 * p * x - x * x);
  const dyc = x < p ? ((2 * camber) / (p * p)) * (p - x) : ((2 * camber) / ((1 - p) * (1 - p))) * (p - x);
  return { yc, yt, theta: Math.atan(dyc) };
}

interface Section {
  /** Leading edge position [m]. */
  le: Vector3;
  chord: number;
  /** Thickness ratio and camber (fractions of chord); twist [rad, + nose up]. */
  thickness: number;
  camber: number;
  twist: number;
}

/**
 * A closed loft of the airfoil between chord fractions [x0, x1] (0 = LE, 1 = TE), so the
 * same sections can make a wing box and the control surfaces behind it. `vertical`
 * builds a fin (span along +y, thickness along x).
 */
function loft(sections: Section[], x0: number, x1: number, vertical = false, samples = 14, boots = 0): BufferGeometry {
  const xs: number[] = [];
  for (let i = 0; i <= samples; i++) {
    const s = i / samples;
    // Cosine spacing: dense at the leading edge.
    xs.push(x0 + (x1 - x0) * (x0 === 0 ? 0.5 - 0.5 * Math.cos(Math.PI * s) : s));
  }
  // Loop: upper surface TE→LE, then lower surface LE→TE.
  const loop: { x: number; upper: boolean }[] = [...xs.slice().reverse().map((x) => ({ x, upper: true })), ...xs.slice(x0 === 0 ? 1 : 0).map((x) => ({ x, upper: false }))];
  const m = loop.length;
  const pos: number[] = [];
  const col: number[] = [];
  const p = new Vector3();
  for (const s of sections) {
    const ct = Math.cos(s.twist);
    const stw = Math.sin(s.twist);
    for (const pt of loop) {
      const { yc, yt, theta } = naca(Math.max(pt.x, 1e-4), s.thickness, s.camber);
      const sign = pt.upper ? 1 : -1;
      const xc = pt.x - sign * yt * Math.sin(theta);
      const yv = yc + sign * yt * Math.cos(theta);
      // Chord along +z (aft), thickness along +y (or +x for a fin); twist about the span.
      const along = xc * s.chord;
      const across = yv * s.chord;
      const za = along * ct + across * stw;
      const ya = -along * stw + across * ct;
      if (vertical) p.set(s.le.x + ya, s.le.y, s.le.z + za);
      else p.set(s.le.x, s.le.y + ya, s.le.z + za);
      pos.push(p.x, p.y, p.z);
      // De-icing boots: dark along the first few percent of the leading edge.
      const dark = boots > 0 && pt.x < boots;
      col.push(dark ? 0.22 : 1, dark ? 0.23 : 1, dark ? 0.26 : 1);
    }
  }
  const index: number[] = [];
  const n = sections.length;
  for (let k = 0; k + 1 < n; k++) {
    for (let j = 0; j + 1 < m; j++) {
      const a = k * m + j;
      const b = a + m;
      index.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  // Close the trailing (or hinge) face and both ends with fans, flat-shaded.
  const g0 = new BufferGeometry();
  g0.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g0.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
  g0.setIndex(index);
  g0.computeVertexNormals();
  const caps: BufferGeometry[] = [g0.toNonIndexed()];
  const capTris: number[] = [];
  const at = (k: number, j: number) => [pos[(k * m + j) * 3]!, pos[(k * m + j) * 3 + 1]!, pos[(k * m + j) * 3 + 2]!];
  for (const k of [0, n - 1]) {
    for (let j = 1; j + 1 < m; j++) capTris.push(...at(k, 0), ...at(k, j), ...at(k, j + 1));
  }
  for (let k = 0; k + 1 < n; k++) capTris.push(...at(k, m - 1), ...at(k + 1, m - 1), ...at(k, 0), ...at(k, 0), ...at(k + 1, m - 1), ...at(k + 1, 0));
  const cap = new BufferGeometry();
  cap.setAttribute('position', new BufferAttribute(new Float32Array(capTris), 3));
  cap.setAttribute('color', new BufferAttribute(new Float32Array(capTris.length).fill(1), 3));
  cap.computeVertexNormals();
  caps.push(cap);
  const out = mergeGeometries(caps)!;
  for (const c of caps) c.dispose();
  g0.dispose();
  return out;
}

/** Mirror a geometry across the YZ plane (left ↔ right), keeping faces outward. */
function mirrored(g: BufferGeometry): BufferGeometry {
  const m = g.clone();
  m.scale(-1, 1, 1);
  const idx = m.getIndex();
  if (idx) {
    for (let i = 0; i < idx.count; i += 3) {
      const b = idx.getX(i + 1);
      idx.setX(i + 1, idx.getX(i + 2));
      idx.setX(i + 2, b);
    }
  } else {
    for (const name of Object.keys(m.attributes)) {
      const a = m.getAttribute(name) as BufferAttribute;
      for (let i = 0; i < a.count; i += 3) {
        for (let c = 0; c < a.itemSize; c++) {
          const t = a.getComponent(i + 1, c);
          a.setComponent(i + 1, c, a.getComponent(i + 2, c));
          a.setComponent(i + 2, c, t);
        }
      }
    }
  }
  m.computeVertexNormals();
  return m;
}

/** Sections of a straight-tapered panel between root and tip. */
function taper(root: Section, tip: Section, count: number): Section[] {
  return Array.from({ length: count }, (_, i) => {
    const t = i / (count - 1);
    return {
      le: root.le.clone().lerp(tip.le, t),
      chord: root.chord + (tip.chord - root.chord) * t,
      thickness: root.thickness + (tip.thickness - root.thickness) * t,
      camber: root.camber + (tip.camber - root.camber) * t,
      twist: root.twist + (tip.twist - root.twist) * t,
    };
  });
}

/** A sub-span of a panel's sections, from span fraction s0 to s1. */
function span(root: Section, tip: Section, s0: number, s1: number, count = 3): Section[] {
  const at = (t: number): Section => ({
    le: root.le.clone().lerp(tip.le, t),
    chord: root.chord + (tip.chord - root.chord) * t,
    thickness: root.thickness + (tip.thickness - root.thickness) * t,
    camber: root.camber + (tip.camber - root.camber) * t,
    twist: root.twist + (tip.twist - root.twist) * t,
  });
  return Array.from({ length: count }, (_, i) => at(s0 + ((s1 - s0) * i) / (count - 1)));
}

/** A control surface: the panel's chord from `hinge` back, pivoting on its hinge line. */
function surface(root: Section, tip: Section, s0: number, s1: number, hinge: number, vertical = false) {
  const secs = span(root, tip, s0, s1, 3);
  const geo = loft(secs, hinge, 1, vertical, 6);
  // Hinge axis through the hinge points at both ends of the surface.
  const hp = (s: Section) => {
    const { yc } = naca(hinge, s.thickness, s.camber);
    const along = hinge * s.chord;
    const across = yc * s.chord;
    const z = along * Math.cos(s.twist) + across * Math.sin(s.twist);
    const y = -along * Math.sin(s.twist) + across * Math.cos(s.twist);
    return vertical ? new Vector3(s.le.x + y, s.le.y, s.le.z + z) : new Vector3(s.le.x, s.le.y + y, s.le.z + z);
  };
  const a = hp(secs[0]!);
  const b = hp(secs[secs.length - 1]!);
  geo.translate(-a.x, -a.y, -a.z);
  return { geo, pivot: a, axis: b.sub(a).normalize() };
}

// ---------------------------------------------------------------------------

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

/** A soft disc with six faint blade streaks: reads as a spinning six-blade propeller. */
function propTexture(): Texture {
  const s = 256;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d')!;
  ctx.translate(s / 2, s / 2);
  for (let i = 0; i < 6; i++) {
    ctx.rotate(Math.PI / 3);
    const grad = ctx.createLinearGradient(0, -s / 2, 0, 0);
    grad.addColorStop(0, 'rgba(210,218,230,0.06)');
    grad.addColorStop(0.5, 'rgba(210,218,230,0.2)');
    grad.addColorStop(1, 'rgba(210,218,230,0.32)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    // A scimitar-ish blade: wider at mid-span, swept toward the tip.
    ctx.moveTo(-6, -10);
    ctx.quadraticCurveTo(-16, -s / 4, -4, -s / 2 + 6);
    ctx.lineTo(8, -s / 2 + 10);
    ctx.quadraticCurveTo(14, -s / 4, 6, -10);
    ctx.fill();
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const halo = ctx.createRadialGradient(s / 2, s / 2, 8, s / 2, s / 2, s / 2);
  halo.addColorStop(0, 'rgba(210,220,235,0.16)');
  halo.addColorStop(0.9, 'rgba(210,220,235,0.07)');
  halo.addColorStop(0.97, 'rgba(255,240,210,0.18)');
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
  pattern: 'beacon' | 'strobe' | 'landing' | null;
  base: number;
}

interface Hinged {
  obj: Object3D;
  axis: Vector3;
  /** Deflection at full command [rad]. */
  travel: number;
  kind: 'flap' | 'aileronL' | 'aileronR' | 'elevator' | 'rudder';
  /** Mirrored (left-side) copy: a reflection reverses the sense of its rotation. */
  mirror: boolean;
}

const DEG = Math.PI / 180;
const WING_ROOT_Y = 2.2;

export function createAircraft() {
  const group = new Group();
  const disposables: { dispose(): void }[] = [];
  const track = <T extends { dispose(): void }>(x: T) => (disposables.push(x), x);

  const livery = liveryTextures();
  track(livery.map);
  track(livery.rough);
  const skin = track(new MeshStandardMaterial({ map: livery.map, roughnessMap: livery.rough, roughness: 1, metalness: 0.22, envMapIntensity: 0.9 }));
  // Double-sided: the procedural panels don't all wind the same way, and three.js flips
  // the normal for back faces, so the lighting is right either way.
  const paint = track(
    new MeshStandardMaterial({ color: new Color('#d5d9df'), roughness: 0.48, metalness: 0.22, vertexColors: true, envMapIntensity: 0.9, side: DoubleSide }),
  );
  const dark = track(new MeshStandardMaterial({ color: new Color('#262c36'), roughness: 0.55, metalness: 0.35 }));
  const rubber = track(new MeshStandardMaterial({ color: new Color('#15171b'), roughness: 0.85, metalness: 0 }));
  const metal = track(new MeshStandardMaterial({ color: new Color('#8d949e'), roughness: 0.3, metalness: 0.8 }));

  const fuselage = new Mesh(track(fuselageGeometry()), skin);
  group.add(fuselage);

  // ---- Wing: high-mounted, slight dihedral, tapered, with washout toward the tip.
  const wingRoot: Section = { le: new Vector3(0, WING_ROOT_Y, -1.7), chord: 4.6, thickness: 0.17, camber: 0.022, twist: 2 * DEG };
  const wingTip: Section = { le: new Vector3(20, WING_ROOT_Y + 0.55, -0.35), chord: 2.25, thickness: 0.12, camber: 0.015, twist: -1 * DEG };
  const FLAP_HINGE = 0.72;
  const wingBox = loft(taper(wingRoot, wingTip, 10), 0, FLAP_HINGE, false, 14, 0.06);
  // Fixed trailing edge where there's no moving surface (the very root and the tip).
  const rootTE = loft(span(wingRoot, wingTip, 0, 0.11, 2), FLAP_HINGE, 1, false, 4);
  const tipTE = loft(span(wingRoot, wingTip, 0.93, 1, 2), FLAP_HINGE, 1, false, 4);

  // Horizontal tail and fin, with elevators and rudder.
  const tpRoot: Section = { le: new Vector3(0, 1.95, 11.5), chord: 3.5, thickness: 0.11, camber: 0, twist: 0 };
  const tpTip: Section = { le: new Vector3(7.9, 2.05, 13.4), chord: 1.6, thickness: 0.09, camber: 0, twist: 0 };
  const ELEV_HINGE = 0.66;
  const tailplane = loft(taper(tpRoot, tpTip, 5), 0, ELEV_HINGE, false, 12, 0.07);
  const finRoot: Section = { le: new Vector3(0, 2.1, 9.2), chord: 5.8, thickness: 0.12, camber: 0, twist: 0 };
  const finTip: Section = { le: new Vector3(0, 9.7, 12.7), chord: 2.6, thickness: 0.09, camber: 0, twist: 0 };
  const RUDDER_HINGE = 0.68;
  const fin = loft(taper(finRoot, finTip, 6), 0, RUDDER_HINGE, true, 12, 0.07);

  // Sponsons: the fairings either side of the lower fuselage that house the main gear.
  const sponson = new LatheGeometry(
    [[0.01, -4.8], [0.38, -4.6], [0.62, -4.0], [0.74, -3.0], [0.76, 0], [0.75, 2.6], [0.6, 3.8], [0.32, 4.5], [0.01, 4.75]].map(
      ([r, y]) => new Vector2(r!, y!),
    ),
    20,
  );
  sponson.rotateX(Math.PI / 2);
  sponson.scale(1, 1.15, 1);
  const sponsonR = sponson.clone();
  sponsonR.translate(2.02, -1.62, -0.2);
  const sponsonL = sponson.clone();
  sponsonL.translate(-2.02, -1.62, -0.2);
  sponson.dispose();

  // Nacelles: a turboprop's long nacelle, deepest at the intake below the spinner.
  const nacelleProfile = [[0.02, -4.9], [0.42, -4.75], [0.66, -4.3], [0.78, -3.4], [0.8, -1.5], [0.74, 1.0], [0.55, 3.0], [0.3, 4.1], [0.02, 4.45]];
  const nacelle = new LatheGeometry(nacelleProfile.map(([r, y]) => new Vector2(r!, y!)), 20);
  nacelle.rotateX(Math.PI / 2);
  nacelle.scale(1, 1.25, 1);
  const intake = new CylinderGeometry(0.34, 0.4, 1.3, 14, 1, false);
  intake.rotateX(Math.PI / 2);
  intake.scale(1.3, 0.7, 1);
  intake.translate(0, -0.72, -3.6);
  const exhaust = new CylinderGeometry(0.17, 0.2, 0.9, 10, 1, true);
  exhaust.rotateZ(Math.PI / 2);
  exhaust.translate(0.72, 0.15, -1.2);
  const engines = [-11.3, -5.7, 5.7, 11.3];
  const nacelles: BufferGeometry[] = [];
  const darkParts: BufferGeometry[] = [];
  for (const x of engines) {
    const y = WING_ROOT_Y + (Math.abs(x) / 20) * 0.55 - 0.62;
    const n = nacelle.clone();
    n.translate(x, y, -2.1);
    nacelles.push(n);
    const i = intake.clone();
    i.translate(x, y, -2.1);
    darkParts.push(i);
    const e = exhaust.clone();
    if (x < 0) e.scale(-1, 1, 1);
    e.translate(x, y, -2.1);
    darkParts.push(e);
  }
  nacelle.dispose();
  intake.dispose();
  exhaust.dispose();

  // Merge the painted airframe into one draw call.
  const withColor = (g: BufferGeometry) => {
    const ng = g.index ? g.toNonIndexed() : g;
    if (!ng.getAttribute('color')) ng.setAttribute('color', new BufferAttribute(new Float32Array(ng.getAttribute('position').count * 3).fill(1), 3));
    if (ng.getAttribute('uv')) ng.deleteAttribute('uv');
    return ng;
  };
  const parts = [wingBox, mirrored(wingBox), rootTE, mirrored(rootTE), tipTE, mirrored(tipTE), tailplane, mirrored(tailplane), fin, sponsonR, sponsonL, ...nacelles].map(withColor);
  const airframe = new Mesh(track(mergeGeometries(parts)!), paint);
  group.add(airframe);
  const darkGeo = track(mergeGeometries(darkParts.map((g) => g.toNonIndexed()))!);
  group.add(new Mesh(darkGeo, dark));

  // ---- Moving surfaces
  const hinged: Hinged[] = [];
  const hingedMesh = (s: ReturnType<typeof surface>, mirror: boolean, travel: number, kind: Hinged['kind']) => {
    const geo = track(mirror ? mirrored(s.geo) : s.geo);
    const pivot = new Group();
    pivot.position.set(mirror ? -s.pivot.x : s.pivot.x, s.pivot.y, s.pivot.z);
    const axis = s.axis.clone();
    if (mirror) axis.x = -axis.x;
    const mesh = new Mesh(geo, paint);
    pivot.add(mesh);
    group.add(pivot);
    hinged.push({ obj: pivot, axis, travel, kind, mirror });
  };
  // Flaps (inboard and outboard of the inner nacelle), ailerons outboard.
  for (const [s0, s1] of [[0.11, 0.48], [0.48, 0.7]] as const) {
    const s = surface(wingRoot, wingTip, s0, s1, FLAP_HINGE);
    hingedMesh(s, false, 34 * DEG, 'flap');
    hingedMesh(surface(wingRoot, wingTip, s0, s1, FLAP_HINGE), true, 34 * DEG, 'flap');
  }
  hingedMesh(surface(wingRoot, wingTip, 0.7, 0.93, FLAP_HINGE), false, 18 * DEG, 'aileronR');
  hingedMesh(surface(wingRoot, wingTip, 0.7, 0.93, FLAP_HINGE), true, 18 * DEG, 'aileronL');
  hingedMesh(surface(tpRoot, tpTip, 0.06, 1, ELEV_HINGE), false, 14 * DEG, 'elevator');
  hingedMesh(surface(tpRoot, tpTip, 0.06, 1, ELEV_HINGE), true, 14 * DEG, 'elevator');
  hingedMesh(surface(finRoot, finTip, 0.04, 0.97, RUDDER_HINGE, true), false, 20 * DEG, 'rudder');

  // ---- Propellers: spinner and a blurred six-blade disc on each engine.
  const props: Mesh[] = [];
  const propMat = track(new MeshBasicMaterial({ map: track(propTexture()), transparent: true, depthWrite: false, side: DoubleSide, opacity: 0.9 }));
  const spinnerGeo = track(new SphereGeometry(0.46, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2));
  spinnerGeo.rotateX(-Math.PI / 2);
  spinnerGeo.scale(1, 1, 2.1);
  const discGeo = track(new CircleGeometry(2.05, 40));
  for (const x of engines) {
    const y = WING_ROOT_Y + (Math.abs(x) / 20) * 0.55 - 0.62;
    const spinner = new Mesh(spinnerGeo, metal);
    spinner.position.set(x, y, -6.95);
    group.add(spinner);
    const disc = new Mesh(discGeo, propMat);
    disc.position.set(x, y, -6.85);
    disc.renderOrder = 2;
    group.add(disc);
    props.push(disc);
  }

  // ---- Landing gear: tandem main wheels that retract up into the sponsons; a twin nose gear.
  const wheelMain = track(new CylinderGeometry(0.62, 0.62, 0.42, 22));
  wheelMain.rotateZ(Math.PI / 2);
  const wheelNose = track(new CylinderGeometry(0.44, 0.44, 0.3, 18));
  wheelNose.rotateZ(Math.PI / 2);
  const strutGeo = track(new CylinderGeometry(0.09, 0.09, 1, 8));
  const mainGear = new Group();
  for (const side of [-1, 1]) {
    for (const z of [-1.45, 1.35]) {
      const w = new Mesh(wheelMain, rubber);
      w.position.set(side * 2.12, 0, z);
      mainGear.add(w);
      const s = new Mesh(strutGeo, metal);
      s.scale.set(1, 1.1, 1);
      s.position.set(side * 2.12, 0.55, z);
      mainGear.add(s);
    }
  }
  group.add(mainGear);
  const noseGear = new Group();
  for (const side of [-1, 1]) {
    const w = new Mesh(wheelNose, rubber);
    w.position.set(side * 0.3, 0, 0);
    noseGear.add(w);
  }
  const noseStrut = new Mesh(strutGeo, metal);
  noseStrut.scale.set(1.4, 1.2, 1.4);
  noseStrut.position.set(0, 0.62, 0);
  noseGear.add(noseStrut);
  group.add(noseGear);
  // Down: wheels on the ground 3.2 m below the CG. Up: inside the sponsons and the nose.
  const MAIN_DOWN = -3.2 + 0.62;
  const MAIN_UP = -1.62;
  const NOSE_DOWN = -3.2 + 0.44;
  const NOSE_UP = -1.55;

  // ---- Lights: navigation, anti-collision beacons, wingtip strobes, landing lights.
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
  const tipY = WING_ROOT_Y + 0.55;
  light(new Vector3(-20.15, tipY, 0.3), '#ff3b30', 2.2, null); // port: red
  light(new Vector3(20.15, tipY, 0.3), '#34ff6a', 2.2, null); // starboard: green
  light(new Vector3(0, 1.98, 15.7), '#ffffff', 1.6, null); // tail: white
  light(new Vector3(0, 9.85, 13.6), '#ff2a1a', 2.6, 'beacon');
  light(new Vector3(0, -2.4, 0.6), '#ff2a1a', 2.6, 'beacon');
  light(new Vector3(-20.15, tipY, 0.7), '#f4f7ff', 3.2, 'strobe');
  light(new Vector3(20.15, tipY, 0.7), '#f4f7ff', 3.2, 'strobe');
  light(new Vector3(-3.4, WING_ROOT_Y + 0.05, -1.95), '#fff4dc', 4.5, 'landing');
  light(new Vector3(3.4, WING_ROOT_Y + 0.05, -1.95), '#fff4dc', 4.5, 'landing');

  let propAngle = 0;

  return {
    group,
    /** Pose and animate the model from the (interpolated) simulation state. */
    update(pose: RenderState, body: Quaternion, time: number, dt: number) {
      group.position.set(pose.x, pose.y, pose.z);
      group.quaternion.copy(body);

      // Moving surfaces follow the simulation's flap position and control activity.
      // d = trailing edge down; rolling right raises the right aileron, pitching up the elevators.
      for (const h of hinged) {
        let d = 0;
        if (h.kind === 'flap') d = pose.flaps * h.travel;
        else if (h.kind === 'aileronR') d = -pose.aileron * h.travel;
        else if (h.kind === 'aileronL') d = pose.aileron * h.travel;
        else if (h.kind === 'elevator') d = -pose.elevator * h.travel;
        h.obj.quaternion.setFromAxisAngle(h.axis, h.mirror ? -d : d);
      }

      // Gear: a little faster than linear at the ends, like a hydraulic cycle.
      const g = pose.gear * pose.gear * (3 - 2 * pose.gear);
      mainGear.position.y = MAIN_UP + (MAIN_DOWN - MAIN_UP) * g;
      mainGear.visible = pose.gear > 0.02;
      noseGear.position.set(0, NOSE_UP + (NOSE_DOWN - NOSE_UP) * g, -11.0 - (1 - g) * 0.6);
      noseGear.rotation.x = (1 - g) * -1.2;
      noseGear.visible = pose.gear > 0.02;

      // Props: fast enough to blur, slower with less power. (Spun on the disc's own axis.)
      propAngle += dt * (12 + 10 * Math.abs(pose.thrust));
      for (let i = 0; i < props.length; i++) props[i]!.rotation.z = propAngle * (i % 2 ? 1 : -1);

      for (const l of nav) {
        if (!l.pattern) continue;
        if (l.pattern === 'landing') {
          l.sprite.visible = pose.landingLights;
          continue;
        }
        let on: boolean;
        if (l.pattern === 'beacon') {
          on = (time * 1.1) % 1 < 0.12;
        } else {
          // Double flash every 1.3 s.
          const ph = time % 1.3;
          on = ph < 0.05 || (ph > 0.16 && ph < 0.21);
        }
        l.sprite.visible = on;
        l.sprite.scale.setScalar(l.base * (l.pattern === 'strobe' ? 2.4 : 1.4));
      }
    },
    dispose() {
      for (const d of disposables) d.dispose();
      for (const p of parts) p.dispose();
    },
  };
}
