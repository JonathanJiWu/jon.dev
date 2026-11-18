import { DEG } from './math';

/**
 * Parameters for the point-mass flight model.
 *
 * These describe a *generic* four-engine turboprop transport with round, plausible
 * numbers. They are illustrative, not data for any real aircraft type.
 */
export interface AircraftParams {
  mass: number; // kg
  wingArea: number; // m^2
  span: number; // m
  /** Lift coefficient at zero angle of attack (camber). */
  cl0: number;
  /** Lift-curve slope [1/rad]. */
  clAlpha: number;
  clMax: number;
  clMin: number;
  /** Zero-lift drag coefficient. */
  cd0: number;
  /** Oswald span efficiency, for induced drag. */
  oswald: number;
  /** Total installed thrust at sea level, full throttle [N]. */
  maxThrust: number;
  /** Thrust ~ (rho/rho0)^thrustLapse. */
  thrustLapse: number;
  /** Bank response: first-order lag [s] with a roll-rate limit [rad/s]. */
  rollTimeConstant: number;
  maxRollRate: number;
  /** Angle-of-attack response (a stand-in for short-period dynamics) [s]. */
  alphaTimeConstant: number;
  /** Engine/propeller spool response [s]. */
  engineTimeConstant: number;
  /** Controller limits on commanded angle of attack [rad]. */
  alphaCmdMin: number;
  alphaCmdMax: number;
}

export const TRANSPORT: AircraftParams = {
  mass: 42_000,
  wingArea: 160,
  span: 40,
  cl0: 0.3,
  clAlpha: 5.2,
  clMax: 1.4,
  clMin: -0.6,
  cd0: 0.028,
  oswald: 0.8,
  maxThrust: 120_000,
  thrustLapse: 0.8,
  rollTimeConstant: 0.8,
  maxRollRate: 12 * DEG,
  alphaTimeConstant: 0.4,
  engineTimeConstant: 1.5,
  alphaCmdMin: -4 * DEG,
  alphaCmdMax: 10 * DEG,
};

export function aspectRatio(p: AircraftParams): number {
  return (p.span * p.span) / p.wingArea;
}

/** Induced drag factor k in CD = CD0 + k·CL². */
export function inducedDragFactor(p: AircraftParams): number {
  return 1 / (Math.PI * p.oswald * aspectRatio(p));
}

/** Angle of attack at which the (linear) lift curve reaches CLmax [rad]. */
export function stallAlpha(p: AircraftParams): number {
  return (p.clMax - p.cl0) / p.clAlpha;
}
