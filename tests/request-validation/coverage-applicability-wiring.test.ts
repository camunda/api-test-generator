import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { SCENARIO_KINDS } from '../../request-validation/src/model/types.js';

/**
 * Class-scoped regression guard: `generate.ts` computes, per operation, a
 * structural `applicable` set (via a series of `applicable.add('<kind>')`
 * calls) that COVERAGE.json's `missingApplicableKinds` is measured against.
 * It is hand-maintained in parallel with `SCENARIO_KINDS` — nothing enforces
 * the two stay in sync. A past audit found 10 kinds that were generated but
 * never wired into `applicable`, so `missingApplicableKinds` could never
 * surface a real gap for them: `generate.ts`'s backfill loop right after the
 * applicability block adds any kind that IS generated to `applicable`
 * regardless of whether an explicit rule exists, so a missing rule is
 * invisible right up until a kind that genuinely IS applicable for some
 * operation stops being generated there — i.e. exactly the real regression
 * this wiring exists to catch.
 *
 * This only catches "never wired in at all" — not "wired in with a
 * condition looser/tighter than the real generator's". That half still
 * needs a human (or the per-operation diffs this session did by hand).
 */
const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Parses the real AST (rather than regex-scanning raw source text) so a
 * commented-out `// applicable.add('kind')` line, or the string
 * `applicable.add(...)` appearing inside an unrelated string literal,
 * can't be mistaken for a live call — comments and string contents are
 * not call expressions.
 */
function findWiredKinds(sourceText: string, fileName: string): Set<string> {
  const sourceFile = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true);
  const wired = new Set<string>();
  function visit(node: ts.Node): void {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'applicable' &&
      node.expression.name.text === 'add' &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      wired.add(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return wired;
}

describe('request-validation: coverage applicability wiring', () => {
  it('every SCENARIO_KINDS entry has an applicable.add(...) call in generate.ts', () => {
    const path = join(__dirname, '../../request-validation/scripts/generate.ts');
    const src = readFileSync(path, 'utf8');
    const wired = findWiredKinds(src, path);
    const unwired = SCENARIO_KINDS.filter((kind) => !wired.has(kind));
    expect(
      unwired,
      `Scenario kinds with no applicable.add(...) rule in generate.ts (a real coverage ` +
        `gap for these kinds is invisible to COVERAGE.json's missingApplicableKinds):\n  - ${unwired.join('\n  - ')}`,
    ).toEqual([]);
  });
});
