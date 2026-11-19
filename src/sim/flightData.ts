import { airData, ISA } from './atmosphere';
import { stallSpeed } from './aircraft';
import { S } from './dynamics';
import type { Fma, Phase } from './fms';
import { clamp, DEG, wrapPi } from './math';
import { bearing, toMagnetic } from './navdata';
import type { FlightPlan } from './planner';
import type { FlightSimulation } from './simulation';
import { M_TO_FT, M_TO_NM, MS_TO_FPM, MS_TO_KT } from './units';

/**
 * One snapshot of everything the instruments show, in cockpit units, built from the
 * simulation once per frame. Every display (the page's readouts, the engineering view,
 * the cockpit's PFD, ND, EICAS, MFD and CDU) reads this object and nothing else, so
 * no two instruments can disagree.
 *
 * Units: knots, feet, feet per minute, nautical miles, degrees, kilograms, seconds.
 * Headings and tracks are magnetic, like the cockpit; the `*True` fields are radians
 * from true north for drawing in the world frame.
 */

export interface EngineData {
  /** Torque [% of maximum]. */
  torque: number;
  /** Turbine gas temperature [°C]. */
  tgt: number;
  /** Gas-generator speed [%] and propeller speed [%]. */
  nh: number;
  np: number;
  /** Fuel flow [kg/h]. */
  fuelFlow: number;
  reverse: boolean;
}

export interface FlightData {
  flight: number;
  phase: Phase;
  fma: Fma;
  /** Simulated clock, seconds since midnight. */
  clock: number;
  onGround: boolean;
  /** Position in the world frame [m] (x east, z south), for maps and distances. */
  x: number;
  z: number;

  // Air data
  ias: number;
  tas: number;
  groundSpeed: number;
  mach: number;
  /** IAS change expected over the next 10 s [kt]. */
  speedTrend: number;
  altitude: number;
  /** Wheel height above the ground [ft]. */
  radioAltitude: number;
  verticalSpeed: number;
  /** Outside air temperature [°C] and altimeter setting [inHg]. */
  oat: number;
  altimeter: number;

  // Attitude and direction
  pitch: number;
  bank: number;
  /** Flight-path angle and angle of attack [deg]. */
  fpa: number;
  aoa: number;
  heading: number;
  track: number;
  headingTrue: number;
  trackTrue: number;
  /** Wind from [deg magnetic] and speed [kt]; components on the current heading. */
  windFrom: number;
  windSpeed: number;
  headwind: number;
  crosswind: number;

  /** Flight director: the pitch attitude and bank the autopilot is commanding [deg]. */
  fdPitch: number;
  fdBank: number;

  // Autoflight targets (what the mode control panel would show)
  selectedSpeed: number;
  selectedAltitude: number;
  selectedCourse: number;

  // Reference speeds [kt IAS]
  vr: number;
  v2: number;
  vref: number;
  vapp: number;
  /** 1-g stall speed in the current configuration and weight. */
  vStall: number;
  /** Maximum operating speed. */
  vmo: number;

  // Navigation
  activeLeg: number;
  activeIdent: string;
  /** Distance and time to the active fix, and to the destination [NM, s]. */
  toActive: number;
  eteActive: number;
  toDestination: number;
  eteDestination: number;
  etaDestination: number;
  /** Cross-track error [NM], + right of course. */
  crossTrack: number;
  desiredTrack: number;
  /** Deviation from the vertical path in use [ft], + above. */
  verticalDeviation: number;
  /** On final: lateral and vertical deviation in dots (±2 full scale), or null. */
  lateralDots: number | null;
  verticalDots: number | null;

  // Engines and fuel
  engines: EngineData[];
  /** Engine output setting, −1 (full reverse) … 1. */
  powerSetting: number;
  fuel: number;
  fuelUsed: number;
  fuelFlow: number;
  /** Time until the tanks are dry at the present flow [s]. */
  endurance: number;
  /** Fuel expected on arrival at the destination [kg]. */
  fuelAtDestination: number;
  reserveFuel: number;
  grossWeight: number;

  // Configuration
  /** Flap position 0..1 and its command; gear position 0 (up) .. 1 (down) and command. */
  flaps: number;
  flapsCmd: number;
  gear: number;
  gearCmd: number;
  /** Autobrake deceleration in use [m/s²], 0 = off. */
  autobrake: number;
  landingLights: boolean;

  // Pressurization
  cabinAltitude: number;
  cabinRate: number;
  /** Differential pressure [psi] and outflow valve position [%]. */
  cabinDifferential: number;
  outflowValve: number;
  landingElevation: number;

  /** The plan being flown (shared, not copied). */
  plan: FlightPlan;
}

/** 10° W variation turns 260° true into 270° magnetic. */
const magDeg = (rad: number, variation: number) => toMagnetic(rad, variation) / DEG;

const PSI = 6894.757;
/** The sim clock starts at 19:20 (dusk, matching the sun). */
const CLOCK_EPOCH = 19 * 3600 + 20 * 60;
const VMO = 250;

/**
 * Per-engine offsets so four gauges fed by one engine model aren't identical, as real
 * engines never are. Purely cosmetic: the model has a single engine state.
 */
const ENGINE_TRIM = [
  { torque: 0.4, tgt: 6 },
  { torque: -0.3, tgt: -4 },
  { torque: 0.2, tgt: 3 },
  { torque: -0.5, tgt: -7 },
];

export function createFlightData(plan: FlightPlan): FlightData {
  return {
    flight: 0,
    phase: 'takeoff',
    fma: { thrust: '', lateral: '', vertical: '' },
    clock: CLOCK_EPOCH,
    onGround: true,
    x: 0,
    z: 0,
    ias: 0,
    tas: 0,
    groundSpeed: 0,
    mach: 0,
    speedTrend: 0,
    altitude: 0,
    radioAltitude: 0,
    verticalSpeed: 0,
    oat: 15,
    altimeter: 29.92,
    pitch: 0,
    bank: 0,
    fpa: 0,
    aoa: 0,
    heading: 0,
    track: 0,
    headingTrue: 0,
    trackTrue: 0,
    windFrom: 0,
    windSpeed: 0,
    headwind: 0,
    crosswind: 0,
    fdPitch: 0,
    fdBank: 0,
    selectedSpeed: 0,
    selectedAltitude: 0,
    selectedCourse: 0,
    vr: 0,
    v2: 0,
    vref: 0,
    vapp: 0,
    vStall: 0,
    vmo: VMO,
    activeLeg: 0,
    activeIdent: '',
    toActive: 0,
    eteActive: 0,
    toDestination: 0,
    eteDestination: 0,
    etaDestination: 0,
    crossTrack: 0,
    desiredTrack: 0,
    verticalDeviation: 0,
    lateralDots: null,
    verticalDots: null,
    engines: ENGINE_TRIM.map(() => ({ torque: 0, tgt: 0, nh: 0, np: 0, fuelFlow: 0, reverse: false })),
    powerSetting: 0,
    fuel: 0,
    fuelUsed: 0,
    fuelFlow: 0,
    endurance: 0,
    fuelAtDestination: 0,
    reserveFuel: 0,
    grossWeight: 0,
    flaps: 0,
    flapsCmd: 0,
    gear: 1,
    gearCmd: 1,
    autobrake: 0,
    landingLights: false,
    cabinAltitude: 0,
    cabinRate: 0,
    cabinDifferential: 0,
    outflowValve: 100,
    landingElevation: 0,
    plan,
  };
}

/**
 * Builds FlightData from a simulation. Keeps a little state of its own (the speed trend
 * is a filtered derivative), and allocates nothing per update.
 */
export class FlightDataBus {
  readonly data: FlightData;
  private lastIas = 0;
  private lastTime = -1;
  private trend = 0;

  constructor(private readonly sim: FlightSimulation) {
    this.data = createFlightData(sim.plan);
  }

  update(): FlightData {
    const sim = this.sim;
    const d = this.data;
    const s = sim.state;
    const p = sim.params;
    const fms = sim.fms;
    const sys = sim.systems;
    const plan = sim.plan;
    const variation = plan.variation;
    const h = s[S.Y]!;
    const air = airData(h);
    const V = s[S.V]!;
    const gamma = s[S.GAMMA]!;
    const phi = s[S.PHI]!;
    const alpha = s[S.ALPHA]!;
    const gv = sim.groundVelocity();
    const iasMs = V * Math.sqrt(air.density / ISA.rho0);

    d.flight = sim.flight;
    d.phase = fms.phase;
    d.fma = fms.fma;
    d.clock = (CLOCK_EPOCH + sim.time) % 86_400;
    d.onGround = sim.onGround;
    d.x = s[S.X]!;
    d.z = s[S.Z]!;
    d.plan = plan;

    d.ias = iasMs * MS_TO_KT;
    d.tas = V * MS_TO_KT;
    d.groundSpeed = gv.speed * MS_TO_KT;
    d.mach = V / air.speedOfSound;
    // Speed trend: a filtered derivative of IAS over simulation time.
    if (this.lastTime >= 0 && sim.time > this.lastTime) {
      const rate = (d.ias - this.lastIas) / (sim.time - this.lastTime);
      const k = 1 - Math.exp(-(sim.time - this.lastTime) / 1.5);
      this.trend += (rate - this.trend) * k;
    } else if (sim.time < this.lastTime) {
      this.trend = 0;
    }
    this.lastIas = d.ias;
    this.lastTime = sim.time;
    d.speedTrend = this.trend * 10;

    d.altitude = h * M_TO_FT;
    d.radioAltitude = Math.max(0, fms.wheelHeight) * M_TO_FT;
    d.verticalSpeed = (sim.onGround ? 0 : V * Math.sin(gamma)) * MS_TO_FPM;
    d.oat = air.temperature - 273.15;
    d.altimeter = 29.92;

    // Body pitch from the wind-axis state (zero sideslip): sin θ = sin γ cos α + cos γ sin α cos φ
    d.pitch = Math.asin(clamp(Math.sin(gamma) * Math.cos(alpha) + Math.cos(gamma) * Math.sin(alpha) * Math.cos(phi), -1, 1)) / DEG;
    d.bank = phi / DEG;
    d.fpa = (sim.onGround ? 0 : Math.atan2(V * Math.sin(gamma), Math.max(gv.speed, 1))) / DEG;
    d.aoa = alpha / DEG;
    d.headingTrue = s[S.PSI]!;
    d.trackTrue = gv.speed > 2 ? gv.track : s[S.PSI]!;
    d.heading = magDeg(d.headingTrue, variation);
    d.track = magDeg(d.trackTrue, variation);
    d.windFrom = magDeg(plan.wind.from, variation);
    d.windSpeed = plan.wind.speed * MS_TO_KT;
    const rel = wrapPi(plan.wind.from - d.headingTrue);
    d.headwind = d.windSpeed * Math.cos(rel);
    d.crosswind = d.windSpeed * Math.sin(rel);

    // Targets
    const t = fms.targets;
    d.selectedSpeed = t.speed * Math.sqrt(air.density / ISA.rho0) * MS_TO_KT;
    d.selectedAltitude = selectedAltitude(sim) * M_TO_FT;
    const leg = plan.legs[fms.legIndex]!;
    d.desiredTrack = magDeg(fms.phase === 'takeoff' || leg.type === 'VA' ? plan.departure.runway.heading : bearing(fms.legStart, leg), variation);
    d.selectedCourse = magDeg(plan.arrival.runway.heading, variation);

    // Reference speeds
    d.vr = plan.speeds.vr * MS_TO_KT;
    d.v2 = plan.speeds.v2 * MS_TO_KT;
    d.vref = plan.speeds.vref * MS_TO_KT;
    d.vapp = plan.speeds.vapp * MS_TO_KT;
    d.vStall = stallSpeed(p, sys.mass(), sys.flaps) * MS_TO_KT;

    // Navigation
    d.activeLeg = fms.legIndex;
    d.activeIdent = leg.ident;
    d.toActive = fms.toActive * M_TO_NM;
    d.toDestination = fms.toDestination * M_TO_NM;
    const gs = Math.max(gv.speed, 30);
    d.eteActive = fms.toActive / gs;
    let remaining = d.eteActive;
    for (let i = fms.legIndex + 1; i < plan.legs.length; i++) remaining += plan.legs[i]!.time;
    d.eteDestination = fms.phase === 'takeoff' && gv.speed < 30 ? plan.ete : remaining;
    d.etaDestination = (d.clock + d.eteDestination) % 86_400;
    const st = sim.autopilot.status;
    d.fdBank = st.bankCmd / DEG;
    d.fdPitch = d.pitch + (sim.onGround ? 0 : (st.gammaCmd - gamma) / DEG + (st.alphaCmd - alpha) / DEG);
    d.crossTrack = t.lateral.mode === 'path' && t.lateral.path.kind === 'line' ? (st.trackError * M_TO_NM) : 0;
    d.verticalDeviation = fms.phase === 'descent' || fms.phase === 'final' ? fms.verticalDeviation * M_TO_FT : 0;

    // Final approach deviations, angular like an LPV approach: 1 dot = 0.35° vertical, 1.25° lateral.
    if (fms.phase === 'final' || (fms.phase === 'approach' && fms.fma.lateral === 'FAC')) {
      const rw = plan.arrival.runway;
      const ex = Math.sin(rw.heading);
      const ez = -Math.cos(rw.heading);
      const dx = s[S.X]! - rw.threshold.x;
      const dz = s[S.Z]! - rw.threshold.z;
      const along = -(dx * ex + dz * ez); // distance before the threshold
      const across = dx * -ez + dz * ex; // + right of the centreline
      const toGpi = Math.max(along + plan.approach.tch / Math.tan(plan.approach.glidePath), 150);
      const toLoc = Math.max(along + rw.length + 300, 300);
      d.lateralDots = clamp(Math.atan2(across, toLoc) / (1.25 * DEG), -2.5, 2.5);
      d.verticalDots = fms.phase === 'final' ? clamp(Math.atan2(fms.verticalDeviation, toGpi) / (0.35 * DEG), -2.5, 2.5) : null;
    } else {
      d.lateralDots = null;
      d.verticalDots = null;
    }

    // Engines (one engine state, four gauges)
    const setting = s[S.THRUST]!;
    const power = Math.abs(setting);
    const flowEach = sys.fuelFlow(setting) / p.engines;
    d.powerSetting = setting;
    d.engines.forEach((e, i) => {
      const trim = ENGINE_TRIM[i % ENGINE_TRIM.length]!;
      e.torque = clamp(100 * Math.pow(power, 0.9) + trim.torque * power, 0, 110);
      e.tgt = 470 + 360 * power + 0.8 * (d.oat - 15) + trim.tgt;
      e.nh = 71 + 29 * power;
      e.np = 100;
      e.fuelFlow = flowEach;
      e.reverse = setting < -0.02;
    });

    // Fuel
    d.fuel = sys.fuel;
    d.fuelUsed = sys.fuelUsed;
    d.fuelFlow = sys.fuelFlow(setting);
    d.endurance = d.fuelFlow > 0 ? (sys.fuel / d.fuelFlow) * 3600 : 0;
    // Like an FMS: the plan's fuel for what's left of the route, from the fuel on board now.
    const legs = plan.legs;
    const i = fms.legIndex;
    const before = i > 0 ? legs[i - 1]!.fuel : 0;
    const done = leg.length > 0 ? clamp(1 - fms.toActive / leg.length, 0, 1) : 1;
    const plannedSoFar = fms.phase === 'takeoff' ? 0 : before + done * (leg.fuel - before);
    d.fuelAtDestination = Math.max(0, sys.fuel - Math.max(0, plan.tripFuel - plannedSoFar));
    d.reserveFuel = plan.reserveFuel;
    d.grossWeight = sys.mass();

    // Configuration
    d.flaps = sys.flaps;
    d.flapsCmd = sys.flapsCmd;
    d.gear = sys.gear;
    d.gearCmd = sys.gearCmd;
    d.autobrake = t.autobrake;
    d.landingLights = isLandingLightPhase(sim);

    // Pressurization
    const c = sys.cabin;
    d.cabinAltitude = c.altitude * M_TO_FT;
    d.cabinRate = c.rate * MS_TO_FPM;
    d.cabinDifferential = c.differential / PSI;
    d.outflowValve = c.valve * 100;
    d.landingElevation = plan.arrival.runway.elevation * M_TO_FT;
    return d;
  }
}

/** The altitude an MCP would have set: cruise, then the descent clearance, then the FAF. */
function selectedAltitude(sim: FlightSimulation): number {
  const plan = sim.plan;
  const fms = sim.fms;
  switch (fms.phase) {
    case 'takeoff':
    case 'climb':
    case 'cruise':
      return plan.cruiseAltitude;
    case 'hold':
      return fms.hold?.altitude ?? plan.cruiseAltitude;
    case 'descent': {
      const first = plan.legs.find((l) => l.role === 'arrival' || l.role === 'approach');
      return first?.constraint?.altitude ?? plan.approach.iafAltitude;
    }
    case 'approach':
      return plan.approach.fafAltitude;
    default:
      // Past the final approach fix pilots set the missed-approach altitude; the
      // simulated procedure climbs back to the initial approach altitude.
      return plan.approach.iafAltitude;
  }
}

function isLandingLightPhase(sim: FlightSimulation): boolean {
  const p = sim.fms.phase;
  return p === 'takeoff' || p === 'final' || p === 'landing' || (p === 'climb' && sim.fms.wheelHeight < 900) || (p === 'approach' && sim.systems.gear > 0.5);
}

// ---- formatting helpers shared by the displays

/** "19:42" or "19:42:07" from seconds since midnight. */
export function formatClock(seconds: number, withSeconds = false): string {
  const t = ((Math.floor(seconds) % 86_400) + 86_400) % 86_400;
  const hh = String(Math.floor(t / 3600)).padStart(2, '0');
  const mm = String(Math.floor((t % 3600) / 60)).padStart(2, '0');
  const ss = String(t % 60).padStart(2, '0');
  return withSeconds ? `${hh}:${mm}:${ss}` : `${hh}:${mm}`;
}

/** Minutes and seconds, "12:04", or "1:02:04" past an hour. */
export function formatDuration(seconds: number): string {
  const t = Math.max(0, Math.round(seconds));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return `${h ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
}

/** A heading as three digits, 001–360. */
export function formatHeading(deg: number): string {
  let n = Math.round(deg) % 360;
  if (n <= 0) n += 360;
  return String(n).padStart(3, '0');
}
