import { AppError } from './errors.js';
import type { OrderStatus, QuoteStatus, RefundStatus } from './enums.js';

export type OrderActor = 'buyer' | 'supplier' | 'admin' | 'system';

type Rule<S extends string> = { to: S; actors: OrderActor[] };

/**
 * Order state machine. Admin may perform any *defined* transition (audited); "system" is
 * used for trusted automated events such as a verified payment webhook or expiry jobs.
 * PAID can only be reached through the payment service ("system"), never by a user click.
 */
export const ORDER_TRANSITIONS: Record<OrderStatus, Rule<OrderStatus>[]> = {
  DRAFT: [
    { to: 'PENDING_SUPPLIER_CONFIRMATION', actors: ['buyer'] },
    { to: 'CANCELLED', actors: ['buyer', 'system'] },
  ],
  PENDING_SUPPLIER_CONFIRMATION: [
    { to: 'AWAITING_PAYMENT', actors: ['supplier'] },
    { to: 'CANCELLED', actors: ['buyer', 'supplier', 'system'] },
  ],
  AWAITING_PAYMENT: [
    { to: 'PAID', actors: ['system'] },
    { to: 'CANCELLED', actors: ['buyer', 'supplier', 'system'] },
  ],
  PAID: [
    { to: 'PROCESSING', actors: ['supplier'] },
    { to: 'CANCELLATION_REQUESTED', actors: ['buyer'] },
    { to: 'REFUND_REQUESTED', actors: ['buyer'] },
    { to: 'DISPUTED', actors: ['buyer', 'supplier'] },
  ],
  PROCESSING: [
    { to: 'READY_TO_SHIP', actors: ['supplier'] },
    { to: 'CANCELLATION_REQUESTED', actors: ['buyer'] },
    { to: 'DISPUTED', actors: ['buyer', 'supplier'] },
  ],
  READY_TO_SHIP: [
    { to: 'SHIPPED', actors: ['supplier', 'system'] },
    { to: 'DISPUTED', actors: ['buyer', 'supplier'] },
  ],
  SHIPPED: [
    { to: 'IN_TRANSIT', actors: ['supplier', 'system'] },
    { to: 'DELIVERED', actors: ['supplier', 'system', 'buyer'] },
    { to: 'DISPUTED', actors: ['buyer', 'supplier'] },
  ],
  IN_TRANSIT: [
    { to: 'DELIVERED', actors: ['supplier', 'system', 'buyer'] },
    { to: 'DISPUTED', actors: ['buyer', 'supplier'] },
  ],
  DELIVERED: [
    { to: 'COMPLETED', actors: ['buyer', 'system'] },
    { to: 'REFUND_REQUESTED', actors: ['buyer'] },
    { to: 'DISPUTED', actors: ['buyer', 'supplier'] },
  ],
  CANCELLATION_REQUESTED: [
    { to: 'REFUND_REQUESTED', actors: ['supplier'] },
    { to: 'PROCESSING', actors: ['supplier'] },
    { to: 'DISPUTED', actors: ['buyer'] },
  ],
  REFUND_REQUESTED: [
    { to: 'REFUNDED', actors: ['system'] },
    { to: 'PARTIALLY_REFUNDED', actors: ['system'] },
    { to: 'PROCESSING', actors: ['supplier'] },
    { to: 'COMPLETED', actors: ['supplier'] },
    { to: 'DISPUTED', actors: ['buyer'] },
  ],
  PARTIALLY_REFUNDED: [
    { to: 'COMPLETED', actors: ['buyer', 'system'] },
    { to: 'REFUNDED', actors: ['system'] },
    { to: 'DISPUTED', actors: ['buyer'] },
  ],
  DISPUTED: [
    { to: 'REFUNDED', actors: ['system'] },
    { to: 'PARTIALLY_REFUNDED', actors: ['system'] },
    { to: 'COMPLETED', actors: ['admin'] },
    { to: 'CANCELLED', actors: ['admin'] },
  ],
  COMPLETED: [{ to: 'DISPUTED', actors: ['buyer'] }],
  CANCELLED: [],
  REFUNDED: [],
};

export const TERMINAL_ORDER_STATUSES: OrderStatus[] = ['CANCELLED', 'REFUNDED'];

export function canTransitionOrder(from: OrderStatus, to: OrderStatus, actor: OrderActor): boolean {
  const rule = ORDER_TRANSITIONS[from]?.find((r) => r.to === to);
  if (!rule) return false;
  if (actor === 'admin') return rule.to !== 'PAID'; // even admins can't mark paid without the payment service
  return rule.actors.includes(actor);
}

export function assertOrderTransition(from: OrderStatus, to: OrderStatus, actor: OrderActor): void {
  if (!canTransitionOrder(from, to, actor)) {
    throw new AppError('INVALID_STATE_TRANSITION', `Order cannot move from ${from} to ${to} (actor: ${actor})`, { from, to, actor });
  }
}

export function allowedOrderTransitions(from: OrderStatus, actor: OrderActor): OrderStatus[] {
  return (ORDER_TRANSITIONS[from] ?? []).filter((r) => canTransitionOrder(from, r.to, actor)).map((r) => r.to);
}

export const REFUND_TRANSITIONS: Record<RefundStatus, { to: RefundStatus; actors: OrderActor[] }[]> = {
  REQUESTED: [
    { to: 'APPROVED', actors: ['supplier', 'admin'] },
    { to: 'REJECTED', actors: ['supplier', 'admin'] },
  ],
  APPROVED: [
    { to: 'PROCESSED_MANUAL', actors: ['supplier', 'admin'] },
    { to: 'PROCESSED_PROVIDER', actors: ['system'] },
  ],
  REJECTED: [],
  PROCESSED_MANUAL: [],
  PROCESSED_PROVIDER: [],
};

export function assertRefundTransition(from: RefundStatus, to: RefundStatus, actor: OrderActor): void {
  const rule = REFUND_TRANSITIONS[from].find((r) => r.to === to);
  if (!rule || !rule.actors.includes(actor)) {
    throw new AppError('INVALID_STATE_TRANSITION', `Refund cannot move from ${from} to ${to} (actor: ${actor})`);
  }
}

export const QUOTE_TRANSITIONS: Record<QuoteStatus, QuoteStatus[]> = {
  DRAFT: ['SUBMITTED', 'WITHDRAWN'],
  SUBMITTED: ['VIEWED', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'WITHDRAWN'],
  VIEWED: ['ACCEPTED', 'REJECTED', 'EXPIRED', 'WITHDRAWN'],
  ACCEPTED: [],
  REJECTED: [],
  EXPIRED: [],
  WITHDRAWN: [],
};

export function assertQuoteTransition(from: QuoteStatus, to: QuoteStatus): void {
  if (!QUOTE_TRANSITIONS[from].includes(to)) {
    throw new AppError('INVALID_STATE_TRANSITION', `Quote cannot move from ${from} to ${to}`);
  }
}
