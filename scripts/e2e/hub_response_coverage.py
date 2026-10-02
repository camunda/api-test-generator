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
                'codes': sorted(int(c) for c in op['responses'] if c.isdigit() and int(c) not in IGNORED_CODES),
                'optional': [p for p in props if p not in required],
            }
    return ops


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
    held_cells = collections.defaultdict(list)
    scoped = collections.defaultdict(list)
    for e in rv_cfg['excludeOperations']:
        if e.get('scenarioKinds'):
            scoped[e['operationId']] += [scoped_kind_label(k) for k in e['scenarioKinds']]

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
        rows.append({
            'operationId': op_id, 'method': o['method'], 'path': o['path'], 'cells': cells,
            'shape': shape, 'optionalSent': sent, 'optionalTotal': len(o['optional']),
            'notes': sorted(scoped[op_id]),
            'optionalMissing': [] if op_id in suppressed else [p for p in o['optional'] if p not in pos_sent[op_id]],
            'fullyTestedExcept403': all(v == 'ok' for b, v in cells.items() if b != '403'),
            'codeGap': any(v == 'gap' for b, v in cells.items() if b != '403'),
            'fullyAsserted': all(v == 'ok' for v in cells.values()),
        })

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
        'shapeUnvalidated': sorted(r['operationId'] for r in rows if r['shape'] == 'gap'),
        'trackedOperations': sorted(tracked),
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


def since_last(now, before, noun='endpoints'):
    if before is None:
        return ''
    d = now - before
    if d == 0:
        return ' (same as last report)'
    return f' ({"up" if d > 0 else "down"} {abs(d)} since last report)'


def meter(got, doc, width=10):
    filled = width if not doc else round(width * got / doc)
    return '▰' * filled + '▱' * (width - filled)


def slack(s, prev, args):
    c = s['codes']
    ref = f'camunda-hub@{args.spec_ref[:7]}' if args.spec_ref else 'spec ' + s['specHash'].replace('sha256:', '')[:7]
    pf = prev['fullyAsserted'] if prev else None
    ranked = sorted((b for b in BUCKETS if c[b][1]), key=lambda b: c[b][0] / c[b][1])
    worst = [b for b in ranked[:2] if c[b][0] < c[b][1]]
    lines = [
        ':bar_chart: *Hub API test coverage* (weekly)',
        f'{ref} · {s["operations"]} endpoints · {s["negativeTests"]} negative tests',
        '',
        f'*{s["fullyAsserted"]} of {s["operations"]} endpoints* have a test for every response the API spec lists'
        f'{since_last(s["fullyAsserted"], pf)}.',
        '',
        '*Responses tested, out of those the spec lists*',
    ]
    lines += [f'• {NAMES[b]}: {c[b][0]} of {c[b][1]}  {meter(*c[b])}' for b in BUCKETS]
    lines += ['']
    if worst:
        lines.append('*Biggest gaps:* ' + ' · '.join(f'{NAMES[b]}, {c[b][1] - c[b][0]} untested' for b in worst))
    lines += [
        f'Also: {s["optionalFields"][0]} of {s["optionalFields"][1]} optional request fields are used in a success test, '
        f'and {len(s["shapeUnvalidated"])} endpoints never check the shape of the success response.',
        f'{s["opsMissingResponseTest"]} endpoints are missing a test for a success, 400, 401, 404 or 409 response '
        f'(403 is tracked separately; 500 errors are not counted).',
    ]
    if prev:
        new = sorted(set(s['operationIds']) - set(prev.get('operationIds', [])))
        if new:
            lines.append('New endpoints since last report: ' + ', '.join(f'`{o}`' for o in new))
    if s['zeroTestOperations']:
        tracked = set(s['trackedOperations'])
        lines.append(':warning: Endpoints with no test at all: '
                     + ', '.join(f'`{o}`' + (' (known, tracked)' if o in tracked else '') for o in s['zeroTestOperations']))
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
        '| Endpoint | Request | Success | Response checked | Optional fields | 400 | 401 | 403 | 404 | 409 | Missing |',
        '|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|',
    ]
    for r in rows:
        cl = r['cells']
        opt = 'n/a' if not r['optionalTotal'] else f'{r["optionalSent"]} of {r["optionalTotal"]}'
        missing = ', '.join(('success' if b == '2xx' else b) for b in BUCKETS if cl.get(b) == 'gap') or '—'
        out.append(f'| `{r["operationId"]}` | {r["method"]} {r["path"]} | '
                   + ' | '.join([MARK[cl.get('2xx', 'na')], MARK[r['shape']], opt]
                                + [MARK[cl.get(b, 'na')] for b in ('400', '401', '403', '404', '409')])
                   + f' | {missing} |')
    return '\n'.join(out) + '\n'


def history_row(s, args):
    """One CSV row of the headline numbers, so a trend can be read without opening every report."""
    row = {
        'date': datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%d'),
        'specRef': args.spec_ref[:12], 'operations': s['operations'], 'negativeTests': s['negativeTests'],
        'fullyAsserted': s['fullyAsserted'], 'opsMissingResponseTest': s['opsMissingResponseTest'],
        'zeroTestOperations': len(s['zeroTestOperations']),
        'optionalSent': s['optionalFields'][0], 'optionalTotal': s['optionalFields'][1],
        'shapeUnvalidated': len(s['shapeUnvalidated']),
    }
    for b in BUCKETS:
        row[f'{b}_tested'], row[f'{b}_documented'] = s['codes'][b]
    return row


def write_history(path, previous_path, row):
    """Carry the previous file forward and append this run's row, so the history survives the
    artifact retention window as long as the report keeps running."""
    rows = []
    if previous_path and os.path.exists(previous_path):
        with open(previous_path, newline='') as f:
            rows = [r for r in csv.DictReader(f)]
    rows.append({k: str(v) for k, v in row.items()})
    with open(path, 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=list(row))
        w.writeheader()
        for r in rows:
            w.writerow({k: r.get(k, '') for k in row})


def history_markdown(path, last=8):
    """The most recent history rows as a table for the run summary, newest last."""
    with open(path, newline='') as f:
        rows = list(csv.DictReader(f))[-last:]
    cols = [('date', 'Date')] + [(f'{b}_tested', NAMES[b].split(' (')[-1].rstrip(')') + ' tested') for b in BUCKETS] \
        + [('fullyAsserted', 'Fully tested endpoints'), ('operations', 'Endpoints')]
    out = [f'## Coverage history (last {len(rows)} reports)', '',
           '| ' + ' | '.join(h for _, h in cols) + ' |', '|' + '---|' * len(cols)]
    for r in rows:
        out.append('| ' + ' | '.join(
            f'{r[k]} of {r[k.replace("_tested", "_documented")]}' if k.endswith('_tested') else r[k]
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
    write_history(f'{args.out}/history.csv', args.previous_history, history_row(summary, args))
    open(f'{args.out}/history.md', 'w').write(history_markdown(f'{args.out}/history.csv'))
    print(open(f'{args.out}/slack.txt').read())


if __name__ == '__main__':
    main()
