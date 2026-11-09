# Design: productionize response-coverage measurement for `camunda-oca`

**Date:** 2026-11-09
**Status:** proposed (awaiting review)
**Scope tier:** generalize + floors + CI invariant (no Slack / issues / weekly report)

## Problem & intent

`scripts/e2e/hub_response_coverage.py` audits **response-contract completeness** — for every operation
in a config's bundled spec, does the generated suite assert every documented response (2xx/400/401/403/
404/409), send optional request fields, schema-validate success bodies, and cover lifecycle flows. It is
the data behind the weekly Hub report **and** the Hub CI invariant `response coverage does not regress`,
which ratchets Hub's numbers against `configs/camunda-hub/coverage-floors.json`.

Today this apparatus exists **only for `camunda-hub`**. The `camunda-oca` config has no completeness
measurement and no floors: `npm run coverage:report` measures only endpoint *presence* (does an op have
any test), never whether each test asserts the full contract. A one-off run (2026-11-09, both configs at
their pinned specs) quantified the gap — OCA is fully status-tested on **25/244 (10%)** of endpoints vs
Hub's **57/66 (86%)** — and, more importantly, established that the auditor **works unchanged against
OCA**: its built-in reconciliation gates (negative-test counts vs `COVERAGE.json`, positive assertions
found) passed for OCA.

**Intent:** make OCA's completeness **tracked and ratcheted**, the same way Hub's is, so it can't
silently regress and so future gap-closing work has a baseline to move. Measurement only — not an
alerting/reporting pipeline (that is a deliberately deferred, larger follow-up the OCA owners —
test-automation — would need to sign off).

### Success criteria
- Running the auditor with `--config camunda-oca` produces valid OCA numbers (already true from the
  one-off; to be made clean and permanent).
- A new CI invariant fails if OCA response coverage drops below pinned floors — running inside the
  **existing** OCA `regression` job, with **no** new CI step.
- Hub's existing invariant and weekly report are **behaviorally unchanged** (byte-identical output for
  `--config camunda-hub`).
- No parallel copy of the ~130-line floor-checking logic: OCA and Hub share one implementation.

### Non-goals
- No OCA Slack post, rolling issues, weekly-report workflow, or `page.html` rendering.
- No change to what OCA *tests* (no new conflict-replay / fixtures / optional-fields config). This PR
  measures and ratchets the status quo; closing the gaps is separate, later work.
- No change to the pinned OCA spec ref.

## Context that constrains the design

- The two configs run in **separate CI jobs** (`regression` for OCA, `hub-invariants` for Hub), each
  with only its own `generated/<config>/` output present. A single invariant that loops over both
  configs would fail in each job for the other config — so the per-config-file, `skipIf`-guarded
  structure must be preserved.
- `python3` is preinstalled on `ubuntu-latest`; the `hub-invariants` job already spawns it with **no**
  `setup-python` step. The OCA `regression` job (`runs-on: ubuntu-latest`, `timeout-minutes: 25`)
  already fetches the spec, regenerates both suites, and runs `npm test` → so the new OCA invariant runs
  with no CI edit.
- Both `regression-invariants.test.ts` files keep **local** `isRecord` / `readRequired` helpers and
  self-guard via `getActiveConfigName()` from `path-analyser/src/configResolver.js`. OCA's invariants
  execute under the default `CONFIG=camunda-oca`.
- AGENTS.md "Ask first: adding a parallel implementation" forbids a verbatim second copy of the Hub
  invariant body — the shared-helper approach is the sanctioned one.
- AGENTS.md "Behaviour tests are the regression guard": editing the Hub Layer-3 invariant is permitted
  here because it is a **behavior-preserving extraction**, which the plan proves by byte-diffing Hub's
  outputs and confirming the Hub invariant still passes identically.

## Design

### Part 1 — `hub_response_coverage.py`: finalize `--config` + de-Hub the labels

- Add `--config` (default `camunda-hub`, so every existing caller — the Hub invariant, the weekly
  workflow — is untouched). `CONFIG` is set from the parsed arg at the top of `main()`.
- Make the `positive-suppress.json` read optional: a config without the file suppresses nothing
  (`{'suppress': []}`). Use `pos_cov.get('explicitlySuppressedOpIds', [])`.
- Parametrize the four Hub-flavored strings off a small per-config label map so an OCA run is not
  mislabeled "Hub":
  - `matrix.md` H1 title (`## Hub API test coverage …`)
  - Slack headline (`:bar_chart: *Hub API test coverage* …`)
  - `GUIDE_URL` (Hub's doc) — per-config or omitted when a config has no guide
  - the ref-label prefix (`camunda-hub@<sha>`) → `<config-short>@<sha>`
  The `[hub-response-coverage]` issue titles and `issue.md`/`areas` outputs are **not** consumed by
  tier-1 (no OCA report) and are left as-is for now; the map leaves room to parametrize them when/if the
  report is productionized.
- **Hub-output invariance:** for `--config camunda-hub`, every output file (`summary.json`, `rows.json`,
  `matrix.md`, `slack.txt`, `issue.md`, `areas/*`, `history.*`) must be byte-identical to pre-change.
  The default-config label values ARE today's literals. The invariant reads only `summary.json`, which
  no label touches, so the CI guard is unaffected regardless.

### Part 2 — shared floor-checking helper (new file)

Extract the body of Hub's `it('response coverage does not regress (#628)')` into one exported function
in a new support module (proposed `tests/support/responseCoverageFloors.ts`; exact path finalized in the
plan against existing `tests/` layout):

```
assertResponseCoverageFloors(configName: string, floorsPath: string): void
```

It encapsulates, unchanged in behavior:
- spawn `python3 scripts/e2e/hub_response_coverage.py --config <configName> --out <tmp>`, assert exit 0;
- parse `summary.json`, assert it and the floors are records;
- the **floor-completeness** assertions (buckets must match the report's exactly; every
  `requestKindEndpoints` kind the suite generates must have a floor; every aliased
  `requestScenarioTypes` must have a floor; floors are non-negative integers);
- the **regression** checks (per-bucket asserted ≥ floor; the six single metrics; per-kind; per-type);
- the **zero-test** reconciliation (`zeroTestOperations` entries need a `reason`; actual zero-test ops
  must be listed; listed ops that now have tests must be removed).

Self-contained (its own `isRecord`/`readRequired`, or imported from a shared util — decided in the
plan). No behavioral change to any assertion.

### Part 3 — Hub invariant becomes a thin call

`configs/camunda-hub/regression-invariants.test.ts`:
```
it('response coverage does not regress (#628)', () =>
  assertResponseCoverageFloors('camunda-hub',
    join(REPO_ROOT, 'configs/camunda-hub/coverage-floors.json')));
```
Same test name, same floors file, same assertions. Verified by: Hub invariant still green, and the
helper's assertions are a move, not a rewrite.

### Part 4 — OCA floors file + OCA invariant

- New `configs/camunda-oca/coverage-floors.json`, derived **mechanically** from the 2026-11-09 OCA
  `summary.json` (deterministic generation ⇒ reproducible). A `$comment` documents provenance and the
  one-way-ratchet rule (mirroring Hub's file). `zeroTestOperations: []` (OCA has none).
- New `it('response coverage does not regress')` inside OCA's `describe` (guarded to `camunda-oca`),
  calling `assertResponseCoverageFloors('camunda-oca', join(REPO_ROOT, 'configs/camunda-oca/coverage-floors.json'))`.

#### OCA floor values (from the 2026-11-09 pinned-ref measurement)

`assertedByStatus` (the `[0]` of each `codes` pair): `2xx: 233, 400: 172, 401: 160, 403: 6, 404: 33, 409: 0`.
Single metrics: `fullyAssertedOperations: 25`, `requestChecksCovered: 121`, `optionalFieldsSent: 57`,
`lifecycleCreateCovered: 10`, `lifecycleRestoreCovered: 0`, `lifecycleEdgeCovered: 0`.
`requestKindEndpoints` and `requestScenarioTypes`: copied verbatim from the OCA summary (every kind/type
the OCA suite generates — the invariant fails if any is missing a floor). `zeroTestOperations: []`.

The plan will generate this file programmatically from `summary.json` rather than hand-transcribing, to
eliminate copy errors, then the invariant run confirms every value matches.

## Testing & verification (TDD order in the plan)

1. **Red/green on the extraction:** after Part 2–3, Hub invariant passes identically; a deliberately
   lowered Hub floor makes it fail with the same message as before (proves the helper actually guards).
2. **Hub byte-invariance:** diff Hub's full output dir (`--config camunda-hub`) before vs after Part 1 —
   must be empty.
3. **OCA floors correctness:** the new OCA invariant passes against freshly generated OCA output; then a
   deliberately raised OCA floor fails it, and a deliberately added bogus `requestKindEndpoints` floor
   with no matching kind fails the completeness check — proving the OCA guard is live, not vacuous.
4. **Lint/format:** `npm run lint` clean (zero warnings) on the TS; the Python script is outside Biome's
   scope but kept `python3 -c "import ast; ast.parse(...)"`-valid and run end-to-end.
5. **Local pre-push:** per AGENTS, regenerate OCA pipeline + `CONFIG=camunda-oca npm test`, and the Hub
   leg (sibling at pinned ref + `CONFIG=camunda-hub` generate + `npx vitest run configs/camunda-hub/regression-invariants.test.ts`).

## Risks & mitigations

- **Touching Hub's output / invariant** (the only behavior-risk surface) → byte-diff guard + Hub
  invariant must stay green; assertions are moved verbatim, not rewritten.
- **Floors that merely lock in a low number** → intended: a ratchet at the status quo. The low OCA
  numbers (e.g. 403: 6, 409: 0) are documented in the `$comment` as "current baseline, raise as gaps
  close," matching Hub's one-way-floor convention. They gate against *regression*, not against the
  existing state.
- **Floor drift when the OCA spec pin bumps** → same maintenance flow as Hub: a bump that changes numbers
  updates floors in the same PR (one-way; lowering requires justification). Called out in the `$comment`.
- **Helper location / import cycle** → the helper imports nothing from either config file; config files
  import the helper. No cycle.

## PR & commit structure

One PR, branch `claude/brave-shannon-xgtmzc`. Title (Conventional Commit, no scope):
`refactor: make response-coverage auditor config-parametric and track camunda-oca`.

Commits (structural separated from additive, per AGENTS):
1. `refactor: parametrize response-coverage auditor by config` — Part 1 (script) + Part 2 (helper) +
   Part 3 (Hub invariant → call). Behavior-preserving for Hub.
2. `test: add response-coverage floors + invariant for camunda-oca` — Part 4 (floors file + OCA
   invariant). Additive; OCA now tracked.

PR body: the measured OCA↔Hub baseline table, the "measures + ratchets status quo, does not change what
OCA tests" framing, and a note that Slack/issues/weekly-report productionization is deliberately out of
scope.
