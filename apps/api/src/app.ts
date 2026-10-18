import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { serializerCompiler, validatorCompiler, jsonSchemaTransform, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { randomUUID } from 'node:crypto';
import { ZodError } from 'zod';
import { AppError, type ApiErrorBody } from '@globalhub/shared';
import { auth, type Core, type Actor } from '@globalhub/core';
import { Prisma } from '@globalhub/database';
import { registerRoutes } from './routes/index.js';

declare module 'fastify' {
  interface FastifyRequest {
    actor: (Actor & { sessionId: string; csrfToken: string }) | null;
    authVia: 'cookie' | 'bearer' | null;
    rawBody?: string;
  }
}

export const SESSION_COOKIE = 'gh_session';
export const CSRF_COOKIE = 'gh_csrf';
export const API_PREFIX = '/api/v1';

export interface BuildOptions { logger?: boolean | object }

export async function buildApp(core: Core, opts: BuildOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger ?? { level: core.config.LOG_LEVEL, redact: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-csrf-token"]', 'res.headers["set-cookie"]'] },
    trustProxy: core.config.TRUST_PROXY,
    bodyLimit: 6 * 1024 * 1024,
    genReqId: (req) => { const h = req.headers['x-request-id']; return typeof h === 'string' && /^[\w-]{8,64}$/.test(h) ? h : randomUUID(); },
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Keep the raw body (needed for webhook + federation signature verification).
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    (req as FastifyRequest).rawBody = body as string;
    if (!body) return done(null, {});
    try { done(null, JSON.parse(body as string)); } catch { done(new AppError('BAD_REQUEST', 'Malformed JSON'), undefined); }
  });

  await app.register(helmet, {
    contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'", "'unsafe-inline'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'data:', 'https:'] } },
    hsts: core.config.isProduction ? { maxAge: 31536000, includeSubDomains: true } : false,
  });
  await app.register(cors, { origin: [core.config.APP_BASE_URL], credentials: true, methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'] });
  await app.register(cookie, { secret: core.config.AUTH_SECRET });
  await app.register(rateLimit, {
    global: true, max: core.config.RATE_LIMIT_MAX, timeWindow: '1 minute',
    keyGenerator: (req) => req.actor?.id ?? req.ip,
    errorResponseBuilder: (_req, ctx) => ({ statusCode: 429, message: `Too many requests, retry in ${Math.ceil(ctx.ttl / 1000)}s` }),
  });
  await app.register(multipart, { limits: { fileSize: core.config.UPLOAD_MAX_BYTES, files: 1, fields: 10 } });
  await app.register(swagger, {
    openapi: {
      info: { title: 'GlobalHub API', version: '1.0.0', description: 'GlobalHub — open-source global sourcing network. Versioned under /api/v1. Breaking changes ship as /api/v2.' },
      components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer' }, cookie: { type: 'apiKey', in: 'cookie', name: SESSION_COOKIE } } },
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: '/api/docs' });

  // Authentication: session cookie (browser) or Bearer token (API clients).
  app.decorateRequest('actor', null);
  app.decorateRequest('authVia', null);
  app.addHook('onRequest', async (req) => {
    const header = req.headers.authorization;
    let token: string | undefined; let via: 'cookie' | 'bearer' | null = null;
    if (header?.startsWith('Bearer ')) { token = header.slice(7).trim(); via = 'bearer'; }
    else if (req.cookies[SESSION_COOKIE]) { token = req.cookies[SESSION_COOKIE]; via = 'cookie'; }
    if (token) {
      req.actor = await auth.resolveSession(core, token);
      req.authVia = req.actor ? via : null;
    }
  });
  // CSRF: cookie-authenticated state-changing requests must echo the session's CSRF token.
  app.addHook('preHandler', async (req) => {
    if (req.authVia !== 'cookie' || ['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return;
    const sent = req.headers['x-csrf-token'];
    if (typeof sent !== 'string' || sent !== req.actor!.csrfToken) throw new AppError('FORBIDDEN', 'CSRF token missing or invalid');
  });
  app.addHook('onSend', async (req, reply) => { reply.header('x-request-id', req.id); });

  app.setErrorHandler((err: unknown, req: FastifyRequest, reply: FastifyReply) => {
    const requestId = req.id;
    const send = (status: number, body: ApiErrorBody) => reply.status(status).send(body);
    if (err instanceof AppError) return send(err.status, { error: { code: err.code, message: err.message, details: err.details, requestId } });
    if (err instanceof ZodError) return send(422, { error: { code: 'VALIDATION_FAILED', message: 'Validation failed', details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })), requestId } });
    const e = err as { validation?: unknown; statusCode?: number; code?: string; message?: string };
    if (e.validation) return send(422, { error: { code: 'VALIDATION_FAILED', message: e.message ?? 'Validation failed', details: e.validation, requestId } });
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2002') return send(409, { error: { code: 'CONFLICT', message: 'Duplicate value', requestId } });
      if (err.code === 'P2025') return send(404, { error: { code: 'NOT_FOUND', message: 'Not found', requestId } });
    }
    if (e.statusCode === 429) return send(429, { error: { code: 'RATE_LIMITED', message: e.message ?? 'Too many requests', requestId } });
    if (e.statusCode && e.statusCode >= 400 && e.statusCode < 500) return send(e.statusCode, { error: { code: 'BAD_REQUEST', message: e.message ?? 'Bad request', requestId } });
    req.log.error({ err }, 'unhandled error');
    return send(500, { error: { code: 'INTERNAL', message: 'Internal server error', requestId } });
  });
  app.setNotFoundHandler((req, reply) => reply.status(404).send({ error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.url} not found`, requestId: req.id } }));

  await app.register(async (api) => registerRoutes(api as never, core), { prefix: API_PREFIX });
  return app;
}
