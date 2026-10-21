/**
 * Exact age as of a cutoff date (default Oct 1 of academic year start year).
 */
export function ageAtCutoff(
  dateOfBirth: string | Date,
  cutoff: { year: number; month: number; day: number },
): { years: number; months: number; days: number; totalDays: number } {
  const dob = typeof dateOfBirth === 'string' ? new Date(dateOfBirth) : dateOfBirth;
  const cut = new Date(Date.UTC(cutoff.year, cutoff.month - 1, cutoff.day));

  if (Number.isNaN(dob.getTime())) {
    throw new Error('Invalid date of birth');
  }

  let years = cut.getUTCFullYear() - dob.getUTCFullYear();
  let months = cut.getUTCMonth() - dob.getUTCMonth();
  let days = cut.getUTCDate() - dob.getUTCDate();

  if (days < 0) {
    months -= 1;
    const prevMonth = new Date(Date.UTC(cut.getUTCFullYear(), cut.getUTCMonth(), 0));
    days += prevMonth.getUTCDate();
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }

  const totalDays = Math.floor((cut.getTime() - dob.getTime()) / (1000 * 60 * 60 * 24));
  return { years, months, days, totalDays };
}

export function isAgeEligible(
  dateOfBirth: string,
  cutoff: { year: number; month: number; day: number },
  minAgeYears?: number | null,
  maxAgeYears?: number | null,
): { ok: boolean; age: ReturnType<typeof ageAtCutoff>; reason?: string } {
  const age = ageAtCutoff(dateOfBirth, cutoff);
  const ageYears = age.years + age.months / 12 + age.days / 365;

  if (minAgeYears != null && ageYears < minAgeYears) {
    return { ok: false, age, reason: `Applicant younger than minimum age ${minAgeYears}` };
  }
  if (maxAgeYears != null && ageYears > maxAgeYears) {
    return { ok: false, age, reason: `Applicant older than maximum age ${maxAgeYears}` };
  }
  return { ok: true, age };
}
