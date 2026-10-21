import { describe, expect, it } from 'vitest';
import {
  moneyAdd,
  moneyEq,
  moneyGt,
  moneySub,
  percentOf,
  roundMoney,
  splitEqually,
  toCents,
} from './money';
import { deriveInstallmentStatus } from './fees';

describe('money helpers', () => {
  it('avoids float drift via cents', () => {
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(moneyAdd(0.1, 0.2)).toBe(0.3);
    expect(moneySub(1, 0.3)).toBe(0.7);
  });

  it('splits equally with remainder on earlier parts', () => {
    expect(splitEqually(100, 3)).toEqual([33.34, 33.33, 33.33]);
    expect(splitEqually(10, 4)).toEqual([2.5, 2.5, 2.5, 2.5]);
    const parts = splitEqually(1000.01, 3);
    expect(roundMoney(parts.reduce((s, p) => moneyAdd(s, p), 0))).toBe(1000.01);
  });

  it('computes percent of amounts', () => {
    expect(percentOf(1000, 10)).toBe(100);
    expect(percentOf(99.99, 50)).toBe(50);
  });

  it('compares money safely', () => {
    expect(moneyGt(10.01, 10)).toBe(true);
    expect(moneyEq(10.001, 10)).toBe(true); // rounds to cents
  });
});

describe('deriveInstallmentStatus', () => {
  it('marks paid when paid >= amount', () => {
    expect(deriveInstallmentStatus(100, 100, '2099-01-01')).toBe('paid');
  });

  it('marks partial or overdue based on due date', () => {
    expect(deriveInstallmentStatus(100, 40, '2099-01-01')).toBe('partial');
    expect(deriveInstallmentStatus(100, 40, '2000-01-01')).toBe('overdue');
  });

  it('marks pending or overdue when unpaid', () => {
    expect(deriveInstallmentStatus(100, 0, '2099-01-01')).toBe('pending');
    expect(deriveInstallmentStatus(100, 0, '2000-01-01')).toBe('overdue');
  });
});
