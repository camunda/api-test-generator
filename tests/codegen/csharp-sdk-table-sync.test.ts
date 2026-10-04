import { describe, expect, test } from 'vitest';
import {
  type CsharpOperationMap,
  createCsharpEmitter,
} from '../../materializer/src/csharp-sdk/emitter.js';
import type { EndpointScenarioCollection, RequestStep } from '../../path-analyser/src/types.ts';

const TABLE_SYNC_MAP: CsharpOperationMap = {
  createRole: [{ file: 'Role.cs', region: 'CreateRoleAsync' }],
  createAuthorization: [{ file: 'Authorization.cs', region: 'CreateAuthorizationAsync' }],
  evaluateDecision: [{ file: 'Decision.cs', region: 'EvaluateDecisionAsync' }],
  getTenant: [{ file: 'Tenant.cs', region: 'GetTenantAsync' }],
  getUser: [{ file: 'User.cs', region: 'GetUserAsync' }],
  getGlobalJobStatistics: [{ file: 'Job.cs', region: 'GetGlobalJobStatisticsAsync' }],
};

const CTX = {
  outDir: '/unused',
  suiteName: 'tableSync',
  mode: 'feature',
  configName: 'test',
  emitterConfig: {},
  resolveConfigPath: (rel: string) => rel,
} as const;

function singleStep(step: RequestStep): EndpointScenarioCollection {
  const ref = { operationId: step.operationId, method: step.method, path: step.pathTemplate };
  return {
    endpoint: ref,
    requiredSemanticTypes: [],
    optionalSemanticTypes: [],
    scenarios: [
      {
        id: 'sc1',
        name: 'table sync',
        description: 'table sync',
        operations: [ref],
        producedSemanticTypes: [],
        satisfiedSemanticTypes: [],
        requestPlan: [step],
      },
    ],
  };
}

async function render(step: RequestStep): Promise<string> {
  const files = await createCsharpEmitter(TABLE_SYNC_MAP).emit(singleStep(step), CTX);
  return files[0].content;
}

describe('C# emitter tables match the reflected SDK surface', () => {
  test('createRole binds the real RoleCreateRequest DTO', async () => {
    const out = await render({
      operationId: 'createRole',
      method: 'POST',
      pathTemplate: '/roles',
      bodyKind: 'json',
      bodyTemplate: { roleId: 'role-1', name: 'Role 1' },
      expect: { status: 200 },
    });
    expect(out).toContain('BuildRequest<RoleCreateRequest>(');
  });

  test('createAuthorization picks the concrete oneOf branch from the body', async () => {
    const base = {
      operationId: 'createAuthorization',
      method: 'POST',
      pathTemplate: '/authorizations',
      bodyKind: 'json',
      expect: { status: 201 },
    } as const;
    const byProperty = await render({
      ...base,
      bodyTemplate: { ownerId: 'o', resourceType: 'RESOURCE', resourcePropertyName: 'p' },
    });
    expect(byProperty).toContain('BuildRequest<AuthorizationPropertyBasedRequest>(');
    const byId = await render({
      ...base,
      bodyTemplate: { ownerId: 'o', resourceType: 'RESOURCE', resourceId: 'r' },
    });
    expect(byId).toContain('BuildRequest<AuthorizationIdBasedRequest>(');
  });

  test('evaluateDecision picks ByKey vs ById from the body', async () => {
    const base = {
      operationId: 'evaluateDecision',
      method: 'POST',
      pathTemplate: '/decision-definitions/evaluation',
      bodyKind: 'json',
      expect: { status: 200 },
    } as const;
    expect(await render({ ...base, bodyTemplate: { decisionDefinitionKey: '1' } })).toContain(
      'BuildRequest<DecisionEvaluationByKey>(',
    );
    expect(await render({ ...base, bodyTemplate: { decisionDefinitionId: 'd' } })).toContain(
      'BuildRequest<DecisionEvaluationById>(',
    );
  });

  test('tenantId and username path params are wrapped in their SDK key types', async () => {
    const tenant = await render({
      operationId: 'getTenant',
      method: 'GET',
      pathTemplate: '/tenants/{tenantId}',
      expect: { status: 200 },
    });
    expect(tenant).toContain('TenantId.AssumeExists(RequireStringBinding(ctx, "tenantIdVar"))');
    const user = await render({
      operationId: 'getUser',
      method: 'GET',
      pathTemplate: '/users/{username}',
      expect: { status: 200 },
    });
    expect(user).toContain('Username.AssumeExists(RequireStringBinding(ctx, "usernameVar"))');
  });

  test('eventually-consistent reads pass SDK consistency options', async () => {
    const user = await render({
      operationId: 'getUser',
      method: 'GET',
      pathTemplate: '/users/{username}',
      expect: { status: 200 },
    });
    expect(user).toContain('consistency: new() { WaitUpToMs = 10_000, PollIntervalMs = 500 }');
  });

  test('getGlobalJobStatistics supplies its required time window', async () => {
    const out = await render({
      operationId: 'getGlobalJobStatistics',
      method: 'GET',
      pathTemplate: '/jobs/statistics/global',
      expect: { status: 200 },
    });
    expect(out).toContain('from: DateTimeOffset.UtcNow.AddDays(-1), to: DateTimeOffset.UtcNow');
  });
});
