import { Queue, Worker, type ConnectionOptions } from 'bullmq';
import { loadConfig, createCore, maintenanceJobs, JOB_SCHEDULE, type MaintenanceJob } from '@globalhub/core';

/**
 * Background worker. BullMQ (Redis) schedules and retries jobs; every job reads and writes
 * PostgreSQL, which stays the source of truth (Redis only holds scheduling state).
 */
async function main() {
  let config;
  try { config = loadConfig(); } catch (e) { console.error((e as Error).message); process.exit(1); }
  const core = createCore(config);
  const u = new URL(config.REDIS_URL);
  const connection: ConnectionOptions = { host: u.hostname, port: Number(u.port || 6379), password: u.password ? decodeURIComponent(u.password) : undefined, db: u.pathname.length > 1 ? Number(u.pathname.slice(1)) : 0, maxRetriesPerRequest: null };
  const queue = new Queue('globalhub-maintenance', { connection });

  for (const [name, every] of Object.entries(JOB_SCHEDULE)) {
    await queue.upsertJobScheduler(name, { every }, { name, opts: { removeOnComplete: 100, removeOnFail: 500, attempts: 3, backoff: { type: 'exponential', delay: 10_000 } } });
  }

  const worker = new Worker('globalhub-maintenance', async (job) => {
    const fn = maintenanceJobs[job.name as MaintenanceJob];
    if (!fn) throw new Error(`Unknown job ${job.name}`);
    const result = await fn(core);
    return result;
  }, { connection, concurrency: 2 });
  worker.on('completed', (job, result) => console.log(JSON.stringify({ level: 'info', job: job.name, result })));
  worker.on('failed', (job, err) => console.error(JSON.stringify({ level: 'error', job: job?.name, error: err.message })));

  const heartbeat = async () => {
    const counts = await queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
    await core.prisma.systemSetting.upsert({ where: { key: 'worker.heartbeat' }, update: { value: { at: new Date().toISOString(), queues: { maintenance: counts } } }, create: { key: 'worker.heartbeat', value: { at: new Date().toISOString(), queues: { maintenance: counts } } } });
  };
  await heartbeat();
  const hb = setInterval(() => heartbeat().catch((e) => console.error('heartbeat failed', e.message)), 60_000);
  console.log(`GlobalHub worker started (${Object.keys(JOB_SCHEDULE).length} scheduled jobs)`);

  const shutdown = async () => { clearInterval(hb); await worker.close(); await queue.close(); await core.prisma.$disconnect(); process.exit(0); };
  process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
}
main();
