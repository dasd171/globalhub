import { z } from 'zod';
import { adminUserUpdateSchema, adminVerificationSchema, categorySchema, paginationQuery, connectorSchema, importPreviewSchema, ROLE_KEYS } from '@globalhub/shared';
import { admin, catalog, social, requests, integrations, maintenanceJobs, type Core, type MaintenanceJob } from '@globalhub/core';
import { type Api, actor, meta } from './helpers.js';
import { requirePermission } from '@globalhub/core';

const idParam = z.object({ id: z.string().uuid() });

export function adminRoutes(api: Api, core: Core) {
  api.get('/admin/dashboard', { schema: { tags: ['admin'] } }, async (req) => admin.adminDashboard(core, actor(req)));
  api.get('/admin/users', { schema: { tags: ['admin'], querystring: paginationQuery.extend({ q: z.string().max(100).optional(), role: z.enum(ROLE_KEYS).optional(), status: z.enum(['ACTIVE', 'DISABLED', 'DELETED']).optional() }) } }, async (req) => admin.listUsers(core, actor(req), { ...req.query, search: req.query.q }));
  api.patch('/admin/users/:id', { schema: { tags: ['admin'], params: idParam, body: adminUserUpdateSchema } }, async (req) => admin.adminUpdateUser(core, actor(req), req.params.id, req.body, meta(req)));
  api.get('/admin/suppliers', { schema: { tags: ['admin'], querystring: z.object({ status: z.string().max(40).optional() }) } }, async (req) => admin.listSuppliersForAdmin(core, actor(req), req.query.status));
  api.post('/admin/suppliers/:id/verification', { schema: { tags: ['admin'], params: idParam, body: adminVerificationSchema } }, async (req) => admin.setSupplierVerification(core, actor(req), req.params.id, req.body.status, req.body.note, meta(req)));
  api.post('/admin/agents/:id/verification', { schema: { tags: ['admin'], params: idParam, body: z.object({ status: z.enum(['UNVERIFIED', 'BUSINESS_VERIFIED', 'ADMIN_REVIEWED', 'SUSPENDED']) }) } }, async (req) => admin.setAgentVerification(core, actor(req), req.params.id, req.body.status, meta(req)));
  api.get('/admin/products', { schema: { tags: ['admin'], querystring: paginationQuery.extend({ q: z.string().max(100).optional() }) } }, async (req) => admin.adminListProducts(core, actor(req), { ...req.query, search: req.query.q }));
  api.patch('/admin/products/:id', { schema: { tags: ['admin'], params: idParam, body: z.object({ status: z.enum(['ACTIVE', 'ARCHIVED', 'DRAFT']) }) } }, async (req) => admin.adminSetProductStatus(core, actor(req), req.params.id, req.body.status, meta(req)));
  api.get('/admin/buying-requests', { schema: { tags: ['admin'] } }, async (req) => admin.adminListBuyingRequests(core, actor(req)));
  api.patch('/admin/buying-requests/:id', { schema: { tags: ['admin'], params: idParam, body: z.object({ status: z.enum(['CLOSED', 'CANCELLED']) }) } }, async (req) => requests.setRequestStatus(core, actor(req), req.params.id, req.body.status, meta(req)));
  api.post('/admin/categories', { schema: { tags: ['admin'], body: categorySchema } }, async (req) => catalog.upsertCategory(core, actor(req), req.body, meta(req)));
  api.get('/admin/reports', { schema: { tags: ['admin'], querystring: z.object({ status: z.enum(['OPEN', 'ACTIONED', 'DISMISSED']).optional() }) } }, async (req) => social.listReports(core, actor(req), req.query.status));
  api.patch('/admin/reports/:id', { schema: { tags: ['admin'], params: idParam, body: z.object({ status: z.enum(['ACTIONED', 'DISMISSED']) }) } }, async (req) => social.handleReport(core, actor(req), req.params.id, req.body.status, meta(req)));
  api.patch('/admin/reviews/:id', { schema: { tags: ['admin'], params: idParam, body: z.object({ status: z.enum(['PUBLISHED', 'HIDDEN']) }) } }, async (req) => (await import('@globalhub/core')).fulfilment.moderateReview(core, actor(req), req.params.id, req.body.status, meta(req)));
  api.get('/admin/connectors', { schema: { tags: ['admin'] } }, async (req) => admin.adminListConnectors(core, actor(req)));
  api.patch('/admin/connectors/:id', { schema: { tags: ['admin'], params: idParam, body: z.object({ status: z.enum(['ACTIVE', 'DISABLED']) }) } }, async (req) => admin.adminSetConnectorStatus(core, actor(req), req.params.id, req.body.status, meta(req)));
  api.get('/admin/audit-logs', { schema: { tags: ['admin'], querystring: paginationQuery.extend({ action: z.string().max(64).optional(), actorId: z.string().uuid().optional() }) } }, async (req) => admin.listAuditLogs(core, actor(req), req.query));
  api.get('/admin/risk-events', { schema: { tags: ['admin'] } }, async (req) => admin.listRiskEvents(core, actor(req)));
  api.get('/admin/settings', { schema: { tags: ['admin'] } }, async (req) => admin.getSettings(core, actor(req)));
  api.put('/admin/settings/:key', { schema: { tags: ['admin'], params: z.object({ key: z.string().max(64) }), body: z.object({ value: z.unknown() }) } }, async (req) => admin.setSetting(core, actor(req), req.params.key, req.body.value, meta(req)));
  api.get('/admin/system', { schema: { tags: ['admin'] } }, async (req) => { requirePermission(actor(req), 'admin:system'); return admin.systemHealth(core); });
  api.post('/admin/jobs/:job/run', { schema: { tags: ['admin'], params: z.object({ job: z.enum(Object.keys(maintenanceJobs) as [MaintenanceJob, ...MaintenanceJob[]]) }) } }, async (req) => {
    requirePermission(actor(req), 'admin:system');
    return { job: req.params.job, result: await maintenanceJobs[req.params.job](core) };
  });

  // Supplier integrations
  api.post('/imports/preview', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } }, schema: { tags: ['imports'], body: importPreviewSchema } }, async (req) => integrations.previewImport(core, actor(req), req.body, meta(req)));
  api.post('/imports/:id/commit', { schema: { tags: ['imports'], params: idParam, body: z.object({ publish: z.boolean().default(false) }) } }, async (req) => integrations.commitImport(core, actor(req), req.params.id, req.body, meta(req)));
  api.post('/imports/:id/rollback', { schema: { tags: ['imports'], params: idParam } }, async (req) => integrations.rollbackImport(core, actor(req), req.params.id, meta(req)));
  api.get('/imports', { schema: { tags: ['imports'] } }, async (req) => integrations.listImportJobs(core, actor(req)));
  api.get('/connectors', { schema: { tags: ['connectors'], querystring: z.object({ storeId: z.string().uuid().optional() }) } }, async (req) => integrations.listConnectors(core, actor(req), req.query.storeId));
  api.post('/connectors', { schema: { tags: ['connectors'], body: connectorSchema } }, async (req, reply) => reply.status(201).send(await integrations.createConnector(core, actor(req), req.body, meta(req))));
  api.post('/connectors/:id/sync-inventory', { schema: { tags: ['connectors'], params: idParam } }, async (req) => integrations.syncConnectorInventory(core, actor(req), req.params.id, meta(req)));
  api.delete('/connectors/:id', { schema: { tags: ['connectors'], params: idParam } }, async (req) => integrations.deleteConnector(core, actor(req), req.params.id));
}
