import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { getPlaywrightSuiteDir } from './src/configResolver.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Per-config layout (#128 PR 2): emitted suite lives under
// generated/<config>/playwright at the repo root.
const repoRoot = resolve(__dirname, '..');

export default defineConfig({
  testDir: getPlaywrightSuiteDir(repoRoot),
  timeout: 60_000,
  use: {
    // Base APIRequestContext is provided by Playwright's test fixture
    extraHTTPHeaders: {},
  },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
});
