import { deterministicSuffix } from './deterministicSuffix.js';
import type { ArtifactRegistryEntry, OperationGraph } from './types.js';

/**
 * Unified classification + value-resolution dispatch (#162 PR 3).
 *
 * Single chokepoint for "where does the value of this semantic come
 * from?" reasoning. Both `bindModelDerivedFromFixture` and
 * `bindClientMintedAttribute` route through this module so the
 * classification rules and per-classification value derivation live in
 * one place rather than being scattered across helper-specific
 * filters in `path-analyser/src/index.ts`.
 *
 * Scope of PR 3 (refactor only, no behaviour change):
 *
 *   - Classifications 3 (`clientMintedAttribute`) and 5 (`modelDerived`)
 *     return a concrete `value` ready to bind into `scenario.bindings`.
 *     These were the two cases the existing helpers handled inline.
 *
 *   - Classifications 1 (`producerBound`), 2 (`clientMintedIdentifier`)
 *     and 4 (`externalBoundary`) are recognised but have no value
 *     payload — they are bound by BFS in `scenarioGenerator.ts`. Calls
 *     for these classifications return only the `varName` so callers
 *     can verify "this is owned by another path" and bail out without
 *     overwriting the BFS-driven binding.
 *
 *   - PR 4 will extend the variant planner to call this module so
 *     populated optional sub-shapes flow through the same dispatch as
 *     feature-coverage scenarios.
 *
 *   - PR 5 will turn `'unclassified'` into a load-time diagnostic.
 */

export type SemanticClassification =
  | 'modelDerived'
  | 'clientMintedAttribute'
  | 'serverEmergent'
  | 'producerBound'
  | 'clientMintedIdentifier'
  | 'externalBoundary'
  | 'unclassified';

export type BoundInput =
  | { classification: 'modelDerived'; varName: string; value?: string }
  | { classification: 'clientMintedAttribute'; varName: string; value: string }
  | { classification: 'serverEmergent'; varName: string; value: string }
  | { classification: 'producerBound'; varName: string }
  | { classification: 'clientMintedIdentifier'; varName: string }
  | { classification: 'externalBoundary'; varName: string }
  | { classification: 'unclassified' };

/**
 * Classification precedence rules (#162).
 *
 * Tier 1 — explicit `domain.semanticTypes[T].kind` declarations win
 * regardless of graph indices:
 *
 *   - `kind: 'modelDerived'`                   → modelDerived
 *   - `kind: 'attribute' && clientMinted: true` → clientMintedAttribute
 *   - `kind: 'serverEmergent'`                 → serverEmergent
 *
 * Tier 1c — `serverEmergent` (#162 PR 5): server-minted lifecycle
 * identifiers that no client API call directly mints with a returned
 * key. Examples: `IncidentKey` (emerges from runtime failures),
 * `AuditLogKey` (side-effect of audited writes), `MessageSubscriptionKey`
 * (emerges from process deployment with message catch). The planner
 * binds a deterministic placeholder so search-filter request shapes
 * validate; the search returning empty is acceptable because the value
 * is a fabricated placeholder for a key the client could not have known.
 *
 * Tier 2 — graph-index classifications, in order:
 *
 *   - `graph.producersByType[T]`              → producerBound
 *   - `graph.establishersByType[T]`           → clientMintedIdentifier
 *   - `graph.externalEntityIdentifiers.has(T)` → externalBoundary
 *
 * Tier 3 — `unclassified` (PR 5 will fail the graph load on this).
 *
 * Why declarations win over indices: the domain-semantics file is the
 * authoritative source of truth for value origin. A semantic declared
 * `modelDerived` is intentionally sourced from a deployment artifact
 * even if some search op happens to surface it incidentally; treating
 * the incidental producer as authoritative would re-introduce the
 * coverage-gap class #162 was opened to fix.
 *
 * Pure function — no side effects, no IO, no caching. Safe to call any
 * number of times per (semantic, graph).
 */
export function classifySemantic(semantic: string, graph: OperationGraph): SemanticClassification {
  const decl = graph.domain?.semanticTypes?.[semantic];
  if (decl?.kind === 'modelDerived') return 'modelDerived';
  if (decl?.kind === 'attribute' && decl.clientMinted === true) {
    return 'clientMintedAttribute';
  }
  if (decl?.kind === 'serverEmergent') return 'serverEmergent';
  if (graph.producersByType?.[semantic]?.length) return 'producerBound';
  if (graph.establishersByType?.[semantic]?.length) return 'clientMintedIdentifier';
  if (graph.externalEntityIdentifiers?.has(semantic)) return 'externalBoundary';
  return 'unclassified';
}

/**
 * Resolve a `BoundInput` for a single (operationId, semantic) pair
 * through the classification dispatch.
 *
 * Behaviour-preserving with the pre-PR3 inline helpers:
 *
 *   - `modelDerived`: classification is reported regardless of whether a
 *     value can be resolved. The returned `value` is the FIRST entry of
 *     `fixture.providesValues[semantic]` when present, or `undefined`
 *     when the fixture is missing or has no entry for this semantic.
 *     Callers that mutate scenario state must guard on `value !== undefined`
 *     before binding, mirroring the pre-PR3 `if (!values?.length) continue`.
 *     Keeping the classification stable (rather than collapsing the
 *     missing-value case to `unclassified`) lets PR 5 distinguish a
 *     genuinely-unclassified semantic from a modelDerived semantic with
 *     missing fixture data.
 *
 *   - `clientMintedAttribute`: produces a deterministic
 *     `fc:cma:<sem>:<suffix>` token using
 *     ``deterministicSuffix(`fc:cma:${operationId}:${semantic}`)``,
 *     matching the byte-stable mint formula from
 *     `bindClientMintedAttribute` PR 2.
 *
 *   - producerBound / clientMintedIdentifier / externalBoundary: returned
 *     with `varName` only. Callers should treat these as "owned by BFS"
 *     and not overwrite the existing binding.
 *
 * The `varName` is `<camelCase(semantic)>Var` — the same convention every
 * downstream emitter and L3 invariant relies on.
 */
export function bindSemanticInput(args: {
  semantic: string;
  operationId: string;
  graph: OperationGraph;
  fixture?: ArtifactRegistryEntry;
}): BoundInput {
  const { semantic, operationId, graph, fixture } = args;
  const classification = classifySemantic(semantic, graph);
  const varName = `${camelCaseSemantic(semantic)}Var`;
  switch (classification) {
    case 'modelDerived': {
      const values = fixture?.providesValues?.[semantic];
      if (!values?.length) return { classification: 'modelDerived', varName };
      return { classification: 'modelDerived', varName, value: values[0] };
    }
    case 'clientMintedAttribute': {
      const value = `fc:cma:${camelCaseSemantic(semantic)}:${deterministicSuffix(
        `fc:cma:${operationId}:${semantic}`,
      )}`;
      return { classification: 'clientMintedAttribute', varName, value };
    }
    case 'serverEmergent': {
      // #162 PR 5: deterministic placeholder for server-minted lifecycle
      // keys. Distinct prefix (`fc:sem`) so a grep over emitted suites
      // can tell the two synthesised-value classes apart.
      const value = `fc:sem:${camelCaseSemantic(semantic)}:${deterministicSuffix(
        `fc:sem:${operationId}:${semantic}`,
      )}`;
      return { classification: 'serverEmergent', varName, value };
    }
    case 'producerBound':
    case 'clientMintedIdentifier':
    case 'externalBoundary':
      return { classification, varName };
    default:
      return { classification: 'unclassified' };
  }
}

// Local copy so this module has no dependency on path-analyser/src/index.ts
// (which would create an import cycle once index.ts re-imports the helpers
// that route through this module). Identical to the camelCase function in
// index.ts: lowercase the first character and leave the rest alone.
function camelCaseSemantic(semantic: string): string {
  return semantic.charAt(0).toLowerCase() + semantic.slice(1);
}
