import { deterministicSuffix } from './deterministicSuffix.js';
import { isJobActivatorOp } from './ontology/operationRoles.js';
import type {
  EndpointScenario,
  EndpointScenarioCollection,
  FeatureVariantSpec,
  OperationGraph,
  OperationNode,
  OperationRef,
  RequestOneOfGroupSummary,
} from './types.js';

interface FeatureCoverageOptions {
  maxOptionalPairs: number;
  includeAllOptionalsThreshold: number;
  generateNegative: boolean;
  requestVariants?: RequestOneOfGroupSummary[]; // injected extracted request variant groups
  // Cap total scenarios per endpoint for feature coverage
  maxScenariosPerEndpoint?: number;
  // #288 Phase 3b — the planner's authoritative scenario for this
  // endpoint, used as the source of `operations` and `bindings` for
  // every variant that inherits the chain (i.e. everything except
  // search-empty-negative). When omitted (legacy callers, tests),
  // variants fall back to the pre-3b blank-slate construction —
  // single-op chain, no prereq bindings — which keeps the function
  // usable in isolation but is not how the production pipeline calls
  // it.
  canonical?: EndpointScenario;
}

const DEFAULT_OPTS: FeatureCoverageOptions = {
  maxOptionalPairs: 20,
  includeAllOptionalsThreshold: 5,
  generateNegative: true,
  maxScenariosPerEndpoint: 35,
};

export function generateFeatureCoverageForEndpoint(
  graph: OperationGraph,
  endpointOpId: string,
  opts: Partial<FeatureCoverageOptions> = {},
): EndpointScenarioCollection {
  const endpoint = graph.operations[endpointOpId];
  const options = { ...DEFAULT_OPTS, ...opts };
  const required = [...endpoint.requires.required];
  const optional = [...endpoint.requires.optional];
  const variants: FeatureVariantSpec[] = [];

  // Artifact coverage: if domain has artifact rules for this operation, generate a base variant per rule
  const artifactRules = graph.domain?.operationArtifactRules?.[endpointOpId]?.rules || [];
  if (artifactRules.length) {
    for (const r of artifactRules) {
      variants.push({
        endpointId: endpointOpId,
        optionals: [],
        disjunctionChoices: [],
        artifactSemantics: [],
        expectedResult: 'nonEmpty',
        artifactRuleId: r.id,
        artifactKind: r.artifactKind,
      });
    }
  }

  // Base variant (minimal)
  // Generic base variant (only if no artifact rule already covers it)
  if (!artifactRules.length) {
    variants.push({
      endpointId: endpointOpId,
      optionals: [],
      disjunctionChoices: [],
      artifactSemantics: [],
      expectedResult: 'nonEmpty',
    });
  }

  // #162 PR 4 (suite-partition cut): optional-population scenarios
  // (single `opt=<sem>` and the `all optionals` combo) used to be
  // emitted here. They now live exclusively in the variant suite
  // (`generateOptionalSubShapeVariants`) so each suite has one
  // convention. The feature suite shrinks to: base, oneOf-minimal,
  // negative-empty, and duplicate-test carve-outs.

  // Negative empty-result variant: only for search-like endpoints (query style or jobActivator) with no required semantics
  const isSearchLike =
    endpoint.method.toUpperCase() === 'POST' &&
    (/\/search$/.test(endpoint.path) ||
      /search/i.test(endpoint.operationId) ||
      isJobActivatorOp(graph.domain, endpoint.operationId));
  if (options.generateNegative && required.length === 0 && isSearchLike) {
    variants.push({
      endpointId: endpointOpId,
      optionals: [],
      disjunctionChoices: [],
      artifactSemantics: [],
      expectedResult: 'empty',
      negative: true,
      // #288 Phase 3b — the search-empty-negative variant deliberately
      // omits chain prerequisites so the search returns empty at
      // runtime. This is the single case across the codebase where
      // canonical-chain inheritance is wrong.
      inheritChainPrereqs: false,
    });
  }

  // Schema-level negative variants (missing-required, wrong-type, oneOf union-all/pairwise)
  // are owned by the dedicated `request-validation` suite and intentionally NOT emitted here.
  // See https://github.com/camunda/api-test-generator/issues/27.

  // Duplicate invocation variants (only for create/command endpoints with duplicatePolicy or conditionalIdempotency)
  const meta = endpoint.operationMetadata;
  const cond = endpoint.conditionalIdempotency;
  // Conflict duplicate: expect second call 409 when duplicatePolicy === 'conflict'
  if (meta?.duplicatePolicy === 'conflict') {
    variants.push({
      endpointId: endpointOpId,
      optionals: [],
      disjunctionChoices: [],
      artifactSemantics: [],
      expectedResult: 'error',
      negative: true,
      duplicateTest: { mode: 'conflict', policy: meta.duplicatePolicy, secondStatus: 409 },
    });
  }
  // Conditional idempotency duplicate: second call should be ignored (reuse 200 with same response semantics)
  if (cond && cond.duplicatePolicy === 'ignore') {
    variants.push({
      endpointId: endpointOpId,
      optionals: [],
      disjunctionChoices: [],
      artifactSemantics: [],
      expectedResult: 'nonEmpty',
      duplicateTest: { mode: 'conditional', policy: cond.duplicatePolicy, secondStatus: 200 },
    });
  }

  // Request oneOf variants (minimal per variant)
  if (options.requestVariants?.length) {
    for (const group of options.requestVariants) {
      for (const v of group.variants) {
        variants.push({
          endpointId: endpointOpId,
          optionals: [],
          disjunctionChoices: [],
          artifactSemantics: [],
          expectedResult: 'nonEmpty',
          requestVariantGroup: group.groupId,
          requestVariantName: v.variantName,
          requestVariantRichness: 'minimal',
        });
        // #162 PR 4 (suite-partition cut): the `<variant>:rich` shape
        // (oneOf variant with all optional fields populated) used to be
        // emitted here as well. It is now owned by the variant suite
        // alongside other populated-optional scenarios; the feature
        // suite keeps only the minimal-required oneOf variant per group.
      }
      // oneOf union-all/pairwise negatives are owned by the request-validation suite
      // (see issue #27); intentionally not emitted here.
    }
  }

  let scenarios: EndpointScenario[] = variants.map((v, i) =>
    buildScenarioFromVariant(graph, endpointOpId, v, i + 1, options.canonical),
  );
  // Enforce global cap per endpoint
  const cap = options.maxScenariosPerEndpoint ?? 35;
  if (scenarios.length > cap) scenarios = scenarios.slice(0, cap);

  return {
    endpoint: toRef(endpoint),
    requiredSemanticTypes: required,
    optionalSemanticTypes: optional,
    scenarios,
    unsatisfied: false,
  };
}

function buildScenarioFromVariant(
  graph: OperationGraph,
  endpointId: string,
  variant: FeatureVariantSpec,
  index: number,
  canonical: EndpointScenario | undefined,
): EndpointScenario {
  const endpoint = graph.operations[endpointId];
  // #288 Phase 3b — inherit the planner's canonical chain (operations
  // + bindings) unless the variant explicitly opts out
  // (`inheritChainPrereqs: false`, currently only the
  // search-empty-negative case). This replaces the post-hoc
  // chain-graft + donor-binding-merge blocks that used to live in
  // `path-analyser/src/index.ts` immediately after this call.
  const inheritChain = variant.inheritChainPrereqs !== false;
  const opRefs: OperationRef[] =
    inheritChain && canonical && canonical.operations.length > 1
      ? canonical.operations.map((o) => ({ ...o }))
      : [toRef(endpoint)];
  const inheritedBindings: Record<string, string> =
    inheritChain && canonical?.bindings ? { ...canonical.bindings } : {};

  const produced = new Set<string>();
  // Variant bindings overlay onto inherited bindings — variant wins
  // on overlap, so negative-variant overrides like `${var}Nonexistent`
  // are preserved. Without the merge, the variant would lose the
  // planner's prereq mints (e.g. external-entity `clientIdVar`, the
  // foreign-key `tenantIdVar` for createTenantClusterVariable's path
  // param) and the emitter would render literal `${...Var}` at runtime.
  const bindings: Record<string, string> = { ...inheritedBindings };
  // Track synthetic bindings explicitly so the post-3b inherit doesn't
  // accidentally classify inherited canonical bindings (e.g. `tenantIdVar`)
  // as synthetic — `syntheticBindings` is specifically the negative-
  // variant `${var}Nonexistent` overrides, used downstream to drive
  // the emitter's "intentionally invalid lookup value" rendering.
  const syntheticKeys: string[] = [];
  // Synthetic bindings for negative variant
  if (variant.negative) {
    for (const o of variant.optionals) {
      const varName = `${camelLower(o)}Var`;
      const key = `${varName}Nonexistent`;
      bindings[key] =
        `${camelLower(o)}_nonexistent_${deterministicSuffix(`fc:neg:${endpoint.operationId}:${o}`)}`;
      syntheticKeys.push(key);
    }
  } else {
    for (const o of variant.optionals) {
      produced.add(o);
      const varName = `${camelLower(o)}Var`;
      bindings[varName] =
        `${camelLower(o)}_${deterministicSuffix(`fc:pos:${endpoint.operationId}:${o}`)}`;
    }
  }
  const scenario: EndpointScenario = {
    id: `feature-${index}`,
    name: buildFeatureScenarioName(endpoint.operationId, variant, index),
    description: buildFeatureScenarioDescription(endpoint, variant),
    operations: opRefs,
    producedSemanticTypes: [...produced],
    satisfiedSemanticTypes: [...new Set([...endpoint.requires.required, ...variant.optionals])],
    strategy: 'featureCoverage',
    variantKey: buildVariantKey(variant),
    expectedResult: { kind: variant.expectedResult },
    coverageTags: buildCoverageTags(variant),
    filtersUsed: variant.optionals,
    syntheticBindings: variant.negative ? syntheticKeys : undefined,
    bindings,
  };
  if (variant.duplicateTest) {
    scenario.duplicateTest = {
      mode: variant.duplicateTest.mode,
      policy: variant.duplicateTest.policy,
      secondStatus: variant.duplicateTest.secondStatus,
      keyFields: endpoint.conditionalIdempotency?.keyFields,
      windowField: endpoint.conditionalIdempotency?.window?.field,
    };
  }
  if (variant.requestVariantGroup && variant.requestVariantName) {
    scenario.requestVariants = [
      {
        groupId: variant.requestVariantGroup,
        variant: variant.requestVariantName,
        richness: variant.requestVariantRichness || 'minimal',
      },
    ];
  }
  // Tag artifact selection in scenario for downstream request planning
  if (variant.artifactRuleId || variant.artifactKind) {
    scenario.artifactsApplied = variant.artifactRuleId ? [variant.artifactRuleId] : [];
  }
  return scenario;
}

function buildVariantKey(v: FeatureVariantSpec): string {
  const parts: string[] = [];
  if (v.optionals.length) parts.push(`opt=${v.optionals.sort().join('+')}`);
  if (v.negative) parts.push('neg');
  if (v.requestVariantGroup) parts.push(`oneOf=${v.requestVariantGroup}:${v.requestVariantName}`);
  return parts.join('|') || 'base';
}

function buildCoverageTags(v: FeatureVariantSpec): string[] {
  const tags: string[] = [];
  for (const o of v.optionals) tags.push(`optional:${o}`);
  if (v.negative) tags.push('negative');
  if (v.requestVariantGroup) tags.push(`oneOf:${v.requestVariantGroup}:${v.requestVariantName}`);
  return tags;
}

function buildFeatureScenarioName(
  operationId: string,
  v: FeatureVariantSpec,
  index: number,
): string {
  if (v.duplicateTest) {
    if (v.duplicateTest.mode === 'conflict')
      return `${operationId} - duplicate conflict (${index})`;
    if (v.duplicateTest.mode === 'conditional')
      return `${operationId} - conditional duplicate ignore (${index})`;
  }
  if (v.artifactRuleId) return `${operationId} - ${v.artifactRuleId} (${index})`;
  if (v.negative) return `${operationId} - negative empty (${index})`;
  if (v.requestVariantGroup) {
    const base = `${operationId} - oneOf ${v.requestVariantGroup} ${v.requestVariantName}`;
    return v.requestVariantRichness === 'rich' ? `${base} rich (${index})` : `${base} (${index})`;
  }
  if (v.optionals.length === 0) return `${operationId} - base (${index})`;
  if (v.optionals.length === 1) return `${operationId} - with ${v.optionals[0]} (${index})`;
  return `${operationId} - with ${v.optionals.length} optionals (${index})`;
}

function buildFeatureScenarioDescription(endpoint: OperationNode, v: FeatureVariantSpec): string {
  const base = `Invoke ${endpoint.operationId} (${endpoint.method.toUpperCase()} ${endpoint.path})`;
  if (v.duplicateTest) {
    if (v.duplicateTest.mode === 'conflict')
      return `${base} twice with identical payload expecting second ${v.duplicateTest.secondStatus || 409} due to duplicatePolicy=conflict.`;
    if (v.duplicateTest.mode === 'conditional')
      return `${base} twice with identical key fields triggering conditional idempotency (duplicatePolicy=ignore) expecting second ${v.duplicateTest.secondStatus || 200} with no side-effects.`;
  }
  if (v.artifactRuleId) return `${base} deploying ${v.artifactRuleId.toUpperCase()} artifact.`;
  if (v.negative)
    return `${base} expecting empty result set (querying with filters / identifiers that match no existing resources).`;
  if (v.requestVariantGroup) {
    if (v.requestVariantRichness === 'rich')
      return `${base} using oneOf group '${v.requestVariantGroup}' variant '${v.requestVariantName}' with all optional fields present.`;
    return `${base} using oneOf group '${v.requestVariantGroup}' variant '${v.requestVariantName}' with minimal required fields.`;
  }
  if (v.optionals.length === 0) return `${base} with only required semantics.`;
  if (v.optionals.length === 1) return `${base} including optional semantic '${v.optionals[0]}'.`;
  return `${base} including all ${v.optionals.length} optional semantics: ${v.optionals.join(', ')}.`;
}

function camelLower(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

function toRef(op: {
  operationId: string;
  method: string;
  path: string;
  eventuallyConsistent?: boolean;
}): OperationRef {
  return {
    operationId: op.operationId,
    method: op.method,
    path: op.path,
    eventuallyConsistent: op.eventuallyConsistent,
  };
}
