import { DEG, TAU, wrapPi } from './math';

/**
 * Navigation data: airports, runways, fixes and wind, plus the geometry pilots and
 * flight-planning software use on them. Positions are in the sim frame (x east,
 * z south, metres); bearings are radians from true north, clockwise.
 */

export interface Point {
  x: number;
  z: number;
}

export interface Fix extends Point {
  ident: string;
  /** Portfolio section this fix stands for, if any. */
  section?: string;
}

/** One usable direction of a runway (runway 27 and runway 09 are two RunwayEnds). */
export interface RunwayEnd {
  /** Designator from the magnetic heading, e.g. "27", "04". */
  ident: string;
  airport: string;
  /** Landing / takeoff direction [rad true]. */
  heading: number;
  /** Where the runway starts for an aircraft using this end. */
  threshold: Point;
  /** The far end. */
  end: Point;
  length: number;
  width: number;
  elevation: number;
}

export interface Airport extends Point {
  ident: string;
  name: string;
  elevation: number;
  runways: RunwayEnd[];
}

/** Wind as reported: the direction it blows *from* [rad true] and its speed [m/s]. */
export interface Wind {
  from: number;
  speed: number;
}

/** Wind as a velocity vector in the world frame (the way the air moves). */
export function windVector(w: Wind): { x: number; z: number } {
  const to = w.from + Math.PI;
  return { x: w.speed * Math.sin(to), z: -w.speed * Math.cos(to) };
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.z - a.z);
}

/** True bearing from a to b [rad, 0..2π). */
export function bearing(a: Point, b: Point): number {
  const t = Math.atan2(b.x - a.x, -(b.z - a.z));
  return t < 0 ? t + TAU : t;
}

export function offset(p: Point, course: number, dist: number): Point {
  return { x: p.x + Math.sin(course) * dist, z: p.z - Math.cos(course) * dist };
}

/** True ↔ magnetic. Variation is east-positive: magnetic = true − variation. */
export function toMagnetic(trueBearing: number, variation: number): number {
  const m = (trueBearing - variation) % TAU;
  return m < 0 ? m + TAU : m;
}

export function toTrue(magnetic: number, variation: number): number {
  const t = (magnetic + variation) % TAU;
  return t < 0 ? t + TAU : t;
}

/** Runway designator for a magnetic heading: 266° → "27", 044° → "04", 004° → "36". */
export function runwayDesignator(magneticHeading: number): string {
  let n = Math.round(magneticHeading / DEG / 10) % 36;
  if (n === 0) n = 36;
  return String(n).padStart(2, '0');
}

/** Both ends of a physical runway, given its centre, true heading of one end, and size. */
export function runwayEnds(
  airport: string,
  centre: Point,
  heading: number,
  length: number,
  width: number,
  elevation: number,
  variation: number,
): [RunwayEnd, RunwayEnd] {
  const a = offset(centre, heading + Math.PI, length / 2);
  const b = offset(centre, heading, length / 2);
  const make = (h: number, threshold: Point, end: Point): RunwayEnd => ({
    ident: runwayDesignator(toMagnetic(h, variation)),
    airport,
    heading: ((h % TAU) + TAU) % TAU,
    threshold,
    end,
    length,
    width,
    elevation,
  });
  return [make(heading, a, b), make(heading + Math.PI, b, a)];
}

/** Headwind (+) / tailwind (−) and crosswind (+ from the right) components [m/s]. */
export function windComponents(w: Wind, heading: number): { headwind: number; crosswind: number } {
  const rel = wrapPi(w.from - heading);
  return { headwind: w.speed * Math.cos(rel), crosswind: w.speed * Math.sin(rel) };
}

/**
 * The wind triangle: for a desired ground track and true airspeed, the heading to
 * fly (wind-correction angle) and the resulting ground speed. Same maths as the E6B.
 */
export function windTriangle(w: Wind, track: number, tas: number): { heading: number; groundSpeed: number; wca: number } {
  const { headwind, crosswind } = windComponents(w, track);
  const wca = Math.asin(Math.max(-1, Math.min(1, crosswind / tas)));
  return { heading: track + wca, groundSpeed: tas * Math.cos(wca) - headwind, wca };
}

export interface RunwayChoice {
  runway: RunwayEnd;
  headwind: number;
  crosswind: number;
}

/**
 * Pick the runway end most into the wind, among those long enough and within the
 * crosswind limit. In light winds (under ~3 kt) the longest runway is used.
 */
export function selectRunway(
  airport: Airport,
  wind: Wind,
  requiredLength: number,
  crosswindLimit = 25 * 0.514_444,
): RunwayChoice {
  const options = airport.runways.map((r) => ({ runway: r, ...windComponents(wind, r.heading) }));
  const usable = options.filter((o) => o.runway.length >= requiredLength && Math.abs(o.crosswind) <= crosswindLimit);
  const pool = usable.length ? usable : options;
  const calm = wind.speed < 1.5;
  pool.sort((a, b) =>
    calm ? b.runway.length - a.runway.length : b.headwind - a.headwind || b.runway.length - a.runway.length,
  );
  return pool[0]!;
}
