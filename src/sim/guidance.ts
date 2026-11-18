/**
 * Lateral guidance by vector fields: straight-line and circular-orbit following.
 * After R. W. Beard & T. W. McLain, "Small Unmanned Aircraft: Theory and Practice"
 * (Princeton, 2012), ch. 10.
 *
 * Positions are in the sim frame (x = east, z = south). Courses are measured from
 * north, clockwise, so north = -z and east = +x.
 */

/** Fly along a line through an origin, in a direction (unit vector in x/z). */
export interface LinePath {
  kind: 'line';
  ox: number;
  oz: number;
  dx: number;
  dz: number;
}

/** Circle a centre. direction +1 = clockwise seen from above (standard right-hand hold). */
export interface OrbitPath {
  kind: 'orbit';
  cx: number;
  cz: number;
  radius: number;
  direction: 1 | -1;
}

export type Path = LinePath | OrbitPath;

/** Course [rad from north, clockwise] of a horizontal direction vector. */
export function courseOf(dx: number, dz: number): number {
  return Math.atan2(dx, -dz);
}

export interface LineGains {
  /** Course at which the aircraft approaches the line from far away [rad]. */
  approachAngle: number;
  /** How sharply the field bends onto the line [1/m]. */
  k: number;
}

export interface OrbitGains {
  /** How sharply the field bends onto the circle (dimensionless). */
  k: number;
}

export interface GuidanceOutput {
  /** Commanded course [rad]. */
  course: number;
  /** Signed cross-track (line) or radial (orbit) error [m]. */
  error: number;
}

/**
 * χc = χq − χ∞·(2/π)·atan(k·e), where e is the cross-track error.
 * e > 0 means the aircraft is right of the path, so the command turns it left.
 */
export function followLine(path: LinePath, x: number, z: number, g: LineGains, out: GuidanceOutput): GuidanceOutput {
  const chiQ = courseOf(path.dx, path.dz);
  const north = -(z - path.oz);
  const east = x - path.ox;
  const e = -Math.sin(chiQ) * north + Math.cos(chiQ) * east;
  out.course = chiQ - g.approachAngle * (2 / Math.PI) * Math.atan(g.k * e);
  out.error = e;
  return out;
}

/**
 * χc = φ + λ·(π/2 + atan(k·(d − ρ)/ρ)), where φ is the aircraft's bearing from the
 * centre and d its distance. Far outside the circle it points at the centre; on the
 * circle it is tangent.
 */
export function followOrbit(path: OrbitPath, x: number, z: number, g: OrbitGains, out: GuidanceOutput): GuidanceOutput {
  const north = -(z - path.cz);
  const east = x - path.cx;
  const d = Math.hypot(north, east);
  const bearing = Math.atan2(east, north);
  const e = d - path.radius;
  out.course = bearing + path.direction * (Math.PI / 2 + Math.atan((g.k * e) / path.radius));
  out.error = e;
  return out;
}
