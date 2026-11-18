/** Display conversions: the sim is SI; the cockpit speaks knots, feet and nautical miles. */
export const M_TO_FT = 3.280_84;
export const MS_TO_KT = 1.943_844;
export const M_TO_NM = 1 / 1852;
export const MS_TO_FPM = M_TO_FT * 60;

export const toDeg = (rad: number): number => (rad * 180) / Math.PI;

/** Heading as a three-digit compass value, 001–360. */
export function headingLabel(rad: number): string {
  let d = Math.round(toDeg(rad)) % 360;
  if (d <= 0) d += 360;
  return String(d).padStart(3, '0');
}
