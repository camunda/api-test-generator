# Coverage gaps (heuristic)

Computed across **518** generated test declarations in **37** entities.

## Entities missing delete-then-observe-absence variant

Entities that have both `create` and `delete` tests but no test tagged `observe-absence` (no negative-after-delete check).

- **clock** — has create+delete but no `observe-absence` test
- **document** — has create+delete but no `observe-absence` test

## Entities with no unauthorized (401) coverage

- agent-instance
- audit-log
- authentication
- authorization
- batch-operation
- batch-operation-item
- clock
- cluster-variables
- conditional
- correlated-message-subscription
- decision-definition
- decision-instance
- decision-requirements
- document
- element-instance
- expression
- global-task-listener
- group
- incident
- job
- license
- mapping-rule
- message
- message-subscriptions
- process-definition
- process-instance
- resource
- role
- setup
- signal
- status
- system
- tenant
- topology
- user
- user-task
- variable

## Entities with no forbidden (403) coverage

- agent-instance
- audit-log
- authentication
- authorization
- batch-operation
- batch-operation-item
- clock
- cluster-variables
- conditional
- correlated-message-subscription
- decision-definition
- decision-instance
- decision-requirements
- document
- element-instance
- expression
- global-task-listener
- group
- incident
- job
- license
- mapping-rule
- message
- message-subscriptions
- process-definition
- process-instance
- resource
- role
- setup
- signal
- status
- system
- tenant
- topology
- user
- user-task
- variable

## Entities with no bad-request (400) coverage

- agent-instance
- audit-log
- authentication
- authorization
- batch-operation
- batch-operation-item
- clock
- cluster-variables
- conditional
- correlated-message-subscription
- decision-definition
- decision-instance
- decision-requirements
- document
- element-instance
- expression
- global-task-listener
- group
- incident
- job
- license
- mapping-rule
- message
- message-subscriptions
- process-definition
- process-instance
- resource
- role
- setup
- signal
- status
- system
- tenant
- topology
- user
- user-task
- variable

## Entities with no not-found (404) coverage

- agent-instance
- audit-log
- authentication
- authorization
- batch-operation
- batch-operation-item
- clock
- cluster-variables
- conditional
- correlated-message-subscription
- decision-definition
- decision-instance
- decision-requirements
- document
- element-instance
- expression
- global-task-listener
- group
- incident
- job
- license
- mapping-rule
- message
- message-subscriptions
- process-definition
- process-instance
- resource
- role
- setup
- signal
- status
- system
- tenant
- topology
- user
- user-task
- variable

## Entities with no conflict (409) coverage

- agent-instance
- audit-log
- authentication
- authorization
- batch-operation
- batch-operation-item
- clock
- cluster-variables
- conditional
- correlated-message-subscription
- decision-definition
- decision-instance
- decision-requirements
- document
- element-instance
- expression
- global-task-listener
- group
- incident
- job
- license
- mapping-rule
- message
- message-subscriptions
- process-definition
- process-instance
- resource
- role
- setup
- signal
- status
- system
- tenant
- topology
- user
- user-task
- variable

## Search ops with no pagination/sort or filter coverage

Search operations that have tests but none labeled `pagination-sort` or `filter`.

- agent-instance (search): no pagination-sort/filter labels
- audit-log (search): no pagination-sort/filter labels
- authorization (search): no pagination-sort/filter labels
- batch-operation (search): no pagination-sort/filter labels
- batch-operation-item (search): no pagination-sort/filter labels
- cluster-variables (search): no pagination-sort/filter labels
- correlated-message-subscription (search): no pagination-sort/filter labels
- decision-definition (search): no pagination-sort/filter labels
- decision-instance (search): no pagination-sort/filter labels
- decision-requirements (search): no pagination-sort/filter labels
- element-instance (search): no pagination-sort/filter labels
- global-task-listener (search): no pagination-sort/filter labels
- group (search): no pagination-sort/filter labels
- incident (search): no pagination-sort/filter labels
- job (search): no pagination-sort/filter labels
- mapping-rule (search): no pagination-sort/filter labels
- message-subscriptions (search): no pagination-sort/filter labels
- process-definition (search): no pagination-sort/filter labels
- process-instance (search): no pagination-sort/filter labels
- resource (search): no pagination-sort/filter labels
- role (search): no pagination-sort/filter labels
- tenant (search): no pagination-sort/filter labels
- user (search): no pagination-sort/filter labels
- user-task (search): no pagination-sort/filter labels
- variable (search): no pagination-sort/filter labels
