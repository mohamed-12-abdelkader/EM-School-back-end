/** Financial helpers using cents (integers) to avoid float errors. */

export function toCents(amount: number | string): number {
  const n = typeof amount === 'string' ? Number(amount) : amount;
  if (!Number.isFinite(n)) throw new Error('Invalid money amount');
  return Math.round(n * 100);
}

export function fromCents(cents: number): number {
  return Math.round(cents) / 100;
}

export function moneyAdd(...amounts: Array<number | string>): number {
  return fromCents(amounts.reduce<number>((sum, a) => sum + toCents(a), 0));
}

export function moneySub(a: number | string, b: number | string): number {
  return fromCents(toCents(a) - toCents(b));
}

export function moneyMin(a: number | string, b: number | string): number {
  return fromCents(Math.min(toCents(a), toCents(b)));
}

export function moneyGt(a: number | string, b: number | string): boolean {
  return toCents(a) > toCents(b);
}

export function moneyGte(a: number | string, b: number | string): boolean {
  return toCents(a) >= toCents(b);
}

export function moneyEq(a: number | string, b: number | string): boolean {
  return toCents(a) === toCents(b);
}

export function moneyLt(a: number | string, b: number | string): boolean {
  return toCents(a) < toCents(b);
}

export function moneyLte(a: number | string, b: number | string): boolean {
  return toCents(a) <= toCents(b);
}

/** Split amount into N parts; remainder cents go to earlier installments. */
export function splitEqually(total: number | string, parts: number): number[] {
  if (parts < 1) throw new Error('parts must be >= 1');
  const totalCents = toCents(total);
  const base = Math.floor(totalCents / parts);
  const remainder = totalCents - base * parts;
  const result: number[] = [];
  for (let i = 0; i < parts; i++) {
    result.push(fromCents(base + (i < remainder ? 1 : 0)));
  }
  return result;
}

export function roundMoney(amount: number | string): number {
  return fromCents(toCents(amount));
}

export function percentOf(amount: number | string, percent: number | string): number {
  const a = toCents(amount);
  const p = Number(percent);
  if (!Number.isFinite(p) || p < 0) throw new Error('Invalid percent');
  return fromCents(Math.round((a * p) / 100));
}
