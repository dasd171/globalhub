import { describe, it, expect } from 'vitest';
import { priceForQuantity, validateTiers, assertMoq, lineTotal, toMinor, fromMinor, formatMoney, summarizeFees, AppError } from '@globalhub/shared';

const tiers = [
  { minQty: 1, maxQty: 9, unitPriceMinor: 12000 },
  { minQty: 10, maxQty: 49, unitPriceMinor: 10500 },
  { minQty: 50, maxQty: 99, unitPriceMinor: 9200 },
  { minQty: 100, maxQty: null, unitPriceMinor: null },
];

describe('tiered pricing', () => {
  it('picks the right tier at boundaries', () => {
    expect(priceForQuantity(1, tiers)).toMatchObject({ kind: 'priced', unitPriceMinor: 12000 });
    expect(priceForQuantity(9, tiers)).toMatchObject({ unitPriceMinor: 12000 });
    expect(priceForQuantity(10, tiers)).toMatchObject({ unitPriceMinor: 10500 });
    expect(priceForQuantity(99, tiers)).toMatchObject({ unitPriceMinor: 9200 });
  });
  it('returns on_request for the open-ended "ask" tier', () => {
    expect(priceForQuantity(100, tiers).kind).toBe('on_request');
    expect(priceForQuantity(5000, tiers).kind).toBe('on_request');
  });
  it('falls back to base price without tiers', () => {
    expect(priceForQuantity(3, [], 500)).toMatchObject({ kind: 'priced', unitPriceMinor: 500 });
    expect(priceForQuantity(3, [], null).kind).toBe('on_request');
  });
  it('rejects overlapping or invalid tiers', () => {
    expect(() => validateTiers([{ minQty: 1, maxQty: 10, unitPriceMinor: 1 }, { minQty: 10, maxQty: null, unitPriceMinor: 1 }])).toThrow(/overlap/);
    expect(() => validateTiers([{ minQty: 0, unitPriceMinor: 1 }])).toThrow();
    expect(() => validateTiers([{ minQty: 1, maxQty: 9, unitPriceMinor: -5 }])).toThrow();
    expect(() => validateTiers(tiers)).not.toThrow();
  });
  it('rejects non-positive quantities', () => { expect(() => priceForQuantity(0, tiers)).toThrow(); expect(() => priceForQuantity(1.5, tiers)).toThrow(); });
});

describe('MOQ', () => {
  it('enforces minimum order quantity', () => {
    expect(() => assertMoq(9, 10)).toThrow(AppError);
    try { assertMoq(9, 10); } catch (e) { expect((e as AppError).code).toBe('MOQ_NOT_MET'); }
    expect(() => assertMoq(10, 10)).not.toThrow();
  });
  it('computes line totals in integer minor units', () => {
    expect(lineTotal(20, tiers, null, 1)).toEqual({ unitPriceMinor: 10500, lineTotalMinor: 210000 });
    expect(() => lineTotal(150, tiers, null, 1)).toThrow(/on request/);
  });
});

describe('money', () => {
  it('converts decimals without floating point errors', () => {
    expect(toMinor('0.1', 'USD') + toMinor('0.2', 'USD')).toBe(30);
    expect(toMinor('19.99', 'USD')).toBe(1999);
    expect(toMinor('1500', 'JPY')).toBe(1500);
    expect(() => toMinor('1.005', 'USD')).toThrow();
    expect(() => toMinor('abc', 'USD')).toThrow();
    expect(fromMinor(1999, 'USD')).toBe('19.99');
    expect(fromMinor(5, 'USD')).toBe('0.05');
    expect(fromMinor(1500, 'JPY')).toBe('1500');
  });
  it('formats with currency', () => {
    expect(formatMoney(12000, 'CNY')).toContain('120.00');
    expect(formatMoney(null, 'USD')).toBe('—');
  });
});

describe('fee summary', () => {
  it('separates confirmed, estimated and unconfirmed fees', () => {
    const s = summarizeFees([
      { type: 'PRODUCT', label: 'Products', amountMinor: 10000, status: 'CONFIRMED', source: 'SUPPLIER' },
      { type: 'DOMESTIC_SHIPPING', label: 'Domestic', amountMinor: 500, status: 'CONFIRMED', source: 'SUPPLIER' },
      { type: 'INTERNATIONAL_SHIPPING', label: 'Intl', amountMinor: 3000, status: 'ESTIMATED', source: 'SYSTEM_ESTIMATE' },
      { type: 'TAX_ESTIMATED', label: 'Duties', amountMinor: null, status: 'NOT_CONFIRMED', source: 'NOT_CONFIRMED' },
    ]);
    expect(s.confirmedTotalMinor).toBe(10500);
    expect(s.estimatedTotalMinor).toBe(3000);
    expect(s.hasUnconfirmed).toBe(true);
  });
  it('refuses to mark a system estimate as confirmed or give an unconfirmed fee an amount', () => {
    expect(() => summarizeFees([{ type: 'INTERNATIONAL_SHIPPING', label: 'x', amountMinor: 1, status: 'CONFIRMED', source: 'SYSTEM_ESTIMATE' }])).toThrow();
    expect(() => summarizeFees([{ type: 'OTHER', label: 'x', amountMinor: 1, status: 'NOT_CONFIRMED', source: 'NOT_CONFIRMED' }])).toThrow();
  });
});
