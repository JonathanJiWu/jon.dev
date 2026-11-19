import { describe, expect, it } from 'vitest';
import { offset } from '../sim/navdata';
import { AIRPORTS, ROUTE_FIXES } from './navdata';
import { AIRPORT_SITES, FIELD_ELEVATION, runwayFrame, terrainHeight } from './terrain';

const NM = 1852;

describe('terrain', () => {
  it('is a pure function of position', () => {
    for (const [x, z] of [[0, 0], [1234.5, -987.25], [-15_000, 9000]] as const) {
      expect(terrainHeight(x, z)).toBe(terrainHeight(x, z));
    }
  });

  it('is flat at field elevation along every runway', () => {
    for (const site of AIRPORT_SITES) {
      for (const r of site.runways) {
        for (let u = -r.length / 2; u <= r.length / 2; u += 100) {
          for (const v of [-r.width, 0, r.width]) {
            const x = r.x + u * Math.sin(r.heading) - v * Math.cos(r.heading);
            const z = r.z - u * Math.cos(r.heading) - v * Math.sin(r.heading);
            expect(Math.abs(runwayFrame(r, x, z).u - u)).toBeLessThan(1e-9);
            expect(terrainHeight(x, z)).toBeCloseTo(FIELD_ELEVATION[site.ident]!, 6);
          }
        }
      }
    }
  });

  it('keeps every approach path clear: under half the 3° glide path, out to 8 NM', () => {
    for (const airport of AIRPORTS) {
      for (const rw of airport.runways) {
        for (let d = 300; d <= 8 * NM; d += 250) {
          const p = offset(rw.threshold, rw.heading + Math.PI, d);
          const glide = 15 + d * Math.tan((3 * Math.PI) / 180);
          expect(terrainHeight(p.x, p.z) - rw.elevation).toBeLessThan(0.5 * glide + 1);
        }
      }
    }
  });

  it('leaves the route fixes far below the cruise altitudes', () => {
    for (const fix of ROUTE_FIXES) {
      let highest = -Infinity;
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 16) {
        highest = Math.max(highest, terrainHeight(fix.x + 2500 * Math.sin(a), fix.z - 2500 * Math.cos(a)));
      }
      expect(3000 * 0.3048 - highest).toBeGreaterThan(300);
    }
  });

  it('raises mountains on the horizon', () => {
    let peak = -Infinity;
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 90) {
      peak = Math.max(peak, terrainHeight(56_000 * Math.sin(a), -500 - 56_000 * Math.cos(a)));
    }
    expect(peak).toBeGreaterThan(1000);
  });
});
