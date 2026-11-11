# Needs-ABox gap report

Plan items the analyzer cannot decide without domain knowledge. Grouped by the missing ABox fact.

## Summary — plan-item kinds that need ABox

| kind | items |
|---|---:|
| 403-forbidden | 190 |
| 401-unauthorized | 189 |
| prerequisite-resource | 120 |
| 409-conflict | 59 |
| pagination-sort:behaviour-assertion | 57 |
| filter:behaviour-assertion | 49 |
| eventual-consistency | 43 |
| scale-large-n | 43 |
| business-entity-lifecycle | 40 |

## Grouped by missing ABox fact

### `RBAC: permissions required per endpoint` — 190 plan items

**Plan-item kinds**: 403-forbidden=190

**Sample operations** (up to 8):

- `DELETE /authorizations/{authorizationKey}` (`deleteAuthorization`)
- `DELETE /cluster-variables/global/{name}` (`deleteGlobalClusterVariable`)
- `DELETE /cluster-variables/tenants/{tenantId}/{name}` (`deleteTenantClusterVariable`)
- `DELETE /documents/{documentId}` (`deleteDocument`)
- `DELETE /global-task-listeners/{id}` (`deleteGlobalTaskListener`)
- `DELETE /groups/{groupId}` (`deleteGroup`)
- `DELETE /groups/{groupId}/clients/{clientId}` (`unassignClientFromGroup`)
- `DELETE /groups/{groupId}/mapping-rules/{mappingRuleId}` (`unassignMappingRuleFromGroup`)
- … and 182 more

### `spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec)` — 189 plan items

**Plan-item kinds**: 401-unauthorized=189

**Sample operations** (up to 8):

- `DELETE /authorizations/{authorizationKey}` (`deleteAuthorization`)
- `DELETE /cluster-variables/global/{name}` (`deleteGlobalClusterVariable`)
- `DELETE /cluster-variables/tenants/{tenantId}/{name}` (`deleteTenantClusterVariable`)
- `DELETE /documents/{documentId}` (`deleteDocument`)
- `DELETE /global-task-listeners/{id}` (`deleteGlobalTaskListener`)
- `DELETE /groups/{groupId}` (`deleteGroup`)
- `DELETE /groups/{groupId}/clients/{clientId}` (`unassignClientFromGroup`)
- `DELETE /groups/{groupId}/mapping-rules/{mappingRuleId}` (`unassignMappingRuleFromGroup`)
- … and 181 more

### `creation chain per identifier semantic-type` — 120 plan items

**Plan-item kinds**: prerequisite-resource=120

**Sample operations** (up to 8):

- `DELETE /authorizations/{authorizationKey}` (`deleteAuthorization`)
- `DELETE /cluster-variables/global/{name}` (`deleteGlobalClusterVariable`)
- `DELETE /cluster-variables/tenants/{tenantId}/{name}` (`deleteTenantClusterVariable`)
- `DELETE /documents/{documentId}` (`deleteDocument`)
- `DELETE /global-task-listeners/{id}` (`deleteGlobalTaskListener`)
- `DELETE /groups/{groupId}` (`deleteGroup`)
- `DELETE /groups/{groupId}/clients/{clientId}` (`unassignClientFromGroup`)
- `DELETE /groups/{groupId}/mapping-rules/{mappingRuleId}` (`unassignMappingRuleFromGroup`)
- … and 112 more

### `filter-field-semantics + sort-field-allowlist per entity` — 106 plan items

**Plan-item kinds**: pagination-sort:behaviour-assertion=57, filter:behaviour-assertion=49

**Sample operations** (up to 8):

- `POST /agent-instances/search` (`searchAgentInstances`)
- `POST /audit-logs/search` (`searchAuditLogs`)
- `POST /authorizations/search` (`searchAuthorizations`)
- `POST /batch-operation-items/search` (`searchBatchOperationItems`)
- `POST /batch-operations/search` (`searchBatchOperations`)
- `POST /cluster-variables/search` (`searchClusterVariables`)
- `POST /correlated-message-subscriptions/search` (`searchCorrelatedMessageSubscriptions`)
- `POST /decision-definitions/search` (`searchDecisionDefinitions`)
- … and 51 more

### `duplicatePolicy per endpoint (idempotent | conflict | replace)` — 59 plan items

**Plan-item kinds**: 409-conflict=59

**Sample operations** (up to 8):

- `POST /agent-instances` (`createAgentInstance`)
- `POST /authorizations` (`createAuthorization`)
- `POST /clock/reset` (`resetClock`)
- `POST /cluster-variables/global` (`createGlobalClusterVariable`)
- `POST /conditionals/evaluation` (`evaluateConditionals`)
- `POST /decision-definitions/evaluation` (`evaluateDecision`)
- `POST /decision-instances/deletion` (`deleteDecisionInstancesBatchOperation`)
- `POST /deployments` (`createDeployment`)
- … and 51 more

### `consistency window per entity (or eventually-consistent flag)` — 43 plan items

**Plan-item kinds**: eventual-consistency=43

**Sample operations** (up to 8):

- `POST /agent-instances/search` (`searchAgentInstances`)
- `POST /audit-logs/search` (`searchAuditLogs`)
- `POST /authorizations/search` (`searchAuthorizations`)
- `POST /batch-operation-items/search` (`searchBatchOperationItems`)
- `POST /batch-operations/search` (`searchBatchOperations`)
- `POST /cluster-variables/search` (`searchClusterVariables`)
- `POST /correlated-message-subscriptions/search` (`searchCorrelatedMessageSubscriptions`)
- `POST /decision-definitions/search` (`searchDecisionDefinitions`)
- … and 35 more

### `scale thresholds + expected response time per entity` — 43 plan items

**Plan-item kinds**: scale-large-n=43

**Sample operations** (up to 8):

- `POST /agent-instances/search` (`searchAgentInstances`)
- `POST /audit-logs/search` (`searchAuditLogs`)
- `POST /authorizations/search` (`searchAuthorizations`)
- `POST /batch-operation-items/search` (`searchBatchOperationItems`)
- `POST /batch-operations/search` (`searchBatchOperations`)
- `POST /cluster-variables/search` (`searchClusterVariables`)
- `POST /correlated-message-subscriptions/search` (`searchCorrelatedMessageSubscriptions`)
- `POST /decision-definitions/search` (`searchDecisionDefinitions`)
- … and 35 more

### `lifecycle state machine for this entity` — 40 plan items

**Plan-item kinds**: business-entity-lifecycle=40

**Sample operations** (up to 8):

- `DELETE /groups/{groupId}/clients/{clientId}` (`unassignClientFromGroup`)
- `DELETE /groups/{groupId}/mapping-rules/{mappingRuleId}` (`unassignMappingRuleFromGroup`)
- `DELETE /groups/{groupId}/users/{username}` (`unassignUserFromGroup`)
- `DELETE /roles/{roleId}/clients/{clientId}` (`unassignRoleFromClient`)
- `DELETE /roles/{roleId}/groups/{groupId}` (`unassignRoleFromGroup`)
- `DELETE /roles/{roleId}/mapping-rules/{mappingRuleId}` (`unassignRoleFromMappingRule`)
- `DELETE /roles/{roleId}/users/{username}` (`unassignRoleFromUser`)
- `DELETE /tenants/{tenantId}/clients/{clientId}` (`unassignClientFromTenant`)
- … and 32 more

