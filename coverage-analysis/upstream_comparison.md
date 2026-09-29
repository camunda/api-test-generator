# Generator vs upstream OC e2e suite — coverage comparison

Compares the api-test-generator output (pinned OCA spec) against the upstream
**orchestration-cluster e2e test suite**
([`camunda/camunda` → `qa/c8-orchestration-cluster-e2e-test-suite/tests`](https://github.com/camunda/camunda/tree/main/qa/c8-orchestration-cluster-e2e-test-suite/tests)).

> **Manually maintained / one-shot.** Not produced by `build_coverage.py` — the
> upstream figures come from a sparse clone of `camunda/camunda@main` and a
> title/path classification (below). Refresh by re-running that assessment when
> the upstream suite or the generator moves materially.

Upstream is **hand-written** (no emitter); the generator is **spec-derived**.
Generator counts are status / request-shape assertions; upstream's are
behaviour / error-message assertions — equal buckets, different depth.

## By category (same A–P taxonomy as `category_breakdown.md`)

| Category | OCA (upstream) | Generator | Δ |
|---|---:|---:|---:|
| A. Entity Lifecycle (CRUD) | 366 | 344 | −22 |
| B. Membership/Association | 112 | 170 | +58 |
| C. Deployment Lifecycle | 113 | 161 | +48 |
| D. Process-Instance Lifecycle & Ops | 113 | 283 | +170 |
| E. Batch-Operation Lifecycle | 32 | 25 | −7 |
| F. User-Task Lifecycle | 44 | 71 | +27 |
| G. Job Lifecycle & Stats | 71 | 142 | +71 |
| H. Incident Lifecycle | 28 | 41 | +13 |
| I. Decision-Instance Lifecycle | 23 | 72 | +49 |
| J/K/L. Observation-only | 63 | 104 | +41 |
| M. Messaging/Signals | 29 | 70 | +41 |
| N. Engine Evaluation | 13 | 27 | +14 |
| O. System/Admin | 21 | 36 | +15 |
| P. Agent-Instance (new in v2) | 0 | 50 | +50 |
| UI / behaviour (no generator analog) | 222 | 0 | −222 |
| **Total** | **1250** | **1596** | |

## By status bucket

| Bucket | OCA (upstream) | Generator | Notes |
|---|---:|---:|---|
| bad-request (400) | 204 | 1068 | generator enumerates ~17 violation kinds per op |
| unauthorized (401) | 168 | 0 | dormant on pinned spec (no `x-enforcement`); ~188 on annotated specs |
| forbidden (403) | 29 | 7 | generator: RBAC read-side deny (WIP); write-side blocked upstream (camunda/camunda#54727) |
| not-found (404) | 123 | 31 | generator: fake-ID pattern (separate from 48 after-delete `observe-absence`) |
| conflict (409) | 30 | 0 | generator: needs a `duplicatePolicy` slice (#277) |
| positive / other | 696 | ~490 | not apples-to-apples — upstream's includes ~222 UI behaviour tests |

## Reading

- **Generator leads in almost every API category** — most of all `D. Process-Instance` (+170), `G. Job` (+71), `B. Membership` (+58), `I. Decision-Instance` (+49), `C. Deployment` (+48) — systematic per-op/per-field enumeration outproduces hand-written tests.
- **`P. Agent-Instance`: 50 vs 0** — a new v2 surface the generator covers and upstream hasn't authored yet.
- **Generator trails only in `A. CRUD` (−22)** and `E. Batch` (−7), where upstream has more hand-curated cases.
- **UI / behaviour (222, upstream-only)** — operate/tasklist/identity UI tests; the generator is API-only, so no analog. This is upstream's largest genuine coverage the generator structurally can't produce (not an API-test gap).
- On negatives: generator dominates **400** (5×) but trails on **401 / 403 / 404 / 409**, where upstream's identity-aware, hand-written cases are deeper.

## Method

- Sparse clone of `camunda/camunda@main`, path `qa/c8-orchestration-cluster-e2e-test-suite/tests` (183 spec files, 1255 `test()`/`it()`).
- **Category**: entity from the `api/v2/<entity>/` dir (or flat `<x>-api-tests.spec.ts`), mapped through the same `category_of()` taxonomy as `build_coverage.py`; membership reclassified per-test by title (`assign`/`unassign`/`member`/`collaborator`); `operate`/`tasklist`/`identity`/`common-flows` → UI/behaviour.
- **Status bucket**: parsed from test titles (upstream names API tests by status, e.g. "… - 403 Forbidden"); aligns with the older snapshot (204≈195, 168≈165, 123≈127, 30≈31, 29=29).
- Title-based, so a handful may be mis-bucketed, and "positive/other" is a catch-all (happy-path API + UI behaviour). ~5 of 1255 tests had non-standard title quoting and weren't parsed.
- Generator figures: the committed `tests.csv` (pinned OCA spec).
