/**
 * The boundary between the page and the 3D scene. The page imports only these types
 * (erased at build time), so three.js stays in its own lazily-loaded chunk.
 */

export interface FlightReadout {
  mode: 'direct' | 'orbit';
  /** Route stop id the autopilot is flying to. */
  target: string;
  /** Horizontal distance from the aircraft to each route stop [m], by id. */
  distances: Record<string, number>;
  /** Ground speed [m/s] (no wind, so equal to true airspeed). */
  groundSpeed: number;
  /** Altitude above sea level [m]. */
  altitude: number;
  /** Heading [rad from north]. */
  heading: number;
}

export interface SceneController {
  /** Fly direct to a route stop, then hold there. */
  setTarget(id: string): void;
  setEngineering(on: boolean): void;
  /** Real-time multiplier for the simulation (1, 2 or 4). */
  setSimRate(rate: number): void;
  readout(): FlightReadout;
  /** Stop rendering and free the GPU context. */
  dispose(): void;
}

export interface SceneOptions {
  canvas: HTMLCanvasElement;
  labels: HTMLElement;
  /** Where the engineering view writes its readouts. */
  panel: HTMLElement | null;
  initialTarget: string;
  /** Deterministic still capture for the poster and social image. */
  poster?: boolean;
  onFirstFrame?: () => void;
  onContextLost?: () => void;
}
