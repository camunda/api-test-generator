import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig({
  testDir: resolve(__dirname, 'dist/generated-tests'),
  timeout: 60_000,
  use: {
    // Base APIRequestContext is provided by Playwright's test fixture
    extraHTTPHeaders: {},
  },
  reporter: [['list']],
});
