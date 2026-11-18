import type { Waypoint } from '../sim/simulation';
import { AIRFIELD } from './terrain';

/**
 * The flight plan. Each stop is a section of the site and a waypoint in the world:
 * scroll to a section and the autopilot flies direct to its waypoint, then holds.
 *
 * Shared by the page (the flight-plan list is rendered from it at build time)
 * and by the scene (markers, route line, autopilot targets).
 */
export interface RouteStop extends Waypoint {
  /** id of the page section this waypoint stands for */
  section: string;
  /** plain-language name shown next to the fix */
  label: string;
}

const HOLD = 1250;

export const ROUTE: readonly RouteStop[] = [
  { id: 'home', fix: 'KJWU', section: 'top', label: 'Home', x: AIRFIELD.x, z: AIRFIELD.z, altitude: 650, orbitRadius: HOLD },
  { id: 'about', fix: 'ABOUT', section: 'about', label: 'About', x: 5200, z: -1800, altitude: 760, orbitRadius: HOLD },
  { id: 'work', fix: 'WORKS', section: 'work', label: 'Selected work', x: 2000, z: -900, altitude: 840, orbitRadius: HOLD },
  { id: 'experience', fix: 'LOGBK', section: 'experience', label: 'Experience', x: -1200, z: -2400, altitude: 800, orbitRadius: HOLD },
  { id: 'beyond', fix: 'TEACH', section: 'beyond', label: 'Robotics & teaching', x: -4300, z: -600, altitude: 900, orbitRadius: HOLD },
  { id: 'contact', fix: 'RADIO', section: 'contact', label: 'Contact', x: -7400, z: -2000, altitude: 950, orbitRadius: HOLD },
];

export const START_STOP = ROUTE[0]!;

/** Direction *toward* the sun: low in the west-southwest, a few degrees up. Dusk. */
export const SUN = {
  azimuth: (262 * Math.PI) / 180,
  elevation: (3.5 * Math.PI) / 180,
};
