import { Quaternion, Vector3 } from 'three';
import type { RenderState } from '../sim/simulation';

const yawQ = new Quaternion();
const pitchQ = new Quaternion();
const rollQ = new Quaternion();
const aoaQ = new Quaternion();
const X = new Vector3(1, 0, 0);
const Y = new Vector3(0, 1, 0);
const Z = new Vector3(0, 0, 1);

/**
 * The aircraft's body orientation from the simulation's wind-axis state: yaw by heading,
 * pitch by flight-path angle, roll by bank about the velocity vector, then pitch up by
 * the angle of attack. Exact, not a small-angle shortcut. Model axes: forward −Z, up +Y,
 * right +X. Shared by the exterior model, the cockpit and the cameras, so they agree.
 */
export function bodyQuaternion(pose: RenderState, out: Quaternion): Quaternion {
  yawQ.setFromAxisAngle(Y, -pose.psi);
  pitchQ.setFromAxisAngle(X, pose.gamma);
  rollQ.setFromAxisAngle(Z, -pose.phi);
  aoaQ.setFromAxisAngle(X, pose.alpha);
  return out.copy(yawQ).multiply(pitchQ).multiply(rollQ).multiply(aoaQ);
}
