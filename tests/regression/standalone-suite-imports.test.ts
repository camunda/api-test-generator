import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

/**
 * Class-of-defect guard test.
 *
 * Tracks issues #15 (request-validation) and #16 (path-analyser): every
 * emitted `*.spec.ts` in either generator's output suite must resolve all
 * its imports within the suite's own directory tree. Imports must be either:
 *   - bare module specifiers (e.g. `@playwright/test`)
 *   - relative paths that resolve to a file under the suite's root
 *
 * Catches the original defect (specs reaching back into the generator tree
 * via `../../../../utils/http`) and any future regression of the same shape
 * in either emitter.
 */

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');

interface Suite {
  label: string;
  root: string;
}

const SUITES: readonly Suite[] = [
  {
    label: 'request-validation',
    root: path.join(REPO_ROOT, 'request-validation', 'generated'),
  },
  {
    label: 'path-analyser',
    root: path.join(REPO_ROOT, 'path-analyser', 'dist', 'generated-tests'),
  },
];

const IMPORT_RE = /^\s*import\s[^'"]*['"]([^'"]+)['"]/gm;

async function listSpecs(root: string): Promise<string[]> {
  const out: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (!dir) continue;
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile() && entry.name.endsWith('.spec.ts')) out.push(full);
    }
  }
  return out.sort();
}

describe.each(SUITES)('emitted $label specs', ({ label, root }) => {
  test(`every spec resolves all relative imports within ${label}/ suite root`, async () => {
    if (!existsSync(root)) {
      throw new Error(
        `${label} suite directory not found at ${root}. ` +
          `Run \`npm run snapshot:regenerate\` to produce it before running this test.`,
      );
    }
    const specs = await listSpecs(root);
    expect(specs.length).toBeGreaterThan(0);

    const violations: string[] = [];
    const suiteRoot = path.resolve(root);

    for (const file of specs) {
      const text = await fs.readFile(file, 'utf8');
      for (const match of text.matchAll(IMPORT_RE)) {
        const specifier = match[1];
        if (!specifier.startsWith('.') && !specifier.startsWith('/')) continue;

        const baseResolved = path.resolve(path.dirname(file), specifier);
        const candidates = [
          baseResolved,
          `${baseResolved}.ts`,
          `${baseResolved}.js`,
          path.join(baseResolved, 'index.ts'),
          path.join(baseResolved, 'index.js'),
        ];
        const resolved = candidates.find((c) => existsSync(c));

        const rel = path.relative(suiteRoot, file);
        if (!resolved) {
          violations.push(`${rel}: import "${specifier}" does not resolve to any file`);
          continue;
        }
        const relTarget = path.relative(suiteRoot, resolved);
        if (relTarget.startsWith('..') || path.isAbsolute(relTarget)) {
          violations.push(
            `${rel}: import "${specifier}" resolves outside the suite root (${relTarget})`,
          );
        }
      }
    }

    if (violations.length > 0) {
      throw new Error(
        `Found ${violations.length} import(s) escaping the suite root:\n  ${violations.join('\n  ')}`,
      );
    }
  });
});
