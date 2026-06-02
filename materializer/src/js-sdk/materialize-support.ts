/**
 * JavaScript SDK project materialization.
 *
 * Sets up scaffolding and support files needed for an emitted JavaScript test suite.
 * This includes `package.json`, `tsconfig.json`, Vitest configuration, and README.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { EmittedFile } from '@camunda8/emitter-sdk';

/**
 * Materialize JavaScript SDK support files into the output directory.
 * @param outDir Output directory to materialize into
 */
export async function materializeSdkSupport(outDir: string): Promise<void> {
  await fs.mkdir(outDir, { recursive: true });

  const scaffoldingFiles = loadJsProjectScaffoldingFiles();
  for (const file of scaffoldingFiles) {
    const filePath = path.join(outDir, file.relativePath);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, file.content, 'utf8');
  }
}

/**
 * Return the set of files to scaffold for a JS SDK test project.
 */
export function loadJsProjectScaffoldingFiles(): EmittedFile[] {
  return [
    {
      relativePath: 'package.json',
      content: JSON.stringify(
        {
          name: '@camunda8/sdk-integration-tests',
          version: '0.1.0',
          description: 'Auto-generated test suite for Camunda JavaScript SDK',
          type: 'module',
          scripts: {
            test: 'vitest run',
            'test:watch': 'vitest watch',
            'test:ui': 'vitest --ui',
          },
          devDependencies: {
            '@vitest/ui': '^1.6.0',
            typescript: '^5.3.0',
            vitest: '^1.6.0',
          },
          dependencies: {
            '@camunda8/sdk': '^8.5.0',
          },
        },
        null,
        2,
      ),
    },
    {
      relativePath: 'tsconfig.json',
      content: JSON.stringify(
        {
          compilerOptions: {
            target: 'ES2020',
            module: 'ES2020',
            lib: ['ES2020'],
            moduleResolution: 'bundler',
            strict: true,
            esModuleInterop: true,
            skipLibCheck: true,
            forceConsistentCasingInFileNames: true,
            resolveJsonModule: true,
            declaration: false,
            sourceMap: true,
            outDir: './dist',
            rootDir: './src',
          },
          include: ['src/**/*.ts'],
          exclude: ['node_modules', 'dist'],
        },
        null,
        2,
      ),
    },
    {
      relativePath: 'vitest.config.ts',
      content: `import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: [],
    reporters: ['default'],
    testTimeout: 30000,
  },
});
`,
    },
    {
      relativePath: '.env.example',
      content: `# Camunda REST API base URL
API_BASE_URL=http://localhost:8080/v2

# Optional: authentication credentials
# CAMUNDA_CLIENT_ID=
# CAMUNDA_CLIENT_SECRET=

# Optional: custom timeout for API calls
# API_TIMEOUT_MS=30000
`,
    },
    {
      relativePath: 'README.md',
      content: [
        '# Camunda JavaScript SDK Integration Tests',
        '',
        'Auto-generated test suite for the Camunda REST API using the JavaScript SDK and Vitest.',
        '',
        '## Setup',
        '',
        '### Prerequisites',
        '',
        '- Node.js >=18',
        '- A running Camunda instance (default: http://localhost:8080)',
        '',
        '### Installation',
        '',
        'Install dependencies:',
        '',
        '```bash',
        'npm install',
        '```',
        '',
        '### Configuration',
        '',
        'Copy .env.example to .env and configure:',
        '',
        '```bash',
        'cp .env.example .env',
        '```',
        '',
        'Edit .env to set:',
        '- `API_BASE_URL` — URL to your Camunda instance (default: http://localhost:8080/v2)',
        '- Authentication credentials (if required)',
        '',
        '## Running Tests',
        '',
        '### Run all tests',
        '',
        '```bash',
        'npm test',
        '```',
        '',
        '### Run tests in watch mode',
        '',
        '```bash',
        'npm run test:watch',
        '```',
        '',
        '### Run tests with UI',
        '',
        '```bash',
        'npm run test:ui',
        '```',
        '',
        '### Run a specific test file',
        '',
        '```bash',
        'npx vitest run src/listProcessInstances.feature.test.ts',
        '```',
        '',
        '## Test Structure',
        '',
        'Each test file follows this pattern:',
        '',
        '```typescript',
        "import { describe, it, expect, beforeEach } from 'vitest';",
        "import { createApiClient } from '@camunda8/sdk';",
        '',
        "describe('operationId (feature tests)', () => {",
        '  let apiClient;',
        '',
        '  beforeEach(() => {',
        '    apiClient = createApiClient({ baseUrl: process.env.API_BASE_URL });',
        '  });',
        '',
        "  it('scenario-id — scenario name', async () => {",
        '    // Setup context',
        '    const ctx = {};',
        '',
        '    // Execute operations',
        '    const response = await apiClient.listProcessInstances({ /* params */ });',
        '',
        '    // Assert',
        '    expect(response.status).toBe(200);',
        '  });',
        '});',
        '```',
        '',
        '## Context Management',
        '',
        'Tests use a `ctx` object to share state across operations:',
        '',
        '```typescript',
        '// Store values',
        "ctx['processInstanceId'] = response.data.id;",
        '',
        ' // Retrieve values in subsequent operations',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional — this is source code rendered into a README code block
        "const path = `/process-instances/${ctx['processInstanceId']}`;",
        '```',
        '',
        '## Extending Tests',
        '',
        'To add more scenarios:',
        '',
        '1. Edit the test file for the operation',
        '2. Add new `it()` blocks with test cases',
        '3. Use the same context management pattern',
        '4. Run `npm test` to validate',
        '',
        '## Troubleshooting',
        '',
        '### Connection errors',
        '',
        'Ensure:',
        '- `API_BASE_URL` in `.env` is correct',
        '- Camunda instance is running',
        '- Network connectivity from your machine to the API',
        '',
        '### Import errors',
        '',
        'Make sure:',
        '- `npm install` was run successfully',
        '- TypeScript version is ^5.3.0',
        '',
        '### Test timeouts',
        '',
        'If tests timeout:',
        '- Increase `testTimeout` in `vitest.config.ts`',
        '- Check API performance and network latency',
        '- Review `.env` timeout settings',
        '',
        '## Generated By',
        '',
        'This test suite was auto-generated by api-test-generator and uses:',
        '- [Vitest](https://vitest.dev/) — unit test framework',
        '- [Camunda JavaScript SDK](https://github.com/camunda/camunda) — REST API client',
        '- [TypeScript](https://www.typescriptlang.org/)',
      ].join('\n'),
    },
  ];
}
