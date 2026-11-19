import { density, ISA } from './atmosphere';
import { type AircraftParams, TRANSPORT } from './aircraft';
import { Autopilot, type AutopilotGains, DEFAULT_GAINS } from './autopilot';
import {
  computeForces,
  type Controls,
  createContext,
  createControls,
  createForces,
  createState,
  type FlightContext,
  type Forces,
  groundVelocity,
  Rk4Workspace,
  rk4Step,
  S,
} from './dynamics';
import { Fms, type Phase } from './fms';
import { groundStep, runwayFrame } from './ground';
import { clamp, DEG, lerp, lerpAngle, wrapPi } from './math';
import { type Airport, type Fix, type Point, type Wind, windVector } from './navdata';
import { type FlightPlan, planFlight } from './planner';
import { Systems } from './systems';

/** Everything the simulation needs to know about the world it flies in. */
export interface NavWorld {
  airports: readonly Airport[];
  /** En-route fixes, in order from the first airport to the second. */
  route: readonly Fix[];
  /** Magnetic variation, east positive [rad]. */
  variation: number;
  terrain: (x: number, z: number) => number;
}

export interface SimulationOptions {
  world: NavWorld;
  params?: AircraftParams;
  gains?: AutopilotGains;
  /** Physics rate [Hz] and how often the autopilot runs (every Nth step). */
  rate?: number;
  autopilotDivider?: number;
  /** Weather for each flight; flight numbers count up from 0. */
  weather?: (flight: number) => Wind;
  /** Fuel loaded for each flight [kg]. */
  fuel?: number;
  /** Seconds to pre-simulate before the first frame (deterministic). */
  warmup?: number;
}

/** Interpolated pose and configuration for drawing a frame. */
export interface RenderState {
  x: number;
  y: number;
  z: number;
  psi: number;
  gamma: number;
  phi: number;
  alpha: number;
  thrust: number;
  flaps: number;
  gear: number;
  /** Control-surface deflections, −1..1 (aileron + = right wing down). */
  aileron: number;
  elevator: number;
  onGround: boolean;
  landingLights: boolean;
}

export function createRenderState(): RenderState {
  return { x: 0, y: 0, z: 0, psi: 0, gamma: 0, phi: 0, alpha: 0, thrust: 0, flaps: 0, gear: 1, aileron: 0, elevator: 0, onGround: true, landingLights: true };
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

const HISTORY_SECONDS = 30;
const HISTORY_RATE = 10;
const PARKED_SECONDS = 8;

/** Default simulated weather: mostly westerly, varying from flight to flight. */
export function defaultWeather(flight: number): Wind {
  let seed = (flight + 1) * 0x9e3779b1;
  const rand = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const from = (250 + (rand() - 0.5) * 80) * DEG;
  const speed = (4 + rand() * 10) * 0.514_444;
  return { from: (from + 2 * Math.PI) % (2 * Math.PI), speed };
}

/**
 * The aircraft, its systems, autopilot and FMS, flying planned flights back and forth
 * between the world's two airports, stepped at a fixed rate.
 *
 * Rendering calls `advance(frameSeconds)` once per animation frame. The simulation
 * runs as many fixed steps as that time covers, so the physics is identical at any
 * frame rate; the leftover fraction is returned for interpolation.
 */
export class FlightSimulation {
  readonly params: AircraftParams;
  readonly world: NavWorld;
  readonly dt: number;
  readonly autopilotDivider: number;
  readonly state = createState();
  readonly controls: Controls = createControls();
  readonly context: FlightContext;
  readonly forces: Forces = createForces();
  readonly autopilot: Autopilot;
  readonly fms: Fms;
  readonly systems: Systems;
  readonly history = new SampleRing(HISTORY_SECONDS * HISTORY_RATE);

  onGround = true;
  flight = 0;
  time = 0;
  steps = 0;
  /** Multiplier on real time (the engineering view can speed the sim up). */
  timeScale = 1;
  maxSubsteps = 12;
  /** Count of unplanned ground contacts (should stay zero). */
  incidents = 0;
  /** Called when a new flight is set up (the aircraft jumps to the next runway). */
  onNewFlight?: (plan: FlightPlan) => void;

  private readonly prev = createState();
  private prevFlaps = 0;
  private prevGear = 1;
  private readonly rk4 = new Rk4Workspace();
  private readonly weather: (flight: number) => Wind;
  private readonly fuelLoad: number;
  private originIndex = 0;
  private accumulator = 0;
  private historyCountdown = 0;

  constructor(opts: SimulationOptions) {
    this.params = opts.params ?? TRANSPORT;
    this.world = opts.world;
    this.dt = 1 / (opts.rate ?? 120);
    this.autopilotDivider = opts.autopilotDivider ?? 2;
    this.weather = opts.weather ?? defaultWeather;
    this.fuelLoad = opts.fuel ?? 8000;
    this.autopilot = new Autopilot(this.params, opts.gains ?? DEFAULT_GAINS);
    this.fms = new Fms(this.params);
    this.systems = new Systems(this.params, this.fuelLoad, this.world.airports[0]!.elevation);
    this.context = createContext(this.systems.mass());
    this.startFlight();
    if (opts.warmup) {
      const n = Math.round(opts.warmup / this.dt);
      for (let i = 0; i < n; i++) this.step();
    }
    this.prev.set(this.state);
  }

  get plan(): FlightPlan {
    return this.fms.plan;
  }

  get phase(): Phase {
    return this.fms.phase;
  }

  // ---- requests

  /** Hold over a fix or airport by ident, at the plan's cruise altitude. */
  holdAt(ident: string): boolean {
    const fix = this.findFix(ident);
    if (!fix) return false;
    this.fms.holdAt(fix, this.plan.cruiseAltitude);
    return true;
  }

  directTo(ident: string): boolean {
    return this.fms.directTo(ident, this.state);
  }

  resume(): void {
    this.fms.resume(this.state);
  }

  findFix(ident: string): Fix | undefined {
    const a = this.world.airports.find((ap) => ap.ident === ident);
    if (a) return { ident: a.ident, x: a.x, z: a.z };
    return this.world.route.find((f) => f.ident === ident);
  }

  // ---- stepping

  advance(frameSeconds: number): number {
    // A long frame (tab switch, debugger) would otherwise demand hundreds of steps.
    this.accumulator += Math.min(Math.max(frameSeconds, 0), 0.25) * this.timeScale;
    let n = 0;
    while (this.accumulator >= this.dt && n < this.maxSubsteps) {
      this.step();
      this.accumulator -= this.dt;
      n++;
    }
    if (this.accumulator >= this.dt) this.accumulator = 0;
    return this.accumulator / this.dt;
  }

  step(): void {
    this.prev.set(this.state);
    this.prevFlaps = this.systems.flaps;
    this.prevGear = this.systems.gear;
    const s = this.state;
    const ctx = this.context;
    const sys = this.systems;
    const terrain = this.world.terrain;

    // Slow-moving context: mass from fuel, configuration from the systems.
    ctx.mass = sys.mass();
    ctx.flaps = sys.flaps;
    ctx.gear = sys.gear;

    if (this.steps % this.autopilotDivider === 0) {
      const apDt = this.dt * this.autopilotDivider;
      this.fms.update(apDt, s, ctx, sys, terrain);
      this.autopilot.update(s, ctx, this.fms.targets, apDt, this.controls, this.onGround);
    }

    computeForces(this.params, s, ctx, this.forces);

    if (this.onGround) {
      const rw = this.fms.groundRunway;
      const r = groundStep(this.params, s, this.controls, ctx, runwayFrame(rw.heading, rw.elevation), this.dt);
      if (r.liftoff && this.fms.phase === 'takeoff') {
        this.onGround = false;
        this.fms.onLiftoff();
      } else if (r.stopped) {
        this.fms.onStopped();
      }
    } else {
      // Flare: align the nose with the runway (de-crab) before the wheels touch.
      if (this.fms.fma.vertical === 'FLARE') {
        const rwHeading = this.fms.arrivalRunway.heading;
        s[S.PSI] = s[S.PSI]! + clamp(wrapPi(rwHeading - s[S.PSI]!), -2.5 * DEG * this.dt, 2.5 * DEG * this.dt);
      }
      rk4Step(this.params, s, this.controls, ctx, this.dt, this.rk4);
      const wheel = s[S.Y]! - this.params.gearHeight - terrain(s[S.X]!, s[S.Z]!);
      if (wheel <= 0) this.contact(wheel);
    }

    if (this.fms.phase === 'parked' && this.fms.parkedTime >= PARKED_SECONDS) this.nextFlight();

    sys.update(this.dt, {
      altitude: s[S.Y]!,
      onGround: this.onGround,
      thrust: s[S.THRUST]!,
      landingElevation: this.plan.arrival.runway.elevation,
      descending: ['descent', 'approach', 'final', 'landing'].includes(this.fms.phase),
    });

    this.time += this.dt;
    this.steps++;
    this.recordHistory();
  }

  /** Wheels meet the ground: a landing if it's the arrival runway, otherwise an incident. */
  private contact(wheel: number): void {
    const s = this.state;
    const rw = this.fms.arrivalRunway;
    const along = (s[S.X]! - rw.threshold.x) * Math.sin(rw.heading) - (s[S.Z]! - rw.threshold.z) * Math.cos(rw.heading);
    const across = (s[S.X]! - rw.threshold.x) * Math.cos(rw.heading) + (s[S.Z]! - rw.threshold.z) * Math.sin(rw.heading);
    const onRunway = along > -50 && along < rw.length && Math.abs(across) < rw.width;
    if (!onRunway || this.fms.phase !== 'final') {
      this.incidents++;
      this.startFlight();
      return;
    }
    const sinkRate = -s[S.V]! * Math.sin(s[S.GAMMA]!);
    s[S.Y] = s[S.Y]! - wheel;
    s[S.GAMMA] = 0;
    // Snap onto the centreline over the rollout (a few metres of drift at most).
    s[S.X] = s[S.X]! - Math.cos(rw.heading) * across;
    s[S.Z] = s[S.Z]! - Math.sin(rw.heading) * across;
    this.onGround = true;
    this.fms.onTouchdown({ sinkRate, distance: along, speed: s[S.V]! * Math.sqrt(density(s[S.Y]!) / ISA.rho0) });
  }

  /** Set up the current flight from the current origin: refuel, line up, plan. */
  private startFlight(): void {
    const airports = this.world.airports;
    const origin = airports[this.originIndex % airports.length]!;
    const destination = airports[(this.originIndex + 1) % airports.length]!;
    const forward = this.originIndex % 2 === 0;
    const route = forward ? [...this.world.route] : [...this.world.route].reverse();
    this.systems.resetForFlight(this.fuelLoad, origin.elevation);
    const plan = planFlight({
      id: this.flight,
      origin,
      destination,
      route,
      wind: this.weather(this.flight),
      variation: this.world.variation,
      params: this.params,
      fuel: this.fuelLoad,
      terrain: this.world.terrain,
    });
    this.fms.load(plan, this.systems.mass());
    const w = windVector(plan.wind);
    this.context.windX = w.x;
    this.context.windZ = w.z;

    // Lined up on the departure runway, stopped, engines at idle.
    const rw = plan.departure.runway;
    const s = this.state;
    const headwind = -(w.x * Math.sin(rw.heading) - w.z * Math.cos(rw.heading));
    s[S.X] = rw.threshold.x + Math.sin(rw.heading) * 30;
    s[S.Z] = rw.threshold.z - Math.cos(rw.heading) * 30;
    s[S.Y] = rw.elevation + this.params.gearHeight;
    s[S.V] = Math.max(headwind, 0);
    s[S.GAMMA] = 0;
    s[S.PSI] = rw.heading;
    s[S.PHI] = 0;
    s[S.ALPHA] = 0;
    s[S.THRUST] = 0;
    this.systems.flaps = this.systems.flapsCmd = this.params.takeoffFlap;
    this.onGround = true;
    this.autopilot.reset();
    this.prev.set(s);
    this.onNewFlight?.(plan);
  }

  private nextFlight(): void {
    this.flight++;
    this.originIndex++;
    this.startFlight();
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
    out.flaps = lerp(this.prevFlaps, this.systems.flaps, alpha);
    out.gear = lerp(this.prevGear, this.systems.gear, alpha);
    out.aileron = clamp((this.controls.bankCmd - b[S.PHI]!) / (15 * DEG), -1, 1);
    out.elevator = clamp((this.controls.alphaCmd - b[S.ALPHA]!) / (4 * DEG), -1, 1);
    out.onGround = this.onGround;
    const p = this.fms.phase;
    out.landingLights = p === 'takeoff' || p === 'final' || p === 'landing' || (p === 'climb' && this.fms.wheelHeight < 900) || (p === 'approach' && this.systems.gear > 0.5);
    return out;
  }

  /** Ground track and speed right now. */
  groundVelocity() {
    return groundVelocity(this.state, this.context);
  }

  /** Horizontal distance from the aircraft to a point [m]. */
  distanceTo(p: Point): number {
    return Math.hypot(p.x - this.state[S.X]!, p.z - this.state[S.Z]!);
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

  next(): Sample {
    const item = this.items[this.head]!;
    this.head = (this.head + 1) % this.capacity;
    this.count = Math.min(this.count + 1, this.capacity);
    return item;
  }

  forEach(fn: (s: Sample, i: number) => void): void {
    const start = (this.head - this.count + this.capacity) % this.capacity;
    for (let i = 0; i < this.count; i++) fn(this.items[(start + i) % this.capacity]!, i);
  }

  latest(): Sample | undefined {
    return this.count ? this.items[(this.head - 1 + this.capacity) % this.capacity] : undefined;
  }
}
