import { density, ISA } from './atmosphere';
import { type AircraftParams, inducedDragFactor } from './aircraft';
import { clamp } from './math';

/**
 * 3-DOF point-mass flight model in wind axes, flat non-rotating Earth, no wind.
 *
 * Frame: x = east, y = up, z = south (right-handed, and matches three.js' y-up).
 * Heading ψ is measured from north, clockwise (east = +π/2). With no wind and no
 * sideslip, heading and course coincide.
 *
 *   m·dV/dt    = T·cos α − D − m·g·sin γ
 *   m·V·dγ/dt  = (L + T·sin α)·cos φ − m·g·cos γ
 *   m·V·cos γ·dψ/dt = (L + T·sin α)·sin φ
 *
 * Bank φ, angle of attack α and engine output are not free rigid-body states here.
 * Each follows its command through a first-order lag, standing in for the inner
 * attitude loops and short-period dynamics a full 6-DOF model would resolve.
 */

/** Indices into the state vector. */
export const S = {
  X: 0,
  Y: 1,
  Z: 2,
  /** true airspeed [m/s] */
  V: 3,
  /** flight-path angle [rad], + climbing */
  GAMMA: 4,
  /** heading [rad], 0 = north, clockwise */
  PSI: 5,
  /** bank angle [rad], + right wing down */
  PHI: 6,
  /** angle of attack [rad] */
  ALPHA: 7,
  /** engine output, 0..1 of available thrust */
  THRUST: 8,
} as const;
export const STATE_SIZE = 9;

export type State = Float64Array;

export function createState(): State {
  return new Float64Array(STATE_SIZE);
}

/** Inputs from the autopilot, held constant across one integration step (zero-order hold). */
export interface Controls {
  bankCmd: number;
  alphaCmd: number;
  throttle: number;
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

/** Evaluate the forces acting on the aircraft in state `s`. */
export function computeForces(p: AircraftParams, s: State, out: Forces): Forces {
  const rho = density(s[S.Y]!);
  const V = Math.max(s[S.V]!, MIN_AIRSPEED);
  const q = 0.5 * rho * V * V;
  const cl = clamp(p.cl0 + p.clAlpha * s[S.ALPHA]!, p.clMin, p.clMax);
  const cd = p.cd0 + inducedDragFactor(p) * cl * cl;
  out.density = rho;
  out.dynamicPressure = q;
  out.cl = cl;
  out.cd = cd;
  out.lift = q * p.wingArea * cl;
  out.drag = q * p.wingArea * cd;
  out.thrust = s[S.THRUST]! * availableThrust(p, rho);
  out.weight = p.mass * ISA.g0;
  return out;
}

/** Full-throttle thrust at a given air density [N]. */
export function availableThrust(p: AircraftParams, rho: number): number {
  return p.maxThrust * Math.pow(rho / ISA.rho0, p.thrustLapse);
}

const scratchForces = createForces();

/** ds/dt for state `s` under controls `c`. Writes into `out`; allocates nothing. */
export function derivatives(p: AircraftParams, s: State, c: Controls, out: State): void {
  const f = computeForces(p, s, scratchForces);
  const m = p.mass;
  const g = ISA.g0;
  const V = Math.max(s[S.V]!, MIN_AIRSPEED);
  const gamma = s[S.GAMMA]!;
  const psi = s[S.PSI]!;
  const phi = s[S.PHI]!;
  const alpha = s[S.ALPHA]!;
  const cosG = Math.cos(gamma);

  // Force normal to the flight path in the aircraft's plane of symmetry.
  const normal = f.lift + f.thrust * Math.sin(alpha);

  out[S.X] = V * cosG * Math.sin(psi);
  out[S.Y] = V * Math.sin(gamma);
  out[S.Z] = -V * cosG * Math.cos(psi);
  out[S.V] = (f.thrust * Math.cos(alpha) - f.drag) / m - g * Math.sin(gamma);
  out[S.GAMMA] = (normal * Math.cos(phi) - m * g * cosG) / (m * V);
  out[S.PSI] = (normal * Math.sin(phi)) / (m * V * Math.max(cosG, 0.1));
  out[S.PHI] = clamp((c.bankCmd - phi) / p.rollTimeConstant, -p.maxRollRate, p.maxRollRate);
  out[S.ALPHA] = (c.alphaCmd - alpha) / p.alphaTimeConstant;
  out[S.THRUST] = (clamp(c.throttle, 0, 1) - s[S.THRUST]!) / p.engineTimeConstant;
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
 * Classic fourth-order Runge–Kutta step, in place. Controls are held constant over
 * the step, like a digital flight control computer's output between frames.
 */
export function rk4Step(p: AircraftParams, s: State, c: Controls, dt: number, w: Rk4Workspace): void {
  const { k1, k2, k3, k4, tmp } = w;
  const n = STATE_SIZE;

  derivatives(p, s, c, k1);
  for (let i = 0; i < n; i++) tmp[i] = s[i]! + 0.5 * dt * k1[i]!;
  derivatives(p, tmp, c, k2);
  for (let i = 0; i < n; i++) tmp[i] = s[i]! + 0.5 * dt * k2[i]!;
  derivatives(p, tmp, c, k3);
  for (let i = 0; i < n; i++) tmp[i] = s[i]! + dt * k3[i]!;
  derivatives(p, tmp, c, k4);
  for (let i = 0; i < n; i++) {
    s[i] = s[i]! + (dt / 6) * (k1[i]! + 2 * k2[i]! + 2 * k3[i]! + k4[i]!);
  }
  s[S.THRUST] = clamp(s[S.THRUST]!, 0, 1);
}
