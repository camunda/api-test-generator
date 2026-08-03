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
            '@vitest/ui': '^4.1.0',
            typescript: '^5.3.0',
            vitest: '^4.1.0',
          },
          dependencies: {
            '@camunda8/sdk': '^8.8.0',
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
            noEmit: true,
          },
          // Generated suites are emitted at <opId>/<opId>.<mode>.test.ts
          // (the scaffold has no src/ directory), so include every .ts in
          // the project rather than a non-existent src/ root.
          include: ['**/*.ts'],
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
      content: `# Read directly by the Camunda JavaScript SDK's zero-config Camunda8 client
# (no explicit configuration object is passed in the generated tests).

# Camunda REST API address. Defaults to http://localhost:8080 if unset.
ZEEBE_REST_ADDRESS=http://localhost:8080

# Auth strategy: NONE | BASIC | OAUTH | BEARER | COOKIE. Defaults to NONE if unset.
# CAMUNDA_AUTH_STRATEGY=NONE

# OAuth credentials (only needed when CAMUNDA_AUTH_STRATEGY=OAUTH)
# CAMUNDA_CLIENT_ID=
# CAMUNDA_CLIENT_SECRET=
# CAMUNDA_OAUTH_URL=
`,
    },
    {
      // '@camunda8/sdk' isn't installed in the emitted project until `npm
      // install` is run there (it's declared as a dependency, not vendored),
      // so without this ambient declaration every generated suite fails
      // `tsc` with TS2307 "Cannot find module". `skipLibCheck` (see
      // tsconfig.json above) keeps this shim from conflicting with the real
      // package's own types once installed.
      relativePath: 'types/camunda8-sdk.d.ts',
      content: `declare module '@camunda8/sdk' {
  /** A single point of configuration for all Camunda 8 clients; see the real SDK's docs for the full config shape. */
  export interface Camunda8ClientConfiguration {
    [key: string]: unknown;
  }

  // Response bodies are arbitrary, dynamically-shaped JSON (the emitted
  // scenarios chain deep optional/array access, e.g. \`data?.items?.[0]?.id\`),
  // so method returns are intentionally untyped here rather than \`unknown\`
  // (which rejects property/index access without narrowing).
  export type OrchestrationClusterApiClientLoose = {
    // biome-ignore lint/suspicious/noExplicitAny: dynamic REST request/response body, see comment above
    [method: string]: (...args: any[]) => Promise<any>;
  };

  export class Camunda8 {
    constructor(config?: Camunda8ClientConfiguration);
    getOrchestrationClusterApiClientLoose(): OrchestrationClusterApiClientLoose;
  }

  /** Thrown by the SDK on non-2xx responses; \`status\` carries the HTTP status code. */
  export interface HttpSdkError extends Error {
    status?: number;
  }
}
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
        '- `ZEEBE_REST_ADDRESS` — URL to your Camunda instance (default: http://localhost:8080)',
        '- `CAMUNDA_AUTH_STRATEGY` — auth strategy: NONE, BASIC, OAUTH, BEARER, or COOKIE (default: NONE)',
        '- Additional credentials if using an auth strategy other than NONE',
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
        "import { Camunda8 } from '@camunda8/sdk';",
        '',
        "describe('operationId (feature tests)', () => {",
        '  let client;',
        '',
        '  beforeEach(() => {',
        '    // Zero-config: reads ZEEBE_REST_ADDRESS / CAMUNDA_AUTH_STRATEGY from env',
        '    client = new Camunda8().getOrchestrationClusterApiClientLoose();',
        '  });',
        '',
        "  it('scenario-id — scenario name', async () => {",
        '    // Setup context',
        '    const ctx = {};',
        '',
        '    // Execute operations — the SDK returns response data directly on',
        '    // success and throws on non-2xx responses',
        '    const response = await client.listProcessInstances({ /* params */ });',
        '',
        '    // Assert',
        '    expect(response.items).toBeDefined();',
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
        '- `ZEEBE_REST_ADDRESS` in `.env` is correct',
        '- Camunda instance is running',
        '- Network connectivity from your machine to the API',
        '',
        '### Skipped tests',
        '',
        'Scenarios whose operationId has no corresponding method on the installed',
        '`@camunda8/sdk` are emitted as `it.skip(...)` with a `// SKIPPED: ...`',
        'comment explaining which method is missing, instead of code that would',
        'throw an opaque runtime error. This means the installed SDK version',
        "doesn't support that operation yet (spec/SDK version skew) — not a bug",
        'in the generated test.',
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
