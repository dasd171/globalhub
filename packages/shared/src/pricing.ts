import { AppError } from './errors.js';
import { mulMinor } from './money.js';

export interface PriceTierInput {
  minQty: number;
  maxQty?: number | null;
  /** null = price on request */
  unitPriceMinor: number | null;
}

export type TierPrice =
  | { kind: 'priced'; unitPriceMinor: number; tier: PriceTierInput }
  | { kind: 'on_request'; tier: PriceTierInput | null };

/** Validate that tiers are sorted, non-overlapping and start >= 1. */
export function validateTiers(tiers: PriceTierInput[]): void {
  const sorted = [...tiers].sort((a, b) => a.minQty - b.minQty);
  for (let i = 0; i < sorted.length; i++) {
    const t = sorted[i];
    if (!Number.isInteger(t.minQty) || t.minQty < 1) throw new AppError('VALIDATION_FAILED', 'Tier minQty must be an integer >= 1');
    if (t.maxQty != null && t.maxQty < t.minQty) throw new AppError('VALIDATION_FAILED', 'Tier maxQty must be >= minQty');
    if (t.unitPriceMinor != null && (!Number.isInteger(t.unitPriceMinor) || t.unitPriceMinor < 0)) {
      throw new AppError('VALIDATION_FAILED', 'Tier price must be a non-negative integer (minor units)');
    }
    const next = sorted[i + 1];
    if (next && (t.maxQty == null || t.maxQty >= next.minQty)) {
      throw new AppError('VALIDATION_FAILED', `Price tiers overlap at quantity ${next.minQty}`);
    }
  }
}

/** Pick the tier for a quantity. Falls back to basePrice when there are no tiers. */
export function priceForQuantity(qty: number, tiers: PriceTierInput[], basePriceMinor?: number | null): TierPrice {
  if (!Number.isInteger(qty) || qty < 1) throw new AppError('VALIDATION_FAILED', 'Quantity must be a positive integer');
  if (tiers.length === 0) {
    return basePriceMinor == null ? { kind: 'on_request', tier: null } : { kind: 'priced', unitPriceMinor: basePriceMinor, tier: { minQty: 1, unitPriceMinor: basePriceMinor } };
  }
  const tier = [...tiers]
    .sort((a, b) => b.minQty - a.minQty)
    .find((t) => qty >= t.minQty && (t.maxQty == null || qty <= t.maxQty));
  if (!tier) {
    // Quantity below the first tier: use the lowest tier's price (MOQ is validated separately).
    const lowest = [...tiers].sort((a, b) => a.minQty - b.minQty)[0];
    if (qty < lowest.minQty) {
      return lowest.unitPriceMinor == null ? { kind: 'on_request', tier: lowest } : { kind: 'priced', unitPriceMinor: lowest.unitPriceMinor, tier: lowest };
    }
    return { kind: 'on_request', tier: null };
  }
  if (tier.unitPriceMinor == null) return { kind: 'on_request', tier };
  return { kind: 'priced', unitPriceMinor: tier.unitPriceMinor, tier };
}

export function assertMoq(qty: number, moq: number): void {
  if (qty < moq) throw new AppError('MOQ_NOT_MET', `Minimum order quantity is ${moq}`, { moq, requested: qty });
}

export function lineTotal(qty: number, tiers: PriceTierInput[], basePriceMinor: number | null | undefined, moq: number) {
  assertMoq(qty, moq);
  const p = priceForQuantity(qty, tiers, basePriceMinor);
  if (p.kind === 'on_request') throw new AppError('BAD_REQUEST', 'Price for this quantity is on request — ask the supplier for a quote');
  return { unitPriceMinor: p.unitPriceMinor, lineTotalMinor: mulMinor(p.unitPriceMinor, qty) };
}
