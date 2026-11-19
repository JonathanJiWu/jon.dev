import { CanvasTexture, SRGBColorSpace } from 'three';
import { type FlightData, formatClock, formatDuration, formatHeading } from '../../sim/flightData';
import { toMagnetic } from '../../sim/navdata';
import type { FlightSimulation } from '../../sim/simulation';
import { terrainHeight } from '../../world/terrain';

/**
 * The glass cockpit's displays, drawn with Canvas 2D into textures. Each reads only the
 * frame's FlightData (and the plan it points to), so every display agrees with every
 * other one and with the page. The symbology follows common airliner conventions
 * (white for current values, magenta for targets and the active route, green for engaged
 * modes, cyan for labels, amber for cautions) but is a generic design, not any
 * manufacturer's: these are simulated instruments.
 */

export const C = {
  bg: '#04060a',
  white: '#f2f4f7',
  green: '#3ee07f',
  cyan: '#4fd3ff',
  magenta: '#ff5fd6',
  amber: '#ffb020',
  red: '#ff3b30',
  grey: '#8a94a2',
  dim: '#3a434f',
  sky: '#2a64b0',
  ground: '#6f4b2a',
  panel: '#1a1f27',
};
export const FONT = '"B612 Mono", ui-monospace, Menlo, monospace';
const DEG = Math.PI / 180;
const NM = 1852;
const FT = 0.3048;

/** A rectangular hit area in canvas pixels, and what pressing it does. */
export interface Key {
  x: number;
  y: number;
  w: number;
  h: number;
  id: string;
}

export abstract class Display {
  readonly canvas: HTMLCanvasElement;
  protected readonly g: CanvasRenderingContext2D;
  readonly texture: CanvasTexture;
  keys: Key[] = [];
  /** Minimum time between redraws [ms]. */
  abstract readonly interval: number;
  private last = -Infinity;

  constructor(
    readonly id: string,
    readonly width: number,
    readonly height: number,
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    this.g = this.canvas.getContext('2d')!;
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.anisotropy = 4;
  }

  /** Redraw if it's time. */
  update(d: FlightData, sim: FlightSimulation, now: number): void {
    if (now - this.last < this.interval) return;
    this.last = now;
    this.draw(d, sim);
    this.texture.needsUpdate = true;
  }

  /** Force a redraw on the next update (after a key press). */
  invalidate(): void {
    this.last = -Infinity;
  }

  protected abstract draw(d: FlightData, sim: FlightSimulation): void;

  /** A press at canvas coordinates: returns the key's id if one was hit. */
  press(x: number, y: number): string | null {
    const k = this.keys.find((k) => x >= k.x && x <= k.x + k.w && y >= k.y && y <= k.y + k.h);
    return k ? k.id : null;
  }

  protected text(s: string, x: number, y: number, color: string, size = 20, align: CanvasTextAlign = 'left', weight = 400): void {
    const g = this.g;
    g.fillStyle = color;
    g.font = `${weight} ${size}px ${FONT}`;
    g.textAlign = align;
    g.textBaseline = 'middle';
    g.fillText(s, x, y);
  }

  protected clear(): void {
    this.g.fillStyle = C.bg;
    this.g.fillRect(0, 0, this.width, this.height);
  }

  dispose(): void {
    this.texture.dispose();
  }
}

// ---------------------------------------------------------------------------
// Primary flight display

export class Pfd extends Display {
  readonly interval = 33;

  constructor() {
    super('pfd', 512, 512);
  }

  protected draw(d: FlightData): void {
    const g = this.g;
    this.clear();
    const cx = 256;
    const cy = 222;
    const K = 7; // px per degree of pitch

    // ---- Attitude
    g.save();
    g.beginPath();
    g.roundRect(150, 92, 212, 262, 18);
    g.clip();
    g.translate(cx, cy);
    g.rotate(-d.bank * DEG);
    g.translate(0, d.pitch * K);
    g.fillStyle = C.sky;
    g.fillRect(-400, -1200, 800, 1200);
    g.fillStyle = C.ground;
    g.fillRect(-400, 0, 800, 1200);
    g.strokeStyle = C.white;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(-400, 0);
    g.lineTo(400, 0);
    g.stroke();
    // Pitch ladder
    g.lineWidth = 2;
    for (let p = -30; p <= 30; p += 2.5) {
      if (p === 0) continue;
      const y = -p * K;
      const major = p % 10 === 0;
      const half = major ? 46 : p % 5 === 0 ? 26 : 12;
      g.beginPath();
      g.moveTo(-half, y);
      g.lineTo(half, y);
      g.stroke();
      if (major) {
        this.text(String(Math.abs(p)), -half - 18, y, C.white, 16, 'center');
        this.text(String(Math.abs(p)), half + 18, y, C.white, 16, 'center');
      }
    }
    g.restore();

    // Bank scale (fixed) and pointer (moves with the bank)
    g.save();
    g.translate(cx, cy);
    g.strokeStyle = C.white;
    g.lineWidth = 2;
    g.beginPath();
    g.arc(0, 0, 118, -Math.PI / 2 - 60 * DEG, -Math.PI / 2 + 60 * DEG);
    g.stroke();
    for (const a of [-60, -45, -30, -20, -10, 10, 20, 30, 45, 60]) {
      const r0 = 118;
      const r1 = Math.abs(a) % 30 === 0 ? 132 : 126;
      const t = -Math.PI / 2 + a * DEG;
      g.beginPath();
      g.moveTo(Math.cos(t) * r0, Math.sin(t) * r0);
      g.lineTo(Math.cos(t) * r1, Math.sin(t) * r1);
      g.stroke();
    }
    g.fillStyle = C.white;
    g.beginPath();
    g.moveTo(0, -120);
    g.lineTo(-8, -134);
    g.lineTo(8, -134);
    g.closePath();
    g.fill();
    g.rotate(-d.bank * DEG);
    g.beginPath();
    g.moveTo(0, -116);
    g.lineTo(-9, -100);
    g.lineTo(9, -100);
    g.closePath();
    g.fillStyle = Math.abs(d.bank) > 35 ? C.amber : C.white;
    g.fill();
    g.restore();

    // Flight director (magenta), then the fixed aircraft symbol on top.
    if (!d.onGround || d.phase === 'takeoff') {
      g.strokeStyle = C.magenta;
      g.lineWidth = 3;
      const dy = Math.max(-90, Math.min(90, -(d.fdPitch - d.pitch) * K));
      const dx = Math.max(-70, Math.min(70, (d.fdBank - d.bank) * 2.2));
      g.beginPath();
      g.moveTo(cx - 70, cy + dy);
      g.lineTo(cx + 70, cy + dy);
      g.moveTo(cx + dx, cy - 70);
      g.lineTo(cx + dx, cy + 70);
      g.stroke();
    }
    g.fillStyle = '#000';
    g.strokeStyle = C.white;
    g.lineWidth = 2;
    for (const s of [-1, 1]) {
      g.beginPath();
      g.moveTo(cx + s * 30, cy - 4);
      g.lineTo(cx + s * 78, cy - 4);
      g.lineTo(cx + s * 78, cy + 4);
      g.lineTo(cx + s * 40, cy + 4);
      g.lineTo(cx + s * 40, cy + 16);
      g.lineTo(cx + s * 30, cy + 16);
      g.closePath();
      g.fill();
      g.stroke();
    }
    g.fillRect(cx - 5, cy - 5, 10, 10);
    g.strokeRect(cx - 5, cy - 5, 10, 10);

    // Radio altitude, low down
    if (d.radioAltitude < 2500) this.text(String(Math.round(d.radioAltitude / 10) * 10), cx, 330, C.green, 24, 'center', 700);

    // Approach deviations on the final: glide path (right) and final approach course (below).
    if (d.verticalDots !== null || d.lateralDots !== null) {
      g.strokeStyle = C.white;
      g.lineWidth = 2;
      for (let k = -2; k <= 2; k++) {
        if (k === 0) continue;
        g.beginPath();
        g.arc(372, cy + k * 26, 4, 0, Math.PI * 2);
        g.stroke();
        g.beginPath();
        g.arc(cx + k * 30, 368, 4, 0, Math.PI * 2);
        g.stroke();
      }
      const diamond = (x: number, y: number) => {
        g.fillStyle = C.magenta;
        g.beginPath();
        g.moveTo(x, y - 9);
        g.lineTo(x + 7, y);
        g.lineTo(x, y + 9);
        g.lineTo(x - 7, y);
        g.closePath();
        g.fill();
      };
      if (d.verticalDots !== null) diamond(372, cy + d.verticalDots * 26);
      if (d.lateralDots !== null) diamond(cx - d.lateralDots * 30, 368);
    }

    this.speedTape(d, cy);
    this.altitudeTape(d, cy);
    this.vsi(d, cy);
    this.heading(d);

    // FMA
    g.fillStyle = '#000';
    g.fillRect(90, 0, 332, 44);
    g.strokeStyle = C.dim;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(200, 6);
    g.lineTo(200, 40);
    g.moveTo(312, 6);
    g.lineTo(312, 40);
    g.stroke();
    this.text(d.fma.thrust, 145, 22, C.green, 20, 'center', 700);
    this.text(d.fma.lateral, 256, 22, C.green, 20, 'center', 700);
    this.text(d.fma.vertical, 367, 22, C.green, 20, 'center', 700);
    if (d.fma.lateral) this.text('CMD', cx, 62, C.green, 18, 'center', 700);
  }

  private speedTape(d: FlightData, cy: number): void {
    const g = this.g;
    const x0 = 36;
    const x1 = 116;
    const PX = 3; // px per knot
    g.save();
    g.beginPath();
    g.rect(x0, 92, x1 - x0, 262);
    g.clip();
    g.fillStyle = '#2b323d';
    g.fillRect(x0, 92, x1 - x0, 262);
    const yOf = (kt: number) => cy - (kt - d.ias) * PX;
    // Overspeed (top) and stall-warning (bottom) red/black bands.
    const band = (from: number, to: number) => {
      const ya = yOf(to);
      const yb = yOf(from);
      for (let y = Math.max(ya, 80); y < Math.min(yb, 370); y += 12) {
        g.fillStyle = C.red;
        g.fillRect(x1 - 12, y, 8, 6);
      }
    };
    band(d.vmo, d.vmo + 200);
    band(0, d.vStall * 1.08);
    // Minimum manoeuvring speed: amber line.
    g.fillStyle = C.amber;
    g.fillRect(x1 - 4, yOf(d.vStall * 1.3), 3, (d.vStall * 0.22) * PX);
    g.strokeStyle = C.white;
    g.lineWidth = 2;
    const base = Math.floor((d.ias - 50) / 10) * 10;
    for (let kt = Math.max(base, 30); kt < d.ias + 50; kt += 10) {
      const y = yOf(kt);
      g.beginPath();
      g.moveTo(x1 - 14, y);
      g.lineTo(x1, y);
      g.stroke();
      if (kt % 20 === 0) this.text(String(kt), x1 - 20, y, C.white, 18, 'right');
    }
    // Reference-speed bugs (green), and the selected speed (magenta).
    const bug = (kt: number, label: string) => {
      const y = yOf(kt);
      g.strokeStyle = C.green;
      g.beginPath();
      g.moveTo(x1 - 8, y);
      g.lineTo(x1, y);
      g.stroke();
      this.text(label, x1 + 2, y, C.green, 14);
    };
    if (d.phase === 'takeoff' || (d.phase === 'climb' && d.radioAltitude < 1500)) {
      bug(d.vr, 'R');
      bug(d.v2, '2');
    }
    if (d.phase === 'approach' || d.phase === 'final' || d.phase === 'landing') bug(d.vref, 'REF');
    const ys = yOf(d.selectedSpeed);
    g.fillStyle = C.magenta;
    g.beginPath();
    g.moveTo(x1, ys - 9);
    g.lineTo(x1 - 9, ys - 9);
    g.lineTo(x1 - 9, ys - 4);
    g.lineTo(x1 - 4, ys);
    g.lineTo(x1 - 9, ys + 4);
    g.lineTo(x1 - 9, ys + 9);
    g.lineTo(x1, ys + 9);
    g.closePath();
    g.fill();
    g.restore();

    // Speed trend vector
    if (Math.abs(d.speedTrend) > 1.5) {
      g.strokeStyle = C.green;
      g.lineWidth = 2;
      const y = cy - Math.max(-130, Math.min(130, d.speedTrend * PX));
      g.beginPath();
      g.moveTo(x1 + 4, cy);
      g.lineTo(x1 + 4, y);
      g.stroke();
      g.beginPath();
      g.moveTo(x1 + 4, y);
      g.lineTo(x1, y + Math.sign(d.speedTrend) * 8);
      g.lineTo(x1 + 8, y + Math.sign(d.speedTrend) * 8);
      g.closePath();
      g.fillStyle = C.green;
      g.fill();
    }
    // Current speed box
    g.fillStyle = '#000';
    g.strokeStyle = C.white;
    g.lineWidth = 2;
    g.fillRect(x0 - 4, cy - 17, 84, 34);
    g.strokeRect(x0 - 4, cy - 17, 84, 34);
    this.text(String(Math.round(Math.max(d.ias, 30))).padStart(3, ' '), x0 + 38, cy + 1, C.white, 26, 'center', 700);
    g.fillStyle = '#000';
    g.fillRect(x0 - 4, 56, 84, 32);
    this.text(String(Math.round(d.selectedSpeed)), (x0 + x1) / 2, 72, C.magenta, 22, 'center');
    this.text(`GS ${Math.round(d.groundSpeed)}`, (x0 + x1) / 2 + 6, 374, C.white, 16, 'center');
  }

  private altitudeTape(d: FlightData, cy: number): void {
    const g = this.g;
    const x0 = 396;
    const x1 = 470;
    const PX = 0.34; // px per foot
    g.save();
    g.beginPath();
    g.rect(x0, 92, x1 - x0, 262);
    g.clip();
    g.fillStyle = '#2b323d';
    g.fillRect(x0, 92, x1 - x0, 262);
    const yOf = (ft: number) => cy - (ft - d.altitude) * PX;
    // The ground, from the radio altimeter: an amber band.
    const groundY = yOf(d.altitude - d.radioAltitude);
    if (groundY < 360) {
      g.fillStyle = 'rgba(255,176,32,0.35)';
      g.fillRect(x0, groundY, x1 - x0, 400);
    }
    g.strokeStyle = C.white;
    g.lineWidth = 2;
    const base = Math.floor((d.altitude - 500) / 100) * 100;
    for (let ft = base; ft < d.altitude + 500; ft += 100) {
      const y = yOf(ft);
      g.beginPath();
      g.moveTo(x0, y);
      g.lineTo(x0 + 12, y);
      g.stroke();
      if (ft % 200 === 0) this.text(String(ft), x0 + 16, y, C.white, 16);
    }
    // Selected altitude bug
    const ys = yOf(d.selectedAltitude);
    g.fillStyle = C.magenta;
    g.fillRect(x0, ys - 10, 8, 20);
    g.restore();
    // Current altitude box
    g.fillStyle = '#000';
    g.strokeStyle = C.white;
    g.lineWidth = 2;
    g.fillRect(x0 - 6, cy - 17, 86, 34);
    g.strokeRect(x0 - 6, cy - 17, 86, 34);
    this.text(String(Math.round(d.altitude / 10) * 10), x0 + 37, cy + 1, C.white, 22, 'center', 700);
    g.fillStyle = '#000';
    g.fillRect(x0 - 6, 56, 86, 32);
    this.text(String(Math.round(d.selectedAltitude / 100) * 100), (x0 + x1) / 2, 72, C.magenta, 22, 'center');
    this.text(`${d.altimeter.toFixed(2)} IN`, (x0 + x1) / 2, 374, C.green, 15, 'center');
  }

  private vsi(d: FlightData, cy: number): void {
    const g = this.g;
    const x = 482;
    const f = (vs: number) => {
      const a = Math.abs(vs);
      const v = a < 1000 ? (a / 1000) * 0.45 : a < 2000 ? 0.45 + ((a - 1000) / 1000) * 0.3 : 0.75 + Math.min((a - 2000) / 4000, 1) * 0.25;
      return Math.sign(vs) * v * 110;
    };
    g.fillStyle = '#2b323d';
    g.fillRect(x, cy - 120, 26, 240);
    g.strokeStyle = C.grey;
    g.lineWidth = 2;
    for (const v of [-6000, -2000, -1000, -500, 0, 500, 1000, 2000, 6000]) {
      const y = cy - f(v);
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + (v === 0 ? 14 : 8), y);
      g.stroke();
    }
    g.strokeStyle = C.white;
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(x + 26, cy);
    g.lineTo(x + 2, cy - f(d.verticalSpeed));
    g.stroke();
    if (Math.abs(d.verticalSpeed) > 400) {
      this.text(String(Math.round(d.verticalSpeed / 50) * 50), x + 13, d.verticalSpeed > 0 ? cy - 132 : cy + 132, C.white, 14, 'center');
    }
  }

  private heading(d: FlightData): void {
    const g = this.g;
    const cx = 256;
    const cy = 600;
    const R = 168;
    g.save();
    g.beginPath();
    g.rect(120, 396, 272, 116);
    g.clip();
    g.fillStyle = '#2b323d';
    g.beginPath();
    g.arc(cx, cy, R, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = C.white;
    g.lineWidth = 2;
    for (let h = 0; h < 360; h += 5) {
      const t = (h - d.heading) * DEG - Math.PI / 2;
      const long = h % 10 === 0;
      g.beginPath();
      g.moveTo(cx + Math.cos(t) * R, cy + Math.sin(t) * R);
      g.lineTo(cx + Math.cos(t) * (R - (long ? 14 : 8)), cy + Math.sin(t) * (R - (long ? 14 : 8)));
      g.stroke();
      if (h % 30 === 0) {
        this.text(String(h / 10), cx + Math.cos(t) * (R - 30), cy + Math.sin(t) * (R - 30), C.white, 17, 'center');
      }
    }
    // Desired track bug (magenta)
    const tb = (d.desiredTrack - d.heading) * DEG - Math.PI / 2;
    g.fillStyle = C.magenta;
    g.beginPath();
    g.arc(cx + Math.cos(tb) * (R + 2), cy + Math.sin(tb) * (R + 2), 7, 0, Math.PI * 2);
    g.fill();
    g.restore();
    g.fillStyle = '#000';
    g.strokeStyle = C.white;
    g.lineWidth = 2;
    g.fillRect(cx - 34, 404, 68, 30);
    g.strokeRect(cx - 34, 404, 68, 30);
    this.text(formatHeading(d.heading), cx, 420, C.white, 22, 'center', 700);
    this.text('MAG', cx + 62, 420, C.green, 14, 'center');
  }
}

// ---------------------------------------------------------------------------
// Navigation display (map mode, heading up)

const RANGES = [5, 10, 20, 40];

export class Nd extends Display {
  readonly interval = 66;
  rangeIndex = 2;

  constructor() {
    super('nd', 512, 512);
    this.keys = [
      { x: 404, y: 470, w: 50, h: 36, id: 'range-' },
      { x: 456, y: 470, w: 50, h: 36, id: 'range+' },
    ];
  }

  get range(): number {
    return RANGES[this.rangeIndex]!;
  }

  pressKey(id: string): void {
    if (id === 'range-') this.rangeIndex = Math.max(0, this.rangeIndex - 1);
    if (id === 'range+') this.rangeIndex = Math.min(RANGES.length - 1, this.rangeIndex + 1);
    this.invalidate();
  }

  protected draw(d: FlightData, sim: FlightSimulation): void {
    const g = this.g;
    this.clear();
    const cx = 256;
    const cy = 436;
    const R = 370;
    const scale = R / (this.range * NM);
    const hdg = d.headingTrue;
    const ax = sim.state[0]!;
    const az = sim.state[2]!;
    const P = (x: number, z: number): [number, number] => {
      const dx = x - ax;
      const dz = z - az;
      const fwd = dx * Math.sin(hdg) - dz * Math.cos(hdg);
      const right = dx * Math.cos(hdg) + dz * Math.sin(hdg);
      return [cx + right * scale, cy - fwd * scale];
    };

    g.save();
    g.beginPath();
    g.rect(0, 40, 512, 472);
    g.clip();

    // Compass arc, ticks and magnetic labels
    g.strokeStyle = C.white;
    g.lineWidth = 2;
    g.beginPath();
    g.arc(cx, cy, R, -Math.PI / 2 - 62 * DEG, -Math.PI / 2 + 62 * DEG);
    g.stroke();
    for (let h = 0; h < 360; h += 5) {
      const rel = ((h - d.heading + 540) % 360) - 180;
      if (Math.abs(rel) > 62) continue;
      const t = rel * DEG - Math.PI / 2;
      const len = h % 10 === 0 ? 16 : 8;
      g.beginPath();
      g.moveTo(cx + Math.cos(t) * R, cy + Math.sin(t) * R);
      g.lineTo(cx + Math.cos(t) * (R - len), cy + Math.sin(t) * (R - len));
      g.stroke();
      if (h % 30 === 0) this.text(String(h / 10), cx + Math.cos(t) * (R - 32), cy + Math.sin(t) * (R - 32), C.white, 17, 'center');
    }
    // Half-range ring
    g.setLineDash([6, 8]);
    g.strokeStyle = C.grey;
    g.beginPath();
    g.arc(cx, cy, R / 2, -Math.PI / 2 - 62 * DEG, -Math.PI / 2 + 62 * DEG);
    g.stroke();
    g.setLineDash([]);
    this.text(String(this.range / 2), cx - (R / 2) * Math.sin(55 * DEG) - 14, cy - (R / 2) * Math.cos(55 * DEG), C.grey, 14, 'center');

    // Airports and runways
    for (const a of sim.world.airports) {
      for (const r of a.runways) {
        const [x0, y0] = P(r.threshold.x, r.threshold.z);
        const [x1, y1] = P(r.end.x, r.end.z);
        g.strokeStyle = C.white;
        g.lineWidth = 3;
        g.beginPath();
        g.moveTo(x0, y0);
        g.lineTo(x1, y1);
        g.stroke();
      }
      const [x, y] = P(a.x, a.z);
      g.strokeStyle = C.cyan;
      g.lineWidth = 2;
      g.beginPath();
      g.arc(x, y, 10, 0, Math.PI * 2);
      g.stroke();
      this.text(a.ident, x + 14, y - 12, C.cyan, 15);
    }

    // The route ahead, the active leg in magenta, and the hold if one is flown.
    const plan = d.plan;
    const fms = sim.fms;
    const legs = plan.legs;
    g.lineWidth = 3;
    for (let i = fms.legIndex + 1; i < legs.length; i++) {
      const a = legs[i - 1]!;
      const b = legs[i]!;
      const [x0, y0] = P(a.x, a.z);
      const [x1, y1] = P(b.x, b.z);
      g.strokeStyle = C.white;
      g.beginPath();
      g.moveTo(x0, y0);
      g.lineTo(x1, y1);
      g.stroke();
    }
    const active = legs[fms.legIndex]!;
    if (!fms.hold && d.phase !== 'landing' && d.phase !== 'parked') {
      const [x0, y0] = P(fms.legStart.x, fms.legStart.z);
      const [x1, y1] = P(active.x, active.z);
      g.strokeStyle = C.magenta;
      g.beginPath();
      g.moveTo(x0, y0);
      g.lineTo(x1, y1);
      g.stroke();
    }
    if (fms.hold) {
      const [hx, hy] = P(fms.hold.fix.x, fms.hold.fix.z);
      g.strokeStyle = C.magenta;
      g.beginPath();
      g.arc(hx, hy, Math.max(fms.hold.radius, 1500) * scale, 0, Math.PI * 2);
      g.stroke();
    }
    for (let i = Math.max(fms.legIndex, 1); i < legs.length; i++) {
      const l = legs[i]!;
      if (l.type === 'RW' || l.type === 'TO') continue;
      const [x, y] = P(l.x, l.z);
      const color = i === fms.legIndex ? C.magenta : C.white;
      this.star(x, y, color);
      this.text(l.ident, x + 12, y - 10, color, 15);
      if (l.constraint) this.text(`${Math.round(l.constraint.altitude / FT / 100) * 100}${l.constraint.kind === 'atOrAbove' ? 'A' : ''}`, x + 12, y + 8, color, 12);
    }
    // Top of climb / descent
    for (const [m, label] of [[plan.toc, 'T/C'], [plan.tod, 'T/D']] as const) {
      const [x, y] = P(m.point.x, m.point.z);
      g.strokeStyle = C.green;
      g.lineWidth = 2;
      g.beginPath();
      g.arc(x, y, 6, 0, Math.PI * 2);
      g.stroke();
      this.text(label, x + 10, y, C.green, 13);
    }
    // Track line
    const trk = (d.track - d.heading) * DEG;
    g.strokeStyle = C.white;
    g.lineWidth = 2;
    g.setLineDash([10, 8]);
    g.beginPath();
    g.moveTo(cx, cy - 22);
    g.lineTo(cx + Math.sin(trk) * R, cy - Math.cos(trk) * R);
    g.stroke();
    g.setLineDash([]);
    g.restore();

    // Aircraft symbol
    g.strokeStyle = C.white;
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(cx, cy - 22);
    g.lineTo(cx, cy + 22);
    g.moveTo(cx - 18, cy - 4);
    g.lineTo(cx + 18, cy - 4);
    g.moveTo(cx - 8, cy + 18);
    g.lineTo(cx + 8, cy + 18);
    g.stroke();

    // Heading box and the data corners
    g.fillStyle = '#000';
    g.fillRect(cx - 40, 0, 80, 36);
    g.strokeStyle = C.white;
    g.lineWidth = 2;
    g.strokeRect(cx - 40, 2, 80, 32);
    this.text(formatHeading(d.heading), cx, 19, C.white, 22, 'center', 700);
    this.text('HDG', cx - 72, 19, C.green, 15, 'center');
    this.text('MAG', cx + 72, 19, C.green, 15, 'center');
    this.text(`GS ${Math.round(d.groundSpeed)}  TAS ${Math.round(d.tas)}`, 8, 56, C.white, 15);
    this.text(`${formatHeading(d.windFrom)}°/${Math.round(d.windSpeed)}`, 8, 78, C.white, 15);
    // Wind arrow, relative to the aircraft's heading (it points where the wind goes).
    const wrel = (d.windFrom + 180 - d.heading) * DEG;
    g.save();
    g.translate(30, 108);
    g.rotate(wrel);
    g.strokeStyle = C.white;
    g.beginPath();
    g.moveTo(0, 14);
    g.lineTo(0, -14);
    g.lineTo(-5, -6);
    g.moveTo(0, -14);
    g.lineTo(5, -6);
    g.stroke();
    g.restore();
    if (!fms.hold) {
      this.text(active.ident, 504, 56, C.magenta, 17, 'right', 700);
      this.text(`${formatClock(d.clock + d.eteActive)}z`, 504, 78, C.white, 15, 'right');
      this.text(`${d.toActive.toFixed(1)} NM`, 504, 98, C.white, 15, 'right');
    } else {
      this.text(`HOLD ${fms.hold.fix.ident}`, 504, 56, C.magenta, 17, 'right', 700);
    }
    // Range keys
    for (const k of this.keys) {
      g.fillStyle = '#1b2129';
      g.fillRect(k.x, k.y, k.w, k.h);
      g.strokeStyle = C.dim;
      g.strokeRect(k.x, k.y, k.w, k.h);
    }
    this.text('−', 429, 488, C.cyan, 22, 'center');
    this.text('+', 481, 488, C.cyan, 22, 'center');
    this.text(`RNG ${this.range}`, 396, 488, C.cyan, 15, 'right');
  }

  private star(x: number, y: number, color: string): void {
    const g = this.g;
    g.fillStyle = color;
    g.beginPath();
    for (let k = 0; k < 8; k++) {
      const r = k % 2 === 0 ? 9 : 3;
      const t = (k * Math.PI) / 4;
      g.lineTo(x + Math.sin(t) * r, y - Math.cos(t) * r);
    }
    g.closePath();
    g.fill();
  }
}

// ---------------------------------------------------------------------------
// Engine and crew-alerting display

export class Eicas extends Display {
  readonly interval = 120;

  constructor() {
    super('eicas', 512, 512);
  }

  private dial(x: number, y: number, r: number, value: number, max: number, redline: number, label: string): void {
    const g = this.g;
    const a0 = Math.PI * 0.75;
    const sweep = Math.PI * 1.5 * 0.85;
    const at = (v: number) => a0 + (Math.max(0, Math.min(v, max)) / max) * sweep;
    g.strokeStyle = C.white;
    g.lineWidth = 3;
    g.beginPath();
    g.arc(x, y, r, a0, at(redline));
    g.stroke();
    g.strokeStyle = C.red;
    g.beginPath();
    g.arc(x, y, r, at(redline), at(max));
    g.stroke();
    g.fillStyle = 'rgba(242,244,247,0.12)';
    g.beginPath();
    g.moveTo(x, y);
    g.arc(x, y, r - 2, a0, at(value));
    g.closePath();
    g.fill();
    g.strokeStyle = value > redline ? C.red : C.white;
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(at(value)) * (r - 4), y + Math.sin(at(value)) * (r - 4));
    g.stroke();
    // Digital readout, boxed over the dial's lower right.
    g.fillStyle = '#000';
    g.fillRect(x + 2, y + 4, r + 4, 26);
    g.strokeStyle = C.dim;
    g.lineWidth = 2;
    g.strokeRect(x + 2, y + 4, r + 4, 26);
    this.text(label, x + 4 + r / 2, y + 17, value > redline ? C.red : C.white, 18, 'center', 700);
  }

  protected draw(d: FlightData): void {
    const g = this.g;
    this.clear();
    const xs = [66, 192, 320, 446];
    this.text('TQ %', 256, 18, C.cyan, 15, 'center');
    d.engines.forEach((e, i) => this.dial(xs[i]!, 70, 44, e.torque, 110, 105, e.torque.toFixed(0)));
    this.text('TGT °C', 256, 140, C.cyan, 15, 'center');
    d.engines.forEach((e, i) => this.dial(xs[i]!, 182, 34, e.tgt, 1000, 850, String(Math.round(e.tgt))));
    const cols = [118, 230, 342, 454];
    const row = (label: string, y: number, values: string[], color = C.white) => {
      this.text(label, 8, y, C.cyan, 13);
      values.forEach((v, i) => this.text(v, cols[i]!, y, color, 18, 'center'));
    };
    row('NH %', 252, d.engines.map((e) => e.nh.toFixed(1)));
    row('NP %', 280, d.engines.map((e) => e.np.toFixed(0)));
    row('FF KG/H', 308, d.engines.map((e) => String(Math.round(e.fuelFlow))));
    if (d.engines[0]!.reverse) row('', 334, d.engines.map(() => 'REV'), C.green);

    g.strokeStyle = C.dim;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(0, 352);
    g.lineTo(512, 352);
    g.stroke();

    // Fuel
    this.text('FUEL KG', 12, 374, C.cyan, 14);
    this.text(String(Math.round(d.fuel)), 12, 400, C.white, 24, 'left', 700);
    this.text(`FF ${Math.round(d.fuelFlow)}`, 12, 426, C.white, 15);

    // Flaps: a vertical scale with the command (magenta) and position (white).
    this.text('FLAPS', 214, 374, C.cyan, 14, 'center');
    g.strokeStyle = C.white;
    g.strokeRect(204, 386, 20, 100);
    g.fillStyle = C.white;
    g.fillRect(204, 386, 20, d.flaps * 100);
    g.fillStyle = C.magenta;
    g.fillRect(198, 386 + d.flapsCmd * 100 - 2, 32, 4);
    this.text(`${Math.round(d.flaps * 100)}`, 246, 436, C.white, 18);

    // Gear: three boxes, green DN, white UP, amber in transit.
    this.text('GEAR', 360, 374, C.cyan, 14, 'center');
    const down = d.gear > 0.99;
    const up = d.gear < 0.01;
    for (const [x, y] of [[360, 400], [328, 440], [392, 440]] as const) {
      g.strokeStyle = down ? C.green : up ? C.dim : C.amber;
      g.lineWidth = 2;
      g.strokeRect(x - 26, y - 14, 52, 28);
      if (!up) this.text(down ? 'DN' : '|||', x, y, down ? C.green : C.amber, 16, 'center', 700);
      else this.text('UP', x, y, C.grey, 14, 'center');
    }

    // Memo messages
    const memo: [string, string][] = [];
    if (d.autobrake > 0) memo.push([`AUTOBRAKE ${d.autobrake.toFixed(1)}`, C.green]);
    if (d.landingLights) memo.push(['LDG LIGHTS', C.green]);
    memo.push([`CABIN ${Math.round(d.cabinAltitude / 10) * 10} FT`, C.white]);
    memo.forEach(([m, color], i) => this.text(m, 440, 384 + i * 22, color, 13, 'left'));
    this.text('SIMULATED', 500, 496, C.dim, 12, 'right');
  }
}

// ---------------------------------------------------------------------------
// Multifunction display: engines, fuel, pressurization, vertical profile

type MfdPage = 'ENG' | 'FUEL' | 'AIR' | 'VERT';
const MFD_PAGES: MfdPage[] = ['ENG', 'FUEL', 'AIR', 'VERT'];

export class Mfd extends Display {
  readonly interval = 150;
  page: MfdPage = 'VERT';
  private profileKey = '';
  private terrain: { d: number; h: number }[] = [];
  /** Distance to the active fix when the terrain was sampled: what's been flown since shifts it. */
  private sampledToActive = 0;

  constructor() {
    super('mfd', 512, 512);
    this.keys = MFD_PAGES.map((p, i) => ({ x: 8 + i * 126, y: 466, w: 118, h: 40, id: p }));
  }

  pressKey(id: string): void {
    if ((MFD_PAGES as string[]).includes(id)) {
      this.page = id as MfdPage;
      this.invalidate();
    }
  }

  protected draw(d: FlightData, sim: FlightSimulation): void {
    const g = this.g;
    this.clear();
    if (this.page === 'ENG') this.eng(d);
    else if (this.page === 'FUEL') this.fuel(d);
    else if (this.page === 'AIR') this.air(d);
    else this.vert(d, sim);
    for (const k of this.keys) {
      const on = k.id === this.page;
      g.fillStyle = on ? '#15303a' : '#141920';
      g.fillRect(k.x, k.y, k.w, k.h);
      g.strokeStyle = on ? C.cyan : C.dim;
      g.lineWidth = 2;
      g.strokeRect(k.x, k.y, k.w, k.h);
      this.text(k.id, k.x + k.w / 2, k.y + k.h / 2, on ? C.cyan : C.grey, 17, 'center', 700);
    }
  }

  private table(rows: [string, string, string?][], x: number, y: number, dy = 30): void {
    rows.forEach(([label, value, color], i) => {
      this.text(label, x, y + i * dy, C.cyan, 16);
      this.text(value, x + 470, y + i * dy, color ?? C.white, 18, 'right');
    });
  }

  private eng(d: FlightData): void {
    this.text('ENGINES', 256, 24, C.white, 18, 'center', 700);
    const xs = [170, 250, 330, 410];
    ['1', '2', '3', '4'].forEach((n, i) => this.text(n, xs[i]!, 64, C.cyan, 16, 'center'));
    const row = (label: string, y: number, f: (e: FlightData['engines'][number]) => string) => {
      this.text(label, 20, y, C.cyan, 15);
      d.engines.forEach((e, i) => this.text(f(e), xs[i]!, y, C.white, 17, 'center'));
    };
    row('TQ %', 100, (e) => e.torque.toFixed(1));
    row('TGT °C', 136, (e) => String(Math.round(e.tgt)));
    row('NH %', 172, (e) => e.nh.toFixed(1));
    row('NP %', 208, (e) => e.np.toFixed(0));
    row('FF KG/H', 244, (e) => String(Math.round(e.fuelFlow)));
    this.table(
      [
        ['POWER', `${Math.round(d.powerSetting * 100)} %`],
        ['OAT', `${Math.round(d.oat)} °C`],
        ['IAS / TAS', `${Math.round(d.ias)} / ${Math.round(d.tas)} KT`],
        ['MACH', d.mach.toFixed(3)],
      ],
      20,
      300,
    );
    this.text('ONE ENGINE MODEL, FOUR GAUGES', 256, 440, C.dim, 13, 'center');
  }

  private fuel(d: FlightData): void {
    const g = this.g;
    this.text('FUEL', 256, 24, C.white, 18, 'center', 700);
    this.text(String(Math.round(d.fuel)), 256, 76, C.white, 40, 'center', 700);
    this.text('KG ON BOARD', 256, 108, C.cyan, 14, 'center');
    const cap = 20_000;
    g.strokeStyle = C.white;
    g.lineWidth = 2;
    g.strokeRect(56, 128, 400, 22);
    g.fillStyle = C.green;
    g.fillRect(57, 129, (398 * d.fuel) / cap, 20);
    g.fillStyle = C.amber;
    g.fillRect(56 + (400 * d.reserveFuel) / cap, 124, 3, 30);
    const ok = d.fuelAtDestination >= d.reserveFuel;
    this.table(
      [
        ['USED', `${Math.round(d.fuelUsed)} KG`],
        ['FLOW', `${Math.round(d.fuelFlow)} KG/H`],
        ['ENDURANCE', formatDuration(d.endurance)],
        ['PLANNED TRIP', `${Math.round(d.plan.tripFuel)} KG`],
        ['AT DEST (PRED)', `${Math.round(d.fuelAtDestination)} KG`, ok ? C.green : C.amber],
        ['RESERVE 45 MIN', `${Math.round(d.reserveFuel)} KG`],
        ['GROSS WEIGHT', `${(d.grossWeight / 1000).toFixed(1)} T`],
      ],
      20,
      190,
    );
  }

  private air(d: FlightData): void {
    const g = this.g;
    this.text('PRESSURIZATION · AUTO', 256, 24, C.white, 18, 'center', 700);
    // Outflow valve gauge
    const cx = 140;
    const cy = 170;
    g.strokeStyle = C.white;
    g.lineWidth = 3;
    g.beginPath();
    g.arc(cx, cy, 70, Math.PI, 0);
    g.stroke();
    const a = Math.PI + (d.outflowValve / 100) * Math.PI;
    g.beginPath();
    g.moveTo(cx, cy);
    g.lineTo(cx + Math.cos(a) * 64, cy + Math.sin(a) * 64);
    g.stroke();
    this.text('CLOSED', cx - 70, cy + 20, C.grey, 12, 'center');
    this.text('OPEN', cx + 70, cy + 20, C.grey, 12, 'center');
    this.text('OUTFLOW VALVE', cx, cy + 44, C.cyan, 14, 'center');
    this.text(`${Math.round(d.outflowValve)} %`, cx, cy - 24, C.white, 20, 'center');
    // Differential pressure gauge
    const px = 376;
    g.strokeStyle = C.white;
    g.beginPath();
    g.arc(px, cy, 70, Math.PI, Math.PI + (7.5 / 8) * Math.PI);
    g.stroke();
    g.strokeStyle = C.red;
    g.beginPath();
    g.arc(px, cy, 70, Math.PI + (7.5 / 8) * Math.PI, 0);
    g.stroke();
    const b = Math.PI + (Math.max(0, Math.min(d.cabinDifferential, 8)) / 8) * Math.PI;
    g.strokeStyle = C.white;
    g.beginPath();
    g.moveTo(px, cy);
    g.lineTo(px + Math.cos(b) * 64, cy + Math.sin(b) * 64);
    g.stroke();
    this.text('ΔP PSI', px, cy + 44, C.cyan, 14, 'center');
    this.text(d.cabinDifferential.toFixed(2), px, cy - 24, C.white, 20, 'center');
    this.table(
      [
        ['CABIN ALT', `${Math.round(d.cabinAltitude / 10) * 10} FT`],
        ['CABIN RATE', `${Math.round(d.cabinRate / 10) * 10} FPM`, Math.abs(d.cabinRate) > 600 ? C.amber : C.white],
        ['LDG ALT', `${Math.round(d.landingElevation)} FT`],
        ['AIRCRAFT ALT', `${Math.round(d.altitude / 10) * 10} FT`],
      ],
      20,
      270,
    );
    this.text('SIMPLIFIED CONTROLLER: NOT A REAL SYSTEM', 256, 440, C.dim, 13, 'center');
  }

  /** Vertical profile of the route ahead: planned path, terrain under it, the aircraft. */
  private vert(d: FlightData, sim: FlightSimulation): void {
    const g = this.g;
    const plan = d.plan;
    const fms = sim.fms;
    const RANGE = 30 * NM;
    // Terrain along the route ahead, sampled once per leg change.
    const key = `${plan.id}:${fms.legIndex}`;
    const ax = sim.state[0]!;
    const az = sim.state[2]!;
    if (key !== this.profileKey || this.sampledToActive - fms.toActive > 2 * NM) {
      this.profileKey = key;
      this.sampledToActive = fms.toActive;
      this.terrain = [];
      let px = ax;
      let pz = az;
      let dist = 0;
      for (let i = fms.legIndex; i < plan.legs.length && dist < RANGE * 1.1; i++) {
        const l = plan.legs[i]!;
        const len = Math.hypot(l.x - px, l.z - pz);
        for (let s = 0; s < len && dist + s < RANGE * 1.1; s += 400) {
          const t = s / len;
          this.terrain.push({ d: dist + s, h: terrainHeight(px + (l.x - px) * t, pz + (l.z - pz) * t) });
        }
        dist += len;
        px = l.x;
        pz = l.z;
      }
    }
    const x0 = 46;
    const x1 = 500;
    const y0 = 420;
    const y1 = 60;
    const top = Math.max(plan.cruiseAltitude, sim.state[1]!) + 1500 * FT;
    const X = (dist: number) => x0 + (dist / RANGE) * (x1 - x0);
    const Y = (h: number) => y0 - (h / top) * (y0 - y1);
    this.text('VERTICAL PROFILE', 256, 24, C.white, 18, 'center', 700);
    // Altitude scale
    for (let ft = 0; ft <= top / FT; ft += 1000) {
      const y = Y(ft * FT);
      g.strokeStyle = C.dim;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(x0, y);
      g.lineTo(x1, y);
      g.stroke();
      if (ft % 2000 === 0) this.text(String(ft), x0 - 4, y, C.grey, 12, 'right');
    }
    for (let nm = 0; nm <= 30; nm += 10) this.text(`${nm}`, X(nm * NM), y0 + 14, C.grey, 12, 'center');
    // Terrain (sampled from where the aircraft was; shifted by what it has flown since)
    const sinceStart = Math.max(0, this.sampledToActive - fms.toActive);
    g.fillStyle = '#5a3d22';
    g.beginPath();
    g.moveTo(x0, y0);
    for (const p of this.terrain) {
      const dd = p.d - sinceStart;
      if (dd < 0) continue;
      g.lineTo(X(dd), Y(p.h));
    }
    g.lineTo(x1, y0);
    g.closePath();
    g.fill();
    // Planned path through the leg ends (magenta), from the aircraft.
    g.strokeStyle = C.magenta;
    g.lineWidth = 3;
    g.beginPath();
    let dist = fms.toActive;
    g.moveTo(X(0), Y(sim.state[1]!));
    for (let i = fms.legIndex; i < plan.legs.length; i++) {
      const l = plan.legs[i]!;
      if (i > fms.legIndex) dist += l.length;
      g.lineTo(X(dist), Y(l.altitude));
      if (dist > RANGE) break;
      if (l.type !== 'RW') this.text(l.ident, X(dist), Y(l.altitude) - 14, C.white, 12, 'center');
    }
    g.stroke();
    // Selected altitude
    g.setLineDash([8, 6]);
    g.strokeStyle = C.magenta;
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(x0, Y(d.selectedAltitude * FT));
    g.lineTo(x1, Y(d.selectedAltitude * FT));
    g.stroke();
    g.setLineDash([]);
    // The aircraft, and its flight path angle
    const ay = Y(sim.state[1]!);
    g.fillStyle = C.white;
    g.beginPath();
    g.moveTo(x0 + 14, ay);
    g.lineTo(x0, ay - 7);
    g.lineTo(x0, ay + 7);
    g.closePath();
    g.fill();
    g.strokeStyle = C.white;
    g.lineWidth = 2;
    // Where the present flight path leads, over the next 2 NM.
    g.beginPath();
    g.moveTo(x0 + 14, ay);
    g.lineTo(X(2 * NM), Math.max(y1, Math.min(y0, Y(sim.state[1]! + Math.tan(d.fpa * DEG) * 2 * NM))));
    g.stroke();
    this.text('NM AHEAD ALONG THE ROUTE', 256, 446, C.dim, 12, 'center');
  }
}

// ---------------------------------------------------------------------------
// Control display unit (the FMS keyboard and screen)

type CduPage = 'LEGS' | 'PROG' | 'PERF' | 'DIR' | 'HOLD';
const CDU_KEYS: CduPage[] = ['LEGS', 'PROG', 'PERF', 'DIR', 'HOLD'];
const ROW_H = 25;
const COL_W = 18.4;
const SCREEN = { x: 36, y: 18 };

export class Cdu extends Display {
  readonly interval = 200;
  page: CduPage = 'LEGS';
  private message = '';
  private messageUntil = 0;
  /** Fix idents shown against the left line-select keys on the DIR page. */
  private dirTargets: string[] = [];

  constructor() {
    super('cdu', 512, 640);
    const keys: Key[] = [];
    for (let i = 0; i < 6; i++) {
      const y = SCREEN.y + ROW_H * (2 + i * 2) - 14;
      keys.push({ x: 0, y, w: 32, h: 28, id: `L${i + 1}` });
      keys.push({ x: 480, y, w: 32, h: 28, id: `R${i + 1}` });
    }
    CDU_KEYS.forEach((p, i) => keys.push({ x: 14 + (i % 3) * 164, y: 412 + Math.floor(i / 3) * 62, w: 152, h: 52, id: p }));
    this.keys = keys;
  }

  /** A key press: page keys change the page; line keys act on the current page. */
  pressKey(id: string, sim: FlightSimulation): void {
    if ((CDU_KEYS as string[]).includes(id)) {
      this.page = id as CduPage;
    } else if (this.page === 'DIR' && id.startsWith('L')) {
      const ident = this.dirTargets[Number(id.slice(1)) - 1];
      if (ident) this.flash(sim.directTo(ident) ? `DIRECT TO ${ident}` : 'NOT AVAILABLE ON GROUND');
      if (ident) this.page = 'LEGS';
    } else if (this.page === 'HOLD' && id === 'L6') {
      const fms = sim.fms;
      if (fms.hold || fms.pendingHold) {
        sim.resume();
        this.flash('EXIT HOLD');
      } else {
        const ident = sim.plan.legs[fms.legIndex]!.ident;
        if (sim.holdAt(ident) || sim.holdAt(sim.plan.destination.ident)) this.flash(`HOLD AT ${ident}`);
        else this.flash('NOT IN NAV DATABASE');
      }
    }
    this.invalidate();
  }

  private flash(msg: string): void {
    this.message = msg;
    this.messageUntil = performance.now() + 4000;
  }

  private line(row: number, left: string, right = '', color = C.white, small = false, rightColor = color): void {
    const y = SCREEN.y + ROW_H * row + 12;
    this.text(left, SCREEN.x, y, color, small ? 15 : 21);
    if (right) this.text(right, SCREEN.x + COL_W * 24, y, rightColor, small ? 15 : 21, 'right');
  }

  protected draw(d: FlightData, sim: FlightSimulation): void {
    const g = this.g;
    g.fillStyle = C.panel;
    g.fillRect(0, 0, this.width, this.height);
    g.fillStyle = C.bg;
    g.fillRect(SCREEN.x - 6, SCREEN.y - 6, COL_W * 24 + 12, ROW_H * 14 + 12);
    const plan = d.plan;
    const fms = sim.fms;
    const ft = (m: number) => String(Math.round(m / FT / 100) * 100);
    const kt = (ms: number) => String(Math.round(ms / 0.514_444));

    if (this.page === 'LEGS') {
      this.line(0, ` ACT RTE LEGS`, `${plan.origin.ident}-${plan.destination.ident}`, C.white, false, C.cyan);
      const from = Math.max(fms.legIndex, 1);
      for (let k = 0; k < 6; k++) {
        const l = plan.legs[from + k];
        if (!l) break;
        const course = formatHeading(toMagnetic(l.course, plan.variation) / DEG);
        this.line(1 + k * 2, ` ${course}°  ${(l.length / NM).toFixed(1)}NM`, '', C.white, true);
        const active = from + k === fms.legIndex;
        const alt = l.constraint ? `${ft(l.constraint.altitude)}${l.constraint.kind === 'atOrAbove' ? 'A' : ''}` : ft(l.altitude);
        this.line(2 + k * 2, l.ident, `${kt(l.speed)}/${alt.padStart(5, ' ')}`, active ? C.magenta : C.white, false, active ? C.magenta : C.cyan);
      }
    } else if (this.page === 'PROG') {
      const legs = plan.legs;
      const next = legs[fms.legIndex + 1];
      this.line(0, ` ${plan.origin.ident}-${plan.destination.ident} PROGRESS`);
      this.line(1, ' TO          DTG   ETA', '', C.white, true);
      this.line(2, `${legs[fms.legIndex]!.ident}`, `${d.toActive.toFixed(1)}  ${formatClock(d.clock + d.eteActive).replace(':', '')}Z`, C.magenta, false, C.white);
      if (next) {
        this.line(3, ' NEXT', '', C.white, true);
        this.line(4, next.ident, `${(d.toActive + next.length / NM).toFixed(1)}  ${formatClock(d.clock + d.eteActive + next.time).replace(':', '')}Z`);
      }
      this.line(5, ' DEST', ' FUEL', C.white, true);
      this.line(6, `${plan.destination.ident} ${d.toDestination.toFixed(1)}`, `${formatClock(d.etaDestination).replace(':', '')}Z ${(d.fuelAtDestination / 1000).toFixed(1)}`);
      this.line(7, ' XTK ERROR', ' WIND', C.white, true);
      this.line(8, `${Math.abs(d.crossTrack).toFixed(2)}${d.crossTrack >= 0 ? 'R' : 'L'}`, `${formatHeading(d.windFrom)}°/${Math.round(d.windSpeed)}`);
      this.line(9, ' CRZ ALT', ' PHASE', C.white, true);
      this.line(10, ft(plan.cruiseAltitude), d.phase.toUpperCase());
      this.line(11, ' APPROACH', '', C.white, true);
      this.line(12, plan.approach.name, '', C.cyan, true);
    } else if (this.page === 'PERF') {
      this.line(0, ' PERF / APPROACH REF');
      this.line(1, ' GROSS WT', ' FUEL', C.white, true);
      this.line(2, `${(d.grossWeight / 1000).toFixed(1)}`, `${(d.fuel / 1000).toFixed(1)}`);
      this.line(3, ' VR   V2', ' VREF  VAPP', C.white, true);
      this.line(4, `${Math.round(d.vr)}  ${Math.round(d.v2)}`, `${Math.round(d.vref)}   ${Math.round(d.vapp)}`, C.green);
      this.line(5, ' TO DIST / RWY', '', C.white, true);
      this.line(6, `${Math.round(plan.takeoffDistance)}M / ${plan.departure.runway.length}M`, `RW${plan.departure.runway.ident}`);
      this.line(7, ' LDG DIST / RWY', '', C.white, true);
      this.line(8, `${Math.round(plan.landingDistance)}M / ${plan.arrival.runway.length}M`, `RW${plan.arrival.runway.ident}`);
      this.line(9, ' CRZ ALT   MEA', ' RESERVE', C.white, true);
      this.line(10, `${ft(plan.cruiseAltitude)}   ${ft(plan.mea)}`, `${Math.round(plan.reserveFuel)}`);
      this.line(11, ' ETE', ' TRIP FUEL', C.white, true);
      this.line(12, formatDuration(plan.ete), `${Math.round(plan.tripFuel)}`);
    } else if (this.page === 'DIR') {
      this.line(0, ' DIRECT TO');
      this.dirTargets = plan.legs.filter((l, i) => i >= Math.max(fms.legIndex, 2) && l.type !== 'RW').slice(0, 6).map((l) => l.ident);
      this.dirTargets.forEach((ident, k) => {
        this.line(1 + k * 2, '', '', C.white, true);
        this.line(2 + k * 2, `<${ident}`, '', ident === legsIdent(sim) ? C.magenta : C.white);
      });
    } else {
      const hold = fms.hold;
      this.line(0, ' HOLD');
      if (hold) {
        this.line(1, ' FIX', ' ALT', C.white, true);
        this.line(2, hold.fix.ident, ft(hold.altitude), C.magenta);
        this.line(3, ' RADIUS', ' SPEED', C.white, true);
        this.line(4, `${(hold.radius / NM).toFixed(1)}NM`, `${Math.round(d.selectedSpeed)}KT`);
        this.line(12, '<EXIT HOLD', '', C.white);
      } else {
        this.line(1, ' ACTIVE FIX', '', C.white, true);
        this.line(2, legsIdent(sim), '', C.magenta);
        this.line(12, fms.pendingHold ? '<CANCEL HOLD' : '<HOLD AT ACTIVE', '', C.white);
      }
    }
    // Scratchpad
    const now = performance.now();
    this.line(13, now < this.messageUntil ? this.message : 'SIMULATED NOT FOR NAV', '', now < this.messageUntil ? C.cyan : C.dim, true);

    // Line-select keys and page keys
    for (const k of this.keys) {
      const page = (CDU_KEYS as string[]).includes(k.id);
      g.fillStyle = page && k.id === this.page ? '#26313d' : '#1d232c';
      g.fillRect(k.x + 2, k.y + 2, k.w - 4, k.h - 4);
      g.strokeStyle = '#46505e';
      g.lineWidth = 2;
      g.strokeRect(k.x + 2, k.y + 2, k.w - 4, k.h - 4);
      if (page) this.text(k.id, k.x + k.w / 2, k.y + k.h / 2, C.white, 18, 'center', 700);
    }
  }
}

function legsIdent(sim: FlightSimulation): string {
  return sim.plan.legs[sim.fms.legIndex]!.ident;
}

// ---------------------------------------------------------------------------
// Mode control panel, on the glareshield

export class Mcp extends Display {
  readonly interval = 200;

  constructor() {
    super('mcp', 1024, 160);
  }

  protected draw(d: FlightData): void {
    const g = this.g;
    g.fillStyle = '#20252d';
    g.fillRect(0, 0, 1024, 160);
    const windowBox = (x: number, w: number, label: string, value: string) => {
      this.text(label, x + w / 2, 22, C.white, 15, 'center');
      g.fillStyle = '#0a0c0f';
      g.fillRect(x, 36, w, 46);
      this.text(value, x + w / 2, 60, '#ffd38a', 30, 'center', 700);
    };
    const button = (x: number, label: string, lit: boolean) => {
      g.fillStyle = '#2c333d';
      g.fillRect(x, 92, 92, 52);
      g.strokeStyle = '#46505e';
      g.lineWidth = 2;
      g.strokeRect(x, 92, 92, 52);
      g.fillStyle = lit ? C.green : '#1a2a20';
      g.fillRect(x + 20, 98, 52, 6);
      this.text(label, x + 46, 124, C.white, 15, 'center', 700);
    };
    const v = d.fma.vertical;
    windowBox(20, 120, 'IAS', String(Math.round(d.selectedSpeed)));
    button(150, 'A/T', !!d.fma.thrust);
    button(250, 'SPD', d.fma.thrust === 'SPD');
    windowBox(360, 110, 'TRK', formatHeading(d.desiredTrack));
    button(350, 'LNAV', d.fma.lateral === 'LNAV');
    button(450, 'VNAV', v.startsWith('VNAV'));
    windowBox(560, 140, 'ALT', String(Math.round(d.selectedAltitude / 100) * 100));
    button(560, 'ALT HLD', v === 'ALT');
    windowBox(720, 130, 'V/S', d.onGround ? '-----' : `${d.verticalSpeed >= 0 ? '+' : ''}${Math.round(d.verticalSpeed / 100) * 100}`);
    button(660, 'APP', d.fma.lateral === 'FAC' || v === 'G/P' || v === 'FLARE');
    button(760, 'HOLD', d.fma.lateral === 'HOLD');
    button(870, 'CMD', !!d.fma.lateral);
    this.text('A/P', 916, 22, C.white, 15, 'center');
  }
}
