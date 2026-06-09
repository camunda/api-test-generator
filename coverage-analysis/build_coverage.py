#!/usr/bin/env python3
"""
Build api-test-generator coverage matrix in the same shape as the upstream
c8-orchestration-cluster-e2e-test-suite/coverage-analysis/coverage_matrix.csv.

Run from this script's directory:
    python3 build_coverage.py

Scans every generator test source and emits, next to this script:
  - tests.csv           : per-test labels (file, line, source, entity, operation, variants, test_name, ...)
  - coverage_matrix.csv : entity x operation grid, variant counts (same columns as upstream)
  - coverage_matrix.md, gaps.md, category_breakdown.md

Test sources scanned (layout as of the secured/unsecured profile split #346,
RBAC deny tests #359, and the templates/ lifecycle relocation):
  - generated/camunda-oca/playwright/*.feature.spec.ts                         (feature emitter, happy + observe-absence)
  - generated/camunda-oca/playwright/*.variant.spec.ts                         (variant emitter, schema/input variants)
  - generated/camunda-oca/playwright/templates/EdgeLifecycle/*.spec.ts         (edge lifecycle: establish -> present -> revoke -> absent)
  - generated/camunda-oca/playwright/templates/EntityLifecycle/*.spec.ts       (entity lifecycle: create -> present -> update -> present -> delete -> absent)
  - generated/camunda-oca/playwright/templates/StateTransitionVisibleAfterAction/*.spec.ts (state transition -> read-back)
  - generated/camunda-oca/playwright/templates/UpdatedFieldVisibleOnReadBack/*.spec.ts     (field mutation -> read-back)
  - generated/camunda-oca/request-validation/unsecured/*.spec.ts               (negative: 400 bad-request + 404 not-found)
  - generated/camunda-oca/request-validation/rbac/*.spec.ts                    (RBAC deny: 403 forbidden)
  - generated/camunda-oca/request-validation/secured/*.spec.ts                 (401 auth-absent only; the rest duplicate unsecured)

Each request-validation test's bucket (bad-request / not-found / forbidden /
unauthorized / conflict) is derived from its asserted HTTP status, not assumed.
"""
import csv
import json
import os
import re
from collections import defaultdict

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PLAYWRIGHT_DIR = os.path.normpath(os.path.join(SCRIPT_DIR, '..', 'generated', 'camunda-oca', 'playwright'))
TEMPLATES_DIR = os.path.join(PLAYWRIGHT_DIR, 'templates')
EDGES_DIR = os.path.join(TEMPLATES_DIR, 'EdgeLifecycle')
ENTITIES_DIR = os.path.join(TEMPLATES_DIR, 'EntityLifecycle')
STATE_TRANSITION_DIR = os.path.join(TEMPLATES_DIR, 'StateTransitionVisibleAfterAction')
READBACK_DIR = os.path.join(TEMPLATES_DIR, 'UpdatedFieldVisibleOnReadBack')
# request-validation is emitted as parallel profiles since the secured/unsecured
# split (#346) and RBAC deny tests (#359). unsecured/ is the 400+404 baseline;
# rbac/ adds 403 deny tests; secured/ duplicates unsecured plus 401 auth-absent
# (dormant unless the spec carries x-enforcement annotations — the pinned OCA
# spec does not, so on it secured == unsecured).
REQVAL_DIR = os.path.normpath(os.path.join(SCRIPT_DIR, '..', 'generated', 'camunda-oca', 'request-validation'))
REQVAL_UNSECURED = os.path.join(REQVAL_DIR, 'unsecured')
REQVAL_RBAC = os.path.join(REQVAL_DIR, 'rbac')
REQVAL_SECURED = os.path.join(REQVAL_DIR, 'secured')
EDGES_ABOX = os.path.normpath(os.path.join(SCRIPT_DIR, '..', 'configs', 'camunda-oca', 'ontology', 'edges.json'))
SPEC_PATH = os.path.normpath(os.path.join(SCRIPT_DIR, '..', 'spec', 'camunda-oca', 'bundled', 'rest-api.bundle.json'))
OUT = SCRIPT_DIR

# ---------- 1. operationId -> (METHOD, path) from the bundled OpenAPI ----------
def load_ops():
    with open(SPEC_PATH, encoding='utf-8') as fp:
        spec = json.load(fp)
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

# Fail fast with a diagnostic message if the inputs haven't been generated yet,
# rather than crashing deep in load_ops()/the scan with a bare FileNotFoundError.
# spec/ and generated/ are gitignored — see the Regenerate section in README.md.
def _preflight():
    missing = [p for p in (SPEC_PATH, PLAYWRIGHT_DIR) if not os.path.exists(p)]
    if missing:
        raise SystemExit(
            'coverage-analysis: required generator output is missing:\n'
            + '\n'.join(f'  - {p}' for p in missing)
            + '\n\nRun the generator first (spec/ and generated/ are gitignored):\n'
              '  npm run pipeline\n'
              '  python3 coverage-analysis/build_coverage.py\n'
        )

_preflight()

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
    'forms': 'user-task',  # forms are intrinsically tied to user tasks; folded into F. User-Task Lifecycle
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
    ('delete',   re.compile(r'^(delete|remove|unassign|cancel)', re.I)),
    # `reset` is an admin state reset (e.g. resetClock = POST /clock/reset), not entity deletion —
    # classify as update so it doesn't show up as a missing observe-absence in gaps.md.
    ('update',   re.compile(r'^(update|assign|complete|migrate|modify|resolve|fail|resume|suspend|patch|put|reset)', re.I)),
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
    # variants is a multi-label '|'-joined string (e.g. 'happy-path|observe-absence'),
    # so test membership rather than exact equality.
    if 'observe-absence' in variants.split('|'):
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
def _camel_to_kebab(s):
    # 'MappingRule' -> 'mapping-rule', 'Group' -> 'group'
    return re.sub(r'(?<!^)(?=[A-Z])', '-', s).lower()

def prerequisite_of(op_id, entity):
    m = MEMBERSHIP_OP_RE.match(op_id)
    if m:
        return f'{_camel_to_kebab(m.group(4))} + {_camel_to_kebab(m.group(2))}'
    m2 = MEMBERSHIP_LIST_RE.match(op_id)
    if m2:
        # e.g. searchClientsForTenant -> member=clients, parent=tenant
        members = op_id[len('search'):].split('For' if 'For' in op_id else 'In')[0]
        parent = _camel_to_kebab(m2.group(2))
        member = _camel_to_kebab(members).rstrip('s')
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
# playwright/<operationId>.feature.spec.ts  /  <operationId>.variant.spec.ts
SPEC_FILE_RE = re.compile(r'^(?P<op>[A-Za-z][A-Za-z0-9]*)\.(?P<src>feature|variant)\.spec\.ts$')
# playwright/edges/<EdgeName>.lifecycle.spec.ts
EDGE_FILE_RE = re.compile(r'^(?P<edge>[A-Za-z][A-Za-z0-9]*)\.lifecycle\.spec\.ts$')
# playwright/entities/<EntityName>.lifecycle.spec.ts
ENTITY_FILE_RE = re.compile(r'^(?P<entity>[A-Za-z][A-Za-z0-9]*)\.lifecycle\.spec\.ts$')

# Map PascalCase entity name from filename to our entity slug.
PASCAL_TO_SLUG = {
    'Authorization': 'authorization',
    'Document': 'document',
    'GlobalClusterVariable': 'cluster-variables',   # global namespace of cluster-variables
    'TenantClusterVariable': 'cluster-variables',   # tenant namespace of cluster-variables
    'GlobalTaskListener': 'global-task-listener',
    'Group': 'group',
    'MappingRule': 'mapping-rule',
    'Role': 'role',
    'Tenant': 'tenant',
    'User': 'user',
}
# request-validation/<entity-slug>-validation-api-tests.spec.ts  (test names start with operationId)
REQVAL_TEST_NAME_RE = re.compile(r'^(?P<op>[A-Za-z][A-Za-z0-9]*)\s*-\s*(?P<desc>.*)$')

# Load edge ABox so we can map an EdgeName (e.g. RoleUserMembership) to its
# establishedBy operationId (assignRoleToUser) -> entity (role) via the spec.
def load_edge_index():
    try:
        with open(EDGES_ABOX, encoding='utf-8') as fp:
            edges = json.load(fp)
    except FileNotFoundError:
        return {}
    idx = {}
    for e in edges.get('edges', []):
        name = e.get('name')
        eb = e.get('establishedBy')
        op_id = eb.get('operationId') if isinstance(eb, dict) else eb
        if name and op_id:
            idx[name] = op_id
    return idx

EDGE_INDEX = load_edge_index()

# Detect pagination/filter exercise in a test body. We match on the
# field-assignment form ('page: {', 'filter: {') so response-access
# expressions (e.g. `json?.page?.startCursor`) don't false-positive.
PAGINATION_BODY_RE = re.compile(r'\bpage\s*:\s*\{|\bsort\s*:\s*\[')
FILTER_BODY_RE = re.compile(r'\bfilter\s*:\s*\{')

# Each negative test asserts its expected HTTP status as the 3rd arg of
# assertResponseStatus(testInfo, res, <status>, ...). We read it per-test and
# map it to the matrix variant column, rather than assuming every
# request-validation test is a 400 (true before #346/#359, not after).
STATUS_RE = re.compile(r'assertResponseStatus\(\s*\w+\s*,\s*\w+\s*,\s*(\d{3})')
STATUS_VARIANT = {
    '400': 'bad-request',
    '401': 'unauthorized',
    '403': 'forbidden',
    '404': 'not-found',
    '409': 'conflict',
}

def status_variant_of(body, default='bad-request'):
    m = STATUS_RE.search(body)
    return STATUS_VARIANT.get(m.group(1), default) if m else default

def read_tests(path):
    """Yield (test_name, line_number, body_text) per test() block. body_text
    is the source from the test() start to the next test() start (or EOF),
    used for body-shape variant detection (pagination/filter)."""
    with open(path, encoding='utf-8') as fp:
        content = fp.read()
    matches = list(TEST_RE.finditer(content))
    out = []
    for i, tm in enumerate(matches):
        line_no = content.count('\n', 0, tm.start()) + 1
        body_end = matches[i+1].start() if i+1 < len(matches) else len(content)
        body = content[tm.start():body_end]
        out.append((tm.group(1), line_no, body))
    return out

def body_extra_variants(body):
    extras = []
    if PAGINATION_BODY_RE.search(body):
        extras.append('pagination-sort')
    if FILTER_BODY_RE.search(body):
        extras.append('filter')
    return extras

def resolve_op(op_id):
    """operationId -> (method, path, entity, operation). Falls back to 'unknown' if not in spec."""
    method_path = OPS.get(op_id)
    if not method_path:
        return '', '', 'unknown', 'other'
    method, path = method_path
    return method, path, entity_of_path(path), operation_of(op_id, method, path)

rows = []
unresolved_ops = set()

# --- 5a. playwright/*.feature.spec.ts and *.variant.spec.ts ---
for f in sorted(os.listdir(PLAYWRIGHT_DIR)):
    m = SPEC_FILE_RE.match(f)
    if not m:
        continue
    op_id = m.group('op')
    source = m.group('src')  # 'feature' or 'variant'
    method, path, entity, operation = resolve_op(op_id)
    if entity == 'unknown':
        unresolved_ops.add(op_id)
    for name, line_no, body in read_tests(os.path.join(PLAYWRIGHT_DIR, f)):
        variants = variants_of(name)
        # Augment with body-detected shape variants (pagination/filter) —
        # these are observable from the request body, not the test name.
        # `unlabeled` is preserved alongside extras because it describes the
        # NAME classification ("no info derivable from test name"); a dynamic
        # `variant-N - scenario` test that also has a filter body is both
        # name-unlabeled and body-filter, so it carries both labels.
        extras = body_extra_variants(body)
        if extras:
            base = variants.split('|')
            variants = '|'.join(base + [e for e in extras if e not in base])
        rows.append({
            'file': f, 'line': line_no, 'source': source,
            'entity': entity, 'operation': operation,
            'method': method, 'path': path, 'operationId': op_id,
            'category': category_of(op_id, entity),
            'form_step': form_step_of(operation, variants),
            'prerequisite': prerequisite_of(op_id, entity),
            'variants': variants,
            'test_name': name,
        })

# --- 5b. playwright/edges/*.lifecycle.spec.ts ---
# Each test exercises establish -> observe present -> revoke -> observe absent,
# so we tag it with multi-label variants (happy-path|observe-absence) and a
# dedicated 'lifecycle' form step. Entity comes from the establishedBy op's path.
if os.path.isdir(EDGES_DIR):
    for f in sorted(os.listdir(EDGES_DIR)):
        m = EDGE_FILE_RE.match(f)
        if not m:
            continue
        edge_name = m.group('edge')
        op_id = EDGE_INDEX.get(edge_name, '')
        if op_id:
            method, path, entity, operation = resolve_op(op_id)
        else:
            method, path, entity, operation = '', '', 'unknown', 'lifecycle'
        for name, line_no, _body in read_tests(os.path.join(EDGES_DIR, f)):
            rows.append({
                'file': f'templates/EdgeLifecycle/{f}', 'line': line_no, 'source': 'lifecycle',
                'entity': entity, 'operation': 'lifecycle',
                'method': method, 'path': path, 'operationId': op_id,
                'category': 'B. Membership/Association',
                'form_step': 'lifecycle',
                'prerequisite': prerequisite_of(op_id, entity) if op_id else 'unknown',
                'variants': 'happy-path|observe-absence',
                'test_name': name,
            })

# --- 5b'. playwright/entities/*.lifecycle.spec.ts ---
# EntityLifecycle template: create -> observe present -> update -> observe ->
# delete -> observe absent. Single test() per entity. Tag with multi-label
# variants (happy-path|observe-absence) and form_step='lifecycle', category A
# (or B for membership-style entities; we keep it on entity).
if os.path.isdir(ENTITIES_DIR):
    for f in sorted(os.listdir(ENTITIES_DIR)):
        m = ENTITY_FILE_RE.match(f)
        if not m:
            continue
        ent_pascal = m.group('entity')
        entity = PASCAL_TO_SLUG.get(ent_pascal, ent_pascal.lower())
        for name, line_no, _body in read_tests(os.path.join(ENTITIES_DIR, f)):
            rows.append({
                'file': f'templates/EntityLifecycle/{f}', 'line': line_no, 'source': 'lifecycle',
                'entity': entity, 'operation': 'lifecycle',
                'method': '', 'path': '', 'operationId': '',
                'category': category_of('', entity),
                'form_step': 'lifecycle',
                'prerequisite': PREREQ_BY_ENTITY.get(entity, 'unknown'),
                'variants': 'happy-path|observe-absence',
                'test_name': name,
            })

# --- 5b''. new lifecycle templates (#305): StateTransitionVisibleAfterAction
# (invoke a state transition, read back the new state) and
# UpdatedFieldVisibleOnReadBack (mutate a field, read it back). Files are named
# <Entity>.<op>.lifecycle.spec.ts; the entity is the leading PascalCase segment.
for tdir, form in [(STATE_TRANSITION_DIR, 'state-transition'), (READBACK_DIR, 'read-back')]:
    if not os.path.isdir(tdir):
        continue
    tname = os.path.basename(tdir)
    for f in sorted(os.listdir(tdir)):
        if not f.endswith('.spec.ts'):
            continue
        ent_pascal = f.split('.')[0]
        entity = PASCAL_TO_SLUG.get(ent_pascal, _camel_to_kebab(ent_pascal))
        for name, line_no, _body in read_tests(os.path.join(tdir, f)):
            rows.append({
                'file': f'templates/{tname}/{f}', 'line': line_no, 'source': form,
                'entity': entity, 'operation': 'lifecycle',
                'method': '', 'path': '', 'operationId': '',
                'category': category_of('', entity),
                'form_step': form,
                'prerequisite': PREREQ_BY_ENTITY.get(entity, 'unknown'),
                'variants': 'happy-path',
                'test_name': name,
            })

# --- 5c. request-validation profiles (#346 split, #359 rbac) ---
# Test names start with the operationId: '<operationId> - <kind description>'.
# The matrix variant is derived from the asserted HTTP status (400 bad-request,
# 404 not-found, 403 forbidden, 401 unauthorized, 409 conflict), not assumed.
#   unsecured/ : 400 + 404 baseline negative suite.
#   rbac/      : 403 RBAC deny tests.
#   secured/   : duplicates unsecured PLUS 401 auth-absent — we take ONLY the 401
#                tests to avoid double-counting (0 on the pinned spec, which has
#                no x-enforcement annotations).
def emit_reqval(dirpath, source, only_variant=None):
    if not os.path.isdir(dirpath):
        return
    profile = os.path.basename(dirpath)
    for f in sorted(os.listdir(dirpath)):
        if not f.endswith('.spec.ts'):
            continue
        for name, line_no, body in read_tests(os.path.join(dirpath, f)):
            variant = status_variant_of(body)
            if only_variant is not None and variant != only_variant:
                continue
            tm = REQVAL_TEST_NAME_RE.match(name)
            op_id = tm.group('op') if tm else ''
            if op_id:
                method, path, entity, operation = resolve_op(op_id)
                if entity == 'unknown':
                    unresolved_ops.add(op_id)
            else:
                method, path, entity, operation = '', '', 'unknown', 'other'
            rows.append({
                'file': f'request-validation/{profile}/{f}', 'line': line_no, 'source': source,
                'entity': entity, 'operation': operation,
                'method': method, 'path': path, 'operationId': op_id,
                'category': category_of(op_id, entity),
                'form_step': f'negative-{operation}' if operation in ('create','get','update','delete','search') else 'negative-other',
                'prerequisite': prerequisite_of(op_id, entity),
                'variants': variant,
                'test_name': name,
            })

emit_reqval(REQVAL_UNSECURED, 'request-validation')             # 400 + 404
emit_reqval(REQVAL_RBAC, 'rbac-deny')                           # 403
emit_reqval(REQVAL_SECURED, 'auth-absent', only_variant='unauthorized')  # 401 only (0 on pinned spec)

# ---------- 6. write tests.csv ----------
tests_csv = os.path.join(OUT, 'tests.csv')
with open(tests_csv, 'w', newline='', encoding='utf-8') as fp:
    w = csv.DictWriter(fp, fieldnames=['file','line','source','entity','category','operation','form_step','prerequisite','method','path','operationId','variants','test_name'])
    w.writeheader()
    w.writerows(rows)
print(f"wrote {tests_csv} ({len(rows)} test declarations)")
if unresolved_ops:
    print(f"  warning: {len(unresolved_ops)} operationId(s) not found in OpenAPI spec: {sorted(unresolved_ops)[:5]}{'...' if len(unresolved_ops)>5 else ''}")

# ---------- 7. coverage matrix: entity x operation x variant ----------
# Same columns as upstream coverage_matrix.csv so the two files can be diffed.
variant_cols = ['happy-path','bad-request','unauthorized','forbidden','not-found',
                'conflict','pagination-sort','filter','observe-absence','data-driven','unlabeled']
op_order = ['create','get','update','delete','search','lifecycle','other','parameterized']

# Matches upstream coverage_matrix.csv semantics from camunda/camunda#53387:
# `total` is the unique-test count per (entity, operation) — one row per
# `test()` declaration. The variant columns are label-occurrence counts, so
# a multi-label test (e.g. lifecycle row tagged `happy-path|observe-absence`)
# counts in both columns but only once toward `total`.
matrix_variants = defaultdict(lambda: defaultdict(lambda: defaultdict(int)))
matrix_unique = defaultdict(lambda: defaultdict(int))
entity_totals = defaultdict(int)
for r in rows:
    entity_totals[r['entity']] += 1
    matrix_unique[r['entity']][r['operation']] += 1
    for v in (r['variants'].split('|') if r['variants'] else ['unlabeled']):
        matrix_variants[r['entity']][r['operation']][v] += 1

mat_csv = os.path.join(OUT, 'coverage_matrix.csv')
with open(mat_csv, 'w', newline='', encoding='utf-8') as fp:
    w = csv.writer(fp)
    w.writerow(['entity','operation','total'] + variant_cols)
    for ent in sorted(entity_totals, key=lambda x: -entity_totals[x]):
        for op in op_order:
            total = matrix_unique[ent].get(op, 0)
            if total == 0:
                continue
            cell = matrix_variants[ent].get(op, {})
            w.writerow([ent, op, total] + [cell.get(v, 0) for v in variant_cols])
print(f"wrote {mat_csv}")

# ---------- 8. coverage_matrix.md ----------
md_path = os.path.join(OUT, 'coverage_matrix.md')
header_vars = ['happy','bad-req','401','403','404','conflict','pagin/sort','filter','absence','data-driven','unlabeled']
var_keys    = ['happy-path','bad-request','unauthorized','forbidden','not-found','conflict','pagination-sort','filter','observe-absence','data-driven','unlabeled']
with open(md_path, 'w', encoding='utf-8') as fp:
    fp.write('# api-test-generator — Coverage matrix (entity × operation × variant)\n\n')
    fp.write(f'Total test declarations: **{len(rows)}** across **{len(entity_totals)}** entities.\n\n')
    fp.write('Variants are multi-label — a test can carry more than one tag, so '
             'matrix columns are **not** mutually exclusive (a lifecycle test tagged '
             '`happy-path|observe-absence` counts in both columns, but only once in '
             '`total`). Labels come from three sources: (1) test-name suffix '
             '(`base` → `happy-path`, `negative empty` → `observe-absence`, '
             '`bpmn`/`dmn`/`drd`/`form`/`path`/`cycle/...`/`oneOf ...` → `data-driven`, '
             '`variant-N - scenario` → `unlabeled`), '
             '(2) test-body shape (`page: {` / `sort: [` → `pagination-sort`, '
             '`filter: {` → `filter`), and (3) for the lifecycle emitters a fixed '
             '`happy-path|observe-absence`, while each request-validation test is '
             'bucketed by its asserted HTTP status (400 → `bad-request`, 404 → '
             '`not-found`, 403 → `forbidden`, 401 → `unauthorized`, 409 → `conflict`). '
             'See `build_coverage.py` for the rule table.\n\n')
    fp.write('Legend: ✓ = at least 1, blank = 0.\n\n')

    fp.write('## At-a-glance presence (✓ = ≥1 test)\n\n')
    fp.write('| entity | op | total | ' + ' | '.join(header_vars) + ' |\n')
    fp.write('|--|--|--:|' + '|'.join(['--']*len(header_vars)) + '|\n')
    for ent in sorted(entity_totals, key=lambda x: -entity_totals[x]):
        for op in op_order:
            cell = matrix_variants[ent].get(op, {})
            total = matrix_unique[ent].get(op, 0)
            if total == 0:
                continue
            marks = ['✓' if cell.get(v,0) > 0 else '' for v in var_keys]
            fp.write(f'| {ent} | {op} | {total} | ' + ' | '.join(marks) + ' |\n')

    fp.write('\n## Counts per cell\n\n')
    fp.write('| entity | op | total | ' + ' | '.join(header_vars) + ' |\n')
    fp.write('|--|--|--:|' + '|'.join(['--:']*len(header_vars)) + '|\n')
    for ent in sorted(entity_totals, key=lambda x: -entity_totals[x]):
        for op in op_order:
            cell = matrix_variants[ent].get(op, {})
            total = matrix_unique[ent].get(op, 0)
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
        cell = matrix_variants[ent]
        has_create = matrix_unique[ent].get('create', 0) > 0 or matrix_unique[ent].get('lifecycle', 0) > 0
        has_delete = matrix_unique[ent].get('delete', 0) > 0 or matrix_unique[ent].get('lifecycle', 0) > 0
        absence_hits = sum(cell.get(op, {}).get('observe-absence', 0) for op in op_order)
        if has_create and has_delete and absence_hits == 0:
            fp.write(f'- **{ent}** — has create+delete but no `observe-absence` test\n')
            any_missing = True
    if not any_missing:
        fp.write('- _(none)_\n')

    fp.write('\n## Entities with no unauthorized (401) coverage\n\n')
    for ent in sorted(entity_totals):
        if not any(c.get('unauthorized', 0) for c in matrix_variants[ent].values()):
            fp.write(f'- {ent}\n')

    fp.write('\n## Entities with no forbidden (403) coverage\n\n')
    for ent in sorted(entity_totals):
        if not any(c.get('forbidden', 0) for c in matrix_variants[ent].values()):
            fp.write(f'- {ent}\n')

    fp.write('\n## Entities with no bad-request (400) coverage\n\n')
    for ent in sorted(entity_totals):
        if not any(c.get('bad-request', 0) for c in matrix_variants[ent].values()):
            fp.write(f'- {ent}\n')

    fp.write('\n## Entities with no not-found (404) coverage\n\n')
    for ent in sorted(entity_totals):
        if not any(c.get('not-found', 0) for c in matrix_variants[ent].values()):
            fp.write(f'- {ent}\n')

    fp.write('\n## Entities with no conflict (409) coverage\n\n')
    for ent in sorted(entity_totals):
        if not any(c.get('conflict', 0) for c in matrix_variants[ent].values()):
            fp.write(f'- {ent}\n')

    fp.write('\n## Search ops with no pagination/sort or filter coverage\n\n')
    fp.write('Search operations that have tests but none labeled `pagination-sort` or `filter`.\n\n')
    any_search_gap = False
    for ent in sorted(entity_totals):
        cell = matrix_variants[ent].get('search', {})
        if not cell:
            continue
        if cell.get('pagination-sort', 0) == 0 and cell.get('filter', 0) == 0:
            fp.write(f'- {ent} (search): no pagination-sort/filter labels\n')
            any_search_gap = True
    if not any_search_gap:
        fp.write('- _(none)_\n')
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
    'delete', 'observe-absence', 'lifecycle',
    'negative-create', 'negative-get', 'negative-update', 'negative-delete',
    'negative-search', 'negative-other',
    'other',
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

        # Split multi-label variants ('happy-path|observe-absence') so each
        # label is counted independently — keeps these counts reconcilable
        # with the matrix column counts.
        var_counts = defaultdict(int)
        for r in ent_rows:
            for v in (r['variants'].split('|') if r['variants'] else ['unlabeled']):
                var_counts[v] += 1

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
            # Use ', ' between labels so multi-label variants (e.g.
            # 'happy-path|observe-absence') don't break the markdown table.
            variants_cell = r['variants'].replace('|', ', ') if r['variants'] else '—'
            test_name_cell = r['test_name'].replace('|', r'\|')
            fp.write(f'| {r["form_step"]} | {variants_cell} | '
                     f'`{r["file"]}:{r["line"]}` | {test_name_cell} |\n')
        fp.write('\n')

fp.close()
print(f"wrote {cat_path}")
