import { describe, expect, it } from 'vitest';
import { airData } from './atmosphere';
import { TRANSPORT } from './aircraft';
import { pressureAltitude, Systems } from './systems';

const p = TRANSPORT;
const FT = 0.3048;
const FPM = FT / 60;
const PSI = 6894.757;
const DT = 1 / 60;

describe('aircraft systems', () => {
  it('burns fuel at the fuel flow', () => {
    const sys = new Systems(p, 8000, 100);
    for (let i = 0; i < 600 * 60; i++) sys.update(DT, { altitude: 1000, onGround: false, thrust: 0.6, landingElevation: 100, descending: false });
    expect(sys.fuelUsed).toBeCloseTo((sys.fuelFlow(0.6) * 600) / 3600, 3);
    expect(sys.mass()).toBeCloseTo(p.emptyMass + p.payload + sys.fuel, 9);
  });

  it('moves the gear and flaps at their transit rates', () => {
    const sys = new Systems(p, 8000, 100);
    sys.gearCmd = 0;
    sys.flapsCmd = 1;
    const input = { altitude: 500, onGround: false, thrust: 0.5, landingElevation: 100, descending: false };
    for (let t = 0; t < p.gearTransitTime / 2 - 1e-9; t += DT) sys.update(DT, input);
    expect(sys.gear).toBeCloseTo(0.5, 2);
    for (let t = 0; t < p.flapTransitTime; t += DT) sys.update(DT, input);
    expect(sys.gear).toBe(0);
    expect(sys.flaps).toBe(1);
  });

  it('inverts the barometric formula for pressure altitude', () => {
    for (const h of [0, 500, 3000, 8000]) expect(pressureAltitude(airData(h).pressure)).toBeCloseTo(h, 6);
  });

  it('pressurizes within its limits through a climb, cruise and descent', () => {
    const field = 150;
    const sys = new Systems(p, 8000, field);
    let alt = field;
    let maxDiff = 0;
    let maxClimb = 0;
    let maxDescent = 0;
    let maxCabin = 0;
    const step = (vs: number, seconds: number, descending: boolean) => {
      for (let t = 0; t < seconds; t += DT) {
        alt += vs * DT;
        sys.update(DT, { altitude: alt, onGround: false, thrust: 0.7, landingElevation: field, descending });
        maxDiff = Math.max(maxDiff, sys.cabin.differential);
        maxClimb = Math.max(maxClimb, sys.cabin.rate);
        maxDescent = Math.min(maxDescent, sys.cabin.rate);
        maxCabin = Math.max(maxCabin, sys.cabin.altitude);
      }
    };
    // Takeoff roll (pre-pressurizing), then a climb to FL250.
    for (let t = 0; t < 30; t += DT) sys.update(DT, { altitude: field, onGround: true, thrust: 1, landingElevation: field, descending: false });
    step(1500 * FPM, (25_000 * FT - field) / (1500 * FPM), false);
    step(0, 600, false);
    step(-1000 * FPM, (25_000 * FT - field) / (1000 * FPM), true); // and back down
    expect(maxDiff).toBeLessThan(7.5 * PSI + 200);
    expect(maxCabin).toBeLessThan(8000 * FT + 30);
    expect(maxClimb).toBeLessThan(500 * FPM * 1.1);
    expect(maxDescent).toBeGreaterThan(-350 * FPM * 1.1);
    // Down at the field, the cabin is at (or just below) field elevation: no pressure bump at touchdown.
    expect(sys.cabin.altitude).toBeLessThan(field + 20);
    expect(sys.cabin.altitude).toBeGreaterThan(field - 120);
  });

  it('vents the cabin to the outside on the ground', () => {
    const sys = new Systems(p, 8000, 150);
    // Landed with the cabin 300 ft below the field: it equalizes at no more than 500 fpm.
    sys.cabin.pressure = airData(150 - 300 * FT).pressure;
    sys.cabin.altitude = 150 - 300 * FT;
    let maxRate = 0;
    for (let t = 0; t < 60; t += DT) {
      sys.update(DT, { altitude: 150, onGround: true, thrust: 0, landingElevation: 150, descending: false });
      maxRate = Math.max(maxRate, sys.cabin.rate);
    }
    expect(sys.cabin.valve).toBe(1);
    expect(maxRate).toBeLessThan(500 * FPM * 1.01);
    expect(Math.abs(sys.cabin.differential)).toBeLessThan(5);
  });
});
