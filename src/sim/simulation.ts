import { ISA, density } from './atmosphere';
import { type AircraftParams, inducedDragFactor, TRANSPORT } from './aircraft';
import { Autopilot, type AutopilotGains, type AutopilotTarget, DEFAULT_GAINS } from './autopilot';
import {
  availableThrust,
  computeForces,
  type Controls,
  createForces,
  createState,
  type Forces,
  Rk4Workspace,
  rk4Step,
  S,
} from './dynamics';
import { courseOf, type LinePath, type OrbitPath } from './guidance';
import { lerp, lerpAngle } from './math';

export interface Waypoint {
  id: string;
  /** Five-letter fix name, as on a chart. */
  fix: string;
  x: number;
  z: number;
  /** Target altitude, metres above sea level. */
  altitude: number;
  /** Radius of the hold flown on arrival [m]. */
  orbitRadius: number;
}

export type GuidanceMode = 'direct' | 'orbit';

export interface SimulationOptions {
  waypoints: readonly Waypoint[];
  start: string;
  params?: AircraftParams;
  gains?: AutopilotGains;
  /** Commanded true airspeed [m/s]. */
  airspeed?: number;
  /** Physics rate [Hz]. */
  rate?: number;
  /** Run the autopilot every Nth physics step (60 Hz at the defaults). */
  autopilotDivider?: number;
  /** Ground height [m] for terrain clearance. */
  terrainHeight?: (x: number, z: number) => number;
  /** Minimum height above terrain ahead [m]. */
  terrainClearance?: number;
  /** Where on the starting hold to begin: bearing from its centre [rad]. */
  startBearing?: number;
}

/** Interpolated pose for drawing a frame. */
export interface RenderState {
  x: number;
  y: number;
  z: number;
  psi: number;
  gamma: number;
  phi: number;
  alpha: number;
  thrust: number;
}

export function createRenderState(): RenderState {
  return { x: 0, y: 0, z: 0, psi: 0, gamma: 0, phi: 0, alpha: 0, thrust: 0 };
}

/** One strip-chart sample. */
export interface Sample {
  t: number;
  altitudeError: number;
  bank: number;
  bankCmd: number;
  trackError: number;
  speedError: number;
}

const TERRAIN_LOOKAHEAD = [0, 400, 900, 1600, 2500];
const CAPTURE_FACTOR = 1.3;
const HISTORY_SECONDS = 30;
const HISTORY_RATE = 10;

/**
 * The aircraft, its autopilot and its flight plan, stepped at a fixed rate.
 *
 * Rendering calls `advance(frameSeconds)` once per animation frame. The simulation
 * runs as many fixed steps as that time covers (the "fix your timestep" accumulator),
 * so the physics is identical at 30, 60 or 144 fps. The leftover fraction is returned
 * so the renderer can interpolate between the last two states.
 */
export class FlightSimulation {
  readonly params: AircraftParams;
  readonly dt: number;
  readonly autopilotDivider: number;
  readonly waypoints: readonly Waypoint[];
  readonly airspeed: number;
  readonly state = createState();
  readonly controls: Controls = { bankCmd: 0, alphaCmd: 0, throttle: 0 };
  readonly forces: Forces = createForces();
  readonly autopilot: Autopilot;
  /** Last 30 s of loop behaviour at 10 Hz, for the engineering view's strip chart. */
  readonly history = new SampleRing(HISTORY_SECONDS * HISTORY_RATE);

  mode: GuidanceMode = 'orbit';
  time = 0;
  steps = 0;
  /** Commanded altitude after terrain clearance is applied [m]. */
  altitudeCmd = 0;
  /** Multiplier on real time (the engineering view can speed the sim up). */
  timeScale = 1;
  maxSubsteps = 12;

  private readonly prev = createState();
  private readonly rk4 = new Rk4Workspace();
  private readonly terrainHeight?: (x: number, z: number) => number;
  private readonly terrainClearance: number;
  private readonly apTarget: AutopilotTarget;
  private target: Waypoint;
  private accumulator = 0;
  private historyCountdown = 0;

  constructor(opts: SimulationOptions) {
    this.params = opts.params ?? TRANSPORT;
    this.waypoints = opts.waypoints;
    this.airspeed = opts.airspeed ?? 75;
    this.dt = 1 / (opts.rate ?? 120);
    this.autopilotDivider = opts.autopilotDivider ?? 2;
    this.terrainHeight = opts.terrainHeight;
    this.terrainClearance = opts.terrainClearance ?? 220;
    this.autopilot = new Autopilot(this.params, opts.gains ?? DEFAULT_GAINS);

    const start = this.requireWaypoint(opts.start);
    this.target = start;
    this.apTarget = { path: this.orbitAround(start), altitude: start.altitude, airspeed: this.airspeed };
    this.altitudeCmd = start.altitude;
    this.trimInOrbit(start, opts.startBearing ?? 200 * (Math.PI / 180));
    this.prev.set(this.state);
  }

  get targetWaypoint(): Waypoint {
    return this.target;
  }

  get path(): Readonly<LinePath | OrbitPath> {
    return this.apTarget.path;
  }

  /** Fly direct to a waypoint from present position, then hold there. */
  setTarget(id: string): boolean {
    const wp = this.waypoints.find((w) => w.id === id);
    if (!wp || wp === this.target) return false;
    this.target = wp;
    const x = this.state[S.X]!;
    const z = this.state[S.Z]!;
    const dx = wp.x - x;
    const dz = wp.z - z;
    const d = Math.hypot(dx, dz);
    if (d < wp.orbitRadius * CAPTURE_FACTOR) {
      this.enterOrbit(wp);
    } else {
      this.mode = 'direct';
      this.apTarget.path = { kind: 'line', ox: x, oz: z, dx: dx / d, dz: dz / d };
    }
    this.apTarget.altitude = wp.altitude;
    return true;
  }

  /** Horizontal distance to the active waypoint [m]. */
  distanceToTarget(): number {
    return Math.hypot(this.target.x - this.state[S.X]!, this.target.z - this.state[S.Z]!);
  }

  /** Bearing from the aircraft to the active waypoint [rad from north]. */
  bearingToTarget(): number {
    return courseOf(this.target.x - this.state[S.X]!, this.target.z - this.state[S.Z]!);
  }

  /**
   * Advance by a frame's worth of wall-clock time. Returns the interpolation
   * factor in [0, 1) between the previous and current physics states.
   */
  advance(frameSeconds: number): number {
    // A long frame (tab switch, debugger) would otherwise demand hundreds of steps.
    this.accumulator += Math.min(Math.max(frameSeconds, 0), 0.25) * this.timeScale;
    let n = 0;
    while (this.accumulator >= this.dt && n < this.maxSubsteps) {
      this.step();
      this.accumulator -= this.dt;
      n++;
    }
    // Still behind after the step budget: drop the backlog rather than spiral.
    if (this.accumulator >= this.dt) this.accumulator = 0;
    return this.accumulator / this.dt;
  }

  /** Exactly one fixed physics step. */
  step(): void {
    this.prev.set(this.state);

    if (this.mode === 'direct' && this.distanceToTarget() < this.target.orbitRadius * CAPTURE_FACTOR) {
      this.enterOrbit(this.target);
    }

    if (this.steps % this.autopilotDivider === 0) {
      this.apTarget.altitude = this.altitudeCmd = this.clearedAltitude(this.target.altitude);
      this.autopilot.update(this.state, this.apTarget, this.dt * this.autopilotDivider, this.controls);
    }

    computeForces(this.params, this.state, this.forces);
    rk4Step(this.params, this.state, this.controls, this.dt, this.rk4);
    this.time += this.dt;
    this.steps++;
    this.recordHistory();
  }

  /** Pose between the last two physics states, for smooth rendering at any frame rate. */
  interpolate(alpha: number, out: RenderState): RenderState {
    const a = this.prev;
    const b = this.state;
    out.x = lerp(a[S.X]!, b[S.X]!, alpha);
    out.y = lerp(a[S.Y]!, b[S.Y]!, alpha);
    out.z = lerp(a[S.Z]!, b[S.Z]!, alpha);
    out.psi = lerpAngle(a[S.PSI]!, b[S.PSI]!, alpha);
    out.gamma = lerp(a[S.GAMMA]!, b[S.GAMMA]!, alpha);
    out.phi = lerp(a[S.PHI]!, b[S.PHI]!, alpha);
    out.alpha = lerp(a[S.ALPHA]!, b[S.ALPHA]!, alpha);
    out.thrust = lerp(a[S.THRUST]!, b[S.THRUST]!, alpha);
    return out;
  }

  private requireWaypoint(id: string): Waypoint {
    const wp = this.waypoints.find((w) => w.id === id);
    if (!wp) throw new Error(`Unknown waypoint: ${id}`);
    return wp;
  }

  private orbitAround(wp: Waypoint): OrbitPath {
    return { kind: 'orbit', cx: wp.x, cz: wp.z, radius: wp.orbitRadius, direction: 1 };
  }

  private enterOrbit(wp: Waypoint): void {
    this.mode = 'orbit';
    this.apTarget.path = this.orbitAround(wp);
  }

  /** The target altitude, raised if the terrain ahead would come within the clearance. */
  private clearedAltitude(altitude: number): number {
    const th = this.terrainHeight;
    if (!th) return altitude;
    const x = this.state[S.X]!;
    const z = this.state[S.Z]!;
    const psi = this.state[S.PSI]!;
    const ex = Math.sin(psi);
    const ez = -Math.cos(psi);
    let ground = -Infinity;
    for (const d of TERRAIN_LOOKAHEAD) ground = Math.max(ground, th(x + ex * d, z + ez * d));
    return Math.max(altitude, ground + this.terrainClearance);
  }

  /** Start on the hold already in a steady, trimmed turn, so there's no start-up transient. */
  private trimInOrbit(wp: Waypoint, bearing: number): void {
    const p = this.params;
    const s = this.state;
    const V = this.airspeed;
    const R = wp.orbitRadius;
    const rho = density(wp.altitude);
    const qS = 0.5 * rho * V * V * p.wingArea;
    const phi = Math.atan((V * V) / (ISA.g0 * R));
    const cl = (p.mass * ISA.g0) / Math.cos(phi) / qS;
    const drag = qS * (p.cd0 + inducedDragFactor(p) * cl * cl);

    s[S.X] = wp.x + R * Math.sin(bearing);
    s[S.Z] = wp.z - R * Math.cos(bearing);
    s[S.Y] = wp.altitude;
    s[S.V] = V;
    s[S.GAMMA] = 0;
    s[S.PSI] = bearing + Math.PI / 2;
    s[S.PHI] = phi;
    s[S.ALPHA] = (cl - p.cl0) / p.clAlpha;
    s[S.THRUST] = drag / availableThrust(p, rho);
    this.controls.bankCmd = phi;
    this.controls.alphaCmd = s[S.ALPHA]!;
    this.controls.throttle = s[S.THRUST]!;
  }

  private recordHistory(): void {
    if (--this.historyCountdown > 0) return;
    this.historyCountdown = Math.round(1 / (this.dt * HISTORY_RATE));
    const st = this.autopilot.status;
    const sample = this.history.next();
    sample.t = this.time;
    sample.altitudeError = st.altitudeError;
    sample.bank = this.state[S.PHI]!;
    sample.bankCmd = st.bankCmd;
    sample.trackError = st.trackError;
    sample.speedError = st.speedError;
  }
}

/** Fixed-capacity ring of preallocated samples: no allocation once running. */
export class SampleRing {
  private readonly items: Sample[];
  private head = 0;
  private count = 0;

  constructor(readonly capacity: number) {
    this.items = Array.from({ length: capacity }, () => ({
      t: 0,
      altitudeError: 0,
      bank: 0,
      bankCmd: 0,
      trackError: 0,
      speedError: 0,
    }));
  }

  get length(): number {
    return this.count;
  }

  /** The slot to overwrite with the newest sample. */
  next(): Sample {
    const item = this.items[this.head]!;
    this.head = (this.head + 1) % this.capacity;
    this.count = Math.min(this.count + 1, this.capacity);
    return item;
  }

  /** Oldest to newest. */
  forEach(fn: (s: Sample, i: number) => void): void {
    const start = (this.head - this.count + this.capacity) % this.capacity;
    for (let i = 0; i < this.count; i++) fn(this.items[(start + i) % this.capacity]!, i);
  }

  latest(): Sample | undefined {
    return this.count ? this.items[(this.head - 1 + this.capacity) % this.capacity] : undefined;
  }
}
