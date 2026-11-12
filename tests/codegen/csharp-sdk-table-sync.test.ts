import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import {
  CSHARP_ONEOF_REQUEST_TYPES,
  CSHARP_PATH_PARAM_KEY_TYPE,
  CSHARP_REQUEST_TYPE_BY_OPERATION,
  CSHARP_TIME_WINDOW_ARGS,
  type CsharpOperationMap,
  createCsharpEmitter,
  type SdkDerivedType,
  type SdkMethodDescription,
  type SdkMethodManifest,
  type SdkMethodParameter,
} from '../../materializer/src/csharp-sdk/emitter.js';
import type { EndpointScenarioCollection, RequestStep } from '../../path-analyser/src/types.ts';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function loadJson(path: URL): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function loadManifest(): SdkMethodManifest {
  const value = loadJson(
    new URL('../../csharp-sdk/examples/sdk-client-methods.json', import.meta.url),
  );
  if (
    !isRecord(value) ||
    typeof value.sdkVersion !== 'string' ||
    !Array.isArray(value.methods) ||
    !Array.isArray(value.derivedTypes)
  ) {
    throw new Error('Invalid SDK method manifest fixture');
  }
  const methods: unknown[] = value.methods;
  const derivedTypes: unknown[] = value.derivedTypes;
  const isParameter = (parameter: unknown): parameter is SdkMethodParameter =>
    isRecord(parameter) &&
    typeof parameter.name === 'string' &&
    typeof parameter.type === 'string' &&
    typeof parameter.optional === 'boolean';
  const isMethod = (method: unknown): method is SdkMethodDescription =>
    isRecord(method) &&
    typeof method.name === 'string' &&
    typeof method.returnType === 'string' &&
    Array.isArray(method.parameters) &&
    method.parameters.every(isParameter);
  const isDerivedType = (derivedType: unknown): derivedType is SdkDerivedType =>
    isRecord(derivedType) &&
    typeof derivedType.name === 'string' &&
    typeof derivedType.baseType === 'string';
  if (!methods.every(isMethod) || !derivedTypes.every(isDerivedType)) {
    throw new Error('Invalid SDK method manifest entries');
  }
  return {
    sdkVersion: value.sdkVersion,
    methods: methods.filter(isMethod),
    derivedTypes: derivedTypes.filter(isDerivedType),
  };
}

function loadOperationMap(): CsharpOperationMap {
  const value = loadJson(new URL('../../csharp-sdk/examples/operation-map.json', import.meta.url));
  if (!isRecord(value)) throw new Error('Invalid C# operation map fixture');
  const map: CsharpOperationMap = {};
  for (const [operationId, entries] of Object.entries(value)) {
    if (!Array.isArray(entries)) throw new Error(`Invalid operation map entry for ${operationId}`);
    map[operationId] = entries.filter(
      (entry): entry is { file: string; region: string; label?: string } =>
        isRecord(entry) && typeof entry.file === 'string' && typeof entry.region === 'string',
    );
  }
  return map;
}

const SDK_TYPE_PREFIX = 'Camunda.Orchestration.Sdk.';
const SDK_MANIFEST = loadManifest();
const SDK_OPERATION_MAP = loadOperationMap();

function findMethod(operationId: string) {
  const entry = SDK_OPERATION_MAP[operationId]?.[0];
  if (entry === undefined) throw new Error(`Missing operation-map entry for ${operationId}`);
  const method = SDK_MANIFEST.methods.find((candidate) => candidate.name === entry.region);
  if (method === undefined)
    throw new Error(`Missing SDK method ${entry.region} for ${operationId}`);
  return method;
}

function bodyParameter(operationId: string) {
  const method = findMethod(operationId);
  const parameter = method.parameters.find((candidate) => candidate.name === 'body');
  if (parameter === undefined) throw new Error(`Missing body parameter for ${operationId}`);
  return parameter;
}

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

  describe('reflected SDK manifest checks', () => {
    test('request DTO mappings match SDK body parameter types', () => {
      for (const [operationId, type] of Object.entries(CSHARP_REQUEST_TYPE_BY_OPERATION)) {
        if (operationId === 'createDeployment') continue;
        expect(bodyParameter(operationId).type, operationId).toBe(`${SDK_TYPE_PREFIX}${type}`);
      }
    });

    test('oneOf request types derive from the SDK body parameter type', () => {
      const derived = new Map(
        SDK_MANIFEST.derivedTypes.map((entry) => [entry.name, entry.baseType]),
      );
      for (const [operationId, types] of Object.entries(CSHARP_ONEOF_REQUEST_TYPES)) {
        const bodyType = bodyParameter(operationId).type;
        for (const type of types) {
          let current = `${SDK_TYPE_PREFIX}${type}`;
          const seen = new Set<string>();
          while (current !== bodyType && !seen.has(current)) {
            seen.add(current);
            current = derived.get(current) ?? '';
          }
          expect(current, `${operationId}: ${type}`).toBe(bodyType);
        }
      }
    });

    test('time-window arguments are required DateTimeOffset parameters', () => {
      for (const [methodName, argumentsText] of Object.entries(CSHARP_TIME_WINDOW_ARGS)) {
        const method = SDK_MANIFEST.methods.find((candidate) => candidate.name === methodName);
        expect(method, methodName).toBeDefined();
        for (const argument of argumentsText.split(', ')) {
          const name = argument.split(':')[0];
          const parameter = method?.parameters.find((candidate) => candidate.name === name);
          expect(parameter, `${methodName}: ${name}`).toMatchObject({
            type: 'System.DateTimeOffset',
            optional: false,
          });
        }
      }
    });

    test('path parameter key types exist in the SDK', () => {
      const sdkTypes = new Set([
        ...SDK_MANIFEST.methods.flatMap((method) =>
          method.parameters.map((parameter) => parameter.type),
        ),
        ...SDK_MANIFEST.derivedTypes.flatMap((entry) => [entry.name, entry.baseType]),
      ]);
      for (const type of Object.values(CSHARP_PATH_PARAM_KEY_TYPE)) {
        expect(sdkTypes.has(`${SDK_TYPE_PREFIX}${type}`), type).toBe(true);
      }
    });

    test('operation-map regions name reflected SDK methods', () => {
      for (const [operationId, entries] of Object.entries(SDK_OPERATION_MAP)) {
        for (const entry of entries) {
          expect(
            SDK_MANIFEST.methods.some((method) => method.name === entry.region),
            `${operationId}: ${entry.region}`,
          ).toBe(true);
        }
      }
    });
  });
});
