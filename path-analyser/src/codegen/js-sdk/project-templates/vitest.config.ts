import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['**/*.test.ts'],
    // Each test file gets its own suite run sequentially — the generated
    // tests mutate live cluster state and are order-sensitive within a
    // file. Cross-file parallelism is safe.
    pool: 'forks',
    testTimeout: 60_000,
    hookTimeout: 30_000,
  },
});
