import { z } from 'zod';
import { buyingRequestSchema, quoteSchema, paginationQuery, aiParseSchema, aiTranslateSchema, agentProfileSchema, agentTaskSchema, agentTaskUpdateSchema, AGENT_SERVICES, parseBuyingRequestText } from '@globalhub/shared';
import { requests, quotes, social, catalog, type Core, OpenAiCompatibleProvider } from '@globalhub/core';
import { type Api, actor, maybeActor, meta, locale } from './helpers.js';

const idParam = z.object({ id: z.string().uuid() });

export function sourcingRoutes(api: Api, core: Core) {
  api.post('/buying-requests', { schema: { tags: ['buying-requests'], body: buyingRequestSchema } }, async (req, reply) => reply.status(201).send(await requests.createBuyingRequest(core, actor(req), req.body, meta(req))));
  api.get('/buying-requests/mine', { schema: { tags: ['buying-requests'], querystring: paginationQuery } }, async (req) => requests.listMyRequests(core, actor(req), req.query));
  api.get('/buying-requests/open', { schema: { tags: ['buying-requests'], querystring: paginationQuery.extend({ q: z.string().max(100).optional(), category: z.string().max(64).optional(), destination: z.string().regex(/^[A-Z]{2}$/).optional() }) } },
    async (req) => requests.listOpenRequests(core, actor(req), req.query, locale(req)));
  api.get('/buying-requests/:id', { schema: { tags: ['buying-requests'], params: idParam } }, async (req) => requests.getBuyingRequest(core, maybeActor(req), req.params.id, locale(req)));
  api.patch('/buying-requests/:id/status', { schema: { tags: ['buying-requests'], params: idParam, body: z.object({ status: z.enum(['OPEN', 'CLOSED', 'CANCELLED']) }) } }, async (req) => requests.setRequestStatus(core, actor(req), req.params.id, req.body.status, meta(req)));
  api.get('/buying-requests/:id/matches', { schema: { tags: ['buying-requests'], params: idParam } }, async (req) => requests.matchProductsForRequest(core, actor(req), req.params.id));
  api.get('/buying-requests/:id/quotes', { schema: { tags: ['quotes'], params: idParam } }, async (req) => quotes.listQuotesForRequest(core, actor(req), req.params.id));
  api.get('/buying-requests/:id/quotes/summary', { schema: { tags: ['quotes'], params: idParam } }, async (req) => quotes.summarizeQuotes(core, actor(req), req.params.id));
  api.post('/buying-requests/:id/attachments', { schema: { tags: ['buying-requests'], params: idParam } }, async (req, reply) => {
    const file = await req.file();
    if (!file) return reply.status(400).send({ error: { code: 'BAD_REQUEST', message: 'No file' } });
    const buffer = await file.toBuffer();
    return reply.status(201).send(await requests.addRequestAttachment(core, actor(req), req.params.id, { buffer, filename: file.filename, mimeType: file.mimetype }));
  });

  api.post('/quotes', { schema: { tags: ['quotes'], body: quoteSchema } }, async (req, reply) => reply.status(201).send(await quotes.submitQuote(core, actor(req), req.body, meta(req))));
  api.get('/quotes/mine', { schema: { tags: ['quotes'] } }, async (req) => quotes.listMyQuotes(core, actor(req)));
  api.get('/quotes/received', { schema: { tags: ['quotes'] } }, async (req) => quotes.listReceivedQuotes(core, actor(req)));
  api.post('/quotes/:id/submit', { schema: { tags: ['quotes'], params: idParam } }, async (req) => quotes.submitDraftQuote(core, actor(req), req.params.id));
  api.post('/quotes/:id/accept', { schema: { tags: ['quotes'], params: idParam, body: z.object({ shippingAddressId: z.string().uuid().optional(), idempotencyKey: z.string().min(8).max(100).optional() }) } }, async (req) => quotes.acceptQuote(core, actor(req), req.params.id, req.body, meta(req)));
  api.post('/quotes/:id/reject', { schema: { tags: ['quotes'], params: idParam } }, async (req) => quotes.rejectQuote(core, actor(req), req.params.id));
  api.post('/quotes/:id/withdraw', { schema: { tags: ['quotes'], params: idParam } }, async (req) => quotes.withdrawQuote(core, actor(req), req.params.id));

  // AI assistant — advisory only, never performs transactions.
  api.get('/ai/status', { schema: { tags: ['ai'] } }, async () => ({ provider: core.ai.name, available: core.ai.available }));
  const quota = (userId: string) => { if (core.ai instanceof OpenAiCompatibleProvider) core.ai.checkQuota(userId); };
  const aiLimit = { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } };
  api.post('/ai/parse-request', { ...aiLimit, schema: { tags: ['ai'], body: aiParseSchema } }, async (req) => { const a = maybeActor(req); if (a) quota(a.id); return a ? core.ai.parseBuyingRequest(req.body.text) : parseBuyingRequestText(req.body.text); });
  api.post('/ai/translate', { ...aiLimit, schema: { tags: ['ai'], body: aiTranslateSchema } }, async (req) => { quota(actor(req).id); return core.ai.translateText(req.body.text, req.body.from, req.body.to); });
  api.post('/ai/normalize-specs', { ...aiLimit, schema: { tags: ['ai'], body: z.object({ specs: z.record(z.string().max(500)) }) } }, async (req) => { quota(actor(req).id); return core.ai.normalizeProductSpecs(req.body.specs); });
  api.post('/ai/draft-message', { ...aiLimit, schema: { tags: ['ai'], body: z.object({ productName: z.string().max(200), quantity: z.number().int().min(1), destination: z.string().max(100), questions: z.array(z.string().max(300)).max(10).default([]) }) } },
    async (req) => { quota(actor(req).id); return { draft: await core.ai.draftSupplierMessage(req.body), editable: true }; });
  /** Natural-language product finder: parse → real database query (never invented results). */
  api.post('/ai/find-products', { ...aiLimit, schema: { tags: ['ai'], body: aiParseSchema } }, async (req) => {
    const a = maybeActor(req); if (a) quota(a.id);
    const parsed = a ? await core.ai.parseBuyingRequest(req.body.text) : parseBuyingRequestText(req.body.text);
    const result = await catalog.searchProducts(core, { q: parsed.keywords.join(' ') || req.body.text, destination: parsed.destinationCountry ?? undefined, supplierType: parsed.supplierType ?? undefined, maxMoq: parsed.quantity ?? undefined, page: 1, pageSize: 20, sort: 'relevance', includeRemote: 'true' }, locale(req));
    return { parsed, ...result, postRequestSuggested: result.total === 0 };
  });

  // Sourcing agents
  api.get('/agents', { schema: { tags: ['agents'], querystring: paginationQuery.extend({ service: z.enum(AGENT_SERVICES).optional(), region: z.string().max(100).optional(), verifiedOnly: z.enum(['true', 'false']).optional() }) } },
    async (req) => social.listAgents(core, { ...req.query, verifiedOnly: req.query.verifiedOnly === 'true' }));
  api.get('/agents/me', { schema: { tags: ['agents'] } }, async (req) => social.getMyAgentProfile(core, actor(req)));
  api.put('/agents/me', { schema: { tags: ['agents'], body: agentProfileSchema } }, async (req) => social.upsertAgentProfile(core, actor(req), req.body));
  api.get('/agents/me/tasks', { schema: { tags: ['agents'] } }, async (req) => social.listAgentTasks(core, actor(req)));
  api.post('/agents/me/tasks', { schema: { tags: ['agents'], body: agentTaskSchema } }, async (req, reply) => reply.status(201).send(await social.createAgentTask(core, actor(req), req.body)));
  api.patch('/agents/me/tasks/:id', { schema: { tags: ['agents'], params: idParam, body: agentTaskUpdateSchema } }, async (req) => social.updateAgentTask(core, actor(req), req.params.id, req.body));
  api.get('/agents/:id', { schema: { tags: ['agents'], params: idParam } }, async (req) => social.getAgent(core, req.params.id));
}
