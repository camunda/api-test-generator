#!/usr/bin/env python3
"""
Spec-coverage-analyzer (spike for #277).

Given an OpenAPI 3.x bundle, emit a test plan derived purely from the spec,
tagging each plan item as either:
  - `computable`   — the analyzer can fully decide this from the spec alone
  - `needs-abox:X` — the analyzer cannot decide this without domain knowledge;
                    name the missing fact in X

No ABox integration in this spike. The needs-abox tags are surfaced
verbatim so we can quantify what's missing from the ontology before
building the integration.

Outputs (written next to this script):
  - plan.csv        — one row per (operation, plan-item) tuple
  - plan.md         — per-endpoint readable summary
  - needs-abox.md   — aggregated list of missing ABox facts, grouped by kind

Run:
    python3 build_plan.py [path/to/openapi.json]

Defaults to ../spec/camunda-oca/bundled/rest-api.bundle.json.
"""
import csv
import json
import os
import re
import sys
from collections import defaultdict

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_SPEC = os.path.normpath(os.path.join(SCRIPT_DIR, '..', 'spec', 'camunda-oca', 'bundled', 'rest-api.bundle.json'))
OUT = SCRIPT_DIR

# ---------- Spec loader with shallow $ref resolution ----------
def load_spec(path):
    with open(path) as fp:
        return json.load(fp)

def resolve_ref(spec, ref):
    """Resolve a single $ref like '#/components/schemas/X' to the target object.
    Returns the target dict, or {} if not found. No recursive deref — caller
    handles deeper walking.
    """
    if not isinstance(ref, str) or not ref.startswith('#/'):
        return {}
    cur = spec
    for part in ref[2:].split('/'):
        if not isinstance(cur, dict) or part not in cur:
            return {}
        cur = cur[part]
    return cur if isinstance(cur, dict) else {}

def deref(spec, obj):
    """If obj is a $ref, resolve it once. Returns the resolved (or original) object."""
    if isinstance(obj, dict) and '$ref' in obj and len(obj) == 1:
        return resolve_ref(spec, obj['$ref'])
    return obj

# ---------- Plan item helpers ----------
def plan_item(op_id, method, path, kind, detail, computable, abox_fact=None):
    return {
        'operationId': op_id,
        'method': method,
        'path': path,
        'kind': kind,
        'detail': detail,
        'computable': 'yes' if computable else 'no',
        'abox_fact': abox_fact or '',
    }

# ---------- Body-schema walker (shallow) ----------
def walk_body(spec, body_schema):
    """Yield (kind, detail) plan-suggestions from a request body schema.
    Only walks one level deep — sufficient for spike coverage.
    """
    s = deref(spec, body_schema)
    if not isinstance(s, dict):
        return

    # Required field list (missing-required-X)
    for req in s.get('required', []) or []:
        yield ('bad-request:missing-required', f'field={req}')

    # Object-shape: additionalProperties=false → extra-prop tests
    if s.get('additionalProperties') is False:
        yield ('bad-request:additional-property', 'closed schema')

    # Walk each declared property — emit enum/format/type-mismatch items
    props = s.get('properties', {}) or {}
    for pname, pdef in props.items():
        p = deref(spec, pdef)
        if not isinstance(p, dict):
            continue
        if p.get('enum'):
            yield ('bad-request:enum-violation', f'field={pname}, enum={p["enum"][:3]}{"…" if len(p["enum"])>3 else ""}')
        if p.get('format'):
            yield ('bad-request:format-invalid', f'field={pname}, format={p["format"]}')
        if 'type' in p and p['type'] in ('string', 'integer', 'number', 'boolean', 'array', 'object'):
            yield ('bad-request:type-mismatch', f'field={pname}, type={p["type"]}')
        # Numeric range
        if any(k in p for k in ('minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum')):
            yield ('bad-request:range-violation', f'field={pname}')

    # oneOf / anyOf → schema-branch tests
    if 'oneOf' in s:
        yield ('bad-request:oneof-violation', f'oneOf branches={len(s["oneOf"])}')
    if 'anyOf' in s:
        yield ('bad-request:oneof-violation', f'anyOf branches={len(s["anyOf"])}')

    # Recognised top-level fields that imply pagination/filter
    if 'page' in props:
        yield ('pagination-sort:request-shape', 'page object in body')
    if 'sort' in props:
        yield ('pagination-sort:request-shape', 'sort array in body')
    if 'filter' in props:
        yield ('filter:request-shape', 'filter object in body')

# ---------- Heuristics for business-entity detection ----------
STATE_TRANSITION_VERBS = (
    '/cancel', '/cancellation', '/complete', '/completion', '/resolve',
    '/resolution', '/migrate', '/modification', '/activate', '/activation',
    '/assignment', '/correlation', '/broadcast', '/publication',
)
BUSINESS_OP_PREFIXES = (
    'activate', 'complete', 'resolve', 'migrate', 'cancel', 'fail',
    'unassign', 'broadcast', 'correlate', 'pin', 'reset',
)
def looks_business_entity(op_id, path, method, responses):
    """Apply the 3 hypotheses from the #277 kickoff. Returns reason or None."""
    if any(v in path for v in STATE_TRANSITION_VERBS):
        return f'path has state-transition verb'
    for prefix in BUSINESS_OP_PREFIXES:
        if op_id.lower().startswith(prefix):
            return f'operationId prefix `{prefix}` implies state transition'
    # 409 on non-collection POST → business rule
    if method == 'POST' and '409' in (responses or {}) and not path.endswith('/search'):
        return '409 documented on non-collection POST'
    return None

# ---------- Path-param fake-ID detection ----------
def path_params(parameters):
    return [p for p in (parameters or []) if p.get('in') == 'path']

def query_params(parameters):
    return [p for p in (parameters or []) if p.get('in') == 'query']

PAGINATION_QUERY_NAMES = {'page', 'limit', 'from', 'pageSize', 'pageNumber', 'cursor', 'sort', 'sortBy', 'orderBy'}

# ---------- Main analyzer ----------
def analyze(spec_path):
    spec = load_spec(spec_path)
    global_security = bool(spec.get('security'))
    # Detect spec gap: securitySchemes declared but security is not applied
    # globally. Per-operation security may still be declared on a handful of
    # endpoints (e.g. /authentication/me) — those get a computable 401.
    # Operations that *don't* declare their own security in such a spec are
    # the ambiguous ones: the spec doesn't say auth is required, but the
    # deployment behaviour says it is. Emit those as needs-ABox.
    declared_schemes = bool((spec.get('components') or {}).get('securitySchemes'))
    spec_undeclared_security = declared_schemes and not global_security
    rows = []

    for path, methods in spec.get('paths', {}).items():
        if not isinstance(methods, dict):
            continue
        path_level_params = methods.get('parameters') or []
        for method, op in methods.items():
            if method.lower() not in ('get', 'post', 'put', 'patch', 'delete'):
                continue
            if not isinstance(op, dict):
                continue
            op_id = op.get('operationId') or f'{method}-{path}'
            method_u = method.upper()
            params = (op.get('parameters') or []) + path_level_params
            responses = op.get('responses') or {}

            # 1. Happy-path — always
            rows.append(plan_item(op_id, method_u, path, 'happy-path', 'documented success response', True))

            # 2. 401 unauthorized — if security required (per-op or global)
            op_security = op.get('security')
            if op_security is None and global_security:
                rows.append(plan_item(op_id, method_u, path,
                    '401-unauthorized', 'global security; strip auth header', True))
            elif op_security and op_security != []:
                rows.append(plan_item(op_id, method_u, path,
                    '401-unauthorized', 'per-op security; strip auth header', True))
            elif op_security == []:
                pass  # explicitly unauthenticated
            elif spec_undeclared_security:
                # Spec defines securitySchemes but never applies them. Real OCA
                # behaviour is "auth required"; flag as needs-ABox so the test
                # plan still captures the 401 surface.
                rows.append(plan_item(op_id, method_u, path,
                    '401-unauthorized', 'spec declares securitySchemes but does not apply them',
                    False, 'spec-gap: which endpoints actually require auth (currently encoded only in deployment, not the spec)'))

            # 3. 404 not-found (fake-ID) — per path parameter
            for p in path_params(params):
                name = p.get('name', '?')
                schema = deref(spec, p.get('schema') or {})
                rows.append(plan_item(op_id, method_u, path,
                    '404-not-found',
                    f'path param={name}, type={schema.get("type", "?")}, format={schema.get("format", "")}',
                    True))

            # 4. Bad-request — walk request body
            rb = op.get('requestBody')
            if isinstance(rb, dict):
                rb = deref(spec, rb)
                content = (rb.get('content') or {})
                for media_type, m in content.items():
                    if media_type != 'application/json':
                        continue
                    schema = m.get('schema')
                    if not schema:
                        continue
                    for kind, detail in walk_body(spec, schema):
                        is_filter_or_pagi = kind.startswith('pagination-sort') or kind.startswith('filter')
                        # Pagination/filter request-shape is computable; behaviour is not
                        if is_filter_or_pagi:
                            rows.append(plan_item(op_id, method_u, path, kind, detail, True))
                            # Also flag behaviour assertion as needs-ABox
                            abox_kind = kind.split(':')[0] + ':behaviour-assertion'
                            rows.append(plan_item(op_id, method_u, path, abox_kind,
                                'asserting result correctness, not just status',
                                False,
                                'filter-field-semantics + sort-field-allowlist per entity'))
                        else:
                            rows.append(plan_item(op_id, method_u, path, kind, detail, True))

            # 5. Pagination/sort from query params
            qp_names = {p.get('name') for p in query_params(params)}
            for n in PAGINATION_QUERY_NAMES & qp_names:
                rows.append(plan_item(op_id, method_u, path,
                    'pagination-sort:request-shape', f'query param={n}', True))

            # 6. needs-ABox: 409 conflict (only flag for create-style endpoints)
            method_is_create = method_u == 'POST' and not path.endswith('/search') and '{' not in path
            method_is_idempotent_put = method_u == 'PUT' and '{' in path
            if method_is_create or method_is_idempotent_put:
                rows.append(plan_item(op_id, method_u, path,
                    '409-conflict', 'create-or-replace with same identifier',
                    False, 'duplicatePolicy per endpoint (idempotent | conflict | replace)'))

            # 7. needs-ABox: 403 forbidden
            # If documented in responses, we know it's possible; emitter still needs RBAC ABox
            if '403' in responses:
                rows.append(plan_item(op_id, method_u, path,
                    '403-forbidden', '403 documented in spec', False,
                    'RBAC: permissions required per endpoint'))
            else:
                rows.append(plan_item(op_id, method_u, path,
                    '403-forbidden', '403 not documented; emitter needs to know if RBAC applies', False,
                    'RBAC: permissions required per endpoint'))

            # 8. needs-ABox: business-entity lifecycle
            reason = looks_business_entity(op_id, path, method_u, responses)
            if reason:
                rows.append(plan_item(op_id, method_u, path,
                    'business-entity-lifecycle', reason, False,
                    'lifecycle state machine for this entity'))

            # 9. needs-ABox: prerequisite resources (heuristic: path params hint at this)
            if path_params(params):
                rows.append(plan_item(op_id, method_u, path,
                    'prerequisite-resource',
                    f'{len(path_params(params))} path param(s) imply a referenced resource',
                    False, 'creation chain per identifier semantic-type'))

            # 10. needs-ABox: eventual consistency (search endpoints)
            if path.endswith('/search'):
                rows.append(plan_item(op_id, method_u, path,
                    'eventual-consistency',
                    'search may lag behind writes',
                    False, 'consistency window per entity (or eventually-consistent flag)'))
                # 10b. needs-ABox: scale (search at 10K+ entities)
                rows.append(plan_item(op_id, method_u, path,
                    'scale-large-n',
                    'behaviour at 10K+ entities; pagination limits, timeout, ordering stability',
                    False, 'scale thresholds + expected response time per entity'))

            # 11. needs-ABox: cross-field range (heuristic — detect pairs of *Before / *After in body)
            rb_for_xfield = op.get('requestBody')
            if isinstance(rb_for_xfield, dict):
                rb_for_xfield = deref(spec, rb_for_xfield)
                content = rb_for_xfield.get('content', {})
                json_schema = deref(spec, (content.get('application/json') or {}).get('schema') or {})
                props = json_schema.get('properties', {}) or {}
                # naïve pairing: any prop ending in 'Before' that has a matching '*After'
                befores = {n[:-6] for n in props if n.endswith('Before')}
                afters = {n[:-5] for n in props if n.endswith('After')}
                pairs = befores & afters
                if pairs:
                    rows.append(plan_item(op_id, method_u, path,
                        'cross-field-range',
                        f'paired fields: {", ".join(sorted(pairs))}',
                        False, 'cross-field validation rules (e.g. before > after rejected)'))
                # Also look for any "filter" object with nested *Before/*After — common search pattern
                filter_schema = deref(spec, props.get('filter') or {})
                fprops = filter_schema.get('properties', {}) or {}
                f_pairs = {n[:-6] for n in fprops if n.endswith('Before')} & {n[:-5] for n in fprops if n.endswith('After')}
                if f_pairs:
                    rows.append(plan_item(op_id, method_u, path,
                        'cross-field-range',
                        f'paired filter fields: {", ".join(sorted(f_pairs))}',
                        False, 'cross-field validation rules (e.g. before > after rejected)'))

            # 11. Documented response codes → coverage opportunity
            for code in (responses or {}):
                if code in ('200', '201', '204', '4XX', '5XX', 'default'):
                    continue
                if code.startswith('2'):
                    continue
                if code in ('400', '401', '403', '404', '409'):
                    continue  # already covered above
                rows.append(plan_item(op_id, method_u, path,
                    f'documented-{code}', f'response code {code} documented in spec', True))

    return rows

# ---------- Output ----------
def write_csv(rows, path):
    with open(path, 'w', newline='', encoding='utf-8') as fp:
        w = csv.DictWriter(fp, fieldnames=['operationId','method','path','kind','detail','computable','abox_fact'])
        w.writeheader()
        w.writerows(rows)

def write_per_endpoint_md(rows, path):
    by_op = defaultdict(list)
    for r in rows:
        by_op[(r['operationId'], r['method'], r['path'])].append(r)

    with open(path, 'w', encoding='utf-8') as fp:
        fp.write('# Spec-derived test plan\n\n')
        fp.write(f'Total operations: **{len(by_op)}**. Total plan items: **{len(rows)}**.\n\n')

        comp = sum(1 for r in rows if r['computable'] == 'yes')
        nonc = len(rows) - comp
        fp.write(f'- Computable from spec alone: **{comp}**\n')
        fp.write(f'- Needs ABox / domain knowledge: **{nonc}**\n\n')

        fp.write('## Per-operation plan\n\n')
        for (op_id, method, p), items in sorted(by_op.items()):
            fp.write(f'### `{method} {p}` — `{op_id}` ({len(items)} items)\n\n')
            fp.write('| kind | detail | computable | needed ABox fact |\n')
            fp.write('|---|---|:-:|---|\n')
            for r in sorted(items, key=lambda x: (x['computable'] != 'yes', x['kind'])):
                comp_mark = '✓' if r['computable'] == 'yes' else ''
                # Escape pipes so they don't break the markdown table layout.
                detail = r['detail'].replace('|', r'\|')
                fact = (r['abox_fact'] or '—').replace('|', r'\|')
                fp.write(f'| {r["kind"]} | {detail} | {comp_mark} | {fact} |\n')
            fp.write('\n')

def write_needs_abox_md(rows, path):
    """Aggregate needs-ABox plan items grouped by the missing fact."""
    by_fact = defaultdict(list)
    for r in rows:
        if r['computable'] == 'no':
            by_fact[r['abox_fact']].append(r)

    by_kind = defaultdict(int)
    for r in rows:
        if r['computable'] == 'no':
            by_kind[r['kind']] += 1

    with open(path, 'w', encoding='utf-8') as fp:
        fp.write('# Needs-ABox gap report\n\n')
        fp.write('Plan items the analyzer cannot decide without domain knowledge. '
                 'Grouped by the missing ABox fact.\n\n')

        fp.write('## Summary — plan-item kinds that need ABox\n\n')
        fp.write('| kind | items |\n|---|---:|\n')
        for kind, n in sorted(by_kind.items(), key=lambda x: -x[1]):
            fp.write(f'| {kind} | {n} |\n')
        fp.write('\n')

        fp.write('## Grouped by missing ABox fact\n\n')
        for fact, items in sorted(by_fact.items(), key=lambda x: -len(x[1])):
            fp.write(f'### `{fact}` — {len(items)} plan items\n\n')
            by_kind_here = defaultdict(int)
            for r in items:
                by_kind_here[r['kind']] += 1
            kinds_line = ', '.join(f'{k}={v}' for k, v in by_kind_here.items())
            fp.write(f'**Plan-item kinds**: {kinds_line}\n\n')

            # Show a few sample operations
            sample_ops = sorted({(r['method'], r['path'], r['operationId']) for r in items})[:8]
            fp.write('**Sample operations** (up to 8):\n\n')
            for m, p, op in sample_ops:
                fp.write(f'- `{m} {p}` (`{op}`)\n')
            if len({(r['operationId']) for r in items}) > 8:
                fp.write(f'- … and {len({r["operationId"] for r in items}) - 8} more\n')
            fp.write('\n')

# ---------- Entry point ----------
if __name__ == '__main__':
    spec_path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_SPEC
    if not os.path.exists(spec_path):
        print(f'ERROR: spec not found at {spec_path}', file=sys.stderr)
        print(f'Hint: run `npm run fetch-spec` (or `npm run pipeline`) first.', file=sys.stderr)
        sys.exit(1)

    rows = analyze(spec_path)
    write_csv(rows, os.path.join(OUT, 'plan.csv'))
    write_per_endpoint_md(rows, os.path.join(OUT, 'plan.md'))
    write_needs_abox_md(rows, os.path.join(OUT, 'needs-abox.md'))

    comp = sum(1 for r in rows if r['computable'] == 'yes')
    nonc = len(rows) - comp
    print(f'wrote plan.csv, plan.md, needs-abox.md')
    print(f'  total plan items: {len(rows)}')
    print(f'  computable from spec: {comp}')
    print(f'  needs ABox:           {nonc}')
