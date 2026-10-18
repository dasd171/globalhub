import { AppError, parseBuyingRequestText, formatMoney, type ParsedRequest } from '@globalhub/shared';

export interface TranslationResult { text: string; provider: string; needsReview: true; complete: boolean }
export interface QuoteForSummary { id: string; supplierName: string; currency: string; unitPriceMinor: number; moq: number; availableQty: number; productionDays?: number | null; internationalShippingMinor?: number | null; internationalShippingSource: string; validUntil: Date | string }

/**
 * Pluggable AI interface. Every output is advisory: it is shown to the user for editing and
 * never written into supplier-confirmed fields, and AI can never confirm orders or payments.
 */
export interface AiProvider {
  readonly name: string;
  readonly available: boolean;
  /** Optional translation between ISO-639-1 language codes. Without an AI provider the text is returned unchanged. */
  translateText(text: string, from: string, to: string): Promise<TranslationResult>;
  parseBuyingRequest(text: string): Promise<ParsedRequest>;
  normalizeProductSpecs(specs: Record<string, string>): Promise<Record<string, string>>;
  summarizeQuotes(quotes: QuoteForSummary[]): Promise<string>;
  draftSupplierMessage(input: { productName: string; quantity: number; destination: string; questions: string[] }): Promise<string>;
}

/** Common spec-key synonyms normalised to canonical snake_case keys. */
const SPEC_KEY_SYNONYMS: Record<string, string> = { colour: 'color', dimensions: 'size', dimension: 'size', materials: 'material', 'net weight': 'weight', wattage: 'power' };

export class RulesAiProvider implements AiProvider {
  readonly name = 'none';
  readonly available = false;
  async translateText(text: string, from: string, to: string): Promise<TranslationResult> {
    return { text, provider: this.name, needsReview: true, complete: from === to };
  }
  async parseBuyingRequest(text: string) { return parseBuyingRequestText(text); }
  async normalizeProductSpecs(specs: Record<string, string>) {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(specs)) { const key = k.trim().toLowerCase(); out[(SPEC_KEY_SYNONYMS[key] ?? key.replace(/\s+/g, '_')).slice(0, 100)] = v.trim(); }
    return out;
  }
  async summarizeQuotes(quotes: QuoteForSummary[]) {
    if (quotes.length === 0) return 'No quotes yet.';
    const byCur = new Map<string, QuoteForSummary[]>();
    quotes.forEach((q) => byCur.set(q.currency, [...(byCur.get(q.currency) ?? []), q]));
    const lines: string[] = [];
    for (const [cur, qs] of byCur) {
      const cheapest = [...qs].sort((a, b) => a.unitPriceMinor - b.unitPriceMinor)[0];
      const fastest = [...qs].filter((q) => q.productionDays != null).sort((a, b) => (a.productionDays ?? 0) - (b.productionDays ?? 0))[0];
      lines.push(`${cur}: lowest unit price ${formatMoney(cheapest.unitPriceMinor, cur)} from ${cheapest.supplierName} (MOQ ${cheapest.moq}).`);
      if (fastest) lines.push(`Fastest production: ${fastest.supplierName} (${fastest.productionDays} days).`);
    }
    const unconfirmed = quotes.filter((q) => q.internationalShippingSource === 'NOT_CONFIRMED').length;
    if (unconfirmed) lines.push(`${unconfirmed} quote(s) have international shipping not yet confirmed.`);
    if (byCur.size > 1) lines.push('Quotes use different currencies; no FX conversion applied.');
    lines.push('(Rule-based summary for reference only; supplier-entered quote data is authoritative.)');
    return lines.join('\n');
  }
  async draftSupplierMessage(i: { productName: string; quantity: number; destination: string; questions: string[] }) {
    return `Hello, we are sourcing ${i.productName} (approx. ${i.quantity} units) for delivery to ${i.destination}.\n${i.questions.map((q, n) => `${n + 1}. ${q}`).join('\n')}\nPlease share your price, MOQ, lead time and shipping details. Thank you!`;
  }
}

/**
 * OpenAI-compatible chat completions provider (OpenAI, DeepSeek, Qwen, local vLLM, ...).
 * Timeout + bounded retries + per-user daily quota; falls back to rules on failure.
 */
export class OpenAiCompatibleProvider implements AiProvider {
  readonly name = 'openai-compatible';
  readonly available = true;
  private fallback = new RulesAiProvider();
  private usage = new Map<string, number>();
  constructor(private opts: { apiKey: string; baseUrl: string; model: string; timeoutMs: number; dailyUserLimit: number; maxRetries?: number }) {}

  checkQuota(userId: string) {
    const key = `${userId}:${new Date().toISOString().slice(0, 10)}`;
    const n = (this.usage.get(key) ?? 0) + 1;
    if (n > this.opts.dailyUserLimit) throw new AppError('RATE_LIMITED', 'Daily AI assistant limit reached');
    this.usage.set(key, n);
  }

  private async chat(system: string, user: string, json = false): Promise<string> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= (this.opts.maxRetries ?? 1); attempt++) {
      try {
        const res = await fetch(`${this.opts.baseUrl.replace(/\/$/, '')}/chat/completions`, {
          method: 'POST',
          headers: { authorization: `Bearer ${this.opts.apiKey}`, 'content-type': 'application/json' },
          body: JSON.stringify({ model: this.opts.model, temperature: 0.1, max_tokens: 800, messages: [{ role: 'system', content: system }, { role: 'user', content: user.slice(0, 8000) }], ...(json ? { response_format: { type: 'json_object' } } : {}) }),
          signal: AbortSignal.timeout(this.opts.timeoutMs),
        });
        if (!res.ok) throw new Error(`AI HTTP ${res.status}`);
        const j = (await res.json()) as { choices: { message: { content: string } }[] };
        return j.choices[0]?.message?.content ?? '';
      } catch (e) { lastErr = e; }
    }
    throw lastErr;
  }

  async translateText(text: string, from: string, to: string): Promise<TranslationResult> {
    if (from === to) return { text, provider: this.name, needsReview: true, complete: true };
    try {
      const out = await this.chat(`Translate B2B sourcing text from ${from} to ${to}. Keep numbers, units, SKUs and brand names unchanged. Output only the translation.`, text);
      return { text: out.trim(), provider: this.name, needsReview: true, complete: true };
    } catch { return this.fallback.translateText(text, from, to); }
  }
  async parseBuyingRequest(text: string): Promise<ParsedRequest> {
    const base = parseBuyingRequestText(text);
    try {
      const out = JSON.parse(await this.chat('Extract a sourcing request as JSON with keys: product (string), keywords (string[]), quantity (number|null), unit, destinationCountry (ISO alpha-2|null), supplierType (MANUFACTURER|TRADING_COMPANY|DISTRIBUTOR|WHOLESALER|null), requirements (string[]). Do not invent values not present in the text.', text, true));
      return { ...base, ...Object.fromEntries(Object.entries(out).filter(([k, v]) => k in base && v !== undefined)), parsedBy: 'ai' } as ParsedRequest;
    } catch { return base; }
  }
  async normalizeProductSpecs(specs: Record<string, string>) { return this.fallback.normalizeProductSpecs(specs); }
  async summarizeQuotes(quotes: QuoteForSummary[]) {
    try {
      return (await this.chat(`Summarize differences between supplier quotes for a buyer in English. Mention price, MOQ, lead time and which costs are not yet confirmed. Never recommend accepting automatically. Max 120 words.`, JSON.stringify(quotes))).trim();
    } catch { return this.fallback.summarizeQuotes(quotes); }
  }
  async draftSupplierMessage(i: { productName: string; quantity: number; destination: string; questions: string[] }) {
    try { return (await this.chat('Write a short, polite sourcing inquiry in English. It is a draft for the user to edit.', JSON.stringify(i))).trim(); }
    catch { return this.fallback.draftSupplierMessage(i); }
  }
}
