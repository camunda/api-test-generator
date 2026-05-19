# Generator coverage analysis

> **Status:** implementation-phase scaffolding. This directory exists to help
> assess what the generator currently produces while it's being built. Once the
> generator is delivered it can be deleted — the artifacts here are snapshots
> and are not maintained as part of the product.

Categorises the test files emitted under `generated/camunda-oca/playwright/` and
produces a coverage matrix in the same shape as
[`camunda/camunda/qa/c8-orchestration-cluster-e2e-test-suite/coverage-analysis/`](https://github.com/camunda/camunda/tree/main/qa/c8-orchestration-cluster-e2e-test-suite/coverage-analysis),
so the two suites can be diffed directly. Answers the questions in
[issue #275](https://github.com/camunda/api-test-generator/issues/275).

## Files

| file | what it is |
|---|---|
| `build_coverage.py` | Walks every generator test source, resolves each `operationId` against `spec/camunda-oca/bundled/rest-api.bundle.json`, classifies entity/operation/variant/category/form-step/prerequisite, and writes the artifacts below. |
| `tests.csv` | One row per `test()` declaration. Columns: `file, line, source, entity, category, operation, form_step, prerequisite, method, path, operationId, variants, test_name`. |
| `coverage_matrix.csv` | `entity × operation` grid with variant counts. Same columns as the upstream matrix. |
| `coverage_matrix.md` | Markdown view of the matrix: at-a-glance ✓ table + counts-per-cell. |
| `gaps.md` | Heuristic gap report: entities missing 401/403/400/404/409 coverage, missing observe-after-delete, search ops with no pagination/sort/filter. |
| `category_breakdown.md` | Per-category breakdown (Form, prerequisite, observation channel split, form-step counts, per-test table with `file:line`). Mirrors upstream `category_breakdown.md`. |

## Test sources scanned

The generator emits tests into three locations; `build_coverage.py` scans all of them:

| location | emitter | tag in `tests.csv` `source` column |
|---|---|---|
| `generated/camunda-oca/playwright/<operationId>.feature.spec.ts` | feature emitter (happy path + basic shape) | `feature` |
| `generated/camunda-oca/playwright/<operationId>.variant.spec.ts` | variant emitter (schema/input variations: `bpmn`, `oneOf …`, etc.) | `variant` |
| `generated/camunda-oca/playwright/edges/<EdgeName>.lifecycle.spec.ts` | edge lifecycle template (`establish → observe present → revoke → observe absent`) | `lifecycle` |
| `generated/camunda-oca/request-validation/<entity>-validation-api-tests.spec.ts` | request-validation emitter (negative schema cases, all bad-request) | `request-validation` |

## Regenerate

```sh
python3 coverage-analysis/build_coverage.py
```

No dependencies beyond the Python stdlib. Re-run after any change under
`generated/camunda-oca/playwright/` or the bundled OpenAPI spec.

## How tests are classified

- **Entity** — derived from the first path segment of the endpoint
  (`/jobs/...` → `job`, `/process-instances/...` → `process-instance`).
  Mapping is explicit (`SEGMENT_TO_ENTITY`) to preserve the few entities upstream
  keeps plural (`cluster-variables`, `decision-requirements`,
  `message-subscriptions`) and to fold `deployments` into `resource`.
- **Operation** — derived from the operationId prefix (`create*`, `delete*`,
  `update*`, `search*`/`list*`, `get*`/`fetch*`) with HTTP-method fallback.
- **Category** (A–O upstream buckets, plus a v2-only `P. Agent-Instance`) —
  derived from entity, with `assign*To*` / `unassign*From*` and
  `search*For(Group|Role|Tenant)` operations classified as
  `B. Membership/Association`.
- **Variant** — derived from the generator's test-name suffix:
  - `base` → `happy-path`
  - `bpmn` / `dmn` / `drd` / `form` / `path` / `cycle/*` / `oneOf *` → `data-driven`
  - `negative empty` → `observe-absence`
  - `variant-N - scenario` (dynamic name) → `unlabeled`
- **Form step** — derived from operation + variant
  (`create`, `observe-present-get`, `observe-present-search`, `mutate`, `delete`,
  `observe-absence`).
- **Prerequisite** — entity-based, copied from upstream's mapping; for
  membership ops it's parent + member (e.g. `tenant + client`).

## Comparison with upstream

Upstream snapshot:
[camunda/camunda#53387](https://github.com/camunda/camunda/pull/53387)
(head `7cf8bc1`). In its `coverage_matrix.csv` the `total` column equals
unique-test count; variant columns are label-occurrences, so a test tagged
`happy-path|filter` shows up in both.

|  | upstream | generator |
|---|---:|---:|
| Unique tests | 1001 | **1567** |
| Entities | 33 | 37 |
| Happy-path (occurrences) | 173 | 197 |
| Bad-request (400, occurrences) | 195 | **1037** |
| Unauthorized (401) | 165 | **0** |
| Not-found (404) | 127 | **0** |
| Filter | 85 | **0** |
| Pagination-sort | 53 | **0** |
| Conflict (409) | 31 | **0** |
| Forbidden (403) | 29 | **0** |
| Observe-absence | 2 | 38 |
| Data-driven / oneOf variants | 5 | **295** |

**The generator emits 566 more tests than upstream.** It massively exceeds
upstream on 400 bad-request coverage (the `request-validation` emitter alone
produces 1037 tests across 17 violation kinds: `additional-prop`,
`constraint-violation`, `enum-violation`, `format-invalid`, `missing-body`,
`missing-required`, `missing-required-combo`, `oneof-ambiguous`,
`oneof-cross-bleed`, `oneof-none-match`, `param-constraint-violation`,
`param-missing`, `param-type-mismatch`, `type-mismatch`, `union`,
`unique-items-violation`, and `additional-prop-general`).

The buckets where the generator currently emits zero tests:

- **401 unauthorized** (165 in upstream) — needs deployment-mode-aware auth
  context, see `camunda/camunda#52511`.
- **403 forbidden** (29 in upstream) — needs RBAC ABox + restricted-token
  test infrastructure.
- **404 not-found** (127 in upstream) — fake-ID variant on path params; computable.
- **409 conflict** (31 in upstream) — needs `duplicatePolicy` ABox slice
  (designed in 8.8, not yet landed; see #277).
- **Pagination + sort** (53 in upstream) — computable from declared params.
- **Filter** (85 in upstream) — computable from filter schemas on search ops.

See `gaps.md` for the categorised per-entity list.

## Limitations

- Variant classification depends on the generator's emitter suffix vocabulary.
  When emitters change names (or new ones are added) update `variants_of()` in
  `build_coverage.py`.
- The generator does not emit error-path tests (401/403/400/404/409) today, so
  every row in those columns is 0 — this is a generator capability gap, not a
  classifier limitation.
- Dynamic test names (`variant-N - scenario`) are bucketed as `unlabeled` because
  reading the test body would be required to refine them.
