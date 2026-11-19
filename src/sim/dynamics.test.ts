import { describe, expect, it } from 'vitest';
import { density, ISA } from './atmosphere';
import { cl0At, inducedDragFactor, TRANSPORT } from './aircraft';
import {
  availableThrust,
  computeForces,
  type Controls,
  createContext,
  createForces,
  createState,
  type FlightContext,
  groundVelocity,
  Rk4Workspace,
  rk4Step,
  S,
  type State,
  thrustFor,
} from './dynamics';
import { DEG } from './math';

const p = TRANSPORT;
const MASS = p.emptyMass + p.payload + 8000;

/** Trim for a steady, level, coordinated turn at bank φ (φ = 0: straight and level). */
function trim(V: number, h: number, phi = 0, ctx: FlightContext = createContext(MASS)): { s: State; c: Controls; ctx: FlightContext } {
  const rho = density(h);
  const qS = 0.5 * rho * V * V * p.wingArea;
  const W = ctx.mass * ISA.g0;
  let alpha = 0.05;
  let thrust = 0;
  // Fixed-point iteration: the thrust's lift component and α depend on each other.
  for (let i = 0; i < 50; i++) {
    const cl = (W / Math.cos(phi) - thrust * Math.sin(alpha)) / qS;
    alpha = (cl - cl0At(p, ctx.flaps)) / p.clAlpha;
    const drag = qS * (p.cd0 + p.flapCd0 * ctx.flaps + p.gearCd0 * ctx.gear + inducedDragFactor(p) * cl * cl);
    thrust = drag / Math.cos(alpha);
  }
  const s = createState();
  s[S.Y] = h;
  s[S.V] = V;
  s[S.PHI] = phi;
  s[S.ALPHA] = alpha;
  s[S.THRUST] = thrust / availableThrust(p, rho, V);
  return { s, c: { bankCmd: phi, alphaCmd: alpha, throttle: s[S.THRUST]!, brake: 0 }, ctx };
}

function run(s: State, c: Controls, ctx: FlightContext, seconds: number, dt: number): void {
  const w = new Rk4Workspace();
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) rk4Step(p, s, c, ctx, dt, w);
}

describe('point-mass flight model', () => {
  it('holds steady level flight when trimmed', () => {
    const { s, c, ctx } = trim(100, 900);
    run(s, c, ctx, 20, 1 / 120);
    expect(Math.abs(s[S.Y]! - 900)).toBeLessThan(0.5);
    expect(Math.abs(s[S.V]! - 100)).toBeLessThan(0.02);
    expect(Math.abs(s[S.GAMMA]!)).toBeLessThan(1e-4);
    // Straight north: x unchanged, z = −V·t
    expect(Math.abs(s[S.X]!)).toBeLessThan(1e-6);
    expect(s[S.Z]!).toBeCloseTo(-100 * 20, 0);
  });

  it('turns at g·tan(φ)/V in a coordinated level turn', () => {
    const V = 100;
    const phi = 25 * DEG;
    const { s, c, ctx } = trim(V, 900, phi);
    run(s, c, ctx, 30, 1 / 120);
    expect(s[S.PSI]! / 30).toBeCloseTo((ISA.g0 * Math.tan(phi)) / V, 4);
    expect(Math.abs(s[S.Y]! - 900)).toBeLessThan(1);
  });

  it('integrates at fourth order (RK4 error falls ~16× per halving of dt)', () => {
    const solve = (dt: number): State => {
      const t = trim(100, 900);
      // Knock it off trim so the dynamics have something to do (all within smooth regions).
      t.s[S.V] = 92;
      t.s[S.GAMMA] = 0.03;
      t.s[S.ALPHA] = t.c.alphaCmd + 0.02;
      t.c.throttle = 0.6;
      run(t.s, t.c, t.ctx, 4, dt);
      return t.s;
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
    const { s, c, ctx } = trim(100, 1500);
    c.throttle = 0;
    s[S.THRUST] = 0;
    const energy = () => s[S.Y]! + (s[S.V]! * s[S.V]!) / (2 * ISA.g0);
    let last = energy();
    for (let t = 0; t < 30; t++) {
      run(s, c, ctx, 1, 1 / 120);
      const e = energy();
      expect(e).toBeLessThan(last);
      last = e;
    }
  });

  it('drifts with the wind: ground velocity is air velocity plus wind', () => {
    const ctx = createContext(MASS);
    ctx.windX = 8; // wind from the west, 8 m/s
    const { s, c } = trim(100, 900, 0, ctx);
    run(s, c, ctx, 60, 1 / 120);
    // Heading north through a westerly: drifts east by wind × time, ground track right of heading.
    expect(s[S.X]!).toBeCloseTo(8 * 60, 0);
    const gv = groundVelocity(s, ctx);
    expect(gv.speed).toBeCloseTo(Math.hypot(100, 8), 2);
    expect(gv.track).toBeCloseTo(Math.atan2(8, 100), 3);
  });

  it('gets more lift and more drag from flaps, more drag from the gear', () => {
    const s = trim(80, 300).s;
    const f = createForces();
    const clean = createContext(MASS);
    const flaps = { ...clean, flaps: 1 };
    const gear = { ...clean, gear: 1 };
    const a = { ...computeForces(p, s, clean, f) };
    const b = { ...computeForces(p, s, flaps, f) };
    const g = { ...computeForces(p, s, gear, f) };
    expect(b.lift).toBeGreaterThan(a.lift * 1.2);
    expect(b.drag).toBeGreaterThan(a.drag);
    expect(g.drag).toBeGreaterThan(a.drag);
    expect(g.lift).toBeCloseTo(a.lift, 6);
  });

  it('loses thrust with altitude and speed; reverse thrust pushes backward', () => {
    expect(availableThrust(p, density(3000), 0)).toBeLessThan(availableThrust(p, density(0), 0));
    expect(availableThrust(p, density(0), 100)).toBeLessThan(availableThrust(p, density(0), 0));
    expect(thrustFor(p, -1, density(0), 50) / (p.reverseFraction * p.maxThrust)).toBeCloseTo(-1, 6);
  });
});
