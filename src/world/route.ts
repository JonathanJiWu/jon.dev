import { AIRPORTS, ROUTE_FIXES } from './navdata';

/**
 * The home page as a flight plan: each section is a fix (the hero is the home
 * airport). In Read mode, scrolling to a section sends the aircraft to hold there.
 *
 * Shared by the page (the flight-plan list is rendered from it at build time) and by
 * the scene (markers, labels).
 */
export interface RouteStop {
  /** Route stop id (also used as the waypoint id on the page). */
  id: string;
  /** Fix or airport ident. */
  fix: string;
  /** id of the page section this stop stands for. */
  section: string;
  /** Plain-language name shown next to the fix. */
  label: string;
  x: number;
  z: number;
}

const LABELS: Record<string, string> = {
  about: 'About',
  work: 'Selected work',
  experience: 'Experience',
  beyond: 'Robotics & teaching',
  contact: 'Contact',
};

const home = AIRPORTS[0]!;

export const ROUTE: readonly RouteStop[] = [
  { id: 'home', fix: home.ident, section: 'top', label: 'Home', x: home.x, z: home.z },
  ...ROUTE_FIXES.map((f) => ({ id: f.section!, fix: f.ident, section: f.section!, label: LABELS[f.section!]!, x: f.x, z: f.z })),
];

/** Direction toward the sun: low in the west-southwest, a few degrees up. Dusk. */
export const SUN = {
  azimuth: (262 * Math.PI) / 180,
  elevation: (3.5 * Math.PI) / 180,
};
