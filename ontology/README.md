# Ontology

This directory contains the committed JSON Schema artefacts that
define the **TBox** (vocabulary / class definitions) of the
api-test-generator ontology.

The TypeScript sources of truth live under
[`path-analyser/src/ontology/`](../path-analyser/src/ontology/) — one
`*Schema.ts` file per slice. The JSON files under
[`vocabulary/`](./vocabulary/) are generated from them by
[`scripts/build-ontology.ts`](../scripts/build-ontology.ts) (`npm run
build:ontology`) so that **external SPARQL / SHACL / OWL / IDE
consumers can fetch a plain JSON Schema by URL** without first
building this repo.

A Layer-3 regression invariant in
[`configs/<config>/regression-invariants.test.ts`](../configs/camunda-oca/regression-invariants.test.ts)
fails if any committed JSON drifts from its TS source of truth, so the
generated artefacts cannot silently fall out of sync.

## Publishing

The JSON Schemas under `vocabulary/` are published to GitHub Pages by
the [`publish-ontology.yml`](../.github/workflows/publish-ontology.yml)
workflow on every push to `main` that touches the ontology surface.

Each TBox declares an absolute `$id` of the form:

```
https://camunda.github.io/api-test-generator/ns/v1/<slice>.schema.json
```

…and every per-config ABox under `configs/<config>/ontology/*.json`
uses the matching URL as its `$schema`. A structural Layer-3
invariant pins that convention so ad-hoc relative `$schema` paths
cannot creep back in.

A separate scheduled workflow
[`ontology-url-check.yml`](../.github/workflows/ontology-url-check.yml)
HEAD-checks every published URL weekly to catch a stuck publish
pipeline before external consumers notice the 404.

### One-time setup (repo admin)

GitHub Pages must be enabled with **Source = "GitHub Actions"**:

> Settings → Pages → Build and deployment → Source = GitHub Actions

Until this is set, the `publish-ontology.yml` `deploy` job fails with
`Get Pages site failed` — that is the expected, self-documenting
signal. No further configuration is required.

## Adding a new TBox slice

1. Add `path-analyser/src/ontology/<slice>Schema.ts` with the schema
   constant and a paired `renderSchema` wrapper. See the existing
   slices for the header conventions.
2. Register the slice in `scripts/build-ontology.ts` `ARTIFACTS`.
3. Run `npm run build:ontology` to emit
   `ontology/vocabulary/<slice>.schema.json`.
4. Add a corresponding ABox under `configs/<config>/ontology/<slice>.json`
   with `$schema` set to the canonical absolute URL.
5. Wire the loader + cross-ref module per Lift 15 / #255.
6. Add the slice's Layer-3 invariants in
   `configs/<config>/regression-invariants.test.ts`.

The next push to `main` touching `ontology/**` re-publishes the site.
