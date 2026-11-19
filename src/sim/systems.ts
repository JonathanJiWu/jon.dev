import { airData, ISA } from './atmosphere';
import type { AircraftParams } from './aircraft';
import { clamp } from './math';

/**
 * Aircraft systems at the level the displays need: fuel, gear and flaps (which take
 * time to move), and cabin pressurization.
 *
 * The pressurization model is a deliberately simplified illustration of a closed-loop
 * auto-pressurization controller: engine bleed air flows in, an outflow valve lets air
 * out, and a PI controller positions the valve so the cabin follows a scheduled cabin
 * altitude within rate limits. It is not modelled on any real aircraft's system.
 */

const FT = 0.3048;
const FPM = FT / 60;

/** Pressure altitude for a static pressure [m] (inverse ISA troposphere). */
export function pressureAltitude(p: number): number {
  return (ISA.T0 / ISA.lapse) * (1 - Math.pow(p / ISA.p0, (ISA.lapse * ISA.R) / ISA.g0));
}

export interface CabinState {
  /** Cabin static pressure [Pa]. */
  pressure: number;
  /** Cabin pressure altitude [m] and its rate of change, as the lagged gauge shows it [m/s]. */
  altitude: number;
  rate: number;
  /** Outflow valve, 0 closed .. 1 fully open. */
  valve: number;
  /** Differential pressure, cabin minus outside [Pa]. */
  differential: number;
  /** The rate-limited cabin altitude the controller is following [m]. */
  reference: number;
}

export interface SystemsInput {
  altitude: number;
  onGround: boolean;
  /** Engine output setting (state), −1..1. */
  thrust: number;
  /** Elevation of the airport the aircraft will land at [m]. */
  landingElevation: number;
  /** True once descent toward landing has begun. */
  descending: boolean;
}

// Cabin model constants (generic, round numbers).
const CABIN_VOLUME = 130; // m^3
const BLEED_INFLOW = 1.0; // kg/s with engines running
const OUTFLOW_AREA = 0.1; // m^2 fully open: vents full bleed flow at ~0.05 psi
const DISCHARGE = 0.6;
const MAX_DIFFERENTIAL = 7.5 * 6894.76; // 7.5 psi
const CABIN_CLIMB_LIMIT = 500 * FPM;
const CABIN_DESCENT_LIMIT = 350 * FPM;
const MAX_CABIN_ALTITUDE = 8000 * FT;
const CABIN_TEMPERATURE = 293; // K

export class Systems {
  fuel: number;
  readonly initialFuel: number;
  gear = 1;
  gearCmd: 0 | 1 = 1;
  flaps = 0;
  flapsCmd = 0;
  readonly cabin: CabinState;
  private valveIntegral = 0;

  constructor(
    private readonly p: AircraftParams,
    fuel: number,
    fieldElevation: number,
  ) {
    this.fuel = this.initialFuel = fuel;
    const amb = airData(fieldElevation).pressure;
    this.cabin = { pressure: amb, altitude: fieldElevation, rate: 0, valve: 1, differential: 0, reference: fieldElevation };
  }

  get fuelUsed(): number {
    return this.initialFuel - this.fuel;
  }

  /** Total fuel flow [kg/h] for an engine output setting. */
  fuelFlow(thrust: number): number {
    const p = this.p;
    return p.engines * (p.fuelFlowIdle + (p.fuelFlowMax - p.fuelFlowIdle) * Math.min(Math.abs(thrust), 1));
  }

  mass(): number {
    return this.p.emptyMass + this.p.payload + this.fuel;
  }

  /** Reset for a new flight (refuelled, gear down, cabin open to the field). */
  resetForFlight(fuel: number, fieldElevation: number): void {
    this.fuel = fuel;
    this.gear = 1;
    this.gearCmd = 1;
    const amb = airData(fieldElevation).pressure;
    Object.assign(this.cabin, { pressure: amb, altitude: fieldElevation, rate: 0, valve: 1, differential: 0, reference: fieldElevation });
    this.valveIntegral = 0;
  }

  update(dt: number, input: SystemsInput): void {
    const p = this.p;
    // Fuel
    this.fuel = Math.max(0, this.fuel - (this.fuelFlow(input.thrust) / 3600) * dt);

    // Gear and flaps travel at a fixed rate toward their commands.
    this.gear = moveToward(this.gear, this.gearCmd, dt / p.gearTransitTime);
    this.flaps = moveToward(this.flaps, this.flapsCmd, dt / p.flapTransitTime);

    this.updateCabin(dt, input);
  }

  private updateCabin(dt: number, input: SystemsInput): void {
    const c = this.cabin;
    const outside = airData(input.altitude);
    // On the takeoff roll the controller already runs, holding the cabin a little below
    // the field (pre-pressurization), so there is no pressure bump at lift-off.
    const takeoffRoll = input.onGround && input.thrust > 0.6;

    if (input.onGround && !takeoffRoll) {
      // Unpressurized on the ground: the valve drives open and the cabin vents to the
      // outside, no faster than the cabin rate limits.
      c.valve = 1;
      this.valveIntegral = 0;
      const toOutside = pressureAltitude(outside.pressure) - c.altitude;
      c.pressure = airData(c.altitude + clamp(toOutside, -CABIN_DESCENT_LIMIT * dt, CABIN_CLIMB_LIMIT * dt)).pressure;
      c.reference = pressureAltitude(c.pressure);
    } else {
      // Schedule: climb the cabin to a fraction of aircraft altitude; in descent, bring it
      // down to just below the landing field so the cabin is open to it on touchdown.
      const scheduled = takeoffRoll
        ? input.altitude - 60
        : input.descending
          ? input.landingElevation - 60
          : clamp(input.altitude * 0.3, input.landingElevation - 60, MAX_CABIN_ALTITUDE);
      // Never let the differential exceed its limit.
      const minByDifferential = pressureAltitude(outside.pressure + MAX_DIFFERENTIAL);
      const target = Math.max(scheduled, minByDifferential);
      c.reference += clamp(target - c.reference, -CABIN_DESCENT_LIMIT * dt, CABIN_CLIMB_LIMIT * dt);

      // Reference cabin pressure and the valve position that would hold it in steady state.
      const pRef = airData(c.reference).pressure;
      const dpRef = Math.max(pRef - outside.pressure, 200);
      const rhoRef = pRef / (ISA.R * CABIN_TEMPERATURE);
      const feedforward = BLEED_INFLOW / (DISCHARGE * OUTFLOW_AREA * Math.sqrt(2 * rhoRef * dpRef));
      // Too much pressure in the cabin → open the valve.
      const error = (c.pressure - pRef) / 1000;
      const unclamped = feedforward + 1.2 * error + 0.4 * this.valveIntegral;
      c.valve = clamp(unclamped, 0, 1);
      if (c.valve === unclamped) this.valveIntegral += error * dt;

      // Mass balance: dp/dt = (R·T / V)·(ṁ_in − ṁ_out). Air leaves through the valve at
      // the cabin's density, driven by the differential.
      const rho = c.pressure / (ISA.R * CABIN_TEMPERATURE);
      const dp = Math.max(c.pressure - outside.pressure, 0);
      const outflow = DISCHARGE * OUTFLOW_AREA * c.valve * Math.sqrt(2 * rho * dp);
      const inflow = input.thrust > -0.05 ? BLEED_INFLOW : 0;
      c.pressure += ((ISA.R * CABIN_TEMPERATURE) / CABIN_VOLUME) * (inflow - outflow) * dt;
    }

    const previous = c.altitude;
    c.altitude = pressureAltitude(c.pressure);
    // The rate gauge, like any vertical-speed indicator, is lagged (τ = 1.5 s).
    const instantaneous = dt > 0 ? (c.altitude - previous) / dt : 0;
    c.rate += (instantaneous - c.rate) * (1 - Math.exp(-dt / 1.5));
    c.differential = c.pressure - outside.pressure;
  }
}

function moveToward(value: number, target: number, maxStep: number): number {
  return value < target ? Math.min(target, value + maxStep) : Math.max(target, value - maxStep);
}
