import { describe, expect, it } from 'vitest';
import { generateDeepMissingRequired } from '../../request-validation/src/analysis/deepMissingRequired.js';
import { loadSpec } from '../../request-validation/src/spec/loader.js';

/**
 * Class-scoped regression guard for the negative coverage of nested-required
 * fields.
 *
 * Defect class: any required property nested below the request-body root must
 * be exercised by a deep missing-required negative scenario. Previously the
 * deep analyser silently emitted nothing whenever the parent object was not
 * itself required, because the baseline body it built excluded the optional
 * parent.
 *
 * If this test fails, every (operation, leaf) pair listed has at least one
 * nested-required field that no negative test exercises — i.e. the API would
 * silently accept a payload missing that field.
 */
function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

describe('request-validation: nested-required negative coverage', () => {
  it('every nested-required leaf is covered by a deep missing-required scenario', async () => {
    const m = await loadSpec(`${process.cwd()}/spec/bundled/rest-api.bundle.json`);

    // Discover every (operationId, dotted-leaf-path) pair where the leaf
    // lives strictly below the request-body root. We deliberately skip
    // top-level required props because those are owned by `missingRequired`
    // — this guard targets the *deep* analyser specifically.
    type Leaf = { op: string; target: string };
    const expected: Leaf[] = [];
    for (const op of m.operations) {
      const root: unknown = op.requestBodySchema;
      if (!isRecord(root)) continue;
      const props = root.properties;
      if (!isRecord(props)) continue;
      for (const [key, child] of Object.entries(props)) {
        collectNestedLeaves(child, [key], (path) => {
          expected.push({ op: op.operationId, target: path.join('.') });
        });
      }
    }
    expect(expected.length).toBeGreaterThan(0);

    // Build the actual deep coverage set — keyed by op + target so we are
    // sensitive to which *leaf* was exercised, not just which op.
    const deep = generateDeepMissingRequired(m.operations, { includeNested: true });
    const covered = new Set<string>(deep.map((s) => `${s.operationId}::${s.target}`));

    const uncovered = expected.filter((l) => !covered.has(`${l.op}::${l.target}`));
    expect(
      uncovered,
      `Nested-required leaves with no deep missing-required scenario:\n  - ${uncovered
        .map((l) => `${l.op} -> ${l.target}`)
        .join('\n  - ')}`,
    ).toEqual([]);
  });
});

/**
 * Walk a schema subtree and invoke `emit(path)` for every required field
 * found below the entry node (the field may itself be an object or array,
 * not necessarily a scalar leaf). `path` is the dotted address from the
 * request-body root.
 */
function collectNestedLeaves(node: unknown, path: string[], emit: (path: string[]) => void): void {
  if (!isRecord(node)) return;
  const required = Array.isArray(node.required) ? node.required : [];
  const props = isRecord(node.properties) ? node.properties : undefined;
  if (props) {
    for (const r of required) {
      if (typeof r === 'string') emit([...path, r]);
    }
    for (const [k, child] of Object.entries(props)) {
      collectNestedLeaves(child, [...path, k], emit);
    }
  }
  if (isRecord(node.items)) {
    collectNestedLeaves(node.items, [...path, '0'], emit);
  }
}
