# Coverage gaps (heuristic)

Computed across **1617** generated test declarations in **37** entities.

## Entities missing delete-then-observe-absence variant

Entities that have both `create` and `delete` tests but no test tagged `observe-absence` (no negative-after-delete check).

- _(none)_

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

- authentication
- license
- status
- topology

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

