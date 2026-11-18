import { ArrowHelper, Group, Vector3, type WebGLRenderer } from 'three';
import { S } from '../sim/dynamics';
import type { FlightSimulation, RenderState, Sample } from '../sim/simulation';
import { clamp } from '../sim/math';
import { headingLabel, M_TO_FT, M_TO_NM, MS_TO_FPM, MS_TO_KT, toDeg } from '../sim/units';

const COLORS = { lift: 0x67d4ea, drag: 0xf4b860, thrust: 0x74dca0, weight: 0xc9d3e0 };
const STRIP = { bank: '#67d4ea', cmd: '#f27ad9', alt: '#f4b860', xtk: '#74dca0' };

/** Arrow length per unit weight [m]. Drag and thrust are ~1/14 of lift, so they're drawn ×5. */
const SCALE_BIG = 30;
const SCALE_SMALL = 150;

export interface FrameStats {
  stepsPerFrame: number;
  frameMs: number;
  pixelRatio: number;
}

/**
 * "Look under the hood". Force vectors drawn on the aircraft each frame; the panel's
 * readouts at 8 Hz and its strip chart at 10 Hz, only while open.
 */
export class EngineeringView {
  readonly group = new Group();
  private enabled = false;
  private readonly arrows: Record<keyof typeof COLORS, ArrowHelper>;
  private readonly fields = new Map<string, HTMLElement>();
  private readonly strip: CanvasRenderingContext2D | null = null;
  private lastPanel = 0;
  private lastStrip = 0;
  private spf = 0;

  // scratch vectors
  private readonly v = new Vector3();
  private readonly l0 = new Vector3();
  private readonly r = new Vector3();
  private readonly lift = new Vector3();
  private readonly thrust = new Vector3();
  private readonly origin = new Vector3();

  constructor(panel: HTMLElement | null) {
    const make = (color: number) => {
      const a = new ArrowHelper(new Vector3(0, 1, 0), new Vector3(), 10, color, 3.5, 1.8);
      // Draw on top of the airframe, like a HUD overlay.
      for (const m of [a.line.material, a.cone.material]) {
        const mat = m as { depthTest: boolean; transparent: boolean };
        mat.depthTest = false;
        mat.transparent = true;
      }
      a.renderOrder = 10;
      this.group.add(a);
      return a;
    };
    this.arrows = { lift: make(COLORS.lift), drag: make(COLORS.drag), thrust: make(COLORS.thrust), weight: make(COLORS.weight) };
    this.group.visible = false;

    panel?.querySelectorAll<HTMLElement>('[data-eng]').forEach((el) => this.fields.set(el.dataset.eng!, el));
    const canvas = panel?.querySelector<HTMLCanvasElement>('[data-eng-strip]');
    this.strip = canvas?.getContext('2d') ?? null;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    this.group.visible = on;
  }

  update(sim: FlightSimulation, pose: RenderState, renderer: WebGLRenderer, stats: FrameStats, now: number): void {
    if (!this.enabled) return;
    this.spf += (stats.stepsPerFrame - this.spf) * 0.1;
    this.updateArrows(sim, pose);
    if (now - this.lastPanel > 125) {
      this.lastPanel = now;
      this.updatePanel(sim, renderer, stats);
    }
    if (this.strip && now - this.lastStrip > 100) {
      this.lastStrip = now;
      this.drawStrip(sim);
    }
  }

  private updateArrows(sim: FlightSimulation, pose: RenderState): void {
    const f = sim.forces;
    const { gamma: g, psi: p, phi, alpha: a } = pose;
    // Velocity direction, the lift direction with wings level, and the right wing.
    this.v.set(Math.cos(g) * Math.sin(p), Math.sin(g), -Math.cos(g) * Math.cos(p));
    this.l0.set(-Math.sin(g) * Math.sin(p), Math.cos(g), Math.sin(g) * Math.cos(p));
    this.r.set(Math.cos(p), 0, Math.sin(p));
    // Bank tilts lift toward the lower (right, for φ > 0) wing.
    this.lift.copy(this.l0).multiplyScalar(Math.cos(phi)).addScaledVector(this.r, Math.sin(phi));
    // Thrust acts along the body axis: α above the velocity vector.
    this.thrust.copy(this.v).multiplyScalar(Math.cos(a)).addScaledVector(this.lift, Math.sin(a));
    this.origin.set(pose.x, pose.y, pose.z);

    const W = f.weight;
    const set = (arrow: ArrowHelper, dir: Vector3, len: number) => {
      arrow.position.copy(this.origin);
      arrow.setDirection(dir);
      arrow.setLength(Math.max(len, 0.5), Math.min(3.5, len * 0.4), Math.min(1.8, len * 0.2));
    };
    set(this.arrows.lift, this.lift, (f.lift / W) * SCALE_BIG);
    set(this.arrows.weight, this.v.set(0, -1, 0), SCALE_BIG);
    this.v.set(Math.cos(g) * Math.sin(p), Math.sin(g), -Math.cos(g) * Math.cos(p)).negate();
    set(this.arrows.drag, this.v, (f.drag / W) * SCALE_SMALL);
    set(this.arrows.thrust, this.thrust, (f.thrust / W) * SCALE_SMALL);
  }

  private set(key: string, text: string): void {
    const el = this.fields.get(key);
    if (el && el.textContent !== text) el.textContent = text;
  }

  private updatePanel(sim: FlightSimulation, renderer: WebGLRenderer, stats: FrameStats): void {
    const s = sim.state;
    const st = sim.autopilot.status;
    const f = sim.forces;
    const deg = (r: number) => `${toDeg(r).toFixed(1)}°`;
    const ft = (m: number) => `${Math.round(m * M_TO_FT).toLocaleString('en-US')}`;
    const kN = (n: number) => `${(n / 1000).toFixed(1)} kN`;

    this.set('mode', sim.mode === 'orbit' ? 'HOLD' : 'DIRECT TO');
    this.set('target', sim.targetWaypoint.fix);
    this.set('dtg', `${(sim.distanceToTarget() * M_TO_NM).toFixed(2)} NM`);
    this.set('xtk', `${st.trackError >= 0 ? '+' : ''}${st.trackError.toFixed(0)} m`);
    this.set('crs', `${headingLabel(st.courseCmd)}°`);
    this.set('bank', `${deg(s[S.PHI]!)} / ${deg(st.bankCmd)}`);
    this.set('alt', `${ft(s[S.Y]!)} / ${ft(sim.altitudeCmd)} ft`);
    this.set('vs', `${Math.round(s[S.V]! * Math.sin(s[S.GAMMA]!) * MS_TO_FPM)} fpm`);
    this.set('tas', `${(s[S.V]! * MS_TO_KT).toFixed(0)} kt`);
    this.set('aoa', deg(s[S.ALPHA]!));
    this.set('gamma', `${deg(s[S.GAMMA]!)} / ${deg(st.gammaCmd)}`);
    this.set('thr', `${(s[S.THRUST]! * 100).toFixed(0)}%`);
    this.set('lift', kN(f.lift));
    this.set('drag', kN(f.drag));
    this.set('thrust', kN(f.thrust));
    this.set('weight', kN(f.weight));
    this.set('ld', (f.lift / f.drag).toFixed(1));
    this.set('nz', `${((f.lift + f.thrust * Math.sin(s[S.ALPHA]!)) / f.weight).toFixed(2)} g`);
    this.set('spf', this.spf.toFixed(1));
    this.set('frame', `${stats.frameMs.toFixed(1)} ms`);
    this.set('dpr', `×${stats.pixelRatio.toFixed(2)}`);
    this.set('calls', String(renderer.info.render.calls));
  }

  private drawStrip(sim: FlightSimulation): void {
    const ctx = this.strip!;
    const W = ctx.canvas.width;
    const H = ctx.canvas.height;
    ctx.clearRect(0, 0, W, H);

    ctx.strokeStyle = 'rgba(176, 196, 228, 0.12)';
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.beginPath();
    for (const y of [0.25, 0.5, 0.75]) {
      ctx.moveTo(0, Math.round(H * y) + 0.5);
      ctx.lineTo(W, Math.round(H * y) + 0.5);
    }
    for (let s = 5; s < 30; s += 5) {
      const x = Math.round((s / 30) * W) + 0.5;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
    }
    ctx.stroke();

    const t1 = sim.time;
    const t0 = t1 - 30;
    const plot = (get: (s: Sample) => number, range: number, color: string, dash: number[] = []) => {
      ctx.beginPath();
      let first = true;
      sim.history.forEach((s) => {
        if (s.t < t0) return;
        const x = ((s.t - t0) / 30) * W;
        const y = H / 2 - clamp(get(s) / range, -1, 1) * (H / 2 - 10);
        if (first) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
        first = false;
      });
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5;
      ctx.setLineDash(dash);
      ctx.stroke();
    };
    plot((s) => s.trackError, 200, STRIP.xtk);
    plot((s) => s.altitudeError, 60, STRIP.alt);
    plot((s) => toDeg(s.bankCmd), 35, STRIP.cmd, [10, 7]);
    plot((s) => toDeg(s.bank), 35, STRIP.bank);

    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(182, 194, 209, 0.75)';
    ctx.font = '22px "B612 Mono", monospace';
    ctx.fillText('±35° bank · ±60 m alt · ±200 m track', 12, 30);
    ctx.fillText('now', W - 52, H - 12);
    ctx.fillText('−30 s', 12, H - 12);
  }
}
