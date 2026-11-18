import { describe, expect, it } from 'vitest';
import { airData, density } from './atmosphere';

describe('ISA atmosphere', () => {
  it('matches standard sea-level values', () => {
    const a = airData(0);
    expect(a.temperature).toBeCloseTo(288.15, 6);
    expect(a.pressure).toBeCloseTo(101_325, 3);
    expect(a.density).toBeCloseTo(1.225, 3);
    expect(a.speedOfSound).toBeCloseTo(340.29, 1);
  });

  it('matches the standard table aloft', () => {
    expect(airData(1000).density).toBeCloseTo(1.1117, 3);
    expect(airData(3000).density).toBeCloseTo(0.9093, 3);
    expect(airData(11_000).temperature).toBeCloseTo(216.65, 2);
    expect(airData(11_000).pressure).toBeCloseTo(22_632, -1);
  });

  it('decreases monotonically with altitude', () => {
    let last = Infinity;
    for (let h = 0; h <= 11_000; h += 250) {
      const rho = density(h);
      expect(rho).toBeLessThan(last);
      last = rho;
    }
  });

  it('density fast path agrees with the full computation', () => {
    for (const h of [0, 432, 1234, 3000, 7777, 11_000]) {
      expect(density(h)).toBeCloseTo(airData(h).density, 10);
    }
  });
});
