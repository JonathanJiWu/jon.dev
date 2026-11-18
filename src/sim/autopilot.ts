import { density, ISA } from './atmosphere';
import { type AircraftParams, inducedDragFactor } from './aircraft';
import { availableThrust, type Controls, S, type State } from './dynamics';
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
  orbit: OrbitGains;
  /** Bank command per unit course error [rad/rad]. */
  courseGain: number;
  bankLimit: number;
  /** Flight-path angle command per metre of altitude error [rad/m]. */
  altitudeGain: number;
  gammaLimit: number;
  /** Desired dγ/dt per unit γ error [1/s] (the inverted pitch channel's bandwidth). */
  gammaGain: number;
  /** Integral trim on γ error, absorbs model mismatch [rad α per rad·s]. */
  gammaKi: number;
  speedKp: number;
  speedKi: number;
}

export const DEFAULT_GAINS: AutopilotGains = {
  line: { approachAngle: 60 * DEG, k: 1 / 600 },
  orbit: { k: 3 },
  courseGain: 1.6,
  bankLimit: 30 * DEG,
  altitudeGain: 1 / 900,
  gammaLimit: 4 * DEG,
  gammaGain: 0.8,
  gammaKi: 0.4,
  speedKp: 0.05,
  speedKi: 0.01,
};

export interface AutopilotTarget {
  path: Path;
  altitude: number;
  airspeed: number;
}

/** What each loop is doing right now: the engineering view plots these. */
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
 *   lateral:  vector-field course → bank (with turn feedforward on orbits)
 *   vertical: altitude → flight-path angle → angle of attack, by dynamic inversion of
 *             the γ equation plus an integral trim
 *   speed:    airspeed → throttle, drag-and-climb feedforward plus PI
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
  private readonly guide: GuidanceOutput = { course: 0, error: 0 };

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
  }

  update(s: State, target: AutopilotTarget, dt: number, out: Controls): void {
    const p = this.p;
    const g = this.gains;
    const V = Math.max(s[S.V]!, 10);
    const h = s[S.Y]!;
    const gamma = s[S.GAMMA]!;
    const phi = s[S.PHI]!;
    const alpha = s[S.ALPHA]!;

    // Lateral
    let bankFeedforward = 0;
    if (target.path.kind === 'line') {
      followLine(target.path, s[S.X]!, s[S.Z]!, g.line, this.guide);
    } else {
      followOrbit(target.path, s[S.X]!, s[S.Z]!, g.orbit, this.guide);
      // Steady turn on the circle: tan φ = V² / (g·R)
      bankFeedforward = target.path.direction * Math.atan((V * V) / (ISA.g0 * target.path.radius));
    }
    const courseError = wrapPi(this.guide.course - s[S.PSI]!);
    const bankCmd = clamp(bankFeedforward + g.courseGain * courseError, -g.bankLimit, g.bankLimit);

    // Vertical
    const rho = density(h);
    const qS = 0.5 * rho * V * V * p.wingArea;
    const altitudeError = target.altitude - h;
    const gammaCmd = clamp(g.altitudeGain * altitudeError, -g.gammaLimit, g.gammaLimit);
    const gammaDotCmd = g.gammaGain * (gammaCmd - gamma);
    // Invert m·V·γ̇ = N·cos φ − m·g·cos γ for the normal force N we need,
    // then the lift coefficient, then the angle of attack.
    const normalRequired = (p.mass * (V * gammaDotCmd + ISA.g0 * Math.cos(gamma))) / Math.max(Math.cos(phi), 0.5);
    const thrust = s[S.THRUST]! * availableThrust(p, rho);
    const clRequired = (normalRequired - thrust * Math.sin(alpha)) / qS;
    const alphaFeedforward = (clRequired - p.cl0) / p.clAlpha;
    const alphaCmd = this.gammaPid.update(gammaCmd - gamma, dt, alphaFeedforward);

    // Speed
    const cl = clamp(p.cl0 + p.clAlpha * alpha, p.clMin, p.clMax);
    const drag = qS * (p.cd0 + inducedDragFactor(p) * cl * cl);
    const throttleFeedforward = (drag + p.mass * ISA.g0 * Math.sin(gamma)) / availableThrust(p, rho);
    const speedError = target.airspeed - V;
    const throttle = this.speedPid.update(speedError, dt, throttleFeedforward);

    out.bankCmd = bankCmd;
    out.alphaCmd = alphaCmd;
    out.throttle = throttle;

    const st = this.status;
    st.courseCmd = this.guide.course;
    st.courseError = courseError;
    st.trackError = this.guide.error;
    st.bankCmd = bankCmd;
    st.altitudeError = altitudeError;
    st.gammaCmd = gammaCmd;
    st.alphaCmd = alphaCmd;
    st.speedError = speedError;
    st.throttleCmd = throttle;
  }
}
