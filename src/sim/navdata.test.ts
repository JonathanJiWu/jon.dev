import { describe, expect, it } from 'vitest';
import { DEG, wrapPi } from './math';
import {
  type Airport,
  bearing,
  distance,
  offset,
  runwayDesignator,
  runwayEnds,
  selectRunway,
  toMagnetic,
  toTrue,
  windComponents,
  windTriangle,
  windVector,
} from './navdata';

const KT = 0.514_444;

describe('navigation geometry', () => {
  it('measures bearings clockwise from north (x east, z south)', () => {
    const o = { x: 0, z: 0 };
    expect(bearing(o, { x: 0, z: -1 })).toBeCloseTo(0);
    expect(bearing(o, { x: 1, z: 0 })).toBeCloseTo(Math.PI / 2);
    expect(bearing(o, { x: 0, z: 1 })).toBeCloseTo(Math.PI);
    expect(bearing(o, { x: -1, z: 0 })).toBeCloseTo(1.5 * Math.PI);
  });

  it('offsets a point along a course', () => {
    const a = { x: 100, z: 200 };
    const b = offset(a, 30 * DEG, 5000);
    expect(distance(a, b)).toBeCloseTo(5000, 6);
    expect(bearing(a, b)).toBeCloseTo(30 * DEG, 9);
  });

  it('converts between true and magnetic (variation east-positive)', () => {
    const tenWest = -10 * DEG;
    expect(toMagnetic(260 * DEG, tenWest) / DEG).toBeCloseTo(270);
    expect(toTrue(270 * DEG, tenWest) / DEG).toBeCloseTo(260);
    expect(toMagnetic(355 * DEG, tenWest) / DEG).toBeCloseTo(5);
  });

  it('names runways from the magnetic heading, 01–36', () => {
    expect(runwayDesignator(266 * DEG)).toBe('27');
    expect(runwayDesignator(44 * DEG)).toBe('04');
    expect(runwayDesignator(4 * DEG)).toBe('36');
    expect(runwayDesignator(184 * DEG)).toBe('18');
  });

  it('builds both ends of a runway, reciprocal and a runway length apart', () => {
    const [a, b] = runwayEnds('TEST', { x: 0, z: 0 }, 80 * DEG, 2000, 45, 100, -10 * DEG);
    expect(a.ident).toBe('09');
    expect(b.ident).toBe('27');
    expect(distance(a.threshold, b.threshold)).toBeCloseTo(2000, 6);
    expect(bearing(a.threshold, a.end)).toBeCloseTo(a.heading, 9);
    expect(Math.abs(wrapPi(b.heading - a.heading))).toBeCloseTo(Math.PI, 9);
  });
});

describe('wind', () => {
  it('blows from the reported direction', () => {
    const w = windVector({ from: 270 * DEG, speed: 10 }); // a westerly moves the air east
    expect(w.x).toBeCloseTo(10);
    expect(w.z).toBeCloseTo(0);
  });

  it('splits into headwind and crosswind (crosswind + from the right)', () => {
    const c = windComponents({ from: 300 * DEG, speed: 20 }, 270 * DEG);
    expect(c.headwind).toBeCloseTo(20 * Math.cos(30 * DEG));
    expect(c.crosswind).toBeCloseTo(20 * Math.sin(30 * DEG));
    expect(windComponents({ from: 90 * DEG, speed: 20 }, 270 * DEG).headwind).toBeCloseTo(-20);
  });

  it('solves the wind triangle like an E6B', () => {
    // TAS 120 kt, course 360°, wind 090°/20 kt: correct 9.6° right, ground speed 118.3 kt.
    const tas = 120 * KT;
    const r = windTriangle({ from: 90 * DEG, speed: 20 * KT }, 0, tas);
    expect(r.wca / DEG).toBeCloseTo(9.59, 1);
    expect(r.groundSpeed / KT).toBeCloseTo(118.32, 1);
    // Flying that heading through that wind really does make good the course.
    const w = windVector({ from: 90 * DEG, speed: 20 * KT });
    const vx = tas * Math.sin(r.heading) + w.x;
    const vz = -tas * Math.cos(r.heading) + w.z;
    expect(Math.atan2(vx, -vz)).toBeCloseTo(0, 9);
    expect(Math.hypot(vx, vz)).toBeCloseTo(r.groundSpeed, 9);
  });
});

describe('runway selection', () => {
  const airport: Airport = {
    ident: 'TEST',
    name: 'Test',
    x: 0,
    z: 0,
    elevation: 100,
    runways: [
      ...runwayEnds('TEST', { x: 0, z: 0 }, 90 * DEG, 2500, 45, 100, 0),
      ...runwayEnds('TEST', { x: 500, z: 500 }, 0, 1500, 45, 100, 0),
    ],
  };

  it('picks the runway most into the wind', () => {
    expect(selectRunway(airport, { from: 260 * DEG, speed: 10 }, 1000).runway.ident).toBe('27');
    expect(selectRunway(airport, { from: 80 * DEG, speed: 10 }, 1000).runway.ident).toBe('09');
    expect(selectRunway(airport, { from: 175 * DEG, speed: 10 }, 1000).runway.ident).toBe('18');
  });

  it('skips runways that are too short', () => {
    const choice = selectRunway(airport, { from: 175 * DEG, speed: 10 }, 2000);
    expect(choice.runway.length).toBe(2500);
  });

  it('uses the longest runway when the wind is calm', () => {
    expect(selectRunway(airport, { from: 0, speed: 0 }, 1000).runway.length).toBe(2500);
  });
});
