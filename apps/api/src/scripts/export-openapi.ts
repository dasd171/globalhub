/** Writes the OpenAPI 3 spec to docs/openapi.json (no database connection needed). */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadConfig, createCore } from '@globalhub/core';
import { createPrismaClient } from '@globalhub/database';
import { buildApp } from '../app.js';

const config = loadConfig({ NODE_ENV: 'development', DATABASE_URL: 'postgresql://unused/unused', AUTH_SECRET: 'openapi-export-only-0000', LOG_LEVEL: 'silent' } as never);
const core = createCore(config, { prisma: createPrismaClient('postgresql://unused/unused'), log: { info() {}, warn() {}, error() {} } });
const app = await buildApp(core, { logger: false });
await app.ready();
const out = resolve(process.cwd(), '../../docs/openapi.json');
writeFileSync(out, JSON.stringify(app.swagger(), null, 2));
console.log(`OpenAPI written to ${out} (${Object.keys((app.swagger() as { paths: object }).paths).length} paths)`);
await app.close();
process.exit(0);
