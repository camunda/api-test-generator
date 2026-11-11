# OCA response-coverage measurement parity — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `camunda-oca` response-contract completeness tracked and ratcheted by the same auditor + CI-invariant + floors mechanism that already guards `camunda-hub`.

**Architecture:** Config-parametrize the auditor script (`--config`, default unchanged), extract Hub's floor-checking invariant body into one shared test helper both configs call, and add an OCA `coverage-floors.json` + an OCA invariant. OCA's new invariant runs inside the existing OCA `regression` CI job (python3 is on the runner; the job already regenerates both suites and runs `npm test`). No CI-workflow change.

**Tech Stack:** Python 3 (auditor script, outside Biome's scope), TypeScript + Vitest (Layer-3 invariants), Biome (lint/format).

**Spec:** `docs/superpowers/specs/2026-11-09-oca-response-coverage-parity-design.md`

## Global Constraints

- Node `>=22`. Run all `npm`/`tsc` from the repo root.
- Generation is deterministic under `TEST_SEED=snapshot-baseline`; floor values are byte-reproducible.
- Biome: 2-space indent, single quotes, `bracketSpacing:false`, `trailingComma:"all"`, line width 100. `npm run lint` must report **zero** warnings/infos. No `as T` outside imports/`as const`; no `any`.
- Conventional Commits, no scope (`fix:` not `fix(x):`). Commit trailer on every commit:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01JSATyR81K9G3iodbwAsoC8`.
- Branch: `claude/brave-shannon-xgtmzc`. Never commit `generated/`, `spec/`, `dist/` (gitignored).
- Floors are **one-way**: raise to close a gap, never lower to pass CI. OCA floors are pinned at the 2026-11-09 pinned-ref baseline.
- The auditor's `--config` default stays `camunda-hub` so every existing caller (Hub invariant, weekly workflow) is untouched.

## Review Focus

- **Hub output drift from the label change** — a changed Slack/report string would silently alter the Hub weekly report. *Pinned by Task 1 Step 4 (byte-diff of Hub's full output dir = empty).*
- **Hub invariant pass/fail drift from the extraction** — a moved assertion that changes outcome. *Pinned by Task 2 Steps 5–7 (Hub invariant green before+after; live-guard proof).*
- **`positive-suppress.json` absent (OCA) crashes the auditor** — OCA has no such file. *Pinned by Task 1 Step 5 (OCA run exits 0).*
- **A future OCA scenario kind added with no floor passes CI silently** — the completeness guard must fire. *Pinned by Task 3 Step 7 (remove a kind floor → "no floor for" assertion fails).*
- **`requestScenarioTypes` floor wrong** (over-constrained by flooring raw types, or missing the aliased `body-top-type-mismatch`). *Pinned by Task 3 Steps 3–5 (floors file holds only aliased types; OCA invariant passes).*

---

### Task 1: Config-parametrize the auditor script

**Files:**
- Modify: `scripts/e2e/hub_response_coverage.py`
- No new test file (Python is outside the repo's test harness; verified behaviorally).

**Interfaces:**
- Produces: CLI `python3 scripts/e2e/hub_response_coverage.py --config <name> --out <dir>` (default `--config camunda-hub`). Writes `summary.json` (+ other reports) under `<dir>`. Consumed by Tasks 2–3.

- [ ] **Step 1: Baseline Hub output.** With Hub already generated (`generated/camunda-hub/` present), run the *current* script and save a reference:
  `python3 scripts/e2e/hub_response_coverage.py --out /tmp/cov-hub-before`

- [ ] **Step 2: Edit the script.** Apply these changes:
  - Add `global CONFIG` as the **first** line of `main()` (before the argparse default reads `CONFIG`), then `ap.add_argument('--config', default=CONFIG, help=...)`, and after `args = ap.parse_args()` set `CONFIG = args.config`. (The `global` must precede the default reference, or Python raises `SyntaxError: name 'CONFIG' is used prior to global declaration`.)
  - `suppressed = set(pos_cov.get('explicitlySuppressedOpIds', []))`.
  - Make `positive-suppress.json` optional:
    `supp_cfg = json.load(open(p)) if os.path.exists(p) else {'suppress': []}`.
  - Add a per-config label map and use it only in `matrix()` (H1 title), `slack()` (headline title, the `ref` prefix, and the guide line). Values:
    - `camunda-hub`: title `Hub API test coverage`, refPrefix `camunda-hub`, guideUrl = current `GUIDE_URL` (unchanged → Hub byte-identical).
    - `camunda-oca`: title `Orchestration Cluster API test coverage`, refPrefix `camunda-oca`, guideUrl `None` (omit the guide line).
    Leave the module `GUIDE_URL` constant and the `issue.md`/`areas` outputs as-is (not consumed in tier-1).

- [ ] **Step 3: Syntax-check.** `python3 -c "import ast,sys; ast.parse(open('scripts/e2e/hub_response_coverage.py').read())"` → no error.

- [ ] **Step 4: Prove Hub byte-identical.** Re-run default and diff the whole dir:
  `python3 scripts/e2e/hub_response_coverage.py --out /tmp/cov-hub-after && diff -r /tmp/cov-hub-before /tmp/cov-hub-after`
  Expected: **no output** (identical).

- [ ] **Step 5: Prove OCA runs.** With `generated/camunda-oca/` present, run
  `python3 scripts/e2e/hub_response_coverage.py --config camunda-oca --out /tmp/cov-oca`
  Expected: exit 0; `/tmp/cov-oca/summary.json` exists; `/tmp/cov-oca/matrix.md` line 1 says `Orchestration Cluster API test coverage`, not `Hub`.
  > Regenerate OCA first if needed: `CONFIG=camunda-oca TEST_SEED=snapshot-baseline npm run testsuite:generate && CONFIG=camunda-oca npm run generate:request-validation` (OCA spec must be bundled — `SPEC_REF=8e9f91dfd8a5955d7d5219339ebf0e811917c2c9 CONFIG=camunda-oca npm run fetch-spec:ref`).

- [ ] **Step 6: Commit.**
```bash
git add scripts/e2e/hub_response_coverage.py
git commit -m "refactor: make response-coverage auditor config-parametric"
```

---

### Task 2: Shared floor helper; Hub invariant calls it

**Files:**
- Create: `tests/support/responseCoverageFloors.ts`
- Modify: `configs/camunda-hub/regression-invariants.test.ts` (replace the body of `it('response coverage does not regress (#628)')` with a call; drop now-unused imports if any)
- Modify: `configs/camunda-hub/coverage-floors.json` (add two ceiling fields, both `0`)

**Interfaces:**
- Produces: `export function assertResponseCoverageFloors(configName: string, floorsPath: string, repoRoot: string): void`
- Consumes: the auditor CLI from Task 1 (`--config <configName>`).

- [ ] **Step 1: Hub invariant green (baseline).**
  Run: `npx vitest run configs/camunda-hub/regression-invariants.test.ts -t "response coverage does not regress"` (with Hub generated present)
  Expected: PASS. (Green/green discipline: records the behavior being preserved.)

- [ ] **Step 2: Create the helper.** `tests/support/responseCoverageFloors.ts` exporting `assertResponseCoverageFloors(configName, floorsPath, repoRoot)`. Move the **entire** `try { … } finally { rmSync(out, …) }` body of the Hub invariant (current `configs/camunda-hub/regression-invariants.test.ts` lines ~942–1096) into it, with these parameterizations and no other logic change:
  - spawn args become `[join(repoRoot,'scripts/e2e/hub_response_coverage.py'), '--config', configName, '--out', out]`;
  - read floors from `floorsPath` (the `readRequired` + `JSON.parse` currently at the top of the `it`);
  - replace the two trailing hard assertions
    `expect(summary.requestNoTests).toEqual([])` and `expect(summary.shapeUnvalidated).toEqual([])`
    with ceiling-floor checks:
    `expect(arr(summary.requestNoTests).length <= num(floors.maxOperationsWithNoRequestTest), '<msg incl. the offenders>').toBe(true)` and the same for `summary.shapeUnvalidated` / `floors.maxShapeUnvalidated`.
  - include local `isRecord`/`readRequired` helpers (copied from the invariant file) and `import { expect } from 'vitest'` (called within an `it`, so `expect` is in context).

- [ ] **Step 3: Add the two ceiling fields to Hub's floors.** In `configs/camunda-hub/coverage-floors.json` add `"maxOperationsWithNoRequestTest": 0` and `"maxShapeUnvalidated": 0` (both current counts).

- [ ] **Step 4: Rewire the Hub invariant.** Replace the whole body of `it('response coverage does not regress (#628)', …)` with:
  `assertResponseCoverageFloors('camunda-hub', join(REPO_ROOT, 'configs/camunda-hub/coverage-floors.json'), REPO_ROOT);`
  Remove imports left unused in the file (e.g. `spawnSync`, `mkdtempSync`, `rmSync`, `tmpdir`) **only if** no other `it` in the file still uses them — grep first.

- [ ] **Step 5: Lint + typecheck.**
  Run: `npm run lint && npx tsc --noEmit -p tests/tsconfig.json`
  Expected: zero warnings; typecheck passes.

- [ ] **Step 6: Hub invariant still green (green/green).**
  Run: `npx vitest run configs/camunda-hub/regression-invariants.test.ts -t "response coverage does not regress"`
  Expected: PASS (identical outcome to Step 1).

- [ ] **Step 7: Prove the guard is live.** Temporarily lower one Hub floor (e.g. `assertedByStatus.403` → 1), re-run Step 6 → FAIL with `response coverage dropped below its floor`. Revert the floor.

- [ ] **Step 8: Commit.**
```bash
git add tests/support/responseCoverageFloors.ts configs/camunda-hub/regression-invariants.test.ts configs/camunda-hub/coverage-floors.json
git commit -m "refactor: extract shared response-coverage floor helper"
```

---

### Task 3: OCA floors file + OCA invariant

**Files:**
- Create: `configs/camunda-oca/coverage-floors.json`
- Modify: `configs/camunda-oca/regression-invariants.test.ts` (import the helper; add one `it` inside a `describeForThisConfig` block)

**Interfaces:**
- Consumes: `assertResponseCoverageFloors(...)` (Task 2); the auditor `--config camunda-oca` (Task 1).

- [ ] **Step 1: Create `configs/camunda-oca/coverage-floors.json`** with exactly these pinned-baseline values (plus a `$comment` mirroring Hub's, noting provenance = 2026-11-09 pinned OCA ref `8e9f91df`, the one-way-ratchet rule, and that a spec-pin bump updates floors in the same PR):
```json
{
  "assertedByStatus": { "2xx": 233, "400": 172, "401": 160, "403": 6, "404": 33, "409": 0 },
  "optionalFieldsSent": 57,
  "requestChecksCovered": 121,
  "fullyAssertedOperations": 25,
  "lifecycleCreateCovered": 10,
  "lifecycleRestoreCovered": 0,
  "lifecycleEdgeCovered": 0,
  "maxOperationsWithNoRequestTest": 4,
  "maxShapeUnvalidated": 28,
  "requestKindEndpoints": {
    "additional-prop": 85, "additional-prop-general": 35, "auth-absent": 239, "auth-deny": 7,
    "auth-invalid": 239, "constraint-violation": 35, "enum-violation": 59, "explicit-null-required": 46,
    "format-invalid": 4, "malformed-json-body": 121, "missing-body": 57, "missing-required": 102,
    "missing-required-combo": 16, "not-found-fake-id": 33, "oneof-ambiguous": 4, "oneof-cross-bleed": 4,
    "oneof-none-match": 4, "pagination-cursor-invalid": 46, "pagination-limit-invalid": 47,
    "pagination-offset-past-total": 47, "param-constraint-violation": 95, "param-enum-violation": 1,
    "param-missing": 3, "param-type-mismatch": 9, "type-mismatch": 124, "union": 4, "unique-items-violation": 10
  },
  "requestScenarioTypes": { "body-top-type-mismatch": 121 },
  "zeroTestOperations": []
}
```
  > Provenance check (don't hand-transcribe blind): regenerate OCA, run `--config camunda-oca`, and confirm each value equals the summary: `assertedByStatus[b] == summary.codes[b][0]`; the six singles == the `[0]` of their summary pairs / scalars; `requestKindEndpoints` == `summary.requestKindEndpoints` verbatim; `requestScenarioTypes` == `{k:v for k,v in summary.requestScenarioTypes if k not in summary.requestKindEndpoints}`; `maxShapeUnvalidated == len(summary.shapeUnvalidated)`; `maxOperationsWithNoRequestTest == len(summary.requestNoTests)`.

- [ ] **Step 2: Add the OCA invariant.** In `configs/camunda-oca/regression-invariants.test.ts`, add
  `import { assertResponseCoverageFloors } from '../../tests/support/responseCoverageFloors.js';`
  and, inside a `describeForThisConfig('bundled-spec invariants: response coverage', () => { … })` block:
```ts
it('response coverage does not regress', () =>
  assertResponseCoverageFloors(
    'camunda-oca',
    join(REPO_ROOT, 'configs/camunda-oca/coverage-floors.json'),
    REPO_ROOT,
  ));
```
  (`REPO_ROOT` and `join` already exist in the file.)

- [ ] **Step 3: Lint + typecheck.** `npm run lint && npx tsc --noEmit -p tests/tsconfig.json` → clean.

- [ ] **Step 4: OCA invariant passes.** With OCA generated present:
  Run: `CONFIG=camunda-oca npx vitest run configs/camunda-oca/regression-invariants.test.ts -t "response coverage does not regress"`
  Expected: PASS.

- [ ] **Step 5: Hub invariant unaffected.** Re-run Task 2 Step 6 (Hub leg) → still PASS.

- [ ] **Step 6: Prove the floor guard is live.** Temporarily raise `assertedByStatus.404` in the OCA floors to `34`, re-run Step 4 → FAIL (`404: 33 asserted, floor 34`). Revert.

- [ ] **Step 7: Prove the completeness guard is live.** Temporarily delete one key from OCA `requestKindEndpoints` (e.g. `type-mismatch`), re-run Step 4 → FAIL (`scenario kinds the suite generates but requestKindEndpoints has no floor for … type-mismatch`). Restore it.

- [ ] **Step 8: Commit.**
```bash
git add configs/camunda-oca/coverage-floors.json configs/camunda-oca/regression-invariants.test.ts
git commit -m "test: track camunda-oca response coverage with floors + invariant"
```

---

### Final verification (whole branch, before PR)

- [ ] OCA leg (pre-push equivalent): with OCA bundled+generated, `CONFIG=camunda-oca npm test` → green.
- [ ] Hub leg: sibling `../camunda-hub` at pinned `c833c789…`, `CONFIG=camunda-hub npm run fetch-spec` + generate, then `npx vitest run configs/camunda-hub/regression-invariants.test.ts` → green.
- [ ] `npm run lint` → zero warnings. Each workspace `tsc --noEmit` + `tests/tsconfig.json` → clean.
- [ ] Open PR on `claude/brave-shannon-xgtmzc` titled `refactor: make response-coverage auditor config-parametric and track camunda-oca`; body carries the OCA↔Hub baseline table and the "measures + ratchets status quo, does not change what OCA tests; Slack/issues/report deferred" framing.
