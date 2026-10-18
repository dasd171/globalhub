import { defineConfig, devices } from '@playwright/test';
import { generateKeyPairSync } from 'node:crypto';
import { execSync } from 'node:child_process';

// Local servers must never be reached through an HTTP proxy.
for (const k of ['NO_PROXY', 'no_proxy']) process.env[k] = ['127.0.0.1', 'localhost', process.env[k]].filter(Boolean).join(',');

// Reset DBs once, in the main runner process, before webServers start.
if (!process.env.E2E_DB_RESET_DONE && !process.env.TEST_WORKER_INDEX) {
  execSync('bash tests/e2e/reset-db.sh', { stdio: 'inherit' });
  process.env.E2E_DB_RESET_DONE = '1';
}

/**
 * End-to-end tests: real API (built dist) + Next.js web on node A, plus a second API node B
 * for federation. Requires PostgreSQL + Redis (see scripts/local-services.sh) and built apps:
 *   pnpm --filter @globalhub/api build && pnpm --filter @globalhub/web build && pnpm test:e2e
 * Set CHROMIUM_PATH to use a system Chromium (e.g. on linux-arm64).
 */
const PG = process.env.E2E_PG ?? 'postgresql://postgres@127.0.0.1:5432';
/** Web port for node A (override with E2E_WEB_PORT if 3000 is taken). */
const WEB_PORT = process.env.E2E_WEB_PORT ?? '3000';
const WEB_URL = `http://127.0.0.1:${WEB_PORT}`;
const key = () => Buffer.from(generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()).toString('base64');
process.env.E2E_KEY_A ??= key();
process.env.E2E_KEY_B ??= key();
const common = { NODE_ENV: 'development', AUTH_SECRET: 'e2e-secret-0123456789abcdef', LOG_LEVEL: 'warn', RATE_LIMIT_MAX: '100000', AUTH_RATE_LIMIT_MAX: '100000', FEDERATION_ENABLED: 'true', FEDERATION_ALLOW_PRIVATE_NETWORK: 'true', NODE_PUBLIC_SCOPES: 'products,suppliers,rfq_inbox', REDIS_URL: 'redis://127.0.0.1:6379', STORAGE_LOCAL_DIR: '/tmp/globalhub-e2e-storage' };
const nodeA = { ...common, DATABASE_URL: `${PG}/globalhub_e2e_a`, API_PORT: '4000', NODE_ID: 'e2e-node-a', NODE_NAME: 'E2E Node A', NODE_PUBLIC_URL: 'http://127.0.0.1:4000', NODE_PRIVATE_KEY: process.env.E2E_KEY_A!, APP_BASE_URL: WEB_URL };
const nodeB = { ...common, DATABASE_URL: `${PG}/globalhub_e2e_b`, API_PORT: '4002', NODE_ID: 'e2e-node-b', NODE_NAME: 'E2E Node B', NODE_PUBLIC_URL: 'http://127.0.0.1:4002', NODE_PRIVATE_KEY: process.env.E2E_KEY_B!, APP_BASE_URL: 'http://127.0.0.1:3002' };

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  globalSetup: './tests/e2e/global-setup.ts',
  use: {
    baseURL: WEB_URL,
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] } : {},
  },
  webServer: [
    { command: 'node apps/api/dist/main.js', url: 'http://127.0.0.1:4000/api/v1/health/live', env: nodeA, reuseExistingServer: false, timeout: 120_000, stdout: 'pipe', stderr: 'pipe' },
    { command: 'node apps/api/dist/main.js', url: 'http://127.0.0.1:4002/api/v1/health/live', env: nodeB, reuseExistingServer: false, timeout: 120_000, stdout: 'pipe', stderr: 'pipe' },
    { command: `pnpm --filter @globalhub/web exec next start -p ${WEB_PORT} -H 127.0.0.1`, url: WEB_URL, env: { API_INTERNAL_URL: 'http://127.0.0.1:4000', NODE_ENV: 'production' }, reuseExistingServer: false, timeout: 180_000, stderr: 'pipe' },
  ],
});
