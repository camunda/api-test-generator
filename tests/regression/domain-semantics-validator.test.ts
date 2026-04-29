import { describe, expect, it } from 'vitest';
import { validateDomainSemantics } from '../../path-analyser/src/domainSemanticsValidator.ts';

// ---------------------------------------------------------------------------
// Class-scoped guards for path-analyser/src/domainSemanticsValidator.ts.
//
// Each `it` block constructs a minimal synthetic DomainSemantics object that
// violates exactly one invariant, then asserts the validator reports that
// invariant by name. Companion test for each existing regression test that
// asserts the same invariants over the real sidecar file.
//
// If the validator's catalogue of invariants ever shrinks, these tests fail
// and call out the gap explicitly rather than allowing a load-time defect to
// escape into runtime.
// ---------------------------------------------------------------------------

describe('validateDomainSemantics', () => {
  it('accepts an empty domain', () => {
    expect(validateDomainSemantics({})).toEqual([]);
  });

  it('reports artifactKindStateDeclared when producesStates is undeclared', () => {
    const errs = validateDomainSemantics({
      runtimeStates: { Known: {} },
      artifactKinds: {
        kindA: { producesStates: ['Unknown'] },
      },
    });
    expect(errs.map((e) => e.invariant)).toContain('artifactKindStateDeclared');
    expect(errs.find((e) => e.invariant === 'artifactKindStateDeclared')?.message).toContain(
      'Unknown',
    );
  });

  it('reports artifactKindWitnessDeclared when a key-shaped semantic type has no witnesses edge', () => {
    const errs = validateDomainSemantics({
      runtimeStates: { Known: {} },
      semanticTypes: {
        SomeKey: {}, // declared but no witnesses edge
      },
      artifactKinds: {
        kindA: { producesSemantics: ['SomeKey'] },
      },
    });
    expect(errs.map((e) => e.invariant)).toContain('artifactKindWitnessDeclared');
  });

  it('reports artifactKindWitnessDeclared when the semantic type is missing entirely', () => {
    const errs = validateDomainSemantics({
      runtimeStates: { Known: {} },
      artifactKinds: {
        kindA: { producesSemantics: ['MissingKey'] },
      },
    });
    expect(errs.map((e) => e.invariant)).toContain('artifactKindWitnessDeclared');
  });

  it('reports semanticTypeWitnessTargetResolves when witnesses target is undeclared', () => {
    const errs = validateDomainSemantics({
      runtimeStates: { Known: {} },
      semanticTypes: {
        SomeKey: { witnesses: 'NotAState' },
      },
    });
    expect(errs.map((e) => e.invariant)).toContain('semanticTypeWitnessTargetResolves');
  });

  it('reports semanticBindingTargetResolves when valueBindings RHS references a missing semantic type', () => {
    const errs = validateDomainSemantics({
      runtimeStates: { Known: {} },
      operationRequirements: {
        someOp: {
          valueBindings: { 'request.foo': 'semantic:MissingKey' },
        },
      },
    });
    expect(errs.map((e) => e.invariant)).toContain('semanticBindingTargetResolves');
  });

  it('does not report semanticBindingTargetResolves for legacy state.parameter RHS', () => {
    const errs = validateDomainSemantics({
      runtimeStates: { Known: {} },
      operationRequirements: {
        someOp: {
          valueBindings: { 'request.foo': 'Known.id' },
        },
      },
    });
    expect(errs.map((e) => e.invariant)).not.toContain('semanticBindingTargetResolves');
  });

  it('reports disjunctionNotWitnessRedundant when a disjunction contains both X and witnesses(X)', () => {
    const errs = validateDomainSemantics({
      runtimeStates: { ProcessDefinitionDeployed: {} },
      // Declare ProcessDefinitionKey as a capability so disjunctionMemberResolves
      // doesn't also fire — this fixture must violate exactly one invariant.
      capabilities: { ProcessDefinitionKey: {} },
      semanticTypes: {
        ProcessDefinitionKey: { witnesses: 'ProcessDefinitionDeployed' },
      },
      operationRequirements: {
        createProcessInstance: {
          disjunctions: [['ProcessDefinitionKey', 'ProcessDefinitionDeployed']],
        },
      },
    });
    expect(errs.map((e) => e.invariant)).toContain('disjunctionNotWitnessRedundant');
    expect(errs.map((e) => e.invariant)).not.toContain('disjunctionMemberResolves');
  });

  it('reports disjunctionMemberResolves when a disjunction member is undeclared', () => {
    const errs = validateDomainSemantics({
      runtimeStates: { Known: {} },
      operationRequirements: {
        someOp: {
          disjunctions: [['Known', 'AlsoUnknown']],
        },
      },
    });
    expect(errs.map((e) => e.invariant)).toContain('disjunctionMemberResolves');
  });

  it('accepts the real path-analyser/domain-semantics.json', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const file = path.resolve(import.meta.dirname, '../../path-analyser/domain-semantics.json');
    const raw = await fs.readFile(file, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    expect(validateDomainSemantics(parsed)).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // globalContextSeeds: input-validation guards (#87 review)
  //
  // Every seed entry is interpolated directly into emitted TS source — these
  // checks make config-driven code injection structurally impossible and
  // pre-empt collisions in the emitted prologue / multipart strip branch.
  // -------------------------------------------------------------------------

  it('reports globalContextSeedBindingUnique when two seeds share a binding', () => {
    const errs = validateDomainSemantics({
      globalContextSeeds: [
        { binding: 'tenantIdVar', fieldName: 'tenantId', seedRule: 'tenantIdVar' },
        { binding: 'tenantIdVar', fieldName: 'otherField', seedRule: 'tenantIdVar' },
      ],
    });
    expect(errs.map((e) => e.invariant)).toContain('globalContextSeedBindingUnique');
  });

  it('reports globalContextSeedFieldNameUnique when two seeds share a fieldName', () => {
    const errs = validateDomainSemantics({
      globalContextSeeds: [
        { binding: 'tenantIdVar', fieldName: 'tenantId', seedRule: 'tenantIdVar' },
        { binding: 'orgIdVar', fieldName: 'tenantId', seedRule: 'orgIdVar' },
      ],
    });
    expect(errs.map((e) => e.invariant)).toContain('globalContextSeedFieldNameUnique');
  });

  it('reports globalContextSeedSafeIdentifier when binding is not a safe identifier', () => {
    const errs = validateDomainSemantics({
      globalContextSeeds: [
        { binding: 'tenant-id', fieldName: 'tenantId', seedRule: 'tenantIdVar' },
      ],
    });
    expect(errs.map((e) => e.invariant)).toContain('globalContextSeedSafeIdentifier');
  });

  it('reports globalContextSeedSafeIdentifier when fieldName is not a safe identifier', () => {
    const errs = validateDomainSemantics({
      globalContextSeeds: [
        { binding: 'tenantIdVar', fieldName: 'tenant-id', seedRule: 'tenantIdVar' },
      ],
    });
    expect(errs.map((e) => e.invariant)).toContain('globalContextSeedSafeIdentifier');
  });

  it('reports globalContextSeedSafeIdentifier when seedRule is not a safe identifier', () => {
    const errs = validateDomainSemantics({
      globalContextSeeds: [
        { binding: 'tenantIdVar', fieldName: 'tenantId', seedRule: 'rule with spaces' },
      ],
    });
    expect(errs.map((e) => e.invariant)).toContain('globalContextSeedSafeIdentifier');
  });

  it('reports globalContextSeedSentinelSafe when defaultSentinel contains a single quote', () => {
    const errs = validateDomainSemantics({
      globalContextSeeds: [
        {
          binding: 'tenantIdVar',
          fieldName: 'tenantId',
          seedRule: 'tenantIdVar',
          defaultSentinel: "it's broken",
        },
      ],
    });
    expect(errs.map((e) => e.invariant)).toContain('globalContextSeedSentinelSafe');
  });

  it('reports globalContextSeedSentinelSafe when defaultSentinel contains a newline', () => {
    const errs = validateDomainSemantics({
      globalContextSeeds: [
        {
          binding: 'tenantIdVar',
          fieldName: 'tenantId',
          seedRule: 'tenantIdVar',
          defaultSentinel: 'line1\nline2',
        },
      ],
    });
    expect(errs.map((e) => e.invariant)).toContain('globalContextSeedSentinelSafe');
  });

  it('rejects unknown properties on a globalContextSeeds entry (.strict())', () => {
    const errs = validateDomainSemantics({
      globalContextSeeds: [
        {
          binding: 'tenantIdVar',
          fieldName: 'tenantId',
          seedRule: 'tenantIdVar',
          unknownKey: 'oops', // typo or removed-but-still-in-config field
        },
      ],
    });
    // Strict-mode Zod surfaces a structural issue (not one of our named
    // cross-ref invariants), so the error list is non-empty even though no
    // cross-ref invariant fires.
    expect(errs.length).toBeGreaterThan(0);
  });
});
