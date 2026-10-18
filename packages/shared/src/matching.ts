import type { StockStatus, SupplierType, VerificationStatus } from './enums.js';

export interface MatchCriteria {
  keywords: string[];
  categoryId?: string | null;
  quantity?: number | null;
  maxUnitPriceMinor?: number | null;
  currency?: string | null;
  destinationCountry?: string | null;
  shipsFrom?: string | null;
  supplierType?: SupplierType | null;
  minVerification?: VerificationStatus | null;
  needsCustomization?: boolean;
  requiredFeatures?: string[];
}

export interface MatchCandidate {
  id: string;
  title: string;
  description?: string | null;
  categoryId?: string | null;
  moq: number;
  unitPriceMinor?: number | null;
  currency?: string | null;
  stockStatus: StockStatus;
  shipsFrom?: string | null;
  shipsTo: string[];
  supplierType?: SupplierType | null;
  verification?: VerificationStatus | null;
  customizable?: boolean;
  specsText?: string | null;
  source: 'local' | 'federated';
}

export interface MatchResult {
  id: string;
  score: number;
  excluded: boolean;
  reasons: string[];
  warnings: string[];
}

const VERIFICATION_RANK: Record<VerificationStatus, number> = {
  SUSPENDED: -1, UNVERIFIED: 0, EMAIL_VERIFIED: 1, BUSINESS_DETAILS_SUBMITTED: 2, BUSINESS_VERIFIED: 3, ADMIN_REVIEWED: 4,
};

export const MATCH_WEIGHTS = {
  keyword: 40,
  category: 10,
  features: 15,
  price: 10,
  stock: 10,
  destination: 5,
  supplierType: 5,
  verification: 5,
} as const;

/**
 * Explainable rule-based scoring. Hard filters exclude a candidate; soft criteria add points.
 * Maximum score is 100. Every point awarded is accompanied by a human-readable reason.
 */
export function scoreCandidate(c: MatchCriteria, p: MatchCandidate): MatchResult {
  const reasons: string[] = [];
  const warnings: string[] = [];
  let score = 0;
  let excluded = false;
  const hay = `${p.title} ${p.description ?? ''} ${p.specsText ?? ''}`.toLowerCase();

  // Hard filters
  if (p.verification === 'SUSPENDED') { excluded = true; warnings.push('Supplier suspended'); }
  if (p.stockStatus === 'OUT_OF_STOCK') { excluded = true; warnings.push('Out of stock'); }
  if (c.destinationCountry && p.shipsTo.length > 0 && !p.shipsTo.includes(c.destinationCountry)) {
    excluded = true; warnings.push(`Does not ship to ${c.destinationCountry}`);
  }
  if (c.minVerification && (VERIFICATION_RANK[p.verification ?? 'UNVERIFIED'] < VERIFICATION_RANK[c.minVerification])) {
    excluded = true; warnings.push('Below required verification level');
  }
  if (c.needsCustomization && !p.customizable) { excluded = true; warnings.push('No customization offered'); }

  // Keyword relevance
  const kws = c.keywords.map((k) => k.toLowerCase()).filter(Boolean);
  if (kws.length) {
    const hits = kws.filter((k) => hay.includes(k));
    const pts = Math.round((hits.length / kws.length) * MATCH_WEIGHTS.keyword);
    score += pts;
    if (hits.length) reasons.push(`Matches keywords: ${hits.join(', ')}`);
    if (hits.length === 0) excluded = true;
  } else {
    score += MATCH_WEIGHTS.keyword / 2;
  }

  if (c.categoryId && p.categoryId === c.categoryId) { score += MATCH_WEIGHTS.category; reasons.push('Same category'); }

  const feats = (c.requiredFeatures ?? []).map((f) => f.toLowerCase());
  if (feats.length) {
    const hits = feats.filter((f) => hay.includes(f));
    score += Math.round((hits.length / feats.length) * MATCH_WEIGHTS.features);
    if (hits.length) reasons.push(`Has required features: ${hits.join(', ')}`);
    const missing = feats.filter((f) => !hay.includes(f));
    if (missing.length) warnings.push(`Not stated: ${missing.join(', ')}`);
  }

  if (c.quantity != null) {
    if (p.moq > c.quantity) { excluded = true; warnings.push(`MOQ ${p.moq} exceeds requested ${c.quantity}`); }
    else reasons.push(`MOQ ${p.moq} fits quantity ${c.quantity}`);
  }

  if (c.maxUnitPriceMinor != null) {
    if (p.unitPriceMinor == null || (c.currency && p.currency !== c.currency)) {
      warnings.push('Price must be confirmed with supplier');
    } else if (p.unitPriceMinor <= c.maxUnitPriceMinor) {
      score += MATCH_WEIGHTS.price; reasons.push('Within target price');
    } else {
      warnings.push('Above target price');
    }
  }

  if (p.stockStatus === 'IN_STOCK' || p.stockStatus === 'LOW_STOCK') { score += MATCH_WEIGHTS.stock; reasons.push('Supplier-confirmed stock'); }
  else if (p.stockStatus === 'MADE_TO_ORDER') { score += MATCH_WEIGHTS.stock / 2; reasons.push('Made to order'); }
  else if (p.stockStatus === 'UNVERIFIED') warnings.push('Stock not verified');

  if (c.destinationCountry && p.shipsTo.includes(c.destinationCountry)) { score += MATCH_WEIGHTS.destination; reasons.push(`Ships to ${c.destinationCountry}`); }
  if (c.supplierType && p.supplierType === c.supplierType) { score += MATCH_WEIGHTS.supplierType; reasons.push(`Supplier type: ${c.supplierType}`); }
  const vr = VERIFICATION_RANK[p.verification ?? 'UNVERIFIED'];
  if (vr >= 3) { score += MATCH_WEIGHTS.verification; reasons.push('Business verified supplier'); }
  if (p.source === 'federated') warnings.push('Listed on a remote node — data not verified by this node');

  return { id: p.id, score: Math.min(100, score), excluded, reasons, warnings };
}

export function rankCandidates(c: MatchCriteria, list: MatchCandidate[]): (MatchResult & { candidate: MatchCandidate })[] {
  return list
    .map((p) => ({ ...scoreCandidate(c, p), candidate: p }))
    .filter((r) => !r.excluded)
    .sort((a, b) => b.score - a.score || a.candidate.title.localeCompare(b.candidate.title));
}
