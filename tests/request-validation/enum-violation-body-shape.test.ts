import { describe, expect, it } from 'vitest';
import { generateEnumViolations } from '../../request-validation/src/analysis/enumViolations.js';
import { loadSpec } from '../../request-validation/src/spec/loader.js';

/**
 * Regression guard for the enum-violation body shape (issue #39).
 *
 * Two correctness defects were fixed in `enumViolations.ts`:
 *
 *   A. A `{ __invalidEnum, value }` sentinel object was emitted as the
 *      target field's value, instead of the invalid scalar.
 *
 *   B. Path segments naming an array index ('0') were converted into
 *      object keys, so a target like `sort.0.field` produced
 *      `{ sort: { "0": { field: ... } } }` instead of
 *      `{ sort: [ { field: ... } ] }`.
 *
 * If this test fails, generated enum-violation bodies are no longer schema-
 * shaped and will trigger 400s for the wrong reason (or none at all).
 */
describe('request-validation: enum-violation body shape', () => {
  it('emits no `__invalidEnum` marker objects in any generated body', async () => {
    const m = await loadSpec(`${process.cwd()}/spec/bundled/rest-api.bundle.json`);
    const scenarios = generateEnumViolations(m.operations, {});
    expect(scenarios.length).toBeGreaterThan(0);
    const offenders = scenarios.filter((s) =>
      JSON.stringify(s.requestBody ?? null).includes('__invalidEnum'),
    );
    expect(offenders, `Found ${offenders.length} scenarios still emitting marker objects`).toEqual(
      [],
    );
  });

  it('shapes array-index path segments as arrays, not numeric-keyed objects', async () => {
    const m = await loadSpec(`${process.cwd()}/spec/bundled/rest-api.bundle.json`);
    const scenarios = generateEnumViolations(m.operations, {});
    // Find scenarios whose target traverses an array index (e.g. `sort.0.field`).
    const arrayIndexScenarios = scenarios.filter((s) => /\.\d+\./.test(s.target ?? ''));
    expect(
      arrayIndexScenarios.length,
      'Spec is expected to expose at least one enum leaf nested under an array (e.g. searchAuditLogs.sort.0.field)',
    ).toBeGreaterThan(0);

    const offenders: { id: string; target: string; body: unknown }[] = [];
    for (const s of arrayIndexScenarios) {
      const segments = (s.target ?? '').split('.');
      let cur: unknown = s.requestBody;
      for (const seg of segments) {
        if (/^\d+$/.test(seg)) {
          if (!Array.isArray(cur)) {
            offenders.push({ id: s.id, target: s.target ?? '', body: s.requestBody });
            break;
          }
          cur = cur[Number(seg)];
        } else if (cur && typeof cur === 'object' && !Array.isArray(cur)) {
          // biome-ignore lint/plugin: walking an unknown JSON tree by key; runtime check above narrows shape.
          cur = (cur as Record<string, unknown>)[seg];
        } else {
          offenders.push({ id: s.id, target: s.target ?? '', body: s.requestBody });
          break;
        }
      }
    }
    expect(
      offenders,
      `Found ${offenders.length} scenarios where a numeric path segment landed on a non-array container`,
    ).toEqual([]);
  });
});
