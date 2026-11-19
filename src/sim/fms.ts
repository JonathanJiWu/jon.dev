import { density, ISA } from './atmosphere';
import { type AircraftParams, vSpeeds } from './aircraft';
import type { AutopilotTargets } from './autopilot';
import { groundVelocity, type FlightContext, S, type State } from './dynamics';
import type { LinePath, OrbitPath } from './guidance';
import { clamp, DEG, wrapPi } from './math';
import { bearing, distance, type Fix, type Point, type RunwayEnd } from './navdata';
import { type FlightPlan, FT, KT, NM } from './planner';
import type { Systems } from './systems';

/**
 * Flight management: flies a FlightPlan through the phases of a real flight, choosing
 * the autopilot's modes and targets, and scheduling flaps and gear.
 *
 *   takeoff → climb → cruise → descent → approach → final → landing → parked
 *
 * Lateral navigation flies leg to leg with fly-by turn anticipation (the turn starts
 * early so the aircraft rolls out on the next leg). Vertical navigation captures the
 * planned cruise altitude, starts down at the top of descent onto a 3° path, then flies
 * the glide path. A hold at any fix can be requested (the page does this per section);
 * resuming continues the plan from the next fix.
 */

export type Phase = 'takeoff' | 'climb' | 'cruise' | 'descent' | 'approach' | 'final' | 'landing' | 'parked' | 'hold';

export interface Fma {
  thrust: 'TOGA' | 'THR CLB' | 'SPD' | 'IDLE' | 'REV' | '';
  /** FAC/G/P: final approach course and glide path, as on an RNAV approach (not ILS). */
  lateral: 'RWY' | 'LNAV' | 'FAC' | 'HOLD' | 'ROLLOUT' | '';
  vertical: 'TOGA' | 'VNAV SPD' | 'VNAV ALT' | 'VNAV PTH' | 'ALT' | 'G/P' | 'FLARE' | 'ROLLOUT' | '';
}

export interface Touchdown {
  sinkRate: number;
  /** Distance past the threshold [m]. */
  distance: number;
  speed: number;
}

const BANK = 25 * DEG;
const GLIDE = 3 * DEG;

export class Fms {
  plan!: FlightPlan;
  legIndex = 0;
  /** Start of the active leg: the previous fix, or present position after a direct-to. */
  legStart: Point = { x: 0, z: 0 };
  phase: Phase = 'takeoff';
  readonly fma: Fma = { thrust: '', lateral: '', vertical: '' };
  readonly targets: AutopilotTargets;
  hold: { fix: Fix; radius: number; altitude: number } | null = null;
  pendingHold: Fix | null = null;
  /** Seconds spent parked after landing. */
  parkedTime = 0;
  touchdown: Touchdown | null = null;
  /** Along-track distance to the active fix [m], and on to the destination. */
  toActive = 0;
  toDestination = 0;
  /** Vertical deviation from the path in use (+ above) [m]. */
  verticalDeviation = 0;
  /** Wheel height above the terrain (radio altitude) [m]. */
  wheelHeight = 0;
  private readonly line: LinePath = { kind: 'line', ox: 0, oz: 0, dx: 0, dz: -1 };
  private readonly orbit: OrbitPath = { kind: 'orbit', cx: 0, cz: 0, radius: 2000, direction: 1 };
  private vs = { vr: 0, v2: 0, vref: 0 };
  /** On a DF leg: keep re-aiming from present position until established on course. */
  private direct = false;

  constructor(private readonly p: AircraftParams) {
    this.targets = {
      lateral: { mode: 'wingsLevel' },
      vertical: { mode: 'alpha', alpha: 0 },
      thrust: { mode: 'fixed', value: 0 },
      speed: 0,
      bankLimit: BANK,
      autobrake: 0,
    };
  }

  get activeLeg() {
    return this.plan.legs[this.legIndex]!;
  }

  get departureRunway(): RunwayEnd {
    return this.plan.departure.runway;
  }

  get arrivalRunway(): RunwayEnd {
    return this.plan.arrival.runway;
  }

  /** The runway in use for ground operations right now. */
  get groundRunway(): RunwayEnd {
    return this.phase === 'takeoff' ? this.departureRunway : this.arrivalRunway;
  }

  load(plan: FlightPlan, mass: number): void {
    this.plan = plan;
    this.legIndex = 0;
    this.legStart = plan.departure.runway.threshold;
    this.phase = 'takeoff';
    this.hold = null;
    this.pendingHold = null;
    this.parkedTime = 0;
    this.touchdown = null;
    const v = vSpeeds(this.p, mass);
    this.vs = { vr: v.vr, v2: v.v2, vref: v.vref };
  }

  // ---- requests from the page

  /** Hold at a fix (the page's "fly to this section"). Deferred until safely airborne. */
  holdAt(fix: Fix, altitude: number): void {
    if (!this.airborneEnough()) {
      this.pendingHold = fix;
      return;
    }
    this.pendingHold = null;
    this.hold = { fix, radius: 0, altitude };
    this.phase = 'hold';
  }

  /** Leave a hold and continue the flight plan from the next fix. */
  resume(state: State): void {
    this.pendingHold = null;
    if (!this.hold) return;
    const held = this.hold.fix.ident;
    this.hold = null;
    const legs = this.plan.legs;
    let next = legs.findIndex((l) => l.ident === held);
    next = next >= 0 ? next + 1 : legs.findIndex((l) => l.role === 'enroute');
    next = clamp(next, 2, legs.length - 1);
    this.directToIndex(next, state);
  }

  /** Fly direct to a fix in the plan, then continue the plan. */
  directTo(ident: string, state: State): boolean {
    const i = this.plan.legs.findIndex((l) => l.ident === ident && l.type !== 'TO' && l.type !== 'VA');
    if (i < 0 || !this.airborneEnough()) return false;
    this.hold = null;
    this.pendingHold = null;
    this.directToIndex(i, state);
    return true;
  }

  private directToIndex(i: number, state: State): void {
    this.legIndex = i;
    this.legStart = { x: state[S.X]!, z: state[S.Z]! };
    this.direct = true;
    const leg = this.plan.legs[i]!;
    const h = state[S.Y]!;
    if (leg.role === 'final') this.phase = 'final';
    else if (leg.role === 'approach') this.phase = 'approach';
    else if (h < this.plan.cruiseAltitude - 60) this.phase = 'climb';
    else this.phase = 'cruise';
  }

  private airborneEnough(): boolean {
    return (this.phase === 'climb' || this.phase === 'cruise' || this.phase === 'descent' || this.phase === 'approach' || this.phase === 'hold') && this.wheelHeight > 250;
  }

  // ---- events from the simulation

  onLiftoff(): void {
    this.phase = 'climb';
    this.legIndex = 1;
    this.legStart = this.departureRunway.threshold;
  }

  onTouchdown(td: Touchdown): void {
    this.touchdown = td;
    this.phase = 'landing';
  }

  onStopped(): void {
    if (this.phase === 'landing') {
      this.phase = 'parked';
      this.parkedTime = 0;
    }
  }

  // ---- the main update, at the autopilot rate

  update(dt: number, s: State, ctx: FlightContext, sys: Systems, terrainHeight: (x: number, z: number) => number): void {
    const p = this.p;
    const t = this.targets;
    const x = s[S.X]!;
    const z = s[S.Z]!;
    const h = s[S.Y]!;
    const rho = density(h);
    const ias = s[S.V]! * Math.sqrt(rho / ISA.rho0);
    const tas = (iasTarget: number) => iasTarget * Math.sqrt(ISA.rho0 / rho);
    const gv = groundVelocity(s, ctx);
    this.wheelHeight = h - p.gearHeight - terrainHeight(x, z);
    const agl = this.wheelHeight;
    const vsi = s[S.V]! * Math.sin(s[S.GAMMA]!);
    t.bankLimit = agl < 150 ? 15 * DEG : BANK;
    t.autobrake = 0;

    if (this.pendingHold && this.airborneEnough()) this.holdAt(this.pendingHold, this.plan.cruiseAltitude);

    // Distances along the plan
    this.updateDistances(x, z);

    // Gear: up with a positive rate after takeoff; down before the FAF.
    if (this.phase === 'climb' && agl > 15 && vsi > 1) sys.gearCmd = 0;

    switch (this.phase) {
      case 'takeoff': {
        sys.flapsCmd = p.takeoffFlap;
        sys.gearCmd = 1;
        t.lateral = { mode: 'wingsLevel' };
        t.vertical = { mode: 'alpha', alpha: ias >= this.vs.vr ? p.rotationAlpha : 0 };
        t.thrust = { mode: 'fixed', value: 1 };
        t.speed = tas(this.vs.v2);
        this.setFma('TOGA', 'RWY', 'TOGA');
        break;
      }
      case 'climb': {
        const accel = agl > 1000 * FT;
        this.flyLateral(s, gv.speed, gv.track);
        t.thrust = { mode: 'fixed', value: accel ? p.climbThrust : 1 };
        t.speed = tas(accel ? p.climbSpeed : this.vs.v2 + 15 * KT);
        if (accel && ias > this.vs.v2 + 20 * KT) sys.flapsCmd = 0;
        t.vertical = { mode: 'speedOnPitch', gammaMax: 12 * DEG, gammaMin: 0.5 * DEG };
        this.setFma(accel ? 'THR CLB' : 'TOGA', this.legIndex <= 1 ? 'RWY' : 'LNAV', 'VNAV SPD');
        const capture = Math.max(30, Math.abs(vsi) * 6);
        if (this.plan.cruiseAltitude - h < capture && this.legIndex > 1) this.phase = 'cruise';
        break;
      }
      case 'cruise': {
        this.flyLateral(s, gv.speed, gv.track);
        sys.flapsCmd = 0;
        t.vertical = { mode: 'altitude', altitude: this.plan.cruiseAltitude, gammaMax: 4 * DEG, gammaMin: -4 * DEG };
        t.thrust = { mode: 'speed' };
        t.speed = tas(p.cruiseSpeed);
        this.setFma('SPD', 'LNAV', 'VNAV ALT');
        const d = this.distanceToDescentFix();
        const target = this.descentTarget();
        // Top of descent: the 3° path to the first approach fix starts here. (Null means
        // that fix has already been sequenced, e.g. after a direct-to: start down now.)
        if (d === null || d <= (h - target) / Math.tan(GLIDE)) this.phase = 'descent';
        break;
      }
      case 'descent': {
        this.flyLateral(s, gv.speed, gv.track);
        const d = this.distanceToDescentFix();
        const target = this.descentTarget();
        const onPath = d === null ? target : clamp(target + d * Math.tan(GLIDE), target, this.plan.cruiseAltitude);
        this.verticalDeviation = h - onPath;
        // You can't go down and slow down at once in a clean aircraft: approach flaps help.
        if (d !== null && d < 8 * NM && ias < 185 * KT) sys.flapsCmd = Math.max(sys.flapsCmd, p.approachFlap);
        t.vertical = { mode: 'path', altitude: onPath, gamma: onPath > target + 1 ? -GLIDE : 0 };
        t.thrust = { mode: 'speed' };
        t.speed = tas(d !== null && d < 6 * NM ? p.approachSpeed : p.descentSpeed);
        this.setFma('SPD', 'LNAV', 'VNAV PTH');
        if (d === null || this.legIndex > this.firstApproachIndex()) this.phase = 'approach';
        break;
      }
      case 'approach': {
        const leg = this.activeLeg;
        const onFinalCourse = leg.ident === this.plan.approach.faf.ident;
        if (onFinalCourse) this.flyFinal(s, false);
        else this.flyLateral(s, gv.speed, gv.track);
        if (ias < 185 * KT) sys.flapsCmd = Math.max(sys.flapsCmd, p.approachFlap);
        const toFaf = this.distanceToFix(this.plan.approach.faf.ident);
        if (toFaf !== null && toFaf < 2.5 * NM) sys.gearCmd = 1;
        const constraint = leg.constraint?.altitude ?? this.plan.approach.fafAltitude;
        t.vertical = { mode: 'altitude', altitude: Math.min(constraint, h + 1), gammaMax: 2 * DEG, gammaMin: -3.5 * DEG };
        t.thrust = { mode: 'speed' };
        t.speed = tas(p.approachSpeed);
        this.setFma('SPD', onFinalCourse ? 'FAC' : 'LNAV', 'ALT');
        if (leg.role === 'final') this.phase = 'final';
        break;
      }
      case 'final': {
        sys.gearCmd = 1;
        sys.flapsCmd = 1;
        const rw = this.arrivalRunway;
        // Along-final distance to the threshold (negative once past it).
        const along = -((x - rw.threshold.x) * Math.sin(rw.heading) - (z - rw.threshold.z) * Math.cos(rw.heading));
        const gs = rw.elevation + this.plan.approach.tch + along * Math.tan(GLIDE);
        this.verticalDeviation = h - p.gearHeight - gs;
        t.speed = tas(this.plan.speeds.vapp);
        if (agl <= 12) {
          t.lateral = { mode: 'wingsLevel' };
          t.vertical = { mode: 'flare', wheelHeight: agl };
          t.thrust = agl <= 6 ? { mode: 'fixed', value: 0 } : { mode: 'speed' };
          this.setFma(agl <= 6 ? 'IDLE' : 'SPD', 'FAC', 'FLARE');
        } else {
          this.flyFinal(s, true);
          t.vertical = { mode: 'path', altitude: gs + p.gearHeight, gamma: -GLIDE };
          t.thrust = { mode: 'speed' };
          this.setFma('SPD', 'FAC', 'G/P');
        }
        break;
      }
      case 'landing': {
        t.lateral = { mode: 'wingsLevel' };
        const nosewheelDown = s[S.ALPHA]! < 1 * DEG;
        t.vertical = { mode: 'alpha', alpha: 0 };
        const fast = gv.speed > 30 * KT;
        t.thrust = { mode: 'fixed', value: nosewheelDown && fast ? -0.75 : 0 };
        t.autobrake = nosewheelDown ? 2.0 : 0;
        this.setFma(nosewheelDown && fast ? 'REV' : 'IDLE', 'ROLLOUT', 'ROLLOUT');
        break;
      }
      case 'parked': {
        this.parkedTime += dt;
        t.lateral = { mode: 'wingsLevel' };
        t.vertical = { mode: 'alpha', alpha: 0 };
        t.thrust = { mode: 'fixed', value: 0 };
        t.autobrake = 3;
        sys.flapsCmd = 0;
        this.setFma('', '', '');
        break;
      }
      case 'hold': {
        const hold = this.hold!;
        const holdTas = tas(p.holdingSpeed);
        hold.radius = Math.max(1500, (holdTas * holdTas) / (ISA.g0 * Math.tan(BANK - 3 * DEG)));
        this.orbit.cx = hold.fix.x;
        this.orbit.cz = hold.fix.z;
        this.orbit.radius = hold.radius;
        t.lateral = { mode: 'path', path: this.orbit };
        t.vertical = { mode: 'altitude', altitude: hold.altitude, gammaMax: 6 * DEG, gammaMin: -5 * DEG };
        t.thrust = { mode: 'speed' };
        t.speed = holdTas;
        if (ias > this.vs.v2 + 20 * KT) sys.flapsCmd = 0;
        if (agl > 150) sys.gearCmd = 0;
        this.setFma('SPD', 'HOLD', 'ALT');
        break;
      }
    }
  }

  private setFma(thrust: Fma['thrust'], lateral: Fma['lateral'], vertical: Fma['vertical']): void {
    this.fma.thrust = thrust;
    this.fma.lateral = lateral;
    this.fma.vertical = vertical;
  }

  /** Lateral guidance for climb/cruise/descent/approach legs, with fly-by sequencing. */
  private flyLateral(s: State, groundSpeed: number, track: number): void {
    const legs = this.plan.legs;
    const leg = legs[this.legIndex]!;
    const x = s[S.X]!;
    const z = s[S.Z]!;

    if (leg.type === 'VA') {
      // Initial climb: track the extended runway centreline until 1,000 ft above the field.
      const rw = this.departureRunway;
      this.setLine(rw.threshold, rw.heading);
      this.targets.lateral = { mode: 'path', path: this.line };
      if (this.wheelHeight > 1000 * FT) {
        this.legIndex++;
        this.legStart = { x, z };
        this.direct = true;
      }
      return;
    }

    // A DF leg is flown from wherever the aircraft is: turn the short way to the fix,
    // and fix the line only once established on course.
    if (this.direct) {
      if (Math.abs(wrapPi(bearing({ x, z }, leg) - track)) > 12 * DEG) this.legStart = { x, z };
      else this.direct = false;
    }
    const course = bearing(this.legStart, leg);
    this.setLine(this.legStart, course);
    this.targets.lateral = { mode: 'path', path: this.line, tight: leg.role === 'approach' || leg.role === 'final' };

    // Fly-by: start the turn onto the next leg early enough to roll out on it. Before a
    // DF leg the fix is flown over instead, then the turn goes direct to the next fix.
    const next = legs[this.legIndex + 1];
    if (!next || leg.type === 'RW') return;
    const remaining = (leg.x - x) * Math.sin(course) - (leg.z - z) * Math.cos(course);
    const flyOver = next.type === 'DF';
    const turn = Math.abs(wrapPi(next.course - course));
    const radius = (groundSpeed * groundSpeed) / (ISA.g0 * Math.tan(BANK));
    const lead = flyOver ? 0 : clamp(radius * Math.tan(Math.min(turn, 150 * DEG) / 2), 150, 6000);
    if (remaining <= lead) {
      this.legIndex++;
      this.legStart = flyOver ? { x, z } : { x: leg.x, z: leg.z };
      this.direct = flyOver;
    }
  }

  /** The final approach course, tight line following onto the runway centreline. */
  private flyFinal(s: State, sequenceFaf: boolean): void {
    const rw = this.arrivalRunway;
    this.setLine(rw.threshold, rw.heading);
    // The line runs through the threshold along the landing direction; follow it from behind.
    this.line.ox = rw.threshold.x - Math.sin(rw.heading) * 20 * NM;
    this.line.oz = rw.threshold.z + Math.cos(rw.heading) * 20 * NM;
    this.targets.lateral = { mode: 'path', path: this.line, tight: true };
    // Passing the FAF moves the active leg to the runway.
    if (!sequenceFaf) {
      const faf = this.plan.approach.faf;
      const remaining = (faf.x - s[S.X]!) * Math.sin(rw.heading) - (faf.z - s[S.Z]!) * Math.cos(rw.heading);
      if (remaining <= 0) {
        this.legIndex = this.plan.legs.length - 1;
        this.legStart = faf;
      }
    }
  }

  private setLine(from: Point, course: number): void {
    this.line.ox = from.x;
    this.line.oz = from.z;
    this.line.dx = Math.sin(course);
    this.line.dz = -Math.cos(course);
  }

  private firstApproachIndex(): number {
    return this.plan.legs.findIndex((l) => l.role === 'arrival' || l.role === 'approach');
  }

  /** The altitude the 3° descent is aimed at (the first approach fix's). */
  private descentTarget(): number {
    const leg = this.plan.legs[this.firstApproachIndex()]!;
    return Math.min(leg.constraint?.altitude ?? this.plan.cruiseAltitude, this.plan.cruiseAltitude);
  }

  /** Distance along the plan to the first approach fix, or null once past it. */
  private distanceToDescentFix(): number | null {
    const i = this.firstApproachIndex();
    if (this.legIndex > i) return null;
    return this.distanceToFix(this.plan.legs[i]!.ident);
  }

  /** Along-plan distance from present position to a fix ahead [m], or null if behind. */
  distanceToFix(ident: string): number | null {
    const legs = this.plan.legs;
    const target = legs.findIndex((l, i) => i >= this.legIndex && l.ident === ident);
    if (target < 0) return null;
    let d = this.toActive;
    for (let i = this.legIndex + 1; i <= target; i++) d += legs[i]!.length;
    return d;
  }

  private updateDistances(x: number, z: number): void {
    const legs = this.plan.legs;
    const leg = legs[this.legIndex]!;
    this.toActive = Math.max(0, distance({ x, z }, leg));
    let d = this.toActive;
    for (let i = this.legIndex + 1; i < legs.length; i++) d += legs[i]!.length;
    this.toDestination = d;
  }
}
