import { density, ISA } from './atmosphere';
import { type AircraftParams, cl0At, inducedDragFactor } from './aircraft';
import { availableThrust, type Controls, type FlightContext, groundVelocity, S, type State, thrustFor } from './dynamics';
import {
  followLine,
  followOrbit,
  type GuidanceOutput,
  type LineGains,
  type OrbitGains,
  type Path,
} from './guidance';
import { clamp, DEG, wrapPi } from './math';
import { Pid } from './pid';

export interface AutopilotGains {
  line: LineGains;
  /** Tighter line following for the final approach course. */
  localizer: LineGains;
  orbit: OrbitGains;
  /** Bank command per unit course error [rad/rad]. */
  courseGain: number;
  /** Flight-path angle command per metre of altitude error [rad/m]. */
  altitudeGain: number;
  /** Desired dγ/dt per unit γ error [1/s] (the inverted pitch channel's bandwidth). */
  gammaGain: number;
  /** Integral trim on γ error, absorbs model mismatch [rad α per rad·s]. */
  gammaKi: number;
  speedKp: number;
  speedKi: number;
  /** Speed-on-pitch: extra climb angle per m/s of excess speed [rad·s/m]. */
  speedPitchGain: number;
}

export const DEFAULT_GAINS: AutopilotGains = {
  line: { approachAngle: 60 * DEG, k: 1 / 600 },
  localizer: { approachAngle: 35 * DEG, k: 1 / 250 },
  orbit: { k: 3 },
  courseGain: 1.6,
  altitudeGain: 1 / 900,
  gammaGain: 0.8,
  gammaKi: 0.4,
  speedKp: 0.05,
  speedKi: 0.01,
  speedPitchGain: 0.012,
};

export type LateralTarget =
  | { mode: 'path'; path: Path; tight?: boolean }
  | { mode: 'heading'; heading: number }
  | { mode: 'wingsLevel' };

export type VerticalTarget =
  | { mode: 'altitude'; altitude: number; gammaMax: number; gammaMin: number }
  /** Follow a path: altitude on the path here, and the path's angle (negative = descending). */
  | { mode: 'path'; altitude: number; gamma: number }
  /** Climb or descend at whatever angle holds the target speed (thrust is fixed). */
  | { mode: 'speedOnPitch'; gammaMax: number; gammaMin: number }
  /** Exponential flare onto the runway: sink rate proportional to wheel height. */
  | { mode: 'flare'; wheelHeight: number }
  /** Directly command the angle of attack (rotation, ground). */
  | { mode: 'alpha'; alpha: number };

export type ThrustTarget = { mode: 'speed' } | { mode: 'fixed'; value: number };

export interface AutopilotTargets {
  lateral: LateralTarget;
  vertical: VerticalTarget;
  thrust: ThrustTarget;
  /** Target true airspeed [m/s]. */
  speed: number;
  bankLimit: number;
  /** Desired deceleration on the ground [m/s²]; 0 = no braking. */
  autobrake: number;
}

/** What each loop is doing right now: the engineering view and the FMA read these. */
export interface AutopilotStatus {
  courseCmd: number;
  courseError: number;
  /** Cross-track error on a line, radial error on an orbit [m]. */
  trackError: number;
  bankCmd: number;
  altitudeError: number;
  gammaCmd: number;
  alphaCmd: number;
  speedError: number;
  throttleCmd: number;
}

/**
 * Three loops, outer to inner:
 *   lateral:  vector-field course → bank, flown on the ground track (so it crabs into
 *             the wind), with turn feedforward on orbits
 *   vertical: a target flight-path angle (from altitude error, a path, a speed, or the
 *             flare law) → angle of attack, by dynamic inversion of the γ equation plus
 *             an integral trim
 *   speed:    airspeed → throttle, drag-and-climb feedforward plus PI; or a fixed setting
 */
export class Autopilot {
  readonly status: AutopilotStatus = {
    courseCmd: 0,
    courseError: 0,
    trackError: 0,
    bankCmd: 0,
    altitudeError: 0,
    gammaCmd: 0,
    alphaCmd: 0,
    speedError: 0,
    throttleCmd: 0,
  };

  private readonly gammaPid: Pid;
  private readonly speedPid: Pid;
  private readonly brakePid = new Pid(0.25, 0.2, 0, 0, 1);
  private readonly guide: GuidanceOutput = { course: 0, error: 0 };
  private lastGroundSpeed = 0;

  constructor(
    private readonly p: AircraftParams,
    readonly gains: AutopilotGains = DEFAULT_GAINS,
  ) {
    this.gammaPid = new Pid(0, gains.gammaKi, 0, p.alphaCmdMin, p.alphaCmdMax);
    this.speedPid = new Pid(gains.speedKp, gains.speedKi, 0, 0, 1);
  }

  reset(): void {
    this.gammaPid.reset();
    this.speedPid.reset();
    this.brakePid.reset();
  }

  update(s: State, ctx: FlightContext, t: AutopilotTargets, dt: number, out: Controls, onGround = false): void {
    const p = this.p;
    const g = this.gains;
    const V = Math.max(s[S.V]!, 10);
    const h = s[S.Y]!;
    const gamma = s[S.GAMMA]!;
    const phi = s[S.PHI]!;
    const alpha = s[S.ALPHA]!;
    const ground = groundVelocity(s, ctx);
    const st = this.status;

    // ---- Lateral
    let bankCmd = 0;
    if (t.lateral.mode === 'path') {
      let feedforward = 0;
      if (t.lateral.path.kind === 'line') {
        followLine(t.lateral.path, s[S.X]!, s[S.Z]!, t.lateral.tight ? g.localizer : g.line, this.guide);
      } else {
        followOrbit(t.lateral.path, s[S.X]!, s[S.Z]!, g.orbit, this.guide);
        // Steady turn on the circle, at the ground speed: tan φ = Vg² / (g·R)
        feedforward = t.lateral.path.direction * Math.atan((ground.speed * ground.speed) / (ISA.g0 * t.lateral.path.radius));
      }
      st.courseCmd = this.guide.course;
      st.courseError = wrapPi(this.guide.course - ground.track);
      st.trackError = this.guide.error;
      bankCmd = feedforward + g.courseGain * st.courseError;
    } else if (t.lateral.mode === 'heading') {
      st.courseCmd = t.lateral.heading;
      st.courseError = wrapPi(t.lateral.heading - s[S.PSI]!);
      st.trackError = 0;
      bankCmd = g.courseGain * st.courseError;
    } else {
      st.courseError = 0;
      st.trackError = 0;
    }
    bankCmd = clamp(bankCmd, -t.bankLimit, t.bankLimit);

    // ---- Vertical
    const rho = density(h);
    const qS = 0.5 * rho * V * V * p.wingArea;
    const thrust = thrustFor(p, s[S.THRUST]!, rho, V);
    let alphaCmd: number;
    let gammaCmd = 0;
    st.altitudeError = 0;
    if (t.vertical.mode === 'alpha') {
      alphaCmd = t.vertical.alpha;
      this.gammaPid.reset();
    } else {
      const vt = t.vertical;
      if (vt.mode === 'altitude') {
        st.altitudeError = vt.altitude - h;
        gammaCmd = clamp(g.altitudeGain * st.altitudeError, vt.gammaMin, vt.gammaMax);
      } else if (vt.mode === 'path') {
        st.altitudeError = vt.altitude - h;
        gammaCmd = vt.gamma + clamp(g.altitudeGain * 1.5 * st.altitudeError, -2 * DEG, 2 * DEG);
      } else if (vt.mode === 'speedOnPitch') {
        // Feedforward: the climb angle the excess thrust can sustain; then trade speed.
        const cl = clamp(cl0At(p, ctx.flaps) + p.clAlpha * alpha, p.clMin, 3);
        const drag = qS * (p.cd0 + p.flapCd0 * ctx.flaps + p.gearCd0 * ctx.gear + inducedDragFactor(p) * cl * cl);
        const sinG = clamp((thrust - drag) / (ctx.mass * ISA.g0), -0.25, 0.35);
        gammaCmd = clamp(Math.asin(sinG) + g.speedPitchGain * (V - t.speed), vt.gammaMin, vt.gammaMax);
      } else {
        // Flare: sink rate proportional to wheel height, h(t) ~ e^(−t/τ). τ ≈ 3.3 s matches
        // the glide path's sink rate at flare height, so the flare starts smoothly, and the
        // small offset puts the wheels on firmly rather than floating.
        const sink = -Math.max(vt.wheelHeight, 0) / 3.3 - 0.55;
        gammaCmd = clamp(Math.asin(clamp(sink / V, -0.08, 0)), -4.5 * DEG, 0);
      }
      st.gammaCmd = gammaCmd;
      const gammaDotCmd = g.gammaGain * (gammaCmd - gamma);
      // Invert m·V·γ̇ = N·cos φ − m·g·cos γ for the normal force, then the lift coefficient.
      const normalRequired = (ctx.mass * (V * gammaDotCmd + ISA.g0 * Math.cos(gamma))) / Math.max(Math.cos(phi), 0.5);
      const clRequired = (normalRequired - thrust * Math.sin(alpha)) / qS;
      const alphaFeedforward = (clRequired - cl0At(p, ctx.flaps)) / p.clAlpha;
      alphaCmd = this.gammaPid.update(gammaCmd - gamma, dt, alphaFeedforward);
    }

    // ---- Thrust
    st.speedError = t.speed - V;
    let throttle: number;
    if (t.thrust.mode === 'fixed') {
      throttle = t.thrust.value;
      this.speedPid.reset();
    } else {
      const cl = clamp(cl0At(p, ctx.flaps) + p.clAlpha * alpha, p.clMin, 3);
      const drag = qS * (p.cd0 + p.flapCd0 * ctx.flaps + p.gearCd0 * ctx.gear + inducedDragFactor(p) * cl * cl);
      const feedforward = (drag + ctx.mass * ISA.g0 * Math.sin(gamma)) / availableThrust(p, rho, V);
      throttle = this.speedPid.update(st.speedError, dt, feedforward);
    }

    // ---- Brakes: hold a deceleration rate on the ground.
    let brake = 0;
    if (onGround && t.autobrake > 0) {
      const decel = dt > 0 ? (this.lastGroundSpeed - ground.speed) / dt : 0;
      brake = this.brakePid.update(t.autobrake - decel, dt, 0.4);
    } else {
      this.brakePid.reset();
    }
    this.lastGroundSpeed = ground.speed;

    out.bankCmd = bankCmd;
    out.alphaCmd = alphaCmd;
    out.throttle = throttle;
    out.brake = brake;
    st.bankCmd = bankCmd;
    st.alphaCmd = alphaCmd;
    st.throttleCmd = throttle;
  }
}
