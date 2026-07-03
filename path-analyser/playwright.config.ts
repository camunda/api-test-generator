import { defineConfig, type ReporterDescription } from '@playwright/test';
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

// JSON + JUnit reporters are added only when their PLAYWRIGHT_*_OUTPUT_FILE env
// vars are set, so callers (e.g. scripts/e2e/run-hub.sh) can capture pass/fail
// stats for the nightly summary + Slack aggregation (json) and publish results
// to TestRail (junit) without changing the default local `list` + `html`
// output. Mirrors the request-validation suite's reporting.
const reporter: ReporterDescription[] = [
  ['list'],
  ['html', { open: 'never', outputFolder: htmlOutputFolder }],
];
if (process.env.PLAYWRIGHT_JSON_OUTPUT_FILE) {
  reporter.push(['json', { outputFile: process.env.PLAYWRIGHT_JSON_OUTPUT_FILE }]);
}
if (process.env.PLAYWRIGHT_JUNIT_OUTPUT_FILE) {
  reporter.push(['junit', { outputFile: process.env.PLAYWRIGHT_JUNIT_OUTPUT_FILE }]);
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
