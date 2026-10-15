import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const script = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../scripts/e2e/hub_response_coverage.py',
);

type Row = {
  operationId: string;
  area?: string;
  requestChecks: 'ok' | 'gap' | 'hold' | 'na';
  cells: Record<string, string>;
  requestMissing: string[];
};

const ok = (id: string): Row => ({
  operationId: id,
  requestChecks: 'ok',
  cells: { '2xx': 'ok', '404': 'ok' },
  requestMissing: [],
});

/** Runs the weekly report's issue_body() on made-up rows; '' means "close the issue". */
function issueBody(rows: Row[], requestCheckGaps: Record<string, string[]> = {}): string {
  const summary = {
    fullyAsserted: 1,
    operations: rows.length,
    requestNoTests: [],
    requestCheckGaps,
  };
  const code = [
    'import sys, json, types, importlib.util',
    `spec = importlib.util.spec_from_file_location('h', ${JSON.stringify(script)})`,
    'h = importlib.util.module_from_spec(spec); spec.loader.exec_module(h)',
    'd = json.load(sys.stdin)',
    "sys.stdout.write(h.issue_body(d['s'], d['r'], types.SimpleNamespace(run_url='http://run')))",
  ].join('\n');
  return execFileSync('python3', ['-B', '-c', code], {
    input: JSON.stringify({ s: summary, r: rows }),
    encoding: 'utf8',
  });
}

describe('weekly coverage gap issue body', () => {
  it('is empty when nothing is missing, so the workflow closes the issue', () => {
    expect(issueBody([ok('a'), ok('b')])).toBe('');
  });

  it('does not count tracked or held cells as gaps', () => {
    const held: Row = { ...ok('a'), requestChecks: 'hold', cells: { '2xx': 'ok', '403': 'hold' } };
    expect(issueBody([held])).toBe('');
  });

  it('is an index, not a second table: counts, the marker for the area links, no endpoint rows', () => {
    const body = issueBody([{ ...ok('a'), cells: { '2xx': 'ok', '404': 'gap' } }, ok('b')]);
    expect(body).toContain('**1** still have something missing');
    expect(body).toContain('<!-- AREA_INDEX -->');
    expect(body).not.toContain('| `a`');
    expect(body).not.toContain('Missing responses');
    expect(body).not.toMatch(/^\|/m);
    expect(body).toContain('Bad-request tests: every kind that applies is covered.');
    expect(body).toContain('opened gradually');
    expect(body).toContain('Full table: http://run');
  });

  it('says which bad-request kinds are missing most often when there are gaps', () => {
    const row: Row = { ...ok('a'), requestChecks: 'gap', requestMissing: ['param-missing'] };
    const body = issueBody([row], { a: ['param-missing'] });
    expect(body).toContain('Bad-request tests: Most often missing');
    expect(body).toContain('<!-- AREA_INDEX -->');
  });
});

/** Runs area_issues() on made-up rows and returns [title, body] pairs. */
function areaIssues(rows: Row[]): [string, string, string, number, string[]][] {
  const code = [
    'import sys, json, types, importlib.util',
    `spec = importlib.util.spec_from_file_location('h', ${JSON.stringify(script)})`,
    'h = importlib.util.module_from_spec(spec); spec.loader.exec_module(h)',
    'rows = json.load(sys.stdin)',
    "json.dump(h.area_issues(rows, types.SimpleNamespace(run_url='http://run')), sys.stdout)",
  ].join('\n');
  return JSON.parse(
    execFileSync('python3', ['-B', '-c', code], { input: JSON.stringify(rows), encoding: 'utf8' }),
  );
}

describe('per-area coverage gap issues', () => {
  const gap = (id: string, area: string): Row => ({
    ...ok(id),
    area,
    cells: { '2xx': 'ok', '404': 'gap' },
  });

  it('opens nothing when no area has a gap', () => {
    expect(areaIssues([{ ...ok('a'), area: 'Files' }])).toEqual([]);
  });

  it('makes one issue per area, only for areas with a gap, sorted by area', () => {
    const issues = areaIssues([
      gap('f1', 'Files'),
      gap('f2', 'Files'),
      { ...ok('c1'), area: 'Comments' },
      gap('m1', 'Milestones'),
    ]);
    expect(issues.map(([title]) => title)).toEqual([
      '[hub-response-coverage] Files: missing response or bad-request tests',
      '[hub-response-coverage] Milestones: missing response or bad-request tests',
    ]);
    expect(issues[0][1]).toContain('**2** endpoints in the **Files** area');
    expect(issues[0][1]).toContain('`f1`');
    expect(issues[0][1]).not.toContain('`m1`');
    expect(issues[1][1]).toContain('**1** endpoint in the **Milestones** area');
  });

  it('lists a response-only gap and a bad-request-only gap in the area table', () => {
    const kinds: Row = {
      ...ok('k'),
      area: 'Files',
      requestChecks: 'gap',
      requestMissing: ['param-missing'],
    };
    const [[, body]] = areaIssues([gap('r', 'Files'), kinds, { ...ok('fine'), area: 'Files' }]);
    expect(body).toContain('| `r` | 404 | — |');
    expect(body).toContain('| `k` | — | param-missing |');
    expect(body).not.toContain('`fine`');
  });

  it('caps an area table at 100 endpoints and says how many were left out', () => {
    const rows = Array.from({ length: 103 }, (_, i) => gap(`op${i}`, 'Files'));
    const [[, body]] = areaIssues(rows);
    expect(body.match(/^\| `op/gm)).toHaveLength(100);
    expect(body).toContain('…and 3 more');
  });

  it('hands the endpoint ids to the index, in table order', () => {
    const issues = areaIssues([gap('f1', 'Files'), gap('f2', 'Files')]);
    expect(issues[0][4]).toEqual(['f1', 'f2']);
  });

  it('ends every area issue with a link to the guide on fixing a gap', () => {
    const [[, body]] = areaIssues([gap('f1', 'Files')]);
    expect(body).toContain(
      'How to fix a gap: [guide](https://github.com/camunda/api-test-generator/blob/main/docs/hub-response-coverage-report.md#closing-a-gap)',
    );
  });

  it('files an endpoint without an area under Other', () => {
    const [[title]] = areaIssues([{ ...ok('x'), cells: { '2xx': 'gap' } }]);
    expect(title).toBe('[hub-response-coverage] Other: missing response or bad-request tests');
  });
});

// ---- issue lifecycle, run against a stub `gh` ------------------------------------------------

const scriptsDir = join(dirname(fileURLToPath(import.meta.url)), '../../.github/scripts');
const SUMMARY = '[hub-response-coverage] Endpoints missing response or bad-request tests';
const areaTitle = (a: string) =>
  `[hub-response-coverage] ${a}: missing response or bad-request tests`;

type Existing = { number: number; title: string; state: 'OPEN' | 'CLOSED' };

/** Runs one of the issue scripts with a stub gh that records every call; returns calls + outputs. */
function runIssueScript(
  script: string,
  files: Record<string, string>,
  existing: Existing[],
  env: Record<string, string> = {},
) {
  const dir = mkdtempSync(join(tmpdir(), 'gap-issue-'));
  const report = join(dir, 'report');
  mkdirSync(join(report, 'areas'), { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(report, name), body.replaceAll('$REPORT', report));
  }
  writeFileSync(join(dir, 'existing.json'), JSON.stringify(existing));
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  // `issue list` honours --jq like the real gh; `issue create` returns a URL.
  writeFileSync(
    join(bin, 'gh'),
    `#!/usr/bin/env bash
echo "gh $*" >> "$GH_LOG"
if [ "$1 $2" = "issue list" ]; then
  expr=""; prev=""
  for a in "$@"; do [ "$prev" = "--jq" ] && expr="$a"; prev="$a"; done
  if [ -n "$expr" ]; then jq -r "$expr" "$GH_EXISTING"; else cat "$GH_EXISTING"; fi
elif [ "$1 $2" = "issue create" ]; then
  echo "https://example.test/issues/$((100 + $(grep -c 'issue create' "$GH_LOG")))"
fi
`,
  );
  chmodSync(join(bin, 'gh'), 0o755);
  writeFileSync(join(dir, 'log'), '');
  execFileSync('bash', [join(scriptsDir, script)], {
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      GH_LOG: join(dir, 'log'),
      GH_EXISTING: join(dir, 'existing.json'),
      REPORT_DIR: report,
      ISSUE_TITLE: SUMMARY,
      REPO_URL: 'https://example.test',
      RUN_URL: 'https://example.test/run',
      ...env,
    },
  });
  const read = (f: string) =>
    existsSync(join(report, f)) ? readFileSync(join(report, f), 'utf8') : '';
  return {
    calls: readFileSync(join(dir, 'log'), 'utf8')
      .split('\n')
      .filter((l) => l && !l.startsWith('gh issue list')),
    issueUrl: read('issue-url.txt').trim(),
    areaLinks: read('area-links.txt').trim().split('\n').filter(Boolean),
    areaIndex: read('area-index.md').trim().split('\n').filter(Boolean),
    areaIssues: ((raw) => (raw ? JSON.parse(raw) : undefined))(read('area-issues.json')),
    rendered: read('issue.rendered.md'),
  };
}

const area = (name: string, gaps = 1) => ({
  title: areaTitle(name),
  file: `$REPORT/areas/${name}.md`,
  area: name,
  gaps,
  endpoints: Array.from({ length: gaps }, (_, i) => `${name.toLowerCase()}${i + 1}`),
});
const areaFiles = (...names: string[]) => ({
  'areas.json': JSON.stringify(names.map((n) => area(n))),
  ...Object.fromEntries(names.map((n) => [`areas/${n}.md`, `body ${n}`])),
});

describe('summary issue lifecycle (stub gh)', () => {
  it('opens the issue with the three labels when none exists', () => {
    const r = runIssueScript('hub-coverage-summary-issue.sh', { 'issue.md': 'gaps' }, []);
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0]).toContain('issue create');
    expect(r.calls[0]).toContain('--label missing-coverage --label auto-generated --label hub');
    expect(r.issueUrl).toBe('https://example.test/issues/101');
  });

  it('rewrites the open issue in place instead of opening a second one', () => {
    const r = runIssueScript('hub-coverage-summary-issue.sh', { 'issue.md': 'gaps' }, [
      { number: 7, title: SUMMARY, state: 'OPEN' },
    ]);
    expect(r.calls.map((c) => c.split(' ').slice(0, 4).join(' '))).toEqual([
      'gh issue edit 7',
      'gh issue comment 7',
    ]);
    expect(r.issueUrl).toBe('https://example.test/issues/7');
  });

  it('reopens a closed issue when a gap returns', () => {
    const r = runIssueScript('hub-coverage-summary-issue.sh', { 'issue.md': 'gaps' }, [
      { number: 7, title: SUMMARY, state: 'CLOSED' },
    ]);
    expect(r.calls[0]).toBe('gh issue reopen 7');
    expect(r.calls.some((c) => c.includes('issue create'))).toBe(false);
  });

  it('closes the open issue when nothing is missing, and still records its link', () => {
    const r = runIssueScript('hub-coverage-summary-issue.sh', { 'issue.md': '' }, [
      { number: 7, title: SUMMARY, state: 'OPEN' },
    ]);
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0]).toContain('issue close 7');
    expect(r.issueUrl).toBe('https://example.test/issues/7');
  });

  it('does nothing when nothing is missing and no issue is open', () => {
    const r = runIssueScript('hub-coverage-summary-issue.sh', { 'issue.md': '' }, [
      { number: 7, title: SUMMARY, state: 'CLOSED' },
    ]);
    expect(r.calls).toEqual([]);
    expect(r.issueUrl).toBe('');
  });
});

describe('per-area issue lifecycle (stub gh)', () => {
  it('creates, updates and reopens by exact title, and links each one', () => {
    const r = runIssueScript('hub-coverage-area-issues.sh', areaFiles('New', 'Open', 'Shut'), [
      { number: 5, title: areaTitle('Open'), state: 'OPEN' },
      { number: 6, title: areaTitle('Shut'), state: 'CLOSED' },
    ]);
    expect(r.calls.filter((c) => c.includes('issue create'))).toHaveLength(1);
    expect(r.calls).toContain('gh issue reopen 6');
    expect(r.calls.some((c) => c.startsWith('gh issue edit 5 '))).toBe(true);
    expect(r.areaLinks).toEqual([
      '<https://example.test/issues/101|New (1)>',
      '<https://example.test/issues/5|Open (1)>',
      '<https://example.test/issues/6|Shut (1)>',
    ]);
  });

  it('writes area-issues.json mapping each area with an issue to its number', () => {
    const r = runIssueScript('hub-coverage-area-issues.sh', areaFiles('New', 'Open', 'Shut'), [
      { number: 5, title: areaTitle('Open'), state: 'OPEN' },
      { number: 6, title: areaTitle('Shut'), state: 'CLOSED' },
    ]);
    expect(r.areaIssues).toEqual({ New: 101, Open: 5, Shut: 6 });
  });

  it('omits an area from area-issues.json when its issue opens on a later run (cap reached)', () => {
    const r = runIssueScript('hub-coverage-area-issues.sh', areaFiles('A', 'B', 'C'), [], {
      MAX_NEW_AREA_ISSUES: '2',
    });
    // A and B get issues this run; C is capped, so it has no entry (and thus no PR link until it does).
    expect(r.areaIssues).toEqual({ A: 101, B: 102 });
  });

  it('opens at most MAX_NEW_AREA_ISSUES new issues and lists the rest unlinked', () => {
    const r = runIssueScript('hub-coverage-area-issues.sh', areaFiles('A', 'B', 'C'), [], {
      MAX_NEW_AREA_ISSUES: '2',
    });
    expect(r.calls.filter((c) => c.includes('issue create'))).toHaveLength(2);
    expect(r.areaLinks).toEqual([
      '<https://example.test/issues/101|A (1)>',
      '<https://example.test/issues/102|B (1)>',
      'C (1)',
    ]);
  });

  it('closes an open area issue whose area is clean, but never the summary issue', () => {
    const r = runIssueScript('hub-coverage-area-issues.sh', areaFiles('Kept'), [
      { number: 5, title: areaTitle('Kept'), state: 'OPEN' },
      { number: 6, title: areaTitle('Fixed'), state: 'OPEN' },
      { number: 7, title: SUMMARY, state: 'OPEN' },
      { number: 8, title: areaTitle('AlreadyClosed'), state: 'CLOSED' },
    ]);
    const closes = r.calls.filter((c) => c.includes('issue close'));
    expect(closes).toHaveLength(1);
    expect(closes[0]).toContain('issue close 6');
  });
});

describe('the tracking issue is an index of the area issues', () => {
  it('writes one line per area: a link to its issue, or its endpoints when the issue is not open yet', () => {
    const files = {
      'areas.json': JSON.stringify([area('New', 1), area('Open', 2), area('Late', 2)]),
      'areas/New.md': 'b',
      'areas/Open.md': 'b',
      'areas/Late.md': 'b',
    };
    const r = runIssueScript(
      'hub-coverage-area-issues.sh',
      files,
      [{ number: 5, title: areaTitle('Open'), state: 'OPEN' }],
      { MAX_NEW_AREA_ISSUES: '1' },
    );
    expect(r.areaIndex).toEqual([
      '- [ ] #101 **New**: 1 endpoint',
      '- [ ] #5 **Open**: 2 endpoints',
      '- **Late**: 2 endpoints (its issue opens on a later run): `late1`, `late2`',
    ]);
  });

  it('puts that index where the marker is, leaving the rest of the issue as it was', () => {
    const r = runIssueScript(
      'hub-coverage-summary-issue.sh',
      {
        'issue.md': 'top\n<!-- AREA_INDEX -->\nbottom\n',
        'area-index.md': '- [ ] #5 **A & B**: 1 endpoint `x`\n- **C**: 2 endpoints\n',
      },
      [],
    );
    expect(r.rendered).toBe(
      'top\n- [ ] #5 **A & B**: 1 endpoint `x`\n- **C**: 2 endpoints\nbottom\n',
    );
    expect(r.calls[0]).toContain('issue.rendered.md');
  });

  it('drops the marker line when there is no index, instead of leaving it in the issue', () => {
    const r = runIssueScript(
      'hub-coverage-summary-issue.sh',
      { 'issue.md': 'top\n<!-- AREA_INDEX -->\nbottom\n' },
      [],
    );
    expect(r.rendered).toBe('top\nbottom\n');
  });

  it('rewrites an existing issue from the rendered body, never the marker version', () => {
    const r = runIssueScript(
      'hub-coverage-summary-issue.sh',
      { 'issue.md': '<!-- AREA_INDEX -->\n', 'area-index.md': '- line\n' },
      [{ number: 7, title: SUMMARY, state: 'OPEN' }],
    );
    const edit = r.calls.find((c) => c.startsWith('gh issue edit 7'));
    expect(edit).toContain('issue.rendered.md');
    expect(edit).not.toContain('issue.md ');
  });
});

/** Runs slack() on a made-up summary; `prev` is the previous report's summary or null. */
function slackText(summary: Record<string, unknown>, prev: Record<string, unknown> | null): string {
  const code = [
    'import sys, json, types, importlib.util',
    `spec = importlib.util.spec_from_file_location('h', ${JSON.stringify(script)})`,
    'h = importlib.util.module_from_spec(spec); spec.loader.exec_module(h)',
    'd = json.load(sys.stdin)',
    "args = types.SimpleNamespace(spec_ref='abcdef1234', run_url='http://run', tracking_url='http://track')",
    "sys.stdout.write(h.slack(d['s'], d['p'], args))",
  ].join('\n');
  return execFileSync('python3', ['-B', '-c', code], {
    input: JSON.stringify({ s: summary, p: prev }),
    encoding: 'utf8',
  });
}

const baseSummary = (over: Record<string, unknown> = {}) => ({
  specHash: 'sha256:abcdef0',
  operations: 10,
  operationIds: ['a', 'b'],
  negativeTests: 50,
  fullyAsserted: 8,
  opsMissingResponseTest: 2,
  codes: {
    '2xx': [10, 10],
    '400': [4, 5],
    '401': [10, 10],
    '403': [8, 10],
    '404': [3, 4],
    '409': [1, 3],
  },
  optionalFields: [6, 9],
  requestChecks: [5, 10],
  requestCheckGaps: {},
  requestNoTests: [],
  shapeUnvalidated: ['a', 'b', 'c'],
  lifecycle: {
    create: [4, 6],
    createMissing: ['ProjectSnapshot', 'Version'],
    restore: [4, 5],
    restoreMissing: ['Version'],
    edge: [1, 2],
    edgeMissing: ['addTag'],
    known: ['Version'],
  },
  zeroTestOperations: [],
  trackedOperations: [],
  codeGaps: { '2xx': 0, '400': 1, '401': 0, '403': 2, '404': 1, '409': 2 },
  areaResponseGaps: { File: 2, Project: 1 },
  ...over,
});

describe('weekly Slack message', () => {
  it('leads with the documented main question — endpoints tested for every status code', () => {
    const text = slackText(baseSummary(), null);
    expect(text).toContain('*8 of 10 endpoints are tested for every status code they can return*');
    // The two-angle intro frames the headline and the invalid-request line.
    expect(text).toContain('Two angles:');
  });

  it('notes that a documented 500 is not counted, so the headline is not over-claimed', () => {
    const text = slackText(baseSummary(), null);
    expect(text).toContain('a documented 500 is not checked');
    expect(text).toContain('2xx/400/401/403/404/409');
  });

  it('shows the bad-request-kind axis on its own line, flagged as possibly understated', () => {
    const text = slackText(baseSummary(), null);
    expect(text).toContain(
      'Invalid-request coverage: 5 of 10 endpoints are tested with every kind of bad request that applies',
    );
    // The caveat now names the direction: the covered count may be understated; the missing count is the bound.
    expect(text).toContain('may be understated');
    expect(text).toContain('upper bound');
  });

  it('lists status codes not tested yet, omitting codes with no gap', () => {
    const text = slackText(baseSummary(), null);
    // baseSummary codeGaps: 400:1, 403:2, 404:1, 409:2 ; 2xx and 401 are 0, so omitted
    expect(text).toContain('Status codes not tested yet: 400 (1) · 403 (2) · 404 (1) · 409 (2)');
    const clean = slackText(
      baseSummary({ codeGaps: { '2xx': 0, '400': 0, '401': 0, '403': 0, '404': 0, '409': 0 } }),
      null,
    );
    expect(clean).toContain('Status codes not tested yet: none');
  });

  it('lists where the response gaps are, by area, most first', () => {
    const text = slackText(
      baseSummary({ areaResponseGaps: { File: 2, Project: 1, Catalog: 2 } }),
      null,
    );
    // sorted by count desc then name: Catalog 2, File 2, Project 1
    expect(text).toContain('Where those gaps are (by area): Catalog 2 · File 2 · Project 1');
  });

  it('rolls up the out-of-scope dimensions on one line so they stay visible', () => {
    const text = slackText(baseSummary(), null);
    // lifecycle missing 2+1+1=4 ; optional fields 9-6=3 ; response-shape 3
    expect(text).toContain('Other test gaps: 4 lifecycle · 3 optional fields · 3 response-shape');
  });

  it('shows the change in brackets on the headline and on the kind line', () => {
    const text = slackText(
      baseSummary({ fullyAsserted: 8, requestChecks: [5, 10] }),
      baseSummary({ fullyAsserted: 7, requestChecks: [7, 10] }),
    );
    expect(text).toContain('they can return* (+1).');
    expect(text).toContain('every kind of bad request that applies (-2)');
  });

  it('shows no change figures at all for the first report', () => {
    const text = slackText(baseSummary(), null);
    expect(text).toContain('they can return*. _Counts');
    expect(text).not.toMatch(/\([+-]\d+\)/);
  });

  it('links the tracking issues next to an endpoint with no test at all', () => {
    const text = slackText(
      baseSummary({
        zeroTestOperations: ['a', 'b', 'c'],
        trackedOperations: ['a', 'b'],
        trackedUrls: {
          a: [
            'https://github.com/camunda/camunda-hub/issues/25907',
            'https://github.com/camunda/camunda-hub/issues/26448',
          ],
        },
      }),
      null,
    );
    expect(text).toContain(
      'No test at all: `a` (known, tracked: <https://github.com/camunda/camunda-hub/issues/25907|camunda-hub#25907>, <https://github.com/camunda/camunda-hub/issues/26448|camunda-hub#26448>)',
    );
    // tracked but no URL on record, and not tracked at all
    expect(text).toContain('`b` (known, tracked), `c`');
    expect(text).not.toContain('`c` (');
  });

  it('ends with the full-table, tracking-issue and guide links', () => {
    const text = slackText(baseSummary(), null);
    expect(text).toContain('<http://run|Full table>');
    expect(text).toContain('<http://track|Tracking issue>');
    expect(text).toContain('|📖 Guide>');
  });
});

describe('lifecycle resources found in the spec', () => {
  const resources = (ops: Record<string, { method: string; path: string }>) => {
    const code = [
      'import sys, json, importlib.util',
      `spec = importlib.util.spec_from_file_location('h', ${JSON.stringify(script)})`,
      'h = importlib.util.module_from_spec(spec); spec.loader.exec_module(h)',
      'sys.stdout.write(json.dumps(h.lifecycle_resources(json.load(sys.stdin))))',
    ].join('\n');
    return JSON.parse(
      execFileSync('python3', ['-B', '-c', code], { input: JSON.stringify(ops), encoding: 'utf8' }),
    );
  };

  it('needs create, read-by-key and delete, and marks a restore only when a delete is soft', () => {
    const found = resources({
      createFile: { method: 'POST', path: '/files' },
      getFile: { method: 'GET', path: '/files/{fileKey}' },
      deleteFile: { method: 'DELETE', path: '/files/{fileKey}' },
      restoreFile: { method: 'POST', path: '/files/{fileKey}/restoration' },
      searchRecentlyDeletedFiles: { method: 'POST', path: '/files/recently-deleted/search' },
      // a restoration endpoint with no recently-deleted search restores a state, not a deleted entity
      createVersion: { method: 'POST', path: '/versions' },
      getVersion: { method: 'GET', path: '/versions/{versionKey}' },
      deleteVersion: { method: 'DELETE', path: '/versions/{versionKey}' },
      restoreVersion: { method: 'POST', path: '/versions/{versionKey}/restoration' },
      // a resource scoped by a parent key is still a resource
      createDocument: { method: 'POST', path: '/projects/{projectKey}/documents' },
      getDocument: { method: 'GET', path: '/projects/{projectKey}/documents/{documentKey}' },
      deleteDocument: { method: 'DELETE', path: '/projects/{projectKey}/documents/{documentKey}' },
      createTag: { method: 'POST', path: '/tags' },
      getTag: { method: 'GET', path: '/tags/{tagKey}' },
      deleteTag: { method: 'DELETE', path: '/tags/{tagKey}' },
      // no read by key: not a resource
      createClusterRegistration: { method: 'POST', path: '/clusters' },
      removeClusterRegistration: { method: 'DELETE', path: '/clusters/{clusterId}' },
      // a search is not a create
      searchThings: { method: 'POST', path: '/things/search' },
    });
    expect(found).toEqual({
      File: { create: 'createFile', restores: true },
      Version: { create: 'createVersion', restores: false },
      Document: { create: 'createDocument', restores: false },
      Tag: { create: 'createTag', restores: false },
    });
  });

  it('counts a resource only when its own lifecycle test file was generated', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lifecycle-'));
    try {
      for (const f of ['EntityLifecycle/File', 'EntityLifecycle/Tag', 'RestoreLifecycle/File']) {
        mkdirSync(join(dir, 'templates', f.split('/')[0]), { recursive: true });
        writeFileSync(join(dir, 'templates', `${f}.lifecycle.spec.ts`), '');
      }
      const code = [
        'import sys, json, importlib.util',
        `spec = importlib.util.spec_from_file_location('h', ${JSON.stringify(script)})`,
        'h = importlib.util.module_from_spec(spec); spec.loader.exec_module(h)',
        "res = {'File': {'create': 'createFile', 'restores': True}, 'Tag': {'create': 'createTag', 'restores': False},",
        "       'Doc': {'create': 'createDoc', 'restores': True}}",
        `sys.stdout.write(json.dumps(h.scan_lifecycle(${JSON.stringify(dir)}, res)))`,
      ].join('\n');
      const out = JSON.parse(execFileSync('python3', ['-B', '-c', code], { encoding: 'utf8' }));
      // created, restorable, restored
      expect(out).toEqual([['File', 'Tag'], ['Doc', 'File'], ['File']]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  const py = (body: string, input: unknown): unknown =>
    JSON.parse(
      execFileSync(
        'python3',
        [
          '-B',
          '-c',
          [
            'import sys, json, importlib.util',
            `spec = importlib.util.spec_from_file_location('h', ${JSON.stringify(script)})`,
            'h = importlib.util.module_from_spec(spec); spec.loader.exec_module(h)',
            'd = json.load(sys.stdin)',
            body,
          ].join('\n'),
        ],
        { input: JSON.stringify(input), encoding: 'utf8' },
      ),
    );

  it('finds add-and-remove pairs on nested paths only', () => {
    const pairs = py('sys.stdout.write(json.dumps(h.edge_pairs(d)))', {
      addMember: { method: 'POST', path: '/workspaces/{workspaceKey}/members' },
      removeMember: { method: 'DELETE', path: '/workspaces/{workspaceKey}/members/{email}' },
      // a nested POST with nothing to remove
      restoreFile: { method: 'POST', path: '/files/{fileKey}/restoration' },
      // a nested item that can be read by key is a resource, not a link
      createDocument: { method: 'POST', path: '/projects/{projectKey}/documents' },
      getDocument: { method: 'GET', path: '/projects/{projectKey}/documents/{documentKey}' },
      deleteDocument: { method: 'DELETE', path: '/projects/{projectKey}/documents/{documentKey}' },
      // a top-level create/delete pair is a resource, not a link
      createFile: { method: 'POST', path: '/files' },
      deleteFile: { method: 'DELETE', path: '/files/{fileKey}' },
    });
    expect(pairs).toEqual({ addMember: 'removeMember' });
  });

  it('counts a link only when an ontology edge names both operations and its file was generated', () => {
    const dir = mkdtempSync(join(tmpdir(), 'edges-'));
    try {
      mkdirSync(join(dir, 'templates', 'EdgeLifecycle'), { recursive: true });
      writeFileSync(join(dir, 'templates', 'EdgeLifecycle', 'Member.lifecycle.spec.ts'), '');
      writeFileSync(join(dir, 'templates', 'EdgeLifecycle', 'WrongPair.lifecycle.spec.ts'), '');
      const out = py(`sys.stdout.write(json.dumps(h.scan_edges(d['dir'], d['pairs'], d['cfg'])))`, {
        dir,
        pairs: {
          addMember: 'removeMember',
          addTag: 'removeTag',
          addRole: 'removeRole',
          addGroup: 'removeGroup',
        },
        cfg: {
          edges: [
            { name: 'Member', establishedBy: 'addMember', revokedBy: 'removeMember' },
            // names the add operation but not the matching remove: does not count
            { name: 'WrongPair', establishedBy: 'addRole', revokedBy: 'removeOther' },
            // named in the ontology but no file was generated
            { name: 'Tag', establishedBy: 'addTag', revokedBy: 'removeTag' },
          ],
        },
      });
      expect(out).toEqual(['addMember']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
