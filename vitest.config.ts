import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Spec-pin precondition: aborts the run before any test file is
    // collected if the bundled spec hash drifted from the pin. See
    // tests/regression/spec-pin.setup.ts.
    globalSetup: ['tests/regression/spec-pin.setup.ts'],
    testTimeout: 10 * 60 * 1000,
    hookTimeout: 10 * 60 * 1000,
    pool: 'forks',
  },
});
