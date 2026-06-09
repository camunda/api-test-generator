import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateAuthAbsent } from '../../request-validation/src/analysis/authAbsent.js';
import { renderScenarioForTest } from '../../request-validation/src/emit/qaEmitter.js';
import type {
  OperationModel,
  ValidationScenario,
} from '../../request-validation/src/model/types.js';
import { loadSpec } from '../../request-validation/src/spec/loader.js';

/**
 * Guards the auth-absent (HTTP 401) negative-test feature that underpins the
 * secured-profile request-validation suite (issue #346 / camunda/camunda#53708).
 *
 * Layer 1 — loader derives `conditionalAuth` from `x-enforcement: conditional`
 *           security schemes + the operation's `security` block.
 * Layer 2 — generator emits exactly one well-formed 401 scenario per
 *           conditionally-secured op and nothing for unsecured/public ops.
 * Emitter — an auth-absent scenario renders with no auth header and a 401
 *           assertion.
 */

describe('request-validation: auth-absent loader derivation (#346)', () => {
  let tmp: string;
  let specPath: string;

  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 'rv-auth-absent-'));
    specPath = join(tmp, 'spec.json');
    const spec = {
      openapi: '3.0.3',
      info: { title: 'fixture', version: '1.0.0' },
      components: {
        securitySchemes: {
          BearerAuth: {
            type: 'http',
            scheme: 'bearer',
            'x-enforcement': 'conditional',
            'x-enforcement-modes': { auth: ['secured'] },
          },
          basicAuth: {
            type: 'http',
            scheme: 'basic',
            'x-enforcement': 'conditional',
            'x-enforcement-modes': { auth: ['secured'] },
          },
          // A scheme with no conditional enforcement — must NOT flag an op.
          apiKey: { type: 'apiKey', in: 'header', name: 'X-Api-Key' },
        },
      },
      paths: {
        '/secured': {
          post: {
            operationId: 'securedOp',
            security: [{ BearerAuth: [] }, { basicAuth: [] }],
            responses: { '200': { description: 'ok' } },
          },
        },
        '/public': {
          get: {
            operationId: 'publicOp',
            // Explicit public override at runtime.
            security: [],
            responses: { '200': { description: 'ok' } },
          },
        },
        '/unconditional': {
          get: {
            operationId: 'unconditionalOp',
            // References only a non-conditional scheme.
            security: [{ apiKey: [] }],
            responses: { '200': { description: 'ok' } },
          },
        },
        '/no-security': {
          get: {
            operationId: 'noSecurityOp',
            responses: { '200': { description: 'ok' } },
          },
        },
      },
    };
    writeFileSync(specPath, JSON.stringify(spec));
  });

  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('flags only operations whose security references a conditional scheme', async () => {
    const model = await loadSpec(specPath);
    const byId = new Map(model.operations.map((o) => [o.operationId, o]));
    expect(byId.get('securedOp')?.conditionalAuth).toBe(true);
    expect(byId.get('publicOp')?.conditionalAuth).toBe(false);
    expect(byId.get('unconditionalOp')?.conditionalAuth).toBe(false);
    expect(byId.get('noSecurityOp')?.conditionalAuth).toBe(false);
  });

  it('falls back to the global security requirement when an op declares none', async () => {
    const globalSecuredPath = join(tmp, 'spec-global.json');
    writeFileSync(
      globalSecuredPath,
      JSON.stringify({
        openapi: '3.0.3',
        info: { title: 'fixture', version: '1.0.0' },
        security: [{ BearerAuth: [] }],
        components: {
          securitySchemes: {
            BearerAuth: { type: 'http', scheme: 'bearer', 'x-enforcement': 'conditional' },
          },
        },
        paths: {
          '/inherits': {
            get: { operationId: 'inheritsOp', responses: { '200': { description: 'ok' } } },
          },
          '/overrides': {
            get: {
              operationId: 'overridesOp',
              security: [],
              responses: { '200': { description: 'ok' } },
            },
          },
        },
      }),
    );
    const model = await loadSpec(globalSecuredPath);
    const byId = new Map(model.operations.map((o) => [o.operationId, o]));
    expect(byId.get('inheritsOp')?.conditionalAuth).toBe(true);
    expect(byId.get('overridesOp')?.conditionalAuth).toBe(false);
  });

  it('honours path-item-level security between operation-level and global (op ?? pathItem ?? global)', async () => {
    const pathItemPath = join(tmp, 'spec-path-item.json');
    writeFileSync(
      pathItemPath,
      JSON.stringify({
        openapi: '3.0.3',
        info: { title: 'fixture', version: '1.0.0' },
        // No global security — proves the path-item level is what flags the op.
        components: {
          securitySchemes: {
            BearerAuth: { type: 'http', scheme: 'bearer', 'x-enforcement': 'conditional' },
          },
        },
        paths: {
          // Path-item declares conditional security; the op declares none, so
          // it must inherit the path-item requirement.
          '/path-secured': {
            security: [{ BearerAuth: [] }],
            get: { operationId: 'inheritsPathOp', responses: { '200': { description: 'ok' } } },
          },
          // Path-item is conditional, but the op overrides with explicit public
          // — op-level precedence wins, so it must NOT be flagged.
          '/path-overridden': {
            security: [{ BearerAuth: [] }],
            get: {
              operationId: 'overridesPathOp',
              security: [],
              responses: { '200': { description: 'ok' } },
            },
          },
        },
      }),
    );
    const model = await loadSpec(pathItemPath);
    const byId = new Map(model.operations.map((o) => [o.operationId, o]));
    expect(byId.get('inheritsPathOp')?.conditionalAuth).toBe(true);
    expect(byId.get('overridesPathOp')?.conditionalAuth).toBe(false);
  });
});

describe('request-validation: generateAuthAbsent contract (#346)', () => {
  const ops: OperationModel[] = [
    {
      operationId: 'securedOp',
      method: 'POST',
      path: '/secured',
      tags: [],
      parameters: [],
      conditionalAuth: true,
    },
    {
      operationId: 'withPath',
      method: 'GET',
      path: '/items/{itemKey}',
      tags: [],
      parameters: [],
      conditionalAuth: true,
    },
    {
      operationId: 'publicOp',
      method: 'GET',
      path: '/public',
      tags: [],
      parameters: [],
      conditionalAuth: false,
    },
    { operationId: 'undefinedOp', method: 'GET', path: '/legacy', tags: [], parameters: [] },
  ];

  it('emits exactly one 401 scenario per conditionally-secured op and none otherwise', () => {
    const scenarios = generateAuthAbsent(ops, {});
    expect(scenarios.map((s) => s.operationId).sort()).toEqual(['securedOp', 'withPath']);
  });

  it('every emitted scenario is a well-formed unauthenticated 401 request (class-scoped)', () => {
    const scenarios = generateAuthAbsent(ops, {});
    for (const s of scenarios) {
      expect(s.type).toBe('auth-absent');
      expect(s.expectedStatus).toBe(401);
      expect(s.headersAuth).toBe(false);
      // No body is sent — auth is rejected before any body/parameter validation.
      expect(s.requestBody).toBeUndefined();
      expect(s.multipartForm).toBeUndefined();
    }
  });

  it('fills path-template tokens with dummy params so routing reaches the auth filter', () => {
    const [withPath] = generateAuthAbsent(
      ops.filter((o) => o.operationId === 'withPath'),
      {},
    );
    expect(withPath.params).toEqual({ itemKey: 'x' });
  });

  it('honours the onlyOperations filter', () => {
    const scenarios = generateAuthAbsent(ops, { onlyOperations: new Set(['securedOp']) });
    expect(scenarios.map((s) => s.operationId)).toEqual(['securedOp']);
  });
});

describe('request-validation: auth-absent emitter shape (#346)', () => {
  const scenario: ValidationScenario = {
    id: 'securedOp__auth_absent',
    operationId: 'securedOp',
    method: 'POST',
    path: '/secured',
    type: 'auth-absent',
    expectedStatus: 401,
    description: 'unauthenticated',
    headersAuth: false,
  };

  it('sends no auth header and asserts 401', () => {
    const rendered = renderScenarioForTest(scenario, 'securedOp - Missing authentication');
    // headersAuth:false => empty headers object, never jsonHeaders().
    expect(rendered).toContain('headers: {}');
    expect(rendered).not.toContain('jsonHeaders()');
    expect(rendered).toContain('assertResponseStatus(testInfo, res, 401');
    // No request body is emitted.
    expect(rendered).not.toContain('const requestBody');
  });
});
