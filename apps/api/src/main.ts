import { loadConfig, createCore, auth, federation } from '@globalhub/core';
import { buildApp } from './app.js';

async function main() {
  let config;
  try { config = loadConfig(); } catch (e) { console.error((e as Error).message); process.exit(1); }
  const core = createCore(config);
  await auth.ensureRoles(core);
  await federation.ensureLocalNode(core);
  const app = await buildApp(core);
  core.log = app.log;
  const close = async () => { await app.close(); await core.prisma.$disconnect(); process.exit(0); };
  process.on('SIGTERM', close); process.on('SIGINT', close);
  await app.listen({ port: config.API_PORT, host: config.API_HOST });
  app.log.info(`GlobalHub API on :${config.API_PORT} (payment=${core.payment.name}${core.payment.isDemo ? ' DEMO' : ''}, federation=${config.FEDERATION_ENABLED})`);
}
main();
