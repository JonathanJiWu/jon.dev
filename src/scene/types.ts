/**
 * The boundary between the page and the 3D scene. The page imports only these types
 * (erased at build time), so three.js stays in its own lazily loaded chunk.
 */
import type { FlightData } from '../sim/flightData';
import type { CameraMode } from './cameraRig';

export type { CameraMode } from './cameraRig';

/** Fly: the 3D flight fills the screen and takes input. Read: it's the page's backdrop. */
export type ViewMode = 'fly' | 'read';

export interface SceneController {
  /** Read mode: hold over the fix for a page section, or resume the flight plan ('home'). */
  followSection(id: string): void;
  directTo(ident: string): boolean;
  /** Hold over the active fix, or leave a hold and continue the plan. */
  toggleHold(): void;
  setView(view: ViewMode): void;
  setCamera(mode: CameraMode): void;
  readonly cameraMode: CameraMode;
  /** Cockpit: look at one display ('pfd-l', 'nd-l', 'eicas', 'mfd', 'cdu-l', 'mcp'), or null for the view ahead. */
  focusDisplay(id: string | null): void;
  /** Reset the camera to its default framing for the current mode. */
  resetCamera(): void;
  setEngineering(on: boolean): void;
  /** Real-time multiplier for the simulation (1, 2, 4 or 8). */
  setSimRate(rate: number): void;
  setPaused(paused: boolean): void;
  readonly paused: boolean;
  /** The live flight data: one shared object, refreshed every frame. */
  data(): FlightData;
  /** Stop rendering and free the GPU context. */
  dispose(): void;
}

export interface SceneOptions {
  canvas: HTMLCanvasElement;
  labels: HTMLElement;
  /** Where the engineering view writes its readouts. */
  panel: HTMLElement | null;
  /** The Fly mode heads-up panels the scene keeps up to date. */
  hud: HTMLElement | null;
  view: ViewMode;
  /** The page section in view when the scene starts (Read mode holds there). */
  initialSection: string;
  /** Start paused, and move the camera without animation. */
  reducedMotion?: boolean;
  /** Start this many seconds into the flight (deterministic; for links and captures). */
  startAt?: number;
  /** Deterministic still capture for the poster and social image. */
  poster?: boolean;
  onFirstFrame?: () => void;
  onContextLost?: () => void;
  /** The camera mode changed (from a key or a cockpit click). */
  onCameraChange?: (mode: CameraMode) => void;
}
