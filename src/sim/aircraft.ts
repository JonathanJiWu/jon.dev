import { ISA } from './atmosphere';
import { DEG } from './math';

/**
 * Parameters for the point-mass flight model.
 *
 * They describe a *generic* four-engine turboprop transport. The numbers are
 * representative of the class (round values in line with public figures for aircraft
 * of this size), not certified data for any real type.
 */
export interface AircraftParams {
  /** Operating empty mass, crew included [kg]. */
  emptyMass: number;
  payload: number;
  /** Usable fuel capacity [kg]. */
  fuelCapacity: number;

  wingArea: number; // m^2
  span: number; // m
  oswald: number;

  /** Clean-wing lift: CL = cl0 + clAlpha·α, limited to [clMin, clMax]. */
  cl0: number;
  clAlpha: number;
  clMax: number;
  clMin: number;
  cd0: number;
  /** Increments at full flap (scaled by flap position 0..1). */
  flapCl0: number;
  flapClMax: number;
  flapCd0: number;
  /** Drag increment with the gear down. */
  gearCd0: number;

  engines: number;
  /** Total static thrust at sea level, full power [N]. */
  maxThrust: number;
  /** Thrust ~ (ρ/ρ0)^thrustLapse. */
  thrustLapse: number;
  /** Propeller thrust falls with speed: × (1 − thrustSpeedLapse·V). */
  thrustSpeedLapse: number;
  /** Maximum reverse thrust as a fraction of static thrust. */
  reverseFraction: number;
  engineTimeConstant: number; // s
  /** Fuel flow per engine at idle and at full power [kg/h]. */
  fuelFlowIdle: number;
  fuelFlowMax: number;

  /** Bank response: first-order lag [s] with a roll-rate limit [rad/s]. */
  rollTimeConstant: number;
  maxRollRate: number;
  /** Angle-of-attack response, a stand-in for the short-period dynamics [s]. */
  alphaTimeConstant: number;
  alphaCmdMin: number;
  alphaCmdMax: number;

  /** Height of the centre of gravity above the runway on the wheels [m]. */
  gearHeight: number;
  rollingFriction: number;
  brakingFriction: number;
  /** Body angle for rotation and the lift-off attitude [rad]. */
  rotationAlpha: number;
  /** Gear cycle time and flap travel time, full range [s]. */
  gearTransitTime: number;
  flapTransitTime: number;

  /** Speed schedule, indicated airspeed [m/s]. */
  climbSpeed: number;
  cruiseSpeed: number;
  descentSpeed: number;
  holdingSpeed: number;
  approachSpeed: number;
  /** Flap position used for takeoff and for the initial approach. */
  takeoffFlap: number;
  approachFlap: number;
  /** Climb power setting (fraction of maximum). */
  climbThrust: number;
}

const KT = 0.514_444;

export const TRANSPORT: AircraftParams = {
  emptyMass: 36_000,
  payload: 9000,
  fuelCapacity: 20_000,
  wingArea: 160,
  span: 40,
  oswald: 0.8,
  cl0: 0.3,
  clAlpha: 5.2,
  clMax: 1.4,
  clMin: -0.6,
  cd0: 0.026,
  flapCl0: 0.35,
  flapClMax: 0.9,
  flapCd0: 0.045,
  gearCd0: 0.018,
  engines: 4,
  maxThrust: 160_000,
  thrustLapse: 0.8,
  thrustSpeedLapse: 0.0018,
  reverseFraction: 0.35,
  engineTimeConstant: 1.5,
  fuelFlowIdle: 150,
  fuelFlowMax: 1050,
  rollTimeConstant: 0.8,
  maxRollRate: 12 * DEG,
  alphaTimeConstant: 0.4,
  alphaCmdMin: -4 * DEG,
  alphaCmdMax: 12 * DEG,
  gearHeight: 3.2,
  rollingFriction: 0.02,
  brakingFriction: 0.35,
  rotationAlpha: 8 * DEG,
  gearTransitTime: 10,
  flapTransitTime: 15,
  climbSpeed: 170 * KT,
  cruiseSpeed: 210 * KT,
  descentSpeed: 180 * KT,
  holdingSpeed: 170 * KT,
  approachSpeed: 150 * KT,
  takeoffFlap: 0.5,
  approachFlap: 0.5,
  climbThrust: 0.78,
};

export function aspectRatio(p: AircraftParams): number {
  return (p.span * p.span) / p.wingArea;
}

/** Induced drag factor k in CD = CD0 + k·CL². */
export function inducedDragFactor(p: AircraftParams): number {
  return 1 / (Math.PI * p.oswald * aspectRatio(p));
}

export function clMaxAt(p: AircraftParams, flap: number): number {
  return p.clMax + p.flapClMax * flap;
}

export function cl0At(p: AircraftParams, flap: number): number {
  return p.cl0 + p.flapCl0 * flap;
}

/** Angle of attack at which the (linear) lift curve reaches CLmax, clean [rad]. */
export function stallAlpha(p: AircraftParams, flap = 0): number {
  return (clMaxAt(p, flap) - cl0At(p, flap)) / p.clAlpha;
}

/**
 * 1-g stall speed as equivalent (≈ indicated) airspeed [m/s]. Indicated airspeed is
 * what the wing feels, so stall IAS doesn't change with altitude.
 */
export function stallSpeed(p: AircraftParams, mass: number, flap: number): number {
  return Math.sqrt((2 * mass * ISA.g0) / (ISA.rho0 * p.wingArea * clMaxAt(p, flap)));
}

/** Reference speeds from the stall speeds, with the usual certification-style margins. */
export function vSpeeds(p: AircraftParams, mass: number) {
  const vsTakeoff = stallSpeed(p, mass, p.takeoffFlap);
  const vsLanding = stallSpeed(p, mass, 1);
  return {
    vsClean: stallSpeed(p, mass, 0),
    vsTakeoff,
    vsLanding,
    /** Rotation. */
    vr: 1.1 * vsTakeoff,
    /** Takeoff safety speed. */
    v2: 1.2 * vsTakeoff,
    /** Landing reference speed. */
    vref: 1.3 * vsLanding,
  };
}
