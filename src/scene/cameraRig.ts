import { type PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { clamp, damp, lerp, lerpAngle } from '../sim/math';
import type { RenderState } from '../sim/simulation';

export type CameraMode = 'chase' | 'orbit' | 'cockpit';

/** The captain's eye point in the aircraft's frame (x right, y up, z aft) [m]. */
export const EYE = new Vector3(-0.55, 0.78, -11.35);

const CHASE = { az: -0.35, el: 0.19, dist: 178 };
const COCKPIT = { yaw: 0, pitch: -0.1, fov: 64 };
const TRANSITION = 1.4;

const smootherstep = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

/**
 * The camera, in three modes:
 *
 * - chase: behind and above, swinging after the aircraft's heading through damped
 *   smoothing (a turn is felt, not bolted on); drag to look around it, it drifts back;
 * - orbit: free, world-fixed; drag to orbit, zoom to any distance;
 * - cockpit: the captain's seat, rigid with the airframe; drag to look around, zoom the
 *   lens, or focus on an instrument.
 *
 * Switching modes blends position, orientation and lens over 1.4 s in the aircraft's own
 * frame, so a transition never lags behind an aircraft doing 100 m/s.
 */
export class CameraRig {
  mode: CameraMode = 'chase';
  /** Lens for the outside views [deg]; main.ts sets it from the screen shape. */
  baseFov = 38;
  /** Instant moves only (prefers-reduced-motion). */
  reducedMotion = false;

  private az = CHASE.az;
  private el = CHASE.el;
  private dist = CHASE.dist;
  private orbitYaw = 0;
  private yaw = 0;
  private lookYaw = COCKPIT.yaw;
  private lookPitch = COCKPIT.pitch;
  private fov = COCKPIT.fov;
  private focus: { yaw: number; pitch: number; fov: number } | null = null;
  private idle = 0;
  private initialized = false;

  // Smoothed chase state (world)
  private readonly pos = new Vector3();
  private readonly look = new Vector3();

  // Transition, in the aircraft's frame
  private t = TRANSITION;
  private readonly fromPos = new Vector3();
  private readonly fromQ = new Quaternion();
  private fromFov = 38;

  // scratch
  private readonly target = new Vector3();
  private readonly desired = new Vector3();
  private readonly q = new Quaternion();
  private readonly invBody = new Quaternion();
  private readonly v = new Vector3();
  private readonly lookQ = new Quaternion();
  private readonly ax = new Vector3();

  constructor(private readonly camera: PerspectiveCamera) {}

  /** How far into the cockpit the camera is: 0 outside, 1 seated. */
  get inside(): number {
    if (this.mode === 'cockpit') return this.t >= TRANSITION ? 1 : smootherstep(this.t / TRANSITION);
    return this.t >= TRANSITION ? 0 : 1 - smootherstep(this.t / TRANSITION);
  }

  setMode(mode: CameraMode, aircraftPos: Vector3, body: Quaternion): void {
    if (mode === this.mode) return;
    // Capture where the camera is now, relative to the aircraft.
    this.invBody.copy(body).invert();
    this.fromPos.copy(this.camera.position).sub(aircraftPos).applyQuaternion(this.invBody);
    this.fromQ.copy(this.invBody).multiply(this.camera.quaternion);
    this.fromFov = this.camera.fov;
    this.t = this.reducedMotion ? TRANSITION : 0;
    if (mode === 'orbit') this.orbitYaw = this.yaw + this.az;
    if (mode === 'orbit' || this.mode === 'orbit') this.az = mode === 'orbit' ? 0 : CHASE.az;
    if (mode === 'cockpit') this.clearFocus();
    this.mode = mode;
    this.initialized = false;
    this.idle = 0;
  }

  /** Drag in pixels: orbit or look around. */
  drag(dx: number, dy: number): void {
    this.idle = 0;
    if (this.mode === 'cockpit') {
      this.focus = null;
      this.lookYaw = clamp(this.lookYaw + dx * 0.004, -2.6, 2.6);
      this.lookPitch = clamp(this.lookPitch + dy * 0.003, -1.0, 0.85);
    } else {
      this.az -= dx * 0.005;
      this.el = clamp(this.el + dy * 0.004, -0.12, 1.35);
    }
  }

  /** Zoom by a factor: > 1 pulls back (or widens the lens). */
  zoom(factor: number): void {
    this.idle = 0;
    if (this.mode === 'cockpit') {
      this.focus = null;
      this.fov = clamp(this.fov * factor, 24, 80);
    } else {
      this.dist = clamp(this.dist * factor, 32, 2500);
    }
  }

  /** Back to the mode's default framing. */
  reset(): void {
    this.az = this.mode === 'orbit' ? 0 : CHASE.az;
    this.el = CHASE.el;
    this.dist = CHASE.dist;
    this.clearFocus();
  }

  /** Cockpit: turn to look at a point (aircraft frame) and narrow the lens. */
  focusOn(local: Vector3, fov: number): void {
    const d = this.v.copy(local).sub(EYE);
    this.focus = { yaw: Math.atan2(-d.x, -d.z), pitch: Math.atan2(d.y, Math.hypot(d.x, d.z)), fov };
  }

  clearFocus(): void {
    this.focus = null;
    this.lookYaw = COCKPIT.yaw;
    this.lookPitch = COCKPIT.pitch;
    this.fov = COCKPIT.fov;
  }

  get focused(): boolean {
    return this.focus !== null;
  }

  update(pose: RenderState, aircraftPos: Vector3, body: Quaternion, dt: number, groundAt: (x: number, z: number) => number, still = false): void {
    const cam = this.camera;
    this.idle += dt;
    this.yaw = !this.initialized || still ? pose.psi : lerpAngle(this.yaw, pose.psi, 1 - Math.exp(-0.7 * dt));

    // Chase drifts back to its framing after a while without input.
    if (this.mode === 'chase' && this.idle > 6) {
      this.az = lerpAngle(this.az, CHASE.az, 1 - Math.exp(-0.6 * dt));
      this.el = damp(this.el, CHASE.el, 0.6, dt);
    }

    let fov = this.baseFov;
    if (this.mode === 'cockpit') {
      const f = this.focus;
      this.lookYaw = damp(this.lookYaw, f ? f.yaw : this.lookYaw, 5, dt);
      this.lookPitch = damp(this.lookPitch, f ? f.pitch : this.lookPitch, 5, dt);
      const lensTarget = f ? f.fov : this.fov;
      fov = this.t >= TRANSITION ? damp(cam.fov, lensTarget, 6, dt) : lensTarget;
      this.lookQ.setFromAxisAngle(this.ax.set(0, 1, 0), this.lookYaw);
      this.q.setFromAxisAngle(this.ax.set(1, 0, 0), this.lookPitch);
      this.lookQ.multiply(this.q);
      this.desired.copy(EYE).applyQuaternion(body).add(aircraftPos);
      this.q.copy(body).multiply(this.lookQ);
      cam.position.copy(this.desired);
      cam.quaternion.copy(this.q);
    } else {
      const heading = this.mode === 'orbit' ? this.orbitYaw : this.yaw;
      const a = heading + this.az;
      const fx = Math.sin(a);
      const fz = -Math.cos(a);
      const horiz = this.dist * Math.cos(this.el);
      this.desired.set(pose.x - fx * horiz, pose.y + this.dist * Math.sin(this.el), pose.z - fz * horiz);
      const lookAhead = this.mode === 'chase' ? 12 : 0;
      this.target.set(pose.x + Math.sin(this.yaw) * lookAhead, pose.y + 2, pose.z - Math.cos(this.yaw) * lookAhead);
      if (!this.initialized || still) {
        this.pos.copy(this.desired);
        this.look.copy(this.target);
      } else {
        // Position follows a little softer than the aim point.
        const k = this.mode === 'chase' ? 1 : 3;
        this.pos.set(
          damp(this.pos.x, this.desired.x, 3.0 * k, dt),
          damp(this.pos.y, this.desired.y, 2.0 * k, dt),
          damp(this.pos.z, this.desired.z, 3.0 * k, dt),
        );
        this.look.set(damp(this.look.x, this.target.x, 6 * k, dt), damp(this.look.y, this.target.y, 4 * k, dt), damp(this.look.z, this.target.z, 6 * k, dt));
      }
      // Never through the ground.
      const floor = groundAt(this.pos.x, this.pos.z) + 4;
      if (this.pos.y < floor) this.pos.y = floor;
      cam.position.copy(this.pos);
      cam.lookAt(this.look);
      // A touch of roll with the bank in the chase view: enough to feel the turn.
      if (this.mode === 'chase') cam.rotateZ(-pose.phi * 0.12);
    }
    this.initialized = true;

    // Blend from where the camera was when the mode changed, in the aircraft's frame.
    if (this.t < TRANSITION && !still) {
      this.t = Math.min(TRANSITION, this.t + dt);
      const e = smootherstep(this.t / TRANSITION);
      this.invBody.copy(body).invert();
      this.v.copy(cam.position).sub(aircraftPos).applyQuaternion(this.invBody);
      this.q.copy(this.invBody).multiply(cam.quaternion);
      // Swing wide of the airframe on the way in or out of the cockpit.
      const arc = Math.sin(Math.PI * e) * (this.mode === 'cockpit' || this.fromPos.length() < 20 ? 14 : 0);
      this.v.lerpVectors(this.fromPos, this.v, e);
      this.v.y += arc * 0.35;
      this.v.x -= arc;
      this.q.slerpQuaternions(this.fromQ, this.q, e);
      cam.position.copy(this.v.applyQuaternion(body).add(aircraftPos));
      cam.quaternion.copy(body).multiply(this.q);
      fov = lerp(this.fromFov, fov, e);
    }
    if (Math.abs(cam.fov - fov) > 1e-3) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
  }
}
