import { describe, it, expect } from 'vitest';
import { canTransitionOrder, assertOrderTransition, allowedOrderTransitions, assertRefundTransition, assertQuoteTransition, ORDER_STATUSES, ORDER_TRANSITIONS } from '@globalhub/shared';

describe('order state machine', () => {
  it('follows the happy path with the right actors', () => {
    const path: [string, string, string][] = [
      ['DRAFT', 'PENDING_SUPPLIER_CONFIRMATION', 'buyer'], ['PENDING_SUPPLIER_CONFIRMATION', 'AWAITING_PAYMENT', 'supplier'], ['AWAITING_PAYMENT', 'PAID', 'system'],
      ['PAID', 'PROCESSING', 'supplier'], ['PROCESSING', 'READY_TO_SHIP', 'supplier'], ['READY_TO_SHIP', 'SHIPPED', 'supplier'], ['SHIPPED', 'IN_TRANSIT', 'supplier'],
      ['IN_TRANSIT', 'DELIVERED', 'supplier'], ['DELIVERED', 'COMPLETED', 'buyer'],
    ];
    for (const [f, t, a] of path) expect(canTransitionOrder(f as never, t as never, a as never), `${f}->${t}`).toBe(true);
  });
  it('rejects illegal jumps', () => {
    expect(() => assertOrderTransition('DRAFT', 'SHIPPED', 'supplier')).toThrow(/cannot move/);
    expect(() => assertOrderTransition('PENDING_SUPPLIER_CONFIRMATION', 'PAID', 'buyer')).toThrow();
    expect(canTransitionOrder('CANCELLED', 'PAID', 'system')).toBe(false);
    expect(canTransitionOrder('REFUNDED', 'COMPLETED', 'admin')).toBe(false);
  });
  it('only the payment system can mark an order paid — not buyers, suppliers or admins', () => {
    for (const a of ['buyer', 'supplier', 'admin'] as const) expect(canTransitionOrder('AWAITING_PAYMENT', 'PAID', a)).toBe(false);
    expect(canTransitionOrder('AWAITING_PAYMENT', 'PAID', 'system')).toBe(true);
  });
  it('buyer cannot confirm on behalf of supplier, supplier cannot complete for buyer', () => {
    expect(canTransitionOrder('PENDING_SUPPLIER_CONFIRMATION', 'AWAITING_PAYMENT', 'buyer')).toBe(false);
    expect(canTransitionOrder('DELIVERED', 'COMPLETED', 'supplier')).toBe(false);
  });
  it('defines rules for every status and terminal states have no exits', () => {
    for (const s of ORDER_STATUSES) expect(ORDER_TRANSITIONS[s]).toBeDefined();
    expect(allowedOrderTransitions('CANCELLED', 'admin')).toEqual([]);
    expect(allowedOrderTransitions('REFUNDED', 'admin')).toEqual([]);
  });
});

describe('refund state machine', () => {
  it('requires approval before processing and only the provider can mark PROCESSED_PROVIDER', () => {
    expect(() => assertRefundTransition('REQUESTED', 'APPROVED', 'supplier')).not.toThrow();
    expect(() => assertRefundTransition('REQUESTED', 'PROCESSED_MANUAL', 'supplier')).toThrow();
    expect(() => assertRefundTransition('APPROVED', 'PROCESSED_PROVIDER', 'supplier')).toThrow();
    expect(() => assertRefundTransition('APPROVED', 'PROCESSED_PROVIDER', 'system')).not.toThrow();
    expect(() => assertRefundTransition('REQUESTED', 'APPROVED', 'buyer')).toThrow();
    expect(() => assertRefundTransition('REJECTED', 'APPROVED', 'admin')).toThrow();
  });
});

describe('quote state machine', () => {
  it('allows the documented lifecycle only', () => {
    expect(() => assertQuoteTransition('SUBMITTED', 'VIEWED')).not.toThrow();
    expect(() => assertQuoteTransition('VIEWED', 'ACCEPTED')).not.toThrow();
    expect(() => assertQuoteTransition('ACCEPTED', 'WITHDRAWN')).toThrow();
    expect(() => assertQuoteTransition('EXPIRED', 'ACCEPTED')).toThrow();
    expect(() => assertQuoteTransition('DRAFT', 'ACCEPTED')).toThrow();
  });
});
