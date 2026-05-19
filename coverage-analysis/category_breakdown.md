# api-test-generator — Per-category breakdown

Total test declarations: **1607** across **37** entities.

This file answers, per category: **(1) Form** (the canonical sequence), **(2) Prerequisite to create**, **(3) Observation channel split** (GET vs Search), **(4) Variants with counts**, **(5) The actual tests in that category**.

Categories and the entity → category mapping mirror the upstream `c8-orchestration-cluster-e2e-test-suite/coverage-analysis/category_breakdown.md` so the two files can be diffed side-by-side.

## Table of contents

- [A. Entity Lifecycle (CRUD)](#a-entity-lifecycle-crud) — 351 tests
- [B. Membership/Association](#b-membershipassociation) — 206 tests
- [C. Deployment Lifecycle](#c-deployment-lifecycle) — 149 tests
- [D. Process-Instance Lifecycle & Ops](#d-process-instance-lifecycle--ops) — 282 tests
- [E. Batch-Operation Lifecycle](#e-batch-operation-lifecycle) — 24 tests
- [F. User-Task Lifecycle](#f-user-task-lifecycle) — 65 tests
- [G. Job Lifecycle & Stats](#g-job-lifecycle--stats) — 142 tests
- [H. Incident Lifecycle](#h-incident-lifecycle) — 41 tests
- [I. Decision-Instance Lifecycle](#i-decision-instance-lifecycle) — 72 tests
- [J/K/L. Observation-only](#jkl-observation-only) — 95 tests
- [M. Messaging/Signals](#m-messagingsignals) — 70 tests
- [N. Engine Evaluation](#n-engine-evaluation) — 25 tests
- [O. System/Admin](#o-systemadmin) — 36 tests
- [P. Agent-Instance (new in v2)](#p-agent-instance-new-in-v2) — 49 tests

## A. Entity Lifecycle (CRUD)

**Form**: Create Entity → Get Entity (Observe Present) → Update Entity → Search Entity (Observe via list) → Delete Entity → Get Entity (Observe Absence)

**Total tests**: 351

### `cluster-variables` — 60 tests

- **Prerequisite to create**: none
- **Files**: `createGlobalClusterVariable.feature.spec.ts`, `createTenantClusterVariable.feature.spec.ts`, `deleteGlobalClusterVariable.feature.spec.ts`, `deleteTenantClusterVariable.feature.spec.ts`, `getGlobalClusterVariable.feature.spec.ts`, `getTenantClusterVariable.feature.spec.ts`, `request-validation/clustervariables-validation-api-tests.spec.ts`, `searchClusterVariables.feature.spec.ts`, `searchClusterVariables.variant.spec.ts`, `updateGlobalClusterVariable.feature.spec.ts`, `updateTenantClusterVariable.feature.spec.ts`
- **Observation channel**: GET = 2, Search = 3
- **Form-step counts**: create=2, observe-present-get=2, observe-present-search=3, mutate=2, delete=2, observe-absence=1, negative-create=25, negative-get=3, negative-update=11, negative-delete=3, negative-search=6
- **Variants**: happy-path=9, observe-absence=1, data-driven=2, bad-request=48

| form step | variants | file:line | test name |
|--|--|--|--|
| create | happy-path | `createGlobalClusterVariable.feature.spec.ts:11` | feature-1 - createGlobalClusterVariable - base (1) |
| create | happy-path | `createTenantClusterVariable.feature.spec.ts:11` | feature-1 - createTenantClusterVariable - base (1) |
| observe-present-get | happy-path | `getGlobalClusterVariable.feature.spec.ts:12` | feature-1 - getGlobalClusterVariable - base (1) |
| observe-present-get | happy-path | `getTenantClusterVariable.feature.spec.ts:12` | feature-1 - getTenantClusterVariable - base (1) |
| observe-present-search | happy-path | `searchClusterVariables.feature.spec.ts:12` | feature-1 - searchClusterVariables - base (1) |
| observe-present-search | data-driven | `searchClusterVariables.variant.spec.ts:12` | variant-1 - searchClusterVariables - path #1 |
| observe-present-search | data-driven | `searchClusterVariables.variant.spec.ts:66` | variant-2 - searchClusterVariables - path #1 |
| mutate | happy-path | `updateGlobalClusterVariable.feature.spec.ts:11` | feature-1 - updateGlobalClusterVariable - base (1) |
| mutate | happy-path | `updateTenantClusterVariable.feature.spec.ts:11` | feature-1 - updateTenantClusterVariable - base (1) |
| delete | happy-path | `deleteGlobalClusterVariable.feature.spec.ts:8` | feature-1 - deleteGlobalClusterVariable - base (1) |
| delete | happy-path | `deleteTenantClusterVariable.feature.spec.ts:8` | feature-1 - deleteTenantClusterVariable - base (1) |
| observe-absence | observe-absence | `searchClusterVariables.feature.spec.ts:37` | feature-2 - searchClusterVariables - negative empty (2) |
| negative-create | bad-request | `request-validation/clustervariables-validation-api-tests.spec.ts:18` | createGlobalClusterVariable - Additional prop __extraField |
| negative-create | bad-request | `request-validation/clustervariables-validation-api-tests.spec.ts:39` | createGlobalClusterVariable - Body wrong top-level type |
| negative-create | bad-request | `request-validation/clustervariables-validation-api-tests.spec.ts:54` | createGlobalClusterVariable - Param name wrong type (#1) |
| negative-create | bad-request | `request-validation/clustervariables-validation-api-tests.spec.ts:74` | createGlobalClusterVariable - Param name wrong type (#2) |
| negative-create | bad-request | `request-validation/clustervariables-validation-api-tests.spec.ts:94` | createGlobalClusterVariable - Constraint violation name (#1) |
| negative-create | bad-request | `request-validation/clustervariables-validation-api-tests.spec.ts:114` | createGlobalClusterVariable - Constraint violation name (#2) |
| negative-create | bad-request | `request-validation/clustervariables-validation-api-tests.spec.ts:134` | createGlobalClusterVariable - Constraint violation name (#3) |
| negative-create | bad-request | `request-validation/clustervariables-validation-api-tests.spec.ts:154` | createGlobalClusterVariable - Constraint violation name (#4) |
| negative-create | bad-request | `request-validation/clustervariables-validation-api-tests.spec.ts:174` | createGlobalClusterVariable - Missing name |
| negative-create | bad-request | `request-validation/clustervariables-validation-api-tests.spec.ts:191` | createGlobalClusterVariable - Missing value |
| negative-create | bad-request | `request-validation/clustervariables-validation-api-tests.spec.ts:208` | createGlobalClusterVariable - Missing body |
| negative-create | bad-request | `request-validation/clustervariables-validation-api-tests.spec.ts:220` | createGlobalClusterVariable - Missing combo name,value |
| negative-create | bad-request | `request-validation/clustervariables-validation-api-tests.spec.ts:235` | createTenantClusterVariable - Additional prop __extraField |
| negative-create | bad-request | `request-validation/clustervariables-validation-api-tests.spec.ts:258` | createTenantClusterVariable - Body wrong top-level type |
| negative-create | bad-request | `request-validation/clustervariables-validation-api-tests.spec.ts:275` | createTenantClusterVariable - Param name wrong type (#1) |
| negative-create | bad-request | `request-validation/clustervariables-validation-api-tests.spec.ts:297` | createTenantClusterVariable - Param name wrong type (#2) |
| negative-create | bad-request | `request-validation/clustervariables-validation-api-tests.spec.ts:319` | createTenantClusterVariable - Constraint violation name (#1) |
| negative-create | bad-request | `request-validation/clustervariables-validation-api-tests.spec.ts:341` | createTenantClusterVariable - Constraint violation name (#2) |
| negative-create | bad-request | `request-validation/clustervariables-validation-api-tests.spec.ts:363` | createTenantClusterVariable - Constraint violation name (#3) |
| negative-create | bad-request | `request-validation/clustervariables-validation-api-tests.spec.ts:385` | createTenantClusterVariable - Constraint violation name (#4) |
| negative-create | bad-request | `request-validation/clustervariables-validation-api-tests.spec.ts:407` | createTenantClusterVariable - Missing name |
| negative-create | bad-request | `request-validation/clustervariables-validation-api-tests.spec.ts:426` | createTenantClusterVariable - Missing value |
| negative-create | bad-request | `request-validation/clustervariables-validation-api-tests.spec.ts:445` | createTenantClusterVariable - Missing body |
| negative-create | bad-request | `request-validation/clustervariables-validation-api-tests.spec.ts:459` | createTenantClusterVariable - Missing combo name,value |
| negative-create | bad-request | `request-validation/clustervariables-validation-api-tests.spec.ts:476` | createTenantClusterVariable - Path param tenantId pattern violation |
| negative-get | bad-request | `request-validation/clustervariables-validation-api-tests.spec.ts:540` | getGlobalClusterVariable - Path param name pattern violation |
| negative-get | bad-request | `request-validation/clustervariables-validation-api-tests.spec.ts:554` | getTenantClusterVariable - Path param name pattern violation |
| negative-get | bad-request | `request-validation/clustervariables-validation-api-tests.spec.ts:571` | getTenantClusterVariable - Path param tenantId pattern violation |
| negative-update | bad-request | `request-validation/clustervariables-validation-api-tests.spec.ts:697` | updateGlobalClusterVariable - Additional prop __extraField |
| negative-update | bad-request | `request-validation/clustervariables-validation-api-tests.spec.ts:717` | updateGlobalClusterVariable - Body wrong top-level type |
| negative-update | bad-request | `request-validation/clustervariables-validation-api-tests.spec.ts:732` | updateGlobalClusterVariable - Missing value |
| negative-update | bad-request | `request-validation/clustervariables-validation-api-tests.spec.ts:747` | updateGlobalClusterVariable - Missing body |
| negative-update | bad-request | `request-validation/clustervariables-validation-api-tests.spec.ts:759` | updateGlobalClusterVariable - Path param name pattern violation |
| negative-update | bad-request | `request-validation/clustervariables-validation-api-tests.spec.ts:773` | updateTenantClusterVariable - Additional prop __extraField |
| negative-update | bad-request | `request-validation/clustervariables-validation-api-tests.spec.ts:796` | updateTenantClusterVariable - Body wrong top-level type |
| negative-update | bad-request | `request-validation/clustervariables-validation-api-tests.spec.ts:814` | updateTenantClusterVariable - Missing value |
| negative-update | bad-request | `request-validation/clustervariables-validation-api-tests.spec.ts:832` | updateTenantClusterVariable - Missing body |
| negative-update | bad-request | `request-validation/clustervariables-validation-api-tests.spec.ts:847` | updateTenantClusterVariable - Path param name pattern violation |
| negative-update | bad-request | `request-validation/clustervariables-validation-api-tests.spec.ts:864` | updateTenantClusterVariable - Path param tenantId pattern violation |
| negative-delete | bad-request | `request-validation/clustervariables-validation-api-tests.spec.ts:492` | deleteGlobalClusterVariable - Path param name pattern violation |
| negative-delete | bad-request | `request-validation/clustervariables-validation-api-tests.spec.ts:506` | deleteTenantClusterVariable - Path param name pattern violation |
| negative-delete | bad-request | `request-validation/clustervariables-validation-api-tests.spec.ts:523` | deleteTenantClusterVariable - Path param tenantId pattern violation |
| negative-search | bad-request | `request-validation/clustervariables-validation-api-tests.spec.ts:588` | searchClusterVariables - Additional prop __unexpectedField |
| negative-search | bad-request | `request-validation/clustervariables-validation-api-tests.spec.ts:607` | searchClusterVariables - Body wrong top-level type |
| negative-search | bad-request | `request-validation/clustervariables-validation-api-tests.spec.ts:622` | searchClusterVariables - Missing sort.0.field |
| negative-search | bad-request | `request-validation/clustervariables-validation-api-tests.spec.ts:639` | searchClusterVariables - Enum violation sort.0.field |
| negative-search | bad-request | `request-validation/clustervariables-validation-api-tests.spec.ts:660` | searchClusterVariables - Enum violation sort.0.order |
| negative-search | bad-request | `request-validation/clustervariables-validation-api-tests.spec.ts:681` | searchClusterVariables - Param query.truncateValues wrong type |

### `mapping-rule` — 48 tests

- **Prerequisite to create**: none
- **Files**: `createMappingRule.feature.spec.ts`, `deleteMappingRule.feature.spec.ts`, `getMappingRule.feature.spec.ts`, `request-validation/mappingrules-validation-api-tests.spec.ts`, `searchMappingRule.feature.spec.ts`, `searchMappingRule.variant.spec.ts`, `updateMappingRule.feature.spec.ts`
- **Observation channel**: GET = 1, Search = 4
- **Form-step counts**: create=1, observe-present-get=1, observe-present-search=4, mutate=1, delete=1, observe-absence=1, negative-create=20, negative-get=1, negative-update=12, negative-delete=1, negative-search=5
- **Variants**: happy-path=5, observe-absence=1, data-driven=3, bad-request=39

| form step | variants | file:line | test name |
|--|--|--|--|
| create | happy-path | `createMappingRule.feature.spec.ts:11` | feature-1 - createMappingRule - base (1) |
| observe-present-get | happy-path | `getMappingRule.feature.spec.ts:12` | feature-1 - getMappingRule - base (1) |
| observe-present-search | happy-path | `searchMappingRule.feature.spec.ts:12` | feature-1 - searchMappingRule - base (1) |
| observe-present-search | data-driven | `searchMappingRule.variant.spec.ts:12` | variant-1 - searchMappingRule - path #1 |
| observe-present-search | data-driven | `searchMappingRule.variant.spec.ts:107` | variant-2 - searchMappingRule - path #1 |
| observe-present-search | data-driven | `searchMappingRule.variant.spec.ts:161` | variant-3 - searchMappingRule - path #1 |
| mutate | happy-path | `updateMappingRule.feature.spec.ts:11` | feature-1 - updateMappingRule - base (1) |
| delete | happy-path | `deleteMappingRule.feature.spec.ts:8` | feature-1 - deleteMappingRule - base (1) |
| observe-absence | observe-absence | `searchMappingRule.feature.spec.ts:37` | feature-2 - searchMappingRule - negative empty (2) |
| negative-create | bad-request | `request-validation/mappingrules-validation-api-tests.spec.ts:18` | createMappingRule - Additional prop __unexpectedField |
| negative-create | bad-request | `request-validation/mappingrules-validation-api-tests.spec.ts:39` | createMappingRule - Body wrong top-level type |
| negative-create | bad-request | `request-validation/mappingrules-validation-api-tests.spec.ts:54` | createMappingRule - Param claimName wrong type (#1) |
| negative-create | bad-request | `request-validation/mappingrules-validation-api-tests.spec.ts:74` | createMappingRule - Param claimName wrong type (#2) |
| negative-create | bad-request | `request-validation/mappingrules-validation-api-tests.spec.ts:94` | createMappingRule - Param claimValue wrong type (#1) |
| negative-create | bad-request | `request-validation/mappingrules-validation-api-tests.spec.ts:114` | createMappingRule - Param claimValue wrong type (#2) |
| negative-create | bad-request | `request-validation/mappingrules-validation-api-tests.spec.ts:134` | createMappingRule - Param mappingRuleId wrong type (#1) |
| negative-create | bad-request | `request-validation/mappingrules-validation-api-tests.spec.ts:154` | createMappingRule - Param mappingRuleId wrong type (#2) |
| negative-create | bad-request | `request-validation/mappingrules-validation-api-tests.spec.ts:174` | createMappingRule - Param name wrong type (#1) |
| negative-create | bad-request | `request-validation/mappingrules-validation-api-tests.spec.ts:194` | createMappingRule - Param name wrong type (#2) |
| negative-create | bad-request | `request-validation/mappingrules-validation-api-tests.spec.ts:214` | createMappingRule - Constraint violation mappingRuleId (#1) |
| negative-create | bad-request | `request-validation/mappingrules-validation-api-tests.spec.ts:237` | createMappingRule - Constraint violation mappingRuleId (#2) |
| negative-create | bad-request | `request-validation/mappingrules-validation-api-tests.spec.ts:259` | createMappingRule - Constraint violation mappingRuleId (#3) |
| negative-create | bad-request | `request-validation/mappingrules-validation-api-tests.spec.ts:281` | createMappingRule - Constraint violation mappingRuleId (#4) |
| negative-create | bad-request | `request-validation/mappingrules-validation-api-tests.spec.ts:304` | createMappingRule - Missing claimName |
| negative-create | bad-request | `request-validation/mappingrules-validation-api-tests.spec.ts:323` | createMappingRule - Missing claimValue |
| negative-create | bad-request | `request-validation/mappingrules-validation-api-tests.spec.ts:342` | createMappingRule - Missing mappingRuleId (#1) |
| negative-create | bad-request | `request-validation/mappingrules-validation-api-tests.spec.ts:361` | createMappingRule - Missing name |
| negative-create | bad-request | `request-validation/mappingrules-validation-api-tests.spec.ts:380` | createMappingRule - Missing mappingRuleId (#2) |
| negative-create | bad-request | `request-validation/mappingrules-validation-api-tests.spec.ts:395` | createMappingRule - Missing body |
| negative-get | bad-request | `request-validation/mappingrules-validation-api-tests.spec.ts:423` | getMappingRule - Path param mappingRuleId pattern violation |
| negative-update | bad-request | `request-validation/mappingrules-validation-api-tests.spec.ts:530` | updateMappingRule - Additional prop __extraField |
| negative-update | bad-request | `request-validation/mappingrules-validation-api-tests.spec.ts:552` | updateMappingRule - Body wrong top-level type |
| negative-update | bad-request | `request-validation/mappingrules-validation-api-tests.spec.ts:569` | updateMappingRule - Param claimName wrong type (#1) |
| negative-update | bad-request | `request-validation/mappingrules-validation-api-tests.spec.ts:590` | updateMappingRule - Param claimName wrong type (#2) |
| negative-update | bad-request | `request-validation/mappingrules-validation-api-tests.spec.ts:611` | updateMappingRule - Param claimValue wrong type (#1) |
| negative-update | bad-request | `request-validation/mappingrules-validation-api-tests.spec.ts:632` | updateMappingRule - Param claimValue wrong type (#2) |
| negative-update | bad-request | `request-validation/mappingrules-validation-api-tests.spec.ts:653` | updateMappingRule - Param name wrong type (#1) |
| negative-update | bad-request | `request-validation/mappingrules-validation-api-tests.spec.ts:674` | updateMappingRule - Param name wrong type (#2) |
| negative-update | bad-request | `request-validation/mappingrules-validation-api-tests.spec.ts:695` | updateMappingRule - Missing claimName |
| negative-update | bad-request | `request-validation/mappingrules-validation-api-tests.spec.ts:715` | updateMappingRule - Missing claimValue |
| negative-update | bad-request | `request-validation/mappingrules-validation-api-tests.spec.ts:735` | updateMappingRule - Missing name |
| negative-update | bad-request | `request-validation/mappingrules-validation-api-tests.spec.ts:755` | updateMappingRule - Path param mappingRuleId pattern violation |
| negative-delete | bad-request | `request-validation/mappingrules-validation-api-tests.spec.ts:407` | deleteMappingRule - Path param mappingRuleId pattern violation |
| negative-search | bad-request | `request-validation/mappingrules-validation-api-tests.spec.ts:439` | searchMappingRule - Additional prop __unexpectedField |
| negative-search | bad-request | `request-validation/mappingrules-validation-api-tests.spec.ts:456` | searchMappingRule - Body wrong top-level type |
| negative-search | bad-request | `request-validation/mappingrules-validation-api-tests.spec.ts:471` | searchMappingRule - Missing sort.0.field |
| negative-search | bad-request | `request-validation/mappingrules-validation-api-tests.spec.ts:488` | searchMappingRule - Enum violation sort.0.field |
| negative-search | bad-request | `request-validation/mappingrules-validation-api-tests.spec.ts:509` | searchMappingRule - Enum violation sort.0.order |

### `global-task-listener` — 47 tests

- **Prerequisite to create**: none
- **Files**: `createGlobalTaskListener.feature.spec.ts`, `deleteGlobalTaskListener.feature.spec.ts`, `getGlobalTaskListener.feature.spec.ts`, `request-validation/globaltasklisteners-validation-api-tests.spec.ts`, `searchGlobalTaskListeners.feature.spec.ts`, `searchGlobalTaskListeners.variant.spec.ts`, `updateGlobalTaskListener.feature.spec.ts`
- **Observation channel**: GET = 1, Search = 3
- **Form-step counts**: create=1, observe-present-get=1, observe-present-search=3, mutate=1, delete=1, observe-absence=1, negative-create=21, negative-get=1, negative-update=11, negative-delete=1, negative-search=5
- **Variants**: happy-path=5, observe-absence=1, data-driven=2, bad-request=39

| form step | variants | file:line | test name |
|--|--|--|--|
| create | happy-path | `createGlobalTaskListener.feature.spec.ts:11` | feature-1 - createGlobalTaskListener - base (1) |
| observe-present-get | happy-path | `getGlobalTaskListener.feature.spec.ts:12` | feature-1 - getGlobalTaskListener - base (1) |
| observe-present-search | happy-path | `searchGlobalTaskListeners.feature.spec.ts:12` | feature-1 - searchGlobalTaskListeners - base (1) |
| observe-present-search | data-driven | `searchGlobalTaskListeners.variant.spec.ts:12` | variant-1 - searchGlobalTaskListeners - path #1 |
| observe-present-search | data-driven | `searchGlobalTaskListeners.variant.spec.ts:66` | variant-2 - searchGlobalTaskListeners - path #1 |
| mutate | happy-path | `updateGlobalTaskListener.feature.spec.ts:11` | feature-1 - updateGlobalTaskListener - base (1) |
| delete | happy-path | `deleteGlobalTaskListener.feature.spec.ts:8` | feature-1 - deleteGlobalTaskListener - base (1) |
| observe-absence | observe-absence | `searchGlobalTaskListeners.feature.spec.ts:37` | feature-2 - searchGlobalTaskListeners - negative empty (2) |
| negative-create | bad-request | `request-validation/globaltasklisteners-validation-api-tests.spec.ts:18` | createGlobalTaskListener - Additional prop __extraField |
| negative-create | bad-request | `request-validation/globaltasklisteners-validation-api-tests.spec.ts:38` | createGlobalTaskListener - Body wrong top-level type |
| negative-create | bad-request | `request-validation/globaltasklisteners-validation-api-tests.spec.ts:53` | createGlobalTaskListener - Param id wrong type (#1) |
| negative-create | bad-request | `request-validation/globaltasklisteners-validation-api-tests.spec.ts:72` | createGlobalTaskListener - Param id wrong type (#2) |
| negative-create | bad-request | `request-validation/globaltasklisteners-validation-api-tests.spec.ts:91` | createGlobalTaskListener - Param type wrong type (#1) |
| negative-create | bad-request | `request-validation/globaltasklisteners-validation-api-tests.spec.ts:110` | createGlobalTaskListener - Param type wrong type (#2) |
| negative-create | bad-request | `request-validation/globaltasklisteners-validation-api-tests.spec.ts:129` | createGlobalTaskListener - Constraint violation id (#1) |
| negative-create | bad-request | `request-validation/globaltasklisteners-validation-api-tests.spec.ts:148` | createGlobalTaskListener - Constraint violation id (#2) |
| negative-create | bad-request | `request-validation/globaltasklisteners-validation-api-tests.spec.ts:167` | createGlobalTaskListener - Constraint violation id (#3) |
| negative-create | bad-request | `request-validation/globaltasklisteners-validation-api-tests.spec.ts:186` | createGlobalTaskListener - Constraint violation id (#4) |
| negative-create | bad-request | `request-validation/globaltasklisteners-validation-api-tests.spec.ts:205` | createGlobalTaskListener - Missing id (#1) |
| negative-create | bad-request | `request-validation/globaltasklisteners-validation-api-tests.spec.ts:223` | createGlobalTaskListener - Missing type (#1) |
| negative-create | bad-request | `request-validation/globaltasklisteners-validation-api-tests.spec.ts:241` | createGlobalTaskListener - Enum violation eventTypes.0 |
| negative-create | bad-request | `request-validation/globaltasklisteners-validation-api-tests.spec.ts:260` | createGlobalTaskListener - Missing eventTypes |
| negative-create | bad-request | `request-validation/globaltasklisteners-validation-api-tests.spec.ts:278` | createGlobalTaskListener - Missing id (#2) |
| negative-create | bad-request | `request-validation/globaltasklisteners-validation-api-tests.spec.ts:296` | createGlobalTaskListener - Missing type (#2) |
| negative-create | bad-request | `request-validation/globaltasklisteners-validation-api-tests.spec.ts:314` | createGlobalTaskListener - Missing body |
| negative-create | bad-request | `request-validation/globaltasklisteners-validation-api-tests.spec.ts:326` | createGlobalTaskListener - Missing combo id,eventTypes |
| negative-create | bad-request | `request-validation/globaltasklisteners-validation-api-tests.spec.ts:343` | createGlobalTaskListener - Missing combo id,type |
| negative-create | bad-request | `request-validation/globaltasklisteners-validation-api-tests.spec.ts:360` | createGlobalTaskListener - Missing combo id,type,eventTypes |
| negative-create | bad-request | `request-validation/globaltasklisteners-validation-api-tests.spec.ts:377` | createGlobalTaskListener - Missing combo type,eventTypes |
| negative-get | bad-request | `request-validation/globaltasklisteners-validation-api-tests.spec.ts:410` | getGlobalTaskListener - Path param id pattern violation |
| negative-update | bad-request | `request-validation/globaltasklisteners-validation-api-tests.spec.ts:515` | updateGlobalTaskListener - Additional prop __extraField |
| negative-update | bad-request | `request-validation/globaltasklisteners-validation-api-tests.spec.ts:534` | updateGlobalTaskListener - Body wrong top-level type |
| negative-update | bad-request | `request-validation/globaltasklisteners-validation-api-tests.spec.ts:549` | updateGlobalTaskListener - Param type wrong type (#1) |
| negative-update | bad-request | `request-validation/globaltasklisteners-validation-api-tests.spec.ts:567` | updateGlobalTaskListener - Param type wrong type (#2) |
| negative-update | bad-request | `request-validation/globaltasklisteners-validation-api-tests.spec.ts:585` | updateGlobalTaskListener - Missing type (#1) |
| negative-update | bad-request | `request-validation/globaltasklisteners-validation-api-tests.spec.ts:602` | updateGlobalTaskListener - Enum violation eventTypes.0 |
| negative-update | bad-request | `request-validation/globaltasklisteners-validation-api-tests.spec.ts:620` | updateGlobalTaskListener - Missing eventTypes |
| negative-update | bad-request | `request-validation/globaltasklisteners-validation-api-tests.spec.ts:637` | updateGlobalTaskListener - Missing type (#2) |
| negative-update | bad-request | `request-validation/globaltasklisteners-validation-api-tests.spec.ts:654` | updateGlobalTaskListener - Missing body |
| negative-update | bad-request | `request-validation/globaltasklisteners-validation-api-tests.spec.ts:666` | updateGlobalTaskListener - Missing combo type,eventTypes |
| negative-update | bad-request | `request-validation/globaltasklisteners-validation-api-tests.spec.ts:683` | updateGlobalTaskListener - Path param id pattern violation |
| negative-delete | bad-request | `request-validation/globaltasklisteners-validation-api-tests.spec.ts:396` | deleteGlobalTaskListener - Path param id pattern violation |
| negative-search | bad-request | `request-validation/globaltasklisteners-validation-api-tests.spec.ts:422` | searchGlobalTaskListeners - Additional prop __unexpectedField |
| negative-search | bad-request | `request-validation/globaltasklisteners-validation-api-tests.spec.ts:441` | searchGlobalTaskListeners - Body wrong top-level type |
| negative-search | bad-request | `request-validation/globaltasklisteners-validation-api-tests.spec.ts:456` | searchGlobalTaskListeners - Missing sort.0.field |
| negative-search | bad-request | `request-validation/globaltasklisteners-validation-api-tests.spec.ts:473` | searchGlobalTaskListeners - Enum violation sort.0.field |
| negative-search | bad-request | `request-validation/globaltasklisteners-validation-api-tests.spec.ts:494` | searchGlobalTaskListeners - Enum violation sort.0.order |

### `tenant` — 37 tests

- **Prerequisite to create**: none
- **Files**: `createTenant.feature.spec.ts`, `deleteTenant.feature.spec.ts`, `getTenant.feature.spec.ts`, `request-validation/tenants-validation-api-tests.spec.ts`, `searchTenants.feature.spec.ts`, `searchTenants.variant.spec.ts`, `updateTenant.feature.spec.ts`
- **Observation channel**: GET = 1, Search = 4
- **Form-step counts**: create=1, observe-present-get=1, observe-present-search=4, mutate=1, delete=1, observe-absence=1, negative-create=14, negative-get=1, negative-update=7, negative-delete=1, negative-search=5
- **Variants**: happy-path=5, observe-absence=1, data-driven=3, bad-request=28

| form step | variants | file:line | test name |
|--|--|--|--|
| create | happy-path | `createTenant.feature.spec.ts:11` | feature-1 - createTenant - base (1) |
| observe-present-get | happy-path | `getTenant.feature.spec.ts:12` | feature-1 - getTenant - base (1) |
| observe-present-search | happy-path | `searchTenants.feature.spec.ts:12` | feature-1 - searchTenants - base (1) |
| observe-present-search | data-driven | `searchTenants.variant.spec.ts:12` | variant-1 - searchTenants - path #1 |
| observe-present-search | data-driven | `searchTenants.variant.spec.ts:63` | variant-2 - searchTenants - path #1 |
| observe-present-search | data-driven | `searchTenants.variant.spec.ts:115` | variant-3 - searchTenants - path #1 |
| mutate | happy-path | `updateTenant.feature.spec.ts:11` | feature-1 - updateTenant - base (1) |
| delete | happy-path | `deleteTenant.feature.spec.ts:8` | feature-1 - deleteTenant - base (1) |
| observe-absence | observe-absence | `searchTenants.feature.spec.ts:35` | feature-2 - searchTenants - negative empty (2) |
| negative-create | bad-request | `request-validation/tenants-validation-api-tests.spec.ts:189` | createTenant - Additional prop __unexpectedField |
| negative-create | bad-request | `request-validation/tenants-validation-api-tests.spec.ts:208` | createTenant - Body wrong top-level type |
| negative-create | bad-request | `request-validation/tenants-validation-api-tests.spec.ts:223` | createTenant - Param name wrong type (#1) |
| negative-create | bad-request | `request-validation/tenants-validation-api-tests.spec.ts:241` | createTenant - Param name wrong type (#2) |
| negative-create | bad-request | `request-validation/tenants-validation-api-tests.spec.ts:259` | createTenant - Param tenantId wrong type (#1) |
| negative-create | bad-request | `request-validation/tenants-validation-api-tests.spec.ts:277` | createTenant - Param tenantId wrong type (#2) |
| negative-create | bad-request | `request-validation/tenants-validation-api-tests.spec.ts:295` | createTenant - Constraint violation tenantId (#1) |
| negative-create | bad-request | `request-validation/tenants-validation-api-tests.spec.ts:313` | createTenant - Constraint violation tenantId (#2) |
| negative-create | bad-request | `request-validation/tenants-validation-api-tests.spec.ts:331` | createTenant - Constraint violation tenantId (#3) |
| negative-create | bad-request | `request-validation/tenants-validation-api-tests.spec.ts:349` | createTenant - Constraint violation tenantId (#4) |
| negative-create | bad-request | `request-validation/tenants-validation-api-tests.spec.ts:367` | createTenant - Missing name |
| negative-create | bad-request | `request-validation/tenants-validation-api-tests.spec.ts:384` | createTenant - Missing tenantId |
| negative-create | bad-request | `request-validation/tenants-validation-api-tests.spec.ts:401` | createTenant - Missing body |
| negative-create | bad-request | `request-validation/tenants-validation-api-tests.spec.ts:413` | createTenant - Missing combo tenantId,name |
| negative-get | bad-request | `request-validation/tenants-validation-api-tests.spec.ts:440` | getTenant - Path param tenantId pattern violation |
| negative-update | bad-request | `request-validation/tenants-validation-api-tests.spec.ts:1273` | updateTenant - Additional prop __unexpectedField |
| negative-update | bad-request | `request-validation/tenants-validation-api-tests.spec.ts:1291` | updateTenant - Body wrong top-level type |
| negative-update | bad-request | `request-validation/tenants-validation-api-tests.spec.ts:1306` | updateTenant - Param name wrong type (#1) |
| negative-update | bad-request | `request-validation/tenants-validation-api-tests.spec.ts:1323` | updateTenant - Param name wrong type (#2) |
| negative-update | bad-request | `request-validation/tenants-validation-api-tests.spec.ts:1340` | updateTenant - Missing name |
| negative-update | bad-request | `request-validation/tenants-validation-api-tests.spec.ts:1355` | updateTenant - Missing body |
| negative-update | bad-request | `request-validation/tenants-validation-api-tests.spec.ts:1367` | updateTenant - Path param tenantId pattern violation |
| negative-delete | bad-request | `request-validation/tenants-validation-api-tests.spec.ts:428` | deleteTenant - Path param tenantId pattern violation |
| negative-search | bad-request | `request-validation/tenants-validation-api-tests.spec.ts:902` | searchTenants - Additional prop __unexpectedField |
| negative-search | bad-request | `request-validation/tenants-validation-api-tests.spec.ts:919` | searchTenants - Body wrong top-level type |
| negative-search | bad-request | `request-validation/tenants-validation-api-tests.spec.ts:934` | searchTenants - Missing sort.0.field |
| negative-search | bad-request | `request-validation/tenants-validation-api-tests.spec.ts:951` | searchTenants - Enum violation sort.0.field |
| negative-search | bad-request | `request-validation/tenants-validation-api-tests.spec.ts:972` | searchTenants - Enum violation sort.0.order |

### `authorization` — 36 tests

- **Prerequisite to create**: owner-entity-or-resource
- **Files**: `createAuthorization.feature.spec.ts`, `deleteAuthorization.feature.spec.ts`, `getAuthorization.feature.spec.ts`, `request-validation/authorizations-validation-api-tests.spec.ts`, `searchAuthorizations.feature.spec.ts`, `searchAuthorizations.variant.spec.ts`, `updateAuthorization.feature.spec.ts`
- **Observation channel**: GET = 1, Search = 3
- **Form-step counts**: create=3, observe-present-get=1, observe-present-search=3, mutate=3, delete=1, observe-absence=1, negative-create=7, negative-get=1, negative-update=8, negative-delete=1, negative-search=7
- **Variants**: happy-path=5, observe-absence=1, data-driven=6, bad-request=24

| form step | variants | file:line | test name |
|--|--|--|--|
| create | happy-path | `createAuthorization.feature.spec.ts:11` | feature-1 - createAuthorization - base (1) |
| create | data-driven | `createAuthorization.feature.spec.ts:52` | feature-2 - createAuthorization - oneOf group0 variant1 (2) |
| create | data-driven | `createAuthorization.feature.spec.ts:94` | feature-3 - createAuthorization - oneOf group0 variant2 (3) |
| observe-present-get | happy-path | `getAuthorization.feature.spec.ts:12` | feature-1 - getAuthorization - base (1) |
| observe-present-search | happy-path | `searchAuthorizations.feature.spec.ts:12` | feature-1 - searchAuthorizations - base (1) |
| observe-present-search | data-driven | `searchAuthorizations.variant.spec.ts:12` | variant-1 - searchAuthorizations - path #1 |
| observe-present-search | data-driven | `searchAuthorizations.variant.spec.ts:66` | variant-2 - searchAuthorizations - path #1 |
| mutate | happy-path | `updateAuthorization.feature.spec.ts:8` | feature-1 - updateAuthorization - base (1) |
| mutate | data-driven | `updateAuthorization.feature.spec.ts:63` | feature-2 - updateAuthorization - oneOf group0 variant1 (2) |
| mutate | data-driven | `updateAuthorization.feature.spec.ts:119` | feature-3 - updateAuthorization - oneOf group0 variant2 (3) |
| delete | happy-path | `deleteAuthorization.feature.spec.ts:8` | feature-1 - deleteAuthorization - base (1) |
| observe-absence | observe-absence | `searchAuthorizations.feature.spec.ts:37` | feature-2 - searchAuthorizations - negative empty (2) |
| negative-create | bad-request | `request-validation/authorizations-validation-api-tests.spec.ts:18` | createAuthorization - Additional prop __extraField |
| negative-create | bad-request | `request-validation/authorizations-validation-api-tests.spec.ts:35` | createAuthorization - Body wrong top-level type |
| negative-create | bad-request | `request-validation/authorizations-validation-api-tests.spec.ts:50` | createAuthorization - Missing body |
| negative-create | bad-request | `request-validation/authorizations-validation-api-tests.spec.ts:62` | createAuthorization - oneOf ambiguous |
| negative-create | bad-request | `request-validation/authorizations-validation-api-tests.spec.ts:84` | createAuthorization - oneOf cross bleed |
| negative-create | bad-request | `request-validation/authorizations-validation-api-tests.spec.ts:106` | createAuthorization - oneOf none match |
| negative-create | bad-request | `request-validation/authorizations-validation-api-tests.spec.ts:127` | createAuthorization - oneOf violation |
| negative-get | bad-request | `request-validation/authorizations-validation-api-tests.spec.ts:165` | getAuthorization - Path param authorizationKey pattern violation |
| negative-update | bad-request | `request-validation/authorizations-validation-api-tests.spec.ts:314` | updateAuthorization - Additional prop __extraField |
| negative-update | bad-request | `request-validation/authorizations-validation-api-tests.spec.ts:333` | updateAuthorization - Body wrong top-level type |
| negative-update | bad-request | `request-validation/authorizations-validation-api-tests.spec.ts:350` | updateAuthorization - Missing body |
| negative-update | bad-request | `request-validation/authorizations-validation-api-tests.spec.ts:364` | updateAuthorization - oneOf ambiguous |
| negative-update | bad-request | `request-validation/authorizations-validation-api-tests.spec.ts:388` | updateAuthorization - oneOf cross bleed |
| negative-update | bad-request | `request-validation/authorizations-validation-api-tests.spec.ts:412` | updateAuthorization - oneOf none match |
| negative-update | bad-request | `request-validation/authorizations-validation-api-tests.spec.ts:435` | updateAuthorization - Path param authorizationKey pattern violation |
| negative-update | bad-request | `request-validation/authorizations-validation-api-tests.spec.ts:451` | updateAuthorization - oneOf violation |
| negative-delete | bad-request | `request-validation/authorizations-validation-api-tests.spec.ts:149` | deleteAuthorization - Path param authorizationKey pattern violation |
| negative-search | bad-request | `request-validation/authorizations-validation-api-tests.spec.ts:181` | searchAuthorizations - Additional prop __unexpectedField |
| negative-search | bad-request | `request-validation/authorizations-validation-api-tests.spec.ts:200` | searchAuthorizations - Body wrong top-level type |
| negative-search | bad-request | `request-validation/authorizations-validation-api-tests.spec.ts:215` | searchAuthorizations - Missing sort.0.field |
| negative-search | bad-request | `request-validation/authorizations-validation-api-tests.spec.ts:232` | searchAuthorizations - Enum violation filter.ownerType |
| negative-search | bad-request | `request-validation/authorizations-validation-api-tests.spec.ts:251` | searchAuthorizations - Enum violation filter.resourceType |
| negative-search | bad-request | `request-validation/authorizations-validation-api-tests.spec.ts:272` | searchAuthorizations - Enum violation sort.0.field |
| negative-search | bad-request | `request-validation/authorizations-validation-api-tests.spec.ts:293` | searchAuthorizations - Enum violation sort.0.order |

### `role` — 36 tests

- **Prerequisite to create**: none
- **Files**: `createRole.feature.spec.ts`, `deleteRole.feature.spec.ts`, `getRole.feature.spec.ts`, `request-validation/roles-validation-api-tests.spec.ts`, `searchRoles.feature.spec.ts`, `searchRoles.variant.spec.ts`, `updateRole.feature.spec.ts`
- **Observation channel**: GET = 1, Search = 4
- **Form-step counts**: create=1, observe-present-get=1, observe-present-search=4, mutate=1, delete=1, observe-absence=1, negative-create=13, negative-get=1, negative-update=7, negative-delete=1, negative-search=5
- **Variants**: happy-path=5, observe-absence=1, data-driven=3, bad-request=27

| form step | variants | file:line | test name |
|--|--|--|--|
| create | happy-path | `createRole.feature.spec.ts:11` | feature-1 - createRole - base (1) |
| observe-present-get | happy-path | `getRole.feature.spec.ts:12` | feature-1 - getRole - base (1) |
| observe-present-search | happy-path | `searchRoles.feature.spec.ts:12` | feature-1 - searchRoles - base (1) |
| observe-present-search | data-driven | `searchRoles.variant.spec.ts:12` | variant-1 - searchRoles - path #1 |
| observe-present-search | data-driven | `searchRoles.variant.spec.ts:105` | variant-2 - searchRoles - path #1 |
| observe-present-search | data-driven | `searchRoles.variant.spec.ts:157` | variant-3 - searchRoles - path #1 |
| mutate | happy-path | `updateRole.feature.spec.ts:11` | feature-1 - updateRole - base (1) |
| delete | happy-path | `deleteRole.feature.spec.ts:8` | feature-1 - deleteRole - base (1) |
| observe-absence | observe-absence | `searchRoles.feature.spec.ts:35` | feature-2 - searchRoles - negative empty (2) |
| negative-create | bad-request | `request-validation/roles-validation-api-tests.spec.ts:151` | createRole - Additional prop __unexpectedField |
| negative-create | bad-request | `request-validation/roles-validation-api-tests.spec.ts:170` | createRole - Body wrong top-level type |
| negative-create | bad-request | `request-validation/roles-validation-api-tests.spec.ts:185` | createRole - Param name wrong type (#1) |
| negative-create | bad-request | `request-validation/roles-validation-api-tests.spec.ts:203` | createRole - Param name wrong type (#2) |
| negative-create | bad-request | `request-validation/roles-validation-api-tests.spec.ts:221` | createRole - Param roleId wrong type (#1) |
| negative-create | bad-request | `request-validation/roles-validation-api-tests.spec.ts:239` | createRole - Param roleId wrong type (#2) |
| negative-create | bad-request | `request-validation/roles-validation-api-tests.spec.ts:257` | createRole - Constraint violation roleId (#1) |
| negative-create | bad-request | `request-validation/roles-validation-api-tests.spec.ts:276` | createRole - Constraint violation roleId (#2) |
| negative-create | bad-request | `request-validation/roles-validation-api-tests.spec.ts:294` | createRole - Constraint violation roleId (#3) |
| negative-create | bad-request | `request-validation/roles-validation-api-tests.spec.ts:312` | createRole - Constraint violation roleId (#4) |
| negative-create | bad-request | `request-validation/roles-validation-api-tests.spec.ts:331` | createRole - Missing name |
| negative-create | bad-request | `request-validation/roles-validation-api-tests.spec.ts:348` | createRole - Missing roleId |
| negative-create | bad-request | `request-validation/roles-validation-api-tests.spec.ts:365` | createRole - Missing combo roleId,name |
| negative-get | bad-request | `request-validation/roles-validation-api-tests.spec.ts:392` | getRole - Path param roleId pattern violation |
| negative-update | bad-request | `request-validation/roles-validation-api-tests.spec.ts:1054` | updateRole - Additional prop __extraField |
| negative-update | bad-request | `request-validation/roles-validation-api-tests.spec.ts:1072` | updateRole - Body wrong top-level type |
| negative-update | bad-request | `request-validation/roles-validation-api-tests.spec.ts:1087` | updateRole - Param name wrong type (#1) |
| negative-update | bad-request | `request-validation/roles-validation-api-tests.spec.ts:1104` | updateRole - Param name wrong type (#2) |
| negative-update | bad-request | `request-validation/roles-validation-api-tests.spec.ts:1121` | updateRole - Missing name |
| negative-update | bad-request | `request-validation/roles-validation-api-tests.spec.ts:1136` | updateRole - Missing body |
| negative-update | bad-request | `request-validation/roles-validation-api-tests.spec.ts:1148` | updateRole - Path param roleId pattern violation |
| negative-delete | bad-request | `request-validation/roles-validation-api-tests.spec.ts:380` | deleteRole - Path param roleId pattern violation |
| negative-search | bad-request | `request-validation/roles-validation-api-tests.spec.ts:721` | searchRoles - Additional prop __unexpectedField |
| negative-search | bad-request | `request-validation/roles-validation-api-tests.spec.ts:738` | searchRoles - Body wrong top-level type |
| negative-search | bad-request | `request-validation/roles-validation-api-tests.spec.ts:753` | searchRoles - Missing sort.0.field |
| negative-search | bad-request | `request-validation/roles-validation-api-tests.spec.ts:770` | searchRoles - Enum violation sort.0.field |
| negative-search | bad-request | `request-validation/roles-validation-api-tests.spec.ts:791` | searchRoles - Enum violation sort.0.order |

### `group` — 34 tests

- **Prerequisite to create**: none
- **Files**: `createGroup.feature.spec.ts`, `deleteGroup.feature.spec.ts`, `getGroup.feature.spec.ts`, `request-validation/groups-validation-api-tests.spec.ts`, `searchGroups.feature.spec.ts`, `searchGroups.variant.spec.ts`, `updateGroup.feature.spec.ts`
- **Observation channel**: GET = 1, Search = 3
- **Form-step counts**: create=1, observe-present-get=1, observe-present-search=3, mutate=1, delete=1, observe-absence=1, negative-create=12, negative-get=1, negative-update=7, negative-delete=1, negative-search=5
- **Variants**: happy-path=5, observe-absence=1, data-driven=2, bad-request=26

| form step | variants | file:line | test name |
|--|--|--|--|
| create | happy-path | `createGroup.feature.spec.ts:11` | feature-1 - createGroup - base (1) |
| observe-present-get | happy-path | `getGroup.feature.spec.ts:12` | feature-1 - getGroup - base (1) |
| observe-present-search | happy-path | `searchGroups.feature.spec.ts:12` | feature-1 - searchGroups - base (1) |
| observe-present-search | data-driven | `searchGroups.variant.spec.ts:12` | variant-1 - searchGroups - path #1 |
| observe-present-search | data-driven | `searchGroups.variant.spec.ts:64` | variant-2 - searchGroups - path #1 |
| mutate | happy-path | `updateGroup.feature.spec.ts:11` | feature-1 - updateGroup - base (1) |
| delete | happy-path | `deleteGroup.feature.spec.ts:8` | feature-1 - deleteGroup - base (1) |
| observe-absence | observe-absence | `searchGroups.feature.spec.ts:35` | feature-2 - searchGroups - negative empty (2) |
| negative-create | bad-request | `request-validation/groups-validation-api-tests.spec.ts:123` | createGroup - Additional prop __unexpectedField |
| negative-create | bad-request | `request-validation/groups-validation-api-tests.spec.ts:142` | createGroup - Body wrong top-level type |
| negative-create | bad-request | `request-validation/groups-validation-api-tests.spec.ts:157` | createGroup - Param groupId wrong type (#1) |
| negative-create | bad-request | `request-validation/groups-validation-api-tests.spec.ts:175` | createGroup - Param groupId wrong type (#2) |
| negative-create | bad-request | `request-validation/groups-validation-api-tests.spec.ts:193` | createGroup - Param name wrong type (#1) |
| negative-create | bad-request | `request-validation/groups-validation-api-tests.spec.ts:211` | createGroup - Param name wrong type (#2) |
| negative-create | bad-request | `request-validation/groups-validation-api-tests.spec.ts:229` | createGroup - Constraint violation groupId (#1) |
| negative-create | bad-request | `request-validation/groups-validation-api-tests.spec.ts:248` | createGroup - Constraint violation groupId (#2) |
| negative-create | bad-request | `request-validation/groups-validation-api-tests.spec.ts:266` | createGroup - Constraint violation groupId (#3) |
| negative-create | bad-request | `request-validation/groups-validation-api-tests.spec.ts:285` | createGroup - Missing groupId |
| negative-create | bad-request | `request-validation/groups-validation-api-tests.spec.ts:302` | createGroup - Missing name |
| negative-create | bad-request | `request-validation/groups-validation-api-tests.spec.ts:319` | createGroup - Missing combo groupId,name |
| negative-get | bad-request | `request-validation/groups-validation-api-tests.spec.ts:349` | getGroup - Path param groupId length-max violation |
| negative-update | bad-request | `request-validation/groups-validation-api-tests.spec.ts:1008` | updateGroup - Additional prop __extraField |
| negative-update | bad-request | `request-validation/groups-validation-api-tests.spec.ts:1026` | updateGroup - Body wrong top-level type |
| negative-update | bad-request | `request-validation/groups-validation-api-tests.spec.ts:1041` | updateGroup - Param name wrong type (#1) |
| negative-update | bad-request | `request-validation/groups-validation-api-tests.spec.ts:1058` | updateGroup - Param name wrong type (#2) |
| negative-update | bad-request | `request-validation/groups-validation-api-tests.spec.ts:1075` | updateGroup - Missing name |
| negative-update | bad-request | `request-validation/groups-validation-api-tests.spec.ts:1090` | updateGroup - Missing body |
| negative-update | bad-request | `request-validation/groups-validation-api-tests.spec.ts:1102` | updateGroup - Path param groupId length-max violation |
| negative-delete | bad-request | `request-validation/groups-validation-api-tests.spec.ts:334` | deleteGroup - Path param groupId length-max violation |
| negative-search | bad-request | `request-validation/groups-validation-api-tests.spec.ts:472` | searchGroups - Additional prop __unexpectedField |
| negative-search | bad-request | `request-validation/groups-validation-api-tests.spec.ts:489` | searchGroups - Body wrong top-level type |
| negative-search | bad-request | `request-validation/groups-validation-api-tests.spec.ts:504` | searchGroups - Missing sort.0.field |
| negative-search | bad-request | `request-validation/groups-validation-api-tests.spec.ts:521` | searchGroups - Enum violation sort.0.field |
| negative-search | bad-request | `request-validation/groups-validation-api-tests.spec.ts:542` | searchGroups - Enum violation sort.0.order |

### `user` — 33 tests

- **Prerequisite to create**: none
- **Files**: `createUser.feature.spec.ts`, `deleteUser.feature.spec.ts`, `getUser.feature.spec.ts`, `request-validation/users-validation-api-tests.spec.ts`, `searchUsers.feature.spec.ts`, `searchUsers.variant.spec.ts`, `updateUser.feature.spec.ts`
- **Observation channel**: GET = 1, Search = 3
- **Form-step counts**: create=1, observe-present-get=1, observe-present-search=3, mutate=1, delete=1, observe-absence=1, negative-create=14, negative-get=1, negative-update=4, negative-delete=1, negative-search=5
- **Variants**: happy-path=5, observe-absence=1, data-driven=2, bad-request=25

| form step | variants | file:line | test name |
|--|--|--|--|
| create | happy-path | `createUser.feature.spec.ts:11` | feature-1 - createUser - base (1) |
| observe-present-get | happy-path | `getUser.feature.spec.ts:12` | feature-1 - getUser - base (1) |
| observe-present-search | happy-path | `searchUsers.feature.spec.ts:12` | feature-1 - searchUsers - base (1) |
| observe-present-search | data-driven | `searchUsers.variant.spec.ts:12` | variant-1 - searchUsers - path #1 |
| observe-present-search | data-driven | `searchUsers.variant.spec.ts:64` | variant-2 - searchUsers - path #1 |
| mutate | happy-path | `updateUser.feature.spec.ts:11` | feature-1 - updateUser - base (1) |
| delete | happy-path | `deleteUser.feature.spec.ts:8` | feature-1 - deleteUser - base (1) |
| observe-absence | observe-absence | `searchUsers.feature.spec.ts:35` | feature-2 - searchUsers - negative empty (2) |
| negative-create | bad-request | `request-validation/users-validation-api-tests.spec.ts:18` | createUser - Additional prop __unexpectedField |
| negative-create | bad-request | `request-validation/users-validation-api-tests.spec.ts:37` | createUser - Body wrong top-level type |
| negative-create | bad-request | `request-validation/users-validation-api-tests.spec.ts:52` | createUser - Param password wrong type (#1) |
| negative-create | bad-request | `request-validation/users-validation-api-tests.spec.ts:70` | createUser - Param password wrong type (#2) |
| negative-create | bad-request | `request-validation/users-validation-api-tests.spec.ts:88` | createUser - Param username wrong type (#1) |
| negative-create | bad-request | `request-validation/users-validation-api-tests.spec.ts:106` | createUser - Param username wrong type (#2) |
| negative-create | bad-request | `request-validation/users-validation-api-tests.spec.ts:124` | createUser - Constraint violation username (#1) |
| negative-create | bad-request | `request-validation/users-validation-api-tests.spec.ts:143` | createUser - Constraint violation username (#2) |
| negative-create | bad-request | `request-validation/users-validation-api-tests.spec.ts:161` | createUser - Constraint violation username (#3) |
| negative-create | bad-request | `request-validation/users-validation-api-tests.spec.ts:179` | createUser - Constraint violation username (#4) |
| negative-create | bad-request | `request-validation/users-validation-api-tests.spec.ts:198` | createUser - Missing password |
| negative-create | bad-request | `request-validation/users-validation-api-tests.spec.ts:215` | createUser - Missing username |
| negative-create | bad-request | `request-validation/users-validation-api-tests.spec.ts:232` | createUser - Missing body |
| negative-create | bad-request | `request-validation/users-validation-api-tests.spec.ts:244` | createUser - Missing combo username,password |
| negative-get | bad-request | `request-validation/users-validation-api-tests.spec.ts:271` | getUser - Path param username pattern violation |
| negative-update | bad-request | `request-validation/users-validation-api-tests.spec.ts:374` | updateUser - Additional prop __extraField |
| negative-update | bad-request | `request-validation/users-validation-api-tests.spec.ts:391` | updateUser - Body wrong top-level type |
| negative-update | bad-request | `request-validation/users-validation-api-tests.spec.ts:406` | updateUser - Missing body |
| negative-update | bad-request | `request-validation/users-validation-api-tests.spec.ts:418` | updateUser - Path param username pattern violation |
| negative-delete | bad-request | `request-validation/users-validation-api-tests.spec.ts:259` | deleteUser - Path param username pattern violation |
| negative-search | bad-request | `request-validation/users-validation-api-tests.spec.ts:283` | searchUsers - Additional prop __unexpectedField |
| negative-search | bad-request | `request-validation/users-validation-api-tests.spec.ts:300` | searchUsers - Body wrong top-level type |
| negative-search | bad-request | `request-validation/users-validation-api-tests.spec.ts:315` | searchUsers - Missing sort.0.field |
| negative-search | bad-request | `request-validation/users-validation-api-tests.spec.ts:332` | searchUsers - Enum violation sort.0.field |
| negative-search | bad-request | `request-validation/users-validation-api-tests.spec.ts:353` | searchUsers - Enum violation sort.0.order |

### `document` — 20 tests

- **Prerequisite to create**: none
- **Files**: `createDocument.feature.spec.ts`, `createDocument.variant.spec.ts`, `createDocumentLink.feature.spec.ts`, `createDocuments.feature.spec.ts`, `createDocuments.variant.spec.ts`, `deleteDocument.feature.spec.ts`, `getDocument.feature.spec.ts`, `request-validation/documents-validation-api-tests.spec.ts`
- **Observation channel**: GET = 1, Search = 0
- **Form-step counts**: create=7, observe-present-get=1, delete=1, negative-create=11
- **Variants**: happy-path=5, data-driven=4, bad-request=11

| form step | variants | file:line | test name |
|--|--|--|--|
| create | happy-path | `createDocument.feature.spec.ts:12` | feature-1 - createDocument - base (1) |
| create | data-driven | `createDocument.variant.spec.ts:13` | variant-1 - createDocument - bpmn #1 |
| create | data-driven | `createDocument.variant.spec.ts:76` | variant-2 - createDocument - bpmn #1 |
| create | happy-path | `createDocumentLink.feature.spec.ts:12` | feature-1 - createDocumentLink - base (1) |
| create | happy-path | `createDocuments.feature.spec.ts:12` | feature-1 - createDocuments - base (1) |
| create | data-driven | `createDocuments.variant.spec.ts:13` | variant-1 - createDocuments - bpmn #1 |
| create | data-driven | `createDocuments.variant.spec.ts:74` | variant-2 - createDocuments - bpmn #1 |
| observe-present-get | happy-path | `getDocument.feature.spec.ts:9` | feature-1 - getDocument - base (1) |
| delete | happy-path | `deleteDocument.feature.spec.ts:9` | feature-1 - deleteDocument - base (1) |
| negative-create | bad-request | `request-validation/documents-validation-api-tests.spec.ts:18` | createDocument - Additional prop __unexpectedField |
| negative-create | bad-request | `request-validation/documents-validation-api-tests.spec.ts:38` | createDocument - Missing body |
| negative-create | bad-request | `request-validation/documents-validation-api-tests.spec.ts:55` | createDocument - Missing file |
| negative-create | bad-request | `request-validation/documents-validation-api-tests.spec.ts:72` | createDocument - Param query.documentId wrong type |
| negative-create | bad-request | `request-validation/documents-validation-api-tests.spec.ts:92` | createDocumentLink - Additional prop __extraField |
| negative-create | bad-request | `request-validation/documents-validation-api-tests.spec.ts:110` | createDocumentLink - Body wrong top-level type |
| negative-create | bad-request | `request-validation/documents-validation-api-tests.spec.ts:125` | createDocumentLink - Param timeToLive wrong type (#1) |
| negative-create | bad-request | `request-validation/documents-validation-api-tests.spec.ts:142` | createDocumentLink - Param timeToLive wrong type (#2) |
| negative-create | bad-request | `request-validation/documents-validation-api-tests.spec.ts:159` | createDocuments - Additional prop __unexpectedField |
| negative-create | bad-request | `request-validation/documents-validation-api-tests.spec.ts:179` | createDocuments - Missing body |
| negative-create | bad-request | `request-validation/documents-validation-api-tests.spec.ts:196` | createDocuments - Missing files |

## B. Membership/Association

**Form**: Create parent + member (prerequisite) → Assign member → Search members (Observe Present) → Unassign member → Search members (Observe Absence)

**Total tests**: 206

### `tenant` — 82 tests

- **Prerequisite to create**: tenant + client, tenant + group, tenant + groupid, tenant + mappingrule, tenant + role, tenant + user
- **Files**: `assignClientToTenant.feature.spec.ts`, `assignGroupToTenant.feature.spec.ts`, `assignMappingRuleToTenant.feature.spec.ts`, `assignRoleToTenant.feature.spec.ts`, `assignUserToTenant.feature.spec.ts`, `edges/TenantClientMembership.lifecycle.spec.ts`, `edges/TenantGroupMembership.lifecycle.spec.ts`, `edges/TenantMappingRuleMembership.lifecycle.spec.ts`, `edges/TenantRoleMembership.lifecycle.spec.ts`, `edges/TenantUserMembership.lifecycle.spec.ts`, `request-validation/tenants-validation-api-tests.spec.ts`, `searchClientsForTenant.feature.spec.ts`, `searchClientsForTenant.variant.spec.ts`, `searchGroupIdsForTenant.feature.spec.ts`, `searchGroupIdsForTenant.variant.spec.ts`, `searchMappingRulesForTenant.feature.spec.ts`, `searchMappingRulesForTenant.variant.spec.ts`, `searchRolesForTenant.feature.spec.ts`, `searchRolesForTenant.variant.spec.ts`, `searchUsersForTenant.feature.spec.ts`, `searchUsersForTenant.variant.spec.ts`, `unassignClientFromTenant.feature.spec.ts`, `unassignGroupFromTenant.feature.spec.ts`, `unassignMappingRuleFromTenant.feature.spec.ts`, `unassignRoleFromTenant.feature.spec.ts`, `unassignUserFromTenant.feature.spec.ts`
- **Observation channel**: GET = 0, Search = 17
- **Form-step counts**: observe-present-search=17, mutate=5, delete=5, lifecycle=5, negative-update=10, negative-delete=10, negative-search=30
- **Variants**: happy-path=15, data-driven=12, bad-request=50

| form step | variants | file:line | test name |
|--|--|--|--|
| observe-present-search | happy-path | `searchClientsForTenant.feature.spec.ts:12` | feature-1 - searchClientsForTenant - base (1) |
| observe-present-search | data-driven | `searchClientsForTenant.variant.spec.ts:12` | variant-1 - searchClientsForTenant - path #1 |
| observe-present-search | data-driven | `searchClientsForTenant.variant.spec.ts:88` | variant-2 - searchClientsForTenant - path #1 |
| observe-present-search | happy-path | `searchGroupIdsForTenant.feature.spec.ts:12` | feature-1 - searchGroupIdsForTenant - base (1) |
| observe-present-search | data-driven | `searchGroupIdsForTenant.variant.spec.ts:12` | variant-1 - searchGroupIdsForTenant - path #1 |
| observe-present-search | data-driven | `searchGroupIdsForTenant.variant.spec.ts:88` | variant-2 - searchGroupIdsForTenant - path #1 |
| observe-present-search | happy-path | `searchMappingRulesForTenant.feature.spec.ts:12` | feature-1 - searchMappingRulesForTenant - base (1) |
| observe-present-search | data-driven | `searchMappingRulesForTenant.variant.spec.ts:12` | variant-1 - searchMappingRulesForTenant - path #1 |
| observe-present-search | data-driven | `searchMappingRulesForTenant.variant.spec.ts:126` | variant-2 - searchMappingRulesForTenant - path #1 |
| observe-present-search | data-driven | `searchMappingRulesForTenant.variant.spec.ts:203` | variant-3 - searchMappingRulesForTenant - path #1 |
| observe-present-search | happy-path | `searchRolesForTenant.feature.spec.ts:12` | feature-1 - searchRolesForTenant - base (1) |
| observe-present-search | data-driven | `searchRolesForTenant.variant.spec.ts:12` | variant-1 - searchRolesForTenant - path #1 |
| observe-present-search | data-driven | `searchRolesForTenant.variant.spec.ts:126` | variant-2 - searchRolesForTenant - path #1 |
| observe-present-search | data-driven | `searchRolesForTenant.variant.spec.ts:203` | variant-3 - searchRolesForTenant - path #1 |
| observe-present-search | happy-path | `searchUsersForTenant.feature.spec.ts:12` | feature-1 - searchUsersForTenant - base (1) |
| observe-present-search | data-driven | `searchUsersForTenant.variant.spec.ts:12` | variant-1 - searchUsersForTenant - path #1 |
| observe-present-search | data-driven | `searchUsersForTenant.variant.spec.ts:88` | variant-2 - searchUsersForTenant - path #1 |
| mutate | happy-path | `assignClientToTenant.feature.spec.ts:8` | feature-1 - assignClientToTenant - base (1) |
| mutate | happy-path | `assignGroupToTenant.feature.spec.ts:8` | feature-1 - assignGroupToTenant - base (1) |
| mutate | happy-path | `assignMappingRuleToTenant.feature.spec.ts:8` | feature-1 - assignMappingRuleToTenant - base (1) |
| mutate | happy-path | `assignRoleToTenant.feature.spec.ts:8` | feature-1 - assignRoleToTenant - base (1) |
| mutate | happy-path | `assignUserToTenant.feature.spec.ts:8` | feature-1 - assignUserToTenant - base (1) |
| delete | happy-path | `unassignClientFromTenant.feature.spec.ts:8` | feature-1 - unassignClientFromTenant - base (1) |
| delete | happy-path | `unassignGroupFromTenant.feature.spec.ts:8` | feature-1 - unassignGroupFromTenant - base (1) |
| delete | happy-path | `unassignMappingRuleFromTenant.feature.spec.ts:8` | feature-1 - unassignMappingRuleFromTenant - base (1) |
| delete | happy-path | `unassignRoleFromTenant.feature.spec.ts:8` | feature-1 - unassignRoleFromTenant - base (1) |
| delete | happy-path | `unassignUserFromTenant.feature.spec.ts:8` | feature-1 - unassignUserFromTenant - base (1) |
| lifecycle | happy-path|observe-absence | `edges/TenantClientMembership.lifecycle.spec.ts:9` | establish TenantClientMembership, observe present, revoke, observe absent |
| lifecycle | happy-path|observe-absence | `edges/TenantGroupMembership.lifecycle.spec.ts:9` | establish TenantGroupMembership, observe present, revoke, observe absent |
| lifecycle | happy-path|observe-absence | `edges/TenantMappingRuleMembership.lifecycle.spec.ts:9` | establish TenantMappingRuleMembership, observe present, revoke, observe absent |
| lifecycle | happy-path|observe-absence | `edges/TenantRoleMembership.lifecycle.spec.ts:9` | establish TenantRoleMembership, observe present, revoke, observe absent |
| lifecycle | happy-path|observe-absence | `edges/TenantUserMembership.lifecycle.spec.ts:9` | establish TenantUserMembership, observe present, revoke, observe absent |
| negative-update | bad-request | `request-validation/tenants-validation-api-tests.spec.ts:18` | assignClientToTenant - Path param clientId pattern violation |
| negative-update | bad-request | `request-validation/tenants-validation-api-tests.spec.ts:35` | assignClientToTenant - Path param tenantId pattern violation |
| negative-update | bad-request | `request-validation/tenants-validation-api-tests.spec.ts:52` | assignGroupToTenant - Path param groupId length-max violation |
| negative-update | bad-request | `request-validation/tenants-validation-api-tests.spec.ts:70` | assignGroupToTenant - Path param tenantId pattern violation |
| negative-update | bad-request | `request-validation/tenants-validation-api-tests.spec.ts:87` | assignMappingRuleToTenant - Path param mappingRuleId pattern violation |
| negative-update | bad-request | `request-validation/tenants-validation-api-tests.spec.ts:104` | assignMappingRuleToTenant - Path param tenantId pattern violation |
| negative-update | bad-request | `request-validation/tenants-validation-api-tests.spec.ts:121` | assignRoleToTenant - Path param roleId pattern violation |
| negative-update | bad-request | `request-validation/tenants-validation-api-tests.spec.ts:138` | assignRoleToTenant - Path param tenantId pattern violation |
| negative-update | bad-request | `request-validation/tenants-validation-api-tests.spec.ts:155` | assignUserToTenant - Path param tenantId pattern violation |
| negative-update | bad-request | `request-validation/tenants-validation-api-tests.spec.ts:172` | assignUserToTenant - Path param username pattern violation |
| negative-delete | bad-request | `request-validation/tenants-validation-api-tests.spec.ts:1102` | unassignClientFromTenant - Path param clientId pattern violation |
| negative-delete | bad-request | `request-validation/tenants-validation-api-tests.spec.ts:1119` | unassignClientFromTenant - Path param tenantId pattern violation |
| negative-delete | bad-request | `request-validation/tenants-validation-api-tests.spec.ts:1136` | unassignGroupFromTenant - Path param groupId length-max violation |
| negative-delete | bad-request | `request-validation/tenants-validation-api-tests.spec.ts:1154` | unassignGroupFromTenant - Path param tenantId pattern violation |
| negative-delete | bad-request | `request-validation/tenants-validation-api-tests.spec.ts:1171` | unassignMappingRuleFromTenant - Path param mappingRuleId pattern violation |
| negative-delete | bad-request | `request-validation/tenants-validation-api-tests.spec.ts:1188` | unassignMappingRuleFromTenant - Path param tenantId pattern violation |
| negative-delete | bad-request | `request-validation/tenants-validation-api-tests.spec.ts:1205` | unassignRoleFromTenant - Path param roleId pattern violation |
| negative-delete | bad-request | `request-validation/tenants-validation-api-tests.spec.ts:1222` | unassignRoleFromTenant - Path param tenantId pattern violation |
| negative-delete | bad-request | `request-validation/tenants-validation-api-tests.spec.ts:1239` | unassignUserFromTenant - Path param tenantId pattern violation |
| negative-delete | bad-request | `request-validation/tenants-validation-api-tests.spec.ts:1256` | unassignUserFromTenant - Path param username pattern violation |
| negative-search | bad-request | `request-validation/tenants-validation-api-tests.spec.ts:452` | searchClientsForTenant - Additional prop __unexpectedField |
| negative-search | bad-request | `request-validation/tenants-validation-api-tests.spec.ts:471` | searchClientsForTenant - Body wrong top-level type |
| negative-search | bad-request | `request-validation/tenants-validation-api-tests.spec.ts:486` | searchClientsForTenant - Missing sort.0.field |
| negative-search | bad-request | `request-validation/tenants-validation-api-tests.spec.ts:503` | searchClientsForTenant - Enum violation sort.0.field |
| negative-search | bad-request | `request-validation/tenants-validation-api-tests.spec.ts:524` | searchClientsForTenant - Enum violation sort.0.order |
| negative-search | bad-request | `request-validation/tenants-validation-api-tests.spec.ts:545` | searchClientsForTenant - Path param tenantId pattern violation |
| negative-search | bad-request | `request-validation/tenants-validation-api-tests.spec.ts:561` | searchGroupIdsForTenant - Additional prop __unexpectedField |
| negative-search | bad-request | `request-validation/tenants-validation-api-tests.spec.ts:580` | searchGroupIdsForTenant - Body wrong top-level type |
| negative-search | bad-request | `request-validation/tenants-validation-api-tests.spec.ts:595` | searchGroupIdsForTenant - Missing sort.0.field |
| negative-search | bad-request | `request-validation/tenants-validation-api-tests.spec.ts:612` | searchGroupIdsForTenant - Enum violation sort.0.field |
| negative-search | bad-request | `request-validation/tenants-validation-api-tests.spec.ts:633` | searchGroupIdsForTenant - Enum violation sort.0.order |
| negative-search | bad-request | `request-validation/tenants-validation-api-tests.spec.ts:654` | searchGroupIdsForTenant - Path param tenantId pattern violation |
| negative-search | bad-request | `request-validation/tenants-validation-api-tests.spec.ts:670` | searchMappingRulesForTenant - Additional prop __unexpectedField |
| negative-search | bad-request | `request-validation/tenants-validation-api-tests.spec.ts:691` | searchMappingRulesForTenant - Body wrong top-level type |
| negative-search | bad-request | `request-validation/tenants-validation-api-tests.spec.ts:708` | searchMappingRulesForTenant - Missing sort.0.field |
| negative-search | bad-request | `request-validation/tenants-validation-api-tests.spec.ts:727` | searchMappingRulesForTenant - Enum violation sort.0.field |
| negative-search | bad-request | `request-validation/tenants-validation-api-tests.spec.ts:752` | searchMappingRulesForTenant - Enum violation sort.0.order |
| negative-search | bad-request | `request-validation/tenants-validation-api-tests.spec.ts:777` | searchMappingRulesForTenant - Path param tenantId pattern violation |
| negative-search | bad-request | `request-validation/tenants-validation-api-tests.spec.ts:793` | searchRolesForTenant - Additional prop __unexpectedField |
| negative-search | bad-request | `request-validation/tenants-validation-api-tests.spec.ts:812` | searchRolesForTenant - Body wrong top-level type |
| negative-search | bad-request | `request-validation/tenants-validation-api-tests.spec.ts:827` | searchRolesForTenant - Missing sort.0.field |
| negative-search | bad-request | `request-validation/tenants-validation-api-tests.spec.ts:844` | searchRolesForTenant - Enum violation sort.0.field |
| negative-search | bad-request | `request-validation/tenants-validation-api-tests.spec.ts:865` | searchRolesForTenant - Enum violation sort.0.order |
| negative-search | bad-request | `request-validation/tenants-validation-api-tests.spec.ts:886` | searchRolesForTenant - Path param tenantId pattern violation |
| negative-search | bad-request | `request-validation/tenants-validation-api-tests.spec.ts:993` | searchUsersForTenant - Additional prop __unexpectedField |
| negative-search | bad-request | `request-validation/tenants-validation-api-tests.spec.ts:1012` | searchUsersForTenant - Body wrong top-level type |
| negative-search | bad-request | `request-validation/tenants-validation-api-tests.spec.ts:1027` | searchUsersForTenant - Missing sort.0.field |
| negative-search | bad-request | `request-validation/tenants-validation-api-tests.spec.ts:1044` | searchUsersForTenant - Enum violation sort.0.field |
| negative-search | bad-request | `request-validation/tenants-validation-api-tests.spec.ts:1065` | searchUsersForTenant - Enum violation sort.0.order |
| negative-search | bad-request | `request-validation/tenants-validation-api-tests.spec.ts:1086` | searchUsersForTenant - Path param tenantId pattern violation |

### `role` — 65 tests

- **Prerequisite to create**: client + role, group + role, mappingrule + role, role + client, role + group, role + mappingrule, role + user, user + role
- **Files**: `assignRoleToClient.feature.spec.ts`, `assignRoleToGroup.feature.spec.ts`, `assignRoleToMappingRule.feature.spec.ts`, `assignRoleToUser.feature.spec.ts`, `edges/RoleClientMembership.lifecycle.spec.ts`, `edges/RoleGroupMembership.lifecycle.spec.ts`, `edges/RoleMappingRuleMembership.lifecycle.spec.ts`, `edges/RoleUserMembership.lifecycle.spec.ts`, `request-validation/roles-validation-api-tests.spec.ts`, `searchClientsForRole.feature.spec.ts`, `searchClientsForRole.variant.spec.ts`, `searchGroupsForRole.feature.spec.ts`, `searchGroupsForRole.variant.spec.ts`, `searchMappingRulesForRole.feature.spec.ts`, `searchMappingRulesForRole.variant.spec.ts`, `searchUsersForRole.feature.spec.ts`, `searchUsersForRole.variant.spec.ts`, `unassignRoleFromClient.feature.spec.ts`, `unassignRoleFromGroup.feature.spec.ts`, `unassignRoleFromMappingRule.feature.spec.ts`, `unassignRoleFromUser.feature.spec.ts`
- **Observation channel**: GET = 0, Search = 13
- **Form-step counts**: observe-present-search=13, mutate=4, delete=4, lifecycle=4, negative-update=8, negative-delete=8, negative-search=24
- **Variants**: happy-path=12, data-driven=9, bad-request=40

| form step | variants | file:line | test name |
|--|--|--|--|
| observe-present-search | happy-path | `searchClientsForRole.feature.spec.ts:12` | feature-1 - searchClientsForRole - base (1) |
| observe-present-search | data-driven | `searchClientsForRole.variant.spec.ts:12` | variant-1 - searchClientsForRole - path #1 |
| observe-present-search | data-driven | `searchClientsForRole.variant.spec.ts:86` | variant-2 - searchClientsForRole - path #1 |
| observe-present-search | happy-path | `searchGroupsForRole.feature.spec.ts:12` | feature-1 - searchGroupsForRole - base (1) |
| observe-present-search | data-driven | `searchGroupsForRole.variant.spec.ts:12` | variant-1 - searchGroupsForRole - path #1 |
| observe-present-search | data-driven | `searchGroupsForRole.variant.spec.ts:86` | variant-2 - searchGroupsForRole - path #1 |
| observe-present-search | happy-path | `searchMappingRulesForRole.feature.spec.ts:12` | feature-1 - searchMappingRulesForRole - base (1) |
| observe-present-search | data-driven | `searchMappingRulesForRole.variant.spec.ts:12` | variant-1 - searchMappingRulesForRole - path #1 |
| observe-present-search | data-driven | `searchMappingRulesForRole.variant.spec.ts:124` | variant-2 - searchMappingRulesForRole - path #1 |
| observe-present-search | data-driven | `searchMappingRulesForRole.variant.spec.ts:199` | variant-3 - searchMappingRulesForRole - path #1 |
| observe-present-search | happy-path | `searchUsersForRole.feature.spec.ts:12` | feature-1 - searchUsersForRole - base (1) |
| observe-present-search | data-driven | `searchUsersForRole.variant.spec.ts:12` | variant-1 - searchUsersForRole - path #1 |
| observe-present-search | data-driven | `searchUsersForRole.variant.spec.ts:86` | variant-2 - searchUsersForRole - path #1 |
| mutate | happy-path | `assignRoleToClient.feature.spec.ts:8` | feature-1 - assignRoleToClient - base (1) |
| mutate | happy-path | `assignRoleToGroup.feature.spec.ts:8` | feature-1 - assignRoleToGroup - base (1) |
| mutate | happy-path | `assignRoleToMappingRule.feature.spec.ts:8` | feature-1 - assignRoleToMappingRule - base (1) |
| mutate | happy-path | `assignRoleToUser.feature.spec.ts:8` | feature-1 - assignRoleToUser - base (1) |
| delete | happy-path | `unassignRoleFromClient.feature.spec.ts:8` | feature-1 - unassignRoleFromClient - base (1) |
| delete | happy-path | `unassignRoleFromGroup.feature.spec.ts:8` | feature-1 - unassignRoleFromGroup - base (1) |
| delete | happy-path | `unassignRoleFromMappingRule.feature.spec.ts:8` | feature-1 - unassignRoleFromMappingRule - base (1) |
| delete | happy-path | `unassignRoleFromUser.feature.spec.ts:8` | feature-1 - unassignRoleFromUser - base (1) |
| lifecycle | happy-path|observe-absence | `edges/RoleClientMembership.lifecycle.spec.ts:9` | establish RoleClientMembership, observe present, revoke, observe absent |
| lifecycle | happy-path|observe-absence | `edges/RoleGroupMembership.lifecycle.spec.ts:9` | establish RoleGroupMembership, observe present, revoke, observe absent |
| lifecycle | happy-path|observe-absence | `edges/RoleMappingRuleMembership.lifecycle.spec.ts:9` | establish RoleMappingRuleMembership, observe present, revoke, observe absent |
| lifecycle | happy-path|observe-absence | `edges/RoleUserMembership.lifecycle.spec.ts:9` | establish RoleUserMembership, observe present, revoke, observe absent |
| negative-update | bad-request | `request-validation/roles-validation-api-tests.spec.ts:18` | assignRoleToClient - Path param clientId pattern violation |
| negative-update | bad-request | `request-validation/roles-validation-api-tests.spec.ts:35` | assignRoleToClient - Path param roleId pattern violation |
| negative-update | bad-request | `request-validation/roles-validation-api-tests.spec.ts:52` | assignRoleToGroup - Path param groupId length-max violation |
| negative-update | bad-request | `request-validation/roles-validation-api-tests.spec.ts:70` | assignRoleToGroup - Path param roleId pattern violation |
| negative-update | bad-request | `request-validation/roles-validation-api-tests.spec.ts:85` | assignRoleToMappingRule - Path param mappingRuleId pattern violation |
| negative-update | bad-request | `request-validation/roles-validation-api-tests.spec.ts:102` | assignRoleToMappingRule - Path param roleId pattern violation |
| negative-update | bad-request | `request-validation/roles-validation-api-tests.spec.ts:119` | assignRoleToUser - Path param roleId pattern violation |
| negative-update | bad-request | `request-validation/roles-validation-api-tests.spec.ts:134` | assignRoleToUser - Path param username pattern violation |
| negative-delete | bad-request | `request-validation/roles-validation-api-tests.spec.ts:917` | unassignRoleFromClient - Path param clientId pattern violation |
| negative-delete | bad-request | `request-validation/roles-validation-api-tests.spec.ts:934` | unassignRoleFromClient - Path param roleId pattern violation |
| negative-delete | bad-request | `request-validation/roles-validation-api-tests.spec.ts:951` | unassignRoleFromGroup - Path param groupId length-max violation |
| negative-delete | bad-request | `request-validation/roles-validation-api-tests.spec.ts:969` | unassignRoleFromGroup - Path param roleId pattern violation |
| negative-delete | bad-request | `request-validation/roles-validation-api-tests.spec.ts:986` | unassignRoleFromMappingRule - Path param mappingRuleId pattern violation |
| negative-delete | bad-request | `request-validation/roles-validation-api-tests.spec.ts:1003` | unassignRoleFromMappingRule - Path param roleId pattern violation |
| negative-delete | bad-request | `request-validation/roles-validation-api-tests.spec.ts:1020` | unassignRoleFromUser - Path param roleId pattern violation |
| negative-delete | bad-request | `request-validation/roles-validation-api-tests.spec.ts:1037` | unassignRoleFromUser - Path param username pattern violation |
| negative-search | bad-request | `request-validation/roles-validation-api-tests.spec.ts:404` | searchClientsForRole - Additional prop __extraField |
| negative-search | bad-request | `request-validation/roles-validation-api-tests.spec.ts:421` | searchClientsForRole - Body wrong top-level type |
| negative-search | bad-request | `request-validation/roles-validation-api-tests.spec.ts:436` | searchClientsForRole - Missing sort.0.field |
| negative-search | bad-request | `request-validation/roles-validation-api-tests.spec.ts:453` | searchClientsForRole - Enum violation sort.0.field |
| negative-search | bad-request | `request-validation/roles-validation-api-tests.spec.ts:474` | searchClientsForRole - Enum violation sort.0.order |
| negative-search | bad-request | `request-validation/roles-validation-api-tests.spec.ts:495` | searchClientsForRole - Path param roleId pattern violation |
| negative-search | bad-request | `request-validation/roles-validation-api-tests.spec.ts:509` | searchGroupsForRole - Additional prop __extraField |
| negative-search | bad-request | `request-validation/roles-validation-api-tests.spec.ts:526` | searchGroupsForRole - Body wrong top-level type |
| negative-search | bad-request | `request-validation/roles-validation-api-tests.spec.ts:541` | searchGroupsForRole - Missing sort.0.field |
| negative-search | bad-request | `request-validation/roles-validation-api-tests.spec.ts:558` | searchGroupsForRole - Enum violation sort.0.field |
| negative-search | bad-request | `request-validation/roles-validation-api-tests.spec.ts:579` | searchGroupsForRole - Enum violation sort.0.order |
| negative-search | bad-request | `request-validation/roles-validation-api-tests.spec.ts:600` | searchGroupsForRole - Path param roleId pattern violation |
| negative-search | bad-request | `request-validation/roles-validation-api-tests.spec.ts:614` | searchMappingRulesForRole - Additional prop __unexpectedField |
| negative-search | bad-request | `request-validation/roles-validation-api-tests.spec.ts:633` | searchMappingRulesForRole - Body wrong top-level type |
| negative-search | bad-request | `request-validation/roles-validation-api-tests.spec.ts:648` | searchMappingRulesForRole - Missing sort.0.field |
| negative-search | bad-request | `request-validation/roles-validation-api-tests.spec.ts:665` | searchMappingRulesForRole - Enum violation sort.0.field |
| negative-search | bad-request | `request-validation/roles-validation-api-tests.spec.ts:686` | searchMappingRulesForRole - Enum violation sort.0.order |
| negative-search | bad-request | `request-validation/roles-validation-api-tests.spec.ts:707` | searchMappingRulesForRole - Path param roleId pattern violation |
| negative-search | bad-request | `request-validation/roles-validation-api-tests.spec.ts:812` | searchUsersForRole - Additional prop __extraField |
| negative-search | bad-request | `request-validation/roles-validation-api-tests.spec.ts:829` | searchUsersForRole - Body wrong top-level type |
| negative-search | bad-request | `request-validation/roles-validation-api-tests.spec.ts:844` | searchUsersForRole - Missing sort.0.field |
| negative-search | bad-request | `request-validation/roles-validation-api-tests.spec.ts:861` | searchUsersForRole - Enum violation sort.0.field |
| negative-search | bad-request | `request-validation/roles-validation-api-tests.spec.ts:882` | searchUsersForRole - Enum violation sort.0.order |
| negative-search | bad-request | `request-validation/roles-validation-api-tests.spec.ts:903` | searchUsersForRole - Path param roleId pattern violation |

### `group` — 59 tests

- **Prerequisite to create**: group + client, group + mappingrule, group + role, group + user
- **Files**: `assignClientToGroup.feature.spec.ts`, `assignMappingRuleToGroup.feature.spec.ts`, `assignUserToGroup.feature.spec.ts`, `edges/GroupClientMembership.lifecycle.spec.ts`, `edges/GroupMappingRuleMembership.lifecycle.spec.ts`, `edges/GroupUserMembership.lifecycle.spec.ts`, `request-validation/groups-validation-api-tests.spec.ts`, `searchClientsForGroup.feature.spec.ts`, `searchClientsForGroup.variant.spec.ts`, `searchMappingRulesForGroup.feature.spec.ts`, `searchMappingRulesForGroup.variant.spec.ts`, `searchRolesForGroup.feature.spec.ts`, `searchRolesForGroup.variant.spec.ts`, `searchUsersForGroup.feature.spec.ts`, `searchUsersForGroup.variant.spec.ts`, `unassignClientFromGroup.feature.spec.ts`, `unassignMappingRuleFromGroup.feature.spec.ts`, `unassignUserFromGroup.feature.spec.ts`
- **Observation channel**: GET = 0, Search = 14
- **Form-step counts**: observe-present-search=14, mutate=3, delete=3, lifecycle=3, negative-update=6, negative-delete=6, negative-search=24
- **Variants**: happy-path=10, data-driven=10, bad-request=36

| form step | variants | file:line | test name |
|--|--|--|--|
| observe-present-search | happy-path | `searchClientsForGroup.feature.spec.ts:12` | feature-1 - searchClientsForGroup - base (1) |
| observe-present-search | data-driven | `searchClientsForGroup.variant.spec.ts:12` | variant-1 - searchClientsForGroup - path #1 |
| observe-present-search | data-driven | `searchClientsForGroup.variant.spec.ts:86` | variant-2 - searchClientsForGroup - path #1 |
| observe-present-search | happy-path | `searchMappingRulesForGroup.feature.spec.ts:12` | feature-1 - searchMappingRulesForGroup - base (1) |
| observe-present-search | data-driven | `searchMappingRulesForGroup.variant.spec.ts:12` | variant-1 - searchMappingRulesForGroup - path #1 |
| observe-present-search | data-driven | `searchMappingRulesForGroup.variant.spec.ts:84` | variant-2 - searchMappingRulesForGroup - path #1 |
| observe-present-search | data-driven | `searchMappingRulesForGroup.variant.spec.ts:159` | variant-3 - searchMappingRulesForGroup - path #1 |
| observe-present-search | happy-path | `searchRolesForGroup.feature.spec.ts:12` | feature-1 - searchRolesForGroup - base (1) |
| observe-present-search | data-driven | `searchRolesForGroup.variant.spec.ts:12` | variant-1 - searchRolesForGroup - path #1 |
| observe-present-search | data-driven | `searchRolesForGroup.variant.spec.ts:84` | variant-2 - searchRolesForGroup - path #1 |
| observe-present-search | data-driven | `searchRolesForGroup.variant.spec.ts:159` | variant-3 - searchRolesForGroup - path #1 |
| observe-present-search | happy-path | `searchUsersForGroup.feature.spec.ts:12` | feature-1 - searchUsersForGroup - base (1) |
| observe-present-search | data-driven | `searchUsersForGroup.variant.spec.ts:12` | variant-1 - searchUsersForGroup - path #1 |
| observe-present-search | data-driven | `searchUsersForGroup.variant.spec.ts:86` | variant-2 - searchUsersForGroup - path #1 |
| mutate | happy-path | `assignClientToGroup.feature.spec.ts:8` | feature-1 - assignClientToGroup - base (1) |
| mutate | happy-path | `assignMappingRuleToGroup.feature.spec.ts:8` | feature-1 - assignMappingRuleToGroup - base (1) |
| mutate | happy-path | `assignUserToGroup.feature.spec.ts:8` | feature-1 - assignUserToGroup - base (1) |
| delete | happy-path | `unassignClientFromGroup.feature.spec.ts:8` | feature-1 - unassignClientFromGroup - base (1) |
| delete | happy-path | `unassignMappingRuleFromGroup.feature.spec.ts:8` | feature-1 - unassignMappingRuleFromGroup - base (1) |
| delete | happy-path | `unassignUserFromGroup.feature.spec.ts:8` | feature-1 - unassignUserFromGroup - base (1) |
| lifecycle | happy-path|observe-absence | `edges/GroupClientMembership.lifecycle.spec.ts:9` | establish GroupClientMembership, observe present, revoke, observe absent |
| lifecycle | happy-path|observe-absence | `edges/GroupMappingRuleMembership.lifecycle.spec.ts:9` | establish GroupMappingRuleMembership, observe present, revoke, observe absent |
| lifecycle | happy-path|observe-absence | `edges/GroupUserMembership.lifecycle.spec.ts:9` | establish GroupUserMembership, observe present, revoke, observe absent |
| negative-update | bad-request | `request-validation/groups-validation-api-tests.spec.ts:18` | assignClientToGroup - Path param clientId pattern violation |
| negative-update | bad-request | `request-validation/groups-validation-api-tests.spec.ts:35` | assignClientToGroup - Path param groupId length-max violation |
| negative-update | bad-request | `request-validation/groups-validation-api-tests.spec.ts:53` | assignMappingRuleToGroup - Path param groupId length-max violation |
| negative-update | bad-request | `request-validation/groups-validation-api-tests.spec.ts:71` | assignMappingRuleToGroup - Path param mappingRuleId pattern violation |
| negative-update | bad-request | `request-validation/groups-validation-api-tests.spec.ts:88` | assignUserToGroup - Path param groupId length-max violation |
| negative-update | bad-request | `request-validation/groups-validation-api-tests.spec.ts:106` | assignUserToGroup - Path param username pattern violation |
| negative-delete | bad-request | `request-validation/groups-validation-api-tests.spec.ts:903` | unassignClientFromGroup - Path param clientId pattern violation |
| negative-delete | bad-request | `request-validation/groups-validation-api-tests.spec.ts:920` | unassignClientFromGroup - Path param groupId length-max violation |
| negative-delete | bad-request | `request-validation/groups-validation-api-tests.spec.ts:938` | unassignMappingRuleFromGroup - Path param groupId length-max violation |
| negative-delete | bad-request | `request-validation/groups-validation-api-tests.spec.ts:956` | unassignMappingRuleFromGroup - Path param mappingRuleId pattern violation |
| negative-delete | bad-request | `request-validation/groups-validation-api-tests.spec.ts:973` | unassignUserFromGroup - Path param groupId length-max violation |
| negative-delete | bad-request | `request-validation/groups-validation-api-tests.spec.ts:991` | unassignUserFromGroup - Path param username pattern violation |
| negative-search | bad-request | `request-validation/groups-validation-api-tests.spec.ts:364` | searchClientsForGroup - Additional prop __extraField |
| negative-search | bad-request | `request-validation/groups-validation-api-tests.spec.ts:381` | searchClientsForGroup - Body wrong top-level type |
| negative-search | bad-request | `request-validation/groups-validation-api-tests.spec.ts:396` | searchClientsForGroup - Missing sort.0.field |
| negative-search | bad-request | `request-validation/groups-validation-api-tests.spec.ts:413` | searchClientsForGroup - Enum violation sort.0.field |
| negative-search | bad-request | `request-validation/groups-validation-api-tests.spec.ts:434` | searchClientsForGroup - Enum violation sort.0.order |
| negative-search | bad-request | `request-validation/groups-validation-api-tests.spec.ts:455` | searchClientsForGroup - Path param groupId length-max violation |
| negative-search | bad-request | `request-validation/groups-validation-api-tests.spec.ts:563` | searchMappingRulesForGroup - Additional prop __unexpectedField |
| negative-search | bad-request | `request-validation/groups-validation-api-tests.spec.ts:584` | searchMappingRulesForGroup - Body wrong top-level type |
| negative-search | bad-request | `request-validation/groups-validation-api-tests.spec.ts:601` | searchMappingRulesForGroup - Missing sort.0.field |
| negative-search | bad-request | `request-validation/groups-validation-api-tests.spec.ts:620` | searchMappingRulesForGroup - Enum violation sort.0.field |
| negative-search | bad-request | `request-validation/groups-validation-api-tests.spec.ts:645` | searchMappingRulesForGroup - Enum violation sort.0.order |
| negative-search | bad-request | `request-validation/groups-validation-api-tests.spec.ts:670` | searchMappingRulesForGroup - Path param groupId length-max violation |
| negative-search | bad-request | `request-validation/groups-validation-api-tests.spec.ts:687` | searchRolesForGroup - Additional prop __unexpectedField |
| negative-search | bad-request | `request-validation/groups-validation-api-tests.spec.ts:704` | searchRolesForGroup - Body wrong top-level type |
| negative-search | bad-request | `request-validation/groups-validation-api-tests.spec.ts:719` | searchRolesForGroup - Missing sort.0.field |
| negative-search | bad-request | `request-validation/groups-validation-api-tests.spec.ts:736` | searchRolesForGroup - Enum violation sort.0.field |
| negative-search | bad-request | `request-validation/groups-validation-api-tests.spec.ts:757` | searchRolesForGroup - Enum violation sort.0.order |
| negative-search | bad-request | `request-validation/groups-validation-api-tests.spec.ts:778` | searchRolesForGroup - Path param groupId length-max violation |
| negative-search | bad-request | `request-validation/groups-validation-api-tests.spec.ts:795` | searchUsersForGroup - Additional prop __extraField |
| negative-search | bad-request | `request-validation/groups-validation-api-tests.spec.ts:812` | searchUsersForGroup - Body wrong top-level type |
| negative-search | bad-request | `request-validation/groups-validation-api-tests.spec.ts:827` | searchUsersForGroup - Missing sort.0.field |
| negative-search | bad-request | `request-validation/groups-validation-api-tests.spec.ts:844` | searchUsersForGroup - Enum violation sort.0.field |
| negative-search | bad-request | `request-validation/groups-validation-api-tests.spec.ts:865` | searchUsersForGroup - Enum violation sort.0.order |
| negative-search | bad-request | `request-validation/groups-validation-api-tests.spec.ts:886` | searchUsersForGroup - Path param groupId length-max violation |

## C. Deployment Lifecycle

**Form**: Deploy resource → Get definition (XML/JSON) → Search definitions (Observe Present) → Delete resource → Get definition (Observe Absence)

**Total tests**: 149

### `process-definition` — 70 tests

- **Prerequisite to create**: deployed-process
- **Files**: `getProcessDefinition.feature.spec.ts`, `getProcessDefinitionInstanceStatistics.feature.spec.ts`, `getProcessDefinitionInstanceVersionStatistics.feature.spec.ts`, `getProcessDefinitionInstanceVersionStatistics.variant.spec.ts`, `getProcessDefinitionMessageSubscriptionStatistics.feature.spec.ts`, `getProcessDefinitionMessageSubscriptionStatistics.variant.spec.ts`, `getProcessDefinitionStatistics.feature.spec.ts`, `getProcessDefinitionStatistics.variant.spec.ts`, `getProcessDefinitionXML.feature.spec.ts`, `getStartProcessForm.feature.spec.ts`, `request-validation/processdefinitions-validation-api-tests.spec.ts`, `searchProcessDefinitions.feature.spec.ts`, `searchProcessDefinitions.variant.spec.ts`
- **Observation channel**: GET = 21, Search = 5
- **Form-step counts**: observe-present-get=21, observe-present-search=5, observe-absence=1, negative-get=38, negative-search=5
- **Variants**: happy-path=8, observe-absence=1, data-driven=18, bad-request=43

| form step | variants | file:line | test name |
|--|--|--|--|
| observe-present-get | happy-path | `getProcessDefinition.feature.spec.ts:13` | feature-1 - getProcessDefinition - base (1) |
| observe-present-get | happy-path | `getProcessDefinitionInstanceStatistics.feature.spec.ts:11` | feature-1 - getProcessDefinitionInstanceStatistics - base (1) |
| observe-present-get | happy-path | `getProcessDefinitionInstanceVersionStatistics.feature.spec.ts:12` | feature-1 - getProcessDefinitionInstanceVersionStatistics - base (1) |
| observe-present-get | data-driven | `getProcessDefinitionInstanceVersionStatistics.variant.spec.ts:12` | variant-1 - getProcessDefinitionInstanceVersionStatistics - bpmn #1 |
| observe-present-get | happy-path | `getProcessDefinitionMessageSubscriptionStatistics.feature.spec.ts:11` | feature-1 - getProcessDefinitionMessageSubscriptionStatistics - base (1) |
| observe-present-get | data-driven | `getProcessDefinitionMessageSubscriptionStatistics.variant.spec.ts:13` | variant-1 - getProcessDefinitionMessageSubscriptionStatistics - path #1 |
| observe-present-get | data-driven | `getProcessDefinitionMessageSubscriptionStatistics.variant.spec.ts:72` | variant-2 - getProcessDefinitionMessageSubscriptionStatistics - path #1 |
| observe-present-get | data-driven | `getProcessDefinitionMessageSubscriptionStatistics.variant.spec.ts:133` | variant-3 - getProcessDefinitionMessageSubscriptionStatistics - bpmn #1 |
| observe-present-get | data-driven | `getProcessDefinitionMessageSubscriptionStatistics.variant.spec.ts:190` | variant-4 - getProcessDefinitionMessageSubscriptionStatistics - bpmn #1 |
| observe-present-get | data-driven | `getProcessDefinitionMessageSubscriptionStatistics.variant.spec.ts:268` | variant-5 - getProcessDefinitionMessageSubscriptionStatistics - bpmn #1 |
| observe-present-get | happy-path | `getProcessDefinitionStatistics.feature.spec.ts:12` | feature-1 - getProcessDefinitionStatistics - base (1) |
| observe-present-get | data-driven | `getProcessDefinitionStatistics.variant.spec.ts:12` | variant-1 - getProcessDefinitionStatistics - bpmn #1 |
| observe-present-get | data-driven | `getProcessDefinitionStatistics.variant.spec.ts:86` | variant-2 - getProcessDefinitionStatistics - bpmn #1 |
| observe-present-get | data-driven | `getProcessDefinitionStatistics.variant.spec.ts:160` | variant-3 - getProcessDefinitionStatistics - bpmn #1 |
| observe-present-get | data-driven | `getProcessDefinitionStatistics.variant.spec.ts:214` | variant-4 - getProcessDefinitionStatistics - bpmn #1 |
| observe-present-get | data-driven | `getProcessDefinitionStatistics.variant.spec.ts:268` | variant-5 - getProcessDefinitionStatistics - bpmn #1 |
| observe-present-get | data-driven | `getProcessDefinitionStatistics.variant.spec.ts:346` | variant-6 - getProcessDefinitionStatistics - bpmn #1 |
| observe-present-get | data-driven | `getProcessDefinitionStatistics.variant.spec.ts:424` | variant-7 - getProcessDefinitionStatistics - bpmn #1 |
| observe-present-get | data-driven | `getProcessDefinitionStatistics.variant.spec.ts:482` | variant-8 - getProcessDefinitionStatistics - bpmn #1 |
| observe-present-get | happy-path | `getProcessDefinitionXML.feature.spec.ts:10` | feature-1 - getProcessDefinitionXML - base (1) |
| observe-present-get | happy-path | `getStartProcessForm.feature.spec.ts:13` | feature-1 - getStartProcessForm - base (1) |
| observe-present-search | happy-path | `searchProcessDefinitions.feature.spec.ts:13` | feature-1 - searchProcessDefinitions - base (1) |
| observe-present-search | data-driven | `searchProcessDefinitions.variant.spec.ts:13` | variant-1 - searchProcessDefinitions - path #1 |
| observe-present-search | data-driven | `searchProcessDefinitions.variant.spec.ts:86` | variant-2 - searchProcessDefinitions - bpmn #1 |
| observe-present-search | data-driven | `searchProcessDefinitions.variant.spec.ts:138` | variant-3 - searchProcessDefinitions - path #1 |
| observe-present-search | data-driven | `searchProcessDefinitions.variant.spec.ts:214` | variant-4 - searchProcessDefinitions - path #1 |
| observe-absence | observe-absence | `searchProcessDefinitions.feature.spec.ts:60` | feature-2 - searchProcessDefinitions - negative empty (2) |
| negative-get | bad-request | `request-validation/processdefinitions-validation-api-tests.spec.ts:18` | getProcessDefinition - Path param processDefinitionKey pattern violation |
| negative-get | bad-request | `request-validation/processdefinitions-validation-api-tests.spec.ts:34` | getProcessDefinitionInstanceStatistics - Additional prop __extraField |
| negative-get | bad-request | `request-validation/processdefinitions-validation-api-tests.spec.ts:53` | getProcessDefinitionInstanceStatistics - Body wrong top-level type |
| negative-get | bad-request | `request-validation/processdefinitions-validation-api-tests.spec.ts:70` | getProcessDefinitionInstanceStatistics - Missing sort.0.field |
| negative-get | bad-request | `request-validation/processdefinitions-validation-api-tests.spec.ts:89` | getProcessDefinitionInstanceStatistics - Enum violation sort.0.field |
| negative-get | bad-request | `request-validation/processdefinitions-validation-api-tests.spec.ts:112` | getProcessDefinitionInstanceStatistics - Enum violation sort.0.order |
| negative-get | bad-request | `request-validation/processdefinitions-validation-api-tests.spec.ts:135` | getProcessDefinitionInstanceVersionStatistics - Additional prop __extraField |
| negative-get | bad-request | `request-validation/processdefinitions-validation-api-tests.spec.ts:158` | getProcessDefinitionInstanceVersionStatistics - Body wrong top-level type |
| negative-get | bad-request | `request-validation/processdefinitions-validation-api-tests.spec.ts:175` | getProcessDefinitionInstanceVersionStatistics - Param filter.processDefinitionId wrong type (#1) |
| negative-get | bad-request | `request-validation/processdefinitions-validation-api-tests.spec.ts:197` | getProcessDefinitionInstanceVersionStatistics - Param filter.processDefinitionId wrong type (#2) |
| negative-get | bad-request | `request-validation/processdefinitions-validation-api-tests.spec.ts:219` | getProcessDefinitionInstanceVersionStatistics - Param filter.tenantId wrong type (#1) |
| negative-get | bad-request | `request-validation/processdefinitions-validation-api-tests.spec.ts:241` | getProcessDefinitionInstanceVersionStatistics - Param filter.tenantId wrong type (#2) |
| negative-get | bad-request | `request-validation/processdefinitions-validation-api-tests.spec.ts:263` | getProcessDefinitionInstanceVersionStatistics - Constraint violation filter.processDefinitionId (#1) |
| negative-get | bad-request | `request-validation/processdefinitions-validation-api-tests.spec.ts:285` | getProcessDefinitionInstanceVersionStatistics - Constraint violation filter.processDefinitionId (#2) |
| negative-get | bad-request | `request-validation/processdefinitions-validation-api-tests.spec.ts:307` | getProcessDefinitionInstanceVersionStatistics - Constraint violation filter.tenantId (#1) |
| negative-get | bad-request | `request-validation/processdefinitions-validation-api-tests.spec.ts:329` | getProcessDefinitionInstanceVersionStatistics - Constraint violation filter.tenantId (#2) |
| negative-get | bad-request | `request-validation/processdefinitions-validation-api-tests.spec.ts:351` | getProcessDefinitionInstanceVersionStatistics - Constraint violation filter.tenantId (#3) |
| negative-get | bad-request | `request-validation/processdefinitions-validation-api-tests.spec.ts:373` | getProcessDefinitionInstanceVersionStatistics - Constraint violation filter.tenantId (#4) |
| negative-get | bad-request | `request-validation/processdefinitions-validation-api-tests.spec.ts:395` | getProcessDefinitionInstanceVersionStatistics - Missing filter.processDefinitionId |
| negative-get | bad-request | `request-validation/processdefinitions-validation-api-tests.spec.ts:414` | getProcessDefinitionInstanceVersionStatistics - Missing sort.0.field |
| negative-get | bad-request | `request-validation/processdefinitions-validation-api-tests.spec.ts:436` | getProcessDefinitionInstanceVersionStatistics - Enum violation sort.0.field |
| negative-get | bad-request | `request-validation/processdefinitions-validation-api-tests.spec.ts:463` | getProcessDefinitionInstanceVersionStatistics - Enum violation sort.0.order |
| negative-get | bad-request | `request-validation/processdefinitions-validation-api-tests.spec.ts:490` | getProcessDefinitionInstanceVersionStatistics - Missing filter |
| negative-get | bad-request | `request-validation/processdefinitions-validation-api-tests.spec.ts:507` | getProcessDefinitionInstanceVersionStatistics - Missing body |
| negative-get | bad-request | `request-validation/processdefinitions-validation-api-tests.spec.ts:521` | getProcessDefinitionMessageSubscriptionStatistics - Additional prop __extraField |
| negative-get | bad-request | `request-validation/processdefinitions-validation-api-tests.spec.ts:540` | getProcessDefinitionMessageSubscriptionStatistics - Body wrong top-level type |
| negative-get | bad-request | `request-validation/processdefinitions-validation-api-tests.spec.ts:557` | getProcessDefinitionMessageSubscriptionStatistics - Missing page.after |
| negative-get | bad-request | `request-validation/processdefinitions-validation-api-tests.spec.ts:576` | getProcessDefinitionStatistics - Additional prop __unexpectedField |
| negative-get | bad-request | `request-validation/processdefinitions-validation-api-tests.spec.ts:598` | getProcessDefinitionStatistics - Body wrong top-level type |
| negative-get | bad-request | `request-validation/processdefinitions-validation-api-tests.spec.ts:618` | getProcessDefinitionStatistics - Missing filter.$or.0.variables.0.name |
| negative-get | bad-request | `request-validation/processdefinitions-validation-api-tests.spec.ts:650` | getProcessDefinitionStatistics - Missing filter.$or.0.variables.0.value |
| negative-get | bad-request | `request-validation/processdefinitions-validation-api-tests.spec.ts:682` | getProcessDefinitionStatistics - Missing filter.variables.0.name |
| negative-get | bad-request | `request-validation/processdefinitions-validation-api-tests.spec.ts:710` | getProcessDefinitionStatistics - Missing filter.variables.0.value |
| negative-get | bad-request | `request-validation/processdefinitions-validation-api-tests.spec.ts:738` | getProcessDefinitionStatistics - Path param processDefinitionKey pattern violation |
| negative-get | bad-request | `request-validation/processdefinitions-validation-api-tests.spec.ts:755` | getProcessDefinitionStatistics - uniqueItems violation filter.$or.0.tags |
| negative-get | bad-request | `request-validation/processdefinitions-validation-api-tests.spec.ts:783` | getProcessDefinitionStatistics - uniqueItems violation filter.tags |
| negative-get | bad-request | `request-validation/processdefinitions-validation-api-tests.spec.ts:807` | getProcessDefinitionXML - Path param processDefinitionKey pattern violation |
| negative-get | bad-request | `request-validation/processdefinitions-validation-api-tests.spec.ts:823` | getStartProcessForm - Path param processDefinitionKey pattern violation |
| negative-search | bad-request | `request-validation/processdefinitions-validation-api-tests.spec.ts:839` | searchProcessDefinitions - Additional prop __unexpectedField |
| negative-search | bad-request | `request-validation/processdefinitions-validation-api-tests.spec.ts:858` | searchProcessDefinitions - Body wrong top-level type |
| negative-search | bad-request | `request-validation/processdefinitions-validation-api-tests.spec.ts:873` | searchProcessDefinitions - Missing sort.0.field |
| negative-search | bad-request | `request-validation/processdefinitions-validation-api-tests.spec.ts:890` | searchProcessDefinitions - Enum violation sort.0.field |
| negative-search | bad-request | `request-validation/processdefinitions-validation-api-tests.spec.ts:911` | searchProcessDefinitions - Enum violation sort.0.order |

### `resource` — 36 tests

- **Prerequisite to create**: none
- **Files**: `createDeployment.feature.spec.ts`, `createDeployment.variant.spec.ts`, `deleteResource.feature.spec.ts`, `getResource.feature.spec.ts`, `getResourceContent.feature.spec.ts`, `getResourceContentBinary.feature.spec.ts`, `request-validation/deployments-validation-api-tests.spec.ts`, `request-validation/resources-validation-api-tests.spec.ts`, `searchResources.feature.spec.ts`, `searchResources.variant.spec.ts`
- **Observation channel**: GET = 3, Search = 6
- **Form-step counts**: create=5, observe-present-get=3, observe-present-search=6, delete=1, observe-absence=1, negative-create=8, negative-delete=7, negative-search=5
- **Variants**: happy-path=5, observe-absence=1, data-driven=10, bad-request=20

| form step | variants | file:line | test name |
|--|--|--|--|
| create | data-driven | `createDeployment.feature.spec.ts:12` | feature-1 - createDeployment - bpmn (1) |
| create | data-driven | `createDeployment.feature.spec.ts:41` | feature-2 - createDeployment - form (2) |
| create | data-driven | `createDeployment.feature.spec.ts:70` | feature-3 - createDeployment - dmn (3) |
| create | data-driven | `createDeployment.feature.spec.ts:99` | feature-4 - createDeployment - drd (4) |
| create | data-driven | `createDeployment.variant.spec.ts:12` | variant-1 - createDeployment - path #1 |
| observe-present-get | happy-path | `getResource.feature.spec.ts:12` | feature-1 - getResource - base (1) |
| observe-present-get | happy-path | `getResourceContent.feature.spec.ts:9` | feature-1 - getResourceContent - base (1) |
| observe-present-get | happy-path | `getResourceContentBinary.feature.spec.ts:9` | feature-1 - getResourceContentBinary - base (1) |
| observe-present-search | happy-path | `searchResources.feature.spec.ts:12` | feature-1 - searchResources - base (1) |
| observe-present-search | data-driven | `searchResources.variant.spec.ts:13` | variant-1 - searchResources - bpmn #1 |
| observe-present-search | data-driven | `searchResources.variant.spec.ts:62` | variant-2 - searchResources - path #1 |
| observe-present-search | data-driven | `searchResources.variant.spec.ts:130` | variant-3 - searchResources - path #1 |
| observe-present-search | data-driven | `searchResources.variant.spec.ts:180` | variant-4 - searchResources - path #1 |
| observe-present-search | data-driven | `searchResources.variant.spec.ts:232` | variant-5 - searchResources - path #1 |
| delete | happy-path | `deleteResource.feature.spec.ts:11` | feature-1 - deleteResource - base (1) |
| observe-absence | observe-absence | `searchResources.feature.spec.ts:35` | feature-2 - searchResources - negative empty (2) |
| negative-create | bad-request | `request-validation/deployments-validation-api-tests.spec.ts:18` | createDeployment - Additional prop __unexpectedField |
| negative-create | bad-request | `request-validation/deployments-validation-api-tests.spec.ts:39` | createDeployment - Param tenantId wrong type |
| negative-create | bad-request | `request-validation/deployments-validation-api-tests.spec.ts:59` | createDeployment - Constraint violation tenantId (#1) |
| negative-create | bad-request | `request-validation/deployments-validation-api-tests.spec.ts:79` | createDeployment - Constraint violation tenantId (#2) |
| negative-create | bad-request | `request-validation/deployments-validation-api-tests.spec.ts:99` | createDeployment - Constraint violation tenantId (#3) |
| negative-create | bad-request | `request-validation/deployments-validation-api-tests.spec.ts:119` | createDeployment - Constraint violation tenantId (#4) |
| negative-create | bad-request | `request-validation/deployments-validation-api-tests.spec.ts:139` | createDeployment - Missing body |
| negative-create | bad-request | `request-validation/deployments-validation-api-tests.spec.ts:156` | createDeployment - Missing resources |
| negative-delete | bad-request | `request-validation/resources-validation-api-tests.spec.ts:18` | deleteResource - Additional prop __unexpectedField |
| negative-delete | bad-request | `request-validation/resources-validation-api-tests.spec.ts:38` | deleteResource - Body wrong top-level type |
| negative-delete | bad-request | `request-validation/resources-validation-api-tests.spec.ts:55` | deleteResource - Param operationReference wrong type (#1) |
| negative-delete | bad-request | `request-validation/resources-validation-api-tests.spec.ts:76` | deleteResource - Param operationReference wrong type (#2) |
| negative-delete | bad-request | `request-validation/resources-validation-api-tests.spec.ts:97` | deleteResource - Constraint violation operationReference (#1) |
| negative-delete | bad-request | `request-validation/resources-validation-api-tests.spec.ts:118` | deleteResource - Constraint violation operationReference (#2) |
| negative-delete | bad-request | `request-validation/resources-validation-api-tests.spec.ts:139` | deleteResource - Constraint violation operationReference (#3) |
| negative-search | bad-request | `request-validation/resources-validation-api-tests.spec.ts:160` | searchResources - Additional prop __unexpectedField |
| negative-search | bad-request | `request-validation/resources-validation-api-tests.spec.ts:177` | searchResources - Body wrong top-level type |
| negative-search | bad-request | `request-validation/resources-validation-api-tests.spec.ts:192` | searchResources - Missing sort.0.field |
| negative-search | bad-request | `request-validation/resources-validation-api-tests.spec.ts:209` | searchResources - Enum violation sort.0.field |
| negative-search | bad-request | `request-validation/resources-validation-api-tests.spec.ts:230` | searchResources - Enum violation sort.0.order |

### `decision-definition` — 28 tests

- **Prerequisite to create**: deployed-decision
- **Files**: `evaluateDecision.feature.spec.ts`, `evaluateDecision.variant.spec.ts`, `getDecisionDefinition.feature.spec.ts`, `getDecisionDefinitionXML.feature.spec.ts`, `request-validation/decisiondefinitions-validation-api-tests.spec.ts`, `searchDecisionDefinitions.feature.spec.ts`, `searchDecisionDefinitions.variant.spec.ts`
- **Observation channel**: GET = 2, Search = 7
- **Form-step counts**: create=4, observe-present-get=2, observe-present-search=7, observe-absence=1, negative-create=7, negative-get=2, negative-search=5
- **Variants**: happy-path=4, observe-absence=1, data-driven=9, bad-request=14

| form step | variants | file:line | test name |
|--|--|--|--|
| create | happy-path | `evaluateDecision.feature.spec.ts:12` | feature-1 - evaluateDecision - base (1) |
| create | data-driven | `evaluateDecision.feature.spec.ts:61` | feature-2 - evaluateDecision - oneOf group0 Decision evaluation by ID (2) |
| create | data-driven | `evaluateDecision.feature.spec.ts:113` | feature-3 - evaluateDecision - oneOf group0 Decision evaluation by key (3) |
| create | data-driven | `evaluateDecision.variant.spec.ts:12` | variant-1 - evaluateDecision - dmn #1 |
| observe-present-get | happy-path | `getDecisionDefinition.feature.spec.ts:13` | feature-1 - getDecisionDefinition - base (1) |
| observe-present-get | happy-path | `getDecisionDefinitionXML.feature.spec.ts:10` | feature-1 - getDecisionDefinitionXML - base (1) |
| observe-present-search | happy-path | `searchDecisionDefinitions.feature.spec.ts:12` | feature-1 - searchDecisionDefinitions - base (1) |
| observe-present-search | data-driven | `searchDecisionDefinitions.variant.spec.ts:13` | variant-1 - searchDecisionDefinitions - dmn #1 |
| observe-present-search | data-driven | `searchDecisionDefinitions.variant.spec.ts:64` | variant-2 - searchDecisionDefinitions - path #1 |
| observe-present-search | data-driven | `searchDecisionDefinitions.variant.spec.ts:117` | variant-3 - searchDecisionDefinitions - dmn #1 |
| observe-present-search | data-driven | `searchDecisionDefinitions.variant.spec.ts:168` | variant-4 - searchDecisionDefinitions - drd #1 |
| observe-present-search | data-driven | `searchDecisionDefinitions.variant.spec.ts:219` | variant-5 - searchDecisionDefinitions - path #1 |
| observe-present-search | data-driven | `searchDecisionDefinitions.variant.spec.ts:273` | variant-6 - searchDecisionDefinitions - path #1 |
| observe-absence | observe-absence | `searchDecisionDefinitions.feature.spec.ts:37` | feature-2 - searchDecisionDefinitions - negative empty (2) |
| negative-create | bad-request | `request-validation/decisiondefinitions-validation-api-tests.spec.ts:18` | evaluateDecision - Additional prop __extraField |
| negative-create | bad-request | `request-validation/decisiondefinitions-validation-api-tests.spec.ts:35` | evaluateDecision - Body wrong top-level type |
| negative-create | bad-request | `request-validation/decisiondefinitions-validation-api-tests.spec.ts:50` | evaluateDecision - Missing body |
| negative-create | bad-request | `request-validation/decisiondefinitions-validation-api-tests.spec.ts:62` | evaluateDecision - oneOf ambiguous |
| negative-create | bad-request | `request-validation/decisiondefinitions-validation-api-tests.spec.ts:80` | evaluateDecision - oneOf cross bleed |
| negative-create | bad-request | `request-validation/decisiondefinitions-validation-api-tests.spec.ts:98` | evaluateDecision - oneOf none match |
| negative-create | bad-request | `request-validation/decisiondefinitions-validation-api-tests.spec.ts:113` | evaluateDecision - oneOf violation |
| negative-get | bad-request | `request-validation/decisiondefinitions-validation-api-tests.spec.ts:131` | getDecisionDefinition - Path param decisionDefinitionKey pattern violation |
| negative-get | bad-request | `request-validation/decisiondefinitions-validation-api-tests.spec.ts:147` | getDecisionDefinitionXML - Path param decisionDefinitionKey pattern violation |
| negative-search | bad-request | `request-validation/decisiondefinitions-validation-api-tests.spec.ts:163` | searchDecisionDefinitions - Additional prop __unexpectedField |
| negative-search | bad-request | `request-validation/decisiondefinitions-validation-api-tests.spec.ts:182` | searchDecisionDefinitions - Body wrong top-level type |
| negative-search | bad-request | `request-validation/decisiondefinitions-validation-api-tests.spec.ts:197` | searchDecisionDefinitions - Missing sort.0.field |
| negative-search | bad-request | `request-validation/decisiondefinitions-validation-api-tests.spec.ts:214` | searchDecisionDefinitions - Enum violation sort.0.field |
| negative-search | bad-request | `request-validation/decisiondefinitions-validation-api-tests.spec.ts:235` | searchDecisionDefinitions - Enum violation sort.0.order |

### `decision-requirements` — 15 tests

- **Prerequisite to create**: deployed-drd
- **Files**: `getDecisionRequirements.feature.spec.ts`, `getDecisionRequirementsXML.feature.spec.ts`, `request-validation/decisionrequirements-validation-api-tests.spec.ts`, `searchDecisionRequirements.feature.spec.ts`, `searchDecisionRequirements.variant.spec.ts`
- **Observation channel**: GET = 2, Search = 5
- **Form-step counts**: observe-present-get=2, observe-present-search=5, observe-absence=1, negative-get=2, negative-search=5
- **Variants**: happy-path=3, observe-absence=1, data-driven=4, bad-request=7

| form step | variants | file:line | test name |
|--|--|--|--|
| observe-present-get | happy-path | `getDecisionRequirements.feature.spec.ts:13` | feature-1 - getDecisionRequirements - base (1) |
| observe-present-get | happy-path | `getDecisionRequirementsXML.feature.spec.ts:10` | feature-1 - getDecisionRequirementsXML - base (1) |
| observe-present-search | happy-path | `searchDecisionRequirements.feature.spec.ts:12` | feature-1 - searchDecisionRequirements - base (1) |
| observe-present-search | data-driven | `searchDecisionRequirements.variant.spec.ts:13` | variant-1 - searchDecisionRequirements - drd #1 |
| observe-present-search | data-driven | `searchDecisionRequirements.variant.spec.ts:64` | variant-2 - searchDecisionRequirements - path #1 |
| observe-present-search | data-driven | `searchDecisionRequirements.variant.spec.ts:116` | variant-3 - searchDecisionRequirements - path #1 |
| observe-present-search | data-driven | `searchDecisionRequirements.variant.spec.ts:170` | variant-4 - searchDecisionRequirements - path #1 |
| observe-absence | observe-absence | `searchDecisionRequirements.feature.spec.ts:37` | feature-2 - searchDecisionRequirements - negative empty (2) |
| negative-get | bad-request | `request-validation/decisionrequirements-validation-api-tests.spec.ts:18` | getDecisionRequirements - Path param decisionRequirementsKey pattern violation |
| negative-get | bad-request | `request-validation/decisionrequirements-validation-api-tests.spec.ts:34` | getDecisionRequirementsXML - Path param decisionRequirementsKey pattern violation |
| negative-search | bad-request | `request-validation/decisionrequirements-validation-api-tests.spec.ts:50` | searchDecisionRequirements - Additional prop __unexpectedField |
| negative-search | bad-request | `request-validation/decisionrequirements-validation-api-tests.spec.ts:69` | searchDecisionRequirements - Body wrong top-level type |
| negative-search | bad-request | `request-validation/decisionrequirements-validation-api-tests.spec.ts:84` | searchDecisionRequirements - Missing sort.0.field |
| negative-search | bad-request | `request-validation/decisionrequirements-validation-api-tests.spec.ts:101` | searchDecisionRequirements - Enum violation sort.0.field |
| negative-search | bad-request | `request-validation/decisionrequirements-validation-api-tests.spec.ts:124` | searchDecisionRequirements - Enum violation sort.0.order |

## D. Process-Instance Lifecycle & Ops

**Form**: Deploy process (prerequisite) → Create instance → Get/Search instance → Cancel/Migrate/Modify/Resolve-incident → Delete → Observe absence. Batch creators wrap N instances per call.

**Total tests**: 282

### `process-instance` — 282 tests

- **Prerequisite to create**: deployed-process
- **Files**: `cancelProcessInstance.feature.spec.ts`, `cancelProcessInstancesBatchOperation.feature.spec.ts`, `cancelProcessInstancesBatchOperation.variant.spec.ts`, `createProcessInstance.feature.spec.ts`, `createProcessInstance.variant.spec.ts`, `deleteProcessInstance.feature.spec.ts`, `deleteProcessInstancesBatchOperation.feature.spec.ts`, `deleteProcessInstancesBatchOperation.variant.spec.ts`, `getProcessInstance.feature.spec.ts`, `getProcessInstanceCallHierarchy.feature.spec.ts`, `getProcessInstanceSequenceFlows.feature.spec.ts`, `getProcessInstanceStatistics.feature.spec.ts`, `migrateProcessInstance.feature.spec.ts`, `migrateProcessInstance.variant.spec.ts`, `migrateProcessInstancesBatchOperation.feature.spec.ts`, `migrateProcessInstancesBatchOperation.variant.spec.ts`, `modifyProcessInstance.feature.spec.ts`, `modifyProcessInstance.variant.spec.ts`, `modifyProcessInstancesBatchOperation.feature.spec.ts`, `modifyProcessInstancesBatchOperation.variant.spec.ts`, `request-validation/processinstances-validation-api-tests.spec.ts`, `resolveIncidentsBatchOperation.feature.spec.ts`, `resolveIncidentsBatchOperation.variant.spec.ts`, `resolveProcessInstanceIncidents.feature.spec.ts`, `searchProcessInstanceIncidents.feature.spec.ts`, `searchProcessInstanceIncidents.variant.spec.ts`, `searchProcessInstances.feature.spec.ts`, `searchProcessInstances.variant.spec.ts`
- **Observation channel**: GET = 4, Search = 20
- **Form-step counts**: create=8, observe-present-get=4, observe-present-search=20, mutate=50, delete=24, observe-absence=1, negative-create=6, negative-get=4, negative-update=98, negative-delete=50, negative-search=17
- **Variants**: happy-path=17, observe-absence=1, data-driven=89, bad-request=175

| form step | variants | file:line | test name |
|--|--|--|--|
| create | happy-path | `createProcessInstance.feature.spec.ts:12` | feature-1 - createProcessInstance - base (1) |
| create | data-driven | `createProcessInstance.feature.spec.ts:57` | feature-2 - createProcessInstance - oneOf group0 Process creation by key (2) |
| create | data-driven | `createProcessInstance.feature.spec.ts:105` | feature-3 - createProcessInstance - oneOf group0 Process creation by id (3) |
| create | data-driven | `createProcessInstance.variant.spec.ts:13` | variant-1 - createProcessInstance - bpmn #1 |
| create | data-driven | `createProcessInstance.variant.spec.ts:66` | variant-2 - createProcessInstance - bpmn #1 |
| create | data-driven | `createProcessInstance.variant.spec.ts:119` | variant-3 - createProcessInstance - bpmn #1 |
| create | data-driven | `createProcessInstance.variant.spec.ts:187` | variant-4 - createProcessInstance - bpmn #1 |
| create | data-driven | `createProcessInstance.variant.spec.ts:283` | variant-5 - createProcessInstance - bpmn #1 |
| observe-present-get | happy-path | `getProcessInstance.feature.spec.ts:13` | feature-1 - getProcessInstance - base (1) |
| observe-present-get | happy-path | `getProcessInstanceCallHierarchy.feature.spec.ts:10` | feature-1 - getProcessInstanceCallHierarchy - base (1) |
| observe-present-get | happy-path | `getProcessInstanceSequenceFlows.feature.spec.ts:13` | feature-1 - getProcessInstanceSequenceFlows - base (1) |
| observe-present-get | happy-path | `getProcessInstanceStatistics.feature.spec.ts:13` | feature-1 - getProcessInstanceStatistics - base (1) |
| observe-present-search | happy-path | `searchProcessInstanceIncidents.feature.spec.ts:13` | feature-1 - searchProcessInstanceIncidents - base (1) |
| observe-present-search | data-driven | `searchProcessInstanceIncidents.variant.spec.ts:13` | variant-1 - searchProcessInstanceIncidents - cycle/bpmn+bpmn #1 |
| observe-present-search | data-driven | `searchProcessInstanceIncidents.variant.spec.ts:109` | variant-2 - searchProcessInstanceIncidents - bpmn #1 |
| observe-present-search | data-driven | `searchProcessInstanceIncidents.variant.spec.ts:187` | variant-3 - searchProcessInstanceIncidents - bpmn #1 |
| observe-present-search | data-driven | `searchProcessInstanceIncidents.variant.spec.ts:297` | variant-4 - searchProcessInstanceIncidents - bpmn #1 |
| observe-present-search | data-driven | `searchProcessInstanceIncidents.variant.spec.ts:407` | variant-5 - searchProcessInstanceIncidents - bpmn #1 |
| observe-present-search | data-driven | `searchProcessInstanceIncidents.variant.spec.ts:512` | variant-6 - searchProcessInstanceIncidents - bpmn #1 |
| observe-present-search | happy-path | `searchProcessInstances.feature.spec.ts:13` | feature-1 - searchProcessInstances - base (1) |
| observe-present-search | data-driven | `searchProcessInstances.variant.spec.ts:13` | variant-1 - searchProcessInstances - path #1 |
| observe-present-search | data-driven | `searchProcessInstances.variant.spec.ts:87` | variant-2 - searchProcessInstances - bpmn #1 |
| observe-present-search | data-driven | `searchProcessInstances.variant.spec.ts:161` | variant-3 - searchProcessInstances - bpmn #1 |
| observe-present-search | data-driven | `searchProcessInstances.variant.spec.ts:235` | variant-4 - searchProcessInstances - bpmn #1 |
| observe-present-search | data-driven | `searchProcessInstances.variant.spec.ts:337` | variant-5 - searchProcessInstances - bpmn #1 |
| observe-present-search | data-driven | `searchProcessInstances.variant.spec.ts:440` | variant-6 - searchProcessInstances - path #1 |
| observe-present-search | data-driven | `searchProcessInstances.variant.spec.ts:518` | variant-7 - searchProcessInstances - bpmn #1 |
| observe-present-search | data-driven | `searchProcessInstances.variant.spec.ts:596` | variant-8 - searchProcessInstances - bpmn #1 |
| observe-present-search | data-driven | `searchProcessInstances.variant.spec.ts:674` | variant-9 - searchProcessInstances - bpmn #1 |
| observe-present-search | data-driven | `searchProcessInstances.variant.spec.ts:780` | variant-10 - searchProcessInstances - bpmn #1 |
| observe-present-search | data-driven | `searchProcessInstances.variant.spec.ts:887` | variant-11 - searchProcessInstances - path #1 |
| observe-present-search | data-driven | `searchProcessInstances.variant.spec.ts:983` | variant-12 - searchProcessInstances - path #1 |
| mutate | happy-path | `migrateProcessInstance.feature.spec.ts:9` | feature-1 - migrateProcessInstance - base (1) |
| mutate | data-driven | `migrateProcessInstance.variant.spec.ts:9` | variant-1 - migrateProcessInstance - cycle/bpmn+bpmn #1 |
| mutate | data-driven | `migrateProcessInstance.variant.spec.ts:121` | variant-2 - migrateProcessInstance - cycle/bpmn+bpmn #1 |
| mutate | happy-path | `migrateProcessInstancesBatchOperation.feature.spec.ts:12` | feature-1 - migrateProcessInstancesBatchOperation - base (1) |
| mutate | data-driven | `migrateProcessInstancesBatchOperation.variant.spec.ts:12` | variant-1 - migrateProcessInstancesBatchOperation - bpmn #1 |
| mutate | data-driven | `migrateProcessInstancesBatchOperation.variant.spec.ts:66` | variant-2 - migrateProcessInstancesBatchOperation - bpmn #1 |
| mutate | data-driven | `migrateProcessInstancesBatchOperation.variant.spec.ts:141` | variant-3 - migrateProcessInstancesBatchOperation - bpmn #1 |
| mutate | data-driven | `migrateProcessInstancesBatchOperation.variant.spec.ts:216` | variant-4 - migrateProcessInstancesBatchOperation - bpmn #1 |
| mutate | data-driven | `migrateProcessInstancesBatchOperation.variant.spec.ts:271` | variant-5 - migrateProcessInstancesBatchOperation - bpmn #1 |
| mutate | data-driven | `migrateProcessInstancesBatchOperation.variant.spec.ts:326` | variant-6 - migrateProcessInstancesBatchOperation - bpmn #1 |
| mutate | data-driven | `migrateProcessInstancesBatchOperation.variant.spec.ts:384` | variant-7 - migrateProcessInstancesBatchOperation - bpmn #1 |
| mutate | data-driven | `migrateProcessInstancesBatchOperation.variant.spec.ts:463` | variant-8 - migrateProcessInstancesBatchOperation - bpmn #1 |
| mutate | data-driven | `migrateProcessInstancesBatchOperation.variant.spec.ts:542` | variant-9 - migrateProcessInstancesBatchOperation - bpmn #1 |
| mutate | data-driven | `migrateProcessInstancesBatchOperation.variant.spec.ts:601` | variant-10 - migrateProcessInstancesBatchOperation - bpmn #1 |
| mutate | data-driven | `migrateProcessInstancesBatchOperation.variant.spec.ts:660` | variant-11 - migrateProcessInstancesBatchOperation - bpmn #1 |
| mutate | data-driven | `migrateProcessInstancesBatchOperation.variant.spec.ts:720` | variant-12 - migrateProcessInstancesBatchOperation - bpmn #1 |
| mutate | happy-path | `modifyProcessInstance.feature.spec.ts:9` | feature-1 - modifyProcessInstance - base (1) |
| mutate | data-driven | `modifyProcessInstance.variant.spec.ts:9` | variant-1 - modifyProcessInstance - bpmn #1 |
| mutate | data-driven | `modifyProcessInstance.variant.spec.ts:102` | variant-2 - modifyProcessInstance - bpmn #1 |
| mutate | data-driven | `modifyProcessInstance.variant.spec.ts:195` | variant-3 - modifyProcessInstance - bpmn #1 |
| mutate | data-driven | `modifyProcessInstance.variant.spec.ts:290` | variant-4 - modifyProcessInstance - bpmn #1 |
| mutate | data-driven | `modifyProcessInstance.variant.spec.ts:385` | variant-5 - modifyProcessInstance - bpmn #1 |
| mutate | data-driven | `modifyProcessInstance.variant.spec.ts:478` | variant-6 - modifyProcessInstance - bpmn #1 |
| mutate | data-driven | `modifyProcessInstance.variant.spec.ts:573` | variant-7 - modifyProcessInstance - bpmn #1 |
| mutate | data-driven | `modifyProcessInstance.variant.spec.ts:666` | variant-8 - modifyProcessInstance - bpmn #1 |
| mutate | happy-path | `modifyProcessInstancesBatchOperation.feature.spec.ts:11` | feature-1 - modifyProcessInstancesBatchOperation - base (1) |
| mutate | data-driven | `modifyProcessInstancesBatchOperation.variant.spec.ts:12` | variant-1 - modifyProcessInstancesBatchOperation - bpmn #1 |
| mutate | data-driven | `modifyProcessInstancesBatchOperation.variant.spec.ts:65` | variant-2 - modifyProcessInstancesBatchOperation - bpmn #1 |
| mutate | data-driven | `modifyProcessInstancesBatchOperation.variant.spec.ts:139` | variant-3 - modifyProcessInstancesBatchOperation - bpmn #1 |
| mutate | data-driven | `modifyProcessInstancesBatchOperation.variant.spec.ts:213` | variant-4 - modifyProcessInstancesBatchOperation - bpmn #1 |
| mutate | data-driven | `modifyProcessInstancesBatchOperation.variant.spec.ts:315` | variant-5 - modifyProcessInstancesBatchOperation - bpmn #1 |
| mutate | data-driven | `modifyProcessInstancesBatchOperation.variant.spec.ts:417` | variant-6 - modifyProcessInstancesBatchOperation - bpmn #1 |
| mutate | data-driven | `modifyProcessInstancesBatchOperation.variant.spec.ts:474` | variant-7 - modifyProcessInstancesBatchOperation - bpmn #1 |
| mutate | data-driven | `modifyProcessInstancesBatchOperation.variant.spec.ts:552` | variant-8 - modifyProcessInstancesBatchOperation - bpmn #1 |
| mutate | data-driven | `modifyProcessInstancesBatchOperation.variant.spec.ts:630` | variant-9 - modifyProcessInstancesBatchOperation - bpmn #1 |
| mutate | data-driven | `modifyProcessInstancesBatchOperation.variant.spec.ts:736` | variant-10 - modifyProcessInstancesBatchOperation - bpmn #1 |
| mutate | data-driven | `modifyProcessInstancesBatchOperation.variant.spec.ts:842` | variant-11 - modifyProcessInstancesBatchOperation - bpmn #1 |
| mutate | data-driven | `modifyProcessInstancesBatchOperation.variant.spec.ts:946` | variant-12 - modifyProcessInstancesBatchOperation - bpmn #1 |
| mutate | happy-path | `resolveIncidentsBatchOperation.feature.spec.ts:11` | feature-1 - resolveIncidentsBatchOperation - base (1) |
| mutate | data-driven | `resolveIncidentsBatchOperation.variant.spec.ts:12` | variant-1 - resolveIncidentsBatchOperation - bpmn #1 |
| mutate | data-driven | `resolveIncidentsBatchOperation.variant.spec.ts:64` | variant-2 - resolveIncidentsBatchOperation - bpmn #1 |
| mutate | data-driven | `resolveIncidentsBatchOperation.variant.spec.ts:137` | variant-3 - resolveIncidentsBatchOperation - bpmn #1 |
| mutate | data-driven | `resolveIncidentsBatchOperation.variant.spec.ts:210` | variant-4 - resolveIncidentsBatchOperation - bpmn #1 |
| mutate | data-driven | `resolveIncidentsBatchOperation.variant.spec.ts:311` | variant-5 - resolveIncidentsBatchOperation - bpmn #1 |
| mutate | data-driven | `resolveIncidentsBatchOperation.variant.spec.ts:412` | variant-6 - resolveIncidentsBatchOperation - bpmn #1 |
| mutate | data-driven | `resolveIncidentsBatchOperation.variant.spec.ts:468` | variant-7 - resolveIncidentsBatchOperation - bpmn #1 |
| mutate | data-driven | `resolveIncidentsBatchOperation.variant.spec.ts:545` | variant-8 - resolveIncidentsBatchOperation - bpmn #1 |
| mutate | data-driven | `resolveIncidentsBatchOperation.variant.spec.ts:622` | variant-9 - resolveIncidentsBatchOperation - bpmn #1 |
| mutate | data-driven | `resolveIncidentsBatchOperation.variant.spec.ts:727` | variant-10 - resolveIncidentsBatchOperation - bpmn #1 |
| mutate | happy-path | `resolveProcessInstanceIncidents.feature.spec.ts:12` | feature-1 - resolveProcessInstanceIncidents - base (1) |
| delete | happy-path | `cancelProcessInstance.feature.spec.ts:9` | feature-1 - cancelProcessInstance - base (1) |
| delete | happy-path | `cancelProcessInstancesBatchOperation.feature.spec.ts:11` | feature-1 - cancelProcessInstancesBatchOperation - base (1) |
| delete | data-driven | `cancelProcessInstancesBatchOperation.variant.spec.ts:12` | variant-1 - cancelProcessInstancesBatchOperation - bpmn #1 |
| delete | data-driven | `cancelProcessInstancesBatchOperation.variant.spec.ts:64` | variant-2 - cancelProcessInstancesBatchOperation - bpmn #1 |
| delete | data-driven | `cancelProcessInstancesBatchOperation.variant.spec.ts:137` | variant-3 - cancelProcessInstancesBatchOperation - bpmn #1 |
| delete | data-driven | `cancelProcessInstancesBatchOperation.variant.spec.ts:210` | variant-4 - cancelProcessInstancesBatchOperation - bpmn #1 |
| delete | data-driven | `cancelProcessInstancesBatchOperation.variant.spec.ts:311` | variant-5 - cancelProcessInstancesBatchOperation - bpmn #1 |
| delete | data-driven | `cancelProcessInstancesBatchOperation.variant.spec.ts:412` | variant-6 - cancelProcessInstancesBatchOperation - bpmn #1 |
| delete | data-driven | `cancelProcessInstancesBatchOperation.variant.spec.ts:468` | variant-7 - cancelProcessInstancesBatchOperation - bpmn #1 |
| delete | data-driven | `cancelProcessInstancesBatchOperation.variant.spec.ts:545` | variant-8 - cancelProcessInstancesBatchOperation - bpmn #1 |
| delete | data-driven | `cancelProcessInstancesBatchOperation.variant.spec.ts:622` | variant-9 - cancelProcessInstancesBatchOperation - bpmn #1 |
| delete | data-driven | `cancelProcessInstancesBatchOperation.variant.spec.ts:727` | variant-10 - cancelProcessInstancesBatchOperation - bpmn #1 |
| delete | happy-path | `deleteProcessInstance.feature.spec.ts:10` | feature-1 - deleteProcessInstance - base (1) |
| delete | happy-path | `deleteProcessInstancesBatchOperation.feature.spec.ts:11` | feature-1 - deleteProcessInstancesBatchOperation - base (1) |
| delete | data-driven | `deleteProcessInstancesBatchOperation.variant.spec.ts:12` | variant-1 - deleteProcessInstancesBatchOperation - bpmn #1 |
| delete | data-driven | `deleteProcessInstancesBatchOperation.variant.spec.ts:64` | variant-2 - deleteProcessInstancesBatchOperation - bpmn #1 |
| delete | data-driven | `deleteProcessInstancesBatchOperation.variant.spec.ts:137` | variant-3 - deleteProcessInstancesBatchOperation - bpmn #1 |
| delete | data-driven | `deleteProcessInstancesBatchOperation.variant.spec.ts:210` | variant-4 - deleteProcessInstancesBatchOperation - bpmn #1 |
| delete | data-driven | `deleteProcessInstancesBatchOperation.variant.spec.ts:311` | variant-5 - deleteProcessInstancesBatchOperation - bpmn #1 |
| delete | data-driven | `deleteProcessInstancesBatchOperation.variant.spec.ts:412` | variant-6 - deleteProcessInstancesBatchOperation - bpmn #1 |
| delete | data-driven | `deleteProcessInstancesBatchOperation.variant.spec.ts:468` | variant-7 - deleteProcessInstancesBatchOperation - bpmn #1 |
| delete | data-driven | `deleteProcessInstancesBatchOperation.variant.spec.ts:545` | variant-8 - deleteProcessInstancesBatchOperation - bpmn #1 |
| delete | data-driven | `deleteProcessInstancesBatchOperation.variant.spec.ts:622` | variant-9 - deleteProcessInstancesBatchOperation - bpmn #1 |
| delete | data-driven | `deleteProcessInstancesBatchOperation.variant.spec.ts:727` | variant-10 - deleteProcessInstancesBatchOperation - bpmn #1 |
| observe-absence | observe-absence | `searchProcessInstances.feature.spec.ts:80` | feature-2 - searchProcessInstances - negative empty (2) |
| negative-create | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:556` | createProcessInstance - Body wrong top-level type |
| negative-create | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:571` | createProcessInstance - Missing body |
| negative-create | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:583` | createProcessInstance - oneOf ambiguous |
| negative-create | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:601` | createProcessInstance - oneOf cross bleed |
| negative-create | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:619` | createProcessInstance - oneOf none match |
| negative-create | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:634` | createProcessInstance - oneOf violation |
| negative-get | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:1190` | getProcessInstance - Path param processInstanceKey pattern violation |
| negative-get | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:1206` | getProcessInstanceCallHierarchy - Path param processInstanceKey pattern violation |
| negative-get | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:1222` | getProcessInstanceSequenceFlows - Path param processInstanceKey pattern violation |
| negative-get | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:1238` | getProcessInstanceStatistics - Path param processInstanceKey pattern violation |
| negative-update | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:1254` | migrateProcessInstance - Additional prop __unexpectedField |
| negative-update | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:1283` | migrateProcessInstance - Body wrong top-level type |
| negative-update | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:1300` | migrateProcessInstance - Param operationReference wrong type (#1) |
| negative-update | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:1328` | migrateProcessInstance - Param operationReference wrong type (#2) |
| negative-update | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:1356` | migrateProcessInstance - Param targetProcessDefinitionKey wrong type (#1) |
| negative-update | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:1384` | migrateProcessInstance - Param targetProcessDefinitionKey wrong type (#2) |
| negative-update | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:1412` | migrateProcessInstance - Constraint violation operationReference (#1) |
| negative-update | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:1440` | migrateProcessInstance - Constraint violation operationReference (#2) |
| negative-update | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:1468` | migrateProcessInstance - Constraint violation operationReference (#3) |
| negative-update | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:1496` | migrateProcessInstance - Missing mappingInstructions.0.sourceElementId |
| negative-update | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:1522` | migrateProcessInstance - Missing mappingInstructions.0.targetElementId |
| negative-update | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:1548` | migrateProcessInstance - Missing targetProcessDefinitionKey (#1) |
| negative-update | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:1574` | migrateProcessInstance - Missing mappingInstructions |
| negative-update | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:1593` | migrateProcessInstance - Missing targetProcessDefinitionKey (#2) |
| negative-update | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:1614` | migrateProcessInstance - Missing body |
| negative-update | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:1628` | migrateProcessInstance - Missing combo targetProcessDefinitionKey,mappingInstructions |
| negative-update | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:1647` | migrateProcessInstance - Path param processInstanceKey pattern violation |
| negative-update | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:1663` | migrateProcessInstancesBatchOperation - Additional prop __unexpectedField |
| negative-update | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:1695` | migrateProcessInstancesBatchOperation - Body wrong top-level type |
| negative-update | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:1712` | migrateProcessInstancesBatchOperation - Param migrationPlan.targetProcessDefinitionKey wrong type (#1) |
| negative-update | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:1743` | migrateProcessInstancesBatchOperation - Param migrationPlan.targetProcessDefinitionKey wrong type (#2) |
| negative-update | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:1774` | migrateProcessInstancesBatchOperation - Param operationReference wrong type (#1) |
| negative-update | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:1805` | migrateProcessInstancesBatchOperation - Param operationReference wrong type (#2) |
| negative-update | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:1836` | migrateProcessInstancesBatchOperation - Constraint violation filter.tags (#1) |
| negative-update | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:1867` | migrateProcessInstancesBatchOperation - Constraint violation filter.tags (#2) |
| negative-update | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:1898` | migrateProcessInstancesBatchOperation - Constraint violation operationReference (#1) |
| negative-update | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:1929` | migrateProcessInstancesBatchOperation - Constraint violation operationReference (#2) |
| negative-update | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:1960` | migrateProcessInstancesBatchOperation - Constraint violation operationReference (#3) |
| negative-update | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:1991` | migrateProcessInstancesBatchOperation - Missing filter (#1) |
| negative-update | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:2018` | migrateProcessInstancesBatchOperation - Missing filter.$or.0.variables.0.name |
| negative-update | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:2056` | migrateProcessInstancesBatchOperation - Missing filter.$or.0.variables.0.value |
| negative-update | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:2094` | migrateProcessInstancesBatchOperation - Missing filter.variables.0.name |
| negative-update | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:2128` | migrateProcessInstancesBatchOperation - Missing filter.variables.0.value |
| negative-update | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:2162` | migrateProcessInstancesBatchOperation - Missing migrationPlan (#1) |
| negative-update | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:2181` | migrateProcessInstancesBatchOperation - Missing migrationPlan.mappingInstructions |
| negative-update | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:2203` | migrateProcessInstancesBatchOperation - Missing migrationPlan.mappingInstructions.0.sourceElementId |
| negative-update | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:2230` | migrateProcessInstancesBatchOperation - Missing migrationPlan.mappingInstructions.0.targetElementId |
| negative-update | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:2257` | migrateProcessInstancesBatchOperation - Missing migrationPlan.targetProcessDefinitionKey |
| negative-update | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:2284` | migrateProcessInstancesBatchOperation - Missing filter (#2) |
| negative-update | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:2303` | migrateProcessInstancesBatchOperation - Missing migrationPlan (#2) |
| negative-update | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:2322` | migrateProcessInstancesBatchOperation - Missing body |
| negative-update | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:2334` | migrateProcessInstancesBatchOperation - Missing combo filter,migrationPlan |
| negative-update | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:2351` | migrateProcessInstancesBatchOperation - uniqueItems violation filter.$or.0.tags |
| negative-update | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:2387` | migrateProcessInstancesBatchOperation - uniqueItems violation filter.tags |
| negative-update | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:2418` | modifyProcessInstance - Additional prop __unexpectedField |
| negative-update | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:2440` | modifyProcessInstance - Body wrong top-level type |
| negative-update | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:2457` | modifyProcessInstance - Param operationReference wrong type (#1) |
| negative-update | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:2478` | modifyProcessInstance - Param operationReference wrong type (#2) |
| negative-update | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:2499` | modifyProcessInstance - Constraint violation operationReference (#1) |
| negative-update | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:2520` | modifyProcessInstance - Constraint violation operationReference (#2) |
| negative-update | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:2541` | modifyProcessInstance - Constraint violation operationReference (#3) |
| negative-update | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:2562` | modifyProcessInstance - Missing activateInstructions.0.elementId |
| negative-update | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:2583` | modifyProcessInstance - Missing activateInstructions.0.variableInstructions.0.variables |
| negative-update | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:2609` | modifyProcessInstance - Missing moveInstructions.0.sourceElementInstruction |
| negative-update | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:2634` | modifyProcessInstance - Missing moveInstructions.0.targetElementId |
| negative-update | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:2659` | modifyProcessInstance - Missing moveInstructions.0.variableInstructions.0.variables |
| negative-update | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:2686` | modifyProcessInstance - Missing body |
| negative-update | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:2700` | modifyProcessInstance - Path param processInstanceKey pattern violation |
| negative-update | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:2716` | modifyProcessInstancesBatchOperation - Additional prop __unexpectedField |
| negative-update | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:2745` | modifyProcessInstancesBatchOperation - Body wrong top-level type |
| negative-update | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:2762` | modifyProcessInstancesBatchOperation - Param operationReference wrong type (#1) |
| negative-update | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:2790` | modifyProcessInstancesBatchOperation - Param operationReference wrong type (#2) |
| negative-update | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:2818` | modifyProcessInstancesBatchOperation - Constraint violation filter.tags (#1) |
| negative-update | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:2846` | modifyProcessInstancesBatchOperation - Constraint violation filter.tags (#2) |
| negative-update | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:2874` | modifyProcessInstancesBatchOperation - Constraint violation operationReference (#1) |
| negative-update | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:2902` | modifyProcessInstancesBatchOperation - Constraint violation operationReference (#2) |
| negative-update | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:2930` | modifyProcessInstancesBatchOperation - Constraint violation operationReference (#3) |
| negative-update | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:2958` | modifyProcessInstancesBatchOperation - Missing filter (#1) |
| negative-update | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:2982` | modifyProcessInstancesBatchOperation - Missing filter.$or.0.variables.0.name |
| negative-update | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:3017` | modifyProcessInstancesBatchOperation - Missing filter.$or.0.variables.0.value |
| negative-update | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:3052` | modifyProcessInstancesBatchOperation - Missing filter.variables.0.name |
| negative-update | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:3083` | modifyProcessInstancesBatchOperation - Missing filter.variables.0.value |
| negative-update | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:3114` | modifyProcessInstancesBatchOperation - Missing moveInstructions (#1) |
| negative-update | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:3133` | modifyProcessInstancesBatchOperation - Missing moveInstructions.0.sourceElementId |
| negative-update | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:3157` | modifyProcessInstancesBatchOperation - Missing moveInstructions.0.targetElementId |
| negative-update | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:3181` | modifyProcessInstancesBatchOperation - Missing filter (#2) |
| negative-update | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:3200` | modifyProcessInstancesBatchOperation - Missing moveInstructions (#2) |
| negative-update | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:3219` | modifyProcessInstancesBatchOperation - Missing body |
| negative-update | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:3231` | modifyProcessInstancesBatchOperation - Missing combo filter,moveInstructions |
| negative-update | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:3248` | modifyProcessInstancesBatchOperation - uniqueItems violation filter.$or.0.tags |
| negative-update | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:3281` | modifyProcessInstancesBatchOperation - uniqueItems violation filter.tags |
| negative-update | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:3309` | resolveIncidentsBatchOperation - Additional prop __unexpectedField |
| negative-update | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:3332` | resolveIncidentsBatchOperation - Body wrong top-level type |
| negative-update | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:3349` | resolveIncidentsBatchOperation - Param operationReference wrong type (#1) |
| negative-update | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:3371` | resolveIncidentsBatchOperation - Param operationReference wrong type (#2) |
| negative-update | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:3393` | resolveIncidentsBatchOperation - Constraint violation filter.tags (#1) |
| negative-update | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:3415` | resolveIncidentsBatchOperation - Constraint violation filter.tags (#2) |
| negative-update | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:3437` | resolveIncidentsBatchOperation - Constraint violation operationReference (#1) |
| negative-update | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:3459` | resolveIncidentsBatchOperation - Constraint violation operationReference (#2) |
| negative-update | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:3481` | resolveIncidentsBatchOperation - Constraint violation operationReference (#3) |
| negative-update | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:3503` | resolveIncidentsBatchOperation - Missing filter.$or.0.variables.0.name |
| negative-update | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:3532` | resolveIncidentsBatchOperation - Missing filter.$or.0.variables.0.value |
| negative-update | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:3561` | resolveIncidentsBatchOperation - Missing filter.variables.0.name |
| negative-update | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:3586` | resolveIncidentsBatchOperation - Missing filter.variables.0.value |
| negative-update | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:3611` | resolveIncidentsBatchOperation - Missing filter |
| negative-update | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:3626` | resolveIncidentsBatchOperation - uniqueItems violation filter.$or.0.tags |
| negative-update | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:3653` | resolveIncidentsBatchOperation - uniqueItems violation filter.tags |
| negative-update | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:3675` | resolveProcessInstanceIncidents - Path param processInstanceKey pattern violation |
| negative-delete | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:18` | cancelProcessInstance - Additional prop __unexpectedField |
| negative-delete | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:40` | cancelProcessInstance - Body wrong top-level type |
| negative-delete | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:57` | cancelProcessInstance - Param operationReference wrong type (#1) |
| negative-delete | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:78` | cancelProcessInstance - Param operationReference wrong type (#2) |
| negative-delete | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:99` | cancelProcessInstance - Constraint violation operationReference (#1) |
| negative-delete | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:120` | cancelProcessInstance - Constraint violation operationReference (#2) |
| negative-delete | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:141` | cancelProcessInstance - Constraint violation operationReference (#3) |
| negative-delete | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:162` | cancelProcessInstance - Path param processInstanceKey pattern violation |
| negative-delete | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:178` | cancelProcessInstancesBatchOperation - Additional prop __unexpectedField |
| negative-delete | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:201` | cancelProcessInstancesBatchOperation - Body wrong top-level type |
| negative-delete | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:218` | cancelProcessInstancesBatchOperation - Param operationReference wrong type (#1) |
| negative-delete | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:240` | cancelProcessInstancesBatchOperation - Param operationReference wrong type (#2) |
| negative-delete | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:262` | cancelProcessInstancesBatchOperation - Constraint violation filter.tags (#1) |
| negative-delete | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:284` | cancelProcessInstancesBatchOperation - Constraint violation filter.tags (#2) |
| negative-delete | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:306` | cancelProcessInstancesBatchOperation - Constraint violation operationReference (#1) |
| negative-delete | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:328` | cancelProcessInstancesBatchOperation - Constraint violation operationReference (#2) |
| negative-delete | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:350` | cancelProcessInstancesBatchOperation - Constraint violation operationReference (#3) |
| negative-delete | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:372` | cancelProcessInstancesBatchOperation - Missing filter.$or.0.variables.0.name |
| negative-delete | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:401` | cancelProcessInstancesBatchOperation - Missing filter.$or.0.variables.0.value |
| negative-delete | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:430` | cancelProcessInstancesBatchOperation - Missing filter.variables.0.name |
| negative-delete | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:455` | cancelProcessInstancesBatchOperation - Missing filter.variables.0.value |
| negative-delete | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:480` | cancelProcessInstancesBatchOperation - Missing filter |
| negative-delete | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:495` | cancelProcessInstancesBatchOperation - Missing body |
| negative-delete | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:507` | cancelProcessInstancesBatchOperation - uniqueItems violation filter.$or.0.tags |
| negative-delete | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:534` | cancelProcessInstancesBatchOperation - uniqueItems violation filter.tags |
| negative-delete | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:652` | deleteProcessInstance - Additional prop __unexpectedField |
| negative-delete | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:674` | deleteProcessInstance - Body wrong top-level type |
| negative-delete | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:691` | deleteProcessInstance - Param operationReference wrong type (#1) |
| negative-delete | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:712` | deleteProcessInstance - Param operationReference wrong type (#2) |
| negative-delete | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:733` | deleteProcessInstance - Constraint violation operationReference (#1) |
| negative-delete | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:754` | deleteProcessInstance - Constraint violation operationReference (#2) |
| negative-delete | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:775` | deleteProcessInstance - Constraint violation operationReference (#3) |
| negative-delete | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:796` | deleteProcessInstance - Path param processInstanceKey pattern violation |
| negative-delete | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:812` | deleteProcessInstancesBatchOperation - Additional prop __unexpectedField |
| negative-delete | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:835` | deleteProcessInstancesBatchOperation - Body wrong top-level type |
| negative-delete | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:852` | deleteProcessInstancesBatchOperation - Param operationReference wrong type (#1) |
| negative-delete | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:874` | deleteProcessInstancesBatchOperation - Param operationReference wrong type (#2) |
| negative-delete | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:896` | deleteProcessInstancesBatchOperation - Constraint violation filter.tags (#1) |
| negative-delete | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:918` | deleteProcessInstancesBatchOperation - Constraint violation filter.tags (#2) |
| negative-delete | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:940` | deleteProcessInstancesBatchOperation - Constraint violation operationReference (#1) |
| negative-delete | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:962` | deleteProcessInstancesBatchOperation - Constraint violation operationReference (#2) |
| negative-delete | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:984` | deleteProcessInstancesBatchOperation - Constraint violation operationReference (#3) |
| negative-delete | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:1006` | deleteProcessInstancesBatchOperation - Missing filter.$or.0.variables.0.name |
| negative-delete | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:1035` | deleteProcessInstancesBatchOperation - Missing filter.$or.0.variables.0.value |
| negative-delete | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:1064` | deleteProcessInstancesBatchOperation - Missing filter.variables.0.name |
| negative-delete | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:1089` | deleteProcessInstancesBatchOperation - Missing filter.variables.0.value |
| negative-delete | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:1114` | deleteProcessInstancesBatchOperation - Missing filter |
| negative-delete | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:1129` | deleteProcessInstancesBatchOperation - Missing body |
| negative-delete | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:1141` | deleteProcessInstancesBatchOperation - uniqueItems violation filter.$or.0.tags |
| negative-delete | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:1168` | deleteProcessInstancesBatchOperation - uniqueItems violation filter.tags |
| negative-search | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:3691` | searchProcessInstanceIncidents - Additional prop __unexpectedField |
| negative-search | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:3712` | searchProcessInstanceIncidents - Body wrong top-level type |
| negative-search | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:3731` | searchProcessInstanceIncidents - Missing sort.0.field |
| negative-search | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:3750` | searchProcessInstanceIncidents - Enum violation sort.0.field |
| negative-search | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:3775` | searchProcessInstanceIncidents - Enum violation sort.0.order |
| negative-search | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:3800` | searchProcessInstanceIncidents - Path param processInstanceKey pattern violation |
| negative-search | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:3816` | searchProcessInstances - Additional prop __unexpectedField |
| negative-search | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:3835` | searchProcessInstances - Body wrong top-level type |
| negative-search | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:3850` | searchProcessInstances - Missing filter.$or.0.variables.0.name |
| negative-search | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:3879` | searchProcessInstances - Missing filter.$or.0.variables.0.value |
| negative-search | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:3908` | searchProcessInstances - Missing filter.variables.0.name |
| negative-search | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:3933` | searchProcessInstances - Missing filter.variables.0.value |
| negative-search | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:3958` | searchProcessInstances - Missing sort.0.field |
| negative-search | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:3975` | searchProcessInstances - Enum violation sort.0.field |
| negative-search | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:3996` | searchProcessInstances - Enum violation sort.0.order |
| negative-search | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:4017` | searchProcessInstances - uniqueItems violation filter.$or.0.tags |
| negative-search | bad-request | `request-validation/processinstances-validation-api-tests.spec.ts:4042` | searchProcessInstances - uniqueItems violation filter.tags |

## E. Batch-Operation Lifecycle

**Form**: Create batch (via batch-creating process-instance APIs, prerequisite) → Get batch → Search batch → Search items → Suspend → Cancel

**Total tests**: 24

### `batch-operation` — 14 tests

- **Prerequisite to create**: running-process-instance(s)
- **Files**: `cancelBatchOperation.feature.spec.ts`, `getBatchOperation.feature.spec.ts`, `request-validation/batchoperations-validation-api-tests.spec.ts`, `resumeBatchOperation.feature.spec.ts`, `searchBatchOperations.feature.spec.ts`, `searchBatchOperations.variant.spec.ts`, `suspendBatchOperation.feature.spec.ts`
- **Observation channel**: GET = 1, Search = 3
- **Form-step counts**: observe-present-get=1, observe-present-search=3, mutate=2, delete=1, observe-absence=1, negative-search=6
- **Variants**: happy-path=5, observe-absence=1, data-driven=2, bad-request=6

| form step | variants | file:line | test name |
|--|--|--|--|
| observe-present-get | happy-path | `getBatchOperation.feature.spec.ts:12` | feature-1 - getBatchOperation - base (1) |
| observe-present-search | happy-path | `searchBatchOperations.feature.spec.ts:12` | feature-1 - searchBatchOperations - base (1) |
| observe-present-search | data-driven | `searchBatchOperations.variant.spec.ts:12` | variant-1 - searchBatchOperations - path #1 |
| observe-present-search | data-driven | `searchBatchOperations.variant.spec.ts:66` | variant-2 - searchBatchOperations - path #1 |
| mutate | happy-path | `resumeBatchOperation.feature.spec.ts:8` | feature-1 - resumeBatchOperation - base (1) |
| mutate | happy-path | `suspendBatchOperation.feature.spec.ts:8` | feature-1 - suspendBatchOperation - base (1) |
| delete | happy-path | `cancelBatchOperation.feature.spec.ts:8` | feature-1 - cancelBatchOperation - base (1) |
| observe-absence | observe-absence | `searchBatchOperations.feature.spec.ts:37` | feature-2 - searchBatchOperations - negative empty (2) |
| negative-search | bad-request | `request-validation/batchoperations-validation-api-tests.spec.ts:18` | searchBatchOperations - Additional prop __unexpectedField |
| negative-search | bad-request | `request-validation/batchoperations-validation-api-tests.spec.ts:37` | searchBatchOperations - Body wrong top-level type |
| negative-search | bad-request | `request-validation/batchoperations-validation-api-tests.spec.ts:52` | searchBatchOperations - Missing sort.0.field |
| negative-search | bad-request | `request-validation/batchoperations-validation-api-tests.spec.ts:69` | searchBatchOperations - Enum violation filter.actorType |
| negative-search | bad-request | `request-validation/batchoperations-validation-api-tests.spec.ts:88` | searchBatchOperations - Enum violation sort.0.field |
| negative-search | bad-request | `request-validation/batchoperations-validation-api-tests.spec.ts:109` | searchBatchOperations - Enum violation sort.0.order |

### `batch-operation-item` — 10 tests

- **Prerequisite to create**: running-batch-operation
- **Files**: `request-validation/batchoperationitems-validation-api-tests.spec.ts`, `searchBatchOperationItems.feature.spec.ts`, `searchBatchOperationItems.variant.spec.ts`
- **Observation channel**: GET = 0, Search = 4
- **Form-step counts**: observe-present-search=4, observe-absence=1, negative-search=5
- **Variants**: happy-path=1, observe-absence=1, data-driven=3, bad-request=5

| form step | variants | file:line | test name |
|--|--|--|--|
| observe-present-search | happy-path | `searchBatchOperationItems.feature.spec.ts:12` | feature-1 - searchBatchOperationItems - base (1) |
| observe-present-search | data-driven | `searchBatchOperationItems.variant.spec.ts:13` | variant-1 - searchBatchOperationItems - bpmn #1 |
| observe-present-search | data-driven | `searchBatchOperationItems.variant.spec.ts:84` | variant-2 - searchBatchOperationItems - path #1 |
| observe-present-search | data-driven | `searchBatchOperationItems.variant.spec.ts:138` | variant-3 - searchBatchOperationItems - path #1 |
| observe-absence | observe-absence | `searchBatchOperationItems.feature.spec.ts:37` | feature-2 - searchBatchOperationItems - negative empty (2) |
| negative-search | bad-request | `request-validation/batchoperationitems-validation-api-tests.spec.ts:18` | searchBatchOperationItems - Additional prop __unexpectedField |
| negative-search | bad-request | `request-validation/batchoperationitems-validation-api-tests.spec.ts:37` | searchBatchOperationItems - Body wrong top-level type |
| negative-search | bad-request | `request-validation/batchoperationitems-validation-api-tests.spec.ts:52` | searchBatchOperationItems - Missing sort.0.field |
| negative-search | bad-request | `request-validation/batchoperationitems-validation-api-tests.spec.ts:69` | searchBatchOperationItems - Enum violation sort.0.field |
| negative-search | bad-request | `request-validation/batchoperationitems-validation-api-tests.spec.ts:90` | searchBatchOperationItems - Enum violation sort.0.order |

## F. User-Task Lifecycle

**Form**: Deploy process w/ user task (prerequisite) → Create instance → Assign → Update → Search/Get → Get form → Search variables → Complete → Unassign

**Total tests**: 65

### `user-task` — 65 tests

- **Prerequisite to create**: running-process-instance-with-user-task
- **Files**: `assignUserTask.feature.spec.ts`, `completeUserTask.feature.spec.ts`, `getFormByKey.feature.spec.ts`, `getUserTask.feature.spec.ts`, `getUserTaskForm.feature.spec.ts`, `request-validation/forms-validation-api-tests.spec.ts`, `request-validation/usertasks-validation-api-tests.spec.ts`, `searchUserTaskAuditLogs.feature.spec.ts`, `searchUserTaskEffectiveVariables.feature.spec.ts`, `searchUserTaskVariables.feature.spec.ts`, `searchUserTasks.feature.spec.ts`, `searchUserTasks.variant.spec.ts`, `unassignUserTask.feature.spec.ts`, `updateUserTask.feature.spec.ts`
- **Observation channel**: GET = 3, Search = 13
- **Form-step counts**: observe-present-get=3, observe-present-search=13, mutate=3, delete=1, observe-absence=1, negative-get=3, negative-update=10, negative-delete=1, negative-search=30
- **Variants**: happy-path=11, observe-absence=1, data-driven=9, bad-request=44

| form step | variants | file:line | test name |
|--|--|--|--|
| observe-present-get | happy-path | `getFormByKey.feature.spec.ts:13` | feature-1 - getFormByKey - base (1) |
| observe-present-get | happy-path | `getUserTask.feature.spec.ts:12` | feature-1 - getUserTask - base (1) |
| observe-present-get | happy-path | `getUserTaskForm.feature.spec.ts:12` | feature-1 - getUserTaskForm - base (1) |
| observe-present-search | happy-path | `searchUserTaskAuditLogs.feature.spec.ts:12` | feature-1 - searchUserTaskAuditLogs - base (1) |
| observe-present-search | happy-path | `searchUserTaskEffectiveVariables.feature.spec.ts:12` | feature-1 - searchUserTaskEffectiveVariables - base (1) |
| observe-present-search | happy-path | `searchUserTaskVariables.feature.spec.ts:12` | feature-1 - searchUserTaskVariables - base (1) |
| observe-present-search | happy-path | `searchUserTasks.feature.spec.ts:12` | feature-1 - searchUserTasks - base (1) |
| observe-present-search | data-driven | `searchUserTasks.variant.spec.ts:13` | variant-1 - searchUserTasks - bpmn #1 |
| observe-present-search | data-driven | `searchUserTasks.variant.spec.ts:114` | variant-2 - searchUserTasks - bpmn #1 |
| observe-present-search | data-driven | `searchUserTasks.variant.spec.ts:164` | variant-3 - searchUserTasks - path #1 |
| observe-present-search | data-driven | `searchUserTasks.variant.spec.ts:232` | variant-4 - searchUserTasks - bpmn #1 |
| observe-present-search | data-driven | `searchUserTasks.variant.spec.ts:282` | variant-5 - searchUserTasks - bpmn #1 |
| observe-present-search | data-driven | `searchUserTasks.variant.spec.ts:353` | variant-6 - searchUserTasks - bpmn #1 |
| observe-present-search | data-driven | `searchUserTasks.variant.spec.ts:454` | variant-7 - searchUserTasks - bpmn #1 |
| observe-present-search | data-driven | `searchUserTasks.variant.spec.ts:552` | variant-8 - searchUserTasks - path #1 |
| observe-present-search | data-driven | `searchUserTasks.variant.spec.ts:604` | variant-9 - searchUserTasks - path #1 |
| mutate | happy-path | `assignUserTask.feature.spec.ts:8` | feature-1 - assignUserTask - base (1) |
| mutate | happy-path | `completeUserTask.feature.spec.ts:8` | feature-1 - completeUserTask - base (1) |
| mutate | happy-path | `updateUserTask.feature.spec.ts:8` | feature-1 - updateUserTask - base (1) |
| delete | happy-path | `unassignUserTask.feature.spec.ts:8` | feature-1 - unassignUserTask - base (1) |
| observe-absence | observe-absence | `searchUserTasks.feature.spec.ts:35` | feature-2 - searchUserTasks - negative empty (2) |
| negative-get | bad-request | `request-validation/forms-validation-api-tests.spec.ts:18` | getFormByKey - Path param formKey pattern violation |
| negative-get | bad-request | `request-validation/usertasks-validation-api-tests.spec.ts:136` | getUserTask - Path param userTaskKey pattern violation |
| negative-get | bad-request | `request-validation/usertasks-validation-api-tests.spec.ts:148` | getUserTaskForm - Path param userTaskKey pattern violation |
| negative-update | bad-request | `request-validation/usertasks-validation-api-tests.spec.ts:18` | assignUserTask - Additional prop __unexpectedField |
| negative-update | bad-request | `request-validation/usertasks-validation-api-tests.spec.ts:37` | assignUserTask - Body wrong top-level type |
| negative-update | bad-request | `request-validation/usertasks-validation-api-tests.spec.ts:54` | assignUserTask - Missing body |
| negative-update | bad-request | `request-validation/usertasks-validation-api-tests.spec.ts:68` | assignUserTask - Path param userTaskKey pattern violation |
| negative-update | bad-request | `request-validation/usertasks-validation-api-tests.spec.ts:84` | completeUserTask - Additional prop __unexpectedField |
| negative-update | bad-request | `request-validation/usertasks-validation-api-tests.spec.ts:103` | completeUserTask - Body wrong top-level type |
| negative-update | bad-request | `request-validation/usertasks-validation-api-tests.spec.ts:120` | completeUserTask - Path param userTaskKey pattern violation |
| negative-update | bad-request | `request-validation/usertasks-validation-api-tests.spec.ts:779` | updateUserTask - Additional prop __unexpectedField |
| negative-update | bad-request | `request-validation/usertasks-validation-api-tests.spec.ts:796` | updateUserTask - Body wrong top-level type |
| negative-update | bad-request | `request-validation/usertasks-validation-api-tests.spec.ts:811` | updateUserTask - Path param userTaskKey pattern violation |
| negative-delete | bad-request | `request-validation/usertasks-validation-api-tests.spec.ts:763` | unassignUserTask - Path param userTaskKey pattern violation |
| negative-search | bad-request | `request-validation/usertasks-validation-api-tests.spec.ts:162` | searchUserTaskAuditLogs - Additional prop __unexpectedField |
| negative-search | bad-request | `request-validation/usertasks-validation-api-tests.spec.ts:183` | searchUserTaskAuditLogs - Body wrong top-level type |
| negative-search | bad-request | `request-validation/usertasks-validation-api-tests.spec.ts:200` | searchUserTaskAuditLogs - Missing sort.0.field |
| negative-search | bad-request | `request-validation/usertasks-validation-api-tests.spec.ts:219` | searchUserTaskAuditLogs - Enum violation sort.0.field |
| negative-search | bad-request | `request-validation/usertasks-validation-api-tests.spec.ts:242` | searchUserTaskAuditLogs - Enum violation sort.0.order |
| negative-search | bad-request | `request-validation/usertasks-validation-api-tests.spec.ts:265` | searchUserTaskAuditLogs - Path param userTaskKey pattern violation |
| negative-search | bad-request | `request-validation/usertasks-validation-api-tests.spec.ts:281` | searchUserTaskEffectiveVariables - Additional prop __unexpectedField |
| negative-search | bad-request | `request-validation/usertasks-validation-api-tests.spec.ts:302` | searchUserTaskEffectiveVariables - Body wrong top-level type |
| negative-search | bad-request | `request-validation/usertasks-validation-api-tests.spec.ts:321` | searchUserTaskEffectiveVariables - Missing sort.0.field |
| negative-search | bad-request | `request-validation/usertasks-validation-api-tests.spec.ts:340` | searchUserTaskEffectiveVariables - Enum violation sort.0.field |
| negative-search | bad-request | `request-validation/usertasks-validation-api-tests.spec.ts:365` | searchUserTaskEffectiveVariables - Enum violation sort.0.order |
| negative-search | bad-request | `request-validation/usertasks-validation-api-tests.spec.ts:390` | searchUserTaskEffectiveVariables - Path param userTaskKey pattern violation |
| negative-search | bad-request | `request-validation/usertasks-validation-api-tests.spec.ts:406` | searchUserTaskEffectiveVariables - Param query.truncateValues wrong type |
| negative-search | bad-request | `request-validation/usertasks-validation-api-tests.spec.ts:422` | searchUserTasks - Additional prop __unexpectedField |
| negative-search | bad-request | `request-validation/usertasks-validation-api-tests.spec.ts:439` | searchUserTasks - Body wrong top-level type |
| negative-search | bad-request | `request-validation/usertasks-validation-api-tests.spec.ts:454` | searchUserTasks - Missing filter.localVariables.0.name |
| negative-search | bad-request | `request-validation/usertasks-validation-api-tests.spec.ts:477` | searchUserTasks - Missing filter.localVariables.0.value |
| negative-search | bad-request | `request-validation/usertasks-validation-api-tests.spec.ts:500` | searchUserTasks - Missing filter.processInstanceVariables.0.name |
| negative-search | bad-request | `request-validation/usertasks-validation-api-tests.spec.ts:525` | searchUserTasks - Missing filter.processInstanceVariables.0.value |
| negative-search | bad-request | `request-validation/usertasks-validation-api-tests.spec.ts:550` | searchUserTasks - Missing sort.0.field |
| negative-search | bad-request | `request-validation/usertasks-validation-api-tests.spec.ts:567` | searchUserTasks - Enum violation sort.0.field |
| negative-search | bad-request | `request-validation/usertasks-validation-api-tests.spec.ts:588` | searchUserTasks - Enum violation sort.0.order |
| negative-search | bad-request | `request-validation/usertasks-validation-api-tests.spec.ts:609` | searchUserTasks - uniqueItems violation filter.tags |
| negative-search | bad-request | `request-validation/usertasks-validation-api-tests.spec.ts:628` | searchUserTaskVariables - Additional prop __unexpectedField |
| negative-search | bad-request | `request-validation/usertasks-validation-api-tests.spec.ts:649` | searchUserTaskVariables - Body wrong top-level type |
| negative-search | bad-request | `request-validation/usertasks-validation-api-tests.spec.ts:666` | searchUserTaskVariables - Missing sort.0.field |
| negative-search | bad-request | `request-validation/usertasks-validation-api-tests.spec.ts:685` | searchUserTaskVariables - Enum violation sort.0.field |
| negative-search | bad-request | `request-validation/usertasks-validation-api-tests.spec.ts:708` | searchUserTaskVariables - Enum violation sort.0.order |
| negative-search | bad-request | `request-validation/usertasks-validation-api-tests.spec.ts:731` | searchUserTaskVariables - Path param userTaskKey pattern violation |
| negative-search | bad-request | `request-validation/usertasks-validation-api-tests.spec.ts:747` | searchUserTaskVariables - Param query.truncateValues wrong type |

## G. Job Lifecycle & Stats

**Form**: Deploy process w/ job (prerequisite) → Activate → Complete / Fail / Error / Update → Search jobs → Aggregate (5 statistics endpoints)

**Total tests**: 142

### `job` — 142 tests

- **Prerequisite to create**: running-process-instance-with-job
- **Files**: `activateJobs.feature.spec.ts`, `activateJobs.variant.spec.ts`, `completeJob.feature.spec.ts`, `completeJob.variant.spec.ts`, `failJob.feature.spec.ts`, `getGlobalJobStatistics.feature.spec.ts`, `getJobErrorStatistics.feature.spec.ts`, `getJobErrorStatistics.variant.spec.ts`, `getJobTimeSeriesStatistics.feature.spec.ts`, `getJobTimeSeriesStatistics.variant.spec.ts`, `getJobTypeStatistics.feature.spec.ts`, `getJobTypeStatistics.variant.spec.ts`, `getJobWorkerStatistics.feature.spec.ts`, `getJobWorkerStatistics.variant.spec.ts`, `request-validation/jobs-validation-api-tests.spec.ts`, `searchJobs.feature.spec.ts`, `searchJobs.variant.spec.ts`, `throwJobError.feature.spec.ts`, `updateJob.feature.spec.ts`
- **Observation channel**: GET = 9, Search = 7
- **Form-step counts**: create=3, observe-present-get=9, observe-present-search=7, mutate=6, observe-absence=2, negative-create=28, negative-get=58, negative-update=24, negative-search=5
- **Variants**: happy-path=11, observe-absence=2, data-driven=14, bad-request=115

| form step | variants | file:line | test name |
|--|--|--|--|
| create | happy-path | `activateJobs.feature.spec.ts:12` | feature-1 - activateJobs - base (1) |
| create | data-driven | `activateJobs.variant.spec.ts:12` | variant-1 - activateJobs - path #1 |
| create | happy-path | `throwJobError.feature.spec.ts:9` | feature-1 - throwJobError - base (1) |
| observe-present-get | happy-path | `getGlobalJobStatistics.feature.spec.ts:12` | feature-1 - getGlobalJobStatistics - base (1) |
| observe-present-get | happy-path | `getJobErrorStatistics.feature.spec.ts:11` | feature-1 - getJobErrorStatistics - base (1) |
| observe-present-get | data-driven | `getJobErrorStatistics.variant.spec.ts:12` | variant-1 - getJobErrorStatistics - path #1 |
| observe-present-get | happy-path | `getJobTimeSeriesStatistics.feature.spec.ts:11` | feature-1 - getJobTimeSeriesStatistics - base (1) |
| observe-present-get | data-driven | `getJobTimeSeriesStatistics.variant.spec.ts:12` | variant-1 - getJobTimeSeriesStatistics - path #1 |
| observe-present-get | happy-path | `getJobTypeStatistics.feature.spec.ts:11` | feature-1 - getJobTypeStatistics - base (1) |
| observe-present-get | data-driven | `getJobTypeStatistics.variant.spec.ts:12` | variant-1 - getJobTypeStatistics - path #1 |
| observe-present-get | happy-path | `getJobWorkerStatistics.feature.spec.ts:11` | feature-1 - getJobWorkerStatistics - base (1) |
| observe-present-get | data-driven | `getJobWorkerStatistics.variant.spec.ts:12` | variant-1 - getJobWorkerStatistics - path #1 |
| observe-present-search | happy-path | `searchJobs.feature.spec.ts:13` | feature-1 - searchJobs - base (1) |
| observe-present-search | data-driven | `searchJobs.variant.spec.ts:13` | variant-1 - searchJobs - bpmn #1 |
| observe-present-search | data-driven | `searchJobs.variant.spec.ts:116` | variant-2 - searchJobs - bpmn #1 |
| observe-present-search | data-driven | `searchJobs.variant.spec.ts:219` | variant-3 - searchJobs - path #1 |
| observe-present-search | data-driven | `searchJobs.variant.spec.ts:293` | variant-4 - searchJobs - bpmn #1 |
| observe-present-search | data-driven | `searchJobs.variant.spec.ts:366` | variant-5 - searchJobs - path #1 |
| observe-present-search | data-driven | `searchJobs.variant.spec.ts:462` | variant-6 - searchJobs - path #1 |
| mutate | happy-path | `completeJob.feature.spec.ts:9` | feature-1 - completeJob - base (1) |
| mutate | data-driven | `completeJob.feature.spec.ts:93` | feature-2 - completeJob - oneOf result variant1 (2) |
| mutate | data-driven | `completeJob.feature.spec.ts:178` | feature-3 - completeJob - oneOf result variant2 (3) |
| mutate | data-driven | `completeJob.variant.spec.ts:9` | variant-1 - completeJob - bpmn #1 |
| mutate | happy-path | `failJob.feature.spec.ts:9` | feature-1 - failJob - base (1) |
| mutate | happy-path | `updateJob.feature.spec.ts:9` | feature-1 - updateJob - base (1) |
| observe-absence | observe-absence | `activateJobs.feature.spec.ts:78` | feature-2 - activateJobs - negative empty (2) |
| observe-absence | observe-absence | `searchJobs.feature.spec.ts:80` | feature-2 - searchJobs - negative empty (2) |
| negative-create | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:18` | activateJobs - Additional prop __unexpectedField |
| negative-create | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:40` | activateJobs - Body wrong top-level type |
| negative-create | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:55` | activateJobs - Param maxJobsToActivate wrong type (#1) |
| negative-create | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:76` | activateJobs - Param maxJobsToActivate wrong type (#2) |
| negative-create | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:97` | activateJobs - Param requestTimeout wrong type (#1) |
| negative-create | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:118` | activateJobs - Param requestTimeout wrong type (#2) |
| negative-create | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:139` | activateJobs - Param tenantFilter wrong type (#1) |
| negative-create | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:160` | activateJobs - Param tenantFilter wrong type (#2) |
| negative-create | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:181` | activateJobs - Param timeout wrong type (#1) |
| negative-create | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:202` | activateJobs - Param timeout wrong type (#2) |
| negative-create | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:223` | activateJobs - Param type wrong type (#1) |
| negative-create | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:244` | activateJobs - Param type wrong type (#2) |
| negative-create | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:265` | activateJobs - Enum violation tenantFilter |
| negative-create | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:286` | activateJobs - Missing maxJobsToActivate |
| negative-create | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:304` | activateJobs - Missing timeout |
| negative-create | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:322` | activateJobs - Missing type |
| negative-create | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:340` | activateJobs - Missing body |
| negative-create | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:352` | activateJobs - Missing combo maxJobsToActivate,timeout |
| negative-create | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:369` | activateJobs - Missing combo type,maxJobsToActivate |
| negative-create | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:386` | activateJobs - Missing combo type,maxJobsToActivate,timeout |
| negative-create | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:403` | activateJobs - Missing combo type,timeout |
| negative-create | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:1810` | throwJobError - Additional prop __unexpectedField |
| negative-create | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:1828` | throwJobError - Body wrong top-level type |
| negative-create | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:1843` | throwJobError - Param errorCode wrong type (#1) |
| negative-create | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:1860` | throwJobError - Param errorCode wrong type (#2) |
| negative-create | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:1877` | throwJobError - Missing errorCode |
| negative-create | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:1892` | throwJobError - Missing body |
| negative-create | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:1904` | throwJobError - Path param jobKey pattern violation |
| negative-get | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:582` | getGlobalJobStatistics - Missing param query.from |
| negative-get | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:597` | getGlobalJobStatistics - Missing param query.to |
| negative-get | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:612` | getGlobalJobStatistics - Param query.from wrong type |
| negative-get | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:628` | getGlobalJobStatistics - Param query.to wrong type |
| negative-get | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:644` | getJobErrorStatistics - Additional prop __extraField |
| negative-get | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:666` | getJobErrorStatistics - Body wrong top-level type |
| negative-get | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:681` | getJobErrorStatistics - Param filter.from wrong type (#1) |
| negative-get | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:704` | getJobErrorStatistics - Param filter.from wrong type (#2) |
| negative-get | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:727` | getJobErrorStatistics - Param filter.jobType wrong type (#1) |
| negative-get | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:750` | getJobErrorStatistics - Param filter.jobType wrong type (#2) |
| negative-get | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:773` | getJobErrorStatistics - Param filter.to wrong type (#1) |
| negative-get | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:794` | getJobErrorStatistics - Param filter.to wrong type (#2) |
| negative-get | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:815` | getJobErrorStatistics - Missing filter.from |
| negative-get | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:835` | getJobErrorStatistics - Missing filter.jobType |
| negative-get | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:855` | getJobErrorStatistics - Missing filter.to |
| negative-get | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:875` | getJobErrorStatistics - Missing page.after |
| negative-get | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:897` | getJobErrorStatistics - format invalid filter.from |
| negative-get | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:918` | getJobErrorStatistics - format invalid filter.to |
| negative-get | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:939` | getJobErrorStatistics - Missing filter |
| negative-get | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:954` | getJobErrorStatistics - Missing body |
| negative-get | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:966` | getJobTimeSeriesStatistics - Additional prop __extraField |
| negative-get | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:990` | getJobTimeSeriesStatistics - Body wrong top-level type |
| negative-get | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:1005` | getJobTimeSeriesStatistics - Param filter.from wrong type (#1) |
| negative-get | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:1028` | getJobTimeSeriesStatistics - Param filter.from wrong type (#2) |
| negative-get | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:1051` | getJobTimeSeriesStatistics - Param filter.jobType wrong type (#1) |
| negative-get | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:1074` | getJobTimeSeriesStatistics - Param filter.jobType wrong type (#2) |
| negative-get | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:1097` | getJobTimeSeriesStatistics - Param filter.to wrong type (#1) |
| negative-get | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:1120` | getJobTimeSeriesStatistics - Param filter.to wrong type (#2) |
| negative-get | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:1143` | getJobTimeSeriesStatistics - Missing filter.from |
| negative-get | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:1163` | getJobTimeSeriesStatistics - Missing filter.jobType |
| negative-get | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:1183` | getJobTimeSeriesStatistics - Missing filter.to |
| negative-get | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:1203` | getJobTimeSeriesStatistics - Missing page.after |
| negative-get | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:1225` | getJobTimeSeriesStatistics - format invalid filter.from |
| negative-get | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:1246` | getJobTimeSeriesStatistics - format invalid filter.to |
| negative-get | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:1267` | getJobTimeSeriesStatistics - Missing filter |
| negative-get | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:1282` | getJobTimeSeriesStatistics - Missing body |
| negative-get | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:1294` | getJobTypeStatistics - Additional prop __extraField |
| negative-get | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:1311` | getJobTypeStatistics - Body wrong top-level type |
| negative-get | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:1326` | getJobTypeStatistics - Missing filter.from |
| negative-get | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:1345` | getJobTypeStatistics - Missing filter.to |
| negative-get | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:1364` | getJobTypeStatistics - Missing page.after |
| negative-get | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:1381` | getJobTypeStatistics - Missing body |
| negative-get | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:1393` | getJobWorkerStatistics - Additional prop __extraField |
| negative-get | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:1415` | getJobWorkerStatistics - Body wrong top-level type |
| negative-get | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:1430` | getJobWorkerStatistics - Param filter.from wrong type (#1) |
| negative-get | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:1453` | getJobWorkerStatistics - Param filter.from wrong type (#2) |
| negative-get | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:1476` | getJobWorkerStatistics - Param filter.jobType wrong type (#1) |
| negative-get | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:1499` | getJobWorkerStatistics - Param filter.jobType wrong type (#2) |
| negative-get | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:1522` | getJobWorkerStatistics - Param filter.to wrong type (#1) |
| negative-get | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:1545` | getJobWorkerStatistics - Param filter.to wrong type (#2) |
| negative-get | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:1568` | getJobWorkerStatistics - Missing filter.from |
| negative-get | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:1588` | getJobWorkerStatistics - Missing filter.jobType |
| negative-get | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:1608` | getJobWorkerStatistics - Missing filter.to |
| negative-get | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:1628` | getJobWorkerStatistics - Missing page.after |
| negative-get | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:1650` | getJobWorkerStatistics - format invalid filter.from |
| negative-get | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:1671` | getJobWorkerStatistics - format invalid filter.to |
| negative-get | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:1692` | getJobWorkerStatistics - Missing filter |
| negative-get | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:1707` | getJobWorkerStatistics - Missing body |
| negative-update | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:420` | completeJob - Additional prop __unexpectedField |
| negative-update | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:437` | completeJob - Body wrong top-level type |
| negative-update | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:452` | completeJob - Path param jobKey pattern violation |
| negative-update | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:464` | failJob - Additional prop __unexpectedField |
| negative-update | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:483` | failJob - Body wrong top-level type |
| negative-update | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:498` | failJob - Param retries wrong type (#1) |
| negative-update | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:516` | failJob - Param retries wrong type (#2) |
| negative-update | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:534` | failJob - Param retryBackOff wrong type (#1) |
| negative-update | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:552` | failJob - Param retryBackOff wrong type (#2) |
| negative-update | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:570` | failJob - Path param jobKey pattern violation |
| negative-update | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:1916` | updateJob - Additional prop __unexpectedField |
| negative-update | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:1938` | updateJob - Body wrong top-level type |
| negative-update | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:1953` | updateJob - Param changeset.retries wrong type (#1) |
| negative-update | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:1974` | updateJob - Param changeset.retries wrong type (#2) |
| negative-update | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:1995` | updateJob - Param changeset.timeout wrong type (#1) |
| negative-update | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:2016` | updateJob - Param changeset.timeout wrong type (#2) |
| negative-update | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:2037` | updateJob - Param operationReference wrong type (#1) |
| negative-update | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:2058` | updateJob - Param operationReference wrong type (#2) |
| negative-update | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:2079` | updateJob - Constraint violation operationReference (#1) |
| negative-update | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:2102` | updateJob - Constraint violation operationReference (#2) |
| negative-update | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:2125` | updateJob - Constraint violation operationReference (#3) |
| negative-update | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:2148` | updateJob - Missing changeset |
| negative-update | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:2163` | updateJob - Missing body |
| negative-update | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:2175` | updateJob - Path param jobKey pattern violation |
| negative-search | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:1719` | searchJobs - Additional prop __unexpectedField |
| negative-search | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:1736` | searchJobs - Body wrong top-level type |
| negative-search | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:1751` | searchJobs - Missing sort.0.field |
| negative-search | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:1768` | searchJobs - Enum violation sort.0.field |
| negative-search | bad-request | `request-validation/jobs-validation-api-tests.spec.ts:1789` | searchJobs - Enum violation sort.0.order |

## H. Incident Lifecycle

**Form**: Deploy process + failing job (prerequisite) → Incident raised → Get incident → Search → Resolve → Statistics (by definition / by error)

**Total tests**: 41

### `incident` — 41 tests

- **Prerequisite to create**: running-process-instance-with-failing-job
- **Files**: `getIncident.feature.spec.ts`, `getProcessInstanceStatisticsByDefinition.feature.spec.ts`, `getProcessInstanceStatisticsByError.feature.spec.ts`, `request-validation/incidents-validation-api-tests.spec.ts`, `resolveIncident.feature.spec.ts`, `searchIncidents.feature.spec.ts`, `searchIncidents.variant.spec.ts`
- **Observation channel**: GET = 3, Search = 7
- **Form-step counts**: observe-present-get=3, observe-present-search=7, mutate=1, observe-absence=1, negative-get=16, negative-update=8, negative-search=5
- **Variants**: happy-path=5, observe-absence=1, data-driven=6, bad-request=29

| form step | variants | file:line | test name |
|--|--|--|--|
| observe-present-get | happy-path | `getIncident.feature.spec.ts:12` | feature-1 - getIncident - base (1) |
| observe-present-get | happy-path | `getProcessInstanceStatisticsByDefinition.feature.spec.ts:11` | feature-1 - getProcessInstanceStatisticsByDefinition - base (1) |
| observe-present-get | happy-path | `getProcessInstanceStatisticsByError.feature.spec.ts:11` | feature-1 - getProcessInstanceStatisticsByError - base (1) |
| observe-present-search | happy-path | `searchIncidents.feature.spec.ts:12` | feature-1 - searchIncidents - base (1) |
| observe-present-search | data-driven | `searchIncidents.variant.spec.ts:13` | variant-1 - searchIncidents - bpmn #1 |
| observe-present-search | data-driven | `searchIncidents.variant.spec.ts:63` | variant-2 - searchIncidents - bpmn #1 |
| observe-present-search | data-driven | `searchIncidents.variant.spec.ts:134` | variant-3 - searchIncidents - bpmn #1 |
| observe-present-search | data-driven | `searchIncidents.variant.spec.ts:236` | variant-4 - searchIncidents - bpmn #1 |
| observe-present-search | data-driven | `searchIncidents.variant.spec.ts:338` | variant-5 - searchIncidents - path #1 |
| observe-present-search | data-driven | `searchIncidents.variant.spec.ts:390` | variant-6 - searchIncidents - path #1 |
| mutate | happy-path | `resolveIncident.feature.spec.ts:8` | feature-1 - resolveIncident - base (1) |
| observe-absence | observe-absence | `searchIncidents.feature.spec.ts:35` | feature-2 - searchIncidents - negative empty (2) |
| negative-get | bad-request | `request-validation/incidents-validation-api-tests.spec.ts:18` | getIncident - Path param incidentKey pattern violation |
| negative-get | bad-request | `request-validation/incidents-validation-api-tests.spec.ts:30` | getProcessInstanceStatisticsByDefinition - Additional prop __extraField |
| negative-get | bad-request | `request-validation/incidents-validation-api-tests.spec.ts:52` | getProcessInstanceStatisticsByDefinition - Body wrong top-level type |
| negative-get | bad-request | `request-validation/incidents-validation-api-tests.spec.ts:69` | getProcessInstanceStatisticsByDefinition - Param filter.errorHashCode wrong type (#1) |
| negative-get | bad-request | `request-validation/incidents-validation-api-tests.spec.ts:90` | getProcessInstanceStatisticsByDefinition - Param filter.errorHashCode wrong type (#2) |
| negative-get | bad-request | `request-validation/incidents-validation-api-tests.spec.ts:111` | getProcessInstanceStatisticsByDefinition - Missing filter.errorHashCode |
| negative-get | bad-request | `request-validation/incidents-validation-api-tests.spec.ts:130` | getProcessInstanceStatisticsByDefinition - Missing sort.0.field |
| negative-get | bad-request | `request-validation/incidents-validation-api-tests.spec.ts:152` | getProcessInstanceStatisticsByDefinition - Enum violation sort.0.field |
| negative-get | bad-request | `request-validation/incidents-validation-api-tests.spec.ts:178` | getProcessInstanceStatisticsByDefinition - Enum violation sort.0.order |
| negative-get | bad-request | `request-validation/incidents-validation-api-tests.spec.ts:204` | getProcessInstanceStatisticsByDefinition - Missing filter |
| negative-get | bad-request | `request-validation/incidents-validation-api-tests.spec.ts:221` | getProcessInstanceStatisticsByDefinition - Missing body |
| negative-get | bad-request | `request-validation/incidents-validation-api-tests.spec.ts:233` | getProcessInstanceStatisticsByError - Additional prop __unexpectedField |
| negative-get | bad-request | `request-validation/incidents-validation-api-tests.spec.ts:252` | getProcessInstanceStatisticsByError - Body wrong top-level type |
| negative-get | bad-request | `request-validation/incidents-validation-api-tests.spec.ts:269` | getProcessInstanceStatisticsByError - Missing sort.0.field |
| negative-get | bad-request | `request-validation/incidents-validation-api-tests.spec.ts:288` | getProcessInstanceStatisticsByError - Enum violation sort.0.field |
| negative-get | bad-request | `request-validation/incidents-validation-api-tests.spec.ts:311` | getProcessInstanceStatisticsByError - Enum violation sort.0.order |
| negative-update | bad-request | `request-validation/incidents-validation-api-tests.spec.ts:334` | resolveIncident - Additional prop __unexpectedField |
| negative-update | bad-request | `request-validation/incidents-validation-api-tests.spec.ts:354` | resolveIncident - Body wrong top-level type |
| negative-update | bad-request | `request-validation/incidents-validation-api-tests.spec.ts:371` | resolveIncident - Param operationReference wrong type (#1) |
| negative-update | bad-request | `request-validation/incidents-validation-api-tests.spec.ts:392` | resolveIncident - Param operationReference wrong type (#2) |
| negative-update | bad-request | `request-validation/incidents-validation-api-tests.spec.ts:413` | resolveIncident - Constraint violation operationReference (#1) |
| negative-update | bad-request | `request-validation/incidents-validation-api-tests.spec.ts:434` | resolveIncident - Constraint violation operationReference (#2) |
| negative-update | bad-request | `request-validation/incidents-validation-api-tests.spec.ts:455` | resolveIncident - Constraint violation operationReference (#3) |
| negative-update | bad-request | `request-validation/incidents-validation-api-tests.spec.ts:476` | resolveIncident - Path param incidentKey pattern violation |
| negative-search | bad-request | `request-validation/incidents-validation-api-tests.spec.ts:492` | searchIncidents - Additional prop __unexpectedField |
| negative-search | bad-request | `request-validation/incidents-validation-api-tests.spec.ts:509` | searchIncidents - Body wrong top-level type |
| negative-search | bad-request | `request-validation/incidents-validation-api-tests.spec.ts:524` | searchIncidents - Missing sort.0.field |
| negative-search | bad-request | `request-validation/incidents-validation-api-tests.spec.ts:541` | searchIncidents - Enum violation sort.0.field |
| negative-search | bad-request | `request-validation/incidents-validation-api-tests.spec.ts:562` | searchIncidents - Enum violation sort.0.order |

## I. Decision-Instance Lifecycle

**Form**: Deploy DRD/DMN (prerequisite) → Evaluate → Get instance → Search → Delete (single + batch) → Search (Observe Absence)

**Total tests**: 72

### `decision-instance` — 72 tests

- **Prerequisite to create**: deployed-decision
- **Files**: `deleteDecisionInstance.feature.spec.ts`, `deleteDecisionInstancesBatchOperation.feature.spec.ts`, `deleteDecisionInstancesBatchOperation.variant.spec.ts`, `getDecisionInstance.feature.spec.ts`, `request-validation/decisioninstances-validation-api-tests.spec.ts`, `searchDecisionInstances.feature.spec.ts`, `searchDecisionInstances.variant.spec.ts`
- **Observation channel**: GET = 1, Search = 13
- **Form-step counts**: observe-present-get=1, observe-present-search=13, delete=12, observe-absence=1, negative-get=1, negative-delete=38, negative-search=6
- **Variants**: happy-path=4, observe-absence=1, data-driven=22, bad-request=45

| form step | variants | file:line | test name |
|--|--|--|--|
| observe-present-get | happy-path | `getDecisionInstance.feature.spec.ts:13` | feature-1 - getDecisionInstance - base (1) |
| observe-present-search | happy-path | `searchDecisionInstances.feature.spec.ts:12` | feature-1 - searchDecisionInstances - base (1) |
| observe-present-search | data-driven | `searchDecisionInstances.variant.spec.ts:13` | variant-1 - searchDecisionInstances - dmn #1 |
| observe-present-search | data-driven | `searchDecisionInstances.variant.spec.ts:92` | variant-2 - searchDecisionInstances - dmn #1 |
| observe-present-search | data-driven | `searchDecisionInstances.variant.spec.ts:143` | variant-3 - searchDecisionInstances - path #1 |
| observe-present-search | data-driven | `searchDecisionInstances.variant.spec.ts:195` | variant-4 - searchDecisionInstances - dmn #1 |
| observe-present-search | data-driven | `searchDecisionInstances.variant.spec.ts:274` | variant-5 - searchDecisionInstances - bpmn #1 |
| observe-present-search | data-driven | `searchDecisionInstances.variant.spec.ts:326` | variant-6 - searchDecisionInstances - bpmn #1 |
| observe-present-search | data-driven | `searchDecisionInstances.variant.spec.ts:399` | variant-7 - searchDecisionInstances - dmn #1 |
| observe-present-search | data-driven | `searchDecisionInstances.variant.spec.ts:450` | variant-8 - searchDecisionInstances - bpmn #1 |
| observe-present-search | data-driven | `searchDecisionInstances.variant.spec.ts:552` | variant-9 - searchDecisionInstances - dmn #1 |
| observe-present-search | data-driven | `searchDecisionInstances.variant.spec.ts:603` | variant-10 - searchDecisionInstances - drd #1 |
| observe-present-search | data-driven | `searchDecisionInstances.variant.spec.ts:654` | variant-11 - searchDecisionInstances - path #1 |
| observe-present-search | data-driven | `searchDecisionInstances.variant.spec.ts:708` | variant-12 - searchDecisionInstances - path #1 |
| delete | happy-path | `deleteDecisionInstance.feature.spec.ts:9` | feature-1 - deleteDecisionInstance - base (1) |
| delete | happy-path | `deleteDecisionInstancesBatchOperation.feature.spec.ts:11` | feature-1 - deleteDecisionInstancesBatchOperation - base (1) |
| delete | data-driven | `deleteDecisionInstancesBatchOperation.variant.spec.ts:12` | variant-1 - deleteDecisionInstancesBatchOperation - dmn #1 |
| delete | data-driven | `deleteDecisionInstancesBatchOperation.variant.spec.ts:90` | variant-2 - deleteDecisionInstancesBatchOperation - dmn #1 |
| delete | data-driven | `deleteDecisionInstancesBatchOperation.variant.spec.ts:140` | variant-3 - deleteDecisionInstancesBatchOperation - path #1 |
| delete | data-driven | `deleteDecisionInstancesBatchOperation.variant.spec.ts:191` | variant-4 - deleteDecisionInstancesBatchOperation - dmn #1 |
| delete | data-driven | `deleteDecisionInstancesBatchOperation.variant.spec.ts:269` | variant-5 - deleteDecisionInstancesBatchOperation - bpmn #1 |
| delete | data-driven | `deleteDecisionInstancesBatchOperation.variant.spec.ts:321` | variant-6 - deleteDecisionInstancesBatchOperation - bpmn #1 |
| delete | data-driven | `deleteDecisionInstancesBatchOperation.variant.spec.ts:393` | variant-7 - deleteDecisionInstancesBatchOperation - dmn #1 |
| delete | data-driven | `deleteDecisionInstancesBatchOperation.variant.spec.ts:443` | variant-8 - deleteDecisionInstancesBatchOperation - bpmn #1 |
| delete | data-driven | `deleteDecisionInstancesBatchOperation.variant.spec.ts:544` | variant-9 - deleteDecisionInstancesBatchOperation - dmn #1 |
| delete | data-driven | `deleteDecisionInstancesBatchOperation.variant.spec.ts:594` | variant-10 - deleteDecisionInstancesBatchOperation - drd #1 |
| observe-absence | observe-absence | `searchDecisionInstances.feature.spec.ts:37` | feature-2 - searchDecisionInstances - negative empty (2) |
| negative-get | bad-request | `request-validation/decisioninstances-validation-api-tests.spec.ts:979` | getDecisionInstance - Path param decisionEvaluationInstanceKey pattern violation |
| negative-delete | bad-request | `request-validation/decisioninstances-validation-api-tests.spec.ts:18` | deleteDecisionInstance - Additional prop __unexpectedField |
| negative-delete | bad-request | `request-validation/decisioninstances-validation-api-tests.spec.ts:40` | deleteDecisionInstance - Body wrong top-level type |
| negative-delete | bad-request | `request-validation/decisioninstances-validation-api-tests.spec.ts:57` | deleteDecisionInstance - Param operationReference wrong type (#1) |
| negative-delete | bad-request | `request-validation/decisioninstances-validation-api-tests.spec.ts:78` | deleteDecisionInstance - Param operationReference wrong type (#2) |
| negative-delete | bad-request | `request-validation/decisioninstances-validation-api-tests.spec.ts:99` | deleteDecisionInstance - Constraint violation operationReference (#1) |
| negative-delete | bad-request | `request-validation/decisioninstances-validation-api-tests.spec.ts:120` | deleteDecisionInstance - Constraint violation operationReference (#2) |
| negative-delete | bad-request | `request-validation/decisioninstances-validation-api-tests.spec.ts:141` | deleteDecisionInstance - Constraint violation operationReference (#3) |
| negative-delete | bad-request | `request-validation/decisioninstances-validation-api-tests.spec.ts:162` | deleteDecisionInstance - Path param decisionEvaluationKey pattern violation |
| negative-delete | bad-request | `request-validation/decisioninstances-validation-api-tests.spec.ts:178` | deleteDecisionInstancesBatchOperation - Additional prop __unexpectedField |
| negative-delete | bad-request | `request-validation/decisioninstances-validation-api-tests.spec.ts:207` | deleteDecisionInstancesBatchOperation - Body wrong top-level type |
| negative-delete | bad-request | `request-validation/decisioninstances-validation-api-tests.spec.ts:224` | deleteDecisionInstancesBatchOperation - Param filter.decisionDefinitionId wrong type (#1) |
| negative-delete | bad-request | `request-validation/decisioninstances-validation-api-tests.spec.ts:252` | deleteDecisionInstancesBatchOperation - Param filter.decisionDefinitionId wrong type (#2) |
| negative-delete | bad-request | `request-validation/decisioninstances-validation-api-tests.spec.ts:280` | deleteDecisionInstancesBatchOperation - Param filter.decisionDefinitionType wrong type (#1) |
| negative-delete | bad-request | `request-validation/decisioninstances-validation-api-tests.spec.ts:308` | deleteDecisionInstancesBatchOperation - Param filter.decisionDefinitionType wrong type (#2) |
| negative-delete | bad-request | `request-validation/decisioninstances-validation-api-tests.spec.ts:336` | deleteDecisionInstancesBatchOperation - Param filter.decisionDefinitionVersion wrong type (#1) |
| negative-delete | bad-request | `request-validation/decisioninstances-validation-api-tests.spec.ts:364` | deleteDecisionInstancesBatchOperation - Param filter.decisionDefinitionVersion wrong type (#2) |
| negative-delete | bad-request | `request-validation/decisioninstances-validation-api-tests.spec.ts:392` | deleteDecisionInstancesBatchOperation - Param filter.decisionEvaluationKey wrong type (#1) |
| negative-delete | bad-request | `request-validation/decisioninstances-validation-api-tests.spec.ts:420` | deleteDecisionInstancesBatchOperation - Param filter.decisionEvaluationKey wrong type (#2) |
| negative-delete | bad-request | `request-validation/decisioninstances-validation-api-tests.spec.ts:448` | deleteDecisionInstancesBatchOperation - Param filter.processDefinitionKey wrong type (#1) |
| negative-delete | bad-request | `request-validation/decisioninstances-validation-api-tests.spec.ts:476` | deleteDecisionInstancesBatchOperation - Param filter.processDefinitionKey wrong type (#2) |
| negative-delete | bad-request | `request-validation/decisioninstances-validation-api-tests.spec.ts:504` | deleteDecisionInstancesBatchOperation - Param filter.processInstanceKey wrong type (#1) |
| negative-delete | bad-request | `request-validation/decisioninstances-validation-api-tests.spec.ts:532` | deleteDecisionInstancesBatchOperation - Param filter.processInstanceKey wrong type (#2) |
| negative-delete | bad-request | `request-validation/decisioninstances-validation-api-tests.spec.ts:560` | deleteDecisionInstancesBatchOperation - Param filter.tenantId wrong type (#1) |
| negative-delete | bad-request | `request-validation/decisioninstances-validation-api-tests.spec.ts:588` | deleteDecisionInstancesBatchOperation - Param filter.tenantId wrong type (#2) |
| negative-delete | bad-request | `request-validation/decisioninstances-validation-api-tests.spec.ts:616` | deleteDecisionInstancesBatchOperation - Param operationReference wrong type (#1) |
| negative-delete | bad-request | `request-validation/decisioninstances-validation-api-tests.spec.ts:644` | deleteDecisionInstancesBatchOperation - Param operationReference wrong type (#2) |
| negative-delete | bad-request | `request-validation/decisioninstances-validation-api-tests.spec.ts:672` | deleteDecisionInstancesBatchOperation - Constraint violation filter.decisionDefinitionId (#1) |
| negative-delete | bad-request | `request-validation/decisioninstances-validation-api-tests.spec.ts:700` | deleteDecisionInstancesBatchOperation - Constraint violation filter.decisionDefinitionId (#2) |
| negative-delete | bad-request | `request-validation/decisioninstances-validation-api-tests.spec.ts:728` | deleteDecisionInstancesBatchOperation - Constraint violation filter.tenantId (#1) |
| negative-delete | bad-request | `request-validation/decisioninstances-validation-api-tests.spec.ts:756` | deleteDecisionInstancesBatchOperation - Constraint violation filter.tenantId (#2) |
| negative-delete | bad-request | `request-validation/decisioninstances-validation-api-tests.spec.ts:784` | deleteDecisionInstancesBatchOperation - Constraint violation filter.tenantId (#3) |
| negative-delete | bad-request | `request-validation/decisioninstances-validation-api-tests.spec.ts:812` | deleteDecisionInstancesBatchOperation - Constraint violation filter.tenantId (#4) |
| negative-delete | bad-request | `request-validation/decisioninstances-validation-api-tests.spec.ts:840` | deleteDecisionInstancesBatchOperation - Constraint violation operationReference (#1) |
| negative-delete | bad-request | `request-validation/decisioninstances-validation-api-tests.spec.ts:868` | deleteDecisionInstancesBatchOperation - Constraint violation operationReference (#2) |
| negative-delete | bad-request | `request-validation/decisioninstances-validation-api-tests.spec.ts:896` | deleteDecisionInstancesBatchOperation - Constraint violation operationReference (#3) |
| negative-delete | bad-request | `request-validation/decisioninstances-validation-api-tests.spec.ts:924` | deleteDecisionInstancesBatchOperation - Enum violation filter.decisionDefinitionType |
| negative-delete | bad-request | `request-validation/decisioninstances-validation-api-tests.spec.ts:952` | deleteDecisionInstancesBatchOperation - Missing filter |
| negative-delete | bad-request | `request-validation/decisioninstances-validation-api-tests.spec.ts:967` | deleteDecisionInstancesBatchOperation - Missing body |
| negative-search | bad-request | `request-validation/decisioninstances-validation-api-tests.spec.ts:995` | searchDecisionInstances - Additional prop __unexpectedField |
| negative-search | bad-request | `request-validation/decisioninstances-validation-api-tests.spec.ts:1014` | searchDecisionInstances - Body wrong top-level type |
| negative-search | bad-request | `request-validation/decisioninstances-validation-api-tests.spec.ts:1029` | searchDecisionInstances - Missing sort.0.field |
| negative-search | bad-request | `request-validation/decisioninstances-validation-api-tests.spec.ts:1046` | searchDecisionInstances - Enum violation filter.decisionDefinitionType |
| negative-search | bad-request | `request-validation/decisioninstances-validation-api-tests.spec.ts:1067` | searchDecisionInstances - Enum violation sort.0.field |
| negative-search | bad-request | `request-validation/decisioninstances-validation-api-tests.spec.ts:1088` | searchDecisionInstances - Enum violation sort.0.order |

## J/K/L. Observation-only

**Form**: Perform an action elsewhere (prerequisite) → Get / Search to observe

**Total tests**: 95

### `element-instance` — 55 tests

- **Prerequisite to create**: running-process-instance
- **Files**: `activateAdHocSubProcessActivities.feature.spec.ts`, `activateAdHocSubProcessActivities.variant.spec.ts`, `createElementInstanceVariables.feature.spec.ts`, `getElementInstance.feature.spec.ts`, `request-validation/elementinstances-validation-api-tests.spec.ts`, `searchElementInstanceIncidents.feature.spec.ts`, `searchElementInstanceIncidents.variant.spec.ts`, `searchElementInstances.feature.spec.ts`, `searchElementInstances.variant.spec.ts`
- **Observation channel**: GET = 1, Search = 20
- **Form-step counts**: create=3, observe-present-get=1, observe-present-search=20, observe-absence=1, negative-create=16, negative-get=1, negative-search=13
- **Variants**: happy-path=5, observe-absence=1, data-driven=19, bad-request=30

| form step | variants | file:line | test name |
|--|--|--|--|
| create | happy-path | `activateAdHocSubProcessActivities.feature.spec.ts:9` | feature-1 - activateAdHocSubProcessActivities - base (1) |
| create | data-driven | `activateAdHocSubProcessActivities.variant.spec.ts:9` | variant-1 - activateAdHocSubProcessActivities - bpmn #1 |
| create | happy-path | `createElementInstanceVariables.feature.spec.ts:9` | feature-1 - createElementInstanceVariables - base (1) |
| observe-present-get | happy-path | `getElementInstance.feature.spec.ts:13` | feature-1 - getElementInstance - base (1) |
| observe-present-search | happy-path | `searchElementInstanceIncidents.feature.spec.ts:13` | feature-1 - searchElementInstanceIncidents - base (1) |
| observe-present-search | data-driven | `searchElementInstanceIncidents.variant.spec.ts:13` | variant-1 - searchElementInstanceIncidents - bpmn #1 |
| observe-present-search | data-driven | `searchElementInstanceIncidents.variant.spec.ts:122` | variant-2 - searchElementInstanceIncidents - bpmn #1 |
| observe-present-search | data-driven | `searchElementInstanceIncidents.variant.spec.ts:231` | variant-3 - searchElementInstanceIncidents - bpmn #1 |
| observe-present-search | data-driven | `searchElementInstanceIncidents.variant.spec.ts:340` | variant-4 - searchElementInstanceIncidents - bpmn #1 |
| observe-present-search | data-driven | `searchElementInstanceIncidents.variant.spec.ts:449` | variant-5 - searchElementInstanceIncidents - bpmn #1 |
| observe-present-search | data-driven | `searchElementInstanceIncidents.variant.spec.ts:584` | variant-6 - searchElementInstanceIncidents - bpmn #1 |
| observe-present-search | happy-path | `searchElementInstances.feature.spec.ts:12` | feature-1 - searchElementInstances - base (1) |
| observe-present-search | data-driven | `searchElementInstances.feature.spec.ts:63` | feature-3 - searchElementInstances - oneOf filter.elementInstanceScopeKey variant1 (3) |
| observe-present-search | data-driven | `searchElementInstances.feature.spec.ts:91` | feature-4 - searchElementInstances - oneOf filter.elementInstanceScopeKey variant2 (4) |
| observe-present-search | data-driven | `searchElementInstances.variant.spec.ts:13` | variant-1 - searchElementInstances - bpmn #1 |
| observe-present-search | data-driven | `searchElementInstances.variant.spec.ts:63` | variant-2 - searchElementInstances - bpmn #1 |
| observe-present-search | data-driven | `searchElementInstances.variant.spec.ts:162` | variant-3 - searchElementInstances - path #1 |
| observe-present-search | data-driven | `searchElementInstances.variant.spec.ts:213` | variant-4 - searchElementInstances - bpmn #1 |
| observe-present-search | data-driven | `searchElementInstances.variant.spec.ts:312` | variant-5 - searchElementInstances - bpmn #1 |
| observe-present-search | data-driven | `searchElementInstances.variant.spec.ts:382` | variant-6 - searchElementInstances - bpmn #1 |
| observe-present-search | data-driven | `searchElementInstances.variant.spec.ts:432` | variant-7 - searchElementInstances - bpmn #1 |
| observe-present-search | data-driven | `searchElementInstances.variant.spec.ts:594` | variant-8 - searchElementInstances - bpmn #1 |
| observe-present-search | data-driven | `searchElementInstances.variant.spec.ts:693` | variant-9 - searchElementInstances - path #1 |
| observe-present-search | data-driven | `searchElementInstances.variant.spec.ts:747` | variant-10 - searchElementInstances - path #1 |
| observe-absence | observe-absence | `searchElementInstances.feature.spec.ts:37` | feature-2 - searchElementInstances - negative empty (2) |
| negative-create | bad-request | `request-validation/elementinstances-validation-api-tests.spec.ts:18` | activateAdHocSubProcessActivities - Additional prop __extraField |
| negative-create | bad-request | `request-validation/elementinstances-validation-api-tests.spec.ts:45` | activateAdHocSubProcessActivities - Body wrong top-level type |
| negative-create | bad-request | `request-validation/elementinstances-validation-api-tests.spec.ts:65` | activateAdHocSubProcessActivities - Missing elements.0.elementId |
| negative-create | bad-request | `request-validation/elementinstances-validation-api-tests.spec.ts:87` | activateAdHocSubProcessActivities - Missing elements |
| negative-create | bad-request | `request-validation/elementinstances-validation-api-tests.spec.ts:105` | activateAdHocSubProcessActivities - Missing body |
| negative-create | bad-request | `request-validation/elementinstances-validation-api-tests.spec.ts:120` | activateAdHocSubProcessActivities - Path param adHocSubProcessInstanceKey pattern violation |
| negative-create | bad-request | `request-validation/elementinstances-validation-api-tests.spec.ts:137` | createElementInstanceVariables - Additional prop __unexpectedField |
| negative-create | bad-request | `request-validation/elementinstances-validation-api-tests.spec.ts:160` | createElementInstanceVariables - Body wrong top-level type |
| negative-create | bad-request | `request-validation/elementinstances-validation-api-tests.spec.ts:179` | createElementInstanceVariables - Param operationReference wrong type (#1) |
| negative-create | bad-request | `request-validation/elementinstances-validation-api-tests.spec.ts:201` | createElementInstanceVariables - Param operationReference wrong type (#2) |
| negative-create | bad-request | `request-validation/elementinstances-validation-api-tests.spec.ts:223` | createElementInstanceVariables - Constraint violation operationReference (#1) |
| negative-create | bad-request | `request-validation/elementinstances-validation-api-tests.spec.ts:245` | createElementInstanceVariables - Constraint violation operationReference (#2) |
| negative-create | bad-request | `request-validation/elementinstances-validation-api-tests.spec.ts:267` | createElementInstanceVariables - Constraint violation operationReference (#3) |
| negative-create | bad-request | `request-validation/elementinstances-validation-api-tests.spec.ts:289` | createElementInstanceVariables - Missing variables |
| negative-create | bad-request | `request-validation/elementinstances-validation-api-tests.spec.ts:306` | createElementInstanceVariables - Missing body |
| negative-create | bad-request | `request-validation/elementinstances-validation-api-tests.spec.ts:320` | createElementInstanceVariables - Path param elementInstanceKey pattern violation |
| negative-get | bad-request | `request-validation/elementinstances-validation-api-tests.spec.ts:336` | getElementInstance - Path param elementInstanceKey pattern violation |
| negative-search | bad-request | `request-validation/elementinstances-validation-api-tests.spec.ts:352` | searchElementInstanceIncidents - Additional prop __unexpectedField |
| negative-search | bad-request | `request-validation/elementinstances-validation-api-tests.spec.ts:373` | searchElementInstanceIncidents - Body wrong top-level type |
| negative-search | bad-request | `request-validation/elementinstances-validation-api-tests.spec.ts:392` | searchElementInstanceIncidents - Missing sort.0.field |
| negative-search | bad-request | `request-validation/elementinstances-validation-api-tests.spec.ts:411` | searchElementInstanceIncidents - Enum violation sort.0.field |
| negative-search | bad-request | `request-validation/elementinstances-validation-api-tests.spec.ts:436` | searchElementInstanceIncidents - Enum violation sort.0.order |
| negative-search | bad-request | `request-validation/elementinstances-validation-api-tests.spec.ts:461` | searchElementInstanceIncidents - Missing body |
| negative-search | bad-request | `request-validation/elementinstances-validation-api-tests.spec.ts:475` | searchElementInstanceIncidents - Path param elementInstanceKey pattern violation |
| negative-search | bad-request | `request-validation/elementinstances-validation-api-tests.spec.ts:491` | searchElementInstances - Additional prop __unexpectedField |
| negative-search | bad-request | `request-validation/elementinstances-validation-api-tests.spec.ts:510` | searchElementInstances - Body wrong top-level type |
| negative-search | bad-request | `request-validation/elementinstances-validation-api-tests.spec.ts:525` | searchElementInstances - Missing sort.0.field |
| negative-search | bad-request | `request-validation/elementinstances-validation-api-tests.spec.ts:542` | searchElementInstances - Enum violation filter.type |
| negative-search | bad-request | `request-validation/elementinstances-validation-api-tests.spec.ts:561` | searchElementInstances - Enum violation sort.0.field |
| negative-search | bad-request | `request-validation/elementinstances-validation-api-tests.spec.ts:582` | searchElementInstances - Enum violation sort.0.order |

### `audit-log` — 24 tests

- **Prerequisite to create**: any-prior-action
- **Files**: `getAuditLog.feature.spec.ts`, `request-validation/auditlogs-validation-api-tests.spec.ts`, `searchAuditLogs.feature.spec.ts`, `searchAuditLogs.variant.spec.ts`
- **Observation channel**: GET = 1, Search = 16
- **Form-step counts**: observe-present-get=1, observe-present-search=16, observe-absence=1, negative-get=1, negative-search=5
- **Variants**: happy-path=2, observe-absence=1, data-driven=11, unlabeled=4, bad-request=6

| form step | variants | file:line | test name |
|--|--|--|--|
| observe-present-get | happy-path | `getAuditLog.feature.spec.ts:12` | feature-1 - getAuditLog - base (1) |
| observe-present-search | happy-path | `searchAuditLogs.feature.spec.ts:12` | feature-1 - searchAuditLogs - base (1) |
| observe-present-search | unlabeled | `searchAuditLogs.variant.spec.ts:13` | variant-1 - scenario |
| observe-present-search | data-driven | `searchAuditLogs.variant.spec.ts:42` | variant-2 - searchAuditLogs - bpmn #1 |
| observe-present-search | data-driven | `searchAuditLogs.variant.spec.ts:92` | variant-3 - searchAuditLogs - bpmn #1 |
| observe-present-search | data-driven | `searchAuditLogs.variant.spec.ts:163` | variant-4 - searchAuditLogs - bpmn #1 |
| observe-present-search | unlabeled | `searchAuditLogs.variant.spec.ts:265` | variant-5 - scenario |
| observe-present-search | unlabeled | `searchAuditLogs.variant.spec.ts:293` | variant-6 - scenario |
| observe-present-search | data-driven | `searchAuditLogs.variant.spec.ts:322` | variant-7 - searchAuditLogs - form #1 |
| observe-present-search | data-driven | `searchAuditLogs.variant.spec.ts:371` | variant-8 - searchAuditLogs - bpmn #1 |
| observe-present-search | data-driven | `searchAuditLogs.variant.spec.ts:421` | variant-9 - searchAuditLogs - bpmn #1 |
| observe-present-search | data-driven | `searchAuditLogs.variant.spec.ts:523` | variant-10 - searchAuditLogs - drd #1 |
| observe-present-search | data-driven | `searchAuditLogs.variant.spec.ts:572` | variant-11 - searchAuditLogs - dmn #1 |
| observe-present-search | data-driven | `searchAuditLogs.variant.spec.ts:621` | variant-12 - searchAuditLogs - dmn #1 |
| observe-present-search | unlabeled | `searchAuditLogs.variant.spec.ts:697` | variant-13 - scenario |
| observe-present-search | data-driven | `searchAuditLogs.variant.spec.ts:725` | variant-14 - searchAuditLogs - path #1 |
| observe-present-search | data-driven | `searchAuditLogs.variant.spec.ts:777` | variant-15 - searchAuditLogs - path #1 |
| observe-absence | observe-absence | `searchAuditLogs.feature.spec.ts:35` | feature-2 - searchAuditLogs - negative empty (2) |
| negative-get | bad-request | `request-validation/auditlogs-validation-api-tests.spec.ts:18` | getAuditLog - Path param auditLogKey pattern violation |
| negative-search | bad-request | `request-validation/auditlogs-validation-api-tests.spec.ts:30` | searchAuditLogs - Additional prop __unexpectedField |
| negative-search | bad-request | `request-validation/auditlogs-validation-api-tests.spec.ts:47` | searchAuditLogs - Body wrong top-level type |
| negative-search | bad-request | `request-validation/auditlogs-validation-api-tests.spec.ts:62` | searchAuditLogs - Missing sort.0.field |
| negative-search | bad-request | `request-validation/auditlogs-validation-api-tests.spec.ts:79` | searchAuditLogs - Enum violation sort.0.field |
| negative-search | bad-request | `request-validation/auditlogs-validation-api-tests.spec.ts:100` | searchAuditLogs - Enum violation sort.0.order |

### `variable` — 16 tests

- **Prerequisite to create**: running-process-instance
- **Files**: `getVariable.feature.spec.ts`, `request-validation/variables-validation-api-tests.spec.ts`, `searchVariables.feature.spec.ts`, `searchVariables.variant.spec.ts`
- **Observation channel**: GET = 1, Search = 7
- **Form-step counts**: observe-present-get=1, observe-present-search=7, observe-absence=1, negative-get=1, negative-search=6
- **Variants**: happy-path=2, observe-absence=1, data-driven=4, unlabeled=2, bad-request=7

| form step | variants | file:line | test name |
|--|--|--|--|
| observe-present-get | happy-path | `getVariable.feature.spec.ts:12` | feature-1 - getVariable - base (1) |
| observe-present-search | happy-path | `searchVariables.feature.spec.ts:12` | feature-1 - searchVariables - base (1) |
| observe-present-search | data-driven | `searchVariables.variant.spec.ts:13` | variant-1 - searchVariables - path #1 |
| observe-present-search | unlabeled | `searchVariables.variant.spec.ts:64` | variant-2 - scenario |
| observe-present-search | unlabeled | `searchVariables.variant.spec.ts:93` | variant-3 - scenario |
| observe-present-search | data-driven | `searchVariables.variant.spec.ts:122` | variant-4 - searchVariables - bpmn #1 |
| observe-present-search | data-driven | `searchVariables.variant.spec.ts:191` | variant-5 - searchVariables - path #1 |
| observe-present-search | data-driven | `searchVariables.variant.spec.ts:243` | variant-6 - searchVariables - path #1 |
| observe-absence | observe-absence | `searchVariables.feature.spec.ts:35` | feature-2 - searchVariables - negative empty (2) |
| negative-get | bad-request | `request-validation/variables-validation-api-tests.spec.ts:18` | getVariable - Path param variableKey pattern violation |
| negative-search | bad-request | `request-validation/variables-validation-api-tests.spec.ts:30` | searchVariables - Additional prop __unexpectedField |
| negative-search | bad-request | `request-validation/variables-validation-api-tests.spec.ts:47` | searchVariables - Body wrong top-level type |
| negative-search | bad-request | `request-validation/variables-validation-api-tests.spec.ts:62` | searchVariables - Missing sort.0.field |
| negative-search | bad-request | `request-validation/variables-validation-api-tests.spec.ts:79` | searchVariables - Enum violation sort.0.field |
| negative-search | bad-request | `request-validation/variables-validation-api-tests.spec.ts:100` | searchVariables - Enum violation sort.0.order |
| negative-search | bad-request | `request-validation/variables-validation-api-tests.spec.ts:121` | searchVariables - Param query.truncateValues wrong type |

## M. Messaging/Signals

**Form**: Deploy process with catch event (prerequisite) → Publish/Correlate/Broadcast → Search subscriptions / correlated messages

**Total tests**: 70

### `message` — 30 tests

- **Prerequisite to create**: deployed-process-with-message-catch-event
- **Files**: `correlateMessage.feature.spec.ts`, `correlateMessage.variant.spec.ts`, `publishMessage.feature.spec.ts`, `publishMessage.variant.spec.ts`, `request-validation/messages-validation-api-tests.spec.ts`
- **Observation channel**: GET = 0, Search = 0
- **Form-step counts**: create=4, negative-create=26
- **Variants**: happy-path=2, data-driven=2, bad-request=26

| form step | variants | file:line | test name |
|--|--|--|--|
| create | happy-path | `correlateMessage.feature.spec.ts:11` | feature-1 - correlateMessage - base (1) |
| create | data-driven | `correlateMessage.variant.spec.ts:11` | variant-1 - correlateMessage - path #1 |
| create | happy-path | `publishMessage.feature.spec.ts:11` | feature-1 - publishMessage - base (1) |
| create | data-driven | `publishMessage.variant.spec.ts:11` | variant-1 - publishMessage - path #1 |
| negative-create | bad-request | `request-validation/messages-validation-api-tests.spec.ts:18` | correlateMessage - Additional prop __unexpectedField |
| negative-create | bad-request | `request-validation/messages-validation-api-tests.spec.ts:37` | correlateMessage - Body wrong top-level type |
| negative-create | bad-request | `request-validation/messages-validation-api-tests.spec.ts:52` | correlateMessage - Param name wrong type (#1) |
| negative-create | bad-request | `request-validation/messages-validation-api-tests.spec.ts:70` | correlateMessage - Param name wrong type (#2) |
| negative-create | bad-request | `request-validation/messages-validation-api-tests.spec.ts:88` | correlateMessage - Param tenantId wrong type (#1) |
| negative-create | bad-request | `request-validation/messages-validation-api-tests.spec.ts:106` | correlateMessage - Param tenantId wrong type (#2) |
| negative-create | bad-request | `request-validation/messages-validation-api-tests.spec.ts:124` | correlateMessage - Constraint violation tenantId (#1) |
| negative-create | bad-request | `request-validation/messages-validation-api-tests.spec.ts:142` | correlateMessage - Constraint violation tenantId (#2) |
| negative-create | bad-request | `request-validation/messages-validation-api-tests.spec.ts:160` | correlateMessage - Constraint violation tenantId (#3) |
| negative-create | bad-request | `request-validation/messages-validation-api-tests.spec.ts:178` | correlateMessage - Constraint violation tenantId (#4) |
| negative-create | bad-request | `request-validation/messages-validation-api-tests.spec.ts:196` | correlateMessage - Missing name |
| negative-create | bad-request | `request-validation/messages-validation-api-tests.spec.ts:211` | correlateMessage - Missing body |
| negative-create | bad-request | `request-validation/messages-validation-api-tests.spec.ts:223` | publishMessage - Additional prop __unexpectedField |
| negative-create | bad-request | `request-validation/messages-validation-api-tests.spec.ts:243` | publishMessage - Body wrong top-level type |
| negative-create | bad-request | `request-validation/messages-validation-api-tests.spec.ts:258` | publishMessage - Param name wrong type (#1) |
| negative-create | bad-request | `request-validation/messages-validation-api-tests.spec.ts:277` | publishMessage - Param name wrong type (#2) |
| negative-create | bad-request | `request-validation/messages-validation-api-tests.spec.ts:296` | publishMessage - Param tenantId wrong type (#1) |
| negative-create | bad-request | `request-validation/messages-validation-api-tests.spec.ts:315` | publishMessage - Param tenantId wrong type (#2) |
| negative-create | bad-request | `request-validation/messages-validation-api-tests.spec.ts:334` | publishMessage - Param timeToLive wrong type (#1) |
| negative-create | bad-request | `request-validation/messages-validation-api-tests.spec.ts:353` | publishMessage - Param timeToLive wrong type (#2) |
| negative-create | bad-request | `request-validation/messages-validation-api-tests.spec.ts:372` | publishMessage - Constraint violation tenantId (#1) |
| negative-create | bad-request | `request-validation/messages-validation-api-tests.spec.ts:391` | publishMessage - Constraint violation tenantId (#2) |
| negative-create | bad-request | `request-validation/messages-validation-api-tests.spec.ts:410` | publishMessage - Constraint violation tenantId (#3) |
| negative-create | bad-request | `request-validation/messages-validation-api-tests.spec.ts:429` | publishMessage - Constraint violation tenantId (#4) |
| negative-create | bad-request | `request-validation/messages-validation-api-tests.spec.ts:448` | publishMessage - Missing name |
| negative-create | bad-request | `request-validation/messages-validation-api-tests.spec.ts:463` | publishMessage - Missing body |

### `signal` — 14 tests

- **Prerequisite to create**: deployed-process-with-signal-catch-event
- **Files**: `broadcastSignal.feature.spec.ts`, `broadcastSignal.variant.spec.ts`, `request-validation/signals-validation-api-tests.spec.ts`
- **Observation channel**: GET = 0, Search = 0
- **Form-step counts**: create=2, negative-create=12
- **Variants**: happy-path=1, data-driven=1, bad-request=12

| form step | variants | file:line | test name |
|--|--|--|--|
| create | happy-path | `broadcastSignal.feature.spec.ts:11` | feature-1 - broadcastSignal - base (1) |
| create | data-driven | `broadcastSignal.variant.spec.ts:11` | variant-1 - broadcastSignal - path #1 |
| negative-create | bad-request | `request-validation/signals-validation-api-tests.spec.ts:18` | broadcastSignal - Additional prop __unexpectedField |
| negative-create | bad-request | `request-validation/signals-validation-api-tests.spec.ts:37` | broadcastSignal - Body wrong top-level type |
| negative-create | bad-request | `request-validation/signals-validation-api-tests.spec.ts:52` | broadcastSignal - Param signalName wrong type (#1) |
| negative-create | bad-request | `request-validation/signals-validation-api-tests.spec.ts:70` | broadcastSignal - Param signalName wrong type (#2) |
| negative-create | bad-request | `request-validation/signals-validation-api-tests.spec.ts:88` | broadcastSignal - Param tenantId wrong type (#1) |
| negative-create | bad-request | `request-validation/signals-validation-api-tests.spec.ts:106` | broadcastSignal - Param tenantId wrong type (#2) |
| negative-create | bad-request | `request-validation/signals-validation-api-tests.spec.ts:124` | broadcastSignal - Constraint violation tenantId (#1) |
| negative-create | bad-request | `request-validation/signals-validation-api-tests.spec.ts:142` | broadcastSignal - Constraint violation tenantId (#2) |
| negative-create | bad-request | `request-validation/signals-validation-api-tests.spec.ts:160` | broadcastSignal - Constraint violation tenantId (#3) |
| negative-create | bad-request | `request-validation/signals-validation-api-tests.spec.ts:178` | broadcastSignal - Constraint violation tenantId (#4) |
| negative-create | bad-request | `request-validation/signals-validation-api-tests.spec.ts:196` | broadcastSignal - Missing signalName |
| negative-create | bad-request | `request-validation/signals-validation-api-tests.spec.ts:211` | broadcastSignal - Missing body |

### `correlated-message-subscription` — 13 tests

- **Prerequisite to create**: deployed-process-with-message-catch-event + correlated-message
- **Files**: `request-validation/correlatedmessagesubscriptions-validation-api-tests.spec.ts`, `searchCorrelatedMessageSubscriptions.feature.spec.ts`, `searchCorrelatedMessageSubscriptions.variant.spec.ts`
- **Observation channel**: GET = 0, Search = 7
- **Form-step counts**: observe-present-search=7, observe-absence=1, negative-search=5
- **Variants**: happy-path=1, observe-absence=1, data-driven=6, bad-request=5

| form step | variants | file:line | test name |
|--|--|--|--|
| observe-present-search | happy-path | `searchCorrelatedMessageSubscriptions.feature.spec.ts:12` | feature-1 - searchCorrelatedMessageSubscriptions - base (1) |
| observe-present-search | data-driven | `searchCorrelatedMessageSubscriptions.variant.spec.ts:13` | variant-1 - searchCorrelatedMessageSubscriptions - bpmn #1 |
| observe-present-search | data-driven | `searchCorrelatedMessageSubscriptions.variant.spec.ts:117` | variant-2 - searchCorrelatedMessageSubscriptions - bpmn #1 |
| observe-present-search | data-driven | `searchCorrelatedMessageSubscriptions.variant.spec.ts:170` | variant-3 - searchCorrelatedMessageSubscriptions - bpmn #1 |
| observe-present-search | data-driven | `searchCorrelatedMessageSubscriptions.variant.spec.ts:244` | variant-4 - searchCorrelatedMessageSubscriptions - path #1 |
| observe-present-search | data-driven | `searchCorrelatedMessageSubscriptions.variant.spec.ts:305` | variant-5 - searchCorrelatedMessageSubscriptions - path #1 |
| observe-present-search | data-driven | `searchCorrelatedMessageSubscriptions.variant.spec.ts:360` | variant-6 - searchCorrelatedMessageSubscriptions - path #1 |
| observe-absence | observe-absence | `searchCorrelatedMessageSubscriptions.feature.spec.ts:38` | feature-2 - searchCorrelatedMessageSubscriptions - negative empty (2) |
| negative-search | bad-request | `request-validation/correlatedmessagesubscriptions-validation-api-tests.spec.ts:18` | searchCorrelatedMessageSubscriptions - Additional prop __unexpectedField |
| negative-search | bad-request | `request-validation/correlatedmessagesubscriptions-validation-api-tests.spec.ts:37` | searchCorrelatedMessageSubscriptions - Body wrong top-level type |
| negative-search | bad-request | `request-validation/correlatedmessagesubscriptions-validation-api-tests.spec.ts:54` | searchCorrelatedMessageSubscriptions - Missing sort.0.field |
| negative-search | bad-request | `request-validation/correlatedmessagesubscriptions-validation-api-tests.spec.ts:73` | searchCorrelatedMessageSubscriptions - Enum violation sort.0.field |
| negative-search | bad-request | `request-validation/correlatedmessagesubscriptions-validation-api-tests.spec.ts:96` | searchCorrelatedMessageSubscriptions - Enum violation sort.0.order |

### `message-subscriptions` — 13 tests

- **Prerequisite to create**: deployed-process-with-message-catch-event
- **Files**: `request-validation/messagesubscriptions-validation-api-tests.spec.ts`, `searchMessageSubscriptions.feature.spec.ts`, `searchMessageSubscriptions.variant.spec.ts`
- **Observation channel**: GET = 0, Search = 7
- **Form-step counts**: observe-present-search=7, observe-absence=1, negative-search=5
- **Variants**: happy-path=1, observe-absence=1, data-driven=6, bad-request=5

| form step | variants | file:line | test name |
|--|--|--|--|
| observe-present-search | happy-path | `searchMessageSubscriptions.feature.spec.ts:12` | feature-1 - searchMessageSubscriptions - base (1) |
| observe-present-search | data-driven | `searchMessageSubscriptions.variant.spec.ts:13` | variant-1 - searchMessageSubscriptions - path #1 |
| observe-present-search | data-driven | `searchMessageSubscriptions.variant.spec.ts:69` | variant-2 - searchMessageSubscriptions - bpmn #1 |
| observe-present-search | data-driven | `searchMessageSubscriptions.variant.spec.ts:121` | variant-3 - searchMessageSubscriptions - bpmn #1 |
| observe-present-search | data-driven | `searchMessageSubscriptions.variant.spec.ts:195` | variant-4 - searchMessageSubscriptions - bpmn #1 |
| observe-present-search | data-driven | `searchMessageSubscriptions.variant.spec.ts:298` | variant-5 - searchMessageSubscriptions - path #1 |
| observe-present-search | data-driven | `searchMessageSubscriptions.variant.spec.ts:352` | variant-6 - searchMessageSubscriptions - path #1 |
| observe-absence | observe-absence | `searchMessageSubscriptions.feature.spec.ts:37` | feature-2 - searchMessageSubscriptions - negative empty (2) |
| negative-search | bad-request | `request-validation/messagesubscriptions-validation-api-tests.spec.ts:18` | searchMessageSubscriptions - Additional prop __unexpectedField |
| negative-search | bad-request | `request-validation/messagesubscriptions-validation-api-tests.spec.ts:37` | searchMessageSubscriptions - Body wrong top-level type |
| negative-search | bad-request | `request-validation/messagesubscriptions-validation-api-tests.spec.ts:52` | searchMessageSubscriptions - Missing sort.0.field |
| negative-search | bad-request | `request-validation/messagesubscriptions-validation-api-tests.spec.ts:69` | searchMessageSubscriptions - Enum violation sort.0.field |
| negative-search | bad-request | `request-validation/messagesubscriptions-validation-api-tests.spec.ts:92` | searchMessageSubscriptions - Enum violation sort.0.order |

## N. Engine Evaluation

**Form**: Submit expression / conditional → Receive result (stateless, no entity persisted)

**Total tests**: 25

### `conditional` — 15 tests

- **Prerequisite to create**: none
- **Files**: `evaluateConditionals.feature.spec.ts`, `evaluateConditionals.variant.spec.ts`, `request-validation/conditionals-validation-api-tests.spec.ts`
- **Observation channel**: GET = 0, Search = 0
- **Form-step counts**: create=3, negative-create=12
- **Variants**: happy-path=1, data-driven=2, bad-request=12

| form step | variants | file:line | test name |
|--|--|--|--|
| create | happy-path | `evaluateConditionals.feature.spec.ts:11` | feature-1 - evaluateConditionals - base (1) |
| create | data-driven | `evaluateConditionals.variant.spec.ts:12` | variant-1 - evaluateConditionals - path #1 |
| create | data-driven | `evaluateConditionals.variant.spec.ts:62` | variant-2 - evaluateConditionals - bpmn #1 |
| negative-create | bad-request | `request-validation/conditionals-validation-api-tests.spec.ts:18` | evaluateConditionals - Additional prop __extraField |
| negative-create | bad-request | `request-validation/conditionals-validation-api-tests.spec.ts:38` | evaluateConditionals - Body wrong top-level type |
| negative-create | bad-request | `request-validation/conditionals-validation-api-tests.spec.ts:53` | evaluateConditionals - Param processDefinitionKey wrong type (#1) |
| negative-create | bad-request | `request-validation/conditionals-validation-api-tests.spec.ts:74` | evaluateConditionals - Param processDefinitionKey wrong type (#2) |
| negative-create | bad-request | `request-validation/conditionals-validation-api-tests.spec.ts:95` | evaluateConditionals - Param tenantId wrong type (#1) |
| negative-create | bad-request | `request-validation/conditionals-validation-api-tests.spec.ts:114` | evaluateConditionals - Param tenantId wrong type (#2) |
| negative-create | bad-request | `request-validation/conditionals-validation-api-tests.spec.ts:133` | evaluateConditionals - Constraint violation tenantId (#1) |
| negative-create | bad-request | `request-validation/conditionals-validation-api-tests.spec.ts:154` | evaluateConditionals - Constraint violation tenantId (#2) |
| negative-create | bad-request | `request-validation/conditionals-validation-api-tests.spec.ts:175` | evaluateConditionals - Constraint violation tenantId (#3) |
| negative-create | bad-request | `request-validation/conditionals-validation-api-tests.spec.ts:196` | evaluateConditionals - Constraint violation tenantId (#4) |
| negative-create | bad-request | `request-validation/conditionals-validation-api-tests.spec.ts:217` | evaluateConditionals - Missing variables |
| negative-create | bad-request | `request-validation/conditionals-validation-api-tests.spec.ts:232` | evaluateConditionals - Missing body |

### `expression` — 10 tests

- **Prerequisite to create**: none
- **Files**: `evaluateExpression.feature.spec.ts`, `evaluateExpression.variant.spec.ts`, `request-validation/expression-validation-api-tests.spec.ts`
- **Observation channel**: GET = 0, Search = 0
- **Form-step counts**: create=2, negative-create=8
- **Variants**: happy-path=1, unlabeled=1, bad-request=8

| form step | variants | file:line | test name |
|--|--|--|--|
| create | happy-path | `evaluateExpression.feature.spec.ts:11` | feature-1 - evaluateExpression - base (1) |
| create | unlabeled | `evaluateExpression.variant.spec.ts:11` | variant-1 - scenario |
| negative-create | bad-request | `request-validation/expression-validation-api-tests.spec.ts:18` | evaluateExpression - Additional prop __extraField |
| negative-create | bad-request | `request-validation/expression-validation-api-tests.spec.ts:37` | evaluateExpression - Body wrong top-level type |
| negative-create | bad-request | `request-validation/expression-validation-api-tests.spec.ts:52` | evaluateExpression - Param expression wrong type (#1) |
| negative-create | bad-request | `request-validation/expression-validation-api-tests.spec.ts:70` | evaluateExpression - Param expression wrong type (#2) |
| negative-create | bad-request | `request-validation/expression-validation-api-tests.spec.ts:88` | evaluateExpression - Param scopeKey wrong type (#1) |
| negative-create | bad-request | `request-validation/expression-validation-api-tests.spec.ts:106` | evaluateExpression - Param scopeKey wrong type (#2) |
| negative-create | bad-request | `request-validation/expression-validation-api-tests.spec.ts:124` | evaluateExpression - Missing expression |
| negative-create | bad-request | `request-validation/expression-validation-api-tests.spec.ts:139` | evaluateExpression - Missing body |

## O. System/Admin

**Form**: Read system state (auth, license, cluster, clock, metrics) or perform admin action (pin/reset clock)

**Total tests**: 36

### `setup` — 15 tests

- **Prerequisite to create**: none
- **Files**: `createAdminUser.feature.spec.ts`, `request-validation/setup-validation-api-tests.spec.ts`
- **Observation channel**: GET = 0, Search = 0
- **Form-step counts**: create=1, negative-create=14
- **Variants**: happy-path=1, bad-request=14

| form step | variants | file:line | test name |
|--|--|--|--|
| create | happy-path | `createAdminUser.feature.spec.ts:11` | feature-1 - createAdminUser - base (1) |
| negative-create | bad-request | `request-validation/setup-validation-api-tests.spec.ts:18` | createAdminUser - Additional prop __unexpectedField |
| negative-create | bad-request | `request-validation/setup-validation-api-tests.spec.ts:37` | createAdminUser - Body wrong top-level type |
| negative-create | bad-request | `request-validation/setup-validation-api-tests.spec.ts:52` | createAdminUser - Param password wrong type (#1) |
| negative-create | bad-request | `request-validation/setup-validation-api-tests.spec.ts:70` | createAdminUser - Param password wrong type (#2) |
| negative-create | bad-request | `request-validation/setup-validation-api-tests.spec.ts:88` | createAdminUser - Param username wrong type (#1) |
| negative-create | bad-request | `request-validation/setup-validation-api-tests.spec.ts:106` | createAdminUser - Param username wrong type (#2) |
| negative-create | bad-request | `request-validation/setup-validation-api-tests.spec.ts:124` | createAdminUser - Constraint violation username (#1) |
| negative-create | bad-request | `request-validation/setup-validation-api-tests.spec.ts:143` | createAdminUser - Constraint violation username (#2) |
| negative-create | bad-request | `request-validation/setup-validation-api-tests.spec.ts:161` | createAdminUser - Constraint violation username (#3) |
| negative-create | bad-request | `request-validation/setup-validation-api-tests.spec.ts:179` | createAdminUser - Constraint violation username (#4) |
| negative-create | bad-request | `request-validation/setup-validation-api-tests.spec.ts:198` | createAdminUser - Missing password |
| negative-create | bad-request | `request-validation/setup-validation-api-tests.spec.ts:215` | createAdminUser - Missing username |
| negative-create | bad-request | `request-validation/setup-validation-api-tests.spec.ts:232` | createAdminUser - Missing body |
| negative-create | bad-request | `request-validation/setup-validation-api-tests.spec.ts:244` | createAdminUser - Missing combo username,password |

### `system` — 9 tests

- **Prerequisite to create**: none
- **Files**: `getSystemConfiguration.feature.spec.ts`, `getUsageMetrics.feature.spec.ts`, `request-validation/system-validation-api-tests.spec.ts`
- **Observation channel**: GET = 2, Search = 0
- **Form-step counts**: observe-present-get=2, negative-get=7
- **Variants**: happy-path=2, bad-request=7

| form step | variants | file:line | test name |
|--|--|--|--|
| observe-present-get | happy-path | `getSystemConfiguration.feature.spec.ts:11` | feature-1 - getSystemConfiguration - base (1) |
| observe-present-get | happy-path | `getUsageMetrics.feature.spec.ts:12` | feature-1 - getUsageMetrics - base (1) |
| negative-get | bad-request | `request-validation/system-validation-api-tests.spec.ts:18` | getUsageMetrics - Query param tenantId pattern violation |
| negative-get | bad-request | `request-validation/system-validation-api-tests.spec.ts:32` | getUsageMetrics - Missing param query.endTime |
| negative-get | bad-request | `request-validation/system-validation-api-tests.spec.ts:48` | getUsageMetrics - Missing param query.startTime |
| negative-get | bad-request | `request-validation/system-validation-api-tests.spec.ts:64` | getUsageMetrics - Param query.endTime wrong type |
| negative-get | bad-request | `request-validation/system-validation-api-tests.spec.ts:81` | getUsageMetrics - Param query.startTime wrong type |
| negative-get | bad-request | `request-validation/system-validation-api-tests.spec.ts:98` | getUsageMetrics - Param query.tenantId wrong type |
| negative-get | bad-request | `request-validation/system-validation-api-tests.spec.ts:115` | getUsageMetrics - Param query.withTenants wrong type |

### `clock` — 8 tests

- **Prerequisite to create**: none
- **Files**: `pinClock.feature.spec.ts`, `request-validation/clock-validation-api-tests.spec.ts`, `resetClock.feature.spec.ts`
- **Observation channel**: GET = 0, Search = 0
- **Form-step counts**: create=1, delete=1, negative-create=6
- **Variants**: happy-path=2, bad-request=6

| form step | variants | file:line | test name |
|--|--|--|--|
| create | happy-path | `pinClock.feature.spec.ts:8` | feature-1 - pinClock - base (1) |
| delete | happy-path | `resetClock.feature.spec.ts:8` | feature-1 - resetClock - base (1) |
| negative-create | bad-request | `request-validation/clock-validation-api-tests.spec.ts:18` | pinClock - Additional prop __unexpectedField |
| negative-create | bad-request | `request-validation/clock-validation-api-tests.spec.ts:36` | pinClock - Body wrong top-level type |
| negative-create | bad-request | `request-validation/clock-validation-api-tests.spec.ts:51` | pinClock - Param timestamp wrong type (#1) |
| negative-create | bad-request | `request-validation/clock-validation-api-tests.spec.ts:68` | pinClock - Param timestamp wrong type (#2) |
| negative-create | bad-request | `request-validation/clock-validation-api-tests.spec.ts:85` | pinClock - Missing timestamp |
| negative-create | bad-request | `request-validation/clock-validation-api-tests.spec.ts:100` | pinClock - Missing body |

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

**Total tests**: 49

### `agent-instance` — 49 tests

- **Prerequisite to create**: unknown
- **Files**: `createAgentInstance.feature.spec.ts`, `getAgentInstance.feature.spec.ts`, `request-validation/agentinstances-validation-api-tests.spec.ts`, `searchAgentInstances.feature.spec.ts`, `searchAgentInstances.variant.spec.ts`, `updateAgentInstance.feature.spec.ts`
- **Observation channel**: GET = 1, Search = 8
- **Form-step counts**: create=1, observe-present-get=1, observe-present-search=8, mutate=1, observe-absence=1, negative-create=21, negative-get=1, negative-update=10, negative-search=5
- **Variants**: happy-path=4, observe-absence=1, data-driven=7, bad-request=37

| form step | variants | file:line | test name |
|--|--|--|--|
| create | happy-path | `createAgentInstance.feature.spec.ts:12` | feature-1 - createAgentInstance - base (1) |
| observe-present-get | happy-path | `getAgentInstance.feature.spec.ts:13` | feature-1 - getAgentInstance - base (1) |
| observe-present-search | happy-path | `searchAgentInstances.feature.spec.ts:12` | feature-1 - searchAgentInstances - base (1) |
| observe-present-search | data-driven | `searchAgentInstances.variant.spec.ts:13` | variant-1 - searchAgentInstances - bpmn #1 |
| observe-present-search | data-driven | `searchAgentInstances.variant.spec.ts:155` | variant-2 - searchAgentInstances - bpmn #1 |
| observe-present-search | data-driven | `searchAgentInstances.variant.spec.ts:256` | variant-3 - searchAgentInstances - bpmn #1 |
| observe-present-search | data-driven | `searchAgentInstances.variant.spec.ts:329` | variant-4 - searchAgentInstances - bpmn #1 |
| observe-present-search | data-driven | `searchAgentInstances.variant.spec.ts:381` | variant-5 - searchAgentInstances - bpmn #1 |
| observe-present-search | data-driven | `searchAgentInstances.variant.spec.ts:482` | variant-6 - searchAgentInstances - path #1 |
| observe-present-search | data-driven | `searchAgentInstances.variant.spec.ts:546` | variant-7 - searchAgentInstances - path #1 |
| mutate | happy-path | `updateAgentInstance.feature.spec.ts:9` | feature-1 - updateAgentInstance - base (1) |
| observe-absence | observe-absence | `searchAgentInstances.feature.spec.ts:37` | feature-2 - searchAgentInstances - negative empty (2) |
| negative-create | bad-request | `request-validation/agentinstances-validation-api-tests.spec.ts:18` | createAgentInstance - Additional prop __extraField |
| negative-create | bad-request | `request-validation/agentinstances-validation-api-tests.spec.ts:41` | createAgentInstance - Body wrong top-level type |
| negative-create | bad-request | `request-validation/agentinstances-validation-api-tests.spec.ts:56` | createAgentInstance - Param definition.model wrong type (#1) |
| negative-create | bad-request | `request-validation/agentinstances-validation-api-tests.spec.ts:80` | createAgentInstance - Param definition.model wrong type (#2) |
| negative-create | bad-request | `request-validation/agentinstances-validation-api-tests.spec.ts:104` | createAgentInstance - Param definition.provider wrong type (#1) |
| negative-create | bad-request | `request-validation/agentinstances-validation-api-tests.spec.ts:128` | createAgentInstance - Param definition.provider wrong type (#2) |
| negative-create | bad-request | `request-validation/agentinstances-validation-api-tests.spec.ts:152` | createAgentInstance - Param definition.systemPrompt wrong type (#1) |
| negative-create | bad-request | `request-validation/agentinstances-validation-api-tests.spec.ts:176` | createAgentInstance - Param definition.systemPrompt wrong type (#2) |
| negative-create | bad-request | `request-validation/agentinstances-validation-api-tests.spec.ts:200` | createAgentInstance - Param elementInstanceKey wrong type (#1) |
| negative-create | bad-request | `request-validation/agentinstances-validation-api-tests.spec.ts:224` | createAgentInstance - Param elementInstanceKey wrong type (#2) |
| negative-create | bad-request | `request-validation/agentinstances-validation-api-tests.spec.ts:248` | createAgentInstance - Missing definition.model |
| negative-create | bad-request | `request-validation/agentinstances-validation-api-tests.spec.ts:269` | createAgentInstance - Missing definition.provider |
| negative-create | bad-request | `request-validation/agentinstances-validation-api-tests.spec.ts:290` | createAgentInstance - Missing definition.systemPrompt |
| negative-create | bad-request | `request-validation/agentinstances-validation-api-tests.spec.ts:311` | createAgentInstance - Missing elementInstanceKey (#1) |
| negative-create | bad-request | `request-validation/agentinstances-validation-api-tests.spec.ts:332` | createAgentInstance - Missing limits.maxModelCalls |
| negative-create | bad-request | `request-validation/agentinstances-validation-api-tests.spec.ts:358` | createAgentInstance - Missing limits.maxTokens |
| negative-create | bad-request | `request-validation/agentinstances-validation-api-tests.spec.ts:384` | createAgentInstance - Missing limits.maxToolCalls |
| negative-create | bad-request | `request-validation/agentinstances-validation-api-tests.spec.ts:410` | createAgentInstance - Missing definition |
| negative-create | bad-request | `request-validation/agentinstances-validation-api-tests.spec.ts:427` | createAgentInstance - Missing elementInstanceKey (#2) |
| negative-create | bad-request | `request-validation/agentinstances-validation-api-tests.spec.ts:444` | createAgentInstance - Missing body |
| negative-create | bad-request | `request-validation/agentinstances-validation-api-tests.spec.ts:456` | createAgentInstance - Missing combo elementInstanceKey,definition |
| negative-get | bad-request | `request-validation/agentinstances-validation-api-tests.spec.ts:473` | getAgentInstance - Path param agentInstanceKey pattern violation |
| negative-update | bad-request | `request-validation/agentinstances-validation-api-tests.spec.ts:582` | updateAgentInstance - Additional prop __extraField |
| negative-update | bad-request | `request-validation/agentinstances-validation-api-tests.spec.ts:602` | updateAgentInstance - Body wrong top-level type |
| negative-update | bad-request | `request-validation/agentinstances-validation-api-tests.spec.ts:619` | updateAgentInstance - Param status wrong type (#1) |
| negative-update | bad-request | `request-validation/agentinstances-validation-api-tests.spec.ts:638` | updateAgentInstance - Param status wrong type (#2) |
| negative-update | bad-request | `request-validation/agentinstances-validation-api-tests.spec.ts:657` | updateAgentInstance - Missing tools.0.description |
| negative-update | bad-request | `request-validation/agentinstances-validation-api-tests.spec.ts:681` | updateAgentInstance - Missing tools.0.elementId |
| negative-update | bad-request | `request-validation/agentinstances-validation-api-tests.spec.ts:705` | updateAgentInstance - Missing tools.0.name |
| negative-update | bad-request | `request-validation/agentinstances-validation-api-tests.spec.ts:729` | updateAgentInstance - Enum violation status |
| negative-update | bad-request | `request-validation/agentinstances-validation-api-tests.spec.ts:748` | updateAgentInstance - Missing body |
| negative-update | bad-request | `request-validation/agentinstances-validation-api-tests.spec.ts:762` | updateAgentInstance - Path param agentInstanceKey pattern violation |
| negative-search | bad-request | `request-validation/agentinstances-validation-api-tests.spec.ts:489` | searchAgentInstances - Additional prop __unexpectedField |
| negative-search | bad-request | `request-validation/agentinstances-validation-api-tests.spec.ts:508` | searchAgentInstances - Body wrong top-level type |
| negative-search | bad-request | `request-validation/agentinstances-validation-api-tests.spec.ts:523` | searchAgentInstances - Missing sort.0.field |
| negative-search | bad-request | `request-validation/agentinstances-validation-api-tests.spec.ts:540` | searchAgentInstances - Enum violation sort.0.field |
| negative-search | bad-request | `request-validation/agentinstances-validation-api-tests.spec.ts:561` | searchAgentInstances - Enum violation sort.0.order |

