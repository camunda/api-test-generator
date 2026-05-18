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
| `build_coverage.py` | Walks the generated specs, resolves each `operationId` against `spec/camunda-oca/bundled/rest-api.bundle.json`, classifies entity/operation/variant/category/form-step/prerequisite, and writes the artifacts below. |
| `tests.csv` | One row per `test()` declaration. Columns: `file, line, entity, category, operation, form_step, prerequisite, method, path, operationId, variants, test_name`. |
| `coverage_matrix.csv` | `entity × operation` grid with variant counts. Same columns as the upstream matrix. |
| `coverage_matrix.md` | Markdown view of the matrix: at-a-glance ✓ table + counts-per-cell. |
| `gaps.md` | Heuristic gap report: entities missing 401/403/400/404/409 coverage, missing observe-after-delete, search ops with no pagination/sort/filter. |
| `category_breakdown.md` | Per-category breakdown (Form, prerequisite, observation channel split, form-step counts, per-test table with `file:line`). Mirrors upstream `category_breakdown.md`. |

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

## Comparison with upstream (snapshot at the time these files were generated)

|  | upstream | generator |
|---|---:|---:|
| Unique tests | 1001 | 518 |
| Entities | 33 | 37 |
| Happy-path | 173 | 185 |
| Negative (400/401/403/404/409) | 575 | **0** |
| Pagination-sort + filter | 138 | **0** |
| Observe-absence | 2 | 26 |
| Data-driven / oneOf variants | 5 | **295** |

The ~483-test gap is concentrated in **negative paths** (575 tests missing) and
**search refinement** (138 tests missing). The generator already exceeds upstream
on input-shape variants (`data-driven` +290) and `observe-absence` (+24).
See `gaps.md` for the categorised list.

## Limitations

- Variant classification depends on the generator's emitter suffix vocabulary.
  When emitters change names (or new ones are added) update `variants_of()` in
  `build_coverage.py`.
- The generator does not emit error-path tests (401/403/400/404/409) today, so
  every row in those columns is 0 — this is a generator capability gap, not a
  classifier limitation.
- Dynamic test names (`variant-N - scenario`) are bucketed as `unlabeled` because
  reading the test body would be required to refine them.
