import { defineConfig } from '@playwright/test';
import type { ReporterDescription } from '@playwright/test';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { getPlaywrightSuiteDir } from './src/configResolver.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Per-config layout (#128 PR 2): emitted suite lives under
// generated/<config>/playwright at the repo root.
const repoRoot = resolve(__dirname, '..');

// outputFolder honours PLAYWRIGHT_HTML_REPORT so callers (e.g. scripts/e2e/run-hub.sh)
// can redirect the report to a per-config location; defaults to playwright-report/.
const htmlOutputFolder = process.env.PLAYWRIGHT_HTML_REPORT ?? 'playwright-report';

// Mirror the request-validation config: emit a machine-readable JSON report
// when PLAYWRIGHT_JSON_OUTPUT_FILE is set, so callers (scripts/e2e/run-hub.sh)
// can feed per-test results to the positive curl-compare oracle. Unset (the
// default, e.g. `test:pw:path-analyser`) → list + html only, unchanged.
const reporter: ReporterDescription[] = [
  ['list'],
  ['html', { open: 'never', outputFolder: htmlOutputFolder }],
];
if (process.env.PLAYWRIGHT_JSON_OUTPUT_FILE) {
  reporter.push(['json', { outputFile: process.env.PLAYWRIGHT_JSON_OUTPUT_FILE }]);
}

export default defineConfig({
  testDir: getPlaywrightSuiteDir(repoRoot),
  timeout: 60_000,
  use: {
    // Base APIRequestContext is provided by Playwright's test fixture
    extraHTTPHeaders: {},
  },
  reporter,
});
