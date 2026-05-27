/**
 * JavaScript SDK project materialization.
 *
 * Sets up scaffolding and support files needed for an emitted JavaScript test suite.
 * This includes package configuration, runtime helpers, and fixtures.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { EmittedFile } from '@camunda8/emitter-sdk';

/**
 * Materialize JavaScript SDK support files into the output directory.
 * Creates JavaScript-specific project structure, dependencies, and runtime helpers.
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
 * Load JavaScript project scaffolding files (package.json, tsconfig.json, README, etc.).
 * These are the foundational files needed for an independent JavaScript test project.
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
            declaration: true,
            declarationMap: true,
            sourceMap: true,
            outDir: './dist',
            rootDir: './src',
          },
          include: ['src'],
          exclude: ['node_modules', 'dist'],
        },
        null,
        2,
      ),
    },
    {
      relativePath: 'README.md',
      content: `# Camunda JavaScript SDK Tests

Auto-generated test suite for the Camunda REST API using the JavaScript SDK.

## Setup

Install dependencies:

\`\`\`bash
npm install
\`\`\`

## Running Tests

Run all tests:

\`\`\`bash
npm test
\`\`\`

Run tests in watch mode:

\`\`\`bash
npm run test:watch
\`\`\`

## Test Organization

Tests are organized by endpoint and scenario:

- \`*.feature.test.ts\` — Happy path tests for each operation
- \`*.integration.test.ts\` — Multi-step scenario tests
- \`*.variant.test.ts\` — Variant tests for optional fields and alternatives
`,
    },
    {
      relativePath: 'vitest.config.ts',
      content: `import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: [],
    hookTimeout: 30000,
    testTimeout: 30000,
  },
});
`,
    },
  ];
}
