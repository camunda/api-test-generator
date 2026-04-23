import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 10 * 60 * 1000,
    hookTimeout: 10 * 60 * 1000,
    pool: 'forks',
  },
});
