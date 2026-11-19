import { type Airport, type Fix, runwayEnds } from '../sim/navdata';
import type { NavWorld } from '../sim/simulation';
import { AIRPORT_SITES, FIELD_ELEVATION, MAGNETIC_VARIATION, terrainHeight } from './terrain';

/**
 * The world's navigation database: two fictional airports and the en-route fixes the
 * portfolio's sections stand for. Simulated data, not for navigation.
 */

export const AIRPORTS: readonly Airport[] = AIRPORT_SITES.map((site) => {
  const elevation = FIELD_ELEVATION[site.ident]!;
  return {
    ident: site.ident,
    name: site.name,
    x: site.x,
    z: site.z,
    elevation,
    runways: site.runways.flatMap((r) =>
      runwayEnds(site.ident, { x: r.x, z: r.z }, r.heading, r.length, r.width, elevation, MAGNETIC_VARIATION),
    ),
  };
});

/** En-route fixes, from KJWU toward KHLO. Each is a section of the home page. */
export const ROUTE_FIXES: readonly Fix[] = [
  { ident: 'ABOUT', section: 'about', x: 17_000, z: -1500 },
  { ident: 'WORKS', section: 'work', x: 11_000, z: 2500 },
  { ident: 'LOGBK', section: 'experience', x: 5000, z: -2000 },
  { ident: 'TEACH', section: 'beyond', x: -500, z: 2000 },
  { ident: 'RADIO', section: 'contact', x: -5000, z: -2000 },
];

export const WORLD: NavWorld = {
  airports: AIRPORTS,
  route: ROUTE_FIXES,
  variation: MAGNETIC_VARIATION,
  terrain: terrainHeight,
};
