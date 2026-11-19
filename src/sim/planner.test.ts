import { describe, expect, it } from 'vitest';
import { TRANSPORT } from './aircraft';
import { DEG, wrapPi } from './math';
import { bearing, distance, offset, runwayEnds, toMagnetic, type Wind } from './navdata';
import { areaMax, buildApproach, corridorMax, fixName, type FlightPlan, FT, KT, NM, planFlight } from './planner';
import { WORLD } from '../world/navdata';

/** The test winds: calm, and strong enough from every quarter to change the runways. */
export const TEST_WINDS: [string, Wind][] = [
  ['calm', { from: 0, speed: 0 }],
  ['270/20', { from: 270 * DEG, speed: 20 * KT }],
  ['090/12', { from: 90 * DEG, speed: 12 * KT }],
  ['180/15', { from: 180 * DEG, speed: 15 * KT }],
  ['360/18', { from: 0, speed: 18 * KT }],
  ['225/25', { from: 225 * DEG, speed: 25 * KT }],
];

function plan(forward: boolean, wind: Wind): FlightPlan {
  const [a, b] = WORLD.airports;
  return planFlight({
    id: 0,
    origin: forward ? a! : b!,
    destination: forward ? b! : a!,
    route: forward ? WORLD.route : [...WORLD.route].reverse(),
    wind,
    variation: WORLD.variation,
    params: TRANSPORT,
    fuel: 8000,
    terrain: WORLD.terrain,
  });
}

const cases = TEST_WINDS.flatMap(([name, wind]) => [
  { name: `KJWU→KHLO, wind ${name}`, plan: plan(true, wind) },
  { name: `KHLO→KJWU, wind ${name}`, plan: plan(false, wind) },
]);

describe('fix names', () => {
  it('are deterministic, pronounceable five-letter names', () => {
    expect(fixName('KJWU27IF')).toBe(fixName('KJWU27IF'));
    expect(fixName('KJWU27IF')).not.toBe(fixName('KJWU09IF'));
    for (const seed of ['a', 'b', 'KHLO18left base', 'xyz']) expect(fixName(seed)).toMatch(/^[BDFGKLMNPRSTVZ][AEIOU][BDFGKLMNPRSTVZ][AEIOU][BDFGKLMNPRSTVZ]$/);
  });
});

describe.each(cases)('flight plan $name', ({ plan: p }) => {
  it('is feasible: no warnings', () => {
    expect(p.warnings).toEqual([]);
  });

  it('takes off and lands on the runway most into the wind, with room to spare', () => {
    for (const [choice, airport] of [[p.departure, p.origin], [p.arrival, p.destination]] as const) {
      for (const r of airport.runways) {
        const head = Math.cos(wrapPi(p.wind.from - r.heading)) * p.wind.speed;
        if (r.length >= choice.runway.length && p.wind.speed > 1.5) expect(choice.headwind).toBeGreaterThanOrEqual(head - 1e-9);
      }
    }
    expect(p.takeoffDistance).toBeLessThan(p.departure.runway.length);
    // Dispatch rule: the landing must fit in 60% of the runway.
    expect(p.landingDistance / 0.6).toBeLessThan(p.arrival.runway.length);
  });

  it('cruises at a semicircular-rule altitude above the minimum en-route altitude', () => {
    const course = toMagnetic(bearing(p.origin, p.destination), p.variation);
    const thousands = Math.round(p.cruiseAltitude / FT / 1000);
    expect(Math.abs(p.cruiseAltitude / FT - thousands * 1000)).toBeLessThan(1e-6);
    // 000–179° magnetic: odd thousands; 180–359°: even thousands (14 CFR 91.179).
    expect(thousands % 2).toBe(course < Math.PI ? 1 : 0);
    expect(p.cruiseAltitude).toBeGreaterThanOrEqual(p.mea);
    expect(p.cruiseAltitude).toBeGreaterThanOrEqual(p.approach.iafAltitude);
  });

  it('sets the MEA 1,000 ft above the highest terrain within 4 NM of the route', () => {
    const enroute = p.legs.filter((l) => l.role === 'enroute' || l.role === 'arrival');
    const va = p.legs.find((l) => l.type === 'VA')!;
    let top = -Infinity;
    let prev = { x: va.x, z: va.z };
    // The en-route legs end at the IAF (the IF on a straight-in): the last one is 'arrival'.
    for (const l of enroute) {
      top = Math.max(top, corridorMax(WORLD.terrain, prev, l, 4 * NM));
      prev = l;
    }
    expect(enroute[enroute.length - 1]!.ident).toBe(p.approach.iaf.ident);
    expect(p.mea).toBeGreaterThanOrEqual(top + 1000 * FT - 1e-6);
    expect(p.mea).toBeLessThan(top + 1100 * FT);
  });

  it('strings the legs together in the right order', () => {
    const types = p.legs.map((l) => l.type);
    expect(types.slice(0, 3)).toEqual(['TO', 'VA', 'DF']);
    expect(types[types.length - 1]).toBe('RW');
    const roles = p.legs.map((l) => l.role);
    const order = ['departure', 'enroute', 'arrival', 'approach', 'final'];
    for (let i = 1; i < roles.length; i++) expect(order.indexOf(roles[i]!)).toBeGreaterThanOrEqual(order.indexOf(roles[i - 1]!));
    // Every en-route fix is on the route, in order.
    const route = p.legs.filter((l) => l.role === 'enroute').map((l) => l.ident);
    const expected = (p.origin.ident === 'KJWU' ? WORLD.route : [...WORLD.route].reverse()).map((f) => f.ident);
    expect(route).toEqual(expected);
    // Cumulative distance, time and fuel only go up, and add up.
    let d = 0;
    let t = 0;
    for (const l of p.legs) {
      d += l.length;
      t += l.time;
      expect(l.cumDistance).toBeCloseTo(d, 6);
      expect(l.elapsed).toBeCloseTo(t, 6);
    }
    expect(p.ete).toBeCloseTo(t, 6);
    expect(p.totalDistance).toBeCloseTo(d, 6);
  });

  it('lays the final approach on the extended centreline with a 3° glide path', () => {
    const rw = p.arrival.runway;
    const a = p.approach;
    const out = rw.heading + Math.PI;
    for (const [fix, dist] of [[a.faf, 4 * NM], [a.if, 7 * NM]] as const) {
      const expected = offset(rw.threshold, out, dist);
      expect(distance(fix, expected)).toBeLessThan(1e-6);
    }
    expect(a.glidePath).toBeCloseTo(3 * DEG, 12);
    expect(a.tch).toBeCloseTo(50 * FT, 12);
    // The FAF altitude is the glide path's height there, rounded up to 100 ft.
    const onPath = rw.elevation + a.tch + 4 * NM * Math.tan(a.glidePath);
    expect(a.fafAltitude).toBeGreaterThanOrEqual(onPath - 1e-6);
    expect(a.fafAltitude).toBeLessThan(onPath + 100 * FT);
    const last = p.legs[p.legs.length - 1]!;
    expect(last.constraint).toEqual({ kind: 'at', altitude: rw.elevation + a.tch });
    const faf = p.legs[p.legs.length - 2]!;
    expect(faf.ident).toBe(a.faf.ident);
    expect(faf.constraint).toEqual({ kind: 'at', altitude: a.fafAltitude });
  });

  it('keeps the initial approach segment 1,000 ft above the terrain, descending no steeper than 3.5°', () => {
    const a = p.approach;
    const top = a.entry === 'straight-in' ? areaMax(WORLD.terrain, a.if, 2 * NM) : corridorMax(WORLD.terrain, a.iaf, a.if, 2 * NM, 500);
    expect(a.iafAltitude).toBeGreaterThanOrEqual(top + 1000 * FT - 1e-6);
    expect(a.iafAltitude).toBeGreaterThanOrEqual(a.fafAltitude + 1000 * FT - 1e-6);
    expect((a.iafAltitude - a.fafAltitude) / (3 * NM)).toBeLessThanOrEqual(Math.tan(3.5 * DEG));
    const ifLeg = p.legs.find((l) => l.ident === a.if.ident)!;
    expect(ifLeg.constraint).toEqual({ kind: 'atOrAbove', altitude: a.iafAltitude });
  });

  it('climbs, cruises, then descends on a 3° path to the first approach fix', () => {
    expect(p.toc.distance).toBeLessThan(p.tod.distance);
    const first = p.legs.find((l) => l.role === 'arrival' || l.role === 'approach')!;
    const target = Math.min(first.constraint!.altitude, p.cruiseAltitude);
    expect(first.cumDistance - p.tod.distance).toBeCloseTo((p.cruiseAltitude - target) / Math.tan(3 * DEG), 3);
    for (const l of p.legs) expect(l.altitude).toBeLessThanOrEqual(p.cruiseAltitude + 1e-6);
  });

  it('carries the trip fuel plus a 45-minute reserve', () => {
    expect(p.tripFuel).toBeCloseTo(p.legs[p.legs.length - 1]!.fuel, 6);
    expect(p.tripFuel + p.reserveFuel).toBeLessThan(p.fuelOnBoard);
    expect(p.tripFuel).toBeGreaterThan(100);
  });

  it('reports the weather as METARs (true winds, standard pressure)', () => {
    for (const m of [p.metar.origin, p.metar.destination]) expect(m).toMatch(/^K[A-Z]{3} (00000|\d{5})KT 10SM FEW045 \d\d\/06 A2992$/);
  });
});

describe('approach entry (terminal arrival area)', () => {
  const [rw] = runwayEnds('TEST', { x: 0, z: 0 }, 90 * DEG, 2500, 45, 100, 0);
  const out = rw.heading + Math.PI;
  const ifPoint = offset(rw.threshold, out, 7 * NM);

  it('is straight-in from within 70° of the final approach course', () => {
    for (const rel of [-60, 0, 60]) {
      const a = buildApproach(rw, offset(ifPoint, out + rel * DEG, 15 * NM));
      expect(a.entry).toBe('straight-in');
      expect(a.iaf).toEqual(a.if);
    }
  });

  it('joins on the base leg from the side the aircraft is on', () => {
    // Landing east, arriving from the north: on the pilot's left, so a left base.
    const north = buildApproach(rw, offset(ifPoint, 0, 15 * NM));
    expect(north.entry).toBe('left base');
    expect(north.iaf.z).toBeLessThan(ifPoint.z);
    const south = buildApproach(rw, offset(ifPoint, Math.PI, 15 * NM));
    expect(south.entry).toBe('right base');
    expect(south.iaf.z).toBeGreaterThan(ifPoint.z);
    // Base IAFs sit 4 NM from the IF, at right angles to the final.
    for (const a of [north, south]) {
      expect(distance(a.iaf, a.if)).toBeCloseTo(4 * NM, 6);
      expect(Math.abs(Math.cos(bearing(a.if, a.iaf) - rw.heading))).toBeLessThan(1e-9);
    }
  });

  it('sets the initial approach altitude 1,000 ft above the FAF, or above the terrain', () => {
    const flat = buildApproach(rw, offset(ifPoint, out, 15 * NM), () => 0);
    expect(flat.iafAltitude).toBeCloseTo(Math.ceil((flat.fafAltitude + 1000 * FT) / (100 * FT) - 1e-9) * 100 * FT, 6);
    // A 600 m ridge 1 NM from the IF raises it to 600 m + 1,000 ft, rounded up to 100 ft.
    const ridge = (x: number) => (Math.abs(x - (ifPoint.x - NM)) < 200 ? 600 : 0);
    const raised = buildApproach(rw, offset(ifPoint, out, 15 * NM), ridge);
    expect(raised.iafAltitude).toBeCloseTo(Math.ceil((600 + 1000 * FT) / (100 * FT) - 1e-9) * 100 * FT, 6);
  });
});

describe('terrain corridor', () => {
  it('finds the highest point within the corridor and nothing outside it', () => {
    // A cone 500 m high at (5000, 2000), falling 1 m per 20 m.
    const peak = (x: number, z: number) => Math.max(0, 500 - Math.hypot(x - 5000, z - 2000) / 20);
    expect(corridorMax(peak, { x: 0, z: 0 }, { x: 10_000, z: 0 }, 2000, 250)).toBeCloseTo(500, 6);
    // A corridor whose nearest point is 4 km from the summit sees 300 m.
    expect(corridorMax(peak, { x: 0, z: -3000 }, { x: 10_000, z: -3000 }, 1000, 250)).toBeCloseTo(300, 6);
    expect(areaMax(peak, { x: 5000, z: 6000 }, 2000, 250)).toBeCloseTo(400, 6);
  });
});
