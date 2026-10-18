import { randomUUID } from 'node:crypto';
import { AppError, type ShipmentStatus } from '@globalhub/shared';

export interface ShippingQuoteInput {
  origin: string; destinationCountry: string; weightGrams: number; lengthCm?: number; widthCm?: number; heightCm?: number;
  quantity: number; category?: string; method?: string; insured?: boolean; containsBattery?: boolean; dangerousGoods?: boolean;
}
export interface ShippingQuote {
  method: string; amountMinor: number; currency: string; transitDaysMin: number; transitDaysMax: number;
  insuranceMinor?: number; dutiesNote: string; source: 'SYSTEM_ESTIMATE' | 'THIRD_PARTY'; isDemo: boolean;
}
export interface ShippingProvider {
  readonly name: string;
  readonly isDemo: boolean;
  quote(input: ShippingQuoteInput): Promise<ShippingQuote[]>;
  createShipment(input: { orderId: string; carrier?: string; method?: string }): Promise<{ trackingNumber: string; carrier: string }>;
  track(trackingNumber: string): Promise<{ status: ShipmentStatus; location?: string; description?: string; occurredAt: Date }[]>;
}

/** Mock logistics. All numbers are illustrative and flagged isDemo so the UI labels them DEMO. */
export class MockShippingProvider implements ShippingProvider {
  readonly name = 'mock';
  readonly isDemo = true;
  async quote(i: ShippingQuoteInput): Promise<ShippingQuote[]> {
    if (i.dangerousGoods) throw new AppError('NOT_SUPPORTED', 'Dangerous goods require a specialist forwarder quote');
    const kg = Math.max(0.5, i.weightGrams / 1000);
    const volKg = i.lengthCm && i.widthCm && i.heightCm ? (i.lengthCm * i.widthCm * i.heightCm) / 5000 : 0;
    const billable = Math.ceil(Math.max(kg, volKg) * 2) / 2;
    const note = 'Import duties/taxes not included — not yet confirmed';
    const methods: ShippingQuote[] = [
      { method: 'AIR_EXPRESS', amountMinor: Math.round(1800 + billable * 900), currency: 'USD', transitDaysMin: 4, transitDaysMax: 8, dutiesNote: note, source: 'SYSTEM_ESTIMATE', isDemo: true },
      { method: 'AIR_ECONOMY', amountMinor: Math.round(900 + billable * 550), currency: 'USD', transitDaysMin: 10, transitDaysMax: 20, dutiesNote: note, source: 'SYSTEM_ESTIMATE', isDemo: true },
    ];
    if (billable >= 100) methods.push({ method: 'SEA_LCL', amountMinor: Math.round(15000 + billable * 120), currency: 'USD', transitDaysMin: 25, transitDaysMax: 45, dutiesNote: 'Destination port charges and duties not included', source: 'SYSTEM_ESTIMATE', isDemo: true });
    if (i.containsBattery) methods.forEach((m) => { m.dutiesNote += '; battery surcharge may apply'; });
    return methods.map((m) => ({ ...m, insuranceMinor: i.insured ? Math.round(m.amountMinor * 0.03) : undefined }));
  }
  async createShipment(input: { carrier?: string }) { return { trackingNumber: `DEMO${randomUUID().slice(0, 10).toUpperCase()}`, carrier: input.carrier ?? 'DEMO-CARRIER' }; }
  async track(_tn: string) { return [{ status: 'IN_TRANSIT' as ShipmentStatus, location: 'DEMO hub', description: 'Demo tracking event', occurredAt: new Date() }]; }
}

/** No external API: suppliers enter carrier, tracking number and events by hand. */
export class ManualShippingProvider implements ShippingProvider {
  readonly name = 'manual';
  readonly isDemo = false;
  async quote(): Promise<ShippingQuote[]> { return []; }
  async createShipment(): Promise<never> { throw new AppError('NOT_SUPPORTED', 'Manual shipping: enter carrier and tracking number yourself'); }
  async track(): Promise<never> { throw new AppError('NOT_SUPPORTED', 'Manual shipping has no tracking API'); }
}
