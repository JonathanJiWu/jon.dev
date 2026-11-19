import { describe, expect, it } from 'vitest';
import { density, ISA } from './atmosphere';
import { TRANSPORT, vSpeeds } from './aircraft';
import { createContext, createControls, createState, S } from './dynamics';
import { groundStep, runwayFrame } from './ground';
import { DEG } from './math';
import { takeoffDistance } from './planner';

const p = TRANSPORT;
const MASS = p.emptyMass + p.payload + 8000;
const DT = 1 / 120;

function lineUp(headwind = 0) {
  const s = createState();
  const rw = runwayFrame(90 * DEG, 100);
  const ctx = createContext(MASS);
  ctx.flaps = p.takeoffFlap;
  ctx.gear = 1;
  ctx.windX = -headwind; // a headwind on an eastbound runway blows west
  s[S.Y] = 100 + p.gearHeight;
  s[S.PSI] = rw.heading;
  s[S.V] = headwind;
  return { s, rw, ctx, c: createControls() };
}

describe('ground roll', () => {
  it('accelerates to rotation speed in about the distance the planner predicts', () => {
    const { s, rw, ctx, c } = lineUp();
    const { vr } = vSpeeds(p, MASS);
    c.throttle = 1;
    let t = 0;
    while (s[S.V]! * Math.sqrt(density(100) / ISA.rho0) < vr && t < 120) {
      groundStep(p, s, c, ctx, rw, DT);
      t += DT;
    }
    const roll = s[S.X]!;
    const predicted = takeoffDistance(p, MASS, 100, 0) - 350; // minus the air segment
    expect(Math.abs(roll - predicted) / predicted).toBeLessThan(0.1);
    // Stayed on the runway's surface and centreline.
    expect(s[S.Y]).toBe(100 + p.gearHeight);
    expect(Math.abs(s[S.Z]!)).toBeLessThan(1e-6);
  });

  it('lifts off once the wing carries the weight', () => {
    const { s, rw, ctx, c } = lineUp();
    c.throttle = 1;
    const { vr } = vSpeeds(p, MASS);
    let liftoff = false;
    for (let t = 0; t < 90 && !liftoff; t += DT) {
      c.alphaCmd = s[S.V]! >= vr ? p.rotationAlpha : 0;
      liftoff = groundStep(p, s, c, ctx, rw, DT).liftoff;
    }
    expect(liftoff).toBe(true);
    expect(s[S.V]!).toBeGreaterThan(vr * 0.98);
  });

  it('measures airspeed as ground speed plus headwind', () => {
    const { s, rw, ctx, c } = lineUp(10);
    c.throttle = 0.5;
    let r = groundStep(p, s, c, ctx, rw, DT);
    for (let i = 0; i < 600; i++) r = groundStep(p, s, c, ctx, rw, DT);
    expect(s[S.V]! - r.groundSpeed).toBeCloseTo(10, 9);
  });

  it('brakes to a stop without ever rolling backward', () => {
    const { s, rw, ctx, c } = lineUp();
    s[S.V] = 60;
    c.brake = 1;
    let last = s[S.X]!;
    let stopped = false;
    for (let i = 0; i < 120 * 60 && !stopped; i++) {
      stopped = groundStep(p, s, c, ctx, rw, DT).stopped;
      expect(s[S.X]!).toBeGreaterThanOrEqual(last);
      last = s[S.X]!;
    }
    expect(stopped).toBe(true);
    expect(s[S.V]).toBe(0);
    // Roughly v²/(2·μ·g), allowing for aerodynamic drag and the lift that unloads the wheels.
    const ideal = (60 * 60) / (2 * (p.brakingFriction + p.rollingFriction) * ISA.g0);
    expect(s[S.X]!).toBeGreaterThan(0.6 * ideal);
    expect(s[S.X]!).toBeLessThan(1.6 * ideal);
  });
});
