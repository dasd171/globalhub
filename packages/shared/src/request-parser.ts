import { findCountryInText } from './countries.js';
import type { SupplierType } from './enums.js';

/** Structured view of a free-text buying request or search query. */
export interface ParsedRequest {
  product: string;
  keywords: string[];
  quantity: number | null;
  unit: string | null;
  destinationCountry: string | null;
  supplierType: SupplierType | null;
  requirements: string[];
  requestedServices: string[];
  targetUnitPrice: { amount: string; currency: string } | null;
  customization: boolean;
  needsSample: boolean;
  needsInspection: boolean;
  oemOdm: boolean;
  /** "rules" = deterministic parser; "ai" = produced by an AI provider and editable by the user */
  parsedBy: 'rules' | 'ai';
}

const STOPWORDS = new Set([
  'i', 'need', 'want', 'looking', 'for', 'find', 'buy', 'please', 'the', 'a', 'an', 'of', 'to', 'and', 'with', 'from',
  'preferably', 'manufacturer', 'factory', 'supplier', 'suppliers', 'quote', 'best', 'available',
  'price', 'shipping', 'shipped', 'ship', 'suitable', 'units', 'pcs', 'pieces', 'sets', 'set', 'quotation', 'cost', 'me',
  'us', 'we', 'our', 'my', 'in', 'on', 'at', 'by', 'is', 'are', 'be', 'it', 'that', 'this', 'can', 'you', 'some', 'about',
  'around', 'approximately', 'deliver', 'delivery', 'delivered', 'including', 'include', 'per', 'unit', 'each', 'target',
]);

const FEATURE_WORDS = [
  'waterproof', 'wireless', 'bluetooth', 'usb-c', 'usb', 'hdmi', 'ethernet', 'rechargeable', 'stainless', 'organic',
  'cotton', 'leather', 'led', 'solar', 'portable', 'foldable', 'eco-friendly', 'biodegradable', 'magnetic', 'ce', 'fcc', 'rohs',
];

const UNIT_RE = /(\d[\d,]*)\s*(units?|pcs|pieces|sets?|pairs?|boxes|cartons|kg|tons?|meters?)?/i;

export function parseBuyingRequestText(text: string): ParsedRequest {
  const t = text.trim();
  const lower = t.toLowerCase();

  let quantity: number | null = null;
  let unit: string | null = null;
  const qm = lower.match(UNIT_RE);
  if (qm) {
    const n = Number(qm[1].replace(/,/g, ''));
    if (Number.isFinite(n) && n > 0 && n < 100_000_000) {
      quantity = n;
      unit = qm[2] ? qm[2].toLowerCase() : 'units';
    }
  }

  let supplierType: SupplierType | null = null;
  if (/manufacturer|factory/.test(lower)) supplierType = 'MANUFACTURER';
  else if (/wholesal/.test(lower)) supplierType = 'WHOLESALER';
  else if (/distributor/.test(lower)) supplierType = 'DISTRIBUTOR';
  else if (/trading company/.test(lower)) supplierType = 'TRADING_COMPANY';

  const requirements = FEATURE_WORDS.filter((w) => new RegExp(`(^|[^a-z])${w.replace('-', '\\-')}([^a-z]|$)`).test(lower));
  if (quantity && quantity >= 50) requirements.push('bulk purchase');

  const requestedServices: string[] = [];
  if (/ship|deliver|freight/.test(lower)) requestedServices.push('shipping quotation');
  const needsSample = /sample/.test(lower);
  const needsInspection = /inspect|qc|quality check/.test(lower);
  const oemOdm = /\boem\b|\bodm\b|private label|logo/.test(lower);
  const customization = oemOdm || /custom/.test(lower);
  if (needsSample) requestedServices.push('samples');
  if (needsInspection) requestedServices.push('inspection');
  if (oemOdm) requestedServices.push('OEM/ODM');

  let targetUnitPrice: ParsedRequest['targetUnitPrice'] = null;
  const pm = t.match(/(?:\$|usd\s?)(\d+(?:\.\d{1,2})?)/i) ?? t.match(/(\d+(?:\.\d{1,2})?)\s?(?:usd|dollars)/i);
  if (pm) targetUnitPrice = { amount: pm[1], currency: 'USD' };
  const cny = t.match(/(?:¥|rmb\s?|cny\s?)(\d+(?:\.\d{1,2})?)/i) ?? t.match(/(\d+(?:\.\d{1,2})?)\s?(?:rmb|cny)/i);
  if (!targetUnitPrice && cny) targetUnitPrice = { amount: cny[1], currency: 'CNY' };

  const destinationCountry = findCountryInText(t);

  // Product phrase: words that remain after removing quantities, stopwords and country names.
  const words = lower
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w && !/^\d/.test(w) && !STOPWORDS.has(w));
  const countryWords = new Set(destinationCountry ? ['japan', 'usa', 'america', 'germany', 'uk', 'france', 'canada', 'australia', 'korea', 'states', 'united', 'kingdom'] : []);
  const keywords = [...new Set(words.filter((w) => !countryWords.has(w) && w.length > 1))];
  const productWords = keywords.filter((w) => !requirements.includes(w)).slice(0, 4);
  const product = [...requirements.filter((r) => r !== 'bulk purchase').slice(0, 1), ...productWords]
    .join(' ')
    .replace(/s\b/, '')
    .trim();

  return {
    product: product ? product.charAt(0).toUpperCase() + product.slice(1) : t.slice(0, 60),
    keywords,
    quantity,
    unit,
    destinationCountry,
    supplierType,
    requirements,
    requestedServices,
    targetUnitPrice,
    customization,
    needsSample,
    needsInspection,
    oemOdm,
    parsedBy: 'rules',
  };
}
