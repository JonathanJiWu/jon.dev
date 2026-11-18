import { describe, expect, it } from 'vitest';
import { ISA, density } from './atmosphere';
import { inducedDragFactor, TRANSPORT } from './aircraft';
import { availableThrust, type Controls, createState, Rk4Workspace, rk4Step, S, type State } from './dynamics';
import { DEG } from './math';

const p = TRANSPORT;

/** Trim for a steady, level, coordinated turn at bank φ (φ = 0: straight and level). */
function trim(V: number, h: number, phi = 0): { s: State; c: Controls } {
  const rho = density(h);
  const qS = 0.5 * rho * V * V * p.wingArea;
  const W = p.mass * ISA.g0;
  let alpha = 0.05;
  let thrust = 0;
  // Fixed-point iteration: the thrust's lift component and α depend on each other.
  for (let i = 0; i < 50; i++) {
    const cl = (W / Math.cos(phi) - thrust * Math.sin(alpha)) / qS;
    alpha = (cl - p.cl0) / p.clAlpha;
    const drag = qS * (p.cd0 + inducedDragFactor(p) * cl * cl);
    thrust = drag / Math.cos(alpha);
  }
  const s = createState();
  s[S.Y] = h;
  s[S.V] = V;
  s[S.PHI] = phi;
  s[S.ALPHA] = alpha;
  s[S.THRUST] = thrust / availableThrust(p, rho);
  return { s, c: { bankCmd: phi, alphaCmd: alpha, throttle: s[S.THRUST]! } };
}

function run(s: State, c: Controls, seconds: number, dt: number): void {
  const w = new Rk4Workspace();
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) rk4Step(p, s, c, dt, w);
}

describe('point-mass flight model', () => {
  it('holds steady level flight when trimmed', () => {
    const { s, c } = trim(75, 800);
    run(s, c, 20, 1 / 120);
    expect(Math.abs(s[S.Y]! - 800)).toBeLessThan(0.5);
    expect(Math.abs(s[S.V]! - 75)).toBeLessThan(0.02);
    expect(Math.abs(s[S.GAMMA]!)).toBeLessThan(1e-4);
    // Straight north: x unchanged, z = -V·t
    expect(Math.abs(s[S.X]!)).toBeLessThan(1e-6);
    expect(s[S.Z]!).toBeCloseTo(-75 * 20, 0);
  });

  it('turns at g·tan(φ)/V in a coordinated level turn', () => {
    const V = 75;
    const phi = 25 * DEG;
    const { s, c } = trim(V, 800, phi);
    run(s, c, 30, 1 / 120);
    const expectedRate = (ISA.g0 * Math.tan(phi)) / V;
    expect(s[S.PSI]! / 30).toBeCloseTo(expectedRate, 4);
    expect(Math.abs(s[S.Y]! - 800)).toBeLessThan(1);
  });

  it('integrates at fourth order (RK4 error falls ~16x per halving of dt)', () => {
    const start = (): { s: State; c: Controls } => {
      const t = trim(75, 800);
      // Knock it off trim so the dynamics have something to do (all within smooth regions).
      t.s[S.V] = 68;
      t.s[S.GAMMA] = 0.03;
      t.s[S.ALPHA] = t.c.alphaCmd + 0.02;
      t.c.throttle = 0.6;
      return t;
    };
    const solve = (dt: number): State => {
      const { s, c } = start();
      run(s, c, 4, dt);
      return s;
    };
    const ref = solve(0.1 / 64);
    const err = (dt: number) => {
      const s = solve(dt);
      return Math.abs(s[S.Y]! - ref[S.Y]!) + Math.abs(s[S.V]! - ref[S.V]!) + Math.abs(s[S.Z]! - ref[S.Z]!);
    };
    const ratio = err(0.1) / err(0.05);
    expect(ratio).toBeGreaterThan(12);
    expect(ratio).toBeLessThan(20);
  });

  it('bleeds energy to drag in an unpowered glide', () => {
    const { s, c } = trim(75, 1500);
    c.throttle = 0;
    s[S.THRUST] = 0;
    const energy = () => s[S.Y]! + (s[S.V]! * s[S.V]!) / (2 * ISA.g0);
    let last = energy();
    for (let t = 0; t < 30; t++) {
      run(s, c, 1, 1 / 120);
      const e = energy();
      expect(e).toBeLessThan(last);
      last = e;
    }
  });
});
