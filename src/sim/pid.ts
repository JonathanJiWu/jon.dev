import { clamp } from './math';

/**
 * PID controller with output limits, feedforward, and conditional-integration
 * anti-windup: the integrator stops accumulating while the output is saturated
 * in the direction the error is pushing it.
 */
export class Pid {
  integral = 0;
  private lastError: number | null = null;

  constructor(
    public kp: number,
    public ki: number,
    public kd = 0,
    public outMin = -Infinity,
    public outMax = Infinity,
  ) {}

  update(error: number, dt: number, feedforward = 0): number {
    const derivative = this.lastError === null || dt <= 0 ? 0 : (error - this.lastError) / dt;
    this.lastError = error;

    const unclamped = feedforward + this.kp * error + this.ki * this.integral + this.kd * derivative;
    const out = clamp(unclamped, this.outMin, this.outMax);

    const pushingHigh = unclamped > this.outMax && error > 0;
    const pushingLow = unclamped < this.outMin && error < 0;
    if (!pushingHigh && !pushingLow) this.integral += error * dt;

    return out;
  }

  reset(): void {
    this.integral = 0;
    this.lastError = null;
  }
}
