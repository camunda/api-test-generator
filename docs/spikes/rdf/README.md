# Spike: RDF / SPARQL as a unifying query layer

Tracking issue: [#60](https://github.com/camunda/api-test-generator/issues/60)

This directory is the spike workspace. **Throwaway code; clarity over polish.**
The recommendation in [`RECOMMENDATION.md`](./RECOMMENDATION.md) is the
deliverable; everything else is the working that backs it.

## Layout

| Path | What lives here |
|---|---|
| [`ontology/`](./ontology/) | Turtle ontology (core API-agnostic + Camunda vocabulary) |
| [`shapes/`](./shapes/) | SHACL shapes pinning structural invariants the codebase enforces procedurally today |
| [`adapters/`](./adapters/) | One-shot scripts: existing JSON / OpenAPI → triples |
| [`parity/`](./parity/) | Index-parity tests: façade-over-triple-store output vs current `graphLoader.ts` output |
| [`queries/`](./queries/) | The two declarative re-expressions (value-binding drift; minimal scenario-chain candidates) |
| [`second-api-sketch.md`](./second-api-sketch.md) | Paper sketch of a second API's vocabulary against the core ontology |
| [`RECOMMENDATION.md`](./RECOMMENDATION.md) | Adopt / adopt-modelling-only / reject |

## Triple store

`oxigraph` (npm) for SPARQL 1.1 incl. property paths. `rdf-validate-shacl`
for SHACL (oxigraph does not ship SHACL). Both pure-Node, in-process,
offline. The triple store is **derived state**: rebuilt on every run from
the bundled spec + sidecars; never persisted.

## How to run the spike artefacts

```bash
# Materialise triples from current data sources (writes spike/out/*.ttl):
npx tsx docs/spikes/rdf/adapters/run-all.ts

# Index-parity check (the go/no-go checkpoint):
npx tsx docs/spikes/rdf/parity/index-parity.ts

# Declarative re-expressions:
npx tsx docs/spikes/rdf/queries/value-binding-drift.ts
npx tsx docs/spikes/rdf/queries/minimal-scenario-chain.ts
```

The adapters and queries do **not** wire into the production pipeline.
They read the same input files (`path-analyser/dist/...` / regenerated
artefacts) and assert the model is faithful.
