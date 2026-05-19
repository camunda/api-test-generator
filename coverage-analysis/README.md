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

The generator emits tests into five locations; `build_coverage.py` scans all of them:

| location | emitter | tag in `tests.csv` `source` column |
|---|---|---|
| `generated/camunda-oca/playwright/<operationId>.feature.spec.ts` | feature emitter (happy path + basic shape) | `feature` |
| `generated/camunda-oca/playwright/<operationId>.variant.spec.ts` | variant emitter (schema/input variations: `bpmn`, `oneOf …`, etc.) | `variant` |
| `generated/camunda-oca/playwright/edges/<EdgeName>.lifecycle.spec.ts` | edge lifecycle template (`establish → observe present → revoke → observe absent`) | `lifecycle` |
| `generated/camunda-oca/playwright/entities/<EntityName>.lifecycle.spec.ts` | entity lifecycle template (`create → present → update → present → delete → absent`) | `lifecycle` |
| `generated/camunda-oca/request-validation/<entity>-validation-api-tests.spec.ts` | request-validation emitter (negative schema cases, all bad-request) | `request-validation` |

## Regenerate

The analyser reads from `spec/camunda-oca/bundled/rest-api.bundle.json` and
`generated/camunda-oca/`, both of which are gitignored. On a fresh checkout
you need to populate them first:

```sh
npm install                          # one-time, brings in tooling deps
npm run pipeline                     # fetch spec + generate scenarios + emit feature/variant/lifecycle playwright tests
npm run generate:request-validation  # emit request-validation tests
python3 coverage-analysis/build_coverage.py
```

If `spec/camunda-oca/bundled/` and `generated/camunda-oca/` are already
populated locally, only the last command is required to refresh the
analysis. The analyser itself has no dependencies beyond the Python stdlib.

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
| Unique tests | 1001 | **1617** |
| Entities | 33 | 37 |
| Happy-path (occurrences) | 173 | 211 |
| Bad-request (400, occurrences) | 195 | **1071** |
| Pagination-sort (occurrences) | 53 | **85** |
| Filter (occurrences) | 85 | **196** |
| Observe-absence | 2 | 48 |
| Data-driven / oneOf variants | 5 | 302 |
| Unauthorized (401) | 165 | **0** |
| Not-found (404) | 127 | **0** |
| Conflict (409) | 31 | **0** |
| Forbidden (403) | 29 | **0** |

**The generator emits 616 more tests than upstream.** It dominates upstream on 400 bad-request coverage (the `request-validation` emitter alone produces 1071 tests across 17 violation kinds: `additional-prop`, `constraint-violation`, `enum-violation`, `format-invalid`, `missing-body`, `missing-required`, `missing-required-combo`, `oneof-ambiguous`, `oneof-cross-bleed`, `oneof-none-match`, `param-constraint-violation`, `param-missing`, `param-type-mismatch`, `type-mismatch`, `union`, `unique-items-violation`, and `additional-prop-general`).

**Pagination/filter counts need a caveat.** The generator's variant emitter sends `page: { after: cursor }` and `filter: { ... }` in request bodies on many search and batch-operation specs (detected by the classifier from the test body shape), so the variant column counts are non-zero. But these tests only assert `status === 200`; they do **not** assert pagination *correctness* (e.g. "page 2 yields the next N items, no overlap with page 1") or filter *correctness* (e.g. "filtering by `status=active` returns only active rows"). Upstream's 53 pagination and 85 filter tests are behaviour assertions, not request-shape assertions — so although the generator's pagination/filter counts now exceed upstream, the *semantic depth* is still much lower. The numeric comparison is a request-shape comparison, not a behaviour-coverage comparison.

The buckets where the generator currently emits zero tests:

- **401 unauthorized** (165 in upstream) — needs deployment-mode-aware auth context, see `camunda/camunda#52511`.
- **403 forbidden** (29 in upstream) — needs RBAC ABox + restricted-token test infrastructure.
- **404 not-found** (127 in upstream) — fake-ID variant on path params; computable.
- **409 conflict** (31 in upstream) — needs `duplicatePolicy` ABox slice (designed in 8.8, not yet landed; see #277).

See `gaps.md` for the categorised per-entity list.

## Limitations

- Variant classification depends on the generator's emitter suffix vocabulary.
  When emitters change names (or new ones are added) update `variants_of()` in
  `build_coverage.py`.
- The generator emits substantial 400/bad-request coverage via the
  `request-validation` emitter (1000+ tests across 17 violation kinds), and
  the variant emitter exercises pagination (`page.after` cursor) and filter
  request shapes on many search/batch-operation specs (detected by the
  classifier from the test body, not the test name). The buckets where the
  generator emits **zero** tests are: 401, 403, 404, 409. These are a
  generator capability gap — see `gaps.md` for the per-entity breakdown.
- The pagination-sort / filter counts in `coverage_matrix.csv` reflect
  request-shape coverage (the test sends `page: { ... }` or
  `filter: { ... }`), not behaviour coverage (the test asserts pagination
  or filter *results* are correct). Upstream's hand-written tests assert
  behaviour; the generator's only assert status code + response schema.
- Dynamic test names (`variant-N - scenario`) are bucketed as `unlabeled` because
  reading the test body would be required to refine them.
