import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import {
  KIND_ALIASES,
  normalizeKind,
  SCENARIO_KINDS,
} from '../../request-validation/src/model/types.js';

/**
 * COVERAGE.json counts an aliased scenario kind under another kind's name
 * (`body-top-type-mismatch` is reported as `type-mismatch`). The "present" kinds and the
 * "applicable" kinds must both be normalized, otherwise `missingApplicableKinds` lists the
 * aliased kind as missing for every operation that takes it even though its scenarios exist
 * (and the weekly hub response-coverage report then shows a gap that is not real).
 */
const __dirname = dirname(fileURLToPath(import.meta.url));

function countCalls(sourceText: string, fileName: string, callee: string): number {
  const sourceFile = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true);
  let count = 0;
  function visit(node: ts.Node): void {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === callee
    ) {
      count++;
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return count;
}

describe('request-validation: scenario kind aliases', () => {
  it('normalizes an aliased kind and leaves every other kind unchanged', () => {
    expect(normalizeKind('body-top-type-mismatch')).toBe('type-mismatch');
    expect(normalizeKind('missing-required')).toBe('missing-required');
  });

  it('only aliases real scenario kinds onto real scenario kinds', () => {
    const known = new Set<string>(SCENARIO_KINDS);
    for (const [from, to] of Object.entries(KIND_ALIASES)) {
      expect(known.has(from), `alias source ${from} is not a scenario kind`).toBe(true);
      expect(known.has(to), `alias target ${to} is not a scenario kind`).toBe(true);
    }
  });

  it('generate.ts normalizes both the present side and the applicable side', () => {
    const path = join(__dirname, '../../request-validation/scripts/generate.ts');
    const calls = countCalls(readFileSync(path, 'utf8'), path, 'normalizeKind');
    // One call for the scenarios that decide what is present, one for the applicable set.
    expect(calls).toBeGreaterThanOrEqual(2);
  });
});
