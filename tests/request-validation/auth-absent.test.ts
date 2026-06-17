import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  generateAuthAbsent,
  generateAuthInvalid,
} from '../../request-validation/src/analysis/authAbsent.js';
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

  it('derives `secured` from auth-mandating effective security (every alternative names a scheme), independent of x-enforcement (#25264)', async () => {
    const model = await loadSpec(specPath);
    const byId = new Map(model.operations.map((o) => [o.operationId, o]));
    // conditional bearer/basic → secured
    expect(byId.get('securedOp')?.secured).toBe(true);
    // references a NON-conditional scheme (apiKey) → not conditionalAuth, but still secured
    expect(byId.get('unconditionalOp')?.secured).toBe(true);
    expect(byId.get('unconditionalOp')?.conditionalAuth).toBe(false);
    // explicit public override
    expect(byId.get('publicOp')?.secured).toBe(false);
    // no security declared anywhere (no global) → not secured
    expect(byId.get('noSecurityOp')?.secured).toBe(false);
  });

  it('treats an anonymous `{}` alternative in the security OR as not-secured (#391 review)', async () => {
    const optionalAuthPath = join(tmp, 'spec-optional-auth.json');
    writeFileSync(
      optionalAuthPath,
      JSON.stringify({
        openapi: '3.0.3',
        info: { title: 'fixture', version: '1.0.0' },
        components: {
          securitySchemes: { BearerAuth: { type: 'http', scheme: 'bearer' } },
        },
        paths: {
          // `{}` OR `{BearerAuth}` ⇒ anonymous is allowed ⇒ NOT secured (no 401).
          '/optional': {
            get: {
              operationId: 'optionalAuthOp',
              security: [{}, { BearerAuth: [] }],
              responses: { '200': { description: 'ok' } },
            },
          },
          // every alternative names a scheme ⇒ secured.
          '/required': {
            get: {
              operationId: 'requiredAuthOp',
              security: [{ BearerAuth: [] }],
              responses: { '200': { description: 'ok' } },
            },
          },
        },
      }),
    );
    const model = await loadSpec(optionalAuthPath);
    const byId = new Map(model.operations.map((o) => [o.operationId, o]));
    expect(byId.get('optionalAuthOp')?.secured).toBe(false);
    expect(byId.get('requiredAuthOp')?.secured).toBe(true);
  });

  it('derives `secured` via op ?? pathItem ?? global precedence, honouring `security: []` at each level (#391 review)', async () => {
    const precedencePath = join(tmp, 'spec-secured-precedence.json');
    writeFileSync(
      precedencePath,
      JSON.stringify({
        openapi: '3.0.3',
        info: { title: 'fixture', version: '1.0.0' },
        // Global default: secured. (Plain bearer, no x-enforcement — `secured`
        // is enforcement-agnostic.)
        security: [{ BearerAuth: [] }],
        components: {
          securitySchemes: { BearerAuth: { type: 'http', scheme: 'bearer' } },
        },
        paths: {
          // op + path declare nothing → inherit secured global.
          '/inherits-global': {
            get: { operationId: 'securedViaGlobal', responses: { '200': { description: 'ok' } } },
          },
          // op-level `security: []` overrides the secured global → public.
          '/op-public': {
            get: {
              operationId: 'opPublic',
              security: [],
              responses: { '200': { description: 'ok' } },
            },
          },
          // path-level `security: []` overrides the secured global (op absent) → public.
          '/path-public': {
            security: [],
            get: { operationId: 'pathPublic', responses: { '200': { description: 'ok' } } },
          },
          // op-level security takes precedence over a public path-level → secured.
          '/op-over-path': {
            security: [],
            get: {
              operationId: 'opSecuredOverPathPublic',
              security: [{ BearerAuth: [] }],
              responses: { '200': { description: 'ok' } },
            },
          },
        },
      }),
    );
    const model = await loadSpec(precedencePath);
    const byId = new Map(model.operations.map((o) => [o.operationId, o]));
    expect(byId.get('securedViaGlobal')?.secured).toBe(true);
    expect(byId.get('opPublic')?.secured).toBe(false);
    expect(byId.get('pathPublic')?.secured).toBe(false);
    expect(byId.get('opSecuredOverPathPublic')?.secured).toBe(true);
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

  it('under allSecured, targets every `secured` op (incl. non-conditional) — Hub model (#25264)', () => {
    const hubOps: OperationModel[] = [
      // conditionally secured (also secured)
      {
        operationId: 'condSecured',
        method: 'GET',
        path: '/a',
        tags: [],
        parameters: [],
        conditionalAuth: true,
        secured: true,
      },
      // secured via a plain global bearer scheme (Hub) — no x-enforcement
      {
        operationId: 'plainSecured',
        method: 'POST',
        path: '/b',
        tags: [],
        parameters: [],
        conditionalAuth: false,
        secured: true,
      },
      // explicit public
      {
        operationId: 'publicOp',
        method: 'GET',
        path: '/c',
        tags: [],
        parameters: [],
        conditionalAuth: false,
        secured: false,
      },
    ];
    // all-secured mode: both secured ops, not the public one
    expect(
      generateAuthAbsent(hubOps, { allSecured: true })
        .map((s) => s.operationId)
        .sort(),
    ).toEqual(['condSecured', 'plainSecured']);
    // default (conditional) mode: only the conditionally-secured op
    expect(generateAuthAbsent(hubOps, {}).map((s) => s.operationId)).toEqual(['condSecured']);
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

describe('request-validation: generateAuthInvalid contract + emitter (#25264)', () => {
  const ops: OperationModel[] = [
    {
      operationId: 'securedOp',
      method: 'POST',
      path: '/secured',
      tags: [],
      parameters: [],
      conditionalAuth: true,
      secured: true,
    },
    {
      operationId: 'withPath',
      method: 'GET',
      path: '/items/{itemKey}',
      tags: [],
      parameters: [],
      conditionalAuth: false,
      secured: true,
    },
    {
      operationId: 'publicOp',
      method: 'GET',
      path: '/public',
      tags: [],
      parameters: [],
      conditionalAuth: false,
      secured: false,
    },
  ];

  it('targets the same secured ops as auth-absent (well-formed 401 scenarios)', () => {
    // all-secured mode (Hub): both secured ops, not the public one.
    const scenarios = generateAuthInvalid(ops, { allSecured: true });
    expect(scenarios.map((s) => s.operationId).sort()).toEqual(['securedOp', 'withPath']);
    for (const s of scenarios) {
      expect(s.type).toBe('auth-invalid');
      expect(s.expectedStatus).toBe(401);
      expect(s.headersAuth).toBe(false);
      expect(s.requestBody).toBeUndefined();
    }
    // conditional mode (OCA default): only the conditionally-secured op.
    expect(generateAuthInvalid(ops, {}).map((s) => s.operationId)).toEqual(['securedOp']);
  });

  it('emitter sends an invalid/unknown bearer credential and asserts 401 (not jsonHeaders/denyProbe/{})', () => {
    const scenario: ValidationScenario = {
      id: 'securedOp__auth_invalid',
      operationId: 'securedOp',
      method: 'POST',
      path: '/secured',
      type: 'auth-invalid',
      expectedStatus: 401,
      description: 'invalid token',
      headersAuth: false,
    };
    const rendered = renderScenarioForTest(scenario, 'securedOp - Invalid authentication token');
    expect(rendered).toContain("Authorization: 'Bearer invalid-token'");
    expect(rendered).toContain('assertResponseStatus(testInfo, res, 401');
    expect(rendered).not.toContain('jsonHeaders()');
    expect(rendered).not.toContain('denyProbeHeaders()');
    expect(rendered).not.toContain('const requestBody');
  });
});
