/**
 * Construct fixtures for the semantic-graph extractor — Layer 1 of the
 * layered test strategy (#36).
 *
 * Each fixture is a hand-curated, minimal OpenAPI snippet that isolates ONE
 * extractor behaviour. Paired tests assert the property under test by name,
 * so a failure points at one construct, not at 412 hashed files.
 *
 * Adding a new extractor bug fix? Add a fixture demonstrating the bug
 * BEFORE the fix, alongside the assertion.
 */
import { describe, expect, it } from 'vitest';
import { SchemaAnalyzer } from '../../../semantic-graph-extractor/dist/schema-analyzer.js';
import type {
  OpenAPISpec,
  SemanticTypeReference,
} from '../../../semantic-graph-extractor/dist/types.js';

function extractRequestBodyFor(spec: OpenAPISpec, opId: string): SemanticTypeReference[] {
  const ops = new SchemaAnalyzer().extractOperations(spec);
  const op = ops.find((o) => o.operationId === opId);
  if (!op) throw new Error(`fixture: operation ${opId} not present in extracted spec`);
  return op.requestBodySemanticTypes;
}

function extractResponseFor(spec: OpenAPISpec, opId: string): SemanticTypeReference[] {
  const ops = new SchemaAnalyzer().extractOperations(spec);
  const op = ops.find((o) => o.operationId === opId);
  if (!op) throw new Error(`fixture: operation ${opId} not present in extracted spec`);
  const out: SemanticTypeReference[] = [];
  for (const entries of Object.values(op.responseSemanticTypes ?? {})) {
    out.push(...entries);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Fixture #31 — optional ancestor demotes a leaf to optional.
//
// `startInstructions` is OPTIONAL on the request body, but the inner array
// items declare `required: [elementId]`. Iteration 1 of #31 demands that
// `startInstructions[].elementId` be classified `required: false`, because
// without the optional parent there is no element of the array at all.
// ---------------------------------------------------------------------------
const fixtureOptionalAncestor: OpenAPISpec = {
  openapi: '3.0.3',
  info: { title: 'fixture-optional-ancestor', version: '0.0.0' },
  paths: {
    '/things': {
      post: {
        operationId: 'createThing',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['processDefinitionKey'],
                properties: {
                  processDefinitionKey: {
                    type: 'string',
                    'x-semantic-type': 'ProcessDefinitionKey',
                  },
                  startInstructions: {
                    // OPTIONAL parent. Items list `elementId` as required, but
                    // because the parent array itself is optional, the leaf
                    // must NOT bubble up as required.
                    type: 'array',
                    items: {
                      type: 'object',
                      required: ['elementId'],
                      properties: {
                        elementId: { type: 'string', 'x-semantic-type': 'ElementId' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'ok' } },
      },
    },
  },
};

// ---------------------------------------------------------------------------
// Fixture #32-review — oneOf parent's required-ness propagates into branches.
//
// PR #32's review feedback flagged that oneOf branches share the parent's
// required state: exactly one branch is selected per request, and each
// branch carries its own `required` list. So if the parent property is
// required, each branch's `required` leaves stay required.
// ---------------------------------------------------------------------------
const fixtureOneOfRequiredBranch: OpenAPISpec = {
  openapi: '3.0.3',
  info: { title: 'fixture-oneof-required-branch', version: '0.0.0' },
  paths: {
    '/things': {
      post: {
        operationId: 'createThingOneOf',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['target'],
                properties: {
                  target: {
                    oneOf: [
                      {
                        type: 'object',
                        required: ['processDefinitionKey'],
                        properties: {
                          processDefinitionKey: {
                            type: 'string',
                            'x-semantic-type': 'ProcessDefinitionKey',
                          },
                        },
                      },
                      {
                        type: 'object',
                        required: ['processDefinitionId'],
                        properties: {
                          processDefinitionId: {
                            type: 'string',
                            'x-semantic-type': 'ProcessDefinitionId',
                          },
                        },
                      },
                    ],
                  },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'ok' } },
      },
    },
  },
};

// ---------------------------------------------------------------------------
// Fixture #33 — array form of x-semantic-provider on parent classifies child.
//
// The Camunda spec uses `x-semantic-provider: ['processDefinitionKey']` on
// the enclosing object. #33's bug was that only the boolean form on the
// leaf itself was honoured. After the fix, the array form on the parent
// flags every named child as a provider.
// ---------------------------------------------------------------------------
const fixtureProviderArrayForm: OpenAPISpec = {
  openapi: '3.0.3',
  info: { title: 'fixture-provider-array-form', version: '0.0.0' },
  paths: {
    '/deployments': {
      post: {
        operationId: 'createDeploymentLike',
        responses: {
          '200': {
            description: 'ok',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  // Parent object names provider keys via array form.
                  'x-semantic-provider': ['processDefinitionKey', 'processDefinitionId'],
                  properties: {
                    processDefinitionKey: {
                      type: 'string',
                      'x-semantic-type': 'ProcessDefinitionKey',
                    },
                    processDefinitionId: {
                      type: 'string',
                      'x-semantic-type': 'ProcessDefinitionId',
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};

// ---------------------------------------------------------------------------
// Fixture #34-review — provider stays through intermediate object subtrees.
//
// PR #34's review feedback: the inheritedProvider flag must OR with whatever
// the ancestor named, otherwise descending through a nested object loses
// the provider classification mid-walk. Here the parent object names
// `result` as the provider subtree, and the actual semantic type is one
// level deeper inside `result`.
// ---------------------------------------------------------------------------
const fixtureProviderDeeplyNested: OpenAPISpec = {
  openapi: '3.0.3',
  info: { title: 'fixture-provider-deeply-nested', version: '0.0.0' },
  paths: {
    '/deployments': {
      post: {
        operationId: 'createDeploymentDeep',
        responses: {
          '200': {
            description: 'ok',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  'x-semantic-provider': ['result'],
                  properties: {
                    result: {
                      type: 'object',
                      properties: {
                        processDefinitionKey: {
                          type: 'string',
                          'x-semantic-type': 'ProcessDefinitionKey',
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};

// ---------------------------------------------------------------------------
// Fixture: legacy boolean form of x-semantic-provider on the leaf itself.
// Regression guard against accidentally dropping the legacy form when
// the array form was added in #33/#34.
// ---------------------------------------------------------------------------
const fixtureProviderBooleanLeaf: OpenAPISpec = {
  openapi: '3.0.3',
  info: { title: 'fixture-provider-boolean-leaf', version: '0.0.0' },
  paths: {
    '/things': {
      post: {
        operationId: 'createThingBooleanProvider',
        responses: {
          '200': {
            description: 'ok',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    processDefinitionKey: {
                      type: 'string',
                      'x-semantic-type': 'ProcessDefinitionKey',
                      'x-semantic-provider': true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};

// ---------------------------------------------------------------------------

describe('extractor construct fixtures', () => {
  describe('optional ancestor demotes leaf to optional (#31)', () => {
    it('startInstructions[].elementId is classified optional even though items.required lists it', () => {
      const refs = extractRequestBodyFor(fixtureOptionalAncestor, 'createThing');
      const leaf = refs.find((r) => r.fieldPath === 'startInstructions[].elementId');
      expect(
        leaf,
        'startInstructions[].elementId must appear in extracted semantics',
      ).toBeDefined();
      expect(leaf?.required).toBe(false);
    });

    it('a sibling required leaf at top level remains required', () => {
      const refs = extractRequestBodyFor(fixtureOptionalAncestor, 'createThing');
      const leaf = refs.find((r) => r.fieldPath === 'processDefinitionKey');
      expect(leaf?.required).toBe(true);
    });
  });

  describe('oneOf parent required-ness propagates into branches (#32 review)', () => {
    it('every branch leaf inherits the parent property requiredness', () => {
      const refs = extractRequestBodyFor(fixtureOneOfRequiredBranch, 'createThingOneOf');
      const branchLeaves = refs.filter(
        (r) => r.fieldPath.startsWith('target.') && r.semanticType.startsWith('ProcessDefinition'),
      );
      expect(branchLeaves.length, 'expected one entry per oneOf branch').toBe(2);
      for (const l of branchLeaves) {
        expect(l.required, `${l.semanticType} branch must inherit parent.required = true`).toBe(
          true,
        );
      }
    });
  });

  describe('x-semantic-provider array form classifies named children (#33)', () => {
    it('every property listed in the parent`s array-form annotation is flagged provider:true', () => {
      const refs = extractResponseFor(fixtureProviderArrayForm, 'createDeploymentLike');
      const key = refs.find((r) => r.semanticType === 'ProcessDefinitionKey');
      const id = refs.find((r) => r.semanticType === 'ProcessDefinitionId');
      expect(key?.provider).toBe(true);
      expect(id?.provider).toBe(true);
    });
  });

  describe('inheritedProvider stays through nested object subtrees (#34 review)', () => {
    it('provider stays true while descending through an intermediate object boundary', () => {
      const refs = extractResponseFor(fixtureProviderDeeplyNested, 'createDeploymentDeep');
      const leaf = refs.find((r) => r.fieldPath === 'result.processDefinitionKey');
      expect(leaf, 'expected result.processDefinitionKey to be extracted').toBeDefined();
      expect(leaf?.provider).toBe(true);
    });
  });

  describe('legacy boolean x-semantic-provider on the leaf is still honoured', () => {
    it('a leaf-level `x-semantic-provider: true` flags the entry as provider', () => {
      const refs = extractResponseFor(fixtureProviderBooleanLeaf, 'createThingBooleanProvider');
      const leaf = refs.find((r) => r.semanticType === 'ProcessDefinitionKey');
      expect(leaf?.provider).toBe(true);
    });
  });
});
