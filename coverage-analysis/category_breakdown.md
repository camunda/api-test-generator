# api-test-generator — Per-category breakdown

Total test declarations: **518** across **37** entities.

This file answers, per category: **(1) Form** (the canonical sequence), **(2) Prerequisite to create**, **(3) Observation channel split** (GET vs Search), **(4) Variants with counts**, **(5) The actual tests in that category**.

Categories and the entity → category mapping mirror the upstream `c8-orchestration-cluster-e2e-test-suite/coverage-analysis/category_breakdown.md` so the two files can be diffed side-by-side.

## Table of contents

- [A. Entity Lifecycle (CRUD)](#a-entity-lifecycle-crud) — 84 tests
- [B. Membership/Association](#b-membershipassociation) — 68 tests
- [C. Deployment Lifecycle](#c-deployment-lifecycle) — 64 tests
- [D. Process-Instance Lifecycle & Ops](#d-process-instance-lifecycle--ops) — 107 tests
- [E. Batch-Operation Lifecycle](#e-batch-operation-lifecycle) — 13 tests
- [F. User-Task Lifecycle](#f-user-task-lifecycle) — 20 tests
- [G. Job Lifecycle & Stats](#g-job-lifecycle--stats) — 27 tests
- [H. Incident Lifecycle](#h-incident-lifecycle) — 12 tests
- [I. Decision-Instance Lifecycle](#i-decision-instance-lifecycle) — 27 tests
- [J/K/L. Observation-only](#jkl-observation-only) — 52 tests
- [M. Messaging/Signals](#m-messagingsignals) — 22 tests
- [N. Engine Evaluation](#n-engine-evaluation) — 4 tests
- [O. System/Admin](#o-systemadmin) — 9 tests
- [P. Agent-Instance (new in v2)](#p-agent-instance-new-in-v2) — 9 tests

## A. Entity Lifecycle (CRUD)

**Form**: Create Entity → Get Entity (Observe Present) → Update Entity → Search Entity (Observe via list) → Delete Entity → Get Entity (Observe Absence)

**Total tests**: 84

### `authorization` — 12 tests

- **Prerequisite to create**: owner-entity-or-resource
- **Files**: `createAuthorization.feature.spec.ts`, `deleteAuthorization.feature.spec.ts`, `getAuthorization.feature.spec.ts`, `searchAuthorizations.feature.spec.ts`, `searchAuthorizations.variant.spec.ts`, `updateAuthorization.feature.spec.ts`
- **Observation channel**: GET = 1, Search = 3
- **Form-step counts**: create=3, observe-present-get=1, observe-present-search=3, mutate=3, delete=1, observe-absence=1
- **Variants**: happy-path=5, observe-absence=1, data-driven=6

| form step | variants | file:line | test name |
|--|--|--|--|
| create | happy-path | `createAuthorization.feature.spec.ts:11` | feature-1 - createAuthorization - base (1) |
| create | data-driven | `createAuthorization.feature.spec.ts:52` | feature-2 - createAuthorization - oneOf group0 variant1 (2) |
| create | data-driven | `createAuthorization.feature.spec.ts:94` | feature-3 - createAuthorization - oneOf group0 variant2 (3) |
| observe-present-get | happy-path | `getAuthorization.feature.spec.ts:12` | feature-1 - getAuthorization - base (1) |
| observe-present-search | happy-path | `searchAuthorizations.feature.spec.ts:12` | feature-1 - searchAuthorizations - base (1) |
| observe-present-search | data-driven | `searchAuthorizations.variant.spec.ts:12` | variant-1 - searchAuthorizations - path #1 |
| observe-present-search | data-driven | `searchAuthorizations.variant.spec.ts:65` | variant-2 - searchAuthorizations - path #1 |
| mutate | happy-path | `updateAuthorization.feature.spec.ts:8` | feature-1 - updateAuthorization - base (1) |
| mutate | data-driven | `updateAuthorization.feature.spec.ts:63` | feature-2 - updateAuthorization - oneOf group0 variant1 (2) |
| mutate | data-driven | `updateAuthorization.feature.spec.ts:119` | feature-3 - updateAuthorization - oneOf group0 variant2 (3) |
| delete | happy-path | `deleteAuthorization.feature.spec.ts:8` | feature-1 - deleteAuthorization - base (1) |
| observe-absence | observe-absence | `searchAuthorizations.feature.spec.ts:37` | feature-2 - searchAuthorizations - negative empty (2) |

### `cluster-variables` — 12 tests

- **Prerequisite to create**: none
- **Files**: `createGlobalClusterVariable.feature.spec.ts`, `createTenantClusterVariable.feature.spec.ts`, `deleteGlobalClusterVariable.feature.spec.ts`, `deleteTenantClusterVariable.feature.spec.ts`, `getGlobalClusterVariable.feature.spec.ts`, `getTenantClusterVariable.feature.spec.ts`, `searchClusterVariables.feature.spec.ts`, `searchClusterVariables.variant.spec.ts`, `updateGlobalClusterVariable.feature.spec.ts`, `updateTenantClusterVariable.feature.spec.ts`
- **Observation channel**: GET = 2, Search = 3
- **Form-step counts**: create=2, observe-present-get=2, observe-present-search=3, mutate=2, delete=2, observe-absence=1
- **Variants**: happy-path=9, observe-absence=1, data-driven=2

| form step | variants | file:line | test name |
|--|--|--|--|
| create | happy-path | `createGlobalClusterVariable.feature.spec.ts:11` | feature-1 - createGlobalClusterVariable - base (1) |
| create | happy-path | `createTenantClusterVariable.feature.spec.ts:11` | feature-1 - createTenantClusterVariable - base (1) |
| observe-present-get | happy-path | `getGlobalClusterVariable.feature.spec.ts:12` | feature-1 - getGlobalClusterVariable - base (1) |
| observe-present-get | happy-path | `getTenantClusterVariable.feature.spec.ts:12` | feature-1 - getTenantClusterVariable - base (1) |
| observe-present-search | happy-path | `searchClusterVariables.feature.spec.ts:12` | feature-1 - searchClusterVariables - base (1) |
| observe-present-search | data-driven | `searchClusterVariables.variant.spec.ts:12` | variant-1 - searchClusterVariables - path #1 |
| observe-present-search | data-driven | `searchClusterVariables.variant.spec.ts:65` | variant-2 - searchClusterVariables - path #1 |
| mutate | happy-path | `updateGlobalClusterVariable.feature.spec.ts:11` | feature-1 - updateGlobalClusterVariable - base (1) |
| mutate | happy-path | `updateTenantClusterVariable.feature.spec.ts:11` | feature-1 - updateTenantClusterVariable - base (1) |
| delete | happy-path | `deleteGlobalClusterVariable.feature.spec.ts:8` | feature-1 - deleteGlobalClusterVariable - base (1) |
| delete | happy-path | `deleteTenantClusterVariable.feature.spec.ts:8` | feature-1 - deleteTenantClusterVariable - base (1) |
| observe-absence | observe-absence | `searchClusterVariables.feature.spec.ts:37` | feature-2 - searchClusterVariables - negative empty (2) |

### `document` — 9 tests

- **Prerequisite to create**: none
- **Files**: `createDocument.feature.spec.ts`, `createDocument.variant.spec.ts`, `createDocumentLink.feature.spec.ts`, `createDocuments.feature.spec.ts`, `createDocuments.variant.spec.ts`, `deleteDocument.feature.spec.ts`, `getDocument.feature.spec.ts`
- **Observation channel**: GET = 1, Search = 0
- **Form-step counts**: create=7, observe-present-get=1, delete=1
- **Variants**: happy-path=5, data-driven=4

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

### `mapping-rule` — 9 tests

- **Prerequisite to create**: none
- **Files**: `createMappingRule.feature.spec.ts`, `deleteMappingRule.feature.spec.ts`, `getMappingRule.feature.spec.ts`, `searchMappingRule.feature.spec.ts`, `searchMappingRule.variant.spec.ts`, `updateMappingRule.feature.spec.ts`
- **Observation channel**: GET = 1, Search = 4
- **Form-step counts**: create=1, observe-present-get=1, observe-present-search=4, mutate=1, delete=1, observe-absence=1
- **Variants**: happy-path=5, observe-absence=1, data-driven=3

| form step | variants | file:line | test name |
|--|--|--|--|
| create | happy-path | `createMappingRule.feature.spec.ts:11` | feature-1 - createMappingRule - base (1) |
| observe-present-get | happy-path | `getMappingRule.feature.spec.ts:12` | feature-1 - getMappingRule - base (1) |
| observe-present-search | happy-path | `searchMappingRule.feature.spec.ts:12` | feature-1 - searchMappingRule - base (1) |
| observe-present-search | data-driven | `searchMappingRule.variant.spec.ts:12` | variant-1 - searchMappingRule - path #1 |
| observe-present-search | data-driven | `searchMappingRule.variant.spec.ts:106` | variant-2 - searchMappingRule - path #1 |
| observe-present-search | data-driven | `searchMappingRule.variant.spec.ts:159` | variant-3 - searchMappingRule - path #1 |
| mutate | happy-path | `updateMappingRule.feature.spec.ts:11` | feature-1 - updateMappingRule - base (1) |
| delete | happy-path | `deleteMappingRule.feature.spec.ts:8` | feature-1 - deleteMappingRule - base (1) |
| observe-absence | observe-absence | `searchMappingRule.feature.spec.ts:37` | feature-2 - searchMappingRule - negative empty (2) |

### `role` — 9 tests

- **Prerequisite to create**: none
- **Files**: `createRole.feature.spec.ts`, `deleteRole.feature.spec.ts`, `getRole.feature.spec.ts`, `searchRoles.feature.spec.ts`, `searchRoles.variant.spec.ts`, `updateRole.feature.spec.ts`
- **Observation channel**: GET = 1, Search = 4
- **Form-step counts**: create=1, observe-present-get=1, observe-present-search=4, mutate=1, delete=1, observe-absence=1
- **Variants**: happy-path=5, observe-absence=1, data-driven=3

| form step | variants | file:line | test name |
|--|--|--|--|
| create | happy-path | `createRole.feature.spec.ts:11` | feature-1 - createRole - base (1) |
| observe-present-get | happy-path | `getRole.feature.spec.ts:12` | feature-1 - getRole - base (1) |
| observe-present-search | happy-path | `searchRoles.feature.spec.ts:12` | feature-1 - searchRoles - base (1) |
| observe-present-search | data-driven | `searchRoles.variant.spec.ts:12` | variant-1 - searchRoles - path #1 |
| observe-present-search | data-driven | `searchRoles.variant.spec.ts:104` | variant-2 - searchRoles - path #1 |
| observe-present-search | data-driven | `searchRoles.variant.spec.ts:155` | variant-3 - searchRoles - path #1 |
| mutate | happy-path | `updateRole.feature.spec.ts:11` | feature-1 - updateRole - base (1) |
| delete | happy-path | `deleteRole.feature.spec.ts:8` | feature-1 - deleteRole - base (1) |
| observe-absence | observe-absence | `searchRoles.feature.spec.ts:35` | feature-2 - searchRoles - negative empty (2) |

### `tenant` — 9 tests

- **Prerequisite to create**: none
- **Files**: `createTenant.feature.spec.ts`, `deleteTenant.feature.spec.ts`, `getTenant.feature.spec.ts`, `searchTenants.feature.spec.ts`, `searchTenants.variant.spec.ts`, `updateTenant.feature.spec.ts`
- **Observation channel**: GET = 1, Search = 4
- **Form-step counts**: create=1, observe-present-get=1, observe-present-search=4, mutate=1, delete=1, observe-absence=1
- **Variants**: happy-path=5, observe-absence=1, data-driven=3

| form step | variants | file:line | test name |
|--|--|--|--|
| create | happy-path | `createTenant.feature.spec.ts:11` | feature-1 - createTenant - base (1) |
| observe-present-get | happy-path | `getTenant.feature.spec.ts:12` | feature-1 - getTenant - base (1) |
| observe-present-search | happy-path | `searchTenants.feature.spec.ts:12` | feature-1 - searchTenants - base (1) |
| observe-present-search | data-driven | `searchTenants.variant.spec.ts:12` | variant-1 - searchTenants - path #1 |
| observe-present-search | data-driven | `searchTenants.variant.spec.ts:63` | variant-2 - searchTenants - path #1 |
| observe-present-search | data-driven | `searchTenants.variant.spec.ts:114` | variant-3 - searchTenants - path #1 |
| mutate | happy-path | `updateTenant.feature.spec.ts:11` | feature-1 - updateTenant - base (1) |
| delete | happy-path | `deleteTenant.feature.spec.ts:8` | feature-1 - deleteTenant - base (1) |
| observe-absence | observe-absence | `searchTenants.feature.spec.ts:35` | feature-2 - searchTenants - negative empty (2) |

### `global-task-listener` — 8 tests

- **Prerequisite to create**: none
- **Files**: `createGlobalTaskListener.feature.spec.ts`, `deleteGlobalTaskListener.feature.spec.ts`, `getGlobalTaskListener.feature.spec.ts`, `searchGlobalTaskListeners.feature.spec.ts`, `searchGlobalTaskListeners.variant.spec.ts`, `updateGlobalTaskListener.feature.spec.ts`
- **Observation channel**: GET = 1, Search = 3
- **Form-step counts**: create=1, observe-present-get=1, observe-present-search=3, mutate=1, delete=1, observe-absence=1
- **Variants**: happy-path=5, observe-absence=1, data-driven=2

| form step | variants | file:line | test name |
|--|--|--|--|
| create | happy-path | `createGlobalTaskListener.feature.spec.ts:11` | feature-1 - createGlobalTaskListener - base (1) |
| observe-present-get | happy-path | `getGlobalTaskListener.feature.spec.ts:12` | feature-1 - getGlobalTaskListener - base (1) |
| observe-present-search | happy-path | `searchGlobalTaskListeners.feature.spec.ts:12` | feature-1 - searchGlobalTaskListeners - base (1) |
| observe-present-search | data-driven | `searchGlobalTaskListeners.variant.spec.ts:12` | variant-1 - searchGlobalTaskListeners - path #1 |
| observe-present-search | data-driven | `searchGlobalTaskListeners.variant.spec.ts:65` | variant-2 - searchGlobalTaskListeners - path #1 |
| mutate | happy-path | `updateGlobalTaskListener.feature.spec.ts:11` | feature-1 - updateGlobalTaskListener - base (1) |
| delete | happy-path | `deleteGlobalTaskListener.feature.spec.ts:8` | feature-1 - deleteGlobalTaskListener - base (1) |
| observe-absence | observe-absence | `searchGlobalTaskListeners.feature.spec.ts:37` | feature-2 - searchGlobalTaskListeners - negative empty (2) |

### `group` — 8 tests

- **Prerequisite to create**: none
- **Files**: `createGroup.feature.spec.ts`, `deleteGroup.feature.spec.ts`, `getGroup.feature.spec.ts`, `searchGroups.feature.spec.ts`, `searchGroups.variant.spec.ts`, `updateGroup.feature.spec.ts`
- **Observation channel**: GET = 1, Search = 3
- **Form-step counts**: create=1, observe-present-get=1, observe-present-search=3, mutate=1, delete=1, observe-absence=1
- **Variants**: happy-path=5, observe-absence=1, data-driven=2

| form step | variants | file:line | test name |
|--|--|--|--|
| create | happy-path | `createGroup.feature.spec.ts:11` | feature-1 - createGroup - base (1) |
| observe-present-get | happy-path | `getGroup.feature.spec.ts:12` | feature-1 - getGroup - base (1) |
| observe-present-search | happy-path | `searchGroups.feature.spec.ts:12` | feature-1 - searchGroups - base (1) |
| observe-present-search | data-driven | `searchGroups.variant.spec.ts:12` | variant-1 - searchGroups - path #1 |
| observe-present-search | data-driven | `searchGroups.variant.spec.ts:63` | variant-2 - searchGroups - path #1 |
| mutate | happy-path | `updateGroup.feature.spec.ts:11` | feature-1 - updateGroup - base (1) |
| delete | happy-path | `deleteGroup.feature.spec.ts:8` | feature-1 - deleteGroup - base (1) |
| observe-absence | observe-absence | `searchGroups.feature.spec.ts:35` | feature-2 - searchGroups - negative empty (2) |

### `user` — 8 tests

- **Prerequisite to create**: none
- **Files**: `createUser.feature.spec.ts`, `deleteUser.feature.spec.ts`, `getUser.feature.spec.ts`, `searchUsers.feature.spec.ts`, `searchUsers.variant.spec.ts`, `updateUser.feature.spec.ts`
- **Observation channel**: GET = 1, Search = 3
- **Form-step counts**: create=1, observe-present-get=1, observe-present-search=3, mutate=1, delete=1, observe-absence=1
- **Variants**: happy-path=5, observe-absence=1, data-driven=2

| form step | variants | file:line | test name |
|--|--|--|--|
| create | happy-path | `createUser.feature.spec.ts:11` | feature-1 - createUser - base (1) |
| observe-present-get | happy-path | `getUser.feature.spec.ts:12` | feature-1 - getUser - base (1) |
| observe-present-search | happy-path | `searchUsers.feature.spec.ts:12` | feature-1 - searchUsers - base (1) |
| observe-present-search | data-driven | `searchUsers.variant.spec.ts:12` | variant-1 - searchUsers - path #1 |
| observe-present-search | data-driven | `searchUsers.variant.spec.ts:63` | variant-2 - searchUsers - path #1 |
| mutate | happy-path | `updateUser.feature.spec.ts:11` | feature-1 - updateUser - base (1) |
| delete | happy-path | `deleteUser.feature.spec.ts:8` | feature-1 - deleteUser - base (1) |
| observe-absence | observe-absence | `searchUsers.feature.spec.ts:35` | feature-2 - searchUsers - negative empty (2) |

## B. Membership/Association

**Form**: Create parent + member (prerequisite) → Assign member → Search members (Observe Present) → Unassign member → Search members (Observe Absence)

**Total tests**: 68

### `tenant` — 27 tests

- **Prerequisite to create**: tenant + client, tenant + group, tenant + groupid, tenant + mappingrule, tenant + role, tenant + user
- **Files**: `assignClientToTenant.feature.spec.ts`, `assignGroupToTenant.feature.spec.ts`, `assignMappingRuleToTenant.feature.spec.ts`, `assignRoleToTenant.feature.spec.ts`, `assignUserToTenant.feature.spec.ts`, `searchClientsForTenant.feature.spec.ts`, `searchClientsForTenant.variant.spec.ts`, `searchGroupIdsForTenant.feature.spec.ts`, `searchGroupIdsForTenant.variant.spec.ts`, `searchMappingRulesForTenant.feature.spec.ts`, `searchMappingRulesForTenant.variant.spec.ts`, `searchRolesForTenant.feature.spec.ts`, `searchRolesForTenant.variant.spec.ts`, `searchUsersForTenant.feature.spec.ts`, `searchUsersForTenant.variant.spec.ts`, `unassignClientFromTenant.feature.spec.ts`, `unassignGroupFromTenant.feature.spec.ts`, `unassignMappingRuleFromTenant.feature.spec.ts`, `unassignRoleFromTenant.feature.spec.ts`, `unassignUserFromTenant.feature.spec.ts`
- **Observation channel**: GET = 0, Search = 17
- **Form-step counts**: observe-present-search=17, mutate=5, delete=5
- **Variants**: happy-path=15, data-driven=12

| form step | variants | file:line | test name |
|--|--|--|--|
| observe-present-search | happy-path | `searchClientsForTenant.feature.spec.ts:12` | feature-1 - searchClientsForTenant - base (1) |
| observe-present-search | data-driven | `searchClientsForTenant.variant.spec.ts:12` | variant-1 - searchClientsForTenant - path #1 |
| observe-present-search | data-driven | `searchClientsForTenant.variant.spec.ts:87` | variant-2 - searchClientsForTenant - path #1 |
| observe-present-search | happy-path | `searchGroupIdsForTenant.feature.spec.ts:12` | feature-1 - searchGroupIdsForTenant - base (1) |
| observe-present-search | data-driven | `searchGroupIdsForTenant.variant.spec.ts:12` | variant-1 - searchGroupIdsForTenant - path #1 |
| observe-present-search | data-driven | `searchGroupIdsForTenant.variant.spec.ts:87` | variant-2 - searchGroupIdsForTenant - path #1 |
| observe-present-search | happy-path | `searchMappingRulesForTenant.feature.spec.ts:12` | feature-1 - searchMappingRulesForTenant - base (1) |
| observe-present-search | data-driven | `searchMappingRulesForTenant.variant.spec.ts:12` | variant-1 - searchMappingRulesForTenant - path #1 |
| observe-present-search | data-driven | `searchMappingRulesForTenant.variant.spec.ts:125` | variant-2 - searchMappingRulesForTenant - path #1 |
| observe-present-search | data-driven | `searchMappingRulesForTenant.variant.spec.ts:201` | variant-3 - searchMappingRulesForTenant - path #1 |
| observe-present-search | happy-path | `searchRolesForTenant.feature.spec.ts:12` | feature-1 - searchRolesForTenant - base (1) |
| observe-present-search | data-driven | `searchRolesForTenant.variant.spec.ts:12` | variant-1 - searchRolesForTenant - path #1 |
| observe-present-search | data-driven | `searchRolesForTenant.variant.spec.ts:125` | variant-2 - searchRolesForTenant - path #1 |
| observe-present-search | data-driven | `searchRolesForTenant.variant.spec.ts:201` | variant-3 - searchRolesForTenant - path #1 |
| observe-present-search | happy-path | `searchUsersForTenant.feature.spec.ts:12` | feature-1 - searchUsersForTenant - base (1) |
| observe-present-search | data-driven | `searchUsersForTenant.variant.spec.ts:12` | variant-1 - searchUsersForTenant - path #1 |
| observe-present-search | data-driven | `searchUsersForTenant.variant.spec.ts:87` | variant-2 - searchUsersForTenant - path #1 |
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

### `role` — 21 tests

- **Prerequisite to create**: client + role, group + role, mappingrule + role, role + client, role + group, role + mappingrule, role + user, user + role
- **Files**: `assignRoleToClient.feature.spec.ts`, `assignRoleToGroup.feature.spec.ts`, `assignRoleToMappingRule.feature.spec.ts`, `assignRoleToUser.feature.spec.ts`, `searchClientsForRole.feature.spec.ts`, `searchClientsForRole.variant.spec.ts`, `searchGroupsForRole.feature.spec.ts`, `searchGroupsForRole.variant.spec.ts`, `searchMappingRulesForRole.feature.spec.ts`, `searchMappingRulesForRole.variant.spec.ts`, `searchUsersForRole.feature.spec.ts`, `searchUsersForRole.variant.spec.ts`, `unassignRoleFromClient.feature.spec.ts`, `unassignRoleFromGroup.feature.spec.ts`, `unassignRoleFromMappingRule.feature.spec.ts`, `unassignRoleFromUser.feature.spec.ts`
- **Observation channel**: GET = 0, Search = 13
- **Form-step counts**: observe-present-search=13, mutate=4, delete=4
- **Variants**: happy-path=12, data-driven=9

| form step | variants | file:line | test name |
|--|--|--|--|
| observe-present-search | happy-path | `searchClientsForRole.feature.spec.ts:12` | feature-1 - searchClientsForRole - base (1) |
| observe-present-search | data-driven | `searchClientsForRole.variant.spec.ts:12` | variant-1 - searchClientsForRole - path #1 |
| observe-present-search | data-driven | `searchClientsForRole.variant.spec.ts:85` | variant-2 - searchClientsForRole - path #1 |
| observe-present-search | happy-path | `searchGroupsForRole.feature.spec.ts:12` | feature-1 - searchGroupsForRole - base (1) |
| observe-present-search | data-driven | `searchGroupsForRole.variant.spec.ts:12` | variant-1 - searchGroupsForRole - path #1 |
| observe-present-search | data-driven | `searchGroupsForRole.variant.spec.ts:85` | variant-2 - searchGroupsForRole - path #1 |
| observe-present-search | happy-path | `searchMappingRulesForRole.feature.spec.ts:12` | feature-1 - searchMappingRulesForRole - base (1) |
| observe-present-search | data-driven | `searchMappingRulesForRole.variant.spec.ts:12` | variant-1 - searchMappingRulesForRole - path #1 |
| observe-present-search | data-driven | `searchMappingRulesForRole.variant.spec.ts:123` | variant-2 - searchMappingRulesForRole - path #1 |
| observe-present-search | data-driven | `searchMappingRulesForRole.variant.spec.ts:197` | variant-3 - searchMappingRulesForRole - path #1 |
| observe-present-search | happy-path | `searchUsersForRole.feature.spec.ts:12` | feature-1 - searchUsersForRole - base (1) |
| observe-present-search | data-driven | `searchUsersForRole.variant.spec.ts:12` | variant-1 - searchUsersForRole - path #1 |
| observe-present-search | data-driven | `searchUsersForRole.variant.spec.ts:85` | variant-2 - searchUsersForRole - path #1 |
| mutate | happy-path | `assignRoleToClient.feature.spec.ts:8` | feature-1 - assignRoleToClient - base (1) |
| mutate | happy-path | `assignRoleToGroup.feature.spec.ts:8` | feature-1 - assignRoleToGroup - base (1) |
| mutate | happy-path | `assignRoleToMappingRule.feature.spec.ts:8` | feature-1 - assignRoleToMappingRule - base (1) |
| mutate | happy-path | `assignRoleToUser.feature.spec.ts:8` | feature-1 - assignRoleToUser - base (1) |
| delete | happy-path | `unassignRoleFromClient.feature.spec.ts:8` | feature-1 - unassignRoleFromClient - base (1) |
| delete | happy-path | `unassignRoleFromGroup.feature.spec.ts:8` | feature-1 - unassignRoleFromGroup - base (1) |
| delete | happy-path | `unassignRoleFromMappingRule.feature.spec.ts:8` | feature-1 - unassignRoleFromMappingRule - base (1) |
| delete | happy-path | `unassignRoleFromUser.feature.spec.ts:8` | feature-1 - unassignRoleFromUser - base (1) |

### `group` — 20 tests

- **Prerequisite to create**: group + client, group + mappingrule, group + role, group + user
- **Files**: `assignClientToGroup.feature.spec.ts`, `assignMappingRuleToGroup.feature.spec.ts`, `assignUserToGroup.feature.spec.ts`, `searchClientsForGroup.feature.spec.ts`, `searchClientsForGroup.variant.spec.ts`, `searchMappingRulesForGroup.feature.spec.ts`, `searchMappingRulesForGroup.variant.spec.ts`, `searchRolesForGroup.feature.spec.ts`, `searchRolesForGroup.variant.spec.ts`, `searchUsersForGroup.feature.spec.ts`, `searchUsersForGroup.variant.spec.ts`, `unassignClientFromGroup.feature.spec.ts`, `unassignMappingRuleFromGroup.feature.spec.ts`, `unassignUserFromGroup.feature.spec.ts`
- **Observation channel**: GET = 0, Search = 14
- **Form-step counts**: observe-present-search=14, mutate=3, delete=3
- **Variants**: happy-path=10, data-driven=10

| form step | variants | file:line | test name |
|--|--|--|--|
| observe-present-search | happy-path | `searchClientsForGroup.feature.spec.ts:12` | feature-1 - searchClientsForGroup - base (1) |
| observe-present-search | data-driven | `searchClientsForGroup.variant.spec.ts:12` | variant-1 - searchClientsForGroup - path #1 |
| observe-present-search | data-driven | `searchClientsForGroup.variant.spec.ts:85` | variant-2 - searchClientsForGroup - path #1 |
| observe-present-search | happy-path | `searchMappingRulesForGroup.feature.spec.ts:12` | feature-1 - searchMappingRulesForGroup - base (1) |
| observe-present-search | data-driven | `searchMappingRulesForGroup.variant.spec.ts:12` | variant-1 - searchMappingRulesForGroup - path #1 |
| observe-present-search | data-driven | `searchMappingRulesForGroup.variant.spec.ts:84` | variant-2 - searchMappingRulesForGroup - path #1 |
| observe-present-search | data-driven | `searchMappingRulesForGroup.variant.spec.ts:158` | variant-3 - searchMappingRulesForGroup - path #1 |
| observe-present-search | happy-path | `searchRolesForGroup.feature.spec.ts:12` | feature-1 - searchRolesForGroup - base (1) |
| observe-present-search | data-driven | `searchRolesForGroup.variant.spec.ts:12` | variant-1 - searchRolesForGroup - path #1 |
| observe-present-search | data-driven | `searchRolesForGroup.variant.spec.ts:84` | variant-2 - searchRolesForGroup - path #1 |
| observe-present-search | data-driven | `searchRolesForGroup.variant.spec.ts:158` | variant-3 - searchRolesForGroup - path #1 |
| observe-present-search | happy-path | `searchUsersForGroup.feature.spec.ts:12` | feature-1 - searchUsersForGroup - base (1) |
| observe-present-search | data-driven | `searchUsersForGroup.variant.spec.ts:12` | variant-1 - searchUsersForGroup - path #1 |
| observe-present-search | data-driven | `searchUsersForGroup.variant.spec.ts:85` | variant-2 - searchUsersForGroup - path #1 |
| mutate | happy-path | `assignClientToGroup.feature.spec.ts:8` | feature-1 - assignClientToGroup - base (1) |
| mutate | happy-path | `assignMappingRuleToGroup.feature.spec.ts:8` | feature-1 - assignMappingRuleToGroup - base (1) |
| mutate | happy-path | `assignUserToGroup.feature.spec.ts:8` | feature-1 - assignUserToGroup - base (1) |
| delete | happy-path | `unassignClientFromGroup.feature.spec.ts:8` | feature-1 - unassignClientFromGroup - base (1) |
| delete | happy-path | `unassignMappingRuleFromGroup.feature.spec.ts:8` | feature-1 - unassignMappingRuleFromGroup - base (1) |
| delete | happy-path | `unassignUserFromGroup.feature.spec.ts:8` | feature-1 - unassignUserFromGroup - base (1) |

## C. Deployment Lifecycle

**Form**: Deploy resource → Get definition (XML/JSON) → Search definitions (Observe Present) → Delete resource → Get definition (Observe Absence)

**Total tests**: 64

### `process-definition` — 27 tests

- **Prerequisite to create**: deployed-process
- **Files**: `getProcessDefinition.feature.spec.ts`, `getProcessDefinitionInstanceStatistics.feature.spec.ts`, `getProcessDefinitionInstanceVersionStatistics.feature.spec.ts`, `getProcessDefinitionInstanceVersionStatistics.variant.spec.ts`, `getProcessDefinitionMessageSubscriptionStatistics.feature.spec.ts`, `getProcessDefinitionMessageSubscriptionStatistics.variant.spec.ts`, `getProcessDefinitionStatistics.feature.spec.ts`, `getProcessDefinitionStatistics.variant.spec.ts`, `getProcessDefinitionXML.feature.spec.ts`, `getStartProcessForm.feature.spec.ts`, `searchProcessDefinitions.feature.spec.ts`, `searchProcessDefinitions.variant.spec.ts`
- **Observation channel**: GET = 21, Search = 5
- **Form-step counts**: observe-present-get=21, observe-present-search=5, observe-absence=1
- **Variants**: happy-path=8, observe-absence=1, data-driven=18

| form step | variants | file:line | test name |
|--|--|--|--|
| observe-present-get | happy-path | `getProcessDefinition.feature.spec.ts:13` | feature-1 - getProcessDefinition - base (1) |
| observe-present-get | happy-path | `getProcessDefinitionInstanceStatistics.feature.spec.ts:11` | feature-1 - getProcessDefinitionInstanceStatistics - base (1) |
| observe-present-get | happy-path | `getProcessDefinitionInstanceVersionStatistics.feature.spec.ts:12` | feature-1 - getProcessDefinitionInstanceVersionStatistics - base (1) |
| observe-present-get | data-driven | `getProcessDefinitionInstanceVersionStatistics.variant.spec.ts:13` | variant-1 - getProcessDefinitionInstanceVersionStatistics - bpmn #1 |
| observe-present-get | happy-path | `getProcessDefinitionMessageSubscriptionStatistics.feature.spec.ts:11` | feature-1 - getProcessDefinitionMessageSubscriptionStatistics - base (1) |
| observe-present-get | data-driven | `getProcessDefinitionMessageSubscriptionStatistics.variant.spec.ts:13` | variant-1 - getProcessDefinitionMessageSubscriptionStatistics - path #1 |
| observe-present-get | data-driven | `getProcessDefinitionMessageSubscriptionStatistics.variant.spec.ts:71` | variant-2 - getProcessDefinitionMessageSubscriptionStatistics - path #1 |
| observe-present-get | data-driven | `getProcessDefinitionMessageSubscriptionStatistics.variant.spec.ts:132` | variant-3 - getProcessDefinitionMessageSubscriptionStatistics - bpmn #1 |
| observe-present-get | data-driven | `getProcessDefinitionMessageSubscriptionStatistics.variant.spec.ts:189` | variant-4 - getProcessDefinitionMessageSubscriptionStatistics - bpmn #1 |
| observe-present-get | data-driven | `getProcessDefinitionMessageSubscriptionStatistics.variant.spec.ts:267` | variant-5 - getProcessDefinitionMessageSubscriptionStatistics - bpmn #1 |
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
| observe-present-search | data-driven | `searchProcessDefinitions.variant.spec.ts:88` | variant-2 - searchProcessDefinitions - bpmn #1 |
| observe-present-search | data-driven | `searchProcessDefinitions.variant.spec.ts:140` | variant-3 - searchProcessDefinitions - path #1 |
| observe-present-search | data-driven | `searchProcessDefinitions.variant.spec.ts:215` | variant-4 - searchProcessDefinitions - path #1 |
| observe-absence | observe-absence | `searchProcessDefinitions.feature.spec.ts:59` | feature-2 - searchProcessDefinitions - negative empty (2) |

### `resource` — 15 tests

- **Prerequisite to create**: none
- **Files**: `createDeployment.feature.spec.ts`, `createDeployment.variant.spec.ts`, `deleteResource.feature.spec.ts`, `getResource.feature.spec.ts`, `getResourceContent.feature.spec.ts`, `searchResources.feature.spec.ts`, `searchResources.variant.spec.ts`
- **Observation channel**: GET = 2, Search = 6
- **Form-step counts**: create=5, observe-present-get=2, observe-present-search=6, delete=1, observe-absence=1
- **Variants**: happy-path=4, observe-absence=1, data-driven=10

| form step | variants | file:line | test name |
|--|--|--|--|
| create | data-driven | `createDeployment.feature.spec.ts:12` | feature-1 - createDeployment - bpmn (1) |
| create | data-driven | `createDeployment.feature.spec.ts:41` | feature-2 - createDeployment - form (2) |
| create | data-driven | `createDeployment.feature.spec.ts:69` | feature-3 - createDeployment - dmn (3) |
| create | data-driven | `createDeployment.feature.spec.ts:97` | feature-4 - createDeployment - drd (4) |
| create | data-driven | `createDeployment.variant.spec.ts:13` | variant-1 - createDeployment - bpmn #1 |
| observe-present-get | happy-path | `getResource.feature.spec.ts:12` | feature-1 - getResource - base (1) |
| observe-present-get | happy-path | `getResourceContent.feature.spec.ts:9` | feature-1 - getResourceContent - base (1) |
| observe-present-search | happy-path | `searchResources.feature.spec.ts:12` | feature-1 - searchResources - base (1) |
| observe-present-search | data-driven | `searchResources.variant.spec.ts:13` | variant-1 - searchResources - bpmn #1 |
| observe-present-search | data-driven | `searchResources.variant.spec.ts:62` | variant-2 - searchResources - path #1 |
| observe-present-search | data-driven | `searchResources.variant.spec.ts:130` | variant-3 - searchResources - path #1 |
| observe-present-search | data-driven | `searchResources.variant.spec.ts:181` | variant-4 - searchResources - path #1 |
| observe-present-search | data-driven | `searchResources.variant.spec.ts:232` | variant-5 - searchResources - path #1 |
| delete | happy-path | `deleteResource.feature.spec.ts:11` | feature-1 - deleteResource - base (1) |
| observe-absence | observe-absence | `searchResources.feature.spec.ts:35` | feature-2 - searchResources - negative empty (2) |

### `decision-definition` — 14 tests

- **Prerequisite to create**: deployed-decision
- **Files**: `evaluateDecision.feature.spec.ts`, `evaluateDecision.variant.spec.ts`, `getDecisionDefinition.feature.spec.ts`, `getDecisionDefinitionXML.feature.spec.ts`, `searchDecisionDefinitions.feature.spec.ts`, `searchDecisionDefinitions.variant.spec.ts`
- **Observation channel**: GET = 2, Search = 7
- **Form-step counts**: create=4, observe-present-get=2, observe-present-search=7, observe-absence=1
- **Variants**: happy-path=4, observe-absence=1, data-driven=9

| form step | variants | file:line | test name |
|--|--|--|--|
| create | happy-path | `evaluateDecision.feature.spec.ts:12` | feature-1 - evaluateDecision - base (1) |
| create | data-driven | `evaluateDecision.feature.spec.ts:60` | feature-2 - evaluateDecision - oneOf group0 Decision evaluation by ID (2) |
| create | data-driven | `evaluateDecision.feature.spec.ts:111` | feature-3 - evaluateDecision - oneOf group0 Decision evaluation by key (3) |
| create | data-driven | `evaluateDecision.variant.spec.ts:13` | variant-1 - evaluateDecision - dmn #1 |
| observe-present-get | happy-path | `getDecisionDefinition.feature.spec.ts:13` | feature-1 - getDecisionDefinition - base (1) |
| observe-present-get | happy-path | `getDecisionDefinitionXML.feature.spec.ts:10` | feature-1 - getDecisionDefinitionXML - base (1) |
| observe-present-search | happy-path | `searchDecisionDefinitions.feature.spec.ts:12` | feature-1 - searchDecisionDefinitions - base (1) |
| observe-present-search | data-driven | `searchDecisionDefinitions.variant.spec.ts:13` | variant-1 - searchDecisionDefinitions - dmn #1 |
| observe-present-search | data-driven | `searchDecisionDefinitions.variant.spec.ts:64` | variant-2 - searchDecisionDefinitions - path #1 |
| observe-present-search | data-driven | `searchDecisionDefinitions.variant.spec.ts:117` | variant-3 - searchDecisionDefinitions - dmn #1 |
| observe-present-search | data-driven | `searchDecisionDefinitions.variant.spec.ts:168` | variant-4 - searchDecisionDefinitions - drd #1 |
| observe-present-search | data-driven | `searchDecisionDefinitions.variant.spec.ts:219` | variant-5 - searchDecisionDefinitions - path #1 |
| observe-present-search | data-driven | `searchDecisionDefinitions.variant.spec.ts:272` | variant-6 - searchDecisionDefinitions - path #1 |
| observe-absence | observe-absence | `searchDecisionDefinitions.feature.spec.ts:37` | feature-2 - searchDecisionDefinitions - negative empty (2) |

### `decision-requirements` — 8 tests

- **Prerequisite to create**: deployed-drd
- **Files**: `getDecisionRequirements.feature.spec.ts`, `getDecisionRequirementsXML.feature.spec.ts`, `searchDecisionRequirements.feature.spec.ts`, `searchDecisionRequirements.variant.spec.ts`
- **Observation channel**: GET = 2, Search = 5
- **Form-step counts**: observe-present-get=2, observe-present-search=5, observe-absence=1
- **Variants**: happy-path=3, observe-absence=1, data-driven=4

| form step | variants | file:line | test name |
|--|--|--|--|
| observe-present-get | happy-path | `getDecisionRequirements.feature.spec.ts:13` | feature-1 - getDecisionRequirements - base (1) |
| observe-present-get | happy-path | `getDecisionRequirementsXML.feature.spec.ts:10` | feature-1 - getDecisionRequirementsXML - base (1) |
| observe-present-search | happy-path | `searchDecisionRequirements.feature.spec.ts:12` | feature-1 - searchDecisionRequirements - base (1) |
| observe-present-search | data-driven | `searchDecisionRequirements.variant.spec.ts:13` | variant-1 - searchDecisionRequirements - drd #1 |
| observe-present-search | data-driven | `searchDecisionRequirements.variant.spec.ts:64` | variant-2 - searchDecisionRequirements - path #1 |
| observe-present-search | data-driven | `searchDecisionRequirements.variant.spec.ts:117` | variant-3 - searchDecisionRequirements - path #1 |
| observe-present-search | data-driven | `searchDecisionRequirements.variant.spec.ts:170` | variant-4 - searchDecisionRequirements - path #1 |
| observe-absence | observe-absence | `searchDecisionRequirements.feature.spec.ts:37` | feature-2 - searchDecisionRequirements - negative empty (2) |

## D. Process-Instance Lifecycle & Ops

**Form**: Deploy process (prerequisite) → Create instance → Get/Search instance → Cancel/Migrate/Modify/Resolve-incident → Delete → Observe absence. Batch creators wrap N instances per call.

**Total tests**: 107

### `process-instance` — 107 tests

- **Prerequisite to create**: deployed-process
- **Files**: `cancelProcessInstance.feature.spec.ts`, `cancelProcessInstancesBatchOperation.feature.spec.ts`, `cancelProcessInstancesBatchOperation.variant.spec.ts`, `createProcessInstance.feature.spec.ts`, `createProcessInstance.variant.spec.ts`, `deleteProcessInstance.feature.spec.ts`, `deleteProcessInstancesBatchOperation.feature.spec.ts`, `deleteProcessInstancesBatchOperation.variant.spec.ts`, `getProcessInstance.feature.spec.ts`, `getProcessInstanceCallHierarchy.feature.spec.ts`, `getProcessInstanceSequenceFlows.feature.spec.ts`, `getProcessInstanceStatistics.feature.spec.ts`, `migrateProcessInstance.feature.spec.ts`, `migrateProcessInstance.variant.spec.ts`, `migrateProcessInstancesBatchOperation.feature.spec.ts`, `migrateProcessInstancesBatchOperation.variant.spec.ts`, `modifyProcessInstance.feature.spec.ts`, `modifyProcessInstance.variant.spec.ts`, `modifyProcessInstancesBatchOperation.feature.spec.ts`, `modifyProcessInstancesBatchOperation.variant.spec.ts`, `resolveIncidentsBatchOperation.feature.spec.ts`, `resolveIncidentsBatchOperation.variant.spec.ts`, `resolveProcessInstanceIncidents.feature.spec.ts`, `searchProcessInstanceIncidents.feature.spec.ts`, `searchProcessInstanceIncidents.variant.spec.ts`, `searchProcessInstances.feature.spec.ts`, `searchProcessInstances.variant.spec.ts`
- **Observation channel**: GET = 4, Search = 20
- **Form-step counts**: create=8, observe-present-get=4, observe-present-search=20, mutate=50, delete=24, observe-absence=1
- **Variants**: happy-path=17, observe-absence=1, data-driven=89

| form step | variants | file:line | test name |
|--|--|--|--|
| create | happy-path | `createProcessInstance.feature.spec.ts:12` | feature-1 - createProcessInstance - base (1) |
| create | data-driven | `createProcessInstance.feature.spec.ts:56` | feature-2 - createProcessInstance - oneOf group0 Process creation by key (2) |
| create | data-driven | `createProcessInstance.feature.spec.ts:103` | feature-3 - createProcessInstance - oneOf group0 Process creation by id (3) |
| create | data-driven | `createProcessInstance.variant.spec.ts:13` | variant-1 - createProcessInstance - bpmn #1 |
| create | data-driven | `createProcessInstance.variant.spec.ts:65` | variant-2 - createProcessInstance - bpmn #1 |
| create | data-driven | `createProcessInstance.variant.spec.ts:117` | variant-3 - createProcessInstance - bpmn #1 |
| create | data-driven | `createProcessInstance.variant.spec.ts:208` | variant-4 - createProcessInstance - bpmn #1 |
| create | data-driven | `createProcessInstance.variant.spec.ts:302` | variant-5 - createProcessInstance - bpmn #1 |
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
| observe-present-search | data-driven | `searchProcessInstanceIncidents.variant.spec.ts:511` | variant-6 - searchProcessInstanceIncidents - bpmn #1 |
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
| observe-present-search | data-driven | `searchProcessInstances.variant.spec.ts:982` | variant-12 - searchProcessInstances - path #1 |
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
| observe-absence | observe-absence | `searchProcessInstances.feature.spec.ts:79` | feature-2 - searchProcessInstances - negative empty (2) |

## E. Batch-Operation Lifecycle

**Form**: Create batch (via batch-creating process-instance APIs, prerequisite) → Get batch → Search batch → Search items → Suspend → Cancel

**Total tests**: 13

### `batch-operation` — 8 tests

- **Prerequisite to create**: running-process-instance(s)
- **Files**: `cancelBatchOperation.feature.spec.ts`, `getBatchOperation.feature.spec.ts`, `resumeBatchOperation.feature.spec.ts`, `searchBatchOperations.feature.spec.ts`, `searchBatchOperations.variant.spec.ts`, `suspendBatchOperation.feature.spec.ts`
- **Observation channel**: GET = 1, Search = 3
- **Form-step counts**: observe-present-get=1, observe-present-search=3, mutate=2, delete=1, observe-absence=1
- **Variants**: happy-path=5, observe-absence=1, data-driven=2

| form step | variants | file:line | test name |
|--|--|--|--|
| observe-present-get | happy-path | `getBatchOperation.feature.spec.ts:12` | feature-1 - getBatchOperation - base (1) |
| observe-present-search | happy-path | `searchBatchOperations.feature.spec.ts:12` | feature-1 - searchBatchOperations - base (1) |
| observe-present-search | data-driven | `searchBatchOperations.variant.spec.ts:12` | variant-1 - searchBatchOperations - path #1 |
| observe-present-search | data-driven | `searchBatchOperations.variant.spec.ts:65` | variant-2 - searchBatchOperations - path #1 |
| mutate | happy-path | `resumeBatchOperation.feature.spec.ts:8` | feature-1 - resumeBatchOperation - base (1) |
| mutate | happy-path | `suspendBatchOperation.feature.spec.ts:8` | feature-1 - suspendBatchOperation - base (1) |
| delete | happy-path | `cancelBatchOperation.feature.spec.ts:8` | feature-1 - cancelBatchOperation - base (1) |
| observe-absence | observe-absence | `searchBatchOperations.feature.spec.ts:37` | feature-2 - searchBatchOperations - negative empty (2) |

### `batch-operation-item` — 5 tests

- **Prerequisite to create**: running-batch-operation
- **Files**: `searchBatchOperationItems.feature.spec.ts`, `searchBatchOperationItems.variant.spec.ts`
- **Observation channel**: GET = 0, Search = 4
- **Form-step counts**: observe-present-search=4, observe-absence=1
- **Variants**: happy-path=1, observe-absence=1, data-driven=3

| form step | variants | file:line | test name |
|--|--|--|--|
| observe-present-search | happy-path | `searchBatchOperationItems.feature.spec.ts:12` | feature-1 - searchBatchOperationItems - base (1) |
| observe-present-search | data-driven | `searchBatchOperationItems.variant.spec.ts:13` | variant-1 - searchBatchOperationItems - bpmn #1 |
| observe-present-search | data-driven | `searchBatchOperationItems.variant.spec.ts:84` | variant-2 - searchBatchOperationItems - path #1 |
| observe-present-search | data-driven | `searchBatchOperationItems.variant.spec.ts:137` | variant-3 - searchBatchOperationItems - path #1 |
| observe-absence | observe-absence | `searchBatchOperationItems.feature.spec.ts:37` | feature-2 - searchBatchOperationItems - negative empty (2) |

## F. User-Task Lifecycle

**Form**: Deploy process w/ user task (prerequisite) → Create instance → Assign → Update → Search/Get → Get form → Search variables → Complete → Unassign

**Total tests**: 20

### `user-task` — 20 tests

- **Prerequisite to create**: running-process-instance-with-user-task
- **Files**: `assignUserTask.feature.spec.ts`, `completeUserTask.feature.spec.ts`, `getUserTask.feature.spec.ts`, `getUserTaskForm.feature.spec.ts`, `searchUserTaskAuditLogs.feature.spec.ts`, `searchUserTaskEffectiveVariables.feature.spec.ts`, `searchUserTaskVariables.feature.spec.ts`, `searchUserTasks.feature.spec.ts`, `searchUserTasks.variant.spec.ts`, `unassignUserTask.feature.spec.ts`, `updateUserTask.feature.spec.ts`
- **Observation channel**: GET = 2, Search = 13
- **Form-step counts**: observe-present-get=2, observe-present-search=13, mutate=3, delete=1, observe-absence=1
- **Variants**: happy-path=10, observe-absence=1, data-driven=9

| form step | variants | file:line | test name |
|--|--|--|--|
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
| observe-present-search | data-driven | `searchUserTasks.variant.spec.ts:603` | variant-9 - searchUserTasks - path #1 |
| mutate | happy-path | `assignUserTask.feature.spec.ts:8` | feature-1 - assignUserTask - base (1) |
| mutate | happy-path | `completeUserTask.feature.spec.ts:8` | feature-1 - completeUserTask - base (1) |
| mutate | happy-path | `updateUserTask.feature.spec.ts:8` | feature-1 - updateUserTask - base (1) |
| delete | happy-path | `unassignUserTask.feature.spec.ts:8` | feature-1 - unassignUserTask - base (1) |
| observe-absence | observe-absence | `searchUserTasks.feature.spec.ts:35` | feature-2 - searchUserTasks - negative empty (2) |

## G. Job Lifecycle & Stats

**Form**: Deploy process w/ job (prerequisite) → Activate → Complete / Fail / Error / Update → Search jobs → Aggregate (5 statistics endpoints)

**Total tests**: 27

### `job` — 27 tests

- **Prerequisite to create**: running-process-instance-with-job
- **Files**: `activateJobs.feature.spec.ts`, `activateJobs.variant.spec.ts`, `completeJob.feature.spec.ts`, `completeJob.variant.spec.ts`, `failJob.feature.spec.ts`, `getGlobalJobStatistics.feature.spec.ts`, `getJobErrorStatistics.feature.spec.ts`, `getJobErrorStatistics.variant.spec.ts`, `getJobTimeSeriesStatistics.feature.spec.ts`, `getJobTimeSeriesStatistics.variant.spec.ts`, `getJobTypeStatistics.feature.spec.ts`, `getJobTypeStatistics.variant.spec.ts`, `getJobWorkerStatistics.feature.spec.ts`, `getJobWorkerStatistics.variant.spec.ts`, `searchJobs.feature.spec.ts`, `searchJobs.variant.spec.ts`, `throwJobError.feature.spec.ts`, `updateJob.feature.spec.ts`
- **Observation channel**: GET = 9, Search = 7
- **Form-step counts**: create=3, observe-present-get=9, observe-present-search=7, mutate=6, observe-absence=2
- **Variants**: happy-path=11, observe-absence=2, data-driven=14

| form step | variants | file:line | test name |
|--|--|--|--|
| create | happy-path | `activateJobs.feature.spec.ts:12` | feature-1 - activateJobs - base (1) |
| create | data-driven | `activateJobs.variant.spec.ts:13` | variant-1 - activateJobs - bpmn #1 |
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
| observe-present-search | data-driven | `searchJobs.variant.spec.ts:461` | variant-6 - searchJobs - path #1 |
| mutate | happy-path | `completeJob.feature.spec.ts:9` | feature-1 - completeJob - base (1) |
| mutate | data-driven | `completeJob.feature.spec.ts:93` | feature-2 - completeJob - oneOf result variant1 (2) |
| mutate | data-driven | `completeJob.feature.spec.ts:178` | feature-3 - completeJob - oneOf result variant2 (3) |
| mutate | data-driven | `completeJob.variant.spec.ts:9` | variant-1 - completeJob - bpmn #1 |
| mutate | happy-path | `failJob.feature.spec.ts:9` | feature-1 - failJob - base (1) |
| mutate | happy-path | `updateJob.feature.spec.ts:9` | feature-1 - updateJob - base (1) |
| observe-absence | observe-absence | `activateJobs.feature.spec.ts:77` | feature-2 - activateJobs - negative empty (2) |
| observe-absence | observe-absence | `searchJobs.feature.spec.ts:79` | feature-2 - searchJobs - negative empty (2) |

## H. Incident Lifecycle

**Form**: Deploy process + failing job (prerequisite) → Incident raised → Get incident → Search → Resolve → Statistics (by definition / by error)

**Total tests**: 12

### `incident` — 12 tests

- **Prerequisite to create**: running-process-instance-with-failing-job
- **Files**: `getIncident.feature.spec.ts`, `getProcessInstanceStatisticsByDefinition.feature.spec.ts`, `getProcessInstanceStatisticsByError.feature.spec.ts`, `resolveIncident.feature.spec.ts`, `searchIncidents.feature.spec.ts`, `searchIncidents.variant.spec.ts`
- **Observation channel**: GET = 3, Search = 7
- **Form-step counts**: observe-present-get=3, observe-present-search=7, mutate=1, observe-absence=1
- **Variants**: happy-path=5, observe-absence=1, data-driven=6

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
| observe-present-search | data-driven | `searchIncidents.variant.spec.ts:389` | variant-6 - searchIncidents - path #1 |
| mutate | happy-path | `resolveIncident.feature.spec.ts:8` | feature-1 - resolveIncident - base (1) |
| observe-absence | observe-absence | `searchIncidents.feature.spec.ts:35` | feature-2 - searchIncidents - negative empty (2) |

## I. Decision-Instance Lifecycle

**Form**: Deploy DRD/DMN (prerequisite) → Evaluate → Get instance → Search → Delete (single + batch) → Search (Observe Absence)

**Total tests**: 27

### `decision-instance` — 27 tests

- **Prerequisite to create**: deployed-decision
- **Files**: `deleteDecisionInstance.feature.spec.ts`, `deleteDecisionInstancesBatchOperation.feature.spec.ts`, `deleteDecisionInstancesBatchOperation.variant.spec.ts`, `getDecisionInstance.feature.spec.ts`, `searchDecisionInstances.feature.spec.ts`, `searchDecisionInstances.variant.spec.ts`
- **Observation channel**: GET = 1, Search = 13
- **Form-step counts**: observe-present-get=1, observe-present-search=13, delete=12, observe-absence=1
- **Variants**: happy-path=4, observe-absence=1, data-driven=21, unlabeled=1

| form step | variants | file:line | test name |
|--|--|--|--|
| observe-present-get | happy-path | `getDecisionInstance.feature.spec.ts:13` | feature-1 - getDecisionInstance - base (1) |
| observe-present-search | happy-path | `searchDecisionInstances.feature.spec.ts:12` | feature-1 - searchDecisionInstances - base (1) |
| observe-present-search | data-driven | `searchDecisionInstances.variant.spec.ts:13` | variant-1 - searchDecisionInstances - dmn #1 |
| observe-present-search | data-driven | `searchDecisionInstances.variant.spec.ts:92` | variant-2 - searchDecisionInstances - dmn #1 |
| observe-present-search | data-driven | `searchDecisionInstances.variant.spec.ts:143` | variant-3 - searchDecisionInstances - path #1 |
| observe-present-search | data-driven | `searchDecisionInstances.variant.spec.ts:196` | variant-4 - searchDecisionInstances - dmn #1 |
| observe-present-search | data-driven | `searchDecisionInstances.variant.spec.ts:275` | variant-5 - searchDecisionInstances - bpmn #1 |
| observe-present-search | data-driven | `searchDecisionInstances.variant.spec.ts:327` | variant-6 - searchDecisionInstances - bpmn #1 |
| observe-present-search | data-driven | `searchDecisionInstances.variant.spec.ts:400` | variant-7 - searchDecisionInstances - dmn #1 |
| observe-present-search | data-driven | `searchDecisionInstances.variant.spec.ts:451` | variant-8 - searchDecisionInstances - bpmn #1 |
| observe-present-search | data-driven | `searchDecisionInstances.variant.spec.ts:553` | variant-9 - searchDecisionInstances - dmn #1 |
| observe-present-search | data-driven | `searchDecisionInstances.variant.spec.ts:604` | variant-10 - searchDecisionInstances - drd #1 |
| observe-present-search | data-driven | `searchDecisionInstances.variant.spec.ts:655` | variant-11 - searchDecisionInstances - path #1 |
| observe-present-search | data-driven | `searchDecisionInstances.variant.spec.ts:708` | variant-12 - searchDecisionInstances - path #1 |
| delete | happy-path | `deleteDecisionInstance.feature.spec.ts:9` | feature-1 - deleteDecisionInstance - base (1) |
| delete | happy-path | `deleteDecisionInstancesBatchOperation.feature.spec.ts:11` | feature-1 - deleteDecisionInstancesBatchOperation - base (1) |
| delete | data-driven | `deleteDecisionInstancesBatchOperation.variant.spec.ts:12` | variant-1 - deleteDecisionInstancesBatchOperation - dmn #1 |
| delete | data-driven | `deleteDecisionInstancesBatchOperation.variant.spec.ts:90` | variant-2 - deleteDecisionInstancesBatchOperation - dmn #1 |
| delete | unlabeled | `deleteDecisionInstancesBatchOperation.variant.spec.ts:140` | variant-3 - scenario |
| delete | data-driven | `deleteDecisionInstancesBatchOperation.variant.spec.ts:170` | variant-4 - deleteDecisionInstancesBatchOperation - dmn #1 |
| delete | data-driven | `deleteDecisionInstancesBatchOperation.variant.spec.ts:248` | variant-5 - deleteDecisionInstancesBatchOperation - bpmn #1 |
| delete | data-driven | `deleteDecisionInstancesBatchOperation.variant.spec.ts:300` | variant-6 - deleteDecisionInstancesBatchOperation - bpmn #1 |
| delete | data-driven | `deleteDecisionInstancesBatchOperation.variant.spec.ts:372` | variant-7 - deleteDecisionInstancesBatchOperation - dmn #1 |
| delete | data-driven | `deleteDecisionInstancesBatchOperation.variant.spec.ts:422` | variant-8 - deleteDecisionInstancesBatchOperation - bpmn #1 |
| delete | data-driven | `deleteDecisionInstancesBatchOperation.variant.spec.ts:523` | variant-9 - deleteDecisionInstancesBatchOperation - dmn #1 |
| delete | data-driven | `deleteDecisionInstancesBatchOperation.variant.spec.ts:573` | variant-10 - deleteDecisionInstancesBatchOperation - drd #1 |
| observe-absence | observe-absence | `searchDecisionInstances.feature.spec.ts:37` | feature-2 - searchDecisionInstances - negative empty (2) |

## J/K/L. Observation-only

**Form**: Perform an action elsewhere (prerequisite) → Get / Search to observe

**Total tests**: 52

### `element-instance` — 25 tests

- **Prerequisite to create**: running-process-instance
- **Files**: `activateAdHocSubProcessActivities.feature.spec.ts`, `activateAdHocSubProcessActivities.variant.spec.ts`, `createElementInstanceVariables.feature.spec.ts`, `getElementInstance.feature.spec.ts`, `searchElementInstanceIncidents.feature.spec.ts`, `searchElementInstanceIncidents.variant.spec.ts`, `searchElementInstances.feature.spec.ts`, `searchElementInstances.variant.spec.ts`
- **Observation channel**: GET = 1, Search = 20
- **Form-step counts**: create=3, observe-present-get=1, observe-present-search=20, observe-absence=1
- **Variants**: happy-path=5, observe-absence=1, data-driven=19

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
| observe-present-search | data-driven | `searchElementInstanceIncidents.variant.spec.ts:583` | variant-6 - searchElementInstanceIncidents - bpmn #1 |
| observe-present-search | happy-path | `searchElementInstances.feature.spec.ts:12` | feature-1 - searchElementInstances - base (1) |
| observe-present-search | data-driven | `searchElementInstances.feature.spec.ts:63` | feature-3 - searchElementInstances - oneOf filter.elementInstanceScopeKey variant1 (3) |
| observe-present-search | data-driven | `searchElementInstances.feature.spec.ts:91` | feature-4 - searchElementInstances - oneOf filter.elementInstanceScopeKey variant2 (4) |
| observe-present-search | data-driven | `searchElementInstances.variant.spec.ts:13` | variant-1 - searchElementInstances - bpmn #1 |
| observe-present-search | data-driven | `searchElementInstances.variant.spec.ts:63` | variant-2 - searchElementInstances - bpmn #1 |
| observe-present-search | data-driven | `searchElementInstances.variant.spec.ts:162` | variant-3 - searchElementInstances - path #1 |
| observe-present-search | data-driven | `searchElementInstances.variant.spec.ts:215` | variant-4 - searchElementInstances - bpmn #1 |
| observe-present-search | data-driven | `searchElementInstances.variant.spec.ts:314` | variant-5 - searchElementInstances - bpmn #1 |
| observe-present-search | data-driven | `searchElementInstances.variant.spec.ts:384` | variant-6 - searchElementInstances - bpmn #1 |
| observe-present-search | data-driven | `searchElementInstances.variant.spec.ts:434` | variant-7 - searchElementInstances - bpmn #1 |
| observe-present-search | data-driven | `searchElementInstances.variant.spec.ts:595` | variant-8 - searchElementInstances - bpmn #1 |
| observe-present-search | data-driven | `searchElementInstances.variant.spec.ts:694` | variant-9 - searchElementInstances - path #1 |
| observe-present-search | data-driven | `searchElementInstances.variant.spec.ts:747` | variant-10 - searchElementInstances - path #1 |
| observe-absence | observe-absence | `searchElementInstances.feature.spec.ts:37` | feature-2 - searchElementInstances - negative empty (2) |

### `audit-log` — 18 tests

- **Prerequisite to create**: any-prior-action
- **Files**: `getAuditLog.feature.spec.ts`, `searchAuditLogs.feature.spec.ts`, `searchAuditLogs.variant.spec.ts`
- **Observation channel**: GET = 1, Search = 16
- **Form-step counts**: observe-present-get=1, observe-present-search=16, observe-absence=1
- **Variants**: happy-path=2, observe-absence=1, data-driven=11, unlabeled=4

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
| observe-present-search | data-driven | `searchAuditLogs.variant.spec.ts:776` | variant-15 - searchAuditLogs - path #1 |
| observe-absence | observe-absence | `searchAuditLogs.feature.spec.ts:35` | feature-2 - searchAuditLogs - negative empty (2) |

### `variable` — 9 tests

- **Prerequisite to create**: running-process-instance
- **Files**: `getVariable.feature.spec.ts`, `searchVariables.feature.spec.ts`, `searchVariables.variant.spec.ts`
- **Observation channel**: GET = 1, Search = 7
- **Form-step counts**: observe-present-get=1, observe-present-search=7, observe-absence=1
- **Variants**: happy-path=2, observe-absence=1, data-driven=4, unlabeled=2

| form step | variants | file:line | test name |
|--|--|--|--|
| observe-present-get | happy-path | `getVariable.feature.spec.ts:12` | feature-1 - getVariable - base (1) |
| observe-present-search | happy-path | `searchVariables.feature.spec.ts:12` | feature-1 - searchVariables - base (1) |
| observe-present-search | data-driven | `searchVariables.variant.spec.ts:13` | variant-1 - searchVariables - path #1 |
| observe-present-search | unlabeled | `searchVariables.variant.spec.ts:64` | variant-2 - scenario |
| observe-present-search | unlabeled | `searchVariables.variant.spec.ts:93` | variant-3 - scenario |
| observe-present-search | data-driven | `searchVariables.variant.spec.ts:122` | variant-4 - searchVariables - bpmn #1 |
| observe-present-search | data-driven | `searchVariables.variant.spec.ts:191` | variant-5 - searchVariables - path #1 |
| observe-present-search | data-driven | `searchVariables.variant.spec.ts:242` | variant-6 - searchVariables - path #1 |
| observe-absence | observe-absence | `searchVariables.feature.spec.ts:35` | feature-2 - searchVariables - negative empty (2) |

## M. Messaging/Signals

**Form**: Deploy process with catch event (prerequisite) → Publish/Correlate/Broadcast → Search subscriptions / correlated messages

**Total tests**: 22

### `correlated-message-subscription` — 8 tests

- **Prerequisite to create**: deployed-process-with-message-catch-event + correlated-message
- **Files**: `searchCorrelatedMessageSubscriptions.feature.spec.ts`, `searchCorrelatedMessageSubscriptions.variant.spec.ts`
- **Observation channel**: GET = 0, Search = 7
- **Form-step counts**: observe-present-search=7, observe-absence=1
- **Variants**: happy-path=1, observe-absence=1, data-driven=6

| form step | variants | file:line | test name |
|--|--|--|--|
| observe-present-search | happy-path | `searchCorrelatedMessageSubscriptions.feature.spec.ts:12` | feature-1 - searchCorrelatedMessageSubscriptions - base (1) |
| observe-present-search | data-driven | `searchCorrelatedMessageSubscriptions.variant.spec.ts:13` | variant-1 - searchCorrelatedMessageSubscriptions - bpmn #1 |
| observe-present-search | data-driven | `searchCorrelatedMessageSubscriptions.variant.spec.ts:117` | variant-2 - searchCorrelatedMessageSubscriptions - bpmn #1 |
| observe-present-search | data-driven | `searchCorrelatedMessageSubscriptions.variant.spec.ts:170` | variant-3 - searchCorrelatedMessageSubscriptions - bpmn #1 |
| observe-present-search | data-driven | `searchCorrelatedMessageSubscriptions.variant.spec.ts:244` | variant-4 - searchCorrelatedMessageSubscriptions - path #1 |
| observe-present-search | data-driven | `searchCorrelatedMessageSubscriptions.variant.spec.ts:305` | variant-5 - searchCorrelatedMessageSubscriptions - path #1 |
| observe-present-search | data-driven | `searchCorrelatedMessageSubscriptions.variant.spec.ts:359` | variant-6 - searchCorrelatedMessageSubscriptions - path #1 |
| observe-absence | observe-absence | `searchCorrelatedMessageSubscriptions.feature.spec.ts:38` | feature-2 - searchCorrelatedMessageSubscriptions - negative empty (2) |

### `message-subscriptions` — 8 tests

- **Prerequisite to create**: deployed-process-with-message-catch-event
- **Files**: `searchMessageSubscriptions.feature.spec.ts`, `searchMessageSubscriptions.variant.spec.ts`
- **Observation channel**: GET = 0, Search = 7
- **Form-step counts**: observe-present-search=7, observe-absence=1
- **Variants**: happy-path=1, observe-absence=1, data-driven=6

| form step | variants | file:line | test name |
|--|--|--|--|
| observe-present-search | happy-path | `searchMessageSubscriptions.feature.spec.ts:12` | feature-1 - searchMessageSubscriptions - base (1) |
| observe-present-search | data-driven | `searchMessageSubscriptions.variant.spec.ts:13` | variant-1 - searchMessageSubscriptions - path #1 |
| observe-present-search | data-driven | `searchMessageSubscriptions.variant.spec.ts:69` | variant-2 - searchMessageSubscriptions - bpmn #1 |
| observe-present-search | data-driven | `searchMessageSubscriptions.variant.spec.ts:121` | variant-3 - searchMessageSubscriptions - bpmn #1 |
| observe-present-search | data-driven | `searchMessageSubscriptions.variant.spec.ts:195` | variant-4 - searchMessageSubscriptions - bpmn #1 |
| observe-present-search | data-driven | `searchMessageSubscriptions.variant.spec.ts:298` | variant-5 - searchMessageSubscriptions - path #1 |
| observe-present-search | data-driven | `searchMessageSubscriptions.variant.spec.ts:351` | variant-6 - searchMessageSubscriptions - path #1 |
| observe-absence | observe-absence | `searchMessageSubscriptions.feature.spec.ts:37` | feature-2 - searchMessageSubscriptions - negative empty (2) |

### `message` — 4 tests

- **Prerequisite to create**: deployed-process-with-message-catch-event
- **Files**: `correlateMessage.feature.spec.ts`, `correlateMessage.variant.spec.ts`, `publishMessage.feature.spec.ts`, `publishMessage.variant.spec.ts`
- **Observation channel**: GET = 0, Search = 0
- **Form-step counts**: create=4
- **Variants**: happy-path=2, unlabeled=2

| form step | variants | file:line | test name |
|--|--|--|--|
| create | happy-path | `correlateMessage.feature.spec.ts:11` | feature-1 - correlateMessage - base (1) |
| create | unlabeled | `correlateMessage.variant.spec.ts:11` | variant-1 - scenario |
| create | happy-path | `publishMessage.feature.spec.ts:11` | feature-1 - publishMessage - base (1) |
| create | unlabeled | `publishMessage.variant.spec.ts:11` | variant-1 - scenario |

### `signal` — 2 tests

- **Prerequisite to create**: deployed-process-with-signal-catch-event
- **Files**: `broadcastSignal.feature.spec.ts`, `broadcastSignal.variant.spec.ts`
- **Observation channel**: GET = 0, Search = 0
- **Form-step counts**: create=2
- **Variants**: happy-path=1, unlabeled=1

| form step | variants | file:line | test name |
|--|--|--|--|
| create | happy-path | `broadcastSignal.feature.spec.ts:11` | feature-1 - broadcastSignal - base (1) |
| create | unlabeled | `broadcastSignal.variant.spec.ts:11` | variant-1 - scenario |

## N. Engine Evaluation

**Form**: Submit expression / conditional → Receive result (stateless, no entity persisted)

**Total tests**: 4

### `conditional` — 3 tests

- **Prerequisite to create**: none
- **Files**: `evaluateConditionals.feature.spec.ts`, `evaluateConditionals.variant.spec.ts`
- **Observation channel**: GET = 0, Search = 0
- **Form-step counts**: create=3
- **Variants**: happy-path=1, data-driven=1, unlabeled=1

| form step | variants | file:line | test name |
|--|--|--|--|
| create | happy-path | `evaluateConditionals.feature.spec.ts:11` | feature-1 - evaluateConditionals - base (1) |
| create | unlabeled | `evaluateConditionals.variant.spec.ts:12` | variant-1 - scenario |
| create | data-driven | `evaluateConditionals.variant.spec.ts:40` | variant-2 - evaluateConditionals - bpmn #1 |

### `expression` — 1 tests

- **Prerequisite to create**: none
- **Files**: `evaluateExpression.feature.spec.ts`
- **Observation channel**: GET = 0, Search = 0
- **Form-step counts**: create=1
- **Variants**: happy-path=1

| form step | variants | file:line | test name |
|--|--|--|--|
| create | happy-path | `evaluateExpression.feature.spec.ts:11` | feature-1 - evaluateExpression - base (1) |

## O. System/Admin

**Form**: Read system state (auth, license, cluster, clock, metrics) or perform admin action (pin/reset clock)

**Total tests**: 9

### `system` — 2 tests

- **Prerequisite to create**: none
- **Files**: `getSystemConfiguration.feature.spec.ts`, `getUsageMetrics.feature.spec.ts`
- **Observation channel**: GET = 2, Search = 0
- **Form-step counts**: observe-present-get=2
- **Variants**: happy-path=2

| form step | variants | file:line | test name |
|--|--|--|--|
| observe-present-get | happy-path | `getSystemConfiguration.feature.spec.ts:11` | feature-1 - getSystemConfiguration - base (1) |
| observe-present-get | happy-path | `getUsageMetrics.feature.spec.ts:12` | feature-1 - getUsageMetrics - base (1) |

### `clock` — 2 tests

- **Prerequisite to create**: none
- **Files**: `pinClock.feature.spec.ts`, `resetClock.feature.spec.ts`
- **Observation channel**: GET = 0, Search = 0
- **Form-step counts**: create=1, delete=1
- **Variants**: happy-path=2

| form step | variants | file:line | test name |
|--|--|--|--|
| create | happy-path | `pinClock.feature.spec.ts:8` | feature-1 - pinClock - base (1) |
| delete | happy-path | `resetClock.feature.spec.ts:8` | feature-1 - resetClock - base (1) |

### `setup` — 1 tests

- **Prerequisite to create**: none
- **Files**: `createAdminUser.feature.spec.ts`
- **Observation channel**: GET = 0, Search = 0
- **Form-step counts**: create=1
- **Variants**: happy-path=1

| form step | variants | file:line | test name |
|--|--|--|--|
| create | happy-path | `createAdminUser.feature.spec.ts:11` | feature-1 - createAdminUser - base (1) |

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

**Total tests**: 9

### `agent-instance` — 9 tests

- **Prerequisite to create**: unknown
- **Files**: `getAgentInstance.feature.spec.ts`, `searchAgentInstances.feature.spec.ts`, `searchAgentInstances.variant.spec.ts`
- **Observation channel**: GET = 1, Search = 7
- **Form-step counts**: observe-present-get=1, observe-present-search=7, observe-absence=1
- **Variants**: happy-path=2, observe-absence=1, data-driven=5, unlabeled=1

| form step | variants | file:line | test name |
|--|--|--|--|
| observe-present-get | happy-path | `getAgentInstance.feature.spec.ts:12` | feature-1 - getAgentInstance - base (1) |
| observe-present-search | happy-path | `searchAgentInstances.feature.spec.ts:12` | feature-1 - searchAgentInstances - base (1) |
| observe-present-search | unlabeled | `searchAgentInstances.variant.spec.ts:13` | variant-1 - scenario |
| observe-present-search | data-driven | `searchAgentInstances.variant.spec.ts:44` | variant-2 - searchAgentInstances - bpmn #1 |
| observe-present-search | data-driven | `searchAgentInstances.variant.spec.ts:145` | variant-3 - searchAgentInstances - bpmn #1 |
| observe-present-search | data-driven | `searchAgentInstances.variant.spec.ts:218` | variant-4 - searchAgentInstances - bpmn #1 |
| observe-present-search | data-driven | `searchAgentInstances.variant.spec.ts:270` | variant-5 - searchAgentInstances - path #1 |
| observe-present-search | data-driven | `searchAgentInstances.variant.spec.ts:334` | variant-6 - searchAgentInstances - path #1 |
| observe-absence | observe-absence | `searchAgentInstances.feature.spec.ts:37` | feature-2 - searchAgentInstances - negative empty (2) |

