import { describe, expect, it } from 'vitest';
import { AIRFIELD, FIELD_ELEVATION, runwayFrame, terrainHeight } from './terrain';
import { ROUTE } from './route';

describe('terrain', () => {
  it('is a pure function of position', () => {
    for (const [x, z] of [[0, 0], [1234.5, -987.25], [-15_000, 9000]] as const) {
      expect(terrainHeight(x, z)).toBe(terrainHeight(x, z));
    }
  });

  it('is flat along the runway', () => {
    for (let u = -AIRFIELD.length / 2; u <= AIRFIELD.length / 2; u += 100) {
      for (const v of [-AIRFIELD.width, 0, AIRFIELD.width]) {
        const x = AIRFIELD.x + u * Math.sin(AIRFIELD.heading) - v * Math.cos(AIRFIELD.heading);
        const z = AIRFIELD.z - u * Math.cos(AIRFIELD.heading) - v * Math.sin(AIRFIELD.heading);
        expect(Math.abs(runwayFrame(x, z).u - u)).toBeLessThan(1e-9);
        expect(terrainHeight(x, z)).toBeCloseTo(FIELD_ELEVATION, 6);
      }
    }
  });

  it('leaves every hold well clear of the ground', () => {
    for (const stop of ROUTE) {
      let highest = -Infinity;
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 32) {
        const x = stop.x + stop.orbitRadius * Math.sin(a);
        const z = stop.z - stop.orbitRadius * Math.cos(a);
        highest = Math.max(highest, terrainHeight(x, z));
      }
      expect(stop.altitude - highest).toBeGreaterThan(300);
    }
  });

  it('raises mountains on the horizon', () => {
    let peak = -Infinity;
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 90) {
      peak = Math.max(peak, terrainHeight(400 + 17_000 * Math.sin(a), -1200 - 17_000 * Math.cos(a)));
    }
    expect(peak).toBeGreaterThan(1000);
  });
});
