import { describe, expect, it } from 'vitest';
import { ISA, density } from './atmosphere';
import { stallAlpha, TRANSPORT } from './aircraft';
import { DEFAULT_GAINS } from './autopilot';
import { S } from './dynamics';
import { FlightSimulation, type Waypoint } from './simulation';
import { smoothstep } from './math';
import { ROUTE } from '../world/route';
import { terrainHeight } from '../world/terrain';

const newSim = () => new FlightSimulation({ waypoints: ROUTE, start: 'home', terrainHeight });

/** Track the flight envelope while running. */
function envelope(sim: FlightSimulation) {
  const e = { maxBank: 0, maxAlpha: -Infinity, minSpeedOverStall: Infinity, minHeightAgl: Infinity };
  return {
    e,
    sample() {
      const s = sim.state;
      e.maxBank = Math.max(e.maxBank, Math.abs(s[S.PHI]!));
      e.maxAlpha = Math.max(e.maxAlpha, s[S.ALPHA]!);
      const rho = density(s[S.Y]!);
      const vStall = Math.sqrt((2 * TRANSPORT.mass * ISA.g0) / (rho * TRANSPORT.wingArea * TRANSPORT.clMax));
      e.minSpeedOverStall = Math.min(e.minSpeedOverStall, s[S.V]! / vStall);
      e.minHeightAgl = Math.min(e.minHeightAgl, s[S.Y]! - terrainHeight(s[S.X]!, s[S.Z]!));
    },
  };
}

function runFor(sim: FlightSimulation, seconds: number, each?: () => void): void {
  const n = Math.round(seconds / sim.dt);
  for (let i = 0; i < n; i++) {
    sim.step();
    each?.();
  }
}

function runUntil(sim: FlightSimulation, done: () => boolean, maxSeconds: number, each?: () => void): number {
  const t0 = sim.time;
  while (!done() && sim.time - t0 < maxSeconds) {
    sim.step();
    each?.();
  }
  return sim.time - t0;
}

function expectWithinEnvelope(e: ReturnType<typeof envelope>['e']): void {
  expect(e.maxBank).toBeLessThanOrEqual(DEFAULT_GAINS.bankLimit + 0.01);
  expect(e.maxAlpha).toBeLessThan(stallAlpha(TRANSPORT));
  expect(e.minSpeedOverStall).toBeGreaterThan(1.2);
  expect(e.minHeightAgl).toBeGreaterThan(200);
}

describe('flight simulation + autopilot', () => {
  it('starts trimmed in the hold and stays on it', () => {
    const sim = newSim();
    const env = envelope(sim);
    runFor(sim, 120, env.sample);
    const st = sim.autopilot.status;
    expect(sim.mode).toBe('orbit');
    expect(Math.abs(st.trackError)).toBeLessThan(15);
    expect(Math.abs(st.altitudeError)).toBeLessThan(3);
    expect(Math.abs(st.speedError)).toBeLessThan(0.3);
    expectWithinEnvelope(env.e);
  });

  it('flies direct to every waypoint in turn, captures and holds', () => {
    const sim = newSim();
    const env = envelope(sim);
    for (const stop of ROUTE.slice(1)) {
      expect(sim.setTarget(stop.id)).toBe(true);
      const took = runUntil(sim, () => sim.mode === 'orbit', 300, env.sample);
      expect(took).toBeLessThan(300);
      // Settle on the hold, then check it is tracked accurately.
      runFor(sim, 90, env.sample);
      expect(Math.abs(sim.autopilot.status.trackError)).toBeLessThan(25);
      expect(Math.abs(sim.state[S.Y]! - sim.altitudeCmd)).toBeLessThan(5);
    }
    expectWithinEnvelope(env.e);
  });

  it('ignores a target it is already flying to', () => {
    const sim = newSim();
    expect(sim.setTarget('home')).toBe(false);
    expect(sim.setTarget('nowhere')).toBe(false);
  });

  it('is deterministic, bit for bit', () => {
    const a = newSim();
    const b = newSim();
    a.setTarget('work');
    b.setTarget('work');
    runFor(a, 60);
    runFor(b, 60);
    expect(Array.from(a.state)).toEqual(Array.from(b.state));
  });

  it('gives the same physics at any frame rate', () => {
    const fixed = newSim();
    const jittery = newSim();
    fixed.setTarget('about');
    jittery.setTarget('about');
    const steps = 5000;
    for (let i = 0; i < steps; i++) fixed.step();
    // Irregular frame times, each shorter than one physics step.
    let seed = 42;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    while (jittery.steps < steps) jittery.advance(jittery.dt * (0.1 + 0.8 * rand()));
    expect(Array.from(jittery.state)).toEqual(Array.from(fixed.state));
  });

  it('climbs over rising terrain ahead', () => {
    const ridge = (x: number) => 200 * smoothstep(3500, 4200, x) * (1 - smoothstep(4600, 5300, x));
    const waypoints: Waypoint[] = [
      { id: 'a', fix: 'AAAAA', x: 0, z: 0, altitude: 300, orbitRadius: 1200 },
      { id: 'b', fix: 'BBBBB', x: 9000, z: 0, altitude: 300, orbitRadius: 1200 },
    ];
    const sim = new FlightSimulation({ waypoints, start: 'a', terrainHeight: (x) => ridge(x) });
    sim.setTarget('b');
    let minAgl = Infinity;
    runUntil(sim, () => sim.mode === 'orbit', 400, () => {
      minAgl = Math.min(minAgl, sim.state[S.Y]! - ridge(sim.state[S.X]!));
    });
    expect(sim.mode).toBe('orbit');
    expect(minAgl).toBeGreaterThan(150);
  });

  it('keeps a bounded 10 Hz history for the strip chart', () => {
    const sim = newSim();
    runFor(sim, 45);
    expect(sim.history.length).toBe(300);
    let last = -Infinity;
    sim.history.forEach((s) => {
      expect(s.t).toBeGreaterThan(last);
      last = s.t;
    });
    // Sampled every 0.1 s, so the newest sample is at most one period old.
    const age = sim.time - sim.history.latest()!.t;
    expect(age).toBeGreaterThanOrEqual(0);
    expect(age).toBeLessThan(0.1 + 1e-9);
  });
});
