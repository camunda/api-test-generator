import { describe, expect, it } from 'vitest';
import {
  bindSemanticInput,
  classifySemantic,
} from '../../../path-analyser/src/bindSemanticInput.ts';
import type { OperationGraph } from '../../../path-analyser/src/types.ts';

/**
 * Classification-dispatch fixtures — Layer 2 of the layered test
 * strategy, for the `bindSemanticInput` chokepoint that routes all
 * five #162 value-source classifications through a single helper.
 *
 *   1. producer-bound          → BFS in scenarioGenerator.ts
 *   2. client-minted identifier → BFS via `establishersByType`
 *   3. client-minted attribute  → variant suite (`generateOptionalSubShapeVariants`)
 *   4. external boundary        → BFS via `externalEntityIdentifiers`
 *   5. model-derived            → variant suite (`generateOptionalSubShapeVariants`)
 *
 * Issue #247 (suite-partition cut follow-up) removed the dedicated
 * feature-suite helpers `bindClientMintedAttribute` and
 * `bindModelDerivedFromFixture`. Optional-population for the
 * `clientMintedAttribute` (Tag, BusinessId) and `modelDerived`
 * (ElementId) classifications now lives exclusively in the variant
 * suite, which routes through `bindSemanticInput` the same way every
 * other classification does. The chokepoint's classification and
 * value-resolution contracts are guarded here.
 *
 * Coverage map for the five classifications:
 *
 *   1. producer-bound          → planner-contracts.test.ts (fixtures
 *                                A, F, G, H); planner-establishes.test.ts
 *                                for binding-name discipline.
 *   2. client-minted identifier → planner-establishes.test.ts.
 *   3. client-minted attribute  → variant-suite L3 invariants in
 *                                configs/<config>/regression-invariants.test.ts.
 *   4. external boundary        → planner-establishes.test.ts (ClientId
 *                                fixture).
 *   5. model-derived            → variant-suite L3 invariants in
 *                                configs/<config>/regression-invariants.test.ts.
 *
 * What stays here is the classification + value-resolution contract on
 * `bindSemanticInput` itself, because the chokepoint is a thin
 * synthetic surface that PR 5 (load-time diagnostic on `unclassified`)
 * will build on.
 */

// ---------------------------------------------------------------------------
// classifySemantic precedence (#162 PR 3)
// ---------------------------------------------------------------------------
//
// `classifySemantic` walks declarations + graph indices in a fixed
// order. The bundled spec today has no real collisions — every
// modelDerived / clientMintedAttribute semantic is also absent from the
// producer / establisher / external-entity indices. These synthetic
// tests assert the precedence anyway, because the contract matters
// even if it is today unobservable.

describe('classifySemantic precedence (#162 PR 3)', () => {
  function graphWithProducer(semantic: string): OperationGraph {
    return {
      operations: {},
      producersByType: { [semantic]: ['someOp'] },
    };
  }

  it('modelDerived declaration wins over a producersByType entry', () => {
    const graph: OperationGraph = {
      ...graphWithProducer('ElementId'),
      domain: {
        version: 1,
        semanticTypes: { ElementId: { kind: 'modelDerived' } },
      },
    };

    expect(classifySemantic('ElementId', graph)).toBe('modelDerived');
  });

  it('clientMintedAttribute declaration wins over a producersByType entry', () => {
    const graph: OperationGraph = {
      ...graphWithProducer('Tag'),
      domain: {
        version: 1,
        semanticTypes: { Tag: { kind: 'attribute', clientMinted: true } },
      },
    };

    expect(classifySemantic('Tag', graph)).toBe('clientMintedAttribute');
  });

  it('producerBound wins over clientMintedIdentifier when no domain.kind applies', () => {
    const graph: OperationGraph = {
      operations: {},
      producersByType: { ProcessInstanceKey: ['createProcessInstance'] },
      establishersByType: { ProcessInstanceKey: ['someOp'] },
    };

    expect(classifySemantic('ProcessInstanceKey', graph)).toBe('producerBound');
  });

  it('clientMintedIdentifier wins over externalBoundary when no producer applies', () => {
    const graph: OperationGraph = {
      operations: {},
      producersByType: {},
      establishersByType: { TenantId: ['createTenant'] },
      externalEntityIdentifiers: new Set(['TenantId']),
    };

    expect(classifySemantic('TenantId', graph)).toBe('clientMintedIdentifier');
  });

  it('externalBoundary applies when only the external-entities set matches', () => {
    const graph: OperationGraph = {
      operations: {},
      producersByType: {},
      externalEntityIdentifiers: new Set(['ClientId']),
    };

    expect(classifySemantic('ClientId', graph)).toBe('externalBoundary');
  });

  it('returns unclassified when no declaration and no index entry matches', () => {
    const graph: OperationGraph = {
      operations: {},
      producersByType: {},
    };

    expect(classifySemantic('UnknownSemantic', graph)).toBe('unclassified');
  });

  it('attribute declaration without clientMinted does NOT short-circuit producerBound', () => {
    // A declaration of `kind: 'attribute'` without `clientMinted: true`
    // must NOT be treated as clientMintedAttribute — only the explicit
    // `clientMinted === true` flag promotes the semantic into the
    // clientMintedAttribute branch.
    const graph: OperationGraph = {
      ...graphWithProducer('SomeAttr'),
      domain: {
        version: 1,
        semanticTypes: { SomeAttr: { kind: 'attribute' } },
      },
    };

    expect(classifySemantic('SomeAttr', graph)).toBe('producerBound');
  });
});

// ---------------------------------------------------------------------------
// bindSemanticInput modelDerived value-resolution contract (#162 PR 3)
// ---------------------------------------------------------------------------
//
// The chokepoint must NOT collapse "modelDerived semantic with missing
// fixture data" to `unclassified` — PR 5 (load-time diagnostic) needs
// to tell the two cases apart. Classification is a property of the
// semantic + graph; the value is a separate question of whether the
// active fixture happens to provide it.

describe('bindSemanticInput modelDerived value-resolution (#162 PR 3)', () => {
  const modelDerivedGraph: OperationGraph = {
    operations: {},
    producersByType: {},
    domain: {
      version: 1,
      semanticTypes: { ElementId: { kind: 'modelDerived' } },
    },
  };

  it('returns modelDerived with the fixture value when providesValues is populated', () => {
    const fixture = {
      kind: 'bpmnProcess',
      path: 'bpmn/service-task.bpmn',
      providesValues: { ElementId: ['service_task_1', 'service_task_2'] },
    };

    const result = bindSemanticInput({
      semantic: 'ElementId',
      operationId: 'createProcessInstance',
      graph: modelDerivedGraph,
      fixture,
    });

    expect(result).toEqual({
      classification: 'modelDerived',
      varName: 'elementIdVar',
      value: 'service_task_1',
    });
  });

  it('returns modelDerived (NOT unclassified) when the fixture lacks providesValues', () => {
    const fixture = {
      kind: 'form',
      path: 'forms/simple.form',
    };

    const result = bindSemanticInput({
      semantic: 'ElementId',
      operationId: 'createProcessInstance',
      graph: modelDerivedGraph,
      fixture,
    });

    expect(result.classification).toBe('modelDerived');
    if (result.classification === 'modelDerived') {
      expect(result.varName).toBe('elementIdVar');
      expect(result.value).toBeUndefined();
    }
  });

  it('returns modelDerived with no value when no fixture is supplied at all', () => {
    const result = bindSemanticInput({
      semantic: 'ElementId',
      operationId: 'createProcessInstance',
      graph: modelDerivedGraph,
      // fixture intentionally omitted
    });

    expect(result.classification).toBe('modelDerived');
    if (result.classification === 'modelDerived') {
      expect(result.value).toBeUndefined();
    }
  });

  it('returns modelDerived with no value when providesValues[<sem>] is an empty array', () => {
    const fixture = {
      kind: 'bpmnProcess',
      path: 'bpmn/service-task.bpmn',
      providesValues: { ElementId: [] },
    };

    const result = bindSemanticInput({
      semantic: 'ElementId',
      operationId: 'createProcessInstance',
      graph: modelDerivedGraph,
      fixture,
    });

    expect(result.classification).toBe('modelDerived');
    if (result.classification === 'modelDerived') {
      expect(result.value).toBeUndefined();
    }
  });

  it('still returns unclassified when the semantic is neither declared nor indexed', () => {
    const result = bindSemanticInput({
      semantic: 'UnknownSemantic',
      operationId: 'createProcessInstance',
      graph: { operations: {}, producersByType: {} },
    });

    expect(result.classification).toBe('unclassified');
  });
});
