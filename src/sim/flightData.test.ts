import { describe, expect, it } from 'vitest';
import { airData, ISA } from './atmosphere';
import { S } from './dynamics';
import { FlightDataBus, formatClock, formatDuration, formatHeading } from './flightData';
import { DEG } from './math';
import { toMagnetic } from './navdata';
import { FlightSimulation } from './simulation';
import { M_TO_FT, MS_TO_KT } from './units';
import { WORLD } from '../world/navdata';

function runUntil(sim: FlightSimulation, bus: FlightDataBus, done: () => boolean, maxSeconds: number): void {
  const t0 = sim.time;
  let n = 0;
  while (!done() && sim.time - t0 < maxSeconds) {
    sim.step();
    if (++n % 12 === 0) bus.update(); // a 10 Hz display
  }
  bus.update();
}

describe('flight data', () => {
  it('reads zero vertical speed and radio altitude on the runway', () => {
    const sim = new FlightSimulation({ world: WORLD });
    const d = new FlightDataBus(sim).update();
    expect(d.onGround).toBe(true);
    expect(d.verticalSpeed).toBe(0);
    expect(d.radioAltitude).toBeLessThan(0.5);
    expect(d.phase).toBe('takeoff');
    expect(d.eteDestination).toBeCloseTo(sim.plan.ete, 6);
  });

  it('agrees with the simulation state in cockpit units', () => {
    const sim = new FlightSimulation({ world: WORLD });
    const bus = new FlightDataBus(sim);
    let cruising = 0;
    runUntil(sim, bus, () => (sim.phase === 'cruise' ? ++cruising : (cruising = 0)) > 120 * 30, 900);
    const d = bus.data;
    const s = sim.state;
    const air = airData(s[S.Y]!);
    expect(d.altitude).toBeCloseTo(s[S.Y]! * M_TO_FT, 6);
    expect(d.tas).toBeCloseTo(s[S.V]! * MS_TO_KT, 6);
    expect(d.ias).toBeCloseTo(d.tas * Math.sqrt(air.density / ISA.rho0), 6);
    expect(d.mach).toBeCloseTo(s[S.V]! / air.speedOfSound, 9);
    expect(d.heading).toBeCloseTo(toMagnetic(s[S.PSI]!, WORLD.variation) / DEG, 6);
    expect(d.bank).toBeCloseTo(s[S.PHI]! / DEG, 9);
    // Level flight: pitch ≈ angle of attack.
    expect(d.pitch).toBeCloseTo(d.aoa + d.fpa, 0);
    // The four engines' flows add up to the total, and the gauges stay in range.
    expect(d.engines.reduce((a, e) => a + e.fuelFlow, 0)).toBeCloseTo(d.fuelFlow, 6);
    for (const e of d.engines) {
      expect(e.torque).toBeGreaterThan(10);
      expect(e.torque).toBeLessThan(105);
      expect(e.np).toBe(100);
    }
    expect(d.endurance).toBeCloseTo((d.fuel / d.fuelFlow) * 3600, 6);
    expect(d.fuelAtDestination).toBeGreaterThan(d.reserveFuel);
    expect(d.selectedAltitude).toBeCloseTo(sim.plan.cruiseAltitude * M_TO_FT, 6);
    expect(d.fma).toEqual({ thrust: 'SPD', lateral: 'LNAV', vertical: 'VNAV ALT' });
    expect(Math.abs(d.crossTrack)).toBeLessThan(0.3);
  });

  it('estimates the time to destination from the ground speed and the plan', () => {
    const sim = new FlightSimulation({ world: WORLD });
    const bus = new FlightDataBus(sim);
    runUntil(sim, bus, () => sim.phase === 'cruise' && sim.time > 400, 900);
    const predicted = bus.data.eteDestination;
    const t0 = sim.time;
    runUntil(sim, bus, () => sim.onGround, 1800);
    const actual = sim.time - t0;
    expect(Math.abs(actual - predicted) / predicted).toBeLessThan(0.15);
  });

  it('shows the aircraft on the glide path in the final approach', () => {
    const sim = new FlightSimulation({ world: WORLD });
    const bus = new FlightDataBus(sim);
    // Two miles out on final: configured and stable.
    runUntil(sim, bus, () => sim.phase === 'final' && sim.fms.toActive < 2 * 1852, 1800);
    const d = bus.data;
    expect(d.fma.vertical).toBe('G/P');
    expect(Math.abs(d.verticalDots!)).toBeLessThan(0.5);
    expect(Math.abs(d.lateralDots!)).toBeLessThan(0.5);
    expect(d.gear).toBe(1);
    expect(d.flaps).toBe(1);
    expect(d.landingLights).toBe(true);
    expect(Math.abs(d.ias - d.vapp)).toBeLessThan(6);
  });
});

describe('display formatting', () => {
  it('formats clock times, durations and headings', () => {
    expect(formatClock(19 * 3600 + 5 * 60 + 7)).toBe('19:05');
    expect(formatClock(19 * 3600 + 5 * 60 + 7, true)).toBe('19:05:07');
    expect(formatClock(86_400 + 60)).toBe('00:01');
    expect(formatDuration(65)).toBe('1:05');
    expect(formatDuration(3725)).toBe('1:02:05');
    expect(formatHeading(0)).toBe('360');
    expect(formatHeading(4.6)).toBe('005');
    expect(formatHeading(359.7)).toBe('360');
  });
});
