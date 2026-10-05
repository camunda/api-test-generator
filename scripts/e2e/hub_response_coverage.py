#!/usr/bin/env python3
"""Response-contract coverage audit for the generated camunda-hub suites.

For every operation in the bundled hub spec, compares the response codes the spec
documents against the status codes the generated suites actually assert (positive
feature specs, lifecycle templates, and the secured + rbac negative profiles), plus
two request/response-side checks: optional request-body fields a success-path test
sends, and whether the success response body is schema-validated.

This is a different axis from `npm run coverage:report`, which maps operations to
generated specs; an operation can have a spec and still never assert its 404, 409
or 403.

Reads generator output, so run `testsuite:generate` and `generate:request-validation`
first (CONFIG=camunda-hub). Static analysis: it reports what the tests assert, not
whether they pass.

  hub_response_coverage.py --out DIR [--previous prev/summary.json]
                           [--previous-history prev/history.csv]
                           [--spec-ref SHA] [--run-url URL] [--tracking-url URL]

Writes DIR/summary.json, DIR/rows.json, DIR/matrix.md, DIR/slack.txt, DIR/history.csv (the
previous history plus one row for this run) and DIR/history.md (its latest rows as a table).
Exits 2 if the generated output could not be parsed as expected (so a format change fails the
run instead of reporting zeros).
"""
import argparse
import collections
import csv
import datetime
import glob
import json
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
CONFIG = 'camunda-hub'
HTTP_METHODS = {'get', 'put', 'post', 'delete', 'patch'}
BUCKETS = ('2xx', '400', '401', '403', '404', '409')
# 500 is documented everywhere and cannot be provoked on purpose.
IGNORED_CODES = {500}


def scoped_kind_label(k):
    """An excludeOperations scenarioKinds entry is a kind name or a {kind, targets|constraintKinds} object."""
    if isinstance(k, str):
        return k
    scope = k.get('targets') or k.get('constraintKinds') or []
    return f"{k['kind']} ({', '.join(scope)})" if scope else k['kind']


def fail(msg):
    print(f'hub_response_coverage: {msg}', file=sys.stderr)
    sys.exit(2)


def bucket(code):
    return '2xx' if 200 <= code < 300 else str(code)


# --------------------------------------------------------------------- spec ----
def load_spec_operations(spec):
    def deref(x):
        for _ in range(10):
            if not (isinstance(x, dict) and '$ref' in x):
                break
            node = spec
            for part in x['$ref'].lstrip('#/').split('/'):
                part = part.replace('~1', '/').replace('~0', '~')
                node = node[int(part)] if isinstance(node, list) else node.get(part, {})
            x = node
        return x

    ops = {}
    for path, item in spec['paths'].items():
        for method, op in item.items():
            if method not in HTTP_METHODS or 'operationId' not in op:
                continue
            body = deref(op.get('requestBody'))
            props, required = [], []
            if body:
                content = body.get('content', {})
                media = content.get('application/json') or next(iter(content.values()), {})
                schema = deref(media.get('schema', {}))
                props = list((schema.get('properties') or {}).keys())
                required = schema.get('required') or []
            ops[op['operationId']] = {
                'method': method.upper(),
                'path': path,
                'area': (op.get('tags') or ['Other'])[0],
                'codes': sorted(int(c) for c in op['responses'] if c.isdigit() and int(c) not in IGNORED_CODES),
                'optional': [p for p in props if p not in required],
            }
    return ops


# --------------------------------------------------------------- lifecycle ----
def lifecycle_resources(ops):
    """Resources the API lets a client create, read by key and delete, named after their create operation.

    A resource is a collection path (/files, or nested like /projects/{key}/docs) with a POST create, whose key path (/files/{fileKey}) has a GET
    and a DELETE. `restores` marks the ones that can be undeleted: the key path has a POST .../restoration and
    the collection has a POST .../recently-deleted/search, which together mean a delete is soft. A restoration
    endpoint alone does not count (restoring a version or snapshot does not undelete anything)."""
    by_path = collections.defaultdict(dict)
    for op_id, o in ops.items():
        by_path[o['path']][o['method']] = op_id
    found = {}
    for path, methods in by_path.items():
        create = methods.get('POST')
        if not create or not create.startswith('create'):
            continue
        item = next((p for p in by_path if re.fullmatch(re.escape(path) + r'/\{\w+\}', p)), None)
        if not item or not {'GET', 'DELETE'} <= set(by_path[item]):
            continue
        found[create[len('create'):]] = {
            'create': create,
            'restores': 'POST' in by_path.get(item + '/restoration', {})
            and 'POST' in by_path.get(path + '/recently-deleted/search', {}),
        }
    return found


def edge_pairs(ops):
    """Links the API lets a client add and remove: a POST on a nested path (/workspaces/{key}/members) whose
    sub-path has a DELETE but no GET (/workspaces/{key}/members/{email}). Maps the add operation to the remove one."""
    by_path = collections.defaultdict(dict)
    for op_id, o in ops.items():
        by_path[o['path']][o['method']] = op_id
    pairs = {}
    for path, methods in by_path.items():
        add = methods.get('POST')
        if not add or '{' not in path:
            continue
        item = next((m for p, m in by_path.items()
                     if 'DELETE' in m and re.fullmatch(re.escape(path) + r'/\{\w+\}', p)), None)
        # An item that can also be read by key is a nested resource, counted with the resources.
        if item and 'GET' not in item:
            pairs[add] = item['DELETE']
    return pairs


def scan_edges(pw_dir, pairs, edge_cfg):
    """Which add/remove pairs have a generated flow test: an edge in the ontology that names both operations
    and whose EdgeLifecycle file was generated."""
    names = {(e.get('establishedBy'), e.get('revokedBy')): e['name'] for e in edge_cfg.get('edges', [])}
    return sorted(add for add, remove in pairs.items()
                  if (add, remove) in names
                  and os.path.exists(f'{pw_dir}/templates/EdgeLifecycle/{names[(add, remove)]}.lifecycle.spec.ts'))


def scan_lifecycle(pw_dir, resources):
    """Which resources have a generated create-read-delete test and a generated delete-restore test."""
    tdir = f'{pw_dir}/templates'
    if not os.path.isdir(tdir):
        fail(f'{tdir} not found - run testsuite:generate first')
    have = lambda template, name: os.path.exists(f'{tdir}/{template}/{name}.lifecycle.spec.ts')
    created = sorted(n for n in resources if have('EntityLifecycle', n))
    restorable = sorted(n for n, r in resources.items() if r['restores'])
    restored = sorted(n for n in restorable if have('RestoreLifecycle', n))
    return created, restorable, restored


# ----------------------------------------------------------------- positive ----
# The emitter writes JSON.stringify output (double quotes, 4-space indent, one-line evidence
# objects) and a formatter pass rewrites it afterwards. Both shapes must parse, so quotes can be
# either kind and nothing here depends on indentation or line breaks.
Q = r'''["']'''
EVIDENCE_RE = re.compile(
    rf'operationId:\s*{Q}(\w+){Q},\s*method:\s*{Q}\w+{Q},\s*url,\s*headers,(?:\s*body:\s*(\w+),)?\s*expectedStatus:\s*(\d+)',
    re.S)
VALIDATE_RE = re.compile(
    rf'path:\s*{Q}([^\'"]+){Q},\s*method:\s*{Q}(\w+){Q},\s*status:\s*{Q}(\d+){Q}', re.S)
KEY_RE = re.compile(r'''(?:^|,)\s*(?:(\w+)|["'](\w+)["'])\s*:''')


def top_level_keys(src, start):
    """Keys of the object literal whose '{' is at src[start]; nested values and strings are skipped."""
    depth, i, flat = 0, start, []
    while i < len(src):
        ch = src[i]
        if ch in '"\'':
            j = i + 1
            while j < len(src) and src[j] != ch:
                j += 2 if src[j] == '\\' else 1
            if depth == 1:
                # A string is a key only if a ':' follows it; as a value, mask it so commas or
                # colons inside the text cannot be read as keys.
                is_key = re.match(r'\s*:', src[j + 1:j + 20]) is not None
                flat.append(src[i:j + 1] if is_key else 'S')
            i = j + 1
            continue
        if ch in '{[(':
            depth += 1
            if depth == 1:
                i += 1
                continue
        elif ch in '}])':
            depth -= 1
            if depth == 0:
                break
        if depth == 1:
            flat.append(ch)
        i += 1
    return {a or b for a, b in KEY_RE.findall(''.join(flat))}


def scan_positive(pw_dir, ops):
    path_to_op = {(o['method'], o['path']): k for k, o in ops.items()}
    asserted = collections.defaultdict(set)
    validated = collections.defaultdict(set)
    sent = collections.defaultdict(set)
    files = glob.glob(f'{pw_dir}/*.spec.ts') + glob.glob(f'{pw_dir}/templates/*/*.spec.ts')
    for f in files:
        src = open(f, encoding='utf-8').read()
        for m in EVIDENCE_RE.finditer(src):
            op_id, body_var, status = m.group(1), m.group(2), m.group(3)
            if op_id not in ops:
                continue
            asserted[op_id].add(int(status))
            if not body_var or body_var == 'undefined':
                continue
            # The same name (body1, body2...) is re-declared per test, so use the nearest
            # declaration before this assertion, not the first one in the file.
            decls = list(re.finditer(rf'const {re.escape(body_var)}\b[^=\n]*=\s*(\{{)', src[:m.start()]))
            if decls:
                sent[op_id] |= top_level_keys(src, decls[-1].start(1))
        for path, method, status in VALIDATE_RE.findall(src):
            op_id = path_to_op.get((method.upper(), path))
            if op_id:
                validated[op_id].add(int(status))
    return asserted, validated, sent


# ----------------------------------------------------------------- negative ----
CALL_RE = re.compile(r'assertResponseStatus\(\s*testInfo,\s*res,\s*(\d+),\s*\{([^{}]*)\}', re.S)
OPERATION_ID_RE = re.compile(rf'operationId:\s*{Q}(\w+){Q}')


def scan_negative(rv_dir, ops):
    asserted = collections.defaultdict(set)
    tests = collections.Counter()
    for profile in ('secured', 'rbac'):
        for f in glob.glob(f'{rv_dir}/{profile}/*-validation-api-tests.spec.ts'):
            src = open(f, encoding='utf-8').read()
            for status, inner in CALL_RE.findall(src):
                m = OPERATION_ID_RE.search(inner)
                if not m or m.group(1) not in ops:
                    continue
                asserted[m.group(1)].add(int(status))
                tests[m.group(1)] += 1
    return asserted, tests


# --------------------------------------------------------------------- main ----
# Plain-language names for the request checks the negative suite generates, for the Slack message.
CHECK_NAMES = {
    'missing-required': 'a missing required field',
    'explicit-null-required': 'a required field set to null',
    'missing-required-combo': 'several missing required fields at once',
    'type-mismatch': 'a value of the wrong type',
    'union': 'a value that fits none of the allowed shapes',
    'constraint-violation': 'a value outside its limits',
    'enum-violation': 'a value outside the allowed list',
    'additional-prop': 'an unexpected extra field',
    'oneof-ambiguous': 'a value that fits more than one allowed shape',
    'oneof-none-match': 'a value that fits no allowed shape',
    'discriminator-mismatch': 'a type marker that does not match the body',
    'param-missing': 'a missing required query, header or cookie parameter',
    'param-type-mismatch': 'a query parameter of the wrong type',
    'param-enum-violation': 'a query parameter outside the allowed list',
    'param-constraint-violation': 'a path or query parameter outside its limits',
    'missing-body': 'a missing request body',
    'malformed-json-body': 'a body that is not valid JSON',
    'nested-additional-prop': 'an unexpected extra field inside a nested object',
    'unique-items-violation': 'a list with repeated items where they must be unique',
    'multiple-of-violation': 'a number that is not a valid multiple',
    'format-invalid': 'a badly formatted value',
    'additional-prop-general': 'an unexpected extra field on the body',
    'oneof-multi-ambiguous': 'a value that fits several allowed shapes at once',
    'oneof-cross-bleed': 'fields from one allowed shape mixed into another',
    'discriminator-structure-mismatch': 'a type marker whose structure does not match',
    'allof-missing-required': 'a required field missing from a combined shape',
    'allof-conflict': 'fields that conflict across combined shapes',
    'not-found-fake-id': 'an ID that does not exist',
    'pagination-limit-invalid': 'an invalid page size',
    'pagination-offset-past-total': 'a page offset past the last result',
    'pagination-cursor-invalid': 'an invalid page cursor',
    'auth-absent': 'no login',
    'auth-invalid': 'a bad login',
    'auth-deny': 'a login without permission',
}


def request_check_state(rv_op, whole_op_excluded, held_kinds):
    """How well an endpoint's request checks are covered, from the negative suite's own coverage data.

    rv_op is the endpoint's entry in request-validation/COVERAGE.json, or None when the negative suite
    generated no scenario for it at all. Returns (state, present, applicable, missing_kinds)."""
    if rv_op is None:
        return ('hold' if whole_op_excluded else 'gap'), 0, 0, []
    missing = [k for k in rv_op.get('missingApplicableKinds', []) if k not in held_kinds]
    held = [k for k in rv_op.get('missingApplicableKinds', []) if k in held_kinds]
    # Held kinds are neither tested nor missing, so they do not count towards "applicable" either.
    applicable = rv_op.get('applicableKindCount', 0) - len(held)
    present = rv_op.get('presentKindCount', 0)
    if missing:
        return 'gap', present, applicable, missing
    if not present:
        # No scenario at all and nothing left to flag: a gap, unless config held what applies. An endpoint
        # that no applicability rule recognises must not read as fully covered.
        return ('hold' if (held or whole_op_excluded) else 'gap'), present, applicable, []
    return 'ok', present, applicable, []


def build(args):
    gen = os.path.join(ROOT, 'generated', CONFIG)
    pw_dir, rv_dir = f'{gen}/playwright', f'{gen}/request-validation'
    for needed in (f'{pw_dir}/coverage.json', f'{rv_dir}/COVERAGE.json'):
        if not os.path.exists(needed):
            fail(f'{needed} not found - run testsuite:generate and generate:request-validation first')

    spec = json.load(open(os.path.join(ROOT, 'spec', CONFIG, 'bundled', 'rest-api.bundle.json')))
    meta = json.load(open(os.path.join(ROOT, 'spec', CONFIG, 'bundled', 'spec-metadata.json')))
    ops = load_spec_operations(spec)
    pos_cov = json.load(open(f'{pw_dir}/coverage.json'))
    rv_cov = json.load(open(f'{rv_dir}/COVERAGE.json'))
    rv_cfg = json.load(open(os.path.join(ROOT, 'configs', CONFIG, 'request-validation.json')))

    pos_asserted, pos_validated, pos_sent = scan_positive(pw_dir, ops)
    neg_asserted, neg_tests = scan_negative(rv_dir, ops)

    # Sanity: a format change must fail the run, not silently report zeros.
    expected_neg = sum(o['total'] for o in rv_cov['operations'])
    if sum(neg_tests.values()) != expected_neg:
        fail(f'parsed {sum(neg_tests.values())} negative tests but COVERAGE.json lists {expected_neg}')
    if len(ops) != pos_cov['summary']['totalSpecOperations']:
        fail(f'spec has {len(ops)} operations but coverage.json says {pos_cov["summary"]["totalSpecOperations"]}')
    if not any(pos_asserted.values()):
        fail('found no asserted statuses in the positive suite - generated test format changed?')

    suppressed = set(pos_cov['explicitlySuppressedOpIds'])
    excluded = {e['operationId'] for e in rv_cfg['excludeOperations'] if not e.get('scenarioKinds')}
    tracked = suppressed | excluded  # known and tracked elsewhere; used only to annotate lists
    supp_cfg = json.load(open(os.path.join(ROOT, 'configs', CONFIG, 'positive-suppress.json')))
    tracked_urls = collections.defaultdict(list)
    for e in supp_cfg.get('suppress', []) + [x for x in rv_cfg['excludeOperations'] if not x.get('scenarioKinds')]:
        url = (e.get('knownIssue') or {}).get('url')
        if url and url not in tracked_urls[e['operationId']]:
            tracked_urls[e['operationId']].append(url)
    held_cells = collections.defaultdict(list)
    scoped = collections.defaultdict(list)
    for e in rv_cfg['excludeOperations']:
        if e.get('scenarioKinds'):
            scoped[e['operationId']] += [scoped_kind_label(k) for k in e['scenarioKinds']]
    rv_ops = {o['operationId']: o for o in rv_cov['operations']}
    # Kinds a scoped exclusion removed entirely, as the generator recorded them. Taken from there, not
    # guessed from the config: an exclusion that only narrows a kind (one target of several) holds nothing,
    # so a regression in the remaining scenarios still shows as a gap. An older COVERAGE.json has none.
    held_kinds = {op: set(kinds) for op, kinds in rv_cov.get('heldKindsByOperation', {}).items()}
    # Endpoints whose scenarios were all excluded by config are absent from `operations`; the producer
    # lists them separately with the kinds that apply, so "all excluded on purpose" can be told apart
    # from "nothing generated by mistake". An older COVERAGE.json has no such list.
    rv_no_scenarios = {o['operationId']: o for o in rv_cov.get('operationsWithNoScenarios', [])}

    rows, doc, got = [], collections.Counter(), collections.Counter()
    missing = collections.defaultdict(list)
    for op_id, o in sorted(ops.items(), key=lambda kv: (kv[1]['path'], kv[1]['method'])):
        asserted = set(neg_asserted[op_id]) | (set() if op_id in suppressed else set(pos_asserted[op_id]))
        success = [c for c in o['codes'] if 200 <= c < 300]
        shape_codes = [c for c in success if c != 204]
        by_bucket = collections.defaultdict(list)
        for code in o['codes']:
            by_bucket[bucket(code)].append(code)
        cells = {}
        for b, codes in by_bucket.items():
            # One cell per endpoint and bucket: tested only if every documented code in it is.
            doc[b] += 1
            if all(c in asserted for c in codes):
                got[b] += 1
                cells[b] = 'ok'
            else:
                missing[b].append(op_id)
                # positive-suite suppression covers only the success response; a whole-operation
                # negative-suite exclusion covers every other response class.
                is_held = (op_id in suppressed) if b == '2xx' else (op_id in excluded)
                cells[b] = 'hold' if is_held else 'gap'
                if is_held:
                    held_cells[b].append(op_id)
        if op_id in suppressed:
            shape = 'hold'
        elif not shape_codes:
            shape = 'na'
        else:
            shape = 'ok' if pos_validated[op_id] & set(shape_codes) else 'gap'
        sent = sum(1 for p in o['optional'] if p in pos_sent[op_id])
        req_state, req_present, req_applicable, req_missing = request_check_state(
            rv_ops.get(op_id) or rv_no_scenarios.get(op_id), op_id in excluded, held_kinds.get(op_id, set()))
        rows.append({
            'operationId': op_id, 'method': o['method'], 'path': o['path'], 'area': o['area'], 'cells': cells,
            'shape': shape, 'optionalSent': sent, 'optionalTotal': len(o['optional']),
            'requestChecks': req_state, 'requestPresent': req_present, 'requestApplicable': req_applicable,
            'requestMissing': req_missing,
            'notes': sorted(scoped[op_id]),
            'optionalMissing': [] if op_id in suppressed else [p for p in o['optional'] if p not in pos_sent[op_id]],
            'fullyTestedExcept403': all(v == 'ok' for b, v in cells.items() if b != '403'),
            'codeGap': any(v == 'gap' for b, v in cells.items() if b != '403'),
            'fullyAsserted': all(v == 'ok' for v in cells.values()),
        })

    resources = lifecycle_resources(ops)
    created, restorable, restored = scan_lifecycle(pw_dir, resources)
    edges = edge_pairs(ops)
    edge_cfg = json.load(open(os.path.join(ROOT, 'configs', CONFIG, 'ontology', 'edges.json')))
    linked = scan_edges(pw_dir, edges, edge_cfg)
    lifecycle = {
        'create': [len(created), len(resources)],
        'createMissing': sorted(set(resources) - set(created)),
        'restore': [len(restored), len(restorable)],
        'restoreMissing': sorted(set(restorable) - set(restored)),
        'edge': [len(linked), len(edges)],
        'edgeMissing': sorted(set(edges) - set(linked)),
        'known': sorted(n for n, r in resources.items() if r['create'] in tracked),
    }
    # A flow test can only exist if the resource's own create operation is tested at all.
    if not created:
        fail('found no generated lifecycle tests - did the template output move?')

    opt_sent = sum(r['optionalSent'] for r in rows if r['operationId'] not in suppressed)
    opt_total = sum(r['optionalTotal'] for r in rows if r['operationId'] not in suppressed)
    summary = {
        'specHash': meta['specHash'], 'specRef': args.spec_ref, 'operations': len(ops),
        'operationIds': sorted(ops), 'negativeTests': sum(neg_tests.values()),
        'codes': {b: [got[b], doc[b]] for b in BUCKETS},
        'missing': {b: sorted(missing[b]) for b in BUCKETS},
        'fullyAsserted': sum(r['fullyAsserted'] for r in rows),
        'opsMissingResponseTest': sum(r['codeGap'] for r in rows),
        'optionalFields': [opt_sent, opt_total],
        'requestChecks': [sum(r['requestChecks'] == 'ok' for r in rows), sum(r['requestChecks'] != 'hold' for r in rows)],
        'requestCheckGaps': {r['operationId']: r['requestMissing'] for r in rows if r['requestChecks'] == 'gap'},
        'requestNoTests': sorted(r['operationId'] for r in rows if r['requestChecks'] == 'gap' and not r['requestPresent']),
        'shapeUnvalidated': sorted(r['operationId'] for r in rows if r['shape'] == 'gap'),
        'lifecycle': lifecycle,
        'trackedOperations': sorted(tracked),
        'trackedUrls': {op: tracked_urls[op] for op in sorted(tracked_urls)},
        'heldCells': {b: sorted(held_cells[b]) for b in BUCKETS},
        'optionalMissing': {r['operationId']: r['optionalMissing'] for r in rows if r['optionalMissing']},
        # Suppression explains zero coverage; it is not evidence of a test, so it stays in the list.
        'zeroTestOperations': sorted(o for o in ops if not pos_asserted[o] and not neg_tests[o]),
    }
    return summary, rows


NAMES = {
    '2xx': 'Success (2xx)', '400': 'Bad request (400)', '401': 'Not authenticated (401)',
    '403': 'Forbidden (403)', '404': 'Not found (404)', '409': 'Conflict (409)',
}


def meter(got, doc, width=10):
    filled = width if not doc else round(width * got / doc)
    return '▰' * filled + '▱' * (width - filled)


def request_gap_summary(s):
    """Which kinds of bad-request test are missing most often, in plain words."""
    none_at_all = set(s['requestNoTests'])
    counts = collections.Counter(
        k for op, kinds in s['requestCheckGaps'].items() if op not in none_at_all for k in kinds)
    parts = []
    if none_at_all:
        parts.append(f'{len(none_at_all)} {"endpoint has" if len(none_at_all) == 1 else "endpoints have"} no bad-request test of any kind')
    if counts:
        top = ', '.join(f'{CHECK_NAMES.get(k, k)} ({n})' for k, n in counts.most_common(3))
        parts.append(f'most often missing{" elsewhere" if none_at_all else ""}: {top}')
    return ('; '.join(parts)[0].upper() + '; '.join(parts)[1:] + '.') if parts else 'Nothing is missing.'


def change(now, before):
    """' (+2)' / ' (-1)' against the previous report, or '' when there is none or nothing changed."""
    if before is None or now == before:
        return ''
    return f' ({"+" if now > before else "-"}{abs(now - before)})'


def known_note(urls):
    """' (known, tracked: camunda-hub#25907, ...)' with each issue linked, or ' (known, tracked)' when there is no URL."""
    def label(u):
        m = re.search(r'github\.com/[^/]+/([^/]+)/(?:issues|pull)/(\d+)', u)
        return f'<{u}|{m.group(1)}#{m.group(2)}>' if m else f'<{u}|issue>'
    return f' (known, tracked: {", ".join(label(u) for u in urls)})' if urls else ' (known, tracked)'


def flow_line(kind, label, s, prev, unit='resources'):
    """'Lifecycle tests (...): 4 of 6 resources (+1). Missing: A, B (known, tracked).' or without the tail."""
    got, total = s['lifecycle'][kind]
    before = prev['lifecycle'][kind][0] if prev and 'lifecycle' in prev else None
    missing = s['lifecycle'][kind + 'Missing']
    known = set(s['lifecycle']['known'])
    tail = ('. Missing: ' + ', '.join(n + (' (known, tracked)' if n in known else '') for n in missing)) if missing else ''
    return f'• {label}: {got} of {total} {unit}{change(got, before)}{tail}'


def slack(s, prev, args):
    c = s['codes']
    ref = f'camunda-hub@{args.spec_ref[:7]}' if args.spec_ref else 'spec ' + s['specHash'].replace('sha256:', '')[:7]
    pf = prev['fullyAsserted'] if prev else None
    pc = prev['codes'] if prev else {}

    def line(b):
        before = pc.get(b, [None])[0] if prev else None
        return f'• {NAMES[b]}: {c[b][0]} of {c[b][1]}{change(c[b][0], before)}  {meter(*c[b])}'

    ranked = sorted((b for b in BUCKETS if c[b][1]), key=lambda b: c[b][0] / c[b][1])
    worst = [b for b in ranked[:2] if c[b][0] < c[b][1]]
    opt_before = prev['optionalFields'][0] if prev and 'optionalFields' in prev else None
    req_before = prev['requestChecks'][0] if prev and 'requestChecks' in prev else None
    shape_before = len(prev['shapeUnvalidated']) if prev and 'shapeUnvalidated' in prev else None
    lines = [
        ':bar_chart: *Hub API test coverage* (weekly)',
        f'{ref} · {s["operations"]} endpoints · {s["negativeTests"]} negative tests',
        '',
        f'*{s["fullyAsserted"]} of {s["operations"]} endpoints* have a test for every response the API spec lists'
        f'{change(s["fullyAsserted"], pf)}. A number in brackets is the change since the last report.',
        '',
        ':white_check_mark: *Positive tests* (the request is right)',
        line('2xx'),
        f'• Optional request fields sent in a success test: {s["optionalFields"][0]} of {s["optionalFields"][1]}'
        f'{change(s["optionalFields"][0], opt_before)}',
        f'• Endpoints that never check the shape of the success response: {len(s["shapeUnvalidated"])}'
        f'{change(len(s["shapeUnvalidated"]), shape_before)}',
        flow_line('create', 'Lifecycle tests (create, read, delete)', s, prev),
        flow_line('restore', 'Lifecycle tests (delete, restore)', s, prev),
        flow_line('edge', 'Lifecycle tests (add, remove)', s, prev, unit='links'),
        '',
        ':no_entry: *Negative tests* (the request is wrong)',
    ]
    lines += [line(b) for b in BUCKETS if b != '2xx']
    lines += [
        f'• Every kind of bad request tested: {s["requestChecks"][0]} of {s["requestChecks"][1]} endpoints'
        f'{change(s["requestChecks"][0], req_before)}. {request_gap_summary(s)}',
        '',
        # These roll up both paths (the success answer is one of the responses counted), so they are not
        # shown under either section above.
        ':clipboard: *Across positive and negative tests*',
    ]
    if worst:
        def untested(b):
            before = pc[b][1] - pc[b][0] if b in pc else None
            return f'{NAMES[b]}, {c[b][1] - c[b][0]} untested{change(c[b][1] - c[b][0], before)}'

        lines.append('• Biggest gaps: ' + ' · '.join(untested(b) for b in worst))
    missing_before = prev.get('opsMissingResponseTest') if prev else None
    lines += [
        f'• {s["opsMissingResponseTest"]} endpoints{change(s["opsMissingResponseTest"], missing_before)} are missing a test '
        f'for a success, 400, 401, 404 or 409 response (403 is tracked separately; 500 errors are not counted).',
    ]
    if prev:
        new = sorted(set(s['operationIds']) - set(prev.get('operationIds', [])))
        if new:
            lines.append('New endpoints since last report: ' + ', '.join(f'`{o}`' for o in new))
    if s['zeroTestOperations']:
        tracked = set(s['trackedOperations'])
        urls = s.get('trackedUrls', {})
        lines.append(':warning: Endpoints with no test at all: '
                     + ', '.join(f'`{o}`' + (known_note(urls.get(o, [])) if o in tracked else '') for o in s['zeroTestOperations']))
    links = []
    if args.run_url:
        links.append(f'<{args.run_url}|Full table>')
    if args.tracking_url:
        links.append(f'<{args.tracking_url}|Tracking epic>')
    if links:
        lines += ['', ' · '.join(links)]
    return '\n'.join(lines) + '\n'


MARK = {'ok': '✅', 'gap': '❌', 'hold': '⏸️', 'na': 'n/a'}


def matrix(s, rows):
    c = s['codes']
    out = [
        f'## Hub API test coverage ({s["operations"]} endpoints)', '',
        f'**{s["fullyAsserted"]} of {s["operations"]} endpoints** have a test for every response the API spec lists.', '',
        'Responses tested, out of those the spec lists: '
        + ' · '.join(f'{NAMES[b]} {c[b][0]} of {c[b][1]}' for b in BUCKETS) + '.', '',
        '✅ tested · ❌ the spec lists it but no test covers it · ⏸️ known and tracked elsewhere (suppressed or excluded) · '
        'n/a the spec does not list this response for the endpoint, so there is nothing to test', '',
        'The **Missing** column lists the response codes that are untested for that endpoint. '
        '**Response checked** is whether a test validates the success response against its schema. '
        '**Optional fields** is how many optional request fields a success test sends.', '',
        '**Bad-request kinds** is whether the negative suite has at least one test for each kind of bad request the '
        'generator can apply to the endpoint (missing or wrong fields, bad values, no login); the number is kinds '
        'covered out of kinds that apply. It does not count how many tests there are for each kind. The kinds that '
        'apply come from the generator\'s own rules; for request-body kinds they can include a check the generator '
        'cannot build, so a gap there is an upper bound.', '',
        '| Endpoint | Request | Success | Response checked | Optional fields | Bad-request kinds | 400 | 401 | 403 | 404 | 409 | Missing |',
        '|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|',
    ]
    for r in rows:
        cl = r['cells']
        opt = 'n/a' if not r['optionalTotal'] else f'{r["optionalSent"]} of {r["optionalTotal"]}'
        missing = ', '.join(('success' if b == '2xx' else b) for b in BUCKETS if cl.get(b) == 'gap') or '—'
        req = MARK[r['requestChecks']] + (f' {r["requestPresent"]} of {r["requestApplicable"]}' if r['requestApplicable'] else '')
        if r['requestMissing']:
            note = 'bad-request: ' + ', '.join(r['requestMissing'])
            missing = note if missing == '—' else f'{missing} · {note}'
        out.append(f'| `{r["operationId"]}` | {r["method"]} {r["path"]} | '
                   + ' | '.join([MARK[cl.get('2xx', 'na')], MARK[r['shape']], opt, req]
                                + [MARK[cl.get(b, 'na')] for b in ('400', '401', '403', '404', '409')])
                   + f' | {missing} |')
    return '\n'.join(out) + '\n'


def gap_rows(rows):
    """Endpoints with at least one missing response test or missing kind of bad-request test."""
    return [r for r in rows
            if r['requestChecks'] == 'gap' or any(v == 'gap' for v in r['cells'].values())]


AREA_INDEX_MARKER = '<!-- AREA_INDEX -->'


def issue_body(s, rows, args):
    """Body of the rolling tracking issue, or '' when nothing is missing (the workflow then closes it).

    The endpoint tables live in the per-area issues; this one is the index. The body is rendered by
    hub-coverage-summary-issue.sh, which replaces AREA_INDEX_MARKER with the area-index.md lines that hub-coverage-area-issues.sh writes (one per area, a link to its issue)."""
    gaps = gap_rows(rows)
    if not gaps:
        return ''
    lines = [
        '_Kept up to date by the weekly **Hub response coverage** workflow. It is rewritten every Monday and '
        'closed automatically once nothing is missing. Please do not edit it by hand._', '',
        f'**{s["fullyAsserted"]} of {s["operations"]} endpoints** have a test for every response the API spec lists; '
        f'**{len(gaps)}** still have something missing. The endpoints are listed in one issue per area of the API, '
        'opened gradually (at most 10 new ones per week); an area that has no issue yet is listed here with its endpoints.',
        '', AREA_INDEX_MARKER, '',
        'Bad-request tests: ' + (request_gap_summary(s) if s['requestCheckGaps'] else 'every kind that applies is covered.'),
    ]
    if args.run_url:
        lines += ['', f'Full table: {args.run_url}']
    return '\n'.join(lines) + '\n'


def gap_table(gaps):
    lines = ['| Endpoint | Missing responses | Missing bad-request tests |', '|---|---|---|']
    for r in gaps[:100]:
        codes = ', '.join(('success' if b == '2xx' else b) for b in BUCKETS if r['cells'].get(b) == 'gap') or '—'
        kinds = ', '.join(r['requestMissing']) or '—'
        lines.append(f'| `{r["operationId"]}` | {codes} | {kinds} |')
    if len(gaps) > 100:
        lines.append(f'| …and {len(gaps) - 100} more (see the full table in the run) | | |')
    return lines


AREA_TITLE_PREFIX = '[hub-response-coverage] '


def area_issues(rows, args):
    """(title, body, area, gap count, endpoint ids) per API area (the spec's first tag) with at least one endpoint gap."""
    by_area = collections.defaultdict(list)
    for r in gap_rows(rows):
        by_area[r.get('area', 'Other')].append(r)
    out = []
    for area in sorted(by_area):
        gaps = by_area[area]
        lines = [
            '_Kept up to date by the weekly **Hub response coverage** workflow: rewritten every Monday, '
            'closed automatically once this area has nothing missing, reopened if a gap returns. '
            'Please do not edit it by hand._', '',
            f'**{len(gaps)}** {"endpoint" if len(gaps) == 1 else "endpoints"} in the **{area}** area '
            'still miss a response test or a bad-request test.', '',
        ] + gap_table(gaps)
        if args.run_url:
            lines += ['', f'Full table: {args.run_url}']
        out.append((f'{AREA_TITLE_PREFIX}{area}: missing response or bad-request tests', '\n'.join(lines) + '\n', area,
                    len(gaps), [g['operationId'] for g in gaps]))
    return out


def history_row(s, args):
    """One CSV row of the headline numbers, so a trend can be read without opening every report."""
    row = {
        'date': datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%d'),
        'specRef': args.spec_ref[:12], 'operations': s['operations'], 'negativeTests': s['negativeTests'],
        'fullyAsserted': s['fullyAsserted'], 'opsMissingResponseTest': s['opsMissingResponseTest'],
        'zeroTestOperations': len(s['zeroTestOperations']),
        'optionalSent': s['optionalFields'][0], 'optionalTotal': s['optionalFields'][1],
        'shapeUnvalidated': len(s['shapeUnvalidated']),
        'requestChecksFull': s['requestChecks'][0], 'requestChecksEndpoints': s['requestChecks'][1],
        'lifecycleCreate': s['lifecycle']['create'][0], 'lifecycleCreateTotal': s['lifecycle']['create'][1],
        'lifecycleRestore': s['lifecycle']['restore'][0], 'lifecycleRestoreTotal': s['lifecycle']['restore'][1],
        'lifecycleEdge': s['lifecycle']['edge'][0], 'lifecycleEdgeTotal': s['lifecycle']['edge'][1],
    }
    for b in BUCKETS:
        row[f'{b}_tested'], row[f'{b}_documented'] = s['codes'][b]
    return row


def write_history(path, previous_path, row):
    """Carry the previous file forward and append this run's row, so the history survives the
    artifact retention window as long as the report keeps running. The header is the previous
    header plus any new columns, so a metric that is later renamed or dropped keeps its old values
    (blank in the newer rows) instead of being erased from the record."""
    rows, header = [], []
    if previous_path and os.path.exists(previous_path):
        with open(previous_path, newline='') as f:
            reader = csv.DictReader(f)
            header = list(reader.fieldnames or [])
            rows = list(reader)
    header += [k for k in row if k not in header]
    rows.append({k: str(v) for k, v in row.items()})
    with open(path, 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=header)
        w.writeheader()
        for r in rows:
            w.writerow({k: r.get(k, '') for k in header})


def history_markdown(path, last=8):
    """The most recent history rows as a table for the run summary, newest last."""
    with open(path, newline='') as f:
        rows = list(csv.DictReader(f))[-last:]
    cols = [('date', 'Date')] + [(f'{b}_tested', NAMES[b].split(' (')[-1].rstrip(')') + ' tested') for b in BUCKETS] \
        + [('fullyAsserted', 'Fully tested endpoints'), ('requestChecksFull', 'All bad-request kinds covered'),
           ('operations', 'Endpoints')]
    out = [f'## Coverage history (last {len(rows)} reports)', '',
           '| ' + ' | '.join(h for _, h in cols) + ' |', '|' + '---|' * len(cols)]
    for r in rows:
        out.append('| ' + ' | '.join(
            ('—' if not r.get(k) else f'{r[k]} of {r.get(k.replace("_tested", "_documented"), "")}')
            if k.endswith('_tested') else (r.get(k) or '—')
            for k, _ in cols) + ' |')
    return '\n'.join(out) + '\n'


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--out', required=True)
    ap.add_argument('--previous')
    ap.add_argument('--previous-history', help='history.csv from the previous scheduled report')
    ap.add_argument('--spec-ref', default='')
    ap.add_argument('--run-url', default='')
    ap.add_argument('--tracking-url', default='')
    args = ap.parse_args()

    summary, rows = build(args)
    prev = None
    if args.previous and os.path.exists(args.previous):
        try:
            prev = json.load(open(args.previous))
        except ValueError:
            prev = None
    os.makedirs(args.out, exist_ok=True)
    json.dump(summary, open(f'{args.out}/summary.json', 'w'), indent=2)
    json.dump(rows, open(f'{args.out}/rows.json', 'w'), indent=1)
    open(f'{args.out}/matrix.md', 'w').write(matrix(summary, rows))
    open(f'{args.out}/slack.txt', 'w').write(slack(summary, prev, args))
    open(f'{args.out}/issue.md', 'w').write(issue_body(summary, rows, args))
    os.makedirs(f'{args.out}/areas', exist_ok=True)
    index = []
    for n, (title, body, area, count, endpoints) in enumerate(area_issues(rows, args)):
        open(f'{args.out}/areas/area-{n}.md', 'w').write(body)
        index.append({'title': title, 'file': f'{args.out}/areas/area-{n}.md', 'area': area, 'gaps': count,
                      'endpoints': endpoints})
    json.dump(index, open(f'{args.out}/areas.json', 'w'), indent=1)
    write_history(f'{args.out}/history.csv', args.previous_history, history_row(summary, args))
    open(f'{args.out}/history.md', 'w').write(history_markdown(f'{args.out}/history.csv'))
    print(open(f'{args.out}/slack.txt').read())


if __name__ == '__main__':
    main()
