import { describe, expect, it } from 'vitest';
import { followLine, followOrbit, type GuidanceOutput, type LinePath, type OrbitPath } from './guidance';
import { DEG } from './math';

const out = (): GuidanceOutput => ({ course: 0, error: 0 });
const lineGains = { approachAngle: 60 * DEG, k: 1 / 600 };
const orbitGains = { k: 3 };

// A path heading due north from the origin (north is -z).
const north: LinePath = { kind: 'line', ox: 0, oz: 0, dx: 0, dz: -1 };

describe('straight-line vector field', () => {
  it('commands the path course when on the path', () => {
    const g = followLine(north, 0, -500, lineGains, out());
    expect(g.course).toBeCloseTo(0, 10);
    expect(g.error).toBeCloseTo(0, 10);
  });

  it('turns back toward the path from either side', () => {
    const right = followLine(north, 200, -500, lineGains, out()); // east of a northbound path
    expect(right.error).toBeGreaterThan(0);
    expect(right.course).toBeLessThan(0); // left
    const left = followLine(north, -200, -500, lineGains, out());
    expect(left.course).toBeGreaterThan(0); // right
  });

  it('approaches at the configured angle from far away', () => {
    const g = followLine(north, 1e7, 0, lineGains, out());
    expect(g.course).toBeCloseTo(-60 * DEG, 3);
  });
});

describe('circular-orbit vector field', () => {
  const hold: OrbitPath = { kind: 'orbit', cx: 0, cz: 0, radius: 1000, direction: 1 };

  it('is tangent and clockwise on the circle', () => {
    expect(followOrbit(hold, 0, -1000, orbitGains, out()).course).toBeCloseTo(90 * DEG, 10); // north point → east
    expect(followOrbit(hold, 1000, 0, orbitGains, out()).course).toBeCloseTo(180 * DEG, 10); // east point → south
  });

  it('points at the centre from far outside', () => {
    expect(followOrbit(hold, 0, -1e7, orbitGains, out()).course).toBeCloseTo(180 * DEG, 3);
  });

  it('steers outward from inside', () => {
    const g = followOrbit(hold, 0, -10, orbitGains, out());
    expect(g.error).toBeLessThan(0);
    expect(g.course).toBeGreaterThan(0);
    expect(g.course).toBeLessThan(90 * DEG);
  });
});
