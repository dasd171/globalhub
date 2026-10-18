import { z } from 'zod';
import { productSchema, productUpdateSchema, productSearchQuery, storeSchema, supplierProfileSchema, businessDetailsSchema, inventoryUpdateSchema, variantSchema, paginationQuery, SUPPLIER_TYPES, LOCALE_CODES } from '@globalhub/shared';
import { catalog, fulfilment, requests, type Core } from '@globalhub/core';
import { type Api, actor, maybeActor, meta, locale } from './helpers.js';

const idParam = z.object({ id: z.string().uuid() });

export function catalogRoutes(api: Api, core: Core) {
  api.get('/categories', { schema: { tags: ['catalog'] } }, async () => catalog.listCategories(core));

  api.get('/products', { schema: { tags: ['catalog'], querystring: productSearchQuery.extend({ locale: z.enum(LOCALE_CODES).optional() }) } }, async (req) => catalog.searchProducts(core, req.query, locale(req)));
  api.get('/products/:id', { schema: { tags: ['catalog'], params: idParam } }, async (req) => catalog.getProduct(core, maybeActor(req), req.params.id, locale(req)));
  api.post('/products', { schema: { tags: ['catalog'], body: productSchema } }, async (req, reply) => reply.status(201).send(await catalog.createProduct(core, actor(req), req.body, meta(req))));
  api.patch('/products/:id', { schema: { tags: ['catalog'], params: idParam, body: productUpdateSchema } }, async (req) => catalog.updateProduct(core, actor(req), req.params.id, req.body, meta(req)));
  api.post('/products/:id/variants', { schema: { tags: ['catalog'], params: idParam, body: variantSchema } }, async (req) => catalog.addVariant(core, actor(req), req.params.id, req.body));
  api.put('/variants/:id/inventory', { schema: { tags: ['catalog'], params: idParam, body: inventoryUpdateSchema } }, async (req) => catalog.updateInventory(core, actor(req), req.params.id, req.body.onHand, req.body.source, meta(req)));
  api.post('/products/:id/request-quote', { schema: { tags: ['catalog'], params: idParam, body: z.object({ quantity: z.number().int().min(1), destinationCountry: z.string().regex(/^[A-Z]{2}$/), message: z.string().trim().min(1).max(5000), currency: z.string().regex(/^[A-Z]{3}$/).optional() }) } },
    async (req, reply) => reply.status(201).send(await requests.requestQuoteForProduct(core, actor(req), req.params.id, req.body, meta(req))));
  api.post('/products/:id/shipping-quote', { schema: { tags: ['shipping'], params: idParam, body: z.object({ quantity: z.number().int().min(1), destinationCountry: z.string().regex(/^[A-Z]{2}$/), insured: z.boolean().optional() }) } },
    async (req) => fulfilment.quoteShipping(core, { productId: req.params.id, ...req.body }));

  api.get('/seller/products', { schema: { tags: ['seller'], querystring: paginationQuery.extend({ storeId: z.string().uuid().optional() }) } }, async (req) => catalog.listMyProducts(core, actor(req), req.query));
  api.get('/seller/products/:id', { schema: { tags: ['seller'], params: idParam } }, async (req) => catalog.getProductForOwner(core, actor(req), req.params.id));
  api.get('/seller/profile', { schema: { tags: ['seller'] } }, async (req) => catalog.getMySupplierProfile(core, actor(req)));
  api.put('/seller/profile', { schema: { tags: ['seller'], body: supplierProfileSchema } }, async (req) => catalog.upsertSupplierProfile(core, actor(req), req.body));
  api.post('/seller/profile/business-details', { schema: { tags: ['seller'], body: businessDetailsSchema } }, async (req) => catalog.submitBusinessDetails(core, actor(req), req.body));

  api.post('/stores', { schema: { tags: ['stores'], body: storeSchema } }, async (req, reply) => reply.status(201).send(await catalog.createStore(core, actor(req), req.body)));
  api.patch('/stores/:id', { schema: { tags: ['stores'], params: idParam, body: storeSchema.partial() } }, async (req) => catalog.updateStore(core, actor(req), req.params.id, req.body));
  api.get('/stores/:slug', { schema: { tags: ['stores'], params: z.object({ slug: z.string().max(64) }) } }, async (req) => catalog.getStoreBySlug(core, req.params.slug));

  api.get('/suppliers', { schema: { tags: ['suppliers'], querystring: paginationQuery.extend({ verifiedOnly: z.enum(['true', 'false']).optional(), type: z.enum(SUPPLIER_TYPES).optional(), q: z.string().max(100).optional() }) } },
    async (req) => catalog.listSuppliers(core, { page: req.query.page, pageSize: req.query.pageSize, verifiedOnly: req.query.verifiedOnly === 'true', type: req.query.type, search: req.query.q }));
  api.get('/suppliers/:id', { schema: { tags: ['suppliers'], params: idParam } }, async (req) => catalog.getSupplier(core, req.params.id));
}
