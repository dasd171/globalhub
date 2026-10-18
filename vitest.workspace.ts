import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  { test: { name: 'unit', include: ['tests/unit/**/*.test.ts'], environment: 'node' } },
  {
    test: {
      name: 'integration', include: ['tests/integration/**/*.test.ts'], environment: 'node',
      pool: 'forks', poolOptions: { forks: { singleFork: true } }, fileParallelism: false,
      testTimeout: 60_000, hookTimeout: 180_000, globalSetup: ['tests/integration/global-setup.ts'],
    },
  },
]);
