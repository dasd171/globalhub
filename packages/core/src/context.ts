import { createPublicKey } from 'node:crypto';
import { createPrismaClient, type PrismaClient } from '@globalhub/database';
import type { RoleKey } from '@globalhub/shared';
import type { AppConfig } from './config.js';
import { MockPaymentProvider, ManualPaymentProvider, StripePaymentProvider, type PaymentProvider } from './providers/payment.js';
import { MockShippingProvider, ManualShippingProvider, type ShippingProvider } from './providers/shipping.js';
import { RulesAiProvider, OpenAiCompatibleProvider, type AiProvider } from './providers/ai.js';
import { NoEmailProvider, LogEmailProvider, ResendEmailProvider, type EmailProvider } from './providers/email.js';
import { LocalStorage, S3Storage, type StorageProvider } from './providers/storage.js';

export interface Logger { info(o: unknown, m?: string): void; warn(o: unknown, m?: string): void; error(o: unknown, m?: string): void }

export interface Core {
  prisma: PrismaClient;
  config: AppConfig;
  payment: PaymentProvider;
  shipping: ShippingProvider;
  ai: AiProvider;
  email: EmailProvider;
  storage: StorageProvider;
  nodeKey: { keyId: string; privateKeyPem: string; publicKeyPem: string } | null;
  encryptionKey: string;
  log: Logger;
}

/** Authenticated caller as seen by services. null = guest. */
export interface Actor { id: string; roles: RoleKey[]; status: string; email?: string; displayName?: string; locale?: string }
export interface RequestMeta { ip?: string; requestId?: string }

const consoleLogger: Logger = {
  info: (o, m) => console.log(m ?? '', o),
  warn: (o, m) => console.warn(m ?? '', o),
  error: (o, m) => console.error(m ?? '', o),
};

export function createCore(config: AppConfig, opts: { prisma?: PrismaClient; log?: Logger; overrides?: Partial<Core> } = {}): Core {
  const log = opts.log ?? consoleLogger;
  const payment: PaymentProvider =
    config.PAYMENT_PROVIDER === 'stripe' ? new StripePaymentProvider(config.STRIPE_SECRET_KEY ?? '', config.STRIPE_WEBHOOK_SECRET ?? '')
      : config.PAYMENT_PROVIDER === 'manual' ? new ManualPaymentProvider()
        : new MockPaymentProvider(config.MOCK_PAYMENT_WEBHOOK_SECRET);
  const shipping: ShippingProvider = config.SHIPPING_PROVIDER === 'manual' ? new ManualShippingProvider() : new MockShippingProvider();
  const ai: AiProvider = config.AI_PROVIDER === 'openai-compatible' && config.AI_API_KEY
    ? new OpenAiCompatibleProvider({ apiKey: config.AI_API_KEY, baseUrl: config.AI_BASE_URL, model: config.AI_MODEL, timeoutMs: config.AI_TIMEOUT_MS, dailyUserLimit: config.AI_DAILY_USER_LIMIT })
    : new RulesAiProvider();
  const email: EmailProvider = config.EMAIL_PROVIDER === 'resend' && config.EMAIL_API_KEY ? new ResendEmailProvider(config.EMAIL_API_KEY, config.EMAIL_FROM)
    : config.EMAIL_PROVIDER === 'log' ? new LogEmailProvider((m) => log.info({}, m)) : new NoEmailProvider();
  const storage: StorageProvider = config.STORAGE_DRIVER === 's3'
    ? new S3Storage({ endpoint: config.STORAGE_ENDPOINT, region: config.STORAGE_REGION, bucket: config.STORAGE_BUCKET ?? '', accessKeyId: config.STORAGE_ACCESS_KEY ?? '', secretAccessKey: config.STORAGE_SECRET_KEY ?? '' })
    : new LocalStorage(config.STORAGE_LOCAL_DIR);
  let nodeKey: Core['nodeKey'] = null;
  if (config.NODE_PRIVATE_KEY) {
    const pem = config.NODE_PRIVATE_KEY.includes('BEGIN') ? config.NODE_PRIVATE_KEY.replace(/\\n/g, '\n') : Buffer.from(config.NODE_PRIVATE_KEY, 'base64').toString('utf8');
    nodeKey = { keyId: config.NODE_KEY_ID, privateKeyPem: pem, publicKeyPem: createPublicKey(pem).export({ type: 'spki', format: 'pem' }).toString() };
  }
  return {
    prisma: opts.prisma ?? createPrismaClient(config.DATABASE_URL),
    config, payment, shipping, ai, email, storage, nodeKey, log,
    encryptionKey: config.APP_ENCRYPTION_KEY ?? config.AUTH_SECRET,
    ...opts.overrides,
  };
}
