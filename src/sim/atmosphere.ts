/**
 * International Standard Atmosphere (ISA), troposphere only (0–11 km).
 * SI units throughout. Reference: ICAO Doc 7488 / U.S. Standard Atmosphere 1976.
 */
export const ISA = {
  /** Sea-level temperature [K] */
  T0: 288.15,
  /** Sea-level pressure [Pa] */
  p0: 101_325,
  /** Sea-level density [kg/m^3] */
  rho0: 1.225,
  /** Temperature lapse rate [K/m] */
  lapse: 0.0065,
  /** Specific gas constant for dry air [J/(kg·K)] */
  R: 287.052_87,
  /** Standard gravity [m/s^2] */
  g0: 9.806_65,
  /** Ratio of specific heats for air */
  gamma: 1.4,
} as const;

/** g0 / (L·R) ≈ 5.2559: the exponent of the barometric formula in a linear-lapse layer. */
const BAROMETRIC_EXPONENT = ISA.g0 / (ISA.lapse * ISA.R);

export interface AirData {
  /** Static temperature [K] */
  temperature: number;
  /** Static pressure [Pa] */
  pressure: number;
  /** Density [kg/m^3] */
  density: number;
  /** Speed of sound [m/s] */
  speedOfSound: number;
}

function clampAltitude(h: number): number {
  return Math.min(Math.max(h, -500), 11_000);
}

/** Full air data at a geopotential altitude [m]. Pass `out` to avoid allocation. */
export function airData(altitude: number, out?: AirData): AirData {
  const h = clampAltitude(altitude);
  const T = ISA.T0 - ISA.lapse * h;
  const p = ISA.p0 * Math.pow(T / ISA.T0, BAROMETRIC_EXPONENT);
  const o = out ?? { temperature: 0, pressure: 0, density: 0, speedOfSound: 0 };
  o.temperature = T;
  o.pressure = p;
  o.density = p / (ISA.R * T);
  o.speedOfSound = Math.sqrt(ISA.gamma * ISA.R * T);
  return o;
}

/** Density only: the hot path for the flight model. Same formula, fewer outputs. */
export function density(altitude: number): number {
  const T = ISA.T0 - ISA.lapse * clampAltitude(altitude);
  return (ISA.p0 * Math.pow(T / ISA.T0, BAROMETRIC_EXPONENT)) / (ISA.R * T);
}
