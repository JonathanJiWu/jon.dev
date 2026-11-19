import { describe, expect, it } from 'vitest';
import { density, ISA } from './atmosphere';
import { stallAlpha, stallSpeed } from './aircraft';
import { S } from './dynamics';
import type { Phase } from './fms';
import { DEG } from './math';
import type { Wind } from './navdata';
import { FT, KT, NM } from './planner';
import { FlightSimulation } from './simulation';
import { WORLD } from '../world/navdata';

const FPM = FT / 60;
const WINDS: [string, Wind][] = [
  ['calm', { from: 0, speed: 0 }],
  ['270/20', { from: 270 * DEG, speed: 20 * KT }],
  ['090/12', { from: 90 * DEG, speed: 12 * KT }],
  ['180/15', { from: 180 * DEG, speed: 15 * KT }],
  ['225/25', { from: 225 * DEG, speed: 25 * KT }],
];

interface FlightLog {
  phases: Phase[];
  maxBank: number;
  /** Highest α as a fraction of the stall α for the flap setting at the time. */
  maxAlphaFraction: number;
  /** Lowest IAS as a multiple of the 1-g stall speed, while airborne above 50 ft. */
  minStallMargin: number;
  /** Lowest wheel height in cruise, descent and holds [m]. */
  minClearance: number;
  /** Time and fuel from brake release to touchdown. */
  flown: number;
  fuelUsed: number;
}

/** Fly until the current flight has landed and stopped (or a time limit), logging the envelope. */
function flyOneFlight(sim: FlightSimulation, maxSeconds = 2400): FlightLog {
  const log: FlightLog = { phases: [sim.phase], maxBank: 0, maxAlphaFraction: 0, minStallMargin: Infinity, minClearance: Infinity, flown: 0, fuelUsed: 0 };
  const t0 = sim.time;
  const fuel0 = sim.systems.fuel;
  const flight = sim.flight;
  while (sim.phase !== 'parked' && sim.flight === flight && sim.time - t0 < maxSeconds) {
    sim.step();
    if (sim.phase === 'landing' && !log.flown) {
      log.flown = sim.time - t0;
      log.fuelUsed = fuel0 - sim.systems.fuel;
    }
    const s = sim.state;
    if (log.phases[log.phases.length - 1] !== sim.phase) log.phases.push(sim.phase);
    log.maxBank = Math.max(log.maxBank, Math.abs(s[S.PHI]!));
    if (!sim.onGround) {
      log.maxAlphaFraction = Math.max(log.maxAlphaFraction, s[S.ALPHA]! / stallAlpha(sim.params, sim.systems.flaps));
      if (sim.fms.wheelHeight > 50 * FT) {
        const ias = s[S.V]! * Math.sqrt(density(s[S.Y]!) / ISA.rho0);
        log.minStallMargin = Math.min(log.minStallMargin, ias / stallSpeed(sim.params, sim.systems.mass(), sim.systems.flaps));
      }
    }
    if (sim.phase === 'cruise' || sim.phase === 'descent' || sim.phase === 'hold') log.minClearance = Math.min(log.minClearance, sim.fms.wheelHeight);
  }
  return log;
}

describe.each(WINDS)('a full flight each way, wind %s', (_, wind) => {
  const sim = new FlightSimulation({ world: WORLD, weather: () => wind });
  const logs = [0, 1].map(() => {
    const plan = sim.plan;
    const log = flyOneFlight(sim);
    const td = sim.fms.touchdown;
    const result = { plan, log, td, incidents: sim.incidents, phase: sim.phase };
    // On to the next flight: let the parked timer run out.
    while (sim.flight === plan.id && sim.time < 3 * 3600) sim.step();
    return result;
  });

  it.each([0, 1])('flight %i flies every phase in order and lands without incident', (i) => {
    const r = logs[i]!;
    expect(r.incidents).toBe(0);
    expect(r.phase).toBe('parked');
    expect(r.log.phases).toEqual(['takeoff', 'climb', 'cruise', 'descent', 'approach', 'final', 'landing', 'parked']);
  });

  it.each([0, 1])('flight %i touches down in the touchdown zone, gently, near Vref', (i) => {
    const { td, plan } = logs[i]!;
    expect(td).not.toBeNull();
    // Touchdown zone: the first 3,000 ft; the aiming point is ~1,000 ft in.
    expect(td!.distance).toBeGreaterThan(150);
    expect(td!.distance).toBeLessThan(900);
    expect(td!.sinkRate / FPM).toBeLessThan(360);
    expect(td!.sinkRate).toBeGreaterThan(0);
    expect(Math.abs(td!.speed - plan.speeds.vref) / KT).toBeLessThan(10);
  });

  it.each([0, 1])('flight %i stays inside the envelope and clear of the terrain', (i) => {
    const { log, plan } = logs[i]!;
    expect(log.maxBank).toBeLessThanOrEqual(25 * DEG + 0.005);
    expect(log.maxAlphaFraction).toBeLessThan(0.9);
    expect(log.minStallMargin).toBeGreaterThan(1.2);
    // En route and in the descent: at least 1,000 ft above the terrain, less a small margin.
    expect(log.minClearance).toBeGreaterThan(900 * FT);
    expect(plan.warnings).toEqual([]);
  });

  it.each([0, 1])('flight %i takes about as long, and burns about as much, as planned', (i) => {
    const { log, plan } = logs[i]!;
    expect(Math.abs(log.flown - plan.ete) / plan.ete).toBeLessThan(0.12);
    expect(Math.abs(log.fuelUsed - plan.tripFuel) / plan.tripFuel).toBeLessThan(0.12);
  });

  it('alternates between the two airports', () => {
    expect(logs[0]!.plan.origin.ident).toBe(logs[1]!.plan.destination.ident);
    expect(logs[0]!.plan.destination.ident).toBe(logs[1]!.plan.origin.ident);
  });
});

function runFor(sim: FlightSimulation, seconds: number): void {
  const n = Math.round(seconds / sim.dt);
  for (let i = 0; i < n; i++) sim.step();
}

function runUntil(sim: FlightSimulation, done: () => boolean, maxSeconds: number): void {
  const t0 = sim.time;
  while (!done() && sim.time - t0 < maxSeconds) sim.step();
}

describe('requests from the page', () => {
  it('defers a hold requested on the runway until safely airborne, then holds there', () => {
    const sim = new FlightSimulation({ world: WORLD });
    expect(sim.holdAt('TEACH')).toBe(true);
    expect(sim.phase).toBe('takeoff');
    runUntil(sim, () => sim.phase === 'hold', 400);
    expect(sim.phase).toBe('hold');
    expect(sim.fms.wheelHeight).toBeGreaterThan(250);
    // Fly to the fix and settle into the orbit.
    runFor(sim, 360);
    const hold = sim.fms.hold!;
    expect(hold.fix.ident).toBe('TEACH');
    expect(Math.abs(sim.distanceTo(hold.fix) - hold.radius)).toBeLessThan(200);
    expect(Math.abs(sim.state[S.Y]! - hold.altitude)).toBeLessThan(15);
    expect(sim.fms.fma.lateral).toBe('HOLD');
  });

  it('resumes the flight plan after a hold and lands without incident', () => {
    const sim = new FlightSimulation({ world: WORLD });
    sim.holdAt('LOGBK');
    runUntil(sim, () => sim.phase === 'hold', 400);
    runFor(sim, 240);
    sim.resume();
    expect(sim.fms.hold).toBeNull();
    const next = sim.plan.legs[sim.fms.legIndex]!;
    expect(next.ident).toBe('TEACH');
    runUntil(sim, () => sim.phase === 'parked', 2400);
    expect(sim.phase).toBe('parked');
    expect(sim.incidents).toBe(0);
  });

  it('flies direct to a fix further down the route', () => {
    const sim = new FlightSimulation({ world: WORLD });
    expect(sim.directTo('RADIO')).toBe(false); // not on the runway
    runUntil(sim, () => sim.phase === 'cruise', 600);
    expect(sim.directTo('RADIO')).toBe(true);
    expect(sim.plan.legs[sim.fms.legIndex]!.ident).toBe('RADIO');
    runUntil(sim, () => sim.plan.legs[sim.fms.legIndex]!.ident !== 'RADIO', 900);
    expect(sim.distanceTo(sim.findFix('RADIO')!)).toBeLessThan(3 * NM);
    runUntil(sim, () => sim.phase === 'parked', 2400);
    expect(sim.incidents).toBe(0);
  });

  it('ignores unknown fixes', () => {
    const sim = new FlightSimulation({ world: WORLD });
    expect(sim.holdAt('NOWHERE')).toBe(false);
    expect(sim.directTo('NOWHERE')).toBe(false);
  });
});

describe('integration', () => {
  it('is deterministic, bit for bit', () => {
    const a = new FlightSimulation({ world: WORLD });
    const b = new FlightSimulation({ world: WORLD });
    runFor(a, 300);
    runFor(b, 300);
    expect(Array.from(a.state)).toEqual(Array.from(b.state));
  });

  it('gives the same physics at any frame rate', () => {
    const fixed = new FlightSimulation({ world: WORLD });
    const jittery = new FlightSimulation({ world: WORLD });
    const steps = 20_000;
    for (let i = 0; i < steps; i++) fixed.step();
    // Irregular frame times, each shorter than one physics step.
    let seed = 42;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    while (jittery.steps < steps) jittery.advance(jittery.dt * (0.1 + 0.8 * rand()));
    expect(Array.from(jittery.state)).toEqual(Array.from(fixed.state));
  });

  it('can start partway through a flight (warm-up), still deterministically', () => {
    const a = new FlightSimulation({ world: WORLD, warmup: 240 });
    const b = new FlightSimulation({ world: WORLD });
    runFor(b, 240);
    expect(Array.from(a.state)).toEqual(Array.from(b.state));
    expect(a.phase).not.toBe('takeoff');
  });

  it('keeps a bounded 10 Hz history for the strip chart', () => {
    const sim = new FlightSimulation({ world: WORLD });
    runFor(sim, 45);
    expect(sim.history.length).toBe(300);
    let last = -Infinity;
    sim.history.forEach((s) => {
      expect(s.t).toBeGreaterThan(last);
      last = s.t;
    });
    const age = sim.time - sim.history.latest()!.t;
    expect(age).toBeGreaterThanOrEqual(0);
    expect(age).toBeLessThan(0.1 + 1e-9);
  });
});
