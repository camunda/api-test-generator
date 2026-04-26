import { describe, expect, it } from 'vitest';
import { generateDeepMissingRequired } from '../../request-validation/src/analysis/deepMissingRequired.js';
import { generateMissingRequired } from '../../request-validation/src/analysis/missingRequired.js';
import { loadSpec } from '../../request-validation/src/spec/loader.js';

/**
 * Class-scoped regression guard for the negative coverage of nested-required
 * fields.
 *
 * Defect class: any operation whose request body contains a nested-required
 * leaf (a required property under an optional or shallowly-nested parent)
 * must produce at least one missing-required negative scenario. Previously
 * the deep analyser silently emitted nothing whenever the parent object was
 * not itself required, because the baseline body it builds excluded the
 * optional parent.
 *
 * If this test fails, every operation listed has at least one nested-required
 * field that no negative test exercises — i.e. the API would silently accept
 * a payload missing that field.
 */
function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function hasNonEmptyRequired(v: unknown): boolean {
  if (!isRecord(v)) return false;
  const req = v.required;
  return Array.isArray(req) && req.length > 0;
}

describe('request-validation: nested-required negative coverage', () => {
  it('every operation with a nested-required field emits at least one missing-required scenario', async () => {
    const m = await loadSpec(`${process.cwd()}/spec/bundled/rest-api.bundle.json`);

    // Find ops with at least one nested-required leaf below the root.
    const opsWithNestedRequired: string[] = [];
    for (const op of m.operations) {
      const root: unknown = op.requestBodySchema;
      if (!isRecord(root)) continue;
      const props = root.properties;
      if (!isRecord(props)) continue;
      for (const child of Object.values(props)) {
        if (hasNonEmptyRequired(child)) {
          opsWithNestedRequired.push(op.operationId);
          break;
        }
      }
    }

    expect(opsWithNestedRequired.length).toBeGreaterThan(0);

    // For each such op, the union of missing-required + deep-missing-required
    // scenarios must be non-empty.
    const top = generateMissingRequired(m.operations, {});
    const deep = generateDeepMissingRequired(m.operations, { includeNested: true });
    const covered = new Set<string>([...top, ...deep].map((s) => s.operationId));

    const uncovered = opsWithNestedRequired.filter((op) => !covered.has(op));
    expect(
      uncovered,
      `Operations with nested-required fields but no missing-required scenarios:\n  - ${uncovered.join('\n  - ')}`,
    ).toEqual([]);
  });
});
