export interface InventorySnapshot {
  onHand: number;
  reserved: number;
}

export function available(inv: InventorySnapshot): number {
  return Math.max(0, inv.onHand - inv.reserved);
}

export function canReserve(inv: InventorySnapshot, qty: number): boolean {
  return Number.isInteger(qty) && qty > 0 && available(inv) >= qty;
}

/** Pure model of a reservation; the database performs the same check atomically. */
export function applyReservation(inv: InventorySnapshot, qty: number): InventorySnapshot {
  if (!canReserve(inv, qty)) throw new Error('Insufficient stock');
  return { onHand: inv.onHand, reserved: inv.reserved + qty };
}

export function releaseReservation(inv: InventorySnapshot, qty: number): InventorySnapshot {
  return { onHand: inv.onHand, reserved: Math.max(0, inv.reserved - qty) };
}

export function consumeReservation(inv: InventorySnapshot, qty: number): InventorySnapshot {
  if (inv.reserved < qty || inv.onHand < qty) throw new Error('Reservation larger than stock');
  return { onHand: inv.onHand - qty, reserved: inv.reserved - qty };
}

/**
 * Derive the public stock status. Unverified or stale (>= staleDays) inventory can never be
 * shown as In Stock — it is reported as UNVERIFIED so buyers re-confirm with the supplier.
 */
export function deriveStockStatus(
  inv: (InventorySnapshot & { verifiedAt: Date | null }) | null,
  opts: { madeToOrder?: boolean; lowStockThreshold?: number; staleDays?: number; now?: Date } = {},
): 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK' | 'UNVERIFIED' | 'MADE_TO_ORDER' {
  if (opts.madeToOrder) return 'MADE_TO_ORDER';
  if (!inv || !inv.verifiedAt) return 'UNVERIFIED';
  const staleMs = (opts.staleDays ?? 30) * 86400_000;
  if ((opts.now ?? new Date()).getTime() - inv.verifiedAt.getTime() > staleMs) return 'UNVERIFIED';
  const a = available(inv);
  if (a <= 0) return 'OUT_OF_STOCK';
  if (a <= (opts.lowStockThreshold ?? 10)) return 'LOW_STOCK';
  return 'IN_STOCK';
}
