import { describe, it, expect } from 'vitest';
import { scoreCandidate, rankCandidates, hasPermission, canActOnResource, permissionsFor, parseBuyingRequestText, applyReservation, releaseReservation, consumeReservation, canReserve, deriveStockStatus, type MatchCandidate } from '@globalhub/shared';

const base: MatchCandidate = { id: 'p1', title: 'Waterproof camping tent 4 person', description: 'polyester', moq: 10, unitPriceMinor: 2000, currency: 'USD', stockStatus: 'IN_STOCK', shipsTo: ['JP'], supplierType: 'MANUFACTURER', verification: 'BUSINESS_VERIFIED', customizable: true, source: 'local' };

describe('matching engine', () => {
  it('scores keyword, stock, destination, supplier type and verification with reasons', () => {
    const r = scoreCandidate({ keywords: ['tent', 'camping'], destinationCountry: 'JP', supplierType: 'MANUFACTURER', quantity: 100, maxUnitPriceMinor: 2500, currency: 'USD' }, base);
    expect(r.excluded).toBe(false);
    expect(r.score).toBe(40 + 10 + 10 + 5 + 5 + 5);
    expect(r.reasons.join(' ')).toMatch(/keywords/);
    expect(r.reasons).toContain('Supplier-confirmed stock');
  });
  it('excludes on hard filters', () => {
    expect(scoreCandidate({ keywords: ['tent'], quantity: 5 }, base).excluded).toBe(true); // MOQ 10 > 5
    expect(scoreCandidate({ keywords: ['tent'], destinationCountry: 'US' }, base).excluded).toBe(true);
    expect(scoreCandidate({ keywords: ['tent'] }, { ...base, stockStatus: 'OUT_OF_STOCK' }).excluded).toBe(true);
    expect(scoreCandidate({ keywords: ['tent'] }, { ...base, verification: 'SUSPENDED' }).excluded).toBe(true);
    expect(scoreCandidate({ keywords: ['kettle'] }, base).excluded).toBe(true);
    expect(scoreCandidate({ keywords: ['tent'], minVerification: 'ADMIN_REVIEWED' }, base).excluded).toBe(true);
  });
  it('flags unverified stock and federated data as warnings, not points', () => {
    const r = scoreCandidate({ keywords: ['tent'] }, { ...base, stockStatus: 'UNVERIFIED', source: 'federated' });
    expect(r.warnings).toContain('Stock not verified');
    expect(r.warnings.join()).toMatch(/remote node/);
  });
  it('ranks deterministically', () => {
    const list = [{ ...base, id: 'b', verification: 'UNVERIFIED' as const }, { ...base, id: 'a' }];
    expect(rankCandidates({ keywords: ['tent'] }, list).map((r) => r.id)).toEqual(['a', 'b']);
  });
});

describe('RBAC', () => {
  it('grants permissions by role and denies guests', () => {
    expect(hasPermission({ id: 'u', roles: ['BUYER'] }, 'order:create')).toBe(true);
    expect(hasPermission({ id: 'u', roles: ['BUYER'] }, 'quote:submit')).toBe(false);
    expect(hasPermission({ id: 'u', roles: ['SUPPLIER'] }, 'product:manage_own')).toBe(true);
    expect(hasPermission(null, 'catalog:read')).toBe(true);
    expect(hasPermission(null, 'order:create')).toBe(false);
    expect(hasPermission({ id: 'u', roles: ['MODERATOR'] }, 'admin:users')).toBe(false);
    expect(hasPermission({ id: 'u', roles: ['PLATFORM_ADMIN'] }, 'admin:users')).toBe(true);
  });
  it('denies disabled accounts everything', () => {
    expect(hasPermission({ id: 'u', roles: ['PLATFORM_ADMIN'], status: 'DISABLED' }, 'admin:users')).toBe(false);
  });
  it('checks resource ownership with explicit override permission', () => {
    expect(canActOnResource({ id: 'a', roles: ['BUYER'] }, 'a')).toBe(true);
    expect(canActOnResource({ id: 'a', roles: ['BUYER'] }, 'b')).toBe(false);
    expect(canActOnResource({ id: 'a', roles: ['PLATFORM_ADMIN'] }, 'b', 'admin:orders')).toBe(true);
    expect(canActOnResource({ id: 'a', roles: ['MODERATOR'] }, 'b', 'admin:orders')).toBe(false);
  });
  it('node admin cannot manage users', () => {
    expect(permissionsFor(['NODE_ADMIN']).has('admin:users')).toBe(false);
    expect(permissionsFor(['NODE_ADMIN']).has('node:manage')).toBe(true);
  });
});

describe('buying request parser (no AI)', () => {
  it('parses the reference example', () => {
    const p = parseBuyingRequestText('I need 100 waterproof camping tents, preferably from a factory. Please quote the best available price and shipping to Japan.');
    expect(p.quantity).toBe(100);
    expect(p.destinationCountry).toBe('JP');
    expect(p.supplierType).toBe('MANUFACTURER');
    expect(p.requirements).toEqual(expect.arrayContaining(['waterproof', 'bulk purchase']));
    expect(p.requestedServices).toContain('shipping quotation');
    expect(p.product.toLowerCase()).toContain('tent');
    expect(p.targetUnitPrice).toBeNull();
  });
  it('parses features and target price', () => {
    const p = parseBuyingRequestText('Find 200 USB-C hubs with HDMI and Ethernet under $15, shipped to United States');
    expect(p.quantity).toBe(200);
    expect(p.destinationCountry).toBe('US');
    expect(p.requirements).toEqual(expect.arrayContaining(['usb-c', 'hdmi', 'ethernet']));
    expect(p.targetUnitPrice).toEqual({ amount: '15', currency: 'USD' });
  });
  it('detects samples and customization', () => {
    const p = parseBuyingRequestText('Need 500 insulated bottles with custom logo, delivered to Japan, samples required');
    expect(p.quantity).toBe(500);
    expect(p.destinationCountry).toBe('JP');
    expect(p.oemOdm).toBe(true);
    expect(p.needsSample).toBe(true);
    expect(p.customization).toBe(true);
  });
});

describe('inventory model', () => {
  it('reserves, releases and consumes without going negative', () => {
    let inv = { onHand: 5, reserved: 0 };
    inv = applyReservation(inv, 3);
    expect(canReserve(inv, 3)).toBe(false);
    expect(() => applyReservation(inv, 3)).toThrow();
    inv = consumeReservation(inv, 3);
    expect(inv).toEqual({ onHand: 2, reserved: 0 });
    expect(releaseReservation({ onHand: 2, reserved: 1 }, 5)).toEqual({ onHand: 2, reserved: 0 });
  });
  it('never reports unverified or stale stock as in stock', () => {
    const now = new Date('2026-01-31T00:00:00Z');
    expect(deriveStockStatus(null)).toBe('UNVERIFIED');
    expect(deriveStockStatus({ onHand: 100, reserved: 0, verifiedAt: null })).toBe('UNVERIFIED');
    expect(deriveStockStatus({ onHand: 100, reserved: 0, verifiedAt: new Date('2025-12-01T00:00:00Z') }, { now })).toBe('UNVERIFIED');
    expect(deriveStockStatus({ onHand: 100, reserved: 0, verifiedAt: now }, { now })).toBe('IN_STOCK');
    expect(deriveStockStatus({ onHand: 12, reserved: 5, verifiedAt: now }, { now })).toBe('LOW_STOCK');
    expect(deriveStockStatus({ onHand: 5, reserved: 5, verifiedAt: now }, { now })).toBe('OUT_OF_STOCK');
  });
});
