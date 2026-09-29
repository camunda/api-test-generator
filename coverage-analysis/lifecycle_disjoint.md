# Entity-lifecycle disjoint: generator vs upstream OCA

Answers @jwulf's ask on #279:
> Can you please analyse the disjoint between the 10 new generated tests and
> the ~30 tests in the OCA suite.

The 10 new generated tests are the entity-lifecycle suite under
`generated/camunda-oca/playwright/templates/EntityLifecycle/<Entity>.lifecycle.spec.ts`,
produced by the `EntityLifecycle` scenario template (#280). The ~30
upstream tests are the matching slice of category **A. Entity Lifecycle
(CRUD)** in [c8-orchestration-cluster-e2e-test-suite/coverage-analysis](https://github.com/camunda/camunda/tree/main/qa/c8-orchestration-cluster-e2e-test-suite/coverage-analysis)
(snapshot [camunda/camunda#53387](https://github.com/camunda/camunda/pull/53387)).

## The 10 generated tests

Each test runs the full lifecycle in **one** `test()` block:
`create → present → update → present → delete → absent`. One test per entity
spec; cluster-variables has two namespace variants (global / per-tenant).

| spec file | entity slug |
|---|---|
| `templates/EntityLifecycle/Authorization.lifecycle.spec.ts` | `authorization` |
| `templates/EntityLifecycle/Document.lifecycle.spec.ts` | `document` |
| `templates/EntityLifecycle/GlobalClusterVariable.lifecycle.spec.ts` | `cluster-variables` (global namespace) |
| `templates/EntityLifecycle/TenantClusterVariable.lifecycle.spec.ts` | `cluster-variables` (per-tenant namespace) |
| `templates/EntityLifecycle/GlobalTaskListener.lifecycle.spec.ts` | `global-task-listener` |
| `templates/EntityLifecycle/Group.lifecycle.spec.ts` | `group` |
| `templates/EntityLifecycle/MappingRule.lifecycle.spec.ts` | `mapping-rule` |
| `templates/EntityLifecycle/Role.lifecycle.spec.ts` | `role` |
| `templates/EntityLifecycle/Tenant.lifecycle.spec.ts` | `tenant` |
| `templates/EntityLifecycle/User.lifecycle.spec.ts` | `user` |

## Upstream's matching slice — 333 tests across the same 9 entities

Category A. Entity Lifecycle (CRUD), restricted to the 9 entities the
generator's EntityLifecycle template covers:

| entity | create | get | mutate | delete | search | observe-absence | negative | **total** |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| authorization | 10 | 1 | 5 | 3 | 6 | 0 | 53 | **78** |
| cluster-variables | 3 | 2 | 23 | 2 | 12 | 0 | 25 | **67** |
| document | 4 | 1 | 0 | 1 | 0 | 0 | 17 | **23** |
| global-task-listener | 3 | 0 | 2 | 1 | 5 | 1 | 18 | **30** |
| group | 1 | 1 | 1 | 1 | 2 | 0 | 11 | **17** |
| mapping-rule | 1 | 1 | 1 | 1 | 7 | 0 | 16 | **27** |
| role | 1 | 1 | 2 | 1 | 4 | 0 | 15 | **24** |
| tenant | 1 | 1 | 3 | 2 | 6 | 0 | 24 | **37** |
| user | 4 | 1 | 4 | 1 | 5 | 0 | 15 | **30** |
| **total** | **28** | **9** | **41** | **13** | **47** | **1** | **194** | **333** |

Josh's "~30" likely refers to the "core lifecycle slice" — one happy-path
test per CRUD step per entity. By that definition there are **43**
upstream tests (5 happy-path steps × 9 entities, minus a few entities
that lack mutate or search). The full upstream coverage of these 9
entities is 333 tests.

## What only the generator catches

1. **Full lifecycle as a single atomic flow.** Each generator test asserts
   `create → present → update → present → delete → absent` inside one
   `test()`. Upstream's 333 tests cover the same phases but **split across
   separate tests** — no upstream test asserts the entire chain in one
   go. This catches state-cleanup bugs where individual operations all
   pass in isolation but the end-to-end flow leaves orphaned state.
2. **observe-absence after delete on 9 entities.** Upstream has exactly
   **one** test in `observe-absence` form-step for these 9 entities
   (global-task-listener). The generator includes "observe absent" in
   every one of its 10 tests → +9 net observe-absence coverage.

## What only upstream catches

1. **Multiple happy-path variants per CRUD step.** Generator: 1 create
   per entity. Upstream:
   - `authorization` has **10** create tests (one per owner type: client,
     group, mapping-rule, role, user × single/multiple permissionTypes).
   - `cluster-variables` has **23** mutate tests (different field combos
     and namespace variants).
   - `user` has 4 create tests, 4 mutate tests.
2. **Search coverage.** Upstream has **47** happy-path search-related
   tests across these 9 entities (filter, pagination, sort). The
   generator's lifecycle emitter doesn't search at all. The generator's
   `feature` + `variant` emitters cover happy-path search separately,
   so this is only a "lifecycle slice" gap, not an overall gap.
3. **Negative paths.** Upstream has **194** negative tests across these
   9 entities (400/401/403/404/409). The generator's `request-validation`
   emitter covers the negative classes separately (≈1068 bad-request + 31
   not-found + 7 RBAC-deny, suite-wide). So:
   - 400 — generator has parallel coverage via `request-validation/unsecured/`.
   - 404 — generator emits fake-ID not-found tests (31 suite-wide).
   - 403 — generator emits RBAC-deny tests (`rbac/` profile, 7; read-side, WIP).
   - 401 — auth-absent capability present but 0 on the pinned spec (no
     `x-enforcement` annotations); activates on annotated specs.
   - 409 — no generator coverage yet. Tracked in #279, methodology in #277.

## True disjoint, summarised

| What it catches | Generator (10 lifecycle tests) | Upstream (333 tests) |
|---|:-:|:-:|
| Create works | ✓ (1 per entity) | ✓ (28 — multiple variants per entity) |
| Get works | ✓ (1 per entity) | ✓ (9) |
| Update works | ✓ (1 per entity) | ✓ (41 — heavy variant coverage on cluster-variables and authorization) |
| Delete works | ✓ (1 per entity) | ✓ (13) |
| Search works | — (not in lifecycle template) | ✓ (47) |
| Entity is observably gone after delete | ✓ (10 — in every test) | ⚠ (1 — only global-task-listener) |
| Full lifecycle as a single atomic flow | ✓ (each test = full chain) | ✗ |
| Create rejected with bad body (400) | (via `request-validation/`) | ✓ (many per entity) |
| Get / Update returns 404 for missing entity | ✗ | ✓ (many) |
| 401 unauthorized | ✗ | ✓ (many) |
| 403 forbidden | ✗ | ✓ (many) |
| 409 conflict on duplicate create | ✗ | ✓ (many) |

## Net assessment

- **Coverage breadth on the lifecycle slice**: upstream wins by roughly
  5–6×. 333 tests vs 10. Most of the upstream advantage is in negative
  paths (194) and search variants (47) — both of which are addressed by
  other generator emitters (`request-validation/` for 400; feature +
  variant for happy-path search). So the *unique-to-upstream* coverage
  on this slice is mostly 401/403/404/409 + per-entity create/update
  variants.
- **Coverage depth on the lifecycle slice**: generator wins on
  composite-flow assertion and observe-absence. Each generator test
  exercises the full state-transition chain — a class of bug
  (e.g. "delete returns 204 but record stays in the DB") that 333
  individual-step upstream tests don't catch.
- **Recommended next moves to close the lifecycle disjoint** (in priority order):
  1. 404 emitter — would add observe-absence + missing-entity coverage
     on get/update/delete across all entities (#279).
  2. Per-entity variant expansion for create — authorization's 10
     owner-type variants are real cases the generator's single create
     misses. Likely an ABox enrichment task (#277).
  3. 401/403/409 emitters — depend on deployment-mode and
     duplicatePolicy ABox slices (#277).
