import { describe, expect, test } from 'vitest';
import {
  createJsSdkEmitter,
  jsSuiteFileName,
  renderJsSuite,
} from '../../materializer/src/js-sdk/emitter.js';
import { loadJsProjectScaffoldingFiles } from '../../materializer/src/js-sdk/materialize-support.js';
import { renderJavaScriptBody } from '../../materializer/src/js-sdk/sdk-mapping.js';
import type {
  EndpointScenarioCollection,
  GlobalContextSeed,
  RequestStep,
} from '../../path-analyser/src/types.ts';

// Mirrors the production entry in configs/camunda-oca/ontology/global-context-seeds.json.
const TENANT_SEED_OMIT: GlobalContextSeed = {
  binding: 'tenantIdVar',
  fieldName: 'tenantId',
  seedRule: 'tenantIdVar',
  omitWhenUnbound: true,
};

const SAMPLE_COLLECTION: EndpointScenarioCollection = {
  endpoint: { operationId: 'getUser', method: 'GET', path: '/users/{widgetId}' },
  requiredSemanticTypes: [],
  optionalSemanticTypes: [],
  scenarios: [
    {
      id: 'sc1',
      name: 'happy path',
      description: 'Fetch a user by widget id',
      operations: [{ operationId: 'getUser', method: 'GET', path: '/users/{widgetId}' }],
      producedSemanticTypes: [],
      satisfiedSemanticTypes: [],
      requestPlan: [
        {
          operationId: 'getUser',
          method: 'GET',
          pathTemplate: '/users/{widgetId}',
          expect: { status: 200 },
          extract: [{ fieldPath: 'data.id', bind: 'widgetId' }],
        } satisfies RequestStep,
      ],
    },
  ],
};

// Regression fixture for the path-params bug: an operation whose only
// params are path segments (no request body) — e.g. real "assign X to Y"
// operations like `assignClientToGroup` (PUT /groups/{groupId}/clients/{clientId}).
// step.pathParams is never populated by path-analyser (repo memory item 7);
// path params must be derived from pathTemplate instead, or the input object
// is emitted empty and the real SDK call fails with a 400.
const PATH_PARAMS_ONLY_COLLECTION: EndpointScenarioCollection = {
  endpoint: {
    operationId: 'assignClientToGroup',
    method: 'PUT',
    path: '/groups/{groupId}/clients/{clientId}',
  },
  requiredSemanticTypes: [],
  optionalSemanticTypes: [],
  scenarios: [
    {
      id: 'sc1',
      name: 'path #1',
      description: 'Assign a client to a group',
      operations: [
        {
          operationId: 'assignClientToGroup',
          method: 'PUT',
          path: '/groups/{groupId}/clients/{clientId}',
        },
      ],
      producedSemanticTypes: [],
      satisfiedSemanticTypes: [],
      bindings: { groupIdVar: 'group_1', clientIdVar: 'client_1' },
      requestPlan: [
        {
          operationId: 'assignClientToGroup',
          method: 'PUT',
          pathTemplate: '/groups/{groupId}/clients/{clientId}',
          expect: { status: 204 },
        } satisfies RequestStep,
      ],
    },
  ],
};

const UNMAPPED_COLLECTION: EndpointScenarioCollection = {
  endpoint: { operationId: 'getNonexistentThing', method: 'GET', path: '/nonexistent/{id}' },
  requiredSemanticTypes: [],
  optionalSemanticTypes: [],
  scenarios: [
    {
      id: 'sc1',
      name: 'happy path',
      description: 'An operationId with no backing SDK method',
      operations: [
        { operationId: 'getNonexistentThing', method: 'GET', path: '/nonexistent/{id}' },
      ],
      producedSemanticTypes: [],
      satisfiedSemanticTypes: [],
      requestPlan: [
        {
          operationId: 'getNonexistentThing',
          method: 'GET',
          pathTemplate: '/nonexistent/{id}',
          pathParams: [{ name: 'id', var: 'idVar' }],
          expect: { status: 200 },
        } satisfies RequestStep,
      ],
    },
  ],
};

// Regression fixture for the pending-binding fix: a scenario whose only
// binding has no in-scenario producer step (`bindings.nameVar ===
// '__PENDING__'`), mirroring the real `publishMessage` scenario that
// motivated the fix. `seedBindings` is planner-computed data (see
// path-analyser/src/seedBindings.ts) already present on real scenario JSON.
const PENDING_BINDING_COLLECTION: EndpointScenarioCollection = {
  endpoint: { operationId: 'publishMessage', method: 'POST', path: '/messages/publication' },
  requiredSemanticTypes: [],
  optionalSemanticTypes: [],
  scenarios: [
    {
      id: 'sc1',
      name: 'base',
      description: 'Publish a message with a client-minted name',
      operations: [
        { operationId: 'publishMessage', method: 'POST', path: '/messages/publication' },
      ],
      producedSemanticTypes: [],
      satisfiedSemanticTypes: [],
      bindings: { nameVar: '__PENDING__' },
      seedBindings: ['nameVar'],
      requestPlan: [
        {
          operationId: 'publishMessage',
          method: 'POST',
          pathTemplate: '/messages/publication',
          expect: { status: 200 },
          // biome-ignore lint/suspicious/noTemplateCurlyInString: literal `${var}` placeholder syntax used by the planner's bodyTemplate format, not a JS template literal
          bodyTemplate: { name: '${nameVar}' },
          bodyKind: 'json',
        } satisfies RequestStep,
      ],
    },
  ],
};

const FIXTURE_BODY_COLLECTION: EndpointScenarioCollection = {
  endpoint: { operationId: 'createDeployment', method: 'POST', path: '/deployments' },
  requiredSemanticTypes: [],
  optionalSemanticTypes: [],
  scenarios: [
    {
      id: 'sc1',
      name: 'deployment fixture',
      description: 'Deploy a BPMN resource from a fixture file',
      operations: [{ operationId: 'createDeployment', method: 'POST', path: '/deployments' }],
      producedSemanticTypes: [],
      satisfiedSemanticTypes: [],
      requestPlan: [
        {
          operationId: 'createDeployment',
          method: 'POST',
          pathTemplate: '/deployments',
          expect: { status: 200 },
          bodyTemplate: {
            // biome-ignore lint/suspicious/noTemplateCurlyInString: literal planner placeholder in a test fixture
            fields: { tenantId: '${tenantIdVar}' },
            files: { resources: '@@FILE:bpmn/service-task.bpmn' },
          },
          bodyKind: 'multipart',
        } satisfies RequestStep,
      ],
    },
  ],
};

// Mirrors the real createDeployment scenario shape: tenantIdVar is
// __PENDING__ and listed in seedBindings (the planner's "someone must
// supply this" signal), but this scenario is a *consumer* — it does not
// declare HTTP 409 on the binding, so it must not mint a fresh tenant id
// and the field must be left unseeded so the request omits it (#342).
const TENANT_OMIT_CONSUMER_COLLECTION: EndpointScenarioCollection = {
  endpoint: { operationId: 'createDeployment', method: 'POST', path: '/deployments' },
  requiredSemanticTypes: [],
  optionalSemanticTypes: [],
  scenarios: [
    {
      id: 'sc1',
      name: 'bpmn',
      description: 'Deploy a BPMN resource',
      operations: [{ operationId: 'createDeployment', method: 'POST', path: '/deployments' }],
      producedSemanticTypes: [],
      satisfiedSemanticTypes: [],
      bindings: { tenantIdVar: '__PENDING__' },
      seedBindings: ['tenantIdVar'],
      requestPlan: [
        {
          operationId: 'createDeployment',
          method: 'POST',
          pathTemplate: '/deployments',
          expect: { status: 200 },
          // biome-ignore lint/suspicious/noTemplateCurlyInString: literal planner placeholder in a test fixture
          bodyTemplate: { tenantId: '${tenantIdVar}' },
          bodyKind: 'json',
        } satisfies RequestStep,
      ],
    },
  ],
};

// Mirrors a producer scenario (e.g. createTenant): the op declares HTTP 409
// on the client-minted tenantIdVar, so it must still mint a fresh value —
// omitWhenUnbound only suppresses the *consumer* seed path (#342).
const TENANT_OMIT_PRODUCER_COLLECTION: EndpointScenarioCollection = {
  endpoint: { operationId: 'createTenant', method: 'POST', path: '/tenants' },
  requiredSemanticTypes: [],
  optionalSemanticTypes: [],
  scenarios: [
    {
      id: 'sc1',
      name: 'base',
      description: 'Create a tenant',
      operations: [{ operationId: 'createTenant', method: 'POST', path: '/tenants' }],
      producedSemanticTypes: [],
      satisfiedSemanticTypes: [],
      bindings: { tenantIdVar: '__PENDING__' },
      seedBindings: ['tenantIdVar'],
      requestPlan: [
        {
          operationId: 'createTenant',
          method: 'POST',
          pathTemplate: '/tenants',
          expect: { status: 201 },
          // biome-ignore lint/suspicious/noTemplateCurlyInString: literal planner placeholder in a test fixture
          bodyTemplate: { tenantId: '${tenantIdVar}' },
          bodyKind: 'json',
          declares409: true,
        } satisfies RequestStep,
      ],
    },
  ],
};

// Regression fixture (Copilot PR #575 review): a hostile/malformed
// operationId embedding a real newline. toSdkMethodName() does not strip
// control characters, so without sanitization this would break out of the
// `// SKIPPED: ...` line comment and inject the remainder of the line as
// executable code.
const HOSTILE_OPERATION_ID_COLLECTION: EndpointScenarioCollection = {
  endpoint: { operationId: 'getNonexistent\nThing', method: 'GET', path: '/nonexistent/{id}' },
  requiredSemanticTypes: [],
  optionalSemanticTypes: [],
  scenarios: [
    {
      id: 'sc1',
      name: 'happy path',
      description: 'An operationId embedding a newline',
      operations: [
        { operationId: 'getNonexistent\nThing', method: 'GET', path: '/nonexistent/{id}' },
      ],
      producedSemanticTypes: [],
      satisfiedSemanticTypes: [],
      requestPlan: [
        {
          operationId: 'getNonexistent\nThing',
          method: 'GET',
          pathTemplate: '/nonexistent/{id}',
          pathParams: [{ name: 'id', var: 'idVar' }],
          expect: { status: 200 },
        } satisfies RequestStep,
      ],
    },
  ],
};

describe('JavaScript SDK Emitter', () => {
  test('factory creates emitter with correct metadata', () => {
    const emitter = createJsSdkEmitter();
    expect(emitter.id).toBe('js-sdk');
    expect(emitter.name).toBe('JavaScript SDK');
    expect(emitter.supportedConfigs).toEqual(['*']);
  });

  test('suite file name uses the operationId and feature mode', () => {
    expect(jsSuiteFileName(SAMPLE_COLLECTION)).toBe('getUser/getUser.feature.test.ts');
  });

  test('emitter.emit returns one file with generated suite content', async () => {
    const emitter = createJsSdkEmitter();
    const files = await emitter.emit(SAMPLE_COLLECTION, {
      outDir: '/unused',
      suiteName: 'getUser',
      mode: 'feature',
      configName: 'test',
      emitterConfig: {},
      resolveConfigPath: (rel) => rel,
    });

    expect(files).toHaveLength(1);
    expect(files[0].relativePath).toBe('getUser/getUser.feature.test.ts');
    expect(files[0].content).toContain(
      "import { describe, it, expect, beforeEach } from 'vitest';",
    );
    expect(files[0].content).toContain("import { Camunda8 } from '@camunda8/sdk';");
    expect(files[0].content).toContain("import type { HttpSdkError } from '@camunda8/sdk';");
  });

  test('rendered suite builds a flat input object and renders extract bindings', () => {
    const output = renderJsSuite(SAMPLE_COLLECTION, { mode: 'feature' });

    expect(output).toContain('client = new Camunda8().getOrchestrationClusterApiClientLoose();');
    expect(output).toContain('const input1 = {');
    expect(output).toContain("widgetId: ctx['widgetIdVar'],");
    expect(output).not.toContain('expect(response1.status).toBe(200);');
    expect(output).toContain("ctx['widgetId'] = response1?.data?.id;");
  });

  test('scenario using an operationId with no backing SDK method is emitted as a skipped test', () => {
    const output = renderJsSuite(UNMAPPED_COLLECTION, { mode: 'feature' });

    expect(output).toContain('it.skip(\n    "sc1 - happy path",');
    expect(output).toContain(
      "// SKIPPED: no method 'getNonexistentThing' on installed @camunda8/sdk",
    );
    expect(output).not.toContain('const input1 = {');
    expect(output).not.toContain('client.getNonexistentThing');
  });

  test('a newline embedded in the missing-method reason does not break out of the SKIPPED comment', () => {
    const output = renderJsSuite(HOSTILE_OPERATION_ID_COLLECTION, { mode: 'feature' });

    // The whole reason must render on a single // comment line -- no raw
    // newline between "SKIPPED:" and the rest of the sentence.
    expect(output).toMatch(/\/\/ SKIPPED: no method '[^\n]*' on installed @camunda8\/sdk[^\n]*/);
    expect(output).not.toMatch(/\/\/ SKIPPED: no method 'getNonexistent$/m);
  });

  test('a __PENDING__ binding with a planner seedBindings entry is seeded via seedBinding(), not left undefined', () => {
    const output = renderJsSuite(PENDING_BINDING_COLLECTION, { mode: 'feature' });

    expect(output).toContain("import { initSpecSalt, seedBinding } from '../support/seeding';");
    expect(output).toContain('initSpecSalt("publishMessage");');
    expect(output).toContain("ctx['nameVar'] = ctx['nameVar'] ?? seedBinding('nameVar');");
    expect(output).not.toContain('pending binding');
    expect(output).not.toContain("ctx['nameVar'] = undefined;");
  });

  test('a path-params-only operation (no body) derives its input from pathTemplate, not the dead step.pathParams field', () => {
    const output = renderJsSuite(PATH_PARAMS_ONLY_COLLECTION, { mode: 'feature' });

    expect(output).toContain("groupId: ctx['groupIdVar'],");
    expect(output).toContain("clientId: ctx['clientIdVar'],");
    expect(output).not.toContain('const input1 = {\n      };');
  });

  test('resolves nested @@FILE body markers through the generated fixture helper', () => {
    const output = renderJsSuite(FIXTURE_BODY_COLLECTION, { mode: 'feature' });

    expect(output).toContain("import { resolveFixture } from '../support/fixtures';");
    expect(output).toContain(
      '"resources": [new File([await resolveFixture("bpmn/service-task.bpmn")], "service-task.bpmn")]',
    );
    expect(output).toContain('"tenantId": ctx[\'tenantIdVar\']');
    expect(output).not.toContain('@@FILE:bpmn/service-task.bpmn');
  });

  // Regression (Copilot PR #575 review): `new File(...)` in a multipart
  // `files` field is not a global on Node 18 (the generated README's
  // documented minimum) — it must be imported explicitly from
  // 'node:buffer' rather than relying on the ambient global.
  test('imports File from node:buffer when a scenario emits a multipart file field', () => {
    const output = renderJsSuite(FIXTURE_BODY_COLLECTION, { mode: 'feature' });

    expect(output).toContain("import { File } from 'node:buffer';");
  });

  test('does not import File when no scenario emits a multipart file field', () => {
    const output = renderJsSuite(SAMPLE_COLLECTION, { mode: 'feature' });

    expect(output).not.toContain("import { File } from 'node:buffer';");
  });

  // Regression (Copilot PR #575 review): the `File` global is only stable
  // on `node:buffer` from Node 18.13 -- the generated project's documented/
  // enforced minimum must match, not the earlier general ">=18" claim.
  test('scaffolded package.json declares an engines.node minimum of >=18.13.0', () => {
    const files = loadJsProjectScaffoldingFiles();
    const packageJsonFile = files.find((f) => f.relativePath === 'package.json');
    if (!packageJsonFile) throw new Error('package.json not found in scaffolding files');
    const parsed: unknown = JSON.parse(packageJsonFile.content);
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('engines' in parsed) ||
      typeof parsed.engines !== 'object' ||
      parsed.engines === null
    ) {
      throw new Error('package.json has no engines field');
    }
    expect(parsed.engines).toEqual({ node: '>=18.13.0' });
  });

  test('scaffolded README documents the >=18.13 Node minimum', () => {
    const files = loadJsProjectScaffoldingFiles();
    const readmeFile = files.find((f) => f.relativePath === 'README.md');
    if (!readmeFile) throw new Error('README.md not found in scaffolding files');
    expect(readmeFile.content).toContain('Node.js >=18.13');
    expect(readmeFile.content).not.toContain('Node.js >=18\n');
  });

  test('uses a non-zero consistency wait budget for SDK methods requiring consistency', () => {
    const output = renderJsSuite(SAMPLE_COLLECTION, { mode: 'feature' });

    expect(output).toContain('waitUpToMs: 5000');
    expect(output).not.toContain('waitUpToMs: 0');
  });

  // Regression (Copilot PR #575 review): the witness call inside an
  // eventualWaitsAfter poll reused the arity-detected consistency object a
  // normal request step computes for itself, but never computed/passed one
  // for the witness's own method — an eventually-consistent witness (e.g.
  // getProcessInstance) threw the real SDK's client-side "Missing
  // consistencyManagement parameter" error before polling ever started.
  test('passes an arity-detected consistency argument to the eventual-wait witness call', () => {
    const collection: EndpointScenarioCollection = {
      endpoint: {
        operationId: 'createProcessInstance',
        method: 'POST',
        path: '/process-instances',
      },
      requiredSemanticTypes: [],
      optionalSemanticTypes: [],
      scenarios: [
        {
          id: 'sc1',
          name: 'happy path',
          description: 'Create a process instance and wait for it to become active',
          operations: [
            { operationId: 'createProcessInstance', method: 'POST', path: '/process-instances' },
          ],
          producedSemanticTypes: [],
          satisfiedSemanticTypes: [],
          requestPlan: [
            {
              operationId: 'createProcessInstance',
              method: 'POST',
              pathTemplate: '/process-instances',
              expect: { status: 200 },
              eventualWaitsAfter: [
                {
                  state: 'ACTIVE',
                  witness: {
                    operationId: 'getProcessInstance',
                    method: 'GET',
                    pathTemplate: '/process-instances/{processInstanceKey}',
                    predicate: { path: 'state', equals: 'ACTIVE' },
                    waitUpToMs: 5000,
                    pollIntervalMs: 250,
                  },
                },
              ],
            } satisfies RequestStep,
          ],
        },
      ],
    };

    const output = renderJsSuite(collection, { mode: 'feature' });

    expect(output).toContain(
      'const witnessConsistency1_1 = client.getProcessInstance.length >= 2 ? { consistency: { waitUpToMs: 5000 } } : undefined;',
    );
    expect(output).toContain('witnessCall1_1(witnessInput1_1, witnessConsistency1_1)');
  });
});

// Regression (Copilot PR #575 review): describe()/it() titles interpolated
// operationId/scenario name directly into a single-quoted string literal
// without escaping. An operationId or scenario name containing an
// apostrophe, backslash, or newline (the OpenAPI spec does not formally
// restrict operationId to /[A-Za-z0-9_]+/) would produce unparseable or
// semantically-wrong generated code. Mirrors the Playwright emitter's
// JSON.stringify(...) fix (Copilot PR #170 review).
describe('describe()/it() title escaping (Copilot PR #575 review)', () => {
  const hostileOpId = "weird'op\\with\nnewline";

  test('escapes an operationId containing string metacharacters in the describe() title', () => {
    const collection: EndpointScenarioCollection = {
      endpoint: { operationId: hostileOpId, method: 'GET', path: '/x' },
      requiredSemanticTypes: [],
      optionalSemanticTypes: [],
      scenarios: [
        {
          id: 'sc1',
          name: 'hostile id',
          operations: [{ operationId: hostileOpId, method: 'GET', path: '/x' }],
          producedSemanticTypes: [],
          satisfiedSemanticTypes: [],
          requestPlan: [
            {
              operationId: hostileOpId,
              method: 'GET',
              pathTemplate: '/x',
              expect: { status: 200 },
            } satisfies RequestStep,
          ],
        },
      ],
    };

    const output = renderJsSuite(collection, { mode: 'feature' });

    expect(output).toContain(
      `describe(${JSON.stringify(`${hostileOpId} (feature tests)`)}, () => {`,
    );
  });

  test('escapes a scenario name containing string metacharacters in the it() title', () => {
    const collection: EndpointScenarioCollection = {
      endpoint: { operationId: 'getUser', method: 'GET', path: '/users/{username}' },
      requiredSemanticTypes: [],
      optionalSemanticTypes: [],
      scenarios: [
        {
          id: 'sc1',
          name: "weird's\\name\nhere",
          operations: [{ operationId: 'getUser', method: 'GET', path: '/users/{username}' }],
          producedSemanticTypes: [],
          satisfiedSemanticTypes: [],
          requestPlan: [
            {
              operationId: 'getUser',
              method: 'GET',
              pathTemplate: '/users/{username}',
              expect: { status: 200 },
            } satisfies RequestStep,
          ],
        },
      ],
    };

    const output = renderJsSuite(collection, { mode: 'feature' });

    expect(output).toContain(`  it(\n    ${JSON.stringify("sc1 - weird's\\name\nhere")},`);
  });
});

// Regression guard for the js-sdk emitter's missing globalContextSeeds
// plumbing (#342 parity with Playwright/C#): js-sdk used to hardcode
// `globalContextSeeds: []`, so every scenario minted a random tenantIdVar
// via the catch-all seedBinding() rule — a value a single-tenant broker
// rejects with INVALID_ARGUMENT. These tests pin the fix: an
// omitWhenUnbound binding is left unseeded for consumer-only scenarios,
// and still minted for producer scenarios that declare HTTP 409 on it.
describe('emitter: universal-seed prologue parity with Playwright/C# (#342)', () => {
  test('a consumer-only scenario leaves an omitWhenUnbound tenantIdVar unseeded so the field is omitted on the wire', () => {
    const output = renderJsSuite(TENANT_OMIT_CONSUMER_COLLECTION, {
      mode: 'feature',
      globalContextSeeds: [TENANT_SEED_OMIT],
    });

    expect(output).not.toContain("seedBinding('tenantIdVar')");
    expect(output).not.toMatch(/ctx\['tenantIdVar'\] = ctx\['tenantIdVar'\] \?\?/);
    expect(output).toContain('"tenantId": ctx[\'tenantIdVar\']');
  });

  test('a producer scenario declaring HTTP 409 on the binding still mints a fresh tenantIdVar', () => {
    const output = renderJsSuite(TENANT_OMIT_PRODUCER_COLLECTION, {
      mode: 'feature',
      globalContextSeeds: [TENANT_SEED_OMIT],
    });

    expect(output).toContain(
      "ctx['tenantIdVar'] = ctx['tenantIdVar'] ?? seedBinding('tenantIdVar', { unique: true });",
    );
  });

  test('createJsSdkEmitter().emit forwards ctx.globalContextSeeds through to the rendered suite', async () => {
    const emitter = createJsSdkEmitter();
    const [file] = await emitter.emit(TENANT_OMIT_CONSUMER_COLLECTION, {
      outDir: '/unused',
      suiteName: 'createDeployment',
      mode: 'feature',
      configName: 'test',
      emitterConfig: {},
      resolveConfigPath: (rel) => rel,
      globalContextSeeds: [TENANT_SEED_OMIT],
    });

    expect(file.content).not.toContain("seedBinding('tenantIdVar')");
  });

  test('rejects an unsafe globalContextSeeds shape (boundary re-validation, mirrors PlaywrightEmitter)', async () => {
    const badSeed = { binding: 'tenant-id', fieldName: 'tenantId', seedRule: 'tenantIdVar' };
    await expect(
      createJsSdkEmitter().emit(TENANT_OMIT_CONSUMER_COLLECTION, {
        outDir: '/unused',
        suiteName: 'createDeployment',
        mode: 'feature',
        configName: 'test',
        emitterConfig: {},
        resolveConfigPath: (rel) => rel,
        globalContextSeeds: [badSeed],
      }),
    ).rejects.toThrow(/globalContextSeedSafeIdentifier|safe identifier|must match pattern/);
  });
});

// Regression (Copilot PR #575 review): renderJavaScriptBody() previously
// only resolved a *whole-string* `${var}` placeholder to `ctx['var']` —
// a literal mixed with a placeholder (e.g. 'proc-${tenantIdVar}') fell
// through to JSON.stringify() and was emitted as an unresolved literal.
// Mirrors the equivalent python-sdk fix (renderPythonTemplateString).
describe('renderJavaScriptBody: mixed literal/placeholder strings and the RANDOM seed token', () => {
  test('a whole-string placeholder still renders as the plain ctx[...] lookup', () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal `${var}` placeholder syntax used by the planner's bodyTemplate format, not a JS template literal
    expect(renderJavaScriptBody({ widgetId: '${widgetIdVar}' })).toContain(
      '"widgetId": ctx[\'widgetIdVar\']',
    );
  });

  test('a literal/binding mix renders as a real JS template literal interpolating ctx[...]', () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal `${var}` placeholder syntax used by the planner's bodyTemplate format, not a JS template literal
    const output = renderJavaScriptBody({ name: 'proc-${processInstanceKeyVar}-${tenantIdVar}' });
    // biome-ignore lint/suspicious/noTemplateCurlyInString: asserting on the real JS template literal the emitter produces
    const expected = "\"name\": `proc-${ctx['processInstanceKeyVar']}-${ctx['tenantIdVar']}`";
    expect(output).toContain(expected);
  });

  test('a whole-string RANDOM token is preserved as a literal, not resolved via ctx.get', () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal planner-minted `${RANDOM}` seed token, not a JS template literal
    const output = renderJavaScriptBody({ processDefinitionId: '${RANDOM}' });
    expect(output).not.toContain("ctx['RANDOM']");
    // Rendered as a template literal with the leading `$` escaped so it
    // isn't evaluated as an interpolation referencing an undefined
    // `RANDOM` identifier; the literal source text still contains the
    // exact `${RANDOM}` substring the #133-style invariant whitelists.
    // biome-ignore lint/suspicious/noTemplateCurlyInString: asserting on the literal escaped `${RANDOM}` text produced by the emitter
    expect(output).toContain('`\\${RANDOM}`');
  });

  test('a RANDOM token embedded with literal text and a real binding preserves both', () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal planner-minted `${RANDOM}` seed token mixed with a real binding placeholder
    const output = renderJavaScriptBody({ processDefinitionId: 'proc_${RANDOM}_${tenantIdVar}' });
    expect(output).not.toContain("ctx['RANDOM']");
    // biome-ignore lint/suspicious/noTemplateCurlyInString: asserting on the literal escaped `${RANDOM}` text alongside a real ctx[...] interpolation
    expect(output).toContain("`proc_\\${RANDOM}_${ctx['tenantIdVar']}`");
  });
});
