# Spec-coverage-analyzer (spike for #277)

> **Status:** spike. Reads an OpenAPI spec and emits a test plan, tagging
> each plan item as either computable from the spec alone or requiring
> domain knowledge (an ABox fact, named in the output).
>
> Independent of `coverage-analysis/`, which runs in the opposite
> direction — analysing what the generator already emits. This tool
> answers "what *should* be emitted, given the spec?".

Built per [#277](https://github.com/camunda/api-test-generator/issues/277).
Run against `spec/camunda-oca/bundled/rest-api.bundle.json` by default;
any OpenAPI 3.x spec works. Designed to be re-run on the Camunda Hub spec
when that lands.

## Files

| file | what it is |
|---|---|
| `build_plan.py` | The analyzer. Walks the spec, applies a rule table per operation, emits the artifacts below. No deps beyond the Python stdlib. |
| `plan.csv` | One row per `(operation, plan-item)` tuple. Columns: `operationId, method, path, kind, detail, computable, abox_fact`. |
| `plan.md` | Per-endpoint readable summary of the plan. |
| `needs-abox.md` | Aggregated view of plan items that need ABox facts, grouped by the missing fact. The shortest answer to "which ABox slices are most load-bearing?". |

## Run

```sh
python3 spec-coverage-analyzer/build_plan.py
# or against an arbitrary spec:
python3 spec-coverage-analyzer/build_plan.py path/to/openapi.json
```

Requires `spec/camunda-oca/bundled/rest-api.bundle.json` to exist locally
(see the main `README.md` for the `npm run fetch-spec` setup).

## Snapshot against the OCA spec

- **190 operations** × ~9.6 plan items each → **1817 plan items**
- **1027** computable from spec alone (56%)
- **790** need ABox / domain knowledge (44%)

The needs-ABox load is concentrated in a handful of facts:

| missing ABox fact | plan items it would unblock |
|---|---:|
| RBAC: permissions required per endpoint | 190 |
| spec-gap: which endpoints actually require auth | 189 |
| creation chain per identifier semantic-type | 120 |
| filter-field-semantics + sort-field-allowlist per entity | 106 |
| duplicatePolicy per endpoint (idempotent / conflict / replace) | 59 |
| consistency window per entity | 43 |
| scale thresholds + expected response time per entity | 43 |
| lifecycle state machine for this entity | 40 |

The 401 spec-gap result is itself a finding: the OCA spec declares
`securitySchemes` (BearerAuth, basicAuth) but only applies them on
`getAuthentication`. Every other operation in the spec doesn't actually
say it requires auth — even though the deployment behaviour is "auth
required". That's a spec/reality drift the analyzer surfaces as a
needs-ABox item ("encode deployment-mode auth applicability"), not a
spec-derivable 401.

## Rule table (current scope)

### Computable rules (1027 items / 14 kinds)

Derived purely from the spec:

- **happy-path** — every operation gets one.
- **bad-request:missing-required** — per required field on the request body.
- **bad-request:type-mismatch** — per typed property.
- **bad-request:format-invalid** — per `format`-tagged property.
- **bad-request:enum-violation** — per `enum`-tagged property.
- **bad-request:range-violation** — per property with `minimum`/`maximum`/`exclusive*`.
- **bad-request:additional-property** — per object schema with `additionalProperties: false`.
- **bad-request:oneof-violation** — per `oneOf`/`anyOf` schema.
- **404-not-found** — per path parameter (replace with fake-but-valid ID).
- **401-unauthorized** — per operation with declared `security` (currently only `getAuthentication` in OCA).
- **pagination-sort:request-shape** — per operation that declares `page`/`sort`/`limit` query params or top-level body fields.
- **filter:request-shape** — per request body with a `filter` property.
- **documented-XXX** — per non-2xx response code documented in the spec (500, 503, 504, 415, 406, …) but not already covered by a more specific rule.

### Needs-ABox rules (790 items / 9 kinds)

Derived per Josh's #277 framing — flagging the spec-uncomputable surface so the ABox gaps are visible:

- **401-unauthorized (spec-gap)** — spec declares `securitySchemes` but doesn't apply them. Needs: deployment-mode auth applicability per endpoint.
- **403-forbidden** — Needs: RBAC permissions per endpoint.
- **409-conflict** — for create-style and replace-style endpoints. Needs: `duplicatePolicy` (idempotent / conflict / replace).
- **business-entity-lifecycle** — flagged by three hypotheses: state-transition verbs in the path (`/cancel`, `/complete`, `/resolve`, `/migrate`), operationId prefixes (`activate*`, `complete*`, `resolve*`, `migrate*`, `cancel*`), or 409 on a non-collection POST. Needs: lifecycle state machine per entity.
- **prerequisite-resource** — flagged for every operation with at least one path param. Needs: creation chain per identifier semantic-type.
- **eventual-consistency** — flagged on every `/search` endpoint. Needs: consistency window per entity (or eventually-consistent flag).
- **scale-large-n** — flagged on every `/search` endpoint. Needs: scale thresholds + expected response time per entity.
- **cross-field-range** — flagged when the request body has paired `*Before` / `*After` fields. Needs: cross-field validation rules.
- **pagination-sort / filter behaviour-assertion** — flagged separately from the request-shape rule: emitting the field is computable, asserting result correctness (sort order, filter result) is not. Needs: filter-field semantics + sort-field allowlist per entity.

## Limitations (known scope cuts in the spike)

- **Shallow schema walk.** The walker resolves one level of `$ref` and looks at one level of `properties`. Nested objects, recursive schemas, and deeply nested `oneOf` branches are under-explored.
- **No idempotency-key detection.** Endpoints accepting `Idempotency-Key` headers aren't yet a separate plan-item kind.
- **No content-type / 415 detection.** Wrong-content-type plan items are not generated even when alternative content types are declared.
- **No 405 (method-not-allowed) generation.** Could enumerate undeclared methods per path; not in spike.
- **Cross-field range heuristic is naïve.** Only catches paired `*Before` / `*After` properties; cross-field rules between differently-named fields (e.g. `password ≠ username`) need explicit ABox.

## Next steps (per #277)

1. Land this spike for review against #277.
2. Pick the heaviest needs-ABox bucket and design the ABox slice (likely `duplicatePolicy` since Josh already sketched it in 8.8).
3. Wire the analyzer to read the ABox once a slice lands, so `409-conflict` items move from "needs ABox" to "covered by ABox fact, computable".
4. Cross-validate by running on the Camunda Hub spec — confirm the rule table generalises.
5. Repurpose `coverage-analysis/` (which analyses generator *output*) as a verification check: "does the generator emit what the analyzer says it should?".
