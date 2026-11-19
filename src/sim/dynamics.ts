import { density, ISA } from './atmosphere';
import { type AircraftParams, cl0At, clMaxAt, inducedDragFactor } from './aircraft';
import { clamp } from './math';

/**
 * 3-DOF point-mass flight model in wind axes, flat non-rotating Earth, steady wind.
 *
 * Frame: x = east, y = up, z = south (right-handed, matching three.js' y-up).
 * Heading ψ is measured from true north, clockwise. V is true airspeed; the aircraft
 * moves through an air mass that itself drifts with the wind, so its ground track
 * differs from its heading (it crabs into a crosswind).
 *
 *   m·dV/dt          = T·cos α − D − m·g·sin γ
 *   m·V·dγ/dt        = (L + T·sin α)·cos φ − m·g·cos γ
 *   m·V·cos γ·dψ/dt  = (L + T·sin α)·sin φ
 *   dx/dt = V·cos γ·sin ψ + wind_x,   dz/dt = −V·cos γ·cos ψ + wind_z,   dy/dt = V·sin γ
 *
 * Bank φ, angle of attack α and engine output each follow their commands through a
 * first-order lag, standing in for the inner loops a full 6-DOF model would resolve.
 */

/** Indices into the state vector. */
export const S = {
  X: 0,
  Y: 1,
  Z: 2,
  /** true airspeed [m/s] */
  V: 3,
  /** flight-path angle relative to the air mass [rad], + climbing */
  GAMMA: 4,
  /** heading [rad], 0 = true north, clockwise */
  PSI: 5,
  /** bank angle [rad], + right wing down */
  PHI: 6,
  /** angle of attack [rad] */
  ALPHA: 7,
  /** engine output: 0..1 of available thrust, negative = reverse */
  THRUST: 8,
} as const;
export const STATE_SIZE = 9;

export type State = Float64Array;

export function createState(): State {
  return new Float64Array(STATE_SIZE);
}

/** Commands from the autopilot, held constant across an integration step. */
export interface Controls {
  bankCmd: number;
  alphaCmd: number;
  /** −1..1: negative selects reverse thrust (ground only). */
  throttle: number;
  /** 0..1 wheel braking (ground only). */
  brake: number;
}

export function createControls(): Controls {
  return { bankCmd: 0, alphaCmd: 0, throttle: 0, brake: 0 };
}

/** Quantities that change slowly and are held constant over a step. */
export interface FlightContext {
  mass: number;
  /** Flap position 0..1 and gear position 0 (up) .. 1 (down). */
  flaps: number;
  gear: number;
  /** Wind velocity (the direction the air moves toward) in the world frame [m/s]. */
  windX: number;
  windZ: number;
}

export function createContext(mass: number): FlightContext {
  return { mass, flaps: 0, gear: 0, windX: 0, windZ: 0 };
}

/** Aerodynamic and propulsive quantities, exposed for telemetry and the engineering view. */
export interface Forces {
  density: number;
  dynamicPressure: number;
  cl: number;
  cd: number;
  lift: number;
  drag: number;
  thrust: number;
  weight: number;
}

export function createForces(): Forces {
  return { density: 0, dynamicPressure: 0, cl: 0, cd: 0, lift: 0, drag: 0, thrust: 0, weight: 0 };
}

const MIN_AIRSPEED = 10;

/** Thrust at full power for a given density and true airspeed [N]. */
export function availableThrust(p: AircraftParams, rho: number, V: number): number {
  return p.maxThrust * Math.pow(rho / ISA.rho0, p.thrustLapse) * Math.max(0.3, 1 - p.thrustSpeedLapse * Math.max(V, 0));
}

/** Thrust for an engine output setting (negative = reverse) [N]. */
export function thrustFor(p: AircraftParams, setting: number, rho: number, V: number): number {
  return setting >= 0
    ? setting * availableThrust(p, rho, V)
    : setting * p.reverseFraction * p.maxThrust * Math.pow(rho / ISA.rho0, p.thrustLapse);
}

/** Evaluate the forces acting on the aircraft in state `s`. */
export function computeForces(p: AircraftParams, s: State, ctx: FlightContext, out: Forces): Forces {
  const rho = density(s[S.Y]!);
  const V = Math.max(s[S.V]!, 0);
  const q = 0.5 * rho * V * V;
  const cl = clamp(cl0At(p, ctx.flaps) + p.clAlpha * s[S.ALPHA]!, p.clMin, clMaxAt(p, ctx.flaps));
  const cd = p.cd0 + p.flapCd0 * ctx.flaps + p.gearCd0 * ctx.gear + inducedDragFactor(p) * cl * cl;
  out.density = rho;
  out.dynamicPressure = q;
  out.cl = cl;
  out.cd = cd;
  out.lift = q * p.wingArea * cl;
  out.drag = q * p.wingArea * cd;
  out.thrust = thrustFor(p, s[S.THRUST]!, rho, V);
  out.weight = ctx.mass * ISA.g0;
  return out;
}

const scratchForces = createForces();

/** ds/dt in flight, for state `s` under controls `c`. Writes into `out`; allocates nothing. */
export function derivatives(p: AircraftParams, s: State, c: Controls, ctx: FlightContext, out: State): void {
  const f = computeForces(p, s, ctx, scratchForces);
  const m = ctx.mass;
  const g = ISA.g0;
  const V = Math.max(s[S.V]!, MIN_AIRSPEED);
  const gamma = s[S.GAMMA]!;
  const psi = s[S.PSI]!;
  const phi = s[S.PHI]!;
  const alpha = s[S.ALPHA]!;
  const cosG = Math.cos(gamma);

  // Force normal to the flight path in the aircraft's plane of symmetry.
  const normal = f.lift + f.thrust * Math.sin(alpha);

  out[S.X] = V * cosG * Math.sin(psi) + ctx.windX;
  out[S.Y] = V * Math.sin(gamma);
  out[S.Z] = -V * cosG * Math.cos(psi) + ctx.windZ;
  out[S.V] = (f.thrust * Math.cos(alpha) - f.drag) / m - g * Math.sin(gamma);
  out[S.GAMMA] = (normal * Math.cos(phi) - m * g * cosG) / (m * V);
  out[S.PSI] = (normal * Math.sin(phi)) / (m * V * Math.max(cosG, 0.1));
  out[S.PHI] = clamp((c.bankCmd - phi) / p.rollTimeConstant, -p.maxRollRate, p.maxRollRate);
  out[S.ALPHA] = (c.alphaCmd - alpha) / p.alphaTimeConstant;
  out[S.THRUST] = (clamp(c.throttle, -1, 1) - s[S.THRUST]!) / p.engineTimeConstant;
}

/** Preallocated buffers for one RK4 step. */
export class Rk4Workspace {
  readonly k1 = createState();
  readonly k2 = createState();
  readonly k3 = createState();
  readonly k4 = createState();
  readonly tmp = createState();
}

/**
 * Classic fourth-order Runge–Kutta step, in place. Controls and context are held
 * constant over the step, like a digital flight control computer between frames.
 */
export function rk4Step(
  p: AircraftParams,
  s: State,
  c: Controls,
  ctx: FlightContext,
  dt: number,
  w: Rk4Workspace,
): void {
  const { k1, k2, k3, k4, tmp } = w;
  const n = STATE_SIZE;

  derivatives(p, s, c, ctx, k1);
  for (let i = 0; i < n; i++) tmp[i] = s[i]! + 0.5 * dt * k1[i]!;
  derivatives(p, tmp, c, ctx, k2);
  for (let i = 0; i < n; i++) tmp[i] = s[i]! + 0.5 * dt * k2[i]!;
  derivatives(p, tmp, c, ctx, k3);
  for (let i = 0; i < n; i++) tmp[i] = s[i]! + dt * k3[i]!;
  derivatives(p, tmp, c, ctx, k4);
  for (let i = 0; i < n; i++) {
    s[i] = s[i]! + (dt / 6) * (k1[i]! + 2 * k2[i]! + 2 * k3[i]! + k4[i]!);
  }
  s[S.THRUST] = clamp(s[S.THRUST]!, -1, 1);
}

/** Ground track [rad from true north] and ground speed [m/s] from the state and wind. */
export function groundVelocity(s: State, ctx: FlightContext): { track: number; speed: number; vx: number; vz: number } {
  const V = s[S.V]!;
  const cosG = Math.cos(s[S.GAMMA]!);
  const vx = V * cosG * Math.sin(s[S.PSI]!) + ctx.windX;
  const vz = -V * cosG * Math.cos(s[S.PSI]!) + ctx.windZ;
  return { track: Math.atan2(vx, -vz), speed: Math.hypot(vx, vz), vx, vz };
}
