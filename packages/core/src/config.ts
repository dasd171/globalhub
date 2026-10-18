import { z } from 'zod';

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

export const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /** Explicit public demo mode: allows the mock payment provider outside development. */
  DEMO_MODE: bool.default('false'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://127.0.0.1:6379'),
  AUTH_SECRET: z.string().min(1),
  APP_ENCRYPTION_KEY: z.string().optional(),
  APP_BASE_URL: z.string().url().default('http://localhost:3000'),
  API_BASE_URL: z.string().url().default('http://localhost:4000'),
  API_PORT: z.coerce.number().int().default(4000),
  API_HOST: z.string().default('0.0.0.0'),
  COOKIE_SECURE: bool.optional(),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(24 * 90).default(24 * 14),
  TRUST_PROXY: bool.default('false'),

  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('./storage'),
  STORAGE_ENDPOINT: z.string().optional(),
  STORAGE_REGION: z.string().default('us-east-1'),
  STORAGE_BUCKET: z.string().optional(),
  STORAGE_ACCESS_KEY: z.string().optional(),
  STORAGE_SECRET_KEY: z.string().optional(),
  UPLOAD_MAX_BYTES: z.coerce.number().int().default(10 * 1024 * 1024),

  AI_PROVIDER: z.enum(['none', 'openai-compatible']).default('none'),
  AI_API_KEY: z.string().optional(),
  AI_BASE_URL: z.string().url().default('https://api.openai.com/v1'),
  AI_MODEL: z.string().default('gpt-4o-mini'),
  AI_TIMEOUT_MS: z.coerce.number().int().default(20_000),
  AI_DAILY_USER_LIMIT: z.coerce.number().int().default(50),

  EMAIL_PROVIDER: z.enum(['none', 'log', 'resend']).default('none'),
  EMAIL_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default('GlobalHub <no-reply@example.com>'),

  PAYMENT_PROVIDER: z.enum(['mock', 'stripe', 'manual']).default('mock'),
  MOCK_PAYMENT_WEBHOOK_SECRET: z.string().default('dev-mock-webhook-secret'),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),

  SHIPPING_PROVIDER: z.enum(['mock', 'manual']).default('mock'),

  FEDERATION_ENABLED: bool.default('false'),
  NODE_ID: z.string().regex(/^[a-z0-9][a-z0-9.-]{2,62}$/).default('local-dev-node'),
  NODE_NAME: z.string().default('GlobalHub Dev Node'),
  NODE_PUBLIC_URL: z.string().url().optional(),
  NODE_PRIVATE_KEY: z.string().optional(),
  NODE_KEY_ID: z.string().default('k1'),
  NODE_PUBLIC_SCOPES: z.string().default('products,suppliers'),
  FEDERATION_ALLOW_PRIVATE_NETWORK: bool.default('false'),
  FEDERATION_SEED_NODES: z.string().default(''),

  RATE_LIMIT_MAX: z.coerce.number().int().default(300),
  /** Per-minute limit for sensitive endpoints (login, register, password reset). */
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().default(10),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export type AppConfig = z.infer<typeof configSchema> & { isProduction: boolean; cookieSecure: boolean; publicScopes: string[]; mockPaymentsAllowed: boolean };

const WEAK = ['changeme', 'change-me', 'secret', 'password', 'dev-secret', 'dev-mock-webhook-secret', 'please-change-me'];

/** Load + validate configuration. In production, missing or weak secrets are a hard error. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = configSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid configuration:\n${issues}`);
  }
  const c = parsed.data;
  const isProduction = c.NODE_ENV === 'production';
  const problems: string[] = [];
  if (isProduction) {
    if (c.AUTH_SECRET.length < 32 || WEAK.some((w) => c.AUTH_SECRET.toLowerCase().includes(w))) problems.push('AUTH_SECRET must be a random string of at least 32 characters');
    if (!c.APP_ENCRYPTION_KEY || !/^[0-9a-f]{64}$/i.test(c.APP_ENCRYPTION_KEY)) problems.push('APP_ENCRYPTION_KEY must be 64 hex chars (openssl rand -hex 32)');
    if (/:\/\/[^:]+:(postgres|password|changeme)@/.test(c.DATABASE_URL)) problems.push('DATABASE_URL uses a default/weak password');
    if (!c.APP_BASE_URL.startsWith('https://')) problems.push('APP_BASE_URL must use https in production');
    if (c.PAYMENT_PROVIDER === 'mock' && !c.DEMO_MODE) problems.push('PAYMENT_PROVIDER=mock is not allowed in production unless DEMO_MODE=true (public demo, no real money)');
    if (c.PAYMENT_PROVIDER === 'stripe' && (!c.STRIPE_SECRET_KEY || !c.STRIPE_WEBHOOK_SECRET)) problems.push('Stripe requires STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET');
    if (c.PAYMENT_PROVIDER === 'mock' && WEAK.includes(c.MOCK_PAYMENT_WEBHOOK_SECRET)) problems.push('MOCK_PAYMENT_WEBHOOK_SECRET must be changed for a public demo');
    if (c.STORAGE_DRIVER === 's3' && (!c.STORAGE_BUCKET || !c.STORAGE_ACCESS_KEY || !c.STORAGE_SECRET_KEY)) problems.push('S3 storage requires STORAGE_BUCKET, STORAGE_ACCESS_KEY, STORAGE_SECRET_KEY');
    if (c.AI_PROVIDER !== 'none' && !c.AI_API_KEY) problems.push('AI_API_KEY required when AI_PROVIDER is set');
    if (c.EMAIL_PROVIDER === 'resend' && !c.EMAIL_API_KEY) problems.push('EMAIL_API_KEY required for EMAIL_PROVIDER=resend');
    if (c.FEDERATION_ENABLED) {
      if (!c.NODE_PUBLIC_URL?.startsWith('https://')) problems.push('NODE_PUBLIC_URL must be https when federation is enabled');
      if (!c.NODE_PRIVATE_KEY) problems.push('NODE_PRIVATE_KEY required when federation is enabled (pnpm node:keygen)');
      if (c.FEDERATION_ALLOW_PRIVATE_NETWORK) problems.push('FEDERATION_ALLOW_PRIVATE_NETWORK must be false in production');
    }
  } else if (c.AUTH_SECRET.length < 16) {
    problems.push('AUTH_SECRET must be at least 16 characters');
  }
  if (problems.length) throw new Error(`Unsafe configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  return {
    ...c,
    isProduction,
    cookieSecure: c.COOKIE_SECURE ?? isProduction,
    publicScopes: c.NODE_PUBLIC_SCOPES.split(',').map((s) => s.trim()).filter(Boolean),
    mockPaymentsAllowed: c.PAYMENT_PROVIDER === 'mock' && (!isProduction || c.DEMO_MODE),
  };
}
