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
                           [--spec-ref SHA] [--run-url URL] [--tracking-url URL]

Writes DIR/summary.json, DIR/matrix.md and DIR/slack.txt. Exits 2 if the generated
output could not be parsed as expected (so a format change fails the run instead
of reporting zeros).
"""
import argparse
import collections
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
EVIDENCE_RE = re.compile(
    r"operationId: '(\w+)',\s*method: '\w+',\s*url,\s*headers,(?:\s*body: (\w+),)?\s*expectedStatus: (\d+)", re.S)
VALIDATE_RE = re.compile(r"path: '([^']+)',\s*method: '(\w+)',\s*status: '(\d+)'", re.S)


def scan_positive(pw_dir, ops):
    path_to_op = {(o['method'], o['path']): k for k, o in ops.items()}
    asserted = collections.defaultdict(set)
    validated = collections.defaultdict(set)
    sent = collections.defaultdict(set)
    files = glob.glob(f'{pw_dir}/*.spec.ts') + glob.glob(f'{pw_dir}/templates/*/*.spec.ts')
    for f in files:
        src = open(f, encoding='utf-8').read()
        for op_id, body_var, status in EVIDENCE_RE.findall(src):
            if op_id not in ops:
                continue
            asserted[op_id].add(int(status))
            if body_var:
                m = re.search(r'const %s(?::[^=]+)? = \{(.*?)\n\s{6}\};' % re.escape(body_var), src, re.S)
                if m:
                    sent[op_id] |= set(re.findall(r'^\s{8}(\w+):', m.group(1), re.M))
        for path, method, status in VALIDATE_RE.findall(src):
            op_id = path_to_op.get((method.upper(), path))
            if op_id:
                validated[op_id].add(int(status))
    return asserted, validated, sent


# ----------------------------------------------------------------- negative ----
CALL_RE = re.compile(r'assertResponseStatus\(\s*testInfo,\s*res,\s*(\d+),\s*\{([^{}]*)\}', re.S)


def scan_negative(rv_dir, ops):
    asserted = collections.defaultdict(set)
    tests = collections.Counter()
    for profile in ('secured', 'rbac'):
        for f in glob.glob(f'{rv_dir}/{profile}/*-validation-api-tests.spec.ts'):
            src = open(f, encoding='utf-8').read()
            for status, inner in CALL_RE.findall(src):
                m = re.search(r"operationId:\s*'(\w+)'", inner)
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
    held = suppressed | excluded

    rows, doc, got = [], collections.Counter(), collections.Counter()
    missing = collections.defaultdict(list)
    for op_id, o in sorted(ops.items(), key=lambda kv: (kv[1]['path'], kv[1]['method'])):
        asserted = set(neg_asserted[op_id]) | (set() if op_id in suppressed else set(pos_asserted[op_id]))
        success = [c for c in o['codes'] if 200 <= c < 300]
        shape_codes = [c for c in success if c != 204]
        cells = {}
        for code in o['codes']:
            b = bucket(code)
            doc[b] += 1
            if code in asserted:
                got[b] += 1
                cells[b] = 'ok'
            else:
                missing[b].append(op_id)
                cells[b] = 'hold' if (op_id in held and b in ('2xx', '400', '401', '404')) else 'gap'
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
        'heldOperations': sorted(held),
        'zeroTestOperations': sorted(o for o in ops if not pos_asserted[o] and not neg_tests[o] and o not in suppressed),
    }
    return summary, rows


def delta(now, before):
    if before is None:
        return ''
    d = now - before
    return ' (no change)' if d == 0 else f' ({d:+d} vs last report)'


def slack(s, prev, args):
    c = s['codes']
    ref = f'camunda-hub@{args.spec_ref[:7]}' if args.spec_ref else 'spec ' + s['specHash'].replace('sha256:', '')[:7]
    pf = prev['fullyAsserted'] if prev else None
    lines = [
        ':bar_chart: *camunda-hub response coverage* (weekly)',
        f'Spec `{ref}` · {s["operations"]} operations · {s["negativeTests"]} negative tests',
        '',
        f'*Every documented response asserted:* {s["fullyAsserted"]} / {s["operations"]}{delta(s["fullyAsserted"], pf)}',
        '  '.join(f'`{b}` {c[b][0]}/{c[b][1]}' for b in BUCKETS),
        f'Optional request fields sent in a success-path test: {s["optionalFields"][0]}/{s["optionalFields"][1]} · '
        f'success bodies not schema-validated: {len(s["shapeUnvalidated"])}',
        f'{s["opsMissingResponseTest"]} operations are missing a success, 400, 401, 404 or 409 test '
        f'(403 is tracked separately).',
    ]
    if prev:
        new = sorted(set(s['operationIds']) - set(prev.get('operationIds', [])))
        if new:
            lines.append('New operations since last report: ' + ', '.join(f'`{o}`' for o in new))
    if s['zeroTestOperations']:
        lines.append(':warning: Operations with no test at all: ' + ', '.join(f'`{o}`' for o in s['zeroTestOperations']))
    links = []
    if args.run_url:
        links.append(f'<{args.run_url}|Full matrix>')
    if args.tracking_url:
        links.append(f'<{args.tracking_url}|Tracking epic>')
    if links:
        lines += ['', ' · '.join(links)]
    return '\n'.join(lines) + '\n'


GLYPH = {'ok': '●', 'gap': '×', 'hold': '◇', 'na': '·'}


def matrix(s, rows):
    out = [
        f'## camunda-hub response coverage ({s["operations"]} operations)', '',
        f'Every documented response asserted: **{s["fullyAsserted"]} / {s["operations"]}**. Asserted / documented: '
        + ' · '.join(f'`{b}` {s["codes"][b][0]}/{s["codes"][b][1]}' for b in BUCKETS), '',
        '`●` asserted · `×` documented, not asserted · `◇` suppressed or excluded (tracked) · `·` not documented', '',
        '| Operation | Success | Shape | Opt. fields | 400 | 401 | 403 | 404 | 409 |',
        '|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|',
    ]
    for r in rows:
        c = r['cells']
        opt = '·' if not r['optionalTotal'] else f'{r["optionalSent"]}/{r["optionalTotal"]}'
        out.append(f'| `{r["operationId"]}` <sub>{r["method"]} {r["path"]}</sub> | '
                   + ' | '.join([GLYPH[c.get('2xx', 'na')], GLYPH[r['shape']], opt]
                                + [GLYPH[c.get(b, 'na')] for b in ('400', '401', '403', '404', '409')]) + ' |')
    return '\n'.join(out) + '\n'


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--out', required=True)
    ap.add_argument('--previous')
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
    open(f'{args.out}/matrix.md', 'w').write(matrix(summary, rows))
    open(f'{args.out}/slack.txt', 'w').write(slack(summary, prev, args))
    print(open(f'{args.out}/slack.txt').read())


if __name__ == '__main__':
    main()
