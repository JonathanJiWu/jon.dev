import { type PerspectiveCamera, Vector3 } from 'three';
import type { RenderState } from '../sim/simulation';
import { damp, lerpAngle } from '../sim/math';

/**
 * A chase camera, framed like an air-to-air photo: behind, a little above, and off the
 * left wing (the outside of the right-hand hold, so we see the aircraft's top surfaces).
 *
 * It follows the aircraft's heading through critically-damped smoothing, so in a turn
 * the view swings around after it instead of being bolted to the tail.
 */
export class CameraRig {
  distance = 165;
  height = 34;
  side = -60;
  /** Aim just ahead of the aircraft; the view offset in main.ts places it in the frame. */
  lookAhead = 12;
  private yaw = 0;
  private readonly pos = new Vector3();
  private readonly look = new Vector3();
  private initialized = false;
  private readonly desired = new Vector3();
  private readonly target = new Vector3();

  constructor(private readonly camera: PerspectiveCamera) {}

  update(pose: RenderState, dt: number, still = false): void {
    if (!this.initialized || still) {
      this.yaw = pose.psi;
    } else {
      // Swing with the heading, lagging ~1.4 s behind.
      this.yaw = lerpAngle(this.yaw, pose.psi, 1 - Math.exp(-0.7 * dt));
    }
    const fx = Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    // right = (cos ψ, 0, sin ψ)
    const rx = Math.cos(this.yaw);
    const rz = Math.sin(this.yaw);

    this.desired.set(
      pose.x - fx * this.distance + rx * this.side,
      pose.y + this.height,
      pose.z - fz * this.distance + rz * this.side,
    );
    this.target.set(pose.x + fx * this.lookAhead, pose.y + 2, pose.z + fz * this.lookAhead);

    if (!this.initialized || still) {
      this.pos.copy(this.desired);
      this.look.copy(this.target);
      this.initialized = true;
    } else {
      // Position follows a little softer than the aim point.
      this.pos.set(
        damp(this.pos.x, this.desired.x, 3.0, dt),
        damp(this.pos.y, this.desired.y, 2.0, dt),
        damp(this.pos.z, this.desired.z, 3.0, dt),
      );
      this.look.set(
        damp(this.look.x, this.target.x, 6, dt),
        damp(this.look.y, this.target.y, 4, dt),
        damp(this.look.z, this.target.z, 6, dt),
      );
    }
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);
    // A touch of roll with the bank: enough to feel the turn, not enough to feel it in your stomach.
    this.camera.rotateZ(-pose.phi * 0.12);
  }
}
