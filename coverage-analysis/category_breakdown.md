# api-test-generator — Per-category breakdown

Total test declarations: **1596** across **37** entities.

This file answers, per category: **(1) Form** (the canonical sequence), **(2) Prerequisite to create**, **(3) Observation channel split** (GET vs Search), **(4) Variants with counts**, **(5) The actual tests in that category**.

Categories and the entity → category mapping mirror the upstream `c8-orchestration-cluster-e2e-test-suite/coverage-analysis/category_breakdown.md` so the two files can be diffed side-by-side.

## Table of contents

- [A. Entity Lifecycle (CRUD)](#a-entity-lifecycle-crud) — 344 tests
- [B. Membership/Association](#b-membershipassociation) — 170 tests
- [C. Deployment Lifecycle](#c-deployment-lifecycle) — 161 tests
- [D. Process-Instance Lifecycle & Ops](#d-process-instance-lifecycle--ops) — 283 tests
- [E. Batch-Operation Lifecycle](#e-batch-operation-lifecycle) — 25 tests
- [F. User-Task Lifecycle](#f-user-task-lifecycle) — 71 tests
- [G. Job Lifecycle & Stats](#g-job-lifecycle--stats) — 142 tests
- [H. Incident Lifecycle](#h-incident-lifecycle) — 41 tests
- [I. Decision-Instance Lifecycle](#i-decision-instance-lifecycle) — 72 tests
- [J/K/L. Observation-only](#jkl-observation-only) — 104 tests
- [M. Messaging/Signals](#m-messagingsignals) — 70 tests
- [N. Engine Evaluation](#n-engine-evaluation) — 27 tests
- [O. System/Admin](#o-systemadmin) — 36 tests
- [P. Agent-Instance (new in v2)](#p-agent-instance-new-in-v2) — 50 tests

## A. Entity Lifecycle (CRUD)

**Form**: Create Entity → Get Entity (Observe Present) → Update Entity → Search Entity (Observe via list) → Delete Entity → Get Entity (Observe Absence)

**Total tests**: 344

### `cluster-variables` — 59 tests

- **Prerequisite to create**: none
- **Files**: `request-validation/rbac/clustervariables-validation-api-tests.spec.ts`, `request-validation/unsecured/clustervariables-validation-api-tests.spec.ts`, `searchClusterVariables.feature.spec.ts`, `searchClusterVariables.variant.spec.ts`, `templates/EntityLifecycle/GlobalClusterVariable.lifecycle.spec.ts`, `templates/EntityLifecycle/TenantClusterVariable.lifecycle.spec.ts`, `updateGlobalClusterVariable.feature.spec.ts`, `updateTenantClusterVariable.feature.spec.ts`
- **Observation channel**: GET = 0, Search = 3
- **Form-step counts**: observe-present-search=3, mutate=2, observe-absence=1, lifecycle=2, negative-create=25, negative-get=6, negative-update=11, negative-delete=3, negative-search=6
- **Variants**: happy-path=5, observe-absence=3, data-driven=2, bad-request=48, forbidden=1, not-found=2, pagination-sort=2

| form step | variants | file:line | test name |
|--|--|--|--|
| observe-present-search | happy-path | `searchClusterVariables.feature.spec.ts:12` | feature-1 - searchClusterVariables - base (1) |
| observe-present-search | data-driven, pagination-sort | `searchClusterVariables.variant.spec.ts:12` | variant-1 - searchClusterVariables - path #1 |
| observe-present-search | data-driven, pagination-sort | `searchClusterVariables.variant.spec.ts:64` | variant-2 - searchClusterVariables - path #1 |
| mutate | happy-path | `updateGlobalClusterVariable.feature.spec.ts:11` | feature-1 - updateGlobalClusterVariable - base (1) |
| mutate | happy-path | `updateTenantClusterVariable.feature.spec.ts:11` | feature-1 - updateTenantClusterVariable - base (1) |
| observe-absence | observe-absence | `searchClusterVariables.feature.spec.ts:36` | feature-2 - searchClusterVariables - negative empty (2) |
| lifecycle | happy-path, observe-absence | `templates/EntityLifecycle/GlobalClusterVariable.lifecycle.spec.ts:9` | establish GlobalClusterVariable, observe present, revoke, observe absent |
| lifecycle | happy-path, observe-absence | `templates/EntityLifecycle/TenantClusterVariable.lifecycle.spec.ts:9` | establish TenantClusterVariable, observe present, revoke, observe absent |
| negative-create | bad-request | `request-validation/unsecured/clustervariables-validation-api-tests.spec.ts:18` | createGlobalClusterVariable - Additional prop __extraField |
| negative-create | bad-request | `request-validation/unsecured/clustervariables-validation-api-tests.spec.ts:39` | createGlobalClusterVariable - Body wrong top-level type |
| negative-create | bad-request | `request-validation/unsecured/clustervariables-validation-api-tests.spec.ts:54` | createGlobalClusterVariable - Param name wrong type (#1) |
| negative-create | bad-request | `request-validation/unsecured/clustervariables-validation-api-tests.spec.ts:74` | createGlobalClusterVariable - Param name wrong type (#2) |
| negative-create | bad-request | `request-validation/unsecured/clustervariables-validation-api-tests.spec.ts:94` | createGlobalClusterVariable - Constraint violation name (#1) |
| negative-create | bad-request | `request-validation/unsecured/clustervariables-validation-api-tests.spec.ts:114` | createGlobalClusterVariable - Constraint violation name (#2) |
| negative-create | bad-request | `request-validation/unsecured/clustervariables-validation-api-tests.spec.ts:134` | createGlobalClusterVariable - Constraint violation name (#3) |
| negative-create | bad-request | `request-validation/unsecured/clustervariables-validation-api-tests.spec.ts:154` | createGlobalClusterVariable - Constraint violation name (#4) |
| negative-create | bad-request | `request-validation/unsecured/clustervariables-validation-api-tests.spec.ts:174` | createGlobalClusterVariable - Missing name |
| negative-create | bad-request | `request-validation/unsecured/clustervariables-validation-api-tests.spec.ts:191` | createGlobalClusterVariable - Missing value |
| negative-create | bad-request | `request-validation/unsecured/clustervariables-validation-api-tests.spec.ts:208` | createGlobalClusterVariable - Missing body |
| negative-create | bad-request | `request-validation/unsecured/clustervariables-validation-api-tests.spec.ts:220` | createGlobalClusterVariable - Missing combo name,value |
| negative-create | bad-request | `request-validation/unsecured/clustervariables-validation-api-tests.spec.ts:235` | createTenantClusterVariable - Additional prop __extraField |
| negative-create | bad-request | `request-validation/unsecured/clustervariables-validation-api-tests.spec.ts:258` | createTenantClusterVariable - Body wrong top-level type |
| negative-create | bad-request | `request-validation/unsecured/clustervariables-validation-api-tests.spec.ts:275` | createTenantClusterVariable - Param name wrong type (#1) |
| negative-create | bad-request | `request-validation/unsecured/clustervariables-validation-api-tests.spec.ts:297` | createTenantClusterVariable - Param name wrong type (#2) |
| negative-create | bad-request | `request-validation/unsecured/clustervariables-validation-api-tests.spec.ts:319` | createTenantClusterVariable - Constraint violation name (#1) |
| negative-create | bad-request | `request-validation/unsecured/clustervariables-validation-api-tests.spec.ts:341` | createTenantClusterVariable - Constraint violation name (#2) |
| negative-create | bad-request | `request-validation/unsecured/clustervariables-validation-api-tests.spec.ts:363` | createTenantClusterVariable - Constraint violation name (#3) |
| negative-create | bad-request | `request-validation/unsecured/clustervariables-validation-api-tests.spec.ts:385` | createTenantClusterVariable - Constraint violation name (#4) |
| negative-create | bad-request | `request-validation/unsecured/clustervariables-validation-api-tests.spec.ts:407` | createTenantClusterVariable - Missing name |
| negative-create | bad-request | `request-validation/unsecured/clustervariables-validation-api-tests.spec.ts:426` | createTenantClusterVariable - Missing value |
| negative-create | bad-request | `request-validation/unsecured/clustervariables-validation-api-tests.spec.ts:445` | createTenantClusterVariable - Missing body |
| negative-create | bad-request | `request-validation/unsecured/clustervariables-validation-api-tests.spec.ts:459` | createTenantClusterVariable - Missing combo name,value |
| negative-create | bad-request | `request-validation/unsecured/clustervariables-validation-api-tests.spec.ts:476` | createTenantClusterVariable - Path param tenantId pattern violation |
| negative-get | forbidden | `request-validation/rbac/clustervariables-validation-api-tests.spec.ts:18` | getGlobalClusterVariable - Denied (no permission) |
| negative-get | not-found | `request-validation/unsecured/clustervariables-validation-api-tests.spec.ts:540` | getGlobalClusterVariable - Nonexistent name returns 404 |
| negative-get | bad-request | `request-validation/unsecured/clustervariables-validation-api-tests.spec.ts:554` | getGlobalClusterVariable - Path param name pattern violation |
| negative-get | not-found | `request-validation/unsecured/clustervariables-validation-api-tests.spec.ts:568` | getTenantClusterVariable - Nonexistent tenantId+name returns 404 |
| negative-get | bad-request | `request-validation/unsecured/clustervariables-validation-api-tests.spec.ts:585` | getTenantClusterVariable - Path param name pattern violation |
| negative-get | bad-request | `request-validation/unsecured/clustervariables-validation-api-tests.spec.ts:602` | getTenantClusterVariable - Path param tenantId pattern violation |
| negative-update | bad-request | `request-validation/unsecured/clustervariables-validation-api-tests.spec.ts:728` | updateGlobalClusterVariable - Additional prop __extraField |
| negative-update | bad-request | `request-validation/unsecured/clustervariables-validation-api-tests.spec.ts:748` | updateGlobalClusterVariable - Body wrong top-level type |
| negative-update | bad-request | `request-validation/unsecured/clustervariables-validation-api-tests.spec.ts:763` | updateGlobalClusterVariable - Missing value |
| negative-update | bad-request | `request-validation/unsecured/clustervariables-validation-api-tests.spec.ts:778` | updateGlobalClusterVariable - Missing body |
| negative-update | bad-request | `request-validation/unsecured/clustervariables-validation-api-tests.spec.ts:790` | updateGlobalClusterVariable - Path param name pattern violation |
| negative-update | bad-request | `request-validation/unsecured/clustervariables-validation-api-tests.spec.ts:804` | updateTenantClusterVariable - Additional prop __extraField |
| negative-update | bad-request | `request-validation/unsecured/clustervariables-validation-api-tests.spec.ts:827` | updateTenantClusterVariable - Body wrong top-level type |
| negative-update | bad-request | `request-validation/unsecured/clustervariables-validation-api-tests.spec.ts:845` | updateTenantClusterVariable - Missing value |
| negative-update | bad-request | `request-validation/unsecured/clustervariables-validation-api-tests.spec.ts:863` | updateTenantClusterVariable - Missing body |
| negative-update | bad-request | `request-validation/unsecured/clustervariables-validation-api-tests.spec.ts:878` | updateTenantClusterVariable - Path param name pattern violation |
| negative-update | bad-request | `request-validation/unsecured/clustervariables-validation-api-tests.spec.ts:895` | updateTenantClusterVariable - Path param tenantId pattern violation |
| negative-delete | bad-request | `request-validation/unsecured/clustervariables-validation-api-tests.spec.ts:492` | deleteGlobalClusterVariable - Path param name pattern violation |
| negative-delete | bad-request | `request-validation/unsecured/clustervariables-validation-api-tests.spec.ts:506` | deleteTenantClusterVariable - Path param name pattern violation |
| negative-delete | bad-request | `request-validation/unsecured/clustervariables-validation-api-tests.spec.ts:523` | deleteTenantClusterVariable - Path param tenantId pattern violation |
| negative-search | bad-request | `request-validation/unsecured/clustervariables-validation-api-tests.spec.ts:619` | searchClusterVariables - Additional prop __unexpectedField |
| negative-search | bad-request | `request-validation/unsecured/clustervariables-validation-api-tests.spec.ts:638` | searchClusterVariables - Body wrong top-level type |
| negative-search | bad-request | `request-validation/unsecured/clustervariables-validation-api-tests.spec.ts:653` | searchClusterVariables - Missing sort.0.field |
| negative-search | bad-request | `request-validation/unsecured/clustervariables-validation-api-tests.spec.ts:670` | searchClusterVariables - Enum violation sort.0.field |
| negative-search | bad-request | `request-validation/unsecured/clustervariables-validation-api-tests.spec.ts:691` | searchClusterVariables - Enum violation sort.0.order |
| negative-search | bad-request | `request-validation/unsecured/clustervariables-validation-api-tests.spec.ts:712` | searchClusterVariables - Param query.truncateValues wrong type |

### `mapping-rule` — 48 tests

- **Prerequisite to create**: none
- **Files**: `request-validation/rbac/mappingrules-validation-api-tests.spec.ts`, `request-validation/unsecured/mappingrules-validation-api-tests.spec.ts`, `searchMappingRule.feature.spec.ts`, `searchMappingRule.variant.spec.ts`, `templates/EntityLifecycle/MappingRule.lifecycle.spec.ts`, `updateMappingRule.feature.spec.ts`
- **Observation channel**: GET = 0, Search = 4
- **Form-step counts**: observe-present-search=4, mutate=1, observe-absence=1, lifecycle=1, negative-create=20, negative-get=3, negative-update=12, negative-delete=1, negative-search=5
- **Variants**: happy-path=3, observe-absence=2, data-driven=3, bad-request=39, forbidden=1, not-found=1, pagination-sort=2, filter=1

| form step | variants | file:line | test name |
|--|--|--|--|
| observe-present-search | happy-path | `searchMappingRule.feature.spec.ts:12` | feature-1 - searchMappingRule - base (1) |
| observe-present-search | data-driven, filter | `searchMappingRule.variant.spec.ts:12` | variant-1 - searchMappingRule - path #1 |
| observe-present-search | data-driven, pagination-sort | `searchMappingRule.variant.spec.ts:101` | variant-2 - searchMappingRule - path #1 |
| observe-present-search | data-driven, pagination-sort | `searchMappingRule.variant.spec.ts:153` | variant-3 - searchMappingRule - path #1 |
| mutate | happy-path | `updateMappingRule.feature.spec.ts:11` | feature-1 - updateMappingRule - base (1) |
| observe-absence | observe-absence | `searchMappingRule.feature.spec.ts:36` | feature-2 - searchMappingRule - negative empty (2) |
| lifecycle | happy-path, observe-absence | `templates/EntityLifecycle/MappingRule.lifecycle.spec.ts:9` | establish MappingRule, observe present, revoke, observe absent |
| negative-create | bad-request | `request-validation/unsecured/mappingrules-validation-api-tests.spec.ts:18` | createMappingRule - Additional prop __unexpectedField |
| negative-create | bad-request | `request-validation/unsecured/mappingrules-validation-api-tests.spec.ts:39` | createMappingRule - Body wrong top-level type |
| negative-create | bad-request | `request-validation/unsecured/mappingrules-validation-api-tests.spec.ts:54` | createMappingRule - Param claimName wrong type (#1) |
| negative-create | bad-request | `request-validation/unsecured/mappingrules-validation-api-tests.spec.ts:74` | createMappingRule - Param claimName wrong type (#2) |
| negative-create | bad-request | `request-validation/unsecured/mappingrules-validation-api-tests.spec.ts:94` | createMappingRule - Param claimValue wrong type (#1) |
| negative-create | bad-request | `request-validation/unsecured/mappingrules-validation-api-tests.spec.ts:114` | createMappingRule - Param claimValue wrong type (#2) |
| negative-create | bad-request | `request-validation/unsecured/mappingrules-validation-api-tests.spec.ts:134` | createMappingRule - Param mappingRuleId wrong type (#1) |
| negative-create | bad-request | `request-validation/unsecured/mappingrules-validation-api-tests.spec.ts:154` | createMappingRule - Param mappingRuleId wrong type (#2) |
| negative-create | bad-request | `request-validation/unsecured/mappingrules-validation-api-tests.spec.ts:174` | createMappingRule - Param name wrong type (#1) |
| negative-create | bad-request | `request-validation/unsecured/mappingrules-validation-api-tests.spec.ts:194` | createMappingRule - Param name wrong type (#2) |
| negative-create | bad-request | `request-validation/unsecured/mappingrules-validation-api-tests.spec.ts:214` | createMappingRule - Constraint violation mappingRuleId (#1) |
| negative-create | bad-request | `request-validation/unsecured/mappingrules-validation-api-tests.spec.ts:237` | createMappingRule - Constraint violation mappingRuleId (#2) |
| negative-create | bad-request | `request-validation/unsecured/mappingrules-validation-api-tests.spec.ts:259` | createMappingRule - Constraint violation mappingRuleId (#3) |
| negative-create | bad-request | `request-validation/unsecured/mappingrules-validation-api-tests.spec.ts:281` | createMappingRule - Constraint violation mappingRuleId (#4) |
| negative-create | bad-request | `request-validation/unsecured/mappingrules-validation-api-tests.spec.ts:304` | createMappingRule - Missing claimName |
| negative-create | bad-request | `request-validation/unsecured/mappingrules-validation-api-tests.spec.ts:323` | createMappingRule - Missing claimValue |
| negative-create | bad-request | `request-validation/unsecured/mappingrules-validation-api-tests.spec.ts:342` | createMappingRule - Missing mappingRuleId (#1) |
| negative-create | bad-request | `request-validation/unsecured/mappingrules-validation-api-tests.spec.ts:361` | createMappingRule - Missing name |
| negative-create | bad-request | `request-validation/unsecured/mappingrules-validation-api-tests.spec.ts:380` | createMappingRule - Missing mappingRuleId (#2) |
| negative-create | bad-request | `request-validation/unsecured/mappingrules-validation-api-tests.spec.ts:395` | createMappingRule - Missing body |
| negative-get | forbidden | `request-validation/rbac/mappingrules-validation-api-tests.spec.ts:18` | getMappingRule - Denied (no permission) |
| negative-get | not-found | `request-validation/unsecured/mappingrules-validation-api-tests.spec.ts:423` | getMappingRule - Nonexistent mappingRuleId returns 404 |
| negative-get | bad-request | `request-validation/unsecured/mappingrules-validation-api-tests.spec.ts:437` | getMappingRule - Path param mappingRuleId pattern violation |
| negative-update | bad-request | `request-validation/unsecured/mappingrules-validation-api-tests.spec.ts:544` | updateMappingRule - Additional prop __extraField |
| negative-update | bad-request | `request-validation/unsecured/mappingrules-validation-api-tests.spec.ts:566` | updateMappingRule - Body wrong top-level type |
| negative-update | bad-request | `request-validation/unsecured/mappingrules-validation-api-tests.spec.ts:583` | updateMappingRule - Param claimName wrong type (#1) |
| negative-update | bad-request | `request-validation/unsecured/mappingrules-validation-api-tests.spec.ts:604` | updateMappingRule - Param claimName wrong type (#2) |
| negative-update | bad-request | `request-validation/unsecured/mappingrules-validation-api-tests.spec.ts:625` | updateMappingRule - Param claimValue wrong type (#1) |
| negative-update | bad-request | `request-validation/unsecured/mappingrules-validation-api-tests.spec.ts:646` | updateMappingRule - Param claimValue wrong type (#2) |
| negative-update | bad-request | `request-validation/unsecured/mappingrules-validation-api-tests.spec.ts:667` | updateMappingRule - Param name wrong type (#1) |
| negative-update | bad-request | `request-validation/unsecured/mappingrules-validation-api-tests.spec.ts:688` | updateMappingRule - Param name wrong type (#2) |
| negative-update | bad-request | `request-validation/unsecured/mappingrules-validation-api-tests.spec.ts:709` | updateMappingRule - Missing claimName |
| negative-update | bad-request | `request-validation/unsecured/mappingrules-validation-api-tests.spec.ts:729` | updateMappingRule - Missing claimValue |
| negative-update | bad-request | `request-validation/unsecured/mappingrules-validation-api-tests.spec.ts:749` | updateMappingRule - Missing name |
| negative-update | bad-request | `request-validation/unsecured/mappingrules-validation-api-tests.spec.ts:769` | updateMappingRule - Path param mappingRuleId pattern violation |
| negative-delete | bad-request | `request-validation/unsecured/mappingrules-validation-api-tests.spec.ts:407` | deleteMappingRule - Path param mappingRuleId pattern violation |
| negative-search | bad-request | `request-validation/unsecured/mappingrules-validation-api-tests.spec.ts:453` | searchMappingRule - Additional prop __unexpectedField |
| negative-search | bad-request | `request-validation/unsecured/mappingrules-validation-api-tests.spec.ts:470` | searchMappingRule - Body wrong top-level type |
| negative-search | bad-request | `request-validation/unsecured/mappingrules-validation-api-tests.spec.ts:485` | searchMappingRule - Missing sort.0.field |
| negative-search | bad-request | `request-validation/unsecured/mappingrules-validation-api-tests.spec.ts:502` | searchMappingRule - Enum violation sort.0.field |
| negative-search | bad-request | `request-validation/unsecured/mappingrules-validation-api-tests.spec.ts:523` | searchMappingRule - Enum violation sort.0.order |

### `global-task-listener` — 47 tests

- **Prerequisite to create**: none
- **Files**: `request-validation/rbac/globaltasklisteners-validation-api-tests.spec.ts`, `request-validation/unsecured/globaltasklisteners-validation-api-tests.spec.ts`, `searchGlobalTaskListeners.feature.spec.ts`, `searchGlobalTaskListeners.variant.spec.ts`, `templates/EntityLifecycle/GlobalTaskListener.lifecycle.spec.ts`, `updateGlobalTaskListener.feature.spec.ts`
- **Observation channel**: GET = 0, Search = 3
- **Form-step counts**: observe-present-search=3, mutate=1, observe-absence=1, lifecycle=1, negative-create=21, negative-get=3, negative-update=11, negative-delete=1, negative-search=5
- **Variants**: happy-path=3, observe-absence=2, data-driven=2, bad-request=39, forbidden=1, not-found=1, pagination-sort=2

| form step | variants | file:line | test name |
|--|--|--|--|
| observe-present-search | happy-path | `searchGlobalTaskListeners.feature.spec.ts:12` | feature-1 - searchGlobalTaskListeners - base (1) |
| observe-present-search | data-driven, pagination-sort | `searchGlobalTaskListeners.variant.spec.ts:12` | variant-1 - searchGlobalTaskListeners - path #1 |
| observe-present-search | data-driven, pagination-sort | `searchGlobalTaskListeners.variant.spec.ts:64` | variant-2 - searchGlobalTaskListeners - path #1 |
| mutate | happy-path | `updateGlobalTaskListener.feature.spec.ts:11` | feature-1 - updateGlobalTaskListener - base (1) |
| observe-absence | observe-absence | `searchGlobalTaskListeners.feature.spec.ts:36` | feature-2 - searchGlobalTaskListeners - negative empty (2) |
| lifecycle | happy-path, observe-absence | `templates/EntityLifecycle/GlobalTaskListener.lifecycle.spec.ts:9` | establish GlobalTaskListener, observe present, revoke, observe absent |
| negative-create | bad-request | `request-validation/unsecured/globaltasklisteners-validation-api-tests.spec.ts:18` | createGlobalTaskListener - Additional prop __extraField |
| negative-create | bad-request | `request-validation/unsecured/globaltasklisteners-validation-api-tests.spec.ts:38` | createGlobalTaskListener - Body wrong top-level type |
| negative-create | bad-request | `request-validation/unsecured/globaltasklisteners-validation-api-tests.spec.ts:53` | createGlobalTaskListener - Param id wrong type (#1) |
| negative-create | bad-request | `request-validation/unsecured/globaltasklisteners-validation-api-tests.spec.ts:72` | createGlobalTaskListener - Param id wrong type (#2) |
| negative-create | bad-request | `request-validation/unsecured/globaltasklisteners-validation-api-tests.spec.ts:91` | createGlobalTaskListener - Param type wrong type (#1) |
| negative-create | bad-request | `request-validation/unsecured/globaltasklisteners-validation-api-tests.spec.ts:110` | createGlobalTaskListener - Param type wrong type (#2) |
| negative-create | bad-request | `request-validation/unsecured/globaltasklisteners-validation-api-tests.spec.ts:129` | createGlobalTaskListener - Constraint violation id (#1) |
| negative-create | bad-request | `request-validation/unsecured/globaltasklisteners-validation-api-tests.spec.ts:148` | createGlobalTaskListener - Constraint violation id (#2) |
| negative-create | bad-request | `request-validation/unsecured/globaltasklisteners-validation-api-tests.spec.ts:167` | createGlobalTaskListener - Constraint violation id (#3) |
| negative-create | bad-request | `request-validation/unsecured/globaltasklisteners-validation-api-tests.spec.ts:186` | createGlobalTaskListener - Constraint violation id (#4) |
| negative-create | bad-request | `request-validation/unsecured/globaltasklisteners-validation-api-tests.spec.ts:205` | createGlobalTaskListener - Missing id (#1) |
| negative-create | bad-request | `request-validation/unsecured/globaltasklisteners-validation-api-tests.spec.ts:223` | createGlobalTaskListener - Missing type (#1) |
| negative-create | bad-request | `request-validation/unsecured/globaltasklisteners-validation-api-tests.spec.ts:241` | createGlobalTaskListener - Enum violation eventTypes.0 |
| negative-create | bad-request | `request-validation/unsecured/globaltasklisteners-validation-api-tests.spec.ts:260` | createGlobalTaskListener - Missing eventTypes |
| negative-create | bad-request | `request-validation/unsecured/globaltasklisteners-validation-api-tests.spec.ts:278` | createGlobalTaskListener - Missing id (#2) |
| negative-create | bad-request | `request-validation/unsecured/globaltasklisteners-validation-api-tests.spec.ts:296` | createGlobalTaskListener - Missing type (#2) |
| negative-create | bad-request | `request-validation/unsecured/globaltasklisteners-validation-api-tests.spec.ts:314` | createGlobalTaskListener - Missing body |
| negative-create | bad-request | `request-validation/unsecured/globaltasklisteners-validation-api-tests.spec.ts:326` | createGlobalTaskListener - Missing combo id,eventTypes |
| negative-create | bad-request | `request-validation/unsecured/globaltasklisteners-validation-api-tests.spec.ts:343` | createGlobalTaskListener - Missing combo id,type |
| negative-create | bad-request | `request-validation/unsecured/globaltasklisteners-validation-api-tests.spec.ts:360` | createGlobalTaskListener - Missing combo id,type,eventTypes |
| negative-create | bad-request | `request-validation/unsecured/globaltasklisteners-validation-api-tests.spec.ts:377` | createGlobalTaskListener - Missing combo type,eventTypes |
| negative-get | forbidden | `request-validation/rbac/globaltasklisteners-validation-api-tests.spec.ts:18` | getGlobalTaskListener - Denied (no permission) |
| negative-get | not-found | `request-validation/unsecured/globaltasklisteners-validation-api-tests.spec.ts:410` | getGlobalTaskListener - Nonexistent id returns 404 |
| negative-get | bad-request | `request-validation/unsecured/globaltasklisteners-validation-api-tests.spec.ts:424` | getGlobalTaskListener - Path param id pattern violation |
| negative-update | bad-request | `request-validation/unsecured/globaltasklisteners-validation-api-tests.spec.ts:529` | updateGlobalTaskListener - Additional prop __extraField |
| negative-update | bad-request | `request-validation/unsecured/globaltasklisteners-validation-api-tests.spec.ts:548` | updateGlobalTaskListener - Body wrong top-level type |
| negative-update | bad-request | `request-validation/unsecured/globaltasklisteners-validation-api-tests.spec.ts:563` | updateGlobalTaskListener - Param type wrong type (#1) |
| negative-update | bad-request | `request-validation/unsecured/globaltasklisteners-validation-api-tests.spec.ts:581` | updateGlobalTaskListener - Param type wrong type (#2) |
| negative-update | bad-request | `request-validation/unsecured/globaltasklisteners-validation-api-tests.spec.ts:599` | updateGlobalTaskListener - Missing type (#1) |
| negative-update | bad-request | `request-validation/unsecured/globaltasklisteners-validation-api-tests.spec.ts:616` | updateGlobalTaskListener - Enum violation eventTypes.0 |
| negative-update | bad-request | `request-validation/unsecured/globaltasklisteners-validation-api-tests.spec.ts:634` | updateGlobalTaskListener - Missing eventTypes |
| negative-update | bad-request | `request-validation/unsecured/globaltasklisteners-validation-api-tests.spec.ts:651` | updateGlobalTaskListener - Missing type (#2) |
| negative-update | bad-request | `request-validation/unsecured/globaltasklisteners-validation-api-tests.spec.ts:668` | updateGlobalTaskListener - Missing body |
| negative-update | bad-request | `request-validation/unsecured/globaltasklisteners-validation-api-tests.spec.ts:680` | updateGlobalTaskListener - Missing combo type,eventTypes |
| negative-update | bad-request | `request-validation/unsecured/globaltasklisteners-validation-api-tests.spec.ts:697` | updateGlobalTaskListener - Path param id pattern violation |
| negative-delete | bad-request | `request-validation/unsecured/globaltasklisteners-validation-api-tests.spec.ts:396` | deleteGlobalTaskListener - Path param id pattern violation |
| negative-search | bad-request | `request-validation/unsecured/globaltasklisteners-validation-api-tests.spec.ts:436` | searchGlobalTaskListeners - Additional prop __unexpectedField |
| negative-search | bad-request | `request-validation/unsecured/globaltasklisteners-validation-api-tests.spec.ts:455` | searchGlobalTaskListeners - Body wrong top-level type |
| negative-search | bad-request | `request-validation/unsecured/globaltasklisteners-validation-api-tests.spec.ts:470` | searchGlobalTaskListeners - Missing sort.0.field |
| negative-search | bad-request | `request-validation/unsecured/globaltasklisteners-validation-api-tests.spec.ts:487` | searchGlobalTaskListeners - Enum violation sort.0.field |
| negative-search | bad-request | `request-validation/unsecured/globaltasklisteners-validation-api-tests.spec.ts:508` | searchGlobalTaskListeners - Enum violation sort.0.order |

### `tenant` — 37 tests

- **Prerequisite to create**: none
- **Files**: `request-validation/rbac/tenants-validation-api-tests.spec.ts`, `request-validation/unsecured/tenants-validation-api-tests.spec.ts`, `searchTenants.feature.spec.ts`, `searchTenants.variant.spec.ts`, `templates/EntityLifecycle/Tenant.lifecycle.spec.ts`, `updateTenant.feature.spec.ts`
- **Observation channel**: GET = 0, Search = 4
- **Form-step counts**: observe-present-search=4, mutate=1, observe-absence=1, lifecycle=1, negative-create=14, negative-get=3, negative-update=7, negative-delete=1, negative-search=5
- **Variants**: happy-path=3, observe-absence=2, data-driven=3, bad-request=28, forbidden=1, not-found=1, pagination-sort=2, filter=1

| form step | variants | file:line | test name |
|--|--|--|--|
| observe-present-search | happy-path | `searchTenants.feature.spec.ts:12` | feature-1 - searchTenants - base (1) |
| observe-present-search | data-driven, filter | `searchTenants.variant.spec.ts:12` | variant-1 - searchTenants - path #1 |
| observe-present-search | data-driven, pagination-sort | `searchTenants.variant.spec.ts:58` | variant-2 - searchTenants - path #1 |
| observe-present-search | data-driven, pagination-sort | `searchTenants.variant.spec.ts:108` | variant-3 - searchTenants - path #1 |
| mutate | happy-path | `updateTenant.feature.spec.ts:11` | feature-1 - updateTenant - base (1) |
| observe-absence | observe-absence | `searchTenants.feature.spec.ts:34` | feature-2 - searchTenants - negative empty (2) |
| lifecycle | happy-path, observe-absence | `templates/EntityLifecycle/Tenant.lifecycle.spec.ts:9` | establish Tenant, observe present, revoke, observe absent |
| negative-create | bad-request | `request-validation/unsecured/tenants-validation-api-tests.spec.ts:189` | createTenant - Additional prop __unexpectedField |
| negative-create | bad-request | `request-validation/unsecured/tenants-validation-api-tests.spec.ts:208` | createTenant - Body wrong top-level type |
| negative-create | bad-request | `request-validation/unsecured/tenants-validation-api-tests.spec.ts:223` | createTenant - Param name wrong type (#1) |
| negative-create | bad-request | `request-validation/unsecured/tenants-validation-api-tests.spec.ts:241` | createTenant - Param name wrong type (#2) |
| negative-create | bad-request | `request-validation/unsecured/tenants-validation-api-tests.spec.ts:259` | createTenant - Param tenantId wrong type (#1) |
| negative-create | bad-request | `request-validation/unsecured/tenants-validation-api-tests.spec.ts:277` | createTenant - Param tenantId wrong type (#2) |
| negative-create | bad-request | `request-validation/unsecured/tenants-validation-api-tests.spec.ts:295` | createTenant - Constraint violation tenantId (#1) |
| negative-create | bad-request | `request-validation/unsecured/tenants-validation-api-tests.spec.ts:313` | createTenant - Constraint violation tenantId (#2) |
| negative-create | bad-request | `request-validation/unsecured/tenants-validation-api-tests.spec.ts:331` | createTenant - Constraint violation tenantId (#3) |
| negative-create | bad-request | `request-validation/unsecured/tenants-validation-api-tests.spec.ts:349` | createTenant - Constraint violation tenantId (#4) |
| negative-create | bad-request | `request-validation/unsecured/tenants-validation-api-tests.spec.ts:367` | createTenant - Missing name |
| negative-create | bad-request | `request-validation/unsecured/tenants-validation-api-tests.spec.ts:384` | createTenant - Missing tenantId |
| negative-create | bad-request | `request-validation/unsecured/tenants-validation-api-tests.spec.ts:401` | createTenant - Missing body |
| negative-create | bad-request | `request-validation/unsecured/tenants-validation-api-tests.spec.ts:413` | createTenant - Missing combo tenantId,name |
| negative-get | forbidden | `request-validation/rbac/tenants-validation-api-tests.spec.ts:18` | getTenant - Denied (no permission) |
| negative-get | not-found | `request-validation/unsecured/tenants-validation-api-tests.spec.ts:440` | getTenant - Nonexistent tenantId returns 404 |
| negative-get | bad-request | `request-validation/unsecured/tenants-validation-api-tests.spec.ts:454` | getTenant - Path param tenantId pattern violation |
| negative-update | bad-request | `request-validation/unsecured/tenants-validation-api-tests.spec.ts:1287` | updateTenant - Additional prop __unexpectedField |
| negative-update | bad-request | `request-validation/unsecured/tenants-validation-api-tests.spec.ts:1305` | updateTenant - Body wrong top-level type |
| negative-update | bad-request | `request-validation/unsecured/tenants-validation-api-tests.spec.ts:1320` | updateTenant - Param name wrong type (#1) |
| negative-update | bad-request | `request-validation/unsecured/tenants-validation-api-tests.spec.ts:1337` | updateTenant - Param name wrong type (#2) |
| negative-update | bad-request | `request-validation/unsecured/tenants-validation-api-tests.spec.ts:1354` | updateTenant - Missing name |
| negative-update | bad-request | `request-validation/unsecured/tenants-validation-api-tests.spec.ts:1369` | updateTenant - Missing body |
| negative-update | bad-request | `request-validation/unsecured/tenants-validation-api-tests.spec.ts:1381` | updateTenant - Path param tenantId pattern violation |
| negative-delete | bad-request | `request-validation/unsecured/tenants-validation-api-tests.spec.ts:428` | deleteTenant - Path param tenantId pattern violation |
| negative-search | bad-request | `request-validation/unsecured/tenants-validation-api-tests.spec.ts:916` | searchTenants - Additional prop __unexpectedField |
| negative-search | bad-request | `request-validation/unsecured/tenants-validation-api-tests.spec.ts:933` | searchTenants - Body wrong top-level type |
| negative-search | bad-request | `request-validation/unsecured/tenants-validation-api-tests.spec.ts:948` | searchTenants - Missing sort.0.field |
| negative-search | bad-request | `request-validation/unsecured/tenants-validation-api-tests.spec.ts:965` | searchTenants - Enum violation sort.0.field |
| negative-search | bad-request | `request-validation/unsecured/tenants-validation-api-tests.spec.ts:986` | searchTenants - Enum violation sort.0.order |

### `role` — 36 tests

- **Prerequisite to create**: none
- **Files**: `request-validation/rbac/roles-validation-api-tests.spec.ts`, `request-validation/unsecured/roles-validation-api-tests.spec.ts`, `searchRoles.feature.spec.ts`, `searchRoles.variant.spec.ts`, `templates/EntityLifecycle/Role.lifecycle.spec.ts`, `updateRole.feature.spec.ts`
- **Observation channel**: GET = 0, Search = 4
- **Form-step counts**: observe-present-search=4, mutate=1, observe-absence=1, lifecycle=1, negative-create=13, negative-get=3, negative-update=7, negative-delete=1, negative-search=5
- **Variants**: happy-path=3, observe-absence=2, data-driven=3, bad-request=27, forbidden=1, not-found=1, pagination-sort=2, filter=1

| form step | variants | file:line | test name |
|--|--|--|--|
| observe-present-search | happy-path | `searchRoles.feature.spec.ts:12` | feature-1 - searchRoles - base (1) |
| observe-present-search | data-driven, filter | `searchRoles.variant.spec.ts:12` | variant-1 - searchRoles - path #1 |
| observe-present-search | data-driven, pagination-sort | `searchRoles.variant.spec.ts:99` | variant-2 - searchRoles - path #1 |
| observe-present-search | data-driven, pagination-sort | `searchRoles.variant.spec.ts:149` | variant-3 - searchRoles - path #1 |
| mutate | happy-path | `updateRole.feature.spec.ts:11` | feature-1 - updateRole - base (1) |
| observe-absence | observe-absence | `searchRoles.feature.spec.ts:34` | feature-2 - searchRoles - negative empty (2) |
| lifecycle | happy-path, observe-absence | `templates/EntityLifecycle/Role.lifecycle.spec.ts:9` | establish Role, observe present, revoke, observe absent |
| negative-create | bad-request | `request-validation/unsecured/roles-validation-api-tests.spec.ts:151` | createRole - Additional prop __unexpectedField |
| negative-create | bad-request | `request-validation/unsecured/roles-validation-api-tests.spec.ts:170` | createRole - Body wrong top-level type |
| negative-create | bad-request | `request-validation/unsecured/roles-validation-api-tests.spec.ts:185` | createRole - Param name wrong type (#1) |
| negative-create | bad-request | `request-validation/unsecured/roles-validation-api-tests.spec.ts:203` | createRole - Param name wrong type (#2) |
| negative-create | bad-request | `request-validation/unsecured/roles-validation-api-tests.spec.ts:221` | createRole - Param roleId wrong type (#1) |
| negative-create | bad-request | `request-validation/unsecured/roles-validation-api-tests.spec.ts:239` | createRole - Param roleId wrong type (#2) |
| negative-create | bad-request | `request-validation/unsecured/roles-validation-api-tests.spec.ts:257` | createRole - Constraint violation roleId (#1) |
| negative-create | bad-request | `request-validation/unsecured/roles-validation-api-tests.spec.ts:276` | createRole - Constraint violation roleId (#2) |
| negative-create | bad-request | `request-validation/unsecured/roles-validation-api-tests.spec.ts:294` | createRole - Constraint violation roleId (#3) |
| negative-create | bad-request | `request-validation/unsecured/roles-validation-api-tests.spec.ts:312` | createRole - Constraint violation roleId (#4) |
| negative-create | bad-request | `request-validation/unsecured/roles-validation-api-tests.spec.ts:331` | createRole - Missing name |
| negative-create | bad-request | `request-validation/unsecured/roles-validation-api-tests.spec.ts:348` | createRole - Missing roleId |
| negative-create | bad-request | `request-validation/unsecured/roles-validation-api-tests.spec.ts:365` | createRole - Missing combo roleId,name |
| negative-get | forbidden | `request-validation/rbac/roles-validation-api-tests.spec.ts:18` | getRole - Denied (no permission) |
| negative-get | not-found | `request-validation/unsecured/roles-validation-api-tests.spec.ts:392` | getRole - Nonexistent roleId returns 404 |
| negative-get | bad-request | `request-validation/unsecured/roles-validation-api-tests.spec.ts:404` | getRole - Path param roleId pattern violation |
| negative-update | bad-request | `request-validation/unsecured/roles-validation-api-tests.spec.ts:1066` | updateRole - Additional prop __extraField |
| negative-update | bad-request | `request-validation/unsecured/roles-validation-api-tests.spec.ts:1084` | updateRole - Body wrong top-level type |
| negative-update | bad-request | `request-validation/unsecured/roles-validation-api-tests.spec.ts:1099` | updateRole - Param name wrong type (#1) |
| negative-update | bad-request | `request-validation/unsecured/roles-validation-api-tests.spec.ts:1116` | updateRole - Param name wrong type (#2) |
| negative-update | bad-request | `request-validation/unsecured/roles-validation-api-tests.spec.ts:1133` | updateRole - Missing name |
| negative-update | bad-request | `request-validation/unsecured/roles-validation-api-tests.spec.ts:1148` | updateRole - Missing body |
| negative-update | bad-request | `request-validation/unsecured/roles-validation-api-tests.spec.ts:1160` | updateRole - Path param roleId pattern violation |
| negative-delete | bad-request | `request-validation/unsecured/roles-validation-api-tests.spec.ts:380` | deleteRole - Path param roleId pattern violation |
| negative-search | bad-request | `request-validation/unsecured/roles-validation-api-tests.spec.ts:733` | searchRoles - Additional prop __unexpectedField |
| negative-search | bad-request | `request-validation/unsecured/roles-validation-api-tests.spec.ts:750` | searchRoles - Body wrong top-level type |
| negative-search | bad-request | `request-validation/unsecured/roles-validation-api-tests.spec.ts:765` | searchRoles - Missing sort.0.field |
| negative-search | bad-request | `request-validation/unsecured/roles-validation-api-tests.spec.ts:782` | searchRoles - Enum violation sort.0.field |
| negative-search | bad-request | `request-validation/unsecured/roles-validation-api-tests.spec.ts:803` | searchRoles - Enum violation sort.0.order |

### `group` — 34 tests

- **Prerequisite to create**: none
- **Files**: `request-validation/rbac/groups-validation-api-tests.spec.ts`, `request-validation/unsecured/groups-validation-api-tests.spec.ts`, `searchGroups.feature.spec.ts`, `searchGroups.variant.spec.ts`, `templates/EntityLifecycle/Group.lifecycle.spec.ts`, `updateGroup.feature.spec.ts`
- **Observation channel**: GET = 0, Search = 3
- **Form-step counts**: observe-present-search=3, mutate=1, observe-absence=1, lifecycle=1, negative-create=12, negative-get=3, negative-update=7, negative-delete=1, negative-search=5
- **Variants**: happy-path=3, observe-absence=2, data-driven=2, bad-request=26, forbidden=1, not-found=1, pagination-sort=2

| form step | variants | file:line | test name |
|--|--|--|--|
| observe-present-search | happy-path | `searchGroups.feature.spec.ts:12` | feature-1 - searchGroups - base (1) |
| observe-present-search | data-driven, pagination-sort | `searchGroups.variant.spec.ts:12` | variant-1 - searchGroups - path #1 |
| observe-present-search | data-driven, pagination-sort | `searchGroups.variant.spec.ts:62` | variant-2 - searchGroups - path #1 |
| mutate | happy-path | `updateGroup.feature.spec.ts:11` | feature-1 - updateGroup - base (1) |
| observe-absence | observe-absence | `searchGroups.feature.spec.ts:34` | feature-2 - searchGroups - negative empty (2) |
| lifecycle | happy-path, observe-absence | `templates/EntityLifecycle/Group.lifecycle.spec.ts:9` | establish Group, observe present, revoke, observe absent |
| negative-create | bad-request | `request-validation/unsecured/groups-validation-api-tests.spec.ts:123` | createGroup - Additional prop __unexpectedField |
| negative-create | bad-request | `request-validation/unsecured/groups-validation-api-tests.spec.ts:142` | createGroup - Body wrong top-level type |
| negative-create | bad-request | `request-validation/unsecured/groups-validation-api-tests.spec.ts:157` | createGroup - Param groupId wrong type (#1) |
| negative-create | bad-request | `request-validation/unsecured/groups-validation-api-tests.spec.ts:175` | createGroup - Param groupId wrong type (#2) |
| negative-create | bad-request | `request-validation/unsecured/groups-validation-api-tests.spec.ts:193` | createGroup - Param name wrong type (#1) |
| negative-create | bad-request | `request-validation/unsecured/groups-validation-api-tests.spec.ts:211` | createGroup - Param name wrong type (#2) |
| negative-create | bad-request | `request-validation/unsecured/groups-validation-api-tests.spec.ts:229` | createGroup - Constraint violation groupId (#1) |
| negative-create | bad-request | `request-validation/unsecured/groups-validation-api-tests.spec.ts:248` | createGroup - Constraint violation groupId (#2) |
| negative-create | bad-request | `request-validation/unsecured/groups-validation-api-tests.spec.ts:266` | createGroup - Constraint violation groupId (#3) |
| negative-create | bad-request | `request-validation/unsecured/groups-validation-api-tests.spec.ts:285` | createGroup - Missing groupId |
| negative-create | bad-request | `request-validation/unsecured/groups-validation-api-tests.spec.ts:302` | createGroup - Missing name |
| negative-create | bad-request | `request-validation/unsecured/groups-validation-api-tests.spec.ts:319` | createGroup - Missing combo groupId,name |
| negative-get | forbidden | `request-validation/rbac/groups-validation-api-tests.spec.ts:18` | getGroup - Denied (no permission) |
| negative-get | not-found | `request-validation/unsecured/groups-validation-api-tests.spec.ts:349` | getGroup - Nonexistent groupId returns 404 |
| negative-get | bad-request | `request-validation/unsecured/groups-validation-api-tests.spec.ts:361` | getGroup - Path param groupId length-max violation |
| negative-update | bad-request | `request-validation/unsecured/groups-validation-api-tests.spec.ts:1020` | updateGroup - Additional prop __extraField |
| negative-update | bad-request | `request-validation/unsecured/groups-validation-api-tests.spec.ts:1038` | updateGroup - Body wrong top-level type |
| negative-update | bad-request | `request-validation/unsecured/groups-validation-api-tests.spec.ts:1053` | updateGroup - Param name wrong type (#1) |
| negative-update | bad-request | `request-validation/unsecured/groups-validation-api-tests.spec.ts:1070` | updateGroup - Param name wrong type (#2) |
| negative-update | bad-request | `request-validation/unsecured/groups-validation-api-tests.spec.ts:1087` | updateGroup - Missing name |
| negative-update | bad-request | `request-validation/unsecured/groups-validation-api-tests.spec.ts:1102` | updateGroup - Missing body |
| negative-update | bad-request | `request-validation/unsecured/groups-validation-api-tests.spec.ts:1114` | updateGroup - Path param groupId length-max violation |
| negative-delete | bad-request | `request-validation/unsecured/groups-validation-api-tests.spec.ts:334` | deleteGroup - Path param groupId length-max violation |
| negative-search | bad-request | `request-validation/unsecured/groups-validation-api-tests.spec.ts:484` | searchGroups - Additional prop __unexpectedField |
| negative-search | bad-request | `request-validation/unsecured/groups-validation-api-tests.spec.ts:501` | searchGroups - Body wrong top-level type |
| negative-search | bad-request | `request-validation/unsecured/groups-validation-api-tests.spec.ts:516` | searchGroups - Missing sort.0.field |
| negative-search | bad-request | `request-validation/unsecured/groups-validation-api-tests.spec.ts:533` | searchGroups - Enum violation sort.0.field |
| negative-search | bad-request | `request-validation/unsecured/groups-validation-api-tests.spec.ts:554` | searchGroups - Enum violation sort.0.order |

### `authorization` — 33 tests

- **Prerequisite to create**: owner-entity-or-resource
- **Files**: `request-validation/unsecured/authorizations-validation-api-tests.spec.ts`, `searchAuthorizations.feature.spec.ts`, `searchAuthorizations.variant.spec.ts`, `templates/EntityLifecycle/Authorization.lifecycle.spec.ts`, `updateAuthorization.feature.spec.ts`
- **Observation channel**: GET = 0, Search = 3
- **Form-step counts**: observe-present-search=3, mutate=3, observe-absence=1, lifecycle=1, negative-create=7, negative-get=2, negative-update=8, negative-delete=1, negative-search=7
- **Variants**: happy-path=3, observe-absence=2, data-driven=4, bad-request=24, not-found=1, pagination-sort=2

| form step | variants | file:line | test name |
|--|--|--|--|
| observe-present-search | happy-path | `searchAuthorizations.feature.spec.ts:12` | feature-1 - searchAuthorizations - base (1) |
| observe-present-search | data-driven, pagination-sort | `searchAuthorizations.variant.spec.ts:12` | variant-1 - searchAuthorizations - path #1 |
| observe-present-search | data-driven, pagination-sort | `searchAuthorizations.variant.spec.ts:64` | variant-2 - searchAuthorizations - path #1 |
| mutate | happy-path | `updateAuthorization.feature.spec.ts:8` | feature-1 - updateAuthorization - base (1) |
| mutate | data-driven | `updateAuthorization.feature.spec.ts:52` | feature-2 - updateAuthorization - oneOf group0 variant1 (2) |
| mutate | data-driven | `updateAuthorization.feature.spec.ts:97` | feature-3 - updateAuthorization - oneOf group0 variant2 (3) |
| observe-absence | observe-absence | `searchAuthorizations.feature.spec.ts:36` | feature-2 - searchAuthorizations - negative empty (2) |
| lifecycle | happy-path, observe-absence | `templates/EntityLifecycle/Authorization.lifecycle.spec.ts:9` | establish Authorization, observe present, revoke, observe absent |
| negative-create | bad-request | `request-validation/unsecured/authorizations-validation-api-tests.spec.ts:18` | createAuthorization - Additional prop __extraField |
| negative-create | bad-request | `request-validation/unsecured/authorizations-validation-api-tests.spec.ts:35` | createAuthorization - Body wrong top-level type |
| negative-create | bad-request | `request-validation/unsecured/authorizations-validation-api-tests.spec.ts:50` | createAuthorization - Missing body |
| negative-create | bad-request | `request-validation/unsecured/authorizations-validation-api-tests.spec.ts:62` | createAuthorization - oneOf ambiguous |
| negative-create | bad-request | `request-validation/unsecured/authorizations-validation-api-tests.spec.ts:84` | createAuthorization - oneOf cross bleed |
| negative-create | bad-request | `request-validation/unsecured/authorizations-validation-api-tests.spec.ts:106` | createAuthorization - oneOf none match |
| negative-create | bad-request | `request-validation/unsecured/authorizations-validation-api-tests.spec.ts:127` | createAuthorization - oneOf violation |
| negative-get | not-found | `request-validation/unsecured/authorizations-validation-api-tests.spec.ts:165` | getAuthorization - Nonexistent authorizationKey returns 404 |
| negative-get | bad-request | `request-validation/unsecured/authorizations-validation-api-tests.spec.ts:181` | getAuthorization - Path param authorizationKey pattern violation |
| negative-update | bad-request | `request-validation/unsecured/authorizations-validation-api-tests.spec.ts:330` | updateAuthorization - Additional prop __extraField |
| negative-update | bad-request | `request-validation/unsecured/authorizations-validation-api-tests.spec.ts:349` | updateAuthorization - Body wrong top-level type |
| negative-update | bad-request | `request-validation/unsecured/authorizations-validation-api-tests.spec.ts:366` | updateAuthorization - Missing body |
| negative-update | bad-request | `request-validation/unsecured/authorizations-validation-api-tests.spec.ts:380` | updateAuthorization - oneOf ambiguous |
| negative-update | bad-request | `request-validation/unsecured/authorizations-validation-api-tests.spec.ts:404` | updateAuthorization - oneOf cross bleed |
| negative-update | bad-request | `request-validation/unsecured/authorizations-validation-api-tests.spec.ts:428` | updateAuthorization - oneOf none match |
| negative-update | bad-request | `request-validation/unsecured/authorizations-validation-api-tests.spec.ts:451` | updateAuthorization - Path param authorizationKey pattern violation |
| negative-update | bad-request | `request-validation/unsecured/authorizations-validation-api-tests.spec.ts:467` | updateAuthorization - oneOf violation |
| negative-delete | bad-request | `request-validation/unsecured/authorizations-validation-api-tests.spec.ts:149` | deleteAuthorization - Path param authorizationKey pattern violation |
| negative-search | bad-request | `request-validation/unsecured/authorizations-validation-api-tests.spec.ts:197` | searchAuthorizations - Additional prop __unexpectedField |
| negative-search | bad-request | `request-validation/unsecured/authorizations-validation-api-tests.spec.ts:216` | searchAuthorizations - Body wrong top-level type |
| negative-search | bad-request | `request-validation/unsecured/authorizations-validation-api-tests.spec.ts:231` | searchAuthorizations - Missing sort.0.field |
| negative-search | bad-request | `request-validation/unsecured/authorizations-validation-api-tests.spec.ts:248` | searchAuthorizations - Enum violation filter.ownerType |
| negative-search | bad-request | `request-validation/unsecured/authorizations-validation-api-tests.spec.ts:267` | searchAuthorizations - Enum violation filter.resourceType |
| negative-search | bad-request | `request-validation/unsecured/authorizations-validation-api-tests.spec.ts:288` | searchAuthorizations - Enum violation sort.0.field |
| negative-search | bad-request | `request-validation/unsecured/authorizations-validation-api-tests.spec.ts:309` | searchAuthorizations - Enum violation sort.0.order |

### `user` — 33 tests

- **Prerequisite to create**: none
- **Files**: `request-validation/rbac/users-validation-api-tests.spec.ts`, `request-validation/unsecured/users-validation-api-tests.spec.ts`, `searchUsers.feature.spec.ts`, `searchUsers.variant.spec.ts`, `templates/EntityLifecycle/User.lifecycle.spec.ts`, `updateUser.feature.spec.ts`
- **Observation channel**: GET = 0, Search = 3
- **Form-step counts**: observe-present-search=3, mutate=1, observe-absence=1, lifecycle=1, negative-create=14, negative-get=3, negative-update=4, negative-delete=1, negative-search=5
- **Variants**: happy-path=3, observe-absence=2, data-driven=2, bad-request=25, forbidden=1, not-found=1, pagination-sort=2

| form step | variants | file:line | test name |
|--|--|--|--|
| observe-present-search | happy-path | `searchUsers.feature.spec.ts:12` | feature-1 - searchUsers - base (1) |
| observe-present-search | data-driven, pagination-sort | `searchUsers.variant.spec.ts:12` | variant-1 - searchUsers - path #1 |
| observe-present-search | data-driven, pagination-sort | `searchUsers.variant.spec.ts:62` | variant-2 - searchUsers - path #1 |
| mutate | happy-path | `updateUser.feature.spec.ts:11` | feature-1 - updateUser - base (1) |
| observe-absence | observe-absence | `searchUsers.feature.spec.ts:34` | feature-2 - searchUsers - negative empty (2) |
| lifecycle | happy-path, observe-absence | `templates/EntityLifecycle/User.lifecycle.spec.ts:9` | establish User, observe present, revoke, observe absent |
| negative-create | bad-request | `request-validation/unsecured/users-validation-api-tests.spec.ts:18` | createUser - Additional prop __unexpectedField |
| negative-create | bad-request | `request-validation/unsecured/users-validation-api-tests.spec.ts:37` | createUser - Body wrong top-level type |
| negative-create | bad-request | `request-validation/unsecured/users-validation-api-tests.spec.ts:52` | createUser - Param password wrong type (#1) |
| negative-create | bad-request | `request-validation/unsecured/users-validation-api-tests.spec.ts:70` | createUser - Param password wrong type (#2) |
| negative-create | bad-request | `request-validation/unsecured/users-validation-api-tests.spec.ts:88` | createUser - Param username wrong type (#1) |
| negative-create | bad-request | `request-validation/unsecured/users-validation-api-tests.spec.ts:106` | createUser - Param username wrong type (#2) |
| negative-create | bad-request | `request-validation/unsecured/users-validation-api-tests.spec.ts:124` | createUser - Constraint violation username (#1) |
| negative-create | bad-request | `request-validation/unsecured/users-validation-api-tests.spec.ts:143` | createUser - Constraint violation username (#2) |
| negative-create | bad-request | `request-validation/unsecured/users-validation-api-tests.spec.ts:161` | createUser - Constraint violation username (#3) |
| negative-create | bad-request | `request-validation/unsecured/users-validation-api-tests.spec.ts:179` | createUser - Constraint violation username (#4) |
| negative-create | bad-request | `request-validation/unsecured/users-validation-api-tests.spec.ts:198` | createUser - Missing password |
| negative-create | bad-request | `request-validation/unsecured/users-validation-api-tests.spec.ts:215` | createUser - Missing username |
| negative-create | bad-request | `request-validation/unsecured/users-validation-api-tests.spec.ts:232` | createUser - Missing body |
| negative-create | bad-request | `request-validation/unsecured/users-validation-api-tests.spec.ts:244` | createUser - Missing combo username,password |
| negative-get | forbidden | `request-validation/rbac/users-validation-api-tests.spec.ts:18` | getUser - Denied (no permission) |
| negative-get | not-found | `request-validation/unsecured/users-validation-api-tests.spec.ts:271` | getUser - Nonexistent username returns 404 |
| negative-get | bad-request | `request-validation/unsecured/users-validation-api-tests.spec.ts:285` | getUser - Path param username pattern violation |
| negative-update | bad-request | `request-validation/unsecured/users-validation-api-tests.spec.ts:388` | updateUser - Additional prop __extraField |
| negative-update | bad-request | `request-validation/unsecured/users-validation-api-tests.spec.ts:405` | updateUser - Body wrong top-level type |
| negative-update | bad-request | `request-validation/unsecured/users-validation-api-tests.spec.ts:420` | updateUser - Missing body |
| negative-update | bad-request | `request-validation/unsecured/users-validation-api-tests.spec.ts:432` | updateUser - Path param username pattern violation |
| negative-delete | bad-request | `request-validation/unsecured/users-validation-api-tests.spec.ts:259` | deleteUser - Path param username pattern violation |
| negative-search | bad-request | `request-validation/unsecured/users-validation-api-tests.spec.ts:297` | searchUsers - Additional prop __unexpectedField |
| negative-search | bad-request | `request-validation/unsecured/users-validation-api-tests.spec.ts:314` | searchUsers - Body wrong top-level type |
| negative-search | bad-request | `request-validation/unsecured/users-validation-api-tests.spec.ts:329` | searchUsers - Missing sort.0.field |
| negative-search | bad-request | `request-validation/unsecured/users-validation-api-tests.spec.ts:346` | searchUsers - Enum violation sort.0.field |
| negative-search | bad-request | `request-validation/unsecured/users-validation-api-tests.spec.ts:367` | searchUsers - Enum violation sort.0.order |

### `document` — 17 tests

- **Prerequisite to create**: none
- **Files**: `createDocument.variant.spec.ts`, `createDocumentLink.feature.spec.ts`, `createDocuments.feature.spec.ts`, `createDocuments.variant.spec.ts`, `request-validation/unsecured/documents-validation-api-tests.spec.ts`, `templates/EntityLifecycle/Document.lifecycle.spec.ts`
- **Observation channel**: GET = 0, Search = 0
- **Form-step counts**: create=6, lifecycle=1, negative-create=9, negative-get=1
- **Variants**: happy-path=3, observe-absence=1, data-driven=4, bad-request=9, not-found=1

| form step | variants | file:line | test name |
|--|--|--|--|
| create | data-driven | `createDocument.variant.spec.ts:13` | variant-1 - createDocument - bpmn #1 |
| create | data-driven | `createDocument.variant.spec.ts:73` | variant-2 - createDocument - bpmn #1 |
| create | happy-path | `createDocumentLink.feature.spec.ts:12` | feature-1 - createDocumentLink - base (1) |
| create | happy-path | `createDocuments.feature.spec.ts:12` | feature-1 - createDocuments - base (1) |
| create | data-driven | `createDocuments.variant.spec.ts:13` | variant-1 - createDocuments - bpmn #1 |
| create | data-driven | `createDocuments.variant.spec.ts:71` | variant-2 - createDocuments - bpmn #1 |
| lifecycle | happy-path, observe-absence | `templates/EntityLifecycle/Document.lifecycle.spec.ts:9` | establish Document, observe present, revoke, observe absent |
| negative-create | bad-request | `request-validation/unsecured/documents-validation-api-tests.spec.ts:18` | createDocument - Missing body |
| negative-create | bad-request | `request-validation/unsecured/documents-validation-api-tests.spec.ts:35` | createDocument - Missing file |
| negative-create | bad-request | `request-validation/unsecured/documents-validation-api-tests.spec.ts:52` | createDocument - Param query.documentId wrong type |
| negative-create | bad-request | `request-validation/unsecured/documents-validation-api-tests.spec.ts:72` | createDocumentLink - Additional prop __extraField |
| negative-create | bad-request | `request-validation/unsecured/documents-validation-api-tests.spec.ts:90` | createDocumentLink - Body wrong top-level type |
| negative-create | bad-request | `request-validation/unsecured/documents-validation-api-tests.spec.ts:105` | createDocumentLink - Param timeToLive wrong type (#1) |
| negative-create | bad-request | `request-validation/unsecured/documents-validation-api-tests.spec.ts:122` | createDocumentLink - Param timeToLive wrong type (#2) |
| negative-create | bad-request | `request-validation/unsecured/documents-validation-api-tests.spec.ts:139` | createDocuments - Missing body |
| negative-create | bad-request | `request-validation/unsecured/documents-validation-api-tests.spec.ts:156` | createDocuments - Missing files |
| negative-get | not-found | `request-validation/unsecured/documents-validation-api-tests.spec.ts:173` | getDocument - Nonexistent documentId returns 404 |

## B. Membership/Association

**Form**: Create parent + member (prerequisite) → Assign member → Search members (Observe Present) → Unassign member → Search members (Observe Absence)

**Total tests**: 170

### `tenant` — 67 tests

- **Prerequisite to create**: tenant + client, tenant + group, tenant + group-id, tenant + mapping-rule, tenant + role, tenant + user
- **Files**: `request-validation/unsecured/tenants-validation-api-tests.spec.ts`, `searchClientsForTenant.variant.spec.ts`, `searchGroupIdsForTenant.variant.spec.ts`, `searchMappingRulesForTenant.variant.spec.ts`, `searchRolesForTenant.variant.spec.ts`, `searchUsersForTenant.variant.spec.ts`, `templates/EdgeLifecycle/TenantClientMembership.lifecycle.spec.ts`, `templates/EdgeLifecycle/TenantGroupMembership.lifecycle.spec.ts`, `templates/EdgeLifecycle/TenantMappingRuleMembership.lifecycle.spec.ts`, `templates/EdgeLifecycle/TenantRoleMembership.lifecycle.spec.ts`, `templates/EdgeLifecycle/TenantUserMembership.lifecycle.spec.ts`
- **Observation channel**: GET = 0, Search = 12
- **Form-step counts**: observe-present-search=12, lifecycle=5, negative-update=10, negative-delete=10, negative-search=30
- **Variants**: happy-path=5, observe-absence=5, data-driven=12, bad-request=50, pagination-sort=10, filter=2

| form step | variants | file:line | test name |
|--|--|--|--|
| observe-present-search | data-driven, pagination-sort | `searchClientsForTenant.variant.spec.ts:12` | variant-1 - searchClientsForTenant - path #1 |
| observe-present-search | data-driven, pagination-sort | `searchClientsForTenant.variant.spec.ts:83` | variant-2 - searchClientsForTenant - path #1 |
| observe-present-search | data-driven, pagination-sort | `searchGroupIdsForTenant.variant.spec.ts:12` | variant-1 - searchGroupIdsForTenant - path #1 |
| observe-present-search | data-driven, pagination-sort | `searchGroupIdsForTenant.variant.spec.ts:83` | variant-2 - searchGroupIdsForTenant - path #1 |
| observe-present-search | data-driven, filter | `searchMappingRulesForTenant.variant.spec.ts:12` | variant-1 - searchMappingRulesForTenant - path #1 |
| observe-present-search | data-driven, pagination-sort | `searchMappingRulesForTenant.variant.spec.ts:118` | variant-2 - searchMappingRulesForTenant - path #1 |
| observe-present-search | data-driven, pagination-sort | `searchMappingRulesForTenant.variant.spec.ts:189` | variant-3 - searchMappingRulesForTenant - path #1 |
| observe-present-search | data-driven, filter | `searchRolesForTenant.variant.spec.ts:12` | variant-1 - searchRolesForTenant - path #1 |
| observe-present-search | data-driven, pagination-sort | `searchRolesForTenant.variant.spec.ts:118` | variant-2 - searchRolesForTenant - path #1 |
| observe-present-search | data-driven, pagination-sort | `searchRolesForTenant.variant.spec.ts:189` | variant-3 - searchRolesForTenant - path #1 |
| observe-present-search | data-driven, pagination-sort | `searchUsersForTenant.variant.spec.ts:12` | variant-1 - searchUsersForTenant - path #1 |
| observe-present-search | data-driven, pagination-sort | `searchUsersForTenant.variant.spec.ts:83` | variant-2 - searchUsersForTenant - path #1 |
| lifecycle | happy-path, observe-absence | `templates/EdgeLifecycle/TenantClientMembership.lifecycle.spec.ts:9` | establish TenantClientMembership, observe present, revoke, observe absent |
| lifecycle | happy-path, observe-absence | `templates/EdgeLifecycle/TenantGroupMembership.lifecycle.spec.ts:9` | establish TenantGroupMembership, observe present, revoke, observe absent |
| lifecycle | happy-path, observe-absence | `templates/EdgeLifecycle/TenantMappingRuleMembership.lifecycle.spec.ts:9` | establish TenantMappingRuleMembership, observe present, revoke, observe absent |
| lifecycle | happy-path, observe-absence | `templates/EdgeLifecycle/TenantRoleMembership.lifecycle.spec.ts:9` | establish TenantRoleMembership, observe present, revoke, observe absent |
| lifecycle | happy-path, observe-absence | `templates/EdgeLifecycle/TenantUserMembership.lifecycle.spec.ts:9` | establish TenantUserMembership, observe present, revoke, observe absent |
| negative-update | bad-request | `request-validation/unsecured/tenants-validation-api-tests.spec.ts:18` | assignClientToTenant - Path param clientId pattern violation |
| negative-update | bad-request | `request-validation/unsecured/tenants-validation-api-tests.spec.ts:35` | assignClientToTenant - Path param tenantId pattern violation |
| negative-update | bad-request | `request-validation/unsecured/tenants-validation-api-tests.spec.ts:52` | assignGroupToTenant - Path param groupId length-max violation |
| negative-update | bad-request | `request-validation/unsecured/tenants-validation-api-tests.spec.ts:70` | assignGroupToTenant - Path param tenantId pattern violation |
| negative-update | bad-request | `request-validation/unsecured/tenants-validation-api-tests.spec.ts:87` | assignMappingRuleToTenant - Path param mappingRuleId pattern violation |
| negative-update | bad-request | `request-validation/unsecured/tenants-validation-api-tests.spec.ts:104` | assignMappingRuleToTenant - Path param tenantId pattern violation |
| negative-update | bad-request | `request-validation/unsecured/tenants-validation-api-tests.spec.ts:121` | assignRoleToTenant - Path param roleId pattern violation |
| negative-update | bad-request | `request-validation/unsecured/tenants-validation-api-tests.spec.ts:138` | assignRoleToTenant - Path param tenantId pattern violation |
| negative-update | bad-request | `request-validation/unsecured/tenants-validation-api-tests.spec.ts:155` | assignUserToTenant - Path param tenantId pattern violation |
| negative-update | bad-request | `request-validation/unsecured/tenants-validation-api-tests.spec.ts:172` | assignUserToTenant - Path param username pattern violation |
| negative-delete | bad-request | `request-validation/unsecured/tenants-validation-api-tests.spec.ts:1116` | unassignClientFromTenant - Path param clientId pattern violation |
| negative-delete | bad-request | `request-validation/unsecured/tenants-validation-api-tests.spec.ts:1133` | unassignClientFromTenant - Path param tenantId pattern violation |
| negative-delete | bad-request | `request-validation/unsecured/tenants-validation-api-tests.spec.ts:1150` | unassignGroupFromTenant - Path param groupId length-max violation |
| negative-delete | bad-request | `request-validation/unsecured/tenants-validation-api-tests.spec.ts:1168` | unassignGroupFromTenant - Path param tenantId pattern violation |
| negative-delete | bad-request | `request-validation/unsecured/tenants-validation-api-tests.spec.ts:1185` | unassignMappingRuleFromTenant - Path param mappingRuleId pattern violation |
| negative-delete | bad-request | `request-validation/unsecured/tenants-validation-api-tests.spec.ts:1202` | unassignMappingRuleFromTenant - Path param tenantId pattern violation |
| negative-delete | bad-request | `request-validation/unsecured/tenants-validation-api-tests.spec.ts:1219` | unassignRoleFromTenant - Path param roleId pattern violation |
| negative-delete | bad-request | `request-validation/unsecured/tenants-validation-api-tests.spec.ts:1236` | unassignRoleFromTenant - Path param tenantId pattern violation |
| negative-delete | bad-request | `request-validation/unsecured/tenants-validation-api-tests.spec.ts:1253` | unassignUserFromTenant - Path param tenantId pattern violation |
| negative-delete | bad-request | `request-validation/unsecured/tenants-validation-api-tests.spec.ts:1270` | unassignUserFromTenant - Path param username pattern violation |
| negative-search | bad-request | `request-validation/unsecured/tenants-validation-api-tests.spec.ts:466` | searchClientsForTenant - Additional prop __unexpectedField |
| negative-search | bad-request | `request-validation/unsecured/tenants-validation-api-tests.spec.ts:485` | searchClientsForTenant - Body wrong top-level type |
| negative-search | bad-request | `request-validation/unsecured/tenants-validation-api-tests.spec.ts:500` | searchClientsForTenant - Missing sort.0.field |
| negative-search | bad-request | `request-validation/unsecured/tenants-validation-api-tests.spec.ts:517` | searchClientsForTenant - Enum violation sort.0.field |
| negative-search | bad-request | `request-validation/unsecured/tenants-validation-api-tests.spec.ts:538` | searchClientsForTenant - Enum violation sort.0.order |
| negative-search | bad-request | `request-validation/unsecured/tenants-validation-api-tests.spec.ts:559` | searchClientsForTenant - Path param tenantId pattern violation |
| negative-search | bad-request | `request-validation/unsecured/tenants-validation-api-tests.spec.ts:575` | searchGroupIdsForTenant - Additional prop __unexpectedField |
| negative-search | bad-request | `request-validation/unsecured/tenants-validation-api-tests.spec.ts:594` | searchGroupIdsForTenant - Body wrong top-level type |
| negative-search | bad-request | `request-validation/unsecured/tenants-validation-api-tests.spec.ts:609` | searchGroupIdsForTenant - Missing sort.0.field |
| negative-search | bad-request | `request-validation/unsecured/tenants-validation-api-tests.spec.ts:626` | searchGroupIdsForTenant - Enum violation sort.0.field |
| negative-search | bad-request | `request-validation/unsecured/tenants-validation-api-tests.spec.ts:647` | searchGroupIdsForTenant - Enum violation sort.0.order |
| negative-search | bad-request | `request-validation/unsecured/tenants-validation-api-tests.spec.ts:668` | searchGroupIdsForTenant - Path param tenantId pattern violation |
| negative-search | bad-request | `request-validation/unsecured/tenants-validation-api-tests.spec.ts:684` | searchMappingRulesForTenant - Additional prop __unexpectedField |
| negative-search | bad-request | `request-validation/unsecured/tenants-validation-api-tests.spec.ts:705` | searchMappingRulesForTenant - Body wrong top-level type |
| negative-search | bad-request | `request-validation/unsecured/tenants-validation-api-tests.spec.ts:722` | searchMappingRulesForTenant - Missing sort.0.field |
| negative-search | bad-request | `request-validation/unsecured/tenants-validation-api-tests.spec.ts:741` | searchMappingRulesForTenant - Enum violation sort.0.field |
| negative-search | bad-request | `request-validation/unsecured/tenants-validation-api-tests.spec.ts:766` | searchMappingRulesForTenant - Enum violation sort.0.order |
| negative-search | bad-request | `request-validation/unsecured/tenants-validation-api-tests.spec.ts:791` | searchMappingRulesForTenant - Path param tenantId pattern violation |
| negative-search | bad-request | `request-validation/unsecured/tenants-validation-api-tests.spec.ts:807` | searchRolesForTenant - Additional prop __unexpectedField |
| negative-search | bad-request | `request-validation/unsecured/tenants-validation-api-tests.spec.ts:826` | searchRolesForTenant - Body wrong top-level type |
| negative-search | bad-request | `request-validation/unsecured/tenants-validation-api-tests.spec.ts:841` | searchRolesForTenant - Missing sort.0.field |
| negative-search | bad-request | `request-validation/unsecured/tenants-validation-api-tests.spec.ts:858` | searchRolesForTenant - Enum violation sort.0.field |
| negative-search | bad-request | `request-validation/unsecured/tenants-validation-api-tests.spec.ts:879` | searchRolesForTenant - Enum violation sort.0.order |
| negative-search | bad-request | `request-validation/unsecured/tenants-validation-api-tests.spec.ts:900` | searchRolesForTenant - Path param tenantId pattern violation |
| negative-search | bad-request | `request-validation/unsecured/tenants-validation-api-tests.spec.ts:1007` | searchUsersForTenant - Additional prop __unexpectedField |
| negative-search | bad-request | `request-validation/unsecured/tenants-validation-api-tests.spec.ts:1026` | searchUsersForTenant - Body wrong top-level type |
| negative-search | bad-request | `request-validation/unsecured/tenants-validation-api-tests.spec.ts:1041` | searchUsersForTenant - Missing sort.0.field |
| negative-search | bad-request | `request-validation/unsecured/tenants-validation-api-tests.spec.ts:1058` | searchUsersForTenant - Enum violation sort.0.field |
| negative-search | bad-request | `request-validation/unsecured/tenants-validation-api-tests.spec.ts:1079` | searchUsersForTenant - Enum violation sort.0.order |
| negative-search | bad-request | `request-validation/unsecured/tenants-validation-api-tests.spec.ts:1100` | searchUsersForTenant - Path param tenantId pattern violation |

### `role` — 53 tests

- **Prerequisite to create**: client + role, group + role, mapping-rule + role, role + client, role + group, role + mapping-rule, role + user, user + role
- **Files**: `request-validation/unsecured/roles-validation-api-tests.spec.ts`, `searchClientsForRole.variant.spec.ts`, `searchGroupsForRole.variant.spec.ts`, `searchMappingRulesForRole.variant.spec.ts`, `searchUsersForRole.variant.spec.ts`, `templates/EdgeLifecycle/RoleClientMembership.lifecycle.spec.ts`, `templates/EdgeLifecycle/RoleGroupMembership.lifecycle.spec.ts`, `templates/EdgeLifecycle/RoleMappingRuleMembership.lifecycle.spec.ts`, `templates/EdgeLifecycle/RoleUserMembership.lifecycle.spec.ts`
- **Observation channel**: GET = 0, Search = 9
- **Form-step counts**: observe-present-search=9, lifecycle=4, negative-update=8, negative-delete=8, negative-search=24
- **Variants**: happy-path=4, observe-absence=4, data-driven=9, bad-request=40, pagination-sort=8, filter=1

| form step | variants | file:line | test name |
|--|--|--|--|
| observe-present-search | data-driven, pagination-sort | `searchClientsForRole.variant.spec.ts:12` | variant-1 - searchClientsForRole - path #1 |
| observe-present-search | data-driven, pagination-sort | `searchClientsForRole.variant.spec.ts:83` | variant-2 - searchClientsForRole - path #1 |
| observe-present-search | data-driven, pagination-sort | `searchGroupsForRole.variant.spec.ts:12` | variant-1 - searchGroupsForRole - path #1 |
| observe-present-search | data-driven, pagination-sort | `searchGroupsForRole.variant.spec.ts:83` | variant-2 - searchGroupsForRole - path #1 |
| observe-present-search | data-driven, filter | `searchMappingRulesForRole.variant.spec.ts:12` | variant-1 - searchMappingRulesForRole - path #1 |
| observe-present-search | data-driven, pagination-sort | `searchMappingRulesForRole.variant.spec.ts:118` | variant-2 - searchMappingRulesForRole - path #1 |
| observe-present-search | data-driven, pagination-sort | `searchMappingRulesForRole.variant.spec.ts:189` | variant-3 - searchMappingRulesForRole - path #1 |
| observe-present-search | data-driven, pagination-sort | `searchUsersForRole.variant.spec.ts:12` | variant-1 - searchUsersForRole - path #1 |
| observe-present-search | data-driven, pagination-sort | `searchUsersForRole.variant.spec.ts:83` | variant-2 - searchUsersForRole - path #1 |
| lifecycle | happy-path, observe-absence | `templates/EdgeLifecycle/RoleClientMembership.lifecycle.spec.ts:9` | establish RoleClientMembership, observe present, revoke, observe absent |
| lifecycle | happy-path, observe-absence | `templates/EdgeLifecycle/RoleGroupMembership.lifecycle.spec.ts:9` | establish RoleGroupMembership, observe present, revoke, observe absent |
| lifecycle | happy-path, observe-absence | `templates/EdgeLifecycle/RoleMappingRuleMembership.lifecycle.spec.ts:9` | establish RoleMappingRuleMembership, observe present, revoke, observe absent |
| lifecycle | happy-path, observe-absence | `templates/EdgeLifecycle/RoleUserMembership.lifecycle.spec.ts:9` | establish RoleUserMembership, observe present, revoke, observe absent |
| negative-update | bad-request | `request-validation/unsecured/roles-validation-api-tests.spec.ts:18` | assignRoleToClient - Path param clientId pattern violation |
| negative-update | bad-request | `request-validation/unsecured/roles-validation-api-tests.spec.ts:35` | assignRoleToClient - Path param roleId pattern violation |
| negative-update | bad-request | `request-validation/unsecured/roles-validation-api-tests.spec.ts:52` | assignRoleToGroup - Path param groupId length-max violation |
| negative-update | bad-request | `request-validation/unsecured/roles-validation-api-tests.spec.ts:70` | assignRoleToGroup - Path param roleId pattern violation |
| negative-update | bad-request | `request-validation/unsecured/roles-validation-api-tests.spec.ts:85` | assignRoleToMappingRule - Path param mappingRuleId pattern violation |
| negative-update | bad-request | `request-validation/unsecured/roles-validation-api-tests.spec.ts:102` | assignRoleToMappingRule - Path param roleId pattern violation |
| negative-update | bad-request | `request-validation/unsecured/roles-validation-api-tests.spec.ts:119` | assignRoleToUser - Path param roleId pattern violation |
| negative-update | bad-request | `request-validation/unsecured/roles-validation-api-tests.spec.ts:134` | assignRoleToUser - Path param username pattern violation |
| negative-delete | bad-request | `request-validation/unsecured/roles-validation-api-tests.spec.ts:929` | unassignRoleFromClient - Path param clientId pattern violation |
| negative-delete | bad-request | `request-validation/unsecured/roles-validation-api-tests.spec.ts:946` | unassignRoleFromClient - Path param roleId pattern violation |
| negative-delete | bad-request | `request-validation/unsecured/roles-validation-api-tests.spec.ts:963` | unassignRoleFromGroup - Path param groupId length-max violation |
| negative-delete | bad-request | `request-validation/unsecured/roles-validation-api-tests.spec.ts:981` | unassignRoleFromGroup - Path param roleId pattern violation |
| negative-delete | bad-request | `request-validation/unsecured/roles-validation-api-tests.spec.ts:998` | unassignRoleFromMappingRule - Path param mappingRuleId pattern violation |
| negative-delete | bad-request | `request-validation/unsecured/roles-validation-api-tests.spec.ts:1015` | unassignRoleFromMappingRule - Path param roleId pattern violation |
| negative-delete | bad-request | `request-validation/unsecured/roles-validation-api-tests.spec.ts:1032` | unassignRoleFromUser - Path param roleId pattern violation |
| negative-delete | bad-request | `request-validation/unsecured/roles-validation-api-tests.spec.ts:1049` | unassignRoleFromUser - Path param username pattern violation |
| negative-search | bad-request | `request-validation/unsecured/roles-validation-api-tests.spec.ts:416` | searchClientsForRole - Additional prop __extraField |
| negative-search | bad-request | `request-validation/unsecured/roles-validation-api-tests.spec.ts:433` | searchClientsForRole - Body wrong top-level type |
| negative-search | bad-request | `request-validation/unsecured/roles-validation-api-tests.spec.ts:448` | searchClientsForRole - Missing sort.0.field |
| negative-search | bad-request | `request-validation/unsecured/roles-validation-api-tests.spec.ts:465` | searchClientsForRole - Enum violation sort.0.field |
| negative-search | bad-request | `request-validation/unsecured/roles-validation-api-tests.spec.ts:486` | searchClientsForRole - Enum violation sort.0.order |
| negative-search | bad-request | `request-validation/unsecured/roles-validation-api-tests.spec.ts:507` | searchClientsForRole - Path param roleId pattern violation |
| negative-search | bad-request | `request-validation/unsecured/roles-validation-api-tests.spec.ts:521` | searchGroupsForRole - Additional prop __extraField |
| negative-search | bad-request | `request-validation/unsecured/roles-validation-api-tests.spec.ts:538` | searchGroupsForRole - Body wrong top-level type |
| negative-search | bad-request | `request-validation/unsecured/roles-validation-api-tests.spec.ts:553` | searchGroupsForRole - Missing sort.0.field |
| negative-search | bad-request | `request-validation/unsecured/roles-validation-api-tests.spec.ts:570` | searchGroupsForRole - Enum violation sort.0.field |
| negative-search | bad-request | `request-validation/unsecured/roles-validation-api-tests.spec.ts:591` | searchGroupsForRole - Enum violation sort.0.order |
| negative-search | bad-request | `request-validation/unsecured/roles-validation-api-tests.spec.ts:612` | searchGroupsForRole - Path param roleId pattern violation |
| negative-search | bad-request | `request-validation/unsecured/roles-validation-api-tests.spec.ts:626` | searchMappingRulesForRole - Additional prop __unexpectedField |
| negative-search | bad-request | `request-validation/unsecured/roles-validation-api-tests.spec.ts:645` | searchMappingRulesForRole - Body wrong top-level type |
| negative-search | bad-request | `request-validation/unsecured/roles-validation-api-tests.spec.ts:660` | searchMappingRulesForRole - Missing sort.0.field |
| negative-search | bad-request | `request-validation/unsecured/roles-validation-api-tests.spec.ts:677` | searchMappingRulesForRole - Enum violation sort.0.field |
| negative-search | bad-request | `request-validation/unsecured/roles-validation-api-tests.spec.ts:698` | searchMappingRulesForRole - Enum violation sort.0.order |
| negative-search | bad-request | `request-validation/unsecured/roles-validation-api-tests.spec.ts:719` | searchMappingRulesForRole - Path param roleId pattern violation |
| negative-search | bad-request | `request-validation/unsecured/roles-validation-api-tests.spec.ts:824` | searchUsersForRole - Additional prop __extraField |
| negative-search | bad-request | `request-validation/unsecured/roles-validation-api-tests.spec.ts:841` | searchUsersForRole - Body wrong top-level type |
| negative-search | bad-request | `request-validation/unsecured/roles-validation-api-tests.spec.ts:856` | searchUsersForRole - Missing sort.0.field |
| negative-search | bad-request | `request-validation/unsecured/roles-validation-api-tests.spec.ts:873` | searchUsersForRole - Enum violation sort.0.field |
| negative-search | bad-request | `request-validation/unsecured/roles-validation-api-tests.spec.ts:894` | searchUsersForRole - Enum violation sort.0.order |
| negative-search | bad-request | `request-validation/unsecured/roles-validation-api-tests.spec.ts:915` | searchUsersForRole - Path param roleId pattern violation |

### `group` — 50 tests

- **Prerequisite to create**: group + client, group + mapping-rule, group + role, group + user
- **Files**: `request-validation/unsecured/groups-validation-api-tests.spec.ts`, `searchClientsForGroup.variant.spec.ts`, `searchMappingRulesForGroup.variant.spec.ts`, `searchRolesForGroup.feature.spec.ts`, `searchRolesForGroup.variant.spec.ts`, `searchUsersForGroup.variant.spec.ts`, `templates/EdgeLifecycle/GroupClientMembership.lifecycle.spec.ts`, `templates/EdgeLifecycle/GroupMappingRuleMembership.lifecycle.spec.ts`, `templates/EdgeLifecycle/GroupUserMembership.lifecycle.spec.ts`
- **Observation channel**: GET = 0, Search = 11
- **Form-step counts**: observe-present-search=11, lifecycle=3, negative-update=6, negative-delete=6, negative-search=24
- **Variants**: happy-path=4, observe-absence=3, data-driven=10, bad-request=36, pagination-sort=8, filter=2

| form step | variants | file:line | test name |
|--|--|--|--|
| observe-present-search | data-driven, pagination-sort | `searchClientsForGroup.variant.spec.ts:12` | variant-1 - searchClientsForGroup - path #1 |
| observe-present-search | data-driven, pagination-sort | `searchClientsForGroup.variant.spec.ts:83` | variant-2 - searchClientsForGroup - path #1 |
| observe-present-search | data-driven, filter | `searchMappingRulesForGroup.variant.spec.ts:12` | variant-1 - searchMappingRulesForGroup - path #1 |
| observe-present-search | data-driven, pagination-sort | `searchMappingRulesForGroup.variant.spec.ts:78` | variant-2 - searchMappingRulesForGroup - path #1 |
| observe-present-search | data-driven, pagination-sort | `searchMappingRulesForGroup.variant.spec.ts:149` | variant-3 - searchMappingRulesForGroup - path #1 |
| observe-present-search | happy-path | `searchRolesForGroup.feature.spec.ts:12` | feature-1 - searchRolesForGroup - base (1) |
| observe-present-search | data-driven, filter | `searchRolesForGroup.variant.spec.ts:12` | variant-1 - searchRolesForGroup - path #1 |
| observe-present-search | data-driven, pagination-sort | `searchRolesForGroup.variant.spec.ts:78` | variant-2 - searchRolesForGroup - path #1 |
| observe-present-search | data-driven, pagination-sort | `searchRolesForGroup.variant.spec.ts:149` | variant-3 - searchRolesForGroup - path #1 |
| observe-present-search | data-driven, pagination-sort | `searchUsersForGroup.variant.spec.ts:12` | variant-1 - searchUsersForGroup - path #1 |
| observe-present-search | data-driven, pagination-sort | `searchUsersForGroup.variant.spec.ts:83` | variant-2 - searchUsersForGroup - path #1 |
| lifecycle | happy-path, observe-absence | `templates/EdgeLifecycle/GroupClientMembership.lifecycle.spec.ts:9` | establish GroupClientMembership, observe present, revoke, observe absent |
| lifecycle | happy-path, observe-absence | `templates/EdgeLifecycle/GroupMappingRuleMembership.lifecycle.spec.ts:9` | establish GroupMappingRuleMembership, observe present, revoke, observe absent |
| lifecycle | happy-path, observe-absence | `templates/EdgeLifecycle/GroupUserMembership.lifecycle.spec.ts:9` | establish GroupUserMembership, observe present, revoke, observe absent |
| negative-update | bad-request | `request-validation/unsecured/groups-validation-api-tests.spec.ts:18` | assignClientToGroup - Path param clientId pattern violation |
| negative-update | bad-request | `request-validation/unsecured/groups-validation-api-tests.spec.ts:35` | assignClientToGroup - Path param groupId length-max violation |
| negative-update | bad-request | `request-validation/unsecured/groups-validation-api-tests.spec.ts:53` | assignMappingRuleToGroup - Path param groupId length-max violation |
| negative-update | bad-request | `request-validation/unsecured/groups-validation-api-tests.spec.ts:71` | assignMappingRuleToGroup - Path param mappingRuleId pattern violation |
| negative-update | bad-request | `request-validation/unsecured/groups-validation-api-tests.spec.ts:88` | assignUserToGroup - Path param groupId length-max violation |
| negative-update | bad-request | `request-validation/unsecured/groups-validation-api-tests.spec.ts:106` | assignUserToGroup - Path param username pattern violation |
| negative-delete | bad-request | `request-validation/unsecured/groups-validation-api-tests.spec.ts:915` | unassignClientFromGroup - Path param clientId pattern violation |
| negative-delete | bad-request | `request-validation/unsecured/groups-validation-api-tests.spec.ts:932` | unassignClientFromGroup - Path param groupId length-max violation |
| negative-delete | bad-request | `request-validation/unsecured/groups-validation-api-tests.spec.ts:950` | unassignMappingRuleFromGroup - Path param groupId length-max violation |
| negative-delete | bad-request | `request-validation/unsecured/groups-validation-api-tests.spec.ts:968` | unassignMappingRuleFromGroup - Path param mappingRuleId pattern violation |
| negative-delete | bad-request | `request-validation/unsecured/groups-validation-api-tests.spec.ts:985` | unassignUserFromGroup - Path param groupId length-max violation |
| negative-delete | bad-request | `request-validation/unsecured/groups-validation-api-tests.spec.ts:1003` | unassignUserFromGroup - Path param username pattern violation |
| negative-search | bad-request | `request-validation/unsecured/groups-validation-api-tests.spec.ts:376` | searchClientsForGroup - Additional prop __extraField |
| negative-search | bad-request | `request-validation/unsecured/groups-validation-api-tests.spec.ts:393` | searchClientsForGroup - Body wrong top-level type |
| negative-search | bad-request | `request-validation/unsecured/groups-validation-api-tests.spec.ts:408` | searchClientsForGroup - Missing sort.0.field |
| negative-search | bad-request | `request-validation/unsecured/groups-validation-api-tests.spec.ts:425` | searchClientsForGroup - Enum violation sort.0.field |
| negative-search | bad-request | `request-validation/unsecured/groups-validation-api-tests.spec.ts:446` | searchClientsForGroup - Enum violation sort.0.order |
| negative-search | bad-request | `request-validation/unsecured/groups-validation-api-tests.spec.ts:467` | searchClientsForGroup - Path param groupId length-max violation |
| negative-search | bad-request | `request-validation/unsecured/groups-validation-api-tests.spec.ts:575` | searchMappingRulesForGroup - Additional prop __unexpectedField |
| negative-search | bad-request | `request-validation/unsecured/groups-validation-api-tests.spec.ts:596` | searchMappingRulesForGroup - Body wrong top-level type |
| negative-search | bad-request | `request-validation/unsecured/groups-validation-api-tests.spec.ts:613` | searchMappingRulesForGroup - Missing sort.0.field |
| negative-search | bad-request | `request-validation/unsecured/groups-validation-api-tests.spec.ts:632` | searchMappingRulesForGroup - Enum violation sort.0.field |
| negative-search | bad-request | `request-validation/unsecured/groups-validation-api-tests.spec.ts:657` | searchMappingRulesForGroup - Enum violation sort.0.order |
| negative-search | bad-request | `request-validation/unsecured/groups-validation-api-tests.spec.ts:682` | searchMappingRulesForGroup - Path param groupId length-max violation |
| negative-search | bad-request | `request-validation/unsecured/groups-validation-api-tests.spec.ts:699` | searchRolesForGroup - Additional prop __unexpectedField |
| negative-search | bad-request | `request-validation/unsecured/groups-validation-api-tests.spec.ts:716` | searchRolesForGroup - Body wrong top-level type |
| negative-search | bad-request | `request-validation/unsecured/groups-validation-api-tests.spec.ts:731` | searchRolesForGroup - Missing sort.0.field |
| negative-search | bad-request | `request-validation/unsecured/groups-validation-api-tests.spec.ts:748` | searchRolesForGroup - Enum violation sort.0.field |
| negative-search | bad-request | `request-validation/unsecured/groups-validation-api-tests.spec.ts:769` | searchRolesForGroup - Enum violation sort.0.order |
| negative-search | bad-request | `request-validation/unsecured/groups-validation-api-tests.spec.ts:790` | searchRolesForGroup - Path param groupId length-max violation |
| negative-search | bad-request | `request-validation/unsecured/groups-validation-api-tests.spec.ts:807` | searchUsersForGroup - Additional prop __extraField |
| negative-search | bad-request | `request-validation/unsecured/groups-validation-api-tests.spec.ts:824` | searchUsersForGroup - Body wrong top-level type |
| negative-search | bad-request | `request-validation/unsecured/groups-validation-api-tests.spec.ts:839` | searchUsersForGroup - Missing sort.0.field |
| negative-search | bad-request | `request-validation/unsecured/groups-validation-api-tests.spec.ts:856` | searchUsersForGroup - Enum violation sort.0.field |
| negative-search | bad-request | `request-validation/unsecured/groups-validation-api-tests.spec.ts:877` | searchUsersForGroup - Enum violation sort.0.order |
| negative-search | bad-request | `request-validation/unsecured/groups-validation-api-tests.spec.ts:898` | searchUsersForGroup - Path param groupId length-max violation |

## C. Deployment Lifecycle

**Form**: Deploy resource → Get definition (XML/JSON) → Search definitions (Observe Present) → Delete resource → Get definition (Observe Absence)

**Total tests**: 161

### `process-definition` — 73 tests

- **Prerequisite to create**: deployed-process
- **Files**: `getProcessDefinition.feature.spec.ts`, `getProcessDefinitionInstanceStatistics.feature.spec.ts`, `getProcessDefinitionInstanceVersionStatistics.feature.spec.ts`, `getProcessDefinitionInstanceVersionStatistics.variant.spec.ts`, `getProcessDefinitionMessageSubscriptionStatistics.feature.spec.ts`, `getProcessDefinitionMessageSubscriptionStatistics.variant.spec.ts`, `getProcessDefinitionStatistics.feature.spec.ts`, `getProcessDefinitionStatistics.variant.spec.ts`, `getProcessDefinitionXML.feature.spec.ts`, `getStartProcessForm.feature.spec.ts`, `request-validation/unsecured/processdefinitions-validation-api-tests.spec.ts`, `searchProcessDefinitions.feature.spec.ts`, `searchProcessDefinitions.variant.spec.ts`
- **Observation channel**: GET = 21, Search = 5
- **Form-step counts**: observe-present-get=21, observe-present-search=5, observe-absence=1, negative-get=41, negative-search=5
- **Variants**: happy-path=8, observe-absence=1, data-driven=18, bad-request=43, not-found=3, pagination-sort=3, filter=16

| form step | variants | file:line | test name |
|--|--|--|--|
| observe-present-get | happy-path | `getProcessDefinition.feature.spec.ts:13` | feature-1 - getProcessDefinition - base (1) |
| observe-present-get | happy-path | `getProcessDefinitionInstanceStatistics.feature.spec.ts:11` | feature-1 - getProcessDefinitionInstanceStatistics - base (1) |
| observe-present-get | happy-path, filter | `getProcessDefinitionInstanceVersionStatistics.feature.spec.ts:12` | feature-1 - getProcessDefinitionInstanceVersionStatistics - base (1) |
| observe-present-get | data-driven, filter | `getProcessDefinitionInstanceVersionStatistics.variant.spec.ts:12` | variant-1 - getProcessDefinitionInstanceVersionStatistics - bpmn #1 |
| observe-present-get | happy-path | `getProcessDefinitionMessageSubscriptionStatistics.feature.spec.ts:11` | feature-1 - getProcessDefinitionMessageSubscriptionStatistics - base (1) |
| observe-present-get | data-driven, pagination-sort | `getProcessDefinitionMessageSubscriptionStatistics.variant.spec.ts:13` | variant-1 - getProcessDefinitionMessageSubscriptionStatistics - path #1 |
| observe-present-get | data-driven, filter | `getProcessDefinitionMessageSubscriptionStatistics.variant.spec.ts:70` | variant-2 - getProcessDefinitionMessageSubscriptionStatistics - path #1 |
| observe-present-get | data-driven, filter | `getProcessDefinitionMessageSubscriptionStatistics.variant.spec.ts:128` | variant-3 - getProcessDefinitionMessageSubscriptionStatistics - bpmn #1 |
| observe-present-get | data-driven, filter | `getProcessDefinitionMessageSubscriptionStatistics.variant.spec.ts:182` | variant-4 - getProcessDefinitionMessageSubscriptionStatistics - bpmn #1 |
| observe-present-get | data-driven, filter | `getProcessDefinitionMessageSubscriptionStatistics.variant.spec.ts:254` | variant-5 - getProcessDefinitionMessageSubscriptionStatistics - bpmn #1 |
| observe-present-get | happy-path | `getProcessDefinitionStatistics.feature.spec.ts:12` | feature-1 - getProcessDefinitionStatistics - base (1) |
| observe-present-get | data-driven, filter | `getProcessDefinitionStatistics.variant.spec.ts:12` | variant-1 - getProcessDefinitionStatistics - bpmn #1 |
| observe-present-get | data-driven, filter | `getProcessDefinitionStatistics.variant.spec.ts:81` | variant-2 - getProcessDefinitionStatistics - bpmn #1 |
| observe-present-get | data-driven, filter | `getProcessDefinitionStatistics.variant.spec.ts:150` | variant-3 - getProcessDefinitionStatistics - bpmn #1 |
| observe-present-get | data-driven, filter | `getProcessDefinitionStatistics.variant.spec.ts:202` | variant-4 - getProcessDefinitionStatistics - bpmn #1 |
| observe-present-get | data-driven, filter | `getProcessDefinitionStatistics.variant.spec.ts:254` | variant-5 - getProcessDefinitionStatistics - bpmn #1 |
| observe-present-get | data-driven, filter | `getProcessDefinitionStatistics.variant.spec.ts:327` | variant-6 - getProcessDefinitionStatistics - bpmn #1 |
| observe-present-get | data-driven, filter | `getProcessDefinitionStatistics.variant.spec.ts:400` | variant-7 - getProcessDefinitionStatistics - bpmn #1 |
| observe-present-get | data-driven, filter | `getProcessDefinitionStatistics.variant.spec.ts:456` | variant-8 - getProcessDefinitionStatistics - bpmn #1 |
| observe-present-get | happy-path | `getProcessDefinitionXML.feature.spec.ts:10` | feature-1 - getProcessDefinitionXML - base (1) |
| observe-present-get | happy-path | `getStartProcessForm.feature.spec.ts:13` | feature-1 - getStartProcessForm - base (1) |
| observe-present-search | happy-path | `searchProcessDefinitions.feature.spec.ts:13` | feature-1 - searchProcessDefinitions - base (1) |
| observe-present-search | data-driven, filter | `searchProcessDefinitions.variant.spec.ts:13` | variant-1 - searchProcessDefinitions - path #1 |
| observe-present-search | data-driven, filter | `searchProcessDefinitions.variant.spec.ts:81` | variant-2 - searchProcessDefinitions - bpmn #1 |
| observe-present-search | data-driven, pagination-sort | `searchProcessDefinitions.variant.spec.ts:130` | variant-3 - searchProcessDefinitions - path #1 |
| observe-present-search | data-driven, pagination-sort | `searchProcessDefinitions.variant.spec.ts:203` | variant-4 - searchProcessDefinitions - path #1 |
| observe-absence | observe-absence | `searchProcessDefinitions.feature.spec.ts:56` | feature-2 - searchProcessDefinitions - negative empty (2) |
| negative-get | not-found | `request-validation/unsecured/processdefinitions-validation-api-tests.spec.ts:18` | getProcessDefinition - Nonexistent processDefinitionKey returns 404 |
| negative-get | bad-request | `request-validation/unsecured/processdefinitions-validation-api-tests.spec.ts:34` | getProcessDefinition - Path param processDefinitionKey pattern violation |
| negative-get | bad-request | `request-validation/unsecured/processdefinitions-validation-api-tests.spec.ts:50` | getProcessDefinitionInstanceStatistics - Additional prop __extraField |
| negative-get | bad-request | `request-validation/unsecured/processdefinitions-validation-api-tests.spec.ts:69` | getProcessDefinitionInstanceStatistics - Body wrong top-level type |
| negative-get | bad-request | `request-validation/unsecured/processdefinitions-validation-api-tests.spec.ts:86` | getProcessDefinitionInstanceStatistics - Missing sort.0.field |
| negative-get | bad-request | `request-validation/unsecured/processdefinitions-validation-api-tests.spec.ts:105` | getProcessDefinitionInstanceStatistics - Enum violation sort.0.field |
| negative-get | bad-request | `request-validation/unsecured/processdefinitions-validation-api-tests.spec.ts:128` | getProcessDefinitionInstanceStatistics - Enum violation sort.0.order |
| negative-get | bad-request | `request-validation/unsecured/processdefinitions-validation-api-tests.spec.ts:151` | getProcessDefinitionInstanceVersionStatistics - Additional prop __extraField |
| negative-get | bad-request | `request-validation/unsecured/processdefinitions-validation-api-tests.spec.ts:174` | getProcessDefinitionInstanceVersionStatistics - Body wrong top-level type |
| negative-get | bad-request | `request-validation/unsecured/processdefinitions-validation-api-tests.spec.ts:191` | getProcessDefinitionInstanceVersionStatistics - Param filter.processDefinitionId wrong type (#1) |
| negative-get | bad-request | `request-validation/unsecured/processdefinitions-validation-api-tests.spec.ts:213` | getProcessDefinitionInstanceVersionStatistics - Param filter.processDefinitionId wrong type (#2) |
| negative-get | bad-request | `request-validation/unsecured/processdefinitions-validation-api-tests.spec.ts:235` | getProcessDefinitionInstanceVersionStatistics - Param filter.tenantId wrong type (#1) |
| negative-get | bad-request | `request-validation/unsecured/processdefinitions-validation-api-tests.spec.ts:257` | getProcessDefinitionInstanceVersionStatistics - Param filter.tenantId wrong type (#2) |
| negative-get | bad-request | `request-validation/unsecured/processdefinitions-validation-api-tests.spec.ts:279` | getProcessDefinitionInstanceVersionStatistics - Constraint violation filter.processDefinitionId (#1) |
| negative-get | bad-request | `request-validation/unsecured/processdefinitions-validation-api-tests.spec.ts:301` | getProcessDefinitionInstanceVersionStatistics - Constraint violation filter.processDefinitionId (#2) |
| negative-get | bad-request | `request-validation/unsecured/processdefinitions-validation-api-tests.spec.ts:323` | getProcessDefinitionInstanceVersionStatistics - Constraint violation filter.tenantId (#1) |
| negative-get | bad-request | `request-validation/unsecured/processdefinitions-validation-api-tests.spec.ts:345` | getProcessDefinitionInstanceVersionStatistics - Constraint violation filter.tenantId (#2) |
| negative-get | bad-request | `request-validation/unsecured/processdefinitions-validation-api-tests.spec.ts:367` | getProcessDefinitionInstanceVersionStatistics - Constraint violation filter.tenantId (#3) |
| negative-get | bad-request | `request-validation/unsecured/processdefinitions-validation-api-tests.spec.ts:389` | getProcessDefinitionInstanceVersionStatistics - Constraint violation filter.tenantId (#4) |
| negative-get | bad-request | `request-validation/unsecured/processdefinitions-validation-api-tests.spec.ts:411` | getProcessDefinitionInstanceVersionStatistics - Missing filter.processDefinitionId |
| negative-get | bad-request | `request-validation/unsecured/processdefinitions-validation-api-tests.spec.ts:430` | getProcessDefinitionInstanceVersionStatistics - Missing sort.0.field |
| negative-get | bad-request | `request-validation/unsecured/processdefinitions-validation-api-tests.spec.ts:452` | getProcessDefinitionInstanceVersionStatistics - Enum violation sort.0.field |
| negative-get | bad-request | `request-validation/unsecured/processdefinitions-validation-api-tests.spec.ts:479` | getProcessDefinitionInstanceVersionStatistics - Enum violation sort.0.order |
| negative-get | bad-request | `request-validation/unsecured/processdefinitions-validation-api-tests.spec.ts:506` | getProcessDefinitionInstanceVersionStatistics - Missing filter |
| negative-get | bad-request | `request-validation/unsecured/processdefinitions-validation-api-tests.spec.ts:523` | getProcessDefinitionInstanceVersionStatistics - Missing body |
| negative-get | bad-request | `request-validation/unsecured/processdefinitions-validation-api-tests.spec.ts:537` | getProcessDefinitionMessageSubscriptionStatistics - Additional prop __extraField |
| negative-get | bad-request | `request-validation/unsecured/processdefinitions-validation-api-tests.spec.ts:556` | getProcessDefinitionMessageSubscriptionStatistics - Body wrong top-level type |
| negative-get | bad-request | `request-validation/unsecured/processdefinitions-validation-api-tests.spec.ts:573` | getProcessDefinitionMessageSubscriptionStatistics - Missing page.after |
| negative-get | bad-request | `request-validation/unsecured/processdefinitions-validation-api-tests.spec.ts:592` | getProcessDefinitionStatistics - Additional prop __unexpectedField |
| negative-get | bad-request | `request-validation/unsecured/processdefinitions-validation-api-tests.spec.ts:614` | getProcessDefinitionStatistics - Body wrong top-level type |
| negative-get | bad-request | `request-validation/unsecured/processdefinitions-validation-api-tests.spec.ts:634` | getProcessDefinitionStatistics - Missing filter.$or.0.variables.0.name |
| negative-get | bad-request | `request-validation/unsecured/processdefinitions-validation-api-tests.spec.ts:666` | getProcessDefinitionStatistics - Missing filter.$or.0.variables.0.value |
| negative-get | bad-request | `request-validation/unsecured/processdefinitions-validation-api-tests.spec.ts:698` | getProcessDefinitionStatistics - Missing filter.variables.0.name |
| negative-get | bad-request | `request-validation/unsecured/processdefinitions-validation-api-tests.spec.ts:726` | getProcessDefinitionStatistics - Missing filter.variables.0.value |
| negative-get | bad-request | `request-validation/unsecured/processdefinitions-validation-api-tests.spec.ts:754` | getProcessDefinitionStatistics - Path param processDefinitionKey pattern violation |
| negative-get | bad-request | `request-validation/unsecured/processdefinitions-validation-api-tests.spec.ts:771` | getProcessDefinitionStatistics - uniqueItems violation filter.$or.0.tags |
| negative-get | bad-request | `request-validation/unsecured/processdefinitions-validation-api-tests.spec.ts:799` | getProcessDefinitionStatistics - uniqueItems violation filter.tags |
| negative-get | not-found | `request-validation/unsecured/processdefinitions-validation-api-tests.spec.ts:823` | getProcessDefinitionXML - Nonexistent processDefinitionKey returns 404 |
| negative-get | bad-request | `request-validation/unsecured/processdefinitions-validation-api-tests.spec.ts:839` | getProcessDefinitionXML - Path param processDefinitionKey pattern violation |
| negative-get | not-found | `request-validation/unsecured/processdefinitions-validation-api-tests.spec.ts:855` | getStartProcessForm - Nonexistent processDefinitionKey returns 404 |
| negative-get | bad-request | `request-validation/unsecured/processdefinitions-validation-api-tests.spec.ts:871` | getStartProcessForm - Path param processDefinitionKey pattern violation |
| negative-search | bad-request | `request-validation/unsecured/processdefinitions-validation-api-tests.spec.ts:887` | searchProcessDefinitions - Additional prop __unexpectedField |
| negative-search | bad-request | `request-validation/unsecured/processdefinitions-validation-api-tests.spec.ts:906` | searchProcessDefinitions - Body wrong top-level type |
| negative-search | bad-request | `request-validation/unsecured/processdefinitions-validation-api-tests.spec.ts:921` | searchProcessDefinitions - Missing sort.0.field |
| negative-search | bad-request | `request-validation/unsecured/processdefinitions-validation-api-tests.spec.ts:938` | searchProcessDefinitions - Enum violation sort.0.field |
| negative-search | bad-request | `request-validation/unsecured/processdefinitions-validation-api-tests.spec.ts:959` | searchProcessDefinitions - Enum violation sort.0.order |

### `resource` — 41 tests

- **Prerequisite to create**: none
- **Files**: `createDeployment.feature.spec.ts`, `createDeployment.variant.spec.ts`, `deleteResource.feature.spec.ts`, `getResource.feature.spec.ts`, `getResourceContent.feature.spec.ts`, `getResourceContentBinary.feature.spec.ts`, `request-validation/unsecured/deployments-validation-api-tests.spec.ts`, `request-validation/unsecured/resources-validation-api-tests.spec.ts`, `searchResources.feature.spec.ts`, `searchResources.variant.spec.ts`
- **Observation channel**: GET = 3, Search = 9
- **Form-step counts**: create=5, observe-present-get=3, observe-present-search=9, delete=1, observe-absence=1, negative-create=7, negative-get=3, negative-delete=7, negative-search=5
- **Variants**: happy-path=5, observe-absence=1, data-driven=12, unlabeled=1, bad-request=19, not-found=3, pagination-sort=2, filter=6

| form step | variants | file:line | test name |
|--|--|--|--|
| create | data-driven | `createDeployment.feature.spec.ts:12` | feature-1 - createDeployment - bpmn (1) |
| create | data-driven | `createDeployment.feature.spec.ts:39` | feature-2 - createDeployment - form (2) |
| create | data-driven | `createDeployment.feature.spec.ts:66` | feature-3 - createDeployment - dmn (3) |
| create | data-driven | `createDeployment.feature.spec.ts:93` | feature-4 - createDeployment - drd (4) |
| create | data-driven | `createDeployment.variant.spec.ts:12` | variant-1 - createDeployment - path #1 |
| observe-present-get | happy-path | `getResource.feature.spec.ts:13` | feature-1 - getResource - base (1) |
| observe-present-get | happy-path | `getResourceContent.feature.spec.ts:10` | feature-1 - getResourceContent - base (1) |
| observe-present-get | happy-path | `getResourceContentBinary.feature.spec.ts:10` | feature-1 - getResourceContentBinary - base (1) |
| observe-present-search | happy-path | `searchResources.feature.spec.ts:12` | feature-1 - searchResources - base (1) |
| observe-present-search | data-driven, filter | `searchResources.variant.spec.ts:13` | variant-1 - searchResources - bpmn #1 |
| observe-present-search | data-driven, filter | `searchResources.variant.spec.ts:60` | variant-2 - searchResources - drd #1 |
| observe-present-search | data-driven, filter | `searchResources.variant.spec.ts:104` | variant-3 - searchResources - form #1 |
| observe-present-search | data-driven, filter | `searchResources.variant.spec.ts:148` | variant-4 - searchResources - dmn #1 |
| observe-present-search | unlabeled, filter | `searchResources.variant.spec.ts:192` | variant-5 - scenario |
| observe-present-search | data-driven, filter | `searchResources.variant.spec.ts:219` | variant-6 - searchResources - path #1 |
| observe-present-search | data-driven, pagination-sort | `searchResources.variant.spec.ts:265` | variant-7 - searchResources - path #1 |
| observe-present-search | data-driven, pagination-sort | `searchResources.variant.spec.ts:315` | variant-8 - searchResources - path #1 |
| delete | happy-path | `deleteResource.feature.spec.ts:12` | feature-1 - deleteResource - base (1) |
| observe-absence | observe-absence | `searchResources.feature.spec.ts:34` | feature-2 - searchResources - negative empty (2) |
| negative-create | bad-request | `request-validation/unsecured/deployments-validation-api-tests.spec.ts:18` | createDeployment - Param tenantId wrong type |
| negative-create | bad-request | `request-validation/unsecured/deployments-validation-api-tests.spec.ts:38` | createDeployment - Constraint violation tenantId (#1) |
| negative-create | bad-request | `request-validation/unsecured/deployments-validation-api-tests.spec.ts:58` | createDeployment - Constraint violation tenantId (#2) |
| negative-create | bad-request | `request-validation/unsecured/deployments-validation-api-tests.spec.ts:78` | createDeployment - Constraint violation tenantId (#3) |
| negative-create | bad-request | `request-validation/unsecured/deployments-validation-api-tests.spec.ts:98` | createDeployment - Constraint violation tenantId (#4) |
| negative-create | bad-request | `request-validation/unsecured/deployments-validation-api-tests.spec.ts:118` | createDeployment - Missing body |
| negative-create | bad-request | `request-validation/unsecured/deployments-validation-api-tests.spec.ts:135` | createDeployment - Missing resources |
| negative-get | not-found | `request-validation/unsecured/resources-validation-api-tests.spec.ts:160` | getResource - Nonexistent resourceKey returns 404 |
| negative-get | not-found | `request-validation/unsecured/resources-validation-api-tests.spec.ts:174` | getResourceContent - Nonexistent resourceKey returns 404 |
| negative-get | not-found | `request-validation/unsecured/resources-validation-api-tests.spec.ts:190` | getResourceContentBinary - Nonexistent resourceKey returns 404 |
| negative-delete | bad-request | `request-validation/unsecured/resources-validation-api-tests.spec.ts:18` | deleteResource - Additional prop __unexpectedField |
| negative-delete | bad-request | `request-validation/unsecured/resources-validation-api-tests.spec.ts:38` | deleteResource - Body wrong top-level type |
| negative-delete | bad-request | `request-validation/unsecured/resources-validation-api-tests.spec.ts:55` | deleteResource - Param operationReference wrong type (#1) |
| negative-delete | bad-request | `request-validation/unsecured/resources-validation-api-tests.spec.ts:76` | deleteResource - Param operationReference wrong type (#2) |
| negative-delete | bad-request | `request-validation/unsecured/resources-validation-api-tests.spec.ts:97` | deleteResource - Constraint violation operationReference (#1) |
| negative-delete | bad-request | `request-validation/unsecured/resources-validation-api-tests.spec.ts:118` | deleteResource - Constraint violation operationReference (#2) |
| negative-delete | bad-request | `request-validation/unsecured/resources-validation-api-tests.spec.ts:139` | deleteResource - Constraint violation operationReference (#3) |
| negative-search | bad-request | `request-validation/unsecured/resources-validation-api-tests.spec.ts:206` | searchResources - Additional prop __unexpectedField |
| negative-search | bad-request | `request-validation/unsecured/resources-validation-api-tests.spec.ts:223` | searchResources - Body wrong top-level type |
| negative-search | bad-request | `request-validation/unsecured/resources-validation-api-tests.spec.ts:238` | searchResources - Missing sort.0.field |
| negative-search | bad-request | `request-validation/unsecured/resources-validation-api-tests.spec.ts:255` | searchResources - Enum violation sort.0.field |
| negative-search | bad-request | `request-validation/unsecured/resources-validation-api-tests.spec.ts:276` | searchResources - Enum violation sort.0.order |

### `decision-definition` — 30 tests

- **Prerequisite to create**: deployed-decision
- **Files**: `evaluateDecision.feature.spec.ts`, `evaluateDecision.variant.spec.ts`, `getDecisionDefinition.feature.spec.ts`, `getDecisionDefinitionXML.feature.spec.ts`, `request-validation/unsecured/decisiondefinitions-validation-api-tests.spec.ts`, `searchDecisionDefinitions.feature.spec.ts`, `searchDecisionDefinitions.variant.spec.ts`
- **Observation channel**: GET = 2, Search = 7
- **Form-step counts**: create=4, observe-present-get=2, observe-present-search=7, observe-absence=1, negative-create=7, negative-get=4, negative-search=5
- **Variants**: happy-path=4, observe-absence=1, data-driven=9, bad-request=14, not-found=2, pagination-sort=2, filter=4

| form step | variants | file:line | test name |
|--|--|--|--|
| create | happy-path | `evaluateDecision.feature.spec.ts:12` | feature-1 - evaluateDecision - base (1) |
| create | data-driven | `evaluateDecision.feature.spec.ts:59` | feature-2 - evaluateDecision - oneOf group0 Decision evaluation by ID (2) |
| create | data-driven | `evaluateDecision.feature.spec.ts:109` | feature-3 - evaluateDecision - oneOf group0 Decision evaluation by key (3) |
| create | data-driven | `evaluateDecision.variant.spec.ts:12` | variant-1 - evaluateDecision - dmn #1 |
| observe-present-get | happy-path | `getDecisionDefinition.feature.spec.ts:13` | feature-1 - getDecisionDefinition - base (1) |
| observe-present-get | happy-path | `getDecisionDefinitionXML.feature.spec.ts:10` | feature-1 - getDecisionDefinitionXML - base (1) |
| observe-present-search | happy-path | `searchDecisionDefinitions.feature.spec.ts:12` | feature-1 - searchDecisionDefinitions - base (1) |
| observe-present-search | data-driven, filter | `searchDecisionDefinitions.variant.spec.ts:13` | variant-1 - searchDecisionDefinitions - dmn #1 |
| observe-present-search | data-driven, filter | `searchDecisionDefinitions.variant.spec.ts:59` | variant-2 - searchDecisionDefinitions - path #1 |
| observe-present-search | data-driven, filter | `searchDecisionDefinitions.variant.spec.ts:107` | variant-3 - searchDecisionDefinitions - dmn #1 |
| observe-present-search | data-driven, filter | `searchDecisionDefinitions.variant.spec.ts:153` | variant-4 - searchDecisionDefinitions - drd #1 |
| observe-present-search | data-driven, pagination-sort | `searchDecisionDefinitions.variant.spec.ts:199` | variant-5 - searchDecisionDefinitions - path #1 |
| observe-present-search | data-driven, pagination-sort | `searchDecisionDefinitions.variant.spec.ts:251` | variant-6 - searchDecisionDefinitions - path #1 |
| observe-absence | observe-absence | `searchDecisionDefinitions.feature.spec.ts:36` | feature-2 - searchDecisionDefinitions - negative empty (2) |
| negative-create | bad-request | `request-validation/unsecured/decisiondefinitions-validation-api-tests.spec.ts:18` | evaluateDecision - Additional prop __extraField |
| negative-create | bad-request | `request-validation/unsecured/decisiondefinitions-validation-api-tests.spec.ts:35` | evaluateDecision - Body wrong top-level type |
| negative-create | bad-request | `request-validation/unsecured/decisiondefinitions-validation-api-tests.spec.ts:50` | evaluateDecision - Missing body |
| negative-create | bad-request | `request-validation/unsecured/decisiondefinitions-validation-api-tests.spec.ts:62` | evaluateDecision - oneOf ambiguous |
| negative-create | bad-request | `request-validation/unsecured/decisiondefinitions-validation-api-tests.spec.ts:80` | evaluateDecision - oneOf cross bleed |
| negative-create | bad-request | `request-validation/unsecured/decisiondefinitions-validation-api-tests.spec.ts:98` | evaluateDecision - oneOf none match |
| negative-create | bad-request | `request-validation/unsecured/decisiondefinitions-validation-api-tests.spec.ts:113` | evaluateDecision - oneOf violation |
| negative-get | not-found | `request-validation/unsecured/decisiondefinitions-validation-api-tests.spec.ts:131` | getDecisionDefinition - Nonexistent decisionDefinitionKey returns 404 |
| negative-get | bad-request | `request-validation/unsecured/decisiondefinitions-validation-api-tests.spec.ts:147` | getDecisionDefinition - Path param decisionDefinitionKey pattern violation |
| negative-get | not-found | `request-validation/unsecured/decisiondefinitions-validation-api-tests.spec.ts:163` | getDecisionDefinitionXML - Nonexistent decisionDefinitionKey returns 404 |
| negative-get | bad-request | `request-validation/unsecured/decisiondefinitions-validation-api-tests.spec.ts:179` | getDecisionDefinitionXML - Path param decisionDefinitionKey pattern violation |
| negative-search | bad-request | `request-validation/unsecured/decisiondefinitions-validation-api-tests.spec.ts:195` | searchDecisionDefinitions - Additional prop __unexpectedField |
| negative-search | bad-request | `request-validation/unsecured/decisiondefinitions-validation-api-tests.spec.ts:214` | searchDecisionDefinitions - Body wrong top-level type |
| negative-search | bad-request | `request-validation/unsecured/decisiondefinitions-validation-api-tests.spec.ts:229` | searchDecisionDefinitions - Missing sort.0.field |
| negative-search | bad-request | `request-validation/unsecured/decisiondefinitions-validation-api-tests.spec.ts:246` | searchDecisionDefinitions - Enum violation sort.0.field |
| negative-search | bad-request | `request-validation/unsecured/decisiondefinitions-validation-api-tests.spec.ts:267` | searchDecisionDefinitions - Enum violation sort.0.order |

### `decision-requirements` — 17 tests

- **Prerequisite to create**: deployed-drd
- **Files**: `getDecisionRequirements.feature.spec.ts`, `getDecisionRequirementsXML.feature.spec.ts`, `request-validation/unsecured/decisionrequirements-validation-api-tests.spec.ts`, `searchDecisionRequirements.feature.spec.ts`, `searchDecisionRequirements.variant.spec.ts`
- **Observation channel**: GET = 2, Search = 5
- **Form-step counts**: observe-present-get=2, observe-present-search=5, observe-absence=1, negative-get=4, negative-search=5
- **Variants**: happy-path=3, observe-absence=1, data-driven=4, bad-request=7, not-found=2, pagination-sort=2, filter=2

| form step | variants | file:line | test name |
|--|--|--|--|
| observe-present-get | happy-path | `getDecisionRequirements.feature.spec.ts:13` | feature-1 - getDecisionRequirements - base (1) |
| observe-present-get | happy-path | `getDecisionRequirementsXML.feature.spec.ts:10` | feature-1 - getDecisionRequirementsXML - base (1) |
| observe-present-search | happy-path | `searchDecisionRequirements.feature.spec.ts:12` | feature-1 - searchDecisionRequirements - base (1) |
| observe-present-search | data-driven, filter | `searchDecisionRequirements.variant.spec.ts:13` | variant-1 - searchDecisionRequirements - drd #1 |
| observe-present-search | data-driven, filter | `searchDecisionRequirements.variant.spec.ts:59` | variant-2 - searchDecisionRequirements - path #1 |
| observe-present-search | data-driven, pagination-sort | `searchDecisionRequirements.variant.spec.ts:107` | variant-3 - searchDecisionRequirements - path #1 |
| observe-present-search | data-driven, pagination-sort | `searchDecisionRequirements.variant.spec.ts:159` | variant-4 - searchDecisionRequirements - path #1 |
| observe-absence | observe-absence | `searchDecisionRequirements.feature.spec.ts:36` | feature-2 - searchDecisionRequirements - negative empty (2) |
| negative-get | not-found | `request-validation/unsecured/decisionrequirements-validation-api-tests.spec.ts:18` | getDecisionRequirements - Nonexistent decisionRequirementsKey returns 404 |
| negative-get | bad-request | `request-validation/unsecured/decisionrequirements-validation-api-tests.spec.ts:34` | getDecisionRequirements - Path param decisionRequirementsKey pattern violation |
| negative-get | not-found | `request-validation/unsecured/decisionrequirements-validation-api-tests.spec.ts:50` | getDecisionRequirementsXML - Nonexistent decisionRequirementsKey returns 404 |
| negative-get | bad-request | `request-validation/unsecured/decisionrequirements-validation-api-tests.spec.ts:66` | getDecisionRequirementsXML - Path param decisionRequirementsKey pattern violation |
| negative-search | bad-request | `request-validation/unsecured/decisionrequirements-validation-api-tests.spec.ts:82` | searchDecisionRequirements - Additional prop __unexpectedField |
| negative-search | bad-request | `request-validation/unsecured/decisionrequirements-validation-api-tests.spec.ts:101` | searchDecisionRequirements - Body wrong top-level type |
| negative-search | bad-request | `request-validation/unsecured/decisionrequirements-validation-api-tests.spec.ts:116` | searchDecisionRequirements - Missing sort.0.field |
| negative-search | bad-request | `request-validation/unsecured/decisionrequirements-validation-api-tests.spec.ts:133` | searchDecisionRequirements - Enum violation sort.0.field |
| negative-search | bad-request | `request-validation/unsecured/decisionrequirements-validation-api-tests.spec.ts:156` | searchDecisionRequirements - Enum violation sort.0.order |

## D. Process-Instance Lifecycle & Ops

**Form**: Deploy process (prerequisite) → Create instance → Get/Search instance → Cancel/Migrate/Modify/Resolve-incident → Delete → Observe absence. Batch creators wrap N instances per call.

**Total tests**: 283

### `process-instance` — 283 tests

- **Prerequisite to create**: deployed-process
- **Files**: `cancelProcessInstancesBatchOperation.feature.spec.ts`, `cancelProcessInstancesBatchOperation.variant.spec.ts`, `createProcessInstance.feature.spec.ts`, `createProcessInstance.variant.spec.ts`, `deleteProcessInstance.feature.spec.ts`, `deleteProcessInstancesBatchOperation.feature.spec.ts`, `deleteProcessInstancesBatchOperation.variant.spec.ts`, `getProcessInstanceCallHierarchy.feature.spec.ts`, `getProcessInstanceSequenceFlows.feature.spec.ts`, `getProcessInstanceStatistics.feature.spec.ts`, `migrateProcessInstance.feature.spec.ts`, `migrateProcessInstance.variant.spec.ts`, `migrateProcessInstancesBatchOperation.feature.spec.ts`, `migrateProcessInstancesBatchOperation.variant.spec.ts`, `modifyProcessInstance.feature.spec.ts`, `modifyProcessInstance.variant.spec.ts`, `modifyProcessInstancesBatchOperation.feature.spec.ts`, `modifyProcessInstancesBatchOperation.variant.spec.ts`, `request-validation/unsecured/processinstances-validation-api-tests.spec.ts`, `resolveIncidentsBatchOperation.feature.spec.ts`, `resolveIncidentsBatchOperation.variant.spec.ts`, `resolveProcessInstanceIncidents.feature.spec.ts`, `searchProcessInstanceIncidents.feature.spec.ts`, `searchProcessInstanceIncidents.variant.spec.ts`, `searchProcessInstances.feature.spec.ts`, `searchProcessInstances.variant.spec.ts`, `templates/StateTransitionVisibleAfterAction/ProcessInstance.cancelProcessInstance.lifecycle.spec.ts`
- **Observation channel**: GET = 3, Search = 20
- **Form-step counts**: create=8, observe-present-get=3, observe-present-search=20, mutate=50, delete=23, observe-absence=1, negative-create=6, negative-get=6, negative-update=98, negative-delete=50, negative-search=17
- **Variants**: happy-path=16, observe-absence=1, data-driven=89, bad-request=175, not-found=2, pagination-sort=4, filter=73

| form step | variants | file:line | test name |
|--|--|--|--|
| create | happy-path | `createProcessInstance.feature.spec.ts:12` | feature-1 - createProcessInstance - base (1) |
| create | data-driven | `createProcessInstance.feature.spec.ts:54` | feature-2 - createProcessInstance - oneOf group0 Process creation by key (2) |
| create | data-driven | `createProcessInstance.feature.spec.ts:99` | feature-3 - createProcessInstance - oneOf group0 Process creation by id (3) |
| create | data-driven | `createProcessInstance.variant.spec.ts:13` | variant-1 - createProcessInstance - bpmn #1 |
| create | data-driven | `createProcessInstance.variant.spec.ts:65` | variant-2 - createProcessInstance - bpmn #1 |
| create | data-driven | `createProcessInstance.variant.spec.ts:117` | variant-3 - createProcessInstance - bpmn #1 |
| create | data-driven | `createProcessInstance.variant.spec.ts:182` | variant-4 - createProcessInstance - bpmn #1 |
| create | data-driven | `createProcessInstance.variant.spec.ts:270` | variant-5 - createProcessInstance - bpmn #1 |
| observe-present-get | happy-path | `getProcessInstanceCallHierarchy.feature.spec.ts:10` | feature-1 - getProcessInstanceCallHierarchy - base (1) |
| observe-present-get | happy-path | `getProcessInstanceSequenceFlows.feature.spec.ts:13` | feature-1 - getProcessInstanceSequenceFlows - base (1) |
| observe-present-get | happy-path | `getProcessInstanceStatistics.feature.spec.ts:13` | feature-1 - getProcessInstanceStatistics - base (1) |
| observe-present-search | happy-path | `searchProcessInstanceIncidents.feature.spec.ts:13` | feature-1 - searchProcessInstanceIncidents - base (1) |
| observe-present-search | data-driven, filter | `searchProcessInstanceIncidents.variant.spec.ts:13` | variant-1 - searchProcessInstanceIncidents - cycle/bpmn+bpmn #1 |
| observe-present-search | data-driven, filter | `searchProcessInstanceIncidents.variant.spec.ts:102` | variant-2 - searchProcessInstanceIncidents - bpmn #1 |
| observe-present-search | data-driven, filter | `searchProcessInstanceIncidents.variant.spec.ts:174` | variant-3 - searchProcessInstanceIncidents - bpmn #1 |
| observe-present-search | data-driven, filter | `searchProcessInstanceIncidents.variant.spec.ts:277` | variant-4 - searchProcessInstanceIncidents - bpmn #1 |
| observe-present-search | data-driven, pagination-sort | `searchProcessInstanceIncidents.variant.spec.ts:380` | variant-5 - searchProcessInstanceIncidents - bpmn #1 |
| observe-present-search | data-driven, pagination-sort | `searchProcessInstanceIncidents.variant.spec.ts:475` | variant-6 - searchProcessInstanceIncidents - bpmn #1 |
| observe-present-search | happy-path | `searchProcessInstances.feature.spec.ts:13` | feature-1 - searchProcessInstances - base (1) |
| observe-present-search | data-driven, filter | `searchProcessInstances.variant.spec.ts:13` | variant-1 - searchProcessInstances - path #1 |
| observe-present-search | data-driven, filter | `searchProcessInstances.variant.spec.ts:84` | variant-2 - searchProcessInstances - bpmn #1 |
| observe-present-search | data-driven, filter | `searchProcessInstances.variant.spec.ts:151` | variant-3 - searchProcessInstances - bpmn #1 |
| observe-present-search | data-driven, filter | `searchProcessInstances.variant.spec.ts:218` | variant-4 - searchProcessInstances - bpmn #1 |
| observe-present-search | data-driven, filter | `searchProcessInstances.variant.spec.ts:316` | variant-5 - searchProcessInstances - bpmn #1 |
| observe-present-search | data-driven, filter | `searchProcessInstances.variant.spec.ts:409` | variant-6 - searchProcessInstances - path #1 |
| observe-present-search | data-driven, filter | `searchProcessInstances.variant.spec.ts:484` | variant-7 - searchProcessInstances - bpmn #1 |
| observe-present-search | data-driven, filter | `searchProcessInstances.variant.spec.ts:555` | variant-8 - searchProcessInstances - bpmn #1 |
| observe-present-search | data-driven, filter | `searchProcessInstances.variant.spec.ts:626` | variant-9 - searchProcessInstances - bpmn #1 |
| observe-present-search | data-driven, filter | `searchProcessInstances.variant.spec.ts:728` | variant-10 - searchProcessInstances - bpmn #1 |
| observe-present-search | data-driven, pagination-sort | `searchProcessInstances.variant.spec.ts:825` | variant-11 - searchProcessInstances - path #1 |
| observe-present-search | data-driven, pagination-sort | `searchProcessInstances.variant.spec.ts:918` | variant-12 - searchProcessInstances - path #1 |
| mutate | happy-path | `migrateProcessInstance.feature.spec.ts:9` | feature-1 - migrateProcessInstance - base (1) |
| mutate | data-driven | `migrateProcessInstance.variant.spec.ts:9` | variant-1 - migrateProcessInstance - cycle/bpmn+bpmn #1 |
| mutate | data-driven | `migrateProcessInstance.variant.spec.ts:120` | variant-2 - migrateProcessInstance - cycle/bpmn+bpmn #1 |
| mutate | happy-path, filter | `migrateProcessInstancesBatchOperation.feature.spec.ts:12` | feature-1 - migrateProcessInstancesBatchOperation - base (1) |
| mutate | data-driven, filter | `migrateProcessInstancesBatchOperation.variant.spec.ts:12` | variant-1 - migrateProcessInstancesBatchOperation - bpmn #1 |
| mutate | data-driven, filter | `migrateProcessInstancesBatchOperation.variant.spec.ts:62` | variant-2 - migrateProcessInstancesBatchOperation - bpmn #1 |
| mutate | data-driven, filter | `migrateProcessInstancesBatchOperation.variant.spec.ts:130` | variant-3 - migrateProcessInstancesBatchOperation - bpmn #1 |
| mutate | data-driven, filter | `migrateProcessInstancesBatchOperation.variant.spec.ts:198` | variant-4 - migrateProcessInstancesBatchOperation - bpmn #1 |
| mutate | data-driven, filter | `migrateProcessInstancesBatchOperation.variant.spec.ts:249` | variant-5 - migrateProcessInstancesBatchOperation - bpmn #1 |
| mutate | data-driven, filter | `migrateProcessInstancesBatchOperation.variant.spec.ts:300` | variant-6 - migrateProcessInstancesBatchOperation - bpmn #1 |
| mutate | data-driven, filter | `migrateProcessInstancesBatchOperation.variant.spec.ts:354` | variant-7 - migrateProcessInstancesBatchOperation - bpmn #1 |
| mutate | data-driven, filter | `migrateProcessInstancesBatchOperation.variant.spec.ts:426` | variant-8 - migrateProcessInstancesBatchOperation - bpmn #1 |
| mutate | data-driven, filter | `migrateProcessInstancesBatchOperation.variant.spec.ts:498` | variant-9 - migrateProcessInstancesBatchOperation - bpmn #1 |
| mutate | data-driven, filter | `migrateProcessInstancesBatchOperation.variant.spec.ts:553` | variant-10 - migrateProcessInstancesBatchOperation - bpmn #1 |
| mutate | data-driven, filter | `migrateProcessInstancesBatchOperation.variant.spec.ts:608` | variant-11 - migrateProcessInstancesBatchOperation - bpmn #1 |
| mutate | data-driven, filter | `migrateProcessInstancesBatchOperation.variant.spec.ts:663` | variant-12 - migrateProcessInstancesBatchOperation - bpmn #1 |
| mutate | happy-path | `modifyProcessInstance.feature.spec.ts:9` | feature-1 - modifyProcessInstance - base (1) |
| mutate | data-driven | `modifyProcessInstance.variant.spec.ts:9` | variant-1 - modifyProcessInstance - bpmn #1 |
| mutate | data-driven | `modifyProcessInstance.variant.spec.ts:101` | variant-2 - modifyProcessInstance - bpmn #1 |
| mutate | data-driven | `modifyProcessInstance.variant.spec.ts:193` | variant-3 - modifyProcessInstance - bpmn #1 |
| mutate | data-driven | `modifyProcessInstance.variant.spec.ts:287` | variant-4 - modifyProcessInstance - bpmn #1 |
| mutate | data-driven | `modifyProcessInstance.variant.spec.ts:381` | variant-5 - modifyProcessInstance - bpmn #1 |
| mutate | data-driven | `modifyProcessInstance.variant.spec.ts:473` | variant-6 - modifyProcessInstance - bpmn #1 |
| mutate | data-driven | `modifyProcessInstance.variant.spec.ts:567` | variant-7 - modifyProcessInstance - bpmn #1 |
| mutate | data-driven | `modifyProcessInstance.variant.spec.ts:659` | variant-8 - modifyProcessInstance - bpmn #1 |
| mutate | happy-path, filter | `modifyProcessInstancesBatchOperation.feature.spec.ts:11` | feature-1 - modifyProcessInstancesBatchOperation - base (1) |
| mutate | data-driven, filter | `modifyProcessInstancesBatchOperation.variant.spec.ts:12` | variant-1 - modifyProcessInstancesBatchOperation - bpmn #1 |
| mutate | data-driven, filter | `modifyProcessInstancesBatchOperation.variant.spec.ts:66` | variant-2 - modifyProcessInstancesBatchOperation - bpmn #1 |
| mutate | data-driven, filter | `modifyProcessInstancesBatchOperation.variant.spec.ts:138` | variant-3 - modifyProcessInstancesBatchOperation - bpmn #1 |
| mutate | data-driven, filter | `modifyProcessInstancesBatchOperation.variant.spec.ts:210` | variant-4 - modifyProcessInstancesBatchOperation - bpmn #1 |
| mutate | data-driven, filter | `modifyProcessInstancesBatchOperation.variant.spec.ts:313` | variant-5 - modifyProcessInstancesBatchOperation - bpmn #1 |
| mutate | data-driven, filter | `modifyProcessInstancesBatchOperation.variant.spec.ts:416` | variant-6 - modifyProcessInstancesBatchOperation - bpmn #1 |
| mutate | data-driven, filter | `modifyProcessInstancesBatchOperation.variant.spec.ts:474` | variant-7 - modifyProcessInstancesBatchOperation - bpmn #1 |
| mutate | data-driven, filter | `modifyProcessInstancesBatchOperation.variant.spec.ts:550` | variant-8 - modifyProcessInstancesBatchOperation - bpmn #1 |
| mutate | data-driven, filter | `modifyProcessInstancesBatchOperation.variant.spec.ts:626` | variant-9 - modifyProcessInstancesBatchOperation - bpmn #1 |
| mutate | data-driven, filter | `modifyProcessInstancesBatchOperation.variant.spec.ts:733` | variant-10 - modifyProcessInstancesBatchOperation - bpmn #1 |
| mutate | data-driven, filter | `modifyProcessInstancesBatchOperation.variant.spec.ts:840` | variant-11 - modifyProcessInstancesBatchOperation - bpmn #1 |
| mutate | data-driven, filter | `modifyProcessInstancesBatchOperation.variant.spec.ts:941` | variant-12 - modifyProcessInstancesBatchOperation - bpmn #1 |
| mutate | happy-path, filter | `resolveIncidentsBatchOperation.feature.spec.ts:11` | feature-1 - resolveIncidentsBatchOperation - base (1) |
| mutate | data-driven, filter | `resolveIncidentsBatchOperation.variant.spec.ts:12` | variant-1 - resolveIncidentsBatchOperation - bpmn #1 |
| mutate | data-driven, filter | `resolveIncidentsBatchOperation.variant.spec.ts:60` | variant-2 - resolveIncidentsBatchOperation - bpmn #1 |
| mutate | data-driven, filter | `resolveIncidentsBatchOperation.variant.spec.ts:126` | variant-3 - resolveIncidentsBatchOperation - bpmn #1 |
| mutate | data-driven, filter | `resolveIncidentsBatchOperation.variant.spec.ts:192` | variant-4 - resolveIncidentsBatchOperation - bpmn #1 |
| mutate | data-driven, filter | `resolveIncidentsBatchOperation.variant.spec.ts:289` | variant-5 - resolveIncidentsBatchOperation - bpmn #1 |
| mutate | data-driven, filter | `resolveIncidentsBatchOperation.variant.spec.ts:386` | variant-6 - resolveIncidentsBatchOperation - bpmn #1 |
| mutate | data-driven, filter | `resolveIncidentsBatchOperation.variant.spec.ts:438` | variant-7 - resolveIncidentsBatchOperation - bpmn #1 |
| mutate | data-driven, filter | `resolveIncidentsBatchOperation.variant.spec.ts:508` | variant-8 - resolveIncidentsBatchOperation - bpmn #1 |
| mutate | data-driven, filter | `resolveIncidentsBatchOperation.variant.spec.ts:578` | variant-9 - resolveIncidentsBatchOperation - bpmn #1 |
| mutate | data-driven, filter | `resolveIncidentsBatchOperation.variant.spec.ts:679` | variant-10 - resolveIncidentsBatchOperation - bpmn #1 |
| mutate | happy-path | `resolveProcessInstanceIncidents.feature.spec.ts:12` | feature-1 - resolveProcessInstanceIncidents - base (1) |
| delete | happy-path, filter | `cancelProcessInstancesBatchOperation.feature.spec.ts:11` | feature-1 - cancelProcessInstancesBatchOperation - base (1) |
| delete | data-driven, filter | `cancelProcessInstancesBatchOperation.variant.spec.ts:12` | variant-1 - cancelProcessInstancesBatchOperation - bpmn #1 |
| delete | data-driven, filter | `cancelProcessInstancesBatchOperation.variant.spec.ts:60` | variant-2 - cancelProcessInstancesBatchOperation - bpmn #1 |
| delete | data-driven, filter | `cancelProcessInstancesBatchOperation.variant.spec.ts:126` | variant-3 - cancelProcessInstancesBatchOperation - bpmn #1 |
| delete | data-driven, filter | `cancelProcessInstancesBatchOperation.variant.spec.ts:192` | variant-4 - cancelProcessInstancesBatchOperation - bpmn #1 |
| delete | data-driven, filter | `cancelProcessInstancesBatchOperation.variant.spec.ts:289` | variant-5 - cancelProcessInstancesBatchOperation - bpmn #1 |
| delete | data-driven, filter | `cancelProcessInstancesBatchOperation.variant.spec.ts:386` | variant-6 - cancelProcessInstancesBatchOperation - bpmn #1 |
| delete | data-driven, filter | `cancelProcessInstancesBatchOperation.variant.spec.ts:438` | variant-7 - cancelProcessInstancesBatchOperation - bpmn #1 |
| delete | data-driven, filter | `cancelProcessInstancesBatchOperation.variant.spec.ts:508` | variant-8 - cancelProcessInstancesBatchOperation - bpmn #1 |
| delete | data-driven, filter | `cancelProcessInstancesBatchOperation.variant.spec.ts:578` | variant-9 - cancelProcessInstancesBatchOperation - bpmn #1 |
| delete | data-driven, filter | `cancelProcessInstancesBatchOperation.variant.spec.ts:679` | variant-10 - cancelProcessInstancesBatchOperation - bpmn #1 |
| delete | happy-path | `deleteProcessInstance.feature.spec.ts:10` | feature-1 - deleteProcessInstance - base (1) |
| delete | happy-path, filter | `deleteProcessInstancesBatchOperation.feature.spec.ts:11` | feature-1 - deleteProcessInstancesBatchOperation - base (1) |
| delete | data-driven, filter | `deleteProcessInstancesBatchOperation.variant.spec.ts:12` | variant-1 - deleteProcessInstancesBatchOperation - bpmn #1 |
| delete | data-driven, filter | `deleteProcessInstancesBatchOperation.variant.spec.ts:60` | variant-2 - deleteProcessInstancesBatchOperation - bpmn #1 |
| delete | data-driven, filter | `deleteProcessInstancesBatchOperation.variant.spec.ts:126` | variant-3 - deleteProcessInstancesBatchOperation - bpmn #1 |
| delete | data-driven, filter | `deleteProcessInstancesBatchOperation.variant.spec.ts:192` | variant-4 - deleteProcessInstancesBatchOperation - bpmn #1 |
| delete | data-driven, filter | `deleteProcessInstancesBatchOperation.variant.spec.ts:289` | variant-5 - deleteProcessInstancesBatchOperation - bpmn #1 |
| delete | data-driven, filter | `deleteProcessInstancesBatchOperation.variant.spec.ts:386` | variant-6 - deleteProcessInstancesBatchOperation - bpmn #1 |
| delete | data-driven, filter | `deleteProcessInstancesBatchOperation.variant.spec.ts:438` | variant-7 - deleteProcessInstancesBatchOperation - bpmn #1 |
| delete | data-driven, filter | `deleteProcessInstancesBatchOperation.variant.spec.ts:508` | variant-8 - deleteProcessInstancesBatchOperation - bpmn #1 |
| delete | data-driven, filter | `deleteProcessInstancesBatchOperation.variant.spec.ts:578` | variant-9 - deleteProcessInstancesBatchOperation - bpmn #1 |
| delete | data-driven, filter | `deleteProcessInstancesBatchOperation.variant.spec.ts:679` | variant-10 - deleteProcessInstancesBatchOperation - bpmn #1 |
| observe-absence | observe-absence | `searchProcessInstances.feature.spec.ts:75` | feature-2 - searchProcessInstances - negative empty (2) |
| negative-create | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:556` | createProcessInstance - Body wrong top-level type |
| negative-create | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:571` | createProcessInstance - Missing body |
| negative-create | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:583` | createProcessInstance - oneOf ambiguous |
| negative-create | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:601` | createProcessInstance - oneOf cross bleed |
| negative-create | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:619` | createProcessInstance - oneOf none match |
| negative-create | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:634` | createProcessInstance - oneOf violation |
| negative-get | not-found | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:1190` | getProcessInstance - Nonexistent processInstanceKey returns 404 |
| negative-get | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:1206` | getProcessInstance - Path param processInstanceKey pattern violation |
| negative-get | not-found | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:1222` | getProcessInstanceCallHierarchy - Nonexistent processInstanceKey returns 404 |
| negative-get | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:1238` | getProcessInstanceCallHierarchy - Path param processInstanceKey pattern violation |
| negative-get | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:1254` | getProcessInstanceSequenceFlows - Path param processInstanceKey pattern violation |
| negative-get | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:1270` | getProcessInstanceStatistics - Path param processInstanceKey pattern violation |
| negative-update | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:1286` | migrateProcessInstance - Additional prop __unexpectedField |
| negative-update | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:1315` | migrateProcessInstance - Body wrong top-level type |
| negative-update | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:1332` | migrateProcessInstance - Param operationReference wrong type (#1) |
| negative-update | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:1360` | migrateProcessInstance - Param operationReference wrong type (#2) |
| negative-update | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:1388` | migrateProcessInstance - Param targetProcessDefinitionKey wrong type (#1) |
| negative-update | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:1416` | migrateProcessInstance - Param targetProcessDefinitionKey wrong type (#2) |
| negative-update | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:1444` | migrateProcessInstance - Constraint violation operationReference (#1) |
| negative-update | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:1472` | migrateProcessInstance - Constraint violation operationReference (#2) |
| negative-update | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:1500` | migrateProcessInstance - Constraint violation operationReference (#3) |
| negative-update | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:1528` | migrateProcessInstance - Missing mappingInstructions.0.sourceElementId |
| negative-update | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:1554` | migrateProcessInstance - Missing mappingInstructions.0.targetElementId |
| negative-update | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:1580` | migrateProcessInstance - Missing targetProcessDefinitionKey (#1) |
| negative-update | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:1606` | migrateProcessInstance - Missing mappingInstructions |
| negative-update | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:1625` | migrateProcessInstance - Missing targetProcessDefinitionKey (#2) |
| negative-update | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:1646` | migrateProcessInstance - Missing body |
| negative-update | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:1660` | migrateProcessInstance - Missing combo targetProcessDefinitionKey,mappingInstructions |
| negative-update | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:1679` | migrateProcessInstance - Path param processInstanceKey pattern violation |
| negative-update | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:1695` | migrateProcessInstancesBatchOperation - Additional prop __unexpectedField |
| negative-update | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:1727` | migrateProcessInstancesBatchOperation - Body wrong top-level type |
| negative-update | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:1744` | migrateProcessInstancesBatchOperation - Param migrationPlan.targetProcessDefinitionKey wrong type (#1) |
| negative-update | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:1775` | migrateProcessInstancesBatchOperation - Param migrationPlan.targetProcessDefinitionKey wrong type (#2) |
| negative-update | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:1806` | migrateProcessInstancesBatchOperation - Param operationReference wrong type (#1) |
| negative-update | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:1837` | migrateProcessInstancesBatchOperation - Param operationReference wrong type (#2) |
| negative-update | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:1868` | migrateProcessInstancesBatchOperation - Constraint violation filter.tags (#1) |
| negative-update | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:1899` | migrateProcessInstancesBatchOperation - Constraint violation filter.tags (#2) |
| negative-update | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:1930` | migrateProcessInstancesBatchOperation - Constraint violation operationReference (#1) |
| negative-update | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:1961` | migrateProcessInstancesBatchOperation - Constraint violation operationReference (#2) |
| negative-update | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:1992` | migrateProcessInstancesBatchOperation - Constraint violation operationReference (#3) |
| negative-update | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:2023` | migrateProcessInstancesBatchOperation - Missing filter (#1) |
| negative-update | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:2050` | migrateProcessInstancesBatchOperation - Missing filter.$or.0.variables.0.name |
| negative-update | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:2088` | migrateProcessInstancesBatchOperation - Missing filter.$or.0.variables.0.value |
| negative-update | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:2126` | migrateProcessInstancesBatchOperation - Missing filter.variables.0.name |
| negative-update | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:2160` | migrateProcessInstancesBatchOperation - Missing filter.variables.0.value |
| negative-update | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:2194` | migrateProcessInstancesBatchOperation - Missing migrationPlan (#1) |
| negative-update | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:2213` | migrateProcessInstancesBatchOperation - Missing migrationPlan.mappingInstructions |
| negative-update | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:2235` | migrateProcessInstancesBatchOperation - Missing migrationPlan.mappingInstructions.0.sourceElementId |
| negative-update | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:2262` | migrateProcessInstancesBatchOperation - Missing migrationPlan.mappingInstructions.0.targetElementId |
| negative-update | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:2289` | migrateProcessInstancesBatchOperation - Missing migrationPlan.targetProcessDefinitionKey |
| negative-update | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:2316` | migrateProcessInstancesBatchOperation - Missing filter (#2) |
| negative-update | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:2335` | migrateProcessInstancesBatchOperation - Missing migrationPlan (#2) |
| negative-update | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:2354` | migrateProcessInstancesBatchOperation - Missing body |
| negative-update | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:2366` | migrateProcessInstancesBatchOperation - Missing combo filter,migrationPlan |
| negative-update | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:2383` | migrateProcessInstancesBatchOperation - uniqueItems violation filter.$or.0.tags |
| negative-update | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:2419` | migrateProcessInstancesBatchOperation - uniqueItems violation filter.tags |
| negative-update | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:2450` | modifyProcessInstance - Additional prop __unexpectedField |
| negative-update | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:2472` | modifyProcessInstance - Body wrong top-level type |
| negative-update | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:2489` | modifyProcessInstance - Param operationReference wrong type (#1) |
| negative-update | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:2510` | modifyProcessInstance - Param operationReference wrong type (#2) |
| negative-update | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:2531` | modifyProcessInstance - Constraint violation operationReference (#1) |
| negative-update | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:2552` | modifyProcessInstance - Constraint violation operationReference (#2) |
| negative-update | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:2573` | modifyProcessInstance - Constraint violation operationReference (#3) |
| negative-update | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:2594` | modifyProcessInstance - Missing activateInstructions.0.elementId |
| negative-update | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:2615` | modifyProcessInstance - Missing activateInstructions.0.variableInstructions.0.variables |
| negative-update | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:2641` | modifyProcessInstance - Missing moveInstructions.0.sourceElementInstruction |
| negative-update | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:2666` | modifyProcessInstance - Missing moveInstructions.0.targetElementId |
| negative-update | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:2691` | modifyProcessInstance - Missing moveInstructions.0.variableInstructions.0.variables |
| negative-update | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:2718` | modifyProcessInstance - Missing body |
| negative-update | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:2732` | modifyProcessInstance - Path param processInstanceKey pattern violation |
| negative-update | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:2748` | modifyProcessInstancesBatchOperation - Additional prop __unexpectedField |
| negative-update | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:2777` | modifyProcessInstancesBatchOperation - Body wrong top-level type |
| negative-update | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:2794` | modifyProcessInstancesBatchOperation - Param operationReference wrong type (#1) |
| negative-update | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:2822` | modifyProcessInstancesBatchOperation - Param operationReference wrong type (#2) |
| negative-update | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:2850` | modifyProcessInstancesBatchOperation - Constraint violation filter.tags (#1) |
| negative-update | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:2878` | modifyProcessInstancesBatchOperation - Constraint violation filter.tags (#2) |
| negative-update | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:2906` | modifyProcessInstancesBatchOperation - Constraint violation operationReference (#1) |
| negative-update | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:2934` | modifyProcessInstancesBatchOperation - Constraint violation operationReference (#2) |
| negative-update | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:2962` | modifyProcessInstancesBatchOperation - Constraint violation operationReference (#3) |
| negative-update | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:2990` | modifyProcessInstancesBatchOperation - Missing filter (#1) |
| negative-update | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:3014` | modifyProcessInstancesBatchOperation - Missing filter.$or.0.variables.0.name |
| negative-update | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:3049` | modifyProcessInstancesBatchOperation - Missing filter.$or.0.variables.0.value |
| negative-update | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:3084` | modifyProcessInstancesBatchOperation - Missing filter.variables.0.name |
| negative-update | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:3115` | modifyProcessInstancesBatchOperation - Missing filter.variables.0.value |
| negative-update | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:3146` | modifyProcessInstancesBatchOperation - Missing moveInstructions (#1) |
| negative-update | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:3165` | modifyProcessInstancesBatchOperation - Missing moveInstructions.0.sourceElementId |
| negative-update | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:3189` | modifyProcessInstancesBatchOperation - Missing moveInstructions.0.targetElementId |
| negative-update | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:3213` | modifyProcessInstancesBatchOperation - Missing filter (#2) |
| negative-update | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:3232` | modifyProcessInstancesBatchOperation - Missing moveInstructions (#2) |
| negative-update | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:3251` | modifyProcessInstancesBatchOperation - Missing body |
| negative-update | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:3263` | modifyProcessInstancesBatchOperation - Missing combo filter,moveInstructions |
| negative-update | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:3280` | modifyProcessInstancesBatchOperation - uniqueItems violation filter.$or.0.tags |
| negative-update | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:3313` | modifyProcessInstancesBatchOperation - uniqueItems violation filter.tags |
| negative-update | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:3341` | resolveIncidentsBatchOperation - Additional prop __unexpectedField |
| negative-update | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:3364` | resolveIncidentsBatchOperation - Body wrong top-level type |
| negative-update | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:3381` | resolveIncidentsBatchOperation - Param operationReference wrong type (#1) |
| negative-update | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:3403` | resolveIncidentsBatchOperation - Param operationReference wrong type (#2) |
| negative-update | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:3425` | resolveIncidentsBatchOperation - Constraint violation filter.tags (#1) |
| negative-update | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:3447` | resolveIncidentsBatchOperation - Constraint violation filter.tags (#2) |
| negative-update | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:3469` | resolveIncidentsBatchOperation - Constraint violation operationReference (#1) |
| negative-update | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:3491` | resolveIncidentsBatchOperation - Constraint violation operationReference (#2) |
| negative-update | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:3513` | resolveIncidentsBatchOperation - Constraint violation operationReference (#3) |
| negative-update | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:3535` | resolveIncidentsBatchOperation - Missing filter.$or.0.variables.0.name |
| negative-update | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:3564` | resolveIncidentsBatchOperation - Missing filter.$or.0.variables.0.value |
| negative-update | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:3593` | resolveIncidentsBatchOperation - Missing filter.variables.0.name |
| negative-update | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:3618` | resolveIncidentsBatchOperation - Missing filter.variables.0.value |
| negative-update | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:3643` | resolveIncidentsBatchOperation - Missing filter |
| negative-update | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:3658` | resolveIncidentsBatchOperation - uniqueItems violation filter.$or.0.tags |
| negative-update | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:3685` | resolveIncidentsBatchOperation - uniqueItems violation filter.tags |
| negative-update | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:3707` | resolveProcessInstanceIncidents - Path param processInstanceKey pattern violation |
| negative-delete | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:18` | cancelProcessInstance - Additional prop __unexpectedField |
| negative-delete | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:40` | cancelProcessInstance - Body wrong top-level type |
| negative-delete | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:57` | cancelProcessInstance - Param operationReference wrong type (#1) |
| negative-delete | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:78` | cancelProcessInstance - Param operationReference wrong type (#2) |
| negative-delete | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:99` | cancelProcessInstance - Constraint violation operationReference (#1) |
| negative-delete | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:120` | cancelProcessInstance - Constraint violation operationReference (#2) |
| negative-delete | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:141` | cancelProcessInstance - Constraint violation operationReference (#3) |
| negative-delete | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:162` | cancelProcessInstance - Path param processInstanceKey pattern violation |
| negative-delete | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:178` | cancelProcessInstancesBatchOperation - Additional prop __unexpectedField |
| negative-delete | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:201` | cancelProcessInstancesBatchOperation - Body wrong top-level type |
| negative-delete | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:218` | cancelProcessInstancesBatchOperation - Param operationReference wrong type (#1) |
| negative-delete | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:240` | cancelProcessInstancesBatchOperation - Param operationReference wrong type (#2) |
| negative-delete | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:262` | cancelProcessInstancesBatchOperation - Constraint violation filter.tags (#1) |
| negative-delete | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:284` | cancelProcessInstancesBatchOperation - Constraint violation filter.tags (#2) |
| negative-delete | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:306` | cancelProcessInstancesBatchOperation - Constraint violation operationReference (#1) |
| negative-delete | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:328` | cancelProcessInstancesBatchOperation - Constraint violation operationReference (#2) |
| negative-delete | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:350` | cancelProcessInstancesBatchOperation - Constraint violation operationReference (#3) |
| negative-delete | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:372` | cancelProcessInstancesBatchOperation - Missing filter.$or.0.variables.0.name |
| negative-delete | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:401` | cancelProcessInstancesBatchOperation - Missing filter.$or.0.variables.0.value |
| negative-delete | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:430` | cancelProcessInstancesBatchOperation - Missing filter.variables.0.name |
| negative-delete | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:455` | cancelProcessInstancesBatchOperation - Missing filter.variables.0.value |
| negative-delete | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:480` | cancelProcessInstancesBatchOperation - Missing filter |
| negative-delete | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:495` | cancelProcessInstancesBatchOperation - Missing body |
| negative-delete | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:507` | cancelProcessInstancesBatchOperation - uniqueItems violation filter.$or.0.tags |
| negative-delete | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:534` | cancelProcessInstancesBatchOperation - uniqueItems violation filter.tags |
| negative-delete | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:652` | deleteProcessInstance - Additional prop __unexpectedField |
| negative-delete | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:674` | deleteProcessInstance - Body wrong top-level type |
| negative-delete | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:691` | deleteProcessInstance - Param operationReference wrong type (#1) |
| negative-delete | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:712` | deleteProcessInstance - Param operationReference wrong type (#2) |
| negative-delete | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:733` | deleteProcessInstance - Constraint violation operationReference (#1) |
| negative-delete | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:754` | deleteProcessInstance - Constraint violation operationReference (#2) |
| negative-delete | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:775` | deleteProcessInstance - Constraint violation operationReference (#3) |
| negative-delete | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:796` | deleteProcessInstance - Path param processInstanceKey pattern violation |
| negative-delete | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:812` | deleteProcessInstancesBatchOperation - Additional prop __unexpectedField |
| negative-delete | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:835` | deleteProcessInstancesBatchOperation - Body wrong top-level type |
| negative-delete | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:852` | deleteProcessInstancesBatchOperation - Param operationReference wrong type (#1) |
| negative-delete | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:874` | deleteProcessInstancesBatchOperation - Param operationReference wrong type (#2) |
| negative-delete | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:896` | deleteProcessInstancesBatchOperation - Constraint violation filter.tags (#1) |
| negative-delete | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:918` | deleteProcessInstancesBatchOperation - Constraint violation filter.tags (#2) |
| negative-delete | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:940` | deleteProcessInstancesBatchOperation - Constraint violation operationReference (#1) |
| negative-delete | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:962` | deleteProcessInstancesBatchOperation - Constraint violation operationReference (#2) |
| negative-delete | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:984` | deleteProcessInstancesBatchOperation - Constraint violation operationReference (#3) |
| negative-delete | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:1006` | deleteProcessInstancesBatchOperation - Missing filter.$or.0.variables.0.name |
| negative-delete | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:1035` | deleteProcessInstancesBatchOperation - Missing filter.$or.0.variables.0.value |
| negative-delete | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:1064` | deleteProcessInstancesBatchOperation - Missing filter.variables.0.name |
| negative-delete | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:1089` | deleteProcessInstancesBatchOperation - Missing filter.variables.0.value |
| negative-delete | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:1114` | deleteProcessInstancesBatchOperation - Missing filter |
| negative-delete | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:1129` | deleteProcessInstancesBatchOperation - Missing body |
| negative-delete | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:1141` | deleteProcessInstancesBatchOperation - uniqueItems violation filter.$or.0.tags |
| negative-delete | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:1168` | deleteProcessInstancesBatchOperation - uniqueItems violation filter.tags |
| negative-search | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:3723` | searchProcessInstanceIncidents - Additional prop __unexpectedField |
| negative-search | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:3744` | searchProcessInstanceIncidents - Body wrong top-level type |
| negative-search | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:3763` | searchProcessInstanceIncidents - Missing sort.0.field |
| negative-search | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:3782` | searchProcessInstanceIncidents - Enum violation sort.0.field |
| negative-search | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:3807` | searchProcessInstanceIncidents - Enum violation sort.0.order |
| negative-search | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:3832` | searchProcessInstanceIncidents - Path param processInstanceKey pattern violation |
| negative-search | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:3848` | searchProcessInstances - Additional prop __unexpectedField |
| negative-search | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:3867` | searchProcessInstances - Body wrong top-level type |
| negative-search | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:3882` | searchProcessInstances - Missing filter.$or.0.variables.0.name |
| negative-search | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:3911` | searchProcessInstances - Missing filter.$or.0.variables.0.value |
| negative-search | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:3940` | searchProcessInstances - Missing filter.variables.0.name |
| negative-search | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:3965` | searchProcessInstances - Missing filter.variables.0.value |
| negative-search | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:3990` | searchProcessInstances - Missing sort.0.field |
| negative-search | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:4007` | searchProcessInstances - Enum violation sort.0.field |
| negative-search | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:4028` | searchProcessInstances - Enum violation sort.0.order |
| negative-search | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:4049` | searchProcessInstances - uniqueItems violation filter.$or.0.tags |
| negative-search | bad-request | `request-validation/unsecured/processinstances-validation-api-tests.spec.ts:4074` | searchProcessInstances - uniqueItems violation filter.tags |
| state-transition | happy-path | `templates/StateTransitionVisibleAfterAction/ProcessInstance.cancelProcessInstance.lifecycle.spec.ts:10` | invoke cancelProcessInstance, observe state=CANCELED on read-back |

## E. Batch-Operation Lifecycle

**Form**: Create batch (via batch-creating process-instance APIs, prerequisite) → Get batch → Search batch → Search items → Suspend → Cancel

**Total tests**: 25

### `batch-operation` — 15 tests

- **Prerequisite to create**: running-process-instance(s)
- **Files**: `cancelBatchOperation.feature.spec.ts`, `getBatchOperation.feature.spec.ts`, `request-validation/unsecured/batchoperations-validation-api-tests.spec.ts`, `resumeBatchOperation.feature.spec.ts`, `searchBatchOperations.feature.spec.ts`, `searchBatchOperations.variant.spec.ts`, `suspendBatchOperation.feature.spec.ts`
- **Observation channel**: GET = 1, Search = 3
- **Form-step counts**: observe-present-get=1, observe-present-search=3, mutate=2, delete=1, observe-absence=1, negative-get=1, negative-search=6
- **Variants**: happy-path=5, observe-absence=1, data-driven=2, bad-request=6, not-found=1, pagination-sort=2, filter=4

| form step | variants | file:line | test name |
|--|--|--|--|
| observe-present-get | happy-path, filter | `getBatchOperation.feature.spec.ts:12` | feature-1 - getBatchOperation - base (1) |
| observe-present-search | happy-path | `searchBatchOperations.feature.spec.ts:12` | feature-1 - searchBatchOperations - base (1) |
| observe-present-search | data-driven, pagination-sort | `searchBatchOperations.variant.spec.ts:12` | variant-1 - searchBatchOperations - path #1 |
| observe-present-search | data-driven, pagination-sort | `searchBatchOperations.variant.spec.ts:64` | variant-2 - searchBatchOperations - path #1 |
| mutate | happy-path, filter | `resumeBatchOperation.feature.spec.ts:8` | feature-1 - resumeBatchOperation - base (1) |
| mutate | happy-path, filter | `suspendBatchOperation.feature.spec.ts:8` | feature-1 - suspendBatchOperation - base (1) |
| delete | happy-path, filter | `cancelBatchOperation.feature.spec.ts:8` | feature-1 - cancelBatchOperation - base (1) |
| observe-absence | observe-absence | `searchBatchOperations.feature.spec.ts:36` | feature-2 - searchBatchOperations - negative empty (2) |
| negative-get | not-found | `request-validation/unsecured/batchoperations-validation-api-tests.spec.ts:18` | getBatchOperation - Nonexistent batchOperationKey returns 404 |
| negative-search | bad-request | `request-validation/unsecured/batchoperations-validation-api-tests.spec.ts:34` | searchBatchOperations - Additional prop __unexpectedField |
| negative-search | bad-request | `request-validation/unsecured/batchoperations-validation-api-tests.spec.ts:53` | searchBatchOperations - Body wrong top-level type |
| negative-search | bad-request | `request-validation/unsecured/batchoperations-validation-api-tests.spec.ts:68` | searchBatchOperations - Missing sort.0.field |
| negative-search | bad-request | `request-validation/unsecured/batchoperations-validation-api-tests.spec.ts:85` | searchBatchOperations - Enum violation filter.actorType |
| negative-search | bad-request | `request-validation/unsecured/batchoperations-validation-api-tests.spec.ts:104` | searchBatchOperations - Enum violation sort.0.field |
| negative-search | bad-request | `request-validation/unsecured/batchoperations-validation-api-tests.spec.ts:125` | searchBatchOperations - Enum violation sort.0.order |

### `batch-operation-item` — 10 tests

- **Prerequisite to create**: running-batch-operation
- **Files**: `request-validation/unsecured/batchoperationitems-validation-api-tests.spec.ts`, `searchBatchOperationItems.feature.spec.ts`, `searchBatchOperationItems.variant.spec.ts`
- **Observation channel**: GET = 0, Search = 4
- **Form-step counts**: observe-present-search=4, observe-absence=1, negative-search=5
- **Variants**: happy-path=1, observe-absence=1, data-driven=3, bad-request=5, pagination-sort=2, filter=1

| form step | variants | file:line | test name |
|--|--|--|--|
| observe-present-search | happy-path | `searchBatchOperationItems.feature.spec.ts:12` | feature-1 - searchBatchOperationItems - base (1) |
| observe-present-search | data-driven, filter | `searchBatchOperationItems.variant.spec.ts:13` | variant-1 - searchBatchOperationItems - bpmn #1 |
| observe-present-search | data-driven, pagination-sort | `searchBatchOperationItems.variant.spec.ts:80` | variant-2 - searchBatchOperationItems - path #1 |
| observe-present-search | data-driven, pagination-sort | `searchBatchOperationItems.variant.spec.ts:132` | variant-3 - searchBatchOperationItems - path #1 |
| observe-absence | observe-absence | `searchBatchOperationItems.feature.spec.ts:36` | feature-2 - searchBatchOperationItems - negative empty (2) |
| negative-search | bad-request | `request-validation/unsecured/batchoperationitems-validation-api-tests.spec.ts:18` | searchBatchOperationItems - Additional prop __unexpectedField |
| negative-search | bad-request | `request-validation/unsecured/batchoperationitems-validation-api-tests.spec.ts:37` | searchBatchOperationItems - Body wrong top-level type |
| negative-search | bad-request | `request-validation/unsecured/batchoperationitems-validation-api-tests.spec.ts:52` | searchBatchOperationItems - Missing sort.0.field |
| negative-search | bad-request | `request-validation/unsecured/batchoperationitems-validation-api-tests.spec.ts:69` | searchBatchOperationItems - Enum violation sort.0.field |
| negative-search | bad-request | `request-validation/unsecured/batchoperationitems-validation-api-tests.spec.ts:90` | searchBatchOperationItems - Enum violation sort.0.order |

## F. User-Task Lifecycle

**Form**: Deploy process w/ user task (prerequisite) → Create instance → Assign → Update → Search/Get → Get form → Search variables → Complete → Unassign

**Total tests**: 71

### `user-task` — 71 tests

- **Prerequisite to create**: running-process-instance-with-user-task
- **Files**: `assignUserTask.feature.spec.ts`, `getFormByKey.feature.spec.ts`, `getUserTaskForm.feature.spec.ts`, `request-validation/unsecured/forms-validation-api-tests.spec.ts`, `request-validation/unsecured/usertasks-validation-api-tests.spec.ts`, `searchUserTaskAuditLogs.feature.spec.ts`, `searchUserTaskAuditLogs.variant.spec.ts`, `searchUserTaskEffectiveVariables.feature.spec.ts`, `searchUserTaskVariables.feature.spec.ts`, `searchUserTaskVariables.variant.spec.ts`, `searchUserTasks.feature.spec.ts`, `searchUserTasks.variant.spec.ts`, `templates/StateTransitionVisibleAfterAction/UserTask.completeUserTask.lifecycle.spec.ts`, `templates/UpdatedFieldVisibleOnReadBack/UserTask.updateUserTask.lifecycle.spec.ts`, `unassignUserTask.feature.spec.ts`
- **Observation channel**: GET = 2, Search = 17
- **Form-step counts**: observe-present-get=2, observe-present-search=17, mutate=1, delete=1, observe-absence=1, negative-get=6, negative-update=10, negative-delete=1, negative-search=30
- **Variants**: happy-path=10, observe-absence=1, data-driven=13, bad-request=44, not-found=3, pagination-sort=6, filter=17

| form step | variants | file:line | test name |
|--|--|--|--|
| observe-present-get | happy-path | `getFormByKey.feature.spec.ts:13` | feature-1 - getFormByKey - base (1) |
| observe-present-get | happy-path, filter | `getUserTaskForm.feature.spec.ts:13` | feature-1 - getUserTaskForm - base (1) |
| observe-present-search | happy-path, filter | `searchUserTaskAuditLogs.feature.spec.ts:13` | feature-1 - searchUserTaskAuditLogs - base (1) |
| observe-present-search | data-driven, pagination-sort, filter | `searchUserTaskAuditLogs.variant.spec.ts:13` | variant-1 - searchUserTaskAuditLogs - bpmn #1 |
| observe-present-search | data-driven, pagination-sort, filter | `searchUserTaskAuditLogs.variant.spec.ts:110` | variant-2 - searchUserTaskAuditLogs - bpmn #1 |
| observe-present-search | happy-path, filter | `searchUserTaskEffectiveVariables.feature.spec.ts:13` | feature-1 - searchUserTaskEffectiveVariables - base (1) |
| observe-present-search | happy-path, filter | `searchUserTaskVariables.feature.spec.ts:13` | feature-1 - searchUserTaskVariables - base (1) |
| observe-present-search | data-driven, pagination-sort, filter | `searchUserTaskVariables.variant.spec.ts:13` | variant-1 - searchUserTaskVariables - bpmn #1 |
| observe-present-search | data-driven, pagination-sort, filter | `searchUserTaskVariables.variant.spec.ts:110` | variant-2 - searchUserTaskVariables - bpmn #1 |
| observe-present-search | happy-path | `searchUserTasks.feature.spec.ts:12` | feature-1 - searchUserTasks - base (1) |
| observe-present-search | data-driven, filter | `searchUserTasks.variant.spec.ts:13` | variant-1 - searchUserTasks - bpmn #1 |
| observe-present-search | data-driven, filter | `searchUserTasks.variant.spec.ts:109` | variant-2 - searchUserTasks - bpmn #1 |
| observe-present-search | data-driven, filter | `searchUserTasks.variant.spec.ts:154` | variant-3 - searchUserTasks - path #1 |
| observe-present-search | data-driven, filter | `searchUserTasks.variant.spec.ts:214` | variant-4 - searchUserTasks - bpmn #1 |
| observe-present-search | data-driven, filter | `searchUserTasks.variant.spec.ts:259` | variant-5 - searchUserTasks - bpmn #1 |
| observe-present-search | data-driven, filter | `searchUserTasks.variant.spec.ts:324` | variant-6 - searchUserTasks - bpmn #1 |
| observe-present-search | data-driven, filter | `searchUserTasks.variant.spec.ts:420` | variant-7 - searchUserTasks - bpmn #1 |
| observe-present-search | data-driven, pagination-sort | `searchUserTasks.variant.spec.ts:509` | variant-8 - searchUserTasks - path #1 |
| observe-present-search | data-driven, pagination-sort | `searchUserTasks.variant.spec.ts:559` | variant-9 - searchUserTasks - path #1 |
| mutate | happy-path, filter | `assignUserTask.feature.spec.ts:10` | feature-1 - assignUserTask - base (1) |
| delete | happy-path, filter | `unassignUserTask.feature.spec.ts:10` | feature-1 - unassignUserTask - base (1) |
| observe-absence | observe-absence | `searchUserTasks.feature.spec.ts:34` | feature-2 - searchUserTasks - negative empty (2) |
| negative-get | not-found | `request-validation/unsecured/forms-validation-api-tests.spec.ts:18` | getFormByKey - Nonexistent formKey returns 404 |
| negative-get | bad-request | `request-validation/unsecured/forms-validation-api-tests.spec.ts:30` | getFormByKey - Path param formKey pattern violation |
| negative-get | not-found | `request-validation/unsecured/usertasks-validation-api-tests.spec.ts:136` | getUserTask - Nonexistent userTaskKey returns 404 |
| negative-get | bad-request | `request-validation/unsecured/usertasks-validation-api-tests.spec.ts:150` | getUserTask - Path param userTaskKey pattern violation |
| negative-get | not-found | `request-validation/unsecured/usertasks-validation-api-tests.spec.ts:162` | getUserTaskForm - Nonexistent userTaskKey returns 404 |
| negative-get | bad-request | `request-validation/unsecured/usertasks-validation-api-tests.spec.ts:176` | getUserTaskForm - Path param userTaskKey pattern violation |
| negative-update | bad-request | `request-validation/unsecured/usertasks-validation-api-tests.spec.ts:18` | assignUserTask - Additional prop __unexpectedField |
| negative-update | bad-request | `request-validation/unsecured/usertasks-validation-api-tests.spec.ts:37` | assignUserTask - Body wrong top-level type |
| negative-update | bad-request | `request-validation/unsecured/usertasks-validation-api-tests.spec.ts:54` | assignUserTask - Missing body |
| negative-update | bad-request | `request-validation/unsecured/usertasks-validation-api-tests.spec.ts:68` | assignUserTask - Path param userTaskKey pattern violation |
| negative-update | bad-request | `request-validation/unsecured/usertasks-validation-api-tests.spec.ts:84` | completeUserTask - Additional prop __unexpectedField |
| negative-update | bad-request | `request-validation/unsecured/usertasks-validation-api-tests.spec.ts:103` | completeUserTask - Body wrong top-level type |
| negative-update | bad-request | `request-validation/unsecured/usertasks-validation-api-tests.spec.ts:120` | completeUserTask - Path param userTaskKey pattern violation |
| negative-update | bad-request | `request-validation/unsecured/usertasks-validation-api-tests.spec.ts:807` | updateUserTask - Additional prop __unexpectedField |
| negative-update | bad-request | `request-validation/unsecured/usertasks-validation-api-tests.spec.ts:824` | updateUserTask - Body wrong top-level type |
| negative-update | bad-request | `request-validation/unsecured/usertasks-validation-api-tests.spec.ts:839` | updateUserTask - Path param userTaskKey pattern violation |
| negative-delete | bad-request | `request-validation/unsecured/usertasks-validation-api-tests.spec.ts:791` | unassignUserTask - Path param userTaskKey pattern violation |
| negative-search | bad-request | `request-validation/unsecured/usertasks-validation-api-tests.spec.ts:190` | searchUserTaskAuditLogs - Additional prop __unexpectedField |
| negative-search | bad-request | `request-validation/unsecured/usertasks-validation-api-tests.spec.ts:211` | searchUserTaskAuditLogs - Body wrong top-level type |
| negative-search | bad-request | `request-validation/unsecured/usertasks-validation-api-tests.spec.ts:228` | searchUserTaskAuditLogs - Missing sort.0.field |
| negative-search | bad-request | `request-validation/unsecured/usertasks-validation-api-tests.spec.ts:247` | searchUserTaskAuditLogs - Enum violation sort.0.field |
| negative-search | bad-request | `request-validation/unsecured/usertasks-validation-api-tests.spec.ts:270` | searchUserTaskAuditLogs - Enum violation sort.0.order |
| negative-search | bad-request | `request-validation/unsecured/usertasks-validation-api-tests.spec.ts:293` | searchUserTaskAuditLogs - Path param userTaskKey pattern violation |
| negative-search | bad-request | `request-validation/unsecured/usertasks-validation-api-tests.spec.ts:309` | searchUserTaskEffectiveVariables - Additional prop __unexpectedField |
| negative-search | bad-request | `request-validation/unsecured/usertasks-validation-api-tests.spec.ts:330` | searchUserTaskEffectiveVariables - Body wrong top-level type |
| negative-search | bad-request | `request-validation/unsecured/usertasks-validation-api-tests.spec.ts:349` | searchUserTaskEffectiveVariables - Missing sort.0.field |
| negative-search | bad-request | `request-validation/unsecured/usertasks-validation-api-tests.spec.ts:368` | searchUserTaskEffectiveVariables - Enum violation sort.0.field |
| negative-search | bad-request | `request-validation/unsecured/usertasks-validation-api-tests.spec.ts:393` | searchUserTaskEffectiveVariables - Enum violation sort.0.order |
| negative-search | bad-request | `request-validation/unsecured/usertasks-validation-api-tests.spec.ts:418` | searchUserTaskEffectiveVariables - Path param userTaskKey pattern violation |
| negative-search | bad-request | `request-validation/unsecured/usertasks-validation-api-tests.spec.ts:434` | searchUserTaskEffectiveVariables - Param query.truncateValues wrong type |
| negative-search | bad-request | `request-validation/unsecured/usertasks-validation-api-tests.spec.ts:450` | searchUserTasks - Additional prop __unexpectedField |
| negative-search | bad-request | `request-validation/unsecured/usertasks-validation-api-tests.spec.ts:467` | searchUserTasks - Body wrong top-level type |
| negative-search | bad-request | `request-validation/unsecured/usertasks-validation-api-tests.spec.ts:482` | searchUserTasks - Missing filter.localVariables.0.name |
| negative-search | bad-request | `request-validation/unsecured/usertasks-validation-api-tests.spec.ts:505` | searchUserTasks - Missing filter.localVariables.0.value |
| negative-search | bad-request | `request-validation/unsecured/usertasks-validation-api-tests.spec.ts:528` | searchUserTasks - Missing filter.processInstanceVariables.0.name |
| negative-search | bad-request | `request-validation/unsecured/usertasks-validation-api-tests.spec.ts:553` | searchUserTasks - Missing filter.processInstanceVariables.0.value |
| negative-search | bad-request | `request-validation/unsecured/usertasks-validation-api-tests.spec.ts:578` | searchUserTasks - Missing sort.0.field |
| negative-search | bad-request | `request-validation/unsecured/usertasks-validation-api-tests.spec.ts:595` | searchUserTasks - Enum violation sort.0.field |
| negative-search | bad-request | `request-validation/unsecured/usertasks-validation-api-tests.spec.ts:616` | searchUserTasks - Enum violation sort.0.order |
| negative-search | bad-request | `request-validation/unsecured/usertasks-validation-api-tests.spec.ts:637` | searchUserTasks - uniqueItems violation filter.tags |
| negative-search | bad-request | `request-validation/unsecured/usertasks-validation-api-tests.spec.ts:656` | searchUserTaskVariables - Additional prop __unexpectedField |
| negative-search | bad-request | `request-validation/unsecured/usertasks-validation-api-tests.spec.ts:677` | searchUserTaskVariables - Body wrong top-level type |
| negative-search | bad-request | `request-validation/unsecured/usertasks-validation-api-tests.spec.ts:694` | searchUserTaskVariables - Missing sort.0.field |
| negative-search | bad-request | `request-validation/unsecured/usertasks-validation-api-tests.spec.ts:713` | searchUserTaskVariables - Enum violation sort.0.field |
| negative-search | bad-request | `request-validation/unsecured/usertasks-validation-api-tests.spec.ts:736` | searchUserTaskVariables - Enum violation sort.0.order |
| negative-search | bad-request | `request-validation/unsecured/usertasks-validation-api-tests.spec.ts:759` | searchUserTaskVariables - Path param userTaskKey pattern violation |
| negative-search | bad-request | `request-validation/unsecured/usertasks-validation-api-tests.spec.ts:775` | searchUserTaskVariables - Param query.truncateValues wrong type |
| state-transition | happy-path | `templates/StateTransitionVisibleAfterAction/UserTask.completeUserTask.lifecycle.spec.ts:10` | invoke completeUserTask, observe state=COMPLETED on read-back |
| read-back | happy-path | `templates/UpdatedFieldVisibleOnReadBack/UserTask.updateUserTask.lifecycle.spec.ts:10` | mutate UserTask.updateUserTask, observe field on read-back |

## G. Job Lifecycle & Stats

**Form**: Deploy process w/ job (prerequisite) → Activate → Complete / Fail / Error / Update → Search jobs → Aggregate (5 statistics endpoints)

**Total tests**: 142

### `job` — 142 tests

- **Prerequisite to create**: running-process-instance-with-job
- **Files**: `activateJobs.feature.spec.ts`, `activateJobs.variant.spec.ts`, `completeJob.feature.spec.ts`, `completeJob.variant.spec.ts`, `failJob.feature.spec.ts`, `getGlobalJobStatistics.feature.spec.ts`, `getJobErrorStatistics.feature.spec.ts`, `getJobErrorStatistics.variant.spec.ts`, `getJobTimeSeriesStatistics.feature.spec.ts`, `getJobTimeSeriesStatistics.variant.spec.ts`, `getJobTypeStatistics.feature.spec.ts`, `getJobTypeStatistics.variant.spec.ts`, `getJobWorkerStatistics.feature.spec.ts`, `getJobWorkerStatistics.variant.spec.ts`, `request-validation/unsecured/jobs-validation-api-tests.spec.ts`, `searchJobs.feature.spec.ts`, `searchJobs.variant.spec.ts`, `throwJobError.feature.spec.ts`, `updateJob.feature.spec.ts`
- **Observation channel**: GET = 9, Search = 7
- **Form-step counts**: create=3, observe-present-get=9, observe-present-search=7, mutate=6, observe-absence=2, negative-create=28, negative-get=58, negative-update=24, negative-search=5
- **Variants**: happy-path=11, observe-absence=2, data-driven=14, bad-request=115, pagination-sort=6, filter=10

| form step | variants | file:line | test name |
|--|--|--|--|
| create | happy-path | `activateJobs.feature.spec.ts:12` | feature-1 - activateJobs - base (1) |
| create | data-driven | `activateJobs.variant.spec.ts:12` | variant-1 - activateJobs - path #1 |
| create | happy-path | `throwJobError.feature.spec.ts:9` | feature-1 - throwJobError - base (1) |
| observe-present-get | happy-path | `getGlobalJobStatistics.feature.spec.ts:12` | feature-1 - getGlobalJobStatistics - base (1) |
| observe-present-get | happy-path, filter | `getJobErrorStatistics.feature.spec.ts:11` | feature-1 - getJobErrorStatistics - base (1) |
| observe-present-get | data-driven, pagination-sort, filter | `getJobErrorStatistics.variant.spec.ts:12` | variant-1 - getJobErrorStatistics - path #1 |
| observe-present-get | happy-path, filter | `getJobTimeSeriesStatistics.feature.spec.ts:11` | feature-1 - getJobTimeSeriesStatistics - base (1) |
| observe-present-get | data-driven, pagination-sort, filter | `getJobTimeSeriesStatistics.variant.spec.ts:12` | variant-1 - getJobTimeSeriesStatistics - path #1 |
| observe-present-get | happy-path | `getJobTypeStatistics.feature.spec.ts:11` | feature-1 - getJobTypeStatistics - base (1) |
| observe-present-get | data-driven, pagination-sort | `getJobTypeStatistics.variant.spec.ts:12` | variant-1 - getJobTypeStatistics - path #1 |
| observe-present-get | happy-path, filter | `getJobWorkerStatistics.feature.spec.ts:11` | feature-1 - getJobWorkerStatistics - base (1) |
| observe-present-get | data-driven, pagination-sort, filter | `getJobWorkerStatistics.variant.spec.ts:12` | variant-1 - getJobWorkerStatistics - path #1 |
| observe-present-search | happy-path | `searchJobs.feature.spec.ts:13` | feature-1 - searchJobs - base (1) |
| observe-present-search | data-driven, filter | `searchJobs.variant.spec.ts:13` | variant-1 - searchJobs - bpmn #1 |
| observe-present-search | data-driven, filter | `searchJobs.variant.spec.ts:109` | variant-2 - searchJobs - bpmn #1 |
| observe-present-search | data-driven, filter | `searchJobs.variant.spec.ts:205` | variant-3 - searchJobs - path #1 |
| observe-present-search | data-driven, filter | `searchJobs.variant.spec.ts:274` | variant-4 - searchJobs - bpmn #1 |
| observe-present-search | data-driven, pagination-sort | `searchJobs.variant.spec.ts:341` | variant-5 - searchJobs - path #1 |
| observe-present-search | data-driven, pagination-sort | `searchJobs.variant.spec.ts:432` | variant-6 - searchJobs - path #1 |
| mutate | happy-path | `completeJob.feature.spec.ts:9` | feature-1 - completeJob - base (1) |
| mutate | data-driven | `completeJob.feature.spec.ts:91` | feature-2 - completeJob - oneOf result variant1 (2) |
| mutate | data-driven | `completeJob.feature.spec.ts:174` | feature-3 - completeJob - oneOf result variant2 (3) |
| mutate | data-driven | `completeJob.variant.spec.ts:9` | variant-1 - completeJob - bpmn #1 |
| mutate | happy-path | `failJob.feature.spec.ts:9` | feature-1 - failJob - base (1) |
| mutate | happy-path | `updateJob.feature.spec.ts:9` | feature-1 - updateJob - base (1) |
| observe-absence | observe-absence | `activateJobs.feature.spec.ts:76` | feature-2 - activateJobs - negative empty (2) |
| observe-absence | observe-absence | `searchJobs.feature.spec.ts:74` | feature-2 - searchJobs - negative empty (2) |
| negative-create | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:18` | activateJobs - Additional prop __unexpectedField |
| negative-create | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:40` | activateJobs - Body wrong top-level type |
| negative-create | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:55` | activateJobs - Param maxJobsToActivate wrong type (#1) |
| negative-create | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:76` | activateJobs - Param maxJobsToActivate wrong type (#2) |
| negative-create | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:97` | activateJobs - Param requestTimeout wrong type (#1) |
| negative-create | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:118` | activateJobs - Param requestTimeout wrong type (#2) |
| negative-create | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:139` | activateJobs - Param tenantFilter wrong type (#1) |
| negative-create | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:160` | activateJobs - Param tenantFilter wrong type (#2) |
| negative-create | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:181` | activateJobs - Param timeout wrong type (#1) |
| negative-create | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:202` | activateJobs - Param timeout wrong type (#2) |
| negative-create | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:223` | activateJobs - Param type wrong type (#1) |
| negative-create | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:244` | activateJobs - Param type wrong type (#2) |
| negative-create | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:265` | activateJobs - Enum violation tenantFilter |
| negative-create | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:286` | activateJobs - Missing maxJobsToActivate |
| negative-create | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:304` | activateJobs - Missing timeout |
| negative-create | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:322` | activateJobs - Missing type |
| negative-create | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:340` | activateJobs - Missing body |
| negative-create | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:352` | activateJobs - Missing combo maxJobsToActivate,timeout |
| negative-create | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:369` | activateJobs - Missing combo type,maxJobsToActivate |
| negative-create | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:386` | activateJobs - Missing combo type,maxJobsToActivate,timeout |
| negative-create | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:403` | activateJobs - Missing combo type,timeout |
| negative-create | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:1810` | throwJobError - Additional prop __unexpectedField |
| negative-create | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:1828` | throwJobError - Body wrong top-level type |
| negative-create | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:1843` | throwJobError - Param errorCode wrong type (#1) |
| negative-create | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:1860` | throwJobError - Param errorCode wrong type (#2) |
| negative-create | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:1877` | throwJobError - Missing errorCode |
| negative-create | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:1892` | throwJobError - Missing body |
| negative-create | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:1904` | throwJobError - Path param jobKey pattern violation |
| negative-get | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:582` | getGlobalJobStatistics - Missing param query.from |
| negative-get | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:597` | getGlobalJobStatistics - Missing param query.to |
| negative-get | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:612` | getGlobalJobStatistics - Param query.from wrong type |
| negative-get | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:628` | getGlobalJobStatistics - Param query.to wrong type |
| negative-get | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:644` | getJobErrorStatistics - Additional prop __extraField |
| negative-get | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:666` | getJobErrorStatistics - Body wrong top-level type |
| negative-get | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:681` | getJobErrorStatistics - Param filter.from wrong type (#1) |
| negative-get | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:704` | getJobErrorStatistics - Param filter.from wrong type (#2) |
| negative-get | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:727` | getJobErrorStatistics - Param filter.jobType wrong type (#1) |
| negative-get | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:750` | getJobErrorStatistics - Param filter.jobType wrong type (#2) |
| negative-get | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:773` | getJobErrorStatistics - Param filter.to wrong type (#1) |
| negative-get | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:794` | getJobErrorStatistics - Param filter.to wrong type (#2) |
| negative-get | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:815` | getJobErrorStatistics - Missing filter.from |
| negative-get | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:835` | getJobErrorStatistics - Missing filter.jobType |
| negative-get | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:855` | getJobErrorStatistics - Missing filter.to |
| negative-get | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:875` | getJobErrorStatistics - Missing page.after |
| negative-get | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:897` | getJobErrorStatistics - format invalid filter.from |
| negative-get | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:918` | getJobErrorStatistics - format invalid filter.to |
| negative-get | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:939` | getJobErrorStatistics - Missing filter |
| negative-get | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:954` | getJobErrorStatistics - Missing body |
| negative-get | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:966` | getJobTimeSeriesStatistics - Additional prop __extraField |
| negative-get | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:990` | getJobTimeSeriesStatistics - Body wrong top-level type |
| negative-get | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:1005` | getJobTimeSeriesStatistics - Param filter.from wrong type (#1) |
| negative-get | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:1028` | getJobTimeSeriesStatistics - Param filter.from wrong type (#2) |
| negative-get | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:1051` | getJobTimeSeriesStatistics - Param filter.jobType wrong type (#1) |
| negative-get | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:1074` | getJobTimeSeriesStatistics - Param filter.jobType wrong type (#2) |
| negative-get | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:1097` | getJobTimeSeriesStatistics - Param filter.to wrong type (#1) |
| negative-get | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:1120` | getJobTimeSeriesStatistics - Param filter.to wrong type (#2) |
| negative-get | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:1143` | getJobTimeSeriesStatistics - Missing filter.from |
| negative-get | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:1163` | getJobTimeSeriesStatistics - Missing filter.jobType |
| negative-get | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:1183` | getJobTimeSeriesStatistics - Missing filter.to |
| negative-get | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:1203` | getJobTimeSeriesStatistics - Missing page.after |
| negative-get | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:1225` | getJobTimeSeriesStatistics - format invalid filter.from |
| negative-get | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:1246` | getJobTimeSeriesStatistics - format invalid filter.to |
| negative-get | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:1267` | getJobTimeSeriesStatistics - Missing filter |
| negative-get | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:1282` | getJobTimeSeriesStatistics - Missing body |
| negative-get | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:1294` | getJobTypeStatistics - Additional prop __extraField |
| negative-get | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:1311` | getJobTypeStatistics - Body wrong top-level type |
| negative-get | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:1326` | getJobTypeStatistics - Missing filter.from |
| negative-get | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:1345` | getJobTypeStatistics - Missing filter.to |
| negative-get | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:1364` | getJobTypeStatistics - Missing page.after |
| negative-get | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:1381` | getJobTypeStatistics - Missing body |
| negative-get | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:1393` | getJobWorkerStatistics - Additional prop __extraField |
| negative-get | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:1415` | getJobWorkerStatistics - Body wrong top-level type |
| negative-get | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:1430` | getJobWorkerStatistics - Param filter.from wrong type (#1) |
| negative-get | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:1453` | getJobWorkerStatistics - Param filter.from wrong type (#2) |
| negative-get | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:1476` | getJobWorkerStatistics - Param filter.jobType wrong type (#1) |
| negative-get | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:1499` | getJobWorkerStatistics - Param filter.jobType wrong type (#2) |
| negative-get | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:1522` | getJobWorkerStatistics - Param filter.to wrong type (#1) |
| negative-get | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:1545` | getJobWorkerStatistics - Param filter.to wrong type (#2) |
| negative-get | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:1568` | getJobWorkerStatistics - Missing filter.from |
| negative-get | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:1588` | getJobWorkerStatistics - Missing filter.jobType |
| negative-get | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:1608` | getJobWorkerStatistics - Missing filter.to |
| negative-get | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:1628` | getJobWorkerStatistics - Missing page.after |
| negative-get | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:1650` | getJobWorkerStatistics - format invalid filter.from |
| negative-get | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:1671` | getJobWorkerStatistics - format invalid filter.to |
| negative-get | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:1692` | getJobWorkerStatistics - Missing filter |
| negative-get | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:1707` | getJobWorkerStatistics - Missing body |
| negative-update | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:420` | completeJob - Additional prop __unexpectedField |
| negative-update | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:437` | completeJob - Body wrong top-level type |
| negative-update | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:452` | completeJob - Path param jobKey pattern violation |
| negative-update | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:464` | failJob - Additional prop __unexpectedField |
| negative-update | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:483` | failJob - Body wrong top-level type |
| negative-update | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:498` | failJob - Param retries wrong type (#1) |
| negative-update | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:516` | failJob - Param retries wrong type (#2) |
| negative-update | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:534` | failJob - Param retryBackOff wrong type (#1) |
| negative-update | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:552` | failJob - Param retryBackOff wrong type (#2) |
| negative-update | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:570` | failJob - Path param jobKey pattern violation |
| negative-update | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:1916` | updateJob - Additional prop __unexpectedField |
| negative-update | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:1938` | updateJob - Body wrong top-level type |
| negative-update | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:1953` | updateJob - Param changeset.retries wrong type (#1) |
| negative-update | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:1974` | updateJob - Param changeset.retries wrong type (#2) |
| negative-update | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:1995` | updateJob - Param changeset.timeout wrong type (#1) |
| negative-update | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:2016` | updateJob - Param changeset.timeout wrong type (#2) |
| negative-update | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:2037` | updateJob - Param operationReference wrong type (#1) |
| negative-update | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:2058` | updateJob - Param operationReference wrong type (#2) |
| negative-update | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:2079` | updateJob - Constraint violation operationReference (#1) |
| negative-update | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:2102` | updateJob - Constraint violation operationReference (#2) |
| negative-update | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:2125` | updateJob - Constraint violation operationReference (#3) |
| negative-update | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:2148` | updateJob - Missing changeset |
| negative-update | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:2163` | updateJob - Missing body |
| negative-update | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:2175` | updateJob - Path param jobKey pattern violation |
| negative-search | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:1719` | searchJobs - Additional prop __unexpectedField |
| negative-search | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:1736` | searchJobs - Body wrong top-level type |
| negative-search | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:1751` | searchJobs - Missing sort.0.field |
| negative-search | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:1768` | searchJobs - Enum violation sort.0.field |
| negative-search | bad-request | `request-validation/unsecured/jobs-validation-api-tests.spec.ts:1789` | searchJobs - Enum violation sort.0.order |

## H. Incident Lifecycle

**Form**: Deploy process + failing job (prerequisite) → Incident raised → Get incident → Search → Resolve → Statistics (by definition / by error)

**Total tests**: 41

### `incident` — 41 tests

- **Prerequisite to create**: running-process-instance-with-failing-job
- **Files**: `getProcessInstanceStatisticsByDefinition.feature.spec.ts`, `getProcessInstanceStatisticsByError.feature.spec.ts`, `request-validation/unsecured/incidents-validation-api-tests.spec.ts`, `searchIncidents.feature.spec.ts`, `searchIncidents.variant.spec.ts`, `templates/StateTransitionVisibleAfterAction/Incident.resolveIncident.lifecycle.spec.ts`
- **Observation channel**: GET = 2, Search = 7
- **Form-step counts**: observe-present-get=2, observe-present-search=7, observe-absence=1, negative-get=17, negative-update=8, negative-search=5
- **Variants**: happy-path=4, observe-absence=1, data-driven=6, bad-request=29, not-found=1, pagination-sort=2, filter=5

| form step | variants | file:line | test name |
|--|--|--|--|
| observe-present-get | happy-path, filter | `getProcessInstanceStatisticsByDefinition.feature.spec.ts:11` | feature-1 - getProcessInstanceStatisticsByDefinition - base (1) |
| observe-present-get | happy-path | `getProcessInstanceStatisticsByError.feature.spec.ts:11` | feature-1 - getProcessInstanceStatisticsByError - base (1) |
| observe-present-search | happy-path | `searchIncidents.feature.spec.ts:12` | feature-1 - searchIncidents - base (1) |
| observe-present-search | data-driven, filter | `searchIncidents.variant.spec.ts:13` | variant-1 - searchIncidents - bpmn #1 |
| observe-present-search | data-driven, filter | `searchIncidents.variant.spec.ts:58` | variant-2 - searchIncidents - bpmn #1 |
| observe-present-search | data-driven, filter | `searchIncidents.variant.spec.ts:123` | variant-3 - searchIncidents - bpmn #1 |
| observe-present-search | data-driven, filter | `searchIncidents.variant.spec.ts:219` | variant-4 - searchIncidents - bpmn #1 |
| observe-present-search | data-driven, pagination-sort | `searchIncidents.variant.spec.ts:315` | variant-5 - searchIncidents - path #1 |
| observe-present-search | data-driven, pagination-sort | `searchIncidents.variant.spec.ts:365` | variant-6 - searchIncidents - path #1 |
| observe-absence | observe-absence | `searchIncidents.feature.spec.ts:34` | feature-2 - searchIncidents - negative empty (2) |
| negative-get | not-found | `request-validation/unsecured/incidents-validation-api-tests.spec.ts:18` | getIncident - Nonexistent incidentKey returns 404 |
| negative-get | bad-request | `request-validation/unsecured/incidents-validation-api-tests.spec.ts:32` | getIncident - Path param incidentKey pattern violation |
| negative-get | bad-request | `request-validation/unsecured/incidents-validation-api-tests.spec.ts:44` | getProcessInstanceStatisticsByDefinition - Additional prop __extraField |
| negative-get | bad-request | `request-validation/unsecured/incidents-validation-api-tests.spec.ts:66` | getProcessInstanceStatisticsByDefinition - Body wrong top-level type |
| negative-get | bad-request | `request-validation/unsecured/incidents-validation-api-tests.spec.ts:83` | getProcessInstanceStatisticsByDefinition - Param filter.errorHashCode wrong type (#1) |
| negative-get | bad-request | `request-validation/unsecured/incidents-validation-api-tests.spec.ts:104` | getProcessInstanceStatisticsByDefinition - Param filter.errorHashCode wrong type (#2) |
| negative-get | bad-request | `request-validation/unsecured/incidents-validation-api-tests.spec.ts:125` | getProcessInstanceStatisticsByDefinition - Missing filter.errorHashCode |
| negative-get | bad-request | `request-validation/unsecured/incidents-validation-api-tests.spec.ts:144` | getProcessInstanceStatisticsByDefinition - Missing sort.0.field |
| negative-get | bad-request | `request-validation/unsecured/incidents-validation-api-tests.spec.ts:166` | getProcessInstanceStatisticsByDefinition - Enum violation sort.0.field |
| negative-get | bad-request | `request-validation/unsecured/incidents-validation-api-tests.spec.ts:192` | getProcessInstanceStatisticsByDefinition - Enum violation sort.0.order |
| negative-get | bad-request | `request-validation/unsecured/incidents-validation-api-tests.spec.ts:218` | getProcessInstanceStatisticsByDefinition - Missing filter |
| negative-get | bad-request | `request-validation/unsecured/incidents-validation-api-tests.spec.ts:235` | getProcessInstanceStatisticsByDefinition - Missing body |
| negative-get | bad-request | `request-validation/unsecured/incidents-validation-api-tests.spec.ts:247` | getProcessInstanceStatisticsByError - Additional prop __unexpectedField |
| negative-get | bad-request | `request-validation/unsecured/incidents-validation-api-tests.spec.ts:266` | getProcessInstanceStatisticsByError - Body wrong top-level type |
| negative-get | bad-request | `request-validation/unsecured/incidents-validation-api-tests.spec.ts:283` | getProcessInstanceStatisticsByError - Missing sort.0.field |
| negative-get | bad-request | `request-validation/unsecured/incidents-validation-api-tests.spec.ts:302` | getProcessInstanceStatisticsByError - Enum violation sort.0.field |
| negative-get | bad-request | `request-validation/unsecured/incidents-validation-api-tests.spec.ts:325` | getProcessInstanceStatisticsByError - Enum violation sort.0.order |
| negative-update | bad-request | `request-validation/unsecured/incidents-validation-api-tests.spec.ts:348` | resolveIncident - Additional prop __unexpectedField |
| negative-update | bad-request | `request-validation/unsecured/incidents-validation-api-tests.spec.ts:368` | resolveIncident - Body wrong top-level type |
| negative-update | bad-request | `request-validation/unsecured/incidents-validation-api-tests.spec.ts:385` | resolveIncident - Param operationReference wrong type (#1) |
| negative-update | bad-request | `request-validation/unsecured/incidents-validation-api-tests.spec.ts:406` | resolveIncident - Param operationReference wrong type (#2) |
| negative-update | bad-request | `request-validation/unsecured/incidents-validation-api-tests.spec.ts:427` | resolveIncident - Constraint violation operationReference (#1) |
| negative-update | bad-request | `request-validation/unsecured/incidents-validation-api-tests.spec.ts:448` | resolveIncident - Constraint violation operationReference (#2) |
| negative-update | bad-request | `request-validation/unsecured/incidents-validation-api-tests.spec.ts:469` | resolveIncident - Constraint violation operationReference (#3) |
| negative-update | bad-request | `request-validation/unsecured/incidents-validation-api-tests.spec.ts:490` | resolveIncident - Path param incidentKey pattern violation |
| negative-search | bad-request | `request-validation/unsecured/incidents-validation-api-tests.spec.ts:506` | searchIncidents - Additional prop __unexpectedField |
| negative-search | bad-request | `request-validation/unsecured/incidents-validation-api-tests.spec.ts:523` | searchIncidents - Body wrong top-level type |
| negative-search | bad-request | `request-validation/unsecured/incidents-validation-api-tests.spec.ts:538` | searchIncidents - Missing sort.0.field |
| negative-search | bad-request | `request-validation/unsecured/incidents-validation-api-tests.spec.ts:555` | searchIncidents - Enum violation sort.0.field |
| negative-search | bad-request | `request-validation/unsecured/incidents-validation-api-tests.spec.ts:576` | searchIncidents - Enum violation sort.0.order |
| state-transition | happy-path | `templates/StateTransitionVisibleAfterAction/Incident.resolveIncident.lifecycle.spec.ts:10` | invoke resolveIncident, observe state=RESOLVED on read-back |

## I. Decision-Instance Lifecycle

**Form**: Deploy DRD/DMN (prerequisite) → Evaluate → Get instance → Search → Delete (single + batch) → Search (Observe Absence)

**Total tests**: 72

### `decision-instance` — 72 tests

- **Prerequisite to create**: deployed-decision
- **Files**: `deleteDecisionInstance.feature.spec.ts`, `deleteDecisionInstancesBatchOperation.feature.spec.ts`, `deleteDecisionInstancesBatchOperation.variant.spec.ts`, `getDecisionInstance.feature.spec.ts`, `request-validation/unsecured/decisioninstances-validation-api-tests.spec.ts`, `searchDecisionInstances.feature.spec.ts`, `searchDecisionInstances.variant.spec.ts`
- **Observation channel**: GET = 1, Search = 13
- **Form-step counts**: observe-present-get=1, observe-present-search=13, delete=12, observe-absence=1, negative-get=1, negative-delete=38, negative-search=6
- **Variants**: happy-path=4, observe-absence=1, data-driven=22, bad-request=45, pagination-sort=2, filter=21

| form step | variants | file:line | test name |
|--|--|--|--|
| observe-present-get | happy-path | `getDecisionInstance.feature.spec.ts:13` | feature-1 - getDecisionInstance - base (1) |
| observe-present-search | happy-path | `searchDecisionInstances.feature.spec.ts:12` | feature-1 - searchDecisionInstances - base (1) |
| observe-present-search | data-driven, filter | `searchDecisionInstances.variant.spec.ts:13` | variant-1 - searchDecisionInstances - dmn #1 |
| observe-present-search | data-driven, filter | `searchDecisionInstances.variant.spec.ts:84` | variant-2 - searchDecisionInstances - dmn #1 |
| observe-present-search | data-driven, filter | `searchDecisionInstances.variant.spec.ts:130` | variant-3 - searchDecisionInstances - path #1 |
| observe-present-search | data-driven, filter | `searchDecisionInstances.variant.spec.ts:178` | variant-4 - searchDecisionInstances - dmn #1 |
| observe-present-search | data-driven, filter | `searchDecisionInstances.variant.spec.ts:249` | variant-5 - searchDecisionInstances - bpmn #1 |
| observe-present-search | data-driven, filter | `searchDecisionInstances.variant.spec.ts:298` | variant-6 - searchDecisionInstances - bpmn #1 |
| observe-present-search | data-driven, filter | `searchDecisionInstances.variant.spec.ts:365` | variant-7 - searchDecisionInstances - dmn #1 |
| observe-present-search | data-driven, filter | `searchDecisionInstances.variant.spec.ts:411` | variant-8 - searchDecisionInstances - bpmn #1 |
| observe-present-search | data-driven, filter | `searchDecisionInstances.variant.spec.ts:509` | variant-9 - searchDecisionInstances - dmn #1 |
| observe-present-search | data-driven, filter | `searchDecisionInstances.variant.spec.ts:555` | variant-10 - searchDecisionInstances - drd #1 |
| observe-present-search | data-driven, pagination-sort | `searchDecisionInstances.variant.spec.ts:601` | variant-11 - searchDecisionInstances - path #1 |
| observe-present-search | data-driven, pagination-sort | `searchDecisionInstances.variant.spec.ts:653` | variant-12 - searchDecisionInstances - path #1 |
| delete | happy-path | `deleteDecisionInstance.feature.spec.ts:9` | feature-1 - deleteDecisionInstance - base (1) |
| delete | happy-path, filter | `deleteDecisionInstancesBatchOperation.feature.spec.ts:11` | feature-1 - deleteDecisionInstancesBatchOperation - base (1) |
| delete | data-driven, filter | `deleteDecisionInstancesBatchOperation.variant.spec.ts:12` | variant-1 - deleteDecisionInstancesBatchOperation - dmn #1 |
| delete | data-driven, filter | `deleteDecisionInstancesBatchOperation.variant.spec.ts:82` | variant-2 - deleteDecisionInstancesBatchOperation - dmn #1 |
| delete | data-driven, filter | `deleteDecisionInstancesBatchOperation.variant.spec.ts:127` | variant-3 - deleteDecisionInstancesBatchOperation - path #1 |
| delete | data-driven, filter | `deleteDecisionInstancesBatchOperation.variant.spec.ts:174` | variant-4 - deleteDecisionInstancesBatchOperation - dmn #1 |
| delete | data-driven, filter | `deleteDecisionInstancesBatchOperation.variant.spec.ts:244` | variant-5 - deleteDecisionInstancesBatchOperation - bpmn #1 |
| delete | data-driven, filter | `deleteDecisionInstancesBatchOperation.variant.spec.ts:292` | variant-6 - deleteDecisionInstancesBatchOperation - bpmn #1 |
| delete | data-driven, filter | `deleteDecisionInstancesBatchOperation.variant.spec.ts:358` | variant-7 - deleteDecisionInstancesBatchOperation - dmn #1 |
| delete | data-driven, filter | `deleteDecisionInstancesBatchOperation.variant.spec.ts:403` | variant-8 - deleteDecisionInstancesBatchOperation - bpmn #1 |
| delete | data-driven, filter | `deleteDecisionInstancesBatchOperation.variant.spec.ts:500` | variant-9 - deleteDecisionInstancesBatchOperation - dmn #1 |
| delete | data-driven, filter | `deleteDecisionInstancesBatchOperation.variant.spec.ts:545` | variant-10 - deleteDecisionInstancesBatchOperation - drd #1 |
| observe-absence | observe-absence | `searchDecisionInstances.feature.spec.ts:36` | feature-2 - searchDecisionInstances - negative empty (2) |
| negative-get | bad-request | `request-validation/unsecured/decisioninstances-validation-api-tests.spec.ts:979` | getDecisionInstance - Path param decisionEvaluationInstanceKey pattern violation |
| negative-delete | bad-request | `request-validation/unsecured/decisioninstances-validation-api-tests.spec.ts:18` | deleteDecisionInstance - Additional prop __unexpectedField |
| negative-delete | bad-request | `request-validation/unsecured/decisioninstances-validation-api-tests.spec.ts:40` | deleteDecisionInstance - Body wrong top-level type |
| negative-delete | bad-request | `request-validation/unsecured/decisioninstances-validation-api-tests.spec.ts:57` | deleteDecisionInstance - Param operationReference wrong type (#1) |
| negative-delete | bad-request | `request-validation/unsecured/decisioninstances-validation-api-tests.spec.ts:78` | deleteDecisionInstance - Param operationReference wrong type (#2) |
| negative-delete | bad-request | `request-validation/unsecured/decisioninstances-validation-api-tests.spec.ts:99` | deleteDecisionInstance - Constraint violation operationReference (#1) |
| negative-delete | bad-request | `request-validation/unsecured/decisioninstances-validation-api-tests.spec.ts:120` | deleteDecisionInstance - Constraint violation operationReference (#2) |
| negative-delete | bad-request | `request-validation/unsecured/decisioninstances-validation-api-tests.spec.ts:141` | deleteDecisionInstance - Constraint violation operationReference (#3) |
| negative-delete | bad-request | `request-validation/unsecured/decisioninstances-validation-api-tests.spec.ts:162` | deleteDecisionInstance - Path param decisionEvaluationKey pattern violation |
| negative-delete | bad-request | `request-validation/unsecured/decisioninstances-validation-api-tests.spec.ts:178` | deleteDecisionInstancesBatchOperation - Additional prop __unexpectedField |
| negative-delete | bad-request | `request-validation/unsecured/decisioninstances-validation-api-tests.spec.ts:207` | deleteDecisionInstancesBatchOperation - Body wrong top-level type |
| negative-delete | bad-request | `request-validation/unsecured/decisioninstances-validation-api-tests.spec.ts:224` | deleteDecisionInstancesBatchOperation - Param filter.decisionDefinitionId wrong type (#1) |
| negative-delete | bad-request | `request-validation/unsecured/decisioninstances-validation-api-tests.spec.ts:252` | deleteDecisionInstancesBatchOperation - Param filter.decisionDefinitionId wrong type (#2) |
| negative-delete | bad-request | `request-validation/unsecured/decisioninstances-validation-api-tests.spec.ts:280` | deleteDecisionInstancesBatchOperation - Param filter.decisionDefinitionType wrong type (#1) |
| negative-delete | bad-request | `request-validation/unsecured/decisioninstances-validation-api-tests.spec.ts:308` | deleteDecisionInstancesBatchOperation - Param filter.decisionDefinitionType wrong type (#2) |
| negative-delete | bad-request | `request-validation/unsecured/decisioninstances-validation-api-tests.spec.ts:336` | deleteDecisionInstancesBatchOperation - Param filter.decisionDefinitionVersion wrong type (#1) |
| negative-delete | bad-request | `request-validation/unsecured/decisioninstances-validation-api-tests.spec.ts:364` | deleteDecisionInstancesBatchOperation - Param filter.decisionDefinitionVersion wrong type (#2) |
| negative-delete | bad-request | `request-validation/unsecured/decisioninstances-validation-api-tests.spec.ts:392` | deleteDecisionInstancesBatchOperation - Param filter.decisionEvaluationKey wrong type (#1) |
| negative-delete | bad-request | `request-validation/unsecured/decisioninstances-validation-api-tests.spec.ts:420` | deleteDecisionInstancesBatchOperation - Param filter.decisionEvaluationKey wrong type (#2) |
| negative-delete | bad-request | `request-validation/unsecured/decisioninstances-validation-api-tests.spec.ts:448` | deleteDecisionInstancesBatchOperation - Param filter.processDefinitionKey wrong type (#1) |
| negative-delete | bad-request | `request-validation/unsecured/decisioninstances-validation-api-tests.spec.ts:476` | deleteDecisionInstancesBatchOperation - Param filter.processDefinitionKey wrong type (#2) |
| negative-delete | bad-request | `request-validation/unsecured/decisioninstances-validation-api-tests.spec.ts:504` | deleteDecisionInstancesBatchOperation - Param filter.processInstanceKey wrong type (#1) |
| negative-delete | bad-request | `request-validation/unsecured/decisioninstances-validation-api-tests.spec.ts:532` | deleteDecisionInstancesBatchOperation - Param filter.processInstanceKey wrong type (#2) |
| negative-delete | bad-request | `request-validation/unsecured/decisioninstances-validation-api-tests.spec.ts:560` | deleteDecisionInstancesBatchOperation - Param filter.tenantId wrong type (#1) |
| negative-delete | bad-request | `request-validation/unsecured/decisioninstances-validation-api-tests.spec.ts:588` | deleteDecisionInstancesBatchOperation - Param filter.tenantId wrong type (#2) |
| negative-delete | bad-request | `request-validation/unsecured/decisioninstances-validation-api-tests.spec.ts:616` | deleteDecisionInstancesBatchOperation - Param operationReference wrong type (#1) |
| negative-delete | bad-request | `request-validation/unsecured/decisioninstances-validation-api-tests.spec.ts:644` | deleteDecisionInstancesBatchOperation - Param operationReference wrong type (#2) |
| negative-delete | bad-request | `request-validation/unsecured/decisioninstances-validation-api-tests.spec.ts:672` | deleteDecisionInstancesBatchOperation - Constraint violation filter.decisionDefinitionId (#1) |
| negative-delete | bad-request | `request-validation/unsecured/decisioninstances-validation-api-tests.spec.ts:700` | deleteDecisionInstancesBatchOperation - Constraint violation filter.decisionDefinitionId (#2) |
| negative-delete | bad-request | `request-validation/unsecured/decisioninstances-validation-api-tests.spec.ts:728` | deleteDecisionInstancesBatchOperation - Constraint violation filter.tenantId (#1) |
| negative-delete | bad-request | `request-validation/unsecured/decisioninstances-validation-api-tests.spec.ts:756` | deleteDecisionInstancesBatchOperation - Constraint violation filter.tenantId (#2) |
| negative-delete | bad-request | `request-validation/unsecured/decisioninstances-validation-api-tests.spec.ts:784` | deleteDecisionInstancesBatchOperation - Constraint violation filter.tenantId (#3) |
| negative-delete | bad-request | `request-validation/unsecured/decisioninstances-validation-api-tests.spec.ts:812` | deleteDecisionInstancesBatchOperation - Constraint violation filter.tenantId (#4) |
| negative-delete | bad-request | `request-validation/unsecured/decisioninstances-validation-api-tests.spec.ts:840` | deleteDecisionInstancesBatchOperation - Constraint violation operationReference (#1) |
| negative-delete | bad-request | `request-validation/unsecured/decisioninstances-validation-api-tests.spec.ts:868` | deleteDecisionInstancesBatchOperation - Constraint violation operationReference (#2) |
| negative-delete | bad-request | `request-validation/unsecured/decisioninstances-validation-api-tests.spec.ts:896` | deleteDecisionInstancesBatchOperation - Constraint violation operationReference (#3) |
| negative-delete | bad-request | `request-validation/unsecured/decisioninstances-validation-api-tests.spec.ts:924` | deleteDecisionInstancesBatchOperation - Enum violation filter.decisionDefinitionType |
| negative-delete | bad-request | `request-validation/unsecured/decisioninstances-validation-api-tests.spec.ts:952` | deleteDecisionInstancesBatchOperation - Missing filter |
| negative-delete | bad-request | `request-validation/unsecured/decisioninstances-validation-api-tests.spec.ts:967` | deleteDecisionInstancesBatchOperation - Missing body |
| negative-search | bad-request | `request-validation/unsecured/decisioninstances-validation-api-tests.spec.ts:995` | searchDecisionInstances - Additional prop __unexpectedField |
| negative-search | bad-request | `request-validation/unsecured/decisioninstances-validation-api-tests.spec.ts:1014` | searchDecisionInstances - Body wrong top-level type |
| negative-search | bad-request | `request-validation/unsecured/decisioninstances-validation-api-tests.spec.ts:1029` | searchDecisionInstances - Missing sort.0.field |
| negative-search | bad-request | `request-validation/unsecured/decisioninstances-validation-api-tests.spec.ts:1046` | searchDecisionInstances - Enum violation filter.decisionDefinitionType |
| negative-search | bad-request | `request-validation/unsecured/decisioninstances-validation-api-tests.spec.ts:1067` | searchDecisionInstances - Enum violation sort.0.field |
| negative-search | bad-request | `request-validation/unsecured/decisioninstances-validation-api-tests.spec.ts:1088` | searchDecisionInstances - Enum violation sort.0.order |

## J/K/L. Observation-only

**Form**: Perform an action elsewhere (prerequisite) → Get / Search to observe

**Total tests**: 104

### `element-instance` — 57 tests

- **Prerequisite to create**: running-process-instance
- **Files**: `activateAdHocSubProcessActivities.feature.spec.ts`, `activateAdHocSubProcessActivities.variant.spec.ts`, `createElementInstanceVariables.feature.spec.ts`, `getElementInstance.feature.spec.ts`, `request-validation/unsecured/elementinstances-validation-api-tests.spec.ts`, `searchElementInstanceIncidents.feature.spec.ts`, `searchElementInstanceIncidents.variant.spec.ts`, `searchElementInstances.feature.spec.ts`, `searchElementInstances.variant.spec.ts`
- **Observation channel**: GET = 1, Search = 21
- **Form-step counts**: create=3, observe-present-get=1, observe-present-search=21, observe-absence=1, negative-create=16, negative-get=2, negative-search=13
- **Variants**: happy-path=5, observe-absence=1, data-driven=20, bad-request=30, not-found=1, pagination-sort=4, filter=13

| form step | variants | file:line | test name |
|--|--|--|--|
| create | happy-path | `activateAdHocSubProcessActivities.feature.spec.ts:9` | feature-1 - activateAdHocSubProcessActivities - base (1) |
| create | data-driven | `activateAdHocSubProcessActivities.variant.spec.ts:9` | variant-1 - activateAdHocSubProcessActivities - bpmn #1 |
| create | happy-path | `createElementInstanceVariables.feature.spec.ts:9` | feature-1 - createElementInstanceVariables - base (1) |
| observe-present-get | happy-path | `getElementInstance.feature.spec.ts:13` | feature-1 - getElementInstance - base (1) |
| observe-present-search | happy-path | `searchElementInstanceIncidents.feature.spec.ts:13` | feature-1 - searchElementInstanceIncidents - base (1) |
| observe-present-search | data-driven, filter | `searchElementInstanceIncidents.variant.spec.ts:13` | variant-1 - searchElementInstanceIncidents - bpmn #1 |
| observe-present-search | data-driven, filter | `searchElementInstanceIncidents.variant.spec.ts:116` | variant-2 - searchElementInstanceIncidents - bpmn #1 |
| observe-present-search | data-driven, filter | `searchElementInstanceIncidents.variant.spec.ts:219` | variant-3 - searchElementInstanceIncidents - bpmn #1 |
| observe-present-search | data-driven, filter | `searchElementInstanceIncidents.variant.spec.ts:322` | variant-4 - searchElementInstanceIncidents - bpmn #1 |
| observe-present-search | data-driven, pagination-sort | `searchElementInstanceIncidents.variant.spec.ts:425` | variant-5 - searchElementInstanceIncidents - bpmn #1 |
| observe-present-search | data-driven, pagination-sort | `searchElementInstanceIncidents.variant.spec.ts:551` | variant-6 - searchElementInstanceIncidents - bpmn #1 |
| observe-present-search | happy-path | `searchElementInstances.feature.spec.ts:12` | feature-1 - searchElementInstances - base (1) |
| observe-present-search | data-driven | `searchElementInstances.feature.spec.ts:61` | feature-3 - searchElementInstances - oneOf filter.elementInstanceScopeKey variant1 (3) |
| observe-present-search | data-driven | `searchElementInstances.feature.spec.ts:88` | feature-4 - searchElementInstances - oneOf filter.elementInstanceScopeKey variant2 (4) |
| observe-present-search | data-driven, filter | `searchElementInstances.variant.spec.ts:13` | variant-1 - searchElementInstances - bpmn #1 |
| observe-present-search | data-driven, filter | `searchElementInstances.variant.spec.ts:62` | variant-2 - searchElementInstances - bpmn #1 |
| observe-present-search | data-driven, filter | `searchElementInstances.variant.spec.ts:160` | variant-3 - searchElementInstances - path #1 |
| observe-present-search | data-driven, filter | `searchElementInstances.variant.spec.ts:208` | variant-4 - searchElementInstances - bpmn #1 |
| observe-present-search | data-driven, filter | `searchElementInstances.variant.spec.ts:306` | variant-5 - searchElementInstances - bpmn #1 |
| observe-present-search | data-driven, filter | `searchElementInstances.variant.spec.ts:373` | variant-6 - searchElementInstances - bpmn #1 |
| observe-present-search | data-driven, filter | `searchElementInstances.variant.spec.ts:422` | variant-7 - searchElementInstances - bpmn #1 |
| observe-present-search | data-driven, filter | `searchElementInstances.variant.spec.ts:572` | variant-8 - searchElementInstances - bpmn #1 |
| observe-present-search | data-driven, filter | `searchElementInstances.variant.spec.ts:670` | variant-9 - searchElementInstances - bpmn #1 |
| observe-present-search | data-driven, pagination-sort | `searchElementInstances.variant.spec.ts:737` | variant-10 - searchElementInstances - path #1 |
| observe-present-search | data-driven, pagination-sort | `searchElementInstances.variant.spec.ts:789` | variant-11 - searchElementInstances - path #1 |
| observe-absence | observe-absence | `searchElementInstances.feature.spec.ts:36` | feature-2 - searchElementInstances - negative empty (2) |
| negative-create | bad-request | `request-validation/unsecured/elementinstances-validation-api-tests.spec.ts:18` | activateAdHocSubProcessActivities - Additional prop __extraField |
| negative-create | bad-request | `request-validation/unsecured/elementinstances-validation-api-tests.spec.ts:45` | activateAdHocSubProcessActivities - Body wrong top-level type |
| negative-create | bad-request | `request-validation/unsecured/elementinstances-validation-api-tests.spec.ts:65` | activateAdHocSubProcessActivities - Missing elements.0.elementId |
| negative-create | bad-request | `request-validation/unsecured/elementinstances-validation-api-tests.spec.ts:87` | activateAdHocSubProcessActivities - Missing elements |
| negative-create | bad-request | `request-validation/unsecured/elementinstances-validation-api-tests.spec.ts:105` | activateAdHocSubProcessActivities - Missing body |
| negative-create | bad-request | `request-validation/unsecured/elementinstances-validation-api-tests.spec.ts:120` | activateAdHocSubProcessActivities - Path param adHocSubProcessInstanceKey pattern violation |
| negative-create | bad-request | `request-validation/unsecured/elementinstances-validation-api-tests.spec.ts:137` | createElementInstanceVariables - Additional prop __unexpectedField |
| negative-create | bad-request | `request-validation/unsecured/elementinstances-validation-api-tests.spec.ts:160` | createElementInstanceVariables - Body wrong top-level type |
| negative-create | bad-request | `request-validation/unsecured/elementinstances-validation-api-tests.spec.ts:179` | createElementInstanceVariables - Param operationReference wrong type (#1) |
| negative-create | bad-request | `request-validation/unsecured/elementinstances-validation-api-tests.spec.ts:201` | createElementInstanceVariables - Param operationReference wrong type (#2) |
| negative-create | bad-request | `request-validation/unsecured/elementinstances-validation-api-tests.spec.ts:223` | createElementInstanceVariables - Constraint violation operationReference (#1) |
| negative-create | bad-request | `request-validation/unsecured/elementinstances-validation-api-tests.spec.ts:245` | createElementInstanceVariables - Constraint violation operationReference (#2) |
| negative-create | bad-request | `request-validation/unsecured/elementinstances-validation-api-tests.spec.ts:267` | createElementInstanceVariables - Constraint violation operationReference (#3) |
| negative-create | bad-request | `request-validation/unsecured/elementinstances-validation-api-tests.spec.ts:289` | createElementInstanceVariables - Missing variables |
| negative-create | bad-request | `request-validation/unsecured/elementinstances-validation-api-tests.spec.ts:306` | createElementInstanceVariables - Missing body |
| negative-create | bad-request | `request-validation/unsecured/elementinstances-validation-api-tests.spec.ts:320` | createElementInstanceVariables - Path param elementInstanceKey pattern violation |
| negative-get | not-found | `request-validation/unsecured/elementinstances-validation-api-tests.spec.ts:336` | getElementInstance - Nonexistent elementInstanceKey returns 404 |
| negative-get | bad-request | `request-validation/unsecured/elementinstances-validation-api-tests.spec.ts:352` | getElementInstance - Path param elementInstanceKey pattern violation |
| negative-search | bad-request | `request-validation/unsecured/elementinstances-validation-api-tests.spec.ts:368` | searchElementInstanceIncidents - Additional prop __unexpectedField |
| negative-search | bad-request | `request-validation/unsecured/elementinstances-validation-api-tests.spec.ts:389` | searchElementInstanceIncidents - Body wrong top-level type |
| negative-search | bad-request | `request-validation/unsecured/elementinstances-validation-api-tests.spec.ts:408` | searchElementInstanceIncidents - Missing sort.0.field |
| negative-search | bad-request | `request-validation/unsecured/elementinstances-validation-api-tests.spec.ts:427` | searchElementInstanceIncidents - Enum violation sort.0.field |
| negative-search | bad-request | `request-validation/unsecured/elementinstances-validation-api-tests.spec.ts:452` | searchElementInstanceIncidents - Enum violation sort.0.order |
| negative-search | bad-request | `request-validation/unsecured/elementinstances-validation-api-tests.spec.ts:477` | searchElementInstanceIncidents - Missing body |
| negative-search | bad-request | `request-validation/unsecured/elementinstances-validation-api-tests.spec.ts:491` | searchElementInstanceIncidents - Path param elementInstanceKey pattern violation |
| negative-search | bad-request | `request-validation/unsecured/elementinstances-validation-api-tests.spec.ts:507` | searchElementInstances - Additional prop __unexpectedField |
| negative-search | bad-request | `request-validation/unsecured/elementinstances-validation-api-tests.spec.ts:526` | searchElementInstances - Body wrong top-level type |
| negative-search | bad-request | `request-validation/unsecured/elementinstances-validation-api-tests.spec.ts:541` | searchElementInstances - Missing sort.0.field |
| negative-search | bad-request | `request-validation/unsecured/elementinstances-validation-api-tests.spec.ts:558` | searchElementInstances - Enum violation filter.type |
| negative-search | bad-request | `request-validation/unsecured/elementinstances-validation-api-tests.spec.ts:577` | searchElementInstances - Enum violation sort.0.field |
| negative-search | bad-request | `request-validation/unsecured/elementinstances-validation-api-tests.spec.ts:598` | searchElementInstances - Enum violation sort.0.order |

### `audit-log` — 28 tests

- **Prerequisite to create**: any-prior-action
- **Files**: `getAuditLog.feature.spec.ts`, `request-validation/unsecured/auditlogs-validation-api-tests.spec.ts`, `searchAuditLogs.feature.spec.ts`, `searchAuditLogs.variant.spec.ts`
- **Observation channel**: GET = 1, Search = 19
- **Form-step counts**: observe-present-get=1, observe-present-search=19, observe-absence=1, negative-get=2, negative-search=5
- **Variants**: happy-path=2, observe-absence=1, data-driven=17, unlabeled=1, bad-request=6, not-found=1, pagination-sort=2, filter=16

| form step | variants | file:line | test name |
|--|--|--|--|
| observe-present-get | happy-path | `getAuditLog.feature.spec.ts:12` | feature-1 - getAuditLog - base (1) |
| observe-present-search | happy-path | `searchAuditLogs.feature.spec.ts:12` | feature-1 - searchAuditLogs - base (1) |
| observe-present-search | data-driven, filter | `searchAuditLogs.variant.spec.ts:13` | variant-1 - searchAuditLogs - bpmn #1 |
| observe-present-search | data-driven, filter | `searchAuditLogs.variant.spec.ts:164` | variant-2 - searchAuditLogs - bpmn #1 |
| observe-present-search | data-driven, filter | `searchAuditLogs.variant.spec.ts:211` | variant-3 - searchAuditLogs - bpmn #1 |
| observe-present-search | data-driven, filter | `searchAuditLogs.variant.spec.ts:276` | variant-4 - searchAuditLogs - bpmn #1 |
| observe-present-search | data-driven, filter | `searchAuditLogs.variant.spec.ts:372` | variant-5 - searchAuditLogs - bpmn #1 |
| observe-present-search | unlabeled, filter | `searchAuditLogs.variant.spec.ts:523` | variant-6 - scenario |
| observe-present-search | data-driven, filter | `searchAuditLogs.variant.spec.ts:550` | variant-7 - searchAuditLogs - form #1 |
| observe-present-search | data-driven, filter | `searchAuditLogs.variant.spec.ts:594` | variant-8 - searchAuditLogs - bpmn #1 |
| observe-present-search | data-driven, filter | `searchAuditLogs.variant.spec.ts:641` | variant-9 - searchAuditLogs - drd #1 |
| observe-present-search | data-driven, filter | `searchAuditLogs.variant.spec.ts:685` | variant-10 - searchAuditLogs - form #1 |
| observe-present-search | data-driven, filter | `searchAuditLogs.variant.spec.ts:729` | variant-11 - searchAuditLogs - dmn #1 |
| observe-present-search | data-driven, filter | `searchAuditLogs.variant.spec.ts:773` | variant-12 - searchAuditLogs - bpmn #1 |
| observe-present-search | data-driven, filter | `searchAuditLogs.variant.spec.ts:869` | variant-13 - searchAuditLogs - drd #1 |
| observe-present-search | data-driven, filter | `searchAuditLogs.variant.spec.ts:913` | variant-14 - searchAuditLogs - dmn #1 |
| observe-present-search | data-driven, filter | `searchAuditLogs.variant.spec.ts:957` | variant-15 - searchAuditLogs - dmn #1 |
| observe-present-search | data-driven, filter | `searchAuditLogs.variant.spec.ts:1026` | variant-16 - searchAuditLogs - bpmn #1 |
| observe-present-search | data-driven, pagination-sort | `searchAuditLogs.variant.spec.ts:1177` | variant-17 - searchAuditLogs - path #1 |
| observe-present-search | data-driven, pagination-sort | `searchAuditLogs.variant.spec.ts:1227` | variant-18 - searchAuditLogs - path #1 |
| observe-absence | observe-absence | `searchAuditLogs.feature.spec.ts:34` | feature-2 - searchAuditLogs - negative empty (2) |
| negative-get | not-found | `request-validation/unsecured/auditlogs-validation-api-tests.spec.ts:18` | getAuditLog - Nonexistent auditLogKey returns 404 |
| negative-get | bad-request | `request-validation/unsecured/auditlogs-validation-api-tests.spec.ts:32` | getAuditLog - Path param auditLogKey pattern violation |
| negative-search | bad-request | `request-validation/unsecured/auditlogs-validation-api-tests.spec.ts:44` | searchAuditLogs - Additional prop __unexpectedField |
| negative-search | bad-request | `request-validation/unsecured/auditlogs-validation-api-tests.spec.ts:61` | searchAuditLogs - Body wrong top-level type |
| negative-search | bad-request | `request-validation/unsecured/auditlogs-validation-api-tests.spec.ts:76` | searchAuditLogs - Missing sort.0.field |
| negative-search | bad-request | `request-validation/unsecured/auditlogs-validation-api-tests.spec.ts:93` | searchAuditLogs - Enum violation sort.0.field |
| negative-search | bad-request | `request-validation/unsecured/auditlogs-validation-api-tests.spec.ts:114` | searchAuditLogs - Enum violation sort.0.order |

### `variable` — 19 tests

- **Prerequisite to create**: running-process-instance
- **Files**: `getVariable.feature.spec.ts`, `request-validation/unsecured/variables-validation-api-tests.spec.ts`, `searchVariables.feature.spec.ts`, `searchVariables.variant.spec.ts`
- **Observation channel**: GET = 1, Search = 9
- **Form-step counts**: observe-present-get=1, observe-present-search=9, observe-absence=1, negative-get=2, negative-search=6
- **Variants**: happy-path=2, observe-absence=1, data-driven=8, bad-request=7, not-found=1, pagination-sort=2, filter=6

| form step | variants | file:line | test name |
|--|--|--|--|
| observe-present-get | happy-path | `getVariable.feature.spec.ts:12` | feature-1 - getVariable - base (1) |
| observe-present-search | happy-path | `searchVariables.feature.spec.ts:12` | feature-1 - searchVariables - base (1) |
| observe-present-search | data-driven, filter | `searchVariables.variant.spec.ts:13` | variant-1 - searchVariables - path #1 |
| observe-present-search | data-driven, filter | `searchVariables.variant.spec.ts:59` | variant-2 - searchVariables - bpmn #1 |
| observe-present-search | data-driven, filter | `searchVariables.variant.spec.ts:199` | variant-3 - searchVariables - bpmn #1 |
| observe-present-search | data-driven, filter | `searchVariables.variant.spec.ts:339` | variant-4 - searchVariables - bpmn #1 |
| observe-present-search | data-driven, filter | `searchVariables.variant.spec.ts:404` | variant-5 - searchVariables - bpmn #1 |
| observe-present-search | data-driven, filter | `searchVariables.variant.spec.ts:500` | variant-6 - searchVariables - bpmn #1 |
| observe-present-search | data-driven, pagination-sort | `searchVariables.variant.spec.ts:565` | variant-7 - searchVariables - path #1 |
| observe-present-search | data-driven, pagination-sort | `searchVariables.variant.spec.ts:615` | variant-8 - searchVariables - path #1 |
| observe-absence | observe-absence | `searchVariables.feature.spec.ts:34` | feature-2 - searchVariables - negative empty (2) |
| negative-get | not-found | `request-validation/unsecured/variables-validation-api-tests.spec.ts:18` | getVariable - Nonexistent variableKey returns 404 |
| negative-get | bad-request | `request-validation/unsecured/variables-validation-api-tests.spec.ts:32` | getVariable - Path param variableKey pattern violation |
| negative-search | bad-request | `request-validation/unsecured/variables-validation-api-tests.spec.ts:44` | searchVariables - Additional prop __unexpectedField |
| negative-search | bad-request | `request-validation/unsecured/variables-validation-api-tests.spec.ts:61` | searchVariables - Body wrong top-level type |
| negative-search | bad-request | `request-validation/unsecured/variables-validation-api-tests.spec.ts:76` | searchVariables - Missing sort.0.field |
| negative-search | bad-request | `request-validation/unsecured/variables-validation-api-tests.spec.ts:93` | searchVariables - Enum violation sort.0.field |
| negative-search | bad-request | `request-validation/unsecured/variables-validation-api-tests.spec.ts:114` | searchVariables - Enum violation sort.0.order |
| negative-search | bad-request | `request-validation/unsecured/variables-validation-api-tests.spec.ts:135` | searchVariables - Param query.truncateValues wrong type |

## M. Messaging/Signals

**Form**: Deploy process with catch event (prerequisite) → Publish/Correlate/Broadcast → Search subscriptions / correlated messages

**Total tests**: 70

### `message` — 30 tests

- **Prerequisite to create**: deployed-process-with-message-catch-event
- **Files**: `correlateMessage.feature.spec.ts`, `correlateMessage.variant.spec.ts`, `publishMessage.feature.spec.ts`, `publishMessage.variant.spec.ts`, `request-validation/unsecured/messages-validation-api-tests.spec.ts`
- **Observation channel**: GET = 0, Search = 0
- **Form-step counts**: create=4, negative-create=26
- **Variants**: happy-path=2, data-driven=2, bad-request=26

| form step | variants | file:line | test name |
|--|--|--|--|
| create | happy-path | `correlateMessage.feature.spec.ts:11` | feature-1 - correlateMessage - base (1) |
| create | data-driven | `correlateMessage.variant.spec.ts:11` | variant-1 - correlateMessage - path #1 |
| create | happy-path | `publishMessage.feature.spec.ts:11` | feature-1 - publishMessage - base (1) |
| create | data-driven | `publishMessage.variant.spec.ts:11` | variant-1 - publishMessage - path #1 |
| negative-create | bad-request | `request-validation/unsecured/messages-validation-api-tests.spec.ts:18` | correlateMessage - Additional prop __unexpectedField |
| negative-create | bad-request | `request-validation/unsecured/messages-validation-api-tests.spec.ts:37` | correlateMessage - Body wrong top-level type |
| negative-create | bad-request | `request-validation/unsecured/messages-validation-api-tests.spec.ts:52` | correlateMessage - Param name wrong type (#1) |
| negative-create | bad-request | `request-validation/unsecured/messages-validation-api-tests.spec.ts:70` | correlateMessage - Param name wrong type (#2) |
| negative-create | bad-request | `request-validation/unsecured/messages-validation-api-tests.spec.ts:88` | correlateMessage - Param tenantId wrong type (#1) |
| negative-create | bad-request | `request-validation/unsecured/messages-validation-api-tests.spec.ts:106` | correlateMessage - Param tenantId wrong type (#2) |
| negative-create | bad-request | `request-validation/unsecured/messages-validation-api-tests.spec.ts:124` | correlateMessage - Constraint violation tenantId (#1) |
| negative-create | bad-request | `request-validation/unsecured/messages-validation-api-tests.spec.ts:142` | correlateMessage - Constraint violation tenantId (#2) |
| negative-create | bad-request | `request-validation/unsecured/messages-validation-api-tests.spec.ts:160` | correlateMessage - Constraint violation tenantId (#3) |
| negative-create | bad-request | `request-validation/unsecured/messages-validation-api-tests.spec.ts:178` | correlateMessage - Constraint violation tenantId (#4) |
| negative-create | bad-request | `request-validation/unsecured/messages-validation-api-tests.spec.ts:196` | correlateMessage - Missing name |
| negative-create | bad-request | `request-validation/unsecured/messages-validation-api-tests.spec.ts:211` | correlateMessage - Missing body |
| negative-create | bad-request | `request-validation/unsecured/messages-validation-api-tests.spec.ts:223` | publishMessage - Additional prop __unexpectedField |
| negative-create | bad-request | `request-validation/unsecured/messages-validation-api-tests.spec.ts:243` | publishMessage - Body wrong top-level type |
| negative-create | bad-request | `request-validation/unsecured/messages-validation-api-tests.spec.ts:258` | publishMessage - Param name wrong type (#1) |
| negative-create | bad-request | `request-validation/unsecured/messages-validation-api-tests.spec.ts:277` | publishMessage - Param name wrong type (#2) |
| negative-create | bad-request | `request-validation/unsecured/messages-validation-api-tests.spec.ts:296` | publishMessage - Param tenantId wrong type (#1) |
| negative-create | bad-request | `request-validation/unsecured/messages-validation-api-tests.spec.ts:315` | publishMessage - Param tenantId wrong type (#2) |
| negative-create | bad-request | `request-validation/unsecured/messages-validation-api-tests.spec.ts:334` | publishMessage - Param timeToLive wrong type (#1) |
| negative-create | bad-request | `request-validation/unsecured/messages-validation-api-tests.spec.ts:353` | publishMessage - Param timeToLive wrong type (#2) |
| negative-create | bad-request | `request-validation/unsecured/messages-validation-api-tests.spec.ts:372` | publishMessage - Constraint violation tenantId (#1) |
| negative-create | bad-request | `request-validation/unsecured/messages-validation-api-tests.spec.ts:391` | publishMessage - Constraint violation tenantId (#2) |
| negative-create | bad-request | `request-validation/unsecured/messages-validation-api-tests.spec.ts:410` | publishMessage - Constraint violation tenantId (#3) |
| negative-create | bad-request | `request-validation/unsecured/messages-validation-api-tests.spec.ts:429` | publishMessage - Constraint violation tenantId (#4) |
| negative-create | bad-request | `request-validation/unsecured/messages-validation-api-tests.spec.ts:448` | publishMessage - Missing name |
| negative-create | bad-request | `request-validation/unsecured/messages-validation-api-tests.spec.ts:463` | publishMessage - Missing body |

### `signal` — 14 tests

- **Prerequisite to create**: deployed-process-with-signal-catch-event
- **Files**: `broadcastSignal.feature.spec.ts`, `broadcastSignal.variant.spec.ts`, `request-validation/unsecured/signals-validation-api-tests.spec.ts`
- **Observation channel**: GET = 0, Search = 0
- **Form-step counts**: create=2, negative-create=12
- **Variants**: happy-path=1, data-driven=1, bad-request=12

| form step | variants | file:line | test name |
|--|--|--|--|
| create | happy-path | `broadcastSignal.feature.spec.ts:11` | feature-1 - broadcastSignal - base (1) |
| create | data-driven | `broadcastSignal.variant.spec.ts:11` | variant-1 - broadcastSignal - path #1 |
| negative-create | bad-request | `request-validation/unsecured/signals-validation-api-tests.spec.ts:18` | broadcastSignal - Additional prop __unexpectedField |
| negative-create | bad-request | `request-validation/unsecured/signals-validation-api-tests.spec.ts:37` | broadcastSignal - Body wrong top-level type |
| negative-create | bad-request | `request-validation/unsecured/signals-validation-api-tests.spec.ts:52` | broadcastSignal - Param signalName wrong type (#1) |
| negative-create | bad-request | `request-validation/unsecured/signals-validation-api-tests.spec.ts:70` | broadcastSignal - Param signalName wrong type (#2) |
| negative-create | bad-request | `request-validation/unsecured/signals-validation-api-tests.spec.ts:88` | broadcastSignal - Param tenantId wrong type (#1) |
| negative-create | bad-request | `request-validation/unsecured/signals-validation-api-tests.spec.ts:106` | broadcastSignal - Param tenantId wrong type (#2) |
| negative-create | bad-request | `request-validation/unsecured/signals-validation-api-tests.spec.ts:124` | broadcastSignal - Constraint violation tenantId (#1) |
| negative-create | bad-request | `request-validation/unsecured/signals-validation-api-tests.spec.ts:142` | broadcastSignal - Constraint violation tenantId (#2) |
| negative-create | bad-request | `request-validation/unsecured/signals-validation-api-tests.spec.ts:160` | broadcastSignal - Constraint violation tenantId (#3) |
| negative-create | bad-request | `request-validation/unsecured/signals-validation-api-tests.spec.ts:178` | broadcastSignal - Constraint violation tenantId (#4) |
| negative-create | bad-request | `request-validation/unsecured/signals-validation-api-tests.spec.ts:196` | broadcastSignal - Missing signalName |
| negative-create | bad-request | `request-validation/unsecured/signals-validation-api-tests.spec.ts:211` | broadcastSignal - Missing body |

### `correlated-message-subscription` — 13 tests

- **Prerequisite to create**: deployed-process-with-message-catch-event + correlated-message
- **Files**: `request-validation/unsecured/correlatedmessagesubscriptions-validation-api-tests.spec.ts`, `searchCorrelatedMessageSubscriptions.feature.spec.ts`, `searchCorrelatedMessageSubscriptions.variant.spec.ts`
- **Observation channel**: GET = 0, Search = 7
- **Form-step counts**: observe-present-search=7, observe-absence=1, negative-search=5
- **Variants**: happy-path=1, observe-absence=1, data-driven=6, bad-request=5, pagination-sort=2, filter=4

| form step | variants | file:line | test name |
|--|--|--|--|
| observe-present-search | happy-path | `searchCorrelatedMessageSubscriptions.feature.spec.ts:12` | feature-1 - searchCorrelatedMessageSubscriptions - base (1) |
| observe-present-search | data-driven, filter | `searchCorrelatedMessageSubscriptions.variant.spec.ts:13` | variant-1 - searchCorrelatedMessageSubscriptions - bpmn #1 |
| observe-present-search | data-driven, filter | `searchCorrelatedMessageSubscriptions.variant.spec.ts:112` | variant-2 - searchCorrelatedMessageSubscriptions - bpmn #1 |
| observe-present-search | data-driven, filter | `searchCorrelatedMessageSubscriptions.variant.spec.ts:162` | variant-3 - searchCorrelatedMessageSubscriptions - bpmn #1 |
| observe-present-search | data-driven, filter | `searchCorrelatedMessageSubscriptions.variant.spec.ts:230` | variant-4 - searchCorrelatedMessageSubscriptions - path #1 |
| observe-present-search | data-driven, pagination-sort | `searchCorrelatedMessageSubscriptions.variant.spec.ts:284` | variant-5 - searchCorrelatedMessageSubscriptions - path #1 |
| observe-present-search | data-driven, pagination-sort | `searchCorrelatedMessageSubscriptions.variant.spec.ts:337` | variant-6 - searchCorrelatedMessageSubscriptions - path #1 |
| observe-absence | observe-absence | `searchCorrelatedMessageSubscriptions.feature.spec.ts:37` | feature-2 - searchCorrelatedMessageSubscriptions - negative empty (2) |
| negative-search | bad-request | `request-validation/unsecured/correlatedmessagesubscriptions-validation-api-tests.spec.ts:18` | searchCorrelatedMessageSubscriptions - Additional prop __unexpectedField |
| negative-search | bad-request | `request-validation/unsecured/correlatedmessagesubscriptions-validation-api-tests.spec.ts:37` | searchCorrelatedMessageSubscriptions - Body wrong top-level type |
| negative-search | bad-request | `request-validation/unsecured/correlatedmessagesubscriptions-validation-api-tests.spec.ts:54` | searchCorrelatedMessageSubscriptions - Missing sort.0.field |
| negative-search | bad-request | `request-validation/unsecured/correlatedmessagesubscriptions-validation-api-tests.spec.ts:73` | searchCorrelatedMessageSubscriptions - Enum violation sort.0.field |
| negative-search | bad-request | `request-validation/unsecured/correlatedmessagesubscriptions-validation-api-tests.spec.ts:96` | searchCorrelatedMessageSubscriptions - Enum violation sort.0.order |

### `message-subscriptions` — 13 tests

- **Prerequisite to create**: deployed-process-with-message-catch-event
- **Files**: `request-validation/unsecured/messagesubscriptions-validation-api-tests.spec.ts`, `searchMessageSubscriptions.feature.spec.ts`, `searchMessageSubscriptions.variant.spec.ts`
- **Observation channel**: GET = 0, Search = 7
- **Form-step counts**: observe-present-search=7, observe-absence=1, negative-search=5
- **Variants**: happy-path=1, observe-absence=1, data-driven=6, bad-request=5, pagination-sort=2, filter=4

| form step | variants | file:line | test name |
|--|--|--|--|
| observe-present-search | happy-path | `searchMessageSubscriptions.feature.spec.ts:12` | feature-1 - searchMessageSubscriptions - base (1) |
| observe-present-search | data-driven, filter | `searchMessageSubscriptions.variant.spec.ts:13` | variant-1 - searchMessageSubscriptions - path #1 |
| observe-present-search | data-driven, filter | `searchMessageSubscriptions.variant.spec.ts:66` | variant-2 - searchMessageSubscriptions - bpmn #1 |
| observe-present-search | data-driven, filter | `searchMessageSubscriptions.variant.spec.ts:115` | variant-3 - searchMessageSubscriptions - bpmn #1 |
| observe-present-search | data-driven, filter | `searchMessageSubscriptions.variant.spec.ts:182` | variant-4 - searchMessageSubscriptions - bpmn #1 |
| observe-present-search | data-driven, pagination-sort | `searchMessageSubscriptions.variant.spec.ts:280` | variant-5 - searchMessageSubscriptions - path #1 |
| observe-present-search | data-driven, pagination-sort | `searchMessageSubscriptions.variant.spec.ts:332` | variant-6 - searchMessageSubscriptions - path #1 |
| observe-absence | observe-absence | `searchMessageSubscriptions.feature.spec.ts:36` | feature-2 - searchMessageSubscriptions - negative empty (2) |
| negative-search | bad-request | `request-validation/unsecured/messagesubscriptions-validation-api-tests.spec.ts:18` | searchMessageSubscriptions - Additional prop __unexpectedField |
| negative-search | bad-request | `request-validation/unsecured/messagesubscriptions-validation-api-tests.spec.ts:37` | searchMessageSubscriptions - Body wrong top-level type |
| negative-search | bad-request | `request-validation/unsecured/messagesubscriptions-validation-api-tests.spec.ts:52` | searchMessageSubscriptions - Missing sort.0.field |
| negative-search | bad-request | `request-validation/unsecured/messagesubscriptions-validation-api-tests.spec.ts:69` | searchMessageSubscriptions - Enum violation sort.0.field |
| negative-search | bad-request | `request-validation/unsecured/messagesubscriptions-validation-api-tests.spec.ts:92` | searchMessageSubscriptions - Enum violation sort.0.order |

## N. Engine Evaluation

**Form**: Submit expression / conditional → Receive result (stateless, no entity persisted)

**Total tests**: 27

### `conditional` — 15 tests

- **Prerequisite to create**: none
- **Files**: `evaluateConditionals.feature.spec.ts`, `evaluateConditionals.variant.spec.ts`, `request-validation/unsecured/conditionals-validation-api-tests.spec.ts`
- **Observation channel**: GET = 0, Search = 0
- **Form-step counts**: create=3, negative-create=12
- **Variants**: happy-path=1, data-driven=2, bad-request=12

| form step | variants | file:line | test name |
|--|--|--|--|
| create | happy-path | `evaluateConditionals.feature.spec.ts:11` | feature-1 - evaluateConditionals - base (1) |
| create | data-driven | `evaluateConditionals.variant.spec.ts:12` | variant-1 - evaluateConditionals - path #1 |
| create | data-driven | `evaluateConditionals.variant.spec.ts:59` | variant-2 - evaluateConditionals - bpmn #1 |
| negative-create | bad-request | `request-validation/unsecured/conditionals-validation-api-tests.spec.ts:18` | evaluateConditionals - Additional prop __extraField |
| negative-create | bad-request | `request-validation/unsecured/conditionals-validation-api-tests.spec.ts:38` | evaluateConditionals - Body wrong top-level type |
| negative-create | bad-request | `request-validation/unsecured/conditionals-validation-api-tests.spec.ts:53` | evaluateConditionals - Param processDefinitionKey wrong type (#1) |
| negative-create | bad-request | `request-validation/unsecured/conditionals-validation-api-tests.spec.ts:74` | evaluateConditionals - Param processDefinitionKey wrong type (#2) |
| negative-create | bad-request | `request-validation/unsecured/conditionals-validation-api-tests.spec.ts:95` | evaluateConditionals - Param tenantId wrong type (#1) |
| negative-create | bad-request | `request-validation/unsecured/conditionals-validation-api-tests.spec.ts:114` | evaluateConditionals - Param tenantId wrong type (#2) |
| negative-create | bad-request | `request-validation/unsecured/conditionals-validation-api-tests.spec.ts:133` | evaluateConditionals - Constraint violation tenantId (#1) |
| negative-create | bad-request | `request-validation/unsecured/conditionals-validation-api-tests.spec.ts:154` | evaluateConditionals - Constraint violation tenantId (#2) |
| negative-create | bad-request | `request-validation/unsecured/conditionals-validation-api-tests.spec.ts:175` | evaluateConditionals - Constraint violation tenantId (#3) |
| negative-create | bad-request | `request-validation/unsecured/conditionals-validation-api-tests.spec.ts:196` | evaluateConditionals - Constraint violation tenantId (#4) |
| negative-create | bad-request | `request-validation/unsecured/conditionals-validation-api-tests.spec.ts:217` | evaluateConditionals - Missing variables |
| negative-create | bad-request | `request-validation/unsecured/conditionals-validation-api-tests.spec.ts:232` | evaluateConditionals - Missing body |

### `expression` — 12 tests

- **Prerequisite to create**: none
- **Files**: `evaluateExpression.feature.spec.ts`, `evaluateExpression.variant.spec.ts`, `request-validation/unsecured/expression-validation-api-tests.spec.ts`
- **Observation channel**: GET = 0, Search = 0
- **Form-step counts**: create=4, negative-create=8
- **Variants**: happy-path=1, data-driven=3, bad-request=8, filter=1

| form step | variants | file:line | test name |
|--|--|--|--|
| create | happy-path | `evaluateExpression.feature.spec.ts:11` | feature-1 - evaluateExpression - base (1) |
| create | data-driven, filter | `evaluateExpression.variant.spec.ts:13` | variant-1 - evaluateExpression - bpmn #1 |
| create | data-driven | `evaluateExpression.variant.spec.ts:131` | variant-2 - evaluateExpression - bpmn #1 |
| create | data-driven | `evaluateExpression.variant.spec.ts:197` | variant-3 - evaluateExpression - bpmn #1 |
| negative-create | bad-request | `request-validation/unsecured/expression-validation-api-tests.spec.ts:18` | evaluateExpression - Additional prop __extraField |
| negative-create | bad-request | `request-validation/unsecured/expression-validation-api-tests.spec.ts:37` | evaluateExpression - Body wrong top-level type |
| negative-create | bad-request | `request-validation/unsecured/expression-validation-api-tests.spec.ts:52` | evaluateExpression - Param expression wrong type (#1) |
| negative-create | bad-request | `request-validation/unsecured/expression-validation-api-tests.spec.ts:70` | evaluateExpression - Param expression wrong type (#2) |
| negative-create | bad-request | `request-validation/unsecured/expression-validation-api-tests.spec.ts:88` | evaluateExpression - Param scopeKey wrong type (#1) |
| negative-create | bad-request | `request-validation/unsecured/expression-validation-api-tests.spec.ts:106` | evaluateExpression - Param scopeKey wrong type (#2) |
| negative-create | bad-request | `request-validation/unsecured/expression-validation-api-tests.spec.ts:124` | evaluateExpression - Missing expression |
| negative-create | bad-request | `request-validation/unsecured/expression-validation-api-tests.spec.ts:139` | evaluateExpression - Missing body |

## O. System/Admin

**Form**: Read system state (auth, license, cluster, clock, metrics) or perform admin action (pin/reset clock)

**Total tests**: 36

### `setup` — 15 tests

- **Prerequisite to create**: none
- **Files**: `createAdminUser.feature.spec.ts`, `request-validation/unsecured/setup-validation-api-tests.spec.ts`
- **Observation channel**: GET = 0, Search = 0
- **Form-step counts**: create=1, negative-create=14
- **Variants**: happy-path=1, bad-request=14

| form step | variants | file:line | test name |
|--|--|--|--|
| create | happy-path | `createAdminUser.feature.spec.ts:11` | feature-1 - createAdminUser - base (1) |
| negative-create | bad-request | `request-validation/unsecured/setup-validation-api-tests.spec.ts:18` | createAdminUser - Additional prop __unexpectedField |
| negative-create | bad-request | `request-validation/unsecured/setup-validation-api-tests.spec.ts:37` | createAdminUser - Body wrong top-level type |
| negative-create | bad-request | `request-validation/unsecured/setup-validation-api-tests.spec.ts:52` | createAdminUser - Param password wrong type (#1) |
| negative-create | bad-request | `request-validation/unsecured/setup-validation-api-tests.spec.ts:70` | createAdminUser - Param password wrong type (#2) |
| negative-create | bad-request | `request-validation/unsecured/setup-validation-api-tests.spec.ts:88` | createAdminUser - Param username wrong type (#1) |
| negative-create | bad-request | `request-validation/unsecured/setup-validation-api-tests.spec.ts:106` | createAdminUser - Param username wrong type (#2) |
| negative-create | bad-request | `request-validation/unsecured/setup-validation-api-tests.spec.ts:124` | createAdminUser - Constraint violation username (#1) |
| negative-create | bad-request | `request-validation/unsecured/setup-validation-api-tests.spec.ts:143` | createAdminUser - Constraint violation username (#2) |
| negative-create | bad-request | `request-validation/unsecured/setup-validation-api-tests.spec.ts:161` | createAdminUser - Constraint violation username (#3) |
| negative-create | bad-request | `request-validation/unsecured/setup-validation-api-tests.spec.ts:179` | createAdminUser - Constraint violation username (#4) |
| negative-create | bad-request | `request-validation/unsecured/setup-validation-api-tests.spec.ts:198` | createAdminUser - Missing password |
| negative-create | bad-request | `request-validation/unsecured/setup-validation-api-tests.spec.ts:215` | createAdminUser - Missing username |
| negative-create | bad-request | `request-validation/unsecured/setup-validation-api-tests.spec.ts:232` | createAdminUser - Missing body |
| negative-create | bad-request | `request-validation/unsecured/setup-validation-api-tests.spec.ts:244` | createAdminUser - Missing combo username,password |

### `system` — 9 tests

- **Prerequisite to create**: none
- **Files**: `getSystemConfiguration.feature.spec.ts`, `getUsageMetrics.feature.spec.ts`, `request-validation/unsecured/system-validation-api-tests.spec.ts`
- **Observation channel**: GET = 2, Search = 0
- **Form-step counts**: observe-present-get=2, negative-get=7
- **Variants**: happy-path=2, bad-request=7

| form step | variants | file:line | test name |
|--|--|--|--|
| observe-present-get | happy-path | `getSystemConfiguration.feature.spec.ts:11` | feature-1 - getSystemConfiguration - base (1) |
| observe-present-get | happy-path | `getUsageMetrics.feature.spec.ts:12` | feature-1 - getUsageMetrics - base (1) |
| negative-get | bad-request | `request-validation/unsecured/system-validation-api-tests.spec.ts:18` | getUsageMetrics - Query param tenantId pattern violation |
| negative-get | bad-request | `request-validation/unsecured/system-validation-api-tests.spec.ts:32` | getUsageMetrics - Missing param query.endTime |
| negative-get | bad-request | `request-validation/unsecured/system-validation-api-tests.spec.ts:48` | getUsageMetrics - Missing param query.startTime |
| negative-get | bad-request | `request-validation/unsecured/system-validation-api-tests.spec.ts:64` | getUsageMetrics - Param query.endTime wrong type |
| negative-get | bad-request | `request-validation/unsecured/system-validation-api-tests.spec.ts:81` | getUsageMetrics - Param query.startTime wrong type |
| negative-get | bad-request | `request-validation/unsecured/system-validation-api-tests.spec.ts:98` | getUsageMetrics - Param query.tenantId wrong type |
| negative-get | bad-request | `request-validation/unsecured/system-validation-api-tests.spec.ts:115` | getUsageMetrics - Param query.withTenants wrong type |

### `clock` — 8 tests

- **Prerequisite to create**: none
- **Files**: `pinClock.feature.spec.ts`, `request-validation/unsecured/clock-validation-api-tests.spec.ts`, `resetClock.feature.spec.ts`
- **Observation channel**: GET = 0, Search = 0
- **Form-step counts**: create=1, mutate=1, negative-create=6
- **Variants**: happy-path=2, bad-request=6

| form step | variants | file:line | test name |
|--|--|--|--|
| create | happy-path | `pinClock.feature.spec.ts:8` | feature-1 - pinClock - base (1) |
| mutate | happy-path | `resetClock.feature.spec.ts:8` | feature-1 - resetClock - base (1) |
| negative-create | bad-request | `request-validation/unsecured/clock-validation-api-tests.spec.ts:18` | pinClock - Additional prop __unexpectedField |
| negative-create | bad-request | `request-validation/unsecured/clock-validation-api-tests.spec.ts:36` | pinClock - Body wrong top-level type |
| negative-create | bad-request | `request-validation/unsecured/clock-validation-api-tests.spec.ts:51` | pinClock - Param timestamp wrong type (#1) |
| negative-create | bad-request | `request-validation/unsecured/clock-validation-api-tests.spec.ts:68` | pinClock - Param timestamp wrong type (#2) |
| negative-create | bad-request | `request-validation/unsecured/clock-validation-api-tests.spec.ts:85` | pinClock - Missing timestamp |
| negative-create | bad-request | `request-validation/unsecured/clock-validation-api-tests.spec.ts:100` | pinClock - Missing body |

### `authentication` — 1 tests

- **Prerequisite to create**: authenticated-user
- **Files**: `getAuthentication.feature.spec.ts`
- **Observation channel**: GET = 1, Search = 0
- **Form-step counts**: observe-present-get=1
- **Variants**: happy-path=1

| form step | variants | file:line | test name |
|--|--|--|--|
| observe-present-get | happy-path | `getAuthentication.feature.spec.ts:11` | feature-1 - getAuthentication - base (1) |

### `license` — 1 tests

- **Prerequisite to create**: none
- **Files**: `getLicense.feature.spec.ts`
- **Observation channel**: GET = 1, Search = 0
- **Form-step counts**: observe-present-get=1
- **Variants**: happy-path=1

| form step | variants | file:line | test name |
|--|--|--|--|
| observe-present-get | happy-path | `getLicense.feature.spec.ts:11` | feature-1 - getLicense - base (1) |

### `status` — 1 tests

- **Prerequisite to create**: none
- **Files**: `getStatus.feature.spec.ts`
- **Observation channel**: GET = 1, Search = 0
- **Form-step counts**: observe-present-get=1
- **Variants**: happy-path=1

| form step | variants | file:line | test name |
|--|--|--|--|
| observe-present-get | happy-path | `getStatus.feature.spec.ts:8` | feature-1 - getStatus - base (1) |

### `topology` — 1 tests

- **Prerequisite to create**: none
- **Files**: `getTopology.feature.spec.ts`
- **Observation channel**: GET = 1, Search = 0
- **Form-step counts**: observe-present-get=1
- **Variants**: happy-path=1

| form step | variants | file:line | test name |
|--|--|--|--|
| observe-present-get | happy-path | `getTopology.feature.spec.ts:11` | feature-1 - getTopology - base (1) |

## P. Agent-Instance (new in v2)

**Form**: New v2 endpoint family — get / search agent instances (lifecycle TBD)

**Total tests**: 50

### `agent-instance` — 50 tests

- **Prerequisite to create**: unknown
- **Files**: `createAgentInstance.feature.spec.ts`, `getAgentInstance.feature.spec.ts`, `request-validation/unsecured/agentinstances-validation-api-tests.spec.ts`, `searchAgentInstances.feature.spec.ts`, `searchAgentInstances.variant.spec.ts`, `updateAgentInstance.feature.spec.ts`
- **Observation channel**: GET = 1, Search = 8
- **Form-step counts**: create=1, observe-present-get=1, observe-present-search=8, mutate=1, observe-absence=1, negative-create=21, negative-get=2, negative-update=10, negative-search=5
- **Variants**: happy-path=4, observe-absence=1, data-driven=7, bad-request=37, not-found=1, pagination-sort=2, filter=5

| form step | variants | file:line | test name |
|--|--|--|--|
| create | happy-path | `createAgentInstance.feature.spec.ts:12` | feature-1 - createAgentInstance - base (1) |
| observe-present-get | happy-path | `getAgentInstance.feature.spec.ts:13` | feature-1 - getAgentInstance - base (1) |
| observe-present-search | happy-path | `searchAgentInstances.feature.spec.ts:12` | feature-1 - searchAgentInstances - base (1) |
| observe-present-search | data-driven, filter | `searchAgentInstances.variant.spec.ts:13` | variant-1 - searchAgentInstances - bpmn #1 |
| observe-present-search | data-driven, filter | `searchAgentInstances.variant.spec.ts:139` | variant-2 - searchAgentInstances - bpmn #1 |
| observe-present-search | data-driven, filter | `searchAgentInstances.variant.spec.ts:237` | variant-3 - searchAgentInstances - bpmn #1 |
| observe-present-search | data-driven, filter | `searchAgentInstances.variant.spec.ts:304` | variant-4 - searchAgentInstances - bpmn #1 |
| observe-present-search | data-driven, filter | `searchAgentInstances.variant.spec.ts:353` | variant-5 - searchAgentInstances - bpmn #1 |
| observe-present-search | data-driven, pagination-sort | `searchAgentInstances.variant.spec.ts:451` | variant-6 - searchAgentInstances - path #1 |
| observe-present-search | data-driven, pagination-sort | `searchAgentInstances.variant.spec.ts:513` | variant-7 - searchAgentInstances - path #1 |
| mutate | happy-path | `updateAgentInstance.feature.spec.ts:9` | feature-1 - updateAgentInstance - base (1) |
| observe-absence | observe-absence | `searchAgentInstances.feature.spec.ts:36` | feature-2 - searchAgentInstances - negative empty (2) |
| negative-create | bad-request | `request-validation/unsecured/agentinstances-validation-api-tests.spec.ts:18` | createAgentInstance - Additional prop __extraField |
| negative-create | bad-request | `request-validation/unsecured/agentinstances-validation-api-tests.spec.ts:41` | createAgentInstance - Body wrong top-level type |
| negative-create | bad-request | `request-validation/unsecured/agentinstances-validation-api-tests.spec.ts:56` | createAgentInstance - Param definition.model wrong type (#1) |
| negative-create | bad-request | `request-validation/unsecured/agentinstances-validation-api-tests.spec.ts:80` | createAgentInstance - Param definition.model wrong type (#2) |
| negative-create | bad-request | `request-validation/unsecured/agentinstances-validation-api-tests.spec.ts:104` | createAgentInstance - Param definition.provider wrong type (#1) |
| negative-create | bad-request | `request-validation/unsecured/agentinstances-validation-api-tests.spec.ts:128` | createAgentInstance - Param definition.provider wrong type (#2) |
| negative-create | bad-request | `request-validation/unsecured/agentinstances-validation-api-tests.spec.ts:152` | createAgentInstance - Param definition.systemPrompt wrong type (#1) |
| negative-create | bad-request | `request-validation/unsecured/agentinstances-validation-api-tests.spec.ts:176` | createAgentInstance - Param definition.systemPrompt wrong type (#2) |
| negative-create | bad-request | `request-validation/unsecured/agentinstances-validation-api-tests.spec.ts:200` | createAgentInstance - Param elementInstanceKey wrong type (#1) |
| negative-create | bad-request | `request-validation/unsecured/agentinstances-validation-api-tests.spec.ts:224` | createAgentInstance - Param elementInstanceKey wrong type (#2) |
| negative-create | bad-request | `request-validation/unsecured/agentinstances-validation-api-tests.spec.ts:248` | createAgentInstance - Missing definition.model |
| negative-create | bad-request | `request-validation/unsecured/agentinstances-validation-api-tests.spec.ts:269` | createAgentInstance - Missing definition.provider |
| negative-create | bad-request | `request-validation/unsecured/agentinstances-validation-api-tests.spec.ts:290` | createAgentInstance - Missing definition.systemPrompt |
| negative-create | bad-request | `request-validation/unsecured/agentinstances-validation-api-tests.spec.ts:311` | createAgentInstance - Missing elementInstanceKey (#1) |
| negative-create | bad-request | `request-validation/unsecured/agentinstances-validation-api-tests.spec.ts:332` | createAgentInstance - Missing limits.maxModelCalls |
| negative-create | bad-request | `request-validation/unsecured/agentinstances-validation-api-tests.spec.ts:358` | createAgentInstance - Missing limits.maxTokens |
| negative-create | bad-request | `request-validation/unsecured/agentinstances-validation-api-tests.spec.ts:384` | createAgentInstance - Missing limits.maxToolCalls |
| negative-create | bad-request | `request-validation/unsecured/agentinstances-validation-api-tests.spec.ts:410` | createAgentInstance - Missing definition |
| negative-create | bad-request | `request-validation/unsecured/agentinstances-validation-api-tests.spec.ts:427` | createAgentInstance - Missing elementInstanceKey (#2) |
| negative-create | bad-request | `request-validation/unsecured/agentinstances-validation-api-tests.spec.ts:444` | createAgentInstance - Missing body |
| negative-create | bad-request | `request-validation/unsecured/agentinstances-validation-api-tests.spec.ts:456` | createAgentInstance - Missing combo elementInstanceKey,definition |
| negative-get | not-found | `request-validation/unsecured/agentinstances-validation-api-tests.spec.ts:473` | getAgentInstance - Nonexistent agentInstanceKey returns 404 |
| negative-get | bad-request | `request-validation/unsecured/agentinstances-validation-api-tests.spec.ts:489` | getAgentInstance - Path param agentInstanceKey pattern violation |
| negative-update | bad-request | `request-validation/unsecured/agentinstances-validation-api-tests.spec.ts:598` | updateAgentInstance - Additional prop __extraField |
| negative-update | bad-request | `request-validation/unsecured/agentinstances-validation-api-tests.spec.ts:618` | updateAgentInstance - Body wrong top-level type |
| negative-update | bad-request | `request-validation/unsecured/agentinstances-validation-api-tests.spec.ts:635` | updateAgentInstance - Param status wrong type (#1) |
| negative-update | bad-request | `request-validation/unsecured/agentinstances-validation-api-tests.spec.ts:654` | updateAgentInstance - Param status wrong type (#2) |
| negative-update | bad-request | `request-validation/unsecured/agentinstances-validation-api-tests.spec.ts:673` | updateAgentInstance - Missing tools.0.description |
| negative-update | bad-request | `request-validation/unsecured/agentinstances-validation-api-tests.spec.ts:697` | updateAgentInstance - Missing tools.0.elementId |
| negative-update | bad-request | `request-validation/unsecured/agentinstances-validation-api-tests.spec.ts:721` | updateAgentInstance - Missing tools.0.name |
| negative-update | bad-request | `request-validation/unsecured/agentinstances-validation-api-tests.spec.ts:745` | updateAgentInstance - Enum violation status |
| negative-update | bad-request | `request-validation/unsecured/agentinstances-validation-api-tests.spec.ts:764` | updateAgentInstance - Missing body |
| negative-update | bad-request | `request-validation/unsecured/agentinstances-validation-api-tests.spec.ts:778` | updateAgentInstance - Path param agentInstanceKey pattern violation |
| negative-search | bad-request | `request-validation/unsecured/agentinstances-validation-api-tests.spec.ts:505` | searchAgentInstances - Additional prop __unexpectedField |
| negative-search | bad-request | `request-validation/unsecured/agentinstances-validation-api-tests.spec.ts:524` | searchAgentInstances - Body wrong top-level type |
| negative-search | bad-request | `request-validation/unsecured/agentinstances-validation-api-tests.spec.ts:539` | searchAgentInstances - Missing sort.0.field |
| negative-search | bad-request | `request-validation/unsecured/agentinstances-validation-api-tests.spec.ts:556` | searchAgentInstances - Enum violation sort.0.field |
| negative-search | bad-request | `request-validation/unsecured/agentinstances-validation-api-tests.spec.ts:577` | searchAgentInstances - Enum violation sort.0.order |

