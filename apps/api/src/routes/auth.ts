import { z } from 'zod';
import { registerSchema, loginSchema, forgotPasswordSchema, resetPasswordSchema, verifyEmailSchema, changePasswordSchema, updateMeSchema, addressSchema } from '@globalhub/shared';
import { auth, social, notifications, type Core } from '@globalhub/core';
import { type Api, actor, meta } from './helpers.js';
import { SESSION_COOKIE, CSRF_COOKIE } from '../app.js';

export function authRoutes(api: Api, core: Core) {
  const strict = { config: { rateLimit: { max: core.config.AUTH_RATE_LIMIT_MAX, timeWindow: '1 minute' } } };
  const cookieOpts = { httpOnly: true, sameSite: 'lax' as const, secure: core.config.cookieSecure, path: '/' };

  api.post('/auth/register', { ...strict, schema: { tags: ['auth'], body: registerSchema } }, async (req, reply) => reply.status(201).send(await auth.register(core, req.body, meta(req))));
  api.post('/auth/login', { ...strict, schema: { tags: ['auth'], body: loginSchema } }, async (req, reply) => {
    const r = await auth.login(core, req.body.email, req.body.password, { ...meta(req), userAgent: req.headers['user-agent'] });
    reply.setCookie(SESSION_COOKIE, r.token, { ...cookieOpts, maxAge: r.expiresInSeconds });
    reply.setCookie(CSRF_COOKIE, r.csrfToken, { ...cookieOpts, httpOnly: false, maxAge: r.expiresInSeconds });
    // token is returned for API clients using Bearer auth; browsers rely on the httpOnly cookie.
    return { user: r.user, csrfToken: r.csrfToken, token: r.token, expiresInSeconds: r.expiresInSeconds };
  });
  api.post('/auth/logout', { schema: { tags: ['auth'] } }, async (req, reply) => {
    if (req.actor) await auth.logout(core, req.actor.sessionId);
    reply.clearCookie(SESSION_COOKIE, { path: '/' }).clearCookie(CSRF_COOKIE, { path: '/' });
    return { ok: true };
  });
  api.post('/auth/verify-email', { ...strict, schema: { tags: ['auth'], body: verifyEmailSchema } }, async (req) => auth.verifyEmail(core, req.body.token));
  api.post('/auth/forgot-password', { ...strict, schema: { tags: ['auth'], body: forgotPasswordSchema } }, async (req) => auth.forgotPassword(core, req.body.email));
  api.post('/auth/reset-password', { ...strict, schema: { tags: ['auth'], body: resetPasswordSchema } }, async (req) => auth.resetPassword(core, req.body.token, req.body.password, meta(req)));
  api.post('/auth/change-password', { ...strict, schema: { tags: ['auth'], body: changePasswordSchema } }, async (req) => auth.changePassword(core, actor(req), req.body.currentPassword, req.body.newPassword, req.actor!.sessionId));

  api.get('/users/me', { schema: { tags: ['users'] } }, async (req) => {
    const a = actor(req);
    const u = await core.prisma.user.findUniqueOrThrow({ where: { id: a.id }, include: { supplierProfile: { include: { stores: true } }, agentProfile: true, buyerProfile: true } });
    return { ...auth.publicUser(u, a.roles), supplierProfile: u.supplierProfile, agentProfile: u.agentProfile, buyerProfile: u.buyerProfile, csrfToken: req.actor!.csrfToken };
  });
  api.patch('/users/me', { schema: { tags: ['users'], body: updateMeSchema } }, async (req) => {
    const a = actor(req);
    const u = await core.prisma.user.update({ where: { id: a.id }, data: req.body });
    return auth.publicUser(u, a.roles);
  });
  api.get('/users/me/export', { schema: { tags: ['users'] } }, async (req) => auth.exportMyData(core, actor(req)));
  api.post('/users/me/delete', { ...strict, schema: { tags: ['users'], body: z.object({ password: z.string().min(1) }) } }, async (req, reply) => {
    const r = await auth.deleteMyAccount(core, actor(req), req.body.password, meta(req));
    reply.clearCookie(SESSION_COOKIE, { path: '/' }).clearCookie(CSRF_COOKIE, { path: '/' });
    return r;
  });
  api.post('/users/:id/block', { schema: { tags: ['users'], params: z.object({ id: z.string().uuid() }) } }, async (req) => social.blockUser(core, actor(req), req.params.id));
  api.delete('/users/:id/block', { schema: { tags: ['users'], params: z.object({ id: z.string().uuid() }) } }, async (req) => social.unblockUser(core, actor(req), req.params.id));

  api.get('/users/me/addresses', { schema: { tags: ['users'] } }, async (req) => social.listAddresses(core, actor(req)));
  api.post('/users/me/addresses', { schema: { tags: ['users'], body: addressSchema } }, async (req, reply) => reply.status(201).send(await social.createAddress(core, actor(req), req.body)));
  api.delete('/users/me/addresses/:id', { schema: { tags: ['users'], params: z.object({ id: z.string().uuid() }) } }, async (req) => social.deleteAddress(core, actor(req), req.params.id));

  api.get('/users/me/favorites', { schema: { tags: ['users'] } }, async (req) => social.listFavorites(core, actor(req)));
  api.post('/users/me/favorites', { schema: { tags: ['users'], body: z.object({ productId: z.string().uuid().optional(), supplierId: z.string().uuid().optional() }) } }, async (req) => social.toggleFavorite(core, actor(req), req.body));
  api.get('/users/me/sourcing-list', { schema: { tags: ['users'] } }, async (req) => social.getSourcingList(core, actor(req)));
  api.post('/users/me/sourcing-list', { schema: { tags: ['users'], body: z.object({ productId: z.string().uuid(), quantity: z.number().int().min(1).default(1), note: z.string().max(1000).optional() }) } }, async (req) => social.addToSourcingList(core, actor(req), req.body.productId, req.body.quantity, req.body.note));
  api.delete('/users/me/sourcing-list/:productId', { schema: { tags: ['users'], params: z.object({ productId: z.string().uuid() }) } }, async (req) => social.removeFromSourcingList(core, actor(req), req.params.productId));

  api.get('/notifications', { schema: { tags: ['notifications'], querystring: z.object({ unread: z.enum(['true', 'false']).optional() }) } }, async (req) => notifications.listNotifications(core, actor(req).id, req.query.unread === 'true'));
  api.post('/notifications/read', { schema: { tags: ['notifications'], body: z.object({ ids: z.array(z.string().uuid()).max(200).optional() }) } }, async (req) => notifications.markNotificationsRead(core, actor(req).id, req.body.ids));
}
