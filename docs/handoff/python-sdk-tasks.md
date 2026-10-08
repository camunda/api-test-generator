# Python SDK emitter: handoff task list

This is a step-by-step task list for improving the `python-sdk` target, plus three **shared**
tasks (S1 to S3) that this group owns and that also help the C# target. Each task says exactly
which files to change, gives the code to paste, and lists the commands and expected output
that prove the task is done. Every code block below was applied, unit-tested and run against a
live broker (2026-09-24, `main` @ `76960e6`), then reverted so you can apply it yourself.

## Status (2026-10-09, branch `fix/python-sdk-emitter-fixes-handoff`)

**S1, S2, S3, P1, P2, P3 and the isFinal-by-index change are all committed and kept** — see the
baseline table below for the per-task measured effect (256 → 413 of 675). P4 is partially
satisfied by the red/green fixtures each task added; P5 is investigation-only and its findings
are now superseded by the item analysis below; **P6 is still an open owner decision**.

This branch adds three further commits on top of that series:

| Commit | Item | What it does |
|---|---|---|
| `47826c3` | 1 | `test(oca): accept await_eventually-wrapped calls in the python step invariant (#354)` — the invariant no longer fails on P3's `await_eventually(` wrapper. |
| `8422eaf` | 2 | `fix(path-analyser): seed nested enum leaves with a declared enum value` — kills the 30x `Unexpected value 'placeholder' for enum field 'role'` bucket. |
| `0ed2588` | 3 | `test(path-analyser): pin the position-based final request step with a Layer-2 fixture` — a non-vacuous guard for `fdf2766`. |

Items 4 to 8 were then investigated **proposal-only** (no repo code changes). Their measured
value-for-effort ranking, in the order the next session should implement them:

1. **Item 4 — `tag 'null'`** (the 17x `The provided tag 'null' is not valid` bucket). Worth
   **10-17 tests**, effort SMALL-MEDIUM, risk LOW-MODERATE, **no sign-off needed**. The only item
   that is simultaneously unblocked, cheap and worth double-digit tests; a validated probe patch
   already exists. Not python-specific — playwright/js-sdk emit the identical `tags: [ctx.tagVar]`
   body and merely hide it behind EdgeLifecycle template suppression (73 ops vs python's 0).
2. **Item 6a — null-omit a placeholder that resolves to null.** Worth **0-5 tests alone**, effort
   SMALL-MEDIUM, risk MEDIUM, **no sign-off**. Fixes a genuine emitter defect (we send
   `{"page":{"after":null}}`, which the broker rejects with `At least one of [from, after, before,
   limit]`, in 49 files / 96 occurrences) and is a hard prerequisite for 6b. This is the
   "Follow-up" the isFinal row and the P3 row both flagged.
3. **Item 5 — double `/v2` prefix** (the 22 cluster-admin 404s, `No endpoint GET
   /v2/cluster/v2/status`). Option A is emitter-only and needs **no sign-off**, but is worth only
   **2 tests** now (`getClusterStatus`, `getClusterUpgradeStatus`); the other 20 need cluster-admin
   credentials plus an `independentAuthGateMode` change in `configs/camunda-oca/request-validation.json`.
   The extractor and planner already model this correctly (`RequestStep.serverOverride`) and
   Playwright + request-validation already consume it — only the python/js emitters ignore it.
4. **Item 6b — replace the `!step.extract?.length` escape hatch with a load-bearing test.** The
   biggest single payoff (**~38 tests** measured) but **needs sign-off**: 20 of the recovered tests
   are group-C membership searches (`searchUsersForRole`, `searchRolesForTenant`, ...) where
   relaxing `require_items` is a **coverage loss, not a fix** — the honest alternative is a planner
   change that assigns a member before searching the membership. Only the 17 group-A ops
   (`searchAgentDefinitions`, `searchAuditLogs`, `searchVariables`, ...) are unsatisfiable by
   construction and legitimately relaxable. Re-measure the 3 group-B `searchAgentInstances` tests
   first: `8422eaf` may already have recovered them.
5. **Item 7 — the hardcoded `createDocument(s)` file in P2.** Worth **0 tests** (nothing fails
   because of it today — all 6 document-upload tests P2 fixed still pass). Its value is removing
   two camunda-oca-specific operationIds from config-agnostic emitter code
   (`python-sdk/emitter.ts:614-621`, `csharp-sdk/emitter.ts:422-425`) and fixing **js-sdk, which
   has no workaround and emits `files: {}` → a latent 415**. Both good options touch `configs/`, so
   **sign-off is needed**; note `tests/codegen/python-sdk-live-fixes.test.ts:65` currently *pins*
   the hardcode and must be updated as an intentional behaviour change.
6. **Item 8 — `content` / `descendUnions`** (array-of-oneOf request bodies). Worth **0 tests**,
   measured: rewriting all 31 `'content': ['placeholder']` occurrences to a valid
   `{contentType: 'TEXT', text: ...}` object left the 38 affected tests at **33 failed / 5 passed,
   unchanged**. The failure chain is discriminator-400 → `No CONFIGURATION history item sets
   'model'/'provider'/'systemPrompt'` → `No jobLeaseToken provided`, and Item 8 clears only the
   first link; a fully schema-valid body still gets **503 UNAVAILABLE**. The CONFIGURATION
   requirement is pure server-side business validation and is **not spec-derivable** (all three
   fields are optional in `AgentInstanceHistoryItem.required`), so it can only be expressed in
   `request-defaults.json` — **sign-off required**. Do this **last**, and only after Item 6.

Two cross-cutting facts the ranking depends on:

- **Items 4, 6a and 5A are the entire unblocked set** (~12-24 python tests, no owner input).
  Everything else is sign-off-gated.
- **Items 4 and 8 are not python-specific.** The same invalid bodies are emitted identically by
  playwright, js-sdk and python-sdk (Item 8: 31 occurrences / 8 files in each of the three;
  csharp-sdk emits no agent-instance operations at all), so a shared planner fix repairs all
  targets at once.

## Environment notes (this execution)

- Running on HEAD `3bf01e0`, Linux/bash (not Windows/PowerShell), with a `.venv` Python 3.12
  environment for pytest.
- The spec pin was bumped upstream in `d69b611` (`specRef` `6ea2724e` → `4a8be42e`) after this
  task list was authored.
- **Superseded finding (measured against a stale Aug 31 spec, not the pinned one):** the
  on-disk bundled spec in this tree predated the `d69b611` pin bump and was never re-fetched,
  so an initial regen measurement reported "243 endpoints (+80 variant suites)" / 384 variant
  scenarios, with `getClusterUpgradeStatus` and the `JobLeaseToken` variants of `updateJob`,
  `throwJobError`, `failJob` appearing "removed upstream". That was an artifact of the stale
  local bundle, not a real spec change — resolved by fetching the actually-pinned spec
  (`SPEC_REF=4a8be42e95403304d256ac455c7dc62a13423e53 npm run fetch-spec:ref`), which produced
  `specHash` matching `expectedSpecHash` in `configs/camunda-oca/spec-pin.json` exactly.
- **Current numbers, against the correctly-pinned spec:** 244 operations / 244 endpoints
  (+83 variant suites), 387 total variant scenarios, 52 `EndCursor` + 47 `StartCursor`. These
  match the task list's original "Standard commands" expectation exactly. `getClusterUpgradeStatus`
  and all three `JobLeaseToken` variants (`updateJob`, `throwJobError`, `failJob`) are present —
  nothing is actually missing upstream. Nothing in this doc's task sections needs adjusting for
  endpoint/variant counts.

## Rules (read first)

1. Do the tasks **in order**, one commit per task. Don't edit files that the task doesn't list.
2. After every task, run its **Verify** block. If the output differs from **Expected**,
   **stop and report**. Don't improvise a different fix.
3. Windows / PowerShell:
   - Never write a file with a `>` redirect: PowerShell 5.1 writes UTF-16.
   - Don't use heredocs (`<<EOF`). Write commit messages to a file and run `git commit -F <file>`.
   - `run_in_terminal`/PowerShell mangles `&&` and `||` inside inline `node -e` / `python -c`
     strings. Put scripts in a file instead.
4. Lint: `npm run lint` must report **zero** warnings. Don't use `as T` casts (see AGENTS.md).
5. Bug-fix discipline (AGENTS.md): write a failing test first, then the minimal fix, then
   broaden the test to cover the whole class of bug. Each task below already includes its
   red/green test.
6. Tasks marked **needs sign-off** touch `configs/` or change a product decision. Get the
   owner's OK before merging them.

## What this suite actually is

The generated Python project calls the REST API directly with **`httpx`**
(`renderPythonRequestStep` in `emitter.ts`). It never imports the Camunda Python SDK:
`camunda-orchestration-sdk` is listed in `pyproject.toml` but unused, and so is
`spec/python-sdk/operation-map.json`. So "python-sdk has 100% presence coverage" means
"every operation has a raw-HTTP test", not "the Python SDK is tested". Task P6 is the decision
about this. Every other task improves the suite as it is today.

## Baseline and measured effect

| Run (broker `camunda/camunda:8.9-SNAPSHOT`, fresh `down -v`) | Passed / total |
|---|---|
| Baseline, `main` (2026-09-21) | 256 / 675 |
| After S2 + S3 + P1 + P2 + P3 (measured 2026-09-24) | **288 / 675** (failures 419 → 387; `searchAgentDefinitions` step failures 108 → 16; the remaining top failures are 8.10-only endpoints, fixed by S1) |
| Baseline, SNAPSHOT + RDBMS overlay, Linux, 2026-10-05, `3bf01e0`, **pinned spec** (`4a8be42e`) | 363 / 675 (312 failed; 244 endpoints, correctly-pinned spec — see Environment notes; supersedes the 2026-10-04 row, which was measured against a stale Aug 31 bundle). The `attribute-test-failures.ts` tool referenced below does not exist in this repo (never committed), so this row is from manual JUnit XML parsing, not the tool. Top buckets by bare assertion (no broker detail text is captured pre-P1): 213x `assert 400 == 200`, 28x `assert 404 == 200`, 26x `assert 404 == 204`, 12x `assert 400 == 204`, 8x `assert 400 == 201`, 6x `assert 415 == 201`, 3x `assert 401 == 200`, 3x `assert 403 == 200`, 3x `assert 500 == 200`, 2x `assert 500 == 204`. Whether the `No endpoint POST /v2/agent-...` / `Method 'POST' is not supported` messages are gone **could not be determined** — pre-P1, python-sdk failure text never included the broker's response body in the first place (confirmed: no `system-out`, no response detail in any failure node), so there was nothing for S1 to visibly remove. |
| After P1 (measured 2026-10-05, `06c09da`, same pinned spec/broker) | 362 / 675 (313 failed). **Off by one from the pre-P1 row (363)** — not caused by P1 (which only appends `, {responseVar}.text` to the assert, no control-flow change): `test_evaluate_expression_variant::test_variant_1_evaluateexpression_bpmn_1` flipped pass→fail with `Failed to convert 'userTaskKey' with value: 'userTaskKey'`, the same eventual-consistency race P3 targets (a search ran before its data was visible, so the key was never bound). Now that P1 surfaces the broker `detail`, top 15 buckets by message: 87x `At least one of [from, after, before, limit] is required.`, 30x `Unexpected value 'placeholder' for enum field 'role'. Use any of the following values: [USER, ASSISTANT, TOOL_RESULT, CONFIGURATION]`, 17x `The provided tag 'null' is not valid...`, 13x `At least one of filter criteria is required.`, 8x `Command 'CREATE' rejected ... Expected to create authorization with permission types '[ACCESS]'...`, 8x `Command 'CREATE' rejected ... Expected to deploy new resources...'drd.dmn'...`, 6x `Content-Type 'null' is not supported.`, 6x `The provided targetProcessDefinitionKey 'placeholder' is not a valid key...`, 6x `At least one of [retries, timeout, priority] is required.`, 5x `At least one of [decisionDefinitionId, decisionDefinitionKey] is required...`, 5x bare `AssertionError:` (no JSON detail — non-JSON or empty body), 4x `This endpoint requires one of the following secondary storages: elasticsearch, opensearch, but the configured secondary storage is 'rdbms'.`, 4x `Command 'CREATE' rejected ... Expected to deploy new resources...'incident-script-task.bpmn'...`, 3x `Document with id 'documentId' not found`, 3x `No variables provided.`. **`No endpoint POST /v2/agent-...` / `Method 'POST' is not supported`: 0 occurrences** — confirms S1 (matching broker to spec) already eliminated these. **S2 targets:** 12 failures mention `Expected to deploy new resources` (8 from `drd.dmn`'s `unsupported decision expression`, 4 from `incident-script-task.bpmn`'s `Expected expression but found static value`) — these are exactly the two fixtures S2 will fix. |
| After S2 (measured 2026-10-05, `3ea7b9b`, same pinned spec/broker) | 372 / 675 (303 failed; +10 vs the P1 row). `Expected to deploy new resources`: **0 occurrences** (as expected — both fixtures now deploy). Of the 12 P1-run tests that were failing on the broken fixtures, **11 now pass**; the 1 still-failing is `test_feature_1_resolveincident_base_1`, which moved on to a later step and now fails with `Failed to convert 'incidentKey' with value: 'incidentKey'` (the P3 eventual-consistency class, exactly as the spec anticipated for `get_incident`/`resolveIncident`-style tests). **`test_get_incident` itself now passes** — better than the spec's "may still fail until P3" expectation. One test flipped pass→fail vs the P1 row: `test_feature_1_getusertask_base_1`, with `Failed to convert 'userTaskKey' with value: 'userTaskKey'` — same eventual-consistency race class, unrelated to S2. Top 10 buckets by message: 87x `At least one of [from, after, before, limit] is required.`, 30x `Unexpected value 'placeholder' for enum field 'role'...`, 17x `The provided tag 'null' is not valid...`, 13x `At least one of filter criteria is required.`, 8x `Command 'CREATE' rejected ... Expected to create authorization with permission types '[ACCESS]'...`, 6x `Content-Type 'null' is not supported.`, 6x `The provided targetProcessDefinitionKey 'placeholder' is not a valid key...`, 6x `At least one of [retries, timeout, priority] is required.`, 5x `At least one of [decisionDefinitionId, decisionDefinitionKey] is required...`, 5x bare `AssertionError:`. **Checked: all 87 of the `[from, after, before, limit]` failures are cursor variants** (`variantKey` ending `::EndCursor` or `::StartCursor`), spanning 43 endpoints (1 `EndCursor`-only: `searchAgentDefinitions`; the other 42 contribute both an `EndCursor` and a `StartCursor` failure) — `searchAgentInstances`, `searchAuditLogs`, `searchAuthorizations`, `searchBatchOperationItems`, `searchBatchOperations`, `searchClientsForGroup`, `searchClientsForRole`, `searchClientsForTenant`, `searchClusterVariables`, `searchCorrelatedMessageSubscriptions`, `searchDecisionDefinitions`, `searchDecisionInstances`, `searchDecisionRequirements`, `searchElementInstanceIncidents`, `searchElementInstanceWaitStates`, `searchElementInstances`, `searchGlobalTaskListeners`, `searchGroupIdsForTenant`, `searchGroups`, `searchGroupsForRole`, `searchIncidents`, `searchJobs`, `searchMappingRule`, `searchMappingRulesForGroup`, `searchMappingRulesForRole`, `searchMappingRulesForTenant`, `searchMessageSubscriptions`, `searchOwnAuthorizations`, `searchProcessDefinitionVariableNames`, `searchProcessDefinitions`, `searchProcessInstanceIncidents`, `searchProcessInstances`, `searchResources`, `searchRoles`, `searchRolesForGroup`, `searchRolesForTenant`, `searchTenants`, `searchUserTasks`, `searchUsers`, `searchUsersForGroup`, `searchUsersForRole`, `searchUsersForTenant`, `searchVariables`. This is exactly S3's target (the planner currently chains the wrong producer for these cursor leaves). No fix applied this run. |
| After S3 (measured 2026-10-05, `2523d12`, same pinned spec/broker) | 372 / 675 (303 failed — **same totals as the S2 row**, but a different set of 14 tests on each side flipped: the chain shape change moved some variants' numbering between the `bpmn` and `path` artifact-tag suffixes, e.g. `test_variant_5_searchjobs_bpmn_1`→fail paired with `test_variant_5_searchjobs_path_1`→pass for the same underlying scenario; plus `test_feature_1_getusertask_base_1` and `test_variant_1_evaluateexpression_bpmn_1` flipped back to pass, the same eventual-consistency flakiness noted in earlier rows). **The 87 `[from, after, before, limit]` failures are gone entirely (0 remaining)** — S3 fixed the wrong-producer bug as intended. **New bucket: 88x `Cannot decode pagination cursor '<placeholder>'`** (now the #1 bucket) — root cause confirmed by reading the generated test and scenario JSON directly: the self-referencing warm-up call's `requestPlan` step has `extract: None` (no `page.endCursor`/`page.startCursor` extraction was ever planned for the producer step), so `ctx.get('endCursorVar')` on the second call returns whatever `seed_binding('endCursorVar')` seeded at scenario start (a literal placeholder string, e.g. `'endCursorVar-c635caca8d37'`) — the warm-up response is never read for this purpose. Example (`test_search_jobs_variant.py`, `test_variant_5_searchjobs_bpmn_1`): `body_4 = {'page': {'after': ctx.get('endCursorVar')}}` sends the unmodified seed string; step 3 (`body_3 = {}`, the warm-up `searchJobs` call) has no extraction block at all. Same pattern confirmed in `test_search_users_variant.py` and others — this is general, not endpoint-specific. This is exactly the "Follow-up (not in this task)" the spec flagged, except the mechanism is "never extracted" rather than "extracted but null from an empty first page." Top 10 buckets by message: 88x `Cannot decode pagination cursor '<placeholder>'`, 30x `Unexpected value 'placeholder' for enum field 'role'...`, 17x `The provided tag 'null' is not valid...`, 13x `At least one of filter criteria is required.`, 8x `Command 'CREATE' rejected ... Expected to create authorization with permission types '[ACCESS]'...`, 7x bare `AssertionError:`, 6x `Content-Type 'null' is not supported.`, 6x `The provided targetProcessDefinitionKey 'placeholder' is not a valid key...`, 6x `At least one of [retries, timeout, priority] is required.`, 5x `At least one of [decisionDefinitionId, decisionDefinitionKey] is required...`. No fix applied this run. |
| After isFinal-by-index (measured 2026-10-06, `fdf2766`, same pinned spec/broker) | **418 / 675** (257 failed; **+46 vs the S3 row**). **The 88x `Cannot decode pagination cursor` bucket is gone (0 remaining)** — the warm-up step now extracts `page.startCursor`/`page.endCursor`, so no placeholder cursor is ever sent. Breakdown of those 88: **48 now pass outright**, the other **40 now fail with the new bucket below**. (Of the 95 scenarios the red invariant flagged, 2 more — `searchAgentInstances` `variant-8`/`variant-9` — now fail in the pre-existing `Unexpected value 'placeholder' for enum field 'role'` bucket, and 3 `searchOwnAuthorizations` ones in `No filter provided.` / a bare assert; those 5 were already failing before for other reasons.) **New #1 bucket: 42x `At least one of [from, after, before, limit] is required.`** (0 before), all at the **final** step, across 21 search endpoints, all cursor variants: `searchAgentDefinitions`, `searchAgentInstances`, `searchAuditLogs`, `searchClientsForGroup`, `searchClientsForRole`, `searchClientsForTenant`, `searchElementInstanceIncidents`, `searchGroupIdsForTenant`, `searchGroupsForRole`, `searchMappingRulesForGroup`, `searchMappingRulesForRole`, `searchMappingRulesForTenant`, `searchProcessDefinitionVariableNames`, `searchProcessInstanceIncidents`, `searchResources`, `searchRolesForGroup`, `searchRolesForTenant`, `searchUsersForGroup`, `searchUsersForRole`, `searchUsersForTenant`, `searchVariables`. Cause: the fix removes the cursor binding from `seedBindings` (`["tenantIdVar","endCursorVar"]` → `["tenantIdVar"]`), so `ctx.get('endCursorVar')` is now `None` instead of a placeholder string, and `{'page': {'after': null}}` is exactly what the broker rejects — verified live: `{}` → 400, `after: null` → 400, `after: "<garbage>"` → 200 (broker treats a garbage cursor as no-op), `after: "<real cursor>"` → 200. The 42 are data-dependent: the warm-up search returns an **empty page** (`items: []`, `page.startCursor: null`, `page.endCursor: null` — confirmed live for `process-definitions/{key}/variable-names/search` and `agent-definitions/search`), and `get_nested_value` returns `None` (not `_MISSING`) for a present-but-null leaf, so `ctx.set('endCursorVar', None)` overwrites the seed. **Follow-up (not in this task):** emit `ctx.get('endCursorVar') or ""`/omit the `page` object when the cursor is null, or have the planner seed a first-page request (`{'page': {'from': 0, 'limit': N}}`) instead of `{}` so the warm-up can return a real cursor. **Pass→fail: exactly 2** — `test_search_process_definition_variable_names_variant::test_variant_1_searchprocessdefinitionvariablenames_bpmn_1` and `::test_variant_2_searchprocessdefinitionvariablenames_bpmn_1`, both `At least one of [from, after, before, limit] is required.` at step 3, both in the 42 (these two endpoints' warm-up page is empty, so they went from a passing garbage-cursor request to a failing null-cursor request); the other 40 of the 42 were already failing. **Fail→pass: 48.** `Cannot decode pagination cursor`: 0. Top 10 buckets by broker message (previous count in brackets): 42x `At least one of [from, after, before, limit] is required.` [0], 30x `Unexpected value 'placeholder' for enum field 'role'...` [30], 17x `The provided tag 'null' is not valid...` [17], 13x `At least one of filter criteria is required.` [13], 8x `Command 'CREATE' rejected ... Expected to create authorization with permission types '[ACCESS]'...` [8], 7x `Command 'REMOVE_ENTITY' rejected ... NOT_FOUND...` [7], 6x `Content-Type 'null' is not supported.` [6], 6x `The provided targetProcessDefinitionKey 'placeholder' is not a valid key...` [6], 6x `At least one of [retries, timeout, priority] is required.` [6], 5x `At least one of [decisionDefinitionId, decisionDefinitionKey] is required` [5]. Every other bucket is unchanged from the S3 row; the `Cannot decode pagination cursor` bucket and all the per-`<placeholder>` one-off buckets under it are gone. 675 tests on both sides, no test added or removed. |
| After P2 (measured 2026-10-06, `e07b9db`, same pinned spec/broker) | **423 / 675** (252 failed; +5 vs the isFinal row). **`Content-Type 'null' is not supported.`: 6 → 0** — all 6 document-upload tests now pass: `test_create_document::test_feature_1_createdocument_base_1`, `test_create_document_variant::test_variant_1/2_createdocument_bpmn_1`, `test_create_documents::test_feature_1_createdocuments_base_1`, `test_create_documents_variant::test_variant_1/2_createdocuments_bpmn_1`. The emitted request is now `files_1 = {'file': ('hello.txt', b'Hello, world!')}` for `createDocument` and `{'files': ...}` for `createDocuments` (field name differs between the two endpoints), so httpx sends a real multipart body instead of form-urlencoded. The doc's own P2 check also passes: `pytest test_create_document.py test_create_documents.py` → `2 passed`. **Fail→pass: 6 (all of them the document uploads above). Pass→fail: 1** — `test_evaluate_expression_variant::test_variant_1_evaluateexpression_bpmn_1`, `400 Failed to convert 'userTaskKey' with value: 'userTaskKey'` at `POST /v2/user-tasks/userTaskKey/effective-variables/search`, i.e. the unbound-binding race **P3** targets, not a P2 regression (P2 only changes the multipart `files=` argument; `createDocument`/`createDocuments` are the only operations it touches). The same test flipped pass→fail in the P1 row and back to pass in the S3 row for the same reason, so this is that known race re-appearing, not a new effect of P2. `Failed to convert` bucket 10 → 11 for that one test. Everything else is unchanged from the isFinal row: `At least one of [from, after, before, limit] is required.` still 42, `Cannot decode pagination cursor` still 0, `Unexpected value 'placeholder' for enum field 'role'` 30, `The provided tag 'null' is not valid` 17, `At least one of filter criteria is required` 13, `Command 'CREATE' rejected ... authorization with permission types '[ACCESS]'` 8, `The provided targetProcessDefinitionKey 'placeholder'` 6, `At least one of [retries, timeout, priority] is required` 6, `At least one of [decisionDefinitionId, decisionDefinitionKey] is required` 5, `assert 401 == 200` 5, secondary-storage 403 4. Top 10 buckets after: 42x `[from, after, before, limit]`, 30x `role` enum, 17x `tag 'null'`, 13x `filter criteria`, 8x `authorization ... [ACCESS]`, 6x `targetProcessDefinitionKey 'placeholder'`, 6x `[retries, timeout, priority]`, 5x `[decisionDefinitionId, decisionDefinitionKey]`, 5x `assert 401 == 200`, 4x secondary-storage 403 — the `Content-Type 'null'` bucket has left the list entirely. 675 tests on both sides, no test added or removed. |
| After P3 (measured 2026-10-06, `e3e760c`, same pinned spec/broker) | **413 / 675** (262 failed; **-10 vs the P2 row**, the largest net regression in this series (the P1 row dipped by 1)). Run time **717.65s (11m57s)** vs 45.07s at P2: the 492 emitted `await await_eventually(` calls each burn a 10s / 21-attempt budget when the page stays empty, so this is polling cost, not a hang. **`At least one of [from, after, before, limit] is required.`: 42 → 0 — the bucket is gone**, but not fixed: all 42 now fail as `Eventual consistency timeout` instead. P3 removed the *symptom* (we no longer POST `{"page": {"after": null}}`) while the real cause was never a bad cursor — the prerequisite search legitimately returns `{"items":[]}`, so `require_items=True` polls an empty page for 10s and raises. **New bucket `Eventual consistency timeout`: 0 → 66** (61 with `lastStatus=200` and an empty `items`, 5 with `lastStatus=404` on GET-by-id) across 28 operations; largest sub-buckets `searchAgentDefinitions` 11, `searchAgentInstances` 8. **`Failed to convert`: 11 → 9.** **Fail→pass: 0. Pass→fail: 10**, all of them a variant whose step 1 or 2 is an agent / audit-log warm-up search, each `after 21 attempt(s) in ~10010ms (lastStatus=200): {"items":[]...}`: `test_get_process_definition_message_subscription_statistics_variant::test_variant_2_getprocessdefinitionmessagesubscriptionstatistics_bpmn_1`, `test_search_agent_definitions_variant::test_variant_1_searchagentdefinitions_path_1`, `test_search_agent_instances_variant::test_variant_2_searchagentinstances_path_1`, `test_search_audit_logs_variant::test_variant_1_searchauditlogs_bpmn_1`, `::test_variant_5_searchauditlogs_bpmn_1`, `::test_variant_16_searchauditlogs_bpmn_1`, `test_search_element_instances_variant::test_variant_7_searchelementinstances_bpmn_1`, `test_search_user_tasks_variant::test_variant_3_searchusertasks_path_1`, `test_search_variables_variant::test_variant_2_searchvariables_bpmn_1`, `::test_variant_3_searchvariables_bpmn_1`. **Root cause, verified live on this broker:** `POST /v2/agent-definitions/search`, `/v2/agent-instances/search` and `/v2/audit-logs/search` with `{}` all return `{"items":[],"page":{"totalItems":0,...}}`, and the pinned spec exposes **no create-agent-definition operation at all** (`/agent-definitions/*` is search + get-by-id only), so that page can never become non-empty — `require_items=True` is *unsatisfiable* there, not merely slow. The 5 `lastStatus=404` timeouts (`getAuditLog`, `getResource`, `getResourceContent`, `getResourceContentBinary`, `getTenantClusterVariable`) are the same class: 404-on-GET retries to budget instead of falling through to the status assertion. **This is faithful to Playwright, not a Python-only artefact** — `searchVariables.variant.spec.ts:69` wraps the identical `searchAgentDefinitions` warm-up in `awaitEventually` with the same `items.length > 0` default predicate and no `requireItems` escape, so the Playwright suite should fail these too (not measured here). Top 10 after: 28x `role` enum placeholder, 17x `tag 'null'`, 13x `filter criteria`, 11x EC timeout `[searchAgentDefinitions]`, 8x `authorization ... [ACCESS]`, 8x EC timeout `[searchAgentInstances]`, 7x `REMOVE_ENTITY ... NOT_FOUND`, 6x `targetProcessDefinitionKey 'placeholder'`, 6x `[retries, timeout, priority]`, 5x `[decisionDefinitionId, decisionDefinitionKey]` — 114 distinct buckets, and the EC family is fragmented by operation; grouped, it is the single largest at 66. 675 tests on both sides, no test added or removed. **Follow-up needed (outside P3's spec): require items only on EC steps whose extraction feeds a later binding, and let a warm-up search accept an empty-but-successful page.** |

How the 419 baseline failures break down, grouped by the request that actually failed (tool
below):

| Failures | Cause | Task |
|---|---|---|
| 239 | The step's endpoint doesn't exist on an 8.9 broker (agent-instance, cluster/backup, batch suspend/resume, `searchResources`, ...). The spec is pinned to `camunda/camunda` **main** (8.10+). | S1 |
| 108 (of the 239) | The planner chains `searchAgentDefinitions` in front of 48 search/statistics variants to supply a page cursor | S3 |
| 19 | `createDeployment` 400: two fixture files are rejected by the broker | S2 |
| 6 | `createDocument(s)` 415: an empty `files={}` makes httpx send form-urlencoded | P2 |
| many | Search right after create returns an empty page (eventual consistency), so the next step gets a literal like `/incidents/incidentKey` | P3 |
| all | `assert 400 == 200` with **no broker message**, which makes triage impossible | P1 |

## Findings after P3

P3 is committed and kept as-is, but it is the largest net regression in this series
(423 → 413). This section records the read-only investigation into *why*, because the
cause is upstream of the Python emitter: it is a planner-side warm-up-selection bug that
P3 merely made loud instead of quiet.

### 1. Variant scenarios with a `searchAgentDefinitions` step, endpoint ≠ `searchAgentDefinitions`

9 scenarios across 5 endpoints. Every one has `searchAgentDefinitions` as **step 1**, and
every one extracts the same 7 bindings: `items[0].agentDefinitionKey`, `items[0].elementId`,
`items[0].processDefinitionId`, `items[0].processDefinitionKey`, `items[0].tenantId`,
`page.startCursor`, `page.endCursor`.

| # | endpoint | variantKey | full chain | what step 1 feeds into a later step |
|---|---|---|---|---|
| 1 | `searchAgentInstances` | `filter::filter.agentDefinitionKey::AgentDefinitionKey` | `searchAgentDefinitions → searchAgentInstances` | **`agentDefinitionKeyVar` → step 2 body** — and it is the variant leaf itself. The only genuinely load-bearing case. |
| 2 | `searchAuditLogs` | `filter::filter.auditLogKey::AuditLogKey` | `searchAgentDefinitions → createDeployment → createProcessInstance → searchUserTasks → searchUserTaskAuditLogs → searchAuditLogs` | `tenantIdVar` → step 2 `data['tenantId']`; `processDefinitionKeyVar` → step 3 |
| 3 | `searchAuditLogs` | `filter::filter.entityKey::AuditLogEntityKey` | same as 2 | same as 2 |
| 4 | `searchAuditLogs` | `filter::filter.relatedEntityKey::AuditLogEntityKey` | same as 2 | same as 2 |
| 5 | `searchElementInstances` | `filter::filter.incidentKey::IncidentKey` | `searchAgentDefinitions → createDeployment → createProcessInstance → activateJobs → searchIncidents → searchElementInstances` | same pattern |
| 6 | `searchElementInstances` | `filter.$or[]::filter.$or[].incidentKey::IncidentKey` | same as 5 | same pattern |
| 7 | `getProcessDefinitionMessageSubscriptionStatistics` | `filter::filter.messageSubscriptionKey::MessageSubscriptionKey` | `searchAgentDefinitions → createDeployment → createProcessInstance → searchMessageSubscriptions → getProcessDefinitionMessageSubscriptionStatistics` | same pattern |
| 8 | `searchVariables` | `filter::filter.variableKey::VariableKey` | `searchAgentDefinitions → createDeployment → createProcessInstance → searchUserTasks → searchUserTaskVariables → searchVariables` | same pattern |
| 9 | `searchVariables` | `filter::filter.scopeKey::ScopeKey` | same as 8 | same pattern |

Two facts about rows 2–9 matter more than the table itself:

**The variant leaf is never provided by step 1.** In all 8 cases the leaf semantic comes
from a *later* step: `searchUserTaskAuditLogs → AuditLogKey/AuditLogEntityKey`,
`searchIncidents → IncidentKey`, `searchMessageSubscriptions → MessageSubscriptionKey`,
`searchUserTaskVariables → VariableKey/ScopeKey`. Step 1 provides only `StartCursor` /
`EndCursor` plus keys that are immediately re-minted downstream.

**`tenantIdVar` / `processDefinitionKeyVar` from step 1 are not load-bearing — P2 proves
it empirically.** At P2 step 1 returned `{"items":[]}`, so all 7 extractions came back
`_MISSING`, and these 10 tests still **passed**. Step 2 (`createDeployment`) re-extracts
both, step 3 (`createProcessInstance`) re-extracts both, and so on down the chain. The
warm-up call only needs to return 200; its values are overwritten before use. P3 turned a
valueless call into a hard precondition.

### 2. Mapping of the 10 P3 pass→fail tests

9 of the 10 are in the table above:

| failing test | table row |
|---|---|
| `test_search_agent_instances_variant::test_variant_2_searchagentinstances_path_1` | row 1 |
| `test_search_audit_logs_variant::test_variant_1_searchauditlogs_bpmn_1` | row 2 |
| `test_search_audit_logs_variant::test_variant_5_searchauditlogs_bpmn_1` | row 3 |
| `test_search_audit_logs_variant::test_variant_16_searchauditlogs_bpmn_1` | row 4 |
| `test_search_element_instances_variant::test_variant_7_searchelementinstances_bpmn_1` | rows 5/6 (same chain) |
| `test_get_process_definition_message_subscription_statistics_variant::test_variant_2_…` | row 7 |
| `test_search_variables_variant::test_variant_2_searchvariables_bpmn_1` | row 8 |
| `test_search_variables_variant::test_variant_3_searchvariables_bpmn_1` | row 9 |
| `test_search_agent_definitions_variant::test_variant_1_searchagentdefinitions_path_1` | endpoint is `searchAgentDefinitions` itself, so excluded from the table; times out on `searchAgentInstances` (group B below) |

**The 10th is not in the list:** `test_search_user_tasks_variant::test_variant_3_searchusertasks_path_1`
has chain `searchAuditLogs → searchUserTasks` — no `searchAgentDefinitions`. It times out
on **`searchAuditLogs`**, the same disease in a different host (also a resource with no
create operation). So all 10 are "warm-up EC search that can never return items": 9 via
`searchAgentDefinitions`, 1 via `searchAuditLogs`.

### 3. Where these steps are added (causation chain)

Not in `buildAdditional` itself — that only *justifies* a choice already made. The chain:

1. **`path-analyser/src/graphLoader.ts:347-355`** — the inclusive index. Every
   `responseSemanticLeaves` entry becomes a discoverable producer in
   `responseProducersByType`, and the paginated envelope's `page.startCursor` /
   `page.endCursor` are semantically typed `StartCursor` / `EndCursor`. That makes **all
   57 paginated search ops producers of cursor semantics**, and in graph
   (spec-path-sorted) order the very first is `searchAgentDefinitions`.
2. **`path-analyser/src/scenarioGenerator.ts:2190-2196`** — `authoritative`
   (`producersByType`, `provider:true` only) is **empty** for `StartCursor`/`EndCursor`:
   no operation is authoritative for a cursor. So the code falls through to `inclusive`.
3. **`path-analyser/src/scenarioGenerator.ts:2213-2216`** — `producerCandidates` becomes
   that inclusive list, minus the endpoint itself.
4. **`path-analyser/src/scenarioGenerator.ts:2349-2359`** (`buildAdditional`) — because
   the candidate ≠ endpoint, line 2353-2355 adds every *optional* input the candidate
   requires that the endpoint also produces. `searchAgentDefinitions` optionally takes
   `page.before`/`page.after` (`StartCursor`/`EndCursor`) and every search endpoint
   produces them → `additional = {StartCursor, EndCursor}`. Line 2358 then adds
   `leaf.semantic`.
5. **`path-analyser/src/scenarioGenerator.ts:2362-2371`** (Pass 1, "warm-up forced") —
   `overlapsEndpoint` is true purely because of those cursors, so the candidate is chosen
   and the loop `break`s. **The first candidate wins, and the first candidate is always
   `searchAgentDefinitions`.**
6. **`path-analyser/src/scenarioGenerator.ts:2407`** — `additionalNeeded: [...additional]`
   hands that set to BFS, which materialises `searchAgentDefinitions` as step 1.

In short: the cursor fields in the standard `page` envelope are modelled as first-class
semantic types. So (a) every paginated search looks like a cursor *producer*, and (b) every
paginated search looks like it *needs* cursors. Pass 1 reads that mutual cursor relationship
as "this producer overlaps the endpoint, therefore warm it up," and picks whichever
candidate the spec's path ordering happens to put first — `searchAgentDefinitions`, the
alphabetically-first paginated resource, which is also the one resource with no create
operation. A leaf that has nothing to do with the variant's actual filter field drags in an
unrelated, permanently-empty entity.

### 4. The 21 timing-out cursor endpoints, grouped by whether the API can ever have data

21 endpoints have cursor-leaf variants that now time out (42 tests). Split by whether the
API can ever put a row in that collection:

**Group A — genuinely impossible: no create operation exists anywhere in the spec (8)**

- `searchAgentDefinitions` — `/agent-definitions/{search,/{key}}` only; no POST/PATCH/PUT
- `searchAuditLogs` — server-emitted; only search + GET
- `searchClientsForGroup`
- `searchClientsForRole`
- `searchClientsForTenant`
- `searchProcessDefinitionVariableNames`
- `searchVariables` — no create-variable op; only `PUT /element-instances/{key}/variables`
- `searchResources` — *conditional*: `createDeployment` does return
  `deployments[].resource.resourceKey`, but
  `configs/camunda-oca/fixtures/deployment-artifacts.json` has only `bpmnProcess` /
  `dmnDecision` / `dmnDrd` / `form` — no bare-resource artifact, so the suite never deploys one

For the three `ClientsFor*`: `clientId` appears **only** as a path param of assign/unassign
and as a search leaf. No operation creates or returns a client, so
`PUT /groups/{id}/clients/{clientId}` needs an id the API can never mint.

**Group B — a create op exists but is unreachable (1)**

- `searchAgentInstances` — `createAgentInstance` exists but 400s on
  `Unexpected value 'placeholder' for enum field 'role'` in **all 11** of its tests (the
  known 28× `role` bucket). No agent instance is ever created, so its cursor variant can
  never page.

**Group C — reachable in principle; the chain just does not populate the relation (12)**

`searchGroupIdsForTenant`, `searchGroupsForRole`, `searchRolesForGroup`,
`searchRolesForTenant`, `searchUsersForGroup`, `searchUsersForRole`, `searchUsersForTenant`,
`searchMappingRulesForGroup`, `searchMappingRulesForRole`, `searchMappingRulesForTenant`,
`searchElementInstanceIncidents`, `searchProcessInstanceIncidents`

Group C has a distinct mechanism worth flagging: each chain is
`createTenant/createGroup/createRole → <membership search> → <membership search>`, so it
queries the membership of a **freshly created, empty** container.
`POST /tenants/<default>/roles/search` returns 5 items on this broker, yet the variant still
times out — it looks up its own new tenant, which has nothing assigned. These are fixable by
the generator; groups A and B are not.

### Suggested next steps

1. **Stop cursor semantics (`StartCursor`/`EndCursor`) from forcing a warm-up by a
   different operation in non-cursor variants** (`buildAdditional` at
   `scenarioGenerator.ts:2349-2359` / Pass 1 at `2362-2371`). Expected effect: rows 2–9
   lose their `searchAgentDefinitions` step, row 1 is unchanged, ~9 tests recovered.
2. **Decide whether to suppress cursor variants** for group A endpoints (no create
   operation in the spec) and group B until `createAgentInstance`'s `role` placeholder bug
   is fixed.
3. **Group C:** make the chain assign a member before searching the membership.
4. **The remaining P5 buckets** (`role` placeholder 28, `tag 'null'` 17,
   `filter criteria` 13).

## Tools

| Tool | What it does |
|---|---|
| `scripts/e2e/attribute-test-failures.ts` | Reads pytest JUnit XML (or dotnet TRX) and groups failures by the **step that failed** and by message. `--list <op>` prints the individual tests. |
| `generated/camunda-oca/python-sdk/` | The generated suite. It is gitignored and disposable; regenerate it, never hand-edit it. |

## Standard commands

```powershell
# One-time setup on a fresh clone
npm install
npm run build:analyser
npm run build:emitter-sdk
npm run extract-graph
npm run generate:scenarios      # re-run after ANY path-analyser change (task S3)

# Python runtime (either option)
#   a) system Python 3.11+:  py -m pip install pytest pytest-asyncio httpx
#   b) poetry: see materializer/src/python-sdk/README.md
# If `python` opens the Microsoft Store stub, put the real interpreter first on PATH, e.g.:
#   $env:PATH = "$env:LOCALAPPDATA\Programs\Python\Python313;$env:LOCALAPPDATA\Programs\Python\Python313\Scripts;" + $env:PATH

# Regenerate the suite (after any emitter or materialize-support change)
npx tsx materializer/src/index.ts --target=python-sdk --all
# Last line: "Generated test suites for 244 endpoints (+83 variant suites, ...)"

# Syntax check every generated file (fast, no broker)
$py = Get-ChildItem generated/camunda-oca/python-sdk -Filter *.py -Recurse
python -m py_compile @($py.FullName)    # no output = OK

# Live run (fresh broker every time; a reused broker gives spurious 409s). Takes about 16 min.
docker compose -f docker/docker-compose.yml down -v
docker compose -f docker/docker-compose.yml up -d --wait
cd generated/camunda-oca/python-sdk
python -m pytest -q -p no:cacheprovider --junitxml=../../../py-results.xml
cd ../../..
npx tsx scripts/e2e/attribute-test-failures.ts --results py-results.xml --suite-dir generated/camunda-oca/python-sdk
```

Do **not** use `npm run testsuite:generate` on Windows. Its Playwright codegen step fails there.

---

## S1 (shared): Run the broker that matches the spec. No code change.

**Why:** 239 of 419 failures come from running an **8.9** broker against an **8.10+** spec. The
compose file defaults to `8.9-SNAPSHOT`. The OCA nightly avoids this by using `SNAPSHOT` plus an
RDBMS overlay (`.github/workflows/nightly-camunda-oca.yml`, `_oca-suite-run.yml`).

**Command** (use it instead of the plain `up -d` in "Standard commands"):
```powershell
$env:CAMUNDA_VERSION = 'SNAPSHOT'
docker compose -f docker/docker-compose.yml -f docker/docker-compose.rdbms-unified-config.yml down -v
docker compose -f docker/docker-compose.yml -f docker/docker-compose.rdbms-unified-config.yml up -d --wait
docker inspect --format='{{.State.Health.Status}}' camunda-engine    # expect: healthy
```
Without the overlay, SNAPSHOT (8.10+) crashes on startup with `'url' must start with "jdbc"`.

**Expected:** in the attribution output, the `No endpoint POST /v2/agent-...` and
`Method 'POST' is not supported` messages disappear. **This was not measured here**; record the
new totals in this file when you've done it. Keep using the same broker for every later
measurement so the numbers stay comparable.

## S2 (shared, needs sign-off because it edits `configs/`): Fix two invalid deployment fixtures

**Why:** the broker rejects both files, and every scenario that deploys them fails at step 1.
This was confirmed by deploying each fixture directly with `httpx`:
- `bpmn/incident-script-task.bpmn` gives `Expected expression but found static value 'assert(...)'`.
  A Zeebe script needs a FEEL **expression**, which starts with `=`.
- `dmn/drd.dmn` gives `unsupported decision expression 'null'`. Both decisions have no decision
  logic at all.

**File 1:** `configs/camunda-oca/fixtures/bpmn/incident-script-task.bpmn`, line 11.

Old: `<zeebe:script expression="assert(missingVariable, missingVariable != null)" resultVariable="scriptResult" />`

New: `<zeebe:script expression="=assert(missingVariable, missingVariable != null)" resultVariable="scriptResult" />`

(Verified: the corrected process deploys, and starting an instance raises an
`EXTRACT_VALUE_ERROR` incident, which is what the incident scenarios need.)

**File 2:** replace the whole content of `configs/camunda-oca/fixtures/dmn/drd.dmn` with the
following. The decision IDs `Decision_1` and `Decision_2` are unchanged, so
`deployment-artifacts.json` doesn't change.
```xml
<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/" id="definitions" name="Definitions" namespace="https://camunda.example/">
  <decision id="Decision_1" name="Decision">
    <literalExpression id="LiteralExpression_1">
      <text>"y"</text>
    </literalExpression>
  </decision>
  <decision id="Decision_2" name="Decision2">
    <informationRequirement id="InformationRequirement_1">
      <requiredDecision href="#Decision_1" />
    </informationRequirement>
    <literalExpression id="LiteralExpression_2">
      <text>Decision_1</text>
    </literalExpression>
  </decision>
</definitions>
```

**Verify:** regenerate the suite (the fixtures are copied into it), then
```powershell
cd generated/camunda-oca/python-sdk
python -m pytest -q -p no:cacheprovider test_create_deployment.py test_get_incident.py
cd ../../..
```
**Expected:** no failure message contains `Expected to deploy new resources`. `test_get_incident`
may still fail until P3 is done; before P3 its failure message is `Failed to convert 'incidentKey'`.

**Commit:** `fix(camunda-oca): make incident-script-task.bpmn and drd.dmn deployable`

## S3 (shared): Page cursors must come from the same endpoint

**Why:** 57 search/statistics operations all "produce" `EndCursor`/`StartCursor`. For a cursor
variant (`page.after` / `page.before`), the planner picks the **first** producer in spec order,
`searchAgentDefinitions`, for 94 variants. That's semantically wrong on any broker (a cursor is
only valid for the endpoint that issued it) and a 404 on 8.9. The correct chain is
`<endpoint> -> <endpoint>`: call once, take `page.endCursor`, then call again with it.

**File:** `path-analyser/src/scenarioGenerator.ts`

**Change 1:** in `generateOptionalSubShapeVariants`:

Old:
```ts
      const producerCandidates = endpointIsSoleProducer ? [endpointOpId] : externalCandidates;
```
New:
```ts
      const endpointIsAuthoritativeProducer = authoritative.includes(endpointOpId);
      const producerCandidates =
        endpointIsSoleProducer || endpointIsAuthoritativeProducer
          ? [endpointOpId]
          : externalCandidates;
```
**Change 2:** in `tryProducerChainVariant` → `buildAdditional`. Without this change, the
self warm-up drags in the endpoint's *other* optional cursor, and the `StartCursor` variants still
chain `searchAgentDefinitions`.

Old:
```ts
    const additional = new Set<string>();
    for (const opt of candidate.requires.optional) {
      if (endpoint.produces.includes(opt)) additional.add(opt);
    }
```
New:
```ts
    const additional = new Set<string>();
    // A self warm-up call needs none of the endpoint's own optional inputs.
    if (candidate.operationId !== endpoint.operationId) {
      for (const opt of candidate.requires.optional) {
        if (endpoint.produces.includes(opt)) additional.add(opt);
      }
    }
```

**Red test (Layer 2):** create `tests/fixtures/planner/endpoint-scoped-cursor.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { generateOptionalSubShapeVariants } from '../../../path-analyser/src/scenarioGenerator.ts';
import type { OperationGraph, OperationNode } from '../../../path-analyser/src/types.ts';

// ---------------------------------------------------------------------------
// Fixture: endpoint-scoped pagination cursors
// ---------------------------------------------------------------------------
//
// Every search op authoritatively returns page cursors AND optionally accepts
// them (page.after / page.before). A cursor is only meaningful to the endpoint
// that issued it, so a cursor variant must source it from a prior call to the
// SAME endpoint. `aaaSearch` sorts first, mirroring `searchAgentDefinitions`,
// which the bundled spec lists first among 57 cursor producers and which was
// being chained into every cursor variant.
function searchOp(operationId: string): OperationNode {
  return {
    operationId,
    method: 'POST',
    path: `/${operationId}`,
    requires: { required: [], optional: ['EndCursor', 'StartCursor'] },
    produces: ['EndCursor', 'StartCursor'],
    providerMap: { EndCursor: true, StartCursor: true },
    optionalSubShapes: [
      {
        rootPath: 'page',
        leaves: [
          { fieldPath: 'page.after', semantic: 'EndCursor' },
          { fieldPath: 'page.before', semantic: 'StartCursor' },
        ],
      },
    ],
  };
}

const fixtureEndpointScopedCursor: OperationGraph = {
  operations: { aaaSearch: searchOp('aaaSearch'), searchJobs: searchOp('searchJobs') },
  producersByType: {
    EndCursor: ['aaaSearch', 'searchJobs'],
    StartCursor: ['aaaSearch', 'searchJobs'],
  },
  producersByState: {},
  responseProducersByType: {
    EndCursor: ['aaaSearch', 'searchJobs'],
    StartCursor: ['aaaSearch', 'searchJobs'],
  },
};

describe('planner contracts: endpoint-authoritative optional leaf is self-sourced', () => {
  it('sources both cursor leaves from a prior call to the same endpoint', () => {
    const variants = generateOptionalSubShapeVariants(fixtureEndpointScopedCursor, 'searchJobs', {
      maxVariantsPerEndpoint: 10,
    });
    expect(variants.scenarios.map((s) => s.variantKey)).toEqual([
      'page::page.after::EndCursor',
      'page::page.before::StartCursor',
    ]);
    for (const s of variants.scenarios) {
      expect(
        s.operations.map((o) => o.operationId),
        s.variantKey,
      ).toEqual(['searchJobs', 'searchJobs']);
    }
  });
});
```
- **On `main` (before the change):** fails with
  `expected [ 'aaaSearch', 'searchJobs' ] to deeply equal [ 'searchJobs', 'searchJobs' ]`.
  Commit the test first so the red step is recorded.

**Class-scoped invariant (Layer 3):** append to the end of
`configs/camunda-oca/regression-invariants.test.ts`. `REPO_ROOT`, `VARIANT_SCENARIOS_DIR` and
`describeForThisConfig` already exist in that file.
```ts

describeForThisConfig('variant planning: endpoint-scoped optional leaves are self-sourced', () => {
  it('a variant leaf the endpoint itself authoritatively returns is sourced from a prior call to that endpoint', async () => {
    const { loadGraph } = await import('../../path-analyser/src/graphLoader.js');
    const graph = await loadGraph(join(REPO_ROOT, 'path-analyser'));
    // Known residual: the planner satisfies these endpoints' cursor via the searchUserTasks step
    // it already needs for userTaskKey. Remove an entry once its variant self-sources.
    const KNOWN_RESIDUAL = new Set(['searchUserTaskAuditLogs', 'searchUserTaskVariables']);
    const offenders: string[] = [];
    let checked = 0;
    for (const f of readdirSync(VARIANT_SCENARIOS_DIR)) {
      if (!f.endsWith('-scenarios.json')) continue;
      // biome-ignore lint/plugin: runtime contract boundary for parsed JSON
      const parsed = JSON.parse(readFileSync(join(VARIANT_SCENARIOS_DIR, f), 'utf8')) as {
        endpoint: { operationId: string };
        scenarios?: { variantKey?: string; operations: { operationId: string }[] }[];
      };
      const endpointOp = parsed.endpoint.operationId;
      if (KNOWN_RESIDUAL.has(endpointOp)) continue;
      for (const s of parsed.scenarios ?? []) {
        const semantic = s.variantKey?.split('::').pop();
        if (!semantic) continue;
        if (!(graph.producersByType[semantic] ?? []).includes(endpointOp)) continue;
        if (graph.operations[endpointOp]?.requires.required.includes(semantic)) continue;
        checked++;
        const selfCalls = s.operations.filter((o) => o.operationId === endpointOp).length;
        if (selfCalls < 2) {
          offenders.push(
            `${endpointOp} ${s.variantKey}: ${s.operations.map((o) => o.operationId).join(' > ')}`,
          );
        }
      }
    }
    expect(checked, 'non-vacuity: expected cursor variants to be checked').toBeGreaterThan(50);
    expect(offenders, offenders.slice(0, 10).join('\n')).toEqual([]);
  });
});
```

**Verify:**
```powershell
npx vitest run tests/fixtures/planner          # Expected: 18 files, 132 tests, all pass
npm run generate:scenarios
npx vitest run configs/camunda-oca/regression-invariants.test.ts
```
**Expected (measured):**
- Planner fixtures: 132/132 pass (131 existing + the new one).
- Across all 387 variant scenarios, exactly **94 chains change**: 50 `EndCursor` and 44
  `StartCursor`. **No non-cursor variant changes**, and none are lost or gained.
- The new invariant passes. Against the pre-fix scenario output it fails, listing e.g.
  `searchAgentInstances page::page.after::EndCursor: searchAgentDefinitions > searchAgentInstances`.
- On Windows the invariants file has **36 pre-existing failures**: missing Playwright output,
  `npx.cmd EINVAL`, and OmniSharp `obj/` pollution. The failing set was diffed before and after
  this change and is **identical**. Any failure outside those 36 is yours.

**Commit order:** (1) `test: add endpoint-scoped cursor planner fixture (red)`, then
(2) `fix(path-analyser): source endpoint-authoritative variant leaves from the endpoint itself`
with the invariant.

**Follow-up (not in this task):** once this lands, cursor variants send `page.after` equal to
the first call's `page.endCursor`. That is `null` when the first page is empty. If those then
fail with 400, handle it separately.

---

## P1: Put the broker's error body into every status assertion

**Why:** today a failure prints only `assert 400 == 200`. The broker's JSON `detail` (e.g.
`multi-tenancy is disabled`, `Failed to convert 'incidentKey'`) is the fastest diagnosis there
is. This single change turned "419 unexplained failures" into named causes.

**File:** `materializer/src/python-sdk/emitter.ts`, `renderPythonRequestStep`.

Old:
```ts
  lines.push(`    assert ${responseVar}.status_code == ${step.expect.status}`);
```
New:
```ts
  lines.push(`    assert ${responseVar}.status_code == ${step.expect.status}, ${responseVar}.text`);
```
Existing tests still pass: they use `toContain('assert response_1.status_code == 201')`.

**Commit:** `fix(python-sdk): include the response body in status assertions`

## P2: Send a placeholder file for document uploads with no planned files

**Why:** for `createDocument` / `createDocuments` the planner emits `files: {}`. With an empty
`files=` dict, httpx sends `application/x-www-form-urlencoded`, and the broker answers **415**.
Verified directly: `files={}` gives 415, while `{'file': ('hello.txt', b'Hello, world!')}` gives 201
(field name `files` for `/documents/batch`). The C# emitter already does exactly this
(`emptyDocumentFiles` in `csharp-sdk/emitter.ts`).

**File:** `materializer/src/python-sdk/emitter.ts`, `renderPythonRequestStep`, multipart branch.

Old:
```ts
      if (filesTemplate !== undefined) {
        lines.push(`    files_${stepNum} = ${renderPythonMultipartFiles(filesTemplate)}`);
        requestArgs.push(`files=files_${stepNum}`);
      }
```
New:
```ts
      const isDocumentUpload =
        step.operationId === 'createDocument' || step.operationId === 'createDocuments';
      const hasNoFiles = !isRecord(filesTemplate) || Object.keys(filesTemplate).length === 0;
      if (isDocumentUpload && hasNoFiles) {
        // An empty files dict makes httpx send form-urlencoded, which the broker rejects with 415.
        const field = step.operationId === 'createDocuments' ? 'files' : 'file';
        lines.push(`    files_${stepNum} = {'${field}': ('hello.txt', b'Hello, world!')}`);
        requestArgs.push(`files=files_${stepNum}`);
      } else if (filesTemplate !== undefined) {
        lines.push(`    files_${stepNum} = ${renderPythonMultipartFiles(filesTemplate)}`);
        requestArgs.push(`files=files_${stepNum}`);
      }
```
**Verify:** regenerate, then run
`python -m pytest -q -p no:cacheprovider test_create_document.py test_create_documents.py`
inside the suite dir. **Expected:** `2 passed`.

**Commit:** `fix(python-sdk): send a placeholder file for document uploads without planned files`

## P3: Wait for eventual consistency the way the Playwright suite does

**Why:** reads (`GET`, `POST .../search`) run against secondary storage, which lags behind
writes. The Playwright emitter wraps these steps in `awaitEventually(...)`. The Python emitter
doesn't, so e.g. `createProcessInstance -> searchIncidents` returns an empty page, `incidentKeyVar`
is never set, and the next URL is literally `/incidents/incidentKey`. This was confirmed by
adding a 3-second sleep before `searchIncidents` in a generated test, which then passed.

This task has **two parts**: a vendored runtime helper, and the emitter wrap. Reuse
`stepNeedsAwaitForOp` from the Playwright emitter; AGENTS.md says not to re-implement it.

**Part A.** File `materializer/src/python-sdk/materialize-support.ts`, in the array returned by
`loadPythonProjectScaffoldingFiles()`. Insert this entry **between** the `support/seeding.py`
entry and the `conftest.py` entry:
```ts
    {
      relativePath: 'support/await_eventually.py',
      content: `"""
Poll an eventually-consistent read until the broker's secondary storage has caught up.

Mirrors materializer/src/playwright/support/await-eventually.ts (same retry and
abort rules) so the Python suite waits exactly where the Playwright suite does.
"""

from __future__ import annotations

import asyncio
import time
from typing import Awaitable, Callable

import httpx

_ABORT_STATUSES = {400, 401, 403, 409, 422}


def _is_non_empty_items_page(response: httpx.Response) -> bool:
    try:
        body = response.json()
    except ValueError:
        return True
    items = body.get('items') if isinstance(body, dict) else None
    return isinstance(items, list) and len(items) > 0


async def await_eventually(
    fetch: Callable[[], Awaitable[httpx.Response]],
    *,
    operation_id: str,
    method: str,
    require_items: bool = True,
    wait_up_to_ms: int = 10_000,
    poll_interval_ms: int = 500,
) -> httpx.Response:
    started = time.monotonic()
    is_get = method.upper() == 'GET'
    attempts = 0
    while True:
        attempts += 1
        response = await fetch()
        status = response.status_code
        if status in _ABORT_STATUSES or status >= 500:
            return response
        if 200 <= status < 400 and (is_get or not require_items or _is_non_empty_items_page(response)):
            return response
        if not (status == 404 and is_get) and status != 429 and not (200 <= status < 400):
            return response
        elapsed_ms = (time.monotonic() - started) * 1000
        remaining_ms = wait_up_to_ms - elapsed_ms
        if remaining_ms <= 0:
            raise AssertionError(
                f"Eventual consistency timeout for operation '{operation_id}' after "
                f"{attempts} attempt(s) in {elapsed_ms:.0f}ms (lastStatus={status}): "
                f"{response.text[:1000]}"
            )
        await asyncio.sleep(max(10, min(poll_interval_ms, remaining_ms)) / 1000)
`,
    },
```

**Part B.** File `materializer/src/python-sdk/emitter.ts`. Make these five edits:

1. Import. Old: `import { camelCase } from '../playwright/stepRenderer.js';`
   New: `import { camelCase, stepNeedsAwaitForOp } from '../playwright/stepRenderer.js';`

2. In `renderPythonSuite`, directly after
   ```ts
     if (hasSeedBindings) {
       lines.push('from support.seeding import init_spec_salt, seed_binding');
     }
   ```
   add:
   ```ts
     const needsAwaitEventually = collection.scenarios.some((scenario) => {
       const ecOps = new Set(
         scenario.operations.filter((o) => o.eventuallyConsistent).map((o) => o.operationId),
       );
       return (scenario.requestPlan ?? []).some((step) => stepNeedsAwaitForOp(step, ecOps));
     });
     if (needsAwaitEventually) {
       lines.push('from support.await_eventually import await_eventually');
     }
   ```

3. In `renderPythonSuite`, in the per-step loop:

   Old:
   ```ts
       const isErrorScenario = scenario.expectedResult?.kind === 'error';
       for (let i = 0; i < requestPlan.length; i++) {
         const isFinal = i === requestPlan.length - 1;
         renderPythonRequestStep(
           lines,
           requestPlan[i],
           i,
           omitWhenUnboundFieldNames,
           isFinal && !isErrorScenario ? scenario.responseShapeFields : undefined,
         );
   ```
   New:
   ```ts
       const isErrorScenario = scenario.expectedResult?.kind === 'error';
       const ecOps = new Set(
         scenario.operations.filter((o) => o.eventuallyConsistent).map((o) => o.operationId),
       );
       for (let i = 0; i < requestPlan.length; i++) {
         const isFinal = i === requestPlan.length - 1;
         renderPythonRequestStep(
           lines,
           requestPlan[i],
           i,
           omitWhenUnboundFieldNames,
           isFinal && !isErrorScenario ? scenario.responseShapeFields : undefined,
           stepNeedsAwaitForOp(requestPlan[i], ecOps),
         );
   ```

4. Signature of `renderPythonRequestStep`. Add a last parameter:
   ```ts
     responseShapeFields?: EndpointScenario['responseShapeFields'],
     awaitEventually = false,
   ): void {
   ```

5. In `renderPythonRequestStep`, replace the call-rendering block. It starts at
   `const bodylessConvenienceVerbs` and ends at the `assert` line from P1:

   Old:
   ```ts
     const bodylessConvenienceVerbs = new Set(['get', 'delete', 'options', 'head']);
     const hasBodyArg = requestArgs.some((arg) => /^(json|data|files)=/.test(arg));
     if (hasBodyArg && bodylessConvenienceVerbs.has(methodName)) {
       lines.push(`    ${responseVar} = await client.request(`);
       lines.push(`        '${step.method.toUpperCase()}',`);
       for (const arg of requestArgs) {
         lines.push(`        ${arg},`);
       }
       lines.push('    )');
     } else {
       lines.push(`    ${responseVar} = await client.${methodName}(`);
       for (const arg of requestArgs) {
         lines.push(`        ${arg},`);
       }
       lines.push('    )');
     }
     lines.push(`    assert ${responseVar}.status_code == ${step.expect.status}, ${responseVar}.text`);
   ```
   New:
   ```ts
     const bodylessConvenienceVerbs = new Set(['get', 'delete', 'options', 'head']);
     const hasBodyArg = requestArgs.some((arg) => /^(json|data|files)=/.test(arg));
     const callLines: string[] = [];
     if (hasBodyArg && bodylessConvenienceVerbs.has(methodName)) {
       callLines.push('client.request(');
       callLines.push(`    '${step.method.toUpperCase()}',`);
     } else {
       callLines.push(`client.${methodName}(`);
     }
     for (const arg of requestArgs) callLines.push(`    ${arg},`);
     callLines.push(')');
     if (awaitEventually) {
       lines.push(`    ${responseVar} = await await_eventually(`);
       lines.push(`        lambda: ${callLines[0]}`);
       for (const l of callLines.slice(1, -1)) lines.push(`        ${l}`);
       lines.push('        ),');
       lines.push(`        operation_id='${step.operationId}',`);
       lines.push(`        method='${step.method.toUpperCase()}',`);
       if (!step.extract?.length) lines.push('        require_items=False,');
       lines.push('    )');
     } else {
       lines.push(`    ${responseVar} = await ${callLines[0]}`);
       for (const l of callLines.slice(1)) lines.push(`    ${l}`);
     }
     lines.push(`    assert ${responseVar}.status_code == ${step.expect.status}, ${responseVar}.text`);
   ```

**Why `require_items=False` when the step extracts nothing:** a first attempt required a
non-empty page for **every** search, like Playwright does. That made **55 previously-passing
tests** time out on searches that are legitimately empty. Only a step that extracts values from
`items[...]` actually needs items to be present.

**Rendered output should look exactly like this** (`test_get_incident.py`, step 3):
```python
    response_3 = await await_eventually(
        lambda: client.post(
            url_3,
            json=body_3,
        ),
        operation_id='searchIncidents',
        method='POST',
    )
    assert response_3.status_code == 200, response_3.text
```

**Verify:** regenerate, then `python -m py_compile` on every file (no output), then a live run.
The 244 endpoint files contain about 500 `await await_eventually(` calls.

**Commit:** `fix(python-sdk): poll eventually-consistent reads like the Playwright suite`

## P4: Unit tests for P1 to P3

Create `tests/codegen/python-sdk-live-fixes.test.ts`. It was run against the code above:
**all 3 tests fail on `main` and pass after P1 to P3.**
```ts
import { describe, expect, test } from 'vitest';
import { renderPythonSuite } from '../../materializer/src/python-sdk/emitter.js';
import type { EndpointScenarioCollection, RequestStep } from '../../path-analyser/src/types.ts';

function collectionOf(
  steps: RequestStep[],
  eventuallyConsistent: string[] = [],
): EndpointScenarioCollection {
  const last = steps[steps.length - 1];
  const ref = { operationId: last.operationId, method: last.method, path: last.pathTemplate };
  return {
    endpoint: ref,
    requiredSemanticTypes: [],
    optionalSemanticTypes: [],
    scenarios: [
      {
        id: 'feature-1',
        name: 'live broker fixes',
        operations: steps.map((s) => ({
          operationId: s.operationId,
          method: s.method,
          path: s.pathTemplate,
          eventuallyConsistent: eventuallyConsistent.includes(s.operationId),
        })),
        producedSemanticTypes: [],
        satisfiedSemanticTypes: [],
        requestPlan: steps,
      },
    ],
  };
}

describe('python-sdk emitter: live-broker fixes', () => {
  test('status assertions carry the response body so broker errors are visible', () => {
    const out = renderPythonSuite(
      collectionOf([
        {
          operationId: 'getTopology',
          method: 'GET',
          pathTemplate: '/topology',
          expect: { status: 200 },
        },
      ]),
    );
    expect(out).toContain('assert response_1.status_code == 200, response_1.text');
  });

  test('document uploads with no planned files send a placeholder file (empty files -> 415)', () => {
    for (const [operationId, field] of [
      ['createDocument', 'file'],
      ['createDocuments', 'files'],
    ] as const) {
      const out = renderPythonSuite(
        collectionOf([
          {
            operationId,
            method: 'POST',
            pathTemplate: '/documents',
            bodyKind: 'multipart',
            multipartTemplate: { fields: {}, files: {} },
            expect: { status: 201 },
          },
        ]),
      );
      expect(out).toContain(`files_1 = {'${field}': ('hello.txt', b'Hello, world!')}`);
    }
  });

  test('eventually-consistent search steps poll; only extracting steps require items', () => {
    const out = renderPythonSuite(
      collectionOf(
        [
          {
            operationId: 'searchIncidents',
            method: 'POST',
            pathTemplate: '/incidents/search',
            bodyKind: 'json',
            bodyTemplate: {},
            extract: [{ fieldPath: 'items[0].incidentKey', bind: 'incidentKeyVar' }],
            expect: { status: 200 },
          },
          {
            operationId: 'searchJobs',
            method: 'POST',
            pathTemplate: '/jobs/search',
            bodyKind: 'json',
            bodyTemplate: {},
            expect: { status: 200 },
          },
        ],
        ['searchIncidents', 'searchJobs'],
      ),
    );
    expect(out).toContain('from support.await_eventually import await_eventually');
    expect(out).toContain('response_1 = await await_eventually(');
    expect(out).toContain("operation_id='searchIncidents',");
    const step2 = out.slice(out.indexOf('# Step 2'));
    expect(step2).toContain('require_items=False,');
    expect(out.slice(0, out.indexOf('# Step 2'))).not.toContain('require_items=False');
  });
});
```
Run: `npx vitest run tests/codegen/python-sdk-live-fixes.test.ts tests/codegen/python-sdk-emitter.test.ts`

**Expected:** 3/3 and 57/57 pass.

Ideally commit this file **before** P1 (red), then commit each fix.

---

## P5: Remaining failure classes (investigation, not copy-paste)

These were measured after S2 + S3 + P1 to P3 on the **8.9** broker. With P1 done, every failure
message now carries the broker's `detail`. Group the failures with
`attribute-test-failures.ts`, take the biggest bucket first, and use `--list <op>` to get the
test names.

| Message (from broker detail) | Likely cause | Where to look |
|---|---|---|
| `No endpoint POST /v2/agent-...`, `Method 'POST' is not supported` (`/process-instances/suspension`, `/resumption`, `/resources/search`, `/jobs/batch-update`) | 8.10+ endpoints on an 8.9 broker | Do S1 first, then re-measure |
| `The provided tag 'null' is not valid` | `tagVar` is `__PENDING__` with no producer that ever sets tags (e.g. extracted from `createProcessInstance.tags[0]`, but no step sends tags) | Planner, `bindSemanticInput` / client-minted attribute path. Tags should be **minted and set** on the producer's request (`createProcessInstance.tags`), not extracted. |
| `Expected to handle request Deploy Resources with tenant identifier 'tenant...'` | Chain `createTenant -> createDeployment(tenantId)` on a broker with multi-tenancy **disabled** | Either run a multi-tenancy-enabled broker (the env var is not confirmed for 8.9/8.10) or suppress these scenarios. **Needs sign-off.** |
| `Request property [filter.$or] cannot be parsed` | Body sends `$or: [{...: null}]` built from an unbound binding | Look at the variant body in `variant-output`: the `$or` leaf needs a real value or must be omitted |
| `At least one of filter criteria is required` | Batch-operation filter body is `{}` | Planner/`request-defaults.json` (**needs sign-off**) |
| `Command 'REMOVE_ENTITY' rejected ... NOT_FOUND` on `unassign*` | The chain never runs the matching `assign*` first | Planner, `scenarioGenerator.ts`: an `unassign*` endpoint needs the `assign*` edge op as a prerequisite |

## P6: Decision on whether this should test the Python SDK itself (needs the owner's decision)

- **Option A (no code):** keep it as a raw-REST suite. Rename or document it as such, and
  remove the unused `camunda-orchestration-sdk` dependency and operation-map plumbing. Note
  that it then overlaps heavily with the Playwright suite.
- **Option B (large):** make it call the real Python SDK, like the C# target: map
  operationId to the SDK method via `spec/python-sdk/operation-map.json`, fetched with the
  emitter's `sdkMap` (`camunda/orchestration-cluster-api-python`). Build the same
  reflection-dump plus table-checker tooling that C# has (`csharp-sdk/tools/reflect-sdk-methods`,
  `scripts/check-csharp-emitter-tables.ts`) **before** writing emitter code, so method names
  are never guessed. Presence coverage will then honestly drop to whatever the SDK exposes.

Don't start Option B without this decision.