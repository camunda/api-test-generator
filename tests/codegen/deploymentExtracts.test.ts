import { describe, expect, test } from 'vitest';
import { computeDeploymentExtracts } from '../../configs/camunda-oca/codegen/playwright/roles/deploymentGateway/hook.ts';
import type { OperationNode } from '../../path-analyser/src/types.ts';

function makeOp(
  leaves: Array<{ semantic: string; fieldPath: string; status: string; provider: boolean }>,
): OperationNode {
  return {
    operationId: 'createDeployment',
    method: 'POST',
    path: '/deployments',
    requires: { required: [], optional: [] },
    produces: [],
    responseSemanticLeaves: leaves,
  };
}

describe('computeDeploymentExtracts', () => {
  test('returns [] when op is undefined', () => {
    expect(computeDeploymentExtracts(undefined)).toEqual([]);
  });

  test('returns [] when op has no responseSemanticLeaves', () => {
    const op = makeOp([]);
    expect(computeDeploymentExtracts(op)).toEqual([]);
  });

  test('keeps leaves where provider === true', () => {
    const op = makeOp([
      {
        semantic: 'ProcessDefinitionKey',
        fieldPath: 'deployments[].processDefinitionKey',
        status: '200',
        provider: true,
      },
    ]);
    const result = computeDeploymentExtracts(op);
    expect(result).toHaveLength(1);
    expect(result[0].varName).toBe('processDefinitionKeyVar');
    expect(result[0].segments).toEqual(['deployments', 0, 'processDefinitionKey']);
  });

  test('keeps top-level leaves (no . or [ in fieldPath) even when provider === false', () => {
    const op = makeOp([
      { semantic: 'DeploymentKey', fieldPath: 'deploymentKey', status: '200', provider: false },
      { semantic: 'TenantId', fieldPath: 'tenantId', status: '200', provider: false },
    ]);
    const result = computeDeploymentExtracts(op);
    expect(result.map((r) => r.varName).sort()).toEqual(['deploymentKeyVar', 'tenantIdVar'].sort());
  });

  test('skips non-top-level leaves where provider === false', () => {
    const op = makeOp([
      {
        semantic: 'ProcessDefinitionKey',
        fieldPath: 'deployments[].processDefinitionKey',
        status: '200',
        provider: false,
      },
    ]);
    expect(computeDeploymentExtracts(op)).toEqual([]);
  });

  test('skips leaves with .resource. in the fieldPath', () => {
    const op = makeOp([
      {
        semantic: 'ProcessDefinitionKey',
        fieldPath: 'deployments[].resource.processDefinitionKey',
        status: '200',
        provider: true,
      },
    ]);
    expect(computeDeploymentExtracts(op)).toEqual([]);
  });

  test('skips leaves where status !== "200"', () => {
    const op = makeOp([
      {
        semantic: 'ProcessDefinitionKey',
        fieldPath: 'deployments[].processDefinitionKey',
        status: '400',
        provider: true,
      },
    ]);
    expect(computeDeploymentExtracts(op)).toEqual([]);
  });

  test('converts [] array markers to index 0 in segments', () => {
    const op = makeOp([
      { semantic: 'Foo', fieldPath: 'items[].value', status: '200', provider: true },
    ]);
    const result = computeDeploymentExtracts(op);
    expect(result[0].segments).toEqual(['items', 0, 'value']);
  });

  test('deduplicates by varName, preferring the shorter segments path', () => {
    // Two leaves produce the same varName. The pre-dedup sort prefers
    // the shorter segments path first, so that one should be kept.
    const op = makeOp([
      {
        semantic: 'ProcessDefinitionKey',
        fieldPath: 'deployments[].processDefinitionKey',
        status: '200',
        provider: true,
      },
      {
        semantic: 'ProcessDefinitionKey',
        fieldPath: 'zzz[].processDefinitionKey',
        status: '200',
        provider: true,
      },
    ]);
    const result = computeDeploymentExtracts(op);
    expect(result).toHaveLength(1);
    // Same length → lexicographic JSON tie-break picks `deployments` < `zzz`.
    expect(result[0].segments[0]).toBe('deployments');
  });

  test('dedup prefers a strictly shorter path even when JSON.stringify ordering would invert it', () => {
    // `["a",0,"b"]` < `["a",0]` lexicographically (because `,` < `]`), so
    // an explicit length comparison is required for "shorter path wins"
    // to hold. Use leaves whose varName collides but paths differ in
    // length: provider-true ensures both survive the filter.
    const op = makeOp([
      {
        semantic: 'ProcessDefinitionKey',
        // top-level (after stripping resource. prefix is N/A here)
        fieldPath: 'a.processDefinitionKey',
        status: '200',
        provider: true,
      },
      {
        semantic: 'ProcessDefinitionKey',
        fieldPath: 'a[].deeper.processDefinitionKey',
        status: '200',
        provider: true,
      },
    ]);
    const result = computeDeploymentExtracts(op);
    expect(result).toHaveLength(1);
    // The 2-segment path must win over the 4-segment path even though
    // ["a",0,"deeper","processDefinitionKey"] < ["a","processDefinitionKey"]
    // lexicographically (because `,` < `]`).
    expect(result[0].segments).toEqual(['a', 'processDefinitionKey']);
  });

  test('final result is sorted by varName for byte-stable output', () => {
    const op = makeOp([
      { semantic: 'ZebraVar', fieldPath: 'zebraVar', status: '200', provider: false },
      { semantic: 'AlphaKey', fieldPath: 'alphaKey', status: '200', provider: false },
      { semantic: 'MidField', fieldPath: 'midField', status: '200', provider: false },
    ]);
    const result = computeDeploymentExtracts(op);
    const names = result.map((r) => r.varName);
    expect(names).toEqual([...names].sort());
  });

  test('handles op with no responseSemanticLeaves property', () => {
    const op: OperationNode = {
      operationId: 'createDeployment',
      method: 'POST',
      path: '/deployments',
      requires: { required: [], optional: [] },
      produces: [],
    };
    expect(computeDeploymentExtracts(op)).toEqual([]);
  });

  test('end-to-end: representative createDeployment leaves produce correct extracts', () => {
    const op = makeOp([
      { semantic: 'DeploymentKey', fieldPath: 'deploymentKey', status: '200', provider: false },
      { semantic: 'TenantId', fieldPath: 'tenantId', status: '200', provider: false },
      {
        semantic: 'ProcessDefinitionKey',
        fieldPath: 'deployments[].processDefinition.processDefinitionKey',
        status: '200',
        provider: true,
      },
      // .resource. path — should be skipped
      {
        semantic: 'ProcessDefinitionKey',
        fieldPath: 'deployments[].resource.processDefinitionKey',
        status: '200',
        provider: true,
      },
      // non-provider nested — should be skipped
      {
        semantic: 'InternalId',
        fieldPath: 'deployments[].internalId',
        status: '200',
        provider: false,
      },
    ]);
    const result = computeDeploymentExtracts(op);
    const varNames = result.map((r) => r.varName);
    expect(varNames).toContain('deploymentKeyVar');
    expect(varNames).toContain('tenantIdVar');
    expect(varNames).toContain('processDefinitionKeyVar');
    expect(varNames).not.toContain('internalIdVar');
    // resource. path deduplicated/skipped — only one processDefinitionKeyVar
    expect(varNames.filter((n) => n === 'processDefinitionKeyVar')).toHaveLength(1);
    // Output is sorted by varName
    expect(varNames).toEqual([...varNames].sort());
  });
});
