# Recommendation — RDF / SPARQL spike

> Issue [#60](https://github.com/camunda/api-test-generator/issues/60).
> The brief offers three outcomes: **adopt RDF/SPARQL**, **adopt the
> modelling but reject RDF**, or **reject**.

## Recommendation: **Adopt the modelling. Defer RDF.**

The named entities and relations in
[`ontology/core.ttl`](./ontology/core.ttl) are the right abstractions
for this codebase whether or not the carrier is RDF. They should be
reified as first-class TS types in the production code now. The
question of whether to load them into a triple store and query them
with SPARQL is a separate, lower-stakes decision that can be deferred
until the multi-API generalisation is concretely on the roadmap.

This is "Option 2" in the brief's framing, with the explicit caveat
that the spike's findings are strong enough that Option 1 (full
adoption) becomes a low-risk follow-up, not a parallel track.

## What the spike actually found

### 1. Index parity passes — the modelling is faithful

[`parity/index-parity.ts`](./parity/index-parity.ts) re-derives all
three of the loader's reverse indexes (`bySemanticProducer`,
`domainProducers`, `providerMap`) from SPARQL queries and matches the
loader output for every well-formed key:

```
bySemanticProducer keys (loader=34, store=34)
domainProducers    keys (loader=5,  store=4)   ← see finding #4
providerMap        ops  (loader=61, store=61)
PARITY: PASS
```

The brief's Phase-3 checkpoint is satisfied. There is no disqualifying
friction at the data-layer boundary. The model is faithful enough that
any planner code reading these indexes today would behave identically
against the SPARQL-derived ones.

### 2. The named entities are the right ones, independent of RDF

The honest test the brief specifies — *"can the planner be written
referring only to terms in `core:`?"* — passes. Tracing every call
site that consumes the data layer
([second-api-sketch.md §"Honest test for the abstraction"](./second-api-sketch.md)):

- `bySemanticProducer[type]` → `core:produces`,
  `core:authoritativeProducer`, `core:operationId`
- `domainProducers[state]` → `core:producesState`,
  `core:operationId`
- `gatherDomainPrerequisites(seeds)` → `core:dependsOn+`
- value-binding resolution → `core:ValueBinding`,
  `core:bindsFromFieldPath`, `core:bindsToState`,
  `core:bindsToParameter`, `core:hasParameter`

None of these require Camunda-specific terms. The
[GitHub Issues + PRs sketch](./second-api-sketch.md) maps cleanly onto
the same core vocabulary without invasive changes (two SHACL
relaxations and one optional property addition for state invalidation
— all genuinely API-agnostic, none GitHub-specific).

This is the finding to act on first. The TS production code today
treats `bySemanticProducer`, `domainProducers`, and `providerMap` as
distinct hand-built records. Reifying them as queries over a single
typed `OperationGraph` (with named accessors corresponding to
`core:produces`, `core:producesState`, etc.) collapses the same
duplication that the brief identifies, **using TS** as the carrier.
The win is the abstraction, not RDF.

### 3. Declarative re-expressions surface latent silent-miss defects

[`queries/value-binding-drift.ts`](./queries/value-binding-drift.ts)
expresses the value-binding resolution as a SPARQL query. Running it
against the current pipeline state surfaces **four real
domain-semantics defects** that are silent today:

1. `createDeployment.response.deployments[].form.formKey` →
   `FormDeployed.formKey` — `FormDeployed` does not exist as a runtime
   state in `domain-semantics.json`.
2. `createDeployment.response.deployments[].processDefinition.processDefinitionKey`
   → `ProcessDefinitionKey.processDefinitionKey` —
   `ProcessDefinitionKey` is a semantic type, not a runtime state.
   Type-confusion in the binding RHS.
3. `createProcessInstance.response.processInstanceKey` →
   `ProcessInstanceExists.processInstanceKey` — `ProcessInstanceExists`
   declares `parameter: processDefinitionId`, not `processInstanceKey`.
   The state schema needs multi-parameter support, OR the binding is
   wrong.
4. `createProcessInstance.request.processDefinitionKey` →
   `ProcessDefinitionKey.processDefinitionKey` — same
   type-confusion as #2.

Each finding is also reproducible by running the parity checkpoint:
the loader silently writes `domainProducers["undefined"] = ["createDeployment"]`
because the `JobTypeValue` identifier in `domain-semantics.json` has
no `validityState`. The SHACL `IdentifierShape`
(`validityState minCount 1`) catches this at load time. The parity
script reports it under "LOADER-ONLY ARTIFACTS THE ONTOLOGY REJECTS".

These findings stand on the modelling alone. They do not require
running SPARQL in production — a TS-native rewrite of the loader that
emits the same shape would catch all five.

### 4. SPARQL property paths cleanly replace one hand-rolled traversal

[`queries/minimal-scenario-chain.ts`](./queries/minimal-scenario-chain.ts)
replaces `gatherDomainPrerequisites()` (the only multi-hop traversal in
the codebase, ~20 lines of hand-rolled DFS in
`scenarioGenerator.ts:1254`) with a single `core:dependsOn+` SPARQL
property path. This is the strongest single argument for the SPARQL
half of the proposal — but it's a one-call-site benefit. Every other
candidate-selection query the planner needs is satisfied by simple
joins that a typed TS index gives equally well.

## Why "modelling yes, RDF defer"

The brief is explicit that **multi-API generalisation is the
load-bearing argument for RDF specifically**:

> "RDF's namespacing and open-world composition are load-bearing for
> [the multi-API generalisation use case], not incidental."

That is true. If the multi-API roadmap firms up, RDF's URI namespacing
and graph-union semantics are genuine wins over a hand-rolled TS rule
DSL. But the multi-API target is still aspirational; the planner is
not yet shaped for a second API.

By contrast, the modelling findings (sections 2 and 3 above) are
valuable **today**, against the single Camunda API:

- Reifying `core:Operation`, `core:SemanticType`, `core:RuntimeState`,
  `core:ValueBinding`, `core:FieldPath` as TS types collapses the
  duplicated "what does this operation produce?" code paths between
  `graphLoader.ts`, `scenarioGenerator.ts`, and `index.ts` into one
  source of truth.
- Reifying `core:ValueBinding` with a typed `bindsFromFieldPath` and a
  multi-parameter `bindsToState`/`bindsToParameter` pair (validated
  against the canonical response shape at load time) eliminates the
  silent-miss class entirely. The four findings above become four
  load-time errors today, in TS, without a triple store.
- Replacing `gatherDomainPrerequisites` with a typed `dependsOn`
  closure helper is a 5-line refactor.

The cost of the TS-native modelling is one short refactor PR. The cost
of full RDF adoption is a runtime dependency on `oxigraph` (a WASM
binding), a build-time dependency on `rdf-validate-shacl`, an authoring
shift from JSON sidecars to Turtle, and the team carrying a second
query language alongside TypeScript — for a benefit that is currently
hypothetical (the second API).

The right move is to land the modelling now, monitor whether the
multi-API roadmap progresses, and revisit RDF once a concrete second
API is in flight. At that point the spike's adapters and queries
([`adapters/build-store.ts`](./adapters/build-store.ts),
[`parity/index-parity.ts`](./parity/index-parity.ts), the two query
files) become the starting point for the migration: every artifact
in this directory is reusable.

## Concrete follow-up plan (if the recommendation is accepted)

These are sized for normal PRs, not a spike rewrite.

1. **Reify `core:` entities as TS types.** Lift `Operation`,
   `SemanticType`, `RuntimeState`, `Capability`, `ValueBinding`,
   `FieldPath`, `Disjunction`, `Identifier`, `ArtifactKind` from the
   ontology into [`path-analyser/src/types.ts`](../../../path-analyser/src/types.ts)
   alongside the existing `OperationNode`. Keep the existing types as
   structural aliases initially.
2. **Multi-parameter `RuntimeState`.** Change
   `RuntimeStateSpec.parameter: string` to `parameters: string[]` (the
   value-binding drift findings #3 and the GitHub `IssueExists` example
   both demand this). Mechanical migration in `domain-semantics.json`.
3. **Typed `ValueBinding`.** Replace the
   `Record<string, string>` in `OperationDomainRequirements.valueBindings`
   with `ValueBinding[]` carrying parsed
   `{ direction, fieldPath, targetState, targetParameter }`. The
   parsing logic moves out of `index.ts:320-340` into the loader.
4. **Load-time validation.** Add the SHACL invariants from
   [`shapes/invariants.shapes.ttl`](./shapes/invariants.shapes.ttl) as
   TS assertions in the loader. Each one is one short function. The
   five findings above become test fixtures.
5. **Fix the four surfaced defects.** `FormDeployed` (add the state),
   `ProcessDefinitionKey.*` (correct the binding RHS to refer to a
   real state), `ProcessInstanceExists.processInstanceKey` (multi-param
   from #2), `JobTypeValue` (add `validityState`).
6. **Replace `gatherDomainPrerequisites` with a typed
   `dependsOnClosure(state)` helper** that walks the same edges
   `core:dependsOn+` would.
7. **Optional, separate decision: full RDF adoption.** Defer until a
   concrete second API enters the roadmap. The spike artifacts in this
   directory are the migration starting point.

## What the brief asked us to compare

| Dimension | Outcome |
|---|---|
| De-duplication: how many distinct code paths collapse? | **5 → 1** (loader index-build, planner reverse-index reads, value-binding parsing, prerequisite traversal, identifier resolution). All collapsible in TS without RDF; RDF is incidental. |
| Are the named entities ones we'd want even without RDF? | **Yes, unambiguously.** This is the spike's strongest finding and the basis for the recommendation. |
| Authoring experience for non-RDF-fluent contributors? | TTL is reasonable for vocabulary; SHACL shapes are harder than the equivalent TS validators; SPARQL is a real second language. **TS-native modelling avoids all three costs.** Defer until the multi-API roadmap makes them worthwhile. |
| Does the per-API ↔ core abstraction line hold? | **Yes.** [`camunda.ttl`](./ontology/camunda.ttl) and the [GitHub sketch](./second-api-sketch.md) introduce zero new properties. Per-API vocabulary = list of instances; core = list of relations. |
| Was index parity achievable? | **Yes**, plus the parity script surfaced one latent loader bug (`domainProducers["undefined"]`) the SHACL `IdentifierShape` would catch. |

## Decision

**Adopt the modelling. Defer RDF.** The spike has produced everything
needed for a follow-up modelling PR; the RDF adoption decision is
separable and lower-priority until multi-API is concrete.

If the team prefers a different read of the trade-off (e.g. "the
multi-API roadmap is firmer than the recommendation assumes; adopt
RDF now"), the spike artifacts support that path too — adapters,
queries, and parity test would feed directly into a production
migration.
