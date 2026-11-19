import { density, ISA } from './atmosphere';
import { type AircraftParams, cl0At, inducedDragFactor, vSpeeds } from './aircraft';
import { availableThrust } from './dynamics';
import { clamp, DEG, wrapPi } from './math';
import {
  type Airport,
  bearing,
  distance,
  type Fix,
  offset,
  type Point,
  type RunwayChoice,
  type RunwayEnd,
  selectRunway,
  toMagnetic,
  type Wind,
  windTriangle,
} from './navdata';

/**
 * Flight-plan generation, following established IFR planning practice:
 *
 * - runway: the end most into the wind that is long enough (takeoff and landing
 *   distances estimated from the performance model, landing ×1.67 as for dispatch);
 * - departure: climb on runway heading to 1,000 ft above the field, then direct to the
 *   first fix (ARINC 424 leg types VA → DF);
 * - minimum en-route altitude: highest terrain within 4 NM of each leg + 1,000 ft
 *   (2,000 ft over mountains);
 * - cruise altitude: IFR semicircular rule (FAA 14 CFR 91.179): magnetic course 000–179°
 *   odd thousands, 180–359° even thousands, the lowest one above the MEA that still
 *   leaves room to climb and descend;
 * - descent: a 3° path from top of descent to the first approach fix;
 * - approach: an RNAV-style straight-in final (IF 7 NM, FAF 4 NM, 3° glide path,
 *   50 ft threshold crossing height) with the entry chosen like an FAA Terminal Arrival
 *   Area: straight-in, or via a left or right base IAF;
 * - timing: the wind triangle on every leg; fuel by phase, plus a 45-minute reserve.
 *
 * The airports, fixes, procedures and weather are fictional. These are not real
 * procedures and must not be used for navigation.
 */

export const NM = 1852;
export const FT = 0.3048;
export const KT = 0.514_444;

export type LegType = 'TO' | 'VA' | 'DF' | 'TF' | 'RW';
export type LegRole = 'departure' | 'enroute' | 'arrival' | 'approach' | 'final';

export interface AltitudeConstraint {
  kind: 'at' | 'atOrAbove' | 'atOrBelow';
  altitude: number;
}

export interface Leg {
  ident: string;
  type: LegType;
  role: LegRole;
  /** Where the leg ends. */
  x: number;
  z: number;
  /** True course of the leg [rad] and its length [m]. */
  course: number;
  length: number;
  constraint?: AltitudeConstraint;
  /** Planned altitude at the leg's end [m]. */
  altitude: number;
  /** Planned indicated airspeed on the leg [m/s]. */
  speed: number;
  groundSpeed: number;
  /** Leg time, and cumulative time / distance / fuel at the leg's end. */
  time: number;
  elapsed: number;
  cumDistance: number;
  fuel: number;
  section?: string;
}

export interface Approach {
  name: string;
  runway: RunwayEnd;
  entry: 'straight-in' | 'left base' | 'right base';
  iaf: Fix;
  if: Fix;
  faf: Fix;
  finalCourse: number;
  glidePath: number;
  tch: number;
  fafAltitude: number;
  iafAltitude: number;
}

export interface FlightPlan {
  id: number;
  origin: Airport;
  destination: Airport;
  departure: RunwayChoice;
  arrival: RunwayChoice;
  wind: Wind;
  variation: number;
  cruiseAltitude: number;
  mea: number;
  legs: Leg[];
  toc: { distance: number; point: Point };
  tod: { distance: number; point: Point };
  approach: Approach;
  totalDistance: number;
  ete: number;
  tripFuel: number;
  reserveFuel: number;
  fuelOnBoard: number;
  takeoffDistance: number;
  landingDistance: number;
  speeds: { vr: number; v2: number; vref: number; vapp: number };
  metar: { origin: string; destination: string };
  warnings: string[];
}

export interface PlanRequest {
  id: number;
  origin: Airport;
  destination: Airport;
  /** En-route fixes in the order they will be flown. */
  route: readonly Fix[];
  wind: Wind;
  variation: number;
  params: AircraftParams;
  fuel: number;
  terrain: (x: number, z: number) => number;
}

const GLIDE = 3 * DEG;
const TCH = 50 * FT;
const FAF_DIST = 4 * NM;
const IF_DIST = 7 * NM;
const IAF_OFFSET = 4 * NM;
const ACCEL_HEIGHT = 1000 * FT;

const roundUp = (m: number, step: number) => Math.ceil(m / step - 1e-9) * step;
const tasFor = (ias: number, h: number) => ias * Math.sqrt(ISA.rho0 / density(h));

/** Deterministic, pronounceable five-letter fix names (CVCVC), like real waypoint names. */
export function fixName(seed: string): string {
  const C = 'BDFGKLMNPRSTVZ';
  const V = 'AEIOU';
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const pick = (set: string) => {
    h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
    return set[(h >>> 0) % set.length]!;
  };
  return pick(C) + pick(V) + pick(C) + pick(V) + pick(C);
}

// ---------------------------------------------------------------------------
// Performance estimates (from the same aircraft model the simulation flies)

function dragAt(p: AircraftParams, mass: number, ias: number, h: number, flaps: number, gear: number): number {
  const rho = density(h);
  const V = tasFor(ias, h);
  const qS = 0.5 * rho * V * V * p.wingArea;
  const cl = (mass * ISA.g0) / qS;
  return qS * (p.cd0 + p.flapCd0 * flaps + p.gearCd0 * gear + inducedDragFactor(p) * cl * cl);
}

/** Thrust setting needed to hold level flight [0..1]. */
function levelThrust(p: AircraftParams, mass: number, ias: number, h: number, flaps = 0, gear = 0): number {
  return dragAt(p, mass, ias, h, flaps, gear) / availableThrust(p, density(h), tasFor(ias, h));
}

/** Takeoff ground roll to rotation plus the air distance to 35 ft [m]. */
export function takeoffDistance(p: AircraftParams, mass: number, elevation: number, headwind: number): number {
  const { vr } = vSpeeds(p, mass);
  const rho = density(elevation);
  const W = mass * ISA.g0;
  let vg = 0;
  let d = 0;
  const dt = 0.05;
  for (let t = 0; t < 120; t += dt) {
    const V = vg + headwind;
    const tas = Math.max(V, 0);
    if (tas * Math.sqrt(rho / ISA.rho0) >= vr) break;
    const qS = 0.5 * rho * tas * tas * p.wingArea;
    const cl = cl0At(p, p.takeoffFlap);
    const L = qS * cl;
    const D = qS * (p.cd0 + p.flapCd0 * p.takeoffFlap + p.gearCd0 + inducedDragFactor(p) * cl * cl);
    const T = availableThrust(p, rho, tas);
    const a = (T - D - p.rollingFriction * Math.max(W - L, 0)) / mass;
    vg += a * dt;
    d += vg * dt;
  }
  return d + 350; // rotation and the air segment to 35 ft
}

/** Landing distance from 50 ft with medium autobrake [m] (unfactored). */
export function landingDistance(p: AircraftParams, mass: number, headwind: number): number {
  const { vref } = vSpeeds(p, mass);
  const vg = vref - headwind;
  return 300 + (vg * vg) / (2 * 2.5);
}

interface ClimbResult {
  distance: number;
  time: number;
  fuel: number;
}

/** Integrate a climb from one altitude to another at climb power [m, s, kg]. */
function climbProfile(p: AircraftParams, mass: number, from: number, to: number, ias: number, wind: Wind, course: number): ClimbResult {
  let dist = 0;
  let time = 0;
  let fuel = 0;
  const step = 50;
  const ff = p.engines * (p.fuelFlowIdle + (p.fuelFlowMax - p.fuelFlowIdle) * p.climbThrust);
  for (let h = from; h < to; h += step) {
    const mid = Math.min(h + step / 2, to);
    const rho = density(mid);
    const V = tasFor(ias, mid);
    const T = p.climbThrust * availableThrust(p, rho, V);
    const D = dragAt(p, mass, ias, mid, 0, 0);
    const roc = Math.max(((T - D) / (mass * ISA.g0)) * V, 1);
    const dt = Math.min(step, to - h) / roc;
    const gs = windTriangle(wind, course, V).groundSpeed;
    time += dt;
    dist += gs * dt;
    fuel += (ff / 3600) * dt;
  }
  return { distance: dist, time, fuel };
}

// ---------------------------------------------------------------------------
// Terrain

/** Highest terrain within `halfWidth` of the segment a→b [m]. */
export function corridorMax(terrain: PlanRequest['terrain'], a: Point, b: Point, halfWidth: number, step = 1000): number {
  const len = distance(a, b);
  const c = bearing(a, b);
  const nx = Math.cos(c);
  const nz = Math.sin(c);
  let max = -Infinity;
  for (let s = 0; s <= len + 1; s += step) {
    const px = a.x + Math.sin(c) * Math.min(s, len);
    const pz = a.z - Math.cos(c) * Math.min(s, len);
    for (let w = -halfWidth; w <= halfWidth + 1; w += step) {
      max = Math.max(max, terrain(px + nx * w, pz + nz * w));
    }
  }
  return max;
}

function minimumAltitude(terrain: PlanRequest['terrain'], a: Point, b: Point): number {
  const top = corridorMax(terrain, a, b, 4 * NM);
  return roundUp(top + (top > 1500 ? 2000 : 1000) * FT, 100 * FT);
}

// ---------------------------------------------------------------------------

/** Highest terrain within `radius` of a point [m]. */
export function areaMax(terrain: PlanRequest['terrain'], c: Point, radius: number, step = 500): number {
  let max = -Infinity;
  for (let dx = -radius; dx <= radius + 1; dx += step) {
    for (let dz = -radius; dz <= radius + 1; dz += step) {
      if (dx * dx + dz * dz <= radius * radius + 1) max = Math.max(max, terrain(c.x + dx, c.z + dz));
    }
  }
  return max;
}

/**
 * The approach to a runway end, entered from the direction of `from`. With a terrain
 * function, the initial approach altitude also keeps 1,000 ft above the terrain within
 * 2 NM of the initial segment (the base leg, or the IF on a straight-in).
 */
export function buildApproach(runway: RunwayEnd, from: Point, terrain?: PlanRequest['terrain']): Approach {
  const outbound = runway.heading + Math.PI;
  const T = runway.threshold;
  const fafAltitude = roundUp(runway.elevation + TCH + FAF_DIST * Math.tan(GLIDE), 100 * FT);
  const ifPoint = offset(T, outbound, IF_DIST);
  const id = `${runway.airport}${runway.ident}`;

  const rel = wrapPi(bearing(ifPoint, from) - outbound);
  let entry: Approach['entry'] = 'straight-in';
  let iafPoint = ifPoint;
  if (Math.abs(rel) > 70 * DEG) {
    // Base areas: the IAF sits 4 NM either side of the IF, perpendicular to the final.
    // rel > 0: the aircraft is clockwise of the outbound course, which is the left of a
    // pilot flying the final inbound, so it joins on a left base (left turn onto final).
    const side = rel > 0 ? 1 : -1;
    entry = side > 0 ? 'left base' : 'right base';
    iafPoint = offset(ifPoint, outbound + (side * Math.PI) / 2, IAF_OFFSET);
  }

  let iafAltitude = roundUp(fafAltitude + 1000 * FT, 100 * FT);
  if (terrain) {
    const top = entry === 'straight-in' ? areaMax(terrain, ifPoint, 2 * NM) : corridorMax(terrain, iafPoint, ifPoint, 2 * NM, 500);
    iafAltitude = Math.max(iafAltitude, roundUp(top + 1000 * FT, 100 * FT));
  }
  const ifFix: Fix = { ident: fixName(`${id}IF`), ...ifPoint };
  return {
    name: `RNAV (GPS) RWY ${runway.ident}`,
    runway,
    entry,
    iaf: entry === 'straight-in' ? ifFix : { ident: fixName(`${id}${entry}`), ...iafPoint },
    if: ifFix,
    faf: { ident: `FF${runway.ident}`, ...offset(T, outbound, FAF_DIST) },
    finalCourse: runway.heading,
    glidePath: GLIDE,
    tch: TCH,
    fafAltitude,
    iafAltitude,
  };
}

/** METAR-style report of the simulated weather (METAR winds are true). */
function metar(airport: Airport, wind: Wind): string {
  const dir = String(Math.round(((wind.from / DEG) % 360) / 10) * 10 || 360).padStart(3, '0');
  const spd = String(Math.round(wind.speed / KT)).padStart(2, '0');
  const temp = Math.round(15 - 6.5 * (airport.elevation / 1000));
  const w = wind.speed < 1.5 ? '00000KT' : `${dir}${spd}KT`;
  return `${airport.ident} ${w} 10SM FEW045 ${String(temp).padStart(2, '0')}/06 A2992`;
}

export function planFlight(req: PlanRequest): FlightPlan {
  const { params: p, wind, terrain, variation } = req;
  const warnings: string[] = [];
  const mass = p.emptyMass + p.payload + req.fuel;
  const v = vSpeeds(p, mass);
  const vapp = v.vref + 5 * KT;

  // Runways
  const toRequired = takeoffDistance(p, mass, req.origin.elevation, 0);
  const ldRequired = landingDistance(p, mass, 0) / 0.6;
  const departure = selectRunway(req.origin, wind, toRequired);
  const arrival = selectRunway(req.destination, wind, ldRequired);
  const takeoff = takeoffDistance(p, mass, req.origin.elevation, departure.headwind);
  const landing = landingDistance(p, mass, arrival.headwind);
  if (departure.runway.length < takeoff) warnings.push(`Runway ${departure.runway.ident} is shorter than the takeoff distance.`);
  if (arrival.runway.length < landing / 0.6) warnings.push(`Runway ${arrival.runway.ident} is short for the factored landing distance.`);
  for (const [r, what] of [[departure, 'departure'], [arrival, 'arrival']] as const) {
    if (Math.abs(r.crosswind) > 20 * KT) warnings.push(`Strong crosswind on the ${what} runway (${Math.round(Math.abs(r.crosswind) / KT)} kt).`);
    if (r.headwind < -10 * KT) warnings.push(`Tailwind on the ${what} runway.`);
  }

  // Departure geometry
  const dep = departure.runway;
  const accelAltitude = dep.elevation + ACCEL_HEIGHT;
  const liftoffRoll = Math.max(takeoff - 350, 300);
  const liftoff = offset(dep.threshold, dep.heading, liftoffRoll);
  const initialClimb = climbProfile(p, mass, dep.elevation, accelAltitude, v.v2 + 15 * KT, wind, dep.heading);
  const vaEnd = offset(liftoff, dep.heading, initialClimb.distance);
  const vaDistance = liftoffRoll + initialClimb.distance;

  // Approach, from the direction of the last en-route fix
  const last = req.route.length ? req.route[req.route.length - 1]! : vaEnd;
  const approach = buildApproach(arrival.runway, last, terrain);

  // Minimum en-route altitude along departure → route → IAF
  const enroutePoints: Point[] = [vaEnd, ...req.route, approach.iaf];
  let mea = 0;
  for (let i = 0; i + 1 < enroutePoints.length; i++) mea = Math.max(mea, minimumAltitude(terrain, enroutePoints[i]!, enroutePoints[i + 1]!));

  // Cruise altitude by the semicircular rule, at or above the MEA and the IAF altitude
  const courseMag = toMagnetic(bearing(req.origin, req.destination), variation);
  const eastbound = courseMag < Math.PI;
  const floor = Math.max(mea, approach.iafAltitude);
  const candidates: number[] = [];
  for (let k = eastbound ? 3000 : 2000; k <= 12000; k += 2000) candidates.push(k * FT);
  const valid = candidates.filter((h) => h >= floor - 1e-6);
  if (!valid.length) warnings.push('No semicircular cruise altitude clears the terrain below 12,000 ft.');

  // Route distance up to the approach's first fix, for the climb/descent fit
  let routeLength = distance(dep.threshold, vaEnd);
  {
    let prev: Point = vaEnd;
    for (const f of [...req.route, approach.iaf]) {
      routeLength += distance(prev, f);
      prev = f;
    }
  }
  const trackOut = bearing(req.origin, req.destination);
  const climbTo = (h: number) => climbProfile(p, mass, accelAltitude, h, p.climbSpeed, wind, trackOut);
  const descentTargetFor = (h: number) => Math.min(h, approach.iafAltitude);
  const fits = (h: number) => vaDistance + climbTo(h).distance + (h - descentTargetFor(h)) / Math.tan(GLIDE) + 2 * NM <= routeLength;
  // Prefer the lowest valid altitude that fits; if none fits, fly the lowest valid one.
  const cruise = valid.find(fits) ?? valid[0] ?? candidates[candidates.length - 1]!;
  if (valid.length && !valid.some(fits)) warnings.push('Route is short for a full climb and descent; the plan cruises only briefly.');
  const climb = climbTo(cruise);
  const descentTarget = descentTargetFor(cruise);

  // Assemble the legs
  type Draft = Omit<Leg, 'altitude' | 'speed' | 'groundSpeed' | 'time' | 'elapsed' | 'cumDistance' | 'fuel'>;
  const drafts: Draft[] = [];
  const add = (d: Omit<Draft, 'course' | 'length'>, from: Point) =>
    drafts.push({ ...d, course: bearing(from, d), length: distance(from, d) });

  add({ ident: `RW${dep.ident}`, type: 'TO', role: 'departure', ...liftoff }, dep.threshold);
  add({ ident: `(${Math.round(accelAltitude / FT / 100) * 100})`, type: 'VA', role: 'departure', ...vaEnd }, liftoff);
  let prev: Point = vaEnd;
  req.route.forEach((f, i) => {
    add({ ident: f.ident, type: i === 0 ? 'DF' : 'TF', role: 'enroute', x: f.x, z: f.z, section: f.section }, prev);
    prev = f;
  });
  const atOrAboveIaf: AltitudeConstraint = { kind: 'atOrAbove', altitude: approach.iafAltitude };
  if (approach.entry !== 'straight-in') {
    add({ ident: approach.iaf.ident, type: 'TF', role: 'arrival', x: approach.iaf.x, z: approach.iaf.z, constraint: atOrAboveIaf }, prev);
    prev = approach.iaf;
  }
  // The base leg (or the arrival at the IF) is flown level at the initial approach
  // altitude; the intermediate segment descends to the FAF altitude.
  add({ ident: approach.if.ident, type: 'TF', role: approach.entry === 'straight-in' ? 'arrival' : 'approach', x: approach.if.x, z: approach.if.z, constraint: { ...atOrAboveIaf } }, prev);
  prev = approach.if;
  add({ ident: approach.faf.ident, type: 'TF', role: 'approach', x: approach.faf.x, z: approach.faf.z, constraint: { kind: 'at', altitude: approach.fafAltitude } }, prev);
  prev = approach.faf;
  const thr = arrival.runway.threshold;
  add({ ident: `RW${arrival.runway.ident}`, type: 'RW', role: 'final', x: thr.x, z: thr.z, constraint: { kind: 'at', altitude: arrival.runway.elevation + TCH } }, prev);

  // A turn of more than 110° can't be flown as a fly-by (the turn would have to start
  // miles before the fix): fly over the fix and go direct to the next one (TF → DF).
  for (let i = 3; i < drafts.length; i++) {
    const turn = Math.abs(wrapPi(drafts[i]!.course - drafts[i - 1]!.course));
    if (drafts[i]!.type === 'TF' && drafts[i]!.role !== 'final' && turn > 110 * DEG) drafts[i]!.type = 'DF';
  }

  // Vertical profile: initial climb to the acceleration altitude, climb to cruise, cruise,
  // a 3° descent to the first approach fix, then the approach's own altitudes.
  const firstApproachIndex = drafts.findIndex((d) => d.role === 'arrival' || d.role === 'approach');
  let cum = 0;
  const cumAt: number[] = drafts.map((d) => (cum += d.length));
  const tocDistance = vaDistance + climb.distance;
  const todDistance = cumAt[firstApproachIndex]! - (cruise - descentTarget) / Math.tan(GLIDE);
  const descentFixDistance = cumAt[firstApproachIndex]!;

  const enrouteAltitude = (d: number): number => {
    if (d <= liftoffRoll) return dep.elevation;
    if (d <= vaDistance) return dep.elevation + (ACCEL_HEIGHT * (d - liftoffRoll)) / Math.max(vaDistance - liftoffRoll, 1);
    if (d <= tocDistance) return accelAltitude + ((cruise - accelAltitude) * (d - vaDistance)) / Math.max(tocDistance - vaDistance, 1);
    if (d >= todDistance) return Math.max(descentTarget, cruise - (d - todDistance) * Math.tan(GLIDE));
    return cruise;
  };
  const endAltitude = drafts.map((d, i) => (d.role === 'approach' || d.role === 'final' ? d.constraint!.altitude : enrouteAltitude(cumAt[i]!)));

  // Time and fuel, leg by leg, from the same performance model the simulation flies:
  // the thrust each segment needs at its planned speed, configuration and path angle.
  const ffAt = (thrust: number) => p.engines * (p.fuelFlowIdle + (p.fuelFlowMax - p.fuelFlowIdle) * clamp(Math.abs(thrust), 0, 1));
  const legs: Leg[] = [];
  let elapsed = 0;
  let fuel = 0;
  let m = mass;
  const SUB = 12;
  drafts.forEach((d, i) => {
    const endDist = cumAt[i]!;
    const startDist = endDist - d.length;
    const startAlt = i === 0 ? dep.elevation : endAltitude[i - 1]!;
    const altitude = endAltitude[i]!;
    let time = 0;
    let legFuel = 0;
    let speed = 0;
    if (d.type === 'TO') {
      // Ground roll at full power, accelerating roughly uniformly to rotation.
      speed = v.vr;
      time = d.length / (v.vr / 2);
      legFuel = (ffAt(1) / 3600) * time;
    } else {
      for (let k = 0; k < SUB; k++) {
        const s0 = startDist + (k / SUB) * d.length;
        const s1 = startDist + ((k + 1) / SUB) * d.length;
        const along = (s: number) => (d.role === 'approach' || d.role === 'final' ? startAlt + ((altitude - startAlt) * (s - startDist)) / Math.max(d.length, 1) : enrouteAltitude(s));
        const h0 = along(s0);
        const h1 = along(s1);
        const h = (h0 + h1) / 2;
        const gamma = Math.atan2(h1 - h0, s1 - s0);
        const climbing = d.type === 'VA' || (s1 <= tocDistance + 1 && h1 > h0 + 0.01);
        let flaps = 0;
        let gear = 0;
        if (d.type === 'VA') {
          speed = v.v2 + 15 * KT;
          flaps = p.takeoffFlap;
        } else if (d.role === 'final') {
          speed = vapp;
          flaps = 1;
          gear = 1;
        } else if (d.role === 'approach' || d.role === 'arrival') {
          speed = p.approachSpeed;
          flaps = p.approachFlap;
          gear = d.ident === approach.faf.ident ? 1 : 0;
        } else if (climbing) {
          speed = p.climbSpeed;
        } else if (s1 > todDistance) {
          const toFix = descentFixDistance - s1;
          speed = toFix < 6 * NM ? p.approachSpeed : p.descentSpeed;
          if (toFix < 8 * NM) flaps = p.approachFlap;
        } else {
          speed = p.cruiseSpeed;
        }
        const tas = tasFor(speed, h);
        const thrust = climbing
          ? d.type === 'VA'
            ? 1
            : p.climbThrust
          : clamp((dragAt(p, m, speed, h, flaps, gear) + m * ISA.g0 * Math.sin(gamma)) / availableThrust(p, density(h), tas), 0, 1);
        const gs = Math.max(windTriangle(wind, d.course, tas).groundSpeed, 20);
        const dt = (s1 - s0) / gs;
        const burn = (ffAt(thrust) / 3600) * dt;
        time += dt;
        legFuel += burn;
        m -= burn;
      }
    }
    elapsed += time;
    fuel += legFuel;
    legs.push({ ...d, altitude, speed, groundSpeed: d.length / Math.max(time, 1e-6), time, elapsed, cumDistance: endDist, fuel });
  });

  // Feasibility checks. A fly-by turn needs room on both legs for its lead distance; a
  // DF leg starts with a fly-over turn, so it only needs room to turn and roll out.
  for (let i = 1; i + 1 < legs.length; i++) {
    const a = legs[i]!;
    const b = legs[i + 1]!;
    const turn = Math.abs(wrapPi(b.course - a.course));
    const r = (a.groundSpeed * a.groundSpeed) / (ISA.g0 * Math.tan(25 * DEG));
    const tight =
      b.type === 'DF'
        ? b.length < 2.5 * r
        : r * Math.tan(Math.min(turn, 2.6) / 2) > 0.8 * Math.min(a.length, b.length) && b.role !== 'final';
    if (tight) warnings.push(`Tight turn at ${a.ident}.`);
  }
  // Intermediate segment: from the initial approach altitude down to the FAF's, no steeper
  // than about 3.5°, with 500 ft of terrain clearance.
  if ((approach.iafAltitude - approach.fafAltitude) / (IF_DIST - FAF_DIST) > Math.tan(3.5 * DEG)) {
    warnings.push('Intermediate segment descent is steeper than 3.5°.');
  }
  if (corridorMax(terrain, approach.if, approach.faf, 600, 300) > approach.fafAltitude - 500 * FT) {
    warnings.push('Less than 500 ft terrain clearance on the intermediate segment.');
  }
  // Final approach: terrain must stay below a 34:1 obstacle clearance surface rising from
  // the threshold (the slope used for approach surfaces), and well below the glide path.
  for (let d = 200; d <= FAF_DIST; d += 200) {
    const pt = offset(thr, approach.finalCourse + Math.PI, d);
    const surface = arrival.runway.elevation + (d - 60) / 34;
    if (terrain(pt.x, pt.z) > surface) {
      warnings.push('Terrain penetrates the approach surface.');
      break;
    }
  }

  const totalDistance = legs[legs.length - 1]!.cumDistance;
  const ete = legs[legs.length - 1]!.elapsed;
  const tripFuel = fuel;
  const cruiseThrust = Math.min(1, levelThrust(p, mass, p.cruiseSpeed, cruise));
  const reserveFuel = (ffAt(cruiseThrust) / 3600) * 45 * 60;
  if (req.fuel < tripFuel + reserveFuel) warnings.push('Fuel on board is below trip fuel plus reserve.');

  const tocLeg = legs.findIndex((l) => l.cumDistance >= tocDistance);
  const todLeg = legs.findIndex((l) => l.cumDistance >= todDistance);
  const pointAlong = (d: number, li: number): Point => {
    const leg = legs[Math.max(li, 0)]!;
    const back = leg.cumDistance - d;
    return offset({ x: leg.x, z: leg.z }, leg.course + Math.PI, Math.max(0, back));
  };

  return {
    id: req.id,
    origin: req.origin,
    destination: req.destination,
    departure,
    arrival,
    wind,
    variation,
    cruiseAltitude: cruise,
    mea,
    legs,
    toc: { distance: tocDistance, point: pointAlong(tocDistance, tocLeg) },
    tod: { distance: todDistance, point: pointAlong(todDistance, todLeg) },
    approach,
    totalDistance,
    ete,
    tripFuel,
    reserveFuel,
    fuelOnBoard: req.fuel,
    takeoffDistance: takeoff,
    landingDistance: landing,
    speeds: { vr: v.vr, v2: v.v2, vref: v.vref, vapp },
    metar: { origin: metar(req.origin, wind), destination: metar(req.destination, wind) },
    warnings,
  };
}
