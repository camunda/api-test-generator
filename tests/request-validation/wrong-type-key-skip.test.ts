import { describe, expect, it } from 'vitest';
import { generateBodyTypeMismatch } from '../../request-validation/src/analysis/bodyTypeMismatch.js';
import type { OperationModel } from '../../request-validation/src/model/types.js';

/**
 * #427 — body wrong-type mutations on authz-resolved resource-key fields
 * (the keys of `resourceFixtures`, e.g. `projectKey`) must be skipped:
 * the server resolves the key for authorization *before* body
 * type-validation, so a wrong-type value never reaches the 400 path
 * (scalar → 403, object/array → 500, a Hub bug). Verified live: the same
 * mutation on a non-key string field correctly returns 400, so the skip
 * is scoped to the declared resource-key fields — every other field still
 * gets strict 400-expecting wrong-type coverage.
 */
describe('bodyTypeMismatch: skips authz-resolved resource-key fields (#427)', () => {
  function updateFolderOp(): OperationModel {
    return {
      operationId: 'updateFolder',
      method: 'PATCH',
      path: '/folders/{folderKey}',
      tags: [],
      requestBodySchema: {
        type: 'object',
        required: ['name', 'projectKey', 'parentFolderKey'],
        properties: {
          name: { type: 'string' },
          projectKey: { type: 'string' },
          parentFolderKey: { type: 'string' },
        },
      },
      requiredProps: ['name', 'projectKey', 'parentFolderKey'],
      parameters: [{ name: 'folderKey', in: 'path', required: true, schema: { type: 'string' } }],
    };
  }

  const targets = (scenarios: { target?: string }[]) => new Set(scenarios.map((s) => s.target));

  const sentValue = (s: { requestBody?: unknown }, field: string): unknown =>
    typeof s.requestBody === 'object' && s.requestBody !== null && field in s.requestBody
      ? Object.entries(s.requestBody).find(([k]) => k === field)?.[1]
      : undefined;

  it('emits wrong-type cases for key fields when no resourceKeyFields are configured', () => {
    const out = generateBodyTypeMismatch([updateFolderOp()], { maxPerField: 2 });
    const t = targets(out);
    expect(t.has('projectKey')).toBe(true);
    expect(t.has('parentFolderKey')).toBe(true);
    expect(t.has('name')).toBe(true);
  });

  it('skips the authz-resolved key fields but keeps non-key fields when configured', () => {
    const out = generateBodyTypeMismatch([updateFolderOp()], {
      maxPerField: 2,
      resourceKeyFields: new Set(['projectKey', 'parentFolderKey', 'folderKey', 'workspaceKey']),
    });
    const t = targets(out);
    expect(t.has('projectKey')).toBe(false);
    expect(t.has('parentFolderKey')).toBe(false);
    // name is not a resource key → still exercised with strict 400 expectation.
    expect(t.has('name')).toBe(true);
    expect(out.find((s) => s.target === 'name')?.expectedStatus).toBe(400);
  });

  it('emits only object/array values on a key field for operations that answer 400 to them', () => {
    const out = generateBodyTypeMismatch([updateFolderOp()], {
      maxPerField: 2,
      resourceKeyFields: new Set(['projectKey', 'parentFolderKey', 'folderKey', 'workspaceKey']),
      nonScalarKeyOperations: new Set(['updateFolder']),
    });
    const keyCases = out.filter((s) => s.target === 'projectKey');
    expect(keyCases).toHaveLength(2);
    const sent = keyCases.map((s) => sentValue(s, 'projectKey'));
    expect(sent).toEqual([{}, []]);
    expect(keyCases.every((s) => s.expectedStatus === 400)).toBe(true);
    // numbers and booleans on a key field stay skipped: the gate answers 403 for them by design
    expect(out.some((s) => typeof sentValue(s, 'projectKey') === 'number')).toBe(false);
    // a non-key field is unchanged
    expect(out.filter((s) => s.target === 'name').map((s) => s.expectedStatus)).toEqual([400, 400]);
  });

  it('keeps skipping key fields entirely for operations not listed', () => {
    const out = generateBodyTypeMismatch([updateFolderOp()], {
      maxPerField: 2,
      resourceKeyFields: new Set(['projectKey', 'parentFolderKey']),
      nonScalarKeyOperations: new Set(['someOtherOperation']),
    });
    expect(targets(out).has('projectKey')).toBe(false);
  });
});
