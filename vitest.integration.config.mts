import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'integration',
    include: ['src/**/*.integration.test.ts'],
    setupFiles: ['./src/test/loadTestEnv.ts'],
    globalSetup: ['./src/test/globalSetup.ts'],
    fileParallelism: false,
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
