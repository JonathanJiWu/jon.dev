import { ISA } from './atmosphere';
import type { AircraftParams } from './aircraft';
import { computeForces, type Controls, createForces, type FlightContext, S, type State } from './dynamics';
import { clamp } from './math';

/**
 * Takeoff and landing roll. On the wheels the aircraft is constrained to the runway
 * centreline: wings level, flight-path angle zero, heading along the runway. What's
 * left is one axis:
 *
 *   m·dVg/dt = T·cos α − D − μ·N − μ_brake·brake·N,   N = W − L − T·sin α ≥ 0
 *
 * Integrated with semi-implicit Euler: the motion is slow and the discontinuities
 * (lift-off, stopping) make a higher-order method pointless here.
 */

export interface RunwayFrame {
  /** Runway heading [rad true] and its unit vector in x/z. */
  heading: number;
  ex: number;
  ez: number;
  /** Surface elevation [m]. */
  elevation: number;
}

export function runwayFrame(heading: number, elevation: number): RunwayFrame {
  return { heading, ex: Math.sin(heading), ez: -Math.cos(heading), elevation };
}

const forces = createForces();

export interface GroundResult {
  liftoff: boolean;
  stopped: boolean;
  /** Ground speed along the runway [m/s]. */
  groundSpeed: number;
  normalForce: number;
}

const result: GroundResult = { liftoff: false, stopped: false, groundSpeed: 0, normalForce: 0 };

export function groundStep(
  p: AircraftParams,
  s: State,
  c: Controls,
  ctx: FlightContext,
  rw: RunwayFrame,
  dt: number,
): GroundResult {
  // Headwind component along the runway: airspeed = ground speed + headwind.
  const headwind = -(ctx.windX * rw.ex + ctx.windZ * rw.ez);

  s[S.GAMMA] = 0;
  s[S.PHI] = 0;
  s[S.PSI] = rw.heading;
  s[S.Y] = rw.elevation + p.gearHeight;

  // Engine and pitch respond as in flight; pitch can't go below the ground attitude.
  s[S.THRUST] = clamp(s[S.THRUST]! + ((clamp(c.throttle, -1, 1) - s[S.THRUST]!) / p.engineTimeConstant) * dt, -1, 1);
  s[S.ALPHA] = clamp(s[S.ALPHA]! + ((c.alphaCmd - s[S.ALPHA]!) / p.alphaTimeConstant) * dt, 0, p.rotationAlpha + 0.03);

  const f = computeForces(p, s, ctx, forces);
  const W = ctx.mass * ISA.g0;
  const support = f.lift + f.thrust * Math.sin(s[S.ALPHA]!);
  const normal = Math.max(0, W - support);
  const friction = (p.rollingFriction + clamp(c.brake, 0, 1) * p.brakingFriction) * normal;

  let groundSpeed = s[S.V]! - headwind;
  const accel = (f.thrust * Math.cos(s[S.ALPHA]!) - f.drag - Math.sign(groundSpeed || 1) * friction) / ctx.mass;
  groundSpeed += accel * dt;

  let stopped = false;
  // Friction can stop the aircraft but never push it backward.
  if (groundSpeed <= 0 && f.thrust <= friction) {
    groundSpeed = 0;
    stopped = true;
  }
  s[S.V] = groundSpeed + headwind;
  s[S.X] = s[S.X]! + rw.ex * groundSpeed * dt;
  s[S.Z] = s[S.Z]! + rw.ez * groundSpeed * dt;

  result.liftoff = support > W && groundSpeed > 20;
  result.stopped = stopped;
  result.groundSpeed = groundSpeed;
  result.normalForce = normal;
  return result;
}
