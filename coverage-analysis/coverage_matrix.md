# api-test-generator — Coverage matrix (entity × operation × variant)

Total test declarations: **1596** across **37** entities.

Variants are multi-label — a test can carry more than one tag, so matrix columns are **not** mutually exclusive (a lifecycle test tagged `happy-path|observe-absence` counts in both columns, but only once in `total`). Labels come from three sources: (1) test-name suffix (`base` → `happy-path`, `negative empty` → `observe-absence`, `bpmn`/`dmn`/`drd`/`form`/`path`/`cycle/...`/`oneOf ...` → `data-driven`, `variant-N - scenario` → `unlabeled`), (2) test-body shape (`page: {` / `sort: [` → `pagination-sort`, `filter: {` → `filter`), and (3) for the lifecycle emitters a fixed `happy-path|observe-absence`, while each request-validation test is bucketed by its asserted HTTP status (400 → `bad-request`, 404 → `not-found`, 403 → `forbidden`, 401 → `unauthorized`, 409 → `conflict`). See `build_coverage.py` for the rule table.

Legend: ✓ = at least 1, blank = 0.

## At-a-glance presence (✓ = ≥1 test)

| entity | op | total | happy | bad-req | 401 | 403 | 404 | conflict | pagin/sort | filter | absence | data-driven | unlabeled |
|--|--|--:|--|--|--|--|--|--|--|--|--|--|--|
| process-instance | create | 14 | ✓ | ✓ |  |  |  |  |  |  |  | ✓ |  |
| process-instance | get | 9 | ✓ | ✓ |  |  | ✓ |  |  |  |  |  |  |
| process-instance | update | 148 | ✓ | ✓ |  |  |  |  |  | ✓ |  | ✓ |  |
| process-instance | delete | 73 | ✓ | ✓ |  |  |  |  |  | ✓ |  | ✓ |  |
| process-instance | search | 38 | ✓ | ✓ |  |  |  |  | ✓ | ✓ | ✓ | ✓ |  |
| process-instance | lifecycle | 1 | ✓ |  |  |  |  |  |  |  |  |  |  |
| job | create | 32 | ✓ | ✓ |  |  |  |  |  |  | ✓ | ✓ |  |
| job | get | 67 | ✓ | ✓ |  |  |  |  | ✓ | ✓ |  | ✓ |  |
| job | update | 30 | ✓ | ✓ |  |  |  |  |  |  |  | ✓ |  |
| job | search | 13 | ✓ | ✓ |  |  |  |  | ✓ | ✓ | ✓ | ✓ |  |
| tenant | create | 14 |  | ✓ |  |  |  |  |  |  |  |  |  |
| tenant | get | 3 |  | ✓ |  | ✓ | ✓ |  |  |  |  |  |  |
| tenant | update | 18 | ✓ | ✓ |  |  |  |  |  |  |  |  |  |
| tenant | delete | 11 |  | ✓ |  |  |  |  |  |  |  |  |  |
| tenant | search | 52 | ✓ | ✓ |  |  |  |  | ✓ | ✓ | ✓ | ✓ |  |
| tenant | lifecycle | 6 | ✓ |  |  |  |  |  |  |  | ✓ |  |  |
| role | create | 13 |  | ✓ |  |  |  |  |  |  |  |  |  |
| role | get | 3 |  | ✓ |  | ✓ | ✓ |  |  |  |  |  |  |
| role | update | 16 | ✓ | ✓ |  |  |  |  |  |  |  |  |  |
| role | delete | 9 |  | ✓ |  |  |  |  |  |  |  |  |  |
| role | search | 43 | ✓ | ✓ |  |  |  |  | ✓ | ✓ | ✓ | ✓ |  |
| role | lifecycle | 5 | ✓ |  |  |  |  |  |  |  | ✓ |  |  |
| group | create | 12 |  | ✓ |  |  |  |  |  |  |  |  |  |
| group | get | 3 |  | ✓ |  | ✓ | ✓ |  |  |  |  |  |  |
| group | update | 14 | ✓ | ✓ |  |  |  |  |  |  |  |  |  |
| group | delete | 7 |  | ✓ |  |  |  |  |  |  |  |  |  |
| group | search | 44 | ✓ | ✓ |  |  |  |  | ✓ | ✓ | ✓ | ✓ |  |
| group | lifecycle | 4 | ✓ |  |  |  |  |  |  |  | ✓ |  |  |
| process-definition | get | 62 | ✓ | ✓ |  |  | ✓ |  | ✓ | ✓ |  | ✓ |  |
| process-definition | search | 11 | ✓ | ✓ |  |  |  |  | ✓ | ✓ | ✓ | ✓ |  |
| decision-instance | get | 2 | ✓ | ✓ |  |  |  |  |  |  |  |  |  |
| decision-instance | delete | 50 | ✓ | ✓ |  |  |  |  |  | ✓ |  | ✓ |  |
| decision-instance | search | 20 | ✓ | ✓ |  |  |  |  | ✓ | ✓ | ✓ | ✓ |  |
| user-task | get | 8 | ✓ | ✓ |  |  | ✓ |  |  |  |  |  |  |
| user-task | update | 11 | ✓ | ✓ |  |  |  |  |  | ✓ |  |  |  |
| user-task | delete | 2 | ✓ | ✓ |  |  |  |  |  |  |  |  |  |
| user-task | search | 48 | ✓ | ✓ |  |  |  |  | ✓ | ✓ | ✓ | ✓ |  |
| user-task | lifecycle | 2 | ✓ |  |  |  |  |  |  |  |  |  |  |
| cluster-variables | create | 25 |  | ✓ |  |  |  |  |  |  |  |  |  |
| cluster-variables | get | 6 |  | ✓ |  | ✓ | ✓ |  |  |  |  |  |  |
| cluster-variables | update | 13 | ✓ | ✓ |  |  |  |  |  |  |  |  |  |
| cluster-variables | delete | 3 |  | ✓ |  |  |  |  |  |  |  |  |  |
| cluster-variables | search | 10 | ✓ | ✓ |  |  |  |  | ✓ |  | ✓ | ✓ |  |
| cluster-variables | lifecycle | 2 | ✓ |  |  |  |  |  |  |  | ✓ |  |  |
| element-instance | create | 19 | ✓ | ✓ |  |  |  |  |  |  |  | ✓ |  |
| element-instance | get | 3 | ✓ | ✓ |  |  | ✓ |  |  |  |  |  |  |
| element-instance | search | 35 | ✓ | ✓ |  |  |  |  | ✓ | ✓ | ✓ | ✓ |  |
| agent-instance | create | 22 | ✓ | ✓ |  |  |  |  |  |  |  |  |  |
| agent-instance | get | 3 | ✓ | ✓ |  |  | ✓ |  |  |  |  |  |  |
| agent-instance | update | 11 | ✓ | ✓ |  |  |  |  |  |  |  |  |  |
| agent-instance | search | 14 | ✓ | ✓ |  |  |  |  | ✓ | ✓ | ✓ | ✓ |  |
| mapping-rule | create | 20 |  | ✓ |  |  |  |  |  |  |  |  |  |
| mapping-rule | get | 3 |  | ✓ |  | ✓ | ✓ |  |  |  |  |  |  |
| mapping-rule | update | 13 | ✓ | ✓ |  |  |  |  |  |  |  |  |  |
| mapping-rule | delete | 1 |  | ✓ |  |  |  |  |  |  |  |  |  |
| mapping-rule | search | 10 | ✓ | ✓ |  |  |  |  | ✓ | ✓ | ✓ | ✓ |  |
| mapping-rule | lifecycle | 1 | ✓ |  |  |  |  |  |  |  | ✓ |  |  |
| global-task-listener | create | 21 |  | ✓ |  |  |  |  |  |  |  |  |  |
| global-task-listener | get | 3 |  | ✓ |  | ✓ | ✓ |  |  |  |  |  |  |
| global-task-listener | update | 12 | ✓ | ✓ |  |  |  |  |  |  |  |  |  |
| global-task-listener | delete | 1 |  | ✓ |  |  |  |  |  |  |  |  |  |
| global-task-listener | search | 9 | ✓ | ✓ |  |  |  |  | ✓ |  | ✓ | ✓ |  |
| global-task-listener | lifecycle | 1 | ✓ |  |  |  |  |  |  |  | ✓ |  |  |
| resource | create | 12 |  | ✓ |  |  |  |  |  |  |  | ✓ |  |
| resource | get | 6 | ✓ |  |  |  | ✓ |  |  |  |  |  |  |
| resource | delete | 8 | ✓ | ✓ |  |  |  |  |  |  |  |  |  |
| resource | search | 15 | ✓ | ✓ |  |  |  |  | ✓ | ✓ | ✓ | ✓ | ✓ |
| incident | get | 19 | ✓ | ✓ |  |  | ✓ |  |  | ✓ |  |  |  |
| incident | update | 8 |  | ✓ |  |  |  |  |  |  |  |  |  |
| incident | search | 13 | ✓ | ✓ |  |  |  |  | ✓ | ✓ | ✓ | ✓ |  |
| incident | lifecycle | 1 | ✓ |  |  |  |  |  |  |  |  |  |  |
| authorization | create | 7 |  | ✓ |  |  |  |  |  |  |  |  |  |
| authorization | get | 2 |  | ✓ |  |  | ✓ |  |  |  |  |  |  |
| authorization | update | 11 | ✓ | ✓ |  |  |  |  |  |  |  | ✓ |  |
| authorization | delete | 1 |  | ✓ |  |  |  |  |  |  |  |  |  |
| authorization | search | 11 | ✓ | ✓ |  |  |  |  | ✓ |  | ✓ | ✓ |  |
| authorization | lifecycle | 1 | ✓ |  |  |  |  |  |  |  | ✓ |  |  |
| user | create | 14 |  | ✓ |  |  |  |  |  |  |  |  |  |
| user | get | 3 |  | ✓ |  | ✓ | ✓ |  |  |  |  |  |  |
| user | update | 5 | ✓ | ✓ |  |  |  |  |  |  |  |  |  |
| user | delete | 1 |  | ✓ |  |  |  |  |  |  |  |  |  |
| user | search | 9 | ✓ | ✓ |  |  |  |  | ✓ |  | ✓ | ✓ |  |
| user | lifecycle | 1 | ✓ |  |  |  |  |  |  |  | ✓ |  |  |
| message | create | 30 | ✓ | ✓ |  |  |  |  |  |  |  | ✓ |  |
| decision-definition | create | 11 | ✓ | ✓ |  |  |  |  |  |  |  | ✓ |  |
| decision-definition | get | 6 | ✓ | ✓ |  |  | ✓ |  |  |  |  |  |  |
| decision-definition | search | 13 | ✓ | ✓ |  |  |  |  | ✓ | ✓ | ✓ | ✓ |  |
| audit-log | get | 3 | ✓ | ✓ |  |  | ✓ |  |  |  |  |  |  |
| audit-log | search | 25 | ✓ | ✓ |  |  |  |  | ✓ | ✓ | ✓ | ✓ | ✓ |
| variable | get | 3 | ✓ | ✓ |  |  | ✓ |  |  |  |  |  |  |
| variable | search | 16 | ✓ | ✓ |  |  |  |  | ✓ | ✓ | ✓ | ✓ |  |
| document | create | 15 | ✓ | ✓ |  |  |  |  |  |  |  | ✓ |  |
| document | get | 1 |  |  |  |  | ✓ |  |  |  |  |  |  |
| document | lifecycle | 1 | ✓ |  |  |  |  |  |  |  | ✓ |  |  |
| decision-requirements | get | 6 | ✓ | ✓ |  |  | ✓ |  |  |  |  |  |  |
| decision-requirements | search | 11 | ✓ | ✓ |  |  |  |  | ✓ | ✓ | ✓ | ✓ |  |
| batch-operation | get | 2 | ✓ |  |  |  | ✓ |  |  |  |  |  |  |
| batch-operation | update | 2 | ✓ |  |  |  |  |  |  | ✓ |  |  |  |
| batch-operation | delete | 1 | ✓ |  |  |  |  |  |  | ✓ |  |  |  |
| batch-operation | search | 10 | ✓ | ✓ |  |  |  |  | ✓ |  | ✓ | ✓ |  |
| setup | create | 15 | ✓ | ✓ |  |  |  |  |  |  |  |  |  |
| conditional | create | 15 | ✓ | ✓ |  |  |  |  |  |  |  | ✓ |  |
| signal | create | 14 | ✓ | ✓ |  |  |  |  |  |  |  | ✓ |  |
| correlated-message-subscription | search | 13 | ✓ | ✓ |  |  |  |  | ✓ | ✓ | ✓ | ✓ |  |
| message-subscriptions | search | 13 | ✓ | ✓ |  |  |  |  | ✓ | ✓ | ✓ | ✓ |  |
| expression | create | 12 | ✓ | ✓ |  |  |  |  |  | ✓ |  | ✓ |  |
| batch-operation-item | search | 10 | ✓ | ✓ |  |  |  |  | ✓ | ✓ | ✓ | ✓ |  |
| system | get | 9 | ✓ | ✓ |  |  |  |  |  |  |  |  |  |
| clock | create | 7 | ✓ | ✓ |  |  |  |  |  |  |  |  |  |
| clock | update | 1 | ✓ |  |  |  |  |  |  |  |  |  |  |
| authentication | get | 1 | ✓ |  |  |  |  |  |  |  |  |  |  |
| license | get | 1 | ✓ |  |  |  |  |  |  |  |  |  |  |
| status | get | 1 | ✓ |  |  |  |  |  |  |  |  |  |  |
| topology | get | 1 | ✓ |  |  |  |  |  |  |  |  |  |  |

## Counts per cell

| entity | op | total | happy | bad-req | 401 | 403 | 404 | conflict | pagin/sort | filter | absence | data-driven | unlabeled |
|--|--|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| process-instance | create | 14 | 1 | 6 |  |  |  |  |  |  |  | 7 |  |
| process-instance | get | 9 | 3 | 4 |  |  | 2 |  |  |  |  |  |  |
| process-instance | update | 148 | 6 | 98 |  |  |  |  |  | 37 |  | 44 |  |
| process-instance | delete | 73 | 3 | 50 |  |  |  |  |  | 22 |  | 20 |  |
| process-instance | search | 38 | 2 | 17 |  |  |  |  | 4 | 14 | 1 | 18 |  |
| process-instance | lifecycle | 1 | 1 |  |  |  |  |  |  |  |  |  |  |
| job | create | 32 | 2 | 28 |  |  |  |  |  |  | 1 | 1 |  |
| job | get | 67 | 5 | 58 |  |  |  |  | 4 | 6 |  | 4 |  |
| job | update | 30 | 3 | 24 |  |  |  |  |  |  |  | 3 |  |
| job | search | 13 | 1 | 5 |  |  |  |  | 2 | 4 | 1 | 6 |  |
| tenant | create | 14 |  | 14 |  |  |  |  |  |  |  |  |  |
| tenant | get | 3 |  | 1 |  | 1 | 1 |  |  |  |  |  |  |
| tenant | update | 18 | 1 | 17 |  |  |  |  |  |  |  |  |  |
| tenant | delete | 11 |  | 11 |  |  |  |  |  |  |  |  |  |
| tenant | search | 52 | 1 | 35 |  |  |  |  | 12 | 3 | 1 | 15 |  |
| tenant | lifecycle | 6 | 6 |  |  |  |  |  |  |  | 6 |  |  |
| role | create | 13 |  | 13 |  |  |  |  |  |  |  |  |  |
| role | get | 3 |  | 1 |  | 1 | 1 |  |  |  |  |  |  |
| role | update | 16 | 1 | 15 |  |  |  |  |  |  |  |  |  |
| role | delete | 9 |  | 9 |  |  |  |  |  |  |  |  |  |
| role | search | 43 | 1 | 29 |  |  |  |  | 10 | 2 | 1 | 12 |  |
| role | lifecycle | 5 | 5 |  |  |  |  |  |  |  | 5 |  |  |
| group | create | 12 |  | 12 |  |  |  |  |  |  |  |  |  |
| group | get | 3 |  | 1 |  | 1 | 1 |  |  |  |  |  |  |
| group | update | 14 | 1 | 13 |  |  |  |  |  |  |  |  |  |
| group | delete | 7 |  | 7 |  |  |  |  |  |  |  |  |  |
| group | search | 44 | 2 | 29 |  |  |  |  | 10 | 2 | 1 | 12 |  |
| group | lifecycle | 4 | 4 |  |  |  |  |  |  |  | 4 |  |  |
| process-definition | get | 62 | 7 | 38 |  |  | 3 |  | 1 | 14 |  | 14 |  |
| process-definition | search | 11 | 1 | 5 |  |  |  |  | 2 | 2 | 1 | 4 |  |
| decision-instance | get | 2 | 1 | 1 |  |  |  |  |  |  |  |  |  |
| decision-instance | delete | 50 | 2 | 38 |  |  |  |  |  | 11 |  | 10 |  |
| decision-instance | search | 20 | 1 | 6 |  |  |  |  | 2 | 10 | 1 | 12 |  |
| user-task | get | 8 | 2 | 3 |  |  | 3 |  |  |  |  |  |  |
| user-task | update | 11 | 1 | 10 |  |  |  |  |  | 1 |  |  |  |
| user-task | delete | 2 | 1 | 1 |  |  |  |  |  |  |  |  |  |
| user-task | search | 48 | 4 | 30 |  |  |  |  | 6 | 14 | 1 | 13 |  |
| user-task | lifecycle | 2 | 2 |  |  |  |  |  |  |  |  |  |  |
| cluster-variables | create | 25 |  | 25 |  |  |  |  |  |  |  |  |  |
| cluster-variables | get | 6 |  | 3 |  | 1 | 2 |  |  |  |  |  |  |
| cluster-variables | update | 13 | 2 | 11 |  |  |  |  |  |  |  |  |  |
| cluster-variables | delete | 3 |  | 3 |  |  |  |  |  |  |  |  |  |
| cluster-variables | search | 10 | 1 | 6 |  |  |  |  | 2 |  | 1 | 2 |  |
| cluster-variables | lifecycle | 2 | 2 |  |  |  |  |  |  |  | 2 |  |  |
| element-instance | create | 19 | 2 | 16 |  |  |  |  |  |  |  | 1 |  |
| element-instance | get | 3 | 1 | 1 |  |  | 1 |  |  |  |  |  |  |
| element-instance | search | 35 | 2 | 13 |  |  |  |  | 4 | 13 | 1 | 19 |  |
| agent-instance | create | 22 | 1 | 21 |  |  |  |  |  |  |  |  |  |
| agent-instance | get | 3 | 1 | 1 |  |  | 1 |  |  |  |  |  |  |
| agent-instance | update | 11 | 1 | 10 |  |  |  |  |  |  |  |  |  |
| agent-instance | search | 14 | 1 | 5 |  |  |  |  | 2 | 5 | 1 | 7 |  |
| mapping-rule | create | 20 |  | 20 |  |  |  |  |  |  |  |  |  |
| mapping-rule | get | 3 |  | 1 |  | 1 | 1 |  |  |  |  |  |  |
| mapping-rule | update | 13 | 1 | 12 |  |  |  |  |  |  |  |  |  |
| mapping-rule | delete | 1 |  | 1 |  |  |  |  |  |  |  |  |  |
| mapping-rule | search | 10 | 1 | 5 |  |  |  |  | 2 | 1 | 1 | 3 |  |
| mapping-rule | lifecycle | 1 | 1 |  |  |  |  |  |  |  | 1 |  |  |
| global-task-listener | create | 21 |  | 21 |  |  |  |  |  |  |  |  |  |
| global-task-listener | get | 3 |  | 1 |  | 1 | 1 |  |  |  |  |  |  |
| global-task-listener | update | 12 | 1 | 11 |  |  |  |  |  |  |  |  |  |
| global-task-listener | delete | 1 |  | 1 |  |  |  |  |  |  |  |  |  |
| global-task-listener | search | 9 | 1 | 5 |  |  |  |  | 2 |  | 1 | 2 |  |
| global-task-listener | lifecycle | 1 | 1 |  |  |  |  |  |  |  | 1 |  |  |
| resource | create | 12 |  | 7 |  |  |  |  |  |  |  | 5 |  |
| resource | get | 6 | 3 |  |  |  | 3 |  |  |  |  |  |  |
| resource | delete | 8 | 1 | 7 |  |  |  |  |  |  |  |  |  |
| resource | search | 15 | 1 | 5 |  |  |  |  | 2 | 6 | 1 | 7 | 1 |
| incident | get | 19 | 2 | 16 |  |  | 1 |  |  | 1 |  |  |  |
| incident | update | 8 |  | 8 |  |  |  |  |  |  |  |  |  |
| incident | search | 13 | 1 | 5 |  |  |  |  | 2 | 4 | 1 | 6 |  |
| incident | lifecycle | 1 | 1 |  |  |  |  |  |  |  |  |  |  |
| authorization | create | 7 |  | 7 |  |  |  |  |  |  |  |  |  |
| authorization | get | 2 |  | 1 |  |  | 1 |  |  |  |  |  |  |
| authorization | update | 11 | 1 | 8 |  |  |  |  |  |  |  | 2 |  |
| authorization | delete | 1 |  | 1 |  |  |  |  |  |  |  |  |  |
| authorization | search | 11 | 1 | 7 |  |  |  |  | 2 |  | 1 | 2 |  |
| authorization | lifecycle | 1 | 1 |  |  |  |  |  |  |  | 1 |  |  |
| user | create | 14 |  | 14 |  |  |  |  |  |  |  |  |  |
| user | get | 3 |  | 1 |  | 1 | 1 |  |  |  |  |  |  |
| user | update | 5 | 1 | 4 |  |  |  |  |  |  |  |  |  |
| user | delete | 1 |  | 1 |  |  |  |  |  |  |  |  |  |
| user | search | 9 | 1 | 5 |  |  |  |  | 2 |  | 1 | 2 |  |
| user | lifecycle | 1 | 1 |  |  |  |  |  |  |  | 1 |  |  |
| message | create | 30 | 2 | 26 |  |  |  |  |  |  |  | 2 |  |
| decision-definition | create | 11 | 1 | 7 |  |  |  |  |  |  |  | 3 |  |
| decision-definition | get | 6 | 2 | 2 |  |  | 2 |  |  |  |  |  |  |
| decision-definition | search | 13 | 1 | 5 |  |  |  |  | 2 | 4 | 1 | 6 |  |
| audit-log | get | 3 | 1 | 1 |  |  | 1 |  |  |  |  |  |  |
| audit-log | search | 25 | 1 | 5 |  |  |  |  | 2 | 16 | 1 | 17 | 1 |
| variable | get | 3 | 1 | 1 |  |  | 1 |  |  |  |  |  |  |
| variable | search | 16 | 1 | 6 |  |  |  |  | 2 | 6 | 1 | 8 |  |
| document | create | 15 | 2 | 9 |  |  |  |  |  |  |  | 4 |  |
| document | get | 1 |  |  |  |  | 1 |  |  |  |  |  |  |
| document | lifecycle | 1 | 1 |  |  |  |  |  |  |  | 1 |  |  |
| decision-requirements | get | 6 | 2 | 2 |  |  | 2 |  |  |  |  |  |  |
| decision-requirements | search | 11 | 1 | 5 |  |  |  |  | 2 | 2 | 1 | 4 |  |
| batch-operation | get | 2 | 1 |  |  |  | 1 |  |  |  |  |  |  |
| batch-operation | update | 2 | 2 |  |  |  |  |  |  | 2 |  |  |  |
| batch-operation | delete | 1 | 1 |  |  |  |  |  |  | 1 |  |  |  |
| batch-operation | search | 10 | 1 | 6 |  |  |  |  | 2 |  | 1 | 2 |  |
| setup | create | 15 | 1 | 14 |  |  |  |  |  |  |  |  |  |
| conditional | create | 15 | 1 | 12 |  |  |  |  |  |  |  | 2 |  |
| signal | create | 14 | 1 | 12 |  |  |  |  |  |  |  | 1 |  |
| correlated-message-subscription | search | 13 | 1 | 5 |  |  |  |  | 2 | 4 | 1 | 6 |  |
| message-subscriptions | search | 13 | 1 | 5 |  |  |  |  | 2 | 4 | 1 | 6 |  |
| expression | create | 12 | 1 | 8 |  |  |  |  |  | 1 |  | 3 |  |
| batch-operation-item | search | 10 | 1 | 5 |  |  |  |  | 2 | 1 | 1 | 3 |  |
| system | get | 9 | 2 | 7 |  |  |  |  |  |  |  |  |  |
| clock | create | 7 | 1 | 6 |  |  |  |  |  |  |  |  |  |
| clock | update | 1 | 1 |  |  |  |  |  |  |  |  |  |  |
| authentication | get | 1 | 1 |  |  |  |  |  |  |  |  |  |  |
| license | get | 1 | 1 |  |  |  |  |  |  |  |  |  |  |
| status | get | 1 | 1 |  |  |  |  |  |  |  |  |  |  |
| topology | get | 1 | 1 |  |  |  |  |  |  |  |  |  |  |
