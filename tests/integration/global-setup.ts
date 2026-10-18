import { execSync } from 'node:child_process';

export const TEST_DB_A = process.env.TEST_DATABASE_URL ?? 'postgresql://postgres@127.0.0.1:5432/globalhub_test';
export const TEST_DB_B = process.env.TEST_DATABASE_URL_B ?? 'postgresql://postgres@127.0.0.1:5432/globalhub_node_b';

export default function setup() {
  for (const url of [TEST_DB_A, TEST_DB_B]) {
    execSync('pnpm exec prisma migrate deploy', { cwd: 'packages/database', env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe' });
  }
}
