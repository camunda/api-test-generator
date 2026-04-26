import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

/**
 * Class-of-defect guard test.
 *
 * Tracks issue #15: every emitted `*.spec.ts` in the request-validation
 * suite must resolve all its imports within the suite's own directory tree.
 * Imports must be either:
 *   - bare module specifiers (e.g. `@playwright/test`)
 *   - relative paths that resolve to a file under `request-validation/generated/`
 *
 * Catches the original defect (specs reaching back into the QA tree via
 * `../../../../utils/http`) and any future regression of the same shape
 * (e.g. someone reintroducing a hard-coded `../src/...` path).
 */

const GENERATED_DIR = path.resolve(
  import.meta.dirname,
  '..',
  '..',
  'request-validation',
  'generated',
);

const IMPORT_RE = /^\s*import\s[^'"]*['"]([^'"]+)['"]/gm;

describe('emitted request-validation specs', () => {
  test('every spec resolves all relative imports within request-validation/generated/', async () => {
    if (!existsSync(GENERATED_DIR)) {
      throw new Error(
        `request-validation/generated/ not found. Run \`npm run snapshot:regenerate\` to produce it before running this test.`,
      );
    }
    const entries = await fs.readdir(GENERATED_DIR);
    const specs = entries.filter((n) => n.endsWith('.spec.ts'));
    expect(specs.length).toBeGreaterThan(0);

    const violations: string[] = [];
    const suiteRoot = path.resolve(GENERATED_DIR);

    for (const spec of specs) {
      const file = path.join(GENERATED_DIR, spec);
      const text = await fs.readFile(file, 'utf8');
      for (const match of text.matchAll(IMPORT_RE)) {
        const specifier = match[1];
        // Bare module specifiers (e.g. @playwright/test) are fine — they're
        // resolved by node_modules, not the filesystem layout of the suite.
        if (!specifier.startsWith('.') && !specifier.startsWith('/')) continue;

        // Resolve the relative path against the spec's directory and verify
        // it lands inside the suite root. Try common extensions because
        // import specifiers may omit them.
        const baseResolved = path.resolve(path.dirname(file), specifier);
        const candidates = [
          baseResolved,
          `${baseResolved}.ts`,
          `${baseResolved}.js`,
          path.join(baseResolved, 'index.ts'),
          path.join(baseResolved, 'index.js'),
        ];
        const resolved = candidates.find((c) => existsSync(c));

        if (!resolved) {
          violations.push(`${spec}: import "${specifier}" does not resolve to any file`);
          continue;
        }
        const rel = path.relative(suiteRoot, resolved);
        if (rel.startsWith('..') || path.isAbsolute(rel)) {
          violations.push(
            `${spec}: import "${specifier}" resolves outside the suite root (${rel})`,
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
