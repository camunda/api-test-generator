# api-test-generator — Coverage matrix (entity × operation × variant)

Total test declarations: **1617** across **37** entities.

Variants are multi-label — a test can carry more than one tag, so matrix columns are **not** mutually exclusive (a lifecycle test tagged `happy-path|observe-absence` counts in both columns, but only once in `total`). Labels come from three sources: (1) test-name suffix (`base` → `happy-path`, `negative empty` → `observe-absence`, `bpmn`/`dmn`/`drd`/`form`/`path`/`cycle/...`/`oneOf ...` → `data-driven`, `variant-N - scenario` → `unlabeled`), (2) test-body shape (`page: {` / `sort: [` → `pagination-sort`, `filter: {` → `filter`), and (3) fixed labels for the lifecycle and request-validation emitters (`happy-path|observe-absence` and `bad-request` respectively). See `build_coverage.py` for the rule table.

Legend: ✓ = at least 1, blank = 0.

## At-a-glance presence (✓ = ≥1 test)

| entity | op | total | happy | bad-req | 401 | 403 | 404 | conflict | pagin/sort | filter | absence | data-driven | unlabeled |
|--|--|--:|--|--|--|--|--|--|--|--|--|--|--|
| process-instance | create | 14 | ✓ | ✓ |  |  |  |  |  |  |  | ✓ |  |
| process-instance | get | 8 | ✓ | ✓ |  |  |  |  |  |  |  |  |  |
| process-instance | update | 148 | ✓ | ✓ |  |  |  |  |  | ✓ |  | ✓ |  |
| process-instance | delete | 74 | ✓ | ✓ |  |  |  |  |  | ✓ |  | ✓ |  |
| process-instance | search | 38 | ✓ | ✓ |  |  |  |  | ✓ | ✓ | ✓ | ✓ |  |
| job | create | 32 | ✓ | ✓ |  |  |  |  |  |  | ✓ | ✓ |  |
| job | get | 67 | ✓ | ✓ |  |  |  |  | ✓ | ✓ |  | ✓ |  |
| job | update | 30 | ✓ | ✓ |  |  |  |  |  |  |  | ✓ |  |
| job | search | 13 | ✓ | ✓ |  |  |  |  | ✓ | ✓ | ✓ | ✓ |  |
| tenant | create | 15 | ✓ | ✓ |  |  |  |  |  |  |  |  |  |
| tenant | get | 2 | ✓ | ✓ |  |  |  |  |  |  |  |  |  |
| tenant | update | 23 | ✓ | ✓ |  |  |  |  |  |  |  |  |  |
| tenant | delete | 17 | ✓ | ✓ |  |  |  |  |  |  |  |  |  |
| tenant | search | 57 | ✓ | ✓ |  |  |  |  | ✓ | ✓ | ✓ | ✓ |  |
| tenant | lifecycle | 6 | ✓ |  |  |  |  |  |  |  | ✓ |  |  |
| role | create | 14 | ✓ | ✓ |  |  |  |  |  |  |  |  |  |
| role | get | 2 | ✓ | ✓ |  |  |  |  |  |  |  |  |  |
| role | update | 20 | ✓ | ✓ |  |  |  |  |  |  |  |  |  |
| role | delete | 14 | ✓ | ✓ |  |  |  |  |  |  |  |  |  |
| role | search | 47 | ✓ | ✓ |  |  |  |  | ✓ | ✓ | ✓ | ✓ |  |
| role | lifecycle | 5 | ✓ |  |  |  |  |  |  |  | ✓ |  |  |
| group | create | 13 | ✓ | ✓ |  |  |  |  |  |  |  |  |  |
| group | get | 2 | ✓ | ✓ |  |  |  |  |  |  |  |  |  |
| group | update | 17 | ✓ | ✓ |  |  |  |  |  |  |  |  |  |
| group | delete | 11 | ✓ | ✓ |  |  |  |  |  |  |  |  |  |
| group | search | 47 | ✓ | ✓ |  |  |  |  | ✓ | ✓ | ✓ | ✓ |  |
| group | lifecycle | 4 | ✓ |  |  |  |  |  |  |  | ✓ |  |  |
| decision-instance | get | 2 | ✓ | ✓ |  |  |  |  |  |  |  |  |  |
| decision-instance | delete | 50 | ✓ | ✓ |  |  |  |  |  | ✓ |  | ✓ |  |
| decision-instance | search | 20 | ✓ | ✓ |  |  |  |  | ✓ | ✓ | ✓ | ✓ |  |
| process-definition | get | 59 | ✓ | ✓ |  |  |  |  | ✓ | ✓ |  | ✓ |  |
| process-definition | search | 11 | ✓ | ✓ |  |  |  |  | ✓ | ✓ | ✓ | ✓ |  |
| user-task | get | 6 | ✓ | ✓ |  |  |  |  |  |  |  |  |  |
| user-task | update | 13 | ✓ | ✓ |  |  |  |  |  |  |  |  |  |
| user-task | delete | 2 | ✓ | ✓ |  |  |  |  |  |  |  |  |  |
| user-task | search | 44 | ✓ | ✓ |  |  |  |  | ✓ | ✓ | ✓ | ✓ |  |
| cluster-variables | create | 27 | ✓ | ✓ |  |  |  |  |  |  |  |  |  |
| cluster-variables | get | 5 | ✓ | ✓ |  |  |  |  |  |  |  |  |  |
| cluster-variables | update | 13 | ✓ | ✓ |  |  |  |  |  |  |  |  |  |
| cluster-variables | delete | 5 | ✓ | ✓ |  |  |  |  |  |  |  |  |  |
| cluster-variables | search | 10 | ✓ | ✓ |  |  |  |  | ✓ |  | ✓ | ✓ |  |
| cluster-variables | lifecycle | 2 | ✓ |  |  |  |  |  |  |  | ✓ |  |  |
| element-instance | create | 19 | ✓ | ✓ |  |  |  |  |  |  |  | ✓ |  |
| element-instance | get | 2 | ✓ | ✓ |  |  |  |  |  |  |  |  |  |
| element-instance | search | 34 | ✓ | ✓ |  |  |  |  | ✓ | ✓ | ✓ | ✓ |  |
| agent-instance | create | 22 | ✓ | ✓ |  |  |  |  |  |  |  |  |  |
| agent-instance | get | 2 | ✓ | ✓ |  |  |  |  |  |  |  |  |  |
| agent-instance | update | 11 | ✓ | ✓ |  |  |  |  |  |  |  |  |  |
| agent-instance | search | 14 | ✓ | ✓ |  |  |  |  | ✓ | ✓ | ✓ | ✓ |  |
| mapping-rule | create | 21 | ✓ | ✓ |  |  |  |  |  |  |  |  |  |
| mapping-rule | get | 2 | ✓ | ✓ |  |  |  |  |  |  |  |  |  |
| mapping-rule | update | 13 | ✓ | ✓ |  |  |  |  |  |  |  |  |  |
| mapping-rule | delete | 2 | ✓ | ✓ |  |  |  |  |  |  |  |  |  |
| mapping-rule | search | 10 | ✓ | ✓ |  |  |  |  | ✓ | ✓ | ✓ | ✓ |  |
| mapping-rule | lifecycle | 1 | ✓ |  |  |  |  |  |  |  | ✓ |  |  |
| global-task-listener | create | 22 | ✓ | ✓ |  |  |  |  |  |  |  |  |  |
| global-task-listener | get | 2 | ✓ | ✓ |  |  |  |  |  |  |  |  |  |
| global-task-listener | update | 12 | ✓ | ✓ |  |  |  |  |  |  |  |  |  |
| global-task-listener | delete | 2 | ✓ | ✓ |  |  |  |  |  |  |  |  |  |
| global-task-listener | search | 9 | ✓ | ✓ |  |  |  |  | ✓ |  | ✓ | ✓ |  |
| global-task-listener | lifecycle | 1 | ✓ |  |  |  |  |  |  |  | ✓ |  |  |
| incident | get | 19 | ✓ | ✓ |  |  |  |  |  | ✓ |  |  |  |
| incident | update | 9 | ✓ | ✓ |  |  |  |  |  |  |  |  |  |
| incident | search | 13 | ✓ | ✓ |  |  |  |  | ✓ | ✓ | ✓ | ✓ |  |
| authorization | create | 10 | ✓ | ✓ |  |  |  |  |  |  |  | ✓ |  |
| authorization | get | 2 | ✓ | ✓ |  |  |  |  |  |  |  |  |  |
| authorization | update | 11 | ✓ | ✓ |  |  |  |  |  |  |  | ✓ |  |
| authorization | delete | 2 | ✓ | ✓ |  |  |  |  |  |  |  |  |  |
| authorization | search | 11 | ✓ | ✓ |  |  |  |  | ✓ |  | ✓ | ✓ |  |
| authorization | lifecycle | 1 | ✓ |  |  |  |  |  |  |  | ✓ |  |  |
| resource | create | 13 |  | ✓ |  |  |  |  |  |  |  | ✓ |  |
| resource | get | 3 | ✓ |  |  |  |  |  |  |  |  |  |  |
| resource | delete | 8 | ✓ | ✓ |  |  |  |  |  |  |  |  |  |
| resource | search | 12 | ✓ | ✓ |  |  |  |  | ✓ | ✓ | ✓ | ✓ |  |
| user | create | 15 | ✓ | ✓ |  |  |  |  |  |  |  |  |  |
| user | get | 2 | ✓ | ✓ |  |  |  |  |  |  |  |  |  |
| user | update | 5 | ✓ | ✓ |  |  |  |  |  |  |  |  |  |
| user | delete | 2 | ✓ | ✓ |  |  |  |  |  |  |  |  |  |
| user | search | 9 | ✓ | ✓ |  |  |  |  | ✓ |  | ✓ | ✓ |  |
| user | lifecycle | 1 | ✓ |  |  |  |  |  |  |  | ✓ |  |  |
| message | create | 30 | ✓ | ✓ |  |  |  |  |  |  |  | ✓ |  |
| decision-definition | create | 11 | ✓ | ✓ |  |  |  |  |  |  |  | ✓ |  |
| decision-definition | get | 4 | ✓ | ✓ |  |  |  |  |  |  |  |  |  |
| decision-definition | search | 13 | ✓ | ✓ |  |  |  |  | ✓ | ✓ | ✓ | ✓ |  |
| audit-log | get | 2 | ✓ | ✓ |  |  |  |  |  |  |  |  |  |
| audit-log | search | 22 | ✓ | ✓ |  |  |  |  | ✓ | ✓ | ✓ | ✓ | ✓ |
| document | create | 18 | ✓ | ✓ |  |  |  |  |  |  |  | ✓ |  |
| document | get | 1 | ✓ |  |  |  |  |  |  |  |  |  |  |
| document | delete | 1 | ✓ |  |  |  |  |  |  |  |  |  |  |
| document | lifecycle | 1 | ✓ |  |  |  |  |  |  |  | ✓ |  |  |
| variable | get | 2 | ✓ | ✓ |  |  |  |  |  |  |  |  |  |
| variable | search | 14 | ✓ | ✓ |  |  |  |  | ✓ | ✓ | ✓ | ✓ | ✓ |
| setup | create | 15 | ✓ | ✓ |  |  |  |  |  |  |  |  |  |
| conditional | create | 15 | ✓ | ✓ |  |  |  |  |  |  |  | ✓ |  |
| decision-requirements | get | 4 | ✓ | ✓ |  |  |  |  |  |  |  |  |  |
| decision-requirements | search | 11 | ✓ | ✓ |  |  |  |  | ✓ | ✓ | ✓ | ✓ |  |
| signal | create | 14 | ✓ | ✓ |  |  |  |  |  |  |  | ✓ |  |
| batch-operation | get | 1 | ✓ |  |  |  |  |  |  | ✓ |  |  |  |
| batch-operation | update | 2 | ✓ |  |  |  |  |  |  | ✓ |  |  |  |
| batch-operation | delete | 1 | ✓ |  |  |  |  |  |  | ✓ |  |  |  |
| batch-operation | search | 10 | ✓ | ✓ |  |  |  |  | ✓ |  | ✓ | ✓ |  |
| correlated-message-subscription | search | 13 | ✓ | ✓ |  |  |  |  | ✓ | ✓ | ✓ | ✓ |  |
| message-subscriptions | search | 13 | ✓ | ✓ |  |  |  |  | ✓ | ✓ | ✓ | ✓ |  |
| expression | create | 10 | ✓ | ✓ |  |  |  |  |  |  |  |  | ✓ |
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
| process-instance | get | 8 | 4 | 4 |  |  |  |  |  |  |  |  |  |
| process-instance | update | 148 | 6 | 98 |  |  |  |  |  | 37 |  | 44 |  |
| process-instance | delete | 74 | 4 | 50 |  |  |  |  |  | 22 |  | 20 |  |
| process-instance | search | 38 | 2 | 17 |  |  |  |  | 4 | 14 | 1 | 18 |  |
| job | create | 32 | 2 | 28 |  |  |  |  |  |  | 1 | 1 |  |
| job | get | 67 | 5 | 58 |  |  |  |  | 4 | 6 |  | 4 |  |
| job | update | 30 | 3 | 24 |  |  |  |  |  |  |  | 3 |  |
| job | search | 13 | 1 | 5 |  |  |  |  | 2 | 4 | 1 | 6 |  |
| tenant | create | 15 | 1 | 14 |  |  |  |  |  |  |  |  |  |
| tenant | get | 2 | 1 | 1 |  |  |  |  |  |  |  |  |  |
| tenant | update | 23 | 6 | 17 |  |  |  |  |  |  |  |  |  |
| tenant | delete | 17 | 6 | 11 |  |  |  |  |  |  |  |  |  |
| tenant | search | 57 | 6 | 35 |  |  |  |  | 12 | 3 | 1 | 15 |  |
| tenant | lifecycle | 6 | 6 |  |  |  |  |  |  |  | 6 |  |  |
| role | create | 14 | 1 | 13 |  |  |  |  |  |  |  |  |  |
| role | get | 2 | 1 | 1 |  |  |  |  |  |  |  |  |  |
| role | update | 20 | 5 | 15 |  |  |  |  |  |  |  |  |  |
| role | delete | 14 | 5 | 9 |  |  |  |  |  |  |  |  |  |
| role | search | 47 | 5 | 29 |  |  |  |  | 10 | 2 | 1 | 12 |  |
| role | lifecycle | 5 | 5 |  |  |  |  |  |  |  | 5 |  |  |
| group | create | 13 | 1 | 12 |  |  |  |  |  |  |  |  |  |
| group | get | 2 | 1 | 1 |  |  |  |  |  |  |  |  |  |
| group | update | 17 | 4 | 13 |  |  |  |  |  |  |  |  |  |
| group | delete | 11 | 4 | 7 |  |  |  |  |  |  |  |  |  |
| group | search | 47 | 5 | 29 |  |  |  |  | 10 | 2 | 1 | 12 |  |
| group | lifecycle | 4 | 4 |  |  |  |  |  |  |  | 4 |  |  |
| decision-instance | get | 2 | 1 | 1 |  |  |  |  |  |  |  |  |  |
| decision-instance | delete | 50 | 2 | 38 |  |  |  |  |  | 11 |  | 10 |  |
| decision-instance | search | 20 | 1 | 6 |  |  |  |  | 2 | 10 | 1 | 12 |  |
| process-definition | get | 59 | 7 | 38 |  |  |  |  | 1 | 14 |  | 14 |  |
| process-definition | search | 11 | 1 | 5 |  |  |  |  | 2 | 2 | 1 | 4 |  |
| user-task | get | 6 | 3 | 3 |  |  |  |  |  |  |  |  |  |
| user-task | update | 13 | 3 | 10 |  |  |  |  |  |  |  |  |  |
| user-task | delete | 2 | 1 | 1 |  |  |  |  |  |  |  |  |  |
| user-task | search | 44 | 4 | 30 |  |  |  |  | 2 | 7 | 1 | 9 |  |
| cluster-variables | create | 27 | 2 | 25 |  |  |  |  |  |  |  |  |  |
| cluster-variables | get | 5 | 2 | 3 |  |  |  |  |  |  |  |  |  |
| cluster-variables | update | 13 | 2 | 11 |  |  |  |  |  |  |  |  |  |
| cluster-variables | delete | 5 | 2 | 3 |  |  |  |  |  |  |  |  |  |
| cluster-variables | search | 10 | 1 | 6 |  |  |  |  | 2 |  | 1 | 2 |  |
| cluster-variables | lifecycle | 2 | 2 |  |  |  |  |  |  |  | 2 |  |  |
| element-instance | create | 19 | 2 | 16 |  |  |  |  |  |  |  | 1 |  |
| element-instance | get | 2 | 1 | 1 |  |  |  |  |  |  |  |  |  |
| element-instance | search | 34 | 2 | 13 |  |  |  |  | 4 | 12 | 1 | 18 |  |
| agent-instance | create | 22 | 1 | 21 |  |  |  |  |  |  |  |  |  |
| agent-instance | get | 2 | 1 | 1 |  |  |  |  |  |  |  |  |  |
| agent-instance | update | 11 | 1 | 10 |  |  |  |  |  |  |  |  |  |
| agent-instance | search | 14 | 1 | 5 |  |  |  |  | 2 | 5 | 1 | 7 |  |
| mapping-rule | create | 21 | 1 | 20 |  |  |  |  |  |  |  |  |  |
| mapping-rule | get | 2 | 1 | 1 |  |  |  |  |  |  |  |  |  |
| mapping-rule | update | 13 | 1 | 12 |  |  |  |  |  |  |  |  |  |
| mapping-rule | delete | 2 | 1 | 1 |  |  |  |  |  |  |  |  |  |
| mapping-rule | search | 10 | 1 | 5 |  |  |  |  | 2 | 1 | 1 | 3 |  |
| mapping-rule | lifecycle | 1 | 1 |  |  |  |  |  |  |  | 1 |  |  |
| global-task-listener | create | 22 | 1 | 21 |  |  |  |  |  |  |  |  |  |
| global-task-listener | get | 2 | 1 | 1 |  |  |  |  |  |  |  |  |  |
| global-task-listener | update | 12 | 1 | 11 |  |  |  |  |  |  |  |  |  |
| global-task-listener | delete | 2 | 1 | 1 |  |  |  |  |  |  |  |  |  |
| global-task-listener | search | 9 | 1 | 5 |  |  |  |  | 2 |  | 1 | 2 |  |
| global-task-listener | lifecycle | 1 | 1 |  |  |  |  |  |  |  | 1 |  |  |
| incident | get | 19 | 3 | 16 |  |  |  |  |  | 1 |  |  |  |
| incident | update | 9 | 1 | 8 |  |  |  |  |  |  |  |  |  |
| incident | search | 13 | 1 | 5 |  |  |  |  | 2 | 4 | 1 | 6 |  |
| authorization | create | 10 | 1 | 7 |  |  |  |  |  |  |  | 2 |  |
| authorization | get | 2 | 1 | 1 |  |  |  |  |  |  |  |  |  |
| authorization | update | 11 | 1 | 8 |  |  |  |  |  |  |  | 2 |  |
| authorization | delete | 2 | 1 | 1 |  |  |  |  |  |  |  |  |  |
| authorization | search | 11 | 1 | 7 |  |  |  |  | 2 |  | 1 | 2 |  |
| authorization | lifecycle | 1 | 1 |  |  |  |  |  |  |  | 1 |  |  |
| resource | create | 13 |  | 8 |  |  |  |  |  |  |  | 5 |  |
| resource | get | 3 | 3 |  |  |  |  |  |  |  |  |  |  |
| resource | delete | 8 | 1 | 7 |  |  |  |  |  |  |  |  |  |
| resource | search | 12 | 1 | 5 |  |  |  |  | 2 | 3 | 1 | 5 |  |
| user | create | 15 | 1 | 14 |  |  |  |  |  |  |  |  |  |
| user | get | 2 | 1 | 1 |  |  |  |  |  |  |  |  |  |
| user | update | 5 | 1 | 4 |  |  |  |  |  |  |  |  |  |
| user | delete | 2 | 1 | 1 |  |  |  |  |  |  |  |  |  |
| user | search | 9 | 1 | 5 |  |  |  |  | 2 |  | 1 | 2 |  |
| user | lifecycle | 1 | 1 |  |  |  |  |  |  |  | 1 |  |  |
| message | create | 30 | 2 | 26 |  |  |  |  |  |  |  | 2 |  |
| decision-definition | create | 11 | 1 | 7 |  |  |  |  |  |  |  | 3 |  |
| decision-definition | get | 4 | 2 | 2 |  |  |  |  |  |  |  |  |  |
| decision-definition | search | 13 | 1 | 5 |  |  |  |  | 2 | 4 | 1 | 6 |  |
| audit-log | get | 2 | 1 | 1 |  |  |  |  |  |  |  |  |  |
| audit-log | search | 22 | 1 | 5 |  |  |  |  | 2 | 13 | 1 | 11 | 4 |
| document | create | 18 | 3 | 11 |  |  |  |  |  |  |  | 4 |  |
| document | get | 1 | 1 |  |  |  |  |  |  |  |  |  |  |
| document | delete | 1 | 1 |  |  |  |  |  |  |  |  |  |  |
| document | lifecycle | 1 | 1 |  |  |  |  |  |  |  | 1 |  |  |
| variable | get | 2 | 1 | 1 |  |  |  |  |  |  |  |  |  |
| variable | search | 14 | 1 | 6 |  |  |  |  | 2 | 4 | 1 | 4 | 2 |
| setup | create | 15 | 1 | 14 |  |  |  |  |  |  |  |  |  |
| conditional | create | 15 | 1 | 12 |  |  |  |  |  |  |  | 2 |  |
| decision-requirements | get | 4 | 2 | 2 |  |  |  |  |  |  |  |  |  |
| decision-requirements | search | 11 | 1 | 5 |  |  |  |  | 2 | 2 | 1 | 4 |  |
| signal | create | 14 | 1 | 12 |  |  |  |  |  |  |  | 1 |  |
| batch-operation | get | 1 | 1 |  |  |  |  |  |  | 1 |  |  |  |
| batch-operation | update | 2 | 2 |  |  |  |  |  |  | 2 |  |  |  |
| batch-operation | delete | 1 | 1 |  |  |  |  |  |  | 1 |  |  |  |
| batch-operation | search | 10 | 1 | 6 |  |  |  |  | 2 |  | 1 | 2 |  |
| correlated-message-subscription | search | 13 | 1 | 5 |  |  |  |  | 2 | 4 | 1 | 6 |  |
| message-subscriptions | search | 13 | 1 | 5 |  |  |  |  | 2 | 4 | 1 | 6 |  |
| expression | create | 10 | 1 | 8 |  |  |  |  |  |  |  |  | 1 |
| batch-operation-item | search | 10 | 1 | 5 |  |  |  |  | 2 | 1 | 1 | 3 |  |
| system | get | 9 | 2 | 7 |  |  |  |  |  |  |  |  |  |
| clock | create | 7 | 1 | 6 |  |  |  |  |  |  |  |  |  |
| clock | update | 1 | 1 |  |  |  |  |  |  |  |  |  |  |
| authentication | get | 1 | 1 |  |  |  |  |  |  |  |  |  |  |
| license | get | 1 | 1 |  |  |  |  |  |  |  |  |  |  |
| status | get | 1 | 1 |  |  |  |  |  |  |  |  |  |  |
| topology | get | 1 | 1 |  |  |  |  |  |  |  |  |  |  |
