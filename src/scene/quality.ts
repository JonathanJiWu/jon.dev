/**
 * Picks a starting quality from the device, then adapts the render resolution to keep
 * frames on time. Frame time is the honest signal: it catches thermal throttling and
 * busy laptops that no capability check would.
 */
export interface QualityProfile {
  terrainSegments: number;
  maxPixelRatio: number;
  antialias: boolean;
}

export function chooseProfile(): QualityProfile {
  const small = Math.min(screen.width, screen.height) < 700;
  const cores = navigator.hardwareConcurrency || 4;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  const modest = small || cores <= 4 || memory <= 4;
  return modest
    ? { terrainSegments: 220, maxPixelRatio: 1.25, antialias: false }
    : { terrainSegments: 340, maxPixelRatio: 1.75, antialias: true };
}

export class AdaptiveResolution {
  pixelRatio: number;
  private avg = 16.7;
  private sinceChange = 0;
  readonly min = 0.6;

  constructor(readonly max: number) {
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, max);
  }

  /** Feed one frame's duration [ms]. Returns true when the pixel ratio changed. */
  sample(frameMs: number): boolean {
    // Ignore hitches (tab switches, GC): they say nothing about steady-state cost.
    if (frameMs > 250) return false;
    this.avg += (frameMs - this.avg) * 0.05;
    this.sinceChange += frameMs;
    if (this.sinceChange < 1500) return false;

    const ceiling = Math.min(window.devicePixelRatio || 1, this.max);
    let next = this.pixelRatio;
    if (this.avg > 24) next = Math.max(this.min, this.pixelRatio - 0.15);
    else if (this.avg < 13 && this.sinceChange > 4000) next = Math.min(ceiling, this.pixelRatio + 0.1);
    if (next === this.pixelRatio) return false;
    this.pixelRatio = Math.round(next * 100) / 100;
    this.sinceChange = 0;
    return true;
  }

  get averageFrameMs(): number {
    return this.avg;
  }
}
