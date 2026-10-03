# Spec-derived test plan

Total operations: **190**. Total plan items: **1817**.

- Computable from spec alone: **1027**
- Needs ABox / domain knowledge: **790**

## Per-operation plan

### `POST /element-instances/ad-hoc-activities/{adHocSubProcessInstanceKey}/activation` — `activateAdHocSubProcessActivities` (11 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=adHocSubProcessInstanceKey, type=string, format=ElementInstanceKey | ✓ | — |
| bad-request:missing-required | field=elements | ✓ | — |
| bad-request:type-mismatch | field=elements, type=array | ✓ | — |
| bad-request:type-mismatch | field=cancelRemainingInstances, type=boolean | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| documented-503 | response code 503 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| business-entity-lifecycle | path has state-transition verb |  | lifecycle state machine for this entity |
| prerequisite-resource | 1 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |

### `POST /jobs/activation` — `activateJobs` (21 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| bad-request:additional-property | closed schema | ✓ | — |
| bad-request:format-invalid | field=timeout, format=int64 | ✓ | — |
| bad-request:format-invalid | field=maxJobsToActivate, format=int32 | ✓ | — |
| bad-request:format-invalid | field=requestTimeout, format=int64 | ✓ | — |
| bad-request:missing-required | field=type | ✓ | — |
| bad-request:missing-required | field=maxJobsToActivate | ✓ | — |
| bad-request:missing-required | field=timeout | ✓ | — |
| bad-request:type-mismatch | field=type, type=string | ✓ | — |
| bad-request:type-mismatch | field=worker, type=string | ✓ | — |
| bad-request:type-mismatch | field=timeout, type=integer | ✓ | — |
| bad-request:type-mismatch | field=maxJobsToActivate, type=integer | ✓ | — |
| bad-request:type-mismatch | field=fetchVariable, type=array | ✓ | — |
| bad-request:type-mismatch | field=requestTimeout, type=integer | ✓ | — |
| bad-request:type-mismatch | field=tenantIds, type=array | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| documented-503 | response code 503 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 not documented; emitter needs to know if RBAC applies |  | RBAC: permissions required per endpoint |
| 409-conflict | create-or-replace with same identifier |  | duplicatePolicy per endpoint (idempotent \| conflict \| replace) |
| business-entity-lifecycle | path has state-transition verb |  | lifecycle state machine for this entity |

### `PUT /groups/{groupId}/clients/{clientId}` — `assignClientToGroup` (9 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=groupId, type=string, format=GroupId | ✓ | — |
| 404-not-found | path param=clientId, type=string, format=ClientId | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| documented-503 | response code 503 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| 409-conflict | create-or-replace with same identifier |  | duplicatePolicy per endpoint (idempotent \| conflict \| replace) |
| prerequisite-resource | 2 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |

### `PUT /tenants/{tenantId}/clients/{clientId}` — `assignClientToTenant` (9 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=tenantId, type=string, format=TenantId | ✓ | — |
| 404-not-found | path param=clientId, type=string, format=ClientId | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| documented-503 | response code 503 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| 409-conflict | create-or-replace with same identifier |  | duplicatePolicy per endpoint (idempotent \| conflict \| replace) |
| prerequisite-resource | 2 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |

### `PUT /tenants/{tenantId}/groups/{groupId}` — `assignGroupToTenant` (9 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=tenantId, type=string, format=TenantId | ✓ | — |
| 404-not-found | path param=groupId, type=string, format=GroupId | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| documented-503 | response code 503 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| 409-conflict | create-or-replace with same identifier |  | duplicatePolicy per endpoint (idempotent \| conflict \| replace) |
| prerequisite-resource | 2 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |

### `PUT /groups/{groupId}/mapping-rules/{mappingRuleId}` — `assignMappingRuleToGroup` (9 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=groupId, type=string, format=GroupId | ✓ | — |
| 404-not-found | path param=mappingRuleId, type=string, format=MappingRuleId | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| documented-503 | response code 503 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| 409-conflict | create-or-replace with same identifier |  | duplicatePolicy per endpoint (idempotent \| conflict \| replace) |
| prerequisite-resource | 2 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |

### `PUT /tenants/{tenantId}/mapping-rules/{mappingRuleId}` — `assignMappingRuleToTenant` (9 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=tenantId, type=string, format=TenantId | ✓ | — |
| 404-not-found | path param=mappingRuleId, type=string, format=MappingRuleId | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| documented-503 | response code 503 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| 409-conflict | create-or-replace with same identifier |  | duplicatePolicy per endpoint (idempotent \| conflict \| replace) |
| prerequisite-resource | 2 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |

### `PUT /roles/{roleId}/clients/{clientId}` — `assignRoleToClient` (9 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=roleId, type=string, format=RoleId | ✓ | — |
| 404-not-found | path param=clientId, type=string, format=ClientId | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| documented-503 | response code 503 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| 409-conflict | create-or-replace with same identifier |  | duplicatePolicy per endpoint (idempotent \| conflict \| replace) |
| prerequisite-resource | 2 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |

### `PUT /roles/{roleId}/groups/{groupId}` — `assignRoleToGroup` (9 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=roleId, type=string, format=RoleId | ✓ | — |
| 404-not-found | path param=groupId, type=string, format=GroupId | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| documented-503 | response code 503 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| 409-conflict | create-or-replace with same identifier |  | duplicatePolicy per endpoint (idempotent \| conflict \| replace) |
| prerequisite-resource | 2 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |

### `PUT /roles/{roleId}/mapping-rules/{mappingRuleId}` — `assignRoleToMappingRule` (9 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=roleId, type=string, format=RoleId | ✓ | — |
| 404-not-found | path param=mappingRuleId, type=string, format=MappingRuleId | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| documented-503 | response code 503 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| 409-conflict | create-or-replace with same identifier |  | duplicatePolicy per endpoint (idempotent \| conflict \| replace) |
| prerequisite-resource | 2 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |

### `PUT /tenants/{tenantId}/roles/{roleId}` — `assignRoleToTenant` (9 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=tenantId, type=string, format=TenantId | ✓ | — |
| 404-not-found | path param=roleId, type=string, format=RoleId | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| documented-503 | response code 503 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| 409-conflict | create-or-replace with same identifier |  | duplicatePolicy per endpoint (idempotent \| conflict \| replace) |
| prerequisite-resource | 2 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |

### `PUT /roles/{roleId}/users/{username}` — `assignRoleToUser` (9 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=roleId, type=string, format=RoleId | ✓ | — |
| 404-not-found | path param=username, type=string, format=Username | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| documented-503 | response code 503 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| 409-conflict | create-or-replace with same identifier |  | duplicatePolicy per endpoint (idempotent \| conflict \| replace) |
| prerequisite-resource | 2 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |

### `POST /user-tasks/{userTaskKey}/assignment` — `assignUserTask` (13 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=userTaskKey, type=string, format=UserTaskKey | ✓ | — |
| bad-request:additional-property | closed schema | ✓ | — |
| bad-request:type-mismatch | field=assignee, type=string | ✓ | — |
| bad-request:type-mismatch | field=allowOverride, type=boolean | ✓ | — |
| bad-request:type-mismatch | field=action, type=string | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| documented-503 | response code 503 documented in spec | ✓ | — |
| documented-504 | response code 504 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 not documented; emitter needs to know if RBAC applies |  | RBAC: permissions required per endpoint |
| business-entity-lifecycle | path has state-transition verb |  | lifecycle state machine for this entity |
| prerequisite-resource | 1 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |

### `PUT /groups/{groupId}/users/{username}` — `assignUserToGroup` (9 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=groupId, type=string, format=GroupId | ✓ | — |
| 404-not-found | path param=username, type=string, format=Username | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| documented-503 | response code 503 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| 409-conflict | create-or-replace with same identifier |  | duplicatePolicy per endpoint (idempotent \| conflict \| replace) |
| prerequisite-resource | 2 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |

### `PUT /tenants/{tenantId}/users/{username}` — `assignUserToTenant` (9 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=tenantId, type=string, format=TenantId | ✓ | — |
| 404-not-found | path param=username, type=string, format=Username | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| documented-503 | response code 503 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| 409-conflict | create-or-replace with same identifier |  | duplicatePolicy per endpoint (idempotent \| conflict \| replace) |
| prerequisite-resource | 2 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |

### `POST /signals/broadcast` — `broadcastSignal` (11 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| bad-request:additional-property | closed schema | ✓ | — |
| bad-request:missing-required | field=signalName | ✓ | — |
| bad-request:type-mismatch | field=signalName, type=string | ✓ | — |
| bad-request:type-mismatch | field=variables, type=object | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| documented-503 | response code 503 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 not documented; emitter needs to know if RBAC applies |  | RBAC: permissions required per endpoint |
| 409-conflict | create-or-replace with same identifier |  | duplicatePolicy per endpoint (idempotent \| conflict \| replace) |
| business-entity-lifecycle | path has state-transition verb |  | lifecycle state machine for this entity |

### `POST /batch-operations/{batchOperationKey}/cancellation` — `cancelBatchOperation` (7 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=batchOperationKey, type=string, format=BatchOperationKey \| uuid | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| business-entity-lifecycle | path has state-transition verb |  | lifecycle state machine for this entity |
| prerequisite-resource | 1 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |

### `POST /process-instances/{processInstanceKey}/cancellation` — `cancelProcessInstance` (13 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=processInstanceKey, type=string, format=ProcessInstanceKey | ✓ | — |
| bad-request:additional-property | closed schema | ✓ | — |
| bad-request:format-invalid | field=operationReference, format=int64 | ✓ | — |
| bad-request:range-violation | field=operationReference | ✓ | — |
| bad-request:type-mismatch | field=operationReference, type=integer | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| documented-503 | response code 503 documented in spec | ✓ | — |
| documented-504 | response code 504 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 not documented; emitter needs to know if RBAC applies |  | RBAC: permissions required per endpoint |
| business-entity-lifecycle | path has state-transition verb |  | lifecycle state machine for this entity |
| prerequisite-resource | 1 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |

### `POST /process-instances/cancellation` — `cancelProcessInstancesBatchOperation` (13 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| bad-request:additional-property | closed schema | ✓ | — |
| bad-request:format-invalid | field=operationReference, format=int64 | ✓ | — |
| bad-request:missing-required | field=filter | ✓ | — |
| bad-request:range-violation | field=operationReference | ✓ | — |
| bad-request:type-mismatch | field=operationReference, type=integer | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| filter:request-shape | filter object in body | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| 409-conflict | create-or-replace with same identifier |  | duplicatePolicy per endpoint (idempotent \| conflict \| replace) |
| business-entity-lifecycle | path has state-transition verb |  | lifecycle state machine for this entity |
| filter:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |

### `POST /jobs/{jobKey}/completion` — `completeJob` (10 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=jobKey, type=string, format=JobKey | ✓ | — |
| bad-request:additional-property | closed schema | ✓ | — |
| bad-request:type-mismatch | field=variables, type=object | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| documented-503 | response code 503 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 not documented; emitter needs to know if RBAC applies |  | RBAC: permissions required per endpoint |
| business-entity-lifecycle | path has state-transition verb |  | lifecycle state machine for this entity |
| prerequisite-resource | 1 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |

### `POST /user-tasks/{userTaskKey}/completion` — `completeUserTask` (12 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=userTaskKey, type=string, format=UserTaskKey | ✓ | — |
| bad-request:additional-property | closed schema | ✓ | — |
| bad-request:type-mismatch | field=variables, type=object | ✓ | — |
| bad-request:type-mismatch | field=action, type=string | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| documented-503 | response code 503 documented in spec | ✓ | — |
| documented-504 | response code 504 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 not documented; emitter needs to know if RBAC applies |  | RBAC: permissions required per endpoint |
| business-entity-lifecycle | path has state-transition verb |  | lifecycle state machine for this entity |
| prerequisite-resource | 1 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |

### `POST /messages/correlation` — `correlateMessage` (12 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| bad-request:additional-property | closed schema | ✓ | — |
| bad-request:missing-required | field=name | ✓ | — |
| bad-request:type-mismatch | field=name, type=string | ✓ | — |
| bad-request:type-mismatch | field=correlationKey, type=string | ✓ | — |
| bad-request:type-mismatch | field=variables, type=object | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| documented-503 | response code 503 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| 409-conflict | create-or-replace with same identifier |  | duplicatePolicy per endpoint (idempotent \| conflict \| replace) |
| business-entity-lifecycle | path has state-transition verb |  | lifecycle state machine for this entity |

### `POST /setup/user` — `createAdminUser` (12 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| bad-request:additional-property | closed schema | ✓ | — |
| bad-request:missing-required | field=username | ✓ | — |
| bad-request:missing-required | field=password | ✓ | — |
| bad-request:type-mismatch | field=password, type=string | ✓ | — |
| bad-request:type-mismatch | field=name, type=string | ✓ | — |
| bad-request:type-mismatch | field=email, type=string | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| documented-503 | response code 503 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| 409-conflict | create-or-replace with same identifier |  | duplicatePolicy per endpoint (idempotent \| conflict \| replace) |

### `POST /agent-instances` — `createAgentInstance` (8 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| bad-request:missing-required | field=elementInstanceKey | ✓ | — |
| bad-request:missing-required | field=definition | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| documented-503 | response code 503 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| 409-conflict | create-or-replace with same identifier |  | duplicatePolicy per endpoint (idempotent \| conflict \| replace) |

### `POST /authorizations` — `createAuthorization` (7 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| bad-request:oneof-violation | oneOf branches=2 | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| documented-503 | response code 503 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| 409-conflict | create-or-replace with same identifier |  | duplicatePolicy per endpoint (idempotent \| conflict \| replace) |

### `POST /deployments` — `createDeployment` (5 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| documented-503 | response code 503 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 not documented; emitter needs to know if RBAC applies |  | RBAC: permissions required per endpoint |
| 409-conflict | create-or-replace with same identifier |  | duplicatePolicy per endpoint (idempotent \| conflict \| replace) |

### `POST /documents` — `createDocument` (5 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| documented-415 | response code 415 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 not documented; emitter needs to know if RBAC applies |  | RBAC: permissions required per endpoint |
| 409-conflict | create-or-replace with same identifier |  | duplicatePolicy per endpoint (idempotent \| conflict \| replace) |

### `POST /documents/{documentId}/links` — `createDocumentLink` (7 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=documentId, type=string, format=DocumentId | ✓ | — |
| bad-request:format-invalid | field=timeToLive, format=int64 | ✓ | — |
| bad-request:type-mismatch | field=timeToLive, type=integer | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 not documented; emitter needs to know if RBAC applies |  | RBAC: permissions required per endpoint |
| prerequisite-resource | 1 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |

### `POST /documents/batch` — `createDocuments` (5 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| documented-415 | response code 415 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 not documented; emitter needs to know if RBAC applies |  | RBAC: permissions required per endpoint |
| 409-conflict | create-or-replace with same identifier |  | duplicatePolicy per endpoint (idempotent \| conflict \| replace) |

### `PUT /element-instances/{elementInstanceKey}/variables` — `createElementInstanceVariables` (16 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=elementInstanceKey, type=string, format=ElementInstanceKey | ✓ | — |
| bad-request:additional-property | closed schema | ✓ | — |
| bad-request:format-invalid | field=operationReference, format=int64 | ✓ | — |
| bad-request:missing-required | field=variables | ✓ | — |
| bad-request:range-violation | field=operationReference | ✓ | — |
| bad-request:type-mismatch | field=variables, type=object | ✓ | — |
| bad-request:type-mismatch | field=local, type=boolean | ✓ | — |
| bad-request:type-mismatch | field=operationReference, type=integer | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| documented-503 | response code 503 documented in spec | ✓ | — |
| documented-504 | response code 504 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 not documented; emitter needs to know if RBAC applies |  | RBAC: permissions required per endpoint |
| 409-conflict | create-or-replace with same identifier |  | duplicatePolicy per endpoint (idempotent \| conflict \| replace) |
| prerequisite-resource | 1 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |

### `POST /cluster-variables/global` — `createGlobalClusterVariable` (8 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| bad-request:missing-required | field=name | ✓ | — |
| bad-request:missing-required | field=value | ✓ | — |
| bad-request:type-mismatch | field=value, type=object | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| 409-conflict | create-or-replace with same identifier |  | duplicatePolicy per endpoint (idempotent \| conflict \| replace) |

### `POST /global-task-listeners` — `createGlobalTaskListener` (12 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| bad-request:format-invalid | field=id, format=GlobalListenerId | ✓ | — |
| bad-request:missing-required | field=id | ✓ | — |
| bad-request:missing-required | field=type | ✓ | — |
| bad-request:missing-required | field=eventTypes | ✓ | — |
| bad-request:type-mismatch | field=id, type=string | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| documented-503 | response code 503 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| 409-conflict | create-or-replace with same identifier |  | duplicatePolicy per endpoint (idempotent \| conflict \| replace) |
| business-entity-lifecycle | 409 documented on non-collection POST |  | lifecycle state machine for this entity |

### `POST /groups` — `createGroup` (11 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| bad-request:additional-property | closed schema | ✓ | — |
| bad-request:missing-required | field=groupId | ✓ | — |
| bad-request:missing-required | field=name | ✓ | — |
| bad-request:type-mismatch | field=name, type=string | ✓ | — |
| bad-request:type-mismatch | field=description, type=string | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| documented-503 | response code 503 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| 409-conflict | create-or-replace with same identifier |  | duplicatePolicy per endpoint (idempotent \| conflict \| replace) |

### `POST /mapping-rules` — `createMappingRule` (7 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| bad-request:additional-property | closed schema | ✓ | — |
| bad-request:missing-required | field=mappingRuleId | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| 409-conflict | create-or-replace with same identifier |  | duplicatePolicy per endpoint (idempotent \| conflict \| replace) |

### `POST /process-instances` — `createProcessInstance` (9 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| bad-request:oneof-violation | oneOf branches=2 | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| documented-503 | response code 503 documented in spec | ✓ | — |
| documented-504 | response code 504 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 not documented; emitter needs to know if RBAC applies |  | RBAC: permissions required per endpoint |
| 409-conflict | create-or-replace with same identifier |  | duplicatePolicy per endpoint (idempotent \| conflict \| replace) |
| business-entity-lifecycle | 409 documented on non-collection POST |  | lifecycle state machine for this entity |

### `POST /roles` — `createRole` (11 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| bad-request:additional-property | closed schema | ✓ | — |
| bad-request:missing-required | field=roleId | ✓ | — |
| bad-request:missing-required | field=name | ✓ | — |
| bad-request:type-mismatch | field=name, type=string | ✓ | — |
| bad-request:type-mismatch | field=description, type=string | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| documented-503 | response code 503 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| 409-conflict | create-or-replace with same identifier |  | duplicatePolicy per endpoint (idempotent \| conflict \| replace) |

### `POST /tenants` — `createTenant` (12 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| bad-request:additional-property | closed schema | ✓ | — |
| bad-request:missing-required | field=tenantId | ✓ | — |
| bad-request:missing-required | field=name | ✓ | — |
| bad-request:type-mismatch | field=name, type=string | ✓ | — |
| bad-request:type-mismatch | field=description, type=string | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| documented-503 | response code 503 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| 409-conflict | create-or-replace with same identifier |  | duplicatePolicy per endpoint (idempotent \| conflict \| replace) |
| business-entity-lifecycle | 409 documented on non-collection POST |  | lifecycle state machine for this entity |

### `POST /cluster-variables/tenants/{tenantId}` — `createTenantClusterVariable` (9 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=tenantId, type=string, format=TenantId | ✓ | — |
| bad-request:missing-required | field=name | ✓ | — |
| bad-request:missing-required | field=value | ✓ | — |
| bad-request:type-mismatch | field=value, type=object | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| prerequisite-resource | 1 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |

### `POST /users` — `createUser` (13 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| bad-request:additional-property | closed schema | ✓ | — |
| bad-request:missing-required | field=username | ✓ | — |
| bad-request:missing-required | field=password | ✓ | — |
| bad-request:type-mismatch | field=password, type=string | ✓ | — |
| bad-request:type-mismatch | field=name, type=string | ✓ | — |
| bad-request:type-mismatch | field=email, type=string | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| documented-503 | response code 503 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| 409-conflict | create-or-replace with same identifier |  | duplicatePolicy per endpoint (idempotent \| conflict \| replace) |
| business-entity-lifecycle | 409 documented on non-collection POST |  | lifecycle state machine for this entity |

### `DELETE /authorizations/{authorizationKey}` — `deleteAuthorization` (7 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=authorizationKey, type=string, format=AuthorizationKey | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| documented-503 | response code 503 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 not documented; emitter needs to know if RBAC applies |  | RBAC: permissions required per endpoint |
| prerequisite-resource | 1 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |

### `POST /decision-instances/{decisionEvaluationKey}/deletion` — `deleteDecisionInstance` (11 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=decisionEvaluationKey, type=string, format=DecisionEvaluationKey | ✓ | — |
| bad-request:additional-property | closed schema | ✓ | — |
| bad-request:format-invalid | field=operationReference, format=int64 | ✓ | — |
| bad-request:range-violation | field=operationReference | ✓ | — |
| bad-request:type-mismatch | field=operationReference, type=integer | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| documented-503 | response code 503 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| prerequisite-resource | 1 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |

### `POST /decision-instances/deletion` — `deleteDecisionInstancesBatchOperation` (12 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| bad-request:additional-property | closed schema | ✓ | — |
| bad-request:format-invalid | field=operationReference, format=int64 | ✓ | — |
| bad-request:missing-required | field=filter | ✓ | — |
| bad-request:range-violation | field=operationReference | ✓ | — |
| bad-request:type-mismatch | field=operationReference, type=integer | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| filter:request-shape | filter object in body | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| 409-conflict | create-or-replace with same identifier |  | duplicatePolicy per endpoint (idempotent \| conflict \| replace) |
| filter:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |

### `DELETE /documents/{documentId}` — `deleteDocument` (6 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=documentId, type=string, format=DocumentId | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 not documented; emitter needs to know if RBAC applies |  | RBAC: permissions required per endpoint |
| prerequisite-resource | 1 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |

### `DELETE /cluster-variables/global/{name}` — `deleteGlobalClusterVariable` (6 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=name, type=string, format=ClusterVariableName | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| prerequisite-resource | 1 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |

### `DELETE /global-task-listeners/{id}` — `deleteGlobalTaskListener` (7 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=id, type=string, format=GlobalListenerId | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| documented-503 | response code 503 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| prerequisite-resource | 1 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |

### `DELETE /groups/{groupId}` — `deleteGroup` (7 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=groupId, type=string, format=GroupId | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| documented-503 | response code 503 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 not documented; emitter needs to know if RBAC applies |  | RBAC: permissions required per endpoint |
| prerequisite-resource | 1 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |

### `DELETE /mapping-rules/{mappingRuleId}` — `deleteMappingRule` (7 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=mappingRuleId, type=string, format=MappingRuleId | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| documented-503 | response code 503 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 not documented; emitter needs to know if RBAC applies |  | RBAC: permissions required per endpoint |
| prerequisite-resource | 1 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |

### `POST /process-instances/{processInstanceKey}/deletion` — `deleteProcessInstance` (12 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=processInstanceKey, type=string, format=ProcessInstanceKey | ✓ | — |
| bad-request:additional-property | closed schema | ✓ | — |
| bad-request:format-invalid | field=operationReference, format=int64 | ✓ | — |
| bad-request:range-violation | field=operationReference | ✓ | — |
| bad-request:type-mismatch | field=operationReference, type=integer | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| documented-503 | response code 503 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| business-entity-lifecycle | 409 documented on non-collection POST |  | lifecycle state machine for this entity |
| prerequisite-resource | 1 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |

### `POST /process-instances/deletion` — `deleteProcessInstancesBatchOperation` (12 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| bad-request:additional-property | closed schema | ✓ | — |
| bad-request:format-invalid | field=operationReference, format=int64 | ✓ | — |
| bad-request:missing-required | field=filter | ✓ | — |
| bad-request:range-violation | field=operationReference | ✓ | — |
| bad-request:type-mismatch | field=operationReference, type=integer | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| filter:request-shape | filter object in body | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| 409-conflict | create-or-replace with same identifier |  | duplicatePolicy per endpoint (idempotent \| conflict \| replace) |
| filter:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |

### `POST /resources/{resourceKey}/deletion` — `deleteResource` (12 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=resourceKey, type=string, format=ResourceKey | ✓ | — |
| bad-request:additional-property | closed schema | ✓ | — |
| bad-request:format-invalid | field=operationReference, format=int64 | ✓ | — |
| bad-request:range-violation | field=operationReference | ✓ | — |
| bad-request:type-mismatch | field=operationReference, type=integer | ✓ | — |
| bad-request:type-mismatch | field=deleteHistory, type=boolean | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| documented-503 | response code 503 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 not documented; emitter needs to know if RBAC applies |  | RBAC: permissions required per endpoint |
| prerequisite-resource | 1 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |

### `DELETE /roles/{roleId}` — `deleteRole` (7 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=roleId, type=string, format=RoleId | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| documented-503 | response code 503 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 not documented; emitter needs to know if RBAC applies |  | RBAC: permissions required per endpoint |
| prerequisite-resource | 1 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |

### `DELETE /tenants/{tenantId}` — `deleteTenant` (7 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=tenantId, type=string, format=TenantId | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| documented-503 | response code 503 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| prerequisite-resource | 1 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |

### `DELETE /cluster-variables/tenants/{tenantId}/{name}` — `deleteTenantClusterVariable` (7 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=tenantId, type=string, format=TenantId | ✓ | — |
| 404-not-found | path param=name, type=string, format=ClusterVariableName | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| prerequisite-resource | 2 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |

### `DELETE /users/{username}` — `deleteUser` (7 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=username, type=string, format=Username | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| documented-503 | response code 503 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 not documented; emitter needs to know if RBAC applies |  | RBAC: permissions required per endpoint |
| prerequisite-resource | 1 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |

### `POST /conditionals/evaluation` — `evaluateConditionals` (8 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| bad-request:missing-required | field=variables | ✓ | — |
| bad-request:type-mismatch | field=variables, type=object | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| documented-503 | response code 503 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| 409-conflict | create-or-replace with same identifier |  | duplicatePolicy per endpoint (idempotent \| conflict \| replace) |

### `POST /decision-definitions/evaluation` — `evaluateDecision` (7 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| bad-request:oneof-violation | oneOf branches=2 | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| documented-503 | response code 503 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 not documented; emitter needs to know if RBAC applies |  | RBAC: permissions required per endpoint |
| 409-conflict | create-or-replace with same identifier |  | duplicatePolicy per endpoint (idempotent \| conflict \| replace) |

### `POST /expression/evaluation` — `evaluateExpression` (9 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| bad-request:missing-required | field=expression | ✓ | — |
| bad-request:type-mismatch | field=expression, type=string | ✓ | — |
| bad-request:type-mismatch | field=tenantId, type=string | ✓ | — |
| bad-request:type-mismatch | field=variables, type=object | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| 409-conflict | create-or-replace with same identifier |  | duplicatePolicy per endpoint (idempotent \| conflict \| replace) |

### `POST /jobs/{jobKey}/failure` — `failJob` (15 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=jobKey, type=string, format=JobKey | ✓ | — |
| bad-request:additional-property | closed schema | ✓ | — |
| bad-request:format-invalid | field=retries, format=int32 | ✓ | — |
| bad-request:format-invalid | field=retryBackOff, format=int64 | ✓ | — |
| bad-request:type-mismatch | field=retries, type=integer | ✓ | — |
| bad-request:type-mismatch | field=errorMessage, type=string | ✓ | — |
| bad-request:type-mismatch | field=retryBackOff, type=integer | ✓ | — |
| bad-request:type-mismatch | field=variables, type=object | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| documented-503 | response code 503 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 not documented; emitter needs to know if RBAC applies |  | RBAC: permissions required per endpoint |
| business-entity-lifecycle | operationId prefix `fail` implies state transition |  | lifecycle state machine for this entity |
| prerequisite-resource | 1 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |

### `GET /agent-instances/{agentInstanceKey}` — `getAgentInstance` (7 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=agentInstanceKey, type=string, format=AgentInstanceKey | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| documented-503 | response code 503 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| prerequisite-resource | 1 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |

### `GET /audit-logs/{auditLogKey}` — `getAuditLog` (6 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=auditLogKey, type=string, format=AuditLogKey | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| prerequisite-resource | 1 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |

### `GET /authentication/me` — `getAuthentication` (4 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 401-unauthorized | per-op security; strip auth header | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |

### `GET /authorizations/{authorizationKey}` — `getAuthorization` (6 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=authorizationKey, type=string, format=AuthorizationKey | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| prerequisite-resource | 1 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |

### `GET /batch-operations/{batchOperationKey}` — `getBatchOperation` (6 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=batchOperationKey, type=string, format=BatchOperationKey \| uuid | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 not documented; emitter needs to know if RBAC applies |  | RBAC: permissions required per endpoint |
| prerequisite-resource | 1 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |

### `GET /decision-definitions/{decisionDefinitionKey}` — `getDecisionDefinition` (6 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=decisionDefinitionKey, type=string, format=DecisionDefinitionKey | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| prerequisite-resource | 1 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |

### `GET /decision-definitions/{decisionDefinitionKey}/xml` — `getDecisionDefinitionXML` (6 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=decisionDefinitionKey, type=string, format=DecisionDefinitionKey | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| prerequisite-resource | 1 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |

### `GET /decision-instances/{decisionEvaluationInstanceKey}` — `getDecisionInstance` (6 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=decisionEvaluationInstanceKey, type=string, format=DecisionEvaluationInstanceKey | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| prerequisite-resource | 1 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |

### `GET /decision-requirements/{decisionRequirementsKey}` — `getDecisionRequirements` (6 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=decisionRequirementsKey, type=string, format=DecisionRequirementsKey | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| prerequisite-resource | 1 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |

### `GET /decision-requirements/{decisionRequirementsKey}/xml` — `getDecisionRequirementsXML` (6 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=decisionRequirementsKey, type=string, format=DecisionRequirementsKey | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| prerequisite-resource | 1 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |

### `GET /documents/{documentId}` — `getDocument` (6 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=documentId, type=string, format=DocumentId | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 not documented; emitter needs to know if RBAC applies |  | RBAC: permissions required per endpoint |
| prerequisite-resource | 1 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |

### `GET /element-instances/{elementInstanceKey}` — `getElementInstance` (6 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=elementInstanceKey, type=string, format=ElementInstanceKey | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| prerequisite-resource | 1 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |

### `GET /forms/{formKey}` — `getFormByKey` (6 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=formKey, type=string, format=FormKey | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| prerequisite-resource | 1 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |

### `GET /cluster-variables/global/{name}` — `getGlobalClusterVariable` (6 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=name, type=string, format=ClusterVariableName | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| prerequisite-resource | 1 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |

### `GET /jobs/statistics/global` — `getGlobalJobStatistics` (5 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| documented-500 | response code 500 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| pagination-sort:request-shape | query param=from | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |

### `GET /global-task-listeners/{id}` — `getGlobalTaskListener` (6 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=id, type=string, format=GlobalListenerId | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| prerequisite-resource | 1 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |

### `GET /groups/{groupId}` — `getGroup` (6 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=groupId, type=string, format=GroupId | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| prerequisite-resource | 1 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |

### `GET /incidents/{incidentKey}` — `getIncident` (6 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=incidentKey, type=string, format=IncidentKey | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| prerequisite-resource | 1 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |

### `POST /jobs/statistics/errors` — `getJobErrorStatistics` (11 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| bad-request:missing-required | field=filter | ✓ | — |
| bad-request:type-mismatch | field=filter, type=object | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| filter:request-shape | filter object in body | ✓ | — |
| happy-path | documented success response | ✓ | — |
| pagination-sort:request-shape | page object in body | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| 409-conflict | create-or-replace with same identifier |  | duplicatePolicy per endpoint (idempotent \| conflict \| replace) |
| filter:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |
| pagination-sort:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |

### `POST /jobs/statistics/time-series` — `getJobTimeSeriesStatistics` (11 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| bad-request:missing-required | field=filter | ✓ | — |
| bad-request:type-mismatch | field=filter, type=object | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| filter:request-shape | filter object in body | ✓ | — |
| happy-path | documented success response | ✓ | — |
| pagination-sort:request-shape | page object in body | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| 409-conflict | create-or-replace with same identifier |  | duplicatePolicy per endpoint (idempotent \| conflict \| replace) |
| filter:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |
| pagination-sort:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |

### `POST /jobs/statistics/by-types` — `getJobTypeStatistics` (10 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| bad-request:type-mismatch | field=filter, type=object | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| filter:request-shape | filter object in body | ✓ | — |
| happy-path | documented success response | ✓ | — |
| pagination-sort:request-shape | page object in body | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| 409-conflict | create-or-replace with same identifier |  | duplicatePolicy per endpoint (idempotent \| conflict \| replace) |
| filter:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |
| pagination-sort:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |

### `POST /jobs/statistics/by-workers` — `getJobWorkerStatistics` (11 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| bad-request:missing-required | field=filter | ✓ | — |
| bad-request:type-mismatch | field=filter, type=object | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| filter:request-shape | filter object in body | ✓ | — |
| happy-path | documented success response | ✓ | — |
| pagination-sort:request-shape | page object in body | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| 409-conflict | create-or-replace with same identifier |  | duplicatePolicy per endpoint (idempotent \| conflict \| replace) |
| filter:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |
| pagination-sort:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |

### `GET /license` — `getLicense` (4 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| documented-500 | response code 500 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 not documented; emitter needs to know if RBAC applies |  | RBAC: permissions required per endpoint |

### `GET /mapping-rules/{mappingRuleId}` — `getMappingRule` (6 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=mappingRuleId, type=string, format=MappingRuleId | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 not documented; emitter needs to know if RBAC applies |  | RBAC: permissions required per endpoint |
| prerequisite-resource | 1 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |

### `GET /process-definitions/{processDefinitionKey}` — `getProcessDefinition` (6 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=processDefinitionKey, type=string, format=ProcessDefinitionKey | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| prerequisite-resource | 1 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |

### `POST /process-definitions/statistics/process-instances` — `getProcessDefinitionInstanceStatistics` (10 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| bad-request:type-mismatch | field=sort, type=array | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| pagination-sort:request-shape | page object in body | ✓ | — |
| pagination-sort:request-shape | sort array in body | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| 409-conflict | create-or-replace with same identifier |  | duplicatePolicy per endpoint (idempotent \| conflict \| replace) |
| pagination-sort:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |
| pagination-sort:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |

### `POST /process-definitions/statistics/process-instances-by-version` — `getProcessDefinitionInstanceVersionStatistics` (13 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| bad-request:missing-required | field=filter | ✓ | — |
| bad-request:type-mismatch | field=sort, type=array | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| filter:request-shape | filter object in body | ✓ | — |
| happy-path | documented success response | ✓ | — |
| pagination-sort:request-shape | page object in body | ✓ | — |
| pagination-sort:request-shape | sort array in body | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| 409-conflict | create-or-replace with same identifier |  | duplicatePolicy per endpoint (idempotent \| conflict \| replace) |
| filter:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |
| pagination-sort:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |
| pagination-sort:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |

### `POST /process-definitions/statistics/message-subscriptions` — `getProcessDefinitionMessageSubscriptionStatistics` (9 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| documented-500 | response code 500 documented in spec | ✓ | — |
| filter:request-shape | filter object in body | ✓ | — |
| happy-path | documented success response | ✓ | — |
| pagination-sort:request-shape | page object in body | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| 409-conflict | create-or-replace with same identifier |  | duplicatePolicy per endpoint (idempotent \| conflict \| replace) |
| filter:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |
| pagination-sort:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |

### `POST /process-definitions/{processDefinitionKey}/statistics/element-instances` — `getProcessDefinitionStatistics` (9 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=processDefinitionKey, type=string, format=ProcessDefinitionKey | ✓ | — |
| bad-request:additional-property | closed schema | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| filter:request-shape | filter object in body | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| filter:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |
| prerequisite-resource | 1 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |

### `GET /process-definitions/{processDefinitionKey}/xml` — `getProcessDefinitionXML` (6 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=processDefinitionKey, type=string, format=ProcessDefinitionKey | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| prerequisite-resource | 1 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |

### `GET /process-instances/{processInstanceKey}` — `getProcessInstance` (6 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=processInstanceKey, type=string, format=ProcessInstanceKey | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| prerequisite-resource | 1 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |

### `GET /process-instances/{processInstanceKey}/call-hierarchy` — `getProcessInstanceCallHierarchy` (6 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=processInstanceKey, type=string, format=ProcessInstanceKey | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| prerequisite-resource | 1 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |

### `GET /process-instances/{processInstanceKey}/sequence-flows` — `getProcessInstanceSequenceFlows` (6 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=processInstanceKey, type=string, format=ProcessInstanceKey | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| prerequisite-resource | 1 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |

### `GET /process-instances/{processInstanceKey}/statistics/element-instances` — `getProcessInstanceStatistics` (6 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=processInstanceKey, type=string, format=ProcessInstanceKey | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| prerequisite-resource | 1 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |

### `POST /incidents/statistics/process-instances-by-definition` — `getProcessInstanceStatisticsByDefinition` (13 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| bad-request:missing-required | field=filter | ✓ | — |
| bad-request:type-mismatch | field=sort, type=array | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| filter:request-shape | filter object in body | ✓ | — |
| happy-path | documented success response | ✓ | — |
| pagination-sort:request-shape | page object in body | ✓ | — |
| pagination-sort:request-shape | sort array in body | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| 409-conflict | create-or-replace with same identifier |  | duplicatePolicy per endpoint (idempotent \| conflict \| replace) |
| filter:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |
| pagination-sort:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |
| pagination-sort:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |

### `POST /incidents/statistics/process-instances-by-error` — `getProcessInstanceStatisticsByError` (11 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| bad-request:additional-property | closed schema | ✓ | — |
| bad-request:type-mismatch | field=sort, type=array | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| pagination-sort:request-shape | page object in body | ✓ | — |
| pagination-sort:request-shape | sort array in body | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| 409-conflict | create-or-replace with same identifier |  | duplicatePolicy per endpoint (idempotent \| conflict \| replace) |
| pagination-sort:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |
| pagination-sort:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |

### `GET /resources/{resourceKey}` — `getResource` (6 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=resourceKey, type=string, format=ResourceKey | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 not documented; emitter needs to know if RBAC applies |  | RBAC: permissions required per endpoint |
| prerequisite-resource | 1 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |

### `GET /resources/{resourceKey}/content` — `getResourceContent` (7 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=resourceKey, type=string, format=ResourceKey | ✓ | — |
| documented-406 | response code 406 documented in spec | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 not documented; emitter needs to know if RBAC applies |  | RBAC: permissions required per endpoint |
| prerequisite-resource | 1 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |

### `GET /resources/{resourceKey}/content/binary` — `getResourceContentBinary` (6 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=resourceKey, type=string, format=ResourceKey | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 not documented; emitter needs to know if RBAC applies |  | RBAC: permissions required per endpoint |
| prerequisite-resource | 1 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |

### `GET /roles/{roleId}` — `getRole` (6 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=roleId, type=string, format=RoleId | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| prerequisite-resource | 1 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |

### `GET /process-definitions/{processDefinitionKey}/form` — `getStartProcessForm` (6 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=processDefinitionKey, type=string, format=ProcessDefinitionKey | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| prerequisite-resource | 1 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |

### `GET /status` — `getStatus` (4 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| documented-503 | response code 503 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 not documented; emitter needs to know if RBAC applies |  | RBAC: permissions required per endpoint |

### `GET /system/configuration` — `getSystemConfiguration` (4 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| documented-500 | response code 500 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 not documented; emitter needs to know if RBAC applies |  | RBAC: permissions required per endpoint |

### `GET /tenants/{tenantId}` — `getTenant` (6 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=tenantId, type=string, format=TenantId | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| prerequisite-resource | 1 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |

### `GET /cluster-variables/tenants/{tenantId}/{name}` — `getTenantClusterVariable` (7 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=tenantId, type=string, format=TenantId | ✓ | — |
| 404-not-found | path param=name, type=string, format=ClusterVariableName | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| prerequisite-resource | 2 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |

### `GET /topology` — `getTopology` (4 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| documented-500 | response code 500 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 not documented; emitter needs to know if RBAC applies |  | RBAC: permissions required per endpoint |

### `GET /system/usage-metrics` — `getUsageMetrics` (4 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| documented-500 | response code 500 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |

### `GET /users/{username}` — `getUser` (6 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=username, type=string, format=Username | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| prerequisite-resource | 1 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |

### `GET /user-tasks/{userTaskKey}` — `getUserTask` (6 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=userTaskKey, type=string, format=UserTaskKey | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| prerequisite-resource | 1 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |

### `GET /user-tasks/{userTaskKey}/form` — `getUserTaskForm` (6 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=userTaskKey, type=string, format=UserTaskKey | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| prerequisite-resource | 1 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |

### `GET /variables/{variableKey}` — `getVariable` (6 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=variableKey, type=string, format=VariableKey | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| prerequisite-resource | 1 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |

### `POST /process-instances/{processInstanceKey}/migration` — `migrateProcessInstance` (15 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=processInstanceKey, type=string, format=ProcessInstanceKey | ✓ | — |
| bad-request:additional-property | closed schema | ✓ | — |
| bad-request:format-invalid | field=operationReference, format=int64 | ✓ | — |
| bad-request:missing-required | field=targetProcessDefinitionKey | ✓ | — |
| bad-request:missing-required | field=mappingInstructions | ✓ | — |
| bad-request:range-violation | field=operationReference | ✓ | — |
| bad-request:type-mismatch | field=mappingInstructions, type=array | ✓ | — |
| bad-request:type-mismatch | field=operationReference, type=integer | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| documented-503 | response code 503 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 not documented; emitter needs to know if RBAC applies |  | RBAC: permissions required per endpoint |
| business-entity-lifecycle | operationId prefix `migrate` implies state transition |  | lifecycle state machine for this entity |
| prerequisite-resource | 1 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |

### `POST /process-instances/migration` — `migrateProcessInstancesBatchOperation` (14 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| bad-request:additional-property | closed schema | ✓ | — |
| bad-request:format-invalid | field=operationReference, format=int64 | ✓ | — |
| bad-request:missing-required | field=filter | ✓ | — |
| bad-request:missing-required | field=migrationPlan | ✓ | — |
| bad-request:range-violation | field=operationReference | ✓ | — |
| bad-request:type-mismatch | field=operationReference, type=integer | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| filter:request-shape | filter object in body | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| 409-conflict | create-or-replace with same identifier |  | duplicatePolicy per endpoint (idempotent \| conflict \| replace) |
| business-entity-lifecycle | operationId prefix `migrate` implies state transition |  | lifecycle state machine for this entity |
| filter:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |

### `POST /process-instances/{processInstanceKey}/modification` — `modifyProcessInstance` (15 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=processInstanceKey, type=string, format=ProcessInstanceKey | ✓ | — |
| bad-request:additional-property | closed schema | ✓ | — |
| bad-request:format-invalid | field=operationReference, format=int64 | ✓ | — |
| bad-request:range-violation | field=operationReference | ✓ | — |
| bad-request:type-mismatch | field=operationReference, type=integer | ✓ | — |
| bad-request:type-mismatch | field=activateInstructions, type=array | ✓ | — |
| bad-request:type-mismatch | field=moveInstructions, type=array | ✓ | — |
| bad-request:type-mismatch | field=terminateInstructions, type=array | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| documented-503 | response code 503 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 not documented; emitter needs to know if RBAC applies |  | RBAC: permissions required per endpoint |
| business-entity-lifecycle | path has state-transition verb |  | lifecycle state machine for this entity |
| prerequisite-resource | 1 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |

### `POST /process-instances/modification` — `modifyProcessInstancesBatchOperation` (15 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| bad-request:additional-property | closed schema | ✓ | — |
| bad-request:format-invalid | field=operationReference, format=int64 | ✓ | — |
| bad-request:missing-required | field=filter | ✓ | — |
| bad-request:missing-required | field=moveInstructions | ✓ | — |
| bad-request:range-violation | field=operationReference | ✓ | — |
| bad-request:type-mismatch | field=moveInstructions, type=array | ✓ | — |
| bad-request:type-mismatch | field=operationReference, type=integer | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| filter:request-shape | filter object in body | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| 409-conflict | create-or-replace with same identifier |  | duplicatePolicy per endpoint (idempotent \| conflict \| replace) |
| business-entity-lifecycle | path has state-transition verb |  | lifecycle state machine for this entity |
| filter:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |

### `PUT /clock` — `pinClock` (10 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| bad-request:additional-property | closed schema | ✓ | — |
| bad-request:format-invalid | field=timestamp, format=int64 | ✓ | — |
| bad-request:missing-required | field=timestamp | ✓ | — |
| bad-request:type-mismatch | field=timestamp, type=integer | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| documented-503 | response code 503 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 not documented; emitter needs to know if RBAC applies |  | RBAC: permissions required per endpoint |
| business-entity-lifecycle | operationId prefix `pin` implies state transition |  | lifecycle state machine for this entity |

### `POST /messages/publication` — `publishMessage` (15 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| bad-request:additional-property | closed schema | ✓ | — |
| bad-request:format-invalid | field=timeToLive, format=int64 | ✓ | — |
| bad-request:missing-required | field=name | ✓ | — |
| bad-request:type-mismatch | field=name, type=string | ✓ | — |
| bad-request:type-mismatch | field=correlationKey, type=string | ✓ | — |
| bad-request:type-mismatch | field=timeToLive, type=integer | ✓ | — |
| bad-request:type-mismatch | field=messageId, type=string | ✓ | — |
| bad-request:type-mismatch | field=variables, type=object | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| documented-503 | response code 503 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 not documented; emitter needs to know if RBAC applies |  | RBAC: permissions required per endpoint |
| 409-conflict | create-or-replace with same identifier |  | duplicatePolicy per endpoint (idempotent \| conflict \| replace) |
| business-entity-lifecycle | path has state-transition verb |  | lifecycle state machine for this entity |

### `POST /clock/reset` — `resetClock` (7 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| documented-500 | response code 500 documented in spec | ✓ | — |
| documented-503 | response code 503 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 not documented; emitter needs to know if RBAC applies |  | RBAC: permissions required per endpoint |
| 409-conflict | create-or-replace with same identifier |  | duplicatePolicy per endpoint (idempotent \| conflict \| replace) |
| business-entity-lifecycle | operationId prefix `reset` implies state transition |  | lifecycle state machine for this entity |

### `POST /incidents/{incidentKey}/resolution` — `resolveIncident` (12 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=incidentKey, type=string, format=IncidentKey | ✓ | — |
| bad-request:additional-property | closed schema | ✓ | — |
| bad-request:format-invalid | field=operationReference, format=int64 | ✓ | — |
| bad-request:range-violation | field=operationReference | ✓ | — |
| bad-request:type-mismatch | field=operationReference, type=integer | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| documented-503 | response code 503 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 not documented; emitter needs to know if RBAC applies |  | RBAC: permissions required per endpoint |
| business-entity-lifecycle | path has state-transition verb |  | lifecycle state machine for this entity |
| prerequisite-resource | 1 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |

### `POST /process-instances/incident-resolution` — `resolveIncidentsBatchOperation` (13 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| bad-request:additional-property | closed schema | ✓ | — |
| bad-request:format-invalid | field=operationReference, format=int64 | ✓ | — |
| bad-request:missing-required | field=filter | ✓ | — |
| bad-request:range-violation | field=operationReference | ✓ | — |
| bad-request:type-mismatch | field=operationReference, type=integer | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| filter:request-shape | filter object in body | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| 409-conflict | create-or-replace with same identifier |  | duplicatePolicy per endpoint (idempotent \| conflict \| replace) |
| business-entity-lifecycle | operationId prefix `resolve` implies state transition |  | lifecycle state machine for this entity |
| filter:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |

### `POST /process-instances/{processInstanceKey}/incident-resolution` — `resolveProcessInstanceIncidents` (8 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=processInstanceKey, type=string, format=ProcessInstanceKey | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| documented-503 | response code 503 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 not documented; emitter needs to know if RBAC applies |  | RBAC: permissions required per endpoint |
| business-entity-lifecycle | operationId prefix `resolve` implies state transition |  | lifecycle state machine for this entity |
| prerequisite-resource | 1 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |

### `POST /batch-operations/{batchOperationKey}/resumption` — `resumeBatchOperation` (7 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=batchOperationKey, type=string, format=BatchOperationKey \| uuid | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| documented-503 | response code 503 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| prerequisite-resource | 1 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |

### `POST /agent-instances/search` — `searchAgentInstances` (12 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| bad-request:additional-property | closed schema | ✓ | — |
| bad-request:type-mismatch | field=sort, type=array | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| filter:request-shape | filter object in body | ✓ | — |
| happy-path | documented success response | ✓ | — |
| pagination-sort:request-shape | sort array in body | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| eventual-consistency | search may lag behind writes |  | consistency window per entity (or eventually-consistent flag) |
| filter:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |
| pagination-sort:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |
| scale-large-n | behaviour at 10K+ entities; pagination limits, timeout, ordering stability |  | scale thresholds + expected response time per entity |

### `POST /audit-logs/search` — `searchAuditLogs` (12 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| bad-request:additional-property | closed schema | ✓ | — |
| bad-request:type-mismatch | field=sort, type=array | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| filter:request-shape | filter object in body | ✓ | — |
| happy-path | documented success response | ✓ | — |
| pagination-sort:request-shape | sort array in body | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| eventual-consistency | search may lag behind writes |  | consistency window per entity (or eventually-consistent flag) |
| filter:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |
| pagination-sort:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |
| scale-large-n | behaviour at 10K+ entities; pagination limits, timeout, ordering stability |  | scale thresholds + expected response time per entity |

### `POST /authorizations/search` — `searchAuthorizations` (12 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| bad-request:additional-property | closed schema | ✓ | — |
| bad-request:type-mismatch | field=sort, type=array | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| filter:request-shape | filter object in body | ✓ | — |
| happy-path | documented success response | ✓ | — |
| pagination-sort:request-shape | sort array in body | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| eventual-consistency | search may lag behind writes |  | consistency window per entity (or eventually-consistent flag) |
| filter:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |
| pagination-sort:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |
| scale-large-n | behaviour at 10K+ entities; pagination limits, timeout, ordering stability |  | scale thresholds + expected response time per entity |

### `POST /batch-operation-items/search` — `searchBatchOperationItems` (12 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| bad-request:additional-property | closed schema | ✓ | — |
| bad-request:type-mismatch | field=sort, type=array | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| filter:request-shape | filter object in body | ✓ | — |
| happy-path | documented success response | ✓ | — |
| pagination-sort:request-shape | sort array in body | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 not documented; emitter needs to know if RBAC applies |  | RBAC: permissions required per endpoint |
| eventual-consistency | search may lag behind writes |  | consistency window per entity (or eventually-consistent flag) |
| filter:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |
| pagination-sort:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |
| scale-large-n | behaviour at 10K+ entities; pagination limits, timeout, ordering stability |  | scale thresholds + expected response time per entity |

### `POST /batch-operations/search` — `searchBatchOperations` (12 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| bad-request:additional-property | closed schema | ✓ | — |
| bad-request:type-mismatch | field=sort, type=array | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| filter:request-shape | filter object in body | ✓ | — |
| happy-path | documented success response | ✓ | — |
| pagination-sort:request-shape | sort array in body | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 not documented; emitter needs to know if RBAC applies |  | RBAC: permissions required per endpoint |
| eventual-consistency | search may lag behind writes |  | consistency window per entity (or eventually-consistent flag) |
| filter:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |
| pagination-sort:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |
| scale-large-n | behaviour at 10K+ entities; pagination limits, timeout, ordering stability |  | scale thresholds + expected response time per entity |

### `POST /groups/{groupId}/clients/search` — `searchClientsForGroup` (11 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=groupId, type=string, format=GroupId | ✓ | — |
| bad-request:type-mismatch | field=sort, type=array | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| pagination-sort:request-shape | sort array in body | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| eventual-consistency | search may lag behind writes |  | consistency window per entity (or eventually-consistent flag) |
| pagination-sort:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |
| prerequisite-resource | 1 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |
| scale-large-n | behaviour at 10K+ entities; pagination limits, timeout, ordering stability |  | scale thresholds + expected response time per entity |

### `POST /roles/{roleId}/clients/search` — `searchClientsForRole` (11 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=roleId, type=string, format=RoleId | ✓ | — |
| bad-request:type-mismatch | field=sort, type=array | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| pagination-sort:request-shape | sort array in body | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| eventual-consistency | search may lag behind writes |  | consistency window per entity (or eventually-consistent flag) |
| pagination-sort:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |
| prerequisite-resource | 1 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |
| scale-large-n | behaviour at 10K+ entities; pagination limits, timeout, ordering stability |  | scale thresholds + expected response time per entity |

### `POST /tenants/{tenantId}/clients/search` — `searchClientsForTenant` (11 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=tenantId, type=string, format=TenantId | ✓ | — |
| bad-request:additional-property | closed schema | ✓ | — |
| bad-request:type-mismatch | field=sort, type=array | ✓ | — |
| happy-path | documented success response | ✓ | — |
| pagination-sort:request-shape | sort array in body | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 not documented; emitter needs to know if RBAC applies |  | RBAC: permissions required per endpoint |
| eventual-consistency | search may lag behind writes |  | consistency window per entity (or eventually-consistent flag) |
| pagination-sort:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |
| prerequisite-resource | 1 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |
| scale-large-n | behaviour at 10K+ entities; pagination limits, timeout, ordering stability |  | scale thresholds + expected response time per entity |

### `POST /cluster-variables/search` — `searchClusterVariables` (12 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| bad-request:additional-property | closed schema | ✓ | — |
| bad-request:type-mismatch | field=sort, type=array | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| filter:request-shape | filter object in body | ✓ | — |
| happy-path | documented success response | ✓ | — |
| pagination-sort:request-shape | sort array in body | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| eventual-consistency | search may lag behind writes |  | consistency window per entity (or eventually-consistent flag) |
| filter:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |
| pagination-sort:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |
| scale-large-n | behaviour at 10K+ entities; pagination limits, timeout, ordering stability |  | scale thresholds + expected response time per entity |

### `POST /correlated-message-subscriptions/search` — `searchCorrelatedMessageSubscriptions` (12 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| bad-request:additional-property | closed schema | ✓ | — |
| bad-request:type-mismatch | field=sort, type=array | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| filter:request-shape | filter object in body | ✓ | — |
| happy-path | documented success response | ✓ | — |
| pagination-sort:request-shape | sort array in body | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| eventual-consistency | search may lag behind writes |  | consistency window per entity (or eventually-consistent flag) |
| filter:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |
| pagination-sort:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |
| scale-large-n | behaviour at 10K+ entities; pagination limits, timeout, ordering stability |  | scale thresholds + expected response time per entity |

### `POST /decision-definitions/search` — `searchDecisionDefinitions` (12 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| bad-request:additional-property | closed schema | ✓ | — |
| bad-request:type-mismatch | field=sort, type=array | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| filter:request-shape | filter object in body | ✓ | — |
| happy-path | documented success response | ✓ | — |
| pagination-sort:request-shape | sort array in body | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| eventual-consistency | search may lag behind writes |  | consistency window per entity (or eventually-consistent flag) |
| filter:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |
| pagination-sort:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |
| scale-large-n | behaviour at 10K+ entities; pagination limits, timeout, ordering stability |  | scale thresholds + expected response time per entity |

### `POST /decision-instances/search` — `searchDecisionInstances` (12 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| bad-request:additional-property | closed schema | ✓ | — |
| bad-request:type-mismatch | field=sort, type=array | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| filter:request-shape | filter object in body | ✓ | — |
| happy-path | documented success response | ✓ | — |
| pagination-sort:request-shape | sort array in body | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| eventual-consistency | search may lag behind writes |  | consistency window per entity (or eventually-consistent flag) |
| filter:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |
| pagination-sort:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |
| scale-large-n | behaviour at 10K+ entities; pagination limits, timeout, ordering stability |  | scale thresholds + expected response time per entity |

### `POST /decision-requirements/search` — `searchDecisionRequirements` (12 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| bad-request:additional-property | closed schema | ✓ | — |
| bad-request:type-mismatch | field=sort, type=array | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| filter:request-shape | filter object in body | ✓ | — |
| happy-path | documented success response | ✓ | — |
| pagination-sort:request-shape | sort array in body | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| eventual-consistency | search may lag behind writes |  | consistency window per entity (or eventually-consistent flag) |
| filter:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |
| pagination-sort:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |
| scale-large-n | behaviour at 10K+ entities; pagination limits, timeout, ordering stability |  | scale thresholds + expected response time per entity |

### `POST /element-instances/{elementInstanceKey}/incidents/search` — `searchElementInstanceIncidents` (14 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=elementInstanceKey, type=string, format=ElementInstanceKey | ✓ | — |
| bad-request:additional-property | closed schema | ✓ | — |
| bad-request:type-mismatch | field=sort, type=array | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| filter:request-shape | filter object in body | ✓ | — |
| happy-path | documented success response | ✓ | — |
| pagination-sort:request-shape | sort array in body | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| eventual-consistency | search may lag behind writes |  | consistency window per entity (or eventually-consistent flag) |
| filter:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |
| pagination-sort:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |
| prerequisite-resource | 1 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |
| scale-large-n | behaviour at 10K+ entities; pagination limits, timeout, ordering stability |  | scale thresholds + expected response time per entity |

### `POST /element-instances/search` — `searchElementInstances` (12 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| bad-request:additional-property | closed schema | ✓ | — |
| bad-request:type-mismatch | field=sort, type=array | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| filter:request-shape | filter object in body | ✓ | — |
| happy-path | documented success response | ✓ | — |
| pagination-sort:request-shape | sort array in body | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| eventual-consistency | search may lag behind writes |  | consistency window per entity (or eventually-consistent flag) |
| filter:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |
| pagination-sort:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |
| scale-large-n | behaviour at 10K+ entities; pagination limits, timeout, ordering stability |  | scale thresholds + expected response time per entity |

### `POST /global-task-listeners/search` — `searchGlobalTaskListeners` (12 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| bad-request:additional-property | closed schema | ✓ | — |
| bad-request:type-mismatch | field=sort, type=array | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| filter:request-shape | filter object in body | ✓ | — |
| happy-path | documented success response | ✓ | — |
| pagination-sort:request-shape | sort array in body | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| eventual-consistency | search may lag behind writes |  | consistency window per entity (or eventually-consistent flag) |
| filter:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |
| pagination-sort:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |
| scale-large-n | behaviour at 10K+ entities; pagination limits, timeout, ordering stability |  | scale thresholds + expected response time per entity |

### `POST /tenants/{tenantId}/groups/search` — `searchGroupIdsForTenant` (11 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=tenantId, type=string, format=TenantId | ✓ | — |
| bad-request:additional-property | closed schema | ✓ | — |
| bad-request:type-mismatch | field=sort, type=array | ✓ | — |
| happy-path | documented success response | ✓ | — |
| pagination-sort:request-shape | sort array in body | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 not documented; emitter needs to know if RBAC applies |  | RBAC: permissions required per endpoint |
| eventual-consistency | search may lag behind writes |  | consistency window per entity (or eventually-consistent flag) |
| pagination-sort:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |
| prerequisite-resource | 1 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |
| scale-large-n | behaviour at 10K+ entities; pagination limits, timeout, ordering stability |  | scale thresholds + expected response time per entity |

### `POST /groups/search` — `searchGroups` (12 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| bad-request:additional-property | closed schema | ✓ | — |
| bad-request:type-mismatch | field=sort, type=array | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| filter:request-shape | filter object in body | ✓ | — |
| happy-path | documented success response | ✓ | — |
| pagination-sort:request-shape | sort array in body | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| eventual-consistency | search may lag behind writes |  | consistency window per entity (or eventually-consistent flag) |
| filter:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |
| pagination-sort:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |
| scale-large-n | behaviour at 10K+ entities; pagination limits, timeout, ordering stability |  | scale thresholds + expected response time per entity |

### `POST /roles/{roleId}/groups/search` — `searchGroupsForRole` (11 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=roleId, type=string, format=RoleId | ✓ | — |
| bad-request:type-mismatch | field=sort, type=array | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| pagination-sort:request-shape | sort array in body | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| eventual-consistency | search may lag behind writes |  | consistency window per entity (or eventually-consistent flag) |
| pagination-sort:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |
| prerequisite-resource | 1 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |
| scale-large-n | behaviour at 10K+ entities; pagination limits, timeout, ordering stability |  | scale thresholds + expected response time per entity |

### `POST /incidents/search` — `searchIncidents` (12 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| bad-request:additional-property | closed schema | ✓ | — |
| bad-request:type-mismatch | field=sort, type=array | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| filter:request-shape | filter object in body | ✓ | — |
| happy-path | documented success response | ✓ | — |
| pagination-sort:request-shape | sort array in body | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| eventual-consistency | search may lag behind writes |  | consistency window per entity (or eventually-consistent flag) |
| filter:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |
| pagination-sort:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |
| scale-large-n | behaviour at 10K+ entities; pagination limits, timeout, ordering stability |  | scale thresholds + expected response time per entity |

### `POST /jobs/search` — `searchJobs` (12 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| bad-request:additional-property | closed schema | ✓ | — |
| bad-request:type-mismatch | field=sort, type=array | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| filter:request-shape | filter object in body | ✓ | — |
| happy-path | documented success response | ✓ | — |
| pagination-sort:request-shape | sort array in body | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| eventual-consistency | search may lag behind writes |  | consistency window per entity (or eventually-consistent flag) |
| filter:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |
| pagination-sort:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |
| scale-large-n | behaviour at 10K+ entities; pagination limits, timeout, ordering stability |  | scale thresholds + expected response time per entity |

### `POST /mapping-rules/search` — `searchMappingRule` (12 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| bad-request:additional-property | closed schema | ✓ | — |
| bad-request:type-mismatch | field=sort, type=array | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| filter:request-shape | filter object in body | ✓ | — |
| happy-path | documented success response | ✓ | — |
| pagination-sort:request-shape | sort array in body | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| eventual-consistency | search may lag behind writes |  | consistency window per entity (or eventually-consistent flag) |
| filter:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |
| pagination-sort:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |
| scale-large-n | behaviour at 10K+ entities; pagination limits, timeout, ordering stability |  | scale thresholds + expected response time per entity |

### `POST /groups/{groupId}/mapping-rules/search` — `searchMappingRulesForGroup` (14 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=groupId, type=string, format=GroupId | ✓ | — |
| bad-request:additional-property | closed schema | ✓ | — |
| bad-request:type-mismatch | field=sort, type=array | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| filter:request-shape | filter object in body | ✓ | — |
| happy-path | documented success response | ✓ | — |
| pagination-sort:request-shape | sort array in body | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| eventual-consistency | search may lag behind writes |  | consistency window per entity (or eventually-consistent flag) |
| filter:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |
| pagination-sort:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |
| prerequisite-resource | 1 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |
| scale-large-n | behaviour at 10K+ entities; pagination limits, timeout, ordering stability |  | scale thresholds + expected response time per entity |

### `POST /roles/{roleId}/mapping-rules/search` — `searchMappingRulesForRole` (14 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=roleId, type=string, format=RoleId | ✓ | — |
| bad-request:additional-property | closed schema | ✓ | — |
| bad-request:type-mismatch | field=sort, type=array | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| filter:request-shape | filter object in body | ✓ | — |
| happy-path | documented success response | ✓ | — |
| pagination-sort:request-shape | sort array in body | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| eventual-consistency | search may lag behind writes |  | consistency window per entity (or eventually-consistent flag) |
| filter:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |
| pagination-sort:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |
| prerequisite-resource | 1 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |
| scale-large-n | behaviour at 10K+ entities; pagination limits, timeout, ordering stability |  | scale thresholds + expected response time per entity |

### `POST /tenants/{tenantId}/mapping-rules/search` — `searchMappingRulesForTenant` (13 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=tenantId, type=string, format=TenantId | ✓ | — |
| bad-request:additional-property | closed schema | ✓ | — |
| bad-request:type-mismatch | field=sort, type=array | ✓ | — |
| filter:request-shape | filter object in body | ✓ | — |
| happy-path | documented success response | ✓ | — |
| pagination-sort:request-shape | sort array in body | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 not documented; emitter needs to know if RBAC applies |  | RBAC: permissions required per endpoint |
| eventual-consistency | search may lag behind writes |  | consistency window per entity (or eventually-consistent flag) |
| filter:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |
| pagination-sort:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |
| prerequisite-resource | 1 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |
| scale-large-n | behaviour at 10K+ entities; pagination limits, timeout, ordering stability |  | scale thresholds + expected response time per entity |

### `POST /message-subscriptions/search` — `searchMessageSubscriptions` (12 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| bad-request:additional-property | closed schema | ✓ | — |
| bad-request:type-mismatch | field=sort, type=array | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| filter:request-shape | filter object in body | ✓ | — |
| happy-path | documented success response | ✓ | — |
| pagination-sort:request-shape | sort array in body | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| eventual-consistency | search may lag behind writes |  | consistency window per entity (or eventually-consistent flag) |
| filter:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |
| pagination-sort:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |
| scale-large-n | behaviour at 10K+ entities; pagination limits, timeout, ordering stability |  | scale thresholds + expected response time per entity |

### `POST /process-definitions/search` — `searchProcessDefinitions` (12 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| bad-request:additional-property | closed schema | ✓ | — |
| bad-request:type-mismatch | field=sort, type=array | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| filter:request-shape | filter object in body | ✓ | — |
| happy-path | documented success response | ✓ | — |
| pagination-sort:request-shape | sort array in body | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| eventual-consistency | search may lag behind writes |  | consistency window per entity (or eventually-consistent flag) |
| filter:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |
| pagination-sort:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |
| scale-large-n | behaviour at 10K+ entities; pagination limits, timeout, ordering stability |  | scale thresholds + expected response time per entity |

### `POST /process-instances/{processInstanceKey}/incidents/search` — `searchProcessInstanceIncidents` (14 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=processInstanceKey, type=string, format=ProcessInstanceKey | ✓ | — |
| bad-request:additional-property | closed schema | ✓ | — |
| bad-request:type-mismatch | field=sort, type=array | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| filter:request-shape | filter object in body | ✓ | — |
| happy-path | documented success response | ✓ | — |
| pagination-sort:request-shape | sort array in body | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| eventual-consistency | search may lag behind writes |  | consistency window per entity (or eventually-consistent flag) |
| filter:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |
| pagination-sort:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |
| prerequisite-resource | 1 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |
| scale-large-n | behaviour at 10K+ entities; pagination limits, timeout, ordering stability |  | scale thresholds + expected response time per entity |

### `POST /process-instances/search` — `searchProcessInstances` (12 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| bad-request:additional-property | closed schema | ✓ | — |
| bad-request:type-mismatch | field=sort, type=array | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| filter:request-shape | filter object in body | ✓ | — |
| happy-path | documented success response | ✓ | — |
| pagination-sort:request-shape | sort array in body | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| eventual-consistency | search may lag behind writes |  | consistency window per entity (or eventually-consistent flag) |
| filter:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |
| pagination-sort:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |
| scale-large-n | behaviour at 10K+ entities; pagination limits, timeout, ordering stability |  | scale thresholds + expected response time per entity |

### `POST /resources/search` — `searchResources` (12 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| bad-request:additional-property | closed schema | ✓ | — |
| bad-request:type-mismatch | field=sort, type=array | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| filter:request-shape | filter object in body | ✓ | — |
| happy-path | documented success response | ✓ | — |
| pagination-sort:request-shape | sort array in body | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| eventual-consistency | search may lag behind writes |  | consistency window per entity (or eventually-consistent flag) |
| filter:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |
| pagination-sort:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |
| scale-large-n | behaviour at 10K+ entities; pagination limits, timeout, ordering stability |  | scale thresholds + expected response time per entity |

### `POST /roles/search` — `searchRoles` (12 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| bad-request:additional-property | closed schema | ✓ | — |
| bad-request:type-mismatch | field=sort, type=array | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| filter:request-shape | filter object in body | ✓ | — |
| happy-path | documented success response | ✓ | — |
| pagination-sort:request-shape | sort array in body | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| eventual-consistency | search may lag behind writes |  | consistency window per entity (or eventually-consistent flag) |
| filter:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |
| pagination-sort:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |
| scale-large-n | behaviour at 10K+ entities; pagination limits, timeout, ordering stability |  | scale thresholds + expected response time per entity |

### `POST /groups/{groupId}/roles/search` — `searchRolesForGroup` (14 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=groupId, type=string, format=GroupId | ✓ | — |
| bad-request:additional-property | closed schema | ✓ | — |
| bad-request:type-mismatch | field=sort, type=array | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| filter:request-shape | filter object in body | ✓ | — |
| happy-path | documented success response | ✓ | — |
| pagination-sort:request-shape | sort array in body | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| eventual-consistency | search may lag behind writes |  | consistency window per entity (or eventually-consistent flag) |
| filter:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |
| pagination-sort:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |
| prerequisite-resource | 1 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |
| scale-large-n | behaviour at 10K+ entities; pagination limits, timeout, ordering stability |  | scale thresholds + expected response time per entity |

### `POST /tenants/{tenantId}/roles/search` — `searchRolesForTenant` (13 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=tenantId, type=string, format=TenantId | ✓ | — |
| bad-request:additional-property | closed schema | ✓ | — |
| bad-request:type-mismatch | field=sort, type=array | ✓ | — |
| filter:request-shape | filter object in body | ✓ | — |
| happy-path | documented success response | ✓ | — |
| pagination-sort:request-shape | sort array in body | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 not documented; emitter needs to know if RBAC applies |  | RBAC: permissions required per endpoint |
| eventual-consistency | search may lag behind writes |  | consistency window per entity (or eventually-consistent flag) |
| filter:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |
| pagination-sort:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |
| prerequisite-resource | 1 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |
| scale-large-n | behaviour at 10K+ entities; pagination limits, timeout, ordering stability |  | scale thresholds + expected response time per entity |

### `POST /tenants/search` — `searchTenants` (12 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| bad-request:additional-property | closed schema | ✓ | — |
| bad-request:type-mismatch | field=sort, type=array | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| filter:request-shape | filter object in body | ✓ | — |
| happy-path | documented success response | ✓ | — |
| pagination-sort:request-shape | sort array in body | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| eventual-consistency | search may lag behind writes |  | consistency window per entity (or eventually-consistent flag) |
| filter:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |
| pagination-sort:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |
| scale-large-n | behaviour at 10K+ entities; pagination limits, timeout, ordering stability |  | scale thresholds + expected response time per entity |

### `POST /user-tasks/{userTaskKey}/audit-logs/search` — `searchUserTaskAuditLogs` (15 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=userTaskKey, type=string, format=UserTaskKey | ✓ | — |
| bad-request:additional-property | closed schema | ✓ | — |
| bad-request:type-mismatch | field=sort, type=array | ✓ | — |
| bad-request:type-mismatch | field=filter, type=object | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| filter:request-shape | filter object in body | ✓ | — |
| happy-path | documented success response | ✓ | — |
| pagination-sort:request-shape | sort array in body | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 not documented; emitter needs to know if RBAC applies |  | RBAC: permissions required per endpoint |
| eventual-consistency | search may lag behind writes |  | consistency window per entity (or eventually-consistent flag) |
| filter:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |
| pagination-sort:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |
| prerequisite-resource | 1 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |
| scale-large-n | behaviour at 10K+ entities; pagination limits, timeout, ordering stability |  | scale thresholds + expected response time per entity |

### `POST /user-tasks/{userTaskKey}/effective-variables/search` — `searchUserTaskEffectiveVariables` (16 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=userTaskKey, type=string, format=UserTaskKey | ✓ | — |
| bad-request:additional-property | closed schema | ✓ | — |
| bad-request:type-mismatch | field=sort, type=array | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| filter:request-shape | filter object in body | ✓ | — |
| happy-path | documented success response | ✓ | — |
| pagination-sort:request-shape | page object in body | ✓ | — |
| pagination-sort:request-shape | sort array in body | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 not documented; emitter needs to know if RBAC applies |  | RBAC: permissions required per endpoint |
| eventual-consistency | search may lag behind writes |  | consistency window per entity (or eventually-consistent flag) |
| filter:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |
| pagination-sort:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |
| pagination-sort:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |
| prerequisite-resource | 1 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |
| scale-large-n | behaviour at 10K+ entities; pagination limits, timeout, ordering stability |  | scale thresholds + expected response time per entity |

### `POST /user-tasks/{userTaskKey}/variables/search` — `searchUserTaskVariables` (14 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=userTaskKey, type=string, format=UserTaskKey | ✓ | — |
| bad-request:additional-property | closed schema | ✓ | — |
| bad-request:type-mismatch | field=sort, type=array | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| filter:request-shape | filter object in body | ✓ | — |
| happy-path | documented success response | ✓ | — |
| pagination-sort:request-shape | sort array in body | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 not documented; emitter needs to know if RBAC applies |  | RBAC: permissions required per endpoint |
| eventual-consistency | search may lag behind writes |  | consistency window per entity (or eventually-consistent flag) |
| filter:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |
| pagination-sort:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |
| prerequisite-resource | 1 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |
| scale-large-n | behaviour at 10K+ entities; pagination limits, timeout, ordering stability |  | scale thresholds + expected response time per entity |

### `POST /user-tasks/search` — `searchUserTasks` (12 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| bad-request:additional-property | closed schema | ✓ | — |
| bad-request:type-mismatch | field=sort, type=array | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| filter:request-shape | filter object in body | ✓ | — |
| happy-path | documented success response | ✓ | — |
| pagination-sort:request-shape | sort array in body | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| eventual-consistency | search may lag behind writes |  | consistency window per entity (or eventually-consistent flag) |
| filter:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |
| pagination-sort:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |
| scale-large-n | behaviour at 10K+ entities; pagination limits, timeout, ordering stability |  | scale thresholds + expected response time per entity |

### `POST /users/search` — `searchUsers` (12 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| bad-request:additional-property | closed schema | ✓ | — |
| bad-request:type-mismatch | field=sort, type=array | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| filter:request-shape | filter object in body | ✓ | — |
| happy-path | documented success response | ✓ | — |
| pagination-sort:request-shape | sort array in body | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| eventual-consistency | search may lag behind writes |  | consistency window per entity (or eventually-consistent flag) |
| filter:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |
| pagination-sort:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |
| scale-large-n | behaviour at 10K+ entities; pagination limits, timeout, ordering stability |  | scale thresholds + expected response time per entity |

### `POST /groups/{groupId}/users/search` — `searchUsersForGroup` (11 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=groupId, type=string, format=GroupId | ✓ | — |
| bad-request:type-mismatch | field=sort, type=array | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| pagination-sort:request-shape | sort array in body | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| eventual-consistency | search may lag behind writes |  | consistency window per entity (or eventually-consistent flag) |
| pagination-sort:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |
| prerequisite-resource | 1 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |
| scale-large-n | behaviour at 10K+ entities; pagination limits, timeout, ordering stability |  | scale thresholds + expected response time per entity |

### `POST /roles/{roleId}/users/search` — `searchUsersForRole` (11 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=roleId, type=string, format=RoleId | ✓ | — |
| bad-request:type-mismatch | field=sort, type=array | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| pagination-sort:request-shape | sort array in body | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| eventual-consistency | search may lag behind writes |  | consistency window per entity (or eventually-consistent flag) |
| pagination-sort:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |
| prerequisite-resource | 1 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |
| scale-large-n | behaviour at 10K+ entities; pagination limits, timeout, ordering stability |  | scale thresholds + expected response time per entity |

### `POST /tenants/{tenantId}/users/search` — `searchUsersForTenant` (11 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=tenantId, type=string, format=TenantId | ✓ | — |
| bad-request:additional-property | closed schema | ✓ | — |
| bad-request:type-mismatch | field=sort, type=array | ✓ | — |
| happy-path | documented success response | ✓ | — |
| pagination-sort:request-shape | sort array in body | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 not documented; emitter needs to know if RBAC applies |  | RBAC: permissions required per endpoint |
| eventual-consistency | search may lag behind writes |  | consistency window per entity (or eventually-consistent flag) |
| pagination-sort:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |
| prerequisite-resource | 1 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |
| scale-large-n | behaviour at 10K+ entities; pagination limits, timeout, ordering stability |  | scale thresholds + expected response time per entity |

### `POST /variables/search` — `searchVariables` (12 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| bad-request:additional-property | closed schema | ✓ | — |
| bad-request:type-mismatch | field=sort, type=array | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| filter:request-shape | filter object in body | ✓ | — |
| happy-path | documented success response | ✓ | — |
| pagination-sort:request-shape | sort array in body | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| eventual-consistency | search may lag behind writes |  | consistency window per entity (or eventually-consistent flag) |
| filter:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |
| pagination-sort:behaviour-assertion | asserting result correctness, not just status |  | filter-field-semantics + sort-field-allowlist per entity |
| scale-large-n | behaviour at 10K+ entities; pagination limits, timeout, ordering stability |  | scale thresholds + expected response time per entity |

### `POST /batch-operations/{batchOperationKey}/suspension` — `suspendBatchOperation` (7 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=batchOperationKey, type=string, format=BatchOperationKey \| uuid | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| documented-503 | response code 503 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| prerequisite-resource | 1 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |

### `POST /jobs/{jobKey}/error` — `throwJobError` (13 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=jobKey, type=string, format=JobKey | ✓ | — |
| bad-request:additional-property | closed schema | ✓ | — |
| bad-request:missing-required | field=errorCode | ✓ | — |
| bad-request:type-mismatch | field=errorCode, type=string | ✓ | — |
| bad-request:type-mismatch | field=errorMessage, type=string | ✓ | — |
| bad-request:type-mismatch | field=variables, type=object | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| documented-503 | response code 503 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 not documented; emitter needs to know if RBAC applies |  | RBAC: permissions required per endpoint |
| business-entity-lifecycle | 409 documented on non-collection POST |  | lifecycle state machine for this entity |
| prerequisite-resource | 1 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |

### `DELETE /groups/{groupId}/clients/{clientId}` — `unassignClientFromGroup` (9 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=groupId, type=string, format=GroupId | ✓ | — |
| 404-not-found | path param=clientId, type=string, format=ClientId | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| documented-503 | response code 503 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| business-entity-lifecycle | operationId prefix `unassign` implies state transition |  | lifecycle state machine for this entity |
| prerequisite-resource | 2 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |

### `DELETE /tenants/{tenantId}/clients/{clientId}` — `unassignClientFromTenant` (9 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=tenantId, type=string, format=TenantId | ✓ | — |
| 404-not-found | path param=clientId, type=string, format=ClientId | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| documented-503 | response code 503 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| business-entity-lifecycle | operationId prefix `unassign` implies state transition |  | lifecycle state machine for this entity |
| prerequisite-resource | 2 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |

### `DELETE /tenants/{tenantId}/groups/{groupId}` — `unassignGroupFromTenant` (9 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=tenantId, type=string, format=TenantId | ✓ | — |
| 404-not-found | path param=groupId, type=string, format=GroupId | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| documented-503 | response code 503 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| business-entity-lifecycle | operationId prefix `unassign` implies state transition |  | lifecycle state machine for this entity |
| prerequisite-resource | 2 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |

### `DELETE /groups/{groupId}/mapping-rules/{mappingRuleId}` — `unassignMappingRuleFromGroup` (9 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=groupId, type=string, format=GroupId | ✓ | — |
| 404-not-found | path param=mappingRuleId, type=string, format=MappingRuleId | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| documented-503 | response code 503 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| business-entity-lifecycle | operationId prefix `unassign` implies state transition |  | lifecycle state machine for this entity |
| prerequisite-resource | 2 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |

### `DELETE /tenants/{tenantId}/mapping-rules/{mappingRuleId}` — `unassignMappingRuleFromTenant` (9 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=tenantId, type=string, format=TenantId | ✓ | — |
| 404-not-found | path param=mappingRuleId, type=string, format=MappingRuleId | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| documented-503 | response code 503 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| business-entity-lifecycle | operationId prefix `unassign` implies state transition |  | lifecycle state machine for this entity |
| prerequisite-resource | 2 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |

### `DELETE /roles/{roleId}/clients/{clientId}` — `unassignRoleFromClient` (9 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=roleId, type=string, format=RoleId | ✓ | — |
| 404-not-found | path param=clientId, type=string, format=ClientId | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| documented-503 | response code 503 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| business-entity-lifecycle | operationId prefix `unassign` implies state transition |  | lifecycle state machine for this entity |
| prerequisite-resource | 2 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |

### `DELETE /roles/{roleId}/groups/{groupId}` — `unassignRoleFromGroup` (9 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=roleId, type=string, format=RoleId | ✓ | — |
| 404-not-found | path param=groupId, type=string, format=GroupId | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| documented-503 | response code 503 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| business-entity-lifecycle | operationId prefix `unassign` implies state transition |  | lifecycle state machine for this entity |
| prerequisite-resource | 2 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |

### `DELETE /roles/{roleId}/mapping-rules/{mappingRuleId}` — `unassignRoleFromMappingRule` (9 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=roleId, type=string, format=RoleId | ✓ | — |
| 404-not-found | path param=mappingRuleId, type=string, format=MappingRuleId | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| documented-503 | response code 503 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| business-entity-lifecycle | operationId prefix `unassign` implies state transition |  | lifecycle state machine for this entity |
| prerequisite-resource | 2 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |

### `DELETE /tenants/{tenantId}/roles/{roleId}` — `unassignRoleFromTenant` (9 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=tenantId, type=string, format=TenantId | ✓ | — |
| 404-not-found | path param=roleId, type=string, format=RoleId | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| documented-503 | response code 503 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| business-entity-lifecycle | operationId prefix `unassign` implies state transition |  | lifecycle state machine for this entity |
| prerequisite-resource | 2 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |

### `DELETE /roles/{roleId}/users/{username}` — `unassignRoleFromUser` (9 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=roleId, type=string, format=RoleId | ✓ | — |
| 404-not-found | path param=username, type=string, format=Username | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| documented-503 | response code 503 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| business-entity-lifecycle | operationId prefix `unassign` implies state transition |  | lifecycle state machine for this entity |
| prerequisite-resource | 2 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |

### `DELETE /groups/{groupId}/users/{username}` — `unassignUserFromGroup` (9 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=groupId, type=string, format=GroupId | ✓ | — |
| 404-not-found | path param=username, type=string, format=Username | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| documented-503 | response code 503 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| business-entity-lifecycle | operationId prefix `unassign` implies state transition |  | lifecycle state machine for this entity |
| prerequisite-resource | 2 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |

### `DELETE /tenants/{tenantId}/users/{username}` — `unassignUserFromTenant` (9 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=tenantId, type=string, format=TenantId | ✓ | — |
| 404-not-found | path param=username, type=string, format=Username | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| documented-503 | response code 503 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| business-entity-lifecycle | operationId prefix `unassign` implies state transition |  | lifecycle state machine for this entity |
| prerequisite-resource | 2 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |

### `DELETE /user-tasks/{userTaskKey}/assignee` — `unassignUserTask` (9 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=userTaskKey, type=string, format=UserTaskKey | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| documented-503 | response code 503 documented in spec | ✓ | — |
| documented-504 | response code 504 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 not documented; emitter needs to know if RBAC applies |  | RBAC: permissions required per endpoint |
| business-entity-lifecycle | operationId prefix `unassign` implies state transition |  | lifecycle state machine for this entity |
| prerequisite-resource | 1 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |

### `PATCH /agent-instances/{agentInstanceKey}` — `updateAgentInstance` (7 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=agentInstanceKey, type=string, format=AgentInstanceKey | ✓ | — |
| bad-request:type-mismatch | field=tools, type=array | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| prerequisite-resource | 1 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |

### `PUT /authorizations/{authorizationKey}` — `updateAuthorization` (9 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=authorizationKey, type=string, format=AuthorizationKey | ✓ | — |
| bad-request:oneof-violation | oneOf branches=2 | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| documented-503 | response code 503 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 not documented; emitter needs to know if RBAC applies |  | RBAC: permissions required per endpoint |
| 409-conflict | create-or-replace with same identifier |  | duplicatePolicy per endpoint (idempotent \| conflict \| replace) |
| prerequisite-resource | 1 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |

### `PUT /cluster-variables/global/{name}` — `updateGlobalClusterVariable` (9 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=name, type=string, format=ClusterVariableName | ✓ | — |
| bad-request:missing-required | field=value | ✓ | — |
| bad-request:type-mismatch | field=value, type=object | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| 409-conflict | create-or-replace with same identifier |  | duplicatePolicy per endpoint (idempotent \| conflict \| replace) |
| prerequisite-resource | 1 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |

### `PUT /global-task-listeners/{id}` — `updateGlobalTaskListener` (10 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=id, type=string, format=GlobalListenerId | ✓ | — |
| bad-request:missing-required | field=type | ✓ | — |
| bad-request:missing-required | field=eventTypes | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| documented-503 | response code 503 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| 409-conflict | create-or-replace with same identifier |  | duplicatePolicy per endpoint (idempotent \| conflict \| replace) |
| prerequisite-resource | 1 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |

### `PUT /groups/{groupId}` — `updateGroup` (11 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=groupId, type=string, format=GroupId | ✓ | — |
| bad-request:missing-required | field=name | ✓ | — |
| bad-request:type-mismatch | field=name, type=string | ✓ | — |
| bad-request:type-mismatch | field=description, type=string | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| documented-503 | response code 503 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 not documented; emitter needs to know if RBAC applies |  | RBAC: permissions required per endpoint |
| 409-conflict | create-or-replace with same identifier |  | duplicatePolicy per endpoint (idempotent \| conflict \| replace) |
| prerequisite-resource | 1 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |

### `PATCH /jobs/{jobKey}` — `updateJob` (13 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=jobKey, type=string, format=JobKey | ✓ | — |
| bad-request:additional-property | closed schema | ✓ | — |
| bad-request:format-invalid | field=operationReference, format=int64 | ✓ | — |
| bad-request:missing-required | field=changeset | ✓ | — |
| bad-request:range-violation | field=operationReference | ✓ | — |
| bad-request:type-mismatch | field=changeset, type=object | ✓ | — |
| bad-request:type-mismatch | field=operationReference, type=integer | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| documented-503 | response code 503 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 not documented; emitter needs to know if RBAC applies |  | RBAC: permissions required per endpoint |
| prerequisite-resource | 1 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |

### `PUT /mapping-rules/{mappingRuleId}` — `updateMappingRule` (8 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=mappingRuleId, type=string, format=MappingRuleId | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| documented-503 | response code 503 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| 409-conflict | create-or-replace with same identifier |  | duplicatePolicy per endpoint (idempotent \| conflict \| replace) |
| prerequisite-resource | 1 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |

### `PUT /roles/{roleId}` — `updateRole` (11 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=roleId, type=string, format=RoleId | ✓ | — |
| bad-request:missing-required | field=name | ✓ | — |
| bad-request:type-mismatch | field=name, type=string | ✓ | — |
| bad-request:type-mismatch | field=description, type=string | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| documented-503 | response code 503 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 not documented; emitter needs to know if RBAC applies |  | RBAC: permissions required per endpoint |
| 409-conflict | create-or-replace with same identifier |  | duplicatePolicy per endpoint (idempotent \| conflict \| replace) |
| prerequisite-resource | 1 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |

### `PUT /tenants/{tenantId}` — `updateTenant` (12 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=tenantId, type=string, format=TenantId | ✓ | — |
| bad-request:additional-property | closed schema | ✓ | — |
| bad-request:missing-required | field=name | ✓ | — |
| bad-request:type-mismatch | field=name, type=string | ✓ | — |
| bad-request:type-mismatch | field=description, type=string | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| documented-503 | response code 503 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| 409-conflict | create-or-replace with same identifier |  | duplicatePolicy per endpoint (idempotent \| conflict \| replace) |
| prerequisite-resource | 1 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |

### `PUT /cluster-variables/tenants/{tenantId}/{name}` — `updateTenantClusterVariable` (10 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=tenantId, type=string, format=TenantId | ✓ | — |
| 404-not-found | path param=name, type=string, format=ClusterVariableName | ✓ | — |
| bad-request:missing-required | field=value | ✓ | — |
| bad-request:type-mismatch | field=value, type=object | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| 409-conflict | create-or-replace with same identifier |  | duplicatePolicy per endpoint (idempotent \| conflict \| replace) |
| prerequisite-resource | 2 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |

### `PUT /users/{username}` — `updateUser` (11 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=username, type=string, format=Username | ✓ | — |
| bad-request:type-mismatch | field=password, type=string | ✓ | — |
| bad-request:type-mismatch | field=name, type=string | ✓ | — |
| bad-request:type-mismatch | field=email, type=string | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| documented-503 | response code 503 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 documented in spec |  | RBAC: permissions required per endpoint |
| 409-conflict | create-or-replace with same identifier |  | duplicatePolicy per endpoint (idempotent \| conflict \| replace) |
| prerequisite-resource | 1 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |

### `PATCH /user-tasks/{userTaskKey}` — `updateUserTask` (11 items)

| kind | detail | computable | needed ABox fact |
|---|---|:-:|---|
| 404-not-found | path param=userTaskKey, type=string, format=UserTaskKey | ✓ | — |
| bad-request:additional-property | closed schema | ✓ | — |
| bad-request:type-mismatch | field=changeset, type=object | ✓ | — |
| bad-request:type-mismatch | field=action, type=string | ✓ | — |
| documented-500 | response code 500 documented in spec | ✓ | — |
| documented-503 | response code 503 documented in spec | ✓ | — |
| documented-504 | response code 504 documented in spec | ✓ | — |
| happy-path | documented success response | ✓ | — |
| 401-unauthorized | spec declares securitySchemes but does not apply them |  | spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec) |
| 403-forbidden | 403 not documented; emitter needs to know if RBAC applies |  | RBAC: permissions required per endpoint |
| prerequisite-resource | 1 path param(s) imply a referenced resource |  | creation chain per identifier semantic-type |

