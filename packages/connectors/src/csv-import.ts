import Papa from 'papaparse';
import { STOCK_STATUSES, toMinor } from '@globalhub/shared';

/** Canonical import fields. Columns in the uploaded file are mapped onto these. */
export const IMPORT_FIELDS = [
  'sku', 'title_en', 'description_en', 'category', 'price', 'currency', 'stock', 'moq',
  'specs', 'image_urls', 'ships_from', 'ships_to', 'status',
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

const DEFAULT_ALIASES: Record<string, ImportField> = {
  sku: 'sku', 'sku code': 'sku', 'item code': 'sku',
  title: 'title_en', 'title_en': 'title_en', name: 'title_en', 'product name': 'title_en',
  'description_en': 'description_en', description: 'description_en',
  category: 'category',
  price: 'price', 'unit price': 'price',
  currency: 'currency',
  stock: 'stock', inventory: 'stock', quantity: 'stock',
  moq: 'moq', 'minimum order quantity': 'moq',
  specs: 'specs', specifications: 'specs',
  image_urls: 'image_urls', images: 'image_urls',
  ships_from: 'ships_from',
  ships_to: 'ships_to',
  status: 'status',
};

export interface ImportRow {
  rowNumber: number;
  sku: string;
  titleEn: string;
  descriptionEn?: string;
  category?: string;
  currency: string;
  priceMinor: number | null;
  stock: number | null;
  moq: number;
  specs: Record<string, string>;
  imageUrls: string[];
  shipsFrom?: string;
  shipsTo: string[];
  status: 'DRAFT' | 'ACTIVE';
  stockStatusHint?: string;
}
export interface ImportError { rowNumber: number; field?: string; message: string }
export interface ImportPreview { mapping: Record<string, ImportField>; headers: string[]; valid: ImportRow[]; errors: ImportError[]; totalRows: number }

export function suggestMapping(headers: string[]): Record<string, ImportField> {
  const m: Record<string, ImportField> = {};
  for (const h of headers) {
    const key = h.trim().toLowerCase();
    if (DEFAULT_ALIASES[key]) m[h] = DEFAULT_ALIASES[key];
    else if ((IMPORT_FIELDS as readonly string[]).includes(key)) m[h] = key as ImportField;
  }
  return m;
}

/** Parse + validate a CSV. Nothing is written; the caller persists only after preview. */
export function previewCsv(csv: string, mapping?: Record<string, string>, existingSkus: Set<string> = new Set(), maxRows = 5000): ImportPreview {
  const parsed = Papa.parse<Record<string, string>>(csv.replace(/^\uFEFF/, ''), { header: true, skipEmptyLines: 'greedy' });
  const headers = parsed.meta.fields ?? [];
  const map: Record<string, ImportField> = mapping
    ? Object.fromEntries(Object.entries(mapping).filter(([, v]) => (IMPORT_FIELDS as readonly string[]).includes(v))) as Record<string, ImportField>
    : suggestMapping(headers);
  const errors: ImportError[] = parsed.errors.slice(0, 50).map((e) => ({ rowNumber: (e.row ?? 0) + 2, message: `CSV parse error: ${e.message}` }));
  const valid: ImportRow[] = [];
  const seen = new Map<string, number>();
  const rows = parsed.data.slice(0, maxRows);
  if (parsed.data.length > maxRows) errors.push({ rowNumber: maxRows + 2, message: `File has more than ${maxRows} rows; extra rows ignored` });
  if (!Object.values(map).includes('sku')) errors.push({ rowNumber: 1, field: 'sku', message: 'No column mapped to "sku"' });

  rows.forEach((raw, i) => {
    const rowNumber = i + 2; // header is row 1
    const get = (f: ImportField) => { const col = Object.keys(map).find((k) => map[k] === f); return col ? (raw[col] ?? '').trim() : ''; };
    const rowErrors: ImportError[] = [];
    const sku = get('sku');
    if (!sku) rowErrors.push({ rowNumber, field: 'sku', message: 'SKU is required' });
    else if (!/^[A-Za-z0-9._-]{1,64}$/.test(sku)) rowErrors.push({ rowNumber, field: 'sku', message: 'SKU may contain letters, digits, . _ - (max 64)' });
    else if (seen.has(sku)) rowErrors.push({ rowNumber, field: 'sku', message: `Duplicate SKU in file (also row ${seen.get(sku)})` });
    else if (existingSkus.has(sku)) rowErrors.push({ rowNumber, field: 'sku', message: 'SKU already exists in this store' });
    if (sku) seen.set(sku, rowNumber);
    const titleEn = get('title_en');
    if (!titleEn) rowErrors.push({ rowNumber, field: 'title_en', message: 'Title is required' });
    const currency = (get('currency') || 'USD').toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) rowErrors.push({ rowNumber, field: 'currency', message: 'Currency must be a 3-letter code' });
    let priceMinor: number | null = null;
    const price = get('price');
    if (price) { try { priceMinor = toMinor(price, currency); if (priceMinor < 0) throw new Error(); } catch { rowErrors.push({ rowNumber, field: 'price', message: `Invalid price "${price}"` }); } }
    let stock: number | null = null;
    const st = get('stock');
    if (st) { if (!/^\d+$/.test(st)) rowErrors.push({ rowNumber, field: 'stock', message: 'Stock must be a whole number' }); else stock = Number(st); }
    const moqRaw = get('moq') || '1';
    if (!/^\d+$/.test(moqRaw) || Number(moqRaw) < 1) rowErrors.push({ rowNumber, field: 'moq', message: 'MOQ must be a whole number >= 1' });
    const imageUrls = get('image_urls').split(/[|\s]+/).filter(Boolean);
    for (const u of imageUrls) if (!/^https:\/\/[^\s]+$/i.test(u)) rowErrors.push({ rowNumber, field: 'image_urls', message: `Image URL must be https: ${u.slice(0, 60)}` });
    const shipsTo = get('ships_to').split(/[|,;\s]+/).filter(Boolean).map((c) => c.toUpperCase());
    for (const c of shipsTo) if (!/^[A-Z]{2}$/.test(c)) rowErrors.push({ rowNumber, field: 'ships_to', message: `Invalid country code ${c}` });
    const specs: Record<string, string> = {};
    for (const pair of get('specs').split(/[|;]/).filter(Boolean)) {
      const [k, ...v] = pair.split(/[:=]/);
      if (k && v.length) specs[k.trim().slice(0, 100)] = v.join(':').trim().slice(0, 500);
    }
    const statusRaw = get('status').toUpperCase();
    if (statusRaw && !['DRAFT', 'ACTIVE', ...STOCK_STATUSES].includes(statusRaw)) rowErrors.push({ rowNumber, field: 'status', message: `Unknown status ${statusRaw}` });
    if (rowErrors.length) { errors.push(...rowErrors); return; }
    valid.push({
      rowNumber, sku, titleEn, descriptionEn: get('description_en') || undefined,
      category: get('category') || undefined, currency, priceMinor, stock, moq: Number(moqRaw), specs, imageUrls, shipsFrom: get('ships_from') || undefined, shipsTo,
      status: statusRaw === 'ACTIVE' ? 'ACTIVE' : 'DRAFT', stockStatusHint: statusRaw && statusRaw !== 'ACTIVE' && statusRaw !== 'DRAFT' ? statusRaw : undefined,
    });
  });
  return { mapping: map, headers, valid, errors, totalRows: rows.length };
}
