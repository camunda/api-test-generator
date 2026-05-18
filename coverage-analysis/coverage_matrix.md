# api-test-generator — Coverage matrix (entity × operation × variant)

Total test declarations: **518** across **37** entities.

Variants are first-match labels derived from the generator's emitter suffix (`base`, `negative empty`, `bpmn|dmn|drd|form|path|cycle/...`, `oneOf ...`, `scenario`). See `build_coverage.py` for the rule table.

Legend: ✓ = at least 1, blank = 0.

## At-a-glance presence (✓ = ≥1 test)

| entity | op | total | happy | bad-req | 401 | 403 | 404 | conflict | pagin/sort | filter | absence | data-driven | unlabeled |
|--|--|--:|--|--|--|--|--|--|--|--|--|--|--|
| process-instance | create | 8 | ✓ |  |  |  |  |  |  |  |  | ✓ |  |
| process-instance | get | 4 | ✓ |  |  |  |  |  |  |  |  |  |  |
| process-instance | update | 50 | ✓ |  |  |  |  |  |  |  |  | ✓ |  |
| process-instance | delete | 24 | ✓ |  |  |  |  |  |  |  |  | ✓ |  |
| process-instance | search | 21 | ✓ |  |  |  |  |  |  |  | ✓ | ✓ |  |
| tenant | create | 1 | ✓ |  |  |  |  |  |  |  |  |  |  |
| tenant | get | 1 | ✓ |  |  |  |  |  |  |  |  |  |  |
| tenant | update | 6 | ✓ |  |  |  |  |  |  |  |  |  |  |
| tenant | delete | 6 | ✓ |  |  |  |  |  |  |  |  |  |  |
| tenant | search | 22 | ✓ |  |  |  |  |  |  |  | ✓ | ✓ |  |
| role | create | 1 | ✓ |  |  |  |  |  |  |  |  |  |  |
| role | get | 1 | ✓ |  |  |  |  |  |  |  |  |  |  |
| role | update | 5 | ✓ |  |  |  |  |  |  |  |  |  |  |
| role | delete | 5 | ✓ |  |  |  |  |  |  |  |  |  |  |
| role | search | 18 | ✓ |  |  |  |  |  |  |  | ✓ | ✓ |  |
| group | create | 1 | ✓ |  |  |  |  |  |  |  |  |  |  |
| group | get | 1 | ✓ |  |  |  |  |  |  |  |  |  |  |
| group | update | 4 | ✓ |  |  |  |  |  |  |  |  |  |  |
| group | delete | 4 | ✓ |  |  |  |  |  |  |  |  |  |  |
| group | search | 18 | ✓ |  |  |  |  |  |  |  | ✓ | ✓ |  |
| job | create | 4 | ✓ |  |  |  |  |  |  |  | ✓ | ✓ |  |
| job | get | 9 | ✓ |  |  |  |  |  |  |  |  | ✓ |  |
| job | update | 6 | ✓ |  |  |  |  |  |  |  |  | ✓ |  |
| job | search | 8 | ✓ |  |  |  |  |  |  |  | ✓ | ✓ |  |
| decision-instance | get | 1 | ✓ |  |  |  |  |  |  |  |  |  |  |
| decision-instance | delete | 12 | ✓ |  |  |  |  |  |  |  |  | ✓ | ✓ |
| decision-instance | search | 14 | ✓ |  |  |  |  |  |  |  | ✓ | ✓ |  |
| process-definition | get | 21 | ✓ |  |  |  |  |  |  |  |  | ✓ |  |
| process-definition | search | 6 | ✓ |  |  |  |  |  |  |  | ✓ | ✓ |  |
| element-instance | create | 3 | ✓ |  |  |  |  |  |  |  |  | ✓ |  |
| element-instance | get | 1 | ✓ |  |  |  |  |  |  |  |  |  |  |
| element-instance | search | 21 | ✓ |  |  |  |  |  |  |  | ✓ | ✓ |  |
| user-task | get | 2 | ✓ |  |  |  |  |  |  |  |  |  |  |
| user-task | update | 3 | ✓ |  |  |  |  |  |  |  |  |  |  |
| user-task | delete | 1 | ✓ |  |  |  |  |  |  |  |  |  |  |
| user-task | search | 14 | ✓ |  |  |  |  |  |  |  | ✓ | ✓ |  |
| audit-log | get | 1 | ✓ |  |  |  |  |  |  |  |  |  |  |
| audit-log | search | 17 | ✓ |  |  |  |  |  |  |  | ✓ | ✓ | ✓ |
| resource | create | 5 |  |  |  |  |  |  |  |  |  | ✓ |  |
| resource | get | 2 | ✓ |  |  |  |  |  |  |  |  |  |  |
| resource | delete | 1 | ✓ |  |  |  |  |  |  |  |  |  |  |
| resource | search | 7 | ✓ |  |  |  |  |  |  |  | ✓ | ✓ |  |
| decision-definition | create | 4 | ✓ |  |  |  |  |  |  |  |  | ✓ |  |
| decision-definition | get | 2 | ✓ |  |  |  |  |  |  |  |  |  |  |
| decision-definition | search | 8 | ✓ |  |  |  |  |  |  |  | ✓ | ✓ |  |
| authorization | create | 3 | ✓ |  |  |  |  |  |  |  |  | ✓ |  |
| authorization | get | 1 | ✓ |  |  |  |  |  |  |  |  |  |  |
| authorization | update | 3 | ✓ |  |  |  |  |  |  |  |  | ✓ |  |
| authorization | delete | 1 | ✓ |  |  |  |  |  |  |  |  |  |  |
| authorization | search | 4 | ✓ |  |  |  |  |  |  |  | ✓ | ✓ |  |
| cluster-variables | create | 2 | ✓ |  |  |  |  |  |  |  |  |  |  |
| cluster-variables | get | 2 | ✓ |  |  |  |  |  |  |  |  |  |  |
| cluster-variables | update | 2 | ✓ |  |  |  |  |  |  |  |  |  |  |
| cluster-variables | delete | 2 | ✓ |  |  |  |  |  |  |  |  |  |  |
| cluster-variables | search | 4 | ✓ |  |  |  |  |  |  |  | ✓ | ✓ |  |
| incident | get | 3 | ✓ |  |  |  |  |  |  |  |  |  |  |
| incident | update | 1 | ✓ |  |  |  |  |  |  |  |  |  |  |
| incident | search | 8 | ✓ |  |  |  |  |  |  |  | ✓ | ✓ |  |
| document | create | 7 | ✓ |  |  |  |  |  |  |  |  | ✓ |  |
| document | get | 1 | ✓ |  |  |  |  |  |  |  |  |  |  |
| document | delete | 1 | ✓ |  |  |  |  |  |  |  |  |  |  |
| mapping-rule | create | 1 | ✓ |  |  |  |  |  |  |  |  |  |  |
| mapping-rule | get | 1 | ✓ |  |  |  |  |  |  |  |  |  |  |
| mapping-rule | update | 1 | ✓ |  |  |  |  |  |  |  |  |  |  |
| mapping-rule | delete | 1 | ✓ |  |  |  |  |  |  |  |  |  |  |
| mapping-rule | search | 5 | ✓ |  |  |  |  |  |  |  | ✓ | ✓ |  |
| agent-instance | get | 1 | ✓ |  |  |  |  |  |  |  |  |  |  |
| agent-instance | search | 8 | ✓ |  |  |  |  |  |  |  | ✓ | ✓ | ✓ |
| variable | get | 1 | ✓ |  |  |  |  |  |  |  |  |  |  |
| variable | search | 8 | ✓ |  |  |  |  |  |  |  | ✓ | ✓ | ✓ |
| batch-operation | get | 1 | ✓ |  |  |  |  |  |  |  |  |  |  |
| batch-operation | update | 2 | ✓ |  |  |  |  |  |  |  |  |  |  |
| batch-operation | delete | 1 | ✓ |  |  |  |  |  |  |  |  |  |  |
| batch-operation | search | 4 | ✓ |  |  |  |  |  |  |  | ✓ | ✓ |  |
| global-task-listener | create | 1 | ✓ |  |  |  |  |  |  |  |  |  |  |
| global-task-listener | get | 1 | ✓ |  |  |  |  |  |  |  |  |  |  |
| global-task-listener | update | 1 | ✓ |  |  |  |  |  |  |  |  |  |  |
| global-task-listener | delete | 1 | ✓ |  |  |  |  |  |  |  |  |  |  |
| global-task-listener | search | 4 | ✓ |  |  |  |  |  |  |  | ✓ | ✓ |  |
| user | create | 1 | ✓ |  |  |  |  |  |  |  |  |  |  |
| user | get | 1 | ✓ |  |  |  |  |  |  |  |  |  |  |
| user | update | 1 | ✓ |  |  |  |  |  |  |  |  |  |  |
| user | delete | 1 | ✓ |  |  |  |  |  |  |  |  |  |  |
| user | search | 4 | ✓ |  |  |  |  |  |  |  | ✓ | ✓ |  |
| decision-requirements | get | 2 | ✓ |  |  |  |  |  |  |  |  |  |  |
| decision-requirements | search | 6 | ✓ |  |  |  |  |  |  |  | ✓ | ✓ |  |
| correlated-message-subscription | search | 8 | ✓ |  |  |  |  |  |  |  | ✓ | ✓ |  |
| message-subscriptions | search | 8 | ✓ |  |  |  |  |  |  |  | ✓ | ✓ |  |
| batch-operation-item | search | 5 | ✓ |  |  |  |  |  |  |  | ✓ | ✓ |  |
| message | create | 4 | ✓ |  |  |  |  |  |  |  |  |  | ✓ |
| conditional | create | 3 | ✓ |  |  |  |  |  |  |  |  | ✓ | ✓ |
| signal | create | 2 | ✓ |  |  |  |  |  |  |  |  |  | ✓ |
| system | get | 2 | ✓ |  |  |  |  |  |  |  |  |  |  |
| clock | create | 1 | ✓ |  |  |  |  |  |  |  |  |  |  |
| clock | delete | 1 | ✓ |  |  |  |  |  |  |  |  |  |  |
| setup | create | 1 | ✓ |  |  |  |  |  |  |  |  |  |  |
| expression | create | 1 | ✓ |  |  |  |  |  |  |  |  |  |  |
| authentication | get | 1 | ✓ |  |  |  |  |  |  |  |  |  |  |
| license | get | 1 | ✓ |  |  |  |  |  |  |  |  |  |  |
| status | get | 1 | ✓ |  |  |  |  |  |  |  |  |  |  |
| topology | get | 1 | ✓ |  |  |  |  |  |  |  |  |  |  |

## Counts per cell

| entity | op | total | happy | bad-req | 401 | 403 | 404 | conflict | pagin/sort | filter | absence | data-driven | unlabeled |
|--|--|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| process-instance | create | 8 | 1 |  |  |  |  |  |  |  |  | 7 |  |
| process-instance | get | 4 | 4 |  |  |  |  |  |  |  |  |  |  |
| process-instance | update | 50 | 6 |  |  |  |  |  |  |  |  | 44 |  |
| process-instance | delete | 24 | 4 |  |  |  |  |  |  |  |  | 20 |  |
| process-instance | search | 21 | 2 |  |  |  |  |  |  |  | 1 | 18 |  |
| tenant | create | 1 | 1 |  |  |  |  |  |  |  |  |  |  |
| tenant | get | 1 | 1 |  |  |  |  |  |  |  |  |  |  |
| tenant | update | 6 | 6 |  |  |  |  |  |  |  |  |  |  |
| tenant | delete | 6 | 6 |  |  |  |  |  |  |  |  |  |  |
| tenant | search | 22 | 6 |  |  |  |  |  |  |  | 1 | 15 |  |
| role | create | 1 | 1 |  |  |  |  |  |  |  |  |  |  |
| role | get | 1 | 1 |  |  |  |  |  |  |  |  |  |  |
| role | update | 5 | 5 |  |  |  |  |  |  |  |  |  |  |
| role | delete | 5 | 5 |  |  |  |  |  |  |  |  |  |  |
| role | search | 18 | 5 |  |  |  |  |  |  |  | 1 | 12 |  |
| group | create | 1 | 1 |  |  |  |  |  |  |  |  |  |  |
| group | get | 1 | 1 |  |  |  |  |  |  |  |  |  |  |
| group | update | 4 | 4 |  |  |  |  |  |  |  |  |  |  |
| group | delete | 4 | 4 |  |  |  |  |  |  |  |  |  |  |
| group | search | 18 | 5 |  |  |  |  |  |  |  | 1 | 12 |  |
| job | create | 4 | 2 |  |  |  |  |  |  |  | 1 | 1 |  |
| job | get | 9 | 5 |  |  |  |  |  |  |  |  | 4 |  |
| job | update | 6 | 3 |  |  |  |  |  |  |  |  | 3 |  |
| job | search | 8 | 1 |  |  |  |  |  |  |  | 1 | 6 |  |
| decision-instance | get | 1 | 1 |  |  |  |  |  |  |  |  |  |  |
| decision-instance | delete | 12 | 2 |  |  |  |  |  |  |  |  | 9 | 1 |
| decision-instance | search | 14 | 1 |  |  |  |  |  |  |  | 1 | 12 |  |
| process-definition | get | 21 | 7 |  |  |  |  |  |  |  |  | 14 |  |
| process-definition | search | 6 | 1 |  |  |  |  |  |  |  | 1 | 4 |  |
| element-instance | create | 3 | 2 |  |  |  |  |  |  |  |  | 1 |  |
| element-instance | get | 1 | 1 |  |  |  |  |  |  |  |  |  |  |
| element-instance | search | 21 | 2 |  |  |  |  |  |  |  | 1 | 18 |  |
| user-task | get | 2 | 2 |  |  |  |  |  |  |  |  |  |  |
| user-task | update | 3 | 3 |  |  |  |  |  |  |  |  |  |  |
| user-task | delete | 1 | 1 |  |  |  |  |  |  |  |  |  |  |
| user-task | search | 14 | 4 |  |  |  |  |  |  |  | 1 | 9 |  |
| audit-log | get | 1 | 1 |  |  |  |  |  |  |  |  |  |  |
| audit-log | search | 17 | 1 |  |  |  |  |  |  |  | 1 | 11 | 4 |
| resource | create | 5 |  |  |  |  |  |  |  |  |  | 5 |  |
| resource | get | 2 | 2 |  |  |  |  |  |  |  |  |  |  |
| resource | delete | 1 | 1 |  |  |  |  |  |  |  |  |  |  |
| resource | search | 7 | 1 |  |  |  |  |  |  |  | 1 | 5 |  |
| decision-definition | create | 4 | 1 |  |  |  |  |  |  |  |  | 3 |  |
| decision-definition | get | 2 | 2 |  |  |  |  |  |  |  |  |  |  |
| decision-definition | search | 8 | 1 |  |  |  |  |  |  |  | 1 | 6 |  |
| authorization | create | 3 | 1 |  |  |  |  |  |  |  |  | 2 |  |
| authorization | get | 1 | 1 |  |  |  |  |  |  |  |  |  |  |
| authorization | update | 3 | 1 |  |  |  |  |  |  |  |  | 2 |  |
| authorization | delete | 1 | 1 |  |  |  |  |  |  |  |  |  |  |
| authorization | search | 4 | 1 |  |  |  |  |  |  |  | 1 | 2 |  |
| cluster-variables | create | 2 | 2 |  |  |  |  |  |  |  |  |  |  |
| cluster-variables | get | 2 | 2 |  |  |  |  |  |  |  |  |  |  |
| cluster-variables | update | 2 | 2 |  |  |  |  |  |  |  |  |  |  |
| cluster-variables | delete | 2 | 2 |  |  |  |  |  |  |  |  |  |  |
| cluster-variables | search | 4 | 1 |  |  |  |  |  |  |  | 1 | 2 |  |
| incident | get | 3 | 3 |  |  |  |  |  |  |  |  |  |  |
| incident | update | 1 | 1 |  |  |  |  |  |  |  |  |  |  |
| incident | search | 8 | 1 |  |  |  |  |  |  |  | 1 | 6 |  |
| document | create | 7 | 3 |  |  |  |  |  |  |  |  | 4 |  |
| document | get | 1 | 1 |  |  |  |  |  |  |  |  |  |  |
| document | delete | 1 | 1 |  |  |  |  |  |  |  |  |  |  |
| mapping-rule | create | 1 | 1 |  |  |  |  |  |  |  |  |  |  |
| mapping-rule | get | 1 | 1 |  |  |  |  |  |  |  |  |  |  |
| mapping-rule | update | 1 | 1 |  |  |  |  |  |  |  |  |  |  |
| mapping-rule | delete | 1 | 1 |  |  |  |  |  |  |  |  |  |  |
| mapping-rule | search | 5 | 1 |  |  |  |  |  |  |  | 1 | 3 |  |
| agent-instance | get | 1 | 1 |  |  |  |  |  |  |  |  |  |  |
| agent-instance | search | 8 | 1 |  |  |  |  |  |  |  | 1 | 5 | 1 |
| variable | get | 1 | 1 |  |  |  |  |  |  |  |  |  |  |
| variable | search | 8 | 1 |  |  |  |  |  |  |  | 1 | 4 | 2 |
| batch-operation | get | 1 | 1 |  |  |  |  |  |  |  |  |  |  |
| batch-operation | update | 2 | 2 |  |  |  |  |  |  |  |  |  |  |
| batch-operation | delete | 1 | 1 |  |  |  |  |  |  |  |  |  |  |
| batch-operation | search | 4 | 1 |  |  |  |  |  |  |  | 1 | 2 |  |
| global-task-listener | create | 1 | 1 |  |  |  |  |  |  |  |  |  |  |
| global-task-listener | get | 1 | 1 |  |  |  |  |  |  |  |  |  |  |
| global-task-listener | update | 1 | 1 |  |  |  |  |  |  |  |  |  |  |
| global-task-listener | delete | 1 | 1 |  |  |  |  |  |  |  |  |  |  |
| global-task-listener | search | 4 | 1 |  |  |  |  |  |  |  | 1 | 2 |  |
| user | create | 1 | 1 |  |  |  |  |  |  |  |  |  |  |
| user | get | 1 | 1 |  |  |  |  |  |  |  |  |  |  |
| user | update | 1 | 1 |  |  |  |  |  |  |  |  |  |  |
| user | delete | 1 | 1 |  |  |  |  |  |  |  |  |  |  |
| user | search | 4 | 1 |  |  |  |  |  |  |  | 1 | 2 |  |
| decision-requirements | get | 2 | 2 |  |  |  |  |  |  |  |  |  |  |
| decision-requirements | search | 6 | 1 |  |  |  |  |  |  |  | 1 | 4 |  |
| correlated-message-subscription | search | 8 | 1 |  |  |  |  |  |  |  | 1 | 6 |  |
| message-subscriptions | search | 8 | 1 |  |  |  |  |  |  |  | 1 | 6 |  |
| batch-operation-item | search | 5 | 1 |  |  |  |  |  |  |  | 1 | 3 |  |
| message | create | 4 | 2 |  |  |  |  |  |  |  |  |  | 2 |
| conditional | create | 3 | 1 |  |  |  |  |  |  |  |  | 1 | 1 |
| signal | create | 2 | 1 |  |  |  |  |  |  |  |  |  | 1 |
| system | get | 2 | 2 |  |  |  |  |  |  |  |  |  |  |
| clock | create | 1 | 1 |  |  |  |  |  |  |  |  |  |  |
| clock | delete | 1 | 1 |  |  |  |  |  |  |  |  |  |  |
| setup | create | 1 | 1 |  |  |  |  |  |  |  |  |  |  |
| expression | create | 1 | 1 |  |  |  |  |  |  |  |  |  |  |
| authentication | get | 1 | 1 |  |  |  |  |  |  |  |  |  |  |
| license | get | 1 | 1 |  |  |  |  |  |  |  |  |  |  |
| status | get | 1 | 1 |  |  |  |  |  |  |  |  |  |  |
| topology | get | 1 | 1 |  |  |  |  |  |  |  |  |  |  |
