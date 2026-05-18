#!/usr/bin/env python3
"""
Build api-test-generator coverage matrix in the same shape as the upstream
c8-orchestration-cluster-e2e-test-suite/coverage-analysis/coverage_matrix.csv.

Run from this script's directory:
    python3 build_coverage.py

Scans ../generated/camunda-oca/playwright/*.spec.ts and emits, next to this script:
  - tests.csv           : per-test labels (file, line, entity, operation, variants, test_name)
  - coverage_matrix.csv : entity x operation grid, variant counts (same columns as upstream)
"""
import csv
import json
import os
import re
from collections import defaultdict

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PLAYWRIGHT_DIR = os.path.normpath(os.path.join(SCRIPT_DIR, '..', 'generated', 'camunda-oca', 'playwright'))
SPEC_PATH = os.path.normpath(os.path.join(SCRIPT_DIR, '..', 'spec', 'camunda-oca', 'bundled', 'rest-api.bundle.json'))
OUT = SCRIPT_DIR

# ---------- 1. operationId -> (METHOD, path) from the bundled OpenAPI ----------
def load_ops():
    spec = json.load(open(SPEC_PATH))
    ops = {}
    for path, methods in spec.get('paths', {}).items():
        for method, op in methods.items():
            if not isinstance(op, dict):
                continue
            if method.lower() not in ('get', 'post', 'put', 'patch', 'delete'):
                continue
            op_id = op.get('operationId')
            if op_id:
                ops[op_id] = (method.upper(), path)
    return ops

OPS = load_ops()

# ---------- 2. entity mapping (path's first segment -> entity slug used in
#               the upstream coverage_matrix.csv). Explicit so already-singular
#               segments (status, authentication, ...) aren't mangled. ----------
SEGMENT_TO_ENTITY = {
    'agent-instances': 'agent-instance',
    'audit-logs': 'audit-log',
    'authentication': 'authentication',
    'authorizations': 'authorization',
    'batch-operations': 'batch-operation',
    'batch-operation-items': 'batch-operation-item',
    'clock': 'clock',
    'cluster-variables': 'cluster-variables',
    'conditionals': 'conditional',
    'correlated-message-subscriptions': 'correlated-message-subscription',
    'decision-definitions': 'decision-definition',
    'decision-instances': 'decision-instance',
    'decision-requirements': 'decision-requirements',
    'deployments': 'resource',  # upstream rolls deployments into the `resource` entity
    'documents': 'document',
    'element-instances': 'element-instance',
    'expression': 'expression',
    'global-task-listeners': 'global-task-listener',
    'groups': 'group',
    'incidents': 'incident',
    'jobs': 'job',
    'license': 'license',
    'mapping-rules': 'mapping-rule',
    'message-subscriptions': 'message-subscriptions',
    'messages': 'message',
    'process-definitions': 'process-definition',
    'process-instances': 'process-instance',
    'resources': 'resource',
    'roles': 'role',
    'setup': 'setup',
    'signals': 'signal',
    'status': 'status',
    'system': 'system',
    'tenants': 'tenant',
    'topology': 'topology',
    'user-tasks': 'user-task',
    'users': 'user',
    'variables': 'variable',
}
def entity_of_path(path):
    seg = path.lstrip('/').split('/', 1)[0]
    return SEGMENT_TO_ENTITY.get(seg, seg)

# ---------- 3. operation classification (CRUD verb) from operationId ----------
OP_RULES = [
    ('search',   re.compile(r'^(search|list)', re.I)),
    ('create',   re.compile(r'^(create|deploy|publish|broadcast|pin|register|add|activate|correlate|evaluate)', re.I)),
    ('delete',   re.compile(r'^(delete|remove|unassign|cancel|reset)', re.I)),
    ('update',   re.compile(r'^(update|assign|complete|migrate|modify|resolve|fail|resume|suspend|patch|put)', re.I)),
    ('get',      re.compile(r'^(get|fetch|retrieve|read)', re.I)),
]
def operation_of(op_id, method, path):
    # operationId prefix is the strongest signal
    for op, pat in OP_RULES:
        if pat.match(op_id):
            return op
    # fallback by HTTP method
    if method == 'GET':
        return 'get'
    if method == 'DELETE':
        return 'delete'
    if method in ('PUT', 'PATCH'):
        return 'update'
    if method == 'POST':
        return 'search' if path.endswith('/search') else 'create'
    return 'other'

# ---------- 4. variant classification from generated test names ----------
# Generated tests are named:
#   feature-N - <operationId> - <suffix>     (feature emitter — main scenarios)
#   variant-N - <operationId> - <suffix>     (variant emitter — schema/input variants)
#
# Suffix vocabulary observed in current output:
#   base                              -> happy-path
#   negative empty                    -> observe-absence (empty/no-match outcome)
#   bpmn | dmn | drd | form | path    -> data-driven  (deployment input variants)
#   cycle/<x>+<x>                     -> data-driven
#   oneOf <field> variant<N>          -> data-driven  (oneOf schema branches)
#   oneOf group<N> <description>      -> data-driven
#   scenario (numbered)               -> unlabeled    (dynamic — body would need inspection)
SUFFIX_AFTER_OPID_RE = re.compile(r'^(?:feature|variant)-\d+\s*-\s*[^\s-]+\s*-\s*(.*?)(?:\s*[#(]\d+[)]?)?$')
SCENARIO_RE = re.compile(r'^variant-\d+\s*-\s*scenario$')

# ---------- 4b. category (the A–O upstream buckets) ----------
CRUD_ENTITIES = {
    'user', 'group', 'role', 'tenant', 'mapping-rule', 'authorization',
    'cluster-variables', 'global-task-listener', 'document',
}
DEPLOYMENT_ENTITIES = {
    'resource', 'process-definition', 'decision-definition', 'decision-requirements',
}
OBSERVATION_ENTITIES = {'element-instance', 'variable', 'audit-log'}
MESSAGING_ENTITIES = {'message', 'signal', 'message-subscriptions', 'correlated-message-subscription'}
ENGINE_EVAL_ENTITIES = {'expression', 'conditional'}
SYSTEM_ENTITIES = {
    'authentication', 'cluster', 'license', 'clock', 'usage-metrics', 'optimize',
    'system', 'setup', 'status', 'topology',
}
MEMBERSHIP_OP_RE = re.compile(r'^(assign|unassign)([A-Z][A-Za-z]*?)(To|From)([A-Z][A-Za-z]*)$')
# Upstream also classifies "list members of X" search endpoints (e.g.
# searchUsersForGroup, searchClientsForTenant) as Membership/Association.
MEMBERSHIP_LIST_RE = re.compile(r'^search[A-Z][A-Za-z]*(For|In)(Group|Role|Tenant)$')

def category_of(op_id, entity):
    if MEMBERSHIP_OP_RE.match(op_id) or MEMBERSHIP_LIST_RE.match(op_id):
        return 'B. Membership/Association'
    if entity in CRUD_ENTITIES:
        return 'A. Entity Lifecycle (CRUD)'
    if entity in DEPLOYMENT_ENTITIES:
        return 'C. Deployment Lifecycle'
    if entity == 'process-instance':
        return 'D. Process-Instance Lifecycle & Ops'
    if entity in ('batch-operation', 'batch-operation-item'):
        return 'E. Batch-Operation Lifecycle'
    if entity == 'user-task':
        return 'F. User-Task Lifecycle'
    if entity == 'job':
        return 'G. Job Lifecycle & Stats'
    if entity == 'incident':
        return 'H. Incident Lifecycle'
    if entity == 'decision-instance':
        return 'I. Decision-Instance Lifecycle'
    if entity in OBSERVATION_ENTITIES:
        return 'J/K/L. Observation-only'
    if entity in MESSAGING_ENTITIES:
        return 'M. Messaging/Signals'
    if entity in ENGINE_EVAL_ENTITIES:
        return 'N. Engine Evaluation'
    if entity in SYSTEM_ENTITIES:
        return 'O. System/Admin'
    if entity == 'agent-instance':
        return 'P. Agent-Instance (new in v2)'
    return 'Z. Uncategorised'

# ---------- 4c. form step (lifecycle phase) ----------
# Generator's variant vocabulary is simpler than upstream's (no 401/403/400/etc.),
# so the form-step set we actually produce is a subset.
def form_step_of(operation, variants):
    if variants == 'observe-absence':
        return 'observe-absence'
    if operation == 'create':
        return 'create'
    if operation == 'delete':
        return 'delete'
    if operation == 'update':
        return 'mutate'
    if operation == 'get':
        return 'observe-present-get'
    if operation == 'search':
        return 'observe-present-search'
    return 'other'

# ---------- 4d. prerequisite per entity (copied from upstream + v2 additions) ----------
PREREQ_BY_ENTITY = {
    # root-creatable
    'user': 'none', 'group': 'none', 'role': 'none', 'tenant': 'none',
    'mapping-rule': 'none', 'cluster-variables': 'none',
    'global-task-listener': 'none', 'document': 'none',
    'clock': 'none', 'license': 'none', 'cluster': 'none',
    'optimize': 'none', 'expression': 'none', 'conditional': 'none',
    'system': 'none', 'setup': 'none', 'status': 'none', 'topology': 'none',
    'authentication': 'authenticated-user',
    'authorization': 'owner-entity-or-resource',

    # Deployment-driven
    'resource': 'none',
    'process-definition': 'deployed-process',
    'decision-definition': 'deployed-decision',
    'decision-requirements': 'deployed-drd',

    # Process-instance-driven
    'process-instance': 'deployed-process',
    'element-instance': 'running-process-instance',
    'variable': 'running-process-instance',
    'user-task': 'running-process-instance-with-user-task',
    'incident': 'running-process-instance-with-failing-job',
    'job': 'running-process-instance-with-job',
    'batch-operation': 'running-process-instance(s)',
    'batch-operation-item': 'running-batch-operation',
    'decision-instance': 'deployed-decision',

    # Events
    'message': 'deployed-process-with-message-catch-event',
    'signal': 'deployed-process-with-signal-catch-event',
    'message-subscriptions': 'deployed-process-with-message-catch-event',
    'correlated-message-subscription': 'deployed-process-with-message-catch-event + correlated-message',

    # Observation
    'audit-log': 'any-prior-action',
    'usage-metrics': 'metered-activity',

    # New in v2
    'agent-instance': 'unknown',
}
def prerequisite_of(op_id, entity):
    m = MEMBERSHIP_OP_RE.match(op_id)
    if m:
        member = m.group(2)
        parent = m.group(4)
        return f'{parent.lower()} + {member.lower()}'
    m2 = MEMBERSHIP_LIST_RE.match(op_id)
    if m2:
        # e.g. searchClientsForTenant -> member=clients, parent=tenant
        members = op_id[len('search'):].split('For' if 'For' in op_id else 'In')[0]
        parent = m2.group(2).lower()
        member = members.lower().rstrip('s')
        return f'{parent} + {member}'
    return PREREQ_BY_ENTITY.get(entity, 'unknown')

def variants_of(test_name):
    if SCENARIO_RE.match(test_name):
        return 'unlabeled'
    m = SUFFIX_AFTER_OPID_RE.match(test_name)
    if not m:
        return 'unlabeled'
    suffix = m.group(1).strip().lower()
    if suffix == 'base':
        return 'happy-path'
    if suffix.startswith('negative empty'):
        return 'observe-absence'
    if suffix.startswith('oneof '):
        return 'data-driven'
    if suffix in {'bpmn', 'dmn', 'drd', 'form', 'path'} or suffix.startswith('cycle/'):
        return 'data-driven'
    return 'unlabeled'

# ---------- 5. walk spec files, extract every test() call ----------
TEST_RE = re.compile(
    r"""(?m)^[ \t]*test(?:\.(?:skip|only|fixme|fail))?\s*\(\s*['"`]([^'"`]+)['"`]"""
)
SPEC_FILE_RE = re.compile(r'^(?P<op>[A-Za-z][A-Za-z0-9]*)\.(feature|variant)\.spec\.ts$')

rows = []
unresolved_ops = set()
for f in sorted(os.listdir(PLAYWRIGHT_DIR)):
    m = SPEC_FILE_RE.match(f)
    if not m:
        continue
    op_id = m.group('op')
    method_path = OPS.get(op_id)
    if not method_path:
        unresolved_ops.add(op_id)
        method = ''
        path = ''
        entity = 'unknown'
        operation = 'other'
    else:
        method, path = method_path
        entity = entity_of_path(path)
        operation = operation_of(op_id, method, path)

    full = os.path.join(PLAYWRIGHT_DIR, f)
    with open(full, encoding='utf-8') as fp:
        content = fp.read()
    for tm in TEST_RE.finditer(content):
        name = tm.group(1)
        line_no = content.count('\n', 0, tm.start()) + 1
        variants = variants_of(name)
        rows.append({
            'file': f,
            'line': line_no,
            'entity': entity,
            'operation': operation,
            'method': method,
            'path': path,
            'operationId': op_id,
            'category': category_of(op_id, entity),
            'form_step': form_step_of(operation, variants),
            'prerequisite': prerequisite_of(op_id, entity),
            'variants': variants,
            'test_name': name,
        })

# ---------- 6. write tests.csv ----------
tests_csv = os.path.join(OUT, 'tests.csv')
with open(tests_csv, 'w', newline='', encoding='utf-8') as fp:
    w = csv.DictWriter(fp, fieldnames=['file','line','entity','category','operation','form_step','prerequisite','method','path','operationId','variants','test_name'])
    w.writeheader()
    w.writerows(rows)
print(f"wrote {tests_csv} ({len(rows)} test declarations)")
if unresolved_ops:
    print(f"  warning: {len(unresolved_ops)} operationId(s) not found in OpenAPI spec: {sorted(unresolved_ops)[:5]}{'...' if len(unresolved_ops)>5 else ''}")

# ---------- 7. coverage matrix: entity x operation x variant ----------
# Same columns as upstream coverage_matrix.csv so the two files can be diffed.
variant_cols = ['happy-path','bad-request','unauthorized','forbidden','not-found',
                'conflict','pagination-sort','filter','observe-absence','data-driven','unlabeled']
op_order = ['create','get','update','delete','search','other','parameterized']

matrix = defaultdict(lambda: defaultdict(lambda: defaultdict(int)))
entity_totals = defaultdict(int)
for r in rows:
    entity_totals[r['entity']] += 1
    for v in (r['variants'].split('|') if r['variants'] else ['unlabeled']):
        matrix[r['entity']][r['operation']][v] += 1

mat_csv = os.path.join(OUT, 'coverage_matrix.csv')
with open(mat_csv, 'w', newline='', encoding='utf-8') as fp:
    w = csv.writer(fp)
    w.writerow(['entity','operation','total'] + variant_cols)
    for ent in sorted(entity_totals, key=lambda x: -entity_totals[x]):
        for op in op_order:
            cell = matrix[ent].get(op, {})
            total = sum(cell.values())
            if total == 0:
                continue
            w.writerow([ent, op, total] + [cell.get(v, 0) for v in variant_cols])
print(f"wrote {mat_csv}")

# ---------- 8. coverage_matrix.md ----------
md_path = os.path.join(OUT, 'coverage_matrix.md')
header_vars = ['happy','bad-req','401','403','404','conflict','pagin/sort','filter','absence','data-driven','unlabeled']
var_keys    = ['happy-path','bad-request','unauthorized','forbidden','not-found','conflict','pagination-sort','filter','observe-absence','data-driven','unlabeled']
with open(md_path, 'w', encoding='utf-8') as fp:
    fp.write('# api-test-generator — Coverage matrix (entity × operation × variant)\n\n')
    fp.write(f'Total test declarations: **{len(rows)}** across **{len(entity_totals)}** entities.\n\n')
    fp.write('Variants are first-match labels derived from the generator\'s emitter suffix '
             '(`base`, `negative empty`, `bpmn|dmn|drd|form|path|cycle/...`, `oneOf ...`, `scenario`). '
             'See `build_coverage.py` for the rule table.\n\n')
    fp.write('Legend: ✓ = at least 1, blank = 0.\n\n')

    fp.write('## At-a-glance presence (✓ = ≥1 test)\n\n')
    fp.write('| entity | op | total | ' + ' | '.join(header_vars) + ' |\n')
    fp.write('|--|--|--:|' + '|'.join(['--']*len(header_vars)) + '|\n')
    for ent in sorted(entity_totals, key=lambda x: -entity_totals[x]):
        for op in op_order:
            cell = matrix[ent].get(op, {})
            total = sum(cell.values())
            if total == 0:
                continue
            marks = ['✓' if cell.get(v,0) > 0 else '' for v in var_keys]
            fp.write(f'| {ent} | {op} | {total} | ' + ' | '.join(marks) + ' |\n')

    fp.write('\n## Counts per cell\n\n')
    fp.write('| entity | op | total | ' + ' | '.join(header_vars) + ' |\n')
    fp.write('|--|--|--:|' + '|'.join(['--:']*len(header_vars)) + '|\n')
    for ent in sorted(entity_totals, key=lambda x: -entity_totals[x]):
        for op in op_order:
            cell = matrix[ent].get(op, {})
            total = sum(cell.values())
            if total == 0:
                continue
            nums = [str(cell.get(v,0)) if cell.get(v,0)>0 else '' for v in var_keys]
            fp.write(f'| {ent} | {op} | {total} | ' + ' | '.join(nums) + ' |\n')
print(f"wrote {md_path}")

# ---------- 9. gaps.md ----------
gaps_path = os.path.join(OUT, 'gaps.md')
with open(gaps_path, 'w', encoding='utf-8') as fp:
    fp.write('# Coverage gaps (heuristic)\n\n')
    fp.write(f'Computed across **{len(rows)}** generated test declarations in '
             f'**{len(entity_totals)}** entities.\n\n')

    fp.write('## Entities missing delete-then-observe-absence variant\n\n')
    fp.write('Entities that have both `create` and `delete` tests but no test tagged `observe-absence` '
             '(no negative-after-delete check).\n\n')
    any_missing = False
    for ent in sorted(entity_totals):
        cell = matrix[ent]
        has_create = sum(cell.get('create', {}).values()) > 0
        has_delete = sum(cell.get('delete', {}).values()) > 0
        absence_hits = sum(cell.get(op, {}).get('observe-absence', 0) for op in op_order)
        if has_create and has_delete and absence_hits == 0:
            fp.write(f'- **{ent}** — has create+delete but no `observe-absence` test\n')
            any_missing = True
    if not any_missing:
        fp.write('- _(none)_\n')

    fp.write('\n## Entities with no unauthorized (401) coverage\n\n')
    for ent in sorted(entity_totals):
        if not any(c.get('unauthorized', 0) for c in matrix[ent].values()):
            fp.write(f'- {ent}\n')

    fp.write('\n## Entities with no forbidden (403) coverage\n\n')
    for ent in sorted(entity_totals):
        if not any(c.get('forbidden', 0) for c in matrix[ent].values()):
            fp.write(f'- {ent}\n')

    fp.write('\n## Entities with no bad-request (400) coverage\n\n')
    for ent in sorted(entity_totals):
        if not any(c.get('bad-request', 0) for c in matrix[ent].values()):
            fp.write(f'- {ent}\n')

    fp.write('\n## Entities with no not-found (404) coverage\n\n')
    for ent in sorted(entity_totals):
        if not any(c.get('not-found', 0) for c in matrix[ent].values()):
            fp.write(f'- {ent}\n')

    fp.write('\n## Entities with no conflict (409) coverage\n\n')
    for ent in sorted(entity_totals):
        if not any(c.get('conflict', 0) for c in matrix[ent].values()):
            fp.write(f'- {ent}\n')

    fp.write('\n## Search ops with no pagination/sort or filter coverage\n\n')
    fp.write('Search operations that have tests but none labeled `pagination-sort` or `filter`.\n\n')
    for ent in sorted(entity_totals):
        cell = matrix[ent].get('search', {})
        if not cell:
            continue
        if cell.get('pagination-sort', 0) == 0 and cell.get('filter', 0) == 0:
            fp.write(f'- {ent} (search): no pagination-sort/filter labels\n')
print(f"wrote {gaps_path}")

# ---------- 10. category_breakdown.md ----------
# Mirrors upstream's per-category breakdown: Form + per-entity prerequisite,
# observation channel split, form-step counts, variants, and the test rows.
CANONICAL_FORM = {
    'A. Entity Lifecycle (CRUD)':
        'Create Entity → Get Entity (Observe Present) → Update Entity → Search Entity (Observe via list) → Delete Entity → Get Entity (Observe Absence)',
    'B. Membership/Association':
        'Create parent + member (prerequisite) → Assign member → Search members (Observe Present) → Unassign member → Search members (Observe Absence)',
    'C. Deployment Lifecycle':
        'Deploy resource → Get definition (XML/JSON) → Search definitions (Observe Present) → Delete resource → Get definition (Observe Absence)',
    'D. Process-Instance Lifecycle & Ops':
        'Deploy process (prerequisite) → Create instance → Get/Search instance → Cancel/Migrate/Modify/Resolve-incident → Delete → Observe absence. Batch creators wrap N instances per call.',
    'E. Batch-Operation Lifecycle':
        'Create batch (via batch-creating process-instance APIs, prerequisite) → Get batch → Search batch → Search items → Suspend → Cancel',
    'F. User-Task Lifecycle':
        'Deploy process w/ user task (prerequisite) → Create instance → Assign → Update → Search/Get → Get form → Search variables → Complete → Unassign',
    'G. Job Lifecycle & Stats':
        'Deploy process w/ job (prerequisite) → Activate → Complete / Fail / Error / Update → Search jobs → Aggregate (5 statistics endpoints)',
    'H. Incident Lifecycle':
        'Deploy process + failing job (prerequisite) → Incident raised → Get incident → Search → Resolve → Statistics (by definition / by error)',
    'I. Decision-Instance Lifecycle':
        'Deploy DRD/DMN (prerequisite) → Evaluate → Get instance → Search → Delete (single + batch) → Search (Observe Absence)',
    'J/K/L. Observation-only':
        'Perform an action elsewhere (prerequisite) → Get / Search to observe',
    'M. Messaging/Signals':
        'Deploy process with catch event (prerequisite) → Publish/Correlate/Broadcast → Search subscriptions / correlated messages',
    'N. Engine Evaluation':
        'Submit expression / conditional → Receive result (stateless, no entity persisted)',
    'O. System/Admin':
        'Read system state (auth, license, cluster, clock, metrics) or perform admin action (pin/reset clock)',
    'P. Agent-Instance (new in v2)':
        'New v2 endpoint family — get / search agent instances (lifecycle TBD)',
    'Z. Uncategorised':
        '(no canonical form)',
}

cat_order = [
    'A. Entity Lifecycle (CRUD)',
    'B. Membership/Association',
    'C. Deployment Lifecycle',
    'D. Process-Instance Lifecycle & Ops',
    'E. Batch-Operation Lifecycle',
    'F. User-Task Lifecycle',
    'G. Job Lifecycle & Stats',
    'H. Incident Lifecycle',
    'I. Decision-Instance Lifecycle',
    'J/K/L. Observation-only',
    'M. Messaging/Signals',
    'N. Engine Evaluation',
    'O. System/Admin',
    'P. Agent-Instance (new in v2)',
    'Z. Uncategorised',
]
form_step_order = [
    'create', 'observe-present-get', 'observe-present-search', 'mutate',
    'delete', 'observe-absence', 'other',
]
variant_order = [
    'happy-path', 'observe-absence', 'data-driven', 'unlabeled',
    'bad-request', 'unauthorized', 'forbidden', 'not-found', 'conflict',
    'pagination-sort', 'filter',
]

by_cat = defaultdict(list)
for r in rows:
    by_cat[r['category']].append(r)

cat_path = os.path.join(OUT, 'category_breakdown.md')
fp = open(cat_path, 'w', encoding='utf-8')
fp.write('# api-test-generator — Per-category breakdown\n\n')
fp.write(f'Total test declarations: **{len(rows)}** across **{len(entity_totals)}** entities.\n\n')
fp.write('This file answers, per category: **(1) Form** (the canonical sequence), '
         '**(2) Prerequisite to create**, **(3) Observation channel split** (GET vs Search), '
         '**(4) Variants with counts**, **(5) The actual tests in that category**.\n\n')
fp.write('Categories and the entity → category mapping mirror the upstream '
         '`c8-orchestration-cluster-e2e-test-suite/coverage-analysis/category_breakdown.md` '
         'so the two files can be diffed side-by-side.\n\n')

fp.write('## Table of contents\n\n')
def anchor(cat):
    a = cat.lower().replace('. ', '-').replace(' ', '-')
    for ch in '/()&,':
        a = a.replace(ch, '')
    return a
for cat in cat_order:
    if cat in by_cat:
        fp.write(f'- [{cat}](#{anchor(cat)}) — {len(by_cat[cat])} tests\n')
fp.write('\n')

step_idx = {s: i for i, s in enumerate(form_step_order)}
for cat in cat_order:
    if cat not in by_cat:
        continue
    cat_rows = by_cat[cat]
    fp.write(f'## {cat}\n\n')
    fp.write(f'**Form**: {CANONICAL_FORM.get(cat, "(no canonical form)")}\n\n')
    fp.write(f'**Total tests**: {len(cat_rows)}\n\n')

    by_ent = defaultdict(list)
    for r in cat_rows:
        by_ent[r['entity']].append(r)

    for ent in sorted(by_ent, key=lambda x: -len(by_ent[x])):
        ent_rows = by_ent[ent]
        prereqs = sorted({r['prerequisite'] for r in ent_rows})
        prereq_str = ', '.join(prereqs)

        step_counts = defaultdict(int)
        for r in ent_rows:
            step_counts[r['form_step']] += 1

        obs_get    = sum(1 for r in ent_rows if r['form_step'] == 'observe-present-get')
        obs_search = sum(1 for r in ent_rows if r['form_step'] == 'observe-present-search')

        var_counts = defaultdict(int)
        for r in ent_rows:
            var_counts[r['variants']] += 1

        files = sorted({r['file'] for r in ent_rows})

        fp.write(f'### `{ent}` — {len(ent_rows)} tests\n\n')
        fp.write(f'- **Prerequisite to create**: {prereq_str}\n')
        fp.write(f'- **Files**: {", ".join(f"`{f}`" for f in files)}\n')
        fp.write(f'- **Observation channel**: GET = {obs_get}, Search = {obs_search}\n')

        step_line = ', '.join(f'{s}={step_counts[s]}' for s in form_step_order if step_counts.get(s,0))
        fp.write(f'- **Form-step counts**: {step_line}\n')

        var_line = ', '.join(f'{v}={var_counts[v]}' for v in variant_order if var_counts.get(v,0))
        fp.write(f'- **Variants**: {var_line}\n\n')

        fp.write('| form step | variants | file:line | test name |\n')
        fp.write('|--|--|--|--|\n')
        sorted_rows = sorted(
            ent_rows,
            key=lambda r: (step_idx.get(r['form_step'], 999), r['file'], r['line']),
        )
        for r in sorted_rows:
            fp.write(f'| {r["form_step"]} | {r["variants"] or "—"} | '
                     f'`{r["file"]}:{r["line"]}` | {r["test_name"]} |\n')
        fp.write('\n')

fp.close()
print(f"wrote {cat_path}")
